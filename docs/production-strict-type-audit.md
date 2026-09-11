# Production STRICT / type-contamination audit (issue #297)

Read-only measurement of `makanmasak-prod`, last run **2026-09-01**. This file exists so
the measurement in issue #297 does not have to be rediscovered. Every statement below is a
`SELECT`.

## Headline result

| Metric | Value (2026-09-01) |
| --- | --- |
| Tables in scope (excl. `sqlite_%`, `%_fts%`, `d1_%`) | 119 |
| Genuinely `STRICT` tables | **3** (`ingredient_stock_movements`, `print_agents`, `receipts`) |
| Non-STRICT tables scanned | 114 (+2 with no INTEGER columns) |
| INTEGER columns scanned | 721 |
| Rows across those tables | 1,352 |
| Integer cells actually evaluated | 5,040 |
| **Type-contaminated cells** | **0** |
| Tables that are completely empty | 88 of 114 |

**Zero contamination — but against a nearly empty database.** 88 of 114 non-STRICT tables
hold no rows at all, and the largest table in the whole scan is `usage_events` at 1,020
rows. `customers`, `credit_accounts`, `credit_ledger_entries`, `coupons`, `user_coupons`
and `customer_auth_identities` are all **empty**; `orders` has 7 rows. So "we measured it
and it is clean" is true but carries very little assurance — it mostly says production has
barely been written to yet, not that the write paths are proven safe.

## Update 2026-09-02

`0015` and `0016` were applied to production on 2026-09-02. The count is now
**4 of 120** — `restaurant_customers` joins the three below, because every new
table ships STRICT. `customer_auth_identities` went from 10 to 17 columns and
is still **not** STRICT, which is exactly the case section 2 of issue #297 warns
about: those seven new columns have no database-level type protection, so
`expiryTimestampMs` validation in the OAuth service is what stands between an
ISO string and the `token_expires_at_ms` INTEGER column.

The contamination measurement below was taken before that migration and is
unaffected by it: both migrations added structure, not rows.

## Correction: the recorded `15 / 119` was wrong

CLAUDE.md and issue #297 both record "15 of 119 tables are STRICT". That number came from

```sql
SUM(CASE WHEN sql LIKE '%STRICT%' THEN 1 ELSE 0 END)
```

`LIKE '%STRICT%'` is a substring match, and SQLite's `LIKE` is case-insensitive for ASCII.
It matches:

- `ON DELETE RESTRICT` — 9 tables (`orders`, `order_items`, `credit_ledger_entries`,
  `credit_accounts`-referencing tables, `market_checkout_*`, `leave_requests`, …)
- the column name `di**strict**` — 3 tables (`restaurants`, `markets`, `dish_search_index`)

All 12 are false positives. The true count is **3**, not 15. Note in particular that
`orders` and `credit_ledger_entries` were listed in #297 as STRICT-by-the-query while the
issue's own DDL excerpt correctly showed they are not — the excerpt was right, the count
was wrong.

### Correct STRICT check

`STRICT` is a table-option that appears *after* the closing paren of the column list, so
test that region rather than the whole DDL:

```sql
SELECT name, sql FROM sqlite_master
WHERE type='table' AND name NOT LIKE 'sqlite_%'
  AND name NOT LIKE '%_fts%' AND name NOT LIKE 'd1_%'
ORDER BY name;
```

then, client-side:

```js
const isStrict = (sql) => /\bSTRICT\b/i.test(sql.slice(sql.lastIndexOf(")") + 1));
```

Do not try to do this with `LIKE` in SQL.

## Gotcha: `API 7500` is `_cf_KV`, not a flake

The earlier attempt on #297 died with `A request to the Cloudflare API ... failed / not
authorized: SQLITE_AUTH [code: 7500]`. It is **deterministic, not transient**: `_cf_KV` is
a Cloudflare-reserved table that the D1 HTTP query API refuses to read. Reproduced in
isolation:

```bash
pnpm wrangler d1 execute makanmasak-prod --remote --env production \
  --config=./apps/api/wrangler.toml --json --command "SELECT COUNT(*) FROM _cf_KV;"
# -> not authorized: SQLITE_AUTH [code: 7500]
```

Any audit that enumerates `sqlite_master` and then queries every table **must exclude
`_cf_KV`**, or one poisoned term fails the whole batch. Retrying will not help.

## Other D1 limits hit while building this

- **`too many terms in compound SELECT: SQLITE_ERROR`** — D1 caps `UNION ALL` terms well
  below stock SQLite. Use one `SELECT` with scalar subqueries
  (`(SELECT COUNT(*) FROM t) AS t__rows, …`) instead of a compound SELECT.
- **`--file` above a few KB switches to the upload/import endpoint**, which returns only a
  summary (`Total queries executed`, `Rows read`) instead of result rows, and reports
  `changed_db: true` in its metadata. For reads, always use `--command`.
- `wrangler d1 export` still fails here (`cannot export databases with Virtual Tables
  (fts5)`); pull `sql` from `sqlite_master` as above.

## Reusable command block

Database name and invocation come from `[[env.production.d1_databases]]` in
`apps/api/wrangler.toml`, so `--env production --config` are both required:

```bash
BASE="pnpm wrangler d1 execute makanmasak-prod --remote --env production \
  --config=./apps/api/wrangler.toml --json"

