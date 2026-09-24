# `apps/admin-dashboard` — Backend Contract Reference (for Rust Backend Rewrite)

Source reviewed: `apps/admin-dashboard/src/services/**/*.ts`, `apps/admin-dashboard/src/stores/**/*.ts`, `apps/admin-dashboard/src/composables/**/*.ts`, `apps/admin-dashboard/src/utils/{errorHandler,authTokenProvider,api-url,background-sync,background-sync-requests,push-notifications}.ts`, `apps/admin-dashboard/.env.development`, `apps/admin-dashboard/vite.config.ts`, `apps/admin-dashboard/package.json`, plus the shared `packages/auth-client/src/**` (the axios wrapper every admin API call goes through) and view-level direct API calls (grepped across `src/views/**/*.vue`, `src/components/**/*.vue`) to close gaps not covered by a dedicated service file. Excludes `*.test.ts`/`*.spec.ts`/`__tests__/`.

This document describes what the **Vue 3 client actually sends and actually reads** — i.e. the contract a Rust rewrite of `apps/api` / `apps/management-api` / `apps/realtime` / `apps/image-processor` must preserve byte-for-byte to avoid silently breaking this app. It does not document UI components or styling.

---

## 1. Purpose & connection topology

The admin dashboard talks to **four** separate backends:

| Backend | Base URL (dev) | Client construct | Purpose |
|---|---|---|---|
| `apps/api` (main REST API) | `/api/v1` (proxied) | `api` / `apiClient` (from `src/services/api.ts`) | Everything except platform onboarding and images: orders, menu, tables, users, POS, queue, reservations, markets, backups, monitoring, subscriptions, feedback, scheduling, leaves, ingredients, forecast, AI analytics, payments. |
| `apps/management-api` (control plane) | `/management-api/v1` (proxied) → `http://localhost:8789` | `managementApi` (from `src/services/api.ts`) | Platform onboarding applications only (`onboardingApplicationsService.ts`). |
| `apps/realtime` (Durable Objects WS) | `ws://localhost:8788` (`VITE_REALTIME_WS_URL`) | `websocketService.ts`, plus raw `fetch()` in `realtimeService.ts` | Live order/kitchen/menu/system events over WebSocket. |
| `apps/image-processor` | `http://localhost:8790` (`VITE_IMAGE_API_URL`) | raw `fetch()` in `composables/useImageUpload.ts` | Menu item image upload (`POST /images/upload?category=menu`). |

### Vite dev proxy (`apps/admin-dashboard/vite.config.ts:44-58`)

```
/management-api  → VITE_MANAGEMENT_API_URL (minus /api/v1) or http://localhost:8789, path rewritten /management-api → /api
/api             → VITE_API_BASE_URL (minus /api/v1) or http://localhost:8787   (no path rewrite)
```

`VITE_IMAGE_API_URL` and `VITE_REALTIME_WS_URL` are **not proxied** — the client calls them directly (raw `fetch`/`WebSocket`), so in production these env vars must be absolute, publicly-reachable URLs (comment in `.env.development.example` confirms this for `VITE_MANAGEMENT_API_URL` too: "In production builds this MUST be set to an absolute URL").

### `.env.development` (committed, no secrets) — `apps/admin-dashboard/.env.development`

```
VITE_API_BASE_URL=/api/v1
VITE_IMAGE_API_URL=http://localhost:8790
VITE_REALTIME_WS_URL=ws://localhost:8788
VITE_APP_ENV=development
```

`VITE_MANAGEMENT_API_URL` is intentionally **unset** in dev — code falls back to `/management-api/v1` (`services/api.ts:110`), and `VITE_REALTIME_HTTP_URL`/`VITE_REALTIME_URL` (used by `realtimeService.ts` as alternate names for the realtime HTTP base) are also unset, so that service derives an HTTP base by rewriting `VITE_REALTIME_WS_URL`'s scheme (`ws:`→`http:`, `wss:`→`https:`).

### Auth token flow: `getAuthToken()`

Three independent places need the current bearer token but must not create a circular import with the Pinia auth store: `api.ts`'s axios interceptor (via `auth-client`'s own storage), `errorHandler.ts`, `useImageUpload.ts`, and `realtimeService.ts`. All of them go through the tiny provider singleton in `src/utils/authTokenProvider.ts`:

```ts
let authTokenProvider: () => string | null = () => null;
export function setAuthTokenProvider(provider: () => string | null): void { authTokenProvider = provider; }
export function getAuthToken(): string | null { return authTokenProvider(); }
```

`services/api.ts:107` wires this to `authClient.tokens.getToken()` at module load. **Important for the image upload path**: `useImageUpload.ts` deliberately reads `getAuthToken()` directly instead of `useAuthStore().token`, with an explicit code comment that the Pinia ref "can lag behind interceptor/proactive refreshes" — i.e. the storage-backed token, not the reactive store copy, is the source of truth for any hand-rolled `fetch()` call (image-processor upload, realtime broadcast/stats calls, error-report beacon).

---

## 2. Endpoint inventory

Unless noted, all `apps/api` paths are relative to `/api/v1` and all responses are unwrapped through `unwrapApiPayload`/`unwrapApiData`/`unwrapApiList` (`services/api.ts:19-34`), which pulls `.data` out of `{success, data, error}` and — defensively — one extra level of `{success, data}` nesting (`stores/order.ts:76-79` comment: "handle double-wrapped cache responses"). **The unified envelope `{success, error: {code, message, details?}}` is the load-bearing shape** — every catch-block in this app reads `err.response?.data?.error?.message` (string) and several (`errorHandler.ts:244-251`) also tolerate `error` being a bare string for "un-migrated routes."

