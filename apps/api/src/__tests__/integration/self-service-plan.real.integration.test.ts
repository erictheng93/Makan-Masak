import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import {
  DEFAULT_BILLING_CYCLE_MS,
  auditLogs,
  cashRegisters,
  cashShifts,
  cycleSnapshots,
  employeeSchedules,
  ingredientDefinitions,
  notificationDispatchLog,
  paymentAuditLog,
  platformIntegrations,
  regionPolicies,
  reservations,
  shopSubscriptions,
  usageMeterBuckets,
  usageMeters,
  type ModuleMap,
  type PlanTier,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import type { Env } from "../../types/env";
import { enforceQuota } from "../../middleware/quotaGate";
import { BillingCycleService } from "../../features/billing/services/BillingCycleService";
import {
  PlanChangeService,
  applyDuePlanChanges,
} from "../../features/billing/services/PlanChangeService";
import { usageBucketStartFor } from "../../shared/utils/usage-buckets";

/**
 * Owner self-service plan changes on real D1: the rules live in guarded
 * UPDATEs and in which usage_meters row the three cycle readers pick, so a
 * fake db would only prove the fake agrees with itself.
 */
const DAY = 24 * 60 * 60 * 1000;
const CSRF = "a".repeat(64);

let testApp: RealIntegrationTestApp;
let seed: ReturnType<typeof buildSeedHelpers>;

beforeAll(async () => {
  testApp = await createRealIntegrationTestApp({
    env: { QUOTA_ENFORCEMENT_MODE: "enforce" },
  });
  seed = buildSeedHelpers(testApp.testDb);
});

afterAll(async () => {
  await testApp?.dispose();
});

beforeEach(async () => {
  await testApp.testDb.truncateAll();
});

const db = () => testApp.testDb.drizzle;
const service = () => new PlanChangeService(testApp.env);

let userSeq = 0;
async function shop(
  opts: {
    tier?: PlanTier;
    cycle?: [number, number] | null;
    overrides?: ModuleMap;
    isActive?: boolean;
    countryCode?: string;
    pending?: { toTier: PlanTier; effectiveAt: number; requestedAt?: number };
  } = {},
) {
  const restaurant = await seed.restaurant(
    opts.countryCode ? { countryCode: opts.countryCode } : {},
  );
  const restaurantId = String(restaurant.id);
  const owner = await seed.user({
    username: `plan-owner-${++userSeq}`,
    role: 1,
    restaurantId,
  });
  const cycle = opts.cycle === undefined ? null : opts.cycle;
  await db()
    .insert(shopSubscriptions)
    .values({
      restaurantId,
      planTier: opts.tier ?? "trial",
      moduleOverrides: opts.overrides ?? {},
      isActive: opts.isActive ?? true,
      trialEndsAt: new Date(Date.now() + 90 * DAY),
      billingCycleStartAt: cycle ? new Date(cycle[0]) : null,
      billingCycleEndAt: cycle ? new Date(cycle[1]) : null,
      createdAt: new Date(Date.now() - 30 * DAY),
      ...(opts.pending
        ? {
            pendingPlanTier: opts.pending.toTier,
            pendingEffectiveAt: new Date(opts.pending.effectiveAt),
            pendingRequestedBy: owner.id,
            pendingRequestedAt: new Date(
              opts.pending.requestedAt ?? opts.pending.effectiveAt - DAY,
            ),
          }
        : {}),
    });
  const ownerToken = await testApp.authHelper.ownerToken(
    owner.id,
    restaurantId,
  );
  return { restaurantId, ownerId: owner.id, ownerToken };
}

async function subOf(restaurantId: string) {
  const [row] = await db()
    .select()
    .from(shopSubscriptions)
    .where(eq(shopSubscriptions.restaurantId, restaurantId));
  return row;
}

async function openCashShift(restaurantId: string, operatorId: string) {
  const now = new Date();
  const registerId = `reg-${restaurantId}`;
  await db()
    .insert(cashRegisters)
    .values({
      id: registerId,
      name: "Front",
      restaurantId,
      createdAt: now,
      updatedAt: now,
    } as never);
  await db()
    .insert(cashShifts)
    .values({
      id: `shift-${restaurantId}`,
      registerId,
      operatorId,
      startedAt: now,
      status: "active",
    } as never);
  return () =>
    db()
      .update(cashShifts)
      .set({ status: "closed", endedAt: new Date() })
      .where(eq(cashShifts.registerId, registerId));
}

function call(path: string, token: string, method = "GET", body?: unknown) {
  return testApp.app.fetch(
    new Request(`https://test/api/v1${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        host: "test",
        origin: "https://test",
        cookie: `csrf_token=${CSRF}`,
        "x-csrf-token": CSRF,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function json(res: Response) {
  return (await res.json()) as {
    success: boolean;
    data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    error?: { code: string; details?: unknown };
  };
}

function quotaContext(restaurantId: string) {
  const background: Promise<unknown>[] = [];
  return {
    background,
    ctx: {
      env: testApp.env,
      get: (key: string) =>
        key === "user" ? { role: 1, restaurantId } : undefined,
      header: () => {},
      executionCtx: { waitUntil: (p: Promise<unknown>) => background.push(p) },
    } as never,
  };
}

describe("POST /billing/plan/change — immediate", () => {
  it.each(["basic", "pro", "enterprise"] as const)(
    "trial -> %s applies now and starts a fresh cycle",
    async (toTier) => {
      const { restaurantId, ownerToken } = await shop({
        overrides: { loyalty: true },
      });
      const before = Date.now();

      const res = await call("/billing/plan/change", ownerToken, "POST", {
        planTier: toTier,
      });
      const body = await json(res);

      expect(res.status).toBe(200);
      expect(body.data).toMatchObject({
        currentTier: toTier,
        pendingChange: null,
        cycle: { kind: "billing" },
      });
      const sub = await subOf(restaurantId);
      expect(sub.planTier).toBe(toTier);
      expect(sub.moduleOverrides).toEqual({ loyalty: true });
      expect(sub.billingCycleStartAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(
        sub.billingCycleEndAt!.getTime() - sub.billingCycleStartAt!.getTime(),
      ).toBe(DEFAULT_BILLING_CYCLE_MS);
    },
  );

  it("basic -> pro applies now", async () => {
    const now = Date.now();
    const { restaurantId, ownerToken } = await shop({
      tier: "basic",
      cycle: [now - 10 * DAY, now + 20 * DAY],
    });
    const res = await call("/billing/plan/change", ownerToken, "POST", {
      planTier: "pro",
    });
    expect(res.status).toBe(200);
    expect((await subOf(restaurantId)).planTier).toBe("pro");
  });

  it("an upgrade while a downgrade is pending applies now and clears it", async () => {
    const now = Date.now();
    const { restaurantId, ownerToken } = await shop({
      tier: "pro",
      cycle: [now - 10 * DAY, now + 20 * DAY],
      pending: { toTier: "basic", effectiveAt: now + 20 * DAY },
    });
    const body = await json(
      await call("/billing/plan/change", ownerToken, "POST", {
        planTier: "enterprise",
      }),
    );
    expect(body.data.pendingChange).toBeNull();
    const sub = await subOf(restaurantId);
    expect(sub.planTier).toBe("enterprise");
    expect(sub.pendingPlanTier).toBeNull();
  });

  it("refuses to drop POS while a cash shift is open", async () => {
    const { restaurantId, ownerId, ownerToken } = await shop();
    await openCashShift(restaurantId, ownerId);

    const res = await call("/billing/plan/change", ownerToken, "POST", {
      planTier: "basic",
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error?.code).toBe(
      "PLAN_CHANGE_BLOCKED_OPEN_SHIFT",
    );
    expect((await subOf(restaurantId)).planTier).toBe("trial");
  });

  it("answers PLAN_CHANGE_CONFLICT when the tier moved under it", async () => {
    const now = Date.now();
    const { restaurantId, ownerId } = await shop({
      tier: "pro",
      cycle: [now - DAY, now + 29 * DAY],
    });
    const stale = {
      ...(await subOf(restaurantId)),
      planTier: "basic" as const,
    };
    const svc = service();
    vi.spyOn(
      svc as unknown as { load: () => Promise<unknown> },
      "load",
    ).mockResolvedValue(stale);

    await expect(
      svc.requestChange(restaurantId, "enterprise", ownerId),
    ).rejects.toMatchObject({ code: "PLAN_CHANGE_CONFLICT", status: 409 });
    expect((await subOf(restaurantId)).planTier).toBe("pro");
  });
});

describe("POST /billing/plan/change — refusals", () => {
  it("refuses trial, the same tier and an inactive subscription", async () => {
    const now = Date.now();
    const active = await shop({
      tier: "pro",
      cycle: [now - DAY, now + 29 * DAY],
    });
    const trialRes = await call(
      "/billing/plan/change",
      active.ownerToken,
      "POST",
      { planTier: "trial" },
    );
    expect(trialRes.status).toBe(409);
    expect((await json(trialRes)).error?.code).toBe(
      "PLAN_TRIAL_NOT_REENTERABLE",
    );

    const sameRes = await call(
      "/billing/plan/change",
      active.ownerToken,
      "POST",
      { planTier: "pro" },
    );
    expect(sameRes.status).toBe(409);
    expect((await json(sameRes)).error?.code).toBe("PLAN_UNCHANGED");

    const inactive = await shop({ tier: "basic", isActive: false });
    const inactiveRes = await call(
      "/billing/plan/change",
      inactive.ownerToken,
      "POST",
      { planTier: "pro" },
    );
    expect(inactiveRes.status).toBe(409);
    expect((await json(inactiveRes)).error?.code).toBe("SUBSCRIPTION_INACTIVE");
  });

  it("refuses a tier the region does not offer", async () => {
    await db()
      .insert(regionPolicies)
      .values({
        scopeType: "country",
        scopeId: "TW",
        policyKey: "plans.allowed_tiers",
        value: JSON.stringify(["basic"]),
      } as never);
    const { ownerToken } = await shop({ countryCode: "TW" });

    const res = await call("/billing/plan/change", ownerToken, "POST", {
      planTier: "pro",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("PLAN_NOT_AVAILABLE_IN_REGION");
  });
});

describe("scheduled downgrades", () => {
  it("pro -> basic waits for the end of the billing cycle", async () => {
    const now = Date.now();
    const end = now + 12 * DAY;
    const { restaurantId, ownerToken } = await shop({
      tier: "pro",
      cycle: [end - DEFAULT_BILLING_CYCLE_MS, end],
    });
    const body = await json(
      await call("/billing/plan/change", ownerToken, "POST", {
        planTier: "basic",
      }),
    );
    expect(body.data.currentTier).toBe("pro");
    expect(body.data.pendingChange).toMatchObject({
      toTier: "basic",
      effectiveAt: end,
      deferredReason: null,
    });
    expect((await subOf(restaurantId)).planTier).toBe("pro");
  });

  it("enterprise with NULL cycle dates -> basic waits for the end of the UTC month", async () => {
    const { ownerToken } = await shop({ tier: "enterprise", cycle: null });
    const body = await json(
      await call("/billing/plan/change", ownerToken, "POST", {
        planTier: "basic",
      }),
    );
    const today = new Date();
    expect(body.data.pendingChange.effectiveAt).toBe(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1),
    );
    expect(body.data.cycle.kind).toBe("calendar_month");
  });

  it("a second downgrade replaces the first; DELETE cancels it", async () => {
    const now = Date.now();
    const { restaurantId, ownerToken } = await shop({
      tier: "enterprise",
      cycle: [now - DAY, now + 29 * DAY],
    });
    await call("/billing/plan/change", ownerToken, "POST", { planTier: "pro" });
    const replaced = await json(
      await call("/billing/plan/change", ownerToken, "POST", {
        planTier: "basic",
      }),
    );
    expect(replaced.data.pendingChange.toTier).toBe("basic");

    const cancelled = await call("/billing/plan/pending", ownerToken, "DELETE");
    expect(cancelled.status).toBe(200);
    expect((await json(cancelled)).data.pendingChange).toBeNull();
    expect((await subOf(restaurantId)).pendingPlanTier).toBeNull();

    const again = await call("/billing/plan/pending", ownerToken, "DELETE");
    expect(again.status).toBe(404);
    expect((await json(again)).error?.code).toBe("PLAN_NO_PENDING_CHANGE");

    // request x2 + cancel, each in both audit tables.
    const audits = await db()
      .select()
      .from(paymentAuditLog)
      .where(eq(paymentAuditLog.restaurantId, restaurantId));
    expect(audits.map((a) => a.eventType)).toEqual([
      "plan_change",
      "plan_change",
      "plan_change",
    ]);
    const actorRows = await db()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.restaurantId, restaurantId),
          eq(auditLogs.action, "plan_change"),
        ),
      );
    expect(actorRows).toHaveLength(3);
    expect(actorRows.every((row) => row.userId !== null)).toBe(true);
    const mails = await db()
      .select({ kind: notificationDispatchLog.kind })
      .from(notificationDispatchLog)
      .where(eq(notificationDispatchLog.restaurantId, restaurantId));
    expect(mails.map((m) => m.kind).sort()).toEqual([
      "plan_change_cancelled",
      "plan_change_scheduled",
      "plan_change_scheduled",
    ]);
  });

  it("keeps overrides through request and application", async () => {
    const now = Date.now();
    const { restaurantId, ownerId } = await shop({
      tier: "pro",
      cycle: [now - 31 * DAY, now - DAY],
      overrides: { inventory: true, coupons: false },
      pending: { toTier: "basic", effectiveAt: now - DAY },
    });
    await service().applyDueForRestaurant(restaurantId, now);
    expect((await subOf(restaurantId)).moduleOverrides).toEqual({
      inventory: true,
      coupons: false,
    });
    await service().requestChange(restaurantId, "enterprise", ownerId, now);
    expect((await subOf(restaurantId)).moduleOverrides).toEqual({
      inventory: true,
      coupons: false,
    });
  });
});

describe("applying due downgrades", () => {
  it("cron: snapshots the ending cycle on the old tier, switches, and is idempotent", async () => {
    const end = Date.now() - 2 * 60 * 60 * 1000;
    const now = Date.now();
    const { restaurantId } = await shop({
      tier: "pro",
      cycle: [end - DEFAULT_BILLING_CYCLE_MS, end],
      pending: { toTier: "basic", effectiveAt: end },
    });

    expect(await applyDuePlanChanges(testApp.env, now)).toEqual({
      due: 1,
      applied: 1,
      deferred: 0,
      failed: 0,
    });
    expect(await applyDuePlanChanges(testApp.env, now)).toMatchObject({
      due: 0,
      applied: 0,
    });
    // The closer that runs right after finds nothing left to close.
    expect(
      await new BillingCycleService(testApp.env).closeDueCycles(now),
    ).toEqual({ closed: 0 });

    const sub = await subOf(restaurantId);
    expect(sub.planTier).toBe("basic");
    expect(sub.pendingPlanTier).toBeNull();
    expect(sub.billingCycleStartAt!.getTime()).toBe(end);
    const snapshots = await db()
      .select()
      .from(cycleSnapshots)
      .where(eq(cycleSnapshots.restaurantId, restaurantId));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      planTier: "pro",
      cycleStartAt: new Date(end - DEFAULT_BILLING_CYCLE_MS),
    });
    const applied = await db()
      .select()
      .from(paymentAuditLog)
      .where(
        and(
          eq(paymentAuditLog.restaurantId, restaurantId),
          eq(paymentAuditLog.eventType, "plan_change"),
        ),
      );
    expect(applied).toHaveLength(1);
  });

  it("a late cron rolls the new cycle forward to contain now", async () => {
    const now = Date.now();
    const effectiveAt = now - 40 * DAY;
    const { restaurantId } = await shop({
      tier: "enterprise",
      cycle: null,
      pending: { toTier: "pro", effectiveAt },
    });
    await applyDuePlanChanges(testApp.env, now);

    const sub = await subOf(restaurantId);
    expect(sub.billingCycleStartAt!.getTime()).toBe(
      effectiveAt + DEFAULT_BILLING_CYCLE_MS,
    );
    expect(sub.billingCycleEndAt!.getTime()).toBeGreaterThan(now);
  });

  it("defers while a cash shift is open, reports it, and applies lazily on GET once closed", async () => {
    const now = Date.now();
    const { restaurantId, ownerId, ownerToken } = await shop({
      tier: "pro",
      cycle: [now - 31 * DAY, now - DAY],
      pending: { toTier: "basic", effectiveAt: now - DAY },
    });
    const closeShift = await openCashShift(restaurantId, ownerId);

    expect(await applyDuePlanChanges(testApp.env, now)).toMatchObject({
      deferred: 1,
    });
    const deferred = await json(await call("/billing/plan", ownerToken));
    expect(deferred.data.currentTier).toBe("pro");
    expect(deferred.data.pendingChange.deferredReason).toBe("open_cash_shift");

    await closeShift();
    const applied = await json(await call("/billing/plan", ownerToken));
    expect(applied.data.currentTier).toBe("basic");
    expect(applied.data.pendingChange).toBeNull();
  });

  it("applies lazily on GET when the cron has not run", async () => {
    const now = Date.now();
    const { ownerToken } = await shop({
      tier: "enterprise",
      cycle: null,
      pending: { toTier: "basic", effectiveAt: now - 60_000 },
    });
    const body = await json(await call("/billing/plan", ownerToken));
    expect(body.data.currentTier).toBe("basic");
  });
});

describe("quota counter after an immediate upgrade", () => {
  it("quotaGate counts from zero once the shop upgrades", async () => {
    const now = Date.now();
    const cycleStart = now - 10 * DAY;
    const cycleEnd = now + 20 * DAY;
    const { restaurantId, ownerToken } = await shop({
      tier: "basic",
      cycle: [cycleStart, cycleEnd],
    });
    await db()
      .insert(usageMeters)
      .values({
        restaurantId,
        meterKey: "orders.created",
        cycleStartAt: new Date(cycleStart),
        cycleEndAt: new Date(cycleEnd),
        totalQuantity: 1000,
      } as never);
    // An unfolded bucket from before the change, keyed under the old cycle.
    await db()
      .insert(usageMeterBuckets)
      .values({
        restaurantId,
        meterKey: "orders.created",
        bucketStartAt: new Date(usageBucketStartFor(now) - 2 * 3600_000),
        quantity: 5,
      } as never);

    const blocked = quotaContext(restaurantId);
    await expect(
      enforceQuota(blocked.ctx, "orders.created"),
    ).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      status: 429,
      details: expect.objectContaining({ meterKey: "orders.created" }),
    });
    await Promise.all(blocked.background);

    const usageBefore = await json(await call("/me/usage", ownerToken));
    expect(
      usageBefore.data.meters.find(
        (m: { meterKey: string }) => m.meterKey === "orders.created",
      ),
    ).toMatchObject({ state: "over", enforced: true });

    expect(
      (
        await call("/billing/plan/change", ownerToken, "POST", {
          planTier: "pro",
        })
      ).status,
    ).toBe(200);

    const resumed = quotaContext(restaurantId);
    await expect(
      enforceQuota(resumed.ctx, "orders.created"),
    ).resolves.toBeUndefined();
    const usageAfter = await json(await call("/me/usage", ownerToken));
    expect(
      usageAfter.data.meters.find(
        (m: { meterKey: string }) => m.meterKey === "orders.created",
      ),
    ).toMatchObject({ total: 0, state: "ok" });
  });

  it("emails the owner once per meter per cycle at the hard limit", async () => {
    const now = Date.now();
    const { restaurantId } = await shop({
      tier: "basic",
      cycle: [now - DAY, now + 29 * DAY],
    });
    await db()
      .insert(usageMeters)
      .values({
        restaurantId,
        meterKey: "orders.created",
        cycleStartAt: new Date(now - DAY),
        cycleEndAt: new Date(now + 29 * DAY),
        totalQuantity: 1000,
      } as never);

    for (let i = 0; i < 3; i++) {
      const { ctx, background } = quotaContext(restaurantId);
      await enforceQuota(ctx, "orders.created").catch(() => {});
      await Promise.all(background);
    }
    const rows = await db()
      .select()
      .from(notificationDispatchLog)
      .where(eq(notificationDispatchLog.restaurantId, restaurantId));
    expect(rows.map((r) => `${r.kind}/${r.channel}`).sort()).toEqual([
      "quota_hard/slack",
      "quota_hard_owner/email",
    ]);
  });
});

describe("GET /billing/plan options and impact", () => {
  it("computes modules with a preserved override and a region-disabled module", async () => {
    await db()
      .insert(regionPolicies)
      .values({
        scopeType: "country",
        scopeId: "MY",
        policyKey: "modules.disabled",
        value: JSON.stringify(["pos"]),
      } as never);
    const now = Date.now();
    const { ownerToken } = await shop({
      tier: "basic",
      cycle: [now - DAY, now + 29 * DAY],
      countryCode: "MY",
      overrides: { loyalty: true },
    });

    const { data } = await json(await call("/billing/plan", ownerToken));
    const byTier = Object.fromEntries(
      data.options.map((o: { tier: string }) => [o.tier, o]),
    );
    expect(byTier.basic).toMatchObject({ action: "current", effective: null });
    expect(byTier.basic.modules).toContain("loyalty");
    expect(byTier.trial).toMatchObject({
      action: "unavailable",
      unavailableReason: "trial_not_reenterable",
    });
    expect(byTier.pro).toMatchObject({
      action: "upgrade",
      effective: "immediately",
    });
    expect(byTier.pro.modules).not.toContain("pos");
    expect(byTier.pro.modules).toContain("loyalty");
    expect(byTier.pro.gainedModules).toContain("analytics");
    expect(byTier.pro.lostModules).toEqual([]);
    expect(byTier.pro.quotas["orders.created"]).toEqual(
      expect.objectContaining({ hard: expect.any(Number) }),
    );
    expect(byTier.enterprise.quotas["orders.created"]).toBeNull();
  });

  it("counts what a trial shop would lose by moving to basic", async () => {
    const { restaurantId, ownerId, ownerToken } = await shop();
    await openCashShift(restaurantId, ownerId);
    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    const now = Date.now();
    await db()
      .insert(reservations)
      .values({
        id: `res-${restaurantId}`,
        restaurantId,
        customerName: "A",
        customerPhone: "0900000000",
        partySize: 2,
        reservationDate: tomorrow,
        reservationTime: "19:00",
        confirmationCode: `C-${restaurantId}`,
        status: "confirmed",
        createdAt: now,
        updatedAt: now,
      } as never);
    await seed.coupon(restaurantId);
    await db()
      .insert(ingredientDefinitions)
      .values({
        restaurantId,
        name: "Rice",
        unit: "kg",
      } as never);
    await db()
      .insert(platformIntegrations)
      .values({
        restaurantId,
        platform: "uber_eats",
        enabled: true,
      } as never);
    await db()
      .insert(employeeSchedules)
      .values({
        restaurantId,
        employeeId: ownerId,
        workDate: tomorrow,
        startTime: "09:00",
        endTime: "17:00",
        scheduledHours: 8,
        createdBy: ownerId,
      } as never);

    const res = await call("/billing/plan/impact?planTier=basic", ownerToken);
    const { data } = await json(res);
    expect(res.status).toBe(200);
    expect(data.lostModules).toEqual(
      expect.arrayContaining(["pos", "coupons", "reservations", "inventory"]),
    );
    const items = Object.fromEntries(
      data.items.map((i: { key: string }) => [i.key, i]),
    );
    expect(items).toEqual({
      open_cash_shift: { key: "open_cash_shift", count: 1, blocking: true },
      future_reservations: {
        key: "future_reservations",
        count: 1,
        blocking: false,
      },
      active_coupons: { key: "active_coupons", count: 1, blocking: false },
      tracked_ingredients: {
        key: "tracked_ingredients",
        count: 1,
        blocking: false,
      },
      connected_platforms: {
        key: "connected_platforms",
        count: 1,
        blocking: false,
      },
      scheduled_shifts: { key: "scheduled_shifts", count: 1, blocking: false },
    });
  });
});

describe("role and scope", () => {
  it("lets owners see only their shop, admins any shop, and nobody else", async () => {
    const a = await shop();
    const b = await shop();
    const cashier = await seed.user({
      username: `plan-cashier-${++userSeq}`,
      role: 4,
      restaurantId: a.restaurantId,
    });
    const cashierToken = await testApp.authHelper.staffToken(
      cashier.id,
      4,
      a.restaurantId,
    );
    const adminToken = await testApp.authHelper.adminToken();

    expect((await call("/billing/plan", cashierToken)).status).toBe(403);
    expect(
      (await call(`/billing/plan?restaurantId=${b.restaurantId}`, a.ownerToken))
        .status,
    ).toBe(403);
    expect((await call("/billing/plan", adminToken)).status).toBe(400);
    const asAdmin = await call(
      `/billing/plan?restaurantId=${b.restaurantId}`,
      adminToken,
    );
    expect(asAdmin.status).toBe(200);
    expect((await json(asAdmin)).data.restaurantId).toBe(b.restaurantId);
  });

  it("requires the CSRF token on writes (the webhook exemption does not reach /plan)", async () => {
    const { ownerToken } = await shop();
    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/billing/plan/change", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ownerToken}`,
          host: "test",
          origin: "https://test",
        },
        body: JSON.stringify({ planTier: "pro" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
