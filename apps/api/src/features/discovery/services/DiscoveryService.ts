import { drizzle } from "drizzle-orm/d1";
import {
  eq,
  and,
  like,
  inArray,
  isNull,
  desc,
  asc,
  sql,
  or,
  gte,
  lte,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  dishSearchIndex,
  restaurants,
  markets,
  menuItems,
  categories,
  restaurantMarketMemberships,
  restaurantServiceItems,
} from "@makanmasak/database";
import { boundingBoxFromCircle, distanceKm } from "../../markets/services/geo";
import type {
  DishSearchResult,
  MarketSearchScopeMetadata,
  RestaurantListItem,
  SearchFilters,
  SearchResponse,
  ServiceSearchResult,
} from "../types";
import { getOpeningHoursStatus, isOpenNow } from "../utils/isOpenNow";
import { catalogResultTypeFromTags } from "../utils/catalog-result-type";
import { normalizeSearchTags } from "../utils/search-normalization";
import { fromCents, toRequiredCents } from "../../../shared/utils/money";
import { displayCurrencyFromRestaurantSettings } from "../../../shared/utils/restaurant-currency";
import {
  SemanticDiscoveryService,
  type SemanticDishDocument,
} from "./SemanticDiscoveryService";

const KV_SEARCH_TTL = 15 * 60; // 15 minutes
// The prefix names the cached payload's shape. Entries written before results
// carried `currency` must not be served as if they had one, so a shape change
// moves the key rather than waiting out the TTL.
const DISH_SEARCH_CACHE_PREFIX = "search:query:cur2";
const KV_RESTAURANT_TTL = 30 * 60; // 30 minutes
const KV_SEARCH_VERSION_KEY = "search:query:version";
const KV_SEARCH_REINDEXED_AT_KEY = "search:last_reindexed_at";
const POST_FILTER_SCAN_LIMIT = 50000;

export class DiscoveryService {
  private db;
  private d1: D1Database;

  /**
   * @param sessionConstraint When set (e.g. "first-unconstrained" or a prior
   *   bookmark), read queries run through a D1 Session so they can be served by
   *   regional read replicas instead of always hitting the primary. Only the
   *   read query builder (`this.db`) uses the session; `this.d1` stays on the
   *   primary for the reindex write path. No-op until read replication is
   *   enabled on the database in the Cloudflare dashboard.
   *   Drizzle's d1 driver only calls prepare()/batch(), both of which a
   *   D1DatabaseSession supports, so the cast below is safe at runtime.
   */
  constructor(
    d1: D1Database,
    private kv: KVNamespace,
    sessionConstraint?: string,
    private semanticSearch = new SemanticDiscoveryService({}),
  ) {
    const readClient = sessionConstraint
      ? (d1.withSession(sessionConstraint) as unknown as D1Database)
      : d1;
    this.db = drizzle(readClient);
    this.d1 = d1;
  }

  async searchDishes(
    filters: SearchFilters,
  ): Promise<SearchResponse<DishSearchResult>> {
    filters = await this.resolveMarketSlug(filters);
    const { q, page = 1, limit = 20 } = filters;

    // 1. Check KV cache
    const searchVersion = await this.getSearchVersion();
    const cacheKey = this.buildCacheKey(
      DISH_SEARCH_CACHE_PREFIX,
      filters,
      searchVersion,
    );
    const cached = await this.kv.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return {
        results: parsed.results.map((result: DishSearchResult) => ({
          ...result,
          district: this.publicDiscoveryDistrict(result.district),
          openingHoursStatus:
            result.openingHoursStatus ?? (result.isOpen ? "open" : "closed"),
        })),
        total: parsed.total,
        page,
        limit,
        scope: parsed.scope ?? (await this.getSearchScopeMetadata(filters)),
      };
    }

    // 2. Normalize query
    const serviceIntent = q ? this.getServiceIntent(q) : null;
    const normalized = q && !serviceIntent ? this.normalizeQuery(q) : null;
    const semanticResult = normalized
      ? await this.semanticSearch.searchDishIdsWithStatus(q, {
          topK: Math.max(limit * 5, 50),
          namespace: "dishes",
          embeddingMode: "cache-only",
        })
      : { matches: [], embeddingStatus: "disabled" as const };
    const semanticMenuItemIds = semanticResult.matches
      .map((match) => match.menuItemId)
      .slice(0, 50);

    // 3. D1 prefix search
    const offset = (page - 1) * limit;
    const geoFilter = this.getGeoFilter(filters);
    const requiresPostFilterPagination = Boolean(
      filters.openNow ||
      geoFilter ||
      filters.sortBy === "open_now" ||
      filters.sortBy === "distance",
    );
    const queryLimit = requiresPostFilterPagination
      ? POST_FILTER_SCAN_LIMIT
      : limit;
    const queryOffset = requiresPostFilterPagination ? 0 : offset;
    const effectivePrice = sql<number>`COALESCE(${dishSearchIndex.priceCents}, 0)`;

    const baseConditions: SQL[] = [
      eq(dishSearchIndex.isAvailable, true),
      eq(restaurants.isAvailable, true),
      eq(restaurants.isActive, true),
      eq(restaurants.isDemo, false),
      isNull(restaurants.deletedAt),
    ];

    if (filters.district) {
      baseConditions.push(eq(dishSearchIndex.district, filters.district));
    }
    if (filters.city) {
      baseConditions.push(eq(restaurants.city, filters.city));
    }
    if (filters.categoryName) {
      baseConditions.push(
        eq(dishSearchIndex.categoryName, filters.categoryName),
      );
    }
    if (filters.catalogType) {
      baseConditions.push(eq(dishSearchIndex.catalogType, filters.catalogType));
    }
    if (filters.priceMin !== undefined) {
      baseConditions.push(
        sql`COALESCE(${dishSearchIndex.priceCents}, 0) >= ${toRequiredCents(filters.priceMin)}`,
      );
    }
    if (filters.priceMax !== undefined) {
      baseConditions.push(
        sql`COALESCE(${dishSearchIndex.priceCents}, 0) <= ${toRequiredCents(filters.priceMax)}`,
      );
    }
    if (filters.takeaway || serviceIntent === "takeaway") {
      baseConditions.push(eq(dishSearchIndex.supportsTakeaway, true));
    }
    if (filters.delivery || serviceIntent === "delivery") {
      baseConditions.push(eq(dishSearchIndex.supportsDelivery, true));
    }
    if (filters.marketId) {
      baseConditions.push(
        or(
          eq(dishSearchIndex.primaryMarketId, filters.marketId),
          like(dishSearchIndex.marketIds, `%"${filters.marketId}"%`),
        )!,
      );
    }
    if (geoFilter) {
      baseConditions.push(
        gte(dishSearchIndex.latitude, geoFilter.box.southLat),
        lte(dishSearchIndex.latitude, geoFilter.box.northLat),
        gte(dishSearchIndex.longitude, geoFilter.box.westLng),
        lte(dishSearchIndex.longitude, geoFilter.box.eastLng),
      );
    }

