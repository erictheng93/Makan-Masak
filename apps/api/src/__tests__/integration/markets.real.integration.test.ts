import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import {
  dishSearchIndex,
  markets,
  restaurants,
  restaurantServiceItems,
  restaurantMarketMemberships,
  shopSubscriptions,
} from "@makanmasak/database";
import { and, eq, isNull } from "drizzle-orm";
import { readData, readEnvelope, type ServiceData } from "../helpers/read-json";
import type { MarketsService } from "../../features/markets/services/MarketsService";
import type { DiscoveryService } from "../../features/discovery/services/DiscoveryService";
import type { RestaurantsService } from "../../features/restaurants/services/RestaurantsService";

// The market routes hand a service result straight to the envelope, so the
// response shapes are derived from the services rather than restated here —
// a reshaped service then breaks this file at compile time.
type MarketList = ServiceData<MarketsService["listMarkets"]>;
type MarketDetail = ServiceData<MarketsService["getMarketBySlug"]>;
type MarketAreas = ServiceData<MarketsService["listAreas"]>;
type NearbyMarkets = ServiceData<MarketsService["findNearby"]>;
type MarketVendors = ServiceData<MarketsService["listVendors"]>;
type AdminReadiness = ServiceData<MarketsService["listAdminReadiness"]>;
type AdminAreaReadiness = ServiceData<MarketsService["listAreaReadiness"]>;
type VendorCandidates = ServiceData<MarketsService["listVendorCandidates"]>;
type AdminJoinRequests = ServiceData<MarketsService["listJoinRequests"]>;
type RestaurantMemberships = ServiceData<
  MarketsService["listRestaurantMemberships"]
>;
type RestaurantJoinRequests = ServiceData<
  MarketsService["listRestaurantJoinRequests"]
>;
type MarketEnvelope = { market: ServiceData<MarketsService["createMarket"]> };
type MembershipEnvelope = {
  membership: ServiceData<MarketsService["addVendor"]>;
};
type CreatedJoinRequest = Pick<
  Extract<
    ServiceData<MarketsService["createJoinRequest"]>,
    { status: "created" }
  >,
  "request"
>;
type ApprovedJoinRequest = Pick<
  Extract<
    ServiceData<MarketsService["approveJoinRequest"]>,
    { status: "approved" }
  >,
  "request" | "membership"
>;
type RejectedJoinRequest = Pick<
  Extract<
    ServiceData<MarketsService["rejectJoinRequest"]>,
    { status: "rejected" }
  >,
  "request"
>;
type DishSearch = ServiceData<DiscoveryService["searchDishes"]>;
type TakeawayEligibility = ServiceData<
  DiscoveryService["getTakeawayEligibility"]
>;
type RestaurantMarkets = ServiceData<DiscoveryService["getRestaurantMarkets"]>;
type ContactProfile = ServiceData<RestaurantsService["getContactProfile"]>;

// The bulk-import envelopes are assembled inline by the admin routes rather
// than returned by a service, so this file states the fields it reads.
interface BulkImportIssue {
  index: number;
  code: string;
  severity: string;
  message: string;
  slug?: string;
  marketName?: string;
  restaurantId?: string;
  restaurantName?: string;
}

interface BulkImportRow {
  status: string;
  reason?: string;
  slug?: string;
  marketName?: string;
  restaurantId?: string;
  restaurantName?: string;
  stallNumber?: string | null;
  locationLabel?: string | null;
  mapPosition?: unknown;
  membershipId?: unknown;
  market?: { id: string; slug: string };
}

interface VendorImportResult extends BulkImportResult {
  catalogReadiness: ServiceData<MarketsService["getCatalogReadiness"]>;
  publicReadiness: ServiceData<MarketsService["getPublicReadiness"]>;
}

interface BulkImportResult {
  dryRun?: boolean;
  wouldCreateMarkets?: number;
  createdMarkets?: number;
  wouldCreateRestaurants?: number;
  createdRestaurants?: number;
  wouldAttachVendors?: number;
  attachedVendors?: number;
  skipped: number;
  issueCount: number;
  blockingIssueCount: number;
  warningIssueCount?: number;
  issues: BulkImportIssue[];
  results: BulkImportRow[];
  catalogReadiness?: ServiceData<MarketsService["getCatalogReadiness"]>;
  publicReadiness?: ServiceData<MarketsService["getPublicReadiness"]>;
}

const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  cookie: `csrf_token=${"a".repeat(64)}`,
  "x-csrf-token": "a".repeat(64),
};

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
      slug: `test-market-${crypto.randomUUID()}`,
      name: "逢甲夜市",
      type: "night_market",
      description: "Integration test market",
      city: "台中市",
      district: "西屯區",
      address: "台中市西屯區文華路",
      latitude: 24.1764,
      longitude: 120.6466,
      openingHours: openAllWeek(),
      bannerUrl: "https://example.com/banner.jpg",
      logoUrl: "https://example.com/logo.jpg",
      imageUrls: ["https://example.com/gallery.jpg"],
      tags: ["夜市", "小吃"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();
  return market;
}

async function seedSearchableMarket(
  testApp: RealIntegrationTestApp,
  seed: ReturnType<typeof buildSeedHelpers>,
  marketOverrides: Partial<typeof markets.$inferInsert> = {},
  restaurantOverrides: Parameters<typeof seed.restaurant>[0] = {},
) {
  const market = await seedMarket(testApp, marketOverrides);
  const restaurant = await seed.restaurant({
    name: `${market.slug} Vendor`,
    city: market.city,
    district: market.district,
    latitude: market.latitude,
    longitude: market.longitude,
    isActive: true,
    ...restaurantOverrides,
  });
  await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
    restaurantId: String(restaurant.id),
    marketId: market.id,
    isPrimary: true,
    joinedAt: new Date(),
  });
  const menuItem = await seed.menuItem(String(restaurant.id), {
    name: `${market.name} Searchable Item`,
    price: 95,
  });
  await testApp.testDb.drizzle.insert(dishSearchIndex).values({
    menuItemId: menuItem.id,
    restaurantId: String(restaurant.id),
    dishName: `${market.name} Searchable Item`,
    dishNameNormalized: `${market.slug.replaceAll("-", "")}searchableitem`,
    priceCents: 9500,
    isAvailable: true,
    tags: [],
    district: market.district,
    primaryMarketId: market.id,
    marketIds: [market.id],
    latitude: market.latitude,
    longitude: market.longitude,
    updatedAt: new Date(),
  });

  return { market, restaurant, menuItem };
}

async function seedServiceOnlyMarket(
  testApp: RealIntegrationTestApp,
  seed: ReturnType<typeof buildSeedHelpers>,
  marketOverrides: Partial<typeof markets.$inferInsert> = {},
  restaurantOverrides: Parameters<typeof seed.restaurant>[0] = {},
) {
  const market = await seedMarket(testApp, marketOverrides);
  const restaurant = await seed.restaurant({
    name: `${market.slug} Service Vendor`,
    city: market.city,
    district: market.district,
    latitude: market.latitude,
    longitude: market.longitude,
    isActive: true,
    ...restaurantOverrides,
  });
  await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
    restaurantId: String(restaurant.id),
    marketId: market.id,
    isPrimary: true,
    joinedAt: new Date(),
  });
  await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
    restaurantId: String(restaurant.id),
    name: `${market.name} Public Service`,
    serviceType: "general",
    isActive: true,
    isPublic: true,
    sortOrder: 1,
  });

  return { market, restaurant };
}

