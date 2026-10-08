# 店務主流程

> **對應 master board**：店家後台 → 店務主流程
> **主要角色**：店主（role 1）、管理者（role 0）；部分動作開放廚師（role 2）
> **最後對照原始碼**：2026-08-21

## 1. 定位

店主每天在後台做的五件事：看儀表板、處理訂單、維護菜單、設定選項群組、管理桌位與 QR。
每一項都掛 `moduleGate`，所以「這家店有沒有買這個模組」會直接影響端點可用性。

## 2. 觸發與前置條件

| 項目 | 內容 |
| --- | --- |
| 進入點 | Admin Dashboard `:3001`，登入後依 role 導向 |
| 角色 | role 1；role 0 需先選定店家（`adminRestaurantId`），否則導向平台總覽 |
| 模組 | 菜單需 `menu_management`、桌位需 `table_management`、訂單需 `online_ordering` |
| 租戶隔離 | 非 role 0 一律以 `user.restaurantId` 比對資源歸屬，不符即 403 |

## 3. Happy path

### 3.1 營運儀表板

| 動作 | 端點 |
| --- | --- |
| 今日概況 | `GET /api/v1/analytics/owner-dashboard`、`/dashboard` |
| 即時單量 | `GET /api/v1/analytics/realtime-dashboard`、`GET /analytics/sse` |
| 活躍訂單 | `GET /api/v1/orders/active` |

### 3.2 訂單管理

| 動作 | 端點 | 備註 |
| --- | --- | --- |
| 列表與篩選 | `GET /api/v1/orders` | 依角色套用可見範圍 |
| 確認訂單 | `PUT /orders/:id/status` → `confirmed` | 店主只能推 `confirmed` 與 `cancelled` |
| 取消訂單 | `PUT /orders/:id/status` → `cancelled` 或 `DELETE /orders/:id` | 取消會歸還庫存 |
| 批次處理 | `POST /orders/bulk` | 限 role 0/1；回傳逐筆 `results` 與 `errors` |
| 匯出 | `POST /orders/export` | |
| 收據 | `GET /orders/:id/receipt` | 計 `print.jobs` 配額 |

狀態機與角色權限見 [02-customer-order-tracking.md](./02-customer-order-tracking.md)。

### 3.3 菜單管理

