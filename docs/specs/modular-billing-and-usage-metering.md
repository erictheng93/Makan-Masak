# Spec：模組計費 與 用量計量系統

| | |
|---|---|
| **狀態** | P1/P2/P3 已合併，§0.4 audit gaps 已補齊 |
| **建立日期** | 2026-05-03 |
| **最後更新** | 2026-06-06（含 §0.4 驗證快照、production quota enforce、cron / webhook fail-closed 補齊）|
| **作者** | Eric + Claude（驗證），Codex（實作） |
| **影響範圍** | `apps/api`、`apps/management-api`、`apps/admin-dashboard`、`apps/customer-app`、`apps/kitchen-display`、`apps/onboarding-app`、`packages/database`、`packages/shared` |
| **預計分階段** | 3 階段 / 13 個 PR（P1: 5 / P2: 4 / P3: 4） |
| **依賴** | 既有 `shopSubscriptions` schema、`moduleGate` middleware、`paymentTransactions` table、Slack webhook |
| **Open Questions** | 3 / 7 待回答（§5），其中 0 個阻擋實作開始 |

> **v2.0 定位註記（Marketplace-first）**：本 spec 描述的訂閱/模組計費（basic/pro/enterprise）在 v2.0 商業模式中**降級為 entitlement / 權限分層基礎設施與 add-on 存取控制，並非主要收入線**。平台主要收入來自交易流與封閉式代幣帳本（不可兌現、不可轉讓、不可換取有價證券的代幣、卷、抽成、破值）；商家管理功能定位為「免費商家 OS」。本文件的 P1–P3 仍為有效的技術實作參考，但「可賣 basic/pro/enterprise」應理解為「具備按權限分層與 add-on 變現的基礎設施能力」，而非「向商家收工具月費」。本 spec 中的外部金流/訂閱 webhook 屬 add-on billing 基礎設施與未來選項，不代表 v2.0 pilot 會接真正金流。詳見 `docs/BUSINESS_PLAN.md` §1.5 / §5.1。

---

## 0. TL;DR

把既有的訂閱骨架（`shopSubscriptions` + `moduleGate`）補完成可上線的計費系統，分三段獨立可 ship：

| Phase | 完成後可賣什麼 | 不能做什麼 |
|---|---|---|
| **P1 — Gating Coverage** | 「賣模組」：客戶買 basic/pro/enterprise，系統真的擋住未購買的功能 | 不能依用量收費 |
| **P2 — Usage Metering** | 「按量計費」：訂單／API／列印／AI／儲存量都被精準計量，且超量會被擋 | 不能自動開帳單 |
| **P3 — Billing Lifecycle** | 「自動化收費」：cycle 邊界自動結算、trial 自動降級、payment audit log、外部金流串接 | 不做客製定價、proration |

每個階段都對應明確的客戶承諾，內部實作可以並行 review，但**不可跳階段**：P2 依賴 P1 的 gating 已套滿，P3 依賴 P2 的 usage events 表存在。

---

## 0.4 Verification Snapshot（2026-05-03，逐條對照 acceptance）

> 這節為 audit 結果——讀過 `git log` + 實際 grep/read 程式碼後對照 §2.5 / §3.7 / §4.6 acceptance 逐項確認。各 PR 的最終實作位置與 SPEC 草稿略有偏離（多處從獨立 worker 檔案改成 `apps/api/src/index.ts` 內 scheduled handler 派發），列在「偏離」欄位。

### P1 — Gating Coverage（9/9 ✅）

| § | Acceptance | 狀態 | 證據 / 偏離 |
|---|---|---|---|
| 2.5#1 | A.2 ⚠️ 路由全部掛 `moduleGate` | ✅ | `apps/api/src/app-factory.ts:483/485/500/504/506/508` 等掛點全在 |
| 2.5#2 | `module-gating-coverage.test.ts` 對所有 PROTECTED_PREFIXES 通過 | ⚠️ | 原 `apps/api/src/__tests__/module-gate-coverage.test.ts`（21 static + 22 runtime 斷言）已在 `b936600f`（remove mock-based test doubles）刪除，沒有等價替代。目前的覆蓋：static wiring 由 `scripts/audit-module-gates.cjs`（見 2.5#3）負責；gate 行為由 `apps/api/src/__tests__/integration/module-gate.real.integration.test.ts` 與各 feature 的 `module-gate.test.ts` 驗證。**缺口**：不再對每個 PROTECTED_PREFIXES 逐一 `app.request()` 驗 403 |
| 2.5#3 | `scripts/audit-module-gates.cjs` + pre-commit | ✅ | `scripts/audit-module-gates.cjs` 已加入，`.husky/pre-commit` 會執行 |
| 2.5#4 | `GET /me/modules` 形狀正確 | ✅ | `apps/api/src/features/me/routes/index.ts:24-98`（customer 回 `restaurantId: null`）|
| 2.5#5 | `useModuleAccess` + `<ModuleGate>` | ✅ | `packages/shared/composables/useModuleAccess.ts`、`packages/shared/components/ModuleGate.vue` |
| 2.5#6 | 3 處 frontend 接入點 | ✅ | KitchenView.vue / Sidebar.vue（coupons、analytics、ai_analytics）/ AIInsightsDashboard.vue |
| 2.5#7 | onboarding 4 路徑 + `db.batch` | ✅ | `apps/management-api/src/services/OnboardingService.ts:425-443`，`planIdToTier()` 對應 |
| 2.5#8 | backfill migration 對既存 restaurant 建 enterprise 訂閱 | ✅ | `migrations/0065_backfill_enterprise_subscriptions.sql` + `migrations_fresh/0046_backfill-enterprise-subscriptions.sql` |
| 2.5#9 | `docs/architecture/modular-billing.md` | ✅ | 存在（94 行）|

### P2 — Usage Metering（10/10 ✅）

| § | Acceptance | 狀態 | 證據 / 偏離 |
|---|---|---|---|
| 3.7#1 | `usage_events` + `usage_meters` migrated | ✅ | `migrations_fresh/0041_usage-metering.sql` |
| 3.7#2 | 5 meter 計量點接通 | ✅ | `usageTracker.ts` 全域、orders 路由（成單 + print 第 1022 行）、ai-analytics:31、storage-snapshot worker（含 `0042_storage-counters.sql`）|
| 3.7#3 | `quotaGate` 套用 | ✅ | orders POST、group-orders、guest-orders、ai-analytics POST、print（第 992 行）皆掛 |
| 3.7#4 | `PLAN_QUOTAS` | ✅ | `packages/database/src/utils/plan-quotas.ts`（trial/basic/pro/enterprise）|
| 3.7#5 | `usage-aggregator.ts` | ✅ | `apps/api/src/workers/usage-aggregator.ts`（cron `*/5 * * * *` 由 `apps/api/src/index.ts` 派發）|
| 3.7#6 | `usage-events-ttl.ts`（90 天清理）| ✅ | `apps/api/src/workers/usage-events-ttl.ts`，cron `0 3 * * *` 由 `apps/api/src/index.ts` 派發，`apps/api/wrangler.toml` 已註冊 |
| 3.7#7 | 3 個 usage GET API | ✅ | `/me/usage`（me/routes:100-120）、`/admin/subscriptions/:id/usage` + `/usage/events`（subscriptions/routes:28,43）|
| 3.7#8 | admin-dashboard 用量頁籤 | ✅ | `apps/admin-dashboard/src/components/billing/UsageTab.vue` |
| §9.3 | `quotaExceeded(meterKey, hardLimit)` factory | ✅ | `apps/api/src/middleware/quotaGate.ts` 匯出 `quotaExceeded()`，details 含 `{ meterKey, hardLimit, current }` |
| 3.4.4 | `QUOTA_ENFORCEMENT_MODE` 三模式 | ✅ | `quotaGate.ts:26` 讀取；runtime 未設定時預設 `disabled`，production `wrangler.toml` 設定 `enforce` |

### P3 — Billing Lifecycle（7/7 ✅）

| § | Acceptance | 狀態 | 證據 / 偏離 |
|---|---|---|---|
| 4.6#1 | `payment_audit_log` + `cycle_snapshots` migrated | ✅ | `0043_payment-audit-log.sql` + `0044_cycle-snapshots.sql` + `0045_notification-dispatch-log.sql` 順序正確 |
| 4.6#2 | cycle closer cron 端到端結算 | ✅ | `BillingCycleService.closeDueCycles()` 由 `apps/api/src/index.ts:86-99` cron `15 2 * * *` 派發，`apps/api/wrangler.toml` 已註冊。**偏離**：SPEC §4.2 寫每小時 `0 * * * *`，實作為每日 02:15 |
| 4.6#3 | trial reaper | ✅ | `TrialReaperService.downgradeExpiredTrials()` 同上；**偏離**：未獨立成 `workers/trial-reaper.ts`，併入 `BillingCycleService.ts` |
| 4.6#4 | webhook 端點對至少一家 provider 驗簽 | ✅ | Stripe + LINE Pay 兩家已實作且 fail-closed；secret 未配置、簽章缺失/錯誤、未知 provider 皆 401。`STRIPE_WEBHOOK_SECRET` 與 `LINEPAY_WEBHOOK_SECRET` 驗簽測試覆蓋（`BillingWebhookService.ts:148-204`）|
| 4.6#5 | 5 種通知送達（硬/trial-3d/trial-1d/trial-0d/payment-failed） | ✅ | **採選項 C 設計**：`quota_soft` 維持 `X-Quota-Warning` header-only；`quota_hard` 發 Slack 並寫 `notification_dispatch_log`。實作 kinds：QUOTA_HARD / TRIAL_3D / TRIAL_1D / TRIAL_0D / PAYMENT_FAILED / GRACE_PERIOD_START / ACCOUNT_SUSPENDED / CYCLE_CLOSED。 |
| 4.6#6 | `payment_audit_log` 對所有 payment 事件 append-only | ✅ | payment attempt/success/failure/refund、webhook_received、cycle_close、trial_downgrade、grace_period_start 均已寫入與測試覆蓋 |
| 4.6#7 | `docs/runbooks/billing-incident-response.md` | ✅ | 存在（22+ 行 SOP）|

