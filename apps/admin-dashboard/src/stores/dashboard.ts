import { defineStore } from "pinia";
import { ref, computed, readonly } from "vue";
import type { DashboardStats, ChartData, OrderStatus } from "@/types";
import { api } from "@/services/api";
import { useAuthStore } from "./auth";
import { useCurrency } from "@/composables/useCurrency";
import { t } from "@/i18n";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

type AnalyticsPeriod = "daily" | "weekly" | "monthly";
type TopMenuItemsPeriod = "today" | "week" | "month";
type AnalyticsGroupBy = "day" | "week" | "month";
type RevenueAnalyticsPoint = {
  label?: string;
  date?: string;
  week?: string;
  month?: string;
  year?: string;
  value?: number;
  /** One entry per currency, in cents — never a scalar (#407). */
  revenue?: Array<{ currency: string; amountCents: number }>;
  orderCount?: number;
  orders?: number;
};
type ProductAnalyticsPoint = {
  name?: string;
  itemName?: string;
  count?: number;
  quantity?: number;
  orders?: number;
  revenue?: number;
};
type ProductAnalyticsPayload =
  | { popularItems?: ProductAnalyticsPoint[] }
  | ProductAnalyticsPoint[];

export type AnalyticsDashboardPayload = {
  summary: {
    todayRevenue: number;
    todayOrders: number;
    monthRevenue: number;
    monthOrders: number;
    growthRates: { revenueGrowth: number; orderGrowth: number };
  };
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: OrderStatus;
    totalAmount: number;
    tableNumber: string | null;
    createdAt: string;
  }>;
  topSellingItems: Array<{
    itemId: number;
    itemName: string;
    quantity: number;
    revenue: number;
  }>;
  tableStatus: { occupied: number; available: number; total: number };
};

export type DashboardRecentOrder = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  total: number;
  tableNumber: string;
  createdAt: string;
};

export function mapDashboardPayload(
  payload: AnalyticsDashboardPayload,
): DashboardStats {
  const { summary } = payload;

  return {
    todayOrders: summary.todayOrders,
    todayRevenue: summary.todayRevenue,
    averageOrderValue:
      summary.todayOrders > 0 ? summary.todayRevenue / summary.todayOrders : 0,
    completionRate: 0,
    topMenuItems: payload.topSellingItems.map((item) => ({
      id: item.itemId,
      name: item.itemName,
      quantity: item.quantity,
      revenue: item.revenue,
    })),
    revenueChart: [],
    ordersChart: [],
  };
}

const periodGroupBy: Record<AnalyticsPeriod, AnalyticsGroupBy> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
};

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

const getAnalyticsDateRange = (
  period: AnalyticsPeriod,
  now: Date = new Date(),
) => {
  const taipeiNow = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const year = taipeiNow.getUTCFullYear();
  const month = taipeiNow.getUTCMonth();
  let date = taipeiNow.getUTCDate();

  if (period === "weekly") {
    const daysSinceMonday = (taipeiNow.getUTCDay() + 6) % 7;
    date -= daysSinceMonday;
  } else if (period === "monthly") {
    date = 1;
  }

  const from = new Date(Date.UTC(year, month, date) - TAIPEI_OFFSET_MS);
  return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
};

const topMenuItemsGroupBy: Record<TopMenuItemsPeriod, AnalyticsGroupBy> = {
  today: "day",
  week: "week",
  month: "month",
};

const buildAnalyticsUrl = (
  endpoint: "dashboard" | "revenue" | "products",
  params: Record<string, string | number>,
) => {
  const searchParams = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );

  return `/analytics/${endpoint}?${searchParams.toString()}`;
};

const getChartLabel = (point: RevenueAnalyticsPoint) =>
  point.label ?? point.date ?? point.week ?? point.month ?? point.year ?? "";

const mapRevenuePoints = (
  points: RevenueAnalyticsPoint[],
  valueSelector: (point: RevenueAnalyticsPoint) => number | undefined,
) =>
  points.map((point) => ({
    label: getChartLabel(point),
    value: point.value ?? valueSelector(point) ?? 0,
  })) as ChartData[];

