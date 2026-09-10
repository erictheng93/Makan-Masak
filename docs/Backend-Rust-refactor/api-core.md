# `apps/api` Core Layer — Reference for Rust Rewrite

This document covers the **core (non-feature) layer** of `apps/api`, the main
MakanMakan REST API Cloudflare Worker (Hono, local port 8787). Feature modules
under `apps/api/src/features/*` are documented separately by other agents;
this file's Section 3 is the authoritative map of how those feature routers
are mounted.

All paths are repo-relative to `/Users/eric/Documents/Code/Makan-makan`.

---

## 1. Purpose & topology

`apps/api` is the tenant-facing REST API for the SaaS/independent MakanMakan
deployment. It is a single Cloudflare Worker exposing `fetch`, `queue`, and
`scheduled` handlers, built on Hono.

### Three entrypoint files

| File | Role |
| --- | --- |
| `apps/api/src/app-factory.ts` | **The real app.** Exports `createApp(env?, options?)`, which builds and returns the fully-configured Hono instance: global middleware stack, error handler, `/health`, `/info`, and the entire `/api/v1/*` router tree (see Section 3). Also accepts `AppRuntimeOptions` (`disableEdgeCache`, `disableObservability`) used by tests to skip cache/analytics middleware. |
| `apps/api/src/index.ts` | **The deployed Worker module.** Calls `createApp()` once at module scope and exports `{ fetch: app.fetch, queue, scheduled }`. This is the `main` referenced by `wrangler.toml`. `queue` drains the `SEARCH_SYNC_QUEUE` (see Section 6). `scheduled` dynamically imports and dispatches to the various cron workers based on `event.cron` (see Section 6). |
| `apps/api/src/index.simple.ts` | **Not wired into wrangler.toml's `main`.** A minimal standalone Hono app (CORS + logger + pretty-json + only the `authentication` feature mounted at `/api/v1/auth`, plus a bare `/health`). Looks like a debug/fallback entrypoint for isolating login issues; not part of the normal deploy path. Its error envelope (`{error, message}`) does **not** match the unified `{success:false,error:{code,message}}` format used by `app-factory.ts` — do not treat it as authoritative for error-shape reproduction. |

### fetch / scheduled / queue entrypoints (`apps/api/src/index.ts`)

