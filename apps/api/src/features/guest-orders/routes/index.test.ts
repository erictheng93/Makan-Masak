import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import routes from "./index";
import { ApiError } from "../../../shared/utils/api-error";
import { GUEST_ORDER_THROTTLE } from "../services/guest-order-throttle";
import { orders, restaurants, seats, tables } from "@makanmasak/database";

const databaseMocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  selectFixtures: new Map<unknown, unknown[][]>(),
}));
const createOrder = vi.hoisted(() => vi.fn());
const getOrder = vi.hoisted(() => vi.fn());
const updateOrder = vi.hoisted(() => vi.fn());
const addItemsToOrder = vi.hoisted(() => vi.fn());
const cancelOrder = vi.hoisted(() => vi.fn());
const enforceQuota = vi.hoisted(() => vi.fn());
const meterEmit = vi.hoisted(() => vi.fn());

vi.mock("@makanmasak/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@makanmasak/database")>()),
  createDatabase: databaseMocks.createDatabase,
}));

vi.mock("../../../middleware/quotaGate", () => ({
  enforceQuota,
}));

vi.mock("../../../shared/utils/meter", () => ({
  meterEmit,
}));

vi.mock("../../../middleware/guestAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middleware/guestAuth")>()),
  generateGuestToken: () => "gt_test_token",
  guestTokenAuth: async (
    c: {
      req: {
        param: (name: string) => string;
        header: (name: string) => string | undefined;
      };
      set: (key: "guestOrder", value: unknown) => void;
    },
    next: () => Promise<void>,
  ) => {
    c.set("guestOrder", {
      orderId: c.req.param("id"),
      restaurantId: "restaurant-1",
      guestName: "Guest",
      phoneLastDigits: "678",
      createdAt: 1780308000000,
    });
    await next();
  },
}));

vi.mock("../../orders/services/OrdersService", () => ({
  OrdersService: function OrdersService() {
    return {
      createOrder,
      getOrder,
      updateOrder,
      addItemsToOrder,
      cancelOrder,
    };
  },
}));

/**
 * Select fixtures are keyed by table, not by call order: `from(table)` decides
 * which queue a query draws from, so adding a query against one table can no
 * longer shift another table's results out from under it.
 *
 * Two things still need care when the code under test grows a new query:
 *
 * - Within a single table the queue is positional. The Nth read of a table
 *   takes that table's Nth fixture, so a new query means inserting a fixture
 *   at the matching index rather than appending one at the end.
 * - A table has to be listed in `fixtureTables` before it can be declared. An
 *   unregistered table matches no queue, so every read of it throws.
 *
 * Missing and exhausted fixtures both throw and name the table. Nothing falls
 * back to `[]`; a silent empty result is what made the previous positional
 * queues so hard to trace back to their cause.
 *
 * These throws reach the route's error handler and come back as a 500, so an
 * unexplained 500 in this suite is usually an undeclared fixture rather than a
 * route bug.
 */
type SelectFixtureName = "orders" | "restaurants" | "seats" | "tables";
const fixtureTables: Record<SelectFixtureName, unknown> = {
  orders,
  restaurants,
  seats,
  tables,
};
const fixtureTableNames = new Map<unknown, SelectFixtureName>(
  Object.entries(fixtureTables).map(([name, table]) => [
    table,
    name as SelectFixtureName,
  ]),
);
function setSelectFixtures(
  fixtures: Partial<Record<SelectFixtureName, unknown[][]>>,
) {
  databaseMocks.selectFixtures = new Map(
    Object.entries(fixtures).map(([name, results]) => [
      fixtureTables[name as SelectFixtureName],
      [...(results ?? [])],
    ]),
  );
}

function createMockDb() {
  const createSelectChain = () => {
    let selectedTable: unknown;
    const chain = {
      from: vi.fn((table: unknown) => {
        selectedTable = table;
        return chain;
      }),
      where: vi.fn(() => chain),
      get: vi.fn(async () => {
        const name = fixtureTableNames.get(selectedTable) ?? "<unknown table>";
        const queue = databaseMocks.selectFixtures.get(selectedTable);
        if (!queue) throw new Error(`Missing select fixture for ${name}`);
        const result = queue.shift();
        if (result === undefined) {
          throw new Error(`No select fixtures remaining for ${name}`);
        }
        return result[0];
      }),
    };
    return chain;
  };

  return { select: vi.fn(() => createSelectChain()) };
}

