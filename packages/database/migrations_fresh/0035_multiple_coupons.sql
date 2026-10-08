ALTER TABLE coupons ADD COLUMN incompatible_coupon_ids TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN applied_coupons TEXT;
