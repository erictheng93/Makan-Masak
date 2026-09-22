# 收銀流程

> **對應 master board**：現場作業 → 收銀流程（收銀 role 4）
> **主要角色**：收銀（role 4）、店主（role 1）、管理者（role 0）
> **最後對照原始碼**：2026-08-21
> **細節圖**：[boards/payment-and-refund.html](./boards/payment-and-refund.html)

## 1. 定位

收銀機、班次、收款、退款、收據。這條流程碰的是錢，所以每一個寫入路徑都有
**冪等鍵、金額上限或狀態守衛**其中至少一項。

要注意有兩套付款端點，用途不同：

| 端點 | 用途 |
| --- | --- |
| `POST /api/v1/payments` 與 `/payments/create` | 對單一訂單收款（含部分付款、多種付款方式併用） |
| `POST /api/v1/pos/market-checkouts/:checkoutId/pay` | 在收銀台結清一整筆市集跨攤結帳 |

## 2. 觸發與前置條件

| 項目 | 內容 |
| --- | --- |
| 進入點 | Admin Dashboard 的 POS 畫面（`CashierView.vue`、`POSManagementView.vue`） |
| 角色 | 付款端點需登入；退款端點 `requireRole([0, 1, 4])` |
| 標頭 | POS 收款必須同時帶 `registerId`、`shiftId`；POS 退款必須同時帶 `X-Register-Id`、`X-Shift-Id`。兩者都會驗證同店且綁定同一班次。 |
| 冪等 | `POST /payments` 與 `/payments/create` **強制**要求 `Idempotency-Key`（`requireKey: true`） |

## 3. Happy path

### 3.1 開班

| # | 動作 | 端點 |
| --- | --- | --- |
| 1 | 啟用收銀機 | `POST /api/v1/pos/registers/:registerId/activate` |
| 2 | 開班（帶開班現金） | `POST /pos/shifts/start` |
| 3 | 記錄開班現金流動 | 自動寫入 `type: "opening"` |

一台收銀機同時只能有一個 `active` 班次，重複開班回「此收銀機已有活躍班次」。

### 3.2 收款

| # | 動作 | 端點／程式 | 說明 |
| --- | --- | --- | --- |
| 1 | 帶出訂單 | `GET /api/v1/orders/:id`（可用 UUID、`order_number` 或 `client_mutation_id`） | `resolveOrderIdentity` |
| 2 | 選付款方式 | `GET /payments/methods/:country` | TW／MY／VN 各自的清單 |
| 3 | 送出收款 | `POST /payments`（必帶 `Idempotency-Key`） | POS 必帶 `registerId`、`shiftId`；`paymentMode: full` 或 `partial` |
| 4 | 核對金額 | `assertSameAmount(...)` | 以 `orders.total_amount_cents` 為準；client 送來的每一個金額都要對得上 |
| 5 | 訂單結清 | `closeOrder`（預設 true） | `payment_status = paid`、訂單 → `paid` |
| 6 | 開立收據 | `POST /pos/receipts/print` | 需 `receipt_printing` 模組與 `print.jobs` 配額 |

POS 收款與班次的記帳規則如下：`totalSales` 累加全部付款方式，`cashSales`、
`cardSales`、`digitalSales` 依方式分桶（未知的電子方式歸 digital，避免漏計）；只有
現金銷售會寫入錢櫃的 `cash_movements(type=sale)`。因此刷卡與電子錢包會出現在營收，
但不會增加錢櫃預期現金。

### 3.3 退款

| # | 動作 | 端點 |
| --- | --- | --- |
| 1 | 建立退款 | `POST /api/v1/pos/refunds/create`（必帶收銀機／班次標頭） |
| 2 | 審核 | 收銀員（role 4）建立後維持 `processing`；Admin/Owner 用 `POST /pos/refunds/:refundId/approve` 結清，或 `/reject` ／ `/cancel` |
| — | 針對金流交易的退款 | `POST /api/v1/payments/refund`（role 0/1/4） |

Admin/Owner 自己建立的 POS 退款會同步結清；收銀員不能自行完成退款。核准端點沿用
既有的 Admin/Owner 權限，並以同一個 finalizer 寫入 `orders.refund_amount_cents`、
`orders.payment_status`、班次退款統計，以及（若為 active 班次的現金退款）錢櫃流動。
目前沒有可靠的退款金額門檻設定可套用，因此不另行發明門檻或 schema。

### 3.4 結班

`POST /pos/shifts/:shiftId/end` 會算出：

```
預期金額 = 開班現金 + 現金銷售 - 已核准的現金退款 ± 人工現金異動
差額     = 實際清點 - 預期金額
```

三個數字都存進 `cash_shifts`，並寫一筆 `type: "closing"` 的現金流動，然後把收銀機的
`currentShiftId` 清空。card/digital 銷售不會放進錢櫃預期；`sale`、`opening`、`closing`、
`count` 是來源／觀察記錄，也不會重複計算。結班畫面必須由操作員輸入實際清點金額（輸入
0 合法，但不會自動以 0 或系統金額代填）。班次另有 `suspend` / `resume`。

