<template>
  <!-- Error Reports Dashboard -->
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Header -->
    <div class="mb-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">
            {{ t("errorReports.title") }}
          </h1>
          <p class="mt-2 text-sm text-gray-600">
            {{ t("errorReports.description") }}
          </p>
        </div>

        <div class="flex items-center space-x-3">
          <!-- Auto refresh toggle -->
          <label class="flex items-center">
            <input
              v-model="autoRefresh"
              type="checkbox"
              class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span class="ml-2 text-sm text-gray-600">{{
              t("errorReports.autoUpdate")
            }}</span>
          </label>

          <!-- Refresh button -->
          <button
            :disabled="loading"
            class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            @click="refreshData"
          >
            <ArrowPathIcon
              :class="['w-4 h-4 mr-2', { 'animate-spin': loading }]"
            />
            {{ t("common.update") }}
          </button>

          <!-- Export button -->
          <button
            class="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            @click="exportErrors"
          >
            <ArrowDownTrayIcon class="w-4 h-4 mr-2" />
            {{ t("errorReports.exportReport") }}
          </button>
        </div>
      </div>
    </div>

    <!-- Error Statistics Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div class="bg-white overflow-hidden shadow rounded-lg">
        <div class="p-5">
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <ExclamationTriangleIcon class="h-6 w-6 text-red-400" />
            </div>
            <div class="ml-5 w-0 flex-1">
              <dl>
                <dt class="text-sm font-medium text-gray-500 truncate">
                  {{ t("errorReports.totalErrors") }}
                </dt>
                <dd class="text-lg font-medium text-gray-900">
                  {{ stats.totalErrors }}
                </dd>
              </dl>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white overflow-hidden shadow rounded-lg">
        <div class="p-5">
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <ClockIcon class="h-6 w-6 text-yellow-400" />
            </div>
            <div class="ml-5 w-0 flex-1">
              <dl>
                <dt class="text-sm font-medium text-gray-500 truncate">
                  {{ t("errorReports.errorRate") }}
                </dt>
                <dd class="text-lg font-medium text-gray-900">
                  {{ stats.errorRate }}
                </dd>
              </dl>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white overflow-hidden shadow rounded-lg">
        <div class="p-5">
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <ShieldExclamationIcon class="h-6 w-6 text-red-600" />
            </div>
            <div class="ml-5 w-0 flex-1">
              <dl>
                <dt class="text-sm font-medium text-gray-500 truncate">
                  {{ t("errorReports.criticalErrors") }}
                </dt>
                <dd class="text-lg font-medium text-gray-900">
                  {{ stats.errorsBySeverity.critical || 0 }}
                </dd>
              </dl>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white overflow-hidden shadow rounded-lg">
        <div class="p-5">
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <CheckCircleIcon class="h-6 w-6 text-green-400" />
            </div>
            <div class="ml-5 w-0 flex-1">
              <dl>
                <dt class="text-sm font-medium text-gray-500 truncate">
                  {{ t("errorReports.resolved") }}
                </dt>
                <dd class="text-lg font-medium text-gray-900">
                  {{ resolvedErrorsCount }}
                </dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Error Insights -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <!-- Error Types Chart -->
      <div class="bg-white shadow rounded-lg p-6">
        <h3 class="text-lg font-medium text-gray-900 mb-4">
          {{ t("errorReports.typeDistribution") }}
        </h3>
        <div class="space-y-3">
          <div
            v-for="errorType in insights.topErrorTypes.slice(0, 5)"
            :key="errorType.type"
            class="flex items-center justify-between"
          >
            <div class="flex items-center">
              <div class="w-3 h-3 rounded-full bg-blue-500 mr-3" />
              <span class="text-sm text-gray-700">{{ errorType.type }}</span>
            </div>
            <div class="text-right">
              <span class="text-sm font-medium text-gray-900">{{
                errorType.count
              }}</span>
              <span class="text-xs text-gray-500 ml-1"
                >({{ errorType.percentage }}%)</span
              >
            </div>
          </div>
        </div>
      </div>

      <!-- Error Trends -->
      <div class="bg-white shadow rounded-lg p-6">
        <h3 class="text-lg font-medium text-gray-900 mb-4">
          {{ t("errorReports.errorTrend") }}
        </h3>
        <div class="h-32 flex items-end justify-between space-x-1">
          <div
            v-for="trend in insights.errorTrends"
            :key="trend.date"
            class="flex-1 bg-blue-200 rounded-t"
            :style="{
              height: `${Math.max((trend.count / maxTrendCount) * 100, 5)}%`,
            }"
            :title="`${trend.date}: ${trend.count} errors`"
          />
        </div>
        <div class="flex justify-between mt-2 text-xs text-gray-500">
          <span>{{ t("errorReports.sevenDaysAgo") }}</span>
          <span>{{ t("errorReports.today") }}</span>
        </div>
      </div>
    </div>

    <!-- Critical Errors Alert -->
    <div v-if="insights.criticalErrors.length > 0" class="mb-6">
      <div class="bg-red-50 border-l-4 border-red-400 p-4">
        <div class="flex">
          <div class="flex-shrink-0">
            <ExclamationTriangleIcon class="h-5 w-5 text-red-400" />
          </div>
          <div class="ml-3">
            <h3 class="text-sm font-medium text-red-800">
              {{ t("errorReports.criticalAlert") }}
            </h3>
            <div class="mt-2 text-sm text-red-700">
              <p>
                {{
                  t("errorReports.criticalAlertMsg", {
                    count: insights.criticalErrors.length,
                  })
                }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Recommendations -->
    <div v-if="insights.recommendations.length > 0" class="mb-6">
      <div class="bg-blue-50 border-l-4 border-blue-400 p-4">
        <div class="flex">
          <div class="flex-shrink-0">
            <InformationCircleIcon class="h-5 w-5 text-blue-400" />
          </div>
          <div class="ml-3">
            <h3 class="text-sm font-medium text-blue-800">
              {{ t("errorReports.systemSuggestions") }}
            </h3>
            <div class="mt-2 text-sm text-blue-700">
              <ul class="list-disc list-inside space-y-1">
                <li
                  v-for="recommendation in insights.recommendations"
                  :key="recommendation"
                >
                  {{ recommendation }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Error Reports Table -->
    <div class="bg-white shadow overflow-hidden sm:rounded-md">
      <div class="px-4 py-5 sm:px-6 border-b border-gray-200">
        <div class="flex items-center justify-between">
          <h3 class="text-lg leading-6 font-medium text-gray-900">
            {{ t("errorReports.recentReports") }}
          </h3>

          <!-- Filter controls -->
          <div class="flex items-center space-x-3">
            <select
              v-model="selectedSeverity"
              class="block w-32 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="">{{ t("errorReports.allSeverity") }}</option>
              <option value="low">{{ t("errorReports.low") }}</option>
              <option value="medium">{{ t("errorReports.medium") }}</option>
              <option value="high">{{ t("errorReports.high") }}</option>
              <option value="critical">{{ t("errorReports.critical") }}</option>
            </select>

            <select
              v-model="selectedType"
              class="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="">{{ t("errorReports.allTypes") }}</option>
              <option
                v-for="type in Object.keys(stats.errorsByType)"
                :key="type"
                :value="type"
              >
                {{ type }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <ul class="divide-y divide-gray-200">
        <li
          v-for="error in filteredErrors"
          :key="error.id"
          class="px-4 py-4 hover:bg-gray-50"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-start space-x-3">
              <!-- Severity indicator -->
              <div
                :class="[
                  'w-2 h-2 rounded-full mt-2',
                  getSeverityColor(error.severity),
                ]"
              />

              <div class="flex-1 min-w-0">
                <div class="flex items-center space-x-2">
                  <p class="text-sm font-medium text-gray-900">
                    {{ error.error.name }}
                  </p>
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      getSeverityBadgeColor(error.severity),
                    ]"
                  >
                    {{ error.severity }}
                  </span>
                  <span
                    v-if="!error.resolved"
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"
                  >
                    {{ t("errorReports.unresolved") }}
                  </span>
                </div>

                <p class="text-sm text-gray-600 mt-1">
                  {{ error.error.message }}
                </p>

                <div
                  class="flex items-center space-x-4 mt-2 text-xs text-gray-500"
                >
                  <span>{{ formatDate(error.timestamp) }}</span>
                  <span v-if="error.context.component">
                    {{ t("errorReports.component") }}
                    {{ error.context.component }}
                  </span>
                  <span v-if="error.context.url">
                    {{ t("errorReports.page") }}
                    {{ getPageFromUrl(error.context.url) }}
                  </span>
                </div>

                <!-- Tags -->
                <div
                  v-if="error.tags.length > 0"
                  class="flex items-center space-x-1 mt-2"
                >
                  <span
                    v-for="tag in error.tags"
                    :key="tag"
                    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800"
                  >
                    {{ tag }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center space-x-2">
              <button
                v-if="!error.resolved"
                class="text-green-600 hover:text-green-800 text-sm font-medium"
                @click="resolveError(error.id)"
              >
                {{ t("errorReports.markResolved") }}
              </button>

              <button
                class="text-blue-600 hover:text-blue-800 text-sm font-medium"
                @click="showErrorDetails(error)"
              >
                {{ t("common.detail") }}
              </button>
            </div>
          </div>
        </li>
      </ul>

      <!-- Empty state -->
      <div
        v-if="filteredErrors.length === 0"
        class="px-4 py-8 text-center text-gray-500"
      >
        <ExclamationTriangleIcon class="mx-auto h-12 w-12 text-gray-300 mb-4" />
        <p>{{ t("errorReports.noReportsFound") }}</p>
      </div>
    </div>

    <!-- Error Details Modal -->
    <div
      v-if="selectedError"
      class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50"
    >
      <div
        class="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white"
      >
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-medium text-gray-900">
            {{ t("errorReports.errorDetails") }}
          </h3>
          <button
            :aria-label="t('common.close')"
            class="text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            @click="selectedError = null"
          >
            <XMarkIcon class="w-6 h-6" />
          </button>
        </div>

        <div class="space-y-4">
          <!-- Error Info -->
          <div>
            <h4 class="text-sm font-medium text-gray-700 mb-2">
              {{ t("errorReports.errorInfo") }}
            </h4>
            <div class="bg-gray-50 p-3 rounded text-sm">
              <p>
                <strong>{{ t("errorReports.type") }}</strong>
                {{ selectedError.error.name }}
              </p>
              <p>
                <strong>{{ t("errorReports.message") }}</strong>
                {{ selectedError.error.message }}
              </p>
              <p>
                <strong>{{ t("errorReports.severity") }}</strong>
                {{ selectedError.severity }}
              </p>
            </div>
          </div>

          <!-- Stack Trace -->
          <div v-if="selectedError.error.stack">
            <h4 class="text-sm font-medium text-gray-700 mb-2">
              {{ t("errorReports.stackTrace") }}
            </h4>
            <pre
              class="bg-gray-900 text-white p-3 rounded text-xs overflow-auto max-h-40"
              >{{ selectedError.error.stack }}</pre
            >
          </div>

          <!-- Context -->
          <div v-if="selectedError.context">
            <h4 class="text-sm font-medium text-gray-700 mb-2">
              {{ t("errorReports.errorContext") }}
            </h4>
            <div class="bg-gray-50 p-3 rounded text-sm">
              <pre>{{ JSON.stringify(selectedError.context, null, 2) }}</pre>
            </div>
          </div>

          <!-- System Info -->
          <div v-if="selectedError.systemInfo">
            <h4 class="text-sm font-medium text-gray-700 mb-2">
              {{ t("errorReports.systemInfo") }}
            </h4>
            <div class="bg-gray-50 p-3 rounded text-sm">
              <pre>{{ JSON.stringify(selectedError.systemInfo, null, 2) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "@/i18n";
import {
  AlertTriangle as ExclamationTriangleIcon,
  Clock as ClockIcon,
  ShieldAlert as ShieldExclamationIcon,
  CheckCircle as CheckCircleIcon,
  RefreshCw as ArrowPathIcon,
  Download as ArrowDownTrayIcon,
  Info as InformationCircleIcon,
  X as XMarkIcon,
} from "lucide-vue-next";
import { useToast } from "vue-toastification";
import {
  errorReportingService,
  type ErrorReport,
} from "@/services/errorReportingService";

const { t, locale } = useI18n();
const toast = useToast();

// State
const loading = ref(false);
const autoRefresh = ref(true);
const selectedSeverity = ref("");
const selectedType = ref("");
const selectedError = ref<ErrorReport | null>(null);

// Data
const stats = computed(() => errorReportingService.getErrorStats());
const insights = computed(() => errorReportingService.getErrorInsights());
const errors = computed(() => errorReportingService.errorReports.value);

// Computed
const resolvedErrorsCount = computed(
  () => errors.value.filter((e) => e.resolved).length,
);

const maxTrendCount = computed(() =>
  Math.max(...insights.value.errorTrends.map((t) => t.count), 1),
);

const filteredErrors = computed(() => {
  let filtered = errors.value;

  if (selectedSeverity.value) {
    filtered = filtered.filter((e) => e.severity === selectedSeverity.value);
  }

  if (selectedType.value) {
    filtered = filtered.filter((e) => e.error.name === selectedType.value);
  }

  return filtered.slice(0, 50); // Limit for performance
});

// Methods
const refreshData = async () => {
  loading.value = true;
  try {
    // Simulate data refresh
    await new Promise((resolve) => setTimeout(resolve, 1000));
    toast.success(t("errorReports.dataUpdated"));
  } finally {
    loading.value = false;
  }
};

const exportErrors = () => {
  const data = errorReportingService.exportErrors();
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `error-reports-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);

  toast.success(t("errorReports.reportExported"));
};

const resolveError = (errorId: string) => {
  errorReportingService.resolveError(errorId);
  toast.success(t("errorReports.markedResolved"));
};

const showErrorDetails = (error: ErrorReport) => {
  selectedError.value = error;
};

const getSeverityColor = (severity: string): string => {
  const colors: Record<string, string> = {
    // medium was yellow and high orange, which are one colour here. Severity is
    // a ramp, so it climbs one: green → light orange → full orange → red.
    low: "bg-green-400",
    medium: "bg-orange-300",
    high: "bg-orange-500",
    critical: "bg-red-500",
  };
  return colors[severity] || "bg-gray-400";
};

const getSeverityBadgeColor = (severity: string): string => {
  const colors: Record<string, string> = {
    low: "bg-green-100 text-green-800",
    medium: "bg-orange-100 text-orange-800",
    high: "bg-orange-200 text-orange-900",
    critical: "bg-red-100 text-red-800",
  };
  return colors[severity] || "bg-gray-100 text-gray-800";
};

const formatDate = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) {
    return "剛才";
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分鐘前`;
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小時前`;
  } else {
    return date.toLocaleDateString(locale.value);
  }
};

const getPageFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch {
    return url;
  }
};

// Auto refresh setup
let refreshInterval: NodeJS.Timeout | null = null;

onMounted(() => {
  if (autoRefresh.value) {
    refreshInterval = setInterval(refreshData, 30000); // Every 30 seconds
  }
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
</script>

<style scoped>
/* Custom scrollbar for modal content */
pre {
  scrollbar-width: thin;
  scrollbar-color: #6b7280 #f3f4f6;
}

pre::-webkit-scrollbar {
  width: 6px;
}

pre::-webkit-scrollbar-track {
  background: #f3f4f6;
}

pre::-webkit-scrollbar-thumb {
  background-color: #6b7280;
  border-radius: 3px;
}
</style>
