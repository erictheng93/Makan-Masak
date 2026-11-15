import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  AUDIT_ACTIONS,
  DEFAULT_BILLING_CYCLE_MS,
  METER_KEYS,
  MODULES,
  PAYMENT_AUDIT_EVENT_TYPES,
  PLAN_DEFAULT_MODULES,
  PLAN_QUOTAS,
  auditLogs,
  cashRegisters,
  cashShifts,
  coupons,
  drizzle,
  employeeSchedules,
  ingredientDefinitions,
  leaveRequests,
  platformIntegrations,
  reservations,
  serviceBookings,
  shopSubscriptions,
  type EffectiveRegionPolicies,
  type MeterKey,
  type ModuleKey,
  type ModuleMap,
  type PaidPlanTier,
  type PlanTier,
} from "@makanmasak/database";
import type { Env } from "../../../types/env";
import { invalidateSubscriptionCacheForEnv } from "../../../middleware/moduleGate";
import { conflict, notFound } from "../../../shared/utils/api-error";
import { assertPlanTierAllowed } from "../../../shared/policy/regionPolicyGuards";
import {
  requirePolicy,
  resolveRegionPolicies,
  restaurantCountryCode,
} from "../../../shared/policy/regionPolicies";
import {
  resolveUsageCycle,
  trialEndsAtMs,
  type UsageCycle,
} from "../../../shared/utils/usage-cycle";
import { BillingCycleService } from "./BillingCycleService";
import {
  BILLING_NOTIFICATION_KINDS,
  BillingNotificationService,
  NOTIFICATION_CHANNELS,
  planChangeCopy,
  restaurantContact,
} from "./BillingNotificationService";
import { PaymentAuditService } from "./PaymentAuditService";

type Subscription = typeof shopSubscriptions.$inferSelect;
type DeferredReason = "open_cash_shift";

export const IMPACT_KEYS = [
  "open_cash_shift",
  "future_reservations",
  "future_service_bookings",
  "active_coupons",
  "scheduled_shifts",
  "pending_leave_requests",
  "tracked_ingredients",
  "connected_platforms",
  "usage_over_new_limit",
] as const;
export type ImpactKey = (typeof IMPACT_KEYS)[number];

const TIERS: PlanTier[] = ["trial", "basic", "pro", "enterprise"];
const RANK: Record<PlanTier, number> = {
  trial: 0,
  basic: 1,
  pro: 2,
  enterprise: 3,
};
const MODULE_KEYS = Object.values(MODULES) as ModuleKey[];
const METER_KEY_LIST = Object.values(METER_KEYS) as MeterKey[];
/** Due changes applied per cron run; the rest wait for the next day's run. */
export const PLAN_CHANGE_APPLY_LIMIT = 100;

/** Leaving trial is the conversion; among paid tiers only a higher rank is immediate. */
function isImmediate(from: PlanTier, to: PlanTier): boolean {
  return from === "trial" || RANK[to] > RANK[from];
}

/** Plan defaults + the shop's (preserved) overrides, minus region-disabled. */
function tierModules(
  tier: PlanTier,
  overrides: ModuleMap,
  regionOff: ReadonlySet<ModuleKey>,
): ModuleKey[] {
  return MODULE_KEYS.filter(
    (m) =>
      (overrides[m] ?? PLAN_DEFAULT_MODULES[tier][m] ?? false) &&
      !regionOff.has(m),
  );
}

function cycleOf(sub: Subscription, now: number): UsageCycle {
  return resolveUsageCycle(
    {
      planTier: sub.planTier,
      trialEndsAtMs: sub.trialEndsAt?.getTime() ?? null,
      billingCycleStartAtMs: sub.billingCycleStartAt?.getTime() ?? null,
      billingCycleEndAtMs: sub.billingCycleEndAt?.getTime() ?? null,
      createdAtMs: sub.createdAt.getTime(),
    },
    now,
  );
}

