/**
 * Menu Routes
 * All HTTP routes for the menu feature
 */

import { Hono } from "hono";
import {
  authMiddleware,
  requireRole,
  requireRestaurantAccess,
  optionalAuth,
} from "../../../shared/middleware";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../shared/middleware";
import type { Env } from "../../../shared/types";
import { HTTP_STATUS, USER_ROLES } from "../../../shared/constants";
import { createSuccessResponse } from "../../../shared/utils";
import {
  notFound,
  forbidden,
  conflict,
  badRequest,
} from "../../../shared/utils/api-error";
import { moduleGate } from "../../../middleware/moduleGate";
import { toRequiredCents, backfillMenuItemOptions } from "@makanmasak/database";
import { generateUUID } from "@makanmasak/utils";

// Import schemas
import { menuSchemas } from "../schemas/validation";

// Import services
import { MenuService } from "../services/MenuService";
import { createSearchIndexSync } from "../../discovery/services/SearchIndexSyncService";

const app = new Hono<{ Bindings: Env }>();

async function syncMenuItems(env: Env, menuItemIds: number[]): Promise<void> {
  const uniqueIds = [...new Set(menuItemIds)];
  if (uniqueIds.length === 0) return;

  const sync = createSearchIndexSync(env);
  await Promise.all(uniqueIds.map((id) => sync.onMenuItemChanged(id)));
}

async function syncCategoryItems(env: Env, categoryId: number): Promise<void> {
  const sync = createSearchIndexSync(env);
  await sync.onCategoryChanged(categoryId);
}

/**
 * The only menu-item fields a CHEF may change.
 *
 * A chef's legitimate need is "we've run out of this" — stock and availability.
 * Prices, names, categories and images are the owner's. Bulk price updates were
 * already ADMIN/OWNER-only while `PUT /items/:id` let a chef change the very
 * same prices one item at a time, which is not a boundary (#85).
 */
const CHEF_EDITABLE_ITEM_FIELDS = ["isAvailable", "inventoryCount"] as const;

/**
 * Rejects, rather than silently strips, any field a chef may not change — a
 * client that sent more than it is allowed to must learn its request was not
 * applied instead of believing a partial write succeeded.
 *
 * Safe to rely on key presence: `updateMenuItemSchema` carries no defaults, so
 * the validated body contains exactly the keys the caller sent.
 */
function assertChefFieldsAllowed(
  role: number,
  body: Record<string, unknown>,
): void {
  if (role !== USER_ROLES.CHEF) return;

  const allowed = new Set<string>([
    ...CHEF_EDITABLE_ITEM_FIELDS,
    // A precondition, not a field write — a chef sending the optimistic-lock
    // timestamp is asking for its stock flip to be checked, not editing
    // anything (#85).
    "updatedAt",
  ]);
  const rejected = Object.keys(body).filter((field) => !allowed.has(field));

  if (rejected.length > 0) {
    throw forbidden(
      `Chefs may only update ${CHEF_EDITABLE_ITEM_FIELDS.join(", ")}; not allowed: ${rejected.join(", ")}`,
      "CHEF_FIELD_NOT_ALLOWED",
    );
  }
}

function assertUserCanAccessRestaurantResource(
  user: { role: number; restaurantId?: string | number | null },
  restaurantId: string,
): void {
  if (
    user.role !== USER_ROLES.ADMIN &&
    String(user.restaurantId) !== restaurantId
  ) {
    throw forbidden("Access denied");
  }
}

function mapOptionGroupMutationError(error: unknown): never {
  if (error instanceof Error) {
    if (
      error.message.includes("already offers an option group with public id") ||
      error.message.includes("Option group public id already exists") ||
      error.message.includes(
        "option_groups.restaurant_id, option_groups.public_id",
      )
    ) {
      throw conflict(error.message, "OPTION_GROUP_PUBLIC_ID_CONFLICT");
    }
    if (
      error.message.includes("Option choice public id already exists") ||
      error.message.includes(
        "option_choices.group_id, option_choices.public_id",
      )
    ) {
      throw conflict(error.message, "OPTION_CHOICE_PUBLIC_ID_CONFLICT");
    }
    if (
      error.message.includes("Option group not found") ||
      error.message.includes("Option choice not found")
    ) {
      throw notFound(error.message);
    }
    if (error.message.includes("is not in the selected option group")) {
      throw badRequest(error.message);
    }
    if (error.message.includes("does not belong")) {
      throw forbidden("Access denied");
    }
  }
  throw error;
}

