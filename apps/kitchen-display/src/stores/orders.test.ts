import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useOrdersStore } from "./orders";
import type { KitchenSSEEvent } from "@/types";

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
});
