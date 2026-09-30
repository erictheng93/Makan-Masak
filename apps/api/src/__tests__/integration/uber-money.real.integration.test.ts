import { createHmac } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import { eq } from "drizzle-orm";
import {
  menuItems,
  orderItems,
  orders,
  platformIntegrations,
  platformMenuMappings,
  platformOrders,
  platformWebhookLogs,
} from "@makanmasak/database";
import type { Env } from "../../types/env";
import routes from "../../features/integrations/routes/webhook";
import { PlatformIntegrationService } from "../../features/integrations/services/PlatformIntegrationService";
import { syntheticUberOrder } from "../../features/integrations/__fixtures__/synthetic-uber-order";
import { buildSeedHelpers } from "./helpers/seed-helper";

// Only Uber's HTTP responses are simulated. Signature verification, fetching
// order details, parsing, currency checks, logging and D1 writes stay real.
let testDb: TestDatabase;
let env: Env;
beforeAll(async () => {
  testDb = await createTestDatabase();
  env = { DB: testDb.bindings.DB, ENCRYPTION_KEY: "synthetic-test-key" } as Env;
}, 300_000);
beforeEach(async () => {
  await testDb.truncateAll();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await testDb?.dispose();
});

async function setup(currency: "MYR" | "TWD") {
  const seed = buildSeedHelpers(testDb);
  const restaurant = await seed.restaurant({ settings: { currency } });
  const item = await seed.menuItem(restaurant.id, { inventoryCount: 5 });
  await testDb.drizzle.insert(platformMenuMappings).values({
    restaurantId: restaurant.id,
    platform: "uber_eats",
    platformItemId: "101",
    menuItemId: item.id,
  });
  const credentials = await new PlatformIntegrationService(
    env,
  ).encryptCredentials(
    {
      storeId: "synthetic-store",
      webhookSecret: "synthetic-signing-secret",
      accessToken: "synthetic-token",
      tokenExpiresAt: Date.now() + 3600000,
    },
    env.ENCRYPTION_KEY!,
  );
  await testDb.drizzle.insert(platformIntegrations).values({
    restaurantId: restaurant.id,
    platform: "uber_eats",
    storeId: "synthetic-store",
    enabled: true,
    credentials,
    config: { autoAcceptOrders: false },
  });
  return item.id;
}

async function deliver(
  payload: ReturnType<typeof syntheticUberOrder>,
  denyStatuses = [204],
) {
  const denied: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (
      url === `https://api.uber.com/v2/eats/order/${payload.id}` &&
      !init?.method
    ) {
      return Response.json(payload);
    }
    if (
      url ===
        `https://api.uber.com/v2/eats/orders/${payload.id}/deny_pos_order` &&
      init?.method === "POST"
    ) {
      denied.push(JSON.parse(init.body as string).reason.explanation);
      return new Response(null, { status: denyStatuses.shift() ?? 204 });
    }
    throw new Error(`Unexpected synthetic Uber request: ${url}`);
  });
  const body = JSON.stringify({
    event_id: `event-${payload.id}`,
    event_type: "orders.notification",
    meta: { user_id: payload.store.id, resource_id: payload.id },
  });
  const send = () =>
    routes.request(
      "/uber-eats",
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Uber-Signature": createHmac("sha256", "synthetic-signing-secret")
            .update(body)
            .digest("hex"),
        },
      },
      env,
    );
  return { response: await send(), send, denied };
}

describe("#408 synthetic Uber money boundaries (not sandbox evidence)", () => {
  it("persists MYR sen once, including modifiers and item quantity", async () => {
    const menuItemId = await setup("MYR");
    const { response } = await deliver(syntheticUberOrder());
    expect(response.status).toBe(200);
    const [order] = await testDb.drizzle.select().from(orders);
    const [line] = await testDb.drizzle.select().from(orderItems);
    expect(order).toMatchObject({
      totalAmountCents: 2400,
      subtotalCents: 2400,
      taxAmountCents: 0,
      notes: "Pack separately",
    });
    expect(line).toMatchObject({
      quantity: 2,
      unitPriceCents: 1200,
      totalPriceCents: 2400,
      notes: "No ice",
    });
    expect(line.customizations?.options?.[0]).toMatchObject({
      choiceName: "Oat",
      priceAdjustment: 2,
    });
    const [item] = await testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(item.inventoryCount).toBe(3);
    const [log] = await testDb.drizzle.select().from(platformWebhookLogs);
    expect(log.status).toBe("processed");
  });

  it.each([
    [
      "TWD whole units",
      "TWD",
      "whole",
      "TWD",
      "Uber Eats TWD amount unit is unverified",
    ],
    [
      "TWD hundredths",
      "TWD",
      "hundredths",
      "TWD",
      "Uber Eats TWD amount unit is unverified",
    ],
    [
      "fractional MYR amount",
      "MYR",
      "hundredths",
      "MYR",
      "Uber Eats amount must be a safe integer",
    ],
    [
      "restaurant currency mismatch",
      "MYR",
      "hundredths",
      "TWD",
      "Platform order currency mismatch with restaurant",
    ],
  ] as const)(
    "denies %s without creating orders and preserves the rejection log",
    async (_name, currency, encoding, restaurantCurrency, reason) => {
      const menuItemId = await setup(restaurantCurrency);
      const payload = syntheticUberOrder(currency, encoding);
      if (_name === "fractional MYR amount") {
        payload.payment.charges.total.amount = 24.01;
      }
      const { response, send, denied } = await deliver(payload);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        data: { acknowledged: true, rejected: true },
      });
      expect(denied).toEqual([reason]);
      const [log] = await testDb.drizzle.select().from(platformWebhookLogs);
      expect(log).toMatchObject({
        status: "failed",
        error: reason,
        platformEventId: `event-${payload.id}`,
      });
      expect(log.processedAt).not.toBeNull();
      expect((await send()).status).toBe(200);
      expect(denied).toHaveLength(1);
      expect(
        await testDb.drizzle.select().from(platformWebhookLogs),
      ).toHaveLength(1);
      expect(await testDb.drizzle.select().from(orders)).toEqual([]);
      expect(await testDb.drizzle.select().from(orderItems)).toEqual([]);
      expect(await testDb.drizzle.select().from(platformOrders)).toEqual([]);
      const [item] = await testDb.drizzle
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, menuItemId));
      expect(item.inventoryCount).toBe(5);
    },
  );

  it("keeps a failed Uber denial retryable without writing an order", async () => {
    await setup("TWD");
    const payload = syntheticUberOrder("TWD", "whole");
    const { response, send, denied } = await deliver(payload, [503, 204]);
    expect(response.status).toBe(500);
    const [log] = await testDb.drizzle.select().from(platformWebhookLogs);
    expect(log).toMatchObject({ status: "failed", platformEventId: null });
    const retry = await send();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ data: { rejected: true } });
    expect(denied).toHaveLength(2);
    const logs = await testDb.drizzle.select().from(platformWebhookLogs);
    expect(logs).toHaveLength(2);
    expect(
      logs.find((entry) => entry.platformEventId === `event-${payload.id}`),
    ).toMatchObject({
      status: "failed",
      error: "Uber Eats TWD amount unit is unverified",
    });
    expect(await testDb.drizzle.select().from(orders)).toEqual([]);
  });
});
