import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrdersStore } from "./orders";
import type { KitchenSSEEvent } from "@/types";

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

describe("orders store realtime events", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("adds orders from realtime NEW_ORDER data events", () => {
    const store = useOrdersStore();

    store.handleSSEEvent({
      type: "new_order",
      eventId: "evt-market-1",
      timestamp: 1780308000000,
      restaurantId: "restaurant-1",
      data: {
        orderId: 1001,
        orderNumber: "A001",
        items: [
          {
            orderItemId: 501,
            menuItemId: 101,
            menuItemName: "雞排",
            quantity: 2,
            price: 80,
            notes: "不要辣",
          },
        ],
        totalAmount: 160,
        notes: "市場聯合結帳",
        customer: { name: "Guest" },
      },
    } as unknown as KitchenSSEEvent);

    expect(store.orders).toHaveLength(1);
    expect(store.orders[0]).toMatchObject({
      id: 1001,
      orderNumber: "A001",
      status: "confirmed",
      deliveryInfo: { type: "takeaway" },
      customerName: "Guest",
      notes: "市場聯合結帳",
      totalItems: 2,
      totalAmount: 160,
      items: [
        {
          id: 501,
          name: "雞排",
          quantity: 2,
          notes: "不要辣",
          status: "pending",
          priority: "normal",
        },
      ],
    });
  });

  it("keeps a pending NEW_ORDER off the board and refetches once it is confirmed", () => {
    const store = useOrdersStore();

    const refetchOnNew = store.handleSSEEvent({
      type: "new_order",
      timestamp: 1780308000000,
      restaurantId: "restaurant-1",
      data: {
        orderId: 2001,
        orderNumber: "B001",
        status: "pending",
        items: [],
      },
    } as unknown as KitchenSSEEvent);

    expect(refetchOnNew).toBe(false);
    expect(store.orders).toHaveLength(0);

    // The confirmation carries no items, so the store asks for a refetch
    // rather than inventing an empty card.
    const refetchOnConfirm = store.handleSSEEvent({
      type: "order_status_update",
      timestamp: 1780308001000,
      restaurantId: "restaurant-1",
      data: { orderId: 2001, status: "confirmed" },
    } as unknown as KitchenSSEEvent);

    expect(refetchOnConfirm).toBe(true);
    expect(store.orders).toHaveLength(0);
  });

  it("updates and removes orders from realtime data events", () => {
    const store = useOrdersStore();

    store.handleSSEEvent({
      type: "new_order",
      timestamp: 1780308000000,
      restaurantId: "restaurant-1",
      data: {
        orderId: 1001,
        orderNumber: "A001",
        items: [
          {
            orderItemId: 501,
            menuItemName: "雞排",
            quantity: 1,
            price: 80,
          },
        ],
        totalAmount: 80,
      },
    } as unknown as KitchenSSEEvent);

    store.handleSSEEvent({
      type: "order_status_update",
      timestamp: 1780308300000,
      restaurantId: "restaurant-1",
      data: {
        orderId: 1001,
        itemId: 501,
        status: "preparing",
        updatedAt: "2026-06-01T10:05:00.000Z",
      },
    } as unknown as KitchenSSEEvent);

    expect(store.orders[0].status).toBe("confirmed");
    expect(store.orders[0].items[0]).toMatchObject({
      id: 501,
      status: "preparing",
      startedAt: "2026-06-01T10:05:00.000Z",
    });

    store.handleSSEEvent({
      type: "order_status_update",
      timestamp: 1780308301000,
      restaurantId: "restaurant-1",
      data: { orderId: 1001, status: "preparing" },
    } as unknown as KitchenSSEEvent);

    expect(store.orders[0].status).toBe("preparing");

    store.handleSSEEvent({
      type: "order_cancelled",
      timestamp: 1780308400000,
      restaurantId: "restaurant-1",
      data: { orderId: 1001 },
    } as unknown as KitchenSSEEvent);

    expect(store.orders).toHaveLength(0);
  });

  it("matches text UUID order ids from realtime data events", () => {
    const store = useOrdersStore();
    const uuid = "01928f6e-7c1a-7b2e-9a3d-4f5e6a7b8c9d";

    // A confirmed order the board does not hold yet is refetched.
    expect(
      store.handleSSEEvent({
        type: "ORDER_STATUS_UPDATE",
        timestamp: 1780308001000,
        restaurantId: "restaurant-1",
        data: {
          orderId: "01928f6e-0000-7000-8000-000000000001",
          status: "confirmed",
        },
      } as unknown as KitchenSSEEvent),
    ).toBe(true);

    // The REST list returns the server's text ids as-is.
    store.orders = [
      {
        id: uuid,
        orderNumber: "C001",
        status: "confirmed",
        items: [],
      } as unknown as (typeof store.orders)[number],
    ];

    const refetch = store.handleSSEEvent({
      type: "ORDER_STATUS_UPDATE",
      timestamp: 1780308002000,
      restaurantId: "restaurant-1",
      data: { orderId: uuid, status: "preparing" },
    } as unknown as KitchenSSEEvent);

    expect(refetch).toBe(false);
    expect(store.orders[0].status).toBe("preparing");

    store.handleSSEEvent({
      type: "ORDER_CANCELLED",
      timestamp: 1780308003000,
      restaurantId: "restaurant-1",
      data: { orderId: uuid },
    } as unknown as KitchenSSEEvent);

    expect(store.orders).toHaveLength(0);
  });

  it("lands a UUID NEW_ORDER from realtime data on the board and applies its priority update", () => {
    const store = useOrdersStore();
    const uuid = "01928f6e-7c1a-7b2e-9a3d-4f5e6a7b8c9e";

    // The dashboard adapter passes the realtime event through `data` only.
    store.handleSSEEvent({
      type: "NEW_ORDER",
      timestamp: 1780308000000,
      restaurantId: "restaurant-1",
      data: {
        orderId: uuid,
        orderNumber: "D001",
        status: "confirmed",
        items: [{ orderItemId: 701, menuItemName: "滷肉飯", quantity: 1 }],
      },
    } as unknown as KitchenSSEEvent);

    expect(store.orders).toHaveLength(1);
    expect(store.orders[0]).toMatchObject({
      id: uuid,
      orderNumber: "D001",
      status: "confirmed",
    });

    // A re-sent NEW_ORDER (item edit) upserts rather than duplicating.
    store.handleSSEEvent({
      type: "NEW_ORDER",
      timestamp: 1780308001000,
      restaurantId: "restaurant-1",
      data: {
        orderId: uuid,
        orderNumber: "D001",
        status: "confirmed",
        items: [{ orderItemId: 701, menuItemName: "滷肉飯", quantity: 2 }],
      },
    } as unknown as KitchenSSEEvent);

    expect(store.orders).toHaveLength(1);
    expect(store.orders[0].totalItems).toBe(2);

    store.handleSSEEvent({
      type: "PRIORITY_UPDATE",
      timestamp: 1780308002000,
      restaurantId: "restaurant-1",
      data: { orderId: uuid, priority: "urgent" },
    } as unknown as KitchenSSEEvent);

    expect(store.orders[0].priority).toBe("urgent");
    expect(store.getOrderById(uuid)?.orderNumber).toBe("D001");
  });
});
