import { beforeEach, describe, expect, it, vi } from "vitest";
import { KitchenService } from "./KitchenService";

const serviceMocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
  getDailyStats: vi.fn(),
  getOrder: vi.fn(),
  updateItemStatus: vi.fn(),
  updateOrderStatus: vi.fn(),
  ctor: vi.fn(),
  prepare: vi.fn(),
  bind: vi.fn(),
  first: vi.fn(),
  broadcastOrderItemStatusUpdate: vi.fn(),
  broadcastKitchenItemStatus: vi.fn(),
  generateEventId: vi.fn(),
}));

vi.mock("@makanmasak/database", () => ({
  RealtimeBroadcastService: vi.fn(function RealtimeBroadcastService() {
    return {
      broadcastOrderItemStatusUpdate:
        serviceMocks.broadcastOrderItemStatusUpdate,
      broadcastKitchenItemStatus: serviceMocks.broadcastKitchenItemStatus,
      generateEventId: serviceMocks.generateEventId,
    };
  }),
}));

vi.mock("../../orders/services/OrdersService", () => ({
  OrdersService: vi.fn(function OrdersService(...args: unknown[]) {
    serviceMocks.ctor(...args);
    return {
      getOrders: serviceMocks.getOrders,
      getDailyStats: serviceMocks.getDailyStats,
      getOrder: serviceMocks.getOrder,
      updateItemStatus: serviceMocks.updateItemStatus,
      updateOrderStatus: serviceMocks.updateOrderStatus,
    };
  }),
}));

function createService() {
  return new KitchenService({
    DB: {
      prepare: serviceMocks.prepare,
    },
  } as never);
}

function scopedKitchenItem(overrides: Record<string, unknown> = {}) {
  return {
    order_id: "order-101",
    order_number: "A001",
    order_created_at: "2026-06-07T11:40:00.000Z",
    table_id: 7,
    // The number printed on the table, which is what staff read. The id is a
    // database key: on production table A1 is id 2 and showed as "Table 2".
    table_number: "A1",
    item_id: 501,
    menu_item_id: 91,
    menu_item_name: "Laksa",
    previous_status: "pending",
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-101",
    orderNumber: "A001",
    restaurantId: "restaurant-1",
    tableId: 7,
    table: { id: 7, number: "A1" },
    status: "confirmed",
    version: 7,
    orderSource: "direct",
    items: [
      {
        id: 501,
        quantity: 2,
        status: "pending",
        notes: "less spicy",
        menuItem: { name: "Laksa" },
      },
    ],
    customerInfo: { name: "Aminah" },
    notes: "rush",
    createdAt: Date.now() - 10 * 60_000,
    ...overrides,
  };
}

