# `apps/management-api` — Rust Rewrite Reference

This document is a source-accurate reference for rewriting
`apps/management-api` in Rust. It is scoped to this one Worker; see
`docs/specs/2026-07-04-rust-backend-refactor.md` for the overall migration
plan and cross-service topology.

All file paths are repo-relative from `/Users/eric/Documents/Code/Makan-makan`.

## 1. Purpose & responsibilities

`apps/management-api` is the **central multi-tenant management / control-plane
API** for MakanMakan's hybrid deployment model. It is a separate Cloudflare
Worker (Hono, port 8789) from the main `apps/api` product backend. Its
responsibilities, as implemented in code, are:

- **Tenant lifecycle management** — CRUD for `tenants` (the platform's record
  of each managed/independent deployment), subdomain allocation, license tier
  tracking (`apps/management-api/src/services/TenantService.ts`).
- **Self-service onboarding** — public application intake
  (`routes/onboarding.ts`) and admin approve/reject workflow
  (`routes/admin-onboarding.ts`) that provisions a tenant plus an owner account
  in the main platform database (`services/OnboardingService.ts`).
- **Internal provisioning bridge** — an internal-token-protected API
  (`routes/internal.ts`) that the main `apps/api` worker calls (via a
  Cloudflare service binding) when a restaurant is created on the platform, so
  a matching management tenant + subscription row exists.
- **License generation/verification** — issuing and validating license keys
  for "independent" (non-SaaS) deployments of the product (`routes/licenses.ts`).
  The `/licenses/verify` endpoint is consumed by `apps/api`'s
  `LicenseService` (`apps/api/src/services/LicenseService.ts`) and
  intentionally keeps a non-standard response shape (see §3).
- **Resource provisioning & deployment orchestration** — provisioning D1/KV/R2
  resources and deploying Worker bundles into a *platform-owned* Cloudflare
  account on behalf of tenants (`services/ProvisioningService.ts`,
  `services/CloudflareApiClient.ts`, `services/BundleService.ts`,
  `services/MigrationService.ts`). This is for the "managed hosting" path of
  the hybrid model, distinct from tenants who self-host independently.
- **Health monitoring** — recording and querying tenant health-check results
  (`routes/health.ts`).
- **Fleet monitoring/analytics** — aggregate stats, alert listing, and version
  distribution across tenants (`routes/monitoring.ts`).
- **Batch version rollout** — planning and executing staged (`all_at_once` /
  `rolling` / `canary`) version updates across tenants
  (`routes/updates.ts`, `services/VersionSyncService.ts`).
- **Auth token exchange** — exchanging a main-platform admin JWT for a
  management-API-scoped JWT (`routes/auth.ts`).
- **Markets stubs** — `routes/markets.ts` currently returns hard-coded empty
  data; not yet implemented against real tables.
- **Alerting (currently dead code)** — `services/AlertService.ts` implements
  Slack alert dispatch for health/deployment failures, but it is not imported
  or invoked by any route or other service in the current codebase. Treat it
  as unused/incomplete when porting — do not assume it runs in production.

## 2. Runtime & bindings

Source: `apps/management-api/wrangler.toml`, `apps/management-api/package.json`.

- **Name**: `makanmasak-management-api` (prod: `makanmasak-management-api-prod`).
- **Entry**: `src/index.ts`, `compatibility_date = "2024-09-23"`,
  `compatibility_flags = ["nodejs_compat"]`.
- **Dev**: port 8789, `wrangler dev --persist-to ../../.wrangler/shared-state --inspector-port 9230`.
  `inspector_port` is intentionally *not* set in `[dev]` in the toml (Windows
  workerd crash workaround per CLAUDE.md); the port is instead passed via CLI flag.

### D1 databases

