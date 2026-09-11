import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../types/env";
import { authMiddleware } from "../../../middleware/auth";
import { validateBody } from "../../../middleware/validation";

const auditActionSchema = z.lazy(() =>
  z
    .object({
      action_type: z.string().min(1).max(100),
      target_id: z.union([z.string(), z.number()]).optional(),
      data: z.record(z.string(), z.unknown()).default({}),
      user_id: z.union([z.string(), z.number()]).optional(),
      restaurant_id: z.union([z.string(), z.number()]).optional(),
      timestamp: z.string().optional(),
    })
    .loose(),
);

const routes = new Hono<{ Bindings: Env }>();

routes.post(
  "/actions",
  authMiddleware,
  validateBody(auditActionSchema),
  async (c) => {
    const body = c.get("validatedBody");
    const user = c.get("user");
    const action = body.action_type;
    const resource = inferResource(action);
    const resourceId =
      body.target_id !== undefined ? String(body.target_id) : null;
    const restaurantId =
      body.restaurant_id !== undefined
        ? String(body.restaurant_id)
        : user.restaurantId !== undefined
          ? String(user.restaurantId)
          : null;

    if (!canWriteRestaurantScope(user, restaurantId)) {
      return c.json(
        {
          success: false,
          error: {
            code: "AUDIT_ACTION_FORBIDDEN",
            message: "Cannot sync audit actions for another restaurant",
          },
        },
        403,
      );
    }

    const createdAt = toTimestampMs(body.timestamp);
    const description = resourceId
      ? `Offline ${action} on ${resource}#${resourceId}`
      : `Offline ${action} on ${resource}`;
    const changes = {
      metadata: {
        offline: true,
        payload: body.data,
        requestedUserId: body.user_id ?? null,
        requestedTimestamp: body.timestamp ?? null,
      },
    };

    const result = await c.env.DB.prepare(
      `INSERT INTO audit_logs (
         user_id,
         restaurant_id,
         action,
         resource,
         resource_id,
         description,
         changes,
         ip_address,
         user_agent,
         success,
         created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        user.id,
        restaurantId,
        action,
        resource,
        resourceId,
        description,
        JSON.stringify(changes),
        c.req.header("cf-connecting-ip") ||
          c.req.header("x-forwarded-for") ||
          null,
        c.req.header("user-agent") || null,
        1,
        createdAt,
      )
      .run();

    const auditLogId =
      Number(
        (result.meta as { last_row_id?: number | string } | undefined)
          ?.last_row_id,
      ) || null;

    return c.json(
      {
        success: true,
        data: {
          auditLogId,
          synced: true,
          action,
          resource,
          resourceId,
          restaurantId,
        },
      },
      201,
    );
  },
);

function inferResource(action: string): string {
  const normalized = action.toLowerCase();
  if (normalized.includes("order")) return "orders";
  if (normalized.includes("menu")) return "menu_items";
  if (normalized.includes("user")) return "users";
  if (normalized.includes("setting")) return "settings";
  if (normalized.includes("backup")) return "backups";
  if (normalized.includes("analytics")) return "analytics";
  return "admin_action";
}

function toTimestampMs(timestamp: string | undefined): number {
  if (!timestamp) return Date.now();

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function canWriteRestaurantScope(
  user: { role?: number; restaurantId?: string | number | null },
  restaurantId: string | null,
): boolean {
  if (user.role === 0 || restaurantId === null) return true;
  if (user.restaurantId === undefined || user.restaurantId === null) {
    return false;
  }
  return String(user.restaurantId) === restaurantId;
}

export default routes;
