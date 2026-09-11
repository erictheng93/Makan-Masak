import { and, eq, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import {
  drizzle,
  usageMeterBuckets,
  usageBucketStartFor,
  USAGE_BUCKET_MS,
  type D1Database,
  type MeterKey,
} from "@makanmasak/database";

export { USAGE_BUCKET_MS, usageBucketStartFor };

export interface UsageBucketDelta {
  restaurantId: string;
  meterKey: MeterKey;
  quantity: number;
  /** Defaults to now; only the hour it falls in matters. */
  occurredAtMs?: number;
}

export interface ClosedUsageBucket {
  restaurantId: string;
  meterKey: MeterKey;
  bucketStartMs: number;
  quantity: number;
}

/**
 * Add `quantity` to the (restaurant, meter, hour) counter, creating it on the
 * first metered call of that hour.
 *
 * This is the metering hot path — it runs once per metered API request — so it
 * is deliberately a single statement that writes a single row. The `ON
 * CONFLICT DO UPDATE` branch, which is what all but the first request of each
 * hour takes, sets only `quantity` and `updated_at_ms`; neither is indexed and
 * neither appears in a partial index's WHERE clause, so SQLite rewrites the
 * table page and no index entry at all.
 */
export async function recordUsageBucketDelta(
  db: D1Database,
  input: UsageBucketDelta,
): Promise<void> {
  const now = input.occurredAtMs ?? Date.now();
  const bucketStart = new Date(usageBucketStartFor(now));
  const updatedAt = new Date(now);

  await drizzle(db)
    .insert(usageMeterBuckets)
    .values({
      restaurantId: input.restaurantId,
      meterKey: input.meterKey,
      bucketStartAt: bucketStart,
      quantity: input.quantity,
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        usageMeterBuckets.restaurantId,
        usageMeterBuckets.meterKey,
        usageMeterBuckets.bucketStartAt,
      ],
      set: {
        quantity: sql`${usageMeterBuckets.quantity} + excluded.quantity`,
        updatedAt,
      },
    });
}

/**
 * Quantity per meter that is already counted in buckets but not yet folded
 * into `usage_meters`, for buckets starting inside [fromMs, toMs).
 *
 * Every reader of a current-cycle total has to add this to the
 * `usage_meters.total_quantity` for the cycle: a bucket only reaches
 * `usage_meters` after its hour closes and the aggregator runs, so without it
 * the current hour of traffic is invisible to the quota gate and to the
 * billing UI.
 */
export async function sumUnfoldedBucketQuantities(
  db: D1Database,
  restaurantId: string,
  range: { fromMs: number; toMs: number; meterKey?: MeterKey },
): Promise<Map<MeterKey, number>> {
  const rows = await drizzle(db)
    .select({
      meterKey: usageMeterBuckets.meterKey,
      total: sql<number>`COALESCE(SUM(${usageMeterBuckets.quantity}), 0)`,
    })
    .from(usageMeterBuckets)
    .where(
      and(
        eq(usageMeterBuckets.restaurantId, restaurantId),
        isNull(usageMeterBuckets.foldedAt),
        gte(usageMeterBuckets.bucketStartAt, new Date(range.fromMs)),
        lt(usageMeterBuckets.bucketStartAt, new Date(range.toMs)),
        ...(range.meterKey
          ? [eq(usageMeterBuckets.meterKey, range.meterKey)]
          : []),
      ),
    )
    .groupBy(usageMeterBuckets.meterKey);

  return new Map(rows.map((row) => [row.meterKey, Number(row.total)]));
}

/**
 * Unfolded buckets whose hour has already ended, oldest first.
 *
 * Only closed buckets are returned. An open bucket is still receiving
 * increments — `recordUsageBucketDelta` always writes into the hour containing
 * `Date.now()` — so folding one would freeze a count that is still moving and
 * lose the rest of the hour.
 *
 * Ascending order matters when `limit` truncates the batch: it leaves the
 * *later* buckets unread, which is what lets the caller mark a
 * (restaurant, meter) pair folded with a single `bucket_start_ms <= max(read)`
 * predicate without sweeping up a bucket it never counted.
 */
export async function listClosedUnfoldedBuckets(
  db: D1Database,
  options: { nowMs?: number; limit?: number } = {},
): Promise<ClosedUsageBucket[]> {
  const now = options.nowMs ?? Date.now();
  const closedBefore = new Date(usageBucketStartFor(now) - 1);

  const rows = await drizzle(db)
    .select({
      restaurantId: usageMeterBuckets.restaurantId,
      meterKey: usageMeterBuckets.meterKey,
      bucketStartAt: usageMeterBuckets.bucketStartAt,
      quantity: usageMeterBuckets.quantity,
    })
    .from(usageMeterBuckets)
    .where(
      and(
        isNull(usageMeterBuckets.foldedAt),
        lte(usageMeterBuckets.bucketStartAt, closedBefore),
      ),
    )
    .orderBy(usageMeterBuckets.bucketStartAt)
    .limit(options.limit ?? 5000);

  return rows.map((row) => ({
    restaurantId: row.restaurantId,
    meterKey: row.meterKey,
    bucketStartMs: row.bucketStartAt.getTime(),
    quantity: row.quantity,
  }));
}

/**
 * Drop folded buckets that started before `cutoffMs`.
 *
 * Unfolded buckets are never deleted regardless of age: their quantity has not
 * reached `usage_meters` yet, so deleting one would silently discard billable
 * usage rather than expire a record of it.
 */
export async function deleteFoldedBucketsBefore(
  db: D1Database,
  cutoffMs: number,
): Promise<number> {
  const result = await drizzle(db)
    .delete(usageMeterBuckets)
    .where(
      and(
        isNotNull(usageMeterBuckets.foldedAt),
        lt(usageMeterBuckets.bucketStartAt, new Date(cutoffMs)),
      ),
    );

  return result.meta?.changes ?? 0;
}
