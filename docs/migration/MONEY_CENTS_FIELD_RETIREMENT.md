# Money Cents Field Retirement Plan

Last reviewed: 2026-09-12

## Production state verified 2026-09-12 (issue #334) — the cutover is live

**The destructive cutover has already been applied to `makanmasak-prod`.**
Everything below this section describes how to get there; nothing below still
needs doing. Measured read-only against production on 2026-09-12 (`SELECT`
only, via `pnpm exec wrangler d1 execute makanmasak-prod --remote --env
production --json --command ...`):

**1. The ledger already carries the cutover.** `d1_migrations` holds the
**pre-squash fresh-track** filenames, applied in a single batch:

| id | name | applied_at |
| --- | --- | --- |
| 24 | `0023_integrity_audit_and_money_cents.sql` | 2026-07-24 09:26:16 |
| 28 | `0027_money_cents_retirement_audit.sql` | 2026-07-24 09:26:17 |
| 67 | `0067_money_cents_retirement_rollout_guard.sql` | 2026-07-24 09:26:32 |
| 69 | `0069_discount_percentage_bps.sql` | 2026-07-24 09:26:32 |
| 70 | `0070_money_cents_cutover.sql` | 2026-07-24 09:26:33 |
| 71 | `0071_market_checkout_child_order_cents_cutover.sql` | 2026-07-24 09:26:33 |

Those are the `migrations_fresh/0070`/`0071` this document says were squashed
away — the files are gone from the working tree, but they ran first and the
ledger rows outlived them. The legacy track's own `0070`/`0071` are unrelated
(`restaurant_service_items` / `catalog_item_types`); its copies of these steps
are `0085`–`0088`. **No ledger write is needed, and nothing needs to be
replayed.**

**2. The schema is at the terminal state.** No table in production has a REAL
money column. 13 tables carry a REAL column at all — 29 columns, every one
non-monetary:

| Table | REAL columns |
| --- | --- |
| `restaurants` | `latitude`, `longitude`, `rating` |
| `markets`, `dish_search_index` | `latitude`, `longitude` |
| `menu_items` | `rating` |
| `ai_insights_cache` | `confidence_score` |
| `menu_item_ingredients` | `quantity_per_serving` |
| `ingredient_definitions` | `min_stock_level`, `current_stock` |
| `ingredient_stock_movements` | `delta`, `balance_after` |
| `shift_templates` | `overtime_multiplier` |
| `leave_types` | `accrual_amount`, `carryover_max_days`, `payment_rate`, `max_usage_per_year` |
| `leave_requests` | `total_days` |
| `employee_leave_balances` | `total_days`, `used_days`, `pending_days`, `carryover_from_previous`, `carryover_to_next`, `manual_adjustment` |
| `employee_schedules` | `scheduled_hours`, `actual_hours`, `overtime_hours` |

That is exactly the 29 `real()` columns the Drizzle schema declares, and every
one is on the "ratios, percentages, ratings, coordinates, fractional leave
days" list this document excludes from the retirement.

Checked positively as well, per the drop table further down: all 19 tables the
cutover touched carry their `*_cents` columns as `INTEGER`, carry the four
`*_bps` columns as `INTEGER`, and carry **none** of the 61 retired legacy
columns. Row counts at the time of measurement:

| Table | Rows | | Table | Rows |
| --- | --- | --- | --- | --- |
| `orders` | 7 | | `partnerships` | 0 |
| `order_items` | 8 | | `partnership_plans` | 0 |
| `menu_items` | 23 | | `partnership_usage_logs` | 0 |
| `coupons` | 0 | | `verified_members` | 0 |
| `coupon_usage` | 0 | | `market_checkout_child_orders` | 0 |
| `group_orders` | 2 | | `market_checkout_sessions` | 0 |
| `group_cart_items` | 1 | | `market_checkout_payments` | 0 |
| `split_bills` | 1 | | `payment_transactions` | 0 |
| `cash_shifts` | 0 | | `receipts` | 4 |
| `cash_movements` | 0 | | `usage_events` | 1,303 |
| `refunds` | 0 | | | |
| `dish_search_index` | 23 | | | |
| `ingredient_definitions` | 3 | | | |
| `shift_templates` | 0 | | | |

