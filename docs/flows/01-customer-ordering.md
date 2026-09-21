# 顧客點餐主流程

> **對應 master board**：顧客端 → 點餐主流程
> **主要角色**：訪客、顧客（role 5）
> **最後對照原始碼**：2026-08-21
> **細節圖**：[boards/customer-ordering.html](./boards/customer-ordering.html)

## 1. 定位

從掃碼到訂單成立為止。這是全系統最高風險的一條路——它同時碰金額、庫存、優惠券、限流與訪客身分，
而且大部分流量來自**沒有帳號的人**。

送單有兩個端點，分別對應兩種身分，其餘邏輯共用同一個 `OrdersService.createOrder`：

| 端點 | 身分 | 認證 |
| --- | --- | --- |
| `POST /api/v1/guest-orders` | 訪客 | 無（成功後才發 KV guest token） |
| `POST /api/v1/orders` | 已登入顧客／員工代下單 | `customerAuthMiddleware` |

## 2. 觸發與前置條件

| 項目 | 內容 |
| --- | --- |
| 進入點 | 掃桌位 QR／座位 QR／店家 QR；或從探索頁、市集頁直接進入外帶 |
| 角色 | 訪客即可 |
| 模組開關 | `POST /orders` 有 `moduleGate("online_ordering")`；`POST /guest-orders` **沒有** module gate，只有配額 |
| 配額 | 兩條路都跑 `enforceQuota(c, "orders.created")` |
| 餐廳前提 | `isActive` 且 `isAvailable`；訪客單另需 `settings.allowGuestOrders === true` |
| 店家 QR 前提 | `orderType === "shop"` 時另需 `enableShopMode`，且送來的 `shopQrCode` 必須是現行版本 |

## 3. Happy path

### 3.1 前端（掃碼到按下送出）

| # | 動作 | 端點／程式 | 說明 |
| --- | --- | --- | --- |
| 1 | 掃桌位／座位 QR | `GET /api/v1/qr/verify/table?qrCode=`、`/verify/seat` | HMAC 簽章驗證，**公開但有專屬限流** |
| 1' | 掃店家 QR | `GET /api/v1/qr/verify/shop/:qrCode` | 店家碼是公開識別碼，不是憑證 |
| 2 | 選取餐方式 | 前端 | 內用／外帶／外送 |
| 3 | 載入菜單 | `GET /api/v1/menu/:restaurantId` | 分類、品項、選項群組 |
| 4 | 加入購物車 | `stores/cart.ts`、`stores/shopCart.ts` | **購物車只存在前端**，不落 DB |
| 5 | 送出 | `services/orderApi.ts` → `POST /guest-orders` | 帶 `X-Guest-Device-Id` |

### 3.2 後端（`POST /guest-orders` 的實際順序）

順序本身就是設計：最便宜的檢查排在最前面，讓洪水攻擊者付不起後面的成本。

| # | 檢查／動作 | 程式 | 失敗結果 |
| --- | --- | --- | --- |
| 1 | 配額 | `enforceQuota("orders.created")` | 429 `QUOTA_EXCEEDED`（`QUOTA_ENFORCEMENT_MODE` 預設 `disabled`，關閉時不擋） |
| 2 | 每（餐廳, IP）節流 | `enforceGuestOrderThrottle` | 429 `GUEST_ORDER_RATE_LIMITED` |
| 3 | 餐廳存在且營業中 | route | 404 ／ 400 |
| 4 | `allowGuestOrders` | route | 403 |
| 5 | 店家模式與 QR 版本 | `assertShopModeEnabled` / `assertShopQrCurrent` | 403 `SHOP_MODE_DISABLED` ／ `SHOP_QR_REVOKED` |
| 6 | 本裝置是否已有未結訂單 | `guestActiveOrderKey` KV | 429 `ACTIVE_GUEST_ORDER_EXISTS` |
| 7 | 桌位／座位歸屬 | route | 400 |
| 8 | 品項可售與庫存預檢 | `prepareOrderItems` | `MENU_ITEM_UNAVAILABLE`（409） |
| 9 | **以 DB 價格重算金額** | `prepareOrderItems` | — |
| 10 | 優惠券驗證與折扣 | `CouponService.validateCoupon` | 400 |
| 11 | 最低消費（折後、稅前） | `createOrder` | 400 |
| 12 | 稅與服務費 | `calculateOrderTotal` | — |
| 13 | 佔用優惠券名額 | `claimUsageSlot` | — |
| 14 | 條件式扣庫存 | `UPDATE ... WHERE inventoryCount >= qty` | 失敗即整筆回滾 |
| 15 | **原子批次寫入** | `db.batch([...])` | 全成功或全回滾 |
| 16 | 發 guest token（4h）＋活躍鎖（2h） | `CACHE_KV` | — |
| 17 | 廣播新訂單、推播 | `broadcastNewOrder` / `notifyNewOrderPush` | 失敗不影響訂單 |

