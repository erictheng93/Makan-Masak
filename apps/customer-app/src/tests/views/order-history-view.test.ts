import { mount, RouterLinkStub } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderHistoryView from "@/views/OrderHistoryView.vue";
import { customerOrderApi } from "@/services/customerOrderApi";

/**
 * The history list spans restaurants: two orders from shops on different
 * currencies must be labelled separately, and the page must actually render
 * the orders the API returned.
 */
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${params.count}`,
  }),
}));

// `formatPriceIn` takes the row's own currency; `formatPrice` would take a
// single page-wide one, so the fake keeps them distinguishable.
vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (amount: number) => `PAGE${amount}`,
    formatPriceIn: (amount: number, currency?: string) =>
      `${currency ?? "TWD"}${amount}`,
  }),
}));

vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: vi.fn().mockResolvedValue(false) }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    checkAuth: vi.fn().mockResolvedValue(true),
    logout: vi.fn(),
  }),
}));

// The view renders the review block, which reaches for the API on open.
// Nothing here opens it; the mock only keeps `@/services/api` (and its
// required VITE_API_BASE_URL) out of the module graph.
vi.mock("@/services/orderApi", () => ({
  orderApi: { getOrderReviews: vi.fn(), getRestaurantReviews: vi.fn() },
}));

vi.mock("@/services/customerOrderApi", () => ({
  customerOrderApi: {
    getMyOrders: vi.fn(),
    cancelOrder: vi.fn(),
  },
}));

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    restaurantId: "r1",
    orderNumber: "ORD-1",
    status: "pending",
    paymentStatus: "pending",
    subtotal: 120,
    totalAmount: 120,
    createdAt: 1_756_000_000_000,
    updatedAt: 1_756_000_000_000,
    confirmedAt: null,
    preparingAt: null,
    readyAt: null,
    deliveredAt: null,
    paidAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function mountView() {
  return mount(OrderHistoryView, {
    global: {
      stubs: {
        RouterLink: RouterLinkStub,
        OrderReviewSection: true,
      },
    },
  });
}

describe("OrderHistoryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the orders the API returned", async () => {
    vi.mocked(customerOrderApi.getMyOrders).mockResolvedValue({
      orders: [
        order({ orderNumber: "ORD-A" }),
        order({ id: "order-2", orderNumber: "ORD-B" }),
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    } as never);

    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("ORD-A");
    });
    expect(wrapper.text()).toContain("ORD-B");
  });

  it("labels each order with its own restaurant's currency", async () => {
    vi.mocked(customerOrderApi.getMyOrders).mockResolvedValue({
      orders: [
        order({ orderNumber: "ORD-TWD", totalAmount: 120, currency: "TWD" }),
        order({
          id: "order-2",
          orderNumber: "ORD-MYR",
          totalAmount: 12.5,
          currency: "MYR",
        }),
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    } as never);

    const wrapper = mountView();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("TWD120");
    });
    expect(wrapper.text()).toContain("MYR12.5");
    // Never one currency for the whole page.
    expect(wrapper.text()).not.toContain("PAGE");
  });
});
