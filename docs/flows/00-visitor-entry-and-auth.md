# 訪客進入與身分驗證

> **對應 master board**：訪客／未登入泳道
> **主要角色**：訪客、role 0–5 全部
> **最後對照原始碼**：2026-08-21

## 1. 定位

所有人進系統的第一段路。它分成兩件不同的事，常被混為一談：

- **員工認證**（`/api/v1/auth/*`）——`users` 表、username + bcrypt 密碼、role 0–4，發的是 staff JWT。
- **顧客認證**（`/api/v1/customer/auth/*`）——`customers` 表、手機 OTP 為主，發的是 customer JWT。

兩套 token 由不同 middleware 驗證，**不可互換**。另外還有第三條完全不進這裡的路：掃桌位／座位／店家 QR 的
**訪客點餐**，用 KV guest token，見 [01-customer-ordering.md](./01-customer-ordering.md)。

## 2. 觸發與前置條件

| 項目 | 內容 |
| --- | --- |
| 進入點 | 顧客端 `:3000`／店家後台 `:3001`／廚房 `:3002`／管理總控台 `:3010`／入駐 `:3011` |
| 角色 | 無（本流程就是在決定角色） |
| 資料前提 | 員工帳號由店主或平台建立（`POST /api/v1/auth/register-staff`、入駐核准時自動建立店主帳號） |
| 環境前提 | `JWT_SECRET` 至少 32 字元，否則所有受保護端點回 500 `SERVER_CONFIG_ERROR` |

## 3. Happy path

### 3.1 員工登入

| # | 動作 | 端點／程式 | 狀態變化 |
| --- | --- | --- | --- |
| 1 | 送出帳密 | `POST /api/v1/auth/login` | — |
| 2 | 失敗次數檢查（先於驗密碼） | `AuthService.checkRateLimit` | 超限直接 401 |
| 3 | bcrypt 比對 | `packages/database/src/services/auth.ts` | — |
| 4 | 簽發 access token（**1 小時**）與 refresh token（**7 天**） | 同上，`ACCESS_TOKEN_TTL_HOURS = 1` | 寫入 `sessions` |
| 5 | refresh token 寫入 HttpOnly cookie | `setStaffRefreshCookie` | — |
| 6 | 前端依 `role` 導向預設頁 | `authStore.getDefaultRoute()` | — |

### 3.2 顧客登入（OTP）

| # | 動作 | 端點 | 狀態變化 |
| --- | --- | --- | --- |
| 1 | 輸入手機 | `POST /api/v1/customer/auth/request-otp` | 產生驗證碼 |
| 2 | 簡訊送出 | `createSmsProvider(c.env)`（mitake／every8d／twilio／noop） | — |
| 3 | 輸入驗證碼 | `POST /api/v1/customer/auth/verify-otp` | 建立或取回 `customers` 身分 |
| 4 | 取得 customer token | 同上 | — |
| 5 | 後續換發 | `POST /api/v1/customer/auth/refresh` | — |

### 3.3 每一次受保護請求

`authenticateStaffToken`（`apps/api/src/middleware/auth.ts:198`）是 staff token 的**唯一**驗證入口，依序檢查：

1. `JWT_SECRET` 長度 → 500
2. `TOKEN_BLACKLIST` KV 內是否已撤銷 → 401 `TOKEN_BLACKLISTED`
3. 簽章與 claim 形狀 → 401 `TOKEN_INVALID`
4. `exp` / `iat`（未來簽發）／`nbf` → 401 `TOKEN_EXPIRED` ／ `TOKEN_FUTURE`
5. `role` 是否超過該路由允許上限 → 401
6. token 年齡上限 `MAX_ACCESS_TOKEN_AGE_SECONDS`（72 小時）→ 401 `TOKEN_EXPIRED`。access token 的 `exp` 只有 1 小時，所以這條實際上只攔得到簽發參數被改長的 token，是一道保險而非主要防線
7. 打 DB：`isActive`、`tokenVersion`、`username`／`role` 是否漂移 → 401 `USER_INACTIVE` ／ `TOKEN_INVALIDATED`

> `optionalAuth` 走的是同一個函式。它以前只驗簽章、把時間 claim defer 掉又沒補驗，導致過期或已撤銷的 staff token
> 仍能在公開路由上拿到特權身分——共用這個函式就是為了不讓兩條路徑再次漂移。改動時不要把它拆開。

## 4. 主要分支

| 分支 | 差別 |
| --- | --- |
| 訪客直接點餐 | 完全不經過本流程，走 `POST /api/v1/guest-orders` + KV guest token |
| 顧客改用密碼登入 | `POST /api/v1/customer/auth/login`（`customer_auth_identities` 內 provider 為密碼的身分）；身分合併規則見 [specs/customer-authentication.md](../specs/customer-authentication.md) §4 |
| 忘記密碼 | `POST /api/v1/auth/forgot-password` → `GET /api/v1/auth/reset-password/verify` → `POST /api/v1/auth/reset-password` |
| 廚房 SSE | EventSource 不能帶 Authorization header，改用 `POST /api/v1/kitchen/:restaurantId/events/token` 換一個**只能用於該串流**的短效 token（`aud: "kitchen_sse"`） |
| Admin 無店家 context | role 0 登入後若未選店，前端導向平台總覽而非店務頁（`adminRestaurantOptionalRoutes`） |