### 結論：SPEC 與實作的最大偏離

1. **PR 拆分順序與 SPEC 不符**：SPEC §4.7 的 P3 順序是 a → b → c → d；實作 commit 順序曾偏離，但 migration filename 順序已正確。
2. **Cron 頻率偏離**：cycle closer 由 SPEC 的 hourly 改成 daily 02:15；`apps/api/wrangler.toml` 已註冊 `0 3 * * *` 與 `15 2 * * *`，production 會觸發 P2 TTL 與 P3 lifecycle。24h cron 可在 7±1 天精度滿足 grace period sweep。
3. **Notification kinds 集合已依選項 C 收斂**：保留 `GRACE_PERIOD_START` / `ACCOUNT_SUSPENDED`（合理擴充），補齊 `QUOTA_HARD` / `TRIAL_1D`；`QUOTA_SOFT` 正式改為 header-only，不推 Slack/email。
4. **已補齊 gap**：P1 backfill/gate audit、P2 TTL/quota factory、P3 LINE Pay provider、billing notification kind tests 均已落地。

---

## 1. 背景與決策摘要

### 1.1 為什麼現在做

商業模式現已收斂為平台代管部署。租戶不再自帶 Cloudflare 帳號；申請送出後由平台審核，核准時使用平台資源啟用租戶。模組授權與用量計量仍維持獨立基礎設施，但不再為租戶自有部署或 license token 預留新流程。

### 1.2 readiness 現況（驗證結論）

| 子系統 | 現況 | 缺口 |
|---|---|---|
| Module 定義 | 80% | `MODULES` enum 已有 12 個，但 **`pos` / `inventory` / `staff_management` 三個既有 feature 沒對應模組** |
| Plan 對應表 | 90% | 硬編碼，先不開 admin UI |
| `moduleGate` middleware | 70% | 已實作，**13 個 feature 已套**（menu/tables/seats/orders/kitchen/coupons/reservations/waiting-list/analytics/ai-analytics/partnerships/integrations/group-orders），但 **pos / forecast / ingredients / scheduling / leaves / feedback / queue / payments / guest-orders / customers 尚未掛**（詳見 Appendix A） |
| Subscription Admin API | 90% | CRUD 完整 |
| Onboarding → Subscription | 40% | `onboarding-app` 收 `planId` 但是否落地不明 |
| Usage tracking | **10%** | 只有 partnership 折扣記錄，沒有通用計量 |
| Quota enforcement | **0%** | 沒有 |
| Billing cycle 邏輯 | 30% | 只有欄位，沒有結算 / 重置 |
| Payment audit log | **0%** | P1 TODO 已記 |
| Frontend module gating | **0%** | 前端無法知道自己有哪些模組 |
| Deployment mode 收斂 | **100%** | `shopSubscriptions` 不再保存 deployment mode；部署模式由平台環境管理 |

### 1.3 三大架構決策

**D1｜計量採「事件流 + 聚合表」雙層，不採純 counter**
每個計量事件寫入 `usage_events`（append-only，TTL 90 天），由 cron 每小時聚合到 `usage_meters`（per-cycle counter）。理由：純 counter 無法回溯／除錯／申訴，事件流可重建任何時段的用量；TTL 控制 D1 容量。

**D2｜Quota 用「軟限制 + 硬限制」雙層**
- **軟限制（80%）**：通知用戶但不擋
- **硬限制（100%）**：擋下請求，回 `QUOTA_EXCEEDED`

避免「客戶尖峰時段第 101 單被擋」這種破壞性體驗——軟限制給客戶 buffer 時間升級。

**D3｜P3 不自建金流，接外部訂閱平台**
自建 invoice/proration/dunning 是 6 個月起跳的工程，且法遵風險高（發票格式、稅務、退款）。P3 只做：(a) 把 `shopSubscriptions` 同步到外部訂閱平台、(b) 接 webhook 觸發 plan 變更、(c) 內部 payment audit log。**外部金流商選擇暫時 skip**——P3 SPEC 寫成「provider-agnostic」，金流商選定後再開實作 PR。**自建發票永久放 §8 Deferred TODO**。

**D4｜部署模式固定為平台代管**
計量／gating 系統一律由平台 Worker 讀取 `shopSubscriptions`。`shopSubscriptions` 不再保存部署模式欄位；不再新增租戶自有部署的 license token、Cloudflare 帳號或自動部署協調器。

---

## 2. Phase 1：Gating Coverage

> **目標**：把既有的 `moduleGate` middleware 真的套到所有付費路由，前端能依授權渲染，onboarding 完成時自動建立訂閱記錄。

### 2.1 路由 Gating 稽核（已完成）

完整對應表見 **Appendix A**。本節摘要：

**現況**：13 個 feature 已掛 gate（共約 90 個 route 點）。
**缺口**：8 個 feature 尚未掛、其中 3 個沒有對應的 module key。

**新增 3 個 module key**（migration 在 P1-a 一併處理）：
- `pos` — POS 系統（收銀機、班別、現金管理）
- `inventory` — 食材／庫存管理
- `staff_management` — 員工排班、請假

**Plan 預設對應**（更新 `PLAN_DEFAULT_MODULES`）：
- `basic`：不含三者
- `pro`：含 `pos`
- `enterprise`：含 `pos` + `inventory` + `staff_management`

**Coverage 驗收機制**（鎖定）：

採 **Hono router 反射** 路徑，不用 AST 也不用 grep。

```typescript
// apps/api/src/__tests__/module-gating-coverage.test.ts
import { app } from '../app-factory';

const PROTECTED_PREFIXES = [
  '/api/v1/menu', '/api/v1/tables', '/api/v1/seats',
  '/api/v1/orders', '/api/v1/orders/group', '/api/v1/kitchen',
  '/api/v1/coupons', '/api/v1/reservations', '/api/v1/waiting-list',
  '/api/v1/analytics', '/api/v1/ai-analytics', '/api/v1/partnerships',
  '/api/v1/integrations/admin', '/api/v1/pos', '/api/v1/forecast',
  '/api/v1/ingredients', '/api/v1/scheduling', '/api/v1/leaves',
  '/api/v1/feedback', '/api/v1/payments',
];

describe('module gating coverage', () => {
  for (const prefix of PROTECTED_PREFIXES) {
    it(`${prefix} returns 403 MODULE_NOT_ENABLED for unauthorised tenant`, async () => {
      // 用一個 plan=basic 的 fixture restaurant 對該 prefix 任一 GET 端點打 request
      // 期望：401（auth failed） 或 403（module gate 擋）
      // 不可：200（gate 漏掉）
    });
  }
});
```

**`scripts/audit-module-gates.cjs`** 是 grep-based heuristic（速度優先）：
```javascript
// 對 PROTECTED_PREFIXES 對應的 features/*/routes/*.ts 做 grep
// 若找不到 moduleGate( 字串 → 非 0 exit
```
pre-commit 用，CI 用上面的反射測試。

**Core / infra 白名單**（不需 gate，理由見 Appendix A）：auth、verification、qr-codes、restaurants、users、realtime、sse、push、notifications、monitoring、system、audit、cache、backup、discovery、admin、admin/subscriptions、manager、guest-orders（內含 token 驗證已防護）、customers（顧客自助）、queue（待 queue spec）。

### 2.2 前端 module gating

#### 2.2.1 後端：`GET /api/v1/me/modules`

**掛載位置**：`apps/api/src/features/me/routes/index.ts`（新增 `me` feature dir，僅這一個端點，未來 `/me/usage` 等共用）

**認證**：`authMiddleware`，所有非匿名用戶可呼叫（role 0–4 = staff/admin，role 5 = customer 也可呼叫，但對 customer 永遠回 `null` modules——因為顧客無 `restaurantId` 綁定）

**回應**（直接重用 `SubscriptionService.getEffectiveModules()` 既有形狀）：
```typescript
type MeModulesResponse = {
  success: true;
  data: {
    restaurantId: string | null;        // null for customer (role 5)
    planTier: PlanTier | null;          // null if no subscription
    isActive: boolean;
    trialEndsAt: number | null;          // unix ms
    effectiveModules: Record<ModuleKey, boolean>;  // 同 SubscriptionService.getEffectiveModules() 回傳
  };
};
```

**KV cache**：重用 `subscription:${restaurantId}` 同一份 cache（5 分鐘 TTL），不另開 cache key。

#### 2.2.2 前端 composable

**新增** `packages/shared/composables/useModuleAccess.ts`：

```typescript
export function useModuleAccess() {
  // 從 Pinia store 讀取（store 內部負責 fetch + cache）
  const store = useModuleAccessStore();

  return {
    hasModule: (key: ModuleKey): boolean => store.effectiveModules[key] === true,
    planTier: computed(() => store.planTier),
    isTrialExpired: computed(() =>
      store.planTier === 'trial' &&
      store.trialEndsAt !== null &&
      Date.now() > store.trialEndsAt
    ),
    isLoading: computed(() => store.isLoading),
    isLoaded: computed(() => store.isLoaded),
    refresh: () => store.fetch({ force: true }),
  };
}
```

