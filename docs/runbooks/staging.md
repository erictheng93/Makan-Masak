# Staging Runbook

Staging is a full, isolated copy of the stack in the **same Cloudflare account**
as production: its own Workers, D1 databases, KV namespaces, R2 buckets, queue,
Vectorize index and Pages projects. Every resource name ends in `-staging` and no
cron triggers run. The apps and the API are served from
`<name>-staging.makanmasak.com` (see "Hostnames" below); the other Workers stay
on `workers.dev`.

**Staging can find bugs; it cannot prove production safe.** Its D1 is built from
the `migrations_fresh` baseline, while production was built from the legacy
track and still differs (table count, STRICT, column history; see CLAUDE.md).
A migration that replays cleanly here can still fail there, so the
prod-schema-copy rehearsal in CLAUDE.md stays mandatory before any production
migration.

## Hostnames

| Host | Serves |
| --- | --- |
| `api-staging.makanmasak.com` | API Worker (`custom_domain` route in `apps/api/wrangler.toml`) |
| `admin-staging.makanmasak.com`, `kitchen-staging.makanmasak.com`, `customer-staging.makanmasak.com` | `makanmasak-frontends-staging`, a proxy Worker in `scripts/staging/frontend-proxy/` that forwards to the `*-staging.pages.dev` projects |

They must share a site with the API. The CSRF cookie (`__Host-mm_csrf`) and the
staff refresh cookie are `SameSite=Lax`, so from `*.pages.dev` to
`*.workers.dev` the browser sends neither: every write failed
`CSRF_TOKEN_INVALID` and no session survived a reload. The proxy exists only
because a Pages custom domain needs a DNS record, and the wrangler OAuth token
has no DNS write scope; a Workers `custom_domain` creates its own. The
`*.pages.dev` URLs still load but cannot write. `check-production-config`
allows `<name>-staging.makanmasak.com` in staging config and rejects every other
`makanmasak.com` host there.

**Rule: staging is where walkthroughs, migration rehearsals and rollback drills
happen.** Do the order -> kitchen -> POS checkout walkthrough here before a
release, replay a new migration against staging's D1 before it touches
production, and practise `wrangler rollback` / `pnpm rollback:api` here first.
Nothing in staging is real data; it can be reset at any time.

## Inventory: what production uses, and the staging counterpart

Source: `apps/*/wrangler.toml` `[env.production]`, root and per-app package
scripts, `scripts/check-production-config.cjs`.

### Workers

| Worker | Production | Staging | Entry |
| --- | --- | --- | --- |
| API (Hono) | `makanmasak-api-prod`, `api.makanmasak.com` | `makanmasak-api-staging` | `apps/api` |
| Realtime (+ Durable Object `RealtimeSession`) | `makanmasak-realtime-prod`, `realtime.makanmasak.com` | `makanmasak-realtime-staging` | `apps/realtime` |
| Management API | `makanmasak-management-api-prod`, `manage-api.makanmasak.com` | `makanmasak-management-api-staging` | `apps/management-api` |
| Image processor | `makanmasak-image-processor-prod`, `images.makanmasak.com` | `makanmasak-image-processor-staging` | `apps/image-processor` |
| Backup scheduler | `makanmasak-backup-scheduler-prod` (`crons = []`) | **not staged** (no schedule, nothing to rehearse) | `apps/backup-scheduler` |

Pages: `makanmasak-customer` / `-admin` / `-kitchen` (+ `-management`,
`-onboarding`, not staged) -> `makanmasak-customer-staging`,
`makanmasak-admin-staging`, `makanmasak-kitchen-staging`.

### Storage and bindings

