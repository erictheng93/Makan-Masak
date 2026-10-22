# `apps/management-portal` — Backend Contract Reference

This document records exactly how the `management-portal` Vue 3 frontend
(platform management portal, Vite dev port 3010) consumes its backend, so
that backend (`apps/management-api`) can be rewritten in Rust without
silently breaking this client. It is scoped to the frontend's *observed
usage* of the API — not a spec of what the API should do. Cross-referenced
against `docs/Backend-Rust-refactor/management-api.md` (the server-side
reference) wherever a discrepancy was found.

All file paths are repo-relative from `/Users/eric/Documents/Code/Makan-makan`.

Files read: `apps/management-portal/src/services/api.ts`,
`apps/management-portal/src/services/auth.ts`,
`apps/management-portal/src/stores/tenants.ts`,
`apps/management-portal/src/stores/health.ts`,
`apps/management-portal/src/types/index.ts`,
`apps/management-portal/src/router/index.ts`,
`apps/management-portal/src/main.ts`,
`apps/management-portal/vite.config.ts`,
`apps/management-portal/wrangler.toml`,
`apps/management-portal/.env.production`,
`apps/management-portal/package.json`, plus the view files
(`LoginView.vue`, `DeploymentsView.vue`, `TenantDetailView.vue`,
`HealthView.vue`, `LicensesView.vue`, `MarketsView.vue`) for how store/API
methods are actually invoked. Test files were skipped per instructions.

---

## 1. Purpose & connection topology

`management-portal` talks to **exactly one backend**: `apps/management-api`
(Hono Worker, dev port 8789). It never calls the main product API
(`apps/api`), `apps/realtime`, or `apps/image-processor` directly.

- **Base URL resolution** (`src/services/api.ts:33-46`,
  `resolveApiBase()`): reads `import.meta.env.VITE_MANAGEMENT_API_URL`. If
  unset and `import.meta.env.PROD` is true, the app **throws at module load**
  (`"VITE_MANAGEMENT_API_URL is required for production builds"`) — there is
  no silent fallback in production. In dev, if the var is unset it falls
  back to the relative path `/api/v1`, relying on the Vite proxy.
- **Dev proxy** (`vite.config.ts:18-27`): `/api` → `process.env.VITE_MANAGEMENT_API_URL
  || "http://localhost:8789"`, `changeOrigin: true`. So in local dev, whether
  `VITE_MANAGEMENT_API_URL` is set as an env var (not just baked into the
  client bundle) also changes where the *proxy* forwards to.
- **Production config**: both `.env.production` and `wrangler.toml`
  (`[vars]` and `[env.production.vars]`) hard-code
  `VITE_MANAGEMENT_API_URL=https://manage-api.makanmasak.com/api/v1`.
- **Axios instance** (`api.ts:76-83`): `baseURL: API_BASE`, `timeout: 30000`,
  `withCredentials: true` (cookies are sent cross-origin to
  `manage-api.makanmasak.com`), default header `Content-Type: application/json`.
- No other network client exists in this app — no WebSocket, no
  `EventSource`, no raw `fetch()`, no second axios instance (verified via
  repo-wide grep).

---

## 2. Endpoint inventory

All paths below are relative to `API_BASE` (i.e. append to
`https://manage-api.makanmasak.com/api/v1` in production). "Where called"
cites the client function; the actual UI call sites are noted where they
differ meaningfully from the store/service layer.

