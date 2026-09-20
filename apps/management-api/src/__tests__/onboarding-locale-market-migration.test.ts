import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../migrations");
const targetMigration = "0014_onboarding_locale_and_market.sql";

describe("onboarding locale and market migration", () => {
  it("adds nullable locale and market fields without losing existing applications", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");

    for (const file of fs.readdirSync(migrationsDir).sort()) {
      if (!file.endsWith(".sql")) continue;

      if (file === targetMigration) {
        sqlite
          .prepare(
            `INSERT INTO onboarding_applications (
               id, business_name, contact_name, contact_email, contact_phone
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            "APP-20260920-001",
            "Existing Stall",
            "Aisha",
            "aisha@example.com",
            "+60123456789",
          );
      }

      sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    }

    const columns = sqlite
      .prepare(
        `SELECT name, "notnull" AS "notNull"
         FROM pragma_table_info('onboarding_applications')
         WHERE name IN ('country_code', 'market_id', 'stall_number')
         ORDER BY name`,
      )
      .all();
    const existingApplication = sqlite
      .prepare(
        `SELECT business_name, country_code, market_id, stall_number
         FROM onboarding_applications
         WHERE id = ?`,
      )
      .get("APP-20260920-001");

    expect(columns).toEqual([
      { name: "country_code", notNull: 0 },
      { name: "market_id", notNull: 0 },
      { name: "stall_number", notNull: 0 },
    ]);
    expect(existingApplication).toEqual({
      business_name: "Existing Stall",
      country_code: null,
      market_id: null,
      stall_number: null,
    });
  });
});
