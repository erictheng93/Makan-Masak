-- 0028 added restaurants.country_code without guessing values for legacy rows.
-- Backfill only Taichung restaurants whose existing settings resolve to the
-- legacy TWD default. Explicit non-TWD, malformed, and non-object settings are
-- left for manual review so this one-off repair cannot reinterpret money data.
UPDATE restaurants
   SET country_code = 'TW',
       settings = json_set(COALESCE(settings, '{}'), '$.currency', 'TWD'),
       timezone = COALESCE(NULLIF(TRIM(timezone), ''), 'Asia/Taipei')
 WHERE country_code IS NULL
   AND city IN ('台中市', '臺中市')
   AND CASE
         WHEN settings IS NULL THEN 1
         WHEN json_valid(settings) = 0 THEN 0
         WHEN json_type(settings) <> 'object' THEN 0
         WHEN json_type(settings, '$.currency') IS NULL THEN 1
         WHEN json_type(settings, '$.currency') = 'text'
           THEN UPPER(TRIM(json_extract(settings, '$.currency'))) IN ('', 'TWD')
         ELSE 0
       END = 1;
