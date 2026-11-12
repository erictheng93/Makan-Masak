-- Google / LINE sign-in for shop owners (link-only). New table, so it ships
-- STRICT. Provider tokens are not stored; provider_email is a display snapshot.
-- Apply before deploying the API that reads it.
CREATE TABLE `user_auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_uid` text NOT NULL,
	`provider_email` text,
	`provider_email_verified` integer,
	`provider_display_name` text,
	`provider_avatar_url` text,
	`revoked_at_ms` integer,
	`verified_at_ms` integer,
	`last_used_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `user_auth_identities_live_provider_uid_idx`
	ON `user_auth_identities` (`provider`, `provider_uid`) WHERE `revoked_at_ms` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `user_auth_identities_live_user_provider_idx`
	ON `user_auth_identities` (`user_id`, `provider`) WHERE `revoked_at_ms` IS NULL;
--> statement-breakpoint
CREATE INDEX `user_auth_identities_user_idx` ON `user_auth_identities` (`user_id`);
--> statement-breakpoint
-- NULL until a real password is written. Onboarding inserts an unusable random
-- hash, so the hash column alone cannot say whether a password sign-in exists.
ALTER TABLE `users` ADD COLUMN `password_set_at_ms` integer;
--> statement-breakpoint
-- Anyone who has signed in so far did so with a password (OAuth did not exist),
-- so a recorded login proves a usable one. Accounts that never logged in stay
-- NULL: their hash may still be the unusable onboarding placeholder.
UPDATE `users` SET `password_set_at_ms` = `last_login_at_ms` WHERE `last_login_at_ms` IS NOT NULL;
