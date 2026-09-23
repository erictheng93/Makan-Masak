# 地區政策（國家／市集）設計

- 日期：2026-09-23
- 狀態：設計已確認，待審閱書面版本
- 前置：[入駐地區與市集歸屬](../plans/2026-09-20-onboarding-locale-and-market.md)（`restaurants.country_code`，migration 0028）

## 1. 目標

讓平台管理員在後台，依國家與市集推不同政策，不需要部署程式碼。第一版涵蓋四類：

1. 功能開關（哪些模組在某國／某市集不開放）
2. 預設值（稅率、服務費）
3. 金流可用性（允許哪些線上金流商）
4. 平台費率與方案（國家的市集費率上限、可販售的方案）

**成功標準**

- 政策表為空時，系統行為與現在完全相同，所以上線本身零風險。
- 在後台修改一筆政策後，5 分鐘內所有 API 生效，而且有稽核紀錄。
- 上層的「上限」類政策，無法被店家覆寫或單店的模組覆寫繞過。

## 2. 已定案的決策

| # | 決策 | 理由 |
|---|---|---|
| D1 | 政策存在 platform D1，由 management-portal 編輯 | 使用者要求即時修改、不必部署 |
| D2 | 採用「單一 `policies` 表 + 程式碼中的 key 登記表」（方案 A） | 新增政策只要加一筆登記、不用改表；合併語意集中在一處 |
| D3 | 分三層：國家 → 市集（依情境）→ 店 | 在哪個市集交易，就套哪個市集的政策 |
| D4 | 衝突規則依類型：功能與金流是**上限**；稅率與服務費是**預設**；平台費率與方案**只有平台能設** | 符合法規與金流合約的現實，又不把店家本來就該能調的東西鎖死 |
| D5 | 國別為 NULL 的店跳過國家層，行為維持現狀 | 不猜國家（0028 的註解）；正式環境回填前，這些店不受國家政策影響 |
| D6 | 國家層的平台費率 = **市集費率上限**；市集的實際費率仍存在 `markets.platformFeeRateBps` | 獨立店目前沒有任何收平台費的路徑；同一個值不該有兩個來源 |

## 3. 不在範圍內

- **方案價格**：程式裡沒有計價模型（`BillingCycleService` 把 `'TWD'` 和 overage `0` 寫死），需要另開題目。
- **獨立店的平台抽成**：沒有請款路徑，與方案價格一起處理。
- **依國家計稅**：目前只有合併點單（group orders）從 `settings.taxRate` 算稅。讓所有訂單依國家計稅屬於稅務功能，另案處理。
- **電子發票**、**新增國家**（VN 等）。
- **店層政策**：店層沿用既有機制（`shop_subscriptions.module_overrides`、`restaurants.settings`），不進 `policies` 表。
- **`GET /payments/methods/:country`**（`apps/api/src/features/payments/routes/index.ts:361`）：admin-dashboard 的 `stores/payment.ts` 依賴它回傳的付款方式名稱（`credit_card`、`touch_n_go`…），這套命名和金流商的命名是兩回事，這次不動，也不拿它當政策來源。
- **現金與 POS 臨櫃付款**不受金流政策限制。

## 4. 資料模型

### 4.1 `policies` 表（platform 軌 migration `0030_policies.sql`）

```sql
CREATE TABLE `policies` (
  `id` TEXT PRIMARY KEY NOT NULL,              -- UUID v7
  `scope_type` TEXT NOT NULL,                  -- 'country' | 'market'
  `scope_id` TEXT NOT NULL,                    -- 'TW' / 'MY' 或 markets.id
  `policy_key` TEXT NOT NULL,
  `value` TEXT NOT NULL,                       -- JSON，寫入前經登記表 zod 驗證
  `updated_by` TEXT,                           -- 管理員識別
  `created_at_ms` INTEGER NOT NULL,
  `updated_at_ms` INTEGER NOT NULL,
  CHECK (`scope_type` IN ('country', 'market'))
) STRICT;
CREATE UNIQUE INDEX `policies_scope_key_idx`
  ON `policies` (`scope_type`, `scope_id`, `policy_key`);
```

- 手寫 SQL 並加上 `STRICT`，另外在 `migration-dual-track.json` 登記、`strict-table-policy.json` 通過檢查。
- 在 `packages/database/src/schema/policies.ts` 寫 Drizzle schema，並從 `index.ts` 匯出。
- 修改歷史不存在這張表，改寫進 platform 的 `audit_logs`（§7）。

### 4.2 政策登記表（`packages/database/src/policies/registry.ts`）

放在 `packages/database`，因為值域要用到 `MODULES`、`PLAN_TIERS`，這兩個已經在該套件裡；而且 `apps/api` 和 `management-api` 都依賴它。`packages/shared-types` 沒有 zod 依賴，不適合放這裡。

每個 key 宣告以下內容：

```ts
interface PolicyDefinition<T> {
  key: PolicyKey;
  schema: z.ZodType<T>;
  merge: "ceiling_deny" | "ceiling_allow" | "default" | "platform_cap";
  scopes: readonly ("country" | "market")[];
  unset: T | null;        // 各層都沒設時的值；必須等於現狀
}
```