**Pinia store** `packages/shared/stores/moduleAccess.ts`：
- 登入後 `app.beforeMount()` 觸發第一次 fetch
- 5 分鐘 TTL，過期下次讀取時 stale-while-revalidate（先回舊值、背景 refetch）
- 401/403 → 清空 store、不 retry
- Network error → 保留舊值、`isLoading=false`、不 throw（讓 UI 用上次成功的值降級運作）

#### 2.2.3 `<ModuleGate>` 元件

**新增** `packages/shared/components/ModuleGate.vue`：

```vue
<!-- 用法 -->
<ModuleGate module="analytics">
  <AnalyticsPanel />
  <template #fallback>
    <UpgradePrompt :module="'analytics'" />  <!-- 預設：顯示「升級才能用」CTA -->
  </template>
  <template #loading>
    <Skeleton />  <!-- 預設：iOS-style skeleton -->
  </template>
</ModuleGate>
```

**契約**：
- `module` prop 必填（`ModuleKey`）
- 預設 slot：模組 enabled 時渲染
- `#fallback`：未授權時渲染（預設為內建 `UpgradePrompt` 元件，顯示升級 CTA）
- `#loading`：`isLoaded === false` 時渲染（預設為 `<div class="bg-ios-gray-100 animate-pulse rounded-2xl h-32" />`）
- **不**自動隱藏元素（不用 `v-if` 消失）——明確 fallback 才符合 UI/UX design system

#### 2.2.4 三個前端 app 接入點

P1-e 必須完成的 3 處顯式包裝（acceptance criteria 用）：
1. `apps/admin-dashboard/src/views/KitchenView.vue` — 整頁包 `<ModuleGate module="kitchen_display">`
2. `apps/admin-dashboard/src/components/Sidebar.vue` — Analytics、Loyalty、Coupons 三個 nav item 各自包 `<ModuleGate>`，未授權則 nav item 完全消失（這個 case 用 `<template #fallback><span /></template>`）
3. `apps/admin-dashboard/src/views/AIAnalyticsView.vue` — 整頁包 `<ModuleGate module="ai_analytics">`

### 2.3 Onboarding → Subscription 自動建立

#### 2.3.1 `planId` 對應（鎖定）

Onboarding 收的 `planId`（沿用既有 `LicenseTier` 命名）→ 訂閱 `planTier`：

| Onboarding `planId` | Subscription `planTier` | 預設行為 |
|---|---|---|
| `standard` | `basic` | 無 trial，建立後立即進入 `basic` cycle |
| `professional` | `pro` | 無 trial，建立後立即進入 `pro` cycle |
| `enterprise` | `enterprise` | 無 trial，建立後立即進入 `enterprise` cycle |
| *（未指定 / null / opt-in trial）* | `trial` | 14 天 trial，到期降為 `basic` |

**新增**`packages/database/src/utils/plan-mapping.ts` 集中此 map，讓 onboarding 與 subscription service 共用：

```typescript
export const PLAN_ID_TO_TIER: Record<string, PlanTier> = {
  standard: PLAN_TIERS.BASIC,
  professional: PLAN_TIERS.PRO,
  enterprise: PLAN_TIERS.ENTERPRISE,
};
export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;  // 14 days, locked
export const DEFAULT_BILLING_CYCLE_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days, locked
```

#### 2.3.2 Subscription 建立流程

`apps/management-api/src/services/OnboardingService.ts`：
- onboarding `complete` 流程中，建立 `restaurants` row 後，**用 `db.batch([...])`** 原子寫入 `restaurants` + `shopSubscriptions` 兩表（D1 不支援多語句 transaction，但 `batch()` 是原子的）
- `planId` 透過 `PLAN_ID_TO_TIER` 對應到 `planTier`
- `planTier === 'trial'`：設 `trialEndsAt = now + TRIAL_DURATION_MS`、`billingCycleStartAt/EndAt = null`
- 其他 plan：設 `trialEndsAt = null`、`billingCycleStartAt = now`、`billingCycleEndAt = now + DEFAULT_BILLING_CYCLE_MS`
- 失敗時 batch 整體 rollback（D1 batch 語意），onboarding 標記為失敗

**驗收**：onboarding 完成後 `shopSubscriptions` 必有對應 row；端到端測試覆蓋四條路徑（standard / professional / enterprise / trial-default）。

### 2.4 Schema 變更

**新增 3 個 module key** 到 `packages/database/src/schema/subscriptions.ts` 的 `MODULES` 常數（`pos` / `inventory` / `staff_management`），並更新 `PLAN_DEFAULT_MODULES` 對應表。**無 SQL migration 需要**——`MODULES` 是 TypeScript 常數，`moduleOverrides` 是 JSON 欄位向前相容。

不新增店家訂閱層級的部署模式欄位。部署模式屬於平台環境與部署管線責任，不進入店家訂閱資料模型。

### 2.5 P1 Acceptance Criteria

- [ ] 所有 Appendix A.2 ⚠️ 標記路由都掛了正確的 `moduleGate`
- [ ] `module-gating-coverage.test.ts` 測試對所有 `PROTECTED_PREFIXES` 通過（403/401，不允許 200）
- [ ] `scripts/audit-module-gates.cjs` 在 pre-commit 執行，任何 protected prefix 缺 `moduleGate(` 字串時 fail
- [ ] `GET /api/v1/me/modules` 端點按 §2.2.1 形狀回應，customer (role 5) 回 `restaurantId: null`
- [ ] `useModuleAccess` composable 與 `<ModuleGate>` 元件可在 customer-app / admin-dashboard / kitchen-display 三處 import 使用
- [ ] §2.2.4 列出的 3 處 `<ModuleGate>` 接入點全部完成
- [ ] onboarding 完成後 `shopSubscriptions` 必定建立，端到端測試覆蓋四條路徑（standard/professional/enterprise/trial）
- [ ] backfill migration 對所有既存 restaurant 建立 `planTier='enterprise'` 訂閱（見 §6.1）
- [ ] 新建文件 `docs/architecture/modular-billing.md`（pricing tier 對應、moduleGate 套用規範、`<ModuleGate>` 使用範例）

### 2.6 P1 PR 拆分

| PR | 範圍 |
|---|---|
| P1-a | 新增 3 個 module key + `PLAN_DEFAULT_MODULES` 更新 |
| P1-b | Onboarding → Subscription 自動建立 + 測試 |
| P1-c | `GET /me/modules` 端點 + `useModuleAccess` composable |
| P1-d | 套 `moduleGate` 到 Appendix A 標 ⚠️ 的路由 + coverage 測試 |
| P1-e | admin-dashboard 套 `<ModuleGate>` + 文件 |

---

## 3. Phase 2：Usage Metering

> **目標**：對 5 個計量單位建立事件流、聚合表、quota gate 中介層，讓 plan 可以掛上具體的數字限額。

### 3.1 計量單位（鎖定）

| 計量單位 | meter key | 計量點（哪邊發出事件） | 預期單月量級 |
|---|---|---|---|
| 訂單數 | `orders.created` | `OrderService.create()` 成功時 | 100 ~ 50,000 |
| API 呼叫數 | `api.requests` | 全域 middleware（排除 health/info/static） | 10K ~ 5M |
| 列印任務數 | `print.jobs` | `PrintService.dispatch()` | 100 ~ 50,000 |
| AI 分析呼叫 | `ai.requests` | `ai-analytics` package 對外端點 | 0 ~ 1,000 |
| 儲存量（GB） | `storage.bytes` | 每日 cron 快照 R2 + Images 容量 | snapshot |

**不計量**：SMS、Email、KDS 螢幕活躍時數、WebSocket 連線數（後續視需求加入）。

### 3.2 Schema 變更

> 以下程式片段省略既有 imports（`sqliteTable`、`text`、`integer`、`index`、`uniqueIndex`、`relations`、`sql` from `drizzle-orm/sqlite-core` / `drizzle-orm`；`uuidv7` from `uuid`；`restaurants` from `./restaurants`），實作時依 `packages/database/src/schema/subscriptions.ts` 既有 import 風格補齊。

**新增** `packages/database/src/schema/usage-events.ts`：

```typescript
export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey().$defaultFn(() => uuidv7()),
  restaurantId: text("restaurant_id").notNull().references(() => restaurants.id),
  meterKey: text("meter_key").notNull(),       // e.g. "orders.created"
  quantity: integer("quantity").notNull().default(1),

  // 為了除錯／申訴：弱型別 metadata（order id、user id、endpoint 等）
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),

  // 聚合狀態：null = 未聚合，非 null = 已聚合到該 meter cycle
  aggregatedAt: integer("aggregated_at_ms", { mode: "timestamp_ms" }),

  occurredAt: integer("occurred_at_ms", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (t) => ({
  // 必要 index：依 restaurant + meter + 時間查詢、找未聚合事件
  restaurantMeterTimeIdx: index("usage_events_restaurant_meter_time_idx")
    .on(t.restaurantId, t.meterKey, t.occurredAt),
  pendingAggregationIdx: index("usage_events_pending_idx")
    .on(t.aggregatedAt).where(sql`${t.aggregatedAt} IS NULL`),
}));
```

**新增** `packages/database/src/schema/usage-meters.ts`（per-cycle counter）：

