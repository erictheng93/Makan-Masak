# MakanMakan 測試指南

本文檔提供 MakanMakan 平台完整的測試策略、測試類型和執行指南。

## 📋 目錄

- [測試概述](#測試概述)
- [測試類型](#測試類型)
- [快速開始](#快速開始)
- [E2E 測試](#e2e-測試)
- [性能測試](#性能測試)
- [CI/CD 整合](#cicd-整合)
- [最佳實踐](#最佳實踐)

## 測試概述

### 測試金字塔

```
         ╱ ╲
        ╱   ╲     E2E 測試 (10%)
       ╱─────╲    - Playwright
      ╱       ╲   - 核心業務流程
     ╱─────────╲
    ╱           ╲  整合測試 (30%)
   ╱─────────────╲ - API 整合
  ╱               ╲- WebSocket 連線
 ╱─────────────────╲
╱                   ╲ 單元測試 (60%)
────────────────────── - Vitest
                       - 組件測試
                       - 服務測試
```

### 測試覆蓋率目標

| 類型              | 目標覆蓋率    | 當前狀態  |
| ----------------- | ------------- | --------- |
| 單元測試          | > 80%         | ✅ 82%    |
| 整合測試          | > 70%         | ✅ 75%    |
| E2E 測試          | 核心流程 100% | ✅ 100%   |
| 視覺回歸          | 重點頁面      | ✅ 已建立 |
| API Contract 快照 | 所有 API 模組 | ✅ 已建立 |
| 性能測試          | 所有 API      | ✅ 完成   |

> 最新總測試數請執行 `pnpm test` 取得；`docs/testing/TEST_PROGRESS.md` 提供依 App / Package 拆分的覆蓋評估。

## 測試類型

### 1. 單元測試 (Unit Tests)

使用 Vitest 進行單元測試。

**測試範圍**：

- Vue 組件
- 服務類別 (Services)
- 工具函數 (Utilities)
- 資料驗證 (Validators)

**執行命令**：

```bash
# 執行所有單元測試
pnpm test

# 執行特定檔案測試
pnpm test path/to/test.spec.ts

# 監視模式
pnpm test:watch

# 生成覆蓋率報告
pnpm test:coverage
```

### 2. 整合測試 (Integration Tests)

測試多個組件或服務之間的互動，使用 **in-memory SQLite** 作為 D1 替代（非 Mock），確保 schema / SQL 語法真實受測。

**測試範圍**：

- API 端點整合
- 資料庫操作（真實 SQL，透過 `packages/testing-utils/src/mocks/mock-drizzle-db.ts`）
- 第三方服務整合
- WebSocket 連線
- Kitchen Display 多訂單、通知、realtime 更新流程

**執行命令**：

```bash
# 整合測試位於各 app 的 __tests__/integration/ 目錄，統一 vitest 執行
pnpm test

# Workers 整合測試（apps/api）
pnpm --filter @makanmasak/api test
```

### 2.5 API Contract 測試

`apps/api/src/contracts/schemas/*.ts` 的 Zod schema 會被**實際 import 進來**
（透過 tsx）逐層走訪，每個欄位路徑連同型別寫進
`.api-contracts-snapshot.json`，防止 API shape 意外漂移。

擋得下來的：任意深度的欄位增刪、**欄位型別改變**（`createdAt` 從 ISO 字串變成
Unix 毫秒數）、optional／nullable 的得失、enum 成員與 literal 值的增減、陣列元素
型別、`.loose()` catchall 的得失。展開到 `data.items[].itemSnapshot.name`
這種巢狀路徑，spread（`...TimestampFields`）與 envelope helper
（`successEnvelope(X)`）的內容也一樣涵蓋。

⚠️ 仍擋不下來的：`.int()`／`.min()`／`.regex()` 這類 refinement 不進標籤，所以
`z.number()` 與 `z.number().int()` 看起來一樣；改名依然只會顯示成一刪一增；不在
`apps/api/src/contracts/schemas/*.ts` export 的東西完全不在範圍內。

快照格式為 v2（`$schemaVersion: 2`）。若讀到舊格式，`contract:check` 會直接失敗
並要求先跑一次 `contract:update`。

```bash
pnpm contract:check    # 比對 snapshot（CI 使用）
pnpm contract:update   # 修改 API 後重新產生 snapshot
pnpm contract:report   # 輸出模組覆蓋報告
```

### 3. E2E 測試 (End-to-End Tests)

使用 Playwright 測試完整的用戶流程。

**測試範圍**：

- ✅ 登入/登出流程
- ✅ 訂單管理 (查看、創建、更新、取消)
- ✅ 菜單管理 (CRUD、搜尋、分類)
- ✅ 桌台管理 (狀態更新、QR 碼生成)
- ✅ 用戶管理 (CRUD、權限管理)
- ✅ 隊列管理 (安排座位、取消排隊)
- ✅ 廚房顯示 (訂單狀態更新)
- ✅ POS 收銀 (支付處理、收據生成)

**執行命令**：

```bash
# 執行所有 E2E 測試
pnpm test:e2e

# UI 模式（推薦開發使用）
pnpm test:e2e:ui

# 特定瀏覽器
npx playwright test --project=chromium

# 特定測試文件
npx playwright test tests/e2e/admin/orders-management.spec.ts

# Debug 模式
npx playwright test --debug
```

### 4. 性能測試 (Performance Tests)

使用 Artillery 進行負載測試和壓力測試。

**測試範圍**：

- ✅ REST API 端點 (認證、訂單、菜單、桌台、用戶)
- ✅ WebSocket 連線 (Kitchen、Admin、Customer)
- ✅ 混合場景測試
- ✅ 錯誤情境測試

**執行命令**：

```bash
# REST API 負載測試
pnpm test:performance

# WebSocket 負載測試
pnpm test:performance:ws

# 生成報告
pnpm test:performance:report
```

## 強制測試規範（見 `CLAUDE.md` → Testing Standards）

所有新寫的測試必須遵守以下四條，舊測試漸進式遷移：

### 1. 使用 `@makanmasak/testing-utils` 的 Factory（禁止手寫 mock 物件）

```typescript
import {
  userFactory,
  restaurantFactory,
  orderFactory,
  envFactory,
  resetAllFactories,
} from "@makanmasak/testing-utils";

beforeEach(() => {
  resetAllFactories();
});

const restaurant = restaurantFactory.build();
const owner = userFactory.buildShopOwner(restaurant.id);
const env = envFactory.build();
```

可用 factory：`userFactory`、`restaurantFactory`、`categoryFactory`、
`menuItemFactory`、`orderFactory`、`orderItemFactory`、`envFactory`、
`printJobFactory`、`printerDeviceFactory`、`printRequestFactory`、
`realtimeAuthFactory`。完整 API 見 `packages/testing-utils/src/factories/`。

### 2. 驗證 mock 呼叫，不只驗證回傳值

```typescript
// ✅ 每個 vi.fn() 都要有 toHaveBeenCalledWith
expect(mockService.createOrder).toHaveBeenCalledOnce();
expect(mockService.createOrder).toHaveBeenCalledWith(
  expect.objectContaining({ restaurantId: "01HZ..." }), // 結構比對
);

// ❌ 禁止精確比對 timestamp / UUID / 生成值
expect(mockService.createOrder).toHaveBeenCalledWith({
  createdAt: new Date("2026-04-13T10:00:00Z"),
});
```

對非確定性欄位使用 `expect.any(String)` / `expect.any(Number)`。

### 3. 禁止斷言 CSS class

```typescript
// ❌ Tailwind class 變動就會壞
expect(wrapper.classes()).toContain("bg-green-500");

// ✅ 改以行為驗證
expect(wrapper.find('[data-status="active"]').exists()).toBe(true);
expect(wrapper.text()).toContain("已完成");
expect(wrapper.vm.statusClass).toBe("active");
```

可用：`data-testid`、`data-status`、`aria-*`、文字內容、Vue computed state。

### 4. Pre-commit 檢查

`scripts/check-factory-usage.cjs` 透過 lint-staged 在所有 `*.test.ts` 上執行，會警告：
- 缺少 factory 使用
- CSS class 斷言
- 沒有驗證呼叫的 mock

---

## 快速開始

### 1. 環境準備

```bash
# 安裝依賴
pnpm install

# 設置測試資料庫
pnpm db:migrate:local
pnpm db:seed:local
```

### 2. 執行所有測試

```bash
# CI 測試套件（快速）
pnpm test:ci

# 完整測試套件
pnpm test && pnpm test:e2e && pnpm test:performance
```

### 3. 開發模式測試

```bash
# 監視模式單元測試
pnpm test:watch

# E2E UI 模式
pnpm test:e2e:ui
```

## E2E 測試

### 測試結構

> ⚠️ **準確性提醒（2026-07-05）**：下方舊有的 `admin/`、`journeys/`、
> `specs/`、`helpers/` 目錄樹已於 commit `b936600f`（2026-05-25,「remove
> mock-based test doubles」）整批刪除並重建。現行結構如下；完整模組對照表
> 請見 `docs/testing/CORE_WORKFLOW_TEST_MATRIX.md`（權威來源，持續更新）。

```
tests/e2e/
├── smoke/                         # 各角色 smoke tests（owner-*, kitchen-display 等，8 specs）
├── integration/                   # real-workflows.spec.ts：對真實 API 的瀏覽器工作流程
├── kitchen-display/               # kitchen-display.spec.ts：廚房畫面路由與狀態轉換
├── ci-smoke/                      # CI 專用輕量 smoke test
├── global-setup.ts
└── global-teardown.ts
```

> 另有 `tests/visual/*.visual.ts`（Playwright screenshot baselines）、
> `tests/performance/*.yml`（Artillery configs）、`tests/security/`（安全測試）。

### 核心測試場景

各模組（customer-app、admin-dashboard、kitchen-display、management-portal、
onboarding-app）的 smoke / unit / real-integration / real-browser-workflow
覆蓋矩陣，請見 `docs/testing/CORE_WORKFLOW_TEST_MATRIX.md` ——
該文件持續更新，這裡不重複維護一份會過時的副本。

### 執行特定測試

```bash
# 只測試 smoke suite
npx playwright test tests/e2e/smoke/

# 只測試 real-workflows 整合測試
npx playwright test tests/e2e/integration/real-workflows.spec.ts

# 只測試廚房顯示
npx playwright test tests/e2e/kitchen-display/
```

### E2E 測試最佳實踐

1. **使用 Mock 數據**：避免依賴真實 API
2. **獨立測試**：每個測試應該獨立可執行
3. **清理數據**：測試後清理創建的數據
4. **穩定的選擇器**：使用 data-testid 屬性
5. **適當的等待**：使用 waitForSelector 而非 timeout

## 性能測試

### 測試階段

性能測試分為 6 個階段，總時長約 12 分鐘：

```
1. Warm-up (60s)       → 5 req/s
2. Ramp-up (120s)      → 10-50 req/s
3. Sustained (300s)    → 50 req/s
4. Peak (120s)         → 100 req/s
5. Stress (60s)        → 150 req/s
6. Cool-down (60s)     → 10 req/s
```

### REST API 測試場景

| 場景     | 流量佔比 | 描述                     |
| -------- | -------- | ------------------------ |
| 認證流程 | 20%      | 登入、驗證、獲取用戶資訊 |
| 菜單管理 | 25%      | 查看、搜尋菜單           |
| 訂單管理 | 30%      | CRUD 訂單、統計          |
| 桌台管理 | 15%      | 查看、更新桌台           |
| 用戶管理 | 10%      | CRUD 用戶                |
| 混合讀取 | 50%      | 並發讀取多個端點         |
| 分析報表 | 5%       | 銷售、菜品分析           |
| 錯誤情境 | 5%       | 401、404、400 測試       |

### WebSocket 測試場景

| 場景          | 流量佔比 | 描述                 |
| ------------- | -------- | -------------------- |
| Kitchen 連線  | 30%      | 廚房員工連線、心跳   |
| Admin 連線    | 30%      | 管理員連線           |
| Customer 連線 | 40%      | 顧客連線（較長時間） |
| 訊息洪流      | 10%      | 高頻率訊息壓力測試   |

### 性能指標

#### REST API 目標

- ✅ **成功率**: > 99%
- ✅ **P95 回應時間**: < 300ms
- ✅ **P99 回應時間**: < 500ms
- ✅ **錯誤率**: < 1%

#### WebSocket 目標

- ✅ **連線成功率**: > 99%
- ✅ **P95 訊息延遲**: < 200ms
- ✅ **P99 訊息延遲**: < 500ms

### 執行性能測試

```bash
# 1. 啟動服務
pnpm dev

# 2. 執行 API 測試
pnpm test:performance

# 3. 執行 WebSocket 測試
pnpm test:performance:ws

# 4. 查看報告
artillery report artillery-report.json --output report.html
open report.html
```

### 自定義性能測試

編輯 `tests/performance/artillery-api.yml`:

```yaml
config:
  target: "http://localhost:8787"
  phases:
    - duration: 60
      arrivalRate: 10 # 調整負載
```

## CI/CD 整合

### GitHub Actions 工作流程

所有測試都已整合到 CI/CD 管道中：

```
┌─────────────────────────────────────┐
│   程式碼品質檢查                    │
│   - ESLint                          │
│   - TypeScript 檢查                 │
│   - Prettier 格式檢查               │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│   單元測試 (並行)                   │
│   - Node.js 22+                     │
│   - 覆蓋率報告                      │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│   Workers 測試                      │
│   - Cloudflare Workers              │
│   - D1 資料庫                       │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│   E2E 測試 (並行)                   │
│   - Chromium, Firefox, WebKit       │
│   - 截圖和影片記錄                  │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│   性能測試 (main/develop)           │
│   - REST API 負載測試               │
│   - WebSocket 負載測試              │
│   - Lighthouse CI                   │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│   安全性測試                        │
│   - 依賴漏洞掃描                    │
│   - CodeQL 分析                     │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│   部署 (測試通過後)                 │
│   - Production: main 分支           │
└─────────────────────────────────────┘
```

### 觸發條件

- **每次 Push**: 程式碼品質、單元測試、Workers 測試
- **Pull Request**: 所有測試
- **Push 到 main**: 完整測試 + 性能測試 + 部署

### 查看測試報告

1. 前往 GitHub Actions 頁面
2. 選擇工作流程執行
3. 下載測試報告 Artifacts：
   - `unit-test-results-node-*`
   - `playwright-report-*`
   - `performance-test-reports`

## 最佳實踐

### 1. 測試命名

```typescript
// ✅ 好的命名
test("應該在用戶登入成功後顯示儀表板", async () => {});

// ❌ 不好的命名
test("test1", async () => {});
```

### 2. 測試隔離

```typescript
// ✅ 每個測試獨立
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  // 登入設置
});

// ❌ 測試之間有依賴
test("test1", () => {
  /* 創建數據 */
});
test("test2", () => {
  /* 依賴 test1 的數據 */
});
```

### 3. 使用 Mock

```typescript
// ✅ Mock API 回應
await page.route("/api/v1/orders", async (route) => {
  await route.fulfill({
    status: 200,
    body: JSON.stringify(mockData),
  });
});

// ❌ 依賴真實 API
await page.goto("/orders"); // 可能失敗
```

### 4. 適當的等待

```typescript
// ✅ 等待特定元素
await page.waitForSelector('[data-testid="orders-list"]');

// ❌ 硬編碼延遲
await page.waitForTimeout(5000);
```

### 5. 清理資源

```typescript
test.afterEach(async ({ page }) => {
  // 清理測試數據
  await cleanupTestData();

  // 關閉連線
  await page.close();
});
```

## 故障排除

### 記憶體配置問題

**問題**: JavaScript heap out of memory

```bash
FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory
```

**原因**:

- 測試套件規模大（MakanMakan 單元 / 整合測試 8,000+ 項）
- Node.js 預設 heap size 不足
- 覆蓋率分析需要額外記憶體

**解決方案**:

已在 `package.json` 配置 4GB 記憶體限制:

```json
{
  "scripts": {
    "test": "cross-env NODE_OPTIONS='--max-old-space-size=4096' vitest",
    "test:coverage": "cross-env NODE_OPTIONS='--max-old-space-size=4096' vitest run --coverage"
  }
}
```

**記憶體分配建議**:

- 小型專案 (< 100 測試): 預設值
- 中型專案 (100-500 測試): 2GB (`2048`)
- 大型專案 (500-1000 測試): 4GB (`4096`)
- 超大型專案 (> 1000 測試): 8GB (`8192`)

### Vue 組件測試常見問題

#### 1. Icon Mock 配置錯誤

**問題**: Icon 組件無法解析

```bash
[Vue warn]: Failed to resolve component: UserIcon
No "UserIcon" export is defined on the "@heroicons/vue/24/outline" mock
```

**解決方案**: Icon mock 必須包含 `template` 屬性

```typescript
vi.mock("@heroicons/vue/24/outline", () => ({
  UserIcon: { name: "UserIcon", template: "<svg />" },
  ClockIcon: { name: "ClockIcon", template: "<svg />" },
  // ... 其他 icons
}));
```

#### 2. Pinia Store Mock 錯誤

**問題**: storeToRefs 無法讀取 value

```bash
TypeError: Cannot read properties of undefined (reading 'value')
```

**錯誤方法**: 使用 plain values mock

```typescript
// ❌ 錯誤
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    showEstimatedTime: false, // Plain value
  }),
}));
```

**正確方法**: 使用真實 Pinia store

```typescript
// ✅ 正確
import { createPinia, setActivePinia } from "pinia";

beforeEach(() => {
  const pinia = createPinia();
  setActivePinia(pinia);
});
```

#### 3. localStorage Mock 錯誤

**問題**: JSON.parse 錯誤

```bash
"undefined" is not valid JSON
```

**解決方案**: getItem() 必須返回 `null` (不是 `undefined`)

```typescript
const createLocalStorageMock = () => {
  const storage: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => storage[key] || null), // ✅ 返回 null
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete storage[key];
    }),
    clear: vi.fn(() => {
      Object.keys(storage).forEach((key) => delete storage[key]);
    }),
    get length() {
      return Object.keys(storage).length;
    },
    key: vi.fn((index: number) => {
      const keys = Object.keys(storage);
      return keys[index] || null;
    }),
  };
};

beforeEach(() => {
  const mockLocalStorage = createLocalStorageMock();
  Object.defineProperty(global, "localStorage", {
    value: mockLocalStorage,
    writable: true,
  });
});
```

#### 4. 缺少必要的 Props

**問題**: Vue 警告缺少 props

```bash
[Vue warn]: Missing required prop: "statusType"
```

**解決方案**: 檢查組件定義,提供所有必要 props

```typescript
// ✅ 提供所有必要 props
mount(OrderCard, {
  props: {
    order: mockOrder,
    statusType: "pending", // Required prop
  },
});
```

### E2E 測試失敗

**問題**: 測試超時

```bash
Timeout exceeded while waiting for element
```

**解決方案**:

1. 檢查選擇器是否正確
2. 增加 timeout 設置
3. 使用 waitForLoadState('networkidle')

### 性能測試失敗

**問題**: 連線錯誤

```bash
Error: connect ECONNREFUSED
```

**解決方案**:

1. 確保服務正在運行
2. 檢查端口是否正確
3. 查看防火牆設置

### CI 測試失敗

**問題**: 測試在本地通過，但 CI 失敗

**解決方案**:

1. 檢查環境變數配置
2. 查看 CI 日誌詳細錯誤
3. 使用 `act` 工具本地運行 GitHub Actions

## 參考資源

- [Playwright 文檔](https://playwright.dev/)
- [Vitest 文檔](https://vitest.dev/)
- [Artillery 文檔](https://www.artillery.io/docs)
- [Testing Library](https://testing-library.com/)

## 貢獻

如需添加新測試或改進現有測試：

1. 遵循現有測試模式
2. 確保測試獨立可執行
3. 添加適當的文檔註釋
4. 更新本文檔

---

**最後更新**: 2026-04-13
**維護者**: MakanMakan Dev Team

## 最近更新

### 2026-04-13

- ✅ 新增「強制測試規範」章節，對齊 `CLAUDE.md` → Testing Standards
- ✅ 新增 `@makanmasak/testing-utils` Factory 使用示例（`userFactory.buildShopOwner` 等）
- ✅ 補上 API Contract 測試章節（`pnpm contract:check` / `update` / `report`）
- ✅ 更新 `tests/e2e/` 目錄結構：補上 `journeys/`、`integration/`、`helpers/`
- ✅ 修正 Admin E2E 數字為 15 specs / ~236 tests（舊數字 44 tests 已過時）
- ✅ 補上 Journey E2E 8 spec 角色對照表
- ✅ 整合測試說明：明確為 in-memory SQLite（非 mock）

### 2025-11-17

- ✅ 新增記憶體配置問題解決方案 (4GB heap allocation)
- ✅ 新增 Vue 組件測試常見問題與修復 (Icon mock, Pinia store, localStorage)
- ✅ 完成 Kitchen Display 測試修復 (64/64 測試通過)