/** A 30-day cycle from `startAt`, rolled forward whole cycles until it contains `now`. */
function freshCycle(startAt: number, now: number) {
  const skipped = Math.max(
    0,
    Math.floor((now - startAt) / DEFAULT_BILLING_CYCLE_MS),
  );
  const start = startAt + skipped * DEFAULT_BILLING_CYCLE_MS;
  return {
    billingCycleStartAt: new Date(start),
    billingCycleEndAt: new Date(start + DEFAULT_BILLING_CYCLE_MS),
  };
}

const NO_PENDING = {
  pendingPlanTier: null,
  pendingEffectiveAt: null,
  pendingRequestedBy: null,
  pendingRequestedAt: null,
};

type PlanEvent = "applied" | "scheduled" | "cancelled";

/**
 * Owner self-service plan changes (no payment): upgrades and leaving trial
 * apply at once and restart the billing cycle; downgrades are stored on the
 * subscription and applied at the end of the cycle by the daily billing cron
 * or, lazily, by the owner's next read of the plan page.
 *
 * Module overrides granted by platform admins are never touched here.
 */
export class PlanChangeService {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(private readonly env: Env) {
    this.db = drizzle(env.DB);
  }

  async getPlan(restaurantId: string, now = Date.now()) {
    const region = await this.region(restaurantId);
    const { sub, deferred } = await this.applyDue(
      await this.load(restaurantId),
      region,
      now,
    );
    return this.view(sub, region, now, deferred);
  }

  async requestChange(
    restaurantId: string,
    toTier: PlanTier,
    actorUserId: string,
    now = Date.now(),
  ) {
    const region = await this.region(restaurantId);
    const { sub } = await this.applyDue(
      await this.load(restaurantId),
      region,
      now,
    );

    if (toTier === "trial") {
      throw conflict(
        "A shop cannot return to the trial plan",
        "PLAN_TRIAL_NOT_REENTERABLE",
      );
    }
    if (!sub.isActive) {
      throw conflict(
        "This subscription is not active",
        "SUBSCRIPTION_INACTIVE",
      );
    }
    // Cancelling a scheduled downgrade is DELETE /billing/plan/pending only.
    if (toTier === sub.planTier) {
      throw conflict("The shop is already on this plan", "PLAN_UNCHANGED");
    }
    await assertPlanTierAllowed(this.env, { restaurantId, planTier: toTier });

    if (isImmediate(sub.planTier, toTier)) {
      if (
        this.losesPos(sub, toTier, region) &&
        (await this.hasOpenCashShift(restaurantId))
      ) {
        throw conflict(
          "Close the open cash shift before leaving a plan with POS",
          "PLAN_CHANGE_BLOCKED_OPEN_SHIFT",
        );
      }
      const updated = await this.switchTier(sub, toTier, now, now, false);
      if (!updated) throw this.lostRace();
      await this.record("applied", sub, {
        toTier,
        effectiveAt: now,
        immediate: true,
        actorUserId,
        now,
      });
      return this.view(updated, region, now, null);
    }

    const effectiveAt = cycleOf(sub, now).endAt;
    const [updated] = await this.db
      .update(shopSubscriptions)
      .set({
        pendingPlanTier: toTier,
        pendingEffectiveAt: new Date(effectiveAt),
        pendingRequestedBy: actorUserId,
        pendingRequestedAt: new Date(now),
        updatedAt: new Date(now),
      })
      .where(
        and(
          eq(shopSubscriptions.restaurantId, restaurantId),
          eq(shopSubscriptions.planTier, sub.planTier),
        ),
      )
      .returning();
    if (!updated) throw this.lostRace();
    await this.record("scheduled", sub, {
      toTier,
      effectiveAt,
      immediate: false,
      actorUserId,
      now,
    });
    return this.view(updated, region, now, null);
  }

