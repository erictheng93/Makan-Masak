# Backup and Restore Runbook

Use this for D1 corruption, accidental destructive migration, missing critical
rows, or a DR exercise.

> **Start here: D1 Time Travel is the recovery mechanism.** It is enabled on
> both production databases, needs no setup, and restores to any bookmark in
> the last 30 days. Drilled end to end on 2026-07-30 — see
> [Time Travel](#time-travel-primary-recovery-path).
>
> Two things this runbook used to get wrong, both verified against production:
>
> - **`wrangler d1 export` does not work on `makanmasak-prod`.** It fails with
>   `cannot export databases with Virtual Tables (fts5)` because of
>   `dish_search_fts`. Every procedure below that began with an export was
>   unexecutable, which is the worst kind of runbook bug: you find out during
>   the incident.
> - **The per-restaurant backup feature has never run in production, and is
>   now switched off.** `backup_configurations` is empty and
>   `makanmasak-backups-prod` holds zero objects, so the scheduler had nothing
>   to back up. As of 2026-07-31 the API answers 404 for `/api/v1/backup`
>   (`TENANT_BACKUPS_ENABLED`), and the `makanmasak-backup-scheduler-prod`
>   Worker has been deleted — redeploy with `cd apps/backup-scheduler && pnpm
>   run deploy:prod`, and uncomment the schedules in its `wrangler.toml` if you
>   want them back. To restore the tenant-facing feature, also set the
>   `TENANT_BACKUPS_ENABLED` variable on the production `makanmasak-api-prod`
>   Worker to exactly `true`, then redeploy the API with `cd apps/api && pnpm
>   run deploy:prod`; without this, `/api/v1/backup` will continue to return
>   404. The R2 bucket and its 90-day retention rule survive. That feature is a
>   tenant-facing product capability, not this platform's disaster recovery.

## Uptime Monitoring

Configure external uptime monitoring against these production targets:

| Target | URL | Cadence | Expected |
| --- | --- | --- | --- |
| Liveness | `https://api.makanmasak.com/info` | 60s | HTTP 200 |
| Dependency health | `https://api.makanmasak.com/api/v1/monitoring/health` | 60s | HTTP 200 and `overall: "healthy"` |
| Uptime evidence | `https://api.makanmasak.com/api/v1/system/health/uptime` | 300s | HTTP 200 and `status: "operational"` — **requires a bearer token** |

> `/api/v1/system/health/live`, `/ready`, and `/uptime` all return **401**
> unauthenticated — they are not usable as plain external uptime targets, which
> is what this table used to list them as. A monitor pointed at them either
> alerts forever or, if it was configured to accept 401 as "up", hides a real
> outage. Use `/info` for liveness (public, touches no bindings) and
> `/api/v1/monitoring/health` for dependency health (public, probes D1 and KV
> without spending a KV write). Keep `/health/uptime` only if the monitor can
> send a bearer token.

> The public `GET /api/v1/system/health` is also safe to poll: since #324 its
> KV probe reads a sentinel key instead of writing one, and it runs alongside
> the D1 probe rather than after it. The write-path probe now lives behind
> `?deep=1`, which requires a bearer token precisely so that polling it is a
> deliberate choice.

The API writes the latest uptime evidence to `CACHE_KV` key
`system:uptime:last-check` with a 7-day TTL on every `/health/uptime` call, and
on `/health?deep=1`. The plain public `/health` no longer writes it: the key is
a fixed one, so an anonymous caller writing it on every request both spent a KV
write per request and pushed against KV's one-write-per-second-per-key ceiling.
Pull the latest production evidence with:

```bash
pnpm exec wrangler kv key get "system:uptime:last-check" --binding=CACHE_KV --env production --config apps/api/wrangler.toml
```

If an internal monitor calls `MonitoringService.recordUptimeCheck`, it stores
`_uptime_probe:<probe-name>` for 30 days and emits a recent alert with type
`uptime_check_failed` on non-2xx probe results.

## Time Travel (primary recovery path)

Drilled 2026-07-30 on two throwaway databases seeded with production's exact
FTS5 shape. Everything below was executed, not inferred.

### Before you restore anything

```bash
# 1. Where are we now? Capture this -- it is your way back.
pnpm wrangler d1 time-travel info makanmasak-prod

# 2. Which bookmark does the target time actually resolve to? PREVIEW FIRST.
pnpm wrangler d1 time-travel info makanmasak-prod --timestamp=2026-07-30T08:05:30Z
```

### Restore

Prefer `--bookmark` over `--timestamp`. Preview with `info --timestamp=`, read
the bookmark it prints, then restore that bookmark explicitly:

```bash
pnpm wrangler d1 time-travel restore makanmasak-prod --bookmark=<bookmark>
```

Every restore prints an undo bookmark. **Copy it before running anything
else** — it is the only route back, and the next command overwrites the
scrollback in a stressful moment.

### What the drill proved works

- Ordinary rows come back exactly.
- **The FTS5 index survives and stays queryable.** `dish_search_fts MATCH`
  returned the right rows after restore with no reindex.
- **The FTS sync triggers survive and still fire.** A row inserted after the
  restore appeared in the index, so the triggers are live, not just present in
  `sqlite_master`.
- Restores are reversible. Restoring the printed undo bookmark returned the
  database to the pre-restore state, and printed a fresh undo bookmark, so you
  can move back and forth while deciding.
- Restore on a database this size (~2.4 MB) completes in seconds.

### Hazards the drill found

| Hazard | Why it bites | What to do |
| --- | --- | --- |
| **The confirmation prompt does not protect a script.** `restore` asks `OK to proceed (y/N)`, but in a non-interactive context wrangler prints `Using fallback value in non-interactive context: yes` and proceeds. `d1 delete` behaves the same way. | Any CI job, wrapper script, or agent that runs the command destroys data with no gate. | Restore from an interactive shell. `pnpm check:no-automated-destructive-wrangler` enforces this: it fails if any of them -- `d1 time-travel restore`, `d1 delete`, or `wrangler delete` for a Worker -- appears in a workflow, a script, a package script or a git hook, and runs in both pre-commit and CI. Comments naming the commands are fine. |
| **`--timestamp` resolves to the bookmark at or before that time.** Restoring to a timestamp inside the same minute as a write loses that write. Reproduced twice; the state landed on an earlier bookmark than intended. | You ask for "08:01:19, just before the mistake" and silently get 08:01:00, before the work you meant to keep. | Preview with `info --timestamp=`, confirm the bookmark is the one you want, then restore **by bookmark**. |
| **Time Travel is per database.** Production has two: `makanmasak-prod` and `makanmasak-management-prod`. | Restoring one leaves the other ahead. `shop_subscriptions` in the management DB points at tenants in the platform DB, so a one-sided restore splits them. | Decide up front whether the incident spans both. If it does, capture bookmarks for both before restoring either. |
| **Time Travel covers D1 only.** KV, R2 and in-flight Queue messages are not rewound. | After a restore, `CACHE_KV` entries, R2 image objects and `makanmasak-search-sync-prod` messages still describe the newer state. Rows can reference R2 objects deleted since, and queue messages can reference IDs that no longer exist. | After restoring: let the short-TTL KV caches expire (metrics is 60s), and treat R2 orphans and queue failures as expected cleanup rather than new incidents. |
| **`wrangler d1 export` fails on production.** `cannot export databases with Virtual Tables (fts5)`. | You cannot take a logical snapshot as a safety net before restoring. | The undo bookmark is your safety net. For forensics, dump `sqlite_master` and the specific tables you care about with `--command`. |

### Forensics without export

```bash
# Schema, since export refuses to run.
pnpm wrangler d1 execute makanmasak-prod --remote --json \
  --command "SELECT type, name, sql FROM sqlite_master ORDER BY type, name;" \
  > forensics-schema-$(date +%Y%m%d-%H%M%S).json

# Then the specific tables the incident touched, one statement per call --
# batched --file execution against D1 fails opaquely with partial writes.
```

## Restore Drill

**Cadence: quarterly.** `.github/workflows/restore-drill-reminder.yml` opens a
tracking issue with this checklist four times a year. It does not run the drill
— the drill creates and deletes throwaway databases, and
`check-no-automated-destructive-wrangler.cjs` fails the build if those commands appear in
a workflow, precisely because they auto-confirm.

Never drill on a production database — Time Travel restore overwrites in
place, and there is no separate staging D1 to practise on. Create a throwaway
database instead. The export-based drill this section used to describe cannot
run at all, because export fails on production's FTS5 table.

The `buildRestoreDrillPlan` helper referenced here previously no longer exists
in `apps/api/src/workers/backup-scheduler.ts`.

Drill recipe, as executed on 2026-07-30 and again on 2026-11-11 (#435):

```bash
pnpm wrangler d1 create makanmasak-tt-drill
```

1. Recreate production's risky shape, not the whole schema. Copy the
   `dish_search_index` table, its indexes, the `dish_search_fts` virtual table
   and **all five** of its triggers out of `sqlite_master` — three FTS sync
   triggers (`_fts_ai`, `_fts_ad`, `_fts_au`) and two restaurant guards
   (`_restaurant_guard_bi`, `_restaurant_guard_bu`). The guards abort any
   insert whose `restaurant_id` is missing from `restaurants`, so create a
   minimal `restaurants (id TEXT PRIMARY KEY, name TEXT NOT NULL)` as the plain
   table and seed one row in it first. Apply everything **one statement per
   `--command` call**; batched `--file` execution against D1 fails opaquely
   with partial writes.
2. Seed rows and confirm `dish_search_fts MATCH` returns them. This is the
   baseline the restore has to reproduce.
3. `time-travel info` → record the good bookmark.
4. Cause damage: delete rows, rename a dish so the FTS index diverges.
5. Restore the good bookmark. **Record the undo bookmark it prints.**
6. Validate all four together — plain rows, index rows, an actual `MATCH`
   query, and `COUNT(*) FROM sqlite_master WHERE type='trigger'` (expect 5).
   Check `MATCH` on both the old and the new dish name: a rename leaves row
   counts unchanged, so only the query shows which name the index holds. Row counts
   alone would not have caught a broken index.
7. Insert a new row and confirm it appears in the index, proving the restored
   triggers still fire rather than merely existing.
8. Restore the undo bookmark and confirm you land back on the damaged state.
   The row inserted in step 7 is gone too: undo returns to the moment before
   the restore, so anything written after a restore is lost if you undo it.
9. `pnpm wrangler d1 delete makanmasak-tt-drill`.

## Production Restore

Production restore requires explicit operator approval, from an interactive
shell — the confirmation prompt auto-answers yes when stdin is not a terminal.

1. Freeze writes if possible.
2. Capture the current bookmark for **both** `makanmasak-prod` and
   `makanmasak-management-prod`, whether or not you plan to restore both.
3. Dump `sqlite_master` and the affected tables for forensics. Export does not
   work; see [Forensics without export](#forensics-without-export).
4. Preview the target with `time-travel info --timestamp=`, then restore that
   bookmark explicitly.
5. Record the undo bookmark from the restore output before doing anything else.
6. Validate against the restored data: row counts for `restaurants`, `users`,
   `menu_items`, `orders`, plus a `dish_search_fts MATCH` query to confirm
   search still works.
7. Run smoke tests and key order lifecycle checks.
8. Expect KV/R2/Queue drift — Time Travel did not rewind those. Short-TTL
   caches self-heal; R2 orphans and queue failures referencing restored-away
   rows are cleanup, not a new incident.

No binding change is needed: the restore happens in place on the same
database, which is why step 2 matters more than it looks.

## RTO/RPO Targets

Time Travel sets these, not the backup scheduler.

- **RPO: minutes.** Bookmarks are fine-grained; the practical floor is that a
  `--timestamp` restore resolves to the bookmark at or before that time, so
  assume you can lose the work inside the target minute.
- **RTO: minutes** for the restore itself at current data size (seconds on
  ~2.4 MB), plus however long triage and validation take. The old 4 hour RTO
  and 24 hour RPO were sized around a backup pipeline that never ran.
- **Retention: 30 days**, so an incident discovered later than that is not
  recoverable this way.

## Evidence To Keep

- Uptime monitor configuration and latest `system:uptime:last-check` payload.
- The bookmark the database was on before the restore, for both databases.
- The bookmark restored to, and the undo bookmark the restore printed.
- Forensic `sqlite_master` dump and any affected-table dumps.
- Validation query output, including the `dish_search_fts MATCH` result.
- Smoke test output after restore.
- Anything cleaned up afterwards for KV, R2 or the search-sync queue.
