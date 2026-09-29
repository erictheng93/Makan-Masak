/**
 * Restaurants Routes
 * HTTP route handlers for restaurant operations
 */

import { Hono, type Context } from "hono";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../middleware/validation";
import {
  authMiddleware,
  requireRole,
  optionalAuth,
} from "../../../middleware/auth";
import { moduleGate } from "../../../middleware/moduleGate";
import { ConsoleLogger } from "../../../core/monitoring";
import { HTTP_STATUS, USER_ROLES } from "../../../shared/constants";
import type { Env } from "../../../shared/types";
import {
  badRequest,
  notFound,
  forbidden,
} from "../../../shared/utils/api-error";

import { RestaurantsService } from "../services/RestaurantsService";
import { restaurantSchemas } from "../schemas/validation";
import { MarketsService } from "../../markets/services/MarketsService";
import {
  createMarketJoinRequestSchema,
  marketOpenReportQuerySchema,
  restaurantMarketParamSchema,
} from "../../markets/schemas/validation";
import { MarketOpenReportService } from "../../markets/services/MarketOpenReportService";
import { openReportResponse } from "../../markets/routes/open-report-response";
import { createSearchIndexSync } from "../../discovery/services/SearchIndexSyncService";
import { TablesService } from "../../tables/services/TablesService";

const app = new Hono<{ Bindings: Env }>();
const logger = new ConsoleLogger("RestaurantsRoutes");

// Common schemas for parameters (reusing from validation middleware)
const commonSchemas = {
  idParam: restaurantSchemas.params,
  serviceItemParam: restaurantSchemas.serviceItemParams,
};

const ONBOARDING_PLACEHOLDER_DESCRIPTION_PREFIX =
  "Provisioned from onboarding application ";

function withPublicRestaurantDescriptionContract<
  T extends { description?: unknown },
>(restaurant: T): T & { isPlaceholderDescription?: boolean } {
  const description =
    typeof restaurant.description === "string"
      ? restaurant.description.trim()
      : "";

  if (!description.startsWith(ONBOARDING_PLACEHOLDER_DESCRIPTION_PREFIX)) {
    return restaurant;
  }

  return {
    ...restaurant,
    description: null,
    isPlaceholderDescription: true,
  };
}

function assertCanManageRestaurant(
  user: { role: number; restaurantId?: string | number | null },
  restaurantId: string,
) {
  if (
    user.role === USER_ROLES.OWNER &&
    String(user.restaurantId) !== restaurantId
  ) {
    throw forbidden("Access denied");
  }
}

/**
 * GET / - Get restaurants list (public API)
 * Query parameters: page, limit, type, district, isAvailable
 */
app.get("/", optionalAuth, validateQuery(restaurantSchemas.list), async (c) => {
  logger.debug("Getting restaurants list", {
    query: c.get("validatedQuery"),
  });

  const query = c.get("validatedQuery");
  const restaurantsService = new RestaurantsService(
    c.env.DB,
    c.env,
    c.env.CACHE_KV,
  );

  const result = await restaurantsService.getRestaurants(query);

  return c.json(
    {
      success: true,
      data: result.restaurants,
      pagination: result.pagination || {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      },
    },
    HTTP_STATUS.OK,
  );
});

/**
 * GET /popular - Get popular restaurants (public API)
 * Query parameters: limit
 */
app.get("/popular", validateQuery(restaurantSchemas.popular), async (c) => {
  logger.debug("Getting popular restaurants", {
    query: c.get("validatedQuery"),
  });

  const { limit } = c.get("validatedQuery");
  const restaurantsService = new RestaurantsService(
    c.env.DB,
    c.env,
    c.env.CACHE_KV,
  );

  const restaurants = await restaurantsService.getPopularRestaurants(limit);

  return c.json(
    {
      success: true,
      data: restaurants,
    },
    HTTP_STATUS.OK,
  );
});

