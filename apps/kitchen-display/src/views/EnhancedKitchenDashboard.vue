<template>
  <div class="bg-ios-bg min-h-screen" data-testid="kitchen-dashboard">
    <!-- Kitchen Header (fixed top) -->
    <KitchenHeader
      :restaurant-name="restaurantName"
      :current-time="currentTime"
      :stats="stats"
      :connection-status="realtimeConnectionStatus"
      :is-connected="isRealtimeConnected"
      :view-mode="viewMode"
      @logout="handleLogout"
      @refresh="handleRefresh"
      @reconnect="reconnectRealtime"
      @toggle-fullscreen="toggleFullscreen"
      @open-my-shifts="handleOpenMyShifts"
      @open-settings="handleOpenSettings"
      @update:view-mode="setViewMode"
    />

    <!-- Main Content (offset for fixed header) -->
    <main class="px-5 pb-6 pt-32 lg:pt-20">
      <OfflineStatus class="mb-4" />

      <!-- Stats Bar -->
      <div class="mb-5">
        <OrderStats
          :stats="stats"
          :loading="isLoading"
          @refresh="handleRefresh"
        />
      </div>

      <!-- Kanban Mode: KanbanBoard -->
      <KanbanBoard
        v-if="viewMode === 'kanban'"
        :pending-orders="filteredPendingOrders"
        :preparing-orders="filteredPreparingOrders"
        :ready-orders="filteredReadyOrders"
        @start-cooking="handleStartCooking"
        @mark-ready="handleMarkReady"
        @view-details="handleViewDetails"
        @order-status-changed="handleOrderStatusChanged"
        @batch-start-order="handleBatchStartOrder"
        @batch-complete-order="handleBatchCompleteOrder"
      />

      <!-- Grid Mode: Filters + Responsive Card Grid -->
      <template v-else>
        <div class="mb-4">
          <OrderFilters
            :orders="orders"
            :filtered-count="filteredOrders.length"
          />
        </div>

        <!-- Empty State -->
        <div
          v-if="filteredOrders.length === 0 && !isLoading"
          class="flex flex-col items-center justify-center py-20 text-center"
        >
          <div
            class="w-16 h-16 bg-white rounded-full shadow-card flex items-center justify-center mb-4"
          >
            <ClipboardList class="w-8 h-8 text-ios-secondary" />
          </div>
          <p class="text-ios-text font-semibold text-lg mb-1">
            {{ t("kitchen.noOrders") }}
          </p>
          <p class="text-ios-secondary text-sm">
            {{ t("kitchen.newOrdersHint") }}
          </p>
        </div>

        <!-- Order Cards Grid -->
        <div
          v-else
          class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3"
        >
          <OrderCard
            v-for="order in filteredOrders"
            :key="order.id"
            :order="order"
            :status-type="getOrderStatusType(order.status)"
            @start-cooking="handleStartCooking"
            @mark-ready="handleMarkReady"
            @view-details="handleViewDetails"
          />
        </div>
      </template>

      <!-- Loading Overlay -->
      <div
        v-if="isLoading && orders.length === 0"
        class="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50"
      >
        <div class="text-center">
          <div class="loading-spinner w-12 h-12 mx-auto mb-4" />
          <p class="text-base font-medium text-ios-secondary">
            {{ t("kitchen.loadingOrders") }}
          </p>
        </div>
      </div>
    </main>

    <!-- Order Details Modal -->
    <OrderDetailsModal
      v-if="selectedOrder"
      :order="selectedOrder"
      :show="showDetailsModal"
      @close="showDetailsModal = false"
      @update-status="handleUpdateOrderStatus"
    />

    <!-- Connection Status Monitor -->
    <ConnectionStatus
      :connection-status="realtimeConnectionStatus"
      :is-connected="isRealtimeConnected"
      :reconnect-attempts="0"
      :last-heartbeat="null"
      @reconnect="reconnectRealtime"
      @refresh="handleRefresh"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { useToast } from "vue-toastification";
import { ClipboardList } from "lucide-vue-next";
import { RealtimeEventType } from "@makanmasak/shared-types";
import type { RealtimeEvent } from "@makanmasak/shared-types";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useI18n } from "@/i18n";
import { useOrdersStore } from "@/stores/orders";
import { useOrderManagementStore } from "@/stores/orderManagement";
import { useAudioNotifications } from "@/composables/useAudioNotifications";
import { useKitchenRealtimeService } from "@/services/realtimeService";
import type {
  ItemStatus,
  KitchenOrder,
  KitchenSSEEvent,
  OrderStatus,
} from "@/types";