export const useDashboardStore = defineStore("dashboard", () => {
  const stats = ref<DashboardStats | null>(null);
  const revenueChartData = ref<ChartData[]>([]);
  const ordersChartData = ref<ChartData[]>([]);
  const recentOrdersData = ref<DashboardRecentOrder[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);

  const authStore = useAuthStore();

  // Computed properties
  const todayOrders = computed(() => stats.value?.todayOrders || 0);
  const todayRevenue = computed(() => stats.value?.todayRevenue || 0);
  const averageOrderValue = computed(() => stats.value?.averageOrderValue || 0);
  const completionRate = computed(() => stats.value?.completionRate || 0);
  const topMenuItems = computed(() => stats.value?.topMenuItems || []);
  const revenueChart = computed(() => revenueChartData.value);
  const ordersChart = computed(() => ordersChartData.value);
  const recentOrders = computed(() => recentOrdersData.value);

  // Actions
  const fetchDashboardStats = async (dateRange?: {
    from: string;
    to: string;
  }) => {
    if (!authStore.restaurantId) {
      error.value = t("dashboardStore.restaurantIdMissing");
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const params = {
        restaurantId: authStore.restaurantId.toString(),
        ...(dateRange && { from: dateRange.from, to: dateRange.to }),
      };

      const response = await api.get<AnalyticsDashboardPayload>(
        buildAnalyticsUrl("dashboard", params),
      );

      if (response.data.success && response.data.data) {
        const payload = response.data.data;
        stats.value = mapDashboardPayload(payload);
        recentOrdersData.value = payload.recentOrders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          total: order.totalAmount,
          tableNumber: order.tableNumber ?? "",
          createdAt: new Date(order.createdAt).toISOString(),
        }));
        lastUpdated.value = new Date();
      } else {
        error.value =
          response.data.error?.message || t("dashboardStore.fetchDataFailed");
      }
    } catch (err: unknown) {
      error.value = resolveUserFacingError(err, t, {
        fallbackKey: "dashboardStore.fetchDashboardFailed",
        codeKeys: {
          MODULE_NOT_ENABLED: "errors.subscription.moduleNotEnabled",
          TRIAL_EXPIRED: "errors.subscription.trialExpired",
          SUBSCRIPTION_NOT_FOUND: "errors.subscription.subscriptionNotFound",
          NO_RESTAURANT: "errors.subscription.noRestaurant",
        },
      }).message;
      console.error("Dashboard fetch error:", err);
    } finally {
      isLoading.value = false;
    }
  };

  const fetchRevenueAnalytics = async (period: AnalyticsPeriod) => {
    if (!authStore.restaurantId) return [];

    try {
      const dateRange = getAnalyticsDateRange(period);
      const response = await api.get(
        buildAnalyticsUrl("revenue", {
          restaurantId: authStore.restaurantId,
          groupBy: periodGroupBy[period],
          ...dateRange,
        }),
      );

      if (response.data.success) {
        const data = response.data.data as RevenueAnalyticsPoint[];
        // This request is always scoped to one restaurant, and a restaurant
        // has one currency, so there is at most one entry. The chart plots
        // major units.
        const points = mapRevenuePoints(data, (point) =>
          point.revenue?.[0] ? point.revenue[0].amountCents / 100 : undefined,
        );
        revenueChartData.value = points;
        return points;
      }
      return [];
    } catch (err) {
      console.error("Revenue analytics fetch error:", err);
      return [];
    }
  };

  const fetchOrderAnalytics = async (period: AnalyticsPeriod) => {
    if (!authStore.restaurantId) return [];

    try {
      const dateRange = getAnalyticsDateRange(period);
      const response = await api.get(
        // The revenue endpoint is the time-series analytics contract. Its
        // `orderCount` field supplies the matching orders series; /performance
        // is a single aggregate and cannot drive a period chart.
        buildAnalyticsUrl("revenue", {
          restaurantId: authStore.restaurantId,
          groupBy: periodGroupBy[period],
          ...dateRange,
        }),
      );

      if (response.data.success) {
        const data = response.data.data as RevenueAnalyticsPoint[];
        const points = mapRevenuePoints(
          data,
          (point) => point.orderCount ?? point.orders,
        );
        ordersChartData.value = points;
        return points;
      }
      return [];
    } catch (err) {
      console.error("Order analytics fetch error:", err);
      return [];
    }
  };

  const fetchTopMenuItems = async (
    limit: number = 10,
    period: TopMenuItemsPeriod = "today",
  ) => {
    if (!authStore.restaurantId) return [];

    try {
      const response = await api.get(
        buildAnalyticsUrl("products", {
          restaurantId: authStore.restaurantId,
          limit,
          groupBy: topMenuItemsGroupBy[period],
        }),
      );

      if (response.data.success) {
        const data = response.data.data as ProductAnalyticsPayload;
        const popularItems = Array.isArray(data) ? data : data.popularItems;
        return (popularItems ?? []).slice(0, limit).map((item) => ({
          name: item.name ?? item.itemName,
          count: item.count ?? item.quantity ?? item.orders ?? 0,
          revenue: item.revenue ?? 0,
        }));
      }
      return [];
    } catch (err) {
      console.error("Top menu items fetch error:", err);
      return [];
    }
  };

  const refreshStats = () => {
    return fetchDashboardStats();
  };

  const clearStats = () => {
    stats.value = null;
    revenueChartData.value = [];
    ordersChartData.value = [];
    recentOrdersData.value = [];
    error.value = null;
    lastUpdated.value = null;
  };

  // Helper functions for formatting
  const { formatPrice } = useCurrency();

  const formatCurrency = (amount: number) => formatPrice(amount);

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  const getGrowthIndicator = (current: number, previous: number) => {
    if (previous === 0) return { value: 0, isPositive: true };

    const growth = ((current - previous) / previous) * 100;
    return {
      value: Math.abs(growth),
      isPositive: growth >= 0,
    };
  };

  // Auto-refresh functionality
  let refreshInterval: number | null = null;

  const startAutoRefresh = (intervalMs: number = 30000) => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }

    refreshInterval = window.setInterval(() => {
      if (authStore.isAuthenticated) {
        fetchDashboardStats();
      }
    }, intervalMs);
  };

  const stopAutoRefresh = () => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  };

  return {
    stats: readonly(stats),
    isLoading: readonly(isLoading),
    error: readonly(error),
    lastUpdated: readonly(lastUpdated),
    todayOrders,
    todayRevenue,
    averageOrderValue,
    completionRate,
    topMenuItems,
    revenueChart,
    ordersChart,
    recentOrders,
    fetchDashboardStats,
    fetchRevenueAnalytics,
    fetchOrderAnalytics,
    fetchTopMenuItems,
    refreshStats,
    clearStats,
    formatCurrency,
    formatPercentage,
    getGrowthIndicator,
    startAutoRefresh,
    stopAutoRefresh,
  };
});
