import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { sessions, users } from "../schema";
import { AuthService } from "./auth";

describe("staff session logout", () => {
  it("atomically revokes every session and increments the live token version", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(
        `CREATE TABLE users (${users.id.name} TEXT, ${users.tokenVersion.name} INTEGER, ${users.updatedAt.name} INTEGER); CREATE TABLE sessions (${sessions.userId.name} TEXT, ${sessions.token.name} TEXT, ${sessions.isActive.name} INTEGER, ${sessions.updatedAt.name} INTEGER)`,
      );
      sqlite.exec(
        "INSERT INTO users VALUES ('owner', 1, 0); INSERT INTO sessions VALUES ('owner', 'token-1', 1, 0), ('owner', 'token-2', 1, 0)",
      );
      const prepare = (sql: string) => {
        let parameters: (string | number | null)[] = [];
        const statement = {
          bind: (...values: (string | number | null)[]) => {
            parameters = values;
            return statement;
          },
          run: async () => {
            const result = sqlite.prepare(sql).run(...parameters);
            return {
              success: true,
              results: [],
              meta: { changes: Number(result.changes) },
            };
          },
          all: async () => statement.run(),
        };
        return statement;
      };
      const db = {
        prepare,
        batch: async (statements: ReturnType<typeof prepare>[]) => {
          sqlite.exec("BEGIN");
          try {
            const results = await Promise.all(
              statements.map((statement) => statement.run()),
            );
            sqlite.exec("COMMIT");
            return results;
          } catch (error) {
            sqlite.exec("ROLLBACK");
            throw error;
          }
        },
      } as unknown as D1Database;
      const service = new AuthService(db, {
        JWT_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
        NODE_ENV: "test",
      });
      expect(await service.logout("owner", "token-1")).toBe(true);
      expect(
        sqlite.prepare("SELECT token_version FROM users").get(),
      ).toMatchObject({ token_version: 1 });
      expect(
        sqlite.prepare("SELECT token FROM sessions WHERE is_active = 1").all(),
      ).toEqual([{ token: "token-2" }]);
      expect(await service.logout("owner")).toBe(true);
      expect(
        sqlite.prepare("SELECT token_version FROM users").get(),
      ).toMatchObject({ token_version: 2 });
      expect(
        sqlite
          .prepare(
            "SELECT COUNT(*) AS active FROM sessions WHERE is_active = 1",
          )
          .get(),
      ).toMatchObject({ active: 0 });
    } finally {
      sqlite.close();
    }
  });
});