| Method | Path | Where called (file:line) | Request the client sends | Response fields the client actually reads |
| --- | --- | --- | --- | --- |
| POST | `/auth/exchange` | `services/api.ts:136-141` (`authApi.exchange`), invoked from `views/LoginView.vue:34` | `{ token: apiToken }` | `data.data.token`, `.tokenType`, `.expiresAt` — persisted via `saveManagementSession` |
| GET | `/tenants` | `services/api.ts:149-155` (`tenantsApi.list`), called by `stores/tenants.ts:130` (`fetchTenants`) | Query params from `PaginationParams` (`page,limit,search,status,sortBy,sortOrder`) — **but `fetchTenants()` calls `tenantsApi.list()` with no params at all**, so no query string is ever actually sent by this app today | Only `response.data` (the tenant array) is read into the store; `total/page/limit/totalPages` are typed on `PaginatedResponse<T>` but **never read anywhere** in this codebase |
| GET | `/tenants/:id` | `api.ts:158-161`, `stores/tenants.ts:144` (`fetchTenant`) | — | `data.data` → whole `Tenant` object |
| POST | `/admin/onboarding/applications` | `api.ts` (`tenantsApi.create`), `stores/tenants.ts` (`createTenant`), from `components/tenants/CreateTenantModal.vue` | `OperatorOnboardingRequest` = `{businessName, contactName, contactEmail, contactPhone, address?, district?, city, countryCode, planId?, latitude, longitude, approveImmediately?}` (`POST /tenants` was removed: it wrote a bare tenant row with no platform restaurant or owner) | `data.data` → `{application, approval \| null, approvalError?}`; the store re-fetches `/tenants` when `approval` is set |
| PATCH | `/tenants/:id` | `api.ts:173-179`, `stores/tenants.ts:172` (`updateTenant`) | `UpdateTenantRequest` = `{businessName?, contactEmail?, contactPhone?, subdomain?, customDomain?, status?}` | `data.data` → `Tenant` |
| DELETE | `/tenants/:id` | `api.ts:182-184`, `stores/tenants.ts:193` (`deleteTenant`) | — | response body discarded entirely (fire-and-forget; store just removes locally) |
| GET | `/tenants/:id/resources` | `api.ts:187-192`, `stores/tenants.ts:205` (`fetchTenantResources`) | — | `data.data` → `TenantResource[]` |
| GET | `/deployments/:tenantId` | `api.ts:200-207` (`deploymentsApi.getStatus`) | — | **Dead code — this method is defined but never called anywhere in the UI.** |
| GET | `/deployments/:tenantId/history` | `api.ts:210-215`, `stores/tenants.ts:214`, also called directly by `views/DeploymentsView.vue:39` in a per-tenant loop | — | `data.data` → `DeploymentLog[]` (first element used for "most recent deployment" display) |
| POST | `/deployments/provision` | `api.ts:218-224`, `stores/tenants.ts:248` (`provisionTenant`) | `{ tenantId }` only — never sends `resourceTypes` even though the server schema accepts it | `data.data` → `TenantResource[]` |
| POST | `/deployments/deploy` | `api.ts:227-233`, `stores/tenants.ts:262` (`deployTenant`), invoked from `views/TenantDetailView.vue:148` with **no version argument** | `DeployRequest = {tenantId, version?}` → **field name mismatch, see §6** | `data.data` → `DeploymentLog` |
| POST | `/deployments/:tenantId/rollback` | `api.ts:236-245` | `{ targetVersion }` | `data.data` → `DeploymentLog` |
| POST | `/deployments/batch` | `api.ts:248-255`, invoked from `views/DeploymentsView.vue:81-84` | `BatchDeployRequest = {tenantIds, version}` → **field name mismatch, see §6** | `data.data.queued`, `.failed` |
| GET | `/health/tenants` | `api.ts:261-267` (`healthApi.getAllStatus`), `stores/health.ts:64` (`fetchAllHealthChecks`), used directly by `views/HealthView.vue:29-40` | — | Client types this as `HealthCheck[]` and assigns it directly to `healthChecks.value` with **no normalization** → **shape mismatch, see §6 (likely runtime crash)** |
| GET | `/health/tenants/:tenantId` | `api.ts:270-275`, `stores/tenants.ts:225` (`fetchTenantHealthChecks`) | — | Passed through `normalizeTenantHealthChecks()` (`stores/tenants.ts:47-63`), which handles **both** a raw array and the real `{recentChecks: [...]}` envelope — this one *is* defensively coded |
| POST | `/health/check/:tenantId` | `api.ts:278-283` (`healthApi.check`), `stores/health.ts:76` (`checkTenantHealth`) | — | Client types return as `HealthCheck` (expects field `id`); server actually returns `checkId` — see §6 |
| POST | `/licenses/generate` | `api.ts:291-297`, `views/LicensesView.vue:78` | `GenerateLicenseRequest = {tenantId, tier, expiresAt?}` — **`expiresAt` is bound in the UI form but silently ignored server-side, see §6** | `data.data` → `License` |
| GET | `/licenses/:tenantId` | `api.ts:300-305`, `stores/tenants.ts:237` (`fetchTenantLicenses`) | — | Passed through `normalizeTenantLicenses()` (`stores/tenants.ts:65-85`), which handles the real singular-object shape (not an array) defensively |
| POST | `/licenses/:tenantId/renew` | `api.ts:308-314` | `{ expiresAt }` — **field name mismatch, see §6** (server reads `validityMonths`) | `data.data` → `License` |
| POST | `/licenses/:tenantId/upgrade` | `api.ts:317-323` | `{ tier }` | `data.data` → `License` |
| GET | `/markets` | `api.ts:326-348` (`marketsApi.list`), `views/MarketsView.vue:212-217` | Query `{city?, district?, type?, page?, limit?}` | `data.data.markets` (array; **server always returns `[]` — stub**, see §6) |
| POST | `/admin/markets` | `api.ts:350-356` (`marketsApi.create`) | `CreateMarketRequest` | `data.data.market` — **this route does not exist server-side, see §6** |
| PUT | `/admin/markets/:id` | `api.ts:358-364` (`marketsApi.update`) | `UpdateMarketRequest` (Partial of create) | `data.data.market` — **route does not exist server-side, see §6** |
| DELETE | `/admin/markets/:id` | `api.ts:366-368` (`marketsApi.delete`) | — | discarded — **route does not exist server-side** |
| POST | `/admin/markets/:marketId/vendors` | `api.ts:370-383` (`marketsApi.addVendor`) | `{restaurantId, stallNumber?, locationLabel?, isPrimary?}` | `data.data.membership` — **route does not exist server-side** |
| DELETE | `/admin/markets/:marketId/vendors/:restaurantId` | `api.ts:385-389` (`marketsApi.removeVendor`) | — | discarded — **route does not exist server-side** |
| POST | `/admin/markets/:marketId/vendor-imports` | `api.ts:391-402` (`marketsApi.importVendors`) | `{dryRun?, vendors: [...]}` | `data.data` → `MarketVendorImportResult` — **route does not exist server-side** |
| GET | `/admin/markets/vendor-candidates` | `api.ts:404-413` | Query `{q?, marketId?, limit?}` | `data.data.restaurants`, `.total` (server stub always returns `[]`/`0`) |
| GET | `/admin/markets/join-requests` | `api.ts:415-422` | Query `{status?}` | `data.data.requests` (server stub always returns `[]`) |
| POST | `/admin/markets/join-requests/:requestId/approve` | `api.ts:424-442` | `{stallNumber?, locationLabel?, isPrimary?}` | `data.data.{request, membership}` — **route does not exist server-side** |
| POST | `/admin/markets/join-requests/:requestId/reject` | `api.ts:444-449` | — | `data.data.request` — **route does not exist server-side** |

