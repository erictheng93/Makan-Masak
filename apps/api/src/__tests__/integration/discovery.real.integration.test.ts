import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import {
  categories,
  dishSearchIndex,
  menuItems,
  markets,
  restaurants,
  restaurantMarketMemberships,
  restaurantServiceItems,
} from "@makanmasak/database";
import { eq } from "drizzle-orm";
import { SearchIndexSyncService } from "../../features/discovery/services/SearchIndexSyncService";
import { readData, readEnvelope, type ServiceData } from "../helpers/read-json";
import type { DiscoveryService } from "../../features/discovery/services/DiscoveryService";
import type { MenuService } from "../../features/menu/services/MenuService";

// The discovery routes hand a service result straight to the envelope, so the
// response shapes are derived from the services rather than restated here.
type DishSearch = ServiceData<DiscoveryService["searchDishes"]>;
type DishCategories = ServiceData<DiscoveryService["listDishCategories"]>;
type ServiceSearch = ServiceData<DiscoveryService["searchServices"]>;
type IndexStatus = ServiceData<DiscoveryService["getIndexStatus"]>;
type ReindexResult = ServiceData<DiscoveryService["reindex"]>;
type CategoryRow = ServiceData<MenuService["createCategory"]>;
type MenuItemRow = ServiceData<MenuService["createMenuItem"]>;

function withCsrf(
  headers: Record<string, string> = {},
): Record<string, string> {
  const csrfToken = "c".repeat(64);
  return {
    host: "test",
    origin: "https://test",
    "x-csrf-token": csrfToken,
    cookie: `csrf_token=${csrfToken}`,
    ...headers,
  };
}

