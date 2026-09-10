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
