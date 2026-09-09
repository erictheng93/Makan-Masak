import { beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeEventType } from "@makanmasak/shared-types";
import type { Order, OrderItem } from "@makanmasak/shared-types";
import { OrdersService } from "./OrdersService";

const createBaseOrder = vi.hoisted(() => vi.fn());
const getBaseOrder = vi.hoisted(() => vi.fn());
const getBaseOrders = vi.hoisted(() => vi.fn());
const updateBaseOrderStatus = vi.hoisted(() => vi.fn());
const addBaseOrderItems = vi.hoisted(() => vi.fn());
const changeBaseOrderItemQuantity = vi.hoisted(() => vi.fn());
const auditValues = vi.hoisted(() => vi.fn());
const auditInsert = vi.hoisted(() => vi.fn(() => ({ values: auditValues })));
const cancelBaseOrder = vi.hoisted(() => vi.fn());
const updateBaseOrderItemStatus = vi.hoisted(() => vi.fn());
const getDailyOrderStats = vi.hoisted(() => vi.fn());
const getBaseOrderStatistics = vi.hoisted(() => vi.fn());
const validateBaseCoupon = vi.hoisted(() => vi.fn());
const releaseCouponUsageForCancelledOrder = vi.hoisted(() => vi.fn());
const broadcastNewOrder = vi.hoisted(() => vi.fn());
const broadcastOrderStatusUpdate = vi.hoisted(() => vi.fn());
const broadcastOrderCancelled = vi.hoisted(() => vi.fn());
const generateEventId = vi.hoisted(() => vi.fn());
const createKitchenTicket = vi.hoisted(() => vi.fn());

vi.mock("../../pos/services/ReceiptService", () => ({
  ReceiptService: function ReceiptService() {
    return { createKitchenTicket };
  },
}));

vi.mock("@makanmasak/database", () => ({
  // #273 made logOrderActivity a real audit write instead of a console log, so
  // every OrdersService mutation now reaches these three. auditValues is the
  // assertion point: it receives the row that would have been inserted.
  AUDIT_ACTIONS: {
    ORDER_CREATE: "order_create",
    ORDER_UPDATE: "order_update",
    ORDER_CANCEL: "order_cancel",
    OTHER: "other",
  },
  auditLogs: { __table: "audit_logs" },
  createDatabase: () => ({ insert: auditInsert }),
  // Must mirror the real export: the service matches base-service errors
  // against this prefix, so a missing one turns every mapping test red.
  INVALID_CUSTOMIZATION_PREFIX: "Invalid customization:",
  // Same reason: RestaurantOrderPushService imports this, and
  // notifyNewOrderPush swallows the "not defined on the mock" throw, so
  // omitting it surfaces only as a push that silently never fires.
  isWebPushEnabled: (env: { WEB_PUSH_ENABLED?: string }) =>
    env.WEB_PUSH_ENABLED !== "false",
  OrderService: function OrderService() {
    return {
      createOrder: createBaseOrder,
      getOrder: getBaseOrder,
      getOrders: getBaseOrders,
      updateOrderStatus: updateBaseOrderStatus,
      addItemsToOrder: addBaseOrderItems,
      changeOrderItemQuantity: changeBaseOrderItemQuantity,
      cancelOrder: cancelBaseOrder,
      updateOrderItemStatus: updateBaseOrderItemStatus,
      getDailyOrderStats,
      getOrderStatistics: getBaseOrderStatistics,
    };
  },
  CouponService: function CouponService() {
    return {
      validateCoupon: validateBaseCoupon,
      releaseUsageForCancelledOrder: releaseCouponUsageForCancelledOrder,
    };
  },
  RealtimeBroadcastService: function RealtimeBroadcastService() {
    return {
      broadcastNewOrder,
      broadcastOrderStatusUpdate,
      broadcastOrderCancelled,
      generateEventId,
    };
  },
}));

