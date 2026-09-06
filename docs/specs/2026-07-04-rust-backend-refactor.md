# Spec: Rust Backend Refactor

## Objective

Refactor the MakanMakan backend from TypeScript Cloudflare Workers to Rust while
preserving the existing public API, data model, Cloudflare deployment topology,
security behavior, and frontend contracts.

This is not a rewrite of the product. The goal is a staged backend language
migration that lets the team ship feature-equivalent Rust services behind the
same routes and bindings, with measurable parity before traffic moves.

Success means:

- `/api/v1` clients continue to work without frontend route or payload changes.
- Existing Cloudflare resources remain the platform baseline: Workers, D1, KV,
  R2, Queues, Durable Objects, Vectorize, Workers AI, service bindings, and
  Cron Triggers.
- The Rust backend passes contract, integration, migration, security, and
  performance gates before replacing the TypeScript implementation.
- Existing TypeScript frontends and shared tests can validate both backends
  during migration.

## Assumptions

1. "Backend" means `apps/api`, `apps/management-api`, `apps/realtime`,
   `apps/image-processor`, `apps/backup-scheduler`, `apps/print-agent`, and the
   backend-facing shared packages under `packages/`.
2. Frontend apps remain Vue/TypeScript and are out of scope except for contract
   test updates.
3. The database remains Cloudflare D1/SQLite. No PostgreSQL, service split, or
   schema redesign is included unless a later approved task requires it.
4. The migration should use a strangler strategy, not a big-bang replacement.
5. `workers-rs` is the primary Rust target for Cloudflare Workers. Cloudflare's
   Rust docs, last updated 2026-04-23, state that Workers support Rust through
   `workers-rs`, including bindings such as KV, R2, D1, Queues, Workers AI, and
   service bindings:
   https://developers.cloudflare.com/workers/languages/rust/
   Note that this documented binding list does NOT include Vectorize; see
   assumption 7.
6. Durable Object and WebSocket behavior must be proven in a spike before
   `apps/realtime` is committed to Rust. If parity is not acceptable, realtime
   may remain TypeScript temporarily behind the same API contract while the REST
   backend migrates. The current implementation uses classic
   `new WebSocketPair()` + `server.accept()` + event listeners with an in-memory
   connection map (`apps/realtime/src/RealtimeSession.ts`), NOT the WebSocket
   hibernation API. An `alarm()` handler exists but nothing ever calls
   `setAlarm()`, so it is effectively unscheduled cleanup code. The spike must
   decide whether the Rust port replicates the non-hibernation model or
   deliberately migrates to hibernation, and must treat that as a behavior
   change requiring its own parity evidence.
7. Vectorize is a named platform risk with the same exception model as
   realtime. `apps/api` binds both `AI` (Workers AI) and `DISCOVERY_VECTORIZE`
   (Vectorize) in `wrangler.toml`, and the discovery feature actively uses them
   (`SemanticDiscoveryService` calls `ai.run("@cf/baai/bge-m3")` for embeddings
   plus `vectorize.query()`/`vectorize.upsert()`). Workers AI is in the
   documented `workers-rs` binding list; Vectorize is not. The Phase 1 spike
   must prove Vectorize access from Rust. If native support is missing, the
   approved fallbacks are: a manual `wasm-bindgen`/`js-sys` wrapper around the
   raw JS binding, or temporarily keeping the `discovery` module in TypeScript
   behind the same API contract while everything else migrates. The decision
   must be recorded before Phase 3 item 4 (discovery migration) starts.

## Current Backend Understanding

### Runtime Topology