| Resource | Production | Staging | Bound by |
| --- | --- | --- | --- |
| D1 platform | `makanmasak-prod` (`4e3c7ba8-...`) | `makanmasak-staging` | api `DB`, realtime `DB`, image-processor `DB`, management `PLATFORM_DB` |
| D1 control plane | `makanmasak-management-prod` | `makanmasak-management-staging` | management `MANAGEMENT_DB` |
| KV `CACHE_KV` | shared api / realtime / management | `makanmasak-cache-staging` | same three |
| KV `RATE_LIMIT_KV` | api | `makanmasak-ratelimit-staging` | api |
| KV `BACKUP_KV` | api, backup-scheduler | `makanmasak-backup-staging` | api |
| KV `TOKEN_BLACKLIST` | shared api / realtime / image-processor | `makanmasak-tokenblacklist-staging` | same three |
| KV `DEPLOYMENT_STATUS_KV` | management | `makanmasak-deployment-status-staging` | management |
| KV `IMAGE_CACHE` | image-processor | `makanmasak-image-cache-staging` | image-processor |
| R2 `BACKUP_STORAGE` / `AUDIT_ARCHIVE` | `makanmasak-backups-prod` | `makanmasak-backups-staging` | api / management |
| R2 `IMAGES_BUCKET` | `makanmasak-images-prod` | `makanmasak-images-staging` | image-processor |
| R2 `BUNDLE_STORAGE` | `makanmasak-management-bundles-prod` | `makanmasak-management-bundles-staging` | management |
| Queue (producer + consumer, api) | `makanmasak-search-sync-prod` + DLQ `-dlq-prod` | `makanmasak-search-sync-staging` + `-dlq-staging` | api |
| Vectorize | `makanmasak-discovery-prod` (1024 dim, cosine) | `makanmasak-discovery-staging` | api `DISCOVERY_VECTORIZE` |
| Workers AI | `AI` binding | `AI` binding | api |
| Analytics Engine | `makanmasak-metrics-prod` | `makanmasak-metrics-staging` (auto-created on first write) | api `ANALYTICS` |
| Durable Object | `RealtimeSession` in `makanmasak-realtime-prod` | `RealtimeSession` in `makanmasak-realtime-staging` | api `REALTIME_SESSION`, realtime |
| Service binding | api `MANAGEMENT_API` -> `makanmasak-management-api-prod` | -> `makanmasak-management-api-staging` | api |
| Native rate limiters | api 1001-1003, realtime 2001-2002 | same config (namespace ids are per-Worker labels) | api, realtime |
| `send_email` | `NOTIFICATION_EMAIL` (api), `ONBOARDING_NOTIFICATION_EMAIL` (management) | bindings kept for parity; management email is switched off (`ONBOARDING_EMAIL_ENABLED=false`) | api, management |

Cron triggers: production api has eight (`0 2`, `0 3`, `0 3 SUN`, `30 2`, `0 *`,
`*/5`, `15 2`, `0 4`), image-processor `0 1 * * *`, management `30 18 * * *`.
Staging sets `crons = []` on all three; the top-level api and image-processor
crons are inherited otherwise, so the explicit empty list matters.

Placement: production api pins `aws:ap-northeast-1`; staging does not.

### Vars that differ

Staging vars live in `[env.staging.vars]`. `NODE_ENV` stays `"production"` so
production-only code paths (strong-key crypto, CORS, auth) behave as in
production; `ENVIRONMENT = "staging"` is what labels it. `CORS_ORIGIN`,
`CLIENT_BASE_URL`, `API_BASE_URL` point at the `*-staging.makanmasak.com` hosts;
`CENTRAL_API_URL`, `REALTIME_WS_URL` at `workers.dev`. `QUOTA_ENFORCEMENT_MODE` is `warn` (staging
shops have no subscription). The `__WORKERS_SUBDOMAIN__` token in those URLs is
your account's `workers.dev` subdomain, filled in by `provision.cjs`.

### Secrets (names only)

Set with `wrangler secret put <NAME> --env staging` or
`node scripts/staging/provision.cjs --apply --secrets`.

| Worker | Generated by provision (internal) | Needs a REAL third-party value (optional) |
| --- | --- | --- |
| api | `JWT_SECRET`, `QR_SIGNING_KEY` (>= 32 chars), `ENCRYPTION_KEY`, `INTERNAL_API_TOKEN` | SMS vendor (`MITAKE_USERNAME`+`MITAKE_PASSWORD` or `EVERY8D_UID`+`EVERY8D_PWD` or `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`+`TWILIO_PHONE_NUMBER`), `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET`, `LINEPAY_WEBHOOK_SECRET`, `MARKET_CHECKOUT_*`, `CREDIT_TOPUP_*`, `WEB_PUSH_VAPID_*`, `CLOUDFLARE_API_TOKEN` (Analytics read), `SLACK_WEBHOOK_URL`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, `UBER_EATS_*` |
| realtime | `JWT_SECRET` (same value as api) | `SLACK_WEBHOOK_URL` |
| management-api | `JWT_SECRET` (same value), `INTERNAL_API_TOKEN` (same as api) | `CF_API_TOKEN` + `CF_ACCOUNT_ID` / `PLATFORM_CF_*` (managed provisioning), `SLACK_WEBHOOK_URL`, `PLATFORM_NOTIFICATION_EMAIL(_FROM)` |
| image-processor | `JWT_SECRET` (same value) | `SLACK_WEBHOOK_URL` |