`receipts` and `usage_events` were checked too and are not money surfaces —
`receipts` stores rendered text, `usage_events.quantity` is a meter count.
Production is nearly empty, so read this as "the shape is right", not as "the
write paths are proven".

**3. FK orphan audit: clean.** Every one of the 69 production tables with a
`restaurant_id` column has a declared foreign key to `restaurants(id)` — the
declared-FK list and the has-the-column list are identical, so the
`restaurant_fk` rebuild left nothing behind. `COUNT(*) ... WHERE restaurant_id
IS NOT NULL AND restaurant_id NOT IN (SELECT id FROM restaurants)` returns **0
for all 69**, and `SELECT COUNT(*) FROM pragma_foreign_key_check` returns 0
across the whole database. The 45 tables the squashed
`migrations_fresh/0028`–`0039` rebuilt are a strict subset of those 69.

**4. `migrations/0087` and `0088` are inert and stay on disk.** They sit on
`packages/database/migrations/`, which no `wrangler.toml` references, and the
work they describe is already applied to the only database that could have
wanted them. They are kept as the readable record of what was run — the fresh
track's copies were squashed away, so deleting these would leave the cutover
with no executable text anywhere. **Do not replay them against any database
that already has the cutover**: they begin by `DROP COLUMN`-ing columns that no
longer exist and would fail on the first statement.

A schema-level regression guard now backs this up:
`packages/database/src/testing/money-cents-retirement-rollout.test.ts` walks the
Drizzle schema objects and fails on any REAL column whose name carries a money
word (`price`, `amount`, `total`, `fee`, `cost`, `subtotal`, `tax`, `discount`,
`tip`, `balance`) unless it ends `_cents`/`_bps` or appears in a small
documented non-money allowlist. The text assertions elsewhere in that file only
fire when someone writes a migration; this one fires on a `real("price")` added
straight to a table.

## Current State

**Update 2026-08-21 — the fresh track was squashed.** `migrations_fresh/` is now
a single `0000_baseline_strict.sql`; every per-file migration this document
names on that track was deleted. The squash landed in commit `6ac283b0`, whose
subject reads `test(api): type the markets integration envelopes against the
services` — it swept up a staged squash along with unrelated test work, so
`git log -- packages/database/migrations_fresh` points at a title that does not
mention it.

Two consequences for everything below:

- The baseline carries the **end state** those steps produced (no legacy `REAL`
  money columns, `*_cents` and `*_bps` columns present) but not the steps
  themselves. A guard that aborts a cutover cannot be reconstructed from it.
- The executable per-step SQL survives only on the legacy track
  (`packages/database/migrations/`), and **no `wrangler.toml` points at that
  directory** (see CLAUDE.md). Anyone running the runbook below against a
  pre-squash production database has to apply those files deliberately; they
  are not picked up by `pnpm db:migrate:prod`. Whether that is the intended
  end state is a decision for whoever performed the squash.