// Public Menu Routes (no authentication required)

// GET /:restaurantId - Get complete menu (public API, optionally includes unavailable items for admins)
app.get(
  "/:restaurantId",
  optionalAuth,
  validateParams(menuSchemas.restaurantIdParam),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const service = new MenuService(c.env);

    // Authenticated admin/owner requests can see all items (including
    // unavailable). Role alone is not enough — an owner is only privileged on
    // their OWN restaurant, so the token's restaurantId must match the target.
    // Platform admins (role 0) are the only cross-tenant readers, matching
    // requireRestaurantAccess.
    const user = c.get("user");
    const includeAll =
      c.req.query("includeAll") === "true" &&
      user &&
      (user.role === USER_ROLES.ADMIN ||
        (user.role === USER_ROLES.OWNER &&
          user.restaurantId != null &&
          String(user.restaurantId) === restaurantId));

    const menu = await service.getMenu(restaurantId, {
      includeUnavailable: !!includeAll,
    });

    if (!menu) {
      throw notFound("Menu not found for restaurant", "MENU_NOT_FOUND");
    }

    return c.json(createSuccessResponse(menu), HTTP_STATUS.OK);
  },
);

// GET /:restaurantId/featured - Get featured items (public API)
app.get(
  "/:restaurantId/featured",
  validateParams(menuSchemas.restaurantIdParam),
  validateQuery(menuSchemas.featuredItemsQuery),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { limit } = c.get("validatedQuery");
    const service = new MenuService(c.env);

    if (!(await service.isPublicRestaurantAvailable(restaurantId))) {
      throw notFound("Menu not found for restaurant", "MENU_NOT_FOUND");
    }

    const items = await service.getFeaturedItems(restaurantId, limit);

    return c.json(createSuccessResponse(items), HTTP_STATUS.OK);
  },
);

// GET /:restaurantId/popular - Get popular items (public API)
app.get(
  "/:restaurantId/popular",
  validateParams(menuSchemas.restaurantIdParam),
  validateQuery(menuSchemas.popularItemsQuery),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { limit } = c.get("validatedQuery");
    const service = new MenuService(c.env);

    if (!(await service.isPublicRestaurantAvailable(restaurantId))) {
      throw notFound("Menu not found for restaurant", "MENU_NOT_FOUND");
    }

    const items = await service.getPopularItems(restaurantId, limit);

    return c.json(createSuccessResponse(items), HTTP_STATUS.OK);
  },
);

// GET /:restaurantId/search - Search menu items (public API)
app.get(
  "/:restaurantId/search",
  validateParams(menuSchemas.restaurantIdParam),
  validateQuery(menuSchemas.menuFilter),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const query = c.get("validatedQuery");
    const service = new MenuService(c.env);

    if (!(await service.isPublicRestaurantAvailable(restaurantId))) {
      throw notFound("Menu not found for restaurant", "MENU_NOT_FOUND");
    }

    // Process price range
    const priceRange =
      query.minPrice || query.maxPrice
        ? ([query.minPrice || 0, query.maxPrice || 999999] as [number, number])
        : undefined;

    // Process dietary preferences
    const dietaryPreferences = query.dietaryPreferences
      ? query.dietaryPreferences.split(",").map((s: string) => s.trim())
      : undefined;

    const searchParams = {
      categoryId: query.categoryId,
      priceRange,
      spiceLevel: query.spiceLevel,
      dietaryPreferences,
      isAvailable: true,
      isFeatured: query.isFeatured,
      search: query.search,
      page: query.page,
      limit: query.limit,
    };

    const result = await service.searchMenuItems(restaurantId, searchParams);

    return c.json(
      {
        success: true,
        data: result.items,
        pagination: result.pagination,
      },
      HTTP_STATUS.OK,
    );
  },
);

