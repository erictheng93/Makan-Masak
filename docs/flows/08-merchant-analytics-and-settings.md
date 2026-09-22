# 分析與設定

> **對應 master board**：店家後台 → 分析與設定
> **主要角色**：店主（role 1）、管理者（role 0）
> **最後對照原始碼**：2026-09-22

## 1. 定位

四塊：營運分析、AI 洞察、訂閱與帳務、系統設定。
其中**訂閱**不只是一個設定頁——它是全系統的閘門，決定這家店的每一個模組能不能用。

## 2. 營運分析

| 動作 | 端點 |
| --- | --- |
| 儀表板 | `GET /api/v1/analytics/dashboard`、`/owner-dashboard`、`/realtime-dashboard` |
| 營收／商品／顧客／效能 | `GET /analytics/revenue`、`/products`、`/customers`、`/performance` |
| 財務報表 | `GET /analytics/financial-report` |
| 匯出 | `GET /analytics/export` |
| 即時推送 | `GET /analytics/sse` |
| 同步 | `POST /analytics/:restaurantId/sync`、`POST /analytics/batch-sync` |

### 2.1 平台管理者的多幣別金額

店主（role 1）的查詢必定由自己的 `restaurantId` 限定，因此金額只有該店的一種幣別；
平台管理者（role 0）可以不帶 `restaurantId`，結果可能同時涵蓋 TWD、MYR、VND。
這類回應中的金額一律是 `MoneyByCurrency`：

```json
[
  { "currency": "TWD", "amountCents": 10000 },
  { "currency": "MYR", "amountCents": 10000 }
]
```

不得把不同幣別的 cents 相加。`/performance` 的營收、AOV 與成長率、`/customers`
的顧客終身價值與消費額，以及 `/financial-report` 的營收、稅額、淨營收和期間比較，
都按幣別分組。商品／分類的單一 revenue 會附帶 `currency`。財務報表的 `limit`
只限制圖表／明細 bucket；摘要仍覆蓋整個選取的日期區間。

## 3. AI 洞察

| 動作 | 端點 |
| --- | --- |
| 讀取／設定供應商 | `GET /api/v1/ai-analytics/config/:restaurantId`、`POST /ai-analytics/config` |
| 測試供應商 | `POST /ai-analytics/test-provider` |
| 可用模型 | `GET /ai-analytics/models/:provider` |
| 產生洞察 | `POST /ai-analytics/generate` |
| 商品分析 | `GET /ai-analytics/products/traffic-drivers/:restaurantId`、`/bestsellers/`、`/profit-leaders/`、`/analysis/` |
| 用量 | `GET /ai-analytics/usage/:restaurantId` |

API key 存在 `apiKeyEncrypted`，讀取時一律回 `"***"`，**不會**把明文回給前端。

## 4. 訂閱、模組與配額

### 4.1 三層決定「這家店能不能用某模組」

`resolveModule`（`apps/api/src/middleware/moduleGate.ts:41`）的順序：

1. `isActive` 為 false → 一律拒絕
2. `trial` 方案且 `trialEndsAt` 已過 → 拒絕，訊息是「試用期已結束」
3. `moduleOverrides[module]` 有值 → **以覆寫為準**（可強開也可強關）
4. 否則回退到 `PLAN_DEFAULT_MODULES[planTier][module]`

role 0 完全繞過閘門。

### 4.2 快取

訂閱狀態在 KV 快取 **5 分鐘**（`subscription:{restaurantId}`）。任何改動
`is_active` / `plan_tier` / `module_overrides` 的寫入者——後台、billing webhook、cron——
都必須呼叫 `invalidateSubscriptionCacheForEnv`，否則最長 5 分鐘內舊狀態仍然生效。

### 4.3 端點

| 動作 | 端點 | 角色 |
| --- | --- | --- |
| 訂閱列表／單店 | `GET /api/v1/admin/subscriptions`、`/:restaurantId` | 0 |
| 建立訂閱 | `POST /admin/subscriptions` | 0 |
| 改模組／方案／狀態 | `PATCH /admin/subscriptions/:restaurantId/modules`、`/plan`、`/status` | 0 |
| 用量與事件 | `GET /admin/subscriptions/:restaurantId/usage`、`/usage/events` | 0 |
| 金流商回調 | `POST /api/v1/billing/webhooks/:provider` | 公開 + 驗簽 |

