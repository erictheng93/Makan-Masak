-- A market checkout holds its per-user voucher claim before payment so the
-- per-user limit is enforced atomically across concurrent checkouts. That
-- hold used to be written as status 'active', which every coupon report sums
-- as a redemption — so an unpaid or abandoned checkout read as a used coupon.
-- The hold now has its own status, 'reserved': reports keep reading 'active'
-- (paid), while the limit counts both.
--
-- Only the trigger and a partial index change; no table is recreated, so the
-- same file runs against production's non-STRICT coupon_usage. Existing rows
-- are untouched: none of them is 'reserved' yet.
DROP TRIGGER IF EXISTS `coupon_usage_guest_limit`;
--> statement-breakpoint
CREATE TRIGGER `coupon_usage_guest_limit`
BEFORE INSERT ON `coupon_usage`
WHEN NEW.guest_identity IS NOT NULL AND NEW.status IN ('active', 'reserved')
BEGIN
  SELECT RAISE(ABORT, 'COUPON_GUEST_LIMIT_REACHED')
  WHERE (
    SELECT count(*) FROM coupon_usage
    WHERE coupon_id = NEW.coupon_id
      AND guest_identity = NEW.guest_identity
      AND status IN ('active', 'reserved')
  ) >= (
    SELECT usage_limit_per_user FROM coupons WHERE id = NEW.coupon_id
  );
END;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_coupon_usage_guest_identity`;
--> statement-breakpoint
CREATE INDEX `idx_coupon_usage_guest_identity`
ON `coupon_usage` (`coupon_id`, `guest_identity`)
WHERE `guest_identity` IS NOT NULL AND `status` IN ('active', 'reserved');
