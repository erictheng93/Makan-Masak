# 地區政策（國家／市集）設計

- 日期：2026-09-23（第二版：補上限類政策的失敗行為、各 key 的執行情境、市集國別、國別未知門檻、金流豁免範圍、快取生效保證）
- 狀態：設計已確認，待審閱書面版本
- 前置：[入駐地區與市集歸屬](../plans/2026-09-20-onboarding-locale-and-market.md)（`restaurants.country_code`，migration 0028）

## 1. 目標

讓平台管理員在後台，依國家與市集推不同政策，不需要部署程式碼。第一版涵蓋四類：

1. 功能開關（哪些模組在某國不開放）
2. 預設值（稅率、服務費）
3. 金流可用性（允許哪些線上金流商）
4. 平台費率與方案（國家的市集費率上限、可販售的方案）

**成功標準**

- 政策表為空時，系統行為與現在完全相同，所以上線本身零風險。
- 後台修改一筆政策後，**最多 6 分鐘**內所有 API 生效（§5.2 說明為什麼是 6 分鐘），而且有稽核紀錄。
- 上限類政策無法被店家覆寫、單店模組覆寫、壞資料或讀取失敗繞過。**失敗時一律阻擋，不放行。**
- 政策收緊不影響已經成立的交易：退款、查詢狀態、webhook、對帳一律照常。

## 2. 已定案的決策

| # | 決策 | 理由 |
|---|---|---|
| D1 | 政策存在 platform D1，由 management-portal 編輯 | 使用者要求即時修改、不必部署 |
| D2 | 採用「單一 `policies` 表 + 程式碼中的 key 登記表」（方案 A） | 新增政策只要加一筆登記、不用改表；合併語意集中在一處 |
| D3 | 分三層：國家 → 市集（依情境）→ 店 | 在哪個市集交易，就套哪個市集的政策 |
| D4 | 衝突規則依類型：功能與金流是**上限**；稅率與服務費是**預設**；平台費率與方案**只有平台能設** | 符合法規與金流合約的現實，又不把店家本來就該能調的東西鎖死 |
| D5 | 國別為 NULL 的店跳過國家層；但**設定國家層的上限類政策時有硬性門檻**（D10） | 不猜國家（0028 的註解），也不讓「沒回填」變成繞過政策的方式 |
| D6 | 國家層的平台費率 = **市集費率上限**；市集的實際費率仍存在 `markets.platformFeeRateBps` | 獨立店目前沒有任何收平台費的路徑；同一個值不該有兩個來源 |
| D7 | **資料無效或讀取失敗時，上限類政策阻擋操作（503），預設類政策退回現狀（0）** | 上限類退回「不限制」就等於故障即解除管制 |
| D8 | **一個 key 只開放在確實拿得到該層情境的層級**：第一版只有 `payments.allowed_providers` 開放市集層 | 開放了卻沒有執行點，後台可以設定、但靜默無效 |
| D9 | **市集要有明確的 `country_code` 欄位**；收平台費（>0）的市集必須有國別 | 用城市文字反查國家會對不到而失敗開放 |
| D10 | **國家層上限類政策的寫入門檻**：只要還有國別未知的店，就回 409 並列出這些店；管理員必須帶上確認的店家數才能寫入 | 回填只靠提醒會被忽略 |
| D11 | **金流政策只限制兩件事**：新的帳號連接或重新啟用、新的扣款授權。退款、狀態查詢、webhook、對帳、中斷連接一律豁免 | 政策收緊時，不能讓已成立的交易無法退款或對帳 |
| D12 | 生效保證是「最多 6 分鐘」，不做版本號或強一致失效 | 競態的影響以 TTL 為上限；用常數換掉一整套失效機制不划算（§5.2） |

## 3. 不在範圍內

