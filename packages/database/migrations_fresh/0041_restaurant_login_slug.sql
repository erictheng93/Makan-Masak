-- Shop code used in staff login URLs (/s/{slug}). A public identifier, unique
-- among non-NULL values. ADD COLUMN keeps restaurants' table type (STRICT or
-- not) and does not recreate it.
ALTER TABLE `restaurants` ADD COLUMN `login_slug` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `restaurants_login_slug_unique` ON `restaurants` (`login_slug`) WHERE `login_slug` IS NOT NULL;
--> statement-breakpoint
UPDATE `restaurants` SET `login_slug` = 'demo' WHERE `id` = '01a0d2b6-61ba-744e-89f9-75f5296a8e11' AND `login_slug` IS NULL;
--> statement-breakpoint
UPDATE `restaurants` SET `login_slug` = 'shop-' || lower(substr(replace(`id`, '-', ''), -8)) WHERE `login_slug` IS NULL;