> **金額一律由伺服器算。** `POST /orders` 的 schema 收得下 `items[].price`，但 `prepareOrderItems` 只用
> `menuItems.priceCents` 加上選項加價重算，client 傳的價格從頭到尾不參與計算。改動時不要「順手」採用它。

> **D1 沒有互動式交易。** `db.transaction` 在 production D1 必定失敗，唯一的原子提交原語是 `db.batch`。
> 訂單、明細、優惠券使用紀錄、菜品計數、餐廳計數全部塞進同一個 batch；`order_items` 靠唯一的
> `order_number` 子查詢在同批內回填外鍵。

## 4. 主要分支

| 分支 | 差別 |
| --- | --- |
| 內用（table／seat） | 帶 `tableId`（座位另帶 `seatId`），`fulfillmentType = dine_in` |
| 外帶（shop） | 不帶 `tableId`，`fulfillmentType = takeaway`，要過店家模式閘門 |
| 外送 | 帶 `deliveryInfo`（地址、電話、運費） |
| 追加同桌訂單 | `POST /guest-orders/:id/items`，只允許 `pending` / `confirmed`，且全單上限 20 項 |
| 候位預點餐 | 帶 `waitingListId` + `customerPhone`；**不廣播新訂單**，等入座時才由 `confirmWaitingListPreOrders` 轉正 |
| 市集跨攤 | 走 `POST /market-checkouts`，見 [04](./04-customer-group-and-market.md) |

## 5. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 掃到已重新產生的桌位 QR | 404，明確講「已重新產生」 | `TABLE_QR_STALE` | 🟠 P1 |
| 桌位 QR 簽章被竄改 | 404 | `TABLE_QR_SIGNATURE_INVALID` | 🔴 P0 |
| 掃到已停用桌位／座位 | 404 | `..._INACTIVE` | 🟡 P2 |
| 掃到舊的店家 QR 貼紙 | 403 | `SHOP_QR_REVOKED` | 🟡 P2 |
| 未送 `shopQrCode`（舊版前端、候位連結、書籤） | **放行**，只檢查 `enableShopMode` | — | 🟡 P2 |
| 店主關閉店家模式後仍有人送單 | 403 | `SHOP_MODE_DISABLED` | 🟠 P1 |
| 同一裝置已有未結訂單 | 429 | `ACTIVE_GUEST_ORDER_EXISTS` | 🟡 P2 |
| 同上，但帶了重複的 `clientMutationId` | 改回 409，語意是「這筆已處理過」 | `CLIENT_MUTATION_DUPLICATE` | 🟠 P1 |
| 全新裝置（沒有 device id 也沒有 token） | **不檢查活躍鎖**，鎖改綁在這次新發的 token 上 | — | 🟠 P1 |
| 同一 IP 對同一攤 60 秒內超過 30 筆 | 429，附 `Retry-After`，不做累進封鎖 | `GUEST_ORDER_RATE_LIMITED` | 🟠 P1 |
| `RATE_LIMIT_KV` 不可用 | **放行**（可用性優先） | — | 🟠 P1 |
| 送單當下品項被下架 | 409 | `MENU_ITEM_UNAVAILABLE` | 🟠 P1 |
| 送單當下庫存歸零 | 條件式 UPDATE 落空 → 整筆失敗並歸還已扣的庫存與券位 | `Insufficient inventory for ...` | 🔴 P0 |
| 必填選項群組沒選／超過可選上限 | 400（不是 500） | `INVALID_CUSTOMIZATION` | 🟡 P2 |
| 優惠券無效或已達使用上限 | 400，訊息帶原因 | — | 🟠 P1 |
| 折後未達最低消費 | 400，訊息含差額 | — | 🟡 P2 |
| 品項數超過 100／單品數量超過 999 | 400 | `TOO_MANY_ORDER_ITEMS` / `ITEM_QUANTITY_EXCEEDED` | ⚪ P3 |
| 訪客單追加品項使全單超過 20 項 | 400 | — | ⚪ P3 |
| 候位單重複預點 | 409 | `WAITING_LIST_PREORDER_EXISTS` | 🟡 P2 |
| 候位單電話對不上 | 403 | `WAITING_LIST_PHONE_MISMATCH` | 🟠 P1 |
| 廣播失敗（Durable Object 不可用） | 訂單照樣成立，只記 log | — | 🟠 P1 |

