import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

// The per-user limit lives in SQL, so test the migrations themselves: replay
// 0027 (trigger) then 0038 (reserved status) over minimal tables.
const migrations = fileURLToPath(
  new URL(
    "../../../../../../packages/database/migrations_fresh/",
    import.meta.url,
  ),
);

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE coupons (id INTEGER PRIMARY KEY, usage_limit_per_user INTEGER);
    CREATE TABLE coupon_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coupon_id INTEGER NOT NULL,
      order_id TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );
    INSERT INTO coupons VALUES (1, 1);
  `);
  for (const file of [
    "0027_guest_coupon_identity.sql",
    "0038_coupon_usage_reserved_status.sql",
  ]) {
    db.exec(
      readFileSync(migrations + file, "utf8")
        .split("--> statement-breakpoint")
        .join(""),
    );
  }
  return db;
}

const insert = (db: Database.Database, orderId: string, status: string) =>
  db
    .prepare(
      "INSERT INTO coupon_usage (coupon_id, order_id, status, guest_identity) VALUES (1, ?, ?, 'customer:c1')",
    )
    .run(orderId, status);

describe("coupon_usage_guest_limit with reserved holds", () => {
  it("counts a reserved hold toward the per-user limit", () => {
    const db = createDb();
    insert(db, "checkout-a", "reserved");

    expect(() => insert(db, "checkout-b", "reserved")).toThrow(
      "COUPON_GUEST_LIMIT_REACHED",
    );
    expect(() => insert(db, "guest-order", "active")).toThrow(
      "COUPON_GUEST_LIMIT_REACHED",
    );
  });

  it("frees the limit when the hold is cancelled", () => {
    const db = createDb();
    insert(db, "checkout-a", "reserved");
    db.prepare("UPDATE coupon_usage SET status = 'cancelled'").run();

    expect(() => insert(db, "checkout-b", "reserved")).not.toThrow();
  });

  it("keeps the redemption counted after reserved -> active", () => {
    const db = createDb();
    insert(db, "checkout-a", "reserved");
    db.prepare("UPDATE coupon_usage SET status = 'active'").run();

    expect(() => insert(db, "checkout-b", "reserved")).toThrow(
      "COUPON_GUEST_LIMIT_REACHED",
    );
  });
});
