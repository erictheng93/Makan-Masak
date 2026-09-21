// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderItemsEditor from "./OrderItemsEditor.vue";
import type { Order } from "@/types";

const storeMocks = vi.hoisted(() => ({
  addOrderItems: vi.fn(),
  changeOrderItemQuantity: vi.fn(),
  removeOrderItem: vi.fn(),
  error: null as string | null,
}));

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/i18n", () => ({ t: (key: string) => key }));

vi.mock("@/stores/order", () => ({ useOrderStore: () => storeMocks }));

vi.mock("@/services/api", () => ({ api: apiMocks }));

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    restaurantId: "restaurant-1",
    orderNumber: "A-001",
    status: "confirmed",
    version: 3,
    totalAmount: 30,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    items: [
      {
        id: 11,
        menuItemId: 101,
        quantity: 2,
        unitPrice: 10,
        name: "Nasi Lemak",
        customizations: [],
      },
      {
        id: 12,
        menuItemId: 102,
        quantity: 1,
        unitPrice: 10,
        name: "Teh Tarik",
        customizations: [],
      },
    ],
    ...overrides,
  } as Order;
}

describe("OrderItemsEditor", () => {
  beforeEach(() => {
    storeMocks.addOrderItems.mockReset();
    storeMocks.changeOrderItemQuantity.mockReset();
    storeMocks.removeOrderItem.mockReset();
    storeMocks.error = null;
    apiMocks.get.mockReset();
  });

  it("sends the version the UI is holding, so a concurrent edit is caught", async () => {
    storeMocks.changeOrderItemQuantity.mockResolvedValue(buildOrder());
    const wrapper = mount(OrderItemsEditor, {
      props: { order: buildOrder() },
    });

    await wrapper.find('[data-testid="increase-11"]').trigger("click");

    expect(storeMocks.changeOrderItemQuantity).toHaveBeenCalledOnce();
    expect(storeMocks.changeOrderItemQuantity).toHaveBeenCalledWith(
      "order-1",
      11,
      3,
      3,
    );
  });

  it("decrements rather than removing, and stops the stepper at 1", async () => {
    storeMocks.changeOrderItemQuantity.mockResolvedValue(buildOrder());
    const wrapper = mount(OrderItemsEditor, {
      props: { order: buildOrder() },
    });

    await wrapper.find('[data-testid="decrease-11"]').trigger("click");
    expect(storeMocks.changeOrderItemQuantity).toHaveBeenCalledWith(
      "order-1",
      11,
      1,
      3,
    );

    // The second line is already at 1: the stepper must not offer a 0, because
    // removal is a different operation with different consequences.
    expect(
      wrapper.find('[data-testid="decrease-12"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("emits the server's order rather than a locally patched one", async () => {
    const serverOrder = buildOrder({ version: 4, totalAmount: 40 });
    storeMocks.changeOrderItemQuantity.mockResolvedValue(serverOrder);
    const wrapper = mount(OrderItemsEditor, {
      props: { order: buildOrder() },
    });

    await wrapper.find('[data-testid="increase-11"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("updated")?.[0]?.[0]).toBe(serverOrder);
  });

  it("surfaces the store's message instead of a generic one", async () => {
    storeMocks.changeOrderItemQuantity.mockResolvedValue(null);
    storeMocks.error = "Order was updated by another actor.";
    const wrapper = mount(OrderItemsEditor, {
      props: { order: buildOrder() },
    });

    await wrapper.find('[data-testid="increase-11"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="edit-error"]').text()).toBe(
      "Order was updated by another actor.",
    );
    expect(wrapper.emitted("updated")).toBeUndefined();
  });

  it("disables removal on a single-line order", () => {
    const wrapper = mount(OrderItemsEditor, {
      props: {
        order: buildOrder({
          items: [
            {
              id: 11,
              menuItemId: 101,
              quantity: 1,
              unitPrice: 10,
              name: "Nasi Lemak",
              customizations: [],
            },
          ],
        }),
      },
    });

    expect(
      wrapper.find('[data-testid="remove-11"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("loads the menu only when the picker is opened", async () => {
    apiMocks.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          menuItems: [
            { id: 201, name: "Roti Canai", price: 5, isAvailable: true },
            { id: 202, name: "Soup", price: 8, isAvailable: false },
          ],
        },
      },
    });
    const wrapper = mount(OrderItemsEditor, {
      props: { order: buildOrder() },
    });

    expect(apiMocks.get).not.toHaveBeenCalled();

    await wrapper.find('[data-testid="open-picker"]').trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(apiMocks.get).toHaveBeenCalledWith("/menu/restaurant-1");
    // An unavailable dish is not offerable, so it is not offered.
    expect(wrapper.find('[data-testid="add-201"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="add-202"]').exists()).toBe(false);
  });

  it("loads the selected order's menu rather than the signed-in admin's menu", async () => {
    apiMocks.get.mockResolvedValue({
      data: { success: true, data: { menuItems: [] } },
    });
    const wrapper = mount(OrderItemsEditor, {
      props: { order: buildOrder({ restaurantId: "restaurant-2" }) },
    });

    await wrapper.find('[data-testid="open-picker"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(apiMocks.get).toHaveBeenCalledWith("/menu/restaurant-2");
  });

  it("does not offer items that need required customizations", async () => {
    apiMocks.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          menuItems: [
            { id: 201, name: "Plain Rice", price: 2, isAvailable: true },
            {
              id: 202,
              name: "Spicy Noodles",
              price: 8,
              isAvailable: true,
              options: {
                customizations: [{ required: true }],
              },
            },
          ],
        },
      },
    });
    const wrapper = mount(OrderItemsEditor, {
      props: { order: buildOrder() },
    });

    await wrapper.find('[data-testid="open-picker"]').trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="add-201"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="add-202"]').exists()).toBe(false);
  });

  it("adds a picked dish with the order's version", async () => {
    apiMocks.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          menuItems: [
            { id: 201, name: "Roti Canai", price: 5, isAvailable: true },
          ],
        },
      },
    });
    storeMocks.addOrderItems.mockResolvedValue(buildOrder({ version: 4 }));
    const wrapper = mount(OrderItemsEditor, {
      props: { order: buildOrder() },
    });

    await wrapper.find('[data-testid="open-picker"]').trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="add-201"]').trigger("click");

    expect(storeMocks.addOrderItems).toHaveBeenCalledWith(
      "order-1",
      [{ menuItemId: 201, quantity: 1 }],
      3,
    );
  });
});
