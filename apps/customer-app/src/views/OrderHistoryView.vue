<template>
  <div class="min-h-screen bg-ios-bg">
    <!-- Header -->
    <div class="bg-ios-card shadow-[0_2px_8px_rgb(0,0,0,0.04)]">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center py-6">
          <div class="flex items-center">
            <h1 class="text-2xl font-bold text-gray-900">
              {{ t("orderHistory.title") }}
            </h1>
          </div>
          <div class="flex items-center space-x-4">
            <router-link
              to="/profile"
              class="text-sm text-gray-600 hover:text-orange-600"
            >
              {{ t("orderHistory.personalCenter") }}
            </router-link>
            <button
              class="text-sm text-gray-600 hover:text-red-600"
              @click="handleLogout"
            >
              {{ t("orderHistory.logout") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Filters -->
      <div
        class="bg-ios-card rounded-2xl shadow-[0_2px_8px_rgb(0,0,0,0.04)] p-4 mb-6"
      >
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Status Filter -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("orderHistory.statusFilter") }}
            </label>
            <select
              v-model="filters.status"
              class="w-full px-3 py-2 bg-ios-bg rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white transition"
              @change="loadOrders"
            >
              <option value="">{{ t("orderHistory.allStatus") }}</option>
              <option value="0">{{ t("orderHistory.statusPending") }}</option>
              <option value="1">{{ t("orderHistory.statusConfirmed") }}</option>
              <option value="2">{{ t("orderHistory.statusPreparing") }}</option>
              <option value="3">{{ t("orderHistory.statusCompleted") }}</option>
              <option value="4">{{ t("orderHistory.statusServed") }}</option>
              <option value="5">{{ t("orderHistory.statusPaid") }}</option>
              <option value="6">{{ t("orderHistory.statusCancelled") }}</option>
            </select>
          </div>

          <!-- Date From -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("orderHistory.startDate") }}
            </label>
            <input
              v-model="filters.dateFrom"
              type="date"
              class="w-full px-3 py-2 bg-ios-bg rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white transition"
              @change="loadOrders"
            />
          </div>

          <!-- Date To -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("orderHistory.endDate") }}
            </label>
            <input
              v-model="filters.dateTo"
              type="date"
              class="w-full px-3 py-2 bg-ios-bg rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white transition"
              @change="loadOrders"
            />
          </div>
        </div>

        <!-- Reset Button -->
        <div class="mt-4 flex justify-end">
          <button
            class="px-4 py-2 text-sm text-ios-secondary hover:text-ios-text bg-ios-bg hover:bg-ios-separator rounded-full transition"
            @click="resetFilters"
          >
            {{ t("orderHistory.resetFilter") }}
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="flex justify-center items-center py-12">
        <div
          class="animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-t-transparent"
        />
      </div>

      <!-- Empty State -->
      <div
        v-else-if="orders.length === 0"
        class="bg-ios-card rounded-2xl shadow-[0_2px_8px_rgb(0,0,0,0.04)] p-12 text-center"
      >
        <svg
          class="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <h3 class="mt-2 text-sm font-medium text-gray-900">
          {{ t("orderHistory.noOrders") }}
        </h3>
        <p class="mt-1 text-sm text-gray-500">
          {{ t("orderHistory.noOrdersDesc") }}
        </p>
        <div class="mt-6">
          <router-link
            to="/menu"
            class="inline-flex items-center px-5 py-2.5 shadow-md text-sm font-semibold rounded-full text-white bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 transition"
          >
            {{ t("orderHistory.startOrdering") }}
          </router-link>
        </div>
      </div>

      <!-- Orders List -->
      <div v-else class="space-y-4">
        <div
          v-for="order in orders"
          :key="order.id"
          class="bg-ios-card rounded-2xl shadow-[0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.06)] transition cursor-pointer"
          @click="viewOrderDetail(order.id)"
        >
          <div class="p-6">
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <!-- Order Number -->
                <div class="flex items-center space-x-2 mb-2">
                  <h3 class="text-lg font-semibold text-gray-900">
                    {{ order.orderNumber }}
                  </h3>
                  <span
                    class="px-2 py-1 text-xs font-medium rounded-full"
                    :class="getStatusClass(order.status)"
                  >
                    {{ getStatusText(order.status) }}
                  </span>
                </div>

                <!-- Restaurant Name -->
                <p v-if="order.restaurant" class="text-sm text-gray-600 mb-1">
                  <span class="font-medium">{{
                    t("orderHistory.restaurant")
                  }}</span>
                  {{ order.restaurant.name }}
                </p>

                <!-- Table Info -->
                <p v-if="order.table" class="text-sm text-gray-600 mb-1">
                  <span class="font-medium">{{ t("orderHistory.table") }}</span>
                  {{ order.table.number }}
                </p>

                <!-- Order Date -->
                <p class="text-sm text-gray-500">
                  {{ formatDate(order.createdAt) }}
                </p>

                <!-- Items Count -->
                <p v-if="order.items" class="text-sm text-gray-500 mt-2">
                  {{
                    tWithParams("orderHistory.itemCount", {
                      count: order.items.length,
                    })
                  }}
                </p>
              </div>

              <!-- Amount -->
              <div class="text-right">
                <p class="text-2xl font-bold text-orange-600">
                  {{ formatPrice(order.totalAmount) }}
                </p>
                <p
                  v-if="order.paymentStatus === 'completed'"
                  class="text-sm text-green-600 mt-1"
                >
                  {{ t("orderHistory.paid") }}
                </p>
                <p v-else class="text-sm text-gray-500 mt-1">
                  {{ t("orderHistory.unpaid") }}
                </p>
              </div>
            </div>

            <!-- Action Buttons -->
            <div
              class="mt-4 pt-4 border-t border-ios-separator flex justify-end space-x-2"
            >
              <button
                class="px-4 py-2 text-sm font-semibold text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-full transition"
                @click.stop="viewOrderDetail(order.id)"
              >
                {{ t("orderHistory.viewDetails") }}
              </button>
              <button
                v-if="order.status === 'pending'"
                class="px-4 py-2 text-sm font-semibold text-ios-red hover:bg-ios-red/10 rounded-full transition"
                @click.stop="cancelOrder(order.id)"
              >
                {{ t("orderTracking.cancelOrder") }}
              </button>
            </div>

            <!--
              評價：留在訂單卡片內，接在操作列之後。整張卡片本身是「看詳情」的
              連結，所以這一塊要自己擋下點擊，不然選一顆星就跳頁了。
            -->
            <div @click.stop>
              <OrderReviewSection
                :order-id="order.id"
                :order-status="order.status"
                :items="order.items"
                variant="inset"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div
        v-if="pagination.totalPages > 1"
        class="bg-ios-card rounded-2xl shadow-[0_2px_8px_rgb(0,0,0,0.04)] p-4 mt-6 flex justify-between items-center"
      >
        <button
          :disabled="pagination.page === 1"
          class="px-4 py-2 text-sm font-semibold text-ios-text bg-ios-bg hover:bg-ios-separator rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition"
          @click="changePage(pagination.page - 1)"
        >
          {{ t("orderHistory.prevPage") }}
        </button>

        <span class="text-sm text-ios-secondary">
          {{
            tWithParams("orderHistory.pageInfo", {
              current: pagination.page,
              total: pagination.totalPages,
              count: pagination.total,
            })
          }}
        </span>

        <button
          :disabled="pagination.page === pagination.totalPages"
          class="px-4 py-2 text-sm font-semibold text-ios-text bg-ios-bg hover:bg-ios-separator rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition"
          @click="changePage(pagination.page + 1)"
        >
          {{ t("orderHistory.nextPage") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useI18n } from "@/composables/useI18n";
import { useCurrency } from "@/composables/useCurrency";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useToast } from "vue-toastification";
import OrderReviewSection from "@/components/reviews/OrderReviewSection.vue";
import { customerOrderApi } from "@/services/customerOrderApi";
import type { CustomerOrdersParams } from "@/services/customerOrderApi";
import type { Order } from "@makanmasak/shared-types";

