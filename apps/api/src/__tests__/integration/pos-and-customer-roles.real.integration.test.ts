/**
 * Real integration coverage for role 4 (cashier) and role 5 (customer).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readEnvelope, type ServiceData } from "../helpers/read-json";
import type { RegisterService } from "../../features/pos/services/RegisterService";
import type { ShiftService } from "../../features/pos/services/ShiftService";
import type { CashMovementService } from "../../features/pos/services/CashMovementService";
import type { RefundService } from "../../features/pos/services/RefundService";
import type { ReceiptService } from "../../features/pos/services/ReceiptService";

/**
 * The POS services answer with a `{ success, data, error }` result and the
 * routes forward only its `data` half, so the envelope payload is that inner
 * type.
 */
type PosData<T> =
  ServiceData<T> extends { data?: infer D } ? NonNullable<D> : never;

type RegisterStatus = PosData<RegisterService["getRegisterStatus"]>;
type CurrentShift = PosData<ShiftService["getCurrentShift"]>;
type StartedShift = PosData<ShiftService["startShift"]>;
type EndedShift = PosData<ShiftService["endShift"]>;
type CashMovements = PosData<CashMovementService["getCashMovements"]>;
type Refunds = PosData<RefundService["getRefunds"]>;
type Receipts = PosData<ReceiptService["getReceipts"]>;

// GET /customers/me/orders answers with a bare array of the caller's orders.
type CustomerOrderList = Array<{ customerId: string }>;

interface OtpChallenge {
  devOtp?: string;
}

interface CustomerSession {
  accessToken: string;
  customer: { id: string };
}

type CreatedRegister = PosData<RegisterService["createRegister"]>;

const POS_BASE = "https://test/api/v1/pos";
const CUSTOMER_ORDERS_ENDPOINT = "https://test/api/v1/customers/me/orders";
const CUSTOMER_AUTH_BASE = "https://test/api/v1/customer/auth";
const DUMMY_UUID = "00000000-0000-4000-8000-000000000001";
const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  cookie: `csrf_token=${"a".repeat(64)}`,
  "x-csrf-token": "a".repeat(64),
};

