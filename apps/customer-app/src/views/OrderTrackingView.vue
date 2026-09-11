<template>
  <div class="min-h-screen bg-ios-bg">
    <!-- 頂部導航 -->
    <nav class="sticky top-0 z-40 bg-white/80 backdrop-blur-xl shadow-card-sm">
      <div class="max-w-md mx-auto px-5 py-4">
        <div class="flex items-center justify-between">
          <button
            class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-ios-text active:scale-95 transition-transform duration-150"
            @click="router.push(`/restaurant/${restaurantId}/table/${tableId}`)"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <div class="flex-1 text-center">
            <h1 class="text-lg font-semibold text-ios-text">
              {{ t("orderTracking.title") }}
            </h1>
            <p class="text-sm text-ios-secondary">
              {{ t("orderTracking.orderNumber") }} {{ order?.orderNumber }}
            </p>
          </div>

          <div class="w-10 h-10" />
          <!-- 占位符保持居中 -->
        </div>
      </div>
    </nav>

    <!-- 主要內容 -->
    <main class="max-w-md mx-auto">
      <!-- 載入狀態 -->
      <div v-if="isLoading" class="p-8 text-center">
        <div
          class="animate-spin rounded-full h-12 w-12 border-2 border-ios-blue/20 border-t-ios-blue mx-auto mb-4"
        />
        <p class="text-ios-secondary">{{ t("orderTracking.loadingOrder") }}</p>
      </div>

      <!-- 錯誤狀態 -->
      <div v-else-if="error" class="p-8 text-center">
        <div
          class="w-16 h-16 bg-ios-red/15 rounded-full flex items-center justify-center mx-auto mb-4"
        >
          <svg
            class="w-8 h-8 text-ios-red"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h3 class="text-lg font-medium text-ios-text mb-2">
          {{ t("orderTracking.loadFailed") }}
        </h3>
        <p class="text-ios-secondary mb-4">
          {{ error }}
        </p>
        <button
          class="px-4 py-2 bg-ios-blue text-white rounded-full active:scale-[0.98] transition-transform duration-150"
          @click="() => refetch()"
        >
          {{ t("orderTracking.reload") }}
        </button>
      </div>

      <!-- 訂單內容 -->
      <div v-else-if="order" class="px-4 py-6 space-y-6">
        <!-- 訂單狀態卡片 -->
        <div class="bg-white rounded-2xl p-6 shadow-card">
          <!-- 狀態圖標和標題 -->
          <div class="text-center mb-6">
            <div
              :class="[
                'w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4',
                getStatusColor(order.status).bg,
              ]"
            >
              <component
                :is="getStatusIcon(order.status)"
                :class="['w-10 h-10', getStatusColor(order.status).text]"
              />
            </div>
            <h2 class="text-xl font-semibold text-ios-text mb-2">
              {{ getStatusTitle(order.status) }}
            </h2>
            <p class="text-ios-secondary">
              {{ getStatusDescription(order.status) }}
            </p>
          </div>

          <!-- 進度條 -->
          <div class="mb-6">
            <div class="flex justify-between text-xs text-ios-secondary mb-2">
              <span>{{ t("orderTracking.orderProgress") }}</span>
              <span>{{ getProgressPercentage(order.status) }}%</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-1.5">
              <div
                class="bg-ios-blue h-1.5 rounded-full transition-all duration-500"
                :style="{ width: `${getProgressPercentage(order.status)}%` }"
              />
            </div>
          </div>

          <!-- 預估時間 -->
          <div v-if="estimatedTime" class="text-center">
            <div
              class="inline-flex items-center space-x-2 px-4 py-2 bg-ios-blue/10 rounded-full"
            >
              <svg
                class="w-4 h-4 text-ios-blue"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span class="text-sm font-medium text-ios-blue">
                {{
                  tWithParams("orderTracking.estimatedMinutes", {
                    minutes: estimatedTime,
                  })
                }}
              </span>
            </div>
          </div>
        </div>

        <!-- 時間軸 -->
        <div
          data-testid="order-timeline"
          class="bg-white rounded-2xl p-6 shadow-card"
        >
          <h3 class="text-lg font-semibold text-ios-text mb-4">
            {{ t("orderTracking.orderTimeline") }}
          </h3>

          <div class="space-y-4">
            <TimelineItem
              v-for="(step, index) in orderTimeline"
              :key="index"
              :title="step.title"
              :description="step.description"
              :status="
                step.completed
                  ? 'completed'
                  : index === 0
                    ? 'current'
                    : 'pending'
              "
              :timestamp="step.time"
              :is-last="index === orderTimeline.length - 1"
            />
          </div>
        </div>

        <!-- 訂單詳情 -->
        <div class="bg-white rounded-2xl p-6 shadow-card">
          <h3 class="text-lg font-semibold text-ios-text mb-4">
            {{ t("orderTracking.orderDetails") }}
          </h3>

          <!-- 基本資訊 -->
          <div class="space-y-3 mb-6">
            <div class="flex justify-between text-sm">
              <span class="text-ios-secondary">{{
                t("orderTracking.orderNumber")
              }}</span>
              <span class="font-medium text-ios-text">{{
                order.orderNumber
              }}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-ios-secondary">{{
                t("orderTracking.orderTime")
              }}</span>
              <span class="font-medium text-ios-text">{{
                formatDateTime(order.createdAt)
              }}</span>
            </div>
            <div v-if="order.customerName" class="flex justify-between text-sm">
              <span class="text-ios-secondary">{{
                t("orderTracking.customerName")
              }}</span>
              <span class="font-medium text-ios-text">{{
                order.customerName
              }}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-ios-secondary">{{
                t("orderTracking.tableNumber")
              }}</span>
              <span class="font-medium text-ios-text">{{ tableNumber }}</span>
            </div>
          </div>

          <!-- 餐點列表 -->
          <div class="border-t border-ios-separator pt-4">
            <h4 class="font-medium text-ios-text mb-3">
              {{ t("orderTracking.orderedItems") }}
            </h4>
            <div class="space-y-3">
              <OrderItemCard
                v-for="item in order.items"
                :key="item.id"
                :item="item"
              />
            </div>
          </div>

          <!-- 訂單備註 -->
          <div
            v-if="order.notes"
            class="border-t border-ios-separator pt-4 mt-4"
          >
            <h4 class="font-medium text-ios-text mb-2">
              {{ t("orderTracking.orderNotes") }}
            </h4>
            <p class="text-sm text-ios-secondary bg-gray-100 rounded-xl p-3.5">
              {{ order.notes }}
            </p>
          </div>

          <!-- 價格摘要 -->
          <div class="border-t border-ios-separator pt-4 mt-4">
            <div class="space-y-2">
              <div class="flex justify-between text-sm text-ios-secondary">
                <span>{{ t("common.subtotal") }}</span>
                <span>{{ formatPrice(order.subtotal ?? 0) }}</span>
              </div>
              <div
                v-if="(order.serviceCharge ?? 0) > 0"
                class="flex justify-between text-sm text-ios-secondary"
              >
                <span>{{ t("cart.serviceCharge") }}</span>
                <span>{{ formatPrice(order.serviceCharge ?? 0) }}</span>
              </div>
              <div
                v-if="(order.taxAmount ?? 0) > 0"
                class="flex justify-between text-sm text-ios-secondary"
              >
                <span>{{ t("cart.tax") }}</span>
                <span>{{ formatPrice(order.taxAmount ?? 0) }}</span>
              </div>
              <div
                v-if="(order.discountAmount ?? 0) > 0"
                class="flex justify-between text-sm text-ios-green"
              >
                <span>{{ t("cart.discount") }}</span>
                <span>-{{ formatPrice(order.discountAmount ?? 0) }}</span>
              </div>
              <div
                class="flex justify-between text-lg font-semibold text-ios-text pt-2 border-t border-ios-separator"
              >
                <span>{{ t("common.total") }}</span>
                <span>{{ formatPrice(order.totalAmount) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!--
          評價：放在訂單詳情之後、操作按鈕之前。餐點與金額都讀過了才問感想，
          而且訂單一送達就會停在這一頁，是最自然的入口。
        -->
        <OrderReviewSection
          :order-id="order.id"
          :order-status="order.status"
          :items="order.items"
          variant="card"
        />

        <!-- 操作按鈕 -->
        <div class="space-y-3">
          <!-- 取消訂單按鈕 (僅在可取消狀態顯示) -->
          <button
            v-if="canCancelOrder"
            class="w-full bg-ios-red/10 text-ios-red font-semibold py-3.5 px-4 rounded-full active:bg-ios-red/20 active:scale-[0.98] transition-transform duration-150"
            @click="showCancelConfirmation = true"
          >
            {{ t("orderTracking.cancelOrder") }}
          </button>

          <!-- 繼續點餐按鈕 -->
          <button
            class="w-full bg-ios-blue text-white font-semibold py-3.5 px-4 rounded-full active:scale-[0.98] transition-transform duration-150"
            @click="router.push(`/restaurant/${restaurantId}/table/${tableId}`)"
          >
            {{ t("orderTracking.continueOrdering") }}
          </button>
        </div>
      </div>
    </main>

    <!-- 取消訂單確認對話框 -->
    <ConfirmationModal
      :show="showCancelConfirmation"
      :title="t('orderTracking.confirmCancel')"
      :message="t('orderTracking.confirmCancelMessage')"
      :confirm-text="t('orderTracking.confirmCancelBtn')"
      :cancel-text="t('orderTracking.keepOrder')"
      :is-destructive="true"
      @confirm="handleCancelOrder"
      @cancel="showCancelConfirmation = false"
    />

    <!-- 即時連接狀態指示器 -->
    <div
      v-if="shouldUseGuestRealtime && connectionStatus !== 'connected'"
      class="fixed top-20 left-4 right-4 max-w-md mx-auto z-50"
    >
      <div
        class="bg-ios-orange/15 text-ios-orange px-4 py-2.5 rounded-2xl shadow-card-sm text-sm font-medium flex items-center space-x-2"
      >
        <div class="animate-pulse w-2 h-2 bg-ios-orange rounded-full" />
        <span>{{ getConnectionMessage(connectionStatus) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { useToast } from "vue-toastification";
import { useWebSocket } from "@/composables/useWebSocket";
import { useI18n } from "@/composables/useI18n";
import TimelineItem from "@/components/TimelineItem.vue";
import OrderItemCard from "@/components/OrderItemCard.vue";
import ConfirmationModal from "@/components/ConfirmationModal.vue";
import OrderReviewSection from "@/components/reviews/OrderReviewSection.vue";
import { orderApi } from "@/services/orderApi";
import { hasCustomerAccessToken } from "@/services/customerAccessToken";
import { formatDateTime } from "@/utils/format";
import { useCurrency } from "@/composables/useCurrency";
import { isRecord } from "@/utils/unknown";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import {
  ClockIcon,
  CheckCircleIcon,
  FireIcon,
  TruckIcon,
  XCircleIcon,
} from "@heroicons/vue/24/outline";
import {
  RealtimeEventType,
  type OrderStatus,
  type RealtimeEvent,
} from "@makanmasak/shared-types";

const props = defineProps<{
  restaurantId: string;
  tableId: number;
  orderId: string;
}>();

const router = useRouter();
const toast = useToast();
const { t, tWithParams } = useI18n();
const { formatPrice } = useCurrency();
const queryClient = useQueryClient();

const showCancelConfirmation = ref(false);
const guestRealtimeCacheKey = `makanmakan_guest_realtime_token:${props.restaurantId}:${props.tableId}:${props.orderId}`;
const guestQrCacheKey = `makanmakan_table_qr:${props.restaurantId}:${props.tableId}`;
const shouldUseGuestRealtime = computed(() => {
  const hasCustomerToken = hasCustomerAccessToken();
  const hasGuestToken = !!localStorage.getItem("guest_auth_token");
  return !hasCustomerToken && hasGuestToken;
});

const readGuestRealtimeCache = () => {
  const raw = localStorage.getItem(guestRealtimeCacheKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      token: string;
      expiresAt: string;
      wsUrl?: string;
    };
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(guestRealtimeCacheKey);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(guestRealtimeCacheKey);
    return null;
  }
};

const clearGuestRealtimeCache = () => {
  localStorage.removeItem(guestRealtimeCacheKey);
};

const getGuestRealtimeUrl = async () => {
  const cached = readGuestRealtimeCache();
  if (cached?.wsUrl) {
    return cached.wsUrl;
  }

  const qrCode = localStorage.getItem(guestQrCacheKey);
  if (!qrCode) {
    throw new Error("Missing signed table QR code");
  }

  const response = await orderApi.getGuestRealtimeToken({
    restaurantId: props.restaurantId,
    tableId: String(props.tableId),
    orderId: String(props.orderId),
    qrCode,
  });

  localStorage.setItem(
    guestRealtimeCacheKey,
    JSON.stringify({
      token: response.token,
      expiresAt: response.expiresAt,
      wsUrl: response.wsUrl,
    }),
  );

  return response.wsUrl;
};

const handleWebSocketMessage = (message: RealtimeEvent) => {
  if (message.type !== RealtimeEventType.ORDER_STATUS_UPDATE) {
    return;
  }

  if (message.data.orderId !== props.orderId) {
    return;
  }

  queryClient.setQueryData(["order", props.orderId], (current: unknown) => {
    if (!isRecord(current)) {
      return current;
    }

    return {
      ...current,
      status: message.data.status,
      updatedAt: new Date(message.timestamp).toISOString(),
    };
  });

  toast.info(
    tWithParams("toast.orderStatusUpdated", {
      status: getStatusTitle(message.data.status as OrderStatus),
    }),
  );
};

const { connectionStatus, connect, disconnect } = useWebSocket({
  getUrl: getGuestRealtimeUrl,
  onMessage: handleWebSocketMessage,
  onAuthFailure: clearGuestRealtimeCache,
});

const {
  data: order,
  isLoading,
  error,
  refetch,
} = useQuery({
  queryKey: ["order", props.orderId],
  queryFn: () => {
    const hasCustomerToken = hasCustomerAccessToken();
    const hasGuestToken = !!localStorage.getItem("guest_auth_token");

    if (!hasCustomerToken && hasGuestToken) {
      return orderApi.getGuestOrder(props.orderId);
    }
    return orderApi.getOrder(props.orderId);
  },
  refetchInterval: false,
  refetchOnWindowFocus: true,
});

const { mutate: cancelOrder } = useMutation({
  mutationFn: () => orderApi.cancelOrder(props.orderId),
  onSuccess: () => {
    toast.success(t("toast.orderCancelled"));
    refetch();
  },
  onError: (error: unknown) => {
    // ORDER_NOT_CANCELLABLE is the one outcome worth naming: the generic 409
    // copy tells the customer to refresh and try again, which will never work
    // once the kitchen has started. Everything else falls to the shared
    // status/network copy, and the server's sentence goes to the console.
    console.error("取消訂單失敗:", error);
    toast.error(
      resolveUserFacingError(error, t, {
        codeKeys: { ORDER_NOT_CANCELLABLE: "toast.orderNotCancellable" },
      }).message,
    );
  },
});

const canCancelOrder = computed(() => {
  return (
    order.value?.status === "pending" || order.value?.status === "confirmed"
  );
});

const tableNumber = computed(
  () => order.value?.table?.number ?? String(props.tableId),
);

const statusOrder = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "delivered",
  "paid",
  "refunded",
] as const;

const estimatedTime = computed(() => {
  if (
    !order.value ||
    statusOrder.indexOf(order.value.status as (typeof statusOrder)[number]) >= 3
  ) {
    return null;
  }
  return order.value.estimatedPrepTime || null;
});

const orderTimeline = computed(() => {
  if (!order.value) return [];

  const currentStepIndex = statusOrder.indexOf(
    order.value.status as (typeof statusOrder)[number],
  );

  const timeline = [
    {
      status: "pending",
      title: t("orderTracking.timeline.created"),
      description: t("orderTracking.timeline.createdDesc"),
      time: order.value.createdAt,
      completed: true,
    },
    {
      status: "confirmed",
      title: t("orderTracking.timeline.confirmed"),
      description: t("orderTracking.timeline.confirmedDesc"),
      time: order.value.confirmedAt,
      completed: currentStepIndex >= 1,
    },
    {
      status: "preparing",
      title: t("orderTracking.timeline.preparing"),
      description: t("orderTracking.timeline.preparingDesc"),
      time: null,
      completed: currentStepIndex >= 2,
    },
    {
      status: "ready",
      title: t("orderTracking.timeline.ready"),
      description: t("orderTracking.timeline.readyDesc"),
      time: order.value.readyAt,
      completed: currentStepIndex >= 3,
    },
    {
      status: "delivered",
      title: t("orderTracking.timeline.served"),
      description: t("orderTracking.timeline.servedDesc"),
      time: order.value.deliveredAt,
      completed: currentStepIndex >= 4,
    },
  ];

  if (order.value.status === "cancelled" || order.value.status === "refunded") {
    const terminalStatus = order.value.status;
    timeline.push({
      status: terminalStatus,
      title: t(`orderTracking.timeline.${terminalStatus}`),
      description: t(`orderTracking.timeline.${terminalStatus}Desc`),
      time: order.value.updatedAt,
      completed: true,
    });
  }

  return timeline;
});

const statusTitles = computed(
  (): Record<string, string> => ({
    pending: t("orderTracking.status.pending"),
    confirmed: t("orderTracking.status.confirmed"),
    preparing: t("orderTracking.status.preparing"),
    ready: t("orderTracking.status.ready"),
    delivered: t("orderTracking.status.served"),
    paid: t("orderTracking.status.paid"),
    cancelled: t("orderTracking.status.cancelled"),
    refunded: t("orderTracking.status.refunded"),
  }),
);

const statusDescriptions = computed(
  (): Record<string, string> => ({
    pending: t("orderTracking.statusDesc.pending"),
    confirmed: t("orderTracking.statusDesc.confirmed"),
    preparing: t("orderTracking.statusDesc.preparing"),
    ready: t("orderTracking.statusDesc.ready"),
    delivered: t("orderTracking.statusDesc.served"),
    paid: t("orderTracking.statusDesc.paid"),
    cancelled: t("orderTracking.statusDesc.cancelled"),
    refunded: t("orderTracking.statusDesc.refunded"),
  }),
);

const getStatusIcon = (status: OrderStatus) => {
  const icons: Record<string, unknown> = {
    pending: ClockIcon,
    confirmed: CheckCircleIcon,
    preparing: FireIcon,
    ready: CheckCircleIcon,
    delivered: TruckIcon,
    paid: CheckCircleIcon,
    cancelled: XCircleIcon,
    refunded: XCircleIcon,
  };
  return icons[status] || ClockIcon;
};

const getStatusColor = (status: OrderStatus) => {
  const colors: Record<string, { bg: string; text: string }> = {
    pending: { bg: "bg-ios-orange/15", text: "text-ios-orange" },
    confirmed: { bg: "bg-ios-blue/15", text: "text-ios-blue" },
    preparing: { bg: "bg-ios-orange/15", text: "text-ios-orange" },
    ready: { bg: "bg-ios-green/15", text: "text-ios-green" },
    delivered: { bg: "bg-ios-green/15", text: "text-ios-green" },
    paid: { bg: "bg-ios-green/15", text: "text-ios-green" },
    cancelled: { bg: "bg-ios-red/15", text: "text-ios-red" },
    refunded: { bg: "bg-ios-red/15", text: "text-ios-red" },
  };
  return colors[status] || colors.pending;
};

const getStatusTitle = (status: OrderStatus) => {
  return statusTitles.value[status] || t("orderTracking.status.unknown");
};

const getStatusDescription = (status: OrderStatus) => {
  return (
    statusDescriptions.value[status] || t("orderTracking.statusDesc.unknown")
  );
};

const getProgressPercentage = (status: OrderStatus) => {
  const percentages: Record<string, number> = {
    pending: 20,
    confirmed: 40,
    preparing: 60,
    ready: 80,
    delivered: 100,
    paid: 100,
    cancelled: 0,
    refunded: 100,
  };
  return percentages[status] ?? 0;
};

const getConnectionMessage = (status: string) => {
  const messages: Record<string, string> = {
    connecting: t("orderTracking.connecting"),
    disconnected: t("orderTracking.reconnecting"),
    error: t("orderTracking.connectionError"),
  };
  return messages[status] || t("orderTracking.connectionUnknown");
};

const handleCancelOrder = () => {
  showCancelConfirmation.value = false;
  cancelOrder();
};

onMounted(() => {
  if (shouldUseGuestRealtime.value) {
    void connect();
  }
});

onUnmounted(() => {
  disconnect();
});
</script>
