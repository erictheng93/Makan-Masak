-- Owner self-service plan changes: a downgrade is scheduled for the end of the
-- current cycle rather than applied on the spot, so the subscription has to
-- remember it until the daily billing cron (or the owner's next visit to the
-- plan page) applies it.
--
-- pending_plan_tier: the tier the shop moves to; NULL = nothing scheduled.
-- pending_effective_at_ms: when it takes effect (end of the current cycle).
-- pending_requested_by: users.id of the owner/admin who asked for it.
-- pending_requested_at_ms: when they asked; also the optimistic-concurrency
--   token a cancel or the applier guards its UPDATE on.
--
-- All nullable, no default, no backfill: every existing row has nothing
-- pending. ALTER TABLE ADD COLUMN keeps a STRICT table STRICT; no recreation.
ALTER TABLE `shop_subscriptions` ADD COLUMN `pending_plan_tier` TEXT;
--> statement-breakpoint
ALTER TABLE `shop_subscriptions` ADD COLUMN `pending_effective_at_ms` INTEGER;
--> statement-breakpoint
ALTER TABLE `shop_subscriptions` ADD COLUMN `pending_requested_by` TEXT;
--> statement-breakpoint
ALTER TABLE `shop_subscriptions` ADD COLUMN `pending_requested_at_ms` INTEGER;
--> statement-breakpoint
-- The cron's "which changes are due" scan. Partial: almost every row has
-- nothing pending, so the index stays as small as the work it finds.
CREATE INDEX `idx_shop_subscriptions_pending_due`
  ON `shop_subscriptions` (`pending_effective_at_ms`)
  WHERE `pending_effective_at_ms` IS NOT NULL;
