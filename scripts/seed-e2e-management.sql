-- E2E fixture for the management D1. DEV / CI ONLY. Run by db:seed:local:e2e.
--
-- scripts/seed-local.sql creates the demo restaurant in the platform D1 only,
-- so it has no management tenant and POST /users refuses to bind an owner to it
-- (TENANT_NOT_FOUND). Onboarding cannot supply one either: approval links an
-- owner, and a second owner is OWNER_LINK_CONFLICT. The account-management
-- workflow needs exactly this state, a tenant with no owner.
--
-- That workflow links its owner here and nothing unlinks it, so a second run
-- against the same database gets the conflict. db:reset:local clears it.
INSERT OR IGNORE INTO tenants (
  id,
  business_name,
  contact_email,
  subdomain,
  license_key,
  status,
  platform_restaurant_id
) VALUES (
  'e2e-demo-tenant',
  'MakanMasak Demo Restaurant',
  'demo-tenant@example.com',
  'e2e-demo',
  'E2E-DEMO-LICENSE',
  'active',
  '019469a0-0099-7000-8000-000000000099'
);