    const prefixConditions: SQL[] = [...baseConditions];
    if (normalized) {
      const rawQuery = q?.trim() ?? "";
      const tagPattern = `%${rawQuery}%`;
      const catalogAliasConditions = this.getCatalogQueryAliases(rawQuery)
        .filter((alias) => alias !== rawQuery)
        .flatMap((alias) => {
          const aliasPattern = `%${alias}%`;
          return [
            like(
              dishSearchIndex.dishNameNormalized,
              `${this.normalizeQuery(alias)}%`,
            ),
            like(dishSearchIndex.tags, aliasPattern),
            like(dishSearchIndex.categoryName, aliasPattern),
          ];
        });
      const searchConditions: Array<SQL | undefined> = [
        // FTS5 trigram substring match on dish_name/category/tags. Catches
        // mid-string CJK matches that the prefix LIKE below misses (e.g.
        // "牛肉麵" → "蕃茄牛肉麵"). Additive: it only widens recall, never
        // removes the existing LIKE behavior. Trigram requires >= 3 chars, so
        // 1-2 char queries fall through to LIKE only.
        this.ftsMatchCondition(rawQuery),
        like(dishSearchIndex.dishNameNormalized, `${normalized}%`),
        like(dishSearchIndex.tags, tagPattern),
        like(dishSearchIndex.categoryName, tagPattern),
        ...catalogAliasConditions,
        like(dishSearchIndex.district, tagPattern),
        like(restaurants.name, tagPattern),
        like(restaurants.city, tagPattern),
        like(restaurants.district, tagPattern),
        this.marketVendorKeywordCondition(tagPattern, filters.marketId),
        semanticMenuItemIds.length > 0
          ? inArray(dishSearchIndex.menuItemId, semanticMenuItemIds)
          : undefined,
      ];
      const searchCondition = or(
        ...searchConditions.filter((condition): condition is SQL =>
          Boolean(condition),
        ),
      );
      if (searchCondition) prefixConditions.push(searchCondition);
    }
    const whereClause = and(...prefixConditions);
    const [queryResult, countRows] = await Promise.all([
      this.db
        .select({
          menuItemId: dishSearchIndex.menuItemId,
          dishName: dishSearchIndex.dishName,
          priceCents: dishSearchIndex.priceCents,
          catalogType: dishSearchIndex.catalogType,
          categoryName: dishSearchIndex.categoryName,
          restaurantId: dishSearchIndex.restaurantId,
          restaurantName: restaurants.name,
          restaurantSettings: restaurants.settings,
          district: dishSearchIndex.district,
          businessHours: restaurants.businessHours,
          timezone: restaurants.timezone,
          supportsTakeaway: dishSearchIndex.supportsTakeaway,
          supportsDelivery: dishSearchIndex.supportsDelivery,
          tags: dishSearchIndex.tags,
          latitude: dishSearchIndex.latitude,
          longitude: dishSearchIndex.longitude,
          marketVendorMarketId: this.marketVendorMarketId(filters.marketId),
          marketVendorStallNumber: this.marketVendorStallNumber(
            filters.marketId,
          ),
          marketVendorLocationLabel: this.marketVendorLocationLabel(
            filters.marketId,
          ),
          marketVendorIsPrimary: this.marketVendorIsPrimary(filters.marketId),
          marketVendorMarketSlug: this.marketVendorMarketSlug(filters.marketId),
          marketVendorMarketName: this.marketVendorMarketName(filters.marketId),
        })
        .from(dishSearchIndex)
        .innerJoin(
          restaurants,
          eq(dishSearchIndex.restaurantId, restaurants.id),
        )
        .innerJoin(menuItems, eq(dishSearchIndex.menuItemId, menuItems.id))
        .where(whereClause)
        .orderBy(
          ...this.getDishSearchOrderBy(
            filters,
            effectivePrice,
            normalized,
            semanticMenuItemIds,
          ),
        )
        .limit(queryLimit)
        .offset(queryOffset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(dishSearchIndex)
        .innerJoin(
          restaurants,
          eq(dishSearchIndex.restaurantId, restaurants.id),
        )
        .where(whereClause),
    ]);
    const rawTotal = Number(countRows[0]?.count);
    let total =
      Number.isFinite(rawTotal) && rawTotal >= 0
        ? rawTotal
        : queryResult.length;

    // 4. KV tag index lookup
    let tagMatches: number[] = [];
    const tagIndex = normalized ? await this.kv.get("search:tags:index") : null;
    if (tagIndex && normalized) {
      const index: Record<string, { menuItemId: number }[]> =
        JSON.parse(tagIndex);
      if (index[normalized] || (q && index[q])) {
        tagMatches = (
          index[normalized] ||
          (q ? index[q] : undefined) ||
          []
        ).map((t) => t.menuItemId);
      }
    }

    // Merge tag matches not already in prefix results (cap at 50 to stay within D1's 100-param limit)
    const prefixIds = new Set(queryResult.map((r) => r.menuItemId));
    const allRows = [...queryResult];
    if (tagMatches.length > 0) {
      const missingIds = tagMatches
        .filter((id) => !prefixIds.has(id))
        .slice(0, 50);
      if (missingIds.length > 0) {
        const tagResults = await this.db
          .select({
            menuItemId: dishSearchIndex.menuItemId,
            dishName: dishSearchIndex.dishName,
            priceCents: dishSearchIndex.priceCents,
            catalogType: dishSearchIndex.catalogType,
            categoryName: dishSearchIndex.categoryName,
            restaurantId: dishSearchIndex.restaurantId,
            restaurantName: restaurants.name,
            restaurantSettings: restaurants.settings,
            district: dishSearchIndex.district,
            businessHours: restaurants.businessHours,
            timezone: restaurants.timezone,
            supportsTakeaway: dishSearchIndex.supportsTakeaway,
            supportsDelivery: dishSearchIndex.supportsDelivery,
            tags: dishSearchIndex.tags,
            latitude: dishSearchIndex.latitude,
            longitude: dishSearchIndex.longitude,
            marketVendorMarketId: this.marketVendorMarketId(filters.marketId),
            marketVendorStallNumber: this.marketVendorStallNumber(
              filters.marketId,
            ),
            marketVendorLocationLabel: this.marketVendorLocationLabel(
              filters.marketId,
            ),
            marketVendorIsPrimary: this.marketVendorIsPrimary(filters.marketId),
            marketVendorMarketSlug: this.marketVendorMarketSlug(
              filters.marketId,
            ),
            marketVendorMarketName: this.marketVendorMarketName(
              filters.marketId,
            ),
          })
          .from(dishSearchIndex)
          .innerJoin(
            restaurants,
            eq(dishSearchIndex.restaurantId, restaurants.id),
          )
          .innerJoin(menuItems, eq(dishSearchIndex.menuItemId, menuItems.id))
          .where(
            and(
              ...baseConditions,
              inArray(dishSearchIndex.menuItemId, missingIds),
            ),
          )
          .orderBy(
            ...this.getDishSearchOrderBy(
              filters,
              effectivePrice,
              normalized,
              semanticMenuItemIds,
            ),
          )
          .limit(50);
        allRows.push(...tagResults);
      }
    }

    // 5. Map results + openNow filter
    let results: DishSearchResult[] = allRows.map((row) => {
      const openingHoursStatus = getOpeningHoursStatus(
        row.businessHours ?? null,
        row.timezone,
      );
      return {
        resultType: catalogResultTypeFromTags(row.tags, row.catalogType),
        menuItemId: row.menuItemId,
        dishName: row.dishName,
        price: row.priceCents != null ? fromCents(row.priceCents) : 0,
        priceCents: row.priceCents,
        priceLabel: null,
        currency: displayCurrencyFromRestaurantSettings(row.restaurantSettings),
        categoryName: row.categoryName,
        restaurantId: row.restaurantId,
        restaurantName: row.restaurantName,
        district: this.publicDiscoveryDistrict(row.district),
        isOpen: openingHoursStatus === "open",
        openingHoursStatus,
        supportsTakeaway: row.supportsTakeaway,
        supportsDelivery: row.supportsDelivery,
        tags: row.tags ?? [],
        detailUrl: this.restaurantDetailUrl(row.restaurantId),
        menuUrl: this.restaurantMenuUrl(row.restaurantId),
        menuItemUrl: this.menuItemUrl(row.menuItemId),
        serviceItemsUrl: this.restaurantServiceItemsUrl(row.restaurantId),
        ...(geoFilter && row.latitude != null && row.longitude != null
          ? {
              distanceKm: this.resultDistanceKm(geoFilter, {
                latitude: row.latitude,
                longitude: row.longitude,
              }),
            }
          : {}),
        marketVendor: this.marketVendorContext(row),
      };
    });

    if (geoFilter) {
      results = results.filter((result) => {
        const row = allRows.find((r) => r.menuItemId === result.menuItemId);
        if (row?.latitude == null || row.longitude == null) return false;
        return (
          distanceKm(
            { lat: geoFilter.lat, lng: geoFilter.lng },
            { lat: row.latitude, lng: row.longitude },
          ) <= geoFilter.radiusKm
        );
      });
    }

    if (filters.openNow) {
      // Missing hours are not proof the restaurant is closed. Keep those
      // results visible with the explicit "unavailable" label instead of
      // silently making an incomplete profile disappear from discovery.
      results = results.filter((r) => r.openingHoursStatus !== "closed");
    }
    if (filters.sortBy === "distance") {
      results = this.sortDistanceResultsFirst(results);
    }
    if (filters.sortBy === "open_now") {
      results = this.sortOpenResultsFirst(results);
    }

    // 6. Cache and return
    if (tagMatches.length > 0 && total < results.length) {
      total = results.length;
    }
    if (requiresPostFilterPagination) {
      if (filters.openNow) {
        total = results.length;
      }
      if (geoFilter) {
        total = results.length;
      }
      results = results.slice(offset, offset + limit);
    }
    const scope = await this.getSearchScopeMetadata(filters);
    const response = { results, total, page, limit, scope };
    const semanticWarmupScheduled =
      normalized &&
      semanticResult.embeddingStatus === "cache-miss" &&
      results.length < limit &&
      this.semanticSearch.warmQueryEmbedding(q);
    if (!semanticWarmupScheduled) {
      await this.kv.put(
        cacheKey,
        JSON.stringify({ results, total, scope, cachedAt: Date.now() }),
        { expirationTtl: KV_SEARCH_TTL },
      );
    }

    return response;
  }

  async listDishCategories(
    filters: SearchFilters,
  ): Promise<{ categories: string[] }> {
    filters = await this.resolveMarketSlug(filters);
    const searchVersion = await this.getSearchVersion();
    const cacheKey = this.buildCacheKey(
      "search:categories",
      filters,
      searchVersion,
    );
    const cached = await this.kv.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const conditions: SQL[] = [
      eq(dishSearchIndex.isAvailable, true),
      eq(restaurants.isAvailable, true),
      eq(restaurants.isActive, true),
      eq(restaurants.isDemo, false),
      isNull(restaurants.deletedAt),
      sql`${dishSearchIndex.categoryName} IS NOT NULL`,
      sql`${dishSearchIndex.categoryName} != ''`,
    ];
    if (filters.district) {
      conditions.push(eq(dishSearchIndex.district, filters.district));
    }
    if (filters.city) {
      conditions.push(eq(restaurants.city, filters.city));
    }
    if (filters.catalogType) {
      conditions.push(eq(dishSearchIndex.catalogType, filters.catalogType));
    }
    if (filters.takeaway) {
      conditions.push(eq(dishSearchIndex.supportsTakeaway, true));
    }
    if (filters.delivery) {
      conditions.push(eq(dishSearchIndex.supportsDelivery, true));
    }
    if (filters.marketId) {
      conditions.push(
        or(
          eq(dishSearchIndex.primaryMarketId, filters.marketId),
          like(dishSearchIndex.marketIds, `%"${filters.marketId}"%`),
        )!,
      );
    }

    const rows = await this.db
      .select({ categoryName: dishSearchIndex.categoryName })
      .from(dishSearchIndex)
      .innerJoin(restaurants, eq(dishSearchIndex.restaurantId, restaurants.id))
      .where(and(...conditions))
      .groupBy(dishSearchIndex.categoryName)
      .orderBy(asc(dishSearchIndex.categoryName));

    const data = {
      categories: rows
        .map((row) => row.categoryName)
        .filter((category): category is string => Boolean(category)),
    };
    await this.kv.put(cacheKey, JSON.stringify(data), {
      expirationTtl: KV_SEARCH_TTL,
    });
    return data;
  }

