import { TRIAL_DURATION_DAYS } from "@makanmasak/database";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageCycle {
  startAt: number;
  endAt: number;
  kind: "billing" | "trial" | "calendar_month";
}

export interface CycleSubscription {
  planTier: string;
  trialEndsAtMs: number | null;
  billingCycleStartAtMs: number | null;
  billingCycleEndAtMs: number | null;
  createdAtMs: number;
}

export function calendarMonthCycle(at: number): UsageCycle {
  const date = new Date(at);
  return {
    startAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    endAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    kind: "calendar_month",
  };
}

export function trialEndsAtMs(sub: CycleSubscription): number {
  return sub.trialEndsAtMs ?? sub.createdAtMs + TRIAL_DURATION_DAYS * DAY_MS;
}

/**
 * The cycle usage at `at` is counted in. The single resolver for quotaGate,
 * UsageService, the hourly aggregator and the plan page, so all four agree on
 * which `usage_meters` row is "this cycle":
 *
 * - non-trial with both billing dates -> those dates (`at` is not consulted:
 *   the aggregator folds a late bucket into the cycle the shop is in now);
 * - trial still inside its window -> [created_at, trialEndsAt);
 * - otherwise the UTC calendar month containing `at`. An expired trial keeps
 *   its tier (nag-only), so it lands here too.
 */
export function resolveUsageCycle(
  sub: CycleSubscription,
  at: number,
): UsageCycle {
  if (
    sub.planTier !== "trial" &&
    sub.billingCycleStartAtMs !== null &&
    sub.billingCycleEndAtMs !== null
  ) {
    return {
      startAt: sub.billingCycleStartAtMs,
      endAt: sub.billingCycleEndAtMs,
      kind: "billing",
    };
  }

  if (sub.planTier === "trial") {
    const endAt = trialEndsAtMs(sub);
    if (at < endAt) return { startAt: sub.createdAtMs, endAt, kind: "trial" };
  }

  return calendarMonthCycle(at);
}