第一版的 key：

| key | 值 | merge | scopes | unset |
|---|---|---|---|---|
| `modules.disabled` | `ModuleKey[]` | `ceiling_deny`：各層取聯集 | country, market | `[]` |
| `payments.allowed_providers` | `NativePaymentProvider[]` | `ceiling_allow`：各層取交集 | country, market | `null`（不限制） |
| `pricing.default_tax_rate_bps` | int 0–10000 | `default`：越下層越優先 | country, market | `null` |
| `pricing.default_service_charge_rate_bps` | int 0–10000 | `default` | country, market | `null` |
| `plans.allowed_tiers` | `PaidPlanTier[]` | `ceiling_allow` | country | `null`（不限制） |
| `platform.max_fee_rate_bps` | int 0–10000 | `platform_cap` | country | `null`（不設上限） |

- `NativePaymentProvider`（`stripe`、`linepay`、`ecpay`、`newebpay`、`tng`、`grabpay`）目前只是 `apps/api/src/shared/utils/provider-money.ts` 裡的型別。改成在登記表旁定義一個 `NATIVE_PAYMENT_PROVIDERS` 常數，`provider-money.ts` 的型別從它推導，只保留一個來源。
- `PaidPlanTier` 是 `basic | pro | enterprise`。`trial` **不可列入、永遠允許**，因為開通流程（`SubscriptionService.provisionDefaultForRestaurant`）一律給 trial；如果國家能禁止 trial，開通就會壞掉。
- 比率一律用 bps 整數，和 `markets.platformFeeRateBps` 一致。`restaurants.settings.taxRate`／`serviceChargeRate` 目前存的是小數，解析器輸出預設值時換算成小數（`bps / 10000`）。

## 5. 解析器

`apps/api/src/shared/policy/resolvePolicies.ts`

```ts
resolvePolicies(env, { restaurantId, marketId? }): Promise<EffectivePolicies>
```

1. 讀取店家的 `country_code`。NULL 就跳過國家層（D5）。
2. 有 `marketId` 時才讀市集層。**只有呼叫端明確傳入 `marketId` 才套市集政策**。第一版只有市集合併結帳路徑會傳；一般點餐、後台、POS 只合併國家層和店家層。
3. 依 `merge` 合併，輸出型別化的 `EffectivePolicies`：

```ts
interface EffectivePolicies {
  modulesDisabled: ReadonlySet<ModuleKey>;
  allowedProviders: ReadonlySet<NativePaymentProvider> | null; // null = 不限制
  defaultTaxRate: number | null;            // 小數
  defaultServiceChargeRate: number | null;  // 小數
  allowedPaidTiers: ReadonlySet<PaidPlanTier> | null;
  maxFeeRateBps: number | null;
}
```

解析器只負責合併國家層和市集層。店家層在各執行點與這個結果合併，因為各執行點已經有自己的店家資料來源（見 §6）。

**快取**

- KV key 用範圍，不用店家：`policy:v1:country:<code>`、`policy:v1:market:<id>`。值是該範圍所有列的 `{key: value}`，TTL 300 秒，比照 `moduleGate`。
- 以範圍為 key，改一次國家政策只要清一個 key。
- `apps/api` 和 `management-api` 在正式環境共用同一個 `CACHE_KV` namespace（兩邊 `wrangler.toml` 的 production id 都是 `5850dad46b684f2d8b69b3344d146a1d`），所以後台可以直接清快取。實作時要確認 dev 設定也共用同一個 namespace（兩邊都是 `makanmasak-cache-dev`）。

## 6. 執行點

| 政策 | 位置 | 行為 |
|---|---|---|
| `modules.disabled` | `apps/api/src/middleware/moduleGate.ts` 的 `resolveModule` 之後 | 模組在關閉清單中 → 403 `MODULE_NOT_AVAILABLE_IN_REGION`。平台管理員（role 0）照舊不受限。依 D4，單店的 `module_overrides` 也開不起來 |
| `payments.allowed_providers` | ① `shop-payments` 連接金流帳號時；② 以 `NativePaymentProvider` 發起線上付款的路徑（`PaymentService`、`ShopWalletGateway`、`ShopWalletMarketCheckoutGateway`；市集結帳路徑傳入所屬 session 的 `marketId`，寫計畫時逐一確認呼叫端拿得到它） | 不在允許清單中 → 403 `PAYMENT_PROVIDER_NOT_ALLOWED` |
| `pricing.default_*` | 讀取 `settings.taxRate`／`serviceChargeRate` 的地方（目前只有 `GroupOrdersService`，約在 :2066、:3037） | 改成 `店家設定 ?? 政策預設 ?? 0` |
| `plans.allowed_tiers` | `SubscriptionService` 由平台調整方案時 | 付費方案不在允許清單中 → 400 `PLAN_NOT_AVAILABLE_IN_REGION`。系統自動動作（試用到期降級到 basic、開通給 trial）**不擋** |
| `platform.max_fee_rate_bps` | `MarketsService` 建立或更新市集時；admin-dashboard 的市集匯入（`utils/marketImport.ts`）；市集結帳計費時（`market-checkouts/routes/index.ts` 的 `clampPlatformFeeRateBps`） | 存檔時超過上限 → 400 `PLATFORM_FEE_ABOVE_REGION_CAP`；結帳時 clamp 到上限，作為保險 |

