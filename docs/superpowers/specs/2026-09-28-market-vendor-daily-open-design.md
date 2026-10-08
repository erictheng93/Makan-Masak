# 商圈攤位「今日開店」與開店紀錄報表設計

- 日期：2026-09-28
- 狀態：方向已確認，待審閱書面版本
- 範圍：商圈／夜市／hawker（`markets`）裡的攤位（`restaurant_market_memberships`）

## 1. 目標

1. 攤位在每個營業日**預設未開店**，店主在後台按一下「今日開店」就開始營業。
2. 掃商圈 QR（`MARKET-{slug}` → `/markets/:slug`）看到的攤位清單，以開店狀態為準：已開店的可點餐，未開店的灰色顯示「今日未營業」。
3. 未開店的攤位在伺服器端就不能下單，不只是前端隱藏。
4. 平台管理者與店主都能查開店紀錄報表：每日明細、期間彙總、當日營收，可匯出 CSV。

**成功標準**

- 上線當下所有攤位都是未開店；店主不按，客人就不能對它下單。
- 按下開店或收攤後，客人重新整理商圈頁面就看到新狀態，不會被 KV 快取擋住。
- 夜市營業過午夜不會中途消失：換日時間由每個商圈自訂。

## 2. 現況（2026-09-28 查證）

- 沒有任何手動開店欄位。`GET /markets/:slug/vendors`（`MarketsService.queryVendors`，`apps/api/src/features/markets/services/MarketsService.ts:1020`）用每週營業時間算 `isOpen`，預設不過濾，結果存在 KV（`CACHE_TTL.SHORT`）。
- 商圈結帳（`apps/api/src/features/market-checkouts/routes/index.ts:554–588`）檢查會籍、`isActive && isAvailable`、`allowGuestOrders`，不檢查營業時間或開店狀態。
- 店家時區在 `restaurants.timezone`，只允許固定時差時區（`packages/database/src/utils/business-timezone.ts`），所以營業日可以用固定位移計算。`markets` 沒有時區欄位。
- 店家後台已有商圈分頁（`SettingsView.vue` 的 `activeTab === 'markets'`）；平台商圈管理在 `PlatformMarketsView.vue`，API 在 `features/markets/routes/admin.ts`（`requireRole([0])`）。
- 最新 migration：`migrations_fresh/0033_restaurant_is_demo.sql`。

## 3. 已定案的決策

| # | 決策 | 理由 |
|---|---|---|
| D1 | 開店狀態存在會籍（`restaurant_market_memberships`），不存在店上 | 同一家店加入兩個商圈時，在夜市開店不會讓它出現在另一個 hawker |
| D2 | 「今日已開店」＝ 開店時間與現在屬於同一個營業日；不用 cron 重置 | 預設關店由規則自然產生，沒有排程會漏跑 |
| D3 | 營業日換日時間由每個商圈自訂，預設 05:00 | 使用者選擇；夜市營業過午夜 |
| D4 | 營業日用**攤位的時區**＋**商圈的換日時間**計算 | 商圈沒有時區欄位；同一商圈的攤位實際上同時區 |
| D5 | 開店按鈕優先，每週營業時間不再影響 `isOpen` | 使用者選擇；攤販實際開收時間不固定 |
| D6 | 未開店攤位照樣回傳，前端灰色顯示「今日未營業」 | 使用者選擇 |
| D7 | 只有店主（角色 1）能開店／收攤 | 預設，使用者未反對 |
| D8 | 每次開店／收攤寫一筆事件，報表由事件計算 | 報表需要開收時間、時長、操作者；只存目前狀態做不到 |
| D9 | 營收只算**這個商圈通路**的訂單（`market_checkout_child_orders`），而且 `orders.payment_status = 'completed'` | 報表問的是「在這個商圈擺攤的成果」，不含店自己 QR 的訂單 |
| D10 | 商圈 `openingHours` 保留，只作資訊顯示與出勤率分母 | 見 §6.3 |

## 4. 資料模型（migration 0034，手寫）

