import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/utils/api-error";
import {
  GUEST_ORDER_THROTTLE,
  enforceGuestOrderThrottle,
} from "./guest-order-throttle";

// The throttle counts in the D1 ephemeral store; hand it the fake on the env.
vi.mock("../../../shared/utils/ephemeral-store", () => ({
  ephemeralStore: (env: { EPHEMERAL: unknown }) => env.EPHEMERAL,
}));

/**
 * In-memory stand-in for the counter store. The real limiter keeps one counter per
 * fixed window and interpolates the previous one, so a map is enough to make
 * the sliding window behave exactly as it does in production.
 */
function createRateLimitKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function createContext(
  options: {
    ip?: string;
    rateLimitKV?: ReturnType<typeof createRateLimitKV> | undefined;
    withExecutionCtx?: boolean;
  } = {},
) {
  const { ip = "203.0.113.10", withExecutionCtx = false } = options;
  const rateLimitKV =
    "rateLimitKV" in options ? options.rateLimitKV : createRateLimitKV();

  const context = {
    env: { EPHEMERAL: rateLimitKV, ANALYTICS_ENGINE: undefined },
    req: {
      header: (name: string) => (name === "CF-Connecting-IP" ? ip : undefined),
      raw: new Request("https://api.test/api/v1/guest-orders", {
        method: "POST",
        headers: { "CF-Connecting-IP": ip },
      }),
    },
    get executionCtx() {
      if (!withExecutionCtx) {
        // Mirrors Hono: reading this throws when the runtime supplied none.
        throw new Error("This context has no ExecutionContext");
      }
      return { waitUntil: vi.fn() };
    },
  };

  return { context: context as never, rateLimitKV };
}

async function submit(context: never, restaurantId = "restaurant-1") {
  return enforceGuestOrderThrottle(context, restaurantId);
}

describe("enforceGuestOrderThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
  });

  it("lets a real ordering pace through untouched", async () => {
    const { context } = createContext();

    for (let i = 0; i < GUEST_ORDER_THROTTLE.requests; i += 1) {
      await expect(submit(context)).resolves.toBeUndefined();
    }
  });

  it("refuses once the burst allowance for that stall is spent", async () => {
    const { context } = createContext();
    const burstLimit = Math.ceil(
      GUEST_ORDER_THROTTLE.requests * GUEST_ORDER_THROTTLE.burstMultiplier,
    );

    for (let i = 0; i < burstLimit; i += 1) {
      await submit(context);
    }

    await expect(submit(context)).rejects.toMatchObject({
      code: "GUEST_ORDER_RATE_LIMITED",
      status: 429,
    });
    await expect(submit(context)).rejects.toBeInstanceOf(ApiError);
  });

  it("carries a Retry-After so a busy stall knows when to come back", async () => {
    const { context } = createContext();
    const burstLimit = Math.ceil(
      GUEST_ORDER_THROTTLE.requests * GUEST_ORDER_THROTTLE.burstMultiplier,
    );

    for (let i = 0; i < burstLimit; i += 1) {
      await submit(context);
    }

    await expect(submit(context)).rejects.toMatchObject({
      details: { retryAfter: expect.any(Number) },
    });
  });

  it("budgets each restaurant separately, so one flooded stall does not close its neighbours", async () => {
    // The whole point of the per-restaurant key: #163-#168 was caused by one
    // shared address taking out ordering for everybody.
    const { context } = createContext();
    const burstLimit = Math.ceil(
      GUEST_ORDER_THROTTLE.requests * GUEST_ORDER_THROTTLE.burstMultiplier,
    );

    for (let i = 0; i < burstLimit + 1; i += 1) {
      await submit(context, "restaurant-1").catch(() => undefined);
    }

    await expect(submit(context, "restaurant-2")).resolves.toBeUndefined();
  });

  it("budgets each address separately for the same restaurant", async () => {
    const kv = createRateLimitKV();
    const flooder = createContext({ ip: "203.0.113.10", rateLimitKV: kv });
    const bystander = createContext({ ip: "198.51.100.7", rateLimitKV: kv });
    const burstLimit = Math.ceil(
      GUEST_ORDER_THROTTLE.requests * GUEST_ORDER_THROTTLE.burstMultiplier,
    );

    for (let i = 0; i < burstLimit + 1; i += 1) {
      await submit(flooder.context).catch(() => undefined);
    }

    await expect(submit(bystander.context)).resolves.toBeUndefined();
  });

  it("keys on the address and restaurant only — never on the public shop QR code", async () => {
    // The shop code is handed out by two public endpoints by design, so it
    // proves nothing about presence and must not appear in the budget key.
    const { context, rateLimitKV } = createContext();

    await submit(context);

    const keys = [
      ...rateLimitKV!.get.mock.calls.map((call) => call[0]),
      ...rateLimitKV!.put.mock.calls.map((call) => call[0]),
    ];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toContain("restaurant-1");
      expect(key).toContain("203.0.113.10");
      expect(key).not.toContain("SHOP-");
    }
  });

  it("serves the order when the counter store is unavailable", async () => {
    // Availability beats enforcement: a D1 outage must not stop a night market
    // from taking orders.
    const rateLimitKV = createRateLimitKV();
    rateLimitKV.get.mockRejectedValue(new Error("D1 unavailable"));
    const { context } = createContext({ rateLimitKV });

    await expect(submit(context)).resolves.toBeUndefined();
  });
});
