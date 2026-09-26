<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useTenantsStore } from "@/stores/tenants";
import { RouterLink } from "vue-router";
import { useToast } from "vue-toastification";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  BuildingStorefrontIcon,
} from "@heroicons/vue/24/outline";
import CreateTenantModal from "@/components/tenants/CreateTenantModal.vue";
import type { TenantStatus } from "@/types";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const tenantsStore = useTenantsStore();
const toast = useToast();

// 狀態
const showCreateModal = ref(false);
const searchQuery = ref("");
const statusFilter = ref<TenantStatus | "all">("all");

// 載入資料
onMounted(async () => {
  await tenantsStore.fetchTenants();
});

// 過濾後的租戶列表
const filteredTenants = computed(() => {
  let result = tenantsStore.tenants;

  // 搜索過濾
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(
      (t) =>
        t.businessName.toLowerCase().includes(query) ||
        t.contactEmail.toLowerCase().includes(query) ||
        t.subdomain?.toLowerCase().includes(query),
    );
  }

  // 狀態過濾
  if (statusFilter.value !== "all") {
    result = result.filter((t) => t.status === statusFilter.value);
  }

  return result;
});

// 狀態選項
const statusOptions = computed(() => [
  { value: "all", label: t("tenants.filter.allStatuses") },
  { value: "active", label: t("tenants.status.active") },
  { value: "pending", label: t("tenants.status.pending") },
  { value: "provisioning", label: t("tenants.status.provisioning") },
  { value: "suspended", label: t("tenants.status.suspended") },
  { value: "terminated", label: t("tenants.status.terminated") },
]);

// 處理創建成功
const handleCreateSuccess = () => {
  showCreateModal.value = false;
  toast.success(t("tenants.toast.createSuccess"));
};

// 獲取狀態標籤
const getStatusLabel = (status: TenantStatus) => {
  const key = `tenants.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
};

// 獲取狀態樣式
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
</script>

<template>
  <div class="space-y-6" data-testid="management-tenants-page">
    <!-- 頁面標題 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">
          {{ t("tenants.title") }}
        </h1>
        <p class="mt-1 text-sm text-gray-500">{{ t("tenants.subtitle") }}</p>
      </div>
      <button
        type="button"
        data-testid="management-tenant-create-open"
        class="btn btn-primary"
        @click="showCreateModal = true"
      >
        <PlusIcon class="h-5 w-5 mr-2" />
        {{ t("tenants.create") }}
      </button>
    </div>

    <!-- 過濾器 -->
    <div class="card">
      <div class="flex flex-col sm:flex-row gap-4">
        <!-- 搜索 -->
        <div class="flex-1">
          <div class="relative">
            <MagnifyingGlassIcon
              class="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400"
            />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('tenants.filter.searchPlaceholder')"
              class="input pl-10"
            />
          </div>
        </div>

        <!-- 狀態過濾 -->
        <div class="flex items-center gap-2">
          <FunnelIcon class="h-5 w-5 text-gray-400" />
          <select v-model="statusFilter" class="input w-40">
            <option
              v-for="option in statusOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <!-- 租戶列表 -->
    <div class="card p-0 overflow-hidden">
      <div v-if="tenantsStore.loading" class="text-center py-12">
        <div class="loading-spinner mx-auto" />
        <p class="mt-2 text-sm text-gray-500">{{ t("common.loading") }}</p>
      </div>

      <div v-else-if="filteredTenants.length === 0" class="text-center py-12">
        <BuildingStorefrontIcon class="mx-auto h-12 w-12 text-gray-400" />
        <h3 class="mt-2 text-sm font-medium text-gray-900">
          {{
            searchQuery || statusFilter !== "all"
              ? t("tenants.empty.noResults")
              : t("tenants.empty.none")
          }}
        </h3>
        <p class="mt-1 text-sm text-gray-500">
          {{
            searchQuery || statusFilter !== "all"
              ? t("tenants.empty.tryAdjust")
              : t("tenants.empty.createFirst")
          }}
        </p>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t("tenants.column.businessName") }}</th>
              <th>{{ t("tenants.column.contactEmail") }}</th>
              <th>{{ t("tenants.column.subdomain") }}</th>
              <th>{{ t("tenants.column.status") }}</th>
              <th>{{ t("tenants.column.deployedVersion") }}</th>
              <th>{{ t("tenants.column.createdAt") }}</th>
              <th class="text-right">{{ t("common.actions") }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 bg-white">
            <tr
              v-for="tenant in filteredTenants"
              :key="tenant.id"
              data-testid="management-tenant-row"
              :data-tenant-id="tenant.id"
            >
              <td>
                <div class="flex items-center">
                  <div
                    class="flex-shrink-0 h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center"
                  >
                    <span class="text-primary-700 font-medium">
                      {{ tenant.businessName.charAt(0) }}
                    </span>
                  </div>
                  <div class="ml-4">
                    <div class="font-medium text-gray-900">
                      {{ tenant.businessName }}
                    </div>
                    <div
                      v-if="tenant.customDomain"
                      class="text-sm text-gray-500"
                    >
                      {{ tenant.customDomain }}
                    </div>
                  </div>
                </div>
              </td>
              <td>{{ tenant.contactEmail }}</td>
              <td>
                <code
                  v-if="tenant.subdomain"
                  class="text-sm bg-gray-100 px-2 py-1 rounded"
                >
                  {{ tenant.subdomain }}.makanmasak.com
                </code>
                <span v-else class="text-gray-400">-</span>
              </td>
              <td>
                <span class="badge" :class="getStatusClass(tenant.status)">
                  {{ getStatusLabel(tenant.status) }}
                </span>
              </td>
              <td>
                <code v-if="tenant.deployedVersion" class="text-sm">
                  v{{ tenant.deployedVersion }}
                </code>
                <span v-else class="text-gray-400">-</span>
              </td>
              <td class="text-gray-500">
                {{ new Date(tenant.createdAt).toLocaleDateString() }}
              </td>
              <td class="text-right">
                <RouterLink
                  :to="`/tenants/${tenant.id}`"
                  class="text-primary-600 hover:text-primary-700 font-medium"
                >
                  {{ t("common.manage") }}
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 創建租戶 Modal -->
    <CreateTenantModal
      :show="showCreateModal"
      @close="showCreateModal = false"
      @success="handleCreateSuccess"
    />
  </div>
</template>
