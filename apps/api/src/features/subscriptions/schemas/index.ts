import { z } from "zod";
import { PLAN_TIERS, MODULES } from "@makanmasak/database";

const planTierEnum = z.lazy(() =>
  z.enum([
    PLAN_TIERS.TRIAL,
    PLAN_TIERS.BASIC,
    PLAN_TIERS.PRO,
    PLAN_TIERS.ENTERPRISE,
  ]),
);

const moduleKeyEnum = z.lazy(() =>
  z.enum(Object.values(MODULES) as [string, ...string[]]),
);

export const createSubscriptionSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().min(1),
    planTier: planTierEnum,
    trialEndsAt: z.iso.datetime().optional(),
    billingCycleStartAt: z.iso.datetime().optional(),
    billingCycleEndAt: z.iso.datetime().optional(),
    notes: z.string().max(500).optional(),
  }),
);

export const updateModulesSchema = z.lazy(() =>
  z.object({
    overrides: z.partialRecord(moduleKeyEnum, z.boolean().nullable()),
  }),
);

export const changePlanSchema = z.lazy(() =>
  z.object({
    planTier: planTierEnum,
  }),
);

export const setActiveSchema = z.lazy(() =>
  z.object({
    isActive: z.boolean(),
  }),
);
