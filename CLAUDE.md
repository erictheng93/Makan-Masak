# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MakanMasak is a modern, serverless restaurant management system built on Cloudflare's edge computing platform. The system provides online ordering, menu management, table management, and multi-role user access with real-time functionality. It supports multiple restaurants/shops with their own menus, tables, and staff, delivered through a scalable, cost-effective SaaS architecture.

## Technology Stack

- **Frontend**: Vue.js 3 + TypeScript (Cloudflare Pages)
- **Backend**: Cloudflare Workers + TypeScript
- **Database**: Cloudflare D1 (SQLite-compatible serverless SQL)
- **Cache**: Cloudflare KV Store
- **Real-time**: Durable Objects (WebSocket connections)
- **File Storage**: Cloudflare R2
- **Build System**: Turborepo (parallel builds with caching)
- **Backup**: Cloudflare Workers Cron + R2
- **Print**: Local Node.js agent (Express + WebSocket)
- **Security**: Cloudflare WAF + Zero Trust

## Applications Overview

`pnpm dev` starts every app in this monorepo in parallel via turbo **except `apps/print-agent`**, which is excluded from the default filter (run `pnpm dev:print-agent` separately when you need the local print daemon). The full map:

| App | Type | Local port(s) | Notes |
| --- | --- | --- | --- |
| `apps/api` | Cloudflare Worker (wrangler) | 8787 | Main public/admin REST API (Hono) |
| `apps/management-api` | Cloudflare Worker (wrangler) | 8789 | Central management API (multi-tenant control plane) |
| `apps/realtime` | Cloudflare Worker + Durable Object | 8788 | WebSocket realtime sessions |
| `apps/image-processor` | Cloudflare Worker (wrangler) | 8790 | Cloudflare Images transforms |
| `apps/backup-scheduler` | Cloudflare Worker (cron) | — | Scheduled backup trigger |
| `apps/customer-app` | Vite (Vue) | 3000 | Customer-facing ordering UI |
| `apps/admin-dashboard` | Vite (Vue) | 3001 | Restaurant admin/staff UI |
| `apps/kitchen-display` | Vite (Vue) | 3002 | Kitchen display system |
| `apps/management-portal` | Vite (Vue) | 3010 | Platform management portal |
| `apps/onboarding-app` | Vite (Vue) | 3011 | Tenant onboarding flow |
| `apps/print-agent` | Local Node.js (tsx) | 3003 (HTTP), 3004 (WS) | ESC/POS print daemon |

`pnpm dev:api`, `pnpm dev:customer`, `pnpm dev:admin`, `pnpm dev:kitchen` are the most common per-app filters; see `package.json` for the full `dev:*` script list.

## Database (Cloudflare D1)

### Schema & Migrations

- **Source of Truth**: Drizzle schema files in `packages/database/src/schema/` (includes subdirectories)
- **Migration Tracks**: wrangler applies two of them, against two different
  databases. `packages/database/migrations_fresh/` is the **platform** track —
  `apps/api`, `apps/realtime` and `apps/management-api`'s `PLATFORM_DB` binding
  all point at it, production included. It was squashed into a single
  `0000_baseline_strict.sql`, regenerable with
  `node scripts/generate-strict-baseline.cjs`. `apps/management-api/migrations/`
  is the **control-plane** track, reached only through that app's
  `MANAGEMENT_DB` binding (`makanmasak-management-prod` in production); it ships
  with `pnpm db:migrate:prod:mgmt`, which is a different command from
  `pnpm db:migrate:prod`. Two more directories look like tracks and are not:
  neither `packages/database/migrations/` nor `packages/database/migrations_v2/`
  is referenced by any `wrangler.toml`. Despite the "deployment track" name,
  `migrations/` is applied by nothing, and replaying it from empty fails 107
  statements. Do not add migrations to either expecting them to ship.
- **Production's schema did not come from the baseline.** That `migrations_dir`
  points at the fresh track says where wrangler reads from; it says nothing about
  how the live database was built. `makanmasak-prod` was migrated off the legacy
  track and its `d1_migrations` ledger still carries those filenames
  (`0000_loose_skin.sql` … `0084_customer_auth_identities.sql`). The squash
  renamed everything underneath it, so for a while wrangler read every fresh file
  as unapplied — `0000_baseline_strict.sql` included — and
  `pnpm db:migrate:prod` would have replayed the whole baseline over a live
  125-table database. `migrations_fresh/0001`–`0005` had in fact never reached
  production; they were applied by hand on 2026-08-22 and recorded, and the
  baseline was then recorded as applied purely to mean **"never run this file
  against prod"** (issue #240). `migrations list` is clean again and
  `pnpm db:migrate:prod` is safe for 0006 onward.

  That ledger row is **not** a claim that the live schema equals the baseline:
  production has 126 tables against the baseline's 117, and the two lineages
  still differ. Never use it as evidence that they match — a rebuild-from-
  baseline or a schema diff has to establish that separately. (126 counts
  everything but `sqlite_%` and `d1_%`; the 120 in the STRICT bullet below drops
  the fts5 shadow tables as well. The two figures describe the same database
  under different exclusions, and both were re-measured 2026-09-06.)
