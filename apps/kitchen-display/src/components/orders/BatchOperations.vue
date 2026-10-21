<template>
  <!-- Floating Bottom Bar -->
  <Transition name="slide-up">
    <div
      v-if="selectedOrdersCount > 0"
      class="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl rounded-t-2xl shadow-card-lg px-5 py-3 z-40"
    >
      <div class="flex items-center justify-between gap-3">
        <!-- Left: Selection Count -->
        <div class="flex items-center gap-2 shrink-0">
          <span
            class="bg-ios-blue text-white rounded-full min-w-6 h-6 px-2 text-xs font-bold inline-flex items-center justify-center"
          >
            {{ selectedOrdersCount }}
          </span>
          <span class="text-sm text-ios-secondary font-medium">{{
            t("batch.selected")
          }}</span>
        </div>

        <!-- Right: Action Pills -->
        <div class="flex items-center gap-2 flex-wrap justify-end">
          <!-- Processing Indicator -->
          <div
            v-if="isProcessing"
            class="flex items-center gap-1.5 text-ios-blue"
          >
            <Loader2Icon class="w-4 h-4 animate-spin" />
            <span class="text-xs font-medium">{{
              t("common.processing")
            }}</span>
          </div>

          <!-- Start Cooking -->
          <button
            v-if="canBatchStartCooking(selectedOrders)"
            :disabled="isProcessing"
            class="bg-ios-blue text-white rounded-full px-4 py-2.5 text-sm font-bold min-h-[44px] disabled:opacity-50 active:scale-95 transition-transform"
            @click="confirmBatchStart"
          >
            {{ t("batch.startAll") }}
          </button>

          <!-- Mark Ready -->
          <button
            v-if="canBatchMarkReady(selectedOrders)"
            :disabled="isProcessing"
            class="bg-ios-green text-white rounded-full px-4 py-2.5 text-sm font-bold min-h-[44px] disabled:opacity-50 active:scale-95 transition-transform"
            @click="confirmBatchReady"
          >
            {{ t("batch.completeAll") }}
          </button>

          <!-- Priority Adjust -->
          <div ref="priorityMenuRef" class="relative">
            <button
              :disabled="isProcessing"
              class="bg-ios-orange text-white rounded-full px-4 py-2.5 text-sm font-bold min-h-[44px] flex items-center gap-1.5 disabled:opacity-50 active:scale-95 transition-transform"
              @click="showPriorityMenu = !showPriorityMenu"
            >
              <AlertTriangle class="w-4 h-4" />
              <span>{{ t("batch.adjustPriority") }}</span>
              <ChevronDownIcon class="w-3.5 h-3.5" />
            </button>

            <!-- Priority Dropdown -->
            <Transition name="fade">
              <div
                v-if="showPriorityMenu"
                class="absolute bottom-full mb-2 right-0 bg-white rounded-2xl shadow-card-lg overflow-hidden min-w-[140px]"
              >
                <button
                  class="w-full text-left px-4 py-3 text-sm font-medium text-ios-red hover:bg-ios-bg transition-colors"
                  @click="setBatchPriority('urgent')"
                >
                  {{ t("batch.setUrgent") }}
                </button>
                <button
                  class="w-full text-left px-4 py-3 text-sm font-medium text-ios-orange hover:bg-ios-bg transition-colors"
                  @click="setBatchPriority('high')"
                >
                  {{ t("batch.setImportant") }}
                </button>
                <button
                  class="w-full text-left px-4 py-3 text-sm font-medium text-ios-secondary hover:bg-ios-bg transition-colors"
                  @click="setBatchPriority('normal')"
                >
                  {{ t("batch.setNormal") }}
                </button>
              </div>
            </Transition>
          </div>

          <!-- Deselect -->
          <button
            class="text-ios-secondary text-sm font-medium min-h-[44px] px-2 active:opacity-60 transition-opacity"
            @click="deselectAll"
          >
            {{ t("batch.cancelSelection") }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Confirmation Modal -->
  <Transition name="fade">
    <div
      v-if="showConfirmation"
      class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
      @click="cancelConfirmation"
    >
      <div
        class="bg-white rounded-2xl shadow-card-lg max-w-sm w-full mx-4 p-6"
        @click.stop
      >
        <div class="text-center mb-5">
          <div
            class="w-12 h-12 bg-ios-blue/10 rounded-full flex items-center justify-center mx-auto mb-3"
          >
            <AlertTriangle class="w-6 h-6 text-ios-blue" />
          </div>
          <h3 class="text-lg font-extrabold text-ios-text mb-2">
            {{ t("batch.confirmTitle") }}
          </h3>
          <p class="text-sm text-ios-secondary">{{ confirmationMessage }}</p>
        </div>

        <div class="flex gap-3">
          <button
            class="flex-1 px-4 py-2.5 bg-ios-bg text-ios-text rounded-full text-sm font-bold min-h-[44px] active:scale-95 transition-transform"
            @click="cancelConfirmation"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            class="flex-1 px-4 py-2.5 bg-ios-blue text-white rounded-full text-sm font-bold min-h-[44px] active:scale-95 transition-transform"
            @click="executeBatchOperation"
          >
            {{ t("batch.confirmExecute") }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { onClickOutside } from "@vueuse/core";
import { Loader2Icon, AlertTriangle, ChevronDownIcon } from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useOrderManagementStore } from "@/stores/orderManagement";
import { useToast } from "vue-toastification";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const { t } = useI18n();
import { storeToRefs } from "pinia";
import type { KitchenOrder } from "@/types";

// Props
interface Props {
  orders: KitchenOrder[];
  pendingOrders: KitchenOrder[];
  preparingOrders: KitchenOrder[];
  readyOrders: KitchenOrder[];
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  "batch-start-cooking": [orderIds: Array<string | number>];
  "batch-mark-ready": [orderIds: Array<string | number>];
  "batch-priority-update": [orderIds: Array<string | number>, priority: string];
  "batch-export": [orderIds: Array<string | number>];
}>();

const toast = useToast();

// Order Management Store
const orderManagementStore = useOrderManagementStore();
const { selectedOrdersCount } = storeToRefs(orderManagementStore);

const {
  getBatchOperationSummary,
  canBatchStartCooking,
  canBatchMarkReady,
  getSelectedOrdersData,
} = orderManagementStore;

const { deselectAll } = orderManagementStore;

// Local State
const isProcessing = ref(false);
const showPriorityMenu = ref(false);
const showConfirmation = ref(false);
const confirmationMessage = ref("");
const pendingOperation = ref<(() => void) | null>(null);

// Computed
const selectedOrders = computed(() => getSelectedOrdersData(props.orders));
const batchSummary = computed(() =>
  getBatchOperationSummary(selectedOrders.value),
);

// Methods
const confirmBatchStart = () => {
  confirmationMessage.value = t("batch.confirmStartMsg", {
    orderCount: selectedOrdersCount.value,
    itemCount: batchSummary.value.pendingItems,
  });
  pendingOperation.value = executeBatchStart;
  showConfirmation.value = true;
};

const confirmBatchReady = () => {
  confirmationMessage.value = t("batch.confirmCompleteMsg", {
    orderCount: selectedOrdersCount.value,
    itemCount: batchSummary.value.preparingItems,
  });
  pendingOperation.value = executeBatchReady;
  showConfirmation.value = true;
};

const executeBatchStart = async () => {
  isProcessing.value = true;
  showConfirmation.value = false;

  try {
    const selectedOrderIds = selectedOrders.value.map((order) => order.id);
    emit("batch-start-cooking", selectedOrderIds);

    toast.success(
      t("batch.startSuccess", { count: batchSummary.value.pendingItems }),
    );
    deselectAll();
  } catch (error: unknown) {
    toast.error(
      `${t("batch.startFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  } finally {
    isProcessing.value = false;
    pendingOperation.value = null;
  }
};

const executeBatchReady = async () => {
  isProcessing.value = true;
  showConfirmation.value = false;

  try {
    const selectedOrderIds = selectedOrders.value.map((order) => order.id);
    emit("batch-mark-ready", selectedOrderIds);

    toast.success(
      t("batch.completeSuccess", { count: batchSummary.value.preparingItems }),
    );
    deselectAll();
  } catch (error: unknown) {
    toast.error(
      `${t("batch.completeFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  } finally {
    isProcessing.value = false;
    pendingOperation.value = null;
  }
};

const setBatchPriority = async (priority: "urgent" | "high" | "normal") => {
  showPriorityMenu.value = false;
  isProcessing.value = true;

  try {
    const selectedOrderIds = selectedOrders.value.map((order) => order.id);
    emit("batch-priority-update", selectedOrderIds, priority);

    const priorityText = {
      urgent: t("common.urgent"),
      high: t("common.important"),
      normal: t("common.normal"),
    }[priority];
    toast.success(
      t("batch.priorityChanged", {
        count: selectedOrderIds.length,
        priority: priorityText,
      }),
    );
    deselectAll();
  } catch (error: unknown) {
    toast.error(
      `${t("batch.priorityFailed")}：${resolveUserFacingError(error, t).message}`,
    );
  } finally {
    isProcessing.value = false;
  }
};

const executeBatchOperation = () => {
  if (pendingOperation.value) {
    pendingOperation.value();
  }
};

const cancelConfirmation = () => {
  showConfirmation.value = false;
  pendingOperation.value = null;
};

// Close priority menu when clicking outside
const priorityMenuRef = ref<HTMLElement>();
onClickOutside(priorityMenuRef, () => {
  showPriorityMenu.value = false;
});
</script>

<style scoped>
/* Slide-up animation */
.slide-up-enter-active {
  transition:
    transform 300ms ease-out,
    opacity 300ms ease-out;
}

.slide-up-leave-active {
  transition:
    transform 200ms ease-in,
    opacity 200ms ease-in;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

/* Fade animation */
.fade-enter-active {
  transition: opacity 200ms ease-out;
}

.fade-leave-active {
  transition: opacity 150ms ease-in;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