### Server routes never called by this client

Cross-checked against `docs/Backend-Rust-refactor/management-api.md` §3:
`routes/onboarding.ts` (public), `routes/admin-onboarding.ts`,
`routes/internal.ts`, `routes/monitoring.ts` (all 5 endpoints),
`routes/updates.ts` (all 7 endpoints), and
`GET /deployments/:tenantId/migrations` are all real, implemented endpoints
that `management-portal` never invokes (repo-wide grep for
`onboarding|monitoring|/updates` in `src/` returns nothing). These are
presumably consumed by other clients (e.g. `apps/onboarding-app`, internal
service bindings) or are unused. Do not assume they're dead just because
this frontend skips them — verify against those other consumers before
deprioritizing in the Rust port.

---

## 3. Auth & session

- **Token acquisition**: `LoginView.vue` collects a raw main-platform admin
  API token (pasted JWT, textarea) and POSTs it to `/auth/exchange`
  (`authApi.exchange`). The server verifies it's a valid admin-role JWT
  signed with the *main platform's* `JWT_SECRET` and returns a new,
  management-scoped JWT (`aud: "management"`, `iss: "makanmakan-management"`,
  1-hour TTL) — see `management-api.md` §"routes/auth.ts".
- **Storage**: `services/auth.ts` persists the token and `expiresAt` in
  `sessionStorage` under keys `management_token` /
  `management_token_expires_at` (`MANAGEMENT_TOKEN_KEY`,
  `MANAGEMENT_TOKEN_EXPIRES_AT_KEY`). **Not** `localStorage` — session is
  lost on tab close.