### 2.1 Auth (`stores/auth.ts`)

| Method | Path | Called from | Request | Response fields read |
|---|---|---|---|---|
| POST | `/auth/login` | `auth.ts:206` | `{username, password}` | `data.token` (string), `data.refreshToken?`, `data.user` (full `User` object incl. `role`, `restaurantId`) |
| POST | `/auth/logout` | `auth.ts:240` | none | none (fire-and-forget; failure only logged) |
| GET | `/auth/me` | `auth.ts:264` | — | `data` = `User` |
| POST | `/auth/refresh` | `auth.ts:310`, `auth-client`'s `create-api-client.ts:69` | none, `withCredentials: true` (refresh token is an HttpOnly cookie, never read from JS) | `data.token`, `data.refreshToken?`, `data.user?` |
| POST | `/auth/exchange` | `services/api.ts:149` (`ensureManagementAuthToken`) | `{token: <admin API bearer token>}`, `withCredentials: true` | `data.token` — a **second**, management-API-scoped bearer token, cached in a separate `managementAuthClient` token store keyed `management_auth_*` |

**Token storage mode** (`getAdminTokenStorageMode`, `services/api.ts:36-42`): `sessionStorage` in dev (survives Vite full-reload), **`memory`-only in production** — i.e. production admin bearer tokens are never persisted to `localStorage`/`sessionStorage`; only the refresh flow (HttpOnly cookie) survives a hard reload. `auth_user` (the user object, not the token) is still persisted to `localStorage` for instant UI hydration (`hydrateUser`/`persistUser`, `auth.ts:14-30`).

**CSRF**: both `authClient` and `managementAuthClient` are created with `csrf: true` (`services/api.ts:91,122`), which — per `packages/auth-client/src/create-api-client.ts:15-24` — sends header `X-CSRF-Token` (from cookie `__Host-mm_csrf` or a cached value from a prior response header) on every `POST/PUT/DELETE/PATCH`.

### 2.2 Orders (`stores/order.ts`, plus direct calls in `ServiceView.vue`, `CashierView.vue`)

| Method | Path | Called from | Request | Response fields read |
|---|---|---|---|---|
| GET | `/orders?status=&page=&limit=&date=` | `order.ts:71` | query string built manually (comma-joined `status`) | `data` = `Order[]` (via `unwrapApiList`) |
| PUT | `/orders/:id/status` | `order.ts:91`, `ServiceView.vue:847,870` | `{status}` | `success` boolean only; client optimistically sets local `updatedAt`/`completedAt` |
| DELETE | `/orders/:id` | `order.ts:180` | ⚠️ wire payload is actually `{"data":{"reason":...}}` (or `{}`): `order.ts:180-182` passes `{data: {reason}}` to `ApiServiceCompat.delete`, which wraps its arg in `{data}` **again** (`api.ts:207-212`) — a double-wrap bug. Moot today: the server ignores the body and hardcodes `"Cancelled by user"` (`orders/routes/index.ts:718-748`). A Rust port should define the real contract (accept `{reason}` and fix the client, or accept none) rather than replicate either side | `success` only |
| GET | `/orders/:orderId` | `PaymentForm.vue:440` | — | order detail (ad hoc read) |
| GET | `/orders` (ServiceView filters) | `ServiceView.vue:762,788` | query params | order list |

### 2.3 Menu (`composables/useMenuManagement.ts`, `background-sync-requests.ts`)

| Method | Path | Request | Response fields read |
|---|---|---|---|
| GET | `/menu/:restaurantId?includeAll=true` | — | `data.categories[]`, `data.menuItems[]` — client coerces `isFeatured`/`isAvailable` to boolean and filters out `sortOrder === -1` (soft-deleted sentinel) |
| POST | `/menu/:restaurantId/categories` | `{name, nameEn?, description?, sortOrder}` | — |
| PUT | `/menu/categories/:id` | same shape | — |
| DELETE | `/menu/categories/:id` | — | — |
| PATCH | `/menu/:restaurantId/categories/reorder` | `{categories: [{id, sortOrder}]}` | — |
| POST | `/menu/:restaurantId/items` | full item incl. `imageUrl`, `imageId`, `imageVariants` (nullable) | — |
| PUT | `/menu/items/:id` | partial item, same image fields | — |
| DELETE | `/menu/items/:id` | — | — |
| PUT | `/menu/items/:id` (toggle) | `{isAvailable}` only | — |

**Image write-back contract**: `imageId`/`imageUrl`/`imageVariants` are three separate columns the menu item PUT/POST body carries — `imageVariants` is a `Partial<Record<"thumbnail"|"small"|"medium"|"large", string>>`. `previousImageId` is tracked client-side (`MenuView.vue:849`) to drive old-image cleanup after a successful re-upload — **a Rust backend must accept `imageId: null` explicitly to clear an image**, not just omit the field (client always sends `imageId: form.imageId || null`).

`background-sync-requests.ts` (used by a service-worker-style offline queue, `offline-storage.ts`) independently re-derives the **same three menu endpoints** (`PUT /menu/items/:id`, `DELETE /menu/items/:id`, `POST /menu/:restaurantId/items`) plus `POST /audit/actions`, `POST/{restaurantId}/analytics/sync` or `POST /analytics/batch-sync`, `POST /backup/upload`, `POST /admin/settings/sync` — these are **queued-when-offline** requests, lower confidence that they fire under normal conditions, but the paths are real and must exist server-side for the offline-sync feature to work at all.

### 2.4 Discovery / search index (`services/discoveryService.ts`)

