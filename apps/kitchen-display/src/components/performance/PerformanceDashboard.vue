<template>
  <div
    class="performance-dashboard bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6"
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center space-x-3">
        <div
          class="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center"
        >
          <ChartBarIcon class="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("performance.title") }}
          </h3>
          <p class="text-sm text-gray-600">
            {{ t("performance.description") }}
          </p>
        </div>
      </div>

      <div class="flex items-center space-x-3">
        <!-- Collection Status -->
        <div class="flex items-center space-x-2">
          <div
            :class="[
              'w-3 h-3 rounded-full',
              isCollecting ? 'bg-green-500 animate-pulse' : 'bg-gray-300',
            ]"
          />
          <span class="text-sm font-medium text-gray-700">
            {{
              isCollecting
                ? t("performance.monitoringActive")
                : t("performance.monitoringInactive")
            }}
          </span>
        </div>

        <!-- Toggle Collection -->
        <button
          role="switch"
          :aria-checked="isCollecting"
          :aria-label="t('performance.title')"
          :class="[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2',
            isCollecting ? 'bg-emerald-600' : 'bg-gray-200',
          ]"
          @click="toggleCollection"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              isCollecting ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
      </div>
    </div>

    <!-- Overview Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-blue-50 rounded-lg p-4" data-testid="metric-card">
        <div class="flex items-center space-x-2 mb-2">
          <GlobeAltIcon class="w-5 h-5 text-blue-600" />
          <span class="text-sm font-medium text-blue-900">{{
            t("performance.pageLoad")
          }}</span>
        </div>
        <div class="text-2xl font-bold text-blue-600">
          {{ formatMetricValue(pageLoadTime.avg, "ms") }}
        </div>
        <div class="text-xs text-blue-600">
          P95: {{ formatMetricValue(pageLoadTime.p95, "ms") }}
        </div>
      </div>

      <div class="bg-green-50 rounded-lg p-4" data-testid="metric-card">
        <div class="flex items-center space-x-2 mb-2">
          <BoltIcon class="w-5 h-5 text-green-600" />
          <span class="text-sm font-medium text-green-900">{{
            t("performance.apiResponse")
          }}</span>
        </div>
        <div class="text-2xl font-bold text-green-600">
          {{ formatMetricValue(apiResponseTime.avg, "ms") }}
        </div>
        <div class="text-xs text-green-600">
          P95: {{ formatMetricValue(apiResponseTime.p95, "ms") }}
        </div>
      </div>

      <div class="bg-orange-50 rounded-lg p-4" data-testid="metric-card">
        <div class="flex items-center space-x-2 mb-2">
          <CpuChipIcon class="w-5 h-5 text-orange-600" />
          <span class="text-sm font-medium text-orange-900">{{
            t("performance.memoryUsage")
          }}</span>
        </div>
        <div class="text-2xl font-bold text-orange-600">
          {{ formatMetricValue(memoryUsage.avg, "%") }}
        </div>
        <div class="text-xs text-orange-600">
          最高: {{ formatMetricValue(memoryUsage.max, "%") }}
        </div>
      </div>

      <div class="bg-teal-50 rounded-lg p-4" data-testid="metric-card">
        <div class="flex items-center space-x-2 mb-2">
          <FilmIcon class="w-5 h-5 text-teal-600" />
          <span class="text-sm font-medium text-teal-900">{{
            t("performance.frameRate")
          }}</span>
        </div>
        <div class="text-2xl font-bold text-teal-600">
          {{ formatMetricValue(frameRate.avg, "fps") }}
        </div>
        <div class="text-xs text-teal-600">
          最低: {{ formatMetricValue(frameRate.min, "fps") }}
        </div>
      </div>
    </div>

    <!-- Performance Alerts -->
    <div v-if="activeAlerts.length > 0" class="mb-6">
      <h4 class="text-md font-semibold text-gray-900 mb-3 flex items-center">
        <ExclamationTriangleIcon class="w-5 h-5 mr-2 text-yellow-600" />
        {{ t("performance.performanceWarnings") }} ({{ activeAlerts.length }})
      </h4>

      <div class="space-y-2">
        <div
          v-for="alert in activeAlerts.slice(0, 3)"
          :key="alert.id"
          :class="[
            'flex items-center justify-between p-3 rounded-lg border-l-4',
            getAlertClass(alert.severity),
          ]"
        >
          <div>
            <div class="font-medium text-gray-900">
              {{ alert.title }}
            </div>
            <div class="text-sm text-gray-600">
              {{ alert.message }}
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {{ formatTime(alert.timestamp) }}
            </div>
          </div>

          <button
            class="text-sm px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700"
            @click="resolveAlert(alert.id)"
          >
            {{ t("common.resolve") }}
          </button>
        </div>

        <div v-if="activeAlerts.length > 3" class="text-center">
          <button
            class="text-sm text-blue-600 hover:text-blue-700"
            @click="showAllAlerts = !showAllAlerts"
          >
            {{
              showAllAlerts
                ? t("common.collapse")
                : t("performance.viewAllWarnings", {
                    count: activeAlerts.length,
                  })
            }}
          </button>
        </div>
      </div>
    </div>

    <!-- Performance Charts -->
    <div class="mb-6">
      <h4 class="text-md font-semibold text-gray-900 mb-4">
        {{ t("performance.performanceTrend") }}
      </h4>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Response Time Trend -->
        <div class="bg-gray-50 rounded-lg p-4" data-testid="performance-chart">
          <div class="flex items-center justify-between mb-3">
            <span class="font-medium text-gray-900">{{
              t("performance.responseTimeTrend")
            }}</span>
            <select
              v-model="selectedMetric"
              class="text-sm border border-gray-300 rounded px-2 py-1"
            >
              <option value="api-response-time">
                {{ t("performance.apiResponseTime") }}
              </option>
              <option value="page-load-time">
                {{ t("performance.pageLoadTime") }}
              </option>
              <option value="sse-connection-time">
                {{ t("performance.sseConnectionTime") }}
              </option>
            </select>
          </div>

          <!-- Simple chart representation -->
          <div
            class="h-32 bg-white rounded border flex items-end justify-between p-2"
          >
            <div
              v-for="(point, index) in selectedTrend"
              :key="index"
              :class="[
                'bg-blue-500 rounded-t transition-all duration-200',
                `w-${Math.max(1, Math.floor(100 / selectedTrend.length) - 1)}`,
              ]"
              :style="{
                height: `${Math.max(4, (point.value / Math.max(...selectedTrend.map((p) => p.value))) * 100)}%`,
                width: `${Math.max(4, 100 / selectedTrend.length - 2)}%`,
              }"
              :title="`${formatMetricValue(point.value, getMetricUnit(selectedMetric))} - ${formatTime(point.timestamp)}`"
            />
          </div>
        </div>

        <!-- System Resources -->
        <div class="bg-gray-50 rounded-lg p-4">
          <span class="font-medium text-gray-900 block mb-3">{{
            t("performance.systemResourceUsage")
          }}</span>

          <div class="space-y-3">
            <div>
              <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-600">{{
                  t("performance.memoryUsageRate")
                }}</span>
                <span class="font-medium">{{
                  formatMetricValue(memoryUsage.avg, "%")
                }}</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  class="bg-orange-500 h-2 rounded-full transition-all duration-300"
                  :style="{ width: `${Math.min(100, memoryUsage.avg)}%` }"
                />
              </div>
            </div>

            <div v-if="systemInfo.connection">
              <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-600">{{
                  t("performance.networkLatency")
                }}</span>
                <span class="font-medium"
                  >{{ systemInfo.connection.rtt }}ms</span
                >
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  :class="[
                    'h-2 rounded-full transition-all duration-300',
                    systemInfo.connection.rtt < 100
                      ? 'bg-green-500'
                      : systemInfo.connection.rtt < 300
                        ? 'bg-yellow-500'
                        : 'bg-red-500',
                  ]"
                  :style="{
                    width: `${Math.min(100, (systemInfo.connection.rtt / 500) * 100)}%`,
                  }"
                ></div>
              </div>
            </div>

            <div>
              <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-600">{{
                  t("performance.frameRate")
                }}</span>
                <span class="font-medium">{{
                  formatMetricValue(frameRate.avg, "fps")
                }}</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  :class="[
                    'h-2 rounded-full transition-all duration-300',
                    frameRate.avg >= 50
                      ? 'bg-green-500'
                      : frameRate.avg >= 30
                        ? 'bg-yellow-500'
                        : 'bg-red-500',
                  ]"
                  :style="{
                    width: `${Math.min(100, (frameRate.avg / 60) * 100)}%`,
                  }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- System Information -->
    <div class="mb-6">
      <h4 class="text-md font-semibold text-gray-900 mb-4">
        {{ t("performance.systemInfo") }}
      </h4>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div class="bg-gray-50 rounded-lg p-3">
          <div class="text-sm text-gray-600">
            {{ t("performance.browser") }}
          </div>
          <div class="font-medium text-gray-900">
            {{ getBrowserInfo() }}
          </div>
        </div>

        <div class="bg-gray-50 rounded-lg p-3">
          <div class="text-sm text-gray-600">
            {{ t("performance.operatingSystem") }}
          </div>
          <div class="font-medium text-gray-900">
            {{ systemInfo.platform }}
          </div>
        </div>

        <div class="bg-gray-50 rounded-lg p-3">
          <div class="text-sm text-gray-600">
            {{ t("performance.cpuCores") }}
          </div>
          <div class="font-medium text-gray-900">
            {{ systemInfo.hardwareConcurrency }}
          </div>
        </div>
      </div>

      <div v-if="systemInfo.memory" class="bg-gray-50 rounded-lg p-3">
        <div class="text-sm text-gray-600">
          {{ t("performance.jsHeapSize") }}
        </div>
        <div class="font-medium text-gray-900">
          {{ formatBytes(systemInfo.memory.usedJSHeapSize) }} /
          {{ formatBytes(systemInfo.memory.jsHeapSizeLimit) }}
        </div>
      </div>

      <div v-if="systemInfo.connection" class="bg-gray-50 rounded-lg p-3">
        <div class="text-sm text-gray-600">
          {{ t("performance.networkType") }}
        </div>
        <div class="font-medium text-gray-900">
          {{ systemInfo.connection.effectiveType.toUpperCase() }}
        </div>
      </div>
    </div>

    <div class="bg-gray-50 rounded-lg p-3">
      <div class="text-sm text-gray-600">
        {{ t("performance.uptimeLabel") }}
      </div>
      <div class="font-medium text-gray-900">
        {{ formatUptime(uptime) }}
      </div>
    </div>
  </div>

  <!-- Action Buttons -->
  <div class="flex justify-between items-center">
    <div class="flex space-x-3">
      <button
        class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
        @click="generateReport"
      >
        {{ t("performance.generateReport") }}
      </button>

      <button
        class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        @click="clearData"
      >
        {{ t("performance.clearData") }}
      </button>

      <button
        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        data-testid="export-report"
        @click="exportData"
      >
        {{ t("performance.exportData") }}
      </button>
    </div>

    <div class="text-sm text-gray-500">
      {{
        t("performance.metricsCollected", {
          count: totalMetrics,
          warnings: activeAlerts.length,
        })
      }}
    </div>
  </div>

  <!-- Performance Report Modal -->
  <div
    v-if="showReportModal"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    @click="showReportModal = false"
  >
    <div
      class="bg-white rounded-xl max-w-4xl max-h-[80vh] overflow-hidden mx-4"
      @click.stop
    >
      <!-- Modal Header -->
      <div
        class="flex items-center justify-between p-6 border-b border-gray-200"
      >
        <div>
          <h2 class="text-xl font-semibold text-gray-900">
            {{ t("performance.reportTitle") }}
          </h2>
          <p class="text-sm text-gray-600">{{ formatTime(Date.now()) }} 生成</p>
        </div>
        <button
          :aria-label="t('common.close')"
          class="text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
          @click="showReportModal = false"
        >
          <XMarkIcon class="w-5 h-5" />
        </button>
      </div>

      <!-- Report Content -->
      <div class="overflow-y-auto max-h-[60vh] p-6">
        <div v-if="performanceReport">
          <!-- Summary -->
          <div class="mb-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-3">
              {{ t("performance.overview") }}
            </h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div class="text-center p-3 bg-blue-50 rounded-lg">
                <div class="text-xl font-bold text-blue-600">
                  {{ performanceReport.summary.totalMetrics }}
                </div>
                <div class="text-sm text-blue-600">
                  {{ t("performance.collectedMetrics") }}
                </div>
              </div>
              <div class="text-center p-3 bg-red-50 rounded-lg">
                <div class="text-xl font-bold text-red-600">
                  {{ performanceReport.summary.activeAlerts }}
                </div>
                <div class="text-sm text-red-600">
                  {{ t("performance.activeWarnings") }}
                </div>
              </div>
              <div class="text-center p-3 bg-green-50 rounded-lg">
                <div class="text-xl font-bold text-green-600">
                  {{ formatUptime(performanceReport.summary.uptime) }}
                </div>
                <div class="text-sm text-green-600">
                  {{ t("performance.systemUptime") }}
                </div>
              </div>
              <div class="text-center p-3 bg-orange-50 rounded-lg">
                <div class="text-xl font-bold text-orange-600">
                  {{ (performanceReport.summary.errorRate * 100).toFixed(2) }}%
                </div>
                <div class="text-sm text-orange-600">
                  {{ t("performance.errorRate") }}
                </div>
              </div>
            </div>
          </div>

          <!-- Recommendations -->
          <div v-if="performanceReport.recommendations.length > 0" class="mb-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-3">
              {{ t("performance.suggestions") }}
            </h3>
            <div class="space-y-2">
              <div
                v-for="(
                  recommendation, index
                ) in performanceReport.recommendations"
                :key="index"
                class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
              >
                <div class="flex items-start space-x-2">
                  <LightBulbIcon class="w-5 h-5 text-yellow-600 mt-0.5" />
                  <span class="text-sm text-yellow-800">{{
                    recommendation
                  }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Detailed Metrics -->
          <div class="mb-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-3">
              {{ t("performance.detailedMetrics") }}
            </h3>
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th
                      class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {{ t("performance.metric") }}
                    </th>
                    <th
                      class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {{ t("performance.average") }}
                    </th>
                    <th
                      class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {{ t("performance.p95") }}
                    </th>
                    <th
                      class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {{ t("performance.max") }}
                    </th>
                    <th
                      class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {{ t("performance.samples") }}
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  <tr
                    v-for="(metric, name) in performanceReport.metrics"
                    :key="name"
                    class="hover:bg-gray-50"
                    data-testid="metric-item"
                  >
                    <td
                      class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900"
                    >
                      {{ getMetricDisplayName(String(name)) }}
                    </td>
                    <td
                      class="px-6 py-4 whitespace-nowrap text-sm text-gray-500"
                    >
                      {{
                        formatMetricValue(
                          metric.avg,
                          getMetricUnit(String(name)),
                        )
                      }}
                    </td>
                    <td
                      class="px-6 py-4 whitespace-nowrap text-sm text-gray-500"
                    >
                      {{
                        formatMetricValue(
                          metric.p95,
                          getMetricUnit(String(name)),
                        )
                      }}
                    </td>
                    <td
                      class="px-6 py-4 whitespace-nowrap text-sm text-gray-500"
                    >
                      {{
                        formatMetricValue(
                          metric.max,
                          getMetricUnit(String(name)),
                        )
                      }}
                    </td>
                    <td
                      class="px-6 py-4 whitespace-nowrap text-sm text-gray-500"
                    >
                      {{ metric.count }}
                    </td>
                  </tr>
                </tbody>
              </table>
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
  BarChart2 as ChartBarIcon,
  AlertTriangle as ExclamationTriangleIcon,
  Globe as GlobeAltIcon,
  Zap as BoltIcon,
  Cpu as CpuChipIcon,
  Film as FilmIcon,
  X as XMarkIcon,
  Lightbulb as LightBulbIcon,
} from "lucide-vue-next";
import { useToast } from "vue-toastification";
import { performanceService } from "@/services/performanceService";
import type { PerformanceReport } from "@/services/performanceService";

