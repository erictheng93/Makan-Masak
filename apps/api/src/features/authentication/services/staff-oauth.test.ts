import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ApiError } from "../../../shared/utils/api-error";
import {
  findLiveIdentity,
  linkIdentity,
  listIdentities,
  revokeIdentity,
  type Db,
} from "./staff-oauth";

const migration = (name: string) =>
  fileURLToPath(
    new URL(
      `../../../../../../packages/database/migrations_fresh/${name}`,
      import.meta.url,
    ).href,
  );

function applyMigration(sqlite: Database.Database, name: string) {
  for (const statement of readFileSync(migration(name), "utf8").split(
    "--> statement-breakpoint",
  )) {
    sqlite.exec(statement);
  }
}

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    username: "owner1",
    role: 1,
    email: null as string | null,
    last_login_at_ms: null as number | null,
    ...overrides,
  };
}

function insertUser(
  sqlite: Database.Database,
  overrides: Record<string, unknown> = {},
) {
  const u = buildUser(overrides);
  sqlite
    .prepare(
      `INSERT INTO users (id, username, email, full_name, password_hash, role,
        last_login_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'Name', 'hash', ?, ?, 1, 1)`,
    )
    .run(u.id, u.username, u.email, u.role, u.last_login_at_ms);
}

function createDb() {
  const sqlite = new Database(":memory:");
  applyMigration(sqlite, "0000_baseline_strict.sql");
  applyMigration(sqlite, "0044_user_auth_identities.sql");
  return { sqlite, db: drizzle(sqlite) as unknown as Db };
}

const profile = { email: "boss@example.test", emailVerified: true };

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected rejection");
}

describe("migration 0044", () => {
  it("backfills password_set_at_ms only for users who have logged in", () => {
    const sqlite = new Database(":memory:");
    applyMigration(sqlite, "0000_baseline_strict.sql");
    insertUser(sqlite, { id: "used", username: "a", last_login_at_ms: 5_000 });
    insertUser(sqlite, { id: "never", username: "b" });
    applyMigration(sqlite, "0044_user_auth_identities.sql");

    const rows = sqlite
      .prepare("SELECT id, password_set_at_ms AS at FROM users ORDER BY id")
      .all();
    expect(rows).toEqual([
      { id: "never", at: null },
      { id: "used", at: 5_000 },
    ]);
  });

  it("lets a provider account be live for one user, and again after revoke", () => {
    const { sqlite } = createDb();
    insertUser(sqlite, { id: "u1", username: "a" });
    insertUser(sqlite, { id: "u2", username: "b" });
    const insert = sqlite.prepare(
      `INSERT INTO user_auth_identities
        (id, user_id, provider, provider_uid, created_at_ms)
       VALUES (?, ?, ?, ?, 1)`,
    );

    insert.run("i1", "u1", "google", "uid-1");
    expect(() => insert.run("i2", "u2", "google", "uid-1")).toThrow(/UNIQUE/);
    // one live identity per provider per user, too
    expect(() => insert.run("i3", "u1", "google", "uid-2")).toThrow(/UNIQUE/);

    sqlite
      .prepare("UPDATE user_auth_identities SET revoked_at_ms = 9 WHERE id = ?")
      .run("i1");
    expect(() => insert.run("i2", "u2", "google", "uid-1")).not.toThrow();
  });
});

