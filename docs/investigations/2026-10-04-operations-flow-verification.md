# 店家後台與現場流程覆核 — 2026-10-04

## 最新補充（2026-10-04，session fixture 修正後）

下文的 POS 401 與「helper 沒有 session」是修正前結果，已由後續驗證取代：
DB-backed JWT fixture 現在建立 active sessions，並有 `/auth/me` 成功後撤銷轉 401 的真 D1 測試；
含兩份 POS suites 的 10 檔／55 測試已通過。精確命令見
[Issue 431 本機重新核對](2026-09-30-issue-431.md)。這不代表所有下列 P1／P2 均已修復。
目前 master 圖為 v1.3；送菜的優先級／readyAt 排序與 15 秒輪詢已對齊，
今日送達查詢、店主代送權限及分頁仍列為待驗／缺陷。下方原始失敗結果保留作歷程。


基準：[master-user-flow v1.2](../architecture/master-user-flow.html) 的「2. 店家後台」與「3. 現場作業」。範圍為目前工作目錄的原始碼、測試與五份歷史 investigation。未部署、未操作 production 資料，亦沒有核對 GitHub issue 當前開關狀態。工作目錄已有其他未提交修改，結果反映整份工作目錄，不能歸因於 HEAD 或本次文件修改。

## 文件是否屬實與過期

| 文件 | 覆核結果 | 對齊方式 |
| --- | --- | --- |
| 09-01 admin dashboard QA | 歷史發現與後續卡片有時間界線；09-15 的 #368「建單零引用」已過期。21 列全收掉不等於現在全部流程已驗收。 | 頁首加入本次更正；保留當日 production 證據與部署敘述。 |
| 09-22 floor operations QA | K1/P2/P3/D1/X2/S5 的現況已不同；「廚房走不通」「印不出任何東西」只能當歷史結論。S6 的角色落差仍存在。 | 頁首加入 current-source 覆核與本次測試限制。 |
| 09-30 floor local walk | W7/#431 與 W8/#432 有後續修正；「refresh 未測」本次補齊。標題說七項，實際 W1–W8 八項。 | 加入更正，保留本機 TCP 模擬驗證邊界。 |
| 09-30 issue #431 | 修正描述與現行促銷／shift／日報路由一致；歷史「真整合全綠」本次無法重現。 | 加入 dated 重跑失敗記錄；不覆寫歷史測試數。 |
| 04-09 OrderStatus audit | 已標歷史，但 manual `delivered → paid`、advanced DO lazy migration 與外部使用者結論容易誤用。 | 首段補充目前付款／退款路徑與證據邊界。 |

「屬實」在此只指目前可重新查證的 source/test 部分。原先 production 走查的 D1 快照、還原操作、部署 provenance 與 P99 沒有本次獨立重做，保留為當日紀錄而非新的事實宣告。

## 目前有證據的修正

- #368：`packages/database/src/services/order.ts` 的 `shouldAutoAcceptOrders` 讀取 `settings.autoAcceptOrders`。既有 `auto-accept-orders.real.integration.test.ts` 驗 guest order 確認、時間戳與廚房票，以及未設定／false 時不確認。
- K1：`KitchenService.ts` 的品項完成會經 `OrdersService.updateOrderStatus` 推進整單；沿用 CAS、時間戳、快取失效與廣播。`kitchen.real.integration.test.ts` 本次通過。
- P2/P3：`RefundService.ts` 已有 cashier 送審、owner/admin 核准、訂單累計退款與付款狀態回寫；關閉班次的退款走 adjustment，不變動已結班帳。這不等於本次端到端金流回歸成功；POS 真整合阻擋見下方。
- S5：`ServiceView.vue` 未接後端的回報入口已移除，`ServiceView.test.ts` 明確守住不存在該 action。功能被移除不等於「缺料／問題回報」已完成。
- #431：`features/pos/routes/index.ts` 已掛 `promotions`；收銀管理使用既有 shift cash movements／daily report，不再依賴原本不存在的 register 子路由。
- #432：`ReceiptFormatterFactory.ts` 只在有 invoice data 時印電子發票文案；`CommandBuilder.ts` 按 `content.type === "kitchen"` 建專用廚房內容；`print/utils/encoding.ts` 有 UTF-8／Big5／GBK。對應 formatter、commands、encoding 測試本次通過。真印表機字碼頁仍未驗證。
- OrderStatus：八個 canonical string 仍是 `pending/confirmed/preparing/ready/delivered/paid/cancelled/refunded`；人工狀態更新不產生 paid，付款服務才寫 `paid/completed`。退款不由 manual transition map 執行。

## 本次執行與新增驗證

```sh
pnpm exec vitest run apps/admin-dashboard/src/views/ServiceView.test.ts apps/admin-dashboard/src/views/CashierView.test.ts apps/api/src/features/pos apps/api/src/features/kitchen apps/kitchen-display/src/stores/orders.offline.test.ts apps/kitchen-display/src/services/offlineService.test.ts apps/print-agent packages/queue-core/src/print --maxWorkers=2
```

39 檔、377 項通過。含送菜 polling、claim 後重整、身分／店家切換、收銀元件、離線重放單元測試與列印 TCP／commands／formatter／encoding。這是單元／元件／局部傳輸證據，沒有把瀏覽器和三端 WebSocket 組合起來。

```sh
pnpm exec vitest run apps/admin-dashboard packages/database/src/services/order.test.ts packages/database/src/services/coupon.test.ts --maxWorkers=2
```

140 檔、1111 項通過。與上一個命令有重複測試，不應直接相加為唯一 coverage 數。

