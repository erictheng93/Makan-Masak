# 訂單追蹤與狀態鏈

> **對應 master board**：顧客端 → 訂單追蹤流程（同時是現場三端的共同骨幹）
> **主要角色**：顧客、role 0–4 全部
> **最後對照原始碼**：2026-08-21
> **細節圖**：[boards/order-status-chain.html](./boards/order-status-chain.html)

## 1. 定位

訂單成立之後，狀態怎麼往前走、誰有權推、四個端怎麼同時看到同一份狀態。
這條流程是廚房、送菜、收銀、顧客追蹤頁的共同骨幹——那三條流程各自只是這條鏈的一段。

## 2. 兩條互不連動的狀態階梯

這是最常被搞錯的一件事：**訂單有訂單的狀態，品項有品項的狀態，系統不會自動把兩者連起來。**

| 階梯 | 欄位 | 誰在動 |
| --- | --- | --- |
| 訂單狀態 | `orders.status` | `PUT /api/v1/orders/:id/status` |
| 品項狀態 | `order_items.status` | `PUT /api/v1/kitchen/:restaurantId/orders/:orderId/items/:itemId` |

廚師把最後一個品項標成 `ready` **不會**讓訂單變 `ready`；那需要另外呼叫訂單狀態端點。
（`KitchenService.updateOrderItemStatus` 只寫 `order_items` 並廣播，沒有任何 cascade。）

## 3. 訂單狀態機

八個狀態（`ORDER_STATUSES`），合法轉移由 `ORDER_STATUS_TRANSITIONS` 定義：

```
pending ──→ confirmed ──→ preparing ──→ ready ──→ delivered ──→ paid
   │            │             │           │            │
   └────────────┴─────────────┴───────────┘            └──→ refunded
                    （皆可 cancelled）
```

- `paid`、`cancelled`、`refunded` 是終點，出不去。
- **`delivered` 不能取消**，只能往 `paid` 或 `refunded`。
- 跳步是非法的：`pending → preparing` 直接 409 `INVALID_STATUS_TRANSITION`。

### 誰能推到哪一個狀態（`ROLE_STATUS_PERMISSIONS`）

| Role | 可設定的狀態 |
| --- | --- |
| 0 管理者 | pending / confirmed / preparing / ready / delivered / paid / cancelled |
| 1 店主 | confirmed / cancelled |
| 2 廚師 | preparing / ready |
| 3 送菜 | delivered |
| 4 收銀 | confirmed / paid |

同一份權限表在**路由層與服務層各檢查一次**（`routes/index.ts:598` 與 `OrdersService.validateStatusTransition`），
這是刻意的重複——服務層被其他路徑直接呼叫時仍受同一組規則約束。

## 4. Happy path（一次狀態推進實際發生什麼）

| # | 動作 | 程式 |
| --- | --- | --- |
| 1 | 取現況並確認餐廳歸屬 | `routes/index.ts:587`、`assertRestaurantAccess` |
| 2 | 路由層角色權限檢查 | `ROLE_STATUS_PERMISSIONS` |
| 3 | 服務層轉移合法性 + 角色權限再檢查 | `validateStatusTransition` |
| 4 | 帶 `expectedVersion` 的樂觀鎖更新 | `baseOrderService.updateOrderStatus` |
| 5 | 寫入該狀態的時間戳欄位（`confirmedAt`／`readyAt`…） | 同上 |
| 6 | `paid` / `delivered` 且有桌號 → 釋放桌位 | 同上 |
| 7 | 清除訂單快取 | `invalidateOrderCache` |
| 8 | 廣播到 `restaurant:` / `kitchen:` / `admin:` 三個房間 + `customer:order:{id}` | `finalizeOrderStatusSideEffects` |
| 9 | 終態（delivered/paid/cancelled/refunded）→ 解除訪客活躍鎖 | `clearGuestActiveOrderLock` |

## 5. 四端同源怎麼做到的

`RealtimeBroadcastService` 用 `REALTIME_SESSION.idFromName("${roomType}:${roomId}")` 取 Durable Object，
一則事件同時送進多個房間：

| 事件 | 送達房間 |
| --- | --- |
| 新訂單 | `restaurant:{id}`、`kitchen:{id}`、`admin:{id}` |
| 訂單狀態變更 | 上述三個 **＋ `customer:order:{orderId}`** |
| 品項狀態變更 | `restaurant:` / `kitchen:` / `admin:` |
| 訂單取消 | `restaurant:` / `kitchen:` / `admin:` |
| 菜單上下架 | `restaurant:` / `admin:` |

顧客端連的是 `customer:order:{orderId}` 房間，訪客先用 `POST /api/v1/realtime/auth/guest-token` 換連線 token
（前端會快取在 localStorage，過期自動清）。收到 `ORDER_STATUS_UPDATE` 後直接改寫 TanStack Query 快取，不重打 API。

