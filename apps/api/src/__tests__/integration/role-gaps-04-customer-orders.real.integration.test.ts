import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readEnvelope } from "../helpers/read-json";
import { eq, orders, seats, tables } from "@makanmasak/database";
import { buildSignedQRUrl } from "@makanmasak/utils";

interface OtpChallenge {
  devOtp?: string;
}

interface CustomerSession {
  accessToken: string;
  customer: { id: string };
}

interface CustomerOrder {
  id: string;
  orderNumber: string;
  customerId?: string;
}

const ORDERS_ENDPOINT = "https://test/api/v1/orders";
const CUSTOMER_ORDERS_ENDPOINT = "https://test/api/v1/customers/me/orders";
const CUSTOMER_AUTH_BASE = "https://test/api/v1/customer/auth";

function csrfHeaders(token: string) {
  return {
    host: "test",
    origin: "https://test",
    "x-csrf-token": token,
    cookie: `csrf_token=${token}`,
  };
}

describe("Role gap coverage: customer order flow with CSRF and idempotency", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    if (testApp) {
      await testApp.dispose();
    }
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  async function insertActiveSubscription(restaurantId: string) {
    await testApp.env.DB.prepare(
      `INSERT INTO shop_subscriptions
        (id, restaurant_id, plan_tier, module_overrides,
         is_active, trial_ends_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'trial', '{}', 1, ?, ?, ?)`,
    )
      .bind(
        `sub-${restaurantId}`,
        restaurantId,
        Date.now() + 24 * 60 * 60 * 1000,
        Date.now(),
        Date.now(),
      )
      .run();
  }

  function buildOrderPayload(restaurantId: string, menuItemId: number) {
    return {
      restaurantId,
      customerPhone: "0912345678",
      items: [{ menuItemId, quantity: 1 }],
    };
  }

  async function loginCustomerSession(phone: string): Promise<{
    accessToken: string;
    customer: { id: string };
  }> {
    const requestOtpRes = await testApp.app.fetch(
      new Request(`${CUSTOMER_AUTH_BASE}/request-otp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ phone }),
      }),
    );
    const requestOtpJson = await readData<OtpChallenge>(requestOtpRes);

    const verifyRes = await testApp.app.fetch(
      new Request(`${CUSTOMER_AUTH_BASE}/verify-otp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          phone,
          otp: requestOtpJson.devOtp,
        }),
      }),
    );
    const verifyJson = await readData<CustomerSession>(verifyRes);

    return {
      accessToken: verifyJson.accessToken,
      customer: { id: verifyJson.customer.id },
    };
  }

  it("returns 403 for POST /api/v1/orders when CSRF header is missing", async () => {
    const restaurant = await seed.restaurant();
    await insertActiveSubscription(String(restaurant.id));

    const customer = await seed.user({
      username: "customer-04-no-csrf",
      role: 5,
      restaurantId: String(restaurant.id),
    });
    const customerToken = await testApp.authHelper.staffToken(
      customer.id,
      5,
      String(restaurant.id),
    );

    const menuItem = await seed.menuItem(restaurant.id, {
      isAvailable: true,
      price: 100,
    });

    const payload = buildOrderPayload(String(restaurant.id), menuItem.id);

    const res = await testApp.app.fetch(
      new Request(ORDERS_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${customerToken}`,
          "content-type": "application/json",
          host: "test",
          origin: "https://test",
        },
        body: JSON.stringify(payload),
      }),
    );

    expect(res.status).toBe(403);
    const json = await readEnvelope(res);
    expect(json.success).toBe(false);
  });

  it("allows role 5 legacy user token to create an order with valid CSRF token", async () => {
    const restaurant = await seed.restaurant({ enableShopMode: true });
    await insertActiveSubscription(String(restaurant.id));

    const customer = await seed.user({
      username: "customer-04-order",
      role: 5,
      restaurantId: String(restaurant.id),
    });
    const customerToken = await testApp.authHelper.staffToken(
      customer.id,
      5,
      String(restaurant.id),
    );

    const menuItem = await seed.menuItem(restaurant.id, {
      isAvailable: true,
      price: 120,
    });
    const payload = buildOrderPayload(String(restaurant.id), menuItem.id);

    const csrfToken = "a".repeat(64);
    const createRes = await testApp.app.fetch(
      new Request(ORDERS_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${customerToken}`,
          "content-type": "application/json",
          ...csrfHeaders(csrfToken),
        },
        body: JSON.stringify(payload),
      }),
    );

    expect(createRes.status).toBe(201);
    const created = await readData<CustomerOrder>(createRes);
    expect(String(created.id)).toBeTruthy();
  });

  it.each(["legacy", "canonical"])(
    "requires matching dine-in QR proof for %s customer orders",
    async (credential) => {
      const restaurant = await seed.restaurant({ enableShopMode: true });
      await insertActiveSubscription(restaurant.id);
      const menuItem = await seed.menuItem(restaurant.id);
      const token =
        credential === "canonical"
          ? (await loginCustomerSession("+886911000099")).accessToken
          : await testApp.authHelper.staffToken(
              (await seed.user({ role: 5, restaurantId: restaurant.id })).id,
              5,
              restaurant.id,
            );
      const [table] = await testApp.testDb.drizzle
        .insert(tables)
        .values({ restaurantId: restaurant.id, number: "A1", qrCode: "tbl-a1" })
        .returning();
      const otherRestaurant = await seed.restaurant();
      const [otherTable] = await testApp.testDb.drizzle
        .insert(tables)
        .values({
          restaurantId: otherRestaurant.id,
          number: "B1",
          qrCode: "tbl-b1",
        })
        .returning();
      const [seat] = await testApp.testDb.drizzle
        .insert(seats)
        .values({ tableId: table.id, seatNumber: "01", qrCode: "seat-a1-01" })
        .returning();
      const qrCode = await buildSignedQRUrl(
        "https://test",
        {
          type: "seat",
          restaurantId: restaurant.id,
          tableId: table.id,
          identifier: seat.seatNumber,
          version: 1,
        },
        testApp.env.QR_SIGNING_KEY,
      );
      const post = (selection: Record<string, unknown>) =>
        testApp.app.fetch(
          new Request(ORDERS_ENDPOINT, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              ...csrfHeaders("d".repeat(64)),
            },
            body: JSON.stringify({
              ...buildOrderPayload(restaurant.id, menuItem.id),
              ...selection,
            }),
          }),
        );

      expect((await post({ seatId: seat.id })).status).toBe(400);
      expect(
        (await post({ seatId: seat.id, tableId: table.id, orderType: "shop" }))
          .status,
      ).toBe(400);
      const missingQr = await post({ tableId: table.id });
      expect(missingQr.status).toBe(403);
      await expect(missingQr.json()).resolves.toMatchObject({
        error: { code: "QR_VERIFICATION_FAILED" },
      });
      expect(
        (
          await post({
            orderType: "seat",
            tableId: otherTable.id,
            seatId: seat.id,
            qrCode,
          })
        ).status,
      ).toBe(403);
      expect(await testApp.testDb.drizzle.select().from(orders)).toHaveLength(
        0,
      );

      const valid = await post({
        orderType: "seat",
        tableId: table.id,
        seatId: seat.id,
        qrCode,
      });
      expect(valid.status).toBe(201);
      const created = await readData<CustomerOrder>(valid);
      const [row] = await testApp.testDb.drizzle
        .select({ tableId: orders.tableId, seatId: orders.seatId })
        .from(orders)
        .where(eq(orders.id, created.id));
      expect(row).toEqual({
        tableId: table.id,
        seatId: credential === "canonical" ? seat.id : null,
      });
    },
  );

  it("does not dedupe repeated POST for identical payload + token when no idempotency key binding exists", async () => {
    const restaurant = await seed.restaurant({ enableShopMode: true });
    await insertActiveSubscription(String(restaurant.id));

    const customer = await seed.user({
      username: "customer-04-replay",
      role: 5,
      restaurantId: String(restaurant.id),
    });
    const customerToken = await testApp.authHelper.staffToken(
      customer.id,
      5,
      String(restaurant.id),
    );

    const menuItem = await seed.menuItem(restaurant.id, {
      isAvailable: true,
      price: 120,
    });
    const payload = buildOrderPayload(String(restaurant.id), menuItem.id);
    const headers = {
      authorization: `Bearer ${customerToken}`,
      "content-type": "application/json",
      ...csrfHeaders("b".repeat(64)),
      "x-idempotency-key": "idem-key-fixed-2026",
    };

    const firstRes = await testApp.app.fetch(
      new Request(ORDERS_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }),
    );
    expect(firstRes.status).toBe(201);
    const firstJson = await readData<CustomerOrder>(firstRes);

    const secondRes = await testApp.app.fetch(
      new Request(ORDERS_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }),
    );
    expect(secondRes.status).toBe(201);
    const second = await readData<CustomerOrder>(secondRes);

    expect(second.id).not.toBe(firstJson.id);
    expect(second.orderNumber).not.toBe(firstJson.orderNumber);
  });

  it("returns 401 for /customers/me/orders with non-canonical staff role token", async () => {
    const restaurant = await seed.restaurant();
    await insertActiveSubscription(String(restaurant.id));
    const staffCustomer = await seed.user({
      username: "customer-04-role5",
      role: 5,
      restaurantId: String(restaurant.id),
    });
    const staffToken = await testApp.authHelper.staffToken(
      staffCustomer.id,
      5,
      String(restaurant.id),
    );

    const listRes = await testApp.app.fetch(
      new Request(CUSTOMER_ORDERS_ENDPOINT, {
        headers: { authorization: `Bearer ${staffToken}` },
      }),
    );

    expect(listRes.status).toBe(401);
    const listJson = await readEnvelope(listRes);
    expect(listJson.success).toBe(false);
  });

  it("binds /customers/me/orders to canonical customer token and scopes by customer id", async () => {
    const restaurant = await seed.restaurant();
    const { accessToken: tokenA, customer: customerA } =
      await loginCustomerSession("+886911000001");
    const { accessToken: tokenB, customer: customerB } =
      await loginCustomerSession("+886922000002");

    await seed.order(restaurant.id, { customerId: customerA.id });
    await seed.order(restaurant.id, { customerId: customerB.id });

    const listARes = await testApp.app.fetch(
      new Request(CUSTOMER_ORDERS_ENDPOINT, {
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    );
    expect(listARes.status).toBe(200);
    const listA = await readData<CustomerOrder[]>(listARes);
    expect(Array.isArray(listA)).toBe(true);
    expect(listA).toHaveLength(1);
    expect(listA[0].customerId).toBe(customerA.id);
    expect(listA[0].customerId).not.toBe(customerB.id);
  });
});
