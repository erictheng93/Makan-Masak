import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, lte, or, sql } from "drizzle-orm";
import {
  PAYMENT_AUDIT_EVENT_TYPES,
  marketCheckoutPayments,
  marketCheckoutSessions,
} from "@makanmasak/database";
import type { Env } from "../../../types/env";
import { ApiError } from "../../../shared/utils/api-error";
import {
  verifyProviderMoney,
  type ProviderMoneyIssue,
} from "../../../shared/utils/provider-money";
import { PaymentAuditService } from "../../billing/services/PaymentAuditService";
import type {
  MarketCheckoutProviderSplitStatusInput,
  MarketCheckoutProviderSplitStatusResult,
  MarketCheckoutSplitMode,
} from "./MarketCheckoutPaymentProvider";
import { redeemCachedMarketCheckoutVoucher } from "./MarketCheckoutVoucherService";
import {
  MARKET_CHECKOUT_ORDER_PAYMENT_METHOD,
  settleMarketCheckoutChildOrdersPaid,
  settleMarketCheckoutChildOrdersRefunded,
} from "./MarketCheckoutChildOrderSettlement";

const MARKET_CHECKOUT_INDEX_KEY = "market_checkout:index";

type MarketCheckoutReconciliationStatus =
  | "paid"
  | "pending"
  | "failed"
  | "refunded"
  | "partial_refunded";

interface MarketCheckoutPaymentRow {
  payment_id: string;
  checkout_id: string;
  market_id: string;
  provider: string;
  split_mode: MarketCheckoutSplitMode;
  idempotency_key: string | null;
  status: string;
  amount_cents: number;
  paid_amount_cents: number;
  refunded_amount_cents: number;
  currency: string | null;
  country_code: string | null;
  child_payment_ids: string | string[] | null;
  provider_transaction_id: string | null;
  provider_payload: string | Record<string, unknown> | null;
  created_at_ms: number | Date;
  updated_at_ms: number | Date;
  session_payment_summary: string | Record<string, unknown> | null;
}

export interface MarketCheckoutPaymentReconciliationResult {
  provider: string;
  checkoutId: string;
  paymentId: string;
  status: MarketCheckoutReconciliationStatus;
  providerTransactionId?: string;
  eventId?: string;
  eventType: string;
  /**
   * The provider's status came with money that does not match the payment
   * (see MarketCheckoutPaymentWebhookService). Nothing was applied; `status`
   * is the payment's unchanged status.
   */
  reviewRequired?: boolean;
  reviewReason?: ProviderMoneyIssue["code"];
}

export class MarketCheckoutPaymentReconciliationService {
  private readonly db: ReturnType<typeof drizzle>;
  private readonly lookupRows = new Map<string, MarketCheckoutPaymentRow>();

  constructor(private readonly env: Env) {
    this.db = drizzle(env.DB);
  }

  async getStatusLookupInput(
    checkoutId: string,
  ): Promise<MarketCheckoutProviderSplitStatusInput> {
    const row = await this.findPayment(checkoutId);
    if (!row) {
      throw new ApiError(
        "MARKET_CHECKOUT_PAYMENT_NOT_FOUND",
        "Market checkout payment not found for reconciliation",
        404,
      );
    }
    if (row.split_mode !== "provider_split") {
      throw new ApiError(
        "MARKET_CHECKOUT_RECONCILIATION_UNSUPPORTED",
        "Only provider split market checkout payments can be reconciled through the provider status endpoint",
        400,
      );
    }
    this.lookupRows.set(checkoutId, row);

    return {
      checkoutId: row.checkout_id,
      paymentId: row.payment_id,
      provider: row.provider,
      providerTransactionId: row.provider_transaction_id ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      amountCents: row.amount_cents,
      currency: row.currency ?? undefined,
      country: row.country_code ?? undefined,
    };
  }

