/**
 * Admin Subscription Routes
 *
 * All routes require admin authentication (role 0).
 * Mount at: /api/v1/admin/subscriptions
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types/env";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import { invalidateSubscriptionCache } from "../../../middleware/moduleGate";
import { badRequest } from "../../../shared/utils/api-error";
import { UsageService } from "../../billing/services/UsageService";
import { SubscriptionService } from "../services/SubscriptionService";
import {
  createSubscriptionSchema,
  updateModulesSchema,
  changePlanSchema,
  setActiveSchema,
} from "../schemas";

const router = new Hono<{ Bindings: Env }>();

// `z.ZodError` is the class, and the hook never touches a single one of its
// methods -- only `issues`. Typing the parameter as the class was a claim the
// code did not need and could not keep: @hono/zod-validator below 0.7 declared
// a zod 3 peer while this workspace runs zod 4, so the mismatch stayed
// invisible until 0.9.1 started reporting the real zod 4 error type
// (`$ZodError`, which has no `format` / `flatten` / `addIssue` / `addIssues` /
// `isEmpty`). The structural core type is what this function actually consumes.
const formatZodDetails = (error: z.core.$ZodError) =>
  error.issues.map((err) => ({
    field: err.path.join("."),
    message: err.message,
    code: err.code,
  }));

function unifiedValidationHook(
  result: { success: boolean; error?: z.core.$ZodError },
  c: Context,
) {
  if (!result.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: result.error ? formatZodDetails(result.error) : [],
        },
      },
      400,
    );
  }
}

function requirePathParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw badRequest(`Missing ${name}`, "VALIDATION_ERROR", [
      { field: name, message: `${name} is required`, code: "required" },
    ]);
  }
  return value;
}

// All subscription management routes require admin access
router.use("*", authMiddleware, requireRole([0]));

router.get("/:restaurantId/usage", async (c) => {
  const { from, to } = parseDateRange(c.req.query("from"), c.req.query("to"));
  const service = new UsageService(c.env.DB);
  const restaurantId = c.req.param("restaurantId");

  return c.json({
    success: true,
    data: {
      restaurantId,
      current: await service.getCurrentUsage(restaurantId),
      cycles: await service.listCycleUsage(restaurantId, from, to),
    },
  });
});

router.get("/:restaurantId/usage/events", async (c) => {
  const { from, to } = parseDateRange(c.req.query("from"), c.req.query("to"));
  const limit = parsePositiveInt(c.req.query("limit"), 50, 200);
  const page = parsePositiveInt(c.req.query("page"), 1, 10_000);
  const service = new UsageService(c.env.DB);

  return c.json({
    success: true,
    data: await service.listUsageEvents(c.req.param("restaurantId"), {
      meterKey: c.req.query("meterKey") as never,
      from,
      to,
      page,
      limit,
    }),
  });
});

// ─── List all subscriptions ───────────────────────────────────────────────────
router.get("/", async (c) => {
  const service = new SubscriptionService(c.env.DB);
  const subscriptions = await service.listAll();

  const withModules = subscriptions.map((sub) => ({
    ...sub,
    effectiveModules: service.getEffectiveModules(sub),
  }));

  return c.json({ success: true, data: withModules });
});

function parseDateRange(from?: string, to?: string) {
  return {
    from: parseIsoDate(from, "from"),
    to: parseIsoDate(to, "to"),
  };
}

function parseIsoDate(value: string | undefined, field: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw badRequest(`Invalid ${field} date`, "INVALID_DATE");
  }
  return parsed;
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  max: number,
) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

// ─── Get single subscription ──────────────────────────────────────────────────
router.get("/:restaurantId", async (c) => {
  const service = new SubscriptionService(c.env.DB);
  const sub = await service.getByRestaurantId(c.req.param("restaurantId"));

  if (!sub) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Subscription not found" },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: { ...sub, effectiveModules: service.getEffectiveModules(sub) },
  });
});

// ─── Create subscription (client onboarding) ─────────────────────────────────
router.post(
  "/",
  zValidator("json", createSubscriptionSchema, unifiedValidationHook),
  async (c) => {
    const body = c.req.valid("json");
    const service = new SubscriptionService(c.env.DB);

    const sub = await service.create({
      ...body,
      trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : undefined,
      billingCycleStartAt: body.billingCycleStartAt
        ? new Date(body.billingCycleStartAt)
        : undefined,
      billingCycleEndAt: body.billingCycleEndAt
        ? new Date(body.billingCycleEndAt)
        : undefined,
    });

    return c.json({ success: true, data: sub }, 201);
  },
);

// ─── Update module overrides ──────────────────────────────────────────────────
router.patch(
  "/:restaurantId/modules",
  zValidator("json", updateModulesSchema, unifiedValidationHook),
  async (c) => {
    const restaurantId = requirePathParam(c, "restaurantId");
    const body = c.req.valid("json");
    const service = new SubscriptionService(c.env.DB);

    const updated = await service.updateModules(restaurantId, {
      overrides: body.overrides,
    });

    // Invalidate KV cache so the change takes effect within seconds
    await invalidateSubscriptionCache(c, restaurantId);

    return c.json({
      success: true,
      data: {
        ...updated,
        effectiveModules: service.getEffectiveModules(updated),
      },
    });
  },
);

// ─── Change plan tier ─────────────────────────────────────────────────────────
router.patch(
  "/:restaurantId/plan",
  zValidator("json", changePlanSchema, unifiedValidationHook),
  async (c) => {
    const restaurantId = requirePathParam(c, "restaurantId");
    const { planTier } = c.req.valid("json");
    const service = new SubscriptionService(c.env.DB);

    const updated = await service.changePlan(restaurantId, planTier);
    await invalidateSubscriptionCache(c, restaurantId);

    return c.json({
      success: true,
      data: {
        ...updated,
        effectiveModules: service.getEffectiveModules(updated),
      },
    });
  },
);

// ─── Kill switch ──────────────────────────────────────────────────────────────
router.patch(
  "/:restaurantId/status",
  zValidator("json", setActiveSchema, unifiedValidationHook),
  async (c) => {
    const restaurantId = requirePathParam(c, "restaurantId");
    const { isActive } = c.req.valid("json");
    const service = new SubscriptionService(c.env.DB);

    const updated = await service.setActive(restaurantId, isActive);
    await invalidateSubscriptionCache(c, restaurantId);

    return c.json({ success: true, data: updated });
  },
);

export default router;
