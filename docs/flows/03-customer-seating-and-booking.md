# 座位與預約流程

> **對應 master board**：顧客端 → 座位與預約流程
> **主要角色**：訪客、顧客（role 5）、店主／送菜／收銀（受理端）
> **最後對照原始碼**：2026-08-21

## 1. 定位

四套長得很像、但資料與規則完全不同的系統。先分清楚再往下看：

| 系統 | 端點前綴 | 解決的問題 | 狀態機 |
| --- | --- | --- | --- |
| 候位 | `/api/v1/waiting-list` | 現場排隊取號、叫號入座 | 有，`WAITING_TRANSITIONS` |
| 排隊 | `/api/v1/queue` | 候位的**薄殼**：`UnifiedQueueService` 直接委派給 `WaitingListService`，同一份資料 | 同上 |
| 訂位 | `/api/v1/reservations` | 提前訂桌，有時段容量 | **沒有轉移守衛**（見 §5） |
| 預約服務 | `/api/v1/service-bookings` | 預約服務品項（非餐點），有時段、押金、提醒 | 有五態，但不強制轉移順序 |

> `/queue` 不是另一套排隊系統。它是舊路由收斂後留下的相容層，底下就是候位。
> 不要在兩邊各寫一次業務邏輯。

## 2. 候位流程

### 2.1 狀態機

```
waiting ──→ called ──→ confirmed ──→ seated
   │           │            │
   └───────────┴────────────┴──→ cancelled / expired
```

`called → seated` 是刻意允許的：被叫到就直接走進來的客人不必先按確認。
`seated` / `cancelled` / `expired` / `no_show` 都是終點。

### 2.2 Happy path

| # | 動作 | 端點 | 狀態 | 備註 |
| --- | --- | --- | --- | --- |
| 1 | 登記候位 | `POST /api/v1/waiting-list`（公開） | → `waiting` | 同號碼同店已有 active 票會直接回既有票 |
| 2 | 查前方組數 | `GET /queue-status/:restaurantId`、`GET /estimate-wait/:restaurantId`（公開） | — | 無資料時預設翻桌 45 分鐘 |
| 3 | 店家叫號並指定桌 | `POST /:id/call`（role 0/1/3/4） | → `called` | 桌位轉 `reserved`，設 **5 分鐘** `timeout_at` |
| 4 | 顧客確認 | `POST /:id/confirm`（公開） | → `confirmed` | 超時會先把票 `expired` 再回錯誤 |
| 5 | 入座 | `POST /:id/seat`（role 0/1/3/4） | → `seated` | 觸發 `confirmWaitingListPreOrders` 把預點訂單轉正並廣播 |

### 2.3 候位預點餐

候位票可以先點餐：送單時帶 `waitingListId` + `customerPhone`，訂單成立但**不廣播給廚房**，
等 `markSeated` 時才由 `confirmWaitingListPreOrders` 一次確認並廣播。細節見
[01-customer-ordering.md](./01-customer-ordering.md) §4。

## 3. 訂位流程

| # | 動作 | 端點 | 狀態 |
| --- | --- | --- | --- |
| 1 | 查可訂時段 | `GET /api/v1/reservations/availability`（公開） | — |
| 2 | 送出訂位 | `POST /api/v1/reservations`（公開） | → `pending` |
| 3 | 用代碼查詢 | `GET /verify/:code`（公開） | — |
| 4 | 店家確認 | `POST /:id/confirm` | → `confirmed` |
| 5 | 到店 → 入座 → 完成 | `POST /:id/arrive` → `/seat` → `/complete` | → `arrived` → `seated` → `completed` |
| — | 未到 | `POST /:id/no-show` | → `no_show`，釋放時段容量與桌位 |
| — | 取消 | `DELETE /api/v1/reservations/:id/cancel`（公開） | → `cancelled`，釋放容量 |

## 4. 預約服務流程

| # | 動作 | 端點 | 說明 |
| --- | --- | --- | --- |
| 1 | 查時段 | `GET /service-bookings/availability` | 有 slot 列才有容量上限；沒有 slot 列＝不限量 |
| 2 | 建立預約 | `POST /service-bookings` | 檢查服務啟用、歸屬、`requiresBooking`、營業時段 |
| 3 | 佔用容量 | `reserveSlotCapacity` | 條件式 UPDATE，失敗即整筆回滾 |
| 4 | 卷折抵與付款條件 | `priceVoucher` / `resolvePaymentTerms` | 預付／押金／到店付 |
| 5 | 發確認碼與行事曆 UID | `generateConfirmationCode` | 顧客憑碼查詢：`GET /verify/:code`，可下載 `.ics` |
| 6 | 付款 | `POST /:id/pay`（代幣）或 `POST /:id/confirm-cash`（現金） | → `confirmed` |
| 7 | 完成／未到 | `POST /:id/complete`、`POST /:id/no-show` | 終態 |

另有 `POST /recurring`（週期預約）、`POST /waitlist`（額滿候補）、`GET /reminders/due` + `POST /:id/reminder-sent`（提醒排程）。