- **Expiry format**: `expiresAt` is compared as **Unix seconds**
  (`Math.floor(Date.now() / 1000)`, `services/auth.ts:46`), matching the
  server's `expiresAt = now + 3600` (also seconds,
  `apps/management-api/src/routes/auth.ts:79-80`). This is a deliberate
  divergence from the repo-wide `timestamp_ms` convention documented in
  CLAUDE.md — **do not "fix" this to milliseconds in the Rust port** without
  updating both sides together.
- **No refresh flow**: there is no silent-refresh or refresh-token logic.
  Once the 1-hour token expires, `getManagementToken()` (`auth.ts:34-53`)
  detects it, calls `clearManagementSession()`, and returns `null` — the
  next navigation/API call redirects to `/login`.
- **Header injection**: the axios request interceptor (`api.ts:86-103`)
  adds `Authorization: Bearer <token>` to every request when a token is
  present, read fresh from `sessionStorage` on each call (not cached in a
  closure).
- **CSRF header**: for mutating methods (`post/put/patch/delete`,
  `MUTATING_METHODS` set at `api.ts:50`), the client reads a `csrf_token`
  cookie (`readCookie`, `api.ts:58-69`) and, if present, sends it as
  `X-CSRF-Token`. **This is dead functionality against the current
  management-api**: a repo-wide grep of `apps/management-api/src` for
  `csrf`/`CSRF` finds zero matches — the backend never sets a `csrf_token`
  cookie and no middleware ever checks `X-CSRF-Token`. This logic appears to
  be copied from another app's axios client (e.g. `admin-dashboard`, which
  does talk to a CSRF-aware backend) and is currently a no-op here. Flag but
  don't silently drop — confirm with the team whether management-api is
  *supposed* to gain CSRF protection before removing the client-side logic.
- **Route guard**: `router/index.ts:79-104` runs on every navigation;
  `isManagementAuthenticated()` (a simple `sessionStorage` presence +
  expiry check, no API call) gates all routes except `/login`
  (`meta: { public: true }`). This is purely client-side — it does not
  protect against a stale/revoked-but-not-yet-expired token; that's caught
  only when an actual API call 401s (see §5).

---

## 4. Realtime/polling

None. No WebSocket, no SSE (`EventSource`), no `setInterval`/`setTimeout`
polling loop anywhere in `src/` (verified by grep). `HealthView.vue` has a
manual "Refresh" button (`handleRefresh`, calls `fetchAllHealthChecks()`
again) but no auto-refresh timer. All data fetching is on-demand
(`onMounted` + explicit user actions).

---

## 5. Error handling contract

- **Envelope shape parsed**: the response interceptor
  (`api.ts:106-133`) reads `error.response?.data?.error`, and handles
  **two** shapes:
  1. Nested unified format `{ error: { code, message, details? } }`
     (current/real server shape per `management-api.md` §3).
  2. Legacy flat `{ error: "<string>" }` — kept as a fallback per an
     explicit `TODO(cleanup)` comment (`api.ts:110-113`) referencing "commit
     7151ca2c"; safe to drop this branch once confirmed no deployed
     management-api predates that commit.
  - Falls back further to `error.message` (axios/network-level message),
    then a hardcoded `"請求失敗"` ("Request failed").
  - The resolved message is always shown via a global toast
    (`vue-toastification`) — there is no per-call custom error UI beyond
    that.
- **Status codes branched on**: only `401`. On a 401 response (and only if
  `window.location.pathname !== "/login"`, to avoid a redirect loop), the
  client calls `clearManagementSession()` and hard-navigates
  (`window.location.assign`) to `/login?redirect=<current path+query>`.
  No other status code (403/404/409/422/500) gets special client-side
  handling beyond the toast — callers just see a rejected promise and
  usually show a second, hardcoded, view-local error string (e.g.
  `t("tenantDetail.toast.loadFailed")`) in addition to the interceptor's
  toast.
- **Non-standard envelope not consumed here**: `management-api.md` notes
  `/licenses/verify` intentionally returns `{valid, tier?, features?,
  expiresAt?, error?}` instead of the unified envelope — but this portal
  **never calls `/licenses/verify`**, so that quirk is irrelevant to this
  client (it's consumed by `apps/api`'s `LicenseService`, which per the doc
  is itself dead code).

---

## 6. Rust rewrite compatibility notes

