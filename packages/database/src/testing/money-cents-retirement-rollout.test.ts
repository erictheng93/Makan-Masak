import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import * as schema from "../schema";

interface ExpectedAuditSurface {
  tableName: string;
  columnName: string;
  checkName: string;
}

const expectedAuditSurfaces: ExpectedAuditSurface[] = [
  {
    tableName: "orders",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "order_items",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "menu_items",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "coupons",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "coupon_usage",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "group_orders",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "group_cart_items",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "split_bills",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "cash_shifts",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "cash_movements",
    columnName: "amount",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "refunds",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "dish_search_index",
    columnName: "price",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "ingredient_definitions",
    columnName: "cost_per_unit",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "shift_templates",
    columnName: "hourly_rate",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "partnerships",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "partnership_plans",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "partnership_usage_logs",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "verified_members",
    columnName: "amounts",
    checkName: "real_cents_mismatch",
  },
  {
    tableName: "_all_money_tables",
    columnName: "legacy_real_amounts",
    checkName: "real_scale_over_two_decimals",
  },
];

const packageRoot = path.resolve(__dirname, "../..");
// The fresh track was squashed into a single baseline, so it can no longer
// express a guard that runs before a cutover -- it only carries the shape those
// steps produced. The executable rollout therefore lives on the deployment
// track alone, and every "does the guard block a bad state" assertion below
// reads from there; the baseline is checked for the end state instead.
const freshBaselinePath = path.join(
  packageRoot,
  "migrations_fresh",
  "0000_baseline_strict.sql",
);
const legacyMigrationsDir = path.join(packageRoot, "migrations");
const dualTrackPath = path.join(packageRoot, "migration-dual-track.json");
const retirementDocPath = path.resolve(
  packageRoot,
  "../../docs/migration/MONEY_CENTS_FIELD_RETIREMENT.md",
);

function findPercentageMigration(dir: string): string {
  const matches = fs
    .readdirSync(dir)
    .filter((file) => /^\d+_discount_percentage_bps\.sql$/.test(file))
    .sort();

  expect(matches).toHaveLength(1);
  return path.join(dir, matches[0]);
}

function findRolloutMigration(dir: string): string {
  const matches = fs
    .readdirSync(dir)
    .filter((file) =>
      /^\d+_money_cents_retirement_rollout_guard\.sql$/.test(file),
    )
    .sort();

  expect(matches).toHaveLength(1);
  return path.join(dir, matches[0]);
}

function findCutoverMigration(dir: string): string {
  const matches = fs
    .readdirSync(dir)
    .filter((file) => /^\d+_money_cents_cutover\.sql$/.test(file))
    .sort();

  expect(matches).toHaveLength(1);
  return path.join(dir, matches[0]);
}

