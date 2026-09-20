-- 一家店營業所在的國別（ISO 3166-1 alpha-2）。
--
-- 幣別與時區仍分別住在 settings.currency 與 timezone，因為既有程式都讀那裡；
-- 這一欄是給「按地區推政策」用的可查詢維度（WHERE country_code = 'MY'），
-- json_extract 沒辦法好好建索引。開通時由申請表的國別寫入，兩者同源。
--
-- ALTER TABLE ... ADD COLUMN 不會動到表的 STRICT 屬性，所以不需要重建表；
-- TEXT 是 STRICT 合法型別。允許 NULL：這欄位之前不存在，既有列沒有答案，
-- 讀取端必須把 NULL 當「未知」而不是預設成任何國家。
ALTER TABLE `restaurants` ADD COLUMN `country_code` TEXT;
--> statement-breakpoint
CREATE INDEX `restaurants_country_code_idx` ON `restaurants` (`country_code`);