| 動作 | 端點 | 角色 |
| --- | --- | --- |
| 新增品項 | `POST /menu/:restaurantId/items` | 0/1 |
| 修改品項 | `PUT /menu/items/:id` | 0/1/**2** |
| 刪除品項 | `DELETE /menu/items/:id` | 0/1（軟刪） |
| 批次上下架 | `PATCH /menu/:restaurantId/items/availability` | 0/1/**2** |
| 批次調價 | `PATCH /menu/:restaurantId/items/prices` | 0/1 |
| 批次改分類 | `PATCH /menu/:restaurantId/items/categories` | 0/1 |
| 分類 CRUD 與排序 | `POST/PUT/PATCH/DELETE /menu/.../categories...` | 0/1 |

**廚師只能改兩個欄位**：`isAvailable` 與 `inventoryCount`。送出其他欄位不是被忽略，而是直接 403
`CHEF_FIELD_NOT_ALLOWED`——讓 client 知道整筆沒有套用，而不是以為部分成功。
（`updatedAt` 是例外：那是樂觀鎖前置條件，不是欄位寫入。）

### 3.4 選項群組

| 動作 | 端點 |
| --- | --- |
| 群組 CRUD | `GET/POST /menu/:restaurantId/option-groups`、`PUT/DELETE /menu/option-groups/:groupId` |
| 選項 CRUD | `POST /menu/option-groups/:groupId/choices`、`PATCH/DELETE /menu/option-choices/:choiceId` |
| 綁定到品項 | `GET/PUT /menu/items/:id/option-groups` |

選項加價會在下單時由伺服器重算（`resolveCatalogCustomizations`），必填群組沒選或超過上限會讓下單回
400 `INVALID_CUSTOMIZATION`。

### 3.5 桌位、座位與 QR

| 動作 | 端點 |
| --- | --- |
| 桌位 CRUD | `GET/POST/PUT/DELETE /api/v1/tables` |
| 佔用／釋放／清潔 | `POST /tables/:id/occupy`、`/release`、`/clean` |
| 座位批次建立 | `POST /api/v1/seats/batch-create` |
| 批次 QR | `POST /tables/bulk-qr`、`POST /seats/batch-regenerate-qr` |
| 店家公開 QR | `POST /restaurants/:id/qr/shop/generate`、`/regenerate`、`GET /qr/shop` |
| 店家模式開關 | `PUT /restaurants/:id/shop-mode` |

**QR 輪替是三段式的**，因為貼紙要先印出來才能換：

| 段 | 端點 | 效果 |
| --- | --- | --- |
| prepare | `POST /tables/:id/qr/prepare` | 產生 `pending_qr_code`（版本 +1），**舊碼仍有效** |
| activate | `POST /tables/:id/qr/activate` | 把 pending 升為現行，舊碼失效 |
| discard | `POST /tables/:id/qr/discard` | 丟掉 pending，什麼都沒變 |

重複 prepare 會回傳同一組 pending code，不會再鑄一次——否則已經印好的貼紙會當場作廢。

## 4. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 兩個店員同時編輯同一品項 | 若帶了 `updatedAt`，後到者 409 | `MENU_ITEM_MODIFIED` | 🟠 P1 |
| 沒帶 `updatedAt` | **不檢查**，後寫的直接覆蓋 | — | 🟠 P1 |
| 廚師送出價格欄位 | 403，整筆拒絕 | `CHEF_FIELD_NOT_ALLOWED` | 🔴 P0 |
| 只調降 `originalPrice` 造成負折扣 | 400（partial body 也會跟庫存的另一半比對） | — | 🟡 P2 |
| 把品項改到別家店的分類 | `validateCategoryAccess` 擋下 | — | 🟠 P1 |
| 刪除品項 | 軟刪：寫 `deleted_at_ms` **並**把 `isAvailable` 設 false | — | — |
| 重複刪除 | 冪等，保留原本的刪除時間戳 | — | — |
| 跨店存取資源 | 403 Access denied（role 0 除外） | — | 🔴 P0 |
| 未購買模組 | `moduleGate` 直接擋 | — | 🟡 P2 |
| 店家 QR 重新產生後舊貼紙 | 下單時 403 | `SHOP_QR_REVOKED` | 🟡 P2 |
| 桌位 QR activate 後舊貼紙 | 掃描驗證回 404 | `TABLE_QR_STALE` | 🟠 P1 |
| 菜單改動 | 失效 `menu:{restaurantId}` 快取 tag，並 `syncMenuItems` 觸發搜尋索引重建 | — | — |

## 5. 併發與競態

- **菜單樂觀鎖是 opt-in**：`assertNotModifiedSince` 在 `expected === undefined` 時直接放行。
  前端有送 `updatedAt` 才有保護。這是相容性妥協，不是設計上的鬆綁。
- **QR 輪替的 pending 欄位就是鎖**：`pendingQrCode` 存在時 prepare 是冪等的。
- **桌位佔用**：`tables.isOccupied` / `currentOrderId` 由訂單流程在 `paid` / `delivered` 時自動釋放，
  與後台的手動 `occupy` / `release` 共用同一組欄位——兩邊同時操作會互相覆蓋。

## 6. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/menu/routes/index.ts` — 角色與模組閘門、廚師欄位白名單（`:61`）
- `apps/api/src/features/menu/services/MenuService.ts:294` — 樂觀鎖、價格一致性、分類歸屬
- `packages/database/src/services/menu.ts:794` — 實際寫入與快取失效；`:838` 軟刪
- `apps/api/src/features/tables/routes/index.ts:624` — QR 三段式輪替
- `packages/database/src/services/table.ts:770` — pending code 冪等
- `apps/admin-dashboard/src/views/MenuView.vue`、`OrdersView.vue`、`seating/TableSetupTab.vue`

**測試**

- `apps/api/src/features/menu/services/MenuService.test.ts`
- `apps/admin-dashboard/src/views/MenuView.test.ts`、`OrdersView.test.ts`
- `apps/api/src/__tests__/integration/menu.real.integration.test.ts`
- `tests/e2e/admin/`（`admin-real` project，真 API＋真 D1）：`dashboard-and-setup`、`order-management`、`menu-management`、`option-groups`

**手動探索 QA（production）**

- [店家後台流程 QA 2026-09-01](../investigations/2026-09-01-admin-dashboard-flow-qa.html) — F1–F6（含 08-25 首輪 #254–#270）

## 7. 已知缺口

- **樂觀鎖沒有強制**（見 §5）。舊前端或直接打 API 的整合都能無聲覆蓋。
- **桌位佔用狀態有兩個寫入者**（訂單流程與後台按鈕），沒有仲裁規則。
- **批次改狀態繞過角色權限表**。`POST /orders/bulk` 路由本身限 role 0/1，但它呼叫
  `updateOrderStatus` 時**沒有傳 `userRole`**，服務層的 `ROLE_STATUS_PERMISSIONS` 檢查因此被跳過——
  店主可以透過批次端點把訂單推到單筆端點不允許他推的狀態（例如 `paid`）。轉移合法性仍會檢查。
  （逐筆結果與錯誤倒是有回傳：`BulkOrderResult.results` / `.errors`。）
