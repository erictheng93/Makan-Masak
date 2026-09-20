-- 入駐申請要記錄店家在哪裡營業，以及想掛在哪個市集底下。
--
-- country_code 是幣別與時區的來源：開通時由它決定新店的 settings.currency
-- 與 timezone。在這之前 provisioning 把 city 寫死成「台中市」、完全不寫
-- settings，所以每一家開出來的店實質上都是台灣店。
--
-- market_id 只是「申請掛在哪個市集」，不是歸屬本身。市集歸屬會影響平台抽成
--（markets.platform_fee_rate_bps 決定攤商實收）與合併結帳，所以它必須經過
-- 核准：開通時寫的是 market_join_requests，核准後才有 membership。
ALTER TABLE onboarding_applications ADD COLUMN country_code TEXT;
ALTER TABLE onboarding_applications ADD COLUMN market_id TEXT;
ALTER TABLE onboarding_applications ADD COLUMN stall_number TEXT;