  async listPendingStatusLookupInputs(input: {
    updatedBeforeMs: number;
    limit: number;
  }): Promise<MarketCheckoutProviderSplitStatusInput[]> {
    const rows = await this.db
      .select(marketCheckoutPaymentRowSelection)
      .from(marketCheckoutPayments)
      .innerJoin(
        marketCheckoutSessions,
        eq(marketCheckoutSessions.id, marketCheckoutPayments.checkoutId),
      )
      .where(
        and(
          eq(marketCheckoutPayments.splitMode, "provider_split"),
          or(
            eq(marketCheckoutPayments.status, "pending"),
            sql`json_extract(${marketCheckoutPayments.providerPayload}, '$.lastRefund.status') = 'pending'`,
          ),
          lte(
            marketCheckoutPayments.updatedAt,
            new Date(input.updatedBeforeMs),
          ),
        ),
      )
      .orderBy(marketCheckoutPayments.updatedAt)
      .limit(input.limit)
      .all();

    return rows.map((row) => {
      this.lookupRows.set(row.checkout_id, row);
      return {
        checkoutId: row.checkout_id,
        paymentId: row.payment_id,
        provider: row.provider,
        providerTransactionId: row.provider_transaction_id ?? undefined,
        idempotencyKey: row.idempotency_key ?? undefined,
        amountCents: row.amount_cents,
        currency: row.currency ?? undefined,
        country: row.country_code ?? undefined,
      };
    });
  }

  async reconcile(
    checkoutId: string,
    providerStatus: MarketCheckoutProviderSplitStatusResult,
  ): Promise<MarketCheckoutPaymentReconciliationResult> {
    const row =
      this.lookupRows.get(checkoutId) ?? (await this.findPayment(checkoutId));
    if (!row) {
      throw new ApiError(
        "MARKET_CHECKOUT_PAYMENT_NOT_FOUND",
        "Market checkout payment not found for reconciliation",
        404,
      );
    }
    if (row.split_mode !== "provider_split") {
      throw new ApiError(
        "MARKET_CHECKOUT_RECONCILIATION_UNSUPPORTED",
        "Only provider split market checkout payments can be reconciled through the provider status endpoint",
        400,
      );
    }
    if (providerStatus.provider !== row.provider) {
      throw new ApiError(
        "MARKET_CHECKOUT_RECONCILIATION_PROVIDER_MISMATCH",
        "Provider status response does not match the stored market checkout payment provider",
        409,
      );
    }

    const now = Date.now();
    const settlement = settleReconciledMoney(row, providerStatus);
    if (!settlement.ok) {
      return this.holdForReview(row, providerStatus, settlement, now);
    }
    const { status, paidAmountCents, refundedAmountCents } = settlement;
    const providerTransactionId =
      providerStatus.providerTransactionId ?? row.provider_transaction_id;
    const eventType =
      providerStatus.eventType ?? `market_checkout.payment_${status}`;
    const providerPayload = mergeProviderPayload(row.provider_payload, {
      lastReconciliation: {
        provider: providerStatus.provider,
        eventId: providerStatus.eventId,
        eventType,
        status,
        receivedAt: new Date(now).toISOString(),
        payload: providerStatus.providerPayload ?? providerStatus,
      },
    });

    const nowDate = new Date(now);
    await this.db
      .update(marketCheckoutPayments)
      .set({
        status,
        paidAmountCents,
        refundedAmountCents,
        providerTransactionId:
          providerTransactionId == null
            ? sql`${marketCheckoutPayments.providerTransactionId}`
            : providerTransactionId,
        providerPayload,
        updatedAt: nowDate,
        // `now`, not `nowDate`. A value interpolated into a `sql` fragment is
        // bound with no encoder — drizzle attaches the column's mapper only
        // through the operator helpers and through a plain `.set()` value like
        // `updatedAt` above — so a `Date` here reached D1 as an object and
        // failed this entire UPDATE with `D1_TYPE_ERROR`, taking every paid and
        // failed settlement with it (#365). These columns are
        // `{ mode: "timestamp_ms" }`, so the fragment binds the epoch
        // milliseconds the mapper would have produced.
        completedAt:
          status === "paid"
            ? sql`COALESCE(${marketCheckoutPayments.completedAt}, ${now})`
            : sql`${marketCheckoutPayments.completedAt}`,
        refundedAt:
          status === "refunded" || status === "partial_refunded"
            ? nowDate
            : sql`${marketCheckoutPayments.refundedAt}`,
        failedAt:
          status === "failed"
            ? sql`COALESCE(${marketCheckoutPayments.failedAt}, ${now})`
            : sql`${marketCheckoutPayments.failedAt}`,
      })
      .where(eq(marketCheckoutPayments.paymentId, row.payment_id))
      .run();

    const paymentSummary = updatePaymentSummary(row, {
      status,
      providerTransactionId,
      paidAmountCents,
      refundedAmountCents,
      updatedAtMs: now,
    });

    await this.db
      .update(marketCheckoutSessions)
      .set({
        paymentStatus: status,
        paymentSummary,
        updatedAt: nowDate,
      })
      .where(eq(marketCheckoutSessions.id, row.checkout_id))
      .run();

    await Promise.all([
      this.updateCachedSession(row.checkout_id, paymentSummary),
      this.updateCachedIndex(row.checkout_id, status),
    ]);
    // Idempotent against a webhook that already settled these child orders,
    // which is the ordinary case for a reconciliation run: the transaction id
    // is derived from (checkout, order), so both paths write the same row.
    if (status === "paid") {
      await settleMarketCheckoutChildOrdersPaid(this.env, {
        checkoutId: row.checkout_id,
        marketCheckoutPaymentId: row.payment_id,
        paymentMethod: MARKET_CHECKOUT_ORDER_PAYMENT_METHOD,
        gateway: row.provider,
        currency: row.currency,
        country: row.country_code,
        chargedTotalCents: row.amount_cents,
        providerTransactionId,
        nowMs: now,
      });
      await redeemCachedMarketCheckoutVoucher(this.env, row.checkout_id);
    } else if (status === "refunded" || status === "partial_refunded") {
      await settleMarketCheckoutChildOrdersRefunded(this.env, {
        checkoutId: row.checkout_id,
        status,
        nowMs: now,
      });
    }

    return {
      provider: row.provider,
      checkoutId: row.checkout_id,
      paymentId: row.payment_id,
      status,
      providerTransactionId: providerTransactionId ?? undefined,
      eventId: providerStatus.eventId,
      eventType,
    };
  }

