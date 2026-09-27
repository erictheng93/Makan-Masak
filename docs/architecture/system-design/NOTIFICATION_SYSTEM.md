# Notification System Documentation

## 概覽 (Overview)

MakanMakan 通知系統提供自動化的員工通知功能，支持電子郵件和 SMS 兩種通道。系統已完全整合到請假管理和排班管理功能中，自動在關鍵事件發生時發送通知。

The MakanMakan Notification System provides automated employee notifications via email and SMS channels. It's fully integrated into leave management and scheduling features, automatically sending notifications when key events occur.

## 系統架構 (System Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                    通知系統架構                              │
│                  Notification System                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐        ┌────────────────┐               │
│  │ LeaveService │───────→│ Notification   │               │
│  │   (4 methods)│        │    Service     │               │
│  └──────────────┘        │                │               │
│                          │  - 郵件模板     │               │
│  ┌──────────────┐        │  - SMS 模板    │               │
│  │ Scheduling   │───────→│  - 渲染引擎     │               │
│  │   Service    │        │  - 發送邏輯     │               │
│  │  (6 methods) │        └────────┬───────┘               │
│  └──────────────┘                 │                       │
│                                   │                       │
│         ┌────────────────────────┴──────────────┐         │
│         │                                        │         │
│    ┌────▼────┐                            ┌─────▼────┐    │
│    │Cloudflare                            │  Twilio  │    │
│    │  Email  │                            │   SMS    │    │
│    │ Service │                            │ Provider │    │
│    └─────────┘                            └──────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 功能特性 (Features)

### ✅ 已實現功能 (Implemented Features)

1. **通知服務核心 (Core Service)**
   - NotificationService（現行 1081 行，2026-07-05 核實；已隨候位、預約服務、驗證等通知類別擴充）
   - Email：Cloudflare Email Service（`send_email` binding）；SMS：三竹、Every8d、Twilio（`SMS_PROVIDER`）
   - 模板渲染引擎
   - 錯誤處理機制

2. **請假管理整合 (Leave Management Integration)**
   - 請假申請提交通知
   - 請假批准通知
   - 請假拒絕通知
   - 請假取消通知

3. **排班管理整合 (Scheduling Integration)**
   - 排班創建通知
   - 排班更新通知
   - 排班取消通知
   - 換班請求通知
   - 換班批准通知
   - 換班拒絕通知

4. **API 端點 (API Endpoints)**
   - POST `/api/v1/notifications/test` - 測試通知
   - GET `/api/v1/notifications/templates` - 獲取模板列表
   - POST `/api/v1/notifications/send` - 手動發送通知

## 通知類別 (Notification Categories)

### 請假管理通知 (Leave Management)

| 類別                      | 觸發時機         | 優先級 | 通道  |
| ------------------------- | ---------------- | ------ | ----- |
| `leave_request_submitted` | 員工提交請假申請 | Normal | Email |
| `leave_request_approved`  | 主管批准請假     | High   | Email |
| `leave_request_rejected`  | 主管拒絕請假     | High   | Email |
| `leave_request_cancelled` | 員工取消請假     | Normal | Email |

### 排班管理通知 (Scheduling)

| 類別                    | 觸發時機     | 優先級      | 通道       |
| ----------------------- | ------------ | ----------- | ---------- |
| `schedule_created`      | 創建新排班   | Normal      | Email, SMS |
| `schedule_updated`      | 更新現有排班 | High        | Email, SMS |
| `schedule_cancelled`    | 取消排班     | High        | Email, SMS |
| `swap_request_created`  | 創建換班請求 | Normal/High | Email      |
| `swap_request_approved` | 主管批准換班 | High        | Email      |
| `swap_request_rejected` | 主管拒絕換班 | High        | Email      |

### 提醒通知 (Reminders)

| 類別             | 觸發時機       | 優先級 | 通道       |
| ---------------- | -------------- | ------ | ---------- |
| `shift_reminder` | 班次開始前提醒 | Normal | Email, SMS |

## 配置設定 (Configuration)

### 環境變量 (Environment Variables)

### Email：Cloudflare Email Service

Email 走 **Cloudflare Email Service**：`apps/api/wrangler.toml` 在三個環境各宣告一次 `send_email` binding（named environment 不會繼承 binding），不需要任何 API key。

