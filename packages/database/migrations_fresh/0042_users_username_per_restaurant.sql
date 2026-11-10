-- Staff usernames become unique per restaurant instead of platform-wide.
-- Platform admins (restaurant_id NULL) stay unique among themselves.
-- Index-only: no table recreate, so users' STRICT/non-STRICT state is untouched.
-- Ships after 0041 and after the code that tolerates either index set.
DROP INDEX IF EXISTS `users_username_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_restaurant_username_unique` ON `users` (`restaurant_id`, `username`) WHERE `restaurant_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_platform_username_unique` ON `users` (`username`) WHERE `restaurant_id` IS NULL;
--> statement-breakpoint
-- The two partial indexes cannot serve a bare `WHERE username = ?` (the login
-- lookup without a shop code), so keep a plain lookup index in place of the
-- dropped platform-wide one.
CREATE INDEX `users_username_idx` ON `users` (`username`);
