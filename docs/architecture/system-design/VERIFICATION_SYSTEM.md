# Verification System Documentation

**Version**: 1.0
**Last Updated**: 2025-11-23
**Status**: Production Ready ✅

完整的用戶驗證系統，包括密碼重設、Email 驗證和手機驗證功能。

---

## 📋 目錄

1. [功能概述](#功能概述)
2. [系統架構](#系統架構)
3. [設置指南](#設置指南)
4. [API 端點](#api-端點)
5. [前端集成](#前端集成)
6. [測試](#測試)
7. [故障排除](#故障排除)
8. [速率限制](#速率限制)
9. [異常通知](#異常通知)
10. [維護](#維護)

---

## 功能概述

### ✅ 已實現功能

#### 1. 密碼重設 (Password Reset)

- 支援 Email 和 SMS 兩種方式
- UUID v4 token（Email，15 分鐘有效期）
- 6 位數字 OTP（SMS，15 分鐘有效期）
- 一次性使用 token（防止重複使用）
- IP 地址和 User-Agent 追蹤
- 完成後發送成功通知

#### 2. Email 驗證 (Email Verification)

- 24 小時有效期驗證連結
- 自動更新 `emailVerifiedAt` 時間戳
- 支持重新發送驗證郵件
- 驗證成功頁面

#### 3. 手機驗證 (Phone Verification)

- 6 位數字 OTP（5 分鐘有效期）
- 3 次嘗試限制
- 嘗試計數器追蹤
- 自動更新 `phoneVerifiedAt` 時間戳

#### 4. 安全功能

- bcrypt 密碼加密（cost factor 10）
- Token 過期管理
- IP 地址記錄
- 審計日誌（password_change_logs）
- 隱私保護（Email 遮罩顯示）

---

## 系統架構

### 技術棧

```
Frontend: Vue 3 + TypeScript + Tailwind CSS
Backend: Cloudflare Workers + Hono
Database: Cloudflare D1 (SQLite)
Email: Cloudflare Email Service（send_email binding）
SMS: Twilio
ORM: Drizzle ORM
```

### 數據庫結構

#### 表格

**1. password_reset_tokens**

```sql
- id: INTEGER PRIMARY KEY
- user_id: TEXT (關聯 users.id，現行為 UUID v7)
- token: TEXT UNIQUE (UUID v4 或 OTP)
- token_type: TEXT ('email' | 'sms')
- otp_code: TEXT (6 位數字，SMS 專用)
- expires_at: INTEGER (UNIX timestamp)
- used_at: INTEGER (使用時間)
- ip_address: TEXT
- user_agent: TEXT
- created_at: INTEGER
```

**2. email_verification_tokens**

```sql
- id: INTEGER PRIMARY KEY
- user_id: TEXT（現行為 UUID v7，關聯 users.id）
- token: TEXT UNIQUE (UUID v4)
- email: TEXT
- expires_at: INTEGER (24 小時)
- verified_at: INTEGER
- ip_address: TEXT
- created_at: INTEGER
```

**3. phone_verification_tokens**

```sql
- id: INTEGER PRIMARY KEY
- user_id: TEXT（現行為 UUID v7，關聯 users.id）
- phone: TEXT
- otp_code: TEXT (6 位數字)
- expires_at: INTEGER (5 分鐘)
- verified_at: INTEGER
- attempt_count: INTEGER (最多 3 次)
- ip_address: TEXT
- created_at: INTEGER
```

**4. password_change_logs**

```sql
- id: INTEGER PRIMARY KEY
- user_id: TEXT（現行為 UUID v7，關聯 users.id）
- change_method: TEXT ('reset_email' | 'reset_sms' | 'manual' | 'admin_reset')
- ip_address: TEXT
- user_agent: TEXT
- success: INTEGER (0 | 1)
- failure_reason: TEXT
- created_at: INTEGER
```

**5. users (新增欄位)**

```sql
- email_verified_at: INTEGER
- phone_verified_at: INTEGER
```

---

## 設置指南

### 1. 環境變量配置

#### **Cloudflare Email Service (Email)**

Email 走 **Cloudflare Email Service**：`apps/api/wrangler.toml` 在三個環境各宣告一次 `send_email` binding（named environment 不會繼承 binding），不需要任何 API key。

```toml
NOTIFICATION_FROM_EMAIL = "notifications@makanmasak.com"

[[env.production.send_email]]
name = "NOTIFICATION_EMAIL"
```

寄件網域 `makanmasak.com` 已在 Cloudflare Email Sending 完成 onboarding（DKIM selector `cf-bounce`，return-path `cf-bounce.makanmasak.com`），SPF／DKIM 由 Cloudflare 管理，不需手動加 DNS 記錄。沒有 binding 時 email 功能關閉，production 的註冊與忘記密碼會直接回 `503 EMAIL_CHANNEL_UNAVAILABLE`，不會假裝寄出。

#### **Twilio (SMS)**

```bash
# 設置 Twilio 憑證
cd apps/api
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
```

**wrangler.toml**:

```toml
TWILIO_PHONE_NUMBER = "+1234567890"  # 你的 Twilio 號碼
```

#### **應用程序 URL**

```toml
API_BASE_URL = "https://yourdomain.com/api"
```

### 2. 數據庫遷移

```bash
# 生產環境
npx wrangler d1 migrations apply makanmakan-prod --env production
```

### 3. 驗證設置

發送測試郵件和 SMS：

```bash
# 使用 API 測試端點
curl -X POST https://yourdomain.com/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "your-email@example.com",
    "method": "email"
  }'
```

---

## API 端點

### 基礎 URL

```
Production: https://yourdomain.com/api/v1/auth
Local: http://localhost:8787/api/v1/auth
```

### 1. 請求密碼重設

**POST /forgot-password**

發送密碼重設連結（Email）或 OTP（SMS）。

**Request Body**:

```json
{
  "identifier": "user@example.com", // Email, 手機號碼或用戶名
  "method": "email" // 'email' | 'sms'
}
```

**Response** (200 OK):

```json
{
  "success": true,
  "message": "重設連結已發送至您的 Email"
}
```

**Error** (400 Bad Request):

```json
{
  "success": false,
  "error": "找不到用戶",
  "message": "發送重設連結失敗"
}
```

---

### 2. 驗證重設 Token

**GET /reset-password/verify?token={uuid}**

驗證密碼重設 token 是否有效。

**Query Parameters**:

- `token` (required): UUID v4 token

**Response** (200 OK):

```json
{
  "valid": true,
  "userId": 1,
  "email": "us***@example.com" // 遮罩顯示
}
```

**Invalid Token**:

```json
{
  "valid": false,
  "error": "Token 已過期"
}
```

---

### 3. 重設密碼

**POST /reset-password**

使用 token 重設密碼。

**Request Body**:

```json
{
  "token": "12345678-1234-1234-1234-123456789abc",
  "newPassword": "NewSecurePass@123",
  "confirmPassword": "NewSecurePass@123"
}
```

**Validation**:

- 密碼長度 ≥ 6 字符
- `newPassword` === `confirmPassword`
- Token 未過期且未使用

**Response** (200 OK):

```json
{
  "success": true,
  "message": "密碼已成功重設"
}
```

---

### 4. 發送 Email 驗證

**POST /verify-email/send**

發送 Email 驗證連結。

**Headers**:

```
Authorization: Bearer {jwt_token}
```

**Request Body**:

```json
{
  "userId": 1,
  "email": "user@example.com"
}
```

**Response** (200 OK):

```json
{
  "success": true,
  "message": "驗證郵件已發送至 us***@example.com"
}
```

---

### 5. 驗證 Email

**GET /verify-email?token={uuid}**

驗證 Email 地址。

**Query Parameters**:

- `token` (required): Email 驗證 token

**Response** (200 OK):

```json
{
  "success": true,
  "message": "Email 驗證成功！您現在可以使用完整功能。"
}
```

---

### 6. 發送手機驗證 OTP

**POST /verify-phone/send**

發送 6 位數字 OTP 到手機。

**Headers**:

```
Authorization: Bearer {jwt_token}
```

**Request Body**:

```json
{
  "userId": 1,
  "phone": "+60123456789"
}
```

**Response** (200 OK):

```json
{
  "success": true,
  "message": "驗證碼已發送至 +6012***6789"
}
```

---

### 7. 驗證手機 OTP

**POST /verify-phone**

驗證手機 OTP。

**Headers**:

```
Authorization: Bearer {jwt_token}
```

**Request Body**:

```json
{
  "userId": 1,
  "phone": "+60123456789",
  "otpCode": "123456"
}
```

**Response** (200 OK):

```json
{
  "success": true,
  "message": "手機驗證成功！"
}
```

**Error** (400 Bad Request):

```json
{
  "success": false,
  "error": "驗證碼錯誤，剩餘嘗試次數：2"
}
```

**Locked** (400 Bad Request):

```json
{
  "success": false,
  "error": "驗證次數已達上限，請重新發送驗證碼"
}
```

---

## 前端集成

### Customer App

#### 路由

```typescript
// apps/customer-app/src/router/index.ts

{
  path: "/forgot-password",
  name: "ForgotPassword",
  component: () => import("@/views/ForgotPasswordView.vue"),
  meta: { title: "忘記密碼", requiresGuest: true },
},
{
  path: "/reset-password",
  name: "ResetPassword",
  component: () => import("@/views/ResetPasswordView.vue"),
  meta: { title: "重設密碼" },
},
{
  path: "/verify-email",
  name: "VerifyEmail",
  component: () => import("@/views/VerifyEmailView.vue"),
  meta: { title: "Email 驗證" },
},
```

#### 組件

**1. ForgotPasswordView.vue** (244 lines)

- Email 輸入表單
- 成功/錯誤狀態顯示
- 表單驗證
- 返回登入連結

**2. ResetPasswordView.vue** (586 lines)

- Token 自動驗證
- 新密碼 + 確認密碼輸入
- 密碼可見性切換
- **密碼強度指標**（5 級）:
  - 弱（紅色）
  - 中等（橙色）
  - 良好（黃色）
  - 強（藍色）
  - 非常強（綠色）
- 密碼要求清單（checkmark/X 圖示）

**3. VerifyEmailView.vue** (253 lines)

- 自動驗證 Email
- 成功頁面與好處列表
- 錯誤處理
- 重新發送選項

### Admin Dashboard

#### 路由

```typescript
// apps/admin-dashboard/src/router/index.ts

{
  path: "/forgot-password",
  name: "ForgotPassword",
  component: () => import("@/views/ForgotPasswordView.vue"),
  meta: { requiresAuth: false, title: "忘記密碼" },
},
{
  path: "/reset-password",
  name: "ResetPassword",
  component: () => import("@/views/ResetPasswordView.vue"),
  meta: { requiresAuth: false, title: "重設密碼" },
},
```

#### 組件

**1. ForgotPasswordView.vue** (245 lines)

- 管理後台樣式（bg-primary-600）
- Email 輸入
- 成功確認頁面

**2. ResetPasswordView.vue** (589 lines)

- 管理後台樣式
- 密碼強度指標
- Token 驗證
- 自動跳轉到登入頁

---

## 測試

### 單元測試

**VerificationService.test.ts** (553 lines, 16 tests)

```bash
cd packages/database
pnpm test VerificationService.test.ts
```

**測試覆蓋**:

- ✅ requestPasswordReset (3 tests)
- ✅ verifyResetToken (3 tests)
- ✅ resetPassword (2 tests)
- ✅ sendEmailVerification (1 test)
- ✅ verifyEmail (2 tests)
- ✅ verifyPhone (3 tests)
- ✅ cleanupExpiredTokens (1 test)

### 集成測試

**verification.test.ts** (23 tests)

```bash
cd apps/api
pnpm test verification.test.ts
```

**測試端點**:

- ✅ POST /auth/forgot-password (3 tests)
- ✅ GET /auth/reset-password/verify (3 tests)
- ✅ POST /auth/reset-password (3 tests)
- ✅ POST /auth/verify-email/send (1 test)
- ✅ GET /auth/verify-email (1 test)
- ✅ POST /auth/verify-phone/send (1 test)
- ✅ POST /auth/verify-phone (2 tests)

### E2E 測試

**forgot-password.spec.ts** (294 lines, 18 tests)

```bash
cd apps/customer-app
pnpm test:e2e forgot-password.spec.ts
```

**測試流程**:

1. **Forgot Password Flow** (8 tests)
   - ✅ 顯示忘記密碼連結
   - ✅ 導航到忘記密碼頁面
   - ✅ 空 Email 驗證錯誤
   - ✅ 無效 Email 格式驗證
   - ✅ 成功提交請求
   - ✅ 不存在的 Email 錯誤
   - ✅ 返回登入連結
   - ✅ 速率限制處理

2. **Reset Password Flow** (7 tests)
   - ✅ Token 驗證加載狀態
   - ✅ 缺少 token 錯誤
   - ✅ 無效 token 錯誤
   - ✅ 密碼強度指標
   - ✅ 密碼要求清單
   - ✅ 密碼可見性切換
   - ✅ 密碼確認匹配驗證

3. **Email Verification Flow** (3 tests)
   - ✅ 有效 token 驗證
   - ✅ 缺少 token 錯誤
   - ✅ 錯誤時顯示重新發送選項

**執行測試**:

```bash
# 執行所有 E2E 測試
pnpm test:e2e

# 執行特定測試
pnpm test:e2e forgot-password.spec.ts

# 使用 UI 模式
pnpm test:e2e --ui

# 使用 headed 模式（查看瀏覽器）
pnpm test:e2e --headed
```

### 手動測試

#### 1. 測試密碼重設（Email）

```bash
# 1. 請求重設
curl -X POST http://localhost:8787/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"identifier": "test@example.com", "method": "email"}'

# 2. 檢查郵件收件箱，獲取 token

# 3. 驗證 token
curl "http://localhost:8787/api/v1/auth/reset-password/verify?token=YOUR_TOKEN"

# 4. 重設密碼
curl -X POST http://localhost:8787/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "newPassword": "NewPass@123",
    "confirmPassword": "NewPass@123"
  }'
```

---

## 故障排除

### 常見問題

#### 1. 郵件未送達

**問題**: 用戶沒有收到密碼重設郵件

**解決方案**:

```bash
# 1. 確認部署版本帶有 email binding（輸出應有 env.NOTIFICATION_EMAIL (Send Email)）
wrangler versions view <version-id> --env production

# 2. 看寄送錯誤
wrangler tail makanmasak-api-prod

# 3. 檢查垃圾郵件資料夾

# 4. 直接用 Email Sending 寄一封測試信
wrangler email sending send --from notifications@makanmasak.com \
  --to you@example.com --subject "Test" --text "Test"
```

#### 2. Token 已過期

**問題**: Token expired error

**解決方案**:

- 密碼重設 token 有效期：15 分鐘
- Email 驗證 token 有效期：24 小時
- 手機 OTP 有效期：5 分鐘
- 請用戶重新請求新的 token

#### 3. SMS 未發送

**問題**: Twilio SMS 發送失敗

**解決方案**:

```bash
# 1. 驗證 Twilio 憑證
wrangler secret list --env production

# 2. 檢查 Twilio 帳戶餘額
# 訪問 https://console.twilio.com

# 3. 驗證手機號碼格式
# 必須包含國家代碼: +60123456789 (不是 0123456789)

# 4. 檢查錯誤日誌
wrangler tail makanmakan-api --env production
```

#### 4. 驗證次數超限

**問題**: OTP 驗證失敗 3 次後鎖定

**解決方案**:

```sql
-- 手動重置嘗試計數（僅用於開發/調試）
UPDATE phone_verification_tokens
SET attempt_count = 0
WHERE user_id = '<uuid>' AND phone = '+60123456789';
```

或者讓用戶重新發送新的 OTP。

---

## 安全考慮

### 最佳實踐

1. **Token 安全**
   - ✅ 使用 UUID v4（隨機性高）
   - ✅ 短有效期（15 分鐘 / 24 小時 / 5 分鐘）
   - ✅ 一次性使用（usedAt tracking）
   - ✅ 記錄 IP 和 User-Agent

2. **密碼安全**
   - ✅ bcrypt 加密（cost factor 10）
   - ✅ 最少 6 字符（客戶）
   - ✅ 強密碼要求（員工）
   - ✅ 密碼確認匹配驗證

3. **速率限制**
   - ✅ 密碼重設: 每 IP 每小時最多 5 次請求
   - ✅ Email 驗證: 每 IP 每 10 分鐘最多 3 次請求
   - ✅ SMS OTP: 每 IP 每小時最多 3 次請求
   - ✅ 基於 Cloudflare KV 的分布式速率限制
   - ✅ 自動清理（TTL expiration）

4. **日誌和監控**
   - ✅ 密碼更改日誌
   - ✅ IP 地址追蹤
   - ✅ 失敗原因記錄
   - ✅ Slack webhook 異常通知
   - ✅ Email 安全警報
   - ✅ 多級別警報（info/warning/error）

---

## 維護

### 自動化清理 (Cron Jobs)

系統已配置 Cloudflare Workers Cron Triggers 自動清理過期數據：

**配置文件**: `apps/api/wrangler.toml`

```toml
[triggers]
crons = [
  "0 2 * * *",   # 每天凌晨 2:00 UTC - 清理過期 token
  "0 3 * * 0"    # 每週日凌晨 3:00 UTC - 清理舊日誌
]
```

**實現代碼**: `apps/api/src/scheduled/cleanup-tokens.ts`

```typescript
export async function cleanupExpiredTokens(env: CloudflareEnv) {
  const verificationService = new VerificationService(env.DB, env);
  await verificationService.cleanupExpiredTokens();

  // 獲取清理統計
  const stats = await getCleanupStats(env.DB);

  // 發送通知
  const alertService = new AlertService(env);
  await alertService.sendAlert({
    title: "Token Cleanup Completed",
    severity: "info",
    metadata: {
      "Password Reset Tokens": stats.passwordReset,
      "Email Verification Tokens": stats.emailVerification,
      "Phone Verification Tokens": stats.phoneVerification,
    },
  });
}
```

**清理範圍**:

- ✅ 過期的密碼重設 token（15 分鐘後）
- ✅ 過期的 Email 驗證 token（24 小時後）
- ✅ 過期的手機驗證 token（5 分鐘後）
- ✅ 30 天前的密碼更改日誌

### 監控指標

建議追蹤以下指標：

1. **密碼重設**
   - 每日請求數量
   - 成功率
   - 平均完成時間

2. **Email 驗證**
   - 發送成功率
   - 驗證完成率
   - 平均驗證時間

3. **SMS OTP**
   - 發送成功率
   - 驗證成功率
   - 平均嘗試次數

---

## 速率限制

系統實施了基於 Cloudflare KV 的分布式速率限制，防止濫用和攻擊。

### 配置

**文件**: `apps/api/src/middleware/rateLimiter.ts`

### 預設配置

| 端點       | 窗口時間 | 最大請求數 | 鍵前綴         |
| ---------- | -------- | ---------- | -------------- |
| 密碼重設   | 1 小時   | 5          | `pwd_reset`    |
| Email 驗證 | 10 分鐘  | 3          | `email_verify` |
| SMS OTP    | 1 小時   | 3          | `sms_otp`      |

### 使用方式

```typescript
import {
  rateLimitMiddleware,
  RateLimitPresets,
} from "../middleware/rateLimiter";

// 應用到路由
app.post(
  "/auth/forgot-password",
  rateLimitMiddleware(RateLimitPresets.passwordReset),
  async (c) => {
    /* handler */
  },
);
```

### 響應格式

**成功時** (Status 200):

```json
{
  "success": true,
  "data": {
    /* response data */
  }
}
```

**速率限制超出時** (Status 429):

```json
{
  "success": false,
  "error": "密碼重設請求過於頻繁，請 1 小時後再試",
  "limit": 5,
  "remaining": 0,
  "resetTime": 1700000000000,
  "retryAfter": 3600
}
```

### Headers

- `X-RateLimit-Limit`: 最大請求數
- `X-RateLimit-Remaining`: 剩餘請求數
- `X-RateLimit-Reset`: 重置時間（UNIX timestamp）
- `Retry-After`: 重試等待秒數（僅在超出時）

---

## 異常通知

系統實施了多通道警報系統，支持 Slack 和 Email 通知。

### 配置

**環境變量**:

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
ALERT_EMAIL=security@makanmakan.com
```

**文件**: `apps/api/src/services/AlertService.ts`

### 警報級別

- **info**: 一般信息（藍色）
- **warning**: 警告事件（橙色）
- **error**: 嚴重錯誤（紅色）

### 使用方式

```typescript
import { AlertService } from "../services/AlertService";

const alertService = new AlertService(env);

// 速率限制超出
await alertService.rateLimitExceeded(ipAddress, "/auth/forgot-password", 5);

// 密碼重設失敗
await alertService.passwordResetAttempt(email, ipAddress, false);

// 系統錯誤
await alertService.systemError(error, "Token Cleanup");

// 自定義警報
await alertService.sendAlert({
  title: "Custom Alert",
  message: "Something happened",
  severity: "warning",
  metadata: { key: "value" },
});
```

### Slack 通知格式

```
🟠 [WARNING] Failed Password Reset Attempt
────────────────────────
Failed password reset attempt for test@example.com

Email: test@example.com
IP: 192.168.1.1
Status: Failed - User not found
────────────────────────
MakanMakan Security System
```

### Email 通知格式

純文本 Email，包含警報標題、訊息和元數據。

---

## 更新日誌

### v1.1.0 (2025-11-23) - 生產增強版

**安全增強**:

- ✅ 分布式速率限制（基於 Cloudflare KV）
  - 密碼重設: 5 requests/hour per IP
  - Email 驗證: 3 requests/10min per IP
  - SMS OTP: 3 requests/hour per IP
- ✅ 多通道異常通知系統
  - Slack webhook 集成
  - Email 警報通知
  - 三級警報（info/warning/error）
- ✅ 自動化維護系統
  - 每日 token 清理 (2 AM UTC)
  - 每週日誌清理 (3 AM UTC Sunday)
  - Cloudflare Workers Cron Triggers

**測試覆蓋**:

- ✅ E2E 測試（18 tests, 294 lines）
  - Forgot Password Flow (8 tests)
  - Reset Password Flow (7 tests)
  - Email Verification Flow (3 tests)

**文件更新**:

- ✅ 速率限制文檔
- ✅ 異常通知設置指南
- ✅ Cron Jobs 配置說明
- ✅ E2E 測試指南

**新增文件**:

- `apps/api/src/middleware/rateLimiter.ts` (262 lines)
- `apps/api/src/services/AlertService.ts` (292 lines)
- `apps/api/src/scheduled/cleanup-tokens.ts` (120 lines)
- `apps/customer-app/tests/e2e/forgot-password.spec.ts` (294 lines)

### v1.0.0 (2025-11-23)

- ✅ 初始發布
- ✅ 密碼重設（Email/SMS）
- ✅ Email 驗證
- ✅ 手機驗證
- ✅ MailChannels 集成（已於 2026-09 移除，現為 Cloudflare Email Service）
- ✅ Customer App 前端
- ✅ Admin Dashboard 前端
- ✅ 單元測試（16 tests）
- ✅ 集成測試（23 tests）

---

## 支援

如有問題或需要協助，請聯絡：

- 技術支援: tech@makanmakan.com
- 文檔: https://github.com/yourusername/makanmakan/docs

---

**Built with ❤️ by MakanMakan Team**
