<script setup lang="ts">
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/vue";
import { ref, onMounted, computed } from "vue";
import { useTenantsStore } from "@/stores/tenants";
import { licensesApi } from "@/services/api";
import { useToast } from "vue-toastification";
import { RouterLink } from "vue-router";
import { KeyIcon, PlusIcon, ArrowUpIcon } from "@heroicons/vue/24/outline";
import type { License, LicenseTier, GenerateLicenseRequest } from "@/types";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const tenantsStore = useTenantsStore();
const toast = useToast();

// 狀態
const licenses = ref<(License & { tenantName?: string })[]>([]);
const loading = ref(false);
const showGenerateModal = ref(false);
const generating = ref(false);

// 生成表單
const generateForm = ref<GenerateLicenseRequest>({
  tenantId: "",
  tier: "standard",
  expiresAt: "",
});

const closeGenerateModal = () => {
  if (generating.value) return;
  const dirty =
    generateForm.value.tenantId ||
    generateForm.value.expiresAt ||
    generateForm.value.tier !== "standard";
  if (dirty && !window.confirm(t("licenses.confirmDiscard"))) return;
  showGenerateModal.value = false;
  generateForm.value = { tenantId: "", tier: "standard", expiresAt: "" };
};

// 載入資料
onMounted(async () => {
  await tenantsStore.fetchTenants();
  await loadAllLicenses();
});

// 載入所有授權
const loadAllLicenses = async () => {
  loading.value = true;
  const allLicenses: (License & { tenantName?: string })[] = [];
  for (const tenant of tenantsStore.tenants) {
    try {
      const tenantLicenses = await licensesApi.getTenantLicense(tenant.id);
      tenantLicenses.forEach((l) => {
        allLicenses.push({
          ...l,
          tenantName: tenant.businessName,
        });
      });
    } catch {
      // 忽略錯誤
    }
  }
  licenses.value = allLicenses.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  loading.value = false;
};

// 統計
const stats = computed(() => ({
  total: licenses.value.length,
  active: licenses.value.filter((l) => !l.revokedAt).length,
  standard: licenses.value.filter((l) => l.tier === "standard" && !l.revokedAt)
    .length,
  professional: licenses.value.filter(
    (l) => l.tier === "professional" && !l.revokedAt,
  ).length,
  enterprise: licenses.value.filter(
    (l) => l.tier === "enterprise" && !l.revokedAt,
  ).length,
}));

// 生成授權
const handleGenerate = async () => {
  if (generating.value) return;
  if (!generateForm.value.tenantId) {
    toast.warning(t("licenses.validation.selectTenant"));
    return;
  }

  generating.value = true;
  try {
    const license = await licensesApi.generate(generateForm.value);
    const tenant = tenantsStore.tenants.find(
      (tt) => tt.id === generateForm.value.tenantId,
    );
    licenses.value.unshift({
      ...license,
      tenantName: tenant?.businessName,
    });
    toast.success(t("licenses.toast.generateSuccess"));
    showGenerateModal.value = false;
    generateForm.value = { tenantId: "", tier: "standard", expiresAt: "" };
  } catch (e) {
    toast.error(t("licenses.toast.generateFailed"));
  } finally {
    generating.value = false;
  }
};

// 獲取等級標籤
const getTierLabel = (tier: LicenseTier) => {
  const key = `licenses.tier.${tier}`;
  const label = t(key);
  return label === key ? tier : label;
};

const getTierClass = (tier: LicenseTier) => {
  const classes: Record<LicenseTier, string> = {
    standard: "badge-info",
    professional: "badge-success",
    enterprise: "bg-teal-100 text-teal-800",
  };
  return classes[tier] || "badge-gray";
};
</script>