`JWT_SECRET` must be identical on api, realtime, management-api and
image-processor, and `INTERNAL_API_TOKEN` on api and management-api. Provision
generates each once and stores it in `.wrangler/staging-secrets.json`
(gitignored, mode 0600), so re-runs never rotate a value the Workers already
hold. The cash order -> kitchen -> POS flow needs **none** of the third-party
values. Phone OTP login answers 503 without an SMS vendor, and there is no dev
OTP echo (`NODE_ENV` is production), so use the staff accounts and guest table
orders. Cloud payment providers cannot be exercised on staging without sandbox
credentials.

## Provision

Prerequisites: `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`,
`pnpm install --frozen-lockfile`, `pnpm wrangler login` as the account owner.

1. Find the account's workers.dev subdomain (dashboard: Workers & Pages ->
   Account details; or it appears in the URL of any workers.dev deploy). If the
   account has never registered one, register it in the dashboard first.
2. Dry run (default, touches nothing, no login needed):

   ```bash
   node scripts/staging/provision.cjs
   ```

3. Create everything, fill the ids into the tomls and run both migration tracks
   against the staging D1s (a full replay of `migrations_fresh/` plus
   `apps/management-api/migrations/`):

   ```bash
   node scripts/staging/provision.cjs --apply --workers-subdomain <subdomain>
   ```

   Re-running is safe: existing resources are reused, wrangler skips applied
   migrations, and substituted placeholders are not touched again.
   `--skip-migrations` skips step 3's migrations. The script refuses any
   resource not named `*-staging` and any `--env` other than `staging`.

4. Review and commit the filled-in `apps/*/wrangler.toml` and
   `apps/*/.env.staging` (ids and the subdomain are not secrets).

## Deploy

