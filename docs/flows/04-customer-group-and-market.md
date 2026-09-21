# 揪團與夜市市集流程

> **對應 master board**：顧客端 → 揪團與夜市市集流程
> **主要角色**：訪客、顧客（role 5）
> **最後對照原始碼**：2026-08-21
> **細節圖**：[boards/market-checkout.html](./boards/market-checkout.html)

## 1. 定位

兩件常被放在一起講、但機制完全不同的事：

| | 揪團（group order） | 市集跨攤結帳（market checkout） |
| --- | --- | --- |
| 場景 | **同一攤**，多人共用一台購物車 | **多攤**，一次付款分別成單 |
| 資料 | `group_orders` + `group_cart_items` → 最後收斂成**一筆** master order | 一個 checkout session → **每攤一筆** child order |
| 身分 | member token（分享碼加入） | 訪客 guest token（每攤各一把） |
| 分帳 | 事後拆帳（by_item / equal / custom…） | 付款當下就按攤位切 |

## 2. 揪團流程

### 2.1 狀態機

```
active ──→ finalizing ──→ checkout ──→ completed
             │
             └──→ finalizing_failed（真實訂單已成立但收斂失敗，需人工介入）
active ──→ cancelled
```

`finalizing` **同時是互斥鎖**：進入這個狀態靠一句條件式 UPDATE
（`WHERE status = 'active' AND master_order_id IS NULL`）搶下，搶不到的人得到「已在收斂中」。

### 2.2 Happy path

| # | 動作 | 端點 | 說明 |
| --- | --- | --- | --- |
| 1 | 開團 | `POST /api/v1/orders/group/create` | 產生 `shareCode`，寫入 KV（1 小時）並設到期時間 |
| 2 | 分享連結 | `GET /orders/group/join/:shareCode` | 只回預覽，不加入 |
| 3 | 加入 | `POST /orders/group/join/:shareCode` | 發 member token |
| 4 | 加菜／改量／刪除 | `POST|PUT|DELETE /orders/group/:id/cart[/:itemId]` | 只有 `active` 能改 |
| 5 | 團主鎖單 | `POST /orders/group/:id/lock` | 驗 `isHostSession` → `finalizeGroupOrder` |
| 6 | 收斂成真實訂單 | `finalizeGroupOrder` | 建立 master order，走一般訂單流程 |
| 7 | 分帳 | `POST /orders/group/:id/split` | by_item／equal／custom／proportional／individual |
| 8 | 各自付款 | `POST /orders/group/:id/payment/:memberId` | — |

其他控制項：`PUT /:id/split-type`、`/fee-mode`（`proportional` / `equal` / `host`）、`/auto-submit`（到期自動送出，預設關）、
`POST /:id/recover`（團主換裝置後找回身分）、`POST /cleanup/expired`（清理過期團）。

## 3. 市集流程

### 3.1 探索

| 動作 | 端點 |
| --- | --- |
| 市集列表／附近 | `GET /api/v1/markets`、`/nearby`、`/areas` |
| 市集頁與攤位 | `GET /markets/:slug`、`/markets/:slug/vendors` |
| 搜尋餐點 | `GET /api/v1/discovery/search`（FTS5 trigram） |
| 外帶資格 | `GET /discovery/restaurants/:id/takeaway-eligibility` |

> 這個端點會回傳店家的公開 QR code，**這是設計如此**——讓人從探索頁直接開外帶單，不必真的到場掃碼。
> 所以店家 QR 不可當作到場證明，見 [01](./01-customer-ordering.md) §5。

### 3.2 跨攤結帳 Happy path