// Components
import KitchenHeader from "@/components/layout/KitchenHeader.vue";
import OrderStats from "@/components/stats/OrderStats.vue";
import OrderCard from "@/components/orders/OrderCard.vue";
import OrderFilters from "@/components/orders/OrderFilters.vue";
import KanbanBoard from "@/components/orders/KanbanBoard.vue";
import OrderDetailsModal from "@/components/orders/OrderDetailsModal.vue";
import ConnectionStatus from "@/components/common/ConnectionStatus.vue";
import OfflineStatus from "@/components/offline/OfflineStatus.vue";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

// Props
const props = defineProps<{
  restaurantId: string;
}>();

// Numeric restaurantId (router params are always strings)
// restaurantId is a UUID string — keep as string for comparison
const restaurantIdNum = computed(() => props.restaurantId);

// Composables
const router = useRouter();
const toast = useToast();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const { t } = useI18n();
const ordersStore = useOrdersStore();
const orderManagementStore = useOrderManagementStore();
const kitchenRealtime = useKitchenRealtimeService();
const audioNotifications = useAudioNotifications();

const handleRealtimeOrderEvent = (event: KitchenSSEEvent) => {
  ordersStore.handleSSEEvent(event);
  void audioNotifications.handleSSEEvent(event);
};

// State
const currentTime = ref(new Date());
const selectedOrder = ref<KitchenOrder | null>(null);
const showDetailsModal = ref(false);
const viewMode = ref<"kanban" | "grid">("kanban");

// Computed
const restaurantName = computed(
  () => authStore.user?.name || t("kitchen.systemName"),
);

const {
  orders,
  stats,
  loading: isLoading,
  error: ordersError,
} = storeToRefs(ordersStore);

const { filterOrders, sortOrders, updateOrderPriorities } =
  orderManagementStore;

const filteredOrders = computed(() => {
  let filtered = filterOrders(orders.value);
  filtered = sortOrders(filtered);
  return updateOrderPriorities(filtered);
});

const filteredPendingOrders = computed(() =>
  filteredOrders.value.filter((order) => order.status === "confirmed"),
);

const filteredPreparingOrders = computed(() =>
  filteredOrders.value.filter((order) => order.status === "preparing"),
);

const filteredReadyOrders = computed(() =>
  filteredOrders.value.filter((order) => order.status === "ready"),
);

type RealtimeDisplayStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error";

const realtimeConnectionStatus = computed<RealtimeDisplayStatus>(() => {
  switch (kitchenRealtime.status.value) {
    case "connected":
      return "connected";
    case "connecting":
    case "reconnecting":
      return "connecting";
    case "error":
      return "error";
    default:
      return "disconnected";
  }
});

const isRealtimeConnected = computed(() => kitchenRealtime.isConnected.value);

// Helpers
const getOrderStatusType = (
  status: OrderStatus,
): "pending" | "preparing" | "ready" => {
  if (status === "preparing") return "preparing";
  if (status === "ready") return "ready";
  return "pending";
};

// Methods
const setViewMode = (mode: "kanban" | "grid") => {
  viewMode.value = mode;
  localStorage.setItem("kitchen-view-mode", mode);
};