**Update 2026-07-05:** The destructive cutover described below as future work has
been written. `packages/database/migrations_fresh/0070_money_cents_cutover.sql`
and `0071_market_checkout_child_order_cents_cutover.sql` (both since squashed
away, see above; paired at the time with the
legacy/Wrangler track's `0087`/`0088` in `migration-dual-track.json`) drop the
legacy `REAL` money columns, each self-guarded by a `CHECK (violation_count = 0)`
assertion table so the migration aborts if the rollout/audit preconditions
aren't met. Current Drizzle schema (e.g. `packages/database/src/schema/orders.ts`)
has zero remaining legacy `REAL` money columns — only `*_cents` columns exist.
Whether these migrations have been *run* against production D1 (vs.
merged into the repo) is a deployment fact, not verifiable from the schema —
confirm via deployment logs or `pnpm wrangler d1 execute` before relying on this
for further cleanup work (e.g. dropping the now-unused sync triggers).

### Original plan (superseded by the above; kept for context)

The cents migration was originally intentionally incomplete. The Drizzle schema
kept legacy `REAL` money columns beside newer integer `*_cents` shadow columns.
The fresh migrations backfilled cents values and added sync triggers, but did
not remove the old `REAL` columns. Migration
`0067_money_cents_retirement_rollout_guard.sql` was a dedicated non-destructive
rollout gate, not the destructive cutover — that cutover is `0070`/`0071` above.

## In Scope

These schema surfaces currently have money-like `REAL` columns with cents
counterparts or planned cents counterparts:

- Orders: `orders`, `order_items`
- Menu and discovery: `menu_items`, `dish_search_index`
- Coupons: `coupons`, `coupon_usage`
- Group ordering: `group_orders`, `group_cart_items`, `split_bills`
- POS: `cash_shifts`, `cash_movements`, `refunds`
- Partnerships: `partnerships`, `partnership_plans`,
  `partnership_usage_logs`, `verified_members`
- Secondary money surfaces: `ingredient_definitions.cost_per_unit`,
  `shift_templates.hourly_rate`

Do not treat every `REAL` column as money. Ratios, percentages, ratings,
coordinates, fractional leave days, and other non-currency numeric values should
remain outside this migration unless a separate domain decision says otherwise.
Percentage discount values are also special: when `discount_type` is
`percentage`, the percentage lives in the legacy value column and the cents
column should remain `NULL`.

## Exit Criteria Before Table Rebuild

- Every production write path populates the relevant `*_cents` value directly,
  or is covered by a verified database trigger during the transition window.
- Every production read path treats cents as authoritative. Legacy `REAL`
  values may only be used as compatibility fallback while old rows are still
  being audited.
- Public API contracts are explicit about whether values are decimal currency
  amounts or integer cents.
- `data_integrity_audit` shows zero unresolved mismatches between legacy `REAL`
  values and `*_cents` values for all in-scope tables.
- Null handling is verified for nullable money fields such as refund amounts,
  max discount caps, end-of-shift amounts, and optional costs.
- Percentage discount rows are excluded from fixed-money cents checks.

## Required Data Audit

Migration `0027_money_cents_retirement_audit.sql` writes one row per table or
logical surface, plus an aggregate REAL precision check, into
`data_integrity_audit` using the `money_cents_retirement` scope.

Each audit check counts rows where:

- the cents column is `NULL` while the money value should have cents,
- the cents column is non-`NULL` while the legacy value is `NULL`,
- `*_cents != CAST(round(real_column * 100) AS integer)`, except approved
  percentage fields,
- the legacy value has more than two decimal places and needs business review
  before cents-only retirement.

Representative pattern:

```sql
INSERT OR REPLACE INTO data_integrity_audit
  (scope, table_name, column_name, check_name, severity, violation_count,
   sample_values, details)
SELECT
  'money_cents_retirement',
  'orders',
  'total_amount',
  'real_cents_mismatch',
  'error',
  count(*),
  (SELECT group_concat(id, ',') FROM (
    SELECT id
      FROM orders
     WHERE total_amount_cents IS NULL
        OR total_amount_cents != CAST(round(total_amount * 100) AS integer)
     LIMIT 5
  )),
  'orders.total_amount_cents must match rounded legacy total_amount before REAL column retirement.'
FROM orders
WHERE total_amount_cents IS NULL
   OR total_amount_cents != CAST(round(total_amount * 100) AS integer);
```

## Dedicated Rollout Guard

The first rollout artifact is deliberately separated from FK rebuilds,
timestamp cleanup, product changes, and the eventual destructive table rebuild:

- Fresh track: squashed into `0000_baseline_strict.sql` — the guard step no
  longer exists there
- Legacy track:
  `packages/database/migrations/0085_money_cents_retirement_rollout_guard.sql`

This guard is executable SQL. It creates an expected
`money_cents_retirement` audit inventory, writes rollout status rows into
`data_integrity_audit` using the `money_cents_retirement_rollout` scope, and
then asserts with `_migration_assert_money_cents_retirement_rollout` that:

- every expected audit row exists,
- every `money_cents_retirement` error row has `violation_count = 0`.

If either assertion fails, the D1 migration fails before any table is rebuilt.
That failure is intentional because the legacy `REAL` columns are still the
only rollback-friendly comparison source.

Run the guard through the normal migration commands:

```bash
pnpm check:migration-dual-track
pnpm db:migrate:prod
```

Before a destructive cutover migration is generated, inspect the rollout rows:

```bash
pnpm exec wrangler d1 execute makanmasak-prod \
  --remote \
  --env production \
  --config=./apps/api/wrangler.toml \
  --command "SELECT scope, table_name, column_name, check_name, violation_count, sample_values FROM data_integrity_audit WHERE scope IN ('money_cents_retirement', 'money_cents_retirement_rollout') AND severity = 'error' ORDER BY scope, table_name, column_name, check_name;"
```

Production must show zero-violation rollout rows before a destructive
cutover migration is generated.

## Final Cutover Migration

The destructive cutover artifact is paired across both migration tracks:

- Fresh track: squashed into `0000_baseline_strict.sql` — the drop-column step
  no longer exists there
- Legacy track:
  `packages/database/migrations/0087_money_cents_cutover.sql`

It repeats the rollout and percentage-bps assertions, drops legacy cents-sync
triggers and legacy price indexes, removes only the retired legacy `REAL`
money / polymorphic discount columns with `ALTER TABLE ... DROP COLUMN`, then
recreates the price indexes on cents columns. It also keeps the partnership
usage aggregate triggers, but rewrites them to update `*_cents` totals instead
of retired legacy amount columns.

The migration records row counts before and after the destructive step and
asserts both unchanged row counts and an empty `pragma_foreign_key_check`
result through `_migration_assert_money_cents_cutover`.

## Automated Guard Coverage

`packages/database/src/testing/money-cents-retirement-rollout.test.ts` tracks
the rollout guard inventory. It asserts that both migration tracks contain the
dedicated guard, that the guard fails when an audit row is missing, that it
fails when a tracked audit row has a nonzero violation count, and that it writes
clean `money_cents_retirement_rollout` status rows only after complete clean
audit coverage.

Any new money-like `REAL` field must be added to the inventory, given a cents
counterpart, and covered by the retirement audit before it can be considered
safe for future table rebuild retirement work.

## Current Code Convergence

The service layer is still transitional, but these paths now treat cents as the
authoritative source while preserving decimal API responses:

- analytics, system health, POS reports, POS receipts, payment checks, and
  refund checks,
- coupon validation, available-coupon responses, fixed discount value/cap/minimum
  order formatting, and coupon usage stats,
- database and API group-order cart totals, split bills, payment amount checks,
  and group-order summaries,
- platform integration order ingestion,
- order item/menu snapshot fallbacks and legacy realtime new-order payloads.

Future money-field work should not reintroduce legacy `REAL` writes or
fallback reads after this cutover. Any later FK, timestamp, or table-layout
rebuild work should be planned separately from money-field retirement.

## Drop-Column Cutover Migration Requirements

The approved cutover method for this retirement is `ALTER TABLE ... DROP
COLUMN`, not create-copy-rename table rebuilds. D1/SQLite supports dropping
these non-key legacy columns in place, and the paired cutover migration has
been verified through fresh D1 migration replay.

Because `DROP COLUMN` does not copy table rows, it cannot accidentally skip or
duplicate rows the way a rebuild `INSERT SELECT` can. A before/after row-count
inventory over every touched table is still kept as a belt-and-suspenders
guard, including `split_bills`, but per-table rebuild row-copy assertions are
not required for this cutover.

Cloudflare D1 enforces foreign keys during migrations, so the destructive
cutover still begins with:

```sql
PRAGMA defer_foreign_keys = ON;
```

For the cutover:

- repeat the rollout and percentage-bps audit assertions before any destructive
  operation,
- record row counts for every touched table before dropping columns,
- drop legacy cents-sync triggers and legacy price indexes that reference
  retired columns,
- drop only the retired legacy `REAL` money / polymorphic discount columns with
  `ALTER TABLE ... DROP COLUMN`,
- recreate the needed indexes and triggers against cents / bps columns,
- assert row counts are unchanged and `PRAGMA foreign_key_check` is clean,
- keep schema-shape tests that verify retired columns are absent and cents / bps
  columns are retained.

The cutover migration must not be bundled with unrelated FK cleanup, timestamp
cleanup, or product behavior changes.

## Destructive Cutover Runbook

Do not apply the destructive drop-column migration until all of these are true:

- `0085_money_cents_retirement_rollout_guard.sql` has passed in production.
  (Its fresh-track twin `0067_...` was squashed away; the legacy-track file is
  the only executable copy left.)
- `0086_discount_percentage_bps.sql` has
  passed in production. This migration preserves percentage
  discount values in explicit basis-point columns before polymorphic
  `discount_value` columns are retired.
- Production `money_cents_retirement_rollout` rows have `violation_count = 0`.
- Production `money_cents_retirement` rows with
  `check_name = 'percentage_bps_missing_or_mismatch'` have
  `violation_count = 0`.
- Drizzle schema and application write paths no longer require the legacy
  `REAL` columns.

When those gates are met, use one dedicated cutover migration, with no FK,
timestamp, or product behavior changes. Drop legacy columns in this component
order:

1. Leaf/search/inventory surfaces: `dish_search_index`,
   `ingredient_definitions`.
2. Scheduling component: `shift_templates`.
3. Partnership component: `partnership_usage_logs`, `partnership_plans`,
   `verified_members`, and `partnerships`.
4. Group-order component: `group_cart_items`, `split_bills`, and
   `group_orders`.
5. Coupon/order component: `coupon_usage`, `order_items`, `coupons`, and
   `orders`.
6. POS component: `cash_movements`, `refunds`, and `cash_shifts`.

The final migration must omit only these legacy `REAL` money / polymorphic
discount columns and must retain the paired cents columns plus explicit
percentage basis-point columns:

| Table | Legacy columns to omit | Cents / percentage columns to retain |
| --- | --- | --- |
| `orders` | `subtotal`, `tax_amount`, `service_charge`, `discount_amount`, `total_amount`, `refund_amount` | `subtotal_cents`, `tax_amount_cents`, `service_charge_cents`, `discount_amount_cents`, `total_amount_cents`, `refund_amount_cents` |
| `order_items` | `unit_price`, `total_price` | `unit_price_cents`, `total_price_cents` |
| `menu_items` | `price`, `original_price`, `cost_price` | `price_cents`, `original_price_cents`, `cost_price_cents` |
| `coupons` | `discount_value`, `max_discount_amount`, `min_order_amount` | `discount_percentage_bps`, `discount_value_cents`, `max_discount_amount_cents`, `min_order_amount_cents` |
| `coupon_usage` | `discount_amount`, `original_amount`, `final_amount` | `discount_amount_cents`, `original_amount_cents`, `final_amount_cents` |
| `group_orders` | `total_amount`, `tax_amount`, `service_charge`, `final_amount` | `total_amount_cents`, `tax_amount_cents`, `service_charge_cents`, `final_amount_cents` |
| `group_cart_items` | `unit_price`, `total_price` | `unit_price_cents`, `total_price_cents` |
| `split_bills` | `subtotal`, `tax_amount`, `service_charge`, `discount_amount`, `tip_amount`, `total_amount` | `subtotal_cents`, `tax_amount_cents`, `service_charge_cents`, `discount_amount_cents`, `tip_amount_cents`, `total_amount_cents` |
| `cash_shifts` | `start_amount`, `end_amount`, `expected_amount`, `actual_amount`, `difference_amount`, `total_sales`, `total_refunds`, `cash_sales`, `card_sales`, `digital_sales` | `start_amount_cents`, `end_amount_cents`, `expected_amount_cents`, `actual_amount_cents`, `difference_amount_cents`, `total_sales_cents`, `total_refunds_cents`, `cash_sales_cents`, `card_sales_cents`, `digital_sales_cents` |
| `cash_movements` | `amount` | `amount_cents` |
| `refunds` | `original_amount`, `refund_amount` | `original_amount_cents`, `refund_amount_cents` |
| `dish_search_index` | `price` | `price_cents` |
| `ingredient_definitions` | `cost_per_unit` | `cost_per_unit_cents` |
| `shift_templates` | `hourly_rate` | `hourly_rate_cents` |
| `partnerships` | `default_discount_value`, `total_discount_given`, `total_revenue` | `default_discount_percentage_bps`, `default_discount_value_cents`, `total_discount_given_cents`, `total_revenue_cents` |
| `partnership_plans` | `discount_value`, `max_discount_amount`, `min_order_amount`, `max_order_amount`, `total_discount_given`, `total_revenue` | `discount_percentage_bps`, `discount_value_cents`, `max_discount_amount_cents`, `min_order_amount_cents`, `max_order_amount_cents`, `total_discount_given_cents`, `total_revenue_cents` |
| `partnership_usage_logs` | `discount_value`, `discount_amount`, `original_amount`, `final_amount` | `discount_percentage_bps`, `discount_value_cents`, `discount_amount_cents`, `original_amount_cents`, `final_amount_cents` |
| `verified_members` | `total_discount_received`, `total_spending` | `total_discount_received_cents`, `total_spending_cents` |

`discount_value` and `default_discount_value` are intentionally listed as
polymorphic discount columns, not pure money columns. They may be omitted only
after the matching `*_percentage_bps` audit rows prove that every percentage
row has been backfilled and every non-percentage row keeps the percentage bps
column `NULL`.

The destructive migration should repeat the guard at the top:

```sql
PRAGMA defer_foreign_keys = ON;

DROP TABLE IF EXISTS `_migration_assert_money_cents_cutover`;
CREATE TABLE `_migration_assert_money_cents_cutover` (
  `check_name` text PRIMARY KEY NOT NULL,
  `violation_count` integer NOT NULL CHECK (`violation_count` = 0)
);

INSERT INTO `_migration_assert_money_cents_cutover`
SELECT
  'money_cents_retirement_rollout.preflight_zero_errors',
  COALESCE((
    SELECT `violation_count`
      FROM `data_integrity_audit`
     WHERE `scope` = 'money_cents_retirement_rollout'
       AND `table_name` = '_rollout'
       AND `column_name` = 'legacy_real_amounts'
       AND `check_name` = 'preflight_zero_errors'
  ), 1);

INSERT INTO `_migration_assert_money_cents_cutover`
SELECT
  'money_cents_retirement_rollout.audit_coverage_present',
  COALESCE((
    SELECT `violation_count`
      FROM `data_integrity_audit`
     WHERE `scope` = 'money_cents_retirement_rollout'
       AND `table_name` = '_rollout'
       AND `column_name` = 'audit_rows'
       AND `check_name` = 'audit_coverage_present'
  ), 1);

INSERT INTO `_migration_assert_money_cents_cutover`
SELECT
  'money_cents_retirement.percentage_bps_zero_errors',
  count(*)
FROM `data_integrity_audit`
WHERE `scope` = 'money_cents_retirement'
  AND `severity` = 'error'
  AND `check_name` = 'percentage_bps_missing_or_mismatch'
  AND `violation_count` != 0;
```

Then each table block must drop only the listed legacy columns:

1. Drop indexes and triggers that reference retired columns.
2. `ALTER TABLE <table> DROP COLUMN <legacy_column>` for each retired column.
3. Recreate indexes plus only non-legacy triggers against cents / bps columns.
4. After all drops, update `_migration_money_cents_cutover_counts` and insert a
   row-count assertion into `_migration_assert_money_cents_cutover`.

Before marking the destructive migration complete, run:

```sql
PRAGMA foreign_key_check;
```

## Verification Commands

Before opening the retirement PR:

```bash
pnpm typecheck
pnpm test -- --run packages/database
pnpm db:migrate:local
```

Run any added migration test directly if the workspace test command supports
targeted execution.
