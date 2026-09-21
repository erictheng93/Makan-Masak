# 送菜流程

> **對應 master board**：現場作業 → 送菜流程（送菜員 role 3）
> **主要角色**：送菜員（role 3）；role 0/1 也能進同一個畫面
> **最後對照原始碼**：2026-08-21

## 1. 定位

把 `ready` 的餐點送到桌上，然後標記 `delivered`。
這是四條現場流程裡**最薄的一條**——沒有專屬的 API feature，整條流程只借用訂單端點。
「配送中」不是訂單狀態，是這台裝置上的本地標記，見 §4。

## 2. 觸發與前置條件

| 項目 | 內容 |
| --- | --- |
| 進入點 | Admin Dashboard 的 `/service` 路由（`ServiceLayout` + `ServiceView.vue`） |
| 角色 | role 0 / 1 / 3 |
| API | 沒有 `features/service-crew`；用的是 `GET /api/v1/orders` 與 `PUT /api/v1/orders/:id/status` |
| 權限 | `ROLE_STATUS_PERMISSIONS[3] = ["delivered"]`——送菜員**只能**設這一個狀態 |

## 3. 設計上的 Happy path

| # | 動作 | 端點 | 狀態變化 |
| --- | --- | --- | --- |
| 1 | 待送清單 | `GET /orders?status=ready&restaurantId=...` | — |
| 2 | 取餐核對 | 前端 | — |
| 3 | 送達桌位 | 前端 | — |
| 4 | 標記送達 | `PUT /orders/:id/status` → `delivered` | `orders.status = delivered`；有桌號則**釋放桌位** |

`delivered` 之後只能走 `paid` 或 `refunded`，不能再取消。

## 4. 「配送中」為什麼只存在於前端

`delivering` 不是合法的訂單狀態。八個合法值是
`pending / confirmed / preparing / ready / delivered / paid / cancelled / refunded`
（`packages/shared-types/src/order.ts:120`），`orderFilterSchema` 與
`updateOrderStatusSchema` 都逐項比對這份清單，送第九個值一律 400。

送菜員領走餐點不是訂單本身的狀態變化，而是「這台裝置上的這個人正在處理」，
所以它被留在前端當本地標記（#224 採 A 案）：

| 前端行為 | 送出什麼 |
| --- | --- |
| 待送清單 | `GET /orders?status=ready` — 只有伺服器認得的值 |
| 開始配送 | **不打 API**，只寫 `localPhase` |
| 標記送達 | `PUT /orders/:id/status` → `delivered` |

`ServiceOrder` 因此拆成兩個欄位：`status` 是伺服器真相，`localPhase` 是本地階段。
本地階段連同開始時間與領取者寫進 `sessionStorage`（key `service-view:delivery-phase`），
因為 `refreshOrders` 每次都用伺服器回應重建整個清單——不還原就會把送菜員手上的單
洗回「開始配送」，並連帶失去配送時長與 `assignedTo`。伺服器記下 `delivered` 之後，
本地階段隨即清除；不再列為 `ready` 的單也會在下次重整時一併剪掉。

**代價**：換一台裝置看不到「誰領走了」。要跨裝置共享就得把 `delivering` 變成真正的
第九個狀態，那要一起動 `ORDER_STATUSES`、轉移表、`ROLE_STATUS_PERMISSIONS[3]`、
DB 時間戳欄位、顧客追蹤頁文案與 i18n key，以及所有以 `ready` 為終點的查詢。

## 5. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 送菜員換裝置或換瀏覽器分頁 | 看不到自己已領取的單（本地階段不跨裝置） | — | 🟡 P2 |
| 瀏覽器停用 `sessionStorage` | 本地階段只存在記憶體，重載後回到「開始配送」 | — | 🟡 P2 |
| 送菜員想標 `paid` | 403 | `FORBIDDEN` | 🟠 P1 |
| 從 `preparing` 直接標 `delivered` | 409（必須先 `ready`） | `INVALID_STATUS_TRANSITION` | 🟠 P1 |
| 兩人同時標同一單送達 | 409 版本衝突 | `ORDER_VERSION_CONFLICT` | 🟡 P2 |
| 標記送達後桌位 | 自動 `isOccupied = false`、清空 `currentOrderId` | — | — |
| 外帶／外送單沒有桌號 | 不做桌位釋放，其餘相同 | — | — |
| 標記送達 | 同時解除該訂單的訪客活躍鎖 | — | — |

## 6. 對應程式碼與測試

**程式碼**

- `apps/admin-dashboard/src/views/ServiceView.vue` — 待送清單、開始配送、標記送達
- `apps/admin-dashboard/src/router/index.ts:455` — `/service` 路由與角色
- `apps/api/src/features/orders/types/index.ts:500` — 轉移表與 `ROLE_STATUS_PERMISSIONS[3]`
- `apps/api/src/features/orders/schemas/validation.ts:46`、`:194` — 狀態與篩選 schema
- `packages/database/src/services/order.ts:1273` — `delivered` 時釋放桌位

**測試**

- `apps/admin-dashboard/src/views/ServiceView.test.ts` — 驗證送出的 query 與 body
  只含合法狀態值，且本地配送階段能跨重整與重載保留、送達後清除。這是 CI 實際會跑的那道守門。
- `tests/e2e/integration/real-workflows.spec.ts` — 送菜流程（`ready` → 標記送達 → 桌位釋放）。
  屬於 `integration` project，需要 `WORKFLOW_ADMIN_URL`／`SMOKE_ADMIN_URL` 才會跑；
  由 `.github/workflows/nightly-integration.yml` 每晚執行（`cron: "0 18 * * *"`，也可手動觸發），
  不在 PR／push 的 `test.yml` 路徑上。

## 7. 已知缺口

- **沒有指派機制**。`assignedTo` 只存在於本地階段，後端訂單沒有對應欄位，
  「誰負責這一單」無法跨裝置共享（見 §4 的代價）。
- **送菜流程的 E2E 只在夜間跑**，push 與 PR 不會觸發；壞掉要到隔天才看得到。
  在 push／PR 擋住狀態合約回歸的仍是元件測試。
- **沒有做過手動探索 QA**。現場作業（09–12）至今沒有像顧客端、店家後台那樣在 production 逐頁走過一輪。
- **沒有送達失敗的處理路徑**。送錯桌、客人已離開這些情境只能靠取消或人工協調。