const router = useRouter();
const authStore = useAuthStore();
const { t, tWithParams } = useI18n();
const { formatPrice } = useCurrency();
const { confirm: confirmModal } = useConfirmModal();
const toast = useToast();

const orders = ref<Order[]>([]);
const isLoading = ref(false);
const filters = reactive({
  status: "",
  dateFrom: "",
  dateTo: "",
});

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
});

// 載入訂單
const loadOrders = async () => {
  isLoading.value = true;

  try {
    const params: CustomerOrdersParams = {
      page: pagination.page,
      limit: pagination.limit,
    };

    if (filters.status) {
      params.status = filters.status;
    }
    if (filters.dateFrom) {
      params.dateFrom = filters.dateFrom;
    }
    if (filters.dateTo) {
      params.dateTo = filters.dateTo;
    }

    const response = await customerOrderApi.getMyOrders(params);
    orders.value = response.orders;
    pagination.page = response.pagination.page;
    pagination.total = response.pagination.total;
    pagination.totalPages = response.pagination.totalPages;
  } catch (error) {
    console.error("Failed to load orders:", error);
  } finally {
    isLoading.value = false;
  }
};

// 重置篩選
const resetFilters = () => {
  filters.status = "";
  filters.dateFrom = "";
  filters.dateTo = "";
  pagination.page = 1;
  loadOrders();
};

