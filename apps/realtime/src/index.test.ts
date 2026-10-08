import { describe, expect, it, vi } from "vitest";
import { sign } from "jsonwebtoken";
import worker, { buildAllowedOrigins } from "./index";
import type { Env } from "./types/env";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

const jwtSecret = "0123456789abcdefghijklmnopqrstuvwxyz";

function buildToken(overrides: Record<string, unknown> = {}) {
  return sign(
    {
      roomType: "admin",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      role: "admin",
      ...overrides,
    },
    jwtSecret,
    { expiresIn: "1h" },
  );
}

function upgradeRequest(path: string, token?: string) {
  const url = new URL(path, "https://realtime.test");
  if (token) url.searchParams.set("token", token);
  return new Request(url, {
    headers: { Upgrade: "websocket", "CF-Connecting-IP": "203.0.113.10" },
  });
}

function createEnv(input?: {
  corsOrigin?: string;
  durableFetch?: (request: Request) => Response | Promise<Response>;
  ipLimiter?: Env["WS_IP_RATE_LIMITER"];
  clientLimiter?: Env["WS_CLIENT_RATE_LIMITER"];
}): Env {
  const durableObject = {
    fetch: vi.fn(
      input?.durableFetch ??
        (() => jsonResponse({ ok: true, fromDurableObject: true })),
    ),
  };

  return {
    ENVIRONMENT: "test",
    API_VERSION: "1",
    CORS_ORIGIN: input?.corsOrigin,
    JWT_SECRET: "secret",
    REALTIME_JWT_SECRET: jwtSecret,
    WS_IP_RATE_LIMITER: input?.ipLimiter,
    WS_CLIENT_RATE_LIMITER: input?.clientLimiter,
    REALTIME_SESSION: {
      idFromName: vi.fn((name: string) => ({ name })),
      get: vi.fn(() => durableObject),
    } as unknown as DurableObjectNamespace,
    CACHE_KV: {} as KVNamespace,
    TOKEN_BLACKLIST: {
      get: vi.fn(async () => null),
    } as unknown as KVNamespace,
    DB: {} as D1Database,
  };
}

