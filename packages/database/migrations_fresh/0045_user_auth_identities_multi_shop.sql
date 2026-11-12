-- One Google / LINE account may now be linked to several shop-owner accounts
-- (one per shop), and sign-in asks which shop. Only the uniqueness of the
-- provider account is lifted; a user still has at most one live identity per
-- provider (user_auth_identities_live_user_provider_idx), which also stops the
-- same account being linked twice to the same user.
DROP INDEX IF EXISTS `user_auth_identities_live_provider_uid_idx`;
--> statement-breakpoint
CREATE INDEX `user_auth_identities_live_provider_uid_idx`
	ON `user_auth_identities` (`provider`, `provider_uid`) WHERE `revoked_at_ms` IS NULL;
