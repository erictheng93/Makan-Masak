import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";
import { BillingWebhookService } from "./BillingWebhookService";

const auditAppend = vi.hoisted(() => vi.fn());
const notificationSend = vi.hoisted(() => vi.fn());

vi.mock("@makanmasak/utils", () => ({
  generateUUID: vi.fn(() => "uuid-webhook-reconcile"),
}));

vi.mock("./PaymentAuditService", () => ({
  PaymentAuditService: vi.fn().mockImplementation(function () {
    return {
      append: auditAppend,
    };
  }),
}));

vi.mock("./BillingNotificationService", () => ({
  BILLING_NOTIFICATION_KINDS: {
    PAYMENT_FAILED: "payment_failed",
  },
  BillingNotificationService: vi.fn().mockImplementation(function () {
    return {
      send: notificationSend,
    };
  }),
  NOTIFICATION_CHANNELS: {
    SLACK: "slack",
  },
}));

interface FakeStatement {
  sql: string;
  values: unknown[];
  bind: ReturnType<typeof vi.fn>;
}

function createDb() {
  const prepared: FakeStatement[] = [];
  const batch = vi.fn(async () => ({ results: [] }));
  const prepare = vi.fn((sql: string) => {
    const statement: FakeStatement = {
      sql,
      values: [],
      bind: vi.fn((...values: unknown[]) => {
        statement.values = values;
        prepared.push(statement);
        return statement;
      }),
    };
    return statement;
  });

  return {
    batch,
    prepared,
    prepare,
  };
}

function createCacheKv() {
  return {
    delete: vi.fn(async (_key: string) => undefined),
  };
}

function createEnv(overrides: Partial<Env> = {}) {
  const db = createDb();
  const cacheKv = createCacheKv();
  return {
    db,
    cacheKv,
    env: {
      DB: {
        batch: db.batch,
        prepare: db.prepare,
      },
      CACHE_KV: cacheKv,
      LINEPAY_WEBHOOK_SECRET: "linepay-secret",
      STRIPE_WEBHOOK_SECRET: "stripe-secret",
      ...overrides,
    } as unknown as Env,
  };
}

function raw(payload: unknown) {
  return JSON.stringify(payload);
}

