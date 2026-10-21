-- coupons.used_count is the slot gate every coupon path checks against
-- usage_limit, and a market checkout takes its slot at reservation, before
-- payment. Reports summed used_count as uses, so unpaid and abandoned
-- checkouts read as redemptions. reserved_count tracks the slots still held
-- by unpaid reservations; paid uses = used_count - reserved_count.
--
-- ADD COLUMN with a constant default keeps coupons STRICT and does not
-- recreate it. Existing rows start at 0: reservations made before this
-- column existed are not flagged and only ever touch used_count.
ALTER TABLE `coupons` ADD COLUMN `reserved_count` integer NOT NULL DEFAULT 0;