- **次國家區域層（城市、州、省）**：模型只有國家與市集兩層。要支援的話，是在 `scope_type` 加一個值、在登記表開放該層、並讓店家與市集有對應欄位，不需要重新設計，但這次不做。
- **方案價格**：程式裡沒有計價模型（`BillingCycleService` 把 `'TWD'` 和 overage `0` 寫死），需要另開題目。
- **獨立店的平台抽成**：沒有請款路徑，與方案價格一起處理。
- **依國家計稅**：目前只有合併點單（group orders）從 `settings.taxRate` 算稅。讓所有訂單依國家計稅屬於稅務功能，另案處理。
- **電子發票**、**新增國家**（VN 等）。
- **店層政策**：店層沿用既有機制（`shop_subscriptions.module_overrides`、`restaurants.settings`），不進 `policies` 表。
- **`GET /payments/methods/:country`**（`apps/api/src/features/payments/routes/index.ts:361`）：admin-dashboard 的 `stores/payment.ts` 依賴它回傳的付款方式名稱（`credit_card`、`touch_n_go`…），這套命名和金流商的命名是兩回事，這次不動，也不拿它當政策來源。
- **現金與 POS 臨櫃付款**不受金流政策限制。`apps/api` 目前只有 shop wallet（`tng`、`grabpay`）是真正呼叫外部金流的路徑；`PaymentService` 只記錄付款，方法名稱是任意字串。

## 4. 資料模型

### 4.1 `policies` 表（platform 軌 migration `0030_policies.sql`）

```sql
CREATE TABLE `policies` (
  `id` TEXT PRIMARY KEY NOT NULL,              -- UUID v7
  `scope_type` TEXT NOT NULL CHECK (`scope_type` IN ('country', 'market')),
  `scope_id` TEXT NOT NULL,                    -- 'TW' / 'MY' 或 markets.id
  `policy_key` TEXT NOT NULL,
  `value` TEXT NOT NULL,                       -- JSON，寫入前經登記表 zod 驗證
  `updated_by` TEXT,                           -- 管理員 email
  `created_at_ms` INTEGER NOT NULL,
  `updated_at_ms` INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX `policies_scope_key_idx`
  ON `policies` (`scope_type`, `scope_id`, `policy_key`);
```

Drizzle schema 放在 `packages/database/src/schema/policies.ts`（匯出名稱 `regionPolicies`）。修改歷史不存在這張表，改寫進 platform 的 `audit_logs`（§7）。

### 4.2 `markets.country_code`（platform 軌 migration `0031_market_country_code.sql`）

- `ALTER TABLE markets ADD COLUMN country_code TEXT`，加上索引。允許 NULL。
- 同一個 migration 依 `COUNTRY_PROFILES` 的城市清單回填：城市名稱完全符合的，填入 TW 或 MY；對不到的維持 NULL，交給人工處理。
- 寫入規則（`apps/api` 市集的建立、更新、批次匯入）：
  - 可以明確指定 `countryCode`，否則由 `countryForCity(city)` 推導。
  - 明確指定的國別和城市推導出的國別不一致 → 400 `MARKET_COUNTRY_CITY_MISMATCH`。
  - 更新時沒改城市、也沒指定國別 → 保留原值。改了城市但沒指定 → 依新城市重新推導。
  - **平台費率大於 0 的市集，國別不能是 NULL** → 400 `MARKET_COUNTRY_REQUIRED`。費率為 0 的市集不受影響，所以既有的免費市集照常運作。

### 4.3 政策登記表（`packages/database/src/utils/region-policies.ts`）

放在 `packages/database`，因為值域要用到 `MODULES`、`PLAN_TIERS`，而且 `apps/api` 和 `management-api` 都依賴它。

| key | 值 | merge | scopes | 各層都沒設定時 |
|---|---|---|---|---|
| `modules.disabled` | `ModuleKey[]` | `ceiling_deny`：取聯集 | country | `[]` |
| `payments.allowed_providers` | `NativePaymentProvider[]` | `ceiling_allow`：取交集 | country, market | 不限制 |
| `pricing.default_tax_rate_bps` | int 0–10000 | `default`：下層優先 | country | 無 |
| `pricing.default_service_charge_rate_bps` | int 0–10000 | `default` | country | 無 |
| `plans.allowed_tiers` | `PaidPlanTier[]` | `ceiling_allow` | country | 不限制 |
| `platform.max_fee_rate_bps` | int 0–10000 | `platform_cap` | country | 不設上限 |