/**
 * GET /nearby/:district - Search nearby restaurants (public API)
 * Parameters: district
 * Query parameters: limit
 */
app.get(
  "/nearby/:district",
  validateParams(restaurantSchemas.districtParams),
  validateQuery(restaurantSchemas.nearby),
  async (c) => {
    logger.debug("Searching nearby restaurants", {
      params: c.get("validatedParams"),
      query: c.get("validatedQuery"),
    });

    const { district } = c.get("validatedParams");
    const { limit } = c.get("validatedQuery");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const restaurants = await restaurantsService.searchNearbyRestaurants(
      district,
      limit,
    );

    return c.json(
      {
        success: true,
        data: restaurants,
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * POST / - Create restaurant (admin only)
 * Body: CreateRestaurantData
 */
app.post(
  "/",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN]),
  validateBody(restaurantSchemas.create),
  async (c) => {
    logger.debug("Creating restaurant", { body: c.get("validatedBody") });

    const data = c.get("validatedBody");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const restaurant = await restaurantsService.createRestaurant(data);

    return c.json(
      {
        success: true,
        data: restaurant,
      },
      HTTP_STATUS.CREATED,
    );
  },
);

/**
 * GET /:id/contact-profile - Get public contact channels and active FAQs
 * Parameters: id
 */
app.get(
  "/:id/contact-profile",
  optionalAuth,
  validateParams(commonSchemas.idParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const canManage =
      user?.role === USER_ROLES.ADMIN ||
      (user?.role === USER_ROLES.OWNER && user.restaurantId === id);
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const profile = await restaurantsService.getContactProfile(id, {
      includeInactiveFaqs: canManage,
    });

    if (!profile) {
      throw notFound("Restaurant not found");
    }

    return c.json(
      {
        success: true,
        data: profile,
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * PUT /:id/contact-profile - Update public contact channels and FAQs
 * Parameters: id
 */
app.put(
  "/:id/contact-profile",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(commonSchemas.idParam),
  validateBody(restaurantSchemas.updateContactProfile),
  async (c) => {
    const { id } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const user = c.get("user");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const profile = await restaurantsService.updateContactProfile(id, body);

    if (!profile) {
      throw notFound("Restaurant not found");
    }

    return c.json(
      {
        success: true,
        data: profile,
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * GET /:id/service-items - Get public service items for a restaurant
 * Parameters: id
 */
app.get(
  "/:id/service-items",
  optionalAuth,
  validateParams(commonSchemas.idParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const canManage =
      user?.role === USER_ROLES.ADMIN ||
      (user?.role === USER_ROLES.OWNER && user.restaurantId === id);
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const serviceItems = canManage
      ? await restaurantsService.listManageableServiceItems(id)
      : await restaurantsService.listPublicServiceItems(id);

    if (!serviceItems) {
      throw notFound("Restaurant not found");
    }

    return c.json(
      {
        success: true,
        data: serviceItems,
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * GET /:id/tables/:tableId/validate - Validate a public table menu entry
 */
app.get(
  "/:id/tables/:tableId/validate",
  validateParams(restaurantSchemas.tableValidationParams),
  async (c) => {
    const { id, tableId } = c.get("validatedParams");
    const tablesService = new TablesService(c.env);
    const table = await tablesService.getTableById(tableId);

    if (
      !table ||
      String(table.restaurantId) !== id ||
      table.isActive === false
    ) {
      return c.json(
        {
          success: true,
          data: {
            isValid: false,
          },
        },
        HTTP_STATUS.OK,
      );
    }

    return c.json(
      {
        success: true,
        data: {
          isValid: true,
          table: {
            id: table.id,
            number: table.number,
            seats: table.capacity,
            status: table.isOccupied ? "occupied" : "available",
          },
        },
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * POST /:id/service-items - Create a service item for a restaurant
 */
app.post(
  "/:id/service-items",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  moduleGate("reservations"),
  validateParams(commonSchemas.idParam),
  validateBody(restaurantSchemas.createServiceItem),
  async (c) => {
    const { id } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const user = c.get("user");
    assertCanManageRestaurant(user, id);

    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );
    const serviceItem = await restaurantsService.createServiceItem(id, body);

    if (!serviceItem) {
      throw notFound("Restaurant not found");
    }

    return c.json(
      {
        success: true,
        data: serviceItem,
      },
      HTTP_STATUS.CREATED,
    );
  },
);

/**
 * PUT /:id/service-items/:serviceItemId - Update a restaurant service item
 */
app.put(
  "/:id/service-items/:serviceItemId",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  moduleGate("reservations"),
  validateParams(commonSchemas.serviceItemParam),
  validateBody(restaurantSchemas.updateServiceItem),
  async (c) => {
    const { id, serviceItemId } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const user = c.get("user");
    assertCanManageRestaurant(user, id);

    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );
    const serviceItem = await restaurantsService.updateServiceItem(
      id,
      serviceItemId,
      body,
    );

    if (!serviceItem) {
      throw notFound("Service item not found");
    }

    return c.json(
      {
        success: true,
        data: serviceItem,
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * DELETE /:id/service-items/:serviceItemId - Soft-delete a service item
 */
app.delete(
  "/:id/service-items/:serviceItemId",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  moduleGate("reservations"),
  validateParams(commonSchemas.serviceItemParam),
  async (c) => {
    const { id, serviceItemId } = c.get("validatedParams");
    const user = c.get("user");
    assertCanManageRestaurant(user, id);

    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );
    const deleted = await restaurantsService.deleteServiceItem(
      id,
      serviceItemId,
    );

    if (!deleted) {
      throw notFound("Service item not found");
    }

    return c.json(
      {
        success: true,
        message: "Service item deleted successfully",
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * GET /:id - Get restaurant details (public API)
 * Parameters: id
 */
app.get("/:id", validateParams(commonSchemas.idParam), async (c) => {
  logger.debug("Getting restaurant details", {
    params: c.get("validatedParams"),
  });

  const { id } = c.get("validatedParams");
  const restaurantsService = new RestaurantsService(
    c.env.DB,
    c.env,
    c.env.CACHE_KV,
  );

  const restaurant = await restaurantsService.getRestaurant(id);

  if (!restaurant) {
    throw notFound("Restaurant not found");
  }

  return c.json(
    {
      success: true,
      data: withPublicRestaurantDescriptionContract(restaurant),
    },
    HTTP_STATUS.OK,
  );
});

/**
 * GET /:id/markets - Get active market memberships for a restaurant
 */
app.get(
  "/:id/markets",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(commonSchemas.idParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");

    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const service = new MarketsService(c.env.DB);
    const data = await service.listRestaurantMemberships(id);

    return c.json({ success: true, data }, HTTP_STATUS.OK);
  },
);

function marketOpenTodayHandler(open: boolean) {
  return async (
    c: Context<{
      Bindings: Env;
      Variables: { validatedParams: { id: string; marketId: string } };
    }>,
  ) => {
    const { id, marketId } = c.get("validatedParams");
    const user = c.get("user");
    assertCanManageRestaurant(user, id);

    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const result = await service.setVendorOpenToday({
      marketId,
      restaurantId: id,
      open,
      actorUserId: user.id ?? null,
    });

    if (result.status === "not_member") {
      throw notFound(
        "Market membership not found",
        "MARKET_MEMBERSHIP_NOT_FOUND",
      );
    }
    if (result.status === "restaurant_inactive") {
      throw badRequest("Restaurant is not active", "RESTAURANT_INACTIVE");
    }

    return c.json({ success: true, data: result.state }, HTTP_STATUS.OK);
  };
}

app.post(
  "/:id/markets/:marketId/open",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(restaurantMarketParamSchema),
  marketOpenTodayHandler(true),
);

app.post(
  "/:id/markets/:marketId/close",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(restaurantMarketParamSchema),
  marketOpenTodayHandler(false),
);

app.get(
  "/:id/markets/:marketId/open-report",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(restaurantMarketParamSchema),
  validateQuery(marketOpenReportQuerySchema),
  async (c) => {
    const { id, marketId } = c.get("validatedParams");
    const query = c.get("validatedQuery");
    assertCanManageRestaurant(c.get("user"), id);
    const report = await new MarketOpenReportService(c.env.DB).getReport({
      marketId,
      restaurantId: id,
      from: query.from,
      to: query.to,
    });
    if (!report || report.summary.length === 0) {
      throw notFound(
        "Market membership not found",
        "MARKET_MEMBERSHIP_NOT_FOUND",
      );
    }
    return openReportResponse(c, report, query);
  },
);

/**
 * GET /:id/market-join-requests - Get market join request history
 */
app.get(
  "/:id/market-join-requests",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(commonSchemas.idParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");

    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const service = new MarketsService(c.env.DB);
    const data = await service.listRestaurantJoinRequests(id);

    return c.json({ success: true, data }, HTTP_STATUS.OK);
  },
);

/**
 * POST /:id/market-join-requests - Request joining an existing market
 */
app.post(
  "/:id/market-join-requests",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(commonSchemas.idParam),
  validateBody(createMarketJoinRequestSchema),
  async (c) => {
    const { id } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const user = c.get("user");

    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const service = new MarketsService(c.env.DB);
    const result = await service.createJoinRequest(id, body);

    if (result.status === "not_found") {
      throw notFound("Market not found");
    }

    if (result.status === "already_member") {
      return c.json(
        {
          success: false,
          error: {
            code: "ALREADY_MARKET_MEMBER",
            message: "Restaurant already belongs to this market",
          },
        },
        HTTP_STATUS.CONFLICT,
      );
    }

    if (result.status === "already_pending") {
      return c.json(
        {
          success: false,
          error: {
            code: "MARKET_JOIN_REQUEST_PENDING",
            message: "A pending join request already exists",
          },
        },
        HTTP_STATUS.CONFLICT,
      );
    }

    return c.json(
      { success: true, data: { request: result.request } },
      HTTP_STATUS.CREATED,
    );
  },
);

/**
 * PUT /:id - Update restaurant (admin and shop owner)
 * Parameters: id
 * Body: UpdateRestaurantData
 */
app.put(
  "/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(commonSchemas.idParam),
  validateBody(restaurantSchemas.update),
  async (c) => {
    logger.debug("Updating restaurant", {
      params: c.get("validatedParams"),
      body: c.get("validatedBody"),
    });

    const { id } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    // Shop owners can only update their own restaurant
    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const previousRestaurant = await restaurantsService.getRestaurant(id);
    const restaurant = await restaurantsService.updateRestaurant(id, data);

    if (!restaurant) {
      throw notFound("Restaurant not found");
    }

    const sync = createSearchIndexSync(c.env);
    await sync.onRestaurantChanged(id, {
      previousDistrict: previousRestaurant?.district,
    });

    return c.json(
      {
        success: true,
        data: restaurant,
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * DELETE /:id - Deactivate restaurant (admin only)
 * Parameters: id
 */
app.delete(
  "/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN]),
  validateParams(commonSchemas.idParam),
  async (c) => {
    logger.debug("Deactivating restaurant", {
      params: c.get("validatedParams"),
    });

    const { id } = c.get("validatedParams");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const success = await restaurantsService.deactivateRestaurant(id);

    if (!success) {
      throw notFound("Restaurant not found");
    }

    return c.json(
      {
        success: true,
        message: "Restaurant deactivated successfully",
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * GET /:id/stats - Get restaurant statistics (admin and shop owner)
 * Parameters: id
 */
app.get(
  "/:id/stats",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(commonSchemas.idParam),
  async (c) => {
    logger.debug("Getting restaurant stats", {
      params: c.get("validatedParams"),
    });

    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    // Shop owners can only view their own restaurant stats
    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const stats = await restaurantsService.getRestaurantStats(id);

    return c.json(
      {
        success: true,
        data: stats,
      },
      HTTP_STATUS.OK,
    );
  },
);

// ==================== Shop QR Code Endpoints ====================

/**
 * POST /:id/qr/shop/generate - Generate shop-level QR code
 * Parameters: id
 * For restaurants without table seating (e.g., chicken stall vendors)
 */
app.post(
  "/:id/qr/shop/generate",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  moduleGate("table_management"),
  validateParams(commonSchemas.idParam),
  async (c) => {
    logger.debug("Generating shop QR code", {
      params: c.get("validatedParams"),
    });

    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    // Shop owners can only manage their own restaurant
    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const result = await restaurantsService.generateShopQrCode(id);

    return c.json(
      {
        success: true,
        data: result,
      },
      HTTP_STATUS.CREATED,
    );
  },
);

/**
 * POST /:id/qr/shop/regenerate - Regenerate shop-level QR code
 * Parameters: id
 * Used when QR code is compromised or needs to be replaced
 */
app.post(
  "/:id/qr/shop/regenerate",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  moduleGate("table_management"),
  validateParams(commonSchemas.idParam),
  async (c) => {
    logger.debug("Regenerating shop QR code", {
      params: c.get("validatedParams"),
    });

    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    // Shop owners can only manage their own restaurant
    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const result = await restaurantsService.regenerateShopQrCode(id);

    return c.json(
      {
        success: true,
        data: result,
        message: "Shop QR code regenerated successfully",
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * GET /:id/qr/shop - Get shop-level QR code information
 * Parameters: id
 */
app.get(
  "/:id/qr/shop",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  moduleGate("table_management"),
  validateParams(commonSchemas.idParam),
  async (c) => {
    logger.debug("Getting shop QR code info", {
      params: c.get("validatedParams"),
    });

    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    // Shop owners can only view their own restaurant QR
    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const info = await restaurantsService.getShopQrCodeInfo(id);

    return c.json(
      {
        success: true,
        data: info,
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * POST /:id/qr/shop/upload-image - Upload QR code image
 * Parameters: id
 * Body: { imageUrl: string }
 */
app.post(
  "/:id/qr/shop/upload-image",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  moduleGate("table_management"),
  validateParams(commonSchemas.idParam),
  validateBody(restaurantSchemas.uploadQrImage),
  async (c) => {
    logger.debug("Uploading shop QR code image", {
      params: c.get("validatedParams"),
      body: c.get("validatedBody"),
    });

    const { id } = c.get("validatedParams");
    const { imageUrl } = c.get("validatedBody");
    const user = c.get("user");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    // Shop owners can only manage their own restaurant
    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    await restaurantsService.updateShopQrCodeImage(id, imageUrl);

    return c.json(
      {
        success: true,
        message: "QR code image uploaded successfully",
      },
      HTTP_STATUS.OK,
    );
  },
);

/**
 * PUT /:id/shop-mode - Enable or disable shop mode
 * Parameters: id
 * Body: { enabled: boolean, settings?: ShopQrSettings }
 */
app.put(
  "/:id/shop-mode",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  moduleGate("table_management"),
  validateParams(commonSchemas.idParam),
  validateBody(restaurantSchemas.updateShopMode),
  async (c) => {
    logger.debug("Updating shop mode", {
      params: c.get("validatedParams"),
      body: c.get("validatedBody"),
    });

    const { id } = c.get("validatedParams");
    const { enabled, settings } = c.get("validatedBody");
    const user = c.get("user");
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    // Shop owners can only manage their own restaurant
    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    await restaurantsService.updateShopMode(id, enabled, settings);

    return c.json(
      {
        success: true,
        message: `Shop mode ${enabled ? "enabled" : "disabled"} successfully`,
      },
      HTTP_STATUS.OK,
    );
  },
);

export default app;
