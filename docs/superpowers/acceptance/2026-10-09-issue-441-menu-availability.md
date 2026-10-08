# Issue #441 菜單供應即時同步驗收

選項 B；使用 Native 在目前 checkout 實作。基準 `c05d2faad20d224296221fb9c9736ec4aa3558e5`。
本地四個畫面使用真實 API、D1、Worker/DO 與 WebSocket；未注入假的回應或事件。
遠端尚未推送，issue 保持開啟；整合須依 AGENTS.md 取得明確推送授權。

## 驗收結果

- 單筆 PUT、批次 PATCH、經理 POST：各售完／恢復，共六次成功；兩個顧客菜單、後台卡片與廚房供應 toast 同步。
- 顧客購物車保持原有項目，四頁文件未重載。
- 顧客及後台實際關閉業務 WebSocket，离線期間修改供應，重新連線 ACK 後補讀最新狀態。
- Kitchen 庫存 0 視為停止供應；庫存 null 保留無限制供應語義。
- 真實 D1 4/4：三入口提交後通知、批次後續失敗完整回滾、跨店／刪除菜品／轉店拒絕、非公開餐廳 token 拒絕。
- Worker/DO 安全測試涵蓋 scope、過期、跨店、private 事件隔離與 subscription 限制。
- 獨立整體審查：待完成。

## 實際驗證指令

```sh
E2E_STRICT=1 E2E_REALTIME_URL=http://localhost:8798 pnpm exec playwright test --project=customer-real tests/e2e/customer/menu-availability-realtime.spec.ts --workers=1
pnpm --filter @makanmasak/api exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/menu-availability.real.integration.test.ts
pnpm --filter makanmasak-kitchen-display exec vitest run src/views/EnhancedKitchenDashboard.test.ts src/services/realtimeService.test.ts
pnpm lint:fix
pnpm run check:design-palette
pnpm run check:i18n-locales
pnpm run typecheck:tests
pnpm contract:check
pnpm verify
```

相關單元測試通過：API 213、realtime 93、customer 353、admin 16、kitchen 6、database menu 39、root CORS 1。
D1 4/4；瀏覽器 strict 1/1，沒有 skip。截圖與 trace 保留在本地 `test-results/`。
受影響七個 workspace 的明確 typecheck/lint：19 個 Turbo tasks 全數成功；API/realtime dry-run 與三個前端 build：10 tasks 全數成功。
廚房庫存提示修正後，另重跑 kitchen typecheck、lint、build 及 6 個測試，均通過。
Prettier check 與 git diff --check 通過。

`pnpm verify` 因当前 main 比較自己選中 0 tasks，不能作為測試通過證据；因此補跑上述明確 workspace 檢查與相關測試。
完整無關 suite、production 及遠端 CI 未列為通過。
本地 realtime 改用 8798（8788 已佔用），API 8787、customer 3000、admin 3001、kitchen 3002。簽章金鑰僅供本地驗收。

## 已完成提交

- `82422ada0` 公開 menu 房間與受限 token。
- `16da2cadf` 三入口通知、快取與原子批次。
- `9f0614c59` 顧客即時補讀與生命週期處理。
- `e13370c49` 後台與廚房接收。
- 本次驗收提交與最終審查結果：待補記。