  async cancelPending(
    restaurantId: string,
    actorUserId: string,
    now = Date.now(),
  ) {
    const region = await this.region(restaurantId);
    const { sub } = await this.applyDue(
      await this.load(restaurantId),
      region,
      now,
    );
    if (!sub.pendingPlanTier || !sub.pendingRequestedAt) {
      throw notFound("No plan change is scheduled", "PLAN_NO_PENDING_CHANGE");
    }

    const [updated] = await this.db
      .update(shopSubscriptions)
      .set({ ...NO_PENDING, updatedAt: new Date(now) })
      .where(
        and(
          eq(shopSubscriptions.restaurantId, restaurantId),
          eq(shopSubscriptions.pendingRequestedAt, sub.pendingRequestedAt),
        ),
      )
      .returning();
    if (!updated) throw this.lostRace();
    await this.record("cancelled", sub, {
      toTier: sub.pendingPlanTier,
      effectiveAt: sub.pendingEffectiveAt?.getTime() ?? now,
      immediate: false,
      actorUserId,
      now,
    });
    return this.view(updated, region, now, null);
  }

  /** What a move to `toTier` would switch off, for the confirmation dialog. */
  async getImpact(restaurantId: string, toTier: PlanTier, now = Date.now()) {
    const region = await this.region(restaurantId);
    const sub = await this.load(restaurantId);
    const overrides = sub.moduleOverrides ?? {};
    const target = tierModules(toTier, overrides, region.modulesDisabled);
    const lostModules = tierModules(
      sub.planTier,
      overrides,
      region.modulesDisabled,
    ).filter((m) => !target.includes(m));
    const immediate = isImmediate(sub.planTier, toTier);

    // shortcut: "today" is the UTC date, so a shop east of UTC may count
    // yesterday-local bookings as future for a few hours; it only informs.
    const today = new Date(now).toISOString().slice(0, 10);
    const counters: Array<[ImpactKey, ModuleKey, () => Promise<number>]> = [
      ["open_cash_shift", "pos", () => this.countOpenCashShifts(restaurantId)],
      [
        "future_reservations",
        "reservations",
        () =>
          this.count(
            reservations,
            and(
              eq(reservations.restaurantId, restaurantId),
              inArray(reservations.status, ["pending", "confirmed"]),
              gte(reservations.reservationDate, today),
            ),
          ),
      ],
      [
        "future_service_bookings",
        "reservations",
        () =>
          this.count(
            serviceBookings,
            and(
              eq(serviceBookings.restaurantId, restaurantId),
              inArray(serviceBookings.status, ["pending", "confirmed"]),
              gte(serviceBookings.bookingDate, today),
            ),
          ),
      ],
      [
        "active_coupons",
        "coupons",
        () =>
          this.count(
            coupons,
            and(
              eq(coupons.restaurantId, restaurantId),
              eq(coupons.isActive, true),
              isNull(coupons.deletedAt),
              gt(coupons.validTo, new Date(now)),
            ),
          ),
      ],
      [
        "scheduled_shifts",
        "staff_management",
        () =>
          this.count(
            employeeSchedules,
            and(
              eq(employeeSchedules.restaurantId, restaurantId),
              gte(employeeSchedules.workDate, today),
              inArray(employeeSchedules.status, ["scheduled", "confirmed"]),
              isNull(employeeSchedules.deletedAt),
            ),
          ),
      ],
      [
        "pending_leave_requests",
        "staff_management",
        () =>
          this.count(
            leaveRequests,
            and(
              eq(leaveRequests.restaurantId, restaurantId),
              eq(leaveRequests.status, "pending"),
              isNull(leaveRequests.deletedAt),
            ),
          ),
      ],
      [
        "tracked_ingredients",
        "inventory",
        () =>
          this.count(
            ingredientDefinitions,
            and(
              eq(ingredientDefinitions.restaurantId, restaurantId),
              eq(ingredientDefinitions.isActive, true),
              isNull(ingredientDefinitions.deletedAt),
            ),
          ),
      ],
      [
        "connected_platforms",
        "platform_integration",
        () =>
          this.count(
            platformIntegrations,
            and(
              eq(platformIntegrations.restaurantId, restaurantId),
              eq(platformIntegrations.enabled, true),
            ),
          ),
      ],
    ];
    // `usage_over_new_limit` is never produced: an immediate change starts a
    // fresh billing cycle and a scheduled one takes effect at a cycle start,
    // so the target tier's counter always begins at zero.
    const relevant = counters.filter(([, module]) =>
      lostModules.includes(module),
    );
    const counts = await Promise.all(relevant.map(([, , run]) => run()));

    return {
      toTier,
      lostModules,
      items: relevant
        .map(([key], i) => ({
          key,
          count: counts[i],
          blocking: key === "open_cash_shift" && immediate,
        }))
        .filter((item) => item.count > 0),
    };
  }

