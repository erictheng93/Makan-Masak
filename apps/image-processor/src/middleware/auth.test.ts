import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import {
  apiKeyAuth,
  authMiddleware,
  optionalAuth,
  corsMiddleware,
} from "./auth";

import { staffAuthDatabase } from "../__tests__/staff-auth-fixture";

function createApp(env: Record<string, unknown>) {
  const app = new Hono();
  app.use("*", (c, next) => apiKeyAuth(c as never, next));
  app.get("/protected", (c) => c.json({ success: true }));

  return {
    request: (apiKey?: string) =>
      app.fetch(
        new Request("https://images.test/protected", {
          headers: apiKey ? { "X-API-Key": apiKey } : {},
        }),
        env,
      ),
  };
}

describe("image processor API key auth", () => {
  it("fails closed when API_KEY is not configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await createApp({}).request("default-api-key");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Server configuration error",
    });
  });

  it("requires the configured API key", async () => {
    const app = createApp({ API_KEY: "x".repeat(32) });

    expect((await app.request("wrong")).status).toBe(401);
    expect((await app.request("x".repeat(32))).status).toBe(200);
  });
});

describe("image processor JWT auth (UUID token shape)", () => {
  const jwtSecret = "test-jwt-secret-with-at-least-32-chars";
  const userUuid = "01890a5d-ac96-774b-bcce-b302099a8057";
  const restaurantUuid = "01890a5d-ac96-774b-bcce-b302099a8058";

  async function requestWith(
    claims: Record<string, unknown>,
    current?: Record<string, unknown> | null,
    optional = false,
    sessionActive = true,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const token = await sign(
      { iat: now, exp: now + 3600, ...claims },
      jwtSecret,
    );

    const app = new Hono();
    app.use("*", (c, next) =>
      (optional ? optionalAuth : authMiddleware)(c as never, next),
    );
    app.get("/protected", (c) => c.json({ user: c.get("user") }));

    return app.fetch(
      new Request("https://images.test/protected", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      {
        JWT_SECRET: jwtSecret,
        DB: staffAuthDatabase(
          current === undefined
            ? {
                id: userUuid,
                username: claims.username,
                role: claims.role,
                restaurant_id: claims.restaurantId ?? null,
                is_active: 1,
                token_version: 1,
              }
            : current,
          sessionActive,
        ),
      },
    );
  }

  it("accepts a current main-API token: sub UUID v7 + string restaurantId", async () => {
    const response = await requestWith({
      sub: userUuid,
      username: "owner1",
      role: 1,
      restaurantId: restaurantUuid,
      tv: 1,
      jti: "j-1",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { id: string; role: number; restaurantId?: string };
    };
    expect(body.user).toMatchObject({
      id: userUuid,
      role: 1,
      restaurantId: restaurantUuid,
    });
  });

  it("accepts platform admin tokens without a restaurant", async () => {
    const response = await requestWith({
      sub: userUuid,
      username: "admin",
      role: 0,
      restaurantId: null,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { id: string; restaurantId?: string };
    };
    expect(body.user.id).toBe(userUuid);
    expect(body.user).not.toHaveProperty("restaurantId");
  });

  it.each([
    ["inactive", { is_active: 0 }],
    ["renamed", { username: "renamed" }],
    ["demoted", { role: 4 }],
    ["revoked version", { token_version: 2 }],
  ])(
    "rejects %s staff tokens on required and optional auth",
    async (_name, drift) => {
      const claims = {
        sub: userUuid,
        username: "owner1",
        role: 1,
        restaurantId: restaurantUuid,
        tv: 1,
      };
      const current = {
        id: userUuid,
        username: "owner1",
        role: 1,
        restaurant_id: restaurantUuid,
        is_active: 1,
        token_version: 1,
        ...drift,
      };
      expect((await requestWith(claims, current)).status).toBe(401);
      const optional = await requestWith(claims, current, true);
      expect(optional.status).toBe(200);
      expect(await optional.json()).toEqual({});
    },
  );

  it("uses the staff member's current restaurant instead of the stale token claim", async () => {
    const currentRestaurant = "01890a5d-ac96-774b-bcce-b302099a8059";
    const claims = {
      sub: userUuid,
      username: "owner1",
      role: 1,
      restaurantId: restaurantUuid,
      tv: 1,
    };
    const current = {
      id: userUuid,
      username: "owner1",
      role: 1,
      restaurant_id: currentRestaurant,
      is_active: 1,
      token_version: 1,
    };
    for (const optional of [false, true]) {
      const response = await requestWith(claims, current, optional);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { restaurantId: currentRestaurant },
      });
    }
  });

  it("rejects terminated or rotated sessions on required and optional auth", async () => {
    const claims = {
      sub: userUuid,
      username: "owner1",
      role: 1,
      restaurantId: restaurantUuid,
      tv: 1,
    };
    expect((await requestWith(claims, undefined, false, false)).status).toBe(
      401,
    );
    expect(
      await (await requestWith(claims, undefined, true, false)).json(),
    ).toEqual({});
  });

  it("rejects the legacy integer-id payload shape", async () => {
    const response = await requestWith({
      id: 1,
      username: "owner1",
      role: 1,
      restaurantId: 5,
    });

    expect(response.status).toBe(401);
  });

  it("rejects numeric restaurantId claims", async () => {
    const response = await requestWith({
      sub: userUuid,
      username: "owner1",
      role: 1,
      restaurantId: 5,
    });

    expect(response.status).toBe(401);
  });

  it("rejects a token whose sub is not a UUID v7", async () => {
    const response = await requestWith({
      sub: "not-a-uuid",
      username: "owner1",
      role: 1,
    });

    expect(response.status).toBe(401);
  });

  it("rejects role 5 (customer) tokens", async () => {
    const response = await requestWith({
      sub: userUuid,
      username: "cust",
      role: 5,
      restaurantId: restaurantUuid,
    });

    expect(response.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await requestWith({
      sub: userUuid,
      username: "owner1",
      role: 1,
      iat: now - 7200,
      exp: now - 3600,
    });

    expect(response.status).toBe(401);
  });

  it("accepts tokens up to 72h old (aligned with main API max token age)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await requestWith({
      sub: userUuid,
      username: "owner1",
      role: 1,
      restaurantId: restaurantUuid,
      iat: now - 48 * 60 * 60,
      exp: now + 3600,
    });

    expect(response.status).toBe(200);
  });

  it("rejects tokens older than 72h", async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await requestWith({
      sub: userUuid,
      username: "owner1",
      role: 1,
      iat: now - 73 * 60 * 60,
      exp: now + 3600,
    });

    expect(response.status).toBe(401);
  });
});

