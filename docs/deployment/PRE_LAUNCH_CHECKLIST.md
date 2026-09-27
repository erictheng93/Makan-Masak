# MakanMakan 上線前 Checklist

> 基於 2026-04-15 Production Readiness 審查結果。按優先順序處理，🔴 為 blocker，🟡 為高優先，🟢 可上線後補。

---

## 🔴 Critical Blockers — 上線前必須完成

### 1. Backup Restore 實作與演練

- [x] 實作 `BackupService` 的 restore execution logic（`apps/api/src/features/backup/services/BackupService.ts`）—— 已於 2026-07-05 核實：`restoreFromBackup`（line 524）與 `executeRestore`（line 1126）已是完整實作（checksum 驗證、資料表還原、audit log），非空殼
- [x] 實作 D1 database restore 流程（從 R2 拉回並 apply）—— 同上
- [ ] 對 production 環境做一次完整的 **backup → restore 演練**，驗證資料正確性
- [ ] 記錄 restore SOP，確認任何 on-call 人員都能執行

### 2. Payment Audit Trail

- [ ] ~~補齊 `PaymentOrchestrator.ts` 的日誌記錄（目前有 2 個 TODO 標記）~~ —— **更正（2026-07-05）**：`PaymentOrchestrator.ts` 不存在於現行生產程式碼（只殘留在 `apps/api/src/examples/*.disabled`）。現行支付程式碼是 `apps/api/src/features/payments/services/{PaymentService,refundPayment}.ts`，已呼叫 `PaymentAuditService.buildAppendQuery`，功能目錄下 0 個 TODO
- [ ] 每一筆支付操作（建立、完成、退款、失敗）都必須寫入 audit log table —— **注意**：`PaymentService.ts` 目前只發送 `ATTEMPT`/`SUCCESS` 事件，`FAILURE` 是定義了但從未觸發的 dead enum（見 `docs/TODOS.md` §「known stubs returning fixed values」）
- [ ] 退款操作的日誌記錄完整實作
- [ ] 確認 audit log 不可被刪除（append-only）

### 3. Disaster Recovery Plan

- [ ] 定義 **RTO**（Recovery Time Objective）：系統最多可以 downtime 多久？
- [ ] 定義 **RPO**（Recovery Point Objective）：最多可以遺失多少資料？
- [ ] 撰寫 failover 流程文件（Cloudflare Workers rollback SOP）
- [ ] 撰寫 DB 損壞/遺失的資料恢復流程
- [ ] 執行一次 DR 演練並記錄結果

### 4. Incident Response Runbook

- [ ] 指定 on-call 負責人與輪班安排
- [ ] 定義 incident severity 等級（P0/P1/P2/P3）
- [ ] 定義每個 severity 的 response time SLA
- [ ] 撰寫 escalation path（誰通知誰）
- [ ] 建立 incident communication template（客戶通知、內部通知）
- [ ] 建立 post-mortem template

---

## 🟡 High Priority — 上線後兩週內完成

### 5. 啟用 Sentry Error Tracking

- [ ] `SENTRY_DSN` 已在 env 定義，完成實際 SDK integration（`apps/api/src/middleware/monitoring.ts`）
- [ ] 設定 error grouping 與 alerting rules
- [ ] 確認 sensitive data 不會送到 Sentry（ErrorSanitizer 已有，需驗證）
- [ ] 前端 apps（admin、customer、kitchen）也加入 Sentry

### 6. Feature Flag 系統

- [ ] 評估並選擇 feature flag 方案（建議 Cloudflare Workers + KV 自建，或 Unleash self-hosted）
- [ ] 實作基本 on/off flag API
- [ ] 為高風險功能（payment、queue）加上 feature flag

### 7. Metrics 長期保留

- [ ] KV metrics TTL 目前 24 小時，延長至至少 30 天（或改用 Cloudflare Analytics Engine 持久化）
- [ ] 確保能做 week-over-week 趨勢比較

