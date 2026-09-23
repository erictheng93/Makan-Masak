import { drizzle } from "drizzle-orm/d1";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { KVNamespace } from "@cloudflare/workers-types";
import {
  dishSearchIndex,
  marketJoinRequests,
  menuItems,
  markets,
  marketCurrencyMatches,
  marketVendorCurrencyMismatch,
  restaurantCurrencySql,
  restaurantMarketMemberships,
  restaurantServiceItems,
  restaurants,
} from "@makanmasak/database";
import {
  KVCacheService,
  NoopCacheService,
  type CacheService,
} from "../../../core/cache";
import { CACHE_TTL } from "../../../shared/constants";
import { isOpenNow } from "../../discovery/utils/isOpenNow";
import {
  boundingBoxFromCircle,
  distanceKm,
  pointInGeoJsonBoundary,
} from "./geo";
import { evaluateMarketPublicReadiness } from "../utils/publicReadiness";
import { generateUUID } from "@makanmasak/utils";
import { ApiError } from "../../../shared/utils/api-error";
import {
  resolveSharedRestaurantCurrency,
  sharedCurrency,
} from "../../../shared/utils/restaurant-currency";

const MARKET_CACHE_VERSION_KEY = "markets:version";
const OPEN_NOW_VENDOR_SCAN_LIMIT = 50000;
// The shared resolver binds one parameter per restaurant; D1 allows 100.
const CURRENCY_RESOLUTION_BATCH_SIZE = 100;

export interface MarketFilters {
  q?: string;
  city?: string;
  district?: string;
  type?: string;
  page?: number;
  limit?: number;
}

export interface VendorFilters {
  openNow?: boolean;
  takeaway?: boolean;
  delivery?: boolean;
  q?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sortBy?: "rating" | "popular" | "distance";
  page?: number;
  limit?: number;
}

export interface AdminJoinRequestFilters {
  status?: "pending" | "approved" | "rejected";
}

export interface AdminVendorCandidateFilters {
  q?: string;
  marketId?: string;
  limit?: number;
}

export interface MarketCatalogCoverage {
  searchableProductCount: number;
  publicServiceCount: number;
  bookingRequiredServiceCount?: number;
  bookingUrlMissingServiceCount?: number;
  vendorsWithSearchableProducts?: number;
  vendorsMissingSearchableProducts?: number;
  vendorsWithPublicServices?: number;
  vendorsMissingPublicServices?: number;
  vendorsMissingBookingUrls?: number;
  vendorsMissingStallNumbers?: number;
  vendorsMissingMapPositions?: number;
  vendorsMissingSearchEntrypoints?: number;
  missingProductVendors?: MarketCatalogGapVendor[];
  missingServiceVendors?: MarketCatalogGapVendor[];
  missingBookingUrlVendors?: MarketCatalogGapVendor[];
  missingStallNumberVendors?: MarketCatalogGapVendor[];
  missingMapPositionVendors?: MarketCatalogGapVendor[];
  missingSearchEntrypointVendors?: MarketCatalogGapVendor[];
}

export interface MarketCatalogGapVendor {
  restaurantId: string;
  name: string;
  stallNumber: string | null;
  locationLabel: string | null;
}

export interface MarketVendorMapPosition {
  x: number;
  y: number;
}

export interface MarketAreaReadinessSummary {
  city: string;
  district: string;
  marketCount: number;
  vendorCount: number;
  searchableProductCount: number;
  publicServiceCount: number;
  vendorsMissingSearchableProducts: number;
  vendorsMissingPublicServices: number;
  marketsWithoutVendors: number;
  marketsWithoutSearchableCatalog: number;
  totalCatalogGapVendors: number;
  averageReadinessScore: number;
}

export interface MarketExplorationSummary {
  dishSearchUrl: string;
  serviceSearchUrl: string;
  dishCategories: Array<{
    categoryName: string;
    catalogType: "menu_item" | "product";
    count: number;
    searchUrl: string;
  }>;
  menuItemCategories: Array<{
    categoryName: string;
    catalogType: "menu_item";
    count: number;
    searchUrl: string;
  }>;
  productCategories: Array<{
    categoryName: string;
    catalogType: "product";
    count: number;
    searchUrl: string;
  }>;
  serviceTypes: Array<{
    serviceType: string;
    count: number;
    searchUrl: string;
  }>;
}

export type CreateMarketInput = typeof markets.$inferInsert;
export type UpdateMarketInput = Partial<typeof markets.$inferInsert>;

