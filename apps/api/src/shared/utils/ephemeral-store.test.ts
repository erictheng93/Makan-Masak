import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { D1EphemeralStore } from "./ephemeral-store";

// Built from the real migration, so the test also proves the SQL applies and
// that the table the code expects is the table that ships.
const MIGRATION = fileURLToPath(
  new URL(
    "../../../../../packages/database/migrations_fresh/0043_ephemeral_kv.sql",
    import.meta.url,
  ).href,
);

function createStore(now: () => number) {
  const sqlite = new Database(":memory:");
  for (const statement of readFileSync(MIGRATION, "utf8").split(
    "--> statement-breakpoint",
  )) {
    sqlite.exec(statement);
  }
  const db = drizzle(sqlite) as unknown as ConstructorParameters<
    typeof D1EphemeralStore
  >[0];
  return { store: new D1EphemeralStore(db, now), sqlite };
}

describe("D1EphemeralStore", () => {
  it("round-trips strings and JSON, and overwrites on a second put", async () => {
    const { store } = createStore(() => 1_000);

    expect(await store.get("missing")).toBeNull();

    await store.put("k", JSON.stringify({ count: 1 }), { expirationTtl: 60 });
    await store.put("k", JSON.stringify({ count: 2 }), { expirationTtl: 60 });

    expect(await store.get("k")).toBe('{"count":2}');
    expect(await store.get<{ count: number }>("k", "json")).toEqual({
      count: 2,
    });
  });

  it("stops returning a key once its TTL has passed", async () => {
    let now = 1_000;
    const { store, sqlite } = createStore(() => now);
    await store.put("token", "v", { expirationTtl: 60 });

    now += 59_999;
    expect(await store.get("token")).toBe("v");

    now += 1;
    expect(await store.get("token")).toBeNull();

    await store.deleteExpired();
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM ephemeral_kv").get(),
    ).toEqual({ n: 0 });
  });

  it("deletes one key without touching the others", async () => {
    const { store } = createStore(() => 1_000);
    await store.put("a", "1", { expirationTtl: 60 });
    await store.put("b", "2", { expirationTtl: 60 });

    await store.delete("a");

    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).toBe("2");
  });

  it("rejects a non-integer expiry, because the table is STRICT", () => {
    const { sqlite } = createStore(() => 1_000);
    expect(() =>
      sqlite
        .prepare("INSERT INTO ephemeral_kv VALUES ('k', 'v', 'soon')")
        .run(),
    ).toThrow();
  });

  it("takes a value exactly once", async () => {
    let now = 1_000;
    const { store } = createStore(() => now);
    await store.put("code", "v", { expirationTtl: 60 });

    expect(await store.take("code")).toBe("v");
    expect(await store.take("code")).toBeNull();

    await store.put("late", "v", { expirationTtl: 60 });
    now += 60_000;
    expect(await store.take("late")).toBeNull();
  });
});
