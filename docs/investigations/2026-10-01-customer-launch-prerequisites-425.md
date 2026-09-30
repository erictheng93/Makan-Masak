# 顧客端上線前提查核與關閉條件

2026-10-01（Asia/Kuala_Lumpur）重查 [issue 425](https://github.com/erictheng93/Makan-Masak/issues/425)。本次只讀取 production、執行既有測試並記錄結果，沒有部署、寫入 D1、調整旗標、產生憑證或更新 GitHub issue。

**目前不能關閉。** issue 的完成條件是每列有負責人與「開、不開、延後」決定；目前尚未取得這些決定。已確認的阻塞是缺少金流與推播配置、儲值未啟用、正式市集與服務資料未建立，以及座位與測試租戶的營運處置未定。這次沒有找到需要修改既有程式才能排除上述阻塞的證據。

## Production 現況

| 項目 | 本次證據 | 與 09-23 紀錄的差異 | 尚需決定或執行 |
| --- | --- | --- | --- |
| 線上金流 | 部署中的 API 無 `MARKET_CHECKOUT_*`、`STRIPE_*`、`SHOP_WALLET_*` bindings；`shop_payment_credentials` 為 0 | 平台金流仍未配置；另外查證店家錢包並未接通 | 決定金流商、結算方式、上線範圍與負責人；若啟用，接通 adapter 並驗證付款、回調、查詢、退款及逐攤結算 |
| 顧客 Web Push | API 無 `WEB_PUSH_VAPID_*`；`/info` 列出 `customerWebPush` 停用 | 仍停用 | 決定啟用或延後；若啟用，配置 VAPID、前端建置公鑰與旗標，實測訂閱及叫號送達 |
| 儲值代幣 | `/info` 列出 `storedValueCredits` 停用 | 仍停用 | 決定啟用或延後與負責人；啟用前確認儲值政策並實測扣抵及退款 |
| 市集資料 | `markets = 0`、`restaurant_market_memberships = 0` | 無變化 | 指定正式市集及攤位資料、建立者與上線時間，或明確延後 |
| 服務資料 | `restaurant_service_items = 0` | 無變化 | 指定正式服務、預約與付款條件及建立者，或明確延後 |
| 座位 QR | 6 張桌位中 1 張啟用；12 個座位全停用。啟用桌位未刪除、屬於啟用中的非 QA 店，`qr_mode = table`，其下沒有座位 | 「桌全部停用」已不準確；一般桌位與座位 QR 必須分開判斷 | 決定是否上線座位 QR、由哪家店建立及驗證；不能把一般桌位啟用當成座位 QR 已就緒 |
| QA 測試租戶 | 指定名稱的租戶仍有 1 筆，`is_active = 1`、未刪除 | 仍保留 | 決定保留、停用或刪除及負責人；本次未重驗公開探索是否排除此租戶 |

本次 `wrangler secret list` 僅讀取名稱：`ALERT_EMAIL_TO`、`CLOUDFLARE_API_TOKEN`、`ENCRYPTION_KEY`、`INTERNAL_API_TOKEN`、`JWT_SECRET`、`QR_SIGNING_KEY`。沒有讀取任何 secret 值。

09-23 留言所稱 email/SMS 均未配置已不能沿用：[issue 384](https://github.com/erictheng93/Makan-Masak/issues/384) 已關閉，部署中的 API 有 `NOTIFICATION_EMAIL` send_email binding 與 `NOTIFICATION_FROM_EMAIL = notifications@makanmasak.com`。本次未重做註冊、寄信或 SMS 送達測試，因此不據此聲稱所有通道都可用。

## 根因與程式路徑

金流阻塞可在既有 route 測試重現：未配置 provider 的 `market_online` 付款回傳 409 `MARKET_CHECKOUT_PAYMENT_NOT_CONFIGURED`，不呼叫付款服務。這是拒絕未配置金流的預期保護，重試或移除 guard 不會補上支付能力。

- `apps/api/src/features/market-checkouts/routes/index.ts` 的 `hasOnlineMarketCheckoutPaymentProvider` 要求一般線上付款有 `provider_split` 與 gateway URL；儲值另依旗標、店家錢包另依店家憑證。
- `apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentProvider.ts` 的 `getMarketCheckoutPaymentProviderStatus` 已提供缺失設定資訊。可重用現有 readiness 與 connectivity 檢查，不需要再建一套。
- 店家錢包不是只放憑證就能使用：`ShopWalletMarketCheckoutGateway.ts` 的 `createShopWalletGateway` 在沒有 `SHOP_WALLET_GATEWAY_URL` 時使用 `notImplementedShopWalletGateway`。若選擇此路徑，還需要可用的 adapter；本次沒有驗證任何外部 adapter 已存在。
- `apps/api/src/shared/feature-adoption.ts` 的 `isFeatureEnabled` 在旗標未設定時依宣告預設值處理；儲值及顧客推播預設關。`app-factory.ts` 將同一判斷用於 `/info` 與路由 gate，現有測試通過。
- `CustomerWebPushService.ts` 沒有 VAPID 公私鑰就不能用預設 fetch 路徑送達；customer-app 的 `push-notifications.ts` 沒有 `VITE_VAPID_PUBLIC_KEY` 就視為不支援。本次只確認 API 部署缺少 VAPID 及 repository production 設定未提供前端公鑰，沒有查核已部署前端 bundle 的公鑰內容。

空的市集及服務資料、停用座位和 QA 租戶留存由 D1 直接查證。上述訊號不能用來推論所有其他功能都沒有 bug，也不能以測試通過代替 production 金流或推播送達驗證。

## 可重跑查核

從 repository 根目錄執行：

```bash
curl -fsS https://api.makanmasak.com/info
pnpm exec wrangler secret list --env production --config apps/api/wrangler.toml
pnpm exec wrangler deployments list --env production --config apps/api/wrangler.toml --json
pnpm exec wrangler d1 execute makanmasak-prod --remote --env production --config apps/api/wrangler.toml --command "SELECT (SELECT COUNT(*) FROM markets) AS markets, (SELECT COUNT(*) FROM restaurant_market_memberships) AS memberships, (SELECT COUNT(*) FROM restaurant_service_items) AS service_items, (SELECT COUNT(*) FROM tables) AS tables_total, (SELECT COUNT(*) FROM tables WHERE is_active = 1) AS tables_active, (SELECT COUNT(*) FROM seats) AS seats_total, (SELECT COUNT(*) FROM seats WHERE is_active = 1) AS seats_active, (SELECT COUNT(*) FROM restaurants WHERE name = 'QA 部署驗證測試店 勿用 20260916') AS qa_tenant;" --json
pnpm exec wrangler d1 execute makanmasak-prod --remote --env production --config apps/api/wrangler.toml --command "SELECT COUNT(*) AS shop_payment_credentials FROM shop_payment_credentials;" --json
```

部署清單最後一筆為 2026-09-29T15:54:28.331399Z，100% 使用版本 `211b8385-735b-4fe9-8a54-c119ca609c87`。以 `wrangler versions view` 讀取該版本 metadata，篩選相關 binding 名稱，確認前述缺失；不是只憑本機 wrangler 設定推論 production。

D1 成功查詢回報 `changes = 0`、`rows_written = 0`、`changed_db = false`。查詢過程曾遇到 compound SELECT 上限及不存在的 `is_visible` 欄位；改用 scalar subqueries 與已確認欄位後取得上述結果，未改 schema。

## 測試證據

```bash
pnpm exec vitest run apps/api/src/shared/feature-adoption.test.ts apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentProvider.test.ts apps/customer-app/src/utils/push-notifications.test.ts
# 3 files passed, 49 tests passed

pnpm exec vitest run apps/api/src/features/market-checkouts/routes/index.test.ts -t 'fails closed when an online market payment provider is not configured'
# 1 test passed, 98 skipped；確實重現 409 並驗證不呼叫付款服務
```

沒有 runtime 行為變更，因此重用既有測試，未新增重複測試。結構探索使用 codebase-memory graph 並對依據的程式路徑檢查 coverage；route 測試的 partial ranges 已直接讀取，其他相關路徑沒有 recorded coverage gap。

## 關閉條件

每項都需要填入實際負責人與決定；以下仍未完成，不能把建議當作已同意：

- [ ] 金流：負責人、商家／平台收款方式、供應商、啟用／不啟用／延後；啟用則附交易驗證結果。
- [ ] 顧客 Web Push：負責人、啟用／不啟用／延後；啟用則附真實訂閱與叫號送達結果。
- [ ] 儲值：負責人、啟用／不啟用／延後；啟用則附政策與扣抵、退款驗證。
- [ ] 市集：負責人、正式資料與建立計畫，或明確不啟用／延後。
- [ ] 服務：負責人、正式資料與建立計畫，或明確不啟用／延後。
- [ ] 座位 QR：負責人、上線店家與掃碼驗證，或明確不啟用／延後。
- [ ] QA 租戶：負責人與保留／停用／刪除決定，必要處置完成後重查。

若某項延後，記錄重啟條件與追蹤位置，並確認對外上線範圍不承諾該功能。待以上都有決定且應執行的處置有證據，再由使用者稽核是否關閉 issue。
