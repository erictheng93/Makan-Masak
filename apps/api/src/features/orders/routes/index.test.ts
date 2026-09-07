import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import routes from "./index";
import { ApiError } from "../../../shared/utils/api-error";

const serviceMocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  getOrders: vi.fn(),
  getOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  cancelOrder: vi.fn(),
  bulkUpdateOrders: vi.fn(),
  exportOrders: vi.fn(),
  generateReceipt: vi.fn(),
  getOrderStatistics: vi.fn(),
  getOrderAnalytics: vi.fn(),
  getActiveOrders: vi.fn(),
  previewCoupon: vi.fn(),
  addItemsToOrder: vi.fn(),
  changeOrderItemQuantity: vi.fn(),
  applyOrderDiscount: vi.fn(),
}));
const platformOrderServiceMocks = vi.hoisted(() => ({
  syncStatusToPlatform: vi.fn(),
}));
const gateMocks = vi.hoisted(() => ({
  enforceQuota: vi.fn(),
  quotaGate: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
  meterEmit: vi.fn(),
  moduleGate: vi.fn((moduleKey: string) => {
    const middleware = async (_c: unknown, next: () => Promise<void>) => next();
    // Tagged at registration so a test can prove which route carries which
    // gate. Hono keeps every middleware in the chain as its own app.routes
    // entry, so the tag survives and stays attributable to one route.
    return Object.assign(middleware, { moduleKey });
  }),
  assertShopOrderingEnabled: vi.fn(),
}));
const authState = vi.hoisted(
  (): {
    user: { id: string; role: number; restaurantId: string | null };
    customer: { id: string };
  } => ({
    user: {
      id: "user-42",
      role: 1,
      restaurantId: "restaurant-1",
    },
    customer: { id: "customer-42" },
  }),
);

vi.mock("../../../shared/middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../shared/middleware")>();
  return {
    ...actual,
    customerAuthMiddleware: vi.fn(async (c, next) => {
      c.set("user", authState.user);
      c.set("customer", authState.customer);
      await next();
    }),
    // requireRole is deliberately NOT stubbed. A passthrough stub silently
    // swallows every route's role gate, so a test could never observe a role
    // being rejected. The real implementation only reads c.get("user"), which
    // the auth stub above already sets.
  };
});

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: gateMocks.moduleGate,
}));

vi.mock("../../../middleware/quotaGate", () => ({
  enforceQuota: gateMocks.enforceQuota,
  quotaGate: gateMocks.quotaGate,
}));

vi.mock("../../../shared/utils/meter", () => ({
  meterEmit: gateMocks.meterEmit,
}));

vi.mock("../services/OrdersService", () => ({
  OrdersService: function OrdersService() {
    return serviceMocks;
  },
}));

vi.mock("../../integrations/services/PlatformOrderService", () => ({
  PlatformOrderService: function PlatformOrderService() {
    return platformOrderServiceMocks;
  },
}));

vi.mock("../services/shop-mode-gate", () => ({
  assertShopOrderingEnabled: gateMocks.assertShopOrderingEnabled,
}));

// moduleGate(...) runs once per route at registration (module import time),
// not per-request, so this reads the registered app rather than the mock call
// history — the latter loses its route association and any beforeEach reset
// would clear it anyway.
// Same shape as the app-factory's unified handler, minus sanitisation. Without
// it Hono's default handler flattens every thrown ApiError to a bare 500, which
// makes "rejected with 403 INSUFFICIENT_ROLE" and "blew up" indistinguishable.
// Mirrors the pattern already used in ./module-gate.test.ts.
routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as ContentfulStatusCode,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function moduleGatesFor(method: string, path: string): string[] {
  return routes.routes
    .filter((route) => route.method === method && route.path === path)
    .map((route) => (route.handler as { moduleKey?: string }).moduleKey)
    .filter((key): key is string => key !== undefined);
}