```typescript
export const usageMeters = sqliteTable("usage_meters", {
  id: text("id").primaryKey().$defaultFn(() => uuidv7()),
  restaurantId: text("restaurant_id").notNull().references(() => restaurants.id),
  meterKey: text("meter_key").notNull(),

  // 對齊 shopSubscriptions.billingCycleStartAt/EndAt
  cycleStartAt: integer("cycle_start_at_ms", { mode: "timestamp_ms" }).notNull(),
  cycleEndAt: integer("cycle_end_at_ms", { mode: "timestamp_ms" }).notNull(),

  totalQuantity: integer("total_quantity").notNull().default(0),
  lastAggregatedAt: integer("last_aggregated_at_ms", { mode: "timestamp_ms" }),

  createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
    .notNull()
    .$onUpdate(() => new Date()),
}, (t) => ({
  // 同 restaurant + meter + cycle 唯一
  uniqueCycleIdx: uniqueIndex("usage_meters_restaurant_meter_cycle_idx")
    .on(t.restaurantId, t.meterKey, t.cycleStartAt),
}));
```

**新增** `packages/database/src/schema/plan-quotas.ts`（plan tier 對應的限額）：

```typescript
// 先用代碼常數而非 DB 表（與 PLAN_DEFAULT_MODULES 同一風格）
export const PLAN_QUOTAS: Record<PlanTier, Partial<Record<MeterKey, {
  soft: number;   // 80% 通知門檻
  hard: number;   // 100% 拒絕門檻
}>>> = {
  trial:      { /* 全部 unlimited（undefined = no limit） */ },
  basic:      {
    "orders.created":  { soft: 800,    hard: 1000 },
    "api.requests":    { soft: 80000,  hard: 100000 },
    "print.jobs":      { soft: 800,    hard: 1000 },
    "storage.bytes":   { soft: 4_000_000_000, hard: 5_000_000_000 }, // 5GB
  },
  pro:        {
    "orders.created":  { soft: 8000,   hard: 10000 },
    "api.requests":    { soft: 800000, hard: 1000000 },
    "print.jobs":      { soft: 8000,   hard: 10000 },
    "ai.requests":     { soft: 80,     hard: 100 },
    "storage.bytes":   { soft: 40_000_000_000, hard: 50_000_000_000 }, // 50GB
  },
  enterprise: { /* 全部 unlimited，後續可改 DB-driven */ },
};
```

> 數字是**佔位假設**——上線前需 PM 與既有客戶用量校準。本 SPEC 不鎖定具體配額。

### 3.3 計量寫入路徑

#### 3.3.1 `meterEmit` helper（鎖定簽名）

**新增** `apps/api/src/shared/utils/meter.ts`：

```typescript
import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { MeterKey } from '@makanmasak/database';

interface MeterEmitOptions {
  restaurantId?: string;       // 缺省從 c.get('user').restaurantId 推導
  quantity?: number;           // 缺省 1
  metadata?: Record<string, unknown>;
}

/**
 * Emit a usage event. Non-blocking — writes via c.executionCtx.waitUntil when available.
 * In tests/cron without executionCtx, awaits inline.
 */
export async function meterEmit(
  c: Context<{ Bindings: Env }>,
  meterKey: MeterKey,
  options: MeterEmitOptions = {}
): Promise<void> {
  const restaurantId = options.restaurantId ?? c.get('user')?.restaurantId;
  if (!restaurantId) return;  // 沒有 tenant context 就不計量（如公開端點）

  const insertOp = insertUsageEvent(c.env.DB, {
    restaurantId,
    meterKey,
    quantity: options.quantity ?? 1,
    metadata: options.metadata ?? null,
  }).catch((err) => {
    console.error('[meterEmit] insert failed', { meterKey, restaurantId, err });
  });

  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(insertOp);
  } else {
    await insertOp;  // test / cron fallback
  }
}
```

#### 3.3.2 寫入點

**全域 `api.requests`**：`apps/api/src/middleware/usageTracker.ts`
- mount 在 `authMiddleware` 之後
- 排除白名單（不計）：`/health`、`/info`、`/api/v1/auth/**`、`/api/v1/me/modules`、`/api/v1/discovery/**`、`/api/v1/qr/**`、`/api/v1/webhooks/**`
- 排除 method：`OPTIONS`（CORS preflight）
- 失敗策略：寫入失敗只記 `console.error`，**永遠不影響請求**

**Service-level 計量**（同步寫法，保證計量發生在實際業務動作之後）：
- `apps/api/src/features/orders/services/OrderService.ts` 的 `create()` 成功 return 之前 → `meterEmit(c, 'orders.created', { metadata: { orderId } })`
- 列印目前 codebase 沒有獨立 `PrintService.dispatch()`——P2-b 啟動前先稽核 `apps/api/src/features/orders/routes/index.ts:977` 那條 `receipt_printing` gated 路由的實際 handler，把 `meterEmit('print.jobs', ...)` 加在那裡。**若實際是透過 print-agent WebSocket，meter 加在「下發 print job」的端點 handler，不在 print-agent 上**
- `apps/api/src/features/ai-analytics/routes/index.ts` 的每個 `moduleGate('ai_analytics')` 路由 handler 開頭加 `meterEmit(c, 'ai.requests', { metadata: { endpoint: c.req.path } })`

#### 3.3.3 Storage snapshot cron（演算法鎖定）

**真相**：R2 沒有便宜的 prefix-size API。`r2.list({prefix})` 每次回最多 1000 個 object，需 paginate；對 1000 家 × 平均 500 物件 = 50 萬次 list 呼叫，每日不可行。

**採行方案**：**雙寫 counter 表**，cron 只負責對帳。

新增 `packages/database/src/schema/storage-counters.ts`：
```typescript
export const storageCounters = sqliteTable("storage_counters", {
  restaurantId: text("restaurant_id").primaryKey().references(() => restaurants.id),
  r2Bytes: integer("r2_bytes").notNull().default(0),       // 累計 R2 用量
  imagesCount: integer("images_count").notNull().default(0),
  updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" }).notNull().$onUpdate(() => new Date()),
});
```

**寫入路徑**（P2-d 同步補上）：
- 任何 R2 上傳的 service（image upload、receipt PDF）成功後 `UPDATE storage_counters SET r2_bytes = r2_bytes + :size`
- 任何 R2 刪除的 service 成功後 `UPDATE ... SET r2_bytes = MAX(0, r2_bytes - :size)`
- Images API 上傳成功 `UPDATE ... SET images_count = images_count + 1`

**Snapshot cron** `apps/api/src/workers/storage-snapshot.ts`（既有 backup-scheduler worker 加新 schedule `0 2 * * *`）：
- 讀 `storage_counters`，對每個 restaurant 寫一個 `usage_events`（`meterKey='storage.bytes'`、`quantity=r2Bytes`）
- 同時對 R2 抽樣（每月一個 restaurant 全列舉）做對帳，差異超過 10% 寫 Slack alert
- **不**逐一呼叫 R2 list

**Trade-off**：counter 可能漂移（雙寫 race），但每月對帳能矯正；遠優於每日全 list。

### 3.4 Quota Gate Middleware

**新增** `apps/api/src/middleware/quotaGate.ts`：

```typescript
// 用法
router.post('/orders',
  authMiddleware,
  moduleGate('online_ordering'),
  quotaGate('orders.created'),  // 新增
  handler
)
```

#### 3.4.1 套用點（鎖定）

| Meter Key | 套用路由（per-route 掛載） |
|---|---|
| `orders.created` | `POST /api/v1/orders`、`POST /api/v1/orders/group`、`POST /api/v1/guest-orders`（建單入口） |
| `print.jobs` | `apps/api/src/features/orders/routes/index.ts:977` 的列印觸發路由 |
| `ai.requests` | `apps/api/src/features/ai-analytics/routes/index.ts` 所有 `POST` 路由 |

`api.requests` 與 `storage.bytes` **不**用 quotaGate（前者超量直接 429 會打死所有功能；後者非 per-request）——它們由通知服務在 §4.5 軟限制／硬限制邊界發 alert，硬限制下達後由 admin 手動處理（暫停或升級）。

#### 3.4.2 行為（解 race condition）

讀取「當前用量」採用**兩層讀法**避免 cache + aggregator 5 分鐘漂移：

```
effectiveCount =
  usage_meters.totalQuantity (cache 30s)
  + COUNT(usage_events WHERE aggregatedAt IS NULL AND restaurantId=R AND meterKey=K)
```

第二項是「自上次聚合起的未聚合事件數」，直接從 D1 算（不 cache）。讀一次 D1 加一次計數查詢，~10ms 額外開銷可接受。

判定：
- `effectiveCount >= hard`：拋 `quotaExceeded(meterKey, hard)` → `429 QUOTA_EXCEEDED`
- `soft <= effectiveCount < hard`：通過，response header `X-Quota-Warning: ${meterKey} ${pct}%`
- `effectiveCount < soft`：通過
- 該 plan 的 `PLAN_QUOTAS[planTier][meterKey]` 為 `undefined`：unlimited，直接通過

#### 3.4.3 Trial 處理

`planTier === 'trial'`：所有 meter unlimited（`PLAN_QUOTAS.trial = {}`），直接通過。

#### 3.4.4 Bypass 條件

- `user.role === 0`（admin）— bypass
- `c.env.QUOTA_ENFORCEMENT_MODE === 'disabled'` — bypass（見 §6.2）
- `c.env.QUOTA_ENFORCEMENT_MODE === 'warn'` — 不擋 hard、只送 header
- `c.env.QUOTA_ENFORCEMENT_MODE === 'enforce'` — 完整套用

