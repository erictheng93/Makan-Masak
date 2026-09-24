# Modular Billing

This document captures the modular billing gates, usage meters, and quota
controls implemented for the API and admin dashboard.

## Modules

There are **14** modules, defined once in the `MODULES` constant in
`packages/database/src/schema/subscriptions.ts`. `ModuleKey` is derived from it,
so adding a key there propagates through the gate, the admin schemas, and the
frontend store. Module keys are TypeScript constants, not rows — adding one
needs no SQL migration.

| Group | Module keys |
| --- | --- |
| Core (3) | `menu_management`, `table_management`, `online_ordering` |
| Pro (6) | `pos`, `kitchen_display`, `receipt_printing`, `coupons`, `reservations`, `analytics` |
| Enterprise (5) | `ai_analytics`, `platform_integration` (Uber Eats, Foodpanda, etc.), `loyalty`, `inventory`, `staff_management` |

There is no `waiting_list` module key — waiting-list routes gate on
`reservations`. Likewise `/payments` gates on `online_ordering`. `/forecast` is split: demand
forecasting, accuracy and alerts gate on `analytics`, while the ingredient
forecast and the `generate` call with `type: "ingredient_level"` gate on
`inventory`, alongside `/ingredients/*`. `/feedback` is deliberately ungated —
it is the support-ticket channel and must not depend on plan tier. The prefix → module map that the
pre-commit audit enforces lives in `scripts/audit-module-gates.cjs`.

## Plan Defaults

There are **4** plan tiers in `PLAN_TIERS`: `trial`, `basic`, `pro`,
`enterprise`. Module access starts with `PLAN_DEFAULT_MODULES` in
`packages/database/src/schema/subscriptions.ts`, then applies per-shop
`shop_subscriptions.module_overrides`.

- `basic` (3 modules): `menu_management`, `table_management`, `online_ordering` (the 3 core modules; no POS, kitchen display, coupons, analytics, reservations, etc.).
- `pro` (9 modules): `basic` modules plus `pos`, `kitchen_display`, `receipt_printing`, `coupons`, `reservations`, `analytics`. Waiting-list shares the `reservations` module.
- `enterprise` (all 14): `pro` plus `ai_analytics`, `platform_integration`, `loyalty`, `inventory`, `staff_management`.
- `trial` (all 14): the same set as `enterprise`, but only until `trial_ends_at_ms`. The gate itself starts returning `403 TRIAL_EXPIRED` the moment `trial_ends_at_ms` passes; `TrialReaperService.downgradeExpiredTrials`, run by the daily `15 2 * * *` billing-lifecycle cron, then rewrites the row to `plan_tier = 'basic'`, resets `module_overrides` to `{}`, and rolls a fresh `DEFAULT_BILLING_CYCLE_MS` (30-day) cycle. Enforcement does not wait for the cron.

Trial length is **180 days (six months)** on every path, from `TRIAL_DURATION_MS` /
`TRIAL_DURATION_DAYS` in `packages/database/src/utils/plan-mapping.ts`. Both
Management-API onboarding (`OnboardingService`, `TenantService`) and
`SubscriptionService.provisionDefaultForRestaurant` read that constant; they
previously disagreed (14 vs 30 days) depending on which door a shop came
through.

`planIdToTier` (same file) maps onboarding plan ids onto tiers: `standard → basic`,
`professional → pro`, `enterprise → enterprise`; any other value, including
`null`, falls back to `trial`.

Deployment mode is not stored on `shop_subscriptions`. The active product model
is platform-managed hosting, with deployment concerns handled by platform
configuration instead of per-shop subscription data.

## Module Overrides

`shop_subscriptions.module_overrides` is a JSON column
(`ModuleMap = Partial<Record<ModuleKey, boolean>>`, default `'{}'`) that is
merged **on top of** the plan defaults, per module key. It exists so a single
shop can be adjusted without moving it to a different plan.

It works in **both directions**:

- `{"analytics": true}` grants `analytics` to a `basic` shop whose tier does not include it.
- `{"online_ordering": false}` revokes `online_ordering` from a shop whose tier does include it.
- A key that is absent falls back to the plan default.

