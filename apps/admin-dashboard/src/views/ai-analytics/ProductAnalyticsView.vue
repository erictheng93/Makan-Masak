<script setup lang="ts">
import { ref, computed, onMounted, watch, type Component } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { useAIAnalytics } from "@/composables/useAIAnalytics";
import { useCurrency } from "@/composables/useCurrency";
import type { ProductAnalysis } from "@makanmasak/ai-analytics";

// Icons
import {
  ChartBarIcon,
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  SparklesIcon,
  CurrencyDollarIcon,
  ShoppingCartIcon,
  UserGroupIcon,
  FireIcon,
  ExclamationTriangleIcon,
} from "@heroicons/vue/24/outline";

const { t } = useI18n();
const authStore = useAuthStore();
const { getTrafficDrivers, getBestsellers, getProfitLeaders } =
  useAIAnalytics();
const { formatPrice } = useCurrency();

type ProductAnalyticsTabId = "traffic" | "bestsellers" | "profit";

interface ProductAnalyticsTab {
  id: ProductAnalyticsTabId;
  label: string;
  icon: Component;
  description: string;
  color: "teal" | "orange" | "green";
}

const activeTab = ref<ProductAnalyticsTabId>("traffic");
const selectedTimeRange = ref("30d");
const isRefreshing = ref(false);
const errorMessage = ref<string | null>(null);

const restaurantId = computed(() => authStore.restaurantId || "");

// Product data
const trafficDrivers = ref<ProductAnalysis[]>([]);
const bestsellers = ref<ProductAnalysis[]>([]);
const profitLeaders = ref<ProductAnalysis[]>([]);

const timeRangeOptions = computed(() => [
  { value: "7d", label: t("aiAnalytics.last7Days") },
  { value: "14d", label: t("aiAnalytics.last14Days") },
  { value: "30d", label: t("aiAnalytics.last30Days") },
  { value: "90d", label: t("aiAnalytics.last90Days") },
]);

// Tab configurations
// Written out in full so Tailwind's content scanner can see every class. The
// previous version concatenated `tab.color` into the class string at runtime,
// which the scanner cannot follow -- none of those classes were ever generated.
const ACTIVE_TAB_CLASSES: Record<ProductAnalyticsTab["color"], string> = {
  teal: "bg-teal-50 border-b-2 border-teal-600",
  orange: "bg-orange-50 border-b-2 border-orange-600",
  green: "bg-green-50 border-b-2 border-green-600",
};

const ACTIVE_TAB_ICON_CLASSES: Record<ProductAnalyticsTab["color"], string> = {
  teal: "text-teal-700",
  orange: "text-orange-700",
  green: "text-green-700",
};

const ACTIVE_TAB_LABEL_CLASSES: Record<ProductAnalyticsTab["color"], string> = {
  teal: "text-teal-900",
  orange: "text-orange-900",
  green: "text-green-900",
};

const tabs = computed<ProductAnalyticsTab[]>(() => [
  {
    id: "traffic",
    label: t("productAnalytics.trafficDrivers"),
    icon: UserGroupIcon,
    description: t("productAnalytics.trafficDriversDesc"),
    color: "teal",
  },
  {
    id: "bestsellers",
    label: t("productAnalytics.bestsellers"),
    icon: FireIcon,
    description: t("productAnalytics.bestsellersDesc"),
    color: "orange",
  },
  {
    id: "profit",
    label: t("productAnalytics.profitLeaders"),
    icon: CurrencyDollarIcon,
    description: t("productAnalytics.profitLeadersDesc"),
    color: "green",
  },
]);

// Current tab data
const currentProducts = computed(() => {
  switch (activeTab.value) {
    case "traffic":
      return trafficDrivers.value;
    case "bestsellers":
      return bestsellers.value;
    case "profit":
      return profitLeaders.value;
    default:
      return [];
  }
});

// Load data
const loadData = async () => {
  isRefreshing.value = true;
  errorMessage.value = null;

  try {
    const [traffic, best, profit] = await Promise.all([
      getTrafficDrivers(restaurantId.value, selectedTimeRange.value, 10),
      getBestsellers(restaurantId.value, selectedTimeRange.value, 10),
      getProfitLeaders(restaurantId.value, selectedTimeRange.value, 10),
    ]);

    trafficDrivers.value = traffic;
    bestsellers.value = best;
    profitLeaders.value = profit;
  } catch (err) {
    console.error("Failed to load product analytics:", err);
    errorMessage.value =
      err instanceof Error ? err.message : t("productAnalytics.loadFailed");
  } finally {
    isRefreshing.value = false;
  }
};

