# Integer Primary Key Policy

The project default remains UUID v7 in `TEXT` primary keys for new durable
domain tables. Existing `INTEGER PRIMARY KEY AUTOINCREMENT` tables are now
tracked explicitly because changing them is a D1 table-rebuild migration, not a
safe opportunistic refactor.

The machine-readable inventory is
`docs/architecture/database/integer-primary-key-policy.json`. The unit guard in
`tests/unit/database-primary-key-policy.test.ts` discovers Drizzle schema
surfaces that declare `integer("id").primaryKey({ autoIncrement: true })` and
fails when a surface is missing from the inventory or when the inventory keeps a
stale table.

An entry's identity is `schemaFile#tableName`; nothing records a line number.
The guard used to pin one per entry, which made any edit above an id a contract
change and produced sixteen commits of pure resync churn before it was removed
(#346). A failure still reports the line it discovered, as a place to look
rather than a value to keep in sync.

The highest-risk migrations, `orders` and `users`, were staged in
`UUID_V7_PK_MIGRATION_DRILL.md` and have since **shipped** — both are `TEXT`
UUID v7 primary keys in current schema (see that doc's updated status note),
so neither has an inventory row here anymore.

Use these categories:

- `legacy_domain`: business/workflow entities that should eventually move to
  UUID v7 after a dedicated migration plan.
- `leaf_local`: scoped child/cache/token rows where a local row id is not part
  of a public contract.
- `audit_log`: append-only operational or security logs.
- `join_edge`: relationship rows whose stable identity is the referenced pair
  or an existing unique key.

Adding a new integer primary key is not allowed by default. If a table has a
strong reason to keep one, add it to the inventory with a concrete rationale and
choose `retain`; otherwise use a UUID v7 `TEXT` primary key at creation time.