describe("staff OAuth identities", () => {
  it("links an owner, and never finds an identity by email alone", async () => {
    const { sqlite, db } = createDb();
    insertUser(sqlite, { id: "u1", username: "a", email: "boss@example.test" });

    expect(await findLiveIdentity(db, "google", "uid-1")).toBeNull();
    // An email match is irrelevant: nothing was linked, so nothing resolves.
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM user_auth_identities").get(),
    ).toEqual({ n: 0 });

    await linkIdentity(db, {
      userId: "u1",
      provider: "google",
      providerUid: "uid-1",
      profile,
      now: 10,
    });
    expect(await findLiveIdentity(db, "google", "uid-1")).toEqual(
      expect.objectContaining({ userId: "u1", role: 1 }),
    );
  });

  it("refuses to link a non-owner", async () => {
    const { sqlite, db } = createDb();
    insertUser(sqlite, { id: "chef", username: "c", role: 2 });

    const error = await rejection(
      linkIdentity(db, {
        userId: "chef",
        provider: "line",
        providerUid: "uid-1",
        profile,
        now: 10,
      }),
    );
    expect(error).toMatchObject({
      status: 403,
      code: "OAUTH_LINK_NOT_ALLOWED",
    });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM user_auth_identities").get(),
    ).toEqual({ n: 0 });
  });

  it("refuses a provider account already linked to a different user", async () => {
    const { sqlite, db } = createDb();
    insertUser(sqlite, { id: "a", username: "a" });
    insertUser(sqlite, { id: "b", username: "b" });
    const input = {
      provider: "google" as const,
      providerUid: "uid-1",
      profile,
      now: 10,
    };

    await linkIdentity(db, { ...input, userId: "a" });
    const error = await rejection(linkIdentity(db, { ...input, userId: "b" }));

    expect(error).toMatchObject({
      status: 409,
      code: "OAUTH_IDENTITY_ALREADY_LINKED",
    });
    // linking again as the owner of the link is a no-op, not an error
    await expect(linkIdentity(db, { ...input, userId: "a" })).resolves.toEqual({
      id: expect.any(String),
    });
  });

  it("lists live identities without the provider uid", async () => {
    const { sqlite, db } = createDb();
    insertUser(sqlite, { id: "a", username: "a" });
    await linkIdentity(db, {
      userId: "a",
      provider: "google",
      providerUid: "secret-uid",
      profile,
      now: 10,
    });

    const list = await listIdentities(db, "a");
    expect(list).toEqual([
      expect.objectContaining({
        provider: "google",
        email: "boss@example.test",
      }),
    ]);
    expect(JSON.stringify(list)).not.toContain("secret-uid");
  });

  describe("revoke", () => {
    async function ownerWithGoogle(passwordSetAt: number | null) {
      const ctx = createDb();
      insertUser(ctx.sqlite, { id: "a", username: "a" });
      if (passwordSetAt !== null) {
        ctx.sqlite
          .prepare("UPDATE users SET password_set_at_ms = ? WHERE id = 'a'")
          .run(passwordSetAt);
      }
      const { id } = await linkIdentity(ctx.db, {
        userId: "a",
        provider: "google",
        providerUid: "uid-1",
        profile,
        now: 10,
      });
      return { ...ctx, id };
    }

    it("is refused when it is the only way in", async () => {
      const { db, id } = await ownerWithGoogle(null);
      const error = await rejection(revokeIdentity(db, "a", id, 20));
      expect(error).toMatchObject({ status: 409, code: "LAST_AUTH_METHOD" });
      expect(await findLiveIdentity(db, "google", "uid-1")).not.toBeNull();
    });

    it("is allowed when a password was genuinely set", async () => {
      const { db, id } = await ownerWithGoogle(5);
      await expect(revokeIdentity(db, "a", id, 20)).resolves.toEqual({
        provider: "google",
      });
      expect(await findLiveIdentity(db, "google", "uid-1")).toBeNull();
    });

    it("is allowed when another live identity remains", async () => {
      const { db, id } = await ownerWithGoogle(null);
      await linkIdentity(db, {
        userId: "a",
        provider: "line",
        providerUid: "line-1",
        profile,
        now: 11,
      });
      await expect(revokeIdentity(db, "a", id, 20)).resolves.toBeDefined();
    });

    it("cannot touch another user's identity", async () => {
      const { sqlite, db, id } = await ownerWithGoogle(5);
      insertUser(sqlite, { id: "b", username: "b" });
      const error = await rejection(revokeIdentity(db, "b", id, 20));
      expect(error).toMatchObject({ status: 404, code: "IDENTITY_NOT_FOUND" });
    });
  });
});
