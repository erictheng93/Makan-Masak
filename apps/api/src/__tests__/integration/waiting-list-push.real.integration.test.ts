import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";
import { readData } from "../helpers/read-json";

interface WaitingListEntry {
  id: number;
  customerId: string | null;
}

interface OtpChallenge {
  devOtp?: string;
}

interface CustomerSession {
  accessToken: string;
  customer: { id: string };
}

const CUSTOMER_BASE = "https://test/api/v1/customer";
const WAITING_BASE = "https://test/api/v1/waiting-list";
const CSRF = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("Waiting-list push notifications - real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: SeedHelpers;

  beforeAll(async () => {
    // Customer web push ships switched off (#399); these cases exercise the
    // customer subscription route, so the suite turns it on for itself.
    testApp = await createRealIntegrationTestApp({
      env: { CUSTOMER_WEB_PUSH_ENABLED: "true" } as never,
    });
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  it("links canonical customer tickets and sends waiting_called push on call", async () => {
    const deliveries: Array<{
      endpoint: string;
      payload: Record<string, unknown>;
    }> = [];
    testApp.env.WEB_PUSH_DELIVERER = async (delivery) => {
      deliveries.push({
        endpoint: delivery.subscription.endpoint,
        payload: delivery.payload,
      });
      return { ok: true, status: 201 };
    };

    const restaurant = await seed.restaurant();
    await insertSubscription(String(restaurant.id));
    const tableId = await insertTable(String(restaurant.id));
    const staff = await seed.user({ role: 1, restaurantId: restaurant.id });
    const staffToken = await testApp.authHelper.ownerToken(
      staff.id,
      String(restaurant.id),
    );
    const customerSession = await loginCustomer("+886912345678");

    await authedCustomerPost(
      customerSession.accessToken,
      "push-subscriptions",
      {
        endpoint: "https://push.example.test/waiting-called",
        p256dh: "p256dh-key",
        auth: "auth-key",
        deviceLabel: "Browser",
      },
    );

    const joinRes = await testApp.app.fetch(
      new Request(WAITING_BASE, {
        method: "POST",
        headers: {
          authorization: `Bearer ${customerSession.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          restaurantId: String(restaurant.id),
          customerName: "Push Customer",
          customerPhone: "0912345678",
          partySize: 2,
        }),
      }),
    );

    expect(joinRes.status).toBe(201);
    const joinJson = await readData<WaitingListEntry>(joinRes);
    expect(joinJson.customerId).toBe(customerSession.customerId);

    const callRes = await testApp.app.fetch(
      new Request(`${WAITING_BASE}/${joinJson.id}/call`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${staffToken}`,
          "content-type": "application/json",
          host: "test",
          origin: "https://test",
          "x-csrf-token": CSRF,
          cookie: `csrf_token=${CSRF}`,
        },
        body: JSON.stringify({ tableId }),
      }),
    );

    expect(callRes.status).toBe(200);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      endpoint: "https://push.example.test/waiting-called",
      payload: {
        type: "waiting_called",
        ticketId: joinJson.id,
        restaurantId: String(restaurant.id),
        url: `/r/${restaurant.id}/wait-list/${joinJson.id}`,
      },
    });

    const row = await testApp.env.DB.prepare(
      `SELECT notified_at, status
         FROM waiting_list
        WHERE id = ?`,
    )
      .bind(joinJson.id)
      .first<{ notified_at: number | null; status: string }>();
    expect(row?.status).toBe("called");
    expect(row?.notified_at).toBeTypeOf("number");
  });

  async function loginCustomer(
    phone: string,
  ): Promise<{ accessToken: string; customerId: string }> {
    const otpRes = await testApp.app.fetch(
      new Request(`${CUSTOMER_BASE}/auth/request-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      }),
    );
    const otpJson = await readData<OtpChallenge>(otpRes);

    const verifyRes = await testApp.app.fetch(
      new Request(`${CUSTOMER_BASE}/auth/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, otp: otpJson.devOtp }),
      }),
    );
    const verifyJson = await readData<CustomerSession>(verifyRes);
    return {
      accessToken: verifyJson.accessToken,
      customerId: verifyJson.customer.id,
    };
  }

  function authedCustomerPost(
    accessToken: string,
    path: string,
    body: unknown,
  ) {
    return testApp.app.fetch(
      new Request(`${CUSTOMER_BASE}/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          host: "test",
          origin: "https://test",
          "x-csrf-token": CSRF,
          cookie: `csrf_token=${CSRF}`,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  async function insertTable(restaurantId: string): Promise<number> {
    const result = await testApp.env.DB.prepare(
      `INSERT INTO tables
        (restaurant_id, number, capacity, qr_code, is_occupied, is_active,
         is_reservable, total_usage, created_at_ms, updated_at_ms)
       VALUES (?, 'A1', 4, ?, 0, 1, 1, 0, ?, ?)
       RETURNING id`,
    )
      .bind(restaurantId, `qr-${restaurantId}`, Date.now(), Date.now())
      .first<{ id: number }>();
    return result!.id;
  }

  function insertSubscription(restaurantId: string) {
    return testApp.env.DB.prepare(
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
});
