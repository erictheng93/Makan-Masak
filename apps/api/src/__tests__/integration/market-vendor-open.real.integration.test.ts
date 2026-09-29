import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  dishSearchIndex,
  marketCheckoutChildOrders,
  marketCheckoutSessions,
  marketVendorOpenEvents,
  markets,
  restaurantMarketMemberships,
  restaurants,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readEnvelope } from "../helpers/read-json";

const CSRF_TOKEN = "a".repeat(64);
const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  cookie: `csrf_token=${CSRF_TOKEN}`,
  "x-csrf-token": CSRF_TOKEN,
};

type OpenState = {
  isOpenToday: boolean;
  openedAt: string | null;
  businessDate: string;
};

describe("market vendor daily open — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp({
      env: { DEV_CORS_ORIGINS: "https://test" },
    });
    seed = buildSeedHelpers(testApp.testDb);
  }, 300000);

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  async function setup() {
    const [market] = await testApp.testDb.drizzle
      .insert(markets)
      .values({
        id: `market-${crypto.randomUUID()}`,
        slug: `open-market-${crypto.randomUUID()}`,
        name: "Daily open market",
        type: "night_market",
        description: "Test market",
        city: "Taichung",
        district: "Xitun",
        address: "Wenhua Road",
        latitude: 24.1764,
        longitude: 120.6466,
        openingHours: Object.fromEntries(
          [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ].map((day) => [day, { open: "00:00", close: "23:59" }]),
        ),
        bannerUrl: "https://example.com/banner.jpg",
        logoUrl: "https://example.com/logo.jpg",
        imageUrls: ["https://example.com/gallery.jpg"],
        isActive: true,
      })
      .returning();
    const vendor = await seed.restaurant({ name: "Vendor" });
    const owner = await seed.user({ role: 1, restaurantId: vendor.id });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: vendor.id,
      marketId: market.id,
      stallNumber: "A01",
    });
    const token = await testApp.authHelper.ownerToken(owner.id, vendor.id);
    return { market, vendor, owner, token };
  }

  function post(path: string, token: string) {
    return testApp.app.fetch(
      new Request(`https://test/api/v1${path}`, {
        method: "POST",
        headers: { ...CSRF_HEADERS, authorization: `Bearer ${token}` },
      }),
    );
  }

  function get(path: string, token: string) {
    return testApp.app.fetch(
      new Request(`https://test/api/v1${path}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  }

  it("reports today's open session and completed market revenue to the owner", async () => {
    const { market, vendor, token } = await setup();
    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);
    const order = await seed.order(vendor.id, {
      paymentStatus: "completed",
      totalAmountCents: 12000,
    });
    const checkoutId = `mc-${crypto.randomUUID()}`;
    const now = new Date();
    await testApp.testDb.drizzle.insert(marketCheckoutSessions).values({
      id: checkoutId,
      marketId: market.id,
      marketSlug: market.slug,
      marketName: market.name,
      subtotalCents: 12000,
      childOrderCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await testApp.testDb.drizzle.insert(marketCheckoutChildOrders).values({
      checkoutId,
      restaurantId: vendor.id,
      restaurantName: "Vendor",
      orderId: order.id,
      orderNumber: "M-001",
      totalAmountCents: 12000,
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      createdAt: now,
    });
    const from = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await get(
      `/restaurants/${vendor.id}/markets/${market.id}/open-report?from=${from}&to=${to}`,
      token,
    );
    expect(res.status).toBe(200);
    const report = await readData<{
      daily: Array<Record<string, unknown>>;
      summary: Array<Record<string, unknown>>;
    }>(res);
    expect(report.daily).toEqual([
      expect.objectContaining({
        restaurantId: vendor.id,
        firstOpenedAtMs: expect.any(Number),
        orderCount: 1,
        revenueCents: 12000,
      }),
    ]);
    expect(report.summary[0]).toEqual(
      expect.objectContaining({ openDays: 1, orderCount: 1 }),
    );
  });

  it("exports the platform report as CSV", async () => {
    const { market, vendor, token } = await setup();
    const open = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/open`,
      token,
    );
    const { businessDate } = await readData<OpenState>(open);
    const admin = await seed.user({ role: 0, restaurantId: vendor.id });
    const adminToken = await testApp.authHelper.adminToken(vendor.id, admin.id);
    const res = await get(
      `/admin/markets/${market.id}/open-report?from=${businessDate}&to=${businessDate}&view=summary&format=csv`,
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).split("\n");
    expect(lines[0]).toContain("open_days");
    expect(lines[1]).toContain(vendor.id);
    expect(lines[1].split(",")[3]).toBe("1");
  });

  it("prefers the active rejoined stall number and the latest historical membership", async () => {
    const { market, vendor, token } = await setup();
    const open = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/open`,
      token,
    );
    const { businessDate } = await readData<OpenState>(open);
    const start = new Date("2026-01-01T00:00:00Z");
    const middle = new Date("2026-02-01T00:00:00Z");
    const end = new Date("2026-03-01T00:00:00Z");
    await testApp.testDb.drizzle
      .update(restaurantMarketMemberships)
      .set({ joinedAt: start, leftAt: middle })
      .where(eq(restaurantMarketMemberships.restaurantId, vendor.id));
    const [active] = await testApp.testDb.drizzle
      .insert(restaurantMarketMemberships)
      .values({
        restaurantId: vendor.id,
        marketId: market.id,
        stallNumber: "B02",
        joinedAt: end,
      })
      .returning();
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: vendor.id,
      marketId: market.id,
      stallNumber: "C03",
      joinedAt: middle,
      leftAt: end,
    });
    const path = `/restaurants/${vendor.id}/markets/${market.id}/open-report?from=${businessDate}&to=${businessDate}`;
    const report = await readData<{
      daily: Array<{ stallNumber: string | null }>;
      summary: Array<{ stallNumber: string | null }>;
    }>(await get(path, token));
    expect(report.daily[0]?.stallNumber).toBe("B02");
    expect(report.summary[0]?.stallNumber).toBe("B02");

    await testApp.testDb.drizzle
      .update(restaurantMarketMemberships)
      .set({ leftAt: new Date("2026-04-01T00:00:00Z") })
      .where(eq(restaurantMarketMemberships.id, active.id));
    const historical = await readData<{
      summary: Array<{ stallNumber: string | null }>;
    }>(await get(path, token));
    expect(historical.summary[0]?.stallNumber).toBe("B02");
  });

  it("rejects a range longer than 92 days or reversed", async () => {
    const { market, vendor, token } = await setup();
    const base = `/restaurants/${vendor.id}/markets/${market.id}/open-report`;
    expect(
      (await get(`${base}?from=2026-01-01&to=2026-06-30`, token)).status,
    ).toBe(400);
    expect(
      (await get(`${base}?from=2026-09-10&to=2026-09-01`, token)).status,
    ).toBe(400);
  });

  async function listVendors(slug: string) {
    return readData<{
      vendors: Array<{ restaurantId: string; isOpen: boolean }>;
    }>(
      await testApp.app.fetch(
        new Request(`https://test/api/v1/markets/${slug}/vendors`),
      ),
    );
  }

  it("shows the stall as open only after it opens today", async () => {
    const { market, vendor, token } = await setup();
    const item = await seed.menuItem(String(vendor.id), {
      name: "Chicken",
      priceCents: 12000,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: item.id,
      restaurantId: String(vendor.id),
      dishName: "Chicken",
      dishNameNormalized: "chicken",
      priceCents: 12000,
      isAvailable: true,
      tags: [],
      district: market.district,
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: market.latitude,
      longitude: market.longitude,
      updatedAt: new Date(),
    });
    expect((await listVendors(market.slug)).vendors[0]).toMatchObject({
      restaurantId: String(vendor.id),
      isOpen: false,
    });
    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);
    expect((await listVendors(market.slug)).vendors[0]).toMatchObject({
      isOpen: true,
    });
  });

  it("keeps daily open state scoped to each market", async () => {
    const { market, vendor, token } = await setup();
    const {
      market: otherMarket,
      vendor: otherVendor,
      token: otherToken,
    } = await setup();
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(vendor.id),
      marketId: otherMarket.id,
      joinedAt: new Date(),
    });
    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);
    const memberships = await readData<{
      memberships: Array<{ marketId: string; isOpenToday: boolean }>;
    }>(await get(`/restaurants/${vendor.id}/markets`, token));
    expect(
      Object.fromEntries(
        memberships.memberships.map((row) => [row.marketId, row.isOpenToday]),
      ),
    ).toEqual({ [market.id]: true, [otherMarket.id]: false });

    await post(
      `/restaurants/${otherVendor.id}/markets/${otherMarket.id}/open`,
      otherToken,
    );
    const [sharedItem, otherItem] = await Promise.all([
      seed.menuItem(String(vendor.id), { name: "Chicken", priceCents: 12000 }),
      seed.menuItem(String(otherVendor.id), { name: "Tea", priceCents: 8000 }),
    ]);
    for (const restaurantId of [vendor.id, otherVendor.id]) {
      await testApp.testDb.drizzle
        .update(restaurants)
        .set({ settings: { allowGuestOrders: true } })
        .where(eq(restaurants.id, restaurantId));
    }
    const response = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: { ...CSRF_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          marketSlug: otherMarket.slug,
          guestName: "Guest",
          phoneLastDigits: "789",
          vendors: [
            {
              restaurantId: String(vendor.id),
              items: [{ menuItemId: sharedItem.id, quantity: 1 }],
            },
            {
              restaurantId: String(otherVendor.id),
              items: [{ menuItemId: otherItem.id, quantity: 1 }],
            },
          ],
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect((await readEnvelope(response)).error).toMatchObject({
      code: "VENDOR_NOT_OPEN_TODAY",
      details: { restaurantIds: [String(vendor.id)] },
    });
  });

  it("rejects checkout for a stall that has not opened today", async () => {
    const { market, vendor } = await setup();
    const openVendor = await seed.restaurant({ name: "Open vendor" });
    const openOwner = await seed.user({ role: 1, restaurantId: openVendor.id });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(openVendor.id),
      marketId: market.id,
      stallNumber: "A02",
    });
    const openToken = await testApp.authHelper.ownerToken(
      openOwner.id,
      openVendor.id,
    );
    await post(
      `/restaurants/${openVendor.id}/markets/${market.id}/open`,
      openToken,
    );
    const item = await seed.menuItem(String(vendor.id), {
      name: "Chicken",
      price: 120,
      priceCents: 12000,
    });
    const openItem = await seed.menuItem(String(openVendor.id), {
      name: "Tea",
      price: 80,
      priceCents: 8000,
    });
    await testApp.testDb.drizzle
      .update(restaurants)
      .set({ settings: { allowGuestOrders: true } })
      .where(eq(restaurants.id, vendor.id));
    await testApp.testDb.drizzle
      .update(restaurants)
      .set({ settings: { allowGuestOrders: true } })
      .where(eq(restaurants.id, openVendor.id));
    const response = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: { ...CSRF_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          marketSlug: market.slug,
          guestName: "Guest",
          phoneLastDigits: "789",
          vendors: [
            {
              restaurantId: String(vendor.id),
              items: [{ menuItemId: item.id, quantity: 1 }],
            },
            {
              restaurantId: String(openVendor.id),
              items: [{ menuItemId: openItem.id, quantity: 1 }],
            },
          ],
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect((await readEnvelope(response)).error).toMatchObject({
      code: "VENDOR_NOT_OPEN_TODAY",
      details: { restaurantIds: [String(vendor.id)] },
    });
  });

  it("starts closed, opens once, and records one event", async () => {
    const { market, vendor, token } = await setup();
    const before = await readData<{
      memberships: Array<{ marketId: string; isOpenToday: boolean }>;
    }>(await get(`/restaurants/${vendor.id}/markets`, token));
    expect(before.memberships[0]).toMatchObject({
      marketId: market.id,
      isOpenToday: false,
    });

    const path = `/restaurants/${vendor.id}/markets/${market.id}/open`;
    const first = await post(path, token);
    expect(first.status).toBe(200);
    expect(await readData<OpenState>(first)).toMatchObject({
      isOpenToday: true,
      openedAt: expect.any(String),
      businessDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect((await post(path, token)).status).toBe(200);
    const events = await testApp.testDb.drizzle
      .select()
      .from(marketVendorOpenEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "open",
      marketId: market.id,
      restaurantId: vendor.id,
    });
  });

  it("closes and records the close", async () => {
    const { market, vendor, token } = await setup();
    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);
    const close = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/close`,
      token,
    );
    expect(close.status).toBe(200);
    expect(await readData<OpenState>(close)).toMatchObject({
      isOpenToday: false,
      openedAt: null,
    });
    const [membership] = await testApp.testDb.drizzle
      .select()
      .from(restaurantMarketMemberships)
      .where(eq(restaurantMarketMemberships.marketId, market.id));
    expect(membership.openedAt).toBeNull();
    const actions = (
      await testApp.testDb.drizzle.select().from(marketVendorOpenEvents)
    ).map((event) => event.action);
    expect(actions.sort()).toEqual(["close", "open"]);
  });

  it("records one event per transition under concurrent repeated requests", async () => {
    const { market, vendor, token } = await setup();
    const base = `/restaurants/${vendor.id}/markets/${market.id}`;
    const opens = await Promise.all(
      Array.from({ length: 8 }, () => post(`${base}/open`, token)),
    );
    expect(opens.every((response) => response.status === 200)).toBe(true);
    expect(
      (await testApp.testDb.drizzle.select().from(marketVendorOpenEvents)).map(
        (event) => event.action,
      ),
    ).toEqual(["open"]);

    const closes = await Promise.all(
      Array.from({ length: 8 }, () => post(`${base}/close`, token)),
    );
    expect(closes.every((response) => response.status === 200)).toBe(true);
    const actions = (
      await testApp.testDb.drizzle.select().from(marketVendorOpenEvents)
    ).map((event) => event.action);
    expect(actions.sort()).toEqual(["close", "open"]);

    expect((await post(`${base}/open`, token)).status).toBe(200);
    const reopenedActions = (
      await testApp.testDb.drizzle.select().from(marketVendorOpenEvents)
    ).map((event) => event.action);
    expect(reopenedActions.sort()).toEqual(["close", "open", "open"]);
  });

  it("treats yesterday's unclosed open as closed today", async () => {
    const { market, vendor, token } = await setup();
    await testApp.testDb.drizzle
      .update(restaurantMarketMemberships)
      .set({ openedAt: new Date(Date.now() - 30 * 60 * 60 * 1000) })
      .where(eq(restaurantMarketMemberships.marketId, market.id));
    const close = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/close`,
      token,
    );
    expect(close.status).toBe(200);
    expect(await readData<OpenState>(close)).toMatchObject({
      isOpenToday: false,
      openedAt: null,
    });
    expect(
      await testApp.testDb.drizzle.select().from(marketVendorOpenEvents),
    ).toHaveLength(0);
    const open = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/open`,
      token,
    );
    expect(await readData<OpenState>(open)).toMatchObject({
      isOpenToday: true,
    });
  });

  it("rejects another shop's owner and a shop without membership", async () => {
    const { market, vendor } = await setup();
    const otherShop = await seed.restaurant({ name: "Other" });
    const otherOwner = await seed.user({
      role: 1,
      restaurantId: otherShop.id,
    });
    const token = await testApp.authHelper.ownerToken(
      otherOwner.id,
      otherShop.id,
    );
    expect(
      (await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token))
        .status,
    ).toBe(403);
    const noMembership = await post(
      `/restaurants/${otherShop.id}/markets/${market.id}/open`,
      token,
    );
    expect(noMembership.status).toBe(404);
    expect((await readEnvelope(noMembership)).error).toMatchObject({
      code: "MARKET_MEMBERSHIP_NOT_FOUND",
    });
  });

  it("lets a platform admin open a member stall", async () => {
    const { market, vendor } = await setup();
    const admin = await seed.user({ role: 0, restaurantId: vendor.id });
    const token = await testApp.authHelper.adminToken(vendor.id, admin.id);
    const response = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/open`,
      token,
    );
    expect(response.status).toBe(200);
    expect(await readData<OpenState>(response)).toMatchObject({
      isOpenToday: true,
    });
  });

  it("rejects opening an inactive restaurant", async () => {
    const { market, vendor, token } = await setup();
    await testApp.testDb.drizzle
      .update(restaurants)
      .set({ isActive: false })
      .where(eq(restaurants.id, vendor.id));
    const response = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/open`,
      token,
    );
    expect(response.status).toBe(400);
    expect((await readEnvelope(response)).error).toMatchObject({
      code: "RESTAURANT_INACTIVE",
    });
  });
});
