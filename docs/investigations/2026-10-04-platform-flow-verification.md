# 2026-10-04 平台與共通服務驗證

基準：`docs/architecture/master-user-flow.html` 原 v1.2 第 4 節及共通服務；本輪總圖已更新為 v1.3（2026-10-04），寄信、部分退款與停用 Cron 的敘述同步修正。核對的是目前工作樹，包含使用者尚未提交的驗證／session 變更；不是正式環境驗收。本輪沒有部署、寄信、向付款商交易或修改正式資料。

## 判斷

既有 investigations 的顧客、店家與現場作業 QA 不能涵蓋整个平台流程。補查入駐、市集、跨攤付款、授權、部署、監控與備份後，發現 **master flow 本身也有過時敘述**，不能只把調查文件強行改成與圖一致。

| 圖中流程 | 本輪證據 | 結論與剩餘驗證 |
| --- | --- | --- |
| 申請→審核→租戶／餐廳／店主→設定密碼 | Management API 實際 Hono 路由＋SQLite workflow：19/19；包含重複核准、失敗回滾、重試、禁止申請人自行完成、地區與市集申請 | 本機流程成立。正式收信、瀏覽器設定密碼後首次登入仍需完整驗收 |
| 人工轉交／目前不寄信 | `OnboardingService.createCredentialDelivery`、`sendSetupPasswordEmail`；management production config 的 `ONBOARDING_EMAIL_ENABLED="true"` 與 `ONBOARDING_NOTIFICATION_EMAIL` binding | 「目前不寄信」與目前程式／配置不符；有自動寄送與失敗記錄，關閉開關則人工交付。provider accepted／`sent` 不等於收件匣送達；本輪未重新驗證 production |
| 租戶與授權 | TenantService 與 licenses 邊界測試通過；licenses 測試只驗證公開 verify 可達與受保護路由拒絕匿名 | 不能據此宣稱授權到期、續約、方案升級、停用後各產品拒絕存取、用量配額 enforcement 都已驗證 |
| 部署／灰度／回滾 | 既有 VersionSyncService 3 個 mock 測試通過；新測試重現 returned failure 被誤記完成；portal 部署參數與後端契約不同 | 確定有部署 UI／批次進度缺口，不能標為可用。真 Cloudflare 部署、canary 故障停止、rolling 與回滾仍未驗證；詳見下節 |
| 市集編排／跨攤分帳／退款／CSV 報表 | API scoped suite 535/535；修正 session fixture 後，4 個 real-integration 檔案 61/61 通過 | 初跑 30 通過／31 失敗（401 `TOKEN_INVALIDATED`）是 helper 未建立 active session；補齊後重跑通過。本機 Hono／D1 路徑成立，外部金流 adapter 被控制，仍未驗真金流商或完整平台瀏覽器流程 |
| D1／KV 健康探針／告警 | MonitoringService 使用 `probeDatabase`／`probeCache` 與短期快取；既有測試涵蓋正常、D1 失敗、缺 binding、Slack 設定邊界 | 有真正相依探針的程式路徑，不是僅讀計數器。缺真環境斷線／復原演練、告警實際送達、多 isolate 聚合與 threshold 實際效果 |
| 稽核 | audit 路由測試包含於 scoped suite；備份 feature 有 audit 寫入；scheduler 舊服務 audit writer 只 log | 不能把圖中「完整操作軌跡」當成所有後端 mutation 已逐筆記錄；需要各關鍵權限／訂單／退款異動的 durable audit matrix |
| Cron→D1→R2→還原 | `apps/backup-scheduler/wrangler.toml` 的 `crons=[]`；scheduler 匯入另一個 legacy BackupService，見下節 | 圖中每日排程匯出不代表目前啟用／可用；本輪新增真 D1 regression 重現未持久化。定期還原與 RPO／RTO 未完成 |

## 部署的具體缺口

1. Management Portal 的 `stores/tenants.ts:262` 傳 `{tenantId, version}`，`services/api.ts:247` 原樣送到 `/deployments/deploy`；Management API 的 `routes/deployments.ts:23` 要求 `targetVersion`。因此目前 portal 請求缺必填欄位，依路由 validation 回 400，不會開始部署。既有 tenants store 測試把 API mock 成成功，沒有測到前後端契約。
2. `/deployments/provision` 回傳 `{tenantId, resources, status}`，portal `deploymentsApi.provision` 卻把 `data` 當 `TenantResource[]`；部署成功回傳的是簡短 acknowledgment，portal 亦型別宣告為完整 DeploymentLog。需要實際 Hono／portal contract 測試，不能只看 store mock 綠燈。
3. `ProvisioningService.deployToTenant` 以 `{success:false,error,...}` 回傳無 credentials、bundle 缺失、migration 或 worker deployment 失敗；`VersionSyncService.updateTenant` 忽略 `success`，只要 promise resolve 就累加 completedTenants。這會讓灰度批次把實際失敗當成功，canary failure gate 也無法辨識這類失敗。
4. 新增 `apps/management-api/src/services/version-sync-platform-flow.test.ts`，注入返回 `{success:false,error:"Bundle not found"}` 的 provisioning 邊界，要求 completed=0／failed=1。去掉 `.fails` 的暫時診斷測試實際得到 completed=1／failed=0，且已驗證 deploy 被呼叫一次、參數正確；診斷副本已刪除。保留 **1 expected fail** 追蹤尚未修復的失敗語意，沒有修改 production 程式。

