import type { PlanTier } from "../schema/subscriptions";
import type { MeterKey } from "../schema/usage-events";

export interface MeterQuota {
  soft: number;
  hard: number;
}

export const PLAN_QUOTAS: Record<
  PlanTier,
  Partial<Record<MeterKey, MeterQuota>>
> = {
  trial: {
    "orders.created": { soft: 2_400, hard: 3_000 },
    "api.requests": { soft: 8_000, hard: 10_000 },
    "print.jobs": { soft: 2_400, hard: 3_000 },
    "ai.requests": { soft: 8, hard: 10 },
    "storage.bytes": { soft: 800_000_000, hard: 1_000_000_000 },
  },
  basic: {
    "orders.created": { soft: 4_000, hard: 5_000 },
    "api.requests": { soft: 80_000, hard: 100_000 },
    "print.jobs": { soft: 800, hard: 1000 },
    "storage.bytes": { soft: 4_000_000_000, hard: 5_000_000_000 },
  },
  pro: {
    "orders.created": { soft: 8_000, hard: 10_000 },
    "api.requests": { soft: 800_000, hard: 1_000_000 },
    "print.jobs": { soft: 8_000, hard: 10_000 },
    "ai.requests": { soft: 80, hard: 100 },
    "storage.bytes": { soft: 40_000_000_000, hard: 50_000_000_000 },
  },
  enterprise: {},
};
