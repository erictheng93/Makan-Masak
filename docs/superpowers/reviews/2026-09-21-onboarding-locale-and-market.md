# 入駐地區與市集實作稽核紀錄

基底：`bf0a5b8a`（本機 `origin/main`）。實作工作目錄：
`/Users/eric/Documents/Code/Makan-makan-onboarding-locale`。
原始主工作目錄的未提交變更未納入。依使用者後續指示完成 atomic commits 並推送；沒有部署或寫入 production。

Task 1 已由先前試作 `a1aecec2` 完成；本次只重驗 11/11，未宣稱親自觀察原試作 RED。

| Task | Commit | 實際 RED | GREEN / 檢查 |
| --- | --- | --- | --- |
| 2 | cbfbd779, cad65568 | country_code undefined，1失敗/5通過 | 結構6/6、DB typecheck、雙軌/STRICT守門、本機migration |
| 3 | 5c094257 | SQLite no such column: country_code | migration regression1/1，本機0014與pragma三欄位 |
| 4 | d5926eed | 8行為失敗：錯誤地點仍201、新欄位丟失 | focused10/10、management86/86、typecheck/lint |
| 5 | a32f83a8 | 5/7失敗：空樁、篩選、分頁、未登入 | focused14/14、management94/94、typecheck/lint |
| 6 | 282f57e2 | MY實際列country/settings NULL，timezone Taipei | focused33/33，MY/TW SQL持久化、legacy無國別零寫入、typecheck |
| 7 | 9bad9319, 0288f0b4, ec6e3549 | 原2/5失敗(200而非400)、stale write1失敗、空字串/空格6失敗、tab/newline/NBSP3失敗 | real D1 15/15、API unit16/16、DB unit11/11、API兩tsconfig、DBtypecheck |
| 8 | 5ed1f272 | helper2失敗；已選市集開通後request不存在 | unit2/2、management SQL integration18/18、FK回滾/重試、typecheck |
| 9 | eb927338, 15a4b9bc | real D1 原4/5失敗；deep encoding1失敗；vendor101兩個500失敗 | Task7+9 real D1 30/30、既有市集40/40、APIunit33、DBunit12、API兩tsconfig |
| 10 | ec78f039 | 10個表單行為失敗；101筆市集只取得100筆 | onboarding30/30、typecheck/lint/build、六語系/色票檢查 |
| 11 | e38009de | admin缺地點/checkbox/部分失敗提示；HTTP列表缺地點projection | admin23/23、management SQLite integration18/18、兩端typecheck |
| 12 | 0e388f23, 7923aec5 | 缺SQL檔案；JSON null幣別未回填 | SQLite regression1/1、root測試typecheck、本機Wrangler兩店回填/跳過不相容資料/重跑冪等 |

每個 task 都有獨立實作及審查報告，保留於本機
`.superpowers/sdd/2026-09-20-onboarding-locale-and-market/`。
`task-N-report.md` 記載命令、RED/GREEN輸出與commit，`task-N-review.md` 記載審查。
Management integration 使用真實SQLite與D1 adapter；API real integration 使用Miniflare/D1。

## 與原規劃的差異

- 平台 `0027` 已被 `0027_guest_coupon_identity.sql` 使用，國別欄位使用 `0028_restaurant_country_code.sql`；控制面仍是 `0014`。
- Task2/3依使用者要求改為測試先RED，並補Task3遷移回歸測試。
- `/markets` 亦修正公開讀取路由、完整篩選、真實total及分頁邊界。
- 幣別鎖在實際DB寫入條件再檢查，防止並行請求或舊JSON設定合併改寫已有訂單的幣別；SQL空白規則與JS一致。
- 回填只處理台中且幣別相容的未知國別列，避免原範例無條件將所有NULL國別改為TW。

## 部署順序

平台0028與控制面0014 → API → management-api → onboarding-app/admin-dashboard → 審核後的production回填。
management-api必須早於onboarding-app，否則舊API會忽略新countryCode。

## 總審與實際流程

子代理完成實作及分項審查後，由主代理完成總審。查出的新增查詢未使用
schema reference 問題已於 `525d89b1` 修正並重新審查：保留實際寫入時的
原子幣別條件、NULL-safe比較、100個綁定參數上限及持久化店家關聯。
重跑 API Miniflare/D1 30、management SQLite/D1 adapter 18、API unit33、
DB unit12、management unit39，全數通過。這次純重構沒有宣稱新的行為 RED。

完整檢查另找出既有 PartnershipService 手工 fixture 缺 country_code，
先觀察2失敗/9通過，再以 `735d3246` 同步 fixture 後11/11通過。

本機瀏覽器（Chromium、真實兩支Worker與D1）驗證：

