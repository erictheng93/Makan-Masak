# 出單與列印流程

> **對應 master board**：現場作業 → 出單與列印流程
> **主要角色**：收銀（role 4）、店主（role 1）；列印代理是店內常駐服務
> **最後對照原始碼**：2026-08-21

## 1. 定位

一張紙要吐出來，會經過三段：雲端把收據列排進待印佇列、店內的列印代理把它認領走、
代理印完再回報結果。雲端派工這一段（認領、回報、回收、健康）接起來了；**店內代理那一段沒有**。
印表機驅動是模擬的、代理不會執行列印工作，所以目前一張紙都印不出來，見 §8。

## 2. 雲端這一端

| 動作 | 端點 | 做了什麼 |
| --- | --- | --- |
| 列印收據 | `POST /api/v1/pos/receipts/print` | 產生收據內容 → 寫入 `receipts`（`print_status = 'pending'`），**不會**自己標成 printed |
| 重印 | `POST /pos/receipts/:receiptId/reprint` | `reprinted_count + 1`，狀態回到 `pending`，並把 `print_attempts` 歸零 |
| 取消列印 | `POST /pos/receipts/:receiptId/cancel-print` | 標成 `cancelled` |
| 訂單收據 | `GET /api/v1/orders/:id/receipt` | 產生收據資料（計 `print.jobs` 配額） |

閘門：`moduleGate("receipt_printing")` + `quotaGate("print.jobs")` + `requireRole([0, 1, 4])`。

**已取消訂單的廚房票會在認領時作廢**（`print_status = 'cancelled'`），不會交給代理。

**廚房出單票是自動的。** 訂單轉 `confirmed` 時，`OrdersService.updateOrderStatus` 會呼叫
`ReceiptService.createKitchenTicket`，寫入一張 `receipt_type = 'kitchen'`、
**`register_id = NULL`** 的待印收據。同一張訂單已經有未取消的廚房票就不再開（冪等，
因為外送平台那條路徑是直接寫狀態的）。產生失敗只留 log：訂單狀態已經寫進資料庫，
不能因為排不進出單佇列就回滾。

## 3. 派工協定

代理主動輪詢雲端，雲端不推播（NAT／防火牆友善）。每次輪詢會**一路認領到佇列清空**
（上限 20 張／輪，超過的留到下一次心跳），而不是一次一張——後者在晚餐尖峰是一分鐘
一張。

**印失敗就停止當輪 drain。** 剛弄壞印表機的東西，對下一張幾乎一定也還是壞的；繼續
drain 只會把整個佇列的重試預算一起燒掉。代價是「印表機專門卡住的那一張」會擋住後面
的佇列數次心跳，直到它自己用完預算轉 `failed`，佇列才往前——真實的印表機故障遠比
毒藥收據常見，而且這樣不需要人介入就會自己恢復。

| 端點 | 做了什麼 |
| --- | --- |
| `GET /api/v1/print/jobs` | 認領一筆待印收據（`print_status → 'printing'`、`claimed_at_ms`、`print_attempts + 1`），回傳出單內容 |
| `POST /api/v1/print/jobs/:receiptId/ack` | 回報 `printed` / `failed` / `indeterminate`，附 `printerName`、`response` |

**配對規則**：`代理.restaurant_id = 訂單.restaurant_id` **且**
`收據.register_id IS 代理.register_id`（null-safe 相等）。

- 綁收銀機的代理（櫃檯出單機）→ 拿該台收銀機的收據
- 不綁收銀機的代理（全店，例如廚房出單機）→ 拿 `register_id IS NULL` 的收據，也就是廚房票

用 `IS` 而不是 `=`：`= NULL` 的結果是 NULL，廚房票會配不到任何代理而永遠不印。

**認領回收**：認領超過 5 分鐘沒有回報就視為棄置，由下一次輪詢重新排入（代理自己等
實體印表機的上限是 30 秒，所以超過五分鐘代表程序死了而不是還在印）。連續 5 次投遞
未果就標成 `failed`，不再無限回收。`print_status = 'printing'` 但沒有 `claimed_at_ms`
的列也視為棄置。