## 5. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 同號碼重複登記候位 | 回傳既有的 active 票，不建立第二張 | — | 🟡 P2 |
| 叫號時桌位已被佔用／已配給別票 | 400「桌位不可用」（SQL 內含 `NOT EXISTS` 排除已配票的桌） | — | 🟠 P1 |
| 叫號時桌位容量小於人數 | 400「桌位容量不足」 | — | 🟡 P2 |
| 兩位店員同時叫同一張票 | `WHERE status = 'waiting'` 落空 → 「狀態已被其他操作更新」 | — | 🟠 P1 |
| 顧客超過 5 分鐘才按確認 | 先轉 `expired`，再回「叫號已超時，請重新排隊」 | — | 🟡 P2 |
| 對終態票再操作 | 409 `INVALID_STATUS_TRANSITION` | `INVALID_STATUS_TRANSITION` | 🟡 P2 |
| **訂位：對已 `completed` 的單再按確認** | **會成功**——`confirmReservation`/`markArrived`/`markSeated` 沒有狀態守衛，直接 UPDATE | — | 🟠 P1 |
| 訂位取消／no-show 重放 | 受影響列數為 0 → 直接回現況，**不會重複釋放容量** | — | 🔴 P0（已防） |
| 預約服務：時段額滿 | 條件式 UPDATE 落空 → 建立失敗 | — | 🟠 P1 |
| 預約服務：建立中途失敗 | `releaseSlotCapacity` 補償；補償失敗只記 log | — | 🟠 P1 |
| 預約服務：服務已停用或軟刪 | 404 `SERVICE_NOT_FOUND` | `SERVICE_NOT_FOUND` | 🟡 P2 |
| 預約服務：不接受預約的品項 | 400 `SERVICE_NOT_BOOKABLE` | `SERVICE_NOT_BOOKABLE` | ⚪ P3 |
| 拿到 ticket id 想代為取消／確認 | 403「電話號碼不符」（直接字串比對，不做正規化） | — | 🟠 P1（已防） |
| 候位查詢端點被掃 | `GET /history` 掛 `strictRateLimit`；`/lookup`、`GET /:id` 沒有 | — | 🟠 P1 |

## 6. 併發與競態

- **候位**：每一次轉移都把來源狀態寫進 `WHERE`，用受影響列數判斷輸贏，輸的一方回「請刷新」。
- **訂位**：只有 `cancel` 與 `no_show` 用了這個手法（因為它們要釋放容量，重放會多放一次）；
  往前的轉移沒有，所以會被重放。
- **預約服務**：容量用條件式 UPDATE 佔位 + 失敗補償，與訂單扣庫存同一個模式。

## 7. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/waiting-list/routes/index.ts` — 公開段（`:63`–`:290`）與受保護段（`:291` 之後）
- `packages/database/src/services/WaitingListService.ts` — 叫號、確認、入座、逾時
- `packages/database/src/services/ticket-primitives/state-machine.ts` — 候位轉移表
- `apps/api/src/features/queue/routes/index.ts` + `services/UnifiedQueueService.ts` — 相容層
- `packages/database/src/services/ReservationService.ts` — 訂位
- `apps/api/src/features/service-bookings/services/ServiceBookingService.ts` — 預約服務

**測試**

- `apps/api/src/features/service-bookings/services/ServiceBookingService.test.ts`
- `apps/api/src/__tests__/integration/service-booking.real.integration.test.ts`
- `tests/e2e/integration/real-workflows.spec.ts` — 預約建立／查詢／取消（`integration` project，`nightly-integration.yml` 每晚跑）
- `tests/e2e/customer/seating-and-bookings.spec.ts` — 候位登記 → 叫號 → 確認抵達（不重整）、通知權限未回答時票號照樣顯示並保存（R7）、預約服務讀回與名額扣減。線上訂位沒有測試，因為顧客端沒有畫面。屬於 `customer-real` project，CI 由 `test.yml` 的 `customer-real-e2e` job 執行（真 api ＋ realtime ＋ 本機 D1，不攔截回應）

**手動探索 QA（production）**

- [顧客端流程 QA 2026-09-15](../investigations/2026-09-15-customer-app-flow-qa.html) — C6
- [顧客端上線 readiness QA 2026-09-18](../investigations/2026-09-18-customer-app-readiness-qa.html) — R7、R8、R9、R15

## 8. 已知缺口

- **訂位缺少狀態轉移守衛**。`pending → seated → confirmed → arrived` 這種亂序目前擋不住，
  也沒有 `assertReservationTransition` 這種對應候位的共用檢查。
- **訂位入座不會自動開單**。`markSeated` 裡留著 `// TODO: 自動建立訂單記錄`。
- **候位的取消與確認有電話二次驗證，查詢沒有**。`DELETE /:id`、`POST /:id/confirm` 都要比對 `customerPhone`，
  但 `GET /waiting-list/:id` 只要有 ticket id 就回完整記錄（含姓名與電話），也沒有掛限流。
- **顧客端沒有線上訂位畫面，但給顧客用的公開端點已上線**（#385）。
- **服務預約顯示「待付款」卻沒有付款途徑或說明**，金額幣別寫死 TWD（#398）。
- **Web push 在 production 送不到任何人**（#399）：沒有 VAPID secret、前端用佔位公鑰、訪客不能訂閱，但取號時照樣詢問通知權限。叫號只靠頁面輪詢與即時連線。
- 候位與訂位的容量是兩套獨立計算，同一張桌可能同時被候位叫號與訂位指派——沒有共用的桌位鎖。