// GET /items/:id - Get menu item details (public API with optional auth for view tracking)
app.get(
  "/items/:id",
  validateParams(menuSchemas.menuItemIdParam),
  optionalAuth,
  async (c) => {
    const { id } = c.get("validatedParams");
    const service = new MenuService(c.env);

    const item = await service.getMenuItem(id);

    if (!item) {
      throw notFound("Menu item not found");
    }

    // Increment view count asynchronously (don't wait for completion).
    //
    // The .catch() is load-bearing, not defensive noise. incrementViewCount
    // logs and then rethrows, and a promise handed to waitUntil that rejects
    // is an unhandled rejection: the Workers runtime reports the invocation as
    // `outcome: "exception"` even though this 200 has already been sent, which
    // is the signal #325 was reading as "an uncaught exception is recycling the
    // isolate". The view count is bookkeeping — a transient D1 write failure
    // must not be able to colour the request it rode in on. Every other
    // waitUntil in apps/api already swallows its own errors this way.
    c.executionCtx.waitUntil(
      service.incrementViewCount(id).catch(() => undefined),
    );

    return c.json(createSuccessResponse(item), HTTP_STATUS.OK);
  },
);

// Protected Menu Management Routes (authentication required)

// POST /option-groups/backfill - Convert legacy JSON options into option rows
//
// Platform maintenance, not shop management: it walks every restaurant, so it
// is ADMIN-only and deliberately skips moduleGate, which asks whether one shop
// has bought a module.
//
// Idempotent by construction — an item that already has link rows is skipped —
// so re-running after a partial failure resumes rather than duplicates.
app.post(
  "/option-groups/backfill",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN]),
  async (c) => {
    const result = await backfillMenuItemOptions(c.env.DB);

    return c.json(
      createSuccessResponse(result, "Menu option backfill completed"),
      HTTP_STATUS.OK,
    );
  },
);

// GET /:restaurantId/option-groups - List option groups for menu management
app.get(
  "/:restaurantId/option-groups",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const service = new MenuService(c.env);

    const groups = await service.listOptionGroups(restaurantId);

    return c.json(createSuccessResponse(groups), HTTP_STATUS.OK);
  },
);

// POST /:restaurantId/option-groups - Create option group
app.post(
  "/:restaurantId/option-groups",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  validateBody(menuSchemas.createOptionGroup),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const service = new MenuService(c.env);

    let group;
    try {
      group = await service.createOptionGroup({
        id: generateUUID(),
        restaurantId,
        publicId: data.publicId,
        kind: data.kind,
        name: data.name,
        type: data.type,
        required: data.required ?? false,
        maxSelections: data.maxSelections,
        sortOrder: data.sortOrder ?? 0,
      });
    } catch (error) {
      mapOptionGroupMutationError(error);
    }

    return c.json(
      createSuccessResponse(group, "Option group created successfully"),
      HTTP_STATUS.CREATED,
    );
  },
);

