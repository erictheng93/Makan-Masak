-- 示範店旗標。onboarding 首頁連到一家真的店，讓潛在店家親手點一次餐；
-- 這家店的訂單、訂位、候位與服務預約一律由伺服器拒絕（DEMO_RESTAURANT），
-- 探索、搜尋與熱門清單也把它排除，它不會出現在真實客人的結果裡。
--
-- ALTER TABLE ... ADD COLUMN 不改變表的 STRICT 屬性，不必重建。
-- 常數預設值讓既有列直接是 0，不需要回填。
ALTER TABLE `restaurants` ADD COLUMN `is_demo` INTEGER DEFAULT 0 NOT NULL;
