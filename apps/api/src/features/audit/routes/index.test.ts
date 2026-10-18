import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";

const mocks = vi.hoisted(() => {
  // Admins have no restaurant scope, so restaurantId is optional here just as
  // it is on the production AuthUser type.
  const user: AuthUser = {
    id: "user-42",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  };
  return { user };
});

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", mocks.user);
    await next();
  }),
}));

import routes from "./index";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }

  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function createDb(lastRowId: number | string = 123) {
  const run = vi.fn(async () => ({ meta: { last_row_id: lastRowId } }));
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));

  return {
    prepare,
    bind,
    run,
  };
}

function request(path: string, init: RequestInit = {}, db = createDb()) {
  return routes.request(path, init, { DB: db } as never);
}

function postJson(path: string, body: unknown, db = createDb()) {
  return request(
    path,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
        "user-agent": "MakanOffline/1.0",
      },
    },
    db,
  );
}

async function json(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data?: unknown;
    error?: { code?: string; message?: string; details?: unknown };
  };
}

describe("audit routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.user = {
      id: "user-42",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
  });

  it("syncs offline audit actions into audit_logs with request metadata", async () => {
    const db = createDb("456");
    const payload = {
      action_type: "ORDER_STATUS_UPDATED",
      target_id: 987,
      data: { from: "pending", to: "ready" },
      user_id: "offline-user-1",
      timestamp: "2026-06-07T09:10:11.000Z",
    };

    const response = await postJson("/actions", payload, db);
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
    );
    expect(db.bind).toHaveBeenCalledWith(
      "user-42",
      "restaurant-1",
      "ORDER_STATUS_UPDATED",
      "orders",
      "987",
      "Offline ORDER_STATUS_UPDATED on orders#987",
      JSON.stringify({
        metadata: {
          offline: true,
          payload: { from: "pending", to: "ready" },
          requestedUserId: "offline-user-1",
          requestedTimestamp: "2026-06-07T09:10:11.000Z",
        },
      }),
      "203.0.113.7",
      "MakanOffline/1.0",
      1,
      expect.any(Number),
    );
    // Client timestamp must not backdate created_at_ms.
    const stored = Number(db.bind.mock.calls[0].at(-1));
    expect(Math.abs(stored - Date.now())).toBeLessThan(5_000);
    expect(body).toEqual({
      success: true,
      data: {
        auditLogId: 456,
        synced: true,
        action: "ORDER_STATUS_UPDATED",
        resource: "orders",
        resourceId: "987",
        restaurantId: "restaurant-1",
      },
    });
  });

  it("uses x-forwarded-for and a generated timestamp for invalid timestamps", async () => {
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
    const db = createDb(0);

    const response = await request(
      "/actions",
      {
        method: "POST",
        body: JSON.stringify({
          action_type: "MENU_ITEM_CREATED",
          data: { name: "Laksa" },
          timestamp: "not-a-date",
        }),
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "198.51.100.4",
        },
      },
      db,
    );
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(db.bind).toHaveBeenCalledWith(
      "user-42",
      "restaurant-1",
      "MENU_ITEM_CREATED",
      "menu_items",
      null,
      "Offline MENU_ITEM_CREATED on menu_items",
      JSON.stringify({
        metadata: {
          offline: true,
          payload: { name: "Laksa" },
          requestedUserId: null,
          requestedTimestamp: "not-a-date",
        },
      }),
      "198.51.100.4",
      null,
      1,
      Date.parse("2026-06-07T12:00:00.000Z"),
    );
    expect(body).toMatchObject({
      success: true,
      data: {
        auditLogId: null,
        resource: "menu_items",
        resourceId: null,
      },
    });
  });

  it("allows admins to sync global settings actions", async () => {
    vi.setSystemTime(new Date("2026-06-07T13:00:00.000Z"));
    mocks.user = {
      id: "user-1",
      username: "admin",
      role: 0,
      restaurantId: undefined,
    };
    const db = createDb(321);

    const response = await postJson(
      "/actions",
      {
        action_type: "SETTING_CHANGED",
      },
      db,
    );
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(db.bind).toHaveBeenCalledWith(
      "user-1",
      null,
      "SETTING_CHANGED",
      "settings",
      null,
      "Offline SETTING_CHANGED on settings",
      JSON.stringify({
        metadata: {
          offline: true,
          payload: {},
          requestedUserId: null,
          requestedTimestamp: null,
        },
      }),
      "203.0.113.7",
      "MakanOffline/1.0",
      1,
      Date.parse("2026-06-07T13:00:00.000Z"),
    );
    expect(body).toMatchObject({
      success: true,
      data: {
        auditLogId: 321,
        restaurantId: null,
        resource: "settings",
      },
    });
  });

  it("prevents owners from syncing audit actions for another restaurant", async () => {
    const db = createDb();

    const response = await postJson(
      "/actions",
      {
        action_type: "BACKUP_RESTORED",
        restaurant_id: "restaurant-2",
      },
      db,
    );
    const body = await json(response);

    expect(response.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: {
        code: "AUDIT_ACTION_FORBIDDEN",
        message: "Cannot sync audit actions for another restaurant",
      },
    });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("rejects invalid audit action payloads before writing", async () => {
    const db = createDb();

    const response = await postJson(
      "/actions",
      {
        action_type: "",
      },
      db,
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(db.prepare).not.toHaveBeenCalled();
  });
});
