import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { restaurants } from "./restaurants";
import type { MeterKey } from "./usage-events";

/**
 * Width of one metering bucket. One hour is the coarsest window that still
 * lets the aggregator resolve a bucket into the right billing cycle without
 * splitting it: every cycle boundary this system produces (subscription
 * anniversary, trial start, calendar month) lands on a whole hour.
 */
export const USAGE_BUCKET_MS = 60 * 60 * 1000;

/**
 * Pre-aggregated usage counters, one row per (restaurant, meter, hour).
 *
 * `usage_events` records one row per metered call, which for `api.requests`
 * means one D1 row per API request — plus its index entries, plus the
 * aggregator's UPDATE, plus the TTL DELETE: about nine billable row-writes over
 * the life of a single request (#333). This table replaces that with an upsert
 * that increments an existing counter, so a whole hour of one tenant's traffic
 * on one meter costs one INSERT and then N single-row UPDATEs that move no
 * index entry at all — 1 row-write per request instead of 9, against a table
 * that grows by one row per restaurant-meter-hour rather than per request.
 *
 * Deliberate shape notes:
 *
 *  - The primary key IS the conflict target. `PRIMARY KEY (restaurant_id,
 *    meter_key, bucket_start_ms)` gives SQLite an automatic unique index on
 *    exactly the three columns the hot-path `ON CONFLICT` names, so there is no
 *    separate `CREATE UNIQUE INDEX` to maintain (adding one would duplicate the
 *    autoindex and cost a second write per bucket creation). There is also no
 *    surrogate `id`: the natural key is complete, and generating a UUID per
 *    request is work the hot path does not need.
 *
 *  - Nothing indexes `quantity` or `updated_at_ms`. SQLite only rewrites index
 *    entries when an indexed column — or a column named in a partial index's
 *    WHERE clause — appears in the SET list, so the incrementing UPDATE that
 *    runs on all but the first request of each hour writes the table page and
 *    nothing else.
 *
 *  - The two partial indexes mirror `usage_events`: the fold sweep reads only
 *    unfolded buckets and the TTL sweep reads only folded ones, so each gets an
 *    index covering exactly its half and neither has to scan the other's.
 */
export const usageMeterBuckets = sqliteTable(
  "usage_meter_buckets",
  {
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id),
    meterKey: text("meter_key").$type<MeterKey>().notNull(),
    /** Start of the hour this counter covers, Unix ms, always a multiple of USAGE_BUCKET_MS. */
    bucketStartAt: integer("bucket_start_ms", {
      mode: "timestamp_ms",
    }).notNull(),
    quantity: integer("quantity").notNull(),
    /**
     * Set when the bucket has been folded into `usage_meters`. NULL means the
     * quantity is still only counted here, which is why the quota gate and the
     * current-usage read both have to add unfolded buckets to the meter total.
     */
    foldedAt: integer("folded_at_ms", { mode: "timestamp_ms" }),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.restaurantId, table.meterKey, table.bucketStartAt],
    }),
    pendingFoldIdx: index("usage_meter_buckets_pending_idx")
      .on(table.bucketStartAt)
      .where(sql`${table.foldedAt} IS NULL`),
    ttlSweepIdx: index("usage_meter_buckets_ttl_idx")
      .on(table.bucketStartAt)
      .where(sql`${table.foldedAt} IS NOT NULL`),
  }),
);

export const usageMeterBucketsRelations = relations(
  usageMeterBuckets,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [usageMeterBuckets.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

/** Floor a timestamp to the start of the hour bucket that contains it. */
export function usageBucketStartFor(timestampMs: number): number {
  return Math.floor(timestampMs / USAGE_BUCKET_MS) * USAGE_BUCKET_MS;
}
