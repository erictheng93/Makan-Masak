/**
 * MenuService
 * Business logic and database operations for menu management
 */

import type { Env } from "../../../shared/types";
import { ConsoleLogger } from "../../../core/monitoring";
import {
  ApiError,
  badRequest,
  notFound,
  forbidden,
  conflict,
} from "../../../shared/utils/api-error";
import { HTTP_STATUS } from "../../../shared/constants";
import {
  MenuService as DatabaseMenuService,
  restaurants,
  categories as categoriesTable,
  amountFromCents,
} from "@makanmasak/database";
import type {
  OptionChoiceWithRestaurant,
  OptionGroupWithChoices,
  MenuItemOptionGroupState,
  ReplaceMenuItemOptionGroupData,
} from "@makanmasak/database";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Status } from "@makanmasak/shared-types";
import type {
  MenuItem as SharedMenuItem,
  Category as SharedCategory,
  MenuStructure as SharedMenuStructure,
} from "@makanmasak/shared-types";
import type {
  MenuItem,
  Category,
  MenuStructure,
  CreateMenuItemData,
  UpdateMenuItemData,
  CreateCategoryData,
  UpdateCategoryData,
  MenuFilters,
  MenuSearchParams,
  MenuSearchResult,
  BulkAvailabilityUpdate,
  BulkPriceUpdate,
  BulkCategoryMove,
  MenuAnalytics,
  PopularityMetrics,
  IMenuService,
} from "../types";

/**
 * Normalise whatever shape a timestamp arrived in to epoch milliseconds.
 *
 * `menu_items.updated_at_ms` is INTEGER ms and Drizzle hands it back as a Date,
 * but the same value reaches this layer as an ISO string when it has been
 * through a JSON round-trip (the KV query cache, a fixture, a re-serialised
 * response). Comparing epoch ms sidesteps that entirely — comparing strings
 * would treat "…Z" and "…+00:00" as different instants.
 */
