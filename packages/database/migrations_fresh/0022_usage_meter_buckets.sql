-- usage_meter_buckets: hourly pre-aggregated metering counters (#333).
--
-- Why: `api.requests` metering wrote one `usage_events` row per API request,
-- and D1 bills rows written including the index entries each write moves. One
-- request therefore cost about nine row-writes over the life of its row:
--
--   INSERT            table + restaurant/meter/time index + pending index  = 3
--   aggregator UPDATE table + leave the pending index + enter the TTL index = 3
--   90-day TTL DELETE table + both indexes it is still in                   = 3
--
-- At the reference load in #333 — 50 pro tenants at the 1,000,000
-- requests/cycle hard limit, so 50M metered requests a month — that is roughly
-- 450M billable row-writes a month for data billing only ever reads as a SUM.
--
-- After: one row per (restaurant, meter, hour). The first request of an hour
-- inserts it (table + primary-key autoindex + pending index = 3 row-writes);
-- every later request in that hour is an `ON CONFLICT DO UPDATE` that adds to
-- `quantity` and moves no index entry at all, because nothing indexes
-- `quantity` or `updated_at_ms` (SQLite rewrites an index entry only when an
-- indexed column, or a column named in a partial index's WHERE clause, is in
-- the SET list) — 1 row-write per request instead of 9. The fold and the TTL
-- delete still cost about 6 more, but once per bucket rather than once per
-- request. The same 50-tenant month becomes ~52M row-writes (50M increments
-- plus ~1.6M for the 182,500 buckets 50 tenants x 5 meters x 730 hours
-- produce): an ~88% reduction, and it no longer grows a 90-day table by one
-- row per request.
--
-- Shape notes:
--
--   * The PRIMARY KEY is the conflict target. SQLite builds an automatic
--     unique index for `PRIMARY KEY (restaurant_id, meter_key,
--     bucket_start_ms)` in a rowid table, which is exactly the unique index
--     the hot-path `ON CONFLICT (restaurant_id, meter_key, bucket_start_ms)`
--     needs to resolve against. A separate `CREATE UNIQUE INDEX` on the same
--     three columns would be a duplicate of that autoindex and would cost a
--     second index write every time a bucket is created.
--
--   * No surrogate `id`. The natural key is complete, and minting a UUID per
--     metered request is work the hot path does not need to do.
--
--   * The two partial indexes split the table the way its two sweeps read it:
--     the hourly fold only ever asks for unfolded buckets, the nightly TTL
--     sweep only ever asks for folded ones. Giving each sweep a partial index
--     over exactly its half keeps neither of them scanning the other's rows —
--     the same reasoning behind `usage_events_ttl_idx`.
--
--   * `quantity` has no DEFAULT: every writer supplies it, and a silent 0
--     would turn a bad insert into a lost count rather than an error.
CREATE TABLE usage_meter_buckets (
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  meter_key TEXT NOT NULL,
  bucket_start_ms INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  folded_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  PRIMARY KEY (restaurant_id, meter_key, bucket_start_ms)
) STRICT;
--> statement-breakpoint
CREATE INDEX usage_meter_buckets_pending_idx
  ON usage_meter_buckets (bucket_start_ms)
  WHERE folded_at_ms IS NULL;
--> statement-breakpoint
CREATE INDEX usage_meter_buckets_ttl_idx
  ON usage_meter_buckets (bucket_start_ms)
  WHERE folded_at_ms IS NOT NULL;