describe("KitchenService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
    serviceMocks.getOrders.mockResolvedValue({ orders: [] });
    serviceMocks.getDailyStats.mockResolvedValue({
      totalOrders: 0,
      completedOrders: 0,
      averagePreparationTime: 0,
    });
    serviceMocks.updateItemStatus.mockResolvedValue(undefined);
    serviceMocks.getOrder.mockResolvedValue(order());
    serviceMocks.updateOrderStatus.mockImplementation(
      async (_orderId: string, statusData: { status: string }) =>
        order({ status: statusData.status, version: 8 }),
    );
    serviceMocks.first.mockResolvedValue(scopedKitchenItem());
    serviceMocks.bind.mockReturnValue({ first: serviceMocks.first });
    serviceMocks.prepare.mockReturnValue({ bind: serviceMocks.bind });
    serviceMocks.broadcastOrderItemStatusUpdate.mockResolvedValue({
      success: true,
      eventId: "evt-item-status",
      recipientCount: 2,
    });
    serviceMocks.broadcastKitchenItemStatus.mockResolvedValue({
      success: true,
      eventId: "evt-kitchen-status",
      recipientCount: 2,
    });
    serviceMocks.generateEventId
      .mockReturnValueOnce("evt-item-status")
      .mockReturnValueOnce("evt-kitchen-status");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.warn).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("groups kitchen orders and computes operational stats", async () => {
    serviceMocks.getOrders.mockResolvedValue({
      orders: [
        order({
          id: 101,
          orderNumber: "A001",
          status: "confirmed",
          createdAt: Date.now() - 10 * 60_000,
        }),
        order({
          id: 102,
          orderNumber: "A002",
          tableId: null,
          table: null,
          status: "preparing",
          orderSource: "market_checkout",
          items: [
            {
              id: 502,
              quantity: 1,
              status: undefined,
              notes: null,
              menuItem: null,
            },
          ],
          customerInfo: null,
          notes: undefined,
          createdAt: Date.now() - 40 * 60_000,
        }),
        order({
          id: 103,
          orderNumber: "A003",
          status: "ready",
          items: [],
          createdAt: Date.now() - 5 * 60_000,
        }),
      ],
    });
    serviceMocks.getDailyStats.mockResolvedValue({
      totalOrders: 8,
      completedOrders: 6,
      averagePreparationTime: 14,
    });

    const result = await createService().getKitchenOrders(
      "restaurant-1",
      "user-22",
    );

    expect(serviceMocks.ctor).toHaveBeenCalledWith({
      DB: {
        prepare: serviceMocks.prepare,
      },
    });
    expect(serviceMocks.getOrders).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      status: ["confirmed", "preparing", "ready"],
      limit: 100,
    });
    expect(serviceMocks.getDailyStats).toHaveBeenCalledWith("restaurant-1");
    expect(result.pending).toEqual([
      expect.objectContaining({
        id: 101,
        orderNumber: "A001",
        tableId: 7,
        tableName: "Table A1",
        status: "confirmed",
        customerName: "Aminah",
        totalItems: 2,
        elapsedTime: 10,
        items: [
          {
            id: 501,
            name: "Laksa",
            quantity: 2,
            status: "pending",
            notes: "less spicy",
            priority: "normal",
            estimatedTime: 15,
          },
        ],
      }),
    ]);
    expect(result.preparing).toEqual([
      expect.objectContaining({
        id: 102,
        tableId: 0,
        tableName: "No Table",
        customerName: "Guest",
        totalItems: 1,
        elapsedTime: 40,
        items: [
          expect.objectContaining({
            name: "Unknown Item",
            status: "pending",
            notes: "",
          }),
        ],
      }),
    ]);
    expect(result.ready).toEqual([
      expect.objectContaining({
        id: 103,
        totalItems: 0,
        elapsedTime: 5,
      }),
    ]);
    expect(result.stats).toEqual({
      pendingCount: 1,
      preparingCount: 1,
      readyCount: 1,
      completedToday: 6,
      averageCookingTime: 14,
      averageWaitingTime: 25,
      efficiency: 75,
      urgentOrders: 1,
    });
  });

  it("returns zeroed stats when there are no active kitchen orders", async () => {
    const result = await createService().getKitchenOrders("restaurant-1");

    expect(result).toEqual({
      pending: [],
      preparing: [],
      ready: [],
      stats: {
        pendingCount: 0,
        preparingCount: 0,
        readyCount: 0,
        completedToday: 0,
        averageCookingTime: 0,
        averageWaitingTime: 0,
        efficiency: 0,
        urgentOrders: 0,
      },
    });
  });

  it("updates item status and returns a timestamped response", async () => {
    const result = await createService().updateOrderItemStatus(
      "restaurant-1",
      "order-101",
      501,
      { status: "ready", notes: "plated" },
      "user-22",
    );

    expect(serviceMocks.updateItemStatus).toHaveBeenCalledWith(
      501,
      "ready",
      "plated",
    );
    expect(serviceMocks.prepare).toHaveBeenCalledWith(
      expect.stringContaining("JOIN orders o ON o.id = oi.order_id"),
    );
    expect(serviceMocks.bind).toHaveBeenCalledWith(
      501,
      "order-101",
      "restaurant-1",
    );
    expect(serviceMocks.getOrders).not.toHaveBeenCalled();
    expect(serviceMocks.broadcastOrderItemStatusUpdate).toHaveBeenCalledWith({
      type: "order_item_status_update",
      eventId: "evt-item-status",
      timestamp: new Date("2026-06-07T12:00:00.000Z").getTime(),
      restaurantId: "restaurant-1",
      data: {
        orderId: "order-101",
        orderItemId: 501,
        menuItemId: 91,
        menuItemName: "Laksa",
        status: "ready",
        previousStatus: "pending",
        updatedAt: new Date("2026-06-07T12:00:00.000Z").getTime(),
      },
    });
    expect(serviceMocks.broadcastKitchenItemStatus).toHaveBeenCalledWith({
      type: "kitchen_item_status",
      eventId: "evt-kitchen-status",
      timestamp: new Date("2026-06-07T12:00:00.000Z").getTime(),
      restaurantId: "restaurant-1",
      data: {
        orderId: "order-101",
        orderItemId: 501,
        menuItemName: "Laksa",
        status: "ready",
        tableName: "Table A1",
        priority: "high",
        waitingTime: 20,
      },
    });
    expect(result).toEqual({
      orderId: "order-101",
      itemId: 501,
      status: "ready",
      orderStatus: "confirmed",
      updatedAt: "2026-06-07T12:00:00.000Z",
    });
  });

  it("moves a confirmed order to preparing through OrdersService on the first started item", async () => {
    const prefetchedOrder = order({
      status: "confirmed",
      version: 7,
      items: [{ id: 501, status: "preparing" }],
    });
    const updatedOrder = order({ status: "preparing", version: 8 });
    serviceMocks.getOrder.mockResolvedValue(prefetchedOrder);
    serviceMocks.updateOrderStatus.mockResolvedValue(updatedOrder);

    const result = await createService().updateOrderItemStatus(
      "restaurant-1",
      "order-101",
      501,
      { status: "preparing" },
      "user-22",
    );

    expect(serviceMocks.updateOrderStatus).toHaveBeenCalledWith(
      "order-101",
      { status: "preparing" },
      "user-22",
      undefined,
      undefined,
      prefetchedOrder,
    );
    expect(result.orderStatus).toBe("preparing");
  });

  it("moves a preparing order to ready only after every item is ready", async () => {
    const prefetchedOrder = order({
      status: "preparing",
      version: 12,
      items: [
        { id: 501, status: "ready" },
        { id: 502, status: "ready" },
      ],
    });
    serviceMocks.first.mockResolvedValueOnce(
      scopedKitchenItem({ previous_status: "preparing" }),
    );
    serviceMocks.getOrder.mockResolvedValue(prefetchedOrder);
    serviceMocks.updateOrderStatus.mockResolvedValue(
      order({ status: "ready", version: 13 }),
    );

    const result = await createService().updateOrderItemStatus(
      "restaurant-1",
      "order-101",
      501,
      { status: "ready" },
      "user-22",
    );

    expect(serviceMocks.updateOrderStatus).toHaveBeenCalledWith(
      "order-101",
      { status: "ready" },
      "user-22",
      undefined,
      undefined,
      prefetchedOrder,
    );
    expect(result.orderStatus).toBe("ready");
  });

  it("accepts a same-status replay and returns the server parent status", async () => {
    serviceMocks.first.mockResolvedValueOnce(
      scopedKitchenItem({ previous_status: "preparing" }),
    );
    serviceMocks.getOrder.mockResolvedValue(order({ status: "preparing" }));

    const result = await createService().updateOrderItemStatus(
      "restaurant-1",
      "order-101",
      501,
      { status: "preparing" },
      "user-22",
    );

    expect(serviceMocks.updateItemStatus).not.toHaveBeenCalled();
    expect(serviceMocks.updateOrderStatus).not.toHaveBeenCalled();
    expect(serviceMocks.broadcastOrderItemStatusUpdate).not.toHaveBeenCalled();
    expect(result.orderStatus).toBe("preparing");
  });

  it("retries a parent version conflict and accepts the competing canonical status", async () => {
    const versionConflict = Object.assign(new Error("stale order"), {
      code: "ORDER_VERSION_CONFLICT",
    });
    serviceMocks.getOrder
      .mockResolvedValueOnce(
        order({
          status: "confirmed",
          version: 7,
          items: [{ id: 501, status: "preparing" }],
        }),
      )
      .mockResolvedValueOnce(order({ status: "preparing", version: 8 }));
    serviceMocks.updateOrderStatus.mockRejectedValueOnce(versionConflict);

    const result = await createService().updateOrderItemStatus(
      "restaurant-1",
      "order-101",
      501,
      { status: "preparing" },
      "user-22",
    );

    expect(serviceMocks.updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(serviceMocks.getOrder).toHaveBeenCalledTimes(2);
    expect(result.orderStatus).toBe("preparing");
  });

  it("rejects item status updates outside the scoped restaurant order", async () => {
    serviceMocks.first.mockResolvedValueOnce(null);

    await expect(
      createService().updateOrderItemStatus(
        "restaurant-1",
        "order-101",
        501,
        { status: "ready" },
        "user-22",
      ),
    ).rejects.toMatchObject({
      code: "KITCHEN_ITEM_SCOPE_DENIED",
    });

    expect(serviceMocks.updateItemStatus).not.toHaveBeenCalled();
    expect(serviceMocks.broadcastOrderItemStatusUpdate).not.toHaveBeenCalled();
  });

  it("validates kitchen role access", () => {
    const kitchenService = createService();

    expect(kitchenService.validateChefAccess("user-1", 0, "restaurant-1")).toBe(
      true,
    );
    expect(kitchenService.validateChefAccess("user-2", 1, "restaurant-1")).toBe(
      true,
    );
    expect(kitchenService.validateChefAccess("user-3", 2, "restaurant-1")).toBe(
      true,
    );
    expect(kitchenService.validateChefAccess("user-4", 3, "restaurant-1")).toBe(
      true,
    );
    expect(kitchenService.validateChefAccess("user-5", 4, "restaurant-1")).toBe(
      false,
    );
    expect(kitchenService.validateChefAccess("user-6", 5, "restaurant-1")).toBe(
      false,
    );
  });

  it("logs and rethrows order query and item update failures", async () => {
    serviceMocks.getOrders.mockRejectedValueOnce(new Error("orders down"));

    await expect(
      createService().getKitchenOrders("restaurant-1"),
    ).rejects.toThrow("orders down");

    serviceMocks.updateItemStatus.mockRejectedValueOnce(
      new Error("item update down"),
    );
    await expect(
      createService().updateOrderItemStatus(
        "restaurant-1",
        "order-101",
        501,
        { status: "completed" },
        "user-22",
      ),
    ).rejects.toThrow("item update down");
  });
});
