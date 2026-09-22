# 廚房流程

> **對應 master board**：現場作業 → 廚房流程（廚師 role 2）
> **主要角色**：廚師（role 2）；role 0/1/3 也讀得到廚房資料
> **最後對照原始碼**：2026-08-21

## 1. 定位

廚房顯示系統（`:3002`）從接單到出餐。它同時在動**兩條狀態階梯**——訂單狀態與品項狀態——
而系統不會幫你把兩者連起來，見 [02](./02-customer-order-tracking.md) §2。

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
| 4 | 開始製作（整單） | **廚房看板沒有送這一步**，見下方說明 | — |
| 5 | 逐項開始／完成 | `PUT /kitchen/:restaurantId/orders/:orderId/items/:itemId` | `order_items.status` |
| 6 | 整單出餐 | **廚房看板沒有送這一步**，見下方說明 | — |

> **廚房看板只會寫品項狀態。** 「Start Preparing」「Mark Complete」都只是對每個品項
> 送第 5 步；看板再用 `updateOrderStatusFromOrder` 在前端**自己推算**整單狀態，
> 從不呼叫 `PUT /orders/:id/status`。伺服器上的訂單因此停在 `confirmed`：顧客追蹤頁
> 停在「已確認」，送菜站（`status=ready`）永遠看不到這張單。重新整理後卡片跳回
> 「待製作」欄，而且「Start Preparing」只處理 `pending` 的品項，此時按了沒有反應。
> 目前只能由店主在後台手動推 `preparing` → `ready`。2026-09-22 在 production 實測成立，
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
| 重複標記同一個品項狀態 | 409（`WHERE status != 新值` 落空） | `ORDER_ITEM_STATUS_CONFLICT` | 🟡 P2 |
| 廚師想把訂單標成 `delivered` | 403（role 2 只有 preparing／ready） | `FORBIDDEN` | 🟠 P1 |
| 所有品項都 ready 但沒推訂單狀態 | **訂單停在 `preparing`**，送菜端看不到 | — | 🟠 P1 |
| 廚房斷網 | 前端 `offlineService` 把動作排進佇列，恢復連線後重放 | — | 🟡 P2 |
| 離線期間該訂單已被別人推進 | 重放時可能撞上 409；佇列有重試上限 `offline_sync_retry_limit` | — | 🟠 P1 |
| 切換餐廳（同一台機器） | `offlineService` 會丟掉前一個租戶的快取訂單與待送動作 | — | 🔴 P0（已防） |
| 舊版離線佇列送到已淘汰的 URL | `POST /kitchen/:orderId/items/:itemId/start`、`/ready` 兩個相容 shim 仍在，只印 `[deprecated-route]` 警告 | — | ⚪ P3 |
| 部署後前端 chunk 檔名改變 | 廚房顯示會自動重新載入（無人看顧的螢幕） | — | 🟡 P2 |

## 6. 併發與競態

- **品項狀態**用 `WHERE status != 新值` 當防重，兩台機器同時點同一個品項只有一台成功。
- **訂單狀態**用 `orders.version` 樂觀鎖，衝突回 409 要求重新載入。
- **離線重放沒有 idempotency key**：靠的是上面兩個「同值即衝突」的性質，所以重放安全但會看到 409。

## 7. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/kitchen/routes/index.ts` — SSE token（`:203`）、佇列（`:365`）、品項狀態（`:399`）
- `apps/api/src/features/kitchen/services/KitchenService.ts:185` — 更新與廣播；`:270` scope SQL
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

- **廚房看板完全不推訂單狀態**（見 §3 說明）。不只是「品項全部完成不會自動推」，
  整單的兩顆按鈕也只寫品項。廚房到送菜這一段在現行介面上走不通。
- **淘汰路由仍在**。`/start`、`/ready` 兩個 shim 原訂 2026-07-01 移除，尚未清掉。
- **SSE 與 WebSocket 兩條連線各自斷線重連**，UI 的「已連線」指示只反映 SSE 那條。
