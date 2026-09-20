import { drizzle } from "drizzle-orm/d1";
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  amountFromCents,
  orders,
  paymentTransactions,
  tables,
} from "@makanmasak/database";
import type { OrderStatus } from "@makanmasak/shared-types";
import type { Env } from "../../../types/env";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";
import type { PaymentRequestInput } from "../schemas/validation";
import {
  PAYMENT_AUDIT_EVENT_TYPES,
  PaymentAuditService,
} from "../../billing/services/PaymentAuditService";
import {
  finalizeOrderStatusSideEffects,
  invalidateOrderCache,
} from "../../orders/services/order-finalization";
import {
  OWNER_ALERTED_PAYMENT_FAILURE_CODES,
  raisePaymentFailedAlert,
} from "../../alerts/producers";
import { collectableAmount, isCurrencyAlignedCents } from "@makanmasak/utils";
import {
  resolveCurrencyForRequest,
  resolveRestaurantCurrency,
  type CurrencyCode,
} from "../../../shared/utils/restaurant-currency";

export type PaymentActor =
  | { kind: "staff"; user: AuthUser }
  | {
      kind: "provider";
      provider: string;
      providerTransactionId: string;
    };

export interface ProcessPaymentOptions {
  actor: PaymentActor;
  /**
   * What the caller claims the order is priced in. Never recorded: the
   * restaurant's own currency is, and a claim that disagrees with it is
   * rejected with CURRENCY_MISMATCH.
   */
  country?: string;
  currency?: string;
  idempotencyKey?: string;
  customerInfo?: unknown;
  metadata?: unknown;
}

export interface ProcessPaymentResult {
  status: 200 | 202;
  data: {
    paymentId: string;
    orderId: string;
    orderStatus: string;
    paymentStatus: string;
    /** The order total. Never moved by cash rounding. */
    authorizedTotal: number;
    /**
     * What the payment actually collected. Differs from `authorizedTotal`
     * only for an MYR cash payment, which Bank Negara's rounding mechanism
     * settles to the nearest 5 sen (#405).
     */
    collectedTotal: number;
    /** `collectedTotal - authorizedTotal`, in major units; 0 or ±0.01/±0.02. */
    roundingAdjustment: number;
    currency: string | null;
    country: string | null;
  };
}

/** What `runPayment` learned before it failed, for the failure record. */
interface PaymentAttemptContext {
  currency?: CurrencyCode;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function jsonOrNull(value: unknown): unknown | null {
  return value === undefined ? null : value;
}

function assertSameAmount(
  actual: number,
  expected: number,
  code: string,
  message: string,
) {
  if (cents(actual) !== cents(expected)) {
    throw new ApiError(code, message, 409, {
      expected: Number(expected.toFixed(2)),
      actual: Number(actual.toFixed(2)),
    });
  }
}

export class PaymentService {
  private db;
  private paymentAudit: PaymentAuditService;

  constructor(private readonly env: Env) {
    this.db = drizzle(env.DB);
    this.paymentAudit = new PaymentAuditService(env.DB);
  }

  async processPayment(
    input: PaymentRequestInput,
    options: ProcessPaymentOptions,
  ): Promise<ProcessPaymentResult> {
    if (!isPaymentActor(options?.actor)) {
      throw new ApiError(
        "PAYMENT_ACTOR_REQUIRED",
        "A trusted payment actor is required",
        403,
      );
    }
    const [existing] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);

    if (!existing) {
      // The one rejection left untraced (#350). `payment_audit_log` is read by
      // (restaurant_id, occurred_at_ms), so a row with no restaurant is a
      // record nobody can retrieve — and an order id that does not resolve is
      // a caller bug rather than an operational event.
      throw new ApiError("ORDER_NOT_FOUND", "Order not found", 404);
    }

    const attempt: PaymentAttemptContext = {};
    try {
      return await this.runPayment(input, options, existing, attempt);
    } catch (error) {
      await this.recordPaymentFailure(existing, input, options, attempt, error);
      throw error;
    }
  }

