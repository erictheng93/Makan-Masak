<template>
  <div v-if="hasCouponsModule" class="coupons-view">
    <!-- 標題和操作按鈕 -->
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-3xl font-bold text-gray-900">
          {{ t("coupons.title") }}
        </h1>
        <p class="text-gray-600">{{ t("coupons.subtitle") }}</p>
      </div>
      <div class="flex items-center space-x-4">
        <button
          class="px-6 py-3 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 transition-colors"
          data-testid="open-create-coupon"
          @click="showCreateModal = true"
        >
          <PlusIcon class="w-5 h-5 inline mr-2" />
          {{ t("coupons.create") }}
        </button>
      </div>
    </div>

    <!-- 統計卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-2 bg-blue-100 rounded-lg">
            <TicketIcon class="w-6 h-6 text-blue-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">{{ t("coupons.stats.total") }}</p>
            <p class="text-2xl font-bold text-gray-900">{{ stats.total }}</p>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-2 bg-green-100 rounded-lg">
            <CheckCircleIcon class="w-6 h-6 text-green-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">{{ t("coupons.stats.used") }}</p>
            <p class="text-2xl font-bold text-gray-900">
              {{ stats.totalUsed }}
            </p>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-2 bg-yellow-100 rounded-lg">
            <ClockIcon class="w-6 h-6 text-yellow-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">{{ t("coupons.stats.active") }}</p>
            <p class="text-2xl font-bold text-gray-900">{{ stats.active }}</p>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-2 bg-teal-100 rounded-lg">
            <CurrencyDollarIcon class="w-6 h-6 text-teal-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">
              {{ t("coupons.stats.totalSavings") }}
            </p>
            <p class="text-2xl font-bold text-gray-900">
              {{ formatPrice(stats.totalSavings) }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 篩選和搜索 -->
    <div class="bg-white rounded-lg shadow mb-6 p-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("coupons.filters.search")
          }}</label>
          <input
            v-model="filters.search"
            type="text"
            :placeholder="t('coupons.filters.searchPlaceholder')"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("coupons.filters.status")
          }}</label>
          <select
            v-model="filters.status"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">{{ t("coupons.filters.allStatus") }}</option>
            <option value="active">{{ t("coupons.filters.active") }}</option>
            <option value="expired">{{ t("coupons.filters.expired") }}</option>
            <option value="exhausted">
              {{ t("coupons.filters.exhausted") }}
            </option>
            <option value="inactive">
              {{ t("coupons.filters.inactive") }}
            </option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("coupons.filters.discountType")
          }}</label>
          <select
            v-model="filters.discountType"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">{{ t("coupons.filters.allTypes") }}</option>
            <option value="percentage">
              {{ t("coupons.filters.percentage") }}
            </option>
            <option value="fixed">{{ t("coupons.filters.fixed") }}</option>
          </select>
        </div>
        <div class="flex items-end">
          <button
            class="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            @click="resetFilters"
          >
            {{ t("coupons.filters.reset") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 優惠券列表 -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("coupons.table.couponInfo") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("coupons.table.discount") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("coupons.table.usage") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("coupons.table.validity") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("coupons.table.status") }}
              </th>
              <th
                class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("coupons.table.actions") }}
              </th>
            </tr>
          </thead>
          <tbody v-if="isLoading" class="bg-white divide-y divide-gray-200">
            <tr>
              <td
                colspan="6"
                class="px-6 py-12 text-center text-sm text-gray-500"
              >
                {{ t("common.loading") }}
              </td>
            </tr>
          </tbody>
          <tbody
            v-else-if="filteredCoupons.length === 0"
            class="bg-white divide-y divide-gray-200"
          >
            <tr>
              <td
                colspan="6"
                class="px-6 py-12 text-center text-sm text-gray-500"
              >
                {{ t("common.noData") }}
              </td>
            </tr>
          </tbody>
          <tbody v-else class="bg-white divide-y divide-gray-200">
            <tr
              v-for="coupon in filteredCoupons"
              :key="coupon.id"
              class="hover:bg-gray-50"
            >
              <td class="px-6 py-4">
                <div>
                  <div class="text-sm font-medium text-gray-900">
                    {{ coupon.name }}
                  </div>
                  <div class="text-sm text-gray-500">{{ coupon.code }}</div>
                  <div
                    v-if="coupon.description"
                    class="text-xs text-gray-400 mt-1"
                  >
                    {{ coupon.description }}
                  </div>
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="text-sm">
                  <span v-if="coupon.discountType === 'percentage'">
                    {{ coupon.discountValue }}%
                    <span v-if="coupon.maxDiscountAmount" class="text-gray-500">
                      ({{
                        t("coupons.table.maxDiscount", {
                          amount: formatPrice(coupon.maxDiscountAmount),
                        })
                      }})
                    </span>
                  </span>
                  <span v-else>
                    {{ formatPrice(coupon.discountValue) }}
                  </span>
                </div>
                <div
                  v-if="coupon.minOrderAmount > 0"
                  class="text-xs text-gray-500"
                >
                  {{
                    t("coupons.table.minOrder", {
                      amount: formatPrice(coupon.minOrderAmount),
                    })
                  }}
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="text-sm">
                  <div class="flex items-center">
                    <span class="text-gray-900">{{ coupon.usedCount }}</span>
                    <span v-if="coupon.usageLimit" class="text-gray-500"
                      >/ {{ coupon.usageLimit }}</span
                    >
                    <span v-else class="text-gray-500"
                      >/ {{ t("coupons.table.unlimited") }}</span
                    >
                  </div>
                  <div
                    v-if="coupon.usageLimit"
                    class="w-full bg-gray-200 rounded-full h-2 mt-1"
                  >
                    <div
                      class="bg-teal-600 h-2 rounded-full"
                      :style="{
                        width: `${Math.min(100, (coupon.usedCount / coupon.usageLimit) * 100)}%`,
                      }"
                    ></div>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="text-sm">
                  <div class="text-gray-900">
                    {{ formatDate(coupon.validFrom) }}
                  </div>
                  <div class="text-gray-500">
                    {{
                      t("coupons.table.validTo", {
                        date: formatDate(coupon.validTo),
                      })
                    }}
                  </div>
                </div>
              </td>
              <td class="px-6 py-4">
                <span
                  :class="[
                    'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
                    getCouponStatusClass(coupon),
                  ]"
                >
                  {{ getCouponStatusText(coupon) }}
                </span>
              </td>
              <td class="px-6 py-4 text-right">
                <div class="flex items-center justify-end space-x-2">
                  <button
                    class="text-teal-600 hover:text-teal-900 text-sm"
                    @click="viewCouponStats(coupon)"
                  >
                    {{ t("coupons.actions.stats") }}
                  </button>
                  <button
                    class="text-blue-600 hover:text-blue-900 text-sm"
                    @click="editCoupon(coupon)"
                  >
                    {{ t("coupons.actions.edit") }}
                  </button>
                  <button
                    class="text-teal-600 hover:text-teal-900 text-sm"
                    :data-testid="`distribute-coupon-${coupon.id}`"
                    @click="distributeCoupon(coupon)"
                  >
                    {{ t("coupons.actions.distribute") }}
                  </button>
                  <button
                    v-if="coupon.isActive"
                    class="text-yellow-600 hover:text-yellow-900 text-sm"
                    @click="deactivateCoupon(coupon)"
                  >
                    {{ t("coupons.actions.deactivate") }}
                  </button>
                  <button
                    v-else
                    class="text-green-600 hover:text-green-900 text-sm"
                    @click="activateCoupon(coupon)"
                  >
                    {{ t("coupons.actions.activate") }}
                  </button>
                  <button
                    v-if="isAdmin"
                    class="text-red-600 hover:text-red-900 text-sm"
                    @click="deleteCoupon(coupon)"
                  >
                    {{ t("coupons.actions.delete") }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分頁 -->
      <div
        class="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6"
      >
        <div class="flex-1 flex justify-between sm:hidden">
          <button
            :disabled="currentPage === 1"
            class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            @click="currentPage--"
          >
            {{ t("coupons.pagination.previous") }}
          </button>
          <button
            :disabled="currentPage >= totalPages"
            class="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            @click="currentPage++"
          >
            {{ t("coupons.pagination.next") }}
          </button>
        </div>
        <div
          class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between"
        >
          <div>
            <p class="text-sm text-gray-700">
              {{
                t("coupons.pagination.showing", {
                  start: startIndex,
                  end: endIndex,
                  total: totalCoupons,
                })
              }}
            </p>
          </div>
          <div>
            <nav
              class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px"
              :aria-label="t('coupons.pagination.label')"
            >
              <button
                :disabled="currentPage === 1"
                class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                @click="currentPage--"
              >
                <ChevronLeftIcon class="h-5 w-5" />
              </button>
              <button
                v-for="page in visiblePages"
                :key="page"
                :class="[
                  'relative inline-flex items-center px-4 py-2 border text-sm font-medium',
                  page === currentPage
                    ? 'z-10 bg-teal-50 border-teal-500 text-teal-600'
                    : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50',
                ]"
                @click="currentPage = page"
              >
                {{ page }}
              </button>
              <button
                :disabled="currentPage >= totalPages"
                class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                @click="currentPage++"
              >
                <ChevronRightIcon class="h-5 w-5" />
              </button>
            </nav>
          </div>
        </div>
      </div>
    </div>

    <!-- 創建/編輯優惠券 Modal -->
    <!-- 表單 Modal with Suspense -->
    <Suspense v-if="showCreateModal">
      <template #default>
        <CouponFormModal
          :coupon="editingCoupon || undefined"
          @close="closeModal"
          @save="handleSaveCoupon"
        />
      </template>
      <template #fallback>
        <div
          class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        >
          <div class="bg-white rounded-lg p-8 max-w-md w-full animate-pulse">
            <div class="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
            <div class="h-4 bg-gray-200 rounded w-1/2 mb-6"></div>
            <div class="h-32 bg-gray-100 rounded mb-4"></div>
            <div class="h-10 bg-gray-200 rounded w-24"></div>
          </div>
        </div>
      </template>
    </Suspense>

    <!-- 發放 Modal with Suspense -->
    <Suspense v-if="showDistributeModal && distributingCoupon">
      <template #default>
        <CouponDistributeModal
          :coupon="distributingCoupon"
          @close="closeDistributeModal"
          @distributed="fetchStats"
        />
      </template>
      <template #fallback>
        <div
          class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        >
          <div class="bg-white rounded-lg p-8 max-w-2xl w-full animate-pulse">
            <div class="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div class="h-40 bg-gray-100 rounded"></div>
          </div>
        </div>
      </template>
    </Suspense>

    <!-- 統計 Modal with Suspense -->
    <Suspense v-if="showStatsModal && selectedCoupon">
      <template #default>
        <CouponStatsModal
          :coupon="selectedCoupon"
          :stats="couponStats"
          @close="showStatsModal = false"
        />
      </template>
      <template #fallback>
        <div
          class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        >
          <div class="bg-white rounded-lg p-8 max-w-2xl w-full animate-pulse">
            <div class="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div class="grid grid-cols-2 gap-4 mb-4">
              <div class="h-20 bg-gray-100 rounded"></div>
              <div class="h-20 bg-gray-100 rounded"></div>
            </div>
            <div class="h-48 bg-gray-100 rounded"></div>
          </div>
        </div>
      </template>
    </Suspense>

    <!-- 刪除確認 Modal -->
    <div v-if="deleteTarget" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black/30 backdrop-blur-sm"
          @click="deleteTarget = null"
        />
        <div class="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full">
          <div class="p-6 text-center">
            <div
              class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4"
            >
              <ExclamationTriangleIcon class="h-6 w-6 text-red-600" />
            </div>
            <h3 class="text-[17px] font-bold text-ios-text mb-2">
              {{ t("coupons.messages.deleteConfirmTitle") }}
            </h3>
            <p class="text-[14px] text-ios-secondary mb-6">
              {{
                t("coupons.messages.deleteConfirm", { name: deleteTarget.name })
              }}
            </p>
            <div class="flex gap-2.5 justify-center">
              <button
                class="px-5 py-2.5 text-[14px] font-semibold text-ios-text bg-ios-bg rounded-full hover:bg-ios-separator transition-colors"
                @click="deleteTarget = null"
              >
                {{ t("common.cancel") }}
              </button>
              <button
                class="px-5 py-2.5 text-[14px] font-semibold text-white bg-red-500 rounded-full hover:bg-red-600 transition-colors shadow-[0_2px_8px_rgba(255,59,48,0.25)]"
                @click="confirmDeleteCoupon"
              >
                {{ t("common.delete") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="!moduleAccess.isLoaded" class="coupons-view">
    <div class="h-32 animate-pulse rounded-2xl bg-gray-100" />
  </div>

  <div v-else class="coupons-view">
    <div class="rounded-2xl bg-white p-6 shadow-sm">
      <h1 class="text-xl font-semibold text-gray-900">
        {{ t("coupons.moduleUnavailable.title") }}
      </h1>
      <p class="mt-2 text-sm text-gray-600">
        {{ t("coupons.moduleUnavailable.description") }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { api } from "@/services/api";
import {
  PlusIcon,
  TicketIcon,
  CheckCircleIcon,
  ClockIcon,
  CurrencyDollarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from "@heroicons/vue/24/outline";

// Components
import { useAsyncModals } from "@/composables/useAsyncModals";
import { useAuthStore } from "@/stores/auth";
import { useModuleAccessStore } from "@makanmasak/shared/stores/moduleAccess";
import { extractApiErrorCode } from "@/utils/errorHandler";

const { t } = useI18n();
const { formatPrice } = useCurrency();
const { formatDate } = useDateFormatter();
const authStore = useAuthStore();
const isAdmin = computed(() => authStore.user?.role === 0);

// The sidebar entry is behind <ModuleGate module="coupons">, but the route only
// declared `roles`. A bookmarked /dashboard/coupons therefore rendered the full
// shell on a plan without the module and answered with a generic
// "failed to fetch coupons" toast, which explains nothing.
const moduleAccess = useModuleAccessStore();
const hasCouponsModule = computed(
  () => moduleAccess.effectiveModules?.coupons === true,
);

// 異步加載 Modal 組件
const { CouponFormModal, CouponStatsModal, CouponDistributeModal } =
  useAsyncModals();

// Types
import type {
  Coupon,
  CouponsSummary,
  CouponDetailStats,
} from "@makanmasak/shared-types";

// Reactive state
const showCreateModal = ref(false);
const showStatsModal = ref(false);
const showDistributeModal = ref(false);
const distributingCoupon = ref<Coupon | null>(null);
const editingCoupon = ref<Coupon | null>(null);
const selectedCoupon = ref<Coupon | null>(null);
const couponStats = ref<CouponDetailStats | null>(null);
const deleteTarget = ref<Coupon | null>(null);
const currentPage = ref(1);
const pageSize = 20;

const filters = ref({
  search: "",
  status: "",
  discountType: "",
});

const stats = ref<CouponsSummary>({
  total: 0,
  active: 0,
  totalUsed: 0,
  totalSavings: 0,
});

// API calls
const toast = useToast();
const couponsData = ref<{
  data: Coupon[];
  pagination: { total: number };
} | null>(null);
const isLoading = ref(false);

// Fetch coupons function
const fetchCoupons = async () => {
  isLoading.value = true;
  try {
    const params: Record<string, string> = {
      page: currentPage.value.toString(),
      limit: pageSize.toString(),
    };
    if (filters.value.search) params.search = filters.value.search;
    if (filters.value.status) params.status = filters.value.status;
    if (filters.value.discountType)
      params.discountType = filters.value.discountType;

    const response = await api.get("/coupons", params);
    const body = response.data as {
      success: boolean;
      data: Coupon[];
      pagination: { total: number };
    };
    couponsData.value = {
      data: body.data,
      pagination: body.pagination,
    };
  } catch (error) {
    toast.error(t("coupons.messages.fetchFailed"));
    console.error("Failed to fetch coupons:", error);
  } finally {
    isLoading.value = false;
  }
};

// Computed properties
const filteredCoupons = computed(() => couponsData.value?.data || []);
const totalCoupons = computed(() => couponsData.value?.pagination?.total || 0);
const totalPages = computed(() => Math.ceil(totalCoupons.value / pageSize));

const startIndex = computed(() => (currentPage.value - 1) * pageSize + 1);
const endIndex = computed(() =>
  Math.min(currentPage.value * pageSize, totalCoupons.value),
);

const visiblePages = computed(() => {
  const pages = [];
  const start = Math.max(1, currentPage.value - 2);
  const end = Math.min(totalPages.value, currentPage.value + 2);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  return pages;
});

import { type CouponStatus, getCouponStatus } from "@/utils/couponStatus";

const statusClassMap: Record<CouponStatus, string> = {
  inactive: "bg-gray-100 text-gray-800",
  expired: "bg-red-100 text-red-800",
  exhausted: "bg-yellow-100 text-yellow-800",
  scheduled: "bg-blue-100 text-blue-800",
  active: "bg-green-100 text-green-800",
};

const getCouponStatusClass = (coupon: Coupon) =>
  statusClassMap[getCouponStatus(coupon)];
const getCouponStatusText = (coupon: Coupon) =>
  t(`coupons.status.${getCouponStatus(coupon)}`);

const resetFilters = () => {
  filters.value = {
    search: "",
    status: "",
    discountType: "",
  };
  currentPage.value = 1;
};

const editCoupon = (coupon: Coupon) => {
  editingCoupon.value = coupon ? { ...coupon } : null;
  showCreateModal.value = true;
};

const closeModal = () => {
  showCreateModal.value = false;
  editingCoupon.value = null;
};

const handleSaveCoupon = async (couponData: Record<string, unknown>) => {
  try {
    if (editingCoupon.value) {
      await api.put(`/coupons/${editingCoupon.value.id}`, couponData);
      toast.success(t("coupons.messages.updateSuccess"));
    } else {
      await api.post("/coupons", couponData);
      toast.success(t("coupons.messages.createSuccess"));
    }

    await Promise.all([fetchCoupons(), fetchStats()]);
    closeModal();
  } catch (error) {
    if (extractApiErrorCode(error) === "COUPON_CODE_EXISTS") {
      toast.error(t("coupons.messages.codeExists"));
    } else {
      toast.error(
        t("coupons.messages.operationFailed", {
          message: (error as Error).message,
        }),
      );
    }
  }
};

const distributeCoupon = (coupon: Coupon) => {
  distributingCoupon.value = coupon;
  showDistributeModal.value = true;
};

const closeDistributeModal = () => {
  showDistributeModal.value = false;
  distributingCoupon.value = null;
};

const viewCouponStats = async (coupon: Coupon) => {
  try {
    const response = await api.get<{
      coupon: Coupon;
      stats: CouponDetailStats;
    }>(`/coupons/${coupon.id}/stats`);
    selectedCoupon.value = coupon;
    couponStats.value = response.data.data?.stats ?? null;
    showStatsModal.value = true;
  } catch {
    toast.error(t("coupons.messages.statsFailed"));
  }
};

const deactivateCoupon = async (coupon: Coupon) => {
  try {
    await api.post(`/coupons/${coupon.id}/deactivate`);
    toast.success(t("coupons.messages.deactivateSuccess"));
    await Promise.all([fetchCoupons(), fetchStats()]);
  } catch {
    toast.error(t("coupons.messages.deactivateFailed"));
  }
};

const activateCoupon = async (coupon: Coupon) => {
  try {
    await api.put(`/coupons/${coupon.id}`, { isActive: true });
    toast.success(t("coupons.messages.activateSuccess"));
    await Promise.all([fetchCoupons(), fetchStats()]);
  } catch {
    toast.error(t("coupons.messages.activateFailed"));
  }
};

const deleteCoupon = (coupon: Coupon) => {
  deleteTarget.value = coupon;
};

const confirmDeleteCoupon = async () => {
  if (!deleteTarget.value) return;
  const couponId = deleteTarget.value.id;
  deleteTarget.value = null;

  try {
    await api.delete(`/coupons/${couponId}`);
    toast.success(t("coupons.messages.deleteSuccess"));
    await Promise.all([fetchCoupons(), fetchStats()]);
  } catch {
    toast.error(t("coupons.messages.deleteFailed"));
  }
};

// Initialize data and watchers.
// main.ts kicks the module fetch off, so `isLoaded` is usually still false at
// mount; requesting the list before it answers is what produced the misleading
// "failed to fetch coupons" toast on a plan without the module. The watcher
// lives inside onMounted because an immediate one would run during setup,
// before these fetchers are initialised.
let initialFetchStarted = false;
onMounted(() => {
  watch(
    () => moduleAccess.isLoaded && hasCouponsModule.value,
    (ready) => {
      if (!ready || initialFetchStarted) return;
      initialFetchStarted = true;
      fetchCoupons();
      fetchStats();
    },
    { immediate: true },
  );
});

// Instant fetch for page changes and dropdown filter changes
watch(
  [currentPage, () => filters.value.status, () => filters.value.discountType],
  ([, status, discountType], [, previousStatus, previousDiscountType]) => {
    if (status !== previousStatus || discountType !== previousDiscountType) {
      if (currentPage.value !== 1) {
        currentPage.value = 1;
        return;
      }
    }
    void fetchCoupons();
  },
);

// Debounced fetch for search input (avoid firing on every keystroke)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => filters.value.search,
  () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      if (currentPage.value !== 1) {
        currentPage.value = 1;
      } else {
        void fetchCoupons();
      }
    }, 300);
  },
);
onUnmounted(() => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
});

// Fetch summary stats from server
const fetchStats = async () => {
  try {
    const response = await api.get<CouponsSummary>("/coupons/stats/summary");
    if (response.data.data) {
      stats.value = response.data.data;
    }
  } catch {
    // Stats are non-critical — silently fall back to zeros
  }
};
</script>