# 1. STRICT count (pull DDL, classify client-side — see isStrict above)
$BASE --command "SELECT name, sql FROM sqlite_master WHERE type='table'
  AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'
  AND name NOT LIKE 'd1_%' ORDER BY name;" > all_ddl.json

# 2. Per-table contamination + row count, ~20 tables per call.
#    EXCLUDE _cf_KV. NULL is not contamination, hence NOT IN ('integer','null').
$BASE --command "SELECT
  (SELECT COUNT(*) FROM \`orders\`) AS orders__rows,
  (SELECT COALESCE(SUM(
     CASE WHEN typeof(\`created_at_ms\`) NOT IN ('integer','null') THEN 1 ELSE 0 END
   + CASE WHEN typeof(\`total_amount_cents\`) NOT IN ('integer','null') THEN 1 ELSE 0 END
  ),0) FROM \`orders\`) AS orders__bad;"
```

**NULL handling matters.** A nullable INTEGER column holding a genuine NULL reports
`typeof = 'null'`. Writing `typeof(col) != 'integer'` would count every NULL as
contamination and manufacture a false alarm — most `*_at_ms` columns here are nullable.
Always use `NOT IN ('integer','null')`. NOT NULL columns cannot hold NULL regardless of
`STRICT` (SQLite enforces NOT NULL independently), so excluding `'null'` loses no signal.

## Two more read-only sweeps that reuse this block (issue #334, 2026-09-12)

Both were run with the same `$BASE` invocation and both came back clean. They
answer different questions from the STRICT one, so they are recorded here
rather than folded into the table above.

**Which tables still declare a `REAL` column** — the money-cents retirement's
exit condition. `LIKE '%real%'` over `sqlite_master.sql` finds the tables, but
join `pragma_table_info` to get the columns, or you are back to substring
matching on DDL:

```bash
$BASE --command "SELECT m.name AS tbl, p.name AS col FROM sqlite_master m
  JOIN pragma_table_info(m.name) p
 WHERE m.type='table' AND upper(p.type)='REAL'
   AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '%_fts%'
   AND m.name NOT LIKE 'd1_%' AND m.name != '_cf_KV'
 ORDER BY m.name, p.name;"
```

13 tables, 29 columns, every one non-monetary — the cutover is live in
production. Full result in
`docs/migration/MONEY_CENTS_FIELD_RETIREMENT.md`, section "Production state
verified 2026-09-12".

**Whether any `restaurant_id` is an orphan.** 69 tables carry the column, and
all 69 have a declared FK to `restaurants(id)`; the table-with-column list and
the declared-FK list come back identical:

```bash
$BASE --command "SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) p
 WHERE m.type='table' AND p.name='restaurant_id'
   AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '%_fts%'
   AND m.name NOT LIKE 'd1_%' AND m.name != '_cf_KV' ORDER BY m.name;"

# then, ~23 tables per call, as scalar subqueries (not UNION ALL — see above):
$BASE --command "SELECT
  (SELECT COUNT(*) FROM \`orders\` WHERE \`restaurant_id\` IS NOT NULL
     AND \`restaurant_id\` NOT IN (SELECT \`id\` FROM \`restaurants\`)) AS \"o_orders\", …;"
```

All 69 returned 0, and `SELECT COUNT(*) FROM pragma_foreign_key_check` returned
0 for the whole database. Note that a bare column alias of a table name is a
syntax error here (`near "order_items"`) — quote the aliases, as above.

**zsh does not word-split an unquoted `$VAR`**, so a `for t in $TABLES` loop
that works in bash silently passes the whole string as one table name and the
query fails with `no such table: orders order_items …`. Generate the SQL with
`node -e` and `--command "$(cat file.sql)"` instead.

## Adjacent finding (not STRICT-related)

16 timestamp-named columns are declared `TEXT` rather than INTEGER in production, all in
the backup and AI subsystems (`ai_configurations`, `ai_usage_logs`, `backup_alerts`,
`backup_configurations`, `backup_records`, `backup_schedules`, `restore_operations`). They
use the legacy bare `_at` naming, not `_ms`. All of those tables are empty, so nothing is
at risk today, but they are schema drift against the "INTEGER Unix ms" standard and
`STRICT` would not fix them — the declared type is itself TEXT.
