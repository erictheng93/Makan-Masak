<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useTenantsStore } from "@/stores/tenants";
import { deploymentsApi, isSemver } from "@/services/api";
import { useToast } from "vue-toastification";
import { RouterLink } from "vue-router";
import {
  RocketLaunchIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from "@heroicons/vue/24/outline";
import type { DeploymentLog, DeploymentStatus } from "@/types";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const tenantsStore = useTenantsStore();
const toast = useToast();

// 狀態
const selectedTenants = ref<string[]>([]);
const targetVersion = ref("");
const deploying = ref(false);
const recentDeployments = ref<(DeploymentLog & { tenantName?: string })[]>([]);

// 載入資料
onMounted(async () => {
  await tenantsStore.fetchTenants();
  // 載入所有租戶的最近部署
  await loadRecentDeployments();
});

// 載入最近部署
const loadRecentDeployments = async () => {
  const deployments: (DeploymentLog & { tenantName?: string })[] = [];
  for (const tenant of tenantsStore.activeTenants.slice(0, 10)) {
    try {
      const history = await deploymentsApi.getHistory(tenant.id);
      if (history.length > 0) {
        deployments.push({
          ...history[0],
          tenantName: tenant.businessName,
        });
      }
    } catch {
      // 忽略錯誤
    }
  }
  recentDeployments.value = deployments.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
};

// 可部署的租戶
const deployableTenants = computed(() =>
  tenantsStore.tenants.filter((t) => t.status === "active"),
);

// 全選/取消全選
const allSelected = computed({
  get: () => selectedTenants.value.length === deployableTenants.value.length,
  set: (val) => {
    selectedTenants.value = val ? deployableTenants.value.map((t) => t.id) : [];
  },
});

// 批量部署
const handleBatchDeploy = async () => {
  if (selectedTenants.value.length === 0) {
    toast.warning(t("deployments.validation.selectTenant"));
    return;
  }
  const version = targetVersion.value.trim();
  if (!isSemver(version)) {
    toast.warning(t("deployments.validation.enterVersion"));
    return;
  }

  deploying.value = true;
  try {
    const result = await deploymentsApi.batchDeploy({
      tenantIds: selectedTenants.value,
      targetVersion: version,
    });
    toast.success(t("deployments.toast.queuedCount", { count: result.queued }));
    if (result.failed.length > 0) {
      toast.warning(
        t("deployments.toast.failedCount", { count: result.failed.length }),
      );
    }
    selectedTenants.value = [];
    await loadRecentDeployments();
  } catch (e) {
    toast.error(t("deployments.toast.batchFailed"));
  } finally {
    deploying.value = false;
  }
};

// 獲取狀態標籤
const getStatusLabel = (status: DeploymentStatus) => {
  const map: Record<DeploymentStatus, string> = {
    pending: "deployments.status.pending",
    in_progress: "deployments.status.inProgress",
    completed: "deployments.status.completed",
    failed: "deployments.status.failed",
    rolled_back: "deployments.status.rolledBack",
  };
  const key = map[status];
  if (!key) return status;
  const label = t(key);
  return label === key ? status : label;
};

const getStatusClass = (status: DeploymentStatus) => {
  const classes: Record<DeploymentStatus, string> = {
    pending: "badge-warning",
    in_progress: "badge-info",
    completed: "badge-success",
    failed: "badge-danger",
    rolled_back: "badge-gray",
  };
  return classes[status] || "badge-gray";
};

const getStatusIcon = (status: DeploymentStatus) => {
  switch (status) {
    case "completed":
      return CheckCircleIcon;
    case "failed":
      return ExclamationTriangleIcon;
    case "in_progress":
      return ArrowPathIcon;
    default:
      return ClockIcon;
  }
};
</script>

<template>
  <div class="space-y-6" data-testid="management-deployments-page">
    <!-- 頁面標題 -->
    <div>
      <h1 class="text-2xl font-bold text-gray-900">
        {{ t("deployments.title") }}
      </h1>
      <p class="mt-1 text-sm text-gray-500">{{ t("deployments.subtitle") }}</p>
    </div>

    <!-- 批量部署 -->
    <div class="card">
      <h3 class="card-header">{{ t("deployments.batch.title") }}</h3>
      <div class="space-y-4">
        <!-- 版本輸入 -->
        <div class="flex gap-4">
          <div class="flex-1">
            <label class="label">
              {{ t("deployments.batch.targetVersion") }}
            </label>
            <input
              v-model="targetVersion"
              type="text"
              class="input"
              :placeholder="t('deployments.batch.versionPlaceholder')"
            />
          </div>
          <div class="flex items-end">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="deploying || selectedTenants.length === 0"
              @click="handleBatchDeploy"
            >
              <RocketLaunchIcon class="h-5 w-5 mr-2" />
              {{
                deploying
                  ? t("deployments.batch.deploying")
                  : t("deployments.batch.deployWithCount", {
                      count: selectedTenants.length,
                    })
              }}
            </button>
          </div>
        </div>

        <!-- 租戶選擇 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="label mb-0">
              {{ t("deployments.batch.selectTenants") }}
            </label>
            <label class="flex items-center text-sm">
              <input
                v-model="allSelected"
                type="checkbox"
                class="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <span class="ml-2 text-gray-600">{{
                t("common.selectAll")
              }}</span>
            </label>
          </div>
          <div class="border rounded-lg max-h-64 overflow-y-auto">
            <div
              v-for="tenant in deployableTenants"
              :key="tenant.id"
              class="flex items-center p-3 border-b last:border-b-0 hover:bg-gray-50"
            >
              <input
                :id="tenant.id"
                v-model="selectedTenants"
                type="checkbox"
                :value="tenant.id"
                class="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label :for="tenant.id" class="ml-3 flex-1 cursor-pointer">
                <div class="font-medium text-gray-900">
                  {{ tenant.businessName }}
                </div>
                <div class="text-sm text-gray-500">
                  {{ t("deployments.batch.currentVersionLabel")
                  }}{{
                    tenant.deployedVersion || t("deployments.batch.notDeployed")
                  }}
                </div>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 最近部署 -->
    <div class="card">
      <h3 class="card-header">{{ t("deployments.recent.title") }}</h3>
      <div v-if="recentDeployments.length === 0" class="text-center py-8">
        <RocketLaunchIcon class="mx-auto h-12 w-12 text-gray-400" />
        <p class="mt-2 text-sm text-gray-500">
          {{ t("deployments.recent.empty") }}
        </p>
      </div>
      <div v-else class="space-y-4">
        <div
          v-for="deployment in recentDeployments"
          :key="deployment.id"
          class="flex items-center justify-between p-4 border rounded-lg"
        >
          <div class="flex items-center gap-4">
            <component
              :is="getStatusIcon(deployment.status)"
              class="h-6 w-6"
              :class="{
                'text-green-500': deployment.status === 'completed',
                'text-red-500': deployment.status === 'failed',
                'text-blue-500 animate-spin':
                  deployment.status === 'in_progress',
                'text-yellow-500': deployment.status === 'pending',
                'text-gray-500': deployment.status === 'rolled_back',
              }"
            />
            <div>
              <RouterLink
                :to="`/tenants/${deployment.tenantId}`"
                class="font-medium text-primary-600 hover:text-primary-700"
              >
                {{ deployment.tenantName }}
              </RouterLink>
              <div class="text-sm text-gray-500">
                {{
                  deployment.fromVersion ? `v${deployment.fromVersion} → ` : ""
                }}v{{ deployment.toVersion }}
              </div>
            </div>
          </div>
          <div class="text-right">
            <span class="badge" :class="getStatusClass(deployment.status)">
              {{ getStatusLabel(deployment.status) }}
            </span>
            <div class="text-sm text-gray-500 mt-1">
              {{ new Date(deployment.startedAt).toLocaleString() }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