| Method | Path | Response |
|---|---|---|
| POST | `/discovery/reindex` | `{dishes, restaurants, duration_ms}` |
| GET | `/discovery/index-status` | `DiscoveryIndexStatus` (see file for full field list — includes `unindexedAvailableDishCount`, `restaurantsWithUnindexedAvailableDishes`) |

### 2.5 Markets & market checkouts (platform admin) (`services/marketsService.ts`, `services/marketCheckoutsService.ts`)

Large surface (~20 endpoints) under `/markets`, `/admin/markets/*`, `/restaurants/:id/markets`, `/restaurants/:id/market-join-requests`, `/market-checkouts/admin*` (exception: `refund()` hits `/market-checkouts/:id/refund` with **no** `/admin` segment — `marketCheckoutsService.ts:415-419`). Notable shapes:
- All monetary fields on the checkout side are **cents-suffixed integers** (`totalAmountCents`, `paidAmountCents`, `refundedAmountCents`, `platformFeeCents`, `vendorNetAmountCents`) alongside a parallel non-cents `amount`/`totalAmount` float — **both representations are read by the client**, so a Rust rewrite must keep emitting both, not just one.
- `MarketCheckoutDetail.payment.parentPayment` / `.settlement` / `.childPayments` are deeply nested optional objects — the client treats every level as possibly absent (`payment?`, `parentPayment?`).
- Three CSV/blob export endpoints (`/market-checkouts/admin/export`, `/vendors/export`, `/accounting/export`) are called via `api.instance.get(..., {responseType: "blob"})` — bypasses the JSON envelope entirely; Rust must return a raw CSV body with correct `Content-Type`, not a JSON-wrapped one.
- `importMarkets`/`importVendors` support a `dryRun` flag whose presence in the request body is conditional (`...(options.dryRun ? {dryRun: true} : {})`) — omitted entirely, not sent as `false`, when not dry-running.

### 2.6 Onboarding applications (management-api only) (`services/onboardingApplicationsService.ts`)

| Method | Path (on `managementApi`, i.e. `/management-api/v1/...`) | Notes |
|---|---|---|
| GET | `/admin/onboarding/applications?status=&page=&limit=` | requires `ensureManagementAuthToken()` first (token-exchange call, §2.1) |
| POST | `/admin/onboarding/applications/:id/approve` | returns `{tenantId?, subdomain?, ownerAccount?, status: "completed"}` — `ownerAccount` includes a one-time `setupPasswordToken`/`setupPasswordLink` |
| POST | `/admin/onboarding/applications/:id/reject` | returns `{status: "rejected"}` |

### 2.7 POS (`services/posService.ts`, plus direct calls in `CashierView.vue`, `POSManagementView.vue`)

Registers (`/pos/registers*`), shifts (`/pos/shifts/*`), cash movements (`/pos/cash-movements`, `/pos/registers/:id/cash-movements`), receipts (`/pos/receipts/print`, `/pos/registers/:id/receipts`), refunds (`/pos/refunds/create`), promotions (`/pos/promotions*`), stats (`/pos/registers/:id/stats/daily`, `/pos/reports/daily`, `/pos/reports/export`), quick payment (`/pos/quick-payment`), and market-checkout POS payment (`POST /pos/market-checkouts/:checkoutId/pay` → `{checkout: {id, paymentStatus?}, payment: {status, method, totalAmountCents, paidAmountCents?}}`). All monetary POS fields observed are plain numbers (not cents-suffixed) except the market-checkout POS bridge, which is cents-suffixed — **an inconsistency inherited from two different subsystems, not a client bug**.

### 2.8 Queue / waiting list (`services/queueService.ts`, `services/waitingListService.ts` — two parallel, overlapping systems)

`queueService` hits `/queue/:restaurantId/current`, `/queue/:restaurantId/status`, `/queue/join`, `/queue/:queueId/position`, `/queue/:queueId/cancel`, `/queue/:restaurantId/call-next`, `/queue/:queueId/seat`, `/queue/:restaurantId/settings`, `/queue/:restaurantId/stats`, `/queue/performance`, `/queue/:restaurantId/optimize`. The client defensively normalizes the status response (`normalizeQueueStatus`, `queueService.ts:121-143`) accepting **either** a nested `data.queue.total_waiting` shape **or** a flat `data.totalWaiting` shape — evidence that the server response shape has changed at least once and the client papers over both. A Rust rewrite should pick one canonical shape and this normalization can then be deleted, but until then both must keep working.

`waitingListService` (static class methods) is a **separate, older** REST surface: `/waiting-list`, `/waiting-list/:id`, `/waiting-list/:id/call`, `/waiting-list/:id/seat`, `/waiting-list/:id/expire`, `/waiting-list/:id` (DELETE, body `{customerPhone}`), `/waiting-list/queue-status/:restaurantId`, `/waiting-list/estimate-wait/:restaurantId?partySize=`, `/waiting-list/stats/:restaurantId`, `/waiting-list/batch-call`. Both systems appear live in the codebase simultaneously — verify with backend routes which is actually mounted before assuming either is dead.

### 2.9 Reservations (`services/reservationService.ts`, static class)

`/reservations` (list/create), `/reservations/:id` (get/update), `/reservations/:id/{confirm,arrive,seat,complete,no-show,cancel}`, `/reservations/availability`, `/reservations/stats/:restaurantId`, `/reservations/slots` (create/batch).

### 2.10 Service bookings (`services/serviceBookingsService.ts`) & restaurant service items (`services/restaurantServiceItemsService.ts`)

