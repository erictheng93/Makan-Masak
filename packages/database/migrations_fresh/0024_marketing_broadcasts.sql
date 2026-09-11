-- Marketing broadcast to followers (issue #335, 商圈 Phase 4).
--
-- Three tables:
--
--   * `customer_notification_preferences` — switches the recipient owns. Kept
--     apart from the pre-STRICT `customer_preferences` rather than widening it:
--     that table stores quiet hours as TEXT "HH:MM" that nothing evaluates, and
--     gaining STRICT there would mean recreating a legacy table inside the same
--     migration that first reads it.
--   * `marketing_broadcasts` — one row per send, and *also* the rate limiter.
--     The per-scope budget is counted from these rows, not from KV, so the
--     audit trail and the limiter cannot disagree.
--   * `marketing_broadcast_recipients` — one row per attempt, carrying the
--     `consent_id` that authorised it. `customer_consents` is append-only, so a
--     dispute is answered by joining to the exact row that applied at send
--     time rather than to whatever is newest today.
--
-- No deferred queue: a recipient inside their quiet window is recorded
-- `skipped_quiet_hours` and never sent. If that becomes unacceptable, the row
-- is the evidence of what was dropped.
CREATE TABLE `customer_notification_preferences` (
  `customer_id` TEXT PRIMARY KEY NOT NULL,
  -- 1 by default: absent row means "no objection recorded". It is the consent
  -- row, not this flag, that has to be affirmatively present before anything
  -- is sent, so defaulting this on cannot by itself reach anybody.
  `marketing_enabled` INTEGER NOT NULL DEFAULT 1,
  -- 1 by default: a send from a vendor reaches only its own followers unless
  -- the customer opts in to hearing from every vendor in the market.
  `followed_only` INTEGER NOT NULL DEFAULT 1,
  -- Minutes from midnight, 0-1439, evaluated in the timezone of the SENDER.
  -- NULL on either bound means no quiet window.
  `quiet_hours_start_min` INTEGER,
  `quiet_hours_end_min` INTEGER,
  `updated_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE,
  CHECK (`marketing_enabled` IN (0, 1)),
  CHECK (`followed_only` IN (0, 1)),
  CHECK (`quiet_hours_start_min` IS NULL
         OR (`quiet_hours_start_min` BETWEEN 0 AND 1439)),
  CHECK (`quiet_hours_end_min` IS NULL
         OR (`quiet_hours_end_min` BETWEEN 0 AND 1439))
) STRICT;
--> statement-breakpoint
CREATE TABLE `marketing_broadcasts` (
  `id` TEXT PRIMARY KEY NOT NULL,
  -- The rate-limit key, generic so one index counts both kinds of sender.
  `scope_type` TEXT NOT NULL,
  `scope_id` TEXT NOT NULL,
  -- The same identifier again as a typed FK, so a deleted restaurant or market
  -- takes its broadcasts with it. The CHECK below keeps the two in agreement.
  `restaurant_id` TEXT,
  `market_id` TEXT,
  `sent_by` TEXT,
  `title` TEXT NOT NULL,
  `body` TEXT NOT NULL,
  `url` TEXT,
  `audience_count` INTEGER NOT NULL DEFAULT 0,
  `delivered_count` INTEGER NOT NULL DEFAULT 0,
  `failed_count` INTEGER NOT NULL DEFAULT 0,
  `skipped_count` INTEGER NOT NULL DEFAULT 0,
  `created_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  -- NULL while fan-out is still running. The row is written before the first
  -- delivery so a crash mid-send still spends the budget of the sender.
  `completed_at_ms` INTEGER,
  FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CHECK (`scope_type` IN ('market', 'restaurant')),
  -- The API validates these too. This is the half that survives a raw
  -- `env.DB.prepare(...)` write.
  CHECK (length(`title`) BETWEEN 1 AND 80),
  CHECK (length(`body`) BETWEEN 1 AND 300),
  CHECK (
    (`scope_type` = 'restaurant'
       AND `restaurant_id` = `scope_id` AND `market_id` IS NULL)
    OR
    (`scope_type` = 'market'
       AND `market_id` = `scope_id` AND `restaurant_id` IS NULL)
  )
) STRICT;
--> statement-breakpoint
-- Serves both the rolling-window rate-limit count and the history list.
CREATE INDEX `marketing_broadcasts_scope_created_idx`
  ON `marketing_broadcasts` (`scope_type`, `scope_id`, `created_at_ms`);
--> statement-breakpoint
CREATE TABLE `marketing_broadcast_recipients` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `broadcast_id` TEXT NOT NULL,
  `customer_id` TEXT NOT NULL,
  -- NULL for both skipped statuses: a customer in their quiet window, or with
  -- no live subscription, is recorded once rather than once per device.
  `subscription_id` TEXT,
  -- The consent row honoured for this attempt. Set on every row this code
  -- writes; nullable only so deleting a consent cannot delete the audit.
  `consent_id` TEXT,
  `status` TEXT NOT NULL,
  `error_code` TEXT,
  `created_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (`broadcast_id`) REFERENCES `marketing_broadcasts`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`subscription_id`) REFERENCES `customer_push_subscriptions`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`consent_id`) REFERENCES `customer_consents`(`id`) ON DELETE SET NULL,
  CHECK (`status` IN ('delivered', 'failed', 'skipped_quiet_hours',
                      'skipped_no_subscription'))
) STRICT;
--> statement-breakpoint
-- One attempt per device per broadcast. SQLite treats NULLs as distinct, so
-- the skipped rows are unconstrained by this — several customers may be
-- skipped in one send.
--
-- This is also the `(broadcast_id)` index: the leading column of a composite
-- index is usable on its own, so a second single-column index would only
-- cost writes.
CREATE UNIQUE INDEX `marketing_broadcast_recipients_subscription_unique`
  ON `marketing_broadcast_recipients` (`broadcast_id`, `subscription_id`);