```toml
NOTIFICATION_FROM_EMAIL = "notifications@makanmasak.com"

[[env.production.send_email]]
name = "NOTIFICATION_EMAIL"
```

寄件網域 `makanmasak.com` 已在 Cloudflare Email Sending 完成 onboarding（DKIM selector `cf-bounce`，return-path `cf-bounce.makanmasak.com`），SPF／DKIM 由 Cloudflare 管理，不需手動加 DNS 記錄。沒有 binding 時 email 功能關閉，production 的註冊與忘記密碼會直接回 `503 EMAIL_CHANNEL_UNAVAILABLE`，不會假裝寄出。

### SMS

```bash
# SMS Provider (Twilio)
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxx"  # 使用 wrangler secret 設置
TWILIO_AUTH_TOKEN="xxxxxxxxxxxxx"    # 使用 wrangler secret 設置
TWILIO_PHONE_NUMBER="+1234567890"
```

**使用 Wrangler CLI 設置密鑰：**

```bash
wrangler secret put TWILIO_ACCOUNT_SID --env production
wrangler secret put TWILIO_AUTH_TOKEN --env production
```

### 獲取 API 密鑰 (Getting API Keys)

#### Twilio (SMS)

1. 註冊賬號：https://www.twilio.com/
2. 進入 Console Dashboard
3. 獲取 Account SID 和 Auth Token
4. 購買電話號碼或使用測試憑證

## API 使用指南 (API Usage)

### 1. 測試通知發送 (Test Notification)

測試通知系統配置是否正確。

**請求 (Request):**

```bash
POST /api/v1/notifications/test
Authorization: Bearer <token>
Content-Type: application/json

{
  "recipientEmail": "employee@example.com",
  "category": "leave_request_submitted",
  "type": "email"
}
```

**響應 (Response):**

```json
{
  "success": true,
  "data": {
    "message": "Test notification sent successfully",
    "details": {
      "success": true,
      "notificationId": "notif_abc123",
      "provider": "cloudflare"
    }
  }
}
```

### 2. 獲取通知模板列表 (Get Templates)

查看所有可用的通知模板及其所需變量。

**請求 (Request):**

```bash
GET /api/v1/notifications/templates
Authorization: Bearer <token>
```

**響應 (Response):**

```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "category": "leave_request_submitted",
        "name": "Leave Request Submitted",
        "description": "Sent when an employee submits a leave request",
        "availableChannels": ["email"],
        "requiredVariables": [
          "employeeName",
          "leaveType",
          "startDate",
          "endDate",
          "totalDays"
        ]
      }
      // ... 更多模板
    ],
    "totalCount": 28,
    "supportedChannels": ["email", "sms"],
    "configuredProviders": {
      "email": true,
      "sms": true
    }
  }
}
```

### 3. 手動發送通知 (Send Notification)

手動觸發通知發送（用於測試或特殊情況）。

**請求 (Request):**

```bash
POST /api/v1/notifications/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "recipientId": 123,
  "recipientEmail": "employee@example.com",
  "category": "schedule_created",
  "type": "email",
  "data": {
    "employeeName": "張三",
    "shiftName": "早班",
    "scheduleDate": "2025-11-05",
    "startTime": "09:00",
    "endTime": "17:00",
    "scheduledHours": "8",
    "notes": "請準時到班"
  },
  "priority": "normal"
}
```

**響應 (Response):**

```json
{
  "success": true,
  "data": {
    "message": "Notification sent successfully",
    "notificationId": "notif_xyz789",
    "channel": "email",
    "category": "schedule_created"
  }
}
```

## 模板變量參考 (Template Variables)

### 請假通知變量 (Leave Notifications)

#### leave_request_submitted

- `employeeName` - 員工姓名
- `leaveType` - 請假類型
- `startDate` - 開始日期
- `endDate` - 結束日期
- `totalDays` - 總天數

#### leave_request_approved

- `employeeName` - 員工姓名
- `leaveType` - 請假類型
- `startDate` - 開始日期
- `endDate` - 結束日期
- `totalDays` - 總天數
- `approverName` - 批准人姓名
- `approverNotes` - 批准備註

#### leave_request_rejected

- `employeeName` - 員工姓名
- `leaveType` - 請假類型
- `startDate` - 開始日期
- `endDate` - 結束日期
- `rejectionReason` - 拒絕原因

#### leave_request_cancelled

