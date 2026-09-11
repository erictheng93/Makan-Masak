/**
 * Kitchen Feature Routes
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { sign } from "hono/jwt";
import { streamSSE } from "hono/streaming";
import { authMiddleware, sseAuthMiddleware } from "../../../middleware/auth";
import { moduleGate } from "../../../middleware/moduleGate";
import { validateBody } from "../../../middleware/validation";
import type { Env } from "../../../types/env";
import { KitchenService } from "../services/KitchenService";
import { orderItemStatusUpdateSchema } from "../schemas/validation";
import type { OrderItemStatusUpdate } from "../types";
import { createSuccessResponse } from "../../../shared/utils/response";
import { forbidden, badRequest } from "../../../shared/utils/api-error";
import { resolveOrderIdentity } from "../../../shared/services/order-identity";

const app = new Hono<{ Bindings: Env }>();
const KITCHEN_SSE_TOKEN_SECONDS = 60;
const notificationSettingsSchema = z.lazy(() => z.object({}).loose());
type NotificationSettings = Record<string, unknown>;
interface NotificationSettingsRecord {
  settings?: NotificationSettings;
}

function createNotificationSettingsKey(user: {
  id: string;
  restaurantId?: string | number | null;
}): string {
  const restaurantId =
    user.restaurantId == null ? "" : String(user.restaurantId).trim();
  const scope = restaurantId ? encodeURIComponent(restaurantId) : "global";
  return `kitchen:notification-settings:${scope}:${user.id}`;
}

function parseRouteNumber(value: string | undefined, name: string): number {
  if (!value) {
    throw badRequest(`Missing ${name} parameter`, "MISSING_PARAM");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`Invalid ${name} parameter`, "INVALID_PARAM");
  }

  return parsed;
}

function parseKitchenOrdersLimit(value: string | undefined): number {
  if (!value) return 100;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 500) {
    throw badRequest("Invalid limit query parameter", "INVALID_LIMIT");
  }

  return parsed;
}

function extractLegacyNotes(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;
  if (typeof record.notes === "string") return record.notes;

  const data = record.data;
  if (data && typeof data === "object") {
    const dataRecord = data as Record<string, unknown>;
    if (typeof dataRecord.notes === "string") return dataRecord.notes;
  }

  return undefined;
}

async function updateLegacyItemStatus<E extends { Bindings: Env }>(
  c: Context<E>,
  status: OrderItemStatusUpdate["status"],
) {
  const itemId = parseRouteNumber(c.req.param("itemId"), "itemId");
  const user = c.get("user");
  const restaurantId =
    user.restaurantId !== undefined ? String(user.restaurantId) : "";

  // Surface usage of the deprecated path so we can confirm queues have drained
  // before removing it. Keep the canonical route in the message so anyone
  // grepping logs lands on the migration target.
  console.warn("[deprecated-route] kitchen legacy item status hit", {
    path: c.req.path,
    canonical:
      "PUT /api/v1/kitchen/:restaurantId/orders/:orderId/items/:itemId",
    status,
    userId: user?.id,
    restaurantId,
    removeAfter: "2026-07-01",
  });

  if (!restaurantId) {
    throw forbidden(
      "Access denied. Restaurant permission required.",
      "RESTAURANT_ACCESS_DENIED",
    );
  }

  const kitchenService = new KitchenService(c.env);
  if (!kitchenService.validateChefAccess(user.id, user.role, restaurantId)) {
    throw forbidden(
      "Access denied. Chef role required.",
      "CHEF_ACCESS_REQUIRED",
    );
  }

  const payload = await c.req.json().catch(() => ({}));
  const orderIdentity = await resolveOrderIdentity(
    c.env.DB,
    c.req.param("orderId") ?? "",
    { restaurantId },
  );
  const result = await kitchenService.updateOrderItemStatus(
    restaurantId,
    orderIdentity.id,
    itemId,
    {
      status,
      notes: extractLegacyNotes(payload),
    },
    user.id,
  );

  return c.json(
    createSuccessResponse(
      { ...result, orderPublicId: orderIdentity.publicId },
      "Order item status updated successfully",
    ),
  );
}

/**
 * GET /api/v1/kitchen/notification-settings
 */
