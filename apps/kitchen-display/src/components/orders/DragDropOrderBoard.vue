<template>
  <div class="drag-drop-board grid grid-cols-1 gap-3 md:grid-cols-3 h-full">
    <div class="grid grid-cols-3 gap-2 md:hidden">
      <button
        type="button"
        class="min-h-[44px] rounded-xl px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-orange"
        :class="
          selectedStatus === 'pending'
            ? 'bg-ios-orange text-white'
            : 'bg-white text-ios-text shadow-card-sm'
        "
        :aria-pressed="selectedStatus === 'pending'"
        @click="selectedStatus = 'pending'"
      >
        {{ t("kanban.pendingColumn") }} {{ pendingOrders.length }}
      </button>
      <button
        type="button"
        class="min-h-[44px] rounded-xl px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
        :class="
          selectedStatus === 'preparing'
            ? 'bg-ios-blue text-white'
            : 'bg-white text-ios-text shadow-card-sm'
        "
        :aria-pressed="selectedStatus === 'preparing'"
        @click="selectedStatus = 'preparing'"
      >
        {{ t("kanban.preparingColumn") }} {{ preparingOrders.length }}
      </button>
      <button
        type="button"
        class="min-h-[44px] rounded-xl px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-green"
        :class="
          selectedStatus === 'ready'
            ? 'bg-ios-green text-white'
            : 'bg-white text-ios-text shadow-card-sm'
        "
        :aria-pressed="selectedStatus === 'ready'"
        @click="selectedStatus = 'ready'"
      >
        {{ t("kanban.readyColumn") }} {{ readyOrders.length }}
      </button>
    </div>

    <!-- Pending Orders Column -->
    <div
      :class="selectedStatus !== 'pending' && 'hidden md:flex'"
      class="order-column flex flex-col rounded-2xl p-3 bg-[rgba(255,149,0,0.06)]"
    >
      <div class="column-header flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-ios-orange" />
          <span class="text-sm font-bold text-ios-text">{{
            t("kanban.pendingColumn")
          }}</span>
        </div>
        <span
          class="min-w-6 h-6 rounded-full bg-ios-orange text-white text-xs font-bold flex items-center justify-center px-1.5"
        >
          {{ pendingOrders.length }}
        </span>
      </div>

      <div
        ref="pendingColumn"
        :class="[
          'order-list flex-1 space-y-2 min-h-24 p-1 rounded-xl transition-colors overflow-y-auto',
          {
            'ring-2 ring-ios-orange ring-opacity-40 bg-[rgba(255,149,0,0.04)]':
              dragOverColumn === 'pending',
          },
        ]"
        data-status="pending"
      >
        <DraggableOrderCard
          v-for="order in pendingOrders"
          :key="`pending-${order.id}`"
          :order="order"
          status-type="pending"
          :is-dragging="draggedOrderId === order.id"
          :is-drag-over="dragOverColumn === 'pending'"
          :is-selected="isOrderSelected(order.id)"
          @start-cooking="handleStartCooking"
          @mark-ready="handleMarkReady"
          @view-details="handleViewDetails"
          @toggle-selection="handleToggleSelection"
        />

        <div
          v-if="pendingOrders.length === 0"
          class="empty-state text-center py-8 text-ios-label-secondary"
        >
          <Clock class="w-10 h-10 mx-auto mb-2 text-ios-orange opacity-30" />
          <p class="text-sm">{{ t("kanban.pendingEmpty") }}</p>
          <p class="text-xs mt-1 opacity-60">
            {{ t("kanban.pendingEmptyHint") }}
          </p>
        </div>
      </div>
    </div>

    <!-- Preparing Orders Column -->
    <div
      :class="selectedStatus !== 'preparing' && 'hidden md:flex'"
      class="order-column flex flex-col rounded-2xl p-3 bg-[rgba(0,122,255,0.04)]"
    >
      <div class="column-header flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-ios-blue" />
          <span class="text-sm font-bold text-ios-text">{{
            t("kanban.preparingColumn")
          }}</span>
        </div>
        <span
          class="min-w-6 h-6 rounded-full bg-ios-blue text-white text-xs font-bold flex items-center justify-center px-1.5"
        >
          {{ preparingOrders.length }}
        </span>
      </div>

      <div
        ref="preparingColumn"
        :class="[
          'order-list flex-1 space-y-2 min-h-24 p-1 rounded-xl transition-colors overflow-y-auto',
          {
            'ring-2 ring-ios-blue ring-opacity-40 bg-[rgba(0,122,255,0.04)]':
              dragOverColumn === 'preparing',
          },
        ]"
        data-status="preparing"
      >
        <DraggableOrderCard
          v-for="order in preparingOrders"
          :key="`preparing-${order.id}`"
          :order="order"
          status-type="preparing"
          :is-dragging="draggedOrderId === order.id"
          :is-drag-over="dragOverColumn === 'preparing'"
          :is-selected="isOrderSelected(order.id)"
          @start-cooking="handleStartCooking"
          @mark-ready="handleMarkReady"
          @view-details="handleViewDetails"
          @toggle-selection="handleToggleSelection"
        />

        <div
          v-if="preparingOrders.length === 0"
          class="empty-state text-center py-8 text-ios-label-secondary"
        >
          <Flame class="w-10 h-10 mx-auto mb-2 text-ios-blue opacity-30" />
          <p class="text-sm">{{ t("kanban.preparingEmpty") }}</p>
          <p class="text-xs mt-1 opacity-60">
            {{ t("kanban.preparingEmptyHint") }}
          </p>
        </div>
      </div>
    </div>

    <!-- Ready Orders Column -->
    <div
      :class="selectedStatus !== 'ready' && 'hidden md:flex'"
      class="order-column flex flex-col rounded-2xl p-3 bg-[rgba(52,199,89,0.04)]"
    >
      <div class="column-header flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-ios-green" />
          <span class="text-sm font-bold text-ios-text">{{
            t("kanban.readyColumn")
          }}</span>
        </div>
        <span
          class="min-w-6 h-6 rounded-full bg-ios-green text-white text-xs font-bold flex items-center justify-center px-1.5"
        >
          {{ readyOrders.length }}
        </span>
      </div>

      <div
        ref="readyColumn"
        :class="[
          'order-list flex-1 space-y-2 min-h-24 p-1 rounded-xl transition-colors overflow-y-auto',
          {
            'ring-2 ring-ios-green ring-opacity-40 bg-[rgba(52,199,89,0.04)]':
              dragOverColumn === 'ready',
          },
        ]"
        data-status="ready"
      >
        <DraggableOrderCard
          v-for="order in readyOrders"
          :key="`ready-${order.id}`"
          :order="order"
          status-type="ready"
          :is-dragging="draggedOrderId === order.id"
          :is-drag-over="dragOverColumn === 'ready'"
          :is-selected="isOrderSelected(order.id)"
          @start-cooking="handleStartCooking"
          @mark-ready="handleMarkReady"
          @view-details="handleViewDetails"
          @toggle-selection="handleToggleSelection"
        />

        <div
          v-if="readyOrders.length === 0"
          class="empty-state text-center py-8 text-ios-label-secondary"
        >
          <CheckCircle
            class="w-10 h-10 mx-auto mb-2 text-ios-green opacity-30"
          />
          <p class="text-sm">{{ t("kanban.readyEmpty") }}</p>
          <p class="text-xs mt-1 opacity-60">
            {{ t("kanban.readyEmptyHint") }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import { useSortable } from "@vueuse/integrations/useSortable";
import { useToast } from "vue-toastification";
import { Clock, Flame, CheckCircle } from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const { t } = useI18n();
import { useOrderManagementStore } from "@/stores/orderManagement";
import type { KitchenOrder } from "@/types";
import DraggableOrderCard from "./DraggableOrderCard.vue";

type BoardOrderStatus = "pending" | "preparing" | "ready";

// Props
interface Props {
  pendingOrders: KitchenOrder[];
  preparingOrders: KitchenOrder[];
  readyOrders: KitchenOrder[];
}

defineProps<Props>();

// Emits
const emit = defineEmits<{
  "start-cooking": [orderId: number, itemId: number];
  "mark-ready": [orderId: number, itemId: number];
  "view-details": [order: KitchenOrder];
  "order-status-changed": [orderId: number, newStatus: BoardOrderStatus];
  "batch-start-order": [orderId: number];
  "batch-complete-order": [orderId: number];
  "toggle-selection": [orderId: number];
}>();

const toast = useToast();
const selectedStatus = ref<BoardOrderStatus>("pending");

// Order Management Store
const orderManagementStore = useOrderManagementStore();
const { isOrderSelected, toggleOrderSelection } = orderManagementStore;

// State
const pendingColumn = ref<HTMLElement>();
const preparingColumn = ref<HTMLElement>();
const readyColumn = ref<HTMLElement>();
const draggedOrderId = ref<number | null>(null);
const dragOverColumn = ref<string | null>(null);

// Drag and Drop Setup
const setupSortable = () => {
  if (!pendingColumn.value || !preparingColumn.value || !readyColumn.value)
    return;

  const columns = [
    { element: pendingColumn.value, status: "pending" },
    { element: preparingColumn.value, status: "preparing" },
    { element: readyColumn.value, status: "ready" },
  ];

  columns.forEach(({ element, status: _status }) => {
    useSortable(element, [], {
      group: "kitchen-orders",
      animation: 200,
      ghostClass: "sortable-ghost",
      dragClass: "sortable-drag",
      chosenClass: "sortable-chosen",
      forceFallback: true,
      fallbackClass: "sortable-fallback",

      onStart: (evt) => {
        const orderId = Number(evt.item.dataset.orderId);
        draggedOrderId.value = orderId;
        document.body.classList.add("dragging-order");
      },

      onEnd: (evt) => {
        draggedOrderId.value = null;
        dragOverColumn.value = null;
        document.body.classList.remove("dragging-order");

        const orderId = Number(evt.item.dataset.orderId);
        const newStatus = evt.to.dataset.status as
          | "pending"
          | "preparing"
          | "ready";
        const oldStatus = evt.from.dataset.status as
          | "pending"
          | "preparing"
          | "ready";

        if (newStatus !== oldStatus && orderId) {
          handleStatusChange(orderId, newStatus, oldStatus);
        }
      },

      onMove: (evt) => {
        const targetStatus = evt.to.dataset.status;
        dragOverColumn.value = targetStatus || null;
        return true;
      },
    });
  });
};

// Methods
const handleStatusChange = async (
  orderId: number,
  newStatus: BoardOrderStatus,
  oldStatus: BoardOrderStatus,
) => {
  try {
    emit("order-status-changed", orderId, newStatus);

    if (oldStatus === "pending" && newStatus === "preparing") {
      emit("batch-start-order", orderId);
      toast.success(t("kanban.orderStarted"));
    } else if (oldStatus === "preparing" && newStatus === "ready") {
      emit("batch-complete-order", orderId);
      toast.success(t("kanban.orderCompleted"));
    } else if (oldStatus === "ready" && newStatus === "preparing") {
      toast.info(t("kanban.orderMovedToPreparing"));
    } else if (oldStatus === "preparing" && newStatus === "pending") {
      toast.info(t("kanban.orderMovedToPending"));
    }
  } catch (error: unknown) {
    console.error("Status change failed:", error);
    toast.error(
      `${t("kanban.statusUpdateFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  }
};

const handleStartCooking = (orderId: number, itemId: number) => {
  emit("start-cooking", orderId, itemId);
};

const handleMarkReady = (orderId: number, itemId: number) => {
  emit("mark-ready", orderId, itemId);
};

const handleViewDetails = (order: KitchenOrder) => {
  emit("view-details", order);
};

const handleToggleSelection = (orderId: number) => {
  toggleOrderSelection(orderId);
  emit("toggle-selection", orderId);
};

// Lifecycle
onMounted(async () => {
  await nextTick();
  setupSortable();
});
</script>

<style scoped>
.drag-drop-board {
  min-height: 600px;
}

.order-column {
  min-width: 0;
}

.order-list {
  max-height: 70vh;
}

@media (max-width: 767px) {
  .drag-drop-board {
    min-height: 0;
  }

  .order-list {
    max-height: none;
  }
}

/* Custom scrollbar */
.order-list::-webkit-scrollbar {
  width: 4px;
}

.order-list::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 2px;
}

.order-list::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.4);
  border-radius: 2px;
}

.order-list::-webkit-scrollbar-thumb:hover {
  background: rgba(156, 163, 175, 0.6);
}

/* Global drag styles */
:global(body.dragging-order) {
  cursor: grabbing !important;
}

:global(body.dragging-order *) {
  cursor: grabbing !important;
}

/* Sortable styles */
:global(.sortable-ghost) {
  opacity: 0.4;
  background: rgba(0, 122, 255, 0.08);
  border: 2px dashed rgba(0, 122, 255, 0.4);
  border-radius: 16px;
}

:global(.sortable-drag) {
  opacity: 1;
  transform: rotate(2deg) scale(1.02);
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.12),
    0 8px 16px rgba(0, 0, 0, 0.06);
}

:global(.sortable-chosen) {
  cursor: grabbing;
}

:global(.sortable-fallback) {
  opacity: 0.85;
}
</style>
