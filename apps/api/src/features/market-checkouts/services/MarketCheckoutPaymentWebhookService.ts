import { drizzle } from "drizzle-orm/d1";
import { desc, eq, or, sql } from "drizzle-orm";
import {
  PAYMENT_AUDIT_EVENT_TYPES,
  marketCheckoutChildOrders,
  marketCheckoutPayments,
  marketCheckoutSessions,
} from "@makanmasak/database";
import type { Env } from "../../../types/env";
import { ApiError } from "../../../shared/utils/api-error";
import { timingSafeEqual } from "../../../shared/utils/timing-safe-equal";
import { PaymentAuditService } from "../../billing/services/PaymentAuditService";
import {
  providerAmountToCents,
  verifyProviderMoney,
  type ProviderMoneyIssue,
} from "../../../shared/utils/provider-money";
import type { MarketCheckoutSplitMode } from "./MarketCheckoutPaymentProvider";
import { redeemCachedMarketCheckoutVoucher } from "./MarketCheckoutVoucherService";
import {
  MARKET_CHECKOUT_ORDER_PAYMENT_METHOD,
  settleMarketCheckoutChildOrdersPaid,
  settleMarketCheckoutChildOrdersRefunded,
} from "./MarketCheckoutChildOrderSettlement";
import { normalizeCurrencyCode } from "@makanmasak/utils";
import { resolveDisplaySharedRestaurantCurrency } from "../../../shared/utils/restaurant-currency";

const MARKET_CHECKOUT_INDEX_KEY = "market_checkout:index";

type MarketCheckoutWebhookStatus =
  | "paid"
  | "failed"
  | "refunded"
  | "partial_refunded";

/**
 * What arrives at `POST /market-checkouts/payment-webhooks/:provider`.
 *
 * Three shapes are accepted, and the route's `:provider` decides the unit of
 * every provider-native amount field (see `shared/utils/provider-money.ts`):
 *
 * - Stripe events (`payment_intent.succeeded`, `charge.refunded`, ...):
 *   `data.object.amount_received` / `amount_refunded` in Stripe's smallest
 *   unit — for VND that is the whole dong, not cents.
 * - LINE Pay confirm results forwarded by the adapter: `returnCode`,
 *   `info.transactionId`, `info.payInfo[].amount` in whole TWD, plus the
 *   `currency` the adapter sent in its confirm request (the confirm response
 *   itself carries none).
 * - Generic adapter events (`market_checkout.payment_*`): amounts in our
 *   internal cents for every currency.
 *
 * `amount_cents` / `refunded_amount_cents` are always internal cents, whatever
 * the provider.
 */
interface MarketCheckoutWebhookPayload {
  id?: string;
  type?: string;
  status?: string;
  amount?: number;
  amount_cents?: number;
  amount_received?: number;
  amount_refunded?: number;
  refunded_amount_cents?: number;
  currency?: string;
  returnCode?: string;
  returnMessage?: string;
  info?: {
    orderId?: string;
    transactionId?: string | number;
    currency?: string;
    payInfo?: Array<{ method?: string; amount?: number }>;
  };
  data?: {
    object?: {
      id?: string;
      object?: string;
      status?: string;
      amount?: number;
      amount_received?: number;
      amount_refunded?: number;
      currency?: string;
      payment_intent?: string | null;
      metadata?: Record<string, unknown>;
    };
  };
  metadata?: Record<string, unknown>;
}

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

export interface MarketCheckoutPaymentWebhookResult {
  provider: string;
  eventId: string | null;
  eventType: string;
  duplicate: boolean;
  reconciled: boolean;
  checkoutId?: string;
  paymentId?: string;
  status?: MarketCheckoutWebhookStatus;
  /**
   * The provider reported money that does not match the payment row (wrong
   * amount, wrong currency, or none at all). The row keeps its status, the
   * event is recorded for review, and the request still answers 2xx so the
   * provider stops redelivering an event that can never apply cleanly.
   */
  reviewRequired?: boolean;
  reviewReason?: ProviderMoneyIssue["code"];
}

export class MarketCheckoutPaymentWebhookService {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(private readonly env: Env) {
    this.db = drizzle(env.DB);
  }

