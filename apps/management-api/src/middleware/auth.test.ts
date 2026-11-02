import { Hono } from "hono";
import { sign } from "hono/jwt";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@makanmasak/utils";
import { managementAuthMiddleware, type ManagementUser } from "./auth";
import type { ManagementEnv } from "../types";

const JWT_SECRET = "test-jwt-secret-with-at-least-32-chars";
const PRINCIPAL = "018f0000-0000-7000-8000-000000000001";
function envFor(
  state: Record<string, unknown> | null = {
    role: 0,
    is_active: 1,
    token_version: 1,
  },
  activeSession = true,
) {
  return {
    JWT_SECRET,
    PLATFORM_DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () =>
            sql.includes("FROM sessions")
              ? activeSession
                ? { id: "session-1" }
                : null
              : state && {
                  id: PRINCIPAL,
                  username: "admin@example.com",
                  ...state,
                },
          ),
        })),
      })),
    },
  } as unknown as ManagementEnv;
}
const MANAGEMENT_JWT_SECRET = "management-jwt-secret-with-at-least-32-chars";

type TestEnv = {
  Bindings: ManagementEnv;
  Variables: { managementUser: ManagementUser };
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
  app.use("/admin", managementAuthMiddleware);
  app.get("/admin", (c) => c.json({ user: c.get("managementUser") }));
  return app;
}

async function token(payload: Record<string, unknown>) {
  return sign(
    {
      id: "018f0000-0000-7000-8000-000000000001",
      email: "admin@example.com",
      tv: 1,
      sid: "session-1",
      aud: "management",
      iss: "makanmakan-management",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload,
    },
    JWT_SECRET,
  );
}

describe("managementAuthMiddleware", () => {
  it.each([
    { role: 1, is_active: 1, token_version: 1 },
    { role: 0, is_active: 0, token_version: 1 },
    { role: 0, is_active: 1, token_version: 2 },
    null,
  ])("rejects revoked management principals (%j)", async (state) => {
    const response = await createApp().fetch(
      new Request("https://management.test/admin", {
        headers: { Authorization: `Bearer ${await token({ role: "admin" })}` },
      }),
      envFor(state),
    );
    expect(response.status).toBe(401);
  });
  it("rejects management tokens from a terminated source session", async () => {
    const response = await createApp().fetch(
      new Request("https://management.test/admin", {
        headers: { Authorization: `Bearer ${await token({ role: "admin" })}` },
      }),
      envFor(undefined, false),
    );
    expect(response.status).toBe(401);
  });
  it("accepts platform admin JWTs", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://management.test/admin", {
        headers: { Authorization: `Bearer ${await token({ role: "admin" })}` },
      }),
      envFor(),
    );

    await expect(response.json()).resolves.toMatchObject({
      user: {
        id: "018f0000-0000-7000-8000-000000000001",
        email: "admin@example.com",
        role: "admin",
      },
    });
    expect(response.status).toBe(200);
  });

  it("accepts management JWTs signed with the dedicated management secret", async () => {
    const app = createApp();

    const signed = await sign(
      {
        id: "018f0000-0000-7000-8000-000000000001",
        email: "admin@example.com",
        tv: 1,
        sid: "session-1",
        role: "admin",
        aud: "management",
        iss: "makanmakan-management",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      MANAGEMENT_JWT_SECRET,
    );

    const response = await app.fetch(
      new Request("https://management.test/admin", {
        headers: { Authorization: `Bearer ${signed}` },
      }),
      { ...envFor(), MANAGEMENT_JWT_SECRET } as never,
    );

    expect(response.status).toBe(200);
  });

  it("rejects API admin JWTs without management audience and issuer", async () => {
    const app = createApp();
    const apiAdminToken = await sign(
      {
        id: "018f0000-0000-7000-8000-000000000001",
        email: "admin@example.com",
        tv: 1,
        sid: "session-1",
        role: "admin",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      JWT_SECRET,
    );

    const response = await app.fetch(
      new Request("https://management.test/admin", {
        headers: { Authorization: `Bearer ${apiAdminToken}` },
      }),
      envFor(),
    );

    await expect(response.json()).resolves.toMatchObject({
      message: "Invalid token claims",
    });
    expect(response.status).toBe(401);
  });

  it("rejects non-admin JWTs", async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request("https://management.test/admin", {
        headers: { Authorization: `Bearer ${await token({ role: "owner" })}` },
      }),
      envFor(),
    );

    await expect(response.json()).resolves.toMatchObject({
      message: "Invalid token claims",
    });
    expect(response.status).toBe(401);
  });
});

describe("managementAuthMiddleware infrastructure failures", () => {
  function failingEnv(failOn: "users" | "sessions") {
    const env = envFor();
    const original = env.PLATFORM_DB!.prepare as unknown as (
      sql: string,
    ) => unknown;
    const prepare = vi.fn((sql: string) => {
      if (!sql.includes(`FROM ${failOn}`)) return original(sql);
      return {
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            throw new Error("D1_ERROR: SQLITE_BUSY: database is locked");
          }),
        })),
      };
    });
    (env.PLATFORM_DB as unknown as { prepare: unknown }).prepare = prepare;
    return { env, prepare };
  }

  async function request(env: ManagementEnv, bearer: string) {
    const handler = vi.fn();
    const app = new Hono<TestEnv>();
    app.onError((error, c) =>
      error instanceof ApiError
        ? c.json(
            { error: error.code, message: error.message },
            error.status as never,
          )
        : c.json({ error: "INTERNAL" }, 500),
    );
    app.use("/admin", managementAuthMiddleware);
    app.get("/admin", (c) => {
      handler();
      return c.json({ ok: true });
    });
    const response = await app.fetch(
      new Request("https://management.test/admin", {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
      env,
    );
    return { response, handler };
  }

  it.each(["users", "sessions"] as const)(
    "returns 503 and fails closed when the %s lookup throws",
    async (failOn) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { env, prepare } = failingEnv(failOn);

      const { response, handler } = await request(
        env,
        await token({ role: "admin" }),
      );

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toEqual({
        error: "AUTH_BACKEND_UNAVAILABLE",
        message: "Authentication service temporarily unavailable",
      });
      expect(JSON.stringify(body)).not.toContain("SQLITE_BUSY");
      expect(handler).not.toHaveBeenCalled();
      expect(prepare).toHaveBeenCalledWith(
        expect.stringContaining(`FROM ${failOn}`),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Auth backend failure"),
        expect.objectContaining({
          message: expect.stringContaining("SQLITE_BUSY"),
        }),
      );
      errorSpy.mockRestore();
    },
  );

  it("keeps a tampered signature at 401 without touching the database", async () => {
    const env = envFor();
    const valid = await token({ role: "admin" });
    const tampered = `${valid.slice(0, -4)}AAAA`;

    const { response, handler } = await request(env, tampered);

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(env.PLATFORM_DB!.prepare).not.toHaveBeenCalled();
  });

  it("keeps an expired token at 401", async () => {
    const { response, handler } = await request(
      envFor(),
      await token({ role: "admin", exp: Math.floor(Date.now() / 1000) - 10 }),
    );

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps a wrong-audience token at 401", async () => {
    const { response, handler } = await request(
      envFor(),
      await token({ role: "admin", aud: "somewhere-else" }),
    );

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps a malformed token at 401", async () => {
    const { response } = await request(envFor(), "not-a-jwt");
    expect(response.status).toBe(401);
  });
});