function openAllWeek() {
  const day = { open: "00:00", close: "23:59", isOpen: true };
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

function closedAllWeek() {
  const day = { open: "00:00", close: "00:00", closed: true };
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
      slug: `discovery-market-${crypto.randomUUID()}`,
      name: "Discovery Test Market",
      type: "night_market",
      description: "Discovery integration market",
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

// ---------------------------------------------------------------------------
// Helper: seed entries directly into dish_search_index.
//
// IMPORTANT ARCHITECTURE NOTE: DiscoveryService searches `dish_search_index`,
// a denormalized materialized table that is NOT populated by normal menu-item
// inserts. The index is built by the admin POST /discovery/reindex endpoint,
// which requires role=0. For tests we bypass the HTTP layer and write index
// rows directly via Drizzle, which is the correct integration approach.
// ---------------------------------------------------------------------------
async function seedSearchIndex(
  testApp: RealIntegrationTestApp,
  restaurantId: string,
  items: {
    name: string;
    price: number;
    priceCents?: number | null;
    menuItemId: number;
    isAvailable?: boolean;
    district?: string;
    supportsTakeaway?: boolean;
    supportsDelivery?: boolean;
    tags?: string[];
    categoryName?: string | null;
    catalogType?: "menu_item" | "product";
    restaurantId?: string;
    marketIds?: string[];
    primaryMarketId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }[],
): Promise<void> {
  // D1/miniflare can reject large multi-row inserts if the combined SQL variable
  // count exceeds limits. Insert one row at a time to stay safe.
  for (const item of items) {
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: item.menuItemId,
      restaurantId: item.restaurantId ?? restaurantId,
      dishName: item.name,
      // Normalization mirrors DiscoveryService.normalizeQuery():
      // trim + lowercase + collapse whitespace
      dishNameNormalized: item.name.trim().toLowerCase().replace(/\s+/g, ""),
      categoryName: item.categoryName,
      isAvailable: (item.isAvailable ?? true) as unknown as boolean,
      priceCents: item.priceCents ?? Math.round(item.price * 100),
      catalogType: item.catalogType ?? "menu_item",
      district: item.district,
      supportsTakeaway: (item.supportsTakeaway ?? false) as unknown as boolean,
      supportsDelivery: (item.supportsDelivery ?? false) as unknown as boolean,
      tags: item.tags ?? [],
      marketIds: item.marketIds ?? [],
      primaryMarketId: item.primaryMarketId ?? null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      updatedAt: new Date(),
    });
  }
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function seedRealisticMarketSearchFixture(
  testApp: RealIntegrationTestApp,
  marketId: string,
  options: { vendorCount: number; itemsPerVendor: number },
): Promise<{ expectedChickenItems: number; totalItems: number }> {
  const now = new Date();
  const restaurantValues = Array.from(
    { length: options.vendorCount },
    (_, vendorIndex) => ({
      id: `load-vendor-${crypto.randomUUID()}`,
      name: `效能市場攤位 ${vendorIndex + 1}`,
      type: "street_food",
      category: "food",
      description: "Realistic market search fixture vendor",
      address: `台中市西屯區文華路 ${vendorIndex + 1} 號`,
      district: "西屯區",
      city: "台中市",
      phone: `020000${String(vendorIndex).padStart(4, "0")}`,
      businessHours: openAllWeek(),
      settings: {
        allowOnlineOrdering: true,
        allowGuestOrders: true,
        currency: "TWD",
      },
      isAvailable: true,
      isActive: true,
      supportsTakeaway: true,
      supportsDelivery: vendorIndex % 3 === 0,
      latitude: 24.1764 + vendorIndex * 0.0001,
      longitude: 120.6466 + vendorIndex * 0.0001,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const insertedRestaurants: { id: string }[] = [];
  // D1 caps a statement at 100 bound parameters. A restaurant row binds 26
  // since is_demo landed, so 4 rows (104) fail with "too many SQL variables".
  for (const chunk of chunkRows(restaurantValues, 3)) {
    const rows = await testApp.testDb.drizzle
      .insert(restaurants)
      .values(chunk)
      .returning({ id: restaurants.id });
    insertedRestaurants.push(...rows);
  }

  const membershipValues = insertedRestaurants.map(
    (restaurant, vendorIndex) => ({
      restaurantId: restaurant.id,
      marketId,
      stallNumber: `L-${String(vendorIndex + 1).padStart(3, "0")}`,
      isPrimary: vendorIndex === 0,
      joinedAt: now,
    }),
  );
  for (const chunk of chunkRows(membershipValues, 12)) {
    await testApp.testDb.drizzle
      .insert(restaurantMarketMemberships)
      .values(chunk);
  }

  const categoryValues = insertedRestaurants.map((restaurant, vendorIndex) => ({
    restaurantId: restaurant.id,
    name: `市場分類 ${vendorIndex + 1}`,
    description: "Realistic market search fixture category",
    sortOrder: 0,
    isActive: true,
    isVisible: true,
    itemCount: options.itemsPerVendor,
    createdAt: now,
    updatedAt: now,
  }));
  const insertedCategories: { id: number; restaurantId: string }[] = [];
  for (const chunk of chunkRows(categoryValues, 8)) {
    const rows = await testApp.testDb.drizzle
      .insert(categories)
      .values(chunk)
      .returning({ id: categories.id, restaurantId: categories.restaurantId });
    insertedCategories.push(...rows);
  }

  const categoryIdByRestaurant = new Map(
    insertedCategories.map((category) => [category.restaurantId, category.id]),
  );
  const menuValues = insertedRestaurants.flatMap((restaurant, vendorIndex) =>
    Array.from({ length: options.itemsPerVendor }, (_, itemIndex) => {
      const sequence = vendorIndex * options.itemsPerVendor + itemIndex;
      const isChickenItem = itemIndex % 4 === 0;
      return {
        restaurantId: restaurant.id,
        categoryId: categoryIdByRestaurant.get(restaurant.id) ?? 0,
        name: isChickenItem
          ? `夜市雞排 ${vendorIndex + 1}-${itemIndex + 1}`
          : `市場商品 ${vendorIndex + 1}-${itemIndex + 1}`,
        description: "Realistic market search fixture item",
        ingredients: "salt",
        price: 80 + (sequence % 12) * 5,
        priceCents: (80 + (sequence % 12) * 5) * 100,
        catalogType:
          itemIndex % 5 === 0 ? ("product" as const) : ("menu_item" as const),
        isAvailable: true,
        isFeatured: false,
        isPopular: sequence % 7 === 0,
        sortOrder: itemIndex,
        spiceLevel: 0,
        preparationTime: 12,
        dietaryInfo: {},
        allergens: [],
        tags: isChickenItem ? ["雞排", "小吃"] : ["夜市", "商品"],
        keywords: isChickenItem ? "雞排 小吃" : "夜市 商品",
        createdAt: now,
        updatedAt: now,
      };
    }),
  );

  const insertedItems: {
    id: number;
    restaurantId: string;
    name: string;
    priceCents: number | null;
    catalogType: "menu_item" | "product";
    tags: string[] | null;
  }[] = [];
  for (const chunk of chunkRows(menuValues, 3)) {
    const rows = await testApp.testDb.drizzle
      .insert(menuItems)
      .values(chunk)
      .returning({
        id: menuItems.id,
        restaurantId: menuItems.restaurantId,
        name: menuItems.name,
        priceCents: menuItems.priceCents,
        catalogType: menuItems.catalogType,
        tags: menuItems.tags,
      });
    insertedItems.push(...rows);
  }

  await seedSearchIndex(
    testApp,
    insertedRestaurants[0]?.id ?? "",
    insertedItems.map((item) => ({
      menuItemId: item.id,
      name: item.name,
      price: item.priceCents == null ? 0 : item.priceCents / 100,
      priceCents: item.priceCents,
      tags: item.tags ?? [],
      catalogType: item.catalogType,
      restaurantId: item.restaurantId,
      district: "西屯區",
      supportsTakeaway: true,
      supportsDelivery:
        insertedRestaurants.findIndex(
          (restaurant) => restaurant.id === item.restaurantId,
        ) %
          3 ===
        0,
      marketIds: [marketId],
      primaryMarketId: marketId,
      latitude: 24.1764,
      longitude: 120.6466,
    })),
  );

  return {
    expectedChickenItems:
      options.vendorCount * Math.ceil(options.itemsPerVendor / 4),
    totalItems: options.vendorCount * options.itemsPerVendor,
  };
}

describe("Discovery API — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  }, 300000);

  afterAll(async () => {
    await testApp?.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  // -------------------------------------------------------------------------
  // Core contract: pagination limit is applied and response envelope is correct
  // -------------------------------------------------------------------------
  it("returns paginated results and correct envelope for a dish search", async () => {
    const restaurant = await seed.restaurant();

    // Seed 12 menu items in the normalised index (with matching dish names).
    // We use seed.menuItem to create real menuItems (satisfying the FK on
    // dish_search_index.menu_item_id) and then populate the index manually.
    const menuItemIds: number[] = [];
    for (let i = 0; i < 12; i++) {
      const item = await seed.menuItem(String(restaurant.id), {
        isAvailable: true,
        name: `Nasi Lemak ${i}`,
        price: 100 + i * 10,
      });
      menuItemIds.push(item.id);
    }

    await seedSearchIndex(
      testApp,
      String(restaurant.id),
      menuItemIds.map((id, i) => ({
        menuItemId: id,
        name: `Nasi Lemak ${i}`,
        price: 100 + i * 10,
      })),
    );

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Nasi+Lemak&page=1&limit=10",
      ),
    );

    expect(res.status).toBe(200);
    const json = await readData<DishSearch>(res);

    const data = json;
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(10);

    // LIMIT 10 should be respected — no more than 10 results on page 1
    expect(data.results.length).toBeLessThanOrEqual(10);

    // At least 10 matching items are in the index, so page 1 should be full
    expect(data.results.length).toBe(10);

    expect(data.total).toBe(12);
  });

  it("warms semantic recall off the first lexical miss before querying Vectorize", async () => {
    const restaurant = await seed.restaurant({
      name: "Semantic Search Vendor",
    });
    const menuItem = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Golden Curry Rice",
      price: 130,
    });
    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: menuItem.id,
        name: "Golden Curry Rice",
        price: 130,
        tags: ["咖哩", "comfort"],
      },
    ]);

    const originalAi = testApp.env.AI;
    const originalVectorize = testApp.env.DISCOVERY_VECTORIZE;
    const originalModel = testApp.env.DISCOVERY_EMBEDDING_MODEL;
    const originalSemanticFlag = testApp.env.DISCOVERY_SEMANTIC_ENABLED;
    const ai = {
      run: vi.fn(async () => ({ data: [[0.2, 0.4, 0.6]] })),
    };
    const vectorize = {
      query: vi.fn(async () => ({
        matches: [{ id: `dish:${menuItem.id}`, score: 0.94 }],
        count: 1,
      })),
    };

    testApp.env.AI = ai;
    testApp.env.DISCOVERY_VECTORIZE = vectorize;
    testApp.env.DISCOVERY_EMBEDDING_MODEL = "@cf/baai/bge-m3";
    // Bindings alone no longer switch semantic discovery on: createSemanticDiscovery
    // withholds them unless the flag is exactly "true".
    testApp.env.DISCOVERY_SEMANTIC_ENABLED = "true";

    try {
      const query = `semantic warmup ${crypto
        .randomUUID()
        .replaceAll("-", "")
        .slice(0, 8)}`;
      const url = new URL("https://test/api/v1/discovery/search");
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "5");
      const waitUntilPromises: Array<Promise<unknown>> = [];
      const executionCtx = {
        waitUntil: (promise: Promise<unknown>) => {
          waitUntilPromises.push(promise);
        },
        passThroughOnException: () => {},
      } as unknown as ExecutionContext;

      const firstRes = await testApp.app.fetch(
        new Request(url),
        undefined,
        executionCtx,
      );

      expect(firstRes.status).toBe(200);
      const firstJson = await readData<DishSearch>(firstRes);
      expect(firstJson.results.map((item) => item.menuItemId)).not.toContain(
        menuItem.id,
      );
      expect(vectorize.query).not.toHaveBeenCalled();
      expect(waitUntilPromises).toHaveLength(1);

      await Promise.all(waitUntilPromises);
      expect(ai.run).toHaveBeenCalledTimes(1);

      const secondRes = await testApp.app.fetch(
        new Request(url),
        undefined,
        executionCtx,
      );
      expect(secondRes.status).toBe(200);
      const secondJson = await readData<DishSearch>(secondRes);
      expect(secondJson.results.map((item) => item.menuItemId)).toContain(
        menuItem.id,
      );
      expect(vectorize.query).toHaveBeenCalledWith([0.2, 0.4, 0.6], {
        topK: 50,
        namespace: "dishes",
        returnMetadata: "indexed",
      });
    } finally {
      testApp.env.AI = originalAi;
      testApp.env.DISCOVERY_VECTORIZE = originalVectorize;
      testApp.env.DISCOVERY_EMBEDDING_MODEL = originalModel;
      testApp.env.DISCOVERY_SEMANTIC_ENABLED = originalSemanticFlag;
    }
  });

  it("returns openable store entrypoints from dish and service searches", async () => {
    const restaurant = await seed.restaurant({
      name: "Openable Search Vendor",
      city: "台中市",
      district: "西屯區",
    });
    const menuItem = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Openable Bao",
      price: 95,
    });
    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: menuItem.id,
        name: "Openable Bao",
        price: 95,
        priceCents: 9500,
        district: "西屯區",
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(restaurant.id),
      name: "Openable Pickup",
      serviceType: "pickup",
      isActive: true,
      isPublic: true,
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const dishRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/search?q=Openable"),
    );
    const serviceRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/services?q=Openable"),
    );

    expect(dishRes.status).toBe(200);
    expect(serviceRes.status).toBe(200);
    const dishData = await readData<DishSearch>(dishRes);
    const serviceData = await readData<ServiceSearch>(serviceRes);

    expect(dishData.results[0]).toMatchObject({
      resultType: "menu_item",
      menuItemId: menuItem.id,
      priceCents: 9500,
      priceLabel: null,
      restaurantId: restaurant.id,
      detailUrl: `/api/v1/restaurants/${restaurant.id}`,
      menuUrl: `/api/v1/menu/${restaurant.id}`,
      menuItemUrl: `/api/v1/menu/items/${menuItem.id}`,
      serviceItemsUrl: `/api/v1/restaurants/${restaurant.id}/service-items`,
    });
    expect(serviceData.results[0]).toMatchObject({
      resultType: "service",
      restaurantId: restaurant.id,
      detailUrl: `/api/v1/restaurants/${restaurant.id}`,
      menuUrl: `/api/v1/menu/${restaurant.id}`,
      serviceItemsUrl: `/api/v1/restaurants/${restaurant.id}/service-items`,
    });
  });

  // Results span restaurants, so the one currency the customer app knows (the
  // last-visited shop's) cannot label them. Each row carries its own.
  it("labels every dish, service and popular row with its restaurant's currency", async () => {
    const vendors = [
      { name: "Currency Vendor Twd", settings: {}, currency: "TWD" },
      {
        name: "Currency Vendor Myr",
        settings: { currency: "MYR" },
        currency: "MYR",
      },
      // A broken setting is labelled as the default rather than failing the page.
      {
        name: "Currency Vendor Bad",
        settings: { currency: "USD" },
        currency: "TWD",
      },
    ];
    const expected = new Map<string, string>();
    for (const [index, vendor] of vendors.entries()) {
      const restaurant = await seed.restaurant({
        name: vendor.name,
        settings: vendor.settings,
      });
      const restaurantId = String(restaurant.id);
      expected.set(restaurantId, vendor.currency);
      const dish = await seed.menuItem(restaurantId, {
        isAvailable: true,
        name: `Currency Bao ${index}`,
        price: 12.5,
        orderCount: 10 + index,
      });
      await seedSearchIndex(testApp, restaurantId, [
        {
          menuItemId: dish.id,
          name: `Currency Bao ${index}`,
          price: 12.5,
        },
      ]);
      await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
        restaurantId,
        name: `Currency Service ${index}`,
        serviceType: "pickup",
        priceCents: 1250,
        isActive: true,
        isPublic: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const [dishRes, serviceRes, popularRes] = await Promise.all([
      testApp.app.fetch(
        new Request("https://test/api/v1/discovery/search?q=Currency+Bao"),
      ),
      testApp.app.fetch(
        new Request(
          "https://test/api/v1/discovery/services?q=Currency+Service",
        ),
      ),
      testApp.app.fetch(new Request("https://test/api/v1/discovery/popular")),
    ]);
    expect([dishRes.status, serviceRes.status, popularRes.status]).toEqual([
      200, 200, 200,
    ]);
    const dishes = (await readData<DishSearch>(dishRes)).results;
    const services = (await readData<ServiceSearch>(serviceRes)).results;
    const popular = (
      await readData<ServiceData<DiscoveryService["getPopular"]>>(popularRes)
    ).dishes;

    for (const rows of [dishes, services, popular]) {
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.currency).toBe(expected.get(row.restaurantId));
      }
    }
  });

  it("returns market context from global dish and service searches", async () => {
    const market = await seedMarket(testApp, {
      slug: "global-context-market",
      name: "全局搜尋夜市",
    });
    const restaurant = await seed.restaurant({
      name: "Global Market Context Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "G-12",
      locationLabel: "入口第一排",
      isPrimary: true,
      joinedAt: new Date(),
    });
    const menuItem = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Global Context Bao",
      price: 95,
    });
    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: menuItem.id,
        name: "Global Context Bao",
        price: 95,
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(restaurant.id),
      name: "Global Context Service",
      serviceType: "pickup",
      isActive: true,
      isPublic: true,
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const dishRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/search?q=Global+Context"),
    );
    const serviceRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/services?q=Global+Context"),
    );

    expect(dishRes.status).toBe(200);
    expect(serviceRes.status).toBe(200);
    const dishData = await readData<DishSearch>(dishRes);
    const serviceData = await readData<ServiceSearch>(serviceRes);
    const expectedMarketContext = {
      marketId: market.id,
      marketSlug: "global-context-market",
      marketName: "全局搜尋夜市",
      marketUrl: "/markets/global-context-market",
      stallNumber: "G-12",
      locationLabel: "入口第一排",
      isPrimary: true,
    };

    expect(dishData.results[0].marketVendor).toMatchObject(
      expectedMarketContext,
    );
    expect(serviceData.results[0].marketVendor).toMatchObject(
      expectedMarketContext,
    );
  });

  // -------------------------------------------------------------------------
  // Pagination offset: page 2 should return the remaining items
  // -------------------------------------------------------------------------
  it("page 2 returns the overflow items (pagination offset works)", async () => {
    const restaurant = await seed.restaurant();

    const menuItemIds: number[] = [];
    for (let i = 0; i < 12; i++) {
      const item = await seed.menuItem(String(restaurant.id), {
        isAvailable: true,
        name: `Nasi Lemak ${i}`,
        price: 100 + i * 10,
      });
      menuItemIds.push(item.id);
    }

    await seedSearchIndex(
      testApp,
      String(restaurant.id),
      menuItemIds.map((id, i) => ({
        menuItemId: id,
        name: `Nasi Lemak ${i}`,
        price: 100 + i * 10,
      })),
    );

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Nasi+Lemak&page=2&limit=10",
      ),
    );

    expect(res.status).toBe(200);
    const json = await readData<DishSearch>(res);

    const data = json;
    expect(data.page).toBe(2);
    expect(data.limit).toBe(10);
    expect(data.total).toBe(12);

    // With 12 items and limit=10, page 2 should yield exactly 2 results
    expect(data.results.length).toBe(2);
    expect(data.results.map((r) => r.dishName)).toEqual([
      "Nasi Lemak 10",
      "Nasi Lemak 11",
    ]);

    // Results on page 2 should not overlap with page 1 (ordered by price asc —
    // the two cheapest pages should be distinct sets)
    const prices: number[] = data.results.map((r) => r.price);
    expect(Math.min(...prices)).toBeGreaterThan(100 + 9 * 10 - 1); // all > page-1 items
  });

  it("keeps aggregate total stable across pages for a multi-page search", async () => {
    const restaurant = await seed.restaurant();

    const menuItemIds: number[] = [];
    for (let i = 0; i < 25; i++) {
      const item = await seed.menuItem(String(restaurant.id), {
        isAvailable: true,
        name: `Curry Puff ${i}`,
        price: 100 + i,
      });
      menuItemIds.push(item.id);
    }

    await seedSearchIndex(
      testApp,
      String(restaurant.id),
      menuItemIds.map((id, i) => ({
        menuItemId: id,
        name: `Curry Puff ${i}`,
        price: 100 + i,
      })),
    );

    const page1Res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Curry+Puff&page=1&limit=10",
      ),
    );
    const page2Res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Curry+Puff&page=2&limit=10",
      ),
    );
    const page3Res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Curry+Puff&page=3&limit=10",
      ),
    );

    expect(page1Res.status).toBe(200);
    expect(page2Res.status).toBe(200);
    expect(page3Res.status).toBe(200);

    const page1 = ((await page1Res.json()) as ApiTestResponse).data;
    const page2 = ((await page2Res.json()) as ApiTestResponse).data;
    const page3 = ((await page3Res.json()) as ApiTestResponse).data;

    expect(page1.total).toBe(25);
    expect(page2.total).toBe(25);
    expect(page3.total).toBe(25);
    expect(page1.results).toHaveLength(10);
    expect(page2.results).toHaveLength(10);
    expect(page3.results).toHaveLength(5);
    expect(page3.results.map((r) => r.dishName)).toEqual([
      "Curry Puff 20",
      "Curry Puff 21",
      "Curry Puff 22",
      "Curry Puff 23",
      "Curry Puff 24",
    ]);
  });

  it("measures market-scoped search against a realistic market-size fixture", async () => {
    const market = await seedMarket(testApp, {
      slug: "realistic-search-performance-market",
    });
    const fixture = await seedRealisticMarketSearchFixture(testApp, market.id, {
      vendorCount: 36,
      itemsPerVendor: 8,
    });

    const startedAt = performance.now();
    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=${encodeURIComponent(
          "雞排",
        )}&marketId=${market.id}&page=1&limit=20`,
      ),
    );
    const durationMs = performance.now() - startedAt;

    expect(res.status).toBe(200);
    const json = await readData<DishSearch>(res);
    expect(json.total).toBe(fixture.expectedChickenItems);
    expect(json.results).toHaveLength(20);
    expect(json.results[0].marketVendor).toMatchObject({
      marketId: market.id,
    });
    expect(fixture.totalItems).toBe(288);
    expect(durationMs).toBeLessThan(1500);
  });

  it("returns filtered totals independent of the current page slice", async () => {
    const restaurant = await seed.restaurant();

    const specs = [
      { name: "Mee 0", price: 100, district: "Xitun", supportsDelivery: true },
      { name: "Mee 1", price: 110, district: "Xitun", supportsDelivery: true },
      { name: "Mee 2", price: 120, district: "Xitun", supportsDelivery: true },
      { name: "Mee 3", price: 130, district: "Xitun", supportsDelivery: true },
      { name: "Mee 4", price: 140, district: "Xitun", supportsDelivery: false },
      { name: "Mee 5", price: 150, district: "Beitun", supportsDelivery: true },
    ];

    const rows: {
      menuItemId: number;
      name: string;
      price: number;
      district: string;
      supportsDelivery: boolean;
    }[] = [];

    for (const spec of specs) {
      const item = await seed.menuItem(String(restaurant.id), {
        isAvailable: true,
        name: spec.name,
        price: spec.price,
      });

      rows.push({
        menuItemId: item.id,
        name: spec.name,
        price: spec.price,
        district: spec.district,
        supportsDelivery: spec.supportsDelivery,
      });
    }

    await seedSearchIndex(
      testApp,
      String(restaurant.id),
      rows.map((row) => ({
        menuItemId: row.menuItemId,
        name: row.name,
        price: row.price,
        district: row.district,
        supportsDelivery: row.supportsDelivery,
      })),
    );

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Mee&district=Xitun&delivery=true&priceMin=100&priceMax=130&page=1&limit=2",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;

    expect(data.page).toBe(1);
    expect(data.limit).toBe(2);
    expect(data.results).toHaveLength(2);
    expect(data.total).toBe(4);
    expect(data.results.map((r) => r.dishName)).toEqual(["Mee 0", "Mee 1"]);
  });

  it("treats takeaway service keywords as takeaway-capable dish searches", async () => {
    const restaurant = await seed.restaurant({
      name: "Service Search Vendor",
      supportsTakeaway: true,
    });
    const takeawayItem = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Service Search Bao",
      price: 60,
    });
    const dineInOnlyItem = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Service Search Soup",
      price: 80,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: takeawayItem.id,
        name: "Service Search Bao",
        price: 60,
        supportsTakeaway: true,
      },
      {
        menuItemId: dineInOnlyItem.id,
        name: "Service Search Soup",
        price: 80,
        supportsTakeaway: false,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/search?q=外帶"),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;

    expect(data.results.map((r) => r.menuItemId)).toEqual([takeawayItem.id]);
    expect(data.total).toBe(1);
  });

  it("treats delivery service keywords as delivery-capable dish searches", async () => {
    const restaurant = await seed.restaurant({
      name: "Delivery Service Vendor",
      supportsDelivery: true,
    });
    const deliveryItem = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Delivery Service Tea",
      price: 50,
    });
    const pickupOnlyItem = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Delivery Service Cake",
      price: 90,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: deliveryItem.id,
        name: "Delivery Service Tea",
        price: 50,
        supportsDelivery: true,
      },
      {
        menuItemId: pickupOnlyItem.id,
        name: "Delivery Service Cake",
        price: 90,
        supportsDelivery: false,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/search?q=外送"),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;

    expect(data.results.map((r) => r.menuItemId)).toEqual([deliveryItem.id]);
    expect(data.total).toBe(1);
  });

  it("searches public service items scoped to a market", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-search-market",
    });
    const otherMarket = await seedMarket(testApp, {
      slug: "other-service-search-market",
    });
    const restaurant = await seed.restaurant({
      name: "Service Search Vendor",
      city: "台中市",
      district: "西屯區",
    });
    const otherRestaurant = await seed.restaurant({
      name: "Other Service Search Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(restaurant.id),
        marketId: market.id,
        stallNumber: "S-12",
        isPrimary: true,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(otherRestaurant.id),
        marketId: otherMarket.id,
        joinedAt: new Date(),
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "代客切水果",
        description: "現場代切並分裝",
        serviceType: "general",
        priceCents: 3000,
        tags: ["水果", "分裝"],
        keywords: "水果 分裝 切水果",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "內部切水果",
        serviceType: "general",
        isPublic: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(otherRestaurant.id),
        name: "其他市場切水果",
        serviceType: "general",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=切水果&marketId=${market.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;

    expect(data.total).toBe(1);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      name: "代客切水果",
      restaurantId: restaurant.id,
      restaurantName: "Service Search Vendor",
      district: "西屯區",
      serviceType: "general",
      priceCents: 3000,
      tags: ["水果", "分裝"],
    });

    for (const query of ["Service Search Vendor", "general", "S-12"]) {
      const contextRes = await testApp.app.fetch(
        new Request(
          `https://test/api/v1/discovery/services?q=${encodeURIComponent(
            query,
          )}&marketId=${market.id}`,
        ),
      );
      expect(contextRes.status).toBe(200);
      const contextData = ((await contextRes.json()) as ApiTestResponse).data;
      expect(contextData.total).toBe(1);
      expect(contextData.results[0]).toMatchObject({
        name: "代客切水果",
        restaurantId: restaurant.id,
      });
    }

    const slugRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/services?q=切水果&marketSlug=service-search-market",
      ),
    );
    expect(slugRes.status).toBe(200);
    const slugData = ((await slugRes.json()) as ApiTestResponse).data;
    expect(slugData.total).toBe(1);
    expect(slugData.results[0]).toMatchObject({
      name: "代客切水果",
      restaurantId: restaurant.id,
      marketVendor: {
        marketId: market.id,
        stallNumber: "S-12",
        isPrimary: true,
      },
    });
  });

  it("matches zh-TW service type aliases in market service search", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-alias-market",
    });
    const restaurant = await seed.restaurant({
      name: "Alias Service Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "A-19",
      isPrimary: true,
      joinedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "Market Tour Slot",
        description: "Book a guided market visit.",
        serviceType: "booking",
        priceCents: 5000,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "Market Equipment Desk",
        description: "Borrow equipment on site.",
        serviceType: "rental",
        priceCents: 2000,
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const bookingRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=${encodeURIComponent(
          "預約",
        )}&marketId=${market.id}`,
      ),
    );
    const rentalRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=${encodeURIComponent(
          "租借",
        )}&marketId=${market.id}`,
      ),
    );

    expect(bookingRes.status).toBe(200);
    expect(rentalRes.status).toBe(200);
    const bookingData = ((await bookingRes.json()) as ApiTestResponse).data;
    const rentalData = ((await rentalRes.json()) as ApiTestResponse).data;

    expect(bookingData.total).toBe(1);
    expect(bookingData.results[0]).toMatchObject({
      name: "Market Tour Slot",
      serviceType: "booking",
      marketVendor: {
        marketId: market.id,
        stallNumber: "A-19",
      },
    });
    expect(rentalData.total).toBe(1);
    expect(rentalData.results[0]).toMatchObject({
      name: "Market Equipment Desk",
      serviceType: "rental",
    });
  });

  it("matches zh-TW service content aliases in market service search", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-content-alias-market",
    });
    const restaurant = await seed.restaurant({
      name: "Service Content Alias Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "L-01",
      isPrimary: true,
      joinedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(restaurant.id),
      name: "行李寄放",
      description: "可在逛街時暫放包包",
      serviceType: "general",
      tags: ["寄放"],
      keywords: "置物 包包",
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=${encodeURIComponent(
          "寄物",
        )}&marketId=${market.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results[0]).toMatchObject({
      name: "行李寄放",
      restaurantId: restaurant.id,
      marketVendor: {
        marketId: market.id,
        stallNumber: "L-01",
      },
    });
  });

  it("ranks service name alias matches before lower-order metadata matches", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-alias-relevance-market",
    });
    const restaurant = await seed.restaurant({
      name: "Service Alias Relevance Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "L-02",
      isPrimary: true,
      joinedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "臨時服務櫃台",
        description: "現場可詢問攤位服務",
        serviceType: "general",
        keywords: "寄放 包包",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "行李寄放",
        description: "可在逛街時暫放包包",
        serviceType: "general",
        tags: ["置物"],
        sortOrder: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=${encodeURIComponent(
          "寄物",
        )}&marketId=${market.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(2);
    expect(data.results.map((result) => result.name)).toEqual([
      "行李寄放",
      "臨時服務櫃台",
    ]);
  });

  it("searches market dishes by vendor and category context", async () => {
    const market = await seedMarket(testApp, {
      slug: "dish-context-market",
    });
    const restaurant = await seed.restaurant({
      name: "Context Dish Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "D-22",
      isPrimary: true,
      joinedAt: new Date(),
    });
    const item = await seed.menuItem(String(restaurant.id), {
      name: "招牌甜甜圈",
      price: 80,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: item.id,
        name: "招牌甜甜圈",
        price: 80,
        categoryName: "甜點",
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
    ]);

    for (const query of ["Context Dish Vendor", "D-22", "甜點"]) {
      const res = await testApp.app.fetch(
        new Request(
          `https://test/api/v1/discovery/search?q=${encodeURIComponent(
            query,
          )}&marketId=${market.id}`,
        ),
      );
      expect(res.status).toBe(200);
      const data = ((await res.json()) as ApiTestResponse).data;
      expect(data.total).toBe(1);
      expect(data.results[0]).toMatchObject({
        menuItemId: item.id,
        dishName: "招牌甜甜圈",
        restaurantId: restaurant.id,
        restaurantName: "Context Dish Vendor",
        categoryName: "甜點",
        marketVendor: {
          marketId: market.id,
          stallNumber: "D-22",
          isPrimary: true,
        },
      });
    }
  });

  it("ranks market dish name matches before cheaper tag-only matches", async () => {
    const market = await seedMarket(testApp, {
      slug: "dish-relevance-market",
    });
    const restaurant = await seed.restaurant({
      name: "Dish Relevance Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "A-12",
      isPrimary: true,
      joinedAt: new Date(),
    });
    const exactItem = await seed.menuItem(String(restaurant.id), {
      name: "滷肉飯",
      price: 100,
    });
    const prefixItem = await seed.menuItem(String(restaurant.id), {
      name: "滷肉飯便當",
      price: 50,
    });
    const tagOnlyItem = await seed.menuItem(String(restaurant.id), {
      name: "招牌套餐",
      price: 10,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: tagOnlyItem.id,
        name: "招牌套餐",
        price: 10,
        tags: ["滷肉飯"],
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
      {
        menuItemId: prefixItem.id,
        name: "滷肉飯便當",
        price: 50,
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
      {
        menuItemId: exactItem.id,
        name: "滷肉飯",
        price: 100,
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=${encodeURIComponent(
          "滷肉飯",
        )}&marketId=${market.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const data = await readData<DishSearch>(res);
    expect(data.results.map((result) => result.dishName)).toEqual([
      "滷肉飯",
      "滷肉飯便當",
      "招牌套餐",
    ]);
    const marketVendor = data.results[0].marketVendor;
    expect(marketVendor?.marketId).toBe(market.id);
    expect(marketVendor?.stallNumber).toBe("A-12");
    expect(marketVendor?.isPrimary).toBe(true);
  });

  it("ranks market service name matches before lower-sort keyword matches", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-relevance-market",
    });
    const restaurant = await seed.restaurant({
      name: "Service Relevance Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "S-08",
      isPrimary: false,
      joinedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "攤位代辦",
        description: "可協助現場需求",
        serviceType: "general",
        keywords: "切水果",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "切水果",
        serviceType: "general",
        sortOrder: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "切水果外送",
        serviceType: "delivery",
        sortOrder: 20,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=${encodeURIComponent(
          "切水果",
        )}&marketId=${market.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const data = await readData<ServiceSearch>(res);
    expect(data.results.map((result) => result.name)).toEqual([
      "切水果",
      "切水果外送",
      "攤位代辦",
    ]);
    const marketVendor = data.results[0].marketVendor;
    expect(marketVendor?.marketId).toBe(market.id);
    expect(marketVendor?.stallNumber).toBe("S-08");
    expect(marketVendor?.isPrimary).toBe(false);
  });

  it("filters public service items by service type within a market", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-type-filter-market",
    });
    const restaurant = await seed.restaurant({
      name: "Service Type Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      joinedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "市場外送",
        serviceType: "delivery",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "市場預約",
        serviceType: "booking",
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?marketId=${market.id}&serviceType=delivery`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results.map((result) => result.name)).toEqual(["市場外送"]);
  });

  it("filters public service items by fulfillment support within a market", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-fulfillment-filter-market",
    });
    const takeawayRestaurant = await seed.restaurant({
      name: "Takeaway Service Vendor",
      city: "台中市",
      district: "西屯區",
      supportsTakeaway: true,
      supportsDelivery: false,
    });
    const deliveryRestaurant = await seed.restaurant({
      name: "Delivery Service Vendor",
      city: "台中市",
      district: "西屯區",
      supportsTakeaway: false,
      supportsDelivery: true,
    });
    const dineInRestaurant = await seed.restaurant({
      name: "Dine In Service Vendor",
      city: "台中市",
      district: "西屯區",
      supportsTakeaway: false,
      supportsDelivery: false,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(takeawayRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(deliveryRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(dineInRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(takeawayRestaurant.id),
        name: "可外帶代切",
        serviceType: "general",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(deliveryRestaurant.id),
        name: "可外送代切",
        serviceType: "general",
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(dineInRestaurant.id),
        name: "現場限定代切",
        serviceType: "general",
        sortOrder: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const takeawayRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?marketId=${market.id}&takeaway=true`,
      ),
    );
    const deliveryRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?marketId=${market.id}&delivery=true`,
      ),
    );

    expect(takeawayRes.status).toBe(200);
    const takeawayData = ((await takeawayRes.json()) as ApiTestResponse).data;
    expect(takeawayData.total).toBe(1);
    expect(takeawayData.results.map((result) => result.name)).toEqual([
      "可外帶代切",
    ]);

    expect(deliveryRes.status).toBe(200);
    const deliveryData = ((await deliveryRes.json()) as ApiTestResponse).data;
    expect(deliveryData.total).toBe(1);
    expect(deliveryData.results.map((result) => result.name)).toEqual([
      "可外送代切",
    ]);
  });

  it("filters open public service results before pagination", async () => {
    const closedRestaurant = await seed.restaurant({
      name: "Closed Service Open Scope Vendor",
      city: "台中市",
      district: "西屯區",
      businessHours: closedAllWeek(),
    });
    const openRestaurant = await seed.restaurant({
      name: "Open Service Open Scope Vendor",
      city: "台中市",
      district: "西屯區",
      businessHours: openAllWeek(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(closedRestaurant.id),
        name: "Open Scope Closed Service",
        serviceType: "general",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(openRestaurant.id),
        name: "Open Scope Fresh Service",
        serviceType: "general",
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/services?q=Open+Scope&openNow=true&page=1&limit=1",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      name: "Open Scope Fresh Service",
      restaurantId: String(openRestaurant.id),
      isOpen: true,
    });
  });

  it("sorts market service results by open status without filtering closed services", async () => {
    const market = await seedMarket(testApp, {
      slug: "open-sort-service-market",
    });
    const closedRestaurant = await seed.restaurant({
      name: "Closed Open Sort Vendor",
      city: "台中市",
      district: "西屯區",
      businessHours: closedAllWeek(),
    });
    const openRestaurant = await seed.restaurant({
      name: "Open Open Sort Vendor",
      city: "台中市",
      district: "西屯區",
      businessHours: openAllWeek(),
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(closedRestaurant.id),
        marketId: market.id,
        stallNumber: "C-01",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(openRestaurant.id),
        marketId: market.id,
        stallNumber: "O-01",
        joinedAt: new Date(),
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(closedRestaurant.id),
        name: "Open Sort Closed Service",
        serviceType: "general",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(openRestaurant.id),
        name: "Open Sort Fresh Service",
        serviceType: "general",
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=Open+Sort&marketId=${market.id}&sortBy=open_now`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(2);
    expect(data.results.map((result) => result.name)).toEqual([
      "Open Sort Fresh Service",
      "Open Sort Closed Service",
    ]);
    expect(data.results.map((result) => result.isOpen)).toEqual([true, false]);
  });

  it("sorts market service results by distance and returns distance metadata", async () => {
    const market = await seedMarket(testApp, {
      slug: "distance-service-market",
    });
    const nearRestaurant = await seed.restaurant({
      name: "Near Distance Service Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1765,
      longitude: 120.6467,
    });
    const farRestaurant = await seed.restaurant({
      name: "Far Distance Service Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.19,
      longitude: 120.66,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(nearRestaurant.id),
        marketId: market.id,
        stallNumber: "N-03",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(farRestaurant.id),
        marketId: market.id,
        stallNumber: "F-03",
        joinedAt: new Date(),
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(nearRestaurant.id),
        name: "Distance Service Near Pickup",
        serviceType: "pickup",
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(farRestaurant.id),
        name: "Distance Service Far Pickup",
        serviceType: "pickup",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=Distance+Service&marketId=${market.id}&lat=24.1764&lng=120.6466&radiusKm=5&sortBy=distance`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(2);
    expect(data.results.map((result) => result.name)).toEqual([
      "Distance Service Near Pickup",
      "Distance Service Far Pickup",
    ]);
    expect(Number(data.results[0].distanceKm)).toBeLessThan(
      Number(data.results[1].distanceKm),
    );
  });

  it("browses public service items by service type without a location scope", async () => {
    const deliveryRestaurant = await seed.restaurant({
      name: "Global Delivery Vendor",
      city: "台中市",
      district: "西屯區",
    });
    const bookingRestaurant = await seed.restaurant({
      name: "Global Booking Vendor",
      city: "台北市",
      district: "萬華區",
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(deliveryRestaurant.id),
        name: "全站外送",
        serviceType: "delivery",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(bookingRestaurant.id),
        name: "全站預約",
        serviceType: "booking",
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/services?serviceType=delivery",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results.map((result) => result.name)).toEqual(["全站外送"]);
  });

  it("lists service type facets for public service items within a market", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-type-facet-market",
    });
    const restaurant = await seed.restaurant({
      name: "Service Facet Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      joinedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "外送 A",
        serviceType: "delivery",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "外送 B",
        serviceType: "delivery",
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "預約服務",
        serviceType: "booking",
        sortOrder: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "內部租借",
        serviceType: "rental",
        isPublic: false,
        sortOrder: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/service-types?marketId=${market.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.serviceTypes).toEqual([
      { serviceType: "delivery", count: 2 },
      { serviceType: "booking", count: 1 },
    ]);

    const slugRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/service-types?marketSlug=service-type-facet-market",
      ),
    );
    expect(slugRes.status).toBe(200);
    const slugData = ((await slugRes.json()) as ApiTestResponse).data;
    expect(slugData.serviceTypes).toEqual([
      { serviceType: "delivery", count: 2 },
      { serviceType: "booking", count: 1 },
    ]);
  });

  it("filters service type facets by fulfillment support within a market", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-type-fulfillment-facet-market",
    });
    const takeawayRestaurant = await seed.restaurant({
      name: "Takeaway Facet Vendor",
      city: "台中市",
      district: "西屯區",
      supportsTakeaway: true,
      supportsDelivery: false,
    });
    const deliveryRestaurant = await seed.restaurant({
      name: "Delivery Facet Vendor",
      city: "台中市",
      district: "西屯區",
      supportsTakeaway: false,
      supportsDelivery: true,
    });
    const dineInRestaurant = await seed.restaurant({
      name: "Dine In Facet Vendor",
      city: "台中市",
      district: "西屯區",
      supportsTakeaway: false,
      supportsDelivery: false,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(takeawayRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(deliveryRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(dineInRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(takeawayRestaurant.id),
        name: "外帶預約",
        serviceType: "booking",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(deliveryRestaurant.id),
        name: "外送服務",
        serviceType: "delivery",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(dineInRestaurant.id),
        name: "現場租借",
        serviceType: "rental",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const takeawayRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/service-types?marketId=${market.id}&takeaway=true`,
      ),
    );
    const deliveryRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/service-types?marketId=${market.id}&delivery=true`,
      ),
    );

    expect(takeawayRes.status).toBe(200);
    const takeawayData = ((await takeawayRes.json()) as ApiTestResponse).data;
    expect(takeawayData.serviceTypes).toEqual([
      { serviceType: "booking", count: 1 },
    ]);

    expect(deliveryRes.status).toBe(200);
    const deliveryData = ((await deliveryRes.json()) as ApiTestResponse).data;
    expect(deliveryData.serviceTypes).toEqual([
      { serviceType: "delivery", count: 1 },
    ]);
  });

  it("filters service type facets by open public vendors", async () => {
    const closedRestaurant = await seed.restaurant({
      name: "Closed Service Facet Vendor",
      city: "台中市",
      district: "西屯區",
      businessHours: closedAllWeek(),
    });
    const openRestaurant = await seed.restaurant({
      name: "Open Service Facet Vendor",
      city: "台中市",
      district: "西屯區",
      businessHours: openAllWeek(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(closedRestaurant.id),
        name: "關店外送",
        serviceType: "delivery",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(openRestaurant.id),
        name: "營業預約",
        serviceType: "booking",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/service-types?city=台中市&district=西屯區&openNow=true",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.serviceTypes).toEqual([{ serviceType: "booking", count: 1 }]);
  });

  it("browses public service items by market without a keyword", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-browse-market",
    });
    const otherMarket = await seedMarket(testApp, {
      slug: "other-service-browse-market",
    });
    const restaurant = await seed.restaurant({
      name: "Service Browse Vendor",
      city: "台中市",
      district: "西屯區",
    });
    const otherRestaurant = await seed.restaurant({
      name: "Other Service Browse Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(restaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(otherRestaurant.id),
        marketId: otherMarket.id,
        joinedAt: new Date(),
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "市場瀏覽外送",
        serviceType: "delivery",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "市場瀏覽內部服務",
        serviceType: "general",
        isPublic: false,
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(otherRestaurant.id),
        name: "其他市場外送",
        serviceType: "delivery",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?marketId=${market.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      name: "市場瀏覽外送",
      restaurantId: restaurant.id,
      restaurantName: "Service Browse Vendor",
      serviceType: "delivery",
    });
  });

  it("sorts market service searches by price when requested", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-sort-market",
    });
    const restaurant = await seed.restaurant({
      name: "Service Sort Vendor",
      city: "台中市",
      district: "西屯區",
    });

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      joinedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "平價寄物",
        serviceType: "general",
        priceCents: 3000,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "高價導覽",
        serviceType: "general",
        priceCents: 12000,
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?marketId=${market.id}&sortBy=price_desc`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.results.map((result: { name: string }) => result.name)).toEqual(
      ["高價導覽", "平價寄物"],
    );
  });

  it("lists public services for a discovered restaurant", async () => {
    const restaurant = await seed.restaurant({
      name: "Discovered Service Detail Vendor",
    });
    const otherRestaurant = await seed.restaurant({
      name: "Other Service Detail Vendor",
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "公開預約導覽",
        description: "可從店鋪服務入口查看",
        serviceType: "booking",
        priceCents: 5000,
        priceLabel: "每場 NT$50",
        durationMinutes: 20,
        requiresBooking: true,
        bookingUrl: "https://example.com/book",
        tags: ["導覽"],
        keywords: "導覽 預約",
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "公開外送協助",
        serviceType: "delivery",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "內部服務",
        serviceType: "general",
        isPublic: false,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "停用服務",
        serviceType: "general",
        isActive: false,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "已刪除服務",
        serviceType: "general",
        deletedAt: new Date(),
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(otherRestaurant.id),
        name: "其他店鋪服務",
        serviceType: "general",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants/${restaurant.id}/services`,
      ),
    );

    expect(res.status).toBe(200);
    const data = (
      (await res.json()) as ApiTestResponse<{ services: ApiTestEntity[] }>
    ).data;
    expect(data.services).toHaveLength(2);
    expect(data.services.map((service) => service.name)).toEqual([
      "公開外送協助",
      "公開預約導覽",
    ]);
    expect(data.services[1]).toMatchObject({
      restaurantId: String(restaurant.id),
      name: "公開預約導覽",
      description: "可從店鋪服務入口查看",
      serviceType: "booking",
      priceCents: 5000,
      priceLabel: "每場 NT$50",
      durationMinutes: 20,
      requiresBooking: true,
      bookingUrl: "https://example.com/book",
      tags: ["導覽"],
      keywords: "導覽 預約",
      sortOrder: 2,
    });
  });

  it("only exposes discovery menu items for active public restaurants", async () => {
    const activeRestaurant = await seed.restaurant({
      name: "Active Discovery Menu Vendor",
    });
    const inactiveRestaurant = await seed.restaurant({
      name: "Inactive Discovery Menu Vendor",
      isActive: false,
    });
    const deletedRestaurant = await seed.restaurant({
      name: "Deleted Discovery Menu Vendor",
      deletedAt: new Date(),
    });

    await seed.menuItem(String(activeRestaurant.id), {
      name: "公開菜單雞排",
      isAvailable: true,
      sortOrder: 1,
    });
    await seed.menuItem(String(inactiveRestaurant.id), {
      name: "停用店家雞排",
      isAvailable: true,
      sortOrder: 1,
    });
    await seed.menuItem(String(deletedRestaurant.id), {
      name: "刪除店家雞排",
      isAvailable: true,
      sortOrder: 1,
    });

    const [activeRes, inactiveRes, deletedRes] = await Promise.all([
      testApp.app.fetch(
        new Request(
          `https://test/api/v1/discovery/restaurants/${activeRestaurant.id}/menu`,
        ),
      ),
      testApp.app.fetch(
        new Request(
          `https://test/api/v1/discovery/restaurants/${inactiveRestaurant.id}/menu`,
        ),
      ),
      testApp.app.fetch(
        new Request(
          `https://test/api/v1/discovery/restaurants/${deletedRestaurant.id}/menu`,
        ),
      ),
    ]);

    expect(activeRes.status).toBe(200);
    expect(inactiveRes.status).toBe(200);
    expect(deletedRes.status).toBe(200);

    const activeData = ((await activeRes.json()) as ApiTestResponse).data;
    const inactiveData = ((await inactiveRes.json()) as ApiTestResponse).data;
    const deletedData = ((await deletedRes.json()) as ApiTestResponse).data;

    expect(activeData.items.map((item) => item.name)).toEqual(["公開菜單雞排"]);
    expect(inactiveData.items).toEqual([]);
    expect(deletedData.items).toEqual([]);
  });

  it("excludes discovery menu items from inactive hidden or deleted categories", async () => {
    const restaurant = await seed.restaurant({
      name: "Category Gated Discovery Menu Vendor",
    });
    const now = new Date();
    const [visibleCategory, inactiveCategory, hiddenCategory, deletedCategory] =
      await testApp.testDb.drizzle
        .insert(categories)
        .values([
          {
            restaurantId: String(restaurant.id),
            name: "公開分類",
            sortOrder: 0,
            isActive: true,
            isVisible: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            restaurantId: String(restaurant.id),
            name: "停用分類",
            sortOrder: 1,
            isActive: false,
            isVisible: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            restaurantId: String(restaurant.id),
            name: "隱藏分類",
            sortOrder: 2,
            isActive: true,
            isVisible: false,
            createdAt: now,
            updatedAt: now,
          },
          {
            restaurantId: String(restaurant.id),
            name: "刪除分類",
            sortOrder: 3,
            isActive: true,
            isVisible: true,
            deletedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning();

    await seed.menuItem(String(restaurant.id), {
      name: "公開分類雞排",
      categoryId: visibleCategory.id,
      isAvailable: true,
      sortOrder: 1,
    });
    await seed.menuItem(String(restaurant.id), {
      name: "停用分類雞排",
      categoryId: inactiveCategory.id,
      isAvailable: true,
      sortOrder: 1,
    });
    await seed.menuItem(String(restaurant.id), {
      name: "隱藏分類雞排",
      categoryId: hiddenCategory.id,
      isAvailable: true,
      sortOrder: 1,
    });
    await seed.menuItem(String(restaurant.id), {
      name: "刪除分類雞排",
      categoryId: deletedCategory.id,
      isAvailable: true,
      sortOrder: 1,
    });

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants/${restaurant.id}/menu`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.items.map((item) => item.name)).toEqual(["公開分類雞排"]);
    expect(data.items[0]).toMatchObject({
      category_name: "公開分類",
    });
  });

  it("returns discovery menu catalog types for dishes and products", async () => {
    const restaurant = await seed.restaurant({
      name: "Catalog Typed Discovery Menu Vendor",
    });
    await seed.menuItem(String(restaurant.id), {
      name: "公開餐點",
      catalogType: "menu_item",
      isAvailable: true,
      sortOrder: 1,
    });
    await seed.menuItem(String(restaurant.id), {
      name: "公開商品",
      catalogType: "product",
      isAvailable: true,
      sortOrder: 2,
    });

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants/${restaurant.id}/menu`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(
      data.items.map((item) => ({
        name: item.name,
        catalogType: item.catalogType,
      })),
    ).toEqual([
      { name: "公開餐點", catalogType: "menu_item" },
      { name: "公開商品", catalogType: "product" },
    ]);
  });

  it("scopes dish search by city when districts have the same name", async () => {
    const taipeiRestaurant = await seed.restaurant({
      name: "Taipei Zhongshan Vendor",
      city: "台北市",
      district: "中山區",
    });
    const kaohsiungRestaurant = await seed.restaurant({
      name: "Kaohsiung Zhongshan Vendor",
      city: "高雄市",
      district: "中山區",
    });

    const taipeiItem = await seed.menuItem(String(taipeiRestaurant.id), {
      isAvailable: true,
      name: "City Scope Noodles",
      price: 100,
    });
    const kaohsiungItem = await seed.menuItem(String(kaohsiungRestaurant.id), {
      isAvailable: true,
      name: "City Scope Noodles",
      price: 120,
    });

    await seedSearchIndex(testApp, String(taipeiRestaurant.id), [
      {
        menuItemId: taipeiItem.id,
        name: "City Scope Noodles",
        price: 100,
        district: "中山區",
      },
    ]);
    await seedSearchIndex(testApp, String(kaohsiungRestaurant.id), [
      {
        menuItemId: kaohsiungItem.id,
        name: "City Scope Noodles",
        price: 120,
        district: "中山區",
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=City+Scope&city=%E5%8F%B0%E5%8C%97%E5%B8%82&district=%E4%B8%AD%E5%B1%B1%E5%8D%80&page=1&limit=10",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;

    expect(data.total).toBe(1);
    expect(data.results.map((r) => r.restaurantName)).toEqual([
      "Taipei Zhongshan Vendor",
    ]);
  });

  it("filters dish search by category and lists scoped categories", async () => {
    const market = await seedMarket(testApp, {
      name: "Category Market",
      city: "台中市",
      district: "北區",
    });
    const restaurant = await seed.restaurant({
      name: "Category Vendor",
      city: "台中市",
      district: "北區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });

    const snack = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Category Scope Bao",
      price: 100,
    });
    const drink = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Category Scope Tea",
      price: 80,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: snack.id,
        name: "Category Scope Bao",
        price: 100,
        district: "北區",
        categoryName: "小吃",
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
      {
        menuItemId: drink.id,
        name: "Category Scope Tea",
        price: 80,
        district: "北區",
        categoryName: "飲品",
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
    ]);

    const searchRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=Category+Scope&marketId=${market.id}&categoryName=%E5%B0%8F%E5%90%83&page=1&limit=10`,
      ),
    );
    const categoriesRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/categories?marketId=${market.id}`,
      ),
    );

    expect(searchRes.status).toBe(200);
    const searchData = ((await searchRes.json()) as ApiTestResponse).data;
    expect(searchData.total).toBe(1);
    expect(searchData.results.map((r) => r.dishName)).toEqual([
      "Category Scope Bao",
    ]);

    expect(categoriesRes.status).toBe(200);
    const categoriesJson = await readData<DishCategories>(categoriesRes);
    expect(categoriesJson.categories).toEqual(["小吃", "飲品"]);
  });

  it("matches zh-TW catalog aliases in market dish search", async () => {
    const market = await seedMarket(testApp, {
      name: "Catalog Alias Market",
      city: "台中市",
      district: "西屯區",
    });
    const restaurant = await seed.restaurant({
      name: "Catalog Alias Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "G-08",
      isPrimary: true,
      joinedAt: new Date(),
    });
    const giftBox = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Pineapple Gift Box",
      price: 320,
    });
    const tea = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Honey Black Tea",
      price: 60,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: giftBox.id,
        name: "Pineapple Gift Box",
        price: 320,
        categoryName: "禮盒",
        tags: ["名產"],
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
      {
        menuItemId: tea.id,
        name: "Honey Black Tea",
        price: 60,
        categoryName: "飲品",
        tags: ["茶飲"],
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
    ]);

    const giftRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=${encodeURIComponent(
          "伴手禮",
        )}&marketId=${market.id}`,
      ),
    );
    const drinkRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=${encodeURIComponent(
          "飲料",
        )}&marketId=${market.id}`,
      ),
    );

    expect(giftRes.status).toBe(200);
    expect(drinkRes.status).toBe(200);
    const giftData = ((await giftRes.json()) as ApiTestResponse).data;
    const drinkData = ((await drinkRes.json()) as ApiTestResponse).data;

    expect(giftData.total).toBe(1);
    expect(giftData.results[0]).toMatchObject({
      menuItemId: giftBox.id,
      dishName: "Pineapple Gift Box",
      categoryName: "禮盒",
      marketVendor: {
        marketId: market.id,
        stallNumber: "G-08",
      },
    });
    expect(drinkData.total).toBe(1);
    expect(drinkData.results[0]).toMatchObject({
      menuItemId: tea.id,
      dishName: "Honey Black Tea",
      categoryName: "飲品",
    });
  });

  it("excludes categories from inactive or deleted restaurants", async () => {
    const activeRestaurant = await seed.restaurant({
      name: "Active Category Vendor",
    });
    const inactiveRestaurant = await seed.restaurant({
      name: "Inactive Category Vendor",
      isActive: false,
    });
    const deletedRestaurant = await seed.restaurant({
      name: "Deleted Category Vendor",
      deletedAt: new Date(),
    });

    const activeDish = await seed.menuItem(String(activeRestaurant.id), {
      isAvailable: true,
      name: "Visible Category Bao",
      price: 100,
    });
    const inactiveDish = await seed.menuItem(String(inactiveRestaurant.id), {
      isAvailable: true,
      name: "Hidden Inactive Category Bao",
      price: 110,
    });
    const deletedDish = await seed.menuItem(String(deletedRestaurant.id), {
      isAvailable: true,
      name: "Hidden Deleted Category Bao",
      price: 120,
    });

    await seedSearchIndex(testApp, String(activeRestaurant.id), [
      {
        menuItemId: activeDish.id,
        name: "Visible Category Bao",
        price: 100,
        categoryName: "公開分類",
      },
    ]);
    await seedSearchIndex(testApp, String(inactiveRestaurant.id), [
      {
        menuItemId: inactiveDish.id,
        name: "Hidden Inactive Category Bao",
        price: 110,
        categoryName: "停用分類",
      },
    ]);
    await seedSearchIndex(testApp, String(deletedRestaurant.id), [
      {
        menuItemId: deletedDish.id,
        name: "Hidden Deleted Category Bao",
        price: 120,
        categoryName: "刪除分類",
      },
    ]);

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/categories"),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.categories).toEqual(["公開分類"]);
  });

  it("sorts dish search results by popularity when requested", async () => {
    const restaurant = await seed.restaurant();
    const lowDemand = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Popular Scope Rice",
      price: 100,
      orderCount: 2,
    });
    const highDemand = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Popular Scope Noodles",
      price: 120,
      orderCount: 40,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: lowDemand.id,
        name: "Popular Scope Rice",
        price: 100,
      },
      {
        menuItemId: highDemand.id,
        name: "Popular Scope Noodles",
        price: 120,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Popular+Scope&sortBy=popular&page=1&limit=10",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.results.map((r) => r.dishName)).toEqual([
      "Popular Scope Noodles",
      "Popular Scope Rice",
    ]);
  });

  it("excludes popular dishes from inactive or deleted restaurants", async () => {
    const activeRestaurant = await seed.restaurant({
      name: "Active Popular Vendor",
    });
    const inactiveRestaurant = await seed.restaurant({
      name: "Inactive Popular Vendor",
      isActive: false,
    });
    const deletedRestaurant = await seed.restaurant({
      name: "Deleted Popular Vendor",
      deletedAt: new Date(),
    });

    const activeDish = await seed.menuItem(String(activeRestaurant.id), {
      isAvailable: true,
      name: "Visible Popular Bao",
      price: 100,
      orderCount: 1,
    });
    const inactiveDish = await seed.menuItem(String(inactiveRestaurant.id), {
      isAvailable: true,
      name: "Hidden Inactive Popular Bao",
      price: 110,
      orderCount: 100,
    });
    const deletedDish = await seed.menuItem(String(deletedRestaurant.id), {
      isAvailable: true,
      name: "Hidden Deleted Popular Bao",
      price: 120,
      orderCount: 90,
    });

    await seedSearchIndex(testApp, String(activeRestaurant.id), [
      {
        menuItemId: activeDish.id,
        name: "Visible Popular Bao",
        price: 100,
      },
    ]);
    await seedSearchIndex(testApp, String(inactiveRestaurant.id), [
      {
        menuItemId: inactiveDish.id,
        name: "Hidden Inactive Popular Bao",
        price: 110,
      },
    ]);
    await seedSearchIndex(testApp, String(deletedRestaurant.id), [
      {
        menuItemId: deletedDish.id,
        name: "Hidden Deleted Popular Bao",
        price: 120,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/popular"),
    );

    expect(res.status).toBe(200);
    const data = (
      (await res.json()) as ApiTestResponse<{ dishes: ApiTestEntity[] }>
    ).data;
    expect(data.dishes.map((dish) => dish.dishName)).toEqual([
      "Visible Popular Bao",
    ]);
  });

  it("excludes dish search results from inactive or deleted restaurants", async () => {
    const activeRestaurant = await seed.restaurant({
      name: "Active Search Vendor",
    });
    const inactiveRestaurant = await seed.restaurant({
      name: "Inactive Search Vendor",
      isActive: false,
    });
    const deletedRestaurant = await seed.restaurant({
      name: "Deleted Search Vendor",
      deletedAt: new Date(),
    });

    const activeDish = await seed.menuItem(String(activeRestaurant.id), {
      isAvailable: true,
      name: "Public Gate Bao",
      price: 100,
    });
    const inactiveDish = await seed.menuItem(String(inactiveRestaurant.id), {
      isAvailable: true,
      name: "Public Gate Hidden Inactive Bao",
      price: 110,
    });
    const deletedDish = await seed.menuItem(String(deletedRestaurant.id), {
      isAvailable: true,
      name: "Public Gate Hidden Deleted Bao",
      price: 120,
    });

    await seedSearchIndex(testApp, String(activeRestaurant.id), [
      {
        menuItemId: activeDish.id,
        name: "Public Gate Bao",
        price: 100,
      },
    ]);
    await seedSearchIndex(testApp, String(inactiveRestaurant.id), [
      {
        menuItemId: inactiveDish.id,
        name: "Public Gate Hidden Inactive Bao",
        price: 110,
      },
    ]);
    await seedSearchIndex(testApp, String(deletedRestaurant.id), [
      {
        menuItemId: deletedDish.id,
        name: "Public Gate Hidden Deleted Bao",
        price: 120,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Public+Gate&page=1&limit=10",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results.map((result) => result.dishName)).toEqual([
      "Public Gate Bao",
    ]);
  });

  it("filters open dish results before pagination", async () => {
    const closedRestaurant = await seed.restaurant({
      name: "Closed Discovery Vendor",
      businessHours: closedAllWeek(),
    });
    const openRestaurant = await seed.restaurant({
      name: "Open Discovery Vendor",
      businessHours: openAllWeek(),
    });
    const closedDish = await seed.menuItem(String(closedRestaurant.id), {
      isAvailable: true,
      name: "Open Scope Closed Bestseller",
      price: 120,
      orderCount: 50,
    });
    const openDish = await seed.menuItem(String(openRestaurant.id), {
      isAvailable: true,
      name: "Open Scope Fresh Bao",
      price: 100,
      orderCount: 10,
    });

    await seedSearchIndex(testApp, String(closedRestaurant.id), [
      {
        menuItemId: closedDish.id,
        name: "Open Scope Closed Bestseller",
        price: 120,
      },
    ]);
    await seedSearchIndex(testApp, String(openRestaurant.id), [
      {
        menuItemId: openDish.id,
        name: "Open Scope Fresh Bao",
        price: 100,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Open+Scope&openNow=true&sortBy=popular&page=1&limit=1",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      menuItemId: openDish.id,
      dishName: "Open Scope Fresh Bao",
      isOpen: true,
    });
  });

  it("sorts market dish results by distance and returns distance metadata", async () => {
    const market = await seedMarket(testApp, {
      slug: "distance-dish-market",
    });
    const nearRestaurant = await seed.restaurant({
      name: "Near Distance Dish Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1765,
      longitude: 120.6467,
    });
    const farRestaurant = await seed.restaurant({
      name: "Far Distance Dish Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.19,
      longitude: 120.66,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(nearRestaurant.id),
        marketId: market.id,
        stallNumber: "N-01",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(farRestaurant.id),
        marketId: market.id,
        stallNumber: "F-01",
        joinedAt: new Date(),
      },
    ]);
    const nearDish = await seed.menuItem(String(nearRestaurant.id), {
      name: "Distance Sort Near Bao",
      price: 100,
    });
    const farDish = await seed.menuItem(String(farRestaurant.id), {
      name: "Distance Sort Far Bao",
      price: 80,
    });

    await seedSearchIndex(testApp, String(nearRestaurant.id), [
      {
        menuItemId: nearDish.id,
        name: "Distance Sort Near Bao",
        price: 100,
        marketIds: [market.id],
        primaryMarketId: market.id,
        latitude: 24.1765,
        longitude: 120.6467,
      },
    ]);
    await seedSearchIndex(testApp, String(farRestaurant.id), [
      {
        menuItemId: farDish.id,
        name: "Distance Sort Far Bao",
        price: 80,
        marketIds: [market.id],
        primaryMarketId: market.id,
        latitude: 24.19,
        longitude: 120.66,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=Distance+Sort&marketId=${market.id}&lat=24.1764&lng=120.6466&radiusKm=5&sortBy=distance`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(2);
    expect(data.results.map((result) => result.dishName)).toEqual([
      "Distance Sort Near Bao",
      "Distance Sort Far Bao",
    ]);
    expect(Number(data.results[0].distanceKm)).toBeLessThan(
      Number(data.results[1].distanceKm),
    );
  });

  it("filters open restaurant results before pagination", async () => {
    const closedRestaurant = await seed.restaurant({
      name: "Restaurant Open Scope Closed Vendor",
      businessHours: closedAllWeek(),
      totalOrders: 50,
    });
    const openRestaurant = await seed.restaurant({
      name: "Restaurant Open Scope Fresh Vendor",
      businessHours: openAllWeek(),
      totalOrders: 10,
    });

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/restaurants?q=Restaurant+Open+Scope&openNow=true&sortBy=popular&page=1&limit=1",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      restaurantId: String(openRestaurant.id),
      name: "Restaurant Open Scope Fresh Vendor",
      isOpen: true,
    });
    expect(data.results[0].restaurantId).not.toBe(String(closedRestaurant.id));
  });

  it("sorts market restaurant browse results by distance", async () => {
    const market = await seedMarket(testApp, {
      slug: "distance-restaurant-market",
    });
    const nearRestaurant = await seed.restaurant({
      name: "Restaurant Distance Near Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1765,
      longitude: 120.6467,
      totalOrders: 1,
    });
    const farRestaurant = await seed.restaurant({
      name: "Restaurant Distance Far Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.19,
      longitude: 120.66,
      totalOrders: 100,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(nearRestaurant.id),
        marketId: market.id,
        stallNumber: "N-02",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(farRestaurant.id),
        marketId: market.id,
        stallNumber: "F-02",
        joinedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants?q=Restaurant+Distance&marketId=${market.id}&lat=24.1764&lng=120.6466&radiusKm=5&sortBy=distance`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(2);
    expect(data.results.map((result) => result.name)).toEqual([
      "Restaurant Distance Near Vendor",
      "Restaurant Distance Far Vendor",
    ]);
    expect(Number(data.results[0].distanceKm)).toBeLessThan(
      Number(data.results[1].distanceKm),
    );
  });

  it("returns openable store entrypoints from restaurant browse results and cache", async () => {
    const restaurant = await seed.restaurant({
      name: "Restaurant Browse Entrypoint Vendor",
      district: "Entry District",
      totalOrders: 10,
    });
    await seed.menuItem(String(restaurant.id), {
      name: "Entrypoint Menu Item",
      isAvailable: true,
      price: 100,
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(restaurant.id),
      name: "Entrypoint Public Service",
      serviceType: "general",
      isActive: true,
      isPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const firstRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/restaurants?district=Entry+District&page=1&limit=10",
      ),
    );
    const cachedRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/restaurants?district=Entry+District&page=1&limit=10",
      ),
    );

    expect(firstRes.status).toBe(200);
    expect(cachedRes.status).toBe(200);
    const firstData = ((await firstRes.json()) as ApiTestResponse).data;
    const cachedData = ((await cachedRes.json()) as ApiTestResponse).data;
    const expectedEntryPoints = {
      restaurantId: restaurant.id,
      detailUrl: `/api/v1/restaurants/${restaurant.id}`,
      menuUrl: `/api/v1/menu/${restaurant.id}`,
      serviceItemsUrl: `/api/v1/restaurants/${restaurant.id}/service-items`,
      availableMenuItemCount: 1,
      publicServiceItemCount: 1,
    };

    expect(firstData.results[0]).toMatchObject(expectedEntryPoints);
    expect(cachedData.results[0]).toMatchObject(expectedEntryPoints);
  });

  it("browses market restaurants by vendor and stall context", async () => {
    const market = await seedMarket(testApp, {
      slug: "restaurant-browse-market",
    });
    const restaurant = await seed.restaurant({
      name: "Restaurant Browse Market Vendor",
      totalOrders: 10,
    });
    await seed.menuItem(String(restaurant.id), {
      name: "Market Browse Menu Item",
      isAvailable: true,
      price: 100,
    });
    await seed.menuItem(String(restaurant.id), {
      name: "Market Browse Hidden Menu Item",
      isAvailable: false,
      price: 100,
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values([
      {
        restaurantId: String(restaurant.id),
        name: "Market Browse Public Service",
        serviceType: "general",
        isActive: true,
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        name: "Market Browse Hidden Service",
        serviceType: "general",
        isActive: true,
        isPublic: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "B-12",
      isPrimary: true,
      joinedAt: new Date(),
    });

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants?q=B-12&marketId=${market.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results[0]).toMatchObject({
      restaurantId: String(restaurant.id),
      name: "Restaurant Browse Market Vendor",
      menuUrl: `/api/v1/menu/${restaurant.id}`,
      serviceItemsUrl: `/api/v1/restaurants/${restaurant.id}/service-items`,
      availableMenuItemCount: 1,
      publicServiceItemCount: 1,
      marketVendor: {
        marketId: market.id,
        stallNumber: "B-12",
        isPrimary: true,
      },
    });
  });

  it("does not reuse district restaurant cache for market-scoped browse", async () => {
    const district = `Cache Scope District ${crypto.randomUUID()}`;
    const market = await seedMarket(testApp, {
      slug: "restaurant-cache-scope-market",
      district,
    });
    const marketRestaurant = await seed.restaurant({
      name: "Restaurant Cache Scope Market Vendor",
      district,
      totalOrders: 20,
    });
    const outsideRestaurant = await seed.restaurant({
      name: "Restaurant Cache Scope Outside Vendor",
      district,
      totalOrders: 10,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(marketRestaurant.id),
      marketId: market.id,
      stallNumber: "C-08",
      isPrimary: true,
      joinedAt: new Date(),
    });

    const encodedDistrict = encodeURIComponent(district);
    const districtRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants?district=${encodedDistrict}&page=1&limit=10`,
      ),
    );
    expect(districtRes.status).toBe(200);
    const districtData = ((await districtRes.json()) as ApiTestResponse).data;
    expect(districtData.results.map((result) => result.restaurantId)).toEqual([
      String(marketRestaurant.id),
      String(outsideRestaurant.id),
    ]);

    const marketRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants?district=${encodedDistrict}&marketSlug=restaurant-cache-scope-market&page=1&limit=10`,
      ),
    );

    expect(marketRes.status).toBe(200);
    const marketData = ((await marketRes.json()) as ApiTestResponse).data;
    expect(marketData.total).toBe(1);
    expect(marketData.results.map((result) => result.restaurantId)).toEqual([
      String(marketRestaurant.id),
    ]);
    expect(marketData.results[0]).toMatchObject({
      restaurantId: String(marketRestaurant.id),
      name: "Restaurant Cache Scope Market Vendor",
      marketVendor: {
        marketId: market.id,
        stallNumber: "C-08",
        isPrimary: true,
      },
    });
  });

  it("invalidates old district restaurant cache after restaurant district changes", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const oldDistrict = `Old District ${suffix}`;
    const newDistrict = `New District ${suffix}`;
    const restaurant = await seed.restaurant({
      name: "Restaurant District Move Vendor",
      district: oldDistrict,
      totalOrders: 10,
    });
    await seed.user({
      id: 81,
      username: "district-move-admin",
      role: 0,
      restaurantId: String(restaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    const encodedOldDistrict = encodeURIComponent(oldDistrict);

    const cachedOldDistrictRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants?district=${encodedOldDistrict}&page=1&limit=10`,
      ),
    );
    expect(cachedOldDistrictRes.status).toBe(200);
    const cachedOldDistrictData = (
      (await cachedOldDistrictRes.json()) as ApiTestResponse
    ).data;
    expect(
      cachedOldDistrictData.results.map((result) => result.restaurantId),
    ).toEqual([String(restaurant.id)]);

    const updateRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/restaurants/${restaurant.id}`, {
        method: "PUT",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({ district: newDistrict }),
      }),
    );
    expect(updateRes.status).toBe(200);

    const oldDistrictRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants?district=${encodedOldDistrict}&page=1&limit=10`,
      ),
    );

    expect(oldDistrictRes.status).toBe(200);
    const oldDistrictData = ((await oldDistrictRes.json()) as ApiTestResponse)
      .data;
    expect(oldDistrictData.total).toBe(0);
    expect(oldDistrictData.results).toEqual([]);
  });

  it("returns restaurant browse totals independent of the current page slice", async () => {
    for (let i = 0; i < 12; i += 1) {
      await seed.restaurant({
        name: `Restaurant Total Scope Vendor ${i}`,
        totalOrders: 100 - i,
      });
    }

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/restaurants?q=Restaurant+Total+Scope&page=1&limit=10",
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(12);
    expect(data.results).toHaveLength(10);
  });

  it("browses market dishes by category without a keyword", async () => {
    const market = await seedMarket(testApp, {
      name: "Browse Category Market",
    });
    const restaurant = await seed.restaurant();
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });

    const snack = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Browse Scope Bao",
      price: 100,
    });
    const drink = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Browse Scope Tea",
      price: 80,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: snack.id,
        name: "Browse Scope Bao",
        price: 100,
        categoryName: "小吃",
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
      {
        menuItemId: drink.id,
        name: "Browse Scope Tea",
        price: 80,
        categoryName: "飲品",
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?marketId=${market.id}&categoryName=%E5%B0%8F%E5%90%83&page=1&limit=10`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;
    expect(data.total).toBe(1);
    expect(data.results.map((r) => r.dishName)).toEqual(["Browse Scope Bao"]);
  });

  // -------------------------------------------------------------------------
  // Empty result: q with no matches returns empty results array
  // -------------------------------------------------------------------------
  it("returns empty results for a query with no matching dishes", async () => {
    const restaurant = await seed.restaurant();

    const item = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Roti Canai",
      price: 80,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      { menuItemId: item.id, name: "Roti Canai", price: 80 },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Laksa&page=1&limit=10",
      ),
    );

    expect(res.status).toBe(200);
    const json = await readData<DishSearch>(res);
    expect(json.results).toEqual([]);
    expect(json.total).toBe(0);
  });

  it("returns market catalog scope metadata for empty scoped searches", async () => {
    const market = await seedMarket(testApp, {
      slug: "empty-scope-market",
    });
    const restaurant = await seed.restaurant({
      name: "Empty Scope Vendor",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "E-12",
      isPrimary: true,
      joinedAt: new Date(),
    });
    const item = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Scope Metadata Bao",
      price: 100,
    });
    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: item.id,
        name: "Scope Metadata Bao",
        price: 100,
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
    ]);
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(restaurant.id),
      name: "Scope Metadata Pickup",
      serviceType: "pickup",
      isActive: true,
      isPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const dishRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=not-found&marketId=${market.id}`,
      ),
    );
    const serviceRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/services?q=not-found&marketId=${market.id}`,
      ),
    );

    expect(dishRes.status).toBe(200);
    expect(serviceRes.status).toBe(200);
    const dishData = ((await dishRes.json()) as ApiTestResponse).data;
    const serviceData = ((await serviceRes.json()) as ApiTestResponse).data;

    const expectedScope = {
      market: {
        marketId: market.id,
        hasSearchableCatalog: true,
        searchableProductCount: 1,
        publicServiceCount: 1,
      },
    };
    expect(dishData.results).toEqual([]);
    expect(serviceData.results).toEqual([]);
    expect(dishData.scope).toEqual(expectedScope);
    expect(serviceData.scope).toEqual(expectedScope);
  });

  // -------------------------------------------------------------------------
  // Availability filter: unavailable items do not surface in search
  // -------------------------------------------------------------------------
  it("excludes unavailable dishes from search results", async () => {
    const restaurant = await seed.restaurant();

    const available = await seed.menuItem(String(restaurant.id), {
      isAvailable: true,
      name: "Mee Goreng",
      price: 90,
    });

    const unavailable = await seed.menuItem(String(restaurant.id), {
      isAvailable: false,
      name: "Mee Goreng Special",
      price: 120,
    });

    // Seed both into the index — one available, one not
    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: available.id,
        name: "Mee Goreng",
        price: 90,
        isAvailable: true,
      },
      {
        menuItemId: unavailable.id,
        name: "Mee Goreng Special",
        price: 120,
        isAvailable: false,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Mee+Goreng&page=1&limit=10",
      ),
    );

    expect(res.status).toBe(200);
    const json = await readData<DishSearch>(res);

    const results = json.results;

    // Only the available item should appear
    const foundAvailable = results.find((r) => r.menuItemId === available.id);
    const foundUnavailable = results.find(
      (r) => r.menuItemId === unavailable.id,
    );

    expect(foundAvailable).toBeTruthy();
    expect(foundUnavailable).toBeUndefined();
  });

  it("keeps tag matched dish results scoped to the requested market", async () => {
    const market = await seedMarket(testApp, {
      slug: "tag-scoped-market",
    });
    const otherMarket = await seedMarket(testApp, {
      slug: "other-tag-market",
    });
    const restaurant = await seed.restaurant({
      name: "Market Tag Vendor",
    });
    const otherRestaurant = await seed.restaurant({
      name: "Other Market Vendor",
    });
    const marketItem = await seed.menuItem(String(restaurant.id), {
      name: "Market Bao",
      price: 60,
    });
    const otherItem = await seed.menuItem(String(otherRestaurant.id), {
      name: "Other Bao",
      price: 70,
    });

    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: marketItem.id,
        name: "Market Bao",
        price: 60,
        tags: ["signature"],
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
    ]);
    await seedSearchIndex(testApp, String(otherRestaurant.id), [
      {
        menuItemId: otherItem.id,
        name: "Other Bao",
        price: 70,
        tags: ["signature"],
        marketIds: [otherMarket.id],
        primaryMarketId: otherMarket.id,
      },
    ]);
    await testApp.testDb.bindings.CACHE_KV.put(
      "search:tags:index",
      JSON.stringify({
        signature: [
          { menuItemId: marketItem.id },
          { menuItemId: otherItem.id },
        ],
      }),
    );

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=signature&marketId=${market.id}`,
      ),
    );

    expect(res.status).toBe(200);
    const data = ((await res.json()) as ApiTestResponse).data;

    expect(data.results.map((r) => r.menuItemId)).toEqual([marketItem.id]);
    expect(data.total).toBe(1);
  });

  it("serves fresh search results after search index sync changes cached dishes", async () => {
    const restaurant = await seed.restaurant({
      name: "Cached Search Vendor",
    });
    const item = await seed.menuItem(String(restaurant.id), {
      name: "Cached Bao",
      price: 60,
      isAvailable: true,
    });
    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: item.id,
        name: "Cached Bao",
        price: 60,
        isAvailable: true,
      },
    ]);

    const firstRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/search?q=Cached+Bao"),
    );
    expect(firstRes.status).toBe(200);
    const firstData = ((await firstRes.json()) as ApiTestResponse).data;
    expect(firstData.results.map((r) => r.menuItemId)).toEqual([item.id]);

    await testApp.testDb.drizzle
      .update(menuItems)
      .set({ isAvailable: false })
      .where(eq(menuItems.id, item.id));
    const sync = new SearchIndexSyncService(
      testApp.testDb.bindings.DB,
      testApp.testDb.bindings.CACHE_KV,
    );
    await sync.onMenuItemChanged(item.id);

    const secondRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/search?q=Cached+Bao"),
    );
    expect(secondRes.status).toBe(200);
    const secondData = ((await secondRes.json()) as ApiTestResponse).data;
    expect(secondData.results).toEqual([]);
    expect(secondData.total).toBe(0);
  });

  it("marks indexed dishes unavailable when a restaurant is deactivated", async () => {
    const restaurant = await seed.restaurant({
      name: "Restaurant Sync Disabled Vendor",
    });
    const item = await seed.menuItem(String(restaurant.id), {
      name: "Restaurant Sync Disabled Bao",
      price: 60,
      isAvailable: true,
    });
    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: item.id,
        name: "Restaurant Sync Disabled Bao",
        price: 60,
        isAvailable: true,
      },
    ]);

    await testApp.testDb.drizzle
      .update(restaurants)
      .set({ isActive: false })
      .where(eq(restaurants.id, String(restaurant.id)));
    const sync = new SearchIndexSyncService(
      testApp.testDb.bindings.DB,
      testApp.testDb.bindings.CACHE_KV,
    );
    await sync.onRestaurantChanged(String(restaurant.id));

    const [indexed] = await testApp.testDb.drizzle
      .select({ isAvailable: dishSearchIndex.isAvailable })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, item.id))
      .limit(1);

    expect(indexed).toEqual({ isAvailable: false });
  });

  it("keeps one search-index row when menu item sync is redelivered", async () => {
    const restaurant = await seed.restaurant({
      name: "Redelivered Search Sync Vendor",
    });
    const item = await seed.menuItem(String(restaurant.id), {
      name: "Redelivered Search Sync Bao",
      price: 60,
      isAvailable: true,
    });
    const sync = new SearchIndexSyncService(
      testApp.testDb.bindings.DB,
      testApp.testDb.bindings.CACHE_KV,
    );

    await sync.onMenuItemChanged(item.id);
    await sync.onMenuItemChanged(item.id);

    const indexedRows = await testApp.testDb.drizzle
      .select({ id: dishSearchIndex.id })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, item.id));

    expect(indexedRows).toHaveLength(1);
  });

  it("indexes menu item changes under inactive restaurants as unavailable", async () => {
    const restaurant = await seed.restaurant({
      name: "Inactive Menu Sync Vendor",
      isActive: false,
    });
    const item = await seed.menuItem(String(restaurant.id), {
      name: "Inactive Menu Sync Bao",
      price: 60,
      isAvailable: true,
    });

    const sync = new SearchIndexSyncService(
      testApp.testDb.bindings.DB,
      testApp.testDb.bindings.CACHE_KV,
    );
    await sync.onMenuItemChanged(item.id);

    const [indexed] = await testApp.testDb.drizzle
      .select({ isAvailable: dishSearchIndex.isAvailable })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, item.id))
      .limit(1);

    expect(indexed).toEqual({ isAvailable: false });
  });

  it("indexes menu item changes under private categories as unavailable", async () => {
    const restaurant = await seed.restaurant({
      name: "Private Category Menu Sync Vendor",
    });
    const now = new Date();
    const [hiddenCategory] = await testApp.testDb.drizzle
      .insert(categories)
      .values({
        restaurantId: String(restaurant.id),
        name: "Hidden Sync Category",
        sortOrder: 0,
        isActive: true,
        isVisible: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const item = await seed.menuItem(String(restaurant.id), {
      categoryId: hiddenCategory.id,
      name: "Hidden Category Sync Bao",
      price: 60,
      isAvailable: true,
    });

    const sync = new SearchIndexSyncService(
      testApp.testDb.bindings.DB,
      testApp.testDb.bindings.CACHE_KV,
    );
    await sync.onMenuItemChanged(item.id);

    const [indexed] = await testApp.testDb.drizzle
      .select({ isAvailable: dishSearchIndex.isAvailable })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, item.id))
      .limit(1);

    expect(indexed).toEqual({ isAvailable: false });
  });

  it("syncs discovery index after menu item availability changes through menu API", async () => {
    const market = await seedMarket(testApp, {
      slug: "menu-sync-market",
    });
    const restaurant = await seed.restaurant({
      name: "Menu Sync Vendor",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    await seed.user({
      id: 41,
      username: "menu-sync-admin",
      role: 0,
      restaurantId: String(restaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    const item = await seed.menuItem(String(restaurant.id), {
      name: "Menu Sync Bao",
      price: 60,
      isAvailable: true,
    });
    await seedSearchIndex(testApp, String(restaurant.id), [
      {
        menuItemId: item.id,
        name: "Menu Sync Bao",
        price: 60,
        isAvailable: true,
        marketIds: [market.id],
        primaryMarketId: market.id,
      },
    ]);

    const firstRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=Menu+Sync+Bao&marketId=${market.id}`,
      ),
    );
    expect(firstRes.status).toBe(200);
    const firstData = ((await firstRes.json()) as ApiTestResponse).data;
    expect(firstData.results.map((r) => r.menuItemId)).toEqual([item.id]);

    const updateRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/items/${item.id}`, {
        method: "PUT",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({ isAvailable: false }),
      }),
    );
    expect(updateRes.status).toBe(200);

    const secondRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=Menu+Sync+Bao&marketId=${market.id}`,
      ),
    );
    expect(secondRes.status).toBe(200);
    const secondData = ((await secondRes.json()) as ApiTestResponse).data;
    expect(secondData.results).toEqual([]);
    expect(secondData.total).toBe(0);
  });

  it("syncs market-scoped discovery after menu items are created through menu API", async () => {
    const market = await seedMarket(testApp, {
      slug: "menu-create-sync-market",
    });
    const restaurant = await seed.restaurant({
      name: "Menu Create Sync Vendor",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );

    const categoryRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/categories`, {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          name: "市場小吃",
        }),
      }),
    );
    expect(categoryRes.status).toBe(201);
    const categoryJson = await readData<CategoryRow>(categoryRes);

    const createRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          categoryId: categoryJson.id,
          name: "API 建立市場雞排",
          description: "剛建立後就應該可被市場搜尋",
          price: 88,
          tags: ["雞排", "夜市"],
          keywords: "雞排 夜市",
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createJson = await readData<MenuItemRow>(createRes);

    const searchRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=${encodeURIComponent(
          "雞排",
        )}&marketId=${market.id}`,
      ),
    );

    expect(searchRes.status).toBe(200);
    const data = ((await searchRes.json()) as ApiTestResponse).data;
    expect(data.results.map((r) => r.menuItemId)).toEqual([createJson.id]);
    expect(data.results[0]).toMatchObject({
      restaurantId: restaurant.id,
      restaurantName: "Menu Create Sync Vendor",
      dishName: "API 建立市場雞排",
    });
    expect(data.total).toBe(1);
  });

  it("syncs product catalog type after products are created through menu API", async () => {
    const market = await seedMarket(testApp, {
      slug: "product-create-sync-market",
    });
    const restaurant = await seed.restaurant({
      name: "Product Create Sync Vendor",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );

    const categoryRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/categories`, {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          name: "市場商品",
        }),
      }),
    );
    expect(categoryRes.status).toBe(201);
    const categoryJson = await readData<CategoryRow>(categoryRes);

    const createRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          categoryId: categoryJson.id,
          name: "API 建立市場伴手禮",
          description: "商品建立後應該進入商品搜尋索引",
          price: 180,
          catalogType: "product",
          tags: ["伴手禮", "商品"],
          keywords: "伴手禮 商品",
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createJson = await readData<MenuItemRow>(createRes);

    const [indexedProduct] = await testApp.testDb.drizzle
      .select({ catalogType: dishSearchIndex.catalogType })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, createJson.id))
      .limit(1);
    expect(indexedProduct).toEqual({ catalogType: "product" });

    const productSearchRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=${encodeURIComponent(
          "伴手禮",
        )}&marketId=${market.id}&catalogType=product`,
      ),
    );
    expect(productSearchRes.status).toBe(200);
    const productData = ((await productSearchRes.json()) as ApiTestResponse)
      .data;
    expect(productData.results.map((r) => r.menuItemId)).toEqual([
      createJson.id,
    ]);
    expect(productData.results[0]).toMatchObject({
      resultType: "product",
      dishName: "API 建立市場伴手禮",
    });

    const menuSearchRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=${encodeURIComponent(
          "伴手禮",
        )}&marketId=${market.id}&catalogType=menu_item`,
      ),
    );
    expect(menuSearchRes.status).toBe(200);
    const menuData = ((await menuSearchRes.json()) as ApiTestResponse).data;
    expect(menuData.results).toEqual([]);
    expect(menuData.total).toBe(0);
  });

  it("syncs discovery index after categories are hidden through menu API", async () => {
    const market = await seedMarket(testApp, {
      slug: "category-hide-sync-market",
    });
    const restaurant = await seed.restaurant({
      name: "Category Hide Sync Vendor",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );

    const categoryRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/categories`, {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          name: "同步分類",
        }),
      }),
    );
    expect(categoryRes.status).toBe(201);
    const categoryJson = await readData<CategoryRow>(categoryRes);

    const createRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          categoryId: categoryJson.id,
          name: "分類同步雞排",
          description: "分類隱藏後應該立即從搜尋移除",
          price: 88,
          tags: ["分類同步"],
          keywords: "分類同步 雞排",
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createJson = await readData<MenuItemRow>(createRes);

    const beforeRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=${encodeURIComponent(
          "分類同步",
        )}&marketId=${market.id}`,
      ),
    );
    expect(beforeRes.status).toBe(200);
    const beforeData = ((await beforeRes.json()) as ApiTestResponse).data;
    expect(beforeData.results.map((r) => r.menuItemId)).toEqual([
      createJson.id,
    ]);

    const updateCategoryRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/categories/${categoryJson.id}`, {
        method: "PUT",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          isVisible: false,
        }),
      }),
    );
    expect(updateCategoryRes.status).toBe(200);

    const afterRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=${encodeURIComponent(
          "分類同步",
        )}&marketId=${market.id}`,
      ),
    );
    expect(afterRes.status).toBe(200);
    const afterData = ((await afterRes.json()) as ApiTestResponse).data;
    expect(afterData.results).toEqual([]);
    expect(afterData.total).toBe(0);
  });

  it("excludes inactive and deleted markets from full reindex market membership fields", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Discovery Reindex Admin",
    });
    await seed.user({
      id: 31,
      username: "discovery-reindex-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const restaurant = await seed.restaurant({
      name: "Inactive Market Vendor",
      district: "西屯區",
      city: "台中市",
      latitude: 24.1491,
      longitude: 120.6842,
      supportsTakeaway: true,
    });
    const activeMarket = await seedMarket(testApp, {
      slug: "active-reindex-market",
    });
    const inactiveMarket = await seedMarket(testApp, {
      slug: "inactive-reindex-market",
      isActive: false,
    });
    const deletedMarket = await seedMarket(testApp, {
      slug: "deleted-reindex-market",
      deletedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(restaurant.id),
        marketId: activeMarket.id,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        marketId: inactiveMarket.id,
        isPrimary: true,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        marketId: deletedMarket.id,
        joinedAt: new Date(),
      },
    ]);
    const item = await seed.menuItem(String(restaurant.id), {
      name: "Reindex Market Bao",
      price: 60,
      priceCents: 6000,
    });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/reindex", {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
        }),
      }),
    );
    expect(res.status).toBe(200);

    const [indexed] = await testApp.testDb.drizzle
      .select({
        primaryMarketId: dishSearchIndex.primaryMarketId,
        marketIds: dishSearchIndex.marketIds,
      })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, item.id))
      .limit(1);

    expect(indexed).toEqual({
      primaryMarketId: null,
      marketIds: [activeMarket.id],
    });
  });

  it("returns discovery index status after an admin reindex", async () => {
    const restaurant = await seed.restaurant({
      name: "Index Status Vendor",
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    await seed.menuItem(String(restaurant.id), {
      name: "Index Status Bao",
      price: 60,
    });
    await seed.menuItem(String(restaurant.id), {
      name: "Hidden Index Status Bao",
      price: 70,
      isAvailable: false,
    });

    const reindexRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/reindex", {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
        }),
      }),
    );
    expect(reindexRes.status).toBe(200);

    const statusRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/index-status", {
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      }),
    );

    expect(statusRes.status).toBe(200);
    const json = await readData<IndexStatus>(statusRes);
    expect(json).toMatchObject({
      indexedDishCount: 2,
      availableDishCount: 1,
      indexedRestaurantCount: 1,
      sourceAvailableDishCount: 1,
      unindexedAvailableDishCount: 0,
      restaurantsWithUnindexedAvailableDishes: 0,
    });
    expect(Number(json.version)).toBeGreaterThan(0);
    expect(json.lastReindexedAt).not.toBeNull();
    expect(Date.parse(String(json.lastReindexedAt))).not.toBeNaN();
  });

  it("upserts semantic dish vectors during admin reindex when bindings are configured", async () => {
    const restaurant = await seed.restaurant({
      name: "Semantic Reindex Vendor",
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    const menuItem = await seed.menuItem(String(restaurant.id), {
      name: "Semantic Reindex Curry",
      price: 120,
      tags: ["咖哩", "語意"],
      keywords: "咖哩 語意",
    });

    const originalAi = testApp.env.AI;
    const originalVectorize = testApp.env.DISCOVERY_VECTORIZE;
    const originalSemanticFlag = testApp.env.DISCOVERY_SEMANTIC_ENABLED;
    const ai = {
      run: vi.fn(async (_model: string, input: { text: string | string[] }) => {
        const texts = Array.isArray(input.text) ? input.text : [input.text];
        return {
          data: texts.map(() => [0.3, 0.2, 0.1]),
        };
      }),
    };
    const vectorize = {
      query: vi.fn(),
      upsert: vi.fn(async () => ({ mutationId: "mutation-1" })),
    };
    testApp.env.AI = ai;
    testApp.env.DISCOVERY_VECTORIZE = vectorize;
    // Bindings alone no longer switch semantic discovery on: createSemanticDiscovery
    // withholds them unless the flag is exactly "true".
    testApp.env.DISCOVERY_SEMANTIC_ENABLED = "true";

    try {
      const res = await testApp.app.fetch(
        new Request("https://test/api/v1/discovery/reindex", {
          method: "POST",
          headers: withCsrf({
            authorization: `Bearer ${adminToken}`,
          }),
        }),
      );

      expect(res.status).toBe(200);
      const json = await readData<ReindexResult>(res);
      expect(json.semanticDishes).toBe(1);
      expect(vectorize.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: `dish:${menuItem.id}`,
          namespace: "dishes",
          values: [0.3, 0.2, 0.1],
          metadata: expect.objectContaining({
            restaurantId: String(restaurant.id),
            catalogType: "menu_item",
          }),
        }),
      ]);
    } finally {
      testApp.env.AI = originalAi;
      testApp.env.DISCOVERY_VECTORIZE = originalVectorize;
      testApp.env.DISCOVERY_SEMANTIC_ENABLED = originalSemanticFlag;
    }
  });

  it("reports public menu items that have not entered the discovery index", async () => {
    const restaurant = await seed.restaurant({
      name: "Index Gap Vendor",
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    await seed.menuItem(String(restaurant.id), {
      name: "Indexed Gap Bao",
      price: 60,
    });

    const reindexRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/reindex", {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
        }),
      }),
    );
    expect(reindexRes.status).toBe(200);

    await seed.menuItem(String(restaurant.id), {
      name: "Unindexed Gap Bao",
      price: 70,
    });

    const statusRes = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/index-status", {
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      }),
    );

    expect(statusRes.status).toBe(200);
    const json = await readData<IndexStatus>(statusRes);
    expect(json).toMatchObject({
      indexedDishCount: 1,
      availableDishCount: 1,
      indexedRestaurantCount: 1,
      sourceAvailableDishCount: 2,
      unindexedAvailableDishCount: 1,
      restaurantsWithUnindexedAvailableDishes: 1,
    });
  });

  it("removes inactive and deleted restaurant dishes during full reindex", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Restaurant Reindex Admin",
    });
    await seed.user({
      id: 32,
      username: "restaurant-reindex-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );

    const activeRestaurant = await seed.restaurant({
      name: "Active Reindex Vendor",
    });
    const inactiveRestaurant = await seed.restaurant({
      name: "Inactive Reindex Vendor",
      isActive: false,
    });
    const deletedRestaurant = await seed.restaurant({
      name: "Deleted Reindex Vendor",
      deletedAt: new Date(),
    });

    const activeItem = await seed.menuItem(String(activeRestaurant.id), {
      name: "Active Reindex Bao",
      price: 60,
    });
    const inactiveItem = await seed.menuItem(String(inactiveRestaurant.id), {
      name: "Inactive Reindex Bao",
      price: 70,
    });
    const deletedItem = await seed.menuItem(String(deletedRestaurant.id), {
      name: "Deleted Reindex Bao",
      price: 80,
    });

    await seedSearchIndex(testApp, String(inactiveRestaurant.id), [
      {
        menuItemId: inactiveItem.id,
        name: "Inactive Reindex Bao",
        price: 70,
      },
    ]);
    await seedSearchIndex(testApp, String(deletedRestaurant.id), [
      {
        menuItemId: deletedItem.id,
        name: "Deleted Reindex Bao",
        price: 80,
      },
    ]);

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/reindex", {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
        }),
      }),
    );
    expect(res.status).toBe(200);

    const rows = await testApp.testDb.drizzle
      .select({
        menuItemId: dishSearchIndex.menuItemId,
        dishName: dishSearchIndex.dishName,
      })
      .from(dishSearchIndex)
      .orderBy(dishSearchIndex.menuItemId);

    expect(rows).toEqual([
      {
        menuItemId: activeItem.id,
        dishName: "Active Reindex Bao",
      },
    ]);
  });

  it("marks private category dishes unavailable during full reindex", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Category Reindex Admin",
    });
    await seed.user({
      id: 33,
      username: "category-reindex-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );

    const restaurant = await seed.restaurant({
      name: "Private Category Reindex Vendor",
    });
    const now = new Date();
    const [hiddenCategory] = await testApp.testDb.drizzle
      .insert(categories)
      .values({
        restaurantId: String(restaurant.id),
        name: "Hidden Reindex Category",
        sortOrder: 0,
        isActive: true,
        isVisible: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const item = await seed.menuItem(String(restaurant.id), {
      categoryId: hiddenCategory.id,
      name: "Hidden Reindex Bao",
      price: 60,
      isAvailable: true,
    });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/reindex", {
        method: "POST",
        headers: withCsrf({
          authorization: `Bearer ${adminToken}`,
        }),
      }),
    );
    expect(res.status).toBe(200);

    const [indexed] = await testApp.testDb.drizzle
      .select({
        menuItemId: dishSearchIndex.menuItemId,
        isAvailable: dishSearchIndex.isAvailable,
      })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, item.id))
      .limit(1);

    expect(indexed).toEqual({
      menuItemId: item.id,
      isAvailable: false,
    });
  });

  // -------------------------------------------------------------------------
  // Missing q param: validation error (not a 500)
  // -------------------------------------------------------------------------
  it("returns 400 when q param is missing", async () => {
    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/search?page=1&limit=10"),
    );

    // dishSearchQuerySchema requires q — should fail validation cleanly
    expect(res.status).toBe(400);
    const json = await readEnvelope<DishSearch>(res);
    expect(json.success).toBe(false);
  });
});