- `employeeName` - 員工姓名
- `leaveType` - 請假類型
- `startDate` - 開始日期
- `endDate` - 結束日期

### 排班通知變量 (Scheduling Notifications)

#### schedule_created / schedule_updated

- `employeeName` - 員工姓名
- `shiftName` - 班次名稱
- `scheduleDate` - 排班日期
- `startTime` - 開始時間
- `endTime` - 結束時間
- `scheduledHours` - 排班小時數
- `notes` - 備註

#### schedule_cancelled

- `employeeName` - 員工姓名
- `shiftName` - 班次名稱
- `scheduleDate` - 排班日期
- `startTime` - 開始時間
- `endTime` - 結束時間
- `cancellationReason` - 取消原因

#### swap_request_created

- `requesterName` - 請求人姓名
- `targetName` - 目標員工姓名
- `scheduleDate` - 排班日期
- `startTime` - 開始時間
- `endTime` - 結束時間
- `requestType` - 請求類型 (swap/cover/drop)
- `reason` - 換班原因
- `urgency` - 緊急程度

#### swap_request_approved

- `requesterName` - 請求人姓名
- `targetName` - 目標員工姓名（如有）
- `managerName` - 批准主管姓名
- `scheduleDate` - 排班日期
- `startTime` - 開始時間
- `endTime` - 結束時間
- `requestType` - 請求類型

#### swap_request_rejected

- `requesterName` - 請求人姓名
- `managerName` - 拒絕主管姓名
- `scheduleDate` - 排班日期
- `startTime` - 開始時間
- `endTime` - 結束時間
- `requestType` - 請求類型
- `rejectionReason` - 拒絕原因

## 自動觸發機制 (Automatic Triggers)

通知系統已完全整合到業務邏輯中，無需手動調用。以下操作會自動觸發通知：

### LeaveService 自動通知

```typescript
// ✅ 已整合 - 自動發送通知
await leaveService.createLeaveRequest(data)      // → leave_request_submitted
await leaveService.approveLeaveRequest(id, ...)  // → leave_request_approved
await leaveService.rejectLeaveRequest(id, ...)   // → leave_request_rejected
await leaveService.cancelLeaveRequest(id, ...)   // → leave_request_cancelled
```

### SchedulingService 自動通知

```typescript
// ✅ 已整合 - 自動發送通知
await schedulingService.createSchedule(data)           // → schedule_created
await schedulingService.updateSchedule(id, data)       // → schedule_updated
await schedulingService.deleteSchedule(id)             // → schedule_cancelled
await schedulingService.createSwapRequest(data)        // → swap_request_created
await schedulingService.approveSwapRequest(id, ...)    // → swap_request_approved
await schedulingService.rejectSwapRequest(id, ...)     // → swap_request_rejected
```

## 錯誤處理 (Error Handling)

### 非阻塞設計 (Non-blocking Design)

通知失敗不會影響主要業務操作：

```typescript
// 主業務操作成功完成
const leave = await leaveService.createLeaveRequest(data);

// 通知發送失敗也不會拋出錯誤
// 只會記錄到控制台日誌
// ✅ 請假申請依然創建成功
```

### 錯誤日誌 (Error Logging)

所有通知錯誤都會記錄到控制台：

```javascript
console.error("Failed to send leave request notification:", error);
console.error("Failed to send schedule creation notification:", error);
// ... 等等
```

### 監控通知失敗 (Monitoring Failures)

可以通過 Wrangler CLI 查看日誌：

```bash
# 查看實時日誌
wrangler tail makanmakan-api-prod

# 過濾通知相關錯誤
wrangler tail makanmakan-api-prod --format json | grep "notification"
```

## 測試指南 (Testing Guide)

### 1. 本地測試 (Local Testing)

**啟動開發服務器：**

```bash
cd apps/api
npm run dev
```

**測試郵件發送：**

```bash
curl -X POST http://localhost:8787/api/v1/notifications/test \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipientEmail": "test@example.com",
    "category": "leave_request_submitted",
    "type": "email"
  }'
```

### 2. 集成測試 (Integration Testing)

**測試請假通知流程：**

