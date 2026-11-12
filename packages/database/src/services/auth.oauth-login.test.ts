import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AuthService } from "./auth";

const MIGRATIONS = [
  "0000_baseline_strict.sql",
  "0040_users_admin_tier.sql",
  "0041_restaurant_login_slug.sql",
];

/** Just enough of the D1 binding for drizzle's d1 driver, over better-sqlite3. */
function d1Over(sqlite: Database.Database): D1Database {
  const prepare = (sql: string) => {
    const stmt = sqlite.prepare(sql);
    let params: unknown[] = [];
    const exec = (raw: boolean) =>
      stmt.reader
        ? { results: raw ? stmt.raw(true).all(...params) : stmt.all(...params) }
        : { results: [], meta: { changes: stmt.run(...params).changes } };
    const self = {
      bind: (...p: unknown[]) => ((params = p), self),
      all: async () => exec(false),
      raw: async () => exec(true).results,
      run: async () => exec(false),
      first: async () => stmt.get(...params) ?? null,
    };
    return self;
  };
  return {
    prepare,
    batch: async (statements: Array<ReturnType<typeof prepare>>) => {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec("COMMIT");
        return out;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

function setup(
  opts: {
    userActive?: boolean;
    userDeleted?: boolean;
    restaurantActive?: boolean;
    restaurantDeleted?: boolean;
    role?: number;
  } = {},
) {
  const sqlite = new Database(":memory:");
  for (const name of MIGRATIONS) {
    const file = fileURLToPath(
      new URL(`../../migrations_fresh/${name}`, import.meta.url),
    );
    for (const statement of readFileSync(file, "utf8").split(
      "--> statement-breakpoint",
    )) {
      sqlite.exec(statement);
    }
  }
  sqlite
    .prepare(
      `INSERT INTO restaurants (id, name, type, category, address, district, phone,
         is_active, deleted_at_ms, login_slug, created_at_ms, updated_at_ms)
       VALUES ('r1', 'Shop', 't', 'c', 'a', 'd', 'p', ?, ?, 'shop', 1, 1)`,
    )
    .run(
      opts.restaurantActive === false ? 0 : 1,
      opts.restaurantDeleted ? 5 : null,
    );
  sqlite
    .prepare(
      `INSERT INTO users (id, username, full_name, password_hash, role, restaurant_id,
         is_active, deleted_at_ms, created_at_ms, updated_at_ms)
       VALUES ('u1', 'owner', 'Owner', 'hash', ?, 'r1', ?, ?, 1, 1)`,
    )
    .run(
      opts.role ?? 1,
      opts.userActive === false ? 0 : 1,
      opts.userDeleted ? 5 : null,
    );
  const service = new AuthService(d1Over(sqlite), {
    JWT_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
    NODE_ENV: "test",
  });
  return { sqlite, service };
}

const sessions = (sqlite: Database.Database) =>
  (sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number })
    .n;

describe("AuthService.loginVerifiedUser", () => {
  it("creates the same session password login would for an active owner", async () => {
    const { sqlite, service } = setup();
    const result = await service.loginVerifiedUser("u1", {});

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        user: expect.objectContaining({ id: "u1", loginSlug: "shop", role: 1 }),
        tokens: expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        }),
      }),
    );
    expect(sessions(sqlite)).toBe(1);
    expect(
      sqlite.prepare("SELECT last_login_at_ms AS at FROM users").get(),
    ).toEqual({ at: expect.any(Number) });
  });

  it.each([
    ["an inactive user", { userActive: false }],
    ["a deleted user", { userDeleted: true }],
    ["an inactive restaurant", { restaurantActive: false }],
    ["a deleted restaurant", { restaurantDeleted: true }],
    ["a retired customer-role row", { role: 5 }],
  ])("refuses %s and creates no session", async (_label, opts) => {
    const { sqlite, service } = setup(opts);
    const result = await service.loginVerifiedUser("u1", {});

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        reason: "invalid_credentials",
      }),
    );
    expect(result.tokens).toBeUndefined();
    expect(sessions(sqlite)).toBe(0);
  });
});