### 8. Database Migration Rollback

- [ ] 為每一個 forward migration 評估並撰寫 down migration
- [ ] 重要的 schema migration 上線前先在本機驗證

### 9. Queue Service 決策

- [x] 確認 `UnifiedQueueService` 是否為上線必要功能 —— **更正（2026-07-05）**：`apps/api/src/features/queue/services/UnifiedQueueService.ts` 現行 0 個 TODO；檔案開頭註解明確說明舊 legacy/modular 雙軌已「replaced wholesale」，現在是委派給 `WaitingListService`（真正持久化到 D1）的薄 adapter，核心邏輯已實作完成，此項已解決

---

## 部署前最終確認

### 環境設定

- [ ] Production `CORS_ORIGIN` 已設定為正確的 domain（非 `*`）
- [ ] 所有 `wrangler secret put` 已在 production 環境執行：
  - [ ] `JWT_SECRET`（≥ 32 字元）
  - [ ] `QR_SIGNING_KEY`（≥ 32 字元）—— 缺少時建立桌位、重新產生 QR、批次建立座位全部拋錯
  - [ ] `ENCRYPTION_KEY`（≥ 32 字元）—— 加密第三方憑證（ai-analytics、平台外送整合、forecast provider、加密備份）。#300 之後在 production 缺少時這些路徑直接失敗，不再靜默用空字串推導出一把公開可重現的金鑰
  - [ ] `SLACK_WEBHOOK_URL`（如有啟用 error 通知）
  - [ ] `STRIPE_SECRET_KEY`（如有啟用 payment）
- [ ] `pnpm check:prod-config` 通過（`pnpm deploy:prod` 會自動先跑）。它讀的是**線上** Worker 的 secret 清單（`wrangler secret list --env production`），不是你 shell 裡的環境變數——`wrangler deploy` 從不上傳操作者的環境變數，所以本機 export 過從來不算數
- [ ] 每一把 secret 的原值都已存進團隊密碼管理器（見下方「金鑰保管」）
- [ ] Production `wrangler.toml` 的 `[env.production]` 區段所有 ID 已填入真實值（非 placeholder）
- [ ] `NODE_ENV = "production"` 已設定
- [ ] `LOG_LEVEL` 已從 `debug` 改為 `warn` 或 `error`

#### ⚠️ 金鑰保管：先存進密碼管理器，再執行 `wrangler secret put`

Cloudflare secret 是**唯寫**的：寫進去之後任何人、任何 API 都讀不回原值，
`wrangler secret list` 只會列出名稱。

對 `ENCRYPTION_KEY` 來說這是不可逆的：一旦弄丟，所有用它加密過的憑證
（外送平台 token、LLM API key、加密備份）**永遠救不回來**，也沒有任何重設流程
——只能把每一筆加密資料作廢並請對方重新授權。覆寫成新的一把金鑰同樣救不回舊密文，
因為舊密文是用舊金鑰加密的。

所以順序是固定的，不能倒過來：

1. 產生金鑰：`openssl rand -base64 48`
2. **先**把它存進團隊共用的密碼管理器（`JWT_SECRET`、`QR_SIGNING_KEY` 同理）
3. 才執行 `wrangler secret put ENCRYPTION_KEY --env production`

輪替 `ENCRYPTION_KEY` 一樣要先用舊金鑰把既有密文解出來、用新金鑰重新加密，
不是換上去就好。

### 資料庫

- [ ] Production platform D1 migrations 已 apply（`pnpm db:migrate:prod`）
- [ ] Production management D1 migrations 已 apply（`pnpm db:migrate:prod:mgmt`）
- [ ] 備份排程已啟用並測試過至少一次

### ⚠️ 高風險：Test Accounts 絕對不能進 Production