const { t } = useI18n();
const toast = useToast();

// State
const showAllAlerts = ref(false);
const showReportModal = ref(false);
const selectedMetric = ref("api-response-time");
const performanceReport = ref<PerformanceReport | null>(null);

// Update interval
let updateInterval: NodeJS.Timeout | null = null;

// Computed from performance service
const isCollecting = computed(() => performanceService.isCollecting.value);
const metrics = computed(() => performanceService.metrics.value);
const alerts = computed(() => performanceService.alerts.value);
const systemInfo = computed(() => performanceService.systemInfo.value);

const totalMetrics = computed(() => metrics.value.length);
const activeAlerts = computed(() =>
  showAllAlerts.value
    ? alerts.value.filter((a) => !a.resolved)
    : alerts.value.filter((a) => !a.resolved).slice(0, 3),
);

const uptime = computed(() => Date.now() - (Date.now() - 3600000)); // Simulated uptime

// Metric summaries
const pageLoadTime = computed(() =>
  performanceService.getMetricSummary("page-load-time"),
);
const apiResponseTime = computed(() =>
  performanceService.getMetricSummary("api-response-time"),
);
const memoryUsage = computed(() =>
  performanceService.getMetricSummary("memory-usage"),
);
const frameRate = computed(() =>
  performanceService.getMetricSummary("frame-rate"),
);

