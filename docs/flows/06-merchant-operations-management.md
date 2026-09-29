# 營運管理流程

> **對應 master board**：店家後台 → 營運管理流程
> **主要角色**：店主（role 1）、管理者（role 0）
> **最後對照原始碼**：2026-08-21

## 1. 定位

菜單以外的日常營運：食材與配方、優惠券、店家向平台的支援工單、需求預測，以及店家視角的揪團訂單。
這五塊彼此獨立，共同點是都掛在店家後台、都受模組管制。

## 2. 食材與配方

| 動作 | 端點 | 角色 |
| --- | --- | --- |
| 食材列表／建立／修改／刪除 | `GET/POST/PUT/DELETE /api/v1/ingredients/:restaurantId[/:id]` | 0/1 |
| 批次匯入 | `POST /ingredients/:restaurantId/bulk` | 0/1 |
| 調整庫存 | `PATCH /ingredients/:restaurantId/:id/stock` | 0/1 |
| 設定配方 | `PUT /ingredients/:restaurantId/recipes/:menuItemId` | 0/1 |
| 驗證配方 | `POST /ingredients/:restaurantId/recipes/:menuItemId/validate` | 0/1 |
| 找出沒配方的品項 | `GET /ingredients/:restaurantId/recipes/missing` | 0/1 |

> **配方不會自動扣食材。** 訂單流程只動 `menu_items.inventory_count`（品項層庫存），
> `packages/database/src/services/order.ts` 完全沒有碰 ingredients。配方目前的用途是
> **需求預測**與人工盤點，不是即時扣帳。

## 3. 優惠券

| 動作 | 端點 | 存取 |
| --- | --- | --- |
| 驗證代碼 | `POST /api/v1/coupons/validate` | **公開** |
| 可用券列表 | `GET /coupons/available/:restaurantId` | 公開 |
| 建立／修改／刪除／統計 | `POST/PUT/DELETE/GET /coupons...` | 0/1 + `moduleGate("coupons")` |

下單時的實際流程（見 [01](./01-customer-ordering.md) §3.2 第 10、13 步）：

1. `validateCoupon` 算出折扣
2. `claimUsageSlot` 先以條件式 UPDATE 佔用名額（含上限檢查）
3. `coupon_usage` 與訂單**同一個 batch** 寫入
4. batch 失敗 → `releaseUsageSlot` 歸還

平台級券（`coupons.restaurant_id IS NULL`）另有市集跨攤的核銷路徑，見 [04](./04-customer-group-and-market.md) §4。

## 4. 店家支援工單

`/dashboard/feedback` 是店家向平台提交問題、功能建議與支援請求的工單中心，
不是顧客評價或評論功能。店長只能查看自己的工單與統計；平台管理員可查看全部工單。

| 動作 | 端點 |
| --- | --- |
| 店長送出支援工單 | `POST /api/v1/feedback` |
| 離線批次同步 | `POST /feedback/batch-sync` |
| 工單列表／統計 | `GET /feedback`、`GET /feedback/stats` |
| 更新處理狀態 | `PUT /feedback/:id/status` |
| 回覆 | `POST /feedback/:id/responses`、`PUT/DELETE .../responses/:responseId` |

## 5. 需求預測

| 動作 | 端點 |
| --- | --- |
| 產生預測 | `POST /api/v1/forecast/:restaurantId/generate` |
| 讀取預測 | `GET /forecast/:restaurantId`（`item_level` 或 `ingredient_level`） |
| 準確度回顧 | `GET /forecast/:restaurantId/accuracy` |
| 食材預測 | `GET /forecast/:restaurantId/ingredient-forecast` |
| 補貨警示 | `GET /forecast/:restaurantId/alerts` |

`ingredient_level` 預測就是靠 §2 的配方把品項銷量換算成食材用量——**配方沒維護，這條就沒有輸出**。

## 6. 揪團訂單（店家視角）

| 動作 | 端點 |
| --- | --- |
| 列表 | `GET /api/v1/orders/group` |
| 統計 | `GET /orders/group/statistics` |
| 匯出 | `GET /orders/group/export` |
| 清理過期 | `POST /orders/group/cleanup/expired` |

顧客側的開團、加入、鎖單、分帳見 [04](./04-customer-group-and-market.md) §2。

## 7. Edge cases 與失敗模式

| 情境 | 系統行為 | 風險 |
| --- | --- | --- |
| 券已達使用上限，兩人同時結帳 | `claimUsageSlot` 條件式 UPDATE 只會有一人成功 | 🔴 P0（已防） |
| 訂單寫入失敗但券已佔位 | `releaseUsageSlot` 歸還；歸還失敗只記 log | 🟠 P1 |
| 券驗證通過但下單時已過期 | 下單當下重驗，失敗即整筆 400 | 🟠 P1 |
| 公開的 `/coupons/validate` 被用來枚舉券碼 | 目前沒有專屬限流，只有全域 per-IP | 🟠 P1 |
| 食材庫存改成負數 | `updateStock` 依 schema 驗證，但**訂單不會消耗食材**，所以不會自動變負 | ⚪ P3 |
| 配方引用已刪除的食材 | `validateRecipe` 可查出來，但不是寫入時強制 | 🟡 P2 |
| 未購買 `coupons` 模組 | 管理端點被 `moduleGate` 擋，**公開驗證端點不受影響** | 🟡 P2 |
| 回饋離線批次同步重送 | `batch-sync` 端點需自行判重，沒有 idempotency key | 🟡 P2 |

## 8. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/ingredients/services/IngredientService.ts`、`RecipeService.ts`
- `apps/api/src/features/coupons/routes/index.ts`、`services/CouponsService.ts`
- `packages/database/src/services/coupon.ts` — `claimUsageSlot` / `releaseUsageSlot`
- `apps/api/src/features/feedback/routes/index.ts`
- `apps/api/src/features/forecast/routes/index.ts`

**測試**

- `apps/api/src/features/coupons/services/CouponsService.test.ts`
- `apps/api/src/features/feedback/*`（見 `FeedbackService.test.ts`）
- `tests/e2e/admin/`（`admin-real`）：`ingredients`、`coupons`、`support-and-insights`、`group-orders`

**手動探索 QA（production）**

- [店家後台流程 QA 2026-09-01](../investigations/2026-09-01-admin-dashboard-flow-qa.html)

## 9. 已知缺口

- **配方與即時庫存沒有接起來**（見 §2）。真正的存貨扣減只發生在品項層。
- **`/coupons/validate` 是公開且無專屬限流的**，可被用來探測有效券碼。
- **回饋的批次同步沒有冪等鍵**，離線佇列重送會產生重複資料。
- 需求預測的準確度端點存在，但沒有自動回饋迴路把誤差餵回模型。