市集要跟一個國家對應，才能套用國家的費率上限。`markets` 表沒有 `country_code`，第一版依 `markets.city` 反查 `COUNTRY_PROFILES`，和入駐流程篩選市集的邏輯相同。城市對不到任何國家時，不套上限。

**政策收緊時，既有資料怎麼辦**：只擋新動作，不動既有資料。已經連接、但現在不被允許的金流帳號會保留，只是無法發起付款；已經在不被允許方案上的店家維持原方案；費率已經超過上限的市集，由結帳時的 clamp 生效，下一次存檔時才會被要求修正。

## 7. 後台

### 7.1 API（`management-api`，掛在 `managementAuthMiddleware` 後面）

| 方法 | 路徑 | 用途 |
|---|---|---|
| GET | `/api/v1/admin/policies/registry` | 回傳登記表（key、值型別與可選值、merge、scopes），前端依此產生表單 |
| GET | `/api/v1/admin/policies?scope_type=&scope_id=` | 讀取某個範圍的所有政策 |
| PUT | `/api/v1/admin/policies/:scope_type/:scope_id/:policy_key` | 設定一個值 |
| DELETE | 同上 | 移除，回到上一層或「沒設定」的值 |

**PUT／DELETE 的處理順序：**

1. 用登記表的 zod 驗證值，並檢查 `scope_type` 在該 key 的 `scopes` 裡。
2. 檢查範圍存在：國家要在 `SUPPORTED_COUNTRIES` 裡，市集要存在於 `markets`。
3. 在同一個 D1 batch 裡 upsert（或刪除）`policies` 的列，並寫一筆 `audit_logs`：`resource = 'policies'`，`changes` 記修改前後的值，另記修改者。
4. `CACHE_KV.delete(policy:v1:<scope_type>:<scope_id>)`。

錯誤一律使用統一格式（`ApiError` + 全域 handler）。

### 7.2 management-portal「地區政策」頁

- 範圍選擇：國家分頁（TW／MY），或搜尋市集。
- 項目依登記表產生：清單類用勾選框，比率用百分比輸入框（存成 bps）。
- 每一項標示語意（上限／預設／僅平台），以及「未設定，沿用上一層」的狀態，並提供「清除」按鈕。
- 樣式照 `DESIGN.md` 與 `docs/UIUX-design-system.md`，`pnpm check:design-palette` 要通過；所有字串進六個語系。

## 8. 錯誤處理

- **壞資料**：從 `policies` 讀出的值如果不符合登記表的 schema（例如有人直接改了資料庫），該筆當作「沒設定」，並記錄錯誤（`console.error` + 既有錯誤回報）。一筆壞資料不能讓整個 API 失效。
- **讀取失敗**（D1 或 KV 出錯）：上限類政策**不寬鬆處理**，因為出錯就等於解除管制。
  - 金流與方案檢查回 503 `POLICY_UNAVAILABLE`，讓付款可以重試（5xx 會釋放付款的 idempotency key，和 `RESTAURANT_CURRENCY_INVALID` 的處理方式相同）。
  - `moduleGate` 同樣回 503。它讀不到訂閱時已經是直接擋下（403），這裡保持「讀不到就擋」的方向，但用 503 正確反映這是暫時性失敗。
  - 預設值類政策讀取失敗時回退為 `0`，也就是現狀，不擋交易。

## 9. 測試

- **登記表**：每個 key 的 schema 拒絕超出值域的值；`plans.allowed_tiers` 拒絕 `trial`。
- **解析器**（單元測試）：覆蓋每種 merge 語意；國別 NULL；有無 `marketId`；壞資料被略過；KV 命中與未命中；讀取失敗時丟出可辨識的錯誤。
- **執行點**：每一處至少一個測試，證明上層擋得住下層。例如單店 `module_overrides` 開了、國家關了 → 403；政策表為空 → 行為與現在相同。
- **management-api**：PUT／DELETE 要測驗證、層級限制、範圍存在性、`audit_logs` 寫入、KV 清除（mock 呼叫驗證）。
- **real D1 整合測試**：migration 建出 STRICT 表，唯一索引拒絕重複的 `(scope_type, scope_id, policy_key)`。
- **portal**：表單依登記表產生，bps 與百分比雙向換算正確。

## 10. 上線順序

1. 在正式環境套用 migration `0030`（新增空表，舊程式不會碰到）。照 CLAUDE.md 手動套用正式環境 D1 的程序執行。
2. 部署 `apps/api`。表是空的，所以行為不變。
3. 部署 `management-api` 與 `management-portal`。
4. **開始設定任何國家政策之前，必須先在正式環境執行 `scripts/backfill-restaurant-country.sql`。** 否則舊店的 `country_code` 是 NULL，會被國家政策漏掉（D5）。這是營運前置條件，不是程式能擋的事，在 portal 的國家分頁上方顯示「國別未知的店家數」作為提醒。
