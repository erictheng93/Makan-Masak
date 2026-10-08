-- qr_codes.restaurant_id / created_by were added to the Drizzle schema
-- (commit 19cc2cbc3) without a migration, so every Drizzle insert into
-- qr_codes failed with "no column named restaurant_id" and the tenant check on
-- download had nothing to compare against.
--
-- ADD COLUMN keeps a STRICT table STRICT and does not recreate it, which is
-- what lets the same file run against production's non-STRICT qr_codes.
-- Existing rows stay NULL: nothing in content/metadata_json records the owning
-- restaurant, and a NULL restaurant_id fails closed for non-admin callers
-- (QrCodesService.assertRestaurantAccess).
--
-- qr_templates is deliberately untouched: templates are scoped by created_by.
ALTER TABLE `qr_codes` ADD COLUMN `restaurant_id` text;
--> statement-breakpoint
ALTER TABLE `qr_codes` ADD COLUMN `created_by` text;
--> statement-breakpoint
CREATE INDEX `qr_codes_restaurant_id_idx` ON `qr_codes` (`restaurant_id`);
--> statement-breakpoint
CREATE TRIGGER `qr_codes_restaurant_guard_bi`
BEFORE INSERT ON `qr_codes`
FOR EACH ROW
WHEN NEW.`restaurant_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `restaurants` WHERE `id` = NEW.`restaurant_id`)
BEGIN
  SELECT RAISE(ABORT, 'qr_codes.restaurant_id references missing restaurants.id');
END;
--> statement-breakpoint
CREATE TRIGGER `qr_codes_restaurant_guard_bu`
BEFORE UPDATE OF `restaurant_id` ON `qr_codes`
FOR EACH ROW
WHEN NEW.`restaurant_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `restaurants` WHERE `id` = NEW.`restaurant_id`)
BEGIN
  SELECT RAISE(ABORT, 'qr_codes.restaurant_id references missing restaurants.id');
END;
