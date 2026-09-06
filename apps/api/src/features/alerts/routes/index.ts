import { Hono } from "hono";
import { RestaurantAlertService } from "@makanmasak/database";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import { validateParams, validateQuery } from "../../../middleware/validation";
import {
  alertIdParamSchema,
  alertListQuerySchema,
  type AlertIdParamInput,
  type AlertListQueryInput,
} from "../schemas/validation";
import type { Env } from "../../../types/env";

const routes = new Hono<{ Bindings: Env }>();

/** Admin (0) and owner (1). Staff roles have no emergency-alert surface. */
const ALERT_ROLES = [0, 1];

function createAlertService(env: Env): RestaurantAlertService {
  return new RestaurantAlertService(env.DB, env);
}

// Kept as a value rather than a helper taking `c`: Hono narrows the context
// type per route from the validation middleware, so a shared helper with a
// Context parameter does not typecheck across all three handlers.
const NO_RESTAURANT_ERROR = {
  success: false,
  error: {
    code: "NO_RESTAURANT",
    message: "No restaurant associated with this account",
  },
} as const;

const ALERT_NOT_FOUND_ERROR = {
  success: false,
  error: { code: "ALERT_NOT_FOUND", message: "Alert not found" },
} as const;

routes.get(
  "/",
  authMiddleware,
  requireRole(ALERT_ROLES),
  validateQuery(alertListQuerySchema),
  async (c) => {
    const user = c.get("user");
    if (!user.restaurantId) return c.json(NO_RESTAURANT_ERROR, 400);

    const { limit } = c.get("validatedQuery") as AlertListQueryInput;
    const service = createAlertService(c.env);
    const alerts = await service.listOpen(String(user.restaurantId));

    return c.json({ success: true, data: alerts.slice(0, limit) });
  },
);

routes.post(
  "/:id/resolve",
  authMiddleware,
  requireRole(ALERT_ROLES),
  validateParams(alertIdParamSchema),
  async (c) => {
    const user = c.get("user");
    if (!user.restaurantId) return c.json(NO_RESTAURANT_ERROR, 400);

    const { id } = c.get("validatedParams") as AlertIdParamInput;
    const service = createAlertService(c.env);
    const alert = await service.resolve(id, String(user.restaurantId), user.id);

    // A miss is either "not this tenant's alert" or "already closed". Both
    // answer 404 on purpose: telling the caller which one leaks whether an id
    // exists in another restaurant.
    if (!alert) return c.json(ALERT_NOT_FOUND_ERROR, 404);

    return c.json({ success: true, data: alert });
  },
);

routes.post(
  "/:id/escalate",
  authMiddleware,
  requireRole(ALERT_ROLES),
  validateParams(alertIdParamSchema),
  async (c) => {
    const user = c.get("user");
    if (!user.restaurantId) return c.json(NO_RESTAURANT_ERROR, 400);

    const { id } = c.get("validatedParams") as AlertIdParamInput;
    const service = createAlertService(c.env);
    const alert = await service.escalate(
      id,
      String(user.restaurantId),
      user.id,
    );

    if (!alert) return c.json(ALERT_NOT_FOUND_ERROR, 404);

    return c.json({ success: true, data: alert });
  },
);

export default routes;