describe("POS and customer role coverage", () => {
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

  async function insertActiveSubscription(restaurantId: string) {
    const now = Date.now();
    await testApp.env.DB.prepare(
      `INSERT INTO shop_subscriptions
        (id, restaurant_id, plan_tier, module_overrides,
         is_active, trial_ends_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'trial', '{}', 1, ?, ?, ?)`,
    )
      .bind(
        `sub-${restaurantId}`,
        restaurantId,
        now + 24 * 60 * 60 * 1000,
        now,
        now,
      )
      .run();
  }

  it("allows role 4 (cashier) to read register status", async () => {
    const restaurant = await seed.restaurant();
    const { restaurantRegister, cashierToken } = await setupCashierAndRegister(
      restaurant,
      "cashier-role4",
    );

    const statusRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/registers/${restaurantRegister.id}/status`, {
        headers: { authorization: `Bearer ${cashierToken}` },
      }),
    );

    expect(statusRes.status).toBe(200);
    const statusJson = await readEnvelope<RegisterStatus>(statusRes);
    expect(statusJson.success).toBe(true);
    expect(statusJson.data?.id).toBe(restaurantRegister.id);
    expect(statusJson.data?.isShiftActive).toBe(false);
  });

  it("allows role 4 (cashier) to read shift status", async () => {
    const restaurant = await seed.restaurant();
    const { restaurantRegister, cashierToken } = await setupCashierAndRegister(
      restaurant,
      "cashier-role4-shift",
    );

    const currentShiftRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/shifts/current/${restaurantRegister.id}`, {
        headers: { authorization: `Bearer ${cashierToken}` },
      }),
    );

    expect(currentShiftRes.status).toBe(200);
    const currentShiftJson = await readEnvelope<CurrentShift>(currentShiftRes);
    expect(currentShiftJson.success).toBe(true);
    expect(currentShiftJson.data).toBeNull();
  });

  it("allows role 4 (cashier) to open and end a shift", async () => {
    const restaurant = await seed.restaurant();
    const { restaurantRegister, cashier, cashierToken, cashierId } =
      await setupCashierAndRegister(restaurant, "cashier-role4-shift-open");

    const startShiftRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/shifts/start`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${cashierToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          registerId: restaurantRegister.id,
          operatorId: cashierId,
          startAmount: 100,
        }),
      }),
    );
    expect(startShiftRes.status).toBe(200);
    const startShiftJson = await readEnvelope<StartedShift>(startShiftRes);
    expect(startShiftJson.success).toBe(true);
    const shiftId = startShiftJson.data?.id as string;
    expect(shiftId).toBeTypeOf("string");

    const endShiftRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/shifts/${shiftId}/end`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${cashierToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actualAmount: 100,
        }),
      }),
    );
    expect(endShiftRes.status).toBe(200);
    const endShiftJson = await readEnvelope<EndedShift>(endShiftRes);
    expect(endShiftJson.success).toBe(true);
    expect(endShiftJson.data?.shift?.id).toBe(shiftId);
  });

  it("allows role 4 (cashier) to read cash-movement lists", async () => {
    const restaurant = await seed.restaurant();
    const { restaurantRegister, cashier, cashierToken, cashierId } =
      await setupCashierAndRegister(restaurant, "cashier-role4-movement");

    const startShiftRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/shifts/start`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${cashierToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          registerId: restaurantRegister.id,
          operatorId: cashierId,
          startAmount: 20,
        }),
      }),
    );
    expect(startShiftRes.status).toBe(200);
    const startShiftJson = await readEnvelope<StartedShift>(startShiftRes);
    const shiftId = startShiftJson.data?.id as string;

    const movementsRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/shifts/${shiftId}/cash-movements`, {
        headers: { authorization: `Bearer ${cashierToken}` },
      }),
    );

    expect(movementsRes.status).toBe(200);
    const movementsJson = await readEnvelope<CashMovements>(movementsRes);
    expect(movementsJson.success).toBe(true);
    expect(Array.isArray(movementsJson.data?.movements)).toBe(true);
  });

  it("allows role 4 (cashier) to read refunds and receipts", async () => {
    const restaurant = await seed.restaurant();
    const { restaurantRegister, cashierToken } = await setupCashierAndRegister(
      restaurant,
      "cashier-role4-list",
    );

    const refundsRes = await testApp.app.fetch(
      new Request(
        `${POS_BASE}/refunds/registers/${restaurantRegister.id}/refunds`,
        { headers: { authorization: `Bearer ${cashierToken}` } },
      ),
    );
    expect(refundsRes.status).toBe(200);
    const refundsJson = await readEnvelope<Refunds>(refundsRes);
    expect(refundsJson.success).toBe(true);
    expect(Array.isArray(refundsJson.data?.refunds)).toBe(true);

    const receiptsRes = await testApp.app.fetch(
      new Request(
        `${POS_BASE}/receipts/registers/${restaurantRegister.id}/receipts`,
        { headers: { authorization: `Bearer ${cashierToken}` } },
      ),
    );
    expect(receiptsRes.status).toBe(200);
    const receiptsJson = await readEnvelope<Receipts>(receiptsRes);
    expect(receiptsJson.success).toBe(true);
    expect(Array.isArray(receiptsJson.data?.receipts)).toBe(true);
  });

  it("denies role 4 (cashier) from creating registers", async () => {
    const restaurant = await seed.restaurant();
    await insertActiveSubscription(String(restaurant.id));
    const cashier = await seed.user({
      username: "cashier-role4-create-deny",
      role: 4,
      restaurantId: String(restaurant.id),
    });
    const cashierToken = await testApp.authHelper.staffToken(
      cashier.id,
      4,
      String(restaurant.id),
    );

    const res = await testApp.app.fetch(
      new Request(`${POS_BASE}/registers`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${cashierToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Should Be Denied",
          restaurantId: String(restaurant.id),
        }),
      }),
    );

    expect(res.status).toBe(403);
    const json = await readEnvelope(res);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBe("INSUFFICIENT_ROLE");
  });

  it("denies role 4 (cashier) from updating/deleting/register activation", async () => {
    const restaurant = await seed.restaurant();
    const { restaurantRegister, cashierToken } = await setupCashierAndRegister(
      restaurant,
      "cashier-role4-deny-admin-only",
    );

    const updateRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/registers/${restaurantRegister.id}`, {
        method: "PUT",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${cashierToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Blocked Update",
        }),
      }),
    );
    expect(updateRes.status).toBe(403);
    const updateJson = await readEnvelope(updateRes);
    expect(updateJson.success).toBe(false);
    expect(updateJson.error?.code).toBe("INSUFFICIENT_ROLE");

    const activateRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/registers/${restaurantRegister.id}/activate`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${cashierToken}`,
        },
      }),
    );
    expect(activateRes.status).toBe(403);
    const activateJson = await readEnvelope(activateRes);
    expect(activateJson.success).toBe(false);
    expect(activateJson.error?.code).toBe("INSUFFICIENT_ROLE");

    const deleteRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/registers/${restaurantRegister.id}`, {
        method: "DELETE",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${cashierToken}`,
        },
      }),
    );
    expect(deleteRes.status).toBe(403);
    const deleteJson = await readEnvelope(deleteRes);
    expect(deleteJson.success).toBe(false);
    expect(deleteJson.error?.code).toBe("INSUFFICIENT_ROLE");
  });

  it("denies role 4 (cashier) from roles that are owner/admin only", async () => {
    const ownerOnlyPaths = [
      "/cash-movements/00000000-0000-4000-8000-000000000002/approve",
      "/cash-movements/00000000-0000-4000-8000-000000000003/reject",
      "/refunds/00000000-0000-4000-8000-000000000004/approve",
      "/refunds/00000000-0000-4000-8000-000000000005/reject",
      "/refunds/00000000-0000-4000-8000-000000000006/cancel",
      "/shifts/stats?restaurantId=00000000-0000-4000-8000-000000000007",
      // /reports/daily is not here: since #371 a cashier may read their own
      // restaurant's day (and only theirs), covered in
      // pos-shift-report-tenancy.real.integration.test.ts.
      "/reports/export?type=daily&startDate=2026-01-01",
    ];

    const restaurant = await seed.restaurant();
    const { cashierToken } = await setupCashierAndRegister(
      restaurant,
      "cashier-owner-only-deny",
    );

    for (const path of ownerOnlyPaths) {
      const isPost = path.includes("/activate")
        ? true
        : path.startsWith("/cash-movements/") ||
            path.startsWith("/refunds/") ||
            path.startsWith("/shifts/stats") ||
            path.startsWith("/reports/") ||
            path.startsWith("/cash-movements/") ||
            path.includes("/appro")
          ? false
          : false;
      // simplify method selection per case
      const method =
        path.includes("/activate") ||
        path.includes("/approve") ||
        path.includes("/reject") ||
        path.includes("/cancel")
          ? "POST"
          : "GET";

      const denyRes = await testApp.app.fetch(
        new Request(`${POS_BASE}${path}`, {
          method,
          headers: {
            ...CSRF_HEADERS,
            authorization: `Bearer ${cashierToken}`,
          },
        }),
      );

      expect(denyRes.status).toBe(403);
      const denyJson = await readEnvelope(denyRes);
      expect(denyJson.success).toBe(false);
      expect(denyJson.error?.code).toBe("INSUFFICIENT_ROLE");
    }
  });

  it("allows role 5 (customer) to read /api/v1/customers/me/orders", async () => {
    const restaurant = await seed.restaurant();
    const customer100 = await loginCustomerSession("+886921000001");
    const customer200 = await loginCustomerSession("+886922000002");

    await seed.order(restaurant.id, { customerId: customer100.customer.id });
    await seed.order(restaurant.id, { customerId: customer200.customer.id });

    const res = await testApp.app.fetch(
      new Request(CUSTOMER_ORDERS_ENDPOINT, {
        headers: { authorization: `Bearer ${customer100.accessToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const orders = await readData<CustomerOrderList>(res);
    expect(Array.isArray(orders)).toBe(true);
    expect(orders).toHaveLength(1);
    expect(orders[0].customerId).toBe(customer100.customer.id);
  });

  it("rejects role 5 (customer) from cashier APIs", async () => {
    const customerSession = await loginCustomerSession("+886911000000");
    const res = await testApp.app.fetch(
      new Request(`${POS_BASE}/registers`, {
        headers: {
          authorization: `Bearer ${customerSession.accessToken}`,
        },
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
    const requestOtpRes = await testApp.app.fetch(
      new Request(`${CUSTOMER_AUTH_BASE}/request-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      }),
    );
    const requestOtp = await readData<OtpChallenge>(requestOtpRes);

    const verifyRes = await testApp.app.fetch(
      new Request(`${CUSTOMER_AUTH_BASE}/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone,
          otp: requestOtp.devOtp,
        }),
      }),
    );
    const session = await readData<CustomerSession>(verifyRes);

    return {
      accessToken: session.accessToken,
      customer: { id: session.customer.id },
    };
  }

  async function setupCashierAndRegister(
    restaurant: { id: string | number },
    usernamePrefix: string,
  ): Promise<{
    restaurantRegister: { id: string };
    cashier: { id: string; username: string };
    cashierId: string;
    cashierToken: string;
  }> {
    await insertActiveSubscription(String(restaurant.id));

    const owner = await seed.user({
      username: `${usernamePrefix}-owner`,
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const ownerToken = await testApp.authHelper.ownerToken(
      owner.id,
      String(restaurant.id),
    );

    const registerRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/registers`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: `${usernamePrefix} Register`,
          restaurantId: String(restaurant.id),
        }),
      }),
    );
    expect(registerRes.status).toBe(200);
    const register = await readData<CreatedRegister>(registerRes);

    const cashier = await seed.user({
      username: `${usernamePrefix}-cashier`,
      role: 4,
      restaurantId: String(restaurant.id),
    });
    const cashierToken = await testApp.authHelper.staffToken(
      cashier.id,
      4,
      String(restaurant.id),
    );

    return {
      restaurantRegister: { id: register.id },
      cashier: {
        id: cashier.id,
        username: cashier.username,
      },
      cashierId: cashier.id,
      cashierToken,
    };
  }
});
