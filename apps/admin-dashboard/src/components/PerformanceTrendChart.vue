<template>
  <div class="performance-trend-chart">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-gray-900">
        {{ title || t("performanceChart.title") }}
      </h3>
      <div class="flex items-center space-x-2">
        <!-- 圖表類型切換 -->
        <select
          v-model="chartType"
          class="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="line">{{ t("performanceChart.lineChart") }}</option>
          <option value="bar">{{ t("performanceChart.barChart") }}</option>
          <option value="area">{{ t("performanceChart.areaChart") }}</option>
        </select>

        <!-- 指標切換 -->
        <select
          v-model="selectedMetric"
          class="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="completion_rate">
            {{ t("performanceChart.completionRate") }}
          </option>
          <option value="avg_prep_time">
            {{ t("performanceChart.avgPrepTime") }}
          </option>
          <option value="revenue">{{ t("performanceChart.revenue") }}</option>
          <option value="total_orders">
            {{ t("performanceChart.totalOrders") }}
          </option>
        </select>
      </div>
    </div>

    <div class="chart-container" :class="{ loading: isLoading }">
      <canvas
        ref="chartCanvas"
        :width="width"
        :height="height"
        class="max-w-full"
      />

      <!-- 載入指示器 -->
      <div
        v-if="isLoading"
        class="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75"
      >
        <div class="flex items-center space-x-2">
          <div
            class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"
          />
          <span class="text-sm text-gray-600">{{ t("common.loading") }}</span>
        </div>
      </div>

      <!-- 無數據狀態 -->
      <div
        v-if="!isLoading && (!data || data.length === 0)"
        class="absolute inset-0 flex items-center justify-center"
      >
        <div class="text-center">
          <ChartBarIcon class="mx-auto h-12 w-12 text-gray-400 mb-2" />
          <p class="text-gray-500">{{ t("common.noData") }}</p>
        </div>
      </div>
    </div>

    <!-- 圖表說明 -->
    <div class="mt-4 flex items-center justify-between text-sm text-gray-600">
      <div class="flex items-center space-x-4">
        <div v-if="averageValue !== null" class="flex items-center">
          <span class="w-3 h-3 bg-blue-500 rounded-full mr-1" />
          <span
            >{{ t("performanceChart.average") }}:
            {{ formatValue(averageValue, selectedMetric) }}</span
          >
        </div>
        <div v-if="trendDirection" class="flex items-center">
          <ArrowTrendingUpIcon
            v-if="trendDirection === 'up'"
            class="w-4 h-4 text-green-500 mr-1"
          />
          <ArrowTrendingDownIcon
            v-if="trendDirection === 'down'"
            class="w-4 h-4 text-red-500 mr-1"
          />
          <MinusIcon
            v-if="trendDirection === 'stable'"
            class="w-4 h-4 text-gray-500 mr-1"
          />
          <span
            >{{ t("performanceChart.trend") }}:
            {{ getTrendText(trendDirection) }}</span
          >
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <button
          class="text-blue-600 hover:text-blue-800 underline"
          @click="toggleFullscreen"
        >
          {{
            isFullscreen
              ? t("performanceChart.exitFullscreen")
              : t("performanceChart.fullscreen")
          }}
        </button>
        <button
          class="text-green-600 hover:text-green-800 underline"
          @click="exportChart"
        >
          {{ t("performanceChart.exportImage") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { Chart, type TooltipItem } from "chart.js";
import "@/utils/chartRegistry";
import {
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  MinusIcon,
} from "@heroicons/vue/24/outline";
import type { PerformanceTrend } from "@/services/statisticsService";
import {
  CHART_METRIC_COLORS,
  CHART_NEUTRAL_COLOR,
  withAlpha,
} from "@makanmasak/shared/utils/chart-palette";

interface Props {
  data: PerformanceTrend[];
  title?: string;
  width?: number;
  height?: number;
  isLoading?: boolean;
}

const { t } = useI18n();
const { formatPrice, currencySymbol } = useCurrency();
const { formatShortDate } = useDateFormatter();

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  width: 800,
  height: 400,
  isLoading: false,
});

// 圖表狀態
const chartCanvas = ref<HTMLCanvasElement | null>(null);
const chartInstance = ref<Chart | null>(null);
const chartType = ref<"line" | "bar" | "area">("line");
const selectedMetric = ref<
  "completion_rate" | "avg_prep_time" | "revenue" | "total_orders"
>("completion_rate");
const isFullscreen = ref(false);

// 計算圖表數據
const chartData = computed(() => {
  if (!props.data || props.data.length === 0) return null;

  const labels = props.data.map((item) => formatShortDate(item.date));

  const values = props.data.map((item) => {
    switch (selectedMetric.value) {
      case "completion_rate":
        return item.completion_rate;
      case "avg_prep_time":
        return Math.round(item.avg_prep_time || 0);
      case "revenue":
        return item.revenue;
      case "total_orders":
        return item.total_orders;
      default:
        return 0;
    }
  });

  return {
    labels,
    datasets: [
      {
        label: getMetricLabel(selectedMetric.value),
        data: values,
        borderColor: getMetricColor(selectedMetric.value),
        backgroundColor:
          chartType.value === "area"
            ? getMetricColor(selectedMetric.value, 0.2)
            : getMetricColor(selectedMetric.value, 0.8),
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: chartType.value === "area",
        tension: 0.4,
      },
    ],
  };
});

// 計算平均值
const averageValue = computed(() => {
  if (!props.data || props.data.length === 0) return null;

  const values = props.data.map((item) => {
    switch (selectedMetric.value) {
      case "completion_rate":
        return item.completion_rate;
      case "avg_prep_time":
        return item.avg_prep_time || 0;
      case "revenue":
        return item.revenue;
      case "total_orders":
        return item.total_orders;
      default:
        return 0;
    }
  });

  return values.reduce((sum, val) => sum + val, 0) / values.length;
});

