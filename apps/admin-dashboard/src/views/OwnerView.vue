<template>
  <div class="space-y-6">
    <!-- 載入錯誤提示 -->
    <div
      v-if="error"
      class="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center justify-between"
    >
      <span>{{ error }}</span>
      <button
        class="text-red-600 hover:text-red-800 underline text-sm"
        @click="fetchAllData"
      >
        {{ t("owner.retry") }}
      </button>
    </div>

    <!-- 主要 KPI 指標 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div
        v-for="kpi in kpiMetrics"
        :key="kpi.key"
        class="bg-white rounded-lg shadow-sm p-6 border-l-4"
        :class="kpi.borderColor"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-600">
              {{ kpi.label }}
            </p>
            <p class="text-2xl font-bold text-gray-900">
              {{ kpi.value }}
            </p>
            <p
              :class="[
                'text-sm flex items-center mt-2',
                kpi.trend === 'up'
                  ? 'text-green-600'
                  : kpi.trend === 'down'
                    ? 'text-red-600'
                    : 'text-gray-500',
              ]"
            >
              <component :is="kpi.trendIcon" class="w-4 h-4 mr-1" />
              {{ kpi.change }}
            </p>
          </div>
          <div
            :class="[
              'w-12 h-12 rounded-lg flex items-center justify-center',
              kpi.bgColor,
            ]"
          >
            <component :is="kpi.icon" class="w-6 h-6 text-white" />
          </div>
        </div>
      </div>
    </div>

    <!-- 快速操作面板 -->
    <div class="bg-white rounded-lg shadow-sm p-6">
      <h2 class="text-lg font-semibold text-gray-900 mb-4">
        {{ t("owner.quickActions") }}
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <button
          v-for="action in quickActions"
          :key="action.key"
          class="flex flex-col items-center p-4 rounded-lg border-2 border-dashed border-gray-300 hover:border-teal-500 hover:bg-teal-50 transition-colors duration-200"
          @click="handleQuickAction(action.key)"
        >
          <component :is="action.icon" class="w-8 h-8 text-gray-400 mb-2" />
          <span class="text-sm font-medium text-gray-700">{{
            action.label
          }}</span>
        </button>
      </div>
    </div>

    <!-- 實時監控儀表板 -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- 實時訂單狀態 -->
      <div class="bg-white rounded-lg shadow-sm p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("owner.realtimeOrders") }}
          </h3>
          <div class="flex items-center text-sm text-gray-500">
            <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2" />
            {{ t("owner.liveUpdate") }}
          </div>
        </div>
        <div v-if="isLoading" class="text-center py-6 text-gray-400">
          {{ t("owner.loading") }}
        </div>
        <div
          v-else-if="realtimeOrders.length === 0"
          class="text-center py-6 text-gray-400"
        >
          {{ t("owner.noData") }}
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="order in realtimeOrders"
            :key="order.id"
            class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
          >
            <div>
              <p class="font-medium text-gray-900">
                {{ t("owner.tableNumber") }} {{ order.tableNumber }}
              </p>
              <p class="text-sm text-gray-600">
                {{ t("owner.itemCount", { count: order.items }) }}
              </p>
            </div>
            <div class="text-right">
              <span
                :class="[
                  'px-2 py-1 rounded-full text-xs font-medium',
                  order.status === 'preparing'
                    ? 'bg-yellow-100 text-yellow-800'
                    : order.status === 'ready'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-blue-100 text-blue-800',
                ]"
              >
                {{ getStatusText(order.status) }}
              </span>
              <p class="text-sm text-gray-500 mt-1">
                {{ order.time }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 員工動態 -->
      <div class="bg-white rounded-lg shadow-sm p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("owner.staffActivity") }}
        </h3>
        <div v-if="isLoading" class="text-center py-6 text-gray-400">
          {{ t("owner.loading") }}
        </div>
        <div
          v-else-if="staffActivity.length === 0"
          class="text-center py-6 text-gray-400"
        >
          {{ t("owner.noData") }}
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="staff in staffActivity"
            :key="staff.id"
            class="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg"
          >
            <div
              :class="[
                'w-3 h-3 rounded-full',
                staff.status === 'online'
                  ? 'bg-green-500'
                  : staff.status === 'busy'
                    ? 'bg-yellow-500'
                    : 'bg-red-500',
              ]"
            />
            <div class="flex-1">
              <p class="font-medium text-gray-900">
                {{ staff.name }}
              </p>
              <p class="text-sm text-gray-600">
                {{ staff.role }}
              </p>
            </div>
            <div class="text-right">
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                :class="{
                  'bg-green-100 text-green-800': staff.status === 'online',
                  'bg-yellow-100 text-yellow-800': staff.status === 'busy',
                  'bg-gray-100 text-gray-600': staff.status === 'offline',
                }"
              >
                {{
                  staff.status === "online"
                    ? t("owner.statusOnline")
                    : staff.status === "busy"
                      ? t("owner.statusBusy")
                      : t("owner.statusOffline")
                }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 財務摘要 -->
      <div class="bg-white rounded-lg shadow-sm p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("owner.todayFinance") }}
        </h3>
        <div class="space-y-4">
          <div class="flex justify-between items-center">
            <span class="text-gray-600">{{ t("owner.revenue") }}</span>
            <span class="font-bold text-green-600">{{
              formatPrice(todayRevenue)
            }}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-600">{{ t("owner.orderCount") }}</span>
            <span class="font-medium text-gray-900">{{ todayOrders }}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-600">{{ t("owner.avgOrderValue") }}</span>
            <span class="font-medium text-gray-900">{{
              formatPrice(avgOrderValue)
            }}</span>
          </div>
          <div class="pt-3 border-t border-gray-200">
            <div class="flex justify-between items-center">
              <span class="text-gray-600">{{
                t("owner.estimatedMonthly")
              }}</span>
              <span class="font-bold text-teal-600">{{
                formatPrice(todayRevenue * 30)
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 營運分析圖表 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- 營業額趨勢 -->
      <div class="bg-white rounded-lg shadow-sm p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("owner.revenueTrend") }}
          </h3>
          <select
            v-model="revenueTimeRange"
            class="text-sm border border-gray-300 rounded-md px-3 py-1"
          >
            <option value="7d">{{ t("owner.timeRange.7d") }}</option>
            <option value="30d">{{ t("owner.timeRange.30d") }}</option>
            <option value="3m">{{ t("owner.timeRange.3m") }}</option>
          </select>
        </div>
        <div class="h-64 flex items-center justify-center text-gray-500">
          <ChartBarIcon class="w-12 h-12 mr-2" />
          {{ t("owner.chartPlaceholder") }}
        </div>
      </div>

      <!-- 熱門商品 -->
      <div class="bg-white rounded-lg shadow-sm p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("owner.popularItems") }}
        </h3>
        <div v-if="isLoading" class="text-center py-6 text-gray-400">
          {{ t("owner.loading") }}
        </div>
        <div
          v-else-if="popularItems.length === 0"
          class="text-center py-6 text-gray-400"
        >
          {{ t("owner.noData") }}
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="item in popularItems"
            :key="item.id"
            class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
          >
            <div class="flex items-center space-x-3">
              <div
                class="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center"
              >
                <span class="text-sm font-bold text-orange-600">{{
                  item.rank
                }}</span>
              </div>
              <div>
                <p class="font-medium text-gray-900">
                  {{ item.name }}
                </p>
                <p class="text-sm text-gray-600">
                  {{ item.category }}
                </p>
              </div>
            </div>
            <div class="text-right">
              <p class="font-medium text-gray-900">
                {{ t("owner.salesCount", { count: item.sales }) }}
              </p>
              <p class="text-sm text-gray-600">
                {{ formatPrice(item.revenue) }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 系統健康狀態 -->
    <div class="bg-white rounded-lg shadow-sm p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">
        {{ t("owner.systemHealth") }}
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div
          v-for="system in systemHealth"
          :key="system.name"
          class="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
        >
          <div class="flex items-center space-x-3">
            <div
              :class="[
                'w-3 h-3 rounded-full',
                system.status === 'healthy'
                  ? 'bg-green-500'
                  : system.status === 'warning'
                    ? 'bg-yellow-500'
                    : 'bg-red-500',
              ]"
            />
            <div>
              <p class="font-medium text-gray-900">
                {{ system.name }}
              </p>
              <p class="text-sm text-gray-600">
                {{ system.description }}
              </p>
            </div>
          </div>
          <div class="text-right">
            <span
              class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
              :class="{
                'bg-green-100 text-green-800': system.status === 'healthy',
                'bg-yellow-100 text-yellow-800': system.status === 'warning',
                'bg-red-100 text-red-800': system.status === 'error',
              }"
            >
              {{
                system.status === "healthy"
                  ? t("owner.statusHealthy")
                  : system.status === "warning"
                    ? t("owner.statusWarning")
                    : t("owner.statusError")
              }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 緊急處理面板 -->
    <div
      v-if="emergencyAlerts.length > 0"
      class="bg-red-50 border border-red-200 rounded-lg p-6"
    >
      <div class="flex items-center mb-4">
        <ExclamationTriangleIcon class="w-6 h-6 text-red-600 mr-2" />
        <h3 class="text-lg font-semibold text-red-900">
          {{ t("owner.emergency") }}
        </h3>
      </div>
      <div class="space-y-3">
        <div
          v-for="alert in emergencyAlerts"
          :key="alert.id"
          class="flex items-center justify-between p-3 bg-white rounded-lg border border-red-200"
        >
          <div>
            <p class="font-medium text-red-900">
              {{ alertTitle(alert) }}
            </p>
            <p class="text-sm text-red-700">
              {{ alertDescription(alert) }}
            </p>
            <p class="text-xs text-red-600 mt-1">
              {{ formatAlertTime(alert.createdAt) }}
            </p>
          </div>
          <div class="flex space-x-2">
            <button
              class="px-3 py-1 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
              @click="handleEmergencyAlert(alert.id, 'resolve')"
            >
              {{ t("owner.resolve") }}
            </button>
            <button
              class="px-3 py-1 bg-red-600 text-white rounded-md text-sm hover:bg-red-700"
              @click="handleEmergencyAlert(alert.id, 'escalate')"
            >
              {{ t("owner.escalate") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useCurrency } from "@/composables/useCurrency";
import { api, unwrapApiList } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { ownerService } from "@/services/ownerService";
import type { EmergencyAlert } from "@/services/ownerService";
import { createAlertPresenter } from "@/utils/alertPresentation";
import { schedulingService } from "@/services/schedulingService";
import {
  hasRequestFailure,
  staffPresence,
  toOnShiftIds,
} from "@/utils/ownerDashboard";
import {
  resolveOwnerSystemHealth,
  type OwnerHealthStatusPayload,
} from "@/utils/ownerSystemHealth";
import {
  toOwnerRealtimeOrder,
  type OwnerActiveOrder,
} from "@/utils/ownerRealtimeOrders";
import {
  CurrencyDollarIcon,
  ShoppingCartIcon,
  UsersIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  MinusIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentListIcon,
  UserPlusIcon,
} from "@heroicons/vue/24/outline";

const { t } = useI18n();
const toast = useToast();
const { formatPrice } = useCurrency();
const router = useRouter();
const authStore = useAuthStore();

// --- State ---
const isLoading = ref(false);
const error = ref<string | null>(null);
const revenueTimeRange = ref("7d");

// --- Raw API data refs ---
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

const dashboardTopItems = ref<
  Array<{
    itemId: number;
    itemName: string;
    quantity: number;
    revenue: number;
  }>
>([]);

const dashboardTableStatus = ref<{
  occupied: number;
  available: number;
  total: number;
}>({ occupied: 0, available: 0, total: 0 });

const activeOrdersData = ref<OwnerActiveOrder[]>([]);

const userStatsData = ref<{
  summary: {
    total_users: number;
    active_users: number;
    inactive_users: number;
  };
}>({
  summary: { total_users: 0, active_users: 0, inactive_users: 0 },
});

// Employee ids clocked in and not yet out, from
// GET /scheduling/:restaurantId/clocked-in. This is the only presence signal
// the system has — there is no session/heartbeat notion of "online".
const onShiftIds = ref<Set<string>>(new Set());

const staffListData = ref<
  Array<{
    id: number;
    username: string;
    fullName?: string;
    role: number;
    status?: string;
  }>
>([]);

const healthData = ref<OwnerHealthStatusPayload | { status: string } | null>(
  null,
);

// --- Quick actions (static UI config, not data) ---
const quickActions = [
  { key: "add-staff", label: t("owner.actions.addStaff"), icon: UserPlusIcon },
  {
    key: "update-menu",
    label: t("owner.actions.updateMenu"),
    icon: DocumentTextIcon,
  },
  {
    key: "view-reports",
    label: t("owner.actions.viewReports"),
    icon: ClipboardDocumentListIcon,
  },
  {
    key: "system-settings",
    label: t("owner.actions.systemSettings"),
    icon: Cog6ToothIcon,
  },
];

// --- Computed: KPI metrics ---
const kpiMetrics = computed(() => {
  const summary = dashboardSummary.value;
  const revenueGrowth = summary.growthRates?.revenueGrowth ?? 0;
  const orderGrowth = summary.growthRates?.orderGrowth ?? 0;
  const activeStaff = userStatsData.value.summary.active_users;
  const onShift = onShiftIds.value.size;

  return [
    {
      key: "revenue",
      label: t("owner.kpi.todayRevenue"),
      value: isLoading.value ? "--" : formatPrice(summary.todayRevenue),
      change: `${revenueGrowth >= 0 ? "+" : ""}${revenueGrowth.toFixed(1)}%`,
      trend: revenueGrowth > 0 ? "up" : revenueGrowth < 0 ? "down" : "stable",
      trendIcon:
        revenueGrowth > 0
          ? ArrowTrendingUpIcon
          : revenueGrowth < 0
            ? ArrowTrendingDownIcon
            : MinusIcon,
      icon: CurrencyDollarIcon,
      borderColor: "border-green-500",
      bgColor: "bg-green-500",
    },
    {
      key: "orders",
      label: t("owner.kpi.todayOrders"),
      value: isLoading.value ? "--" : summary.todayOrders.toString(),
      change: `${orderGrowth >= 0 ? "+" : ""}${orderGrowth.toFixed(1)}%`,
      trend: orderGrowth > 0 ? "up" : orderGrowth < 0 ? "down" : "stable",
      trendIcon:
        orderGrowth > 0
          ? ArrowTrendingUpIcon
          : orderGrowth < 0
            ? ArrowTrendingDownIcon
            : MinusIcon,
      icon: ShoppingCartIcon,
      borderColor: "border-blue-500",
      bgColor: "bg-blue-500",
    },
    {
      key: "staff",
      // Was labelled "online staff" while showing active_users/total_users,
      // i.e. COUNT(*) WHERE is_active = 1 — enabled accounts, which reads N/N
      // until somebody is disabled. Report the shift instead, from the same
      // clock-in signal the staff list below uses, so the two cannot disagree.
      label: t("owner.kpi.onShift"),
      value: isLoading.value ? "--" : `${onShift}/${activeStaff}`,
      change: t("owner.kpi.normal"),
      trend: "stable" as const,
      trendIcon: MinusIcon,
      icon: UsersIcon,
      borderColor: "border-teal-500",
      bgColor: "bg-teal-500",
    },
    {
      key: "tables",
      label: t("owner.kpi.tableUtilization"),
      value: isLoading.value
        ? "--"
        : `${dashboardTableStatus.value.occupied}/${dashboardTableStatus.value.total}`,
      change: `${dashboardTableStatus.value.available} ${t("owner.kpi.available")}`,
      trend: "stable" as const,
      trendIcon: MinusIcon,
      icon: ChartBarIcon,
      borderColor: "border-orange-500",
      bgColor: "bg-orange-500",
    },
  ];
});

// --- Computed: Realtime orders from active orders API ---
const realtimeOrders = computed(() => {
  return activeOrdersData.value
    .slice(0, 5)
    .map((order) => toOwnerRealtimeOrder(order, t));
});

// --- Computed: Staff activity from users list ---
const ROLE_NAMES: Record<number, string> = {
  0: "Admin",
  1: t("owner.roles.owner"),
  2: t("owner.roles.chef"),
  3: t("owner.roles.service"),
  4: t("owner.roles.cashier"),
};

const staffActivity = computed(() => {
  return staffListData.value.slice(0, 6).map((user) => ({
    id: user.id,
    name: user.fullName || user.username,
    role: ROLE_NAMES[user.role] ?? t("owner.roles.staff"),
    status: staffPresence(user.id, onShiftIds.value) as
      | "online"
      | "busy"
      | "offline",
    performance: 0, // No real performance metric available from user API
  }));
});

// --- Computed: Today's finance ---
const todayRevenue = computed(() => dashboardSummary.value.todayRevenue);
const todayOrders = computed(() => dashboardSummary.value.todayOrders);
const avgOrderValue = computed(() =>
  todayOrders.value > 0
    ? Math.round(todayRevenue.value / todayOrders.value)
    : 0,
);

// --- Computed: Popular items from dashboard top-selling items ---
const popularItems = computed(() => {
  return dashboardTopItems.value.map((item, index) => ({
    id: item.itemId,
    rank: index + 1,
    name: item.itemName,
    category: "",
    sales: item.quantity,
    revenue: item.revenue,
  }));
});

// --- Computed: System health ---
const systemHealth = computed(() => {
  const statuses = resolveOwnerSystemHealth({
    healthData: healthData.value,
    tableTotal: dashboardTableStatus.value.total,
    todayOrders: dashboardSummary.value.todayOrders,
  });

  return [
    {
      name: t("owner.systemNames.api"),
      description: t("owner.systemDescriptions.api"),
      status: statuses.api,
    },
    {
      name: t("owner.systemNames.database"),
      description: t("owner.systemDescriptions.database"),
      status: statuses.database,
    },
    {
      name: t("owner.systemNames.realtime"),
      description: t("owner.systemDescriptions.realtime"),
      status: statuses.realtime,
    },
  ];
});

// --- Emergency alerts (#285): open operational alerts, refreshed by the
// same 30s poll as the rest of the dashboard. ---
const emergencyAlerts = ref<EmergencyAlert[]>([]);

const formatAlertTime = (createdAtMs: number) =>
  new Date(createdAtMs).toLocaleString();

// --- Helpers ---
const getStatusText = (status: string) => {
  const statusMap: Record<string, string> = {
    new: t("owner.status.new"),
    confirmed: t("owner.status.new"),
    preparing: t("owner.status.preparing"),
    ready: t("owner.status.ready"),
    delivered: t("owner.status.delivered"),
  };
  return statusMap[status] || status;
};

// Presentation lives in a testable module; this view only wires it up.
const alertPresenter = createAlertPresenter(t, getStatusText);
const alertTitle = alertPresenter.title;
const alertDescription = alertPresenter.description;

function buildScopedUrl(
  path: string,
  params: Record<string, string | number | boolean> = {},
): string {
  const searchParams = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );

  if (authStore.restaurantId) {
    searchParams.set("restaurantId", String(authStore.restaurantId));
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

// --- Fetch all data with graceful degradation ---
async function fetchAllData() {
  isLoading.value = true;
  error.value = null;

  try {
    const restaurantId = authStore.restaurantId
      ? String(authStore.restaurantId)
      : null;

    const [
      dashboardRes,
      activeOrdersRes,
      userStatsRes,
      usersRes,
      healthRes,
      onShiftRes,
      alertsRes,
    ] = await Promise.allSettled([
      api.get(buildScopedUrl("/analytics/dashboard", { period: "today" })),
      api.get(buildScopedUrl("/orders/active")),
      api.get(buildScopedUrl("/users/stats")),
      api.get(buildScopedUrl("/users", { limit: 10 })),
      api.get("/monitoring/health"),
      restaurantId
        ? schedulingService.getClockedInEmployees(restaurantId)
        : Promise.resolve([]),
      ownerService.listEmergencyAlerts(),
    ]);

    // Dashboard summary + top items + table status
    if (
      dashboardRes.status === "fulfilled" &&
      dashboardRes.value.data?.success
    ) {
      const data = dashboardRes.value.data.data as {
        summary: typeof dashboardSummary.value;
        topSellingItems?: typeof dashboardTopItems.value;
        tableStatus?: typeof dashboardTableStatus.value;
      };
      const s = data.summary;
      dashboardSummary.value = {
        todayRevenue: s?.todayRevenue ?? 0,
        todayOrders: s?.todayOrders ?? 0,
        monthRevenue: s?.monthRevenue ?? 0,
        monthOrders: s?.monthOrders ?? 0,
        growthRates: {
          revenueGrowth: s?.growthRates?.revenueGrowth ?? 0,
          orderGrowth: s?.growthRates?.orderGrowth ?? 0,
        },
      };
      dashboardTopItems.value = data.topSellingItems ?? [];
      dashboardTableStatus.value = data.tableStatus ?? {
        occupied: 0,
        available: 0,
        total: 0,
      };
    }

    // Active orders
    if (
      activeOrdersRes.status === "fulfilled" &&
      activeOrdersRes.value.data?.success
    ) {
      activeOrdersData.value = (activeOrdersRes.value.data.data ??
        []) as typeof activeOrdersData.value;
    }

    // User stats
    if (
      userStatsRes.status === "fulfilled" &&
      userStatsRes.value.data?.success
    ) {
      userStatsData.value = userStatsRes.value.data
        .data as typeof userStatsData.value;
    }

    // Users list (for staff activity)
    if (usersRes.status === "fulfilled" && usersRes.value.data?.success) {
      const usersPayload = usersRes.value.data.data as
        | typeof staffListData.value
        | { data: typeof staffListData.value };
      staffListData.value =
        unwrapApiList<(typeof staffListData.value)[number]>(usersPayload);
    }

    // On shift now
    if (onShiftRes.status === "fulfilled") {
      onShiftIds.value = toOnShiftIds(onShiftRes.value);
    }

    // Health check
    if (healthRes.status === "fulfilled") {
      const payload = healthRes.value.data;
      healthData.value = (
        payload?.success ? payload.data : payload
      ) as typeof healthData.value;
    }

    // Emergency alerts (#285). Left untouched on failure so a transient error
    // blanks the panel rather than silently claiming there is nothing wrong.
    if (alertsRes.status === "fulfilled") {
      emergencyAlerts.value = alertsRes.value;
    }

    const requestFailed = hasRequestFailure([
      dashboardRes,
      activeOrdersRes,
      userStatsRes,
      usersRes,
      healthRes,
    ]);
    if (requestFailed) {
      error.value = t("owner.fetchError");
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("owner.fetchError");
  } finally {
    isLoading.value = false;
  }
}

// --- Quick action handler (navigation via Vue Router) ---
const handleQuickAction = (action: string) => {
  const route = ownerService.getQuickActionRoute(action);
  if (route) {
    router.push(route);
  }
};

// --- Emergency alert handler ---
const handleEmergencyAlert = async (alertId: string, action: string) => {
  try {
    if (action === "resolve") {
      await ownerService.resolveEmergencyAlert(alertId);
      emergencyAlerts.value = emergencyAlerts.value.filter(
        (alert) => alert.id !== alertId,
      );
    } else if (action === "escalate") {
      await ownerService.escalateEmergencyAlert(alertId);
    }
  } catch (err) {
    console.error("Error handling emergency alert:", err);
    toast.error(t("owner.operationFailed"));
  }
};

// --- Lifecycle: fetch data + polling ---
let updateInterval: ReturnType<typeof setInterval>;

onMounted(async () => {
  await fetchAllData();
  // Refresh every 30 seconds
  updateInterval = setInterval(fetchAllData, 30000);
});

onUnmounted(() => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
});
</script>
