<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useHealthStore } from "@/stores/health";
import { useTenantsStore } from "@/stores/tenants";
import { RouterLink } from "vue-router";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import type { HealthStatus } from "@/types";

const { t } = useI18n();
const healthStore = useHealthStore();
const tenantsStore = useTenantsStore();
const refreshing = ref(false);

// 健康狀態標籤 (i18n 版本)
const getHealthStatusLabel = (status: HealthStatus) => {
  if (status === "unknown") return t("common.unknown");
  const key = `health.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
};

// 載入資料
onMounted(async () => {
  await Promise.all([
    healthStore.fetchAllHealthChecks(),
    tenantsStore.fetchTenants(),
  ]);
});

// 刷新資料
const handleRefresh = async () => {
  refreshing.value = true;
  try {
    await healthStore.fetchAllHealthChecks();
  } finally {
    refreshing.value = false;
  }
};

// 獲取租戶名稱
const getTenantName = (tenantId: string) => {
  const tenant = tenantsStore.tenants.find((t) => t.id === tenantId);
  return tenant?.businessName || tenantId;
};
</script>

<template>
  <div class="space-y-6" data-testid="management-health-page">
    <!-- 頁面標題 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">
          {{ t("health.title") }}
        </h1>
        <p class="mt-1 text-sm text-gray-500">{{ t("health.subtitle") }}</p>
      </div>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="refreshing"
        @click="handleRefresh"
      >
        <ArrowPathIcon
          class="h-5 w-5 mr-2"
          :class="{ 'animate-spin': refreshing }"
        />
        {{ refreshing ? t("health.refreshing") : t("health.refresh") }}
      </button>
    </div>

    <!-- 狀態統計 -->
    <div class="grid grid-cols-1 gap-5 sm:grid-cols-4">
      <!-- 總體狀態 -->
      <div class="card">
        <div class="flex items-center">
          <div
            class="rounded-full p-3"
            :class="{
              'bg-green-100': healthStore.overallStatus === 'healthy',
              'bg-yellow-100': healthStore.overallStatus === 'degraded',
              'bg-red-100': healthStore.overallStatus === 'down',
              'bg-gray-100': healthStore.overallStatus === 'unknown',
            }"
          >
            <CheckCircleIcon
              v-if="healthStore.overallStatus === 'healthy'"
              class="h-6 w-6 text-green-600"
            />
            <ExclamationTriangleIcon
              v-else-if="healthStore.overallStatus === 'degraded'"
              class="h-6 w-6 text-yellow-600"
            />
            <XCircleIcon
              v-else
              class="h-6 w-6"
              :class="{
                'text-red-600': healthStore.overallStatus === 'down',
                'text-gray-600': healthStore.overallStatus === 'unknown',
              }"
            />
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-500">
              {{ t("health.overall") }}
            </p>
            <p class="text-lg font-semibold text-gray-900">
              {{ getHealthStatusLabel(healthStore.overallStatus) }}
            </p>
          </div>
        </div>
      </div>

      <!-- 正常 -->
      <div class="card">
        <div class="flex items-center">
          <div class="rounded-full bg-green-100 p-3">
            <CheckCircleIcon class="h-6 w-6 text-green-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-500">
              {{ t("health.status.healthy") }}
            </p>
            <p class="text-2xl font-semibold text-gray-900">
              {{ healthStore.healthyCount }}
            </p>
          </div>
        </div>
      </div>

      <!-- 降級 -->
      <div class="card">
        <div class="flex items-center">
          <div class="rounded-full bg-yellow-100 p-3">
            <ExclamationTriangleIcon class="h-6 w-6 text-yellow-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-500">
              {{ t("health.status.degraded") }}
            </p>
            <p class="text-2xl font-semibold text-gray-900">
              {{ healthStore.degradedCount }}
            </p>
          </div>
        </div>
      </div>

      <!-- 離線 -->
      <div class="card">
        <div class="flex items-center">
          <div class="rounded-full bg-red-100 p-3">
            <XCircleIcon class="h-6 w-6 text-red-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-500">
              {{ t("health.status.down") }}
            </p>
            <p class="text-2xl font-semibold text-gray-900">
              {{ healthStore.downCount }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 平均回應時間 -->
    <div class="card">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t("health.avgResponseTime") }}
          </h3>
          <p class="text-3xl font-bold text-gray-900 mt-2">
            {{ healthStore.averageResponseTime }}
            <span class="text-lg font-normal text-gray-500">ms</span>
          </p>
        </div>
        <div v-if="healthStore.lastUpdated" class="text-sm text-gray-500">
          {{ t("health.lastUpdated")
          }}{{ healthStore.lastUpdated.toLocaleTimeString() }}
        </div>
      </div>
    </div>

    <!-- 問題租戶列表 -->
    <div
      v-if="healthStore.downCount > 0 || healthStore.degradedCount > 0"
      class="card"
    >
      <h3 class="card-header text-red-600">
        {{ t("health.attention.title") }}
      </h3>
      <div class="space-y-3">
        <!-- 離線 -->
        <div
          v-for="check in healthStore.groupedByStatus.down"
          :key="check.id"
          class="flex items-center justify-between p-4 bg-red-50 rounded-lg"
        >
          <div class="flex items-center">
            <XCircleIcon class="h-6 w-6 text-red-500" />
            <div class="ml-3">
              <p class="font-medium text-gray-900">
                {{ getTenantName(check.tenantId) }}
              </p>
              <p class="text-sm text-gray-500">
                {{ t("health.attention.serviceDown") }}
              </p>
            </div>
          </div>
          <RouterLink
            :to="`/tenants/${check.tenantId}`"
            class="btn btn-sm btn-secondary"
          >
            {{ t("common.viewDetails") }}
          </RouterLink>
        </div>

        <!-- 降級 -->
        <div
          v-for="check in healthStore.groupedByStatus.degraded"
          :key="check.id"
          class="flex items-center justify-between p-4 bg-yellow-50 rounded-lg"
        >
          <div class="flex items-center">
            <ExclamationTriangleIcon class="h-6 w-6 text-yellow-500" />
            <div class="ml-3">
              <p class="font-medium text-gray-900">
                {{ getTenantName(check.tenantId) }}
              </p>
              <p class="text-sm text-gray-500">
                {{ t("health.attention.serviceDegraded") }}
                <span v-if="check.responseTimeMs" class="ml-2">
                  ({{ check.responseTimeMs }}ms)
                </span>
              </p>
            </div>
          </div>
          <RouterLink
            :to="`/tenants/${check.tenantId}`"
            class="btn btn-sm btn-secondary"
          >
            {{ t("common.viewDetails") }}
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- 所有租戶健康狀態 -->
    <div class="card">
      <h3 class="card-header">{{ t("health.all.title") }}</h3>
      <div v-if="healthStore.loading" class="text-center py-8">
        <div class="loading-spinner mx-auto" />
        <p class="mt-2 text-sm text-gray-500">{{ t("common.loading") }}</p>
      </div>

      <div
        v-else-if="healthStore.healthChecks.length === 0"
        class="text-center py-8"
      >
        <p class="text-sm text-gray-500">{{ t("health.all.empty") }}</p>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t("health.column.tenant") }}</th>
              <th>{{ t("health.column.status") }}</th>
              <th>{{ t("health.column.responseTime") }}</th>
              <th>{{ t("health.column.api") }}</th>
              <th>{{ t("health.column.database") }}</th>
              <th>{{ t("health.column.cache") }}</th>
              <th>{{ t("health.column.storage") }}</th>
              <th>{{ t("health.column.checkedAt") }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            <tr v-for="check in healthStore.healthChecks" :key="check.id">
              <td>
                <RouterLink
                  :to="`/tenants/${check.tenantId}`"
                  class="font-medium text-primary-600 hover:text-primary-700"
                >
                  {{ getTenantName(check.tenantId) }}
                </RouterLink>
              </td>
              <td>
                <span
                  class="badge"
                  :class="{
                    'badge-success': check.status === 'healthy',
                    'badge-warning': check.status === 'degraded',
                    'badge-danger': check.status === 'down',
                    'badge-gray': check.status === 'unknown',
                  }"
                >
                  {{ getHealthStatusLabel(check.status) }}
                </span>
              </td>
              <td>
                {{ check.responseTimeMs ? `${check.responseTimeMs}ms` : "-" }}
              </td>
              <td>
                <span
                  v-if="check.details?.api"
                  class="badge"
                  :class="{
                    'badge-success': check.details.api === 'healthy',
                    'badge-warning': check.details.api === 'degraded',
                    'badge-danger': check.details.api === 'down',
                  }"
                >
                  {{ getHealthStatusLabel(check.details.api) }}
                </span>
                <span v-else class="text-gray-400">-</span>
              </td>
              <td>
                <span
                  v-if="check.details?.database"
                  class="badge"
                  :class="{
                    'badge-success': check.details.database === 'healthy',
                    'badge-warning': check.details.database === 'degraded',
                    'badge-danger': check.details.database === 'down',
                  }"
                >
                  {{ getHealthStatusLabel(check.details.database) }}
                </span>
                <span v-else class="text-gray-400">-</span>
              </td>
              <td>
                <span
                  v-if="check.details?.cache"
                  class="badge"
                  :class="{
                    'badge-success': check.details.cache === 'healthy',
                    'badge-warning': check.details.cache === 'degraded',
                    'badge-danger': check.details.cache === 'down',
                  }"
                >
                  {{ getHealthStatusLabel(check.details.cache) }}
                </span>
                <span v-else class="text-gray-400">-</span>
              </td>
              <td>
                <span
                  v-if="check.details?.storage"
                  class="badge"
                  :class="{
                    'badge-success': check.details.storage === 'healthy',
                    'badge-warning': check.details.storage === 'degraded',
                    'badge-danger': check.details.storage === 'down',
                  }"
                >
                  {{ getHealthStatusLabel(check.details.storage) }}
                </span>
                <span v-else class="text-gray-400">-</span>
              </td>
              <td class="text-gray-500">
                {{ new Date(check.checkedAt).toLocaleString() }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
