// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrdersView from "./OrdersView.vue";
import type { Order } from "@/types";

const orderStore = vi.hoisted(() => ({
  orders: [] as Order[],
  error: null as string | null,
  fetchOrders: vi.fn().mockResolvedValue(undefined),
  updateOrderStatus: vi.fn().mockResolvedValue(true),
  cancelOrder: vi.fn().mockResolvedValue(true),
  pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
}));
const authStore = vi.hoisted(() => ({ user: { role: 1 } }));

// locale is not decoration here: the view formats timestamps through
// useDateFormatter, which reads locale.value to pick a date format. A mock
// returning only `t` makes that read throw.
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: ref("zh-TW"),
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ error: vi.fn() }),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (value: number) => `$${value}`,
  }),
}));

vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({
    confirm: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("@/stores/order", () => ({
  useOrderStore: () => orderStore,
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => authStore,
}));

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { data: {} } }),
    post: vi.fn(),
  },
}));

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  id: "019fc320-c159-700c-a66c-39c9b98ed964",
  restaurantId: "019f9373-397c-7202-99d6-24c61976f3ff",
  tableId: 2,
  table: { id: 2, number: "A1" },
  orderNumber: "019FA136-CFE3-709F-A2AB-F8A3EBCD31A1-MSBYTLO8-DCV5",
  orderType: "table",
  status: "pending",
  totalAmount: 12000,
  items: [],
  customerInfo: { name: "Test Customer" },
  createdAt: Date.parse("2026-08-03T10:00:00.000Z"),
  updatedAt: Date.parse("2026-08-03T10:00:00.000Z"),
  ...overrides,
});

describe("OrdersView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderStore.orders = [];
    orderStore.error = null;
    authStore.user.role = 1;
  });

  it("renders API order numbers", () => {
    orderStore.orders = [makeOrder()];

    const wrapper = mount(OrdersView);

    expect(wrapper.text()).toContain(
      "019FA136-CFE3-709F-A2AB-F8A3EBCD31A1-MSBYTLO8-DCV5",
    );
  });

  it("renders API table numbers in the table-number cells", () => {
    const order = makeOrder();
    orderStore.orders = [order];

    const wrapper = mount(OrdersView);

    const tableCells = wrapper.findAll(
      `[data-testid="admin-order-table-${order.id}"]`,
    );

    expect(tableCells.length).toBeGreaterThan(0);
    expect(tableCells.every((cell) => cell.text() === "A1")).toBe(true);
  });

  it("searches by real order number", async () => {
    orderStore.orders = [makeOrder()];

    const wrapper = mount(OrdersView);

    await wrapper
      .get('[data-testid="admin-orders-search"]')
      .setValue("MSBYTLO8");

    expect(wrapper.text()).toContain(
      "019FA136-CFE3-709F-A2AB-F8A3EBCD31A1-MSBYTLO8-DCV5",
    );
  });

  it("requests server-side search and renders pagination", async () => {
    orderStore.pagination = { page: 1, limit: 20, total: 21, totalPages: 2 };
    const wrapper = mount(OrdersView);
    await wrapper
      .get('[data-testid="admin-orders-search"]')
      .setValue("MSBYTLO8");

    expect(orderStore.fetchOrders).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "MSBYTLO8", page: 1, limit: 20 }),
    );
    await wrapper
      .get('[data-testid="admin-orders-next-page"]')
      .trigger("click");
    expect(orderStore.fetchOrders).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, limit: 20 }),
    );
  });

  it("sends the selected delivery type to the server", async () => {
    const wrapper = mount(OrdersView);

    await wrapper
      .get('[data-testid="admin-orders-type-filter"]')
      .setValue("delivery");

    expect(orderStore.fetchOrders).toHaveBeenLastCalledWith(
      expect.objectContaining({ fulfillmentType: "delivery", page: 1 }),
    );
  });

  it("offers a refund action for a paid order with a payment transaction", () => {
    const order = makeOrder({
      status: "paid",
      paymentTransactionId: "txn-1",
    });
    orderStore.orders = [order];
    const wrapper = mount(OrdersView);

    expect(
      wrapper.find(`[data-testid="admin-order-refund-${order.id}"]`).exists(),
    ).toBe(true);
  });

  it("uses the shared role permissions when rendering status actions", () => {
    const order = makeOrder({ status: "confirmed" });
    orderStore.orders = [order];

    const ownerView = mount(OrdersView);
    expect(
      ownerView.find(`[data-testid="admin-order-update-${order.id}"]`).exists(),
    ).toBe(true);
    ownerView.unmount();

    authStore.user.role = 3;
    const serviceCrewView = mount(OrdersView);
    expect(
      serviceCrewView
        .find(`[data-testid="admin-order-update-${order.id}"]`)
        .exists(),
    ).toBe(false);
  });

  it("does not offer a fulfilment update that marks a delivered order paid", () => {
    const order = makeOrder({ status: "delivered" });
    orderStore.orders = [order];

    const wrapper = mount(OrdersView);

    expect(
      wrapper.find(`[data-testid="admin-order-update-${order.id}"]`).exists(),
    ).toBe(false);
  });

  // The server's machine allows preparing -> cancelled and ready -> cancelled.
  // This screen used to offer the button only for pending and confirmed, so a
  // customer who left once the kitchen had started gave the owner no way out
  // except pushing the order to paid — recording revenue that never arrived,
  // in a state nothing can reverse (#310).
  it.each(["preparing", "ready"] as const)(
    "offers cancellation from %s, which the server accepts",
    (status) => {
      const order = makeOrder({ status });
      orderStore.orders = [order];
      const wrapper = mount(OrdersView);

      expect(
        wrapper.find(`[data-testid="admin-order-cancel-${order.id}"]`).exists(),
      ).toBe(true);
    },
  );

  it("does not offer cancellation to a role the server would 403", () => {
    // ROLE_STATUS_PERMISSIONS grants "cancelled" to admin and owner only, but
    // this route is also served to chef, service crew and cashier. The button
    // used to render for all of them with no role check at all.
    const order = makeOrder({ status: "preparing" });
    orderStore.orders = [order];

    for (const role of [2, 3, 4]) {
      authStore.user.role = role;
      const view = mount(OrdersView);
      expect(
        view.find(`[data-testid="admin-order-cancel-${order.id}"]`).exists(),
      ).toBe(false);
      view.unmount();
    }
  });
});
