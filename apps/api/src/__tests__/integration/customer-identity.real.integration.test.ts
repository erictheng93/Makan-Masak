import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sign } from "hono/jwt";
import { markets } from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";
import { CUSTOMER_CONSENT_VERSIONS } from "@makanmasak/shared-types";
import { pruneStaleCustomerPushSubscriptions } from "../../features/customer/routes";
import { readData } from "../helpers/read-json";
import { CUSTOMER_REFRESH_COOKIE } from "../../features/customer/services/CustomerSessionService";

// The customer identity routes assemble their payloads inline
// (apps/api/src/features/customer/routes/index.ts), so the shapes this suite
// reads are stated here.
interface OtpChallenge {
  devOtp?: string;
}

interface CustomerSession {
  accessToken: string;
  expiresIn: number;
  customer: { id: string; primaryPhone: string | null };
}

/**
 * The refresh token is never in the response body — issueCustomerSession only
 * sets it as an HttpOnly cookie. A test that wants to revoke one has to read it
 * from there; taking `data.refreshToken` yields undefined, and then every
 * "revoked" assertion passes for the wrong reason.
 */
function readSetCookie(response: Response, name: string): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${name}=([^;]+)`).exec(header);
  if (!match) {
    throw new Error(`${name} cookie missing from the response`);
  }
  return decodeURIComponent(match[1]);
}

interface CustomerMe {
  customer: { id: string };
  preferences: { waitingListOptIn: boolean };
}

interface FavoriteSummary {
  id: number;
  targetType: string;
  targetId: string;
}

type PushSubscriptionList = Array<{ endpoint: string }>;
type RecentMarketList = Array<{ marketId: string; visitedAtMs: number }>;
type ConsentList = Array<{ consentType: string; version: string }>;

const BASE = "https://test/api/v1/customer";
const CSRF = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("Customer Identity API - real integration", () => {
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

  it("issues customer tokens through phone OTP and returns /customer/me", async () => {
    const otpRes = await testApp.app.fetch(
      new Request(`${BASE}/auth/request-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+886912345678" }),
      }),
    );

    expect(otpRes.status).toBe(200);
    const otpJson = await readData<OtpChallenge>(otpRes);
    expect(otpJson.devOtp).toMatch(/^\d{6}$/);

    const verifyRes = await testApp.app.fetch(
      new Request(`${BASE}/auth/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: "+886912345678",
          otp: otpJson.devOtp,
        }),
      }),
    );

    expect(verifyRes.status).toBe(200);
    const verifyJson = await readData<CustomerSession>(verifyRes);
    expect(verifyJson.accessToken).toBeTruthy();
    expect(verifyJson.customer.primaryPhone).toBe("+886912345678");

    const meRes = await testApp.app.fetch(
      new Request(`${BASE}/me`, {
        headers: { authorization: `Bearer ${verifyJson.accessToken}` },
      }),
    );

    expect(meRes.status).toBe(200);
    const meJson = await readData<CustomerMe>(meRes);
    expect(meJson.customer.id).toBe(verifyJson.customer.id);
    expect(meJson.preferences.waitingListOptIn).toBe(true);
  });

  it("normalizes Taiwan local phone numbers to E.164", async () => {
    const otpRes = await testApp.app.fetch(
      new Request(`${BASE}/auth/request-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "0912-345-678" }),
      }),
    );

    expect(otpRes.status).toBe(200);
    const otpJson = await readData<OtpChallenge>(otpRes);

    const verifyRes = await testApp.app.fetch(
      new Request(`${BASE}/auth/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: "0912345678",
          otp: otpJson.devOtp,
        }),
      }),
    );

    expect(verifyRes.status).toBe(200);
    const verifyJson = await readData<CustomerSession>(verifyRes);
    expect(verifyJson.customer.primaryPhone).toBe("+886912345678");
  });

  it("reclaims a phone from a deleted customer when the number is reused", async () => {
    await testApp.env.DB.prepare(
      `INSERT INTO customers
        (id, display_name, primary_phone, status, deleted_at_ms,
         created_at_ms, updated_at_ms)
       VALUES ('deleted-customer', 'Deleted Customer', '+886977777777',
         'deleted', 1, 1, 1)`,
    ).run();

    const otpRes = await testApp.app.fetch(
      new Request(`${BASE}/auth/request-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+886977777777" }),
      }),
    );
    const otpJson = await readData<OtpChallenge>(otpRes);

    const verifyRes = await testApp.app.fetch(
      new Request(`${BASE}/auth/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: "+886977777777",
          otp: otpJson.devOtp,
        }),
      }),
    );

    expect(verifyRes.status).toBe(200);
    const verifyJson = await readData<CustomerSession>(verifyRes);
    expect(verifyJson.customer.id).not.toBe("deleted-customer");
    expect(verifyJson.customer.primaryPhone).toBe("+886977777777");

    const oldCustomer = await testApp.env.DB.prepare(
      `SELECT primary_phone, status
         FROM customers
        WHERE id = 'deleted-customer'`,
    ).first<{ primary_phone: string | null; status: string }>();
    expect(oldCustomer).toEqual({
      primary_phone: null,
      status: "deleted",
    });
  });

  it("revokes refresh tokens on logout", async () => {
    const session = await loginCustomerSession("+886945678901");

    const logoutRes = await authedPost(
      session.accessToken,
      `${BASE}/auth/logout`,
      {
        refreshToken: session.refreshToken,
      },
    );
    expect(logoutRes.status).toBe(200);

    const refreshRes = await testApp.app.fetch(
      new Request(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }),
    );
    expect(refreshRes.status).toBe(401);
  });

  it("rejects staff JWTs on canonical customer endpoints", async () => {
    const staffToken = await sign(
      {
        id: 1,
        sub: "1",
        username: "owner",
        role: 1,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      testApp.env.JWT_SECRET,
    );

    const res = await testApp.app.fetch(
      new Request(`${BASE}/me`, {
        headers: { authorization: `Bearer ${staffToken}` },
      }),
    );

    expect(res.status).toBe(401);
  });

  it("upserts push subscriptions for the authenticated customer", async () => {
    const accessToken = await loginCustomer("+886923456789");

    const res = await authedPost(accessToken, `${BASE}/push-subscriptions`, {
      endpoint: "https://push.example.test/abc",
      p256dh: "p256dh-key",
      auth: "auth-key",
      deviceLabel: "Browser",
    });

    expect(res.status).toBe(201);

    const listRes = await testApp.app.fetch(
      new Request(`${BASE}/push-subscriptions`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    const listJson = await readData<PushSubscriptionList>(listRes);
    expect(listJson).toHaveLength(1);
    expect(listJson[0].endpoint).toBe("https://push.example.test/abc");
  });

  it("prunes stale failed push subscriptions on the daily cadence", async () => {
    const accessToken = await loginCustomer("+886922222222");
    const meRes = await testApp.app.fetch(
      new Request(`${BASE}/me`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    const meJson = await readData<CustomerMe>(meRes);
    const customerId = meJson.customer.id;
    const now = Date.now();
    const ninetyOneDaysAgo = now - 91 * 24 * 60 * 60 * 1000;

    await Promise.all([
      insertPushSubscription(customerId, "stale-failed", ninetyOneDaysAgo, 3),
      insertPushSubscription(
        customerId,
        "stale-low-failure",
        ninetyOneDaysAgo,
        2,
      ),
      insertPushSubscription(customerId, "recent-failed", now, 3),
    ]);

    const result = await pruneStaleCustomerPushSubscriptions(testApp.env, now);

    expect(result.deleted).toBe(1);
    const remaining = await testApp.env.DB.prepare(
      `SELECT id
         FROM customer_push_subscriptions
        ORDER BY id ASC`,
    ).all<{ id: string }>();
    expect(remaining.results.map((row) => row.id)).toEqual([
      "recent-failed",
      "stale-low-failure",
    ]);
  });

  it("creates idempotent favorites only for valid targets", async () => {
    const accessToken = await loginCustomer("+886956789012");
    const restaurant = await seed.restaurant();

    const createRes = await authedPost(accessToken, `${BASE}/favorites`, {
      targetType: "restaurant",
      targetId: String(restaurant.id),
    });
    expect(createRes.status).toBe(201);
    const createJson = await readData<FavoriteSummary>(createRes);
    expect(createJson.targetType).toBe("restaurant");
    expect(createJson.targetId).toBe(String(restaurant.id));

    const duplicateRes = await authedPost(accessToken, `${BASE}/favorites`, {
      targetType: "restaurant",
      targetId: String(restaurant.id),
    });
    expect(duplicateRes.status).toBe(200);
    const duplicateJson = await readData<FavoriteSummary>(duplicateRes);
    expect(duplicateJson.id).toBe(createJson.id);

    const invalidRes = await authedPost(accessToken, `${BASE}/favorites`, {
      targetType: "restaurant",
      targetId: "missing-restaurant",
    });
    expect(invalidRes.status).toBe(400);

    const listRes = await testApp.app.fetch(
      new Request(`${BASE}/favorites?targetType=restaurant`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(listRes.status).toBe(200);
    const listJson = await readData<FavoriteSummary[]>(listRes);
    expect(listJson).toHaveLength(1);

    const deleteRes = await testApp.app.fetch(
      new Request(`${BASE}/favorites/${createJson.id}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${accessToken}`,
          host: "test",
          origin: "https://test",
          "x-csrf-token": CSRF,
          cookie: `csrf_token=${CSRF}`,
        },
      }),
    );
    expect(deleteRes.status).toBe(200);
  });

  it("creates idempotent market favorites for authenticated customers", async () => {
    const accessToken = await loginCustomer("+886956789013");
    const market = await seedMarketFavoriteTarget();

    const createRes = await authedPost(accessToken, `${BASE}/favorites`, {
      targetType: "market",
      targetId: market.id,
    });
    expect(createRes.status).toBe(201);
    const createJson = await readData<FavoriteSummary>(createRes);
    expect(createJson.targetType).toBe("market");
    expect(createJson.targetId).toBe(market.id);

    const duplicateRes = await authedPost(accessToken, `${BASE}/favorites`, {
      targetType: "market",
      targetId: market.id,
    });
    expect(duplicateRes.status).toBe(200);
    const duplicateJson = await readData<FavoriteSummary>(duplicateRes);
    expect(duplicateJson.id).toBe(createJson.id);

    const listRes = await testApp.app.fetch(
      new Request(`${BASE}/favorites?targetType=market`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(listRes.status).toBe(200);
    const listJson = await readData<FavoriteSummary[]>(listRes);
    expect(listJson).toEqual([
      expect.objectContaining({
        id: createJson.id,
        targetType: "market",
        targetId: market.id,
      }),
    ]);
  });

  it("records recent market visits for authenticated customers", async () => {
    const accessToken = await loginCustomer("+886956789014");
    const firstMarket = await seedMarketFavoriteTarget("recent-market-a");
    const secondMarket = await seedMarketFavoriteTarget("recent-market-b");

    const firstVisitRes = await authedPost(
      accessToken,
      `${BASE}/recent-markets`,
      {
        marketId: firstMarket.id,
        visitedAtMs: 1_780_000_001_000,
      },
    );
    expect(firstVisitRes.status).toBe(201);

    const secondVisitRes = await authedPost(
      accessToken,
      `${BASE}/recent-markets`,
      {
        marketId: secondMarket.id,
        visitedAtMs: 1_780_000_002_000,
      },
    );
    expect(secondVisitRes.status).toBe(201);

    const updatedFirstVisitRes = await authedPost(
      accessToken,
      `${BASE}/recent-markets`,
      {
        marketId: firstMarket.id,
        visitedAtMs: 1_780_000_003_000,
      },
    );
    expect(updatedFirstVisitRes.status).toBe(201);

    const listRes = await testApp.app.fetch(
      new Request(`${BASE}/recent-markets`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(listRes.status).toBe(200);
    const listJson = await readData<RecentMarketList>(listRes);
    expect(listJson).toEqual([
      { marketId: firstMarket.id, visitedAtMs: 1_780_000_003_000 },
      { marketId: secondMarket.id, visitedAtMs: 1_780_000_002_000 },
    ]);
  });

  it("records consent grants and revokes previous active grants", async () => {
    const accessToken = await loginCustomer("+886934567890");

    const grantRes = await authedPost(accessToken, `${BASE}/consents`, {
      consentType: "marketing",
      version: CUSTOMER_CONSENT_VERSIONS.marketing,
      granted: true,
      source: "onboarding",
    });
    expect(grantRes.status).toBe(201);

    let activeRes = await testApp.app.fetch(
      new Request(`${BASE}/consents`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    let activeConsents = await readData<ConsentList>(activeRes);
    expect(activeConsents).toHaveLength(1);

    const revokeRes = await authedPost(accessToken, `${BASE}/consents`, {
      consentType: "marketing",
      version: CUSTOMER_CONSENT_VERSIONS.marketing,
      granted: false,
      source: "settings",
    });
    expect(revokeRes.status).toBe(201);

    activeRes = await testApp.app.fetch(
      new Request(`${BASE}/consents`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    activeConsents = await readData<ConsentList>(activeRes);
    expect(activeConsents).toHaveLength(0);

    const ledger = await testApp.env.DB.prepare(
      `SELECT granted, revoked_at_ms
         FROM customer_consents
        WHERE consent_type = 'marketing'
        ORDER BY granted_at_ms ASC`,
    ).all<{ granted: number; revoked_at_ms: number | null }>();
    expect(ledger.results).toHaveLength(2);
    expect(ledger.results?.[0].granted).toBe(1);
    expect(ledger.results?.[0].revoked_at_ms).toBeTypeOf("number");
    expect(ledger.results?.[1].granted).toBe(0);
  });

  it("rejects customer consent versions outside the shared catalog", async () => {
    const accessToken = await loginCustomer("+886933333333");

    const res = await authedPost(accessToken, `${BASE}/consents`, {
      consentType: "marketing",
      version: "ad-hoc-version",
      granted: true,
      source: "settings",
    });

    expect(res.status).toBe(400);
  });

  async function loginCustomer(phone: string): Promise<string> {
    const session = await loginCustomerSession(phone);
    return session.accessToken;
  }

  async function loginCustomerSession(
    phone: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const otpRes = await testApp.app.fetch(
      new Request(`${BASE}/auth/request-otp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "CF-Connecting-IP": testIpForPhone(phone),
        },
        body: JSON.stringify({ phone }),
      }),
    );
    const otpJson = await readData<OtpChallenge>(otpRes);

    const verifyRes = await testApp.app.fetch(
      new Request(`${BASE}/auth/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, otp: otpJson.devOtp }),
      }),
    );
    const verifyJson = await readData<CustomerSession>(verifyRes);
    return {
      accessToken: verifyJson.accessToken,
      refreshToken: readSetCookie(verifyRes, CUSTOMER_REFRESH_COOKIE),
    };
  }

  function authedPost(accessToken: string, url: string, body: unknown) {
    return testApp.app.fetch(
      new Request(url, {
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

  function insertPushSubscription(
    customerId: string,
    id: string,
    lastUsedAtMs: number,
    failureCount: number,
  ) {
    return testApp.env.DB.prepare(
      `INSERT INTO customer_push_subscriptions
        (id, customer_id, endpoint, p256dh_key, auth_key, last_used_at_ms,
         failure_count, created_at_ms)
       VALUES (?, ?, ?, 'p256dh', 'auth', ?, ?, ?)`,
    )
      .bind(
        id,
        customerId,
        `https://push.example.test/${id}`,
        lastUsedAtMs,
        failureCount,
        lastUsedAtMs,
      )
      .run();
  }

  function testIpForPhone(phone: string) {
    const digits = phone.replace(/\D/g, "").slice(-3);
    return `203.0.113.${Number(digits) % 250}`;
  }

  async function seedMarketFavoriteTarget(idPrefix = "favorite-market") {
    const now = new Date();
    const id = `${idPrefix}-${crypto.randomUUID()}`;
    await testApp.testDb.drizzle
      .insert(markets)
      .values({
        id,
        slug: id,
        name: "收藏測試夜市",
        type: "night_market",
        description: "Customer favorite integration fixture",
        city: "台中市",
        district: "西屯區",
        address: "台中市西屯區文華路",
        latitude: 24.1764,
        longitude: 120.6466,
        openingHours: {
          friday: { open: "17:00", close: "23:30" },
        },
        platformFeeRateBps: 350,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return { id };
  }
});
