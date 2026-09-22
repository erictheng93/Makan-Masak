import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verify } from "hono/jwt";
import routes from "./index";

const mocks = vi.hoisted(() => {
  // `restaurantId` is optional on the real principal — several cases below
  // reassign it to `undefined` to exercise the "no restaurant context" paths,
  // so the fixture has to be declared with that widened shape up front.
  const currentUser: {
    id: string;
    role: number;
    restaurantId: string | undefined;
  } = { id: "user-22", role: 2, restaurantId: "restaurant-1" };
  return {
    currentUser,
    validateChefAccess: vi.fn(),
    getKitchenOrders: vi.fn(),
    updateOrderItemStatus: vi.fn(),
    resolveOrderIdentity: vi.fn(),
  };
});

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", mocks.currentUser);
    await next();
  }),
  sseAuthMiddleware: vi.fn(async (c, next) => {
    c.set("user", mocks.currentUser);
    await next();
  }),
}));

const gateMocks = vi.hoisted(() => ({
  // The real `moduleGate(module, resolveGuestRestaurantId?)` takes the module
  // key as its first argument; the mock has to declare it too, otherwise the
  // recorded `mock.calls` entries are typed as empty tuples and
  // `moduleGateRegistrationKeys` below cannot read index 0.
  moduleGate: vi.fn(
    (_module: string, _resolveGuestRestaurantId?: unknown) =>
      async (_c: unknown, next: () => Promise<void>) => {
        await next();
      },
  ),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: gateMocks.moduleGate,
}));

// moduleGate(...) is called once per route at registration (module import
// time), not per-request — capture the keys now, before the first
// vi.clearAllMocks() in beforeEach wipes the call history.
const moduleGateRegistrationKeys = gateMocks.moduleGate.mock.calls.map(
  (call) => call[0],
);

vi.mock("../services/KitchenService", () => ({
  KitchenService: vi.fn(function KitchenService() {
    return {
      validateChefAccess: mocks.validateChefAccess,
      getKitchenOrders: mocks.getKitchenOrders,
      updateOrderItemStatus: mocks.updateOrderItemStatus,
    };
  }),
}));

vi.mock("../../../shared/services/order-identity", () => ({
  resolveOrderIdentity: vi.fn((...args: unknown[]) =>
    mocks.resolveOrderIdentity(...args),
  ),
}));

