<template>
  <div class="analytics-view">
    <!-- 頁面標題和日期選擇 -->
    <div
      class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8"
    >
      <div>
        <h1 class="text-2xl font-bold text-gray-900">
          {{ t("analytics.title") }}
        </h1>
        <p class="text-gray-600">{{ t("analytics.subtitle") }}</p>
      </div>
      <div class="mt-4 sm:mt-0 flex items-center space-x-4">
        <select
          v-model="selectedPeriod"
          class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="today">{{ t("analytics.period.today") }}</option>
          <option value="week">{{ t("analytics.period.week") }}</option>
          <option value="month">{{ t("analytics.period.month") }}</option>
          <option value="quarter">{{ t("analytics.period.quarter") }}</option>
          <option value="year">{{ t("analytics.period.year") }}</option>
        </select>
        <button
          class="flex items-center px-4 py-2 bg-primary-600 text-white rounded-full hover:bg-primary-700 transition-colors disabled:opacity-50"
          :disabled="isExporting"
          @click="exportReport"
        >
          <DocumentArrowDownIcon class="h-4 w-4 mr-2" />
          {{
            isExporting ? t("analytics.exporting") : t("analytics.exportReport")
          }}
        </button>
      </div>
    </div>

    <!-- 載入錯誤提示 -->
    <div
      v-if="error"
      class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center justify-between"
    >
      <span>{{ error }}</span>
      <button
        class="text-red-600 hover:text-red-800 underline text-sm"
        @click="fetchAllData"
      >
        {{ t("analytics.retry") }}
      </button>
    </div>

    <!-- 關鍵指標卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <!-- 總營收 -->
      <div class="bg-white rounded-2xl shadow-ios-card p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-green-100">
            <CurrencyDollarIcon class="h-8 w-8 text-green-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-500">
              {{ t("analytics.metrics.totalRevenue") }}
            </p>
            <p v-if="isLoading" class="text-2xl font-bold text-gray-300">--</p>
            <p v-else class="text-2xl font-bold text-gray-900">
              {{ formatMoneyByCurrency(revenueTotals) }}
            </p>
            <p v-if="!isLoading" class="text-sm text-gray-600">
              {{ formatGrowthByCurrency(performanceData.revenueGrowth) }}
              {{ t("analytics.metrics.vsPrevious") }}
            </p>
          </div>
        </div>
      </div>

      <!-- 訂單數量 -->
      <div class="bg-white rounded-2xl shadow-ios-card p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-blue-100">
            <ShoppingBagIcon class="h-8 w-8 text-blue-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-500">
              {{ t("analytics.metrics.totalOrders") }}
            </p>
            <p v-if="isLoading" class="text-2xl font-bold text-gray-300">--</p>
            <p v-else class="text-2xl font-bold text-gray-900">
              {{ metrics.totalOrders }}
            </p>
            <p
              v-if="!isLoading"
              :class="
                metrics.ordersChange >= 0 ? 'text-green-600' : 'text-red-600'
              "
              class="text-sm"
            >
              <ArrowTrendingUpIcon
                v-if="metrics.ordersChange >= 0"
                class="w-4 h-4 inline mr-1"
              />
              <ArrowTrendingDownIcon v-else class="w-4 h-4 inline mr-1" />
              {{ Math.abs(metrics.ordersChange).toFixed(1) }}%
              {{ t("analytics.metrics.vsPrevious") }}
            </p>
          </div>
        </div>
      </div>

      <!-- 平均客單價 -->
      <div class="bg-white rounded-2xl shadow-ios-card p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-teal-100">
            <CalculatorIcon class="h-8 w-8 text-teal-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-500">
              {{ t("analytics.metrics.averageOrderValue") }}
            </p>
            <p v-if="isLoading" class="text-2xl font-bold text-gray-300">--</p>
            <p v-else class="text-2xl font-bold text-gray-900">
              {{ formatMoneyByCurrency(metrics.averageOrderValue) }}
            </p>
            <p v-if="!isLoading" class="text-sm text-gray-600">
              {{
                formatGrowthByCurrency(performanceData.averageOrderValueGrowth)
              }}
              {{ t("analytics.metrics.vsPrevious") }}
            </p>
          </div>
        </div>
      </div>

      <!-- 桌台使用率 -->
      <div class="bg-white rounded-2xl shadow-ios-card p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-yellow-100">
            <TableCellsIcon class="h-8 w-8 text-yellow-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-500">
              {{ t("analytics.metrics.tableUtilization") }}
            </p>
            <p v-if="isLoading" class="text-2xl font-bold text-gray-300">--</p>
            <p v-else class="text-2xl font-bold text-gray-900">
              {{ metrics.tableUtilization }}%
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 圖表區域 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
      <!-- 營收趨勢圖 -->
      <div class="bg-white rounded-2xl shadow-ios-card p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("analytics.charts.revenueTrend") }}
        </h3>
        <div v-if="isLoading" class="h-64 flex items-center justify-center">
          <p class="text-gray-400">{{ t("analytics.loading") }}</p>
        </div>
        <div
          v-else-if="revenueChartData.length === 0"
          class="h-64 flex items-center justify-center bg-gray-50 rounded-lg"
        >
          <div class="text-center">
            <ChartBarIcon class="mx-auto h-12 w-12 text-gray-400 mb-2" />
            <p class="text-gray-500">{{ t("analytics.noData") }}</p>
          </div>
        </div>
        <div v-else class="h-64 space-y-2 overflow-y-auto">
          <div
            v-for="item in revenueChartData"
            :key="`${item.date}-${item.currency}`"
            class="flex items-center justify-between text-sm"
          >
            <span class="text-gray-600 w-24 flex-shrink-0">
              {{ formatDate(item.date) }} · {{ item.currency }}
            </span>
            <div class="flex-1 mx-3">
              <div class="bg-gray-200 rounded-full h-4">
                <div
                  :style="{ width: `${item.percentage}%` }"
                  class="bg-green-500 h-4 rounded-full transition-all duration-300"
                />
              </div>
            </div>
            <span class="text-gray-900 font-medium w-24 text-right">
              {{ formatCents(item.amountCents, item.currency) }}
            </span>
          </div>
        </div>
      </div>

      <!-- 訂單狀態分布 -->
      <div class="bg-white rounded-2xl shadow-ios-card p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("analytics.charts.orderStatusDist") }}
        </h3>
        <div v-if="isLoading" class="h-64 flex items-center justify-center">
          <p class="text-gray-400">{{ t("analytics.loading") }}</p>
        </div>
        <div v-else class="h-64">
          <div class="grid grid-cols-2 gap-4 h-full">
            <div
              v-for="status in orderStatusData"
              :key="status.name"
              class="flex flex-col items-center justify-center"
            >
              <div
                :class="status.color"
                class="w-16 h-16 rounded-full flex items-center justify-center mb-2"
              >
                <span :class="status.textColor" class="font-bold text-lg">{{
                  status.count
                }}</span>
              </div>
              <p class="text-sm text-gray-600 text-center">
                {{ status.name }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 熱門菜品和詳細數據 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <!-- 熱門菜品 -->
      <div class="bg-white rounded-2xl shadow-ios-card">
        <div class="p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">
            {{ t("analytics.popularItems.title") }}
          </h3>
          <div v-if="isLoading" class="text-center py-8 text-gray-400">
            {{ t("analytics.loading") }}
          </div>
          <div
            v-else-if="popularItems.length === 0"
            class="text-center py-8 text-gray-400"
          >
            {{ t("analytics.noData") }}
          </div>
          <div v-else class="space-y-4">
            <div
              v-for="(item, index) in popularItems"
              :key="item.id"
              class="flex items-center justify-between"
            >
              <div class="flex items-center">
                <div
                  class="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center"
                >
                  <span class="text-blue-800 font-semibold text-sm">{{
                    index + 1
                  }}</span>
                </div>
                <div class="ml-4">
                  <p class="text-sm font-medium text-gray-900">
                    {{ item.name }}
                  </p>
                  <p class="text-sm text-gray-500">
                    {{
                      t("analytics.popularItems.ordersCount", {
                        count: item.orders,
                      })
                    }}
                  </p>
                </div>
              </div>
              <div class="text-right">
                <p class="text-sm font-medium text-gray-900">
                  {{ formatCurrency(item.revenue, item.currency) }}
                </p>
                <div class="w-32 bg-gray-200 rounded-full h-2 mt-1">
                  <div
                    :style="{
                      width: `${popularItems[0]?.orders ? (item.orders / popularItems[0].orders) * 100 : 0}%`,
                    }"
                    class="bg-blue-600 h-2 rounded-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 營業時段分析 -->
      <div class="bg-white rounded-2xl shadow-ios-card">
        <div class="p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">
            {{ t("analytics.businessHours.title") }}
          </h3>
          <div v-if="isLoading" class="text-center py-8 text-gray-400">
            {{ t("analytics.loading") }}
          </div>
          <div
            v-else-if="businessHours.length === 0"
            class="text-center py-8 text-gray-400"
          >
            {{ t("analytics.noData") }}
          </div>
          <div v-else class="space-y-4">
            <div
              v-for="period in businessHours"
              :key="period.time"
              class="flex items-center justify-between"
            >
              <div class="flex items-center">
                <ClockIcon class="w-5 h-5 text-gray-400 mr-3" />
                <span class="text-sm font-medium text-gray-900">{{
                  period.time
                }}</span>
              </div>
              <div class="flex items-center">
                <div class="w-32 bg-gray-200 rounded-full h-2 mr-3">
                  <div
                    :style="{ width: `${period.percentage}%` }"
                    :class="getBusinessHourColor(period.percentage)"
                    class="h-2 rounded-full"
                  />
                </div>
                <span class="text-sm text-gray-600 w-16">{{
                  t("analytics.businessHours.orders", { count: period.orders })
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 詳細報表 -->
    <div class="mt-8 bg-white rounded-2xl shadow-ios-card">
      <div class="p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("analytics.detailedReport.title") }}
        </h3>
        <div v-if="isLoading" class="text-center py-8 text-gray-400">
          {{ t("analytics.loading") }}
        </div>
        <div
          v-else-if="dailyData.length === 0"
          class="text-center py-8 text-gray-400"
        >
          {{ t("analytics.noData") }}
        </div>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  {{ t("analytics.detailedReport.date") }}
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  {{ t("analytics.detailedReport.orders") }}
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  {{ t("analytics.detailedReport.revenue") }}
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  {{ t("analytics.detailedReport.averageOrder") }}
                </th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr
                v-for="day in dailyData"
                :key="day.date"
                class="hover:bg-gray-50"
              >
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {{ day.date }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {{ day.orders }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {{ formatMoneyByCurrency(day.revenue) }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {{ formatMoneyByCurrency(day.averageOrder) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "@/i18n";
import { formatCurrency } from "@makanmasak/utils";
import type { CurrencyCode } from "@makanmasak/shared-types";
import {
  analyticsDateRange,
  type AnalyticsPeriod,
} from "@/utils/analyticsPeriod";
import { buildBusinessHourSlots } from "@/utils/businessHourSlots";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import {
  CurrencyDollarIcon,
  ShoppingBagIcon,
  CalculatorIcon,
  TableCellsIcon,
  ChartBarIcon,
  DocumentArrowDownIcon,
  ClockIcon,
} from "@heroicons/vue/24/outline";

const { t } = useI18n();
const authStore = useAuthStore();

type MoneyByCurrency = Array<{
  currency: CurrencyCode;
  amountCents: number;
}>;

// State
const selectedPeriod = ref("today");
const isLoading = ref(false);
const isExporting = ref(false);
const error = ref<string | null>(null);

// Raw API data
const dashboardSummary = ref<{
  todayRevenue: number;
  todayOrders: number;
  monthRevenue: number;
  monthOrders: number;
  growthRates: { revenueGrowth: number; orderGrowth: number };
}>({
  todayRevenue: 0,
  todayOrders: 0,
  monthRevenue: 0,
  monthOrders: 0,
  growthRates: { revenueGrowth: 0, orderGrowth: 0 },
});

const performanceData = ref<{
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  averageOrderValue: MoneyByCurrency;
  totalRevenue: MoneyByCurrency;
  conversionRate: number;
  averagePreparationTime: number;
  popularTimeSlots: Array<{ hour: number; orderCount: number }>;
  // Change against the equally long window before the selected one, computed
  // server-side so it describes the same span as the figures above it (#312).
  revenueGrowth: Array<{ currency: CurrencyCode; percentage: number }>;
  averageOrderValueGrowth: Array<{
    currency: CurrencyCode;
    percentage: number;
  }>;
  orderGrowth: number;
}>({
  totalOrders: 0,
  completedOrders: 0,
  cancelledOrders: 0,
  averageOrderValue: [],
  totalRevenue: [],
  conversionRate: 0,
  averagePreparationTime: 0,
  popularTimeSlots: [],
  revenueGrowth: [],
  averageOrderValueGrowth: [],
  orderGrowth: 0,
});

const productAnalytics = ref<{
  popularItems: Array<{
    itemId: number;
    itemName: string;
    categoryName: string;
    quantity: number;
    revenue: number;
    currency: CurrencyCode;
  }>;
}>({ popularItems: [] });

const revenueDataRaw = ref<
  Array<{
    date: string;
    revenue: MoneyByCurrency;
    orderCount: number;
    averageOrderValue: MoneyByCurrency;
  }>
>([]);

const currentTableUtilization = ref(0);

// Compute date range based on selected period
// Calendar boundaries, not rolling windows -- see analyticsDateRange. Kept as
// a wrapper so the selector's value stays the single input.
function getDateRange() {
  return analyticsDateRange(selectedPeriod.value as AnalyticsPeriod);
}

// Map period to dashboard API param
function getDashboardPeriod(): string {
  const map: Record<string, string> = {
    today: "today",
    week: "week",
    month: "month",
    quarter: "month",
    year: "year",
  };
  return map[selectedPeriod.value] || "today";
}

function buildAnalyticsUrl(
  endpoint: string,
  params: Record<string, string | number | boolean> = {},
): string {
  const searchParams = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );

  if (authStore.restaurantId) {
    searchParams.set("restaurantId", String(authStore.restaurantId));
  }

  const query = searchParams.toString();
  return query ? `/analytics/${endpoint}?${query}` : `/analytics/${endpoint}`;
}

// Computed: metrics for summary cards
const metrics = computed(() => ({
  // These come from the same response as the figures they sit beside, so both
  // describe the selected period. They used to come from the dashboard
  // summary, whose growth rates are always month-over-month: picking 本年 put a
  // year's revenue next to a monthly change (#312).
  totalOrders: performanceData.value.totalOrders || 0,
  ordersChange: performanceData.value.orderGrowth || 0,
  averageOrderValue: performanceData.value.averageOrderValue,
  tableUtilization: currentTableUtilization.value,
}));

// The performance endpoint is the canonical full-window aggregate. Revenue
// buckets are chart data and may be capped by the requested `limit`, so adding
// them here would silently understate a long selected period.
const revenueTotals = computed(() => performanceData.value.totalRevenue);

// Computed: order status distribution
const orderStatusData = computed(() => {
  const total = performanceData.value.totalOrders || 0;
  const completed = performanceData.value.completedOrders || 0;
  const cancelled = performanceData.value.cancelledOrders || 0;
  const inProgress = Math.max(0, total - completed - cancelled);

  return [
    {
      name: t("analytics.orderStatus.delivered"),
      count: completed,
      color: "bg-green-100",
      textColor: "text-green-700",
    },
    {
      name: t("analytics.orderStatus.preparing"),
      count: inProgress,
      color: "bg-blue-100",
      textColor: "text-blue-700",
    },
    {
      name: t("analytics.orderStatus.pending"),
      count: 0,
      color: "bg-amber-100",
      textColor: "text-amber-700",
    },
    {
      name: t("analytics.orderStatus.cancelled"),
      count: cancelled,
      color: "bg-red-100",
      textColor: "text-red-700",
    },
  ];
});

// Computed: popular items
const popularItems = computed(() => {
  return (productAnalytics.value.popularItems || [])
    .slice(0, 5)
    .map((item) => ({
      id: item.itemId,
      name: item.itemName,
      orders: item.quantity,
      revenue: item.revenue,
      currency: item.currency,
    }));
});

// Computed: business hours from popular time slots
const businessHours = computed(() =>
  buildBusinessHourSlots(
    performanceData.value.popularTimeSlots || [],
    selectedPeriod.value === "today",
  ),
);

// Computed: revenue chart data
const revenueChartData = computed(() => {
  const data = revenueDataRaw.value || [];
  if (data.length === 0) return [];

  const values = data.flatMap((bucket) => bucket.revenue);
  const maximumByCurrency = new Map<CurrencyCode, number>();
  for (const value of values) {
    maximumByCurrency.set(
      value.currency,
      Math.max(maximumByCurrency.get(value.currency) ?? 0, value.amountCents),
    );
  }

  return data.flatMap((bucket) =>
    bucket.revenue.map((value) => ({
      date: bucket.date,
      currency: value.currency,
      amountCents: value.amountCents,
      percentage: Math.round(
        (value.amountCents /
          Math.max(maximumByCurrency.get(value.currency) ?? 0, 1)) *
          100,
      ),
    })),
  );
});

// Computed: daily data for detailed table
const dailyData = computed(() => {
  return (revenueDataRaw.value || []).map((d) => ({
    date: d.date,
    orders: d.orderCount,
    revenue: d.revenue,
    averageOrder: d.averageOrderValue,
  }));
});

// Format date for display
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  } catch {
    return dateStr;
  }
}

function formatCents(cents: number, currency: CurrencyCode): string {
  return formatCurrency(cents / 100, currency);
}

function formatMoneyByCurrency(amounts: MoneyByCurrency): string {
  if (amounts.length === 0) return "—";
  return amounts
    .map((amount) => formatCents(amount.amountCents, amount.currency))
    .join(" · ");
}

function formatGrowthByCurrency(
  growthRates: Array<{ currency: CurrencyCode; percentage: number }>,
): string {
  if (growthRates.length === 0) return "—";
  return growthRates
    .map(
      ({ currency, percentage }) =>
        `${percentage >= 0 ? "+" : ""}${percentage.toFixed(1)}% ${currency}`,
    )
    .join(" · ");
}

// Business hour bar color
const getBusinessHourColor = (percentage: number) => {
  if (percentage >= 60) return "bg-green-500";
  if (percentage >= 40) return "bg-yellow-500";
  return "bg-red-500";
};

// Fetch all analytics data
async function fetchAllData() {
  isLoading.value = true;
  error.value = null;

  const { dateFrom, dateTo } = getDateRange();
  const dashboardPeriod = getDashboardPeriod();

  try {
    const [dashboardRes, perfRes, productsRes, revenueRes, realtimeRes] =
      await Promise.allSettled([
        api.get(buildAnalyticsUrl("dashboard", { period: dashboardPeriod })),
        api.get(
          buildAnalyticsUrl("performance", {
            dateFrom,
            dateTo,
            groupBy: "day",
          }),
        ),
        api.get(
          buildAnalyticsUrl("products", {
            dateFrom,
            dateTo,
            limit: 5,
          }),
        ),
        api.get(
          buildAnalyticsUrl("revenue", {
            dateFrom,
            dateTo,
            groupBy: "day",
            includeComparison: true,
          }),
        ),
        api.get(buildAnalyticsUrl("realtime-dashboard")),
      ]);

    if (
      dashboardRes.status === "fulfilled" &&
      dashboardRes.value.data?.success
    ) {
      dashboardSummary.value = dashboardRes.value.data
        .data as typeof dashboardSummary.value;
    }

    if (perfRes.status === "fulfilled" && perfRes.value.data?.success) {
      performanceData.value = perfRes.value.data
        .data as typeof performanceData.value;
    }

    if (productsRes.status === "fulfilled" && productsRes.value.data?.success) {
      productAnalytics.value = productsRes.value.data
        .data as typeof productAnalytics.value;
    }

    if (revenueRes.status === "fulfilled" && revenueRes.value.data?.success) {
      revenueDataRaw.value = (revenueRes.value.data.data ||
        []) as typeof revenueDataRaw.value;
    }

    if (realtimeRes.status === "fulfilled" && realtimeRes.value.data?.success) {
      const realtimeData = realtimeRes.value.data.data as {
        tableUtilization?: number;
      };
      currentTableUtilization.value = realtimeData?.tableUtilization || 0;
    }

    // Check if all failed
    const allFailed = [
      dashboardRes,
      perfRes,
      productsRes,
      revenueRes,
      realtimeRes,
    ].every((r) => r.status === "rejected");
    if (allFailed) {
      error.value = t("analytics.fetchError");
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("analytics.fetchError");
  } finally {
    isLoading.value = false;
  }
}

// Export report as CSV (generated client-side from displayed data)
function exportReport() {
  isExporting.value = true;
  try {
    generateLocalCSV();
  } finally {
    isExporting.value = false;
  }
}

function generateLocalCSV() {
  const headers = [
    t("analytics.detailedReport.date"),
    t("analytics.detailedReport.orders"),
    t("analytics.detailedReport.revenue"),
    t("analytics.detailedReport.averageOrder"),
  ];

  const rows = dailyData.value.map((d) => [
    d.date,
    d.orders.toString(),
    formatMoneyByCurrency(d.revenue),
    formatMoneyByCurrency(d.averageOrder),
  ]);

  const csvContent = [headers, ...rows].map((row) => row.join(",")).join("\n");
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `analytics_${selectedPeriod.value}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Watch period changes and refetch
watch(selectedPeriod, () => {
  fetchAllData();
});

onMounted(() => {
  fetchAllData();
});
</script>

<style scoped>
.analytics-view {
  padding: 1.5rem;
}

@media (max-width: 640px) {
  .analytics-view {
    padding: 1rem;
  }
}
</style>
