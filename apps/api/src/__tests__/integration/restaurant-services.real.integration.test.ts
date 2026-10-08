import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  markets,
  restaurantMarketMemberships,
  restaurantServiceItems,
} from "@makanmasak/database";
import { eq } from "drizzle-orm";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, type ServiceData } from "../helpers/read-json";
import { RestaurantsService } from "../../features/restaurants/services/RestaurantsService";
import type { DiscoveryService } from "../../features/discovery/services/DiscoveryService";

type ServiceItemList = ServiceData<
  RestaurantsService["listPublicServiceItems"]
>;
type ServiceItem = ServiceData<RestaurantsService["createServiceItem"]>;
type ServiceSearch = ServiceData<DiscoveryService["searchServices"]>;

function withCsrf(
  headers: Record<string, string> = {},
): Record<string, string> {
  const csrfToken = "b".repeat(64);
  return {
    host: "test",
    origin: "https://test",
    "x-csrf-token": csrfToken,
    cookie: `csrf_token=${csrfToken}`,
    ...headers,
  };
}

function openAllWeek() {
  const day = { open: "00:00", close: "23:59" };
  return {
    monday: day,
    tuesday: day,
    wednesday: day,
    thursday: day,
    friday: day,
    saturday: day,
    sunday: day,
  };
}

