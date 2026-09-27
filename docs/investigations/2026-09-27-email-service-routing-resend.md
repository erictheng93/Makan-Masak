# Cloudflare Email Service、Email Routing 與 Resend

查核日期：2026-09-27。以下對照官方文件與目前儲存庫；Cloudflare 帳戶與 DNS 的實測見文末。

## 先分清收信與寄信

| 服務 | 收信 | 對一般客戶寄信 | 適合用途 |
| --- | --- | --- | --- |
| Cloudflare Email Routing | 依規則轉寄至已驗證的信箱，或交給 Worker 的 `email()` handler | 本身不是一般對外寄信方案；Email Service 允許寄給帳戶內已驗證目的地址 | `support@` 等地址轉寄，或由 Worker 處理入站郵件 |
| Cloudflare Email Sending | 與 Routing 分開設定 | Workers binding、REST API 或 authenticated SMTP；截至查核日仍為公開 beta，向任意地址寄送須 Workers Paid | Worker 應用發送交易郵件 |
| Resend | 可用自有網域或 Resend 提供的入站地址，透過 webhook/API 處理收到的郵件 | REST API、SDK 或 SMTP | 交易郵件；需要時也可由同一供應商處理程式化收信 |

Cloudflare 把 Email Sending 和 Email Routing 合稱 **Email Service**；Routing 並不等於整套 Email Service。Routing 是轉寄／處理入口，並非供員工直接登入使用的完整信箱。Cloudflare 的發信綁定可以從 Worker 直接呼叫 `env.EMAIL.send()`，Resend 也有 Cloudflare Workers 整合。[Cloudflare Email Service](https://developers.cloudflare.com/email-service/) · [Routing 規則與目的地址](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/) · [Resend Workers 整合](https://resend.com/cloudflare) · [Resend inbound](https://resend.com/blog/inbound-emails)

## 價格與限制

- Cloudflare Routing：Workers Free／Paid 都可用；入站郵件不按封計費，若交給 Worker 執行，Worker 的用量另計。Email Sending 寄給任意地址須 Workers Paid，每帳戶每月含 3,000 封，之後 USD 0.35／1,000 封；寄到帳戶已驗證目的地址免費且不占配額。[Cloudflare 定價](https://developers.cloudflare.com/email-service/platform/pricing/)
- Cloudflare Email Sending：新帳戶起始每日額度保守，之後可依寄送表現調整；一般寄信每封最多 50 位收件人及 5 MiB（含附件）。因此上線前應確認帳戶實際限額。[Cloudflare 限制](https://developers.cloudflare.com/email-service/platform/limits/)
- Resend 交易郵件 Free：每月 3,000 封、每日 100 封、3 個網域；Pro：USD 20／月含 50,000 封，無每日封數限制，額外 USD 0.90／1,000 封。Resend 也支援入站郵件，不能把它描述成只能寄信。[Resend 定價](https://resend.com/pricing) · [Resend inbound](https://resend.com/blog/inbound-emails)

## 選型判斷

1. **只需要發訂單、登入、密碼重設等交易郵件：** 沒有收信需求就不必啟用 Routing。若目前 Resend 運作穩定，也沒有成本、限額或整合痛點，保留它最省事。Cloudflare Email Sending 的 Worker 原生綁定和單價值得在有明確需求時評估，但它截至查核日仍標示 beta，不能只依每千封價格判斷應遷移。[Cloudflare Email Service](https://developers.cloudflare.com/email-service/) · [Cloudflare 定價](https://developers.cloudflare.com/email-service/platform/pricing/)
2. **要用 `support@domain` 等地址收信給真人回覆，並用 Resend 向客戶寄交易郵件：** Routing 收、Resend 寄是可行分工；Routing 把郵件轉到已驗證的既有信箱。Resend 的寄信認證與 bounce return-path 使用另外的 DNS 記錄／子網域，須按兩家要求核對 SPF、DKIM、DMARC 與 MX。[Cloudflare Routing 快速開始](https://developers.cloudflare.com/email-service/get-started/route-emails/) · [Cloudflare 網域設定](https://developers.cloudflare.com/email-service/configuration/domains/) · [Resend return-path](https://resend.com/changelog/custom-return-path)
3. **要讓應用讀取、分類或回覆入站郵件：** 可以用 Routing 指向 Email Worker；也可以評估 Resend inbound webhook。後者會解析郵件並將事件送給 HTTP endpoint；是否採用取決於需要原始郵件處理、webhook、附件存取及運維偏好。[Cloudflare Routing 快速開始](https://developers.cloudflare.com/email-service/get-started/route-emails/) · [Resend inbound](https://resend.com/blog/inbound-emails)

**DNS 注意：** 啟用 Cloudflare Email Routing 會讓 Cloudflare 管理收信網域的 MX；同一網域若現已由 Google Workspace、Microsoft 365、Resend inbound 或其他服務直接收信，不能直接疊加兩組 MX 當成按地址分流。先查正式環境的 MX 與現有信箱，再決定是否遷移收信或用獨立子網域。Cloudflare 的 Email Sending 可與 Routing 分別啟用；單純換寄信商不需要改收信 MX。[Cloudflare 網域設定](https://developers.cloudflare.com/email-service/configuration/domains/) · [Cloudflare DNS 故障排除](https://developers.cloudflare.com/dns/troubleshooting/email-issues/) · [Cloudflare 子網域設定](https://developers.cloudflare.com/email-service/configuration/subdomains/)

## MakanMasak 現況

- API 的共用通知服務有 `RESEND_API_KEY` 才透過 Resend 寄送；沒有金鑰則不寄。MailChannels 已停用。帳務通知與系統警報亦使用 Resend。[NotificationService](../../packages/database/src/services/NotificationService.ts) · [BillingNotificationService](../../apps/api/src/features/billing/services/BillingNotificationService.ts) · [AlertService](../../apps/api/src/services/AlertService.ts)
- Management API 對申請人的收件確認、駁回及設定密碼信走 Cloudflare Email Service（沿用 `ONBOARDING_NOTIFICATION_EMAIL` binding）；Resend 仍保留，只有 `ONBOARDING_EMAIL_PROVIDER="resend"` 且設有 `RESEND_API_KEY` 時才會使用。正式環境自 2026-09-27 起 `ONBOARDING_EMAIL_ENABLED="true"`；寄送失敗只會把開通信紀錄標為 `failed` 並退回人工轉交，不影響審核。平台內部的新申請通知使用同一個 binding，收件人與寄件人放在正式環境 secrets（`PLATFORM_NOTIFICATION_EMAIL`、`PLATFORM_NOTIFICATION_EMAIL_FROM`），不寫進儲存庫。[OnboardingService](../../apps/management-api/src/services/OnboardingService.ts) · [wrangler.toml](../../apps/management-api/wrangler.toml) · [營運說明](../../apps/management-api/ONBOARDING_NOTIFICATIONS.md)
- API（`apps/api`）的忘記密碼、Email 驗證、帳務與警報信仍只支援 Resend，正式環境沒有金鑰，所以仍寄不出；改走 Cloudflare 的工作在 #374 追蹤。
- 儲存庫的應用程式與 Worker 設定沒有實作入站郵件 `email()` handler 或 Resend inbound webhook，應用程式沒有程式化收信流程。

### 帳戶實測（2026-09-27，`wrangler email` 與 `dig`）

- **Email Sending：** `makanmasak.com` 已啟用，DKIM selector `cf-bounce`，return-path 為 `cf-bounce.makanmasak.com`。寄件網域已完成 onboarding，可從任何 `@makanmasak.com` 地址寄給任意收件人。
- **Email Routing：** 查核當天稍早為未啟用；之後已啟用（狀態 `ready`），建立兩條規則：`onboarding@makanmasak.com` 與 `support@makanmasak.com` 分別轉寄到兩個已驗證的營運信箱（實測皆送達），catch-all 維持停用（丟棄）。目的地址清單只放在 Cloudflare，不寫進儲存庫。
- **DNS：** 啟用 Routing 前根網域沒有 MX，也沒有 SPF TXT，所以沒有衝突；啟用後 Cloudflare 加上 `route1`–`route3.mx.cloudflare.net` 三筆 MX 與 `v=spf1 include:_spf.mx.cloudflare.net ~all`。DMARC 為 `p=reject`，因此不能在 Gmail 以 `support@` 等地址經 Gmail 伺服器回信。
- **未驗證收件人實測：** 以 `wrangler email sending send` 從 `onboarding@makanmasak.com` 寄往一個不在目的地址清單內的地址（Gmail `+` 別名），API 回 `Queued`，收件人確認**已送達**。所以寄件網域完成 onboarding 後，確實可以寄給任意地址；依官方說明這類寄送計入每月額度，寄往已驗證目的地址則不計（額度計算本身未能由 CLI 驗證）。
- **正式環境端到端實測（2026-09-27）：** 一筆受控測試申請依序收到收件確認信、平台新申請通知，核准後收到店主開通信，設定密碼連結可成功設定密碼。測試租戶已停用，平台端資料已刪除；申請與審計事件依只增不刪的設計保留。