  /**
   * Record a status lookup whose money does not match the payment without
   * applying it: `lastReconciliation.status = "review_required"` (raises the
   * provider_amount_mismatch alert) plus a `failure` payment audit row.
   */
  private async holdForReview(
    row: MarketCheckoutPaymentRow,
    providerStatus: MarketCheckoutProviderSplitStatusResult,
    rejection: ReconciledMoneyRejection,
    now: number,
  ): Promise<MarketCheckoutPaymentReconciliationResult> {
    const eventType =
      providerStatus.eventType ??
      `market_checkout.payment_${providerStatus.status}`;
    await new PaymentAuditService(this.env.DB).append({
      paymentTransactionId: row.payment_id,
      eventType: PAYMENT_AUDIT_EVENT_TYPES.FAILURE,
      provider: providerStatus.provider,
      providerEventId: providerStatus.eventId
        ? `${providerStatus.eventId}:review`
        : null,
      providerEventType: eventType,
      amount: rejection.reportedCents ?? null,
      currency: providerStatus.currency ?? null,
      rawPayload: {
        checkoutId: row.checkout_id,
        source: "status_lookup",
        requestedStatus: providerStatus.status,
        expectedAmountCents: rejection.expectedCents,
        expectedCurrency: row.currency,
        reportedAmountCents: rejection.reportedCents ?? null,
        reportedCurrency: providerStatus.currency ?? null,
      },
      errorCode: `MARKET_CHECKOUT_RECONCILIATION_${rejection.issue.code}`,
      errorMessage: rejection.issue.message,
    });

    await this.db
      .update(marketCheckoutPayments)
      .set({
        providerPayload: mergeProviderPayload(row.provider_payload, {
          lastReconciliation: {
            provider: providerStatus.provider,
            eventId: providerStatus.eventId,
            eventType,
            status: "review_required",
            requestedStatus: providerStatus.status,
            reviewReason: rejection.issue.code,
            reviewMessage: rejection.issue.message,
            receivedAt: new Date(now).toISOString(),
            payload: providerStatus.providerPayload ?? providerStatus,
          },
        }),
        updatedAt: new Date(now),
      })
      .where(eq(marketCheckoutPayments.paymentId, row.payment_id))
      .run();

    return {
      provider: row.provider,
      checkoutId: row.checkout_id,
      paymentId: row.payment_id,
      status: row.status as MarketCheckoutReconciliationStatus,
      providerTransactionId: row.provider_transaction_id ?? undefined,
      eventId: providerStatus.eventId,
      eventType,
      reviewRequired: true,
      reviewReason: rejection.issue.code,
    };
  }

