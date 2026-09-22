import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  cashMovements,
  cashRegisters,
  cashShifts,
  marketCheckoutChildOrders,
  marketCheckoutPayments,
  marketCheckoutSessions,
  orders,
  paymentTransactions,
} from "@makanmasak/database";
import type { Env } from "../../../types/env";
import {
  badRequest,
  forbidden,
  notFound,
} from "../../../shared/utils/api-error";
import { fromCents } from "../../../shared/utils/money";
import {
  generateUUID,
  roundToCurrencyCents,
  type CurrencyCode,
} from "@makanmasak/utils";
import {
  resolveCurrencyForRequest,
  resolveSharedRestaurantCurrency,
} from "../../../shared/utils/restaurant-currency";

type MarketCheckoutPaymentStatus =
  | "pending"
  | "partial_paid"
  | "paid"
  | "failed"
  | "refunded"
  | "partial_refunded";

type MarketCheckoutPaymentMethod = "cash" | "card" | "digital_wallet";
type MarketCheckoutSplitMode = "child_transactions" | "provider_split";

interface MarketCheckoutSessionRow {
  id: string;
  market_id: string;
  market_slug: string;
  market_name: string;
  platform_fee_rate_bps: number | null;
  payment_status: MarketCheckoutPaymentStatus;
  payment_summary: string | Record<string, unknown> | null;
  subtotal_cents: number;
  child_order_count: number;
  created_at_ms: number;
}

interface MarketCheckoutChildOrderRow {
  restaurant_id: string;
  restaurant_name: string;
  order_id: string;
  order_number: string;
  total_amount_cents: number;
}

interface ActiveShiftRow {
  shift_id: string;
  register_id: string;
  restaurant_id: string;
}

export interface ProcessMarketCheckoutPOSPaymentInput {
  checkoutId: string;
  registerId: string;
  shiftId?: string;
  paymentMethod: MarketCheckoutPaymentMethod;
  /** Optional claims, only compared against the vendors' currency. */
  country?: "TW" | "MY" | "VN";
  currency?: "TWD" | "MYR" | "VND";
  operatorId: string;
  operatorRole: number;
  operatorRestaurantId?: string | number | null;
  idempotencyKey?: string | null;
}

export class MarketCheckoutPOSPaymentService {
  private readonly db;

  constructor(private readonly env: Env) {
    this.db = drizzle(env.DB);
  }