function createEnv() {
  const store = new Map<string, string>();
  return {
    JWT_SECRET: "test-jwt-secret-for-kitchen-routes-32",
    DB: { binding: "db" },
    CACHE_KV: {
      get: vi.fn(async (key: string, type?: string) => {
        const value = store.get(key) ?? null;
        return type === "json" && value ? JSON.parse(value) : value;
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
  };
}

function jsonRequest(path: string, method: string, body: unknown) {
  return new Request(`https://kitchen.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectIsolatedRouteError(
  action: () => Response | Promise<Response>,
) {
  const response = await action();
  expect(response.status).toBe(500);
  await expect(response.text()).resolves.toBe("Internal Server Error");
}

describe("kitchen routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    mocks.currentUser = {
      id: "user-22",
      role: 2,
      restaurantId: "restaurant-1",
    };
    mocks.validateChefAccess.mockReturnValue(true);
    mocks.getKitchenOrders.mockResolvedValue({
      pending: [{ id: 1, orderNumber: "A001" }],
      preparing: [],
      ready: [],
      stats: { pendingCount: 1 },
    });
    mocks.updateOrderItemStatus.mockResolvedValue({
      orderId: 44,
      itemId: 9,
      status: "ready",
      orderStatus: "ready",
      updatedAt: "2026-06-07T00:00:00.000Z",
    });
    mocks.resolveOrderIdentity.mockResolvedValue({
      id: 44,
      publicId: "018f0000-0000-7000-8000-000000000044",
      orderNumber: "ORD-44",
      restaurantId: "restaurant-1",
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.warn).mockRestore();
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
    vi.useRealTimers();
  });

  it("gets empty notification settings and persists user scoped settings", async () => {
    const env = createEnv();
    const emptyResponse = await routes.fetch(
      new Request("https://kitchen.test/notification-settings"),
      env as never,
    );

    expect(emptyResponse.status).toBe(200);
    await expect(emptyResponse.json()).resolves.toEqual({
      success: true,
      data: {},
    });
    expect(env.CACHE_KV.get).toHaveBeenCalledWith(
      "kitchen:notification-settings:restaurant-1:user-22",
      "json",
    );

    const updateResponse = await routes.fetch(
      jsonRequest("/notification-settings", "PUT", {
        sound: true,
        volume: 80,
      }),
      env as never,
    );

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        settings: { sound: true, volume: 80 },
        updatedAt: "2026-06-07T00:00:00.000Z",
      },
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "kitchen:notification-settings:restaurant-1:user-22",
      JSON.stringify({
        userId: "user-22",
        restaurantId: "restaurant-1",
        settings: { sound: true, volume: 80 },
        updatedAt: "2026-06-07T00:00:00.000Z",
      }),
    );

    const storedResponse = await routes.fetch(
      new Request("https://kitchen.test/notification-settings"),
      env as never,
    );
    await expect(storedResponse.json()).resolves.toEqual({
      success: true,
      data: { sound: true, volume: 80 },
    });

    // Notification-settings (GET then PUT) are the first two routes
    // registered in this file and must carry the same kitchen_display gate
    // as the other 6 kitchen routes (see module-gate.test.ts for the real,
    // unmocked-gate proof of denial/allow behavior). Checking by position
    // (not just "at least N total") ensures this fails if either specific
    // route's gate is ever dropped, since the other 6 routes already
    // contribute 6 more "kitchen_display" entries regardless.
    expect(moduleGateRegistrationKeys.slice(0, 2)).toEqual([
      "kitchen_display",
      "kitchen_display",
    ]);
  });

  it("uses a global notification settings key when the user has no restaurant", async () => {
    mocks.currentUser = { id: "user-22", role: 0, restaurantId: undefined };
    const env = createEnv();

    const response = await routes.fetch(
      jsonRequest("/notification-settings", "PUT", { tickets: "muted" }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "kitchen:notification-settings:global:user-22",
      expect.stringContaining('"restaurantId":null'),
    );
  });

  it("lists kitchen orders after chef and restaurant access checks", async () => {
    const response = await routes.fetch(
      new Request("https://kitchen.test/restaurant-1/orders"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        pending: [{ id: 1, orderNumber: "A001" }],
        stats: { pendingCount: 1 },
      },
      message: "Kitchen orders retrieved successfully",
    });
    expect(mocks.validateChefAccess).toHaveBeenCalledWith(
      "user-22",
      2,
      "restaurant-1",
    );
    expect(mocks.getKitchenOrders).toHaveBeenCalledWith(
      "restaurant-1",
      "user-22",
      100,
    );
  });

  it("passes an explicit kitchen order limit from the query string", async () => {
    const response = await routes.fetch(
      new Request("https://kitchen.test/restaurant-1/orders?limit=250"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.getKitchenOrders).toHaveBeenCalledWith(
      "restaurant-1",
      "user-22",
      250,
    );
  });

  it("issues short-lived scoped tokens for kitchen SSE connections", async () => {
    const env = createEnv();
    const response = await routes.fetch(
      new Request("https://kitchen.test/restaurant-1/events/token", {
        method: "POST",
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { sseToken: string; expiresIn: number };
    };

    expect(body.data.expiresIn).toBe(60);
    const payload = await verify(body.data.sseToken, env.JWT_SECRET, "HS256");
    expect(payload).toMatchObject({
      id: "user-22",
      role: 2,
      restaurantId: "restaurant-1",
      purpose: "kitchen_sse",
      aud: "kitchen_sse",
    });
    const issuedAt = payload.iat;
    expect(issuedAt).toEqual(expect.any(Number));
    expect(payload.exp).toBe((issuedAt ?? 0) + 60);
    expect(mocks.validateChefAccess).toHaveBeenCalledWith(
      "user-22",
      2,
      "restaurant-1",
    );
  });

  it("updates an order item through the canonical route", async () => {
    const response = await routes.fetch(
      jsonRequest("/restaurant-1/orders/44/items/9", "PUT", {
        status: "ready",
        notes: "plate now",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        orderId: 44,
        orderPublicId: "018f0000-0000-7000-8000-000000000044",
        itemId: 9,
        status: "ready",
        orderStatus: "ready",
      },
      message: "Order item status updated successfully",
    });
    expect(mocks.updateOrderItemStatus).toHaveBeenCalledWith(
      "restaurant-1",
      44,
      9,
      { status: "ready", notes: "plate now" },
      "user-22",
    );
    expect(mocks.resolveOrderIdentity).toHaveBeenCalledWith(
      { binding: "db" },
      "44",
      { restaurantId: "restaurant-1" },
    );
  });

  it("updates an order item through the canonical route with a public order id", async () => {
    const response = await routes.fetch(
      jsonRequest(
        "/restaurant-1/orders/018f0000-0000-7000-8000-000000000044/items/9",
        "PUT",
        {
          status: "ready",
        },
      ),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveOrderIdentity).toHaveBeenCalledWith(
      { binding: "db" },
      "018f0000-0000-7000-8000-000000000044",
      { restaurantId: "restaurant-1" },
    );
    expect(mocks.updateOrderItemStatus).toHaveBeenCalledWith(
      "restaurant-1",
      44,
      9,
      { status: "ready", notes: "" },
      "user-22",
    );
  });

  it("rejects invalid canonical item status bodies before service calls", async () => {
    await expectIsolatedRouteError(() =>
      routes.fetch(
        jsonRequest("/restaurant-1/orders/44/items/9", "PUT", {
          status: "anything",
        }),
        createEnv() as never,
      ),
    );

    expect(mocks.updateOrderItemStatus).not.toHaveBeenCalled();
  });

  it("maps legacy start and ready routes to status updates with notes", async () => {
    mocks.updateOrderItemStatus
      .mockResolvedValueOnce({
        orderId: 44,
        itemId: 9,
        status: "preparing",
        updatedAt: "2026-06-07T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        orderId: 44,
        itemId: 9,
        status: "ready",
        updatedAt: "2026-06-07T00:00:00.000Z",
      });

    const startResponse = await routes.fetch(
      jsonRequest("/44/items/9/start", "POST", { data: { notes: "fire" } }),
      createEnv() as never,
    );
    const readyResponse = await routes.fetch(
      jsonRequest("/44/items/9/ready", "POST", { notes: "window" }),
      createEnv() as never,
    );

    expect(startResponse.status).toBe(200);
    expect(readyResponse.status).toBe(200);
    expect(mocks.updateOrderItemStatus).toHaveBeenNthCalledWith(
      1,
      "restaurant-1",
      44,
      9,
      { status: "preparing", notes: "fire" },
      "user-22",
    );
    expect(mocks.updateOrderItemStatus).toHaveBeenNthCalledWith(
      2,
      "restaurant-1",
      44,
      9,
      { status: "ready", notes: "window" },
      "user-22",
    );
    expect(console.warn).toHaveBeenCalledWith(
      "[deprecated-route] kitchen legacy item status hit",
      expect.objectContaining({
        canonical:
          "PUT /api/v1/kitchen/:restaurantId/orders/:orderId/items/:itemId",
      }),
    );
  });

  it("rejects malformed legacy route parameters before service calls", async () => {
    await expectIsolatedRouteError(() =>
      routes.fetch(
        jsonRequest("/44/items/bad/start", "POST", {}),
        createEnv() as never,
      ),
    );

    expect(mocks.updateOrderItemStatus).not.toHaveBeenCalled();
  });

  it("rejects kitchen route access when chef role or restaurant checks fail", async () => {
    mocks.validateChefAccess.mockReturnValueOnce(false);
    await expectIsolatedRouteError(() =>
      routes.fetch(
        new Request("https://kitchen.test/restaurant-1/orders"),
        createEnv() as never,
      ),
    );

    mocks.currentUser = {
      id: "user-22",
      role: 2,
      restaurantId: "restaurant-2",
    };
    mocks.validateChefAccess.mockReturnValueOnce(true);
    await expectIsolatedRouteError(() =>
      routes.fetch(
        jsonRequest("/restaurant-1/orders/44/items/9", "PUT", {
          status: "ready",
        }),
        createEnv() as never,
      ),
    );
  });

  it("rejects legacy updates when restaurant context or chef access is missing", async () => {
    mocks.currentUser = { id: "user-22", role: 2, restaurantId: undefined };
    await expectIsolatedRouteError(() =>
      routes.fetch(
        jsonRequest("/44/items/9/start", "POST", {}),
        createEnv() as never,
      ),
    );

    mocks.currentUser = {
      id: "user-22",
      role: 4,
      restaurantId: "restaurant-1",
    };
    mocks.validateChefAccess.mockReturnValueOnce(false);
    await expectIsolatedRouteError(() =>
      routes.fetch(
        jsonRequest("/44/items/9/ready", "POST", {}),
        createEnv() as never,
      ),
    );
  });

  it("rejects SSE event access before opening a stream when checks fail", async () => {
    mocks.validateChefAccess.mockReturnValueOnce(false);
    await expectIsolatedRouteError(() =>
      routes.fetch(
        new Request("https://kitchen.test/restaurant-1/events"),
        createEnv() as never,
      ),
    );

    mocks.currentUser = {
      id: "user-22",
      role: 2,
      restaurantId: "restaurant-2",
    };
    mocks.validateChefAccess.mockReturnValueOnce(true);
    await expectIsolatedRouteError(() =>
      routes.fetch(
        new Request("https://kitchen.test/restaurant-1/events"),
        createEnv() as never,
      ),
    );
  });
});
