import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);
const REBUILD = "0019_onboarding_audit_events_outlive_application.sql";

function readMigration(file: string) {
  return fs.readFileSync(path.join(migrationsDir, file), "utf8");
}

describe("0019 audit events rebuild", () => {
  it("keeps rows and append-only triggers while dropping the application FK", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");
    for (const file of fs.readdirSync(migrationsDir).sort()) {
      if (file.endsWith(".sql") && file < REBUILD) {
        sqlite.exec(readMigration(file));
      }
    }
    sqlite
      .prepare(
        `INSERT INTO onboarding_application_audit_events
           (id, application_id, event_type, created_at_ms)
         VALUES ('evt-1', 'APP-gone', 'submitted', 1)`,
      )
      .run();

    // D1 runs migrations with foreign keys enforced.
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(readMigration(REBUILD));

    expect(
      sqlite
        .prepare(
          "SELECT id, application_id FROM onboarding_application_audit_events",
        )
        .all(),
    ).toEqual([{ id: "evt-1", application_id: "APP-gone" }]);
    expect(
      sqlite
        .prepare("PRAGMA foreign_key_list(onboarding_application_audit_events)")
        .all(),
    ).toEqual([]);
    const table = sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name = 'onboarding_application_audit_events'",
      )
      .get() as { sql: string };
    expect(table.sql).toMatch(/\)\s*STRICT$/);

    // An event for an application that no longer exists is the point.
    sqlite
      .prepare(
        `INSERT INTO onboarding_application_audit_events
           (id, application_id, event_type, created_at_ms)
         VALUES ('evt-2', 'APP-gone', 'purged', 2)`,
      )
      .run();
    expect(() =>
      sqlite.exec("DELETE FROM onboarding_application_audit_events"),
    ).toThrow("onboarding audit events are append-only");
    expect(() =>
      sqlite.exec(
        "UPDATE onboarding_application_audit_events SET event_type = 'x'",
      ),
    ).toThrow("onboarding audit events are append-only");
  });
});