  async process(input: ProcessMarketCheckoutPOSPaymentInput) {
    const session = await this.readSession(input.checkoutId);
    if (!session) {
      throw notFound("Market checkout not found");
    }
    if (session.payment_status === "paid") {
      return {
        checkout: this.buildResponseCheckout(
          session,
          [],
          session.payment_summary,
        ),
        payment: parseJsonObject(session.payment_summary),
        alreadyPaid: true,
      };
    }

    const [children, shift] = await Promise.all([
      this.readChildren(input.checkoutId),
      this.readActiveShift(input),
    ]);
    if (children.length === 0) {
      throw badRequest("Market checkout has no child orders to pay");
    }
    if (!shift) {
      throw badRequest("Active POS shift not found for register");
    }
    this.assertCanUseRegister(input, shift, children);
    // The vendors decide the currency; a POS client that still sends one is
    // only checked. This defaulted to TWD, so an MYR market's cash sale was
    // recorded as TWD.
    const { currency, country } = resolveCurrencyForRequest(
      await resolveSharedRestaurantCurrency(
        this.env.DB,
        children.map((child) => child.restaurant_id),
      ),
      input,
    );

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const parentIdempotencyKey =
      input.idempotencyKey ?? `pos-market-checkout:${input.checkoutId}`;
    const childPayments = children.map((child) => {
      const amountCents = orderChildTotalCents(child);
      return {
        restaurantId: child.restaurant_id,
        restaurantName: child.restaurant_name,
        orderId: child.order_id,
        orderNumber: child.order_number,
        paymentId: `pos_market_${input.checkoutId}_${child.order_id}`,
        status: "paid" as const,
        amount: amountCents / 100,
        amountCents,
      };
    });
    const totalAmountCents = childPayments.reduce(
      (sum, payment) => sum + payment.amountCents,
      0,
    );
    const payment = {
      status: "paid" as const,
      method: `pos_${input.paymentMethod}`,
      currency,
      country,
      totalAmount: totalAmountCents / 100,
      totalAmountCents,
      paidAmount: totalAmountCents / 100,
      paidAmountCents: totalAmountCents,
      refundedAmount: 0,
      refundedAmountCents: 0,
      paidAt: nowIso,
      childPayments,
      parentPayment: {
        paymentId: `market_pay_${input.checkoutId}`,
        status: "paid" as const,
        provider: `pos_${input.paymentMethod}`,
        splitMode: "child_transactions" as const,
        idempotencyKey: parentIdempotencyKey,
        amountCents: totalAmountCents,
        paidAmountCents: totalAmountCents,
        refundedAmountCents: 0,
        childPaymentIds: childPayments.map((child) => child.paymentId),
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      settlement: buildSettlement(session, childPayments, currency),
    };

    await Promise.all(
      children.map((child) =>
        this.recordChildPayment({
          child,
          paymentId: `pos_market_${input.checkoutId}_${child.order_id}`,
          paymentMethod: input.paymentMethod,
          amountCents: orderChildTotalCents(child),
          currency,
          country,
          checkoutId: input.checkoutId,
          registerId: input.registerId,
          shiftId: shift.shift_id,
          idempotencyKey: `${parentIdempotencyKey}:${child.order_id}`,
          nowMs,
        }),
      ),
    );
    await Promise.all([
      this.updateSessionPayment(input.checkoutId, payment, nowMs),
      this.upsertParentPayment({
        session,
        payment,
        registerId: input.registerId,
        shiftId: shift.shift_id,
        paymentMethod: input.paymentMethod,
        nowMs,
      }),
      this.recordPOSSale({
        checkoutId: input.checkoutId,
        registerId: input.registerId,
        shiftId: shift.shift_id,
        operatorId: input.operatorId,
        paymentMethod: input.paymentMethod,
        amountCents: totalAmountCents,
        nowMs,
      }),
    ]);

    const checkout = this.buildResponseCheckout(session, children, payment);
    await Promise.all([
      this.updateCachedSession(input.checkoutId, checkout),
      this.updateCachedIndex(input.checkoutId),
    ]);

    return { checkout, payment, alreadyPaid: false };
  }

  private readSession(checkoutId: string) {
    return this.db
      .select({
        id: marketCheckoutSessions.id,
        market_id: marketCheckoutSessions.marketId,
        market_slug: marketCheckoutSessions.marketSlug,
        market_name: marketCheckoutSessions.marketName,
        platform_fee_rate_bps: marketCheckoutSessions.platformFeeRateBps,
        payment_status: marketCheckoutSessions.paymentStatus,
        payment_summary: marketCheckoutSessions.paymentSummary,
        subtotal_cents: marketCheckoutSessions.subtotalCents,
        child_order_count: marketCheckoutSessions.childOrderCount,
        created_at_ms: marketCheckoutSessions.createdAt,
      })
      .from(marketCheckoutSessions)
      .where(eq(marketCheckoutSessions.id, checkoutId))
      .limit(1)
      .then((rows) => {
        const row = rows[0];
        if (!row) return undefined;
        return {
          ...row,
          created_at_ms:
            row.created_at_ms instanceof Date
              ? row.created_at_ms.getTime()
              : row.created_at_ms,
        } as MarketCheckoutSessionRow;
      });
  }

  private readChildren(checkoutId: string) {
    return this.db
      .select({
        restaurant_id: marketCheckoutChildOrders.restaurantId,
        restaurant_name: marketCheckoutChildOrders.restaurantName,
        order_id: marketCheckoutChildOrders.orderId,
        order_number: marketCheckoutChildOrders.orderNumber,
        total_amount_cents: marketCheckoutChildOrders.totalAmountCents,
      })
      .from(marketCheckoutChildOrders)
      .where(eq(marketCheckoutChildOrders.checkoutId, checkoutId))
      .orderBy(marketCheckoutChildOrders.orderId)
      .then((rows) => rows as MarketCheckoutChildOrderRow[]);
  }

  private readActiveShift(input: ProcessMarketCheckoutPOSPaymentInput) {
    const filters = [
      eq(cashShifts.registerId, input.registerId),
      eq(cashShifts.status, "active"),
      eq(cashRegisters.isActive, true),
    ];
    if (input.shiftId) {
      filters.push(eq(cashShifts.id, input.shiftId));
    }

    return this.db
      .select({
        shift_id: cashShifts.id,
        register_id: cashShifts.registerId,
        restaurant_id: cashRegisters.restaurantId,
      })
      .from(cashShifts)
      .innerJoin(cashRegisters, eq(cashRegisters.id, cashShifts.registerId))
      .where(and(...filters))
      .limit(1)
      .then((rows) => rows[0] as ActiveShiftRow | undefined);
  }

  private assertCanUseRegister(
    input: ProcessMarketCheckoutPOSPaymentInput,
    shift: ActiveShiftRow,
    children: MarketCheckoutChildOrderRow[],
  ) {
    if (input.operatorRole === 0) return;

    if (
      input.operatorRestaurantId === undefined ||
      input.operatorRestaurantId === null ||
      String(input.operatorRestaurantId) !== shift.restaurant_id
    ) {
      throw forbidden("Cannot use a POS register outside your restaurant");
    }

    if (
      !children.some((child) => child.restaurant_id === shift.restaurant_id)
    ) {
      throw forbidden(
        "POS register restaurant is not a vendor in this market checkout",
      );
    }
  }

  private async recordChildPayment(input: {
    child: MarketCheckoutChildOrderRow;
    paymentId: string;
    paymentMethod: MarketCheckoutPaymentMethod;
    amountCents: number;
    currency: string;
    country: string;
    checkoutId: string;
    registerId: string;
    shiftId: string;
    idempotencyKey: string;
    nowMs: number;
  }) {
    const timestamp = sql`${input.nowMs}`;
    await this.db.batch([
      this.db
        .insert(paymentTransactions)
        .values({
          transactionId: input.paymentId,
          orderId: input.child.order_id,
          restaurantId: input.child.restaurant_id,
          amountCents: input.amountCents,
          currency: input.currency,
          countryCode: input.country,
          paymentMethod: input.paymentMethod,
          gateway: "pos",
          status: "paid",
          idempotencyKey: input.idempotencyKey,
          metadata: {
            source: "pos_market_checkout",
            marketCheckoutId: input.checkoutId,
            registerId: input.registerId,
            shiftId: input.shiftId,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: timestamp,
        })
        .onConflictDoNothing(),
      this.db
        .update(orders)
        .set({
          // Canonical OrderPaymentStatus, not the "paid" that
          // payment_transactions and market_checkout_sessions use (#311).
          paymentStatus: "completed",
          paymentMethod: input.paymentMethod,
          paymentTransactionId: input.paymentId,
          paidAt: sql`COALESCE(${orders.paidAt}, ${input.nowMs})`,
          updatedAt: timestamp,
        })
        .where(eq(orders.id, input.child.order_id)),
    ] as [BatchItem<"sqlite">, BatchItem<"sqlite">]);
  }

  private async updateSessionPayment(
    checkoutId: string,
    payment: Record<string, unknown>,
    nowMs: number,
  ) {
    await this.db
      .update(marketCheckoutSessions)
      .set({
        paymentStatus: "paid",
        paymentSummary: payment,
        updatedAt: sql`${nowMs}`,
      })
      .where(eq(marketCheckoutSessions.id, checkoutId))
      .run();
  }

  private async upsertParentPayment(input: {
    session: MarketCheckoutSessionRow;
    payment: Record<string, unknown> & {
      parentPayment?: {
        paymentId: string;
        provider: string;
        splitMode: MarketCheckoutSplitMode;
        idempotencyKey: string;
        childPaymentIds: string[];
      };
      totalAmountCents?: number;
      paidAmountCents?: number;
      refundedAmountCents?: number;
      currency?: string;
      country?: string;
      settlement?: unknown;
    };
    registerId: string;
    shiftId: string;
    paymentMethod: MarketCheckoutPaymentMethod;
    nowMs: number;
  }) {
    const parentPayment = input.payment.parentPayment;
    if (!parentPayment) return;

    const timestamp = sql`${input.nowMs}`;
    await this.db
      .insert(marketCheckoutPayments)
      .values({
        paymentId: parentPayment.paymentId,
        checkoutId: input.session.id,
        marketId: input.session.market_id,
        provider: parentPayment.provider,
        splitMode: parentPayment.splitMode,
        idempotencyKey: parentPayment.idempotencyKey,
        status: "paid",
        amountCents: input.payment.totalAmountCents ?? 0,
        paidAmountCents: input.payment.paidAmountCents ?? 0,
        refundedAmountCents: input.payment.refundedAmountCents ?? 0,
        currency: input.payment.currency ?? null,
        countryCode: input.payment.country ?? null,
        childPaymentIds: parentPayment.childPaymentIds,
        providerPayload: {
          source: "pos_market_checkout",
          paymentMethod: input.paymentMethod,
          registerId: input.registerId,
          shiftId: input.shiftId,
          settlement: input.payment.settlement ?? null,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: marketCheckoutPayments.paymentId,
        set: {
          provider: parentPayment.provider,
          splitMode: parentPayment.splitMode,
          idempotencyKey: parentPayment.idempotencyKey,
          status: "paid",
          amountCents: input.payment.totalAmountCents ?? 0,
          paidAmountCents: input.payment.paidAmountCents ?? 0,
          refundedAmountCents: input.payment.refundedAmountCents ?? 0,
          currency: input.payment.currency ?? null,
          countryCode: input.payment.country ?? null,
          childPaymentIds: parentPayment.childPaymentIds,
          providerPayload: {
            source: "pos_market_checkout",
            paymentMethod: input.paymentMethod,
            registerId: input.registerId,
            shiftId: input.shiftId,
            settlement: input.payment.settlement ?? null,
          },
          updatedAt: timestamp,
          completedAt: sql`COALESCE(${marketCheckoutPayments.completedAt}, ${input.nowMs})`,
        },
      })
      .run();
  }

  private async recordPOSSale(input: {
    checkoutId: string;
    registerId: string;
    shiftId: string;
    operatorId: string;
    paymentMethod: MarketCheckoutPaymentMethod;
    amountCents: number;
    nowMs: number;
  }) {
    const methodColumn = posShiftMethodColumn(input.paymentMethod);
    const statements: BatchItem<"sqlite">[] = [
      this.db
        .update(cashShifts)
        .set({
          totalSalesCents: sql`COALESCE(${cashShifts.totalSalesCents}, 0) + ${input.amountCents}`,
          [methodColumn.centsKey]: sql`COALESCE(${methodColumn.centsColumn}, 0) + ${input.amountCents}`,
          totalTransactions: sql`${cashShifts.totalTransactions} + 1`,
        })
        .where(eq(cashShifts.id, input.shiftId)),
    ];

    // Card and wallet payments are sales, but they never enter the drawer.
    // Recording them as cash movements made a closing count look as though the
    // till had received money it did not hold.
    if (input.paymentMethod === "cash") {
      statements.push(
        this.db.insert(cashMovements).values({
          id: generateUUID(),
          shiftId: input.shiftId,
          registerId: input.registerId,
          type: "sale",
          amountCents: input.amountCents,
          description: `Market checkout ${input.checkoutId} POS payment`,
          referenceId: null,
          referenceType: "market_checkout",
          paymentMethod: input.paymentMethod,
          denominationBreakdown: "{}",
          recordedBy: input.operatorId,
          approvalStatus: "approved",
          metadata: JSON.stringify({ marketCheckoutId: input.checkoutId }),
          createdAt: sql`${input.nowMs}`,
        }),
      );
    }

    await this.db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  }

  private buildResponseCheckout(
    session: MarketCheckoutSessionRow,
    children: MarketCheckoutChildOrderRow[],
    payment: unknown,
  ) {
    return {
      id: session.id,
      market: {
        id: session.market_id,
        slug: session.market_slug,
        name: session.market_name,
        platformFeeRateBps: session.platform_fee_rate_bps ?? undefined,
      },
      status: "submitted",
      childOrders: children.map((child) => ({
        restaurantId: child.restaurant_id,
        restaurantName: child.restaurant_name,
        orderId: child.order_id,
        orderNumber: child.order_number,
        totalAmount: fromCents(orderChildTotalCents(child)),
        totalAmountCents: orderChildTotalCents(child),
      })),
      payment: parseJsonObject(payment),
      subtotal: session.subtotal_cents,
      createdAt: new Date(session.created_at_ms).toISOString(),
    };
  }

  private async updateCachedSession(checkoutId: string, checkout: unknown) {
    const key = `market_checkout:${checkoutId}`;
    const stored = await this.env.CACHE_KV.get(key);
    if (!stored) return;

    const previous = JSON.parse(stored) as Record<string, unknown>;
    await this.env.CACHE_KV.put(
      key,
      JSON.stringify({ ...previous, ...(checkout as Record<string, unknown>) }),
      { expirationTtl: 4 * 60 * 60 },
    );
  }

  private async updateCachedIndex(checkoutId: string) {
    const stored = await this.env.CACHE_KV.get("market_checkout:index");
    if (!stored) return;

    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return;

    const nextIndex = parsed.map((item) => {
      if (!item || typeof item !== "object") return item;
      const checkout = item as Record<string, unknown>;
      if (checkout.id !== checkoutId) return item;
      return {
        ...checkout,
        paymentStatus: "paid",
        updatedAt: new Date().toISOString(),
      };
    });
    await this.env.CACHE_KV.put(
      "market_checkout:index",
      JSON.stringify(nextIndex),
      {
        expirationTtl: 4 * 60 * 60,
      },
    );
  }
}

function orderChildTotalCents(child: { total_amount_cents?: number | null }) {
  return Number(child.total_amount_cents ?? 0);
}

function buildSettlement(
  session: MarketCheckoutSessionRow,
  childPayments: Array<{
    restaurantId: string;
    restaurantName: string;
    orderId: string;
    orderNumber: string;
    amountCents: number;
  }>,
  currency: CurrencyCode,
) {
  const platformFeeRateBps = clampPlatformFeeRateBps(
    session.platform_fee_rate_bps,
  );
  const vendorAllocations = childPayments.map((child) => {
    // Each vendor's fee is on the currency's step (NT$ and ₫ whole units), so
    // its net payout is too.
    const platformFeeCents = roundToCurrencyCents(
      (child.amountCents * platformFeeRateBps) / 10000,
      currency,
    );
    return {
      restaurantId: child.restaurantId,
      restaurantName: child.restaurantName,
      orderId: child.orderId,
      orderNumber: child.orderNumber,
      grossAmountCents: child.amountCents,
      refundedAmountCents: 0,
      platformFeeCents,
      netAmountCents: child.amountCents - platformFeeCents,
    };
  });

  return {
    platformFeeRateBps,
    platformFeeCents: vendorAllocations.reduce(
      (sum, allocation) => sum + allocation.platformFeeCents,
      0,
    ),
    vendorNetAmountCents: vendorAllocations.reduce(
      (sum, allocation) => sum + allocation.netAmountCents,
      0,
    ),
    vendorAllocations,
  };
}

function clampPlatformFeeRateBps(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(10000, Math.max(0, Math.trunc(value)));
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function posShiftMethodColumn(paymentMethod: MarketCheckoutPaymentMethod) {
  if (paymentMethod === "cash") {
    return {
      centsKey: "cashSalesCents",
      centsColumn: cashShifts.cashSalesCents,
    } as const;
  }
  if (paymentMethod === "card") {
    return {
      centsKey: "cardSalesCents",
      centsColumn: cashShifts.cardSalesCents,
    } as const;
  }
  return {
    centsKey: "digitalSalesCents",
    centsColumn: cashShifts.digitalSalesCents,
  } as const;
}
