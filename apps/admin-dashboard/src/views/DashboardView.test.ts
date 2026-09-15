// @vitest-environment jsdom

import { flushPromises, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardView from "./DashboardView.vue";
import OrdersChart from "@/components/dashboard/OrdersChart.vue";
import RecentOrders from "@/components/dashboard/RecentOrders.vue";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const dashboardStore = vi.hoisted(() => ({
  isLoading: false,
  lastUpdated: null,
  todayOrders: 2,
  todayRevenue: 500,
  averageOrderValue: 250,
  completionRate: 0,
  topMenuItems: [],
  revenueChart: [],
  ordersChart: [{ label: "2026-08-28", value: 2 }],
  recentOrders: [
    {
      id: "paid-order",
      orderNumber: "A-101",
      tableNumber: "A1",
      status: "paid",
      total: 300,
      createdAt: "2026-08-28T09:00:00.000Z",
    },
    {
      id: "cancelled-order",
      orderNumber: "A-100",
      tableNumber: "",
      status: "cancelled",
      total: 200,
      createdAt: "2026-08-28T08:00:00.000Z",
    },
  ],
  fetchDashboardStats: vi.fn(),
  fetchRevenueAnalytics: vi.fn(),
  fetchOrderAnalytics: vi.fn(),
  startAutoRefresh: vi.fn(),
  stopAutoRefresh: vi.fn(),
  formatCurrency: vi.fn((amount: number) => `$${amount}`),
  formatPercentage: vi.fn((value: number) => `${value}%`),
}));
const orderStore = vi.hoisted(() => ({
  orders: [],
  isLoading: false,
  fetchOrders: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  user: { id: 10, role: 1 },
  restaurantId: null as string | null,
  hasRestaurantContext: false,
  canAccessAdminFeatures: false,
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("vue-router", () => ({ useRouter: () => router }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({ formatRelativeTime: () => "now" }),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => authState,
}));
vi.mock("@/services/api", () => ({
  api,
  unwrapApiPayload: (payload: { data?: unknown }) => payload.data ?? payload,
  unwrapApiList: (payload: unknown) => {
    const value = payload as { data?: unknown } | unknown[];
    if (Array.isArray(value)) return value;
    return Array.isArray(value.data) ? value.data : [];
  },
}));
vi.mock("@/stores/dashboard", () => ({
  useDashboardStore: () => dashboardStore,
}));
vi.mock("@/stores/order", () => ({
  useOrderStore: () => orderStore,
}));

describe("DashboardView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.restaurantId = null;
    authState.hasRestaurantContext = false;
  });

  it("renders undifferentiated order totals and dashboard recent orders", async () => {
    const wrapper = shallowMount(DashboardView, {
      global: {
        stubs: {
          LazyChart: { template: "<div><slot /></div>" },
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.findComponent(OrdersChart).props("data")).toEqual([
      { label: "2026-08-28", total: 2, date: "2026-08-28" },
    ]);
    expect(wrapper.findComponent(RecentOrders).props("orders")).toEqual(
      dashboardStore.recentOrders,
    );
    expect(orderStore.fetchOrders).not.toHaveBeenCalled();
  });

  it("shows incomplete guest-order readiness and keeps a rejected table check unknown", async () => {
    authState.restaurantId = "shop-1";
    authState.hasRestaurantContext = true;
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        data: {
          data: {
            name: "Shop",
            address: "1 Main",
            city: "KL",
            district: "BB",
            isAvailable: false,
            settings: { allowGuestOrders: false },
          },
        },
      })
      .mockResolvedValueOnce({
        data: { data: { menuItems: [{ isAvailable: true }] } },
      })
      .mockRejectedValueOnce(new Error("tables unavailable"))
      .mockResolvedValueOnce({ data: { data: [] } });

    const wrapper = shallowMount(DashboardView, {
      global: {
        stubs: {
          LazyChart: { template: "<div><slot /></div>" },
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="owner-setup-checklist"]').exists()).toBe(
      true,
    );
    expect(
      wrapper
        .get('[data-testid="setup-checklist-guest-orders"]')
        .attributes("data-status"),
    ).toBe("incomplete");
    expect(
      wrapper
        .get('[data-testid="setup-checklist-tables"]')
        .attributes("data-status"),
    ).toBe("unknown");
  });

  it("hides the checklist after every setup requirement is complete", async () => {
    authState.restaurantId = "shop-1";
    authState.hasRestaurantContext = true;
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        data: {
          data: {
            name: "Shop",
            address: "1 Main",
            city: "KL",
            district: "BB",
            isAvailable: true,
            settings: { allowGuestOrders: true },
          },
        },
      })
      .mockResolvedValueOnce({
        data: { data: { menuItems: [{ isAvailable: true }] } },
      })
      .mockResolvedValueOnce({ data: { data: [{}] } })
      .mockResolvedValueOnce({ data: { data: [] } });

    const wrapper = shallowMount(DashboardView, {
      global: {
        stubs: {
          LazyChart: { template: "<div><slot /></div>" },
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="owner-setup-checklist"]').exists()).toBe(
      false,
    );
  });

  it("keeps a GPS placeholder profile and unavailable menu item incomplete", async () => {
    authState.restaurantId = "shop-1";
    authState.hasRestaurantContext = true;
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        data: {
          data: {
            name: "Shop",
            address: "Onboarding GPS 24.147736, 120.673648",
            city: "台中市",
            district: "onboarding-shop-1",
            isAvailable: true,
            settings: { allowGuestOrders: true },
          },
        },
      })
      .mockResolvedValueOnce({
        data: { data: { menuItems: [{ isAvailable: false }] } },
      })
      .mockResolvedValueOnce({ data: { data: [{}] } })
      .mockResolvedValueOnce({ data: { data: [] } });

    const wrapper = shallowMount(DashboardView, {
      global: {
        stubs: {
          LazyChart: { template: "<div><slot /></div>" },
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    expect(
      wrapper
        .get('[data-testid="setup-checklist-profile"]')
        .attributes("data-status"),
    ).toBe("incomplete");
    expect(
      wrapper
        .get('[data-testid="setup-checklist-menu"]')
        .attributes("data-status"),
    ).toBe("incomplete");
    expect(
      wrapper
        .get('[data-testid="setup-checklist-guest-orders"]')
        .attributes("data-status"),
    ).toBe("complete");
  });
});