### 4.4 配額

配額與模組是兩件事：模組管「能不能用」，配額管「用多少」。
`quotaGate(meterKey)` / `enforceQuota` 依 `PLAN_QUOTAS[planTier][meterKey]` 判斷，
超過回 429 `QUOTA_EXCEEDED`。**`QUOTA_ENFORCEMENT_MODE` 預設是 `disabled`**——
沒有設定成 `enforce` 時，配額只記錄不阻擋。

## 5. 系統設定

| 動作 | 端點 |
| --- | --- |
| 餐廳基本資料 | `PUT /api/v1/restaurants/:id` |
| 聯絡資訊 | `GET/PUT /restaurants/:id/contact-profile` |
| 服務品項 | `GET/POST/PUT/DELETE /restaurants/:id/service-items[...]` |
| 店家模式 | `PUT /restaurants/:id/shop-mode` |
| 通知設定 | `GET/PUT /api/v1/admin/notification-settings` |
| 設定同步 | `POST /admin/settings/sync`、`POST /users/settings/sync` |

餐廳 `settings` JSON 內的三個欄位會直接影響下單金額：`minOrderAmount`、`taxRate`、`serviceChargeRate`
（見 [01](./01-customer-ordering.md) §3.2 第 11–12 步）。

> **JSON 設定欄位不可以放密鑰。** OAuth 憑證、access／refresh token、client secret、webhook secret
> 一律只能存在加密欄位裡。

## 6. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 沒有訂閱紀錄 | 403「Subscription not found」 | `SUBSCRIPTION_NOT_FOUND` | 🟠 P1 |
| 帳號沒有綁餐廳 | 403 | `NO_RESTAURANT` | 🟡 P2 |
| 試用到期 | 403，訊息與一般模組未購買不同 | — | 🟡 P2 |
| 剛改完模組但仍被擋 | KV 快取最長 5 分鐘；忘記失效就是這個症狀 | — | 🟠 P1 |
| billing webhook 簽章錯誤 | 401 | `WEBHOOK_SIGNATURE_INVALID` | 🔴 P0 |
| billing webhook body 不是 JSON | 400 | `WEBHOOK_INVALID_JSON` | 🟡 P2 |
| 配額超過但模式是 `disabled` | 放行，只記錄 | — | 🟠 P1 |
| 讀取 AI 設定 | 永遠回 `"***"`，不回明文 | — | 🔴 P0（已防） |
| 調整 `taxRate` / `serviceChargeRate` | **立即影響新訂單金額**，已成立訂單不變 | — | 🟠 P1 |

## 7. 對應程式碼與測試

**程式碼**

- `apps/api/src/middleware/moduleGate.ts` — 模組解析、KV 快取、失效
- `apps/api/src/middleware/quotaGate.ts` — 配額與 `QUOTA_ENFORCEMENT_MODE`
- `apps/api/src/features/subscriptions/routes/index.ts`
- `apps/api/src/features/billing/routes/index.ts` + `services/BillingWebhookService.ts`
- `apps/api/src/features/analytics/routes/index.ts`、`ai-analytics/routes/index.ts`
- `packages/ai-analytics/src/services/ProductAnalysisService.ts`

**測試**

- `apps/api/src/app-factory.feature-gate.test.ts`
- `apps/api/src/features/billing/routes/index.test.ts`
- `apps/api/src/features/ai-analytics/routes/index.test.ts`

**相關文件**

- [architecture/modular-billing.md](../architecture/modular-billing.md)
- [specs/modular-billing-and-usage-metering.md](../specs/modular-billing-and-usage-metering.md)
- [runbooks/billing-incident-response.md](../runbooks/billing-incident-response.md)

## 8. 已知缺口

- **配額預設不強制**。`QUOTA_ENFORCEMENT_MODE` 未設成 `enforce` 時，超量只被記錄。
- **模組快取失效靠呼叫端自律**。沒有集中攔截，新增寫入路徑時很容易漏掉。
- **訪客路徑上的 module gate 需要自行提供 restaurantId**（`resolveGuestRestaurantId`），
  沒有提供就會因為 `NO_RESTAURANT` 被擋——這也是 `POST /guest-orders` 不掛 module gate 的原因之一。
