import { Hono, type Context } from "hono";
import { z } from "zod";
import { PLAN_TIERS } from "@makanmasak/database";
import type { Env } from "../../../types/env";
import {
  ApiError,
  badRequest,
  forbidden,
} from "../../../shared/utils/api-error";
import {
  authMiddleware,
  requireRole,
  validateBody,
  validateQuery,
} from "../../../shared/middleware";
import { BillingWebhookService } from "../services/BillingWebhookService";
import { PlanChangeService } from "../services/PlanChangeService";

const router = new Hono<{ Bindings: Env }>();

router.post("/webhooks/:provider", async (c) => {
  const provider = c.req.param("provider").toLowerCase();
  const rawBody = await c.req.text();

  let result;
  try {
    result = await new BillingWebhookService(c.env).handle(
      provider,
      rawBody,
      c.req.raw.headers,
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ApiError("WEBHOOK_INVALID_JSON", "Invalid webhook JSON", 400);
    }
    throw new ApiError(
      "WEBHOOK_SIGNATURE_INVALID",
      error instanceof Error ? error.message : "Invalid webhook signature",
      401,
    );
  }

  return c.json({
    success: true,
    data: result,
  });
});

// ─── Owner self-service plan (/billing/plan/*) ───────────────────────────────
// Its own sub-router so auth applies to these routes only: the webhook above
// is public and HMAC-verified. The CSRF exemption for /billing/webhooks is a
// path prefix and does not reach /billing/plan, so writes here need the usual
// Origin + CSRF token.
const plan = new Hono<{ Bindings: Env }>();
plan.use("*", authMiddleware, requireRole([0, 1]));

const planTierSchema = z.enum([
  PLAN_TIERS.TRIAL,
  PLAN_TIERS.BASIC,
  PLAN_TIERS.PRO,
  PLAN_TIERS.ENTERPRISE,
]);

/** Owner: their own shop only. Admin: must name the shop with ?restaurantId=. */
function planRestaurantId<E extends { Bindings: Env }>(c: Context<E>): string {
  const user = c.get("user");
  const requested = c.req.query("restaurantId")?.trim() || undefined;
  if (user.role === 0) {
    if (!requested) {
      throw badRequest("restaurantId is required", "VALIDATION_ERROR", [
        { field: "restaurantId", message: "required for admins" },
      ]);
    }
    return requested;
  }
  const own = user.restaurantId == null ? null : String(user.restaurantId);
  if (!own || (requested && requested !== own)) {
    throw forbidden("Access denied to this restaurant", "FORBIDDEN");
  }
  return own;
}

plan.get("/", async (c) => {
  const data = await new PlanChangeService(c.env).getPlan(planRestaurantId(c));
  return c.json({ success: true, data });
});

plan.get(
  "/impact",
  validateQuery(
    z.object({ planTier: planTierSchema, restaurantId: z.string().optional() }),
  ),
  async (c) => {
    const { planTier } = c.get("validatedQuery") as { planTier: PlanTier };
    const data = await new PlanChangeService(c.env).getImpact(
      planRestaurantId(c),
      planTier,
    );
    return c.json({ success: true, data });
  },
);

plan.post(
  "/change",
  validateBody(z.object({ planTier: planTierSchema })),
  async (c) => {
    const { planTier } = c.get("validatedBody") as { planTier: PlanTier };
    const data = await new PlanChangeService(c.env).requestChange(
      planRestaurantId(c),
      planTier,
      c.get("user").id,
    );
    return c.json({ success: true, data });
  },
);

plan.delete("/pending", async (c) => {
  const data = await new PlanChangeService(c.env).cancelPending(
    planRestaurantId(c),
    c.get("user").id,
  );
  return c.json({ success: true, data });
});

type PlanTier = z.infer<typeof planTierSchema>;

router.route("/plan", plan);

export default router;