function createEnv(
  options: {
    customer?: Record<string, unknown> | null;
    rateLimitKV?: Map<string, string> | null;
  } = {},
) {
  const kv = new Map<string, string>();
  // Absent by default so the existing cases keep exercising the ordering path
  // rather than the throttle; the throttle fails open without it.
  const rateLimitStore = options.rateLimitKV ?? null;
  return {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => options.customer ?? null),
        })),
      })),
    },
    CACHE_KV: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kv.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        kv.delete(key);
      }),
    },
    RATE_LIMIT_KV: rateLimitStore
      ? {
          get: vi.fn(async (key: string) => rateLimitStore.get(key) ?? null),
          put: vi.fn(async (key: string, value: string) => {
            rateLimitStore.set(key, value);
          }),
          delete: vi.fn(async (key: string) => {
            rateLimitStore.delete(key);
          }),
        }
      : undefined,
  };
}

async function customerToken(customerId: string) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { sub: customerId, type: "customer", iat: now, exp: now + 3600 },
    "test-jwt-secret-with-at-least-32-chars",
  );
}

function validGuestOrderBody(overrides: Record<string, unknown> = {}) {
  return {
    restaurantId: "restaurant-1",
    guestName: "Guest",
    phoneLastDigits: "678",
    orderType: "shop",
    items: [{ menuItemId: 101, quantity: 2 }],
    ...overrides,
  };
}

function activeGuestRestaurant(overrides: Record<string, unknown> = {}) {
  return {
    id: "restaurant-1",
    isActive: true,
    isAvailable: true,
    enableShopMode: true,
    settings: { allowGuestOrders: true },
    ...overrides,
  };
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

function createRoutesWithApiErrorHandler() {
  const app = new Hono();
  app.route("/", routes);
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details !== undefined && { details: error.details }),
          },
        },
        error.status as never,
      );
    }
    throw error;
  });
  return app;
}

// A well-formed guest token (`gt_` + 32-byte hex). The route only rebuilds a
// lock key from tokens that match that shape, so cancel-path tests must use a
// realistic one rather than a placeholder string.
const CANCELLING_GUEST_TOKEN = `gt_${"c".repeat(64)}`;