  async browseRestaurants(
    filters: SearchFilters,
  ): Promise<SearchResponse<RestaurantListItem>> {
    filters = await this.resolveMarketSlug(filters);
    const { page = 1, limit = 20 } = filters;
    const geoFilter = this.getGeoFilter(filters);
    const canUseDistrictCache =
      filters.district &&
      !filters.q &&
      !filters.city &&
      !filters.marketId &&
      !filters.cuisineType &&
      !filters.openNow &&
      !geoFilter &&
      (!filters.sortBy || filters.sortBy === "popular");

    // Check KV cache for district-based browse
    if (canUseDistrictCache) {
      const kvKey = `search:restaurants:hours2:district:${filters.district}`;
      const cached = await this.kv.get(kvKey);
      if (cached) {
        let restaurantList: RestaurantListItem[] = JSON.parse(cached).map(
          (restaurant: RestaurantListItem) => ({
            ...restaurant,
            type: this.publicDiscoveryType(restaurant.type),
            district: this.publicDiscoveryDistrict(restaurant.district),
            openingHoursStatus:
              restaurant.openingHoursStatus ??
              (restaurant.isOpen ? "open" : "closed"),
          }),
        );
        if (filters.takeaway)
          restaurantList = restaurantList.filter((r) => r.supportsTakeaway);
        if (filters.delivery)
          restaurantList = restaurantList.filter((r) => r.supportsDelivery);
        if (filters.priceRange)
          restaurantList = restaurantList.filter(
            (r) => r.priceRange === filters.priceRange,
          );
        const start = (page - 1) * limit;
        return {
          results: restaurantList.slice(start, start + limit),
          total: restaurantList.length,
          page,
          limit,
        };
      }
    }

    const offset = (page - 1) * limit;
    const requiresPostFilterPagination = Boolean(
      filters.openNow ||
      geoFilter ||
      filters.sortBy === "open_now" ||
      filters.sortBy === "distance",
    );
    const queryLimit = requiresPostFilterPagination
      ? POST_FILTER_SCAN_LIMIT
      : limit;
    const queryOffset = requiresPostFilterPagination ? 0 : offset;

    const conditions: SQL[] = [
      eq(restaurants.isAvailable, true),
      eq(restaurants.isActive, true),
      eq(restaurants.isDemo, false),
      isNull(restaurants.deletedAt),
    ];

    if (filters.q) {
      const pattern = `%${filters.q}%`;
      conditions.push(
        or(
          like(restaurants.name, pattern),
          like(restaurants.type, pattern),
          like(restaurants.category, pattern),
          like(restaurants.description, pattern),
          like(restaurants.cuisineTags, pattern),
          this.marketVendorKeywordCondition(pattern, filters.marketId),
        )!,
      );
    }
    if (filters.district) {
      conditions.push(eq(restaurants.district, filters.district));
    }
    if (filters.city) {
      conditions.push(eq(restaurants.city, filters.city));
    }
    if (filters.cuisineType) {
      conditions.push(eq(restaurants.type, filters.cuisineType));
    }
    if (filters.priceRange) {
      conditions.push(eq(restaurants.priceRange, filters.priceRange));
    }
    if (filters.takeaway) {
      conditions.push(eq(restaurants.supportsTakeaway, true));
    }
    if (filters.delivery) {
      conditions.push(eq(restaurants.supportsDelivery, true));
    }
    if (filters.marketId) {
      conditions.push(sql`EXISTS (
        SELECT 1
        FROM restaurant_market_memberships rmm
        WHERE rmm.restaurant_id = ${restaurants.id}
          AND rmm.market_id = ${filters.marketId}
          AND rmm.left_at_ms IS NULL
      )`);
    }
    if (geoFilter) {
      conditions.push(
        gte(restaurants.latitude, geoFilter.box.southLat),
        lte(restaurants.latitude, geoFilter.box.northLat),
        gte(restaurants.longitude, geoFilter.box.westLng),
        lte(restaurants.longitude, geoFilter.box.eastLng),
      );
    }

    const orderByClause =
      filters.sortBy === "rating"
        ? desc(restaurants.rating)
        : desc(restaurants.totalOrders);

    const [result, countRows] = await Promise.all([
      this.db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          type: restaurants.type,
          category: restaurants.category,
          district: restaurants.district,
          city: restaurants.city,
          priceRange: restaurants.priceRange,
          rating: restaurants.rating,
          businessHours: restaurants.businessHours,
          timezone: restaurants.timezone,
          supportsTakeaway: restaurants.supportsTakeaway,
          supportsDelivery: restaurants.supportsDelivery,
          logoUrl: restaurants.logoUrl,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
        })
        .from(restaurants)
        .where(and(...conditions))
        .orderBy(orderByClause)
        .limit(queryLimit)
        .offset(queryOffset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(restaurants)
        .where(and(...conditions)),
    ]);

    const restaurantIds = result.map((row) => row.id);
    const [marketVendorByRestaurant, accessCountsByRestaurant] =
      await Promise.all([
        this.restaurantBrowseMarketVendors(restaurantIds, filters.marketId),
        this.restaurantAccessCounts(restaurantIds),
      ]);

    const restaurantList: RestaurantListItem[] = result.map((row) => {
      const marketVendor = marketVendorByRestaurant.get(row.id);
      const openingHoursStatus = getOpeningHoursStatus(
        row.businessHours ?? null,
        row.timezone,
      );
      const accessCounts = accessCountsByRestaurant.get(row.id) ?? {
        availableMenuItemCount: 0,
        publicServiceItemCount: 0,
      };
      return {
        restaurantId: row.id,
        name: row.name,
        type: this.publicDiscoveryType(row.type),
        category: row.category,
        district: this.publicDiscoveryDistrict(row.district),
        city: row.city,
        priceRange: row.priceRange,
        rating: row.rating,
        isOpen: openingHoursStatus === "open",
        openingHoursStatus,
        supportsTakeaway: row.supportsTakeaway,
        supportsDelivery: row.supportsDelivery,
        imageUrl: row.logoUrl,
        detailUrl: this.restaurantDetailUrl(row.id),
        menuUrl: this.restaurantMenuUrl(row.id),
        serviceItemsUrl: this.restaurantServiceItemsUrl(row.id),
        ...accessCounts,
        ...(geoFilter && row.latitude != null && row.longitude != null
          ? {
              distanceKm: this.resultDistanceKm(geoFilter, {
                latitude: row.latitude,
                longitude: row.longitude,
              }),
            }
          : {}),
        ...(marketVendor ? { marketVendor } : {}),
      };
    });

    // Cache district results in KV (only when no secondary filters and page=1 to avoid partial cache)
    if (
      canUseDistrictCache &&
      !filters.takeaway &&
      !filters.delivery &&
      !filters.priceRange &&
      page === 1
    ) {
      const kvKey = `search:restaurants:hours2:district:${filters.district}`;
      await this.kv.put(kvKey, JSON.stringify(restaurantList), {
        expirationTtl: KV_RESTAURANT_TTL,
      });
    }

    let filtered = restaurantList;
    if (geoFilter) {
      filtered = result
        .filter(
          (row) =>
            row.latitude != null &&
            row.longitude != null &&
            distanceKm(
              { lat: geoFilter.lat, lng: geoFilter.lng },
              { lat: row.latitude, lng: row.longitude },
            ) <= geoFilter.radiusKm,
        )
        .map((row) => restaurantList.find((r) => r.restaurantId === row.id)!)
        .filter(Boolean);
    }
    if (filters.openNow) {
      filtered = filtered.filter((r) => r.openingHoursStatus !== "closed");
    }
    if (filters.sortBy === "distance") {
      filtered = this.sortDistanceResultsFirst(filtered);
    }
    if (filters.sortBy === "open_now") {
      filtered = this.sortOpenResultsFirst(filtered);
    }

    const rawTotal = Number(countRows[0]?.count);
    const total =
      filters.openNow || geoFilter
        ? filtered.length
        : Number.isFinite(rawTotal) && rawTotal >= 0
          ? rawTotal
          : filtered.length;
    const results = requiresPostFilterPagination
      ? filtered.slice(offset, offset + limit)
      : filtered;