function createEnv(
  options: {
    cacheGet?: (key: string, type?: "json") => Promise<unknown>;
  } = {},
) {
  const subscriptionKey =
    "push:subscription:restaurant-1:user-1:subscription-1";
  const pushDeliverer = vi.fn(async () => ({ ok: true, status: 201 }));

  return {
    DB: {},
    WEB_PUSH_ENABLED: "true",
    WEB_PUSH_DELIVERER: pushDeliverer,
    CACHE_KV: {
      get: vi.fn(async (key: string, type?: "json") => {
        if (options.cacheGet) return options.cacheGet(key, type);
        if (key !== subscriptionKey) return null;
        return {
          id: "subscription-1",
          userId: 10,
          username: "kitchen",
          userRole: 2,
          userType: "kitchen",
          restaurantId: "restaurant-1",
          subscription: {
            endpoint: "https://push.example/subscription-1",
            keys: {
              p256dh: "p256dh-key",
              auth: "auth-key",
            },
          },
          deviceInfo: {},
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:00:00.000Z",
        };
      }),
      list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => ({
        keys:
          prefix === "push:subscription:restaurant-1:"
            ? [{ name: subscriptionKey }]
            : [],
      })),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("OrdersService realtime broadcasts", () => {
  beforeEach(() => {
    createBaseOrder.mockReset();
    getBaseOrder.mockReset();
    getBaseOrders.mockReset();
    updateBaseOrderStatus.mockReset();
    addBaseOrderItems.mockReset();
    changeBaseOrderItemQuantity.mockReset();
    auditValues.mockReset();
    auditInsert.mockClear();
    cancelBaseOrder.mockReset();
    updateBaseOrderItemStatus.mockReset();
    getDailyOrderStats.mockReset();
    getBaseOrderStatistics.mockReset();
    validateBaseCoupon.mockReset();
    releaseCouponUsageForCancelledOrder.mockReset();
    releaseCouponUsageForCancelledOrder.mockResolvedValue(undefined);
    broadcastNewOrder.mockReset();
    broadcastOrderStatusUpdate.mockReset();
    broadcastOrderCancelled.mockReset();
    generateEventId.mockReset();
    generateEventId.mockReturnValue("evt-market-order");
    broadcastNewOrder.mockResolvedValue({
      success: true,
      eventId: "evt-market-order",
      recipientCount: 2,
    });
    broadcastOrderStatusUpdate.mockResolvedValue({
      success: true,
      eventId: "evt-status",
      recipientCount: 1,
    });
    broadcastOrderCancelled.mockResolvedValue({
      success: true,
      eventId: "evt-cancelled",
      recipientCount: 1,
    });
  });

  it("broadcasts market checkout child orders to restaurant and kitchen realtime rooms", async () => {
    createBaseOrder.mockResolvedValue({
      id: 1001,
      restaurantId: "restaurant-1",
      tableId: undefined,
      orderNumber: "A001",
      orderType: "shop",
      status: "pending",
      orderSource: "market_checkout",
      totalAmount: 120,
      customerInfo: { name: "Market Guest" },
      notes: "市場結帳：逢甲夜市 / fengjia / checkout-1",
      items: [
        {
          id: 501,
          menuItemId: 101,
          quantity: 2,
          unitPrice: 60,
          notes: "不要辣",
          menuItem: { name: "雞排" },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const env = createEnv();
    const service = new OrdersService(env as never);

    await service.createOrder({
      restaurantId: "restaurant-1",
      customerInfo: { name: "Market Guest" },
      items: [{ menuItemId: 101, quantity: 2, notes: "不要辣" }],
      notes: "市場結帳：逢甲夜市 / fengjia / checkout-1",
      orderSource: "market_checkout",
      orderType: "shop",
      deliveryInfo: { type: "takeaway" },
      isGuestOrder: true,
    });

    expect(createBaseOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        orderSource: "market_checkout",
        deliveryInfo: { type: "takeaway" },
      }),
    );
    expect(broadcastNewOrder).toHaveBeenCalledWith({
      type: RealtimeEventType.NEW_ORDER,
      eventId: "evt-market-order",
      timestamp: expect.any(Number),
      restaurantId: "restaurant-1",
      data: {
        orderId: 1001,
        orderNumber: "A001",
        tableId: undefined,
        items: [
          {
            orderItemId: 501,
            menuItemId: 101,
            menuItemName: "雞排",
            quantity: 2,
            price: 60,
            notes: "不要辣",
          },
        ],
        totalAmount: 120,
        orderSource: "market_checkout",
        notes: "市場結帳：逢甲夜市 / fengjia / checkout-1",
        customer: {
          name: "Market Guest",
          phone: undefined,
        },
      },
    });
    expect(env.WEB_PUSH_DELIVERER).toHaveBeenCalledWith({
      subscription: {
        id: "subscription-1",
        endpoint: "https://push.example/subscription-1",
        p256dhKey: "p256dh-key",
        authKey: "auth-key",
      },
      payload: expect.objectContaining({
        type: "new_order",
        orderId: 1001,
        orderNumber: "A001",
        orderSource: "market_checkout",
        title: "市場結帳新訂單",
        priority: "high",
        requireInteraction: true,
      }),
    });
  });

  it("carries the table number into the new-order event so the admin badge can render", async () => {
    createBaseOrder.mockResolvedValue({
      id: 1002,
      restaurantId: "restaurant-1",
      tableId: 7,
      table: { id: 7, number: "A7" },
      orderNumber: "A002",
      orderType: "table",
      status: "pending",
      totalAmount: 60,
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const service = new OrdersService(createEnv() as never);

    await service.createOrder({
      restaurantId: "restaurant-1",
      tableId: 7,
      orderType: "table",
      items: [{ menuItemId: 101, quantity: 1 }],
    });

    expect(broadcastNewOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tableId: "7", tableName: "A7" }),
      }),
    );
  });

  // 外送守門在資料庫服務層（orders / guest-orders / market-checkouts 都經過
  // 那裡），只丟一個哨兵訊息回來。沒有這層翻譯，一個「店家沒開外送」會變成
  // 500（#295）。
  it("turns the delivery gate into a 400 instead of an unhandled error", async () => {
    createBaseOrder.mockRejectedValue(new Error("DELIVERY_NOT_ENABLED"));
    const service = new OrdersService(createEnv() as never);

    await expect(
      service.createOrder({
        restaurantId: "restaurant-1",
        orderType: "shop",
        items: [{ menuItemId: 101, quantity: 1 }],
        deliveryInfo: { type: "delivery", address: "1 Jalan Test" },
      }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "DELIVERY_NOT_ENABLED",
    });
  });
});

function buildOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 501,
    orderId: "42",
    menuItemId: 101,
    quantity: 1,
    unitPrice: 100,
    totalPrice: 100,
    status: "pending",
    createdAt: Date.parse("2026-06-07T01:00:00.000Z"),
    updatedAt: Date.parse("2026-06-07T01:00:00.000Z"),
    ...overrides,
  };
}

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "42",
    restaurantId: "restaurant-1",
    tableId: 7,
    orderNumber: "ORD-42",
    orderType: "table",
    status: "confirmed",
    paymentStatus: "pending",
    paymentMethod: "cash",
    orderSource: "direct",
    subtotal: 200,
    taxAmount: 10,
    serviceCharge: 20,
    discountAmount: 15,
    totalAmount: 215,
    customerInfo: {
      name: "Ada",
      phone: "0912345678",
      email: "ada@example.test",
    },
    restaurant: {
      // restaurants.id is a TEXT UUID v7, not an integer.
      id: "restaurant-1",
      name: "Makan Test",
      address: "1 Test St",
      phone: "02-1234-5678",
      email: "shop@example.test",
    },
    table: {
      id: 7,
      number: "A7",
      seats: 4,
    },
    items: [
      {
        id: 501,
        orderId: "42",
        menuItemId: 101,
        quantity: 2,
        unitPrice: 100,
        totalPrice: 200,
        status: "pending",
        notes: "less ice",
        customizations: {
          size: { id: "size-1", name: "Large", priceAdjustment: 20 },
          options: [
            {
              id: "opt-2",
              optionName: "Sugar",
              choiceId: "choice-3",
              choiceName: "Half",
              priceAdjustment: 0,
            },
          ],
          addOns: [
            {
              id: "addon-4",
              name: "Pearls",
              unitPrice: 10,
              quantity: 2,
              totalPrice: 20,
            },
          ],
        },
        menuItem: { id: 101, name: "Milk Tea" },
        createdAt: Date.parse("2026-06-07T01:00:00.000Z"),
        updatedAt: Date.parse("2026-06-07T01:00:00.000Z"),
      },
    ],
    notes: "counter pickup",
    version: 3,
    // Order timestamps are Unix ms, not ISO text — see the wire-contract
    // assertion in the orders real-integration suite.
    createdAt: Date.parse("2026-06-07T01:00:00.000Z"),
    updatedAt: Date.parse("2026-06-07T01:10:00.000Z"),
    confirmedAt: Date.parse("2026-06-07T01:02:00.000Z"),
    preparingAt: null,
    readyAt: null,
    deliveredAt: null,
    paidAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

async function expectSilencedRejection(
  action: () => Promise<unknown>,
  match: Record<string, unknown>,
) {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    await expect(action()).rejects.toMatchObject(match);
  } finally {
    consoleError.mockRestore();
  }
}