describe("realtime worker routes", () => {
  it("normalizes empty CORS origin configuration to no allowed origins", () => {
    expect(buildAllowedOrigins({ CORS_ORIGIN: undefined })).toEqual([]);
    expect(buildAllowedOrigins({ CORS_ORIGIN: " ,  , " })).toEqual([]);
  });

  it("returns health metadata with the current environment", async () => {
    const response = await worker.fetch(
      new Request("https://realtime.test/health"),
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "healthy",
      service: "makanmasak-realtime",
      environment: "test",
    });
  });

  it("allows CORS origins configured through env", async () => {
    const response = await worker.fetch(
      new Request("https://realtime.test/health", {
        headers: {
          Origin: "https://custom.example.com",
        },
      }),
      createEnv({
        corsOrigin:
          "https://makanmasak.com, https://custom.example.com,https://admin.makanmasak.com",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://custom.example.com",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
  });

  it("does not set CORS allow-origin for unconfigured origins", async () => {
    const response = await worker.fetch(
      new Request("https://realtime.test/health", {
        headers: {
          Origin: "https://blocked.example.com",
        },
      }),
      createEnv({
        corsOrigin: "https://makanmasak.com",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("forwards an authenticated customer upgrade to the room Durable Object", async () => {
    const env = createEnv();
    const token = buildToken({
      roomType: "customer",
      roomId: "customer:table-1",
      role: "customer",
      guestFlag: true,
      tableId: "table-1",
    });
    const response = await worker.fetch(
      upgradeRequest("/customer/table-1", token),
      env,
    );

    expect(response.status).toBe(200);
    expect(env.REALTIME_SESSION.idFromName).toHaveBeenCalledWith(
      "customer:table-1",
    );
    const durable = vi.mocked(env.REALTIME_SESSION.get).mock.results[0]
      .value as { fetch: ReturnType<typeof vi.fn> };
    expect(durable.fetch).toHaveBeenCalledWith(expect.any(Request));
  });

  it("forwards admin and kitchen upgrades to matching Durable Objects", async () => {
    const adminEnv = createEnv();
    const adminResponse = await worker.fetch(
      upgradeRequest("/admin/restaurant-1", buildToken()),
      adminEnv,
    );

    expect(adminResponse.status).toBe(200);
    expect(adminEnv.REALTIME_SESSION.idFromName).toHaveBeenCalledWith(
      "admin:restaurant-1",
    );

    const kitchenEnv = createEnv();
    const kitchenResponse = await worker.fetch(
      upgradeRequest(
        "/kitchen/restaurant-1",
        buildToken({ roomType: "kitchen", role: "staff" }),
      ),
      kitchenEnv,
    );

    expect(kitchenResponse.status).toBe(200);
    expect(kitchenEnv.REALTIME_SESSION.idFromName).toHaveBeenCalledWith(
      "kitchen:restaurant-1",
    );
  });

  it.each([
    ["no token", undefined, 401],
    ["a forged token", sign({ roomType: "admin" }, "x".repeat(32)), 401],
    ["a token for another room", buildToken({ roomId: "restaurant-2" }), 403],
    ["a token for another room type", buildToken({ roomType: "kitchen" }), 403],
  ])(
    "rejects an upgrade with %s without touching a Durable Object",
    async (_label, token, status) => {
      const env = createEnv();
      const response = await worker.fetch(
        upgradeRequest("/admin/restaurant-1", token),
        env,
      );

      expect(response.status).toBe(status);
      expect(env.REALTIME_SESSION.idFromName).not.toHaveBeenCalled();
      expect(env.REALTIME_SESSION.get).not.toHaveBeenCalled();
    },
  );

  it("rejects a revoked token without touching a Durable Object", async () => {
    const env = createEnv();
    vi.mocked(env.TOKEN_BLACKLIST.get).mockResolvedValue("revoked" as never);
    const response = await worker.fetch(
      upgradeRequest("/admin/restaurant-1", buildToken()),
      env,
    );

    expect(response.status).toBe(401);
    expect(env.TOKEN_BLACKLIST.get).toHaveBeenCalledOnce();
    expect(env.REALTIME_SESSION.get).not.toHaveBeenCalled();
  });

  it("answers a plain GET without waking a Durable Object", async () => {
    const env = createEnv();
    const response = await worker.fetch(
      new Request("https://realtime.test/admin/restaurant-1"),
      env,
    );

    expect(response.status).toBe(426);
    expect(env.REALTIME_SESSION.get).not.toHaveBeenCalled();
  });

  it("applies the IP ceiling before reading the token", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ipLimiter = { limit: vi.fn(async () => ({ success: false })) };
    const env = createEnv({ ipLimiter });
    const response = await worker.fetch(
      upgradeRequest("/customer/table-1"),
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: "203.0.113.10" });
    expect(env.TOKEN_BLACKLIST.get).not.toHaveBeenCalled();
    expect(env.REALTIME_SESSION.get).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "REALTIME_RATE_LIMITED",
    });
  });

  it("applies the per-client limit after verification, keyed by who connects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ipLimiter = { limit: vi.fn(async () => ({ success: true })) };
    const clientLimiter = { limit: vi.fn(async () => ({ success: false })) };
    const env = createEnv({ ipLimiter, clientLimiter });
    const response = await worker.fetch(
      upgradeRequest("/admin/restaurant-1", buildToken({ sid: "session-1" })),
      env,
    );

    expect(response.status).toBe(429);
    expect(ipLimiter.limit).toHaveBeenCalledOnce();
    expect(clientLimiter.limit).toHaveBeenCalledWith({
      key: "admin:restaurant-1:session-1",
    });
    expect(env.REALTIME_SESSION.get).not.toHaveBeenCalled();
  });

  it("never spends the per-client budget on an unverified request", async () => {
    const clientLimiter = { limit: vi.fn(async () => ({ success: true })) };
    const env = createEnv({ clientLimiter });
    const response = await worker.fetch(
      upgradeRequest("/admin/restaurant-1"),
      env,
    );

    expect(response.status).toBe(401);
    expect(clientLimiter.limit).not.toHaveBeenCalled();
  });

  it("returns a 503 when the rate limiter is unavailable", async () => {
    const ipLimiter = {
      limit: vi.fn(async () => {
        throw new Error("limiter unavailable");
      }),
    };
    const env = createEnv({ ipLimiter });

    const response = await worker.fetch(
      upgradeRequest("/kitchen/restaurant-1"),
      env,
    );

    expect(response.status).toBe(503);
    expect(ipLimiter.limit).toHaveBeenCalledOnce();
    expect(env.REALTIME_SESSION.get).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Realtime rate limit unavailable",
      code: "REALTIME_RATE_LIMIT_UNAVAILABLE",
    });
  });

  it("does not expose public broadcast or stats Durable Object helpers", async () => {
    const env = createEnv();

    const broadcastResponse = await worker.fetch(
      new Request("https://realtime.test/broadcast/admin/restaurant-1", {
        method: "POST",
        body: JSON.stringify({ type: "NEW_ORDER" }),
      }),
      env,
    );
    const statsResponse = await worker.fetch(
      new Request("https://realtime.test/stats/kitchen/restaurant-1"),
      env,
    );

    expect(broadcastResponse.status).toBe(404);
    expect(statsResponse.status).toBe(404);
    expect(env.REALTIME_SESSION.idFromName).not.toHaveBeenCalled();
    expect(env.REALTIME_SESSION.get).not.toHaveBeenCalled();
  });

  it("returns a descriptive JSON 404 for unknown realtime endpoints", async () => {
    const response = await worker.fetch(
      new Request("https://realtime.test/missing"),
      createEnv(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Realtime endpoint not found",
      path: "/missing",
      availableEndpoints: [
        "/customer/:tableId",
        "/admin/:restaurantId",
        "/kitchen/:restaurantId",
        "/health",
      ],
    });
  });
});
