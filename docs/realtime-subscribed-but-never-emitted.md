# Realtime：前端有訂閱、後端沒發送的事件清單

- 盤點日期：2026-10-15（`main` @ `600236c80`）
- 方法：靜態搜尋（grep），範圍為 `apps/*/src`、`packages/*/src`，排除測試、`dist`、`.wrangler`、i18n。
- 「發送」定義：`apps/api` 或 `packages/database` 內，有程式碼經 `RealtimeBroadcastService` 呼叫
  `apps/realtime` 的 `RealtimeSession` `/broadcast`。
- 限制：只能偵測字面值與 enum 引用。若事件型別是執行期組字串，這份清單會誤判為「沒發送」。

## 1. 發送路徑總覽（作為比對基準）

後端唯一的出口是 `RealtimeBroadcastService.broadcastEvent(roomType, roomId, event)`。呼叫端只有：

| 呼叫端 | 事件 |
| --- | --- |
| `OrdersService`、`order-finalization` | `new_order`、`order_status_update`、`order_cancelled` |
| `KitchenService` | `order_item_status_update`、`kitchen_item_status` |
| `MenuService` | `menu_availability_update`、`menu_item_update` |
| `WaitingListService` | `waiting_list_joined/called/confirmed/seated/cancelled/expired` |
| `group-orders/routes`、`workers/group-order-expiry` | `group_order_created`、`group_member_joined`、`group_cart_item_added/updated/removed`、`group_order_completed` |

舊的 HTTP 入口都不是發送路徑：

- `features/sse/routes` 的 `/broadcast/*`、`/notify/group` 一律回 `410 ENDPOINT_RETIRED`。
- OpenAPI 曾宣告 `POST /api/v1/realtime/broadcast/:roomType/:roomId`（`broadcastMessageRoute`），
  但從未實作；2026-10-15 已從 OpenAPI 刪除。

## 2. 清單 A：`RealtimeEventType` enum 中，前端訂閱、後端沒發送

| 事件 | 前端訂閱位置 | 備註 |
| --- | --- | --- |
| `table_status_update` | admin-dashboard：`useRealtimeQueue.ts`（約 56、75 行）、`services/realtimeService.ts` | 後台桌況無法即時更新 |
| `table_call_service` | admin-dashboard：`useAdminRealtime.ts`（約 393 行） | 後端也沒有「顧客叫服務」的路由，是整個功能缺席 |
| `kitchen_queue_update` | admin-dashboard：`useAdminRealtime.ts`（約 374、379 行） | 廚房佇列概況不會推送 |
| `system_notification` | admin-dashboard：`useRealtimeConnection.ts`、`useAdminRealtime.ts`、`services/realtimeService.ts` | 沒有任何系統公告發送點 |
| `restaurant_status_update` | admin-dashboard：`useRealtimeConnection.ts`、`useAdminRealtime.ts`；customer-app：`useWebSocket.ts`（`useRestaurantStatus`） | 營業狀態變更不會推給後台或顧客 |

enum 內其餘值的狀況：

- `connection_ack`、`heartbeat`、`error`：由 `RealtimeSession` 自己直接發給連線，不經 `/broadcast`，屬正常。
- 其餘 enum 值（訂單、廚房品項、菜單、候位、團購）後端都有發送。

## 3. 清單 B：admin-dashboard `REALTIME_EVENTS` 常數裡的裸字串事件

`apps/admin-dashboard/src/services/realtimeService.ts` 的 `REALTIME_EVENTS` 定義了一批不在 enum 內的字串。
後端沒有任何一個發送，且 `REALTIME_EVENTS.GROUP_*`、`POS_*` 等在 admin-dashboard 內也沒有任何元件引用。

**團購類**

- `group_order_updated`
- `group_order_expired`
- `group_order_completed`（字串形式；enum 的 `GROUP_ORDER_COMPLETED` 有發送，但只發到 `customer` 房間，admin 不在其中）
- `group_order_cancelled`
- `group_member_left`
- `group_member_promoted`
- `group_member_activity`
- `group_cart_conflict`
- `group_cart_synced`
- `group_split_initiated`
- `group_split_updated`
- `group_payment_completed`
- `group_payment_failed`
- `group_payment_reminder`

**POS／營運類**

- `pos_transaction`
- `cash_movement`
- `shift_started`
- `shift_ended`
- `register_status_changed`
- `user_activity`

## 4. 清單 C：customer-app 舊版 WebSocket 路徑

`apps/customer-app/src/composables/useWebSocket.ts` 內的 `useOrderTracking`、`useRestaurantStatus`：

| 項目 | 內容 |
| --- | --- |
| 連線路徑 | `${VITE_WS_BASE_URL}/orders/:id/tracking`、`${VITE_WS_BASE_URL}/restaurants/:id/status` |
| 訊息型別 | `order_update`、`notification`、`restaurant_status_update` |
| 問題 | `apps/realtime` 只開放 `/customer/:id`、`/menu/:id`、`/admin/:id`、`/kitchen/:id`，這兩個路徑不存在；`order_update`、`notification` 也不是後端事件 |
| 使用情況 | 檔案內只有定義，搜尋不到其他呼叫端（`useWebSocket` 本體則被 `useMenuRealtime`、`useGroupOrder`、`OrderTrackingView` 使用） |

