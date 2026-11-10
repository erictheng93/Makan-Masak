import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const MIGRATIONS = fileURLToPath(
  new URL("../../migrations_fresh/", import.meta.url),
);
const DEMO_ID = "01a0d2b6-61ba-744e-89f9-75f5296a8e11";

const apply = (db: Database.Database, file: string) =>
  db.exec(readFileSync(resolve(MIGRATIONS, file), "utf8"));

const indexNames = (db: Database.Database, table: string) =>
  (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?",
      )
      .all(table) as { name: string }[]
  ).map((r) => r.name);

function insertRestaurant(db: Database.Database, id: string) {
  db.prepare(
    `INSERT INTO restaurants (id, name, type, category, address, district, phone, created_at_ms, updated_at_ms)
     VALUES (?, 'r', 't', 'c', 'a', 'd', 'p', 0, 0)`,
  ).run(id);
}

function insertUser(
  db: Database.Database,
  id: string,
  username: string,
  restaurantId: string | null,
) {
  db.prepare(
    `INSERT INTO users (id, username, full_name, password_hash, role, restaurant_id, created_at_ms, updated_at_ms)
     VALUES (?, ?, 'n', 'h', 1, ?, 0, 0)`,
  ).run(id, username, restaurantId);
}

describe("migrations 0041 + 0042 replayed on 0000..0040", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    for (const file of readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && f < "0041")
      .sort()) {
      apply(db, file);
    }
  });
  afterEach(() => db.close());

  it("0041 adds login_slug, backfills deterministically and enforces uniqueness", () => {
    const other = "01900000-1111-7222-8333-444455556666";
    insertRestaurant(db, DEMO_ID);
    insertRestaurant(db, other);

    apply(db, "0041_restaurant_login_slug.sql");

    const slug = (id: string) =>
      (
        db
          .prepare("SELECT login_slug s FROM restaurants WHERE id=?")
          .get(id) as {
          s: string;
        }
      ).s;
    expect(slug(DEMO_ID)).toBe("demo");
    expect(slug(other)).toBe("shop-55556666");
    expect(indexNames(db, "restaurants")).toContain(
      "restaurants_login_slug_unique",
    );

    expect(() =>
      db
        .prepare("UPDATE restaurants SET login_slug='demo' WHERE id=?")
        .run(other),
    ).toThrow(/UNIQUE/);
    // NULLs stay allowed (partial index).
    db.prepare("UPDATE restaurants SET login_slug=NULL").run();
    insertRestaurant(db, "01900000-aaaa-7bbb-8ccc-ddddeeeeffff");
    db.prepare("UPDATE restaurants SET login_slug=NULL").run();
  });

  it("0042 swaps the platform-wide username index for per-restaurant ones", () => {
    insertRestaurant(db, "r-a");
    insertRestaurant(db, "r-b");
    insertUser(db, "u1", "chef", "r-a");
    expect(() => insertUser(db, "u2", "chef", "r-b")).toThrow(/UNIQUE/);

    apply(db, "0041_restaurant_login_slug.sql");
    apply(db, "0042_users_username_per_restaurant.sql");

    const names = indexNames(db, "users");
    expect(names).not.toContain("users_username_unique");
    expect(names).toEqual(
      expect.arrayContaining([
        "users_restaurant_username_unique",
        "users_platform_username_unique",
      ]),
    );

    insertUser(db, "u2", "chef", "r-b"); // same name, other shop: ok
    expect(() => insertUser(db, "u3", "chef", "r-a")).toThrow(/UNIQUE/);
    insertUser(db, "u4", "root", null);
    expect(() => insertUser(db, "u5", "root", null)).toThrow(/UNIQUE/);
    insertUser(db, "u6", "chef", null); // platform admin vs shop staff: ok
  });
});
