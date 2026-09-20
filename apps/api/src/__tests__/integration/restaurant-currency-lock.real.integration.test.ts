import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RestaurantService as DatabaseRestaurantService,
  restaurants,
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

describe("restaurant currency lock — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: SeedHelpers;

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

  async function shopWithOwner() {
    const restaurant = await seed.restaurant({ settings: { currency: "TWD" } });
    const owner = await seed.user({ restaurantId: restaurant.id, role: 1 });
    const token = await testApp.authHelper.ownerToken(owner.id, restaurant.id);
    return { restaurantId: restaurant.id, token };
  }

  async function update(
    restaurantId: string,
    token: string,
    settings: Record<string, unknown>,
  ) {
    return testApp.app.fetch(
      new Request(`https://test/api/v1/restaurants/${restaurantId}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...CSRF_HEADERS,
        },
        body: JSON.stringify({ settings }),
      }),
    );
  }

  it("lets a shop with no orders switch currency", async () => {
    const shop = await shopWithOwner();

    const response = await update(shop.restaurantId, shop.token, {
      currency: "MYR",
    });

    expect(response.status).toBe(200);
  });

  it("rejects a currency change when the shop has an unpaid order", async () => {
    const shop = await shopWithOwner();
    await seed.order(shop.restaurantId, { paymentStatus: "pending" });

    const response = await update(shop.restaurantId, shop.token, {
      currency: "MYR",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CURRENCY_CHANGE_NOT_ALLOWED" },
    });
  });

  it("allows other settings changes when the currency stays the same", async () => {
    const shop = await shopWithOwner();
    await seed.order(shop.restaurantId);

    const response = await update(shop.restaurantId, shop.token, {
      currency: "TWD",
      allowGuestOrders: false,
    });

    expect(response.status).toBe(200);
  });

  it("preserves currency when updating another setting", async () => {
    const shop = await shopWithOwner();
    await seed.order(shop.restaurantId);

    const response = await update(shop.restaurantId, shop.token, {
      allowGuestOrders: false,
    });

    expect(response.status).toBe(200);
    const [row] = await testApp.testDb.drizzle.select().from(restaurants);
    expect(row.settings).toMatchObject({
      currency: "TWD",
      allowGuestOrders: false,
    });
  });

  it("does not remove the currency through an empty settings update", async () => {
    const shop = await shopWithOwner();
    await seed.order(shop.restaurantId);

    const response = await update(shop.restaurantId, shop.token, {});

    expect(response.status).toBe(200);
    const [row] = await testApp.testDb.drizzle.select().from(restaurants);
    expect(row.settings).toMatchObject({
      currency: "TWD",
    });
  });

  it("does not let a stale settings merge restore an old currency", async () => {
    const restaurant = await seed.restaurant({ settings: { currency: "MYR" } });
    await seed.order(restaurant.id);
    const service = new DatabaseRestaurantService(testApp.env.DB, testApp.env);
    const serviceDb = (
      service as unknown as {
        db: {
          query: {
            restaurants: {
              findFirst: () => Promise<{ settings: { currency: string } }>;
            };
          };
        };
      }
    ).db;
    serviceDb.query.restaurants.findFirst = async () => ({
      settings: { currency: "TWD" },
    });

    await expect(
      service.updateRestaurant(restaurant.id, {
        settings: { allowGuestOrders: false },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "CURRENCY_CHANGE_NOT_ALLOWED",
    });

    const [row] = await testApp.testDb.drizzle.select().from(restaurants);
    expect(row.settings).toMatchObject({ currency: "MYR" });
  });

  it.each([
    ["blank", "", { allowGuestOrders: false }],
    ["blank", "", {}],
    ["blank", "", { currency: "TWD" }],
    ["whitespace", "   ", { allowGuestOrders: false }],
    ["whitespace", "   ", {}],
    ["whitespace", "   ", { currency: "TWD" }],
  ])(
    "treats %s legacy currency as TWD for an ordered shop update %#",
    async (_label, legacyCurrency, settings) => {
      const restaurant = await seed.restaurant({
        settings: { currency: legacyCurrency },
      });
      await seed.order(restaurant.id);
      const service = new DatabaseRestaurantService(
        testApp.env.DB,
        testApp.env,
      );

      await expect(
        service.updateRestaurant(restaurant.id, { settings }),
      ).resolves.toMatchObject({ id: restaurant.id });
    },
  );
});