  /**
   * Everything past the order lookup, split out so `processPayment` can wrap
   * one `try` around the whole rejection surface instead of repeating a record
   * call at each `throw`. Failures inside the closing batch are covered too:
   * a D1 error there is as real a payment failure as a rejected amount.
   */
  private async runPayment(
    input: PaymentRequestInput,
    options: ProcessPaymentOptions,
    existing: typeof orders.$inferSelect,
    attempt: PaymentAttemptContext,
  ): Promise<ProcessPaymentResult> {
    if (
      options.actor.kind === "staff" &&
      options.actor.user.role !== 0 &&
      (!options.actor.user.restaurantId ||
        String(options.actor.user.restaurantId) !==
          String(existing.restaurantId))
    ) {
      throw new ApiError("FORBIDDEN", "Access denied", 403);
    }

    if (
      options.actor.kind === "staff" &&
      !canProcessPayment(options.actor.user.role)
    ) {
      throw new ApiError("INSUFFICIENT_ROLE", "Insufficient permissions", 403);
    }

    // Read-side replay, deliberately placed after the caller has been
    // authorised for *this* order and before `isAlreadyFinalized` — a replayed
    // payment always finds its order already paid, which is the point.
    //
    // `payment_transactions.idempotency_key` outlives the middleware record
    // that guards a key against body reuse: `releaseOnServerError` releases
    // that record on a 5xx, and a takeover past its TTL rewrites `request_hash`
    // for whatever request arrived next, while this column is kept forever. So
    // the key alone cannot identify a replay — a row belonging to a different
    // order means the key was reused, not that this request already happened.
    if (options.idempotencyKey) {
      const recorded = await this.findPaymentByIdempotencyKey(
        options.idempotencyKey,
      );
      if (recorded) {
        if (recorded.orderId !== input.orderId) {
          throw new ApiError(
            "IDEMPOTENCY_ORDER_MISMATCH",
            "Idempotency key was already used for a different order",
            422,
          );
        }
        return processPaymentResultFromRow(recorded, existing);
      }
    }

    if (isAlreadyFinalized(existing.status, existing.paymentStatus)) {
      throw new ApiError(
        "ORDER_NOT_PAYABLE",
        "Order is not in a payable state",
        409,
      );
    }

    // The restaurant decides the currency; the caller's claim is only checked.
    // Before this, the cashier sent none and every payment was recorded TWD.
    const { currency, country } = resolveCurrencyForRequest(
      await resolveRestaurantCurrency(this.env.DB, existing.restaurantId),
      options,
    );
    attempt.currency = currency;

    const serverTotal = amountFromCents(existing.totalAmountCents) ?? 0;

    // What may actually be handed over (#405). The order total never moves;
    // an MYR bill settled in physical cash is collected to the nearest 5 sen
    // because the 1 and 2 sen coins are out of circulation, and the difference
    // is recorded on the payment rather than re-pricing the order. Every other
    // method and currency returns the total unchanged with a 0 adjustment, so
    // nothing below needs to test the payment method itself.
    //
    // `method` is resolved here rather than further down because the
    // collectable amount depends on it.
    const method =
      input.paymentMode === "partial"
        ? "split"
        : (input.method ?? input.gateway ?? "other");
    const { collectableCents, roundingAdjustmentCents } = collectableAmount(
      existing.totalAmountCents ?? 0,
      { currency, paymentMethod: method },
    );
    const collectedTotal = amountFromCents(collectableCents) ?? 0;

    if (input.paymentMode === "partial") {
      assertSplitPrecision(
        input.payments ?? [],
        existing.totalAmountCents ?? 0,
        currency,
      );
    }
    if (input.expectedTotal !== undefined) {
      assertSameAmount(
        input.expectedTotal,
        serverTotal,
        "PAYMENT_TOTAL_MISMATCH",
        "Expected total does not match authoritative order total",
      );
    }

    if (input.paymentMode === "partial") {
      const paidTotal = (input.payments ?? []).reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      assertSameAmount(
        paidTotal,
        serverTotal,
        "PARTIAL_PAYMENT_TOTAL_MISMATCH",
        "Partial payment amounts do not match order total",
      );
    } else {
      assertCollectableAmount(input.amount ?? 0, serverTotal, collectedTotal);
    }

    const paymentId = `pay_${input.orderId}_${Date.now()}`;
    const shouldCloseOrder = input.closeOrder ?? true;
    const now = Date.now();

    const orderUpdate = this.prepareOrderPaymentUpdate(
      input.orderId,
      paymentId,
      method,
      shouldCloseOrder,
      now,
    );
    const orderUpdateResult = await orderUpdate.run();
    if (mutationChanges(orderUpdateResult) === 0) {
      throw new ApiError(
        "ORDER_NOT_PAYABLE",
        "Order is not in a payable state",
        409,
      );
    }

    await this.db.batch([
      this.preparePaymentTransactionInsert(
        {
          transactionId: paymentId,
          orderId: input.orderId,
          restaurantId: existing.restaurantId,
          amountCents: collectableCents,
          roundingAdjustmentCents,
          currency,
          countryCode: country,
          paymentMethod: method,
          gateway:
            options.actor.kind === "provider"
              ? options.actor.provider
              : (input.gateway ?? input.method ?? null),
          providerTransactionId:
            options.actor.kind === "provider"
              ? options.actor.providerTransactionId
              : null,
          idempotencyKey: options.idempotencyKey ?? null,
          customerInfo: jsonOrNull(options.customerInfo),
          metadata: jsonOrNull({
            ...((options.metadata as Record<string, unknown> | undefined) ??
              {}),
            paymentMode: input.paymentMode,
            closeOrder: shouldCloseOrder,
          }),
        },
        now,
      ),
      this.paymentAudit.buildAppendQuery(this.db, {
        restaurantId: existing.restaurantId,
        paymentTransactionId: paymentId,
        eventType: PAYMENT_AUDIT_EVENT_TYPES.ATTEMPT,
        provider:
          options.actor.kind === "provider"
            ? options.actor.provider
            : (input.gateway ?? input.method ?? "internal"),
        // What moved, not what was priced: for an MYR cash payment the
        // audit trail must show the rounded figure the drawer received (#405).
        amount: collectableCents,
        currency,
        rawPayload: {
          orderId: input.orderId,
          paymentMode: input.paymentMode,
          paymentMethod: method,
          gateway: input.gateway ?? input.method ?? null,
          idempotencyKey: options.idempotencyKey ?? null,
          closeOrder: shouldCloseOrder,
          orderTotalCents: existing.totalAmountCents ?? 0,
          roundingAdjustmentCents,
        },
        occurredAtMs: now,
      }),
      ...this.prepareCloseOrderSideEffects(
        existing.tableId,
        shouldCloseOrder,
        now,
      ),
      this.preparePaymentTransactionStatusUpdate(paymentId, "paid", now),
      this.paymentAudit.buildAppendQuery(this.db, {
        restaurantId: existing.restaurantId,
        paymentTransactionId: paymentId,
        eventType: PAYMENT_AUDIT_EVENT_TYPES.SUCCESS,
        provider:
          options.actor.kind === "provider"
            ? options.actor.provider
            : (input.gateway ?? input.method ?? "internal"),
        // What moved, not what was priced: for an MYR cash payment the
        // audit trail must show the rounded figure the drawer received (#405).
        amount: collectableCents,
        currency,
        rawPayload: { status: "paid" },
        occurredAtMs: now,
      }),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

    if (shouldCloseOrder) {
      try {
        await finalizeOrderStatusSideEffects({
          env: this.env,
          order: {
            id: existing.id,
            restaurantId: existing.restaurantId,
            orderNumber: existing.orderNumber,
          },
          previousStatus: existing.status as OrderStatus,
          newStatus: "paid",
          updatedBy:
            options.actor.kind === "staff" ? options.actor.user.id : undefined,
          updatedByRole:
            options.actor.kind === "staff"
              ? roleName(options.actor.user.role)
              : "provider",
        });
      } catch (error) {
        console.error("Payment succeeded but order side effects failed", {
          orderId: existing.id,
          paymentId,
          error,
        });
      }
    } else {
      try {
        await invalidateOrderCache(this.env.CACHE_KV, input.orderId);
      } catch (error) {
        console.error("Payment succeeded but order cache invalidation failed", {
          orderId: input.orderId,
          paymentId,
          error,
        });
      }
    }

    return {
      status: 200,
      data: {
        paymentId,
        orderId: input.orderId,
        orderStatus: shouldCloseOrder ? "paid" : existing.status,
        paymentStatus: "completed",
        authorizedTotal: serverTotal,
        collectedTotal,
        roundingAdjustment: roundingAdjustmentCents / 100,
        currency,
        country,
      },
    };
  }

  /**
   * Record a rejected payment attempt (#350).
   *
   * Audit-only by necessity: `payment_transactions` gains its row inside the
   * batch at the end of `runPayment`, so a rejection never has a transaction
   * to mark `"failed"`. That status becomes writable only once a gateway
   * authorisation flow inserts a pending row up front, which this codebase
   * does not have — `processPayment` records a payment that already
   * succeeded rather than asking anyone to authorise one.
   *
   * Best-effort by construction: the caller must learn why the payment was
   * refused whether or not this write lands, so a failure here is logged and
   * swallowed and the original error is re-thrown by `processPayment`.
   *
   * The audit row traces every rejection; the owner alert is deliberately
   * narrower. `OWNER_ALERTED_PAYMENT_FAILURE_CODES` names the failures that
   * describe the restaurant's money rather than a caller's mistake, and the
   * two writes are separately guarded so a dead audit sink cannot also
   * silence the alert.
   */
  private async recordPaymentFailure(
    order: typeof orders.$inferSelect,
    input: PaymentRequestInput,
    options: ProcessPaymentOptions,
    attempt: PaymentAttemptContext,
    error: unknown,
  ): Promise<void> {
    const apiError = error instanceof ApiError ? error : null;
    const errorCode = apiError?.code ?? "UNEXPECTED_ERROR";
    const submittedAmount =
      input.paymentMode === "partial"
        ? (input.payments ?? []).reduce(
            (sum, payment) => sum + payment.amount,
            0,
          )
        : (input.amount ?? null);

    try {
      await this.paymentAudit.append({
        restaurantId: order.restaurantId,
        eventType: PAYMENT_AUDIT_EVENT_TYPES.FAILURE,
        provider: input.gateway ?? input.method ?? "internal",
        amount: order.totalAmountCents ?? null,
        // Only a currency the server resolved. A rejection before that point
        // (or of the claim itself) records none rather than the claim.
        currency: attempt.currency ?? null,
        errorCode,
        errorMessage: apiError?.message ?? "Payment failed before completion",
        // Deliberately not `options.customerInfo` or `options.metadata`: this
        // row exists to explain the refusal, not to copy the request.
        rawPayload: {
          orderId: input.orderId,
          paymentMode: input.paymentMode,
          submittedAmount,
          serverTotalCents: order.totalAmountCents ?? null,
          idempotencyKey: options.idempotencyKey ?? null,
        },
      });
    } catch (auditError) {
      console.error("Failed to record payment failure", {
        orderId: input.orderId,
        restaurantId: order.restaurantId,
        error: auditError,
      });
    }

    if (!OWNER_ALERTED_PAYMENT_FAILURE_CODES.has(errorCode)) return;

    try {
      await raisePaymentFailedAlert(this.env, {
        restaurantId: order.restaurantId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        errorCode,
        paymentMode: input.paymentMode,
        // Major units on both sides, so the owner reads the same figures the
        // order screen shows rather than cents.
        submittedAmount: submittedAmount ?? undefined,
        serverTotal: amountFromCents(order.totalAmountCents) ?? undefined,
        currency: attempt.currency,
      });
    } catch (alertError) {
      // The producer swallows its own failures; this guard is here so a future
      // one that does not cannot replace the rejection the caller must see.
      console.error("Failed to raise payment failure alert", {
        orderId: input.orderId,
        restaurantId: order.restaurantId,
        error: alertError,
      });
    }
  }

  private async findPaymentByIdempotencyKey(key: string) {
    return this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.idempotencyKey, key))
      .get();
  }