app.get(
  "/notification-settings",
  authMiddleware,
  moduleGate("kitchen_display"),
  async (c) => {
    const user = c.get("user");
    const stored = (await c.env.CACHE_KV.get(
      createNotificationSettingsKey(user),
      "json",
    )) as NotificationSettingsRecord | null;

    return c.json({
      success: true,
      data: stored?.settings ?? {},
    });
  },
);

/**
 * PUT /api/v1/kitchen/notification-settings
 */
app.put(
  "/notification-settings",
  authMiddleware,
  moduleGate("kitchen_display"),
  validateBody(notificationSettingsSchema),
  async (c) => {
    const user = c.get("user");
    const settings = c.get("validatedBody");
    const now = new Date().toISOString();
    const record = {
      userId: user.id,
      restaurantId:
        user.restaurantId !== undefined ? String(user.restaurantId) : null,
      settings,
      updatedAt: now,
    };

    await c.env.CACHE_KV.put(
      createNotificationSettingsKey(user),
      JSON.stringify(record),
    );

    return c.json({
      success: true,
      data: {
        settings,
        updatedAt: now,
      },
    });
  },
);

/**
 * POST /api/v1/kitchen/{restaurantId}/events/token
 *
 * Issues a short-lived token scoped only to the kitchen SSE endpoint. EventSource
 * cannot send Authorization headers, so the stream URL gets this narrow token
 * instead of the user's primary access token.
 */
app.post(
  "/:restaurantId/events/token",
  authMiddleware,
  moduleGate("kitchen_display"),
  async (c) => {
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");

    const user = c.get("user");
    const kitchenService = new KitchenService(c.env);

    if (
      !kitchenService.validateChefAccess(user.id, user.role, restaurantId) ||
      String(user.restaurantId) !== restaurantId
    ) {
      throw forbidden("Access denied", "ACCESS_DENIED");
    }

    const now = Math.floor(Date.now() / 1000);
    const sseToken = await sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        restaurantId,
        purpose: "kitchen_sse",
        aud: "kitchen_sse",
        iat: now,
        exp: now + KITCHEN_SSE_TOKEN_SECONDS,
      },
      c.env.JWT_SECRET,
      "HS256",
    );

    return c.json(
      createSuccessResponse(
        { sseToken, expiresIn: KITCHEN_SSE_TOKEN_SECONDS },
        "Kitchen SSE token issued successfully",
      ),
    );
  },
);

/**
 * @deprecated Compatibility shim for offline queues that captured the pre-2026-04
 * URL shape before the canonical PUT route landed. Drains pending writes from
 * kitchen-display devices that were offline across the migration.
 *
 * Canonical route: PUT /api/v1/kitchen/:restaurantId/orders/:orderId/items/:itemId
 * Remove after: 2026-07-01 (verify no [deprecated-route] warnings in the
 *   preceding 14 days before deletion).
 *
 * POST /api/v1/kitchen/:orderId/items/:itemId/start
 */
app.post(
  "/:orderId/items/:itemId/start",
  authMiddleware,
  moduleGate("kitchen_display"),
  async (c) => updateLegacyItemStatus(c, "preparing"),
);

/**
 * @deprecated See sibling /start route above. Same removal plan.
 *
 * POST /api/v1/kitchen/:orderId/items/:itemId/ready
 */
app.post(
  "/:orderId/items/:itemId/ready",
  authMiddleware,
  moduleGate("kitchen_display"),
  async (c) => updateLegacyItemStatus(c, "ready"),
);

/**
 * SSE 端點 - 廚房連線狀態指示
 * GET /api/v1/kitchen/{restaurantId}/events
 *
 * This stream only emits a "connected" welcome event and periodic heartbeats
 * so the kitchen-display UI can show online/offline status. Actual order
 * events flow through the realtime WebSocket (REALTIME_SESSION Durable
 * Object), not through this stream.
 */
