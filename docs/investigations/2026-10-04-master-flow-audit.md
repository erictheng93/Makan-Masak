# Master user flow 與 investigations 現況稽核

查核日期：2026-10-04。基底 HEAD：`8b9c7a571`。本輪核對目前工作區，包含原有未提交的認證、候位、付款、realtime 等修改；不是乾淨 HEAD 或 production 驗收。沒有部署、推送、production 寫入、寄信或真金流交易。

## 判斷與對齊原則

**舊調查多數是有效的歷史紀錄，但不能當作今日上線狀態。** 顧客與現場報告有後續證據已推翻的待辦；效能報告只有當時版本／網路／資料量的量測。沒有原始樣本的 production 結論，本輪只能確認程式路徑與歷史敘述的邊界，不能重新保證事件屬實。

本輪已在原文件頂部加入日期、現況更正、證據及未驗項目，保留當時的觀察與版本；不將過去的測試數量改成今日數字。JSON 基準保持原樣。master flow 也不能視為無條件的事實來源：先與實際程式／設定交叉核對，再同步更正。

| 原文件 | 現況判定／已對齊內容 |
| --- | --- |
| [OrderStatus surface audit](2026-04-09-orderstatus-surface-audit.md) | 歷史遷移盤點。舊引用數、數字 enum、已刪除 advanced session 不再是現況；字串 tuple、契約 enum 與 lazy wrapper 已有測試證據 |
| [店家後台 QA](2026-09-01-admin-dashboard-flow-qa.html) | 當時走查可保留；18 個舊节点不涵蓋後增開通與首次設定，已補現況與驗證限制 |
| [Worker cold start](2026-09-12-worker-cold-start-323.md) | 歷史效能實驗。未重測 startup，TTFB 殘差歸因是推論；契約 lazy wrapper 的舊缺口已修 |
| [Connection closed](2026-09-12-connection-closed-325.md) | 當時未重現，不能排除所有時間的 Worker／網路問題。保留 view-count 修復證據；SSE cancel 留存 timer 已重現 |
| [顧客流程 QA](2026-09-15-customer-app-flow-qa.html) | 寄信未配置、會員點餐阻塞、列印未測等舊待辦已有後續證據；訂位 module gate 與 production 外部驗收仍須分開 |
| [顧客 readiness QA](2026-09-18-customer-app-readiness-qa.html) | 不再把 09-23 issue／部署／空資料當今日狀態；已補會員、候位與服務付款條件的目前證據 |
| [現場流程 QA](2026-09-22-floor-operations-flow-qa.html) | 舊阻塞必須對照 09-30 本機實走及目前程式；不能因 unit 通過宣稱四端同步或真印表機可用 |
| [Placement baseline](2026-09-22-worker-placement-369-baseline.md) | 歷史 baseline 算術可重算，不能當最新路由或延遲 |
| [Placement JSON](2026-09-22-worker-placement-369-baseline.json) | 保留原始 105 個樣本；新增 runnable check，12 個 percentiles 與 90 個 measured SIN 樣本一致 |
| [Email Service](2026-09-27-email-service-routing-resend.md) | 目前程式／設定支持 Cloudflare 寄信與失敗人工交付；帳戶、DNS、收件匣是當時證據，未重新實測。官方費率／限制已重新查核 |
| [現場本機實走](2026-09-30-floor-operations-local-walk.html) | 保留真後端＋TCP ESC/POS 的歷史證據；收據／廚房模板與 POS 後續修正另補最新判定 |
| [Issue 431](2026-09-30-issue-431.md) | 案例與原測試紀錄保留；補最新嚴格整合驗證與 auth fixture 限制 |
| [上線前提 425](2026-10-01-customer-launch-prerequisites-425.md) | production secrets／資料是 10-01 快照，未於今日重查；本機程式與測試不能代替 VAPID／金流／正式資料決策 |

master flow 已升為 v1.3：自動開通信與失敗人工交付、`partial_refunded`、付款服務負責 `paid`、租戶備份 Cron 停用，員工／會員／訪客身份分離、送菜排序／輪詢，以及部署契約／外部驗收限制。

## 平行補查與新增驗證

三組 subagents 分別補顧客、店務、現場／平台；主 agent 補共通健康、寄信、契約、搜尋、QR 與效能證據。

- 測試 JWT fixture 原先沒有 sessions 紀錄，與目前認證不符。已讓 DB-backed fixture 建立有效 session，保留 revoked token 不可重新啟用；新增真 D1 測試要求 `/auth/me` 成功、撤銷後 401。沒有放寬 production 認證。
- 顧客候位 E2E 的匿名讀回前提已與票券授權規則不符；改用授權讀回並驗證匿名／錯誤 capability 被拒絕。
- 新增 SSE／部署 expected-failure checks，並重跑工作區現有備份 expected-failure check，追蹤 SSE reader cancellation、scheduler 未保存 backup record、批次部署忽略失敗結果。**expected fail 是缺陷重現，不是功能驗收通過。**
- 新增 baseline 算術回歸，避免文件與原始量測摘要漂移。