function createEnv() {
  const kv = new Map<string, string>();
  return {
    CACHE_KV: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kv.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        kv.delete(key);
      }),
    },
  };
}

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`https://orders.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

describe("orders routes", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) {
      mock.mockReset();
    }
    platformOrderServiceMocks.syncStatusToPlatform.mockReset();
    gateMocks.enforceQuota.mockReset();
    gateMocks.meterEmit.mockReset();
    gateMocks.assertShopOrderingEnabled.mockReset();
    authState.user = {
      id: "user-42",
      role: 1,
      restaurantId: "restaurant-1",
    };
    authState.customer = { id: "customer-42" };
  });

  it("previews coupon discounts for the authenticated user", async () => {
    serviceMocks.previewCoupon.mockResolvedValue({
      valid: true,
      discountAmount: 40,
    });

    const response = await routes.fetch(
      jsonRequest("/preview-coupon", {
        restaurantId: "restaurant-1",
        couponCode: "SAVE40",
        orderAmount: 200,
        menuItems: [{ menuItemId: 7, quantity: 1 }],
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { valid: true, discountAmount: 40 },
    });
    expect(serviceMocks.previewCoupon).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      couponCode: "SAVE40",
      orderAmount: 200,
      userId: "user-42",
      menuItems: [{ menuItemId: 7, quantity: 1 }],
    });
  });

  it("stores batch sync payloads with encoded sync ids", async () => {
    const env = createEnv();

    const response = await routes.fetch(
      jsonRequest("/batch-sync", {
        sync_id: "local batch/1",
        orders: [{ id: "offline-1" }, { id: "offline-2" }],
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        syncId: "local%20batch%2F1",
        synced: true,
        itemCount: 2,
        restaurantId: "restaurant-1",
      },
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "orders:batch-sync:restaurant-1:user-42:local%20batch%2F1",
      expect.stringContaining('"userId":"user-42"'),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "orders:batch-sync:restaurant-1:user-42:latest",
      expect.stringContaining('"local batch/1"'),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    // /batch-sync mirrors the real order-creation flow (which requires
    // online_ordering) for offline-capable clients; gate it the same way so
    // a deactivated/kill-switched subscription can't keep writing sync data
    // through this side door (see module-gate.test.ts for the real-gate
    // proof). Asserted against this route's own middleware chain, not a count
    // of online_ordering registrations across the file: a count cannot tell
    // this gate from any other, so it went red when an unrelated route was
    // added (POST /:id/delivery-claim, eb858802) and would have stayed green
    // had this gate been dropped in the same change that added one.
    expect(moduleGatesFor("POST", "/batch-sync")).toContain("online_ordering");
  });

  it("stores batch sync payloads with global scope and timestamp ids", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    try {
      authState.user = { id: "user-42", role: 0, restaurantId: null };
      const env = createEnv();

      const response = await routes.fetch(
        jsonRequest("/batch-sync", { orders: "not-an-array" }),
        env as never,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          syncId: "1780790400000",
          itemCount: 0,
          restaurantId: null,
        },
      });
      expect(env.CACHE_KV.put).toHaveBeenCalledWith(
        "orders:batch-sync:global:user-42:1780790400000",
        expect.stringContaining('"restaurantId":null'),
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates authenticated orders and serializes timestamps for the wire", async () => {
    const env = createEnv();
    serviceMocks.createOrder.mockResolvedValue({
      id: 1001,
      restaurantId: "restaurant-1",
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
      updatedAt: "2026-06-07T00:01:00.000Z",
    });

    const response = await routes.fetch(
      jsonRequest("/", {
        restaurantId: "restaurant-1",
        customerName: "Dana",
        customerPhone: "0912345678",
        items: [
          {
            menuItemId: 7,
            quantity: 2,
            price: 120,
            notes: "No <b>peanuts</b>",
          },
        ],
        orderType: "table",
        tableId: 3,
      }),
      env as never,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        id: 1001,
        createdAt: Date.parse("2026-06-07T00:00:00.000Z"),
        updatedAt: Date.parse("2026-06-07T00:01:00.000Z"),
      },
    });
    expect(serviceMocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        tableId: 3,
        customerId: "customer-42",
        customerInfo: expect.objectContaining({
          name: "Dana",
          phone: "0912345678",
        }),
        items: [
          expect.objectContaining({
            menuItemId: 7,
            quantity: 2,
            notes: "No bpeanuts/b",
          }),
        ],
      }),
      "user-42",
    );
    expect(gateMocks.meterEmit).toHaveBeenCalledWith(
      expect.anything(),
      "orders.created",
      {
        restaurantId: "restaurant-1",
        metadata: { orderId: 1001 },
      },
    );
  });

  it("carries the idempotency key all the way to the service", async () => {
    // Two layers have to hold for this to pass, and each fails silently on its
    // own: zod strips any field createOrderSchema does not declare, and
    // createOrderData is an object literal, so omitting an optional field
    // there is perfectly legal TypeScript. Asserting a 201 would prove
    // neither — only the argument the service actually received does.
    serviceMocks.createOrder.mockResolvedValue({ id: 1004 });

    const response = await routes.fetch(
      jsonRequest("/", {
        restaurantId: "restaurant-1",
        items: [{ menuItemId: 7, quantity: 1, price: 120 }],
        tableId: 3,
        clientMutationId: "cart-9f2c-1",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(201);
    expect(serviceMocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ clientMutationId: "cart-9f2c-1" }),
      "user-42",
    );
  });

  it("answers a replayed key with 409 rather than a 500", async () => {
    // The unique index on (restaurant_id, client_mutation_id) rejects the
    // second write and the database service reports it as this sentinel. Left
    // unmapped it reaches the global handler as an unknown error, and the
    // customer sees a generic failure for an order that did go through — which
    // is exactly the message that makes them tap again.
    serviceMocks.createOrder.mockRejectedValue(
      new Error("CLIENT_MUTATION_DUPLICATE"),
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/", {
          restaurantId: "restaurant-1",
          items: [{ menuItemId: 7, quantity: 1, price: 120 }],
          tableId: 3,
          clientMutationId: "cart-9f2c-1",
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "CLIENT_MUTATION_DUPLICATE" },
    });
  });

  it("gates shop-channel orders on shop mode", async () => {
    gateMocks.assertShopOrderingEnabled.mockRejectedValue(
      Object.assign(new Error("This restaurant is not accepting shop orders"), {
        code: "SHOP_MODE_DISABLED",
      }),
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/", {
          restaurantId: "restaurant-1",
          items: [{ menuItemId: 7, quantity: 1, price: 120 }],
          orderType: "shop",
        }),
        createEnv() as never,
      ),
    );

    expect(gateMocks.assertShopOrderingEnabled).toHaveBeenCalledWith(
      expect.anything(),
      "restaurant-1",
      undefined,
    );
    expect(response.status).toBe(500);
    expect(serviceMocks.createOrder).not.toHaveBeenCalled();
  });

  it("forwards the scanned code so a regenerated QR can be retired", async () => {
    serviceMocks.createOrder.mockResolvedValue({ id: 1003 });

    await routes.fetch(
      jsonRequest("/", {
        restaurantId: "restaurant-1",
        items: [{ menuItemId: 7, quantity: 1, price: 120 }],
        orderType: "shop",
        shopQrCode: "SHOP-restaurant-1-1785563580",
      }),
      createEnv() as never,
    );

    expect(gateMocks.assertShopOrderingEnabled).toHaveBeenCalledWith(
      expect.anything(),
      "restaurant-1",
      "SHOP-restaurant-1-1785563580",
    );
  });

  it("leaves table orders ungated even though orderType defaults to shop", async () => {
    // The schema default means a client that omits orderType sends a table
    // order labelled "shop". Gating on that label alone would break dine-in.
    serviceMocks.createOrder.mockResolvedValue({ id: 1002 });

    const response = await routes.fetch(
      jsonRequest("/", {
        restaurantId: "restaurant-1",
        items: [{ menuItemId: 7, quantity: 1, price: 120 }],
        tableId: 3,
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(201);
    expect(gateMocks.assertShopOrderingEnabled).not.toHaveBeenCalled();
    expect(serviceMocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 3, orderType: "shop" }),
      "user-42",
    );
  });

  it("rejects authenticated orders for another restaurant", async () => {
    const response = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/", {
          restaurantId: "restaurant-2",
          customerName: "Dana",
          items: [{ menuItemId: 7, quantity: 1, price: 120 }],
          orderType: "shop",
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(403);
    expect(serviceMocks.createOrder).not.toHaveBeenCalled();
  });

  it("maps list filters and constrains non-admins to their restaurant", async () => {
    const env = createEnv();
    serviceMocks.getOrders.mockResolvedValue({
      orders: [
        {
          id: 1,
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: null,
        },
      ],
      pagination: { page: 2, limit: 5, total: 1 },
    });

    const response = await routes.fetch(
      new Request(
        "https://orders.test/?status=pending,confirmed&paymentStatus=paid,failed&paymentMethod=cash,card&page=2&limit=5&dateFrom=2026-06-01T00:00:00.000Z&scheduledTimeFrom=2026-06-02T00:00:00.000Z",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: 1, createdAt: Date.parse("2026-06-07T00:00:00.000Z") }],
      pagination: { page: 2, limit: 5, total: 1 },
    });
    expect(serviceMocks.getOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        status: ["pending", "confirmed"],
        // payment_status is a TEXT column (pending/completed/failed/refunded);
        // "paid" is normalized to the canonical "completed".
        paymentStatus: ["completed", "failed"],
        paymentMethod: ["cash", "card"],
        dateFrom: new Date("2026-06-01T00:00:00.000Z"),
        scheduledTimeFrom: new Date("2026-06-02T00:00:00.000Z"),
      }),
      "user-42",
      1,
      expect.objectContaining({
        userId: "user-42",
        userRestaurantId: "restaurant-1",
      }),
    );
  });

  it("rejects the retired legacy customer role and maps the admin list scope", async () => {
    serviceMocks.getOrders.mockResolvedValue({
      orders: [],
      pagination: { page: 1, limit: 20, total: 0 },
    });
    const env = createEnv();

    // users.role=5 is retired — customers list their orders through
    // GET /api/v1/customers/me/orders. This staff route must refuse outright
    // rather than build a filter from a users row id, which can never match
    // the customers.id TEXT FK in orders.customer_id.
    authState.user = { id: "user-42", role: 5, restaurantId: null };
    const customerResponse = await withSilencedRouteError(() =>
      routes.fetch(new Request("https://orders.test/"), env as never),
    );
    expect(customerResponse.status).toBe(403);
    await expect(customerResponse.json()).resolves.toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_ROLE" },
    });
    expect(serviceMocks.getOrders).not.toHaveBeenCalled();

    authState.user = { id: "user-1", role: 0, restaurantId: null };
    const adminResponse = await routes.fetch(
      new Request("https://orders.test/?restaurantId=restaurant-2"),
      env as never,
    );
    expect(adminResponse.status).toBe(200);
    expect(serviceMocks.getOrders).toHaveBeenLastCalledWith(
      expect.objectContaining({ restaurantId: "restaurant-2" }),
      "user-1",
      0,
      expect.any(Object),
    );
  });

  it("returns statistics for owner and admin restaurant scopes", async () => {
    serviceMocks.getOrderStatistics.mockResolvedValue({
      totalOrders: 9,
      totalRevenue: 1080,
    });
    const env = createEnv();

    const ownerResponse = await routes.fetch(
      new Request("https://orders.test/stats?timeRange=week"),
      env as never,
    );
    expect(ownerResponse.status).toBe(200);
    expect(serviceMocks.getOrderStatistics).toHaveBeenCalledWith(
      "restaurant-1",
    );

    authState.user = { id: "user-1", role: 0, restaurantId: null };
    const adminResponse = await routes.fetch(
      new Request("https://orders.test/stats?restaurantId=restaurant-2"),
      env as never,
    );
    expect(adminResponse.status).toBe(200);
    expect(serviceMocks.getOrderStatistics).toHaveBeenLastCalledWith(
      "restaurant-2",
    );
  });

  it("forwards list pagination, search, and filters to the orders service", async () => {
    serviceMocks.getOrders.mockResolvedValue({
      orders: [],
      pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
    });

    const response = await routes.fetch(
      new Request(
        "https://orders.test/?page=2&limit=20&search=ORD-21&status=paid&orderType=shop&orderSource=direct",
      ),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.getOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        limit: 20,
        search: "ORD-21",
        status: ["paid"],
        orderType: "shop",
        orderSource: "direct",
      }),
      "user-42",
      1,
      expect.any(Object),
    );
  });

  it.each(["confirmed", "preparing", "ready", "delivered"])(
    "lets an owner advance an order to %s in their own restaurant",
    async (status) => {
      serviceMocks.getOrder.mockResolvedValue({
        id: "order-1",
        restaurantId: "restaurant-1",
      });
      serviceMocks.updateOrderStatus.mockResolvedValue({
        id: "order-1",
        restaurantId: "restaurant-1",
        status,
      });

      const response = await routes.fetch(
        jsonRequest("/order-1/status", { status }, "PUT"),
        createEnv() as never,
      );

      expect(response.status).toBe(200);
    },
  );

  it("requires a restaurant scope for admin statistics and active orders", async () => {
    authState.user = { id: "user-1", role: 0, restaurantId: null };

    const statsResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://orders.test/stats"),
        createEnv() as never,
      ),
    );
    expect(statsResponse.status).toBe(400);

    const activeResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://orders.test/active"),
        createEnv() as never,
      ),
    );
    expect(activeResponse.status).toBe(400);
  });

  it("returns analytics and active orders", async () => {
    serviceMocks.getOrderAnalytics.mockResolvedValue({ revenue: 500 });
    serviceMocks.getActiveOrders.mockResolvedValue([
      { id: 1, createdAt: "2026-06-07T00:00:00.000Z" },
    ]);
    const env = createEnv();

    const analyticsResponse = await routes.fetch(
      new Request(
        "https://orders.test/analytics?dateFrom=2026-06-01T00:00:00.000Z",
      ),
      env as never,
    );
    expect(analyticsResponse.status).toBe(200);
    expect(serviceMocks.getOrderAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        dateFrom: new Date("2026-06-01T00:00:00.000Z"),
      }),
      "user-42",
      expect.any(Object),
    );

    const activeResponse = await routes.fetch(
      new Request("https://orders.test/active"),
      env as never,
    );
    expect(activeResponse.status).toBe(200);
    await expect(activeResponse.json()).resolves.toMatchObject({
      data: [{ id: 1, createdAt: Date.parse("2026-06-07T00:00:00.000Z") }],
    });
    expect(serviceMocks.getActiveOrders).toHaveBeenCalledWith("restaurant-1");
  });

  it("returns order detail for staff and refuses the retired customer role", async () => {
    serviceMocks.getOrder
      .mockResolvedValueOnce({
        id: 55,
        customerId: "customer-42",
        restaurantId: "restaurant-1",
        createdAt: "not-a-date",
      })
      .mockResolvedValueOnce(null);

    authState.user = { id: "user-42", role: 1, restaurantId: "restaurant-1" };
    const response = await routes.fetch(
      new Request("https://orders.test/55"),
      createEnv() as never,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 55, createdAt: "not-a-date" },
    });

    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(new Request("https://orders.test/56"), createEnv() as never),
    );
    expect(missingResponse.status).toBe(404);

    // Legacy users.role=5 never reaches the handler: the ownership comparison
    // it used to fall into compared a users row id against the customers.id
    // TEXT FK, which cannot match, so the route now rejects up front.
    serviceMocks.getOrder.mockClear();
    authState.user = { id: "user-42", role: 5, restaurantId: null };
    const legacyCustomerResponse = await withSilencedRouteError(() =>
      routes.fetch(new Request("https://orders.test/57"), createEnv() as never),
    );
    expect(legacyCustomerResponse.status).toBe(403);
    await expect(legacyCustomerResponse.json()).resolves.toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_ROLE" },
    });
    expect(serviceMocks.getOrder).not.toHaveBeenCalled();
  });

  it("updates order status after permission checks", async () => {
    const env = createEnv();
    authState.user = {
      id: "user-42",
      role: 0,
      restaurantId: null,
    };
    serviceMocks.getOrder.mockResolvedValue({
      id: 55,
      restaurantId: "restaurant-1",
      orderSource: "direct",
    });
    serviceMocks.updateOrderStatus.mockResolvedValue({
      id: 55,
      status: "delivered",
      readyAt: new Date("2026-06-07T00:10:00.000Z"),
    });

    const response = await routes.fetch(
      jsonRequest(
        "/55/status",
        {
          status: "delivered",
          notes: "Ready",
          estimatedReadyTime: "2026-06-07T00:10:00.000Z",
        },
        "PUT",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        id: 55,
        status: "delivered",
        readyAt: Date.parse("2026-06-07T00:10:00.000Z"),
      },
    });
    expect(serviceMocks.updateOrderStatus).toHaveBeenCalledWith(
      "55",
      expect.objectContaining({
        status: "delivered",
        notes: "Ready",
        updatedBy: "user-42",
        estimatedReadyTime: new Date("2026-06-07T00:10:00.000Z"),
      }),
      "user-42",
      0,
      expect.any(Object),
      expect.objectContaining({ id: 55 }),
    );
  });

  it("reports status update permission and service failures", async () => {
    serviceMocks.getOrder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 55, restaurantId: "restaurant-2" })
      .mockResolvedValueOnce({ id: 55, restaurantId: "restaurant-1" });

    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/55/status", { status: "delivered" }, "PUT"),
        createEnv() as never,
      ),
    );
    expect(missingResponse.status).toBe(404);

    const forbiddenResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/55/status", { status: "delivered" }, "PUT"),
        createEnv() as never,
      ),
    );
    expect(forbiddenResponse.status).toBe(403);

    serviceMocks.updateOrderStatus.mockResolvedValue(null);
    const failedResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("/55/status", { status: "delivered" }, "PUT"),
        createEnv() as never,
      ),
    );
    expect(failedResponse.status).toBe(400);
  });

  it("cancels orders through the service", async () => {
    const env = createEnv();
    serviceMocks.getOrder.mockResolvedValue({
      id: 55,
      restaurantId: "restaurant-1",
    });
    serviceMocks.cancelOrder.mockResolvedValue({ id: 55, status: "cancelled" });

    const response = await routes.fetch(
      new Request("https://orders.test/55", { method: "DELETE" }),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      message: "Order cancelled successfully",
    });
    expect(serviceMocks.cancelOrder).toHaveBeenCalledWith(
      "55",
      "Cancelled by user",
      "user-42",
      expect.any(Object),
      expect.objectContaining({ id: 55 }),
    );
  });

  it("syncs a successfully cancelled platform order in the background", async () => {
    const waitUntilPromises: Array<Promise<unknown>> = [];
    serviceMocks.getOrder.mockResolvedValue({
      id: "55",
      restaurantId: "restaurant-1",
      orderSource: "uber_eats",
    });
    serviceMocks.cancelOrder.mockResolvedValue({
      id: "55",
      status: "cancelled",
      orderSource: "uber_eats",
    });

    const response = await routes.fetch(
      new Request("https://orders.test/55", { method: "DELETE" }),
      createEnv() as never,
      {
        waitUntil: (promise: Promise<unknown>) =>
          waitUntilPromises.push(promise),
      } as never,
    );

    expect(response.status).toBe(200);
    expect(waitUntilPromises).toHaveLength(1);
    await Promise.all(waitUntilPromises);
    expect(platformOrderServiceMocks.syncStatusToPlatform).toHaveBeenCalledWith(
      "55",
      "cancelled",
    );
  });

  it("does not sync direct or failed cancellations to a platform", async () => {
    const waitUntil = vi.fn();
    serviceMocks.getOrder.mockResolvedValue({
      id: "55",
      restaurantId: "restaurant-1",
      orderSource: "direct",
    });
    serviceMocks.cancelOrder.mockResolvedValue({
      id: "55",
      status: "cancelled",
    });

    const directResponse = await routes.fetch(
      new Request("https://orders.test/55", { method: "DELETE" }),
      createEnv() as never,
      { waitUntil } as never,
    );

    expect(directResponse.status).toBe(200);
    expect(waitUntil).not.toHaveBeenCalled();

    serviceMocks.getOrder.mockResolvedValue({
      id: "56",
      restaurantId: "restaurant-1",
      orderSource: "uber_eats",
    });
    serviceMocks.cancelOrder.mockResolvedValue(null);
    const failedResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://orders.test/56", { method: "DELETE" }),
        createEnv() as never,
        { waitUntil } as never,
      ),
    );

    expect(failedResponse.status).toBe(400);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("keeps a local cancellation successful when platform sync fails", async () => {
    const waitUntilPromises: Array<Promise<unknown>> = [];
    serviceMocks.getOrder.mockResolvedValue({
      id: "55",
      restaurantId: "restaurant-1",
      orderSource: "uber_eats",
    });
    serviceMocks.cancelOrder.mockResolvedValue({
      id: "55",
      status: "cancelled",
    });
    platformOrderServiceMocks.syncStatusToPlatform.mockRejectedValue(
      new Error("platform unavailable"),
    );

    const response = await routes.fetch(
      new Request("https://orders.test/55", { method: "DELETE" }),
      createEnv() as never,
      {
        waitUntil: (promise: Promise<unknown>) =>
          waitUntilPromises.push(promise),
      } as never,
    );

    expect(response.status).toBe(200);
    await expect(Promise.all(waitUntilPromises)).resolves.toEqual([undefined]);
  });

  it("passes a caller-supplied cancellation reason to the service", async () => {
    const env = createEnv();
    serviceMocks.getOrder.mockResolvedValue({
      id: 55,
      restaurantId: "restaurant-1",
    });
    serviceMocks.cancelOrder.mockResolvedValue({ id: 55, status: "cancelled" });

    const response = await routes.fetch(
      new Request("https://orders.test/55", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Customer changed their mind" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.cancelOrder).toHaveBeenCalledWith(
      "55",
      "Customer changed their mind",
      "user-42",
      expect.any(Object),
      expect.objectContaining({ id: 55 }),
    );
  });

  it("caps an over-long cancellation reason at 500 characters", async () => {
    const env = createEnv();
    serviceMocks.getOrder.mockResolvedValue({
      id: 55,
      restaurantId: "restaurant-1",
    });
    serviceMocks.cancelOrder.mockResolvedValue({ id: 55, status: "cancelled" });

    const response = await routes.fetch(
      new Request("https://orders.test/55", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "x".repeat(900) }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const reasonArg = serviceMocks.cancelOrder.mock.calls[0]?.[1] as string;
    expect(reasonArg).toHaveLength(500);
  });

  it("falls back to the default reason for an absent body", async () => {
    const env = createEnv();
    serviceMocks.getOrder.mockResolvedValue({
      id: 55,
      restaurantId: "restaurant-1",
    });
    serviceMocks.cancelOrder.mockResolvedValue({ id: 55, status: "cancelled" });

    const response = await routes.fetch(
      new Request("https://orders.test/55", { method: "DELETE" }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.cancelOrder).toHaveBeenCalledWith(
      "55",
      "Cancelled by user",
      "user-42",
      expect.any(Object),
      expect.objectContaining({ id: 55 }),
    );
  });

  it("reports cancel order failures", async () => {
    serviceMocks.getOrder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 55, restaurantId: "restaurant-2" })
      .mockResolvedValueOnce({ id: 55, restaurantId: "restaurant-1" });

    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://orders.test/55", { method: "DELETE" }),
        createEnv() as never,
      ),
    );
    expect(missingResponse.status).toBe(404);

    const forbiddenResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://orders.test/55", { method: "DELETE" }),
        createEnv() as never,
      ),
    );
    expect(forbiddenResponse.status).toBe(403);

    serviceMocks.cancelOrder.mockResolvedValue(null);
    const failedResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://orders.test/55", { method: "DELETE" }),
        createEnv() as never,
      ),
    );
    expect(failedResponse.status).toBe(400);
  });

  it("executes bulk order operations", async () => {
    serviceMocks.bulkUpdateOrders.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
    });

    const response = await routes.fetch(
      jsonRequest("/bulk", {
        action: "update_status",
        orderIds: [55, 56],
        data: { status: "confirmed" },
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { successCount: 2, failureCount: 0 },
    });
    expect(serviceMocks.bulkUpdateOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update_status",
        orderIds: ["55", "56"],
      }),
      "user-42",
      1,
      {
        userId: "user-42",
        userRole: 1,
        userRestaurantId: "restaurant-1",
      },
    );
  });

  it("denies an unassigned owner on every order access route", async () => {
    authState.user = { id: "unassigned-owner", role: 1, restaurantId: null };

    const responses = await Promise.all([
      routes.fetch(new Request("https://orders.test/"), createEnv() as never),
      routes.fetch(new Request("https://orders.test/55"), createEnv() as never),
      routes.fetch(
        new Request("https://orders.test/55", { method: "DELETE" }),
        createEnv() as never,
      ),
      routes.fetch(
        jsonRequest("/55/status", { status: "confirmed" }, "PUT"),
        createEnv() as never,
      ),
      routes.fetch(
        jsonRequest("/bulk", {
          action: "cancel",
          orderIds: ["55"],
        }),
        createEnv() as never,
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403,
    ]);
    expect(serviceMocks.getOrders).not.toHaveBeenCalled();
    expect(serviceMocks.getOrder).not.toHaveBeenCalled();
    expect(serviceMocks.cancelOrder).not.toHaveBeenCalled();
    expect(serviceMocks.updateOrderStatus).not.toHaveBeenCalled();
    expect(serviceMocks.bulkUpdateOrders).not.toHaveBeenCalled();
  });

  it("syncs only successfully cancelled platform orders from a bulk operation", async () => {
    const waitUntilPromises: Array<Promise<unknown>> = [];
    serviceMocks.bulkUpdateOrders.mockResolvedValue({
      successCount: 2,
      failedCount: 1,
      results: [
        {
          orderId: "platform-1",
          success: true,
          data: { id: "platform-1", orderSource: "uber_eats" },
        },
        {
          orderId: "direct-1",
          success: true,
          data: { id: "direct-1", orderSource: "direct" },
        },
        {
          orderId: "platform-2",
          success: false,
          data: { id: "platform-2", orderSource: "foodpanda" },
        },
      ],
    });

    const response = await routes.fetch(
      jsonRequest("/bulk", {
        action: "cancel",
        orderIds: ["platform-1", "direct-1", "platform-2"],
      }),
      createEnv() as never,
      {
        waitUntil: (promise: Promise<unknown>) =>
          waitUntilPromises.push(promise),
      } as never,
    );

    expect(response.status).toBe(200);
    expect(waitUntilPromises).toHaveLength(1);
    await Promise.all(waitUntilPromises);
    expect(
      platformOrderServiceMocks.syncStatusToPlatform,
    ).toHaveBeenCalledTimes(1);
    expect(platformOrderServiceMocks.syncStatusToPlatform).toHaveBeenCalledWith(
      "platform-1",
      "cancelled",
    );
  });

  it("exports orders with format-specific response headers", async () => {
    const env = createEnv();
    serviceMocks.exportOrders.mockResolvedValue("order_id,total\n1,120\n");

    const response = await routes.fetch(
      jsonRequest(
        "/export",
        {
          format: "csv",
          includeItems: "true",
          restaurantId: "restaurant-1",
          status: "paid",
        },
        "POST",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv");
    expect(response.headers.get("content-disposition")).toContain("orders-");
    await expect(response.text()).resolves.toBe("order_id,total\n1,120\n");
    expect(serviceMocks.exportOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        status: "paid",
      }),
      "csv",
    );
  });

  it("sets export content types for excel and pdf", async () => {
    serviceMocks.exportOrders
      .mockResolvedValueOnce("excel-data")
      .mockResolvedValueOnce("pdf-data");

    const excelResponse = await routes.fetch(
      jsonRequest("/export", { format: "excel" }, "POST"),
      createEnv() as never,
    );
    expect(excelResponse.status).toBe(200);
    expect(excelResponse.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const pdfResponse = await routes.fetch(
      jsonRequest("/export", { format: "pdf" }, "POST"),
      createEnv() as never,
    );
    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers.get("content-type")).toBe("application/pdf");
  });

  it("generates receipts for staff in the order's restaurant", async () => {
    const env = createEnv();
    authState.user = { id: "user-42", role: 1, restaurantId: "restaurant-1" };
    serviceMocks.getOrder.mockResolvedValue({
      id: 55,
      customerId: "customer-42",
      restaurantId: "restaurant-1",
    });
    serviceMocks.generateReceipt.mockResolvedValue({ html: "<p>receipt</p>" });

    const response = await routes.fetch(
      new Request("https://orders.test/55/receipt"),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { html: "<p>receipt</p>" },
    });
    expect(serviceMocks.generateReceipt).toHaveBeenCalledWith("55");
    expect(gateMocks.meterEmit).toHaveBeenCalledWith(
      expect.anything(),
      "print.jobs",
      {
        restaurantId: "restaurant-1",
        metadata: { orderId: "55" },
      },
    );
  });

  it("reports receipt permission failures", async () => {
    serviceMocks.getOrder.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 55,
      customerId: "customer-42",
      restaurantId: "restaurant-2",
    });

    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://orders.test/55/receipt"),
        createEnv() as never,
      ),
    );
    expect(missingResponse.status).toBe(404);

    // The retired users.role=5 branch used to compare a users row id against
    // orders.customer_id (a customers.id TEXT FK). It never matched, so it
    // only ever produced a 403 — the role is now refused before the lookup.
    authState.user = { id: "user-42", role: 5, restaurantId: null };
    const legacyCustomerResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://orders.test/55/receipt"),
        createEnv() as never,
      ),
    );
    expect(legacyCustomerResponse.status).toBe(403);
    await expect(legacyCustomerResponse.json()).resolves.toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_ROLE" },
    });
    expect(serviceMocks.getOrder).toHaveBeenCalledOnce();

    authState.user = { id: "user-42", role: 1, restaurantId: "restaurant-1" };
    const staffForbiddenResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://orders.test/55/receipt"),
        createEnv() as never,
      ),
    );
    expect(staffForbiddenResponse.status).toBe(403);
    expect(serviceMocks.generateReceipt).not.toHaveBeenCalled();
  });
});

/**
 * #273. The engine for these was already live behind the guest door; what is
 * tested here is the staff door itself -- who may open it, that the version
 * the client saw is carried through, and that a removal reaches the service as
 * quantity 0.
 */
describe("orders item modification routes", () => {
  const openOrder = {
    id: "order-1",
    restaurantId: "restaurant-1",
    status: "confirmed",
    version: 3,
    items: [{ id: 11, menuItemId: 101, quantity: 2 }],
  };

  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) {
      mock.mockReset();
    }
    authState.user = { id: "user-42", role: 1, restaurantId: "restaurant-1" };
  });

  describe("POST /:id/discount", () => {
    it("sends only the percentage, never a price", async () => {
      serviceMocks.getOrder.mockResolvedValue(openOrder);
      serviceMocks.applyOrderDiscount.mockResolvedValue({
        ...openOrder,
        discountAmount: 10,
        totalAmount: 90,
        version: 4,
      });

      const res = await routes.fetch(
        jsonRequest("/order-1/discount", {
          discountPercent: 10,
          reason: "Counter discount 10%",
          expectedVersion: 3,
        }),
        createEnv(),
      );

      expect(res.status).toBe(200);
      expect(serviceMocks.applyOrderDiscount).toHaveBeenCalledOnce();
      expect(serviceMocks.applyOrderDiscount).toHaveBeenCalledWith(
        "order-1",
        10,
        "Counter discount 10%",
        "user-42",
        3,
      );
    });

    it("rejects a body that names an amount instead of a percentage", async () => {
      // The whole point of #327: the till says how much off, never how much to
      // charge. This is a 400 because `discountPercent` is required, not
      // because the extra key is refused -- Zod strips unknown keys. Stripping
      // is fine here precisely because nothing downstream reads an amount.
      serviceMocks.getOrder.mockResolvedValue(openOrder);

      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest("/order-1/discount", {
            discountAmount: 10,
            reason: "Counter discount",
          }),
          createEnv(),
        ),
      );

      expect(res.status).toBe(400);
      expect(serviceMocks.applyOrderDiscount).not.toHaveBeenCalled();
    });

    it("requires a reason, because the audit log is the only record", async () => {
      serviceMocks.getOrder.mockResolvedValue(openOrder);

      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest("/order-1/discount", { discountPercent: 10 }),
          createEnv(),
        ),
      );

      expect(res.status).toBe(400);
      expect(serviceMocks.applyOrderDiscount).not.toHaveBeenCalled();
    });

    it("refuses a percentage outside 0-100", async () => {
      serviceMocks.getOrder.mockResolvedValue(openOrder);

      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest("/order-1/discount", {
            discountPercent: 150,
            reason: "oops",
          }),
          createEnv(),
        ),
      );

      expect(res.status).toBe(400);
      expect(serviceMocks.applyOrderDiscount).not.toHaveBeenCalled();
    });

    it("lets a cashier discount, unlike the item-editing routes", async () => {
      // Taking money is the cashier's job. Safe to widen because the body
      // carries no price -- the server still derives the money itself.
      authState.user = { id: "user-9", role: 4, restaurantId: "restaurant-1" };
      serviceMocks.getOrder.mockResolvedValue(openOrder);
      serviceMocks.applyOrderDiscount.mockResolvedValue({
        ...openOrder,
        discountAmount: 5,
        totalAmount: 95,
      });

      const res = await routes.fetch(
        jsonRequest("/order-1/discount", {
          discountPercent: 5,
          reason: "Counter discount 5%",
        }),
        createEnv(),
      );

      expect(res.status).toBe(200);
      expect(serviceMocks.applyOrderDiscount).toHaveBeenCalledOnce();
    });

    it("refuses a cross-tenant order", async () => {
      authState.user = { id: "user-9", role: 4, restaurantId: "restaurant-2" };
      serviceMocks.getOrder.mockResolvedValue(openOrder);

      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest("/order-1/discount", {
            discountPercent: 5,
            reason: "Counter discount 5%",
          }),
          createEnv(),
        ),
      );

      expect(res.status).toBe(403);
      expect(serviceMocks.applyOrderDiscount).not.toHaveBeenCalled();
    });
  });

  describe("POST /:id/items", () => {
    it("adds items and returns the updated order", async () => {
      serviceMocks.getOrder.mockResolvedValue(openOrder);
      serviceMocks.addItemsToOrder.mockResolvedValue({
        ...openOrder,
        version: 4,
      });

      const res = await routes.fetch(
        jsonRequest("/order-1/items", {
          items: [{ menuItemId: 101, quantity: 1 }],
          expectedVersion: 3,
        }),
        createEnv(),
      );

      expect(res.status).toBe(200);
      expect(serviceMocks.addItemsToOrder).toHaveBeenCalledOnce();
      expect(serviceMocks.addItemsToOrder).toHaveBeenCalledWith(
        "order-1",
        expect.arrayContaining([
          expect.objectContaining({ menuItemId: 101, quantity: 1 }),
        ]),
        "user-42",
        3,
      );
    });

    it("hands expectedVersion to the service rather than checking it here", async () => {
      // The check lives beside the read that feeds the CAS, one layer down.
      // Doing it here as well would look safe and leave a race open.
      serviceMocks.getOrder.mockResolvedValue(openOrder);
      serviceMocks.addItemsToOrder.mockRejectedValue(
        new ApiError(
          "ORDER_VERSION_CONFLICT",
          "Order was updated by another actor. Reload before retrying.",
          409,
        ),
      );

      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest("/order-1/items", {
            items: [{ menuItemId: 101, quantity: 1 }],
            expectedVersion: 2,
          }),
          createEnv(),
        ),
      );

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: { code: "ORDER_VERSION_CONFLICT" },
      });
      expect(serviceMocks.addItemsToOrder).toHaveBeenCalledWith(
        "order-1",
        expect.any(Array),
        "user-42",
        2,
      );
    });

    it("refuses a caller from another restaurant", async () => {
      authState.user = { id: "user-9", role: 1, restaurantId: "restaurant-2" };
      serviceMocks.getOrder.mockResolvedValue(openOrder);

      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest("/order-1/items", {
            items: [{ menuItemId: 101, quantity: 1 }],
          }),
          createEnv(),
        ),
      );

      expect(res.status).toBe(403);
      expect(serviceMocks.addItemsToOrder).not.toHaveBeenCalled();
    });

    it("refuses a chef, who may advance a ticket but not reprice it", async () => {
      authState.user = { id: "chef-1", role: 2, restaurantId: "restaurant-1" };

      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest("/order-1/items", {
            items: [{ menuItemId: 101, quantity: 1 }],
          }),
          createEnv(),
        ),
      );

      expect(res.status).toBe(403);
      expect(serviceMocks.addItemsToOrder).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /:id/items/:itemId", () => {
    it("passes the new quantity, the version and the caller through", async () => {
      serviceMocks.changeOrderItemQuantity.mockResolvedValue({
        ...openOrder,
        version: 4,
      });

      const res = await routes.fetch(
        jsonRequest(
          "/order-1/items/11",
          { quantity: 5, expectedVersion: 3 },
          "PATCH",
        ),
        createEnv(),
      );

      expect(res.status).toBe(200);
      expect(serviceMocks.changeOrderItemQuantity).toHaveBeenCalledWith(
        "order-1",
        11,
        5,
        expect.objectContaining({
          userId: "user-42",
          expectedVersion: 3,
          caller: expect.objectContaining({
            userId: "user-42",
            userRestaurantId: "restaurant-1",
          }),
        }),
      );
    });

    it("rejects quantity 0 — removal is DELETE, not a zero PATCH", async () => {
      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest("/order-1/items/11", { quantity: 0 }, "PATCH"),
          createEnv(),
        ),
      );

      expect(res.status).toBe(400);
      expect(serviceMocks.changeOrderItemQuantity).not.toHaveBeenCalled();
    });

    it("rejects a non-numeric item id", async () => {
      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest("/order-1/items/abc", { quantity: 2 }, "PATCH"),
          createEnv(),
        ),
      );

      expect(res.status).toBe(400);
      expect(serviceMocks.changeOrderItemQuantity).not.toHaveBeenCalled();
    });

    it("surfaces the service's 409 rather than flattening it to a 500", async () => {
      serviceMocks.changeOrderItemQuantity.mockRejectedValue(
        new ApiError(
          "ORDER_VERSION_CONFLICT",
          "Order was updated by another actor. Reload before retrying.",
          409,
        ),
      );

      const res = await withSilencedRouteError(() =>
        routes.fetch(
          jsonRequest(
            "/order-1/items/11",
            { quantity: 1, expectedVersion: 1 },
            "PATCH",
          ),
          createEnv(),
        ),
      );

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: { code: "ORDER_VERSION_CONFLICT" },
      });
    });
  });

  describe("DELETE /:id/items/:itemId", () => {
    it("reaches the service as quantity 0, with the version from the query", async () => {
      serviceMocks.changeOrderItemQuantity.mockResolvedValue({
        ...openOrder,
        version: 4,
        items: [],
      });

      const res = await routes.fetch(
        new Request("https://orders.test/order-1/items/11?expectedVersion=3", {
          method: "DELETE",
        }),
        createEnv(),
      );

      expect(res.status).toBe(200);
      expect(serviceMocks.changeOrderItemQuantity).toHaveBeenCalledWith(
        "order-1",
        11,
        0,
        expect.objectContaining({ userId: "user-42", expectedVersion: 3 }),
      );
    });

    it("works without a version, for clients that do not track one", async () => {
      serviceMocks.changeOrderItemQuantity.mockResolvedValue(openOrder);

      const res = await routes.fetch(
        new Request("https://orders.test/order-1/items/11", {
          method: "DELETE",
        }),
        createEnv(),
      );

      expect(res.status).toBe(200);
      expect(serviceMocks.changeOrderItemQuantity).toHaveBeenCalledWith(
        "order-1",
        11,
        0,
        expect.objectContaining({ expectedVersion: undefined }),
      );
    });

    it("refuses a cashier", async () => {
      authState.user = {
        id: "cashier-1",
        role: 4,
        restaurantId: "restaurant-1",
      };

      const res = await withSilencedRouteError(() =>
        routes.fetch(
          new Request("https://orders.test/order-1/items/11", {
            method: "DELETE",
          }),
          createEnv(),
        ),
      );

      expect(res.status).toBe(403);
      expect(serviceMocks.changeOrderItemQuantity).not.toHaveBeenCalled();
    });
  });

  it("gates all three routes behind the online_ordering module", () => {
    expect(moduleGatesFor("POST", "/:id/items")).toContain("online_ordering");
    expect(moduleGatesFor("PATCH", "/:id/items/:itemId")).toContain(
      "online_ordering",
    );
    expect(moduleGatesFor("DELETE", "/:id/items/:itemId")).toContain(
      "online_ordering",
    );
  });
});
