import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "./create-test-database";
import { restaurants } from "../schema";

/**
 * Characterisation, not a spec: records what D1 reports in `meta.changes` so
 * the next person does not have to guess. Production once returned 38 for a
 * DELETE on an empty table and 3 for deleting one dish_search_index row inside
 * a ~150 statement batch (see restaurant-deletion.ts). Assertions below pin
 * what miniflare's D1 reports; they say nothing about production.
 */
describe("D1 meta.changes characterisation (miniflare)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const { db } = testDb;
    await db.exec(
      "CREATE TABLE cc_plain (id INTEGER PRIMARY KEY, v INTEGER NOT NULL);" +
        "CREATE TABLE cc_log (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER);" +
        "CREATE TABLE cc_trig (id INTEGER PRIMARY KEY, v INTEGER NOT NULL);" +
        "CREATE TRIGGER cc_trig_au AFTER UPDATE ON cc_trig BEGIN INSERT INTO cc_log(n) VALUES (1); INSERT INTO cc_log(n) VALUES (2); END;" +
        "CREATE TRIGGER cc_trig_ad AFTER DELETE ON cc_trig BEGIN INSERT INTO cc_log(n) VALUES (1); END;" +
        "CREATE TABLE cc_parent (id INTEGER PRIMARY KEY);" +
        "CREATE TABLE cc_child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES cc_parent(id) ON DELETE CASCADE);",
    );
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  const changes = (r: { meta: { changes?: number } }) => r.meta.changes;

  it("single statements outside a batch", async () => {
    const { db } = testDb;
    await db.exec("DELETE FROM cc_plain");
    await db.prepare("INSERT INTO cc_plain VALUES (1, 1)").run();
    const zero = await db
      .prepare("UPDATE cc_plain SET v = 2 WHERE id = 99")
      .run();
    const one = await db
      .prepare("UPDATE cc_plain SET v = 2 WHERE id = 1")
      .run();
    const del0 = await db.prepare("DELETE FROM cc_plain WHERE id = 99").run();
    expect([changes(zero), changes(one), changes(del0)]).toEqual([0, 1, 0]);
  });

  it("the same statements inside a batch after rows changed", async () => {
    const { db } = testDb;
    await db.exec("DELETE FROM cc_plain");
    const r = await db.batch([
      db.prepare("INSERT INTO cc_plain VALUES (1, 1), (2, 1), (3, 1)"),
      db.prepare("UPDATE cc_plain SET v = 2 WHERE id IN (1, 2)"),
      db.prepare("UPDATE cc_plain SET v = 9 WHERE id = 99"),
      db.prepare("UPDATE cc_plain SET v = 9 WHERE id = 3"),
      db.prepare("DELETE FROM cc_plain WHERE id = 99"),
    ]);
    expect(r.map(changes)).toEqual([3, 2, 0, 1, 0]);
  });

  it("table with AFTER triggers: does meta.changes include trigger writes?", async () => {
    const { db } = testDb;
    await db.exec("DELETE FROM cc_trig; DELETE FROM cc_log");
    await db.prepare("INSERT INTO cc_trig VALUES (1, 1)").run();
    const upd = await db.prepare("UPDATE cc_trig SET v = 2 WHERE id = 1").run();
    const del = await db.prepare("DELETE FROM cc_trig WHERE id = 1").run();
    // eslint-disable-next-line no-console
    console.info("trigger table single:", {
      upd: changes(upd),
      del: changes(del),
    });
    // Pin only the invariant we rely on elsewhere: 1 row was changed by the statement itself.
    expect(changes(upd)).toBeGreaterThanOrEqual(1);
    expect(changes(del)).toBeGreaterThanOrEqual(1);
  });

  it("statement after a trigger-firing statement in one batch", async () => {
    const { db } = testDb;
    await db.exec(
      "DELETE FROM cc_trig; DELETE FROM cc_log; DELETE FROM cc_plain",
    );
    await db.prepare("INSERT INTO cc_trig VALUES (1, 1)").run();
    const r = await db.batch([
      db.prepare("UPDATE cc_trig SET v = 2 WHERE id = 1"),
      db.prepare("UPDATE cc_plain SET v = 9 WHERE id = 99"),
      db.prepare("DELETE FROM cc_trig WHERE id = 99"),
      db.prepare("DELETE FROM cc_trig WHERE id = 1"),
      db.prepare("DELETE FROM cc_plain WHERE id = 99"),
    ]);
    // eslint-disable-next-line no-console
    console.info("batch after triggers:", r.map(changes));
    expect(changes(r[1])).toBe(0);
    expect(changes(r[2])).toBe(0);
    expect(changes(r[4])).toBe(0);
  });

  it("FK ON DELETE CASCADE rows", async () => {
    const { db } = testDb;
    await db.exec("DELETE FROM cc_child; DELETE FROM cc_parent");
    await db.exec(
      "INSERT INTO cc_parent VALUES (1); INSERT INTO cc_child VALUES (1,1),(2,1),(3,1);",
    );
    const del = await db.prepare("DELETE FROM cc_parent WHERE id = 1").run();
    // eslint-disable-next-line no-console
    console.info("cascade delete:", changes(del));
    expect(changes(del)).toBeGreaterThanOrEqual(1);
  });

  it("real dish_search_index (FTS5 triggers) delete, alone and in a batch", async () => {
    const { db, drizzle } = testDb;
    const now = new Date();
    const [r] = await drizzle
      .insert(restaurants)
      .values({
        name: "cc",
        type: "cafe",
        category: "food",
        description: "d",
        address: "a",
        district: "x",
        city: "Taipei",
        phone: "0200000000",
        email: "cc@example.com",
        businessHours: {},
        settings: {},
        isAvailable: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      } as never)
      .returning();
    const rid = r.id as string;
    const ins = (id: number) =>
      db
        .prepare(
          "INSERT INTO dish_search_index (id, menu_item_id, restaurant_id, dish_name, dish_name_normalized, tags, updated_at_ms) VALUES (?, ?, ?, 'noodle', 'noodle', 'a b c', 1)",
        )
        .bind(id, id, rid);
    const insRes = await ins(1).run();
    const alone = await db
      .prepare("DELETE FROM dish_search_index WHERE id = 1")
      .run();
    const batch = await db.batch([
      ins(2),
      db.prepare("UPDATE dish_search_index SET is_available = 0 WHERE id = 2"),
      db.prepare("UPDATE dish_search_index SET is_available = 0 WHERE id = 99"),
      db.prepare("DELETE FROM dish_search_index WHERE id = 2"),
      db.prepare("DELETE FROM dish_search_index WHERE id = 99"),
      db.prepare("UPDATE cc_plain SET v = 9 WHERE id = 99"),
      db.prepare("UPDATE cc_plain SET v = 9 WHERE id = 99"),
    ]);
    // eslint-disable-next-line no-console
    console.info("dish_search_index:", {
      insert: changes(insRes),
      deleteAlone: changes(alone),
      batch: batch.map(changes),
    });
    // Observed locally: a trigger-firing FTS statement is counted as 3, and
    // 0-row statements that FOLLOW it in the same batch still report non-zero.
    expect(changes(alone)).toBeGreaterThan(1);
    expect(changes(batch[2]) + changes(batch[4])).toBeGreaterThan(0);
  });

  it("drizzle .run() and .returning() against the same statements", async () => {
    const { db, drizzle } = testDb;
    void db;
    const { sql } = await import("drizzle-orm");
    await drizzle.run(sql`DELETE FROM cc_plain`);
    await drizzle.run(sql`INSERT INTO cc_plain VALUES (1, 1)`);
    const upd1 = (await drizzle.run(
      sql`UPDATE cc_plain SET v = 2 WHERE id = 1`,
    )) as unknown as { meta: { changes: number } };
    const upd0 = (await drizzle.run(
      sql`UPDATE cc_plain SET v = 2 WHERE id = 99`,
    )) as unknown as { meta: { changes: number } };
    const ret1 = await drizzle.all(
      sql`UPDATE cc_plain SET v = 3 WHERE id = 1 RETURNING id`,
    );
    const ret0 = await drizzle.all(
      sql`UPDATE cc_plain SET v = 3 WHERE id = 99 RETURNING id`,
    );
    expect([upd1.meta.changes, upd0.meta.changes]).toEqual([1, 0]);
    expect([ret1.length, ret0.length]).toEqual([1, 0]);
  });

  it("SQL changes() ignores trigger writes, so the changes()-gated INSERT pattern holds", async () => {
    const { db } = testDb;
    await db.exec(
      "DELETE FROM cc_trig; DELETE FROM cc_log; DELETE FROM cc_plain",
    );
    await db.exec(
      "INSERT INTO cc_trig VALUES (1, 1); INSERT INTO cc_plain VALUES (7, 0)",
    );
    const gated = (id: number) =>
      db
        .prepare(
          "INSERT INTO cc_plain SELECT ?, 1 FROM cc_trig WHERE id = 1 AND changes() = 1 RETURNING id",
        )
        .bind(id);
    const r = await db.batch([
      db.prepare("UPDATE cc_trig SET v = 2 WHERE id = 1"), // fires 2 trigger writes
      gated(100),
      db.prepare("UPDATE cc_trig SET v = 2 WHERE id = 99"), // matches nothing
      gated(101),
    ]);
    // Winner statement yields a RETURNING row; the lost one yields none.
    expect(r[1].results).toHaveLength(1);
    expect(r[3].results).toHaveLength(0);
  });
});
