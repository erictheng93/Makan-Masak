# API Documentation / API 文檔

MakanMakan REST API 文檔與使用指南。

## 文件夾結構

### Guides (`guides/`)

API 使用指南

- `API_PAGINATION_GUIDE.md` - 分頁指南

---

## API 概覽

### Base URL

```
Production:  https://api.makanmakan.com/v1
Local:       http://localhost:8787/api/v1
```

### 認證

所有受保護的 API 端點需要 JWT Bearer Token:

```http
Authorization: Bearer <your_jwt_token>
```

部分公開端點（如菜單瀏覽、排隊加入）不需要認證。Guest 訂餐使用 Guest Token。

---

## 掛載點總覽 (Mount Index)

<!-- BEGIN GENERATED:api-surface (run: node scripts/check-docs-drift.cjs --write) -->
> 自動生成，請勿手動編輯。執行 `node scripts/check-docs-drift.cjs --write` 重新生成。
> Source of truth: `apps/api/src/app-factory.ts` 的 `apiV1.route(...)` 掛載點。

共 **59** 個掛載點（全部相對於 `/api/v1`）。

| Prefix | Router | 說明 |
| ------ | ------ | ---- |
| `/auth` | `authFeature.routes` |  |
| `/auth` | `verificationFeature.routes` | Password reset, email/phone verification |
| `/qr` | `qrCodesFeature.routes` |  |
| `/queue` | `queueFeature.routes` | 統一候位系統 (public + protected endpoints) |
| `/coupons` | `couponsFeature.routes` | 優惠券驗證端點為公開，管理端點需要認證 |
| `/reservations` | `reservationsFeature` | 訂位系統 (public + protected endpoints) |
| `/service-bookings` | `serviceBookingsFeature` | 預約服務 (public + protected endpoints) |
| `/waiting-list` | `waitingListFeature` | 候位系統 (public + protected endpoints) |
| `/realtime` | `realtimeRoutes` | WebSocket 認證端點為公開 |
| `/partnerships` | `partnershipsRoutes` | 特約商店體系 (部分公開端點 + 受保護端點) |
| `/guest-orders` | `guestOrdersRoutes` | 訪客點餐 (KV-based guest token auth) |
| `/market-checkouts` | `marketCheckoutsFeature.routes` | 市場多攤位訪客結帳 |
| `/credits` | `creditsFeature.routes` | 代幣儲值卡 (查餘額公開限流, 管理端點 admin) |
| `/restaurants` | `membersFeature.routes` |  |
| `/integrations` | `integrationsFeature.routes` | 外送平台串接 (webhooks 公開 HMAC 驗證, 管理端點內部驗證) |
| `/restaurants` | `restaurantsFeature.routes` |  |
| `/restaurants` | `reviewsFeature.publicRoutes` |  |
| `/restaurants` | `broadcastsFeature.restaurantRoutes` |  |
| `/menu` | `menuFeature.routes` |  |
| `/kitchen` | `kitchenFeature.routes` |  |
| `/orders/group` | `groupOrdersFeature.routes` |  |
| `/orders` | `ordersFeature.routes` |  |
| `/orders` | `reviewsFeature.orderRoutes` |  |
| `/pos` | `posFeature.routes` |  |
| `/payments` | `paymentsFeature.routes` |  |
| `/manager` | `managerFeature.actionsRoutes` |  |
| `/audit-logs` | `managerFeature.auditLogsRoutes` |  |
| `/print` | `printRoutes` |  |
| `/tables` | `tablesFeature.routes` |  |
| `/seats` | `seatsFeature.routes` |  |
| `/users` | `usersFeature.routes` |  |
| `/analytics` | `analyticsFeature.routes` |  |
| `/ai-analytics` | `aiAnalyticsFeature.routes` |  |
| `/sse` | `sseFeature.routes` |  |
| `/system` | `systemFeature.routes` |  |
| `/cache` | `cacheFeature` |  |
| `/monitoring` | `monitoringFeature.routes` |  |
| `/backup` | `BackupRoutes` |  |
| `/customer` | `customerRouter` |  |
| `/customers` | `customersRouter` |  |
| `/leaves` | `leavesFeature.routes` |  |
| `/scheduling` | `schedulingFeature.routes` |  |
| `/forecast` | `forecastFeature.routes` |  |
| `/ingredients` | `ingredientsFeature.routes` |  |
| `/discovery` | `discoveryFeature.routes` |  |
| `/markets` | `marketsFeature.routes` |  |
| `/markets` | `broadcastsFeature.marketRoutes` |  |
| `/feedback` | `feedbackFeature.routes` |  |
| `/alerts` | `alertsFeature.routes` | 店主營運告警 (#285) — admin/owner only |
| `/reviews` | `reviewsFeature.routes` | 顧客評價 (#286) — admin/owner only |
| `/billing` | `billingFeature.routes` |  |
| `/me` | `meFeature.routes` |  |
| `/notifications` | `notificationsRoutes` |  |
| `/push` | `pushRoutes` |  |
| `/audit` | `auditRoutes` |  |
| `/admin` | `adminSettingsRoutes` |  |
| `/admin/markets` | `marketsFeature.adminRoutes` |  |
| `/admin/customers` | `membersFeature.adminRoutes` |  |
| `/admin/subscriptions` | `subscriptionsFeature.routes` |  |
<!-- END GENERATED:api-surface -->

---

## API 端點總覽

### Authentication (`/auth`) — 18 routes

| Method | Path                        | Description       | Auth        |
| ------ | --------------------------- | ----------------- | ----------- |
| POST   | `/auth/login`               | 登入              | Public      |
| POST   | `/auth/register`            | 顧客註冊          | Public      |
| POST   | `/auth/register-staff`      | 員工註冊          | Admin/Owner |
| POST   | `/auth/refresh`             | 刷新令牌          | Public      |
| POST   | `/auth/logout`              | 登出              | Protected   |
| GET    | `/auth/me`                  | 取得當前用戶資料  | Protected   |
| GET    | `/auth/profile/:id`         | 取得用戶資料      | Protected   |
| PUT    | `/auth/profile/:id`         | 更新用戶資料      | Protected   |
| POST   | `/auth/change-password`     | 變更密碼          | Protected   |
| GET    | `/auth/sessions`            | 取得登入 sessions | Protected   |
| DELETE | `/auth/sessions/:sessionId` | 終止特定 session  | Protected   |
| DELETE | `/auth/sessions`            | 終止所有 sessions | Protected   |
| POST   | `/auth/forgot-password`     | 請求密碼重設      | Public      |
| POST   | `/auth/reset-password`      | 重設密碼          | Public      |
| POST   | `/auth/verify-email`        | 驗證 Email        | Public      |
| GET    | `/auth/stats`               | 認證統計          | Admin       |
| GET    | `/auth/security-events`     | 安全事件          | Admin       |
| POST   | `/auth/guest-token`         | 產生 Guest Token  | Public      |

### Verification (`/auth`) — 7 routes

> Verification feature 掛載於 `/auth`（`apiV1.route("/auth", verificationFeature.routes)`），與 Authentication feature 共用 `/auth` 前綴，非 `/verification`。

| Method | Path                          | Description     | Auth   |
| ------ | ----------------------------- | --------------- | ------ |
| POST   | `/auth/forgot-password`       | 請求密碼重設    | Public |
| GET    | `/auth/reset-password/verify` | 驗證重設 Token  | Public |
| POST   | `/auth/reset-password`        | 重設密碼        | Public |
| POST   | `/auth/verify-email/send`     | 發送 Email 驗證 | Public |
| GET    | `/auth/verify-email`          | 驗證 Email      | Public |
| POST   | `/auth/verify-phone/send`     | 發送手機 OTP    | Public |
| POST   | `/auth/verify-phone`          | 驗證手機 OTP    | Public |

### Users (`/users`) — 10 routes

| Method | Path                        | Description    | Auth        |
| ------ | --------------------------- | -------------- | ----------- |
| GET    | `/users`                    | 員工列表       | Admin/Owner |
| GET    | `/users/:id`                | 取得員工資料   | Admin/Owner |
| POST   | `/users`                    | 新增員工       | Admin/Owner |
| PUT    | `/users/:id`                | 更新員工       | Admin/Owner |
| POST   | `/users/:id/password`       | 變更員工密碼   | Admin/Owner |
| PATCH  | `/users/:id/status`         | 更新員工狀態   | Admin/Owner |
| PATCH  | `/users/:id/verify`         | 驗證員工       | Admin/Owner |
| POST   | `/users/:id/reset-password` | 管理員重設密碼 | Admin/Owner |
| GET    | `/users/stats`              | 員工統計       | Admin/Owner |
| GET    | `/users/search`             | 搜尋員工       | Admin/Owner |

### Customers (`/customers`) — 2 routes

| Method | Path                   | Description  | Auth     |
| ------ | ---------------------- | ------------ | -------- |
| GET    | `/customers/me`        | 取得顧客資料 | Customer |
| GET    | `/customers/me/orders` | 取得顧客訂單 | Customer |

### Restaurants (`/restaurants`) — 13 routes

| Method | Path                                    | Description       | Auth        |
| ------ | --------------------------------------- | ----------------- | ----------- |
| GET    | `/restaurants`                          | 餐廳列表          | Public      |
| GET    | `/restaurants/popular`                  | 熱門餐廳          | Public      |
| GET    | `/restaurants/nearby/:district`         | 依區域搜尋        | Public      |
| POST   | `/restaurants`                          | 創建餐廳          | Admin       |
| GET    | `/restaurants/:id`                      | 餐廳詳情          | Public      |
| PUT    | `/restaurants/:id`                      | 更新餐廳          | Admin/Owner |
| DELETE | `/restaurants/:id`                      | 停用餐廳          | Admin       |
| GET    | `/restaurants/:id/stats`                | 餐廳統計          | Admin/Owner |
| POST   | `/restaurants/:id/qr/shop/generate`     | 產生店鋪 QR       | Admin/Owner |
| POST   | `/restaurants/:id/qr/shop/regenerate`   | 重新產生店鋪 QR   | Admin/Owner |
| GET    | `/restaurants/:id/qr/shop`              | 取得店鋪 QR 資訊  | Admin/Owner |
| POST   | `/restaurants/:id/qr/shop/upload-image` | 上傳 QR 圖片      | Admin/Owner |
| PUT    | `/restaurants/:id/shop-mode`            | 啟用/停用店鋪模式 | Admin/Owner |

### Members (`/restaurants`) — 8 routes

租戶端會員目錄（#299 spec §7.1），與 `restaurantsFeature.routes` 共用 `/restaurants` 前綴。

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/restaurants/:restaurantId/members` | 會員目錄列表（篩選、分頁） | Admin/Owner |
| GET | `/restaurants/:restaurantId/members/stats` | 會員統計摘要 | Admin/Owner |
| GET | `/restaurants/:restaurantId/members/:memberId` | 會員詳情 | Admin/Owner |
| PATCH | `/restaurants/:restaurantId/members/:memberId` | 更新會員狀態／備註 | Admin/Owner |
| GET | `/restaurants/:restaurantId/members/:memberId/orders` | 會員訂單歷史 | Admin/Owner |
| POST | `/restaurants/:restaurantId/members/:memberId/reveal-contact` | 揭露會員聯絡方式（寫稽核、受限流） | Admin/Owner |
| POST | `/restaurants/:restaurantId/members/export` | 匯出遮罩會員 CSV（寫稽核） | Admin/Owner |
| POST | `/restaurants/:restaurantId/members/recompute` | 重算會員彙總 | Admin |

### Public Reviews (`/restaurants`) — 1 route

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/restaurants/:id/reviews` | 餐廳公開評價列表（顯示名遮罩） | Public |

### Restaurant Broadcasts (`/restaurants`) — 2 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/restaurants/:id/broadcasts` | 對餐廳追蹤者發送推播 | Admin/Owner |
| GET | `/restaurants/:id/broadcasts` | 發送歷史（新到舊） | Admin/Owner |


### Menu (`/menu`) — 17 routes

| Method | Path                                     | Description      | Auth        |
| ------ | ---------------------------------------- | ---------------- | ----------- |
| GET    | `/menu/:restaurantId`                    | 取得完整菜單     | Public      |
| GET    | `/menu/:restaurantId/featured`           | 精選菜單項目     | Public      |
| GET    | `/menu/:restaurantId/popular`            | 熱門菜單項目     | Public      |
| GET    | `/menu/:restaurantId/search`             | 搜尋菜單         | Public      |
| GET    | `/menu/items/:id`                        | 菜單項目詳情     | Public      |
| POST   | `/menu/:restaurantId/items`              | 新增菜單項目     | Protected   |
| PUT    | `/menu/items/:id`                        | 更新菜單項目     | Protected   |
| DELETE | `/menu/items/:id`                        | 刪除菜單項目     | Protected   |
| PATCH  | `/menu/:restaurantId/items/availability` | 批量更新供應狀態 | Protected   |
| PATCH  | `/menu/:restaurantId/items/prices`       | 批量更新價格     | Protected   |
| PATCH  | `/menu/:restaurantId/items/categories`   | 批量移動分類     | Protected   |
| POST   | `/menu/:restaurantId/categories`         | 新增分類         | Protected   |
| PUT    | `/menu/categories/:id`                   | 更新分類         | Protected   |
| PATCH  | `/menu/:restaurantId/categories/reorder` | 分類排序         | Protected   |
| DELETE | `/menu/categories/:id`                   | 刪除分類         | Protected   |
| GET    | `/menu/:restaurantId/analytics`          | 菜單分析         | Admin/Owner |
| GET    | `/menu/:restaurantId/popularity`         | 人氣指標         | Admin/Owner |

### Orders (`/orders`) — 14 routes

| Method | Path                     | Description     | Auth        |
| ------ | ------------------------ | --------------- | ----------- |
| POST   | `/orders/guest`          | 建立 Guest 訂單 | Guest Token |
| GET    | `/orders/guest/:id`      | 查詢 Guest 訂單 | Guest Token |
| POST   | `/orders/preview-coupon` | 預覽優惠券效果  | Protected   |
| POST   | `/orders`                | 建立訂單        | Protected   |
| GET    | `/orders`                | 訂單列表        | Protected   |
| GET    | `/orders/:id`            | 訂單詳情        | Protected   |
| PUT    | `/orders/:id/status`     | 更新訂單狀態    | Protected   |
| DELETE | `/orders/:id`            | 取消訂單        | Protected   |
| GET    | `/orders/stats`          | 訂單統計        | Admin/Owner |
| GET    | `/orders/analytics`      | 訂單分析        | Admin/Owner |
| POST   | `/orders/bulk`           | 批量操作        | Admin/Owner |
| POST   | `/orders/export`         | 匯出訂單        | Admin/Owner |
| GET    | `/orders/:id/receipt`    | 產生收據        | Protected   |
| GET    | `/orders/active`         | 進行中訂單      | Protected   |

### Order Reviews (`/orders`) — 2 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/orders/:id/review` | 顧客提交訂單評價 | Customer（可選登入，訂單 token 授權） |
| GET | `/orders/:id/review` | 讀回該訂單評價與店家回覆 | Customer（可選登入，訂單 token 授權） |


### Guest Orders (`/guest-orders`) — 4 routes

| Method | Path                       | Description     | Auth   |
| ------ | -------------------------- | --------------- | ------ |
| POST   | `/guest-orders`            | 建立 Guest 訂單 | Public |
| GET    | `/guest-orders/:id`        | 查詢 Guest 訂單 | Guest  |
| POST   | `/guest-orders/:id/items`  | 加入品項        | Guest  |
| POST   | `/guest-orders/:id/cancel` | 取消 Guest 訂單 | Guest  |

### Group Orders (`/orders/group`) — 15 routes

> 掛載於 `/orders/group`（見 `app-factory.ts`），非 `/group-orders`。

| Method | Path                                            | Description    | Auth      |
| ------ | ----------------------------------------------- | -------------- | --------- |
| GET    | `/orders/group`                                 | 團體訂單列表   | Protected |
| POST   | `/orders/group/generate-code`                   | 產生分享碼     | Protected |
| GET    | `/orders/group/export`                          | 匯出團體訂單   | Protected |
| POST   | `/orders/group/create`                          | 建立團體訂單   | Protected |
| POST   | `/orders/group/join/:shareCode`                 | 加入團體訂單   | Public    |
| GET    | `/orders/group/statistics`                      | 團體訂單統計   | Protected |
| GET    | `/orders/group/:groupOrderId`                   | 團體訂單詳情   | Public    |
| POST   | `/orders/group/:groupOrderId/cart`              | 加入購物車     | Protected |
| PUT    | `/orders/group/:groupOrderId/cart/:itemId`      | 更新購物車品項 | Protected |
| DELETE | `/orders/group/:groupOrderId/cart/:itemId`      | 移除購物車品項 | Protected |
| POST   | `/orders/group/:groupOrderId/split`             | 分帳           | Protected |
| POST   | `/orders/group/:groupOrderId/payment/:memberId` | 處理付款       | Protected |
| POST   | `/orders/group/:groupOrderId/leave/:memberId`   | 離開團體       | Protected |
| GET    | `/orders/group/:groupOrderId/activities`        | 活動紀錄       | Protected |
| POST   | `/orders/group/cleanup/expired`                 | 清理過期團體   | Admin     |

### Tables (`/tables`) — 13 routes

| Method | Path                        | Description    | Auth      |
| ------ | --------------------------- | -------------- | --------- |
| GET    | `/tables`                   | 桌位列表       | Protected |
| GET    | `/tables/:id`               | 桌位詳情       | Protected |
| POST   | `/tables`                   | 新增桌位       | Protected |
| PUT    | `/tables/:id`               | 更新桌位       | Protected |
| DELETE | `/tables/:id`               | 刪除桌位       | Protected |
| POST   | `/tables/:id/occupy`        | 佔用桌位       | Protected |
| POST   | `/tables/:id/release`       | 釋放桌位       | Protected |
| POST   | `/tables/:id/clean`         | 標記已清潔     | Protected |
| POST   | `/tables/:id/regenerate-qr` | 重新產生 QR    | Protected |
| POST   | `/tables/bulk-qr`           | 批量產生 QR    | Protected |
| GET    | `/tables/available`         | 可用桌位       | Protected |
| GET    | `/tables/stats`             | 桌位統計       | Protected |
| GET    | `/tables/qr/:qrCode`        | 依 QR 查詢桌位 | Public    |

### Seats (`/seats`) — 12 routes

| Method | Path                         | Description      | Auth      |
| ------ | ---------------------------- | ---------------- | --------- |
| GET    | `/seats`                     | 座位列表         | Protected |
| GET    | `/seats/stats`               | 座位統計         | Protected |
| GET    | `/seats/qr/:qrCode`          | 依 QR 查詢座位   | Public    |
| GET    | `/seats/:id`                 | 座位詳情         | Protected |
| POST   | `/seats/batch-create`        | 批量建立座位     | Protected |
| POST   | `/seats/batch-regenerate-qr` | 批量重新產生 QR  | Protected |
| PUT    | `/seats/:id`                 | 更新座位         | Protected |
| DELETE | `/seats/:id`                 | 刪除座位         | Protected |
| DELETE | `/seats/table/:tableId`      | 刪除桌位所有座位 | Protected |
| POST   | `/seats/:id/occupy`          | 佔用座位         | Protected |
| POST   | `/seats/:id/release`         | 釋放座位         | Protected |
| POST   | `/seats/:id/regenerate-qr`   | 重新產生 QR      | Protected |

### QR Codes (`/qr`) — 11 routes

| Method | Path                          | Description  | Auth      |
| ------ | ----------------------------- | ------------ | --------- |
| POST   | `/qr/generate`                | 產生 QR 碼   | Protected |
| POST   | `/qr/bulk`                    | 批量產生 QR  | Protected |
| GET    | `/qr/:id/download`            | 下載 QR 圖片 | Protected |
| GET    | `/qr/batch/:batchId/download` | 下載批量 QR  | Protected |
| GET    | `/qr/stats`                   | QR 統計      | Protected |
| GET    | `/qr/templates`               | QR 模板列表  | Protected |
| GET    | `/qr/templates/:id`           | 模板詳情     | Protected |
| POST   | `/qr/templates`               | 建立模板     | Protected |
| PUT    | `/qr/templates/:id`           | 更新模板     | Protected |
| DELETE | `/qr/templates/:id`           | 刪除模板     | Protected |
| GET    | `/qr/verify/shop/:qrCode`     | 驗證店鋪 QR  | Public    |

### Reservations (`/reservations`) — 15 routes

| Method | Path                                | Description  | Auth      |
| ------ | ----------------------------------- | ------------ | --------- |
| POST   | `/reservations`                     | 建立預約     | Public    |
| GET    | `/reservations/verify/:code`        | 依確認碼查詢 | Public    |
| GET    | `/reservations/availability`        | 查詢可用時段 | Public    |
| DELETE | `/reservations/:id/cancel`          | 取消預約     | Public    |
| GET    | `/reservations`                     | 預約列表     | Protected |
| GET    | `/reservations/:id`                 | 預約詳情     | Protected |
| PUT    | `/reservations/:id`                 | 更新預約     | Protected |
| POST   | `/reservations/:id/confirm`         | 確認預約     | Protected |
| POST   | `/reservations/:id/arrive`          | 標記到達     | Protected |
| POST   | `/reservations/:id/seat`            | 標記已入座   | Protected |
| POST   | `/reservations/:id/complete`        | 完成預約     | Protected |
| POST   | `/reservations/:id/no-show`         | 標記未到     | Protected |
| GET    | `/reservations/stats/:restaurantId` | 預約統計     | Protected |
| POST   | `/reservations/slots`               | 建立時段     | Protected |
| POST   | `/reservations/slots/batch`         | 批量建立時段 | Protected |

### Queue (`/queue`) — 7 routes

| Method | Path                              | Description      | Auth      |
| ------ | --------------------------------- | ---------------- | --------- |
| POST   | `/queue/join`                     | 加入排隊         | Public    |
| GET    | `/queue/:restaurantId/status`     | 排隊狀態         | Public    |
| POST   | `/queue/:restaurantId/call-next`  | 叫號             | Protected |
| POST   | `/queue/:queueId/seat`            | 帶位入座         | Protected |
| GET    | `/queue/restaurant/:restaurantId` | 排隊列表（舊版） | Protected |
| POST   | `/queue/:restaurantId/migrate`    | 遷移排隊資料     | Admin     |
| GET    | `/queue/health`                   | 排隊系統健康檢查 | Public    |

### Waiting List (`/waiting-list`) — 12 routes

| Method | Path                                        | Description  | Auth      |
| ------ | ------------------------------------------- | ------------ | --------- |
| POST   | `/waiting-list`                             | 加入候位     | Public    |
| GET    | `/waiting-list/:id`                         | 查詢候位     | Public    |
| GET    | `/waiting-list/queue-status/:restaurantId`  | 候位狀態     | Public    |
| GET    | `/waiting-list/estimate-wait/:restaurantId` | 預估等候時間 | Public    |
| DELETE | `/waiting-list/:id`                         | 取消候位     | Public    |
| POST   | `/waiting-list/:id/confirm`                 | 確認候位     | Public    |
| GET    | `/waiting-list`                             | 候位列表     | Protected |
| POST   | `/waiting-list/:id/call`                    | 叫號         | Protected |
| POST   | `/waiting-list/:id/seat`                    | 標記已入座   | Protected |
| POST   | `/waiting-list/:id/expire`                  | 標記過期     | Protected |
| GET    | `/waiting-list/stats/:restaurantId`         | 候位統計     | Protected |
| POST   | `/waiting-list/batch-call`                  | 批量叫號     | Protected |

### Coupons (`/coupons`) — 13 routes

| Method | Path                               | Description    | Auth      |
| ------ | ---------------------------------- | -------------- | --------- |
| POST   | `/coupons/validate`                | 驗證優惠碼     | Public    |
| GET    | `/coupons/available/:restaurantId` | 可用優惠券     | Public    |
| POST   | `/coupons`                         | 建立優惠券     | Protected |
| GET    | `/coupons`                         | 優惠券列表     | Protected |
| GET    | `/coupons/stats/summary`           | 優惠券統計摘要 | Protected |
| GET    | `/coupons/:id`                     | 優惠券詳情     | Protected |
| PUT    | `/coupons/:id`                     | 更新優惠券     | Protected |
| POST   | `/coupons/:id/deactivate`          | 停用優惠券     | Protected |
| DELETE | `/coupons/:id`                     | 刪除優惠券     | Admin     |
| GET    | `/coupons/:id/stats`               | 優惠券使用統計 | Protected |
| POST   | `/coupons/bulk`                    | 批量操作       | Protected |
| POST   | `/coupons/use`                     | 記錄使用       | Protected |
| GET    | `/coupons/analytics/trends`        | 使用趨勢       | Protected |

### Partnerships (`/partnerships`) — 22 routes

| Method | Path                                      | Description  | Auth      |
| ------ | ----------------------------------------- | ------------ | --------- |
| POST   | `/partnerships`                           | 建立合作夥伴 | Protected |
| GET    | `/partnerships`                           | 合作夥伴列表 | Protected |
| GET    | `/partnerships/:id`                       | 合作夥伴詳情 | Protected |
| GET    | `/partnerships/:id/statistics`            | 合作統計     | Protected |
| PUT    | `/partnerships/:id`                       | 更新合作夥伴 | Protected |
| DELETE | `/partnerships/:id`                       | 刪除合作夥伴 | Protected |
| POST   | `/partnerships/plans`                     | 建立方案     | Protected |
| GET    | `/partnerships/plans`                     | 方案列表     | Protected |
| GET    | `/partnerships/plans/:planId`             | 方案詳情     | Protected |
| POST   | `/partnerships/plans/validate`            | 驗證方案     | Protected |
| PUT    | `/partnerships/plans/:planId`             | 更新方案     | Protected |
| DELETE | `/partnerships/plans/:planId`             | 刪除方案     | Protected |
| POST   | `/partnerships/members/verify`            | 會員驗證     | Protected |
| GET    | `/partnerships/members`                   | 會員列表     | Protected |
| GET    | `/partnerships/members/:memberId`         | 會員詳情     | Protected |
| POST   | `/partnerships/members/:memberId/approve` | 核准會員     | Protected |
| POST   | `/partnerships/members/:memberId/reject`  | 拒絕會員     | Protected |
| PUT    | `/partnerships/members/:memberId`         | 更新會員     | Protected |
| POST   | `/partnerships/usage`                     | 記錄使用     | Protected |
| GET    | `/partnerships/usage`                     | 使用紀錄     | Protected |
| POST   | `/partnerships/usage/:id/cancel`          | 取消使用     | Protected |
| POST   | `/partnerships/usage/:id/refund`          | 退款         | Protected |

### POS (`/pos`) — 25 routes

**收銀機管理：**

| Method | Path                                    | Description | Auth      |
| ------ | --------------------------------------- | ----------- | --------- |
| POST   | `/pos/registers`                        | 建立收銀機  | Protected |
| GET    | `/pos/registers`                        | 收銀機列表  | Protected |
| GET    | `/pos/registers/:registerId/status`     | 收銀機狀態  | Protected |
| PUT    | `/pos/registers/:registerId`            | 更新收銀機  | Protected |
| POST   | `/pos/registers/:registerId/activate`   | 啟用收銀機  | Protected |
| POST   | `/pos/registers/:registerId/deactivate` | 停用收銀機  | Protected |
| DELETE | `/pos/registers/:registerId`            | 刪除收銀機  | Protected |

**班次管理：**

| Method | Path                              | Description | Auth      |
| ------ | --------------------------------- | ----------- | --------- |
| POST   | `/pos/shifts/start`               | 開始班次    | Protected |
| POST   | `/pos/shifts/:shiftId/end`        | 結束班次    | Protected |
| POST   | `/pos/shifts/:shiftId/suspend`    | 暫停班次    | Protected |
| POST   | `/pos/shifts/:shiftId/resume`     | 恢復班次    | Protected |
| GET    | `/pos/shifts/current/:registerId` | 當前班次    | Protected |
| GET    | `/pos/shifts/:shiftId/report`     | 班次報表    | Protected |
| GET    | `/pos/shifts/stats`               | 班次統計    | Protected |

**現金管理：**

| Method | Path                                      | Description  | Auth      |
| ------ | ----------------------------------------- | ------------ | --------- |
| POST   | `/pos/shifts/:shiftId/cash-movements`     | 記錄現金異動 | Protected |
| GET    | `/pos/shifts/:shiftId/cash-movements`     | 現金異動紀錄 | Protected |
| GET    | `/pos/registers/:registerId/cash-count`   | 現金盤點     | Protected |
| POST   | `/pos/cash-movements/:movementId/approve` | 核准異動     | Protected |
| POST   | `/pos/cash-movements/:movementId/reject`  | 拒絕異動     | Protected |

**收據：**

| Method | Path                                  | Description | Auth      |
| ------ | ------------------------------------- | ----------- | --------- |
| POST   | `/pos/receipts/print`                 | 列印收據    | Protected |
| POST   | `/pos/receipts/:receiptId/reprint`    | 重印收據    | Protected |
| POST   | `/pos/receipts/:receiptId/cancel`     | 作廢收據    | Protected |
| GET    | `/pos/registers/:registerId/receipts` | 收據列表    | Protected |
| GET    | `/pos/receipts/:receiptId`            | 收據詳情    | Protected |

### Print Agent (`/print`) — 2 routes

These machine-to-machine endpoints authenticate with the
`X-Print-Agent-Key` header, not a browser session. They are restricted to the
agent's restaurant and register scope.

| Method | Path                           | Description                                  | Auth            |
| ------ | ------------------------------ | -------------------------------------------- | --------------- |
| GET    | `/print/jobs`                  | Claim the next pending receipt print job     | Print agent key |
| POST   | `/print/jobs/:receiptId/ack`   | Acknowledge a claimed job as printed/failed  | Print agent key |

### Kitchen (`/kitchen`) — 5 routes

| Method | Path                                                   | Description      | Auth      |
| ------ | ------------------------------------------------------ | ---------------- | --------- |
| GET    | `/kitchen/:restaurantId/events`                        | SSE 廚房即時事件 | Protected |
| GET    | `/kitchen/:restaurantId/orders`                        | 廚房訂單列表     | Protected |
| PUT    | `/kitchen/:restaurantId/orders/:orderId/items/:itemId` | 更新品項狀態     | Protected |
| POST   | `/kitchen/:restaurantId/broadcast-test`                | 測試廣播         | Dev       |
| GET    | `/kitchen/:restaurantId/connections`                   | 連線狀態         | Protected |

### Ingredients (`/ingredients`) — 12 routes

| Method | Path                                                      | Description    | Auth      |
| ------ | --------------------------------------------------------- | -------------- | --------- |
| GET    | `/ingredients/:restaurantId`                              | 食材列表       | Protected |
| POST   | `/ingredients/:restaurantId`                              | 新增食材       | Protected |
| POST   | `/ingredients/:restaurantId/bulk`                         | 批量匯入食材   | Protected |
| GET    | `/ingredients/:restaurantId/categories`                   | 食材分類       | Protected |
| GET    | `/ingredients/:restaurantId/recipes/missing`              | 缺少食譜的品項 | Protected |
| GET    | `/ingredients/:restaurantId/:id`                          | 食材詳情       | Protected |
| PUT    | `/ingredients/:restaurantId/:id`                          | 更新食材       | Protected |
| PATCH  | `/ingredients/:restaurantId/:id/stock`                    | 更新庫存       | Protected |
| DELETE | `/ingredients/:restaurantId/:id`                          | 刪除食材       | Protected |
| GET    | `/ingredients/:restaurantId/recipes/:menuItemId`          | 取得食譜       | Protected |
| PUT    | `/ingredients/:restaurantId/recipes/:menuItemId`          | 設定食譜       | Protected |
| POST   | `/ingredients/:restaurantId/recipes/:menuItemId/validate` | 驗證食譜       | Protected |

### Forecast (`/forecast`) — 5 routes

| Method | Path                                          | Description  | Auth      |
| ------ | --------------------------------------------- | ------------ | --------- |
| POST   | `/forecast/:restaurantId/generate`            | 產生預測     | Protected |
| GET    | `/forecast/:restaurantId`                     | 取得預測資料 | Protected |
| GET    | `/forecast/:restaurantId/accuracy`            | 預測準確度   | Protected |
| GET    | `/forecast/:restaurantId/ingredient-forecast` | 食材預測     | Protected |
| GET    | `/forecast/:restaurantId/alerts`              | 預測警告     | Protected |

### Discovery (`/discovery`) — 5 routes

| Method | Path                              | Description | Auth   |
| ------ | --------------------------------- | ----------- | ------ |
| GET    | `/discovery/search`               | 搜尋菜餚    | Public |
| GET    | `/discovery/restaurants`          | 瀏覽餐廳    | Public |
| GET    | `/discovery/restaurants/:id/menu` | 餐廳菜單    | Public |
| GET    | `/discovery/popular`              | 熱門品項    | Public |
| POST   | `/discovery/reindex`              | 重建索引    | Admin  |

### Analytics (`/analytics`) — 11 routes

| Method | Path                              | Description  | Auth      |
| ------ | --------------------------------- | ------------ | --------- |
| GET    | `/analytics/dashboard`            | 儀表板分析   | Protected |
| GET    | `/analytics/revenue`              | 營收分析     | Protected |
| GET    | `/analytics/products`             | 產品分析     | Protected |
| GET    | `/analytics/customers`            | 顧客分析     | Protected |
| GET    | `/analytics/performance`          | 績效分析     | Protected |
| GET    | `/analytics/export`               | 匯出分析資料 | Protected |
| GET    | `/analytics/realtime-dashboard`   | 即時儀表板   | Protected |
| GET    | `/analytics/detailed-performance` | 詳細績效     | Protected |
| GET    | `/analytics/owner-dashboard`      | 店主儀表板   | Protected |
| GET    | `/analytics/financial-report`     | 財務報表     | Protected |
| GET    | `/analytics/sse`                  | SSE 分析串流 | Protected |

### AI Analytics (`/ai-analytics`) — 10 routes

| Method | Path                                                   | Description      | Auth      |
| ------ | ------------------------------------------------------ | ---------------- | --------- |
| GET    | `/ai-analytics/config/:restaurantId`                   | 取得 AI 設定     | Protected |
| POST   | `/ai-analytics/config`                                 | 設定 AI Provider | Protected |
| POST   | `/ai-analytics/test-provider`                          | 測試 Provider    | Protected |
| GET    | `/ai-analytics/models/:provider`                       | 可用模型列表     | Protected |
| POST   | `/ai-analytics/generate`                               | 產生 AI 分析報告 | Protected |
| GET    | `/ai-analytics/products/traffic-drivers/:restaurantId` | 流量驅動品項     | Protected |
| GET    | `/ai-analytics/products/bestsellers/:restaurantId`     | 暢銷品項         | Protected |
| GET    | `/ai-analytics/products/profit-leaders/:restaurantId`  | 利潤領先品項     | Protected |
| GET    | `/ai-analytics/products/analysis/:restaurantId`        | 產品分析         | Protected |
| GET    | `/ai-analytics/usage/:restaurantId`                    | AI 使用統計      | Protected |

### Scheduling (`/scheduling`) — 30 routes

**班表模板：**

| Method | Path                                  | Description  | Auth      |
| ------ | ------------------------------------- | ------------ | --------- |
| GET    | `/scheduling/:restaurantId/templates` | 班表模板列表 | Protected |
| GET    | `/scheduling/templates/:id`           | 模板詳情     | Protected |
| POST   | `/scheduling/:restaurantId/templates` | 建立模板     | Protected |
| PUT    | `/scheduling/templates/:id`           | 更新模板     | Protected |
| DELETE | `/scheduling/templates/:id`           | 刪除模板     | Protected |

**排班：**

| Method | Path                                       | Description | Auth      |
| ------ | ------------------------------------------ | ----------- | --------- |
| GET    | `/scheduling/:restaurantId/schedules`      | 排班列表    | Protected |
| GET    | `/scheduling/schedules/:id`                | 排班詳情    | Protected |
| POST   | `/scheduling/:restaurantId/schedules`      | 建立排班    | Protected |
| POST   | `/scheduling/:restaurantId/schedules/bulk` | 批量排班    | Protected |
| PUT    | `/scheduling/schedules/:id`                | 更新排班    | Protected |
| DELETE | `/scheduling/schedules/:id`                | 刪除排班    | Protected |

**打卡：**

| Method | Path                                        | Description    | Auth        |
| ------ | ------------------------------------------- | -------------- | ----------- |
| POST   | `/scheduling/schedules/:id/clock-in`        | 上班打卡       | Protected   |
| POST   | `/scheduling/schedules/:id/clock-out`       | 下班打卡       | Protected   |
| GET    | `/scheduling/:restaurantId/clocked-in`      | 在班員工       | Protected   |
| POST   | `/scheduling/schedules/:id/admin-clock-in`  | 管理員代打上班 | Admin/Owner |
| POST   | `/scheduling/schedules/:id/admin-clock-out` | 管理員代打下班 | Admin/Owner |

**出勤報表：**

| Method | Path                                                 | Description        | Auth      |
| ------ | ---------------------------------------------------- | ------------------ | --------- |
| GET    | `/scheduling/:restaurantId/attendance-report`        | 出勤報表           | Protected |
| GET    | `/scheduling/:restaurantId/attendance-report/export` | 匯出出勤報表 (CSV) | Protected |

**換班：**

| Method | Path                                      | Description  | Auth        |
| ------ | ----------------------------------------- | ------------ | ----------- |
| POST   | `/scheduling/:restaurantId/swap-requests` | 建立換班申請 | Protected   |
| GET    | `/scheduling/:restaurantId/swap-requests` | 換班申請列表 | Protected   |
| POST   | `/scheduling/swap-requests/:id/accept`    | 接受換班     | Protected   |
| POST   | `/scheduling/swap-requests/:id/approve`   | 核准換班     | Admin/Owner |
| POST   | `/scheduling/swap-requests/:id/reject`    | 拒絕換班     | Protected   |
| POST   | `/scheduling/swap-requests/:id/cancel`    | 取消換班     | Protected   |

**統計與衝突：**

| Method | Path                                            | Description | Auth      |
| ------ | ----------------------------------------------- | ----------- | --------- |
| GET    | `/scheduling/:restaurantId/available-employees` | 可排班員工  | Protected |
| GET    | `/scheduling/:restaurantId/conflicts`           | 排班衝突    | Protected |
| GET    | `/scheduling/conflicts/:id`                     | 衝突詳情    | Protected |
| POST   | `/scheduling/conflicts/:id/resolve`             | 解決衝突    | Protected |
| GET    | `/scheduling/:restaurantId/stats/daily`         | 每日統計    | Protected |
| GET    | `/scheduling/:restaurantId/stats/weekly`        | 每週統計    | Protected |

### Leaves (`/leaves`) — 17 routes

| Method | Path                                      | Description  | Auth      |
| ------ | ----------------------------------------- | ------------ | --------- |
| GET    | `/leaves/:restaurantId/types`             | 假別列表     | Protected |
| GET    | `/leaves/types/:id`                       | 假別詳情     | Protected |
| POST   | `/leaves/:restaurantId/types`             | 建立假別     | Protected |
| PUT    | `/leaves/types/:id`                       | 更新假別     | Protected |
| DELETE | `/leaves/types/:id`                       | 刪除假別     | Protected |
| GET    | `/leaves/balances`                        | 員工假期餘額 | Protected |
| POST   | `/leaves/balances/adjust`                 | 調整假期餘額 | Protected |
| GET    | `/leaves/:restaurantId/balances`          | 餐廳假期餘額 | Protected |
| POST   | `/leaves/:restaurantId/balances/accrue`   | 累計假期     | Protected |
| GET    | `/leaves/:restaurantId/requests`          | 請假申請列表 | Protected |
| GET    | `/leaves/requests/:id`                    | 請假申請詳情 | Protected |
| POST   | `/leaves/:restaurantId/requests`          | 建立請假申請 | Protected |
| POST   | `/leaves/requests/:id/approve`            | 核准請假     | Protected |
| POST   | `/leaves/requests/:id/reject`             | 拒絕請假     | Protected |
| POST   | `/leaves/requests/:id/cancel`             | 取消請假     | Protected |
| GET    | `/leaves/:restaurantId/holidays`          | 假日列表     | Protected |
| GET    | `/leaves/:restaurantId/working-day/:date` | 查詢工作日   | Protected |

### Integrations (`/integrations`) — 10 routes

**管理端：**

| Method | Path                                              | Description  | Auth      |
| ------ | ------------------------------------------------- | ------------ | --------- |
| GET    | `/integrations/:restaurantId`                     | 整合列表     | Protected |
| GET    | `/integrations/:restaurantId/webhook-logs`        | Webhook 紀錄 | Protected |
| GET    | `/integrations/:restaurantId/:platform`           | 整合詳情     | Protected |
| POST   | `/integrations/:restaurantId/:platform/connect`   | 連接平台     | Protected |
| PUT    | `/integrations/:restaurantId/:platform`           | 更新設定     | Protected |
| DELETE | `/integrations/:restaurantId/:platform`           | 斷開連接     | Protected |
| POST   | `/integrations/:restaurantId/:platform/menu-sync` | 同步菜單     | Protected |
| GET    | `/integrations/:restaurantId/:platform/orders`    | 平台訂單     | Protected |

**Webhook 接收：**

| Method | Path                               | Description       | Auth |
| ------ | ---------------------------------- | ----------------- | ---- |
| POST   | `/integrations/webhooks/uber-eats` | Uber Eats Webhook | HMAC |
| POST   | `/integrations/webhooks/foodpanda` | Foodpanda Webhook | HMAC |

### Realtime (`/realtime`) — 10 routes

`/api/v1/realtime/auth` sits on the auth-exclusion list in `app-factory.ts`, so
the two token-minting routes carry **no session middleware**. They authorize from
the request body instead, and the table below says which credential each one
requires — do not read "Public" as "unauthenticated callers get a token".

| Method | Path                                | Description          | Auth                                    |
| ------ | ----------------------------------- | -------------------- | --------------------------------------- |
| POST   | `/realtime/auth/token`              | 產生員工 WebSocket Token | Public route; requires a valid staff `sessionId` JWT in the body. Staff rooms only (`kitchen`/`admin`/`restaurant`) |
| POST   | `/realtime/auth/guest-token`        | 產生訪客 WebSocket Token | Public route + rate limited; requires an HMAC-signed QR or a KV guest token. Pins roomId to `order:{orderId}` / `customer:{tableId}` |
| POST   | `/realtime/auth/group-token`        | 群組訂單成員換取 WebSocket Token | Public route + rate limited; requires the `memberToken` (`group_members.session_id`) handed out once at create/join. Pins roomId to the group order UUID |
| POST   | `/realtime/auth/verify`             | 驗證 Token           | Public route; the token itself is the credential |
| POST   | `/realtime/auth/revoke`             | 撤銷 Token           | Protected (role 0)                      |
| POST   | `/realtime/auth/revoke-user`        | 撤銷用戶所有 Token   | Protected (role 0)                      |
| GET    | `/realtime/auth/blacklist/stats`    | 黑名單統計           | Protected (role 0)                      |
| GET    | `/realtime/stats/:roomType/:roomId` | 房間統計             | Protected                               |
| GET    | `/realtime/stats/overview`          | 即時總覽             | Protected                               |
| GET    | `/realtime/health`                  | 即時系統健康檢查     | Public                                  |

`/realtime/auth/token` deliberately rejects `roomType: "customer"`. It cannot
verify a customer, and a table/seat ID is a guessable integer rather than proof
of presence — see issue #96. Every `customer` room token therefore comes from
`guest-token` or `group-token`, and both pin `roomId` to whatever they verified,
so a token can never be replayed against a different room.

### SSE (`/sse`) — 9 routes

| Method | Path                                 | Description    | Auth      |
| ------ | ------------------------------------ | -------------- | --------- |
| GET    | `/sse/events`                        | SSE 事件串流   | Protected |
| POST   | `/sse/test`                          | 測試廣播       | Protected |
| GET    | `/sse/connections`                   | 連線狀態       | Protected |
| POST   | `/sse/broadcast/order-update`        | 廣播訂單更新   | Protected |
| POST   | `/sse/broadcast/menu-update`         | 廣播菜單更新   | Protected |
| POST   | `/sse/broadcast/system-notification` | 廣播系統通知   | Protected |
| POST   | `/sse/broadcast/group-created`       | 廣播團體建立   | Protected |
| POST   | `/sse/broadcast/member-joined`       | 廣播成員加入   | Protected |
| POST   | `/sse/broadcast/cart-updated`        | 廣播購物車更新 | Protected |

### Notifications (`/notifications`) — 3 routes

| Method | Path                       | Description  | Auth      |
| ------ | -------------------------- | ------------ | --------- |
| POST   | `/notifications/test`      | 發送測試通知 | Protected |
| GET    | `/notifications/templates` | 通知模板列表 | Protected |
| POST   | `/notifications/send`      | 發送通知     | Protected |

### System (`/system`) — 8 routes

| Method | Path                            | Description  | Auth      |
| ------ | ------------------------------- | ------------ | --------- |
| POST   | `/system/error-report`          | 回報錯誤     | Protected |
| GET    | `/system/health`                | 健康檢查     | Public    |
| GET    | `/system/error-stats`           | 錯誤統計     | Admin     |
| DELETE | `/system/error-reports/cleanup` | 清理錯誤報告 | Admin     |
| GET    | `/system/health/detailed`       | 詳細健康檢查 | Admin     |
| GET    | `/system/health/metrics`        | 健康指標     | Admin     |
| GET    | `/system/health/ready`          | 就緒檢查     | Protected |
| GET    | `/system/health/live`           | 存活檢查     | Protected |

### Monitoring (`/monitoring`) — 13 routes

| Method | Path                              | Description  | Auth      |
| ------ | --------------------------------- | ------------ | --------- |
| GET    | `/monitoring/health`              | 健康檢查     | Public    |
| GET    | `/monitoring/metrics`             | 指標數據     | Protected |
| DELETE | `/monitoring/metrics`             | 重設指標     | Admin     |
| POST   | `/monitoring/errors`              | 記錄錯誤     | Admin     |
| GET    | `/monitoring/alerts/rules`        | 警報規則列表 | Protected |
| POST   | `/monitoring/alerts/rules`        | 建立警報規則 | Protected |
| PUT    | `/monitoring/alerts/rules/:id`    | 更新警報規則 | Protected |
| DELETE | `/monitoring/alerts/rules/:id`    | 刪除警報規則 | Protected |
| GET    | `/monitoring/alerts/recent`       | 近期警報     | Protected |
| GET    | `/monitoring/alerts/defaults`     | 預設規則     | Protected |
| POST   | `/monitoring/alerts/test`         | 測試警報     | Protected |
| GET    | `/monitoring/overview`            | 系統總覽     | Protected |
| GET    | `/monitoring/reports/performance` | 效能報表     | Protected |

### Backup (`/backup`) — 11 routes

| Method | Path                                         | Description   | Auth  |
| ------ | -------------------------------------------- | ------------- | ----- |
| POST   | `/backup/create`                             | 建立備份      | Admin |
| GET    | `/backup/list`                               | 備份列表      | Admin |
| GET    | `/backup/:id`                                | 備份詳情      | Admin |
| GET    | `/backup/:id/download`                       | 下載備份      | Admin |
| POST   | `/backup/:id/restore`                        | 還原備份      | Admin |
| DELETE | `/backup/:id`                                | 刪除備份      | Admin |
| GET    | `/backup/configurations/:restaurant_id`      | 備份設定      | Admin |
| POST   | `/backup/configurations`                     | 建立/更新設定 | Admin |
| GET    | `/backup/system/health`                      | 備份系統健康  | Admin |
| GET    | `/backup/restaurants/:restaurant_id/metrics` | 備份指標      | Admin |
| GET    | `/backup/alerts/:restaurant_id`              | 備份警報      | Admin |

### Cache (`/cache`) — 8 routes

| Method | Path                | Description  | Auth  |
| ------ | ------------------- | ------------ | ----- |
| GET    | `/cache/stats`      | 快取統計     | Admin |
| GET    | `/cache/health`     | 快取健康     | Admin |
| POST   | `/cache/invalidate` | 依標籤清除   | Admin |
| POST   | `/cache/cleanup`    | 清理過期快取 | Admin |
| POST   | `/cache/warmup`     | 預熱快取     | Admin |
| DELETE | `/cache/stats`      | 重設統計     | Admin |
| GET    | `/cache/config`     | 快取設定     | Admin |
| POST   | `/cache/test`       | 測試快取     | Admin |

### Payments (`/payments`) — 5 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/payments/` | 處理付款 | Protected |
| POST | `/payments/create` | 建立並處理付款（舊版） | Protected |
| GET | `/payments/status/:transactionId` | 依交易 ID 查詢付款狀態 | Protected |
| POST | `/payments/refund` | 退款 | Protected |
| GET | `/payments/methods/:country` | 依國別取得支援的付款方式 | Protected |

### Credits (`/credits`) — 9 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/credits/cards` | 發行儲值卡 | Admin |
| POST | `/credits/cards/:publicId/topup` | 儲值（管理端） | Admin |
| POST | `/credits/cards/:publicId/topup/online` | 線上儲值 | Public |
| POST | `/credits/topup-webhooks/:provider` | 儲值供應商回呼 | Public (HMAC) |
| GET | `/credits/cards/:publicId/balance` | 查詢卡片餘額 | Public |
| POST | `/credits/cards/:publicId/pin` | 設定/重設卡片 PIN | Admin |
| POST | `/credits/cards/:publicId/freeze` | 凍結/掛失/復用卡片 | Admin |
| GET | `/credits/cards/:publicId/ledger` | 卡片帳務明細 | Admin |
| GET | `/credits/accounting/export` | 匯出儲值負債帳本 CSV | Admin |

### Billing (`/billing`) — 1 route

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/billing/webhooks/:provider` | 計費供應商 webhook 回呼 | Public (signature verified) |

### Markets (`/markets`) — 5 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/markets/` | 市場列表（含篩選） | Public |
| GET | `/markets/nearby` | 依座標搜尋鄰近市場 | Public |
| GET | `/markets/areas` | 市場區域列表 | Public |
| GET | `/markets/:slug/vendors` | 市場攤位列表 | Public |
| GET | `/markets/:slug` | 依 slug 取得市場詳情 | Public |

### Market Broadcasts (`/markets`) — 2 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/markets/:id/broadcasts` | 對市場追蹤者發送公告 | Admin |
| GET | `/markets/:id/broadcasts` | 發送歷史（新到舊） | Admin |


### Admin Markets (`/admin/markets`) — 13 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/admin/markets/readiness` | 市場上線就緒狀態 | Admin |
| GET | `/admin/markets/area-readiness` | 區域就緒狀態 | Admin |
| GET | `/admin/markets/vendor-candidates` | 攤位候選清單 | Admin |
| GET | `/admin/markets/join-requests` | 市場加入申請列表 | Admin |
| POST | `/admin/markets/join-requests/:requestId/approve` | 核准加入申請 | Admin |
| POST | `/admin/markets/join-requests/:requestId/reject` | 駁回加入申請 | Admin |
| POST | `/admin/markets/` | 建立市場 | Admin |
| PUT | `/admin/markets/:id` | 更新市場 | Admin |
| DELETE | `/admin/markets/:id` | 軟刪除市場 | Admin |
| POST | `/admin/markets/:id/vendors` | 新增攤位至市場 | Admin |
| PUT | `/admin/markets/:id/vendors/:restaurantId` | 更新市場攤位 | Admin |
| POST | `/admin/markets/:id/vendor-imports` | 批次匯入攤位 | Admin |
| DELETE | `/admin/markets/:id/vendors/:restaurantId` | 移除市場攤位 | Admin |

### Admin Customers (`/admin/customers`) — 4 routes

平台端顧客目錄（#299 spec §7.2）。這是全站唯一以 `customers.id` 為語彙的 router，租戶端的 `/restaurants/:id/members` 刻意看不到跨租戶資料。

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/admin/customers` | 平台顧客目錄列表 | Admin |
| GET | `/admin/customers/:customerId` | 顧客詳情 | Admin |
| GET | `/admin/customers/:customerId/restaurants` | 顧客的跨租戶消費切面 | Admin |
| POST | `/admin/customers/:customerId/reveal-contact` | 揭露顧客聯絡方式（寫稽核、受限流） | Admin |


### Market Checkouts (`/market-checkouts`) — 18 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/market-checkouts/payment-webhooks/:provider` | 付款供應商 webhook | Public (HMAC) |
| POST | `/market-checkouts/` | 建立市場結帳工作階段 | Public |
| POST | `/market-checkouts/:id/voucher` | 套用優惠券 | Public |
| DELETE | `/market-checkouts/:id/voucher` | 移除優惠券 | Public |
| POST | `/market-checkouts/:id/pay` | 結帳付款 | Public |
| POST | `/market-checkouts/:id/guest-token` | 以手機驗證取回 guest token | Public |
| POST | `/market-checkouts/:id/refund` | 退款（管理端） | Admin |
| GET | `/market-checkouts/admin/summary` | 結帳彙總（管理端） | Admin |
| GET | `/market-checkouts/admin` | 結帳列表（分頁） | Admin |
| GET | `/market-checkouts/admin/export` | 匯出結帳 CSV | Admin |
| GET | `/market-checkouts/admin/vendors` | 攤位結算報表 | Admin |
| GET | `/market-checkouts/admin/vendors/export` | 匯出攤位結算 CSV | Admin |
| GET | `/market-checkouts/admin/accounting/export` | 匯出會計資料 CSV | Admin |
| GET | `/market-checkouts/admin/provider-status` | 付款供應商狀態 | Admin |
| POST | `/market-checkouts/admin/provider-status/check` | 檢查供應商連線 | Admin |
| POST | `/market-checkouts/admin/:id/reconcile` | 與供應商對帳 | Admin |
| GET | `/market-checkouts/admin/:id` | 結帳詳情（管理端） | Admin |
| GET | `/market-checkouts/:id` | 結帳詳情（公開） | Public |

### Service Bookings (`/service-bookings`) — 21 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/service-bookings/availability` | 查詢服務項目可預約時段 | Public |
| POST | `/service-bookings/` | 建立服務預約 | Public |
| POST | `/service-bookings/recurring` | 建立週期性預約 | Public |
| POST | `/service-bookings/waitlist` | 加入預約候補 | Public |
| POST | `/service-bookings/:id/pay` | 以儲值付款 | Public |
| GET | `/service-bookings/verify/:code/ics` | 依確認碼產生行事曆邀請（ICS） | Public |
| GET | `/service-bookings/verify/:code` | 依確認碼查詢預約 | Public |
| POST | `/service-bookings/verify/:code/cancel` | 依確認碼取消預約 | Public |
| GET | `/service-bookings/slots` | 時段列表（員工） | Admin/Owner |
| POST | `/service-bookings/slots` | 建立時段（員工） | Admin/Owner |
| POST | `/service-bookings/slots/batch` | 批次建立時段（員工） | Admin/Owner |
| POST | `/service-bookings/slots/block` | 封鎖時段（員工） | Admin/Owner |
| GET | `/service-bookings/reminders/due` | 待提醒預約列表 | Protected |
| POST | `/service-bookings/:id/reminder-sent` | 標記提醒已送出 | Protected |
| GET | `/service-bookings/:id/ics` | 產生預約 ICS | Protected |
| GET | `/service-bookings/` | 依餐廳列出預約 | Protected |
| GET | `/service-bookings/:id` | 預約詳情 | Protected |
| DELETE | `/service-bookings/:id` | 取消預約 | Admin/Owner/Cashier |
| POST | `/service-bookings/:id/confirm-cash` | 確認現金付款 | Admin/Owner/Cashier |
| POST | `/service-bookings/:id/complete` | 標記預約完成 | Protected |
| POST | `/service-bookings/:id/no-show` | 標記未到 | Admin/Owner/Cashier |

### Feedback (`/feedback`) — 11 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/feedback/` | 建立店家向平台的支援工單 | Owner |
| POST | `/feedback/batch-sync` | 批次同步回饋 | Protected |
| GET | `/feedback/stats` | 工單統計（Owner 僅自己的工單；Admin 為全部） | Admin/Owner |
| GET | `/feedback/` | 工單列表（Owner 僅自己的工單；含篩選） | Admin/Owner |
| GET | `/feedback/:id` | 回饋詳情 | Admin/Owner |
| PUT | `/feedback/:id/status` | 更新回饋狀態 | Admin |
| PATCH | `/feedback/:id` | 更新回饋 | Admin/Owner |
| DELETE | `/feedback/:id` | 刪除回饋 | Admin/Owner |
| POST | `/feedback/:id/responses` | 新增回覆 | Admin/Owner |
| PUT | `/feedback/:id/responses/:responseId` | 更新回覆 | Admin/Owner |
| DELETE | `/feedback/:id/responses/:responseId` | 刪除回覆 | Admin/Owner |

### Alerts (`/alerts`) — 3 routes

店主營運告警（#285）。

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/alerts` | 未結案告警列表 | Admin/Owner |
| POST | `/alerts/:id/resolve` | 結案告警 | Admin/Owner |
| POST | `/alerts/:id/escalate` | 升級告警 | Admin/Owner |

### Reviews (`/reviews`) — 3 routes

顧客評價後台（#286）。顧客端提交在 `/orders/:id/review`，公開列表在 `/restaurants/:id/reviews`。

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/reviews/:restaurantId` | 餐廳評價列表 | Admin/Owner |
| GET | `/reviews/:restaurantId/summary` | 評分分布與待回覆數 | Admin/Owner |
| POST | `/reviews/:restaurantId/:reviewId/reply` | 回覆單則評價 | Admin/Owner |


### Customer (`/customer`) — 19 routes

> 注意：`/customer`（單數，OTP 登入與顧客自助）與 `/customers`（複數，後台顧客查詢）為不同模組。

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/customer/auth/request-otp` | 請求手機 OTP | Public |
| POST | `/customer/auth/verify-otp` | 驗證 OTP 並取得 token | Public |
| POST | `/customer/auth/refresh` | 刷新 access token | Public |
| POST | `/customer/auth/logout` | 登出並撤銷 token | Protected |
| GET | `/customer/me` | 取得顧客資料 | Protected |
| PATCH | `/customer/me` | 更新顧客資料 | Protected |
| DELETE | `/customer/me` | 刪除顧客帳號 | Protected |
| GET | `/customer/preferences` | 取得顧客偏好 | Protected |
| PATCH | `/customer/preferences` | 更新顧客偏好 | Protected |
| GET | `/customer/favorites` | 收藏列表 | Protected |
| POST | `/customer/favorites` | 新增收藏 | Protected |
| DELETE | `/customer/favorites/:id` | 移除收藏 | Protected |
| GET | `/customer/recent-markets` | 最近造訪市場 | Protected |
| POST | `/customer/recent-markets` | 記錄市場造訪 | Protected |
| GET | `/customer/push-subscriptions` | 推播訂閱列表 | Protected |
| POST | `/customer/push-subscriptions` | 註冊推播訂閱 | Protected |
| DELETE | `/customer/push-subscriptions/:id` | 移除推播訂閱 | Protected |
| GET | `/customer/consents` | 取得已授權同意項目 | Protected |
| POST | `/customer/consents` | 記錄同意授權 | Protected |

### Me (`/me`) — 17 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/me/modules` | 取得訂閱模組與方案層級 | Protected |
| GET | `/me/usage` | 取得當期用量 | Protected |
| GET | `/me/me` | 取得顧客檔案與偏好 | Protected |
| PATCH | `/me/me` | 更新顧客檔案 | Protected |
| DELETE | `/me/me` | 刪除顧客帳號 | Protected |
| GET | `/me/preferences` | 取得偏好 | Protected |
| PATCH | `/me/preferences` | 更新偏好 | Protected |
| GET | `/me/favorites` | 收藏列表（市場/餐廳/菜品） | Protected |
| POST | `/me/favorites` | 新增收藏 | Protected |
| DELETE | `/me/favorites/:id` | 移除收藏 | Protected |
| GET | `/me/recent-markets` | 最近造訪市場 | Protected |
| POST | `/me/recent-markets` | 記錄市場造訪 | Protected |
| GET | `/me/push-subscriptions` | 推播訂閱列表 | Protected |
| POST | `/me/push-subscriptions` | 註冊推播訂閱 | Protected |
| DELETE | `/me/push-subscriptions/:id` | 移除推播訂閱 | Protected |
| GET | `/me/consents` | 取得已授權同意項目 | Protected |
| POST | `/me/consents` | 記錄同意授權 | Protected |

### Push (`/push`) — 2 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/push/subscribe` | 訂閱推播通知 | Protected |
| POST | `/push/unsubscribe` | 取消訂閱推播通知 | Protected |

### Manager (`/manager`) — 1 route

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/manager/actions` | 執行具委派授權與稽核軌跡的管理動作 | Admin/Owner |

### Manager Audit Logs (`/audit-logs`) — 1 route

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/audit-logs` | 稽核日誌唯讀查詢（含篩選） | Admin |

### Audit (`/audit`) — 1 route

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/audit/actions` | 同步離線稽核動作至資料庫 | Protected |

### Admin Settings (`/admin`) — 3 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/admin/notification-settings` | 取得使用者通知設定 | Protected |
| PUT | `/admin/notification-settings` | 更新使用者通知設定 | Protected |
| POST | `/admin/settings/sync` | 同步設定（含 TTL 過期） | Protected |

### Subscriptions (`/admin/subscriptions`) — 8 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/admin/subscriptions/:restaurantId/usage` | 取得餐廳當期與週期用量 | Admin |
| GET | `/admin/subscriptions/:restaurantId/usage/events` | 用量事件列表（分頁/篩選） | Admin |
| GET | `/admin/subscriptions` | 訂閱列表（含生效模組） | Admin |
| GET | `/admin/subscriptions/:restaurantId` | 單一訂閱（含生效模組） | Admin |
| POST | `/admin/subscriptions` | 建立訂閱（客戶導入） | Admin |
| PATCH | `/admin/subscriptions/:restaurantId/modules` | 更新模組覆寫（含快取失效） | Admin |
| PATCH | `/admin/subscriptions/:restaurantId/plan` | 變更方案層級 | Admin |
| PATCH | `/admin/subscriptions/:restaurantId/status` | 啟用/停用訂閱（kill switch） | Admin |

### SEO (mounted at `/`) — 2 routes

| Method | Path | Description | Auth |
| ------ | ---- | ----------- | ---- |
| GET | `/sitemap.xml` | 市場 XML sitemap | Public |
| GET | `/robots.txt` | 搜尋引擎 robots.txt | Public |

---

## 回應格式

### 成功回應

```json
{
  "success": true,
  "data": {},
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### 錯誤回應

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

---

## 查詢參數

### 分頁

```
?page=1&per_page=20
```

詳見: `guides/API_PAGINATION_GUIDE.md`

### 過濾

```
?status=active&category=food
```

### 排序

```
?sort=created_at&order=desc
```

---

## 快速開始

### 使用 cURL

```bash
# 登入
curl -X POST http://localhost:8787/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

# 取得菜單（公開）
curl http://localhost:8787/api/v1/menu/RESTAURANT_ID

# 建立訂單（需認證）
curl -X POST http://localhost:8787/api/v1/orders \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"restaurantId":"...","items":[...]}'
```

---

## 相關文檔

- **架構文檔**: `docs/architecture/`
- **功能文檔**: `docs/features/`
- **分頁指南**: `docs/api/guides/API_PAGINATION_GUIDE.md`

---

**最後更新**: 2026-06-09
**API 版本**: v1
**功能模組**: 48
**端點總數**: 400+