// 換頁
const changePage = (page: number) => {
  pagination.page = page;
  loadOrders();
};

// 查看訂單詳情
const viewOrderDetail = (orderId: string) => {
  router.push(`/orders/${orderId}`);
};

// 取消訂單
const cancelOrder = async (orderId: string) => {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("orderHistory.cancelOrder"),
    message: t("orderHistory.confirmCancelOrder"),
    confirmLabel: t("orderHistory.cancelOrder"),
  });
  if (!confirmed) return;

  try {
    await customerOrderApi.cancelOrder(
      orderId,
      t("orderHistory.customerCancelled"),
    );
    await loadOrders();
  } catch (error) {
    console.error("Failed to cancel order:", error);
    toast.error(t("toast.cancelOrderFailed"));
  }
};

// 登出
const handleLogout = async () => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("orderHistory.logout"),
    message: t("orderHistory.confirmLogout"),
    confirmLabel: t("orderHistory.logout"),
  });
  if (!confirmed) return;

  await authStore.logout();
  router.push("/login");
};

// 獲取狀態樣式 (iOS semantic colors, design-system 4.2)
const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    pending: "bg-ios-orange/15 text-ios-orange",
    confirmed: "bg-ios-blue/15 text-ios-blue",
    preparing: "bg-ios-teal/15 text-ios-teal",
    ready: "bg-ios-green/15 text-ios-green",
    delivered: "bg-ios-green/15 text-ios-green",
    paid: "bg-ios-green/15 text-ios-green",
    cancelled: "bg-ios-red/15 text-ios-red",
    refunded: "bg-ios-red/15 text-ios-red",
  };
  return classes[status] || "bg-ios-bg text-ios-secondary";
};

// 獲取狀態文字 (computed for reactivity when language changes)
const statusTexts = computed(
  (): Record<string, string> => ({
    pending: t("orderHistory.statusPending"),
    confirmed: t("orderHistory.statusConfirmed"),
    preparing: t("orderHistory.statusPreparing"),
    ready: t("orderHistory.statusCompleted"),
    delivered: t("orderHistory.statusServed"),
    paid: t("orderHistory.statusPaid"),
    cancelled: t("orderHistory.statusCancelled"),
    refunded: t("orderHistory.statusRefunded"),
  }),
);

const getStatusText = (status: string) => {
  return statusTexts.value[status] || t("orderHistory.statusUnknown");
};

// 格式化日期
const formatDate = (dateInput?: string | number | null) => {
  if (dateInput == null) return "-";
  const date = new Date(dateInput);
  return date.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// 初始化
onMounted(async () => {
  // 檢查登入狀態
  if (!authStore.isAuthenticated) {
    router.push("/login");
    return;
  }

  const isValid = await authStore.checkAuth();
  if (!isValid) {
    router.push("/login");
    return;
  }

  await loadOrders();
});
</script>