async function seedMarket(
  testApp: RealIntegrationTestApp,
  overrides: Partial<typeof markets.$inferInsert> = {},
) {
  const now = new Date();
  const [market] = await testApp.testDb.drizzle
    .insert(markets)
    .values({
      id: `market-${crypto.randomUUID()}`,
      slug: `service-market-${crypto.randomUUID()}`,
      name: "Service Search Market",
      type: "night_market",
      description: "Service search integration market",
      city: "台中市",
      district: "西屯區",
      address: "台中市西屯區文華路",
      latitude: 24.1764,
      longitude: 120.6466,
      openingHours: openAllWeek(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();
  return market;
}

describe("Restaurant service items API — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    await testApp.dispose();
  });

  /**
   * Service-item config is the admin half of the booking product and is now
   * gated with moduleGate("reservations"), so an owner needs a subscription
   * granting it. Mirrors insertActiveSubscription in the coupons suite.
   */
  async function insertActiveSubscription(targetRestaurantId: string) {
    await testApp.env.DB.prepare(
      `INSERT INTO shop_subscriptions
        (id, restaurant_id, plan_tier, module_overrides,
         is_active, trial_ends_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'trial', '{}', 1, ?, ?, ?)`,
    )
      .bind(
        `sub-${targetRestaurantId}`,
        targetRestaurantId,
        Date.now() + 24 * 60 * 60 * 1000,
        Date.now(),
        Date.now(),
      )
      .run();
  }

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  it("lists public active service items for a restaurant", async () => {
    const restaurant = await seed.restaurant({
      name: "Service Directory Vendor",
    });
    await insertActiveSubscription(String(restaurant.id));
    const now = new Date();
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "代客切水果",
        description: "現場代切並分裝",
        serviceType: "general",
        priceCents: 3000,
        tags: ["水果", "分裝"],
        keywords: "水果 分裝 切水果",
        sortOrder: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        restaurantId: String(restaurant.id),
        name: "預約外送",
        serviceType: "delivery",
        priceLabel: "依距離報價",
        requiresBooking: true,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        restaurantId: String(restaurant.id),
        name: "內部測試服務",
        serviceType: "general",
        isPublic: false,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        restaurantId: String(restaurant.id),
        name: "停用服務",
        serviceType: "general",
        isActive: false,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/service-items`,
      ),
    );

    expect(res.status).toBe(200);
    const json = await readData<ServiceItemList>(res);
    expect(json.map((item) => item.name)).toEqual(["預約外送", "代客切水果"]);
    expect(json[0]).toMatchObject({
      restaurantId: restaurant.id,
      serviceType: "delivery",
      priceLabel: "依距離報價",
      requiresBooking: true,
      isPublic: true,
      isActive: true,
    });
    expect(json[1]).toMatchObject({
      priceCents: 3000,
      tags: ["水果", "分裝"],
    });
  });

  it("returns 404 for service items of an unknown restaurant", async () => {
    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/restaurants/missing/service-items"),
    );

    expect(res.status).toBe(404);
  });

  it("lets an owner manage service items for their restaurant", async () => {
    const restaurant = await seed.restaurant({
      name: "Owner Managed Services",
    });
    await insertActiveSubscription(String(restaurant.id));
    const owner = await seed.user({
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const token = await testApp.authHelper.ownerToken(
      owner.id,
      String(restaurant.id),
    );

    const createRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/service-items`,
        {
          method: "POST",
          headers: withCsrf({
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            name: "代客切水果",
            description: "現場代切並分裝",
            serviceType: "general",
            priceCents: 3000,
            tags: ["水果", "分裝"],
            keywords: "水果 分裝 切水果",
            sortOrder: 1,
            isPublic: true,
          }),
        },
      ),
    );

    expect(createRes.status).toBe(201);
    const createdJson = await readData<ServiceItem>(createRes);
    expect(createdJson).toMatchObject({
      restaurantId: restaurant.id,
      name: "代客切水果",
      serviceType: "general",
      priceCents: 3000,
      tags: ["水果", "分裝"],
      isActive: true,
      isPublic: true,
    });
    await expect(
      testApp.testDb.bindings.CACHE_KV.get("markets:version"),
    ).resolves.toBe("1");

    const updateRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/service-items/${createdJson.id}`,
        {
          method: "PUT",
          headers: withCsrf({
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            name: "預約切水果",
            priceLabel: "依份量報價",
            requiresBooking: true,
            isPublic: false,
          }),
        },
      ),
    );

    expect(updateRes.status).toBe(200);
    const updatedJson = await readData<ServiceItem>(updateRes);
    expect(updatedJson).toMatchObject({
      id: createdJson.id,
      name: "預約切水果",
      priceLabel: "依份量報價",
      requiresBooking: true,
      isPublic: false,
    });
    await expect(
      testApp.testDb.bindings.CACHE_KV.get("markets:version"),
    ).resolves.toBe("2");

    const publicRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/service-items`,
      ),
    );
    const publicJson = await readData<ServiceItemList>(publicRes);
    expect(publicJson).toEqual([]);

    const deleteRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/service-items/${createdJson.id}`,
        {
          method: "DELETE",
          headers: withCsrf({
            authorization: `Bearer ${token}`,
          }),
        },
      ),
    );

    expect(deleteRes.status).toBe(200);
    const deletedRows = await testApp.testDb.drizzle
      .select()
      .from(restaurantServiceItems);
    expect(deletedRows[0].deletedAt).toBeInstanceOf(Date);
    expect(deletedRows[0].isActive).toBe(false);
    await expect(
      testApp.testDb.bindings.CACHE_KV.get("markets:version"),
    ).resolves.toBe("3");
  });

  it("validates partial payment updates against stored service terms", async () => {
    const restaurant = await seed.restaurant({ name: "Deposit Services" });
    await insertActiveSubscription(String(restaurant.id));
    const owner = await seed.user({
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const token = await testApp.authHelper.ownerToken(
      owner.id,
      String(restaurant.id),
    );
    const [serviceItem] = await testApp.testDb.drizzle
      .insert(restaurantServiceItems)
      .values({
        restaurantId: String(restaurant.id),
        name: "Private table",
        priceCents: 5000,
        paymentRequirement: "pay_at_venue",
        depositAmountCents: 0,
      })
      .returning();
    const url = `https://test/api/v1/restaurants/${restaurant.id}/service-items/${serviceItem.id}`;
    const headers = withCsrf({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    });

    const transitionRes = await testApp.app.fetch(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          paymentRequirement: "deposit",
          depositAmountCents: 2500,
        }),
      }),
    );
    expect(transitionRes.status).toBe(200);
    await expect(readData<ServiceItem>(transitionRes)).resolves.toMatchObject({
      priceCents: 5000,
      paymentRequirement: "deposit",
      depositAmountCents: 2500,
    });

    const invalidRes = await testApp.app.fetch(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ priceCents: 1000 }),
      }),
    );
    expect(invalidRes.status).toBe(400);
    const [unchanged] = await testApp.testDb.drizzle
      .select()
      .from(restaurantServiceItems)
      .where(eq(restaurantServiceItems.id, serviceItem.id));
    expect(unchanged).toMatchObject({
      priceCents: 5000,
      depositAmountCents: 2500,
    });

    const updateRes = await testApp.app.fetch(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ depositAmountCents: 1500 }),
      }),
    );
    expect(updateRes.status).toBe(200);
    await expect(readData<ServiceItem>(updateRes)).resolves.toMatchObject({
      priceCents: 5000,
      paymentRequirement: "deposit",
      depositAmountCents: 1500,
    });

    const readRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/service-items`,
      ),
    );
    expect(readRes.status).toBe(200);
    await expect(readData<ServiceItemList>(readRes)).resolves.toEqual([
      expect.objectContaining({
        id: serviceItem.id,
        priceCents: 5000,
        paymentRequirement: "deposit",
        depositAmountCents: 1500,
      }),
    ]);
  });

  it("does not overwrite newer deposit terms using a stale price snapshot", async () => {
    const restaurant = await seed.restaurant({ name: "Concurrent Deposits" });
    const [serviceItem] = await testApp.testDb.drizzle
      .insert(restaurantServiceItems)
      .values({
        restaurantId: String(restaurant.id),
        name: "Private table",
        priceCents: 5000,
        paymentRequirement: "deposit",
        depositAmountCents: 1200,
      })
      .returning();

    // Change the row after RestaurantsService reads it, immediately before its
    // UPDATE executes. The intercepted statement still runs against real D1.
    let intercepted = false;
    const db = testApp.env.DB;
    const delayedDb = new Proxy(db, {
      get(target, property) {
        if (property !== "prepare") return Reflect.get(target, property);
        return (query: string) => {
          const statement = target.prepare(query);
          if (!/^update "restaurant_service_items"/i.test(query)) {
            return statement;
          }
          return new Proxy(statement, {
            get(stmt, stmtProperty) {
              if (stmtProperty !== "bind")
                return Reflect.get(stmt, stmtProperty);
              return (...params: Parameters<typeof stmt.bind>) => {
                const bound = stmt.bind(...params);
                return new Proxy(bound, {
                  get(prepared, preparedProperty) {
                    if (preparedProperty !== "raw") {
                      return Reflect.get(prepared, preparedProperty);
                    }
                    return async () => {
                      if (!intercepted) {
                        intercepted = true;
                        await testApp.testDb.drizzle
                          .update(restaurantServiceItems)
                          .set({ depositAmountCents: 3000 })
                          .where(eq(restaurantServiceItems.id, serviceItem.id));
                      }
                      return prepared.raw();
                    };
                  },
                });
              };
            },
          });
        };
      },
    });
    const service = new RestaurantsService(delayedDb, {
      ...testApp.env,
      DB: delayedDb,
    });

    await expect(
      service.updateServiceItem(String(restaurant.id), serviceItem.id, {
        priceCents: 2000,
      }),
    ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(intercepted).toBe(true);
    const [saved] = await testApp.testDb.drizzle
      .select()
      .from(restaurantServiceItems)
      .where(eq(restaurantServiceItems.id, serviceItem.id));
    expect(saved).toMatchObject({
      priceCents: 5000,
      paymentRequirement: "deposit",
      depositAmountCents: 3000,
    });
  });

  it("updates a service with no stored price", async () => {
    const restaurant = await seed.restaurant({ name: "Unpriced Services" });
    const [serviceItem] = await testApp.testDb.drizzle
      .insert(restaurantServiceItems)
      .values({
        restaurantId: String(restaurant.id),
        name: "Price on request",
        priceCents: null,
      })
      .returning();
    const service = new RestaurantsService(testApp.env.DB, testApp.env);

    await expect(
      service.updateServiceItem(String(restaurant.id), serviceItem.id, {
        priceCents: 5000,
      }),
    ).resolves.toMatchObject({ priceCents: 5000 });
  });

  it("makes owner-created public services searchable within their market", async () => {
    const market = await seedMarket(testApp, {
      slug: "owner-service-search-market",
    });
    const restaurant = await seed.restaurant({
      name: "Owner Service Search Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await insertActiveSubscription(String(restaurant.id));
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    const owner = await seed.user({
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const token = await testApp.authHelper.ownerToken(
      owner.id,
      String(restaurant.id),
    );

    const createRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/service-items`,
        {
          method: "POST",
          headers: withCsrf({
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            name: "市場 API 代客切水果",
            description: "夜市現場切水果並分裝",
            serviceType: "general",
            tags: ["水果", "分裝"],
            keywords: "切水果 夜市 分裝",
            isPublic: true,
          }),
        },
      ),
    );

    expect(createRes.status).toBe(201);
    const createJson = await readData<ServiceItem>(createRes);

    const searchRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=${encodeURIComponent(
          "切水果",
        )}&marketId=${market.id}`,
      ),
    );

    expect(searchRes.status).toBe(200);
    const searchJson = await readData<ServiceSearch>(searchRes);
    expect(searchJson.total).toBe(1);
    expect(searchJson.results).toHaveLength(1);
    expect(searchJson.results[0]).toMatchObject({
      serviceItemId: createJson.id,
      restaurantId: restaurant.id,
      restaurantName: "Owner Service Search Vendor",
      name: "市場 API 代客切水果",
    });
  });

  it("prevents an owner from managing service items for another restaurant", async () => {
    const ownRestaurant = await seed.restaurant({ name: "Owned Vendor" });
    const otherRestaurant = await seed.restaurant({ name: "Other Vendor" });
    const owner = await seed.user({
      role: 1,
      restaurantId: String(ownRestaurant.id),
    });
    const token = await testApp.authHelper.ownerToken(
      owner.id,
      String(ownRestaurant.id),
    );

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${otherRestaurant.id}/service-items`,
        {
          method: "POST",
          headers: withCsrf({
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            name: "越權服務",
            serviceType: "general",
          }),
        },
      ),
    );

    expect(res.status).toBe(403);
  });
});
