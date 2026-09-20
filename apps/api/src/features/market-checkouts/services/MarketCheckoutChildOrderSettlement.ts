/**
 * Settle the *child orders* of a market checkout.
 *
 * A market checkout charges one aggregate amount, but each vendor owns its own
 * `orders` row, and that row is what the kitchen display and the vendor's admin
 * dashboard read. Only the POS path ever wrote those rows
 * (`features/pos/services/MarketCheckoutPOSPaymentService.ts`), so an online
 * checkout could be `market_checkout_payments.status = 'paid'` for the full
 * amount while every vendor still saw `payment_status = 'pending'`.
 *
 * This module is the one place that writes that per-child settlement, so the
 * provider webhook, the reconciliation service and the synchronous `/pay`
 * response (credits, and a gateway that authorizes in-band) all leave a child
 * order in exactly the state the POS path leaves it in:
 *
 * - a `payment_transactions` row for the vendor, in the checkout's currency,
 *   for the amount that vendor's share of the charge was;
 * - `orders.payment_status = 'completed'` (the canonical OrderPaymentStatus,
 *   not the `'paid'` that `payment_transactions` uses — see
 *   `ORDER_PAYMENT_STATUSES`), `payment_method`, `payment_transaction_id` and
 *   `paid_at_ms`.
 *
 * `orders.status` is deliberately untouched, exactly as in the POS path. The
 * workflow status belongs to the vendor, who already received the order over
 * realtime and web push when it was created (`OrdersService.createOrder`);
 * paying for it must never drag an order a vendor has advanced to `preparing`
 * back to an earlier state. For the same reason nothing here broadcasts: the
 * POS path broadcasts nothing on payment either, so a paid market order reaches
 * the kitchen by the one route it always did.
 *
 * Every write is idempotent. The transaction id is derived from
 * (checkout, order) alone, so a webhook redelivery, a reconciliation run after
 * the webhook already settled, and a retried payment all converge on the same
 * row: the insert is `ON CONFLICT DO NOTHING`, `paid_at_ms` is `COALESCE`d, and
 * an order that has since been refunded is excluded rather than flipped back to
 * `completed`.
 */
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  marketCheckoutChildOrders,
  marketCheckoutSessions,
  orders,
  paymentTransactions,
} from "@makanmasak/database";
import type { Env } from "../../../types/env";

/** Statuses a settlement must never overwrite on `orders.payment_status`. */
const REFUNDED_ORDER_PAYMENT_STATUSES = ["refunded", "partial_refunded"];

/**
 * What every online market checkout settlement writes to
 * `orders.payment_method`. It is a canonical `OrderPaymentMethod`, unlike the
 * checkout-level method names (`market_online`, `credits`, `shop_*`), which
 * stay where they carry meaning: `payment_transactions.gateway` and the
 * checkout's own payment summary.
 */
export const MARKET_CHECKOUT_ORDER_PAYMENT_METHOD = "online";

export interface MarketCheckoutChildAllocation {
  orderId: string;
  restaurantId: string;
  /** This child's share of the aggregate charge, in internal cents. */
  amountCents: number;
}

export interface SettleMarketCheckoutChildOrdersPaidInput {
  checkoutId: string;
  /** `market_checkout_payments.payment_id`, recorded on each child row. */
  marketCheckoutPaymentId: string;
  /** Written to `orders.payment_method`. */
  paymentMethod: string;
  /** Written to `payment_transactions.gateway`. */
  gateway: string;
  /** The checkout's server-resolved currency, as recorded on the payment row. */
  currency: string | null;
  country: string | null;
  /**
   * `market_checkout_payments.amount_cents` — what was actually charged. The
   * allocations must add up to it exactly or nothing is written.
   */
  chargedTotalCents: number;
  providerTransactionId?: string | null;
  /**
   * The provider's own split, when the caller has it (the synchronous `/pay`
   * response). Omitted by the webhook and reconciliation paths, which derive it
   * from the stored child orders instead.
   */
  allocations?: MarketCheckoutChildAllocation[];
  nowMs?: number;
}

export interface MarketCheckoutChildSettlementResult {
  settled: number;
  /** Set when nothing was written; `settled` is then 0. */
  skippedReason?: "no_child_orders" | "allocation_total_mismatch";
}

/**
 * The `payment_transactions.transaction_id` for one vendor's share of a market
 * checkout. Derived from (checkout, order) only, so every settlement path
 * produces the same id for the same money.
 */
export function marketCheckoutChildPaymentId(
  checkoutId: string,
  orderId: string,
): string {
  return `mkt_${checkoutId}_${orderId}`;
}