### 3.5 聚合 Cron

**新增** `apps/api/src/workers/usage-aggregator.ts`（既有 backup-scheduler worker 加 schedule `*/5 * * * *`）。

#### 3.5.1 「當前 cycle」決議規則（解 trial 沒有 cycle 邊界問題）

對每個 `(restaurantId, meterKey)` 對組，cycle 邊界依 subscription 狀態決定：

| Subscription 狀態 | `cycleStartAt` | `cycleEndAt` |
|---|---|---|
| `planTier !== 'trial'` 且有 `billingCycleStartAt` | `subscription.billingCycleStartAt` | `subscription.billingCycleEndAt` |
| `planTier === 'trial'` | `subscription.createdAt` | `subscription.trialEndsAt` |
| 無 subscription（理論上 P1 backfill 後不應發生） | event 的 `occurredAt` 所屬日曆月 1 號 00:00 UTC | 當月最後一日 23:59 UTC |

#### 3.5.2 聚合演算法

```sql
-- 偽碼，實際用 Drizzle Layer 2
WITH pending AS (
  SELECT restaurant_id, meter_key, SUM(quantity) AS delta
  FROM usage_events
  WHERE aggregated_at_ms IS NULL
  GROUP BY restaurant_id, meter_key
)
-- 對每個 (restaurant_id, meter_key) 查 subscription 求 cycle，UPSERT usage_meters
-- 然後標記 events.aggregated_at_ms = now
```

- 每次 batch 上限：5000 events（D1 安全範圍）
- 失敗的 batch 留待下次（events 不刪除、`aggregatedAt` 不更新）
- 同 cycle 多次寫入用 SQLite `ON CONFLICT (restaurant_id, meter_key, cycle_start_at_ms) DO UPDATE SET total_quantity = total_quantity + excluded.total_quantity`

#### 3.5.3 事件 TTL Cron

`apps/api/src/workers/usage-events-ttl.ts`，schedule `0 3 * * *`（每日 UTC 03:00，避開聚合與 backup）：
- 刪除 `occurredAt < now - 90 days AND aggregatedAt IS NOT NULL`
- 每次 batch 上限：10000 rows
- 若一輪刪超過上限，下個 schedule 繼續（不開額外迴圈）

### 3.6 用量查詢 API

#### 3.6.1 `GET /api/v1/me/usage`

**回應**：
```typescript
type MeUsageResponse = {
  success: true;
  data: {
    cycleStartAt: number;
    cycleEndAt: number;
    meters: Array<{
      meterKey: MeterKey;
      total: number;          // = effectiveCount（同 quotaGate 計算）
      softLimit: number | null;   // null = unlimited
      hardLimit: number | null;
      percentage: number | null;  // total / hardLimit, null if unlimited
    }>;
  };
};
```

#### 3.6.2 `GET /api/v1/admin/subscriptions/:restaurantId/usage`

Admin (role 0) 限定。Query params：`from?: ISO date`、`to?: ISO date`（缺省為近 6 個 cycle）。回應：歷史 `cycle_snapshots` 列表（每筆含 cycleStartAt/EndAt + usage breakdown）。

#### 3.6.3 `GET /api/v1/admin/subscriptions/:restaurantId/usage/events`

Admin 限定。除錯／申訴用。Query params：`meterKey?`、`from?`、`to?`、`page?`（預設 1）、`limit?`（預設 50，上限 200）。回應分頁的 `usage_events`，含 metadata。

### 3.7 P2 Acceptance Criteria

- [ ] `usage_events` + `usage_meters` 兩表 migrated
- [ ] 5 個 meter 的計量點全部接通，端到端測試（建立訂單 → 5 分鐘內 `usage_meters.totalQuantity` +1）
- [ ] `quotaGate` 套到 `orders.created`、`ai.requests`、`print.jobs` 對應路由
- [ ] 軟限制 header 與硬限制 429 回應驗證通過
- [ ] storage snapshot cron 每日跑成功，至少 1 個 restaurant 有 `storage.bytes` row
- [ ] 用量查詢 API 三個端點上線
- [ ] admin-dashboard 新增「用量」頁籤，可看 cycle 內 meter 進度
- [ ] 文件 `docs/architecture/modular-billing.md` 更新計量單位、計算規則、quota 對應表

### 3.8 P2 PR 拆分

| PR | 範圍 |
|---|---|
| P2-a | Schema migration + `meterEmit` helper + `usageTracker` global middleware |
| P2-b | Service-level meter emits（orders、print、ai）+ aggregation cron |
| P2-c | `quotaGate` middleware + `PLAN_QUOTAS` 常數 + 套用 |
| P2-d | 用量查詢 API + admin-dashboard 用量頁籤 + storage cron |

---

## 4. Phase 3：Billing Lifecycle

> **目標**：cycle 邊界自動結算、trial 自動降級、payment audit log、外部金流 webhook 串接。

### 4.1 Schema 變更

#### 4.1.1 `paymentAuditLog`（補 2026-05-02 技術債掃描的 P1 缺口；該掃描已於 2026-09-05 併入 `docs/TODOS.md` 並刪除）

**鎖定 `eventType` 為 const enum**：

```typescript
// packages/database/src/schema/payment-audit-log.ts
export const PAYMENT_AUDIT_EVENT_TYPES = {
  ATTEMPT: "attempt",
  SUCCESS: "success",
  FAILURE: "failure",
  REFUND: "refund",
  WEBHOOK_RECEIVED: "webhook_received",
  CYCLE_CLOSE: "cycle_close",
  TRIAL_DOWNGRADE: "trial_downgrade",
  PLAN_CHANGE: "plan_change",
  GRACE_PERIOD_START: "grace_period_start",
  ACCOUNT_SUSPENDED: "account_suspended",
} as const;
export type PaymentAuditEventType =
  (typeof PAYMENT_AUDIT_EVENT_TYPES)[keyof typeof PAYMENT_AUDIT_EVENT_TYPES];

export const paymentAuditLog = sqliteTable("payment_audit_log", {
  id: text("id").primaryKey().$defaultFn(() => uuidv7()),
  restaurantId: text("restaurant_id").references(() => restaurants.id),
  paymentTransactionId: text("payment_transaction_id"),  // nullable for non-order events
  subscriptionId: text("subscription_id"),

  eventType: text("event_type").notNull().$type<PaymentAuditEventType>(),
  provider: text("provider"),                // "stripe" | "linepay" | "newebpay" | "internal"
  providerEventId: text("provider_event_id"),
  providerEventType: text("provider_event_type"),

  amount: integer("amount"),                  // cents
  currency: text("currency"),

  rawPayload: text("raw_payload", { mode: "json" }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),

  occurredAt: integer("occurred_at_ms", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (t) => ({
  // 對 webhook 必須 idempotent —— 同一 (provider, providerEventId) 只記一次
  providerEventIdx: uniqueIndex("payment_audit_provider_event_idx")
    .on(t.provider, t.providerEventId)
    .where(sql`${t.providerEventId} IS NOT NULL`),
  // 查詢用：依 restaurant + 時間
  restaurantTimeIdx: index("payment_audit_restaurant_time_idx")
    .on(t.restaurantId, t.occurredAt),
}));
```

#### 4.1.2 `cycleSnapshots`（每 cycle 結算快照）

```typescript
export const cycleSnapshots = sqliteTable("cycle_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => uuidv7()),
  restaurantId: text("restaurant_id").notNull().references(() => restaurants.id),
  subscriptionId: text("subscription_id").notNull(),

  cycleStartAt: integer("cycle_start_at_ms", { mode: "timestamp_ms" }).notNull(),
  cycleEndAt: integer("cycle_end_at_ms", { mode: "timestamp_ms" }).notNull(),

  planTier: text("plan_tier").notNull(),
  modulesSnapshot: text("modules_snapshot", { mode: "json" }).notNull(),
  usageSnapshot: text("usage_snapshot", { mode: "json" }).notNull(),  // { meterKey: total }
  overageCharges: text("overage_charges", { mode: "json" }),

  externalInvoiceId: text("external_invoice_id"),
  externalInvoiceStatus: text("external_invoice_status"),

  closedAt: integer("closed_at_ms", { mode: "timestamp_ms" }).notNull(),
}, (t) => ({
  // cron 重複跑必須 idempotent —— 同 (restaurant, cycleStart) 只結算一次
  uniqueCycleIdx: uniqueIndex("cycle_snapshots_restaurant_cycle_idx")
    .on(t.restaurantId, t.cycleStartAt),
}));
```

#### 4.1.3 `notificationDispatchLog`（解 §4.5 dedup state 問題）

```typescript
// packages/database/src/schema/notification-dispatch-log.ts
export const NOTIFICATION_KINDS = {
  QUOTA_HARD: "quota_hard",
  TRIAL_3D: "trial_3d",
  TRIAL_1D: "trial_1d",
  TRIAL_0D: "trial_0d",
  PAYMENT_FAILED: "payment_failed",
  CYCLE_CLOSED: "cycle_closed",
} as const;
export type NotificationKind =
  (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

export const notificationDispatchLog = sqliteTable("notification_dispatch_log", {
  id: text("id").primaryKey().$defaultFn(() => uuidv7()),
  restaurantId: text("restaurant_id").notNull().references(() => restaurants.id),
  kind: text("kind").notNull().$type<NotificationKind>(),

  // dedupKey 範例："orders.created:cycle:1714579200000"
  // 同 kind 同 cycle 同 meter 只發一次靠這個 unique 擋
  dedupKey: text("dedup_key").notNull(),

  channel: text("channel").notNull(),  // "slack" | "email"
  status: text("status").notNull(),    // "sent" | "failed" | "skipped_provider_unconfigured"
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),

  sentAt: integer("sent_at_ms", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (t) => ({
  uniqueDedupIdx: uniqueIndex("notif_dispatch_dedup_idx")
    .on(t.restaurantId, t.kind, t.dedupKey, t.channel),
}));
```