These are concrete, code-verified mismatches and sensitivities. Ordered
roughly by severity/likelihood of causing a live break if the Rust rewrite
"cleans up" field names to match server-side conventions instead of
preserving the exact wire contract this client expects.

1. **`POST /deployments/deploy` — field name mismatch, likely a live bug
   today.** Client sends `{tenantId, version}` (`DeployRequest`,
   `types/index.ts:190-193`; `TenantDetailView.vue:148` calls
   `deployTenant(tenantId)` with `version` left `undefined`). Server's
   `deployRequestSchema` (`apps/management-api/src/routes/deployments.ts:21-26`)
   requires a **`targetVersion`** field, `.regex(/^\d+\.\d+\.\d+$/)`,
   non-optional. Since the client never sends `targetVersion` at all, every
   "Deploy" click from `TenantDetailView.vue` should currently fail Zod
   validation (400 `VALIDATION_ERROR`) against the real server. **A Rust
   port must decide**: either the client needs a fix (send `targetVersion`)
   or the Rust server should accept `version` as an alias — do not assume
   this path currently works in production.
2. **`POST /deployments/batch` — same field-name mismatch.** Client sends
   `{tenantIds, version}` (`BatchDeployRequest`; `DeploymentsView.vue:81-84`
   binds `version: targetVersion.value`). Server destructures
   `{tenantIds, targetVersion}` from the body
   (`deployments.ts:236-266`) and 400s with `"targetVersion must be semver
   format"` if missing. Same conclusion as above — verify this is actually
   broken in production before treating server behavior as ground truth to
   replicate as-is.
3. **`GET /health/tenants` — response shape mismatch, likely causes a
   runtime crash on the Health page.** Client types this as `HealthCheck[]`
   and assigns the raw response straight into a `ref<HealthCheck[]>`
   (`stores/health.ts:64`, no normalization, unlike the sibling
   `/health/tenants/:tenantId` call which *is* normalized). The real server
   response (`apps/management-api/src/routes/health.ts:25-99`) is
   `{tenants: [...], summary: {...}}` — an **object, not an array** — with
   each tenant entry shaped as `{tenantId, tenantName, subdomain,
   deployedVersion, health: {status, responseTimeMs, lastCheck}}`, not the
   flat `HealthCheck` shape (`id, tenantId, status, responseTimeMs, details,
   checkedAt`) the client type declares. If `healthChecks.value` ends up as
   a plain object, every computed property in `stores/health.ts` that calls
   `.filter()`/`.forEach()` on it (`healthyCount`, `degradedCount`,
   `downCount`, `groupedByStatus`, all lines 18-58) will throw a
   `TypeError` at runtime. Confirm whether `HealthView.vue` currently works
   at all against a real management-api before deciding how to shape this
   in Rust — this looks like a pre-existing, unfixed break, not something
   to "faithfully reproduce."
4. **`POST /health/check/:tenantId` — `id` vs `checkId`.** Server returns
   `{checkId, tenantId, status, responseTimeMs, checkedAt, details}`
   (`health.ts` `/check/:tenantId` handler); client's `HealthCheck` type
   expects `id`. `checkTenantHealth` (`stores/health.ts:74-91`) pushes/splices
   this object into `healthChecks.value` — any downstream `:key="check.id"`
   or logic keyed on `.id` will see `undefined` for freshly-checked entries.
5. **`POST /licenses/:tenantId/renew` — field name mismatch, silent (not a
   validation error).** Client sends `{expiresAt}` (`licensesApi.renew`,
   `api.ts:308-314`); server reads `body.validityMonths || 12`
   (`licenses.ts` renew handler) and silently ignores any unrecognized
   field. **No error is raised** — the renewal always applies exactly 12
   months regardless of what date the admin picked in the UI. This is a
   silent functional bug, not a hard failure — worth flagging to product
   owners, not just engineering, since a Rust rewrite that "fixes" the
   server to actually honor a client field would change behavior.
6. **`POST /licenses/generate` — `expiresAt` form field is silently
   discarded.** `LicensesView.vue:309` binds an `expiresAt` date input into
   `generateForm`, which is submitted as part of `GenerateLicenseRequest`.
   Server's `generateLicenseSchema` (`licenses.ts:56-60`) only recognizes
   `{tenantId, tier, validityMonths}` (`validityMonths` optional,
   `.default(12)`) and computes `expiresAt` itself via
   `calculateExpirationDate(validityMonths)` — the client's `expiresAt`
   value is never read. Same class of bug as #5: UI implies date control,
   backend only understands month-count.