Overrides beat plan defaults but lose to the two coarser controls: `is_active = 0`
(kill switch) and an expired trial are both evaluated *before* the override, so
an override can never keep a suspended or expired shop running. See the
resolution order in [API Gates](#api-gates).

### Applying an override

Preferred — the admin API (role 0 only), which invalidates the cache for you:

```http
PATCH /api/v1/admin/subscriptions/:restaurantId/modules
Content-Type: application/json

{ "overrides": { "analytics": true } }
```

The payload is a **sparse patch**: `SubscriptionService.updateModules` merges it
into the existing map rather than replacing it, so untouched keys survive. The
admin dashboard's Subscriptions page exposes the same call as a per-module
toggle chip. Note that `changePlan`
(`PATCH /api/v1/admin/subscriptions/:restaurantId/plan`) deliberately resets
`module_overrides` to `{}` — switching tiers wipes every override.

Direct SQL (remote D1, break-glass) — write the whole map:

```sql
UPDATE shop_subscriptions
SET module_overrides = '{"analytics": true}'
WHERE restaurant_id = '...';
```

…or patch a single key without disturbing the others:

```sql
UPDATE shop_subscriptions
SET module_overrides = json_patch(COALESCE(module_overrides, '{}'), '{"analytics": true}')
WHERE restaurant_id = '...';
```

To reset a module back to its plan default, the key must be *removed* from the
map, not set to `false`. `json_patch` with a `null` value does exactly that:

```sql
SET module_overrides = json_patch(COALESCE(module_overrides, '{}'), '{"analytics": null}')
```

`updateModules` deletes keys whose value is `undefined`, but JSON has no
`undefined` literal and `updateModulesSchema` only accepts booleans, so the
reset-to-default case is not reachable over HTTP today — use the SQL form.

### Cache invalidation (required)

Both readers of a subscription — `moduleGate` and `GET /api/v1/me/modules` —
read/write the KV key `subscription:${restaurantId}` with
`CACHE_TTL_SECONDS = 300` (**5 minutes**). The admin routes call
`invalidateSubscriptionCache` (`apps/api/src/middleware/moduleGate.ts`) after
every module, plan, and status change, so API-driven edits take effect within
seconds.

**If you change `shop_subscriptions` directly in D1, nothing invalidates that
key** and the change will not take effect until the TTL lapses — up to 5 minutes
of stale allow/deny for both the API gate and the frontend module list. Delete
the key yourself:

```bash
pnpm wrangler kv key delete --binding=CACHE_KV "subscription:<restaurantId>" --remote
```

## API Gates

Use `moduleGate("<module>")` after authentication and before route handlers
(`apps/api/src/middleware/moduleGate.ts`). Admins (`role === 0`) bypass the gate
unconditionally, before any subscription lookup. For everyone else the
middleware reads `c.get("user").restaurantId` and loads the subscription from KV
or D1.

`resolveModule` then decides access in this order:

1. `is_active === false` → denied (kill switch).
2. `plan_tier === 'trial'` and `trial_ends_at_ms` is set and now past it → denied.
3. `module_overrides[module]` if the key is present → use that value.
4. Otherwise `PLAN_DEFAULT_MODULES[plan_tier][module] ?? false`.

Blocked requests get one of four `403` codes:

| Code | Meaning |
| --- | --- |
| `NO_RESTAURANT` | The authenticated user has no `restaurantId` (thrown before any subscription lookup) |
| `SUBSCRIPTION_NOT_FOUND` | No `shop_subscriptions` row for the restaurant — it was never onboarded |
| `TRIAL_EXPIRED` | Trial tier past `trial_ends_at_ms` |
| `MODULE_NOT_ENABLED` | Everything else — plan default or override says no, or the kill switch is off |

Current protected prefixes live in `apps/api/src/app-factory.ts`. Coverage is
enforced by the pre-commit `scripts/audit-module-gates.cjs` check ("Module gate
audit passed (N checks)" in commit output) plus per-feature route tests
(e.g. `apps/api/src/features/subscriptions/routes/index.test.ts`) — there is no
single `module-gate-coverage.test.ts` file.

## Frontend Gates

Use `packages/shared/components/ModuleGate.vue` around paid UI surfaces:

```vue
<ModuleGate module="analytics">
  <AnalyticsPanel />
  <template #fallback>
    <UpgradePrompt module="analytics" />
  </template>
  <template #loading>
    <div class="h-32 animate-pulse rounded-lg bg-gray-100" />
  </template>
</ModuleGate>
```

`ModuleGate` uses `useModuleAccess()`, backed by
`packages/shared/stores/moduleAccess.ts`. Apps should fetch module access after
auth is available; admin-dashboard does this during bootstrap and each gate can
render a loading slot while the store is empty.

## Usage Metering

Usage writes are append-only in `usage_events`, then the scheduled
`usage-aggregator` worker rolls them up into per-cycle `usage_meters` rows every
five minutes.

| Meter key | Source | Unit |
| --- | --- | --- |
| `orders.created` | order creation routes | count |
| `api.requests` | global API middleware | count |
| `print.jobs` | receipt generation route | count |
| `ai.requests` | AI analytics routes | count |
| `storage.bytes` | daily storage snapshot from `storage_counters` | bytes |

`storage_counters` tracks the current R2 byte total and image count per
restaurant. The daily `storage-snapshot` worker emits a `storage.bytes` usage
event for each non-empty counter row.

## Quotas

Plan quotas live in `packages/database/src/utils/plan-quotas.ts`. Undefined
means unlimited. `quotaGate()` applies only to request-scoped paid meters:
`orders.created`, `print.jobs`, and `ai.requests`. `api.requests` and
`storage.bytes` are visible in reporting but are not request-blocking gates.

`QUOTA_ENFORCEMENT_MODE` controls behavior:

- `disabled`: bypass quota checks.
- `warn`: return `X-Quota-Warning` after the soft limit.
- `enforce`: return `429 QUOTA_EXCEEDED` at the hard limit.

## Usage APIs

- `GET /api/v1/me/usage` returns the current restaurant cycle and meter
  progress for the authenticated staff user.
- `GET /api/v1/admin/subscriptions/:restaurantId/usage` returns current usage
  plus recent cycle aggregates.
- `GET /api/v1/admin/subscriptions/:restaurantId/usage/events` returns paged
  raw events for debugging and billing disputes.

The admin dashboard exposes this data from the Subscriptions page's Usage tab.
