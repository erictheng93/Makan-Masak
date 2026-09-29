-- 商圈攤位「今日開店」（spec: docs/superpowers/specs/2026-09-28-market-vendor-daily-open-design.md）
--
-- opened_at_ms：最後一次按「開店」的時間；收攤設回 NULL。「今日已開店」由它
-- 與攤位時區＋商圈換日時間算出，所以不需要每日重置的排程。
-- business_day_cutoff_minutes：商圈的營業日從當地幾點起算，預設 05:00，
-- 讓營業到凌晨的夜市攤位不會在午夜消失。
--
-- 兩個 ALTER TABLE ... ADD COLUMN 都不改變表的 STRICT 屬性，不必重建。
ALTER TABLE `restaurant_market_memberships` ADD COLUMN `opened_at_ms` INTEGER;
ALTER TABLE `markets` ADD COLUMN `business_day_cutoff_minutes` INTEGER DEFAULT 300 NOT NULL
  CHECK (`business_day_cutoff_minutes` BETWEEN 0 AND 1439);

-- 每次開店／收攤一筆，報表由它計算。business_date 在事件發生時算好存下，
-- 事後修改換日時間不會改寫歷史。
CREATE TABLE `market_vendor_open_events` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `market_id` TEXT NOT NULL REFERENCES `markets`(`id`) ON DELETE CASCADE,
  `restaurant_id` TEXT NOT NULL REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
  `action` TEXT NOT NULL CHECK (`action` IN ('open', 'close')),
  `business_date` TEXT NOT NULL,
  `occurred_at_ms` INTEGER NOT NULL,
  `actor_user_id` TEXT
) STRICT;
CREATE INDEX `market_vendor_open_events_market_date_idx`
  ON `market_vendor_open_events` (`market_id`, `business_date`);
CREATE INDEX `market_vendor_open_events_restaurant_date_idx`
  ON `market_vendor_open_events` (`restaurant_id`, `business_date`);
