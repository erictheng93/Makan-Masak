# 正式介面優化與驗收

使用者於 2026-11-11 核准提案後，已套用到五個前端的 113 個來源頁面。正式介面提交為 `099113379`，菜單底部留白修正為 `256ccadb4`。保留原有路由、權限、API 與金額計算，沒有新增套件、推送或部署。

開啟 [逐頁前後對照](production-review.html)，可搜尋頁面、切換桌面與手機及頂部／底部，查看真正 Vue 元件的修改前後畫面。此 HTML 使用相鄰圖片資料夾；分享或搬移時請保留整個 `design-review-2026-11-11` 目錄。原核准提案 [preview.html](../preview.html) 保持不變。

## 範圍與結果

| 前端     | 頁面 | 桌面／手機擷取 | 前端測試 |
| -------- | ---: | -------------: | -------: |
| 顧客點餐 |   31 |             62 |      904 |
| 餐廳後台 |   60 |            120 |     1174 |
| 廚房看板 |    7 |             14 |      184 |
| 平台管理 |   10 |             20 |       56 |
| 開店申請 |    5 |             10 |       58 |
| 合計     |  113 |            226 |     2376 |

- [畫面檢查](production-checks.json)：226/226 通過，無記錄到的頁面橫向溢出、過小控制項、無名稱按鈕、破圖或 JavaScript 錯誤。每個頁面檔案的來源雜湊皆與正式提交相符。
- [操作檢查](interaction-checks.json)：78/78 通過。涵蓋兩種尺寸的點餐入口、菜單與購物車、底部操作區留白、管理選項對話框、廚房設定、授權對話框、開店表單，以及手機語言選單、長員工識別資料換行。另驗證餐桌／店家菜單捲到底後最後商品按鈕未被浮條遮擋，且可開啟選項或更新購物車。對話框包含初始焦點、Tab、Escape 和關閉後返回原控制項。
- [逐頁下捲檢查](scroll-checks.json)：226/226 通過，264 個可捲動區域均可到達底部，記錄 642 次分段下捲及水平表格／分頁列的左右捲動。另存 226 張捲到底部後的可見畫面，避免長截圖造成固定導覽列位置失真。每頁初始三次 Tab 僅作探索記錄，並非完整鍵盤無障礙驗證。
- 獨立 [原始碼審查](code-review.md) 與 [視覺驗收](visual-acceptance.md) 的阻擋項目均已修正並複查，包括探索頁重試、廚房語言選單裁切、長員工資料及監控卡片裁切。
- 整體介面修改的 `pnpm verify`：35/35 工作通過；最後菜單修正另重跑受影響範圍，20/20 工作通過；五前端建置：9/9 相依工作通過；本機真實整合測試：11/11 工作通過。
- API 一般測試為 3634 通過、1 個既有預期失敗；API 真實整合測試為 936 通過、1 個預期失敗、2 個略過、1 個待辦。這些狀態沒有被隱藏或改成成功案例。

## 驗證限制

畫面取自正式元件與隔離本機範例回應；94 張使用範例資料，132 張含未提供的 API 回應，對應原有空、錯誤或離線狀態。後者不能證明該頁的完整正常資料流程。操作檢查覆蓋上述明列流程，沒有宣稱 113 頁每一個業務分支都已完成端到端測試，也沒有操作線上付款、修改員工或寫入正式資料。

自動尺寸檢查不能取代人工視覺驗收；例如監控卡片的內層裁切由人工檢視發現並修正。驗收是可追溯的設計與操作證據，不是設計獎項認證。

## 重現

本機既有 SQLite 套件需要 ABI 137，使用已安裝的 Node 24.22.1；系統預設 Node 26 的 ABI 147 不相容。沒有為此重建或更換相依套件。

```sh
env PATH=/opt/homebrew/opt/node@24/bin:$PATH NODE_OPTIONS=--no-experimental-webstorage TURBO_CONCURRENCY=3 pnpm verify
env PATH=/opt/homebrew/opt/node@24/bin:$PATH NODE_OPTIONS=--no-experimental-webstorage pnpm exec turbo run build --filter=makanmasak-customer-app --filter=makanmasak-admin-dashboard --filter=makanmasak-kitchen-display --filter=@makanmasak/management-portal --filter=makanmasak-onboarding-app --concurrency=2
NODE_OPTIONS=--no-experimental-webstorage TURBO_CONCURRENCY=2 VITEST_MAX_WORKERS=2 pnpm test:real-integration
pnpm run check:design-palette
```

瀏覽器檢查使用現有 Playwright。先以 `pnpm --dir apps/<app> exec vite --host 127.0.0.1 --port <port> --strictPort` 啟動五個前端，依表格順序使用 4410–4414，再執行：

```sh
node docs/design-review-2026-11-11/implementation/check-production-ui.cjs
node docs/design-review-2026-11-11/implementation/check-flows.cjs
REVIEW_SCROLL=1 node docs/design-review-2026-11-11/implementation/check-production-ui.cjs
node docs/design-review-2026-11-11/implementation/build-contact-sheets.cjs
REVIEW_SCROLL=1 node docs/design-review-2026-11-11/implementation/build-contact-sheets.cjs
node docs/design-review-2026-11-11/implementation/build-production-review.mjs
```

對照頁另以本機 4320 提供：`python3 -m http.server 4320 --bind 127.0.0.1 --directory docs/design-review-2026-11-11`。所有攔截資料只存在驗收工具，不會打包到正式應用。沒有儲存使用者提供的測試密碼。

各前端逐項處置見 [顧客報告](customer-report.md)、[餐廳後台報告](admin-report.md)、[廚房／平台／開店報告](other-apps-report.md)。
