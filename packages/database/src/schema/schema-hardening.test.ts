import { getTableConfig } from "drizzle-orm/sqlite-core";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  backupAlerts,
  backupAuditLogs,
  backupConfigurations,
  backupRecords,
  backupSchedules,
  marketCheckoutPayments,
  paymentTransactions,
  platformWebhookLogs,
  restaurants,
  restoreOperations,
} from "./index";

// Migration fixtures are addressed repo-root-relative. Anchor on this
// file's own location rather than process.cwd() so the suite passes whether
// vitest runs from the workspace root or from packages/database, which is
// what `turbo run test` does.
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

type Table = Parameters<typeof getTableConfig>[0];

function columnSqlType(table: Table, columnName: string): string | undefined {
  return getTableConfig(table)
    .columns.find((column) => column.name === columnName)
    ?.getSQLType();
}

// The fresh track was squashed into a single baseline, so hardening that used
// to arrive as a migration step now ships as part of the schema itself. The
// deployment track still carries the executable step, which is the only place
// a legacy-value conversion can be asserted.
const FRESH_BASELINE =
  "packages/database/migrations_fresh/0000_baseline_strict.sql";
const LEGACY_HARDENING =
  "packages/database/migrations/0089_schema_hardening_payment_idempotency_backup_timestamps.sql";
const FRESH_WEBHOOK_DEDUP =
  "packages/database/migrations_fresh/0005_platform_webhook_event_dedup.sql";

function migrationPath(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

describe("schema hardening", () => {
  it("carries a queryable country on restaurants", () => {
    const config = getTableConfig(restaurants);
    const column = config.columns.find((c) => c.name === "country_code");

    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
    expect(
      config.indexes.some((index) =>
        index.config.columns.some(
          (candidate) =>
            "name" in candidate && candidate.name === "country_code",
        ),
      ),
    ).toBe(true);
  });

  it("deduplicates provider webhook event IDs when present", () => {
    const indexes = getTableConfig(platformWebhookLogs).indexes;
    const migration = migrationPath(FRESH_WEBHOOK_DEDUP);

    expect(
      indexes.some(
        (index) => index.config.name === "platform_webhook_logs_event_unique",
      ),
    ).toBe(true);
    expect(migration).toContain(
      "CREATE UNIQUE INDEX `platform_webhook_logs_event_unique`",
    );
    expect(migration).toContain("WHERE `platform_event_id` IS NOT NULL");
  });

  it("keeps nullable payment idempotency keys unique when present", () => {
    const paymentIndexes = getTableConfig(paymentTransactions).indexes;
    const marketIndexes = getTableConfig(marketCheckoutPayments).indexes;

    expect(
      paymentIndexes.some(
        (index) =>
          index.config.name === "payment_transactions_idempotency_unique_idx",
      ),
    ).toBe(true);
    expect(
      marketIndexes.some(
        (index) =>
          index.config.name ===
          "market_checkout_payments_idempotency_unique_idx",
      ),
    ).toBe(true);

    // `IF NOT EXISTS` belonged to the migration step; the baseline creates the
    // index outright. The partial predicate is the part that matters -- without
    // it the unique index would reject every second NULL idempotency key.
    const baseline = migrationPath(FRESH_BASELINE);

    expect(baseline).toContain(
      "CREATE UNIQUE INDEX payment_transactions_idempotency_unique_idx",
    );
    expect(baseline).toContain(
      "CREATE UNIQUE INDEX market_checkout_payments_idempotency_unique_idx",
    );
    expect(baseline).toContain("WHERE idempotency_key IS NOT NULL");
  });

  it("stores backup timestamps as integer millisecond timestamps", () => {
    const integerTimestampColumns: Array<[Table, string]> = [
      [backupRecords, "started_at_ms"],
      [backupRecords, "completed_at_ms"],
      [backupRecords, "updated_at_ms"],
      [backupSchedules, "last_run_at_ms"],
      [backupSchedules, "next_run_at_ms"],
      [backupSchedules, "created_at_ms"],
      [backupSchedules, "updated_at_ms"],
      [backupConfigurations, "created_at_ms"],
      [backupConfigurations, "updated_at_ms"],
      [backupAlerts, "triggered_at_ms"],
      [backupAlerts, "resolved_at_ms"],
      [backupAuditLogs, "timestamp_ms"],
      [restoreOperations, "started_at_ms"],
      [restoreOperations, "completed_at_ms"],
    ];

    for (const [table, column] of integerTimestampColumns) {
      expect(columnSqlType(table, column)).toBe("integer");
    }

    // The Drizzle schema saying `integer` only matters if the SQL that actually
    // ships agrees. Post-squash that SQL is the baseline, not a migration step.
    const baseline = migrationPath(FRESH_BASELINE);

    for (const [, column] of integerTimestampColumns) {
      // Quoting is not stable across the baseline -- SQLite rewrites a table's
      // stored DDL when ALTER TABLE touches it -- so allow the optional quote.
      expect(baseline).toMatch(
        new RegExp(String.raw`\b${column}\b["\`]?\s+integer`, "i"),
      );
    }
  });

  it("converts ISO backup timestamps through the datetime branch", () => {
    // Only the deployment track converts: the squashed baseline creates these
    // columns as INTEGER, so it has no legacy TEXT value to reinterpret.
    const sql = migrationPath(LEGACY_HARDENING);
    const db = new Database(":memory:");
    const timestamp = "2026-06-07T03:04:05.000Z";

    expect(sql).toContain("NOT GLOB '*[^0-9]*' THEN CAST");
    expect(sql).not.toContain("GLOB '[0-9]*' THEN CAST");

    const converted = db
      .prepare(
        `
        SELECT CASE
          WHEN @timestamp IS NULL THEN NULL
          WHEN typeof(@timestamp) = 'integer' THEN @timestamp
          WHEN @timestamp NOT GLOB '*[^0-9]*' THEN CAST(@timestamp AS INTEGER)
          ELSE CAST(strftime('%s', @timestamp) AS INTEGER) * 1000
        END AS value
        `,
      )
      .get({ timestamp }) as { value: number };

    expect(converted.value).toBe(new Date(timestamp).getTime());
  });

  it("converts empty legacy backup timestamp strings to null", () => {
    const sql = migrationPath(LEGACY_HARDENING);
    const db = new Database(":memory:");

    expect(sql).toContain("= '' THEN NULL");

    const converted = db
      .prepare(
        `
        SELECT CASE
          WHEN @timestamp IS NULL OR @timestamp = '' THEN NULL
          WHEN typeof(@timestamp) = 'integer' THEN @timestamp
          WHEN @timestamp NOT GLOB '*[^0-9]*' THEN CAST(@timestamp AS INTEGER)
          ELSE CAST(strftime('%s', @timestamp) AS INTEGER) * 1000
        END AS value
        `,
      )
      .get({ timestamp: "" }) as { value: null };

    expect(converted.value).toBeNull();
  });
});
