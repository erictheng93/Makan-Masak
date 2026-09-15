# 入駐流程

> **對應 master board**：平台管理 → 入駐流程；店家後台 → 開通與首次設定
> **主要角色**：申請人（無帳號）、平台管理者（role 0）、新店主（role 1）
> **最後對照原始碼**：2026-09-15

## 1. 定位

一家新店從「平台決定收它」到「店主能登入後台」為止。目前唯一走得通的營運方式是
**平台人員陪同、一家一家手動開通**：憑證不寄信，全靠平台人員轉交。

有兩個入口，寫入的東西相同，差在誰設定店主密碼：

| 入口 | 在哪裡 | 店主密碼 | 服務 |
| --- | --- | --- | --- |
| A. 開店申請 → 核准 | 申請：Onboarding App `:3011`；審核：Admin Dashboard「開店申請」`/dashboard/platform/onboarding` | 店主用一次性連結自己設定 | `apps/management-api` 直接寫兩個 D1 |
| B. 平台直接建店 | Admin Dashboard「帳號管理」`/dashboard/account-management` | 管理者在表單裡代設 | `apps/api`，再經 internal API 通知 management-api |

**Management Portal `:3010` 不參與入駐**——它只有 tenants／deployments／health／licenses／markets。

## 2. 觸發與前置條件

| 項目 | 內容 |
| --- | --- |
| 進入點 | 見 §1 表格 |
| 認證 | 申請端**無需帳號**；審核與直接建店都要 role 0 |
| 綁定（入口 A） | management-api 需同時綁 `MANAGEMENT_DB` 與平台 D1（`PLATFORM_DB`） |
| 綁定（入口 B） | api 需 `MANAGEMENT_API` service binding，且 api 與 management-api 的 `INTERNAL_API_TOKEN` **必須存在且相同** |

## 3. Happy path

### 入口 A：開店申請 → 核准

| # | 動作 | 端點／程式 | 狀態 |
| --- | --- | --- | --- |
| 1 | 送出申請（店名、聯絡人、Email、電話、座標） | `POST /onboarding/applications` | → `submitted` |
| 2 | 自動配發 subdomain | `generateSubdomain` + 最多 5 次重試 | — |
| 3 | 發出 application secret | 只回給申請人一次，DB 存 hash | — |
| 4 | 平台審核清單 | `GET /admin/onboarding/applications` | — |
| 5 | 核准 | `POST /admin/onboarding/applications/:id/approve` | → `provisioning` |
| 6 | 建立租戶與訂閱 | `createTenantWithSubscription` | 寫 `MANAGEMENT_DB` |
| 7 | 建立平台餐廳與店主帳號 | `createPlatformOwnerAccount` | 寫 `PLATFORM DB`：`restaurants`、`users`、`shop_subscriptions`、`password_reset_tokens` |
| 8 | 產生設定密碼連結 | `createCredentialDelivery` | — |
| 9 | 標記完成 | `UPDATE onboarding_applications SET status='completed'` | → `completed` |
| 10 | 寄出憑證 | `dispatchCredentialDelivery` | 線上為 `manual`，不寄 |
| 11 | 管理者從核准橫幅取得帳號與連結，轉交店主 | `PlatformOnboardingApplicationsView` | — |
| 12 | 店主開連結設定密碼 | `https://admin.makanmasak.com/reset-password?token=…` → `POST /auth/reset-password` | token 作廢、`tokenVersion + 1` |
| 13 | 店主以該帳號登入 | `POST /auth/login` | — |

駁回：`POST /admin/onboarding/applications/:id/reject` → `rejected`。不填原因、不通知申請人。

> **店主的初始密碼是「不可用密碼」。** `createPlatformOwnerAccount` 用
> `generateUnusablePassword()` 產生隨機字串再 bcrypt，真正的入口是設定密碼連結。
> 所以核准之後、店主點連結之前，那個帳號是登不進去的。

> **連結網域取 `CORS_ORIGIN` 的第一個值**（`buildSetupPasswordLink`），其次才是
> `API_BASE_URL`。production 的第一個值是 `https://admin.makanmasak.com`，所以連結落在
> 店家後台的 `/reset-password`。改 `CORS_ORIGIN` 順序會改掉連結去哪。

> **帳號是聯絡 Email 的 `@` 前綴**（`generateAvailableOwnerUsername`），撞名才加亂碼尾碼。
> 登入不檢查 `isVerified`，設完密碼即可登入。

> **餐廳 id 必須是 UUID v7。** 註解寫得很明白：v4 的 owner id 會讓這個租戶的菜單圖片上傳直接壞掉。

> **是否寄信只看 `ONBOARDING_EMAIL_ENABLED`。** 未設定就是 `manual`，送達紀錄停在
> `pending`、不會再變。2026-09-15 查 production：management-api 只有 `JWT_SECRET` 一把
> secret，這個變數也沒設，唯一一筆送達紀錄是 `manual / pending`。

### 入口 B：平台直接建店