  /** Apply one shop's due scheduled change (the cron entry point). */
  async applyDueForRestaurant(restaurantId: string, now = Date.now()) {
    const region = await this.region(restaurantId);
    const before = await this.load(restaurantId);
    const { sub, deferred } = await this.applyDue(before, region, now);
    if (deferred) return "deferred" as const;
    return sub.planTier !== before.planTier
      ? ("applied" as const)
      : ("skipped" as const);
  }

  /**
   * Apply `sub`'s scheduled change if it is due. Idempotent: the UPDATE is
   * guarded on the tier and the request time read here, so a second cron run,
   * an overlapping lazy apply or a concurrent owner change matches no row.
   */
  private async applyDue(
    sub: Subscription,
    region: EffectiveRegionPolicies,
    now: number,
  ): Promise<{ sub: Subscription; deferred: DeferredReason | null }> {
    const toTier = sub.pendingPlanTier;
    const effectiveAt = sub.pendingEffectiveAt?.getTime();
    if (!toTier || effectiveAt === undefined || effectiveAt > now) {
      return { sub, deferred: null };
    }
    if (
      this.losesPos(sub, toTier, region) &&
      (await this.hasOpenCashShift(sub.restaurantId))
    ) {
      return { sub, deferred: "open_cash_shift" };
    }

    // Snapshot the cycle that is ending on the tier it was used on, before
    // its dates are replaced (closeDueCycles would otherwise never see it).
    await new BillingCycleService(this.env).closeDueCycles(
      now,
      sub.restaurantId,
    );
    const updated = await this.switchTier(sub, toTier, effectiveAt, now, true);
    if (!updated) {
      return { sub: await this.load(sub.restaurantId), deferred: null };
    }
    await this.record("applied", sub, {
      toTier,
      effectiveAt,
      immediate: false,
      actorUserId: null,
      now,
    });
    return { sub: updated, deferred: null };
  }

  private async switchTier(
    sub: Subscription,
    toTier: PlanTier,
    cycleStartAt: number,
    now: number,
    guardPending: boolean,
  ): Promise<Subscription | undefined> {
    const [updated] = await this.db
      .update(shopSubscriptions)
      .set({
        planTier: toTier,
        ...NO_PENDING,
        // A fresh cycle restarts every usage counter (quotaGate, UsageService
        // and the aggregator all key usage_meters on billing_cycle_start).
        ...freshCycle(cycleStartAt, now),
        updatedAt: new Date(now),
      })
      .where(
        and(
          eq(shopSubscriptions.restaurantId, sub.restaurantId),
          eq(shopSubscriptions.planTier, sub.planTier),
          guardPending && sub.pendingRequestedAt
            ? eq(shopSubscriptions.pendingRequestedAt, sub.pendingRequestedAt)
            : undefined,
        ),
      )
      .returning();
    return updated;
  }