```sql
ALTER TABLE restaurant_market_memberships ADD COLUMN opened_at_ms INTEGER;
ALTER TABLE markets ADD COLUMN business_day_cutoff_minutes INTEGER NOT NULL DEFAULT 300
  CHECK (business_day_cutoff_minutes BETWEEN 0 AND 1439);

CREATE TABLE market_vendor_open_events (
  id TEXT PRIMARY KEY,                 -- UUID v7
  market_id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('open', 'close')),
  business_date TEXT NOT NULL,         -- 'YYYY-MM-DD'，事件發生時算好存下
  occurred_at_ms INTEGER NOT NULL,
  actor_user_id TEXT
) STRICT;
CREATE INDEX market_vendor_open_events_market_date_idx
  ON market_vendor_open_events (market_id, business_date);
CREATE INDEX market_vendor_open_events_restaurant_date_idx
  ON market_vendor_open_events (restaurant_id, business_date);
```

- `opened_at_ms`：目前狀態，給攤位清單快速判斷；收攤時設為 NULL。
- `business_date` 是日曆標籤，不是時間戳記；存下來是為了讓事後修改換日時間不會改寫歷史報表。
- 開店／收攤時，更新 `opened_at_ms` 和寫事件放在同一個 D1 `batch()`，兩者不會不一致。
- 兩個 `ALTER TABLE` 都是加欄位，不重建表；新表依規定 STRICT。要在 `migration-dual-track.json` 登記，並依 CLAUDE.md 的正式環境流程套用。
- Drizzle schema 同步加在 `packages/database/src/schema/markets.ts`。

## 5. 營業日規則

一個純函式，放在 `packages/database/src/utils/`（與 `business-timezone.ts` 同處），附單元測試：

```ts
businessDateOf(atMs, timezoneOffsetMinutes, cutoffMinutes): string // 'YYYY-MM-DD'
// = UTC 日期( atMs + offset*60_000 - cutoff*60_000 )

isOpenToday(openedAtMs, nowMs, offset, cutoff): boolean
// = openedAtMs != null && businessDateOf(openedAtMs) === businessDateOf(nowMs)
```

測試至少涵蓋：換日前一分鐘／換日當下、跨午夜（夜市 23:00 開、01:00 仍營業）、cutoff 0、非 +8 時區。

## 6. API

### 6.1 店主開店／收攤

- `POST /api/v1/restaurants/:restaurantId/markets/:marketId/open`
- `POST /api/v1/restaurants/:restaurantId/markets/:marketId/close`
- 角色 1，而且必須是該店的店主；會籍必須有效（`leftAt IS NULL`）、店必須 `isActive`。
- 冪等：今天已開店再按開店，回傳目前狀態，不重複寫事件；未開店按收攤同理。
- 成功後呼叫 `bumpPublicCacheVersion`，讓商圈攤位清單的 KV 快取失效。
- 回傳 `{ success: true, data: { isOpenToday, openedAt, businessDate } }`。
- 店家商圈列表（後台商圈分頁使用的 API）加上每個會籍的 `isOpenToday`。

### 6.2 客人端攤位清單

- `queryVendors` 的 `isOpen` 改為 `isOpenToday(...)`，不再看 `marketHours ?? businessHours`。
- `openNow` 參數語意跟著改成「只要今日已開店」。
- 快取：清單快取 key 加上「每個支援時區目前的營業日」組成的日期標記，任一時區換日時 key 就變，換日當下不必等 5 分鐘 TTL；開店／收攤則靠 `bumpPublicCacheVersion` 立即失效。

### 6.3 報表

- 平台：`GET /api/v1/admin/markets/:id/open-report?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]`（角色 0）
- 店主：`GET /api/v1/restaurants/:restaurantId/markets/:marketId/open-report?from&to[&format=csv]`（角色 1，只看自己的店；一次看一個商圈，因為每個商圈的換日時間與營業時間不同）
- 區間上限 92 天；`from > to` 或超過上限回 400 `VALIDATION_ERROR`。
- 查詢用 Drizzle（Layer 1／Layer 2），不寫 raw SQL。

**每日明細**（每個攤位 × 每個營業日一列；有開店事件或有訂單的日子才出列）

