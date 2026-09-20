-- #382: a guest identity is not a users.id foreign key. Store a one-way hash
-- of the existing device lock identity; never store the bearer token.
ALTER TABLE coupon_usage ADD COLUMN guest_identity TEXT;

CREATE INDEX idx_coupon_usage_guest_identity
ON coupon_usage(coupon_id, guest_identity)
WHERE guest_identity IS NOT NULL AND status = 'active';

-- Executed inside the same D1 batch as the order, items and usage row.
-- RAISE(ABORT) rolls that batch back if another request took the last use.
CREATE TRIGGER coupon_usage_guest_limit
BEFORE INSERT ON coupon_usage
WHEN NEW.guest_identity IS NOT NULL AND NEW.status = 'active'
BEGIN
  SELECT RAISE(ABORT, 'COUPON_GUEST_LIMIT_REACHED')
  WHERE (
    SELECT count(*) FROM coupon_usage
    WHERE coupon_id = NEW.coupon_id
      AND guest_identity = NEW.guest_identity
      AND status = 'active'
  ) >= (
    SELECT usage_limit_per_user FROM coupons WHERE id = NEW.coupon_id
  );
END;