describe("OrdersService workflows", () => {
  beforeEach(() => {
    createBaseOrder.mockReset();
    getBaseOrder.mockReset();
    getBaseOrders.mockReset();
    updateBaseOrderStatus.mockReset();
    addBaseOrderItems.mockReset();
    changeBaseOrderItemQuantity.mockReset();
    auditValues.mockReset();
    auditInsert.mockClear();
    cancelBaseOrder.mockReset();
    updateBaseOrderItemStatus.mockReset();
    getDailyOrderStats.mockReset();
    getBaseOrderStatistics.mockReset();
    validateBaseCoupon.mockReset();
    broadcastNewOrder.mockReset();
    broadcastOrderStatusUpdate.mockReset();
    broadcastOrderCancelled.mockReset();
    generateEventId.mockReset();
    generateEventId.mockReturnValue("evt-orders");
    broadcastNewOrder.mockResolvedValue({
      success: true,
      eventId: "evt-orders",
      recipientCount: 2,
    });
    broadcastOrderStatusUpdate.mockResolvedValue({
      success: true,
      eventId: "evt-status",
      recipientCount: 2,
    });
    broadcastOrderCancelled.mockResolvedValue({
      success: true,
      eventId: "evt-cancel",
      recipientCount: 2,
    });
  });

  it("validates direct create order inputs before delegating to the base service", async () => {
    const service = new OrdersService(createEnv() as never);
    const validOrder = {
      restaurantId: "restaurant-1",
      orderType: "table",
      items: [{ menuItemId: 101, quantity: 1 }],
    };

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...validOrder, restaurantId: "" }, "INVALID_RESTAURANT_ID"],
      [{ ...validOrder, items: [] }, "EMPTY_ORDER_ITEMS"],
      [
        {
          ...validOrder,
          items: Array.from({ length: 101 }, () => ({
            menuItemId: 101,
            quantity: 1,
          })),
        },
        "TOO_MANY_ORDER_ITEMS",
      ],
      [
        { ...validOrder, items: [{ menuItemId: 0, quantity: 1 }] },
        "INVALID_MENU_ITEM_ID",
      ],
      [
        { ...validOrder, items: [{ menuItemId: 101, quantity: 0 }] },
        "INVALID_ITEM_QUANTITY",
      ],
      [
        { ...validOrder, items: [{ menuItemId: 101, quantity: 1000 }] },
        "ITEM_QUANTITY_EXCEEDED",
      ],
      [
        { ...validOrder, customerInfo: { phone: "abc" } },
        "INVALID_PHONE_FORMAT",
      ],
      [
        { ...validOrder, customerInfo: { email: "not-email" } },
        "INVALID_EMAIL_FORMAT",
      ],
      [{ ...validOrder, notes: "x".repeat(1001) }, "NOTES_TOO_LONG"],
      [{ ...validOrder, couponCode: "AB" }, "INVALID_COUPON_CODE_FORMAT"],
    ];

    for (const [input, code] of cases) {
      await expectSilencedRejection(() => service.createOrder(input as never), {
        code,
      });
    }
    expect(createBaseOrder).not.toHaveBeenCalled();
  });

  it("maps waiting-list base service failures to API errors", async () => {
    const service = new OrdersService(createEnv() as never);
    const input = {
      restaurantId: "restaurant-1",
      orderType: "table",
      waitingListId: 55,
      items: [{ menuItemId: 101, quantity: 1 }],
    };
    createBaseOrder
      .mockRejectedValueOnce(new Error("WAITING_LIST_PREORDER_EXISTS"))
      .mockRejectedValueOnce(new Error("WAITING_LIST_TICKET_NOT_FOUND"))
      .mockRejectedValueOnce(new Error("WAITING_LIST_TICKET_NOT_ACTIVE"))
      .mockRejectedValueOnce(new Error("WAITING_LIST_PHONE_MISMATCH"));

    await expect(service.createOrder(input as never)).rejects.toMatchObject({
      code: "WAITING_LIST_PREORDER_EXISTS",
    });
    await expect(service.createOrder(input as never)).rejects.toMatchObject({
      code: "WAITING_LIST_TICKET_NOT_FOUND",
    });
    await expect(service.createOrder(input as never)).rejects.toMatchObject({
      code: "WAITING_LIST_TICKET_NOT_ACTIVE",
    });
    await expect(service.createOrder(input as never)).rejects.toMatchObject({
      code: "WAITING_LIST_PHONE_MISMATCH",
    });
  });

  // A refused selection is the request's fault. Left unmapped it reached the
  // customer as a 500, which the app can only show as a generic failure.
  it("answers 400 when the catalog refuses a customization", async () => {
    const service = new OrdersService(createEnv() as never);
    createBaseOrder.mockRejectedValueOnce(
      new Error(
        "Invalid customization: group spice is required for menu item 101",
      ),
    );

    await expect(
      service.createOrder({
        restaurantId: "restaurant-1",
        orderType: "table",
        items: [{ menuItemId: 101, quantity: 1 }],
      } as never),
    ).rejects.toMatchObject({
      code: "INVALID_CUSTOMIZATION",
      status: 400,
    });
  });

  it("filters list queries by caller restaurant and strips leaked rows", async () => {
    const env = createEnv();
    getBaseOrders.mockResolvedValue({
      orders: [
        createOrder({ id: "1", restaurantId: "restaurant-1" }),
        createOrder({ id: "2", restaurantId: "restaurant-2" }),
        createOrder({ id: "3", restaurantId: undefined }),
      ],
      pagination: { page: 2, limit: 5, total: 3, totalPages: 1 },
    });
    const service = new OrdersService(env as never);

    const result = await service.getOrders(
      {
        restaurantId: "restaurant-2",
        status: ["confirmed"],
        page: 2,
        limit: 5,
        sortBy: "createdAt",
        sortOrder: "desc",
      },
      "10",
      1,
      { userId: "10", userRole: 1, userRestaurantId: "restaurant-1" },
    );

    expect(getBaseOrders).toHaveBeenCalledWith(
      {
        restaurantId: "restaurant-1",
        customerId: undefined,
        status: ["confirmed"],
        tableId: undefined,
        dateRange: undefined,
        sortBy: "createdAt",
        sortOrder: "desc",
      },
      2,
      5,
    );
    expect(result.orders.map((order) => order.id)).toEqual(["1", "3"]);
    expect(result.total).toBe(3);
  });

  it("includes pending guest orders in active order queries", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrders.mockResolvedValue({
      orders: [
        createOrder({
          id: "1",
          restaurantId: "restaurant-1",
          status: "pending",
          orderSource: "direct",
        }),
      ],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    await expect(service.getActiveOrders("restaurant-1")).resolves.toHaveLength(
      1,
    );
    expect(getBaseOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        status: ["pending", "confirmed", "preparing", "ready"],
      }),
      1,
      100,
    );
  });

  it("converts complete date ranges for unroled callers", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrders.mockResolvedValue({
      orders: [createOrder({ id: "5", restaurantId: "restaurant-1" })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    // The canonical customer path (GET /api/v1/customers/me/orders) passes the
    // customerId itself and no role at all — that must keep working.
    await expect(
      service.getOrders({
        customerId: "customer-77",
        dateFrom: new Date("2026-06-01T00:00:00.000Z"),
        dateTo: new Date("2026-06-02T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ total: 1 });
    expect(getBaseOrders).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customerId: "customer-77",
        dateRange: [
          new Date("2026-06-01T00:00:00.000Z"),
          new Date("2026-06-02T00:00:00.000Z"),
        ],
      }),
      1,
      20,
    );
  });

  it("refuses list queries from the retired legacy customer role", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrders.mockResolvedValue({
      orders: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    // users.role=5 is retired: a users row id can never match the TEXT FK in
    // orders.customer_id, and with no userId the old branch fell open to an
    // unscoped, cross-tenant query. Both shapes must now be refused.
    await expect(service.getOrders({}, "77", 5)).rejects.toMatchObject({
      code: "LEGACY_CUSTOMER_ROLE_RETIRED",
      status: 403,
    });
    await expect(service.getOrders({}, undefined, 5)).rejects.toMatchObject({
      code: "LEGACY_CUSTOMER_ROLE_RETIRED",
    });
    await expect(
      service.getOrders({}, "77", undefined, {
        userId: "77",
        userRole: 5,
        userRestaurantId: undefined,
      }),
    ).rejects.toMatchObject({ code: "LEGACY_CUSTOMER_ROLE_RETIRED" });

    expect(getBaseOrders).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4] as const)(
    "refuses list queries from a role %i caller with no restaurant assignment",
    async (userRole) => {
      const service = new OrdersService(createEnv() as never);
      getBaseOrders.mockResolvedValue({
        orders: [
          createOrder({ id: "1", restaurantId: "restaurant-1" }),
          createOrder({ id: "2", restaurantId: "restaurant-2" }),
        ],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      });

      // A tenant-scoped role with no restaurantId has nothing to scope to. The
      // old branch returned the filters untouched, so the query ran unscoped —
      // and the post-query strip in getOrders is guarded by that same empty
      // restaurantId, so it did not catch the leak either (#306).
      await expect(
        service.getOrders({}, "10", userRole, {
          userId: "10",
          userRole,
          userRestaurantId: undefined,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

      await expect(
        service.getOrders({}, "10", userRole, {
          userId: "10",
          userRole,
          userRestaurantId: "   ",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(getBaseOrders).not.toHaveBeenCalled();
    },
  );

  it("enforces cached order restaurant access before returning data", async () => {
    const env = createEnv({
      cacheGet: async (key) =>
        key === "order:42:full"
          ? createOrder({ restaurantId: "restaurant-2" })
          : null,
    });
    const service = new OrdersService(env as never);

    await expect(
      service.getOrder("42", true, {
        userId: "10",
        userRole: 2,
        userRestaurantId: "restaurant-1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getBaseOrder).not.toHaveBeenCalled();
  });

  it("denies an unassigned tenant role access to an order", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrder.mockResolvedValue(
      createOrder({ restaurantId: "restaurant-2" }),
    );

    await expect(
      service.getOrder("42", true, {
        userId: "unassigned-owner",
        userRole: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updates order status with version guard, cache invalidation, and realtime event", async () => {
    const env = createEnv();
    const previous = createOrder({ status: "confirmed", version: 7 });
    const updated = createOrder({ status: "preparing", version: 8 });
    updateBaseOrderStatus.mockResolvedValue(updated);
    const service = new OrdersService(env as never);

    const result = await service.updateOrderStatus(
      "42",
      {
        status: "preparing",
        notes: "started",
        estimatedReadyTime: new Date("2026-06-07T01:25:00.000Z"),
      },
      "20",
      2,
      { userId: "20", userRole: 2, userRestaurantId: "restaurant-1" },
      previous as never,
    );

    expect(result).toBe(updated);
    expect(updateBaseOrderStatus).toHaveBeenCalledWith("42", {
      status: "preparing",
      notes: "started",
      expectedVersion: 7,
    });
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("order:42:full");
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("order:42:basic");
    expect(broadcastOrderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RealtimeEventType.ORDER_STATUS_UPDATE,
        restaurantId: "restaurant-1",
        data: expect.objectContaining({
          orderId: "42",
          previousStatus: "confirmed",
          status: "preparing",
          message: "started",
          updatedBy: { userId: "20", userName: "System", role: "admin" },
        }),
      }),
    );
  });

  it("clears guest active locks when status updates enter terminal states", async () => {
    const env = createEnv({
      cacheGet: async (key) =>
        key === "guest_active_lookup:42"
          ? "guest_active:restaurant-1:token:guest-token"
          : null,
    });
    // Claimed by the same crew member that completes it below: only the
    // claimant may transition an order to delivered (success criterion 4 of
    // docs/specs/2026-08-server-backed-delivery-claims.md).
    const previous = createOrder({
      status: "ready",
      version: 7,
      deliveryAssignedTo: "20",
    });
    const updated = createOrder({ status: "delivered", version: 8 });
    updateBaseOrderStatus.mockResolvedValue(updated);
    const service = new OrdersService(env as never);

    await service.updateOrderStatus(
      "42",
      { status: "delivered" },
      "20",
      3,
      { userId: "20", userRole: 3, userRestaurantId: "restaurant-1" },
      previous as never,
    );

    expect(env.CACHE_KV.get).toHaveBeenCalledWith("guest_active_lookup:42");
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      "guest_active:restaurant-1:token:guest-token",
    );
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("guest_active_lookup:42");
  });

  it("clears guest active locks when orders are cancelled through the service", async () => {
    const env = createEnv({
      cacheGet: async (key) =>
        key === "guest_active_lookup:42"
          ? "guest_active:restaurant-1:token:guest-token"
          : null,
    });
    const service = new OrdersService(env as never);
    cancelBaseOrder.mockResolvedValue(createOrder({ status: "cancelled" }));

    await service.cancelOrder("42", "Customer requested cancellation", "20");

    expect(cancelBaseOrder).toHaveBeenCalledWith(
      "42",
      "Customer requested cancellation",
    );
    expect(releaseCouponUsageForCancelledOrder).toHaveBeenCalledWith("42");
    expect(env.CACHE_KV.get).toHaveBeenCalledWith("guest_active_lookup:42");
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      "guest_active:restaurant-1:token:guest-token",
    );
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("guest_active_lookup:42");
  });

  it("maps non-cancellable order cancellations to a conflict error", async () => {
    const service = new OrdersService(createEnv() as never);
    cancelBaseOrder.mockRejectedValue(new Error("Order cannot be cancelled"));

    await expect(
      service.cancelOrder("42", "Already cancelled", "20"),
    ).rejects.toMatchObject({
      code: "ORDER_NOT_CANCELLABLE",
      status: 409,
    });
  });

  it("rejects invalid status transitions and unauthorized role changes", async () => {
    const service = new OrdersService(createEnv() as never);

    await expect(
      service.updateOrderStatus(
        "42",
        { status: "paid" },
        "20",
        4,
        undefined,
        createOrder({ status: "confirmed" }) as never,
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });

    await expect(
      service.updateOrderStatus(
        "42",
        { status: "ready" },
        "30",
        4,
        undefined,
        createOrder({ status: "preparing" }) as never,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateBaseOrderStatus).not.toHaveBeenCalled();
  });

  it("handles update, delete, and item-status service branches", async () => {
    const env = createEnv();
    const service = new OrdersService(env as never);

    const cachedOrder = createOrder({ id: "42" });
    const cachedEnv = createEnv({
      cacheGet: async (key) => (key === "order:42:basic" ? cachedOrder : null),
    });
    await expect(
      new OrdersService(cachedEnv as never).getOrder("42", false, {
        userId: "1",
        userRole: 0,
      }),
    ).resolves.toBe(cachedOrder);

    getBaseOrder.mockResolvedValueOnce(null);
    await expect(service.deleteOrder("404", "10")).resolves.toBe(false);

    getBaseOrder.mockResolvedValueOnce(createOrder({ status: "confirmed" }));
    await expectSilencedRejection(() => service.deleteOrder("42", "10"), {
      code: "ORDER_NOT_DELETABLE",
    });

    getBaseOrder.mockResolvedValueOnce(createOrder({ status: "pending" }));
    cancelBaseOrder.mockResolvedValueOnce(createOrder({ status: "cancelled" }));
    await expect(service.deleteOrder("42", "10")).resolves.toBe(true);
    expect(cancelBaseOrder).toHaveBeenCalledWith("42", "Order deleted");
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("order:42:full");
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("order:42:basic");

    updateBaseOrderItemStatus.mockRejectedValueOnce(
      new Error("Order item status conflict: stale version"),
    );
    await expect(service.updateItemStatus(501, "ready")).rejects.toMatchObject({
      code: "ORDER_ITEM_STATUS_CONFLICT",
    });
  });

  it("covers status history and search fallback paths", async () => {
    const env = createEnv();
    const service = new OrdersService(env as never);

    getBaseOrder.mockResolvedValueOnce(
      createOrder({
        status: "ready",
        notes: "ready for pickup",
        updatedAt: Date.parse("2026-06-07T01:25:00.000Z"),
      }),
    );
    await expect(service.getOrderStatusHistory("42")).resolves.toEqual([
      {
        status: "ready",
        timestamp: new Date("2026-06-07T01:25:00.000Z"),
        notes: "ready for pickup",
      },
    ]);

    getBaseOrder.mockResolvedValueOnce(null);
    await expect(service.getOrderStatusHistory("404")).resolves.toEqual([]);

    getBaseOrder.mockRejectedValueOnce(new Error("history backend down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(service.getOrderStatusHistory("500")).resolves.toEqual([]);
    } finally {
      consoleError.mockRestore();
    }

    getBaseOrders.mockRejectedValueOnce(new Error("search backend down"));
    const searchConsoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        service.searchOrders(
          { query: "ORD-42" },
          { restaurantId: "restaurant-1" },
        ),
      ).resolves.toEqual([]);
    } finally {
      searchConsoleError.mockRestore();
    }
  });

  it("summarizes bulk cancellations and unsupported bulk actions", async () => {
    const service = new OrdersService(createEnv() as never);
    cancelBaseOrder
      .mockResolvedValueOnce(createOrder({ id: "10", status: "cancelled" }))
      .mockResolvedValueOnce(null);

    const cancelResult = await service.bulkUpdateOrders(
      {
        batchId: "batch-cancel",
        action: "cancel",
        orderIds: ["10", "11"],
        data: { reason: "closing early" },
      },
      "99",
    );

    // Order 11 could not be cancelled. It counts against failedCount and is
    // reported in `errors` like any other failure — the counts have to add up
    // to totalOrders or a caller cannot tell a skipped order from an applied one.
    expect(cancelResult).toMatchObject({
      batchId: "batch-cancel",
      totalOrders: 2,
      successCount: 1,
      failedCount: 1,
    });
    expect(cancelResult.results).toEqual([
      { orderId: "10", success: true, data: expect.any(Object) },
      {
        orderId: "11",
        success: false,
        error: "Order not found or could not be actioned",
      },
    ]);
    expect(cancelResult.errors).toEqual([
      { orderId: "11", error: "Order not found or could not be actioned" },
    ]);

    const unsupported = await service.bulkUpdateOrders({
      batchId: "batch-export",
      action: "export",
      orderIds: ["12"],
    });

    expect(unsupported.failedCount).toBe(1);
    expect(unsupported.errors[0]).toMatchObject({
      orderId: "12",
      error: "Unsupported bulk operation: export",
    });
  });

  it("summarizes generated batch status updates", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1780790400000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    const service = new OrdersService(createEnv() as never);
    getBaseOrder
      .mockResolvedValueOnce(createOrder({ id: "20", status: "confirmed" }))
      .mockResolvedValueOnce(createOrder({ id: "21", status: "confirmed" }));
    updateBaseOrderStatus
      .mockResolvedValueOnce(createOrder({ id: "20", status: "preparing" }))
      .mockResolvedValueOnce(null);

    const result = await service.bulkUpdateOrders(
      {
        action: "update_status",
        orderIds: ["20", "21"],
        data: { status: "preparing", notes: "bulk start" },
      },
      "99",
      2,
    );

    expect(result).toMatchObject({
      batchId: "batch_1780790400000_4fzzzxjyl",
      totalOrders: 2,
      successCount: 1,
      failedCount: 1,
    });
    expect(result.results).toEqual([
      { orderId: "20", success: true, data: expect.any(Object) },
      {
        orderId: "21",
        success: false,
        error: "Failed to update order status",
      },
    ]);
    expect(updateBaseOrderStatus).toHaveBeenCalledWith("20", {
      status: "preparing",
      notes: "bulk start",
      expectedVersion: 3,
    });
  });

  it("keeps foreign orders out of an owner's bulk status update", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrder
      .mockResolvedValueOnce(
        createOrder({ id: "owner-order", restaurantId: "restaurant-1" }),
      )
      .mockResolvedValueOnce(
        createOrder({ id: "foreign-order", restaurantId: "restaurant-2" }),
      );
    updateBaseOrderStatus.mockResolvedValueOnce(
      createOrder({ id: "owner-order", status: "preparing" }),
    );

    const result = await service.bulkUpdateOrders(
      {
        action: "update_status",
        orderIds: ["owner-order", "foreign-order"],
        data: { status: "preparing" },
      },
      "owner-1",
      1,
      {
        userId: "owner-1",
        userRole: 1,
        userRestaurantId: "restaurant-1",
      },
    );

    expect(result).toMatchObject({ successCount: 1, failedCount: 1 });
    // Matched exactly, not by substring: the refusal must not name the order's
    // restaurant. A bulk request reports per-id outcomes for up to 100 ids, so
    // a message naming the owner is an `order id -> restaurant` oracle.
    expect(result.results).toEqual([
      { orderId: "owner-order", success: true, data: expect.any(Object) },
      {
        orderId: "foreign-order",
        success: false,
        error: "Access denied",
      },
    ]);
    expect(result.errors).toEqual([
      {
        orderId: "foreign-order",
        error: "Access denied",
      },
    ]);
    expect(updateBaseOrderStatus).toHaveBeenCalledTimes(1);
    expect(updateBaseOrderStatus).toHaveBeenCalledWith(
      "owner-order",
      expect.objectContaining({ status: "preparing" }),
    );
  });

  it("keeps foreign orders out of an owner's bulk cancellation", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrder
      .mockResolvedValueOnce(
        createOrder({ id: "owner-order", restaurantId: "restaurant-1" }),
      )
      .mockResolvedValueOnce(
        createOrder({ id: "foreign-order", restaurantId: "restaurant-2" }),
      );
    cancelBaseOrder.mockResolvedValueOnce(
      createOrder({ id: "owner-order", status: "cancelled" }),
    );

    const result = await service.bulkUpdateOrders(
      {
        action: "cancel",
        orderIds: ["owner-order", "foreign-order"],
      },
      "owner-1",
      1,
      {
        userId: "owner-1",
        userRole: 1,
        userRestaurantId: "restaurant-1",
      },
    );

    expect(result).toMatchObject({ successCount: 1, failedCount: 1 });
    expect(result.results).toEqual([
      { orderId: "owner-order", success: true, data: expect.any(Object) },
      {
        orderId: "foreign-order",
        success: false,
        error: "Access denied",
      },
    ]);
    expect(cancelBaseOrder).toHaveBeenCalledTimes(1);
    expect(cancelBaseOrder).toHaveBeenCalledWith(
      "owner-order",
      "Bulk cancellation",
    );
  });

  it("allows an admin to update orders across restaurants in bulk", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrder
      .mockResolvedValueOnce(
        createOrder({ id: "restaurant-1-order", restaurantId: "restaurant-1" }),
      )
      .mockResolvedValueOnce(
        createOrder({ id: "restaurant-2-order", restaurantId: "restaurant-2" }),
      );
    updateBaseOrderStatus
      .mockResolvedValueOnce(
        createOrder({ id: "restaurant-1-order", status: "preparing" }),
      )
      .mockResolvedValueOnce(
        createOrder({ id: "restaurant-2-order", status: "preparing" }),
      );

    const result = await service.bulkUpdateOrders(
      {
        action: "update_status",
        orderIds: ["restaurant-1-order", "restaurant-2-order"],
        data: { status: "preparing" },
      },
      "admin-1",
      0,
      { userId: "admin-1", userRole: 0 },
    );

    expect(result).toMatchObject({ successCount: 2, failedCount: 0 });
    expect(updateBaseOrderStatus).toHaveBeenCalledTimes(2);
  });

  it("does not let a bulk fulfilment update mark an order paid", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrder.mockResolvedValue(
      createOrder({ id: "20", status: "delivered" }),
    );
    const result = await service.bulkUpdateOrders(
      {
        batchId: "batch-owner-paid",
        action: "update_status",
        orderIds: ["20"],
        data: { status: "paid" },
      },
      "99",
      1,
    );

    expect(result).toMatchObject({
      successCount: 0,
      failedCount: 1,
      errors: [
        {
          orderId: "20",
          error: "Invalid status transition from delivered to paid",
        },
      ],
      results: [
        {
          orderId: "20",
          success: false,
        },
      ],
    });
    expect(updateBaseOrderStatus).not.toHaveBeenCalled();
  });

  it("builds analytics and popular item cache entries from base stats", async () => {
    const env = createEnv();
    getBaseOrderStatistics.mockResolvedValue({
      totalOrders: 12,
      totalRevenue: 2400,
      avgOrderValue: 200,
      pendingOrders: 1,
      completedOrders: 9,
    });
    getDailyOrderStats.mockResolvedValue({
      totalOrders: 12,
      totalRevenue: 2400,
      avgOrderValue: 200,
      pendingOrders: 1,
      completedOrders: 9,
    });
    const service = new OrdersService(env as never);

    const analytics = await service.getOrderAnalytics({
      restaurantId: "restaurant-1",
    });
    const stats = await service.getDailyStats(
      "restaurant-1",
      new Date("2026-06-07T00:00:00.000Z"),
    );
    const popularItems = await service.getPopularItems("restaurant-1", "week");

    expect(analytics.summary).toMatchObject({
      totalOrders: 12,
      totalRevenue: 2400,
      averageOrderValue: 200,
    });
    expect(stats).toMatchObject({
      totalOrders: 12,
      averageOrderValue: 200,
      preparingOrders: 0,
      readyOrders: 0,
    });
    expect(popularItems).toEqual([]);
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      'analytics:{"restaurantId":"restaurant-1"}',
      expect.any(String),
      { expirationTtl: 900 },
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "popular-items:restaurant-1:week",
      "[]",
      { expirationTtl: 1800 },
    );
  });

  it("gets all-time order statistics instead of reusing today's statistics", async () => {
    getBaseOrderStatistics.mockResolvedValue({
      totalOrders: 42,
      totalRevenue: 8400,
      avgOrderValue: 200,
      pendingOrders: 2,
      preparingOrders: 3,
      completedOrders: 35,
      cancelledOrders: 2,
    });
    const service = new OrdersService(createEnv() as never);

    await expect(
      service.getOrderStatistics("restaurant-1"),
    ).resolves.toMatchObject({
      totalOrders: 42,
      preparingOrders: 3,
      completedOrders: 35,
    });
    expect(getDailyOrderStats).not.toHaveBeenCalled();
  });

  it("uses cached analytics and rejects analytics without a restaurant", async () => {
    const cachedAnalytics = {
      summary: {
        totalOrders: 3,
        totalRevenue: 900,
        averageOrderValue: 300,
        averagePreparationTime: 0,
        orderCompletionRate: 1,
        customerRetentionRate: 0,
      },
      byStatus: [],
      byPaymentStatus: [],
      byOrderType: [],
      byTime: { hourly: [], daily: [], weekly: [], monthly: [] },
      topItems: [],
      customerAnalytics: {
        newCustomers: 0,
        returningCustomers: 0,
        averageOrdersPerCustomer: 0,
        customerLifetimeValue: 0,
      },
      performanceMetrics: {
        averageOrderProcessingTime: 0,
        peakHours: [],
        busyDays: [],
        orderAccuracy: 1,
        cancellationRate: 0,
      },
    };
    const env = createEnv({
      cacheGet: async (key) =>
        key === 'analytics:{"restaurantId":"restaurant-1"}'
          ? cachedAnalytics
          : null,
    });
    const service = new OrdersService(env as never);

    await expect(
      service.getOrderAnalytics({ restaurantId: "restaurant-1" }),
    ).resolves.toBe(cachedAnalytics);
    expect(getDailyOrderStats).not.toHaveBeenCalled();

    await expectSilencedRejection(() => service.getOrderAnalytics({}), {
      code: "RESTAURANT_ID_REQUIRED",
    });
  });

  it("maps coupon validation success and converts failures to invalid previews", async () => {
    const service = new OrdersService(createEnv() as never);
    validateBaseCoupon
      .mockResolvedValueOnce({
        valid: true,
        coupon: {
          code: "SAVE20",
          name: "Twenty off",
          discountType: "percentage",
          discountValue: 20,
        },
        discountAmount: 40,
        finalAmount: 160,
      })
      .mockRejectedValueOnce(new Error("coupon backend unavailable"));

    await expect(
      service.validateCoupon({
        restaurantId: "restaurant-1",
        couponCode: "SAVE20",
        orderAmount: 200,
        userId: "5",
        menuItems: [{ menuItemId: 101, quantity: 2 }],
      }),
    ).resolves.toEqual({
      valid: true,
      coupon: {
        code: "SAVE20",
        name: "Twenty off",
        discountType: "percentage",
        discountValue: 20,
      },
      originalAmount: 200,
      discountAmount: 40,
      finalAmount: 160,
      savings: 40,
      error: undefined,
    });

    await expect(
      service.previewCoupon({
        restaurantId: "restaurant-1",
        couponCode: "DOWN",
        orderAmount: 200,
      }),
    ).resolves.toMatchObject({
      valid: false,
      originalAmount: 200,
      discountAmount: 0,
      finalAmount: 200,
      error: "coupon backend unavailable",
    });
  });

  it("generates receipts with restaurant, table, payment, and customization details", async () => {
    const env = createEnv();
    getBaseOrder.mockResolvedValue(
      createOrder({
        restaurantId: "019fc320-c159-700c-a66c-39c9b98ed964",
        status: "delivered",
        // orders.payment_status is pending/completed/failed/refunded; "paid"
        // was never one of them.
        paymentStatus: "completed",
        paidAt: Date.parse("2026-06-07T01:30:00.000Z"),
        deliveredAt: Date.parse("2026-06-07T01:28:00.000Z"),
      }),
    );
    const service = new OrdersService(env as never);

    const receipt = await service.generateReceipt("42");

    expect(receipt).toMatchObject({
      orderNumber: "ORD-42",
      restaurantInfo: {
        // restaurants.id is a TEXT UUID v7; receipts must carry it verbatim
        // rather than through Number(), which yields NaN.
        id: "019fc320-c159-700c-a66c-39c9b98ed964",
        name: "Makan Test",
      },
      customerInfo: {
        name: "Ada",
      },
      tableInfo: {
        id: 7,
        number: "A7",
        seats: 4,
      },
      items: [
        {
          name: "Milk Tea",
          quantity: 2,
          unitPrice: 100,
          totalPrice: 200,
          customizations: ["Size: Large", "Sugar: Half", "Pearls x2"],
          notes: "less ice",
        },
      ],
      summary: {
        subtotal: 200,
        tax: 10,
        serviceCharge: 20,
        discount: 15,
        total: 215,
      },
      paymentInfo: {
        method: "cash",
        status: "completed",
      },
    });
    expect(receipt.timestamps.orderedAt).toEqual(
      new Date("2026-06-07T01:00:00.000Z"),
    );
    expect(receipt.timestamps.deliveredAt).toEqual(
      new Date("2026-06-07T01:28:00.000Z"),
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "order:42:full",
      expect.any(String),
      { expirationTtl: 300 },
    );
  });

  it("generates receipts with fallback restaurant, table, item, and payment fields", async () => {
    const env = createEnv();
    getBaseOrder.mockResolvedValue(
      createOrder({
        restaurantId: "019fc320-c159-700c-a66c-39c9b98ed965",
        restaurant: undefined,
        customerInfo: undefined,
        tableId: undefined,
        table: { id: 9, number: "", seats: 0 },
        paymentMethod: undefined,
        readyAt: Date.parse("2026-06-07T01:20:00.000Z"),
        items: [
          {
            id: 502,
            orderId: "42",
            menuItemId: 102,
            quantity: 1,
            unitPrice: 80,
            totalPrice: 80,
            status: "pending",
            notes: undefined,
            customizations: undefined,
            menuItem: undefined,
            createdAt: Date.parse("2026-06-07T01:00:00.000Z"),
            updatedAt: Date.parse("2026-06-07T01:00:00.000Z"),
          },
        ],
      }),
    );
    const service = new OrdersService(env as never);

    const receipt = await service.generateReceipt("42");

    expect(receipt).toMatchObject({
      restaurantInfo: {
        id: "019fc320-c159-700c-a66c-39c9b98ed965",
        name: "Restaurant",
      },
      customerInfo: {},
      tableInfo: {
        id: 9,
        number: "N/A",
        seats: 0,
      },
      items: [
        {
          name: "Unknown Item",
          quantity: 1,
          unitPrice: 80,
          totalPrice: 80,
          customizations: [],
          notes: undefined,
        },
      ],
      paymentInfo: {
        method: "cash",
        status: "pending",
        paidAt: undefined,
      },
    });
    expect(receipt.timestamps.readyAt).toEqual(
      new Date("2026-06-07T01:20:00.000Z"),
    );
    expect(receipt.timestamps.confirmedAt).toEqual(
      new Date("2026-06-07T01:02:00.000Z"),
    );
    expect(receipt.timestamps.deliveredAt).toBeUndefined();
  });

  it("adds order items through the base service and invalidates caches", async () => {
    const env = createEnv();
    const updated = createOrder({
      id: "42",
      status: "confirmed",
      items: [
        buildOrderItem({ id: 1, menuItemId: 100, quantity: 1 }),
        buildOrderItem({ id: 2, menuItemId: 101, quantity: 2 }),
      ],
    });
    addBaseOrderItems.mockResolvedValue(updated);
    const service = new OrdersService(env as never);
    const items = [{ menuItemId: 101, quantity: 2, notes: "extra" }];

    const result = await service.addItemsToOrder("42", items as never);

    expect(result).toBe(updated);
    expect(addBaseOrderItems).toHaveBeenCalledWith("42", items, undefined);
    expect(broadcastNewOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RealtimeEventType.NEW_ORDER,
        data: expect.objectContaining({ orderId: "42" }),
      }),
    );
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("order:42:full");
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("order:42:basic");
  });

  /**
   * #273. logOrderActivity was a stub that only console-logged, so orders had
   * never written an audit row at all. These pin the write down: without them
   * the method can quietly become a no-op again and every other test still
   * passes.
   */
  it("writes an audit row when items are added", async () => {
    const updated = createOrder({ id: "42", status: "confirmed" });
    addBaseOrderItems.mockResolvedValue(updated);
    const service = new OrdersService(createEnv() as never);

    await service.addItemsToOrder(
      "42",
      [{ menuItemId: 101, quantity: 2 }] as never,
      "user-7",
    );

    expect(auditValues).toHaveBeenCalledOnce();
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-7",
        action: "order_update",
        resource: "orders",
        resourceId: "42",
        restaurantId: updated.restaurantId,
        changes: expect.objectContaining({
          metadata: expect.objectContaining({ event: "ORDER_ITEMS_ADDED" }),
        }),
      }),
    );
  });

  it("records the before and after quantity when a line changes", async () => {
    const before = createOrder({
      id: "42",
      status: "confirmed",
      items: [buildOrderItem({ id: 7, menuItemId: 101, quantity: 3 })],
    });
    getBaseOrder.mockResolvedValue(before);
    changeBaseOrderItemQuantity.mockResolvedValue(
      createOrder({
        id: "42",
        status: "confirmed",
        items: [buildOrderItem({ id: 7, menuItemId: 101, quantity: 1 })],
      }),
    );
    const service = new OrdersService(createEnv() as never);

    await service.changeOrderItemQuantity("42", 7, 1, { userId: "user-7" });

    expect(changeBaseOrderItemQuantity).toHaveBeenCalledWith(
      "42",
      7,
      1,
      undefined,
    );
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "order_update",
        changes: expect.objectContaining({
          metadata: expect.objectContaining({
            event: "ORDER_ITEM_QUANTITY_CHANGED",
            orderItemId: 7,
            quantityBefore: 3,
            quantityAfter: 1,
          }),
        }),
      }),
    );
  });

  it("labels a removal distinctly from a quantity change", async () => {
    const before = createOrder({
      id: "42",
      status: "confirmed",
      items: [
        buildOrderItem({ id: 7, menuItemId: 101, quantity: 1 }),
        buildOrderItem({ id: 8, menuItemId: 102, quantity: 1 }),
      ],
    });
    getBaseOrder.mockResolvedValue(before);
    changeBaseOrderItemQuantity.mockResolvedValue(
      createOrder({
        id: "42",
        status: "confirmed",
        items: [buildOrderItem({ id: 8, menuItemId: 102, quantity: 1 })],
      }),
    );
    const service = new OrdersService(createEnv() as never);

    await service.changeOrderItemQuantity("42", 7, 0, { userId: "user-7" });

    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          metadata: expect.objectContaining({
            event: "ORDER_ITEM_REMOVED",
            quantityAfter: 0,
          }),
        }),
      }),
    );
  });

  it("does not fail the mutation when the audit write throws", async () => {
    const before = createOrder({
      id: "42",
      status: "confirmed",
      items: [
        buildOrderItem({ id: 7, menuItemId: 101, quantity: 2 }),
        buildOrderItem({ id: 8, menuItemId: 102, quantity: 1 }),
      ],
    });
    const after = createOrder({ id: "42", status: "confirmed" });
    getBaseOrder.mockResolvedValue(before);
    changeBaseOrderItemQuantity.mockResolvedValue(after);
    auditValues.mockRejectedValue(new Error("audit_logs unavailable"));
    const service = new OrdersService(createEnv() as never);

    // The order edit already committed; turning it into a 500 would invite a
    // retry that applies the change twice.
    await expect(
      service.changeOrderItemQuantity("42", 7, 1, { userId: "user-7" }),
    ).resolves.toBe(after);
  });

  it("broadcasts the corrected order so the kitchen screen re-reads it", async () => {
    const before = createOrder({
      id: "42",
      status: "confirmed",
      items: [
        buildOrderItem({ id: 7, menuItemId: 101, quantity: 3 }),
        buildOrderItem({ id: 8, menuItemId: 102, quantity: 1 }),
      ],
    });
    const after = createOrder({
      id: "42",
      status: "confirmed",
      items: [buildOrderItem({ id: 8, menuItemId: 102, quantity: 1 })],
    });
    getBaseOrder.mockResolvedValue(before);
    changeBaseOrderItemQuantity.mockResolvedValue(after);
    const env = createEnv();
    const service = new OrdersService(env as never);

    await service.changeOrderItemQuantity("42", 7, 0, { userId: "user-7" });

    // NEW_ORDER rather than a bespoke type: the kitchen store upserts by order
    // id, so the corrected item list replaces what the screen was holding.
    expect(broadcastNewOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RealtimeEventType.NEW_ORDER,
        data: expect.objectContaining({
          orderId: "42",
          items: [expect.objectContaining({ orderItemId: 8 })],
        }),
      }),
    );
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith("order:42:full");
  });

  it("refuses a caller from another restaurant before touching the order", async () => {
    getBaseOrder.mockResolvedValue(
      createOrder({
        id: "42",
        restaurantId: "restaurant-1",
        status: "confirmed",
        items: [buildOrderItem({ id: 7, menuItemId: 101, quantity: 2 })],
      }),
    );
    const service = new OrdersService(createEnv() as never);

    await expect(
      service.changeOrderItemQuantity("42", 7, 1, {
        caller: {
          userId: "user-9",
          userRole: 1,
          userRestaurantId: "restaurant-2",
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(changeBaseOrderItemQuantity).not.toHaveBeenCalled();
  });

  it("refuses an item id the order does not contain, before touching the base service", async () => {
    getBaseOrder.mockResolvedValue(
      createOrder({
        id: "42",
        status: "confirmed",
        items: [buildOrderItem({ id: 7, menuItemId: 101, quantity: 1 })],
      }),
    );
    const service = new OrdersService(createEnv() as never);

    await expect(
      service.changeOrderItemQuantity("42", 999, 1, { userId: "user-7" }),
    ).rejects.toMatchObject({ code: "ORDER_ITEM_NOT_FOUND" });
    expect(changeBaseOrderItemQuantity).not.toHaveBeenCalled();
  });

  it("maps the base service's version conflict to a 409, not a 500", async () => {
    getBaseOrder.mockResolvedValue(
      createOrder({
        id: "42",
        status: "confirmed",
        items: [buildOrderItem({ id: 7, menuItemId: 101, quantity: 2 })],
      }),
    );
    changeBaseOrderItemQuantity.mockRejectedValue(
      new Error("Order version conflict"),
    );
    const service = new OrdersService(createEnv() as never);

    await expect(
      service.changeOrderItemQuantity("42", 7, 1, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ status: 409, code: "ORDER_VERSION_CONFLICT" });
  });

  it("covers status update null, mismatch, version conflict, and failed update branches", async () => {
    const service = new OrdersService(createEnv() as never);

    getBaseOrder.mockResolvedValueOnce(null);
    await expect(
      service.updateOrderStatus("404", { status: "preparing" }, "20", 2),
    ).resolves.toBeNull();

    await expect(
      service.updateOrderStatus(
        "42",
        { status: "preparing" },
        "20",
        2,
        undefined,
        createOrder({ id: "99", status: "confirmed" }) as never,
      ),
    ).rejects.toMatchObject({ code: "ORDER_ID_MISMATCH" });

    updateBaseOrderStatus.mockRejectedValueOnce(
      new Error("Order version conflict: stale version"),
    );
    await expect(
      service.updateOrderStatus(
        "42",
        { status: "preparing" },
        "20",
        2,
        undefined,
        createOrder({ status: "confirmed", version: 7 }) as never,
      ),
    ).rejects.toMatchObject({ code: "ORDER_VERSION_CONFLICT" });

    updateBaseOrderStatus.mockResolvedValueOnce(null);
    await expect(
      service.updateOrderStatus(
        "42",
        { status: "preparing" },
        "20",
        2,
        undefined,
        createOrder({ status: "confirmed", version: 7 }) as never,
      ),
    ).rejects.toThrow("Failed to update order status");
  });

  it("refuses to mark a delivered order paid outside the payment flow", async () => {
    const service = new OrdersService(createEnv() as never);

    await expect(
      service.updateOrderStatus(
        "42",
        { status: "paid" },
        "20",
        1,
        undefined,
        createOrder({ status: "delivered", version: 7 }) as never,
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
    expect(updateBaseOrderStatus).not.toHaveBeenCalled();
  });

  it("checks caller restaurant access when cancelling orders", async () => {
    const env = createEnv();
    const service = new OrdersService(env as never);
    const order = createOrder({ status: "confirmed" });
    cancelBaseOrder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createOrder({ status: "cancelled" }));

    await expect(
      service.cancelOrder(
        "42",
        "guest changed mind",
        "20",
        { userId: "20", userRole: 2, userRestaurantId: "restaurant-1" },
        order as never,
      ),
    ).resolves.toBeNull();

    await expect(
      service.cancelOrder(
        "42",
        "guest changed mind",
        "20",
        { userId: "20", userRole: 2, userRestaurantId: "restaurant-1" },
        order as never,
      ),
    ).resolves.toMatchObject({ status: "cancelled" });
    expect(broadcastOrderCancelled).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RealtimeEventType.ORDER_CANCELLED,
        restaurantId: "restaurant-1",
        data: expect.objectContaining({
          orderId: "42",
          reason: "guest changed mind",
          cancelledBy: { userId: "20", userName: "System", role: "admin" },
        }),
      }),
    );

    await expect(
      service.cancelOrder(
        "42",
        "wrong shop",
        "20",
        { userId: "20", userRole: 2, userRestaurantId: "restaurant-2" },
        order as never,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("covers convenience list, popular item cache, receipt miss, and export branches", async () => {
    const cachedPopular = [
      { menuItemId: 101, name: "Milk Tea", quantity: 4, revenue: 400 },
    ];
    const env = createEnv({
      cacheGet: async (key) =>
        key === "popular-items:restaurant-1:month" ? cachedPopular : null,
    });
    const service = new OrdersService(env as never);
    getBaseOrders.mockResolvedValue({
      orders: [createOrder({ id: "1" })],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    getBaseOrderStatistics.mockResolvedValue({
      totalOrders: 3,
      totalRevenue: 600,
      avgOrderValue: 200,
      pendingOrders: 1,
      preparingOrders: 1,
      completedOrders: 1,
      cancelledOrders: 0,
    });

    await expect(
      service.getOrderStatistics("restaurant-1"),
    ).resolves.toMatchObject({
      totalOrders: 3,
      averageOrderValue: 200,
    });
    await expect(service.getActiveOrders("restaurant-1")).resolves.toHaveLength(
      1,
    );
    expect(getBaseOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        status: ["pending", "confirmed", "preparing", "ready"],
      }),
      1,
      100,
    );
    await expect(service.getPopularItems("restaurant-1")).resolves.toBe(
      cachedPopular,
    );
    await expect(
      service.searchOrders({ query: "ORD" }, { restaurantId: "restaurant-1" }),
    ).resolves.toHaveLength(1);
    getBaseOrder.mockResolvedValueOnce(null);
    await expect(service.generateReceipt("404")).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
    });
    await expect(service.exportOrders({}, "csv")).resolves.toEqual(
      Buffer.from(""),
    );
  });

  it("handles broadcast failure branches without failing order workflows", async () => {
    const service = new OrdersService(createEnv() as never);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      broadcastOrderStatusUpdate
        .mockResolvedValueOnce({
          success: false,
          error: "room unavailable",
        })
        .mockRejectedValueOnce(new Error("realtime down"));
      await expect(
        service["broadcastOrderStatusUpdate"](
          createOrder({ orderNumber: undefined, tableId: undefined }),
          "confirmed",
          "preparing",
          "",
        ),
      ).resolves.toBeUndefined();
      await expect(
        service["broadcastOrderStatusUpdate"](
          createOrder(),
          "confirmed",
          "preparing",
          "user-20",
        ),
      ).resolves.toBeUndefined();

      broadcastOrderCancelled
        .mockResolvedValueOnce({
          success: false,
          error: "cancel room unavailable",
        })
        .mockRejectedValueOnce(new Error("cancel down"));
      await expect(
        service["broadcastOrderCancelled"](
          createOrder({ orderNumber: undefined }),
          "customer request",
          "",
        ),
      ).resolves.toBeUndefined();
      await expect(
        service["broadcastOrderCancelled"](
          createOrder(),
          "customer request",
          "user-20",
        ),
      ).resolves.toBeUndefined();

      broadcastNewOrder.mockRejectedValueOnce(new Error("new order down"));
      await expect(
        service["broadcastNewOrder"](
          createOrder({
            orderNumber: undefined,
            tableId: undefined,
            customerInfo: undefined,
            items: [
              {
                id: 1,
                orderId: "42",
                menuItemId: 2,
                quantity: 1,
                unitPrice: 50,
                totalPrice: 50,
                status: "pending",
                notes: undefined,
                menuItem: undefined,
                createdAt: Date.parse("2026-06-07T01:00:00.000Z"),
                updatedAt: Date.parse("2026-06-07T01:00:00.000Z"),
              },
            ],
          }),
        ),
      ).resolves.toBeUndefined();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("formats receipt customization fallbacks without optional groups", async () => {
    const service = new OrdersService(createEnv() as never);

    expect(service["formatCustomizations"](null)).toEqual([]);
    expect(
      service["formatCustomizations"]({
        options: [
          {
            id: "opt-ice",
            optionName: "Ice",
            choiceId: "choice-less",
            choiceName: "Less",
          },
        ],
      }),
    ).toEqual(["Ice: Less"]);
    expect(
      service["formatCustomizations"]({
        addOns: [
          {
            id: "addon-pearls",
            name: "Pearls",
            unitPrice: 10,
            quantity: 3,
            totalPrice: 30,
          },
        ],
      }),
    ).toEqual(["Pearls x3"]);
  });

  it("rethrows non-conflict item status errors", async () => {
    const service = new OrdersService(createEnv() as never);
    updateBaseOrderItemStatus.mockRejectedValueOnce(new Error("db down"));

    await expect(service.updateItemStatus(501, "ready")).rejects.toThrow(
      "db down",
    );
  });
});

describe("OrdersService kitchen tickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createKitchenTicket.mockResolvedValue({ success: true });
  });

  it("queues a kitchen ticket when an order is confirmed", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrder.mockResolvedValue(
      createOrder({ id: "30", status: "pending" }),
    );
    updateBaseOrderStatus.mockResolvedValue(
      createOrder({ id: "30", status: "confirmed" }),
    );

    await service.updateOrderStatus("30", { status: "confirmed" }, "1", 1);

    expect(createKitchenTicket).toHaveBeenCalledWith("30");
  });

  it("does not queue one for any other transition", async () => {
    const service = new OrdersService(createEnv() as never);
    getBaseOrder.mockResolvedValue(
      createOrder({ id: "31", status: "confirmed" }),
    );
    updateBaseOrderStatus.mockResolvedValue(
      createOrder({ id: "31", status: "preparing" }),
    );

    await service.updateOrderStatus("31", { status: "preparing" }, "1", 2);

    expect(createKitchenTicket).not.toHaveBeenCalled();
  });

  it("still completes the status change when the ticket cannot be queued", async () => {
    // The order is already committed by this point. Failing the request would
    // leave the caller believing the transition did not happen.
    const service = new OrdersService(createEnv() as never);
    getBaseOrder.mockResolvedValue(
      createOrder({ id: "32", status: "pending" }),
    );
    updateBaseOrderStatus.mockResolvedValue(
      createOrder({ id: "32", status: "confirmed" }),
    );
    createKitchenTicket.mockRejectedValue(new Error("printer queue offline"));

    await expect(
      service.updateOrderStatus("32", { status: "confirmed" }, "1", 1),
    ).resolves.toMatchObject({ id: "32", status: "confirmed" });
  });
});