  private view(
    sub: Subscription,
    region: EffectiveRegionPolicies,
    now: number,
    deferredReason: DeferredReason | null,
  ) {
    const overrides = sub.moduleOverrides ?? {};
    const cycle = cycleOf(sub, now);
    const current = tierModules(
      sub.planTier,
      overrides,
      region.modulesDisabled,
    );
    const trialEnd = trialEndsAtMs({
      planTier: sub.planTier,
      trialEndsAtMs: sub.trialEndsAt?.getTime() ?? null,
      billingCycleStartAtMs: null,
      billingCycleEndAtMs: null,
      createdAtMs: sub.createdAt.getTime(),
    });

    return {
      restaurantId: sub.restaurantId,
      currentTier: sub.planTier,
      isActive: sub.isActive,
      trialEndsAt: sub.trialEndsAt?.getTime() ?? null,
      trialExpired: sub.planTier === "trial" && now >= trialEnd,
      cycle,
      pendingChange:
        sub.pendingPlanTier && sub.pendingEffectiveAt && sub.pendingRequestedAt
          ? {
              toTier: sub.pendingPlanTier,
              effectiveAt: sub.pendingEffectiveAt.getTime(),
              requestedAt: sub.pendingRequestedAt.getTime(),
              deferredReason,
            }
          : null,
      options: TIERS.map((tier) => {
        const modules = tierModules(tier, overrides, region.modulesDisabled);
        const base = {
          tier,
          modules,
          gainedModules: modules.filter((m) => !current.includes(m)),
          lostModules: current.filter((m) => !modules.includes(m)),
          quotas: Object.fromEntries(
            METER_KEY_LIST.map((key) => {
              const quota = PLAN_QUOTAS[tier][key];
              return [
                key,
                quota ? { soft: quota.soft, hard: quota.hard } : null,
              ];
            }),
          ),
        };
        const unavailable = (reason: "region" | "trial_not_reenterable") => ({
          ...base,
          action: "unavailable" as const,
          unavailableReason: reason,
          effective: null,
          effectiveAt: null,
        });

        if (tier === sub.planTier) {
          return {
            ...base,
            action: "current" as const,
            effective: null,
            effectiveAt: null,
          };
        }
        if (tier === "trial") return unavailable("trial_not_reenterable");
        if (
          region.allowedPaidTiers &&
          !region.allowedPaidTiers.has(tier as PaidPlanTier)
        ) {
          return unavailable("region");
        }
        return isImmediate(sub.planTier, tier)
          ? {
              ...base,
              action: "upgrade" as const,
              effective: "immediately" as const,
              effectiveAt: null,
            }
          : {
              ...base,
              action: "downgrade" as const,
              effective: "cycle_end" as const,
              effectiveAt: cycle.endAt,
            };
      }),
    };
  }

  /** Invalidate, then audit (both tables) and email the owner. */
  private async record(
    event: PlanEvent,
    before: Subscription,
    input: {
      toTier: PlanTier;
      effectiveAt: number;
      immediate: boolean;
      actorUserId: string | null;
      now: number;
    },
  ) {
    const restaurantId = before.restaurantId;
    await invalidateSubscriptionCacheForEnv(this.env, restaurantId);

    const details = {
      event,
      fromTier: before.planTier,
      toTier: input.toTier,
      mode: input.immediate ? "immediate" : "scheduled",
      effectiveAt: input.effectiveAt,
      actorUserId: input.actorUserId,
      requestedBy: before.pendingRequestedBy ?? null,
    };
    const kind = {
      applied: BILLING_NOTIFICATION_KINDS.PLAN_CHANGE_APPLIED,
      scheduled: BILLING_NOTIFICATION_KINDS.PLAN_CHANGE_SCHEDULED,
      cancelled: BILLING_NOTIFICATION_KINDS.PLAN_CHANGE_CANCELLED,
    }[event];
    const dedupKey = {
      applied: `${before.planTier}:${input.toTier}:${input.effectiveAt}`,
      scheduled: `${input.toTier}:${input.effectiveAt}:${input.now}`,
      cancelled: `${input.toTier}:${before.pendingRequestedAt?.getTime() ?? input.now}`,
    }[event];

    // The change is committed; a failed audit or email must not turn it into
    // a 500 the owner retries. Log and move on.
    const results = await Promise.allSettled([
      new PaymentAuditService(this.env.DB).append({
        restaurantId,
        subscriptionId: before.id,
        eventType: PAYMENT_AUDIT_EVENT_TYPES.PLAN_CHANGE,
        amount: null,
        rawPayload: details,
        occurredAtMs: input.now,
      }),
      this.db.insert(auditLogs).values({
        userId: input.actorUserId,
        restaurantId,
        action: AUDIT_ACTIONS.PLAN_CHANGE,
        resource: "shop_subscriptions",
        resourceId: before.id,
        description: `Plan change ${event}: ${before.planTier} -> ${input.toTier}`,
        changes: {
          before: { planTier: before.planTier },
          after: {
            planTier: event === "applied" ? input.toTier : before.planTier,
          },
          metadata: details,
        },
        success: true,
        createdAt: new Date(input.now),
      }),
      restaurantContact(this.env.DB, restaurantId).then((owner) =>
        new BillingNotificationService(this.env).send({
          restaurantId,
          kind,
          dedupKey,
          channel: NOTIFICATION_CHANNELS.EMAIL,
          recipient: owner?.email ?? null,
          ...planChangeCopy(event, owner?.name ?? "Your restaurant", {
            fromTier: before.planTier,
            toTier: input.toTier,
            effectiveAt: input.effectiveAt,
          }),
          payload: details,
        }),
      ),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("planChange.sideEffect.failed", {
          restaurantId,
          event,
          error: result.reason,
        });
      }
    }
  }

