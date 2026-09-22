import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Queue } from "@cloudflare/workers-types";
import {
  dishSearchIndex,
  menuItems,
  categories,
  restaurants,
  restaurantMarketMemberships,
} from "@makanmasak/database";
import type { Env } from "../../../types/env";
import { normalizeSearchTags } from "../utils/search-normalization";

const KV_SEARCH_VERSION_KEY = "search:query:version";
const MARKET_CACHE_VERSION_KEY = "markets:version";

/**
 * Unit of work for the search-index sync queue. Fan-out operations
 * (market / category changes) enqueue one of these per affected entity so
 * each re-denormalization runs in its own Worker invocation, staying well
 * under D1's 1000-subrequest-per-invocation limit.
 */
export type SearchSyncMessage =
  | { type: "restaurant"; restaurantId: string }
  | { type: "menuItem"; menuItemId: number };

// Cloudflare Queues accept at most 100 messages per sendBatch call.
const QUEUE_BATCH_LIMIT = 100;

export class SearchIndexSyncService {
  private db;

  constructor(
    d1: D1Database,
    private kv: KVNamespace,
    /**
     * Optional fan-out queue. When provided, {@link onMarketChanged} and
     * {@link onCategoryChanged} enqueue per-entity work instead of processing
     * inline. When absent (tests, queue consumer), they fall back to inline
     * processing so behavior is unchanged.
     */
    private queue?: Queue<SearchSyncMessage>,
  ) {
    this.db = drizzle(d1);
  }