- **`fetch`**: delegates directly to `app.fetch` from `createApp()`.
- **`queue(batch, env, ctx)`**: consumes `SearchSyncMessage` batches from
  `SEARCH_SYNC_QUEUE`. Dynamically imports
  `SearchIndexSyncService` (a discovery-feature service) and constructs it
  **without** a queue binding so any internal re-sync stays inline and never
  re-enqueues. Per-message: `ack()` on success, `retry()` on failure (relies
  on the queue consumer's `max_retries`/DLQ config in `wrangler.toml`).
- **`scheduled(event, env, ctx)`**: a single handler dispatches on
  `event.cron` (the literal cron string, matched byte-for-byte) to import and
  run one of several cron workers. All cron branches are wrapped in one
  `try/catch`; any uncaught error is reported via `AlertService.systemError()`
  before the handler returns (it does **not** rethrow). See Section 6 for the
  full cron→handler table.

### A second, independently-deployed Worker sharing this source tree

`apps/backup-scheduler` (a **separate** Cloudflare Worker/app, its own
`wrangler.toml`, name `makanmasak-backup-scheduler`) points its `main` at
**`apps/api/src/workers/backup-scheduler.ts`** — i.e. it reuses a file that
physically lives inside `apps/api/src/workers/` but is not imported by
`apps/api/src/index.ts` at all. It has its own independent cron schedule
(`*/5 * * * *`, `0 */6 * * *`, `0 2 * * *`, `0 0 * * SUN`) and its own
D1/KV/R2/Analytics bindings declared in `apps/backup-scheduler/wrangler.toml`.
When reasoning about "what does apps/api do on a schedule," do not conflate
this worker's crons with the ones in `apps/api/wrangler.toml`'s own
`[triggers]` block — they are two separate deployments that happen to share
one TypeScript file.

---

## 2. Runtime & bindings (`apps/api/wrangler.toml`)

`name = "makanmasak-api"`, `main = "src/index.ts"`,
`compatibility_date = "2024-09-23"`, `compatibility_flags = ["nodejs_compat"]`.
`[dev] port = 8787`; `inspector_port` intentionally omitted (see CLAUDE.md
Windows workerd crash note).

### D1

- Binding `DB`, database `makanmakan-local` (dev/local, `database_id = "local"`) /
  `makanmasak-prod` (production, `database_id = "4e3c7ba8-5aa7-4652-bfea-a9c565b3a141"`).
  `migrations_dir = "../../packages/database/migrations_fresh"`.

### KV namespaces

| Binding | Purpose (from code) |
| --- | --- |
| `CACHE_KV` | General edge cache (EdgeCacheManager), module-gate subscription cache, quota aggregate cache, CSRF token store, cache-response storage |
| `RATE_LIMIT_KV` | Geo-intelligent rate limiter sliding-window counters, blocks, escalation levels |
| `BACKUP_KV` | Backup subsystem metadata/alert throttling (also bound in the separate `apps/backup-scheduler` worker) |
| `TOKEN_BLACKLIST` | JWT blacklist (production only in this `wrangler.toml`; checked defensively in `middleware/auth.ts` via `c.env.TOKEN_BLACKLIST` optional-chaining, so it degrades gracefully if unbound in dev) |

### R2

- `BACKUP_STORAGE` bucket (`makanmasak-backups-dev` / `-prod`) — used by
  `BackupService.uploadBackup`.
- `IMAGES_BUCKET` is declared on the `Env` type (`types/env.ts`) but **not**
  bound anywhere in `apps/api/wrangler.toml` — it belongs to
  `apps/image-processor`. Treat it as env-typed-but-unbound in this Worker.

### Queues

- **Producer + consumer** `SEARCH_SYNC_QUEUE` → queue name
  `makanmasak-search-sync-dev`/`-prod`, `max_batch_size = 25`,
  `max_batch_timeout = 10`, `max_retries = 3`, DLQ
  `makanmasak-search-sync-dlq-dev`/`-prod`. This worker is both producer
  (feature code enqueues search-index fan-out jobs) and consumer (`index.ts`
  `queue()` handler above).
- `PRELOAD_QUEUE` / `REVALIDATION_QUEUE` are referenced in
  `middleware/edge-cache.ts` (`env.PRELOAD_QUEUE?.send(...)`) but **not**
  declared anywhere in `wrangler.toml` — always `undefined` at runtime, so
  those code paths are dead/no-ops in every environment.

### Durable Objects

- `REALTIME_SESSION` → class `RealtimeSession`, `script_name =
  "makanmasak-realtime"` (dev) / `"makanmasak-realtime-prod"` (prod). This is
  a binding to the **separate** `apps/realtime` Worker's Durable Object class
  — `apps/api` calls into it but does not define the class.
- `REALTIME_ORDERS` appears on the `Env` type but has no corresponding
  `[[durable_objects.bindings]]` entry in `apps/api/wrangler.toml` — appears
  unused/legacy in this Worker.

### Rate limiting binding

- `GLOBAL_RATE_LIMITER` — Cloudflare's **native Rate Limiting binding**
  (`env.production.ratelimits`, `namespace_id = "1001"`, `simple.limit =
  100`, `simple.period = 60`). Production-only in this file. When present,
  `geoIntelligentRateLimitMiddleware` prefers it over the KV-based limiter
  except for a fixed list of "sensitive" auth/OTP paths (see Section 4).

### Analytics Engine

- `ANALYTICS` dataset `makanmasak-metrics-prod`, production-only. Code reads
  it via `env.ANALYTICS_ENGINE ?? env.ANALYTICS` (both names alias the same
  concept in `types/env.ts`; only `ANALYTICS` is actually bound).

### AI / Vectorize

- `[ai] binding = "AI"` (Workers AI) and `[[vectorize]] binding =
  "DISCOVERY_VECTORIZE"`, index `makanmasak-discovery-dev`/`-prod` — used by
  the discovery feature, not core.

### Service binding

- `[[services]] binding = "MANAGEMENT_API"` → service
  `makanmasak-management-api` (dev) / `makanmasak-management-api-prod`
  (prod). Used by `ManagementTenantClient` (Section 5) for internal
  worker-to-worker calls (no network hop, in-process `Fetcher`).

### Custom domain / routes

- Production only: `[[env.production.routes]] pattern =
  "api.makanmasak.com"`, `custom_domain = true`.

### Cron triggers (`[triggers]`, top-level — i.e. `apps/api`'s own crons, distinct from `apps/backup-scheduler`)

```
0 2 * * *     Daily token cleanup            → scheduled/cleanup-tokens.ts cleanupExpiredTokens
0 3 * * *     Daily usage events TTL cleanup → workers/usage-events-ttl.ts cleanupExpiredUsageEvents
0 3 * * SUN   Weekly log cleanup             → scheduled/cleanup-tokens.ts cleanupOldLogs  ⚠️ NEVER FIRES — dispatcher checks event.cron === "0 3 * * 0" (index.ts:65) but the toml trigger is "0 3 * * SUN" (wrangler.toml:292), so the strings never match (see bug inventory)
30 2 * * *    Daily forecast warmup          → features/forecast ForecastService.generateForecast (per active restaurant)
*/5 * * * *   Usage meter aggregation        → workers/usage-aggregator.ts aggregateUsageMeters
*/5 * * * *   Market checkout reconciliation → workers/market-checkout-reconciliation.ts reconcilePendingMarketCheckoutPayments
                                                (NOTE: two different cron branches both fire on `*/5 * * * *` in index.ts —
                                                 usage aggregation and market-checkout reconciliation both run on that tick)
0 2 * * *     Storage usage snapshot         → workers/storage-snapshot.ts snapshotStorageUsage
0 2 * * *     Customer push subscription prune → features/customer/routes pruneStaleCustomerPushSubscriptions
                                                (NOTE: three separate cron branches all match `0 2 * * *`: token cleanup,
                                                 storage snapshot, and push-subscription pruning all run on that tick)
0 4 * * *     Stored-value credit expiry     → workers/credit-expiry.ts expireStaleCredits
15 2 * * *    Billing lifecycle              → features/billing BillingCycleService.closeDueCycles +
                                                TrialReaperService.downgradeExpiredTrials +
                                                BillingReminderService.sendTrialEndingReminders (Promise.all; class BillingReminderService lives in features/billing/services/BillingNotificationService.ts:205 — same file as, but distinct from, the BillingNotificationService class)
```

Important for a Rust rewrite: the dispatcher in `index.ts` is a flat
sequence of `if (event.cron === "...")` checks, **not** a switch/map, so
multiple checks can and do match the same literal cron string in the same
invocation (see the `*/5 * * * *` and `0 2 * * *` collisions noted above) —
all matching branches run in the same `scheduled` invocation.

### Env vars / secrets (names only — see `types/env.ts` for the full Env interface)

Non-secret vars set in `[vars]`/`[env.*.vars]`: `NODE_ENV`, `API_VERSION`,
`API_BASE_URL`, `CORS_ORIGIN`, `LOG_LEVEL`, `REALTIME_WS_URL`,
`DISCOVERY_EMBEDDING_MODEL`, `DEPLOYMENT_MODE`, `PLATFORM_VERSION`,
`NOTIFICATION_FROM_EMAIL`, `TWILIO_PHONE_NUMBER`, `QUOTA_ENFORCEMENT_MODE`
(production only, `"enforce"`), `MAX_REQUEST_SIZE`, `CACHE_TTL`,
`RATE_LIMIT_REQUESTS` (the latter three are declared as vars but not
consumed by any code found in this codebase's core layer).

Secrets expected via `wrangler secret put` (never in `wrangler.toml`):
`JWT_SECRET`, `REALTIME_JWT_SECRET`, `ENCRYPTION_KEY`, `QR_SIGNING_KEY`,
`RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`SLACK_WEBHOOK_URL`, `CLOUDFLARE_ACCOUNT_ID`,
`SENTRY_DSN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`LINEPAY_WEBHOOK_SECRET`, `MARKET_CHECKOUT_WEBHOOK_SECRET`,
`MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN`,
`MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET`,
`CREDIT_TOPUP_PROVIDER_TOKEN`, `CREDIT_TOPUP_PROVIDER_SIGNING_SECRET`,
`CREDIT_TOPUP_WEBHOOK_SECRET`, `INTERNAL_API_TOKEN`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `UBER_EATS_CLIENT_ID`, `UBER_EATS_CLIENT_SECRET`,
`WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`,
`SENDGRID_API_KEY`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ZONE_ID`,
`CF_STREAM_TOKEN`, `CF_IMAGES_TOKEN`, `LICENSE_KEY` (independent-mode only).

---

## 3. Router mount map (`app-factory.ts`)

All routes are mounted under `apiV1 = new Hono()`, then `app.route("/api/v1",
apiV1)`. Feature internals are covered by other agents; directories are
`apps/api/src/features/<name>`.

### Non-feature / infra routes (mounted directly on `app`, not `apiV1`)

| Method/Path | Handler |
| --- | --- |
| `GET /health` | wrapped in `healthCheckMiddleware()`, then `c.redirect("/api/v1/monitoring/health")` |
| `GET /info` | inline handler — deployment mode, version, feature list, endpoint map — **stale**: omits `/discovery`, `/markets`, `/feedback`, `/billing`, `/manager`, `/audit-logs`, and the singular `/customer` mount, all of which ARE mounted (see §3); do not treat `/info`'s map as authoritative |
| `GET /` | `c.redirect("/info")` |
| `app.route("/", marketsFeature.seoRoutes)` | markets feature's public SEO-facing routes, mounted at the site root (not under `/api/v1`) |

### `/api/v1/*` — public (no global auth middleware) routes, mounted first

| Prefix | Feature dir | Notes |
| --- | --- | --- |
| `/auth` | `features/authentication` | + `verificationFeature.routes` also mounted at `/auth` (password reset, email/phone verification) |
| `/qr` | `features/qr-codes` | |
| `/queue` | `features/queue` | public + protected endpoints inside the feature |
| `/coupons` | `features/coupons` | validation public, admin endpoints gated inside feature |
| `/reservations` | `features/reservations` | public + protected inside |
| `/service-bookings` | `features/service-bookings` | public + protected inside |
| `/waiting-list` | `features/waiting-list` | public + protected inside |
| `/realtime` | `features/realtime/routes` | WebSocket token-exchange auth endpoint is public |
| `/partnerships` | `features/partnerships/routes` | partial public (member/plan validation) |
| `/guest-orders` | `features/guest-orders` | KV-based guest-token auth, not JWT |
| `/market-checkouts` | `features/market-checkouts` | multi-stall guest checkout |
| `/credits` | `features/credits` | balance lookup public/rate-limited, admin gated inside |
| `/integrations` | `features/integrations` | webhooks public w/ HMAC verification; admin routes gated inside |

After these, a **catch-all 404 guard** runs (`apiV1.use("*", ...)`): if no
concrete route pattern in `apiV1.routes` matches `(method, path)` it short-
circuits with `apiV1RouteNotFound()` before falling through to the protected
section below. This dedupes 404s (protected-section middleware would
otherwise still run auth on a nonexistent path) and its route-matching logic
(`routePathToRegex`, `hasConcreteApiRoute`) is a small custom Express-style
path-to-regex cache — worth reproducing carefully in a router with different
matching semantics (e.g. axum).

### Auth/module-gate middleware applied before mounting protected routers

```
optionalAuth        → /restaurants/*, /menu/*             (GET public, writes gated at route level)
staffOrUserCustomerAuthMiddleware → /orders/*              (accepts staff role 0-4 OR customer role 5)
authMiddleware       → /pos/*, /payments/*, /seats/*, /users/*, /analytics/*, /ai-analytics/*,
                        /cache/*, /backup/*, /leaves/*, /scheduling/*, /forecast/*, /ingredients/*,
                        /feedback/*, /notifications/*, /partnerships/* (in addition to its public bits)
authMiddleware (conditional, skip on exact /health path) → /system/*, /monitoring/*
moduleGate("pos")              → /pos/*
moduleGate("online_ordering")  → /payments/*
moduleGate("staff_management") → /leaves/*, /scheduling/*
moduleGate("analytics")        → /forecast/*, /feedback/*
moduleGate("inventory")        → /ingredients/*
```

`/kitchen/*` and `/tables/*` intentionally have **no blanket `apiV1.use`**
auth — each handles auth at the route level (kitchen's `/events` SSE route
needs `sseAuthMiddleware` with a query-param token; tables needs a public QR
lookup route).

### Protected feature mounts (after `usageTracker` + `csrfProtection`, see Section 4)

| Prefix | Feature dir | Notes |
| --- | --- | --- |
| `/restaurants` | `features/restaurants` | |
| `/menu` | `features/menu` | |
| `/kitchen` | `features/kitchen` | |
| `/orders/group` | `features/group-orders` | mounted **before** `/orders` so the more specific prefix wins |
| `/orders` | `features/orders` | |
| `/pos` | `features/pos` | |
| `/payments` | `features/payments` | |
| `/manager` | `features/manager` (`.actionsRoutes`) | delegation-aware action endpoint |
| `/audit-logs` | `features/manager` (`.auditLogsRoutes`) | admin-only audit read path, same feature module, second export |
| `/tables` | `features/tables` | |
| `/seats` | `features/seats` | |
| `/users` | `features/users` | |
| `/analytics` | `features/analytics` | |
| `/ai-analytics` | `features/ai-analytics` | |
| `/sse` | `features/sse` | |
| `/system` | `features/system` | |
| `/cache` | `features/cache` (default export, not `.routes`) | |
| `/monitoring` | `features/monitoring` | |
| `/backup` | `features/backup` (`BackupRoutes` export) | uses **`features/backup/services/BackupService.ts`**, a distinct/more complete implementation from the top-level `apps/api/src/services/BackupService.ts` — see Section 5 |
| `/customer` | `features/customer/routes` | singular — canonical customer-facing auth/profile |
| `/customers` | `features/customers/routes` | plural — staff-side customer management |
| `/leaves` | `features/leaves` | |
| `/scheduling` | `features/scheduling` | |
| `/forecast` | `features/forecast` | |
| `/ingredients` | `features/ingredients` | |
| `/discovery` | `features/discovery` | |
| `/markets` | `features/markets` (`.routes`) | |
| `/feedback` | `features/feedback` | |
| `/billing` | `features/billing` | |
| `/me` | `features/me` | |
| `/notifications` | `features/notifications/routes` | |
| `/push` | `features/push/routes` | |
| `/audit` | `features/audit/routes` | |

### Admin-only mounts (after `apiV1.use("/admin/*", authMiddleware)`; role=0 enforced inside each feature)

| Prefix | Feature dir |
| --- | --- |
| `/admin` | `features/admin-settings/routes` |
| `/admin/markets` | `features/markets` (`.adminRoutes`) |
| `/admin/subscriptions` | `features/subscriptions` (`.routes`) |

`features/subscriptions` is otherwise **not** mounted at any public prefix —
its only entrypoint is `/admin/subscriptions`.

---

## 4. Middleware pipeline

Order matters; this is the exact sequence applied globally in
`createApp()` in `apps/api/src/app-factory.ts`, followed by the `apiV1`-scoped
middlewares applied when the router tree is built.

### Global (`app.use("*", ...)`, in file order)

1. **`requestIdMiddleware`** (`middleware/security.ts`) — generates
   `crypto.randomUUID()`, sets `c.set("requestId", ...)`, header
   `X-Request-ID`, and `c.set("requestTimestamp", ISOString)`.
2. **`geoIntelligentRateLimitMiddleware`** (`middleware/geo-rate-limiting.ts`)
   — see dedicated subsection below. Configured in `app-factory.ts` with
   `skipPaths: ["/health", "/info", "/api/v1/sse/events"]` and a large
   `customLimits` map keyed by exact path (auth/register/refresh/realtime
   token/admin/system/orders/guest-orders/integrations webhooks/payments),
   each `{requests, windowSeconds, burstMultiplier, blockDuration}`.
3. **`securityMonitoringMiddleware`** (`middleware/security.ts`) — detects
   path-traversal/attack-pattern regexes and oversized User-Agent strings;
   logs a structured `[SECURITY]` line when any detected, or when the final
   status is 401/403. Non-blocking (never rejects the request itself).
4. **`corsMiddleware`** (`middleware/cors.ts`) — computes allowed origins via
   `buildAllowedOrigins(env)` (production: `CORS_ORIGIN` env var,
   comma-separated; dev: hardcoded localhost ports 3000-3005/5173/8000/8787
   plus `DEV_CORS_ORIGINS`). Sets `Access-Control-Allow-Origin` only if the
   request `Origin` is in the allow-list (otherwise silently omits the
   header and logs a warning — it does not reject). Always sets a large
   fixed set of security headers (`X-Content-Type-Options`,
   `X-Frame-Options: DENY`, CSP, HSTS, `Permissions-Policy`, etc.) on every
   response including preflight, and short-circuits `OPTIONS` requests with a
   bare `204` (headers only, no body).
5. **`securityHeadersMiddleware`** (`middleware/security.ts`) — runs `await
   next()` first, then (only if `status < 400`) sets a second, slightly
   different set of security headers + its own CSP (this duplicates most of
   step 4's headers; the CORS middleware's headers are set unconditionally
   pre-`next()`, this one only post-`next()` and only on success — a Rust
   reimplementation should decide once whether to keep both layers or
   consolidate).
6. **`inputSanitizationMiddleware`** (`middleware/security.ts`) — currently a
   **no-op** (`await next()` only); the sanitization logic referenced in
   comments elsewhere does not exist in this file. Do not assume any actual
   input mutation happens here.
7. **`advancedAnalyticsMiddleware()`** (`middleware/analytics.ts`) — only if
   `!options.disableObservability`. Wraps request in `AdvancedAnalyticsService`,
   stored as `c.set("analytics", ...)`; after `next()`, unconditionally
   records an `api_request` Analytics Engine data point (via
   `executionCtx.waitUntil`, so it never blocks the response), plus
   conditional `performance_metrics` (slow requests / 5xx) and
   `security_event` (threat score > 50, or 401/403) data points. Writes to
   `env.ANALYTICS_ENGINE ?? env.ANALYTICS`.
8. **`smartCacheMiddleware(...)`** (`middleware/edge-cache.ts`) — only if
   `!options.disableEdgeCache`. Two-tier (Cache API + KV) GET-response cache.
   Cache lookups are skipped whenever the request carries an `Authorization`
   header (so all authenticated traffic always executes the handler).
   `cacheTags` derives tags from path/restaurantId; `shouldCache` excludes
   `/auth/`, `/sse/`, paths ending `/events`, and `/payments/`. On successful
   mutating methods (POST/PUT/DELETE/PATCH, 2xx), synchronously invalidates
   a small fixed set of known GET cache keys for menu/coupons/restaurants
   (both KV delete and Cache API delete, keyed identically to how `set()`
   built them — `https://cache.makanmakan.app/<key>`).
9. **`cacheWarmingMiddleware()`** (`middleware/edge-cache.ts`) — only if
   edge cache enabled. Fires a best-effort preload job (via
   `env.PRELOAD_QUEUE?.send`, which is unbound/no-op in this deployment —
   see Section 2) when the path matches `/menu/:restaurantId`.
10. **`logger()`** (Hono built-in).
11. **`timing()`** (Hono built-in, `Server-Timing` header).
12. **`prettyJSON()`** (Hono built-in).
13. **`metricsMiddleware()`** (`middleware/monitoring.ts`) — only if
    observability enabled. Wraps `next()` in try/catch/finally; records
    `api_request`/errors through a `MonitoringServiceInterface` created by
    `features/monitoring`'s `createMonitoringService(env.CACHE_KV)`. Adds
    `X-Response-Time` and a **second, independently-generated**
    `X-Request-ID` header (`req_<ts>_<rand>` format — distinct from step 1's
    UUID; last header set wins on the wire).
14. **`errorMonitoringMiddleware()`** (`middleware/monitoring.ts`) — only if
    observability enabled. Catches, classifies severity by status/message
    keywords, records via the monitoring service, then **rethrows** so the
    global `app.onError` handler still runs.
15. **`monitoringStatsMiddleware()`** (`middleware/monitoring.ts`) — only if
    observability enabled. Development-only (`NODE_ENV === "development"`):
    appends `X-Monitoring-*` debug headers after `next()`.
16. **`tenantContextMiddleware`** (`middleware/tenantContext.ts`) — resolves
    `DEPLOYMENT_MODE` (`"saas"` default or `"independent"`). Independent mode
    requires `env.TENANT_ID` (500 `TENANT_NOT_CONFIGURED` if missing) and
    sets `enforceSingleTenant: true`; SaaS mode derives `tenantId` from
    `c.get("user")?.restaurantId` (so it must run **after** any auth
    middleware that has already populated `user` on this request — note this
    global middleware runs before the route-level `authMiddleware` calls
    applied later on `apiV1`, so at this point `user` is usually still unset
    for most requests; tenant context effectively degenerates to
    `tenantId: null` here and is really only meaningful downstream once
    per-route auth has run and any code re-derives tenant/user together).

### Error handling (`app.onError`, registered once, applies globally)

Single formatter for every thrown error:
- If `err instanceof ApiError` (from `@makanmasak/utils`, re-exported via
  `shared/utils/api-error.ts`): responds
  `{success:false, error:{code, message: ErrorSanitizer.sanitizeMessage(err.message), details?: sanitizeApiErrorDetails(err.details)}}`
  at `err.status`, clamped through `toErrorResponseStatusCode` to a known
  HTTP error code set (falls back to 500 for anything unrecognized, e.g. 2xx
  accidentally thrown as an error).
- Otherwise: passes the raw error through `ErrorSanitizer.sanitizeError(err)`
  (`apps/api/src/utils/errorSanitizer.ts`), which pattern-matches on
  `err.name`/`err.message` substrings (JWT/token → `authentication`; Zod →
  `validation`; SQLITE/constraint → `server_error` "database"; timeout →
  `server_error`; permission/forbidden → `authorization`; rate limit →
  `rate_limit`; not found → `not_found`; else generic) and maps that type to
  a status via a fixed `STATUS_MAP` (`validation:400, authentication:401,
  authorization:403, not_found:404, rate_limit:429, server_error:500`,
  default 500). `ErrorSanitizer.sanitizeMessage` additionally redacts
  connection strings, API keys/tokens/JWTs, file paths, internal IPs, stack
  traces, passwords, emails, and `*.workers.dev`/`*.cloudflareworkers.com`
  URLs via regex, and truncates to 200 chars.
- `app.notFound` (registered separately) returns
  `{success:false, error:{code:"ROUTE_NOT_FOUND", message:"API endpoint not
  found: <METHOD> <path>"}}` at 404 — same shape as the `apiV1`-scoped 404
  guard in Section 3.

**`ApiError` factories** (`packages/utils/src/api-error.ts`, re-exported
through `apps/api/src/shared/utils/api-error.ts`):
`notFound(message?, code?)` → 404, `badRequest(message?, code?, details?)` →
400, `unauthorized(message?, code?)` → 401, `forbidden(message?, code?)` →
403, `conflict(message?, code?)` → 409. `ApiError` itself takes
`(code, message, status=500, details?)`. `sanitizeApiErrorDetails` deep-walks
`details`, redacting any object key matching
`/password|passcode|token|secret|authorization|cookie|api[-_]?key|key/i`,
capping recursion depth at 5 and arrays at 50 items, and detecting circular
references.

### `apiV1`-scoped middleware (see Section 3 for exact prefixes)

Applied in this order once `apiV1` starts being built:
1. `attachCSRFToken()` on `/auth/*` (post-`next()`: only on `status===200`
   and path containing `/auth/`, generates + stores a CSRF token in KV and
   sets it both as `X-CSRF-Token` response header and a `Set-Cookie`).
2. Public feature routes mounted (Section 3).
3. The custom 404 guard (Section 3).
4. Per-prefix `optionalAuth` / `staffOrUserCustomerAuthMiddleware` /
   `authMiddleware` / `moduleGate(...)` combinations (Section 3).
5. **`usageTracker`** (`middleware/usageTracker.ts`) — applied to `*`.
   Wraps `next()` in try/finally; unless the path is excluded
   (`/api/v1/auth`, `/api/v1/discovery`, `/api/v1/qr`, `/api/v1/webhooks`,
   `/api/v1/integrations/webhooks` prefixes, or exact paths `/`, `/health`,
   `/info`, `/api/v1/me/modules`, `/api/v1/monitoring/health`, or method
   `OPTIONS`), emits a `meterEmit(c, "api.requests", {metadata:{method,
   path, status}})` usage event (fire-and-forget insert into
   `usage_events` table via `waitUntil` when `executionCtx` is available).
6. **`csrfProtection({excludePaths: [...]})`** (`middleware/csrf.ts`) —
   applied to `*`. Protects `POST/PUT/DELETE/PATCH` only; skips a long
   explicit `excludePaths` list (login/register, customer auth, monitoring
   health, SSE, public queue/QR-scan/coupon-validate/partnerships
   verify-endpoints, guest-orders, realtime auth, integrations/billing
   webhooks, payments). Two defense layers: (1) Origin/Referer must match
   `Host` or be in `buildAllowedOrigins(env)` (same allow-list as CORS); (2)
   double-submit cookie: `X-CSRF-Token` header must be 64 lowercase-hex
   chars and must equal the `__Host-mm_csrf` (or legacy `csrf_token`) cookie
   value. Both layers fail with 403 and a **non-unified** error shape
   (`{success:false, error: "<string>", message: "<string>"}` — note `error`
   is a bare string here, not `{code,message}`; this is an inconsistency
   with the global error envelope worth normalizing in a Rust rewrite).
7. Protected/admin feature routes mounted (Section 3).

### Auth middleware family (`middleware/auth.ts`) — JWT format & claims

JWTs are HS256, verified with `jsonwebtoken.verify(token, JWT_SECRET,
{algorithms:["HS256"], ...DEFER_TIME_CLAIM_VALIDATION})` where
`DEFER_TIME_CLAIM_VALIDATION = {ignoreExpiration:true, ignoreNotBefore:true}`
— i.e. the library's own exp/nbf checks are disabled so the code can run its
own checks and produce specific error codes (`TOKEN_EXPIRED` vs
`TOKEN_INVALID` vs `TOKEN_FUTURE`) rather than a generic library exception.

**Staff/admin token payload** (`AuthTokenPayload`): `sub` (required — must
match `UUID_V7_PATTERN` = `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`),
`username` (non-empty string), `role` (number), `exp` (number, required),
optional `iat`, `nbf`, `tv` (token version), `restaurantId` (string | number
| null). Validation performed by `createAuthMiddleware(maxRole)`:
1. `Authorization: Bearer <token>` header required.
2. `JWT_SECRET` must be set and ≥32 chars, else 500 `SERVER_CONFIG_ERROR`.
3. Token blacklist check via `TOKEN_BLACKLIST` KV (`token:<token>` key) if bound.
4. Verify signature (time claims deferred).
5. Payload shape-check (`isAuthTokenPayload`).
6. `exp <= now` → `TOKEN_EXPIRED`.
7. `iat > now + 60` → `TOKEN_FUTURE` (clock-skew tolerance of 60s).
8. `nbf > now + 60` → `TOKEN_INVALID`.
9. `role` must be in `[0, maxRole]` — **`maxRole=4`** for `authMiddleware`
   (staff/admin only; rejects role 5/customer tokens), **`maxRole=5`** for
   `customerAuthMiddleware`/`staffOrUserCustomerAuthMiddleware` (accepts
   customer tokens too, used on `/orders/*`).
10. `MAX_ACCESS_TOKEN_AGE_SECONDS = 72 * 60 * 60` (72h) — `now - iat` beyond
    this forces re-login (`TOKEN_EXPIRED`) even if `exp` itself hasn't
    lapsed yet (defense against very long-lived tokens).
11. Loads the live user row via `resolveStaffPrincipal(db, sub, {requireActive:false})`
    (`shared/services/staff-principal.ts`, a straight `SELECT id, username,
    role, restaurant_id, is_active, token_version FROM users WHERE id = ?`).
    If not found: rejected with `USER_INACTIVE` in **every** environment when
    the token carried a `sub`; the non-production leniency applies only to
    tokens with no `sub` at all (legacy dev fallback,
    `middleware/auth.ts:234-241`).
    If found: `tokenVersion` in the JWT must equal `users.token_version`
    (else `TOKEN_INVALIDATED` — this is the server-side "logout everywhere"
    / password-change invalidation mechanism), `is_active` must be truthy,
    and `username`/`role` in the JWT must match the DB row exactly (else
    `TOKEN_INVALID` — catches stale claims after a role change).
12. If `exp - now < 3600` (< 1h remaining), sets response headers
    `X-Token-Refresh-Recommended: true` and `X-Token-Expires-In: <seconds>`
    as a soft hint to the client to refresh.
13. Sets `c.set("user", {id, publicId, username, role, restaurantId})`.

**Customer token payload** (`CustomerAuthTokenPayload`): `{sub: customers.id,
type:"customer", exp, iat?, nbf?}` — a **structurally different, simpler**
shape from the staff payload (no `role`/`username`/UUID-v7 `sub` requirement).
`canonicalCustomerAuthMiddleware` verifies this shape specifically, loads the
customer row (`SELECT ... FROM customers WHERE id = ? AND status = 'active'`),
and on success **also writes** `last_seen_at_ms`/`updated_at_ms` back to the
row as a side effect of every authenticated request — a write-on-read
pattern to replicate carefully (don't skip it, but consider batching/rate-
limiting it in Rust to avoid a DB write per request).
`optionalCanonicalCustomerAuthMiddleware` is the same logic but always calls
`next()` regardless of outcome — used for endpoints that work for both
anonymous and authenticated customers.

**SSE auth** (`sseAuthMiddleware`): accepts either a normal `Bearer` header
**or** (when no header) a `?sseToken=` query param, because
`EventSource` cannot set custom headers. When falling back to the query
param, the token must additionally satisfy `isSseAuthTokenPayload` — i.e.
carry `purpose:"kitchen_sse"` and `aud:"kitchen_sse"` claims — a scoped token
type distinct from the general staff JWT, presumably minted specifically for
SSE connections.

**Role model** (`shared/constants/index.ts` `USER_ROLES`, mirrors
`packages/shared-types`): `0=ADMIN, 1=OWNER(店主), 2=CHEF(廚師),
3=SERVICE(送菜員), 4=CASHIER(收銀), 5=CUSTOMER`. `requireRole(allowedRoles:
number[])` and `requireRestaurantAccess(param?)` (admin bypasses; others
must own the exact `restaurantId` route param) are route-level helper
middlewares layered on top of the base auth middlewares.

`blacklistToken(c, token, expiryTime?)` writes `token:<token>` → `"blacklisted"`
into `TOKEN_BLACKLIST` with a TTL derived from the token's remaining lifetime
(used on logout/password-change flows elsewhere in feature code).

### Rate limiting — three parallel implementations (only one wired globally)

1. **`geoIntelligentRateLimitMiddleware`** (`middleware/geo-rate-limiting.ts`)
   — the one actually applied globally (see step 2 above).
   - Skips entirely when `NODE_ENV` is `"development"` or `"test"` (so local
     dev and CI integration runs never trip it).
   - Builds a per-request `RateLimitConfig` (`requests, windowSeconds,
     burstMultiplier, blockDuration`) from a risk model: base config by
     endpoint category (`/auth/` strictest, `/admin/`+`/system/` strict,
     order-POST medium, `/menu/` lenient, else default), multiplied by geo
     risk (`HIGH_RISK_COUNTRIES` set — CN/RU/KP/IR/SY/AF/MM/BY/CU/VE — and
     `CF-Threat-Score` header thresholds), ASN reputation (`BOT_ASNS` /
     `TRUSTED_ASNS` fixed lists), authenticated user role (admin/owner get
     more headroom), and endpoint-specific risk. Route-specific
     `customLimits` passed in from `app-factory.ts` (keyed by exact path,
     see Section 4 intro) are applied last via `Object.assign`, overriding
     the computed values.
   - Identifier: `user:<id>` if authenticated, else `ip:<CF-Connecting-IP>`.
   - Two enforcement backends selectable per-request:
     `env.GLOBAL_RATE_LIMITER` (Cloudflare's native binding, used for most
     traffic in production) vs a **KV-based sliding-window** implementation
     (`SENSITIVE_KV_RATE_LIMIT_PATHS`: `/auth/login`, `/auth/register`,
     `/customers/otp`, `/customer/otp`, `/realtime/auth/guest-token` — these
     always use the KV path regardless of whether the native limiter is
     bound, plus KV is the fallback whenever `GLOBAL_RATE_LIMITER` isn't
     configured at all, e.g. dev/staging).
   - KV path: `isBlocked()` checks a persisted `block:<id>` record first
     (fast-reject 429 if still blocked); then `applyRateLimit()` sums
     per-second counters over the sliding window
     (`rate:<id>:<unixSecond>` keys) against `burstLimit = ceil(requests *
     burstMultiplier)`; on violation, `blockIdentifier()` computes an
     **escalating** block duration (`baseDuration * 2^(escalationLevel-1)`,
     capped at 32x, escalation counter persisted 24h) and — for
     `escalationLevel >= 3` — fires a Slack alert via `env.SLACK_WEBHOOK_URL`
     (through `executionCtx.waitUntil`, non-blocking).
   - On any KV/native error, **fails open** (allows the request) — a
     deliberate availability-over-strictness tradeoff to note for the Rust
     port.
   - Sets `X-RateLimit-Limit/Remaining/Reset` (and `Retry-After` when
     blocked) on every response.
2. **`middleware/rateLimit.ts`** (`rateLimitMiddleware`, IP-keyed, KV-window,
   **fails closed** — 503 if `CACHE_KV` missing — the opposite failure mode
   from #1) and **`middleware/rateLimiter.ts`** (`RateLimiter` class +
   `rateLimitMiddleware`, tenant/user-scoped-or-IP-keyed, exposes reusable
   `RateLimitPresets` for password-reset/email-verify/SMS-OTP/login/general)
   are both defined but **not wired into the global middleware chain** in
   `app-factory.ts` — they exist as opt-in helpers feature routes can import
   directly (e.g. verification/auth feature routes likely use the presets).
   Do not assume either runs on every request; check feature-level route
   files if a specific endpoint's behavior needs exact reproduction.

### Module gate (`middleware/moduleGate.ts`)

Per-restaurant SaaS feature gating keyed on a `ModuleKey` (`pos`,
`online_ordering`, `staff_management`, `analytics`, `inventory`, etc. — see
`@makanmasak/database` `ModuleKey`/`PLAN_DEFAULT_MODULES`). Admin (`role===0`)
always bypasses. For everyone else: reads `shop_subscriptions` row (5-minute
KV cache, key `subscription:<restaurantId>`, write-through on miss),
resolves effective module state as `moduleOverrides[module] ?? 
PLAN_DEFAULT_MODULES[planTier][module] ?? false`, additionally short-circuits
to `false` if `planTier==="trial"` and `trialEndsAt` has passed. Throws
`forbidden("Subscription not found...", "SUBSCRIPTION_NOT_FOUND")` if no
subscription row exists at all, or `forbidden(..., "TRIAL_EXPIRED" |
"MODULE_NOT_ENABLED")` otherwise. `invalidateSubscriptionCache(c,
restaurantId)` must be called by any admin code path that mutates
subscriptions.

### Quota gate (`middleware/quotaGate.ts`)

Separate from module gating: enforces **usage quotas** (`MeterKey` /
`PLAN_QUOTAS`, e.g. request counts) per billing cycle. Controlled globally by
`env.QUOTA_ENFORCEMENT_MODE` (`"disabled"` default, `"warn"`, or `"enforce"`
— production sets `"enforce"`). Admin bypasses. Resolves the billing cycle
window from `shop_subscriptions` (trial: `created_at_ms` → `trial_ends_at_ms`
or +14 days; paid: `billing_cycle_start/end_at_ms`; fallback: calendar
month). Effective count = aggregated `usage_meters.total_quantity` (30s KV
cache) **plus** any not-yet-aggregated `usage_events` rows for the same
cycle (so quota enforcement is accurate even between 5-minute aggregation
cron runs). At/above `quota.hard`: sets `X-Quota-Warning` header, sends a
(fire-and-forget, deduped by `dedupKey`) Slack notification via
`BillingNotificationService`, and — only in `"enforce"` mode — throws
`quotaExceeded()` → `ApiError("QUOTA_EXCEEDED", ..., 429, {meterKey,
hardLimit, current})`. At/above `quota.soft` (below hard): just sets the
warning header. **Not applied as global `apiV1.use` middleware** — invoked
ad hoc via `quotaGate(meterKey)` or the exported `enforceQuota()` helper from
inside individual feature routes.

### Validation (`middleware/validation.ts`, the one actually re-exported by `shared/middleware/index.ts`)

`validateBody(schema)` / `validateQuery(schema)` / `validateParams(schema)`
are Zod-based `createMiddleware` factories. On `ZodError`, throws
`badRequest("Validation failed", "VALIDATION_ERROR", details)` where
`details` is `[{field: "a.b.c", message, code}]` (dot-joined path). On any
other parse failure (e.g. invalid JSON body), throws a generic
`badRequest("Invalid JSON body"|"Invalid query parameters"|"Invalid path
parameters", "INVALID_JSON"|"INVALID_QUERY"|"INVALID_PARAMS")`. Validated
output is stored on context as `validatedBody`/`validatedQuery`/
`validatedParams`, typed via Hono generics (`z.infer<T>`).
`validateBody` reads the body through `c.req.raw.clone()` and hands an
absent or empty body to the schema as `{}`, so the schema — not the JSON
parse — decides whether a body was required (#355); a body that is present
but unparseable is still `INVALID_JSON`. `validateOptionalBody` is an alias
of `validateBody` kept for existing call sites.
The unused duplicate at `shared/middleware/validation.ts` was deleted with
that change; the canonical implementation is `middleware/validation.ts`.

### Idempotency (`middleware/idempotency.ts`)

Not globally applied — an opt-in `idempotencyMiddleware({scope, ttlSeconds?,
requireKey?, keyResolver?, effectId?})` factory used by specific mutating
routes (payments, market-checkouts, etc.). Requires (by default) an
`Idempotency-Key` header (or a custom `keyResolver`). Persists to an
`idempotency_keys` D1 table: `(key, scope, request_hash, response_status,
response_body, effect_id, created_at, expires_at)`. Flow: hash the raw body
(SHA-256 hex); look up existing row; if expired, delete and proceed fresh;
if same scope+hash and already has a stored response, **replay** it verbatim
(marking the JSON payload with `duplicateEffects:0` and header
`X-Idempotent-Replay: true`); if same key but different scope/hash, reject
422 (`IDEMPOTENCY_SCOPE_MISMATCH`/`IDEMPOTENCY_BODY_MISMATCH`); if in-flight
(no response yet), reject 409 `IDEMPOTENCY_IN_PROGRESS`. Otherwise
`INSERT OR IGNORE` to reserve the key (race-safe — re-reads on a losing
insert to apply the same replay/conflict logic), runs the handler, then
writes back `response_status`/`response_body`/`effect_id` after the fact.
Default TTL 24h.

### CSRF (`middleware/csrf.ts`) — see also `apiV1`-scoped section above

Double-submit-cookie pattern. Cookie name `__Host-mm_csrf` (falls back to
reading legacy `csrf_token` for back-compat), 32 random bytes hex-encoded (64
chars), 1h expiry, `Secure; HttpOnly; SameSite=Lax; Path=/`.
`generateCSRFTokenHandler` and `attachCSRFToken()` are the two ways a token
gets minted/delivered (KV-backed record `csrf:<token>` also written whenever
`CACHE_KV` is present, though the double-submit check itself doesn't
actually consult that KV record — it only compares cookie vs header; the KV
store is used by the alternate non-double-submit mode which isn't currently
selected anywhere, `useDoubleSubmit` defaults `true` and nothing overrides
it).

### Guest token auth (`middleware/guestAuth.ts`) — not globally wired

`guestTokenAuth`/`guestSessionAuth` validate `Bearer gt_<64-hex>` tokens
stored in `CACHE_KV` under `guest_token:<token>` (4h TTL, per the file
header comment — TTL itself is set by whatever code calls
`env.CACHE_KV.put`, not shown in this file). `guestTokenAuth` additionally
requires the token's `orderId` to match the route's `:id` param (403
otherwise); `guestSessionAuth` has no such requirement (used for the
guest-order-creation flow before an order exists). `generateGuestToken()` —
`crypto.getRandomValues(32 bytes)` → hex, prefixed `gt_`.

### Cache middleware family (`middleware/cache.ts`) — not globally wired

`cacheMiddleware(options)` (route-level decorator wrapping
`features/cache/services/CacheService`), plus ready-made
`menuCache/restaurantCache/analyticsCache/tableCache` decorators and
`invalidate*Cache` post-mutation invalidators. Distinct from (and simpler
than) the globally-applied `smartCacheMiddleware` in `middleware/edge-cache.ts`
— two independent caching subsystems exist in this codebase; a Rust rewrite
should pick one model rather than porting both.

---

## 5. Shared services & utils

### `apps/api/src/shared/` (cross-feature shared code)

- **`shared/utils/api-error.ts`** — thin re-export of `@makanmasak/utils`'s
  `ApiError`/factories (Section 4). The actual implementation lives in
  `packages/utils/src/api-error.ts`.
- **`shared/utils/response.ts`** — `createSuccessResponse(data, message?,
  meta?)` → `{success:true, data, message, timestamp, meta?}`;
  `createErrorResponse(message, code?)` → `{success:false, error:{code,
  message}}` (numeric codes become `HTTP_<code>`); `createPaginatedResponse`.
  Legacy helpers — most routes construct the envelope inline rather than
  via these, but they define the canonical success shape (note it includes
  a `timestamp` field the error path does not).
- **`shared/utils/meter.ts`** — `meterEmit(c, meterKey, {restaurantId?,
  quantity?, metadata?})`: resolves the effective restaurant (explicit
  option → tenant context → user's restaurant; for admin users (role 0) only the user's-restaurant fallback is skipped — the tenant-context fallback still applies if set (`meter.ts:57-62`) — for admin
  users with no explicit restaurant) and inserts one row into `usage_events`
  (`id, restaurant_id, meter_key, quantity, metadata`), fire-and-forget via
  `waitUntil` when available. Backs both `usageTracker` middleware and any
  feature code that wants to record custom usage.
- **`shared/utils/money.ts`** — `toCents`/`toRequiredCents`/`fromCents`
  (simple `Math.round(amount*100)` / `/100`) and `percentageFromBps` (basis
  points → percentage, `/100`). Throws on non-finite input.
- **`shared/utils/url.ts`** — `httpUrlSchema`, a Zod schema requiring a
  syntactically valid URL whose protocol is `http:` or `https:`.
- **`shared/utils/health-monitor.ts`** — `SystemHealthMonitor` class,
  produces a `HealthStatus` (`healthy|degraded|unhealthy`) from sub-checks
  (`system` = process memory heuristic, `database` = **simulated** 10ms
  sleep, not a real query, `cache`/`storage`/`notifications` = best-effort
  KV/R2/webhook presence checks, `features` = static hardcoded "healthy" map
  for auth/menu/orders/queue/sse/analytics/system). This is a
  **process-local, non-authoritative** health monitor — it does not track
  real request counts across invocations (`recordRequest`/
  `getPerformanceMetrics` reset per Worker isolate) and its DB check is a
  no-op sleep, not a real `SELECT 1`. The feature-level `/system/health` and
  `/monitoring/health` endpoints likely use a different/better
  implementation; don't treat this file as ground truth for actual health
  semantics.
- **`shared/services/staff-principal.ts`** — `resolveStaffPrincipal(db,
  identifier, {requireActive?})`: the canonical staff-lookup used by
  `middleware/auth.ts`. Requires the identifier to match the UUID-v7 pattern
  (throws `STAFF_PRINCIPAL_INVALID` 400 otherwise), does a single `users`
  table lookup by `id`, throws `STAFF_PRINCIPAL_NOT_FOUND` (404) if absent,
  `STAFF_PRINCIPAL_INACTIVE` (403) if `requireActive` and `is_active` is
  falsy.
- **`shared/services/order-identity.ts`** — `resolveOrderIdentity(db,
  identifier, {restaurantId?, requireRestaurantForAliases?})`: resolves an
  order by `id` OR `order_number` OR `client_mutation_id` (supports
  human-friendly order aliases in addition to the UUID PK), scoped to
  `restaurantId` when provided/required (400 `RESTAURANT_ID_REQUIRED` if a
  restaurant-scoped lookup is required but no restaurantId given), throws
  `ORDER_NOT_FOUND` (404) otherwise.
- **`shared/constants/index.ts`** — `HTTP_STATUS` map, `USER_ROLES` (0-5,
  see Section 4), `VALIDATION_LIMITS`, `CACHE_TTL` (300/1800/3600s),
  `FEATURE_MODULES` name constants.
- **`shared/middleware/index.ts`** — pure re-export barrel
  (`middleware/auth.ts` + `middleware/validation.ts`); not itself an
  implementation.

### `apps/api/src/utils/errorSanitizer.ts`

`ErrorSanitizer` class — see Section 4's error-handler writeup for its full
behavior (`sanitizeMessage`, `sanitizeError`, `logAndSanitize`,
`isClientSafeError`). This is the **only** consumer-facing sanitizer wired
into the global `app.onError`; `sanitizeApiErrorDetails` (from
`packages/utils`) is a separate, `ApiError.details`-specific sanitizer used
alongside it.

### `apps/api/src/services/` (top-level, non-feature services)

- **`AlertService.ts`** — `AlertService` fans out to zero or more
  `AlertChannel`s configured from env: `SlackAlertChannel` (if
  `SLACK_WEBHOOK_URL` set — posts a formatted attachment with severity
  color/emoji) and `EmailAlertChannel` (if `ALERT_EMAIL_TO` set — sends via
  **MailChannels** `https://api.mailchannels.net/tx/v1/send`, HTML email).
  `sendAlert(alert)` runs all channels via `Promise.allSettled` (one
  channel's failure doesn't block another). Convenience wrappers:
  `rateLimitExceeded`, `suspiciousActivity`, `passwordResetAttempt`,
  `multipleFailedLogins`, `systemError` (used by the global `scheduled`
  handler's catch-all and by `cleanup-tokens.ts`), `databaseConnectionError`.
  This is the primary Slack/email integration point in the core layer.
- **`BackupService.ts`** (top-level) — **only consumed by the standalone
  `apps/backup-scheduler` Worker** (via `workers/backup-scheduler.ts`), NOT
  by the mounted `/api/v1/backup` feature routes (those use the separate,
  more fully-implemented `features/backup/services/BackupService.ts`).
  Constructor takes `(db, storage: R2Bucket, kv)`. Key methods:
  `createBackup`/`executeBackup` (extracts named tables — allow-listed via
  `BACKUP_TABLE_NAMES` set: orders, order_items, menu_items, categories,
  tables, users, restaurants, audit_logs, sessions, qr_codes, images —
  serializes to JSON, uploads to R2 at
  `backups/<restaurantId>/<date>/<backupId>.json`, SHA-256 checksums),
  `listBackups` (raw SQL against a `backups` table with dynamic
  WHERE/ORDER/LIMIT built from query params — **not** parameterized column
  names since sort column is validated against `BACKUP_SORT_COLUMNS`
  allow-list first, so this is safe, but note it queries a `backups` table
  name that doesn't match the `backup_records` Drizzle table used in
  `getSystemHealth`; these appear to be two different underlying tables —
  flag for verification against the live schema before porting),
  `restoreBackup` (requires the literal confirmation phrase `"I understand
  the risks"`), `getSystemHealth()` (Drizzle-based: counts running/failed
  backups over configurable windows, success-rate thresholds — `critical`
  at >10 failures/24h or <50% success rate with ≥5 samples, `warning` at >5
  failures/24h or >20 concurrent or <80% success — returns a
  `BackupSystemHealthReport`), `createAlert()` (writes to `backup_alerts`
  table for restaurant-scoped alerts, or `system_alerts` for
  system-wide/`"system"`-restaurant alerts — a DB trigger apparently
  requires `backup_alerts.restaurant_id` to reference a real row, hence the
  split). Several methods (`saveBackupRecord`, `updateBackupRecord`,
  `getRestaurantMetrics`, `getRestaurantAlerts`, `createAuditLog`,
  `saveRestoreOperation`, `executeRestore`) are **stubs that only
  `console.log`** — not implemented. Do not port this file's stub behavior
  as if it were real persistence; flag these methods explicitly if
  reproducing this exact service (the `features/backup` version is likely
  the one to actually port for production backup behavior).
- **`LicenseService.ts`** — validates `MKM-{STD|PRO|ENT}-{6 alphanumeric}-
  {4 alphanumeric}` license keys for **independent-mode** deployments only
  (SaaS mode always returns `{valid:true, mode:"saas"}` immediately).
  Caches result in `CACHE_KV` (`license:<tenantId>`, 1h success / 5min
  failure TTL) and falls back to an **offline validation** path (format
  check + a last-known-valid KV flag with 24h TTL) whenever
  `CENTRAL_API_URL` is unset or the central API call fails/errors — a grace
  period design so independent deployments keep working through network
  blips. **This service is not imported or invoked anywhere else in
  `apps/api`'s source tree** (confirmed via repo-wide grep) — it is
  dead/unwired code as of this audit; `apps/management-api` has its own
  separate license-validation routes. Flag before porting: verify with the
  team whether independent-deployment licensing is still a planned feature
  before spending Rust-port effort on it.
- **`qrCodeService.ts`** (top-level `QRCodeService`) — generates QR codes
  via external third-party services (`api.qrserver.com` for simple
  styles, `quickchart.io` for anything needing logo/gradient/border/shadow
  — the "advanced" path is a stub that just builds a QuickChart URL without
  actually applying the custom styling parameters it computed). Delegates
  persistence to `@makanmasak/database`'s `QRCodeService` (a **different**
  class of the same name — confusing to keep both names in Rust; rename
  one). **This top-level file is not imported anywhere in the current
  codebase** (confirmed via repo-wide grep) — `features/qr-codes` has its
  own separate `QrCodesService.ts` that is what's actually mounted at
  `/api/v1/qr`. Treat this file as dead code for porting purposes unless
  the team confirms otherwise.
- **`managementTenantClient.ts`** — `ManagementTenantClient`, the one
  actively-used cross-Worker client in this list. Calls the
  `MANAGEMENT_API` service binding (in-process `Fetcher`, no real network
  hop) with a synthetic `https://management.internal/...` URL and header
  `X-Internal-API-Token: <INTERNAL_API_TOKEN>`. Two methods:
  `provisionRestaurantTenant` (`POST
  /api/v1/internal/platform-restaurants/:id/tenant`) and
  `linkRestaurantOwner` (`PATCH .../owner`). Used by
  `features/restaurants/services/RestaurantsService.ts` and
  `features/users/services/UsersService.ts` to keep the management-api's
  tenant registry in sync when restaurants/owners are created in this
  Worker. Response parsing supports both the current nested
  `{success,data,error:{message}}` shape and a legacy flat-string `error`
  shape (with a TODO to drop the legacy branch once all deployed
  management-api instances are past a specific commit).

### `apps/api/src/core/` — generic infra helpers, mostly thin/legacy wrappers

- **`core/database/index.ts`** — re-exports `createDatabase` from
  `@makanmasak/database`; `getDatabaseConnection(env)` convenience wrapper.
  `DatabaseOperations` interface is declared but has no implementation found
  wired to it — appears aspirational/unused.
- **`core/cache/index.ts`** — `KVCacheService` (thin `get`/`set`/`delete`/
  `clear` over a `KVNamespace`, with batched-parallel delete for `clear(prefix)`,
  100 keys/batch) and `NoopCacheService` (always-miss fallback). `cacheKeys`
  namespaced key-builders (`user`, `restaurant`, `menu`, `order`, `qrCode`,
  etc.) — a **third**, smaller cache-key convention alongside
  `middleware/cache.ts`'s `CacheKeys` and `middleware/edge-cache.ts`'s
  ad hoc string building; not obviously all consumed consistently.
- **`core/cache/resilience.ts`** — `ResilientKVWrapper` / `createResilientKV`
  / `createCacheKV` / `createSecurityKV`: retry-with-exponential-backoff +
  circuit-breaker (closed/open/half-open) wrapper around a `KVNamespace`.
  Classifies errors into retryable ("timeout", "network", "connection",
  "temporary", "rate limit", "service unavailable", 502/503/504) vs
  non-retryable ("key not found", "value too large", "invalid key",
  "unauthorized", "forbidden") — defaults to retryable for anything
  unmatched. `createSecurityKV` is tuned tighter (3 retries, faster circuit
  trip at 3 failures, verbose logging) — intended for `TOKEN_BLACKLIST`-style
  security-critical KV access, though nothing in the audited core layer
  actually wraps `TOKEN_BLACKLIST` with it (auth middleware calls
  `c.env.TOKEN_BLACKLIST.get/put` directly, unwrapped).
- **`core/monitoring/index.ts`** — `ConsoleLogger`, `SimplePerformanceTracker`
  (in-memory timer map, per-isolate — not durable across requests),
  `SlackErrorReporter` (a second, independent Slack-webhook client distinct
  from `AlertService`'s `SlackAlertChannel` — different payload shape, same
  `SLACK_WEBHOOK_URL`/fetch pattern). These are generic interfaces/impls
  that don't appear to be the ones actually wired into `app-factory.ts`
  (which instead uses `features/monitoring`'s `createMonitoringService`) —
  likely an earlier or parallel design that a Rust rewrite doesn't need to
  treat as canonical.

### `apps/api/src/types/`

- **`env.ts`** — the full `Env` binding/var interface (Section 2 covers the
  Cloudflare-binding subset; also declares `WEB_PUSH_DELIVERER`, an
  injectable function type for tests to mock web-push delivery).
- **`deployment.ts`** — `DeploymentMode`, `TenantContext`, `LicenseStatus`,
  `LicenseFeatures`, `LICENSE_TIER_FEATURES` (standard/professional/
  enterprise feature matrices), `DeploymentConfig`, `DeploymentHealthStatus`.
  Consumed by `tenantContextMiddleware` and `LicenseService`.
- **`modules.d.ts`** — ambient module shims for `qrcode` and `fflate` (both
  have broken `package.json` exports maps under TS's `bundler` resolution
  mode — minimal hand-written type surface only, not full library types),
  plus a large block of `ApiTest*` types used only by the test suite (not
  runtime-relevant to a Rust port).

---

## 6. Scheduled & queue workers

### Cron workers dispatched from `apps/api/src/index.ts`'s `scheduled()`

| File | Cron(s) that trigger it (from `apps/api/wrangler.toml`) | What it does | Tables touched | Idempotency |
| --- | --- | --- | --- | --- |
| `scheduled/cleanup-tokens.ts` `cleanupExpiredTokens` | `0 2 * * *` | Delegates to `@makanmasak/database`'s `VerificationService.cleanupExpiredTokens()`; separately queries expired-token counts (password reset/email/phone) purely for reporting; sends an info-level Slack/email alert via `AlertService` on success, a `systemError` alert on failure. | `password_reset_tokens`, `email_verification_tokens`, `phone_verification_tokens` (via `VerificationService`, delete logic not in this file) | Naturally idempotent — deletes rows matching `expires_at < now`; safe to re-run. |
| `scheduled/cleanup-tokens.ts` `cleanupOldLogs` | `0 3 * * SUN` | `DELETE FROM password_change_logs WHERE created_at < now-90d`. | `password_change_logs` | Idempotent (age-based delete). ⚠️ **Dead code today**: the dispatcher compares against `"0 3 * * 0"` (`index.ts:65`) while the trigger fires with `"0 3 * * SUN"` — the branch can never run; fix the literal in the Rust port. |
| `workers/usage-events-ttl.ts` `cleanupExpiredUsageEvents` | `0 3 * * *` | `DELETE FROM usage_events WHERE occurred_at_ms < now-90d AND aggregated_at_ms IS NOT NULL` (only deletes events that have already been folded into `usage_meters` — never deletes unaggregated data). | `usage_events` | Idempotent; `USAGE_EVENTS_TTL_DAYS=90`. |
| Forecast warmup (inline in `index.ts`, imports `features/forecast/services/ForecastService`) | `30 2 * * *` | For every `restaurants` row with `is_active=1 AND deleted_at_ms IS NULL`, calls `forecastService.generateForecast(id, {startDate: tomorrow, endDate: +3 days})`; per-restaurant try/catch so one failure doesn't abort the batch; logs `successCount/total`. | `restaurants` (read), forecast tables (write, inside `ForecastService`, feature-owned) | Re-running regenerates the same forecast window; assume forecast writes are upserts (verify in the forecast feature's own docs). |
| `workers/usage-aggregator.ts` `aggregateUsageMeters` | `*/5 * * * *` | Groups all `usage_events` with `aggregated_at_ms IS NULL` by `(restaurant_id, meter_key)` (capped at 5000 groups/run), resolves each restaurant's current billing/trial cycle from `shop_subscriptions` (trial → signup-to-trial-end window; paid → stored cycle dates; else calendar-month fallback), **upserts** into `usage_meters` (`ON CONFLICT (restaurant_id, meter_key, cycle_start_at_ms) DO UPDATE SET total_quantity = total_quantity + excluded.total_quantity`), then marks the source `usage_events` rows `aggregated_at_ms = now` (bounded by `occurred_at_ms <= last_occurred_at_ms` of that group, so no accidental double-counting of events that land mid-run). | `usage_events` (read+update), `shop_subscriptions` (read), `usage_meters` (upsert) | **Idempotency depends on the `aggregated_at_ms IS NULL` marker + the upsert being additive** — safe to re-run only because already-aggregated events are excluded from the next pass; a crash mid-run before the `UPDATE ... SET aggregated_at_ms` step would double-count on retry (the upsert doesn't dedupe by event id, only accumulates deltas) — worth a closer idempotency audit if porting to Rust with different transaction boundaries. |
| `workers/market-checkout-reconciliation.ts` `reconcilePendingMarketCheckoutPayments` | `*/5 * * * *` | No-ops immediately (returns a `skipped` result) unless `MARKET_CHECKOUT_SPLIT_MODE === "provider_split"` and `MARKET_CHECKOUT_PROVIDER_STATUS_URL` is configured. Otherwise lists pending-status-lookup inputs (checkouts stuck "pending" for > `pendingAfterMs`, default 30 min, batch limit 25) via `MarketCheckoutPaymentReconciliationService`, queries each one's provider-side split status (`queryMarketCheckoutProviderSplitStatus`), and reconciles — per-item try/catch, `results[]` accumulates status or error per checkout. | market-checkout tables (feature-owned; read pending list + write reconciliation state) | Safe to re-run — only touches checkouts still "pending" after the threshold; a checkout that already reconciled won't reappear in the next batch's input list. |
| `workers/storage-snapshot.ts` `snapshotStorageUsage` | `0 2 * * *` | Delegates entirely to `features/billing/services/UsageService.emitStorageSnapshots(startedAt)`. | billing/usage tables (feature-owned) | Feature-owned; assume it's an append-only snapshot (safe to re-run, produces a new snapshot row rather than mutating history) — verify against the billing feature's own docs if exact-once semantics matter. |
| `features/customer/routes` `pruneStaleCustomerPushSubscriptions` | `0 2 * * *` | Feature-owned (imported inline, not re-documented here — see the customer feature's own docs). | customer push-subscription tables | Feature-owned. |
| `workers/credit-expiry.ts` `expireStaleCredits` | `0 4 * * *` | Batched drain (`DEFAULT_BATCH_LIMIT=200`, `DEFAULT_MAX_BATCHES=50`) of `CreditService.expireStaleAccounts()` — repeatedly calls until a batch returns fewer rows than the limit or makes no forward progress (`expired===0`), marking `capped=true` if the safety cap was hit before draining (meaning more work remains for the next run). After draining, runs `CreditService.findBalanceLedgerDrift({limit:100})` — an integrity sweep for accounts whose stored balance disagrees with their ledger sum (the "narrow crash window" the code comments call out). Emits Slack alerts (via `AlertService`, best-effort/never fails the cron) for any drift found, and separately for failed-account count or a capped run. | stored-value credit accounts + ledger tables (`features/credits`, feature-owned) | Explicitly designed to be safe to re-run ("Safe to re-run" in the file's own doc comment) — each account is processed independently with per-account failure isolation; the integrity sweep is read-only. |
| `features/billing/services/BillingCycleService` + `TrialReaperService` + `BillingNotificationService` | `15 2 * * *` | Three independent operations run in parallel via `Promise.all`: `closeDueCycles()` (close billing cycles whose end date has passed), `downgradeExpiredTrials()` (demote trial subscriptions past their trial end), `sendTrialEndingReminders()` (notify restaurants nearing trial end). | billing/subscription tables (feature-owned) | Feature-owned; each operation is presumably scoped to "due" rows only, making re-runs safe — verify against the billing feature's own docs for exact dedup/notification-throttling behavior. |

Any uncaught error from **any** of the above (all run inside one shared
try/catch in `index.ts`) is reported once via
`new AlertService(env).systemError(error, "Cron Job Execution")` — note this
means a failure in an *earlier* cron branch prevents *later* branches in the
same tick from running at all (the branches are sequential `await`s inside
one try block, not independently isolated) — a design difference to
consider (and likely improve) in a Rust rewrite (e.g. running each cron
handler in its own isolated try/catch so one failing job doesn't block
sibling jobs scheduled for the same tick).

### Queue consumer (`apps/api/src/index.ts` `queue()`)

Consumes `SEARCH_SYNC_QUEUE` (`SearchSyncMessage` batches). Per message:
dynamically constructs `SearchIndexSyncService(env.DB, env.CACHE_KV)`
**without** its queue binding (so any internal fan-out during processing
stays inline/non-recursive), calls `processMessage(message.body)`, `ack()`s
on success or `retry()`s on failure — relying on the queue's own
`max_retries=3` / DLQ (`makanmasak-search-sync-dlq-*`) configuration in
`wrangler.toml` for final failure handling (no custom backoff/DLQ logic in
this file itself).

### The separately-deployed `apps/backup-scheduler` worker (source lives at `apps/api/src/workers/backup-scheduler.ts`)

Its own independent cron schedule (see `apps/backup-scheduler/wrangler.toml`,
**not** `apps/api/wrangler.toml`):

| Cron | Handler | Behavior |
| --- | --- | --- |
| `*/5 * * * *` | `handleHealthCheck` | Reads `BackupService.getSystemHealth()`; on critical/warning status, creates a system-wide alert (`BackupService.createAlert`) — throttled to one alert per severity per hour via a `BACKUP_KV` key (`backup-health:last-system-alert:<severity>`, 3600s TTL) so a sustained outage doesn't spam 288 alerts/day. |
| `0 */6 * * *` | `handleScheduledBackups` | Loads all `backup_configurations` with `schedule_enabled=true` (LEFT JOIN `backup_schedules` for last-run/failure-count), applies a **simplified cron matcher** (`shouldRunBackup` — only actually recognizes the literal `"0 2 * * *"` pattern via string-split hour/minute check plus a "≥23h since last run" guard; anything else silently never fires — this is explicitly a toy cron parser, not general-purpose), calls `backupService.createBackup(..., "system")` for each due config, updates `backup_schedules.last_run_at`/resets `consecutive_failures` on success, or creates a restaurant alert + increments `consecutive_failures` on failure. |
| `0 2 * * *` | `handleDailyMaintenance` | Three independently-isolated steps (each wrapped so one failing step doesn't abort the others): (1) delete `backup_records` past `retention_days` (default 30) via a computed `datetime(started_at, '+N days') < now()` query, calling `backupService.deleteBackup` per row (**note**: `deleteBackup` on the top-level `BackupService` is a stub that only logs — see Section 5 — so this cleanup does not currently delete anything in R2/D1 despite looking like it does); (2) aggregate previous day's per-restaurant metrics into Analytics Engine; (3) delete `backup_audit_logs` older than 90 days; (4) delete resolved `backup_alerts` older than 30 days. |
| `0 0 * * SUN` (matched by the **literal string `"SUN"`**, not `"0"` — `event.cron` must match wrangler.toml's cron expression byte-for-byte) | `handleWeeklyReports` | Computes weekly per-restaurant success rate from `backup_records`; creates a `performance_degraded` restaurant alert when success rate < 80% (and at least one backup ran that week). |

Also exports `buildRestoreDrillPlan`/`executeRestoreDrill` — a **disaster-
recovery drill planner**, not itself scheduled. Builds a sequence of shell
commands (`wrangler d1 create`/`execute ... --file`/validation `SELECT
COUNT(*)` per table) for restoring a backup into a scratch D1 database and
verifying row counts, with identifier/database-name allow-list validation
(`assertSafeIdentifier`, `assertSafeDatabaseName`, `shellArg`) to prevent
shell injection from user-supplied table/database names. Production
restores additionally require `productionApproval === "RESTORE DRILL
APPROVED"` (an exact-string gate, not a real auth check) when not a dry run.
This looks like an ops/runbook tool rather than an automated pipeline —
confirm with the team whether it's invoked by any automation before
deciding whether to port it at all.

---

## 7. Rust rewrite notes

- **Hono → axum/worker-rs mapping.** The middleware pipeline here is
  Hono's `app.use("*", mw)` ordered-list model with two independent nested
  routers (`app` then `apiV1` mounted at `/api/v1`), each with their own
  ordered middleware stacks and a further layer of **prefix-scoped**
  `apiV1.use("/foo/*", mw)` calls interleaved with route mounts (Section 3–4).
  This is closer to `axum`'s `Router::layer` + `.nest()` + per-route
  `.route_layer()` than to a flat middleware chain — but note the exact
  **order** in which prefix-scoped middlewares are registered relative to
  route mounts matters in Hono (a `.use()` registered before a later
  `.route()` mount still applies to it), whereas `axum`'s `.layer()`/`.nest()`
  composition order semantics differ enough that a naive port could silently
  reorder auth-before-CSRF-before-usageTracker (see Section 4's exact
  sequence) unless deliberately reproduced. Recommend building the
  equivalent of `apiV1`'s sequential prefix-gate list as an explicit,
  testable ordered list (e.g. a `Vec<(PathMatcher, tower::Layer)>` applied
  in registration order) rather than relying on `axum` router composition to
  reproduce it implicitly.
- **worker-rs entrypoints.** `fetch`/`scheduled`/`queue` map directly to
  `worker-rs`'s `#[event(fetch)]`/`#[event(scheduled)]`/`#[event(queue)]`
  macros. The cron dispatch-by-literal-string pattern (Section 6, multiple
  `if` branches matching the same cron expression, sequential in one
  try/catch) should almost certainly be split into independently-isolated
  per-job error handling in the rewrite — the current design lets an
  earlier failing cron job silently starve later jobs scheduled for the
  same tick.
- **Two Workers, one source tree.** `apps/backup-scheduler`'s `main` points
  at a file physically inside `apps/api/src/workers/`. In Rust, this would
  most cleanly become its own separate crate/binary (as it already
  effectively is a separate deployable), not a module reused from the main
  API's crate — don't let the current directory layout imply they should
  stay coupled.
- **zod → serde validation strategy.** `middleware/validation.ts`'s
  `validateBody/Query/Params` produce a **uniform** `VALIDATION_ERROR` 400
  with a `[{field, message, code}]` details array derived from
  `ZodError.errors` (`path.join(".")`for `field`). In Rust, `serde` +
  `validator` (or hand-rolled `Deserialize` + a validation trait) should
  aim to reproduce this exact `{field, message, code}` shape per invalid
  field, not just a single top-level message — several client apps likely
  key off `error.details[].field`. Zod's `.regex(/^\d+$/).transform(Number)`
  idiom (seen in `commonSchemas.idParam`/`restaurantIdParam`) — string
  input, numeric output — needs an equivalent custom `Deserialize`
  (deserialize as `String`, validate regex, parse to number) since serde
  doesn't have a direct built-in equivalent.
- **Error-envelope reproduction.** The global envelope is
  `{success:false, error:{code, message, details?}}` (Section 4). Two
  **inconsistent exceptions** exist in the current code that a faithful
  port needs to either preserve or deliberately fix-and-document:
  (1) `middleware/csrf.ts`'s CSRF-rejection responses use `{success:false,
  error: "<string>", message: "<string>"}` (bare string `error`, not
  `{code,message}`); (2) `tenantContextMiddleware`'s `TENANT_NOT_CONFIGURED`/
  `TENANT_ACCESS_DENIED` and similar direct `c.json({success:false,
  error:"...", code:"..."})` calls in that file use `error` as a plain
  message string with a **sibling** `code` field, a third distinct shape.
  Recommend normalizing all three to the canonical `{code,message}` nested
  shape in the Rust rewrite (flag this as a deliberate behavior change for
  API consumers, not a silent bug fix).
- **JWT.** HS256 only, `jsonwebtoken` (Node/JS lib) here. In Rust, the
  `jsonwebtoken` crate (same name, different ecosystem) or `jwt-simple`
  both support HS256 cleanly. Key behaviors to replicate exactly: (1) time
  claims (`exp`/`nbf`/`iat`) are validated **manually** in application code
  with a 60-second clock-skew tolerance on `iat`/`nbf`, not via the
  library's built-in validation — the library call explicitly disables
  `exp`/`nbf` checking; (2) a **72-hour absolute token-age ceiling**
  (`now - iat > 72h` → forced re-auth) independent of the token's own `exp`;
  (3) a DB-backed **token-version** check (`tv` claim vs `users
  .token_version`) for server-side revocation — this is the actual "logout
  everywhere" mechanism, not just blacklisting; (4) the separate
  `TOKEN_BLACKLIST` KV check for individually-revoked tokens (logout without
  bumping the account-wide token version); (5) three **structurally
  distinct** payload shapes in play (staff: `sub` UUIDv7 + `username` +
  `role` + optional `tv`/`restaurantId`; customer: `sub` + `type:"customer"`;
  SSE-scoped: staff shape + `purpose:"kitchen_sse"` + `aud:"kitchen_sse"`) —
  a Rust `enum Claims` discriminated by shape (or a `type`/`purpose` tag)
  should replace the current `isXPayload()` runtime type-guard functions.
- **D1 access from Rust.** `worker-rs` exposes D1 via its own `D1Database`
  binding wrapper (prepare/bind/run/all/first), structurally similar to the
  JS API used throughout this codebase. Two things to watch: (1) several
  queries here build dynamic SQL by string-concatenating **validated**
  identifiers (e.g. `BackupService`'s sort-column allow-list, or the
  backup-scheduler's `assertSafeIdentifier`) rather than using
  parameterized placeholders for column/table names (D1/SQLite has no
  parameter binding for identifiers) — any Rust port must preserve the
  allow-list-validate-then-format pattern, not attempt to parameterize
  table/column names; (2) the `usage_meters` upsert
  (`ON CONFLICT (...) DO UPDATE SET total_quantity = total_quantity +
  excluded.total_quantity`) relies on D1/SQLite's `ON CONFLICT` upsert
  syntax, directly portable to a Rust D1 client using the same raw SQL.
- **Queues/cron in workers-rs.** Queue producer/consumer bindings and cron
  triggers are both first-class in `workers-rs`/`wrangler.toml` (no gap vs.
  the JS Workers runtime) — the `ack()`/`retry()` per-message API in the JS
  `queue()` handler (Section 6) maps directly to `worker-rs`'s
  `Message::ack()`/`Message::retry()` on `MessageBatch`.
- **bcrypt/crypto usage found in code.** `bcryptjs` (pure-JS bcrypt,
  package.json dependency) is used by feature code
  (`features/credits/services/CreditService.ts`,
  `features/customer/routes/index.ts` — both feature-owned, not core) for
  password/PIN hashing; nothing in the **core** layer itself calls bcrypt
  directly. Core-layer crypto is all Web Crypto API (`crypto.subtle.digest`
  SHA-256 for idempotency-key hashing and backup checksums,
  `crypto.getRandomValues` for CSRF/guest tokens, `crypto.randomUUID()` for
  request IDs) — these map directly to Rust's `sha2`/`rand`/`uuid` crates
  with no Workers-specific translation needed since Web Crypto is already
  spec-standard. For the bcrypt usage itself (feature-layer, but worth
  flagging here since it affects any shared auth/password infra a Rust core
  might centralize): the `bcrypt` Rust crate (wraps the same algorithm,
  cost-factor compatible) is the natural equivalent — verify hash format
  compatibility (`$2a$`/`$2b$` prefix) if existing hashes must remain valid
  after a cutover.
- **Two competing cache subsystems, three competing rate-limiter
  implementations, two competing `BackupService` implementations, and one
  confirmed-dead-code service pair (`LicenseService`, top-level
  `qrCodeService.ts`) all coexist in this codebase** (details throughout
  Sections 4–5). A Rust rewrite is a natural opportunity to consolidate to
  **one** canonical implementation of each rather than porting every
  variant — but confirm with the team which variant is actually
  load-bearing in production before deleting anything, since "not imported
  in `apps/api`'s own route tree" was verified by static grep, not runtime
  tracing.
