import { Hono } from "hono";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import { moduleGate } from "../../../middleware/moduleGate";
import type { AuthUser } from "../../../middleware/auth";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../../shared/middleware";
import { forbidden, notFound } from "../../../shared/utils/api-error";
import { KVCacheService } from "../../../core/cache";
import { invalidateRestaurantMenuEdgeCache } from "../../../middleware/edge-cache";
import { PnlService } from "../services/PnlService";
import {
  createExpenseSchema,
  dailyQuerySchema,
  expenseParamSchema,
  rangeQuerySchema,
  ratesSchema,
  restaurantParamSchema,
  type CreateExpenseInput,
  type DailyQueryInput,
  type ExpenseParamInput,
  type RangeQueryInput,
  type RatesInput,
  type RestaurantParamInput,
} from "../schemas/validation";
import type { Env } from "../../../types/env";

/** Daily P&L, mounted at `/api/v1/pnl`. Admin (0) and owner (1) only. */
const app = new Hono<{ Bindings: Env }>();

const PNL_ROLES = [0, 1];

// Same module as /analytics/financial-report. Auth first: the gate reads the user.
app.use("*", authMiddleware, moduleGate("analytics"));

/** Written in the handler (not mounted) so tests that mock auth still run it; same rule as reviews. */
function assertRestaurantScope(
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

/** GET /api/v1/pnl/:restaurantId/daily?date=YYYY-MM-DD */
app.get(
  "/:restaurantId/daily",
  requireRole(PNL_ROLES),
  validateParams(restaurantParamSchema),
  validateQuery(dailyQuerySchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams") as RestaurantParamInput;
    assertRestaurantScope(c.env, c.get("user"), restaurantId);
    const { date } = c.get("validatedQuery") as DailyQueryInput;

    const data = await new PnlService(c.env.DB).getDaily(restaurantId, date);
    return c.json({ success: true, data });
  },
);

/** GET /api/v1/pnl/:restaurantId/range?from=YYYY-MM-DD&to=YYYY-MM-DD (at most 92 days) */
app.get(
  "/:restaurantId/range",
  requireRole(PNL_ROLES),
  validateParams(restaurantParamSchema),
  validateQuery(rangeQuerySchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams") as RestaurantParamInput;
    assertRestaurantScope(c.env, c.get("user"), restaurantId);
    const { from, to } = c.get("validatedQuery") as RangeQueryInput;

    const data = await new PnlService(c.env.DB).getRange(
      restaurantId,
      from,
      to,
    );
    return c.json({ success: true, data });
  },
);

/** GET /api/v1/pnl/:restaurantId/rates */
app.get(
  "/:restaurantId/rates",
  requireRole(PNL_ROLES),
  validateParams(restaurantParamSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams") as RestaurantParamInput;
    assertRestaurantScope(c.env, c.get("user"), restaurantId);

    const data = await new PnlService(c.env.DB).getRates(restaurantId);
    return c.json({ success: true, data });
  },
);

/** PUT /api/v1/pnl/:restaurantId/rates */
app.put(
  "/:restaurantId/rates",
  requireRole(PNL_ROLES),
  validateParams(restaurantParamSchema),
  validateBody(ratesSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams") as RestaurantParamInput;
    assertRestaurantScope(c.env, c.get("user"), restaurantId);
    const body = c.get("validatedBody") as RatesInput;

    const data = await new PnlService(c.env.DB).setRates(restaurantId, body);
    // GET /restaurants/:id serves settings from two caches: RestaurantsService's
    // KV row and the edge response cache. Drop both, as restaurant writes do.
    if (c.env.CACHE_KV) {
      await new KVCacheService(c.env.CACHE_KV).delete(
        `restaurant:${restaurantId}`,
      );
      await invalidateRestaurantMenuEdgeCache(c.env, restaurantId);
    }
    return c.json({ success: true, data });
  },
);

/** POST /api/v1/pnl/:restaurantId/expenses */
app.post(
  "/:restaurantId/expenses",
  requireRole(PNL_ROLES),
  validateParams(restaurantParamSchema),
  validateBody(createExpenseSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams") as RestaurantParamInput;
    const user = c.get("user");
    assertRestaurantScope(c.env, user, restaurantId);
    const body = c.get("validatedBody") as CreateExpenseInput;

    const data = await new PnlService(c.env.DB).createExpense(
      restaurantId,
      String(user.id),
      body,
    );
    return c.json({ success: true, data }, 201);
  },
);

/** DELETE /api/v1/pnl/:restaurantId/expenses/:expenseId (soft delete) */
app.delete(
  "/:restaurantId/expenses/:expenseId",
  requireRole(PNL_ROLES),
  validateParams(expenseParamSchema),
  async (c) => {
    const { restaurantId, expenseId } = c.get(
      "validatedParams",
    ) as ExpenseParamInput;
    assertRestaurantScope(c.env, c.get("user"), restaurantId);

    const deleted = await new PnlService(c.env.DB).deleteExpense(
      restaurantId,
      expenseId,
    );
    // Missing, already deleted and another shop's all read the same.
    if (!deleted) throw notFound("Expense not found", "EXPENSE_NOT_FOUND");
    return c.json({ success: true, data: { id: expenseId } });
  },
);

export default app;