**失敗會自動重試**：代理回報 `failed` 時，若 `print_attempts` 未達上限就退回
`pending`，由下一次認領重試；達上限才維持 `failed`。沿用既有的次數預算，沒有第二個
計數器。`printer_name` / `printer_response` 會保留，所以排隊重試期間仍看得到上一次
的錯誤。

**只有「觀察到的結果」才會重排**：`failed` 是代理親眼看著作業結束且沒印出來，所以重
印是對的。代理等滿 30 秒仍不知道結果時回報的是 `indeterminate` —— 那張可能已經在紙
上了（本地佇列還在重試一個取消不掉的作業），重排等於印第二張，因此不論還剩幾次額度
一律終局判 `failed`，錯誤訊息留在列上讓人決定要不要手動重印。代理在放棄前會先試著取
消本地作業：取消成功代表它根本還沒送到印表機，那才回報 `failed`。

**沒有退避（backoff），節奏由代理的輪詢間隔提供** —— 這條成立的前提是**代理印失敗
就結束當輪 drain**（見下節）。少了那條規則，drain 會立刻重新認領剛退回 `pending` 的
同一張，幾秒內燒光它的次數預算，然後對佇列裡每一張重複一次。

## 4. 憑證與租戶邊界

`print_agents` 一台代理一份憑證，只存 SHA-256 摘要，明文在核發當下回傳一次。

**餐廳範圍由憑證本身持有，代理沒有任何自報租戶的管道。** 驗證是「用摘要查表」而不是
「跟存起來的密文比對」，所以應用層沒有任何與密鑰相關的字串比較可以計時。

| 端點 | 角色 | 做了什麼 |
| --- | --- | --- |
| `GET /api/v1/pos/print-agents` | 0, 1, 4 | 列出本店代理與健康狀態（不含金鑰） |
| `POST /api/v1/pos/print-agents` | 0, 1 | 核發，`registerId` 選填（省略 = 全店代理） |
| `DELETE /api/v1/pos/print-agents/:agentId` | 0, 1 | 撤銷 |

餐廳一律取自登入者；平台管理員（role 0）不綁餐廳，必須用 `?restaurantId=` 明講。

`/api/v1/print/jobs` 在 CSRF 的 `excludePaths` 裡：代理是 Node 常駐程序，不送 Origin、
Referer 或 cookie，兩層 CSRF 都會在進入 handler 前拒絕它。豁免只涵蓋 `/jobs`，不是整個
`/print`，所以之後加在 `/print` 底下、由瀏覽器驅動的端點仍然受保護。

## 5. 健康狀態

代理每次輪詢時把 `printersTotal` / `printersOnline` 一併帶上（取自它自己的
`healthCheck()`）。健康判定在伺服器端算，只有一份定義：

| 狀態 | 意義 |
| --- | --- |
| `online` | 五分鐘內有輪詢，且至少一台印表機在線 |
| `no_printer` | 代理活著，但回報 0 台在線 —— 印表機被拔掉或掛了 |
| `offline` | 超過五分鐘沒有輪詢 |
| `never_seen` | 核發後從未連線 |

`no_printer` 就是這一段存在的理由：只看 `last_seen_at_ms` 的話，它與完全正常無法分辨。
探測失敗時代理**不送**台數，雲端沿用上一筆讀數——把「問不到」當成「零台在線」會製造假警報。

後台介面在 admin-dashboard `/dashboard/print-agents`（`PrintAgentsView.vue`）。

## 6. 店內這一端

`apps/print-agent` 是本機常駐 Node 服務：

| 介面 | 用途 |
| --- | --- |
| HTTP `:3003` | `/api/v1/print`、`/print/:jobId`、`/devices`、`/health`、`/statistics` 等，供同一區網的 POS 呼叫 |
| WebSocket `:3004` | 狀態推播 |

兩把金鑰，信任方向不同，不共用：