// PUT /option-groups/:groupId - Update option group metadata
app.put(
  "/option-groups/:groupId",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.optionGroupIdParam),
  validateBody(menuSchemas.updateOptionGroup),
  async (c) => {
    const { groupId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new MenuService(c.env);

    const existingGroup = await service.getOptionGroup(groupId);
    if (!existingGroup) {
      throw notFound("Option group not found");
    }
    assertUserCanAccessRestaurantResource(user, existingGroup.restaurantId);

    const group = await service.updateOptionGroup(groupId, data);

    return c.json(
      createSuccessResponse(group, "Option group updated successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// DELETE /option-groups/:groupId - Soft delete option group
app.delete(
  "/option-groups/:groupId",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.optionGroupIdParam),
  async (c) => {
    const { groupId } = c.get("validatedParams");
    const user = c.get("user");
    const service = new MenuService(c.env);

    const existingGroup = await service.getOptionGroup(groupId);
    if (!existingGroup) {
      throw notFound("Option group not found");
    }
    assertUserCanAccessRestaurantResource(user, existingGroup.restaurantId);

    const deleted = await service.deleteOptionGroup(groupId);
    if (!deleted) {
      throw notFound("Option group not found");
    }

    return c.json(
      createSuccessResponse(null, "Option group deleted successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// POST /option-groups/:groupId/choices - Add choice to an option group
app.post(
  "/option-groups/:groupId/choices",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.optionGroupIdParam),
  validateBody(menuSchemas.createOptionChoice),
  async (c) => {
    const { groupId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new MenuService(c.env);

    const existingGroup = await service.getOptionGroup(groupId);
    if (!existingGroup) {
      throw notFound("Option group not found");
    }
    assertUserCanAccessRestaurantResource(user, existingGroup.restaurantId);

    let choice;
    try {
      choice = await service.createOptionChoice({
        id: generateUUID(),
        groupId,
        publicId: data.publicId,
        name: data.name,
        priceAdjustmentCents:
          data.priceAdjustment === undefined
            ? 0
            : toRequiredCents(data.priceAdjustment),
        isDefault: data.isDefault ?? false,
        isAvailable: data.isAvailable ?? true,
        maxQuantity: data.maxQuantity,
        sortOrder: data.sortOrder ?? 0,
      });
    } catch (error) {
      mapOptionGroupMutationError(error);
    }

    return c.json(
      createSuccessResponse(choice, "Option choice created successfully"),
      HTTP_STATUS.CREATED,
    );
  },
);

// PATCH /option-choices/:choiceId - Update option choice
app.patch(
  "/option-choices/:choiceId",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.optionChoiceIdParam),
  validateBody(menuSchemas.updateOptionChoice),
  async (c) => {
    const { choiceId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new MenuService(c.env);

    const existingChoice = await service.getOptionChoice(choiceId);
    if (!existingChoice) {
      throw notFound("Option choice not found");
    }
    assertUserCanAccessRestaurantResource(
      user,
      String(existingChoice.restaurantId),
    );

    const { priceAdjustment, ...choiceData } = data;
    const choice = await service.updateOptionChoice(choiceId, {
      ...choiceData,
      ...(priceAdjustment !== undefined
        ? { priceAdjustmentCents: toRequiredCents(priceAdjustment) }
        : {}),
    });

    return c.json(
      createSuccessResponse(choice, "Option choice updated successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// DELETE /option-choices/:choiceId - Delete option choice
app.delete(
  "/option-choices/:choiceId",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.optionChoiceIdParam),
  async (c) => {
    const { choiceId } = c.get("validatedParams");
    const user = c.get("user");
    const service = new MenuService(c.env);

    const existingChoice = await service.getOptionChoice(choiceId);
    if (!existingChoice) {
      throw notFound("Option choice not found");
    }
    assertUserCanAccessRestaurantResource(
      user,
      String(existingChoice.restaurantId),
    );

    const deleted = await service.deleteOptionChoice(choiceId);
    if (!deleted) {
      throw notFound("Option choice not found");
    }

    return c.json(
      createSuccessResponse(null, "Option choice deleted successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// GET /items/:id/option-groups - Read raw option group links and overrides
app.get(
  "/items/:id/option-groups",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.menuItemIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = new MenuService(c.env);

    const existingItem = await service.getMenuItem(id);
    if (!existingItem) {
      throw notFound("Menu item not found");
    }
    assertUserCanAccessRestaurantResource(user, existingItem.restaurantId);

    const groups = await service.listMenuItemOptionGroups(id);

    return c.json(createSuccessResponse(groups), HTTP_STATUS.OK);
  },
);

// PUT /items/:id/option-groups - Replace all option groups for a menu item
app.put(
  "/items/:id/option-groups",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.menuItemIdParam),
  validateBody(menuSchemas.replaceMenuItemOptionGroups),
  async (c) => {
    const { id } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new MenuService(c.env);

    const existingItem = await service.getMenuItem(id);
    if (!existingItem) {
      throw notFound("Menu item not found");
    }
    assertUserCanAccessRestaurantResource(user, existingItem.restaurantId);

    try {
      await service.replaceMenuItemOptionGroups(
        id,
        data.groups.map((group) => ({
          groupId: group.groupId,
          sortOrder: group.sortOrder,
          requiredOverride: group.requiredOverride,
          maxSelectionsOverride: group.maxSelectionsOverride,
          choiceOverrides: group.choiceOverrides?.map((override) => ({
            choiceId: override.choiceId,
            isHidden: override.isHidden,
            priceAdjustmentCents:
              override.priceAdjustment === undefined ||
              override.priceAdjustment === null
                ? override.priceAdjustment
                : toRequiredCents(override.priceAdjustment),
          })),
        })),
      );
    } catch (error) {
      mapOptionGroupMutationError(error);
    }

    return c.json(
      createSuccessResponse(
        null,
        "Menu item option groups updated successfully",
      ),
      HTTP_STATUS.OK,
    );
  },
);

// POST /:restaurantId/items - Create menu item
// CHEF is deliberately absent: creating an item sets its price (#85). Chefs
// change stock through PATCH /:restaurantId/items/availability or a
// stock-only PUT /items/:id.
app.post(
  "/:restaurantId/items",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  validateBody(menuSchemas.createMenuItem),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const service = new MenuService(c.env);

    const item = await service.createMenuItem({
      ...data,
      restaurantId,
    });
    await syncMenuItems(c.env, [item.id]);

    return c.json(
      createSuccessResponse(item, "Menu item created successfully"),
      HTTP_STATUS.CREATED,
    );
  },
);

// POST /:restaurantId/items/bulk - Create many menu items atomically
// Same role table as the single create (both set prices), and the same
// restaurant scoping. The importer used to loop single POSTs from the browser,
// which committed every row up to the one that failed (#85).
app.post(
  "/:restaurantId/items/bulk",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  validateBody(menuSchemas.bulkCreateMenuItems),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { items } = c.get("validatedBody");
    const service = new MenuService(c.env);

    const created = await service.bulkCreateMenuItems(restaurantId, items);
    await syncMenuItems(
      c.env,
      created.map((item) => item.id),
    );

    return c.json(
      createSuccessResponse(
        { created: created.length, items: created },
        "Menu items created successfully",
      ),
      HTTP_STATUS.CREATED,
    );
  },
);

// PUT /items/:id - Update menu item
// CHEF is admitted by role but restricted by body — see
// assertChefFieldsAllowed.
app.put(
  "/items/:id",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER, USER_ROLES.CHEF]),
  validateParams(menuSchemas.menuItemIdParam),
  validateBody(menuSchemas.updateMenuItem),
  async (c) => {
    const { id } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new MenuService(c.env);

    // Body-shape check before any DB work: a chef sending price/name is
    // refused whether or not the item exists.
    assertChefFieldsAllowed(user.role, data);

    // Get existing item to check restaurant access
    const existingItem = await service.getMenuItem(id);
    if (!existingItem) {
      throw notFound("Menu item not found");
    }

    // Check restaurant access for non-admin users
    if (
      user.role !== USER_ROLES.ADMIN &&
      user.restaurantId !== existingItem.restaurantId
    ) {
      throw forbidden("Access denied");
    }

    const item = await service.updateMenuItem(id, data, existingItem);
    await syncMenuItems(c.env, [id]);

    return c.json(
      createSuccessResponse(item, "Menu item updated successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// DELETE /items/:id - Delete menu item
app.delete(
  "/items/:id",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.menuItemIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = new MenuService(c.env);

    const existingItem = await service.getMenuItem(id);
    if (!existingItem) {
      throw notFound("Menu item not found");
    }

    if (
      user.role !== USER_ROLES.ADMIN &&
      user.restaurantId !== existingItem.restaurantId
    ) {
      throw forbidden("Access denied");
    }

    const deleted = await service.deleteMenuItem(id, existingItem);

    if (!deleted) {
      throw notFound("Menu item not found");
    }
    await syncMenuItems(c.env, [id]);

    return c.json(
      createSuccessResponse(null, "Menu item deleted successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// PATCH /:restaurantId/items/availability - Batch update menu item availability
app.patch(
  "/:restaurantId/items/availability",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER, USER_ROLES.CHEF]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  validateBody(menuSchemas.bulkAvailabilityUpdate),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { updates } = c.get("validatedBody");
    const service = new MenuService(c.env);

    await service.batchUpdateAvailability(restaurantId, updates);
    await syncMenuItems(
      c.env,
      updates.map((update) => update.id),
    );

    return c.json(
      createSuccessResponse(
        null,
        "Menu items availability updated successfully",
      ),
      HTTP_STATUS.OK,
    );
  },
);

// PATCH /:restaurantId/items/prices - Batch update menu item prices
app.patch(
  "/:restaurantId/items/prices",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  validateBody(menuSchemas.bulkPriceUpdate),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { updates } = c.get("validatedBody");
    const service = new MenuService(c.env);

    await service.batchUpdatePrices(restaurantId, updates);
    await syncMenuItems(
      c.env,
      updates.map((update) => update.id),
    );

    return c.json(
      createSuccessResponse(null, "Menu item prices updated successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// PATCH /:restaurantId/items/categories - Batch move items to different categories
app.patch(
  "/:restaurantId/items/categories",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  validateBody(menuSchemas.bulkCategoryMove),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { updates } = c.get("validatedBody");
    const service = new MenuService(c.env);

    await service.batchMoveItems(restaurantId, updates);
    await syncMenuItems(
      c.env,
      updates.map((update) => update.id),
    );

    return c.json(
      createSuccessResponse(
        null,
        "Menu items moved to new categories successfully",
      ),
      HTTP_STATUS.OK,
    );
  },
);

// Category Management Routes

// POST /:restaurantId/categories - Create category
app.post(
  "/:restaurantId/categories",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  validateBody(menuSchemas.createCategory),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const service = new MenuService(c.env);

    const category = await service.createCategory({
      ...data,
      restaurantId,
    });

    return c.json(
      createSuccessResponse(category, "Category created successfully"),
      HTTP_STATUS.CREATED,
    );
  },
);

// PUT /categories/:id - Update category
app.put(
  "/categories/:id",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.categoryIdParam),
  validateBody(menuSchemas.updateCategory),
  async (c) => {
    const { id } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new MenuService(c.env);

    // Check restaurant access BEFORE mutation
    const existingCategory = await service.getCategoryById(id);
    if (!existingCategory) {
      throw notFound("Category not found");
    }
    if (
      user.role !== USER_ROLES.ADMIN &&
      user.restaurantId !== existingCategory.restaurantId
    ) {
      throw forbidden("Access denied");
    }

    const category = await service.updateCategory(id, data);
    await syncCategoryItems(c.env, id);

    return c.json(
      createSuccessResponse(category, "Category updated successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// PATCH /:restaurantId/categories/reorder - Batch reorder categories
app.patch(
  "/:restaurantId/categories/reorder",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  validateBody(menuSchemas.categoryReorder),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { categories } = c.get("validatedBody");
    const service = new MenuService(c.env);

    await service.reorderCategories(restaurantId, categories);

    return c.json(
      createSuccessResponse(null, "Categories reordered successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// DELETE /categories/:id - Delete category
app.delete(
  "/categories/:id",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(menuSchemas.categoryIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = new MenuService(c.env);

    // Check restaurant access BEFORE deletion
    const existingCategory = await service.getCategoryById(id);
    if (!existingCategory) {
      throw notFound("Category not found or cannot be deleted");
    }
    if (
      user.role !== USER_ROLES.ADMIN &&
      user.restaurantId !== existingCategory.restaurantId
    ) {
      throw forbidden("Access denied");
    }

    const deleted = await service.deleteCategory(id);

    if (!deleted) {
      throw notFound("Category not found or cannot be deleted");
    }
    await syncCategoryItems(c.env, id);

    return c.json(
      createSuccessResponse(null, "Category deleted successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// Analytics Routes

// GET /:restaurantId/analytics - Get menu analytics
app.get(
  "/:restaurantId/analytics",
  authMiddleware,
  moduleGate("menu_management"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  validateQuery(menuSchemas.analyticsQuery),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const service = new MenuService(c.env);

    const analytics = await service.getMenuAnalytics(restaurantId);

    return c.json(createSuccessResponse(analytics), HTTP_STATUS.OK);
  },
);

// GET /:restaurantId/popularity - Get popularity metrics
// Unlike /analytics above (catalogue metadata — item counts, price ranges),
// this surfaces order-derived sales data (mostOrdered, etc.), which is
// "analytics" (pro tier), not the always-on "menu_management" module.
app.get(
  "/:restaurantId/popularity",
  authMiddleware,
  moduleGate("analytics"),
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(menuSchemas.restaurantIdParam),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const service = new MenuService(c.env);

    const metrics = await service.getPopularityMetrics(restaurantId);

    return c.json(createSuccessResponse(metrics), HTTP_STATUS.OK);
  },
);

export default app;
