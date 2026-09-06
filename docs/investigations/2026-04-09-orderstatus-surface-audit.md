# OrderStatus Surface Audit

**Date:** 2026-04-09
**Last updated:** 2026-04-10
**Related issue:** #9
**Status:** Historical audit — implementation mostly complete as of 2026-04-29

> Current note (2026-04-29): the major migration described here has already
> landed. `@makanmasak/shared-types` now exports `OrderStatus` as a canonical
> string union derived from `ORDER_STATUSES`, API validation/OpenAPI contracts
> use the same runtime tuple, and DB/query/status-transition code is string
> based. Treat the numeric-enum sections below as historical context, not as a
> current migration backlog.
>
> Addendum (2026-07-05): sections below discussing `apps/realtime/src/advanced-realtime-session.ts`'s
> `OrderLifecycleState` enum are even more thoroughly moot than "migrated" —
> that file was deleted in its entirety (commit `97aa93cd chore(realtime):
> remove unused advanced session`, 2026-06-13), not just updated to the
> string-based OrderStatus. Current realtime code is
> `apps/realtime/src/durableObjects/RealtimeSession.ts`.

## Summary

**Total surface area:** **114 source files** across 11 apps/packages (within Issue #9's 80-120 estimate). The two unchanged areas are `apps/management-portal` and `apps/onboarding-app` (zero references).

**OrderStatus-shaped definitions discovered:** **11 distinct definitions** — Issue #9 stated "three". The four extra named ones are:
- (4) `apps/admin-dashboard/src/types/index.ts:117` — string enum
- (5) `apps/admin-dashboard/src/components/dashboard/RecentOrders.vue:124` — inline string union
- (6) `apps/kitchen-display/src/types/index.ts:3` — **numeric literal union `0|1|2|3|4|5|6`**
- (7) `packages/testing-utils/src/factories/order.factory.ts:84` — string const
- (8) `apps/api/src/openapi/integration.ts:277` — public Swagger Zod enum (5 members only)

Plus four implicit/inline status unions:
- `apps/admin-dashboard/src/composables/useRealtimeOrderStatus.ts:6-12` — 6-member WebSocket schema
- `apps/kitchen-display/src/utils/offline-storage.ts:6-16` — 4-member IndexedDB schema with the never-elsewhere value `"received"`
- `apps/api/src/features/orders/schemas/validation.ts:23-31` — Zod, missing `refunded`
- `apps/api/src/contracts/schemas/orders.ts:22-30` — Zod, missing `refunded`

**Hardcoded numeric literal sites:** **33 sites in 13 files** (Issue #9 said "9+"). All in `apps/customer-app` (5) and `apps/kitchen-display` (28). Admin-dashboard and api have **zero** hardcoded numeric literals — those drift purely at the type level.

**Runtime `typeof status === "number"` guards:** **5 sites in 3 files** (Issue #9 said "4 sites") — bridging numeric/string wire formats. All become dead code (or, in the kitchen-display case, get flipped to `"string"` to trigger one-time cache invalidation).

**Dead code identified for deletion in Phase 3 sweep:**
- `OrdersService.normalizeStatus`, `statusStringToEnum` Record, `OrderLifecycleState.SERVING/COMPLETED`, KitchenService numeric guards, `OrderPermissions` interface (no production caller), `apps/api/src/examples/*.ts.disabled`, `apps/kitchen-display/priority3-*.txt`.

**DO migration strategy:** **Option A — lazy migration on wakeup** (§8.3) with a narrow value-coercion table (`completed → delivered`, `serving → ready`) deletable after 60-day safety window. Recommended over cron-sweep (no DO enumeration API available) and dual-read (overkill for one-time rename).

**External consumer risk:** **None outside the monorepo.** No SDK packages exist. The dynamically-generated Swagger UI at `apps/api/src/openapi/integration.ts:277` ships a wrong 5-member enum that must be updated in lockstep, but no third party is known to consume it.

**Critical pre-existing bugs surfaced by the audit:**
1. `apps/customer-app/src/views/OrderTrackingView.vue` — uses `Record<number, …>` lookups for icons/colors/titles/progress against a string `.status` field. Currently silently degrading to default UI branches. Same pattern in `OrderHistoryView.vue`, `OrderItemCard.vue`, `format.ts`. This migration FIXES those, doesn't break them.
2. `apps/api/src/openapi/integration.ts` Swagger UI enum has only 5 members — public API docs misrepresent the contract.
3. `OrdersService.normalizeStatus` numeric→string map missing `7: "refunded"` — would 500 if a numeric `7` ever arrived.

**Estimated execution effort:** Phase 1-8 of the implementation plan. Phases 0/0.5 (this) committed in 10 commits. Phase 1 is a single failing-test commit. Phases 2-5 are the bulk of the rewrite (touching ~80-90 files across api/realtime/customer/kitchen/admin and the testing-utils factory). Phase 6 is the deploy choreography. Phases 7-8 are post-deploy verification + cleanup (delete coercion table after 60-day window).

**Plan adjustments triggered by this audit (require user awareness, not necessarily a re-plan):**
- Plan §1 says "three definitions" — actual is 11. Phase 3 sweep targets must be expanded to all 11.
- Plan does not currently mention `apps/api/src/openapi/integration.ts` — must be added to Phase 2 task list.
- Plan does not mention `apps/kitchen-display/src/types/index.ts` numeric literal union explicitly — Phase 5 must call it out.
- Plan §6 caller audit estimate of "external wire risk" is downgraded: `getAllowedStatusTransitions` has zero HTTP/realtime callers (only test).
- Plan Phase 6.3 forced-reload requires building a server-signaled mechanism — there is no `__APP_VERSION__` build-time stamp today.


## 1. Type Definitions Inventory

Three divergent `OrderStatus`-shaped types exist in the monorepo. The DB schema is the intended source of truth.

### 1.1 packages/shared-types/src/order.ts

**Location:** `packages/shared-types/src/order.ts:95-103`

**Verbatim source:**

```typescript
export enum OrderStatus {
  PENDING = 0,
  CONFIRMED = 1,
  PREPARING = 2,
  READY = 3,
  DELIVERED = 4,
  PAID = 5,
  CANCELLED = 6,
}
```

**Shape:** TypeScript numeric enum (emits bidirectional object — `OrderStatus[0] === "PENDING"` and `OrderStatus.PENDING === 0`).

**Value count:** 7 members.

**Divergence from DB source of truth:**
- ❌ Numeric wire format (0–6) — DB stores string values (`"pending"`, `"confirmed"`, ...).
- ❌ Missing `REFUNDED` — DB has 8 members; this enum has 7.
- ❌ Any comparison `order.status === OrderStatus.PENDING` compares a DB string against numeric `0`, silently evaluating false. This is the root cause of the PR #7 filter bug.

---

### 1.2 packages/database/src/schema/orders.ts

**Location:** `packages/database/src/schema/orders.ts:14-26`

**Verbatim source:**

```typescript
// 訂單狀態定義
export const ORDER_STATUS = {
  PENDING: "pending", // 待確認
  CONFIRMED: "confirmed", // 已確認
  PREPARING: "preparing", // 準備中
  READY: "ready", // 已完成
  DELIVERED: "delivered", // 已送達
  PAID: "paid", // 已付款
  CANCELLED: "cancelled", // 已取消
  REFUNDED: "refunded", // 已退款
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
```

**Shape:** String const object + derived string-union type.

**Value count:** 8 members.

**Divergence:** None — this is the canonical source. All other definitions must match this set exactly. Drizzle column definition on `orders.status` stores these as `TEXT` (SQLite) with `pending` default.

---

### 1.3 apps/realtime/src/advanced-realtime-session.ts

**Location:** `apps/realtime/src/advanced-realtime-session.ts:156-164`

**Verbatim source:**

```typescript
enum OrderLifecycleState {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  PREPARING = "preparing",
  READY = "ready",
  SERVING = "serving",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}
```

**Shape:** TypeScript string enum (values align with DB naming convention — lowercase strings — but membership differs).

**Value count:** 7 members.

**Divergence from DB source of truth:**
- ❌ Has `SERVING` ("serving") — not in DB. UI-derivable state per Phase 0.5 proposal (drop; derive from `status === 'ready'` + crew assignment).
- ❌ Has `COMPLETED` ("completed") — DB uses `DELIVERED` ("delivered") for the same concept. Realtime-local naming drift.
- ❌ Missing `DELIVERED` — replaced locally by `COMPLETED`.
- ❌ Missing `PAID` — realtime lifecycle graph terminates at `COMPLETED`, so paid/refunded are not modeled.
- ❌ Missing `REFUNDED` — same reason.
- ⚠️ Transition map (lines 207-224) encodes a different lifecycle graph than the DB expects. Any broadcast that emits `SERVING` or `COMPLETED` will carry values unknown to frontends once they migrate to the canonical string union.

## 2. File-Level Reference Inventory

### 2.1 apps/api

**File count:** 32 files (30 source, 2 `.disabled` examples), 474 occurrences.

**Per-file classification (high-risk only — full table noisy):**

| File | Import source | Usage pattern | Migration risk |
|------|---------------|---------------|----------------|
| `src/features/orders/types/index.ts` | **dual import** — `DbOrderStatus` from `@makanmasak/database` AND `OrderStatus` from `@makanmasak/shared-types` (lines 14, 20) | PR #7 partial-fix workaround: query filters use `DbOrderStatus[]` (line 142), everything else still on numeric `OrderStatus` | 🔴 high — must collapse to single canonical type when shared-types is rewritten in Phase 2 (Task 13) |
| `src/features/orders/services/OrdersService.ts` | shared-types numeric `OrderStatus` | 31 refs; `normalizeStatus()` (line 1227-1243), `validateStatusTransition()` (1245-1269), `getAllowedStatusTransitions()` (1271-1285), `broadcastOrderStatusUpdate(prev, new: OrderStatus)` (1033-1042) | 🔴 high — Phase 2 Tasks 14-16 directly target this file |
| `src/features/orders/routes/index.ts` | mixed | 24 refs; 2 `typeof status === "string"` guards (lines 75, 95) for query parsing | 🔴 high — Phase 3 cleanup |
| `src/features/orders/schemas/validation.ts` | inline Zod | **6th OrderStatus definition** — `orderStatusSchema = z.enum([7 strings])` (lines 23-31), missing `refunded` | 🔴 high — Phase 2 must add `refunded` |
| `src/contracts/schemas/orders.ts` | inline Zod | **7th OrderStatus definition** — `OrderStatusEnum = z.enum([7 strings])` (lines 22-30), missing `refunded` | 🔴 high — contract test fixture; pinned by `pnpm contract:check`. Update before shared-types changes land or contract tests fail in CI. |
| `src/features/kitchen/services/KitchenService.ts` | shared-types | 5 refs; 2 `typeof === "number"` defensive guards (lines 157, 178) | 🟡 medium — Phase 2 Task 17 |
| `src/services/RealtimeBroadcastService.ts` | shared-types `OrderStatusUpdateEvent` | 3 refs; constructs the broadcast payload | 🟡 medium — wire format change |
| `src/features/orders/__tests__/state-machine.test.ts` | shared-types numeric enum | **79 refs** — largest test file. Uses `OrderStatus[toStatus.toUpperCase() as keyof typeof OrderStatus]` reverse-lookup (line 229-231), which only works on numeric enums | 🔴 high — must rewrite the lookup pattern |
| `src/features/orders/__tests__/cache-coherence.test.ts` | shared-types numeric enum | **76 refs** — `OrderStatus.PENDING`, `OrderStatus.CONFIRMED` everywhere | 🔴 high — mass replacement |
| `src/features/orders/__tests__/service.test.ts` | shared-types | 32 refs | 🟡 medium |
| `src/features/orders/__tests__/routes.test.ts` | shared-types | 31 refs | 🟡 medium |
| `src/features/orders/__tests__/schemas.test.ts` | shared-types | 26 refs | 🟡 medium |
| `src/features/orders/__tests__/feature.test.ts` | shared-types | 19 refs | 🟡 medium |
| `src/features/orders/__tests__/realtime-integration.test.ts` | shared-types | 18 refs | 🟡 medium |
| `src/features/orders/__tests__/permissions.test.ts` | shared-types | 12 refs | 🟡 medium |
| `src/features/orders/__tests__/bulk-operations.test.ts` | shared-types | 12 refs | 🟡 medium |
| `src/features/orders/__tests__/tenant-isolation.test.ts` | shared-types | 10 refs | 🟡 medium |
| `src/features/orders/__tests__/contract.test.ts` | shared-types | 8 refs | 🟡 medium |
| `src/features/orders/__tests__/analytics.test.ts` | shared-types | 6 refs | 🟢 low |
| `src/services/__tests__/RealtimeBroadcastService.test.ts` | shared-types | 9 refs | 🟢 low |
| `src/services/__tests__/broadcast-integration.test.ts` | shared-types | 9 refs | 🟢 low |
| `src/__tests__/security/business-logic-security.test.ts` | shared-types | 6 refs | 🟢 low |
| `src/features/group-orders/services/GroupOrdersService.ts` | shared-types | 3 refs | 🟢 low |
| `src/features/group-orders/types/index.ts` | shared-types | 2 refs | 🟢 low |
| `src/features/group-orders/index.ts` | shared-types | 1 ref | 🟢 low |
| `src/features/kitchen/__tests__/orders.test.ts` | shared-types | 3 refs | 🟢 low |
| `src/features/kitchen/types/index.ts` | shared-types | 1 ref | 🟢 low |
| `src/features/customers/__tests__/integration.test.ts` | shared-types | 2 refs | 🟢 low |
| `src/openapi/integration.ts` | shared-types / OpenAPI doc | 5 refs — public OpenAPI schema definition | 🔴 high — wire-format documentation; downstream consumers read this |
| `src/features/orders/index.ts` | re-export | 2 refs | 🟢 low |
| `src/examples/PaymentSystemUsage.ts.disabled` | n/a | dead | ⚪ skip |
| `src/examples/StripeIntegrationExample.ts.disabled` | n/a | dead | ⚪ skip |

### 2.2 apps/realtime

**File count:** 8 files (1 production source `advanced-realtime-session.ts` + 7 test files), 19 (lifecycle) + 38 (other) occurrences.

| File | Import source | Usage pattern | Migration risk |
|------|---------------|---------------|----------------|
| `src/advanced-realtime-session.ts` | **local enum** `OrderLifecycleState` (see §1.3) | 19 refs; transition graph map (lines 207-224); `currentState: OrderLifecycleState.PENDING` (line 445); persisted into DO storage | 🔴 high — drives Phase 4 (DO migration) |
| `src/__tests__/integration/durable-object-persistence.test.ts` | shared-types `OrderStatusUpdateEvent` | 13 refs — directly tests hibernation/wakeup with status fields | 🔴 high — must include §8 migration verification |
| `src/__tests__/integration/connection-stress.test.ts` | shared-types | 9 refs | 🟡 medium |
| `src/__tests__/integration/cross-room-communication.test.ts` | shared-types | 8 refs | 🟡 medium |
| `src/__tests__/offline-reconnection.test.ts` | shared-types | 3 refs | 🟢 low |
| `src/__tests__/message-routing.test.ts` | shared-types | 3 refs | 🟢 low |
| `src/__tests__/unit/routing/broadcast-logic.test.ts` | shared-types | 1 ref | 🟢 low |
| `src/__tests__/unit/routing/event-filtering.test.ts` | shared-types | 1 ref | 🟢 low |

### 2.3 apps/customer-app

**File count:** 8 files, 23 occurrences. **+ 5 hardcoded numeric literal sites that don't reference `OrderStatus` by name** (see §3).

| File | Import source | Usage pattern | Migration risk |
|------|---------------|---------------|----------------|
| `src/views/OrderTrackingView.vue` | shared-types `OrderStatus` (numeric enum) | 7 refs. **Indexes Record<number, …> by `.status`** for icons/colors/titles/descriptions/progress (lines 488-555). Works because shared-types numeric enum coerces to numeric keys, BUT the actual API returns strings — currently silently broken (every lookup falls back to default). Also has `=== 0`, `=== 1`, `=== 6` literals (lines 424, 474). | 🔴 critical — broken in production today, just degrading silently |
| `src/views/OrderHistoryView.vue` | none (template literal) | `v-if="order.status === 0"` (line 217) | 🔴 high — same broken pattern |
| `src/components/OrderItemCard.vue` | none | `v-if="item.status === 1"` (line 71) | 🔴 high |
| `src/utils/format.ts` | none | `formatOrderStatus(status: number)` with Record<number, string> i18n lookup (lines 273-285) | 🔴 high — same broken pattern |
| `src/services/orderApi.ts` | shared-types `OrderStatus` | 3 refs; type annotation only | 🟡 medium |
| `src/services/customerOrderApi.ts` | shared-types `OrderStatus` | 2 refs; type annotation only | 🟡 medium |
| `src/utils/push-notifications.ts` | inline `status: string` param | 2 refs; just passes through | 🟢 low |
| `src/tests/i18n.integration.test.ts` | n/a | 3 refs to translation keys | 🟢 low |
| `e2e/core-user-flows.spec.ts` | n/a | 4 refs | 🟢 low |
| `e2e/utils/test-helpers.ts` | n/a | 1 ref | 🟢 low |

### 2.4 apps/kitchen-display

**File count:** 23 files (20 source, 2 `.txt` analysis docs, 1 `.snap`), 147 occurrences.

**🚨 Kitchen-display ships its own numeric-literal-union OrderStatus type AND has the largest concentration of hardcoded numeric literal sites in the monorepo (~28 sites).** Combined with the localStorage validator that asserts `typeof status === "number"`, this app is the highest-risk migration target.

| # | File:line | Definition |
|---|-----------|------------|
| (6) | `apps/kitchen-display/src/types/index.ts:3` | `export type OrderStatus = 0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6` — numeric literal union |
| (extra) | `apps/kitchen-display/src/utils/offline-storage.ts:6-16` | `OfflineOrderStatusUpdate.status: "received" \| "preparing" \| "ready" \| "completed"` — IndexedDB persistence schema with values that don't match anything else |

| File | Import source | Usage pattern | Migration risk |
|------|---------------|---------------|----------------|
| `src/types/index.ts` | **local numeric union** | 4 refs; the type itself + `KitchenOrder.status` + `OrderStatusUpdate.status` | 🔴 critical — definition #6 |
| `src/types/index-signatures.d.ts` | local | 1 ref | 🟢 low |
| `src/stores/orders.ts` | `@/types` | 15 refs incl. `order.status === 1|2|3` filter computeds (lines 31, 35, 39); `updateOrderStatus(orderId, newStatus: number \| OrderStatus)` (line 459); cast `newStatus as OrderStatus` (line 464) | 🔴 critical |
| `src/stores/orderManagement.ts` | local | 2 refs | 🟡 medium |
| `src/stores/__tests__/orders.test.ts` | local | 6 refs | 🟡 medium |
| `src/stores/__tests__/orderManagement.test.ts` | local | 2 refs | 🟢 low |
| `src/services/offlineService.ts` | local | 2 refs. **`typeof order.status === "number"` cache validator at line 485** — invalidates entire localStorage on schema mismatch | 🔴 critical — Section 4 + Section 9.1 entry |
| `src/services/audioAccessibilityService.ts` | local | 4 refs | 🟡 medium |
| `src/services/kitchenStatisticsService.ts` | local | 0 OrderStatus refs but **3 numeric literal sites** (`status === 1|2`, lines 185, 186, 423) | 🔴 high — §3 entry |
| `src/services/__tests__/persistenceService.test.ts` | local | 5 refs | 🟡 medium |
| `src/composables/useRealtimeKitchen.ts` | local | 3 refs | 🟡 medium |
| `src/composables/useKeyboardShortcuts.ts` | local | 2 refs | 🟢 low |
| `src/composables/useAudioNotifications.ts` | local | 0 OrderStatus refs but `order.status === 2` literal (line 196) | 🟡 medium — §3 entry |
| `src/composables/__tests__/useKeyboardShortcuts.test.ts` | local | 2 refs | 🟢 low |
| `src/views/EnhancedKitchenDashboard.vue` | local | 6 refs + **3 numeric literals** (`status === 1|2|3`, lines 210, 214, 218) | 🔴 high |
| `src/views/HistoryView.vue` | local | 3 refs + **3 numeric literals** (`status === 6`, `status === 4 \|\| status === 5`, lines 75, 94, 244) | 🔴 high |
| `src/components/orders/OrderCard.vue` | local | 0 OrderStatus refs but **2 numeric literals** (`status === 6`, lines 299, 302) | 🟡 medium |
| `src/components/orders/PriorityTimingManager.vue` | local | 0 OrderStatus refs but **4 numeric literals** (`status === 1|2`, lines 349, 350, 456, 458) | 🟡 medium |
| `src/components/orders/OrderFilters.vue` | local | 0 OrderStatus refs but **6 numeric literals** (`status === 1|2|3` × 2 sets, lines 455-508) | 🔴 high |
| `src/components/workflow/WorkflowAutomation.vue` | local | 0 OrderStatus refs but **3 numeric literals** (`status === 1|2`, lines 645, 665, 677) | 🟡 medium |
| `src/components/KeyboardShortcutFeedback.vue` | local | 1 ref | 🟢 low |
| `src/utils/offline-storage.ts` | **inline string union** | 11 refs; IndexedDB schema (lines 6-16); 3 different store names (`orderStatusUpdates`); persisted across sessions | 🔴 critical — see §9.1 |
| `src/__tests__/integration/realtime-updates.test.ts` | local | 6 refs | 🟡 medium |
| `src/__tests__/integration/order-workflow.test.ts` | local | 5 refs | 🟡 medium |
| `src/__tests__/integration/multi-order-handling.test.ts` | local | 17 refs | 🔴 high |
| `src/__tests__/unit/components/OrderStatusBadge.test.ts` | local | 10 refs | 🟡 medium |
| `src/__tests__/unit/components/__snapshots__/OrderStatusBadge.test.ts.snap` | n/a | 3 refs (snapshot) | 🟢 low — auto-regenerates |
| `priority3-progress1.txt`, `priority3-analysis.txt` | n/a | scratch analysis docs | ⚪ skip — not source files |


### 2.2 apps/realtime
### 2.3 apps/customer-app
### 2.4 apps/kitchen-display
### 2.5 apps/admin-dashboard

**File count:** 25 files, 218 total occurrences of `OrderStatus|order_status|orderStatus`.
(Issue #9 reported "167 references" — the count is in the same order of magnitude; the delta is line-match granularity.)

**⚠️ Additional finding: admin-dashboard ships TWO MORE local OrderStatus definitions**, bringing the monorepo total to **five**:

| # | File:line | Members | Notes |
|---|-----------|---------|-------|
| (1) | `packages/shared-types/src/order.ts:95-103` | 7 numeric | canonical-ish, see §1.1 |
| (2) | `packages/database/src/schema/orders.ts:14-26` | 8 string | DB source of truth, see §1.2 |
| (3) | `apps/realtime/src/advanced-realtime-session.ts:156-164` | 7 string | local drift, see §1.3 |
| (4) | `apps/admin-dashboard/src/types/index.ts:117-126` | 8 string | has `COMPLETED`, missing `REFUNDED` |
| (5) | `apps/admin-dashboard/src/components/dashboard/RecentOrders.vue:124-130` | 6 string | has `completed`, missing `delivered/paid/refunded` |

Both (4) and (5) must be deleted and replaced by the canonical shared-types string union in Phase 3.

**Per-file classification:**

| File | Import source | Usage pattern | Migration risk | Notes |
|------|---------------|---------------|----------------|-------|
| `src/types/index.ts` | **local `export enum`** | 4th OrderStatus definition | 🔴 high | 8 string members, has `COMPLETED` (not in DB), missing `REFUNDED`. Every re-exporter inherits the drift. Delete in Phase 3. |
| `src/stores/order.ts` | `@/types` (→ #4) | enum access (`OrderStatus.PENDING`, `.COMPLETED`, `.PAID`) | 🔴 high | 20 refs, drives filter groupings on lines 15-43; any state rename ripples here. Includes `updateOrderStatus(orderId, OrderStatus.COMPLETED)` on line 183 — will break when `completed` is removed. |
| `src/stores/order.d.ts` | `@/types` (→ #4) | type annotations (44 occurrences) | 🟡 medium | Ambient declaration file. Mechanically regenerated from `order.ts`? Verify whether hand-maintained or codegen in Task 13. |
| `src/stores/__tests__/order.test.ts` | `@/types` (→ #4) | enum access + test fixtures (45 refs) | 🟡 medium | Test mocks — largest single test file surface in admin-dashboard. |
| `src/views/OrdersView.vue` | `@/types` (→ #4) | enum access in filter predicates (lines 659-669), `nextStatus as OrderStatus` cast (741) | 🔴 high | 11 refs. Groupings: `[PENDING, CONFIRMED]`, `[PREPARING, READY, DELIVERED]`, `[COMPLETED, PAID]`. `[COMPLETED, PAID]` bucket will collapse to `[PAID]` after canonicalization. |
| `src/views/DashboardView.vue` | `@/types` (→ #4) | enum array literal for active-orders count | 🟢 low | 5 refs, all in one `[PENDING, CONFIRMED, PREPARING, READY]` list. Pure lookup — trivial rename. |
| `src/views/CashierView.vue` | *none* (string literal switch) | `getOrderStatusClass(status: string)` / `getOrderStatusText` with string keys including `completed` | 🟡 medium | 9 refs. Uses raw strings in a lookup table, including `completed` — must become `delivered` or a derived UI label. |
| `src/views/AnalyticsView.vue` | *none* (i18n keys) | `analytics.orderStatus.{completed,preparing,pending,cancelled}` | 🟢 low | 7 refs, all translation keys. Will need i18n key rename (`completed` → `delivered`). |
| `src/views/__tests__/OrdersView.test.ts` | `@/types` (→ #4) | test fixtures | 🟡 medium | 14 refs, largest view test surface. |
| `src/views/__tests__/AnalyticsView.test.ts` | *likely i18n strings* | test fixtures | 🟢 low | 5 refs. |
| `src/components/dashboard/RecentOrders.vue` | **local `type OrderStatus = ...`** | 5th OrderStatus definition | 🔴 high | 6-member string union inlined in the component (lines 124-130). `getStatusColor/Icon/Text(status: OrderStatus)` helpers branch on it. Has `completed`, missing `delivered/paid/refunded`. Delete in Phase 3. |
| `src/composables/useRealtimeOrderStatus.ts` | *local inline union* | `OrderStatusUpdate.status: 'pending' \| ... \| 'cancelled'` | 🔴 high | 9 refs. Another inline 6-member drift union (missing `delivered`, `paid`, `refunded`). Also serves as the realtime message schema for WebSocket order updates — mismatched with `shared-types` `OrderStatusUpdateEvent`. |
| `src/composables/useAdminRealtime.ts` | `shared-types` (`OrderStatusUpdateEvent`) | handler dispatch | 🟡 medium | 3 refs. Transitively depends on the numeric enum via `shared-types/src/realtime-events.ts:8`. |
| `src/composables/__tests__/useRealtimeOrders.test.ts` | *test fixtures* | mock events | 🟢 low | 2 refs. |
| `src/services/realtimeService.ts` | *string constants* | event type name `"order_status_changed"` | 🟢 low | 2 refs — just event name string, unrelated to status values. |
| `src/services/__tests__/realtimeService.test.ts` | | | 🟢 low | 1 ref, event name only. |
| `src/__tests__/setup.ts` | | | 🟢 low | 1 ref, likely mock helper. |
| `src/__tests__/integration/dashboard-integration.test.ts` | `@/types` (→ #4) | fixtures | 🟡 medium | 7 refs. |
| `src/tests/integration/realtime-group-orders.integration.test.ts` | | | 🟢 low | 1 ref. |
| `src/i18n/locales/en-US.ts` | n/a | translation keys `orderStatus.{pending,...}` | 🟢 low | 4 refs; maintenance: key rename across 6 locales. |
| `src/i18n/locales/zh-TW.ts` | n/a | translation keys | 🟢 low | 4 refs. |
| `src/i18n/locales/zh-CN.ts` | n/a | translation keys | 🟢 low | 4 refs. |
| `src/i18n/locales/ja-JP.ts` | n/a | translation keys | 🟢 low | 4 refs. |
| `src/i18n/locales/vi-VN.ts` | n/a | translation keys | 🟢 low | 4 refs. |
| `src/i18n/locales/id-ID.ts` | n/a | translation keys | 🟢 low | 4 refs. |

**Risk buckets (flagged for Section 3):** 0 hardcoded numeric literal sites against `.status`. All `.status === <number>` matches in admin-dashboard are HTTP error codes (websocketService, api.ts), not order status. The numeric-drift bug is pure-type, not runtime-literal, in this app.

**Risk buckets (flagged for Section 4):** 0 runtime `typeof status === 'number'` guards in admin-dashboard.

**Net admin-dashboard work for Phase 3:**
1. Delete the local `OrderStatus` enum in `src/types/index.ts`; re-export from `@makanmasak/shared-types`.
2. Delete the local `type OrderStatus` in `src/components/dashboard/RecentOrders.vue`; import from shared-types.
3. Delete the inline 6-member union in `src/composables/useRealtimeOrderStatus.ts`; reuse `OrderStatusUpdateEvent['data']['status']` from shared-types.
4. Rewrite filter buckets in `OrdersView.vue:659-669` and `stores/order.ts:15-43` to match the canonical 8-state set (collapse `[COMPLETED, PAID]` → `[PAID]`, convert `COMPLETED` → `DELIVERED`).
5. Rename i18n keys `orderStatus.completed` → `orderStatus.delivered` across 6 locales; add `paid`, `refunded` keys.
6. Update 3 test files (`__tests__/order.test.ts`, `OrdersView.test.ts`, `dashboard-integration.test.ts`) to use factories + canonical string values.

### 2.6 apps/management-portal

**File count:** 0. Management portal does not reference orders or `OrderStatus` directly.

### 2.7 apps/onboarding-app

**File count:** 0. Onboarding app does not reference orders or `OrderStatus`.

### 2.8 packages/testing-utils

**File count:** 3 files (1 README + 2 source), 35 occurrences.

| File | Definition / usage | Migration risk |
|------|--------------------|----------------|
| `src/factories/order.factory.ts` | **7th OrderStatus definition** at lines 84-92: `export const OrderStatus = { PENDING:"pending", CONFIRMED:"confirmed", PREPARING:"preparing", READY:"ready", DELIVERED:"delivered", COMPLETED:"completed", CANCELLED:"cancelled" } as const` — has both `DELIVERED` and `COMPLETED`, missing `PAID` and `REFUNDED`. 32 internal references in factory builders. | 🔴 critical — drives every test fixture in the monorepo via `orderFactory.build({ overrides: { status: ... } })`. CLAUDE.md mandates factory usage. Phase 2 must update this in lockstep with shared-types. |
| `src/factories/realtime.factory.ts` | 2 refs to status field in event factories | 🟡 medium |
| `README.md` | doc reference | ⚪ skip |

### 2.9 packages/shared-types

**File count:** 3 source files, 19 occurrences.

| File | Definition / usage | Migration risk |
|------|--------------------|----------------|
| `src/order.ts` | **definition #1** (numeric enum). 5 refs total — the enum + downstream usage in `Order.status: OrderStatus` | 🔴 critical — Phase 2 Task 13 rewrites this |
| `src/realtime-events.ts` | 8 refs; imports `OrderStatus` (line 8), uses it in `OrderStatusUpdateEvent.data.status` and `previousStatus` (lines 193, 195) and the type discriminator. Drives the wire format for ALL realtime broadcasts. | 🔴 critical — wire format change cascades from here |
| `src/websocket.ts` | 6 refs; defines `OrderStatusUpdateMessage` (line 52-57), `OrderUpdateData` with `status?: OrderStatus` (line 7-8); part of legacy WebSocket message contract | 🔴 high — verify in §7 whether external consumers depend on this |

### 2.10 packages/database

**File count:** 24 entries, but only **7 are source files** — the rest are migration SQL/JSON snapshots, `.backup`, `.disabled`, `.temp_skip`. Counting source only: 7 files, ~22 source occurrences.

| File | Definition / usage | Migration risk |
|------|--------------------|----------------|
| `src/schema/orders.ts` | **definition #2 — DB source of truth** (string const + union). 1 ref (the definition itself) | ✅ canonical — no change needed |
| `src/schema/order-items.ts` | 1 ref; uses related order status enum | 🟢 low |
| `src/schema/index.ts` | 1 ref (re-export) | 🟢 low |
| `src/services/order.ts` | 5 refs; `UpdateOrderStatusData` interface, `updateOrderStatus()` method (line 510), `incrementOrderStatusBy()` helper (line 603) — all already string-based | 🟢 low — already canonical |
| `src/services/realtime.ts` | 7 refs; `cacheOrderStatus()` / `getCachedOrderStatus()` / `updateOrderStatus()` — KV cache layer | 🟡 medium — verify cache key/value format matches new wire format |
| `src/services/index.ts` | 1 ref (re-export) | 🟢 low |
| `src/services/__tests__/order.test.ts` | 7 refs; tests for the canonical service | 🟢 low — already string-based |

**Migration files** (`migrations/`, `migrations_fresh/`): 17 files matched. These are historical SQL or Drizzle JSON snapshots — must NOT be modified (they encode shipped schema). New migration may be added in Phase 2 if column-level constraints change.

### 2.11 tests/e2e

**File count:** 7 files, 40 occurrences.

| File | Usage pattern | Migration risk |
|------|---------------|----------------|
| `journeys/cross-role/order-lifecycle.spec.ts` | 16 refs. Uses local `let currentOrderStatus = 0` numeric counter (line 53), with comments mapping `0=pending..5=completed`. Multiple `currentOrderStatus = N` writes across the file. Sends numeric to mock-create helper. | 🔴 high — full rewrite to string values; comment lies (`5=completed` doesn't exist in DB) |
| `integration/order-lifecycle.spec.ts` | 8 refs. Already uses string statuses: `updateOrderStatus(id, "confirmed", auth)`, `"preparing"`, `"ready"`, `"delivered"`, `"paid"`, `"cancelled"` — **already canonical, except missing a `"refunded"` test case** | 🟢 low — add refunded coverage |
| `integration/helpers.ts` | 5 refs. Helper definitions including `updateOrderStatus()` function used above | 🟡 medium |
| `journeys/customer/order-cancellation.spec.ts` | 4 refs | 🟡 medium |
| `integration/kitchen-api.spec.ts` | 4 refs | 🟡 medium |
| `support/test-helpers.ts` | 2 refs | 🟢 low |
| `helpers/assertions.ts` | 1 ref | 🟢 low |

---

### Section 2 Totals

```
Files referencing OrderStatus across the monorepo (source only):
  apps/api                      30 (excl. 2 .disabled)
  apps/realtime                  8 (1 source + 7 tests)
  apps/customer-app              8
  apps/kitchen-display          24 (excl. .txt analysis × 2)
  apps/admin-dashboard          25
  apps/management-portal         0
  apps/onboarding-app            0
  packages/testing-utils         2 (excl. README)
  packages/shared-types          3
  packages/database              7 source (excl. 17 migration files)
  tests/e2e                      7
  ────────────────────────────────
  TOTAL                        114 source files
```

**Of which contain hardcoded numeric literal comparisons against `.status`:** ~33 sites in 13 files (all in `apps/customer-app` × 5 sites and `apps/kitchen-display` × 28 sites; admin-dashboard and api have **none**).

**Of which use runtime `typeof === "number"|"string"` guards on status:** **5 sites** in 3 files —
- `apps/api/src/features/orders/services/OrdersService.ts:1238` (`typeof status === "number"` in normalizeStatus)
- `apps/api/src/features/orders/routes/index.ts:75, 95` (`typeof status === "string"` for query parsing)
- `apps/api/src/features/kitchen/services/KitchenService.ts:157, 178` (`typeof === "number"` defensive)
- `apps/kitchen-display/src/services/offlineService.ts:485` (`typeof === "number"` localStorage cache validator — Section 9.1 entry)

**Total OrderStatus definitions in the monorepo:** **7** (Issue #9 said "three") —
1. `packages/shared-types/src/order.ts` — numeric enum (canonical legacy)
2. `packages/database/src/schema/orders.ts` — string const + union (DB source of truth)
3. `apps/realtime/src/advanced-realtime-session.ts` — string enum (`OrderLifecycleState`)
4. `apps/admin-dashboard/src/types/index.ts` — string enum
5. `apps/admin-dashboard/src/components/dashboard/RecentOrders.vue` — inline string union
6. `apps/kitchen-display/src/types/index.ts` — numeric literal union
7. `packages/testing-utils/src/factories/order.factory.ts` — string const

Plus **2 more inline status unions** that aren't called `OrderStatus` but serve the same role:
- `apps/admin-dashboard/src/composables/useRealtimeOrderStatus.ts:6-12` — 6-member string union for WebSocket message schema
- `apps/kitchen-display/src/utils/offline-storage.ts:6-16` — 4-member IndexedDB persistence schema (`"received"|"preparing"|"ready"|"completed"`)

Plus **2 Zod enum schemas** in `apps/api`:
- `src/features/orders/schemas/validation.ts:23-31` — 7-member, missing `refunded`
- `src/contracts/schemas/orders.ts:22-30` — 7-member, missing `refunded`

**Adjustment to plan scope:** Issue #9 estimated 80–120 files; actual is **114 source files**, in range. But the count of distinct `OrderStatus`-shaped definitions is **11** (7 named + 4 implicit), not 3. Phase 3 sweep must visit all 11 definitions.

## 3. Hardcoded Numeric Literal Sites

Sites where code compares `.status` against a numeric literal `0`-`6`. **All of these are bugs waiting to fire**: the DB returns strings, so most of these comparisons silently evaluate `false` and the UI degrades to a default branch.

**Total: 33 sites across 13 files.**

| File:line | Code | Canonical replacement |
|-----------|------|----------------------|
| `apps/customer-app/src/views/OrderHistoryView.vue:217` | `v-if="order.status === 0"` | `v-if="order.status === 'pending'"` |
| `apps/customer-app/src/views/OrderTrackingView.vue:424` | `return order.value?.status === 0 \|\| order.value?.status === 1; // PENDING or CONFIRMED` | `return order.value?.status === 'pending' \|\| order.value?.status === 'confirmed'` |
| `apps/customer-app/src/views/OrderTrackingView.vue:474` | `if (order.value.status === 6) {` | `if (order.value.status === 'cancelled') {` |
| `apps/customer-app/src/views/OrderTrackingView.vue:476` | `status: 6,` (timeline entry) | `status: 'cancelled',` |
| `apps/customer-app/src/views/OrderTrackingView.vue:488-496` | `statusTitles = computed(() => ({ 0: ..., 1: ..., 2: ..., 3: ..., 4: ..., 5: ..., 6: ... }))` | rewrite as `Record<OrderStatus, string>` keyed by string values; add `refunded`; remove dead `5: paid` index if it overlaps |
| `apps/customer-app/src/views/OrderTrackingView.vue:498-506` | `statusDescriptions = computed(() => ({ 0..6: ... }))` | same |
| `apps/customer-app/src/views/OrderTrackingView.vue:510-519` | `getStatusIcon: { 0: ClockIcon, 1: CheckCircleIcon, 2: FireIcon, 3: CheckCircleIcon, 4: TruckIcon, 5: CheckCircleIcon, 6: XCircleIcon }` | rewrite keys as strings |
| `apps/customer-app/src/views/OrderTrackingView.vue:522-532` | `getStatusColor: { 0..6: { bg, text } }` | rewrite keys as strings |
| `apps/customer-app/src/views/OrderTrackingView.vue:545-555` | `getProgressPercentage: { 0: 20, 1: 40, 2: 60, 3: 80, 4: 100, 5: 100, 6: 0 }` | rewrite keys as strings; add `refunded: 0` |
| `apps/customer-app/src/components/OrderItemCard.vue:71` | `v-if="item.status === 1"` | `v-if="item.status === 'confirmed'"` (verify intent — may actually want `preparing`) |
| `apps/customer-app/src/utils/format.ts:273-285` | `formatOrderStatus(status: number)` with `Record<number, string>` | `formatOrderStatus(status: OrderStatus): string` keyed by string values |
| `apps/kitchen-display/src/services/kitchenStatisticsService.ts:185` | `const pending = orders.filter((o) => o.status === 1).length;` | `o.status === 'confirmed'` (mislabel: `1` is `CONFIRMED` not `PENDING` in legacy) |
| `apps/kitchen-display/src/services/kitchenStatisticsService.ts:186` | `const cooking = orders.filter((o) => o.status === 2).length;` | `o.status === 'preparing'` |
| `apps/kitchen-display/src/services/kitchenStatisticsService.ts:423` | `(o: KitchenOrder) => o.status === 1,` | `o.status === 'confirmed'` |
| `apps/kitchen-display/src/views/EnhancedKitchenDashboard.vue:210` | `filteredOrders.value.filter((order) => order.status === 1)` | `order.status === 'confirmed'` |
| `apps/kitchen-display/src/views/EnhancedKitchenDashboard.vue:214` | `filteredOrders.value.filter((order) => order.status === 2)` | `order.status === 'preparing'` |
| `apps/kitchen-display/src/views/EnhancedKitchenDashboard.vue:218` | `filteredOrders.value.filter((order) => order.status === 3)` | `order.status === 'ready'` |
| `apps/kitchen-display/src/views/HistoryView.vue:75` | `order.status === 6` | `order.status === 'cancelled'` |
| `apps/kitchen-display/src/views/HistoryView.vue:94` | `order.status === 6 ? 'text-ios-tertiary' : 'text-ios-secondary'` | `order.status === 'cancelled'` |
| `apps/kitchen-display/src/views/HistoryView.vue:244` | `(o) => o.status === 4 \|\| o.status === 5,` | `o.status === 'delivered' \|\| o.status === 'paid'` |
| `apps/kitchen-display/src/components/orders/OrderCard.vue:299` | `const isCancelled = computed(() => props.order.status === 6);` | `props.order.status === 'cancelled'` |
| `apps/kitchen-display/src/components/orders/OrderCard.vue:302` | `if (props.order.status === 6) return "border-t-4 border-[#8E8E93]";` | `=== 'cancelled'` |
| `apps/kitchen-display/src/components/orders/PriorityTimingManager.vue:349` | `const pendingOrders = props.orders.filter((order) => order.status === 1);` | `=== 'confirmed'` |
| `apps/kitchen-display/src/components/orders/PriorityTimingManager.vue:350` | `const preparingOrders = props.orders.filter((order) => order.status === 2);` | `=== 'preparing'` |
| `apps/kitchen-display/src/components/orders/PriorityTimingManager.vue:456` | `order.status === 1` | `=== 'confirmed'` |
| `apps/kitchen-display/src/components/orders/PriorityTimingManager.vue:458` | `: order.status === 2` | `=== 'preparing'` |
| `apps/kitchen-display/src/components/orders/OrderFilters.vue:455` | `() => props.orders.filter((o) => o.status === 1).length,` | `=== 'confirmed'` |
| `apps/kitchen-display/src/components/orders/OrderFilters.vue:458` | `() => props.orders.filter((o) => o.status === 2).length,` | `=== 'preparing'` |
| `apps/kitchen-display/src/components/orders/OrderFilters.vue:461` | `() => props.orders.filter((o) => o.status === 3).length,` | `=== 'ready'` |
| `apps/kitchen-display/src/components/orders/OrderFilters.vue:494` | `count: props.orders.filter((o) => o.status === 1).length,` | `=== 'confirmed'` |
| `apps/kitchen-display/src/components/orders/OrderFilters.vue:501` | `count: props.orders.filter((o) => o.status === 2).length,` | `=== 'preparing'` |
| `apps/kitchen-display/src/components/orders/OrderFilters.vue:508` | `count: props.orders.filter((o) => o.status === 3).length,` | `=== 'ready'` |
| `apps/kitchen-display/src/components/workflow/WorkflowAutomation.vue:645` | `(order) => order.status === 1 && !order.assignedChef,` | `=== 'confirmed'` |
| `apps/kitchen-display/src/components/workflow/WorkflowAutomation.vue:665` | `(order) => order.status === 1 && order.assignedChef,` | `=== 'confirmed'` |
| `apps/kitchen-display/src/components/workflow/WorkflowAutomation.vue:677` | `order.status === 2 && ...` | `=== 'preparing'` |
| `apps/kitchen-display/src/stores/orders.ts:31` | `() => orders.value.filter((order) => order.status === 1), // CONFIRMED` | `=== 'confirmed'` |
| `apps/kitchen-display/src/stores/orders.ts:35` | `() => orders.value.filter((order) => order.status === 2), // PREPARING` | `=== 'preparing'` |
| `apps/kitchen-display/src/stores/orders.ts:39` | `() => orders.value.filter((order) => order.status === 3), // READY` | `=== 'ready'` |
| `apps/kitchen-display/src/composables/useAudioNotifications.ts:196` | `return elapsedMinutes >= estimatedTime * 0.8 && order.status === 2;` | `=== 'preparing'` |

**⚠️ Semantic note:** The legacy numeric mapping in customer-app/kitchen-display reads `0=PENDING, 1=CONFIRMED, 2=PREPARING, 3=READY, 4=DELIVERED, 5=PAID, 6=CANCELLED` — matches `shared-types/src/order.ts:95-103`. The mappings ARE internally consistent across customer-app and kitchen-display, so the rewrite is mechanical. The breakage is purely in the wire-format mismatch between numeric runtime literals and the DB string return values.

## 4. Runtime `typeof status === "number"` Guards

**Total: 5 sites in 3 files.** Each guard exists to bridge the dual numeric/string wire format. After unification, all 5 become dead code (or, in one case, a cache invalidation trigger).

### 4.1 `apps/api/src/features/orders/services/OrdersService.ts:1238`

```ts
private normalizeStatus(status: OrderStatus | number | string): OrderStatus {
  if (typeof status === "number") {
    // map numeric → string via lookup
  }
  // ...
}
```

**Why it exists:** Bidirectional bridge between numeric shared-types enum and DB string. The whole `normalizeStatus` method is the bridge layer.
**Safe to delete after unification?** ✅ Yes — Phase 2 Task 14 removes the entire method.

### 4.2 `apps/api/src/features/orders/routes/index.ts:75`

```ts
return (typeof status === "string" ? [status] : status) as DbOrderStatus[];
```

**Why it exists:** The query string can be `?status=pending` (string) or `?status=pending,confirmed` (also string but parsed to array). This guard normalizes single → array.
**Safe to delete after unification?** ⚠️ **No** — this guard distinguishes scalar vs array, NOT numeric vs string. Re-read in Phase 2 Task 17 to confirm. Likely keep but rename for clarity.

### 4.3 `apps/api/src/features/orders/routes/index.ts:95`

```ts
if (typeof status === "string") {
  // single-value path
}
```

**Why it exists:** Same scalar vs array distinction as 4.2.
**Safe to delete after unification?** Same as 4.2.

### 4.4 `apps/api/src/features/kitchen/services/KitchenService.ts:157`

```ts
typeof order.status === "number"
```

**Why it exists:** Defensive guard against orders flowing through KitchenService whose `status` field somehow arrived as a number — in practice this happens when an old client emits the legacy wire format. Phase 2 Task 17 documents the guard's removal.
**Safe to delete after unification?** ✅ Yes (after Phase 6.3 — once dual-emit window closes).

### 4.5 `apps/api/src/features/kitchen/services/KitchenService.ts:178`

```ts
typeof item.status === "number"
```

**Why it exists:** Same as 4.4 but for `OrderItem.status` (note: `OrderItemStatus` is a separate type — verify in Phase 0 dead-code section whether it has the same drift).
**Safe to delete after unification?** Same as 4.4.

### 4.6 `apps/kitchen-display/src/services/offlineService.ts:485` — *additional finding*

```ts
return cachedOrders.every(
  (order) =>
    order.id &&
    order.orderNumber &&
    Array.isArray(order.items) &&
    typeof order.status === "number",
);
```

**Why it exists:** localStorage cache validator — asserts that every cached order has a numeric status field. **Currently the validator is correct under the local `OrderStatus = 0|1|2|3|4|5|6` numeric literal type** (definition #6).
**Safe to delete after unification?** ⚠️ **Critical** — this guard is the load-bearing mechanism that will trigger one-time cache invalidation across every kitchen-display tab the moment we ship the new bundle. We **must** keep it (or replace it with `typeof === "string"`) so old caches are explicitly rejected — not silently rendered with type-mismatched data. See §9.1 for full handling.

## 5. Dead Code

Code paths discovered during the audit that are unused or no-op once the canonical type lands. These should be deleted in Phase 3 sweep, not preserved as compatibility shims.

| Item | File:line | Why dead | Phase to remove |
|------|-----------|----------|-----------------|
| `OrdersService.normalizeStatus()` | `apps/api/src/features/orders/services/OrdersService.ts:1227-1243` | Bridge layer; all 4 callers pass already-validated strings | Phase 2 Task 14 |
| `statusStringToEnum` local Record | `apps/api/src/features/orders/services/OrdersService.ts:1273-1281` | String→numeric back-conversion that exists only because the return type is the wrong shape | Phase 2 Task 15 |
| `OrdersService.checkOrderPermissions()` | `apps/api/src/features/orders/services/OrdersService.ts:945-973` | **Unreferenced from any HTTP route or service caller** — only invoked in `permissions.test.ts`. Either wire it to a route or delete. | Phase 3 sweep — flag for product decision |
| `OrderPermissions` interface | `apps/api/src/features/orders/types/index.ts:323-336` | Same — no consumer outside tests | Phase 3 — delete with above |
| `OrderStatus.COMPLETED` member | `apps/admin-dashboard/src/types/index.ts:124` | Not in DB; canonical mapping is `delivered`. The bucket `[OrderStatus.COMPLETED, OrderStatus.PAID]` in `stores/order.ts:32` collapses to `[PAID]`. | Phase 3 |
| `OrderLifecycleState.SERVING` | `apps/realtime/src/advanced-realtime-session.ts:161` | UI-derivable from `ready` + crew assignment per Phase 0.5 proposal | Phase 4 (after user approves drop) |
| `OrderLifecycleState.COMPLETED` | `apps/realtime/src/advanced-realtime-session.ts:162` | Realtime-local naming drift; replace with `delivered` | Phase 4 |
| `realtime` transition map `[SERVING, [COMPLETED]]` | `apps/realtime/src/advanced-realtime-session.ts:222-223` | Whole row gone after `SERVING`/`COMPLETED` removal | Phase 4 |
| `KitchenService` numeric `typeof` guards | `apps/api/src/features/kitchen/services/KitchenService.ts:157, 178` | Defensive bridges no longer needed | Phase 2 Task 17 |
| `apps/customer-app/src/utils/format.ts:formatOrderStatus(status: number)` whole signature | `apps/customer-app/src/utils/format.ts:273-285` | Param type wrong AND lookup table keyed by numbers; entire helper is broken in production today | Phase 5 (rewrite) |
| `apps/api/src/examples/*.ts.disabled` | n/a | already disabled, has stale numeric refs | Phase 3 — delete the files |
| `priority3-progress1.txt`, `priority3-analysis.txt` | `apps/kitchen-display/` | Scratch analysis docs, not source | Phase 3 — delete |

## 6. Bidirectional Mapping Surface

### 6.1 OrdersService.normalizeStatus

**Definition:** `apps/api/src/features/orders/services/OrdersService.ts:1227-1243`

```ts
/**
 * 將狀態值標準化為小寫字符串
 */
private normalizeStatus(status: OrderStatus | number | string): string {
  const statusMap: Record<number, string> = {
    0: "pending",
    1: "confirmed",
    2: "preparing",
    3: "ready",
    4: "delivered",
    5: "paid",
    6: "cancelled",
  };

  if (typeof status === "number") {
    return statusMap[status] || String(status);
  }

  return String(status).toLowerCase();
}
```

**Inputs accepted:**
- `OrderStatus` (the shared-types numeric enum, which TypeScript treats as `number`)
- bare `number` (legacy wire format from older clients)
- bare `string` (DB format / new clients)

**Numeric→string map completeness:** ❌ **incomplete — missing `7: "refunded"`.** Any numeric status of `7` falls through to `String(status)` which returns the string `"7"` — invalid value, will fail downstream Zod validation. This is currently masked because no caller emits `7`, but if Phase 2 Task 13 adds `REFUNDED = 7` to the enum (which it won't — the rewrite goes to a string union directly) or if a test fixture happens to use `7`, it crashes.

**Call sites (4 total in OrdersService.ts):**

| File:line | Caller | Input source |
|-----------|--------|--------------|
| `OrdersService.ts:306` | `createOrder()` body — `status: this.normalizeStatus(data.status)` | `data.status` from request validation, already a string per `validation.ts:23` Zod enum. The normalize call is dead — input is already a lowercase string. |
| `OrdersService.ts:407` | `updateOrderStatus()` — `status: this.normalizeStatus(statusData.status)` | `statusData.status: OrderStatus` from `OrderStatusUpdateData`, Zod-validated. Same — already canonical. |
| `OrdersService.ts:1250` | `validateStatusTransition()` — normalize `currentStatus` | param typed `OrderStatus \| number \| string` — bridge layer, will collapse in Task 16 |
| `OrdersService.ts:1251` | `validateStatusTransition()` — normalize `newStatus` | same |

**Conclusion:** All 4 call sites of `normalizeStatus` are no-ops once shared-types becomes a string union. Phase 2 Task 14 deletes the method outright. No external (cross-file) callers.

### 6.2 OrdersService.getAllowedStatusTransitions — caller audit

**Definition:** `apps/api/src/features/orders/services/OrdersService.ts:1271-1285`

```ts
private getAllowedStatusTransitions(userRole: UserRole): OrderStatus[] {
  const stringStatuses = ROLE_STATUS_PERMISSIONS[userRole] || [];
  const statusStringToEnum: Record<string, OrderStatus> = {
    pending: OrderStatus.PENDING,
    confirmed: OrderStatus.CONFIRMED,
    preparing: OrderStatus.PREPARING,
    ready: OrderStatus.READY,
    delivered: OrderStatus.DELIVERED,
    paid: OrderStatus.PAID,
    cancelled: OrderStatus.CANCELLED,
  };
  return stringStatuses
    .map((s) => statusStringToEnum[s])
    .filter((s): s is OrderStatus => s !== undefined);
}
```

**Note:** Method is `private`. The numeric `OrderStatus[]` return value never escapes the class except via `OrderPermissions.allowedStatusTransitions`.

**Direct call sites (1 total):**

| File:line | Caller | What it does |
|-----------|--------|--------------|
| `OrdersService.ts:963` | `checkOrderPermissions()` — assigns to `allowedStatusTransitions: this.getAllowedStatusTransitions(userRole)` in returned `OrderPermissions` object | Returns through `OrderPermissions.allowedStatusTransitions: OrderStatus[]` (typed at `types/index.ts:333`) |

**Indirect call sites via `checkOrderPermissions` (7 across the monorepo):**

| File:line | Caller | Wire exposure | Migration impact |
|-----------|--------|---------------|------------------|
| `apps/api/src/features/orders/services/OrdersService.ts:945` | definition itself | n/a | n/a |
| `apps/api/src/features/orders/types/index.ts:471` | interface declaration only | n/a | n/a |
| `apps/api/src/features/orders/__tests__/permissions.test.ts:87` | unit test — calls method directly | none | rewrite to expect string array |
| `apps/api/src/features/orders/__tests__/permissions.test.ts:104, 116, 132, 143, 154, 169, 180, 191, 203` | 9 more permissions test invocations | none | same — bulk rewrite |

**Wire exposure:** **NONE.** A grep across `apps/api/src/features/orders/routes/` shows zero references to `checkOrderPermissions`, no HTTP route returns `OrderPermissions`, and no realtime broadcast emits the field. The numeric `OrderStatus[]` return type is **purely internal** — the only consumers are 10 test cases in `permissions.test.ts`.

**Migration impact:** Phase 2 Task 15 can rewrite the return type to `OrderStatus[]` (string union) with **no wire-format risk**. The 10 test cases need bulk replacement of `OrderStatus.PENDING` → `'pending'` etc. There is no public API contract test for `OrderPermissions`.

**⚠️ Dead-code candidate:** `checkOrderPermissions` itself appears to have no production caller — only test invocations. Section 5 (Dead Code) should flag it for either route exposure or deletion.

## 7. External Wire Consumers

**SDK directories checked:** None found. Monorepo apps are: `admin-dashboard`, `api`, `backup-scheduler`, `customer-app`, `image-processor`, `kitchen-display`, `management-api`, `management-portal`, `onboarding-app`, `print-agent`, `realtime`. None of these are an SDK package.
- `apps/management-api` — 0 OrderStatus references
- `apps/print-agent` — 0 OrderStatus references
- `apps/backup-scheduler` — 0 references
- `apps/image-processor` — 0 references

**No partner / mobile SDK exists in the monorepo.** No `apps/sdk-*` or `packages/sdk-*` directory.

**API documentation checked:** OpenAPI/Swagger schema is generated dynamically from `apps/api/src/openapi/integration.ts`, NOT from a static spec file (no `openapi.{json,yaml}` exists in the repo).

**🚨 8th OrderStatus definition discovered: `apps/api/src/openapi/integration.ts:277-283`**

```ts
const OrderStatus = z.enum([
  "pending",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);
```

This is the **public** OrderStatus exposed via Swagger UI to anyone reading the API docs. It has only **5 members** and:
- ❌ Missing `confirmed` (in DB)
- ❌ Missing `delivered` (in DB) — uses `completed` instead, which doesn't exist in DB
- ❌ Missing `paid` (in DB)
- ❌ Missing `refunded` (in DB)

This means external clients reading the public API docs are being told the wrong contract. Any automated client generation against the Swagger UI gets a broken enum. Phase 2 must update this to the canonical 8-member set in lockstep with shared-types.

There is also a sub-schema `OrderItem.status` at line 291 with `z.enum(["pending", "preparing", "ready"])` — only 3 members. This is a separate `OrderItemStatus` and is **out of scope** for this plan but flagged for separate cleanup.

**Contract test snapshot checked:** `scripts/check-api-contracts.cjs` reads `apps/api/src/contracts/schemas/*.ts` and stores a field-name snapshot in `.api-contracts-snapshot.json`. Inspection shows the snapshot tracks **field names only, not enum values** — `UpdateOrderStatusResponse: ["data", "success"]` with no enum content. Therefore:
- Changing the enum membership in `OrderStatusEnum` (`apps/api/src/contracts/schemas/orders.ts:22-30`) will **NOT** trip the contract test. This is good news — Phase 2 doesn't need to coordinate with `pnpm contract:update`.
- ⚠️ However, the contract snapshot has a blind spot for enum drift — recommend Phase 8 (post-cleanup) to either delete this contract or extend the snapshot generator to capture enum values.

> **Superseded 2026-09-06 ([#336](https://github.com/erictheng93/Makan-Masak/issues/336)).** The generator was extended, so both bullets above are now inverted. The snapshot stores `orders.OrderStatusEnum` as `enum(cancelled|confirmed|delivered|paid|pending|preparing|ready|refunded)`, and every field carries its type. **Changing enum membership now DOES trip `pnpm contract:check`** — Phase 2 must run `pnpm contract:update` in the same commit.

**Postman collections / Insomnia exports:** None found in repo.

**Public-facing markdown docs that may pin enum values:**

```bash
rg -l 'OrderStatus|status.*pending' docs/ --type md
```

The plan and this investigation doc are the only matches inside `docs/`. No README or developer-facing doc currently documents the canonical enum.

**Conclusion / Finding:**

✅ **No external SDK depends on the numeric wire format** — the only consumers are first-party apps within this monorepo.

⚠️ **One public API consumer at risk:** the dynamically-generated Swagger UI served from `apps/api/src/openapi/integration.ts`. Anyone using the public API docs has been told a 5-member string enum that mismatches reality. Phase 2 must update the OpenAPI integration schema as part of the canonical-type rollout.

⚠️ ~~**Contract test blind spot:** `.api-contracts-snapshot.json` tracks field names only, not enum values. The migration won't trigger contract failure, but a follow-up should extend the snapshot generator (out of scope for this plan).~~ **The follow-up shipped 2026-09-06 ([#336](https://github.com/erictheng93/Makan-Masak/issues/336)): enum values are snapshotted and the migration WILL trip `pnpm contract:check`. Run `pnpm contract:update` in the same commit.**

✅ **No legacy mobile / partner SDK** — wire format change is internal-only.

## 8. Durable Object Hibernated State

The realtime DO persists state to `ctx.storage` so that hibernated sessions can wake up and resume. Any change to the in-memory `OrderLifecycleState` enum changes the shape of the persisted bytes — old hibernated sessions waking up after deploy will deserialize state with the OLD enum value into the NEW type.

### 8.1 Persisted shape inventory

| File:line | `ctx.storage.put` call | Key pattern | Persisted type | Contains status? |
|-----------|------------------------|-------------|----------------|------------------|
| `apps/realtime/src/advanced-realtime-session.ts:496` | `ctx.storage.put('order:${orderId}', orderState)` | `order:<id>` | `OrderState` (line 44-53) | ✅ **YES** — `currentState: OrderLifecycleState`, `previousState?: OrderLifecycleState`, plus `transitions[].from/.to: OrderLifecycleState` |
| `apps/realtime/src/advanced-realtime-session.ts:1034, 1108, 1206, 1317, 1411, 1503, 1602` | `ctx.storage.put('group_order:${id}', ...)` | `group_order:<id>` | `GroupOrderState` (line 55-73) | ⚠️ **YES indirectly** — `status: 'active' \| 'ordering' \| 'checkout' \| 'completed' \| 'cancelled'` is its own union (NOT `OrderLifecycleState`), but it does include a `completed` value that's also being deprecated. Plus members have `paymentStatus: 'unpaid' \| 'pending' \| 'paid'` — separate concern, leave alone. |
| `apps/realtime/src/advanced-realtime-session.ts:623` | `ctx.storage.put('hibernation_state', { hibernatedAt, ... })` | `hibernation_state` | `{ hibernatedAt: number, ... }` | ❌ no status |
| `apps/realtime/src/advanced-realtime-session.ts:1810` | `ctx.storage.delete('group_order:${id}')` | n/a | n/a | n/a (delete) |
| (write) | `ctx.storage.put('metrics:${restaurantId}', metric)` (implied by `loadPersistedState` line 687-690) | `metrics:<id>` | restaurant metrics | ❌ no order status |

**Bottom line — keys that hold `OrderLifecycleState` values:**
- ✅ `order:<id>` — every active order. **High volume.** Worst case = peak concurrent active orders per DO instance.

### 8.2 Hibernation lifecycle

From `advanced-realtime-session.ts:711-723`:
- Background timer fires every 5 minutes (`hibernationTimer`)
- A session hibernates after `30 minutes` of inactivity AND zero active connections
- On hibernate: connections closed with code 1000, hibernation state written to storage, in-memory state remains until DO is unloaded

From `advanced-realtime-session.ts:649-706`:
- `loadPersistedState()` runs at construction (line 229)
- Reads ALL `order:*` keys via `ctx.storage.list<OrderState>({ prefix: 'order:' })`
- Deserializes each entry directly into `sessionState.orderStates: Map<string, OrderState>`
- **No version check**, no migration step, no schema validation

**How long can a hibernated session live before wakeup?**
DO storage is durable until explicit delete or 30-day inactivity expiration (Cloudflare default). In practice: orders persist until they reach terminal state (`delivered`/`paid`/`cancelled`/`refunded`) and are pruned by application logic, OR until the DO instance is replaced (deploy, region failover, etc.).

**What happens when a session wakes up with an unrecognized schema version?**
- TypeScript types are erased at runtime, so the DO will deserialize OLD values (`'completed'`, `'serving'`) into the NEW `OrderLifecycleState` field unchanged.
- The next `broadcastOrderStateChange` call will emit `currentState: 'completed'` over the wire.
- Frontends that have shipped the canonical 8-state set will receive an unknown value and either crash on Zod validation or silently fall through to a default UI branch.
- The transition map (`stateTransitions: Map<OrderLifecycleState, OrderLifecycleState[]>` line 183) will have lost its key entries for `SERVING` and `COMPLETED` if they're removed — any incoming transition request involving those states throws `Invalid state transition`.

**Volume estimate for the migration window:** unknown without telemetry, but bounded by `(active orders per restaurant) × (restaurants with hibernated sessions)`. At single-restaurant peak hours, expect ~50-200 `order:*` keys per DO. Across the fleet during a deploy, count is dominated by long-running sessions for restaurants with no incoming traffic.

### 8.3 Migration strategy options

#### Option A: Lazy migration on wakeup

In `loadPersistedState()`, after `ctx.storage.list<OrderState>(...)`, walk each `OrderState` and rewrite legacy values:
- `'completed'` → `'delivered'`
- `'serving'` → `'ready'` (closest semantic match — actual "serving" was always derivable)
- Remove unknown values entirely (skip the entry, log a warning)

For each migrated entry, write back via `ctx.storage.put` so the next wakeup is clean.

**Pros:**
- Zero coordination — each DO migrates itself the first time it loads after deploy
- No separate cron worker needed
- Unmigrated entries simply stay legacy until their DO wakes; no global rollout dependency
- Migration code can be deleted in a follow-up after a safety window (e.g. 30 days post-deploy)

**Cons:**
- A DO that never wakes up keeps stale data forever — but those orders are by definition orphaned (no traffic), so they'll be pruned by the existing `expiresAt` cleanup or never observed
- Adds startup latency for sessions with many orders (linear in `order:*` count, but `ctx.storage.put` is batched and fast)
- If migration code has a bug, every wakeup is broken until hotfix

**Risk:** ⚪ low — bounded blast radius (one DO instance), recoverable, no data loss

#### Option B: Explicit sweep via cron worker

Add a one-shot Worker that lists all DO instance IDs (via `state.id.toString()` index, or via the bindings list), opens each one, calls a `/migrate-state` admin endpoint, and walks the storage rewriting legacy values.

**Pros:**
- Predictable migration window — when the cron finishes, every DO is clean
- Easier to monitor (one log per DO)
- Safer rollback — can pause the cron if errors spike

**Cons:**
- Requires building a DO enumeration mechanism (Cloudflare doesn't expose one natively — must be tracked via D1 or KV)
- More code, more moving parts
- Cron must run before frontends ship the canonical bundle (otherwise migrate-while-broadcasting race)
- ❌ **Probably impractical for this codebase** — there's no DO instance index today

**Risk:** 🟡 medium — additional infra, race conditions during sweep

#### Option C: Versioned schema with dual-read

Add a `schemaVersion: number` field to `OrderState`. On read, branch on version: `1` (legacy values) vs `2` (canonical values). Continue writing as `2`.

**Pros:**
- No "migration moment" — code handles both forms forever
- Most resilient to slow / never-waking DOs
- Easy to layer on top of Option A for safety

**Cons:**
- Permanent code complexity
- Two code paths to test
- Dead-code accumulation if not actively pruned later

**Risk:** ⚪ low but encourages tech debt

### 8.4 Recommendation

**Recommendation: Option A (lazy migration on wakeup), with a value-coercion table that's narrow enough to delete cleanly after a 60-day safety window.**

Rationale:
- Volume is bounded and self-pruning (each `order:*` entry has a natural lifecycle ending in a terminal status).
- Cloudflare DOs have no native enumeration API → Option B requires building infrastructure that doesn't pay for itself.
- Option C is overkill for a one-time enum rename and creates permanent dead code.
- Option A's failure mode is "DO startup error" which is recoverable via hotfix and bounded to one instance.

**Concrete plan for Option A in Phase 4:**
1. Add a `migrateLegacyOrderStates()` private method to `AdvancedRealtimeSession` that walks `ctx.storage.list({ prefix: 'order:' })`, applies the coercion table, and writes back.
2. Call it from `loadPersistedState()` BEFORE populating `sessionState.orderStates`.
3. The coercion table:

```ts
const LEGACY_VALUE_MAP: Record<string, OrderLifecycleState> = {
  completed: 'delivered',
  serving: 'ready',
};
```

4. Log a counter metric `orderstate_legacy_migration_total` per coerced entry.
5. Add an integration test in `apps/realtime/src/__tests__/integration/durable-object-persistence.test.ts` that seeds storage with legacy values, instantiates a fresh session, and asserts the values are coerced.
6. Schedule a cleanup PR for ~60 days after deploy that deletes the migration code once the metric reaches zero.

This decision is a Phase 0.5 hard gate item — the user should approve before Phase 4 begins.

## 9. Client-Side Caches

### 9.1 kitchen-display localStorage

**Storage layer:** `localStorage` (NOT IndexedDB) under key `kitchen-cached-orders`.

**Code:** `apps/kitchen-display/src/services/offlineService.ts`
- `cacheOrders(orders: KitchenOrder[])` — line 145-151. Serializes the entire array as JSON.
- `getCachedOrders(): KitchenOrder[]` — line 153-161.
- `validateCachedData()` — line 475-491. **Asserts `typeof order.status === "number"` (line 485)** as the cache validity check.

**What triggers cache invalidation:**
- Validator returns `false` → caller treats cache as invalid → next sync rebuilds from API.
- After unification, status will be a string at runtime → validator returns `false` for every cached entry → cache rebuild triggered for every active kitchen-display tab on first load after deploy.

**Volume estimate:**
- Per kitchen-display user: typically 20-100 active orders cached at any time during service hours.
- Per restaurant peak: ~100-300 entries.
- Worst-case invalidation storm size: `(active KDS tabs) × (cached orders per tab)` — bounded by total kitchen-display sessions across the fleet.
- **Per-user impact:** one-time API call to repopulate (`GET /api/v1/kitchen/orders`) on first load after the new bundle ships. ~50ms-1s depending on network. Acceptable.
- **Fleet impact:** if all kitchen-display tabs reload within a 5-minute window after deploy, each one fires one extra `GET` request — bounded thundering herd. Recommend Phase 6.2 staggered deploy if fleet > ~100 active tabs.

**Migration approach (recommended):**
1. Update the validator to assert `typeof order.status === "string"` AS PART OF Phase 5 (the kitchen-display sweep PR), so old number-typed caches are explicitly rejected.
2. Do NOT add a coercion layer — cache rebuild is cheap and explicit invalidation is safer than silent migration.
3. Add a migration log line so we can confirm the storm size in monitoring.

### 9.2 Browser bundle caching

**Customer-app (`apps/customer-app/vite.config.ts`):**
- **VitePWA `registerType: 'autoUpdate'`** (line 23). The service worker auto-updates the cached bundle when a new build ships. Existing tabs continue running the old bundle until they reload.
- **Workbox runtime caching:**
  - `^https://api.makanmakan.app/` → `NetworkFirst`, 24h, max 100 entries (line 28-37). Wire-format change: ✅ safe — new responses always go to network first.
  - `^https://images.makanmakan.app/` → `CacheFirst`, 7 days. Not status-relevant.
- **Bundle hash:** Vite default — yes, content-hashed filenames. Old bundle stays cached until SW activates new version.
- **`__APP_VERSION__: "1.0.0"`** (line 109) is **hardcoded** in `vite.config.ts`. There is NO build-time version stamp that the frontend could read to detect "I'm running an old bundle vs new bundle." This is a gap for Phase 6.3 forced reload — the plan needs to add a build-time version injection BEFORE it can implement bundle-version detection.
- **Customer-app IndexedDB (`apps/customer-app/src/utils/offline-storage.ts`):** Has `offlineOrders` and `cachedMenuItems` stores. The `OfflineOrder` interface (lines 6-24) **does NOT include a `status` field** — these are customer-created draft orders pending sync, not server-side order records. ✅ No migration risk in customer-app's IndexedDB.

**Open customer-app tab risk:**
- A customer with the OrderTrackingView open (which polls `/api/v1/orders/:id`) will receive a string status from the new API while their JS code expects numeric. As documented in §3, the existing code already silently degrades when this happens (Record-by-number lookups return undefined, fall through to defaults). So the migration won't make things worse — just keeps them broken until the user's tab reloads.
- **Mitigation:** Phase 6.3 should add a server header or API response envelope field `apiStatusFormat: "string"` and have the frontend assert it on each response. If mismatch, force `window.location.reload()`. The `__APP_VERSION__` gap means we can't do bundle-version checking; an API-side signal is the only cheap option.

**Admin-dashboard, kitchen-display:** No PWA / service worker. Standard Vite output, hash-busted, but staff-tab usage means many tabs stay open across deploys. Same forced-reload signal recommended.

## 10. Canonical State Decision (for Phase 0.5)

**Proposed canonical set (8 states):** `pending`, `confirmed`, `preparing`, `ready`, `delivered`, `paid`, `cancelled`, `refunded`

**Rationale:** matches DB schema (`packages/database/src/schema/orders.ts:14-26`) exactly. The DB is the single immutable source of truth — every other definition in the monorepo must converge on this set.

**Realtime divergence resolution:**
- **Drop `serving`** — The `OrderLifecycleState.SERVING` value in `apps/realtime/src/advanced-realtime-session.ts:161` does not exist in the DB schema. Per the plan's Canonical Decisions §2, "currently serving" is a UI display state that can be derived from `status === 'ready'` plus a crew assignment. Migration coerces persisted `serving` → `ready` (Option A in §8).
- **Replace `completed` with `delivered`** — The `OrderLifecycleState.COMPLETED` value in the same file is realtime-local naming drift; the DB calls this state `delivered`. Migration coerces persisted `completed` → `delivered`.

**shared-types changes:**
- Replace the entire numeric `enum OrderStatus { PENDING = 0, ... }` (`packages/shared-types/src/order.ts:95-103`) with a string-union derived from `ORDER_STATUSES = [...] as const`.
- Add `'refunded'` (currently missing — see §1.1).
- Drop `'completed'` from any consumer that still uses it.

**Migration mechanics for hibernated DO state (§8.4):**
- **Option A: lazy migration on wakeup**, with coercion table `{ completed: 'delivered', serving: 'ready' }` applied in `loadPersistedState()` before in-memory hydration.
- Coercion code is delete-able after a 60-day safety window once the `orderstate_legacy_migration_total` metric reaches zero.

**Decisions requiring explicit user approval in Phase 0.5:**

1. **Q1 — Canonical state set:** Approve the 8-state canonical set `pending/confirmed/preparing/ready/delivered/paid/cancelled/refunded`?

2. **Q2 — `serving` removal:** The current realtime `OrderLifecycleState` includes `serving`, which is not in the DB schema. Proposal: drop it and derive "currently serving" in the UI from `status === 'ready'` plus a crew assignment field. Approve, or want `serving` retained as a separate first-class state?

3. **Q3 — DO migration strategy:** Recommended is **Option A (lazy migration on wakeup)** from §8.3, with the coercion table `completed → delivered` and `serving → ready`, deletable after 60 days. Approve, or prefer Option B (cron sweep) or Option C (versioned dual-read)?

4. **Q4 — Scope expansion** (added by this audit): The plan was written assuming 3 OrderStatus definitions. Audit found **11**. Phase 3 sweep must visit all 11. The plan's task list as written does NOT cover:
   - `apps/admin-dashboard/src/types/index.ts` (4th)
   - `apps/admin-dashboard/src/components/dashboard/RecentOrders.vue` (5th)
   - `apps/kitchen-display/src/types/index.ts` (6th — numeric literal union)
   - `packages/testing-utils/src/factories/order.factory.ts` (7th — drives every test fixture)
   - `apps/api/src/openapi/integration.ts` (8th — public Swagger contract)
   - `apps/admin-dashboard/src/composables/useRealtimeOrderStatus.ts` (inline 6-member union)
   - `apps/kitchen-display/src/utils/offline-storage.ts` (IndexedDB schema with `received` value)
   - `apps/api/src/features/orders/schemas/validation.ts` Zod enum (missing `refunded`)
   - `apps/api/src/contracts/schemas/orders.ts` Zod enum (missing `refunded`)

   Approve adding these to Phase 2/3/5 task lists, or want a re-plan via `superpowers:writing-plans`?

5. **Q5 — Pre-existing `OrderTrackingView.vue` bug** (added by this audit): The customer-app order tracking view has been silently degrading to default UI branches in production because of `Record<number, …>` lookups against a string status field. Phase 5 of the plan rewrites this. Approve treating the migration as the bug fix, or want a separate hotfix PR ahead of the unification work?

6. **Q6 — `OrderPermissions` dead-code decision** (added by this audit): `OrdersService.checkOrderPermissions` and the associated `OrderPermissions` interface have **no production caller** — only `permissions.test.ts`. Approve deleting in Phase 3, or wire it to an HTTP route as originally intended?

## 12. Phase 0.5 Decisions (User Approved)

**Date:** 2026-04-10
**Approver:** Eric (user)

1. **Q1 — Canonical state set:** ✅ **Approved as proposed.** 8-state set `pending / confirmed / preparing / ready / delivered / paid / cancelled / refunded`, matching DB schema exactly.

2. **Q2 — `serving` removal:** ✅ **Approved.** `OrderLifecycleState.SERVING` removed from realtime. UI derives "currently serving" from `status === 'ready'` + crew assignment.

3. **Q3 — DO migration strategy:** ✅ **Approved — Option A (lazy migration on wakeup).** Coercion table `{ completed: 'delivered', serving: 'ready' }` applied in `loadPersistedState()` before in-memory hydration. Coercion code deletable after 60-day safety window once `orderstate_legacy_migration_total` metric reaches zero.

4. **Q4 — Scope expansion:** ✅ **Approved (a) — add 9 extra sites to Phase 2/3/5.** The plan's task list will be expanded in-flight to cover:
   - `apps/admin-dashboard/src/types/index.ts` (4th definition)
   - `apps/admin-dashboard/src/components/dashboard/RecentOrders.vue` (5th)
   - `apps/kitchen-display/src/types/index.ts` (6th — numeric literal union)
   - `packages/testing-utils/src/factories/order.factory.ts` (7th)
   - `apps/api/src/openapi/integration.ts` (8th — public Swagger)
   - `apps/admin-dashboard/src/composables/useRealtimeOrderStatus.ts` (inline union)
   - `apps/kitchen-display/src/utils/offline-storage.ts` (IndexedDB schema)
   - `apps/api/src/features/orders/schemas/validation.ts` Zod enum
   - `apps/api/src/contracts/schemas/orders.ts` Zod enum

5. **Q5 — OrderTrackingView.vue pre-existing bug:** ✅ **Architect verdict (a) — fold into Phase 5 unification sweep.** Rationale: both hotfix paths require bridge code that Phase 5 would delete within the same sprint. The bug is latent (silent UI fallback, no support tickets), so urgency does not justify two rounds of touching the same file during the highest-risk migration window. Phase 5 customer-app sweep PR will add a component test locking in post-fix behavior for `OrderTrackingView.getStatusIcon/Color/Title/Description/ProgressPercentage` as an extra regression guard.

6. **Q6 — `OrderPermissions` dead code:** ✅ **Architect verdict (a) — delete in Phase 3.** Rationale: `checkOrderPermissions(userId, userRole, _orderId?)` has an underscore-prefixed `_orderId` indicating intentionally unused — original intent was per-order ACL that was never implemented. Every returned field is a pure function of `userRole`, already expressible via `ROLE_STATUS_PERMISSIONS` + shared constants. Production caller count is zero. Wiring to an HTTP route would create a stale role-wrapper endpoint that frontends don't need and that cements a wrong abstraction (role→capability mapping belongs in type-safe constants, not in HTTP queries). If future product work requires fine-grained per-resource ACL, design it clean-sheet with proper per-order context.

**Phase 0.5 gate: CLEARED.** Proceeding to Phase 1.


## 11. Migration Risk Register

| Risk | Likelihood | Impact | Mitigation (Phase) | Rollback trigger |
|------|------------|--------|---------------------|------------------|
| DO hibernated state has legacy `serving`/`completed` values | high | broadcast emits unknown values; frontend Zod rejects | Phase 4 lazy migration (§8 Option A) | `realtime_broadcast_error_total` > 1% over 5 min |
| Open customer-app tab on old bundle | certain (every restaurant context) | UI silently shows "unknown" status (already broken — same failure mode) | Phase 6.3 server-signaled forced reload (no bundle versioning today — see §9.2) | Customer support tickets > 5/hour |
| kitchen-display localStorage cache rejection storm | certain | one-time `GET /api/v1/kitchen/orders` per active tab | Phase 5 — flip validator to `typeof === "string"`, accept the rebuild | N/A — expected behavior |
| Customer-app `OrderTrackingView.vue` Record<number,…> lookups silently fail | certain (already failing in prod) | UI shows default branch instead of correct icon/color | Phase 5 — full rewrite of OrderTrackingView | N/A — already broken |
| API emits mixed wire format during staged deploy | medium | downstream Zod validators reject | Phase 6.1 dual-emit window OR atomic deploy | API 5xx > 0.5% |
| Contract test (`pnpm contract:check`) blocks deploy | ~~low~~ **certain since 2026-09-06** | blocks merge | ~~§7 finding: snapshot tracks field names only, not enum values — won't trip~~ — [#336](https://github.com/erictheng93/Makan-Masak/issues/336) made the snapshot type-aware and put the check in CI. Run `pnpm contract:update` in the same commit | CI red |
| OpenAPI/Swagger UI still serves wrong 5-member enum | high (existing) | external API consumers get wrong contract | Phase 2 update `apps/api/src/openapi/integration.ts:277-283` in lockstep | N/A — bug already shipped |
| `state-machine.test.ts` reverse-lookup `OrderStatus[upper]` breaks | high | 79-ref test file fails | Phase 2 Task 14 — rewrite to direct string lookup | CI red |
| `cache-coherence.test.ts` `OrderStatus.PENDING` sites break | high | 76-ref test file fails | Phase 2 — bulk rewrite | CI red |
| `permissions.test.ts` 10 sites break | high | test file fails | Phase 2 Task 15 — bulk rewrite | CI red |
| 4 admin-dashboard local OrderStatus definitions drift further | high | future feature work uses wrong type | Phase 3 — delete all 4, re-export from shared-types | N/A — sweep target |
| `apps/kitchen-display/src/types/index.ts:3` numeric union breaks 28 hardcoded comparisons in one PR | high | mass type errors when local type changes from `0\|1\|...\|6` to string union | Phase 5 — staged: rename type first, then sweep all 28 sites in same PR | CI red |
| `apps/api/src/features/orders/schemas/validation.ts` Zod enum missing `refunded` rejects valid status | medium | API 400s on `?status=refunded` | Phase 2 — add `refunded` to both Zod schemas (validation.ts + contracts/orders.ts + openapi/integration.ts) | API 4xx spike |
| `testing-utils/order.factory.ts` ships wrong status set (`COMPLETED`, no `PAID`/`REFUNDED`) | high | tests across monorepo build wrong fixtures | Phase 2 Task 13 — update factory in lockstep with shared-types | CI red |
| `OrdersService.normalizeStatus` numeric map missing `7: refunded` | medium | API 500 if a numeric `7` ever arrives | Phase 2 Task 14 — delete the method entirely | observed once |
| `useRealtimeOrderStatus.ts` inline 6-member union missing `paid`/`delivered`/`refunded` | medium | WebSocket message validation rejects | Phase 3 — replace with shared-types `OrderStatusUpdateEvent['data']['status']` | realtime errors |
| `kitchen-display/src/utils/offline-storage.ts` IndexedDB schema with `"received"` value (not in DB) | high | persisted IndexedDB rows have unrecognizable status | Phase 5 — bump dbVersion + onupgradeneeded migration | observable on read |
| `e2e/journeys/cross-role/order-lifecycle.spec.ts` uses numeric `currentOrderStatus` counter | medium | E2E test breaks when API returns strings | Phase 2 Task 12 — write Phase 1 regression first; spec rewrite in Phase 6 | E2E red |
| `apps/api/src/openapi/integration.ts` 5-member enum mismatches DB | high (existing) | public Swagger docs wrong | Phase 2 in lockstep | N/A — pre-existing |
| `OrderPermissions` interface unused in production | medium | dead code grows | Phase 3 sweep — flag for product decision | N/A |

## 10. Canonical State Decision (for Phase 0.5)

## 11. Migration Risk Register