```bash
# 1. 創建請假申請（會自動發送通知）
curl -X POST http://localhost:8787/api/v1/leaves/1/requests \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": 123,
    "leaveTypeId": 1,
    "startDate": "2025-11-10",
    "endDate": "2025-11-12",
    "reason": "家庭事務"
  }'

# 2. 批准請假（會自動發送通知）
curl -X PUT http://localhost:8787/api/v1/leaves/1/requests/1/approve \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "comments": "批准"
  }'
```

### 3. 模板測試 (Template Testing)

**查看所有可用模板：**

```bash
curl -X GET http://localhost:8787/api/v1/notifications/templates \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 權限控制 (Access Control)

### API 權限要求

| 端點           | 最低權限          | 說明         |
| -------------- | ----------------- | ------------ |
| POST /test     | Admin, Shop Owner | 測試通知發送 |
| GET /templates | Admin, Shop Owner | 查看模板列表 |
| POST /send     | Admin, Shop Owner | 手動發送通知 |

### 自動通知權限

自動通知由業務邏輯觸發，遵循對應功能的權限控制：

- 請假管理：需要相應的請假操作權限
- 排班管理：需要相應的排班操作權限

## 故障排除 (Troubleshooting)

### 問題：郵件未發送

**檢查清單：**

1. ✅ 確認部署版本帶有 `NOTIFICATION_EMAIL` send_email binding
2. ✅ 確認 NOTIFICATION_FROM_EMAIL 在已 onboarding 的網域（makanmasak.com）
3. ✅ 檢查 Cloudflare Email Sending 的網域狀態（`wrangler email sending settings makanmasak.com`）
4. ✅ 查看控制台錯誤日誌（`wrangler tail`）
5. ✅ 用 `wrangler email sending send` 寄一封測試信

```bash
# 檢查密鑰是否已設置
wrangler secret list --env production

# 測試通知發送
curl -X POST /api/v1/notifications/test ...
```

### 問題：SMS 未發送

**檢查清單：**

1. ✅ 確認 TWILIO_ACCOUNT_SID 已設置
2. ✅ 確認 TWILIO_AUTH_TOKEN 已設置
3. ✅ 確認 TWILIO_PHONE_NUMBER 已配置
4. ✅ 檢查 Twilio 餘額
5. ✅ 驗證收件人電話號碼格式

### 問題：通知模板變量缺失

**症狀：**

- 通知內容顯示 `{{variableName}}`
- 模板變量未被替換

**解決方案：**

1. 檢查傳入的 `data` 對象是否包含所有必需變量
2. 參考上方「模板變量參考」部分
3. 確保變量名稱拼寫正確（區分大小寫）

## 性能考慮 (Performance Considerations)

### 異步處理

通知發送是異步操作，不會阻塞主業務流程：

```typescript
// 主操作立即返回
const schedule = await createSchedule(data);

// 通知在後台異步發送
// 不影響響應時間
```

### 批量操作優化

對於批量操作，考慮使用批量通知：

```typescript
// 不推薦：循環發送
for (const employee of employees) {
  await createSchedule({ employeeId: employee.id });
  // 每次都會發送通知
}

// 推薦：批量創建後統一通知
const schedules = await bulkCreateSchedules(data);
// 可以實現批量通知邏輯
```

## 未來擴展 (Future Enhancements)

### 計劃中的功能

- [ ] **推送通知支持** - Firebase Cloud Messaging
- [ ] **WebSocket 實時通知** - 使用 Durable Objects
- [ ] **通知偏好設置** - 用戶自定義通知渠道
- [ ] **通知歷史記錄** - 存儲和查詢已發送通知
- [ ] **通知模板編輯器** - 可視化模板管理
- [ ] **多語言模板** - 根據用戶語言偏好發送
- [ ] **通知統計分析** - 發送成功率、打開率等
- [ ] **批量通知 API** - 一次發送多個通知

## 相關文檔 (Related Documentation)

- [Leave Management Implementation](./LEAVE_MANAGEMENT_IMPLEMENTATION.md)
- [Employee Scheduling Implementation](./EMPLOYEE_SCHEDULING_IMPLEMENTATION.md)
- [API Documentation](./api/)
- [Architecture Documentation](./architecture/)

## 支援聯繫 (Support)

如有問題或建議，請聯繫：

- 技術支援：tech@makanmakan.com
- 文檔問題：docs@makanmakan.com

---

**最後更新 (Last Updated):** 2025-11-03
**版本 (Version):** 1.0.0
**狀態 (Status):** ✅ Production Ready