7. **Markets admin CRUD — client calls routes that do not exist
   server-side at all.** `MarketsView.vue` actively invokes (create/edit
   flow at lines 252-267, vendor management at 277-300, imports at
   308-334, join-request approve/reject at 387/403)
   `POST /admin/markets`, `PUT /admin/markets/:id`,
   `DELETE /admin/markets/:id`, `POST /admin/markets/:marketId/vendors`,
   `DELETE /admin/markets/:marketId/vendors/:restaurantId`,
   `POST /admin/markets/:marketId/vendor-imports`,
   `POST /admin/markets/join-requests/:requestId/approve`,
   `POST /admin/markets/join-requests/:requestId/reject`. The entire real
   `routes/markets.ts` (`apps/management-api/src/routes/markets.ts`, 46
   lines total) only implements three `GET` stubs: `/markets`,
   `/admin/markets/join-requests`, `/admin/markets/vendor-candidates` — all
   three hard-coded to return empty data and documented as such in
   `management-api.md` §"routes/markets.ts" ("None of these query any
   table... unimplemented placeholders"). Every "create market", "delete
   market", "add/remove vendor", "import vendors", "approve/reject join
   request" action in this admin UI currently 404s against the real
   management-api (falls through `PROTECTED_PREFIXES` to the global 404
   handler, since these sub-paths aren't registered). **This is the single
   biggest gap between this frontend and its backend** — the Rust port
   needs an explicit decision: either build out this real markets admin API
   surface (using this document's request/response shapes as the client's
   expected contract) or the frontend's Markets page needs to be reworked/
   removed. Do not port `routes/markets.ts` as three empty stubs and call
   the contract satisfied — this client expects a full CRUD surface that
   has never existed.
8. **`GET /tenants` pagination envelope mismatch (currently benign).**
   Client's `PaginatedResponse<T>` type expects flat
   `{data, total, page, limit, totalPages}`; the real server nests these as
   `{success, data, pagination: {page, limit, total, totalPages}}`
   (`tenants.ts:60-93`). Harmless today only because
   `stores/tenants.ts:126-138` never reads anything but `.data` — but any
   future pagination UI added to `TenantsView.vue` reading `.total`/
   `.totalPages` directly off this response would get `undefined`. Fix the
   type (and add a `.pagination` accessor) before building pagination UI on
   top of this call.
9. **`GET /deployments/:tenantId` return shape mismatch (currently dead
   code, so benign).** Client types the response as
   `{status: string; currentVersion?: string}`
   (`deploymentsApi.getStatus`, `api.ts:200-207`); server's
   `ProvisioningService.getDeploymentStatus` actually returns
   `{currentVersion?, lastDeployment?, resources}` — there is no top-level
   `status` field at all. Irrelevant today because no view calls
   `getStatus()`, but do not use the client's TS type as ground truth if
   this method is ever wired up.
10. **CSRF header is inert against this backend today** (see §3) — if the
    Rust rewrite adds real CSRF protection, it can rely on this client
    already sending `X-CSRF-Token` when a `csrf_token` cookie is present; if
    it doesn't, this code path is simply unused and safe to leave as-is or
    strip.
11. **`expiresAt` in the auth-exchange response is Unix seconds, not
    milliseconds** (see §3) — the one place in this frontend's contract
    that deliberately breaks the repo's `timestamp_ms` convention. All
    other date-ish fields on the wire (`createdAt`, `checkedAt`,
    `startedAt`, `expiresAt` on `License`/`Tenant`, etc.) are consumed by
    the client as opaque ISO-8601-ish strings passed straight into
    `new Date(...)` — the client does no format validation, so the Rust
    server has latitude on exact string format as long as it's
    `Date`-parseable, **except** the auth-exchange `expiresAt`, which must
    stay a raw Unix-seconds integer.
12. **`VITE_MANAGEMENT_API_URL` must be present at build time in
    production** (`resolveApiBase()`, `api.ts:33-46`) — there is no
    runtime-configurable base URL/discovery mechanism; changing the
    management-api's public hostname requires a portal rebuild+redeploy,
    not just a config change.