- 清單類的值不能重複；列舉以外的值一律拒絕。
- `PaidPlanTier` 是 `basic | pro | enterprise`。`trial` 不可列入、永遠允許，因為開通一律給 trial。
- `NativePaymentProvider` 的常數 `NATIVE_PAYMENT_PROVIDERS` 定義在登記表旁，`apps/api/src/shared/utils/provider-money.ts` 的型別從它推導。
- 比率一律用 bps 整數；`restaurants.settings.taxRate`／`serviceChargeRate` 是小數，兩者以 `bps / 10000` 換算。
- **營運規則**：從程式碼移除某個模組、金流商或方案之前，要先把它從所有已儲存的政策中移除。否則舊值會變成不合法，上限類政策會依 D7 讓相關操作回 503。

## 5. 解析器

### 5.1 介面

`apps/api/src/shared/policy/regionPolicies.ts`

```ts
resolveRegionPolicies(deps, { countryCode, marketId? }): Promise<EffectiveRegionPolicies>
```

- 輸入是國別，不是店家 id：各執行點本來就持有店家資料，`moduleGate` 更不能每個請求多讀一次 DB。
- 國別為 NULL 就跳過國家層；只有明確傳入 `marketId` 才讀市集層。
- 各層的列經登記表解析。**不合法的列**：
  - 預設類的 key：當作沒設定，並記錄錯誤。
  - 上限類與平台類的 key：放進 `unavailableKeys`。之後讀到這個 key 的執行點會回 503 `POLICY_UNAVAILABLE`。
- D1 或 KV 讀取失敗：整體丟 503 `POLICY_UNAVAILABLE`。要寬鬆處理的呼叫端（稅率預設值）自己接住，退回 0。

```ts
interface EffectiveRegionPolicies {
  modulesDisabled: ReadonlySet<ModuleKey>;
  allowedProviders: ReadonlySet<NativePaymentProvider> | null; // null = 不限制
  defaultTaxRate: number | null;            // 小數
  defaultServiceChargeRate: number | null;
  allowedPaidTiers: ReadonlySet<PaidPlanTier> | null;
  maxFeeRateBps: number | null;
  unavailableKeys: ReadonlySet<RegionPolicyKey>;  // 資料無效的上限類 key
}
```

### 5.2 快取與生效保證

- KV key 以範圍為單位：`policy:v1:country:<code>`、`policy:v1:market:<id>`。值是該範圍解析後的結果（含不合法的 key 清單），TTL 300 秒。
- 後台寫入後會刪除對應的 key。`apps/api` 和 `management-api` 在正式環境共用同一個 `CACHE_KV` namespace（production id `5850dad46b684f2d8b69b3344d146a1d`；dev 兩邊都是 `makanmasak-cache-dev`）。
- **已知競態**：讀取端在寫入之前讀到舊值，寫入端刪除 key 之後，讀取端才把舊值寫回 KV。這個舊值最多活 300 秒。另外 KV 在邊緣節點有最多約 60 秒的讀取快取。所以最壞情況是**寫入後約 6 分鐘**全面生效，通常刪除 key 後幾秒內就會生效。
- 如果之後需要更短的保證，做法是在 key 裡加上每個範圍的版本號（寫入時遞增），讓舊值自然失效；這次不做（D12）。

## 6. 各 key 的執行對照表