| # | 動作 | 端點／程式 | 失敗時 |
| --- | --- | --- | --- |
| 1 | （可選）建立餐廳 | `POST /restaurants` → `RestaurantsService.createRestaurant` → `provisionRestaurantTenant` | 停用剛建的餐廳並回錯 |
| 2 | 建立店主並代設密碼 | `POST /users`（`role=1`）→ `UsersService.createUser` → `linkRestaurantOwner` | 停用剛建的店主並回錯 |
| 3 | 管理者把帳號與密碼轉交店主 | 人工 | — |

兩步都經 internal API，缺 `INTERNAL_API_TOKEN` 時 `ManagementTenantClient` 直接拋
`INTERNAL_API_TOKEN is not configured`。

## 4. 補償（rollback）

入口 A 的 `activateApplication` catch 會**反序**執行四步補償：

1. `rollbackCredentialDelivery`
2. `rollbackPlatformOwnerAccount`
3. `rollbackTenantProvisioning`
4. 把申請狀態改回 `submitted`

每一步都包在 `runRollbackStep` 裡，單一步驟失敗不會中斷其他步驟。

入口 B 沒有刪除式補償，只把剛建的餐廳或店主設為停用。

## 5. Edge cases 與失敗模式

| 情境 | 系統行為 | 錯誤碼 | 風險 |
| --- | --- | --- | --- |
| 重複核准已完成的申請 | 直接回既有結果（冪等） | — | 🔴 P0（已防） |
| 核准非 `submitted` 狀態的申請 | 「Cannot complete application with status: X」 | — | 🟠 P1 |
| subdomain 被佔用 | 產生建議清單；連續 5 次都撞則「Unable to generate an available subdomain」 | — | 🟡 P2 |
| 已 `rejected` / `completed` 的申請佔用的 subdomain | 不算佔用（查詢有排除這兩種狀態） | — | ⚪ P3 |
| 沒帶 `X-Onboarding-Secret` 查申請 | 401 | `APPLICATION_SECRET_REQUIRED` | 🟠 P1 |
| 建立店主帳號失敗 | 反序補償（見 §4），申請退回 `submitted` | — | 🔴 P0（已防） |
| 憑證寄送失敗 | **不回滾**，`credentialDelivery.status = failed` 並附錯誤訊息 | — | 🟠 P1 |
| 管理者關掉核准橫幅 | 連結從畫面消失；已完成的申請核准鈕停用，**UI 取不回連結** | — | 🟠 P1 |
| 設定連結過期（24h） | 忘記密碼要寄信，線上沒有寄信憑證；只能由管理者在員工列表代設密碼 | `PASSWORD_RESET_FAILED` 類 | 🟠 P1 |
| 缺 `INTERNAL_API_TOKEN`（入口 B） | 建店或建店主都失敗，剛建的列被停用。2026-09-15 查 production：api 與 management-api 都沒有這把 secret，線上唯一的餐廳來自入口 A，入口 B 從未在線上跑過 | — | 🔴 P0 |
| 平台 DB binding 沒設定 | 「Platform DB binding is not configured」 | — | 🔴 P0 |
| 本機開發沒有套齊兩套 migration | 核准會失敗——management 的 0010–0012 與平台 `migrations_fresh` 都要套進同一個 local D1 | — | 🟡 P2 |

## 6. 對應程式碼與測試

**程式碼**

- `apps/management-api/src/routes/onboarding.ts` — 公開申請端點與 secret 驗證
- `apps/management-api/src/routes/admin-onboarding.ts` — 審核端點
- `apps/management-api/src/services/OnboardingService.ts:287` — 核准、供應、補償
- `apps/management-api/src/services/TenantService.ts`
- `apps/admin-dashboard/src/views/PlatformOnboardingApplicationsView.vue` — 審核頁與核准橫幅
- `apps/admin-dashboard/src/views/AccountManagementView.vue` — 入口 B
- `apps/api/src/services/managementTenantClient.ts` — 入口 B 的 internal API 呼叫

**測試**

- `apps/management-api/src/__tests__/integration/onboarding-workflow.real.integration.test.ts`
- `apps/admin-dashboard/src/views/PlatformOnboardingApplicationsView.test.ts`
- `tests/e2e/integration/real-workflows.spec.ts` — 只涵蓋「送出申請」這一步

## 7. 已知缺口

- **沒有任何測試走完「設定連結 → 設密碼 → 以店主登入」**；整合測試只斷言連結的格式。
- **憑證不寄信，也沒有重送或重新產生連結的機制。** 過期或遺失只能人工處理。
- **申請頁文案與現況不符**：成功頁說「已發送確認郵件」，但送出申請不寄任何信；首頁仍寫「獨立部署、完全隔離環境、24 小時內上線」，並顯示從未生效的 `*.makanmasak.com` 專屬網址。
- **申請頁寫死 `planId: "standard"`**（`ApplyView.vue`），自助申請開成付費 BASIC、帳期立即起算；入口 B 則是 30 天試用。
- **新餐廳預設值要店主自己改**：地址是「Onboarding GPS 緯度, 經度」、`city` 寫死「台中市」，而設定頁沒有 `city` 欄位。
- **沒有首次登入的開店引導**，店主要自己知道去補資料、建菜單、產生桌位 QR、開放點餐。
- **跨兩個 D1 沒有交易**（D1 本來也沒有跨庫交易），一致性完全靠 §4 的補償。
- 舊的 Cloudflare 驗證／完成流程已退役，只保留在歷史文件裡。
