-- 地區政策：國家層（scope_type = 'country'，scope_id = 'TW'／'MY'）與
-- 市集層（scope_type = 'market'，scope_id = markets.id）。店家層不在這裡，
-- 沿用 shop_subscriptions.module_overrides 與 restaurants.settings。
-- value 是 JSON，合法性由 packages/database/src/utils/region-policies.ts
-- 的登記表把關。新表，舊程式不會碰：表是空的時候系統行為不變。
CREATE TABLE `policies` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `scope_type` TEXT NOT NULL CHECK (`scope_type` IN ('country', 'market')),
  `scope_id` TEXT NOT NULL,
  `policy_key` TEXT NOT NULL,
  `value` TEXT NOT NULL,
  `updated_by` TEXT,
  `created_at_ms` INTEGER NOT NULL,
  `updated_at_ms` INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `policies_scope_key_idx`
  ON `policies` (`scope_type`, `scope_id`, `policy_key`);