- **Before applying anything to production D1 by hand**: `wrangler d1 export`
  fails on this database (`cannot export databases with Virtual Tables (fts5)`),
  so build the schema copy by pulling `sql` out of `sqlite_master` instead.
  Replay the migration against that copy, check the end state (no leftover
  `__new_*` tables, STRICT still on the recreated tables), and only then run
  `d1 execute --file` against `--remote`, verify with `pragma_table_info`, and
  `INSERT OR IGNORE INTO d1_migrations`. Check row counts first: a
  recreate-table migration is only trivially safe while the table is empty.
- **Migration Guard**: changes after the reviewed checkpoint must be paired or documented in `packages/database/migration-dual-track.json`, then verified with `pnpm check:migration-dual-track`.
- **ID Strategy**: mixed by design while legacy modules remain. New domain tables should prefer `TEXT` UUID v7 primary keys, but existing integer-autoincrement tables are still valid until a scoped migration retires them. Do not claim the whole database is UUID-only.
- **Timestamp Strategy**: use `INTEGER` Unix milliseconds via Drizzle `{ mode: "timestamp_ms" }`. Avoid new `TEXT` timestamp columns.
- **Idempotency Strategy**: nullable idempotency/event keys on payment, webhook, billing, or retryable write paths require a DB-level partial unique index such as `WHERE idempotency_key IS NOT NULL`.
- **STRICT Tables**: D1 supports `CREATE TABLE ... ) STRICT`, and without it SQLite's
  flexible typing silently stores TEXT in an `INTEGER NOT NULL` column. New tables
  must be created `STRICT`. drizzle-kit cannot emit the keyword, so you write it
  by hand — including on the `__new_*` staging table in the recreate-table dance,
  which otherwise renames a non-STRICT table over a STRICT one and drops the
  constraint with no visible diff. Policy and checkpoints
  live in `packages/database/strict-table-policy.json`; `pnpm check:strict-tables`
  enforces both rules for migrations, not the live schema. All 117 tables in the
  baseline are already STRICT, but production was built from the legacy track and
  is almost entirely non-STRICT: **5 of 120** non-shadow tables
  (`coupons`, `ingredient_stock_movements`, `print_agents`, `receipts`,
  `restaurant_customers`) — measured against production on 2026-09-06 right
  after `0019` was applied. The first four were first measured 2026-09-02 after
  `0016` shipped and did not move for `0017` or `0018`, both of which are
  `ALTER TABLE` and add no tables. `coupons` is the fifth and the first legacy
  table to become STRICT by being **recreated**: `0019` rebuilt it to move
  `valid_from` / `valid_to` to `_ms` INTEGER (#271) and carried `) STRICT` on
  the `__new_coupons` staging table by hand. So the ratio moves two ways — a
  new table arrives STRICT, and a recreate-table migration converts one — but
  the remaining 115 legacy tables stay unprotected until something recreates
  them.

  The "15 of 119" this file and issue #297 previously recorded was an artifact of
  the query, not a real count. `sql LIKE '%STRICT%'` is a substring match, so it
  also matches `ON DELETE RESTRICT` (9 tables, `orders` and
  `credit_ledger_entries` among them) and the column name `di**strict**`
  (`restaurants`, `markets`, `dish_search_index`). The keyword only counts as the
  table option after the closing paren. Recheck production with:

  ```sql
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN sql LIKE '%STRICT%' THEN 1 ELSE 0 END) AS buggy_do_not_use,
         SUM(CASE WHEN trim(replace(sql, char(10), ' ')) LIKE '%) STRICT'
                  THEN 1 ELSE 0 END) AS strict_tables
  FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE '%_fts%' AND name NOT LIKE 'd1_%';
  ```

  Type contamination has not actually occurred yet: 721 INTEGER columns across
  the 114 non-STRICT tables that have any, 0 non-integer cells (2026-09-01). Read
  that as "production is nearly empty" rather than "the write paths are proven" —
  88 of those tables have no rows at all and the whole database held 1,352 rows
  when measured. Re-measure once real traffic lands; `docs/production-strict-type-audit.md`
  has the reusable command block, including the `_cf_KV` table that returns
  `SQLITE_AUTH [7500]` deterministically and must be excluded from any sweep.

  For raw `env.DB.prepare(...)` writes to legacy production tables, validate
  integer timestamps and amounts in the service layer; TypeScript/Drizzle types
  alone do not protect that database.
- **Secret Storage**: OAuth credentials, access/refresh tokens, client secrets, and webhook secrets must be stored only in encrypted payload fields. JSON config columns are for non-secret flags and preferences.

```bash
pnpm db:migrate:local   # Apply migrations locally (platform + management D1)
pnpm db:reset:local     # Reset local database (clears all data)
pnpm db:seed:local      # Seed local database (scripts/seed-local.sql)
```

**Adding New Tables**: write the Drizzle schema in `packages/database/src/schema/`,
export it from `index.ts`, **hand-write** the migration SQL as the next sequential
file in `packages/database/migrations_fresh/`, add the migration-track entry when
applicable, then run `pnpm db:migrate:local`.

`pnpm db:generate` exists as a script but is not the workflow here, and running it
is not a safe default. Its snapshot state under `migrations_fresh/meta/` still
describes the pre-squash lineage — a nine-entry journal tagged `0000_loose_skin` …
`0014_feedback-schema`, with snapshots stopping at `0006` — so drizzle-kit would
diff the schema against a state that has not existed since the squash and write
the result straight into the live track (`out: "./migrations_fresh"`). Every
migration from `0001_print_agents.sql` onward was written by hand, and none of
them has a snapshot.

## Development Setup

### Prerequisites

- Node.js 22+ (`package.json` engines requires `>=22.13.0`)
- pnpm 10+ (required — repo pins `pnpm@10.24.0` via `packageManager`; engines floor is `>=8.0.0`, enforced via `.npmrc`)
- Cloudflare Account (paid plan for D1, R2, Images)

### Quick Start

```bash
pnpm install            # Must use pnpm (not npm/yarn)
pnpm wrangler login     # Authenticate with Cloudflare
pnpm db:migrate:local   # Run database migrations
pnpm dev                # Start all apps in parallel
```

### Environment Variables

**Secrets (never commit):**

```env
CLOUDFLARE_API_TOKEN=your_api_token
JWT_SECRET=your_jwt_secret
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
```

Put these in `.env.local` or the Cloudflare secret store — never in any committed file.

**Frontend dev defaults (committed):**

There are **5 Vite apps** in `apps/`. Three of them ship a team-shared `.env.development` checked into the repo so that `pnpm dev` works out of the box with no `cp` step:

- `apps/customer-app/.env.development` (port 3000)
- `apps/admin-dashboard/.env.development` (port 3001)
- `apps/kitchen-display/.env.development` (port 3002)

The remaining two Vite apps do **not** currently ship a `.env.development` — they either rely on Vite defaults or read from `.env.development.local` only:

- `apps/management-portal` (port 3010)
- `apps/onboarding-app` (port 3011)

These committed `.env.development` files only contain localhost URLs (API proxy path, local WS ports) and feature flags — zero secrets.

To override for your personal setup (port collision, remote API, etc.), create `.env.development.local` in the same directory — it's gitignored and takes precedence over `.env.development`. Each app with a committed `.env.development` also has a `.env.development.example` you can copy as a starting point.

**Rule:** anything matching `SECRET|TOKEN|KEY|PASSWORD` belongs in `.env.local` only. `.env.development` is for localhost URLs and flags, nothing else.

## Multi-Role Access System

- **0: Admin** - Full system access
- **1: Shop Owner (店主)** - Restaurant management. Day managers currently share this role rather than having one of their own (`features/manager/routes/actions.ts`)
- **2: Chef (廚師)** - Kitchen display system
- **3: Service Crew (送菜員)** - Order fulfillment
- **4: Cashier (收銀)** - Payment processing
- **5: Customer** - Customer registration and ordering (shop QR mode), and the customer-facing resources under `/api/v1/customers/*`

## Development Commands

```bash
# Development
pnpm dev                # Start all apps in parallel
pnpm dev:api            # API only
pnpm dev:customer       # Customer app only
pnpm dev:admin          # Admin dashboard only
pnpm dev:kitchen        # Kitchen display only

# Verification (see "Two verification tiers" below — use these, not the raw commands)
pnpm verify             # Inner loop: typecheck + lint + test, affected packages only
pnpm verify:push        # Pre-push gate: the full CI-equivalent gate, once

# Testing
pnpm test               # All vitest tests (unit + feature)
pnpm test:unit          # Unit tests only
pnpm test:e2e           # End-to-end tests (Playwright)
pnpm test:e2e:ui        # E2E with Playwright UI
pnpm test:ci            # CI pipeline tests (unit + e2e)
pnpm test:coverage      # Tests with coverage report
pnpm test:visual        # Visual regression tests (Playwright screenshots)
pnpm test:visual:update # Update screenshot baselines

# Type checking & linting
pnpm typecheck          # TypeScript check (all packages)
pnpm lint               # Lint all packages
pnpm lint:fix           # Auto-fix lint issues

# Deployment
pnpm deploy:prod        # Deploy to production
```

### Two verification tiers

**Do not run the full suite after every edit.** `pnpm verify` after each
meaningful change; `pnpm verify:push` once, before pushing. Both live in
`scripts/verify.sh`.

| | `pnpm verify` | `pnpm verify:push` |
| --- | --- | --- |
| Scope | packages affected vs the merge-base with `main` | every package, the root `tests/` project, and real integrations |
| Contents | typecheck, lint, test | plus prettier, i18n coverage, the `check:*` guards, and real integrations — mirrors `.github/workflows/test.yml` |
| When | after each edit | once, before pushing |

Both tiers go through turbo, so unchanged packages are cache hits rather than
re-runs. That is what makes the full gate affordable: it still accounts for
every package, but only re-executes the ones whose inputs moved. Cache
correctness rests on `$TURBO_DEFAULT$` inputs plus `dependsOn: ["^build"]` —
a change in `packages/database` invalidates every dependent app's test task.

**`pnpm verify` checks nothing once the work is committed to `main`.** The
affected set is the diff against the merge-base with `main`, so committing on
`main` moves that merge-base along with `HEAD` and the set goes empty. Turbo
then prints

```
• Running typecheck, lint, test in 0 packages
WARNING  No tasks were executed as part of this run.
✓ typecheck + lint + test (affected)   All checks passed (3s total)
```

That green says "nothing was checked", not "everything passed" — and three
seconds is the only thing distinguishing the two. It bites exactly one
workflow, commit-straight-to-`main`-then-verify: **un**committed changes on
`main` are still seen, and so is committed work on a branch, whose merge-base
is the branch point rather than `HEAD`.

Name the scope explicitly instead. Both of these resolve correctly (verified
against a three-commit `apps/print-agent` change):

```bash
TURBO_SCM_BASE=HEAD~3 pnpm verify          # reuses verify.sh, keeps its concurrency cap
pnpm exec turbo run typecheck lint test --filter=./apps/print-agent
```

`TURBO_SCM_BASE` needs no `globalPassThroughEnv` entry — turbo reads it for
itself rather than forwarding it to the tasks.

Never narrow a task's `inputs` in `turbo.json` to an explicit allow-list like
`src/**`. `packages/shared` keeps tests in `utils/`, and a missed input means a
stale cache HIT reported as a pass. Subtract from `$TURBO_DEFAULT$` instead.

**Every package that has tests needs its own `vitest.config.ts`.** Without one,
`vitest` walks up and finds the root config, then resolves its `projects`
entries relative to the package — `packages/database` failed for exactly this
reason with `Projects definition references a non-existing file or a directory:
packages/database/apps/admin-dashboard`. Two further rules follow from
per-package execution:

- A package's `test` script must be a single-shot `vitest run`. A bare `vitest`
  is watch mode and hangs turbo forever. Put watch mode in `test:watch`.
- A package with a `test` script but no test files yet needs
  `vitest run --passWithNoTests`. Plain `vitest run` exits 1 on "No test files
  found", which reddens the whole run (`packages/queue-service`).
- Tests must not build paths from `process.cwd()`. Anchor on
  `fileURLToPath(new URL("../../..", import.meta.url))` instead, or the test
  only passes when invoked from the repo root.

A standalone config does **not** inherit the root `resolve.alias` block, so
repeat the `@makanmasak/*` aliases in it. Dropping them silently switches
resolution from package source to built `dist/`, which is a different thing to
be testing.

**Bound both factors of the test-process product.** `turbo run test` starts one
vitest per package and each of those forks its own workers, so the number of
live node processes is `(turbo concurrency) x (workers per package)`. Neither
factor is bounded by default: vitest picks `availableParallelism() - 1` — 23 on
a 24-core box, 3 on a 4-core one — and turbo's default concurrency is 10.
Measured on a 24-core host, `apps/kitchen-display` alone peaked at 26 node
processes, so a full `turbo run test` reaches ~260 against 16 GB of RAM. That is
issue #202: the gate failed for want of memory, not for want of a passing test.

- Every per-package `vitest.config.ts` spreads `sharedTestConfig` from the root
  `vitest.shared.ts`. The ceiling cannot live in the root `vitest.config.ts` —
  a per-package vitest invocation reads that package's own config as its root
  and never sees the root file. `scripts/check-package-test-scripts.cjs` fails
  if a config omits the spread.
- `scripts/verify.sh` caps the other factor with `--concurrency`, defaulting to
  half the cores. Bounding one factor alone is not enough; #202 recorded that
  `--concurrency=2` by itself still ran the machine out of memory.
- Raise both together where there is room:
  `TURBO_CONCURRENCY=10 VITEST_MAX_WORKERS=4 pnpm verify:push`.
- `VITEST_MAX_WORKERS` only reaches the tasks because `turbo.json` lists it in
  `globalPassThroughEnv` — turbo's strict env mode silently drops anything not
  declared, which makes a broken override look like a working one. For the same
  class of reason `vitest.shared.ts` is in `globalDependencies`: it sits outside
  every package's `$TURBO_DEFAULT$` inputs, so without that entry a changed
  ceiling comes back as a stale cache HIT.

**Keep `@types/node`, `jsdom` and `terser` on one version each.** These three are
peer dependencies of vite/vitest, and pnpm keys an instance by its whole peer
set — so a package declaring `@types/node: ^20` while the root declares `^25`
does not get a shared vitest, it gets a *second copy*. The repo carried 7 vitest
and 5 vite instances that way. The root workspace runner (`pnpm exec vitest run`,
which is what CI runs) loads every project's config through `Promise.all`, and
two different vite copies mid-load trip a Node race:

```
Cannot require() ES Module .../vite/dist/node/index.js because it is not yet
fully loaded.   code: 'ERR_INTERNAL_ASSERTION'
```

That surfaces as the whole suite failing at startup with zero tests run, roughly
one run in six — the kind of red that gets waved through as "just re-run it".
`pnpm.overrides` in the root `package.json` pins all three, and the per-package
declarations were aligned to match so they do not contradict the override.
`package.json` takes no comments, which is why the reason is recorded here.

Adding a package that declares its own version of any of the three re-splits the
graph. Check what is **linked**, not what is left in the virtual store:

```bash
for m in node_modules apps/*/node_modules packages/*/node_modules; do
  [ -L "$m/vitest" ] && readlink "$m/vitest"
done | sed 's#.*\.pnpm/##' | sort -u
```

One line out means every package shares one instance; two or more names the peer
set that split it (the `_@types+node@NN` segment is usually the culprit).

Do **not** use `ls node_modules/.pnpm/vitest@*` for this — it counts directories,
and pnpm leaves the pre-consolidation ones behind. Measured 2026-08-21 right after
`pnpm install --frozen-lockfile`: that `ls` printed 7 entries (peers `@types/node`
20.19.28 / 22.19.5 / 24.10.7 / 25.0.7) while the lockfile resolved a single
`@types/node@25.0.7` and every live symlink pointed at the same instance. Six of
the seven were orphans. They are harmless — nothing links to them — but they make
the check read as a permanent false alarm. `rm -rf node_modules && pnpm install`
clears them if the count matters to you.

### One worktree per session

`turbo --affected` and `vitest --changed` both derive scope from the git diff of
the tree they run in. Several sessions sharing one working tree means every
session's "affected" set contains every other session's work, and the
incremental scope collapses back toward a full run.

```bash
scripts/session-worktree.sh <branch>   # new worktree + shared cache + install
scripts/session-worktree.sh            # link an existing worktree to the shared cache
```

The turbo cache is deliberately **not** isolated — it is content-addressed, so a
package another session already checked at the same content hash is a free hit
here. The script symlinks each worktree's `.turbo/cache` to
`~/.cache/turbo/makanmasak` (override with `MAKAN_TURBO_CACHE_DIR`) and links
the gitignored `.env.local` and `.wrangler` local state from the primary
worktree.

## Common Tasks

### QR Code Generation

- Individual QR: `POST /api/v1/qr/generate`
- Bulk generation: `POST /api/v1/qr/bulk`
- Shop QR: `POST /api/v1/restaurants/:id/qr/shop/generate`
- Seat QR: `POST /api/v1/seats/batch-create`

### User Role Management

- API: `POST/PUT /api/v1/users/{restaurant_id}`
- Role definitions: `apps/api/src/shared/constants/index.ts`

### Menu Items

- API: `POST /api/v1/menu/{restaurant_id}/items`
- Frontend: Admin dashboard → Menu Management

## Performance Targets

- **API Response Time**: P99 < 300ms
- **Database Query Time**: P95 < 100ms
- **Image Load Time**: P90 < 1s
- **WebSocket Latency**: < 50ms

## Security

- AES-256 encryption for sensitive data
- Bcrypt password hashing (cost factor 10)
- JWT tokens with secure refresh logic
- WAF rules, rate limiting (per-IP and per-user)
- Complete audit trail, role-based access control (RBAC)

### Shop QR codes are public identifiers, not credentials

`shopQrCode` (`SHOP-{restaurantId}-{ts}`) is handed to anyone who asks, by
design — `GET /api/v1/restaurants/:id` returns it, and so does
`GET /api/v1/discovery/restaurants/:id/takeaway-eligibility`. That is what lets
a customer start a takeaway order from discovery or a market page without
physically scanning anything (`DiscoveryView.vue`, `MarketDetailView.vue`).

Consequences, in order of how often they get forgotten:

- **Never treat possession of the code as proof of presence.** "Verify the shop
  QR, then issue a short-lived capability that guest-orders checks" adds nothing:
  the attacker fetches the code from a public endpoint first. Replacing it with a
  high-entropy random token does not help either, because the same endpoints
  would hand out the new token.
- **What it legitimately does:** identify which restaurant a scan refers to, and
  tell the server whether the sticker in someone's hand is the current one.
  `assertShopQrCurrent` (`features/orders/services/shop-mode-gate.ts`) compares it
  only to retire superseded stickers after a regeneration — a revocation check,
  not authentication.
- **Abuse control must stand on its own.** Guest ordering is rate limited per
  (restaurant, IP) in `features/guest-orders/services/guest-order-throttle.ts`,
  layered under the global per-IP limiter. Do not re-key the global limiter by
  restaurant: that multiplies an attacker's budget by the number of restaurants
  instead of shrinking it.
- Table and seat QR codes are different — those carry an HMAC signature
  (`buildSignedQRUrl`) and are not public. Do not generalize this note to them.

## Coding Conventions

### UI/UX Design System (Enforced)

All frontend UI design and implementation MUST follow the **Apple-Native Soft Minimalism** design system. It is written in two places: `docs/UIUX-design-system.md` is the long-form spec, and `DESIGN.md` at the repo root is the current statement of the palette, which is defined once in `design-tokens.js` and shared by all five Vue apps.

`pnpm check:design-palette` enforces the palette — from `.husky/pre-commit`, from `pnpm verify:push`, and from CI. It rejects the hues the system does not have (purple, indigo, violet, fuchsia, pink) and raw hex duplicates of a token, so reach for a token rather than a literal colour.

**Key rules:**

- Page background: `#F2F2F7` (iOS system gray)
- Cards: white + `rounded-2xl` ~ `rounded-3xl` + soft shadow (`opacity ≤ 8%`)
- No hard borders — use shadow + background color difference for separation
- Buttons/tags: pill-shaped (`rounded-full`)
- Text: never pure black, use `#1C1C1E`; strong title/body contrast
- Colors: `#007AFF` (primary), `#34C759` (success), `#FF9500` (warning), `#FF3B30` (error)
- Icons: SF Symbols / Lucide Icons, outline/filled toggle
- Animations: 200-350ms, ease-out, iOS-native feel
- Output: Vue + Tailwind CSS with `ios-*` color tokens (see Section 14.2 of design doc)
- **Always check the Section 15 Design Checklist before outputting UI**

### Error Response Format (Enforced)

All API error responses MUST use the unified format:

```typescript
{
  success: false,
  error: {
    code: string,       // e.g. "NOT_FOUND", "VALIDATION_ERROR"
    message: string,    // user-safe message (auto-sanitized)
    details?: unknown   // optional: field-level validation errors
  }
}
```

**How to use:**

- Throw `ApiError` from route handlers/services — the global `app.onError` handler formats it automatically
- Use factory functions: `notFound()`, `badRequest()`, `unauthorized()`, `forbidden()`, `conflict()` from `apps/api/src/shared/utils/api-error.ts`
- Do NOT write try-catch in route handlers for error formatting — let errors propagate to the global handler
- Validation middleware and auth middleware already produce this format

**Example:**

```typescript
import { notFound } from "../../../shared/utils/api-error";

app.get("/:id", async (c) => {
  const item = await service.getById(id);
  if (!item) throw notFound("Item not found", "ITEM_NOT_FOUND");
  return c.json({ success: true, data: item });
});
```

### Database Query Strategy (Two Layers — Enforced)

All database queries MUST use one of the two approved layers. Raw string SQL (Layer 3) is **banned** in new code.

| Layer                                    | When to use                           | Column safety   |
| ---------------------------------------- | ------------------------------------- | --------------- |
| **Layer 1: Drizzle Query Builder**       | CRUD, simple JOINs, filters           | ✅ Compile-time |
| **Layer 2: Drizzle `sql` + Schema Refs** | Complex analytics, CTEs, aggregations | ✅ Compile-time |

**Why:** Raw SQL string column names silently drift when schema migrates. Both Layer 1 and Layer 2 reference Drizzle schema objects, so column renames cause **compile-time errors** instead of runtime 500s.

**Layer 1 — Drizzle Query Builder** (CRUD, simple queries):

```typescript
import { eq, and } from "drizzle-orm";
import { menuItems } from "@makanmasak/database";

const results = await db
  .select()
  .from(menuItems)
  .where(eq(menuItems.restaurantId, id));
```

**Layer 2 — Drizzle `sql` template + Schema References** (complex analytics):

```typescript
import {
  sql,
  eq,
  and,
  between,
  menuItems,
  orders,
  orderItems,
} from "@makanmasak/database";

const result = await db
  .select({
    itemName: menuItems.name,
    totalOrders: sql<number>`COUNT(DISTINCT ${orders.id})`,
    totalRevenue: sql<number>`SUM(${orderItems.totalPrice})`,
  })
  .from(menuItems)
  .leftJoin(orderItems, eq(menuItems.id, orderItems.menuItemId))
  .leftJoin(orders, eq(orderItems.orderId, orders.id))
  .where(
    and(
      eq(orders.restaurantId, restaurantId),
      between(orders.createdAt, new Date(startMs), new Date(endMs)),
    ),
  )
  .groupBy(menuItems.id);
```

**Reference implementations:**

- Layer 1: `apps/api/src/features/integrations/services/PlatformIntegrationService.ts`
- Layer 2: `packages/ai-analytics/src/services/ProductAnalysisService.ts`

### Testing Standards (Enforced)

All new tests MUST follow these conventions. Existing tests are being migrated progressively.

**1. Prefer local test builders/helpers when present:**

```typescript
function buildUser(overrides = {}) {
  return { id: 1, role: 1, restaurantId: "rest-1", ...overrides };
}
```

Keep builders close to the owning test file or shared in an existing local
test helper. Do not import `@makanmasak/testing-utils`; that workspace package
does not currently exist.

**2. Verify mock calls (not just return values):**

```typescript
// Every vi.fn() mock for external calls (DB, API, WebSocket, cache) must have verification
expect(mockService.createOrder).toHaveBeenCalledOnce();
expect(mockService.createOrder).toHaveBeenCalledWith(
  expect.objectContaining({ restaurantId: "1" }), // structural match, NOT exact
);
```

- Use `expect.objectContaining()` — never exact-match timestamps, UUIDs, or generated values
- Use `expect.any(String)`, `expect.any(Number)` for non-deterministic fields

**3. No CSS class assertions:**

```typescript
// BAD — breaks when Tailwind classes change
expect(wrapper.classes()).toContain("bg-green-500");

// GOOD — test behavior, not styling
expect(wrapper.find('[data-status="active"]').exists()).toBe(true);
expect(wrapper.text()).toContain("已完成");
expect(wrapper.vm.statusClass).toBe("active");
```

Use `data-testid`, `data-status`, `aria-*` attributes, text content, or Vue computed state instead.

**4. Never cold-import a large module graph inside a timed test body** (#211):

```typescript
// BAD — the first await import() of a big graph pays its whole transform cost
// against the 5s (10s in apps/api) testTimeout. Measured in this repo:
// @/router ~3s, an api feature ./index ~7s, vite.config ~1.5s, the i18n
// static-messages catalog ~2.3s — and a loaded machine multiplies that 3-4x,
// which is exactly the "fails under turbo, passes standalone" flake.
it("resolves routes", async () => {
  const { default: router } = await import("@/router");
});

// GOOD — pay the first import once in beforeAll under the hook's own budget;
// in-body imports then only re-evaluate already-transformed modules (~100ms).
beforeAll(async () => {
  await import("@/router");
}, 30_000);
```

- If tests call `vi.resetModules()` (or need import-time side effects under
  per-test mocks/fake timers), add `vi.resetModules()` at the end of the
  warm-up `beforeAll` — the transform cache survives; only cheap re-evaluation
  runs per test.
- A test that times out mid-navigation can leak its pending async work (e.g.
  `location.assign`) into the next test — a second sub-second failure right
  after a timeout is usually contamination, not a separate bug.
- Known-heavy imports: `@/router` (any Vite app), `./api` / service clients,
  `vite.config`, api feature `./index` barrels, `@makanmasak/i18n/static-messages`.
  A graph that is fully `vi.mock`ed is fine — the mocks keep it small.

**5. Pre-commit checks:** `lint-staged` itself runs ESLint and Prettier only,
but it is not the whole hook. Husky invokes `.husky/pre-commit` with `sh -e`,
so the first non-zero exit aborts the commit, and four more scripts run after
lint-staged:

- `scripts/check-visual-baselines.cjs` — rejects `*-darwin.png` /
  `*-win32.png` baselines; CI only accepts `*-linux.png`
- `scripts/audit-module-gates.cjs`
- `scripts/check-no-automated-destructive-wrangler.cjs`
- `scripts/check-design-palette.cjs` — rejects the hues the design system does
  not have and raw hex duplicates of a token. A hook is skippable and used to
  crash on Windows, so this one also runs in `pnpm verify:push` and in CI

A fifth check is inline in the hook rather than a script: when a staged
`*.test.ts` / `*.spec.ts` uses `Factory.build` or `Factory.buildList` without
`resetAllFactories()`, it prints `⚠️ 警告`. It only warns — it never fails the
commit, so treat it as advice, not a gate. There is no
`scripts/check-factory-usage.cjs` in this repository; that inline block is
what "the factory check" refers to.

## Error Handling

### Common Issues

1. **D1 Connection Errors**: Check wrangler.toml bindings
2. **KV Cache Misses**: Verify namespace configuration
3. **Image Upload Failures**: Check R2 bucket permissions
4. **WebSocket Disconnections**: Monitor Durable Objects health
5. **Windows: `pnpm dev` fails with `*** std::terminate() called with no exception` followed by `MiniflareCoreError [ERR_RUNTIME_FAILURE]`**: First seen on wrangler 4.84.x (the repo now pins `^4.127.1`), this is a Windows regression triggered by **any** `inspector_port = N` line inside the `[dev]` block of a `wrangler.toml`. It reproduces on every port value (9229/9230/9500, etc.), on both Node 22 and Node 24, and on every installed workerd binary — port availability is not the factor; the toml field itself crashes the InspectorProxyWorker. **Every Workers app that has a `[dev]` block — `api`, `management-api`, `realtime`, `image-processor` — already has `inspector_port` commented out** in its `wrangler.toml` with an inline note (`backup-scheduler` is cron-only and has no `[dev]` block). Do not reintroduce it. If you need a pinned DevTools port, pass it via CLI flag (`wrangler dev --inspector-port N`) instead, which does not crash. Debug hint: first line to run if you see `std::terminate` in a future wrangler bump is `grep -rn "^inspector_port" apps/`.

### Debug Tools

- Worker logs: `pnpm wrangler tail`
- **Health endpoints** — three public ones plus an authenticated deep check, and they are not interchangeable:

  | Endpoint | Checks dependencies? | Use for |
  | --- | --- | --- |
  | `GET /info` | **No** — returns static metadata (version, deployment mode, endpoint list) | "Is the Worker running?" Smoke tests, LB liveness. Cheapest, no bindings touched |
  | `GET /api/v1/monitoring/health` | **Yes** — D1 `SELECT 1` + a KV read, plus API latency/error rate from Analytics Engine | "Are the dependencies healthy?" Dashboards, alerting, frequent polling |
  | `GET /api/v1/system/health` | **Yes** — same D1 probe, plus the same read-only KV probe | Either is fine to poll. This one additionally reports `servedByPrimary`/`servedByRegion` for the D1 read |
  | `GET /api/v1/system/health?deep=1` | **Yes** — D1, plus a KV put + get + background delete, plus an uptime-evidence write | Proving the KV **write** path. **Requires a bearer token** — the public exemption is path-matched and deliberately does not cover this |

  `/health` redirects to `/api/v1/monitoring/health`. That response is a bare
  payload (`{overall, components}`), not the unified `{success, data}` envelope.

  `/api/v1/system/health/ready` and `/live` are kubernetes-style probes and
  **require a bearer token**.

- **KV writes are ~4x a KV read and ~4.5x the D1 probe — put none of them on a
  public path.** Measured against production on 2026-09-05, Worker in APAC
  (post-#322): D1 `SELECT 1` ~95ms, KV read ~210ms, each KV write ~420ms. The
  public `/api/v1/system/health` used to spend three write-class round trips
  per anonymous call (probe put + get + delete, then an uptime-evidence put)
  and answered in 900–1500ms; it is now one read alongside the D1 probe,
  concurrently. `probeCache` reads a sentinel key it never writes for exactly
  this reason (#324).

- **Every probe times its own segment.** `runBasicHealthCheck` used to report
  `Date.now() - startTime` for both checks against one clock started before the
  D1 query, so whatever D1 spent was counted a second time inside the KV
  number. That is where #324's "KV is three times D1" came from: 115–169ms of
  the 356–421ms it attributed to KV was the D1 probe, reported twice. Probes
  are now concurrent and each times itself, and the KV check carries a
  `probe: "read" | "read-write"` field so a latency can be read against the
  work that produced it.

- **Health must come from probes, not counters.** `MonitoringService` keeps
  per-isolate in-process counters; deriving health from them alone means an
  isolate that has served no traffic reports perfect health while D1 is down.
  `getHealthStatus()` therefore probes the dependency and consults the counters:
  a failed probe is `critical`, a passing one falls through to the
  counter-derived status so a reachable-but-slow dependency still reads as
  `warning`. Keep both signals if you touch this — they detect different things.
- Note: there is **no** unauthenticated `/api/v1/health` route anymore. The old router was replaced by the System/Monitoring features; public smoke checks should use `/info`.
- Error tracking: Automatic Slack notifications

### codebase-memory MCP: `get_architecture` gotchas

Two fields in `get_architecture` return misleading values. Both are upstream
bugs in the compiled MCP binary (`~/.local/bin/codebase-memory-mcp`, no local
source) — work around them, don't re-diagnose them.

1. **`packages[].fan_in` / `fan_out` are always `0`.** They are simply never
   computed. The `0` does **not** mean "no cross-package dependencies" — the
   underlying `IMPORTS` edges exist and workspace aliases *are* resolved
   (`@makanmasak/database` → `packages/database/src`). Do not conclude that
   tree-sitter failed on alias resolution, and do not fall back to reading
   `package.json` by hand.

   To answer "which app depends on which package", use either:
   - the **`boundaries`** field in the same `get_architecture` response
     (`api→utils` 197 calls, `api→database` 62, …), or
   - `query_graph` for the full import matrix:

   ```cypher
   MATCH (a)-[r:IMPORTS]->(b)
   WHERE b.file_path STARTS WITH 'packages/'
   RETURN a.file_path, b.file_path, count(r) AS n ORDER BY n DESC
   ```

2. **`packages[]` is not a package inventory.** It appears to be truncated to
   the top 15 by `node_count`, so type-only packages fall off. `shared-types`
   is missing despite being the most-imported package in the repo;
   `backup-scheduler` and `onboarding-app` are missing too. Use it as a rough
   "which packages are big" hint only — never as a completeness check.

Cypher note: `query_graph`'s WHERE clause only accepts a **literal** on the
right-hand side. Property-to-property comparison fails to parse regardless of
operator — `a.file_path = b.file_path`, `!=`, and `<>` all error with
`expected value at pos N` pointing just past the left operand. Filter against
literals (`STARTS WITH 'packages/'`, `IS NOT NULL`) and do any cross-property
comparison after the rows come back.

## Documentation

See `docs/README.md` for full documentation navigation, and `docs/archive/CHANGELOG.md` for detailed changelog.

Key references: `docs/UIUX-design-system.md` and `DESIGN.md` — mandatory for all UI work.

---

- Always use context7 when I need code generation, setup or configuration steps, or
  library/API documentation. This means you should automatically use the Context7 MCP
  tools to resolve library id and get library docs without me having to explicitly ask.

## gstack

gstack is installed **user-level only** (`~/.claude/skills/gstack`). This repo
used to vendor its own copy under `.claude/skills/`; that copy was removed on
2026-09-01 because project-scope skills shadow user-scope ones, so the repo was
pinning everyone to a stale gstack (runtime v0.15.16.0, skill prompts from a
~1.5x build) while the binaries resolved to the newer user-level install. Do not
re-vendor it here — install per-developer instead:

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup
```

- Planning/review: `/office-hours`, `/autoplan`, `/spec`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/plan-devex-review`, `/review`, `/devex-review`, `/cso`, `/codex`.
- Ship/ops: `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/health`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/landing-report`.
- Browser/QA: `/browse`, `/qa`, `/qa-only`, `/scrape`, `/skillify`, `/setup-browser-cookies`, `/connect-chrome`, `/pair-agent`.
- Design: `/design-consultation`, `/design-shotgun`, `/design-html`, `/design-review`, `/diagram`, `/make-pdf`.
- Session/safety: `/context-save`, `/context-restore`, `/learn`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/setup-deploy`, `/gstack-upgrade`.
- `/checkpoint` is gone — gstack replaced it with `/context-save` + `/context-restore`.
- If gstack skills aren't working, run `cd ~/.claude/skills/gstack && ./setup` to rebuild the browse binary and re-register skills.
- Use `/browse` for AI-driven QA testing; `mcp__chrome-devtools__*` and Playwright MCP tools are still permitted when explicitly requested.