  private async findPayment(checkoutId: string) {
    return this.db
      .select(marketCheckoutPaymentRowSelection)
      .from(marketCheckoutPayments)
      .innerJoin(
        marketCheckoutSessions,
        eq(marketCheckoutSessions.id, marketCheckoutPayments.checkoutId),
      )
      .where(eq(marketCheckoutPayments.checkoutId, checkoutId))
      .orderBy(desc(marketCheckoutPayments.updatedAt))
      .limit(1)
      .get();
  }

  private async updateCachedSession(
    checkoutId: string,
    paymentSummary: Record<string, unknown>,
  ) {
    const key = `market_checkout:${checkoutId}`;
    const stored = await this.env.CACHE_KV.get(key);
    if (!stored) return;

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    await this.env.CACHE_KV.put(
      key,
      JSON.stringify({
        ...parsed,
        payment: paymentSummary,
      }),
      { expirationTtl: 4 * 60 * 60 },
    );
  }

  private async updateCachedIndex(
    checkoutId: string,
    paymentStatus: MarketCheckoutReconciliationStatus,
  ) {
    const stored = await this.env.CACHE_KV.get(MARKET_CHECKOUT_INDEX_KEY);
    if (!stored) return;

    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return;

    const updatedAt = new Date().toISOString();
    const nextIndex = parsed.map((item) => {
      if (!item || typeof item !== "object") return item;
      const checkout = item as Record<string, unknown>;
      if (checkout.id !== checkoutId) return item;

      return {
        ...checkout,
        paymentStatus,
        updatedAt,
      };
    });

    await this.env.CACHE_KV.put(
      MARKET_CHECKOUT_INDEX_KEY,
      JSON.stringify(nextIndex),
      { expirationTtl: 4 * 60 * 60 },
    );
  }
}

const marketCheckoutPaymentRowSelection = {
  payment_id: marketCheckoutPayments.paymentId,
  checkout_id: marketCheckoutPayments.checkoutId,
  market_id: marketCheckoutPayments.marketId,
  provider: marketCheckoutPayments.provider,
  split_mode: marketCheckoutPayments.splitMode,
  idempotency_key: marketCheckoutPayments.idempotencyKey,
  status: marketCheckoutPayments.status,
  amount_cents: marketCheckoutPayments.amountCents,
  paid_amount_cents: marketCheckoutPayments.paidAmountCents,
  refunded_amount_cents: marketCheckoutPayments.refundedAmountCents,
  currency: marketCheckoutPayments.currency,
  country_code: marketCheckoutPayments.countryCode,
  child_payment_ids: sql<
    string | null
  >`${marketCheckoutPayments.childPaymentIds}`,
  provider_transaction_id: marketCheckoutPayments.providerTransactionId,
  provider_payload: sql<
    string | null
  >`${marketCheckoutPayments.providerPayload}`,
  created_at_ms: marketCheckoutPayments.createdAt,
  updated_at_ms: marketCheckoutPayments.updatedAt,
  session_payment_summary: sql<
    string | null
  >`${marketCheckoutSessions.paymentSummary}`,
};

interface ReconciledMoneySettlement {
  ok: true;
  status: MarketCheckoutReconciliationStatus;
  paidAmountCents: number;
  refundedAmountCents: number;
}

interface ReconciledMoneyRejection {
  ok: false;
  issue: ProviderMoneyIssue;
  expectedCents: number;
  reportedCents?: number;
}

/**
 * Same rules as the webhook: a paid status must report exactly the row's
 * amount in the row's currency (the adapter contract's `amountReceivedCents`
 * is internal cents); a refund status must report a refunded amount no larger
 * than what was paid, and the amount decides refunded vs partial_refunded.
 */
