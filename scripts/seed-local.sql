-- Local development seed data.
--
-- DEV ONLY: this file creates known accounts with documented demo passwords.
-- It is intentionally used by the local-only `db:seed:local` script.

INSERT OR IGNORE INTO restaurants (
  id,
  name,
  type,
  category,
  description,
  address,
  district,
  city,
  phone,
  email,
  settings,
  is_available,
  is_active,
  created_at_ms,
  updated_at_ms
) VALUES (
  '019469a0-0099-7000-8000-000000000099',
  'MakanMasak Demo Restaurant',
  'demo',
  'general',
  'Local development restaurant for manual testing',
  '123 Food Street',
  'Demo District',
  'Taichung',
  '+886900000000',
  'demo@makanmakan.local',
  '{"currency":"TWD","language":"zh-Hant","allowGuestOrders":true}',
  1,
  1,
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

INSERT OR IGNORE INTO users (
  id,
  username,
  password_hash,
  email,
  full_name,
  role,
  restaurant_id,
  is_active,
  is_verified,
  token_version,
  created_at_ms,
  updated_at_ms
) VALUES
  (
    '019469a1-0000-7000-8000-000000000001',
    'admin',
    '$2a$10$ERWg3wj4FrhL7ugtGMwflO7.uAcGpec9e.gRRV3.Nxcqr.EcVEEP2',
    'admin@makanmakan.local',
    'System Administrator',
    0,
    NULL,
    1,
    1,
    1,
    unixepoch('now') * 1000,
    unixepoch('now') * 1000
  ),
  (
    '019469a1-0001-7000-8000-000000000002',
    'owner1',
    '$2a$10$WkTTAnK2XuDaViXuuTUJRewW8dy5J3s3MaOC2gukyJx3.9Hf43JM6',
    'owner1@makanmakan.local',
    'Restaurant Owner',
    1,
    '019469a0-0099-7000-8000-000000000099',
    1,
    1,
    1,
    unixepoch('now') * 1000,
    unixepoch('now') * 1000
  ),
  (
    '019469a1-0002-7000-8000-000000000003',
    'chef1',
    '$2a$10$QhUvaTv8W79f9YWZFYcXR.GerC0AKNiq.lu1oFgOtxh4Nk0sKadM2',
    'chef1@makanmakan.local',
    'Demo Chef',
    2,
    '019469a0-0099-7000-8000-000000000099',
    1,
    1,
    1,
    unixepoch('now') * 1000,
    unixepoch('now') * 1000
  ),
  (
    '019469a1-0003-7000-8000-000000000004',
    'service1',
    '$2a$10$aO4Gn7RUDvQPBmVYXEBMQeT1uPQ2uKK.pqUov/o6F5qqRgQCbiNce',
    'service1@makanmakan.local',
    'Demo Service Crew',
    3,
    '019469a0-0099-7000-8000-000000000099',
    1,
    1,
    1,
    unixepoch('now') * 1000,
    unixepoch('now') * 1000
  ),
  (
    '019469a1-0004-7000-8000-000000000005',
    'cashier1',
    '$2a$10$GTrbGIj8V0ZAdeNz/4ZBNulVCsIYuvSSGnLQxoCqrWwIJ3wWSjrm2',
    'cashier1@makanmakan.local',
    'Demo Cashier',
    4,
    '019469a0-0099-7000-8000-000000000099',
    1,
    1,
    1,
    unixepoch('now') * 1000,
    unixepoch('now') * 1000
  );

INSERT OR IGNORE INTO shop_subscriptions (
  id,
  restaurant_id,
  plan_tier,
  module_overrides,
  is_active,
  trial_ends_at_ms,
  billing_cycle_start_at_ms,
  billing_cycle_end_at_ms,
  notes,
  created_at_ms,
  updated_at_ms
) VALUES (
  '019469a2-0000-7000-8000-000000000003',
  '019469a0-0099-7000-8000-000000000099',
  'trial',
  '{"online_ordering":true,"analytics":true,"menu_management":true,"table_management":true,"staff_management":true,"pos":true,"kitchen_display":true}',
  1,
  (unixepoch('now') * 1000) + (30 * 24 * 60 * 60 * 1000),
  unixepoch('now') * 1000,
  (unixepoch('now') * 1000) + (30 * 24 * 60 * 60 * 1000),
  'local demo subscription for owner1',
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

UPDATE shop_subscriptions
SET
  plan_tier = 'trial',
  module_overrides = '{"online_ordering":true,"analytics":true,"menu_management":true,"table_management":true,"staff_management":true,"pos":true,"kitchen_display":true}',
  is_active = 1,
  trial_ends_at_ms = (unixepoch('now') * 1000) + (30 * 24 * 60 * 60 * 1000),
  billing_cycle_start_at_ms = COALESCE(
    billing_cycle_start_at_ms,
    unixepoch('now') * 1000
  ),
  billing_cycle_end_at_ms = (unixepoch('now') * 1000) + (30 * 24 * 60 * 60 * 1000),
  notes = 'local demo subscription for owner1',
  updated_at_ms = unixepoch('now') * 1000
WHERE restaurant_id = '019469a0-0099-7000-8000-000000000099';

UPDATE users
SET
  password_hash = CASE
    WHEN username = 'admin'
      THEN '$2a$10$ERWg3wj4FrhL7ugtGMwflO7.uAcGpec9e.gRRV3.Nxcqr.EcVEEP2'
    WHEN username = 'owner1'
      THEN '$2a$10$WkTTAnK2XuDaViXuuTUJRewW8dy5J3s3MaOC2gukyJx3.9Hf43JM6'
    WHEN username = 'chef1'
      THEN '$2a$10$QhUvaTv8W79f9YWZFYcXR.GerC0AKNiq.lu1oFgOtxh4Nk0sKadM2'
    WHEN username = 'service1'
      THEN '$2a$10$aO4Gn7RUDvQPBmVYXEBMQeT1uPQ2uKK.pqUov/o6F5qqRgQCbiNce'
    WHEN username = 'cashier1'
      THEN '$2a$10$GTrbGIj8V0ZAdeNz/4ZBNulVCsIYuvSSGnLQxoCqrWwIJ3wWSjrm2'
    ELSE password_hash
  END,
  is_active = 1,
  is_verified = 1,
  updated_at_ms = unixepoch('now') * 1000
WHERE username IN ('admin', 'owner1', 'chef1', 'service1', 'cashier1');
