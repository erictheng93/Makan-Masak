<template>
  <div class="h-80">
    <div v-if="loading" class="flex items-center justify-center h-full">
      <div class="animate-pulse flex space-x-4 w-full">
        <div class="rounded-full bg-gray-300 h-10 w-10" />
        <div class="flex-1 space-y-2 py-1">
          <div class="h-4 bg-gray-300 rounded w-3/4" />
          <div class="space-y-2">
            <div class="h-4 bg-gray-300 rounded" />
            <div class="h-4 bg-gray-300 rounded w-5/6" />
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="!data || data.length === 0"
      class="flex items-center justify-center h-full text-gray-500"
    >
      <div class="text-center">
        <BarChart3 class="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <p>{{ t("charts.ordersChart.noData") }}</p>
      </div>
    </div>

    <canvas v-else ref="chartCanvas" class="w-full h-full" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import { Chart as ChartJS } from "chart.js";
import "@/utils/chartRegistry";
import { BarChart3 } from "lucide-vue-next";
import { useI18n } from "@/i18n";

const { t } = useI18n();

interface OrderDataPoint {
  label: string;
  total: number;
  date: string;
}

interface OrdersChartProps {
  data: OrderDataPoint[];
  loading?: boolean;
  period: "daily" | "weekly" | "monthly";
}

const props = withDefaults(defineProps<OrdersChartProps>(), {
  loading: false,
});

const chartCanvas = ref<HTMLCanvasElement>();
let chartInstance: ChartJS | null = null;

const createChart = async () => {
  if (!chartCanvas.value || !props.data || props.data.length === 0) return;

  await nextTick();

  const ctx = chartCanvas.value.getContext("2d");
  if (!ctx) return;

  // Destroy existing chart
  if (chartInstance) {
    chartInstance.destroy();
  }

  const labels = props.data.map((item) => item.label);
  const totalData = props.data.map((item) => item.total);

  const maxValue = Math.max(...props.data.map((item) => item.total));
  const suggestedMax = Math.ceil(maxValue * 1.1);

  chartInstance = new ChartJS(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: t("charts.ordersChart.orderCount"),
          data: totalData,
          backgroundColor: "rgba(59, 130, 246, 0.8)",
          borderColor: "rgb(59, 130, 246)",
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index",
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: getPeriodLabel(),
            font: {
              size: 12,
              weight: "bold",
            },
          },
          grid: {
            display: false,
          },
          ticks: {
            font: {
              size: 11,
            },
          },
        },
        y: {
          display: true,
          title: {
            display: true,
            text: t("charts.ordersChart.orderCount"),
            font: {
              size: 12,
              weight: "bold",
            },
          },
          beginAtZero: true,
          suggestedMax,
          grid: {
            color: "rgba(0, 0, 0, 0.05)",
          },
          ticks: {
            font: {
              size: 11,
            },
            stepSize: 1,
            callback: function (value) {
              return Math.floor(value as number).toString();
            },
          },
        },
      },
      plugins: {
        tooltip: {
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          titleColor: "white",
          bodyColor: "white",
          borderColor: "rgba(59, 130, 246, 0.8)",
          borderWidth: 1,
          cornerRadius: 8,
          callbacks: {
            title: function (context) {
              const dataPoint = props.data[context[0].dataIndex];
              return `${context[0].label} - ${dataPoint.date}`;
            },
            afterBody: function (context) {
              const dataIndex = context[0].dataIndex;
              const dataPoint = props.data[dataIndex];
              return t("charts.ordersChart.totalOrders", {
                count: dataPoint.total,
              });
            },
          },
        },
        legend: {
          display: true,
          position: "top",
          labels: {
            padding: 20,
            font: {
              size: 12,
            },
          },
        },
      },
      animation: {
        duration: 1000,
        easing: "easeOutQuart",
      },
    },
  });
};

const getPeriodLabel = () => {
  switch (props.period) {
    case "daily":
      return t("charts.ordersChart.periodDaily");
    case "weekly":
      return t("charts.ordersChart.periodWeekly");
    case "monthly":
      return t("charts.ordersChart.periodMonthly");
    default:
      return t("charts.ordersChart.periodDefault");
  }
};

watch(
  () => [props.data, props.period],
  () => {
    if (!props.loading) {
      createChart();
    }
  },
  { deep: true },
);

onMounted(() => {
  if (!props.loading && props.data) {
    createChart();
  }
});

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy();
  }
});
</script>
