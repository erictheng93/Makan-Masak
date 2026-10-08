import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { kitchenApi } from "@/services/kitchenApi";
import { offlineService } from "@/services/offlineService";
import { useOrdersStore } from "./orders";
import type { KitchenOrder } from "@/types";

vi.mock("@/services/kitchenApi", () => ({
  kitchenApi: {
    getOrders: vi.fn(),
    startCooking: vi.fn(),
    markItemReady: vi.fn(),
    startAllItems: vi.fn(),
    markAllItemsReady: vi.fn(),
  },
}));

vi.mock("@/services/offlineService", () => ({
  offlineService: {
    isOnline: { value: true },
    queueAction: vi.fn(),
    cacheOrders: vi.fn(),
    getCachedOrders: vi.fn(() => []),
    setActiveRestaurant: vi.fn(),
  },
}));

const order = (status: KitchenOrder["items"][number]["status"]) => {
  const orderStatus: KitchenOrder["status"] =
    status === "pending"
      ? "confirmed"
      : status === "completed"
        ? "ready"
        : status;

  return {
    id: 1001,
    orderNumber: "A001",
    status: orderStatus,
    deliveryInfo: { type: "dine_in" },
    items: [
      {
        id: 501,
        name: "Noodles",
        quantity: 1,
        status,
        priority: "normal",
      },
    ],
    createdAt: "2026-06-08T01:00:00.000Z",
    totalItems: 1,
    priority: "normal",
    elapsedTime: 5,
  } satisfies KitchenOrder;
};

describe("orders store — fetch failures", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  /**
   * `error` is rendered, so it must not carry the server's own sentence. This
   * used to be `getErrorMessage(err)`, which returns exactly that whenever the
   * thrown value has a message.
   */
  it("stores localized copy rather than the server's sentence", async () => {
    vi.mocked(offlineService.isOnline).value = true;
    vi.mocked(kitchenApi.getOrders).mockRejectedValue(
      Object.assign(new Error("Internal detail: kitchen_orders view missing"), {
        response: {
          status: 503,
          data: {
            success: false,
            error: {
              code: "SOMETHING_INTERNAL",
              message: "Internal detail: kitchen_orders view missing",
            },
          },
        },
      }),
    );

    const store = useOrdersStore();
    await store.fetchOrders("restaurant-1");

    expect(store.error).toBeTruthy();
    expect(store.error).not.toContain("kitchen_orders");
    expect(store.error).not.toContain("Internal detail");
  });
});

describe("orders store actions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    offlineService.isOnline.value = true;
    vi.stubGlobal("navigator", { onLine: true });
  });

  it("applies successful online start and ready actions", async () => {
    const store = useOrdersStore();
    store.orders = [order("pending")];
    vi.mocked(kitchenApi.startCooking).mockResolvedValue({
      success: true,
      data: {
        orderId: 1001,
        itemId: 501,
        status: "preparing",
        orderStatus: "preparing",
        updatedAt: "2026-06-08T01:00:00.000Z",
      },
      timestamp: "2026-06-08T01:00:00.000Z",
    });
    vi.mocked(kitchenApi.markItemReady).mockResolvedValue({
      success: true,
      data: {
        orderId: 1001,
        itemId: 501,
        status: "ready",
        orderStatus: "ready",
        updatedAt: "2026-06-08T01:00:00.000Z",
      },
      timestamp: "2026-06-08T01:00:00.000Z",
    });

    await store.startCooking("restaurant-1", 1001, 501);
    expect(store.orders[0].status).toBe("preparing");
    expect(store.orders[0].items[0].status).toBe("preparing");

    await store.markReady("restaurant-1", 1001, 501);
    expect(store.orders[0].status).toBe("ready");
    expect(store.orders[0].items[0].status).toBe("ready");
  });

  it("throws API errors without applying failed online actions", async () => {
    const store = useOrdersStore();
    store.orders = [order("pending")];
    vi.mocked(kitchenApi.startCooking).mockResolvedValue({
      success: false,
      error: "status conflict",
      timestamp: "2026-06-08T01:00:00.000Z",
    });

    await expect(store.startCooking("restaurant-1", 1001, 501)).rejects.toThrow(
      "status conflict",
    );

    expect(store.orders[0].status).toBe("confirmed");
    expect(store.orders[0].items[0].status).toBe("pending");
  });

  it("uses batch APIs online and leaves missing/no-op orders unchanged", async () => {
    const store = useOrdersStore();
    store.orders = [order("pending")];
    vi.mocked(kitchenApi.startAllItems).mockResolvedValue({
      success: true,
      timestamp: "2026-06-08T01:00:00.000Z",
    });
    vi.mocked(kitchenApi.markAllItemsReady).mockResolvedValue({
      success: true,
      timestamp: "2026-06-08T01:00:00.000Z",
    });

    await store.startAllItems("restaurant-1", 1001);
    await store.startAllItems("restaurant-1", 9999);
    await store.markAllReady("restaurant-1", 1001);

    expect(kitchenApi.startAllItems).toHaveBeenCalledWith(
      "restaurant-1",
      1001,
      [501],
    );
    expect(kitchenApi.markAllItemsReady).not.toHaveBeenCalled();
  });

  it("keeps direct item helpers from inferring a parent order status", () => {
    const store = useOrdersStore();
    store.orders = [order("pending")];
    store.error = "old error";

    expect(store.getOrderById(1001)?.orderNumber).toBe("A001");
    store.updateItemStatus(1001, 501, "preparing");
    expect(store.orders[0].status).toBe("confirmed");
    expect(store.stats.pendingCount).toBe(1);

    store.updateOrderStatus("1001", "ready");
    expect(store.orders[0].status).toBe("ready");

    store.clearError();
    expect(store.error).toBeNull();

    store.clearOrders();
    expect(store.orders).toEqual([]);

    store.orders = [order("pending")];
    store.reset();
    expect(store.orders).toEqual([]);
    expect(store.stats.pendingCount).toBe(0);
    expect(store.lastUpdated).toBeNull();
  });

  it("waits for the realtime parent event instead of deriving it from an item", () => {
    const store = useOrdersStore();
    store.orders = [order("pending")];

    store.handleSSEEvent({
      type: "order_item_status_update",
      eventId: "evt-item-status",
      timestamp: "2026-06-08T01:02:00.000Z",
      restaurantId: "restaurant-1",
      data: {
        orderId: 1001,
        orderItemId: 501,
        menuItemId: 91,
        menuItemName: "Noodles",
        status: "preparing",
        previousStatus: "pending",
        updatedAt: "2026-06-08T01:02:00.000Z",
      },
    });

    expect(store.orders[0].status).toBe("confirmed");
    expect(store.orders[0].items[0]).toMatchObject({
      id: 501,
      status: "preparing",
      startedAt: "2026-06-08T01:02:00.000Z",
    });

    store.handleSSEEvent({
      type: "order_status_update",
      eventId: "evt-order-status",
      timestamp: "2026-06-08T01:02:01.000Z",
      restaurantId: "restaurant-1",
      data: {
        orderId: 1001,
        status: "preparing",
      },
    });

    expect(store.orders[0].status).toBe("preparing");
  });
});