async function hmacHex(secret: string, value: string) {
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

async function hmacBase64(secret: string, value: string) {
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

async function stripeHeaders(
  rawBody: string,
  extra: Record<string, string> = {},
) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacHex("stripe-secret", `${timestamp}.${rawBody}`);
  return new Headers({
    "stripe-signature": `t=${timestamp},v1=${signature}`,
    ...extra,
  });
}

async function stripeRawSignatureHeaders(
  rawBody: string,
  extra: Record<string, string> = {},
) {
  return new Headers({
    "x-webhook-signature": await hmacHex("stripe-secret", rawBody),
    ...extra,
  });
}

async function linePayHeaders(
  rawBody: string,
  extra: Record<string, string> = {},
) {
  const nonce = "nonce-1";
  return new Headers({
    "x-linepay-nonce": nonce,
    "x-linepay-signature": await hmacBase64(
      "linepay-secret",
      `linepay-secret${rawBody}${nonce}`,
    ),
    ...extra,
  });
}

describe("BillingWebhookService", () => {
  beforeEach(() => {
    vi.useRealTimers();
    auditAppend.mockReset();
    auditAppend.mockResolvedValue({ inserted: true });
    notificationSend.mockReset();
    notificationSend.mockResolvedValue({
      duplicate: false,
      status: "sent",
    });
  });

  it("records a received Stripe webhook and ignores unsigned provider headers", async () => {
    const { env } = createEnv();
    const body = raw({
      id: "payload-event",
      type: "payload.type",
      data: {
        object: {
          id: "object-event",
          metadata: {
            restaurantId: "restaurant-1",
          },
        },
      },
    });

    const result = await new BillingWebhookService(env).handle(
      "stripe",
      body,
      await stripeHeaders(body, {
        "x-provider-event-id": "header-event",
        "x-provider-event-type": "customer.subscription.updated",
      }),
    );

    expect(result).toEqual({
      provider: "stripe",
      eventId: "payload-event",
      eventType: "payload.type",
      duplicate: false,
      reconciled: false,
    });
    expect(auditAppend).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      eventType: "webhook_received",
      provider: "stripe",
      providerEventId: "payload-event",
      providerEventType: "payload.type",
      rawPayload: JSON.parse(body),
    });
  });

  it("does not let an unsigned type header turn a signed event into invoice.paid", async () => {
    const { db, env } = createEnv();
    const body = raw({
      id: "evt-updated",
      type: "customer.updated",
      data: { object: { metadata: { restaurantId: "restaurant-1" } } },
    });

    const result = await new BillingWebhookService(env).handle(
      "stripe",
      body,
      await stripeHeaders(body, {
        "x-provider-event-id": "fresh-id",
        "x-provider-event-type": "invoice.paid",
      }),
    );

    expect(result).toMatchObject({
      eventId: "evt-updated",
      eventType: "customer.updated",
      reconciled: false,
    });
    expect(db.batch).not.toHaveBeenCalled();
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ providerEventId: "evt-updated" }),
    );
  });

  it("rejects Stripe signatures older than the replay tolerance", async () => {
    const { env } = createEnv();
    const body = raw({ id: "evt-stale", type: "invoice.paid" });
    const timestamp = String(Math.floor(Date.now() / 1000) - 601);
    const signature = await hmacHex("stripe-secret", `${timestamp}.${body}`);

    await expect(
      new BillingWebhookService(env).handle(
        "stripe",
        body,
        new Headers({ "stripe-signature": `t=${timestamp},v1=${signature}` }),
      ),
    ).rejects.toThrow("outside the tolerance window");
    expect(auditAppend).not.toHaveBeenCalled();
  });

  it("short-circuits reconciliation when the provider event was already audited", async () => {
    auditAppend.mockResolvedValueOnce({ inserted: false });
    const { db, env } = createEnv();
    const body = raw({
      id: "evt-duplicate",
      type: "invoice.paid",
      data: {
        object: {
          metadata: {
            restaurantId: "restaurant-1",
          },
        },
      },
    });

    const result = await new BillingWebhookService(env).handle(
      "stripe",
      body,
      await stripeHeaders(body),
    );

    expect(result).toEqual({
      provider: "stripe",
      eventId: "evt-duplicate",
      eventType: "invoice.paid",
      duplicate: true,
      reconciled: false,
    });
    expect(db.batch).not.toHaveBeenCalled();
    expect(notificationSend).not.toHaveBeenCalled();
  });

  it("reactivates subscriptions, invalidates the module cache, and writes success audit on paid invoices", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);
    const { db, env, cacheKv } = createEnv();
    const body = raw({
      id: "evt-paid",
      type: "invoice.paid",
      data: {
        object: {
          metadata: {
            restaurantId: "restaurant-paid",
          },
        },
      },
    });

    const result = await new BillingWebhookService(env).handle(
      "stripe",
      body,
      await stripeRawSignatureHeaders(body),
    );

    expect(result).toMatchObject({
      duplicate: false,
      eventId: "evt-paid",
      eventType: "invoice.paid",
      reconciled: true,
    });
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.prepared).toHaveLength(2);
    expect(db.prepared[0].sql).toContain("UPDATE shop_subscriptions");
    expect(db.prepared[0].values).toEqual([1710000000000, "restaurant-paid"]);
    expect(db.prepared[1].sql).toContain("INSERT INTO payment_audit_log");
    expect(db.prepared[1].values).toEqual([
      "uuid-webhook-reconcile",
      "restaurant-paid",
      "success",
      "stripe",
      "invoice.paid",
      JSON.stringify({ source: "webhook_reconcile" }),
      1710000000000,
    ]);
    // A shop that just paid must not stay locked out of its modules for up
    // to the 5-minute cache TTL — this is the fail-open-risk case.
    expect(cacheKv.delete).toHaveBeenCalledOnce();
    expect(cacheKv.delete).toHaveBeenCalledWith("subscription:restaurant-paid");
  });

  it("starts a grace period and sends a Slack notification on failed invoices", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1710000001234);
    const { env, cacheKv } = createEnv();
    const body = raw({
      id: "evt-failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          metadata: {
            restaurantId: "restaurant-failed",
          },
        },
      },
    });

    const result = await new BillingWebhookService(env).handle(
      "stripe",
      body,
      await stripeHeaders(body),
    );

    expect(result).toMatchObject({
      duplicate: false,
      eventId: "evt-failed",
      eventType: "invoice.payment_failed",
      reconciled: true,
    });
    expect(auditAppend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        restaurantId: "restaurant-failed",
        eventType: "grace_period_start",
        provider: "stripe",
        providerEventType: "invoice.payment_failed",
        rawPayload: { source: "webhook_reconcile" },
        occurredAtMs: 1710000001234,
      }),
    );
    expect(notificationSend).toHaveBeenCalledWith({
      restaurantId: "restaurant-failed",
      kind: "payment_failed",
      dedupKey: "payment_failed:restaurant-failed:evt-failed",
      channel: "slack",
      text: "Billing payment failed for restaurant restaurant-failed",
      payload: {
        provider: "stripe",
        eventType: "invoice.payment_failed",
      },
    });
    // is_active is untouched on a failed invoice, so there is nothing to
    // invalidate — asserted so a future change doesn't silently start
    // deleting cache entries on every webhook regardless of outcome.
    expect(cacheKv.delete).not.toHaveBeenCalled();
  });

  it("accepts valid LINE Pay signatures and snake_case restaurant metadata", async () => {
    const { env } = createEnv();
    const body = raw({
      id: "linepay-event",
      type: "linepay.payment.confirmed",
      data: {
        object: {
          metadata: {
            restaurant_id: "restaurant-linepay",
          },
        },
      },
    });

    const result = await new BillingWebhookService(env).handle(
      "linepay",
      body,
      await linePayHeaders(body),
    );

    expect(result).toEqual({
      provider: "linepay",
      eventId: "linepay-event",
      eventType: "linepay.payment.confirmed",
      duplicate: false,
      reconciled: false,
    });
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-linepay",
        provider: "linepay",
        providerEventId: "linepay-event",
        providerEventType: "linepay.payment.confirmed",
      }),
    );
  });

  it("rejects unsupported or invalid webhook signatures", async () => {
    const body = raw({ id: "evt-bad", type: "invoice.paid" });

    await expect(
      new BillingWebhookService(createEnv().env).handle(
        "paypal",
        body,
        new Headers(),
      ),
    ).rejects.toThrow("Unsupported billing webhook provider");
    await expect(
      new BillingWebhookService(
        createEnv({ STRIPE_WEBHOOK_SECRET: undefined }).env,
      ).handle("stripe", body, new Headers()),
    ).rejects.toThrow("Stripe webhook secret is not configured");
    await expect(
      new BillingWebhookService(createEnv().env).handle(
        "stripe",
        body,
        new Headers(),
      ),
    ).rejects.toThrow("Missing webhook signature");
    await expect(
      new BillingWebhookService(createEnv().env).handle(
        "stripe",
        body,
        new Headers({ "x-webhook-signature": "invalid" }),
      ),
    ).rejects.toThrow("Invalid webhook signature");
    await expect(
      new BillingWebhookService(
        createEnv({ LINEPAY_WEBHOOK_SECRET: undefined }).env,
      ).handle("linepay", body, new Headers()),
    ).rejects.toThrow("LINE Pay webhook secret is not configured");
    await expect(
      new BillingWebhookService(createEnv().env).handle(
        "linepay",
        body,
        new Headers(),
      ),
    ).rejects.toThrow("Missing LINE Pay webhook signature");
    await expect(
      new BillingWebhookService(createEnv().env).handle(
        "linepay",
        body,
        new Headers({
          "x-linepay-nonce": "nonce-1",
          "x-linepay-signature": "invalid",
        }),
      ),
    ).rejects.toThrow("Invalid LINE Pay webhook signature");
  });

  it("rejects an equal-length but forged Stripe signature (constant-time path)", async () => {
    const body = raw({ id: "evt-forged", type: "invoice.paid" });
    const valid = await hmacHex("stripe-secret", body);
    // Flip the last hex nibble so the forged value keeps the same length but
    // differs — this drives the length-equal branch of timingSafeEqual.
    const lastChar = valid.slice(-1);
    const forged = valid.slice(0, -1) + (lastChar === "0" ? "1" : "0");
    expect(forged).toHaveLength(valid.length);
    expect(forged).not.toBe(valid);

    await expect(
      new BillingWebhookService(createEnv().env).handle(
        "stripe",
        body,
        new Headers({ "x-webhook-signature": forged }),
      ),
    ).rejects.toThrow("Invalid webhook signature");
  });

  it("rejects an equal-length but forged LINE Pay signature (constant-time path)", async () => {
    const body = raw({ id: "evt-forged-linepay", type: "invoice.paid" });
    const nonce = "nonce-1";
    const valid = await hmacBase64(
      "linepay-secret",
      `linepay-secret${body}${nonce}`,
    );
    const lastChar = valid.slice(-1);
    const forged = valid.slice(0, -1) + (lastChar === "A" ? "B" : "A");
    expect(forged).toHaveLength(valid.length);
    expect(forged).not.toBe(valid);

    await expect(
      new BillingWebhookService(createEnv().env).handle(
        "linepay",
        body,
        new Headers({
          "x-linepay-nonce": nonce,
          "x-linepay-signature": forged,
        }),
      ),
    ).rejects.toThrow("Invalid LINE Pay webhook signature");
  });
});
