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
  | "connected_platforms";

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

/**
 * Owners are scoped by their token. Platform admins must name the shop they are
 * acting on, as `?restaurantId=`.
 */
const scoped = (path: string, restaurantId?: string | null) =>
  restaurantId
    ? `${path}?restaurantId=${encodeURIComponent(restaurantId)}`
    : path;

export const planService = {
  async getPlan(restaurantId?: string | null): Promise<PlanOverview> {
    const response = await api.get<PlanOverview>(
      scoped("/billing/plan", restaurantId),
    );
    return unwrapApiPayload<PlanOverview>(response.data);
  },

  async getImpact(
    planTier: PlanTier,
    restaurantId?: string | null,
  ): Promise<PlanImpact> {
    const response = await api.get<PlanImpact>("/billing/plan/impact", {
      planTier,
      ...(restaurantId ? { restaurantId } : {}),
    });
    return unwrapApiPayload<PlanImpact>(response.data);
  },

  async changePlan(
    planTier: PlanTier,
    restaurantId?: string | null,
  ): Promise<PlanOverview> {
    const response = await api.post<PlanOverview>(
      scoped("/billing/plan/change", restaurantId),
      { planTier },
    );
    return unwrapApiPayload<PlanOverview>(response.data);
  },

  async cancelPending(restaurantId?: string | null): Promise<PlanOverview> {
    const response = await api.delete<PlanOverview>(
      scoped("/billing/plan/pending", restaurantId),
    );
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
