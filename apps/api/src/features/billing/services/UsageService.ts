import { and, eq, gte, lte, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import {
  METER_KEYS,
  PLAN_QUOTAS,
  drizzle,
  usageEvents,
  usageMeterBuckets,
  type MeterKey,
  type PlanTier,
} from "@makanmasak/database";
import type { D1Database } from "@makanmasak/database";
import { generateUUID } from "@makanmasak/utils";
import { sumUnfoldedBucketQuantities } from "../../../shared/utils/usage-buckets";

interface SubscriptionRow {
  plan_tier: PlanTier;
  trial_ends_at_ms: number | null;
  billing_cycle_start_at_ms: number | null;
  billing_cycle_end_at_ms: number | null;
  created_at_ms: number;
}

interface UsageMeterRow {
  meter_key: MeterKey;
  total_quantity: number;
}

interface UsageEventRow {
  id: string;
  restaurant_id: string;
  meter_key: MeterKey;
  quantity: number;
  metadata: string | Record<string, unknown> | null;
  aggregated_at_ms: number | null;
  occurred_at_ms: number;
}

interface CycleRow {
  cycle_start_at_ms: number;
  cycle_end_at_ms: number;
  meter_key: MeterKey;
  total_quantity: number;
  last_aggregated_at_ms: number | null;
}

export interface UsageEventFilters {
  meterKey?: MeterKey;
  from?: number;
  to?: number;
  page?: number;
  limit?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const METER_KEYS_LIST = Object.values(METER_KEYS);

export class UsageService {
  private readonly orm: ReturnType<typeof drizzle>;

  constructor(private readonly db: D1Database) {
    this.orm = drizzle(db);
  }

  async getCurrentUsage(restaurantId: string, now = Date.now()) {
    const subscription = await this.getSubscription(restaurantId);
    const cycle = subscription
      ? this.resolveCycle(subscription, now)
      : this.fallbackMonthlyCycle(now);
    const planTier = subscription?.plan_tier ?? null;

    const meters = await this.getMeterTotals(
      restaurantId,
      cycle.startAt,
      cycle.endAt,
    );
    const pending = await this.getPendingTotals(
      restaurantId,
      cycle.startAt,
      cycle.endAt,
    );
    // Usage recorded this hour lives only in `usage_meter_buckets` until the
    // aggregator folds it, so the owner-facing total has to add it or the
    // billing screen under-reports by up to an hour of traffic (#333).
    const buckets = await sumUnfoldedBucketQuantities(this.db, restaurantId, {
      fromMs: cycle.startAt,
      toMs: cycle.endAt,
    });

    return {
      cycleStartAt: cycle.startAt,
      cycleEndAt: cycle.endAt,
      meters: METER_KEYS_LIST.map((meterKey) => {
        const total =
          (meters.get(meterKey) ?? 0) +
          (pending.get(meterKey) ?? 0) +
          (buckets.get(meterKey) ?? 0);
        const quota = planTier ? PLAN_QUOTAS[planTier]?.[meterKey] : undefined;

        return {
          meterKey,
          total,
          softLimit: quota?.soft ?? null,
          hardLimit: quota?.hard ?? null,
          percentage: quota ? total / quota.hard : null,
        };
      }),
    };
  }

  async listCycleUsage(restaurantId: string, from?: number, to?: number) {
    const now = Date.now();
    const defaultFrom = now - 6 * 31 * DAY_MS;
    const rows = await this.db
      .prepare(
        `SELECT cycle_start_at_ms, cycle_end_at_ms, meter_key, total_quantity,
                last_aggregated_at_ms
           FROM usage_meters
          WHERE restaurant_id = ?
            AND cycle_start_at_ms >= ?
            AND cycle_start_at_ms <= ?
          ORDER BY cycle_start_at_ms DESC, meter_key ASC`,
      )
      .bind(restaurantId, from ?? defaultFrom, to ?? now)
      .all<CycleRow>();

    const cycles = new Map<
      number,
      {
        cycleStartAt: number;
        cycleEndAt: number;
        meters: Record<string, number>;
        lastAggregatedAt: number | null;
      }
    >();

    for (const row of rows.results ?? []) {
      const cycle = cycles.get(row.cycle_start_at_ms) ?? {
        cycleStartAt: row.cycle_start_at_ms,
        cycleEndAt: row.cycle_end_at_ms,
        meters: {},
        lastAggregatedAt: null,
      };

      cycle.meters[row.meter_key] = row.total_quantity;
      cycle.lastAggregatedAt = Math.max(
        cycle.lastAggregatedAt ?? 0,
        row.last_aggregated_at_ms ?? 0,
      );
      cycles.set(row.cycle_start_at_ms, cycle);
    }

    return Array.from(cycles.values());
  }

  /**
   * Recent metered activity for one restaurant, newest first.
   *
   * Reads both metering tables. Since #333 the per-request counters live in
   * `usage_meter_buckets` (one row per restaurant, meter and hour) while
   * `usage_events` still holds the daily `storage.bytes` gauge snapshots, so a
   * list that read only one of them would show half the picture — and for a
   * restaurant that never uploads an image, none of it.
   *
   * A bucket maps onto the same four things the admin usage table renders:
   * the hour it covers is its time, `folded_at_ms` is its pending/aggregated
   * status, and its quantity is the sum of that hour's calls. Its synthetic
   * `id` is the natural key, which is stable across pages.
   *
   * `unionAll` rather than two reads merged in memory: it keeps LIMIT/OFFSET
   * honest at any page instead of needing a window big enough to cover the
   * offset.
   */
  async listUsageEvents(restaurantId: string, filters: UsageEventFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = (page - 1) * limit;

    const eventWhere = and(
      eq(usageEvents.restaurantId, restaurantId),
      ...(filters.meterKey ? [eq(usageEvents.meterKey, filters.meterKey)] : []),
      ...(filters.from === undefined
        ? []
        : [gte(usageEvents.occurredAt, new Date(filters.from))]),
      ...(filters.to === undefined
        ? []
        : [lte(usageEvents.occurredAt, new Date(filters.to))]),
    );
    const bucketWhere = and(
      eq(usageMeterBuckets.restaurantId, restaurantId),
      ...(filters.meterKey
        ? [eq(usageMeterBuckets.meterKey, filters.meterKey)]
        : []),
      ...(filters.from === undefined
        ? []
        : [gte(usageMeterBuckets.bucketStartAt, new Date(filters.from))]),
      ...(filters.to === undefined
        ? []
        : [lte(usageMeterBuckets.bucketStartAt, new Date(filters.to))]),
    );

    const [eventCount, bucketCount] = await Promise.all([
      this.orm
        .select({ total: sql<number>`COUNT(*)` })
        .from(usageEvents)
        .where(eventWhere),
      this.orm
        .select({ total: sql<number>`COUNT(*)` })
        .from(usageMeterBuckets)
        .where(bucketWhere),
    ]);

    // Aliased on both sides and ordered by the alias: a compound SELECT can
    // only be ordered by an output column name, never by a table-qualified
    // one.
    const eventRows = this.orm
      .select({
        id: sql<string>`${usageEvents.id}`.as("id"),
        meterKey: sql<MeterKey>`${usageEvents.meterKey}`.as("meter_key"),
        quantity: sql<number>`${usageEvents.quantity}`.as("quantity"),
        metadata: sql<string | null>`${usageEvents.metadata}`.as("metadata"),
        aggregatedAtMs: sql<number | null>`${usageEvents.aggregatedAt}`.as(
          "aggregated_at_ms",
        ),
        occurredAtMs: sql<number>`${usageEvents.occurredAt}`.as(
          "occurred_at_ms",
        ),
      })
      .from(usageEvents)
      .where(eventWhere);

    const bucketRows = this.orm
      .select({
        id: sql<string>`'bucket:' || ${usageMeterBuckets.meterKey} || ':' || ${usageMeterBuckets.bucketStartAt}`.as(
          "id",
        ),
        meterKey: sql<MeterKey>`${usageMeterBuckets.meterKey}`.as("meter_key"),
        quantity: sql<number>`${usageMeterBuckets.quantity}`.as("quantity"),
        metadata: sql<string | null>`NULL`.as("metadata"),
        aggregatedAtMs: sql<number | null>`${usageMeterBuckets.foldedAt}`.as(
          "aggregated_at_ms",
        ),
        occurredAtMs: sql<number>`${usageMeterBuckets.bucketStartAt}`.as(
          "occurred_at_ms",
        ),
      })
      .from(usageMeterBuckets)
      .where(bucketWhere);

    const rows = await unionAll(eventRows, bucketRows)
      .orderBy(sql`occurred_at_ms DESC`)
      .limit(limit)
      .offset(offset);

    return {
      page,
      limit,
      total:
        Number(eventCount[0]?.total ?? 0) + Number(bucketCount[0]?.total ?? 0),
      events: rows.map((row) => ({
        id: row.id,
        restaurantId,
        meterKey: row.meterKey,
        quantity: Number(row.quantity),
        metadata: this.parseMetadata(row.metadata),
        aggregatedAt:
          row.aggregatedAtMs === null ? null : Number(row.aggregatedAtMs),
        occurredAt: Number(row.occurredAtMs),
      })),
    };
  }

  async emitStorageSnapshots(now = Date.now()) {
    const rows = await this.db
      .prepare(
        `SELECT restaurant_id, r2_bytes, images_count
           FROM storage_counters
          WHERE r2_bytes > 0 OR images_count > 0`,
      )
      .all<{
        restaurant_id: string;
        r2_bytes: number;
        images_count: number;
      }>();

    let emitted = 0;
    for (const row of rows.results ?? []) {
      await this.db
        .prepare(
          `INSERT INTO usage_events
             (id, restaurant_id, meter_key, quantity, metadata, occurred_at_ms)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          generateUUID(),
          row.restaurant_id,
          METER_KEYS.STORAGE_BYTES,
          row.r2_bytes,
          JSON.stringify({ imagesCount: row.images_count, source: "snapshot" }),
          now,
        )
        .run();
      emitted++;
    }

    return { emitted };
  }

  private async getSubscription(
    restaurantId: string,
  ): Promise<SubscriptionRow | null> {
    return await this.db
      .prepare(
        `SELECT plan_tier, trial_ends_at_ms, billing_cycle_start_at_ms,
                billing_cycle_end_at_ms, created_at_ms
           FROM shop_subscriptions
          WHERE restaurant_id = ?
          LIMIT 1`,
      )
      .bind(restaurantId)
      .first<SubscriptionRow>();
  }

  private async getMeterTotals(
    restaurantId: string,
    cycleStartAt: number,
    cycleEndAt: number,
  ) {
    const rows = await this.db
      .prepare(
        `SELECT meter_key, total_quantity
           FROM usage_meters
          WHERE restaurant_id = ?
            AND cycle_start_at_ms = ?
            AND cycle_end_at_ms = ?`,
      )
      .bind(restaurantId, cycleStartAt, cycleEndAt)
      .all<UsageMeterRow>();

    return new Map(
      (rows.results ?? []).map((row) => [row.meter_key, row.total_quantity]),
    );
  }

  private async getPendingTotals(
    restaurantId: string,
    cycleStartAt: number,
    cycleEndAt: number,
  ) {
    const rows = await this.db
      .prepare(
        `SELECT meter_key, COALESCE(SUM(quantity), 0) AS total_quantity
           FROM usage_events
          WHERE restaurant_id = ?
            AND aggregated_at_ms IS NULL
            AND occurred_at_ms >= ?
            AND occurred_at_ms < ?
          GROUP BY meter_key`,
      )
      .bind(restaurantId, cycleStartAt, cycleEndAt)
      .all<UsageMeterRow>();

    return new Map(
      (rows.results ?? []).map((row) => [row.meter_key, row.total_quantity]),
    );
  }

  private resolveCycle(subscription: SubscriptionRow, now: number) {
    if (
      subscription.plan_tier !== "trial" &&
      subscription.billing_cycle_start_at_ms !== null &&
      subscription.billing_cycle_end_at_ms !== null
    ) {
      return {
        startAt: subscription.billing_cycle_start_at_ms,
        endAt: subscription.billing_cycle_end_at_ms,
      };
    }

    if (subscription.plan_tier === "trial") {
      return {
        startAt: subscription.created_at_ms,
        endAt:
          subscription.trial_ends_at_ms ??
          subscription.created_at_ms + 14 * DAY_MS,
      };
    }

    return this.fallbackMonthlyCycle(now);
  }

  private fallbackMonthlyCycle(now: number) {
    const date = new Date(now);
    return {
      startAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
      endAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    };
  }

  private parseMetadata(value: UsageEventRow["metadata"]) {
    if (typeof value !== "string") return value ?? {};
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
