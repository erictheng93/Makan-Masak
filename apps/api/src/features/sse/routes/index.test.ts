import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { sign } from "hono/jwt";
import { sign as signJsonWebToken } from "jsonwebtoken";
import { Hono } from "hono";
import routesRouter from "./index";
import { handleAppError } from "../../../utils/app-error-handler";

// A bare router turns every throw into 500; mount under the real handler.
const routes = new Hono();
routes.onError(handleAppError);
routes.route("/", routesRouter);

const authMiddleware = vi.hoisted(() =>
  vi.fn(async (c: { set: (key: string, value: unknown) => void }, next) => {
    c.set("user", {
      id: "user-42",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    } satisfies AuthUser);
    await next();
  }),
);

vi.mock("../../../middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../middleware/auth")>();
  return {
    ...actual,
    authMiddleware,
  };
});

const jwtSecret = "x".repeat(32);

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    JWT_SECRET: jwtSecret,
    REALTIME_WS_URL: "wss://realtime.test",
    ...overrides,
  };
}

async function createToken() {
  return sign(
    {
      id: "user-42",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    },
    jwtSecret,
    "HS256",
  );
}

function createJsonWebToken() {
  return signJsonWebToken(
    {
      id: "user-42",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    },
    jwtSecret,
    { algorithm: "HS256" },
  );
}

function strictAtob(encoded: string): string {
  if (encoded.length % 4 !== 0) {
    throw new DOMException(
      "atob() called with invalid base64-encoded data",
      "InvalidCharacterError",
    );
  }

  return Buffer.from(encoded, "base64").toString("binary");
}

async function withSilencedRouteError<T>(
  action: () => T | Promise<T>,
): Promise<Awaited<T>> {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    return await action();
  } finally {
    consoleError.mockRestore();
  }
}

describe("legacy SSE compatibility routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authMiddleware.mockClear();
  });

  it("returns retired realtime guidance for authenticated SSE event clients", async () => {
    const token = await createToken();

    const response = await routes.fetch(
      new Request(`https://api.test/events?token=${token}`),
      createEnv() as never,
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      data: { realtimeWsUrl: "wss://realtime.test" },
    });
  });

  it("accepts jsonwebtoken-signed SSE tokens when atob requires padded base64", async () => {
    const originalAtob = globalThis.atob;
    vi.stubGlobal("atob", strictAtob);
    try {
      const token = createJsonWebToken();

      const response = await routes.fetch(
        new Request(`https://api.test/events?token=${token}`),
        createEnv() as never,
      );

      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        data: { realtimeWsUrl: "wss://realtime.test" },
      });
    } finally {
      vi.stubGlobal("atob", originalAtob);
    }
  });

  it("accepts bearer tokens and checks the token blacklist for SSE events", async () => {
    const token = await createToken();
    const blacklist = { get: vi.fn().mockResolvedValue(null) };

    const response = await routes.fetch(
      new Request("https://api.test/events", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      createEnv({ TOKEN_BLACKLIST: blacklist }) as never,
    );

    expect(response.status).toBe(410);
    expect(blacklist.get).toHaveBeenCalledWith(`token:${token}`);
  });

  it("rejects SSE event requests without usable authentication", async () => {
    const missingToken = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://api.test/events"),
        createEnv() as never,
      ),
    );
    expect(missingToken.status).toBe(401);

    const missingSecret = await withSilencedRouteError(async () =>
      routes.fetch(
        new Request(`https://api.test/events?token=${await createToken()}`),
        createEnv({ JWT_SECRET: "short" }) as never,
      ),
    );
    expect(missingSecret.status).toBe(500);

    const blacklisted = await withSilencedRouteError(async () =>
      routes.fetch(
        new Request(`https://api.test/events?token=${await createToken()}`),
        createEnv({
          TOKEN_BLACKLIST: { get: vi.fn().mockResolvedValue("revoked") },
        }) as never,
      ),
    );
    expect(blacklisted.status).toBe(401);
  });

  it("returns retired guidance for authenticated legacy management routes", async () => {
    for (const request of [
      new Request("https://api.test/connections"),
      new Request("https://api.test/test", { method: "POST" }),
      new Request("https://api.test/broadcast/orders", { method: "POST" }),
      new Request("https://api.test/notify/group", { method: "POST" }),
      new Request("https://api.test/group/group-1/health"),
      new Request("https://api.test/group/group-1/sync"),
    ]) {
      const response = await routes.fetch(request, createEnv() as never);
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        data: { realtimeWsUrl: "wss://realtime.test" },
      });
    }

    expect(authMiddleware).toHaveBeenCalledTimes(6);
  });

  it("keeps ping and time probes available behind auth middleware", async () => {
    const ping = await routes.fetch(
      new Request("https://api.test/ping"),
      createEnv() as never,
    );
    expect(ping.status).toBe(200);
    await expect(ping.json()).resolves.toMatchObject({
      success: true,
      data: { pong: true, realtime: "websocket" },
    });

    const time = await routes.fetch(
      new Request("https://api.test/time"),
      createEnv() as never,
    );
    expect(time.status).toBe(200);
    await expect(time.json()).resolves.toMatchObject({
      success: true,
      data: { timestamp: expect.any(Number), iso: expect.any(String) },
    });
  });
});