| # | 動作 | 端點／程式 | 產生什麼 |
| --- | --- | --- | --- |
| 1 | 送出跨攤購物車 | `POST /api/v1/market-checkouts` | 一個 `checkoutId` |
| 2 | 逐攤驗證 | 市集存在且啟用、攤位是會員、攤位允許訪客單 | — |
| 3 | 逐攤建立 child order | `OrdersService.createOrder`（每攤一筆） | 每攤一把 guest token（4h）＋活躍鎖（2h） |
| 4 | 寫入 session | KV `market_checkout:{id}`（4h）+ D1 `market_checkout_sessions` | `status = submitted` |
| 5 | 套用卷（可選） | `POST /:id/voucher` | 折扣按攤位金額**等比**分攤 |
| 6 | 付款 | `POST /:id/pay` | 依 `splitMode` 決定怎麼切 |
| 7 | 供應商回調 | `POST /market-checkouts/payment-webhooks/:provider` | 驗簽後才真正認列 |
| 8 | 追蹤 | `GET /market-checkouts/:id` | 逐攤狀態 |

### 3.3 兩種分帳模式

| `splitMode` | 意義 |
| --- | --- |
| `child_transactions` | 平台逐攤各開一筆交易（預設） |
| `provider_split` | 交給金流商做分潤；用代幣付款時**強制**走這個模式 |

## 4. 代幣與卷

| | 代幣（credits） | 卷（voucher） |
| --- | --- | --- |
| 本質 | 儲值卡餘額 + ledger | 平台級 coupon code |
| 端點 | `/api/v1/credits/cards/*` | `POST /market-checkouts/:id/voucher` |
| 限制 | 查餘額公開但限流；儲值與管理需 admin + `Idempotency-Key` | 只吃 `coupons.restaurant_id IS NULL` 的平台券；匿名、無擁有者 |
| 核銷時點 | 付款時扣 ledger | **付款成功且驗證後**才寫 `coupon_usage`，`used_count` 每個 checkout 只加一次 |

## 5. Edge cases 與失敗模式

### 揪團

| 情境 | 系統行為 | 風險 |
| --- | --- | --- |
| 非團主呼叫 lock | 403「Only the group host can lock this order」 | 🟠 P1 |
| 兩人同時 lock | 條件式 UPDATE 只有一人搶到，另一人得到「已在收斂中」 | 🔴 P0（已防） |
| 重送 lock 但已收斂完成 | 回 `success: true` 帶既有 `masterOrderId`（冪等） | — |
| 空購物車 lock | 失敗「Cannot finalize an empty group order」 | 🟡 P2 |
| 收斂到一半失敗 | 轉 `finalizing_failed`——**真實訂單可能已成立**，需人工介入 | 🔴 P0 |
| 分享碼過期 | 404「Group order not found or expired」 | 🟡 P2 |
| 團主換裝置 | `POST /:id/recover` 找回；否則團會卡在 active 直到過期 | 🟡 P2 |

### 市集

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 同一攤在購物車出現兩次 | 400「Each vendor can appear only once」 | — | ⚪ P3 |
| 攤位不是該市集會員 | 建立失敗 | — | 🟠 P1 |
| 建到第 3 攤時失敗 | **補償**：回滾前兩攤已建立的訂單並清鎖，再回報失敗；重試安全（每次新的 `checkoutId`） | — | 🔴 P0（已防） |
| 補償本身失敗 | 記在 `recordFailedMarketCheckoutSession` 供人工處理 | — | 🔴 P0 |
| 重複呼叫 `/pay`（已付） | 直接回傳既有付款結果，不再送金流 | — | 🔴 P0（已防） |
| 付款失敗 | 釋放已保留的卷額度，寫入 failed payment 紀錄 | — | 🟠 P1 |
| webhook 簽章錯誤 | 拒收 | `MARKET_CHECKOUT_WEBHOOK_SIGNATURE_INVALID` | 🔴 P0 |
| 已付款後想套卷 | 400 | `MARKET_CHECKOUT_ALREADY_PAID` | 🟡 P2 |
| 重複套同一張卷 | 400 | `VOUCHER_ALREADY_APPLIED` | 🟡 P2 |
| 卷過期／未達門檻／非平台券 | 400，錯誤碼分開 | `VOUCHER_EXPIRED` 等 | 🟡 P2 |
| 顧客弄丟 guest token | `POST /:id/guest-token` 用手機末幾碼換回 | — | 🟡 P2 |
| 全新裝置沒有任何身分 | 不檢查活躍鎖（同 guest-orders 的取捨） | — | 🟠 P1 |

