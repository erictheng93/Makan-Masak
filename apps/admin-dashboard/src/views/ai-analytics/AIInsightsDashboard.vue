<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { useAIAnalytics } from "@/composables/useAIAnalytics";
import { useCurrency } from "@/composables/useCurrency";
import ModuleGate from "@makanmasak/shared/components/ModuleGate.vue";
import type { AIAnalyticsReport, AIInsight } from "@makanmasak/ai-analytics";

// Icons
import {
  SparklesIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  CalendarIcon,
} from "@heroicons/vue/24/outline";
import LightBulbIcon from "@heroicons/vue/24/outline/LightBulbIcon";

const { t } = useI18n();
const authStore = useAuthStore();
const {
  generateReport,
  error: apiError,
  errorCode: apiErrorCode,
} = useAIAnalytics();
const { formatPrice } = useCurrency();

const report = ref<AIAnalyticsReport | null>(null);
const selectedTimeRange = ref("30d");
const isGenerating = ref(false);
const errorMessage = ref<string | null>(null);

const isProviderNotConfigured = computed(
  () => apiErrorCode.value === "AI_PROVIDER_NOT_CONFIGURED",
);

const restaurantId = computed(() => authStore.restaurantId || "");

const timeRangeOptions = computed(() => [
  { value: "7d", label: t("aiAnalytics.last7Days") },
  { value: "14d", label: t("aiAnalytics.last14Days") },
  { value: "30d", label: t("aiAnalytics.last30Days") },
  { value: "90d", label: t("aiAnalytics.last90Days") },
]);

// Group insights by type
const insightsByType = computed(() => {
  if (!report.value?.insights) return {};

  return report.value.insights.reduce(
    (acc: Record<string, AIInsight[]>, insight) => {
      if (!acc[insight.type]) {
        acc[insight.type] = [];
      }
      acc[insight.type].push(insight);
      return acc;
    },
    {} as Record<string, AIInsight[]>,
  );
});

// Insight type configurations
// Helper to get insight type label (reactive via t())
const getInsightTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    observation: t("aiAnalytics.insightTypes.observation"),
    recommendation: t("aiAnalytics.insightTypes.recommendation"),
    warning: t("aiAnalytics.insightTypes.warning"),
    opportunity: t("aiAnalytics.insightTypes.opportunity"),
  };
  return labels[type] || type;
};

// Insight type configurations
const insightTypeConfig = {
  observation: {
    icon: ChartBarIcon,
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    textColor: "text-blue-900",
    iconColor: "text-blue-700",
  },
  recommendation: {
    icon: LightBulbIcon,
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    textColor: "text-green-900",
    iconColor: "text-green-700",
  },
  warning: {
    icon: ExclamationTriangleIcon,
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-200",
    textColor: "text-yellow-900",
    iconColor: "text-yellow-700",
  },
  opportunity: {
    icon: SparklesIcon,
    bgColor: "bg-teal-50",
    borderColor: "border-teal-200",
    textColor: "text-teal-900",
    iconColor: "text-teal-700",
  },
};

// Generate report
const handleGenerateReport = async (refresh = false) => {
  isGenerating.value = true;
  errorMessage.value = null;

  try {
    const result = await generateReport(
      restaurantId.value,
      { range: selectedTimeRange.value as "7d" | "14d" | "30d" | "90d" },
      {
        includeForecasting: true,
        refreshCache: refresh,
      },
    );

    if (result) {
      report.value = result;
    } else {
      errorMessage.value = apiError.value || t("aiAnalytics.generateFailed");
    }
  } catch (err) {
    console.error("Failed to generate report:", err);
    errorMessage.value =
      err instanceof Error ? err.message : t("aiAnalytics.generateFailed");
  } finally {
    isGenerating.value = false;
  }
};

// Deliberately no auto-generate on mount. Generating a report is a billed call
// to the shop's own AI provider, and firing it from onMounted meant every
// navigation to this page spent money the owner never asked to spend. The empty
// state already says "點擊下方按鈕生成您的第一份 AI 分析報告" and wires up
// 立即生成 / 重新生成報告 — this now matches what the page tells the user.

// Format currency using the active restaurant's currency
const formatCurrency = (value: number) => formatPrice(value);

// Format percentage
const formatPercent = (value: number) => {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
};
</script>

