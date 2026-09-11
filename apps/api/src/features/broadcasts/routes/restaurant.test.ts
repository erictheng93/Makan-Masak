import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

const serviceMocks = vi.hoisted(() => ({
  send: vi.fn(),
  listHistory: vi.fn(),
}));

const authState = vi.hoisted((): { user: AuthUser | null } => ({ user: null }));

/**
 * Only `authMiddleware` is stubbed, and only to skip JWT verification and its
 * D1 user lookup. `requireRole` stays real: a passthrough stub would swallow
 * the role gate, and the same stub is what makes a tenancy guard look covered
 * while never running — which is why `assertRestaurantScope` is called from
 * inside the handler rather than mounted.
 */
vi.mock("../../../middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../middleware/auth")>();
  return {
    ...actual,
    authMiddleware: vi.fn(async (c, next) => {
      if (authState.user) c.set("user", authState.user);
      await next();
    }),
  };
});

vi.mock("../services/BroadcastService", () => ({
  BroadcastService: function BroadcastService() {
    return serviceMocks;
  },
}));

import routes from "./restaurant";

// Same shape as the app-factory handler, minus sanitisation: without it Hono
// flattens every thrown ApiError to a bare 500 and "403 FORBIDDEN" becomes
// indistinguishable from "blew up".
routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      {
        success: false,
        error: { code: err.code, message: err.message, details: err.details },
      },
      err.status as ContentfulStatusCode,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

const OWNER: AuthUser = {
  id: "user-owner",
  username: "owner",
  role: 1,
  restaurantId: "restaurant-1",
};
const OTHER_OWNER: AuthUser = {
  id: "user-other",
  username: "other",
  role: 1,
  restaurantId: "restaurant-2",
};
const ADMIN: AuthUser = {
  id: "user-admin",
  username: "admin",
  role: 0,
  restaurantId: undefined,
};
const CHEF: AuthUser = {
  id: "user-chef",
  username: "chef",
  role: 2,
  restaurantId: "restaurant-1",
};

function createEnv(overrides: Partial<Env> = {}): Env {
  return { DB: {} as D1Database, ...overrides } as Env;
}

function call(
  path: string,
  options: { method?: string; body?: unknown; env?: Env } = {},
) {
  return routes.fetch(
    new Request(`https://api.test${path}`, {
      method: options.method ?? "GET",
      headers: { "content-type": "application/json" },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    options.env ?? createEnv(),
  );
}

async function readJson(res: Response) {
  return (await res.json()) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string; details?: unknown };
  };
}