function readSql(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function applySqlMigration(db: Database.Database, sql: string): void {
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
}

function createAuditDb(options?: {
  omit?: string;
  violation?: { tableName: string; count: number };
}): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE data_integrity_audit (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      scope text NOT NULL,
      table_name text NOT NULL,
      column_name text NOT NULL,
      check_name text NOT NULL,
      severity text NOT NULL,
      violation_count integer DEFAULT 0 NOT NULL,
      sample_values text,
      details text,
      created_at_ms integer DEFAULT (unixepoch('now') * 1000) NOT NULL
    );

    CREATE UNIQUE INDEX data_integrity_audit_check_unique
      ON data_integrity_audit (scope, table_name, column_name, check_name);
  `);

  const insert = db.prepare(`
    INSERT INTO data_integrity_audit
      (scope, table_name, column_name, check_name, severity, violation_count, details)
    VALUES
      ('money_cents_retirement', @tableName, @columnName, @checkName, 'error', @violationCount, 'seeded test audit row')
  `);

  for (const surface of expectedAuditSurfaces) {
    if (surface.tableName === options?.omit) continue;
    insert.run({
      ...surface,
      violationCount:
        options?.violation?.tableName === surface.tableName
          ? options.violation.count
          : 0,
    });
  }

  return db;
}

describe("money cents retirement rollout migration", () => {
  it("keeps the executable rollout on the deployment track after the squash", () => {
    // Each step still has to exist as its own file: the guard only means
    // anything if it can run before the cutover it gates.
    expect(findRolloutMigration(legacyMigrationsDir)).toBeTruthy();
    expect(findPercentageMigration(legacyMigrationsDir)).toBeTruthy();
    expect(findCutoverMigration(legacyMigrationsDir)).toBeTruthy();

    const dualTrack = JSON.parse(fs.readFileSync(dualTrackPath, "utf8")) as {
      pairs?: Array<{ fresh: string; legacy: string; reason: string }>;
      reviewedThrough?: { fresh: string; legacy: string };
    };

    // Pairing these three against a fresh-track file is what stopped being
    // possible; the manifest has to say so rather than silently list nothing.
    expect(dualTrack.reviewedThrough?.fresh).toBe("0000_baseline_strict.sql");
    expect(dualTrack.pairs).toEqual([]);
  });

  it("carries the post-retirement money shape in the fresh baseline", () => {
    const baseline = readSql(freshBaselinePath);

    expect(baseline).toMatch(/discount_percentage_bps/);
    expect(baseline).toMatch(/default_discount_percentage_bps/);
    expect(baseline).toMatch(/discount_value_cents/);
    // `[^_]` keeps `discount_value_cents` from satisfying a check meant for the
    // retired REAL column.
    expect(baseline).not.toMatch(/`discount_value`[^_]/);
  });

  it.each([["legacy", () => findRolloutMigration(legacyMigrationsDir)]])(
    "%s guard fails when an audited money surface is missing",
    (_label, pathFor) => {
      const db = createAuditDb({ omit: "verified_members" });
      const sql = readSql(pathFor());

      expect(() => applySqlMigration(db, sql)).toThrow(
        /CHECK constraint failed/i,
      );
    },
  );

  it.each([["legacy", () => findRolloutMigration(legacyMigrationsDir)]])(
    "%s guard fails when a money audit has violations",
    (_label, pathFor) => {
      const db = createAuditDb({
        violation: { tableName: "orders", count: 1 },
      });
      const sql = readSql(pathFor());

      expect(() => applySqlMigration(db, sql)).toThrow(
        /CHECK constraint failed/i,
      );
    },
  );

  it.each([["legacy", () => findRolloutMigration(legacyMigrationsDir)]])(
    "%s guard records rollout readiness only after clean audit coverage",
    (_label, pathFor) => {
      const db = createAuditDb();
      const sql = readSql(pathFor());

      applySqlMigration(db, sql);

      const rows = db
        .prepare(
          `
          SELECT table_name, column_name, check_name, violation_count
          FROM data_integrity_audit
          WHERE scope = 'money_cents_retirement_rollout'
          ORDER BY check_name
        `,
        )
        .all();

      expect(rows).toEqual([
        {
          table_name: "_rollout",
          column_name: "audit_rows",
          check_name: "audit_coverage_present",
          violation_count: 0,
        },
        {
          table_name: "_rollout",
          column_name: "legacy_real_amounts",
          check_name: "preflight_zero_errors",
          violation_count: 0,
        },
      ]);
    },
  );

  it("keeps the rollout dedicated to money audit gating", () => {
    const sql = readSql(findRolloutMigration(legacyMigrationsDir));

    expect(sql).toContain("money_cents_retirement_rollout");
    expect(sql).toContain("_migration_assert_money_cents_retirement_rollout");
    expect(sql).not.toMatch(
      /restaurant_fk|FOREIGN KEY|ALTER TABLE|CREATE TABLE [`"]orders/i,
    );
  });

  it("documents the executable D1 rollout phases", () => {
    // Only the deployment track's filenames are executable now, so those are
    // the ones the runbook has to name.
    const rolloutLegacy = path.basename(
      findRolloutMigration(legacyMigrationsDir),
    );
    const cutoverLegacy = path.basename(
      findCutoverMigration(legacyMigrationsDir),
    );
    const doc = fs.readFileSync(retirementDocPath, "utf8");

    expect(doc).toContain(rolloutLegacy);
    expect(doc).toContain(cutoverLegacy);
    expect(doc).toContain("pnpm db:migrate:prod");
    expect(doc).toContain("PRAGMA defer_foreign_keys = ON");
    expect(doc).toContain("money_cents_retirement_rollout");
  });

  it("requires percentage basis-point columns before discount value cutover", () => {
    const legacy = readSql(findPercentageMigration(legacyMigrationsDir));
    const doc = fs.readFileSync(retirementDocPath, "utf8");

    expect(legacy).toContain("discount_percentage_bps");
    expect(legacy).toContain("default_discount_percentage_bps");
    expect(legacy).toContain("percentage_bps_missing_or_mismatch");
    expect(legacy).toContain("discount_type` = 'percentage'");

    // The fresh track backfills nothing -- the baseline creates the bps columns
    // directly, which is the state the backfill was there to reach.
    const baseline = readSql(freshBaselinePath);

    expect(baseline).toContain("discount_percentage_bps");
    expect(baseline).toContain("default_discount_percentage_bps");
    expect(doc).toContain("discount_percentage_bps");
    expect(doc).toContain("default_discount_percentage_bps");
    expect(doc).toContain("percentage_bps_missing_or_mismatch");
  });

  it.each([["legacy", () => findCutoverMigration(legacyMigrationsDir)]])(
    "%s cutover drops only after guards and removes legacy sync surfaces",
    (_label, pathFor) => {
      const sql = readSql(pathFor());

      expect(sql).toContain("_migration_assert_money_cents_cutover");
      expect(sql).toContain(
        "money_cents_retirement_rollout.preflight_zero_errors",
      );
      expect(sql).toContain(
        "money_cents_retirement.percentage_bps_zero_errors",
      );
      expect(sql).toContain("money_cents_cutover.row_counts_unchanged");
      expect(sql).toContain("money_cents_cutover.foreign_key_check");
      expect(sql).toContain("DROP TRIGGER IF EXISTS `orders_cents_sync_ai`");
      expect(sql).toContain(
        "DROP TRIGGER IF EXISTS `trg_partnership_usage_update_member_stats`",
      );
      expect(sql).toContain(
        "CREATE TRIGGER IF NOT EXISTS `trg_partnership_usage_update_member_stats`",
      );
      expect(sql).toContain(
        "ALTER TABLE `coupons` DROP COLUMN `discount_value`",
      );
      expect(sql).toContain(
        "ALTER TABLE `partnership_plans` DROP COLUMN `discount_value`",
      );
      expect(sql).toContain("CREATE INDEX `menu_items_price_range_idx`");
      expect(sql).toContain("CREATE INDEX `dish_search_price_available_idx`");
      expect(sql).not.toContain("DROP COLUMN `discount_percentage_bps`");
      expect(sql).not.toContain("DROP COLUMN `discount_value_cents`");
    },
  );
});