以上部署缺口是本機 source／focused regression 證據，沒有呼叫 Cloudflare 部署 API。租戶 CRUD、授權與用量仍需補真 SQLite／Hono 邊界驗證；本輪 licenses 3 個測試只涵蓋公開 verify、匿名 get／generate，TenantService 1 個測試只涵蓋 subdomain，不等於完整租戶生命周期驗收。

## 備份的具體缺口

1. `apps/backup-scheduler/wrangler.toml` 明確關閉 cron；註解將 tenant backup 與平台 D1 Time Travel 分開。這是儲存庫配置證據，沒有查詢部署中的 trigger 或 Time Travel retention。
2. `apps/api/src/workers/backup-scheduler.ts` 匯入 `../services/BackupService`，不是 `features/backup/services/BackupService`。排程傳 `force_immediate:false`。
3. 舊服務的 `saveBackupRecord`、`updateBackupRecord`、`createAuditLog`、`saveRestoreOperation`、`executeRestore` 只有 log。`createBackup` 回傳 pending backup id，實際 `backup_records` 沒有該筆；`getBackupRecord`／`updateBackupStatus` 還查名為 `backups` 的表，與目前 schema 的 `backup_records` 不符。
4. feature BackupService 有實際寫入、checksum、加解密、還原與 safety backup；它的 unit suite 通過不能證明 scheduler 走相同路徑。
5. 工作區現有的 `apps/api/src/__tests__/integration/backup-scheduler-platform-flow.real.integration.test.ts`，使用既有 real-test-app 的 Miniflare D1／R2／KV，直接呼叫 scheduler 匯入的 service，要求 pending acknowledgment 前已 durable 寫入。移除 `.fails` 的診斷執行確實在 DB 查詢後得到 `null`，而非初始化錯誤。保留 `it.fails` 明確追蹤這個尚未修復的契約：**1 expected fail 不是備份成功**；修復後要移除 `.fails`，否則測試會提醒預期失敗已不成立。

應先統一 scheduler 與 feature 的服務與資料表，再啟用定時匯出；接著用隔離本機資料庫做備份／完整還原／selective restore／跨店隔離／損壞檔案拒絕與中途失敗恢复。正式 Time Travel/R2 演練需明確隔離目標與營運窗口，不能用一張指令計畫當作已執行還原證據。

## 可重現命令與實際结果

在 repository root：

```sh
pnpm exec vitest run --project=api src/features/backup src/workers/backup-scheduler.test.ts src/features/monitoring src/features/audit src/features/markets src/features/market-checkouts src/workers/market-checkout-reconciliation.test.ts src/features/pos/routes/market-checkouts.test.ts
# 33 files / 535 tests passed
```

在 `apps/management-api`：

```sh
pnpm exec vitest run --config vitest.config.ts src/services/TenantService.test.ts src/services/VersionSyncService.test.ts src/routes/licenses.test.ts src/__tests__/markets-list.test.ts src/__tests__/markets.routes.test.ts src/__tests__/onboarding-audit-archive.test.ts src/__tests__/onboarding-email.test.ts src/__tests__/onboarding-notifications.test.ts src/__tests__/onboarding-market-request.test.ts src/__tests__/onboarding-security.test.ts
# 10 files / 46 tests passed
pnpm exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/onboarding-workflow.real.integration.test.ts
# 1 file / 19 tests passed
```

在 `apps/api`：

```sh
pnpm exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/markets.real.integration.test.ts src/__tests__/integration/market-checkouts.real.integration.test.ts src/__tests__/integration/market-checkout-child-order-settlement.real.integration.test.ts src/__tests__/integration/market-checkout-provider-money.real.integration.test.ts
# Initial run: 4 files, 30 passed / 31 failed (TOKEN_INVALIDATED)
# Re-run after issue-test-jwt session fixture alignment: 4 files / 61 tests passed (73.75s)
pnpm exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/backup-scheduler-platform-flow.real.integration.test.ts
# 1 expected fail: pending acknowledgment is not persisted
```

