# 流程文件層（Flows）

> 這一層回答的是「**這條流程實際怎麼跑、會在哪裡壞**」。
> 上面一層是 [master user flow 全景板](../architecture/master-user-flow.html)（誰、有哪些流程、怎麼串），
> 下面一層是各功能的 [specs/](../specs/)（某一次設計決策的來龍去脈）。

---

## 0. 為什麼要有這一層

全景板一格只放得下兩行標籤，回答不了「掃到過期 QR 會怎樣」「送單當下庫存歸零會怎樣」。
功能 spec 只涵蓋「有做過改動的功能」——收銀、送菜、廚房、出單、入駐審核從來沒有專屬 spec。
`testing/personas.md` 有風險條目，但它是**角色 × 模組**切法，而且開宗明義說「文件可以超前於現況」，
不保證跟實作一致。

所以缺的是一層**以流程為單位、逐步對照實際端點與狀態、承諾與程式碼同步**的文件。就是這裡。

| 層級 | 位置 | 回答什麼 | 與實作的關係 |
| --- | --- | --- | --- |
| 系統組成 | [architecture/system-architecture.html](../architecture/system-architecture.html) | 系統由哪些東西組成、誰綁了什麼資源 | 對齊現況 |
| L0 全景 | [architecture/master-user-flow.html](../architecture/master-user-flow.html) | 有誰、有哪些流程、怎麼串 | 對齊現況 |
| **L1 流程** | **本目錄** | **逐步怎麼跑、分支在哪、會怎麼壞** | **對齊現況，含已知缺口** |
| L2 規格 | [specs/](../specs/)、[superpowers/specs/](../superpowers/specs/) | 某次改動的決策、資料模型、驗收條件 | 寫作當下的快照 |
| 風險視角 | [testing/personas.md](../testing/personas.md) | 角色 × 模組的風險與應測行為 | 刻意超前於實作 |
| 測試落點 | [testing/CORE_WORKFLOW_TEST_MATRIX.md](../testing/CORE_WORKFLOW_TEST_MATRIX.md) | 哪一種驗證放哪一層 | 對齊現況 |

---

## 1. 索引

分組與 master board 的泳道 1:1 對齊。

### 訪客／未登入

| 流程 | 文件 |
| --- | --- |
| 進入入口 → 身分驗證 → 進入門戶 | [00-visitor-entry-and-auth.md](./00-visitor-entry-and-auth.md) |

### 顧客端（Customer App，role 5 ／ 訪客）

| 流程 | 文件 | 細節圖 |
| --- | --- | --- |
| 點餐主流程 | [01-customer-ordering.md](./01-customer-ordering.md) | [board](./boards/customer-ordering.html) |
| 訂單追蹤流程 | [02-customer-order-tracking.md](./02-customer-order-tracking.md) | [board](./boards/order-status-chain.html) |
| 座位與預約流程 | [03-customer-seating-and-booking.md](./03-customer-seating-and-booking.md) | — |
| 揪團與夜市市集流程 | [04-customer-group-and-market.md](./04-customer-group-and-market.md) | [board](./boards/market-checkout.html) |

### 店家後台（Admin Dashboard，role 1）

| 流程 | 文件 |
| --- | --- |
| 店務主流程 | [05-merchant-store-operations.md](./05-merchant-store-operations.md) |
| 營運管理流程 | [06-merchant-operations-management.md](./06-merchant-operations-management.md) |
| 人事流程 | [07-merchant-workforce.md](./07-merchant-workforce.md) |
| 分析與設定 | [08-merchant-analytics-and-settings.md](./08-merchant-analytics-and-settings.md) |

### 現場作業（Kitchen · Service · Cashier，role 2／3／4）

| 流程 | 文件 | 細節圖 |
| --- | --- | --- |
| 廚房流程 | [09-floor-kitchen.md](./09-floor-kitchen.md) | — |
| 送菜流程 | [10-floor-service-crew.md](./10-floor-service-crew.md) | — |
| 收銀流程 | [11-floor-cashier.md](./11-floor-cashier.md) | [board](./boards/payment-and-refund.html) |
| 出單與列印流程 | [12-floor-printing.md](./12-floor-printing.md) | — |

### 平台管理（Admin Dashboard 平台區 · Management Portal，role 0）

| 流程 | 文件 |
| --- | --- |
| 入駐流程 | [13-platform-onboarding.md](./13-platform-onboarding.md) |
| 租戶與授權管理 | [14-platform-tenants-and-licensing.md](./14-platform-tenants-and-licensing.md) |
| 平台營運流程 | [15-platform-market-operations.md](./15-platform-market-operations.md) |
| 監控與稽核 | [16-platform-monitoring-and-audit.md](./16-platform-monitoring-and-audit.md) |

---

## 2. 每份文件的固定結構

新增流程請複製 [`_template.md`](./_template.md)。八個小節，順序不要改：

1. **定位** — 一段話講清楚誰在跑、跨哪些應用、解決什麼。
2. **觸發與前置條件** — 進入點、必要角色、模組開關、資料前提。
3. **Happy path** — 逐步表格：動作 → 端點／程式 → 狀態變化。**每一步都要標端點或檔案路徑**，不能只寫「送出訂單」。
4. **主要分支** — 合法但非主線的走法（外帶 vs 內用、現金 vs 線上）。
5. **Edge cases 與失敗模式** — 表格：情境 → 系統行為 → 錯誤碼 → 風險等級。
6. **併發與競態** — 樂觀鎖、idempotency key、雙裝置、webhook 重送。
7. **對應程式碼與測試** — 檔案路徑清單，方便改動時回頭更新本文件。
8. **已知缺口** — 現在真的沒做的事。**這一節寫實話，不要寫成 roadmap。**

### 風險等級沿用 personas.md

| 等級 | 定義 |
| --- | --- |
| 🔴 P0 | 金流錯誤、資料遺失、權限繞過、訂單狀態錯亂、不可逆損害 |
| 🟠 P1 | 核心流程中斷，但可恢復 |
| 🟡 P2 | 明顯體驗退化，有 workaround |
| ⚪ P3 | 邊緣、低頻、低商業衝擊 |

---

## 3. 維護規則

- **改流程就改這裡。** 動到訂單狀態機、付款、權限邊界、狀態欄位的 PR，應同時更新對應流程文件的 Happy path 或 Edge cases。
- **每份文件標「最後對照原始碼」日期。** 沒對照過就不要改日期。
- **Edge case 一律要有出處。** 寫得出錯誤碼或程式碼行的才寫進表格；只是擔心但程式裡沒有對應處理的，放到「已知缺口」。
- **不重複 personas.md。** 那邊是風險清單，這邊是流程真相；同一件事在這裡要寫成「在第幾步、會回什麼」。
- **不重複 spec。** 決策理由留在 spec，這裡只寫現在的行為，需要理由時連過去。