  async onMenuItemChanged(menuItemId: number): Promise<void> {
    const [item] = await this.db
      .select({
        id: menuItems.id,
        name: menuItems.name,
        priceCents: menuItems.priceCents,
        catalogType: menuItems.catalogType,
        isAvailable: menuItems.isAvailable,
        tags: menuItems.tags,
        keywords: menuItems.keywords,
        deletedAt: menuItems.deletedAt,
        restaurantId: menuItems.restaurantId,
        categoryName: categories.name,
        categoryActive: categories.isActive,
        categoryVisible: categories.isVisible,
        categoryDeleted: categories.deletedAt,
        district: restaurants.district,
        restaurantType: restaurants.type,
        supportsTakeaway: restaurants.supportsTakeaway,
        supportsDelivery: restaurants.supportsDelivery,
        restaurantActive: restaurants.isActive,
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
      .where(eq(menuItems.id, menuItemId))
      .limit(1);

    if (!item) {
      await this.db
        .delete(dishSearchIndex)
        .where(eq(dishSearchIndex.menuItemId, menuItemId));
      await this.bumpSearchVersion();
      return;
    }

    const isAvailable =
      item.isAvailable &&
      !item.deletedAt &&
      item.categoryActive === true &&
      item.categoryVisible === true &&
      !item.categoryDeleted &&
      item.restaurantActive &&
      !item.restaurantDeleted;
    const normalized = item.name.trim().toLowerCase().replace(/\s+/g, "");
    const tags = normalizeSearchTags(item.tags, item.keywords);

    await this.db
      .insert(dishSearchIndex)
      .values({
        menuItemId: item.id,
        restaurantId: item.restaurantId,
        dishName: item.name,
        dishNameNormalized: normalized,
        categoryName: item.categoryName,
        priceCents: item.priceCents,
        catalogType: item.catalogType ?? "menu_item",
        isAvailable,
        tags,
        district: item.district,
        restaurantType: item.restaurantType,
        supportsTakeaway: item.supportsTakeaway,
        supportsDelivery: item.supportsDelivery,
        primaryMarketId: item.primaryMarketId,
        marketIds: item.marketIds ? JSON.parse(item.marketIds) : [],
        latitude: item.latitude,
        longitude: item.longitude,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: dishSearchIndex.menuItemId,
        set: {
          restaurantId: item.restaurantId,
          dishName: item.name,
          dishNameNormalized: normalized,
          categoryName: item.categoryName,
          priceCents: item.priceCents,
          catalogType: item.catalogType ?? "menu_item",
          isAvailable,
          tags,
          district: item.district,
          restaurantType: item.restaurantType,
          supportsTakeaway: item.supportsTakeaway,
          supportsDelivery: item.supportsDelivery,
          primaryMarketId: item.primaryMarketId,
          marketIds: item.marketIds ? JSON.parse(item.marketIds) : [],
          latitude: item.latitude,
          longitude: item.longitude,
          updatedAt: new Date(),
        },
      });
    await this.bumpSearchVersion();
  }

  async onRestaurantChanged(
    restaurantId: string,
    options: { previousDistrict?: string | null } = {},
  ): Promise<void> {
    const previousDistrictRows = await this.db
      .selectDistinct({ district: dishSearchIndex.district })
      .from(dishSearchIndex)
      .where(eq(dishSearchIndex.restaurantId, restaurantId));
    const [restaurant] = await this.db
      .select({
        district: restaurants.district,
        type: restaurants.type,
        supportsTakeaway: restaurants.supportsTakeaway,
        supportsDelivery: restaurants.supportsDelivery,
        latitude: restaurants.latitude,
        longitude: restaurants.longitude,
        isActive: restaurants.isActive,
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
        deletedAt: restaurants.deletedAt,
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    if (!restaurant) return;

    if (!restaurant.isActive || restaurant.deletedAt) {
      await this.db
        .update(dishSearchIndex)
        .set({ isAvailable: false, updatedAt: new Date() })
        .where(eq(dishSearchIndex.restaurantId, restaurantId));
    } else {
      await this.db
        .update(dishSearchIndex)
        .set({
          district: restaurant.district,
          restaurantType: restaurant.type,
          supportsTakeaway: restaurant.supportsTakeaway,
          supportsDelivery: restaurant.supportsDelivery,
          primaryMarketId: restaurant.primaryMarketId,
          marketIds: restaurant.marketIds
            ? JSON.parse(restaurant.marketIds)
            : [],
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
          isAvailable: sql<boolean>`EXISTS (
            SELECT 1
            FROM ${menuItems}
            INNER JOIN ${categories} ON ${categories.id} = ${menuItems.categoryId}
            WHERE ${menuItems.id} = ${dishSearchIndex.menuItemId}
              AND ${menuItems.isAvailable} = 1
              AND ${menuItems.deletedAt} IS NULL
              AND ${categories.isActive} = 1
              AND ${categories.isVisible} = 1
              AND ${categories.deletedAt} IS NULL
          )`,
          updatedAt: new Date(),
        })
        .where(eq(dishSearchIndex.restaurantId, restaurantId));
    }

    const affectedDistricts = new Set(
      previousDistrictRows
        .map((row) => row.district)
        .filter((district): district is string => Boolean(district)),
    );
    if (options.previousDistrict)
      affectedDistricts.add(options.previousDistrict);
    if (restaurant.district) affectedDistricts.add(restaurant.district);

    await Promise.all(
      Array.from(affectedDistricts).map((district) =>
        this.kv.delete(`search:restaurants:hours2:district:${district}`),
      ),
    );
    await this.bumpSearchVersion();
  }

  async onCategoryChanged(categoryId: number): Promise<void> {
    const items = await this.db
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(eq(menuItems.categoryId, categoryId));

    if (this.queue) {
      await this.enqueue(
        items.map((item) => ({ type: "menuItem", menuItemId: item.id })),
      );
      await this.bumpSearchVersion();
      return;
    }

    await Promise.all(items.map((item) => this.onMenuItemChanged(item.id)));

    if (items.length === 0) {
      await this.bumpSearchVersion();
    }
  }

  async onMarketMembershipChanged(restaurantId: string): Promise<void> {
    // Bounded to a single restaurant's index rows — safe to run inline.
    await this.onRestaurantChanged(restaurantId);
  }

  async onMarketChanged(marketId: string): Promise<void> {
    const memberships = await this.db
      .select({ restaurantId: restaurantMarketMemberships.restaurantId })
      .from(restaurantMarketMemberships)
      .where(
        and(
          eq(restaurantMarketMemberships.marketId, marketId),
          isNull(restaurantMarketMemberships.leftAt),
        ),
      );

    // A market may contain hundreds of restaurants, each with many menu items.
    // Processing them inline would blow past D1's 1000-subrequest-per-invocation
    // limit and time out the triggering request. When a fan-out queue is wired,
    // enqueue one job per restaurant so each re-syncs in its own invocation.
    if (this.queue) {
      await this.enqueue(
        memberships.map(({ restaurantId }) => ({
          type: "restaurant",
          restaurantId,
        })),
      );
      await this.bumpSearchVersion();
      return;
    }

    await Promise.all(
      memberships.map(({ restaurantId }) =>
        this.onRestaurantChanged(restaurantId),
      ),
    );
  }

  /**
   * Dispatch a single queued fan-out message. Called by the queue consumer.
   * Only invokes bounded single-entity handlers, which never re-enqueue, so
   * there is no risk of a fan-out loop.
   */
  async processMessage(message: SearchSyncMessage): Promise<void> {
    switch (message.type) {
      case "restaurant":
        await this.onRestaurantChanged(message.restaurantId);
        break;
      case "menuItem":
        await this.onMenuItemChanged(message.menuItemId);
        break;
    }
  }

  private async enqueue(messages: SearchSyncMessage[]): Promise<void> {
    if (!this.queue || messages.length === 0) return;
    for (let i = 0; i < messages.length; i += QUEUE_BATCH_LIMIT) {
      const chunk = messages.slice(i, i + QUEUE_BATCH_LIMIT);
      await this.queue.sendBatch(chunk.map((body) => ({ body })));
    }
  }

  private async bumpSearchVersion(): Promise<void> {
    await this.kv.put(KV_SEARCH_VERSION_KEY, String(Date.now()));
    await this.bumpMarketPublicCacheVersion();
  }

  private async bumpMarketPublicCacheVersion(): Promise<void> {
    const current = Number(await this.kv.get(MARKET_CACHE_VERSION_KEY));
    const next = Number.isFinite(current) ? current + 1 : Date.now();
    await this.kv.put(MARKET_CACHE_VERSION_KEY, String(next));
  }
}

/**
 * Build a {@link SearchIndexSyncService} wired to the request's bindings,
 * including the fan-out queue when it is configured. Centralizing construction
 * here keeps call sites uniform and gives a single seam for swapping the
 * catalog DB binding later (P1).
 */
export function createSearchIndexSync(env: Env): SearchIndexSyncService {
  return new SearchIndexSyncService(
    env.DB,
    env.CACHE_KV,
    env.SEARCH_SYNC_QUEUE as Queue<SearchSyncMessage> | undefined,
  );
}