| key | 層級 | 情境從哪裡來 | 執行點 | 豁免 | 資料無效或讀取失敗 |
|---|---|---|---|---|---|
| `modules.disabled` | 國家 | 店家的 `country_code`，存在訂閱快取（`CachedSubscription.countryCode`）裡 | `moduleGate`（所有掛了模組閘門的路由）；`GET /me/modules` 把被關閉的模組回報為 false | 平台管理員（role 0） | 503 |
| `payments.allowed_providers` | 國家、市集 | 連接時：店家國別。扣款時：店家國別 + 市集結帳 session 的 `marketSlug` → `markets.id` | ① `ShopPaymentCredentialService.connect`，以及把 `update` 改回 connected／換 merchantId（只套國家層）；② `ShopWalletMarketCheckoutGateway.process`（新扣款；套國家與市集層） | 退款（`refundShopWalletMarketCheckoutPayment`）、狀態查詢、webhook、對帳、中斷連接、`loadGatewayCredentials` 本身 | 503；`marketSlug` 對不到市集時也回 503 |
| `pricing.default_tax_rate_bps`、`pricing.default_service_charge_rate_bps` | 國家 | 店家的 `country_code` | `GroupOrdersService` 的拆帳與成員小計；店家自己的設定優先 | — | 當作沒設定 → 0（現狀） |
| `plans.allowed_tiers` | 國家 | 店家的 `country_code` | `POST /subscriptions`、`PATCH /subscriptions/:id/plan` | 開通給 trial、試用到期自動降級到 basic | 503 |
| `platform.max_fee_rate_bps` | 國家 | 市集的 `country_code` | `apps/api` 市集的建立、批次匯入、更新；management-api 設定上限時反向檢查既有市集 | — | 503（市集寫入被擋） |

**政策收緊時，既有資料怎麼辦**：只擋新動作，不動既有資料。已經連接、但現在不被允許的金流帳號會保留，已成立的付款照常退款與對帳；已經在不被允許方案上的店家維持原方案。費率上限不會出現既有資料違規：設定上限時如果已有市集超過，會直接拒絕（§7）。

## 7. 後台

### 7.1 API（`management-api`，掛在 `managementAuthMiddleware` 後面）

| 方法 | 路徑 | 用途 |
|---|---|---|
| GET | `/api/v1/admin/policies/registry` | 回傳登記表（key、值型別與可選值、merge、scopes） |
| GET | `/api/v1/admin/policies?scope_type=&scope_id=` | 某個範圍的所有政策；國家範圍另外回傳 `restaurantsWithoutCountry` |
| PUT | `/api/v1/admin/policies/:scope_type/:scope_id/:policy_key` | 設定一個值；body `{ value, acknowledgeRestaurantsWithoutCountry? }` |
| DELETE | 同上 | 移除；冪等 |

**PUT 的處理順序：**

1. 範圍存在：國家必須在 `SUPPORTED_COUNTRIES` 裡（否則 400 `POLICY_SCOPE_INVALID`）；市集必須存在且未刪除（否則 404 `POLICY_SCOPE_NOT_FOUND`）。
2. 登記表驗證：未知 key → 404 `POLICY_KEY_UNKNOWN`；層級不允許 → 400 `POLICY_SCOPE_NOT_ALLOWED`；值不合法 → 400 `POLICY_VALUE_INVALID`。
3. **國別未知門檻（D10）**：國家範圍的 `modules.disabled`、`payments.allowed_providers`、`plans.allowed_tiers`，只要還有國別為 NULL 的店（未刪除），就回 409 `POLICY_BLOCKED_BY_UNKNOWN_COUNTRY`，附上總數和前 50 家店的 id 與名稱。body 帶的 `acknowledgeRestaurantsWithoutCountry` 必須**等於目前的總數**才放行；數字不符（例如又多了新店）就再擋一次。確認的數字寫進稽核紀錄。
4. **費率上限門檻（D6、D9）**：`platform.max_fee_rate_bps` 在以下任一情況回 409 `POLICY_CAP_BELOW_EXISTING_MARKET_FEES`，並列出相關市集：該國有市集的費率超過新上限，或有國別為 NULL、費率大於 0 的市集（它們會逃過上限）。這個門檻不能用確認跳過，要先修正市集資料。
5. 在同一個 D1 batch 裡 upsert（或刪除）`policies`，並寫一筆 `audit_logs`：`userId = NULL`（管理員不在 platform 的 users 表裡）、`action = system_config`、`resource = 'policies'`、`resourceId = <scope_type>:<scope_id>:<key>`，`changes` 記錄修改前後的值，metadata 放管理員 id 與 email。
6. `CACHE_KV.delete(policy:v1:<scope_type>:<scope_id>)`。

