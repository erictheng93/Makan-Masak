<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">
          {{ t("dashboard.title") }}
        </h1>
        <p class="text-gray-600">
          {{ t("dashboard.welcome", { username: user?.username ?? "" }) }}
        </p>
      </div>
      <div class="flex items-center space-x-3">
        <div class="text-sm text-gray-500">
          {{ t("dashboard.lastUpdated", { time: lastUpdatedText }) }}
        </div>
        <button
          :disabled="isLoading"
          class="btn-secondary"
          :class="{ 'opacity-50': isLoading }"
          @click="refreshData"
        >
          <RefreshCw
            class="w-4 h-4 mr-2"
            :class="{ 'animate-spin': isLoading }"
          />
          {{ t("dashboard.refresh") }}
        </button>
      </div>
    </div>

    <div
      v-if="dashboardStore.error"
      class="rounded-2xl bg-ios-error/10 px-4 py-3 text-sm text-ios-error shadow-ios-sm"
      role="alert"
    >
      {{ dashboardStore.error }}
    </div>

    <SetupChecklistCard />

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatsCard
        :title="t('dashboard.todayOrders')"
        :value="todayOrders"
        icon="shopping-cart"
        color="blue"
        :loading="isLoading"
      />
      <StatsCard
        :title="t('dashboard.todayRevenue')"
        :value="formatCurrency(todayRevenue)"
        icon="dollar-sign"
        color="green"
        :loading="isLoading"
      />
      <StatsCard
        :title="t('dashboard.averageOrderValue')"
        :value="formatCurrency(averageOrderValue)"
        icon="trending-up"
        color="teal"
        :loading="isLoading"
      />
      <StatsCard
        :title="t('dashboard.completionRate')"
        :value="formatPercentage(completionRate)"
        icon="check-circle"
        color="orange"
        :loading="isLoading"
      />
    </div>

    <!-- Realtime Notifications -->
    <div class="card p-0">
      <RealtimeNotificationPanel />
    </div>

    <!-- Charts Section - 🚀 使用懶加載優化 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Revenue Chart -->
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("dashboard.revenueTrend") }}
          </h3>
          <select
            v-model="revenueChartPeriod"
            class="form-input w-auto"
            @change="updateRevenueChart"
          >
            <option value="daily">{{ t("dashboard.today") }}</option>
            <option value="weekly">{{ t("dashboard.thisWeek") }}</option>
            <option value="monthly">{{ t("dashboard.thisMonth") }}</option>
          </select>
        </div>
        <!-- 懶加載：只在可見時渲染圖表 -->
        <LazyChart
          min-height="300px"
          :loading-text="t('dashboard.loadingRevenueChart')"
        >
          <RevenueChart
            :data="revenueChart"
            :loading="isLoading"
            :period="revenueChartPeriod"
          />
        </LazyChart>
      </div>

      <!-- Orders Chart -->
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("dashboard.orderTrend") }}
          </h3>
          <select
            v-model="ordersChartPeriod"
            class="form-input w-auto"
            @change="updateOrdersChart"
          >
            <option value="daily">{{ t("dashboard.today") }}</option>
            <option value="weekly">{{ t("dashboard.thisWeek") }}</option>
            <option value="monthly">{{ t("dashboard.thisMonth") }}</option>
          </select>
        </div>
        <!-- 懶加載：只在可見時渲染圖表 -->
        <LazyChart
          min-height="300px"
          :loading-text="t('dashboard.loadingOrderChart')"
        >
          <OrdersChart
            :data="ordersChart"
            :loading="isLoading"
            :period="ordersChartPeriod"
          />
        </LazyChart>
      </div>
    </div>

    <!-- Recent Activity Section - 🚀 使用懶加載優化 -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Top Menu Items -->
      <div class="lg:col-span-2">
        <div class="card p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              {{ t("dashboard.popularItems") }}
            </h3>
            <router-link
              to="/dashboard/menu"
              class="text-primary-600 hover:text-primary-700 text-sm font-medium"
            >
              {{ t("dashboard.viewAll") }}
            </router-link>
          </div>
          <!-- 懶加載：只在可見時渲染 -->
          <LazyChart
            min-height="200px"
            :loading-text="t('dashboard.loadingPopularItems')"
          >
            <TopMenuItems
              :items="topMenuItems"
              :loading="isLoading"
              @item-click="navigateToMenuItem"
            />
          </LazyChart>
        </div>
      </div>

      <!-- Recent Orders -->
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("dashboard.recentOrders") }}
          </h3>
          <router-link
            to="/dashboard/orders"
            class="text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            {{ t("dashboard.viewAll") }}
          </router-link>
        </div>
        <RecentOrders
          :orders="recentOrders"
          :loading="isLoading"
          @order-click="navigateToOrder"
        />
      </div>
    </div>

    <!-- Quick Actions -->
    <div v-if="canAccessAdminFeatures" class="card p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">
        {{ t("dashboard.quickActions") }}
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <router-link
          to="/dashboard/menu"
          class="flex flex-col items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Menu class="w-8 h-8 text-primary-600 mb-2" />
          <span class="text-sm font-medium text-gray-900">{{
            t("dashboard.manageMenu")
          }}</span>
        </router-link>

        <router-link
          to="/dashboard/seating"
          class="flex flex-col items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Table class="w-8 h-8 text-primary-600 mb-2" />
          <span class="text-sm font-medium text-gray-900">{{
            t("dashboard.manageTables")
          }}</span>
        </router-link>

        <router-link
          to="/dashboard/employees"
          class="flex flex-col items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Users class="w-8 h-8 text-primary-600 mb-2" />
          <span class="text-sm font-medium text-gray-900">{{
            t("dashboard.manageStaff")
          }}</span>
        </router-link>

        <router-link
          to="/dashboard/pos"
          class="flex flex-col items-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
        >
          <CreditCard class="w-8 h-8 text-green-600 mb-2" />
          <span class="text-sm font-medium text-gray-900">{{
            t("dashboard.posSystem")
          }}</span>
        </router-link>

        <router-link
          to="/dashboard/group-orders"
          class="flex flex-col items-center p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <Users class="w-8 h-8 text-blue-600 mb-2" />
          <span class="text-sm font-medium text-gray-900">{{
            t("dashboard.groupOrders")
          }}</span>
        </router-link>

        <router-link
          to="/dashboard/seating"
          class="flex flex-col items-center p-4 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
        >
          <Clock class="w-8 h-8 text-teal-600 mb-2" />
          <span class="text-sm font-medium text-gray-900">{{
            t("dashboard.waitingManagement")
          }}</span>
        </router-link>

        <router-link
          to="/dashboard/analytics"
          class="flex flex-col items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <BarChart3 class="w-8 h-8 text-primary-600 mb-2" />
          <span class="text-sm font-medium text-gray-900">{{
            t("dashboard.detailedAnalysis")
          }}</span>
        </router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { useDashboardStore } from "@/stores/dashboard";