Slots: `/service-bookings/slots` (list/create/batch/block). Bookings: `/service-bookings` (list), `/service-bookings/reminders/due`, `/service-bookings/:id/{reminder-sent,confirm-cash,complete,no-show}`, `DELETE /service-bookings/:id` (cancel), and a **non-fetch** helper `calendarInviteUrl(id)` that returns `/service-bookings/:id/ics` for direct browser navigation (`.ics` calendar file download, not JSON). Service items: `/restaurants/:id/service-items` CRUD.

### 2.11 Employees / scheduling / leaves (`services/schedulingService.ts`, `services/leavesService.ts`, `composables/useEmployeeList.ts`, `composables/useEmployeeData.ts`)

Scheduling: templates (`/scheduling/:restaurantId/templates`, `/scheduling/templates/:id`), schedules (`/scheduling/:restaurantId/schedules`, `/scheduling/schedules/:id`, bulk create), availability (`/scheduling/:restaurantId/available-employees`), clock in/out (`/scheduling/schedules/:id/{clock-in,clock-out,admin-clock-in,admin-clock-out}`), conflicts (`/scheduling/:restaurantId/conflicts`, `/scheduling/conflicts/:id/resolve`), swap requests (`/scheduling/:restaurantId/swap-requests`, `/scheduling/swap-requests/:id/{approve,accept,reject,cancel}`), stats (`/scheduling/:restaurantId/stats/{daily,weekly}`).

Leaves: `/leaves/:restaurantId/types`, `/leaves/balances`, `/leaves/:restaurantId/balances`, `/leaves/:restaurantId/balances/accrue`, `/leaves/:restaurantId/requests`, `/leaves/requests/:id/{approve,reject,cancel}`.

Users/employees: `/users` (list/create), `/users/:id` (get/update), `/users/:id/status` (PATCH), `/users/:userId/reset-password`.

### 2.12 Ingredients & recipes (`services/ingredientApi.ts`)

`/ingredients/:restaurantId` (CRUD, bulk import, categories), `/ingredients/:restaurantId/:id/stock` (PATCH quantity), `/ingredients/:restaurantId/recipes/:menuItemId` (get/set), `/recipes/:menuItemId/validate`, `/recipes/missing`.

### 2.13 Forecast (`services/forecastApi.ts`)

`/forecast/:restaurantId/generate` (also reused with `type: "ingredient_level"` body flag for ingredient-level forecast — **same endpoint, discriminated by body field**, not a separate route), `/forecast/:restaurantId` (get), `/forecast/:restaurantId/accuracy`, `/forecast/:restaurantId/alerts`, `/forecast/:restaurantId/ingredient-forecast`. All responses use non-null assertion `res.data.data!.forecasts` — **a missing `data.forecasts` key throws a TypeError client-side**, not a handled error.

### 2.14 AI Analytics (`composables/useAIAnalytics.ts`)

All under `/ai-analytics/*`: `/config/:restaurantId` (get/save), `/test-provider`, `/models/:provider`, `/generate` (report), `/products/{traffic-drivers,bestsellers,profit-leaders,analysis}/:restaurantId?timeRange=&limit=`, `/usage/:restaurantId?startDate=&endDate=`.

### 2.15 Subscriptions / billing (`services/subscriptionService.ts`, admin-only)

`/admin/subscriptions` (list/create), `/admin/subscriptions/:restaurantId` (get), `/admin/subscriptions/:restaurantId/modules` (PATCH), `/admin/subscriptions/:restaurantId/plan` (PATCH), `/admin/subscriptions/:restaurantId/status` (PATCH — kill switch), `/admin/subscriptions/:restaurantId/usage`, `/admin/subscriptions/:restaurantId/usage/events`.

### 2.16 Backups (`stores/backup.ts`, deleted 2026-09-25)

The admin-dashboard no longer calls any of these: the store and the backup views, which were never routed, were removed. The list is kept as the record of what the API exposes.

`/backup/create`, `/backup/list`, `/backup/:id` (get/delete), `/backup/:id/download` (`responseType: "blob"`, filename parsed from `content-disposition` header — **server must send that header**), `/backup/:id/restore`, `/backup/configurations/:restaurantId`, `/backup/configurations` (upsert), `/backup/system/health`, `/backup/restaurants/:id/metrics?period=`, `/backup/alerts/:restaurantId?unresolved_only=`, `/backup/alerts/:id/{acknowledge,resolve}` (PATCH).

### 2.17 Monitoring (`services/monitoringService.ts`, polled — not real WS, see §4)

`/monitoring/health`, `/monitoring/overview`, `/monitoring/metrics` (GET with query params, DELETE to reset), `/monitoring/alerts/rules` (CRUD-ish, paginated), `/monitoring/alerts/defaults`, `/monitoring/alerts/test`, `/monitoring/errors` (POST record error), `/monitoring/reports/performance`, **`/monitoring/alerts/recent?since=`** — this last one is polled every 15s by `monitoringWebSocket.ts` (see §4).

### 2.18 System / error reporting (`utils/errorHandler.ts`, `composables/error-reporting.ts`, `composables/usePerformanceMonitor.ts`)

`POST /system/error-report` (bare `fetch()`, not the axios client — manually attaches `Authorization`/`X-CSRF-Token` from cookie, batches up to 50 queued errors with exponential-backoff retry up to 3x, `errorHandler.ts:102-181`), `POST /system/performance` (`apiClient.post`, `usePerformanceMonitor.ts:24`).

### 2.19 Feedback (`composables/useFeedback.ts`)

`/feedback` (create, list-by-id, stats), `/feedback/:id/status` (PUT), `/feedback/:id/responses` (POST create, PUT update, DELETE), `/feedback/:id` (PATCH update, DELETE).

