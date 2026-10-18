import { PAYMENT_AUDIT_EVENT_TYPES } from "@makanmasak/database";
import { generateUUID } from "@makanmasak/utils";
import type { Env } from "../../../types/env";
import { invalidateSubscriptionCacheForEnv } from "../../../middleware/moduleGate";
import { timingSafeEqual } from "../../../shared/utils/timing-safe-equal";
import { PaymentAuditService } from "./PaymentAuditService";
import {
  BILLING_NOTIFICATION_KINDS,
  BillingNotificationService,
  NOTIFICATION_CHANNELS,
} from "./BillingNotificationService";

interface WebhookPayload {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      customer?: string;
      subscription?: string;
      metadata?: Record<string, unknown>;
    };
  };
}

export interface BillingWebhookResult {
  provider: string;
  eventId: string | null;
  eventType: string;
  duplicate: boolean;
  reconciled: boolean;
}

// Reject Stripe deliveries whose signed timestamp is outside this skew, to
// bound the replay window of a captured signed payload.
const STRIPE_TIMESTAMP_TOLERANCE_SECONDS = 300;

// Event id and type come from the signed body only: HTTP headers other than
// the signature are not covered by the HMAC and must never override them.
function eventIdFrom(payload: WebhookPayload) {
  return payload.id ?? payload.data?.object?.id ?? null;
}

function eventTypeFrom(payload: WebhookPayload) {
  return payload.type ?? "unknown";
}

function restaurantIdFrom(payload: WebhookPayload) {
  const metadata = payload.data?.object?.metadata;
  const value = metadata?.restaurantId ?? metadata?.restaurant_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class BillingWebhookService {
  constructor(private readonly env: Env) {}

  async handle(
    provider: string,
    rawBody: string,
    headers: Headers,
  ): Promise<BillingWebhookResult> {
    await this.verifySignature(provider, rawBody, headers);

    const payload = JSON.parse(rawBody) as WebhookPayload;
    const eventId = eventIdFrom(payload);
    const eventType = eventTypeFrom(payload);
    const restaurantId = restaurantIdFrom(payload);

    const audit = await new PaymentAuditService(this.env.DB).append({
      restaurantId,
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

    const reconciled = await this.reconcile(provider, eventType, payload);
    return { provider, eventId, eventType, duplicate: false, reconciled };
  }

  private async reconcile(
    provider: string,
    eventType: string,
    payload: WebhookPayload,
  ) {
    const restaurantId = restaurantIdFrom(payload);
    if (!restaurantId) return false;

    if (eventType === "invoice.paid") {
      const now = Date.now();
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE shop_subscriptions
              SET is_active = 1,
                  updated_at_ms = ?
            WHERE restaurant_id = ?`,
        ).bind(now, restaurantId),
        this.env.DB.prepare(
          `INSERT INTO payment_audit_log (
              id, restaurant_id, event_type, provider, provider_event_type,
              raw_payload, occurred_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          generateUUID(),
          restaurantId,
          PAYMENT_AUDIT_EVENT_TYPES.SUCCESS,
          provider,
          eventType,
          JSON.stringify({ source: "webhook_reconcile" }),
          now,
        ),
      ]);
      // is_active flips to 1 above; without invalidation a shop that just
      // paid could stay locked out of its modules for up to the cache TTL.
      await invalidateSubscriptionCacheForEnv(this.env, restaurantId);
      return true;
    }

    if (eventType === "invoice.payment_failed") {
      const now = Date.now();
      await new PaymentAuditService(this.env.DB).append({
        restaurantId,
        eventType: PAYMENT_AUDIT_EVENT_TYPES.GRACE_PERIOD_START,
        provider,
        providerEventType: eventType,
        rawPayload: { source: "webhook_reconcile" },
        occurredAtMs: now,
      });

      await new BillingNotificationService(this.env).send({
        restaurantId,
        kind: BILLING_NOTIFICATION_KINDS.PAYMENT_FAILED,
        dedupKey: `payment_failed:${restaurantId}:${payload.id ?? now}`,
        channel: NOTIFICATION_CHANNELS.SLACK,
        text: `Billing payment failed for restaurant ${restaurantId}`,
        payload: { provider, eventType },
      });
      return true;
    }

    return false;
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

    if (provider !== "stripe") {
      throw new Error("Unsupported billing webhook provider");
    }

    if (!this.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error("Stripe webhook secret is not configured");
    }

    const stripeSignature = headers.get("stripe-signature");
    const signature = stripeSignature
      ? parseStripeSignature(stripeSignature)
      : headers.get("x-webhook-signature");

    if (!signature) {
      throw new Error("Missing webhook signature");
    }

    const timestamp = stripeSignature
      ? parseStripeTimestamp(stripeSignature)
      : null;
    const signedPayload =
      timestamp === null ? rawBody : `${timestamp}.${rawBody}`;
    const expected = await hmacSha256Hex(
      this.env.STRIPE_WEBHOOK_SECRET,
      signedPayload,
    );

    if (!timingSafeEqual(signature, expected)) {
      throw new Error("Invalid webhook signature");
    }

    if (timestamp !== null) {
      const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
      if (
        !Number.isFinite(ageSeconds) ||
        ageSeconds > STRIPE_TIMESTAMP_TOLERANCE_SECONDS
      ) {
        throw new Error("Webhook timestamp is outside the tolerance window");
      }
    }
  }

  private async verifyLinePaySignature(rawBody: string, headers: Headers) {
    if (!this.env.LINEPAY_WEBHOOK_SECRET) {
      throw new Error("LINE Pay webhook secret is not configured");
    }

    const nonce = headers.get("x-linepay-nonce");
    const signature = headers.get("x-linepay-signature");
    if (!nonce || !signature) {
      throw new Error("Missing LINE Pay webhook signature");
    }

    const expected = await hmacSha256Base64(
      this.env.LINEPAY_WEBHOOK_SECRET,
      `${this.env.LINEPAY_WEBHOOK_SECRET}${rawBody}${nonce}`,
    );
    if (!timingSafeEqual(signature, expected)) {
      throw new Error("Invalid LINE Pay webhook signature");
    }
  }
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