function toEpochMs(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export class MenuService implements IMenuService {
  private readonly logger: ConsoleLogger;
  private readonly dbService: DatabaseMenuService;
  private readonly db;

  constructor(private readonly env: Env) {
    this.logger = new ConsoleLogger("MenuService");
    this.dbService = new DatabaseMenuService(env.DB, env);
    this.db = drizzle(env.DB);
  }

  async isPublicRestaurantAvailable(restaurantId: string): Promise<boolean> {
    const [restaurant] = await this.db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(
        and(
          eq(restaurants.id, restaurantId),
          eq(restaurants.isActive, true),
          isNull(restaurants.deletedAt),
        ),
      )
      .limit(1);

    return Boolean(restaurant);
  }

  async listOptionGroups(restaurantId: string) {
    const groups = await this.dbService.listOptionGroups(restaurantId);
    return groups.map((group) => this.transformOptionGroup(group));
  }

  async getOptionGroup(groupId: string) {
    const group = await this.dbService.getOptionGroup(groupId);
    return group ? this.transformOptionGroup({ ...group, choices: [] }) : null;
  }

  async createOptionGroup(
    data: Parameters<DatabaseMenuService["createOptionGroup"]>[0],
  ) {
    const group = await this.dbService.createOptionGroup(data);
    return this.transformOptionGroup({ ...group, choices: [] });
  }

  async updateOptionGroup(
    groupId: string,
    data: Parameters<DatabaseMenuService["updateOptionGroup"]>[1],
  ) {
    const group = await this.dbService.updateOptionGroup(groupId, data);
    return this.transformOptionGroup({ ...group, choices: [] });
  }

  async deleteOptionGroup(groupId: string): Promise<boolean> {
    return this.dbService.softDeleteOptionGroup(groupId);
  }

  async getOptionChoice(choiceId: string) {
    const choice = await this.dbService.getOptionChoice(choiceId);
    return choice ? this.transformOptionChoice(choice) : null;
  }

  async createOptionChoice(
    data: Parameters<DatabaseMenuService["createOptionChoice"]>[0],
  ) {
    const choice = await this.dbService.createOptionChoice(data);
    return this.transformOptionChoice(choice);
  }

  async updateOptionChoice(
    choiceId: string,
    data: Parameters<DatabaseMenuService["updateOptionChoice"]>[1],
  ) {
    const choice = await this.dbService.updateOptionChoice(choiceId, data);
    return this.transformOptionChoice(choice);
  }

  async deleteOptionChoice(choiceId: string): Promise<boolean> {
    return this.dbService.deleteOptionChoice(choiceId);
  }

  async replaceMenuItemOptionGroups(
    menuItemId: number,
    groups: ReplaceMenuItemOptionGroupData[],
  ): Promise<void> {
    await this.dbService.replaceMenuItemOptionGroups(menuItemId, groups);
  }

  async listMenuItemOptionGroups(menuItemId: number) {
    const state = await this.dbService.listMenuItemOptionGroups(menuItemId);
    return this.transformMenuItemOptionGroupState(state);
  }

  /**
   * Existence check for the privileged menu read.
   *
   * The public path gates on isActive + not-deleted (isPublicRestaurantAvailable)
   * and must keep doing so. The admin path must not: an owner whose restaurant
   * is temporarily inactive still has to be able to read and edit their own
   * menu and analytics, which used to 404 as MENU_NOT_FOUND (#84). A restaurant
   * that genuinely does not exist (or was soft-deleted) still 404s.
   */
  private async restaurantExists(restaurantId: string): Promise<boolean> {
    const [restaurant] = await this.db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(
        and(eq(restaurants.id, restaurantId), isNull(restaurants.deletedAt)),
      )
      .limit(1);

    return Boolean(restaurant);
  }

  async getMenu(
    restaurantId: string,
    options?: { includeUnavailable?: boolean },
  ): Promise<MenuStructure | null> {
    try {
      this.logger.info("Fetching complete menu", { restaurantId });
      if (options?.includeUnavailable) {
        if (!(await this.restaurantExists(restaurantId))) return null;
      } else {
        const isPublic = await this.isPublicRestaurantAvailable(restaurantId);
        if (!isPublic) return null;
      }

      const menu = await this.dbService.getMenu(restaurantId, options);
      return menu ? this.transformMenuStructure(menu) : null;
    } catch (error) {
      this.logger.error(
        "Failed to fetch menu",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async getMenuItem(id: number): Promise<MenuItem | null> {
    try {
      this.logger.debug("Fetching menu item", { id });
      const item = await this.dbService.getMenuItem(id);
      if (!item) {
        this.logger.warn("Menu item not found", { id });
        return null;
      }
      return this.transformMenuItem(item);
    } catch (error) {
      this.logger.error(
        "Failed to fetch menu item",
        error instanceof Error ? error : undefined,
        { id },
      );
      throw error;
    }
  }

  async createMenuItem(data: CreateMenuItemData): Promise<MenuItem> {
    try {
      this.logger.info("Creating menu item", {
        data: { name: data.name, restaurantId: data.restaurantId },
      });
      await this.validateCategoryAccess(data.categoryId, data.restaurantId);
      const item = await this.dbService.createMenuItem({
        ...data,
        restaurantId: String(data.restaurantId),
      });
      this.logger.info("Menu item created successfully", { itemId: item.id });
      return this.transformMenuItem(item);
    } catch (error) {
      this.logger.error(
        "Failed to create menu item",
        error instanceof Error ? error : undefined,
        { data },
      );
      throw error;
    }
  }

  /**
   * Create a whole batch of items, or none of them.
   *
   * Every referenced category is checked before the first row is written, for
   * the same reason the batch endpoints check item ownership up front (#77): a
   * per-row check inside the write loop leaves the earlier rows committed when a
   * later one is refused. The CSV importer's old per-item POST loop had exactly
   * that failure mode, plus no way to say which row stopped it (#85).
   */
  async bulkCreateMenuItems(
    restaurantId: string,
    items: Array<Omit<CreateMenuItemData, "restaurantId">>,
  ): Promise<MenuItem[]> {
    try {
      this.logger.info("Bulk creating menu items", {
        restaurantId,
        count: items.length,
      });

      await this.assertCategoriesBelongToRestaurant(items, restaurantId);

      const created = await this.dbService.bulkCreateMenuItems(
        items.map((item) => ({
          ...item,
          restaurantId: String(restaurantId),
        })),
      );

      this.logger.info("Bulk menu item creation completed", {
        restaurantId,
        created: created.length,
      });
      return created.map((item) => this.transformMenuItem(item));
    } catch (error) {
      this.logger.error(
        "Failed to bulk create menu items",
        error instanceof Error ? error : undefined,
        { restaurantId, count: items.length },
      );
      throw error;
    }
  }

  async updateMenuItem(
    id: number,
    data: UpdateMenuItemData,
    prefetchedItem?: MenuItem,
  ): Promise<MenuItem> {
    try {
      this.logger.info("Updating menu item", { id, data });
      // `updatedAt` is a precondition, not a column to write — strip it before
      // anything reaches the DB layer.
      const { updatedAt: expectedUpdatedAt, ...fields } = data;
      const existingItem = prefetchedItem ?? (await this.getMenuItem(id));
      if (!existingItem) {
        throw notFound("Menu item not found", "MENU_ITEM_NOT_FOUND");
      }
      // Checked here rather than in the route handler because the row is
      // already loaded here, and because every caller of this method — not just
      // the HTTP one — should be held to the same precondition.
      this.assertNotModifiedSince(existingItem, expectedUpdatedAt);
      // The schema already refuses a body that carries both price and
      // originalPrice inconsistently; a partial body that sends only one half
      // has to be compared against the stored other half here — otherwise
      // lowering originalPrice (or raising price) alone still manufactures a
      // negative discount (#81).
      this.assertPriceConsistent(
        fields.price ?? existingItem.price,
        "originalPrice" in fields
          ? fields.originalPrice
          : existingItem.originalPrice,
        { itemId: id },
      );
      if (fields.categoryId && fields.categoryId !== existingItem.categoryId) {
        await this.validateCategoryAccess(
          fields.categoryId,
          existingItem.restaurantId,
        );
      }
      const item = await this.dbService.updateMenuItem(id, {
        ...fields,
        restaurantId: fields.restaurantId
          ? String(fields.restaurantId)
          : undefined,
      });
      this.logger.info("Menu item updated successfully", { itemId: id });
      return this.transformMenuItem(item);
    } catch (error) {
      this.logger.error(
        "Failed to update menu item",
        error instanceof Error ? error : undefined,
        { id, data },
      );
      throw error;
    }
  }

  async deleteMenuItem(
    id: number,
    prefetchedItem?: MenuItem,
  ): Promise<boolean> {
    try {
      this.logger.info("Deleting menu item", { id });
      const existingItem = prefetchedItem ?? (await this.getMenuItem(id));
      if (!existingItem) {
        return false;
      }
      // Soft delete via deleted_at_ms. The old marker was sortOrder: -1, a
      // convention only the admin list filter knew about — deleteCategory kept
      // counting deleted items and permanently refused to delete emptied
      // categories (#80).
      const deleted = await this.dbService.softDeleteMenuItem(id);
      if (!deleted) {
        return false;
      }
      this.logger.info("Menu item deleted successfully", { itemId: id });
      return true;
    } catch (error) {
      this.logger.error(
        "Failed to delete menu item",
        error instanceof Error ? error : undefined,
        { id },
      );
      throw error;
    }
  }

  async createCategory(data: CreateCategoryData): Promise<Category> {
    try {
      this.logger.info("Creating category", { data });
      const category = await this.dbService.createCategory({
        ...data,
        restaurantId: String(data.restaurantId),
      });
      this.logger.info("Category created successfully", {
        categoryId: category.id,
      });
      return this.transformCategory(category);
    } catch (error) {
      this.logger.error(
        "Failed to create category",
        error instanceof Error ? error : undefined,
        { data },
      );
      throw error;
    }
  }

  async updateCategory(
    id: number,
    data: UpdateCategoryData,
  ): Promise<Category> {
    try {
      this.logger.info("Updating category", { id, data });
      const updated = await this.dbService.updateCategory(id, data);
      this.logger.info("Category updated successfully", { categoryId: id });
      return this.transformCategory(updated);
    } catch (error) {
      this.logger.error(
        "Failed to update category",
        error instanceof Error ? error : undefined,
        { id, data },
      );
      throw error;
    }
  }

  async deleteCategory(id: number): Promise<boolean> {
    try {
      this.logger.info("Deleting category", { id });
      const existingCategory = await this.getCategory(id);
      if (!existingCategory) {
        return false;
      }
      // Counted by category id alone. This used to go through
      // searchMenuItems(), whose WHERE carries publicCategoryConditions —
      // conditions on the CATEGORY. A category with isVisible:false (a state
      // #83 made first-class) counted zero items however full it was, so the
      // guard let an owner delete a category holding on-sale dishes.
      const itemsInCategory = await this.dbService.countItemsInCategory(id);
      if (itemsInCategory > 0) {
        throw conflict(
          "Cannot delete category that contains menu items",
          "CATEGORY_HAS_MENU_ITEMS",
        );
      }
      // Writes deleted_at_ms, the marker the menu reads actually filter on.
      // Setting only isActive:false left the category visible in the owner's
      // own dashboard — adminCategoryConditions looks at deletedAt — where it
      // reappeared badged "hidden" after every delete and could never be
      // removed. Returns false when the row was already deleted, which the
      // route reports as 404 rather than a second hollow success.
      const deleted = await this.dbService.softDeleteCategory(id);
      if (!deleted) {
        return false;
      }
      this.logger.info("Category deleted successfully", { categoryId: id });
      return true;
    } catch (error) {
      this.logger.error(
        "Failed to delete category",
        error instanceof Error ? error : undefined,
        { id },
      );
      throw error;
    }
  }

  async reorderCategories(
    restaurantId: string,
    updates: Array<{ id: number; sortOrder: number }>,
  ): Promise<void> {
    try {
      this.logger.info("Reordering categories", {
        restaurantId,
        count: updates.length,
      });
      await this.dbService.reorderCategories(restaurantId, updates);
      this.logger.info("Categories reordered successfully", { restaurantId });
    } catch (error) {
      this.logger.error(
        "Failed to reorder categories",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async searchMenuItems(
    restaurantId: string,
    params: MenuSearchParams,
  ): Promise<MenuSearchResult> {
    try {
      this.logger.debug("Searching menu items", { restaurantId, params });
      const filters: MenuFilters = {
        categoryId: params.categoryId,
        priceRange: params.priceRange,
        spiceLevel: params.spiceLevel,
        dietaryPreferences: params.dietaryPreferences,
        isAvailable: params.isAvailable,
        isFeatured: params.isFeatured,
        search: params.search,
      };
      const result = await this.dbService.searchMenuItems(
        restaurantId,
        filters,
        params.page || 1,
        params.limit || 20,
      );
      return {
        items: result.items.map((item) => this.transformMenuItem(item)),
        pagination: result.pagination,
      };
    } catch (error) {
      this.logger.error(
        "Failed to search menu items",
        error instanceof Error ? error : undefined,
        { restaurantId, params },
      );
      throw error;
    }
  }

  async getFeaturedItems(
    restaurantId: string,
    limit: number = 10,
  ): Promise<MenuItem[]> {
    try {
      this.logger.debug("Fetching featured items", { restaurantId, limit });
      const items = await this.dbService.getFeaturedItems(restaurantId, limit);
      return items.map((item) => this.transformMenuItem(item));
    } catch (error) {
      this.logger.error(
        "Failed to fetch featured items",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async getPopularItems(
    restaurantId: string,
    limit: number = 10,
  ): Promise<MenuItem[]> {
    try {
      this.logger.debug("Fetching popular items", { restaurantId, limit });
      const items = await this.dbService.getPopularItems(restaurantId, limit);
      return items.map((item) => this.transformMenuItem(item));
    } catch (error) {
      this.logger.error(
        "Failed to fetch popular items",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async batchUpdateAvailability(
    restaurantId: string,
    updates: BulkAvailabilityUpdate[],
  ): Promise<void> {
    try {
      this.logger.info("Batch updating availability", {
        restaurantId,
        count: updates.length,
      });

      // This endpoint was never vulnerable — its WHERE has always carried
      // restaurantId, so a foreign id silently matched nothing. But silently
      // is the problem: it answered 200 for items it had not touched, while
      // the two sibling endpoints now answer 403. Same check, so all three
      // report the same thing for the same request.
      await this.assertItemsBelongToRestaurant(
        updates.map((update) => update.id),
        restaurantId,
      );

      await this.dbService.batchUpdateAvailability(restaurantId, updates);
      this.logger.info("Batch availability update completed", { restaurantId });
    } catch (error) {
      this.logger.error(
        "Failed to batch update availability",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async batchUpdatePrices(
    restaurantId: string,
    updates: BulkPriceUpdate[],
  ): Promise<void> {
    try {
      this.logger.info("Batch updating prices", {
        restaurantId,
        count: updates.length,
      });

      await this.assertItemsBelongToRestaurant(
        updates.map((update) => update.id),
        restaurantId,
      );

      // Entries that send only `price` are judged against the STORED
      // originalPrice — the schema already handled pairs sent together (#81).
      const storedPrices = await this.dbService.getMenuItemPrices(
        restaurantId,
        updates.map((update) => update.id),
      );
      for (const update of updates) {
        this.assertPriceConsistent(
          update.price,
          update.originalPrice !== undefined
            ? update.originalPrice
            : storedPrices.get(update.id)?.originalPrice,
          { itemId: update.id },
        );
      }

      await this.dbService.batchUpdatePricesScoped(restaurantId, updates);

      this.logger.info("Batch price update completed", { restaurantId });
    } catch (error) {
      this.logger.error(
        "Failed to batch update prices",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async batchMoveItems(
    restaurantId: string,
    moves: BulkCategoryMove[],
  ): Promise<void> {
    try {
      this.logger.info("Batch moving items to categories", {
        restaurantId,
        count: moves.length,
      });
      // Both halves of the move have to be checked. The destination category
      // was already validated here; the item itself was not, so an owner could
      // move another restaurant's item into their own category (#77).
      for (const move of moves) {
        await this.validateCategoryAccess(move.categoryId, restaurantId);
      }
      await this.assertItemsBelongToRestaurant(
        moves.map((move) => move.id),
        restaurantId,
      );

      await this.dbService.batchMoveItemsScoped(restaurantId, moves);

      this.logger.info("Batch category move completed", { restaurantId });
    } catch (error) {
      this.logger.error(
        "Failed to batch move items",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async getMenuAnalytics(restaurantId: string): Promise<MenuAnalytics> {
    try {
      this.logger.debug("Fetching menu analytics", { restaurantId });
      // Analytics must see the whole catalogue. Reading the public menu made
      // `availableItems` identically equal to `totalItems` (the list was
      // already filtered to isAvailable), so an owner could never see how many
      // items were paused, and priceRange / averagePrice / categoryDistribution
      // / dietaryInfoStats / spiceLevelDistribution were all silently scoped to
      // on-sale items despite their neutral names (#84).
      const menu = await this.getMenu(restaurantId, {
        includeUnavailable: true,
      });
      if (!menu) {
        throw notFound("Menu not found for restaurant", "MENU_NOT_FOUND");
      }
      const items = menu.menuItems;
      const totalItems = items.length;
      const availableItems = items.filter((item) => item.isAvailable).length;
      const featuredItems = items.filter((item) => item.isFeatured).length;
      const popularItems = items.filter((item) => item.isPopular).length;
      const prices = items.map((item) => item.price);
      const averagePrice =
        prices.length > 0
          ? prices.reduce((sum, price) => sum + price, 0) / prices.length
          : 0;
      const priceRange =
        prices.length > 0
          ? { min: Math.min(...prices), max: Math.max(...prices) }
          : { min: 0, max: 0 };
      const categoryMap = new Map<number, { name: string; count: number }>();
      for (const item of items) {
        const category = menu.categories.find(
          (cat) => cat.id === item.categoryId,
        );
        if (category) {
          const existing = categoryMap.get(category.id) || {
            name: category.name,
            count: 0,
          };
          categoryMap.set(category.id, {
            ...existing,
            count: existing.count + 1,
          });
        }
      }
      const categoryDistribution = Array.from(categoryMap.entries()).map(
        ([id, data]) => ({
          categoryId: id,
          categoryName: data.name,
          itemCount: data.count,
          percentage: totalItems > 0 ? (data.count / totalItems) * 100 : 0,
        }),
      );
      const topPerformingItems = items
        .sort((a, b) => b.orderCount - a.orderCount)
        .slice(0, 10)
        .map((item) => ({
          id: item.id,
          name: item.name,
          orderCount: item.orderCount,
          revenue: item.orderCount * item.price,
          rating: item.rating,
        }));
      const dietaryInfoStats = {
        vegetarian: items.filter((item) => item.dietaryInfo?.vegetarian).length,
        vegan: items.filter((item) => item.dietaryInfo?.vegan).length,
        glutenFree: items.filter((item) => item.dietaryInfo?.glutenFree).length,
        halal: items.filter((item) => item.dietaryInfo?.halal).length,
      };
      const spiceLevelDistribution = items.reduce(
        (acc, item) => {
          acc[item.spiceLevel] = (acc[item.spiceLevel] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>,
      );
      return {
        totalItems,
        availableItems,
        featuredItems,
        popularItems,
        averagePrice,
        priceRange,
        categoryDistribution,
        topPerformingItems,
        dietaryInfoStats,
        spiceLevelDistribution,
      };
    } catch (error) {
      this.logger.error(
        "Failed to fetch menu analytics",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async getPopularityMetrics(restaurantId: string): Promise<PopularityMetrics> {
    try {
      this.logger.debug("Fetching popularity metrics", { restaurantId });
      const [mostOrdered, mostViewed, highestRated, recentlyAdded] =
        await Promise.all([
          this.getPopularItems(restaurantId, 10),
          this.getMostViewedItems(restaurantId, 10),
          this.getHighestRatedItems(restaurantId, 10),
          this.getRecentlyAddedItems(restaurantId, 10),
        ]);
      return { mostOrdered, mostViewed, highestRated, recentlyAdded };
    } catch (error) {
      this.logger.error(
        "Failed to fetch popularity metrics",
        error instanceof Error ? error : undefined,
        { restaurantId },
      );
      throw error;
    }
  }

  async incrementOrderCount(
    menuItemId: number,
    increment: number = 1,
  ): Promise<void> {
    try {
      await this.dbService.incrementOrderCount(menuItemId, increment);
    } catch (error) {
      this.logger.error(
        "Failed to increment order count",
        error instanceof Error ? error : undefined,
        { menuItemId },
      );
      throw error;
    }
  }

  async incrementViewCount(menuItemId: number): Promise<void> {
    try {
      await this.dbService.incrementViewCount(menuItemId);
    } catch (error) {
      this.logger.error(
        "Failed to increment view count",
        error instanceof Error ? error : undefined,
        { menuItemId },
      );
      throw error;
    }
  }

  async getCategoryById(id: number): Promise<Category | null> {
    return this.getCategory(id);
  }

  /**
   * Rejects the whole batch unless every id belongs to this restaurant.
   *
   * The batch endpoints only ever validated the restaurantId in the path, which
   * an owner sets to their own restaurant, and never the ids in the body. The
   * underlying updateMenuItem() matched on `id` alone, so foreign ids were
   * updated exactly as readily as your own (#77).
   *
   * All-or-nothing on purpose: a partial apply would leave the caller with a
   * success response and a half-changed menu, and would tell an attacker which
   * ids exist elsewhere.
   */
  private async assertItemsBelongToRestaurant(
    ids: number[],
    restaurantId: string,
  ): Promise<void> {
    if (ids.length === 0) return;

    const uniqueIds = [...new Set(ids)];
    const owned = await this.dbService.findOwnedMenuItemIds(
      restaurantId,
      uniqueIds,
    );

    const foreign = uniqueIds.filter((id) => !owned.has(id));
    if (foreign.length > 0) {
      this.logger.warn("Rejected batch touching foreign menu items", {
        restaurantId,
        foreign,
      });
      // Deliberately does not say whether the id exists at all — "not yours"
      // and "does not exist" must look the same from outside.
      throw forbidden(
        "One or more menu items do not belong to the specified restaurant",
        "MENU_ITEM_RESTAURANT_MISMATCH",
      );
    }
  }

  /**
   * Rejects the whole batch unless every referenced category belongs here.
   *
   * Reports the offending array indexes in `details` so the importer can point
   * at the CSV row that stopped it, instead of the single generic error the old
   * per-item loop produced. Uses one query for all distinct ids rather than a
   * lookup per row.
   *
   * Like assertItemsBelongToRestaurant, "not yours" and "does not exist" are
   * deliberately the same answer: the difference would enumerate other
   * restaurants' category ids.
   */
  private async assertCategoriesBelongToRestaurant(
    items: Array<{ categoryId: number }>,
    restaurantId: string,
  ): Promise<void> {
    if (items.length === 0) return;

    const uniqueIds = [...new Set(items.map((item) => item.categoryId))];
    const owned = await this.dbService.findOwnedCategoryIds(
      restaurantId,
      uniqueIds,
    );

    const rejected = items
      .map((item, index) => ({ index, categoryId: item.categoryId }))
      .filter(({ categoryId }) => !owned.has(categoryId));

    if (rejected.length > 0) {
      this.logger.warn("Rejected bulk create touching foreign categories", {
        restaurantId,
        rejected,
      });
      throw new ApiError(
        "CATEGORY_RESTAURANT_MISMATCH",
        "One or more categories do not belong to the specified restaurant",
        HTTP_STATUS.FORBIDDEN,
        rejected.map(({ index, categoryId }) => ({
          // 0-based position in the submitted `items` array — the caller knows
          // how that maps to whatever it parsed the batch from.
          index,
          field: "categoryId",
          message: `Category ${categoryId} does not belong to restaurant ${restaurantId}`,
        })),
      );
    }
  }

  /**
   * The optimistic lock for PUT /menu/items/:id (#85).
   *
   * The admin form saves every field it rendered, so without this an owner
   * changing a price silently reverted a sold-out flag a chef had set while the
   * form was open — and the same in reverse. `expected` is the client's
   * epoch-ms copy of updated_at_ms (see updatedAtPrecondition in the schemas);
   * `undefined` means the request is not one that can clobber anything, which
   * the request schema is what actually enforces.
   *
   * Fails closed. If the stored row has no readable timestamp there is nothing
   * to compare against, and a lock that waves through the case it cannot check
   * is not a lock — the client asked for its write to be verified, so an
   * unverifiable write is refused rather than silently applied.
   */
  private assertNotModifiedSince(
    item: MenuItem,
    expected: number | undefined,
  ): void {
    if (expected === undefined) return;

    const current = toEpochMs(item.updatedAt);
    if (current === expected) return;

    this.logger.warn("Rejected stale menu item update", {
      itemId: item.id,
      expected,
      current,
      unreadableTimestamp: current === null,
    });
    throw conflict(
      "This menu item was changed by someone else since you loaded it — reload it and reapply your change",
      "MENU_ITEM_MODIFIED",
    );
  }

  /**
   * The DB-aware half of the negative-discount rule (#81).
   *
   * The request schemas refuse a body whose own price/originalPrice pair is
   * inconsistent, but a partial update that sends only one half can only be
   * judged against the stored other half — which is what reaches this method.
   * `originalPrice` null/undefined means "no strikethrough price", which no
   * price can conflict with.
   */
  private assertPriceConsistent(
    price: number | undefined,
    originalPrice: number | null | undefined,
    context: Record<string, unknown>,
  ): void {
    if (
      price === undefined ||
      originalPrice === undefined ||
      originalPrice === null ||
      price <= originalPrice
    ) {
      return;
    }

    this.logger.warn("Rejected price above originalPrice", {
      ...context,
      price,
      originalPrice,
    });
    throw badRequest(
      "price cannot be higher than originalPrice — the discounted price must not exceed the price it is discounted from",
      "PRICE_ABOVE_ORIGINAL",
      [{ ...context, price, originalPrice }],
    );
  }

  private async validateCategoryAccess(
    categoryId: number,
    restaurantId: string,
  ): Promise<void> {
    const category = await this.getCategory(categoryId);
    if (!category) {
      throw notFound("Category not found", "CATEGORY_NOT_FOUND");
    }
    if (String(category.restaurantId) !== String(restaurantId)) {
      throw forbidden(
        "Category does not belong to the specified restaurant",
        "CATEGORY_RESTAURANT_MISMATCH",
      );
    }
  }

  private async getCategory(id: number): Promise<Category | null> {
    try {
      const category = await this.dbService.getCategory(id);
      if (!category) {
        return null;
      }
      return this.transformCategory(category);
    } catch (error) {
      this.logger.error(
        "Failed to fetch category",
        error instanceof Error ? error : undefined,
        { id },
      );
      return null;
    }
  }

  /**
   * The three Top-N lists below delegate straight to SQL.
   *
   * They used to call searchMenuItems(restaurantId, {isAvailable:true}, 1,
   * limit) — which applies its own ordering (isFeatured, orderCount,
   * sortOrder) — and then re-sort those `limit` rows in JS. On any menu with
   * more than `limit` items that ranked the wrong candidate set, and the
   * rating list additionally filtered `rating > 0` after the slice so it
   * returned fewer than `limit` rows (#84).
   */
  private async getMostViewedItems(
    restaurantId: string,
    limit: number,
  ): Promise<MenuItem[]> {
    const items = await this.dbService.getMostViewedItems(restaurantId, limit);
    return items.map((item) => this.transformMenuItem(item));
  }

  private async getHighestRatedItems(
    restaurantId: string,
    limit: number,
  ): Promise<MenuItem[]> {
    const items = await this.dbService.getHighestRatedItems(
      restaurantId,
      limit,
    );
    return items.map((item) => this.transformMenuItem(item));
  }

  private async getRecentlyAddedItems(
    restaurantId: string,
    limit: number,
  ): Promise<MenuItem[]> {
    const items = await this.dbService.getRecentlyAddedItems(
      restaurantId,
      limit,
    );
    return items.map((item) => this.transformMenuItem(item));
  }

  /**
   * Promote a shared MenuItem (as returned by DatabaseMenuService) to the
   * feature MenuItem shape.
   *
   * reviewCount/viewCount used to be hardcoded to 0 here because the DB mapper
   * never populated them — which meant the write path (incrementViewCount, run
   * via waitUntil from GET /menu/items/:id) worked while every read reported 0,
   * so getMostViewedItems sorted by a constant (#84). They are now selected and
   * mapped in the DB layer; this only supplies a floor for shapes that predate
   * the columns. tags/keywords/availableHours remain feature-only extras.
   */
  private transformMenuItem(item: SharedMenuItem): MenuItem {
    return {
      ...item,
      catalogType: item.catalogType ?? "menu_item",
      categoryId: Number(item.categoryId),
      restaurantId: String(item.restaurantId),
      isAvailable: item.isAvailable || false,
      isFeatured: item.isFeatured || false,
      isPopular: item.isPopular || false,
      sortOrder: item.sortOrder || 0,
      inventoryCount: item.inventoryCount ?? null,
      orderCount: item.orderCount || 0,
      allergens: item.allergens || [],
      reviewCount: item.reviewCount ?? 0,
      viewCount: item.viewCount ?? 0,
    };
  }

  /**
   * Normalise a category into the feature Category shape. This receives two
   * different runtime shapes: a shared Category (from getMenu, already carrying
   * `status` + Unix-ms timestamps) and a raw Drizzle row (from create/update,
   * carrying `isActive` + Date timestamps and no `status`). We discriminate at
   * runtime via `in` checks. Deriving status from `isActive` also fixes a
   * latent bug: the previous `status || 1` cast made the create/update path
   * always report ACTIVE regardless of isActive.
   */
  private transformCategory(
    category: SharedCategory | typeof categoriesTable.$inferSelect,
  ): Category {
    const isActive = "isActive" in category ? category.isActive : undefined;
    const status: Status =
      "status" in category
        ? category.status
        : isActive === false
          ? Status.INACTIVE
          : Status.ACTIVE;
    const toUnixMs = (value: number | Date): number =>
      value instanceof Date ? value.getTime() : value;
    return {
      id: category.id,
      restaurantId: String(category.restaurantId),
      name: category.name,
      // Unlike transformMenuItem this is an explicit projection, so a new
      // column is invisible to callers until listed here (#107).
      nameEn: "nameEn" in category ? (category.nameEn ?? null) : null,
      description: category.description ?? undefined,
      parentId: "parentId" in category ? category.parentId : undefined,
      sortOrder: category.sortOrder,
      status,
      imageUrl: "imageUrl" in category ? (category.imageUrl ?? null) : null,
      createdAt: toUnixMs(category.createdAt),
      updatedAt: toUnixMs(category.updatedAt),
      // Both visibility flags reach the admin client. getMenu now carries them
      // through, so a category hidden via isVisible arrives flagged instead of
      // being indistinguishable from a visible one (#83).
      isActive,
      isVisible: "isVisible" in category ? category.isVisible : undefined,
      // Live count when the caller had one (getMenu derives it from the loaded
      // items); absent on bare create/update rows. Deliberately not defaulted
      // to 0 — there is no stored categories.item_count any more, and reporting
      // 0 for "unknown" is what made the old column look plausible (#84).
      itemCount: "itemCount" in category ? category.itemCount : undefined,
    };
  }

  private transformOptionChoice(
    choice:
      | OptionChoiceWithRestaurant
      | OptionGroupWithChoices["choices"][number],
  ) {
    return {
      id: choice.id,
      groupId: choice.groupId,
      publicId: choice.publicId,
      name: choice.name,
      priceAdjustment: amountFromCents(choice.priceAdjustmentCents) ?? 0,
      isDefault: choice.isDefault,
      isAvailable: choice.isAvailable,
      maxQuantity: choice.maxQuantity,
      sortOrder: choice.sortOrder,
      createdAt: choice.createdAt,
      updatedAt: choice.updatedAt,
      ...("restaurantId" in choice
        ? { restaurantId: choice.restaurantId }
        : {}),
    };
  }

  private transformOptionGroup(group: OptionGroupWithChoices) {
    return {
      id: group.id,
      restaurantId: group.restaurantId,
      publicId: group.publicId,
      kind: group.kind,
      name: group.name,
      type: group.type,
      required: group.required,
      maxSelections: group.maxSelections,
      sortOrder: group.sortOrder,
      usageCount: group.usageCount ?? 0,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      choices: group.choices.map((choice) =>
        this.transformOptionChoice(choice),
      ),
    };
  }

  private transformMenuItemOptionGroupState(state: MenuItemOptionGroupState) {
    return {
      groups: state.groups.map((group) => ({
        groupId: group.groupId,
        sortOrder: group.sortOrder,
        requiredOverride: group.requiredOverride,
        maxSelectionsOverride: group.maxSelectionsOverride,
        choiceOverrides: group.choiceOverrides.map((override) => ({
          choiceId: override.choiceId,
          isHidden: override.isHidden,
          priceAdjustment: amountFromCents(override.priceAdjustmentCents),
        })),
      })),
    };
  }

  private transformMenuStructure(menu: SharedMenuStructure): MenuStructure {
    return {
      categories:
        menu.categories?.map((cat) => this.transformCategory(cat)) || [],
      menuItems:
        menu.menuItems?.map((item) => this.transformMenuItem(item)) || [],
    };
  }
}
