import { Hono } from "hono";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import type { AuthUser } from "../../../middleware/auth";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../../shared/middleware";
import { forbidden } from "../../../shared/utils/api-error";
import { BroadcastService } from "../services/BroadcastService";
import {
  broadcastHistoryQuerySchema,
  broadcastScopeParamSchema,
  sendBroadcastSchema,
  type BroadcastHistoryQueryInput,
  type BroadcastScopeParamInput,
  type SendBroadcastInput,
} from "../schemas/validation";
import type { Env } from "../../../types/env";

/**
 * Vendor-scoped marketing broadcasts (#335), mounted at `/api/v1/restaurants`.
 *
 * Admin (0) and owner (1) only. No staff role sends marketing — a broadcast
 * spends a limited daily budget and reaches people outside the shop.
 */
const app = new Hono<{ Bindings: Env }>();

const BROADCAST_ROLES = [0, 1];

/**
 * Tenancy guard, written in the handler rather than mounted as middleware.
 *
 * A route test that mocks auth by hand never executes a mounted middleware
 * chain, so a guard living there would look covered while being absent from
 * every test (the same reason the reviews and alerts features call theirs
 * explicitly). Takes `env` and `user` rather than the Context because Hono
 * narrows the context type per route from the validation middleware.
 */
export function assertRestaurantScope(
  env: Env,
  user: AuthUser,
  restaurantId: string,
): void {
  if (env.DEPLOYMENT_MODE === "independent") {
    if (!env.TENANT_ID || restaurantId !== env.TENANT_ID) {
      throw forbidden("Access denied to this restaurant", "FORBIDDEN");
    }
    return;
  }

  if (user.role === 0) return;

  if (!user.restaurantId || String(user.restaurantId) !== restaurantId) {
    throw forbidden("Access denied to this restaurant", "FORBIDDEN");
  }
}

/**
 * Send a broadcast to this restaurant's followers.
 * POST /api/v1/restaurants/:id/broadcasts
 */
app.post(
  "/:id/broadcasts",
  authMiddleware,
  requireRole(BROADCAST_ROLES),
  validateParams(broadcastScopeParamSchema),
  validateBody(sendBroadcastSchema),
  async (c) => {
    const { id: restaurantId } = c.get(
      "validatedParams",
    ) as BroadcastScopeParamInput;
    assertRestaurantScope(c.env, c.get("user"), restaurantId);

    const body = c.get("validatedBody") as SendBroadcastInput;
    const service = new BroadcastService(c.env);
    const result = await service.send({
      scopeType: "restaurant",
      scopeId: restaurantId,
      sentBy: String(c.get("user").id),
      title: body.title,
      body: body.body,
      url: body.url,
      includeMarketFollowers: body.includeMarketFollowers,
    });

    return c.json({ success: true, data: result }, 201);
  },
);

/**
 * Send history for this restaurant, newest first.
 * GET /api/v1/restaurants/:id/broadcasts
 */
app.get(
  "/:id/broadcasts",
  authMiddleware,
  requireRole(BROADCAST_ROLES),
  validateParams(broadcastScopeParamSchema),
  validateQuery(broadcastHistoryQuerySchema),
  async (c) => {
    const { id: restaurantId } = c.get(
      "validatedParams",
    ) as BroadcastScopeParamInput;
    assertRestaurantScope(c.env, c.get("user"), restaurantId);

    const { page, limit } = c.get(
      "validatedQuery",
    ) as BroadcastHistoryQueryInput;
    const service = new BroadcastService(c.env);
    const result = await service.listHistory(
      "restaurant",
      restaurantId,
      page,
      limit,
    );

    return c.json({ success: true, data: result });
  },
);

export default app;