    return { results, total, page, limit };
  }

  async searchServices(
    filters: SearchFilters,
  ): Promise<SearchResponse<ServiceSearchResult>> {
    filters = await this.resolveMarketSlug(filters);
    const { q, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const geoFilter = this.getGeoFilter(filters);
    const requiresPostFilterPagination = Boolean(
      filters.openNow ||
      geoFilter ||
      filters.sortBy === "open_now" ||
      filters.sortBy === "distance",
    );
    const queryLimit = requiresPostFilterPagination
      ? POST_FILTER_SCAN_LIMIT
      : limit;
    const queryOffset = requiresPostFilterPagination ? 0 : offset;
    const conditions: SQL[] = [
      eq(restaurantServiceItems.isActive, true),
      eq(restaurantServiceItems.isPublic, true),
      isNull(restaurantServiceItems.deletedAt),
      eq(restaurants.isAvailable, true),
      eq(restaurants.isActive, true),
      eq(restaurants.isDemo, false),
      isNull(restaurants.deletedAt),
    ];

    if (filters.city) {
      conditions.push(eq(restaurants.city, filters.city));
    }
    if (filters.district) {
      conditions.push(eq(restaurants.district, filters.district));
    }
    if (filters.marketId) {
      conditions.push(sql`EXISTS (
        SELECT 1
        FROM restaurant_market_memberships rmm
        WHERE rmm.restaurant_id = ${restaurants.id}
          AND rmm.market_id = ${filters.marketId}
          AND rmm.left_at_ms IS NULL
      )`);
    }
    if (filters.serviceType) {
      conditions.push(
        eq(restaurantServiceItems.serviceType, filters.serviceType),
      );
    }
    if (filters.takeaway) {
      conditions.push(eq(restaurants.supportsTakeaway, true));
    }
    if (filters.delivery) {
      conditions.push(eq(restaurants.supportsDelivery, true));
    }
    if (geoFilter) {
      conditions.push(
        gte(restaurants.latitude, geoFilter.box.southLat),
        lte(restaurants.latitude, geoFilter.box.northLat),
        gte(restaurants.longitude, geoFilter.box.westLng),
        lte(restaurants.longitude, geoFilter.box.eastLng),
      );
    }
    if (q) {
      const pattern = `%${q.trim()}%`;
      const serviceTypeIntent = this.getServiceTypeIntent(q);
      const serviceAliases = this.getServiceQueryAliases(q);
      const searchConditions: SQL[] = [
        like(restaurantServiceItems.name, pattern),
        like(restaurantServiceItems.description, pattern),
        like(restaurantServiceItems.keywords, pattern),
        like(restaurantServiceItems.tags, pattern),
        like(restaurantServiceItems.serviceType, pattern),
        like(restaurants.name, pattern),
        like(restaurants.city, pattern),
        like(restaurants.district, pattern),
        this.marketVendorKeywordCondition(pattern, filters.marketId),
        ...serviceAliases
          .filter((alias) => alias !== q.trim())
          .flatMap((alias) => {
            const aliasPattern = `%${alias}%`;
            return [
              like(restaurantServiceItems.name, aliasPattern),
              like(restaurantServiceItems.description, aliasPattern),
              like(restaurantServiceItems.keywords, aliasPattern),
              like(restaurantServiceItems.tags, aliasPattern),
            ];
          }),
      ];
      if (serviceTypeIntent) {
        searchConditions.push(
          eq(restaurantServiceItems.serviceType, serviceTypeIntent),
        );
      }
      const searchCondition = or(...searchConditions);
      if (searchCondition) conditions.push(searchCondition);
    }

    const whereClause = and(...conditions);
    const [rows, countRows] = await Promise.all([
      this.db
        .select({
          serviceItemId: restaurantServiceItems.id,
          name: restaurantServiceItems.name,
          description: restaurantServiceItems.description,
          serviceType: restaurantServiceItems.serviceType,
          priceCents: restaurantServiceItems.priceCents,
          priceLabel: restaurantServiceItems.priceLabel,
          durationMinutes: restaurantServiceItems.durationMinutes,
          requiresBooking: restaurantServiceItems.requiresBooking,
          bookingUrl: restaurantServiceItems.bookingUrl,
          tags: restaurantServiceItems.tags,
          restaurantId: restaurantServiceItems.restaurantId,
          restaurantName: restaurants.name,
          restaurantSettings: restaurants.settings,
          district: restaurants.district,
          city: restaurants.city,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
          businessHours: restaurants.businessHours,
          timezone: restaurants.timezone,
          marketVendorMarketId: this.marketVendorMarketId(filters.marketId),
          marketVendorStallNumber: this.marketVendorStallNumber(
            filters.marketId,
          ),
          marketVendorLocationLabel: this.marketVendorLocationLabel(
            filters.marketId,
          ),
          marketVendorIsPrimary: this.marketVendorIsPrimary(filters.marketId),
          marketVendorMarketSlug: this.marketVendorMarketSlug(filters.marketId),
          marketVendorMarketName: this.marketVendorMarketName(filters.marketId),
        })
        .from(restaurantServiceItems)
        .innerJoin(
          restaurants,
          eq(restaurantServiceItems.restaurantId, restaurants.id),
        )
        .where(whereClause)
        .orderBy(...this.getServiceSearchOrderBy(filters))
        .limit(queryLimit)
        .offset(queryOffset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(restaurantServiceItems)
        .innerJoin(
          restaurants,
          eq(restaurantServiceItems.restaurantId, restaurants.id),
        )
        .where(whereClause),
    ]);

    let results: ServiceSearchResult[] = rows.map((row) => {
      const openingHoursStatus = getOpeningHoursStatus(
        row.businessHours ?? null,
        row.timezone,
      );
      return {
        resultType: "service",
        serviceItemId: row.serviceItemId,
        name: row.name,
        description: row.description,
        serviceType: row.serviceType,
        priceCents: row.priceCents,
        priceLabel: row.priceLabel,
        currency: displayCurrencyFromRestaurantSettings(row.restaurantSettings),
        durationMinutes: row.durationMinutes,
        requiresBooking: row.requiresBooking,
        bookingUrl: row.bookingUrl,
        tags: row.tags ?? [],
        restaurantId: row.restaurantId,
        restaurantName: row.restaurantName,
        district: this.publicDiscoveryDistrict(row.district),
        city: row.city,
        isOpen: openingHoursStatus === "open",
        openingHoursStatus,
        detailUrl: this.restaurantDetailUrl(row.restaurantId),
        menuUrl: this.restaurantMenuUrl(row.restaurantId),
        serviceItemsUrl: this.restaurantServiceItemsUrl(row.restaurantId),
        ...(geoFilter && row.latitude != null && row.longitude != null
          ? {
              distanceKm: this.resultDistanceKm(geoFilter, {
                latitude: row.latitude,
                longitude: row.longitude,
              }),
            }
          : {}),
        marketVendor: this.marketVendorContext(row),
      };
    });

    if (geoFilter) {
      results = results.filter((result) => result.distanceKm != null);
    }

    if (filters.openNow) {
      results = results.filter(
        (result) => result.openingHoursStatus !== "closed",
      );
    }
    if (filters.sortBy === "distance") {
      results = this.sortDistanceResultsFirst(results);
    }
    if (filters.sortBy === "open_now") {
      results = this.sortOpenResultsFirst(results);
    }

    const rawTotal = Number(countRows[0]?.count);
    const total =
      filters.openNow || geoFilter
        ? results.length
        : Number.isFinite(rawTotal) && rawTotal >= 0
          ? rawTotal
          : results.length;
    if (requiresPostFilterPagination) {
      results = results.slice(offset, offset + limit);
    }

    return {
      results,
      total,
      page,
      limit,
      scope: await this.getSearchScopeMetadata(filters),
    };
  }

  async listServiceTypes(filters: SearchFilters): Promise<{
    serviceTypes: Array<{
      serviceType: NonNullable<SearchFilters["serviceType"]>;
      count: number;
    }>;
  }> {
    filters = await this.resolveMarketSlug(filters);
    const conditions: SQL[] = [
      eq(restaurantServiceItems.isActive, true),
      eq(restaurantServiceItems.isPublic, true),
      isNull(restaurantServiceItems.deletedAt),
      eq(restaurants.isAvailable, true),
      eq(restaurants.isActive, true),
      eq(restaurants.isDemo, false),
      isNull(restaurants.deletedAt),
    ];

    if (filters.city) {
      conditions.push(eq(restaurants.city, filters.city));
    }
    if (filters.district) {
      conditions.push(eq(restaurants.district, filters.district));
    }
    if (filters.marketId) {
      conditions.push(sql`EXISTS (
        SELECT 1
        FROM restaurant_market_memberships rmm
        WHERE rmm.restaurant_id = ${restaurants.id}
          AND rmm.market_id = ${filters.marketId}
          AND rmm.left_at_ms IS NULL
      )`);
    }
    if (filters.takeaway) {
      conditions.push(eq(restaurants.supportsTakeaway, true));
    }
    if (filters.delivery) {
      conditions.push(eq(restaurants.supportsDelivery, true));
    }

    if (filters.openNow) {
      const rows = await this.db
        .select({
          serviceType: restaurantServiceItems.serviceType,
          businessHours: restaurants.businessHours,
          timezone: restaurants.timezone,
        })
        .from(restaurantServiceItems)
        .innerJoin(
          restaurants,
          eq(restaurantServiceItems.restaurantId, restaurants.id),
        )
        .where(and(...conditions));

      const counts = new Map<
        NonNullable<SearchFilters["serviceType"]>,
        number
      >();

      for (const row of rows) {
        if (!isOpenNow(row.businessHours ?? null, row.timezone)) {
          continue;
        }

        counts.set(row.serviceType, (counts.get(row.serviceType) ?? 0) + 1);
      }

      return {
        serviceTypes: Array.from(counts, ([serviceType, count]) => ({
          serviceType,
          count,
        })).sort(
          (a, b) =>
            b.count - a.count || a.serviceType.localeCompare(b.serviceType),
        ),
      };
    }

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
      .where(and(...conditions))
      .groupBy(restaurantServiceItems.serviceType)
      .orderBy(desc(itemCount), asc(restaurantServiceItems.serviceType));

    return {
      serviceTypes: rows.map((row) => ({
        serviceType: row.serviceType,
        count: Number(row.count),
      })),
    };
  }

  async getPopular(): Promise<{
    keywords: string[];
    dishes: DishSearchResult[];
    restaurants: RestaurantListItem[];
  }> {
    const keywordsJson = await this.kv.get("search:meta:popular-keywords");
    const keywords: string[] = keywordsJson ? JSON.parse(keywordsJson) : [];

    const topDishes = await this.db
      .select({
        menuItemId: dishSearchIndex.menuItemId,
        dishName: dishSearchIndex.dishName,
        priceCents: dishSearchIndex.priceCents,
        catalogType: dishSearchIndex.catalogType,
        categoryName: dishSearchIndex.categoryName,
        restaurantId: dishSearchIndex.restaurantId,
        restaurantName: restaurants.name,
        restaurantSettings: restaurants.settings,
        district: dishSearchIndex.district,
        businessHours: restaurants.businessHours,
        timezone: restaurants.timezone,
        supportsTakeaway: dishSearchIndex.supportsTakeaway,
        supportsDelivery: dishSearchIndex.supportsDelivery,
        tags: dishSearchIndex.tags,
        orderCount: menuItems.orderCount,
      })
      .from(dishSearchIndex)
      .innerJoin(restaurants, eq(dishSearchIndex.restaurantId, restaurants.id))
      .innerJoin(menuItems, eq(dishSearchIndex.menuItemId, menuItems.id))
      .where(
        and(
          eq(dishSearchIndex.isAvailable, true),
          eq(restaurants.isAvailable, true),
          eq(restaurants.isActive, true),
          eq(restaurants.isDemo, false),
          isNull(restaurants.deletedAt),
        ),
      )
      .orderBy(desc(menuItems.orderCount))
      .limit(10);

    const dishes: DishSearchResult[] = topDishes.map((row) => {
      const openingHoursStatus = getOpeningHoursStatus(
        row.businessHours ?? null,
        row.timezone,
      );
      return {
        resultType: catalogResultTypeFromTags(row.tags, row.catalogType),
        menuItemId: row.menuItemId,
        dishName: row.dishName,
        price: row.priceCents != null ? fromCents(row.priceCents) : 0,
        priceCents: row.priceCents,
        priceLabel: null,
        currency: displayCurrencyFromRestaurantSettings(row.restaurantSettings),
        categoryName: row.categoryName,
        restaurantId: row.restaurantId,
        restaurantName: row.restaurantName,
        district: this.publicDiscoveryDistrict(row.district),
        isOpen: openingHoursStatus === "open",
        openingHoursStatus,
        supportsTakeaway: row.supportsTakeaway,
        supportsDelivery: row.supportsDelivery,
        tags: row.tags ?? [],
        detailUrl: this.restaurantDetailUrl(row.restaurantId),
        menuUrl: this.restaurantMenuUrl(row.restaurantId),
        menuItemUrl: this.menuItemUrl(row.menuItemId),
        serviceItemsUrl: this.restaurantServiceItemsUrl(row.restaurantId),
      };
    });

    const topRestaurants = await this.browseRestaurants({
      sortBy: "popular",
      limit: 10,
    });

    return { keywords, dishes, restaurants: topRestaurants.results };
  }

  async getRestaurantMenu(restaurantId: string) {
    return await this.db
      .select({
        id: menuItems.id,
        name: menuItems.name,
        description: menuItems.description,
        catalogType: menuItems.catalogType,
        price: sql<number>`COALESCE(${menuItems.priceCents}, 0) / 100.0`,
        is_available: menuItems.isAvailable,
        image_url: menuItems.imageUrl,
        category_name: categories.name,
      })
      .from(menuItems)
      .innerJoin(restaurants, eq(menuItems.restaurantId, restaurants.id))
      .leftJoin(categories, eq(menuItems.categoryId, categories.id))
      .where(
        and(
          eq(menuItems.restaurantId, restaurantId),
          eq(menuItems.isAvailable, true),
          isNull(menuItems.deletedAt),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
          or(
            isNull(menuItems.categoryId),
            and(
              eq(categories.isActive, true),
              eq(categories.isVisible, true),
              isNull(categories.deletedAt),
            ),
          ),
        ),
      )
      .orderBy(asc(categories.sortOrder), asc(menuItems.sortOrder));
  }

  async getRestaurantServices(restaurantId: string) {
    const rows = await this.db
      .select({
        id: restaurantServiceItems.id,
        restaurantId: restaurantServiceItems.restaurantId,
        name: restaurantServiceItems.name,
        description: restaurantServiceItems.description,
        serviceType: restaurantServiceItems.serviceType,
        priceCents: restaurantServiceItems.priceCents,
        priceLabel: restaurantServiceItems.priceLabel,
        durationMinutes: restaurantServiceItems.durationMinutes,
        requiresBooking: restaurantServiceItems.requiresBooking,
        bookingUrl: restaurantServiceItems.bookingUrl,
        availableHours: restaurantServiceItems.availableHours,
        tags: restaurantServiceItems.tags,
        keywords: restaurantServiceItems.keywords,
        sortOrder: restaurantServiceItems.sortOrder,
      })
      .from(restaurantServiceItems)
      .innerJoin(
        restaurants,
        eq(restaurantServiceItems.restaurantId, restaurants.id),
      )
      .where(
        and(
          eq(restaurantServiceItems.restaurantId, restaurantId),
          eq(restaurantServiceItems.isActive, true),
          eq(restaurantServiceItems.isPublic, true),
          isNull(restaurantServiceItems.deletedAt),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
        ),
      )
      .orderBy(
        asc(restaurantServiceItems.sortOrder),
        asc(restaurantServiceItems.id),
      );

    return rows.map((row) => ({
      ...row,
      availableHours: row.availableHours ?? null,
      tags: row.tags ?? [],
    }));
  }

  async getTakeawayEligibility(restaurantId: string): Promise<
    | { eligible: true; shopQrCode: string }
    | {
        eligible: false;
        reason: "restaurant_disabled" | "takeaway_disabled" | "closed_now";
      }
  > {
    const [restaurant] = await this.db
      .select({
        isActive: restaurants.isActive,
        deletedAt: restaurants.deletedAt,
        supportsTakeaway: restaurants.supportsTakeaway,
        enableShopMode: restaurants.enableShopMode,
        shopQrCode: restaurants.shopQrCode,
        businessHours: restaurants.businessHours,
        timezone: restaurants.timezone,
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    if (!restaurant || !restaurant.isActive || restaurant.deletedAt) {
      return { eligible: false, reason: "restaurant_disabled" };
    }
    if (
      !restaurant.supportsTakeaway ||
      !restaurant.enableShopMode ||
      !restaurant.shopQrCode
    ) {
      return { eligible: false, reason: "takeaway_disabled" };
    }
    if (!isOpenNow(restaurant.businessHours ?? null, restaurant.timezone)) {
      return { eligible: false, reason: "closed_now" };
    }
    return { eligible: true, shopQrCode: restaurant.shopQrCode };
  }

  async getRestaurantMarkets(restaurantId: string): Promise<{
    memberships: Array<{
      marketId: string;
      stallNumber: string | null;
      locationLabel: string | null;
      isPrimary: boolean;
      market: {
        id: string;
        slug: string;
        name: string;
        type: string;
        city: string;
        district: string;
      };
      marketUrl: string;
    }>;
  }> {
    const rows = await this.db
      .select({
        marketId: restaurantMarketMemberships.marketId,
        stallNumber: restaurantMarketMemberships.stallNumber,
        locationLabel: restaurantMarketMemberships.locationLabel,
        isPrimary: restaurantMarketMemberships.isPrimary,
        marketSlug: markets.slug,
        marketName: markets.name,
        marketType: markets.type,
        city: markets.city,
        district: markets.district,
      })
      .from(restaurantMarketMemberships)
      .innerJoin(markets, eq(restaurantMarketMemberships.marketId, markets.id))
      .innerJoin(
        restaurants,
        eq(restaurantMarketMemberships.restaurantId, restaurants.id),
      )
      .where(
        and(
          eq(restaurantMarketMemberships.restaurantId, restaurantId),
          isNull(restaurantMarketMemberships.leftAt),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
          eq(markets.isActive, true),
          isNull(markets.deletedAt),
        ),
      )
      .orderBy(desc(restaurantMarketMemberships.isPrimary), asc(markets.name));

    return {
      memberships: rows.map((row) => ({
        marketId: row.marketId,
        stallNumber: row.stallNumber,
        locationLabel: row.locationLabel,
        isPrimary: row.isPrimary,
        market: {
          id: row.marketId,
          slug: row.marketSlug,
          name: row.marketName,
          type: row.marketType,
          city: row.city,
          district: row.district,
        },
        marketUrl: this.marketDetailUrl(row.marketSlug),
      })),
    };
  }

  async reindex(): Promise<{
    dishes: number;
    restaurants: number;
    semanticDishes: number;
    duration_ms: number;
  }> {
    const start = Date.now();

    const items = await this.db
      .select({
        menuItemId: menuItems.id,
        name: menuItems.name,
        priceCents: menuItems.priceCents,
        catalogType: menuItems.catalogType,
        isAvailable: menuItems.isAvailable,
        tags: menuItems.tags,
        keywords: menuItems.keywords,
        deletedAtMs: menuItems.deletedAt,
        categoryName: categories.name,
        categoryActive: categories.isActive,
        categoryVisible: categories.isVisible,
        categoryDeleted: categories.deletedAt,
        restaurantId: restaurants.id,
        district: restaurants.district,
        restaurantType: restaurants.type,
        supportsTakeaway: restaurants.supportsTakeaway,
        supportsDelivery: restaurants.supportsDelivery,
        restaurantDeleted: restaurants.deletedAt,
        latitude: restaurants.latitude,
        longitude: restaurants.longitude,
        marketIds: sql<string | null>`(
          SELECT json_group_array(rmm.market_id)
          FROM restaurant_market_memberships rmm
          INNER JOIN markets m ON m.id = rmm.market_id
          WHERE rmm.restaurant_id = restaurants.id
            AND rmm.left_at_ms IS NULL
            AND m.is_active = 1
            AND m.deleted_at_ms IS NULL
        )`,
        primaryMarketId: sql<string | null>`(
          SELECT rmm.market_id
          FROM restaurant_market_memberships rmm
          INNER JOIN markets m ON m.id = rmm.market_id
          WHERE rmm.restaurant_id = restaurants.id
            AND rmm.left_at_ms IS NULL
            AND rmm.is_primary = 1
            AND m.is_active = 1
            AND m.deleted_at_ms IS NULL
          LIMIT 1
        )`,
      })
      .from(menuItems)
      .leftJoin(categories, eq(menuItems.categoryId, categories.id))
      .innerJoin(restaurants, eq(menuItems.restaurantId, restaurants.id))
      .where(
        and(
          eq(restaurants.isActive, true),
          eq(restaurants.isDemo, false),
          isNull(restaurants.deletedAt),
        ),
      );

    // Build batch statements (D1 supports up to 100 per batch)
    // We keep the raw D1 reference for batch operations since Drizzle's batch API
    // doesn't support the same batching semantics as D1's native batch.
    const stmts: D1PreparedStatement[] = [];
    for (const item of items) {
      const isAvailable =
        item.isAvailable &&
        !item.deletedAtMs &&
        item.categoryActive === true &&
        item.categoryVisible === true &&
        !item.categoryDeleted &&
        !item.restaurantDeleted;
      const normalized = item.name.trim().toLowerCase().replace(/\s+/g, "");
      const itemTags = normalizeSearchTags(item.tags, item.keywords);

      stmts.push(
        this.d1
          .prepare(
            `INSERT OR REPLACE INTO dish_search_index
             (menu_item_id, restaurant_id, dish_name, dish_name_normalized, category_name, price_cents, catalog_type, is_available, tags, district, restaurant_type, supports_takeaway, supports_delivery, primary_market_id, market_ids, latitude, longitude, updated_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            item.menuItemId,
            item.restaurantId,
            item.name,
            normalized,
            item.categoryName,
            item.priceCents,
            item.catalogType ?? "menu_item",
            isAvailable ? 1 : 0,
            JSON.stringify(itemTags),
            item.district,
            item.restaurantType,
            item.supportsTakeaway ? 1 : 0,
            item.supportsDelivery ? 1 : 0,
            item.primaryMarketId,
            item.marketIds ?? "[]",
            item.latitude,
            item.longitude,
            Date.now(),
          ),
      );
    }

    await this.db.delete(dishSearchIndex);

    // Execute in batches of 100
    for (let i = 0; i < stmts.length; i += 100) {
      await this.d1.batch(stmts.slice(i, i + 100));
    }
    const dishCount = stmts.length;

    // Delete orphaned index entries
    await this.db
      .delete(dishSearchIndex)
      .where(
        sql`${dishSearchIndex.menuItemId} NOT IN (SELECT ${menuItems.id} FROM ${menuItems})`,
      );

    // Rebuild KV tag index
    const allTags = await this.db
      .select({
        menuItemId: dishSearchIndex.menuItemId,
        restaurantId: dishSearchIndex.restaurantId,
        dishName: dishSearchIndex.dishName,
        categoryName: dishSearchIndex.categoryName,
        priceCents: dishSearchIndex.priceCents,
        catalogType: dishSearchIndex.catalogType,
        tags: dishSearchIndex.tags,
        primaryMarketId: dishSearchIndex.primaryMarketId,
      })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.isAvailable, true));

    let semanticDishCount = 0;
    const tagIndexMap: Record<
      string,
      {
        menuItemId: number;
        restaurantId: string;
        dishName: string;
        price: number;
      }[]
    > = {};
    for (const row of allTags) {
      const rowTags: string[] = row.tags ?? [];
      for (const tag of rowTags) {
        const normalizedTag = tag.trim().toLowerCase();
        if (!tagIndexMap[normalizedTag]) tagIndexMap[normalizedTag] = [];
        tagIndexMap[normalizedTag].push({
          menuItemId: row.menuItemId,
          restaurantId: row.restaurantId,
          dishName: row.dishName,
          price: row.priceCents != null ? fromCents(row.priceCents) : 0,
        });
      }
    }
    const semanticDocuments: SemanticDishDocument[] = allTags.map((row) => ({
      menuItemId: row.menuItemId,
      restaurantId: row.restaurantId,
      text: this.semanticDishText({
        dishName: row.dishName,
        categoryName: row.categoryName,
        tags: row.tags ?? [],
      }),
      catalogType: row.catalogType ?? "menu_item",
      primaryMarketId: row.primaryMarketId,
    }));
    for (let i = 0; i < semanticDocuments.length; i += 50) {
      const result = await this.semanticSearch.upsertDishes(
        semanticDocuments.slice(i, i + 50),
      );
      semanticDishCount += result.upserted;
    }
    await this.kv.put("search:tags:index", JSON.stringify(tagIndexMap), {
      expirationTtl: 30 * 60,
    });
    await this.bumpSearchVersion();
    await this.kv.put(KV_SEARCH_REINDEXED_AT_KEY, new Date().toISOString());

    const duration_ms = Date.now() - start;
    return {
      dishes: dishCount,
      restaurants: items.length,
      semanticDishes: semanticDishCount,
      duration_ms,
    };
  }

  async getIndexStatus(): Promise<{
    version: string;
    lastReindexedAt: string | null;
    indexedDishCount: number;
    availableDishCount: number;
    indexedRestaurantCount: number;
    sourceAvailableDishCount: number;
    unindexedAvailableDishCount: number;
    restaurantsWithUnindexedAvailableDishes: number;
  }> {
    const [version, lastReindexedAt, countRows, sourceRows] = await Promise.all(
      [
        this.getSearchVersion(),
        this.kv.get(KV_SEARCH_REINDEXED_AT_KEY, "text"),
        this.db
          .select({
            indexedDishCount: sql<number>`count(*)`,
            availableDishCount: sql<number>`sum(case when ${dishSearchIndex.isAvailable} = 1 then 1 else 0 end)`,
            indexedRestaurantCount: sql<number>`count(distinct ${dishSearchIndex.restaurantId})`,
          })
          .from(dishSearchIndex),
        this.d1
          .prepare(
            `SELECT
             count(mi.id) AS source_available_dish_count,
             sum(
               CASE
                 WHEN dsi.menu_item_id IS NULL OR dsi.is_available != 1
                 THEN 1
                 ELSE 0
               END
             ) AS unindexed_available_dish_count,
             count(
               DISTINCT CASE
                 WHEN dsi.menu_item_id IS NULL OR dsi.is_available != 1
                 THEN mi.restaurant_id
               END
             ) AS restaurants_with_unindexed_available_dishes
           FROM menu_items mi
           INNER JOIN restaurants r ON r.id = mi.restaurant_id
           INNER JOIN categories c ON c.id = mi.category_id
           LEFT JOIN dish_search_index dsi ON dsi.menu_item_id = mi.id
           WHERE mi.is_available = 1
             AND mi.deleted_at_ms IS NULL
             AND r.is_active = 1
             AND r.deleted_at_ms IS NULL
             AND c.is_active = 1
             AND c.is_visible = 1
             AND c.deleted_at_ms IS NULL`,
          )
          .first<{
            source_available_dish_count: number | null;
            unindexed_available_dish_count: number | null;
            restaurants_with_unindexed_available_dishes: number | null;
          }>(),
      ],
    );
    const row = countRows[0];

    return {
      version: String(version),
      lastReindexedAt:
        lastReindexedAt === null ? null : String(lastReindexedAt),
      indexedDishCount: Number(row?.indexedDishCount ?? 0),
      availableDishCount: Number(row?.availableDishCount ?? 0),
      indexedRestaurantCount: Number(row?.indexedRestaurantCount ?? 0),
      sourceAvailableDishCount: Number(
        sourceRows?.source_available_dish_count ?? 0,
      ),
      unindexedAvailableDishCount: Number(
        sourceRows?.unindexed_available_dish_count ?? 0,
      ),
      restaurantsWithUnindexedAvailableDishes: Number(
        sourceRows?.restaurants_with_unindexed_available_dishes ?? 0,
      ),
    };
  }

  // --- Private helpers ---

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, "");
  }

  /**
   * FTS5 trigram substring match against dish_search_fts, returning a condition
   * that selects dish_search_index rows whose indexed text contains the query.
   * Returns undefined for queries under 3 characters, which the trigram
   * tokenizer cannot match (callers fall back to LIKE). The term is wrapped as
   * an FTS5 string literal (doubling embedded quotes) so user input is treated
   * as a phrase, not as FTS query operators.
   */
  private ftsMatchCondition(rawQuery: string): SQL | undefined {
    const term = rawQuery.trim();
    if ([...term].length < 3) return undefined;
    const ftsTerm = `"${term.replace(/"/g, '""')}"`;
    return sql`${dishSearchIndex.id} IN (SELECT rowid FROM dish_search_fts WHERE dish_search_fts MATCH ${ftsTerm})`;
  }

  private restaurantDetailUrl(restaurantId: string): string {
    return `/api/v1/restaurants/${restaurantId}`;
  }

  private restaurantMenuUrl(restaurantId: string): string {
    return `/api/v1/menu/${restaurantId}`;
  }

  private restaurantServiceItemsUrl(restaurantId: string): string {
    return `/api/v1/restaurants/${restaurantId}/service-items`;
  }

  private async resolveMarketSlug(filters: SearchFilters) {
    if (!filters.marketSlug || filters.marketId) return filters;

    const [market] = await this.db
      .select({ id: markets.id })
      .from(markets)
      .where(
        and(
          eq(markets.slug, filters.marketSlug),
          eq(markets.isActive, true),
          isNull(markets.deletedAt),
        ),
      )
      .limit(1);

    return {
      ...filters,
      marketId: market?.id ?? "__missing_market__",
    };
  }

  private async getSearchScopeMetadata(
    filters: SearchFilters,
  ): Promise<{ market?: MarketSearchScopeMetadata } | undefined> {
    if (!filters.marketId) return undefined;

    const [productRows, serviceRows] = await Promise.all([
      this.db
        .select({
          count: sql<number>`count(distinct ${dishSearchIndex.menuItemId})`,
        })
        .from(dishSearchIndex)
        .innerJoin(
          restaurants,
          eq(dishSearchIndex.restaurantId, restaurants.id),
        )
        .where(
          and(
            eq(dishSearchIndex.isAvailable, true),
            eq(restaurants.isActive, true),
            eq(restaurants.isDemo, false),
            eq(restaurants.isAvailable, true),
            isNull(restaurants.deletedAt),
            or(
              eq(dishSearchIndex.primaryMarketId, filters.marketId),
              like(dishSearchIndex.marketIds, `%"${filters.marketId}"%`),
            )!,
          ),
        ),
      this.db
        .select({
          count: sql<number>`count(distinct ${restaurantServiceItems.id})`,
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
            eq(restaurants.isDemo, false),
            eq(restaurants.isAvailable, true),
            isNull(restaurants.deletedAt),
            sql`EXISTS (
              SELECT 1
              FROM restaurant_market_memberships rmm
              WHERE rmm.restaurant_id = ${restaurants.id}
                AND rmm.market_id = ${filters.marketId}
                AND rmm.left_at_ms IS NULL
            )`,
          ),
        ),
    ]);

    const searchableProductCount = Number(productRows[0]?.count ?? 0);
    const publicServiceCount = Number(serviceRows[0]?.count ?? 0);

    return {
      market: {
        marketId: filters.marketId,
        searchableProductCount,
        publicServiceCount,
        hasSearchableCatalog:
          searchableProductCount > 0 || publicServiceCount > 0,
      },
    };
  }

  private marketDetailUrl(slug: string): string {
    return `/markets/${slug}`;
  }

  private menuItemUrl(menuItemId: number): string {
    return `/api/v1/menu/items/${menuItemId}`;
  }

  private getServiceIntent(query: string): "takeaway" | "delivery" | null {
    const normalized = this.normalizeQuery(query);
    if (
      [
        "外帶",
        "自取",
        "取餐",
        "takeaway",
        "takeout",
        "pickup",
        "togo",
      ].includes(normalized)
    ) {
      return "takeaway";
    }
    if (["外送", "配送", "宅配", "delivery", "deliver"].includes(normalized)) {
      return "delivery";
    }
    return null;
  }

  private getServiceTypeIntent(
    query: string,
  ): NonNullable<SearchFilters["serviceType"]> | null {
    const normalized = this.normalizeQuery(query);
    const aliases: Record<string, NonNullable<SearchFilters["serviceType"]>> = {
      一般: "general",
      一般服務: "general",
      服務: "general",
      預約: "booking",
      預訂: "booking",
      訂位: "booking",
      booking: "booking",
      reservation: "booking",
      自取: "pickup",
      取貨: "pickup",
      取餐: "pickup",
      pickup: "pickup",
      外送: "delivery",
      配送: "delivery",
      宅配: "delivery",
      delivery: "delivery",
      諮詢: "consultation",
      諮商: "consultation",
      詢問: "consultation",
      consultation: "consultation",
      租借: "rental",
      租賃: "rental",
      rental: "rental",
      活動: "activity",
      體驗: "activity",
      activity: "activity",
    };

    return aliases[normalized] ?? null;
  }

  private getServiceQueryAliases(query: string): string[] {
    const normalized = this.normalizeQuery(query);
    const aliases: Record<string, string[]> = {
      寄物: ["寄物", "寄放", "行李寄放", "置物", "暫放", "包包寄放"],
      寄放: ["寄物", "寄放", "行李寄放", "置物", "暫放", "包包寄放"],
      置物: ["寄物", "寄放", "行李寄放", "置物", "暫放", "包包寄放"],
      行李寄放: ["寄物", "寄放", "行李寄放", "置物", "暫放"],
      代切: ["代切", "切水果", "水果切盤", "分裝"],
      切水果: ["代切", "切水果", "水果切盤", "分裝"],
      導覽: ["導覽", "導游", "帶逛", "解說", "tour"],
      帶逛: ["導覽", "導游", "帶逛", "解說", "tour"],
    };

    return aliases[normalized] ?? [query.trim()];
  }

  private getCatalogQueryAliases(query: string): string[] {
    const normalized = this.normalizeQuery(query);
    const aliases: Record<string, string[]> = {
      伴手禮: ["伴手禮", "伴手礼", "禮盒", "礼盒", "名產", "名产", "土產"],
      伴手礼: ["伴手禮", "伴手礼", "禮盒", "礼盒", "名產", "名产", "土產"],
      禮盒: ["伴手禮", "伴手礼", "禮盒", "礼盒", "名產", "名产"],
      礼盒: ["伴手禮", "伴手礼", "禮盒", "礼盒", "名產", "名产"],
      名產: ["伴手禮", "伴手礼", "禮盒", "礼盒", "名產", "名产"],
      名产: ["伴手禮", "伴手礼", "禮盒", "礼盒", "名產", "名产"],
      飲料: ["飲料", "飲品", "茶飲", "茶", "果汁"],
      飲品: ["飲料", "飲品", "茶飲", "茶", "果汁"],
      茶飲: ["飲料", "飲品", "茶飲", "茶"],
      小吃: ["小吃", "點心", "點心類", "街邊小吃", "streetfood"],
      點心: ["小吃", "點心", "點心類", "街邊小吃"],
      甜點: ["甜點", "甜品", "甜食", "dessert"],
      甜品: ["甜點", "甜品", "甜食", "dessert"],
      冰品: ["冰品", "剉冰", "刨冰", "冰淇淋"],
      冰: ["冰品", "剉冰", "刨冰", "冰淇淋"],
      素食: ["素食", "蔬食", "全素", "蛋奶素"],
      蔬食: ["素食", "蔬食", "全素", "蛋奶素"],
    };

    return aliases[normalized] ?? [query];
  }

  private buildCacheKey(
    prefix: string,
    filters: SearchFilters,
    version = "0",
  ): string {
    const parts = [prefix];
    parts.push(`v:${version}`);
    if (filters.q) parts.push(this.normalizeQuery(filters.q));
    if (filters.city) parts.push(`c:${filters.city}`);
    if (filters.district) parts.push(`d:${filters.district}`);
    if (filters.catalogType) parts.push(`ct:${filters.catalogType}`);
    if (filters.categoryName) parts.push(`cat:${filters.categoryName}`);
    if (filters.sortBy) parts.push(`s:${filters.sortBy}`);
    if (filters.priceMin) parts.push(`pmin:${filters.priceMin}`);
    if (filters.priceMax) parts.push(`pmax:${filters.priceMax}`);
    if (filters.openNow) parts.push("open");
    if (filters.takeaway) parts.push("ta");
    if (filters.delivery) parts.push("dl");
    if (filters.marketId) parts.push(`m:${filters.marketId}`);
    if (filters.lat != null && filters.lng != null) {
      parts.push(`geo:${filters.lat},${filters.lng},${filters.radiusKm ?? 2}`);
    }
    parts.push(`p:${filters.page || 1}`);
    parts.push(`l:${filters.limit || 20}`);
    return parts.join(":");
  }

  private async getSearchVersion(): Promise<string> {
    return (await this.kv.get(KV_SEARCH_VERSION_KEY, "text")) ?? "0";
  }

  private async bumpSearchVersion(): Promise<void> {
    await this.kv.put(KV_SEARCH_VERSION_KEY, String(Date.now()));
  }

  private getGeoFilter(filters: SearchFilters) {
    if (filters.lat == null || filters.lng == null) return null;
    const radiusKm = Math.min(Math.max(filters.radiusKm ?? 2, 0.1), 10);
    return {
      lat: filters.lat,
      lng: filters.lng,
      radiusKm,
      box: boundingBoxFromCircle(filters.lat, filters.lng, radiusKm),
    };
  }

  private marketVendorMarketId(marketId: string | undefined) {
    return sql<string | null>`(
      SELECT ${restaurantMarketMemberships.marketId}
      FROM ${restaurantMarketMemberships}
      INNER JOIN ${markets}
        ON ${restaurantMarketMemberships.marketId} = ${markets.id}
      WHERE ${restaurantMarketMemberships.restaurantId} = ${restaurants.id}
        ${
          marketId
            ? sql`AND ${restaurantMarketMemberships.marketId} = ${marketId}`
            : sql``
        }
        AND ${restaurantMarketMemberships.leftAt} IS NULL
        AND ${markets.isActive} = TRUE
        AND ${markets.deletedAt} IS NULL
      ORDER BY ${restaurantMarketMemberships.isPrimary} DESC,
        ${restaurantMarketMemberships.joinedAt} ASC
      LIMIT 1
    )`;
  }

  private async restaurantBrowseMarketVendors(
    restaurantIds: string[],
    marketId: string | undefined,
  ) {
    if (restaurantIds.length === 0) {
      return new Map<
        string,
        ReturnType<DiscoveryService["marketVendorContext"]>
      >();
    }

    const rows = await this.db
      .select({
        restaurantId: restaurantMarketMemberships.restaurantId,
        marketVendorMarketId: restaurantMarketMemberships.marketId,
        marketVendorStallNumber: restaurantMarketMemberships.stallNumber,
        marketVendorLocationLabel: restaurantMarketMemberships.locationLabel,
        marketVendorIsPrimary: restaurantMarketMemberships.isPrimary,
        marketVendorMarketSlug: markets.slug,
        marketVendorMarketName: markets.name,
      })
      .from(restaurantMarketMemberships)
      .innerJoin(markets, eq(restaurantMarketMemberships.marketId, markets.id))
      .where(
        and(
          ...(marketId
            ? [eq(restaurantMarketMemberships.marketId, marketId)]
            : []),
          inArray(restaurantMarketMemberships.restaurantId, restaurantIds),
          isNull(restaurantMarketMemberships.leftAt),
          eq(markets.isActive, true),
          isNull(markets.deletedAt),
        ),
      )
      .orderBy(
        asc(restaurantMarketMemberships.restaurantId),
        desc(restaurantMarketMemberships.isPrimary),
        asc(restaurantMarketMemberships.joinedAt),
      );

    const entries: Array<
      [string, NonNullable<ReturnType<DiscoveryService["marketVendorContext"]>>]
    > = [];
    for (const row of rows) {
      if (entries.some(([restaurantId]) => restaurantId === row.restaurantId)) {
        continue;
      }
      const context = this.marketVendorContext(row);
      if (context) entries.push([row.restaurantId, context]);
    }

    return new Map(entries);
  }

  private async restaurantAccessCounts(restaurantIds: string[]) {
    const counts = new Map<
      string,
      { availableMenuItemCount: number; publicServiceItemCount: number }
    >();
    if (restaurantIds.length === 0) return counts;

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

    for (const restaurantId of restaurantIds) {
      counts.set(restaurantId, {
        availableMenuItemCount: 0,
        publicServiceItemCount: 0,
      });
    }
    for (const row of menuCounts) {
      counts.set(row.restaurantId, {
        ...(counts.get(row.restaurantId) ?? {
          availableMenuItemCount: 0,
          publicServiceItemCount: 0,
        }),
        availableMenuItemCount: Number(row.count),
      });
    }
    for (const row of serviceCounts) {
      counts.set(row.restaurantId, {
        ...(counts.get(row.restaurantId) ?? {
          availableMenuItemCount: 0,
          publicServiceItemCount: 0,
        }),
        publicServiceItemCount: Number(row.count),
      });
    }

    return counts;
  }

  private marketVendorStallNumber(marketId: string | undefined) {
    return sql<string | null>`(
      SELECT ${restaurantMarketMemberships.stallNumber}
      FROM ${restaurantMarketMemberships}
      INNER JOIN ${markets}
        ON ${restaurantMarketMemberships.marketId} = ${markets.id}
      WHERE ${restaurantMarketMemberships.restaurantId} = ${restaurants.id}
        ${
          marketId
            ? sql`AND ${restaurantMarketMemberships.marketId} = ${marketId}`
            : sql``
        }
        AND ${restaurantMarketMemberships.leftAt} IS NULL
        AND ${markets.isActive} = TRUE
        AND ${markets.deletedAt} IS NULL
      ORDER BY ${restaurantMarketMemberships.isPrimary} DESC,
        ${restaurantMarketMemberships.joinedAt} ASC
      LIMIT 1
    )`;
  }

  private marketVendorKeywordCondition(pattern: string, marketId?: string) {
    return marketId
      ? sql`EXISTS (
          SELECT 1
          FROM ${restaurantMarketMemberships}
          WHERE ${restaurantMarketMemberships.restaurantId} = ${restaurants.id}
            AND ${restaurantMarketMemberships.marketId} = ${marketId}
            AND ${restaurantMarketMemberships.leftAt} IS NULL
            AND (
              ${restaurantMarketMemberships.stallNumber} LIKE ${pattern}
              OR ${restaurantMarketMemberships.locationLabel} LIKE ${pattern}
            )
        )`
      : sql`EXISTS (
          SELECT 1
          FROM ${restaurantMarketMemberships}
          WHERE ${restaurantMarketMemberships.restaurantId} = ${restaurants.id}
            AND ${restaurantMarketMemberships.leftAt} IS NULL
            AND (
              ${restaurantMarketMemberships.stallNumber} LIKE ${pattern}
              OR ${restaurantMarketMemberships.locationLabel} LIKE ${pattern}
            )
        )`;
  }

  private marketVendorLocationLabel(marketId: string | undefined) {
    return sql<string | null>`(
      SELECT ${restaurantMarketMemberships.locationLabel}
      FROM ${restaurantMarketMemberships}
      INNER JOIN ${markets}
        ON ${restaurantMarketMemberships.marketId} = ${markets.id}
      WHERE ${restaurantMarketMemberships.restaurantId} = ${restaurants.id}
        ${
          marketId
            ? sql`AND ${restaurantMarketMemberships.marketId} = ${marketId}`
            : sql``
        }
        AND ${restaurantMarketMemberships.leftAt} IS NULL
        AND ${markets.isActive} = TRUE
        AND ${markets.deletedAt} IS NULL
      ORDER BY ${restaurantMarketMemberships.isPrimary} DESC,
        ${restaurantMarketMemberships.joinedAt} ASC
      LIMIT 1
    )`;
  }

  private marketVendorIsPrimary(marketId: string | undefined) {
    return sql<boolean | null>`(
      SELECT ${restaurantMarketMemberships.isPrimary}
      FROM ${restaurantMarketMemberships}
      INNER JOIN ${markets}
        ON ${restaurantMarketMemberships.marketId} = ${markets.id}
      WHERE ${restaurantMarketMemberships.restaurantId} = ${restaurants.id}
        ${
          marketId
            ? sql`AND ${restaurantMarketMemberships.marketId} = ${marketId}`
            : sql``
        }
        AND ${restaurantMarketMemberships.leftAt} IS NULL
        AND ${markets.isActive} = TRUE
        AND ${markets.deletedAt} IS NULL
      ORDER BY ${restaurantMarketMemberships.isPrimary} DESC,
        ${restaurantMarketMemberships.joinedAt} ASC
      LIMIT 1
    )`;
  }

  private marketVendorMarketSlug(marketId: string | undefined) {
    return sql<string | null>`(
      SELECT ${markets.slug}
      FROM ${restaurantMarketMemberships}
      INNER JOIN ${markets}
        ON ${restaurantMarketMemberships.marketId} = ${markets.id}
      WHERE ${restaurantMarketMemberships.restaurantId} = ${restaurants.id}
        ${
          marketId
            ? sql`AND ${restaurantMarketMemberships.marketId} = ${marketId}`
            : sql``
        }
        AND ${restaurantMarketMemberships.leftAt} IS NULL
        AND ${markets.isActive} = TRUE
        AND ${markets.deletedAt} IS NULL
      ORDER BY ${restaurantMarketMemberships.isPrimary} DESC,
        ${restaurantMarketMemberships.joinedAt} ASC
      LIMIT 1
    )`;
  }

  private marketVendorMarketName(marketId: string | undefined) {
    return sql<string | null>`(
      SELECT ${markets.name}
      FROM ${restaurantMarketMemberships}
      INNER JOIN ${markets}
        ON ${restaurantMarketMemberships.marketId} = ${markets.id}
      WHERE ${restaurantMarketMemberships.restaurantId} = ${restaurants.id}
        ${
          marketId
            ? sql`AND ${restaurantMarketMemberships.marketId} = ${marketId}`
            : sql``
        }
        AND ${restaurantMarketMemberships.leftAt} IS NULL
        AND ${markets.isActive} = TRUE
        AND ${markets.deletedAt} IS NULL
      ORDER BY ${restaurantMarketMemberships.isPrimary} DESC,
        ${restaurantMarketMemberships.joinedAt} ASC
      LIMIT 1
    )`;
  }

  private marketVendorContext(row: {
    marketVendorMarketId: string | null;
    marketVendorStallNumber: string | null;
    marketVendorLocationLabel: string | null;
    marketVendorIsPrimary: boolean | number | null;
    marketVendorMarketSlug: string | null;
    marketVendorMarketName: string | null;
  }) {
    if (!row.marketVendorMarketId) return undefined;

    return {
      marketId: row.marketVendorMarketId,
      marketSlug: row.marketVendorMarketSlug,
      marketName: row.marketVendorMarketName,
      marketUrl: row.marketVendorMarketSlug
        ? this.marketDetailUrl(row.marketVendorMarketSlug)
        : null,
      stallNumber: row.marketVendorStallNumber,
      locationLabel: row.marketVendorLocationLabel,
      isPrimary: Boolean(row.marketVendorIsPrimary),
    };
  }

  private getDishSearchOrderBy(
    filters: SearchFilters,
    effectivePrice: SQL<number>,
    normalizedQuery: string | null,
    semanticMenuItemIds: number[] = [],
  ) {
    if (filters.sortBy === "popular") {
      return [desc(menuItems.orderCount), asc(effectivePrice)];
    }
    if (filters.sortBy === "price_desc") {
      return [desc(effectivePrice)];
    }
    if (normalizedQuery) {
      const rawQuery = filters.q?.trim() ?? "";
      const tagPattern = `%${rawQuery}%`;
      const semanticMatch = semanticMenuItemIds.length
        ? sql`WHEN ${inArray(dishSearchIndex.menuItemId, semanticMenuItemIds)} THEN 3`
        : sql``;
      const relevance = sql<number>`CASE
        WHEN ${dishSearchIndex.dishNameNormalized} = ${normalizedQuery} THEN 0
        WHEN ${dishSearchIndex.dishNameNormalized} LIKE ${`${normalizedQuery}%`} THEN 1
        WHEN ${dishSearchIndex.tags} LIKE ${tagPattern} THEN 2
        ${semanticMatch}
        ELSE 4
      END`;
      return [asc(relevance), asc(effectivePrice)];
    }
    return [asc(effectivePrice)];
  }

  private getServiceSearchOrderBy(filters: SearchFilters) {
    const query = filters.q;
    const priceMissing = sql<number>`CASE WHEN ${restaurantServiceItems.priceCents} IS NULL THEN 1 ELSE 0 END`;
    if (filters.sortBy === "price_desc") {
      return [
        asc(priceMissing),
        desc(restaurantServiceItems.priceCents),
        asc(restaurantServiceItems.sortOrder),
        asc(restaurantServiceItems.id),
      ];
    }
    if (filters.sortBy === "price_asc") {
      return [
        asc(priceMissing),
        asc(restaurantServiceItems.priceCents),
        asc(restaurantServiceItems.sortOrder),
        asc(restaurantServiceItems.id),
      ];
    }

    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
      return [
        asc(restaurantServiceItems.sortOrder),
        asc(restaurantServiceItems.id),
      ];
    }

    const pattern = `%${trimmedQuery}%`;
    const aliasQueries = this.getServiceQueryAliases(trimmedQuery).filter(
      (alias) => alias !== trimmedQuery,
    );
    const aliasNameCondition = aliasQueries.length
      ? or(
          ...aliasQueries.map((alias) =>
            like(restaurantServiceItems.name, `%${alias}%`),
          ),
        )
      : undefined;
    const aliasMetadataCondition = aliasQueries.length
      ? or(
          ...aliasQueries.flatMap((alias) => [
            like(restaurantServiceItems.keywords, `%${alias}%`),
            like(restaurantServiceItems.tags, `%${alias}%`),
          ]),
        )
      : undefined;
    const aliasDescriptionCondition = aliasQueries.length
      ? or(
          ...aliasQueries.map((alias) =>
            like(restaurantServiceItems.description, `%${alias}%`),
          ),
        )
      : undefined;
    const relevance = sql<number>`CASE
      WHEN lower(${restaurantServiceItems.name}) = lower(${trimmedQuery}) THEN 0
      WHEN lower(${restaurantServiceItems.name}) LIKE lower(${`${trimmedQuery}%`}) THEN 1
      WHEN ${restaurantServiceItems.name} LIKE ${pattern} THEN 2
      ${aliasNameCondition ? sql`WHEN ${aliasNameCondition} THEN 3` : sql``}
      WHEN ${restaurantServiceItems.keywords} LIKE ${pattern}
        OR ${restaurantServiceItems.tags} LIKE ${pattern} THEN 4
      ${aliasMetadataCondition ? sql`WHEN ${aliasMetadataCondition} THEN 5` : sql``}
      WHEN ${restaurantServiceItems.description} LIKE ${pattern} THEN 6
      ${aliasDescriptionCondition ? sql`WHEN ${aliasDescriptionCondition} THEN 7` : sql``}
      ELSE 8
    END`;

    return [
      asc(relevance),
      asc(restaurantServiceItems.sortOrder),
      asc(restaurantServiceItems.id),
    ];
  }

  private resultDistanceKm(
    geoFilter: NonNullable<ReturnType<DiscoveryService["getGeoFilter"]>>,
    row: { latitude: number; longitude: number },
  ) {
    return Number(
      distanceKm(
        { lat: geoFilter.lat, lng: geoFilter.lng },
        { lat: row.latitude, lng: row.longitude },
      ).toFixed(3),
    );
  }

  private sortDistanceResultsFirst<T extends { distanceKm?: number }>(
    results: T[],
  ) {
    return [...results].sort(
      (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
    );
  }

  private sortOpenResultsFirst<T extends { isOpen: boolean }>(results: T[]) {
    return [...results].sort((a, b) => Number(b.isOpen) - Number(a.isOpen));
  }

  /**
   * `onboarding` is an internal provisioning sentinel, not a customer-facing
   * cuisine or venue type. Existing rows can retain it until the owner fills
   * out their profile, but public discovery must never disclose it.
   */
  private publicDiscoveryType(type: string | null): string | null {
    const value = type?.trim();
    return value && value.toLowerCase() !== "onboarding" ? value : null;
  }

  /**
   * A provisional district is derived from an onboarding subdomain. It is an
   * implementation identifier, not a geographic location, so omit it from
   * every public discovery payload rather than exposing it as an address.
   */
  private publicDiscoveryDistrict(district: string | null): string | null {
    const value = district?.trim();
    return value && !value.toLowerCase().startsWith("onboarding-")
      ? value
      : null;
  }

  private semanticDishText(row: {
    dishName: string;
    categoryName: string | null;
    tags: string[];
  }) {
    return [row.dishName, row.categoryName, ...row.tags]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ");
  }
}

/**
 * Build a DiscoveryService for the public catalog read path, routing queries
 * through a D1 Session so they can be served by regional read replicas.
 * "first-unconstrained" lets the first query hit any replica — acceptable for
 * public browsing where slight staleness is fine and clients don't write the
 * catalog (no read-your-write requirement). No latency change until read
 * replication is enabled on the D1 database in the Cloudflare dashboard.
 */
/** Env fields that decide whether semantic discovery runs at all. */
export interface SemanticDiscoveryEnv {
  AI?: unknown;
  DISCOVERY_VECTORIZE?: unknown;
  DISCOVERY_EMBEDDING_MODEL?: string;
  DISCOVERY_SEMANTIC_ENABLED?: string;
}

/**
 * Semantic discovery is opt-in, and off unless explicitly switched on.
 *
 * Vectorize bills for stored dimensions and Workers AI for embedding calls, so
 * this is a feature that costs money continuously once populated, whether or
 * not anyone searches. The bindings being present in wrangler.toml is not the
 * same as the feature being wanted -- an index can sit provisioned and empty,
 * which is what production looked like when this gate was added.
 *
 * D1 prefix/FTS search runs independently of this, so with the gate closed
 * discovery still returns results; it just loses the semantic augmentation.
 */
export function isSemanticDiscoveryEnabled(
  env: Pick<SemanticDiscoveryEnv, "DISCOVERY_SEMANTIC_ENABLED">,
): boolean {
  return env.DISCOVERY_SEMANTIC_ENABLED === "true";
}

/**
 * The semantic side of discovery, or a service with nothing wired into it.
 *
 * Withholding the bindings rather than adding a branch at each call site keeps
 * the off state on a path SemanticDiscoveryService already handles: it reports
 * "disabled" and returns no matches when ai or vectorize is absent.
 */
export function createSemanticDiscovery(
  env: SemanticDiscoveryEnv & { CACHE_KV?: KVNamespace },
  options: { waitUntil?: (promise: Promise<unknown>) => void } = {},
): SemanticDiscoveryService {
  if (!isSemanticDiscoveryEnabled(env)) {
    return new SemanticDiscoveryService({});
  }

  return new SemanticDiscoveryService({
    ai: env.AI as never,
    vectorize: env.DISCOVERY_VECTORIZE as never,
    embeddingModel: env.DISCOVERY_EMBEDDING_MODEL,
    embeddingCache: env.CACHE_KV,
    waitUntil: options.waitUntil,
  });
}

export function createDiscoveryRead(
  env: {
    DB: D1Database;
    CACHE_KV: KVNamespace;
  } & SemanticDiscoveryEnv,
  options: {
    waitUntil?: (promise: Promise<unknown>) => void;
  } = {},
): DiscoveryService {
  return new DiscoveryService(
    env.DB,
    env.CACHE_KV,
    "first-unconstrained",
    createSemanticDiscovery(env, options),
  );
}
