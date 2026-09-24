import { PLAN_TIERS, type PlanTier } from "../schema/subscriptions";

export const PLAN_ID_TO_TIER: Record<string, PlanTier> = {
  standard: PLAN_TIERS.BASIC,
  professional: PLAN_TIERS.PRO,
  enterprise: PLAN_TIERS.ENTERPRISE,
};

/**
 * Trial length for every provisioning path.
 *
 * Onboarding (management-api) and direct restaurant creation (api) used to
 * disagree — 14 days here versus a `trialDays ?? 30` default in
 * SubscriptionService — so the same product handed out two different trials
 * depending on which door the shop came through. Both now read this constant.
 *
 * Six months, counted as 180 days: the trial end is a fixed offset in ms, not
 * a calendar date, so "six months" here is never 181–184 days.
 */
export const TRIAL_DURATION_DAYS = 180;
export const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
export const DEFAULT_BILLING_CYCLE_MS = 30 * 24 * 60 * 60 * 1000;

export function planIdToTier(planId: string | null | undefined): PlanTier {
  return planId
    ? (PLAN_ID_TO_TIER[planId] ?? PLAN_TIERS.TRIAL)
    : PLAN_TIERS.TRIAL;
}
