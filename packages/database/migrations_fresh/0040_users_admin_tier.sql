-- Platform admins (role 0) are tiered. Only an `administrator` may manage
-- other platform admin accounts; an `operator` runs the platform; `support`
-- is read-only apart from resetting shop-account passwords. Every other role
-- leaves it NULL, and the API reads a role-0 NULL as `operator`.
--
-- ADD COLUMN with no default keeps users' table type (STRICT or not) and does
-- not recreate it. Admins that exist when this runs were all full-power until
-- now, so they keep that as `administrator`.
ALTER TABLE `users` ADD COLUMN `admin_tier` text CHECK (`admin_tier` IN ('administrator', 'operator', 'support'));
UPDATE `users` SET `admin_tier` = 'administrator' WHERE `role` = 0;