  async handle(
    provider: string,
    rawBody: string,
    headers: Headers,
  ): Promise<MarketCheckoutPaymentWebhookResult> {
    await this.verifySignature(provider, rawBody, headers);

    const payload = JSON.parse(rawBody) as MarketCheckoutWebhookPayload;
    // LINE Pay transaction ids are 19 digits — past 2^53, so JSON.parse has
    // already rounded a numeric one. Recover the digits from the raw body.
    const linePayTransactionId = linePayTransactionIdFrom(payload, rawBody);
    const eventId = eventIdFrom(payload, headers, linePayTransactionId);
    const eventType = eventTypeFrom(payload, headers);
    let status = statusFrom(payload, eventType);
    if (!status) {
      return {
        provider,
        eventId,
        eventType,
        duplicate: false,
        reconciled: false,
      };
    }

    const identifiers = identifiersFrom(payload, headers, linePayTransactionId);
    const audit = await new PaymentAuditService(this.env.DB).append({
      paymentTransactionId: identifiers.paymentId,
      eventType: PAYMENT_AUDIT_EVENT_TYPES.WEBHOOK_RECEIVED,
      provider,
      providerEventId: eventId,
      providerEventType: eventType,
      rawPayload: payload,
    });
    if (!audit.inserted) {
      return {
        provider,
        eventId,
        eventType,
        duplicate: true,
        reconciled: false,
      };
    }

    const row = await this.findPayment(identifiers);
    if (!row) {
      throw new ApiError(
        "MARKET_CHECKOUT_PAYMENT_NOT_FOUND",
        "Market checkout payment not found for webhook event",
        404,
      );
    }

    const now = Date.now();
    const settlement = settleWebhookMoney(provider, payload, row, status);
    if (!settlement.ok) {
      await this.holdForReview({
        provider,
        eventId,
        eventType,
        requestedStatus: status,
        payload,
        row,
        settlement,
        now,
      });
      return {
        provider,
        eventId,
        eventType,
        duplicate: false,
        reconciled: false,
        checkoutId: row.checkout_id,
        paymentId: row.payment_id,
        reviewRequired: true,
        reviewReason: settlement.issue.code,
      };
    }
    status = settlement.status;
    const amounts = settlement;
    const providerTransactionId =
      identifiers.providerTransactionId ?? row.provider_transaction_id;
    const providerPayload = mergeProviderPayload(row.provider_payload, {
      lastWebhook: {
        provider,
        eventId,
        eventType,
        status,
        receivedAt: new Date(now).toISOString(),
        payload,
      },
    });

    const nowDate = new Date(now);
    await this.db
      .update(marketCheckoutPayments)
      .set({
        status,
        paidAmountCents: amounts.paidAmountCents,
        refundedAmountCents: amounts.refundedAmountCents,
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
      provider,
      providerTransactionId,
      paidAmountCents: amounts.paidAmountCents,
      refundedAmountCents: amounts.refundedAmountCents,
      updatedAtMs: now,
      // The summary is a display record, and a hard-coded "TWD" here labelled
      // an MYR checkout in NT$ for anyone reading it afterwards. Rows written
      // before the currency column are the only ones that need this, so the
      // extra read is paid only by them.
      fallbackCurrency: await this.displayCurrencyForRow(row),
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
    // The vendors' own orders, not just the aggregate payment: without this a
    // fully paid checkout still read `payment_status = 'pending'` on every
    // kitchen display and vendor dashboard.
    if (status === "paid") {
      await settleMarketCheckoutChildOrdersPaid(this.env, {
        checkoutId: row.checkout_id,
        marketCheckoutPaymentId: row.payment_id,
        paymentMethod: MARKET_CHECKOUT_ORDER_PAYMENT_METHOD,
        gateway: row.provider || provider,
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
      provider,
      eventId,
      eventType,
      duplicate: false,
      reconciled: true,
      checkoutId: row.checkout_id,
      paymentId: row.payment_id,
      status,
    };
  }

  /**
   * The currency to label a legacy payment summary with when neither the
   * payment row nor the stored summary carries one: the vendors', read
   * leniently. This is a webhook writing a display record, so it must not be
   * able to fail the reconciliation — a deleted vendor or one broken
   * `settings.currency` falls back to the platform default rather than
   * leaving a paid checkout unreconciled.
   */
  private async displayCurrencyForRow(
    row: MarketCheckoutPaymentRow,
  ): Promise<string> {
    const recorded =
      normalizeCurrencyCode(row.currency) ??
      normalizeCurrencyCode(
        parsePaymentSummary(row.session_payment_summary).currency,
      );
    if (recorded) return recorded;

    const children = await this.db
      .select({ restaurantId: marketCheckoutChildOrders.restaurantId })
      .from(marketCheckoutChildOrders)
      .where(eq(marketCheckoutChildOrders.checkoutId, row.checkout_id))
      .all();
    return resolveDisplaySharedRestaurantCurrency(
      this.env.DB,
      children.map((child) => child.restaurantId),
    );
  }

  /**
   * Record a webhook whose money does not match the payment row, without
   * applying it: the payment keeps its status and amounts, `lastWebhook`
   * carries `status: "review_required"` (which raises the
   * `provider_amount_mismatch` operation alert), and a `failure` row lands in
   * the payment audit log with what was reported and what was expected.
   */
  private async holdForReview(input: {
    provider: string;
    eventId: string | null;
    eventType: string;
    requestedStatus: MarketCheckoutWebhookStatus;
    payload: MarketCheckoutWebhookPayload;
    row: MarketCheckoutPaymentRow;
    settlement: WebhookMoneyRejection;
    now: number;
  }) {
    const { issue } = input.settlement;
    await new PaymentAuditService(this.env.DB).append({
      paymentTransactionId: input.row.payment_id,
      eventType: PAYMENT_AUDIT_EVENT_TYPES.FAILURE,
      provider: input.provider,
      // The received event already owns (provider, eventId) in the unique
      // index, so the review row needs its own key.
      providerEventId: input.eventId ? `${input.eventId}:review` : null,
      providerEventType: input.eventType,
      amount: input.settlement.reportedCents ?? null,
      currency:
        typeof input.settlement.reportedCurrency === "string"
          ? input.settlement.reportedCurrency
          : null,
      rawPayload: {
        checkoutId: input.row.checkout_id,
        requestedStatus: input.requestedStatus,
        expectedAmountCents: input.settlement.expectedCents,
        expectedCurrency: input.row.currency,
        reportedAmountCents: input.settlement.reportedCents ?? null,
        reportedCurrency: input.settlement.reportedCurrency ?? null,
      },
      errorCode: `MARKET_CHECKOUT_WEBHOOK_${issue.code}`,
      errorMessage: issue.message,
    });

    await this.db
      .update(marketCheckoutPayments)
      .set({
        providerPayload: mergeProviderPayload(input.row.provider_payload, {
          lastWebhook: {
            provider: input.provider,
            eventId: input.eventId,
            eventType: input.eventType,
            status: "review_required",
            requestedStatus: input.requestedStatus,
            reviewReason: issue.code,
            reviewMessage: issue.message,
            receivedAt: new Date(input.now).toISOString(),
            payload: input.payload,
          },
        }),
        updatedAt: new Date(input.now),
      })
      .where(eq(marketCheckoutPayments.paymentId, input.row.payment_id))
      .run();
  }

  private async findPayment(identifiers: {
    paymentId?: string;
    checkoutId?: string;
    providerTransactionId?: string;
  }) {
    if (
      !identifiers.paymentId &&
      !identifiers.checkoutId &&
      !identifiers.providerTransactionId
    ) {
      throw new ApiError(
        "MARKET_CHECKOUT_PAYMENT_IDENTIFIER_REQUIRED",
        "Webhook event must include a checkout, payment, or provider transaction identifier",
        400,
      );
    }

    return this.db
      .select(marketCheckoutPaymentRowSelection)
      .from(marketCheckoutPayments)
      .innerJoin(
        marketCheckoutSessions,
        eq(marketCheckoutSessions.id, marketCheckoutPayments.checkoutId),
      )
      .where(
        or(
          identifiers.paymentId == null
            ? undefined
            : eq(marketCheckoutPayments.paymentId, identifiers.paymentId),
          identifiers.checkoutId == null
            ? undefined
            : eq(marketCheckoutPayments.checkoutId, identifiers.checkoutId),
          identifiers.providerTransactionId == null
            ? undefined
            : eq(
                marketCheckoutPayments.providerTransactionId,
                identifiers.providerTransactionId,
              ),
        ),
      )
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
    paymentStatus: MarketCheckoutWebhookStatus,
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

  private async verifySignature(
    provider: string,
    rawBody: string,
    headers: Headers,
  ) {
    if (provider === "linepay") {
      await this.verifyLinePaySignature(rawBody, headers);
      return;
    }

    const secret =
      this.env.MARKET_CHECKOUT_WEBHOOK_SECRET ??
      (provider === "stripe" ? this.env.STRIPE_WEBHOOK_SECRET : undefined);
    if (!secret) {
      throw new Error("Market checkout webhook secret is not configured");
    }

    const stripeSignature = headers.get("stripe-signature");
    const signature = stripeSignature
      ? parseStripeSignature(stripeSignature)
      : headers.get("x-webhook-signature");
    if (!signature) {
      throw new Error("Missing webhook signature");
    }

    const signedPayload = stripeSignature
      ? `${parseStripeTimestamp(stripeSignature)}.${rawBody}`
      : rawBody;
    const expected = await hmacSha256Hex(secret, signedPayload);
    if (!timingSafeEqual(signature, expected)) {
      throw new Error("Invalid webhook signature");
    }
  }

  private async verifyLinePaySignature(rawBody: string, headers: Headers) {
    const secret =
      this.env.MARKET_CHECKOUT_WEBHOOK_SECRET ??
      this.env.LINEPAY_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error(
        "Market checkout LINE Pay webhook secret is not configured",
      );
    }

    const nonce = headers.get("x-linepay-nonce");
    const signature = headers.get("x-linepay-signature");
    if (!nonce || !signature) {
      throw new Error("Missing LINE Pay webhook signature");
    }

    const expected = await hmacSha256Base64(
      secret,
      `${secret}${rawBody}${nonce}`,
    );
    if (!timingSafeEqual(signature, expected)) {
      throw new Error("Invalid LINE Pay webhook signature");
    }
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

function eventIdFrom(
  payload: MarketCheckoutWebhookPayload,
  headers: Headers,
  linePayTransactionId: string | undefined,
) {
  return (
    headers.get("x-provider-event-id") ??
    payload.id ??
    payload.data?.object?.id ??
    // A LINE Pay confirm result has no event id; one confirm per transaction.
    (linePayTransactionId ? `linepay-confirm:${linePayTransactionId}` : null)
  );
}

function linePayTransactionIdFrom(
  payload: MarketCheckoutWebhookPayload,
  rawBody: string,
): string | undefined {
  const value = payload.info?.transactionId;
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value !== "number") return undefined;
  const match = /"transactionId"\s*:\s*(\d+)/.exec(rawBody);
  return match?.[1] ?? String(value);
}

function eventTypeFrom(
  payload: MarketCheckoutWebhookPayload,
  headers: Headers,
) {
  return headers.get("x-provider-event-type") ?? payload.type ?? "unknown";
}

function identifiersFrom(
  payload: MarketCheckoutWebhookPayload,
  headers: Headers,
  linePayTransactionId: string | undefined,
) {
  const metadata = {
    ...(payload.metadata ?? {}),
    ...(payload.data?.object?.metadata ?? {}),
  };
  const object = payload.data?.object;
  // A Stripe `charge.*` event carries the Charge (`ch_...`); the payment row
  // holds the PaymentIntent id, which the charge names in `payment_intent`.
  const stripeObjectTransactionId =
    object?.object === "charge"
      ? (stringValue(object.payment_intent) ?? object.id)
      : object?.id;

  return {
    paymentId: stringValue(
      headers.get("x-market-payment-id") ??
        metadata.marketCheckoutPaymentId ??
        metadata.market_checkout_payment_id ??
        // The adapter sets LINE Pay's merchant `orderId` to the payment id.
        payload.info?.orderId,
    ),
    checkoutId: stringValue(
      headers.get("x-market-checkout-id") ??
        metadata.marketCheckoutId ??
        metadata.market_checkout_id,
    ),
    providerTransactionId: stringValue(
      headers.get("x-provider-transaction-id") ??
        stripeObjectTransactionId ??
        linePayTransactionId ??
        metadata.providerTransactionId ??
        metadata.provider_transaction_id,
    ),
  };
}

function statusFrom(
  payload: MarketCheckoutWebhookPayload,
  eventType: string,
): MarketCheckoutWebhookStatus | null {
  const normalizedEventType = eventType.toLowerCase();
  if (
    [
      "market_checkout.payment_paid",
      "payment_intent.succeeded",
      "checkout.session.completed",
    ].includes(normalizedEventType)
  ) {
    return "paid";
  }
  if (
    [
      "market_checkout.payment_failed",
      "payment_intent.payment_failed",
      "charge.failed",
    ].includes(normalizedEventType)
  ) {
    return "failed";
  }
  if (
    [
      "market_checkout.payment_refunded",
      "charge.refunded",
      "refund.succeeded",
    ].includes(normalizedEventType)
  ) {
    return "refunded";
  }
  if (normalizedEventType === "market_checkout.payment_partial_refunded") {
    return "partial_refunded";
  }

  // LINE Pay confirm: "0000" is the only success code. Anything else is left
  // for status lookup to settle rather than guessed into "failed".
  if (typeof payload.returnCode === "string" && payload.info) {
    return payload.returnCode === "0000" ? "paid" : null;
  }

  const rawStatus = (
    payload.status ??
    payload.data?.object?.status ??
    ""
  ).toLowerCase();
  if (["succeeded", "paid", "completed"].includes(rawStatus)) return "paid";
  if (["failed", "payment_failed"].includes(rawStatus)) return "failed";
  if (["refunded"].includes(rawStatus)) return "refunded";
  if (["partial_refunded", "partially_refunded"].includes(rawStatus)) {
    return "partial_refunded";
  }

  return null;
}

interface WebhookMoneySettlement {
  ok: true;
  status: MarketCheckoutWebhookStatus;
  paidAmountCents: number;
  refundedAmountCents: number;
}

interface WebhookMoneyRejection {
  ok: false;
  issue: ProviderMoneyIssue;
  expectedCents: number;
  reportedCents?: number;
  reportedCurrency?: unknown;
}

/**
 * Decide what a webhook does to the payment's money, or refuse it.
 *
 * A paid event must report exactly the row's amount in the row's currency; a
 * refund event must report a cumulative refunded amount no larger than what
 * was paid, and whether that is the whole payment decides between `refunded`
 * and `partial_refunded` (Stripe sends `charge.refunded` for both). Missing
 * money on either is a rejection, not a fallback to the expected amount.
 */
function settleWebhookMoney(
  provider: string,
  payload: MarketCheckoutWebhookPayload,
  row: MarketCheckoutPaymentRow,
  status: MarketCheckoutWebhookStatus,
): WebhookMoneySettlement | WebhookMoneyRejection {
  if (status === "failed") {
    return {
      ok: true,
      status,
      paidAmountCents: row.paid_amount_cents,
      refundedAmountCents: row.refunded_amount_cents,
    };
  }

  if (status === "paid") {
    const reported = reportedMoney(provider, payload, "paid");
    const issue = firstMoneyIssue(
      reported,
      verifyProviderMoney({
        expectedCents: row.amount_cents,
        expectedCurrency: row.currency,
        receivedCents: reported.cents,
        receivedCurrency: reported.currency,
      }),
    );
    if (issue) {
      return {
        ok: false,
        issue,
        expectedCents: row.amount_cents,
        reportedCents: reported.cents,
        reportedCurrency: reported.currency,
      };
    }
    return {
      ok: true,
      status,
      paidAmountCents: row.amount_cents,
      refundedAmountCents: row.refunded_amount_cents,
    };
  }

  const paidCents =
    row.paid_amount_cents > 0 ? row.paid_amount_cents : row.amount_cents;
  const reported = reportedMoney(provider, payload, "refunded");
  const issue =
    firstMoneyIssue(
      reported,
      verifyProviderMoney({
        expectedCents: paidCents,
        expectedCurrency: row.currency,
        receivedCents: reported.cents,
        receivedCurrency: reported.currency,
        mode: "at_most",
      }),
    ) ??
    (reported.cents !== undefined && reported.cents <= 0
      ? {
          code: "AMOUNT_MISMATCH" as const,
          message: "Provider reported a refund of nothing",
        }
      : null);
  if (issue || reported.cents === undefined) {
    return {
      ok: false,
      issue: issue ?? {
        code: "AMOUNT_MISSING",
        message: "Provider did not report an amount",
      },
      expectedCents: paidCents,
      reportedCents: reported.cents,
      reportedCurrency: reported.currency,
    };
  }
  return {
    ok: true,
    status: reported.cents === paidCents ? "refunded" : "partial_refunded",
    paidAmountCents: paidCents,
    refundedAmountCents: reported.cents,
  };
}

/**
 * A currency problem is the most useful thing to tell a reviewer ("USD", not
 * "Stripe cannot convert USD"), then a conversion failure, then the amount.
 */
function firstMoneyIssue(
  reported: { issue?: ProviderMoneyIssue },
  verification: ProviderMoneyIssue | null,
): ProviderMoneyIssue | null {
  if (verification?.code.startsWith("CURRENCY_")) return verification;
  return reported.issue ?? verification;
}

/**
 * The amount a webhook reports, converted to internal cents. Explicit
 * `*_cents` fields are taken as internal cents; provider-native fields are
 * converted with the provider's unit for the reported currency.
 */
function reportedMoney(
  provider: string,
  payload: MarketCheckoutWebhookPayload,
  kind: "paid" | "refunded",
): { cents?: number; currency?: unknown; issue?: ProviderMoneyIssue } {
  const object = payload.data?.object;
  const currency =
    payload.currency ?? object?.currency ?? payload.info?.currency;

  const explicitCents =
    kind === "paid" ? payload.amount_cents : payload.refunded_amount_cents;
  if (explicitCents !== undefined) {
    return { cents: finiteNumber(explicitCents), currency };
  }

  const native =
    kind === "paid"
      ? (finiteNumber(payload.amount_received) ??
        finiteNumber(object?.amount_received) ??
        finiteNumber(payload.amount) ??
        finiteNumber(object?.amount) ??
        linePayPaidAmount(payload))
      : (finiteNumber(payload.amount_refunded) ??
        finiteNumber(object?.amount_refunded));
  if (native === undefined) return { currency };

  const converted = providerAmountToCents(provider, currency, native);
  return converted.ok
    ? { cents: converted.cents, currency }
    : { currency, issue: converted.issue };
}

/** LINE Pay can split one payment across methods (points + card); sum them. */
function linePayPaidAmount(
  payload: MarketCheckoutWebhookPayload,
): number | undefined {
  const payInfo = payload.info?.payInfo;
  if (!Array.isArray(payInfo) || payInfo.length === 0) return undefined;
  let total = 0;
  for (const entry of payInfo) {
    const amount = finiteNumber(entry?.amount);
    if (amount === undefined) return undefined;
    total += amount;
  }
  return total;
}

function updatePaymentSummary(
  row: MarketCheckoutPaymentRow,
  input: {
    status: MarketCheckoutWebhookStatus;
    provider: string;
    providerTransactionId?: string | null;
    paidAmountCents: number;
    refundedAmountCents: number;
    updatedAtMs: number;
    /** Used only when neither the row nor the stored summary names one. */
    fallbackCurrency: string;
  },
) {
  const existing = parsePaymentSummary(row.session_payment_summary);
  const updatedAt = new Date(input.updatedAtMs).toISOString();
  const childPaymentIds = parseJsonStringArray(row.child_payment_ids);
  const payment = {
    ...existing,
    status: input.status,
    method: existing.method ?? row.provider,
    currency: row.currency ?? existing.currency ?? input.fallbackCurrency,
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
      provider: row.provider || input.provider,
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * No rounding: a fractional amount is a unit error to be caught by
 * verification, not smoothed over.
 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseStripeSignature(header: string) {
  return header
    .split(",")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === "v1")?.[1];
}

function parseStripeTimestamp(header: string) {
  return (
    header
      .split(",")
      .map((part) => part.trim().split("="))
      .find(([key]) => key === "t")?.[1] ?? ""
  );
}

async function hmacSha256Hex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Base64(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
