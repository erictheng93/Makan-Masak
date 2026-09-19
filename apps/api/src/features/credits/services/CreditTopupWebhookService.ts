import type { Env } from "../../../types/env";
import { ApiError } from "../../../shared/utils/api-error";
import { CreditTopupService, hmacSha256Hex } from "./CreditTopupService";

// Reject callbacks whose signature timestamp is outside this skew, to bound the
// replay window even if a valid signed payload is captured.
const WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000;

interface CreditTopupWebhookPayload {
  intentId?: string;
  intent_id?: string;
  providerTransactionId?: string;
  provider_transaction_id?: string;
  status?: string;
  /** Internal cents (major × 100). Required, with `currency`, on paid. */
  amountCents?: number;
  amount_cents?: number;
  currency?: string;
  errorMessage?: string;
}

export interface CreditTopupWebhookResult {
  duplicate: boolean;
  credited: boolean;
  intentId?: string;
  status?: "paid" | "failed";
  balanceAfterCents?: number;
  reviewRequired?: boolean;
  reviewReason?: string;
}

/**
 * Verifies a provider top-up callback (HMAC-SHA256 over `${timestamp}.${body}`)
 * and confirms the matching intent. Crediting is idempotent on the intent id,
 * and a re-delivered webhook for an already-paid intent returns `duplicate`.
 */
export class CreditTopupWebhookService {
  constructor(
    private readonly env: Env,
    private readonly topupService = new CreditTopupService(env),
  ) {}

  async handle(
    rawBody: string,
    headers: Headers,
  ): Promise<CreditTopupWebhookResult> {
    await this.verifySignature(rawBody, headers);

    const payload = JSON.parse(rawBody) as CreditTopupWebhookPayload;
    const intentId = stringValue(
      payload.intentId ??
        payload.intent_id ??
        headers.get("x-credit-topup-intent-id"),
    );
    const providerTransactionId = stringValue(
      payload.providerTransactionId ??
        payload.provider_transaction_id ??
        headers.get("x-provider-transaction-id"),
    );
    const status = normalizeStatus(payload.status);
    if (!status) {
      return { duplicate: false, credited: false, intentId };
    }

    const result = await this.topupService.confirmIntent({
      intentId,
      providerTransactionId,
      status,
      paidAmountCents:
        typeof (payload.amountCents ?? payload.amount_cents) === "number"
          ? (payload.amountCents ?? payload.amount_cents)
          : undefined,
      paidCurrency:
        typeof payload.currency === "string" ? payload.currency : undefined,
      providerPayload: payload as unknown as Record<string, unknown>,
      errorMessage:
        typeof payload.errorMessage === "string"
          ? payload.errorMessage
          : undefined,
    });

    return {
      duplicate: result.alreadyProcessed,
      credited: result.credited,
      intentId: result.intent.id,
      status,
      balanceAfterCents: result.balanceAfterCents,
      ...(result.reviewRequired
        ? { reviewRequired: true, reviewReason: result.reviewReason }
        : {}),
    };
  }

  private async verifySignature(rawBody: string, headers: Headers) {
    const secret = this.env.CREDIT_TOPUP_WEBHOOK_SECRET;
    if (!secret) {
      throw new ApiError(
        "CREDIT_TOPUP_WEBHOOK_SECRET_MISSING",
        "Credit top-up webhook secret is not configured",
        500,
      );
    }
    const signature = headers.get("x-credit-topup-signature");
    if (!signature) {
      throw new ApiError(
        "CREDIT_TOPUP_WEBHOOK_SIGNATURE_MISSING",
        "Missing webhook signature",
        401,
      );
    }
    const timestamp = headers.get("x-credit-topup-signature-timestamp") ?? "";
    const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
    // Constant-time compare — a fast-fail `!==` leaks the signature byte by byte.
    if (!timingSafeEqualHex(signature, expected)) {
      throw new ApiError(
        "CREDIT_TOPUP_WEBHOOK_SIGNATURE_INVALID",
        "Invalid webhook signature",
        401,
      );
    }

    // Bound the replay window: the timestamp is covered by the HMAC, so a forged
    // value cannot pass the check above, but a captured-and-replayed payload can.
    const signedAtMs = Date.parse(timestamp);
    if (
      !Number.isFinite(signedAtMs) ||
      Math.abs(Date.now() - signedAtMs) > WEBHOOK_MAX_SKEW_MS
    ) {
      throw new ApiError(
        "CREDIT_TOPUP_WEBHOOK_SIGNATURE_STALE",
        "Webhook timestamp is missing or out of range",
        401,
      );
    }
  }
}

/** Length-checked, constant-time hex string comparison. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeStatus(value: unknown): "paid" | "failed" | null {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (["paid", "succeeded", "completed"].includes(status)) return "paid";
  if (["failed", "payment_failed", "canceled", "cancelled"].includes(status)) {
    return "failed";
  }
  return null;
}
