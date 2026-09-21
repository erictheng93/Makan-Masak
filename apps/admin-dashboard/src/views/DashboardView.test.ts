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
});