| Area | Current path | Runtime | Notes |
| --- | --- | --- | --- |
| Main REST API | `apps/api` | Cloudflare Worker + Hono | Largest backend surface; 48 feature dirs, 41 index modules, 50 `/api/v1` mount points. |
| Management control plane | `apps/management-api` | Cloudflare Worker + Hono | Tenant onboarding, licenses, deployments, Cloudflare API orchestration, health/monitoring. |
| Realtime | `apps/realtime` | Worker + Durable Object | WebSocket sessions, room fanout, token blacklist, D1 restaurant access checks. Classic `WebSocketPair` model, not hibernation; DO class `RealtimeSession`. |
| Image processing | `apps/image-processor` | Worker + Hono | Image upload, Cloudflare Images integration, D1 metadata, KV/R2/cache analytics. |
| Backup scheduler | `apps/backup-scheduler` | Worker Cron wrapper | Package says worker code lives mostly in `apps/api`; validates via API build/lint. |
| Print agent | `apps/print-agent` | Local Node.js daemon | Express + WebSocket local service for ESC/POS printing. |
| Database | `packages/database` | Drizzle schema + SQL migrations | Source of truth for schema; dual migration tracks are enforced. |
| Shared contracts | `packages/shared-types`, `apps/api/src/contracts` | TypeScript | Must be converted into language-neutral contracts before Rust ports. |

### Inter-Worker Topology

Verified against every `wrangler.toml` on 2026-07-04:

- Exactly one true service binding exists in the repo:
  `apps/api` → `management-api` (`MANAGEMENT_API` binding).
- `apps/api` → `apps/realtime` is a cross-script Durable Object binding
  (`REALTIME_SESSION`, class `RealtimeSession`,
  `script_name = "makanmasak-realtime"`), not a service binding. A Rust Worker
  attaching a DO binding to a class hosted by another (initially still
  TypeScript) script must be proven in the Phase 1 spike.
- There is NO service binding between `apps/api` and `apps/image-processor`.
- `apps/management-api` binds two D1 databases: its own `MANAGEMENT_DB` (own
  migrations dir) plus `PLATFORM_DB`, which shares the same `database_id` as
  the main API `DB`. The Phase 5 migration must respect that data boundary.
- `apps/backup-scheduler` is a thin cron wrapper whose `main` points at
  `apps/api/src/workers/backup-scheduler.ts`; its logic migrates with
  `apps/api`, not as an independent service.
- Environment parity caveat: the `TOKEN_BLACKLIST` KV binding on `apps/api`
  exists only in staging and production, not in the default/dev environment.
  Parity test environments must account for this.

### Main API Shape

`apps/api/src/app-factory.ts` creates the Hono app, installs global middleware,
mounts `/api/v1`, and registers the feature routers. Important cross-cutting
behavior:

- Request IDs, geo-aware rate limiting, security monitoring, CORS, security
  headers, input sanitization.
- Optional observability middleware: analytics, metrics, error monitoring,
  monitoring stats.
- Optional edge cache middleware with route-aware cache tags.
- Tenant context middleware for SaaS vs independent deployment modes.
- Unified error handler returning:

```json
{
  "success": false,
  "error": {
    "code": "STRING_CODE",
    "message": "user-safe message",
    "details": {}
  }
}
```

- Public route mounts first, then a concrete-route guard, then protected route
  middleware and CSRF protection, then protected route mounts.
- Root-level public routes outside `/api/v1`: `/info` returns the deployment
  info payload and is the real public liveness probe; `/health` is only a 302
  redirect to `/api/v1/monitoring/health` (which requires auth). A Rust port of
  `/health` is a redirect, not a health computation.
- Scheduled handlers in `apps/api/src/index.ts` run cleanup, forecast warmup,
  usage aggregation, payment reconciliation, storage snapshots, push pruning,
  credit expiry, and billing lifecycle work.
- Queue consumer drains `SEARCH_SYNC_QUEUE` for discovery/search indexing.

### `/api/v1` Mount Points

The docs drift script reports 50 route mounts derived from
`apps/api/src/app-factory.ts`. That figure counts `apiV1.route()` calls; there
are 49 distinct path prefixes because `/auth` is mounted twice (the
`authentication` router and the `verification` router share the prefix). The
current generated mount index in `docs/api/README.md` is synchronized and
should be treated as the route prefix source of truth:

`/auth`, `/qr`, `/queue`, `/coupons`, `/reservations`, `/service-bookings`,
`/waiting-list`, `/realtime`, `/partnerships`, `/guest-orders`,
`/market-checkouts`, `/credits`, `/integrations`, `/restaurants`, `/menu`,
`/kitchen`, `/orders/group`, `/orders`, `/pos`, `/payments`, `/manager`,
`/audit-logs`, `/tables`, `/seats`, `/users`, `/analytics`, `/ai-analytics`,
`/sse`, `/system`, `/cache`, `/monitoring`, `/backup`, `/customer`,
`/customers`, `/leaves`, `/scheduling`, `/forecast`, `/ingredients`,
`/discovery`, `/markets`, `/feedback`, `/billing`, `/me`, `/notifications`,
`/push`, `/audit`, `/admin`, `/admin/markets`, `/admin/subscriptions`.

## Documentation Audit

Commands run on 2026-07-04:

```bash
pnpm run check:docs-drift
pnpm run contract:report
```

Results:

- `check:docs-drift` passed:
  `derived: 48 feature dirs, 41 modules (index.ts), 50 route mounts`.
- `contract:report` found 21 contract modules, 192 schemas, and 522 fields.

### Documents That Are Current Enough To Use

- `docs/api/README.md`: The generated mount index is in sync with
  `apps/api/src/app-factory.ts`.
- `docs/architecture/README.md`: Feature counts are generated and match the
  docs drift check.
- `CLAUDE.md`: Accurately describes the current app topology, local ports,
  database migration rules, role model, error response shape, and query rules.
- `AGENTS.md`: Correctly records repo commands, migration rules, timestamp
  conventions, partial unique index requirements, secret storage rules, and
  role IDs.
- `packages/database/README.md`: Current on core schema governance, dual
  migrations, timestamp policy, idempotency indexes, and encrypted secret
  storage rules.

### Documents That Need Updates Before Rust Work Starts

- `docs/README.md` says `CLAUDE.md` is the primary reference. That is useful
  for agents, but the Rust migration should not depend on an agent-specific
  file as the only canonical backend architecture reference. Move the relevant
  backend sections into architecture/spec docs or link this spec prominently.
- `docs/architecture/project-architecture.md` has useful topology, but the
  document is still TypeScript/Hono-specific. It should be updated after Rust
  scaffolding exists.
- `docs/architecture/system-design/MODULAR_ARCHITECTURE_GUIDE.md` describes an
  earlier migration model and still references legacy `routes/` migration steps.
  Treat it as historical context, not a Rust implementation guide.
- `apps/image-processor/README.md` uses `npm install` / `npm run` examples,
  while repository rules require `pnpm`. Update before using it as an
  onboarding guide.
- `packages/database/README.md` still contains examples with integer
  `restaurantId`/`tableId` in places. That is acceptable historical context but
  not a new Rust schema guide; use actual Drizzle schema and migration files as
  the source of truth.

### Contract Gaps

The current API contract report covers 21 modules. The main API exposes 48
feature dirs and 50 route mounts (41 feature dirs have an `index.ts` module).

Tooling limitation: `scripts/check-api-contracts.cjs` captures no HTTP method,
path, auth requirement, or side-effect information, so it still cannot express
the coverage this spec requires; Phase 0 must build a new contract generator in
`packages/backend-contracts` rather than extend `contract:report` alone.
`contract:report` remains useful as a field-drift tripwire during migration.