Order matters because of bindings: realtime first (api binds its Durable
Object), then management-api (api's service binding), then api, image-processor,
and the frontends. This differs from the usual api-first listing on purpose:
deploying api before the two Workers it binds to fails.

```bash
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
pnpm --filter @makanmasak/realtime        run deploy:staging
pnpm --filter @makanmasak/management-api  run deploy:staging
pnpm --filter @makanmasak/api             run deploy:staging
pnpm --filter @makanmasak/image-processor run deploy:staging
node scripts/staging/provision.cjs --apply --secrets --skip-migrations   # first time only
pnpm --filter makanmasak-customer-app    run deploy:staging
pnpm --filter makanmasak-admin-dashboard run deploy:staging
pnpm --filter makanmasak-kitchen-display run deploy:staging
pnpm exec wrangler deploy -c scripts/staging/frontend-proxy/wrangler.toml   # first time, or when its host map changes
```

`deploy:staging` for a Worker refuses to run while a `STAGING_*_ID` or
`__WORKERS_SUBDOMAIN__` placeholder is still in `wrangler.toml`; the frontend
`build:staging` does the same for `.env.staging`. Frontends build with
`vite build --mode staging` (`apps/*/.env.staging`, public URLs only) and deploy
to the `makanmasak-<app>-staging` Pages project on branch `main`. These scripts
are not part of `pnpm deploy:prod` (`pnpm -r run deploy:prod`).

Smoke test: `curl https://api-staging.makanmasak.com/info`.

## Seed

```bash
node scripts/staging/seed.cjs            # dry run, writes nothing
node scripts/staging/seed.cjs --apply    # writes SQL + credentials, runs it on makanmasak-staging
```

Seeds, all via idempotent upserts on fixed ids:

- `staging-a` "Staging 測試餐廳" and `staging-b`: **`is_demo = 0`** (a demo shop
  rejects orders with `DEMO_RESTAURANT`), `enable_shop_mode = 1`, currency TWD.
- staging-a: owner, chef, cashier; 2 categories, 6 menu items (prices are TWD
  integer cents, e.g. NT$180 = 18000); tables 1-3 with signed table QR URLs
  (HMAC with the staging `QR_SIGNING_KEY`, base `CLIENT_BASE_URL`).
- staging-b: owner and a `chef` (same username as shop A, to exercise per-shop
  usernames), 2 menu items.
- A platform administrator `staging-admin` (`admin_tier = administrator`).
- A `shop_subscriptions` row per shop with every module on. Without it every
  module-gated route (kitchen, POS) answers 403 `SUBSCRIPTION_NOT_FOUND`.
- No POS register: creating one is part of the walkthrough (owner only).

Passwords are random, hashed with bcryptjs at cost 10 and written in plaintext
**only** to `.wrangler/staging-credentials.json` (gitignored, 0600, never
printed). Re-running reuses them; `--rotate` issues new ones. That file also
lists the three table QR URLs. If `QR_SIGNING_KEY` changes, re-run the seed to
re-sign the tables.

Login: shop code `staging-a` (or `staging-b`) + username, at the staging admin
dashboard and kitchen display.

## Walkthrough: order -> kitchen -> POS checkout

1. Open a table QR URL from the credentials file on a phone (customer app),
   add items, place the order as a guest.
2. Log in to the admin dashboard (`https://admin-staging.makanmasak.com/s/staging-a`)
   as `cashier` and accept the order under Orders. The kitchen only shows
   `confirmed` orders, so a guest order stays off the board until staff accept it.
3. Log in to the kitchen display (`https://kitchen-staging.makanmasak.com/s/staging-a`)
   as `chef`; the order should be on the board, and moving it through the
   statuses should reach the other screens over the realtime WebSocket.
4. If there is no register yet, log in as `owner` and add one under POS ->
   Register Management. As the cashier, select it, start a shift, then take
   payment (cash) under POS -> Checkout. A cashier's refund goes to an owner
   for approval.
5. Log in as `staging-b` / `chef` to confirm the same username resolves to a
   different person per shop, and that a login without a shop answers
   `SHOP_REQUIRED`.

## Migration rehearsal and rollback drills

- New migration: land it in `packages/database/migrations_fresh/`, then
  `pnpm exec wrangler d1 migrations apply makanmasak-staging --remote --env staging --config apps/api/wrangler.toml`
  and run the walkthrough. Only then apply to production.
- Rollback drill: `cd apps/api && pnpm exec wrangler versions list --env staging`,
  `pnpm exec wrangler rollback <version-id> --env staging`. The
  `pnpm rollback:api` floor guard is production-only.

## Reset

Light reset (keeps every resource): re-run `node scripts/staging/seed.cjs --apply`
to repair the seeded rows and re-sign the table QR codes, and clear test orders
with `pnpm exec wrangler d1 execute makanmasak-staging --remote --env staging --config apps/api/wrangler.toml --command "<DELETE ...>"`
(child tables first). Full reset: tear the staging D1 down (see Teardown),
`wrangler d1 create makanmasak-staging`, put the new id into the tomls in place
of the old one, `provision.cjs --apply` to replay the migrations, then seed.

## Teardown

Run from an interactive shell only. `scripts/check-no-automated-destructive-wrangler.cjs`
keeps these out of automation, and wrangler answers its confirmation prompt
itself when stdin is not a terminal. Confirm every name ends in `-staging`
before you press enter; never pass `--env production`.

```bash
cd apps/api              && pnpm exec wrangler delete --env staging
cd apps/realtime         && pnpm exec wrangler delete --env staging
cd apps/management-api   && pnpm exec wrangler delete --env staging
cd apps/image-processor  && pnpm exec wrangler delete --env staging
pnpm exec wrangler d1 delete makanmasak-staging
pnpm exec wrangler d1 delete makanmasak-management-staging
pnpm exec wrangler kv namespace delete --namespace-id <id>      # six namespaces, ids in the tomls
pnpm exec wrangler r2 bucket delete makanmasak-backups-staging  # likewise -images- and -management-bundles-
pnpm exec wrangler queues delete makanmasak-search-sync-staging # and -dlq-staging
pnpm exec wrangler vectorize delete makanmasak-discovery-staging
pnpm exec wrangler pages project delete makanmasak-customer-staging # and -admin-, -kitchen-
```

Then restore the `STAGING_*` placeholders in the tomls (or
`git checkout` the pre-provision versions) and delete `.wrangler/staging-*.json`.

## Guards

`pnpm check:prod-config` also enforces staging isolation: every staging resource
name ends in `-staging`, no staging id equals a production id, staging has no
routes and no production domain in its vars or `.env.staging`, and no production
section contains a staging placeholder. Tests: `tests/unit/staging-scripts.test.ts`.