<template>
  <div
    class="portal-page ui-page space-y-6"
    data-testid="management-licenses-page"
  >
    <!-- 頁面標題 -->
    <div class="portal-heading ui-page-heading">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">
          {{ t("licenses.title") }}
        </h1>
        <p class="mt-1 text-sm text-gray-500">{{ t("licenses.subtitle") }}</p>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        @click="showGenerateModal = true"
      >
        <PlusIcon class="h-5 w-5 mr-2" />
        {{ t("licenses.generate") }}
      </button>
    </div>

    <!-- 統計卡片 -->
    <div class="ui-stat-strip">
      <div class="ui-stat">
        <div class="flex items-center">
          <div class="rounded-full bg-blue-100 p-3">
            <KeyIcon class="h-6 w-6 text-blue-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-500">
              {{ t("licenses.stats.active") }}
            </p>
            <p class="text-2xl font-semibold text-gray-900">
              {{ stats.active }}
            </p>
          </div>
        </div>
      </div>
      <div class="ui-stat">
        <div class="text-center">
          <p class="text-sm font-medium text-gray-500">
            {{ t("licenses.tier.standard") }}
          </p>
          <p class="text-2xl font-semibold text-blue-600">
            {{ stats.standard }}
          </p>
        </div>
      </div>
      <div class="ui-stat">
        <div class="text-center">
          <p class="text-sm font-medium text-gray-500">
            {{ t("licenses.tier.professional") }}
          </p>
          <p class="text-2xl font-semibold text-green-600">
            {{ stats.professional }}
          </p>
        </div>
      </div>
      <div class="ui-stat">
        <div class="text-center">
          <p class="text-sm font-medium text-gray-500">
            {{ t("licenses.tier.enterprise") }}
          </p>
          <p class="text-2xl font-semibold text-teal-600">
            {{ stats.enterprise }}
          </p>
        </div>
      </div>
    </div>

    <!-- 授權列表 -->
    <div class="card p-0 overflow-hidden">
      <div v-if="loading" class="text-center py-12">
        <div class="loading-spinner mx-auto" />
        <p class="mt-2 text-sm text-gray-500">{{ t("common.loading") }}</p>
      </div>

      <div v-else-if="licenses.length === 0" class="text-center py-12">
        <KeyIcon class="mx-auto h-12 w-12 text-gray-400" />
        <p class="mt-2 text-sm text-gray-500">{{ t("licenses.empty") }}</p>
      </div>

      <div v-else class="ui-table-scroll overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t("licenses.column.tenant") }}</th>
              <th>{{ t("licenses.column.licenseKey") }}</th>
              <th>{{ t("licenses.column.tier") }}</th>
              <th>{{ t("licenses.column.status") }}</th>
              <th>{{ t("licenses.column.validity") }}</th>
              <th>{{ t("licenses.column.createdAt") }}</th>
              <th class="text-right">{{ t("common.actions") }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 bg-white">
            <tr v-for="license in licenses" :key="license.id">
              <td>
                <RouterLink
                  :to="`/tenants/${license.tenantId}`"
                  class="font-medium text-primary-600 hover:text-primary-700"
                >
                  {{ license.tenantName }}
                </RouterLink>
              </td>
              <td class="font-mono text-sm">{{ license.licenseKey }}</td>
              <td>
                <span class="badge" :class="getTierClass(license.tier)">
                  {{ getTierLabel(license.tier) }}
                </span>
              </td>
              <td>
                <span
                  class="badge"
                  :class="license.revokedAt ? 'badge-danger' : 'badge-success'"
                >
                  {{
                    license.revokedAt
                      ? t("licenses.revoked")
                      : t("licenses.valid")
                  }}
                </span>
              </td>
              <td>
                {{
                  license.expiresAt
                    ? new Date(license.expiresAt).toLocaleDateString()
                    : t("licenses.permanent")
                }}
              </td>
              <td class="text-gray-500">
                {{ new Date(license.createdAt).toLocaleDateString() }}
              </td>
              <td class="text-right">
                <button
                  v-if="!license.revokedAt && license.tier !== 'enterprise'"
                  type="button"
                  class="text-primary-600 hover:text-primary-700 font-medium text-sm"
                >
                  <ArrowUpIcon class="h-4 w-4 inline mr-1" />
                  {{ t("licenses.upgrade") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 生成授權 Modal -->
    <Teleport to="body">
      <Dialog
        :open="showGenerateModal"
        class="fixed inset-0 z-50 overflow-y-auto"
        @close="closeGenerateModal"
      >
        <div class="fixed inset-0 bg-gray-500 bg-opacity-75" />
        <div class="flex min-h-full items-center justify-center p-4">
          <DialogPanel
            class="relative overflow-hidden bg-white rounded-3xl shadow-xl max-w-md w-full"
          >
            <div class="px-6 py-4 border-b">
              <DialogTitle as="h3" class="text-lg font-semibold">
                {{ t("licenses.modal.title") }}
              </DialogTitle>
            </div>
            <div class="px-6 py-4 space-y-4">
              <!-- 選擇租戶 -->
              <div>
                <label for="license-tenant" class="label">
                  {{ t("licenses.modal.selectTenant") }}
                </label>
                <select
                  id="license-tenant"
                  v-model="generateForm.tenantId"
                  class="input"
                >
                  <option value="">{{ t("common.pleaseSelect") }}</option>
                  <option
                    v-for="tenant in tenantsStore.tenants"
                    :key="tenant.id"
                    :value="tenant.id"
                  >
                    {{ tenant.businessName }}
                  </option>
                </select>
              </div>

              <!-- 選擇等級 -->
              <div>
                <label for="license-tier" class="label">{{
                  t("licenses.modal.tier")
                }}</label>
                <select
                  id="license-tier"
                  v-model="generateForm.tier"
                  class="input"
                >
                  <option value="standard">
                    {{ t("licenses.modal.tierOption.standard") }}
                  </option>
                  <option value="professional">
                    {{ t("licenses.modal.tierOption.professional") }}
                  </option>
                  <option value="enterprise">
                    {{ t("licenses.modal.tierOption.enterprise") }}
                  </option>
                </select>
              </div>

              <!-- 有效期 -->
              <div>
                <label for="license-expiry" class="label">{{
                  t("licenses.modal.expiresAt")
                }}</label>
                <input
                  id="license-expiry"
                  v-model="generateForm.expiresAt"
                  type="date"
                  class="input"
                />
                <p class="mt-1 text-xs text-gray-500">
                  {{ t("licenses.modal.expiresAtHint") }}
                </p>
              </div>
            </div>
            <div class="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
              <button
                type="button"
                class="btn btn-secondary"
                :disabled="generating"
                @click="closeGenerateModal"
              >
                {{ t("common.cancel") }}
              </button>
              <button
                type="button"
                class="btn btn-primary"
                :disabled="generating"
                @click="handleGenerate"
              >
                {{ generating ? t("common.processing") : t("common.generate") }}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </Teleport>
  </div>
</template>