- `PRINT_AGENT_API_KEY`（必填）— 本機 HTTP/WS 認證，POS 前端 → 代理
- `PRINT_AGENT_CLOUD_KEY`（選填）— 雲端派工憑證，代理 → 雲端，由後台核發

沒有設 `PRINT_AGENT_CLOUD_KEY` 就只當本機列印伺服器，不會去輪詢——這是合法設定，不是錯誤。

**啟動不依賴雲端。** 開機時會先拉一次待印工作，但失敗只留 log：`index.ts` 對 `start()`
失敗的處理是 `process.exit(1)`，讓對外連線斷掉就整個停擺，會連原本可用的本機列印一起沒了。

## 7. 對應程式碼與測試

**程式碼**

- `apps/api/src/features/print/routes.ts` — 派工、認領回收、健康回報
- `apps/api/src/features/pos/routes/print-agents.ts` — 憑證核發／撤銷／狀態
- `apps/api/src/features/pos/services/PrintAgentCredentialService.ts` — 憑證與健康判定
- `apps/api/src/features/pos/services/ReceiptService.ts` — 收據與廚房票產生
- `apps/api/src/shared/utils/print-agent-key.ts` — 金鑰產生與雜湊
- `apps/print-agent/src/LocalPrintService.ts` — 本機 HTTP/WS、雲端輪詢與回報
- `packages/queue-core/src/print/` — 驅動、工作佇列、健康監控
- `packages/database/migrations_fresh/0001_print_agents.sql`、`0002_restaurant_scoped_print_dispatch.sql`

**測試**

- `apps/api/src/__tests__/integration/print-jobs.real.integration.test.ts` — 真 D1：跨租戶隔離、
  null-safe 配對、認領回收、投遞次數上限、併發認領
- `apps/api/src/app-factory.print-agent-csrf.test.ts` — CSRF 豁免的範圍
- `apps/api/src/features/pos/routes/print-agents.test.ts`、`services/ReceiptService.test.ts`
- `apps/admin-dashboard/src/views/PrintAgentsView.test.ts`
- `apps/print-agent/src/LocalPrintService.test.ts`

**手動探索 QA（production）**

- [現場作業流程 QA 2026-09-22](../investigations/2026-09-22-floor-operations-flow-qa.html) — D1–D3

## 8. 已知缺口

0. **代理印不出任何東西**（2026-09-22 實測，見 [現場作業流程 QA 2026-09-22](../investigations/2026-09-22-floor-operations-flow-qa.html)）。
   `queue-core` 的 Epson／Star／Citizen 驅動 `connect()` 永遠成功、`sendCommands()` 只按指令長度
   `setTimeout`、`getStatus()` 永遠回 `online`；`detectPrinter` 不連線，只看位址字串是否含
   `epson`／`star`／`citizen`，所以自動掃描找不到任何真印表機；加了印表機之後，每張工作都失敗在
   `executePrintJob method must be implemented by PrinterService`。後台同時顯示
   「Healthy · 1/1 printers online」。repo 裡沒有任何 TCP／USB／serial 傳輸程式碼。
0. **沒有印表機時代理照樣認領**，每張票回 `failed`（No available printer found），
   幾輪心跳就燒完投遞額度——雖然雲端已經知道這台回報 0 台在線。
1. **重試沒有退避。** 節奏完全來自代理的輪詢間隔（預設 60 秒）與「印失敗就停 drain」
   這條規則。要真正的指數退避需要一個 `next_attempt_at_ms` 欄位。
2. **`processWebhook` 沒有對 `platformOrderId` 去重**，平台重送 webhook 會建出**新的**
   訂單列（連帶一張新的廚房票）。這是既有問題，不是廚房票帶來的。
3. **毒藥收據會擋住佇列數次心跳**，直到它用完投遞預算。見第 3 節的取捨說明。
4. **廚房票的版型與顧客收據共用** `generateReceiptContent`，只是 `templateName` 不同。
   廚房票其實不需要價格，實際排版取決於代理端的 ESC/POS 樣板。
