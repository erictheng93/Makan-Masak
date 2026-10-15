import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/services/authApi";
import { offlineService } from "./offlineService";
import type { KitchenOrder } from "@/types";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["log"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

vi.mock("@/services/authApi", () => ({
  apiClient: {
    put: vi.fn(),
    post: vi.fn(),
  },
}));

describe("offlineService kitchen action replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    offlineService.clearOfflineData();
    offlineService.setActiveRestaurant("restaurant-1");
    offlineService.isOnline.value = false;
  });

  it("replays queued kitchen item actions through the real update endpoint", async () => {
    vi.mocked(apiClient.put).mockResolvedValue({
      data: { success: true },
    } as never);

    offlineService.queueAction(
      "start_cooking",
      1001,
      { restaurantId: "restaurant-1", status: "preparing" },
      501,
    );

    offlineService.isOnline.value = true;
    await offlineService.syncPendingActions();

    expect(apiClient.put).toHaveBeenCalledWith(
      "/kitchen/restaurant-1/orders/1001/items/501",
      { status: "preparing" },
      { validateStatus: expect.any(Function) },
    );
    expect(offlineService.pendingActions.value).toHaveLength(0);
  });

  it("keeps queued actions when replay fails", async () => {
    vi.mocked(apiClient.put).mockResolvedValue({
      data: { success: false, error: "server unavailable" },
    } as never);

    offlineService.queueAction(
      "mark_ready",
      1001,
      { restaurantId: "restaurant-1", status: "ready" },
      501,
    );

    offlineService.isOnline.value = true;
    await offlineService.syncPendingActions();

    expect(apiClient.put).toHaveBeenCalledWith(
      "/kitchen/restaurant-1/orders/1001/items/501",
      { status: "ready" },
      { validateStatus: expect.any(Function) },
    );
    expect(offlineService.pendingActions.value).toHaveLength(1);
    expect(offlineService.pendingActions.value[0]).toMatchObject({
      type: "mark_ready",
      orderId: 1001,
      itemId: 501,
      retryCount: 1,
      error: "server unavailable",
    });
  });

  it("applies queued item actions to cached orders locally", () => {
    const cachedOrder: KitchenOrder = {
      id: 1001,
      orderNumber: "A001",
      status: "confirmed",
      deliveryInfo: { type: "dine_in" },
      items: [
        {
          id: 501,
          name: "Noodles",
          quantity: 1,
          status: "pending",
          priority: "normal",
        },
      ],
      createdAt: "2026-06-08T01:00:00.000Z",
      totalItems: 1,
      priority: "normal",
      elapsedTime: 0,
    };
    offlineService.cacheOrders([cachedOrder]);

    offlineService.applyActionLocally({
      id: "action-1",
      type: "start_cooking",
      orderId: 1001,
      itemId: 501,
      payload: { restaurantId: "restaurant-1", status: "preparing" },
      timestamp: Date.now(),
      synced: false,
      retryCount: 0,
    });

    expect(offlineService.getCachedOrders()[0]).toMatchObject({
      status: "preparing",
      items: [{ id: 501, status: "preparing" }],
    });
  });

  it("applies cached batch operations and repairs derived order fields", () => {
    offlineService.cacheOrders([
      {
        id: 1001,
        orderNumber: "A001",
        status: "confirmed",
        deliveryInfo: { type: "dine_in" },
        items: [
          {
            id: 501,
            name: "Noodles",
            quantity: 1,
            status: "pending",
            priority: "normal",
          },
          {
            id: 502,
            name: "Soup",
            quantity: 1,
            status: "pending",
            priority: "normal",
          },
        ],
        createdAt: "2026-06-08T01:00:00.000Z",
        totalItems: 2,
        priority: "" as KitchenOrder["priority"],
        elapsedTime: 0,
      },
    ]);

    offlineService.applyActionLocally({
      id: "action-2",
      type: "batch_operation",
      orderId: 1001,
      payload: { operation: "start_all" },
      timestamp: Date.now(),
      synced: false,
      retryCount: 0,
    });

    expect(offlineService.getCachedOrders()[0]).toMatchObject({
      status: "preparing",
      items: [
        { id: 501, status: "preparing" },
        { id: 502, status: "preparing" },
      ],
    });
    expect(offlineService.repairData()).toBe(true);
    expect(offlineService.getCachedOrders()[0].priority).toBe("normal");
  });

  it("validates cached data and clears offline state", () => {
    offlineService.cacheOrders([
      {
        id: 1001,
        orderNumber: "A001",
        status: "confirmed",
        items: [],
        createdAt: "2026-06-08T01:00:00.000Z",
        totalItems: 0,
        priority: "normal",
        elapsedTime: 0,
      },
    ]);

    expect(offlineService.validateCachedData()).toBe(true);
    expect(offlineService.getOfflineStats()).toMatchObject({
      pendingActions: 0,
      failedActions: 0,
      isOnline: false,
      conflicts: 0,
    });

    offlineService.clearOfflineData();

    expect(offlineService.getCachedOrders()).toEqual([]);
    expect(offlineService.pendingActions.value).toEqual([]);
  });

  it("tracks browser online and offline events", () => {
    window.dispatchEvent(new Event("offline"));

    expect(offlineService.isOnline.value).toBe(false);
    expect(offlineService.isOfflineMode.value).toBe(true);

    window.dispatchEvent(new Event("online"));

    expect(offlineService.isOnline.value).toBe(true);
    expect(offlineService.isOfflineMode.value).toBe(false);
  });

  it("tracks and resolves sync conflicts", async () => {
    vi.mocked(apiClient.put).mockResolvedValue({
      data: {
        success: false,
        conflict: {
          type: "status_conflict",
          serverData: { status: "ready" },
        },
      },
    } as never);

    offlineService.queueAction(
      "mark_ready",
      1001,
      { restaurantId: "restaurant-1", status: "ready" },
      501,
    );

    offlineService.isOnline.value = true;
    await offlineService.syncPendingActions();

    expect(offlineService.syncConflicts.value).toHaveLength(1);
    offlineService.resolveConflict(
      offlineService.syncConflicts.value[0].id,
      "server",
    );
    expect(offlineService.syncConflicts.value).toHaveLength(0);
  });
});

