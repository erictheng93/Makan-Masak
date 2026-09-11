import { Hono } from "hono";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc } from "drizzle-orm";
import { platformWebhookLogs } from "@makanmasak/database";
import { validateBody } from "../../../middleware/validation";
import type {
  PlatformType,
  ConnectPlatformRequest,
  UpdatePlatformConfigRequest,
  PlatformOrdersFilter,
} from "@makanmasak/shared-types";
import type { Env } from "../../../types/env";
import { authMiddleware, requireRole } from "../../../shared/middleware";
import { ApiError, notFound } from "../../../shared/utils/api-error";
import { moduleGate } from "../../../middleware/moduleGate";
import { forbidden } from "../../../shared/utils/api-error";
import { PlatformIntegrationService } from "../services/PlatformIntegrationService";
import { PlatformOrderService } from "../services/PlatformOrderService";
import { PlatformMenuSyncService } from "../services/PlatformMenuSyncService";
import { isPlatformAdapterSupported } from "../adapters/PlatformAdapter";

type IntegrationAdminUser = {
  role: number;
  restaurantId?: string | number | null;
};

type IntegrationAdminEnv = {
  Bindings: Env;
  Variables: {
    user: IntegrationAdminUser;
  };
};

const adminRoutes = new Hono<IntegrationAdminEnv>();

function assertRestaurantScope(
  user: IntegrationAdminUser,
  restaurantId: string,
) {
  if (user.role === 0) {
    return;
  }

  if (user.restaurantId == null || String(user.restaurantId) !== restaurantId) {
    throw forbidden("Cannot manage integrations for another restaurant");
  }
}

// All admin routes require admin (0) or shop owner (1) role
adminRoutes.use("/*", authMiddleware);
adminRoutes.use("/*", requireRole([0, 1]));
adminRoutes.use("/*", moduleGate("platform_integration"));
adminRoutes.use("/:restaurantId", async (c, next) => {
  assertRestaurantScope(c.get("user"), c.req.param("restaurantId"));
  await next();
});
adminRoutes.use("/:restaurantId/*", async (c, next) => {
  assertRestaurantScope(c.get("user"), c.req.param("restaurantId"));
  await next();
});

// GET /:restaurantId — list all integrations
adminRoutes.get("/:restaurantId", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const service = new PlatformIntegrationService(c.env);
  const integrations = await service.getIntegrations(restaurantId);
  return c.json({ data: integrations });
});

// GET /:restaurantId/webhook-logs — list webhook logs
// Registered before /:restaurantId/:platform to avoid being shadowed by the dynamic segment
adminRoutes.get("/:restaurantId/webhook-logs", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const platform = c.req.query("platform") as PlatformType | undefined;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;

  const db = drizzle(c.env.DB);

  const conditions = [eq(platformWebhookLogs.restaurantId, restaurantId)];
  if (platform) {
    conditions.push(eq(platformWebhookLogs.platform, platform));
  }

  const logs = await db
    .select()
    .from(platformWebhookLogs)
    .where(and(...conditions))
    .orderBy(desc(platformWebhookLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ data: logs });
});

// GET /:restaurantId/:platform — get specific integration details
adminRoutes.get("/:restaurantId/:platform", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const platform = c.req.param("platform") as PlatformType;
  const service = new PlatformIntegrationService(c.env);

  const integration = await service.getIntegration(restaurantId, platform);
  if (!integration) {
    throw notFound("Integration not found", "INTEGRATION_NOT_FOUND");
  }

  return c.json({ data: integration });
});

/**
 * The admin UI already refuses a blank clientId, clientSecret or storeId, but
 * the route accepted whatever JSON arrived. Two things went wrong when it did:
 * a row with no secret made the webhook signature check a formality (it keyed
 * the HMAC on ""), and a row with no storeId can never be matched by an
 * incoming webhook at all. The server has no reason to be more permissive than
 * its own form (#338).
 */
const connectPlatformSchema = z.lazy(() =>
  z.object({
    clientId: z.string().trim().min(1),
    clientSecret: z.string().trim().min(1),
    storeId: z.string().trim().min(1),
    autoAcceptOrders: z.boolean().optional(),
    menuSyncEnabled: z.boolean().optional(),
  }),
);

// POST /:restaurantId/:platform/connect — connect platform
adminRoutes.post(
  "/:restaurantId/:platform/connect",
  validateBody(connectPlatformSchema),
  async (c) => {
    const restaurantId = c.req.param("restaurantId");
    const platform = c.req.param("platform") as PlatformType;
    const body = c.get("validatedBody") as ConnectPlatformRequest;

    if (!isPlatformAdapterSupported(platform)) {
      throw new ApiError(
        "INTEGRATION_NOT_AVAILABLE",
        `${platform} integration is not available yet`,
        501,
      );
    }

    const service = new PlatformIntegrationService(c.env);
    const integration = await service.connect(restaurantId, platform, body);

    return c.json({ data: integration }, 201);
  },
);

// PUT /:restaurantId/:platform — update config
adminRoutes.put("/:restaurantId/:platform", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const platform = c.req.param("platform") as PlatformType;
  const body = await c.req.json<UpdatePlatformConfigRequest>();

  if (!isPlatformAdapterSupported(platform)) {
    throw new ApiError(
      "INTEGRATION_NOT_AVAILABLE",
      `${platform} integration is not available yet`,
      501,
    );
  }

  const service = new PlatformIntegrationService(c.env);
  const integration = await service.updateConfig(restaurantId, platform, body);

  return c.json({ data: integration });
});

// DELETE /:restaurantId/:platform — disconnect
adminRoutes.delete("/:restaurantId/:platform", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const platform = c.req.param("platform") as PlatformType;

  const service = new PlatformIntegrationService(c.env);
  await service.disconnect(restaurantId, platform);

  return c.json({ success: true });
});

// POST /:restaurantId/:platform/menu-sync — trigger menu sync
adminRoutes.post("/:restaurantId/:platform/menu-sync", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const platform = c.req.param("platform") as PlatformType;

  if (!isPlatformAdapterSupported(platform)) {
    throw new ApiError(
      "INTEGRATION_NOT_AVAILABLE",
      `${platform} integration is not available yet`,
      501,
    );
  }

  const service = new PlatformMenuSyncService(c.env);
  await service.syncMenu(restaurantId, platform);
  return c.json({ success: true, message: "Menu sync completed" });
});

// GET /:restaurantId/:platform/orders — list platform orders
adminRoutes.get("/:restaurantId/:platform/orders", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const platform = c.req.param("platform") as PlatformType;

  const filters: PlatformOrdersFilter = {
    platform,
    platformStatus: c.req.query("status") ?? undefined,
    limit: c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50,
    page: c.req.query("page") ? parseInt(c.req.query("page")!) : 1,
  };

  const service = new PlatformOrderService(c.env);
  const orders = await service.getPlatformOrders(restaurantId, filters);

  return c.json({ data: orders });
});

export default adminRoutes;
