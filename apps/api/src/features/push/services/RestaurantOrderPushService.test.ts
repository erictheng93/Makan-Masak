import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  buildSeedHelpers,
  type SeedHelpers,
} from "../../../__tests__/integration/helpers/seed-helper";
import type { Env } from "../../../types/env";
import { RestaurantOrderPushService } from "./RestaurantOrderPushService";

function createEnv(options: {
  deliverer?: Env["WEB_PUSH_DELIVERER"];
  subscriptionStatus?: number;
}): Env {
  const subscriptionKey =
    "push:subscription:restaurant-1:user-1:subscription-1";

  return {
    WEB_PUSH_DELIVERER: options.deliverer,
    CACHE_KV: {
      list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => ({
        keys:
          prefix === "push:subscription:restaurant-1:"
            ? [{ name: subscriptionKey }]
            : [],
      })),
      get: vi.fn(async (key: string) => {
        if (key !== subscriptionKey) return null;
        return {
          id: "subscription-1",
          restaurantId: "restaurant-1",
          subscription: {
            endpoint: "https://push.example/subscription-1",
            keys: {
              p256dh: "p256dh-key",
              auth: "auth-key",
            },
          },
        };
      }),
      put: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as Env;
}

describe("RestaurantOrderPushService", () => {
  it("delivers new order notifications to restaurant subscriptions", async () => {
    const deliverer = vi.fn(async () => ({ ok: true, status: 201 }));
    const env = createEnv({ deliverer });

    const result = await new RestaurantOrderPushService(env).notifyNewOrder({
      restaurantId: "restaurant-1",
      orderId: "order-1001",
      orderNumber: "A001",
      orderSource: "market_checkout",
      totalAmount: 120,
      itemCount: 2,
      customerName: "Market Guest",
      notes: "市場結帳：逢甲夜市 / fengjia / checkout-1",
    });

    expect(result).toEqual({ attempted: 1, delivered: 1 });
    expect(deliverer).toHaveBeenCalledWith({
      subscription: {
        id: "subscription-1",
        endpoint: "https://push.example/subscription-1",
        p256dhKey: "p256dh-key",
        authKey: "auth-key",
      },
      payload: expect.objectContaining({
        type: "new_order",
        orderId: "order-1001",
        orderNumber: "A001",
        orderSource: "market_checkout",
        title: "市場結帳新訂單",
        priority: "high",
        requireInteraction: true,
      }),
    });
  });

  it("cleans up expired push subscriptions", async () => {
    const deliverer = vi.fn(async () => ({ ok: false, status: 410 }));
    const env = createEnv({ deliverer });

    const result = await new RestaurantOrderPushService(env).notifyNewOrder({
      restaurantId: "restaurant-1",
      orderId: "order-1002",
      orderNumber: "A002",
      totalAmount: 80,
      itemCount: 1,
    });

    expect(result).toEqual({ attempted: 1, delivered: 0 });
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      "push:subscription:restaurant-1:user-1:subscription-1",
    );
  });

  it("does not read subscriptions when no push deliverer is configured", async () => {
    const env = createEnv({});

    const result = await new RestaurantOrderPushService(env).notifyNewOrder({
      restaurantId: "restaurant-1",
      orderId: "order-1003",
      orderNumber: "A003",
      totalAmount: 60,
      itemCount: 1,
    });

    expect(result).toEqual({ attempted: 0, delivered: 0 });
    expect(env.CACHE_KV.list).not.toHaveBeenCalled();
  });

  it("does not deliver when web push is disabled", async () => {
    const deliverer = vi.fn(async () => ({ ok: true, status: 201 }));
    const env = createEnv({ deliverer });
    env.WEB_PUSH_ENABLED = "false";

    const result = await new RestaurantOrderPushService(env).notifyNewOrder({
      restaurantId: "restaurant-1",
      orderId: "order-1004",
      orderNumber: "A004",
      totalAmount: 60,
      itemCount: 1,
    });

    expect(result).toEqual({ attempted: 0, delivered: 0 });
    expect(env.CACHE_KV.list).not.toHaveBeenCalled();
    expect(deliverer).not.toHaveBeenCalled();
  });

  it.each([
    ["TWD", 120, "A001 · 2 items · NT$120"],
    ["MYR", 12.5, "A001 · 2 items · RM 12.50"],
    ["VND", 350000, "A001 · 2 items · 350.000 ₫"],
  ] as const)("writes the total in %s", async (currency, totalAmount, body) => {
    const deliverer = vi.fn(async () => ({ ok: true, status: 201 }));
    const env = createEnv({ deliverer });

    await new RestaurantOrderPushService(env).notifyNewOrder({
      restaurantId: "restaurant-1",
      orderId: "order-1001",
      orderNumber: "A001",
      totalAmount,
      itemCount: 2,
      currency,
    });

    expect(deliverer).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ body }),
      }),
    );
  });
});

describe("RestaurantOrderPushService currency lookup (real D1)", () => {
  let testDb: TestDatabase;
  let seed: SeedHelpers;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    seed = buildSeedHelpers(testDb);
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  async function pushBodyFor(settings: Record<string, unknown> | null) {
    await testDb.truncateAll();
    const restaurant = await seed.restaurant({ settings });
    const deliverer = vi.fn(async () => ({ ok: true, status: 201 }));
    await testDb.bindings.CACHE_KV.put(
      `push:subscription:${restaurant.id}:user-1:subscription-1`,
      JSON.stringify({
        id: "subscription-1",
        restaurantId: restaurant.id,
        subscription: {
          endpoint: "https://push.example/subscription-1",
          keys: { p256dh: "p256dh-key", auth: "auth-key" },
        },
      }),
    );
    const env = {
      DB: testDb.bindings.DB,
      CACHE_KV: testDb.bindings.CACHE_KV,
      WEB_PUSH_DELIVERER: deliverer,
    } as unknown as Env;

    await new RestaurantOrderPushService(env).notifyNewOrder({
      restaurantId: restaurant.id,
      orderId: "order-1",
      orderNumber: "A001",
      totalAmount: 12.5,
      itemCount: 1,
    });
    expect(deliverer).toHaveBeenCalledOnce();
    const call = deliverer.mock.calls[0] as unknown as [
      { payload: { body: string } },
    ];
    return call[0].payload.body;
  }

  it("reads the restaurant's saved currency", async () => {
    expect(await pushBodyFor({ currency: "MYR" })).toBe(
      "A001 · 1 items · RM 12.50",
    );
  });

  it("falls back to the platform default when none is saved", async () => {
    expect(await pushBodyFor(null)).toBe("A001 · 1 items · NT$13");
  });
});
