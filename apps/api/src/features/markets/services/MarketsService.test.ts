import { beforeEach, describe, expect, it, vi } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => {
  const cache = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  };
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  return { cache, db };
});

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => mocks.db),
}));

vi.mock("../../../core/cache", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    KVCacheService: vi.fn(function KVCacheService() {
      return mocks.cache;
    }),
    NoopCacheService: vi.fn(function NoopCacheService() {
      return mocks.cache;
    }),
  };
});

import {
  dishSearchIndex,
  marketJoinRequests,
  markets,
  menuItems,
  restaurantMarketMemberships,
  restaurantServiceItems,
  restaurants,
  systemAlerts,
} from "@makanmasak/database";
import {
  createMutationFixtureDb,
  createSelectFixtureDb,
  type MutationFixtures,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { MarketsService } from "./MarketsService";

/**
 * `vi.spyOn` cannot name a private method, but an indexed-access type can — so
 * the target is viewed through an object carrying each method's real signature
 * rather than through `any`.
 */
type MarketsServicePrivates = {
  queryMarkets: MarketsService["queryMarkets"];
  queryAreas: MarketsService["queryAreas"];
  queryVendors: MarketsService["queryVendors"];
  queryMarketBySlug: MarketsService["queryMarketBySlug"];
  countCatalogCoverage: MarketsService["countCatalogCoverage"];
  catalogCoverageWithVendorBreakdown: MarketsService["catalogCoverageWithVendorBreakdown"];
};

function spyOnPrivate<K extends keyof MarketsServicePrivates>(
  service: MarketsService,
  key: K,
) {
  return vi.spyOn(service as unknown as MarketsServicePrivates, key);
}

type QueriedMarkets = Awaited<ReturnType<MarketsService["queryMarkets"]>>;
type QueriedMarket = QueriedMarkets["markets"][number];
type MarketBySlugResult = NonNullable<
  Awaited<ReturnType<MarketsService["queryMarketBySlug"]>>
>;
type MarketBySlugRow = MarketBySlugResult["market"];

function buildReadiness(
  overrides: Partial<QueriedMarket["publicReadiness"]> = {},
): QueriedMarket["publicReadiness"] {
  return {
    score: 100,
    ready: true,
    completedCount: 8,
    totalCount: 8,
    issues: [],
    ...overrides,
  };
}

function buildCoverage(
  overrides: Partial<QueriedMarket["catalogCoverage"]> = {},
): QueriedMarket["catalogCoverage"] {
  return { searchableProductCount: 0, publicServiceCount: 0, ...overrides };
}

/** catalogCoverageWithVendorBreakdown promises every optional field. */
function buildFullCoverage(
  overrides: Partial<Required<QueriedMarket["catalogCoverage"]>> = {},
): Required<QueriedMarket["catalogCoverage"]> {
  return {
    searchableProductCount: 0,
    publicServiceCount: 0,
    bookingRequiredServiceCount: 0,
    bookingUrlMissingServiceCount: 0,
    vendorsWithSearchableProducts: 0,
    vendorsMissingSearchableProducts: 0,
    vendorsWithPublicServices: 0,
    vendorsMissingPublicServices: 0,
    vendorsMissingBookingUrls: 0,
    vendorsMissingStallNumbers: 0,
    vendorsMissingMapPositions: 0,
    vendorsMissingSearchEntrypoints: 0,
    missingProductVendors: [],
    missingServiceVendors: [],
    missingBookingUrlVendors: [],
    missingStallNumberVendors: [],
    missingMapPositionVendors: [],
    missingSearchEntrypointVendors: [],
    ...overrides,
  };
}

function buildQueriedMarket(
  overrides: Partial<QueriedMarket> = {},
): QueriedMarket {
  return {
    id: "market-1",
    slug: "market-1",
    name: "Market",
    type: "night_market",
    description: null,
    city: "台中市",
    district: "西屯區",
    address: "文華路",
    latitude: 24.1,
    longitude: 120.6,
    boundaryGeojson: null,
    openingHours: null,
    mapLayout: null,
    bannerUrl: null,
    logoUrl: null,
    imageUrls: null,
    tags: null,
    updatedAt: new Date(0),
    vendorCount: 0,
    catalogCoverage: buildCoverage(),
    publicReadiness: buildReadiness(),
    ...overrides,
  };
}

function buildMarketRow(
  overrides: Partial<MarketBySlugRow> = {},
): MarketBySlugRow {
  const {
    vendorCount: _vendorCount,
    catalogCoverage: _catalogCoverage,
    publicReadiness: _publicReadiness,
    ...columns
  } = buildQueriedMarket();
  return {
    ...columns,
    platformFeeRateBps: 0,
    isActive: true,
    createdAt: new Date(0),
    deletedAt: null,
    ...overrides,
  };
}

function buildMarketBySlug(
  overrides: Partial<MarketBySlugResult> = {},
): MarketBySlugResult {
  return {
    market: buildMarketRow(),
    vendorCount: 0,
    catalogCoverage: buildCoverage(),
    explorationSummary: {
      dishSearchUrl: "",
      serviceSearchUrl: "",
      dishCategories: [],
      menuItemCategories: [],
      productCategories: [],
      serviceTypes: [],
    },
    publicReadiness: buildReadiness(),
    ...overrides,
  };
}

function buildQueriedMarkets(
  markets: QueriedMarket[],
): Awaited<ReturnType<MarketsService["queryMarkets"]>> {
  return { markets, total: markets.length, page: 1, limit: 20 };
}

function createKV(version = "1") {
  const values = new Map<string, string>([["markets:version", version]]);

  return {
    values,
    kv: {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
    } as unknown as KVNamespace,
  };
}

function createService(version?: string) {
  const { kv, values } = createKV(version);
  return {
    service: new MarketsService({} as D1Database, kv),
    kv,
    values,
  };
}

/**
 * Select fixtures are keyed by table, not by call order: `from(table)` decides
 * which queue a query draws from, so adding a query against one table can no
 * longer shift another table's results out from under it.
 *
 * Two things still need care when the code under test grows a new query:
 *
 * - Within a single table the queue is positional. The Nth read of a table
 *   takes that table's Nth fixture, so a new query means inserting a fixture
 *   at the matching index rather than appending one at the end.
 * - A table has to be listed in `fixtureTables` before it can be declared. An
 *   unregistered table matches no queue, so every read of it throws.
 *
 * Missing and exhausted fixtures both throw and name the table. Nothing falls
 * back to `[]`; a silent empty result is what made the previous positional
 * queue so hard to trace back to its cause.
 *
 * Writes follow the same rules through `mockMutationResults` below, keyed by
 * table and operation.
 */
const fixtureTables = {
  markets,
  restaurantMarketMemberships,
  dishSearchIndex,
  restaurantServiceItems,
  menuItems,
  restaurants,
  marketJoinRequests,
};
type FixtureName = keyof typeof fixtureTables;

function mockSelectResults(fixtures: SelectFixtures<FixtureName>) {
  const fixtureDb = createSelectFixtureDb(fixtureTables, fixtures);
  mocks.db.select.mockImplementation(fixtureDb.select);
}

/**
 * Writes are declared per table *and* operation. This file is why the
 * operation has to be part of the key: `addVendor` inserts and updates
 * `restaurantMarketMemberships` on two different branches, and
 * `approveJoinRequest` writes memberships and join requests in one call, so a
 * single queue per table — let alone the one shared queue this harness used to
 * hand to both insert and update — lets one write eat another's fixture.
 *
 * Writes that are awaited without `.returning()` still consume a fixture:
 * declare them as `{ changes: n }`. `softDeleteMarket` and
 * `clearPrimaryMembership` are the two that look invisible but are not.
 */
function mockMutationResults(fixtures: MutationFixtures<FixtureName> = {}) {
  const fixtureDb = createMutationFixtureDb(fixtureTables, fixtures);
  mocks.db.insert.mockImplementation(fixtureDb.insert);
  mocks.db.update.mockImplementation(fixtureDb.update);
  return fixtureDb;
}

function createD1(
  firstResults: Array<Record<string, unknown> | null> = [],
  allResults: Array<Record<string, unknown>[]> = [],
) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => firstResults.shift() ?? null),
        all: vi.fn(async () => ({ results: allResults.shift() ?? [] })),
      })),
    })),
  } as unknown as D1Database;
}

