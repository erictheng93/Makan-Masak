/**
 * Subscription-gate wiring for orders POST /batch-sync.
 *
 * Regression coverage for the bug where this route had no
 * moduleGate("online_ordering"), unlike POST / (real order creation) in the
 * same router. /batch-sync only writes an offline-sync mirror to CACHE_KV,
 * but it's still part of the online-ordering surface — a deactivated or
 * trial-expired restaurant should not be able to keep writing through it
 * after real order creation is cut off.
 *
 * Unlike index.test.ts, this file does NOT mock "../../../middleware/moduleGate"
 * — it exercises the real middleware so a missing moduleGate call fails
 * these tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";

const currentUser = vi.hoisted(() => {
  const value: AuthUser = {
    id: "user-42",
    username: "owner",
    role: 1,
    restaurantId: "rest-basic",
  };
  return { value };
});

vi.mock("../../../shared/middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../shared/middleware")>();
  return {
    ...actual,
    customerAuthMiddleware: vi.fn(async (c: Context, next: Next) => {
      c.set("user", currentUser.value);
      await next();
    }),
    customerOrderAuthMiddleware: vi.fn(async (c: Context, next: Next) => {
      c.set("user", currentUser.value);
      await next();
    }),
    requireRole: vi.fn(
      () => async (_c: unknown, next: () => Promise<void>) => next(),
    ),
  };
});

import routes from "./index";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

interface CachedSubscription {
  isActive: boolean;
  planTier: "trial" | "basic" | "pro" | "enterprise";
  moduleOverrides: Record<string, boolean>;
  trialEndsAt: number | null;
}

class FakeKv {
  constructor(private readonly data: Record<string, CachedSubscription>) {}
  async get<T>(key: string): Promise<T | null> {
    if (key.startsWith("subscription:")) {
      const restaurantId = key.replace(/^subscription:/, "");
      return (this.data[restaurantId] as unknown as T) ?? null;
    }
    return null;
  }
  async put(): Promise<void> {}
  async delete(): Promise<void> {}
}

function subscription(
  planTier: CachedSubscription["planTier"],
  overrides: Record<string, boolean> = {},
): CachedSubscription {
  return {
    isActive: true,
    planTier,
    moduleOverrides: overrides,
    trialEndsAt: null,
  };
}

function envWithSubscription(
  restaurantId: string,
  planTier: CachedSubscription["planTier"],
  overrides: Record<string, boolean> = {},
) {
  return {
    DB: {},
    CACHE_KV: new FakeKv({ [restaurantId]: subscription(planTier, overrides) }),
  } as unknown as Record<string, unknown>;
}

function batchSyncRequest() {
  return new Request("https://orders.test/batch-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orders: [{ id: "offline-1" }] }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.value = {
    id: "user-42",
    username: "owner",
    role: 1,
    restaurantId: "rest-basic",
  };
});

describe("orders POST /batch-sync is gated on online_ordering", () => {
  it("denies a basic-tier owner with online_ordering explicitly disabled (403 MODULE_NOT_ENABLED)", async () => {
    const res = await routes.fetch(
      batchSyncRequest(),
      envWithSubscription("rest-basic", "basic", {
        online_ordering: false,
      }) as never,
    );
    const json = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };

    expect(res.status).toBe(403);
    expect(json).toMatchObject({
      success: false,
      error: { code: "MODULE_NOT_ENABLED" },
    });
  });

  it("allows a default basic-tier owner through (online_ordering is on by default)", async () => {
    const res = await routes.fetch(
      batchSyncRequest(),
      envWithSubscription("rest-basic", "basic") as never,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
  });
});

describe("orders POST / gates a customer member on the restaurant they order from", () => {
  // A canonical customer's user carries no restaurantId: the gate has to take
  // the restaurant from the order itself, as guest and group orders do, or
  // every member order answers 403 NO_RESTAURANT (#422).
  function memberOrderRequest(restaurantId: string) {
    return new Request("https://orders.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        restaurantId,
        orderType: "table",
        tableId: 7,
        items: [{ menuItemId: 1, quantity: 1 }],
      }),
    });
  }

  beforeEach(() => {
    currentUser.value = { id: "customer-1", username: "0912000000", role: 5 };
  });

  it("applies the ordered restaurant's module switch", async () => {
    const res = await routes.fetch(
      memberOrderRequest("rest-basic"),
      envWithSubscription("rest-basic", "basic", {
        online_ordering: false,
      }) as never,
    );
    const json = (await res.json()) as { error?: { code?: string } };

    expect(res.status).toBe(403);
    expect(json.error?.code).toBe("MODULE_NOT_ENABLED");
  });

  it("lets the member past the gate when the restaurant has online ordering", async () => {
    const res = await routes.fetch(
      memberOrderRequest("rest-basic"),
      envWithSubscription("rest-basic", "basic") as never,
    );
    const json = (await res.json()) as { error?: { code?: string } };

    expect(json.error?.code).not.toBe("NO_RESTAURANT");
    expect(json.error?.code).not.toBe("MODULE_NOT_ENABLED");
  });
});
