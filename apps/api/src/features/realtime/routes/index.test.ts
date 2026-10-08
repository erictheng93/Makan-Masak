import { beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "hono/jwt";
import routes from "./index";

const serviceMethods = vi.hoisted(() => ({
  generateWebSocketToken: vi.fn(),
  generateGuestToken: vi.fn(),
  verifyWebSocketToken: vi.fn(),
  verifyChannelAccess: vi.fn(),
  revokeToken: vi.fn(),
  revokeUserTokens: vi.fn(),
  getBlacklistStats: vi.fn(),
}));

const realtimeAuthService = vi.hoisted(() =>
  vi.fn(function RealtimeAuthService() {
    return serviceMethods;
  }),
);

vi.mock("../services/RealtimeAuthService", () => ({
  RealtimeAuthService: realtimeAuthService,
}));

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

const adminUserId = "018f0000-0000-7000-8000-000000000001";
const staffUserId = "018f0000-0000-7000-8000-000000000002";

function userRowForRole(role: number, restaurantId: string) {
  return {
    id: role === 0 ? adminUserId : staffUserId,
    username: role === 0 ? "admin" : "staff",
    role,
    restaurant_id: role === 0 ? null : restaurantId,
    is_active: 1,
    token_version: 1,
  };
}

function createEnv(input?: {
  userRole?: number;
  restaurantId?: string;
  durableFetch?: (request: Request) => Response | Promise<Response>;
}) {
  const userRole = input?.userRole ?? 0;
  const restaurantId = input?.restaurantId ?? "restaurant-1";
  const durableFetch = vi.fn(
    input?.durableFetch ?? (() => jsonResponse({ connectionCount: 0 })),
  );
  const durableObject = {
    fetch: durableFetch,
  };

  return {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => userRowForRole(userRole, restaurantId)),
        })),
      })),
    },
    JWT_SECRET: "x".repeat(32),
    REALTIME_JWT_SECRET: "y".repeat(32),
    REALTIME_SERVICE_URL: "https://realtime.test",
    REALTIME_SESSION: {
      idFromName: vi.fn((name: string) => ({ name })),
      get: vi.fn(() => durableObject),
    },
  };
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function authHeaders(
  role: number = 0,
  restaurantId: string = "restaurant-1",
) {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    {
      sub: role === 0 ? adminUserId : staffUserId,
      username: role === 0 ? "admin" : "staff",
      role,
      restaurantId,
      tv: 1,
      iat: now,
      exp: now + 3600,
    },
    "x".repeat(32),
  );

  return { Authorization: `Bearer ${token}` };
}

type StatsOverviewBody = {
  success: boolean;
  data: {
    roomStats: Array<{
      roomType: string;
      connectionCount: number;
      status: string;
    }>;
  };
};

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

