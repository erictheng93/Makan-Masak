// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { mapDashboardPayload } from "./dashboard";
import { useDashboardStore } from "./dashboard";
import { api } from "@/services/api";

const authState = vi.hoisted(() => ({
  restaurantId: "restaurant-1" as string | null,
  isAuthenticated: true,
}));

vi.mock("./auth", () => ({
  useAuthStore: () => authState,
}));

vi.mock("@/services/api", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/i18n", () => ({ t: (key: string) => key }));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (amount: number) => `NT$${amount}` }),
}));

function axiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  authState.restaurantId = "restaurant-1";
});

afterEach(() => vi.useRealTimers());

describe("mapDashboardPayload", () => {
  it("maps the complete analytics dashboard payload for the legacy dashboard", () => {
    expect(
      mapDashboardPayload({
        summary: {
          todayRevenue: 1250,
          todayOrders: 5,
          monthRevenue: 12_500,
          monthOrders: 50,
          growthRates: { revenueGrowth: 12, orderGrowth: 8 },
        },
        recentOrders: [],
        topSellingItems: [
          {
            itemId: 7,
            itemName: "Nasi Lemak",
            quantity: 4,
            revenue: 800,
          },
        ],
        tableStatus: { occupied: 2, available: 3, total: 5 },
      }),
    ).toMatchObject({
      todayRevenue: 1250,
      todayOrders: 5,
      averageOrderValue: 250,
      topMenuItems: [{ id: 7, name: "Nasi Lemak", quantity: 4, revenue: 800 }],
    });
  });
});

describe("dashboard analytics charts", () => {
  it("writes each requested chart series into the state consumed by the charts", async () => {
    // The shape /analytics/revenue really returns: money per currency, in
    // cents. A scalar `revenue: 320` here is what hid the chart break (#407).
    const revenuePoint = {
      date: "2026-08-26",
      revenue: [{ currency: "TWD", amountCents: 32000 }],
      orderCount: 2,
    };
    vi.mocked(api.get)
      .mockResolvedValueOnce(
        axiosResponse({ success: true, data: [revenuePoint] }),
      )
      .mockResolvedValueOnce(
        axiosResponse({ success: true, data: [revenuePoint] }),
      )
      .mockResolvedValueOnce(
        axiosResponse({
          success: true,
          data: {
            summary: {
              todayRevenue: 320,
              todayOrders: 2,
              monthRevenue: 320,
              monthOrders: 2,
              growthRates: { revenueGrowth: 0, orderGrowth: 0 },
            },
            recentOrders: [],
            topSellingItems: [],
            tableStatus: { occupied: 0, available: 1, total: 1 },
          },
        }),
      );
    const store = useDashboardStore();

    await store.fetchRevenueAnalytics("weekly");
    await store.fetchOrderAnalytics("monthly");
    await store.fetchDashboardStats();

    expect(api.get).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        "/analytics/revenue?restaurantId=restaurant-1&groupBy=week&dateFrom=",
      ),
    );
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "/analytics/revenue?restaurantId=restaurant-1&groupBy=month&dateFrom=",
      ),
    );
    expect(store.revenueChart).toEqual([{ label: "2026-08-26", value: 320 }]);
    expect(store.ordersChart).toEqual([{ label: "2026-08-26", value: 2 }]);
  });

  it("bounds revenue and order chart requests to the selected Taipei period", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T10:30:00.000Z"));
    vi.mocked(api.get).mockResolvedValue(
      axiosResponse({ success: true, data: [] }),
    );
    const store = useDashboardStore();

    await store.fetchRevenueAnalytics("weekly");
    await store.fetchOrderAnalytics("monthly");

    const revenueUrl = new URL(
      vi.mocked(api.get).mock.calls[0][0],
      "https://example.test",
    );
    expect(Object.fromEntries(revenueUrl.searchParams)).toMatchObject({
      groupBy: "week",
      dateFrom: "2026-08-23T16:00:00.000Z",
      dateTo: "2026-08-28T10:30:00.000Z",
    });

    const ordersUrl = new URL(
      vi.mocked(api.get).mock.calls[1][0],
      "https://example.test",
    );
    expect(Object.fromEntries(ordersUrl.searchParams)).toMatchObject({
      groupBy: "month",
      dateFrom: "2026-07-31T16:00:00.000Z",
      dateTo: "2026-08-28T10:30:00.000Z",
    });
  });
});

describe("dashboard recent orders", () => {
  it("preserves completed and cancelled orders from the dashboard payload", async () => {
    vi.mocked(api.get).mockResolvedValue(
      axiosResponse({
        success: true,
        data: {
          summary: {
            todayRevenue: 500,
            todayOrders: 2,
            monthRevenue: 500,
            monthOrders: 2,
            growthRates: { revenueGrowth: 0, orderGrowth: 0 },
          },
          recentOrders: [
            {
              id: "paid-order",
              orderNumber: "A-101",
              status: "paid",
              totalAmount: 300,
              tableNumber: "A1",
              createdAt: "2026-08-28T09:00:00.000Z",
            },
            {
              id: "cancelled-order",
              orderNumber: "A-100",
              status: "cancelled",
              totalAmount: 200,
              tableNumber: null,
              createdAt: "2026-08-28T08:00:00.000Z",
            },
          ],
          topSellingItems: [],
          tableStatus: { occupied: 0, available: 1, total: 1 },
        },
      }),
    );
    const store = useDashboardStore();

    await store.fetchDashboardStats();

    expect(store.recentOrders).toEqual([
      expect.objectContaining({ id: "paid-order", status: "paid" }),
      expect.objectContaining({
        id: "cancelled-order",
        status: "cancelled",
      }),
    ]);
  });
});

describe("dashboard analytics access errors", () => {
  it("shows module-plan copy instead of a generic permission error", async () => {
    vi.mocked(api.get).mockRejectedValue({
      response: {
        status: 403,
        data: {
          success: false,
          error: { code: "MODULE_NOT_ENABLED", message: "not for display" },
        },
      },
    });

    const store = useDashboardStore();
    await store.fetchDashboardStats();

    expect(store.error).toBe("errors.subscription.moduleNotEnabled");
  });
});