錯誤一律使用統一格式（`ApiError` + 全域 handler）。

### 7.2 management-portal「地區政策」頁

- 範圍選擇：國家分頁（TW／MY），或下拉選擇市集。市集範圍只顯示允許市集層的 key。
- 項目依登記表產生：清單類用勾選框，比率用百分比輸入框（存成 bps）。
- 每一項標示語意（上限／預設／僅平台），以及「未設定，沿用上一層」的狀態，並提供「清除」按鈕。
- 國家分頁顯示國別未知的店家數。儲存時碰到 `POLICY_BLOCKED_BY_UNKNOWN_COUNTRY`，顯示確認對話框（包含店家數），管理員確認後帶上該數字重送。
- 樣式照 `DESIGN.md`，所有字串進六個語系。

## 8. 錯誤處理

| 情況 | 上限類與平台類 | 預設類 |
|---|---|---|
| 某一列不是合法 JSON 或不符合 schema | 該 key 進入 `unavailableKeys`；讀到它的執行點回 503 | 當作沒設定，記錄錯誤 |
| D1 或 KV 讀取失敗 | 503 `POLICY_UNAVAILABLE` | 退回 0，不擋交易 |
| 市集結帳的 `marketSlug` 對不到市集 | 503 | — |

503 會釋放付款的 idempotency key，讓付款可以重試，和 `RESTAURANT_CURRENCY_INVALID` 的處理方式相同。`moduleGate` 讀不到訂閱時原本就是直接擋下（403），這裡保持「讀不到就擋」的方向，但用 503 正確反映這是暫時性失敗。

## 9. 測試

- **登記表**：每個 key 的 schema 拒絕超出值域的值；`plans.allowed_tiers` 拒絕 `trial`；`modules.disabled` 與 `pricing.*` 在市集層被拒絕；不合法的上限類 key 進入 `unavailableKeys`，預設類的不會。
- **解析器（real D1 + real KV）**：各種合併語意；國別 NULL；有無 `marketId`；KV 命中；沒有 KV；壞資料；讀取失敗回 503。
- **執行點**：每一處至少一個測試證明上層擋得住下層，並且：
  - 金流：**退款在政策收緊後仍然成功**，且不會查詢政策；扣款被擋時不會呼叫 gateway。
  - 方案：被擋時不會修改方案。
  - 市集：費率大於 0 但國別未知時被擋；城市與國別不一致時被擋。
  - 政策表為空時，行為與現在相同。
- **management-api**：驗證、層級限制、範圍存在性、國別未知門檻（包括確認數字不符會再擋一次）、費率上限門檻（包括國別未知的收費市集）、`audit_logs` 寫入、KV 清除。
- **portal**：表單依登記表產生、bps 與百分比雙向換算、國別未知確認後重送。

## 10. 上線順序

1. 正式環境依 CLAUDE.md 的手動程序套用 `0030`、`0031`。套用 `0031` 之前，先在 schema 副本上確認回填結果，並列出國別仍為 NULL 的市集。
2. 部署 `apps/api`。政策表是空的，行為不變；唯一的新限制是「費率大於 0 的市集必須有國別」，只在市集被寫入時才檢查。
3. 部署 `management-api` 與 `management-portal`。
4. 在正式環境執行 `scripts/backfill-restaurant-country.sql`。之後國家層上限類政策的寫入，會被 D10 的門檻擋到國別未知的店都處理完，或由管理員明確確認為止。