### 4.2 Cycle 結算流程（cron）

**新增** `apps/api/src/workers/cycle-closer.ts`（既有 backup-scheduler worker 加 schedule `0 * * * *`）：
- 每小時跑
- 找 `shopSubscriptions WHERE billingCycleEndAt <= now AND planTier != 'trial' AND NOT EXISTS (SELECT 1 FROM cycle_snapshots WHERE restaurantId=R AND cycleStartAt=billingCycleStartAt)`
- 對每個：
  1. 觸發最後一次 usage aggregation（呼叫 §3.5 的 aggregator function 強制 flush events）
  2. **`db.batch([...])`** 原子寫入：(a) `cycle_snapshots` row（modules、usage、overage 計算）、(b) 更新 `shopSubscriptions.billingCycleStartAt = oldEndAt`、`billingCycleEndAt = oldEndAt + DEFAULT_BILLING_CYCLE_MS`、(c) 寫 `payment_audit_log`（eventType: `cycle_close`）
  3. 推送到外部訂閱平台 API（**provider 未定，先 stub no-op + Slack alert**——SPEC §1.3 D3 說明）
  4. **不重置** `usage_meters`——新 cycle 自動 INSERT 新 row（透過 unique index）
- `cycle_snapshots` 的 `uniqueCycleIdx` 確保同 cycle 重複跑不會 double-write

### 4.3 Trial 到期：只提醒、不限制（WinRAR 模式）

試用期結束後**不降級、不鎖功能**：`planTier` 維持 `trial`，`moduleGate` 不再檢查 `trialEndsAt`，也不再有 `TRIAL_EXPIRED` 錯誤。原本的 `TrialReaperService`（每日降級為 basic 並清空 `moduleOverrides`）已移除。

- 提醒來源：`/me/modules` 仍回傳 `trialEndsAt`；admin-dashboard 的 `TrialExpiredBanner`（店主限定，可關閉，重新載入後再出現）與 `BillingView` 顯示到期文案。
- 到期前的 email 提醒（`trial_3d` / `trial_1d`）不變；到期後不再寄 `trial_0d`。
- 到期 trial 的用量 cycle 邊界仍是 `trialEndsAt`，見 `usage-aggregator.ts`（到期後的事件不會落在該 cycle 內，尚未處理）。

### 4.4 外部金流 Webhook

**新增** `apps/api/src/features/billing/routes/webhooks.ts`：
- `POST /api/v1/webhooks/billing/:provider` — 接 Stripe/LINE Pay/NewebPay 的 webhook
- **不**走全域 auth middleware（webhook 自帶 provider 簽章驗證）
- 加入 `app-factory.ts` CSRF exclusion list 與 `usageTracker` 白名單

#### 4.4.1 Provider-agnostic 介面

**新增** `apps/api/src/features/billing/services/WebhookProvider.ts`：
```typescript
export interface WebhookProvider {
  name: string;
  verify(rawBody: string, headers: Record<string, string>, secret: string): Promise<boolean>;
  parse(rawBody: string): {
    providerEventId: string;
    eventType: string;       // provider-native event type
    canonical: 'invoice.paid' | 'invoice.payment_failed' | 'subscription.updated' | 'unknown';
    restaurantId?: string;   // 從 metadata 抽出
    amount?: number;
    currency?: string;
    rawPayload: unknown;
  };
}
```

P3-c 上線時實作至少一個（取決於 §5 #1 決策後）。本 SPEC 寫成 stub 介面 + 一個 `noop-provider` 用於開發環境。

#### 4.4.2 處理流程

```
1. 從 :provider 路徑參數查 registry 取得 WebhookProvider 實作
2. provider.verify(rawBody, headers, env[`${PROVIDER}_WEBHOOK_SECRET`])
   - 失敗 → 401，不寫任何資料
3. provider.parse(rawBody) 取 canonical event
4. INSERT payment_audit_log
   - eventType = 'webhook_received'
   - providerEventId 觸發 unique index → 重複 webhook 自動 skip（idempotent）
5. 依 canonical 觸發動作：
   - 'invoice.paid' → UPDATE cycle_snapshots SET externalInvoiceStatus='paid' WHERE externalInvoiceId=...
   - 'invoice.payment_failed' → 進入 grace period（見 §4.4.3）
   - 'subscription.updated' → UPDATE shopSubscriptions.planTier = mapped(provider plan)
   - 'unknown' → 只記 audit log，不動其他 state
6. 回 200
```

#### 4.4.3 Grace period（payment failed）

不立即停權。流程：
1. 寫 `payment_audit_log`（eventType: `grace_period_start`）
2. 觸發通知（kind: `payment_failed`）
3. 7 天後若仍未收到 `invoice.paid`（由 §4.2 cycle-closer 同個 cron 順便 sweep 一次），`UPDATE shopSubscriptions SET isActive=false`、寫 `payment_audit_log`（eventType: `account_suspended`）

### 4.5 通知

**新增** `apps/api/src/features/billing/services/BillingNotificationService.ts`：

#### 4.5.1 觸發條件

| `kind` | 觸發來源 | dedupKey 形式 |
|---|---|---|
| `quota_hard` | `quotaGate` 硬限制命中 | `${meterKey}:cycle:${cycleStartAt}` |
| `trial_3d` / `trial_1d` / `trial_0d` | 既有 backup-scheduler 加 schedule `0 9 * * *`（每日 UTC 09:00 = 台灣 17:00）掃 trial 到期 | `trial:${trialEndsAt}` |
| `payment_failed` | §4.4.3 grace period 進入時 | `payment:${providerEventId}` |
| `cycle_closed` | §4.2 cycle-closer 結算完成時 | `cycle:${cycleStartAt}` |

寫入前先查 `notification_dispatch_log` 是否已有 (`restaurantId`, `kind`, `dedupKey`, `channel`)；存在即 skip（unique index 也會擋，雙重保險）。

#### 4.5.2 通道實作

**Slack**：直接重用 `c.env.SLACK_WEBHOOK_URL`（既有 monitoring 模式，見 `MonitoringService.sendSlackAlert`）。`notification_dispatch_log.channel='slack'`。

**Email**：原規劃選 Resend；2026-09-28 起改為 **Cloudflare Email Service**（`NOTIFICATION_EMAIL` send_email binding），Resend 已從程式移除。
- env 加 `BILLING_EMAIL_FROM`（如 `billing@makanmasak.com`，須在已 onboarding 的網域）
- 若 env 未配置 → `notification_dispatch_log.status='skipped_provider_unconfigured'`，**不報錯**（讓 P3 在 email 設定就緒前可先上 Slack 通道）
- 模板放 `packages/shared/src/email-templates/billing/`，採 MJML→HTML，i18n key 走既有 `apps/onboarding-app/src/i18n` 同套（zh-TW / zh-CN / en-US 三語版）

#### 4.5.3 收件人

- Slack：固定送 `SLACK_WEBHOOK_URL`（內部頻道 `#billing-alerts`）
- Email：送 `restaurants.ownerEmail`（若無則 fallback 至 `restaurants.contactEmail`，再無則 skip + audit log）

### 4.6 P3 Acceptance Criteria

- [ ] `payment_audit_log` + `cycle_snapshots` 兩表 migrated
- [ ] cycle closer cron 每小時跑，至少一個 cycle 端到端結算成功
- [ ] trial reaper cron 證明可降級（測試環境模擬時間）
- [ ] webhook 端點對至少一家金流商驗簽通過、處理 invoice.paid 事件
- [ ] 5 種通知（硬/trial-3d/trial-1d/trial-0d/payment-failed）全部送達；soft quota 只回 `X-Quota-Warning`
- [ ] `payment_audit_log` 對所有 payment 事件 append-only 留痕
- [ ] 文件 `docs/runbooks/billing-incident-response.md` 完成（重複收費／漏收費／webhook 漏接 SOP）

### 4.7 P3 PR 拆分

| PR | 範圍 |
|---|---|
| P3-a | `payment_audit_log` schema + 既有 `paymentTransactions` 寫入點補 audit log |
| P3-b | trial reaper + cycle closer cron + `cycle_snapshots` |
| P3-c | webhook endpoints + 外部金流串接（先一家） |
| P3-d | 通知服務 + email 模板 + runbook |

---

## 5. Open Questions

| # | 問題 | 狀態 |
|---|---|---|
| 1 | 外部金流商選擇（Stripe / 藍新 / LINE Pay） | **暫時 skip**——P3 寫成 provider-agnostic（§4.4.1），金流商選定後實作對應 `WebhookProvider` |
| 2 | 租戶自有部署 license token 機制 | **已取消**：平台代管部署已成為唯一支援模式 |
| 3 | 自建 invoice / proration / dunning | **已決策**：永久 deferred（§8），只接外部平台 |
| 4 | Trial 期間長度 | **已鎖定 14 天**（§2.3.1 `TRIAL_DURATION_MS` 常數） |
| 5 | Plan 升級 cycle 處理 | **已鎖定**：立即生效，不 prorate（外部平台處理 prorate 即可） |
| 6 | Quota 具體數字（§3.2） | 數字佔位中，上線前需用真實客戶 30 天用量校準。**不阻擋 P2 實作**——Codex 用 SPEC 數字實作即可 |
| 7 | Email provider | **已決策**：Resend（§4.5.2）。若 PM 否決可後續換，介面已抽象 |

