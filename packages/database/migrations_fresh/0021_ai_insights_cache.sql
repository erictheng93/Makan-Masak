-- ai_insights_cache: the table AIInsightsService has always written to, and
-- which the live migration track never created.
--
-- `AIInsightsService.generateReport()` ends with an unconditional
-- `await this.cacheReport(report)` — no try/catch — so every AI report
-- generation threw `no such table: ai_insights_cache`. Confirmed absent from
-- makanmasak-prod on 2026-09-09, not just from a fresh local DB. The only
-- CREATE TABLE for it lived in packages/database/migrations/ and
-- migrations_v2/, neither of which any wrangler.toml reads.
--
-- Two deliberate departures from that dead DDL:
--   * STRICT, per the table policy for new tables.
--   * generated_at_ms / expires_at_ms are INTEGER Unix ms, not DATETIME. The
--     old shape stored ISO strings and the read compared them with
--     `expires_at > ?` — a lexicographic comparison standing in for a temporal
--     one, the same defect #271 removed from coupons. The service was changed
--     to write integers in the same commit.

CREATE TABLE ai_insights_cache (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  insight_type TEXT NOT NULL,
  time_range TEXT NOT NULL,
  data TEXT NOT NULL,
  confidence_score REAL,
  tokens_used INTEGER,
  latency_ms INTEGER,
  generated_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX ai_insights_cache_restaurant_idx
  ON ai_insights_cache(restaurant_id);

CREATE INDEX ai_insights_cache_expires_idx
  ON ai_insights_cache(expires_at_ms);

-- The service upserts on exactly this triple
-- (ON CONFLICT (restaurant_id, insight_type, time_range)), so the constraint
-- has to exist for the write to resolve rather than duplicate.
CREATE UNIQUE INDEX ai_insights_cache_lookup_unique
  ON ai_insights_cache(restaurant_id, insight_type, time_range);
