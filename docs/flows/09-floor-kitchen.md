# 廚房流程

> **對應 master board**：現場作業 → 廚房流程（廚師 role 2）
> **主要角色**：廚師（role 2）；role 0/1/3 也讀得到廚房資料
> **最後對照原始碼**：2026-09-22

## 1. 定位

廚房顯示系統（`:3002`）從接單到出餐。它同時在動**兩條狀態階梯**——訂單狀態與品項狀態——
並由伺服器在品項更新後連動訂單狀態，見 [02](./02-customer-order-tracking.md) §2。

## 2. 觸發與前置條件

| 項目 | 內容 |
| --- | --- |
| 進入點 | Kitchen Display `:3002`，廚師登入 |
| 角色 | `validateChefAccess` 允許 role **0/1/2/3**；但每個端點另外要求 `user.restaurantId === restaurantId` |
| 模組 | 全部端點掛 `moduleGate("kitchen_display")` |
| 可見訂單 | 只有 `confirmed` / `preparing` / `ready` 三種狀態 |

## 3. Happy path

| # | 動作 | 端點／程式 | 狀態變化 |
| --- | --- | --- | --- |
| 1 | 取得工作佇列 | `GET /api/v1/kitchen/:restaurantId/orders` | — |
| 2 | 連線狀態指示 | `POST /kitchen/:restaurantId/events/token` → `GET /kitchen/:restaurantId/events`（SSE） | — |
| 3 | 訂單事件 | Durable Object WebSocket，房間 `kitchen:{restaurantId}` | — |
| 4 | 開始製作（逐項或整單） | `PUT /kitchen/:restaurantId/orders/:orderId/items/:itemId` | 首個品項進 `preparing` 後，伺服器經 `OrdersService.updateOrderStatus` 把 `orders.status` 從 `confirmed` 推到 `preparing`，並寫 `preparing_at_ms` |
| 5 | 逐項完成 | 同上 | `order_items.status` → `ready` |
| 6 | 最後一項完成 | 同上 | 所有品項 `ready` 後，伺服器經同一條訂單狀態路徑把 `orders.status` 推到 `ready`，並寫 `ready_at_ms`；送菜站因而可見 |

> 這段行為是 #412 的修正：修正前廚房看板只寫品項狀態、伺服器訂單停在 `confirmed`，
> 見 [現場作業流程 QA 2026-09-22](../investigations/2026-09-22-floor-operations-flow-qa.html)。

> **SSE 那條串流只送 `connected` 與心跳。** 真正的訂單事件走 WebSocket。
> 會分成兩條，是因為 `EventSource` 不能帶 Authorization header，所以另外簽了一把
> `aud: "kitchen_sse"` 的短效 token 只給那條串流用。

## 4. 品項狀態的守門

`getScopedKitchenItem` 把四個條件寫進同一句 SQL：品項 id、訂單 id、餐廳 id，
**以及訂單狀態必須在 `('confirmed','preparing','ready')` 之內**。
任一條件不滿足就回 403 `KITCHEN_ITEM_SCOPE_DENIED`——所以廚房動不了已付款或已取消的訂單。

## 5. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 廚師存取他店訂單 | 403 | `ACCESS_DENIED` | 🔴 P0 |
| 對已 `paid` 的訂單改品項 | 403（SQL 條件擋下） | `KITCHEN_ITEM_SCOPE_DENIED` | 🟠 P1 |
| 重複標記同一個品項狀態 | 視為安全重放；不重寫品項，回傳目前伺服器訂單狀態 | — | 🟢 已防 |
| 廚師想把訂單標成 `delivered` | 403（role 2 只有 preparing／ready） | `FORBIDDEN` | 🟠 P1 |
| 所有品項都 ready | 訂單自動進 `ready`，送菜端可見 | — | 🟢 已防 |
| 廚房斷網 | 前端 `offlineService` 把動作排進佇列，恢復連線後重放 | — | 🟡 P2 |
| 離線期間該訂單已被別人推進 | 重放時可能撞上 409；佇列有重試上限 `offline_sync_retry_limit` | — | 🟠 P1 |
| 切換餐廳（同一台機器） | `offlineService` 會丟掉前一個租戶的快取訂單與待送動作 | — | 🔴 P0（已防） |
| 舊版離線佇列送到已淘汰的 URL | `POST /kitchen/:orderId/items/:itemId/start`、`/ready` 兩個相容 shim 仍在，只印 `[deprecated-route]` 警告 | — | ⚪ P3 |
| 部署後前端 chunk 檔名改變 | 廚房顯示會自動重新載入（無人看顧的螢幕） | — | 🟡 P2 |

## 6. 併發與競態

- **品項狀態**底層仍用 `WHERE status != 新值` 防止重複寫；KitchenService 在同值時把它當作成功重放，並重新核對父訂單狀態。
- **訂單狀態**一律走 `OrdersService.updateOrderStatus`，由 `orders.version` 樂觀鎖、時間戳、快取失效與 realtime 廣播共同處理。
- **同時操作不同品項**時，若其中一台先推進父訂單，另一台遇到版本衝突會重新讀取最新狀態；已由對方完成的轉換會視為成功，不會在品項已寫入後回 409。

## 7. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/kitchen/routes/index.ts` — SSE token（`:203`）、佇列（`:365`）、品項狀態（`:399`）
- `apps/api/src/features/kitchen/services/KitchenService.ts` — 品項更新、訂單狀態連動與廣播
- `apps/kitchen-display/src/services/offlineService.ts` — 離線佇列與租戶切換清理
- `apps/kitchen-display/src/services/realtimeService.ts`、`kitchenApi.ts`

**測試**

- `apps/api/src/features/kitchen/services/KitchenService.test.ts`
- `apps/kitchen-display/src/stores/orders.offline.test.ts`
- `apps/api/src/__tests__/integration/kitchen.real.integration.test.ts`
- `tests/e2e/kitchen-display/kitchen-display.spec.ts`

**手動探索 QA（production）**

- [現場作業流程 QA 2026-09-22](../investigations/2026-09-22-floor-operations-flow-qa.html) — K1–K3

## 8. 已知缺口

- **淘汰路由仍在**。`/start`、`/ready` 兩個 shim 原訂 2026-07-01 移除，尚未清掉。
- **SSE 與 WebSocket 兩條連線各自斷線重連**，UI 的「已連線」指示只反映 SSE 那條。
