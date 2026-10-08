import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrdersStore } from "./orders";
import { kitchenApi } from "@/services/kitchenApi";
import { offlineService } from "@/services/offlineService";
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
    isOnline: { value: false },
    queueAction: vi.fn(),
    cacheOrders: vi.fn(),
    getCachedOrders: vi.fn(() => []),
    setActiveRestaurant: vi.fn(),
  },
}));

const order = (status: KitchenOrder["items"][number]["status"]) =>
  ({
    id: 1001,
    orderNumber: "A001",
    status: status === "ready" ? "preparing" : "confirmed",
    deliveryInfo: { type: "dine_in" },
    items: [
      {
        id: 501,
        name: "Beef Noodles",
        quantity: 1,
        status,
        priority: "normal",
      },
    ],
    createdAt: "2026-06-08T01:00:00.000Z",
    totalItems: 1,
    priority: "normal",
    elapsedTime: 5,
    totalAmount: 120,
  }) satisfies KitchenOrder;

const mixedOrder = () =>
  ({
    ...order("pending"),
    items: [
      {
        id: 501,
        name: "Beef Noodles",
        quantity: 1,
        status: "pending",
        priority: "normal",
      },
      {
        id: 502,
        name: "Dumplings",
        quantity: 1,
        status: "preparing",
        priority: "normal",
      },
    ],
  }) satisfies KitchenOrder;

describe("orders store offline workflow", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    offlineService.isOnline.value = false;
    vi.mocked(offlineService.getCachedOrders).mockReturnValue([]);
  });

  it("caches fetched orders for offline recovery", async () => {
    const store = useOrdersStore();
    const cachedOrder = order("pending");
    vi.mocked(kitchenApi.getOrders).mockResolvedValue({
      success: true,
      data: {
        pending: [cachedOrder],
        preparing: [],
        ready: [],
        stats: {
          pendingCount: 1,
          preparingCount: 0,
          readyCount: 0,
          completedToday: 0,
          averageCookingTime: 0,
          averageWaitingTime: 0,
          efficiency: 0,
          urgentOrders: 0,
        },
      },
      timestamp: "2026-06-08T01:00:00.000Z",
    });

    await store.fetchOrders("restaurant-1");

    expect(offlineService.setActiveRestaurant).toHaveBeenCalledWith(
      "restaurant-1",
    );
    expect(offlineService.cacheOrders).toHaveBeenCalledWith(
      [cachedOrder],
      "restaurant-1",
    );
    expect(store.orders).toEqual([cachedOrder]);
  });

  it("loads cached orders when offline fetching fails", async () => {
    const store = useOrdersStore();
    const cachedOrder = order("pending");
    vi.mocked(kitchenApi.getOrders).mockResolvedValue({
      success: false,
      error: "Network Error",
      timestamp: "2026-06-08T01:00:00.000Z",
    });
    vi.mocked(offlineService.getCachedOrders).mockReturnValue([cachedOrder]);

    await store.fetchOrders("restaurant-1");

    expect(offlineService.getCachedOrders).toHaveBeenCalledWith("restaurant-1");
    expect(store.orders).toEqual([cachedOrder]);
    expect(store.error).toBeNull();
  });

  it("scopes the offline cache to the requested restaurant on every fetch", async () => {
    const store = useOrdersStore();
    vi.mocked(kitchenApi.getOrders).mockResolvedValue({
      success: false,
      error: "Network Error",
      timestamp: "2026-06-08T01:00:00.000Z",
    });

    await store.fetchOrders("restaurant-2");

    // Cache is bound to the tenant before it is read, so a device previously
    // used by restaurant-1 cannot fall back onto restaurant-1's orders.
    expect(offlineService.setActiveRestaurant).toHaveBeenCalledWith(
      "restaurant-2",
    );
    expect(offlineService.getCachedOrders).toHaveBeenCalledWith("restaurant-2");
    expect(offlineService.getCachedOrders).not.toHaveBeenCalledWith();
    expect(store.orders).toEqual([]);
  });

  it("queues start cooking and updates local state while offline", async () => {
    const store = useOrdersStore();
    store.orders = [order("pending")];

    await store.startCooking("restaurant-1", 1001, 501);

    expect(kitchenApi.startCooking).not.toHaveBeenCalled();
    expect(offlineService.queueAction).toHaveBeenCalledWith(
      "start_cooking",
      1001,
      { restaurantId: "restaurant-1", status: "preparing" },
      501,
    );
    expect(store.orders[0].status).toBe("confirmed");
    expect(store.orders[0].items[0].status).toBe("preparing");
    expect(store.orders[0].items[0].startedAt).toBeTruthy();
  });

  it("queues mark ready and updates local state while offline", async () => {
    const store = useOrdersStore();
    store.orders = [order("preparing")];

    await store.markReady("restaurant-1", 1001, 501);

    expect(kitchenApi.markItemReady).not.toHaveBeenCalled();
    expect(offlineService.queueAction).toHaveBeenCalledWith(
      "mark_ready",
      1001,
      { restaurantId: "restaurant-1", status: "ready" },
      501,
    );
    expect(store.orders[0].status).toBe("confirmed");
    expect(store.orders[0].items[0].status).toBe("ready");
    expect(store.orders[0].items[0].completedAt).toBeTruthy();
  });

  it("queues all pending items when batch starting while offline", async () => {
    const store = useOrdersStore();
    store.orders = [mixedOrder()];

    await store.startAllItems("restaurant-1", 1001);

    expect(kitchenApi.startAllItems).not.toHaveBeenCalled();
    expect(offlineService.queueAction).toHaveBeenCalledTimes(1);
    expect(offlineService.queueAction).toHaveBeenCalledWith(
      "start_cooking",
      1001,
      { restaurantId: "restaurant-1", status: "preparing" },
      501,
    );
    expect(store.orders[0].status).toBe("confirmed");
    expect(store.orders[0].items[0].status).toBe("preparing");
    expect(store.orders[0].items[1].status).toBe("preparing");
  });

  it("queues all preparing items when batch completing while offline", async () => {
    const store = useOrdersStore();
    store.orders = [mixedOrder()];

    await store.markAllReady("restaurant-1", 1001);

    expect(kitchenApi.markAllItemsReady).not.toHaveBeenCalled();
    expect(offlineService.queueAction).toHaveBeenCalledTimes(1);
    expect(offlineService.queueAction).toHaveBeenCalledWith(
      "mark_ready",
      1001,
      { restaurantId: "restaurant-1", status: "ready" },
      502,
    );
    expect(store.orders[0].status).toBe("confirmed");
    expect(store.orders[0].items[0].status).toBe("pending");
    expect(store.orders[0].items[1].status).toBe("ready");
  });
});
