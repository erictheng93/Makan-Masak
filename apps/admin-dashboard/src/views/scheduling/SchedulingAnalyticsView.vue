<template>
  <div class="scheduling-analytics-view">
    <!-- 頁面標題 -->
    <div class="page-header">
      <div class="header-content">
        <h1 class="page-title">
          <span class="title-icon">📊</span>
          {{ t("schedulingAnalytics.title") }}
        </h1>
        <p class="page-subtitle">{{ t("schedulingAnalytics.subtitle") }}</p>
      </div>
      <div class="header-actions">
        <button class="action-btn refresh-btn" @click="refreshAllData">
          <span class="btn-icon">🔄</span>
          {{ t("schedulingAnalytics.refreshData") }}
        </button>
        <button class="action-btn export-btn" @click="exportReport">
          <span class="btn-icon">📥</span>
          {{ t("schedulingAnalytics.exportReport") }}
        </button>
      </div>
    </div>

    <!-- 快速統計卡片 -->
    <div class="quick-stats">
      <div v-for="(stat, index) in quickStats" :key="index" class="stat-card">
        <div
          class="stat-icon"
          :style="{ backgroundColor: stat.color + '20', color: stat.color }"
        >
          {{ stat.icon }}
        </div>
        <div class="stat-content">
          <div class="stat-label">{{ stat.label }}</div>
          <div class="stat-value">{{ stat.value }}</div>
          <div class="stat-change" :class="stat.trend">
            <span class="change-icon">{{ stat.changeIcon }}</span>
            <span>{{ stat.change }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 圖表網格 -->
    <div class="charts-grid">
      <!-- 工時分析圖表 -->
      <div class="chart-section full-width">
        <WorkHoursChart :auto-fetch="true" />
      </div>

      <!-- 班別分布和趨勢圖表 -->
      <div class="chart-section">
        <ShiftDistributionChart :auto-fetch="true" />
      </div>

      <div class="chart-section">
        <TrendChart :auto-fetch="true" />
      </div>

      <!-- 數據洞察面板 -->
      <div class="chart-section full-width">
        <div class="analysis-panel">
          <h3 class="panel-title">
            <span class="icon">💡</span>
            {{ t("schedulingAnalytics.dataInsights") }}
          </h3>
          <div class="insights-grid">
            <div
              v-for="insight in insights"
              :key="insight.id"
              class="insight-card"
            >
              <div
                class="insight-icon"
                :style="{ backgroundColor: insight.color }"
              >
                {{ insight.icon }}
              </div>
              <div class="insight-content">
                <h4 class="insight-title">{{ insight.title }}</h4>
                <p class="insight-description">{{ insight.description }}</p>
              </div>
              <div class="insight-action">
                <button
                  class="view-detail-btn"
                  @click="viewInsightDetail(insight)"
                >
                  {{ t("schedulingAnalytics.viewDetails") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useAuthStore } from "@/stores/auth";
import { schedulingService } from "@/services/schedulingService";
import WorkHoursChart from "@/components/charts/WorkHoursChart.vue";
import ShiftDistributionChart from "@/components/charts/ShiftDistributionChart.vue";
import TrendChart from "@/components/charts/TrendChart.vue";

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();
const loading = ref(false);

interface SchedulingInsight {
  id: number;
  icon: string;
  title: string;
  description: string;
  color: string;
}

// 快速統計數據
const quickStats = ref([
  {
    icon: "👥",
    label: t("schedulingAnalytics.activeEmployees"),
    value: "—",
    change: "",
    changeIcon: "",
    trend: "positive",
    color: "#007aff",
  },
  {
    icon: "⏰",
    label: t("schedulingAnalytics.totalScheduledHours"),
    value: "—",
    change: "",
    changeIcon: "",
    trend: "positive",
    color: "#34c759",
  },
  {
    icon: "📅",
    label: t("schedulingAnalytics.weeklySchedules"),
    value: "—",
    change: "",
    changeIcon: "",
    trend: "positive",
    color: "#ff9500",
  },
  {
    icon: "⚡",
    label: t("schedulingAnalytics.currentlyOnDuty"),
    value: "—",
    change: "",
    changeIcon: "",
    trend: "positive",
    color: "#ff3b30",
  },
]);

// 數據洞察
const insights = ref<SchedulingInsight[]>([]);

/**
 * Fetch analytics data from the API
 */
const fetchAnalyticsData = async () => {
  try {
    loading.value = true;
    // Platform administrators can choose a restaurant without being assigned
    // to one themselves. Analytics must use that selected tenant, like the
    // charts below, rather than the logged-in account's nullable restaurant.
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;

    // Fetch daily stats for today
    const today = new Date().toISOString().split("T")[0];
    const dailyStats = await schedulingService.getDailyStats(
      restaurantId,
      today,
    );

    // Fetch weekly stats
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - ((dayOfWeek + 6) % 7));
    const weekStart = monday.toISOString().split("T")[0];
    const weeklyStats = await schedulingService.getWeeklySummary(
      restaurantId,
      weekStart,
    );

    // Update quick stats with real data
    quickStats.value = [
      {
        icon: "👥",
        label: t("schedulingAnalytics.activeEmployees"),
        value: String(dailyStats.totalEmployees || 0),
        change: "",
        changeIcon: "",
        trend: "positive",
        color: "#007aff",
      },
      {
        icon: "⏰",
        label: t("schedulingAnalytics.totalScheduledHours"),
        value: `${Math.round(dailyStats.totalHours || 0)}h`,
        change: "",
        changeIcon: "",
        trend: "positive",
        color: "#34c759",
      },
      {
        icon: "📅",
        label: t("schedulingAnalytics.weeklySchedules"),
        value: String(weeklyStats.totalSchedules || 0),
        change: "",
        changeIcon: "",
        trend: "positive",
        color: "#ff9500",
      },
      {
        icon: "⚡",
        label: t("schedulingAnalytics.currentlyOnDuty"),
        value: String(dailyStats.currentlyWorking || 0),
        change: "",
        changeIcon: "",
        trend: "positive",
        color: "#ff3b30",
      },
    ];

    // Generate data-driven insights
    const generatedInsights: SchedulingInsight[] = [];
    const noShowCount = dailyStats.statusBreakdown?.noShow || 0;
    if (noShowCount > 0) {
      generatedInsights.push({
        id: 1,
        icon: "⚠️",
        title: t("schedulingAnalytics.insightAbsenceTitle"),
        description: t("schedulingAnalytics.insightAbsenceDesc", {
          count: noShowCount,
        }),
        color: "#ff3b30",
      });
    }

    const overtimeHours = dailyStats.totalOvertimeHours || 0;
    if (overtimeHours > 0) {
      generatedInsights.push({
        id: 2,
        icon: "📈",
        title: t("schedulingAnalytics.insightOvertimeTitle"),
        description: t("schedulingAnalytics.insightOvertimeDesc", {
          hours: Math.round(overtimeHours * 10) / 10,
        }),
        color: "#ff9500",
      });
    }

    const cancelledCount = dailyStats.statusBreakdown?.cancelled || 0;
    if (cancelledCount > 0) {
      generatedInsights.push({
        id: 3,
        icon: "💡",
        title: t("schedulingAnalytics.insightCancelledTitle"),
        description: t("schedulingAnalytics.insightCancelledDesc", {
          count: cancelledCount,
        }),
        color: "#007aff",
      });
    }

    if (generatedInsights.length === 0) {
      generatedInsights.push({
        id: 4,
        icon: "🎯",
        title: t("schedulingAnalytics.insightAllGoodTitle"),
        description: t("schedulingAnalytics.insightAllGoodDesc"),
        color: "#34c759",
      });
    }

    insights.value = generatedInsights;
  } catch (error) {
    console.error("Failed to fetch analytics data:", error);
  } finally {
    loading.value = false;
  }
};

// 刷新所有數據
const refreshAllData = () => {
  fetchAnalyticsData();
};

// 匯出報告
const exportReport = () => {
  const reportData = {
    generated: new Date().toISOString(),
    stats: quickStats.value,
    insights: insights.value,
  };

  const dataStr = JSON.stringify(reportData, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `scheduling-analytics-${new Date().toISOString().split("T")[0]}.json`;
  link.click();

  URL.revokeObjectURL(url);
};

// 查看洞察詳情
const viewInsightDetail = (insight: SchedulingInsight) => {
  console.log("Viewing insight:", insight);
  toast.info(
    `${t("schedulingAnalytics.viewInsightDetail")}:\n\n${insight.title}\n\n${insight.description}`,
  );
};

onMounted(() => {
  fetchAnalyticsData();
});
</script>

<style scoped>
.scheduling-analytics-view {
  padding: 24px;
  background: #f9fafb;
  min-height: 100vh;
}

/* 頁面標題 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
  background: white;
  padding: 24px;
  border-radius: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.header-content {
  flex: 1;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 32px;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px 0;
}

.title-icon {
  font-size: 36px;
}

.page-subtitle {
  font-size: 16px;
  color: #6b7280;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.refresh-btn {
  background: #f3f4f6;
  color: #374151;
}

.refresh-btn:hover {
  background: #e5e7eb;
  transform: translateY(-1px);
}

.export-btn {
  background: #007aff;
  color: white;
}

.export-btn:hover {
  background: #2563eb;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.btn-icon {
  font-size: 16px;
}

/* 快速統計卡片 */
.quick-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 32px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: white;
  padding: 20px;
  border-radius: 14px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

.stat-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-size: 28px;
}

.stat-content {
  flex: 1;
}

.stat-label {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 4px;
}

.stat-change {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
}

.stat-change.positive {
  color: #34c759;
}

.stat-change.negative {
  color: #ff3b30;
}

.stat-change.warning {
  color: #ff9500;
}

.change-icon {
  font-size: 14px;
}

/* 圖表網格 */
.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.chart-section {
  animation: fadeIn 0.5s ease-in-out;
}

.chart-section.full-width {
  grid-column: 1 / -1;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 分析面板 */
.analysis-panel {
  background: white;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 20px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 20px 0;
}

.panel-title .icon {
  font-size: 24px;
}

.insights-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.insight-card {
  display: flex;
  gap: 16px;
  padding: 20px;
  background: #f9fafb;
  border-radius: 12px;
  border-left: 4px solid #007aff;
  transition: all 0.2s;
}

.insight-card:hover {
  background: #f3f4f6;
  transform: translateX(4px);
}

.insight-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 24px;
  color: white;
  flex-shrink: 0;
}

.insight-content {
  flex: 1;
  min-width: 0;
}

.insight-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 8px 0;
}

.insight-description {
  font-size: 14px;
  color: #6b7280;
  line-height: 1.6;
  margin: 0;
}

.insight-action {
  display: flex;
  align-items: center;
}

.view-detail-btn {
  padding: 8px 16px;
  background: transparent;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.view-detail-btn:hover {
  background: white;
  border-color: #007aff;
  color: #007aff;
}

/* 響應式設計 */
@media (max-width: 1200px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .chart-section.full-width {
    grid-column: auto;
  }
}

@media (max-width: 768px) {
  .scheduling-analytics-view {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    gap: 16px;
  }

  .header-actions {
    width: 100%;
  }

  .action-btn {
    flex: 1;
  }

  .quick-stats {
    grid-template-columns: 1fr;
  }

  .insights-grid {
    grid-template-columns: 1fr;
  }

  .insight-card {
    flex-direction: column;
  }

  .view-detail-btn {
    width: 100%;
  }
}
</style>