### 2.20 Coupons, tables/seats, users, settings, integrations, group orders — view-level direct calls (no dedicated service file)

These domains call `api`/`apiClient` directly from `.vue` files rather than through a service module — grepped, not exhaustively read line-by-line:

- **Coupons** (`views/CouponsView.vue`): `/coupons` (list/create), `/coupons/:id` (put), `/coupons/:id/deactivate`, `/coupons/:id` (delete).
- **Tables/Seats** (`views/seating/TableSetupTab.vue`, `views/TableDetailView.vue`, `views/seating/QueueDashboardTab.vue`, `components/tables/SeatManagement.vue`): `/tables` (list/create), `/tables/:id` (get/put), `/tables/:id/{occupy,release,clean}`, `/tables/bulk-qr`, `/seats` (list), `/seats/:id` (put/delete), `/seats/:id/release`, `/seats/:id/regenerate-qr`, `/seats/batch-create`, `/seats/batch-regenerate-qr`, `/seats/table/:tableId` (delete).
- **Users/Accounts** (`views/UsersView.vue`, `views/AccountManagementView.vue`): `/users` (create), `/users/:id` (put), `/users/:id/status` (patch), `/users/:id/reset-password` (post).
- **Settings/Restaurant profile** (`views/SettingsView.vue`): `/restaurants/:id` (put), `/restaurants/:id/contact-profile` (put), `/restaurants/:id/shop-mode` (put, called twice with different bodies at two call sites).
- **Integrations** (`components/settings/IntegrationsSettings.vue`): `/integrations/:restaurantId/uber_eats/connect` (post), `/integrations/:restaurantId/uber_eats` (put/delete), `/integrations/:restaurantId/uber_eats/menu-sync` (post).
- **Group orders** (`services/groupOrdersService.ts`): `/orders/group*` — full CRUD + cart + split-bill + share-code + QR + stats + CSV export (`/orders/group/export`, blob).
- **Push notifications** (`utils/push-notifications.ts`): `POST /push/subscribe` (body includes `user_type: "admin"`, `role`, optional `restaurant_id`, `device_info`), `PUT /admin/notification-settings`.
- **Owner dashboard** (`services/ownerService.ts`): `/analytics/owner-dashboard`, `/analytics/financial-report`, `/analytics/realtime-dashboard` (also used by `statisticsService.ts`), `/alerts/:id/{resolve,escalate}`.
- **Statistics** (`services/statisticsService.ts`): `/analytics/realtime-dashboard`, `/analytics/detailed-performance` — both polled on a client-managed interval (`startAutoRefresh`, default 30s), not pushed.
- **Dashboard analytics** (`stores/dashboard.ts`): `/analytics/dashboard`, `/analytics/revenue`, `/analytics/products` — client defensively reads several alternate field names per data point (`point.label ?? point.date ?? point.week ?? point.month ?? point.year`, `point.revenue`, `point.orderCount ?? point.orders`) — **again evidence of a shape that has drifted over time**; a Rust rewrite should emit one canonical field name per value and this fallback chain becomes dead code, but must not remove any of the aliases without also updating the client.

---

## 3. Auth & session