| 欄位 | 算法 |
|---|---|
| 營業日、攤位名稱、攤位號碼 | `business_date`、`restaurants.name`、`stallNumber` |
| 首次開店時間 | 當日第一筆 `open` |
| 最後收攤時間 | 當日最後一筆 `close`；若最後狀態仍是開店，則為該營業日結束（換日時間），標記「換日自動結束」 |
| 營業時長 | 每段「開店 → 收攤或營業日結束」加總，同一天可以開收多次 |
| 操作者 | 首次開店的 `actor_user_id` 對應的使用者名稱 |
| 訂單數、營業額 | 該商圈、該攤位、`created_at` 落在該營業日的子訂單，`payment_status = 'completed'`；營業額用攤位自己的幣別格式化 |

**期間彙總**（每個攤位一列）

- 開店天數
- 出勤率 = 開店天數 ÷ 應營業天數；應營業天數 = 區間內商圈 `openingHours` 有該星期幾、且沒有標為 `closed` 的天數（`openingHours` 為 NULL 或空物件則為區間總天數）；應營業天數為 0 時出勤率顯示為空
- 平均營業時長、訂單總數、營業額總計

CSV 沿用 `market-checkouts/routes/index.ts` 既有的匯出寫法（`text/csv; charset=utf-8`、日期檔名）。明細與彙總各一份 CSV，用 `view=daily|summary` 切換。

## 7. 下單檢查

- 商圈結帳在既有的會籍與 `isAvailable` 檢查旁，加上 `isOpenToday`；任一攤位未開店回 409 `VENDOR_NOT_OPEN_TODAY`，`details` 列出攤位 id。
- 既有的 shop-mode gate 不動（它本來就排除商圈子訂單）。

## 8. 前端

### 8.1 店家後台（admin-dashboard）

- **首頁卡片**：店有有效商圈會籍時，首頁頂端顯示每個商圈一張卡片。未開店時顯示大的「今日開店」膠囊按鈕（primary）；已開店時顯示「營業中 · 自 HH:mm」與次要的「提早收攤」按鈕，收攤前確認一次。
- **商圈分頁**：提供「開店紀錄」入口，打開店主報表（今日狀態與開收按鈕集中在首頁卡片，不重複放）。
- **報表頁**：日期區間、商圈篩選、明細／彙總切換、匯出 CSV。

### 8.2 平台（`PlatformMarketsView.vue`）

- 商圈編輯表單加「營業日換日時間」（HH:mm 輸入，存成分鐘數）。
- 商圈詳情加「開店紀錄」分頁：同一份報表，列出全部攤位。

### 8.3 客人端（customer-app）

- `MarketDetailView` 與攤位地圖：`isOpen = false` 的攤位灰色並顯示「今日未營業」，點擊不能進入點餐（`StallMapInMarket.vue`、`MarketLocationMap.vue` 已有 closed 樣式，改為用新的 `isOpen`）。
- 結帳收到 `VENDOR_NOT_OPEN_TODAY` 時顯示可理解的訊息，並把該攤位移出購物車。

所有 UI 依 `docs/UIUX-design-system.md` 與 `DESIGN.md`；新字串需補齊 i18n。

## 9. 不做（需要時再加）

- **即時推播**：客人已開著的頁面要重新整理才看到新開的攤位。需要時由 `apps/realtime` 推商圈頻道。
- **收銀員開店**：D7 只開放店主，需要時把角色 4 加入允許清單。
- **自動依營業時間開店**：與 D5 衝突，不做。
- **商圈內商品／服務搜尋（`MarketProductSearch`）的 `isOpen`**：這支搜尋走 discovery，仍依營業時間計算。未開店攤位的商品可能出現在搜尋結果，但點進攤位會被擋（§8.3），結帳也會被 §7 擋下。需要時再讓 discovery 的市集搜尋讀 `opened_at_ms`。

## 10. 測試

- `businessDateOf` / `isOpenToday` 單元測試（§5）。
- 開店／收攤路由：權限（非店主、非本店、已離開商圈）、冪等、快取失效有被呼叫。
- `queryVendors`：未開店回 `isOpen: false`、跨換日後自動變回未開店。
- 商圈結帳：未開店攤位回 409 `VENDOR_NOT_OPEN_TODAY`。
- 報表：多次開收加總、換日自動結束、營收只算 completed 的商圈子訂單、出勤率分母、92 天上限、CSV 標頭。
- 前端：首頁卡片兩種狀態、客人端灰色攤位不可點（用 `data-status`，不斷言 CSS class）。
