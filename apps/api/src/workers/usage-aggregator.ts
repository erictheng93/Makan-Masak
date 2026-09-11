import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  drizzle,
  shopSubscriptions,
  usageEvents,
  usageMeterBuckets,
  usageMeters,
  type D1Database,
  type MeterKey,
} from "@makanmasak/database";
import { generateUUID } from "@makanmasak/utils";
import type { Env } from "../types/env";
import { listClosedUnfoldedBuckets } from "../shared/utils/usage-buckets";

type DrizzleDb = ReturnType<typeof drizzle>;
type SqliteBatchItem = BatchItem<"sqlite">;

interface SubscriptionCycleRow {
  planTier: string;
  trialEndsAt: Date | null;
  billingCycleStartAt: Date | null;
  billingCycleEndAt: Date | null;
  createdAt: Date;
}

interface UsageCycle {
  startAt: number;
  endAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_EVENT_GROUP_LIMIT = 5000;
const CLOSED_BUCKET_LIMIT = 5000;

function fallbackMonthlyCycle(occurredAt: number): UsageCycle {
  const occurred = new Date(occurredAt);
  const startAt = Date.UTC(
    occurred.getUTCFullYear(),
    occurred.getUTCMonth(),
    1,
  );
  const endAt = Date.UTC(
    occurred.getUTCFullYear(),
    occurred.getUTCMonth() + 1,
    1,
  );
  return { startAt, endAt };
}

function resolveUsageCycle(
  subscription: SubscriptionCycleRow | null,
  occurredAt: number,
): UsageCycle {
  if (!subscription) {
    return fallbackMonthlyCycle(occurredAt);
  }

  if (
    subscription.planTier !== "trial" &&
    subscription.billingCycleStartAt !== null &&
    subscription.billingCycleEndAt !== null
  ) {
    return {
      startAt: subscription.billingCycleStartAt.getTime(),
      endAt: subscription.billingCycleEndAt.getTime(),
    };
  }

  if (subscription.planTier === "trial") {
    const createdAt = subscription.createdAt.getTime();
    return {
      startAt: createdAt,
      endAt: subscription.trialEndsAt?.getTime() ?? createdAt + 14 * DAY_MS,
    };
  }

  return fallbackMonthlyCycle(occurredAt);
}

/**
 * One subscription read per restaurant per run, not one per group: a
 * restaurant with five meters and twenty closed buckets would otherwise cost
 * twenty-five identical `shop_subscriptions` lookups.
 */
function createCycleResolver(db: DrizzleDb) {
  const cache = new Map<string, SubscriptionCycleRow | null>();

  return async function cycleFor(
    restaurantId: string,
    occurredAt: number,
  ): Promise<UsageCycle> {
    if (!cache.has(restaurantId)) {
      const [row] = await db
        .select({
          planTier: shopSubscriptions.planTier,
          trialEndsAt: shopSubscriptions.trialEndsAt,
          billingCycleStartAt: shopSubscriptions.billingCycleStartAt,
          billingCycleEndAt: shopSubscriptions.billingCycleEndAt,
          createdAt: shopSubscriptions.createdAt,
        })
        .from(shopSubscriptions)
        .where(eq(shopSubscriptions.restaurantId, restaurantId))
        .limit(1);
      cache.set(restaurantId, row ?? null);
    }

    return resolveUsageCycle(cache.get(restaurantId) ?? null, occurredAt);
  };
}

/**
 * Add `delta` to the (restaurant, meter, cycle) total. `usage_meters` is the
 * store of record for invoicing, so this stays an additive upsert: folding the
 * same work twice is prevented by the caller marking its source rows consumed
 * in the same batch, not by this statement being idempotent on its own.
 */
function usageMeterUpsert(
  db: DrizzleDb,
  input: {
    restaurantId: string;
    meterKey: MeterKey;
    cycle: UsageCycle;
    delta: number;
    now: number;
  },
): SqliteBatchItem {
  const stamp = new Date(input.now);

  return db
    .insert(usageMeters)
    .values({
      id: generateUUID(),
      restaurantId: input.restaurantId,
      meterKey: input.meterKey,
      cycleStartAt: new Date(input.cycle.startAt),
      cycleEndAt: new Date(input.cycle.endAt),
      totalQuantity: input.delta,
      lastAggregatedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
    })
    .onConflictDoUpdate({
      target: [
        usageMeters.restaurantId,
        usageMeters.meterKey,
        usageMeters.cycleStartAt,
      ],
      set: {
        totalQuantity: sql`${usageMeters.totalQuantity} + excluded.total_quantity`,
        lastAggregatedAt: stamp,
        updatedAt: stamp,
      },
    });
}

interface PendingBucketGroup {
  restaurantId: string;
  meterKey: MeterKey;
  maxBucketStartMs: number;
  /** cycle start -> the cycle and the quantity folded into it */
  cycles: Map<number, { cycle: UsageCycle; delta: number }>;
}

/**
 * Fold closed `usage_meter_buckets` rows into `usage_meters`.
 *
 * Each (restaurant, meter) pair is folded in a single D1 batch: the
 * `usage_meters` upserts for every cycle that pair's buckets fall in, followed
 * by the UPDATE that stamps those buckets folded. D1 runs a batch in one
 * transaction, so the counted-but-not-yet-marked window that would let a retry
 * double count does not exist.
 */
async function foldClosedBuckets(
  db: DrizzleDb,
  rawDb: D1Database,
  now: number,
) {
  const buckets = await listClosedUnfoldedBuckets(rawDb, {
    nowMs: now,
    limit: CLOSED_BUCKET_LIMIT,
  });
  const restaurants = new Set<string>();
  if (buckets.length === 0) return { folded: 0, restaurants };

  const cycleFor = createCycleResolver(db);
  const groups = new Map<string, PendingBucketGroup>();

  for (const bucket of buckets) {
    const key = `${bucket.restaurantId}|${bucket.meterKey}`;
    const group = groups.get(key) ?? {
      restaurantId: bucket.restaurantId,
      meterKey: bucket.meterKey,
      maxBucketStartMs: bucket.bucketStartMs,
      cycles: new Map(),
    };

    // Resolved per bucket, not per group: a pair's buckets can straddle a
    // billing-cycle boundary, and attributing the whole group to the cycle of
    // its earliest bucket would bill the wrong cycle for the rest.
    const cycle = await cycleFor(bucket.restaurantId, bucket.bucketStartMs);
    const existing = group.cycles.get(cycle.startAt);
    group.cycles.set(cycle.startAt, {
      cycle,
      delta: (existing?.delta ?? 0) + bucket.quantity,
    });
    group.maxBucketStartMs = Math.max(
      group.maxBucketStartMs,
      bucket.bucketStartMs,
    );
    groups.set(key, group);
  }

  let folded = 0;

  for (const group of groups.values()) {
    const statements: SqliteBatchItem[] = [];
    for (const { cycle, delta } of group.cycles.values()) {
      statements.push(
        usageMeterUpsert(db, {
          restaurantId: group.restaurantId,
          meterKey: group.meterKey,
          cycle,
          delta,
          now,
        }),
      );
    }

    statements.push(
      db
        .update(usageMeterBuckets)
        .set({ foldedAt: new Date(now), updatedAt: new Date(now) })
        .where(
          and(
            isNull(usageMeterBuckets.foldedAt),
            eq(usageMeterBuckets.restaurantId, group.restaurantId),
            eq(usageMeterBuckets.meterKey, group.meterKey),
            lte(
              usageMeterBuckets.bucketStartAt,
              new Date(group.maxBucketStartMs),
            ),
          ),
        ),
    );

    const results = await db.batch(
      statements as [SqliteBatchItem, ...SqliteBatchItem[]],
    );
    const markResult = results[results.length - 1] as
      | { meta?: { changes?: number } }
      | undefined;
    folded += markResult?.meta?.changes ?? 0;
    restaurants.add(group.restaurantId);
  }

  return { folded, restaurants };
}

interface PendingEventGroup {
  restaurantId: string;
  meterKey: MeterKey;
  delta: number;
  firstOccurredAtMs: number;
  lastOccurredAtMs: number;
}

/**
 * Fold whatever still lands in `usage_events`.
 *
 * `meterEmit` writes buckets now, but `UsageService.emitStorageSnapshots`
 * still records `storage.bytes` as one event per restaurant per daily
 * snapshot — a gauge reading rather than a request counter, so there is no
 * per-request volume there to collapse into an hourly counter. This path also
 * drains whatever per-request rows the table still held when the bucket writer
 * shipped.
 */
async function foldPendingEvents(db: DrizzleDb, now: number) {
  const groups = (await db
    .select({
      restaurantId: usageEvents.restaurantId,
      meterKey: usageEvents.meterKey,
      delta: sql<number>`SUM(${usageEvents.quantity})`,
      firstOccurredAtMs: sql<number>`MIN(${usageEvents.occurredAt})`,
      lastOccurredAtMs: sql<number>`MAX(${usageEvents.occurredAt})`,
    })
    .from(usageEvents)
    .where(isNull(usageEvents.aggregatedAt))
    .groupBy(usageEvents.restaurantId, usageEvents.meterKey)
    .limit(PENDING_EVENT_GROUP_LIMIT)) as PendingEventGroup[];

  const restaurants = new Set<string>();
  let processed = 0;
  if (groups.length === 0) return { processed, restaurants };

  const cycleFor = createCycleResolver(db);

  for (const group of groups) {
    const cycle = await cycleFor(
      group.restaurantId,
      Number(group.firstOccurredAtMs),
    );
    const results = await db.batch([
      usageMeterUpsert(db, {
        restaurantId: group.restaurantId,
        meterKey: group.meterKey,
        cycle,
        delta: Number(group.delta),
        now,
      }),
      db
        .update(usageEvents)
        .set({ aggregatedAt: new Date(now) })
        .where(
          and(
            isNull(usageEvents.aggregatedAt),
            eq(usageEvents.restaurantId, group.restaurantId),
            eq(usageEvents.meterKey, group.meterKey),
            lte(
              usageEvents.occurredAt,
              new Date(Number(group.lastOccurredAtMs)),
            ),
          ),
        ),
    ]);

    const markResult = results[1] as
      | { meta?: { changes?: number } }
      | undefined;
    processed += markResult?.meta?.changes ?? 0;
    restaurants.add(group.restaurantId);
  }

  return { processed, restaurants };
}

export async function aggregateUsageMeters(env: Env) {
  const startedAt = Date.now();
  const db = drizzle(env.DB);

  const buckets = await foldClosedBuckets(db, env.DB, startedAt);
  const events = await foldPendingEvents(db, startedAt);

  const restaurants = new Set([...buckets.restaurants, ...events.restaurants]);
  const durationMs = Date.now() - startedAt;

  console.log("usageAggregator.batch", {
    processed: events.processed,
    foldedBuckets: buckets.folded,
    restaurants: restaurants.size,
    durationMs,
  });

  return {
    processed: events.processed,
    foldedBuckets: buckets.folded,
    restaurants: restaurants.size,
    durationMs,
  };
}