  private preparePaymentTransactionInsert(
    data: {
      transactionId: string;
      orderId: string;
      restaurantId: string;
      amountCents: number;
      roundingAdjustmentCents: number;
      currency: string | null;
      countryCode: string | null;
      paymentMethod: string;
      gateway: string | null;
      providerTransactionId: string | null;
      idempotencyKey: string | null;
      customerInfo: unknown | null;
      metadata: unknown | null;
    },
    now: number,
  ) {
    const timestamp = new Date(now);

    return this.db.insert(paymentTransactions).values({
      transactionId: data.transactionId,
      orderId: data.orderId,
      restaurantId: data.restaurantId,
      amountCents: data.amountCents,
      roundingAdjustmentCents: data.roundingAdjustmentCents,
      currency: data.currency,
      countryCode: data.countryCode,
      paymentMethod: data.paymentMethod,
      gateway: data.gateway,
      status: "pending",
      idempotencyKey: data.idempotencyKey,
      providerTransactionId: data.providerTransactionId,
      customerInfo: data.customerInfo,
      metadata: data.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private prepareOrderPaymentUpdate(
    orderId: string,
    paymentId: string,
    paymentMethod: string,
    shouldCloseOrder: boolean,
    now: number,
  ) {
    const paidAt = new Date(now);
    const updatedAt = new Date(now);
    const payableGuard = and(
      eq(orders.id, orderId),
      sql`COALESCE(${orders.paymentStatus}, 'pending') NOT IN ('paid', 'completed', 'refunded', 'partial_refunded')`,
      notInArray(orders.status, ["paid", "cancelled", "refunded"]),
    );

    if (shouldCloseOrder) {
      return this.db
        .update(orders)
        .set({
          // `status` and `paymentStatus` deliberately differ. "paid" is the
          // order's workflow state; "completed" is the canonical
          // OrderPaymentStatus. Writing "paid" into payment_status put a value
          // outside ORDER_PAYMENT_STATUSES into the column, and every read
          // through `toOrderPaymentStatus` then reported it as "pending" —
          // a genuinely paid order that the API said was unpaid (#311).
          status: "paid",
          paidAt,
          paymentStatus: "completed",
          paymentMethod,
          paymentTransactionId: paymentId,
          updatedAt,
        })
        .where(payableGuard);
    }

    return this.db
      .update(orders)
      .set({
        paymentStatus: "completed",
        paymentMethod,
        paymentTransactionId: paymentId,
        updatedAt,
      })
      .where(payableGuard);
  }

  private prepareCloseOrderSideEffects(
    tableId: number | null | undefined,
    shouldCloseOrder: boolean,
    now: number,
  ) {
    if (!shouldCloseOrder || !tableId) return [];

    return [
      this.db
        .update(tables)
        .set({
          isOccupied: false,
          currentOrderId: null,
          occupiedAt: null,
          occupiedBy: null,
          updatedAt: new Date(now),
        })
        .where(eq(tables.id, tableId)),
    ];
  }

  private preparePaymentTransactionStatusUpdate(
    transactionId: string,
    status: "paid" | "failed" | "cancelled",
    now: number,
  ) {
    const timestamp = new Date(now);

    return this.db
      .update(paymentTransactions)
      .set({
        status,
        updatedAt: timestamp,
        completedAt:
          status === "paid"
            ? timestamp
            : sql`${paymentTransactions.completedAt}`,
        failedAt:
          status === "failed"
            ? timestamp
            : sql`${paymentTransactions.failedAt}`,
      })
      .where(eq(paymentTransactions.transactionId, transactionId));
  }
}

function processPaymentResultFromRow(
  payment: typeof paymentTransactions.$inferSelect,
  order: { status: string },
): ProcessPaymentResult {
  const metadata = payment.metadata as { closeOrder?: unknown } | null;
  // payment_transactions.status speaks PAYMENT_TRANSACTION_STATUS ("paid");
  // the response's `paymentStatus` reports the *order's* payment status, which
  // is canonical OrderPaymentStatus ("completed"). Keep the two apart: the
  // 202/200 split and the orderStatus mirror both key off the transaction,
  // while the reported value must match what the live path answered, or an
  // idempotent retry would contradict the call it is replaying.
  const transactionStatus = payment.status;
  const closedOrder = metadata?.closeOrder !== false;
  // NOT NULL DEFAULT 0 in the schema, so this only guards a row read through
  // a type that predates the column — never a live D1 row.
  const roundingAdjustmentCents = payment.roundingAdjustmentCents ?? 0;

  return {
    status: transactionStatus === "pending" ? 202 : 200,
    data: {
      paymentId: payment.transactionId,
      orderId: payment.orderId,
      // Mirrors the live path's `shouldCloseOrder ? "paid" : existing.status`.
      // A payment that did not close its order left the order's own status
      // untouched, so that status is what the first response reported — not
      // the constant "pending", which was never one of its possible answers.
      orderStatus:
        closedOrder && transactionStatus === "paid" ? "paid" : order.status,
      paymentStatus:
        transactionStatus === "paid" ? "completed" : transactionStatus,
      // `amount_cents` is what was collected, which for an MYR cash payment
      // is the 5-sen-rounded figure rather than the order total. Back the
      // adjustment out so a replay reports the same authorized total the live
      // path did (#405).
      authorizedTotal:
        amountFromCents(payment.amountCents - roundingAdjustmentCents) ?? 0,
      collectedTotal: amountFromCents(payment.amountCents) ?? 0,
      roundingAdjustment: roundingAdjustmentCents / 100,
      currency: payment.currency ?? null,
      country: payment.countryCode ?? null,
    },
  };
}

/**
 * A full payment must present either the order total or, when the method
 * rounds, the amount that can actually be collected (#405). An MYR cash
 * payment for a RM10.33 order may be submitted as 10.33 or 10.35 and nothing
 * else — 10.34 is not money anyone can hand over, and 10.40 is a typo the
 * customer would pay for. The two are the same figure for every electronic
 * method and for TWD/VND, so this is the old exact check then.
 *
 * What gets recorded is the server's `collectableCents` either way; the
 * submitted figure is only ever checked.
 */
function assertCollectableAmount(
  actual: number,
  orderTotal: number,
  collectableTotal: number,
): void {
  const actualCents = cents(actual);
  if (
    actualCents === cents(orderTotal) ||
    actualCents === cents(collectableTotal)
  ) {
    return;
  }
  throw new ApiError(
    "PAYMENT_AMOUNT_MISMATCH",
    "Payment amount does not match order total",
    409,
    {
      expected: Number(orderTotal.toFixed(2)),
      // Only worth reporting when rounding actually moved the figure;
      // repeating `expected` would read as two different requirements.
      ...(collectableTotal !== orderTotal
        ? { expectedCollected: Number(collectableTotal.toFixed(2)) }
        : {}),
      actual: Number(actual.toFixed(2)),
    },
  );
}

/**
 * Split-payment lines are the one amount here a person types in: a full
 * payment and `expectedTotal` must equal the server's order total to the cent,
 * so they can never carry more precision than the total already has.
 *
 * Each line must sit on the currency's real step (whole dollars for TWD/VND,
 * cents for MYR) — "NT$85.50 cash + NT$85.50 card" is not money anyone can
 * hand over. The exception is an order total that is itself off-step: orders
 * priced before per-line rounding existed can total 17050 cents in TWD, and
 * refusing every split of those would leave them unpayable. Such a total
 * leaves exactly one line to absorb the odd remainder, so one off-step line is
 * allowed then and none otherwise; the sum check that follows pins that line's
 * remainder to the total's.
 */
function assertSplitPrecision(
  payments: ReadonlyArray<{ amount: number }>,
  totalCents: number,
  currency: CurrencyCode,
): void {
  const offStep = payments.filter(
    (payment) => !isCurrencyAlignedCents(cents(payment.amount), currency),
  ).length;
  const allowed = isCurrencyAlignedCents(totalCents, currency) ? 0 : 1;
  if (offStep > allowed) {
    throw new ApiError(
      "AMOUNT_PRECISION_INVALID",
      `Payment amounts must match the precision of ${currency}`,
      400,
      { currency },
    );
  }
}

function canProcessPayment(role: number): boolean {
  return [0, 1, 4].includes(role);
}

function isPaymentActor(actor: unknown): actor is PaymentActor {
  if (!actor || typeof actor !== "object" || !("kind" in actor)) return false;

  if (actor.kind === "staff") {
    return "user" in actor && Boolean(actor.user);
  }

  return (
    actor.kind === "provider" &&
    "provider" in actor &&
    typeof actor.provider === "string" &&
    actor.provider.trim().length > 0 &&
    "providerTransactionId" in actor &&
    typeof actor.providerTransactionId === "string" &&
    actor.providerTransactionId.trim().length > 0
  );
}

function isAlreadyFinalized(
  orderStatus: string | null | undefined,
  paymentStatus: string | null | undefined,
): boolean {
  return (
    ["cancelled", "paid", "refunded"].includes(orderStatus ?? "") ||
    ["paid", "completed", "refunded", "partial_refunded"].includes(
      paymentStatus ?? "",
    )
  );
}

function mutationChanges(result: unknown): number {
  const meta = (result as { meta?: { changes?: unknown } } | null)?.meta;
  return typeof meta?.changes === "number" ? meta.changes : 0;
}

function roleName(role: number | undefined): string {
  switch (role) {
    case 0:
      return "admin";
    case 1:
      return "owner";
    case 4:
      return "cashier";
    default:
      return "system";
  }
}
