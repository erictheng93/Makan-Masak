import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const schemaRoot = join(repoRoot, "packages/database/src/schema");
const policyPath = join(
  repoRoot,
  "docs/architecture/database/integer-primary-key-policy.json",
);
const allowedCategories = new Set([
  "legacy_domain",
  "leaf_local",
  "audit_log",
  "join_edge",
]);
const allowedMigrationPlans = new Set(["retain", "migrate_to_uuid_v7"]);

interface IntegerPrimaryKeySurface {
  tableName: string;
  schemaFile: string;
  // Reported in failures, never asserted, and deliberately absent from the
  // inventory. Pinning it turned every edit above an id into a contract change,
  // and the commit that moved the line was never the one that saw the red
  // build -- a9743a7d shifted three ids in coupons.ts and main stayed red for
  // two further commits that had not touched a schema file (#346).
  line: number;
}

interface IntegerPrimaryKeyPolicyEntry extends Omit<
  IntegerPrimaryKeySurface,
  "line"
> {
  category: "legacy_domain" | "leaf_local" | "audit_log" | "join_edge";
  migrationPlan: "retain" | "migrate_to_uuid_v7";
  migrationPhase?: string;
  phaseOrder?: number;
  rationale: string;
}

function listSchemaFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...listSchemaFiles(absolutePath));
    } else if (
      absolutePath.endsWith(".ts") &&
      !absolutePath.endsWith(".test.ts")
    ) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

function discoverIntegerPrimaryKeys(): IntegerPrimaryKeySurface[] {
  const surfaces: IntegerPrimaryKeySurface[] = [];

  for (const file of listSchemaFiles(schemaRoot)) {
    // The JSON inventory stores POSIX paths, so the discovered key has to use
    // them too -- otherwise every table looks both missing and stale on Windows.
    const schemaFile = relative(repoRoot, file).replace(/\\/g, "/");
    let currentTableName: string | null = null;
    let expectingTableName = false;

    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (line.includes("sqliteTable(")) {
          expectingTableName = true;
        }

        const tableMatch = expectingTableName ? line.match(/"([^"]+)"/) : null;
        if (tableMatch) {
          currentTableName = tableMatch[1];
          expectingTableName = false;
        }

        if (
          line.includes('integer("id").primaryKey({ autoIncrement: true })')
        ) {
          surfaces.push({
            tableName: currentTableName ?? "<unknown>",
            schemaFile,
            line: index + 1,
          });
        }
      });
  }

  return surfaces.sort((left, right) =>
    `${left.schemaFile}:${left.tableName}`.localeCompare(
      `${right.schemaFile}:${right.tableName}`,
    ),
  );
}

function keyOf(
  surface: Pick<IntegerPrimaryKeySurface, "schemaFile" | "tableName">,
) {
  return `${surface.schemaFile}#${surface.tableName}`;
}

describe("database primary key policy", () => {
  it("requires every integer autoincrement table id to be inventoried", () => {
    expect(existsSync(policyPath)).toBe(true);

    const discovered = discoverIntegerPrimaryKeys();
    const policy = JSON.parse(
      readFileSync(policyPath, "utf8"),
    ) as IntegerPrimaryKeyPolicyEntry[];
    const policyByKey = new Map(policy.map((entry) => [keyOf(entry), entry]));
    const discoveredByKey = new Map(
      discovered.map((surface) => [keyOf(surface), surface]),
    );

    const missing = discovered
      .filter((surface) => !policyByKey.has(keyOf(surface)))
      // Carry the line into the message so a failure still says where to look.
      .map((surface) => `${keyOf(surface)} @${surface.line}`);
    const stale = policy
      .filter((entry) => !discoveredByKey.has(keyOf(entry)))
      .map(keyOf);

    expect({ missing, stale }).toEqual({ missing: [], stale: [] });

    for (const surface of discovered) {
      const entry = policyByKey.get(keyOf(surface));
      expect(entry, keyOf(surface)).toBeDefined();
      expect(allowedCategories.has(entry?.category ?? ""), keyOf(surface)).toBe(
        true,
      );
      expect(
        allowedMigrationPlans.has(entry?.migrationPlan ?? ""),
        keyOf(surface),
      ).toBe(true);
      expect(entry?.rationale.trim().length, keyOf(surface)).toBeGreaterThan(
        20,
      );
    }
  });

  it("does not inventory completed UUID-v7 primary key migrations", () => {
    const policy = JSON.parse(
      readFileSync(policyPath, "utf8"),
    ) as IntegerPrimaryKeyPolicyEntry[];
    const policyByTable = new Map(
      policy.map((entry) => [entry.tableName, entry]),
    );

    expect(policyByTable.has("orders")).toBe(false);
    expect(policyByTable.has("platform_orders")).toBe(false);
    expect(policyByTable.has("users")).toBe(false);
  });
});