// Every assertion above reads migration text, so it only catches a
// reintroduced legacy money column if someone writes a migration for it. A
// `real("price")` added straight to a Drizzle table ships without one, and
// production (verified 2026-09-12, see
// docs/migration/MONEY_CENTS_FIELD_RETIREMENT.md) now has zero REAL money
// columns — there is nothing left to compare a drifted value against. The
// block below walks the schema objects instead.
const MONEY_WORDS = [
  "price",
  "amount",
  "total",
  "fee",
  "cost",
  "subtotal",
  "tax",
  "discount",
  "tip",
  "balance",
];

// Match snake_case segments rather than substrings: `overtime_multiplier`
// contains "tip" and `cost_centre` would swallow anything, so a substring
// test manufactures false positives while reading as if it were strict.
function carriesMoneyWord(columnName: string): boolean {
  return columnName.split("_").some((segment) => MONEY_WORDS.includes(segment));
}

// REAL columns that carry a money word and are genuinely not money. The
// retirement plan calls these out by name ("ratios, percentages, ratings,
// coordinates, fractional leave days"). Every entry states why; adding one is
// the review point this guard exists to force.
const NON_MONEY_REAL_ALLOWLIST = new Map<string, string>([
  [
    "ingredient_stock_movements.balance_after",
    "ingredient stock balance in stock units, not currency",
  ],
  ["leave_requests.total_days", "fractional leave days (0.5 = half day)"],
  ["employee_leave_balances.total_days", "fractional leave days"],
  ["leave_types.accrual_amount", "leave days accrued per period, not currency"],
]);

interface SchemaColumn {
  key: string;
  sqlType: string;
  name: string;
}

function schemaColumns(): SchemaColumn[] {
  return Object.values(schema)
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .flatMap((table) => {
      const config = getTableConfig(table);
      return config.columns.map((column) => ({
        key: `${config.name}.${column.name}`,
        sqlType: column.getSQLType().toLowerCase(),
        name: column.name,
      }));
    });
}

describe("money columns in the Drizzle schema", () => {
  it("declares no REAL column that names money", () => {
    const offenders = schemaColumns()
      .filter((column) => column.sqlType === "real")
      .filter(
        (column) =>
          carriesMoneyWord(column.name) &&
          !/_(cents|bps)$/.test(column.name) &&
          !NON_MONEY_REAL_ALLOWLIST.has(column.key),
      )
      .map((column) => column.key);

    expect(
      offenders,
      "money is INTEGER cents after the 0087/0088 cutover, and production no longer carries the legacy REAL columns a drifted value could be reconciled against",
    ).toEqual([]);
  });

  it("keeps the non-money REAL allowlist honest", () => {
    // A stale entry silently widens the guard: the column it excused is gone,
    // but the exemption still covers whatever later takes that name.
    const live = new Set(
      schemaColumns()
        .filter((column) => column.sqlType === "real")
        .map((column) => column.key),
    );

    expect(
      [...NON_MONEY_REAL_ALLOWLIST.keys()].filter((key) => !live.has(key)),
      "allowlist entries must still name a live REAL column",
    ).toEqual([]);
  });

  it("keeps every *_cents and *_bps column an integer", () => {
    const nonInteger = schemaColumns()
      .filter((column) => /_(cents|bps)$/.test(column.name))
      .filter((column) => column.sqlType !== "integer")
      .map((column) => `${column.key}:${column.sqlType}`);

    expect(nonInteger).toEqual([]);
  });
});