## 4. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 沒帶 `Idempotency-Key` 就付款 | 直接拒絕（`requireKey: true`） | — | 🔴 P0（已防） |
| 重送同一個 `Idempotency-Key` | 回傳第一次的結果，不重複扣款 | — | 🔴 P0（已防） |
| 對已結清訂單再收款 | 409（`isAlreadyFinalized` 檢查 `status` + `payment_status`） | `ORDER_NOT_PAYABLE` | 🔴 P0（已防） |
| 金額與伺服器算的不符 | 409，三種情境各有錯誤碼 | `PAYMENT_TOTAL_MISMATCH` / `PAYMENT_AMOUNT_MISMATCH` / `PARTIAL_PAYMENT_TOTAL_MISMATCH` | 🔴 P0（已防） |
| `paymentMode: partial` 沒帶 `payments[]` | 400（schema `superRefine`） | `VALIDATION_ERROR` | 🟡 P2 |
| 金額有超過兩位小數 | 400（`isCentAlignedAmount`） | `VALIDATION_ERROR` | 🟠 P1 |
| 退款金額超過可退額度 | 拒絕「退款金額超過可退款額度」（已 `completed` + `processing` 的都算進去） | — | 🔴 P0（已防） |
| 收銀員建立 POS 退款 | 只建立 `processing` 退款，不更動訂單、班次或錢櫃；需 Admin/Owner 核准 | — | 🔴 P0（已防） |
| 對**已結班**的班次退款 | 仍可建立退款，但**不寫現金流動**，改在 `metadata` 標 `postCloseAdjustment` | — | 🔴 P0（已防） |
| 重複開班 | 「此收銀機已有活躍班次」 | — | 🟡 P2 |
| 對非 active 班次結班 | 「找不到活躍班次」 | — | 🟡 P2 |
| 結班差額不為零 | **照樣結班**，差額記在 `differenceAmountCents` 與結班備註 | — | 🟠 P1 |
| 收據列印 | 寫入 `receipts` 後**立刻**標成 `printed`，見 [12](./12-floor-printing.md) | — | 🟠 P1 |
| 未購買 `receipt_printing` 模組 | 收據端點被擋，但 POS 其餘功能照常 | — | 🟡 P2 |
| 查詢交易狀態 | `GET /payments/status/:transactionId`；找不到交易時再用 `orders.payment_transaction_id` 反查 | — | — |

## 5. 併發與競態

- **付款冪等**由 `idempotencyMiddleware({ scope: "payment", requireKey: true })` 保證，
  `effectId` 從回應中取 `transactionId` / `paymentId` / `id`。
- **訂單結清**用條件式 UPDATE：`payment_status NOT IN ('paid','completed','refunded','partial_refunded')`，
  所以兩個收銀台同時結清只有一個生效。
- **退款額度**在同一次查詢裡把 `completed` 與 `processing` 都算進已退金額，避免兩筆同時審核造成超退。
- **Owner/Admin 發起的 POS 退款完成是同步的**。收銀員建立的退款刻意保留在
  `processing`，讓既有 Admin/Owner 核准端點完成；這不是 fire-and-forget callback。
  以前用 `setTimeout` 模擬 PSP 回調，但 Workers 不保證回應送出後的計時器會執行，
  退款會卡在 `processing`——不要改回非同步。

## 6. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/payments/routes/index.ts` — 冪等、schema、退款、方式清單
- `apps/api/src/features/payments/services/PaymentService.ts:75` — 收款主邏輯
- `apps/api/src/features/payments/services/refundPayment.ts` — 金流交易退款與部分退款
- `apps/api/src/features/pos/services/ShiftService.ts:60`、`:142` — 開班／結班
- `apps/api/src/features/pos/services/RefundService.ts:61` — 退款額度與結班後調整
- `apps/api/src/features/pos/services/ReceiptService.ts:59` — 收據
- `apps/admin-dashboard/src/views/CashierView.vue`、`POSManagementView.vue`

**測試**

- `apps/api/src/features/payments/services/PaymentService.test.ts`、`refundPayment.test.ts`
- `apps/api/src/features/pos/services/*.test.ts`
- `apps/admin-dashboard/src/views/CashierView.test.ts`、`POSManagementView.test.ts`

**手動探索 QA（production）**

- [現場作業流程 QA 2026-09-22](../investigations/2026-09-22-floor-operations-flow-qa.html) — P1–P6

## 7. 已知缺口

- **結班對帳在現行介面上不能用**（2026-09-22 production 實測，見 [現場作業流程 QA 2026-09-22](../investigations/2026-09-22-floor-operations-flow-qa.html)）：
  一般訂單走 `POST /payments` 收款**不會**寫進班次（只有市集 POS 收款會累加
  `total_sales_cents`）；退款寫了 `-` 的現金流動，但不更新班次的 `total_refunds_cents`；
  結班對話框沒有清點欄位，前端永遠送 `actualAmount: 0`；預期金額用
  `totalSales`（含刷卡）算抽屜現金。結果是每一班都記成短少整筆開班現金（#413）。
- **退款不回寫訂單**。`refunds` 有列、也有現金流動，但 `orders.refund_amount_cents`
  仍為空、`payment_status` 仍是 `completed`；退款建立即 `completed`，`approved_by` 為空（#416）。
- **收銀機沒有伺服器端餘額**。管理頁的「目前餘額」是前端自己加減的數字，
  新收銀機顯示 NaN；班次回的是 `startedAt`，前端讀 `startTime`，所以顯示 Invalid Date。
- **結班差額沒有審核流程**。差額只是被記下來，沒有覆核、沒有告警門檻。
- **現金流動的核准流程與退款核准是兩套**（`/pos/cash-movements/:id/approve` 與 `/pos/refunds/:id/approve`），
  兩邊的權限與門檻各自定義。
- **收據不會真的印出來**（見 [12](./12-floor-printing.md) 的已知缺口）。
