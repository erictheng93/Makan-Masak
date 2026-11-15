import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  restaurants,
  shopSubscriptions,
  usageEvents,
} from "@makanmasak/database";
import type { Env } from "../../types/env";
import { enforceQuota } from "../../middleware/quotaGate";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.dispose();
});

beforeEach(async () => {
  await testDb.truncateAll();
});

const restaurantId = "quota-restaurant";

async function seedTrialShop(orderCount: number) {
  await testDb.drizzle.insert(restaurants).values({
    id: restaurantId,
    name: "Quota Test Restaurant",
    type: "street_food",
    category: "snack",
    address: "1 Test Rd",
    district: "West",
    phone: "0900000000",
  });
  await testDb.drizzle.insert(shopSubscriptions).values({
    restaurantId,
    planTier: "trial",
    isActive: true,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    trialEndsAt: new Date("2026-06-15T00:00:00Z"),
  });
  await testDb.drizzle.insert(usageEvents).values({
    restaurantId,
    meterKey: "orders.created",
    quantity: orderCount,
  });
}

function buildContext() {
  const headers = new Headers();
  const waitUntilPromises: Array<Promise<unknown>> = [];
  const context = {
    env: {
      DB: testDb.bindings.DB,
      CACHE_KV: testDb.bindings.CACHE_KV,
      QUOTA_ENFORCEMENT_MODE: "enforce",
    } as Env,
    get: (key: string) =>
      key === "user" ? { role: 1, restaurantId } : undefined,
    header: (key: string, value: string) => headers.set(key, value),
    executionCtx: {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      },
    },
  };
  return { context, headers, waitUntilPromises };
}

describe("enforceQuota", () => {
  it("throws a 429 quota error when enforcement mode is enabled and trial usage reaches the 3000 order limit", async () => {
    await seedTrialShop(3000);
    const { context, headers, waitUntilPromises } = buildContext();

    await expect(
      enforceQuota(context as never, "orders.created"),
    ).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      status: 429,
    });
    await Promise.all(waitUntilPromises);
    expect(headers.get("X-Quota-Warning")).toBe("orders.created 100%");
  });

  it("lets a trial shop at 2999 orders order once more, with a warning", async () => {
    await seedTrialShop(2999);
    const { context, headers } = buildContext();

    await expect(
      enforceQuota(context as never, "orders.created"),
    ).resolves.toBeUndefined();
    expect(headers.get("X-Quota-Warning")).toBe("orders.created 99%");
  });

  it("trips the soft threshold at order 2400 without refusing", async () => {
    await seedTrialShop(2400);
    const { context, headers } = buildContext();

    await expect(
      enforceQuota(context as never, "orders.created"),
    ).resolves.toBeUndefined();
    expect(headers.get("X-Quota-Warning")).toBe("orders.created 80%");
  });

  it("stays silent below the soft threshold", async () => {
    await seedTrialShop(2399);
    const { context, headers } = buildContext();

    await enforceQuota(context as never, "orders.created");
    expect(headers.has("X-Quota-Warning")).toBe(false);
  });
});
