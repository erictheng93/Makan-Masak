/**
 * Tenants Store
 * 租戶狀態管理
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  tenantsApi,
  deploymentsApi,
  healthApi,
  licensesApi,
} from "@/services/api";
import type {
  Tenant,
  TenantResource,
  DeploymentLog,
  DeploymentType,
  HealthCheck,
  License,
  CreateTenantRequest,
  UpdateTenantRequest,
  TenantStatus,
} from "@/types";

type TenantHealthSummaryPayload = {
  recentChecks?: Array<{
    id?: string;
    tenantId?: string;
    status?: HealthCheck["status"];
    responseTimeMs?: number | null;
    checkedAt?: string;
    details?: HealthCheck["details"];
  }>;
};

type TenantLicenseSummaryPayload = {
  id?: string;
  tenantId?: string;
  licenseKey?: string;
  tier?: License["tier"];
  expiresAt?: string;
  revokedAt?: string;
  revokeReason?: string;
  createdAt?: string;
};

function normalizeTenantHealthChecks(
  tenantId: string,
  payload: HealthCheck[] | TenantHealthSummaryPayload,
): HealthCheck[] {
  if (Array.isArray(payload)) return payload;

  return (payload.recentChecks ?? [])
    .filter((check) => check.status && check.checkedAt)
    .map((check, index) => ({
      id: check.id ?? `${tenantId}-health-${index}`,
      tenantId: check.tenantId ?? tenantId,
      status: check.status!,
      responseTimeMs: check.responseTimeMs ?? undefined,
      checkedAt: check.checkedAt!,
      details: check.details,
    }));
}

function normalizeTenantLicenses(
  tenantId: string,
  payload: License[] | TenantLicenseSummaryPayload,
): License[] {
  if (Array.isArray(payload)) return payload;
  if (!payload.licenseKey || !payload.tier) return [];

  return [
    {
      id: payload.id ?? `${tenantId}-license`,
      tenantId: payload.tenantId ?? tenantId,
      licenseKey: payload.licenseKey,
      tier: payload.tier,
      expiresAt: payload.expiresAt,
      revokedAt: payload.revokedAt,
      revokeReason: payload.revokeReason,
      createdAt:
        payload.createdAt ?? payload.expiresAt ?? new Date(0).toISOString(),
    },
  ];
}

export const useTenantsStore = defineStore("tenants", () => {
  // 狀態
  const tenants = ref<Tenant[]>([]);
  const currentTenant = ref<Tenant | null>(null);
  const currentResources = ref<TenantResource[]>([]);
  const currentDeployments = ref<DeploymentLog[]>([]);
  const currentHealthChecks = ref<HealthCheck[]>([]);
  const currentLicenses = ref<License[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // 計算屬性
  const activeTenants = computed(() =>
    tenants.value.filter((t) => t.status === "active"),
  );

  const pendingTenants = computed(() =>
    tenants.value.filter(
      (t) => t.status === "pending" || t.status === "provisioning",
    ),
  );

  const totalTenants = computed(() => tenants.value.length);

  const statusCounts = computed(() => {
    const counts: Record<TenantStatus, number> = {
      pending: 0,
      provisioning: 0,
      active: 0,
      suspended: 0,
      terminated: 0,
    };
    tenants.value.forEach((t) => {
      counts[t.status]++;
    });
    return counts;
  });

  // 方法
  async function fetchTenants() {
    loading.value = true;
    error.value = null;
    try {
      const response = await tenantsApi.list();
      tenants.value = response.data;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "獲取租戶列表失敗";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function fetchTenant(id: string) {
    loading.value = true;
    error.value = null;
    try {
      currentTenant.value = await tenantsApi.get(id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : "獲取租戶詳情失敗";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function createTenant(data: CreateTenantRequest) {
    loading.value = true;
    error.value = null;
    try {
      const tenant = await tenantsApi.create(data);
      tenants.value.push(tenant);
      return tenant;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "創建租戶失敗";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function updateTenant(id: string, data: UpdateTenantRequest) {
    loading.value = true;
    error.value = null;
    try {
      const tenant = await tenantsApi.update(id, data);
      const index = tenants.value.findIndex((t) => t.id === id);
      if (index !== -1) {
        tenants.value[index] = tenant;
      }
      if (currentTenant.value?.id === id) {
        currentTenant.value = tenant;
      }
      return tenant;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "更新租戶失敗";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function deleteTenant(id: string) {
    loading.value = true;
    error.value = null;
    try {
      await tenantsApi.delete(id);
      tenants.value = tenants.value.filter((t) => t.id !== id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : "刪除租戶失敗";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function fetchTenantResources(id: string) {
    try {
      currentResources.value = await tenantsApi.getResources(id);
    } catch (e) {
      console.error("獲取資源失敗:", e);
      throw e;
    }
  }

  async function fetchTenantDeployments(id: string) {
    try {
      currentDeployments.value = await deploymentsApi.getHistory(id);
    } catch (e) {
      console.error("獲取部署歷史失敗:", e);
      throw e;
    }
  }

  async function fetchTenantHealthChecks(id: string) {
    try {
      currentHealthChecks.value = normalizeTenantHealthChecks(
        id,
        await healthApi.getTenantStatus(id),
      );
    } catch (e) {
      console.error("獲取健康狀態失敗:", e);
      throw e;
    }
  }

  async function fetchTenantLicenses(id: string) {
    try {
      currentLicenses.value = normalizeTenantLicenses(
        id,
        await licensesApi.getTenantLicense(id),
      );
    } catch (e) {
      console.error("獲取授權失敗:", e);
      throw e;
    }
  }

  async function provisionTenant(id: string) {
    loading.value = true;
    try {
      const resources = await deploymentsApi.provision(id);
      currentResources.value = resources;
      return resources;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "配置資源失敗";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function deployTenant(
    id: string,
    targetVersion: string,
    deploymentType?: DeploymentType,
  ) {
    loading.value = true;
    try {
      const deployment = await deploymentsApi.deploy({
        tenantId: id,
        targetVersion,
        deploymentType,
      });
      currentDeployments.value.unshift(deployment);
      return deployment;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "部署失敗";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function clearCurrentTenant() {
    currentTenant.value = null;
    currentResources.value = [];
    currentDeployments.value = [];
    currentHealthChecks.value = [];
    currentLicenses.value = [];
  }

  return {
    // 狀態
    tenants,
    currentTenant,
    currentResources,
    currentDeployments,
    currentHealthChecks,
    currentLicenses,
    loading,
    error,

    // 計算屬性
    activeTenants,
    pendingTenants,
    totalTenants,
    statusCounts,

    // 方法
    fetchTenants,
    fetchTenant,
    createTenant,
    updateTenant,
    deleteTenant,
    fetchTenantResources,
    fetchTenantDeployments,
    fetchTenantHealthChecks,
    fetchTenantLicenses,
    provisionTenant,
    deployTenant,
    clearCurrentTenant,
  };
});