describe("realtime routes", () => {
  beforeEach(() => {
    realtimeAuthService.mockClear();
    for (const method of Object.values(serviceMethods)) {
      method.mockReset();
    }
    vi.restoreAllMocks();
  });

  it("generates staff websocket tokens from validated request bodies", async () => {
    serviceMethods.generateWebSocketToken.mockResolvedValue({
      token: "ws-token",
      expiresIn: 300,
      wsUrl: "wss://realtime.test/kitchen/restaurant-1?token=ws-token",
    });
    const env = createEnv();

    const response = await routes.fetch(
      jsonRequest("/auth/token", {
        roomType: "kitchen",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: "session-token",
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { token: "ws-token", expiresIn: 300 },
    });
    expect(realtimeAuthService).toHaveBeenCalledWith(env);
    expect(serviceMethods.generateWebSocketToken).toHaveBeenCalledWith({
      roomType: "kitchen",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      sessionId: "session-token",
    });
  });

  it("rejects a `restaurant` room token request before reaching the service", async () => {
    const response = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/auth/token", {
          roomType: "restaurant",
          roomId: "restaurant-1",
          restaurantId: "restaurant-1",
          sessionId: "session-token",
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(serviceMethods.generateWebSocketToken).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated customer room token requests before reaching the service", async () => {
    for (const body of [
      // The reported vulnerability: omit tableId and name any room.
      {
        roomType: "customer",
        roomId: "group-order-42",
        restaurantId: "restaurant-1",
      },
      // Supplying a table ID must not re-open the path.
      {
        roomType: "customer",
        roomId: "group-order-42",
        restaurantId: "restaurant-1",
        tableId: "7",
      },
    ]) {
      const response = await withSilencedRouteError(() =>
        routes.fetch(jsonRequest("/auth/token", body), createEnv() as never),
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
    }

    expect(serviceMethods.generateWebSocketToken).not.toHaveBeenCalled();
  });

  it("maps websocket token service errors and validation failures to route errors", async () => {
    serviceMethods.generateWebSocketToken.mockResolvedValue({
      error: "Room ID must match restaurant ID",
    });

    const serviceErrorResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/auth/token", {
          roomType: "kitchen",
          roomId: "other",
          restaurantId: "restaurant-1",
          sessionId: "session-token",
        }),
        createEnv() as never,
      ),
    );
    expect(serviceErrorResponse.status).toBe(500);

    const validationResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/auth/token", {
          roomType: "kitchen",
          roomId: "",
          restaurantId: "restaurant-1",
        }),
        createEnv() as never,
      ),
    );
    expect(validationResponse.status).toBe(500);
    expect(serviceMethods.generateWebSocketToken).toHaveBeenCalledTimes(1);
  });

  it("generates guest tokens and skips rate limiting for test requests without an IP", async () => {
    serviceMethods.generateGuestToken.mockResolvedValue({
      token: "guest-ws-token",
      expiresAt: "2026-06-07T12:15:00.000Z",
      wsUrl: "wss://realtime.test/customer/order:100?token=guest-ws-token",
    });

    const response = await routes.fetch(
      jsonRequest("/auth/guest-token", {
        restaurantId: "restaurant-1",
        guestToken: `gt_${"a".repeat(64)}`,
        orderId: 100,
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { token: "guest-ws-token" },
    });
    expect(serviceMethods.generateGuestToken).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      guestToken: `gt_${"a".repeat(64)}`,
      orderId: "100",
    });
  });

  it("verifies websocket tokens and optional scoped channel access", async () => {
    const payload = {
      roomType: "customer",
      roomId: "order:100",
      restaurantId: "restaurant-1",
      role: "customer",
      scope: "guest-realtime",
      orderId: "100",
      tableId: "7",
      seatId: "3",
      userId: "user-1",
      publicUserId: "public-user-1",
      appRole: 5,
      exp: 1780488000,
      iat: 1780487100,
    };
    serviceMethods.verifyWebSocketToken.mockResolvedValue({
      valid: true,
      payload,
    });
    serviceMethods.verifyChannelAccess.mockReturnValue({ allowed: true });

    const response = await routes.fetch(
      jsonRequest("/auth/verify", {
        token: "token",
        channel: "order:100",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      data: {
        valid: true,
        roomType: "customer",
        expiresAt: "2026-06-03T12:00:00.000Z",
        channelAccess: { allowed: true },
      },
    });
    expect(JSON.stringify(body)).not.toContain("order:100");
    expect(JSON.stringify(body)).not.toContain("restaurant-1");
    expect(JSON.stringify(body)).not.toContain("user-1");
    expect(JSON.stringify(body)).not.toContain("public-user-1");
    expect(JSON.stringify(body)).not.toContain('"tableId"');
    expect(JSON.stringify(body)).not.toContain('"seatId"');
    expect(JSON.stringify(body)).not.toContain('"orderId"');
    expect(JSON.stringify(body)).not.toContain('"payload"');
    expect(serviceMethods.verifyWebSocketToken).toHaveBeenCalledWith("token");
    expect(serviceMethods.verifyChannelAccess).toHaveBeenCalledWith(
      payload,
      "order:100",
    );
  });

  it("rejects invalid tokens and denied channel access", async () => {
    serviceMethods.verifyWebSocketToken.mockResolvedValueOnce({
      valid: false,
      error: "Invalid token",
    });

    const invalidResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/auth/verify", { token: "bad", channel: "order:100" }),
        createEnv() as never,
      ),
    );
    expect(invalidResponse.status).toBe(500);

    serviceMethods.verifyWebSocketToken.mockResolvedValueOnce({
      valid: true,
      payload: { roomType: "customer", roomId: "order:100" },
    });
    serviceMethods.verifyChannelAccess.mockReturnValue({
      allowed: false,
      error: "Token is not scoped to this channel",
    });

    const deniedResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/auth/verify", {
          token: "token",
          channel: "order:200",
        }),
        createEnv() as never,
      ),
    );
    expect(deniedResponse.status).toBe(500);
  });

  it("allows admins to revoke tokens and read blacklist stats", async () => {
    serviceMethods.revokeToken.mockResolvedValue({ success: true });
    serviceMethods.revokeUserTokens.mockResolvedValue({
      success: true,
      count: 3,
    });
    serviceMethods.getBlacklistStats.mockResolvedValue({
      available: true,
      estimatedCount: 7,
    });

    const revokeResponse = await routes.fetch(
      new Request("https://api.test/auth/revoke", {
        method: "POST",
        body: JSON.stringify({
          token: "token",
          reason: "logout",
          revokedBy: "spoofed-user",
        }),
        headers: {
          "content-type": "application/json",
          ...(await authHeaders(0)),
        },
      }),
      createEnv() as never,
    );
    const userResponse = await routes.fetch(
      new Request("https://api.test/auth/revoke-user", {
        method: "POST",
        body: JSON.stringify({
          userId: "user-1",
          reason: "admin_action",
          revokedBy: "spoofed-admin",
        }),
        headers: {
          "content-type": "application/json",
          ...(await authHeaders(0)),
        },
      }),
      createEnv() as never,
    );
    const statsResponse = await routes.fetch(
      new Request("https://api.test/auth/blacklist/stats", {
        headers: await authHeaders(0),
      }),
      createEnv() as never,
    );

    expect(revokeResponse.status).toBe(200);
    expect(userResponse.status).toBe(200);
    expect(statsResponse.status).toBe(200);
    await expect(userResponse.json()).resolves.toMatchObject({
      success: true,
      data: { userId: "user-1", revokedCount: 3 },
    });
    await expect(statsResponse.json()).resolves.toMatchObject({
      success: true,
      data: { available: true, estimatedCount: 7 },
    });
    expect(serviceMethods.revokeToken).toHaveBeenCalledWith(
      "token",
      "logout",
      adminUserId,
    );
    expect(serviceMethods.revokeUserTokens).toHaveBeenCalledWith(
      "user-1",
      "admin_action",
      adminUserId,
    );
  });

  it("blocks non-admin realtime token revocation and blacklist stats", async () => {
    const revokeResponse = await withSilencedRouteError(async () =>
      routes.fetch(
        new Request("https://api.test/auth/revoke", {
          method: "POST",
          body: JSON.stringify({ token: "token", reason: "manual" }),
          headers: {
            "content-type": "application/json",
            ...(await authHeaders(1)),
          },
        }),
        createEnv({ userRole: 1 }) as never,
      ),
    );
    const statsResponse = await withSilencedRouteError(async () =>
      routes.fetch(
        new Request("https://api.test/auth/blacklist/stats", {
          headers: await authHeaders(1),
        }),
        createEnv({ userRole: 1 }) as never,
      ),
    );

    expect(revokeResponse.status).toBe(500);
    expect(statsResponse.status).toBe(500);
    expect(serviceMethods.revokeToken).not.toHaveBeenCalled();
    expect(serviceMethods.getBlacklistStats).not.toHaveBeenCalled();
  });

  it("returns route errors when revocation service operations fail", async () => {
    serviceMethods.revokeToken.mockResolvedValue({
      success: false,
      error: "blacklist unavailable",
    });
    const revokeResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/auth/revoke", { token: "token", reason: "manual" }),
        createEnv() as never,
      ),
    );
    expect(revokeResponse.status).toBe(500);

    serviceMethods.revokeUserTokens.mockResolvedValue({
      success: false,
      error: "blacklist unavailable",
    });
    const userResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/auth/revoke-user", { userId: "user-1" }),
        createEnv() as never,
      ),
    );
    expect(userResponse.status).toBe(500);
  });

  it("reads room stats through the realtime Durable Object binding", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const env = createEnv({
      userRole: 1,
      restaurantId: "restaurant-1",
      durableFetch: async (request) => {
        expect(request.url).toBe("https://realtime-internal/stats");
        expect(request.method).toBe("GET");
        return jsonResponse({ connectionCount: 4 });
      },
    });

    const response = await routes.fetch(
      new Request("https://api.test/stats/kitchen/restaurant-1", {
        headers: await authHeaders(1, "restaurant-1"),
      }),
      env as never,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { connectionCount: 4 },
    });
    expect(env.REALTIME_SESSION.idFromName).toHaveBeenCalledWith(
      "kitchen:restaurant-1",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const invalidResponse = await withSilencedRouteError(async () =>
      routes.fetch(
        new Request("https://api.test/stats/unknown/restaurant-1", {
          headers: await authHeaders(1, "restaurant-1"),
        }),
        createEnv({ userRole: 1, restaurantId: "restaurant-1" }) as never,
      ),
    );
    expect(invalidResponse.status).toBe(500);

    const failingEnv = createEnv({
      durableFetch: async () => new Response("down", { status: 503 }),
    });
    const failedResponse = await withSilencedRouteError(async () =>
      routes.fetch(
        new Request("https://api.test/stats/admin/restaurant-1", {
          headers: await authHeaders(0),
        }),
        failingEnv as never,
      ),
    );
    expect(failedResponse.status).toBe(500);
  });

  it("blocks cross-restaurant realtime room stats", async () => {
    const env = createEnv({ userRole: 1, restaurantId: "restaurant-1" });

    const response = await withSilencedRouteError(async () =>
      routes.fetch(
        new Request("https://api.test/stats/kitchen/restaurant-2", {
          headers: await authHeaders(1, "restaurant-1"),
        }),
        env as never,
      ),
    );

    expect(response.status).toBe(500);
    expect(env.REALTIME_SESSION.idFromName).not.toHaveBeenCalled();
  });

  it("aggregates overview stats across realtime room types", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const env = createEnv({
      userRole: 1,
      restaurantId: "restaurant-1",
      durableFetch: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ connectionCount: 2 }))
        .mockResolvedValueOnce(new Response("inactive", { status: 503 }))
        .mockRejectedValueOnce(new Error("network")),
    });

    const response = await routes.fetch(
      new Request("https://api.test/stats/overview?restaurantId=restaurant-1", {
        headers: await authHeaders(1, "restaurant-1"),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const body = await response.json<StatsOverviewBody>();
    expect(body).toMatchObject({
      success: true,
      data: {
        restaurantId: "restaurant-1",
        totalConnections: 2,
        health: { status: "healthy" },
      },
    });
    expect(body.data.roomStats).toEqual([
      { roomType: "kitchen", connectionCount: 2, status: "active" },
      { roomType: "admin", connectionCount: 0, status: "inactive" },
      { roomType: "customer", connectionCount: 0, status: "error" },
    ]);
    expect(env.REALTIME_SESSION.idFromName).toHaveBeenCalledWith(
      "kitchen:restaurant-1",
    );
    expect(env.REALTIME_SESSION.idFromName).toHaveBeenCalledWith(
      "admin:restaurant-1",
    );
    expect(env.REALTIME_SESSION.idFromName).toHaveBeenCalledWith(
      "customer:restaurant-1",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const missingResponse = await withSilencedRouteError(async () =>
      routes.fetch(
        new Request("https://api.test/stats/overview", {
          headers: await authHeaders(1, "restaurant-1"),
        }),
        createEnv({ userRole: 1, restaurantId: "restaurant-1" }) as never,
      ),
    );
    expect(missingResponse.status).toBe(500);
  });

  it("reports realtime health for up, down, and unreachable service states", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ version: "1.0.0" }), {
        status: 200,
      }),
    );
    const healthyResponse = await routes.fetch(
      new Request("https://api.test/health"),
      createEnv() as never,
    );
    expect(healthyResponse.status).toBe(200);
    await expect(healthyResponse.json()).resolves.toMatchObject({
      success: true,
      data: { status: "healthy", realtimeService: "up", version: "1.0.0" },
    });

    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    const downResponse = await routes.fetch(
      new Request("https://api.test/health"),
      createEnv() as never,
    );
    expect(downResponse.status).toBe(200);
    await expect(downResponse.json()).resolves.toMatchObject({
      success: false,
      data: { status: "unhealthy", realtimeService: "down" },
    });

    fetchMock.mockRejectedValueOnce(new Error("network"));
    const degradedResponse = await routes.fetch(
      new Request("https://api.test/health"),
      createEnv() as never,
    );
    expect(degradedResponse.status).toBe(200);
    await expect(degradedResponse.json()).resolves.toMatchObject({
      success: true,
      data: { status: "degraded", realtimeService: "unreachable" },
    });
  });
});