- MY → Kuala Lumpur → 市集 → A12 送出201；國別切換清除相依選項，空國別不能送出。
- 核准但不勾市集：country_code=MY、currency=MYR、timezone=Asia/Kuala_Lumpur，request pending、membership為0。
- 店主完成設定密碼並登入，總覽金額為RM，菜單價格輸入step=0.01。
- 另一筆申請遇到TWD市集：店家仍開通，市集核准409；畫面顯示原因與重試，重新載入仍可重試。
- 移除刻意建立的本機衝突fixture後，兩筆市集核准皆200；資料列approved、A12、每店一個owner、一個有效membership及一個原setup token，沒有重建憑證。已使用設定密碼連結的第一筆仍可核准。
- 入駐與審核畫面在320/768/1024/1440寬度無水平溢出，檢視窄版提示及操作控制。

新增路徑不採信客戶端幣別/時區；申請API依單一國別來源驗證城市與有效市集，
開通依 COUNTRY_PROFILES 推導設定，只有待核准申請；當場核准由管理端協調
既有兩支 authenticated API，仍經伺服器幣別守門。部分成功可重試且不重建帳號。
有訂單禁止改幣別；沒有訂單但已入市集也不能改成與其他成員不同的幣別。

審查非阻擋觀察：直接切換兩個非空市集會保留攤位文字，國別/城市/獨立店切換則清除；
既有申請狀態更新與membership寫入分開，重試會復用membership。未知或多重編碼的
不支援設定採拒絕核准，不猜成TWD。

## 驗證命令與證據

每個 task 的原始 RED/GREEN、命令及審查存於上述本機資料夾；以下列出
重現命令；上表保留觀察到的失敗，git commits 本身無法證明測試執行順序。記錄中的較早測試數量以最後一次重跑結果為準。
API real integration 是 Miniflare/D1；management integration 是 SQLite/D1 adapter。
正式production資料未動，Task12交付的是已測試的安全回填SQL。

最後完整成功的 API 覆蓋率執行（`7923aec5`，最後純schema reference重構前）：
265個檔案、3225個測試通過；lines **91.38%**、statements **90.64%**、
functions **93.2%**、branches **79.32%**，達成規劃lines90%/branches78%門檻。
命令（apps/api）：

```sh
pnpm exec vitest run --coverage.enabled --coverage.provider=v8 --coverage.reporter=json --coverage.reportsDirectory=../../.superpowers/sdd/2026-09-20-onboarding-locale-and-market/coverage-api-stable --coverage.include='src/features/**/*.ts' --maxWorkers=2
```

`525d89b1` 已完成上述受影響測試與型別檢查。本輪完整
`TURBO_CONCURRENCY=2 VITEST_MAX_WORKERS=2 pnpm verify:push` 在lint通過、
型別檢查進行中時，依使用者「不用執行完整 verify:push，直接推送 GitHub 跑 CI」
指示中止；不宣稱完整gate通過。最後版本覆蓋率重跑亦不作為推送前置條件，
完整最終驗證交由 GitHub CI。

各列均在指定目錄執行 `pnpm exec vitest run` 加上下列參數：

| Task | 目錄 | 測試參數 |
| --- | --- | --- |
| 1 | packages/shared-types | `src/locale.test.ts` |
| 2 | packages/database | `src/schema/schema-hardening.test.ts` |
| 3 | apps/management-api | `src/__tests__/onboarding-locale-market-migration.test.ts` |
| 4 | apps/management-api | `src/__tests__/onboarding-location.test.ts src/__tests__/onboarding-locale.test.ts` |
| 5 | apps/management-api | `src/__tests__/markets-list.test.ts src/__tests__/markets.routes.test.ts` |
| 6 | apps/management-api | `src/__tests__/onboarding-provisioning-locale.test.ts src/__tests__/onboarding-owner-id.test.ts` |
| 6, 8, 11 | apps/management-api | `--config vitest.real-integration.config.ts onboarding-workflow` |
| 7, 9 | apps/api | `--config vitest.real-integration.config.ts restaurant-currency-lock market-join-currency` |
| 8 | apps/management-api | `src/__tests__/onboarding-market-request.test.ts` |
| 10 | apps/onboarding-app | `src/views/ApplyView.test.ts src/services/api.test.ts` |
| 11 | apps/admin-dashboard | `src/views/PlatformOnboardingApplicationsView.test.ts src/services/onboardingApplicationsService.test.ts` |
| 12 | repository root | `--project=root tests/unit/backfill-restaurant-country.test.ts` |

API 型別命令 `pnpm --filter @makanmasak/api typecheck` 同時涵蓋
`tsconfig.json` 與 `tsconfig.test.json`。根目錄 `pnpm lint:fix` 已完成且未留下額外變更。

差異裁定另外包含：依使用者要求替migration與backfill增加先RED步驟；
以完整API驗證/篩選規格為準而不照抄不完整片段；一般設定的DB寫入也必須
鎖住幣別；已入市集無訂單店不能繞過一致性限制。Task11協調既有核准API，
代價是必須顯示部分成功與重試；Task12只回填可確認為台中且幣別相容的資料，
未知或不相容舊資料保留給人工確認。使用者明示授權剩餘任務平行處理及push，
各commit仍序列化，總審由主代理執行。