const selectedTrend = computed(() => {
  return performanceService.getMetricTrend(selectedMetric.value);
});

// Methods
const toggleCollection = () => {
  if (isCollecting.value) {
    performanceService.stopCollection();
    toast.info(t("performance.monitoringDisabledToast"));
  } else {
    performanceService.startCollection();
    toast.success(t("performance.monitoringEnabledToast"));
  }
};

const formatMetricValue = (value: number, unit: string): string => {
  if (value === 0) return "0";

  switch (unit) {
    case "ms":
      return value < 1000
        ? `${value.toFixed(0)}ms`
        : `${(value / 1000).toFixed(1)}s`;
    case "fps":
      return `${value.toFixed(1)}`;
    case "%":
      return `${value.toFixed(1)}%`;
    case "Mbps":
      return `${value.toFixed(1)} Mbps`;
    default:
      return value.toFixed(2);
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const formatUptime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天 ${hours % 24}時`;
  if (hours > 0) return `${hours}時 ${minutes % 60}分`;
  if (minutes > 0) return `${minutes}分 ${seconds % 60}秒`;
  return `${seconds}秒`;
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString("zh-TW");
};

const getBrowserInfo = (): string => {
  const ua = navigator.userAgent;
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari")) return "Safari";
  if (ua.includes("Edge")) return "Edge";
  return "Unknown";
};

const getAlertClass = (severity: string): string => {
  switch (severity) {
    case "critical":
      return "bg-red-50 border-red-400";
    case "high":
      return "bg-orange-50 border-orange-400";
    case "medium":
      return "bg-yellow-50 border-yellow-400";
    default:
      return "bg-blue-50 border-blue-400";
  }
};

const getMetricDisplayName = (name: string): string => {
  const keyMap: Record<string, string> = {
    "page-load-time": "performance.metricNames.pageLoad",
    "api-response-time": "performance.metricNames.apiResponse",
    "memory-usage": "performance.metricNames.memoryUsage",
    "frame-rate": "performance.metricNames.frameRate",
    "sse-connection-time": "performance.metricNames.sseConnection",
    "connection-rtt": "performance.metricNames.networkLatency",
    "first-contentful-paint": "performance.metricNames.fcp",
  };
  return keyMap[name] ? t(keyMap[name]) : name;
};

const getMetricUnit = (name: string): string => {
  const units: Record<string, string> = {
    "page-load-time": "ms",
    "api-response-time": "ms",
    "memory-usage": "%",
    "frame-rate": "fps",
    "sse-connection-time": "ms",
    "connection-rtt": "ms",
    "first-contentful-paint": "ms",
  };
  return units[name] || "";
};

const resolveAlert = (alertId: string) => {
  performanceService.resolveAlert(alertId);
  toast.success(t("performance.warningResolved"));
};

const generateReport = () => {
  performanceReport.value = performanceService.generateReport();
  showReportModal.value = true;
};

const clearData = () => {
  performanceService.metrics.value = [];
  performanceService.alerts.value = [];
  toast.success(t("performance.dataCleared"));
};

const exportData = () => {
  const report = performanceService.generateReport();
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `performance-report-${new Date().toISOString().split("T")[0]}.json`;
  link.click();

  toast.success(t("performance.dataExported"));
};

// Start real-time updates
onMounted(() => {
  updateInterval = setInterval(() => {
    // The performance service will handle its own updates
    // Just trigger reactivity by accessing the reactive properties
    performanceService.systemInfo.value;
  }, 5000);
});

onUnmounted(() => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
});
</script>

<style scoped>
/* Simple chart bars */
.bg-blue-500 {
  background-color: #007aff;
  opacity: 0.8;
}

.bg-blue-500:hover {
  opacity: 1;
}

/* Scrollbar styling */
.overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

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
</style>
