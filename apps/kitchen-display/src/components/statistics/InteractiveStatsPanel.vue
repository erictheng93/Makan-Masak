<template>
  <!-- Interactive Kitchen Statistics Panel -->
  <div class="bg-white rounded-xl shadow-lg overflow-hidden">
    <!-- Header -->
    <div class="px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div
            class="w-10 h-10 bg-white bg-opacity-20 rounded-lg flex items-center justify-center"
          >
            <ChartBarIcon class="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 class="text-lg font-semibold text-white">
              {{ t("interactiveStats.title") }}
            </h3>
            <p class="text-emerald-100 text-sm">
              {{ t("interactiveStats.description") }}
            </p>
          </div>
        </div>

        <!-- Controls -->
        <div class="flex items-center space-x-3">
          <!-- Time range selector -->
          <select
            v-model="selectedTimeRange"
            class="bg-white bg-opacity-20 text-white border border-white border-opacity-30 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-white"
            @change="updateTimeRange"
          >
            <option value="1h">{{ t("interactiveStats.last1Hour") }}</option>
            <option value="24h">{{ t("interactiveStats.last24Hours") }}</option>
            <option value="7d">{{ t("interactiveStats.last7Days") }}</option>
            <option value="30d">{{ t("interactiveStats.last30Days") }}</option>
          </select>

          <!-- Auto refresh toggle -->
          <button
            :class="[
              'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-emerald-600',
              statsService.autoRefresh ? 'bg-green-400' : 'bg-gray-300',
            ]"
            :title="t('interactiveStats.autoUpdate')"
            @click="toggleAutoRefresh"
          >
            <span
              :class="[
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                statsService.autoRefresh ? 'translate-x-5' : 'translate-x-0',
              ]"
            />
          </button>

          <!-- Refresh button -->
          <button
            :disabled="statsService.isLoading.value"
            class="p-2 bg-white bg-opacity-20 rounded-lg hover:bg-opacity-30 transition-colors disabled:opacity-50"
            :title="t('interactiveStats.immediateUpdate')"
            @click="refreshStats"
          >
            <ArrowPathIcon
              :class="[
                'w-5 h-5 text-white',
                { 'animate-spin': statsService.isLoading.value },
              ]"
            />
          </button>
        </div>
      </div>
    </div>

    <div class="p-6 space-y-6">
      <!-- Real-time Overview Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-2xl font-bold text-blue-900">
                {{ currentStats.realTime.activeOrders }}
              </div>
              <div class="text-sm text-blue-600">
                {{ t("interactiveStats.activeOrders") }}
              </div>
            </div>
            <div
              class="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center"
            >
              <ClockIcon class="w-5 h-5 text-white" />
            </div>
          </div>
          <div class="mt-2 text-xs text-blue-500">
            平均等待: {{ currentStats.realTime.waitingTime }}分鐘
          </div>
        </div>

        <div
          class="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <div class="text-2xl font-bold text-green-900">
                {{ currentStats.orders.completedOrders }}
              </div>
              <div class="text-sm text-green-600">
                {{ t("interactiveStats.completed") }}
              </div>
            </div>
            <div
              class="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center"
            >
              <CheckCircleIcon class="w-5 h-5 text-white" />
            </div>
          </div>
          <div class="mt-2 text-xs text-green-500">
            完成率: {{ currentStats.orders.completionRate }}%
          </div>
        </div>

        <div
          class="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <div class="text-2xl font-bold text-orange-900">
                {{ currentStats.orders.averageCookingTime }}分
              </div>
              <div class="text-sm text-orange-600">
                {{ t("interactiveStats.avgPrepTime") }}
              </div>
            </div>
            <div
              class="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center"
            >
              <FireIcon class="w-5 h-5 text-white" />
            </div>
          </div>
          <div class="mt-2 text-xs text-orange-500">
            等待時間: {{ currentStats.orders.averageWaitTime }}分
          </div>
        </div>

        <div class="bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg p-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-2xl font-bold text-teal-900">
                {{ currentStats.performance.efficiency }}%
              </div>
              <div class="text-sm text-teal-600">
                {{ t("interactiveStats.kitchenEfficiency") }}
              </div>
            </div>
            <div
              class="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center"
            >
              <BoltIcon class="w-5 h-5 text-white" />
            </div>
          </div>
          <div class="mt-2 text-xs text-teal-500">
            系統負載: {{ currentStats.realTime.systemLoad }}%
          </div>
        </div>
      </div>

      <!-- Chart Section -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Order Trends Chart -->
        <div class="bg-gray-50 rounded-lg p-6">
          <h4 class="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <TrendingUpIcon class="w-5 h-5 mr-2 text-emerald-600" />
            訂單趨勢
          </h4>
          <div class="h-48 flex items-end justify-between space-x-1">
            <div
              v-for="(trend, index) in currentStats.orders.orderTrends.slice(
                -12,
              )"
              :key="index"
              class="flex-1 flex flex-col items-center"
            >
              <!-- Completed orders bar -->
              <div
                class="w-full bg-emerald-500 rounded-t"
                :style="{
                  height: `${Math.max((trend.completed / maxTrendValue) * 100, 5)}%`,
                }"
                :title="`${trend.time}: ${trend.completed}個完成`"
              />
              <!-- Total orders bar -->
              <div
                class="w-full bg-emerald-200 rounded-b"
                :style="{
                  height: `${Math.max(((trend.orders - trend.completed) / maxTrendValue) * 100, 2)}%`,
                }"
                :title="`${trend.time}: ${trend.orders - trend.completed}個未完成`"
              />
              <span class="text-xs text-gray-500 mt-1 transform -rotate-45">
                {{ trend.time.split(":")[0] }}h
              </span>
            </div>
          </div>
          <div
            class="flex items-center justify-between mt-4 text-xs text-gray-500"
          >
            <span>12小時前</span>
            <span>現在</span>
          </div>
        </div>

        <!-- Performance Metrics -->
        <div class="bg-gray-50 rounded-lg p-6">
          <h4 class="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <ChartPieIcon class="w-5 h-5 mr-2 text-teal-600" />
            性能指標
          </h4>
          <div class="space-y-4">
            <div>
              <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-600">廚房效率</span>
                <span class="font-medium"
                  >{{ currentStats.performance.efficiency }}%</span
                >
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  class="bg-gradient-to-r from-emerald-500 to-emerald-600 h-2 rounded-full transition-all duration-500"
                  :style="{ width: `${currentStats.performance.efficiency}%` }"
                />
              </div>
            </div>

            <div>
              <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-600">每小時訂單</span>
                <span class="font-medium">{{
                  currentStats.performance.ordersPerHour
                }}</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  class="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500"
                  :style="{
                    width: `${Math.min(currentStats.performance.ordersPerHour * 5, 100)}%`,
                  }"
                />
              </div>
            </div>

            <div>
              <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-600">平均訂單價值</span>
                <span class="font-medium">{{
                  formatPrice(currentStats.performance.averageOrderValue)
                }}</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  class="bg-gradient-to-r from-yellow-500 to-yellow-600 h-2 rounded-full transition-all duration-500"
                  :style="{
                    width: `${Math.min(currentStats.performance.averageOrderValue * 2, 100)}%`,
                  }"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Detailed Analysis Tabs -->
        <div>
          <div class="border-b border-gray-200">
            <nav class="-mb-px flex space-x-8">
              <button
                v-for="tab in analysisTabs"
                :key="tab.id"
                :class="[
                  'py-2 px-1 border-b-2 font-medium text-sm transition-colors',
                  activeTab === tab.id
                    ? 'border-emerald-500 text-emerald-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                ]"
                @click="activeTab = tab.id"
              >
                <component :is="tab.icon" class="w-4 h-4 inline mr-2" />
                {{ tab.name }}
              </button>
            </nav>
          </div>

          <!-- Tab Content -->
          <div class="mt-6">
            <!-- Chef Performance Tab -->
            <div v-if="activeTab === 'chefs'" class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div
                  v-for="chef in currentStats.chefs"
                  :key="chef.chefId"
                  class="bg-gray-50 rounded-lg p-4"
                >
                  <div class="flex items-center justify-between mb-3">
                    <h5 class="font-medium text-gray-900">
                      {{ chef.name }}
                    </h5>
                    <span
                      :class="[
                        'px-2 py-1 rounded-full text-xs font-medium',
                        chef.efficiency >= 80
                          ? 'bg-green-100 text-green-800'
                          : chef.efficiency >= 60
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800',
                      ]"
                    >
                      {{ chef.efficiency }}% 效率
                    </span>
                  </div>
                  <div class="space-y-2 text-sm">
                    <div class="flex justify-between">
                      <span class="text-gray-600">完成訂單</span>
                      <span class="font-medium">{{
                        chef.ordersCompleted
                      }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-gray-600">平均時間</span>
                      <span class="font-medium"
                        >{{ chef.averageCookTime }}分</span
                      >
                    </div>
                    <div class="flex justify-between">
                      <span class="text-gray-600">目前工作量</span>
                      <span class="font-medium">{{ chef.workload }}%</span>
                    </div>
                  </div>
                  <div v-if="chef.specialties.length > 0" class="mt-3">
                    <div class="text-xs text-gray-500 mb-1">專長項目</div>
                    <div class="flex flex-wrap gap-1">
                      <span
                        v-for="specialty in chef.specialties"
                        :key="specialty"
                        class="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                      >
                        {{ specialty }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Item Analytics Tab -->
            <div v-if="activeTab === 'items'" class="space-y-4">
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th
                        class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        品項名稱
                      </th>
                      <th
                        class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        訂購次數
                      </th>
                      <th
                        class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        平均製作時間
                      </th>
                      <th
                        class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        成功率
                      </th>
                      <th
                        class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        趨勢
                      </th>
                      <th
                        class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        營收貢獻
                      </th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    <tr
                      v-for="item in currentStats.items.slice(0, 10)"
                      :key="item.itemName"
                      class="hover:bg-gray-50"
                    >
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm font-medium text-gray-900">
                          {{ item.itemName }}
                        </div>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm text-gray-900">
                          {{ item.orderCount }}
                        </div>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm text-gray-900">
                          {{ item.averageCookTime }}分
                        </div>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span
                          :class="[
                            'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
                            item.successRate >= 95
                              ? 'bg-green-100 text-green-800'
                              : item.successRate >= 85
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800',
                          ]"
                        >
                          {{ item.successRate }}%
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="flex items-center">
                          <TrendingUpIcon
                            v-if="item.popularityTrend === 'up'"
                            class="w-4 h-4 text-green-500"
                          />
                          <TrendingDownIcon
                            v-else-if="item.popularityTrend === 'down'"
                            class="w-4 h-4 text-red-500"
                          />
                          <MinusIcon v-else class="w-4 h-4 text-gray-400" />
                        </div>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm text-gray-900">
                          {{ formatPrice(item.revenueContribution) }}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Speed Analysis Tab -->
            <div v-if="activeTab === 'speed'" class="space-y-6">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Fastest Items -->
                <div class="bg-green-50 rounded-lg p-4">
                  <h5 class="font-medium text-green-900 mb-3 flex items-center">
                    <BoltIcon class="w-4 h-4 mr-2" />
                    最快製作項目
                  </h5>
                  <div class="space-y-2">
                    <div
                      v-for="item in currentStats.performance.fastestItems"
                      :key="item.name"
                      class="flex items-center justify-between text-sm"
                    >
                      <span class="text-gray-700">{{ item.name }}</span>
                      <div class="text-right">
                        <span class="font-medium text-green-700"
                          >{{ Math.round(item.avgTime) }}分</span
                        >
                        <span class="text-xs text-gray-500 ml-2"
                          >({{ item.count }}次)</span
                        >
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Slowest Items -->
                <div class="bg-red-50 rounded-lg p-4">
                  <h5 class="font-medium text-red-900 mb-3 flex items-center">
                    <ClockIcon class="w-4 h-4 mr-2" />
                    最慢製作項目
                  </h5>
                  <div class="space-y-2">
                    <div
                      v-for="item in currentStats.performance.slowestItems"
                      :key="item.name"
                      class="flex items-center justify-between text-sm"
                    >
                      <span class="text-gray-700">{{ item.name }}</span>
                      <div class="text-right">
                        <span class="font-medium text-red-700"
                          >{{ Math.round(item.avgTime) }}分</span
                        >
                        <span class="text-xs text-gray-500 ml-2"
                          >({{ item.count }}次)</span
                        >
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Peak Hours -->
              <div class="bg-teal-50 rounded-lg p-4">
                <h5 class="font-medium text-teal-900 mb-3 flex items-center">
                  <SunIcon class="w-4 h-4 mr-2" />
                  繁忙時段
                </h5>
                <div class="flex flex-wrap gap-2">
                  <span
                    v-for="hour in currentStats.performance.peakHours"
                    :key="hour"
                    class="px-3 py-1 bg-teal-100 text-teal-800 text-sm rounded-full font-medium"
                  >
                    {{ hour }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Customer Satisfaction Tab -->
            <div v-if="activeTab === 'satisfaction'" class="space-y-6">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="text-center p-4 bg-blue-50 rounded-lg">
                  <div class="text-3xl font-bold text-blue-900">
                    {{ currentStats.customer.averageRating }}
                  </div>
                  <div class="text-sm text-blue-600">平均評分</div>
                  <div class="flex justify-center mt-2">
                    <div class="flex">
                      <StarIcon
                        v-for="i in 5"
                        :key="i"
                        :class="[
                          'w-4 h-4',
                          i <= Math.floor(currentStats.customer.averageRating)
                            ? 'text-yellow-400 fill-current'
                            : 'text-gray-300',
                        ]"
                      />
                    </div>
                  </div>
                </div>

                <div class="text-center p-4 bg-red-50 rounded-lg">
                  <div class="text-3xl font-bold text-red-900">
                    {{ currentStats.customer.complaintRate }}%
                  </div>
                  <div class="text-sm text-red-600">投訴率</div>
                </div>

                <div class="text-center p-4 bg-green-50 rounded-lg">
                  <div class="text-3xl font-bold text-green-900">
                    {{ currentStats.customer.repeatCustomerRate }}%
                  </div>
                  <div class="text-sm text-green-600">回頭客率</div>
                </div>
              </div>

              <!-- Satisfaction Trends -->
              <div class="bg-gray-50 rounded-lg p-4">
                <h5 class="font-medium text-gray-900 mb-3">
                  滿意度趨勢 (最近7天)
                </h5>
                <div class="h-32 flex items-end justify-between space-x-1">
                  <div
                    v-for="(trend, index) in currentStats.customer
                      .satisfactionTrends"
                    :key="index"
                    class="flex-1 flex flex-col items-center"
                  >
                    <div
                      class="w-full bg-blue-500 rounded-t"
                      :style="{ height: `${(trend.rating / 5) * 100}%` }"
                      :title="`${trend.date}: ${trend.rating}分`"
                    />
                    <span class="text-xs text-gray-500 mt-1">
                      {{ trend.date.split("/").slice(-1)[0] }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Export and Actions -->
        <div
          class="flex items-center justify-between pt-6 border-t border-gray-200"
        >
          <div class="text-sm text-gray-500">
            最後更新: {{ formatLastUpdate(statsService.lastUpdated.value) }}
          </div>
          <div class="flex items-center space-x-3">
            <button
              class="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
              @click="exportStats"
            >
              <ArrowDownTrayIcon class="w-4 h-4 mr-2" />
              {{ t("interactiveStats.exportData") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import {
  BarChart2 as ChartBarIcon,
  Clock as ClockIcon,
  CheckCircle as CheckCircleIcon,
  Flame as FireIcon,
  Zap as BoltIcon,
  RefreshCw as ArrowPathIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Minus as MinusIcon,
  PieChart as ChartPieIcon,
  Users as UserGroupIcon,
  Box as CubeIcon,
  Star as StarIcon,
  Sun as SunIcon,
  Download as ArrowDownTrayIcon,
} from "lucide-vue-next";
import { useToast } from "vue-toastification";
import { kitchenStatisticsService } from "@/services/kitchenStatisticsService";

const { t, locale } = useI18n();
const { formatPrice } = useCurrency();
const toast = useToast();
const statsService = kitchenStatisticsService;

// Local state
const selectedTimeRange = ref("24h");
const activeTab = ref("chefs");

// Analysis tabs configuration
const analysisTabs = computed(() => [
  {
    id: "chefs",
    name: t("interactiveStats.chefPerformance"),
    icon: UserGroupIcon,
  },
  { id: "items", name: t("interactiveStats.itemAnalysis"), icon: CubeIcon },
  { id: "speed", name: t("interactiveStats.speedAnalysis"), icon: BoltIcon },
  {
    id: "satisfaction",
    name: t("interactiveStats.customerSatisfaction"),
    icon: StarIcon,
  },
]);

// Computed properties
const currentStats = computed(() => statsService.currentStats);

const maxTrendValue = computed(() => {
  const trends = currentStats.value.orders.orderTrends;
  return Math.max(...trends.map((t) => t.orders), 1);
});

// Methods
const updateTimeRange = () => {
  const ranges: Record<string, { start: Date; end: Date; label: string }> = {
    "1h": {
      start: new Date(Date.now() - 60 * 60 * 1000),
      end: new Date(),
      label: "最近 1 小時",
    },
    "24h": {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(),
      label: "最近 24 小時",
    },
    "7d": {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      end: new Date(),
      label: "最近 7 天",
    },
    "30d": {
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end: new Date(),
      label: "最近 30 天",
    },
  };

  const range = ranges[selectedTimeRange.value as keyof typeof ranges];
  if (range) {
    statsService.setTimeRange(range);
    toast.success(`${t("interactiveStats.timeRangeUpdated")} ${range.label}`);
  }
};

const toggleAutoRefresh = () => {
  statsService.autoRefresh.value = !statsService.autoRefresh.value;
  toast.info(
    statsService.autoRefresh.value
      ? t("interactiveStats.autoUpdateEnabled")
      : t("interactiveStats.autoUpdateDisabled"),
  );
};

const refreshStats = async () => {
  try {
    await statsService.computeStatistics();
    toast.success(t("interactiveStats.statsUpdated"));
  } catch (error) {
    toast.error(t("interactiveStats.statsUpdateFailed"));
    console.error("Failed to refresh stats:", error);
  }
};

const exportStats = () => {
  try {
    const data = statsService.exportStats();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kitchen-stats-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(t("interactiveStats.statsExported"));
  } catch (error) {
    toast.error(t("interactiveStats.statsExportFailed"));
    console.error("Export failed:", error);
  }
};

const formatLastUpdate = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) {
    return "剛才";
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分鐘前`;
  } else {
    return date.toLocaleTimeString(locale.value, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
};

// Lifecycle
onMounted(async () => {
  try {
    await statsService.computeStatistics();
  } catch (error) {
    console.error("Failed to load initial stats:", error);
    toast.error(t("interactiveStats.statsLoadFailed"));
  }
});

onUnmounted(() => {
  // Cleanup if needed
});
</script>

<style scoped>
/* Custom scrollbar */
.overflow-x-auto::-webkit-scrollbar {
  height: 6px;
}

.overflow-x-auto::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.overflow-x-auto::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.overflow-x-auto::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

/* Hover effects */
.hover\\:shadow-lg:hover {
  transition: box-shadow 0.3s ease;
}

/* Bar chart animations */
.bg-emerald-500,
.bg-emerald-200,
.bg-blue-500 {
  transition: height 0.5s ease;
}

/* Progress bar animations */
.bg-gradient-to-r {
  transition: width 0.5s ease;
}
</style>