## 6. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 兩個裝置同時推同一筆訂單 | 後到者版本對不上 → 409，要求重新載入 | `ORDER_VERSION_CONFLICT` | 🔴 P0 |
| 廚師想把訂單標成 `delivered` | 403 | `FORBIDDEN` | 🟠 P1 |
| 店主想把訂單標成 `paid` | 403（店主只有 confirmed / cancelled） | `FORBIDDEN` | 🟡 P2 |
| 從 `delivered` 想取消 | 409，`delivered` 只能到 paid／refunded | `INVALID_STATUS_TRANSITION` | 🟠 P1 |
| 對已 `paid` 的訂單再推任何狀態 | 409（終點狀態沒有出邊） | `INVALID_STATUS_TRANSITION` | 🟠 P1 |
| 跨餐廳操作他店訂單 | 403（role 0 除外） | — | 🔴 P0 |
| 重複標記同一個品項狀態 | 409（`WHERE status != 新值` 落空） | `ORDER_ITEM_STATUS_CONFLICT` | 🟡 P2 |
| 廚房對非 `confirmed/preparing/ready` 的訂單改品項 | 403（SQL 已把訂單狀態鎖進 WHERE） | `KITCHEN_ITEM_SCOPE_DENIED` | 🟠 P1 |
| `REALTIME_SESSION` 未設定 | 廣播直接跳過並回報成功，狀態仍已寫入 DB | — | 🟠 P1 |
| Durable Object 廣播失敗 | 記 error log，**不 rollback 狀態** | — | 🟠 P1 |
| KV 清除活躍鎖失敗 | 吞掉例外，狀態轉移照樣成功 | — | 🟡 P2 |
| 訪客 realtime token 過期 | `onAuthFailure` 清快取；顧客頁退化成手動 refetch | — | 🟡 P2 |
| 訂單取消時歸還庫存 | 用 `EXISTS(... status IN 可取消狀態)` 條件，避免重複歸還 | — | 🔴 P0 |

## 7. 併發與競態

- **樂觀鎖**：`orders.version` 每次 +1，`updateOrderStatus` 帶 `expectedVersion`。它保護的是「兩個人同時推」，
  不保護「同一人連按兩次同一個狀態」——後者會被狀態機擋下（同狀態不在轉移表裡）。
- **取消與歸還庫存**：整批 `db.batch`，且每一句歸還都帶 `EXISTS` 子查詢確認訂單當下仍在可取消狀態，
  所以重送取消不會把庫存加兩次。
- **廣播沒有順序保證**。四端各自收到事件，先後可能不同；UI 應以事件內的 `status` 為準，不要用「收到順序」推演。

## 8. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/orders/types/index.ts:500` — 狀態轉移表與角色權限表（單一真相）
- `apps/api/src/features/orders/routes/index.ts:568` — `PUT /:id/status`
- `apps/api/src/features/orders/services/OrdersService.ts:451` — 轉移驗證、樂觀鎖翻譯
- `apps/api/src/features/orders/services/order-finalization.ts` — 快取、廣播、活躍鎖釋放
- `packages/database/src/services/order.ts:1273` — 實際 UPDATE、時間戳、桌位釋放
- `packages/database/src/services/RealtimeBroadcastService.ts` — 房間扇出
- `apps/customer-app/src/views/OrderTrackingView.vue` — 顧客端訂閱與快取更新

**測試**

- `apps/api/src/features/orders/index.test.ts`
- `packages/database/src/services/RealtimeBroadcastService.test.ts`
- `tests/e2e/integration/real-workflows.spec.ts` — 瀏覽器觸發狀態更新（`integration` project，`nightly-integration.yml` 每晚跑）
- `tests/e2e/customer/order-tracking.spec.ts` — pending → delivered 不重整逐步跟上（含時間軸時間）、店家改數量與取消、訪客自己取消、delivered → paid、繼續點餐後回前一筆（#383）。屬於 `customer-real` project，CI 由 `test.yml` 的 `customer-real-e2e` job 執行（真 api ＋ realtime ＋ 本機 D1，不攔截回應）

**手動探索 QA（production）**

- [顧客端流程 QA 2026-09-15](../investigations/2026-09-15-customer-app-flow-qa.html) — C3、C9、C11、C12
- [顧客端上線 readiness QA 2026-09-18](../investigations/2026-09-18-customer-app-readiness-qa.html) — 狀態鏈與現金結帳重走

## 9. 已知缺口

- **品項狀態與訂單狀態沒有連動**（見 §2）。「整單好了」目前完全靠人工再推一次訂單狀態。
- **廣播失敗沒有重送或補償**，也沒有告警；只能靠各端重新拉清單自癒。
- **「預估還需 N 分鐘」寫死 15 分鐘基數**（#388），不讀每道菜設定的準備時間。
- **沒有狀態變更的稽核鏈**。`OrdersService.getOrderStatusHistory` 目前只回傳「當下狀態」單筆，不是歷史；
  `logOrderActivity` 也只寫 logger，沒有落任何稽核表。誰在什麼時候把訂單推到哪一狀態，事後查不到。
