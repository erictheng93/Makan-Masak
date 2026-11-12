-- Write-heavy short-lived state (guest order tokens, active-order locks,
-- rate-limit counters) moves from Workers KV to D1: KV allows 1,000 writes a
-- day on the Free plan, D1 allows 100,000 rows. New table, so it ships STRICT.
-- Apply before deploying the API that reads it.
CREATE TABLE `ephemeral_kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at_ms` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `ephemeral_kv_expires_idx` ON `ephemeral_kv` (`expires_at_ms`);
