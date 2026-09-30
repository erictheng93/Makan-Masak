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
    // customizations JSON stores major units (as MenuService does); the
    // surrounding *Cents columns above are integer cents. 200 sen -> 2.
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

  type Payload = ReturnType<typeof syntheticUberOrder>;
  const fractionalTotal = (payload: Payload) => {
    payload.payment.charges.total.amount = 24.01;
  };
  it.each([
    {
      name: "TWD whole units",
      currency: "TWD",
      encoding: "whole",
      restaurantCurrency: "TWD",
      reason: "Uber Eats TWD amount unit is unverified",
    },
    {
      name: "TWD hundredths",
      currency: "TWD",
      encoding: "hundredths",
      restaurantCurrency: "TWD",
      reason: "Uber Eats TWD amount unit is unverified",
    },
    {
      name: "fractional MYR amount",
      currency: "MYR",
      encoding: "hundredths",
      restaurantCurrency: "MYR",
      reason: "Uber Eats amount must be a safe integer",
      mutate: fractionalTotal,
    },
    {
      name: "restaurant currency mismatch",
      currency: "MYR",
      encoding: "hundredths",
      restaurantCurrency: "TWD",
      reason: "Platform order currency mismatch with restaurant",
    },
  ] as const satisfies ReadonlyArray<{
    name: string;
    currency: "MYR" | "TWD";
    encoding: "whole" | "hundredths";
    restaurantCurrency: "MYR" | "TWD";
    reason: string;
    mutate?: (payload: Payload) => void;
  }>)(
    "denies $name without creating orders and preserves the rejection log",
    async ({ currency, encoding, restaurantCurrency, reason, ...rest }) => {
      const menuItemId = await setup(restaurantCurrency);
      const payload = syntheticUberOrder(currency, encoding);
      if ("mutate" in rest) rest.mutate(payload);
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

  // TWD is blocked, so a wrong TWD conversion factor is unreachable above.
  // Add a TWD persistence case here when #408 unblocks it with real payloads.
  it.todo("persists verified TWD amounts once the raw Uber unit is confirmed");

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