function settleReconciledMoney(
  row: MarketCheckoutPaymentRow,
  providerStatus: MarketCheckoutProviderSplitStatusResult,
): ReconciledMoneySettlement | ReconciledMoneyRejection {
  const status = providerStatus.status;
  if (status === "pending" || status === "failed") {
    return {
      ok: true,
      status,
      paidAmountCents: row.paid_amount_cents,
      refundedAmountCents: row.refunded_amount_cents,
    };
  }

  if (status === "paid") {
    const issue = verifyProviderMoney({
      expectedCents: row.amount_cents,
      expectedCurrency: row.currency,
      receivedCents: providerStatus.amountReceivedCents,
      receivedCurrency: providerStatus.currency,
    });
    return issue
      ? {
          ok: false,
          issue,
          expectedCents: row.amount_cents,
          reportedCents: providerStatus.amountReceivedCents,
        }
      : {
          ok: true,
          status,
          paidAmountCents: row.amount_cents,
          refundedAmountCents: row.refunded_amount_cents,
        };
  }

  const paidCents =
    row.paid_amount_cents > 0 ? row.paid_amount_cents : row.amount_cents;
  const refunded = providerStatus.amountRefundedCents;
  const issue =
    verifyProviderMoney({
      expectedCents: paidCents,
      expectedCurrency: row.currency,
      receivedCents: refunded,
      receivedCurrency: providerStatus.currency,
      mode: "at_most",
    }) ??
    (refunded === undefined || refunded <= 0
      ? {
          code: "AMOUNT_MISMATCH" as const,
          message: "Provider reported a refund of nothing",
        }
      : null);
  if (issue || refunded === undefined) {
    return {
      ok: false,
      issue: issue ?? {
        code: "AMOUNT_MISSING",
        message: "Provider did not report an amount",
      },
      expectedCents: paidCents,
      reportedCents: refunded,
    };
  }
  return {
    ok: true,
    status: refunded === paidCents ? "refunded" : "partial_refunded",
    paidAmountCents: paidCents,
    refundedAmountCents: refunded,
  };
}

function updatePaymentSummary(
  row: MarketCheckoutPaymentRow,
  input: {
    status: MarketCheckoutReconciliationStatus;
    providerTransactionId?: string | null;
    paidAmountCents: number;
    refundedAmountCents: number;
    updatedAtMs: number;
  },
) {
  const existing = parsePaymentSummary(row.session_payment_summary);
  const updatedAt = new Date(input.updatedAtMs).toISOString();
  const childPaymentIds = parseJsonStringArray(row.child_payment_ids);
  const payment = {
    ...existing,
    status: input.status,
    method: existing.method ?? row.provider,
    // The payment row is the record of what was charged; a summary without
    // one keeps whatever it had rather than inventing TWD.
    currency: row.currency ?? existing.currency,
    country: existing.country ?? row.country_code ?? "TW",
    totalAmount: row.amount_cents / 100,
    totalAmountCents: row.amount_cents,
    paidAmount: input.paidAmountCents / 100,
    paidAmountCents: input.paidAmountCents,
    refundedAmount: input.refundedAmountCents / 100,
    refundedAmountCents: input.refundedAmountCents,
    childPayments: Array.isArray(existing.childPayments)
      ? existing.childPayments
      : [],
    parentPayment: {
      ...(typeof existing.parentPayment === "object" &&
      existing.parentPayment !== null
        ? existing.parentPayment
        : {}),
      paymentId: row.payment_id,
      status: input.status,
      provider: row.provider,
      splitMode: row.split_mode,
      idempotencyKey:
        row.idempotency_key ?? `market-checkout:${row.checkout_id}`,
      providerTransactionId:
        input.providerTransactionId ?? row.provider_transaction_id ?? undefined,
      amountCents: row.amount_cents,
      paidAmountCents: input.paidAmountCents,
      refundedAmountCents: input.refundedAmountCents,
      childPaymentIds,
      createdAt: new Date(row.created_at_ms).toISOString(),
      updatedAt,
    },
  };

  if (input.status === "paid") {
    return { ...payment, paidAt: existing.paidAt ?? updatedAt };
  }
  if (input.status === "failed") {
    return { ...payment, failedAt: updatedAt };
  }
  if (input.status === "refunded" || input.status === "partial_refunded") {
    return { ...payment, refundedAt: updatedAt };
  }

  return payment;
}

function parsePaymentSummary(
  value: MarketCheckoutPaymentRow["session_payment_summary"],
) {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === "object") return value;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mergeProviderPayload(
  rawPayload: string | Record<string, unknown> | null,
  patch: Record<string, unknown>,
) {
  if (!rawPayload) return patch;
  if (typeof rawPayload === "object") return { ...rawPayload, ...patch };

  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    return parsed && typeof parsed === "object"
      ? { ...(parsed as Record<string, unknown>), ...patch }
      : patch;
  } catch {
    return patch;
  }
}

function parseJsonStringArray(
  value: string | string[] | null | undefined,
): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
