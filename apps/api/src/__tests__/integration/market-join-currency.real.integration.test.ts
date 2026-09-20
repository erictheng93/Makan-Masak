import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MarketsService } from "../../features/markets/services/MarketsService";
import {
  markets,
  marketJoinRequests,
  restaurants,
  restaurantMarketMemberships,
  RestaurantService,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";

const CSRF_TOKEN = "c".repeat(64);
const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  "x-csrf-token": CSRF_TOKEN,
  cookie: `csrf_token=${CSRF_TOKEN}`,
};

describe("market join currency guard — real D1", () => {
  let app: RealIntegrationTestApp;
  let seed: SeedHelpers;
  beforeAll(async () => {
    app = await createRealIntegrationTestApp({
      env: { DEV_CORS_ORIGINS: "https://test" },
    });
    seed = buildSeedHelpers(app.testDb);
  });
  afterAll(async () => {
    await app.dispose();
  });
  beforeEach(async () => {
    await app.testDb.truncateAll();
  });

  async function setup(currency = "MYR", peerCurrency = "TWD") {
    const peer = await seed.restaurant({
      settings: { currency: peerCurrency },
    });
    const vendor = await seed.restaurant({ settings: { currency } });
    await seed.user({ id: 10, role: 0, restaurantId: peer.id });
    const token = await app.authHelper.adminToken(peer.id);
    const [market] = await app.testDb.drizzle
      .insert(markets)
      .values({
        id: crypto.randomUUID(),
        slug: crypto.randomUUID(),
        name: "Currency market",
        type: "night_market",
        city: "Taipei",
        district: "Central",
        address: "1 Test Street",
        latitude: 25,
        longitude: 121,
      })
      .returning();
    await app.testDb.drizzle
      .insert(restaurantMarketMemberships)
      .values({ marketId: market.id, restaurantId: peer.id });
    const [request] = await app.testDb.drizzle
      .insert(marketJoinRequests)
      .values({ marketId: market.id, restaurantId: vendor.id })
      .returning();
    return { peer, vendor, market, request, token };
  }
  async function post(path: string, token: string, body = {}) {
    return app.app.fetch(
      new Request(`https://test/api/v1/admin/markets/${path}`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  }
  it("refuses mismatched approval, keeping request pending and membership absent", async () => {
    const { request, token, vendor } = await setup();
    const response = await post(`join-requests/${request.id}/approve`, token);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MARKET_VENDOR_CURRENCY_MISMATCH" },
    });
    expect(
      await app.testDb.drizzle.select().from(marketJoinRequests),
    ).toMatchObject([{ status: "pending", resolvedAt: null }]);
    expect(
      await app.testDb.drizzle
        .select()
        .from(restaurantMarketMemberships)
        .where(eq(restaurantMarketMemberships.restaurantId, vendor.id)),
    ).toEqual([]);
  });
  it("approves matching currency", async () => {
    const { request, token, vendor } = await setup("TWD");
    expect(
      (await post(`join-requests/${request.id}/approve`, token)).status,
    ).toBe(200);
    expect(
      await app.testDb.drizzle.select().from(marketJoinRequests),
    ).toMatchObject([{ status: "approved" }]);
    expect(
      await app.testDb.drizzle
        .select()
        .from(restaurantMarketMemberships)
        .where(eq(restaurantMarketMemberships.restaurantId, vendor.id)),
    ).toHaveLength(1);
  });
  it("refuses mismatched direct authenticated attachment", async () => {
    const { market, token, vendor } = await setup();
    const response = await post(`${market.id}/vendors`, token, {
      restaurantId: vendor.id,
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MARKET_VENDOR_CURRENCY_MISMATCH" },
    });
  });
  it("refuses an order-free member currency change that breaks peers", async () => {
    const { market, vendor } = await setup("TWD");
    await app.testDb.drizzle
      .insert(restaurantMarketMemberships)
      .values({ marketId: market.id, restaurantId: vendor.id });
    const owner = await seed.user({ role: 1, restaurantId: vendor.id });
    const token = await app.authHelper.ownerToken(owner.id, vendor.id);
    const response = await app.app.fetch(
      new Request(`https://test/api/v1/restaurants/${vendor.id}`, {
        method: "PUT",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ settings: { currency: "MYR" } }),
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MARKET_VENDOR_CURRENCY_MISMATCH" },
    });
    const [row] = await app.testDb.drizzle
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, vendor.id));
    expect(row.settings).toMatchObject({ currency: "TWD" });
  });
  it("protects direct database settings updates too", async () => {
    const { market, vendor } = await setup("TWD");
    await app.testDb.drizzle
      .insert(restaurantMarketMemberships)
      .values({ marketId: market.id, restaurantId: vendor.id });
    const service = new RestaurantService(app.env.DB, app.env);
    await expect(
      service.updateRestaurant(vendor.id, { settings: { currency: "MYR" } }),
    ).rejects.toMatchObject({
      status: 409,
      code: "MARKET_VENDOR_CURRENCY_MISMATCH",
    });
  });
  it("lets the first vendor establish currency after the previous vendor leaves", async () => {
    const { peer, request, token } = await setup();
    await app.testDb.drizzle
      .update(restaurantMarketMemberships)
      .set({ leftAt: new Date() })
      .where(eq(restaurantMarketMemberships.restaurantId, peer.id));
    expect(
      (await post(`join-requests/${request.id}/approve`, token)).status,
    ).toBe(200);
    const service = new RestaurantService(app.env.DB, app.env);
    // A sole remaining vendor still has no peers to break.
    await expect(
      service.updateRestaurant(request.restaurantId, {
        settings: { currency: "VND" },
      }),
    ).resolves.toMatchObject({ settings: { currency: "VND" } });
  });

  it.each(["", " ", "\t", " twd "])(
    "resolves legacy peer currency %j like checkout",
    async (peerCurrency) => {
      const { request, token } = await setup("TWD", peerCurrency);
      expect(
        (await post(`join-requests/${request.id}/approve`, token)).status,
      ).toBe(200);
    },
  );

  it("serializes differently denominated first vendor attachments", async () => {
    const { market, peer, vendor } = await setup();
    await app.testDb.drizzle.delete(restaurantMarketMemberships);
    const service = new MarketsService(app.env.DB);
    const results = await Promise.allSettled([
      service.addVendor(market.id, { restaurantId: peer.id }),
      service.addVendor(market.id, { restaurantId: vendor.id }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "MARKET_VENDOR_CURRENCY_MISMATCH" } });
    expect(
      await app.testDb.drizzle.select().from(restaurantMarketMemberships),
    ).toHaveLength(1);
  });

  it("serializes a currency change against a new attachment", async () => {
    const { market, peer, vendor } = await setup("TWD");
    const marketService = new MarketsService(app.env.DB);
    const restaurantService = new RestaurantService(app.env.DB, app.env);
    const results = await Promise.allSettled([
      marketService.addVendor(market.id, { restaurantId: vendor.id }),
      restaurantService.updateRestaurant(peer.id, {
        settings: { currency: "MYR" },
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "MARKET_VENDOR_CURRENCY_MISMATCH" } });
  });
  it("fails closed for recursively encoded peer currency during a member update", async () => {
    const { market, peer, vendor } = await setup("MYR", "MYR");
    await app.testDb.drizzle
      .insert(restaurantMarketMemberships)
      .values({ marketId: market.id, restaurantId: vendor.id });
    await app.env.DB.prepare("UPDATE restaurants SET settings = ? WHERE id = ?")
      .bind(
        JSON.stringify(JSON.stringify(JSON.stringify({ currency: "MYR" }))),
        peer.id,
      )
      .run();
    const service = new RestaurantService(app.env.DB, app.env);
    await expect(
      service.updateRestaurant(vendor.id, { settings: { currency: "TWD" } }),
    ).rejects.toMatchObject({ code: "MARKET_VENDOR_CURRENCY_MISMATCH" });
  });
  it.each([
    { currency: "TWD", expectedStatus: 200 },
    { currency: "MYR", expectedStatus: 409 },
  ])(
    "approves matching and refuses mismatched vendor 101 ($currency)",
    async ({ currency, expectedStatus }) => {
      const { market, peer, vendor, request, token } = await setup(currency);
      const statements = Array.from({ length: 99 }, (_, index) => {
        const id = `large-market-peer-${index}`;
        return [
          app.env.DB.prepare(
            `INSERT INTO restaurants
          (id, name, type, category, address, district, city, phone, settings, created_at_ms, updated_at_ms)
          SELECT ?, name, type, category, address, district, city, phone, settings, created_at_ms, updated_at_ms
          FROM restaurants WHERE id = ?`,
          ).bind(id, peer.id),
          app.env.DB.prepare(
            "INSERT INTO restaurant_market_memberships (restaurant_id, market_id, joined_at_ms) VALUES (?, ?, ?)",
          ).bind(id, market.id, Date.now()),
        ];
      }).flat();
      await app.env.DB.batch(statements);
      const response = await post(`join-requests/${request.id}/approve`, token);
      expect(response.status).toBe(expectedStatus);
      if (expectedStatus === 409) {
        await expect(response.json()).resolves.toMatchObject({
          error: { code: "MARKET_VENDOR_CURRENCY_MISMATCH" },
        });
        expect(
          await app.testDb.drizzle.select().from(marketJoinRequests),
        ).toMatchObject([{ status: "pending", resolvedAt: null }]);
      }
      expect(
        await app.testDb.drizzle
          .select()
          .from(restaurantMarketMemberships)
          .where(eq(restaurantMarketMemberships.restaurantId, vendor.id)),
      ).toHaveLength(expectedStatus === 200 ? 1 : 0);
    },
  );
});