---

## 6. Migration & Rollout

### 6.1 既有客戶處理

P1 上線時 `shopSubscriptions` 沒有 row 的既有 restaurant：
- 寫 backfill migration：所有現存 restaurant 自動建立 `planTier = 'enterprise'` + `isActive = true` 訂閱（避免破壞既有客戶）
- 之後再依商務決策手動降級

Backfill migration 與 runtime writes 一律產出 UUID v7：runtime 走 schema `$defaultFn(() => uuidv7())` 或 `@makanmasak/utils.generateUUID()`；migration SQL 用 `printf('%08x-%04x-7%03x-%1x%03x-%012x', ...)` 加 `unixepoch('now')*1000` + `random()` 在 SQLite 內合成 v7（見 `migrations_fresh/0046_backfill-enterprise-subscriptions.sql`）。不再允許 `lower(hex(randomblob(16)))` 等非 v7 形式。

### 6.2 Feature flag

P2 的 `quotaGate` middleware 上線時用環境變數 `QUOTA_ENFORCEMENT_MODE`：
- `disabled`：完全 bypass（部署初期）
- `warn`：只發 header，不擋
- `enforce`：完整擋下（最終態）

目前 production 的 `apps/api/wrangler.toml` 已明確設定
`QUOTA_ENFORCEMENT_MODE = "enforce"`；未設定的環境仍由 `quotaGate`
runtime 預設 `disabled`。

### 6.3 觀測

- 每個 PR 上線後監控 Slack `#billing-alerts`
- D1 容量：events 表 90 天 TTL，預估每 restaurant 每月 30K events，1000 家 = 90M rows × 90 天保留——**需上線前驗證 D1 是否撐得住**，撐不住改用 R2 + 異步聚合
- KV 流量：subscription cache 每 5 分鐘 hit 一次，可忽略

---

## 7. 租戶自有部署移除

平台已取消租戶自有部署模式。未上線前直接移除相關資料模型與相容層，不保留 license token、租戶自有 Cloudflare 帳號、部署模式欄位或正規化邏輯。

### 7.1 Schema
- `shopSubscriptions` 不保存部署模式
- Onboarding/tenant tables 不保存租戶 Cloudflare account/token
- 平台 Cloudflare credentials 只存在於平台部署環境變數

### 7.2 Middleware
不再建立 `licenseVerification` hook。`moduleGate` 一律從 DB + KV cache 讀取平台訂閱狀態。

### 7.3 計量回報
不再建立租戶自有部署 `usageReporter`。平台代管 Worker 直接寫入中央 `usage_events`。

---

## 8. Deferred TODO（永久不做或下版以後）

| 項目 | 原因 | 替代方案 |
|---|---|---|
| **自建發票生成** | 法遵風險高（台灣電子發票格式、加值稅、退換貨開票邏輯）、6 個月以上工程量 | 接外部金流／訂閱平台（Stripe Billing、藍新訂閱、LINE Pay 訂閱）由其開立發票 |
| **自建 proration 計算** | 邊界 case 太多（plan 切換時點、refund、信用額） | 同上，由外部平台處理 |
| **自建 dunning（催繳流程）** | 需 retry schedule、信用卡更新提醒、多通道通知整合 | 同上 |
| **Admin UI 管理 plan tier 內容** | 目前 hardcode 已足夠，加 admin UI 是 nice-to-have | 直接改 `PLAN_DEFAULT_MODULES` 常數，重新 deploy |
| **租戶自帶 Cloudflare 部署** | 已由產品流程取消；租戶直接使用平台資源 | 不實作，不保留資料模型或相容正規化 |
| **更多計量單位**（SMS、email、KDS 螢幕活躍時數、WebSocket 連線） | 目前 5 個已涵蓋核心商業價值 | 視商務需求加入，schema 已支援（meterKey 是字串） |

---

## 9. Implementation Conventions（給 Codex）

### 9.1 檔案位置慣例