## 6. 併發與競態

- **揪團 lock**：條件式 UPDATE 當互斥鎖，claim 失敗會重讀現況再決定回什麼——不是盲目回錯。
- **市集建單**：沒有跨攤交易可用（D1 無互動式交易，且每攤是獨立訂單），所以用**補償**而非回滾。
- **卷額度**：付款前 `reserveUsage`，付款失敗 `releaseReservation`，成功且驗證後才寫 `coupon_usage`。
- **付款冪等**：`Idempotency-Key` 傳給供應商；`market_checkout_payments.idempotency_key` 有
  `WHERE idempotency_key IS NOT NULL` 的部分唯一索引。

## 7. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/group-orders/services/GroupOrdersService.ts:1165` — `finalizeGroupOrder`
- `apps/api/src/features/group-orders/routes/index.ts`
- `apps/api/src/features/market-checkouts/routes/index.ts` — 建立（`:345`）、卷（`:670`）、付款（`:821`）、退款（`:1228`）
- `apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentProvider.ts`
- `apps/api/src/features/market-checkouts/services/MarketCheckoutPaymentWebhookService.ts`
- `apps/api/src/features/market-checkouts/services/MarketCheckoutVoucherService.ts`
- `apps/api/src/features/credits/routes/index.ts`
- `packages/database/src/schema/markets.ts` — session／child order／payment 三張表

**測試**

- `apps/api/src/features/market-checkouts/routes/index.test.ts`（近 6000 行，涵蓋大多數失敗分支）
- `apps/api/src/features/market-checkouts/services/*.test.ts`
- `apps/api/src/__tests__/integration/markets.real.integration.test.ts`
- `tests/e2e/integration/real-workflows.spec.ts` — 從瀏覽器送出跨攤結帳並開啟追蹤（`integration` project，`nightly-integration.yml` 每晚跑）
- `tests/e2e/customer/group-orders.spec.ts` — 建立揪團 → 邀請連結加入 → 兩人加菜 → 團主合單送出、回菜單立刻加菜仍進群組購物車（R4）。屬於 `customer-real` project，CI 由 `test.yml` 的 `customer-real-e2e` job 執行（真 api ＋ realtime ＋ 本機 D1，不攔截回應）
- `tests/e2e/customer/markets.spec.ts` — 探索市集、從市集頁跨攤結帳（#401）、每攤一筆真訂單、優惠卷核銷（#401）、無金流時付款不得標記已付款（#400）。代幣儲值扣抵沒有測試：`STORED_VALUE_CREDITS_ENABLED` 在本機、CI、production 都關。

**手動探索 QA（production）**

- [顧客端流程 QA 2026-09-15](../investigations/2026-09-15-customer-app-flow-qa.html) — C2、C7
- [顧客端上線 readiness QA 2026-09-18](../investigations/2026-09-18-customer-app-readiness-qa.html) — R2、R4、R5、R6、R10、R12、R13、R14

**相關 spec**

- [superpowers/specs/2026-06-01-market-multi-vendor-checkout.md](../superpowers/specs/2026-06-01-market-multi-vendor-checkout.md)
- [superpowers/specs/2026-06-03-market-checkout-voucher-redemption.md](../superpowers/specs/2026-06-03-market-checkout-voucher-redemption.md)

## 8. 已知缺口

- **`finalizing_failed` 沒有自動修復路徑**。目前只有狀態標記，回收要靠人。
- **市集 checkout session 主要活在 KV**（4 小時 TTL），D1 那份是為了後台查詢與對帳；KV 過期後顧客端追蹤頁會退化。
- **揪團與市集不能混用**。同一次結帳不能既跨攤又多人共用購物車。
- **新入駐的店在公開探索頁顯示 onboarding placeholder，且沒有營業時間而永遠「休息中」**（#386）。
- 代幣目前是 admin 手動儲值為主，線上儲值（`/topup/online` + `topup-webhooks`）已有端點但仍依賴供應商設定。
