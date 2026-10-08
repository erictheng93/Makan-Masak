<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTenantsStore } from "@/stores/tenants";
import { useToast } from "vue-toastification";
import {
  ArrowLeftIcon,
  CloudIcon,
  ServerStackIcon,
  HeartIcon,
  KeyIcon,
  PlayIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from "@heroicons/vue/24/outline";
import type {
  TenantStatus,
  ResourceType,
  DeploymentStatus,
  HealthStatus,
} from "@/types";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const tenantsStore = useTenantsStore();
const toast = useToast();

const tenantId = computed(() => route.params.id as string);
const activeTab = ref<
  "overview" | "resources" | "deployments" | "health" | "license"
>("overview");

// 載入資料
onMounted(async () => {
  try {
    await Promise.all([
      tenantsStore.fetchTenant(tenantId.value),
      tenantsStore.fetchTenantResources(tenantId.value),
      tenantsStore.fetchTenantDeployments(tenantId.value),
      tenantsStore.fetchTenantHealthChecks(tenantId.value),
      tenantsStore.fetchTenantLicenses(tenantId.value),
    ]);
  } catch (e) {
    toast.error(t("tenantDetail.toast.loadFailed"));
    router.push("/tenants");
  }
});

// 便捷存取
const tenant = computed(() => tenantsStore.currentTenant);
const resources = computed(() => tenantsStore.currentResources);
const deployments = computed(() => tenantsStore.currentDeployments);
const healthChecks = computed(() => tenantsStore.currentHealthChecks);
const licenses = computed(() => tenantsStore.currentLicenses);

// 狀態標籤
const getStatusLabel = (status: TenantStatus) => {
  const key = `tenants.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
};

const getStatusClass = (status: TenantStatus) => {
  const classes: Record<TenantStatus, string> = {
    pending: "badge-warning",
    provisioning: "badge-info",
    active: "badge-success",
    suspended: "badge-danger",
    terminated: "badge-gray",
  };
  return classes[status] || "badge-gray";
};

// 資源類型標籤
const getResourceTypeLabel = (type: ResourceType) => {
  const key = `tenantDetail.resource.type.${type}`;
  const label = t(key);
  return label === key ? type : label;
};

// 部署狀態標籤
const getDeploymentStatusLabel = (status: DeploymentStatus) => {
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

const getDeploymentStatusClass = (status: DeploymentStatus) => {
  const classes: Record<DeploymentStatus, string> = {
    pending: "badge-warning",
    in_progress: "badge-info",
    completed: "badge-success",
    failed: "badge-danger",
    rolled_back: "badge-gray",
  };
  return classes[status] || "badge-gray";
};

// 健康狀態標籤
const getHealthStatusLabel = (status: HealthStatus) => {
  if (status === "unknown") return t("common.unknown");
  const key = `health.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
};

const getHealthStatusClass = (status: HealthStatus) => {
  const classes: Record<HealthStatus, string> = {
    healthy: "badge-success",
    degraded: "badge-warning",
    down: "badge-danger",
    unknown: "badge-gray",
  };
  return classes[status] || "badge-gray";
};

// 配置資源
const provisioning = ref(false);
const handleProvision = async () => {
  provisioning.value = true;
  try {
    await tenantsStore.provisionTenant(tenantId.value);
    toast.success(t("tenantDetail.toast.provisionSuccess"));
    await tenantsStore.fetchTenant(tenantId.value);
  } catch (e) {
    toast.error(t("tenantDetail.toast.provisionFailed"));
  } finally {
    provisioning.value = false;
  }
};

// 部署
const deploying = ref(false);
const handleDeploy = async () => {
  deploying.value = true;
  try {
    await tenantsStore.deployTenant(tenantId.value);
    toast.success(t("tenantDetail.toast.deployStarted"));
    await tenantsStore.fetchTenant(tenantId.value);
  } catch (e) {
    toast.error(t("tenantDetail.toast.deployFailed"));
  } finally {
    deploying.value = false;
  }
};

// 標籤頁
const tabs = computed(() => [
  {
    id: "overview",
    name: t("tenantDetail.tabs.overview"),
    icon: ServerStackIcon,
  },
  { id: "resources", name: t("tenantDetail.tabs.resources"), icon: CloudIcon },
  {
    id: "deployments",
    name: t("tenantDetail.tabs.deployments"),
    icon: PlayIcon,
  },
  { id: "health", name: t("tenantDetail.tabs.health"), icon: HeartIcon },
  { id: "license", name: t("tenantDetail.tabs.license"), icon: KeyIcon },
]);
</script>

<template>
  <div class="space-y-6" data-testid="management-tenant-detail-page">
    <!-- 返回按鈕 -->
    <button
      type="button"
      class="flex items-center text-gray-500 hover:text-gray-700"
      @click="router.push('/tenants')"
    >
      <ArrowLeftIcon class="h-5 w-5 mr-2" />
      {{ t("tenantDetail.backToList") }}
    </button>

    <!-- 載入中 -->
    <div v-if="tenantsStore.loading && !tenant" class="text-center py-12">
      <div class="loading-spinner mx-auto" />
      <p class="mt-2 text-sm text-gray-500">{{ t("common.loading") }}</p>
    </div>

    <!-- 租戶資訊 -->
    <template v-else-if="tenant">
      <!-- 標題區域 -->
      <div class="card">
        <div
          class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div class="flex items-center">
            <div
              class="flex-shrink-0 h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center"
            >
              <span class="text-2xl font-bold text-primary-700">
                {{ tenant.businessName.charAt(0) }}
              </span>
            </div>
            <div class="ml-4">
              <h1 class="text-2xl font-bold text-gray-900">
                {{ tenant.businessName }}
              </h1>
              <div class="flex items-center gap-3 mt-1">
                <span class="badge" :class="getStatusClass(tenant.status)">
                  {{ getStatusLabel(tenant.status) }}
                </span>
                <span v-if="tenant.subdomain" class="text-sm text-gray-500">
                  {{ tenant.subdomain }}.makanmasak.com
                </span>
              </div>
            </div>
          </div>

          <!-- 操作按鈕 -->
          <div class="flex gap-3">
            <button
              v-if="tenant.status === 'pending'"
              type="button"
              class="btn btn-primary"
              :disabled="provisioning"
              @click="handleProvision"
            >
              <CloudIcon class="h-5 w-5 mr-2" />
              {{
                provisioning
                  ? t("tenantDetail.provisioning")
                  : t("tenantDetail.provisionResources")
              }}
            </button>
            <button
              v-if="tenant.status === 'active' || resources.length > 0"
              type="button"
              class="btn btn-secondary"
              :disabled="deploying"
              @click="handleDeploy"
            >
              <ArrowPathIcon class="h-5 w-5 mr-2" />
              {{
                deploying
                  ? t("tenantDetail.deploying")
                  : t("tenantDetail.redeploy")
              }}
            </button>
          </div>
        </div>
      </div>

      <!-- 標籤頁 -->
      <div class="border-b border-gray-200">
        <nav class="flex space-x-8">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            :data-testid="`management-tenant-tab-${tab.id}`"
            class="flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors"
            :class="{
              'border-primary-500 text-primary-600': activeTab === tab.id,
              'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300':
                activeTab !== tab.id,
            }"
            @click="activeTab = tab.id as typeof activeTab"
          >
            <component :is="tab.icon" class="h-5 w-5 mr-2" />
            {{ tab.name }}
          </button>
        </nav>
      </div>

      <!-- 概覽標籤 -->
      <div
        v-if="activeTab === 'overview'"
        data-testid="management-tenant-overview"
        class="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        <!-- 基本資訊 -->
        <div class="card">
          <h3 class="card-header">{{ t("tenantDetail.basicInfo.title") }}</h3>
          <dl class="space-y-4">
            <div class="flex justify-between">
              <dt class="text-sm text-gray-500">
                {{ t("tenantDetail.basicInfo.businessName") }}
              </dt>
              <dd class="text-sm font-medium text-gray-900">
                {{ tenant.businessName }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-sm text-gray-500">
                {{ t("tenantDetail.basicInfo.contactEmail") }}
              </dt>
              <dd class="text-sm font-medium text-gray-900">
                {{ tenant.contactEmail }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-sm text-gray-500">
                {{ t("tenantDetail.basicInfo.contactPhone") }}
              </dt>
              <dd class="text-sm font-medium text-gray-900">
                {{ tenant.contactPhone || "-" }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-sm text-gray-500">
                {{ t("tenantDetail.basicInfo.subdomain") }}
              </dt>
              <dd class="text-sm font-medium text-gray-900">
                {{
                  tenant.subdomain ? `${tenant.subdomain}.makanmasak.com` : "-"
                }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-sm text-gray-500">
                {{ t("tenantDetail.basicInfo.customDomain") }}
              </dt>
              <dd class="text-sm font-medium text-gray-900">
                {{ tenant.customDomain || "-" }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-sm text-gray-500">
                {{ t("tenantDetail.basicInfo.createdAt") }}
              </dt>
              <dd class="text-sm font-medium text-gray-900">
                {{ new Date(tenant.createdAt).toLocaleString() }}
              </dd>
            </div>
          </dl>
        </div>

        <!-- 部署資訊 -->
        <div class="card">
          <h3 class="card-header">{{ t("tenantDetail.deployInfo.title") }}</h3>
          <dl class="space-y-4">
            <div class="flex justify-between">
              <dt class="text-sm text-gray-500">
                {{ t("tenantDetail.deployInfo.currentVersion") }}
              </dt>
              <dd class="text-sm font-medium text-gray-900">
                {{
                  tenant.deployedVersion
                    ? `v${tenant.deployedVersion}`
                    : t("tenantDetail.deployInfo.notDeployed")
                }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-sm text-gray-500">
                {{ t("tenantDetail.deployInfo.resourceCount") }}
              </dt>
              <dd class="text-sm font-medium text-gray-900">
                {{ resources.length }}
                {{ t("tenantDetail.deployInfo.itemSuffix") }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-sm text-gray-500">
                {{ t("tenantDetail.deployInfo.lastDeploy") }}
              </dt>
              <dd class="text-sm font-medium text-gray-900">
                {{
                  deployments[0]
                    ? new Date(deployments[0].startedAt).toLocaleString()
                    : "-"
                }}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <!-- 資源標籤 -->
      <div
        v-else-if="activeTab === 'resources'"
        class="card"
        data-testid="management-tenant-resources"
      >
        <h3 class="card-header">{{ t("tenantDetail.resources.title") }}</h3>
        <div v-if="resources.length === 0" class="text-center py-8">
          <CloudIcon class="mx-auto h-12 w-12 text-gray-400" />
          <p class="mt-2 text-sm text-gray-500">
            {{ t("tenantDetail.resources.empty") }}
          </p>
        </div>
        <div v-else class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t("tenantDetail.resources.column.type") }}</th>
                <th>{{ t("tenantDetail.resources.column.name") }}</th>
                <th>{{ t("tenantDetail.resources.column.id") }}</th>
                <th>{{ t("tenantDetail.resources.column.status") }}</th>
                <th>{{ t("tenantDetail.resources.column.createdAt") }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr v-for="resource in resources" :key="resource.id">
                <td>{{ getResourceTypeLabel(resource.resourceType) }}</td>
                <td class="font-mono text-sm">{{ resource.resourceName }}</td>
                <td class="font-mono text-sm">
                  {{ resource.resourceId || "-" }}
                </td>
                <td>
                  <span
                    class="badge"
                    :class="{
                      'badge-success': resource.status === 'provisioned',
                      'badge-warning': resource.status === 'pending',
                      'badge-danger': resource.status === 'failed',
                    }"
                  >
                    {{
                      resource.status === "provisioned"
                        ? t("tenantDetail.resources.status.provisioned")
                        : resource.status === "pending"
                          ? t("tenantDetail.resources.status.pending")
                          : t("tenantDetail.resources.status.failed")
                    }}
                  </span>
                </td>
                <td>{{ new Date(resource.createdAt).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 部署標籤 -->
      <div
        v-else-if="activeTab === 'deployments'"
        class="card"
        data-testid="management-tenant-deployments"
      >
        <h3 class="card-header">{{ t("tenantDetail.deployments.title") }}</h3>
        <div v-if="deployments.length === 0" class="text-center py-8">
          <PlayIcon class="mx-auto h-12 w-12 text-gray-400" />
          <p class="mt-2 text-sm text-gray-500">
            {{ t("tenantDetail.deployments.empty") }}
          </p>
        </div>
        <div v-else class="space-y-4">
          <div
            v-for="deployment in deployments"
            :key="deployment.id"
            class="border rounded-lg p-4"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <CheckCircleIcon
                  v-if="deployment.status === 'completed'"
                  class="h-6 w-6 text-green-500"
                />
                <ExclamationTriangleIcon
                  v-else-if="deployment.status === 'failed'"
                  class="h-6 w-6 text-red-500"
                />
                <ArrowPathIcon
                  v-else
                  class="h-6 w-6 text-blue-500 animate-spin"
                />
                <div>
                  <p class="font-medium text-gray-900">
                    {{
                      deployment.deploymentType === "initial"
                        ? t("tenantDetail.deployments.type.initial")
                        : deployment.deploymentType === "update"
                          ? t("tenantDetail.deployments.type.update")
                          : t("tenantDetail.deployments.type.rollback")
                    }}
                  </p>
                  <p class="text-sm text-gray-500">
                    {{
                      deployment.fromVersion
                        ? `v${deployment.fromVersion} → `
                        : ""
                    }}v{{ deployment.toVersion }}
                  </p>
                </div>
              </div>
              <div class="text-right">
                <span
                  class="badge"
                  :class="getDeploymentStatusClass(deployment.status)"
                >
                  {{ getDeploymentStatusLabel(deployment.status) }}
                </span>
                <p class="text-sm text-gray-500 mt-1">
                  {{ new Date(deployment.startedAt).toLocaleString() }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 健康標籤 -->
      <div
        v-else-if="activeTab === 'health'"
        class="card"
        data-testid="management-tenant-health"
      >
        <h3 class="card-header">{{ t("tenantDetail.health.title") }}</h3>
        <div v-if="healthChecks.length === 0" class="text-center py-8">
          <HeartIcon class="mx-auto h-12 w-12 text-gray-400" />
          <p class="mt-2 text-sm text-gray-500">
            {{ t("tenantDetail.health.empty") }}
          </p>
        </div>
        <div v-else class="space-y-4">
          <div
            v-for="check in healthChecks.slice(0, 10)"
            :key="check.id"
            class="border rounded-lg p-4"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <span class="badge" :class="getHealthStatusClass(check.status)">
                  {{ getHealthStatusLabel(check.status) }}
                </span>
                <span v-if="check.responseTimeMs" class="text-sm text-gray-500">
                  {{ check.responseTimeMs }}ms
                </span>
              </div>
              <span class="text-sm text-gray-500">
                {{ new Date(check.checkedAt).toLocaleString() }}
              </span>
            </div>
            <div
              v-if="check.details"
              class="mt-3 grid grid-cols-4 gap-4 text-sm"
            >
              <div
                v-for="(status, key) in check.details"
                :key="key"
                class="text-center"
              >
                <div class="text-gray-500 capitalize">{{ key }}</div>
                <span
                  class="badge"
                  :class="getHealthStatusClass(status as HealthStatus)"
                >
                  {{ getHealthStatusLabel(status as HealthStatus) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 授權標籤 -->
      <div
        v-else-if="activeTab === 'license'"
        class="card"
        data-testid="management-tenant-license"
      >
        <h3 class="card-header">{{ t("tenantDetail.license.title") }}</h3>
        <div v-if="licenses.length === 0" class="text-center py-8">
          <KeyIcon class="mx-auto h-12 w-12 text-gray-400" />
          <p class="mt-2 text-sm text-gray-500">
            {{ t("tenantDetail.license.empty") }}
          </p>
        </div>
        <div v-else class="space-y-4">
          <div
            v-for="license in licenses"
            :key="license.id"
            class="border rounded-lg p-4"
          >
            <div class="flex items-center justify-between">
              <div>
                <p class="font-mono text-lg font-medium text-gray-900">
                  {{ license.licenseKey }}
                </p>
                <div class="flex items-center gap-3 mt-2">
                  <span class="badge badge-info">
                    {{
                      license.tier === "standard"
                        ? t("licenses.tier.standard")
                        : license.tier === "professional"
                          ? t("licenses.tier.professional")
                          : t("licenses.tier.enterprise")
                    }}
                  </span>
                  <span v-if="license.expiresAt" class="text-sm text-gray-500">
                    {{ t("licenses.validUntil") }}
                    {{ new Date(license.expiresAt).toLocaleDateString() }}
                  </span>
                  <span v-else class="text-sm text-gray-500">
                    {{ t("licenses.permanentValid") }}
                  </span>
                </div>
              </div>
              <div v-if="license.revokedAt" class="text-right">
                <span class="badge badge-danger">{{
                  t("licenses.revoked")
                }}</span>
                <p class="text-sm text-gray-500 mt-1">
                  {{ license.revokeReason }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
