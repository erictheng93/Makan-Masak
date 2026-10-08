-- 座位 QR 點餐：訂單記錄下單的座位。
-- ALTER TABLE ... ADD COLUMN 不改變表的 STRICT 屬性，不必重建；
-- 可空欄位且預設 NULL，既有列不需回填，SQLite 允許帶 REFERENCES。
ALTER TABLE `orders` ADD COLUMN `seat_id` INTEGER REFERENCES `seats`(`id`) ON DELETE SET NULL;
