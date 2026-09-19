/**
 * Real integration smoke - Customer Orders API
 * GET /api/v1/customers/me/orders
 *
 * This suite verifies the customer-facing orders path now works end-to-end.
 *
 * The endpoint `GET /api/v1/customers/me/orders` must accept canonical
 * customer tokens and scope results to the authenticated customer.
 *
 * The tests below assert the identity-cleanup behavior: customers should
 * receive 200 and only see their own orders by `customers.id`, while
 * staff/owners are not accepted as customers.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readEnvelope } from "../helpers/read-json";

interface OtpChallenge {
  devOtp?: string;
}

interface CustomerSession {
  accessToken: string;
  customer: { id: string };
}

type CustomerOrderList = Array<{ id: string; customerId: string }>;
const ENDPOINT = "https://test/api/v1/customers/me/orders";

describe("Customer Orders API - real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await testApp.app.fetch(new Request(ENDPOINT));

    expect(res.status).toBe(401);
    const json = await readEnvelope<CustomerOrderList>(res);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBeDefined();
  });

  it("returns 200 for a canonical customer token and scopes orders to that customer", async () => {
    const restaurant = await seed.restaurant();
    const customer100 = await loginCustomerSession("+886911111100");
    const customer200 = await loginCustomerSession("+886922222200");

    await seed.order(restaurant.id, { customerId: customer100.customer.id });
    await seed.order(restaurant.id, { customerId: customer200.customer.id });

    const res = await testApp.app.fetch(
      new Request(ENDPOINT, {
        headers: { authorization: `Bearer ${customer100.accessToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const orders = await readData<CustomerOrderList>(res);
    expect(Array.isArray(orders)).toBe(true);
    expect(orders).toHaveLength(1);
    expect(orders[0].customerId).toBe(customer100.customer.id);
  });

  // A customer's history spans restaurants, so one app-wide currency cannot
  // format it: each order names the currency its amounts are in.
  it("labels each order with its own restaurant's currency", async () => {
    const twd = await seed.restaurant({ settings: {} });
    const myr = await seed.restaurant({ settings: { currency: "MYR" } });
    const customer = await loginCustomerSession("+886933333300");
    const twdOrder = await seed.order(twd.id, {
      customerId: customer.customer.id,
    });
    const myrOrder = await seed.order(myr.id, {
      customerId: customer.customer.id,
    });

    const res = await testApp.app.fetch(
      new Request(ENDPOINT, {
        headers: { authorization: `Bearer ${customer.accessToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        currency?: string;
        restaurant?: Record<string, unknown>;
      }>;
      pagination: { total: number };
    };
    expect(body.pagination.total).toBe(2);
    const currencyById = Object.fromEntries(
      body.data.map((order) => [order.id, order.currency]),
    );
    expect(currencyById).toEqual({
      [twdOrder.id]: "TWD",
      [myrOrder.id]: "MYR",
    });
    for (const order of body.data) {
      expect(order.restaurant).not.toHaveProperty("settings");
    }
  });

  it("returns 401 for a staff/owner token because customers routes require canonical customer auth", async () => {
    const restaurant = await seed.restaurant();

    const owner = await seed.user({
      id: 10,
      role: 1,
      username: "owner-user",
    });

    const ownerToken = await testApp.authHelper.ownerToken(
      owner.id,
      String(restaurant.id),
    );

    const res = await testApp.app.fetch(
      new Request(ENDPOINT, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );

    expect(res.status).toBe(401);
    const json = await readEnvelope(res);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBeDefined();
  });

  async function loginCustomerSession(phone: string): Promise<{
    accessToken: string;
    customer: { id: string };
  }> {
    const otpRes = await testApp.app.fetch(
      new Request("https://test/api/v1/customer/auth/request-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      }),
    );
    const otpJson = await readData<OtpChallenge>(otpRes);

    const verifyRes = await testApp.app.fetch(
      new Request("https://test/api/v1/customer/auth/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, otp: otpJson.devOtp }),
      }),
    );
    const verifyJson = await readData<CustomerSession>(verifyRes);

    return {
      accessToken: verifyJson.accessToken,
      customer: { id: verifyJson.customer.id },
    };
  }
});
