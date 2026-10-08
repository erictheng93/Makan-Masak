-- 市集所在國（ISO 3166-1 alpha-2）。國家層的平台費率上限依它套用；
-- 之前只能用 markets.city 文字反查，對不到就會靜默地不套上限。
--
-- ALTER TABLE ... ADD COLUMN 不改變表的 STRICT 屬性，不必重建。允許 NULL：
-- 城市名稱對不到清單的市集留給人工處理，應用程式禁止這類市集收平台費。
--
-- 回填只認 COUNTRY_PROFILES（packages/shared-types/src/locale.ts）裡的
-- 城市名稱，完全符合才填；policies.test.ts 會檢查兩份清單一致。
ALTER TABLE `markets` ADD COLUMN `country_code` TEXT;
--> statement-breakpoint
CREATE INDEX `markets_country_code_idx` ON `markets` (`country_code`);
--> statement-breakpoint
UPDATE `markets` SET `country_code` = 'TW'
 WHERE `country_code` IS NULL
   AND `city` IN ('臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市',
                  '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
                  '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
                  '臺東縣', '澎湖縣', '金門縣', '連江縣', '台中市');
--> statement-breakpoint
UPDATE `markets` SET `country_code` = 'MY'
 WHERE `country_code` IS NULL
   AND `city` IN ('Kuala Lumpur', 'Putrajaya', 'Labuan', 'Johor', 'Kedah',
                  'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak',
                  'Perlis', 'Penang', 'Sabah', 'Sarawak', 'Selangor',
                  'Terengganu');