| 類別 | 路徑 | 範例 |
|---|---|---|
| Schema 定義 | `packages/database/src/schema/{kebab-name}.ts` | `usage-events.ts` |
| Schema 常數（plan、quotas） | `packages/database/src/{kebab-name}.ts`（**非 schema/**） | `plan-quotas.ts`、`utils/plan-mapping.ts` |
| Drizzle 匯出 | `packages/database/src/index.ts` 加 `export *` | — |
| API middleware | `apps/api/src/middleware/{camelName}.ts` | `quotaGate.ts`、`usageTracker.ts` |
| API helper utils | `apps/api/src/shared/utils/{camelName}.ts` | `meter.ts` |
| API feature | `apps/api/src/features/{kebab-name}/{routes,services,schemas,__tests__}/` | `features/billing/` |
| 共用 composable | `packages/shared/composables/{useCamelName}.ts` | `useModuleAccess.ts` |
| 共用元件 | `packages/shared/components/{PascalName}.vue` | `ModuleGate.vue` |
| 共用 store | `packages/shared/stores/{camelName}.ts` | `moduleAccess.ts` |
| Email templates | `packages/shared/src/email-templates/billing/{kebab-name}.{mjml,ts}` | `quota-soft.mjml` |
| Cron worker | `apps/api/src/workers/{kebab-name}.ts`（mount 在 `apps/api/wrangler.toml` triggers） | `usage-aggregator.ts` |

### 9.2 命名慣例

- **Module key**：snake_case（既有慣例，見 `MODULES.kitchen_display`）
- **Meter key**：dot.notation（`orders.created`、`api.requests`）—— 模仿 metric naming，左側為 namespace
- **API route**：kebab-case（`/api/v1/me/modules`、`/api/v1/admin/subscriptions`）
- **DB column**：snake_case；TS field 對應 camelCase（Drizzle 既有慣例）
- **Audit / notification kind**：snake_case 對應 const enum

### 9.3 錯誤處理

- 一律用 `apps/api/src/shared/utils/api-error.ts` 的 factory（`badRequest`、`forbidden`、`notFound`）—— 不在 route handler 寫 try/catch 包成回應
- **新增** factory `quotaExceeded(meterKey: MeterKey, hardLimit: number)` → 回 `429 QUOTA_EXCEEDED`，details 含 `{ meterKey, hardLimit, current }`

### 9.4 KV cache key 慣例

| 用途 | Key | TTL |
|---|---|---|
| Subscription | `subscription:${restaurantId}` | 300s（既有） |
| Usage meter cache | `usage_meter:${restaurantId}:${meterKey}:${cycleStartAt}` | 30s |
| Webhook idempotency（assist DB） | `webhook_seen:${provider}:${providerEventId}` | 86400s（24h） |

Cache invalidation hook：subscription 變更走既有 `invalidateSubscriptionCache(c, restaurantId)`；usage meter cache 由聚合 cron 結束時批次清。

### 9.5 D1 寫入慣例

- 所有跨表原子寫入用 `db.batch([...])`（D1 不支援多語句 transaction）
- 大量 INSERT（聚合、TTL 清理）每批 ≤ 5000 rows
- 一般 feature 的 INSERT/UPSERT 用 Drizzle Layer 1/2（query builder 或 `sql` template + schema refs），不寫 raw string SQL
- Billing/usage metering 的 cron worker、metering hot path、D1 `batch`、idempotent UPSERT 暫時允許使用參數化 D1 prepared statements；禁止字串拼接 SQL，動態條件必須白名單組合並只用 bound parameters
- 所有新增 row id 一律 UUID v7：runtime 走 `generateUUID()` / schema `$defaultFn(() => uuidv7())`；migration SQL 走 §6.1 的 `printf` 合成式

### 9.6 環境變數

P2/P3 新增：
| 變數 | 用途 | 預設 |
|---|---|---|
| `QUOTA_ENFORCEMENT_MODE` | `disabled` / `warn` / `enforce` | runtime 預設 `disabled`；production 設定 `enforce` |
| `NOTIFICATION_EMAIL`（send_email binding） | Email 寄送 | 未綁定時降級為 skip + audit log |
| `BILLING_EMAIL_FROM` | Email From 地址 | 未設定時降級為 skip + audit log |
| `STRIPE_WEBHOOK_SECRET`（或對應 provider） | Webhook 驗簽 | P3-c 啟動前設定 |

---

## 10. Test Strategy & Observability

### 10.1 每 PR 的測試最小集

| PR | Unit | Integration（mock D1）| E2E（Wrangler dev）|
|---|---|---|---|
| P1-a | `PLAN_DEFAULT_MODULES` 含 3 新 key | migration 跑得過、`getEffectiveModules` 對新 key 正確 | — |
| P1-b | — | `OnboardingService` 4 條 `planId` 路徑各建一筆 row | onboarding-app → management-api → DB 端到端建立 |
| P1-c | `useModuleAccess` 5 種狀態（loading/loaded/empty/expired/error）| `/me/modules` 回應形狀對 staff/admin/customer 三種 role | — |
| P1-d | — | **§2.1 coverage test 必跑**；對 8 個新掛 gate 的路由各打一個 unauth request | — |
| P1-e | — | `<ModuleGate>` 三種 slot（default/fallback/loading）渲染 | admin-dashboard 三個接入點手測 |
| P2-a | `meterEmit` 在有/無 `executionCtx` 兩種環境下都寫入 | schema migrate、`usageTracker` middleware 對白名單外路由都產 events | — |
| P2-b | `OrderService.create` 觸發 meter | aggregator cron 對 `(rest, meter, cycle)` UPSERT 正確 | — |
| P2-c | `quotaGate` 三段（< soft / soft-hard / >= hard）行為 | `effectiveCount` 正確（cache + 未聚合 events）、`QUOTA_ENFORCEMENT_MODE` 三模式 | — |
| P2-d | 用量查詢 API 回應形狀 | `/me/usage`、`admin/usage`、`admin/usage/events` | admin-dashboard 用量頁籤手測 |
| P3-a | `paymentAuditLog` unique index 擋重複 webhook | — | — |
| P3-b | `cycle-closer` 跑兩次相同 cycle 不 double-write | trial-reaper 正確降級 + audit log + 通知 | — |
| P3-c | `WebhookProvider.verify` mock + parse | webhook 端到端：post → audit log → cycle_snapshots 變更 | — |
| P3-d | dedupKey 同 cycle 同 meter 第二次發 skip | Resend 失敗時 fallback Slack | — |

**所有測試必用 `@makanmasak/testing-utils` factory**（CLAUDE.md 既有規範）。

### 10.2 Observability

每個 phase 上線後必加的 log/metric/alert：

**P1**
- log（structured JSON）：`moduleGate.denied { module, restaurantId, planTier, reason }` —— 每次 deny 一筆
- Slack alert：`onboarding 完成但 shopSubscriptions 建立失敗`（這代表 batch rollback 時的孤兒 restaurant）

**P2**
- log：`meterEmit.failed { meterKey, restaurantId, error }`（D1 寫入失敗）
- log：`usageAggregator.batch { processed, restaurants, durationMs }`（每次 cron 跑完）
- Slack alert：聚合 cron 連續 3 次失敗 / 單次 batch > 5000 events 等待中
- Slack alert：`storage_counters` 與 R2 對帳差異 > 10%（§3.3.3）

**P3**
- log：`cycleCloser.closed { restaurantId, cycleStartAt, totalEvents }`
- log：`trialReaper.downgraded { restaurantId, trialEndsAt }`
- log：`webhookReceived { provider, providerEventId, canonical }`
- Slack alert：webhook 驗簽失敗 / 5 分鐘內重複 webhook（疑似 replay 攻擊）
- Slack alert：cycle-closer cron 連續 2 次失敗
- Slack alert：grace period 進入 7 天即將強制停權前 24h

### 10.3 觀測整合

所有 Slack alert 走既有 `c.env.SLACK_WEBHOOK_URL` + `MonitoringService.sendSlackAlert` 路徑——不另開新 webhook。

---

## Appendix A：Module → Routes 完整對應表（已稽核）

> 稽核日期：2026-05-03。基於 `apps/api/src/app-factory.ts` 的路由 mount + 各 feature 內 `moduleGate(...)` 使用。

### A.1 已掛 gate（13 個 feature，無動作）

| 路由 prefix | Feature | Module Key | 套用方式 |
|---|---|---|---|
| `/api/v1/menu/**` | `menu` | `menu_management` | per-route（12 處） |
| `/api/v1/tables/**` | `tables` | `table_management` | per-route（12 處） |
| `/api/v1/seats/**` | `seats` | `table_management` | per-route（11 處） |
| `/api/v1/orders/**` | `orders` | `online_ordering` / `analytics` / `receipt_printing`（混合） | per-route（12 處，依端點性質） |
| `/api/v1/orders/group/**` | `group-orders` | `online_ordering` | per-route（6 處） |
| `/api/v1/kitchen/**` | `kitchen` | `kitchen_display` | per-route（5 處） |
| `/api/v1/coupons/**` | `coupons` | `coupons` | per-route（11 處） |
| `/api/v1/reservations/**` | `reservations` | `reservations` | `app.use("/*")` 全 prefix |
| `/api/v1/waiting-list/**` | `waiting-list` | `reservations` ⚠️ | `app.use("/*")` 全 prefix（**queue spec 計畫拆成 `waiting_list`**，本 SPEC 不動） |
| `/api/v1/analytics/**` | `analytics` | `analytics` | `routes.use("*")` 全 prefix |
| `/api/v1/ai-analytics/**` | `ai-analytics` | `ai_analytics` | per-route（9 處） |
| `/api/v1/partnerships/**` | `partnerships` | `loyalty` | per-route（19 處） |
| `/api/v1/integrations/admin/**` | `integrations/admin` | `platform_integration` | `adminRoutes.use("/*")` 全 prefix |

### A.2 ⚠️ 需新掛 gate（P1-d 動作）

| 路由 prefix | Feature | 建議 Module Key | 備註 |
|---|---|---|---|
| `/api/v1/pos/**` | `pos` | **`pos`（新增）** | 子路由：cash-movements, receipts, refunds, registers, reports, shifts。POS 是獨立產品線（內用收銀），與 `online_ordering`（QR 點餐）不同 |
| `/api/v1/forecast/**` | `forecast` | `analytics` | 預測屬於 analytics tier |
| `/api/v1/ingredients/**` | `ingredients` | **`inventory`（新增）** | 庫存管理是獨立模組 |
| `/api/v1/scheduling/**` | `scheduling` | **`staff_management`（新增）** | 員工排班 |
| `/api/v1/leaves/**` | `leaves` | **`staff_management`（新增）** | 員工請假，與 scheduling 同模組 |
| `/api/v1/feedback/**` | `feedback` | `analytics` | 回饋彙整視為 analytics 衍生 |
| `/api/v1/queue/**` | `queue` | `queue` ⚠️ | **由 queue spec 處理**，本 SPEC 不動。Queue spec 上線前不需強制 gate |
| `/api/v1/payments/**` | `payments` | `online_ordering` | 訂單金流，與 online_ordering 綁同生命週期 |

### A.3 Core / Infra（不需 gate，9 + 個 feature）

| 路由 prefix | Feature | 不 gate 理由 |
|---|---|---|
| `/api/v1/auth/**` | `authentication`、`verification` | 認證本身，gate 它會造成 deadlock |
| `/api/v1/qr/**` | `qr-codes` | 桌位 QR 與顧客面向，core 功能 |
| `/api/v1/restaurants/**` | `restaurants` | 租戶自身管理 |
| `/api/v1/users/**` | `users` | 員工帳號管理（多角色），core |
| `/api/v1/realtime/**`、`/sse/**`、`/push/**`、`/notifications/**` | 4 個 | 傳輸層 infra |
| `/api/v1/system/**`、`/monitoring/**`、`/audit/**`、`/audit-logs/**`、`/cache/**`、`/backup/**` | 6 個 | Ops / admin |
| `/api/v1/discovery/**` | `discovery` | 公開餐廳發現，無認證 |
| `/api/v1/admin/**`、`/admin/subscriptions/**`、`/manager/**` | 3 個 | Admin 自身管理 |
| `/api/v1/customers/**` | `customers` | **顧客自助端點**（role 5 查自己的 profile / 訂單），非店家 CRM。Gate 它會與 `online_ordering` 價值衝突。未來若長出店家用的會員/CRM 管理路由，會是新 feature directory，屆時再 gate |
| `/api/v1/guest-orders/**` | `guest-orders` | 訪客 token 已防護；底層仍走 orders service（已 gated）|
| `/api/v1/info`、`/health` | — | 公開 liveness probe |

### A.4 更新後的 `MODULES` 與 `PLAN_DEFAULT_MODULES`（P1-a 落地）

```typescript
export const MODULES = {
  // Core (always included)
  MENU_MANAGEMENT: "menu_management",
  TABLE_MANAGEMENT: "table_management",
  ONLINE_ORDERING: "online_ordering",

  // Pro
  KITCHEN_DISPLAY: "kitchen_display",
  RECEIPT_PRINTING: "receipt_printing",
  COUPONS: "coupons",
  RESERVATIONS: "reservations",
  ANALYTICS: "analytics",
  POS: "pos",                              // ← 新增

  // Enterprise
  AI_ANALYTICS: "ai_analytics",
  PLATFORM_INTEGRATION: "platform_integration",
  LOYALTY: "loyalty",
  INVENTORY: "inventory",                   // ← 新增
  STAFF_MANAGEMENT: "staff_management",     // ← 新增
} as const;
```

`PLAN_DEFAULT_MODULES` 更新：
- `basic`：不含三個新模組
- `pro`：加 `pos: true`
- `enterprise`：加 `pos / inventory / staff_management: true`
- `trial`：加全部三個 `: true`

---

---

## Appendix B：Meter Key 定義

| Meter Key | 觸發點 | 計量單位 | 寫入時機 |
|---|---|---|---|
| `orders.created` | `OrderService.create()` 成功 | 單筆 | 同步前置／非同步寫入 |
| `api.requests` | 全域 middleware | 單次請求 | `executionCtx.waitUntil` |
| `print.jobs` | `PrintService.dispatch()` 成功 | 單筆 | `executionCtx.waitUntil` |
| `ai.requests` | ai-analytics 對外端點 wrapper | 單次呼叫 | 同步前置 |
| `storage.bytes` | 每日 cron snapshot | bytes（snapshot value，非 delta） | cron 直接 UPSERT meter |
