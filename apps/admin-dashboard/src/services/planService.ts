import { api, unwrapApiPayload } from "@/services/api";

/**
 * Owner self-service plan changes, mounted at `/api/v1/billing/plan`, plus the
 * usage meters the quota banner reads. No prices exist anywhere in this
 * contract, and none are shown.
 */

export type PlanTier = "trial" | "basic" | "pro" | "enterprise";

export type PlanAction = "current" | "upgrade" | "downgrade" | "unavailable";

/** `null` quota means unlimited. */
export type PlanQuotas = Record<string, { soft: number; hard: number } | null>;

export interface PlanOption {
  tier: PlanTier;
  action: PlanAction;
  unavailableReason?: "region" | "trial_not_reenterable";
  effective: "immediately" | "cycle_end" | null;
  effectiveAt: number | null;
  modules: string[];
  gainedModules: string[];
  lostModules: string[];
  quotas: PlanQuotas;
}

export interface PendingPlanChange {
  toTier: PlanTier;
  effectiveAt: number;
  requestedAt: number;
  deferredReason: null | "open_cash_shift";
}

export interface PlanOverview {
  restaurantId: string;
  currentTier: PlanTier;
  isActive: boolean;
  trialEndsAt: number | null;
  trialExpired: boolean;
  cycle: {
    startAt: number;
    endAt: number;
    kind: "billing" | "trial" | "calendar_month";
  };
  pendingChange: PendingPlanChange | null;
  options: PlanOption[];
}

export type PlanImpactKey =
  | "open_cash_shift"
  | "future_reservations"
  | "future_service_bookings"
  | "active_coupons"
  | "scheduled_shifts"
  | "pending_leave_requests"
  | "tracked_ingredients"
  | "connected_platforms"
  | "usage_over_new_limit";

export interface PlanImpact {
  toTier: PlanTier;
  lostModules: string[];
  items: Array<{ key: PlanImpactKey; count: number; blocking: boolean }>;
}

/** Error codes the plan endpoints can answer with. */
export const PLAN_ERROR_CODES = [
  "PLAN_UNCHANGED",
  "PLAN_TRIAL_NOT_REENTERABLE",
  "PLAN_NOT_AVAILABLE_IN_REGION",
  "SUBSCRIPTION_INACTIVE",
  "PLAN_CHANGE_BLOCKED_OPEN_SHIFT",
  "PLAN_CHANGE_CONFLICT",
  "PLAN_NO_PENDING_CHANGE",
] as const;

export type PlanErrorCode = (typeof PLAN_ERROR_CODES)[number];

export const planService = {
  async getPlan(): Promise<PlanOverview> {
    const response = await api.get<PlanOverview>("/billing/plan");
    return unwrapApiPayload<PlanOverview>(response.data);
  },

  async getImpact(planTier: PlanTier): Promise<PlanImpact> {
    const response = await api.get<PlanImpact>("/billing/plan/impact", {
      planTier,
    });
    return unwrapApiPayload<PlanImpact>(response.data);
  },

  async changePlan(planTier: PlanTier): Promise<PlanOverview> {
    const response = await api.post<PlanOverview>("/billing/plan/change", {
      planTier,
    });
    return unwrapApiPayload<PlanOverview>(response.data);
  },

  async cancelPending(): Promise<PlanOverview> {
    const response = await api.delete<PlanOverview>("/billing/plan/pending");
    return unwrapApiPayload<PlanOverview>(response.data);
  },
};

// ---- usage / quota state -------------------------------------------------

export type MeterState = "ok" | "warning" | "over";

export interface QuotaMeter {
  meterKey: string;
  total: number;
  softLimit: number | null;
  hardLimit: number | null;
  state: MeterState;
  enforced: boolean;
}

/** Only these meters are enforced by the API's quota gate. */
export const ENFORCED_METER_KEYS = [
  "orders.created",
  "print.jobs",
  "ai.requests",
] as const;

interface RawMeter {
  meterKey: string;
  total: number;
  softLimit?: number | null;
  hardLimit?: number | null;
  state?: MeterState;
  enforced?: boolean;
}

/**
 * The one place that decides where meter state comes from. The API may send
 * `state` / `enforced` per meter; when it does not, derive them from the
 * limits so the banner still works against an older response.
 */
export function toQuotaMeter(raw: RawMeter): QuotaMeter {
  const softLimit = raw.softLimit ?? null;
  const hardLimit = raw.hardLimit ?? null;
  const derived: MeterState =
    hardLimit && raw.total >= hardLimit
      ? "over"
      : softLimit && raw.total >= softLimit
        ? "warning"
        : "ok";
  return {
    meterKey: raw.meterKey,
    total: raw.total,
    softLimit,
    hardLimit,
    state: raw.state ?? derived,
    enforced:
      raw.enforced ??
      (ENFORCED_METER_KEYS as readonly string[]).includes(raw.meterKey),
  };
}

export async function getQuotaMeters(): Promise<QuotaMeter[]> {
  const response = await api.get<{ meters?: RawMeter[] }>("/me/usage");
  const data = unwrapApiPayload<{ meters?: RawMeter[] } | null>(response.data);
  return (data?.meters ?? []).map(toQuotaMeter);
}
