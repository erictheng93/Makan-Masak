import type { Context, Next } from "hono";
import { ApiError } from "../shared/utils/api-error";
import type { Env } from "../types/env";
import {
  PLAN_QUOTAS,
  type MeterKey,
  type MeterQuota,
  type PlanTier,
} from "@makanmasak/database";
import {
  BILLING_NOTIFICATION_KINDS,
  BillingNotificationService,
  NOTIFICATION_CHANNELS,
  quotaHardOwnerCopy,
  restaurantContact,
} from "../features/billing/services/BillingNotificationService";
import { sumUnfoldedBucketQuantities } from "../shared/utils/usage-buckets";
import { resolveUsageCycle } from "../shared/utils/usage-cycle";

interface SubscriptionRow {
  plan_tier: PlanTier;
  trial_ends_at_ms: number | null;
  billing_cycle_start_at_ms: number | null;
  billing_cycle_end_at_ms: number | null;
  created_at_ms: number;
}

type QuotaContext<E extends { Bindings: Env } = { Bindings: Env }> = Context<E>;

type GuestRestaurantResolver<E extends { Bindings: Env }> = (
  c: QuotaContext<E>,
) => string | undefined | Promise<string | undefined>;

interface QuotaCheckOptions<E extends { Bindings: Env } = { Bindings: Env }> {
  restaurantId?: string;
  resolveGuestRestaurantId?: GuestRestaurantResolver<E>;
}

interface QuotaUser {
  role?: number;
  restaurantId?: string | number | null;
}

export function quotaExceeded(
  meterKey: MeterKey,
  hardLimit: number,
  current: number,
) {
  return new ApiError("QUOTA_EXCEEDED", `Quota exceeded for ${meterKey}`, 429, {
    meterKey,
    hardLimit,
    current,
  });
}

function getMode(env: Pick<Env, "QUOTA_ENFORCEMENT_MODE">) {
  return env.QUOTA_ENFORCEMENT_MODE ?? "disabled";
}

/**
 * Meters some route actually gates (quotaGate / enforceQuota). `api.requests`
 * and `storage.bytes` are metered and shown, but nothing ever blocks on them.
 */
export const GATED_METER_KEYS: ReadonlySet<MeterKey> = new Set<MeterKey>([
  "orders.created",
  "print.jobs",
  "ai.requests",
]);

/** True when reaching the hard limit of `meterKey` really blocks requests. */
export function isMeterEnforced(
  env: Pick<Env, "QUOTA_ENFORCEMENT_MODE">,
  meterKey: MeterKey,
): boolean {
  return getMode(env) === "enforce" && GATED_METER_KEYS.has(meterKey);
}

/** The thresholds enforceQuota applies, as a state an owner UI can show. */
export function quotaState(
  count: number,
  quota: MeterQuota | undefined,
): "ok" | "warning" | "over" {
  if (!quota) return "ok";
  if (count >= quota.hard) return "over";
  return count >= quota.soft ? "warning" : "ok";
}

async function getSubscription<E extends { Bindings: Env }>(
  c: QuotaContext<E>,
  restaurantId: string,
): Promise<SubscriptionRow | null> {
  return await c.env.DB.prepare(
    `SELECT plan_tier, trial_ends_at_ms, billing_cycle_start_at_ms,
            billing_cycle_end_at_ms, created_at_ms
       FROM shop_subscriptions
      WHERE restaurant_id = ?
      LIMIT 1`,
  )
    .bind(restaurantId)
    .first<SubscriptionRow>();
}

async function getAggregatedCount<E extends { Bindings: Env }>(
  c: QuotaContext<E>,
  restaurantId: string,
  meterKey: MeterKey,
  cycleStartAt: number,
): Promise<number> {
  // Not cached in KV: this is a one-row indexed read, cheaper than the KV
  // get + put that used to front it, and KV writes are the scarce quota.
  const row = await c.env.DB.prepare(
    `SELECT total_quantity
       FROM usage_meters
      WHERE restaurant_id = ?
        AND meter_key = ?
        AND cycle_start_at_ms = ?
      LIMIT 1`,
  )
    .bind(restaurantId, meterKey, cycleStartAt)
    .first<{ total_quantity: number }>();

  return row?.total_quantity ?? 0;
}

