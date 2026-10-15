# Issue #441 菜單供應即時同步驗收

選項 B；使用 Native 在目前 checkout 實作。基準 `c05d2faad20d224296221fb9c9736ec4aa3558e5`。
本地四個畫面使用真實 API、D1、Worker/DO 與 WebSocket；未注入假的回應或事件。
遠端尚未推送，issue 保持開啟；整合須依 AGENTS.md 取得明確推送授權。

## 驗收結果

- 單筆 PUT、批次 PATCH、經理 POST：各售完／恢復，共六次成功；兩個顧客菜單、後台卡片與廚房供應 toast 同步。
- 顧客購物車保持原有項目，四頁文件未重載。
- 顧客及後台實際關閉業務 WebSocket，離線期間修改供應，重新連線 ACK 後補讀最新狀態。
- Kitchen 庫存 0 視為停止供應；庫存 null 保留無限制供應語義。
- 真實 D1 5/5：三入口提交後通知、批次後續失敗完整回滾、跨店／刪除菜品／轉店拒絕、非公開餐廳 token 拒絕。
- Worker/DO 安全測試涵蓋 scope、過期、跨店、private 事件隔離與 subscription 限制。
- 獨立整體審查：已完成；0 Critical、3 Important、0 Minor。三項 Important 全部 RED→GREEN 修正，無延後項目。

## 實際驗證指令

```sh
E2E_STRICT=1 E2E_REALTIME_URL=http://localhost:8798 E2E_KITCHEN_URL=http://127.0.0.1:3002 pnpm exec playwright test --project=customer-real tests/e2e/customer/menu-availability-realtime.spec.ts --workers=1 --trace=on
pnpm --filter @makanmasak/api exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/menu-availability.real.integration.test.ts
pnpm --filter makanmasak-kitchen-display exec vitest run src/views/EnhancedKitchenDashboard.test.ts src/services/realtimeService.test.ts
pnpm lint:fix
pnpm run check:design-palette
pnpm run check:i18n-locales
pnpm run typecheck:tests
pnpm contract:check
pnpm verify
```

相關單元測試通過（各 workspace 全量，與 `pnpm verify` 以 `TURBO_SCM_BASE=c05d2faad` 為範圍的 245 個 API/realtime 等受影響測試口徑不同）：API 249、realtime 93、customer 354、admin 17、kitchen 6、database menu 39、root CORS 1。
D1 5/5；瀏覽器 strict 1/1，沒有 skip。截圖與 trace 保留在本地 `.superpowers/acceptance/issue-441/playwright-report/` 及 `test-results/` 副本，另存驗證日誌。trace 僅供本地查核，未上傳。
受影響七個 workspace 的明確 typecheck/lint：19 個 Turbo tasks 全數成功；API/realtime dry-run 與三個前端 build：10 tasks 全數成功。
廚房庫存提示修正後，另重跑 kitchen typecheck、lint、build 及 6 個測試，均通過。
Prettier check 與 git diff --check 通過。

`pnpm verify` 因當前 main 比較自己選中 0 tasks，不能作為測試通過證据；因此補跑上述明確 workspace 檢查與相關測試。
完整無關 suite、production 及遠端 CI 未列為通過。
本地 realtime 改用 8798（8788 已佔用），API 8787、customer 3000、admin 3001、kitchen 3002。簽章金鑰僅供本地驗收。

## 已完成提交

- `82422ada0` 公開 menu 房間與受限 token。
- `16da2cadf` 三入口通知、快取與原子批次。
- `9f0614c59` 顧客即時補讀與生命週期處理。
- `e13370c49` 後台與廚房接收。
- `ce2ff6bb7` 真實串接驗收與必要防護。
- `904ef2f58` 獨立審查後的三項一致性修正。

## 審查修正與限制

只進行一次獨立審查與一次修正；沒有重新派出審查者。

1. 單筆與經理寫入：D1 transaction 內讀取寫入前供應值，與 RETURNING 值比較；同值不通知，舊 prefetched snapshot 不再漏掉恢復通知。真實 D1 regression 先失敗，修正後 5/5 通過。
2. 後台 event/reconnect GET：使用現有 Cache-Control no-cache 協定避開重新被舊請求填入的 query cache；admin regression 先回傳舊狀態失敗，修正後 17/17 通過。
3. QR 桌台驗證：保留驗證期間收到的 fresh intent，第一個有效 menu GET 會補讀；驗證 gate 保留。regression 先 fresh:false 失敗，修正後 customer 354/354 通過。

修正後 API 249/249、database 39/39；四個受影響 workspace typecheck/lint 13 tasks 及 bundle build 8 tasks 通過；測試型別與格式通過。
最後 strict 瀏覽器 1/1（26.7s，0 skip），含六次供應寫入、購物車保留、顧客／後台實際重連 ACK、無 token 握手拒絕。
並行建置期間一次廚房網址回傳其他本地服務的 404；確認本專案服務後用明確 127.0.0.1 網址驗收通過，沒有修改產品程式來迴避環境問題。
未新增依賴、alarm、事件歷史或 production migration。

## 結案條件

- [ ] 使用者明確授權推送
- [ ] 遠端 CI 通過
- [ ] issue 補上遠端 commit／PR 連結
- [ ] 關閉 issue #441

證據（trace、截圖、日誌）僅存於本地 `.superpowers/acceptance/issue-441/`，未納入版本控制；遠端審查以上方指令重跑為準。

## 部署前檢查清單

本次無新增 secret、binding、Durable Object migration 或 D1 migration；menu token 沿用既有 `realtimeJwtSecret`，快取失效沿用 `CACHE_KV`。

- [ ] main 的 `test.yml` 為綠
- [ ] production 的 API 與 realtime 使用同一把 `realtimeJwtSecret`（`wrangler secret list --env production` 確認）
- [ ] production API 已綁定 `CACHE_KV`（未綁定不會壞，但供應變更後菜單快取不會被主動清除）
- [ ] GitHub `production` environment 已設定 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`（近三次 workflow 部署皆因此失敗，見下）
- [ ] 部署順序：`apps/api`、`apps/realtime` 先，`/info` 正常後再部署 customer-app、admin-dashboard、kitchen-display
- [ ] 上線冒煙：後台售完／恢復，另一瀏覽器顧客菜單即時更新且購物車保留；無 token 連 `/menu/:restaurantId` 被拒；他店 token 被拒