  private losesPos(
    sub: Subscription,
    toTier: PlanTier,
    region: EffectiveRegionPolicies,
  ): boolean {
    const overrides = sub.moduleOverrides ?? {};
    return (
      tierModules(sub.planTier, overrides, region.modulesDisabled).includes(
        "pos",
      ) &&
      !tierModules(toTier, overrides, region.modulesDisabled).includes("pos")
    );
  }

  private async hasOpenCashShift(restaurantId: string): Promise<boolean> {
    return (await this.countOpenCashShifts(restaurantId)) > 0;
  }

  private countOpenCashShifts(restaurantId: string) {
    return this.db
      .select({ n: sql<number>`count(*)` })
      .from(cashShifts)
      .innerJoin(cashRegisters, eq(cashShifts.registerId, cashRegisters.id))
      .where(
        and(
          eq(cashRegisters.restaurantId, restaurantId),
          eq(cashShifts.status, "active"),
        ),
      )
      .then(([row]) => Number(row?.n ?? 0));
  }

  private count(table: SQLiteTable, where: SQL | undefined) {
    return this.db
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .where(where)
      .then(([row]) => Number(row?.n ?? 0));
  }

  private async load(restaurantId: string): Promise<Subscription> {
    const [sub] = await this.db
      .select()
      .from(shopSubscriptions)
      .where(eq(shopSubscriptions.restaurantId, restaurantId))
      .limit(1);
    if (!sub)
      throw notFound("Subscription not found", "SUBSCRIPTION_NOT_FOUND");
    return sub;
  }

  private async region(restaurantId: string) {
    const effective = await resolveRegionPolicies(this.env, {
      countryCode: await restaurantCountryCode(this.env.DB, restaurantId),
    });
    requirePolicy(effective, "modules.disabled");
    requirePolicy(effective, "plans.allowed_tiers");
    return effective;
  }

  private lostRace() {
    return conflict(
      "The plan changed while this request was in flight; reload and retry",
      "PLAN_CHANGE_CONFLICT",
    );
  }
}

/**
 * Daily cron: apply scheduled changes whose time has come. Bounded per run,
 * oldest first; one shop failing is logged and never fails the run. A change
 * deferred by an open cash shift stays due and is retried next run.
 */
export async function applyDuePlanChanges(env: Env, now = Date.now()) {
  const due = await drizzle(env.DB)
    .select({ restaurantId: shopSubscriptions.restaurantId })
    .from(shopSubscriptions)
    .where(lte(shopSubscriptions.pendingEffectiveAt, new Date(now)))
    .orderBy(shopSubscriptions.pendingEffectiveAt)
    .limit(PLAN_CHANGE_APPLY_LIMIT);

  const service = new PlanChangeService(env);
  const tally = { due: due.length, applied: 0, deferred: 0, failed: 0 };
  for (const { restaurantId } of due) {
    try {
      const outcome = await service.applyDueForRestaurant(restaurantId, now);
      if (outcome === "applied") tally.applied++;
      if (outcome === "deferred") tally.deferred++;
    } catch (error) {
      tally.failed++;
      console.error("planChange.apply.failed", { restaurantId, error });
    }
  }
  return tally;
}