import type { ChartData, TopMenuItem } from "@/types";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  RefreshCw,
  Menu,
  Table,
  Users,
  BarChart3,
  CreditCard,
  Clock,
} from "lucide-vue-next";

// Components (these would be implemented separately)
import StatsCard from "@/components/dashboard/StatsCard.vue";
import RevenueChart from "@/components/dashboard/RevenueChart.vue";
import OrdersChart from "@/components/dashboard/OrdersChart.vue";
import TopMenuItems from "@/components/dashboard/TopMenuItems.vue";
import RecentOrders from "@/components/dashboard/RecentOrders.vue";
import SetupChecklistCard from "@/components/dashboard/SetupChecklistCard.vue";
import RealtimeNotificationPanel from "@/components/RealtimeNotificationPanel.vue";

// 🚀 懶加載優化：只加載可見的圖表
import LazyChart from "@/components/LazyChart.vue";

const { t } = useI18n();
const { formatRelativeTime } = useDateFormatter();
const router = useRouter();
const authStore = useAuthStore();
const dashboardStore = useDashboardStore();

type DashboardChartPeriod = "daily" | "weekly" | "monthly";

interface RevenueChartPoint {
  label: string;
  value: number;
  date: string;
}

interface OrdersChartPoint {
  label: string;
  total: number;
  date: string;
}

interface DashboardTopMenuItem {
  id: string;
  name: string;
  quantity: number;
  revenue: number;
  category?: string;
  percentage?: number;
}

const revenueChartPeriod = ref<DashboardChartPeriod>("daily");
const ordersChartPeriod = ref<DashboardChartPeriod>("daily");

const user = computed(() => authStore.user);
const isLoading = computed(() => dashboardStore.isLoading);
const canAccessAdminFeatures = computed(() => authStore.canAccessAdminFeatures);

// Dashboard stats
const todayOrders = computed(() => dashboardStore.todayOrders);
const todayRevenue = computed(() => dashboardStore.todayRevenue);
const averageOrderValue = computed(() => dashboardStore.averageOrderValue);
const completionRate = computed(() => dashboardStore.completionRate);

const getChartDate = (point: ChartData) => point.date ?? point.label;

const topMenuItems = computed<DashboardTopMenuItem[]>(() =>
  dashboardStore.topMenuItems.map((item: TopMenuItem, index) => ({
    id: String(item.id ?? `${item.name}-${index}`),
    name: item.name,
    quantity: item.quantity ?? item.count ?? 0,
    revenue: item.revenue,
    category: item.category,
    percentage: item.percentage,
  })),
);

const revenueChart = computed<RevenueChartPoint[]>(() =>
  dashboardStore.revenueChart.map((point) => ({
    label: point.label,
    value: point.value,
    date: getChartDate(point),
  })),
);

const ordersChart = computed<OrdersChartPoint[]>(() =>
  dashboardStore.ordersChart.map((point) => ({
    label: point.label,
    total: point.value,
    date: getChartDate(point),
  })),
);

const recentOrders = computed(() => dashboardStore.recentOrders);

const lastUpdatedText = computed(() => {
  if (!dashboardStore.lastUpdated) return t("dashboard.neverUpdated");
  return formatRelativeTime(dashboardStore.lastUpdated);
});

const formatCurrency = (amount: number) => {
  return dashboardStore.formatCurrency(amount);
};

const formatPercentage = (value: number) => {
  return dashboardStore.formatPercentage(value);
};

const refreshData = async () => {
  // The two charts read their own state, filled only by these calls. Without
  // them here they stay empty until someone picks a *different* period from a
  // dropdown that already defaults to "daily" -- so the common path is a
  // dashboard with two blank charts that the refresh button does not fix.
  await Promise.all([
    dashboardStore.fetchDashboardStats(),
    updateRevenueChart(),
    updateOrdersChart(),
  ]);
};

const updateRevenueChart = async () => {
  await dashboardStore.fetchRevenueAnalytics(revenueChartPeriod.value);
};

const updateOrdersChart = async () => {
  await dashboardStore.fetchOrderAnalytics(ordersChartPeriod.value);
};

const navigateToMenuItem = (item: DashboardTopMenuItem) => {
  router.push({
    path: "/dashboard/menu",
    query: { highlightItem: String(item.id) },
  });
};

const navigateToOrder = () => {
  router.push("/dashboard/orders");
};

onMounted(async () => {
  // Initial data load
  await refreshData();

  dashboardStore.startAutoRefresh(30000);
});

onUnmounted(() => {
  dashboardStore.stopAutoRefresh();
});
</script>
