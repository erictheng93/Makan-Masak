-- E2E fixtures for the `integration` Playwright project. DEV / CI ONLY.
--
-- scripts/seed-local.sql seeds a restaurant and its staff, and nothing else.
-- tests/e2e/integration/real-workflows.spec.ts discovers what it needs from the
-- public API — a table id and an available menu item — so against that seed
-- alone every customer-facing test skips with "local discovery failed", and the
-- job reports green having exercised one reachability check.
--
-- Ids are fixed rather than autoincremented so the runner can pass
-- WORKFLOW_TABLE_ID / WORKFLOW_MENU_ITEM_ID instead of scraping them back out,
-- and they start at 9001 to stay clear of anything a test creates itself.
--
-- Two menu items, not one: the checkout flow adds a second item to assert the
-- cart holds both.
--
-- INSERT OR IGNORE throughout, so re-running against an already-seeded database
-- is a no-op rather than a UNIQUE violation.
--
-- Deliberately no `name_en`. The customer app prefers it when the browser
-- locale is English, which every CI browser is, while the spec asserts the
-- API's `name` is on screen — so an English name here fails the menu test on
-- a page that is rendering perfectly. (That mismatch is the spec's, not the
-- fixture's; leaving name_en unset simply avoids provoking it.)

INSERT OR IGNORE INTO categories (
  id,
  restaurant_id,
  name,
  description,
  sort_order,
  is_active,
  is_visible,
  created_at_ms,
  updated_at_ms
) VALUES (
  9001,
  '019469a0-0099-7000-8000-000000000099',
  'E2E 測試分類',
  'Fixture category for the nightly integration suite',
  0,
  1,
  1,
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

INSERT OR IGNORE INTO menu_items (
  id,
  restaurant_id,
  category_id,
  name,
  description,
  price_cents,
  is_available,
  sort_order,
  preparation_time,
  created_at_ms,
  updated_at_ms
) VALUES
  (
    9001,
    '019469a0-0099-7000-8000-000000000099',
    9001,
    'E2E 測試牛肉麵',
    'Fixture item for the nightly integration suite',
    18000,
    1,
    0,
    10,
    unixepoch('now') * 1000,
    unixepoch('now') * 1000
  ),
  (
    9002,
    '019469a0-0099-7000-8000-000000000099',
    9001,
    'E2E 測試珍珠奶茶',
    'Second fixture item — the checkout flow needs two',
    6000,
    1,
    1,
    5,
    unixepoch('now') * 1000,
    unixepoch('now') * 1000
  );

INSERT OR IGNORE INTO tables (
  id,
  restaurant_id,
  number,
  name,
  capacity,
  qr_code,
  is_active,
  is_occupied,
  created_at_ms,
  updated_at_ms
) VALUES (
  9001,
  '019469a0-0099-7000-8000-000000000099',
  'E2E-1',
  'E2E 測試桌',
  4,
  'TABLE-019469a0-0099-7000-8000-000000000099-9001',
  1,
  0,
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

-- The guest-order test posts `orderType: "shop"` (takeaway), which
-- POST /api/v1/guest-orders gates on the owner's shop-mode switch
-- (assertShopModeEnabled → 403 SHOP_MODE_DISABLED). seed-local.sql leaves it
-- off, so the test 403s before it can read anything back. No shop_qr_code is
-- set: assertShopQrCurrent only compares when the client sends one, and this
-- flow does not.
UPDATE restaurants
SET
  enable_shop_mode = 1,
  updated_at_ms = unixepoch('now') * 1000
WHERE id = '019469a0-0099-7000-8000-000000000099';

-- ---------------------------------------------------------------------------
-- Service booking and market checkout fixtures.
--
-- real-workflows.spec.ts discovers both from the public API rather than from
-- ids, and skips ("real API did not return a bookable service item with an
-- available slot" / "... a public market with two vendors and available menu
-- items") when it finds none. Both are seeded here so those two tests run.
--
-- These rows share the platform D1 with the customer-real and admin-real jobs,
-- which seed this same file. They add a service item and a market to the demo
-- restaurant and a second shop of their own; nothing here edits a row those
-- jobs create or assert on, and every name carries "E2E" so a search for a
-- job's own fixtures cannot match them.
-- ---------------------------------------------------------------------------

-- Bookable service. availableHours is left NULL, so any time is within hours.
INSERT OR IGNORE INTO restaurant_service_items (
  id,
  restaurant_id,
  name,
  description,
  service_type,
  price_cents,
  payment_requirement,
  duration_minutes,
  requires_booking,
  sort_order,
  is_active,
  is_public,
  created_at_ms,
  updated_at_ms
) VALUES (
  9001,
  '019469a0-0099-7000-8000-000000000099',
  'E2E 測試諮詢預約',
  'Fixture service for the nightly integration suite',
  'consultation',
  0,
  'pay_at_venue',
  30,
  1,
  0,
  1,
  1,
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

-- Two slots a day for the next 14 days. The spec looks 1..14 days ahead (UTC),
-- and a slot row only exists if something creates it, so a fixed date would go
-- stale; instead each seed run tops the window up. The unique index on
-- (service_item_id, date, time_slot) makes a re-run a no-op for days already
-- seeded. Capacity 5 leaves room for the cancelled bookings the test leaves.
INSERT OR IGNORE INTO service_booking_slots (
  id,
  restaurant_id,
  service_item_id,
  date,
  time_slot,
  max_capacity,
  current_bookings,
  is_available,
  created_at_ms,
  updated_at_ms
)
WITH RECURSIVE days(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM days WHERE n < 14
),
times(time_slot) AS (
  VALUES ('10:00'), ('14:00')
)
SELECT
  'e2e-slot-' || date('now', '+' || days.n || ' day') || '-' || times.time_slot,
  '019469a0-0099-7000-8000-000000000099',
  9001,
  date('now', '+' || days.n || ' day'),
  times.time_slot,
  5,
  0,
  1,
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
FROM days, times;

-- Second vendor for the market. A market checkout needs two distinct shops and
-- the demo restaurant is the first. Its own `type` keeps it out of the way of
-- customer-real's find-by-type stalls (e2e_market_stall and friends).
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
  settings,
  is_available,
  is_active,
  enable_shop_mode,
  supports_takeaway,
  created_at_ms,
  updated_at_ms
) VALUES (
  '019469a0-0099-7000-8000-000000009002',
  'E2E 種子夜市攤位',
  'e2e_seed_vendor',
  'snack',
  'Second vendor fixture for the nightly market checkout',
  'E2E Seed Market Road 1',
  'E2E District',
  '台中市',
  '0422000099',
  '{"currency":"TWD","language":"zh-Hant","allowGuestOrders":true,"enableTakeaway":true}',
  1,
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
  '019469a2-0000-7000-8000-000000009002',
  '019469a0-0099-7000-8000-000000009002',
  'trial',
  '{"online_ordering":true,"menu_management":true}',
  1,
  (unixepoch('now') * 1000) + (30 * 24 * 60 * 60 * 1000),
  unixepoch('now') * 1000,
  (unixepoch('now') * 1000) + (30 * 24 * 60 * 60 * 1000),
  'e2e seed vendor subscription',
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

INSERT OR IGNORE INTO categories (
  id,
  restaurant_id,
  name,
  description,
  sort_order,
  is_active,
  is_visible,
  created_at_ms,
  updated_at_ms
) VALUES (
  9002,
  '019469a0-0099-7000-8000-000000009002',
  'E2E 攤位分類',
  'Fixture category for the seed vendor',
  0,
  1,
  1,
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

INSERT OR IGNORE INTO menu_items (
  id,
  restaurant_id,
  category_id,
  name,
  description,
  price_cents,
  is_available,
  sort_order,
  preparation_time,
  created_at_ms,
  updated_at_ms
) VALUES (
  9003,
  '019469a0-0099-7000-8000-000000009002',
  9002,
  'E2E 測試蚵仔煎',
  'Fixture item for the seed vendor',
  7000,
  1,
  0,
  8,
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

-- A public-ready market: description, location, opening hours, and one active
-- member with something to sell (the consultation above counts) - every
-- required check in evaluateMarketPublicReadiness.
INSERT OR IGNORE INTO markets (
  id,
  slug,
  name,
  type,
  description,
  city,
  district,
  address,
  latitude,
  longitude,
  opening_hours,
  tags,
  platform_fee_rate_bps,
  is_active,
  created_at_ms,
  updated_at_ms
) VALUES (
  '019469b0-0099-7000-8000-000000009001',
  'e2e-seed-market',
  'E2E 種子夜市',
  'night_market',
  'Seeded market for the nightly market checkout workflow',
  '台中市',
  'E2E District',
  'E2E Seed Market Road',
  24.16,
  120.64,
  json('{"mon":{"open":"00:00","close":"23:59"},"tue":{"open":"00:00","close":"23:59"},"wed":{"open":"00:00","close":"23:59"},"thu":{"open":"00:00","close":"23:59"},"fri":{"open":"00:00","close":"23:59"},"sat":{"open":"00:00","close":"23:59"},"sun":{"open":"00:00","close":"23:59"}}'),
  json('["E2E"]'),
  0,
  1,
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

-- Not primary: customer-real's markets spec adds the demo restaurant to a
-- market of its own, and primary status is per restaurant.
INSERT OR IGNORE INTO restaurant_market_memberships (
  restaurant_id,
  market_id,
  stall_number,
  location_label,
  is_primary,
  joined_at_ms
) VALUES
  (
    '019469a0-0099-7000-8000-000000000099',
    '019469b0-0099-7000-8000-000000009001',
    'E2E-A1',
    'E2E',
    0,
    unixepoch('now') * 1000
  ),
  (
    '019469a0-0099-7000-8000-000000009002',
    '019469b0-0099-7000-8000-000000009001',
    'E2E-A2',
    'E2E',
    0,
    unixepoch('now') * 1000
  );

-- A market checkout is refused with VENDOR_NOT_OPEN_TODAY unless each vendor
-- pressed "open" today. INSERT OR IGNORE would leave a stale timestamp from
-- the first seed, so refresh it on every run.
UPDATE restaurant_market_memberships
SET opened_at_ms = unixepoch('now') * 1000
WHERE market_id = '019469b0-0099-7000-8000-000000009001'
  AND left_at_ms IS NULL;