> **背景**：`packages/database/migrations/0048_add_test_accounts.sql` 包含 8 個測試帳號，密碼明文記錄在 SQL 註解裡：
>
> | Username | Password | Role |
> |----------|----------|------|
> | admin | admin123 | 0 (Admin) — **全系統最高權限** |
> | owner1 | owner123 | 1 (Owner) |
> | chef1/chef2 | chef123 | 2 (Chef) |
> | service1/service2 | service123 | 3 (Service) |
> | cashier1/cashier2 | cashier123 | 4 (Cashier) |
>
> 如果這些帳號進入 production，任何人都能用公開密碼以 **Admin 身份**登入。

**目前狀態（2026-04-15 確認）：**
- `0048_add_test_accounts.sql` 在 `packages/database/migrations/` 目錄
- Production 的 `apps/api/wrangler.toml` 使用的是 `migrations_fresh/` 目錄
- **目前不在 production 的 migration path — 但必須持續確保如此**

**上線前必做：**

- [ ] 確認 `packages/database/migrations_fresh/` 目錄內**沒有**任何 test/seed/account 相關 migration
  ```bash
  ls packages/database/migrations_fresh/ | grep -iE "test|seed|account"
  # 應該沒有任何輸出
  ```
- [ ] 確認 production D1 database 內**沒有** test 帳號
  ```bash
  wrangler d1 execute makanmakan-prod --env production \
    --command "SELECT username, role FROM users WHERE username IN ('admin','owner1','chef1','chef2','service1','service2','cashier1','cashier2')"
  # 如有結果，立即執行 DELETE
  ```
- [ ] 如果 production DB 已存在 test 帳號，立即清除：
  ```bash
  wrangler d1 execute makanmakan-prod --env production \
    --command "DELETE FROM users WHERE username IN ('admin','owner1','chef1','chef2','service1','service2','cashier1','cashier2')"
  ```
- [x] 永久防護：`0048_add_test_accounts.sql` 頂部已加上 `DEV ONLY` 警告（2026-04-15）
- [x] 所有 test/seed migration 已移至 `migrations/dev-only/` 子目錄（2026-04-15）
  - `0002_seed_data.sql`
  - `0022_payment_system_seed_data.sql`
  - `0039_fix_test_user_passwords.sql`
  - `0048_add_test_accounts.sql`

### 測試

- [ ] `pnpm test` 全部通過（本地）
- [ ] `pnpm typecheck` 無錯誤
- [ ] `pnpm lint` 無錯誤
- [ ] 手動測試核心 happy path：
  - [ ] 客戶掃 QR → 點餐 → 送出訂單
  - [ ] Kitchen display 收到訂單
  - [ ] Admin 可以看到訂單並更新狀態
  - [ ] Cashier 完成結帳

### 監控

- [ ] Slack webhook 已設定並測試（送一條測試訊息）
- [ ] Health endpoint `/info` 在 production 回傳 `healthy`
- [ ] Cloudflare Dashboard 已確認 Workers、D1、KV 都正常

---

## 🟢 上線後逐步補齊（Nice to Have）

| 項目 | 說明 |
|------|------|
| MFA/2FA | Admin 和 Shop Owner 角色建議強制啟用 |
| PagerDuty 整合 | 目前只有 Slack，critical alert 需要 on-call paging |
| Distributed Tracing | OpenTelemetry 跨 Worker 追蹤請求 |
| Blue-green deployment | Cloudflare 支援，可實現 zero-downtime deploy |
| Secret rotation 機制 | 目前需要手動 rotate，考慮自動化 |
| CSP nonce strategy | 取代目前的 `unsafe-inline` |
| API sunset headers | 為未來 v2 遷移做準備 |
| Status page | 公開或內部的系統狀態頁面 |
| AI encryption salt 移到 env | `AI_KEY_ENCRYPTION_SALT` 目前 hardcoded |

---

*最後更新：2026-04-15*
*審查者：Production Readiness Assessment*