// 計算趨勢方向
const trendDirection = computed(() => {
  if (!props.data || props.data.length < 3) return null;

  const recent = props.data.slice(0, Math.ceil(props.data.length / 2));
  const earlier = props.data.slice(Math.floor(props.data.length / 2));

  const recentAvg =
    recent.reduce((sum, item) => {
      switch (selectedMetric.value) {
        case "completion_rate":
          return sum + item.completion_rate;
        case "avg_prep_time":
          return sum + (item.avg_prep_time || 0);
        case "revenue":
          return sum + item.revenue;
        case "total_orders":
          return sum + item.total_orders;
        default:
          return sum;
      }
    }, 0) / recent.length;

  const earlierAvg =
    earlier.reduce((sum, item) => {
      switch (selectedMetric.value) {
        case "completion_rate":
          return sum + item.completion_rate;
        case "avg_prep_time":
          return sum + (item.avg_prep_time || 0);
        case "revenue":
          return sum + item.revenue;
        case "total_orders":
          return sum + item.total_orders;
        default:
          return sum;
      }
    }, 0) / earlier.length;

  const difference = recentAvg - earlierAvg;
  const threshold = earlierAvg * 0.05; // 5% threshold

  if (Math.abs(difference) < threshold) return "stable";
  return difference > 0 ? "up" : "down";
});

// 圖表配置
const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    intersect: false,
    mode: "index" as const,
  },
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      callbacks: {
        label: (context: TooltipItem<"line">) => {
          const label = context.dataset.label || "";
          const value = formatValue(
            context.parsed.y ?? 0,
            selectedMetric.value,
          );
          return `${label}: ${value}`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: {
        display: true,
        color: "rgba(0, 0, 0, 0.05)",
      },
    },
    y: {
      beginAtZero: selectedMetric.value !== "revenue",
      grid: {
        display: true,
        color: "rgba(0, 0, 0, 0.05)",
      },
      ticks: {
        callback: (value: string | number) =>
          formatValue(Number(value), selectedMetric.value),
      },
    },
  },
  elements: {
    point: {
      hoverBackgroundColor: getMetricColor(selectedMetric.value),
    },
  },
}));

// 創建或更新圖表
const createChart = () => {
  if (!chartCanvas.value || !chartData.value) return;

  if (chartInstance.value) {
    chartInstance.value.destroy();
  }

  const ctx = chartCanvas.value.getContext("2d");
  if (!ctx) return;

  chartInstance.value = new Chart(ctx, {
    type: chartType.value === "area" ? "line" : chartType.value,
    data: chartData.value,
    options: chartOptions.value,
  });
};

// 更新圖表
const updateChart = () => {
  if (!chartInstance.value || !chartData.value) return;

  chartInstance.value.data = chartData.value;
  chartInstance.value.options = chartOptions.value;
  chartInstance.value.update("resize");
};

// 輔助函數
const getMetricLabel = (metric: string) => {
  const labels: Record<string, string> = {
    completion_rate: t("performanceChart.completionRatePercent"),
    avg_prep_time: t("performanceChart.avgPrepTimeMinutes"),
    revenue: `${t("performanceChart.revenue")} (${currencySymbol.value})`,
    total_orders: t("performanceChart.totalOrders"),
  };
  return labels[metric] || metric;
};

// Metric colours come from the shared chart palette so the same metric is the
// same colour in every chart that plots it. These used to be Tailwind's
// green/blue/purple/amber, which is how "revenue" ended up purple -- a hue this
// design system does not have.
const getMetricColor = (metric: string, alpha = 1) => {
  const hex = CHART_METRIC_COLORS[metric];
  if (!hex) return withAlpha(CHART_NEUTRAL_COLOR, alpha);
  return withAlpha(hex, alpha);
};

const formatValue = (value: number, metric: string) => {
  switch (metric) {
    case "completion_rate":
      return `${value.toFixed(1)}%`;
    case "avg_prep_time":
      return t("performanceChart.minutesValue", { value: Math.round(value) });
    case "revenue":
      return formatPrice(value);
    case "total_orders":
      return t("performanceChart.ordersValue", { value });
    default:
      return value.toString();
  }
};

const getTrendText = (direction: string) => {
  const texts: Record<string, string> = {
    up: t("performanceChart.trendUp"),
    down: t("performanceChart.trendDown"),
    stable: t("performanceChart.trendStable"),
  };
  return texts[direction] || direction;
};

const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value;
  // 實際的全屏邏輯需要額外實現
};

const exportChart = () => {
  if (!chartInstance.value) return;

  const url = chartInstance.value.toBase64Image();
  const link = document.createElement("a");
  link.download = `performance-trend-${selectedMetric.value}-${new Date().toISOString().split("T")[0]}.png`;
  link.href = url;
  link.click();
};

// 監聽數據變化
watch(
  () => props.data,
  () => {
    nextTick(() => {
      if (chartInstance.value) {
        updateChart();
      } else {
        createChart();
      }
    });
  },
);

watch(chartType, () => {
  nextTick(createChart);
});

watch(selectedMetric, () => {
  nextTick(() => {
    if (chartInstance.value) {
      updateChart();
    } else {
      createChart();
    }
  });
});

// 生命週期
onMounted(() => {
  nextTick(createChart);
});

onUnmounted(() => {
  if (chartInstance.value) {
    chartInstance.value.destroy();
  }
});
</script>

<style scoped>
.chart-container {
  @apply relative w-full;
  height: 400px;
}

.chart-container.loading {
  @apply opacity-50;
}

@media (max-width: 768px) {
  .chart-container {
    height: 300px;
  }
}
</style>
