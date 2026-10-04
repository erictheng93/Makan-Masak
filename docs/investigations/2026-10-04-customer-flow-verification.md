# 顧客流程現況與驗證缺口 — 2026-10-04

## 最新補充（2026-10-04，本機瀏覽器重跑後）

本文件下文「未啟動／跑 29 案」與 fixture 阻擋是較早階段快照，已由後續驗證補上：
候位測試改用票券 capability、加入匿名／跨票拒絕斷言後，customer-real **29/29 通過**，
retries=0，沒有 skipped 或 expected failure。精確命令、隔離埠與邊界見
[readiness 重新核對](2026-09-18-customer-app-readiness-qa.html#recheck-1004)。
共享 employee JWT fixture 亦已建立有效 sessions；後續 POS 及市集真 D1 重跑成功，
見 [Issue 431 最新驗證](2026-09-30-issue-431.md) 及 [平台報告](2026-10-04-platform-flow-verification.md)。
這不自動證明下文那組舊 customer smoke 已重跑。下方原始命令／失敗結果仍保留。
目前 master 圖為 v1.3，新增寄信、會員身份、退款、停用 Cron 與輪詢／部署限制。


依據 `docs/architecture/master-user-flow.html` v1.2（2026/09/30），核對目前 HEAD `8b9c7a571`、工作目錄與既有測試。舊 QA 的當日觀察不能重建為今日 production 證据；本次保留歷史，另加目前更正。沒有部署、正式寫入、發通知或更新 GitHub。

## 判定

09-15／09-18 QA 的歷史實測仍有參考價值，09-23 的「未推送、無會員下單、無寄信設定、付款條件無來源、E2E 缺」已部分過期。10-01 上線前提報告較新，但 binding／資料數／issue 狀態是 dated snapshot。本次 production GET `/info` 重確認 `storedValueCredits`、`customerWebPush`、`tenantBackups` 停用，其他 production 前提不推定未變。

| Master 節點 | 目前來源／驗證 | 仍未證明 |
| --- | --- | --- |
| 桌位／座位／店家公開 QR、內用／外帶／外送 | ordering E2E 定義、seat-order 與 menu/table validation 回歸 | 正式座位 QR、停用／汰換碼的真瀏覽器提示；本次未跑整套 E2E |
| 客製／備註／電話／優惠券 | cart、seat、coupon 回歸；#382 已是一般 E2E | production 真券、併發庫存與重送下單跨端驗收 |
| pending → confirmed → preparing → ready → delivered → paid | order-tracking realtime 回歸；現有 E2E 完整鏈 | 本次實際四端同步、掉線重連、後台退款到顧客頁未跑 |
| 登入／註冊／重設、會員下單／歷史 | #422 修正已進 HEAD，member E2E 的兩案已移除 test.fail；新增真 OTP → 下單 → 歷史隔離通過 | Email 驗證／密碼重設／SMS 正式送達、production 會員套券 |
| 候位 → 叫號 → 入座 | guest credential 前端測試通過；候位 E2E 已有不用 push 的降級 | ticket 權限強化在工作目錄、未提交；本次不是部署證據；真正背景 Web Push 送達 |
| 線上訂位、預約服務 | reservation/view 及服務 route 回歸通過；server-side terms 已由服務設定控制（65c443181） | 正式時段／資料、migration 0029 ledger、到店收款；候位與訂位競爭同桌驗收 |
| 開團／邀請／合單／拆帳／追蹤 | group-order views 與 reload 競態回歸通過；group E2E 已含兩人追蹤與 token 次數 | 本次整套群組瀏覽器未重跑；均分／各付各／比例在多幣別下實際收款、群組過期／中途失敗復原 |
| 市集探索／跨攤結帳／券 | route/provider 回歸通過；現有 E2E 是一般測試，已非預期失敗 | 正式市場與攤位資料、market open-day 狀態到顧客 UI |
| 一次付款／回調／逐攤分帳 | adc049b82 fail closed；95c63754f 訪客 CSRF；完整 market routes 99 案通過 | 實際 provider 成功付款、外部 webhook 驗簽、重送／乱序、逐攤 reconciliation 與退款；fail closed 不等於成功收款 |
| 儲值扣抵／退款 | 旗標關，相關 provider route 邏輯有測試 | 啟用後完整購物／扣抵／退款 E2E；本次不擅自開旗標 |
| 回訪 installed app 切版 | 9e0ffe71f 接管重載，a2bf6019d importScripts 內容版本，PWA 回歸通過 | Cloudflare zone cache 與真回訪裝置部署後耗時 |

29 個 customer-real 測試由 6 個 spec 定義（ordering 9、tracking 5、seating/bookings 4、group 2、markets 6、member 3）。搜尋這個 bounded scope 未見 `test.fail`／`test.fixme`；共用 requireStack 仍可能 skip，必須用 `E2E_STRICT=1`，不能將 stack 未啟動當通過。本次沒有啟動／跑這 29 案。

## 本次補上的驗證

新增 `apps/customer-app/src/__tests__/integration/2026-10-04-customer-flow-verification.real.integration.test.ts`，用真 Miniflare/D1 與 application routes，透過 development OTP 發 canonical customer token，完全不使用 staff JWT helper。

它驗證會員不帶 CSRF cookie 也能建立會員訂單、`customerId` 正確保存、讀自己的歷史，且同店其他無會員訂單不混入。這補上舊 customer-app smoke 用平台管理員代替顧客的驗證缺口，沒有變更 runtime 行為。development OTP 不代表 production SMS 可送達。

## 可重跑結果

```bash
# 17 files, 209 passed
pnpm exec vitest run \
  apps/customer-app/src/tests/guest-order-token.test.ts \
  apps/customer-app/src/tests/waiting-ticket-flow.test.ts \
  apps/customer-app/src/tests/views/group-order-views.test.ts \
  apps/customer-app/src/tests/views/menu-view-table-validation.test.ts \
  apps/customer-app/src/tests/views/order-tracking-realtime.test.ts \
  apps/customer-app/src/tests/views/cart-view-coupon-discount.test.ts \
  apps/customer-app/src/tests/views/cart-view-seat-order.test.ts \
  apps/customer-app/src/tests/views/service-booking-view.test.ts \
  apps/customer-app/src/tests/views/reservation-view.test.ts \
  apps/customer-app/src/tests/views/market-checkout-tracking-view.test.ts \
  apps/customer-app/src/tests/views/market-checkout-availability.test.ts \
  apps/customer-app/src/tests/stores/auth.test.ts \
  apps/customer-app/src/tests/router-member-session.test.ts \
  apps/customer-app/src/tests/pwa-dead-code-regression.test.ts \
  apps/customer-app/src/utils/push-notifications.test.ts \
  apps/api/src/shared/feature-adoption.test.ts \
  apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentProvider.test.ts

# 2 files, 108 passed (market 99 + service bookings 9)
pnpm exec vitest run apps/api/src/features/market-checkouts/routes/index.test.ts apps/api/src/features/service-bookings/routes/index.test.ts

# New real integration: 1 passed
pnpm exec vitest run --config apps/customer-app/vitest.real-integration.config.ts apps/customer-app/src/__tests__/integration/2026-10-04-customer-flow-verification.real.integration.test.ts

# Existing canonical-customer history: 1 passed, 4 intentionally unselected
pnpm exec vitest run --config apps/api/vitest.real-integration.config.ts apps/api/src/__tests__/integration/role-gaps-04-customer-orders.real.integration.test.ts -t 'binds /customers/me/orders'

# Old customer smoke: 10 passed, 3 failed (before adding new file)
pnpm exec vitest run --config apps/customer-app/vitest.real-integration.config.ts

# Read only; still lists storedValueCredits/customerWebPush/tenantBackups off
curl -fsS --max-time 15 https://api.makanmasak.com/info
```

舊 smoke 三個失敗都不是 assertion 寫錯付款金額：`Customer Orders API` 的建立、讀回、nonexistent 查詢收到 401 `TOKEN_INVALIDATED`，message 是 `Session has been invalidated`。工作目錄 `apps/api/src/middleware/auth.ts` 要求 active `sessions` row；`apps/api/src/__tests__/integration/helpers/issue-test-jwt.ts` 只發 token／建 users，不建 session。根因是共享 fixture 與尚未提交的 auth 契約不相容，需要在共享 fixture 或真登入處修正，不能弱化 production auth 或把 401 加入成功斷言。本次不越權修改其他代理／使用者負責的認證檔案。

## 優先未驗事項與完成條件

1. 正式 provider sandbox 或測試 merchant：付款成功後驗簽回調、逐攤金額一致、重送不重扣、部分／全额退款、對帳查詢；需要 provider 設定及測試帳戶，不能以 mock adapter 通過代替。
2. 有正式資料的座位、訂位、服務、市集；用 UI 建立與讀回，驗證停用／過期 QR、容量競爭、服務付款政策与逐攤可用性。
3. 真 Email／SMS／Web Push 送達與 refresh／logout 撤銷；push 在會員授權後測背景裝置叫號，保留 off 時立即取號降級。
4. 本機 `E2E_STRICT=1` 跑目前 29 案与四端狀態／掉線恢復；下一次 authorized deployment 量同一 installed app 更新耗時，重驗 zone cache。

這些設定與正式資料操作沒有在本次執行；master 圖描述產品契約，不能直接當作功能已上線、已配置或已驗證的清單。

## 證據品質

結構探索使用 codebase-memory search_graph → trace_path → get_code_snippet，對每個引用程式路徑檢查 coverage；`member.spec.ts` line 45、`group-order-views.test.ts` lines 50／82、market checkout route test lines 188／205／220／243 的 partial ranges 已直接讀取（best effort 不是完整性保證）。graph generation 由 05:56:53Z 更新到 06:13:16Z。docs 與 configs 直接讀取；未提交變更以 git status 區分。`git log --all` 因既有 `refs/heads/cto-followups 2` bad ref 失敗，改讀 `git log HEAD`，本次未修 Git refs。