describe("image processor CORS", () => {
  it("does not emit wildcard CORS for arbitrary origins", async () => {
    const app = new Hono();
    app.use("*", (c, next) => corsMiddleware(c as never, next));
    app.get("/images", (c) => c.json({ success: true }));

    const response = await app.fetch(
      new Request("https://images.test/images", {
        headers: { Origin: "https://evil.example" },
      }),
      { NODE_ENV: "production" },
    );

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reflects configured image origins", async () => {
    const app = new Hono();
    app.use("*", (c, next) => corsMiddleware(c as never, next));
    app.get("/images", (c) => c.json({ success: true }));

    const response = await app.fetch(
      new Request("https://images.test/images", {
        headers: { Origin: "https://makanmasak.com" },
      }),
      {
        NODE_ENV: "production",
        CORS_ORIGIN: "https://makanmasak.com",
      },
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://makanmasak.com",
    );
  });
});

describe("image auth session SQL", () => {
  it("requires the current stored access token and an unexpired active session", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE users (id TEXT, username TEXT, role INTEGER, restaurant_id TEXT, is_active INTEGER, token_version INTEGER);
      CREATE TABLE sessions (id TEXT, user_id TEXT, token TEXT, is_active INTEGER, expires_at_ms INTEGER);
      INSERT INTO users VALUES ('01890a5d-ac96-774b-bcce-b302099a8057', 'admin', 0, NULL, 1, 1);
    `);
    const secret = "test-jwt-secret-with-at-least-32-chars";
    const now = Math.floor(Date.now() / 1000);
    const token = await sign(
      {
        sub: "01890a5d-ac96-774b-bcce-b302099a8057",
        username: "admin",
        role: 0,
        tv: 1,
        iat: now,
        exp: now + 3600,
      },
      secret,
    );
    const insert = sqlite.prepare(
      "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
    );
    const app = new Hono();
    app.use("*", (c, next) => authMiddleware(c as never, next));
    app.get("/protected", (c) => c.json({ user: c.get("user") }));
    const db = {
      prepare: (query: string) => ({
        bind: (...params: (string | number)[]) => ({
          first: async () => sqlite.prepare(query).get(...params) ?? null,
        }),
      }),
    };
    const request = () =>
      app.fetch(
        new Request("https://images.test/protected", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        { JWT_SECRET: secret, DB: db },
      );
    try {
      for (const [storedToken, active, expires, expectedStatus] of [
        [token, 1, Date.now() + 3600_000, 200],
        [token, 0, Date.now() + 3600_000, 401],
        ["rotated-token", 1, Date.now() + 3600_000, 401],
        [token, 1, Date.now() - 1000, 401],
      ] as const) {
        sqlite.exec("DELETE FROM sessions");
        insert.run(
          "session-1",
          "01890a5d-ac96-774b-bcce-b302099a8057",
          storedToken,
          active,
          expires,
        );
        expect((await request()).status).toBe(expectedStatus);
      }
    } finally {
      sqlite.close();
    }
  });
});