const buildCachedOrder = (
  overrides: Partial<KitchenOrder> = {},
): KitchenOrder => ({
  id: 1001,
  orderNumber: "A001",
  status: "confirmed",
  deliveryInfo: { type: "dine_in" },
  items: [
    {
      id: 501,
      name: "Noodles",
      quantity: 1,
      status: "pending",
      priority: "normal",
    },
  ],
  createdAt: "2026-06-08T01:00:00.000Z",
  totalItems: 1,
  priority: "normal",
  elapsedTime: 0,
  ...overrides,
});

describe("offlineService tenant-scoped order cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    offlineService.clearOfflineData();
    offlineService.isOnline.value = false;
  });

  it("does not serve restaurant A cached orders to restaurant B", () => {
    offlineService.setActiveRestaurant("restaurant-a");
    offlineService.cacheOrders([buildCachedOrder({ orderNumber: "A001" })]);

    offlineService.setActiveRestaurant("restaurant-b");

    expect(offlineService.getCachedOrders()).toEqual([]);
    expect(offlineService.getCachedOrders("restaurant-b")).toEqual([]);
  });

  it("keeps each restaurant cache in its own bucket", () => {
    const orderA = buildCachedOrder({ id: 1001, orderNumber: "A001" });
    const orderB = buildCachedOrder({ id: 2002, orderNumber: "B001" });

    offlineService.cacheOrders([orderA], "restaurant-a");
    offlineService.cacheOrders([orderB], "restaurant-b");

    expect(offlineService.getCachedOrders("restaurant-a")).toEqual([orderA]);
    expect(offlineService.getCachedOrders("restaurant-b")).toEqual([orderB]);
  });

  it("drops the previous restaurant cache and queued actions on tenant switch", () => {
    offlineService.setActiveRestaurant("restaurant-a");
    offlineService.cacheOrders([buildCachedOrder()]);
    offlineService.queueAction("mark_ready", 1001, {
      restaurantId: "restaurant-a",
      status: "ready",
    });

    expect(offlineService.pendingActions.value).toHaveLength(1);

    offlineService.setActiveRestaurant("restaurant-b");

    expect(offlineService.getCachedOrders("restaurant-a")).toEqual([]);
    expect(offlineService.pendingActions.value).toEqual([]);
    expect(offlineService.currentRestaurantId).toBe("restaurant-b");
  });

  it("ignores a legacy unscoped order cache", () => {
    localStorage.setItem(
      "kitchen-cached-orders",
      JSON.stringify([buildCachedOrder()]),
    );

    offlineService.setActiveRestaurant("restaurant-a");

    expect(offlineService.getCachedOrders()).toEqual([]);
  });

  it("refuses to cache orders when no restaurant is bound", () => {
    offlineService.setActiveRestaurant(null);

    offlineService.cacheOrders([buildCachedOrder()]);

    expect(offlineService.getCachedOrders()).toEqual([]);
    expect(localStorage.getItem("kitchen-cached-orders")).toBeNull();
  });

  it("purges every restaurant cache on logout cleanup", () => {
    offlineService.cacheOrders([buildCachedOrder()], "restaurant-a");
    offlineService.cacheOrders([buildCachedOrder()], "restaurant-b");

    offlineService.clearOfflineData();

    expect(offlineService.getCachedOrders("restaurant-a")).toEqual([]);
    expect(offlineService.getCachedOrders("restaurant-b")).toEqual([]);
    expect(offlineService.currentRestaurantId).toBeNull();
  });
});
