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

import routes from "./market";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as ContentfulStatusCode,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

const ADMIN: AuthUser = {
  id: "user-admin",
  username: "admin",
  role: 0,
  restaurantId: undefined,
};
const OWNER: AuthUser = {
  id: "user-owner",
  username: "owner",
  role: 1,
  restaurantId: "restaurant-1",
};

function call(path: string, options: { method?: string; body?: unknown } = {}) {
  return routes.fetch(
    new Request(`https://api.test${path}`, {
      method: options.method ?? "GET",
      headers: { "content-type": "application/json" },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { DB: {} as D1Database } as Env,
  );
}

async function readJson(res: Response) {
  return (await res.json()) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string };
  };
}

const SEND_RESULT = {
  id: "broadcast-9",
  audienceCount: 40,
  deliveredCount: 38,
  failedCount: 1,
  skippedCount: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = ADMIN;
  serviceMocks.send.mockResolvedValue(SEND_RESULT);
  serviceMocks.listHistory.mockResolvedValue({
    broadcasts: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
});

describe("POST /:id/broadcasts", () => {
  it("lets a platform admin announce to a market", async () => {
    const res = await call("/market-1/broadcasts", {
      method: "POST",
      body: { title: "颱風休市", body: "本週六暫停營業" },
    });

    expect(res.status).toBe(201);
    expect(await readJson(res)).toEqual({ success: true, data: SEND_RESULT });
    expect(serviceMocks.send).toHaveBeenCalledOnce();
    expect(serviceMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "market",
        scopeId: "market-1",
        sentBy: "user-admin",
        title: "颱風休市",
      }),
    );
  });

  it("never fans in to vendor followers, even if asked", async () => {
    await call("/market-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b", includeMarketFollowers: true },
    });

    // Markets have no market to fan in from; the flag is a restaurant-scope
    // concept and the route must not forward it.
    expect(serviceMocks.send).toHaveBeenCalledWith(
      expect.not.objectContaining({ includeMarketFollowers: true }),
    );
  });

  it("refuses a shop owner: markets are platform-managed", async () => {
    authState.user = OWNER;
    const res = await call("/market-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
    });

    expect(res.status).toBe(403);
    expect((await readJson(res)).error?.code).toBe("INSUFFICIENT_ROLE");
    expect(serviceMocks.send).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request", async () => {
    authState.user = null;
    const res = await call("/market-1/broadcasts", {
      method: "POST",
      body: { title: "t", body: "b" },
    });

    expect(res.status).toBe(401);
    expect(serviceMocks.send).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    const res = await call("/market-1/broadcasts", {
      method: "POST",
      body: { title: "", body: "b" },
    });
    expect(res.status).toBe(400);
    expect(serviceMocks.send).not.toHaveBeenCalled();
  });
});

describe("GET /:id/broadcasts", () => {
  it("returns the history for role 0", async () => {
    const res = await call("/market-1/broadcasts?page=2&limit=5");
    expect(res.status).toBe(200);
    expect(serviceMocks.listHistory).toHaveBeenCalledWith(
      "market",
      "market-1",
      2,
      5,
    );
  });

  it("refuses a shop owner", async () => {
    authState.user = OWNER;
    const res = await call("/market-1/broadcasts");
    expect(res.status).toBe(403);
    expect(serviceMocks.listHistory).not.toHaveBeenCalled();
  });
});
