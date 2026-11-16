/**
 * Health Store
 * 健康監控狀態管理
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { healthApi } from "@/services/api";
import type { HealthCheck, HealthStatus } from "@/types";

export const useHealthStore = defineStore("health", () => {
  // 狀態
  const healthChecks = ref<HealthCheck[]>([]);
  const loading = ref(false);
  const lastUpdated = ref<Date | null>(null);

  // 計算屬性
  const healthyCount = computed(
    () => healthChecks.value.filter((h) => h.status === "healthy").length,
  );

  const degradedCount = computed(
    () => healthChecks.value.filter((h) => h.status === "degraded").length,
  );

  const downCount = computed(
    () => healthChecks.value.filter((h) => h.status === "down").length,
  );

  const overallStatus = computed<HealthStatus>(() => {
    if (downCount.value > 0) return "down";
    if (degradedCount.value > 0) return "degraded";
    if (healthyCount.value > 0) return "healthy";
    return "unknown";
  });

  const averageResponseTime = computed(() => {
    const checks = healthChecks.value.filter(
      (h) => h.responseTimeMs !== undefined,
    );
    if (checks.length === 0) return 0;
    const total = checks.reduce((sum, h) => sum + (h.responseTimeMs || 0), 0);
    return Math.round(total / checks.length);
  });

  // 按狀態分組
  const groupedByStatus = computed(() => {
    const groups: Record<HealthStatus, HealthCheck[]> = {
      healthy: [],
      degraded: [],
      down: [],
      unknown: [],
    };
    healthChecks.value.forEach((check) => {
      groups[check.status].push(check);
    });
    return groups;
  });

  // 方法
  async function fetchAllHealthChecks() {
    loading.value = true;
    try {
      const { tenants } = await healthApi.getAllStatus();
      // The API returns one row per tenant with its latest check nested
      // under `health`, not a HealthCheck[] — flatten it here.
      healthChecks.value = tenants.map(({ tenantId, health }) => ({
        id: tenantId,
        tenantId,
        status: health.status,
        responseTimeMs: health.responseTimeMs ?? undefined,
        checkedAt: health.lastCheck ?? "",
      }));
      lastUpdated.value = new Date();
    } catch (e) {
      console.error("獲取健康狀態失敗:", e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function checkTenantHealth(tenantId: string) {
    try {
      const check = await healthApi.check(tenantId);
      // 更新列表中的對應項目
      const index = healthChecks.value.findIndex(
        (h) => h.tenantId === tenantId,
      );
      if (index !== -1) {
        healthChecks.value[index] = check;
      } else {
        healthChecks.value.push(check);
      }
      return check;
    } catch (e) {
      console.error("健康檢查失敗:", e);
      throw e;
    }
  }

  function getStatusColor(status: HealthStatus): string {
    switch (status) {
      case "healthy":
        return "green";
      case "degraded":
        return "yellow";
      case "down":
        return "red";
      default:
        return "gray";
    }
  }

  function getStatusLabel(status: HealthStatus): string {
    switch (status) {
      case "healthy":
        return "正常";
      case "degraded":
        return "降級";
      case "down":
        return "離線";
      default:
        return "未知";
    }
  }

  return {
    // 狀態
    healthChecks,
    loading,
    lastUpdated,

    // 計算屬性
    healthyCount,
    degradedCount,
    downCount,
    overallStatus,
    averageResponseTime,
    groupedByStatus,

    // 方法
    fetchAllHealthChecks,
    checkTenantHealth,
    getStatusColor,
    getStatusLabel,
  };
});