> **Updated 2026-09-06 ([#336](https://github.com/erictheng93/Makan-Masak/issues/336)).**
> Two of the limitations recorded here are gone. The script no longer
> regex-extracts anything — it imports the schemas and walks them — so it does
> capture field types, and it no longer silently drops a file its regex could
> not parse. `integrations.ts` now yields 7 schemas and the report covers 22
> modules, not 21. The missing method/path/auth/side-effect axes are unchanged,
> and remain the reason Phase 0 needs its own generator.

Before Rust implementation, contract coverage
must be expanded so every route that will be ported has:

- request method/path;
- auth requirement;
- request body/query/path schema;
- success response schema;
- error response schema;
- idempotency behavior where applicable;
- cache behavior where applicable;
- side effects: D1 writes, KV writes, R2 writes, queue sends, service calls,
  Durable Object broadcasts, AI/Vectorize calls.

## Target Architecture

### Repository Structure

Add Rust workspaces without removing the TypeScript backend until parity gates
pass:

```text
apps/
  api-rust/                 # Rust replacement for apps/api
  management-api-rust/      # Rust replacement for apps/management-api
  realtime-rust/            # Rust spike/replacement for apps/realtime
  image-processor-rust/     # Rust replacement for apps/image-processor
  print-agent-rust/         # Optional native/local Rust replacement
packages/
  backend-contracts/        # Language-neutral OpenAPI/JSON Schema artifacts
  rust-shared/              # Rust crate for shared auth, errors, ids, time, money
  rust-database/            # Rust D1 query helpers generated from schema contracts
docs/
  specs/                    # This spec and follow-up specs
  runbooks/                 # Cutover and rollback playbooks
```

The Rust workspaces should be introduced next to existing apps so traffic can be
compared without blocking TypeScript production deployments.

### Rust Stack

Cloudflare Worker targets:

- Rust stable.
- `wasm32-unknown-unknown` target.
- `workers-rs` / `worker` crate for Worker events and bindings.
- `worker-build` through Wrangler custom build output.
- `serde`, `serde_json`, `serde_with` for JSON.
- `schemars` or generated JSON Schema validation artifacts for contract
  verification.
- `thiserror` for typed service errors.
- `tracing`, `tracing-subscriber`, and `tracing-web` for Worker-compatible
  telemetry. Cloudflare's supported-crates docs note Wasm-specific crate
  configuration is often required and dependency size must be considered:
  https://developers.cloudflare.com/workers/languages/rust/crates/
- `time` with Wasm-compatible features instead of direct `std::time` where
  Worker runtime timing is needed.

Non-Worker/local target:

- `print-agent-rust` may use `axum` or `actix-web`, `tokio`, `tokio-tungstenite`
  or `axum` WebSockets, and native serial/USB printing libraries. This is
  separate from Worker Wasm constraints.

### Language-Neutral Contracts

The migration must not rely on TypeScript-only shared types as the source of
truth. Create generated artifacts from existing contracts:

```text
packages/backend-contracts/
  openapi/api-v1.json
  openapi/management-api.json
  schemas/*.schema.json
  snapshots/routes.generated.json
  snapshots/api-contracts.generated.json
```

Rules:

- Existing TypeScript Zod contracts continue to generate the first baseline.
- Rust handlers must deserialize/serialize according to the generated contract.
- The same contract artifacts drive parity tests for TypeScript and Rust.
- Breaking payload changes require explicit versioning, not silent mutation.

### Module Mapping

Each feature should map to a Rust module with the same route prefix and a
service layer:

```text
apps/api-rust/src/
  lib.rs
  router.rs
  env.rs
  middleware/
  platform/
    d1.rs
    kv.rs
    r2.rs
    queues.rs
    durable_objects.rs
    ai.rs
    vectorize.rs
  shared/
    errors.rs
    response.rs
    auth.rs
    csrf.rs
    rate_limit.rs
    tenant.rs
    idempotency.rs
  features/
    authentication/
      mod.rs
      routes.rs
      service.rs
      models.rs
    orders/
    menu/
    ...
```

Required behavior parity for every feature:

- route prefix and method/path;
- auth and role guard;
- module gate;
- request validation;
- tenant scoping;
- response envelope;
- sanitized error response;
- D1/KV/R2/Queue side effects;
- cache invalidation;
- audit log writes;
- idempotency and webhook deduplication;
- observability events.

## Commands

Existing verification commands:

```bash
pnpm run check:docs-drift
pnpm run contract:report
pnpm run check:migration-dual-track
pnpm run check:workers
pnpm run test:api
pnpm run test:real-integration
pnpm run test:e2e
pnpm run lint
pnpm run typecheck
```

Rust bootstrap commands to add:

```bash
rustup target add wasm32-unknown-unknown
cargo install cargo-generate
cargo generate cloudflare/workers-rs --name api-rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo audit
pnpm --filter @makanmasak/api-rust run build
pnpm --filter @makanmasak/api-rust run dev
```

Add package scripts per Rust Worker:

```json
{
  "scripts": {
    "dev": "wrangler dev --persist-to ../../.wrangler/shared-state",
    "build": "wrangler deploy --dry-run --env=\"\"",
    "build:prod": "wrangler deploy --dry-run --env production",
    "deploy": "node -e \"console.error('Refusing unqualified deploy. Use pnpm run deploy:prod.'); process.exit(1)\"",
    "deploy:prod": "wrangler deploy --env production",
    "fmt": "cargo fmt --all -- --check",
    "lint": "cargo clippy --workspace --all-targets -- -D warnings",
    "test": "cargo test --workspace"
  }
}
```

## Code Style

### Rust API Response Example

```rust
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSuccess<T>
where
    T: Serialize,
{
    pub success: bool,
    pub data: T,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorBody {
    pub success: bool,
    pub error: ApiErrorPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}
```

Conventions:

- Use `snake_case` for Rust modules, functions, variables, and fields.
- Use `PascalCase` for structs, enums, and traits.
- Use `SCREAMING_SNAKE_CASE` for constants.
- Serialize public JSON in `camelCase` unless the existing API uses a different
  field name.
- No `unwrap()` or `expect()` in request paths except process-start invariant
  checks with an explanatory message.
- Use typed errors and convert them once at the edge into the existing API error
  envelope.
- Keep SQL parameters bound. Do not format user input into SQL strings.
- Use integer Unix milliseconds for timestamps to match current schema policy.
- Use cents/basis-points integer money/percentage representations where current
  schema has cut over to them.

## Testing Strategy

### Phase Gates

Every migration phase must pass:

```bash
pnpm run check:docs-drift
pnpm run contract:report
pnpm run check:migration-dual-track
pnpm run check:workers
pnpm run test:api
pnpm run test:real-integration
pnpm run test:e2e
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

### Required New Tests

- Contract parity tests: replay each contract case against TypeScript and Rust
  backends and diff status, headers that matter, JSON shape, and side effects.
- Golden response tests for success and error envelopes.
- Auth tests for roles 0-5, staff/owner/customer distinctions, guest tokens,
  refresh tokens, CSRF, and WebSocket/SSE token paths.
- D1 integration tests using real local Wrangler D1 state.
- Idempotency tests for payment, billing, webhooks, market checkout, and
  retryable writes.
- Cache invalidation tests for menu, orders, analytics, QR, payments, and
  restaurant-scoped tags.
- Queue tests for search sync producer and consumer behavior.
- Cron tests for each scheduled task currently in `apps/api/src/index.ts`.
- Realtime tests for WebSocket connection, room auth, token blacklist, fanout,
  reconnect, and Durable Object state behavior.
- Performance comparison tests using existing Artillery suites.

### Coverage Targets

- Rust unit tests: minimum 85% equivalent line/branch coverage where measurable.
- High-risk modules: authentication, orders, payments, billing, market
  checkouts, integrations, customer identity, realtime, and database write paths
  require explicit scenario coverage even if coverage tooling misses Wasm paths.
- No route can be switched to Rust without at least one real integration test.

## Boundaries

### Always

- Preserve `/api/v1` route compatibility unless a versioned API change is
  approved.
- Preserve existing role IDs:
  `0 Admin`, `1 Shop Owner`, `2 Chef`, `3 Service Crew`, `4 Cashier`,
  `5 Customer`.
- Preserve unified error response format.
- Preserve database schema source of truth in `packages/database/src/schema/`
  until a separate approved schema migration spec changes it.
- Keep both migration tracks current for SQL changes.
- Store secrets only in secret bindings or encrypted payload fields.
- Run docs drift, contract, migration, Rust, TypeScript, and integration gates
  before cutover.

### Ask First

- Changing database schema.
- Replacing D1/Cloudflare Workers with another platform.
- Keeping any backend service permanently in TypeScript.
- Adding Rust crates that materially increase Wasm binary size or require
  unsafe/native assumptions.
- Changing auth token format, cookie behavior, CSRF behavior, idempotency keys,
  or webhook signature verification.
- Changing deployment names, Cloudflare bindings, queue names, Durable Object
  classes, or production routing.

### Never

- Do a big-bang replacement without dual-run parity evidence.
- Change public response shapes because Rust serialization is easier.
- Commit secrets, plaintext provider tokens, OAuth credentials, or webhook
  secrets.
- Generate SQL by string-concatenating request input.
- Remove failing TypeScript tests just because the Rust backend supersedes the
  module.
- Delete the TypeScript backend before a rollback path exists.

## Implementation Plan

### Phase 0: Inventory And Contract Freeze

1. Generate a full route inventory from `app-factory.ts`, route modules, and
   management/image/realtime apps.
2. Expand `packages/backend-contracts` so all mounted routes have schemas and
   side-effect metadata.
3. Add a parity runner that can target TypeScript or Rust base URLs.
4. Update stale docs listed in this spec or mark them historical.

Exit criteria:

- The new `packages/backend-contracts` generator covers every route planned for
  Rust migration with method, path, auth, schemas, and side effects. The
  existing `contract:report` field-shape snapshot stays green but is not the
  coverage gate (see Contract Gaps: since #336 it captures every field path
  and its type, but still no method, path, auth or side effects).
- Docs explain which backend docs are authoritative.
- Parity runner can execute against the current TypeScript backend.

### Phase 1: Rust Platform Spike

1. Scaffold `apps/api-rust` with `workers-rs`.
2. Port only `/health` (a 302 redirect), `/info`, and one read-only public
   route.
3. Prove access to D1, KV, R2, Queue producer, the service binding to
   management-api, and the Workers AI binding used by the current app.
4. Prove Vectorize access separately. Vectorize is not in the documented
   `workers-rs` binding list (see assumption 7), so expect this to require a
   manual `wasm-bindgen`/`js-sys` wrapper. If the wrapper is not viable,
   record the decision to keep `discovery` in TypeScript temporarily.
5. Prove the cross-script Durable Object binding: a Rust Worker attaching
   `REALTIME_SESSION` to the `RealtimeSession` class hosted by the (still
   TypeScript) realtime script.
6. Prove response/error envelope parity.
7. Measure Wasm bundle size and cold-start behavior.
8. Separately spike Durable Object/WebSocket parity for `apps/realtime`,
   accounting for its classic non-hibernation WebSocket model (assumption 6).

Exit criteria:

- Rust Worker deploy dry-run succeeds.
- Local Wrangler dev serves the spike routes.
- Parity tests pass for spike routes.
- Realtime decision is recorded: migrate now, defer, or keep TS temporarily.
- Vectorize decision is recorded: native binding, interop wrapper, or keep
  `discovery` in TypeScript temporarily.

### Phase 2: Shared Rust Foundations

1. Implement `rust-shared`:
   auth primitives, roles, tenant context, response/error envelopes, IDs,
   timestamps, money, pagination, logging, security helpers.
2. Implement `rust-database` D1 helpers and schema-safe query patterns.
3. Implement middleware equivalents:
   request ID, CORS, security headers, rate limiting, sanitization, auth, CSRF,
   module gates, usage tracking, observability.
4. Add golden tests against current TypeScript behavior.

Exit criteria:

- Shared Rust crates pass fmt, clippy, unit tests, and contract golden tests.
- Middleware behavior matches TypeScript for covered scenarios.

### Phase 3: Low-Risk Route Migration

Migrate read-heavy or isolated modules first:

1. `system`, `monitoring` health-only paths, `cache` read endpoints.
2. `restaurants` public GET routes.
3. `menu` public GET routes.
4. `discovery` read endpoints only after the Phase 1 Vectorize decision
   (assumption 7) has been recorded and its chosen access path is proven.

Exit criteria:

- Parity tests pass for each migrated route.
- Frontend smoke tests pass against Rust for migrated routes.
- TypeScript implementation remains available for fallback.

### Phase 4: Core Business Modules

Migrate modules with increasing write risk:

Module names below are the actual directory names under
`apps/api/src/features/`:

1. `authentication`, `verification` (both mount at `/auth`), `me`, `users`,
   `customers`, `customer`.
2. `orders`, `guest-orders`, `group-orders` (mounts at `/orders/group`),
   `kitchen`, `sse`, `realtime` (public token/session routes at `/realtime`;
   coordinate with the realtime service decision).
3. `pos`, `payments`, `billing`, `market-checkouts`, `credits`.
4. `queue`, `waiting-list`, `reservations`, `service-bookings`.
5. `tables`, `seats`, `qr-codes`.
6. `scheduling`, `leaves`, `manager` (also owns the `/audit-logs` mount via
   `managerFeature.auditLogsRoutes` — there is no `audit-logs` feature dir),
   `audit`.
7. `coupons`, `partnerships`, `integrations`.
8. `analytics`, `ai-analytics`, `forecast`, `ingredients`, `feedback`.
9. `markets` (also `/admin/markets`), `admin-settings` (mounts at `/admin`),
   `subscriptions` (mounts at `/admin/subscriptions`), `notifications`,
   `push`, `backup`.

Exit criteria for each module:

- Contract parity passes.
- Real D1 integration tests pass.
- Auth/role/module-gate tests pass.
- Side-effect tests pass.
- Performance is no worse than TypeScript by more than the approved threshold.

### Phase 5: Management, Image, Realtime, Print

1. Migrate `apps/management-api` after main auth/shared foundations are stable.
   It binds two D1 databases: its own `MANAGEMENT_DB` (own migrations dir) and
   `PLATFORM_DB`, which is the same physical database as the main API `DB`.
   The Rust port must preserve that boundary: management migrations stay in
   the management track; platform reads/writes follow the main schema source
   of truth.
2. Migrate `apps/image-processor` after file upload, Cloudflare Images, R2, and
   metadata parity tests exist. Note there is no service binding between it and
   `apps/api`; do not introduce one as a side effect of the port.
3. Migrate `apps/realtime` only if the Durable Object spike passes.
4. Decide whether `apps/print-agent` should become Rust. Because it is local
   native software, it can be migrated independently after API parity is done.
5. `apps/backup-scheduler` needs no separate migration: it is a thin cron
   wrapper whose `main` points at `apps/api/src/workers/backup-scheduler.ts`,
   so its logic moves when the main API backup/cron code moves. The wrapper's
   `wrangler.toml` entry point must be repointed at the Rust equivalent at
   cutover.

Exit criteria:

- Each secondary service has its own contract and cutover runbook.
- Production routing can switch one service at a time.

### Phase 6: Dual Run, Cutover, Cleanup

1. Run TypeScript and Rust backends in staging with mirrored parity traffic.
2. Compare logs, status codes, response shapes, D1 side effects, cache writes,
   queue messages, and performance metrics.
3. Cut over route groups using Cloudflare routing/service binding controls.
4. Keep TypeScript fallback available for at least one full billing/order cycle.
5. Remove TypeScript backend only after rollback window closes and docs are
   updated.

Exit criteria:

- Staging dual-run passes.
- Production canary passes.
- Rollback runbook has been tested.
- TypeScript removal PR contains only cleanup and doc updates.

## Success Criteria

- All backend route contracts are complete and versioned.
- Rust backend passes all existing backend and e2e tests, plus new parity tests.
- `pnpm run check:docs-drift` and contract checks pass after migration.
- `pnpm run check:migration-dual-track` passes for any SQL changes.
- Rust fmt, clippy, cargo tests, and audit pass.
- Production latency and error rates are no worse than current baselines:
  API P99 < 300ms, DB query P95 < 100ms, WebSocket latency < 50ms where
  applicable.
- No frontend code changes are required for migrated routes.
- Rollback can return traffic to TypeScript without data loss.

## Open Questions

1. Is the target "100% Rust backend" mandatory, or may `apps/realtime`,
   the `discovery` module (Vectorize dependency, assumption 7), and
   `apps/print-agent` remain TypeScript/Node temporarily if platform parity is
   risky?
2. Should the team keep Cloudflare Workers as the hard deployment target, or is
   a non-Worker Rust server acceptable for any backend service?
3. What is the acceptable performance regression threshold during parity:
   0%, 5%, or 10%?
4. Should Rust migration happen route-by-route under the same Worker domain, or
   service-by-service with temporary `*-rust` hostnames?
5. Who owns final API contract approval for payment, billing, and webhook
   modules?

## Initial Task Breakdown

- [ ] Task: Generate complete route and side-effect inventory.
  - Acceptance: Every backend route has method, path, auth, schema, side
    effects, and owner.
  - Verify: `pnpm run contract:report` shows full route coverage.
  - Files: `scripts/check-api-contracts.cjs`, `packages/backend-contracts/**`,
    `docs/api/README.md`.

- [ ] Task: Create Rust Worker spike for `/health`, `/info`, and one public
  read route.
  - Acceptance: Rust Worker runs locally and deploy dry-run succeeds.
  - Verify: `pnpm --filter @makanmasak/api-rust run build`,
    `cargo test --workspace`.
  - Files: `apps/api-rust/**`, `Cargo.toml`, `pnpm-workspace.yaml`,
    `package.json`.

- [ ] Task: Build parity runner.
  - Acceptance: Same test cases can run against TypeScript and Rust base URLs
    and produce a diff report.
  - Verify: parity run passes against current TypeScript backend.
  - Files: `tests/integration/parity/**`, `packages/backend-contracts/**`.

- [ ] Task: Port shared response and error handling.
  - Acceptance: Rust errors serialize exactly like TypeScript API errors.
  - Verify: golden tests compare JSON bodies and status codes.
  - Files: `packages/rust-shared/src/errors.rs`,
    `packages/rust-shared/src/response.rs`.

- [ ] Task: Port auth and role middleware.
  - Acceptance: Roles 0-5, guest/customer/staff flows, CSRF, and refresh paths
    match TypeScript behavior.
  - Verify: auth parity and integration tests pass.
  - Files: `packages/rust-shared/src/auth.rs`,
    `apps/api-rust/src/middleware/**`.

- [ ] Task: Decide realtime migration strategy.
  - Acceptance: Durable Object/WebSocket spike either passes or a documented
    temporary TypeScript exception is approved. The spike must state whether
    the port keeps the current non-hibernation `WebSocketPair` model or
    migrates to hibernation.
  - Verify: realtime connection, fanout, room auth, reconnect, and token
    blacklist tests pass in the chosen runtime.
  - Files: `apps/realtime-rust/**` or `docs/runbooks/realtime-rust-decision.md`.

- [ ] Task: Decide Vectorize/discovery migration strategy.
  - Acceptance: Rust access to the `DISCOVERY_VECTORIZE` binding is proven
    (native or `wasm-bindgen`/`js-sys` wrapper), or a documented temporary
    TypeScript exception for the `discovery` module is approved.
  - Verify: embedding generation via the `AI` binding plus `vectorize.query()`
    and `vectorize.upsert()` round-trips succeed from the Rust spike Worker
    against the dev index.
  - Files: `apps/api-rust/src/platform/vectorize.rs` or
    `docs/runbooks/discovery-rust-decision.md`.
