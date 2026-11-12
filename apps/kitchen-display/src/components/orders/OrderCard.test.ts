import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import OrderCard from "./OrderCard.vue";
import type { KitchenOrder } from "@/types";

const baseOrder: KitchenOrder = {
  id: 1,
  orderNumber: "A001",
  tableName: "Table 4",
  status: "pending",
  deliveryInfo: { type: "dine_in" },
  items: [
    {
      id: 10,
      name: "Noodles",
      quantity: 1,
      status: "pending",
      priority: "normal",
    },
  ],
  createdAt: "2026-05-25T12:00:00.000Z",
  totalItems: 1,
  priority: "normal",
  elapsedTime: 2,
};

function makeOrder(overrides: Partial<KitchenOrder> = {}): KitchenOrder {
  return {
    ...baseOrder,
    ...overrides,
    items: overrides.items ?? baseOrder.items,
    deliveryInfo: overrides.deliveryInfo ?? baseOrder.deliveryInfo,
  };
}

function mountOrderCard(tableName: string) {
  return mount(OrderCard, {
    props: {
      order: { ...baseOrder, tableName },
      statusType: "pending",
    },
    global: {
      plugins: [createPinia()],
    },
  });
}

describe("OrderCard", () => {
  it("strips localized table prefixes only when followed by a separator", () => {
    expect(mountOrderCard("Table 4").text()).toContain("桌 4");
    expect(mountOrderCard("Table-4").text()).toContain("桌 4");
    expect(mountOrderCard("桌 4").text()).toContain("桌 4");
    expect(mountOrderCard("桌-4").text()).toContain("桌 4");

    expect(mountOrderCard("桌子 4").text()).toContain("桌 桌子 4");
    expect(mountOrderCard("Tabletop 4").text()).toContain("桌 Tabletop 4");
  }, 10_000);

  // Found on production: the kitchen API sent no fulfilment type, so a
  // takeaway order with no table read "Dine-in" and "Table No Table".
  it("marks a takeaway order as takeaway and shows no table for it", () => {
    const wrapper = mount(OrderCard, {
      props: {
        order: makeOrder({
          tableName: "No Table",
          deliveryInfo: { type: "takeaway" },
        }),
        statusType: "pending",
      },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.find('[data-order-type="takeaway"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="kitchen-order-table"]').exists()).toBe(
      false,
    );
    expect(
      mountOrderCard("Table 4")
        .find('[data-testid="kitchen-order-table"]')
        .exists(),
    ).toBe(true);
  });

  it("emits item and order start actions for pending items", async () => {
    const order = makeOrder({
      id: 42,
      items: [
        {
          id: 101,
          name: "Laksa",
          quantity: 1,
          status: "pending",
          priority: "normal",
        },
        {
          id: 102,
          name: "Satay",
          quantity: 2,
          status: "preparing",
          priority: "normal",
        },
      ],
    });

    const wrapper = mount(OrderCard, {
      props: { order, statusType: "pending" },
      global: { plugins: [createPinia()] },
    });

    await wrapper
      .get('[data-testid="kitchen-item-start-42-101"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="kitchen-order-start-42"]')
      .trigger("click");

    expect(wrapper.emitted("start-cooking")).toEqual([
      [42, 101],
      [42, 101],
    ]);
    expect(
      wrapper.find('[data-testid="kitchen-item-start-42-102"]').exists(),
    ).toBe(false);
  });

  it("emits ready actions only for preparing items", async () => {
    const order = makeOrder({
      id: 43,
      status: "preparing",
      items: [
        {
          id: 201,
          name: "Rendang",
          quantity: 1,
          status: "preparing",
          priority: "normal",
        },
        {
          id: 202,
          name: "Rice",
          quantity: 1,
          status: "ready",
          priority: "normal",
        },
      ],
    });

    const wrapper = mount(OrderCard, {
      props: { order, statusType: "preparing" },
      global: { plugins: [createPinia()] },
    });

    await wrapper
      .get('[data-testid="kitchen-item-ready-43-201"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="kitchen-order-ready-43"]')
      .trigger("click");

    expect(wrapper.emitted("mark-ready")).toEqual([
      [43, 201],
      [43, 201],
    ]);
    expect(wrapper.text()).toContain("已完成");
  });

  it("renders urgent, platform, delivery, progress, and detail states", async () => {
    const order = makeOrder({
      id: 44,
      status: "preparing",
      priority: "urgent",
      elapsedTime: 12,
      estimatedTime: 20,
      orderSource: "foodpanda",
      customerName: "Mei",
      notes: "No peanuts",
      deliveryInfo: {
        type: "delivery",
        address: "1 Market Road",
        phone: "0912345678",
        instructions: "Ring bell",
      },
      items: [
        {
          id: 301,
          name: "Char kway teow",
          quantity: 3,
          status: "preparing",
          priority: "urgent",
          notes: "Extra spicy",
          customizations: ["no bean sprouts"],
          estimatedTime: 8,
        },
      ],
    });

    const wrapper = mount(OrderCard, {
      props: { order, statusType: "preparing" },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.text()).toContain("URGENT");
    expect(wrapper.text()).toContain("Foodpanda");
    expect(wrapper.text()).toContain("Mei");
    expect(wrapper.text()).toContain("1 Market Road");
    expect(wrapper.text()).toContain("Extra spicy");
    expect(wrapper.text()).toContain("No peanuts");
    expect(wrapper.text()).toContain("60%");

    await wrapper.find('button[title="查看詳情"]').trigger("click");

    expect(wrapper.emitted("view-details")).toEqual([[order]]);
  });
});
