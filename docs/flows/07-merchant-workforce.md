# 人事流程

> **對應 master board**：店家後台 → 人事流程
> **主要角色**：店主（role 1）、管理者（role 0）；員工（role 2–4）可對自己打卡與請假
> **最後對照原始碼**：2026-08-21

## 1. 定位

員工帳號、排班、出勤打卡、請假審核。四塊共用同一個「店家範圍」邊界：
非 role 0 的所有操作都被限制在自己的 `restaurantId` 內。

## 2. 員工帳號

| 動作 | 端點 | 角色 |
| --- | --- | --- |
| 建立員工 | `POST /api/v1/auth/register-staff` 或 `POST /api/v1/users` | 0/1 |
| 列表／搜尋／統計 | `GET /users`、`/users/search`、`/users/stats` | 0/1 |
| 修改資料 | `PUT /users/:id` | 0/1 |
| 改密碼 | `POST /users/:id/password`、`POST /users/:id/reset-password` | 0/1 |
| 停用／啟用 | `PATCH /users/:id/status` | 0/1 |

停用帳號會立刻生效：每一次請求都會打 DB 檢查 `isActive`，舊 token 當場失效
（見 [00](./00-visitor-entry-and-auth.md) §3.3）。

## 3. 排班

| 動作 | 端點 |
| --- | --- |
| 班表範本 CRUD | `GET/POST/PUT/DELETE /api/v1/scheduling/:restaurantId/templates`、`/templates/:id` |
| 排班 CRUD | `GET/POST/PUT/DELETE /scheduling/:restaurantId/schedules`、`/schedules/:id` |
| 批次排班 | `POST /scheduling/:restaurantId/schedules/bulk` |
| 可用員工 | `GET /scheduling/:restaurantId/available-employees` |
| 衝突清單與解決 | `GET /scheduling/:restaurantId/conflicts`、`POST /conflicts/:id/resolve` |
| 統計 | `GET /scheduling/:restaurantId/stats/daily`、`/stats/weekly` |

建立排班時會先跑 `checkScheduleConflicts`，偵測到就直接拒絕，衝突型別包含
`overlapping_shifts`、`leave_conflict`、`availability_conflict` 等。

## 4. 出勤打卡

| 動作 | 端點 | 誰可以 |
| --- | --- | --- |
| 上班打卡 | `POST /scheduling/schedules/:id/clock-in` | 員工本人；主管可代打（帶 `employeeId`） |
| 下班打卡 | `POST /scheduling/schedules/:id/clock-out` | 同上 |
| 主管補登 | `POST /scheduling/schedules/:id/admin-clock-in`、`/admin-clock-out` | 0/1 |
| 在班人員 | `GET /scheduling/:restaurantId/clocked-in` | 0/1 |
| 出勤報表／匯出 | `GET /scheduling/:restaurantId/attendance-report[/export]` | 0/1 |

規則（`SchedulingService.clockIn` / `clockOut`）：

- 重複上班打卡 → `Already clocked in`
- 沒上班就下班 → `Must clock in first`
- 重複下班打卡 → `Already clocked out`
- 下班時計算 `actualHours`，超過 `scheduledHours` 的部分寫入 `overtimeHours`
- 非主管只能對自己的排班打卡（路由層與服務層各擋一次）

## 5. 請假

| 動作 | 端點 |
| --- | --- |
| 假別 CRUD | `GET/POST/PUT/DELETE /api/v1/leaves/:restaurantId/types`、`/types/:id` |
| 假別餘額 | `GET /leaves/balances`、`GET /leaves/:restaurantId/balances` |
| 手動調整餘額 | `POST /leaves/balances/adjust` |
| 年度累計 | `POST /leaves/:restaurantId/balances/accrue` |
| 申請 | `POST /leaves/:restaurantId/requests` |
| 審核 | `POST /leaves/requests/:id/approve`、`/reject`、`/cancel` |
| 假日與工作日查詢 | `GET /leaves/:restaurantId/holidays`、`/working-day/:date` |

餘額是三個數字算出來的：`remaining = totalDays - usedDays - pendingDays`，
所以**送出申請就會先吃掉 `pendingDays`**，不是核准才扣。

審核權限由 `assertApprovalAuthority` 把關：審核者必須是 active 的 role 0 或 1，
而且 role 1 的 `restaurantId` 必須等於該申請的餐廳。

## 6. Edge cases 與失敗模式

| 情境 | 系統行為 | 風險 |
| --- | --- | --- |
| 員工替別人打卡 | 403 Access denied（路由層），服務層另有 `Unauthorized` | 🟠 P1 |
| 重複打卡 | 明確錯誤訊息，不是靜默覆蓋 | 🟡 P2 |
| 忘記下班打卡 | **沒有自動補登或告警**，該筆排班就停在只有 clock-in 的狀態 | 🟠 P1 |
| 排班與已核准的假重疊 | 建立時被 `leave_conflict` 擋下 | 🟠 P1 |
| 先排班、後核准假 | 排班已存在，衝突偵測是建立時檢查，事後不會回頭標記 | 🟠 P1 |
| 他店主管審核本店假單 | `Approver is not authorized` | 🔴 P0 |
| 已停用的主管審核 | 同上（會檢查 `isActive`） | 🔴 P0 |
| 刪除系統預設假別 | `Cannot delete system-defined leave type` | ⚪ P3 |
| 餘額不足仍送申請 | 由申請端規則決定；`pendingDays` 會先計入，避免超額連送 | 🟡 P2 |

## 7. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/users/routes/index.ts`
- `apps/api/src/features/scheduling/routes/index.ts:388` — 打卡身分判定
- `packages/database/src/services/SchedulingService.ts:881` — clockIn／clockOut 規則、`:614` 衝突檢查
- `apps/api/src/features/leaves/routes/index.ts`
- `packages/database/src/services/LeaveService.ts:243` — 審核授權

**測試**

- `packages/database/src/services/LeaveService.test.ts`
- `apps/api/src/features/scheduling/*`（見 feature 內 `*.test.ts`）
- `tests/e2e/admin/`（`admin-real`）：`attendance`、`leaves`

**手動探索 QA（production）**

- [店家後台流程 QA 2026-09-01](../investigations/2026-09-01-admin-dashboard-flow-qa.html) — F7–F10（打卡、假別、餘額初始化）

## 8. 已知缺口

- **沒有漏打卡的偵測或補正機制**。只有主管手動 `admin-clock-out`。
- **衝突偵測只在寫入排班時做**。事後才核准的假不會回頭標出既有排班衝突。
- **請假餘額調整只留「最後一次」的痕跡**。`adjustedBy` / `adjustmentReason` 是餘額列上的欄位，會被下一次調整覆蓋，沒有逐筆調整歷史。
- 排班沒有跨店支援：一個員工只屬於一個 `restaurantId`。
