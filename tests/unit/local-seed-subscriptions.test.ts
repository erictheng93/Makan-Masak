import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const demoRestaurantId = "019469a0-0099-7000-8000-000000000099";

describe("local seed subscriptions", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("provisions owner1's demo restaurant with modules used by the owner dashboard", () => {
    db = new Database(":memory:");
    createSeedTables(db);

    const seedSql = readFileSync(
      join(repoRoot, "scripts/seed-local.sql"),
      "utf8",
    );
    db.exec(seedSql);

    const owner = db
      .prepare(
        "SELECT username, role, restaurant_id FROM users WHERE username = ?",
      )
      .get("owner1") as
      | { username: string; role: number; restaurant_id: string }
      | undefined;
    expect(owner).toEqual({
      username: "owner1",
      role: 1,
      restaurant_id: demoRestaurantId,
    });

    const subscription = db
      .prepare(
        `SELECT plan_tier, module_overrides, is_active
           FROM shop_subscriptions
          WHERE restaurant_id = ?`,
      )
      .get(demoRestaurantId) as
      | {
          plan_tier: string;
          module_overrides: string;
          is_active: number;
        }
      | undefined;

    expect(subscription).toBeDefined();
    expect(subscription?.is_active).toBe(1);

    const modules = JSON.parse(subscription?.module_overrides ?? "{}") as
      | Record<string, boolean>
      | undefined;
    expect(modules).toMatchObject({
      online_ordering: true,
      analytics: true,
    });
  });
});

function createSeedTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE restaurants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      category TEXT,
      description TEXT,
      address TEXT,
      district TEXT,
      city TEXT,
      phone TEXT,
      email TEXT,
      settings TEXT,
      is_available INTEGER,
      is_active INTEGER,
      created_at_ms INTEGER,
      updated_at_ms INTEGER
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      full_name TEXT,
      role INTEGER NOT NULL,
      restaurant_id TEXT,
      is_active INTEGER,
      is_verified INTEGER,
      token_version INTEGER,
      admin_tier TEXT,
      created_at_ms INTEGER,
      updated_at_ms INTEGER
    );

    CREATE TABLE shop_subscriptions (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL UNIQUE,
      plan_tier TEXT DEFAULT 'trial' NOT NULL,
      module_overrides TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1 NOT NULL,
      trial_ends_at_ms INTEGER,
      billing_cycle_start_at_ms INTEGER,
      billing_cycle_end_at_ms INTEGER,
      notes TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
}