重跑命令等價使用 `pnpm --dir apps/api test:real-integration` 加上相同四個測試路徑；fixture 由本輪平行稽核更新，為簽發的 employee JWT 建立 active sessions。原失敗結果保留作歷程，現行結果以上述 61/61 為準。

以上數字是 2026-10-04 本輪執行結果，不代表總覆蓋率、正式部署版本或外部供應商驗收。

## 查證邊界

使用 codebase-memory Tier 2 的 symbol search、雙向 depth-1 trace、source snippet 與直接 source/config/test 讀取。兩個 BackupService 的 trace 都分別查證；相關 runtime、test helper 與整合測試 exact-path coverage 回 `no_recorded_issue/metadata_match`。graph generation 從 `2026-10-04T05:56:53Z` 自動更新到 `2026-10-04T06:09:11Z`；excluded runtime cache、node_modules 與 ignored declaration 不作證據。這是 bounded audit，不是整個 repository 的完整 security／coverage audit。

## 現場與平台追加覆核命令

以下命令從 repository root 執行（2026-10-04）；測試對象是 HEAD `8b9c7a571` 加当時未提交工作樹。現場歷史問題對應見兩份 floor HTML 的新增日期節。

```sh
pnpm --dir apps/api exec vitest run src/features/kitchen src/features/orders src/features/payments src/features/pos src/features/print src/features/backup --maxWorkers=2
# 41 files / 528 tests passed
pnpm --dir apps/kitchen-display exec vitest run --maxWorkers=2
# 28 files / 152 tests passed
pnpm --dir apps/admin-dashboard exec vitest run src/views/ServiceView.test.ts src/views/CashierView.test.ts src/views/POSManagementView.test.ts src/services/posService.test.ts src/views/OrdersView.test.ts src/views/PrintAgentsView.test.ts --maxWorkers=2
# 6 files / 79 tests passed
pnpm exec vitest run --project=@makanmasak/print-agent --project=@makanmasak/kitchen-display --project=@makanmasak/onboarding-app --maxWorkers=2
# Actual selected project: print-agent only, 4 files / 57 tests passed; Vue suites separately run below/above
pnpm --dir packages/queue-core exec vitest run src/print/drivers/PrinterDriver.test.ts src/print/formatters/ReceiptFormattingService.test.ts --maxWorkers=2
# 2 files / 17 tests passed, including localhost TCP bytes; no physical printer
pnpm --dir apps/onboarding-app exec vitest run --maxWorkers=2
# 10 files / 35 tests passed
pnpm --dir apps/management-portal exec vitest run --maxWorkers=2
# 12 files / 46 tests passed; mocked UI/service tests do not prove real deployment
pnpm --dir apps/management-api exec vitest run src/services/TenantService.test.ts src/services/BundleService.test.ts src/services/VersionSyncService.test.ts src/services/CloudflareApiClient.test.ts src/routes/licenses.test.ts src/__tests__/onboarding-email.test.ts src/__tests__/onboarding-security.test.ts src/__tests__/onboarding-owner-id.test.ts src/__tests__/onboarding-provisioning-locale.test.ts src/__tests__/onboarding-notifications.test.ts --maxWorkers=2
# 10 files / 50 tests passed
pnpm --dir apps/api exec vitest run src/workers/backup-scheduler.test.ts src/__tests__/cron-schedule-wiring.test.ts src/utils/cron.test.ts --maxWorkers=2
# 3 files / 21 tests passed, scheduler service mocked
pnpm --dir apps/api test:real-integration src/__tests__/integration/kitchen.real.integration.test.ts src/__tests__/integration/print-jobs.real.integration.test.ts src/__tests__/integration/backup-scheduler-platform-flow.real.integration.test.ts
# 3 files / 37 passed + 1 expected fail; REALTIME_SESSION absent, broadcast skipped
pnpm --dir apps/management-api exec vitest run src/services/version-sync-platform-flow.test.ts
# 1 expected fail, zero successful deployment behavior checks
pnpm exec prettier --write apps/management-api/src/services/version-sync-platform-flow.test.ts
pnpm --dir apps/management-api exec eslint src/services/version-sync-platform-flow.test.ts
# Both passed
```

codebase-memory Tier 2 再覆核相關 runtime／test paths；generation 自动刷新至 `2026-10-04T06:11:38Z`。orders 測試兩處 parse_partial、EnhancedKitchenDashboard 測試一處 parse_partial 及 Vue declaration ignored 範圍均直接讀 source 補查；不把 graph clean 當全面覆蓋證明。`syncOrderStatusAfterItemUpdate` 與 `deployToTenant` 查了雙向 trace／完整 snippet；onboarding approval 與 legacy backup 亦分别追到 delivery 與只 log 的 writer。
