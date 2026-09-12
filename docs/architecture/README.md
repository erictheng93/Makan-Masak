# Architecture Documentation / 架構文檔

本文件夾包含 MakanMakan 系統的架構設計、技術規格和系統設計文檔。

## 📂 文件夾結構

### 📄 根目錄文檔

- **`technical-documentation.md`** ⭐ - 完整技術規格文檔（主文檔）
- **`project-architecture.md`** - 專案架構概覽

### 🗄️ Database Architecture (`database/`)

資料庫架構設計與優化文檔

**主要文檔**:

- `DATABASE_ARCHITECTURE_COMPARISON.md` - 架構比較分析
- `database-optimization-analysis.md` - 優化分析報告
- `DATABASE_REFACTORING_INDEX.md` - 重構索引
- `DATABASE_REFACTORING_PLAN.md` - 重構計劃
- `DATABASE_REFACTORING_EXECUTIVE_SUMMARY.md` - 重構執行摘要

**涵蓋內容**:

- Cloudflare D1 (SQLite) 架構
- 表結構設計
- 索引優化
- 查詢性能
- 遷移策略

### 🏗️ System Design (`system-design/`)

系統設計與模組架構文檔

**主要文檔**:

- `MODULAR_ARCHITECTURE_GUIDE.md` - 模組化架構指南
- `QUEUE_MODULAR_API.md` - 佇列模組化 API
- `NOTIFICATION_SYSTEM.md` - 通知系統設計
- `VERIFICATION_SYSTEM.md` - 驗證系統設計

**涵蓋內容**:

- 微服務架構
- 模組化設計
- API 設計模式
- 系統整合

---

## 🎯 文檔用途

### Technical Documentation

> **最重要的架構文檔** - 包含完整的技術規格、系統設計和實施細節

**適合閱讀者**:

- 新加入的開發者
- 架構師
- 技術決策者

**內容涵蓋**:

- 系統架構概覽
- 技術棧選擇
- 資料庫設計
- API 架構
- 安全設計
- 部署架構

### Database Architecture

> 資料庫層面的設計與優化

**適合閱讀者**:

- 資料庫管理員
- 後端開發者
- 性能優化工程師

**內容涵蓋**:

- Schema 設計
- 索引策略
- 查詢優化
- 資料遷移

### System Design

> 系統層面的設計模式與架構決策

**適合閱讀者**:

- 系統架構師
- 資深開發者
- 模組負責人

**內容涵蓋**:

- 模組化設計
- 服務間通訊
- 佇列系統
- 通知機制

---

## 🔍 快速導航

### 我想了解...

#### 整體架構

→ 閱讀 `technical-documentation.md`

#### 資料庫設計

→ 查看 `database/` 文件夾

#### 特定子系統設計

→ 查看 `system-design/` 文件夾

#### 模組化架構

→ 閱讀 `system-design/MODULAR_ARCHITECTURE_GUIDE.md`

#### 資料庫優化

→ 閱讀 `database/database-optimization-analysis.md`

---

## 📊 架構圖示

**權威來源：[system-architecture.html](./system-architecture.html)** — 11 個應用、5 個 Worker、9 個共用套件，
以及每個 Worker 實際綁定的 D1 / KV / R2 / Durable Object / Queue / Vectorize / AI 資源。內容取自各 app 的
`wrangler.toml` 與 `package.json`。

搭配閱讀：

| 圖 | 回答什麼 |
| --- | --- |
| [system-architecture.html](./system-architecture.html) | 系統由哪些東西組成、誰綁了什麼資源 |
| [master-user-flow.html](./master-user-flow.html) | 誰在用、有哪些流程、怎麼串 |
| [../flows/](../flows/) | 每一條流程逐步怎麼跑、會怎麼壞 |

### 系統架構層次（簡化版）

```
Cloudflare Pages   customer-app · admin-dashboard · kitchen-display
                   management-portal · onboarding-app
                            ↓  HTTPS / WebSocket
Cloudflare Workers api · management-api · realtime · image-processor
                   backup-scheduler
                            ↓  bindings
Data & State       D1（主庫＋管理庫）· KV ×6 · R2 ×3 · Durable Objects
                   Queues ＋ DLQ · Vectorize · Workers AI · Analytics Engine
```

> 店內另有一個不在 Cloudflare 上跑的 `print-agent`（本機 Node 常駐服務），
> 目前與雲端尚未接通，見 [flows/12-floor-printing.md](../flows/12-floor-printing.md)。

### 核心技術棧

- **Frontend**: Vue.js 3, TypeScript, Vite
- **Backend**: Cloudflare Workers, Hono Framework
- **Database**: Cloudflare D1 (SQLite-compatible), Drizzle ORM
- **Cache**: Cloudflare KV
- **Storage**: Cloudflare R2
- **Realtime**: Durable Objects (WebSocket), SSE
- **Build**: Turborepo (parallel builds)
- **Testing**: Vitest, Playwright
- **Print**: Local Node.js agent (Express + WebSocket)

### 功能模組總覽 (<!-- gen:featureDirs -->53<!-- /gen --> 個 feature 目錄，其中 <!-- gen:moduleCount -->45<!-- /gen --> 個符合 `index.ts` 掛載模組規範)

> 「目錄數」是 `apps/api/src/features/` 下的子目錄總數；「模組數」是其中匯出 `index.ts` 預設導出、可被 `app-factory.ts` 掛載的模組數。其餘目錄（如 `audit`、`customer`、`notifications`、`push`、`realtime` 等）改以直接 export router 的方式掛載。數字由 `scripts/check-docs-drift.cjs` 驗證。

| 類別               | 模組                                                         |
| ------------------ | ------------------------------------------------------------ |
| **認證與用戶**     | authentication, users, customers, customer, verification, me, members |
| **餐廳與菜單**     | restaurants, menu, discovery                                 |
| **市場與攤位**     | markets, market-checkouts                                    |
| **訂單系統**       | orders, guest-orders, group-orders                           |
| **桌位與座位**     | tables, seats, qr-codes                                      |
| **排隊與預約**     | queue, waiting-list, reservations, service-bookings          |
| **支付與收銀 POS** | payments, pos, credits                                       |
| **廚房與出單**     | kitchen, print                                               |
| **員工與管理**     | manager, scheduling, leaves                                  |
| **優惠與合作**     | coupons, partnerships                                        |
| **食材與預測**     | ingredients, forecast                                        |
| **分析**           | analytics, ai-analytics                                      |
| **顧客互動**       | feedback, reviews                                            |
| **整合平台**       | integrations                                                 |
| **即時通訊與通知** | realtime, sse, notifications, push, broadcasts, alerts       |
| **訂閱與計費**     | subscriptions, billing, admin-settings                       |
| **稽核與系統運維** | audit, system, monitoring, backup, cache                     |

---

## 🔗 相關文檔

- **功能實施**: `docs/features/`
- **API 文檔**: `docs/api/`
- **部署指南**: `docs/guides/deployment/`
- **性能優化**: `docs/performance/`
- **測試指南**: `docs/testing/`

---

## 📝 架構決策記錄 (ADR)

未來可以在此處添加架構決策記錄（Architecture Decision Records），記錄重要的技術決策及其理由。

**建議格式**:

- 決策背景
- 考慮的方案
- 選擇的方案及理由
- 結果與影響

---

**最後更新**: 2026-09-13
**架構版本**: 2.0 (Cloudflare Serverless)
**功能模組**: 53（其中 45 個為 `index.ts` 掛載模組）
**API 端點**: 400+（59 個掛載點，見 `docs/api/README.md`）