function jsonBindValue(value: unknown) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export class MarketsService {
  private db;
  private d1: D1Database;
  private cache: CacheService;
  private kv?: KVNamespace;

  constructor(d1: D1Database, kv?: KVNamespace) {
    this.db = drizzle(d1);
    this.d1 = d1;
    this.kv = kv;
    this.cache = kv ? new KVCacheService(kv) : new NoopCacheService();
  }

  async listMarkets(filters: MarketFilters) {
    const cacheKey = await this.publicCacheKey("list", filters);
    const cached =
      await this.cache.get<Awaited<ReturnType<MarketsService["queryMarkets"]>>>(
        cacheKey,
      );
    if (cached) return cached;

    const data = await this.queryMarkets(filters, { publicReadyOnly: true });
    await this.cache.set(cacheKey, data, CACHE_TTL.SHORT);
    return data;
  }

  async listAdminReadiness(filters: MarketFilters) {
    const data = await this.queryMarkets(filters, {
      includeVendorBreakdown: true,
    });
    return data;
  }

  async getCatalogReadiness(marketId: string) {
    return this.catalogCoverageWithVendorBreakdown(marketId);
  }

  async getPublicReadiness(
    marketId: string,
    options: { additionalVendorCount?: number } = {},
  ) {
    const market = await this.getMarketById(marketId);
    if (!market) return null;

    const [{ count = 0 } = { count: 0 }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(restaurantMarketMemberships)
      .innerJoin(
        restaurants,
        eq(restaurantMarketMemberships.restaurantId, restaurants.id),
      )
      .where(
        and(
          eq(restaurantMarketMemberships.marketId, marketId),
          isNull(restaurantMarketMemberships.leftAt),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
        ),
      );
    const catalogCoverage = await this.countCatalogCoverage(marketId);

    return evaluateMarketPublicReadiness({
      ...market,
      vendorCount: Number(count) + (options.additionalVendorCount ?? 0),
      ...catalogCoverage,
    });
  }

  async listAreaReadiness(limit = 50000) {
    const data = await this.queryMarkets(
      { limit },
      { includeVendorBreakdown: true },
    );
    const summaries = new Map<string, MarketAreaReadinessSummary>();
    const readinessTotals = new Map<
      string,
      { scoreTotal: number; scoredMarkets: number }
    >();

    for (const market of data.markets) {
      const key = `${market.city}\u0000${market.district}`;
      const coverage = market.catalogCoverage;
      const summary =
        summaries.get(key) ??
        ({
          city: market.city,
          district: market.district,
          marketCount: 0,
          vendorCount: 0,
          searchableProductCount: 0,
          publicServiceCount: 0,
          vendorsMissingSearchableProducts: 0,
          vendorsMissingPublicServices: 0,
          marketsWithoutVendors: 0,
          marketsWithoutSearchableCatalog: 0,
          totalCatalogGapVendors: 0,
          averageReadinessScore: 0,
        } satisfies MarketAreaReadinessSummary);
      const readinessTotal = readinessTotals.get(key) ?? {
        scoreTotal: 0,
        scoredMarkets: 0,
      };

      summary.marketCount += 1;
      summary.vendorCount += market.vendorCount;
      summary.searchableProductCount += coverage.searchableProductCount;
      summary.publicServiceCount += coverage.publicServiceCount;
      if (market.vendorCount === 0) {
        summary.marketsWithoutVendors += 1;
      }
      if (
        coverage.searchableProductCount === 0 &&
        coverage.publicServiceCount === 0
      ) {
        summary.marketsWithoutSearchableCatalog += 1;
      }
      summary.vendorsMissingSearchableProducts +=
        coverage.vendorsMissingSearchableProducts ?? 0;
      summary.vendorsMissingPublicServices +=
        coverage.vendorsMissingPublicServices ?? 0;
      summary.totalCatalogGapVendors =
        summary.vendorsMissingSearchableProducts +
        summary.vendorsMissingPublicServices;

      if (market.publicReadiness) {
        readinessTotal.scoreTotal += market.publicReadiness.score;
        readinessTotal.scoredMarkets += 1;
        summary.averageReadinessScore = Math.round(
          readinessTotal.scoreTotal / readinessTotal.scoredMarkets,
        );
      }

      summaries.set(key, summary);
      readinessTotals.set(key, readinessTotal);
    }

    return {
      areas: Array.from(summaries.values()).sort((left, right) => {
        const gapDelta =
          right.totalCatalogGapVendors - left.totalCatalogGapVendors;
        if (gapDelta !== 0) return gapDelta;
        const cityDelta = left.city.localeCompare(right.city, "zh-Hant");
        if (cityDelta !== 0) return cityDelta;
        return left.district.localeCompare(right.district, "zh-Hant");
      }),
    };
  }

  async listSitemapEntries(limit = 50000) {
    const rows = await this.db
      .select({
        slug: markets.slug,
        updatedAt: markets.updatedAt,
      })
      .from(markets)
      .where(
        and(
          eq(markets.isActive, true),
          isNull(markets.deletedAt),
          ...this.publicReadyConditions(),
        ),
      )
      .orderBy(desc(markets.updatedAt), asc(markets.name))
      .limit(limit);

    return rows;
  }

  async listAreas() {
    const cacheKey = await this.publicCacheKey("areas", "all");
    const cached =
      await this.cache.get<Awaited<ReturnType<MarketsService["queryAreas"]>>>(
        cacheKey,
      );
    if (cached) return cached;

    const data = await this.queryAreas();
    await this.cache.set(cacheKey, data, CACHE_TTL.SHORT);
    return data;
  }

  private async queryAreas() {
    const rows = await this.db
      .select({
        city: markets.city,
        district: markets.district,
      })
      .from(markets)
      .where(
        and(
          eq(markets.isActive, true),
          isNull(markets.deletedAt),
          ...this.publicReadyConditions(),
        ),
      )
      .groupBy(markets.city, markets.district)
      .orderBy(asc(markets.city), asc(markets.district));

    const areas = rows.reduce<{ city: string; districts: string[] }[]>(
      (acc, row) => {
        let area = acc.find((entry) => entry.city === row.city);
        if (!area) {
          area = { city: row.city, districts: [] };
          acc.push(area);
        }
        area.districts.push(row.district);
        return acc;
      },
      [],
    );

    return { areas };
  }

  private async queryMarkets(
    filters: MarketFilters,
    options: {
      includeVendorBreakdown?: boolean;
      publicReadyOnly?: boolean;
    } = {},
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions = [eq(markets.isActive, true), isNull(markets.deletedAt)];

    if (filters.city) conditions.push(eq(markets.city, filters.city));
    if (filters.district)
      conditions.push(eq(markets.district, filters.district));
    if (filters.type) conditions.push(eq(markets.type, filters.type));
    if (filters.q) {
      conditions.push(this.marketKeywordCondition(filters.q));
    }
    if (options.publicReadyOnly) {
      conditions.push(...this.publicReadyConditions());
    }

    const whereClause = and(...conditions);
    const rows = await this.db
      .select({
        id: markets.id,
        slug: markets.slug,
        name: markets.name,
        type: markets.type,
        description: markets.description,
        city: markets.city,
        district: markets.district,
        address: markets.address,
        latitude: markets.latitude,
        longitude: markets.longitude,
        boundaryGeojson: markets.boundaryGeojson,
        openingHours: markets.openingHours,
        mapLayout: markets.mapLayout,
        bannerUrl: markets.bannerUrl,
        logoUrl: markets.logoUrl,
        imageUrls: markets.imageUrls,
        tags: markets.tags,
        updatedAt: markets.updatedAt,
        vendorCount: sql<number>`count(${restaurants.id})`,
      })
      .from(markets)
      .leftJoin(
        restaurantMarketMemberships,
        and(
          eq(restaurantMarketMemberships.marketId, markets.id),
          isNull(restaurantMarketMemberships.leftAt),
        ),
      )
      .leftJoin(
        restaurants,
        and(
          eq(restaurantMarketMemberships.restaurantId, restaurants.id),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
        ),
      )
      .where(whereClause)
      .groupBy(markets.id)
      .orderBy(asc(markets.city), asc(markets.district), asc(markets.name))
      .limit(limit)
      .offset(offset);

    const [{ count = 0 } = { count: 0 }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(markets)
      .where(whereClause);

    const marketsWithCoverage = await Promise.all(
      rows.map(async (row) => {
        const vendorCount = Number(row.vendorCount);
        const catalogCoverage = options.includeVendorBreakdown
          ? await this.catalogCoverageWithVendorBreakdown(row.id)
          : await this.countCatalogCoverage(row.id);

        return {
          ...row,
          vendorCount,
          catalogCoverage,
          publicReadiness: evaluateMarketPublicReadiness({
            ...row,
            vendorCount,
            ...catalogCoverage,
          }),
        };
      }),
    );

    return {
      markets: marketsWithCoverage,
      total: Number(count),
      page,
      limit,
    };
  }

  async getMarketBySlug(slug: string) {
    const cacheKey = await this.publicCacheKey("detail", slug);
    const cached =
      await this.cache.get<
        Awaited<ReturnType<MarketsService["queryMarketBySlug"]>>
      >(cacheKey);
    if (cached) return cached;

    const data = await this.queryMarketBySlug(slug);
    if (data) await this.cache.set(cacheKey, data, CACHE_TTL.SHORT);
    return data;
  }

  private async queryMarketBySlug(slug: string) {
    const [market] = await this.db
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.slug, slug),
          eq(markets.isActive, true),
          isNull(markets.deletedAt),
        ),
      )
      .limit(1);

    if (!market) return null;

    const [{ count = 0 } = { count: 0 }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(restaurantMarketMemberships)
      .innerJoin(
        restaurants,
        eq(restaurantMarketMemberships.restaurantId, restaurants.id),
      )
      .where(
        and(
          eq(restaurantMarketMemberships.marketId, market.id),
          isNull(restaurantMarketMemberships.leftAt),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
        ),
      );

    const vendorCount = Number(count);
    const [catalogCoverage, explorationSummary] = await Promise.all([
      this.countCatalogCoverage(market.id),
      this.getExplorationSummary(market.id, market.slug),
    ]);

    return {
      market,
      vendorCount,
      catalogCoverage,
      explorationSummary,
      publicReadiness: evaluateMarketPublicReadiness({
        ...market,
        vendorCount,
        ...catalogCoverage,
      }),
    };
  }

  private async getExplorationSummary(
    marketId: string,
    marketSlug: string,
  ): Promise<MarketExplorationSummary> {
    const [menuItemCategories, productCategories, serviceTypes] =
      await Promise.all([
        this.listDishCategoryFacets(marketId, "menu_item"),
        this.listDishCategoryFacets(marketId, "product"),
        this.listServiceTypeFacets(marketId),
      ]);
    const dishCategories = [...productCategories, ...menuItemCategories];

    return {
      dishSearchUrl: `/api/v1/discovery/search?marketSlug=${encodeURIComponent(
        marketSlug,
      )}`,
      serviceSearchUrl: `/api/v1/discovery/services?marketSlug=${encodeURIComponent(
        marketSlug,
      )}`,
      dishCategories: dishCategories.map((facet) => ({
        ...facet,
        searchUrl: `/api/v1/discovery/search?marketSlug=${encodeURIComponent(
          marketSlug,
        )}&catalogType=${facet.catalogType}&categoryName=${encodeURIComponent(
          facet.categoryName,
        )}`,
      })),
      menuItemCategories: menuItemCategories.map((facet) => ({
        ...facet,
        searchUrl: `/api/v1/discovery/search?marketSlug=${encodeURIComponent(
          marketSlug,
        )}&catalogType=menu_item&categoryName=${encodeURIComponent(
          facet.categoryName,
        )}`,
      })),
      productCategories: productCategories.map((facet) => ({
        ...facet,
        searchUrl: `/api/v1/discovery/search?marketSlug=${encodeURIComponent(
          marketSlug,
        )}&catalogType=product&categoryName=${encodeURIComponent(
          facet.categoryName,
        )}`,
      })),
      serviceTypes: serviceTypes.map((facet) => ({
        ...facet,
        searchUrl: `/api/v1/discovery/services?marketSlug=${encodeURIComponent(
          marketSlug,
        )}&serviceType=${encodeURIComponent(facet.serviceType)}`,
      })),
    };
  }

  private async listDishCategoryFacets<
    TCatalogType extends "menu_item" | "product",
  >(
    marketId: string,
    catalogType: TCatalogType,
  ): Promise<
    Array<{
      categoryName: string;
      catalogType: TCatalogType;
      count: number;
    }>
  > {
    const itemCount = sql<number>`count(*)`;
    const rows = await this.db
      .select({
        categoryName: dishSearchIndex.categoryName,
        count: itemCount,
      })
      .from(dishSearchIndex)
      .innerJoin(restaurants, eq(dishSearchIndex.restaurantId, restaurants.id))
      .where(
        and(
          eq(dishSearchIndex.isAvailable, true),
          eq(dishSearchIndex.catalogType, catalogType),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
          sql`${dishSearchIndex.categoryName} IS NOT NULL`,
          or(
            eq(dishSearchIndex.primaryMarketId, marketId),
            like(dishSearchIndex.marketIds, `%"${marketId}"%`),
          )!,
        ),
      )
      .groupBy(dishSearchIndex.categoryName)
      .orderBy(desc(itemCount), asc(dishSearchIndex.categoryName))
      .limit(12);

    return rows
      .filter((row): row is { categoryName: string; count: number } =>
        Boolean(row.categoryName),
      )
      .map((row) => ({
        categoryName: row.categoryName,
        catalogType,
        count: Number(row.count),
      }));
  }

  private async listServiceTypeFacets(marketId: string) {
    const itemCount = sql<number>`count(*)`;
    const rows = await this.db
      .select({
        serviceType: restaurantServiceItems.serviceType,
        count: itemCount,
      })
      .from(restaurantServiceItems)
      .innerJoin(
        restaurants,
        eq(restaurantServiceItems.restaurantId, restaurants.id),
      )
      .where(
        and(
          eq(restaurantServiceItems.isActive, true),
          eq(restaurantServiceItems.isPublic, true),
          isNull(restaurantServiceItems.deletedAt),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
          sql`EXISTS (
            SELECT 1
            FROM ${restaurantMarketMemberships}
            WHERE ${restaurantMarketMemberships.restaurantId} = ${restaurants.id}
              AND ${restaurantMarketMemberships.marketId} = ${marketId}
              AND ${restaurantMarketMemberships.leftAt} IS NULL
          )`,
        ),
      )
      .groupBy(restaurantServiceItems.serviceType)
      .orderBy(desc(itemCount), asc(restaurantServiceItems.serviceType))
      .limit(12);

    return rows.map((row) => ({
      serviceType: row.serviceType,
      count: Number(row.count),
    }));
  }

  private async countCatalogCoverage(
    marketId: string,
  ): Promise<MarketCatalogCoverage> {
    const [productRows, serviceCount, bookingActionability] = await Promise.all(
      [
        this.db
          .select({ count: sql<number>`count(*)` })
          .from(dishSearchIndex)
          .innerJoin(
            restaurants,
            eq(dishSearchIndex.restaurantId, restaurants.id),
          )
          .where(
            and(
              eq(dishSearchIndex.isAvailable, true),
              eq(restaurants.isActive, true),
              isNull(restaurants.deletedAt),
              or(
                eq(dishSearchIndex.primaryMarketId, marketId),
                like(dishSearchIndex.marketIds, `%"${marketId}"%`),
              ),
            ),
          ),
        this.countPublicServicesForMarket(marketId),
        this.countBookingActionabilityForMarket(marketId),
      ],
    );

    return {
      searchableProductCount: Number(productRows[0]?.count ?? 0),
      publicServiceCount: serviceCount,
      ...bookingActionability,
    };
  }

  private async countPublicServicesForMarket(marketId: string) {
    const row = await this.d1
      .prepare(
        `SELECT count(distinct rsi.id) as count
         FROM restaurant_service_items rsi
         INNER JOIN restaurants r ON rsi.restaurant_id = r.id
         INNER JOIN restaurant_market_memberships rmm
           ON rmm.restaurant_id = r.id
          AND rmm.market_id = ?
          AND rmm.left_at_ms IS NULL
         WHERE rsi.is_active = 1
           AND rsi.is_public = 1
           AND rsi.deleted_at_ms IS NULL
           AND r.is_active = 1
           AND r.deleted_at_ms IS NULL`,
      )
      .bind(marketId)
      .first<{ count: number }>();

    return Number(row?.count ?? 0);
  }

  private async countBookingActionabilityForMarket(marketId: string) {
    const row = await this.d1
      .prepare(
        `SELECT
           count(distinct CASE WHEN rsi.requires_booking = 1 THEN rsi.id END)
             as booking_required_service_count,
           count(
             distinct CASE
               WHEN rsi.requires_booking = 1
                AND (rsi.booking_url IS NULL OR trim(rsi.booking_url) = '')
               THEN rsi.id
             END
           ) as booking_url_missing_service_count
         FROM restaurant_service_items rsi
         INNER JOIN restaurants r ON rsi.restaurant_id = r.id
         INNER JOIN restaurant_market_memberships rmm
           ON rmm.restaurant_id = r.id
          AND rmm.market_id = ?
          AND rmm.left_at_ms IS NULL
         WHERE rsi.is_active = 1
           AND rsi.is_public = 1
           AND rsi.deleted_at_ms IS NULL
           AND r.is_active = 1
           AND r.deleted_at_ms IS NULL`,
      )
      .bind(marketId)
      .first<{
        booking_required_service_count: number | null;
        booking_url_missing_service_count: number | null;
      }>();

    return {
      bookingRequiredServiceCount: Number(
        row?.booking_required_service_count ?? 0,
      ),
      bookingUrlMissingServiceCount: Number(
        row?.booking_url_missing_service_count ?? 0,
      ),
    };
  }

  private async catalogCoverageWithVendorBreakdown(
    marketId: string,
  ): Promise<Required<MarketCatalogCoverage>> {
    const [coverage, vendorRows] = await Promise.all([
      this.countCatalogCoverage(marketId),
      this.db
        .select({
          restaurantId: restaurants.id,
          name: restaurants.name,
          stallNumber: restaurantMarketMemberships.stallNumber,
          locationLabel: restaurantMarketMemberships.locationLabel,
          mapPosition: restaurantMarketMemberships.mapPosition,
        })
        .from(restaurantMarketMemberships)
        .innerJoin(
          restaurants,
          eq(restaurantMarketMemberships.restaurantId, restaurants.id),
        )
        .where(
          and(
            eq(restaurantMarketMemberships.marketId, marketId),
            isNull(restaurantMarketMemberships.leftAt),
            eq(restaurants.isActive, true),
            isNull(restaurants.deletedAt),
          ),
        )
        .orderBy(asc(restaurants.name)),
    ]);

    if (vendorRows.length === 0) {
      return {
        searchableProductCount: coverage.searchableProductCount,
        publicServiceCount: coverage.publicServiceCount,
        bookingRequiredServiceCount: coverage.bookingRequiredServiceCount ?? 0,
        bookingUrlMissingServiceCount:
          coverage.bookingUrlMissingServiceCount ?? 0,
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
      };
    }

    const productRows = await this.db
      .select({
        restaurantId: dishSearchIndex.restaurantId,
      })
      .from(dishSearchIndex)
      .innerJoin(restaurants, eq(dishSearchIndex.restaurantId, restaurants.id))
      .where(
        and(
          eq(dishSearchIndex.isAvailable, true),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
          or(
            eq(dishSearchIndex.primaryMarketId, marketId),
            like(dishSearchIndex.marketIds, `%"${marketId}"%`),
          ),
        ),
      )
      .groupBy(dishSearchIndex.restaurantId);

    const [serviceRows, bookingGapRows] = await Promise.all([
      this.listVendorIdsWithPublicServices(marketId),
      this.listVendorIdsMissingBookingUrls(marketId),
    ]);

    const vendorsWithProducts = new Set(
      productRows.map((row) => row.restaurantId),
    );
    const vendorsWithServices = new Set(
      serviceRows.map((row) => row.restaurantId),
    );
    const vendorsWithBookingUrlGaps = new Set(
      bookingGapRows.map((row) => row.restaurantId),
    );
    const vendorsWithSearchableProductsCount = vendorRows.filter((vendor) =>
      vendorsWithProducts.has(vendor.restaurantId),
    ).length;
    const vendorsWithPublicServicesCount = vendorRows.filter((vendor) =>
      vendorsWithServices.has(vendor.restaurantId),
    ).length;
    const missingProductVendors = vendorRows
      .filter((vendor) => !vendorsWithProducts.has(vendor.restaurantId))
      .map((vendor) => ({
        restaurantId: vendor.restaurantId,
        name: vendor.name,
        stallNumber: vendor.stallNumber,
        locationLabel: vendor.locationLabel,
      }));
    const missingServiceVendors = vendorRows
      .filter((vendor) => !vendorsWithServices.has(vendor.restaurantId))
      .map((vendor) => ({
        restaurantId: vendor.restaurantId,
        name: vendor.name,
        stallNumber: vendor.stallNumber,
        locationLabel: vendor.locationLabel,
      }));
    const missingBookingUrlVendors = vendorRows
      .filter((vendor) => vendorsWithBookingUrlGaps.has(vendor.restaurantId))
      .map((vendor) => ({
        restaurantId: vendor.restaurantId,
        name: vendor.name,
        stallNumber: vendor.stallNumber,
        locationLabel: vendor.locationLabel,
      }));
    const missingStallNumberVendors = vendorRows
      .filter((vendor) => !vendor.stallNumber?.trim())
      .map((vendor) => ({
        restaurantId: vendor.restaurantId,
        name: vendor.name,
        stallNumber: vendor.stallNumber,
        locationLabel: vendor.locationLabel,
      }));
    const missingMapPositionVendors = vendorRows
      .filter(
        (vendor) =>
          !vendor.mapPosition ||
          typeof vendor.mapPosition.x !== "number" ||
          typeof vendor.mapPosition.y !== "number",
      )
      .map((vendor) => ({
        restaurantId: vendor.restaurantId,
        name: vendor.name,
        stallNumber: vendor.stallNumber,
        locationLabel: vendor.locationLabel,
      }));
    const missingSearchEntrypointVendors = vendorRows
      .filter(
        (vendor) =>
          !vendorsWithProducts.has(vendor.restaurantId) &&
          !vendorsWithServices.has(vendor.restaurantId),
      )
      .map((vendor) => ({
        restaurantId: vendor.restaurantId,
        name: vendor.name,
        stallNumber: vendor.stallNumber,
        locationLabel: vendor.locationLabel,
      }));

    return {
      searchableProductCount: coverage.searchableProductCount,
      publicServiceCount: coverage.publicServiceCount,
      bookingRequiredServiceCount: coverage.bookingRequiredServiceCount ?? 0,
      bookingUrlMissingServiceCount:
        coverage.bookingUrlMissingServiceCount ?? 0,
      vendorsWithSearchableProducts: vendorsWithSearchableProductsCount,
      vendorsMissingSearchableProducts: missingProductVendors.length,
      vendorsWithPublicServices: vendorsWithPublicServicesCount,
      vendorsMissingPublicServices: missingServiceVendors.length,
      vendorsMissingBookingUrls: missingBookingUrlVendors.length,
      vendorsMissingStallNumbers: missingStallNumberVendors.length,
      vendorsMissingMapPositions: missingMapPositionVendors.length,
      vendorsMissingSearchEntrypoints: missingSearchEntrypointVendors.length,
      missingProductVendors,
      missingServiceVendors,
      missingBookingUrlVendors,
      missingStallNumberVendors,
      missingMapPositionVendors,
      missingSearchEntrypointVendors,
    };
  }

  private async listVendorIdsWithPublicServices(marketId: string) {
    const result = await this.d1
      .prepare(
        `SELECT rsi.restaurant_id as restaurantId
         FROM restaurant_service_items rsi
         INNER JOIN restaurants r ON rsi.restaurant_id = r.id
         INNER JOIN restaurant_market_memberships rmm
           ON rmm.restaurant_id = r.id
          AND rmm.market_id = ?
          AND rmm.left_at_ms IS NULL
         WHERE rsi.is_active = 1
           AND rsi.is_public = 1
           AND rsi.deleted_at_ms IS NULL
           AND r.is_active = 1
           AND r.deleted_at_ms IS NULL
         GROUP BY rsi.restaurant_id`,
      )
      .bind(marketId)
      .all<{ restaurantId: string }>();

    return result.results ?? [];
  }

  private async listVendorIdsMissingBookingUrls(marketId: string) {
    const result = await this.d1
      .prepare(
        `SELECT rsi.restaurant_id as restaurantId
         FROM restaurant_service_items rsi
         INNER JOIN restaurants r ON rsi.restaurant_id = r.id
         INNER JOIN restaurant_market_memberships rmm
           ON rmm.restaurant_id = r.id
          AND rmm.market_id = ?
          AND rmm.left_at_ms IS NULL
         WHERE rsi.is_active = 1
           AND rsi.is_public = 1
           AND rsi.requires_booking = 1
           AND (rsi.booking_url IS NULL OR trim(rsi.booking_url) = '')
           AND rsi.deleted_at_ms IS NULL
           AND r.is_active = 1
           AND r.deleted_at_ms IS NULL
         GROUP BY rsi.restaurant_id`,
      )
      .bind(marketId)
      .all<{ restaurantId: string }>();

    return result.results ?? [];
  }

  async listVendors(slug: string, filters: VendorFilters) {
    const cacheKey = await this.publicCacheKey("vendors", {
      slug,
      ...filters,
    });
    const cached =
      await this.cache.get<Awaited<ReturnType<MarketsService["queryVendors"]>>>(
        cacheKey,
      );
    if (cached) return cached;

    const data = await this.queryVendors(slug, filters);
    if (data) await this.cache.set(cacheKey, data, CACHE_TTL.SHORT);
    return data;
  }

  private async queryVendors(slug: string, filters: VendorFilters) {
    const marketDetail = await this.getMarketBySlug(slug);
    if (!marketDetail) return null;
    if (!marketDetail.publicReadiness.ready) return null;

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;
    const geoFilter =
      filters.lat != null && filters.lng != null
        ? {
            lat: filters.lat,
            lng: filters.lng,
            radiusKm: Math.min(Math.max(filters.radiusKm ?? 2, 0.1), 10),
            box: boundingBoxFromCircle(
              filters.lat,
              filters.lng,
              Math.min(Math.max(filters.radiusKm ?? 2, 0.1), 10),
            ),
          }
        : null;
    const conditions = [
      eq(restaurantMarketMemberships.marketId, marketDetail.market.id),
      isNull(restaurantMarketMemberships.leftAt),
      eq(restaurants.isActive, true),
      isNull(restaurants.deletedAt),
    ];

    if (filters.q) {
      const keyword = `%${filters.q}%`;
      const searchCondition = or(
        like(restaurants.name, keyword),
        like(restaurants.type, keyword),
        like(restaurants.category, keyword),
        like(restaurants.city, keyword),
        like(restaurants.district, keyword),
        like(restaurantMarketMemberships.stallNumber, keyword),
        like(restaurantMarketMemberships.locationLabel, keyword),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (filters.takeaway)
      conditions.push(eq(restaurants.supportsTakeaway, true));
    if (filters.delivery)
      conditions.push(eq(restaurants.supportsDelivery, true));
    if (geoFilter) {
      conditions.push(
        gte(restaurants.latitude, geoFilter.box.southLat),
        lte(restaurants.latitude, geoFilter.box.northLat),
        gte(restaurants.longitude, geoFilter.box.westLng),
        lte(restaurants.longitude, geoFilter.box.eastLng),
      );
    }

    const whereClause = and(...conditions);
    const requiresPostFilterPagination = Boolean(
      filters.openNow || geoFilter || filters.sortBy === "distance",
    );
    const queryLimit = requiresPostFilterPagination
      ? OPEN_NOW_VENDOR_SCAN_LIMIT
      : limit;
    const queryOffset = requiresPostFilterPagination ? 0 : offset;
    const rows = await this.db
      .select({
        restaurantId: restaurants.id,
        name: restaurants.name,
        type: restaurants.type,
        category: restaurants.category,
        district: restaurants.district,
        city: restaurants.city,
        latitude: restaurants.latitude,
        longitude: restaurants.longitude,
        priceRange: restaurants.priceRange,
        rating: restaurants.rating,
        businessHours: restaurants.businessHours,
        timezone: restaurants.timezone,
        marketHours: restaurantMarketMemberships.marketHours,
        supportsTakeaway: restaurants.supportsTakeaway,
        supportsDelivery: restaurants.supportsDelivery,
        imageUrl: restaurants.logoUrl,
        stallNumber: restaurantMarketMemberships.stallNumber,
        locationLabel: restaurantMarketMemberships.locationLabel,
        mapPosition: restaurantMarketMemberships.mapPosition,
        isPrimary: restaurantMarketMemberships.isPrimary,
      })
      .from(restaurantMarketMemberships)
      .innerJoin(
        restaurants,
        eq(restaurantMarketMemberships.restaurantId, restaurants.id),
      )
      .where(whereClause)
      .orderBy(...this.vendorOrderBy(filters))
      .limit(queryLimit)
      .offset(queryOffset);

    // `timezone` is destructured off rather than spread: it is only here to
    // cut `isOpen` at the stall's own clock (#329), and the vendor payload
    // does not otherwise carry it.
    let vendors = rows.map(({ timezone, ...row }) => ({
      ...row,
      effectiveBusinessHours: row.marketHours ?? row.businessHours ?? null,
      isOpen: isOpenNow(row.marketHours ?? row.businessHours ?? null, timezone),
      ...(geoFilter
        ? {
            distanceKm: Number(
              distanceKm(
                { lat: geoFilter.lat, lng: geoFilter.lng },
                {
                  lat: row.latitude ?? 0,
                  lng: row.longitude ?? 0,
                },
              ).toFixed(3),
            ),
          }
        : {}),
    }));
    if (geoFilter) {
      vendors = vendors.filter(
        (row) => row.distanceKm != null && row.distanceKm <= geoFilter.radiusKm,
      );
    }
    if (filters.openNow) {
      vendors = vendors.filter((row) => row.isOpen);
    }
    if (filters.sortBy === "distance") {
      vendors = [...vendors].sort(
        (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
      );
    }

    const [{ count = 0 } = { count: 0 }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(restaurantMarketMemberships)
      .innerJoin(
        restaurants,
        eq(restaurantMarketMemberships.restaurantId, restaurants.id),
      )
      .where(whereClause);

    const total = filters.openNow || geoFilter ? vendors.length : Number(count);
    const pagedVendors = requiresPostFilterPagination
      ? vendors.slice(offset, offset + limit)
      : vendors;
    const vendorsWithAccess = await this.withVendorAccess(pagedVendors);

    return {
      vendors: vendorsWithAccess,
      total,
      page,
      limit,
    };
  }

  private vendorOrderBy(filters: VendorFilters): SQL[] {
    if (filters.sortBy === "rating") {
      return [desc(restaurants.rating)];
    }
    return [desc(restaurants.totalOrders)];
  }

  private async withVendorAccess<TVendor extends { restaurantId: string }>(
    vendors: TVendor[],
  ) {
    if (vendors.length === 0) return vendors;

    const restaurantIds = [...new Set(vendors.map((row) => row.restaurantId))];
    const [menuCounts, serviceCounts] = await Promise.all([
      this.db
        .select({
          restaurantId: menuItems.restaurantId,
          count: sql<number>`count(*)`,
        })
        .from(menuItems)
        .where(
          and(
            inArray(menuItems.restaurantId, restaurantIds),
            eq(menuItems.isAvailable, true),
            isNull(menuItems.deletedAt),
          ),
        )
        .groupBy(menuItems.restaurantId),
      this.db
        .select({
          restaurantId: restaurantServiceItems.restaurantId,
          count: sql<number>`count(*)`,
        })
        .from(restaurantServiceItems)
        .where(
          and(
            inArray(restaurantServiceItems.restaurantId, restaurantIds),
            eq(restaurantServiceItems.isActive, true),
            eq(restaurantServiceItems.isPublic, true),
            isNull(restaurantServiceItems.deletedAt),
          ),
        )
        .groupBy(restaurantServiceItems.restaurantId),
    ]);
    const menuCountByRestaurant = new Map(
      menuCounts.map((row) => [row.restaurantId, Number(row.count)]),
    );
    const serviceCountByRestaurant = new Map(
      serviceCounts.map((row) => [row.restaurantId, Number(row.count)]),
    );

    return vendors.map((row) => ({
      ...row,
      detailUrl: `/api/v1/restaurants/${row.restaurantId}`,
      menuUrl: `/api/v1/menu/${row.restaurantId}`,
      serviceItemsUrl: `/api/v1/restaurants/${row.restaurantId}/service-items`,
      availableMenuItemCount: menuCountByRestaurant.get(row.restaurantId) ?? 0,
      publicServiceItemCount:
        serviceCountByRestaurant.get(row.restaurantId) ?? 0,
    }));
  }

  async findNearby(lat: number, lng: number, radiusKm = 2, limit = 20) {
    const cacheKey = await this.publicCacheKey("nearby", {
      lat: Number(lat.toFixed(3)),
      lng: Number(lng.toFixed(3)),
      radiusKm,
      limit,
    });
    const cached =
      await this.cache.get<Awaited<ReturnType<MarketsService["queryNearby"]>>>(
        cacheKey,
      );
    if (cached) return cached;

    const data = await this.queryNearby(lat, lng, radiusKm, limit);
    await this.cache.set(cacheKey, data, CACHE_TTL.SHORT);
    return data;
  }

  private async queryNearby(
    lat: number,
    lng: number,
    radiusKm = 2,
    limit = 20,
  ) {
    const cappedRadius = Math.min(Math.max(radiusKm, 0.1), 10);
    const cappedLimit = Math.min(Math.max(limit, 1), 50);
    const box = boundingBoxFromCircle(lat, lng, cappedRadius);
    const rows = await this.db
      .select({
        id: markets.id,
        slug: markets.slug,
        name: markets.name,
        type: markets.type,
        description: markets.description,
        city: markets.city,
        district: markets.district,
        address: markets.address,
        latitude: markets.latitude,
        longitude: markets.longitude,
        boundaryGeojson: markets.boundaryGeojson,
        openingHours: markets.openingHours,
        mapLayout: markets.mapLayout,
        bannerUrl: markets.bannerUrl,
        logoUrl: markets.logoUrl,
        imageUrls: markets.imageUrls,
        tags: markets.tags,
        vendorCount: sql<number>`count(${restaurants.id})`,
      })
      .from(markets)
      .leftJoin(
        restaurantMarketMemberships,
        and(
          eq(restaurantMarketMemberships.marketId, markets.id),
          isNull(restaurantMarketMemberships.leftAt),
        ),
      )
      .leftJoin(
        restaurants,
        and(
          eq(restaurantMarketMemberships.restaurantId, restaurants.id),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
        ),
      )
      .where(
        and(
          eq(markets.isActive, true),
          isNull(markets.deletedAt),
          or(
            and(
              gte(markets.latitude, box.southLat),
              lte(markets.latitude, box.northLat),
              gte(markets.longitude, box.westLng),
              lte(markets.longitude, box.eastLng),
            ),
            sql`${markets.boundaryGeojson} IS NOT NULL`,
          ),
          ...this.publicReadyConditions(),
        ),
      )
      .groupBy(markets.id)
      .limit(500);

    const nearbyRows = rows
      .map((row) => {
        const containsPoint = pointInGeoJsonBoundary(
          { lat, lng },
          row.boundaryGeojson,
        );
        return {
          ...row,
          vendorCount: Number(row.vendorCount),
          distanceKm: containsPoint
            ? 0
            : distanceKm(
                { lat, lng },
                { lat: row.latitude, lng: row.longitude },
              ),
        };
      })
      .filter((row) => row.distanceKm <= cappedRadius)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, cappedLimit);
    const withDistance = await Promise.all(
      nearbyRows.map(async (row) => {
        const catalogCoverage = await this.countCatalogCoverage(row.id);

        return {
          ...row,
          catalogCoverage,
          publicReadiness: evaluateMarketPublicReadiness({
            ...row,
            ...catalogCoverage,
          }),
        };
      }),
    );

    return { markets: withDistance };
  }

  async getMarketById(id: string) {
    const [market] = await this.db
      .select()
      .from(markets)
      .where(eq(markets.id, id))
      .limit(1);
    return market ?? null;
  }

  async createMarket(input: CreateMarketInput) {
    const now = new Date();
    const [market] = await this.db
      .insert(markets)
      .values({
        ...input,
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.bumpPublicCacheVersion();
    return market;
  }

  async listMarketsBySlugs(slugs: string[]) {
    if (slugs.length === 0) return [];

    return this.db
      .select({
        id: markets.id,
        slug: markets.slug,
        name: markets.name,
      })
      .from(markets)
      .where(inArray(markets.slug, slugs));
  }

  async createMarketsBulk(inputs: CreateMarketInput[]) {
    if (inputs.length === 0) return [];

    const now = new Date();
    const rows = inputs.map((input) => ({
      ...input,
      id: input.id ?? generateUUID(),
      platformFeeRateBps: input.platformFeeRateBps ?? 0,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));

    await this.d1.batch(
      rows.map((market) =>
        this.d1
          .prepare(
            `
              INSERT INTO markets (
                id,
                slug,
                name,
                type,
                description,
                city,
                country_code,
                district,
                address,
                latitude,
                longitude,
                boundary_geojson,
                opening_hours,
                map_layout,
                banner_url,
                logo_url,
                image_urls,
                tags,
                platform_fee_rate_bps,
                is_active,
                created_at_ms,
                updated_at_ms,
                deleted_at_ms
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .bind(
            market.id,
            market.slug,
            market.name,
            market.type,
            market.description ?? null,
            market.city,
            market.countryCode ?? null,
            market.district,
            market.address,
            market.latitude,
            market.longitude,
            jsonBindValue(market.boundaryGeojson),
            jsonBindValue(market.openingHours),
            jsonBindValue(market.mapLayout),
            market.bannerUrl ?? null,
            market.logoUrl ?? null,
            jsonBindValue(market.imageUrls),
            jsonBindValue(market.tags),
            market.platformFeeRateBps,
            market.isActive ? 1 : 0,
            now.getTime(),
            now.getTime(),
            null,
          ),
      ),
    );

    await this.bumpPublicCacheVersion();
    return rows;
  }

  async updateMarket(id: string, input: UpdateMarketInput) {
    const existing = await this.getMarketById(id);
    if (!existing) return null;

    const [market] = await this.db
      .update(markets)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(markets.id, id))
      .returning();
    if (market) await this.bumpPublicCacheVersion();
    return market ?? null;
  }

  async softDeleteMarket(id: string) {
    const existing = await this.getMarketById(id);
    if (!existing) return false;

    await this.db
      .update(markets)
      .set({
        isActive: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(markets.id, id));
    await this.bumpPublicCacheVersion();
    return true;
  }

  async addVendor(
    marketId: string,
    input: {
      restaurantId: string;
      stallNumber?: string | null;
      locationLabel?: string | null;
      mapPosition?: MarketVendorMapPosition | null;
      marketHours?: Record<
        string,
        { open: string; close: string; closed?: boolean }
      > | null;
      isPrimary?: boolean;
    },
  ) {
    const market = await this.getMarketById(marketId);
    if (!market || market.deletedAt) return null;

    const existing = await this.getActiveVendorMembership(
      marketId,
      input.restaurantId,
    );
    if (existing) {
      if (input.isPrimary) {
        await this.clearPrimaryMembership(input.restaurantId);
      }

      const [membership] = await this.db
        .update(restaurantMarketMemberships)
        .set({
          stallNumber:
            input.stallNumber !== undefined
              ? input.stallNumber
              : existing.stallNumber,
          locationLabel:
            input.locationLabel !== undefined
              ? input.locationLabel
              : existing.locationLabel,
          mapPosition:
            input.mapPosition !== undefined
              ? input.mapPosition
              : existing.mapPosition,
          marketHours:
            input.marketHours !== undefined
              ? input.marketHours
              : existing.marketHours,
          isPrimary:
            input.isPrimary !== undefined
              ? input.isPrimary
              : existing.isPrimary,
        })
        .where(eq(restaurantMarketMemberships.id, existing.id))
        .returning();
      await this.bumpPublicCacheVersion();
      return membership ?? existing;
    }

    const peers = await this.db
      .select({ restaurantId: restaurantMarketMemberships.restaurantId })
      .from(restaurantMarketMemberships)
      .where(
        and(
          eq(restaurantMarketMemberships.marketId, marketId),
          isNull(restaurantMarketMemberships.leftAt),
        ),
      );
    let currency;
    try {
      const vendorIds = [
        input.restaurantId,
        ...peers.map((peer) => peer.restaurantId),
      ];
      const batchCurrencies = [];
      for (
        let offset = 0;
        offset < vendorIds.length;
        offset += CURRENCY_RESOLUTION_BATCH_SIZE
      ) {
        const batch = vendorIds.slice(
          offset,
          offset + CURRENCY_RESOLUTION_BATCH_SIZE,
        );
        batchCurrencies.push({
          restaurantId: batch[0],
          currency: await resolveSharedRestaurantCurrency(this.d1, batch),
        });
      }
      // Each batch may be internally consistent but differ from another one.
      currency = sharedCurrency(batchCurrencies);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "MIXED_CURRENCY_CHECKOUT"
      ) {
        throw marketVendorCurrencyMismatch(
          (error.details as { currencies?: string[] } | undefined)?.currencies,
        );
      }
      throw error;
    }

    // The preflight explains invalid settings; the INSERT predicate closes the
    // race with other approvals and order-free member currency changes.
    const [membership] = await this.db
      .insert(restaurantMarketMemberships)
      .select(
        sql`SELECT NULL, ${input.restaurantId}, ${marketId},
        ${input.stallNumber ?? null}, ${input.locationLabel ?? null},
        ${input.mapPosition ? JSON.stringify(input.mapPosition) : null},
        ${input.marketHours ? JSON.stringify(input.marketHours) : null},
        ${input.isPrimary ? 1 : 0}, ${Date.now()}, NULL
        FROM ${restaurants} WHERE ${restaurants.id} = ${input.restaurantId}
        AND ${restaurantCurrencySql(restaurants.settings)} = ${currency}
        AND ${marketCurrencyMatches(input.restaurantId, currency, marketId)}`,
      )
      .returning();
    if (!membership) throw marketVendorCurrencyMismatch();
    if (input.isPrimary) {
      await this.clearPrimaryMembership(input.restaurantId, membership.id);
    }
    await this.bumpPublicCacheVersion();
    return membership;
  }

  async getActiveVendorMembership(marketId: string, restaurantId: string) {
    const [membership] = await this.db
      .select()
      .from(restaurantMarketMemberships)
      .where(
        and(
          eq(restaurantMarketMemberships.marketId, marketId),
          eq(restaurantMarketMemberships.restaurantId, restaurantId),
          isNull(restaurantMarketMemberships.leftAt),
        ),
      )
      .limit(1);

    return membership ?? null;
  }

  private async clearPrimaryMembership(
    restaurantId: string,
    exceptId?: number,
  ) {
    await this.db
      .update(restaurantMarketMemberships)
      .set({ isPrimary: false })
      .where(
        and(
          eq(restaurantMarketMemberships.restaurantId, restaurantId),
          isNull(restaurantMarketMemberships.leftAt),
          exceptId === undefined
            ? undefined
            : sql`${restaurantMarketMemberships.id} <> ${exceptId}`,
        ),
      );
  }

  async removeVendor(marketId: string, restaurantId: string) {
    const result = await this.db
      .update(restaurantMarketMemberships)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(restaurantMarketMemberships.marketId, marketId),
          eq(restaurantMarketMemberships.restaurantId, restaurantId),
          isNull(restaurantMarketMemberships.leftAt),
        ),
      )
      .returning();
    const removed = result.length > 0;
    if (removed) await this.bumpPublicCacheVersion();
    return removed;
  }

  async listRestaurantMemberships(restaurantId: string) {
    const rows = await this.db
      .select({
        id: restaurantMarketMemberships.id,
        restaurantId: restaurantMarketMemberships.restaurantId,
        marketId: restaurantMarketMemberships.marketId,
        stallNumber: restaurantMarketMemberships.stallNumber,
        locationLabel: restaurantMarketMemberships.locationLabel,
        mapPosition: restaurantMarketMemberships.mapPosition,
        marketHours: restaurantMarketMemberships.marketHours,
        isPrimary: restaurantMarketMemberships.isPrimary,
        joinedAt: restaurantMarketMemberships.joinedAt,
        marketSlug: markets.slug,
        marketName: markets.name,
        marketType: markets.type,
        city: markets.city,
        district: markets.district,
      })
      .from(restaurantMarketMemberships)
      .innerJoin(markets, eq(restaurantMarketMemberships.marketId, markets.id))
      .where(
        and(
          eq(restaurantMarketMemberships.restaurantId, restaurantId),
          isNull(restaurantMarketMemberships.leftAt),
          eq(markets.isActive, true),
          isNull(markets.deletedAt),
        ),
      )
      .orderBy(desc(restaurantMarketMemberships.isPrimary), asc(markets.name));

    return {
      memberships: rows.map((row) => ({
        id: row.id,
        restaurantId: row.restaurantId,
        marketId: row.marketId,
        stallNumber: row.stallNumber,
        locationLabel: row.locationLabel,
        mapPosition: row.mapPosition,
        marketHours: row.marketHours,
        isPrimary: row.isPrimary,
        joinedAt: row.joinedAt,
        market: {
          id: row.marketId,
          slug: row.marketSlug,
          name: row.marketName,
          type: row.marketType,
          city: row.city,
          district: row.district,
        },
      })),
    };
  }

  async listRestaurantJoinRequests(restaurantId: string) {
    const rows = await this.db
      .select({
        id: marketJoinRequests.id,
        restaurantId: marketJoinRequests.restaurantId,
        marketId: marketJoinRequests.marketId,
        status: marketJoinRequests.status,
        message: marketJoinRequests.message,
        requestedAt: marketJoinRequests.requestedAt,
        resolvedAt: marketJoinRequests.resolvedAt,
        marketSlug: markets.slug,
        marketName: markets.name,
        marketType: markets.type,
        city: markets.city,
        district: markets.district,
      })
      .from(marketJoinRequests)
      .innerJoin(markets, eq(marketJoinRequests.marketId, markets.id))
      .where(eq(marketJoinRequests.restaurantId, restaurantId))
      .orderBy(desc(marketJoinRequests.requestedAt));

    return {
      requests: rows.map((row) => ({
        id: row.id,
        restaurantId: row.restaurantId,
        marketId: row.marketId,
        status: row.status,
        message: row.message,
        requestedAt: row.requestedAt,
        resolvedAt: row.resolvedAt,
        market: {
          id: row.marketId,
          slug: row.marketSlug,
          name: row.marketName,
          type: row.marketType,
          city: row.city,
          district: row.district,
        },
      })),
    };
  }

  async listJoinRequests(filters: AdminJoinRequestFilters = {}) {
    const conditions = [];
    if (filters.status) {
      conditions.push(eq(marketJoinRequests.status, filters.status));
    }

    const rows = await this.db
      .select({
        id: marketJoinRequests.id,
        restaurantId: marketJoinRequests.restaurantId,
        marketId: marketJoinRequests.marketId,
        status: marketJoinRequests.status,
        message: marketJoinRequests.message,
        requestedAt: marketJoinRequests.requestedAt,
        resolvedAt: marketJoinRequests.resolvedAt,
        marketSlug: markets.slug,
        marketName: markets.name,
        marketType: markets.type,
        city: markets.city,
        district: markets.district,
        restaurantName: restaurants.name,
        restaurantDistrict: restaurants.district,
        restaurantCity: restaurants.city,
      })
      .from(marketJoinRequests)
      .innerJoin(markets, eq(marketJoinRequests.marketId, markets.id))
      .innerJoin(
        restaurants,
        eq(marketJoinRequests.restaurantId, restaurants.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(marketJoinRequests.requestedAt));

    return {
      requests: rows.map((row) => ({
        id: row.id,
        restaurantId: row.restaurantId,
        marketId: row.marketId,
        status: row.status,
        message: row.message,
        requestedAt: row.requestedAt,
        resolvedAt: row.resolvedAt,
        market: {
          id: row.marketId,
          slug: row.marketSlug,
          name: row.marketName,
          type: row.marketType,
          city: row.city,
          district: row.district,
        },
        restaurant: {
          id: row.restaurantId,
          name: row.restaurantName,
          city: row.restaurantCity,
          district: row.restaurantDistrict,
        },
      })),
    };
  }

  async listVendorCandidates(filters: AdminVendorCandidateFilters = {}) {
    const limit = filters.limit ?? 10;
    const conditions = [
      eq(restaurants.isActive, true),
      isNull(restaurants.deletedAt),
    ];

    const query = filters.q?.trim();
    if (query) {
      const pattern = `%${query}%`;
      const searchCondition = or(
        like(restaurants.name, pattern),
        like(restaurants.address, pattern),
        like(restaurants.district, pattern),
        like(restaurants.city, pattern),
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    if (filters.marketId) {
      conditions.push(sql`not exists (
        select 1
        from restaurant_market_memberships
        where restaurant_market_memberships.restaurant_id = ${restaurants.id}
          and restaurant_market_memberships.market_id = ${filters.marketId}
          and restaurant_market_memberships.left_at_ms is null
      )`);
    }

    const rows = await this.db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        city: restaurants.city,
        district: restaurants.district,
        address: restaurants.address,
        type: restaurants.type,
        category: restaurants.category,
        isAvailable: restaurants.isAvailable,
        supportsTakeaway: restaurants.supportsTakeaway,
        supportsDelivery: restaurants.supportsDelivery,
      })
      .from(restaurants)
      .where(and(...conditions))
      .orderBy(asc(restaurants.name))
      .limit(limit);

    return { restaurants: rows, total: rows.length };
  }

  async approveJoinRequest(
    requestId: number,
    input: {
      stallNumber?: string | null;
      locationLabel?: string | null;
      mapPosition?: MarketVendorMapPosition | null;
      marketHours?: Record<
        string,
        { open: string; close: string; closed?: boolean }
      > | null;
      isPrimary?: boolean;
    } = {},
  ) {
    const request = await this.getJoinRequestById(requestId);
    if (!request) return { status: "not_found" as const };
    if (request.status !== "pending") return { status: "not_pending" as const };

    const membership = await this.addVendor(request.marketId, {
      restaurantId: request.restaurantId,
      stallNumber: input.stallNumber ?? null,
      locationLabel: input.locationLabel ?? null,
      mapPosition: input.mapPosition ?? null,
      marketHours: input.marketHours ?? null,
      isPrimary: input.isPrimary ?? false,
    });
    if (!membership) return { status: "market_not_found" as const };

    const [updated] = await this.db
      .update(marketJoinRequests)
      .set({
        status: "approved",
        resolvedAt: new Date(),
      })
      .where(eq(marketJoinRequests.id, requestId))
      .returning();

    return { status: "approved" as const, request: updated, membership };
  }

  async rejectJoinRequest(requestId: number) {
    const request = await this.getJoinRequestById(requestId);
    if (!request) return { status: "not_found" as const };
    if (request.status !== "pending") return { status: "not_pending" as const };

    const [updated] = await this.db
      .update(marketJoinRequests)
      .set({
        status: "rejected",
        resolvedAt: new Date(),
      })
      .where(eq(marketJoinRequests.id, requestId))
      .returning();

    return { status: "rejected" as const, request: updated };
  }

  async createJoinRequest(
    restaurantId: string,
    input: {
      marketId?: string;
      marketSlug?: string;
      message?: string | null;
    },
  ) {
    const market = input.marketId
      ? await this.getMarketById(input.marketId)
      : await this.getMarketRecordBySlug(input.marketSlug ?? "");
    if (!market || market.deletedAt || !market.isActive) {
      return { status: "not_found" as const };
    }

    const [activeMembership] = await this.db
      .select({ id: restaurantMarketMemberships.id })
      .from(restaurantMarketMemberships)
      .where(
        and(
          eq(restaurantMarketMemberships.restaurantId, restaurantId),
          eq(restaurantMarketMemberships.marketId, market.id),
          isNull(restaurantMarketMemberships.leftAt),
        ),
      )
      .limit(1);

    if (activeMembership) {
      return { status: "already_member" as const };
    }

    const [pendingRequest] = await this.db
      .select({ id: marketJoinRequests.id })
      .from(marketJoinRequests)
      .where(
        and(
          eq(marketJoinRequests.restaurantId, restaurantId),
          eq(marketJoinRequests.marketId, market.id),
          eq(marketJoinRequests.status, "pending"),
        ),
      )
      .limit(1);

    if (pendingRequest) {
      return { status: "already_pending" as const };
    }

    const [request] = await this.db
      .insert(marketJoinRequests)
      .values({
        restaurantId,
        marketId: market.id,
        status: "pending",
        message: input.message || null,
        requestedAt: new Date(),
      })
      .returning();

    return { status: "created" as const, request };
  }

  private async getMarketRecordBySlug(slug: string) {
    const [market] = await this.db
      .select()
      .from(markets)
      .where(eq(markets.slug, slug))
      .limit(1);
    return market ?? null;
  }

  private async getJoinRequestById(requestId: number) {
    const [request] = await this.db
      .select()
      .from(marketJoinRequests)
      .where(eq(marketJoinRequests.id, requestId))
      .limit(1);

    return request ?? null;
  }

  private async publicCacheKey(scope: string, value: unknown) {
    const version = await this.getPublicCacheVersion();
    return `markets:v${version}:${scope}:${stableCacheValue(value)}`;
  }

  private async getPublicCacheVersion() {
    return (await this.kv?.get(MARKET_CACHE_VERSION_KEY)) ?? "1";
  }

  private publicReadyConditions(): SQL[] {
    return [
      sql`trim(coalesce(${markets.description}, '')) <> ''`,
      sql`trim(coalesce(${markets.city}, '')) <> ''`,
      sql`trim(coalesce(${markets.district}, '')) <> ''`,
      sql`trim(coalesce(${markets.address}, '')) <> ''`,
      sql`${markets.latitude} IS NOT NULL`,
      sql`${markets.longitude} IS NOT NULL`,
      sql`EXISTS (
        SELECT 1
        FROM json_each(${markets.openingHours}) day
        WHERE coalesce(json_extract(day.value, '$.closed'), 0) != 1
          AND trim(coalesce(json_extract(day.value, '$.open'), '')) <> ''
          AND trim(coalesce(json_extract(day.value, '$.close'), '')) <> ''
      )`,
      sql`EXISTS (
        SELECT 1
        FROM restaurant_market_memberships rmm
        INNER JOIN restaurants r ON r.id = rmm.restaurant_id
        WHERE rmm.market_id = ${markets.id}
          AND rmm.left_at_ms IS NULL
          AND r.is_active = 1
          AND r.deleted_at_ms IS NULL
      )`,
      sql`EXISTS (
        SELECT 1
        FROM restaurants r
        INNER JOIN restaurant_market_memberships rmm ON rmm.restaurant_id = r.id
        WHERE rmm.market_id = ${markets.id}
          AND rmm.left_at_ms IS NULL
          AND r.is_active = 1
          AND r.deleted_at_ms IS NULL
          AND (
            EXISTS (
              SELECT 1
              FROM dish_search_index dsi
              WHERE dsi.restaurant_id = r.id
                AND dsi.is_available = 1
                AND (
                  dsi.primary_market_id = ${markets.id}
                  OR dsi.market_ids LIKE '%' || '"' || ${markets.id} || '"' || '%'
                )
            )
            OR EXISTS (
              SELECT 1
              FROM restaurant_service_items rsi
              WHERE rsi.restaurant_id = r.id
                AND rsi.is_active = 1
                AND rsi.is_public = 1
                AND rsi.deleted_at_ms IS NULL
            )
          )
      )`,
    ];
  }

  private marketKeywordCondition(keyword: string): SQL {
    const trimmedKeyword = keyword.trim();
    const pattern = `%${trimmedKeyword}%`;
    const normalizedPattern = `%${trimmedKeyword
      .toLocaleLowerCase()
      .replace(/\s+/g, "")}%`;

    return or(
      like(markets.name, pattern),
      like(markets.slug, pattern),
      like(markets.description, pattern),
      like(markets.tags, pattern),
      sql`EXISTS (
        SELECT 1
        FROM restaurant_market_memberships rmm
        INNER JOIN restaurants r ON r.id = rmm.restaurant_id
        WHERE rmm.market_id = ${markets.id}
          AND rmm.left_at_ms IS NULL
          AND r.is_active = 1
          AND r.deleted_at_ms IS NULL
          AND (
            r.name LIKE ${pattern}
            OR r.type LIKE ${pattern}
            OR r.category LIKE ${pattern}
            OR r.description LIKE ${pattern}
            OR r.cuisine_tags LIKE ${pattern}
          )
      )`,
      sql`EXISTS (
        SELECT 1
        FROM dish_search_index dsi
        INNER JOIN restaurants r ON r.id = dsi.restaurant_id
        WHERE dsi.is_available = 1
          AND r.is_active = 1
          AND r.deleted_at_ms IS NULL
          AND (
            dsi.primary_market_id = ${markets.id}
            OR dsi.market_ids LIKE '%' || '"' || ${markets.id} || '"' || '%'
          )
          AND (
            dsi.dish_name LIKE ${pattern}
            OR dsi.dish_name_normalized LIKE ${normalizedPattern}
            OR dsi.category_name LIKE ${pattern}
            OR dsi.tags LIKE ${pattern}
          )
      )`,
      sql`EXISTS (
        SELECT 1
        FROM restaurant_market_memberships rmm
        INNER JOIN restaurants r ON r.id = rmm.restaurant_id
        INNER JOIN restaurant_service_items rsi ON rsi.restaurant_id = r.id
        WHERE rmm.market_id = ${markets.id}
          AND rmm.left_at_ms IS NULL
          AND r.is_active = 1
          AND r.deleted_at_ms IS NULL
          AND rsi.is_active = 1
          AND rsi.is_public = 1
          AND rsi.deleted_at_ms IS NULL
          AND (
            rsi.name LIKE ${pattern}
            OR rsi.description LIKE ${pattern}
            OR rsi.service_type LIKE ${pattern}
            OR rsi.tags LIKE ${pattern}
            OR rsi.keywords LIKE ${pattern}
          )
      )`,
    )!;
  }

  private async bumpPublicCacheVersion() {
    if (!this.kv) return;
    const current = Number(await this.getPublicCacheVersion());
    const next = Number.isFinite(current) ? current + 1 : Date.now();
    await this.kv.put(MARKET_CACHE_VERSION_KEY, String(next));
  }
}

function stableCacheValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return String(value);

  return JSON.stringify(sortCacheValue(value));
}

function sortCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCacheValue);
  if (value === null || typeof value !== "object") return value;

  return Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((sorted, [key, entry]) => {
      sorted[key] = sortCacheValue(entry);
      return sorted;
    }, {});
}