const fetchOrders = async () => {
  try {
    await ordersStore.fetchOrders(restaurantIdNum.value);
    if (ordersError.value) {
      toast.error(t("kitchen.loadOrdersFailed") + ordersError.value);
    }
  } catch (error: unknown) {
    console.error("Failed to fetch orders:", error);
    toast.error(
      `${t("kitchen.loadOrdersFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  }
};

const handleStartCooking = async (orderId: number, itemId: number) => {
  try {
    await ordersStore.startCooking(restaurantIdNum.value, orderId, itemId);
    await audioNotifications.handleOrderStartCooking();
    toast.success(t("kitchen.startedPreparing"));
  } catch (error: unknown) {
    toast.error(
      `${t("kitchen.operationFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  }
};

const handleMarkReady = async (orderId: number, itemId: number) => {
  try {
    await ordersStore.markReady(restaurantIdNum.value, orderId, itemId);
    await audioNotifications.handleOrderMarkReady();
    toast.success(t("kitchen.orderCompleted"));
  } catch (error: unknown) {
    toast.error(
      `${t("kitchen.operationFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  }
};

const handleViewDetails = (order: KitchenOrder) => {
  selectedOrder.value = order;
  showDetailsModal.value = true;
};

const handleOrderStatusChanged = async (
  _orderId: number,
  _newStatus: "pending" | "preparing" | "ready",
) => {
  try {
    await fetchOrders();
  } catch (error: unknown) {
    toast.error(
      `${t("kitchen.statusUpdateFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  }
};

const handleBatchStartOrder = async (orderId: number) => {
  try {
    const order = orders.value.find((o) => o.id === orderId);
    if (!order) return;
    for (const item of order.items) {
      if (item.status === "pending") {
        await ordersStore.startCooking(restaurantIdNum.value, orderId, item.id);
      }
    }
    await fetchOrders();
  } catch (error: unknown) {
    toast.error(
      `${t("kitchen.batchStartFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  }
};

const handleBatchCompleteOrder = async (orderId: number) => {
  try {
    const order = orders.value.find((o) => o.id === orderId);
    if (!order) return;
    for (const item of order.items) {
      if (item.status === "preparing") {
        await ordersStore.markReady(restaurantIdNum.value, orderId, item.id);
      }
    }
    await fetchOrders();
  } catch (error: unknown) {
    toast.error(
      `${t("kitchen.batchCompleteFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  }
};

const handleUpdateOrderStatus = async (
  orderId: number,
  itemId: number,
  status: ItemStatus,
) => {
  try {
    if (status === "preparing") {
      await ordersStore.startCooking(restaurantIdNum.value, orderId, itemId);
    } else if (status === "ready") {
      await ordersStore.markReady(restaurantIdNum.value, orderId, itemId);
    }

    await fetchOrders();
  } catch (error: unknown) {
    toast.error(
      `${t("kitchen.updateStatusFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  }
};

const handleLogout = async () => {
  try {
    await authStore.logout();
    await router.push("/login");
    toast.success(t("kitchen.loggedOut"));
  } catch (error: unknown) {
    toast.error(
      `${t("kitchen.logoutFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  }
};

const handleRefresh = async () => {
  await fetchOrders();
};

const reconnectRealtime = async () => {
  kitchenRealtime.disconnect();
  await kitchenRealtime.connect(restaurantIdNum.value);
};

const handleOpenMyShifts = async () => {
  await router.push("/my-shifts");
};

const handleOpenSettings = async () => {
  await router.push("/settings");
};

const toggleFullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
};

const updateCurrentTime = () => {
  currentTime.value = new Date();
};

// Auto-refresh logic
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let timeInterval: ReturnType<typeof setInterval> | null = null;
let realtimeSubscriptionId: string | null = null;

const startAutoRefresh = () => {
  if (settingsStore.autoRefresh && refreshInterval === null) {
    refreshInterval = setInterval(() => {
      fetchOrders();
    }, settingsStore.refreshInterval * 1000);
  }
};

const stopAutoRefresh = () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
};

// Adapter: the WebSocket realtimeService delivers the shared RealtimeEvent,
// while the orders store consumes the kitchen's legacy KitchenSSEEvent shape.
// Map explicitly (data/timestamp/type are what the store reads) instead of
// casting the whole object through `unknown`. The type field is narrowed to
// the KitchenSSEEvent union — safe because we only subscribe to the matching
// order event types below.
const toKitchenSSEEvent = (event: RealtimeEvent): KitchenSSEEvent => ({
  type: event.type as KitchenSSEEvent["type"],
  eventId: event.eventId,
  timestamp: event.timestamp,
  restaurantId: event.restaurantId,
  data: event.data,
});

// Lifecycle
onMounted(async () => {
  // Check authentication
  if (!authStore.isAuthenticated || !authStore.isChef) {
    await router.push("/login");
    return;
  }

  // Check restaurant permissions
  if (String(authStore.restaurantId) !== restaurantIdNum.value) {
    await router.push("/unauthorized");
    return;
  }

  // Load saved view mode preference
  const savedViewMode = localStorage.getItem("kitchen-view-mode");
  if (savedViewMode === "kanban" || savedViewMode === "grid") {
    viewMode.value = savedViewMode;
  }

  // Initial load
  await fetchOrders();

  realtimeSubscriptionId = kitchenRealtime.subscribe(
    [
      RealtimeEventType.NEW_ORDER,
      RealtimeEventType.ORDER_STATUS_UPDATE,
      RealtimeEventType.ORDER_ITEM_STATUS_UPDATE,
      RealtimeEventType.ORDER_CANCELLED,
    ],
    (event) => {
      handleRealtimeOrderEvent(toKitchenSSEEvent(event));
    },
  );
  await kitchenRealtime.connect(restaurantIdNum.value);

  // Start auto-refresh
  startAutoRefresh();

  // Start time updates
  timeInterval = setInterval(updateCurrentTime, 1000);
});

// Cleanup — registered at setup scope (NOT inside async onMounted after await,
// which would log "onUnmounted is called when there is no active component instance")
onUnmounted(() => {
  stopAutoRefresh();
  if (timeInterval) {
    clearInterval(timeInterval);
    timeInterval = null;
  }
  if (realtimeSubscriptionId) {
    kitchenRealtime.unsubscribe(realtimeSubscriptionId);
    realtimeSubscriptionId = null;
  }
  kitchenRealtime.disconnect();
});
</script>

<style scoped>
.loading-spinner {
  border: 3px solid #f2f2f7;
  border-top: 3px solid #007aff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
