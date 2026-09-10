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

export interface ProcessPaymentOptions {
  user?: AuthUser;
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
    authorizedTotal: number;
  };
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
    options: ProcessPaymentOptions = {},
  ): Promise<ProcessPaymentResult> {
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

    try {
      return await this.runPayment(input, options, existing);
    } catch (error) {
      await this.recordPaymentFailure(existing, input, options, error);
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
  ): Promise<ProcessPaymentResult> {
    if (
      options.user?.restaurantId &&
      options.user.role !== 0 &&
      String(options.user.restaurantId) !== String(existing.restaurantId)
    ) {
      throw new ApiError("FORBIDDEN", "Access denied", 403);
    }

    if (options.user && !canProcessPayment(options.user.role)) {
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

    const serverTotal = amountFromCents(existing.totalAmountCents) ?? 0;
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
      assertSameAmount(
        input.amount ?? 0,
        serverTotal,
        "PAYMENT_AMOUNT_MISMATCH",
        "Payment amount does not match order total",
      );
    }

    const paymentId = `pay_${input.orderId}_${Date.now()}`;
    const method =
      input.paymentMode === "partial"
        ? "split"
        : (input.method ?? input.gateway ?? "other");
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
          amountCents: cents(serverTotal),
          currency: options.currency ?? null,
          countryCode: options.country ?? null,
          paymentMethod: method,
          gateway: input.gateway ?? input.method ?? null,
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
        provider: input.gateway ?? input.method ?? "internal",
        amount: cents(serverTotal),
        currency: options.currency ?? null,
        rawPayload: {
          orderId: input.orderId,
          paymentMode: input.paymentMode,
          paymentMethod: method,
          gateway: input.gateway ?? input.method ?? null,
          idempotencyKey: options.idempotencyKey ?? null,
          closeOrder: shouldCloseOrder,
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
        provider: input.gateway ?? input.method ?? "internal",
        amount: cents(serverTotal),
        currency: options.currency ?? null,
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
          updatedBy: options.user?.id,
          updatedByRole: roleName(options.user?.role),
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
        currency: options.currency ?? null,
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
        currency: options.currency,
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
      currency: string | null;
      countryCode: string | null;
      paymentMethod: string;
      gateway: string | null;
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
      currency: data.currency,
      countryCode: data.countryCode,
      paymentMethod: data.paymentMethod,
      gateway: data.gateway,
      status: "pending",
      idempotencyKey: data.idempotencyKey,
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
      authorizedTotal: amountFromCents(payment.amountCents) ?? 0,
    },
  };
}

function canProcessPayment(role: number): boolean {
  return [0, 1, 4].includes(role);
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