const marketResult = buildQueriedMarkets([
  buildQueriedMarket({
    id: "market-1",
    slug: "night-market",
    name: "Night Market",
    type: "night_market",
    city: "Taipei",
    district: "Central",
    vendorCount: 2,
    catalogCoverage: buildCoverage({
      searchableProductCount: 3,
      publicServiceCount: 1,
    }),
    publicReadiness: buildReadiness({ score: 80 }),
  }),
]);

describe("MarketsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReset();
    mocks.db.insert.mockReset();
    mocks.db.update.mockReset();
    mocks.db.delete.mockReset();
  });

  it("returns cached public list data and skips market queries", async () => {
    mocks.cache.get.mockResolvedValue(marketResult);
    const { service, kv } = createService("4");
    const querySpy = spyOnPrivate(service, "queryMarkets");

    await expect(
      service.listMarkets({ district: "Central", city: "Taipei" }),
    ).resolves.toBe(marketResult);

    expect(kv.get).toHaveBeenCalledWith("markets:version");
    expect(mocks.cache.get).toHaveBeenCalledWith(
      'markets:v4:list:{"city":"Taipei","district":"Central"}',
    );
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("queries and caches public list, area, and detail misses", async () => {
    mocks.cache.get.mockResolvedValue(null);
    const { service } = createService("2");
    spyOnPrivate(service, "queryMarkets").mockResolvedValue(marketResult);
    spyOnPrivate(service, "queryAreas").mockResolvedValue({
      areas: [{ city: "Taipei", districts: ["Central"] }],
    });
    spyOnPrivate(service, "queryMarketBySlug").mockResolvedValue(
      buildMarketBySlug({
        market: buildMarketRow({ id: "market-1", slug: "night-market" }),
        vendorCount: 2,
      }),
    );

    await expect(service.listMarkets({ limit: 5 })).resolves.toBe(marketResult);
    await expect(service.listAreas()).resolves.toEqual({
      areas: [{ city: "Taipei", districts: ["Central"] }],
    });
    await expect(
      service.getMarketBySlug("night-market"),
    ).resolves.toMatchObject({
      market: { id: "market-1", slug: "night-market" },
      vendorCount: 2,
    });

    expect(service["queryMarkets"]).toHaveBeenCalledWith(
      { limit: 5 },
      { publicReadyOnly: true },
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      'markets:v2:list:{"limit":5}',
      marketResult,
      expect.any(Number),
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "markets:v2:areas:all",
      { areas: [{ city: "Taipei", districts: ["Central"] }] },
      expect.any(Number),
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "markets:v2:detail:night-market",
      expect.objectContaining({
        market: expect.objectContaining({
          id: "market-1",
          slug: "night-market",
        }),
        vendorCount: 2,
      }),
      expect.any(Number),
    );
  });

  it("returns cached public area and vendor data without querying", async () => {
    const cachedAreas = { areas: [{ city: "Taipei", districts: ["Central"] }] };
    const cachedVendors = {
      vendors: [{ restaurantId: "restaurant-1", name: "Vendor" }],
      total: 1,
      page: 1,
      limit: 20,
    };
    mocks.cache.get
      .mockResolvedValueOnce(cachedAreas)
      .mockResolvedValueOnce(cachedVendors);
    const { service } = createService("7");
    const queryAreasSpy = spyOnPrivate(service, "queryAreas");
    const queryVendorsSpy = spyOnPrivate(service, "queryVendors");

    await expect(service.listAreas()).resolves.toBe(cachedAreas);
    await expect(
      service.listVendors("night-market", { q: "vendor" }),
    ).resolves.toBe(cachedVendors);

    expect(mocks.cache.get).toHaveBeenCalledWith("markets:v7:areas:all");
    expect(mocks.cache.get).toHaveBeenCalledWith(
      'markets:v7:vendors:{"q":"vendor","slug":"night-market"}',
    );
    expect(queryAreasSpy).not.toHaveBeenCalled();
    expect(queryVendorsSpy).not.toHaveBeenCalled();
  });

  it("aggregates market area readiness and sorts largest gaps first", async () => {
    const { service } = createService();
    spyOnPrivate(service, "queryMarkets").mockResolvedValue(
      buildQueriedMarkets([
        buildQueriedMarket({
          city: "Taipei",
          district: "Central",
          vendorCount: 2,
          catalogCoverage: {
            searchableProductCount: 3,
            publicServiceCount: 1,
            vendorsMissingSearchableProducts: 1,
            vendorsMissingPublicServices: 2,
          },
          publicReadiness: buildReadiness({ score: 80 }),
        }),
        buildQueriedMarket({
          city: "Taipei",
          district: "Central",
          vendorCount: 0,
          catalogCoverage: {
            searchableProductCount: 0,
            publicServiceCount: 0,
            vendorsMissingSearchableProducts: 1,
            vendorsMissingPublicServices: 0,
          },
          publicReadiness: buildReadiness({ score: 40 }),
        }),
        buildQueriedMarket({
          city: "Kaohsiung",
          district: "West",
          vendorCount: 1,
          catalogCoverage: {
            searchableProductCount: 1,
            publicServiceCount: 0,
            vendorsMissingSearchableProducts: 0,
            vendorsMissingPublicServices: 0,
          },
          publicReadiness: buildReadiness({ score: 90 }),
        }),
      ]),
    );

    await expect(service.listAreaReadiness(10)).resolves.toEqual({
      areas: [
        {
          city: "Taipei",
          district: "Central",
          marketCount: 2,
          vendorCount: 2,
          searchableProductCount: 3,
          publicServiceCount: 1,
          vendorsMissingSearchableProducts: 2,
          vendorsMissingPublicServices: 2,
          marketsWithoutVendors: 1,
          marketsWithoutSearchableCatalog: 1,
          totalCatalogGapVendors: 4,
          averageReadinessScore: 60,
        },
        {
          city: "Kaohsiung",
          district: "West",
          marketCount: 1,
          vendorCount: 1,
          searchableProductCount: 1,
          publicServiceCount: 0,
          vendorsMissingSearchableProducts: 0,
          vendorsMissingPublicServices: 0,
          marketsWithoutVendors: 0,
          marketsWithoutSearchableCatalog: 0,
          totalCatalogGapVendors: 0,
          averageReadinessScore: 90,
        },
      ],
    });
    expect(service["queryMarkets"]).toHaveBeenCalledWith(
      { limit: 10 },
      { includeVendorBreakdown: true },
    );
  });

  it("sorts tied area readiness by city and district when every score ties", async () => {
    const { service } = createService();
    spyOnPrivate(service, "queryMarkets").mockResolvedValue(
      buildQueriedMarkets([
        buildQueriedMarket({
          city: "Taipei",
          district: "West",
          vendorCount: 1,
          catalogCoverage: {
            searchableProductCount: 0,
            publicServiceCount: 1,
            vendorsMissingSearchableProducts: undefined,
            vendorsMissingPublicServices: undefined,
          },
          publicReadiness: buildReadiness({
            score: 0,
            ready: false,
            completedCount: 0,
          }),
        }),
        buildQueriedMarket({
          city: "Taipei",
          district: "East",
          vendorCount: 1,
          catalogCoverage: {
            searchableProductCount: 1,
            publicServiceCount: 0,
            vendorsMissingSearchableProducts: 0,
            vendorsMissingPublicServices: 0,
          },
          publicReadiness: buildReadiness({
            score: 0,
            ready: false,
            completedCount: 0,
          }),
        }),
        buildQueriedMarket({
          city: "Kaohsiung",
          district: "North",
          vendorCount: 1,
          catalogCoverage: {
            searchableProductCount: 1,
            publicServiceCount: 0,
            vendorsMissingSearchableProducts: 0,
            vendorsMissingPublicServices: 0,
          },
          publicReadiness: buildReadiness({
            score: 0,
            ready: false,
            completedCount: 0,
          }),
        }),
      ]),
    );

    await expect(service.listAreaReadiness()).resolves.toEqual({
      areas: [
        expect.objectContaining({
          city: "Kaohsiung",
          district: "North",
          totalCatalogGapVendors: 0,
          averageReadinessScore: 0,
        }),
        expect.objectContaining({
          city: "Taipei",
          district: "East",
          totalCatalogGapVendors: 0,
          averageReadinessScore: 0,
        }),
        expect.objectContaining({
          city: "Taipei",
          district: "West",
          totalCatalogGapVendors: 0,
          averageReadinessScore: 0,
        }),
      ],
    });
  });

  it("delegates admin and readiness helpers without public cache", async () => {
    const { service } = createService();
    spyOnPrivate(service, "queryMarkets").mockResolvedValue(marketResult);
    spyOnPrivate(
      service,
      "catalogCoverageWithVendorBreakdown",
    ).mockResolvedValue(
      buildFullCoverage({ searchableProductCount: 1, publicServiceCount: 2 }),
    );
    // `getMarketById` destructures its single-row select, so TypeScript infers
    // a non-nullable return and a `mockResolvedValue(null)` spy will not type.
    // Drive the missing-market branch through an empty fixture queue instead,
    // which is what the real read does when the id matches nothing.
    mockSelectResults({ markets: [[]] });

    await expect(service.listAdminReadiness({ city: "Taipei" })).resolves.toBe(
      marketResult,
    );
    await expect(
      service.getCatalogReadiness("market-1"),
    ).resolves.toMatchObject({
      searchableProductCount: 1,
      publicServiceCount: 2,
    });
    await expect(service.getPublicReadiness("missing")).resolves.toBeNull();

    expect(service["queryMarkets"]).toHaveBeenCalledWith(
      { city: "Taipei" },
      { includeVendorBreakdown: true },
    );
    expect(mocks.cache.get).not.toHaveBeenCalled();
  });

  it("computes public readiness for an existing market", async () => {
    const { service } = createService();
    vi.spyOn(service, "getMarketById").mockResolvedValue(
      buildMarketRow({
        id: "market-1",
        description: "Night market",
        city: "Taipei",
        district: "Central",
        address: "Main Street",
        latitude: 25,
        longitude: 121,
        openingHours: {
          monday: { open: "10:00", close: "22:00", closed: false },
        },
        bannerUrl: "https://example.test/banner.jpg",
        logoUrl: null,
        imageUrls: [],
        mapLayout: { title: "Map" },
      }),
    );
    spyOnPrivate(service, "countCatalogCoverage").mockResolvedValue({
      searchableProductCount: 4,
      publicServiceCount: 1,
    });
    mockSelectResults({ restaurantMarketMemberships: [[{ count: 2 }]] });

    await expect(
      service.getPublicReadiness("market-1", { additionalVendorCount: 1 }),
    ).resolves.toMatchObject({
      ready: true,
      completedCount: 8,
      totalCount: 8,
      issues: [],
    });
    expect(service["countCatalogCoverage"]).toHaveBeenCalledWith("market-1");
  });

  it("builds catalog readiness gaps for empty and mixed vendor coverage", async () => {
    const { service } = createService();
    spyOnPrivate(service, "countCatalogCoverage")
      .mockResolvedValueOnce({
        searchableProductCount: 0,
        publicServiceCount: 0,
        bookingRequiredServiceCount: 0,
        bookingUrlMissingServiceCount: 0,
      })
      .mockResolvedValueOnce({
        searchableProductCount: 5,
        publicServiceCount: 2,
        bookingRequiredServiceCount: 1,
        bookingUrlMissingServiceCount: 1,
      });

    mockSelectResults({ restaurantMarketMemberships: [[]] });
    await expect(
      service["catalogCoverageWithVendorBreakdown"]("empty-market"),
    ).resolves.toMatchObject({
      vendorsWithSearchableProducts: 0,
      vendorsMissingSearchableProducts: 0,
      missingProductVendors: [],
      missingSearchEntrypointVendors: [],
    });

    service["d1"] = createD1(
      [],
      [[{ restaurantId: "restaurant-2" }], [{ restaurantId: "restaurant-3" }]],
    );
    mockSelectResults({
      restaurantMarketMemberships: [
        [
          {
            restaurantId: "restaurant-1",
            name: "Vendor A",
            stallNumber: "A1",
            locationLabel: "Gate",
            mapPosition: { x: 1, y: 2 },
          },
          {
            restaurantId: "restaurant-2",
            name: "Vendor B",
            stallNumber: " ",
            locationLabel: null,
            mapPosition: null,
          },
          {
            restaurantId: "restaurant-3",
            name: "Vendor C",
            stallNumber: "C1",
            locationLabel: "Lane",
            mapPosition: { x: "bad" },
          },
        ],
      ],
      dishSearchIndex: [[{ restaurantId: "restaurant-1" }]],
    });

    await expect(
      service["catalogCoverageWithVendorBreakdown"]("market-1"),
    ).resolves.toMatchObject({
      searchableProductCount: 5,
      publicServiceCount: 2,
      vendorsWithSearchableProducts: 1,
      vendorsMissingSearchableProducts: 2,
      vendorsWithPublicServices: 1,
      vendorsMissingPublicServices: 2,
      vendorsMissingBookingUrls: 1,
      vendorsMissingStallNumbers: 1,
      vendorsMissingMapPositions: 2,
      vendorsMissingSearchEntrypoints: 1,
      missingProductVendors: [
        expect.objectContaining({ restaurantId: "restaurant-2" }),
        expect.objectContaining({ restaurantId: "restaurant-3" }),
      ],
      missingBookingUrlVendors: [
        expect.objectContaining({ restaurantId: "restaurant-3" }),
      ],
      missingSearchEntrypointVendors: [
        expect.objectContaining({ restaurantId: "restaurant-3" }),
      ],
    });
  });

  it("returns null vendors for missing or not-public-ready markets", async () => {
    mocks.cache.get.mockResolvedValue(null);
    const { service } = createService();
    vi.spyOn(service, "getMarketBySlug")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        buildMarketBySlug({
          market: buildMarketRow({ id: "market-1" }),
          publicReadiness: buildReadiness({ ready: false }),
        }),
      );

    await expect(service.listVendors("missing", {})).resolves.toBeNull();
    await expect(service.listVendors("draft-market", {})).resolves.toBeNull();
    expect(mocks.cache.set).not.toHaveBeenCalled();
  });

  it("builds stable public cache keys and bumps numeric versions", async () => {
    const { service, values } = createService("9");

    await expect(
      service["publicCacheKey"]("list", {
        z: 1,
        a: { b: 2, a: 1 },
        skipped: undefined,
      }),
    ).resolves.toBe('markets:v9:list:{"a":{"a":1,"b":2},"z":1}');

    await service["bumpPublicCacheVersion"]();

    expect(values.get("markets:version")).toBe("10");
  });

  it("handles default and non-numeric public cache versions", async () => {
    const serviceWithoutKV = new MarketsService({} as D1Database);

    await expect(
      serviceWithoutKV["publicCacheKey"]("areas", null),
    ).resolves.toBe("markets:v1:areas:null");
    await expect(
      serviceWithoutKV["bumpPublicCacheVersion"](),
    ).resolves.toBeUndefined();

    const { service, values } = createService("invalid");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_785_456_000_000);

    await service["bumpPublicCacheVersion"]();

    expect(values.get("markets:version")).toBe("1785456000000");
    nowSpy.mockRestore();
  });

  it("maps uncached market list rows with catalog coverage and public readiness", async () => {
    mocks.cache.get.mockResolvedValue(null);
    const { service, values } = createService("3");
    service["d1"] = createD1([
      { count: 2 },
      {
        booking_required_service_count: 1,
        booking_url_missing_service_count: 1,
      },
    ]);
    mockSelectResults({
      markets: [
        [
          {
            id: "market-1",
            slug: "night-market",
            name: "Night Market",
            type: "night_market",
            description: "Food stalls",
            city: "Taipei",
            district: "Central",
            address: "Main road",
            latitude: 25,
            longitude: 121,
            boundaryGeojson: null,
            openingHours: null,
            mapLayout: null,
            bannerUrl: null,
            logoUrl: null,
            imageUrls: [],
            tags: ["food"],
            updatedAt: new Date("2026-06-07T00:00:00.000Z"),
            vendorCount: 3,
          },
        ],
        [{ count: 1 }],
      ],
      dishSearchIndex: [[{ count: 4 }]],
    });

    await expect(
      service.listMarkets({ city: "Taipei", limit: 5 }),
    ).resolves.toMatchObject({
      total: 1,
      page: 1,
      limit: 5,
      markets: [
        {
          id: "market-1",
          vendorCount: 3,
          catalogCoverage: {
            searchableProductCount: 4,
            publicServiceCount: 2,
            bookingRequiredServiceCount: 1,
            bookingUrlMissingServiceCount: 1,
          },
          publicReadiness: expect.objectContaining({
            ready: expect.any(Boolean),
            score: expect.any(Number),
          }),
        },
      ],
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      'markets:v3:list:{"city":"Taipei","limit":5}',
      expect.objectContaining({ total: 1 }),
      expect.any(Number),
    );
    expect(values.get("markets:version")).toBe("3");
  });

  it("builds market detail exploration facets and readiness on cache misses", async () => {
    mocks.cache.get.mockResolvedValue(null);
    const { service } = createService("4");
    service["d1"] = createD1([
      { count: 1 },
      {
        booking_required_service_count: 2,
        booking_url_missing_service_count: 0,
      },
    ]);
    const market = {
      id: "market-1",
      slug: "night-market",
      name: "Night Market",
      type: "night_market",
      city: "Taipei",
      district: "Central",
      isActive: true,
      deletedAt: null,
    };
    mockSelectResults({
      markets: [[market]],
      restaurantMarketMemberships: [[{ count: 2 }]],
      dishSearchIndex: [
        [{ count: 3 }],
        [{ categoryName: "Rice", count: 2 }],
        [{ categoryName: "Sauce", count: 1 }],
      ],
      restaurantServiceItems: [[{ serviceType: "booking", count: 4 }]],
    });

    await expect(
      service.getMarketBySlug("night-market"),
    ).resolves.toMatchObject({
      market,
      vendorCount: 2,
      catalogCoverage: {
        searchableProductCount: 3,
        publicServiceCount: 1,
      },
      explorationSummary: {
        dishSearchUrl: "/api/v1/discovery/search?marketSlug=night-market",
        menuItemCategories: [
          {
            categoryName: "Rice",
            catalogType: "menu_item",
            searchUrl:
              "/api/v1/discovery/search?marketSlug=night-market&catalogType=menu_item&categoryName=Rice",
          },
        ],
        productCategories: [
          {
            categoryName: "Sauce",
            catalogType: "product",
          },
        ],
        serviceTypes: [
          {
            serviceType: "booking",
            searchUrl:
              "/api/v1/discovery/services?marketSlug=night-market&serviceType=booking",
          },
        ],
      },
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "markets:v4:detail:night-market",
      expect.objectContaining({ vendorCount: 2 }),
      expect.any(Number),
    );
  });

  it("does not cache missing market detail lookups", async () => {
    mocks.cache.get.mockResolvedValue(null);
    const { service } = createService("8");
    mockSelectResults({ markets: [[]] });

    await expect(service.getMarketBySlug("missing-market")).resolves.toBeNull();

    expect(mocks.cache.get).toHaveBeenCalledWith(
      "markets:v8:detail:missing-market",
    );
    expect(mocks.cache.set).not.toHaveBeenCalled();
  });

  it("maps filtered admin market queries with vendor breakdown coverage", async () => {
    const { service } = createService();
    const coverage = buildFullCoverage({
      searchableProductCount: 2,
      publicServiceCount: 3,
      vendorsWithSearchableProducts: 1,
      vendorsMissingSearchableProducts: 0,
    });
    spyOnPrivate(
      service,
      "catalogCoverageWithVendorBreakdown",
    ).mockResolvedValue(coverage);
    mockSelectResults({
      markets: [
        [
          {
            id: "market-1",
            slug: "filtered-market",
            name: "Filtered Market",
            type: "night_market",
            description: "Food",
            city: "Taipei",
            district: "Central",
            address: "Main road",
            latitude: 25,
            longitude: 121,
            openingHours: {
              monday: { open: "10:00", close: "22:00", closed: false },
            },
            vendorCount: "4",
          },
        ],
        [{ count: "1" }],
      ],
    });

    await expect(
      service["queryMarkets"](
        {
          q: "rice",
          district: "Central",
          type: "night_market",
          page: 2,
          limit: 10,
        },
        { includeVendorBreakdown: true },
      ),
    ).resolves.toMatchObject({
      total: 1,
      page: 2,
      limit: 10,
      markets: [
        {
          id: "market-1",
          vendorCount: 4,
          catalogCoverage: coverage,
          publicReadiness: expect.objectContaining({
            score: expect.any(Number),
          }),
        },
      ],
    });
    expect(service["catalogCoverageWithVendorBreakdown"]).toHaveBeenCalledWith(
      "market-1",
    );
  });

  it("lists vendors with open and distance filters plus menu/service access counts", async () => {
    mocks.cache.get.mockResolvedValue(null);
    const { service } = createService("5");
    vi.spyOn(service, "getMarketBySlug").mockResolvedValue(
      buildMarketBySlug({ market: buildMarketRow({ id: "market-1" }) }),
    );
    mockSelectResults({
      restaurantMarketMemberships: [
        [
          {
            restaurantId: "restaurant-1",
            name: "Vendor A",
            type: "malaysian",
            category: "casual",
            district: "Central",
            city: "Taipei",
            latitude: 25,
            longitude: 121,
            priceRange: 2,
            rating: 4.8,
            businessHours: {
              sunday: { open: "00:00", close: "23:59", closed: false },
              monday: { open: "00:00", close: "23:59", closed: false },
              tuesday: { open: "00:00", close: "23:59", closed: false },
              wednesday: { open: "00:00", close: "23:59", closed: false },
              thursday: { open: "00:00", close: "23:59", closed: false },
              friday: { open: "00:00", close: "23:59", closed: false },
              saturday: { open: "00:00", close: "23:59", closed: false },
            },
            marketHours: null,
            supportsTakeaway: true,
            supportsDelivery: false,
            imageUrl: null,
            stallNumber: "A1",
            locationLabel: "Gate",
            mapPosition: { x: 1, y: 2 },
            isPrimary: true,
          },
        ],
        [{ count: 1 }],
      ],
      menuItems: [[{ restaurantId: "restaurant-1", count: 5 }]],
      restaurantServiceItems: [[{ restaurantId: "restaurant-1", count: 2 }]],
    });

    await expect(
      service.listVendors("night-market", {
        lat: 25,
        lng: 121,
        radiusKm: 2,
        sortBy: "distance",
        openNow: true,
      }),
    ).resolves.toMatchObject({
      total: 1,
      vendors: [
        {
          restaurantId: "restaurant-1",
          isOpen: true,
          distanceKm: 0,
          detailUrl: "/api/v1/restaurants/restaurant-1",
          menuUrl: "/api/v1/menu/restaurant-1",
          serviceItemsUrl: "/api/v1/restaurants/restaurant-1/service-items",
          availableMenuItemCount: 5,
          publicServiceItemCount: 2,
        },
      ],
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      expect.stringContaining("markets:v5:vendors:"),
      expect.objectContaining({ total: 1 }),
      expect.any(Number),
    );
  });

  it("lists vendors with keyword, capability filters, rating order, and default access counts", async () => {
    mocks.cache.get.mockResolvedValue(null);
    const { service } = createService("11");
    vi.spyOn(service, "getMarketBySlug").mockResolvedValue(
      buildMarketBySlug({ market: buildMarketRow({ id: "market-1" }) }),
    );
    mockSelectResults({
      restaurantMarketMemberships: [
        [
          {
            restaurantId: "restaurant-1",
            name: "Vendor A",
            type: "malaysian",
            category: "casual",
            district: "Central",
            city: "Taipei",
            latitude: null,
            longitude: null,
            priceRange: 2,
            rating: 4.8,
            businessHours: null,
            marketHours: null,
            supportsTakeaway: true,
            supportsDelivery: true,
            imageUrl: null,
            stallNumber: "A1",
            locationLabel: "Gate",
            mapPosition: null,
            isPrimary: false,
          },
        ],
        [{ count: "3" }],
      ],
      menuItems: [[]],
      restaurantServiceItems: [[]],
    });

    await expect(
      service.listVendors("night-market", {
        q: "Vendor",
        takeaway: true,
        delivery: true,
        sortBy: "rating",
        page: 2,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      total: 3,
      page: 2,
      limit: 1,
      vendors: [
        {
          restaurantId: "restaurant-1",
          isOpen: false,
          effectiveBusinessHours: null,
          availableMenuItemCount: 0,
          publicServiceItemCount: 0,
        },
      ],
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      expect.stringContaining("markets:v11:vendors:"),
      expect.objectContaining({ total: 3 }),
      expect.any(Number),
    );
  });

  it("returns empty vendor access lists without running count queries", async () => {
    const { service } = createService();

    await expect(service["withVendorAccess"]([])).resolves.toEqual([]);

    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("creates, updates, soft-deletes markets and manages vendor membership cache versions", async () => {
    const { service, values } = createService("10");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const mutations = mockMutationResults({
      markets: {
        insert: [[{ id: "market-1", slug: "created" }]],
        // updateMarket reads its row back; softDeleteMarket does not.
        update: [[{ id: "market-1", name: "Updated" }], { changes: 1 }],
      },
      restaurantMarketMemberships: {
        insert: [
          [{ id: 1, marketId: "market-1", restaurantId: "restaurant-1" }],
        ],
        update: [
          { changes: 1 }, // addVendor(isPrimary) clears the previous primary
          [{ id: 1, leftAt: new Date("2026-06-07T00:00:00.000Z") }],
        ],
      },
    });
    mockSelectResults({
      markets: [
        [{ id: "market-1", deletedAt: null }],
        [{ id: "market-1", deletedAt: null }],
        [{ id: "market-1", deletedAt: null }],
      ],
      restaurantMarketMemberships: [[], []],
      restaurants: [[{ id: "restaurant-1", settings: { currency: "TWD" } }]],
    });

    await expect(
      service.createMarket({
        id: "market-1",
        slug: "created",
        name: "Created",
        type: "night_market",
        city: "台中市",
        district: "西屯區",
        address: "文華路",
        latitude: 24.1,
        longitude: 120.6,
      }),
    ).resolves.toEqual({ id: "market-1", slug: "created" });
    await expect(
      service.updateMarket("market-1", { name: "Updated" }),
    ).resolves.toEqual({ id: "market-1", name: "Updated" });
    await expect(service.softDeleteMarket("market-1")).resolves.toBe(true);
    await expect(
      service.addVendor("market-1", {
        restaurantId: "restaurant-1",
        stallNumber: "A1",
        isPrimary: true,
      }),
    ).resolves.toMatchObject({
      id: 1,
      marketId: "market-1",
      restaurantId: "restaurant-1",
    });
    await expect(
      service.removeVendor("market-1", "restaurant-1"),
    ).resolves.toBe(true);

    expect(mutations.inserted[0]).toMatchObject({
      id: "market-1",
      isActive: true,
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    expect(mutations.updated).toEqual([
      expect.objectContaining({ name: "Updated" }),
      expect.objectContaining({ isActive: false }),
      { isPrimary: false },
      expect.objectContaining({ leftAt: expect.any(Date) }),
    ]);
    expect(values.get("markets:version")).toBe("15");
    vi.useRealTimers();
  });

  it("refuses mismatched vendor currencies before changing memberships", async () => {
    const { service } = createService();
    mockSelectResults({
      markets: [[{ id: "market-1", deletedAt: null }]],
      restaurantMarketMemberships: [[], [{ restaurantId: "peer" }]],
      restaurants: [
        [
          { id: "restaurant-1", settings: { currency: "MYR" } },
          { id: "peer", settings: { currency: "TWD" } },
        ],
      ],
    });
    await expect(
      service.addVendor("market-1", {
        restaurantId: "restaurant-1",
        isPrimary: true,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "MARKET_VENDOR_CURRENCY_MISMATCH",
      details: { currencies: ["MYR", "TWD"] },
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it.each(["TWD", "MYR"])(
    "enforces D1's parameter budget and compares currencies across batches (%s)",
    async (lastPeerCurrency) => {
      const { service } = createService();
      const peers = Array.from({ length: 100 }, (_, index) => ({
        restaurantId: `peer-${index}`,
      }));
      const fixtureDb = createSelectFixtureDb(fixtureTables, {
        markets: [[{ id: "market-1", deletedAt: null }]],
        restaurantMarketMemberships: [[], peers],
        restaurants: [
          [
            "candidate",
            ...peers.slice(0, 99).map((peer) => peer.restaurantId),
          ].map((id) => ({ id, settings: { currency: "TWD" } })),
          [
            {
              id: peers[99].restaurantId,
              settings: { currency: lastPeerCurrency },
            },
          ],
        ],
      });
      // Model the production D1 binding limit, including when the local emulator
      // accepts a larger SQLite limit. All queries still use the real resolver.
      const dialect = new SQLiteSyncDialect();
      mocks.db.select.mockImplementation((...args: unknown[]) => {
        const builder = fixtureDb.select(...args);
        const where = builder.where;
        builder.where = (condition: SQL) => {
          if (dialect.sqlToQuery(condition).params.length > 100) {
            throw new Error("D1_ERROR: too many SQL variables");
          }
          return where(condition);
        };
        return builder;
      });
      mockMutationResults({
        restaurantMarketMemberships: {
          insert: [
            [{ id: 101, restaurantId: "candidate", marketId: "market-1" }],
          ],
        },
      });
      const result = service.addVendor("market-1", {
        restaurantId: "candidate",
      });
      if (lastPeerCurrency === "TWD") {
        await expect(result).resolves.toMatchObject({
          id: 101,
          restaurantId: "candidate",
        });
      } else {
        await expect(result).rejects.toMatchObject({
          status: 409,
          code: "MARKET_VENDOR_CURRENCY_MISMATCH",
          details: { currencies: ["MYR", "TWD"] },
        });
        expect(mocks.db.insert).not.toHaveBeenCalled();
      }
    },
  );

  it("propagates invalid vendor configuration instead of disguising it as a mismatch", async () => {
    const { service } = createService();
    mockSelectResults({
      markets: [[{ id: "market-1", deletedAt: null }]],
      restaurantMarketMemberships: [[], []],
      restaurants: [
        [{ id: "restaurant-1", settings: { currency: "INVALID" } }],
      ],
    });
    await expect(
      service.addVendor("market-1", { restaurantId: "restaurant-1" }),
    ).rejects.toMatchObject({
      status: 500,
      code: "RESTAURANT_CURRENCY_INVALID",
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("reports an atomic guard refusal without clearing a previous primary membership", async () => {
    const { service } = createService();
    mockSelectResults({
      markets: [[{ id: "market-1", deletedAt: null }]],
      restaurantMarketMemberships: [[], []],
      restaurants: [[{ id: "restaurant-1", settings: { currency: "TWD" } }]],
    });
    mockMutationResults({ restaurantMarketMemberships: { insert: [[]] } });
    await expect(
      service.addVendor("market-1", {
        restaurantId: "restaurant-1",
        isPrimary: true,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "MARKET_VENDOR_CURRENCY_MISMATCH",
    });
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("updates existing vendor memberships with existing values as fallbacks", async () => {
    const { service, values } = createService("30");
    const existingMembership = {
      id: 9,
      marketId: "market-1",
      restaurantId: "restaurant-1",
      stallNumber: "B2",
      locationLabel: "Corner",
      mapPosition: { x: 1, y: 2 },
      marketHours: { monday: { open: "09:00", close: "17:00" } },
      isPrimary: true,
    };
    // No returned row: addVendor falls back to the membership it read.
    const mutations = mockMutationResults({
      restaurantMarketMemberships: { update: [[]] },
    });
    mockSelectResults({
      markets: [[{ id: "market-1", deletedAt: null }]],
      restaurantMarketMemberships: [[existingMembership]],
    });

    await expect(
      service.addVendor("market-1", {
        restaurantId: "restaurant-1",
      }),
    ).resolves.toEqual(existingMembership);

    expect(mutations.updated).toEqual([
      {
        stallNumber: "B2",
        locationLabel: "Corner",
        mapPosition: { x: 1, y: 2 },
        marketHours: { monday: { open: "09:00", close: "17:00" } },
        isPrimary: true,
      },
    ]);
    expect(values.get("markets:version")).toBe("31");
  });

  it("updates existing vendor memberships with explicit nullable fields", async () => {
    const { service, values } = createService("32");
    const existingMembership = {
      id: 10,
      marketId: "market-1",
      restaurantId: "restaurant-1",
      stallNumber: "B2",
      locationLabel: "Corner",
      mapPosition: { x: 1, y: 2 },
      marketHours: { monday: { open: "09:00", close: "17:00" } },
      isPrimary: true,
    };
    const updatedMembership = {
      ...existingMembership,
      stallNumber: null,
      locationLabel: null,
      mapPosition: null,
      marketHours: null,
      isPrimary: false,
    };
    const mutations = mockMutationResults({
      restaurantMarketMemberships: { update: [[updatedMembership]] },
    });
    mockSelectResults({
      markets: [[{ id: "market-1", deletedAt: null }]],
      restaurantMarketMemberships: [[existingMembership]],
    });

    await expect(
      service.addVendor("market-1", {
        restaurantId: "restaurant-1",
        stallNumber: null,
        locationLabel: null,
        mapPosition: null,
        marketHours: null,
        isPrimary: false,
      }),
    ).resolves.toEqual(updatedMembership);

    expect(mutations.updated).toEqual([
      {
        stallNumber: null,
        locationLabel: null,
        mapPosition: null,
        marketHours: null,
        isPrimary: false,
      },
    ]);
    expect(values.get("markets:version")).toBe("33");
  });

  it("handles missing vendor membership targets and insert defaults", async () => {
    const { service, values } = createService("40");
    const mutations = mockMutationResults({
      restaurantMarketMemberships: {
        insert: [
          [{ id: 12, marketId: "market-1", restaurantId: "restaurant-2" }],
        ],
        update: [[]], // removeVendor matches no live membership
      },
    });
    mockSelectResults({
      markets: [
        [],
        [{ id: "deleted-market", deletedAt: new Date("2026-06-07T00:00:00Z") }],
        [{ id: "market-1", deletedAt: null }],
      ],
      restaurantMarketMemberships: [[], []],
      restaurants: [[{ id: "restaurant-2", settings: { currency: "TWD" } }]],
    });

    await expect(
      service.addVendor("missing-market", {
        restaurantId: "restaurant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      service.addVendor("deleted-market", {
        restaurantId: "restaurant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      service.addVendor("market-1", {
        restaurantId: "restaurant-2",
      }),
    ).resolves.toEqual({
      id: 12,
      marketId: "market-1",
      restaurantId: "restaurant-2",
    });
    await expect(
      service.removeVendor("market-1", "restaurant-3"),
    ).resolves.toBe(false);

    expect(mutations.updated).toEqual([
      expect.objectContaining({ leftAt: expect.any(Date) }),
    ]);
    expect(values.get("markets:version")).toBe("41");
  });

  it("lists sitemap entries, uncached areas, nearby markets, and direct market lookup", async () => {
    mocks.cache.get.mockResolvedValue(null);
    const { service } = createService("6");
    service["d1"] = createD1([
      { count: 1 },
      {
        booking_required_service_count: 0,
        booking_url_missing_service_count: 0,
      },
    ]);
    const market = {
      id: "market-1",
      slug: "night-market",
      name: "Night Market",
      city: "Taipei",
      district: "Central",
      latitude: 25,
      longitude: 121,
      updatedAt: new Date("2026-06-07T00:00:00.000Z"),
    };
    mockSelectResults({
      markets: [
        [{ slug: "night-market", updatedAt: market.updatedAt }],
        [
          { city: "Taipei", district: "Central" },
          { city: "Taipei", district: "East" },
          { city: "Kaohsiung", district: "West" },
        ],
        [market],
        [market],
      ],
      dishSearchIndex: [[{ count: 2 }]],
    });

    await expect(service.listSitemapEntries(3)).resolves.toEqual([
      { slug: "night-market", updatedAt: market.updatedAt },
    ]);
    await expect(service.listAreas()).resolves.toEqual({
      areas: [
        { city: "Taipei", districts: ["Central", "East"] },
        { city: "Kaohsiung", districts: ["West"] },
      ],
    });
    await expect(service.findNearby(25, 121, 1, 5)).resolves.toEqual({
      markets: [
        expect.objectContaining({
          id: "market-1",
          distanceKm: 0,
          catalogCoverage: expect.objectContaining({
            searchableProductCount: 2,
            publicServiceCount: 1,
          }),
        }),
      ],
    });
    await expect(service.getMarketById("market-1")).resolves.toEqual(market);

    expect(mocks.cache.set).toHaveBeenCalledWith(
      "markets:v6:areas:all",
      expect.objectContaining({ areas: expect.any(Array) }),
      expect.any(Number),
    );
  });

  it("maps restaurant memberships, restaurant join requests, admin requests, and vendor candidates", async () => {
    const { service } = createService();
    mockSelectResults({
      restaurantMarketMemberships: [
        [
          {
            id: 1,
            restaurantId: "restaurant-1",
            marketId: "market-1",
            stallNumber: "A1",
            locationLabel: "Gate",
            mapPosition: { x: 1, y: 2 },
            marketHours: { monday: { open: "10:00", close: "18:00" } },
            isPrimary: true,
            joinedAt: new Date("2026-06-07T00:00:00.000Z"),
            marketSlug: "night-market",
            marketName: "Night Market",
            marketType: "night_market",
            city: "Taipei",
            district: "Central",
          },
        ],
      ],
      marketJoinRequests: [
        [
          {
            id: 2,
            restaurantId: "restaurant-1",
            marketId: "market-1",
            status: "pending",
            message: "Please add us",
            requestedAt: new Date("2026-06-07T00:00:00.000Z"),
            resolvedAt: null,
            marketSlug: "night-market",
            marketName: "Night Market",
            marketType: "night_market",
            city: "Taipei",
            district: "Central",
          },
        ],
        [
          {
            id: 3,
            restaurantId: "restaurant-1",
            marketId: "market-1",
            status: "approved",
            message: null,
            requestedAt: new Date("2026-06-07T00:00:00.000Z"),
            resolvedAt: new Date("2026-06-08T00:00:00.000Z"),
            marketSlug: "night-market",
            marketName: "Night Market",
            marketType: "night_market",
            city: "Taipei",
            district: "Central",
            restaurantName: "Makan",
            restaurantDistrict: "Central",
            restaurantCity: "Taipei",
          },
        ],
      ],
      restaurants: [
        [
          {
            id: "restaurant-2",
            name: "Candidate",
            city: "Taipei",
            district: "East",
            address: "Street",
            type: "malaysian",
            category: "casual",
            isAvailable: true,
            supportsTakeaway: true,
            supportsDelivery: false,
          },
        ],
      ],
    });

    await expect(
      service.listRestaurantMemberships("restaurant-1"),
    ).resolves.toEqual({
      memberships: [
        expect.objectContaining({
          id: 1,
          market: expect.objectContaining({
            id: "market-1",
            slug: "night-market",
          }),
        }),
      ],
    });
    await expect(
      service.listRestaurantJoinRequests("restaurant-1"),
    ).resolves.toEqual({
      requests: [
        expect.objectContaining({
          id: 2,
          market: expect.objectContaining({ name: "Night Market" }),
        }),
      ],
    });
    await expect(
      service.listJoinRequests({ status: "approved" }),
    ).resolves.toEqual({
      requests: [
        expect.objectContaining({
          id: 3,
          restaurant: {
            id: "restaurant-1",
            name: "Makan",
            city: "Taipei",
            district: "Central",
          },
        }),
      ],
    });
    await expect(
      service.listVendorCandidates({
        q: "candidate",
        marketId: "market-1",
        limit: 5,
      }),
    ).resolves.toEqual({
      restaurants: [expect.objectContaining({ id: "restaurant-2" })],
      total: 1,
    });
  });

  it("lists admin requests and vendor candidates with default filters", async () => {
    const { service } = createService();
    mockSelectResults({
      marketJoinRequests: [
        [
          {
            id: 4,
            restaurantId: "restaurant-3",
            marketId: "market-2",
            status: "pending",
            message: "Interested",
            requestedAt: new Date("2026-06-07T00:00:00.000Z"),
            resolvedAt: null,
            marketSlug: "morning-market",
            marketName: "Morning Market",
            marketType: "traditional_market",
            city: "Kaohsiung",
            district: "North",
            restaurantName: "Candidate",
            restaurantDistrict: "North",
            restaurantCity: "Kaohsiung",
          },
        ],
      ],
      restaurants: [
        [
          {
            id: "restaurant-4",
            name: "Default Candidate",
            city: "Kaohsiung",
            district: "North",
            address: "Market Road",
            type: "taiwanese",
            category: "casual",
            isAvailable: true,
            supportsTakeaway: false,
            supportsDelivery: true,
          },
        ],
      ],
    });

    await expect(service.listJoinRequests()).resolves.toEqual({
      requests: [
        expect.objectContaining({
          id: 4,
          status: "pending",
          market: expect.objectContaining({ slug: "morning-market" }),
        }),
      ],
    });
    await expect(service.listVendorCandidates({ q: "   " })).resolves.toEqual({
      restaurants: [expect.objectContaining({ id: "restaurant-4" })],
      total: 1,
    });
  });

  it("handles join request creation states and approval/rejection branches", async () => {
    const { service, values } = createService("20");
    const market = {
      id: "market-1",
      slug: "night-market",
      isActive: true,
      deletedAt: null,
    };

    mockSelectResults({
      markets: [[market]],
      restaurantMarketMemberships: [[{ id: 10 }]],
    });
    await expect(
      service.createJoinRequest("restaurant-1", {
        marketSlug: "night-market",
      }),
    ).resolves.toEqual({ status: "already_member" });

    mockSelectResults({
      markets: [[market]],
      restaurantMarketMemberships: [[]],
      marketJoinRequests: [[{ id: 11 }]],
    });
    await expect(
      service.createJoinRequest("restaurant-1", {
        marketId: "market-1",
      }),
    ).resolves.toEqual({ status: "already_pending" });

    mockSelectResults({
      markets: [[market]],
      restaurantMarketMemberships: [[]],
      marketJoinRequests: [[]],
    });
    mockMutationResults({
      marketJoinRequests: { insert: [[{ id: 12, status: "pending" }]] },
    });
    await expect(
      service.createJoinRequest("restaurant-1", {
        marketId: "market-1",
        message: "Please add us",
      }),
    ).resolves.toEqual({
      status: "created",
      request: { id: 12, status: "pending" },
    });

    mockSelectResults({ marketJoinRequests: [[]] });
    await expect(service.approveJoinRequest(99)).resolves.toEqual({
      status: "not_found",
    });

    mockSelectResults({
      marketJoinRequests: [[{ id: 2, status: "approved" }]],
    });
    await expect(service.rejectJoinRequest(2)).resolves.toEqual({
      status: "not_pending",
    });

    mockSelectResults({
      marketJoinRequests: [
        [
          {
            id: 3,
            status: "pending",
            marketId: "market-1",
            restaurantId: "restaurant-1",
          },
        ],
      ],
      markets: [[market]],
      restaurantMarketMemberships: [[], []],
      restaurants: [[{ id: "restaurant-1", settings: { currency: "TWD" } }]],
    });
    mockMutationResults({
      restaurantMarketMemberships: {
        insert: [
          [{ id: 1, marketId: "market-1", restaurantId: "restaurant-1" }],
        ],
        update: [{ changes: 1 }], // isPrimary clears the previous primary
      },
      marketJoinRequests: { update: [[{ id: 3, status: "approved" }]] },
    });
    await expect(
      service.approveJoinRequest(3, { stallNumber: "A1", isPrimary: true }),
    ).resolves.toMatchObject({
      status: "approved",
      request: { id: 3, status: "approved" },
      membership: { id: 1 },
    });

    mockSelectResults({
      marketJoinRequests: [[{ id: 4, status: "pending" }]],
    });
    mockMutationResults({
      marketJoinRequests: { update: [[{ id: 4, status: "rejected" }]] },
    });
    await expect(service.rejectJoinRequest(4)).resolves.toEqual({
      status: "rejected",
      request: { id: 4, status: "rejected" },
    });
    expect(Number(values.get("markets:version"))).toBeGreaterThan(20);
  });

  it("reports join request not-found and market-not-found approval states", async () => {
    const { service } = createService();

    mockSelectResults({ marketJoinRequests: [[]] });
    await expect(service.rejectJoinRequest(404)).resolves.toEqual({
      status: "not_found",
    });

    vi.spyOn(service, "addVendor").mockResolvedValueOnce(null);
    mockSelectResults({
      marketJoinRequests: [
        [
          {
            id: 5,
            status: "pending",
            marketId: "missing-market",
            restaurantId: "restaurant-1",
          },
        ],
      ],
    });

    await expect(service.approveJoinRequest(5)).resolves.toEqual({
      status: "market_not_found",
    });
    expect(service.addVendor).toHaveBeenCalledWith("missing-market", {
      restaurantId: "restaurant-1",
      stallNumber: null,
      locationLabel: null,
      mapPosition: null,
      marketHours: null,
      isPrimary: false,
    });
  });

  it("routes select fixtures by table and reports missing fixtures", async () => {
    mockSelectResults({
      markets: [[{ id: "market-1" }]],
      restaurantMarketMemberships: [[{ id: 10 }]],
    });

    // Read in reverse declaration order: routing follows the table passed to
    // from(), not the execution order.
    await expect(
      mocks.db.select().from(restaurantMarketMemberships),
    ).resolves.toEqual([{ id: 10 }]);
    await expect(mocks.db.select().from(markets)).resolves.toEqual([
      { id: "market-1" },
    ]);
    await expect(mocks.db.select().from(markets)).rejects.toThrow(
      "No select fixtures remaining for markets",
    );
    // dishSearchIndex is a registered table but was not declared for this
    // call, so it reports missing rather than falling back to [].
    await expect(mocks.db.select().from(dishSearchIndex)).rejects.toThrow(
      "Missing select fixture for dishSearchIndex",
    );
    // systemAlerts is unrelated to MarketsService and is never registered in
    // fixtureTables at all, so it reports the generic <unknown table> name
    // instead of its own — distinct from the "registered but undeclared"
    // case above.
    await expect(mocks.db.select().from(systemAlerts)).rejects.toThrow(
      "Missing select fixture for <unknown table>",
    );
    // A query that never calls from() reports distinctly from either
    // missing-fixture case above.
    await expect(Promise.resolve(mocks.db.select())).rejects.toThrow(
      "Select fixture query never called from(table)",
    );
  });
});