- **Login**: `POST /auth/login` → store `token` (memory/sessionStorage per `getAdminTokenStorageMode`) + `user` (localStorage, for instant hydration) → `authClient.tokens.scheduleProactiveRefresh(token)` starts a timer that fires `refreshToken()` at **80% of token lifetime** (`packages/auth-client/src/create-token-manager.ts:56-63`, delay computed by `@makanmasak/utils`'s `getRefreshDelay(token)` — i.e. the client parses the JWT `exp` claim client-side to schedule this).
- **Session restore**: on app boot, `user` is hydrated synchronously from `localStorage` (`hydrateUser`); `checkAuth()` then calls `GET /auth/me` to revalidate — on `401`/`403` it logs out, on **any other error** (429, 5xx, network) it keeps the locally-hydrated user and does **not** log out (`auth.ts:273-291` — deliberate to avoid wiping sessions on transient errors).
- **Reactive 401 handling** (`packages/auth-client/src/create-api-client.ts:134-164`): a response interceptor catches `401` on any request not already marked `_retry`, calls `tokenManager.refreshToken()` (`POST /auth/refresh`, `withCredentials: true`, itself marked `_retry` to avoid recursion), and on success replays the original request once with the new `Authorization` header. On failure it clears all local storage and invokes `onAuthFailure` → `handleAdminAuthFailure` (`services/api.ts:70-81`) which clears **both** `authClient` and `managementAuthClient` storage plus the legacy flat keys (`auth_token`, `auth_refresh_token`, `auth_user`, `management_auth_token`, `management_auth_refresh_token`, `management_auth_user`) and redirects to `/login` exactly once (`loginRedirectRequested` guard against redirect storms from concurrent failing requests).
- **Refresh deduplication**: both `stores/auth.ts` (`sharedRefreshPromise`, module-scoped) and `create-token-manager.ts` (its own `sharedRefreshPromise`) independently deduplicate concurrent refresh calls — there are **two separate refresh call sites** (the Pinia store's own `refreshToken()` used by `usePolling.ts`/manual callers, and the axios interceptor's automatic one) that do not share state with each other, only within themselves.
- **Role handling**: `UserRole` enum 0–5 per CLAUDE.md (Admin/Owner/Chef/Service/Cashier/Customer). `hasPermission(role | role[])` checks `user.role` membership; route-level guards live in a hardcoded `routePermissions` map in `auth.ts:154-195` (not server-driven — the Rust backend does not need to expose a permissions endpoint for this, but every route the client can reach must still enforce the same role check server-side since this is client-side-only gating).
- **Headers sent on every request** (via `authClient`/`managementAuthClient` interceptor, `create-api-client.ts:93-120` (`Authorization`/`X-CSRF-Token`; `Content-Type: application/json` comes from the axios instance defaults at `create-api-client.ts:55-58`)): `Authorization: Bearer <token>` (if present), `X-CSRF-Token` (state-changing methods only, from cookie `__Host-mm_csrf` or cached response header), `Content-Type: application/json` (default).
- **Management API token exchange**: admin bearer token → `POST /auth/exchange`, sent on **`managementAuthClient.instance`** (i.e. against the management-api base URL, not the main API — `services/api.ts:147-152`) with body `{token: <api-worker-issued admin JWT>}` and `withCredentials: true` → management-scoped token, cached separately (`management_auth_*` keys), refreshed via the same `create-api-client.ts` refresh pattern but against **management-api's own** `/auth/refresh`. A Rust management-api rewrite must implement its own independent `/auth/refresh` and accept the `/auth/exchange` handshake taking `{token: <api-worker-issued-JWT>}`, verifying it (presumably by calling back into or sharing a JWT secret with the main API) before minting a management-scoped token.

---

## 4. Realtime usage

There are **three independent realtime/near-realtime mechanisms** in this app, not one:

### 4.1 True WebSocket (`services/websocketService.ts`, wrapped by `services/realtimeService.ts`)

1. Client calls `POST /realtime/auth/token` on the **main API** (not the realtime worker) with body `{roomType: "admin", roomId: restaurantId, restaurantId, sessionId: <bearer token>}` (`websocketService.ts:80-94`).
2. Server (`apps/api`'s `RealtimeAuthService`) returns `{token, wsUrl}` inside the standard envelope — client unwraps `envelope.data.token`/`envelope.data.wsUrl` (a fix noted in-code: earlier code read these off the outer envelope by mistake).
3. Client opens `new WebSocket(wsUrl)` directly — **`wsUrl` already has `?token=...` appended by the server**; the client must not append it again (in-code comment warns this produces `?token=T1?token=T2` and a 401 from the DO).
4. Room path used in practice: `/admin/:restaurantId` on the realtime worker (confirmed to exist server-side, see `docs/Backend-Rust-refactor/realtime.md` §3). `roomType: "admin"` is the only value the admin dashboard ever requests via this path.
5. **Heartbeat**: client sends the string `"ping"` (not JSON) every 30s (`heartbeatInterval`) and expects the literal string `"pong"` back within 10s (`heartbeatTimeout`) or it force-closes with code `4000`. All other messages are JSON `RealtimeEvent` objects (`{eventId, type, data, timestamp, restaurantId}`).
6. **Missed-event replay**: on reconnect, if `lastEventId` is set, client sends `{type: "REQUEST_MISSED_EVENTS", sinceEventId: lastEventId}` — server-side support for this message type must exist for reconnect-catchup to work (not verified here whether the DO implements it; flag for cross-check against `realtime.md`).
7. **Reconnect**: exponential-ish linear backoff (`reconnectDelay * attempt`, max 5 attempts), plus reconnect-on-`visibilitychange`(tab foreground) and reconnect-on-`navigator online` event. Client does **not** retry on WS-token-fetch HTTP 400/401/403/429 (treats these as unrecoverable).
8. Events consumed (via `RealtimeEventType` enum from `@makanmasak/shared-types`, subscribed in `useAdminRealtime.ts` and `useRealtimeConnection.ts`): `NEW_ORDER`, `ORDER_STATUS_UPDATE`, `ORDER_ITEM_STATUS_UPDATE`, `ORDER_CANCELLED`, `KITCHEN_ITEM_STATUS`, `KITCHEN_QUEUE_UPDATE`, `MENU_AVAILABILITY_UPDATE`, `MENU_ITEM_UPDATE`, `TABLE_CALL_SERVICE`, `SYSTEM_NOTIFICATION`, `RESTAURANT_STATUS_UPDATE`, plus generic `CONNECTION_ACK`/`ERROR`/`HEARTBEAT` handled internally by `websocketService.ts` before dispatch to subscribers.
9. **Two parallel connection composables exist** doing overlapping subscriptions: `useAdminRealtime.ts` (used where imported — check call sites) and `useRealtimeConnection.ts` (imported by `DefaultLayout.vue`/`Header.vue`, i.e. the one actually wired into the app shell's mount/unmount lifecycle). `useRealtimeConnection.ts` also exports a **dead/unused** helper `buildRealtimeWebSocketUrl()` that constructs `/admin/:restaurantId?token=<raw authStore.token>` directly from `VITE_REALTIME_WS_URL` — this bypasses the `/realtime/auth/token` exchange entirely and is not called by the actual `connect()` function in the same file (which instead delegates to `websocketService.connect()`, i.e. the token-exchange path). Treat it as vestigial, not a second live auth path, but confirm it isn't invoked from a test or elsewhere before deleting server-side support for raw-token WS auth.

### 4.2 Realtime worker's **non-WS** HTTP endpoints called by `realtimeService.ts` — likely broken

`realtimeService.ts:296-332` makes plain `fetch()` calls (not through the axios client) to:
- `POST {realtimeHttpBase}/broadcast/:roomType/:roomId` — used by `broadcastToGroup()` (called by `groupOrderBroadcastService.ts`, `collaborativeOrderService.ts` for group-order live-cart sync)
- `GET {realtimeHttpBase}/stats/:roomType/:roomId` — used by `checkGroupConnectionHealth()`

**These paths do not exist on the realtime worker's public router.** Per `docs/Backend-Rust-refactor/realtime.md` §3, the public Hono app in `apps/realtime/src/index.ts` only exposes `GET /health`, `GET /customer/:tableId`, `GET /admin/:restaurantId`, `GET /kitchen/:restaurantId`, and its `404` handler explicitly lists those four as `availableEndpoints` — confirmed directly against `apps/realtime/src/index.ts:139-154` in this session. The `/broadcast` and `/stats` operations **do exist**, but only as **internal Durable-Object-to-Durable-Object** handlers reachable via `stub.fetch()` from another Worker holding a DO stub — never exposed publicly. A public `fetch()` to `https://realtime.makanmasak.com/broadcast/group_order/<id>` from the browser would hit the realtime worker's public router, fail the route match, and get the JSON 404 body — not the intended broadcast. **This means `groupOrdersService`'s live group-cart broadcast/health-check path is very likely non-functional in any real deployment today** (or is masked by the `try/catch` in `broadcastToGroup()`/`checkGroupConnectionHealth()` silently swallowing the failure and returning `false`/a zeroed stats object). A Rust rewrite must either (a) add a public, authenticated `/broadcast/:roomType/:roomId` and `/stats/:roomType/:roomId` route to the realtime worker's Hono router, or (b) fix the client to route this through a proper API-worker-mediated call. Do not assume today's behavior is "working" — verify against a real deployment before treating either endpoint as a stable contract.

### 4.3 Polling disguised as WebSocket (`services/monitoringWebSocket.ts`)

Despite the name and the exported singleton `monitoringWebSocket`, this is **pure HTTP polling**, not a WebSocket — file header comment: "Alert notifications via periodic polling (replaces broken WebSocket)". `connect()` starts a 15s `setInterval` hitting `GET /monitoring/alerts/recent?since=<lastPollTimestamp>`; there is no `WebSocket`/`EventSource` object anywhere in this file. Any consumer expecting a live push channel here is actually getting up-to-15s-stale polled data.

### 4.4 Server-Sent Events (`composables/useStatisticsSSE.ts`)

Real `EventSource` connection to `GET /analytics/sse` (confirmed to exist server-side at `apps/api/src/features/analytics/routes/index.ts:580`) on the **main API base** (via `apiUrl("/analytics/sse", VITE_API_BASE_URL)`), not the realtime worker. Named SSE event types listened for: `order_created`, `order_updated`, `order_completed`, `order_cancelled`, `statistics_update`, `heartbeat`, plus a generic unnamed `onmessage`. Client tracks `lastEventId` and resends it as a `?lastEventId=` query param on reconnect (standard SSE resume pattern — requires server support for `Last-Event-ID`-style replay via query param, not the `Last-Event-ID` header, since `EventSource` cannot set custom headers). 60s no-message timeout triggers a manual reconnect with exponential-ish backoff (`retryDelay * 1.5^attempt`, max 5 attempts).

---

## 5. Error handling contract

- **Envelope shape parsed everywhere**: `{success: boolean, data?: T, error?: {code, message, details?} | string}`. The `string` fallback for `error` is explicitly tolerated (`errorHandler.ts:246-248`, comment: "Backward compatibility: un-migrated routes may still return error as string") — **a Rust rewrite must always emit the object form**, but should not assume every legacy route already does.
- **Status codes branched on** (`errorHandler.ts:239-259`): `>= 500` → severity HIGH; `401`/`403` → reclassified as `ErrorType.PERMISSION`, message forced to a generic "權限不足或登入已過期" (the server's actual message is discarded for 401/403 specifically); everything else → generic API error, severity MEDIUM.
- **Silent-telemetry allowlist** (`errorHandler.ts:278-290`): errors whose request URL contains `/monitoring/health`, `/monitoring/metrics`, `/analytics/performance`, or `/system/error-report` never surface a toast — these are expected to fail/degrade without alarming the user.
- **Suppressed 401/403 toast on login page or pre-token requests** (`errorHandler.ts:298-308`): if on `/login` or no token is currently held, permission-type errors are swallowed silently (expected 401 from an early auto-fetch before login completes).
- **Retry/refresh logic**: only 401 triggers a refresh-and-retry (once, via `_retry` flag); every other status is terminal from the interceptor's perspective. `KitchenErrorHandler.handleTokenRefresh()` (a second, mostly-unused refresh path wired to `authRefreshHandler`) redirects to `/login` on refresh failure and shows a toast — but note `stores/auth.ts:280` explicitly warns not to call `refreshToken()` again inside `checkAuth()`'s catch block since the axios interceptor already tried once; there is a real risk of **double-refresh races** if both paths are triggered by the same failing request in different code paths.
- **Idempotency**: `payment.ts`'s `createPayment()` sends a client-generated `Idempotency-Key: payment-<orderId>-<uuid>` header (`stores/payment.ts:178`, `createPaymentIdempotencyKey`) — per CLAUDE.md's idempotency-strategy rule, the Rust payments endpoint must honor this header with a DB-level partial-unique-index-backed idempotency check, not just accept and ignore it.
- **Error reporting beacon**: `POST /system/error-report` is queued (max 50), sent via a raw (non-axios) `fetch()` with manually-attached `Authorization`/`X-CSRF-Token`, retried up to 3x with exponential backoff (`30s * 2^n`, capped 120s) on non-2xx, then the queue is dropped after exhausting retries (errors are not persisted past a page reload).
- **Offline handling**: `OfflineManager` (inside `errorHandler.ts`) listens for `online`/`offline` browser events and queues failed-due-to-offline requests for replay — but the actual replay function (`handleOfflineRequest`) is a stub that always rejects with "Request retry not implemented" (`errorHandler.ts:465-483`). **This offline-retry path does not actually work today** — worth knowing so a Rust rewrite doesn't spend effort supporting a client capability that isn't real yet.

---

## 6. Rust rewrite compatibility notes

Concrete shape sensitivities that will silently break this client if changed:

1. **Envelope discipline**: every 2xx must be `{success: true, data: T}`; every error must be `{success: false, error: {code, message, details?}}` with `error` as an **object**, not a bare string (client tolerates the string form for legacy routes but this must not be introduced as new behavior).
2. **`unwrapApiPayload` double-nesting tolerance** (`services/api.ts:19-25`): if `payload.data` is itself `{success, data: [...]}"`, the client unwraps one more level. A Rust rewrite should never intentionally produce double-wrapped responses, but be aware some caching layer historically did — don't be surprised if a stale cache still emits this shape during a rollout.
3. **`imageId: null` vs. omitted** must be distinguishable-and-both-supported on menu item PUT — client always sends an explicit `null` to clear, never omits the key.
4. **Money fields**: some domains use **cents-suffixed integers** (`market-checkouts`, some `pos/market-checkouts` bridge fields) and others use **plain floats** (most of `posService`, `Order.totalAmount`, dashboard analytics) — these are genuinely different conventions per subsystem in the current TS backend, not a client bug; a Rust rewrite must preserve which convention each specific endpoint uses rather than "fixing" it to be consistent, or every numeric comparison/display in the client for that domain breaks.
5. **Multiple accepted field-name aliases** the client already tolerates and must keep receiving at least one of: dashboard analytics points (`label`/`date`/`week`/`month`/`year`, `revenue` vs `value`, `orderCount` vs `orders`); queue status (`data.queue.total_waiting` vs `data.totalWaiting`, and 6 more parallel pairs in `normalizeQueueStatus`). Do not remove the "old" alias without confirming the client has been updated in lockstep.
6. **Timestamps**: realtime events (`RealtimeEvent.timestamp`) are read as **epoch milliseconds** and converted via `new Date(event.timestamp).toISOString()` (`realtimeService.ts:61`) — sending an ISO string here instead of a number breaks `toRealtimeMessage()`. Elsewhere (orders, most REST resources) the client reads ISO-8601 strings directly (`order.updatedAt = new Date().toISOString()` on optimistic update) — i.e. **realtime-worker payloads use epoch-ms, REST API payloads use ISO strings**, and these must not be homogenized without updating both call sites.
7. **`wsUrl` must arrive pre-signed** with its own `?token=` query param from `/realtime/auth/token` — the client does not append the token itself; changing the auth-token endpoint to return a bare host without the token breaks the WS handshake (double-token-append bug is explicitly guarded against in a code comment).
8. **`POST /realtime/auth/token` response must be envelope-wrapped** (`{success, data: {token, wsUrl}}`) — `websocketService.ts:109-116` explicitly unwraps `envelope.data`, with an in-code note that a prior server version returned the fields at the top level and broke the client until this was fixed. Do not regress to a flat shape.
9. **Content-Disposition header required** for `/backup/:id/download` — filename is parsed from it client-side (`content-disposition.split("filename=")[1]`); a response without this header falls back to a generic `backup_<id>.json` name regardless of actual format.
10. **Blob/CSV endpoints must not wrap in JSON**: `/market-checkouts/admin/export`, `/vendors/export`, `/accounting/export` are requested with `responseType: "blob"` and the raw body used as file content — wrapping these in `{success, data}` JSON breaks the download. ⚠️ `/orders/group/export` (`groupOrdersService.ts:315-324`) is **missing** the `responseType: "blob"` override — axios JSON-parses it, so that export is likely broken client-side today; decide the contract explicitly in the port.
11. **`/broadcast/:roomType/:roomId` and `/stats/:roomType/:roomId` are called by the client as public HTTP but do not exist on the realtime worker's public router today** (see §4.2) — this is either a pre-existing bug to fix during the Rust rewrite (by adding the routes) or a signal the group-order live-broadcast feature should be considered non-functional and out of scope; flag to the team rather than silently preserving broken behavior.
12. **`REQUEST_MISSED_EVENTS` WS message**: client sends `{type: "REQUEST_MISSED_EVENTS", sinceEventId}` on reconnect (`websocketService.ts:270-277`) expecting replayed events — confirm the Durable Object actually implements replay-on-this-message (cross-reference `realtime.md`'s note about a 100-event/24h rolling history) before assuming this round-trips correctly.
13. **Idempotency-Key header on `POST /payments/create`** must be honored for dedup, per CLAUDE.md's payment idempotency rule — the key format is `payment-<orderId>-<uuid>`, generated fresh per attempt (so retries from the client each get a **new** key — the client is not relying on stable-key-retry semantics, it relies on the *server* deduping by whatever key arrives, so this is really just "accept and store the key," not "detect client retries via a fixed key").
14. **Non-null-assertion call sites**: `forecastApi.ts:19` (`res.data.data!.forecasts`) and `ingredientApi.ts:47` (`res.data.data!.ingredient`) chain a property access onto the assertion, so a missing `data` **throws a TypeError at the call site**. `schedulingService`/`subscriptionService`/`monitoringService`/`leavesService` use bare `return response.data.data!;` — no immediate throw, they silently return `undefined` typed as non-undefined (failure surfaces later). `posService` and `queueService` use the defensive `unwrapApiData`/`unwrapApiList` helpers and have **zero** non-null assertions. A Rust rewrite must always populate `data` (even as `{}` or `[]`) whenever `success: true`.