## 6. 併發與競態

| 競態 | 防線 | 位置 |
| --- | --- | --- |
| 雙擊／重送 | `orders.client_mutation_id` 的唯一索引；兩種 SQLite 錯誤字串都對應到同一個 409 | `createOrder` catch |
| 兩人搶最後一份 | 條件式 `UPDATE ... WHERE inventoryCount IS NULL OR >= qty`，落空即失敗 | `createOrder` |
| 優惠券超賣 | `claimUsageSlot` 先以條件式 UPDATE 佔位，batch 失敗再 `releaseUsageSlot` 歸還 | `CouponService` |
| batch 中途失敗 | `restoreClaimedInventory()` + `releaseClaimedCoupon()` 補償 | `createOrder` |
| 同裝置多分頁 | KV 活躍鎖（2 小時 TTL）＋反查鍵 `guest_active_lookup:{orderId}` | `guestAuth` |

> **`prepareOrderItems` 裡的庫存預檢不是防線**，它只是為了給出好看的錯誤訊息。真正的守門是第 14 步的
> 條件式 UPDATE。修改時不要以為刪掉其中一個就好——留下預檢會讓訊息友善，刪掉條件式 UPDATE 會直接超賣。

## 7. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/guest-orders/routes/index.ts` — 訪客送單、追加、取消
- `apps/api/src/features/guest-orders/services/guest-order-throttle.ts` — 每（餐廳, IP）節流
- `apps/api/src/features/orders/routes/index.ts:272` — 登入身分送單
- `apps/api/src/features/orders/services/OrdersService.ts:93` — 輸入驗證與錯誤翻譯
- `apps/api/src/features/orders/services/shop-mode-gate.ts` — 店家模式與 QR 版本
- `packages/database/src/services/order.ts:551` — 定價、優惠券、庫存、原子批次
- `apps/api/src/middleware/guestAuth.ts` — guest token、活躍鎖身分解析
- `apps/customer-app/src/services/orderApi.ts`、`stores/cart.ts`、`stores/shopCart.ts`

**測試**

- `apps/api/src/features/guest-orders/routes/index.test.ts`
- `apps/api/src/features/orders/services/OrdersService.test.ts`
- `packages/database/src/services/order.test.ts`
- `tests/e2e/integration/real-workflows.spec.ts` — 真瀏覽器 + 真 API 的購物車與送單（`integration` project，`nightly-integration.yml` 每晚跑）
- `tests/e2e/customer/ordering.spec.ts` — 桌位 QR、座位 QR、店家公開碼 → 選擇取餐、分類捲動、選項／數量／備註／姓名／電話寫進訂單、訪客優惠券（#382）。屬於 `customer-real` project，CI 由 `test.yml` 的 `customer-real-e2e` job 執行（真 api ＋ realtime ＋ 本機 D1，不攔截回應）

**手動探索 QA（production）**

- [顧客端流程 QA 2026-09-15](../investigations/2026-09-15-customer-app-flow-qa.html) — C1、C5、C10、C13
- [顧客端上線 readiness QA 2026-09-18](../investigations/2026-09-18-customer-app-readiness-qa.html) — R1、R11

## 8. 已知缺口

- **購物車完全在前端**。關掉分頁即消失，跨裝置不同步，也沒有伺服器端的「未結帳購物車」概念。
- **`POST /guest-orders` 沒有 module gate**。`POST /orders` 受 `online_ordering` 模組管制，訪客送單只受配額限制；停用模組不會停掉 QR 點餐。
- **活躍鎖對全新裝置形同不存在**（見 §5）。這是為了避開共用 WiFi／CGNAT 造成的全店阻斷而刻意放寬的。
- **掃 QR 的點餐路徑沒有語系切換入口**（#387）。`LanguageSwitcher` 只掛在 `HomeView`，QR 進來的顧客到不了。
- **廣播失敗沒有補償**。訂單成立但廚房沒收到時，只能靠廚房端輪詢 `GET /kitchen/:restaurantId/orders` 補回來。
