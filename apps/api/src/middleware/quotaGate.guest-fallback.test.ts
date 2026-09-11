import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// The bucket read is Drizzle, so it cannot run against this file's hand-rolled
// D1 stub. Stubbing it to "no unfolded buckets" keeps this test about what it
// was always about — that the guest fallback resolves a restaurant and the
// hard limit is enforced — and leaves the bucket arithmetic to the real-D1
// suite (usage-meter-buckets.real.integration.test.ts).
const sumUnfoldedBucketQuantities = vi.hoisted(() =>
  vi.fn(async () => new Map<string, number>()),
);
vi.mock("../shared/utils/usage-buckets", () => ({
  sumUnfoldedBucketQuantities,
}));

import { quotaGate } from "./quotaGate";
import { ApiError } from "../shared/utils/api-error";

function createDb() {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((..._args: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes("FROM shop_subscriptions")) {
            return {
              plan_tier: "trial",
              trial_ends_at_ms: Date.now() + 86_400_000,
              billing_cycle_start_at_ms: null,
              billing_cycle_end_at_ms: null,
              created_at_ms: Date.now() - 60_000,
            };
          }
          if (sql.includes("FROM usage_meters")) {
            return { total_quantity: 100 };
          }
          if (sql.includes("FROM usage_events")) {
            return { total: 0 };
          }
          return null;
        }),
      })),
    })),
  };
}

function createKv() {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
}

describe("quotaGate guest restaurant fallback", () => {
  it("enforces hard quota limits when an anonymous request has a fallback restaurant", async () => {
    const app = new Hono();
    app.onError((err, c) => {
      if (err instanceof ApiError) {
        return c.json(
          { success: false, error: { code: err.code, message: err.message } },
          err.status as 429,
        );
      }
      return c.json({ success: false }, 500);
    });
    app.post(
      "/create",
      quotaGate("orders.created", () => "rest-guest-1"),
      (c) => c.json({ success: true }),
    );

    const res = await app.fetch(
      new Request("https://test/create", { method: "POST" }),
      {
        DB: createDb(),
        CACHE_KV: createKv(),
        QUOTA_ENFORCEMENT_MODE: "enforce",
      } as never,
    );

    expect(res.status).toBe(429);
    expect(sumUnfoldedBucketQuantities).toHaveBeenCalledWith(
      expect.anything(),
      "rest-guest-1",
      expect.objectContaining({ meterKey: "orders.created" }),
    );
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "QUOTA_EXCEEDED" },
    });
  });
});