顧客補查 30 檔／490 項 focused tests 通過；隔離真後端 customer-real 29/29 通過，零 retry／skip／expected fail。店務真 D1 10 檔／55 項通過；市集真 D1 4 檔／61 項通過。各 batch 有重複，不加總為唯一 coverage。另有同時更新的 [顧客補查稿](2026-10-04-customer-flow-verification.md) 與 [店務／現場補查稿](2026-10-04-operations-flow-verification.md)，已加入後續重跑結果，避免較早 fixture 失敗快照再次漂移。

完整領域證據見各文件的 2026-10-04 區段及 [平台補查](2026-10-04-platform-flow-verification.md)。以下為主 agent 已執行且可重跑的補查：

```sh
pnpm --dir apps/api exec vitest run src/features/menu/routes/index.test.ts src/features/menu/schemas/validation.test.ts src/core/health/probe.test.ts src/app-factory.middleware-order.test.ts
# 4 files / 104 passed
pnpm --filter @makanmasak/database exec vitest run src/services/NotificationService.test.ts
# 1 file / 6 passed; provider binding controlled, not inbox delivery
pnpm exec vitest run tests/unit/check-api-contracts.test.ts --project=root
# 1 file / 19 passed
pnpm exec vitest run tests/unit/worker-placement-baseline.test.ts --project=root
# 1 file / 1 passed
pnpm --dir apps/api test:real-integration src/__tests__/integration/discovery.real.integration.test.ts src/__tests__/integration/qr-codes.real.integration.test.ts
# 2 files / 72 passed; local Miniflare D1, not production Queues/Vectorize
pnpm --dir apps/api exec vitest run src/features/analytics/routes/index.test.ts
# 10 passed / 1 expected fail; cancel leaves 3 timers rather than 0
```

搜尋補查涵蓋公開搜尋、可見性／市集過濾、菜單與分類異動後索引更新；QR 補查涵蓋公開市集 slug 與停用市集拒絕。這不是所有 QR 簽章／重放／汰換、Queue 重試或 Vectorize 一致性的完整驗收。

## 仍須驗證的缺口與優先順序

| 優先 | 缺口 | 本輪進度／完成條件 |
| --- | --- | --- |
| P0 | scheduler 回覆成功但未持久化，排程又停用 | 已重現並保留 expected fail；統一 feature／scheduler 服務後，須實際匯出至隔離 R2、完整／選擇性還原、故障中斷與跨店隔離，記錄 RPO／RTO |
| P0 | 平台部署入口欄位不符、失敗被當完成 | 已核對前後端契約、重現批次失敗誤判；修復後驗 canary 停止、部分失敗、回滾及 migration 版本相容性 |
| P1 | SSE 取消不清 polling timer；廚房 async write rejection | analytics timer leak 已重現；尚須斷線、rejected write、重連與資源釋放證據 |
| P1 | 送菜今日清單、權限與分頁 | 現況以 createdAt／delivered 篩選，未涵蓋跨午夜建單或付款後 paid；店主可進頁但 claim 僅允許 0／3，清單僅第一頁。須補跨日／時區、付訖後、超過 page size 與店主代送的嚴格回歸 |
| P1 | 四端同源／列印端到端 | 既有本機實走與 focused tests 可保留；須同一訂單跨顧客／廚房／送菜／收銀並行、重連／漏事件／重複事件／多裝置 refresh，以及實機紙張與編碼驗收 |
| P1 | 第三方金流、跨攤分帳／退款及 credits | 本機 guard／金額／對帳測試不等於供應商驗收；需已配置 sandbox 的簽章、webhook 重放／乱序／timeout、逐攤退款與真實分帳核對 |
| P1 | Email／OTP／Web Push／Slack 送達 | binding、流程與失敗處理有測試；缺目前真收件人、VAPID、裝置權限與背景叫號、供應商拒送／降級行為實測 |
| P1 | 租戶停用、授權到期與配額 | service／route 可達測試不足；需各產品與角色實際拒絕存取、續約恢復、並發配額與跨租戶 boundary 矩陣 |
| P2 | 店主人事、支援、AI 洞察、設定完整瀏覽器路徑 | 部分服務與頁面測試存在；需串起排班→出勤→請假審核→餘額、工單雙向回覆及設定保存／重新登入 |
| P2 | 搜尋 Queue／Vectorize、外送平台同步 | 本機搜尋索引補查已通過；尚未提供真 Queue delivery／重試／刪除與售罄一致性、向量更新或外送供應商往返證據 |
| P2 | 今日 production readiness 與網路效能 | 正式 secrets 名稱、模組／資料／QR、部署版本仍需重查；MY/SIN 歷史樣本不能代表 HiNet／Tokyo A/B／尖峰負載 |

以上缺口是「證據仍不足」或「本輪已重現缺陷」，不能一律推論成產品未實作。需外部帳戶、正式資料決策、實體設備或部署窗口的項目，本輪未執行；沒有用程式碼存在、寬鬆 smoke 或測試綠燈代替它們。

## 查證限制

使用 codebase-memory Tier 2，所有引用的程式路徑另查 index coverage；parse_partial 的 menu route test 宣告直接讀取。graph 可提供呼叫關係，無法證明外部送達、目前部署、完整覆蓋率或沒有其他缺陷。歷史 GitHub issue 狀態未重新查詢，不據舊 open／closed 欄位宣稱今日狀態。