<template>
  <ModuleGate module="ai_analytics">
    <div
      class="ui-page min-h-screen bg-gray-50 py-4 sm:py-8 px-4 sm:px-6 lg:px-8"
    >
      <div class="max-w-7xl mx-auto">
        <!-- Header -->
        <div class="mb-6 sm:mb-8">
          <div class="mb-4">
            <div class="flex items-center space-x-3 mb-2">
              <SparklesIcon
                class="w-6 h-6 sm:w-8 sm:h-8 text-teal-700"
                aria-hidden="true"
              />
              <h1
                class="ui-page-heading text-2xl sm:text-3xl font-bold text-gray-900"
              >
                {{ t("aiAnalytics.title") }}
              </h1>
            </div>
            <p class="text-sm sm:text-base text-gray-600">
              {{ t("aiAnalytics.subtitle") }}
            </p>
          </div>

          <!-- Quick Navigation -->
          <nav
            aria-label="AI Analytics 導航"
            class="flex flex-wrap items-center gap-2 bg-white rounded-xl p-2 border border-gray-100 w-fit"
          >
            <router-link
              to="/dashboard/ai-analytics/insights"
              class="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap"
              :class="
                $route.path.includes('insights')
                  ? 'bg-teal-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              "
              aria-current="page"
            >
              {{ t("aiAnalytics.navInsights") }}
            </router-link>
            <router-link
              to="/dashboard/ai-analytics/products"
              class="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap"
              :class="
                $route.path.includes('products')
                  ? 'bg-teal-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              "
            >
              {{ t("aiAnalytics.navProducts") }}
            </router-link>
            <router-link
              to="/dashboard/ai-analytics/config"
              class="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap"
              :class="
                $route.path.includes('config')
                  ? 'bg-teal-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              "
            >
              {{ t("aiAnalytics.navConfig") }}
            </router-link>
          </nav>
        </div>

        <!-- Controls -->
        <div
          class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-0 sm:justify-end mb-6 sm:mb-8"
        >
          <!-- Time Range & Refresh -->
          <div class="flex items-center gap-2 sm:gap-3">
            <label for="time-range-select" class="sr-only">{{
              t("aiAnalytics.selectTimeRange")
            }}</label>
            <select
              id="time-range-select"
              v-model="selectedTimeRange"
              :aria-label="t('aiAnalytics.selectTimeRange')"
              class="flex-1 sm:flex-initial px-3 sm:px-4 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
              @change="handleGenerateReport()"
            >
              <option
                v-for="option in timeRangeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>

            <button
              v-if="!isProviderNotConfigured"
              :disabled="isGenerating"
              :aria-label="
                isGenerating
                  ? t('aiAnalytics.regeneratingReport')
                  : t('aiAnalytics.regenerateReport')
              "
              class="px-3 sm:px-4 py-2 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:ring-2 focus:ring-teal-500"
              @click="handleGenerateReport(true)"
            >
              <ArrowPathIcon
                class="w-5 h-5 text-gray-700"
                :class="{ 'animate-spin': isGenerating }"
                aria-hidden="true"
              />
              <span class="sr-only">{{
                isGenerating
                  ? t("aiAnalytics.regeneratingReport")
                  : t("aiAnalytics.regenerateReport")
              }}</span>
            </button>
          </div>
        </div>

        <!-- Error State -->
        <div
          v-if="errorMessage && !isGenerating && isProviderNotConfigured"
          class="bg-teal-50 border border-teal-200 rounded-2xl p-6 mb-6"
        >
          <div class="flex items-start space-x-3">
            <SparklesIcon
              class="w-6 h-6 text-teal-700 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div class="flex-1">
              <h3 class="text-teal-900 font-semibold mb-1">
                {{ t("aiAnalytics.providerNotConfiguredTitle") }}
              </h3>
              <p class="text-teal-800 text-sm mb-3">
                {{ t("aiAnalytics.providerNotConfiguredHint") }}
              </p>
              <router-link
                to="/dashboard/ai-analytics/config"
                class="inline-flex px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
              >
                {{ t("aiAnalytics.configureProvider") }}
              </router-link>
            </div>
          </div>
        </div>

        <div
          v-else-if="errorMessage && !isGenerating"
          class="bg-red-50 border border-red-200 rounded-2xl p-6 mb-6"
        >
          <div class="flex items-start space-x-3">
            <ExclamationTriangleIcon
              class="w-6 h-6 text-red-700 flex-shrink-0 mt-0.5"
            />
            <div class="flex-1">
              <h3 class="text-red-900 font-semibold mb-1">
                {{ t("aiAnalytics.reportError") }}
              </h3>
              <p class="text-red-700 text-sm mb-3">{{ errorMessage }}</p>
              <button
                class="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
                @click="handleGenerateReport(true)"
              >
                {{ t("aiAnalytics.retry") }}
              </button>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div
          v-if="isGenerating && !report"
          class="flex items-center justify-center py-20"
        >
          <div class="text-center">
            <ArrowPathIcon
              class="w-12 h-12 text-teal-700 animate-spin mx-auto mb-4"
            />
            <div class="text-gray-600 font-medium">
              {{ t("aiAnalytics.analyzing") }}
            </div>
            <div class="text-sm text-gray-500 mt-2">
              {{ t("aiAnalytics.mayTakeFewSeconds") }}
            </div>
          </div>
        </div>

        <!-- Report Content -->
        <div v-else-if="report" class="space-y-6">
          <!-- Key Metrics -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <!-- Total Revenue -->
            <div
              class="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-lg transition-shadow"
            >
              <div class="ui-toolbar flex items-center justify-between mb-4">
                <div class="text-sm font-medium text-gray-600">
                  {{ t("aiAnalytics.totalRevenue") }}
                </div>
                <div
                  class="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center"
                >
                  <ArrowTrendingUpIcon class="w-6 h-6 text-green-700" />
                </div>
              </div>
              <div class="text-2xl font-bold text-gray-900 mb-1">
                {{ formatCurrency(report.metrics.totalRevenue) }}
              </div>
              <div
                class="flex items-center space-x-1 text-sm"
                :class="
                  report.metrics.revenueGrowth >= 0
                    ? 'text-green-700'
                    : 'text-red-700'
                "
              >
                <ArrowTrendingUpIcon
                  v-if="report.metrics.revenueGrowth >= 0"
                  class="w-4 h-4"
                />
                <ArrowTrendingDownIcon v-else class="w-4 h-4" />
                <span class="font-semibold">{{
                  formatPercent(report.metrics.revenueGrowth)
                }}</span>
                <span class="text-gray-500">{{
                  t("aiAnalytics.vsPrevPeriod")
                }}</span>
              </div>
            </div>

            <!-- Total Orders -->
            <div
              class="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-lg transition-shadow"
            >
              <div class="ui-toolbar flex items-center justify-between mb-4">
                <div class="text-sm font-medium text-gray-600">
                  {{ t("aiAnalytics.totalOrders") }}
                </div>
                <div
                  class="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center"
                >
                  <ChartBarIcon class="w-6 h-6 text-blue-700" />
                </div>
              </div>
              <div class="text-2xl font-bold text-gray-900 mb-1">
                {{ report.metrics.totalOrders.toLocaleString() }}
              </div>
              <div
                class="flex items-center space-x-1 text-sm"
                :class="
                  report.metrics.orderGrowth >= 0
                    ? 'text-green-700'
                    : 'text-red-700'
                "
              >
                <ArrowTrendingUpIcon
                  v-if="report.metrics.orderGrowth >= 0"
                  class="w-4 h-4"
                />
                <ArrowTrendingDownIcon v-else class="w-4 h-4" />
                <span class="font-semibold">{{
                  formatPercent(report.metrics.orderGrowth)
                }}</span>
                <span class="text-gray-500">{{
                  t("aiAnalytics.vsPrevPeriod")
                }}</span>
              </div>
            </div>

            <!-- Average Order Value -->
            <div
              class="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-lg transition-shadow"
            >
              <div class="ui-toolbar flex items-center justify-between mb-4">
                <div class="text-sm font-medium text-gray-600">
                  {{ t("aiAnalytics.avgOrderValue") }}
                </div>
                <div
                  class="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center"
                >
                  <span class="text-xl">💰</span>
                </div>
              </div>
              <div class="text-2xl font-bold text-gray-900 mb-1">
                {{ formatCurrency(report.metrics.averageOrderValue) }}
              </div>
              <div class="text-sm text-gray-500">
                {{ t("aiAnalytics.avgOrderValueDesc") }}
              </div>
            </div>

            <!-- Unique Customers -->
            <div
              class="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-lg transition-shadow"
            >
              <div class="ui-toolbar flex items-center justify-between mb-4">
                <div class="text-sm font-medium text-gray-600">
                  {{ t("aiAnalytics.uniqueCustomers") }}
                </div>
                <div
                  class="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center"
                >
                  <span class="text-xl">👥</span>
                </div>
              </div>
              <div class="text-2xl font-bold text-gray-900 mb-1">
                {{ report.metrics.uniqueCustomers.toLocaleString() }}
              </div>
              <div class="text-sm text-gray-500">
                {{
                  t("aiAnalytics.ordersPerCustomer", {
                    count: report.metrics.averageOrdersPerCustomer.toFixed(1),
                  })
                }}
              </div>
            </div>
          </div>

          <!-- Executive Summary -->
          <div class="bg-teal-500 rounded-2xl p-8 text-white shadow-ios-float">
            <div class="flex items-center space-x-3 mb-4">
              <div
                class="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center"
              >
                <SparklesIcon class="w-7 h-7" />
              </div>
              <h2 class="text-2xl font-bold">
                {{ t("aiAnalytics.executiveSummary") }}
              </h2>
            </div>
            <p class="text-lg leading-relaxed opacity-95">
              {{ report.executiveSummary }}
            </p>
          </div>

          <!-- Insights Grid -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <template v-for="(insights, type) in insightsByType" :key="type">
              <div
                v-for="insight in insights"
                :key="insight.id"
                class="bg-white rounded-2xl p-6 border transition-all hover:shadow-lg"
                :class="[
                  insightTypeConfig[type as keyof typeof insightTypeConfig]
                    .borderColor,
                ]"
              >
                <!-- Insight Header -->
                <div class="ui-toolbar flex items-start justify-between mb-4">
                  <div class="flex items-center space-x-3">
                    <div
                      class="w-10 h-10 rounded-xl flex items-center justify-center"
                      :class="
                        insightTypeConfig[
                          type as keyof typeof insightTypeConfig
                        ].bgColor
                      "
                    >
                      <component
                        :is="
                          insightTypeConfig[
                            type as keyof typeof insightTypeConfig
                          ].icon
                        "
                        class="w-6 h-6"
                        :class="
                          insightTypeConfig[
                            type as keyof typeof insightTypeConfig
                          ].iconColor
                        "
                      />
                    </div>
                    <div>
                      <div
                        class="text-xs font-semibold uppercase tracking-wide"
                        :class="
                          insightTypeConfig[
                            type as keyof typeof insightTypeConfig
                          ].textColor
                        "
                      >
                        {{ getInsightTypeLabel(type) }}
                      </div>
                      <div class="text-sm text-gray-500 mt-1">
                        {{ insight.category }}
                      </div>
                    </div>
                  </div>
                  <div
                    class="px-3 py-1 rounded-full text-xs font-semibold"
                    :class="{
                      'bg-red-100 text-red-700': insight.impact === 'high',
                      'bg-yellow-100 text-yellow-700':
                        insight.impact === 'medium',
                      'bg-gray-100 text-gray-700': insight.impact === 'low',
                    }"
                  >
                    {{
                      insight.impact === "high"
                        ? t("aiAnalytics.impactHigh")
                        : insight.impact === "medium"
                          ? t("aiAnalytics.impactMedium")
                          : t("aiAnalytics.impactLow")
                    }}
                  </div>
                </div>

                <!-- Insight Content -->
                <h3 class="text-lg font-bold text-gray-900 mb-2">
                  {{ insight.title }}
                </h3>
                <p class="text-gray-600 mb-4 leading-relaxed">
                  {{ insight.description }}
                </p>

                <!-- Suggested Actions -->
                <div
                  v-if="insight.actionable && insight.suggestedActions?.length"
                  class="mt-4"
                >
                  <div class="text-sm font-semibold text-gray-900 mb-2">
                    {{ t("aiAnalytics.suggestedActions") }}
                  </div>
                  <ul class="space-y-2">
                    <li
                      v-for="(action, idx) in insight.suggestedActions"
                      :key="idx"
                      class="flex items-start space-x-2 text-sm text-gray-700"
                    >
                      <CheckCircleIcon
                        class="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5"
                      />
                      <span>{{ action }}</span>
                    </li>
                  </ul>
                </div>

                <!-- Confidence Score -->
                <div
                  class="ui-toolbar mt-4 pt-4 border-t border-gray-100 flex items-center justify-between"
                >
                  <div class="text-xs text-gray-500">
                    {{ t("aiAnalytics.confidenceScore") }}
                  </div>
                  <div class="flex items-center space-x-2">
                    <div
                      class="flex-1 h-2 w-24 bg-gray-200 rounded-full overflow-hidden"
                    >
                      <div
                        class="h-full bg-teal-500 transition-all"
                        :style="{ width: `${insight.confidence * 100}%` }"
                      ></div>
                    </div>
                    <div class="text-sm font-semibold text-gray-900">
                      {{ Math.round(insight.confidence * 100) }}%
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Forecast (if available) -->
          <div
            v-if="report.forecast"
            class="bg-white rounded-2xl p-8 border border-gray-100"
          >
            <div class="flex items-center space-x-3 mb-6">
              <CalendarIcon class="w-6 h-6 text-teal-700" />
              <h2 class="text-xl font-bold text-gray-900">
                {{ t("aiAnalytics.next7DaysForecast") }}
              </h2>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- Revenue Forecast -->
              <div class="bg-green-50 rounded-xl p-6 border border-green-200">
                <div class="text-sm font-semibold text-green-900 mb-2">
                  {{ t("aiAnalytics.forecastRevenue") }}
                </div>
                <div class="text-3xl font-bold text-green-700 mb-4">
                  {{
                    formatCurrency(report.forecast.nextWeekRevenue.predicted)
                  }}
                </div>
                <div
                  class="ui-toolbar flex items-center justify-between text-sm"
                >
                  <div class="text-green-700">
                    {{ t("aiAnalytics.forecastMin") }}:
                    {{
                      formatCurrency(
                        report.forecast.nextWeekRevenue.confidenceLower,
                      )
                    }}
                  </div>
                  <div class="text-green-700">
                    {{ t("aiAnalytics.forecastMax") }}:
                    {{
                      formatCurrency(
                        report.forecast.nextWeekRevenue.confidenceUpper,
                      )
                    }}
                  </div>
                </div>
              </div>

              <!-- Orders Forecast -->
              <div class="bg-blue-50 rounded-xl p-6 border border-blue-200">
                <div class="text-sm font-semibold text-blue-900 mb-2">
                  {{ t("aiAnalytics.forecastOrders") }}
                </div>
                <div class="text-3xl font-bold text-blue-700 mb-4">
                  {{
                    report.forecast.nextWeekOrders.predicted.toLocaleString()
                  }}
                </div>
                <div
                  class="ui-toolbar flex items-center justify-between text-sm"
                >
                  <div class="text-blue-700">
                    {{ t("aiAnalytics.forecastMin") }}:
                    {{
                      report.forecast.nextWeekOrders.confidenceLower.toLocaleString()
                    }}
                  </div>
                  <div class="text-blue-700">
                    {{ t("aiAnalytics.forecastMax") }}:
                    {{
                      report.forecast.nextWeekOrders.confidenceUpper.toLocaleString()
                    }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- No Data State -->
        <div v-else-if="!errorMessage" class="text-center py-20">
          <SparklesIcon class="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <div class="text-gray-600 font-medium mb-2">
            {{ t("aiAnalytics.noReport") }}
          </div>
          <div class="text-sm text-gray-500 mb-6">
            {{ t("aiAnalytics.noReportHint") }}
          </div>
          <button
            class="px-6 py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition-all"
            @click="handleGenerateReport()"
          >
            {{ t("aiAnalytics.generateNow") }}
          </button>
        </div>
      </div>
    </div>
    <template #fallback>
      <div class="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 lg:px-8">
        <div
          class="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600"
        >
          AI analytics is not included in the current plan.
        </div>
      </div>
    </template>
    <template #loading>
      <div class="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 lg:px-8">
        <div
          class="mx-auto h-32 max-w-7xl animate-pulse rounded-lg bg-gray-100"
        />
      </div>
    </template>
  </ModuleGate>
</template>

<style scoped>
@keyframes shimmer {
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
}

.animate-shimmer {
  background: theme("colors.ios-bg");
}
</style>