app.get(
  "/:restaurantId/events",
  sseAuthMiddleware,
  moduleGate("kitchen_display"),
  async (c) => {
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
    const user = c.get("user");
    const kitchenService = new KitchenService(c.env);

    if (!kitchenService.validateChefAccess(user.id, user.role, restaurantId)) {
      throw forbidden(
        "Access denied. Chef role required.",
        "CHEF_ACCESS_REQUIRED",
      );
    }

    if (user.restaurantId !== restaurantId) {
      throw forbidden(
        "Access denied. Restaurant permission required.",
        "RESTAURANT_ACCESS_DENIED",
      );
    }

    console.log(
      `Kitchen SSE connection requested for restaurant ${restaurantId} by user ${user.id}`,
    );

    return streamSSE(c, async (stream) => {
      // Send initial connection confirmation. Don't await — Hono's streamSSE
      // needs the handler to yield quickly so the initial response headers
      // and body chunk are flushed to the client.
      stream.writeSSE({
        event: "connected",
        data: JSON.stringify({
          type: "HEARTBEAT",
          timestamp: new Date().toISOString(),
          restaurantId,
          message: "Kitchen display connected successfully",
        }),
        id: `heartbeat_${Date.now()}`,
      });

      const heartbeatInterval = setInterval(() => {
        try {
          stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({
              type: "HEARTBEAT",
              timestamp: new Date().toISOString(),
              restaurantId,
            }),
            id: `heartbeat_${Date.now()}`,
          });
        } catch (error) {
          console.error("Kitchen SSE heartbeat failed:", error);
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Keep stream alive until client disconnects
      await new Promise<void>((resolve) => {
        c.req.raw.signal?.addEventListener("abort", () => {
          console.log(
            `Kitchen SSE connection closed (restaurant ${restaurantId})`,
          );
          clearInterval(heartbeatInterval);
          resolve();
        });
      });
    });
  },
);

/**
 * 獲取廚房訂單資料
 * GET /api/v1/kitchen/{restaurantId}/orders
 */
app.get(
  "/:restaurantId/orders",
  authMiddleware,
  moduleGate("kitchen_display"),
  async (c) => {
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
    const user = c.get("user");
    const kitchenService = new KitchenService(c.env);

    if (
      !kitchenService.validateChefAccess(user.id, user.role, restaurantId) ||
      user.restaurantId !== restaurantId
    ) {
      throw forbidden("Access denied", "ACCESS_DENIED");
    }

    const data = await kitchenService.getKitchenOrders(
      restaurantId,
      user.id,
      parseKitchenOrdersLimit(c.req.query("limit")),
    );

    return c.json(
      createSuccessResponse(data, "Kitchen orders retrieved successfully"),
    );
  },
);

/**
 * 更新訂單項目狀態
 * PUT /api/v1/kitchen/{restaurantId}/orders/{orderId}/items/{itemId}
 */
app.put(
  "/:restaurantId/orders/:orderId/items/:itemId",
  authMiddleware,
  moduleGate("kitchen_display"),
  validateBody(orderItemStatusUpdateSchema),
  async (c) => {
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId)
      throw badRequest("Missing restaurantId parameter", "MISSING_PARAM");
    const orderIdParam = c.req.param("orderId");
    if (!orderIdParam)
      throw badRequest("Missing orderId parameter", "MISSING_PARAM");
    const itemIdParam = c.req.param("itemId");
    if (!itemIdParam)
      throw badRequest("Missing itemId parameter", "MISSING_PARAM");
    const itemId = parseInt(itemIdParam);
    const statusUpdate = c.get("validatedBody");
    const user = c.get("user");
    const kitchenService = new KitchenService(c.env);

    if (
      !kitchenService.validateChefAccess(user.id, user.role, restaurantId) ||
      user.restaurantId !== restaurantId
    ) {
      throw forbidden("Access denied", "ACCESS_DENIED");
    }

    const orderIdentity = await resolveOrderIdentity(c.env.DB, orderIdParam, {
      restaurantId,
    });
    const result = await kitchenService.updateOrderItemStatus(
      restaurantId,
      orderIdentity.id,
      itemId,
      statusUpdate,
      user.id,
    );

    return c.json(
      createSuccessResponse(
        { ...result, orderPublicId: orderIdentity.publicId },
        "Order item status updated successfully",
      ),
    );
  },
);

export default app;
