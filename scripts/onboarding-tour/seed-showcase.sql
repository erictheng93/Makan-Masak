-- Showcase menu for the onboarding-app screenshot tour. LOCAL CAPTURE ONLY.
--
-- Runs after scripts/seed-local.sql against a throwaway D1 state directory
-- (capture.sh passes its own --persist-to). It dresses up the seed-local
-- restaurant, whose owner1/chef1 accounts the capture logs in with, as a
-- small Taiwanese eatery. Image URLs point at the static server capture.mjs
-- starts on :3099 from ./food.

UPDATE restaurants
SET
  name = '示範小館',
  description = '牛肉麵、滷肉飯與手工點心',
  address = '中山路 1 號',
  district = '西屯區',
  city = '台中市',
  enable_shop_mode = 1,
  settings = '{"currency":"TWD","language":"zh-Hant","allowGuestOrders":true,"enableDineIn":true,"enableTakeaway":true}',
  updated_at_ms = unixepoch('now') * 1000
WHERE id = '019469a0-0099-7000-8000-000000000099';

INSERT OR IGNORE INTO categories (
  id, restaurant_id, name, sort_order, is_active, is_visible,
  created_at_ms, updated_at_ms
) VALUES
  (9501, '019469a0-0099-7000-8000-000000000099', '招牌主食', 0, 1, 1, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9502, '019469a0-0099-7000-8000-000000000099', '手工點心', 1, 1, 1, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9503, '019469a0-0099-7000-8000-000000000099', '飲料', 2, 1, 1, unixepoch('now') * 1000, unixepoch('now') * 1000);

INSERT OR IGNORE INTO menu_items (
  id, restaurant_id, category_id, name, description, price_cents, image_url,
  is_available, is_featured, sort_order, preparation_time,
  created_at_ms, updated_at_ms
) VALUES
  (9501, '019469a0-0099-7000-8000-000000000099', 9501, '紅燒牛肉麵', '慢燉牛腱、酸菜與青江菜', 18000, 'http://localhost:3099/food/beef-noodle-soup.jpg', 1, 1, 0, 10, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9502, '019469a0-0099-7000-8000-000000000099', 9501, '古早味滷肉飯', '肥瘦剛好的手切滷肉', 6000, 'http://localhost:3099/food/braised-pork-rice.jpg', 1, 1, 1, 5, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9503, '019469a0-0099-7000-8000-000000000099', 9501, '招牌蛋炒飯', '粒粒分明，蔥香十足', 9000, 'http://localhost:3099/food/fried-rice.jpg', 1, 0, 2, 8, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9504, '019469a0-0099-7000-8000-000000000099', 9501, '酥炸雞腿', '現點現炸，外酥內嫩', 12000, 'http://localhost:3099/food/fried-chicken.jpg', 1, 0, 3, 12, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9505, '019469a0-0099-7000-8000-000000000099', 9502, '鮮肉小籠包', '一籠 6 顆，現蒸', 11000, 'http://localhost:3099/food/xiaolongbao.jpg', 1, 1, 0, 10, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9506, '019469a0-0099-7000-8000-000000000099', 9502, '高麗菜水餃', '10 顆，手工包製', 8000, 'http://localhost:3099/food/boiled-dumplings.jpg', 1, 0, 1, 8, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9507, '019469a0-0099-7000-8000-000000000099', 9502, '水煎包', '兩顆，底部煎得金黃', 5000, 'http://localhost:3099/food/pan-fried-buns.jpg', 1, 0, 2, 6, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9508, '019469a0-0099-7000-8000-000000000099', 9503, '珍珠奶茶', '手炒黑糖珍珠', 6500, 'http://localhost:3099/food/pearl-milk-tea.jpg', 1, 0, 0, 3, unixepoch('now') * 1000, unixepoch('now') * 1000);

-- seed-local's chef1 hash does not match the "chef123" the docs list, so pin
-- it here for the kitchen-display capture. Throwaway database only.
UPDATE users
SET password_hash = '$2a$10$CYu/cxG0pIu3bYV9KKS1/uoVJ69geTPct.gp3grvJBrijxrSnpqCC'
WHERE username = 'chef1';

-- Dine-in tables, so kitchen tickets read "桌 A3" rather than "No Table".
INSERT OR IGNORE INTO tables (
  id, restaurant_id, number, name, capacity, qr_code, is_active, is_occupied,
  created_at_ms, updated_at_ms
) VALUES
  (9501, '019469a0-0099-7000-8000-000000000099', 'A1', 'A1', 4, 'TABLE-019469a0-0099-7000-8000-000000000099-9501', 1, 0, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9502, '019469a0-0099-7000-8000-000000000099', 'A2', 'A2', 4, 'TABLE-019469a0-0099-7000-8000-000000000099-9502', 1, 0, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9503, '019469a0-0099-7000-8000-000000000099', 'A3', 'A3', 2, 'TABLE-019469a0-0099-7000-8000-000000000099-9503', 1, 0, unixepoch('now') * 1000, unixepoch('now') * 1000),
  (9504, '019469a0-0099-7000-8000-000000000099', 'A5', 'A5', 6, 'TABLE-019469a0-0099-7000-8000-000000000099-9504', 1, 0, unixepoch('now') * 1000, unixepoch('now') * 1000);

-- The owner overview lists staff by full name; seed-local's are English
-- placeholders ("Demo Chef") that read as untranslated UI in a zh-TW shot.
UPDATE users SET full_name = CASE username
    WHEN 'owner1' THEN '林老闆'
    WHEN 'chef1' THEN '陳師傅'
    WHEN 'service1' THEN '小美'
    WHEN 'cashier1' THEN '阿華'
    ELSE full_name
  END
WHERE username IN ('owner1', 'chef1', 'service1', 'cashier1');