`useOrderTracking`、`useRestaurantStatus` 看起來是死碼。

## 5. 清單 D：別名映射裡指向「沒人發送的舊名稱」

`CANONICAL_EVENT_ALIASES`（admin-dashboard `services/realtimeService.ts`）把下列舊名稱轉成 enum。
後端從不發這些舊名稱，映射不會被觸發：

`order_created`、`order_updated`、`order_status_changed`、`menu_updated`、
`queue_joined`、`queue_called`、`queue_notified`、`queue_seated`、`queue_no_show`、`queue_cancelled`、
`table_occupied`、`table_available`、`table_reserved`、`table_cleaning`

候位與訂單其實有發送，只是用的是 enum 名稱（`waiting_list_*`、`new_order` 等），所以功能不受影響。
桌況那四個（`table_*`）最終映射到的 `table_status_update` 本身就沒有發送，見清單 A。

## 6. 影響摘要

| 面向 | 現況 |
| --- | --- |
| 後台桌況 | 無即時推送，需手動重整或輪詢 |
| 顧客叫服務 | 前後端缺實作 |
| 營業狀態 | 變更不會推給顧客或後台 |
| 系統公告 | 無發送點 |
| 廚房佇列概況 | 後台訂閱但永遠收不到 |
| 團購進階事件、POS 事件 | 常數存在，沒有人發也沒有人用 |

## 7. 處理狀態

| 清單 | 狀態 | 說明 |
| --- | --- | --- |
| A | 已處理（2026-10-15） | 見下表 |
| B | 已清理（2026-10-15） | 刪除 admin `REALTIME_EVENTS` 常數整體；`useRealtimeQueue` 改直接引用 `RealtimeEventType` |
| C | 已清理（2026-10-15） | 刪除 customer-app `useOrderTracking`、`useRestaurantStatus` 與不再使用的 import |
| D | 已清理（2026-10-15） | 刪除 admin `CANONICAL_EVENT_ALIASES` 與 `normalizeEventType`；`subscribe` 直接使用 enum 值 |

驗證：`customer-app`、`admin-dashboard` 的 typecheck、lint、test 全數通過
（860 與 1017 個測試）。

### 清理後仍存在的項目

- OpenAPI 的 `broadcastMessageRoute`（未實作）已刪除，連同孤立的 request/response schema。
- 清單 A 的訂閱都還在（例如 `useRealtimeQueue` 訂閱 `table_status_update`）。
- 順手去重：舊的 `QUEUE_CALLED` 與 `QUEUE_NOTIFIED` 同時映射到 `waiting_list_called`，
  桌況四個別名映射到同一個 `table_status_update`，現在各只訂閱一次。

### 清單 A 的處理結果

| 事件 | 處理 | 理由 |
| --- | --- | --- |
| `table_status_update` | **補發送** | `tables` 的 occupy、release、clean 路由成功後，經 `TablesService.broadcastStatusUpdate` 推到 `admin` 房間 |
| `kitchen_queue_update` | **補發送** | 儀表板的 `RealtimeNotificationPanel` 靠它顯示廚房佇列，沒有它數字永遠是 0。`KitchenService` 在品項狀態變更後，用一次 GROUP BY 查詢算出各狀態數量與平均等待 |
| `table_call_service` | 刪訂閱 | 後端沒有 service-requests 路由，顧客端也沒有呼叫端；要做需要公開端點的濫用防護，屬新功能。同時刪除 customer-app 未使用、指向不存在端點的 `orderApi.requestService` |
| `system_notification` | **補發送**（2026-10-15 後續） | 餐廳告警（`restaurant_alerts`）新開立時，`features/alerts/producers.ts` 經 `RestaurantAlertService.raiseWithStatus` 判斷是新建（非 dedupe 命中）才推到 `admin` 房間；admin 面板以 `alertType` + `details` 本地化顯示，連線後另外載入目前開啟中的告警 |
| `restaurant_status_update` | 刪訂閱 | 沒有手動開關店的寫入路徑，營業狀態由營業時間計算 |

順手修掉的 bug：`useRealtimeQueue.handleTableUpdate` 以 `message.type.includes("occupied")`
判斷桌況，但 `message.type` 恆為 `table_status_update`，所以 `type` 永遠是 `cleaning`，
「桌位現已可用」通知永遠不會出現。改為讀 `message.data.status`。

### 仍待處理

- 面板的系統告警是「通知」，不是告警狀態的真相來源：在 OwnerView 解決或升級告警後，面板內的項目要到重新整理才會消失。
- 補發送的事件只推到 `admin` 房間，這是刻意的：`table_status_update`、`kitchen_queue_update` 的唯一訂閱者是 admin-dashboard，
  kitchen-display 與 customer-app 都沒有訂閱。推到 kitchen 房間只會增加 Durable Object 扇出而沒有消費者；
  等 kitchen-display 真的要用時再加。