describe("guest order routes", () => {
  beforeEach(() => {
    databaseMocks.selectFixtures = new Map();
    databaseMocks.createDatabase.mockReset();
    databaseMocks.createDatabase.mockReturnValue(createMockDb());
    createOrder.mockReset();
    getOrder.mockReset();
    updateOrder.mockReset();
    addItemsToOrder.mockReset();
    cancelOrder.mockReset();
    enforceQuota.mockReset();
    meterEmit.mockReset();
  });

  it("routes select fixtures by table and reports missing fixtures", async () => {
    setSelectFixtures({
      restaurants: [[{ id: "restaurant-1" }]],
      tables: [[{ id: 10 }]],
    });
    const db = createMockDb();

    // Read in the reverse of the declaration order: routing follows the table
    // passed to from(), never the order the queries happen to run in.
    await expect(db.select().from(tables).get()).resolves.toEqual({ id: 10 });
    await expect(db.select().from(restaurants).get()).resolves.toEqual({
      id: "restaurant-1",
    });
    await expect(db.select().from(tables).get()).rejects.toThrow(
      "No select fixtures remaining for tables",
    );
    await expect(db.select().from(seats).get()).rejects.toThrow(
      "Missing select fixture for seats",
    );
  });

  it("creates guest shop orders and stores guest access keys", async () => {
    setSelectFixtures({
      restaurants: [
        [
          {
            id: "restaurant-1",
            isActive: true,
            isAvailable: true,
            enableShopMode: true,
            settings: { allowGuestOrders: true },
          },
        ],
      ],
    });
    createOrder.mockResolvedValue({
      id: 501,
      orderNumber: "G001",
      status: "pending",
      totalAmount: 240,
    });
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.10" },
        body: JSON.stringify(validGuestOrderBody({ notes: "no peanuts" })),
      }),
      env as never,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        guestToken: "gt_test_token",
        order: { id: 501, orderNumber: "G001" },
      },
    });
    expect(enforceQuota).toHaveBeenCalledWith(
      expect.anything(),
      "orders.created",
      { restaurantId: "restaurant-1" },
    );
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        tableId: undefined,
        customerId: undefined,
        customerInfo: { name: "Guest" },
        orderType: "shop",
        deliveryInfo: { type: "takeaway" },
        isGuestOrder: true,
      }),
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "guest_token:gt_test_token",
      expect.stringContaining('"orderId":"501"'),
      { expirationTtl: 14400 },
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "guest_active:restaurant-1:token:gt_test_token",
      "501",
      { expirationTtl: 7200 },
    );
    expect(meterEmit).toHaveBeenCalledWith(
      expect.anything(),
      "orders.created",
      {
        restaurantId: "restaurant-1",
        metadata: { orderId: 501, source: "guest-orders" },
      },
    );
  });

  it("assigns a guest order to the authenticated customer", async () => {
    setSelectFixtures({ restaurants: [[activeGuestRestaurant()]] });
    createOrder.mockResolvedValue({ id: 502, orderNumber: "G002" });
    const customerId = "customer-1";
    const env = createEnv({
      customer: {
        id: customerId,
        display_name: "Customer",
        primary_phone: null,
        primary_email: null,
        status: "active",
      },
    });

    const response = await routes.fetch(
      new Request("https://test/", {
        method: "POST",
        headers: { Authorization: `Bearer ${await customerToken(customerId)}` },
        body: JSON.stringify(validGuestOrderBody()),
      }),
      {
        ...env,
        JWT_SECRET: "test-jwt-secret-with-at-least-32-chars",
      } as never,
    );

    expect(response.status).toBe(201);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ customerId }),
    );
  });

  it.each([
    ["the owner has switched guest ordering off", { allowGuestOrders: false }],
    ["the restaurant has no settings at all", null],
    ["settings exist but never opted in", {}],
  ])("refuses to create an order when %s", async (_case, settings) => {
    // This gate is what makes guest ordering opt-in, and it is the only thing
    // standing between a restaurant that never enabled it and an anonymous
    // order. The route reads `!== true` rather than a falsy check, so an
    // absent settings object and an absent key have to fail the same way as an
    // explicit false — hence all three cases, not just the obvious one.
    setSelectFixtures({ restaurants: [[activeGuestRestaurant({ settings })]] });

    const response = await createRoutesWithApiErrorHandler().fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify(validGuestOrderBody()),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { message: expect.stringContaining("not enabled") },
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("refuses shop orders once the owner turns shop mode off", async () => {
    // The printed sticker keeps working otherwise: nothing else on this path
    // reads enableShopMode, and a shop that skips the pickup-digits screen
    // never touches the QR verify endpoint that does.
    setSelectFixtures({
      restaurants: [[activeGuestRestaurant({ enableShopMode: false })]],
    });

    const response = await createRoutesWithApiErrorHandler().fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify(validGuestOrderBody()),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "SHOP_MODE_DISABLED" },
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("throttles a flood of guest orders aimed at one restaurant", async () => {
    // Rejected before any database work — the flooder should not get to spend
    // a D1 read per attempt.
    const env = createEnv({ rateLimitKV: new Map() });
    const app = createRoutesWithApiErrorHandler();
    const burstLimit = Math.ceil(
      GUEST_ORDER_THROTTLE.requests * GUEST_ORDER_THROTTLE.burstMultiplier,
    );
    setSelectFixtures({
      restaurants: Array.from({ length: burstLimit }, () => [
        activeGuestRestaurant(),
      ]),
    });

    const send = () =>
      app.fetch(
        new Request("https://test/", {
          method: "POST",
          headers: { "cf-connecting-ip": "203.0.113.10" },
          body: JSON.stringify(validGuestOrderBody()),
        }),
        env as never,
      );

    for (let i = 0; i < burstLimit; i += 1) {
      createOrder.mockResolvedValue({ id: 600 + i, orderNumber: `G${i}` });
      expect((await send()).status).toBe(201);
    }

    const blocked = await send();

    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toMatchObject({
      success: false,
      error: { code: "GUEST_ORDER_RATE_LIMITED" },
    });
    expect(createOrder).toHaveBeenCalledTimes(burstLimit);
    // The rejected attempt never reached the restaurant lookup.
    expect(databaseMocks.selectFixtures.get(restaurants)).toHaveLength(0);
  });

  it("refuses a sticker the owner has regenerated away from", async () => {
    setSelectFixtures({
      restaurants: [
        [activeGuestRestaurant({ shopQrCode: "SHOP-restaurant-1-1785563580" })],
      ],
    });

    const response = await createRoutesWithApiErrorHandler().fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify(
          validGuestOrderBody({ shopQrCode: "SHOP-restaurant-1-1780000000" }),
        ),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "SHOP_QR_REVOKED" },
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("accepts the sticker that is currently live", async () => {
    setSelectFixtures({
      restaurants: [
        [activeGuestRestaurant({ shopQrCode: "SHOP-restaurant-1-1785563580" })],
      ],
    });
    createOrder.mockResolvedValue({ id: 503, orderNumber: "G003" });

    const response = await routes.fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify(
          validGuestOrderBody({ shopQrCode: "SHOP-restaurant-1-1785563580" }),
        ),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(201);
    expect(createOrder).toHaveBeenCalledOnce();
  });

  it("still accepts table orders from a shop with shop mode off", async () => {
    // enableShopMode governs the shop QR channel only — dine-in at a table is
    // a different channel and must not be collateral damage.
    setSelectFixtures({
      restaurants: [[activeGuestRestaurant({ enableShopMode: false })]],
      tables: [[{ id: 3, restaurantId: "restaurant-1" }]],
    });
    createOrder.mockResolvedValue({ id: 502, orderNumber: "G002" });

    const response = await routes.fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify(
          validGuestOrderBody({ orderType: "table", tableId: 3 }),
        ),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(201);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderType: "table", tableId: 3 }),
    );
  });

  it("rejects invalid create requests and active duplicate guest orders", async () => {
    const invalidEnv = createEnv();
    const app = createRoutesWithApiErrorHandler();
    const invalidResponse = await app.fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify(validGuestOrderBody({ items: [] })),
      }),
      invalidEnv as never,
    );

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: [
          {
            field: "items",
            code: "too_small",
          },
        ],
      },
    });
    expect(enforceQuota).not.toHaveBeenCalled();

    const duplicateEnv = createEnv();
    const activeGuestToken =
      "gt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await duplicateEnv.CACHE_KV.put(
      `guest_active:restaurant-1:token:${activeGuestToken}`,
      "501",
    );
    setSelectFixtures({ restaurants: [[activeGuestRestaurant()]] });

    const duplicateResponse = await app.fetch(
      new Request("https://test/", {
        method: "POST",
        headers: { Authorization: `Bearer ${activeGuestToken}` },
        body: JSON.stringify(validGuestOrderBody()),
      }),
      duplicateEnv as never,
    );

    expect(duplicateResponse.status).toBe(429);
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "ACTIVE_GUEST_ORDER_EXISTS",
        message:
          "You already have an active order at this restaurant. Please wait for it to complete.",
      },
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("locks on the device id when the shopper presents one", async () => {
    // A guest token identifies one order — a market checkout mints one per
    // vendor and the app can only carry one of them — so the device id, not
    // the bearer token, is the identity the lock hangs off.
    const deviceId = "01890a5d-ac96-774b-bcce-b302099a8057";
    const env = createEnv();
    await env.CACHE_KV.put(
      `guest_active:restaurant-1:device:${deviceId}`,
      "501",
    );
    setSelectFixtures({ restaurants: [[activeGuestRestaurant()]] });
    const app = createRoutesWithApiErrorHandler();

    const response = await app.fetch(
      new Request("https://test/", {
        method: "POST",
        headers: {
          "X-Guest-Device-Id": deviceId,
          Authorization: `Bearer gt_${"b".repeat(64)}`,
        },
        body: JSON.stringify(validGuestOrderBody()),
      }),
      env as never,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "ACTIVE_GUEST_ORDER_EXISTS" },
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("writes the new order's lock under the device id", async () => {
    const deviceId = "01890a5d-ac96-774b-bcce-b302099a8057";
    setSelectFixtures({ restaurants: [[activeGuestRestaurant()]] });
    createOrder.mockResolvedValueOnce({ id: 501, orderNumber: "G001" });
    const env = createEnv();
    const app = createRoutesWithApiErrorHandler();

    const response = await app.fetch(
      new Request("https://test/", {
        method: "POST",
        headers: { "X-Guest-Device-Id": deviceId },
        body: JSON.stringify(validGuestOrderBody()),
      }),
      env as never,
    );

    expect(response.status).toBe(201);
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      `guest_active:restaurant-1:device:${deviceId}`,
      "501",
      { expirationTtl: 7200 },
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "guest_active_lookup:501",
      `guest_active:restaurant-1:device:${deviceId}`,
      { expirationTtl: 7200 },
    );
  });

  it("does not block separate anonymous guests sharing the same restaurant, table, and IP", async () => {
    setSelectFixtures({
      restaurants: [[activeGuestRestaurant()], [activeGuestRestaurant()]],
      tables: [
        [{ id: 7, restaurantId: "restaurant-1" }],
        [{ id: 7, restaurantId: "restaurant-1" }],
      ],
    });
    createOrder
      .mockResolvedValueOnce({ id: 501, orderNumber: "G001" })
      .mockResolvedValueOnce({ id: 502, orderNumber: "G002" });
    const app = createRoutesWithApiErrorHandler();
    const env = createEnv();
    const body = validGuestOrderBody({
      phoneLastDigits: "000",
      orderType: "table",
      tableId: 7,
    });

    const firstResponse = await app.fetch(
      new Request("https://test/", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.10" },
        body: JSON.stringify(body),
      }),
      env as never,
    );
    const secondResponse = await app.fetch(
      new Request("https://test/", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.10" },
        body: JSON.stringify(body),
      }),
      env as never,
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(createOrder).toHaveBeenCalledTimes(2);
  });

  it("validates restaurant, table, and seat availability before creating", async () => {
    setSelectFixtures({
      restaurants: [[activeGuestRestaurant({ isAvailable: false })]],
    });

    const unavailableResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify(validGuestOrderBody()),
        }),
        createEnv() as never,
      ),
    );
    expect(unavailableResponse.status).toBe(500);

    setSelectFixtures({
      restaurants: [[activeGuestRestaurant()]],
      tables: [[{ id: 7, restaurantId: "restaurant-2" }]],
    });
    const tableResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify(
            validGuestOrderBody({ orderType: "table", tableId: 7 }),
          ),
        }),
        createEnv() as never,
      ),
    );
    expect(tableResponse.status).toBe(500);

    setSelectFixtures({
      restaurants: [[activeGuestRestaurant()]],
      tables: [[{ id: 7, restaurantId: "restaurant-1" }]],
      seats: [[{ id: 11, tableId: 8 }]],
    });
    const seatResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify(
            validGuestOrderBody({
              orderType: "seat",
              tableId: 7,
              seatId: 11,
            }),
          ),
        }),
        createEnv() as never,
      ),
    );
    expect(seatResponse.status).toBe(500);
    expect(createOrder).not.toHaveBeenCalled();
  });

  // The route used to recognise "Menu item N is not available" by regex and
  // build its own 409. `prepareOrderItems` now throws the ApiError itself
  // (#352), so the only correct thing left to do here is get out of the way:
  // rewrapping would discard the details that name the item.
  it("passes a menu-item rejection through with its code and details intact", async () => {
    setSelectFixtures({ restaurants: [[activeGuestRestaurant()]] });
    createOrder.mockRejectedValue(
      new ApiError(
        "MENU_ITEM_UNAVAILABLE",
        "Menu item 101 is not available",
        409,
        { menuItemId: 101, name: "Nasi Lemak" },
      ),
    );

    const response = await withSilencedRouteError(() =>
      createRoutesWithApiErrorHandler().fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify(validGuestOrderBody()),
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "MENU_ITEM_UNAVAILABLE",
        details: { menuItemId: 101, name: "Nasi Lemak" },
      },
    });
  });

  it("returns guest order details for token-authenticated guests", async () => {
    getOrder.mockResolvedValue({
      id: 501,
      orderNumber: "G001",
      status: "pending",
    });

    const response = await routes.fetch(
      new Request("https://test/501", {
        headers: { Authorization: "Bearer gt_test_token" },
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { order: { id: 501 } },
    });
    expect(getOrder).toHaveBeenCalledWith("501", true);
  });

  it("validates guest item additions and order state", async () => {
    const invalidResponse = await createRoutesWithApiErrorHandler().fetch(
      new Request("https://test/501/items", {
        method: "POST",
        body: JSON.stringify({ items: [] }),
      }),
      createEnv() as never,
    );
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: [
          {
            field: "items",
            code: "too_small",
          },
        ],
      },
    });

    getOrder.mockResolvedValueOnce({
      id: 501,
      status: "ready",
      items: [],
    });
    const stateResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/501/items", {
          method: "POST",
          body: JSON.stringify({ items: [{ menuItemId: 101, quantity: 1 }] }),
        }),
        createEnv() as never,
      ),
    );
    expect(stateResponse.status).toBe(500);

    getOrder.mockResolvedValueOnce({
      id: 501,
      status: "pending",
      notes: "existing",
      items: Array.from({ length: 20 }, (_, index) => ({ id: index + 1 })),
    });
    const limitResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/501/items", {
          method: "POST",
          body: JSON.stringify({ items: [{ menuItemId: 101, quantity: 1 }] }),
        }),
        createEnv() as never,
      ),
    );
    expect(limitResponse.status).toBe(500);
  });

  it("adds items to pending guest orders", async () => {
    getOrder.mockResolvedValueOnce({
      id: 501,
      status: "confirmed",
      notes: "existing",
      items: [{ id: 1 }],
    });
    addItemsToOrder.mockResolvedValue({
      id: 501,
      status: "confirmed",
      notes: "existing",
      items: [{ id: 1 }, { id: 2, menuItemId: 101, quantity: 1 }],
    });
    const addedItems = [{ menuItemId: 101, quantity: 1, notes: "extra" }];

    const response = await routes.fetch(
      new Request("https://test/501/items", {
        method: "POST",
        body: JSON.stringify({ items: addedItems }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      message: "Items added successfully",
      data: { order: { id: 501 } },
    });
    expect(addItemsToOrder).toHaveBeenCalledWith("501", addedItems);
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it("cancels pending guest orders and clears guest access keys", async () => {
    getOrder.mockResolvedValue({
      id: 501,
      status: "pending",
    });
    cancelOrder.mockResolvedValue({
      id: 501,
      status: "cancelled",
    });
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/501/cancel", {
        method: "POST",
        headers: { Authorization: `Bearer ${CANCELLING_GUEST_TOKEN}` },
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      message: "Order cancelled successfully",
      data: { order: { status: "cancelled" } },
    });
    expect(cancelOrder).toHaveBeenCalledWith("501", "Cancelled by guest");
    // No reverse lookup is stored, so the lock key is rebuilt from the token
    // this request presented — the same token that created the order.
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      `guest_active:restaurant-1:token:${CANCELLING_GUEST_TOKEN}`,
    );
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("guest_active_lookup:501");
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      `guest_token:${CANCELLING_GUEST_TOKEN}`,
    );
  });

  it("prefers the reverse lookup over the rebuilt key on guest cancel", async () => {
    getOrder.mockResolvedValue({
      id: 501,
      status: "pending",
    });
    cancelOrder.mockResolvedValue({
      id: 501,
      status: "cancelled",
    });
    const env = createEnv();
    // The device rotated its token since the order was created (it ordered
    // again elsewhere), so the key stored at creation is the authority.
    const creationKey = `guest_active:restaurant-1:token:gt_${"b".repeat(64)}`;
    await env.CACHE_KV.put("guest_active_lookup:501", creationKey);

    const response = await routes.fetch(
      new Request("https://test/501/cancel", {
        method: "POST",
        headers: { Authorization: `Bearer ${CANCELLING_GUEST_TOKEN}` },
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(creationKey);
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("guest_active_lookup:501");
    expect(env.CACHE_KV.delete).not.toHaveBeenCalledWith(
      `guest_active:restaurant-1:token:${CANCELLING_GUEST_TOKEN}`,
    );
  });

  it("rejects cancelling completed guest orders", async () => {
    getOrder.mockResolvedValue({
      id: 501,
      status: "completed",
    });

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/501/cancel", {
          method: "POST",
          headers: { Authorization: "Bearer gt_test_token" },
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(500);
    expect(cancelOrder).not.toHaveBeenCalled();
  });
});
