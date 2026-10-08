import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "../../../../api/src/__tests__/integration/helpers/real-test-app";
import { buildSeedHelpers } from "../../../../api/src/__tests__/integration/helpers/seed-helper";
import { readData } from "../../../../api/src/__tests__/helpers/read-json";

let app: RealIntegrationTestApp;
beforeAll(async () => {
  app = await createRealIntegrationTestApp();
});
afterAll(async () => {
  await app?.dispose();
});

it("a canonical customer logs in, orders without CSRF cookies, and finds only their order in history", async () => {
  const seed = buildSeedHelpers(app.testDb);
  const restaurant = await seed.restaurant({ enableShopMode: true });
  const now = Date.now();
  await app.env.DB.prepare(
    `INSERT INTO shop_subscriptions
      (id, restaurant_id, plan_tier, module_overrides, is_active,
       trial_ends_at_ms, created_at_ms, updated_at_ms)
     VALUES (?, ?, 'trial', '{}', 1, ?, ?, ?)`,
  )
    .bind(`sub-${restaurant.id}`, restaurant.id, now + 86400000, now, now)
    .run();
  const item = await seed.menuItem(restaurant.id, {
    isAvailable: true,
    priceCents: 1250,
  });
  const phone = "+886911000004";
  const otpResponse = await app.app.fetch(
    new Request("https://test/api/v1/customer/auth/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    }),
  );
  expect(otpResponse.status).toBe(200);
  const { devOtp } = await readData<{ devOtp: string }>(otpResponse);
  const loginResponse = await app.app.fetch(
    new Request("https://test/api/v1/customer/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, otp: devOtp }),
    }),
  );
  expect(loginResponse.status).toBe(200);
  const session = await readData<{
    accessToken: string;
    customer: { id: string };
  }>(loginResponse);
  const headers = {
    authorization: `Bearer ${session.accessToken}`,
    "content-type": "application/json",
    origin: "https://test",
  };
  const createResponse = await app.app.fetch(
    new Request("https://test/api/v1/orders", {
      method: "POST",
      headers,
      body: JSON.stringify({
        restaurantId: restaurant.id,
        customerPhone: phone,
        items: [{ menuItemId: item.id, quantity: 2 }],
      }),
    }),
  );
  expect(createResponse.status).toBe(201);
  const order = await readData<{ id: string; customerId: string }>(
    createResponse,
  );
  expect(order.customerId).toBe(session.customer.id);
  await seed.order(restaurant.id, { customerId: null });
  const historyResponse = await app.app.fetch(
    new Request("https://test/api/v1/customers/me/orders", { headers }),
  );
  expect(historyResponse.status).toBe(200);
  const history =
    await readData<Array<{ id: string; customerId: string }>>(historyResponse);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    id: order.id,
    customerId: session.customer.id,
  });
});
