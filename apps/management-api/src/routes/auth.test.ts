import { DatabaseSync } from "node:sqlite";
import { users, sessions } from "@makanmasak/database";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@makanmasak/utils";
import { managementAuthMiddleware } from "../middleware/auth";
import type { ManagementEnv } from "../types";
import authRouter from "./auth";

const JWT_SECRET = "test-jwt-secret-with-at-least-32-chars";
const PRINCIPAL = "018f0000-0000-7000-8000-000000000001";
function envFor(
  row: Record<string, unknown> | null = {
    id: PRINCIPAL,
    username: "platform-admin",
    role: 0,
    is_active: 1,
    token_version: 1,
  },
) {
  return {
    JWT_SECRET,
    MANAGEMENT_JWT_SECRET,
    PLATFORM_DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () =>
            sql.includes("FROM sessions") ? { id: "session-1" } : row,
          ),
        })),
      })),
    },
  } as never;
}
const MANAGEMENT_JWT_SECRET = "management-jwt-secret-with-at-least-32-chars";

type TestEnv = {
  Bindings: ManagementEnv;
  Variables: {
    managementUser: {
      id: string;
      email: string;
      role: "admin";
    };
  };
};

function createApp() {
  const app = new Hono<TestEnv>();
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { error: error.code, message: error.message },
        error.status as never,
      );
    }
    throw error;
  });
  app.route("/auth", authRouter);
  app.use("/admin", managementAuthMiddleware);
  app.get("/admin", (c) => c.json({ user: c.get("managementUser") }));
  return app;
}

async function createApiToken(payload: Record<string, unknown>) {
  return sign(
    {
      id: 7,
      username: "platform-admin",
      role: 0,
      restaurantId: null,
      tv: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload,
    },
    JWT_SECRET,
  );
}

async function createUuidApiToken(payload: Record<string, unknown>) {
  return sign(
    {
      sub: "018f0000-0000-7000-8000-000000000001",
      username: "platform-admin",
      role: 0,
      restaurantId: null,
      tv: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload,
    },
    JWT_SECRET,
  );
}

describe("management auth exchange", () => {
  it("checks real SQLite principal and session state using schema column names", async () => {
    const db = new DatabaseSync(":memory:");
    const apiToken = await createUuidApiToken({});
    try {
      db.exec(
        `CREATE TABLE users (${users.id.name} TEXT, ${users.username.name} TEXT, ${users.role.name} INTEGER, ${users.isActive.name} INTEGER, ${users.tokenVersion.name} INTEGER, ${users.deletedAt.name} INTEGER); CREATE TABLE sessions (${sessions.id.name} TEXT, ${sessions.userId.name} TEXT, ${sessions.token.name} TEXT, ${sessions.isActive.name} INTEGER, ${sessions.expiresAt.name} INTEGER)`,
      );
      db.prepare("INSERT INTO users VALUES (?, ?, 0, 1, 1, NULL)").run(
        PRINCIPAL,
        "platform-admin",
      );
      db.prepare("INSERT INTO sessions VALUES (?, ?, ?, 1, ?)").run(
        "session-1",
        PRINCIPAL,
        apiToken,
        Date.now() + 3600000,
      );
      const env = {
        JWT_SECRET,
        MANAGEMENT_JWT_SECRET,
        PLATFORM_DB: {
          prepare: (sql: string) => ({
            bind: (...values: (string | number)[]) => ({
              first: async () => db.prepare(sql).get(...values) ?? null,
            }),
          }),
        },
      } as never;
      const app = createApp();
      const request = () =>
        new Request("https://management.test/auth/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: apiToken }),
        });
      const exchange = await app.fetch(request(), env);
      expect(exchange.status).toBe(200);
      const body = (await exchange.json()) as { data: { token: string } };
      const protectedRequest = () =>
        new Request("https://management.test/admin", {
          headers: { Authorization: `Bearer ${body.data.token}` },
        });
      expect((await app.fetch(protectedRequest(), env)).status).toBe(200);
      db.exec("UPDATE sessions SET is_active = 0");
      expect((await app.fetch(request(), env)).status).toBe(401);
      expect((await app.fetch(protectedRequest(), env)).status).toBe(401);
    } finally {
      db.close();
    }
  });

  it("rejects obsolete numeric principal tokens", async () => {
    const app = createApp();
    const apiToken = await createApiToken({});
    const env = envFor();

    const exchangeResponse = await app.fetch(
      new Request("https://management.test/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: apiToken }),
      }),
      env,
    );

    expect(exchangeResponse.status).toBe(401);
  });

  it("exchanges UUID-principal API admin tokens", async () => {
    const app = createApp();
    const apiToken = await createUuidApiToken({});
    const env = envFor();

    const exchangeResponse = await app.fetch(
      new Request("https://management.test/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: apiToken }),
      }),
      env,
    );

    expect(exchangeResponse.status).toBe(200);
    const exchangeBody = (await exchangeResponse.json()) as {
      data: { token: string };
    };

    const protectedResponse = await app.fetch(
      new Request("https://management.test/admin", {
        headers: {
          Authorization: `Bearer ${exchangeBody.data.token}`,
        },
      }),
      env,
    );

    expect(protectedResponse.status).toBe(200);
    await expect(protectedResponse.json()).resolves.toMatchObject({
      user: {
        id: "018f0000-0000-7000-8000-000000000001",
        email: "platform-admin",
        role: "admin",
      },
    });
  });

  it.each([
    { role: 1, is_active: 1, token_version: 1 },
    { role: 0, is_active: 0, token_version: 1 },
    { role: 0, is_active: 1, token_version: 2 },
    null,
  ])("rejects revoked API principals (%j)", async (state) => {
    const response = await createApp().fetch(
      new Request("https://management.test/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: await createUuidApiToken({}) }),
      }),
      envFor(state && { id: PRINCIPAL, username: "platform-admin", ...state }),
    );
    expect(response.status).toBe(401);
  });

  it("cannot renew management tokens through exchange with a shared signing secret", async () => {
    const jwt = await sign(
      {
        id: PRINCIPAL,
        email: "platform-admin",
        role: "admin",
        aud: "management",
        iss: "makanmakan-management",
        tv: 1,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      JWT_SECRET,
    );
    const response = await createApp().fetch(
      new Request("https://management.test/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: jwt }),
      }),
      { JWT_SECRET } as never,
    );
    expect(response.status).toBe(401);
  });

  it("does not exchange non-admin API tokens", async () => {
    const app = createApp();
    const apiToken = await createApiToken({ role: 1 });

    const response = await app.fetch(
      new Request("https://management.test/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: apiToken }),
      }),
      { JWT_SECRET, MANAGEMENT_JWT_SECRET } as never,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      message: "Admin API token required",
    });
  });
});
