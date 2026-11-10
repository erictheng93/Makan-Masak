# Production D1 archive

The production-d1-archive workflow copies both production databases daily at 03:17
Taiwan time, one job each, so one failing does not cost the other its archive:

- `makanmasak-prod` to `makanmasak-backups-prod/platform-d1/`
- `makanmasak-management-prod` to `makanmasak-backups-prod/management-d1/`

Each archive is an age-encrypted SQLite file named
`<date>-<run id>-<attempt>.age`. R2 and not a workflow artifact, because the
repository is public and artifacts are downloadable by any signed-in GitHub
user.

Configure the production environment with:

- secrets CLOUDFLARE_ACCOUNT_ID and D1_ARCHIVE_READ_TOKEN (D1 Read, covering
  both databases);
- secrets R2_ARCHIVE_ACCESS_KEY_ID and R2_ARCHIVE_SECRET_ACCESS_KEY, from an R2
  API token scoped to Object Read & Write on that one bucket only;
- variable D1_ARCHIVE_AGE_RECIPIENT (an age public key). Keep the matching
  recovery identity offline;
- secret SLACK_WEBHOOK_URL, used to post a failure alert (workflow name and run
  link only). Without it the job still fails, just silently.

Retention is one R2 lifecycle rule per prefix. Create them by hand once; the
workflow does not. 90 days is the current choice, and the period is a decision
tracked in issue #420.

```sh
cd apps/api
pnpm exec wrangler r2 bucket lifecycle add makanmasak-backups-prod platform-d1-expire platform-d1/ --expire-days 90
pnpm exec wrangler r2 bucket lifecycle add makanmasak-backups-prod management-d1-expire management-d1/ --expire-days 90
```

Before relying on this backup, dispatch the workflow, then fetch the archive
on a trusted host (AWS CLI with the same R2 credentials in its environment):

```sh
export AWS_DEFAULT_REGION=auto
aws s3 cp "s3://makanmasak-backups-prod/platform-d1/<key>.age" platform.age \
  --endpoint-url "https://<account id>.r2.cloudflarestorage.com"
umask 077
age --decrypt -i /secure/recovery-identity -o recovered.sqlite platform.age
sqlite3 recovered.sqlite 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
sqlite3 recovered.sqlite "SELECT count(*) FROM dish_search_fts WHERE dish_search_fts MATCH 'noodles';"
```

Compare representative orders and search results with known source records.
The recovered file is a standalone SQLite database.

## Importing into D1

A plain `sqlite3 .dump` of the recovered file does not import. D1 enforces
foreign keys (`PRAGMA foreign_keys=OFF` has no effect there) and refuses
`writable_schema` and writes to the fts5 shadow tables. `d1_import_sql.py`
writes the statements in the order D1 accepts: deferred foreign keys, tables,
indexes, data, `sqlite_sequence`, triggers, then an fts rebuild. It needs the
`sqlite3` CLI.

```sh
python3 scripts/archive/d1_import_sql.py recovered.sqlite import.sql
cd apps/api
pnpm exec wrangler d1 execute <empty database> --local --file ../../import.sql
pnpm exec wrangler d1 execute <empty database> --local --command 'PRAGMA quick_check'
pnpm exec wrangler d1 execute <empty database> --local --command 'SELECT count(*) FROM pragma_foreign_key_check'
```

D1 refuses `PRAGMA integrity_check` (`SQLITE_AUTH`); `quick_check` is the check
available on that side. The import was drilled against a local D1 with a full
production snapshot on 2026-11-10: tables, row counts, STRICT, sequences and
search all matched. A `--remote` import into an empty database has not been
drilled; its file-size limit and duration are unknown.

Both files hold customer data: delete `recovered.sqlite` and `import.sql` when
done. wrangler also writes each command's output, query results included, to
its log directory (`~/Library/Preferences/.wrangler/logs` on macOS), so clear
the logs from a drill that selected real rows.

A write that changes the D1 bookmark invalidates the copy. The job retries
three times and fails visibly if it cannot obtain a quiet window. Monitor
failed or missing daily runs. No archive is published after failed validation.
