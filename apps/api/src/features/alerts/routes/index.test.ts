import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";

const mocks = vi.hoisted(() => ({
  currentUser: {
    id: "user-10",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  } as AuthUser,
  listOpen: vi.fn(),
  resolve: vi.fn(),
  escalate: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", mocks.currentUser);
    await next();
  }),
  requireRole: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock("@makanmasak/database", () => ({
  RestaurantAlertService: vi.fn(function RestaurantAlertService() {
    return {
      listOpen: mocks.listOpen,
      resolve: mocks.resolve,
      escalate: mocks.escalate,
    };
  }),
}));

import routes from "./index";

// The validation middleware throws ApiError; turning that into a status is
// app-factory's job. Mirror its mapping so these tests assert the status a
// client actually receives.
routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  throw err;
});

const ALERT_ID = "0198c3a4-5b6c-7d8e-9f01-234567890abc";
const OTHER_ID = "0198c3a4-5b6c-7d8e-9f01-234567890def";

function createEnv() {
  return { DB: {}, CACHE_KV: { put: vi.fn() } };
}

function alert(overrides: Record<string, unknown> = {}) {
  return {
    id: ALERT_ID,
    restaurantId: "restaurant-1",
    alertType: "inventory_depleted",
    severity: "high",
    status: "open",
    title: "Stock out",
    description: "Nasi lemak is out of stock.",
    createdAt: 1757116800000,
    ...overrides,
  };
}

function get(path: string) {
  return routes.fetch(new Request(`https://test${path}`), createEnv() as never);
}

function post(path: string) {
  return routes.fetch(
    new Request(`https://test${path}`, { method: "POST" }),
    createEnv() as never,
  );
}

describe("alerts routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = {
      id: "user-10",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
  });

  it("lists open alerts scoped to the caller's restaurant", async () => {
    mocks.listOpen.mockResolvedValue([alert()]);

    const response = await get("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: ALERT_ID, alertType: "inventory_depleted" }],
    });
    expect(mocks.listOpen).toHaveBeenCalledWith("restaurant-1");
  });

  it("caps the list at the requested limit", async () => {
    mocks.listOpen.mockResolvedValue([
      alert({ id: ALERT_ID }),
      alert({ id: OTHER_ID }),
    ]);

    const response = await get("/?limit=1");
    const body = (await response.json()) as { data: unknown[] };

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
  });

  it("rejects a non-positive limit", async () => {
    const response = await get("/?limit=0");

    expect(response.status).toBe(400);
    expect(mocks.listOpen).not.toHaveBeenCalled();
  });

  it("resolves an alert as the signed-in user", async () => {
    mocks.resolve.mockResolvedValue(alert({ status: "resolved" }));

    const response = await post(`/${ALERT_ID}/resolve`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { status: "resolved" },
    });
    expect(mocks.resolve).toHaveBeenCalledWith(
      ALERT_ID,
      "restaurant-1",
      "user-10",
    );
  });

  it("escalates an alert as the signed-in user", async () => {
    mocks.escalate.mockResolvedValue(alert({ status: "escalated" }));

    const response = await post(`/${ALERT_ID}/escalate`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { status: "escalated" },
    });
    expect(mocks.escalate).toHaveBeenCalledWith(
      ALERT_ID,
      "restaurant-1",
      "user-10",
    );
  });

  // A tenant miss and an already-closed alert are the same 404 on purpose:
  // distinguishing them would confirm an id exists in another restaurant.
  it.each([
    ["resolve", mocks.resolve],
    ["escalate", mocks.escalate],
  ])("answers 404 when %s finds no open alert", async (action, spy) => {
    spy.mockResolvedValue(null);

    const response = await post(`/${ALERT_ID}/${action}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "ALERT_NOT_FOUND" },
    });
  });

  it.each(["resolve", "escalate"])(
    "rejects a non-uuid alert id on %s",
    async (action) => {
      const response = await post(`/not-a-uuid/${action}`);

      expect(response.status).toBe(400);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.escalate).not.toHaveBeenCalled();
    },
  );

  describe("account with no restaurant", () => {
    beforeEach(() => {
      mocks.currentUser = { id: "user-99", username: "admin", role: 0 };
    });

    it.each([
      ["GET", () => get("/")],
      ["resolve", () => post(`/${ALERT_ID}/resolve`)],
      ["escalate", () => post(`/${ALERT_ID}/escalate`)],
    ])("answers 400 on %s", async (_label, call) => {
      const response = await call();

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: { code: "NO_RESTAURANT" },
      });
      expect(mocks.listOpen).not.toHaveBeenCalled();
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.escalate).not.toHaveBeenCalled();
    });
  });
});