新增 `apps/api/src/__tests__/integration/operations-device-refresh.real.integration.test.ts`：兩次實際 staff login，使用各自 HttpOnly refresh cookie 和 CSRF double submit；先輪替第一台、再輪替第二台；第一台舊 cookie 401，兩台新 cookie 都可繼續刷新。測試通過，補足 09-30 明列的 multi-device refresh 缺口；不代表跨來源瀏覽器 cookie 政策或真 Cloudflare 已驗。

`pnpm --dir apps/api test:real-integration src/__tests__/integration/auto-accept-orders.real.integration.test.ts`：1 檔、3 項通過，#368 的 enabled／false／未設定三條 guest 下單分支均對真本機 D1 重驗。

```sh
pnpm --dir apps/api test:real-integration src/__tests__/integration/operations-device-refresh.real.integration.test.ts src/__tests__/integration/kitchen.real.integration.test.ts src/__tests__/integration/print-jobs.real.integration.test.ts src/__tests__/integration/pos-and-customer-roles.real.integration.test.ts src/__tests__/integration/pos-shift-report-tenancy.real.integration.test.ts
```

**5 檔：3 通過、2 失敗；40 項通過、17 項失敗。** 廚房、print dispatch 及新增 refresh test 通過。POS roles 與 shift tenancy 17 項於 register 建立前即 `401 TOKEN_INVALIDATED`，因此沒有跑到欲驗證的對帳／促銷／角色斷言。

根因有直接證據：目前 `middleware/auth.ts` 的 `authenticateStaffToken` 必須找到 `sessions` 的相同 user/token、active、未過期紀錄；共用 `helpers/issue-test-jwt.ts` 的 `issueDbBackedJwt` 只確保 users row，再簽 JWT，沒有建立 session。這是測試 fixture 與當前認證契約落差，不應解讀成 POS 對帳本身已被證明壞掉，也不能忽略失敗而宣稱全綠。共享 helper 超出本次分工所有權，留給主代理協調修正；不得把 auth 放寬來換綠燈。

## master flow 仍需驗證或與實作不一致

| 優先 | 節點／缺口 | 現有證據與下一個驗收 |
| --- | --- | --- |
| P1 | POS 真 D1 fixture 失配 | 修正共用測試身份產生器，保留有效 session；重跑兩個失敗檔後才能對 #431 提供當前回歸結論。 |
| P1 | 送菜「今日」不是 deliveredAt 查詢 | `ServiceView.vue` 只查 `status=delivered`，帶瀏覽器午夜 `dateFrom`；database order filters 套用 `createdAt`。昨晚建單今日送達會被排除；已收款轉 paid 的送達單也不在清單。需驗證店家時區、跨午夜、送達後付款及一日多頁。 |
| P1 | 三端同源即時與離線重連 | 有離線 unit 與廚房真 D1，但本次未做 browser→Worker→DO→KDS→service→customer 實際斷線重連。Service 目前每 15 秒輪詢而非即時訂閱；不能用 master 最後「即時廣播三端」代替實測。 |
| P1 | 合併桌單／真非現金退款 | 收銀頁以單筆選取付款；本次未證明 master 的「合併桌單」完整可達。現金與 raw TCP 不涵蓋卡／wallet、provider webhook、退款實際退回及帳務一致性。 |
| P2 | 待送清單「依桌號排序」 | 當前 `filteredOrders` 先 priority 再 readyAt；桌號是 filter，不是排序。需明確對齊產品順序，測 A2/A10、座位／外帶取餐檯與等待時間。 |
| P2 | 店主送菜 S6 | router 允許店主進 `/service`，但 `delivery-claim` 只允許 0/3。現況仍不一致；需界定店主可否代送並測允許／拒絕整條 UI 路徑。 |
| P2 | 大量 ready 訂單與今日統計分頁 | Service 只取 `/orders` 第一頁；已有測試守不把缺頁誤當 claim 消失，但沒有完整取回所有頁。需要超過 default page size 的真 API 及 browser 驗收。 |
| P2 | 廚房認領與缺料回報 | 本次廚房真 D1 驗狀態／timestamps，不足以證明兩台 KDS 同時認領、缺料→店主處理→顧客價格／退款一致性。不能把 S5 的入口刪除當成回報已完成。 |
| P2 | 店家後台十八節點的完整分支 | 既有 admin-real E2E 與 140 檔測試提供部分證據；本次未重跑完整 browser 套件，也未對每個選單的空資料、權限、錯誤及跨日分支逐一驗收。 |
| 外部 | 實體列印、紙張、切刀與中文 | raw TCP bytes 與 formatter/encoding 都不是實際紙張證據；需真設備、字碼頁、斷線／缺紙／卡紙與不確定已印後的重印策略驗收。 |
| 外部 | Production 版本、D1 migration、跨區與 P99 | 沒有新部署 provenance、遠端 migration 0035 狀態或真流量量測；舊「已上線」與本次本機通過不能推出目前線上全綠。 |

新增 test 補的是證據缺口；上述需要 runtime 行為／產品決策／外部設備的項目列為未完成，沒有偷偷修改產品邏輯或把未知寫成已通過。

## 證據可信度

使用 codebase-memory graph search／trace／snippet 與每個依據程式檔案的 coverage 檢查，並讀取相關 source。coverage 為 best effort，`no_recorded_issue` 不能證明完備；工作期間 graph 更新 generation 從 `2026-10-04T05:56:53Z` 至 `2026-10-04T06:10:16Z`。investigation 與 HTML 以實際檔案內容為證據。fixture 阻擋、未執行的 browser／production／hardware 部分皆保留限制，沒有推論為成功。