| Binding | Dev DB | Prod DB (id) | Migrations dir |
| --- | --- | --- | --- |
| `MANAGEMENT_DB` | `makanmakan-management-local` | `makanmasak-management-prod` (`0a1f532c-37b5-4b77-8e9f-403cfda307c4`) | `migrations` (this app's own track, 12 files) |
| `PLATFORM_DB` | `makanmakan-local` | `makanmasak-prod` (`4e3c7ba8-5aa7-4652-bfea-a9c565b3a141`) | `../../packages/database/migrations_fresh` |

`PLATFORM_DB` is the **same physical database** as the main `apps/api` worker's
`DB` binding (same `database_id` in both dev and prod) — this worker reads and
writes into the shared platform schema (`restaurants`, `users`,
`password_reset_tokens`) directly via Drizzle, in addition to its own
`MANAGEMENT_DB`. A Rust port must preserve this two-database boundary exactly.

### KV namespaces

| Binding | Purpose (as used in code) |
| --- | --- |
| `CACHE_KV` | Batch-update plan/progress storage (`VersionSyncService`), keys `update_plan:{id}` / `update_progress:{id}` |
| `DEPLOYMENT_STATUS_KV` | Quick-access health status cache, key `health:{tenantId}`, 1h TTL (`routes/health.ts`) |

### R2

| Binding | Purpose |
| --- | --- |
| `BUNDLE_STORAGE` | Worker script + migration bundles per version, keyed `bundles/{version}/worker.js` / `migrations.json` / `manifest.json` (`services/BundleService.ts`) |

### Cron triggers

None found in `wrangler.toml`. This worker has no `[triggers]` block — batch
update execution (`routes/updates.ts`) is triggered synchronously by an HTTP
call, not a cron.

### Routes (custom domain)

Production only:

```toml
[[env.production.routes]]
pattern = "manage-api.makanmasak.com"
custom_domain = true
```

Wrangler provisions DNS/SSL automatically since the zone is already on the
account. `[env.production.placement] mode = "smart"`.

### Environment variables (`[vars]`, names only)

`NODE_ENV`, `API_VERSION`, `API_BASE_URL`, `CORS_ORIGIN`, `LOG_LEVEL`.

Dev values worth noting for parity tests: `CORS_ORIGIN` is a comma-separated
allow-list (`http://localhost:5177,http://localhost:8789` in dev); prod is
`https://admin.makanmasak.com,https://management.makanmasak.com,https://onboarding.makanmasak.com`.

### Secrets (names only — never values), per `wrangler.toml` comment block and `src/types/index.ts`

- `JWT_SECRET` — main-platform JWT signing secret, used to verify tokens
  presented to `/auth/exchange`.
- `MANAGEMENT_JWT_SECRET` (optional) — if set, used instead of `JWT_SECRET`
  for signing/verifying management-scoped tokens (`managementJwtSecret()` in
  `middleware/auth.ts` falls back to `JWT_SECRET` if unset).
- ~~`ENCRYPTION_KEY`~~ — **removed 2026-09-05.** It was declared required in
  `ManagementEnv` but no code in this app's `src` ever read it; the only
  references were six test fixtures inventing `"a".repeat(32)` to satisfy the
  type. The declaration, the `wrangler.toml` comment, the `.dev.vars.example`
  entry and those fixtures are all gone. A Rust port should not carry it. (The
  platform API — `apps/api` — is a different story: it genuinely reads
  `ENCRYPTION_KEY` and requires it in production, see #300.)
- `CF_API_TOKEN` / `CF_ACCOUNT_ID` — legacy fallback names for platform
  Cloudflare credentials.
- `PLATFORM_CF_API_TOKEN` / `PLATFORM_CF_ACCOUNT_ID` (optional, preferred) —
  platform Cloudflare API token/account used by `ProvisioningService` to
  create D1/KV/R2 resources and deploy Worker bundles into the platform's own
  Cloudflare account (`getPlatformCloudflareCredentials()` prefers these,
  falls back to `CF_API_TOKEN`/`CF_ACCOUNT_ID`).
- `SLACK_WEBHOOK_URL` (optional) — used only by the currently-unreferenced
  `AlertService`.
- `ONBOARDING_EMAIL_ENABLED` (optional, string `"true"`/other) — gates whether
  onboarding approval sends an email via MailChannels.
- `ONBOARDING_EMAIL_FROM` (optional) — required if the above is `"true"`.
- `INTERNAL_API_TOKEN` (optional but required in practice) — shared secret
  checked by `routes/internal.ts` against header `X-Internal-API-Token`.

## 3. HTTP surface

Mount points from `apps/management-api/src/index.ts`:

- `app.route("/api/v1", publicApi)` — `publicApi` mounts `/auth` and
  `/onboarding` with no auth middleware.
- `app.route("/api/v1/internal", internalRouter)` — mounted directly on `app`,
  separate from `publicApi`/`protectedApi`; auth is its own internal-token
  check, not `managementAuthMiddleware`.
- `app.route("/api/v1", protectedApi)` — `protectedApi` mounts `/health`,
  `/tenants`, `/deployments`, `/licenses`, `/monitoring`, `/updates`,
  `/markets`, `/admin/markets`, `/admin/onboarding`. `managementAuthMiddleware`
  is registered per-prefix (both `"/prefix"` and `"/prefix/*"`) for exactly
  the list in `PROTECTED_PREFIXES` (index.ts:205-218), specifically so
  unmatched `/api/v1/*` paths outside these prefixes fall through to the
  global 404 handler instead of a 401.

Root-level (outside `/api/v1`, no auth): `GET /health` (liveness JSON, not the
same thing as `/api/v1/health/*`), `GET /info` (service metadata), `GET /`
(redirects to `/info`).

All JSON responses follow `{ success: true, data }` or
`{ success: false, error: { code, message, details? } }` via the global
`app.onError` handler (index.ts:94-126), **except** `/api/v1/licenses/verify`,
which intentionally returns its own `{ valid, tier?, features?, expiresAt?, error? }`
shape because it's consumed by `apps/api`'s `LicenseService`, not the admin
portal (explicit code comment in `routes/licenses.ts:158-162`).

### `routes/auth.ts` — mounted at `/api/v1/auth` (public)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/exchange` | Bearer JWT in body (`token`), signed with `JWT_SECRET`, must carry an admin claim (`role === "admin"` or `role === 0`) | Exchange a main-platform admin API token for a management-scoped JWT | `{ token: string }` | `{ success, data: { token, tokenType: "Bearer", expiresAt } }` |

Subject resolution (`getManagementSubject`, `auth.ts:31-65`): `id` comes from
payload `id` (string/number coerced to string) or, if absent, a UUID v7
`sub` claim; `email` comes from payload `email` or `username`. Issued token
TTL is fixed at `MANAGEMENT_TOKEN_TTL_SECONDS = 3600` (1 hour), with claims
`{ id, email, role: "admin", aud: "management", iss: "makanmakan-management", iat, exp }`.

### `routes/onboarding.ts` — mounted at `/api/v1/onboarding` (public)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/onboarding/applications` | none | Create a self-service onboarding application | `{ businessName, contactName, contactEmail, contactPhone, planId?, latitude, longitude }` (zod-validated) | 201 `{ success, data: { applicationId, applicationSecret, assignedSubdomain, status } }` |
| GET | `/api/v1/onboarding/applications/:id` | Header `X-Onboarding-Secret` must match the application's stored secret hash | Fetch application status (sanitized fields only) | — | `{ success, data: { id, businessName, contactName, contactEmail, latitude, longitude, planId, assignedSubdomain, status, tenantId, createdAt, completedAt } }` |

### `routes/admin-onboarding.ts` — mounted at `/api/v1/admin/onboarding` (protected: `managementAuthMiddleware`)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/onboarding/applications` | Bearer management JWT | List applications | Query: `status?`, `page?`, `limit?` (max 100) | `{ success, data: { applications[], total, page, limit } }` — full (non-redacted) application fields via `publicApplication()` mapper |
| POST | `/api/v1/admin/onboarding/applications/:id/approve` | Bearer management JWT | Approve application → provisions tenant + owner account + credential delivery | — | `{ success, data: { tenantId, subdomain, ownerAccount, credentialDelivery, status } }`; idempotent if already `completed` |
| POST | `/api/v1/admin/onboarding/applications/:id/reject` | Bearer management JWT | Reject application (blocked if `completed`/`provisioning`) | — | `{ success, data: { status: "rejected" } }` |

### `routes/internal.ts` — mounted at `/api/v1/internal` (internal-token auth, NOT `managementAuthMiddleware`)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/internal/platform-restaurants/:restaurantId/tenant` | Header `X-Internal-API-Token` == `INTERNAL_API_TOKEN` (constant-time compare) | Called by `apps/api` when a platform restaurant is created; provisions/idempotently returns a management tenant + shop subscription | `{ businessName, contactEmail, contactPhone?, planId?, subdomain? }` | 201 `{ success, data: { tenant } }` |
| PATCH | `/api/v1/internal/platform-restaurants/:restaurantId/owner` | same | Links a platform owner user to the tenant record | `{ ownerUserId, ownerUsername }` | `{ success, data: { tenant } }`; 409 `OWNER_LINK_CONFLICT` if already linked to a different owner |

### `routes/tenants.ts` — mounted at `/api/v1/tenants` (protected)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/tenants` | Bearer management JWT | List tenants, paginated/filtered | Query: `page`, `limit` (≤100), `status?`, `search?` (LIKE on name/email/subdomain) | `{ success, data: Tenant[], pagination }` |
| GET | `/api/v1/tenants/:id` | same | Get one tenant | — | `{ success, data: Tenant }` or 404 |
| POST | `/api/v1/tenants` | same | Create tenant | `{ businessName, contactEmail, contactPhone?, subdomain?, customDomain?, licenseTier }` (zod) | 201 `{ success, data: Tenant }`; 409 `SUBDOMAIN_TAKEN` if provided subdomain in use |
| PATCH | `/api/v1/tenants/:id` | same | Update tenant fields | `{ businessName?, contactEmail?, contactPhone?, customDomain?, licenseTier?, status? }` (zod) | `{ success, data: Tenant }` or 404 |
| DELETE | `/api/v1/tenants/:id` | same | Soft-delete (sets `status = 'terminated'`) | — | `{ success, data: { deleted: true } }` or 404 |
| GET | `/api/v1/tenants/:id/resources` | same | List provisioned Cloudflare resources for a tenant | — | `{ success, data: TenantResource[] }` |

### `routes/deployments.ts` — mounted at `/api/v1/deployments` (protected)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/deployments/:tenantId` | Bearer | Current deployment status | — | `{ success, data: { currentVersion?, lastDeployment?, resources[] } }` |
| GET | `/api/v1/deployments/:tenantId/history` | Bearer | Deployment log history | Query `limit` (≤100) | `{ success, data: DeploymentLog[] }` |
| POST | `/api/v1/deployments/provision` | Bearer | Provision Cloudflare resources (D1/KV/R2) for a tenant | `{ tenantId, resourceTypes? }` (zod) | `{ success, data: { tenantId, resources, status: "provisioned" } }`; 500 with `failedResources` details on partial/total failure |
| POST | `/api/v1/deployments/deploy` | Bearer | Deploy a bundle version to a tenant's platform-managed Worker | `{ tenantId, targetVersion (semver), deploymentType? }` (zod) | `{ success, data: { deploymentId, tenantId, version, status: "completed" } }` |
| POST | `/api/v1/deployments/:tenantId/rollback` | Bearer | Roll back to last successful `from_version` or an explicit `targetVersion` | `{ targetVersion? }` (body optional, parsed leniently) | `{ success, data: { tenantId, rolledBackTo, status: "rolled_back" } }` |
| POST | `/api/v1/deployments/batch` | Bearer | Deploy one version to many tenants sequentially | `{ tenantIds: string[], targetVersion }` | `{ success, data: { targetVersion, results[], summary } }` |
| GET | `/api/v1/deployments/:tenantId/migrations` | Bearer | List applied D1 migrations for a tenant | — | `{ success, data: { tenantId, migrations, total, lastApplied } }` — ⚠️ `lastApplied` is the `applied_at` of the **alphabetically-last** migration name (`MigrationService.getAppliedMigrations` orders by `migration_name ASC`), not the most recently applied one |

### `routes/licenses.ts` — mounted at `/api/v1/licenses` (protected, except see note on `/verify`)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/licenses/generate` | Bearer (protected prefix) | Generate + persist a new license, update tenant record | `{ tenantId, tier, validityMonths (1-36, default 12) }` (zod) | `{ success, data: { licenseId, licenseKey, tier, features, expiresAt } }` |
| POST | `/api/v1/licenses/verify` | **Note:** mounted under the protected `/licenses` prefix, so `managementAuthMiddleware` still runs; called cross-service by independent deployments' `LicenseService` which does not send a management Bearer token today — see "Cross-service interactions" for the discrepancy this creates | `{ tenantId, licenseKey, version, timestamp }` (zod) | **Non-standard envelope**: `{ valid, tier?, features?, expiresAt?, error? }` (200 even on invalid; 400/500 only on parse/internal error) |
| GET | `/api/v1/licenses/:tenantId` | Bearer | Get license info + expiry status | — | `{ success, data: { tenantId, licenseKey, tier, features, expiresAt, status, isExpired } }` |
| POST | `/api/v1/licenses/:tenantId/renew` | Bearer | Extend expiry from max(current expiry, now) | `{ validityMonths? }` (default 12) | `{ success, data: { tenantId, tier, newExpiresAt, addedMonths } }` |
| POST | `/api/v1/licenses/:tenantId/upgrade` | Bearer | Change tier + reissue license key | `{ tier }` | `{ success, data: { tenantId, previousTier, newTier, newLicenseKey, features } }` |

> **Rust-port flag:** `/licenses/verify` is mounted under `/api/v1/licenses`,
> which is in `PROTECTED_PREFIXES`, so `managementAuthMiddleware` runs before
> the handler in the current TypeScript app. But `apps/api`'s `LicenseService`
> (`apps/api/src/services/LicenseService.ts`) calls it with only
> `Content-Type`, `X-Tenant-Id`, `X-Platform-Version` headers — no
> `Authorization: Bearer`. However, `apps/api/src/services/LicenseService.ts`
> is itself **dead code** — a repo-wide search finds no route or feature in
> `apps/api` that imports it (see api-core.md). So this mismatch is **latent**,
> not live: nothing currently calls `/licenses/verify` in production. Decide
> during the Rust port whether license verification is a feature to revive
> (and then fix the missing Bearer token / or move `/verify` out of the
> protected prefix) or to drop entirely.

### `routes/health.ts` — mounted at `/api/v1/health` (protected)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/health/tenants` | Bearer | Health summary across all active tenants (latest check per tenant via window function) | — | `{ success, data: { tenants[], summary } }` |
| GET | `/api/v1/health/tenants/:tenantId` | Bearer | Detailed health for one tenant: last 24 checks, uptime %, avg response time, issues | — | `{ success, data: { tenant, health, recentChecks[] } }` or 404 |
| POST | `/api/v1/health/report` | Bearer | Record a health check result (called by an external monitoring system) | `{ tenantId, status, responseTimeMs?, details? }` | `{ success, data: { checkId, tenantId, status, checkedAt } }`; also writes `DEPLOYMENT_STATUS_KV` |
| POST | `/api/v1/health/check/:tenantId` | Bearer | Actively probe `https://api.{domain}/health` for a tenant and record the result | — | `{ success, data: { checkId, tenantId, status, responseTimeMs, checkedAt, details } }` |

### `routes/monitoring.ts` — mounted at `/api/v1/monitoring` (protected)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/monitoring/overview` | Bearer | Aggregate tenant/health/deployment/version stats | — | `{ success, data: { tenants, health, deployments, versions, generatedAt } }` |
| GET | `/api/v1/monitoring/health/timeline` | Bearer | Hourly health-check counts/avg response time | Query `hours?` (default 24), `tenantId?` | `{ success, data: { timeline[], hours } }` |
| GET | `/api/v1/monitoring/performance` | Bearer | Per-tenant response-time/health-rate stats over last 24h | — | `{ success, data: { overall, tenants[] } }` |
| GET | `/api/v1/monitoring/alerts` | Bearer | Alerts synthesized from `health_checks` rows (not a dedicated alerts table) | Query `status?` (`active`/`resolved`/`all`), `severity?`, `limit?` | `{ success, data: { alerts[], total } }` |
| GET | `/api/v1/monitoring/versions` | Bearer | Version distribution, recent updates, pending-update tenants | — | `{ success, data: { latestVersion, distribution[], recentUpdates[], pendingUpdates[] } }` |

> **Bug to note, not silently fix:** the `/alerts` query joins
> `health_checks h JOIN tenants t ON h.id = t.id` (monitoring.ts:316) — this
> joins on `health_checks.id = tenants.id`, which is almost certainly meant to
> be `h.tenant_id = t.id`. Confirm against real data before deciding whether
> to reproduce or correct this in the Rust port.

### `routes/updates.ts` — mounted at `/api/v1/updates` (protected)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/updates/releases` | Bearer | List available releases (hard-coded, see §5 `VersionSyncService`) | — | `{ success, data: { releases[], latest } }` |
| GET | `/api/v1/updates/pending` | Bearer | Tenants below a target version | Query `targetVersion?` (defaults to latest release) | `{ success, data: { targetVersion, tenants[], count } }` |
| POST | `/api/v1/updates/plans` | Bearer | Create a batch update plan (stored in `CACHE_KV`, 7-day TTL) | `{ targetVersion, tenantIds[], strategy?, batchSize?, canaryPercentage? }` (zod) | `{ success, data: BatchUpdatePlan }` |
| POST | `/api/v1/updates/plans/:planId/execute` | Bearer | Execute a plan synchronously (blocks until strategy completes) | — | `{ success, data: BatchUpdateProgress }` |
| GET | `/api/v1/updates/plans/:planId/progress` | Bearer | Read last-known progress (only exists if written to `update_progress:{planId}` — see §5 note) | — | `{ success, data: BatchUpdateProgress }` or 404 |
| POST | `/api/v1/updates/plans/:planId/cancel` | Bearer | Cancel a plan not currently `in_progress` | — | `{ success, message: "Plan cancelled" }` |
| POST | `/api/v1/updates/update-all` | Bearer | Convenience: create + immediately execute a plan for all out-of-date tenants | `{ targetVersion, strategy?, batchSize? }` (zod) | `{ success, data: { planId, progress } }` or `{ success, message: "All tenants are up to date", data: { count: 0 } }` |

### `routes/markets.ts` — mounted at `/api/v1/markets` and `/api/v1/admin/markets` (protected)

| Method | Full path | Auth | Purpose | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/markets` | Bearer | **Stub** — always returns empty list | Query `page?`, `limit?` (≤100) | `{ success, data: { markets: [], total: 0, page, limit } }` |
| GET | `/api/v1/admin/markets/join-requests` | Bearer | **Stub** | Query `status?` | `{ success, data: { requests: [], status } }` |
| GET | `/api/v1/admin/markets/vendor-candidates` | Bearer | **Stub** | Query `q?` | `{ success, data: { restaurants: [], total: 0, query } }` |

None of these query any table; do not port them as if real data exists — they
are unimplemented placeholders as of this reading.

## 4. Middleware & auth

- **CORS** (`index.ts:52-69,71-76`): `hono/cors` with a dynamic `origin`
  callback (`resolveCorsOrigin`) that only allows origins present in the
  comma-separated `CORS_ORIGIN` env var (or allows none if `CORS_ORIGIN` is
  unset/`"*"` — note `"*"` is explicitly treated as "no origin allowed", not
  wildcard-allow). `credentials: true`, `maxAge: 86400`. A follow-up
  middleware strips the `Access-Control-Allow-Credentials` response header
  whenever no `Access-Control-Allow-Origin` was set, to avoid sending
  `credentials: true` without a matching allowed origin.
- **Logging/timing**: `hono/logger`, `hono/timing`, `hono/pretty-json` on `*`.
- **Request ID**: `X-Request-ID` echoed back or generated via
  `crypto.randomUUID()`, exposed via `exposeHeaders`.
- **Error handling** (`index.ts:94-126`): `ApiError` instances format to
  `{ success: false, error: { code, message, details? } }` with
  `sanitizeApiErrorDetails()` redacting keys matching
  `/password|passcode|token|secret|authorization|cookie|api[-_]?key|key/i`
  (see `packages/utils/src/api-error.ts`). Non-`ApiError` exceptions return
  500 `INTERNAL_ERROR`, with the real message only exposed when
  `NODE_ENV === "development"`.
- **404**: `app.notFound` returns `{ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }`.
- **Management JWT auth** (`middleware/auth.ts`): Bearer token verified with
  `hono/jwt`'s `verify(token, secret, "HS256")`. Required claims: `id` and
  `email` (strings), `role === "admin" | 0"` (`hasPlatformAdminClaim`),
  `aud === "management"`, `iss === "makanmakan-management"`. Expiry is checked
  both by `hono/jwt` internally and again explicitly
  (`payload.exp < Math.floor(Date.now()/1000)`). Any failure throws
  `unauthorized()`. Only one role exists at this layer: `"admin"` — there is
  no finer-grained RBAC inside management-api itself.
- **Internal token auth** (`routes/internal.ts:42-62`): a hand-rolled
  constant-time string comparison (`constantTimeEqual`, XOR-accumulate over
  char codes, length-checked first) against header `X-Internal-API-Token`
  compared to secret `INTERNAL_API_TOKEN`. Applied via `router.use("*", ...)`
  on the whole `internal` sub-router, which is mounted *outside*
  `protectedApi`/`managementAuthMiddleware` in `index.ts`.
- **Application-secret auth** (`routes/onboarding.ts:38-57`): a one-time
  secret returned at application-creation time; only its SHA-256 hash
  (`sha256:{base64url}`) is stored (`OnboardingService.hashApplicationSecret`),
  and verification uses the same constant-time compare pattern
  (`OnboardingService.constantTimeEqual`).
- **Auth token exchange model**: `/api/v1/auth/exchange` is the only place a
  *main-platform* JWT (signed with `JWT_SECRET`) is turned into a
  *management-scoped* JWT (signed with `MANAGEMENT_JWT_SECRET` ??
  `JWT_SECRET`, audience `management`). This means management-API tokens are
  a distinct, shorter-lived (1h) credential from platform API tokens, not the
  same token reused.

## 5. Services

### `TenantService` (`src/services/TenantService.ts`)

Owns `tenants` CRUD plus platform-restaurant provisioning glue.

- `listTenants({ page, limit, status?, search? })` — hand-built SQL with
  `LIKE` search across `business_name`, `contact_email`, `subdomain`;
  separate `COUNT(*)` query derived by string-replacing `SELECT *` →
  `SELECT COUNT(*) as count` (fragile string surgery to note for the Rust
  port — replicate via a proper query builder instead).
- `getTenantById`, `getTenantBySubdomain`, `getTenantByPlatformRestaurantId`.
- `generateAvailableSubdomain(businessName)` — up to 10 attempts of
  `{pinyin-slug}-{6-char random base36}`, checked for collision each time;
  throws if exhausted.
- `createTenant(data)` — simple insert, status starts `"pending"`.
- `provisionPlatformRestaurantTenant(data)` — idempotent entry point used by
  `routes/internal.ts`: if a tenant already exists for
  `platformRestaurantId`, ensures a `shop_subscriptions` row exists
  (`ensureShopSubscription`) and returns the existing tenant; otherwise calls
  `provisionTenantWithSubscription`.
- `provisionTenantWithSubscription(data)` — creates the tenant **and** its
  `shop_subscriptions` row in a single `MANAGEMENT_DB.batch([...])` (atomic
  multi-statement D1 batch). Computes plan tier via `planIdToTier()` from
  `@makanmasak/database`; if the resulting tier is `"trial"`,
  `trial_ends_at_ms = now + TRIAL_DURATION_MS` (180 days) and billing-cycle
  columns are left `null`; otherwise `billing_cycle_start_at_ms = now`,
  `billing_cycle_end_at_ms = now + DEFAULT_BILLING_CYCLE_MS` (30 days).
- `linkPlatformRestaurantOwner(data)` — throws a plain `Error` (message
  `"Tenant is already linked to a different owner"`, caught and mapped to a
  409 in `routes/internal.ts`) if the tenant already has an owner link whose `ownerUserId` **or** `ownerUsername` differs (`TenantService.ts:300-306` — a same-user/different-username mismatch also throws), i.e. any conflicting owner
  linked; otherwise idempotent update.
- `updateTenant(id, data)` — dynamic `UPDATE` statement built by appending
  `"col = ?"` fragments only for defined fields; sets `activated_at` when
  `status` transitions *into* `"active"` from a non-active status.
- `deleteTenant(id)` — soft delete: sets `status = 'terminated'`.
- `getTenantResources(tenantId)` — reads `tenant_resources`.
- ID generation: `generateTenantId()` → `T-{YYYYMMDD}-{8-char upper base36}`;
  `generateSubscriptionId()` → `sub_{crypto.randomUUID()}`.
- Row mapping (`mapRowToTenant`) is manual snake_case→camelCase; no ORM.

Tables touched: `tenants`, `shop_subscriptions`.

### `OnboardingService` (`src/services/OnboardingService.ts`)

The most complex service: turns a public onboarding application into a full
tenant + platform owner account, with manual saga-style rollback on failure.

- `checkSubdomainAvailability(subdomain)` — checks both `tenants` and
  in-flight `onboarding_applications` (excluding `rejected`/`completed`).
- `createApplication(data, metadata)` — generates application ID
  (`APP-{YYYYMMDD}-{8-char upper base36}`), a 32-byte random
  `applicationSecret` (`onb_{base64url}`, **returned to caller once, never
  stored in plaintext**), and its SHA-256 hash for storage; auto-generates
  and collision-checks a subdomain (up to 5 attempts, then re-verifies once
  more and throws if still unavailable).
- `getApplication`, `getApplicationByEmail`, `listApplications` (paginated,
  optional status filter), `verifyApplicationSecret` (hash + constant-time
  compare).
- `activateApplication(applicationId)` *(private)* — the core saga:
  1. status → `"provisioning"`.
  2. `createTenantWithSubscription()` → `TenantService.provisionTenantWithSubscription`.
  3. `createPlatformOwnerAccount()` → writes `restaurants` + `users` +
     `password_reset_tokens` into `PLATFORM_DB` via a Drizzle
     `platformDb.batch([...])` (atomic), then updates the `tenants` row in
     `MANAGEMENT_DB` with `platform_restaurant_id`/`owner_user_id`/`owner_username`.
  4. `createCredentialDelivery()` → writes a tracking row into
     `onboarding_credential_deliveries` (via a locally-defined Drizzle
     `sqliteTable`, not from `@makanmasak/database` — see §6 note).
  5. Marks the application `"completed"` with `tenant_id`/`completed_at`.
  6. `dispatchCredentialDelivery()` → if email delivery is enabled, sends via
     MailChannels and updates delivery status; **failures here do not fail
     the overall approval** — they're caught, logged, and recorded as
     `status: "failed"` on the delivery record while the approval itself
     still reports success.
  - **On any exception before step 6**: rolls back in reverse order —
    `rollbackCredentialDelivery` → `rollbackPlatformOwnerAccount` (deletes
    `password_reset_tokens`/`users`/`restaurants` rows it created, tolerating
    a failure on the token-table delete) → `rollbackTenantProvisioning`
    (deletes `shop_subscriptions` + `tenants` rows) → restores the
    application's previous status. This is manual application-level
    compensation, not a DB transaction — a Rust port must replicate the same
    ordering and the "best-effort" partial-failure tolerance in
    `rollbackPlatformOwnerAccount`'s token-delete `try/catch`.
- `approveApplication(applicationId)` — idempotent: if already `"completed"`,
  reconstructs and returns the existing owner-account/credential-delivery
  info instead of re-running the saga (`getProvisionedOwnerAccount`,
  `getCredentialDelivery`). Only allows activation from `"submitted"`.
- `rejectApplication(applicationId)` — blocked from `"completed"`/`"provisioning"`.
- Owner account generation invariants:
  - `generateAvailableOwnerUsername` slugifies the local part of the contact
    email (falling back to subdomain, then business name), tries the bare slug
    first then up to 9 retries appending a `-{4-char-base36}` suffix (10
    attempts total, `OnboardingService.ts:833-843`), and as a last resort appends 8
    chars of a fresh UUID.
  - `generateUnusablePassword()` — the owner's `passwordHash` is bcrypt(cost
    10) of a random, never-communicated string
    (`disabled-{uuid}-{12-char upper base36}`); the *real* credential path is
    the password-reset/setup-link flow, not a password the owner ever
    receives directly.
  - `buildSetupPasswordLink(token)` — base URL resolution order: first
    configured `CORS_ORIGIN` entry → `API_BASE_URL` with any `/api[/vN]` path
    suffix stripped → hardcoded `http://localhost:3000` fallback.
  - Setup-password tokens expire 24h after issuance
    (`setupPasswordExpiresAtMs = nowMs + 24*60*60*1000`).
  - The provisioned `restaurants` row is created with `isAvailable: false`
    and placeholder `address`/`district` derived from GPS coords or the
    application ID — the owner must complete their profile before the
    restaurant can go live.
- `sendSetupPasswordEmail` — POSTs to `https://api.mailchannels.net/tx/v1/send`
  with a plain-text body; only attempted if `ONBOARDING_EMAIL_ENABLED ===
  "true"` and `ONBOARDING_EMAIL_FROM` is set.

Tables touched: `MANAGEMENT_DB.onboarding_applications`,
`MANAGEMENT_DB.onboarding_credential_deliveries`, `MANAGEMENT_DB.tenants`,
`MANAGEMENT_DB.shop_subscriptions`; `PLATFORM_DB.restaurants`,
`PLATFORM_DB.users`, `PLATFORM_DB.password_reset_tokens`.

### `ProvisioningService` (`src/services/ProvisioningService.ts`)

Orchestrates provisioning Cloudflare resources and deploying tenant Workers
into a **platform-owned** Cloudflare account (`PLATFORM_CF_*`/`CF_*`
credentials) — this is the "managed hosting" path, separate from tenants who
run their own independent Cloudflare account.

- `provisionTenant(tenantId, resourceTypes?)` — defaults to `["d1","kv","r2"]`.
  Resource naming: `makanmakan-{subdomain}-db|-cache|-storage` via
  `getResourceName`. For each type: inserts a `tenant_resources` row as
  `"creating"`, calls the matching `CloudflareApiClient` method, then updates
  the row to `"ready"` (with the Cloudflare-assigned resource ID) or
  `"error"` (with message). Sets tenant `status` to `"provisioning"` up
  front, then to `"active"` if zero or partial failures, or back to
  `"pending"` only if *every* requested resource type failed.
- `deployToTenant(tenantId, targetVersion, deploymentType = "update")` — full
  pipeline, each step short-circuiting to a `"failed"` deployment-log entry
  on error:
  1. Create `deployment_logs` row (`status: "in_progress"`).
  2. Look up tenant; record `from_version` on the log if one exists.
  3. Fetch platform Cloudflare credentials (fails closed if unconfigured).
  4. `BundleService.getBundle(targetVersion)` from R2; 404-equivalent failure
     if the version's `worker.js` object is missing.
  5. Look up the tenant's *ready* `tenant_resources` (D1/KV/R2 resource IDs).
  6. If a D1 resource exists and the bundle has migrations,
     `MigrationService.applyPendingMigrations(...)` — stops the whole deploy
     on first migration failure.
  7. Builds a Cloudflare Workers `bindings[]` array (`type: "d1"` name `DB`,
     `type: "kv_namespace"` name `CACHE_KV`, `type: "r2_bucket"` name
     `STORAGE`, plus `plain_text` bindings for `NODE_ENV`/`API_VERSION`) and
     calls `CloudflareApiClient.deployWorker` with script name
     `makanmakan-{subdomain}-api`.
  8. On success: updates `tenants.deployed_version`, marks the log
     `"completed"`.
- `rollbackDeployment(tenantId, targetVersion?)` — resolves the version to
  roll back to from the most recent `completed` deployment's `from_version`
  if not explicitly given, then calls `deployToTenant(..., "rollback")`.
- `batchDeploy(tenantIds, targetVersion)` — sequential loop (not
  parallelized; comment acknowledges this), independent try/catch per
  tenant.
- `getDeploymentStatus`, `getDeploymentHistory` — read-only queries.

Tables touched: `tenant_resources`, `deployment_logs`, `tenants`
(`deployed_version`, `status`).
External calls: Cloudflare API via `CloudflareApiClient` (see below).

### `CloudflareApiClient` (`src/services/CloudflareApiClient.ts`)

Thin wrapper over `https://api.cloudflare.com/client/v4`, always
`Authorization: Bearer {apiToken}`. The 6 mutating/query methods (`createD1Database`, `createKVNamespace`, `createR2Bucket`, `deployWorker`, `getWorkerInfo`/`deleteWorker`, `runD1Migration`) independently `try/catch`
and returns `{ success, ...", error? }` rather than throwing — errors are
mapped from Cloudflare's `errors[0].message` or a generic fallback string.

Endpoints called:
- `GET /accounts/{accountId}` — `verifyToken`.
- `GET /accounts/{accountId}/workers/scripts` — `checkWorkersPermission`.
- `GET /accounts/{accountId}/d1/database` — `checkD1Permission`.
- `GET /accounts/{accountId}/storage/kv/namespaces` — `checkKVPermission`.
- `GET /accounts/{accountId}/r2/buckets` — `checkR2Permission`.
- `GET /accounts/{accountId}/pages/projects` — `checkPagesPermission`.
- `POST /accounts/{accountId}/d1/database` `{ name }` — `createD1Database`.
- `POST /accounts/{accountId}/storage/kv/namespaces` `{ title }` — `createKVNamespace`.
- `POST /accounts/{accountId}/r2/buckets` `{ name }` — `createR2Bucket`.
- `PUT /accounts/{accountId}/workers/scripts/{scriptName}` (multipart
  `FormData`: `metadata` JSON blob with `main_module`/`bindings`, plus
  `index.js` module blob) — `deployWorker`.
- `GET /accounts/{accountId}/workers/scripts/{scriptName}` (headers only,
  reads `etag`/`content-type`) — `getWorkerInfo`.
- `DELETE /accounts/{accountId}/workers/scripts/{scriptName}` — `deleteWorker`.
- `POST /accounts/{accountId}/d1/database/{databaseId}/query` `{ sql }` —
  `runD1Migration`.
- `verifyTokenWithPermissions` runs the five permission checks via
  `Promise.allSettled`, treating any rejected/`false` result as "no
  permission" rather than propagating the error.

No retry logic anywhere in this client — a single `fetch` attempt per call.
A Rust port that wants resilience must add retry/backoff as new behavior,
not assume it's being replicated from here.

### `BundleService` (`src/services/BundleService.ts`)

R2-backed version bundle store. Layout: `bundles/{version}/worker.js`,
`bundles/{version}/migrations.json` (array of `{name, sql}`),
`bundles/{version}/manifest.json` (`{version, migrations, createdAt}`, write-only —
`getBundle` never reads it back).
- `getBundle(version)` — returns `null` if `worker.js` is missing, even if
  `migrations.json` exists; migrations default to `[]` if that object is
  absent.
- `listVersions()` — uses R2 `list({ prefix: "bundles/", delimiter: "/" })`
  and reads `delimitedPrefixes`, sorted descending by plain string sort (not
  semver-aware — `"1.10.0" < "1.2.0"` lexicographically, a real bug for
  double-digit versions to flag when porting).
- `uploadBundle(version, script, migrations)` — called by an external CI/CD
  pipeline (not by any route in this codebase); writes all three R2 keys in
  parallel.

### `MigrationService` (`src/services/MigrationService.ts`)

Tracks/applies D1 migrations to a tenant's *own* provisioned D1 database
(distinct from `MANAGEMENT_DB`/`PLATFORM_DB` migration tracks).
- `getAppliedMigrations(tenantId)` — reads `tenant_migrations`, ordered by
  `migration_name ASC` (i.e., lexicographic, relying on migration file
  naming discipline for ordering — same caveat as `BundleService.listVersions`).
- `applyPendingMigrations(tenantId, apiToken, accountId, databaseId, migrations)`
  — sorts the incoming list by name, skips already-`success`fully-applied
  names, executes each remaining migration in order via
  `CloudflareApiClient.runD1Migration`, **stops at the first failure**
  (`break`), recording every attempt (applied/skipped/failed) in
  `tenant_migrations`.
- `MigrationService.computeChecksum(sql)` — a synchronous, non-cryptographic
  hash (classic 32-bit multiply-add rolling hash, `hash = (hash<<5) - hash +
  charCode`, formatted `chk-{8 hex digits}`), explicitly chosen over
  `crypto.subtle.digest` to stay synchronous. **This is not collision-
  resistant** — a Rust port should treat this as a change-detection
  fingerprint only, not a security-relevant checksum, and may reasonably
  upgrade it as long as stored/compared values are migrated together.

Tables touched: `tenant_migrations`.

### `VersionSyncService` (`src/services/VersionSyncService.ts`)

Batch version-rollout planning/execution.
- `getAvailableReleases()` — **hard-coded** array of 3 releases
  (`1.2.0`/`1.1.0`/`1.0.0`) with Traditional-Chinese changelog strings; there
  is no table or R2 object backing this in the current code. A Rust port
  must decide whether to keep this static or wire it to `BundleService`'s
  real version list.
- `createBatchUpdatePlan(targetVersion, tenantIds, strategy, options)` —
  plan ID `plan-{timestamp}-{12-char base36}` (`randomId("plan")`), persisted
  to `CACHE_KV` key `update_plan:{id}` with a 7-day TTL. Default
  `batchSize = 5`, `canaryPercentage = 10`.
- `executeBatchUpdatePlan(planId)` — reads the plan back from KV, flips
  `status` to `"in_progress"`, fetches tenant rows for the plan's
  `tenantIds`, and **runs synchronously to completion inside the HTTP
  request** — dispatches to one of three private strategies:
  - `executeAllAtOnce` — all tenants in parallel via `Promise.allSettled`.
  - `executeRolling` — batches of `batchSize`, with a **hard `setTimeout`
    5-second delay** between batches (`await new Promise(resolve =>
    setTimeout(resolve, 5000))`) — this is real wall-clock blocking inside a
    Worker invocation and is a CPU/wall-time budget risk worth flagging for
    the Rust/Workers port (Workers have execution time limits; long
    synchronous multi-tenant rollouts risk hitting them).
  - `executeCanary` — updates `ceil(total * canaryPercentage/100)` tenants
    first; if any canary result is `"failed"`, aborts the remaining rollout
    entirely (logs and returns early) — no partial retry. Otherwise waits a
    **hard 10-second `setTimeout`** before rolling out to the rest.
  - **Note:** `executeBatchUpdatePlan` returns the in-memory `progress`
    object directly to the caller but never writes it to
    `update_progress:{planId}` in `CACHE_KV`. `getUpdatePlanProgress` reads
    from that KV key, which nothing in this file ever populates — so
    `GET /updates/plans/:planId/progress` will always 404 after execution in
    the current code. This looks like a real gap (progress polling is
    non-functional), not intentional design; flag it rather than silently
    reproducing "dead" behavior in Rust without a decision.
- `updateTenant(tenant, targetVersion, progress)` *(private)* — delegates the
  actual deploy to `ProvisioningService.deployToTenant`, mutating the shared
  `progress` object's counters in place.
- `getTenantsNeedingUpdate(targetVersion)` — `SELECT * FROM tenants WHERE
  status = 'active' AND (deployed_version IS NULL OR deployed_version <
  ?)` — plain string comparison of semver strings, same lexicographic
  ordering caveat as elsewhere.
- `cancelUpdatePlan(planId)` — refuses to cancel a plan currently
  `"in_progress"` (throws a plain `Error`, caught and mapped to 400 in the
  route).
- Row mapping (`mapTenantRow`) explicitly comments on why `SELECT *` results
  cannot be cast directly to the `Tenant` TS type (snake_case vs camelCase
  field name mismatch) — a good illustration of a class of bug the Rust port
  should make structurally impossible (e.g., via `sqlx`'s compile-time
  query-checking or an explicit `FromRow` mapping layer, mirroring the
  project's own "Layer 1/2 Drizzle" convention from `CLAUDE.md`).

Tables touched: `tenants` (read-only). Plan/progress state lives in
`CACHE_KV`, not D1.

### `AlertService` (`src/services/AlertService.ts`) — currently unused

Fully implemented but **not imported by any route file or other service** in
`apps/management-api/src` (confirmed via grep — only the file itself matches
`AlertService`). Documented for completeness in case a Rust port is expected
to wire it up, but do not assume it executes today.
- `processHealthCheck(tenant, healthCheck)` — no-op (calls
  `resolveAlerts`, itself just a `console.log` stub) for `"healthy"`;
  otherwise builds an `Alert` (`severity: "critical"` for `"down"`,
  `"warning"` for `"degraded"`) and calls `sendNotifications`.
- `processDeploymentFailure(tenant, deploymentId, error)` — always
  `severity: "critical"`.
- `sendNotifications` — only implements Slack today (an email branch is
  commented out); fires-and-forgets via `Promise.allSettled`.
- `sendSlackNotification` — POSTs a Slack "attachments" payload to
  `env.SLACK_WEBHOOK_URL`; color-coded by severity
  (`critical`→`#dc2626`, `warning`→`#f59e0b`, else `#3b82f6`).
- `resolveAlerts`, `getActiveAlerts`, `acknowledgeAlert` — all stubs
  (`console.log` / hard-coded empty array); **there is no persistent alert
  storage** — `Alert` objects are constructed and (optionally) sent to
  Slack, never written to any table. `routes/monitoring.ts`'s `/alerts`
  endpoint is a completely separate, unrelated implementation that derives
  synthetic "alerts" from `health_checks` rows directly.

## 6. Data model

All tables below are D1/SQLite. Timestamps in `MANAGEMENT_DB`'s own migration
track (`apps/management-api/migrations/*.sql`) are `TEXT` (ISO 8601 via
`datetime('now')` defaults or `new Date().toISOString()` in code) — **this
predates and does not follow** the project-wide `INTEGER` Unix-ms timestamp
convention documented in `CLAUDE.md`/memory for newer tables. The one
exception is `shop_subscriptions`, added later, which correctly uses
`INTEGER … _ms` columns with `unixepoch('now') * 1000` defaults. A Rust port
should preserve each table's actual on-disk type rather than assuming
uniform ms-integer timestamps across this database.

### `MANAGEMENT_DB` tables (own migration track, `apps/management-api/migrations/0001`–`0012`)

- **`tenants`** — `id` (TEXT PK, app-generated `T-...` string, not UUID),
  `business_name`, `contact_email`, `contact_phone`, `latitude`/`longitude`
  (REAL, added 0009), `subdomain` (UNIQUE), `custom_domain`,
  `deployed_version`, `license_tier` (default `standard`), `license_key`,
  `license_expires_at`, `status` (default `pending`), `created_at`,
  `activated_at`, `updated_at`, `platform_restaurant_id`, `owner_user_id`,
  `owner_username` (added 0011; **not indexed** — migration 0011 only indexes `platform_restaurant_id` and `owner_user_id`).
- **`tenant_resources`** — `id` PK, `tenant_id` FK→`tenants(id)` (cascade
  delete), `resource_type`, `resource_name`, `resource_id` (Cloudflare-side
  ID), `status`, `error_message`, timestamps.
- **`deployment_logs`** — `id` PK, `tenant_id` FK (cascade), `deployment_type`,
  `from_version`, `to_version`, `status`, `logs` (JSON-string array),
  `started_at`, `completed_at`.
- **`health_checks`** — `id` PK, `tenant_id` FK (cascade), `status`,
  `response_time_ms`, `details` (JSON string), `checked_at`; composite index
  `(tenant_id, checked_at DESC)`.
- **`licenses`** — `id` PK, `tenant_id` FK (cascade), `license_key` (UNIQUE),
  `tier`, `expires_at`, `revoked_at`, `revoke_reason` (columns present but no
  route in this codebase writes `revoked_at`/`revoke_reason`), `created_at`.
- **`onboarding_applications`** — `id` PK (`APP-...` string), `business_name`,
  `contact_name`, `contact_email`, `contact_phone`, `plan_id` (DDL default
  `standard`, but effectively dead: `OnboardingService.createApplication`
  always inserts `data.planId ?? "trial"`, so an omitted `planId` yields
  `trial`, never `standard`), `requested_subdomain`, `assigned_subdomain` (UNIQUE),
  `status` (default `submitted`), `tenant_id` FK→`tenants(id)`, `ip_address`,
  `user_agent`, `latitude`/`longitude` (REAL, added 0009),
  `application_secret_hash` (added 0010, only a hash is ever stored),
  timestamps.
- **`tenant_migrations`** — `id` PK, `tenant_id` FK→`tenants(id)`,
  `migration_name`, `checksum`, `applied_at`, `success` (INTEGER 0/1),
  `error_message`; UNIQUE`(tenant_id, migration_name)`.
- **`shop_subscriptions`** — `id` PK, `restaurant_id` (UNIQUE, FK→`tenants(id)`
  — despite the column name, this points at the *tenant* ID, not a
  `PLATFORM_DB.restaurants.id`), `plan_tier` (default `trial`),
  `module_overrides` (JSON string, default `'{}'`), `is_active` (INTEGER),
  `trial_ends_at_ms`, `billing_cycle_start_at_ms`, `billing_cycle_end_at_ms`
  (all INTEGER ms — the one table on this track using the modern timestamp
  convention), `notes`, `created_at_ms`/`updated_at_ms`.
- **`onboarding_credential_deliveries`** — `id` PK, `application_id`
  FK→`onboarding_applications(id)`, `tenant_id` FK→`tenants(id)`,
  `restaurant_id`, `user_id` (both plain TEXT, not FK-declared, since they
  point into the *other* database, `PLATFORM_DB`), `recipient_email`,
  `recipient_name`, `username`, `setup_password_link`,
  `setup_password_expires_at`, `delivery_channel` (default `manual`),
  `status` (default `pending`), `error_message`, timestamps; UNIQUE
  `(application_id, user_id)`. **This table's Drizzle model is defined
  inline inside `OnboardingService.ts`** (`sqliteTable("onboarding_credential_deliveries", ...)`),
  not exported from `@makanmasak/database` alongside the other schema —
  worth normalizing during the Rust port.

### `PLATFORM_DB` tables touched by this worker (schema owned by `packages/database`, not this app's migration track)

- **`restaurants`** — inserted by `OnboardingService.createPlatformOwnerAccount`
  with `type: "onboarding"`, `category: "restaurant"`, `isAvailable: false`,
  `isActive: true`, GPS-or-placeholder `address`/`district`.
- **`users`** — inserted with `role: 1` (Shop Owner per the platform-wide role
  enum in `CLAUDE.md`), `restaurantId` linking back to the just-created
  restaurant, `isVerified: false`, `tokenVersion: 1`, a bcrypt hash of an
  unusable random password.
- **`password_reset_tokens`** — inserted with `tokenType: "email"`,
  `userAgent: "management-onboarding"`, 24h expiry; deleted (best-effort) on
  rollback.

Per project memory, `users.id`/`restaurants.id` are `TEXT` UUID v7 columns —
consistent with this service's use of `crypto.randomUUID()` for
`restaurantId`/`userId`. (Note: `crypto.randomUUID()` produces a UUID v4, not
v7 — the *column type* is UUID-v7-shaped TEXT per schema convention, but the
*values this service inserts* are v4. This is worth flagging for the Rust
port: either keep parity with v4 IDs from this path, or take the opportunity
to switch to v7 generation consistent with `packages/utils`'s `generateUUID()`
(`uuidv7()`), which this file does not use.)

## 7. Cross-service interactions

- **`apps/api` → `apps/management-api`** via a real Cloudflare **service
  binding** (`MANAGEMENT_API`, `apps/api/wrangler.toml`), used exclusively by
  `apps/api/src/services/managementTenantClient.ts`:
  - `POST /api/v1/internal/platform-restaurants/{restaurantId}/tenant`
  - `PATCH /api/v1/internal/platform-restaurants/{restaurantId}/owner`
  Both calls set `X-Internal-API-Token` from `apps/api`'s own
  `INTERNAL_API_TOKEN` env value (must match this worker's secret of the
  same name) and target a synthetic origin (`https://management.internal`)
  since service bindings route by binding, not DNS. The client has a
  documented TODO to drop a legacy flat-string error-shape fallback once all
  deployed `management-api` instances are past a specific commit.
- **Independent-deployment `apps/api` instances → `apps/management-api`**
  over plain `fetch` (no service binding — these are genuinely separate
  Cloudflare accounts/deployments), via `apps/api/src/services/LicenseService.ts`
  calling `POST {CENTRAL_API_URL}/api/v1/licenses/verify` with
  `X-Tenant-Id`/`X-Platform-Version` headers (no bearer token — see the
  auth-mismatch flag in §3). `LicenseService` caches results in its own
  `CACHE_KV` (1h success / 5min failure TTL) and falls back to permissive
  "offline validation" if the central API is unreachable or returns non-2xx,
  which is a deliberate availability-over-strictness design choice worth
  preserving in Rust.
- **Onboarding-app / management-portal → `apps/management-api`**: the public
  onboarding endpoints (`/api/v1/onboarding/*`) are the presumed integration
  point for `apps/onboarding-app`; the admin approve/reject and tenant/deploy
  management endpoints are the presumed integration point for
  `apps/management-portal`. No direct code reference was found *within this
  worker* to either frontend app (as expected — the relationship is
  HTTP-only from the frontend's side), so this is inferred from route
  purpose and the port map in `CLAUDE.md`, not verified by reading those
  apps' source in this pass.
- **`apps/management-api` → Cloudflare's own control-plane API**
  (`api.cloudflare.com/client/v4`) using **platform-owned** credentials
  (`PLATFORM_CF_API_TOKEN`/`PLATFORM_CF_ACCOUNT_ID`, falling back to
  `CF_API_TOKEN`/`CF_ACCOUNT_ID`) — this is Cloudflare-account-level resource
  provisioning on behalf of managed tenants, not a call to another
  MakanMakan service.
- **`apps/management-api` → MailChannels** (`api.mailchannels.net`) for
  onboarding setup-password emails, gated by `ONBOARDING_EMAIL_ENABLED`.
- **`apps/management-api` → Slack** (`SLACK_WEBHOOK_URL`) via the currently
  dead `AlertService` — not actually invoked in production per §5.
- **`apps/management-api` → itself, tenant subdomains**: `routes/health.ts`'s
  `POST /health/check/:tenantId` calls out to
  `https://api.{tenant.customDomain || subdomain+'.makanmakan.app'}/health` —
  i.e., it probes each independently-hosted tenant's own API worker.

## 8. Rust rewrite notes

**Timestamps / dates**
- This worker's *own* migration track (`apps/management-api/migrations/`) is
  almost entirely `TEXT` ISO-8601 timestamps (`datetime('now')` SQL defaults,
  `new Date().toISOString()` in application code) — the opposite of the
  repo-wide `INTEGER` Unix-ms convention. Only `shop_subscriptions` (added in
  0008) uses `INTEGER … _ms`. A Rust port must read/write each column in its
  *actual* stored type per table, not assume one convention worker-wide.
- Version string comparisons (`deployed_version < ?` in SQL, and JS `<` on
  semver strings in `VersionSyncService`/`BundleService.listVersions`) are
  **lexicographic, not semver-aware** — `"1.10.0"` sorts before `"1.2.0"`.
  Decide explicitly whether the Rust port fixes this with a real semver
  crate (`semver`) or intentionally preserves the (buggy) ordering for
  behavioral parity during dual-run testing.

**JSON field storage**
- `deployment_logs.logs`, `health_checks.details`,
  `shop_subscriptions.module_overrides`, `tenant_resources` (no JSON column
  itself) — all stored as raw JSON strings in TEXT columns, manually
  `JSON.stringify`/`JSON.parse`d at the call site (no shared serialization
  helper). In Rust, model these as `serde_json::Value` (or typed structs)
  serialized to `TEXT` at the query layer — watch for the places that store
  `null` (not `"{}"`/`"[]"`) when the JS value is falsy (e.g.
  `details ? JSON.stringify(details) : null` in `routes/health.ts`).

**Crypto / random usage**
- `crypto.randomUUID()` (UUID v4) is used pervasively for resource IDs,
  license IDs, health-check IDs, alert IDs, and — notably — the
  `restaurantId`/`userId` written into `PLATFORM_DB` by
  `OnboardingService`, even though the schema convention elsewhere is UUID
  v7 (see §6 note). `packages/utils`'s `generateUUID()` (`uuidv7()`) exists
  and is used by `MigrationService` for migration IDs, but *not* by
  `OnboardingService` for the platform account IDs — an inconsistency to
  resolve deliberately (replicate v4 for parity, or switch to v7 and treat
  it as an intentional behavior change) rather than silently "fixing" during
  translation.
- Custom base36 random string generation (`utils/random.ts`) rejects bytes
  ≥ `BASE36_REJECTION_LIMIT` to avoid modulo bias — replicate this rejection
  sampling in Rust (e.g. with `rand`'s uniform range sampling) rather than a
  naive `byte % 36`, to preserve the same statistical properties (though the
  exact output values will differ since the RNG differs).
- Two independent hand-rolled **constant-time string comparisons**
  (`routes/internal.ts`'s `constantTimeEqual`, `OnboardingService`'s
  `constantTimeEqual`) — identical XOR-accumulate implementations,
  duplicated rather than shared. In Rust, use a vetted constant-time compare
  (e.g. `subtle::ConstantTimeEq`) rather than hand-rolling twice again.
- Application secrets are 32 random bytes, base64url-encoded, prefixed
  `onb_`; only a `sha256:{base64url}` hash is ever persisted — never store
  the raw secret. `crypto.subtle.digest("SHA-256", ...)` is used for this
  hash (async Web Crypto), while `MigrationService.computeChecksum` uses a
  synchronous non-cryptographic rolling hash for change-detection only — do
  not conflate the two when choosing Rust hash primitives (`sha2` crate for
  the former; anything fast/simple, even non-crypto, for the latter).

**Streaming**
- No streaming responses anywhere in this worker — every route buffers a
  full JSON body. The one binary-ish operation, `CloudflareApiClient.deployWorker`,
  builds an in-memory `FormData`/`Blob` for the Worker script upload rather
  than streaming it; bundles are also fully buffered in `BundleService.getBundle`
  (`await scriptObj.text()`). Fine to replicate as buffered `axum`/`worker-rs`
  request/response bodies; no `Stream`/chunked-transfer behavior to preserve.

**Retry logic**
- **None.** Every external call (Cloudflare API, MailChannels, tenant health
  probes) is a single `fetch` attempt wrapped in `try/catch` that converts
  failures into a `{success: false, error}`-shaped result rather than
  retrying. `LicenseService` on the *caller* side (`apps/api`) does implement
  a fallback (offline validation) but that's a different app. Do not
  introduce retry/backoff in the Rust port as if replicating existing
  behavior — that would be new behavior requiring its own parity sign-off
  per the migration spec's "Ask First" list.

**Stateful / Cloudflare-specific constraints**
- **Two D1 bindings, one shared database.** `PLATFORM_DB` has the *same*
  `database_id` as the main `apps/api` worker's `DB` binding in both dev and
  prod. The Rust port must keep writing to the same physical database
  through the equivalent binding, honoring `packages/database`'s schema as
  source of truth — this worker must never run its own independent migration
  track against `PLATFORM_DB`.
- **`CACHE_KV` doubles as a database** for `VersionSyncService`'s
  ephemeral plan/progress records (7-day TTL) — there is no D1 table for
  update plans. A Rust port keeping KV for this is fine; just don't assume
  durability beyond the TTL, and note the progress-write gap flagged in §5
  (`update_progress:{planId}` is read but never written).
- **In-request long-running work**: `VersionSyncService.executeRolling`/`executeCanary`
  use real `setTimeout` delays (5s / 10s) *inside* the HTTP request handler
  before returning a response — this blocks the Worker invocation for the
  full duration of a multi-tenant rollout. Cloudflare Workers CPU/wall-time
  limits make this risky at scale; the Rust port is a natural point to
  reconsider this as a Queue-driven or Durable-Object-orchestrated background
  job instead of a synchronous HTTP call, but that is a **behavior change**
  requiring explicit sign-off, not an incidental improvement.
- **Two independent Cloudflare API credential pairs** are in play
  conceptually: (a) whatever credentials the *tenant themselves* configured
  for their own independent deployment (not held by this worker at all), and
  (b) the *platform's own* Cloudflare account credentials
  (`PLATFORM_CF_API_TOKEN`/`PLATFORM_CF_ACCOUNT_ID`) used only for
  platform-managed hosting. Keep this distinction explicit in Rust
  configuration naming to avoid accidentally using platform credentials
  against a tenant's account or vice versa.
- **Suggested Rust ecosystem equivalents**: `worker-rs` for the Worker
  runtime/bindings (per the parent spec); `serde`/`serde_json` for all JSON
  bodies and stored JSON columns; the repo's own D1 HTTP query pattern
  (bound parameters) translated to `worker-rs`'s `D1Database` query builder
  — there is no `sqlx`-over-D1 today in this codebase, and D1's Workers
  binding API (not a Postgres/MySQL wire protocol) is what's actually in
  use, so `sqlx` is not a direct fit here; `jsonwebtoken` (or
  `worker`-compatible equivalent) for the HS256 JWT verify/sign in
  `middleware/auth.ts`/`routes/auth.ts`; `bcrypt`/`bcrypt-pbkdf`-equivalent
  crate matching cost-factor 10 for the placeholder password hash; `sha2`
  for the application-secret hash; `subtle` for constant-time comparisons;
  `rand` for ID/subdomain-suffix generation (with explicit modulo-bias
  handling to match `utils/random.ts`'s rejection sampling).