/**
 * Mark every child order of a paid market checkout as paid. Safe to call more
 * than once for the same checkout.
 */
export async function settleMarketCheckoutChildOrdersPaid(
  env: Env,
  input: SettleMarketCheckoutChildOrdersPaidInput,
): Promise<MarketCheckoutChildSettlementResult> {
  const db = drizzle(env.DB);
  const allocations =
    input.allocations && input.allocations.length > 0
      ? input.allocations
      : await deriveChildAllocations(db, input.checkoutId);

  if (allocations.length === 0) {
    return { settled: 0, skippedReason: "no_child_orders" };
  }

  const allocatedCents = allocations.reduce(
    (sum, allocation) => sum + allocation.amountCents,
    0,
  );
  if (allocatedCents !== input.chargedTotalCents) {
    // The shares do not add up to what the customer was charged, so no share
    // is known to be right. Writing an invented split into a vendor's books is
    // worse than leaving the checkout visibly unsettled for an operator.
    console.error("marketCheckout.childSettlement.allocationMismatch", {
      checkoutId: input.checkoutId,
      chargedTotalCents: input.chargedTotalCents,
      allocatedCents,
      childOrderCount: allocations.length,
    });
    return { settled: 0, skippedReason: "allocation_total_mismatch" };
  }

  const nowMs = input.nowMs ?? Date.now();
  const timestamp = sql`${nowMs}`;
  const statements: Array<BatchItem<"sqlite">> = [];

  for (const allocation of allocations) {
    const transactionId = marketCheckoutChildPaymentId(
      input.checkoutId,
      allocation.orderId,
    );
    statements.push(
      db
        .insert(paymentTransactions)
        .values({
          transactionId,
          orderId: allocation.orderId,
          restaurantId: allocation.restaurantId,
          amountCents: allocation.amountCents,
          currency: input.currency,
          countryCode: input.country,
          paymentMethod: input.paymentMethod,
          gateway: input.gateway,
          status: "paid",
          idempotencyKey: `market-checkout:${input.checkoutId}:${allocation.orderId}`,
          providerTransactionId: input.providerTransactionId ?? null,
          metadata: {
            source: "market_checkout",
            marketCheckoutId: input.checkoutId,
            marketCheckoutPaymentId: input.marketCheckoutPaymentId,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: timestamp,
        })
        .onConflictDoNothing(),
      db
        .update(orders)
        .set({
          // Canonical OrderPaymentStatus, not the "paid" that
          // payment_transactions and market_checkout_sessions use (#311).
          paymentStatus: "completed",
          paymentMethod: input.paymentMethod,
          paymentTransactionId: transactionId,
          paidAt: sql`COALESCE(${orders.paidAt}, ${nowMs})`,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(orders.id, allocation.orderId),
            // A redelivered webhook must not resurrect an order that has since
            // been refunded.
            notInArray(
              sql`COALESCE(${orders.paymentStatus}, '')`,
              REFUNDED_ORDER_PAYMENT_STATUSES,
            ),
          ),
        ),
    );
  }

  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { settled: allocations.length };
}

export interface SettleMarketCheckoutChildOrdersRefundedInput {
  checkoutId: string;
  /** `refunded` when the whole charge came back, `partial_refunded` otherwise. */
  status: "refunded" | "partial_refunded";
  nowMs?: number;
}

/**
 * Carry a market checkout refund down to the child orders this module settled.
 *
 * Scoped to the `payment_transactions` rows written by
 * `settleMarketCheckoutChildOrdersPaid` and still `paid`, which makes it both
 * idempotent and inapplicable to a POS-paid checkout (whose child rows the POS
 * refund path owns). A market refund is aggregate, so a partial one cannot be
 * attributed to one vendor: every still-paid child reads `partial_refunded`,
 * the canonical status for "some of this order's money came back", and only a
 * full refund records an exact `refund_amount_cents`.
 */
export async function settleMarketCheckoutChildOrdersRefunded(
  env: Env,
  input: SettleMarketCheckoutChildOrdersRefundedInput,
): Promise<MarketCheckoutChildSettlementResult> {
  const db = drizzle(env.DB);
  const children = await db
    .select({
      orderId: marketCheckoutChildOrders.orderId,
    })
    .from(marketCheckoutChildOrders)
    .where(eq(marketCheckoutChildOrders.checkoutId, input.checkoutId))
    .all();
  if (children.length === 0) {
    return { settled: 0, skippedReason: "no_child_orders" };
  }

  const transactionIds = children.map((child) =>
    marketCheckoutChildPaymentId(input.checkoutId, child.orderId),
  );
  const settledRows = await db
    .select({
      transactionId: paymentTransactions.transactionId,
      orderId: paymentTransactions.orderId,
      amountCents: paymentTransactions.amountCents,
    })
    .from(paymentTransactions)
    .where(
      and(
        inArray(paymentTransactions.transactionId, transactionIds),
        eq(paymentTransactions.status, "paid"),
      ),
    )
    .all();
  if (settledRows.length === 0) {
    return { settled: 0 };
  }

  const nowMs = input.nowMs ?? Date.now();
  const timestamp = sql`${nowMs}`;
  const statements: Array<BatchItem<"sqlite">> = [];

  for (const row of settledRows) {
    statements.push(
      db
        .update(paymentTransactions)
        .set({ status: input.status, updatedAt: timestamp })
        .where(eq(paymentTransactions.transactionId, row.transactionId)),
      db
        .update(orders)
        .set({
          paymentStatus: input.status,
          ...(input.status === "refunded"
            ? { refundAmountCents: row.amountCents }
            : {}),
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(orders.id, row.orderId),
            eq(orders.paymentTransactionId, row.transactionId),
          ),
        ),
    );
  }

  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { settled: settledRows.length };
}

/**
 * What each vendor's share of the charge was, for a caller that does not hold
 * the provider's own split: the stored child order total, less that child's
 * share of any 卷 (voucher) discount — which is exactly how `/pay` computed the
 * amount it sent to the provider.
 */
async function deriveChildAllocations(
  db: ReturnType<typeof drizzle>,
  checkoutId: string,
): Promise<MarketCheckoutChildAllocation[]> {
  const [children, session] = await Promise.all([
    db
      .select({
        orderId: marketCheckoutChildOrders.orderId,
        restaurantId: marketCheckoutChildOrders.restaurantId,
        totalAmountCents: marketCheckoutChildOrders.totalAmountCents,
      })
      .from(marketCheckoutChildOrders)
      .where(eq(marketCheckoutChildOrders.checkoutId, checkoutId))
      .all(),
    db
      .select({
        appliedVoucher: sql<
          string | null
        >`${marketCheckoutSessions.appliedVoucher}`,
      })
      .from(marketCheckoutSessions)
      .where(eq(marketCheckoutSessions.id, checkoutId))
      .limit(1)
      .get(),
  ]);

  const discountByOrderId = voucherDiscountsByOrderId(session?.appliedVoucher);
  return children.map((child) => ({
    orderId: child.orderId,
    restaurantId: child.restaurantId,
    amountCents: Math.max(
      0,
      child.totalAmountCents - (discountByOrderId.get(child.orderId) ?? 0),
    ),
  }));
}

/**
 * Per-child voucher discount out of the stored `applied_voucher` JSON, for a
 * single voucher or a stacked bundle.
 *
 * Read structurally rather than through `MarketCheckoutVoucherService`'s
 * reader: that one requires a numeric `orderId`, while `orders.id` has been
 * TEXT UUID v7 for some time, so it rejects every real allocation. Anything it
 * cannot read yields no discount here, which fails the allocation-total check
 * rather than under-charging a vendor.
 */
function voucherDiscountsByOrderId(
  rawAppliedVoucher: string | Record<string, unknown> | null | undefined,
): Map<string, number> {
  const discounts = new Map<string, number>();
  const applied = parseJson(rawAppliedVoucher);
  if (!applied || typeof applied !== "object") return discounts;

  const candidates: unknown[] = Array.isArray(
    (applied as { vouchers?: unknown }).vouchers,
  )
    ? ((applied as { vouchers: unknown[] }).vouchers ?? [])
    : [applied];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const allocations = (candidate as { allocations?: unknown }).allocations;
    if (!Array.isArray(allocations)) continue;

    for (const allocation of allocations) {
      if (!allocation || typeof allocation !== "object") continue;
      const { orderId, discountCents } = allocation as {
        orderId?: unknown;
        discountCents?: unknown;
      };
      const key =
        typeof orderId === "string" || typeof orderId === "number"
          ? String(orderId)
          : undefined;
      if (key === undefined) continue;
      if (
        typeof discountCents !== "number" ||
        !Number.isFinite(discountCents)
      ) {
        continue;
      }
      discounts.set(key, (discounts.get(key) ?? 0) + discountCents);
    }
  }

  return discounts;
}

function parseJson(
  value: string | Record<string, unknown> | null | undefined,
): unknown {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