// Watch time range changes
watch(selectedTimeRange, () => {
  loadData();
});

// Load on mount
onMounted(() => {
  loadData();
});

// Format currency using the active restaurant's currency
const formatCurrency = (value?: number) => {
  if (value === undefined) return "N/A";
  return formatPrice(value);
};

// Format percent
const formatPercent = (value: number) => {
  return `${(value * 100).toFixed(1)}%`;
};

// Get trend color
const getTrendColor = (trend: number) => {
  if (trend > 0.2) return "text-green-700";
  if (trend < -0.2) return "text-red-700";
  return "text-gray-600";
};
</script>

<template>
  <div class="ui-page min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto">
      <!-- Header -->
      <div class="mb-8">
        <div class="ui-toolbar flex items-center justify-between mb-4">
          <div>
            <div class="flex items-center space-x-3 mb-2">
              <ChartBarIcon class="w-8 h-8 text-teal-700" />
              <h1 class="ui-page-heading text-3xl font-bold text-gray-900">
                {{ t("productAnalytics.title") }}
              </h1>
            </div>
            <p class="text-gray-600">{{ t("productAnalytics.subtitle") }}</p>
          </div>
        </div>

        <!-- Quick Navigation -->
        <div class="ui-toolbar flex items-center justify-between">
          <div
            class="flex items-center space-x-2 bg-white rounded-xl p-2 border border-gray-100 w-fit"
          >
            <router-link
              to="/dashboard/ai-analytics/insights"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-all text-gray-600 hover:bg-gray-100"
            >
              {{ t("aiAnalytics.navInsights") }}
            </router-link>
            <router-link
              to="/dashboard/ai-analytics/products"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-teal-600 text-white"
            >
              {{ t("aiAnalytics.navProducts") }}
            </router-link>
            <router-link
              to="/dashboard/ai-analytics/config"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-all text-gray-600 hover:bg-gray-100"
            >
              {{ t("aiAnalytics.navConfig") }}
            </router-link>
          </div>

          <!-- Time Range & Refresh -->
          <div class="flex items-center space-x-3">
            <label
              class="admin-field"
              for="productanalyticsview-selectedTimeRange"
              ><span>{{ t("ui.analysisPeriod") }}</span
              ><select
                id="productanalyticsview-selectedTimeRange"
                v-model="selectedTimeRange"
                class="px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              >
                <option
                  v-for="option in timeRangeOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select></label
            >

            <button
              :aria-label="t('common.refresh')"
              :disabled="isRefreshing"
              class="px-4 py-2 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
              @click="loadData()"
            >
              <ArrowPathIcon
                class="w-5 h-5 text-gray-700"
                :class="{ 'animate-spin': isRefreshing }"
              />
            </button>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div
        class="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6"
      >
        <div class="flex border-b border-gray-100">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="flex-1 px-6 py-4 flex items-center justify-center space-x-3 transition-all relative"
            :class="
              activeTab === tab.id
                ? ACTIVE_TAB_CLASSES[tab.color]
                : 'hover:bg-gray-50'
            "
            @click="activeTab = tab.id"
          >
            <component
              :is="tab.icon"
              class="w-6 h-6"
              :class="
                activeTab === tab.id
                  ? ACTIVE_TAB_ICON_CLASSES[tab.color]
                  : 'text-gray-400'
              "
            />
            <div class="text-left">
              <div
                class="font-semibold"
                :class="
                  activeTab === tab.id
                    ? ACTIVE_TAB_LABEL_CLASSES[tab.color]
                    : 'text-gray-600'
                "
              >
                {{ tab.label }}
              </div>
              <div class="text-xs text-gray-500">{{ tab.description }}</div>
            </div>
          </button>
        </div>
      </div>

      <!-- Error State -->
      <div
        v-if="errorMessage && !isRefreshing"
        class="bg-red-50 border border-red-200 rounded-2xl p-6 mb-6"
      >
        <div class="flex items-start space-x-3">
          <ExclamationTriangleIcon
            class="w-6 h-6 text-red-700 flex-shrink-0 mt-0.5"
          />
          <div class="flex-1">
            <h3 class="text-red-900 font-semibold mb-1">
              {{ t("productAnalytics.loadError") }}
            </h3>
            <p class="text-red-700 text-sm mb-3">{{ errorMessage }}</p>
            <button
              class="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
              @click="loadData()"
            >
              {{ t("aiAnalytics.retry") }}
            </button>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div
        v-if="isRefreshing && currentProducts.length === 0"
        class="flex items-center justify-center py-20"
      >
        <div class="text-center">
          <ArrowPathIcon
            class="w-12 h-12 text-teal-700 animate-spin mx-auto mb-4"
          />
          <div class="text-gray-600 font-medium">
            {{ t("productAnalytics.loading") }}
          </div>
        </div>
      </div>

      <!-- Products Grid -->
      <div
        v-else-if="currentProducts.length > 0"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        <div
          v-for="(product, index) in currentProducts"
          :key="product.menuItemId"
          class="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-lg transition-all relative overflow-hidden group"
        >
          <!-- Rank Badge -->
          <div
            class="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-lg"
            :class="{
              'bg-orange-500': index === 0,
              'bg-gray-400': index === 1,
              'bg-orange-300': index === 2,
              'bg-teal-500': index > 2,
            }"
          >
            {{ index + 1 }}
          </div>

          <!-- Product Header -->
          <div class="mb-4 pr-12">
            <h3 class="text-lg font-bold text-gray-900 mb-1 line-clamp-2">
              {{ product.menuItemName }}
            </h3>
            <div class="text-sm text-gray-500">{{ product.category }}</div>
          </div>

          <!-- Key Metrics -->
          <div class="space-y-3 mb-4">
            <!-- Traffic Drivers Metrics -->
            <template v-if="activeTab === 'traffic'">
              <div
                class="ui-toolbar flex items-center justify-between py-2 border-b border-gray-100"
              >
                <span class="text-sm text-gray-600">{{
                  t("productAnalytics.firstPickCount")
                }}</span>
                <span class="font-semibold text-gray-900">{{
                  product.firstItemInOrderCount
                }}</span>
              </div>
              <div
                class="ui-toolbar flex items-center justify-between py-2 border-b border-gray-100"
              >
                <span class="text-sm text-gray-600">{{
                  t("productAnalytics.conversionRate")
                }}</span>
                <span class="font-semibold text-teal-700">{{
                  formatPercent(product.conversionRate)
                }}</span>
              </div>
              <div
                class="ui-toolbar flex items-center justify-between py-2 border-b border-gray-100"
              >
                <span class="text-sm text-gray-600">{{
                  t("productAnalytics.cartAdditionRate")
                }}</span>
                <span class="font-semibold text-teal-700">{{
                  formatPercent(product.cartAdditionRate)
                }}</span>
              </div>
            </template>

            <!-- Bestsellers Metrics -->
            <template v-if="activeTab === 'bestsellers'">
              <div
                class="ui-toolbar flex items-center justify-between py-2 border-b border-gray-100"
              >
                <span class="text-sm text-gray-600">{{
                  t("aiAnalytics.totalOrders")
                }}</span>
                <span class="font-semibold text-gray-900">{{
                  product.totalOrders
                }}</span>
              </div>
              <div
                class="ui-toolbar flex items-center justify-between py-2 border-b border-gray-100"
              >
                <span class="text-sm text-gray-600">{{
                  t("aiAnalytics.totalRevenue")
                }}</span>
                <span class="font-semibold text-green-700">{{
                  formatCurrency(product.totalRevenue)
                }}</span>
              </div>
              <div
                class="ui-toolbar flex items-center justify-between py-2 border-b border-gray-100"
              >
                <span class="text-sm text-gray-600">{{
                  t("aiAnalytics.avgOrderValue")
                }}</span>
                <span class="font-semibold text-blue-700">{{
                  formatCurrency(product.averageOrderValue)
                }}</span>
              </div>
            </template>

            <!-- Profit Leaders Metrics -->
            <template v-if="activeTab === 'profit'">
              <div
                class="ui-toolbar flex items-center justify-between py-2 border-b border-gray-100"
              >
                <span class="text-sm text-gray-600">{{
                  t("productAnalytics.totalProfit")
                }}</span>
                <span class="font-semibold text-green-700">{{
                  formatCurrency(product.totalProfit)
                }}</span>
              </div>
              <div
                class="ui-toolbar flex items-center justify-between py-2 border-b border-gray-100"
              >
                <span class="text-sm text-gray-600">{{
                  t("productAnalytics.profitMargin")
                }}</span>
                <span class="font-semibold text-emerald-700">
                  {{
                    product.profitMargin
                      ? formatPercent(product.profitMargin)
                      : "N/A"
                  }}
                </span>
              </div>
              <div
                class="ui-toolbar flex items-center justify-between py-2 border-b border-gray-100"
              >
                <span class="text-sm text-gray-600">{{
                  t("productAnalytics.unitPrice")
                }}</span>
                <span class="font-semibold text-gray-900">{{
                  formatCurrency(product.unitPrice)
                }}</span>
              </div>
            </template>

            <!-- Common Metrics -->
            <div class="ui-toolbar flex items-center justify-between py-2">
              <span class="text-sm text-gray-600">{{
                t("productAnalytics.trend")
              }}</span>
              <div
                class="flex items-center space-x-1"
                :class="getTrendColor(product.trendScore)"
              >
                <ArrowTrendingUpIcon
                  v-if="product.trendScore > 0"
                  class="w-4 h-4"
                />
                <ArrowTrendingDownIcon
                  v-else-if="product.trendScore < 0"
                  class="w-4 h-4"
                />
                <span class="font-semibold">
                  {{ product.trendScore > 0 ? "+" : ""
                  }}{{ (product.trendScore * 100).toFixed(0) }}%
                </span>
              </div>
            </div>
          </div>

          <!-- Categories Badges -->
          <div class="flex flex-wrap gap-2">
            <span
              v-for="category in product.categories"
              :key="category"
              class="px-2 py-1 text-xs font-semibold rounded-full"
              :class="{
                'bg-teal-100 text-teal-700': category === 'traffic-driver',
                'bg-orange-100 text-orange-700': category === 'bestseller',
                'bg-green-100 text-green-700': category === 'profit-leader',
                'bg-red-100 text-red-700': category === 'underperformer',
              }"
            >
              {{
                category === "traffic-driver"
                  ? t("productAnalytics.categoryTraffic")
                  : category === "bestseller"
                    ? t("productAnalytics.categoryBestseller")
                    : category === "profit-leader"
                      ? t("productAnalytics.categoryProfit")
                      : t("productAnalytics.categoryUnderperformer")
              }}
            </span>
          </div>

          <!-- Hover Effect -->
          <div
            class="absolute inset-0 bg-teal-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          ></div>
        </div>
      </div>

      <!-- No Data State -->
      <div v-else class="text-center py-20">
        <ChartBarIcon class="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <div class="text-gray-600 font-medium mb-2">
          {{ t("productAnalytics.noData") }}
        </div>
        <div class="text-sm text-gray-500">
          {{ t("productAnalytics.noDataHint") }}
        </div>
      </div>

      <!-- Summary Cards -->
      <div
        v-if="currentProducts.length > 0"
        class="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <div class="bg-blue-50 rounded-2xl p-6 border border-blue-100">
          <div class="flex items-center space-x-3 mb-3">
            <div
              class="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center"
            >
              <ShoppingCartIcon class="w-6 h-6 text-white" />
            </div>
            <div class="font-semibold text-blue-900">
              {{ t("productAnalytics.analysisInsight") }}
            </div>
          </div>
          <p class="text-sm text-blue-800 leading-relaxed">
            <template v-if="activeTab === 'traffic'">
              {{ t("productAnalytics.insightTraffic") }}
            </template>
            <template v-else-if="activeTab === 'bestsellers'">
              {{ t("productAnalytics.insightBestsellers") }}
            </template>
            <template v-else>
              {{ t("productAnalytics.insightProfit") }}
            </template>
          </p>
        </div>

        <div class="bg-teal-50 rounded-2xl p-6 border border-teal-100">
          <div class="flex items-center space-x-3 mb-3">
            <div
              class="w-10 h-10 bg-teal-500 rounded-xl flex items-center justify-center"
            >
              <SparklesIcon class="w-6 h-6 text-white" />
            </div>
            <div class="font-semibold text-teal-900">
              {{ t("productAnalytics.optimizationTips") }}
            </div>
          </div>
          <p class="text-sm text-teal-800 leading-relaxed">
            <template v-if="activeTab === 'traffic'">
              {{ t("productAnalytics.tipTraffic") }}
            </template>
            <template v-else-if="activeTab === 'bestsellers'">
              {{ t("productAnalytics.tipBestsellers") }}
            </template>
            <template v-else>
              {{ t("productAnalytics.tipProfit") }}
            </template>
          </p>
        </div>

        <div class="bg-green-50 rounded-2xl p-6 border border-green-100">
          <div class="flex items-center space-x-3 mb-3">
            <div
              class="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center"
            >
              <ArrowTrendingUpIcon class="w-6 h-6 text-white" />
            </div>
            <div class="font-semibold text-green-900">
              {{ t("productAnalytics.actionPlan") }}
            </div>
          </div>
          <p class="text-sm text-green-800 leading-relaxed">
            <template v-if="activeTab === 'traffic'">
              {{ t("productAnalytics.actionTraffic") }}
            </template>
            <template v-else-if="activeTab === 'bestsellers'">
              {{ t("productAnalytics.actionBestsellers") }}
            </template>
            <template v-else>
              {{ t("productAnalytics.actionProfit") }}
            </template>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