## 5. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 同一 username 連續失敗 5 次 | 鎖住，401 | `ACCOUNT_LOCKED` | 🟠 P1 |
| 同一 IP 連續失敗 10 次 | 鎖住，401（另有 username+IP 複合 key 10 次） | `ACCOUNT_LOCKED` | 🟠 P1 |
| 顧客用舊的密碼註冊端點 | 410 Gone，明講已退役 | `CUSTOMER_PASSWORD_REGISTRATION_RETIRED` | ⚪ P3 |
| 顧客用密碼登入 staff 端點 | 401，錯誤碼與帳密錯誤**分開** | `CUSTOMER_PASSWORD_LOGIN_RETIRED` | 🟡 P2 |
| production 未設定簡訊供應商 | `request-otp` 直接 503，不假裝送出 | `SMS_CHANNEL_UNAVAILABLE` | 🔴 P0 |
| 簡訊供應商回失敗 | 503 | `SMS_SEND_FAILED` | 🟠 P1 |
| 帳號被停用後舊 token 還在有效期 | 每次請求都會打 DB 檢查 `isActive`，立即失效 | `USER_INACTIVE` | 🔴 P0 |
| 強制登出所有裝置 | `tokenVersion` +1，所有既有 token 一次作廢 | `TOKEN_INVALIDATED` | — |
| 登出後舊 token 重放 | KV 黑名單擋下 | `TOKEN_BLACKLISTED` | 🔴 P0 |
| `TOKEN_BLACKLIST` KV 不可用 | **跳過黑名單檢查**，其餘檢查照跑 | — | 🟠 P1 |
| access token 快過期（前端） | 路由守衛用 `isTokenExpired(token, 30)`：剩餘不到 30 秒就先嘗試 refresh，失敗才導回登入 | — | 🟡 P2 |
| 角色沒有該頁權限 | 前端導到 `/unauthorized`；後端仍會各自擋一次 | 403 | 🟠 P1 |

## 6. 併發與競態

- **refresh 併發**：多個分頁同時過期會各自打 `POST /auth/refresh`。目前沒有跨分頁互斥；重複換發不會壞，但會多寫 `sessions`。
- **鎖定計數器**：失敗計數走 KV，讀改寫非原子，極端併發下實際次數可能略高於門檻。刻意接受——這是節流不是安全邊界。
- **CSRF**：多分頁開著時，後開分頁的寫入操作可能因 CSRF token 已被前一分頁換掉而回 403。重整即可，**不要把它當成 token 失效**去觸發登出。

## 7. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/authentication/routes/index.ts` — staff 登入／註冊／改密碼／session 管理
- `apps/api/src/features/authentication/services/AuthService.ts` — 登入節流、失敗原因分類
- `apps/api/src/features/customer/routes/index.ts` — 顧客 OTP／註冊／OAuth／me
- `apps/api/src/features/verification/routes/index.ts` — email／手機驗證、重設密碼驗證
- `apps/api/src/middleware/auth.ts` — `authenticateStaffToken`、`optionalAuth`、黑名單
- `packages/database/src/services/auth.ts` — bcrypt、token 簽發、TTL 常數
- `apps/admin-dashboard/src/router/index.ts:536` — 前端守衛

**測試**

- `apps/api/src/features/authentication/routes/index.test.ts`
- `apps/api/src/features/authentication/services/AuthService.test.ts`
- `packages/database/src/services/auth.test.ts`

**手動探索 QA（production）**

- [顧客端流程 QA 2026-09-15](../investigations/2026-09-15-customer-app-flow-qa.html) — C4、C14（會員入口）
- [顧客端上線 readiness QA 2026-09-18](../investigations/2026-09-18-customer-app-readiness-qa.html) — 會員入口重測

## 8. 已知缺口

- **顧客與員工兩套身分沒有互通**。同一個人既是店員又是顧客時，是兩筆資料、兩組 token，沒有任何關聯欄位。
- **登入節流計數器不是原子的**（見 §6），只擋腳本、擋不住分散式嘗試。
- **`TOKEN_BLACKLIST` 不可用時是 fail-open**。可用性優先於強制撤銷，這是刻意選擇，但沒有告警。
- **顧客社群登入尚未實作**。`customer_auth_identities` 已有 `provider` / `provider_uid` 欄位，但 API 沒有任何 OAuth 端點；計畫見 [plans/2026-08-15-customer-social-login.md](../plans/2026-08-15-customer-social-login.md)。
- **production 的顧客會員線整條不可達**（#384）。production 沒有任何 email／簡訊供應商憑證，註冊實測回 503 `EMAIL_CHANNEL_UNAVAILABLE`，`customers` 表 0 筆（09-15、09-18 兩輪 QA 皆重測成立）。程式碼的 fail-closed 行為是對的，缺的是部署設定。