async function getPendingCount<E extends { Bindings: Env }>(
  c: QuotaContext<E>,
  restaurantId: string,
  meterKey: MeterKey,
): Promise<number> {
  const row = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(quantity), 0) AS total
       FROM usage_events
      WHERE aggregated_at_ms IS NULL
        AND restaurant_id = ?
        AND meter_key = ?`,
  )
    .bind(restaurantId, meterKey)
    .first<{ total: number }>();

  return row?.total ?? 0;
}

/**
 * Usage recorded in hourly buckets that the aggregator has not folded into
 * `usage_meters` yet.
 *
 * Without this the gate could not see the current hour at all: `meterEmit`
 * writes into the open bucket, and a bucket only reaches `usage_meters` after
 * its hour closes and the hourly cron runs. A tenant could burn up to an hour
 * of traffic past its hard limit before the gate noticed (#333).
 */
async function getUnfoldedBucketCount<E extends { Bindings: Env }>(
  c: QuotaContext<E>,
  restaurantId: string,
  meterKey: MeterKey,
  cycle: { startAt: number; endAt: number },
): Promise<number> {
  const totals = await sumUnfoldedBucketQuantities(c.env.DB, restaurantId, {
    fromMs: cycle.startAt,
    toMs: cycle.endAt,
    meterKey,
  });

  return totals.get(meterKey) ?? 0;
}

function setQuotaWarning<E extends { Bindings: Env }>(
  c: QuotaContext<E>,
  meterKey: MeterKey,
  count: number,
  quota: MeterQuota,
) {
  const pct = Math.min(100, Math.floor((count / quota.hard) * 100));
  c.header("X-Quota-Warning", `${meterKey} ${pct}%`);
}

async function notifyHardQuotaExceeded<E extends { Bindings: Env }>(
  c: QuotaContext<E>,
  restaurantId: string,
  meterKey: MeterKey,
  cycleStartAt: number,
  hardLimit: number,
  current: number,
) {
  const notifications = new BillingNotificationService(c.env);
  const dedupKey = `${meterKey}:cycle:${cycleStartAt}`;
  const payload = { meterKey, cycleStartAt, hardLimit, current };
  const sendOp = notifications
    .send({
      restaurantId,
      kind: BILLING_NOTIFICATION_KINDS.QUOTA_HARD,
      dedupKey,
      channel: NOTIFICATION_CHANNELS.SLACK,
      text: `Quota hard limit reached for restaurant ${restaurantId}: ${meterKey} ${current}/${hardLimit}`,
      payload,
    })
    .then(async (slack) => {
      // The Slack dedup row already says "first time this meter hit its limit
      // this cycle", so every later blocked request skips the owner lookup.
      if (slack.duplicate) return;
      const owner = await restaurantContact(c.env.DB, restaurantId);
      await notifications.send({
        restaurantId,
        kind: BILLING_NOTIFICATION_KINDS.QUOTA_HARD_OWNER,
        dedupKey,
        channel: NOTIFICATION_CHANNELS.EMAIL,
        recipient: owner?.email ?? null,
        ...quotaHardOwnerCopy(owner?.name ?? "your restaurant", meterKey),
        payload,
      });
    })
    .catch((error) => {
      console.error("quotaGate.notification.failed", {
        restaurantId,
        meterKey,
        error,
      });
    });

  let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
  try {
    waitUntil = c.executionCtx?.waitUntil?.bind(c.executionCtx);
  } catch {
    waitUntil = undefined;
  }

  if (waitUntil) {
    waitUntil(sendOp);
  } else {
    await sendOp;
  }
}

export async function enforceQuota<E extends { Bindings: Env }>(
  c: QuotaContext<E>,
  meterKey: MeterKey,
  options: QuotaCheckOptions<E> = {},
): Promise<void> {
  const mode = getMode(c.env);
  if (mode === "disabled") return;

  const user = c.get("user" as never) as QuotaUser | undefined;
  if (user?.role === 0) return;

  const restaurantId =
    options.restaurantId ??
    (user?.restaurantId == null
      ? await options.resolveGuestRestaurantId?.(c)
      : String(user.restaurantId));
  if (!restaurantId) return;

  const subscription = await getSubscription(c, restaurantId);
  if (!subscription) return;

  const quota = PLAN_QUOTAS[subscription.plan_tier]?.[meterKey];
  if (!quota) return;

  const cycle = resolveUsageCycle(
    {
      planTier: subscription.plan_tier,
      trialEndsAtMs: subscription.trial_ends_at_ms,
      billingCycleStartAtMs: subscription.billing_cycle_start_at_ms,
      billingCycleEndAtMs: subscription.billing_cycle_end_at_ms,
      createdAtMs: subscription.created_at_ms,
    },
    Date.now(),
  );
  // Independent reads: overlap them rather than paying three round trips.
  const [aggregated, pending, buckets] = await Promise.all([
    getAggregatedCount(c, restaurantId, meterKey, cycle.startAt),
    getPendingCount(c, restaurantId, meterKey),
    getUnfoldedBucketCount(c, restaurantId, meterKey, cycle),
  ]);
  const effectiveCount = aggregated + pending + buckets;
  const state = quotaState(effectiveCount, quota);

  if (state === "over") {
    setQuotaWarning(c, meterKey, effectiveCount, quota);
    await notifyHardQuotaExceeded(
      c,
      restaurantId,
      meterKey,
      cycle.startAt,
      quota.hard,
      effectiveCount,
    );
    if (mode === "enforce") {
      throw quotaExceeded(meterKey, quota.hard, effectiveCount);
    }
    return;
  }

  if (state === "warning") {
    setQuotaWarning(c, meterKey, effectiveCount, quota);
  }
}

export function quotaGate(
  meterKey: MeterKey,
  resolveGuestRestaurantId?: GuestRestaurantResolver<{ Bindings: Env }>,
) {
  return async <E extends { Bindings: Env }>(
    c: QuotaContext<E>,
    next: Next,
  ) => {
    await enforceQuota(c, meterKey, {
      resolveGuestRestaurantId: resolveGuestRestaurantId as
        | GuestRestaurantResolver<E>
        | undefined,
    });
    await next();
  };
}
