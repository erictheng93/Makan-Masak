-- Owner-facing operational alerts for issue #285.
--
-- OwnerView's emergency panel had a hardcoded empty list and its resolve /
-- escalate buttons posted to a `/alerts` prefix the API never mounted. This is
-- the table those endpoints read and write.
--
-- Scope note: `backup_alerts` covers backup-job health and the monitoring
-- feature covers system metric rules. Neither is a restaurant business event,
-- so neither is reused here.
CREATE TABLE `restaurant_alerts` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `restaurant_id` TEXT NOT NULL,
  `alert_type` TEXT NOT NULL,
  `severity` TEXT NOT NULL DEFAULT 'medium',
  `status` TEXT NOT NULL DEFAULT 'open',
  `title` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `details` TEXT,
  `dedupe_key` TEXT,
  `resolved_at_ms` INTEGER,
  `resolved_by` TEXT,
  `escalated_at_ms` INTEGER,
  `escalated_by` TEXT,
  `created_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  `updated_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
  CHECK (`status` IN ('open', 'resolved', 'escalated')),
  CHECK (`severity` IN ('critical', 'high', 'medium', 'low'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `restaurant_alerts_open_idx` ON `restaurant_alerts` (`restaurant_id`, `status`, `created_at_ms`);
--> statement-breakpoint
CREATE INDEX `restaurant_alerts_type_idx` ON `restaurant_alerts` (`restaurant_id`, `alert_type`);
--> statement-breakpoint
-- Producers that poll re-raise the same condition every tick. This collapses
-- repeats while the alert is open, and releases once it is resolved or
-- escalated so the same condition can raise again later.
CREATE UNIQUE INDEX `restaurant_alerts_dedupe_open_unique`
  ON `restaurant_alerts` (`restaurant_id`, `dedupe_key`)
  WHERE `dedupe_key` IS NOT NULL AND `status` = 'open';
--> statement-breakpoint
CREATE TRIGGER `restaurant_alerts_restaurant_guard_bi`
BEFORE INSERT ON `restaurant_alerts`
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM `restaurants` WHERE `id` = NEW.`restaurant_id`)
BEGIN
  SELECT RAISE(ABORT, 'restaurant_alerts.restaurant_id references missing restaurants.id');
END;
--> statement-breakpoint
CREATE TRIGGER `restaurant_alerts_restaurant_guard_bu`
BEFORE UPDATE OF `restaurant_id` ON `restaurant_alerts`
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM `restaurants` WHERE `id` = NEW.`restaurant_id`)
BEGIN
  SELECT RAISE(ABORT, 'restaurant_alerts.restaurant_id references missing restaurants.id');
END;