const SEND_RESULT = {
  id: "broadcast-1",
  audienceCount: 12,
  deliveredCount: 9,
  failedCount: 1,
  skippedCount: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = OWNER;
  serviceMocks.send.mockResolvedValue(SEND_RESULT);
  serviceMocks.listHistory.mockResolvedValue({
    broadcasts: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
});

describe("POST /:id/broadcasts", () => {
  it("sends for the owner's own restaurant and answers 201 with the counts", async () => {
    const res = await call("/restaurant-1/broadcasts", {
      method: "POST",
      body: { title: "今晚半價", body: "全品項半價至 22:00", url: "/r/1" },
    });

    expect(res.status).toBe(201);
    expect(await readJson(res)).toEqual({ success: true, data: SEND_RESULT });
    expect(serviceMocks.send).toHaveBeenCalledOnce();
    expect(serviceMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "restaurant",
        scopeId: "restaurant-1",
        sentBy: "user-owner",
        title: "今晚半價",
        body: "全品項半價至 22:00",
        url: "/r/1",
        includeMarketFollowers: false,
      }),
    );
  });

  it("passes includeMarketFollowers through when asked", async () => {
    await call("/restaurant-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b", includeMarketFollowers: true },
    });

    expect(serviceMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ includeMarketFollowers: true }),
    );
  });

  it("lets an admin send for any restaurant", async () => {
    authState.user = ADMIN;
    const res = await call("/restaurant-9/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
    });

    expect(res.status).toBe(201);
    expect(serviceMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: "restaurant-9",
        sentBy: "user-admin",
      }),
    );
  });

  it("refuses an owner sending for somebody else's restaurant", async () => {
    authState.user = OTHER_OWNER;
    const res = await call("/restaurant-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
    });

    expect(res.status).toBe(403);
    expect((await readJson(res)).error?.code).toBe("FORBIDDEN");
    expect(serviceMocks.send).not.toHaveBeenCalled();
  });

  it("refuses a kitchen role outright", async () => {
    authState.user = CHEF;
    const res = await call("/restaurant-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
    });

    expect(res.status).toBe(403);
    expect((await readJson(res)).error?.code).toBe("INSUFFICIENT_ROLE");
    expect(serviceMocks.send).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request", async () => {
    authState.user = null;
    const res = await call("/restaurant-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
    });

    expect(res.status).toBe(401);
    expect(serviceMocks.send).not.toHaveBeenCalled();
  });

  it("scopes an independent deployment to its own tenant", async () => {
    authState.user = ADMIN;
    const env = createEnv({
      DEPLOYMENT_MODE: "independent",
      TENANT_ID: "restaurant-1",
    } as Partial<Env>);

    const allowed = await call("/restaurant-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
      env,
    });
    expect(allowed.status).toBe(201);

    const refused = await call("/restaurant-2/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
      env,
    });
    expect(refused.status).toBe(403);

    const unconfigured = await call("/restaurant-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
      env: createEnv({ DEPLOYMENT_MODE: "independent" } as Partial<Env>),
    });
    expect(unconfigured.status).toBe(403);
  });

  it.each([
    ["an empty title", { title: "   ", body: "b" }],
    ["a title over 80 characters", { title: "x".repeat(81), body: "b" }],
    ["a body over 300 characters", { title: "t", body: "x".repeat(301) }],
    ["a missing body", { title: "t" }],
    [
      "a javascript: url",
      { title: "t", body: "b", url: "javascript:alert(1)" },
    ],
    ["an http url", { title: "t", body: "b", url: "http://example.com" }],
  ])("rejects %s", async (_label, body) => {
    const res = await call("/restaurant-1/broadcasts", {
      method: "POST",
      body,
    });

    expect(res.status).toBe(400);
    expect(serviceMocks.send).not.toHaveBeenCalled();
  });

  it("surfaces the rate limit as a 429 carrying retryAfterMs", async () => {
    serviceMocks.send.mockRejectedValue(
      new ApiError("BROADCAST_RATE_LIMITED", "Too many", 429, {
        limit: 3,
        windowMs: 86_400_000,
        retryAfterMs: 3_600_000,
      }),
    );

    const res = await call("/restaurant-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
    });

    expect(res.status).toBe(429);
    const payload = await readJson(res);
    expect(payload.error?.code).toBe("BROADCAST_RATE_LIMITED");
    expect(payload.error?.details).toEqual({
      limit: 3,
      windowMs: 86_400_000,
      retryAfterMs: 3_600_000,
    });
  });
});

describe("GET /:id/broadcasts", () => {
  it("returns the history with default paging", async () => {
    const res = await call("/restaurant-1/broadcasts");

    expect(res.status).toBe(200);
    expect(serviceMocks.listHistory).toHaveBeenCalledWith(
      "restaurant",
      "restaurant-1",
      1,
      20,
    );
    expect((await readJson(res)).data).toEqual(
      expect.objectContaining({ broadcasts: [] }),
    );
  });

  it("passes page and limit through", async () => {
    await call("/restaurant-1/broadcasts?page=3&limit=5");
    expect(serviceMocks.listHistory).toHaveBeenCalledWith(
      "restaurant",
      "restaurant-1",
      3,
      5,
    );
  });

  it("rejects a limit past the ceiling", async () => {
    const res = await call("/restaurant-1/broadcasts?limit=500");
    expect(res.status).toBe(400);
    expect(serviceMocks.listHistory).not.toHaveBeenCalled();
  });

  it("applies the same tenancy guard as the send", async () => {
    authState.user = OTHER_OWNER;
    const res = await call("/restaurant-1/broadcasts");
    expect(res.status).toBe(403);
    expect(serviceMocks.listHistory).not.toHaveBeenCalled();
  });
});