describe("Markets API — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  }, 300000);

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  it("lists public markets and resolves a market detail by slug", async () => {
    const restaurant = await seed.restaurant({
      name: "Fengjia Fried Chicken",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1765,
      longitude: 120.6467,
      supportsTakeaway: true,
      enableShopMode: true,
      shopQrCode: "SHOP-FENGJIA",
    });
    const market = await seedMarket(testApp, {
      slug: "fengjia-night-market",
      imageUrls: [
        "https://example.com/fengjia-gallery-1.jpg",
        "https://example.com/fengjia-gallery-2.jpg",
      ],
      openingHours: {
        friday: { open: "17:00", close: "23:30" },
        saturday: { open: "16:00", close: "23:59" },
      },
      mapLayout: {
        title: "逢甲入口地圖",
        description: "主入口到出口的攤位配置",
        imageUrl: "https://example.com/fengjia-map.png",
        width: 1200,
        height: 800,
      },
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    const menuItem = await seed.menuItem(String(restaurant.id), {
      name: "Fengjia Chicken",
      price: 95,
    });
    const productItem = await seed.menuItem(String(restaurant.id), {
      name: "Phone Charm",
      price: 120,
      catalogType: "product",
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: menuItem.id,
      restaurantId: String(restaurant.id),
      dishName: "Fengjia Chicken",
      dishNameNormalized: "fengjiachicken",
      priceCents: 9500,
      catalogType: "menu_item",
      categoryName: "炸物",
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: 24.1765,
      longitude: 120.6467,
      updatedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: productItem.id,
      restaurantId: String(restaurant.id),
      dishName: "Phone Charm",
      dishNameNormalized: "phonecharm",
      priceCents: 12000,
      catalogType: "product",
      categoryName: "配件",
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: 24.1765,
      longitude: 120.6467,
      updatedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(restaurant.id),
      name: "外帶預訂",
      serviceType: "pickup",
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    });

    const listRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets?city=台中市&district=西屯區"),
    );
    expect(listRes.status).toBe(200);
    const listJson = await readData<MarketList>(listRes);
    expect(listJson.total).toBe(1);
    expect(listJson.markets[0]).toMatchObject({
      id: market.id,
      slug: "fengjia-night-market",
      name: "逢甲夜市",
      vendorCount: 1,
      catalogCoverage: {
        searchableProductCount: 2,
        publicServiceCount: 1,
      },
      imageUrls: [
        "https://example.com/fengjia-gallery-1.jpg",
        "https://example.com/fengjia-gallery-2.jpg",
      ],
      mapLayout: {
        title: "逢甲入口地圖",
        description: "主入口到出口的攤位配置",
        imageUrl: "https://example.com/fengjia-map.png",
        width: 1200,
        height: 800,
      },
    });
    expect(listJson.markets[0].openingHours).toMatchObject({
      friday: { open: "17:00", close: "23:30" },
      saturday: { open: "16:00", close: "23:59" },
    });
    expect(listJson.markets[0].publicReadiness).toMatchObject({
      ready: true,
      score: 100,
      completedCount: 8,
      totalCount: 8,
      issues: [],
    });

    const detailRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/fengjia-night-market"),
    );
    expect(detailRes.status).toBe(200);
    const detailJson = await readData<MarketDetail>(detailRes);
    expect(detailJson.market.slug).toBe("fengjia-night-market");
    expect(detailJson.market.mapLayout).toMatchObject({
      title: "逢甲入口地圖",
      imageUrl: "https://example.com/fengjia-map.png",
      width: 1200,
      height: 800,
    });
    expect(detailJson.vendorCount).toBe(1);
    expect(detailJson.catalogCoverage).toMatchObject({
      searchableProductCount: 2,
      publicServiceCount: 1,
    });
    expect(detailJson.explorationSummary).toEqual({
      dishSearchUrl: "/api/v1/discovery/search?marketSlug=fengjia-night-market",
      serviceSearchUrl:
        "/api/v1/discovery/services?marketSlug=fengjia-night-market",
      dishCategories: [
        {
          categoryName: "配件",
          catalogType: "product",
          count: 1,
          searchUrl: `/api/v1/discovery/search?marketSlug=fengjia-night-market&catalogType=product&categoryName=${encodeURIComponent(
            "配件",
          )}`,
        },
        {
          categoryName: "炸物",
          catalogType: "menu_item",
          count: 1,
          searchUrl: `/api/v1/discovery/search?marketSlug=fengjia-night-market&catalogType=menu_item&categoryName=${encodeURIComponent(
            "炸物",
          )}`,
        },
      ],
      menuItemCategories: [
        {
          categoryName: "炸物",
          catalogType: "menu_item",
          count: 1,
          searchUrl: `/api/v1/discovery/search?marketSlug=fengjia-night-market&catalogType=menu_item&categoryName=${encodeURIComponent(
            "炸物",
          )}`,
        },
      ],
      productCategories: [
        {
          categoryName: "配件",
          catalogType: "product",
          count: 1,
          searchUrl: `/api/v1/discovery/search?marketSlug=fengjia-night-market&catalogType=product&categoryName=${encodeURIComponent(
            "配件",
          )}`,
        },
      ],
      serviceTypes: [
        {
          serviceType: "pickup",
          count: 1,
          searchUrl:
            "/api/v1/discovery/services?marketSlug=fengjia-night-market&serviceType=pickup",
        },
      ],
    });
    expect(detailJson.publicReadiness).toMatchObject({
      ready: true,
      score: 100,
      completedCount: 8,
      totalCount: 8,
      issues: [],
    });
  });

  it("finds public markets by searchable catalog and service keywords", async () => {
    const productMarket = await seedMarket(testApp, {
      slug: "catalog-keyword-market",
      name: "第一商圈",
      description: "一般商圈介紹",
      tags: ["商圈"],
    });
    const productVendor = await seed.restaurant({
      name: "Catalog Keyword Vendor",
      city: productMarket.city,
      district: productMarket.district,
      latitude: productMarket.latitude,
      longitude: productMarket.longitude,
      isActive: true,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(productVendor.id),
      marketId: productMarket.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    const productItem = await seed.menuItem(String(productVendor.id), {
      name: "星光手機殼",
      price: 180,
      catalogType: "product",
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: productItem.id,
      restaurantId: String(productVendor.id),
      dishName: "星光手機殼",
      dishNameNormalized: "starlightphonecase",
      priceCents: 18000,
      catalogType: "product",
      categoryName: "配件",
      isAvailable: true,
      tags: ["手機殼"],
      district: productMarket.district,
      primaryMarketId: productMarket.id,
      marketIds: [productMarket.id],
      latitude: productMarket.latitude,
      longitude: productMarket.longitude,
      updatedAt: new Date(),
    });

    const serviceMarket = await seedMarket(testApp, {
      slug: "service-keyword-market",
      name: "第二商圈",
      description: "一般服務聚落",
      tags: ["商圈"],
    });
    const serviceVendor = await seed.restaurant({
      name: "Service Keyword Vendor",
      city: serviceMarket.city,
      district: serviceMarket.district,
      latitude: serviceMarket.latitude,
      longitude: serviceMarket.longitude,
      isActive: true,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(serviceVendor.id),
      marketId: serviceMarket.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(serviceVendor.id),
      name: "代客切水果",
      description: "現場分切並分裝",
      serviceType: "general",
      keywords: "切水果 分裝",
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    });

    const productRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/markets?q=${encodeURIComponent("手機殼")}`,
      ),
    );
    expect(productRes.status).toBe(200);
    const productJson = await readData<MarketList>(productRes);
    expect(productJson.markets.map((market) => market.slug)).toEqual([
      "catalog-keyword-market",
    ]);

    const serviceRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/markets?q=${encodeURIComponent("切水果")}`,
      ),
    );
    expect(serviceRes.status).toBe(200);
    const serviceJson = await readData<MarketList>(serviceRes);
    expect(serviceJson.markets.map((market) => market.slug)).toEqual([
      "service-keyword-market",
    ]);
  });

  it("hides empty or productless markets from public market listings", async () => {
    const readyMarket = await seedMarket(testApp, {
      slug: "ready-public-market",
      name: "Ready Public Market",
    });
    await seedMarket(testApp, {
      slug: "empty-public-market",
      name: "Empty Public Market",
    });
    const productlessMarket = await seedMarket(testApp, {
      slug: "productless-public-market",
      name: "Productless Public Market",
    });
    await seedSearchableMarket(testApp, seed, {
      slug: "incomplete-profile-public-market",
      name: "Incomplete Profile Public Market",
      description: "",
      address: "",
      openingHours: null,
    });
    const readyRestaurant = await seed.restaurant({
      name: "Ready Public Vendor",
      city: "台中市",
      district: "西屯區",
      isActive: true,
    });
    const productlessRestaurant = await seed.restaurant({
      name: "Productless Public Vendor",
      city: "台中市",
      district: "西屯區",
      isActive: true,
    });

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(readyRestaurant.id),
        marketId: readyMarket.id,
        isPrimary: true,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(productlessRestaurant.id),
        marketId: productlessMarket.id,
        isPrimary: true,
        joinedAt: new Date(),
      },
    ]);
    const menuItem = await seed.menuItem(String(readyRestaurant.id), {
      name: "Ready Public Bao",
      price: 95,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: menuItem.id,
      restaurantId: String(readyRestaurant.id),
      dishName: "Ready Public Bao",
      dishNameNormalized: "readypublicbao",
      priceCents: 9500,
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: readyMarket.id,
      marketIds: [readyMarket.id],
      updatedAt: new Date(),
    });

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets?q=Ready+Public&city=台中市&district=西屯區",
      ),
    );

    expect(res.status).toBe(200);
    const json = await readData<MarketList>(res);
    expect(json.total).toBe(1);
    expect(json.markets.map((market) => market.slug)).toEqual([
      "ready-public-market",
    ]);

    const incompleteRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets?q=Incomplete+Profile&city=台中市&district=西屯區",
      ),
    );
    const incompleteJson = await readData<MarketList>(incompleteRes);
    expect(incompleteJson.markets).toEqual([]);
  });

  it("lists service-only markets as public exploration entrypoints", async () => {
    const market = await seedMarket(testApp, {
      slug: "service-only-market",
      name: "Service Only Market",
      city: "台中市",
      district: "西屯區",
    });
    const vendor = await seed.restaurant({
      name: "Service Only Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1765,
      longitude: 120.6467,
      isActive: true,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(vendor.id),
      marketId: market.id,
      stallNumber: "S-01",
      isPrimary: true,
      joinedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(vendor.id),
      name: "代客切水果",
      serviceType: "general",
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    });

    const res = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets?q=Service+Only&city=台中市&district=西屯區",
      ),
    );

    expect(res.status).toBe(200);
    const json = await readData<MarketList>(res);
    expect(json.total).toBe(1);
    expect(json.markets[0]).toMatchObject({
      id: market.id,
      slug: "service-only-market",
      vendorCount: 1,
      catalogCoverage: {
        searchableProductCount: 0,
        publicServiceCount: 1,
      },
      publicReadiness: {
        ready: true,
      },
    });
  });

  it("counts only active public vendors in market list and detail", async () => {
    const market = await seedMarket(testApp, {
      slug: "active-vendor-count-market",
    });
    const activeRestaurant = await seed.restaurant({
      name: "Active Count Vendor",
      city: "台中市",
      district: "西屯區",
      isActive: true,
    });
    const inactiveRestaurant = await seed.restaurant({
      name: "Inactive Count Vendor",
      city: "台中市",
      district: "西屯區",
      isActive: false,
    });
    const deletedRestaurant = await seed.restaurant({
      name: "Deleted Count Vendor",
      city: "台中市",
      district: "西屯區",
      deletedAt: new Date(),
    });
    const leftRestaurant = await seed.restaurant({
      name: "Left Count Vendor",
      city: "台中市",
      district: "西屯區",
      isActive: true,
    });

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(activeRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(inactiveRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(deletedRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(leftRestaurant.id),
        marketId: market.id,
        joinedAt: new Date(Date.now() - 60_000),
        leftAt: new Date(),
      },
    ]);
    const activeMenuItem = await seed.menuItem(String(activeRestaurant.id), {
      name: "Active Count Bao",
      price: 95,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: activeMenuItem.id,
      restaurantId: String(activeRestaurant.id),
      dishName: "Active Count Bao",
      dishNameNormalized: "activecountbao",
      priceCents: 9500,
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: market.id,
      marketIds: [market.id],
      updatedAt: new Date(),
    });

    const listRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets?q=active-vendor-count-market"),
    );
    expect(listRes.status).toBe(200);
    const listJson = await readData<MarketList>(listRes);
    expect(listJson.markets).toHaveLength(1);
    expect(listJson.markets[0]).toMatchObject({
      id: market.id,
      vendorCount: 1,
    });

    const detailRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/active-vendor-count-market"),
    );
    expect(detailRes.status).toBe(200);
    const detailJson = await readData<MarketDetail>(detailRes);
    expect(detailJson.vendorCount).toBe(1);
    expect(detailJson.publicReadiness.issues).not.toContainEqual({
      key: "vendors",
      severity: "required",
    });
  });

  it("lists active market cities and districts for customer filters", async () => {
    await seedSearchableMarket(testApp, seed, {
      slug: "fengjia-area",
      name: "逢甲夜市",
      city: "台中市",
      district: "西屯區",
    });
    await seedSearchableMarket(testApp, seed, {
      slug: "yizhong-area",
      name: "一中商圈",
      city: "台中市",
      district: "北區",
    });
    await seedSearchableMarket(testApp, seed, {
      slug: "ximending-area",
      name: "西門町商圈",
      city: "台北市",
      district: "萬華區",
    });
    await seedMarket(testApp, {
      slug: "inactive-area",
      name: "Inactive Area",
      city: "基隆市",
      district: "仁愛區",
      isActive: false,
    });
    await seedMarket(testApp, {
      slug: "productless-area",
      name: "Productless Area",
      city: "桃園市",
      district: "中壢區",
    });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/areas"),
    );

    expect(res.status).toBe(200);
    const json = await readData<MarketAreas>(res);
    expect(json.areas).toEqual([
      { city: "台中市", districts: ["北區", "西屯區"] },
      { city: "台北市", districts: ["萬華區"] },
    ]);
  });

  it("searches public markets by keyword across name, slug, description, and tags", async () => {
    const fengjia = await seedMarket(testApp, {
      slug: "fengjia-night-market-search",
      name: "逢甲夜市",
      description: "台中大型夜市與小吃聚落",
      tags: ["夜市", "雞排"],
    });
    const fengjiaRestaurant = await seed.restaurant({
      name: "Fengjia Search Vendor",
      city: "台中市",
      district: "西屯區",
      isActive: true,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(fengjiaRestaurant.id),
      marketId: fengjia.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    const fengjiaMenuItem = await seed.menuItem(String(fengjiaRestaurant.id), {
      name: "Fengjia Search Chicken",
      price: 95,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: fengjiaMenuItem.id,
      restaurantId: String(fengjiaRestaurant.id),
      dishName: "Fengjia Search Chicken",
      dishNameNormalized: "fengjiasearchchicken",
      priceCents: 9500,
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: fengjia.id,
      marketIds: [fengjia.id],
      updatedAt: new Date(),
    });
    await seedMarket(testApp, {
      slug: "yizhong-commercial-area-search",
      name: "一中商圈",
      description: "台中學生商圈",
      tags: ["商圈", "飲品"],
    });

    const nameRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets?q=逢甲"),
    );
    expect(nameRes.status).toBe(200);
    const nameJson = await readData<MarketList>(nameRes);
    expect(nameJson.markets).toHaveLength(1);
    expect(nameJson.markets[0]).toMatchObject({
      id: fengjia.id,
      slug: "fengjia-night-market-search",
    });

    const tagRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets?q=雞排"),
    );
    const tagJson = await readData<MarketList>(tagRes);
    expect(tagJson.markets.map((market) => market.id)).toEqual([fengjia.id]);
  });

  it("reports public readiness issues for incomplete market pages", async () => {
    await seedMarket(testApp, {
      slug: "incomplete-market",
      description: "",
      address: "",
      openingHours: null,
      bannerUrl: null,
      logoUrl: null,
      imageUrls: null,
    });

    const detailRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/incomplete-market"),
    );

    expect(detailRes.status).toBe(200);
    const detailJson = await readData<MarketDetail>(detailRes);
    expect(detailJson.publicReadiness).toEqual({
      ready: false,
      score: 0,
      completedCount: 0,
      totalCount: 8,
      issues: [
        { key: "description", severity: "required" },
        { key: "location", severity: "required" },
        { key: "openingHours", severity: "required" },
        { key: "image", severity: "recommended" },
        { key: "map", severity: "recommended" },
        { key: "vendors", severity: "required" },
        { key: "products", severity: "required" },
        { key: "services", severity: "recommended" },
      ],
    });
  });

  it("does not expose vendors for incomplete public markets", async () => {
    const market = await seedMarket(testApp, {
      slug: "incomplete-market-vendors",
      description: "",
      address: "",
      openingHours: null,
    });
    const vendor = await seed.restaurant({
      name: "Incomplete Public Vendor",
      city: market.city,
      district: market.district,
      isActive: true,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(vendor.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });

    const vendorsRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets/incomplete-market-vendors/vendors",
      ),
    );

    expect(vendorsRes.status).toBe(404);
    const vendorsJson = await readEnvelope<MarketVendors>(vendorsRes);
    expect(vendorsJson.error).toMatchObject({
      code: "MARKET_NOT_FOUND",
    });
  });

  it("lets platform admins inspect vendor-level catalog readiness gaps", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Catalog Readiness Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 31,
      username: "catalog-readiness-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const market = await seedMarket(testApp, {
      slug: "catalog-readiness-market",
    });
    const completeVendor = await seed.restaurant({
      name: "Complete Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1765,
      longitude: 120.6467,
    });
    const missingVendor = await seed.restaurant({
      name: "Missing Catalog Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1768,
      longitude: 120.6469,
    });
    const missingStallVendor = await seed.restaurant({
      name: "Missing Stall Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1771,
      longitude: 120.6471,
    });
    const productOnlyVendor = await seed.restaurant({
      name: "Product Only Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1773,
      longitude: 120.6473,
    });
    const serviceOnlyVendor = await seed.restaurant({
      name: "Service Only Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1775,
      longitude: 120.6475,
    });

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(completeVendor.id),
        marketId: market.id,
        stallNumber: "A-01",
        isPrimary: true,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(missingVendor.id),
        marketId: market.id,
        stallNumber: "B-02",
        isPrimary: false,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(missingStallVendor.id),
        marketId: market.id,
        stallNumber: null,
        isPrimary: false,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(productOnlyVendor.id),
        marketId: market.id,
        stallNumber: "C-03",
        isPrimary: false,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(serviceOnlyVendor.id),
        marketId: market.id,
        stallNumber: "D-04",
        isPrimary: false,
        joinedAt: new Date(),
      },
    ]);
    const completeItem = await seed.menuItem(String(completeVendor.id), {
      name: "Ready Bao",
      price: 70,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: completeItem.id,
      restaurantId: String(completeVendor.id),
      dishName: "Ready Bao",
      dishNameNormalized: "readybao",
      priceCents: 7000,
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: 24.1765,
      longitude: 120.6467,
      updatedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(completeVendor.id),
      name: "現場預約",
      serviceType: "booking",
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    });
    const missingStallItem = await seed.menuItem(
      String(missingStallVendor.id),
      {
        name: "No Stall Tea",
        price: 45,
      },
    );
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: missingStallItem.id,
      restaurantId: String(missingStallVendor.id),
      dishName: "No Stall Tea",
      dishNameNormalized: "nostalltea",
      priceCents: 4500,
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: 24.1771,
      longitude: 120.6471,
      updatedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(missingStallVendor.id),
      name: "免攤位服務",
      serviceType: "booking",
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    });
    const productOnlyItem = await seed.menuItem(String(productOnlyVendor.id), {
      name: "Product Only Snack",
      price: 60,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: productOnlyItem.id,
      restaurantId: String(productOnlyVendor.id),
      dishName: "Product Only Snack",
      dishNameNormalized: "productonlysnack",
      priceCents: 6000,
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: 24.1773,
      longitude: 120.6473,
      updatedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(serviceOnlyVendor.id),
      name: "純服務入口",
      serviceType: "booking",
      requiresBooking: true,
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/admin/markets/readiness", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await readData<AdminReadiness>(res);
    const readinessMarket = json.markets.find((item) => item.id === market.id);
    if (!readinessMarket) {
      throw new Error(`market ${market.id} missing from the readiness list`);
    }
    expect(readinessMarket.catalogCoverage).toMatchObject({
      searchableProductCount: 3,
      publicServiceCount: 3,
      vendorsWithSearchableProducts: 3,
      vendorsMissingSearchableProducts: 2,
      vendorsWithPublicServices: 3,
      vendorsMissingPublicServices: 2,
      bookingRequiredServiceCount: 1,
      bookingUrlMissingServiceCount: 1,
      vendorsMissingBookingUrls: 1,
      vendorsMissingStallNumbers: 1,
      vendorsMissingSearchEntrypoints: 1,
    });
    expect(readinessMarket.catalogCoverage.missingProductVendors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          restaurantId: String(missingVendor.id),
          name: "Missing Catalog Vendor",
          stallNumber: "B-02",
        }),
        expect.objectContaining({
          restaurantId: String(serviceOnlyVendor.id),
          name: "Service Only Vendor",
          stallNumber: "D-04",
        }),
      ]),
    );
    expect(readinessMarket.catalogCoverage.missingServiceVendors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          restaurantId: String(missingVendor.id),
          name: "Missing Catalog Vendor",
          stallNumber: "B-02",
        }),
        expect.objectContaining({
          restaurantId: String(productOnlyVendor.id),
          name: "Product Only Vendor",
          stallNumber: "C-03",
        }),
      ]),
    );
    expect(readinessMarket.catalogCoverage.missingStallNumberVendors).toEqual([
      expect.objectContaining({
        restaurantId: String(missingStallVendor.id),
        name: "Missing Stall Vendor",
        stallNumber: null,
      }),
    ]);
    expect(
      readinessMarket.catalogCoverage.missingSearchEntrypointVendors,
    ).toEqual([
      expect.objectContaining({
        restaurantId: String(missingVendor.id),
        name: "Missing Catalog Vendor",
        stallNumber: "B-02",
      }),
    ]);
    expect(readinessMarket.catalogCoverage.missingBookingUrlVendors).toEqual([
      expect.objectContaining({
        restaurantId: String(serviceOnlyVendor.id),
        name: "Service Only Vendor",
        stallNumber: "D-04",
      }),
    ]);
  });

  it("returns the full admin catalog gap vendor list", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Full Catalog Gap Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 32,
      username: "full-catalog-gap-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const market = await seedMarket(testApp, {
      slug: "full-catalog-gap-market",
    });
    const missingVendors = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        seed.restaurant({
          name: `Missing Catalog Vendor ${index + 1}`,
          city: "台中市",
          district: "西屯區",
          latitude: 24.176 + index / 10000,
          longitude: 120.646 + index / 10000,
        }),
      ),
    );

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values(
      missingVendors.map((vendor, index) => ({
        restaurantId: String(vendor.id),
        marketId: market.id,
        stallNumber: `G-${String(index + 1).padStart(2, "0")}`,
        isPrimary: index === 0,
        joinedAt: new Date(),
      })),
    );

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/admin/markets/readiness", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await readData<AdminReadiness>(res);
    const readinessMarket = json.markets.find((item) => item.id === market.id);
    if (!readinessMarket) {
      throw new Error(`market ${market.id} missing from the readiness list`);
    }
    expect(readinessMarket.catalogCoverage.missingProductVendors).toHaveLength(
      6,
    );
    expect(readinessMarket.catalogCoverage.missingServiceVendors).toHaveLength(
      6,
    );
    expect(
      readinessMarket.catalogCoverage.missingSearchEntrypointVendors,
    ).toHaveLength(6);
  });

  it("summarizes market catalog readiness gaps by area for platform admins", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Area Readiness Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 33,
      username: "area-readiness-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const westMarket = await seedMarket(testApp, {
      slug: "west-area-market",
      city: "台中市",
      district: "西屯區",
    });
    await seedMarket(testApp, {
      slug: "west-empty-area-market",
      city: "台中市",
      district: "西屯區",
    });
    const northMarket = await seedMarket(testApp, {
      slug: "north-area-market",
      city: "台中市",
      district: "北區",
    });
    const westVendors = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        seed.restaurant({
          name: `West Missing Vendor ${index + 1}`,
          city: "台中市",
          district: "西屯區",
          latitude: 24.176 + index / 10000,
          longitude: 120.646 + index / 10000,
        }),
      ),
    );
    const northVendor = await seed.restaurant({
      name: "North Ready Vendor",
      city: "台中市",
      district: "北區",
      latitude: 24.15,
      longitude: 120.68,
    });

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      ...westVendors.map((vendor, index) => ({
        restaurantId: String(vendor.id),
        marketId: westMarket.id,
        stallNumber: `W-${index + 1}`,
        isPrimary: index === 0,
        joinedAt: new Date(),
      })),
      {
        restaurantId: String(northVendor.id),
        marketId: northMarket.id,
        stallNumber: "N-1",
        isPrimary: true,
        joinedAt: new Date(),
      },
    ]);
    const northItem = await seed.menuItem(String(northVendor.id), {
      name: "Ready Tea",
      price: 50,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: northItem.id,
      restaurantId: String(northVendor.id),
      dishName: "Ready Tea",
      dishNameNormalized: "readytea",
      priceCents: 5000,
      isAvailable: true,
      tags: [],
      district: "北區",
      primaryMarketId: northMarket.id,
      marketIds: [northMarket.id],
      latitude: 24.15,
      longitude: 120.68,
      updatedAt: new Date(),
    });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/admin/markets/area-readiness", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await readData<AdminAreaReadiness>(res);
    expect(json.areas[0]).toMatchObject({
      city: "台中市",
      district: "西屯區",
      marketCount: 2,
      vendorCount: 2,
      vendorsMissingSearchableProducts: 2,
      vendorsMissingPublicServices: 2,
      totalCatalogGapVendors: 4,
      marketsWithoutVendors: 1,
      marketsWithoutSearchableCatalog: 2,
    });
    expect(json.areas[1]).toMatchObject({
      city: "台中市",
      district: "北區",
      marketCount: 1,
      vendorCount: 1,
      vendorsMissingSearchableProducts: 0,
      vendorsMissingPublicServices: 1,
      totalCatalogGapVendors: 1,
      marketsWithoutVendors: 0,
      marketsWithoutSearchableCatalog: 0,
    });
  });

  it("exposes market pages through sitemap.xml and robots.txt", async () => {
    const { market: activeMarket } = await seedSearchableMarket(testApp, seed, {
      slug: "seo-night-market",
      name: "SEO Night Market",
      updatedAt: new Date("2026-05-20T12:00:00.000Z"),
    });
    await seedServiceOnlyMarket(testApp, seed, {
      slug: "seo-service-market",
      name: "SEO Service Market",
      updatedAt: new Date("2026-05-19T12:00:00.000Z"),
    });
    await seedMarket(testApp, {
      slug: "inactive-night-market",
      name: "Inactive Night Market",
      isActive: false,
      updatedAt: new Date("2026-05-21T12:00:00.000Z"),
    });
    await seedMarket(testApp, {
      slug: "productless-night-market",
      name: "Productless Night Market",
      updatedAt: new Date("2026-05-22T12:00:00.000Z"),
    });

    const sitemapRes = await testApp.app.fetch(
      new Request("https://makanmasak.com/sitemap.xml"),
    );
    expect(sitemapRes.status).toBe(200);
    expect(sitemapRes.headers.get("content-type")).toContain("application/xml");
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain(
      "<loc>https://makanmasak.com/markets/seo-night-market</loc>",
    );
    expect(sitemapXml).toContain(
      "<loc>https://makanmasak.com/markets/seo-service-market</loc>",
    );
    expect(sitemapXml).toContain("<lastmod>2026-05-20</lastmod>");
    expect(sitemapXml).toContain("<lastmod>2026-05-19</lastmod>");
    expect(sitemapXml).not.toContain("inactive-night-market");
    expect(sitemapXml).not.toContain("productless-night-market");
    expect(sitemapXml).not.toContain(activeMarket.id);

    const robotsRes = await testApp.app.fetch(
      new Request("https://makanmasak.com/robots.txt"),
    );
    expect(robotsRes.status).toBe(200);
    const robotsText = await robotsRes.text();
    expect(robotsText).toContain("User-agent: *");
    expect(robotsText).toContain("Disallow: /api/");
    expect(robotsText).toContain("Disallow: /admin/");
    expect(robotsText).toContain("Sitemap: https://makanmasak.com/sitemap.xml");
  });

  it("caches public market reads and invalidates them after admin changes", async () => {
    const restaurant = await seed.restaurant({
      name: "Cached Market Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 10,
      username: "market-cache-admin",
      role: 0,
      restaurantId: String(restaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    const market = await seedMarket(testApp, {
      slug: "cached-night-market",
    });

    const detailRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/cached-night-market"),
    );
    expect(detailRes.status).toBe(200);

    const cacheKey = "markets:v1:detail:cached-night-market";
    const cachedDetail = await testApp.testDb.bindings.CACHE_KV.get(
      cacheKey,
      "json",
    );
    expect(cachedDetail).toMatchObject({
      market: { id: market.id, slug: "cached-night-market" },
      vendorCount: 0,
    });

    const updateRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/admin/markets/${market.id}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
          ...CSRF_HEADERS,
        },
        body: JSON.stringify({ name: "Cached Market Updated" }),
      }),
    );
    expect(updateRes.status).toBe(200);
    await expect(
      testApp.testDb.bindings.CACHE_KV.get("markets:version"),
    ).resolves.toBe("2");
  });

  it("lists vendors in a market and finds nearby markets by distance", async () => {
    const nearMarket = await seedMarket(testApp, {
      slug: "near-market",
      latitude: 24.1764,
      longitude: 120.6466,
    });
    await seedMarket(testApp, {
      slug: "far-market",
      name: "高雄夜市",
      city: "高雄市",
      district: "鹽埕區",
      latitude: 22.626,
      longitude: 120.281,
    });
    const vendor = await seed.restaurant({
      name: "Bubble Tea Stand",
      city: "台中市",
      district: "西屯區",
      businessHours: openAllWeek(),
      latitude: 24.1765,
      longitude: 120.6467,
      supportsTakeaway: true,
      supportsDelivery: false,
      enableShopMode: true,
      shopQrCode: "SHOP-BUBBLE",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(vendor.id),
      marketId: nearMarket.id,
      stallNumber: "A-12",
      locationLabel: "逢甲路入口第一排",
      isPrimary: true,
      joinedAt: new Date(),
    });
    const serviceVendor = await seed.restaurant({
      name: "Key Cutting Booth",
      type: "market_stall",
      category: "services",
      city: "台中市",
      district: "北區",
      businessHours: openAllWeek(),
      latitude: 24.17655,
      longitude: 120.64675,
      supportsTakeaway: false,
      supportsDelivery: false,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(serviceVendor.id),
      marketId: nearMarket.id,
      stallNumber: "R-88",
      isPrimary: false,
      joinedAt: new Date(),
    });
    const menuItem = await seed.menuItem(String(vendor.id), {
      name: "Bubble Tea",
      price: 65,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: menuItem.id,
      restaurantId: String(vendor.id),
      dishName: "Bubble Tea",
      dishNameNormalized: "bubbletea",
      priceCents: 6500,
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: nearMarket.id,
      marketIds: [nearMarket.id],
      latitude: 24.1765,
      longitude: 120.6467,
      updatedAt: new Date(),
    });
    await testApp.testDb.drizzle.insert(restaurantServiceItems).values({
      restaurantId: String(vendor.id),
      name: "外帶自取",
      serviceType: "pickup",
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    });
    const productlessNearMarket = await seedMarket(testApp, {
      slug: "productless-near-market",
      latitude: 24.17645,
      longitude: 120.64665,
    });
    const productlessVendor = await seed.restaurant({
      name: "Productless Nearby Stand",
      city: "台中市",
      district: "西屯區",
      latitude: 24.17646,
      longitude: 120.64666,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(productlessVendor.id),
      marketId: productlessNearMarket.id,
      joinedAt: new Date(),
    });

    const vendorsRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets/near-market/vendors?takeaway=true",
      ),
    );
    expect(vendorsRes.status).toBe(200);
    const vendorsJson = await readData<MarketVendors>(vendorsRes);
    expect(vendorsJson.total).toBe(1);
    expect(vendorsJson.vendors[0]).toMatchObject({
      restaurantId: String(vendor.id),
      name: "Bubble Tea Stand",
      stallNumber: "A-12",
      locationLabel: "逢甲路入口第一排",
      supportsTakeaway: true,
      detailUrl: `/api/v1/restaurants/${vendor.id}`,
      menuUrl: `/api/v1/menu/${vendor.id}`,
      serviceItemsUrl: `/api/v1/restaurants/${vendor.id}/service-items`,
      availableMenuItemCount: 1,
      publicServiceItemCount: 1,
    });

    for (const query of ["R-88", "services", "北區"]) {
      const searchRes = await testApp.app.fetch(
        new Request(
          `https://test/api/v1/markets/near-market/vendors?q=${encodeURIComponent(query)}`,
        ),
      );
      expect(searchRes.status).toBe(200);
      const searchJson = await readData<MarketVendors>(searchRes);
      expect(searchJson.total).toBe(1);
      expect(searchJson.vendors[0]).toMatchObject({
        restaurantId: String(serviceVendor.id),
        name: "Key Cutting Booth",
        stallNumber: "R-88",
        category: "services",
        district: "北區",
      });
    }

    const nearbyRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets/nearby?lat=24.1763&lng=120.6465&radiusKm=1",
      ),
    );
    expect(nearbyRes.status).toBe(200);
    const nearbyJson = await readData<NearbyMarkets>(nearbyRes);
    expect(nearbyJson.markets).toHaveLength(1);
    expect(nearbyJson.markets[0]).toMatchObject({
      slug: "near-market",
      vendorCount: 2,
      catalogCoverage: {
        searchableProductCount: 1,
        publicServiceCount: 1,
      },
      publicReadiness: {
        ready: true,
      },
    });
    expect(nearbyJson.markets[0].distanceKm).toBeLessThan(0.1);
  });

  it("finds nearby markets when the user is inside a market boundary", async () => {
    const boundaryGeojson = {
      type: "Polygon" as const,
      coordinates: [
        [
          [120.646, 24.176],
          [120.647, 24.176],
          [120.647, 24.177],
          [120.646, 24.177],
          [120.646, 24.176],
        ],
      ],
    };
    const { market } = await seedSearchableMarket(testApp, seed, {
      slug: "boundary-night-market",
      latitude: 24.25,
      longitude: 120.75,
      boundaryGeojson,
    });

    const detailRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/boundary-night-market"),
    );
    expect(detailRes.status).toBe(200);
    const detailJson = await readData<MarketDetail>(detailRes);
    expect(detailJson.market).toMatchObject({
      id: market.id,
      boundaryGeojson,
    });

    const nearbyRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets/nearby?lat=24.1765&lng=120.6465&radiusKm=0.2",
      ),
    );
    expect(nearbyRes.status).toBe(200);
    const nearbyJson = await readData<NearbyMarkets>(nearbyRes);
    expect(nearbyJson.markets).toHaveLength(1);
    expect(nearbyJson.markets[0]).toMatchObject({
      slug: "boundary-night-market",
      boundaryGeojson,
      distanceKm: 0,
    });
  });

  it("filters open market vendors before pagination", async () => {
    const market = await seedMarket(testApp, {
      slug: "open-vendor-pagination-market",
    });
    const closedVendor = await seed.restaurant({
      name: "Closed Popular Stand",
      businessHours: closedAllWeek(),
      totalOrders: 50,
    });
    const openVendor = await seed.restaurant({
      name: "Open Smaller Stand",
      businessHours: openAllWeek(),
      totalOrders: 10,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(closedVendor.id),
        marketId: market.id,
        stallNumber: "A-01",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(openVendor.id),
        marketId: market.id,
        stallNumber: "A-02",
        joinedAt: new Date(),
      },
    ]);
    const openVendorItem = await seed.menuItem(String(openVendor.id), {
      name: "Open Vendor Searchable Item",
      price: 80,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: openVendorItem.id,
      restaurantId: String(openVendor.id),
      dishName: "Open Vendor Searchable Item",
      dishNameNormalized: "openvendorsearchableitem",
      priceCents: 8000,
      isAvailable: true,
      tags: [],
      district: market.district,
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: market.latitude,
      longitude: market.longitude,
      updatedAt: new Date(),
    });

    const vendorsRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets/open-vendor-pagination-market/vendors?openNow=true&limit=1&sortBy=popular",
      ),
    );

    expect(vendorsRes.status).toBe(200);
    const vendorsJson = await readData<MarketVendors>(vendorsRes);
    expect(vendorsJson.total).toBe(1);
    expect(vendorsJson.vendors).toHaveLength(1);
    expect(vendorsJson.vendors[0]).toMatchObject({
      restaurantId: String(openVendor.id),
      name: "Open Smaller Stand",
      stallNumber: "A-02",
      isOpen: true,
    });
  });

  it("uses market-specific vendor hours before restaurant business hours", async () => {
    const market = await seedMarket(testApp, {
      slug: "market-hours-override-market",
    });
    const vendor = await seed.restaurant({
      name: "Market Hours Override Stand",
      businessHours: closedAllWeek(),
      supportsTakeaway: true,
    });
    const marketHours = openAllWeek();
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(vendor.id),
      marketId: market.id,
      stallNumber: "H-01",
      mapPosition: { x: 33, y: 44 },
      marketHours,
      joinedAt: new Date(),
    });
    const item = await seed.menuItem(String(vendor.id), {
      name: "Override Hours Searchable Item",
      price: 80,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: item.id,
      restaurantId: String(vendor.id),
      dishName: "Override Hours Searchable Item",
      dishNameNormalized: "overridehourssearchableitem",
      priceCents: 8000,
      isAvailable: true,
      tags: [],
      district: market.district,
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: market.latitude,
      longitude: market.longitude,
      updatedAt: new Date(),
    });

    const vendorsRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets/market-hours-override-market/vendors?openNow=true",
      ),
    );

    expect(vendorsRes.status).toBe(200);
    const vendorsJson = await readData<MarketVendors>(vendorsRes);
    expect(vendorsJson.total).toBe(1);
    expect(vendorsJson.vendors[0]).toMatchObject({
      restaurantId: String(vendor.id),
      name: "Market Hours Override Stand",
      stallNumber: "H-01",
      mapPosition: { x: 33, y: 44 },
      marketHours,
      effectiveBusinessHours: marketHours,
      isOpen: true,
    });
  });

  it("sorts market vendors by distance and returns distance metadata", async () => {
    const market = await seedMarket(testApp, {
      slug: "distance-vendor-market",
    });
    const nearVendor = await seed.restaurant({
      name: "Near Vendor Stand",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1765,
      longitude: 120.6467,
      totalOrders: 1,
    });
    const farVendor = await seed.restaurant({
      name: "Far Vendor Stand",
      city: "台中市",
      district: "西屯區",
      latitude: 24.19,
      longitude: 120.66,
      totalOrders: 100,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(nearVendor.id),
        marketId: market.id,
        stallNumber: "N-01",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(farVendor.id),
        marketId: market.id,
        stallNumber: "F-01",
        joinedAt: new Date(),
      },
    ]);
    const nearVendorItem = await seed.menuItem(String(nearVendor.id), {
      name: "Near Vendor Searchable Item",
      price: 80,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: nearVendorItem.id,
      restaurantId: String(nearVendor.id),
      dishName: "Near Vendor Searchable Item",
      dishNameNormalized: "nearvendorsearchableitem",
      priceCents: 8000,
      isAvailable: true,
      tags: [],
      district: market.district,
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: market.latitude,
      longitude: market.longitude,
      updatedAt: new Date(),
    });

    const vendorsRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/markets/distance-vendor-market/vendors?lat=24.1764&lng=120.6466&radiusKm=5&sortBy=distance",
      ),
    );

    expect(vendorsRes.status).toBe(200);
    const vendorsJson = await readData<MarketVendors>(vendorsRes);
    expect(vendorsJson.total).toBe(2);
    expect(vendorsJson.vendors.map((vendor) => vendor.name)).toEqual([
      "Near Vendor Stand",
      "Far Vendor Stand",
    ]);
    expect(typeof vendorsJson.vendors[1].distanceKm).toBe("number");
    expect(vendorsJson.vendors[0].distanceKm).toBeLessThan(
      Number(vendorsJson.vendors[1].distanceKm),
    );
  });

  it("scopes dish search by market and GPS filters", async () => {
    const market = await seedMarket(testApp, { slug: "yizhong" });
    const inside = await seed.restaurant({
      name: "Inside Vendor",
      city: "台中市",
      district: "北區",
      latitude: 24.1491,
      longitude: 120.6842,
      businessHours: openAllWeek(),
    });
    const outside = await seed.restaurant({
      name: "Outside Vendor",
      city: "台中市",
      district: "西屯區",
      latitude: 24.18,
      longitude: 120.65,
      businessHours: openAllWeek(),
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(inside.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    const insideItem = await seed.menuItem(String(inside.id), {
      name: "Market Bao",
      price: 60,
    });
    const outsideItem = await seed.menuItem(String(outside.id), {
      name: "Market Bao",
      price: 70,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values([
      {
        menuItemId: insideItem.id,
        restaurantId: String(inside.id),
        dishName: "Market Bao",
        dishNameNormalized: "marketbao",
        priceCents: 6000,
        isAvailable: true,
        tags: [],
        district: "北區",
        primaryMarketId: market.id,
        marketIds: [market.id],
        latitude: 24.1491,
        longitude: 120.6842,
        updatedAt: new Date(),
      },
      {
        menuItemId: outsideItem.id,
        restaurantId: String(outside.id),
        dishName: "Market Bao",
        dishNameNormalized: "marketbao",
        priceCents: 7000,
        isAvailable: true,
        tags: [],
        district: "西屯區",
        marketIds: [],
        latitude: 24.18,
        longitude: 120.65,
        updatedAt: new Date(),
      },
    ]);

    const marketRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Market+Bao&marketSlug=yizhong",
      ),
    );
    expect(marketRes.status).toBe(200);
    const marketJson = await readData<DishSearch>(marketRes);
    expect(marketJson.results).toHaveLength(1);
    expect(marketJson.results[0].restaurantName).toBe("Inside Vendor");

    const nearbyRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/discovery/search?q=Market+Bao&lat=24.1491&lng=120.6842&radiusKm=0.5",
      ),
    );
    expect(nearbyRes.status).toBe(200);
    const nearbyJson = await readData<DishSearch>(nearbyRes);
    expect(nearbyJson.results).toHaveLength(1);
    expect(nearbyJson.results[0].restaurantName).toBe("Inside Vendor");
  });

  it("lets an owner activate and deactivate takeaway through the shop-mode API", async () => {
    const restaurant = await seed.restaurant({
      supportsTakeaway: false,
      enableShopMode: false,
      shopQrCode: null,
      businessHours: openAllWeek(),
    });
    await testApp.testDb.drizzle.insert(shopSubscriptions).values({
      restaurantId: String(restaurant.id),
      planTier: "basic",
    });
    await seed.user({
      id: 20,
      username: "self-service-owner",
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const token = await testApp.authHelper.ownerToken(
      20,
      String(restaurant.id),
    );
    const headers = {
      ...CSRF_HEADERS,
      authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const eligibility = async () =>
      readData<TakeawayEligibility>(
        await testApp.app.fetch(
          new Request(
            `https://test/api/v1/discovery/restaurants/${restaurant.id}/takeaway-eligibility`,
          ),
        ),
      );
    expect(await eligibility()).toEqual({
      eligible: false,
      reason: "takeaway_disabled",
    });
    const settingsResponse = await testApp.app.fetch(
      new Request(`https://test/api/v1/restaurants/${restaurant.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          supportsTakeaway: true,
          settings: { enableTakeaway: true },
        }),
      }),
    );
    expect(settingsResponse.status).toBe(200);
    const setMode = (id: string, enabled: boolean) =>
      testApp.app.fetch(
        new Request(`https://test/api/v1/restaurants/${id}/shop-mode`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ enabled }),
        }),
      );
    expect((await setMode(String(restaurant.id), true)).status).toBe(200);
    expect(await eligibility()).toEqual({
      eligible: true,
      shopQrCode: expect.stringMatching(/^SHOP-/),
    });
    const other = await seed.restaurant();
    expect((await setMode(String(other.id), true)).status).toBe(403);
    expect((await setMode(String(restaurant.id), false)).status).toBe(200);
    expect(await eligibility()).toEqual({
      eligible: false,
      reason: "takeaway_disabled",
    });
  });

  it("returns shop QR code from takeaway eligibility only when eligible", async () => {
    const eligible = await seed.restaurant({
      supportsTakeaway: true,
      enableShopMode: true,
      shopQrCode: "SHOP-ELIGIBLE",
      businessHours: openAllWeek(),
    });
    const disabled = await seed.restaurant({
      supportsTakeaway: false,
      enableShopMode: false,
      shopQrCode: null,
      businessHours: openAllWeek(),
    });

    const eligibleRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants/${eligible.id}/takeaway-eligibility`,
      ),
    );
    expect(eligibleRes.status).toBe(200);
    const eligibleJson = await readData<TakeawayEligibility>(eligibleRes);
    expect(eligibleJson).toEqual({
      eligible: true,
      shopQrCode: "SHOP-ELIGIBLE",
    });

    const disabledRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants/${disabled.id}/takeaway-eligibility`,
      ),
    );
    expect(disabledRes.status).toBe(200);
    const disabledJson = await readData<TakeawayEligibility>(disabledRes);
    expect(disabledJson).toEqual({
      eligible: false,
      reason: "takeaway_disabled",
    });
  });

  it("exposes public restaurant market memberships for shop context", async () => {
    const activeMarket = await seedMarket(testApp, {
      slug: "public-shop-context-market",
      name: "Public Shop Context Market",
      type: "commercial_district",
      city: "台中市",
      district: "北區",
    });
    const inactiveMarket = await seedMarket(testApp, {
      slug: "hidden-shop-context-market",
      name: "Hidden Shop Context Market",
      isActive: false,
    });
    const restaurant = await seed.restaurant({
      name: "Shop Context Vendor",
      city: activeMarket.city,
      district: activeMarket.district,
      isActive: true,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(restaurant.id),
        marketId: activeMarket.id,
        stallNumber: "A-18",
        locationLabel: null,
        isPrimary: true,
        joinedAt: new Date(),
      },
      {
        restaurantId: String(restaurant.id),
        marketId: inactiveMarket.id,
        stallNumber: "H-01",
        isPrimary: false,
        joinedAt: new Date(),
      },
    ]);

    const res = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/restaurants/${restaurant.id}/markets`,
      ),
    );

    expect(res.status).toBe(200);
    const json = await readData<RestaurantMarkets>(res);
    expect(json.memberships).toEqual([
      {
        marketId: activeMarket.id,
        stallNumber: "A-18",
        locationLabel: null,
        isPrimary: true,
        market: {
          id: activeMarket.id,
          slug: "public-shop-context-market",
          name: "Public Shop Context Market",
          type: "commercial_district",
          city: "台中市",
          district: "北區",
        },
        marketUrl: "/markets/public-shop-context-market",
      },
    ]);
  });

  it("syncs discovery index when marketplace-critical restaurant data changes", async () => {
    const restaurant = await seed.restaurant({
      name: "Sync Vendor",
      latitude: 24.1491,
      longitude: 120.6842,
      supportsTakeaway: true,
      supportsDelivery: false,
    });
    await seed.user({
      id: 20,
      username: "sync-owner",
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const ownerToken = await testApp.authHelper.ownerToken(
      20,
      String(restaurant.id),
    );
    const item = await seed.menuItem(String(restaurant.id), {
      name: "Sync Bao",
      price: 60,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: item.id,
      restaurantId: String(restaurant.id),
      dishName: "Sync Bao",
      dishNameNormalized: "syncbao",
      priceCents: 6000,
      isAvailable: true,
      tags: [],
      district: "北區",
      supportsTakeaway: true,
      supportsDelivery: false,
      latitude: 24.1491,
      longitude: 120.6842,
      updatedAt: new Date(),
    });
    const initialMarketCacheVersion = Number(
      (await testApp.testDb.bindings.CACHE_KV.get("markets:version")) ?? 0,
    );

    const updateRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/restaurants/${restaurant.id}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
          ...CSRF_HEADERS,
        },
        body: JSON.stringify({
          latitude: 24.15,
          longitude: 120.69,
          supportsTakeaway: false,
          supportsDelivery: true,
        }),
      }),
    );
    expect(updateRes.status).toBe(200);

    const [indexed] = await testApp.testDb.drizzle
      .select({
        supportsTakeaway: dishSearchIndex.supportsTakeaway,
        supportsDelivery: dishSearchIndex.supportsDelivery,
        latitude: dishSearchIndex.latitude,
        longitude: dishSearchIndex.longitude,
      })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, item.id))
      .limit(1);

    expect(indexed).toMatchObject({
      supportsTakeaway: false,
      supportsDelivery: true,
      latitude: 24.15,
      longitude: 120.69,
    });
    const nextMarketCacheVersion = Number(
      await testApp.testDb.bindings.CACHE_KV.get("markets:version"),
    );
    expect(nextMarketCacheVersion).toBeGreaterThan(initialMarketCacheVersion);
  });

  it("syncs discovery index when market public availability changes", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Market Sync Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 21,
      username: "market-sync-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const market = await seedMarket(testApp, {
      slug: "sync-market",
    });
    const restaurant = await seed.restaurant({
      name: "Indexed Market Vendor",
      latitude: 24.1491,
      longitude: 120.6842,
      supportsTakeaway: true,
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      isPrimary: true,
      joinedAt: new Date(),
    });
    const item = await seed.menuItem(String(restaurant.id), {
      name: "Indexed Market Bao",
      price: 60,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: item.id,
      restaurantId: String(restaurant.id),
      dishName: "Indexed Market Bao",
      dishNameNormalized: "indexedmarketbao",
      priceCents: 6000,
      isAvailable: true,
      tags: [],
      district: "西屯區",
      supportsTakeaway: true,
      primaryMarketId: market.id,
      marketIds: [market.id],
      latitude: 24.1491,
      longitude: 120.6842,
      updatedAt: new Date(),
    });

    const updateRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/admin/markets/${market.id}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
          ...CSRF_HEADERS,
        },
        body: JSON.stringify({ isActive: false }),
      }),
    );
    expect(updateRes.status).toBe(200);

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
      marketIds: [],
    });
  });

  it("allows re-joining a market after soft leave but rejects duplicate active membership", async () => {
    const restaurant = await seed.restaurant();
    const market = await seedMarket(testApp);

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      joinedAt: new Date(Date.now() - 1000),
      leftAt: new Date(),
    });
    await expect(
      testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
        restaurantId: String(restaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      }),
    ).resolves.toBeDefined();
    await expect(
      testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
        restaurantId: String(restaurant.id),
        marketId: market.id,
        joinedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("lets platform admins create, update, soft delete markets, and manage vendors", async () => {
    const restaurant = await seed.restaurant({
      name: "Admin Market Vendor",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 1,
      username: "market-admin",
      role: 0,
      restaurantId: String(restaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };
    const boundaryGeojson = {
      type: "Polygon" as const,
      coordinates: [
        [
          [120.682, 24.14],
          [120.684, 24.14],
          [120.684, 24.142],
          [120.682, 24.142],
          [120.682, 24.14],
        ],
      ],
    };

    const createRes = await testApp.app.fetch(
      new Request("https://test/api/v1/admin/markets", {
        method: "POST",
        headers,
        body: JSON.stringify({
          slug: "admin-created-market",
          name: "管理新增夜市",
          type: "night_market",
          description: "Created by admin API",
          city: "台中市",
          district: "中區",
          address: "台中市中區測試路",
          latitude: 24.141,
          longitude: 120.683,
          boundaryGeojson,
          openingHours: {
            friday: { open: "17:00", close: "23:30" },
            saturday: { open: "16:00", close: "23:59" },
          },
          mapLayout: {
            title: "管理市場地圖",
            description: "A 區到 B 區的攤位配置",
            imageUrl: "https://example.com/admin-market-map.png",
            width: 1600,
            height: 900,
          },
          bannerUrl: "https://example.com/admin-market-banner.jpg",
          logoUrl: "https://example.com/admin-market-logo.jpg",
          imageUrls: [
            "https://example.com/admin-market-gallery-1.jpg",
            "https://example.com/admin-market-gallery-2.jpg",
          ],
          tags: ["夜市", "親子"],
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createdJson = await readData<MarketEnvelope>(createRes);
    expect(createdJson.market).toMatchObject({
      slug: "admin-created-market",
      name: "管理新增夜市",
      isActive: true,
      bannerUrl: "https://example.com/admin-market-banner.jpg",
      logoUrl: "https://example.com/admin-market-logo.jpg",
      boundaryGeojson,
      mapLayout: {
        title: "管理市場地圖",
        description: "A 區到 B 區的攤位配置",
        imageUrl: "https://example.com/admin-market-map.png",
        width: 1600,
        height: 900,
      },
      imageUrls: [
        "https://example.com/admin-market-gallery-1.jpg",
        "https://example.com/admin-market-gallery-2.jpg",
      ],
      tags: ["夜市", "親子"],
    });
    expect(createdJson.market.openingHours).toMatchObject({
      friday: { open: "17:00", close: "23:30" },
      saturday: { open: "16:00", close: "23:59" },
    });

    const marketId = createdJson.market.id as string;
    const updateRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/admin/markets/${marketId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: "更新後夜市",
          district: "西區",
          boundaryGeojson: null,
          mapLayout: {
            title: "更新後市場地圖",
            imageUrl: "https://example.com/admin-market-map-updated.png",
            width: 1200,
            height: 800,
          },
          imageUrls: ["https://example.com/admin-market-gallery-3.jpg"],
          tags: ["美食", "宵夜"],
        }),
      }),
    );
    expect(updateRes.status).toBe(200);
    const updatedJson = await readData<MarketEnvelope>(updateRes);
    expect(updatedJson.market).toMatchObject({
      id: marketId,
      name: "更新後夜市",
      district: "西區",
      boundaryGeojson: null,
      mapLayout: {
        title: "更新後市場地圖",
        imageUrl: "https://example.com/admin-market-map-updated.png",
        width: 1200,
        height: 800,
      },
      imageUrls: ["https://example.com/admin-market-gallery-3.jpg"],
      tags: ["美食", "宵夜"],
    });

    const addVendorRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/admin/markets/${marketId}/vendors`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          restaurantId: String(restaurant.id),
          stallNumber: "A-01",
          locationLabel: "文華路入口旁",
          isPrimary: true,
        }),
      }),
    );
    expect(addVendorRes.status).toBe(201);
    const vendorJson = await readData<MembershipEnvelope>(addVendorRes);
    expect(vendorJson.membership).toMatchObject({
      restaurantId: String(restaurant.id),
      marketId,
      stallNumber: "A-01",
      locationLabel: "文華路入口旁",
      isPrimary: true,
    });

    const duplicateVendorRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/admin/markets/${marketId}/vendors`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          restaurantId: String(restaurant.id),
          stallNumber: "A-01",
        }),
      }),
    );
    expect(duplicateVendorRes.status).toBe(409);
    expect((await readEnvelope(duplicateVendorRes)).error).toMatchObject({
      code: "MARKET_VENDOR_ALREADY_ATTACHED",
    });

    const updateVendorRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/${marketId}/vendors/${vendorJson.membership.restaurantId}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            stallNumber: "A-02",
            locationLabel: "美食區第二排",
            isPrimary: false,
          }),
        },
      ),
    );
    expect(updateVendorRes.status).toBe(200);
    expect(
      (await readData<MembershipEnvelope>(updateVendorRes)).membership,
    ).toMatchObject({
      restaurantId: String(restaurant.id),
      marketId,
      stallNumber: "A-02",
      locationLabel: "美食區第二排",
      isPrimary: false,
    });

    const searchableItem = await seed.menuItem(String(restaurant.id), {
      name: "Admin Market Searchable Item",
      price: 95,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: searchableItem.id,
      restaurantId: String(restaurant.id),
      dishName: "Admin Market Searchable Item",
      dishNameNormalized: "adminmarketsearchableitem",
      priceCents: 9500,
      isAvailable: true,
      tags: [],
      district: "西區",
      primaryMarketId: marketId,
      marketIds: [marketId],
      latitude: 24.15,
      longitude: 120.67,
      updatedAt: new Date(),
    });

    const publicVendorsRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/admin-created-market/vendors"),
    );
    expect(publicVendorsRes.status).toBe(200);
    const publicVendorsJson = await readData<MarketVendors>(publicVendorsRes);
    expect(publicVendorsJson.total).toBe(1);

    const publicDetailBeforeDeleteRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/admin-created-market"),
    );
    expect(publicDetailBeforeDeleteRes.status).toBe(200);
    const publicDetailBeforeDeleteJson = await readData<MarketDetail>(
      publicDetailBeforeDeleteRes,
    );
    expect(publicDetailBeforeDeleteJson.market).toMatchObject({
      slug: "admin-created-market",
      name: "更新後夜市",
      bannerUrl: "https://example.com/admin-market-banner.jpg",
      logoUrl: "https://example.com/admin-market-logo.jpg",
      imageUrls: ["https://example.com/admin-market-gallery-3.jpg"],
      tags: ["美食", "宵夜"],
    });
    expect(publicDetailBeforeDeleteJson.market.openingHours).toMatchObject({
      friday: { open: "17:00", close: "23:30" },
      saturday: { open: "16:00", close: "23:59" },
    });

    const removeVendorRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/${marketId}/vendors/${restaurant.id}`,
        {
          method: "DELETE",
          headers,
        },
      ),
    );
    expect(removeVendorRes.status).toBe(200);
    expect(
      (await readData<{ removed: boolean }>(removeVendorRes)).removed,
    ).toBe(true);

    const deleteRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/admin/markets/${marketId}`, {
        method: "DELETE",
        headers,
      }),
    );
    expect(deleteRes.status).toBe(200);
    expect((await readData<{ deleted: boolean }>(deleteRes)).deleted).toBe(
      true,
    );

    const publicDetailRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/admin-created-market"),
    );
    expect(publicDetailRes.status).toBe(404);
  });

  it("lets platform admins dry-run and bulk import markets", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Market Bulk Import Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    const adminUser = await seed.user({
      username: "market-bulk-import-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
      adminUser.id,
    );
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };

    const marketsPayload = [
      {
        slug: "bulk-import-miaokou",
        name: "批次廟口夜市",
        type: "night_market",
        city: "基隆市",
        district: "仁愛區",
        address: "仁三路",
        latitude: 25.128,
        longitude: 121.743,
        tags: ["夜市", "海港"],
      },
      {
        slug: "bulk-import-commercial",
        name: "批次商圈",
        type: "commercial_district",
        city: "台中市",
        district: "北區",
        address: "一中街",
        latitude: 24.15,
        longitude: 120.684,
      },
    ];

    const dryRunRes = await testApp.app.fetch(
      new Request("https://test/api/v1/admin/markets/bulk", {
        method: "POST",
        headers,
        body: JSON.stringify({
          dryRun: true,
          markets: marketsPayload,
        }),
      }),
    );

    expect(dryRunRes.status).toBe(200);
    const dryRunJson = await readData<BulkImportResult>(dryRunRes);
    expect(dryRunJson).toMatchObject({
      dryRun: true,
      wouldCreateMarkets: 2,
      createdMarkets: 0,
      skipped: 0,
      issueCount: 0,
      results: [
        {
          status: "would_create",
          slug: "bulk-import-miaokou",
          marketName: "批次廟口夜市",
          type: "night_market",
        },
        {
          status: "would_create",
          slug: "bulk-import-commercial",
          marketName: "批次商圈",
          type: "commercial_district",
        },
      ],
    });

    const dryRunRows = await testApp.testDb.drizzle
      .select({ slug: markets.slug })
      .from(markets)
      .where(eq(markets.slug, "bulk-import-miaokou"));
    expect(dryRunRows).toEqual([]);

    const importRes = await testApp.app.fetch(
      new Request("https://test/api/v1/admin/markets/bulk", {
        method: "POST",
        headers,
        body: JSON.stringify({ markets: marketsPayload }),
      }),
    );

    expect(importRes.status).toBe(201);
    const importJson = await readData<BulkImportResult>(importRes);
    expect(importJson).toMatchObject({
      createdMarkets: 2,
      skipped: 0,
      issueCount: 0,
    });
    expect(importJson.results).toEqual([
      expect.objectContaining({
        status: "created",
        slug: "bulk-import-miaokou",
        market: expect.objectContaining({
          slug: "bulk-import-miaokou",
          tags: ["夜市", "海港"],
        }),
      }),
      expect.objectContaining({
        status: "created",
        slug: "bulk-import-commercial",
        market: expect.objectContaining({
          type: "commercial_district",
        }),
      }),
    ]);

    const importedRows = await testApp.testDb.drizzle
      .select({
        slug: markets.slug,
        type: markets.type,
        tags: markets.tags,
      })
      .from(markets)
      .where(eq(markets.city, "基隆市"));
    expect(importedRows).toEqual([
      {
        slug: "bulk-import-miaokou",
        type: "night_market",
        tags: ["夜市", "海港"],
      },
    ]);
  });

  it("skips invalid rows during market bulk imports without blocking valid rows", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Market Bulk Partial Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    const adminUser = await seed.user({
      username: "market-bulk-partial-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
      adminUser.id,
    );
    await seedMarket(testApp, {
      slug: "existing-bulk-market",
      name: "既有批次市場",
    });
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };

    const importRes = await testApp.app.fetch(
      new Request("https://test/api/v1/admin/markets/bulk", {
        method: "POST",
        headers,
        body: JSON.stringify({
          markets: [
            {
              slug: "existing-bulk-market",
              name: "重複既有市場",
              type: "night_market",
              city: "台中市",
              district: "西屯區",
              address: "文華路",
              latitude: 24.176,
              longitude: 120.646,
            },
            {
              slug: "new-bulk-market",
              name: "新批次市場",
              type: "food_court",
              city: "台北市",
              district: "信義區",
              address: "松壽路",
              latitude: 25.034,
              longitude: 121.566,
            },
            {
              slug: "new-bulk-market",
              name: "payload 內重複",
              type: "food_court",
              city: "台北市",
              district: "信義區",
              address: "松壽路二段",
              latitude: 25.035,
              longitude: 121.567,
            },
          ],
        }),
      }),
    );

    expect(importRes.status).toBe(201);
    const importJson = await readData<BulkImportResult>(importRes);
    expect(importJson).toMatchObject({
      createdMarkets: 1,
      skipped: 2,
      issueCount: 2,
      blockingIssueCount: 2,
    });
    expect(importJson.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          code: "slug_exists",
          slug: "existing-bulk-market",
        }),
        expect.objectContaining({
          index: 2,
          code: "duplicate_in_payload",
          slug: "new-bulk-market",
        }),
      ]),
    );
    expect(importJson.results).toEqual([
      expect.objectContaining({
        status: "skipped",
        reason: "slug_exists",
        slug: "existing-bulk-market",
      }),
      expect.objectContaining({
        status: "created",
        slug: "new-bulk-market",
      }),
      expect.objectContaining({
        status: "skipped",
        reason: "duplicate_in_payload",
        slug: "new-bulk-market",
      }),
    ]);

    const createdRows = await testApp.testDb.drizzle
      .select({ slug: markets.slug, name: markets.name })
      .from(markets)
      .where(eq(markets.slug, "new-bulk-market"));
    expect(createdRows).toEqual([
      { slug: "new-bulk-market", name: "新批次市場" },
    ]);
  });

  it("syncs discovery search scope when admins add and remove market vendors", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Vendor Discovery Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 44,
      username: "vendor-discovery-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };
    const market = await seedMarket(testApp, {
      slug: "vendor-discovery-sync-market",
    });
    const restaurant = await seed.restaurant({
      name: "Vendor Discovery Sync Stall",
      city: "台中市",
      district: "西屯區",
      latitude: 24.1764,
      longitude: 120.6466,
    });
    const item = await seed.menuItem(String(restaurant.id), {
      name: "Vendor Discovery Sync Bao",
      price: 60,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: item.id,
      restaurantId: String(restaurant.id),
      dishName: "Vendor Discovery Sync Bao",
      dishNameNormalized: "vendordiscoverysyncbao",
      priceCents: 6000,
      isAvailable: true,
      tags: [],
      district: "西屯區",
      primaryMarketId: null,
      marketIds: [],
      latitude: 24.1764,
      longitude: 120.6466,
      updatedAt: new Date(),
    });

    const cachedEmptyRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=Vendor+Discovery+Sync&marketId=${market.id}`,
      ),
    );
    expect(cachedEmptyRes.status).toBe(200);
    expect((await readData<DishSearch>(cachedEmptyRes)).total).toBe(0);

    const addVendorRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/admin/markets/${market.id}/vendors`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          restaurantId: String(restaurant.id),
          stallNumber: "B-01",
          isPrimary: true,
        }),
      }),
    );
    expect(addVendorRes.status).toBe(201);

    const [afterAddIndex] = await testApp.testDb.drizzle
      .select({
        primaryMarketId: dishSearchIndex.primaryMarketId,
        marketIds: dishSearchIndex.marketIds,
      })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, item.id))
      .limit(1);
    expect(afterAddIndex).toEqual({
      primaryMarketId: market.id,
      marketIds: [market.id],
    });

    const afterAddSearchRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=Vendor+Discovery+Sync&marketId=${market.id}`,
      ),
    );
    expect(afterAddSearchRes.status).toBe(200);
    const afterAddSearchJson = await readData<DishSearch>(afterAddSearchRes);
    expect(afterAddSearchJson.results.map((r) => r.menuItemId)).toEqual([
      item.id,
    ]);
    expect(afterAddSearchJson.total).toBe(1);

    const removeVendorRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/${market.id}/vendors/${restaurant.id}`,
        {
          method: "DELETE",
          headers,
        },
      ),
    );
    expect(removeVendorRes.status).toBe(200);
    expect(
      (await readData<{ removed: boolean }>(removeVendorRes)).removed,
    ).toBe(true);

    const [afterRemoveIndex] = await testApp.testDb.drizzle
      .select({
        primaryMarketId: dishSearchIndex.primaryMarketId,
        marketIds: dishSearchIndex.marketIds,
      })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.menuItemId, item.id))
      .limit(1);
    expect(afterRemoveIndex).toEqual({
      primaryMarketId: null,
      marketIds: [],
    });

    const afterRemoveSearchRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/discovery/search?q=Vendor+Discovery+Sync&marketId=${market.id}`,
      ),
    );
    expect(afterRemoveSearchRes.status).toBe(200);
    const afterRemoveSearchJson =
      await readData<DishSearch>(afterRemoveSearchRes);
    expect(afterRemoveSearchJson.results).toEqual([]);
    expect(afterRemoveSearchJson.total).toBe(0);
  });

  it("lets platform admins bulk import vendors into a market", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Vendor Import Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    const existingRestaurant = await seed.restaurant({
      name: "Existing Import Vendor",
      city: "台中市",
      district: "西屯區",
      address: "台中市西屯區既有攤位",
      phone: "0211111111",
    });
    await seed.user({
      id: 41,
      username: "vendor-import-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const market = await seedMarket(testApp, {
      slug: "bulk-import-market",
    });
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };

    const importRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/${market.id}/vendor-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            vendors: [
              {
                restaurantId: String(existingRestaurant.id),
                stallNumber: "A-01",
                locationLabel: "文華路入口",
                mapPosition: { x: 20, y: 35 },
                isPrimary: true,
              },
              {
                name: "新匯入蚵仔煎",
                type: "street_food",
                category: "food",
                address: "台中市西屯區文華路 100 號",
                district: "西屯區",
                city: "台中市",
                phone: "0222222222",
                latitude: 24.1791,
                longitude: 120.6479,
                stallNumber: "B-02",
                locationLabel: "福星路轉角",
                mapPosition: { x: 62, y: 58 },
              },
            ],
          }),
        },
      ),
    );

    expect(importRes.status).toBe(200);
    const importJson = await readData<VendorImportResult>(importRes);
    expect(importJson).toMatchObject({
      createdRestaurants: 1,
      attachedVendors: 2,
      skipped: 0,
      catalogReadiness: {
        searchableProductCount: 0,
        publicServiceCount: 0,
        vendorsWithSearchableProducts: 0,
        vendorsMissingSearchableProducts: 2,
        vendorsWithPublicServices: 0,
        vendorsMissingPublicServices: 2,
        vendorsMissingStallNumbers: 0,
        vendorsMissingSearchEntrypoints: 2,
      },
      publicReadiness: {
        ready: false,
        score: 63,
        completedCount: 5,
        totalCount: 8,
        issues: [
          { key: "map", severity: "recommended" },
          { key: "products", severity: "required" },
          { key: "services", severity: "recommended" },
        ],
      },
    });
    expect(importJson.results).toEqual([
      expect.objectContaining({
        status: "attached",
        restaurantId: String(existingRestaurant.id),
        stallNumber: "A-01",
        locationLabel: "文華路入口",
        mapPosition: { x: 20, y: 35 },
      }),
      expect.objectContaining({
        status: "created",
        restaurantName: "新匯入蚵仔煎",
        stallNumber: "B-02",
        locationLabel: "福星路轉角",
        mapPosition: { x: 62, y: 58 },
      }),
    ]);
    expect(importJson.catalogReadiness.missingProductVendors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          restaurantId: String(existingRestaurant.id),
          name: "Existing Import Vendor",
          stallNumber: "A-01",
          locationLabel: "文華路入口",
        }),
        expect.objectContaining({
          name: "新匯入蚵仔煎",
          stallNumber: "B-02",
        }),
      ]),
    );
    expect(importJson.catalogReadiness.missingServiceVendors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          restaurantId: String(existingRestaurant.id),
          name: "Existing Import Vendor",
          stallNumber: "A-01",
          locationLabel: "文華路入口",
        }),
        expect.objectContaining({
          name: "新匯入蚵仔煎",
          stallNumber: "B-02",
        }),
      ]),
    );
    expect(
      importJson.catalogReadiness.missingSearchEntrypointVendors,
    ).toHaveLength(2);

    const memberships = await testApp.testDb.drizzle
      .select({
        restaurantId: restaurantMarketMemberships.restaurantId,
        stallNumber: restaurantMarketMemberships.stallNumber,
        locationLabel: restaurantMarketMemberships.locationLabel,
      })
      .from(restaurantMarketMemberships)
      .where(eq(restaurantMarketMemberships.marketId, market.id));
    expect(memberships).toEqual(
      expect.arrayContaining([
        {
          restaurantId: String(existingRestaurant.id),
          stallNumber: "A-01",
          locationLabel: "文華路入口",
        },
        expect.objectContaining({
          stallNumber: "B-02",
          locationLabel: "福星路轉角",
        }),
      ]),
    );
    expect(memberships).toHaveLength(2);

    const [importedVendor] = await testApp.testDb.drizzle
      .select({
        name: restaurants.name,
        latitude: restaurants.latitude,
        longitude: restaurants.longitude,
      })
      .from(restaurants)
      .where(eq(restaurants.name, "新匯入蚵仔煎"))
      .limit(1);
    expect(importedVendor).toMatchObject({
      name: "新匯入蚵仔煎",
      latitude: 24.1791,
      longitude: 120.6479,
    });

    const duplicateRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/${market.id}/vendor-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            vendors: [
              {
                restaurantId: String(existingRestaurant.id),
                stallNumber: "A-01",
              },
            ],
          }),
        },
      ),
    );
    expect(duplicateRes.status).toBe(200);
    const duplicateJson = await readData<BulkImportResult>(duplicateRes);
    expect(duplicateJson).toMatchObject({
      createdRestaurants: 0,
      attachedVendors: 0,
      skipped: 1,
    });
    expect(duplicateJson.results[0]).toMatchObject({
      status: "skipped",
      reason: "already_attached",
      restaurantId: String(existingRestaurant.id),
    });

    const missingRestaurantRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/${market.id}/vendor-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            vendors: [
              {
                restaurantId: "missing-import-restaurant",
                stallNumber: "C-03",
              },
            ],
          }),
        },
      ),
    );
    expect(missingRestaurantRes.status).toBe(200);
    const missingRestaurantJson =
      await readData<BulkImportResult>(missingRestaurantRes);
    expect(missingRestaurantJson).toMatchObject({
      createdRestaurants: 0,
      attachedVendors: 0,
      skipped: 1,
    });
    expect(missingRestaurantJson.results[0]).toMatchObject({
      status: "skipped",
      reason: "restaurant_not_found",
      restaurantId: "missing-import-restaurant",
    });
  });

  it("lets platform admins dry-run vendor imports before mutating data", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Vendor Import Dry Run Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    const existingRestaurant = await seed.restaurant({
      name: "Existing Dry Run Vendor",
      city: "台中市",
      district: "西屯區",
      address: "台中市西屯區既有預檢攤位",
      phone: "0233333333",
    });
    await seed.user({
      id: 45,
      username: "vendor-import-dry-run-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const market = await seedMarket(testApp, {
      slug: "bulk-import-dry-run-market",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(existingRestaurant.id),
      marketId: market.id,
      stallNumber: "A-01",
      isPrimary: true,
      joinedAt: new Date(),
    });
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };

    const dryRunRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/${market.id}/vendor-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            dryRun: true,
            vendors: [
              {
                restaurantId: String(existingRestaurant.id),
                stallNumber: "A-01",
              },
              {
                restaurantId: "missing-dry-run-restaurant",
                stallNumber: "B-02",
              },
              {
                name: "預檢新攤商",
                type: "street_food",
                category: "food",
                address: "台中市西屯區文華路 200 號",
                district: "西屯區",
                stallNumber: "C-03",
              },
              {
                name: "預檢新攤商",
                type: "street_food",
                category: "food",
                address: "台中市西屯區文華路 200 號",
                district: "西屯區",
                stallNumber: "C-04",
              },
            ],
          }),
        },
      ),
    );

    expect(dryRunRes.status).toBe(200);
    const dryRunJson = await readData<BulkImportResult>(dryRunRes);
    expect(dryRunJson).toMatchObject({
      dryRun: true,
      wouldCreateRestaurants: 1,
      wouldAttachVendors: 1,
      skipped: 3,
      publicReadiness: {
        ready: false,
        score: 63,
        completedCount: 5,
        totalCount: 8,
        issues: [
          { key: "map", severity: "recommended" },
          { key: "products", severity: "required" },
          { key: "services", severity: "recommended" },
        ],
      },
    });
    expect(dryRunJson.results).toEqual([
      expect.objectContaining({
        status: "skipped",
        reason: "already_attached",
        restaurantId: String(existingRestaurant.id),
      }),
      expect.objectContaining({
        status: "skipped",
        reason: "restaurant_not_found",
        restaurantId: "missing-dry-run-restaurant",
      }),
      expect.objectContaining({
        status: "would_create",
        restaurantName: "預檢新攤商",
        stallNumber: "C-03",
      }),
      expect.objectContaining({
        status: "skipped",
        reason: "duplicate_in_payload",
        restaurantName: "預檢新攤商",
        stallNumber: "C-04",
      }),
    ]);
    expect(dryRunJson.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          code: "already_attached",
          severity: "blocking",
        }),
        expect.objectContaining({
          index: 1,
          code: "restaurant_not_found",
          severity: "blocking",
        }),
        expect.objectContaining({
          index: 2,
          code: "phone_defaulted",
          severity: "warning",
          field: "phone",
        }),
        expect.objectContaining({
          index: 2,
          code: "city_defaulted",
          severity: "warning",
          field: "city",
        }),
        expect.objectContaining({
          index: 2,
          code: "coordinates_missing",
          severity: "warning",
          field: "coordinates",
        }),
        expect.objectContaining({
          index: 3,
          code: "duplicate_in_payload",
          severity: "blocking",
        }),
      ]),
    );

    const memberships = await testApp.testDb.drizzle
      .select({ restaurantId: restaurantMarketMemberships.restaurantId })
      .from(restaurantMarketMemberships)
      .where(eq(restaurantMarketMemberships.marketId, market.id));
    expect(memberships).toEqual([
      { restaurantId: String(existingRestaurant.id) },
    ]);

    const [createdRestaurant] = await testApp.testDb.drizzle
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.name, "預檢新攤商"))
      .limit(1);
    expect(createdRestaurant).toBeUndefined();
  });

  it("reports live vendor import issues for skipped and defaulted rows", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Vendor Import Issue Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    const existingRestaurant = await seed.restaurant({
      name: "Existing Issue Import Vendor",
      city: "台中市",
      district: "西屯區",
      address: "台中市西屯區既有問題攤位",
      phone: "0233333333",
    });
    await seed.user({
      id: 47,
      username: "vendor-import-issue-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const market = await seedMarket(testApp, {
      slug: "bulk-import-issue-market",
      city: "台中市",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(existingRestaurant.id),
      marketId: market.id,
      stallNumber: "A-01",
      isPrimary: true,
      joinedAt: new Date(),
    });
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };

    const importRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/${market.id}/vendor-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            vendors: [
              {
                restaurantId: String(existingRestaurant.id),
                stallNumber: "A-01",
              },
              {
                restaurantId: "missing-live-import-restaurant",
                stallNumber: "B-02",
              },
              {
                name: "正式匯入待補資料攤商",
                type: "street_food",
                category: "food",
                address: "台中市西屯區文華路 400 號",
                district: "西屯區",
                stallNumber: "C-03",
              },
            ],
          }),
        },
      ),
    );

    expect(importRes.status).toBe(200);
    const importJson = await readData<VendorImportResult>(importRes);
    expect(importJson).toMatchObject({
      createdRestaurants: 1,
      attachedVendors: 1,
      skipped: 2,
      issueCount: 5,
      blockingIssueCount: 2,
      warningIssueCount: 3,
    });
    expect(importJson.results).toEqual([
      expect.objectContaining({
        status: "skipped",
        reason: "already_attached",
        restaurantId: String(existingRestaurant.id),
      }),
      expect.objectContaining({
        status: "skipped",
        reason: "restaurant_not_found",
        restaurantId: "missing-live-import-restaurant",
      }),
      expect.objectContaining({
        status: "created",
        restaurantName: "正式匯入待補資料攤商",
        stallNumber: "C-03",
      }),
    ]);
    expect(importJson.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          code: "already_attached",
          severity: "blocking",
        }),
        expect.objectContaining({
          index: 1,
          code: "restaurant_not_found",
          severity: "blocking",
        }),
        expect.objectContaining({
          index: 2,
          code: "phone_defaulted",
          severity: "warning",
          field: "phone",
        }),
        expect.objectContaining({
          index: 2,
          code: "city_defaulted",
          severity: "warning",
          field: "city",
        }),
        expect.objectContaining({
          index: 2,
          code: "coordinates_missing",
          severity: "warning",
          field: "coordinates",
        }),
      ]),
    );

    const [createdRestaurant] = await testApp.testDb.drizzle
      .select({
        city: restaurants.city,
        phone: restaurants.phone,
        latitude: restaurants.latitude,
        longitude: restaurants.longitude,
      })
      .from(restaurants)
      .where(eq(restaurants.name, "正式匯入待補資料攤商"))
      .limit(1);
    expect(createdRestaurant).toEqual({
      city: "台中市",
      phone: "00000000",
      latitude: null,
      longitude: null,
    });
  });

  it("skips duplicate vendors in a live bulk import payload", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Vendor Duplicate Import Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    const existingRestaurant = await seed.restaurant({
      name: "Existing Duplicate Import Vendor",
      city: "台中市",
      district: "西屯區",
      address: "台中市西屯區重複攤位",
      phone: "0244444444",
    });
    await seed.user({
      id: 46,
      username: "vendor-import-duplicate-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const market = await seedMarket(testApp, {
      slug: "bulk-import-duplicate-market",
    });
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };

    const importRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/${market.id}/vendor-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            vendors: [
              {
                restaurantId: String(existingRestaurant.id),
                stallNumber: "A-01",
              },
              {
                restaurantId: String(existingRestaurant.id),
                stallNumber: "A-02",
              },
              {
                name: "正式匯入重複新攤商",
                type: "street_food",
                category: "food",
                address: "台中市西屯區文華路 300 號",
                district: "西屯區",
                city: "台中市",
                phone: "0255555555",
                stallNumber: "B-01",
              },
              {
                name: "正式匯入重複新攤商",
                type: "street_food",
                category: "food",
                address: "台中市西屯區文華路 300 號",
                district: "西屯區",
                city: "台中市",
                phone: "0255555555",
                stallNumber: "B-02",
              },
            ],
          }),
        },
      ),
    );

    expect(importRes.status).toBe(200);
    const importJson = await readData<VendorImportResult>(importRes);
    expect(importJson).toMatchObject({
      createdRestaurants: 1,
      attachedVendors: 2,
      skipped: 2,
      issueCount: 3,
      blockingIssueCount: 2,
      warningIssueCount: 1,
    });
    expect(importJson.results).toEqual([
      expect.objectContaining({
        status: "attached",
        restaurantId: String(existingRestaurant.id),
        stallNumber: "A-01",
      }),
      expect.objectContaining({
        status: "skipped",
        reason: "duplicate_in_payload",
        restaurantId: String(existingRestaurant.id),
        stallNumber: "A-02",
      }),
      expect.objectContaining({
        status: "created",
        restaurantName: "正式匯入重複新攤商",
        stallNumber: "B-01",
      }),
      expect.objectContaining({
        status: "skipped",
        reason: "duplicate_in_payload",
        restaurantName: "正式匯入重複新攤商",
        stallNumber: "B-02",
      }),
    ]);
    expect(importJson.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 1,
          code: "duplicate_in_payload",
          severity: "blocking",
        }),
        expect.objectContaining({
          index: 3,
          code: "duplicate_in_payload",
          severity: "blocking",
        }),
        expect.objectContaining({
          index: 2,
          code: "coordinates_missing",
          severity: "warning",
          field: "coordinates",
        }),
      ]),
    );

    const memberships = await testApp.testDb.drizzle
      .select({ restaurantId: restaurantMarketMemberships.restaurantId })
      .from(restaurantMarketMemberships)
      .where(eq(restaurantMarketMemberships.marketId, market.id));
    expect(memberships).toHaveLength(2);

    const createdRows = await testApp.testDb.drizzle
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.name, "正式匯入重複新攤商"));
    expect(createdRows).toHaveLength(1);
  });

  it("lets platform admins search restaurant candidates before attaching vendors", async () => {
    const adminRestaurant = await seed.restaurant({
      name: "Vendor Search Admin",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 22,
      username: "vendor-search-admin",
      role: 0,
      restaurantId: String(adminRestaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(adminRestaurant.id),
    );
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };
    const market = await seedMarket(testApp, {
      slug: "vendor-search-market",
      name: "Vendor Search Market",
    });
    const candidate = await seed.restaurant({
      name: "Searchable Bao Stand",
      city: "台中市",
      district: "西屯區",
      address: "Candidate Road 1",
    });
    const activeMember = await seed.restaurant({
      name: "Searchable Existing Member",
      city: "台中市",
      district: "西屯區",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(activeMember.id),
      marketId: market.id,
      joinedAt: new Date(),
    });
    await seed.restaurant({
      name: "Unrelated Noodle Shop",
      city: "台中市",
      district: "北區",
    });

    const candidatesRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/vendor-candidates?q=Searchable&marketId=${market.id}`,
        { headers },
      ),
    );
    expect(candidatesRes.status).toBe(200);
    const candidatesJson = await readData<VendorCandidates>(candidatesRes);
    expect(candidatesJson.restaurants).toEqual([
      expect.objectContaining({
        id: String(candidate.id),
        name: "Searchable Bao Stand",
        city: "台中市",
        district: "西屯區",
        address: "Candidate Road 1",
      }),
    ]);
    expect(candidatesJson.total).toBe(1);
  });

  it("lets platform admins review, approve, and reject market join requests", async () => {
    const restaurant = await seed.restaurant({
      name: "Join Review Vendor",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 21,
      username: "join-review-admin",
      role: 0,
      restaurantId: String(restaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };
    const approvedMarket = await seedMarket(testApp, {
      slug: "approved-review-market",
      name: "Approved Review Market",
    });
    const rejectedMarket = await seedMarket(testApp, {
      slug: "rejected-review-market",
      name: "Rejected Review Market",
    });

    const createApprovedRequest = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/market-join-requests`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            marketId: approvedMarket.id,
            message: "Please approve our stall.",
          }),
        },
      ),
    );
    expect(createApprovedRequest.status).toBe(201);
    const approvedRequestJson = await readData<CreatedJoinRequest>(
      createApprovedRequest,
    );

    const createRejectedRequest = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/market-join-requests`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            marketId: rejectedMarket.id,
            message: "Please reject this test request.",
          }),
        },
      ),
    );
    expect(createRejectedRequest.status).toBe(201);
    const rejectedRequestJson = await readData<CreatedJoinRequest>(
      createRejectedRequest,
    );

    const listRes = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/admin/markets/join-requests?status=pending",
        {
          headers: { authorization: `Bearer ${adminToken}` },
        },
      ),
    );
    expect(listRes.status).toBe(200);
    const listJson = await readData<AdminJoinRequests>(listRes);
    expect(listJson.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: approvedRequestJson.request.id,
          status: "pending",
          restaurant: expect.objectContaining({ name: "Join Review Vendor" }),
          market: expect.objectContaining({ slug: "approved-review-market" }),
        }),
        expect.objectContaining({
          id: rejectedRequestJson.request.id,
          status: "pending",
          market: expect.objectContaining({ slug: "rejected-review-market" }),
        }),
      ]),
    );

    const approveRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/join-requests/${approvedRequestJson.request.id}/approve`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            stallNumber: "C-09",
            isPrimary: true,
          }),
        },
      ),
    );
    expect(approveRes.status).toBe(200);
    const approveJson = await readData<ApprovedJoinRequest>(approveRes);
    expect(approveJson.request).toMatchObject({
      id: approvedRequestJson.request.id,
      status: "approved",
    });
    expect(approveJson.membership).toMatchObject({
      restaurantId: String(restaurant.id),
      marketId: approvedMarket.id,
      stallNumber: "C-09",
      isPrimary: true,
    });

    const reviewItem = await seed.menuItem(String(restaurant.id), {
      name: "Join Review Searchable Item",
      price: 95,
    });
    await testApp.testDb.drizzle.insert(dishSearchIndex).values({
      menuItemId: reviewItem.id,
      restaurantId: String(restaurant.id),
      dishName: "Join Review Searchable Item",
      dishNameNormalized: "joinreviewsearchableitem",
      priceCents: 9500,
      isAvailable: true,
      tags: [],
      district: approvedMarket.district,
      primaryMarketId: approvedMarket.id,
      marketIds: [approvedMarket.id],
      latitude: 24.15,
      longitude: 120.67,
      updatedAt: new Date(),
    });

    const vendorsRes = await testApp.app.fetch(
      new Request("https://test/api/v1/markets/approved-review-market/vendors"),
    );
    expect(vendorsRes.status).toBe(200);
    const vendorsJson = await readData<MarketVendors>(vendorsRes);
    expect(vendorsJson.vendors[0]).toMatchObject({
      restaurantId: String(restaurant.id),
      stallNumber: "C-09",
    });

    const rejectRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/join-requests/${rejectedRequestJson.request.id}/reject`,
        {
          method: "POST",
          headers,
        },
      ),
    );
    expect(rejectRes.status).toBe(200);
    const rejectJson = await readData<RejectedJoinRequest>(rejectRes);
    expect(rejectJson.request).toMatchObject({
      id: rejectedRequestJson.request.id,
      status: "rejected",
    });
  });

  it("approves a pending join request when the vendor was already attached", async () => {
    const restaurant = await seed.restaurant({
      name: "Already Attached Join Vendor",
      latitude: 24.15,
      longitude: 120.67,
    });
    await seed.user({
      id: 24,
      username: "already-attached-join-admin",
      role: 0,
      restaurantId: String(restaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };
    const market = await seedMarket(testApp, {
      slug: "already-attached-join-market",
      name: "Already Attached Join Market",
    });

    const requestRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/market-join-requests`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ marketId: market.id }),
        },
      ),
    );
    expect(requestRes.status).toBe(201);
    const requestJson = await readData<CreatedJoinRequest>(requestRes);

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "B-12",
      joinedAt: new Date(),
    });

    const approveRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/admin/markets/join-requests/${requestJson.request.id}/approve`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            stallNumber: "B-12",
            isPrimary: true,
          }),
        },
      ),
    );
    expect(approveRes.status).toBe(200);
    const approveJson = await readData<ApprovedJoinRequest>(approveRes);
    expect(approveJson.request).toMatchObject({
      id: requestJson.request.id,
      status: "approved",
    });
    expect(approveJson.membership).toMatchObject({
      restaurantId: String(restaurant.id),
      marketId: market.id,
      stallNumber: "B-12",
      isPrimary: true,
    });

    const memberships = await testApp.testDb.drizzle
      .select({ id: restaurantMarketMemberships.id })
      .from(restaurantMarketMemberships)
      .where(
        and(
          eq(restaurantMarketMemberships.restaurantId, String(restaurant.id)),
          eq(restaurantMarketMemberships.marketId, market.id),
          isNull(restaurantMarketMemberships.leftAt),
        ),
      );
    expect(memberships).toHaveLength(1);
  });

  it("lets restaurant owners view memberships and request to join a market", async () => {
    const restaurant = await seed.restaurant({
      name: "Owner Market Vendor",
      latitude: 24.15,
      longitude: 120.67,
    });
    const activeMarket = await seedMarket(testApp, {
      slug: "owner-active-market",
      name: "Owner Active Market",
    });
    const requestedMarket = await seedMarket(testApp, {
      slug: "owner-requested-market",
      name: "Owner Requested Market",
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(restaurant.id),
      marketId: activeMarket.id,
      stallNumber: "B-02",
      isPrimary: true,
      joinedAt: new Date(),
    });
    await seed.user({
      id: 2,
      username: "market-owner",
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const ownerToken = await testApp.authHelper.ownerToken(
      2,
      String(restaurant.id),
    );
    const headers = {
      authorization: `Bearer ${ownerToken}`,
      "content-type": "application/json",
      ...CSRF_HEADERS,
    };

    const membershipsRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/restaurants/${restaurant.id}/markets`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );
    expect(membershipsRes.status).toBe(200);
    const membershipsJson =
      await readData<RestaurantMemberships>(membershipsRes);
    expect(membershipsJson.memberships).toHaveLength(1);
    expect(membershipsJson.memberships[0]).toMatchObject({
      restaurantId: String(restaurant.id),
      marketId: activeMarket.id,
      stallNumber: "B-02",
      isPrimary: true,
      market: {
        slug: "owner-active-market",
        name: "Owner Active Market",
      },
    });

    const requestRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/market-join-requests`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            marketId: requestedMarket.id,
            message: "We sell late-night dumplings.",
          }),
        },
      ),
    );
    expect(requestRes.status).toBe(201);
    const requestJson = await readData<CreatedJoinRequest>(requestRes);
    expect(requestJson.request).toMatchObject({
      restaurantId: String(restaurant.id),
      marketId: requestedMarket.id,
      status: "pending",
      message: "We sell late-night dumplings.",
    });

    const requestsRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/market-join-requests`,
        {
          headers: { authorization: `Bearer ${ownerToken}` },
        },
      ),
    );
    expect(requestsRes.status).toBe(200);
    const requestsJson = await readData<RestaurantJoinRequests>(requestsRes);
    expect(requestsJson.requests).toHaveLength(1);
    expect(requestsJson.requests[0]).toMatchObject({
      restaurantId: String(restaurant.id),
      marketId: requestedMarket.id,
      status: "pending",
      message: "We sell late-night dumplings.",
      market: {
        slug: "owner-requested-market",
        name: "Owner Requested Market",
      },
    });

    const duplicateRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/market-join-requests`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ marketSlug: "owner-requested-market" }),
        },
      ),
    );
    expect(duplicateRes.status).toBe(409);

    const activeMembershipRequestRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/market-join-requests`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ marketId: activeMarket.id }),
        },
      ),
    );
    expect(activeMembershipRequestRes.status).toBe(409);
  });

  it("lets restaurant owners request market membership by public slug", async () => {
    const restaurant = await seed.restaurant({
      name: "Owner Slug Market Vendor",
      latitude: 24.15,
      longitude: 120.67,
    });
    const requestedMarket = await seedMarket(testApp, {
      slug: "owner-slug-request-market",
      name: "Owner Slug Request Market",
    });
    await seed.user({
      id: 22,
      username: "market-slug-owner",
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const ownerToken = await testApp.authHelper.ownerToken(
      22,
      String(restaurant.id),
    );

    const requestRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/market-join-requests`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${ownerToken}`,
            "content-type": "application/json",
            ...CSRF_HEADERS,
          },
          body: JSON.stringify({
            marketSlug: "owner-slug-request-market",
            message: "We can support the weekend market.",
          }),
        },
      ),
    );
    expect(requestRes.status).toBe(201);
    const requestJson = await readData<CreatedJoinRequest>(requestRes);
    expect(requestJson.request).toMatchObject({
      restaurantId: String(restaurant.id),
      marketId: requestedMarket.id,
      status: "pending",
      message: "We can support the weekend market.",
    });
  });

  it("lets restaurant owners manage public contact channels and FAQs", async () => {
    const restaurant = await seed.restaurant({
      name: "Deep Link Dumplings",
    });
    await seed.user({
      id: 3,
      username: "contact-owner",
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const ownerToken = await testApp.authHelper.ownerToken(
      3,
      String(restaurant.id),
    );

    const updateRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/contact-profile`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${ownerToken}`,
            "content-type": "application/json",
            ...CSRF_HEADERS,
          },
          body: JSON.stringify({
            messagingChannels: {
              line: "https://line.me/ti/p/~deep-dumplings",
              whatsapp: "https://wa.me/886912345678",
              instagram: "https://ig.me/m/deepdumplings",
            },
            faqs: [
              {
                question: "可以先預訂嗎？",
                answer: "可以，請透過 LINE 留下取餐時間。",
                keywords: ["預訂", "取餐"],
                displayOrder: 2,
                isActive: true,
              },
              {
                question: "有素食選項嗎？",
                answer: "目前提供高麗菜素餃。",
                keywords: ["素食"],
                displayOrder: 1,
                isActive: true,
              },
              {
                question: "停賣品項",
                answer: "這筆不應出現在公開 FAQ。",
                keywords: ["隱藏"],
                displayOrder: 3,
                isActive: false,
              },
            ],
          }),
        },
      ),
    );
    expect(updateRes.status).toBe(200);

    const publicRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/contact-profile`,
      ),
    );
    expect(publicRes.status).toBe(200);
    const publicJson = await readData<ContactProfile>(publicRes);
    expect(publicJson.messagingChannels).toEqual({
      line: "https://line.me/ti/p/~deep-dumplings",
      whatsapp: "https://wa.me/886912345678",
      instagram: "https://ig.me/m/deepdumplings",
    });
    expect(publicJson.faqs).toEqual([
      expect.objectContaining({
        question: "有素食選項嗎？",
        answer: "目前提供高麗菜素餃。",
        keywords: ["素食"],
        displayOrder: 1,
        isActive: true,
      }),
      expect.objectContaining({
        question: "可以先預訂嗎？",
        answer: "可以，請透過 LINE 留下取餐時間。",
        keywords: ["預訂", "取餐"],
        displayOrder: 2,
        isActive: true,
      }),
    ]);

    const ownerRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/restaurants/${restaurant.id}/contact-profile`,
        {
          headers: { authorization: `Bearer ${ownerToken}` },
        },
      ),
    );
    expect(ownerRes.status).toBe(200);
    const ownerJson = await readData<ContactProfile>(ownerRes);
    expect(ownerJson.faqs).toHaveLength(3);
    expect(ownerJson.faqs[2]).toMatchObject({
      question: "停賣品項",
      isActive: false,
    });
  });
});
