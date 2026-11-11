<template>
  <Dialog
    :open="show"
    :initial-focus="loading ? dialogPanel?.$el : cancelButton"
    data-testid="confirmation-modal"
    class="customer-shell fixed inset-0 z-50 overflow-y-auto"
    @close="requestCancel"
  >
    <div
      data-testid="confirmation-backdrop"
      class="fixed inset-0 bg-black/30"
      aria-hidden="true"
    />
    <div class="relative flex min-h-full items-center justify-center p-4">
      <DialogPanel
        ref="dialogPanel"
        tabindex="-1"
        data-testid="confirmation-panel"
        class="bg-white rounded-2xl shadow-card-lg max-w-sm w-full"
      >
        <!-- 標題區域 -->
        <div class="p-6 pb-4">
          <div class="flex items-center justify-center mb-4">
            <div
              class="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center"
            >
              <svg
                class="w-6 h-6 text-ios-blue"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>

          <DialogTitle
            as="h3"
            class="text-lg font-semibold text-ios-text text-center mb-2"
          >
            {{ title }}
          </DialogTitle>

          <DialogDescription as="p" class="text-ios-secondary text-center">
            {{ message }}
          </DialogDescription>
        </div>

        <!-- 按鈕區域 -->
        <div class="p-6 pt-0 space-y-3">
          <button
            :disabled="loading"
            data-testid="confirmation-confirm"
            class="w-full bg-ios-blue disabled:bg-gray-400 text-white font-semibold py-3 px-4 rounded-full active:scale-[0.98] transition-transform duration-150 flex items-center justify-center"
            @click="$emit('confirm')"
          >
            <div
              v-if="loading"
              class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"
            />
            {{ confirmText }}
          </button>

          <button
            ref="cancelButton"
            :disabled="loading"
            data-testid="confirmation-cancel"
            class="w-full bg-gray-100 disabled:bg-gray-100 text-ios-text font-semibold py-3 px-4 rounded-full transition-transform duration-150"
            @click="requestCancel"
          >
            {{ cancelText }}
          </button>
        </div>
      </DialogPanel>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogDescription,
} from "@headlessui/vue";

const cancelButton = ref<HTMLElement | null>(null);
const dialogPanel = ref<InstanceType<typeof DialogPanel> | null>(null);

const props = defineProps<{
  show: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

function requestCancel() {
  if (!props.loading) emit("cancel");
}

// The last clicked child may be a span; restore the actual focused control.
let triggerElement: HTMLElement | null = null;
watch(
  () => props.show,
  async (show) => {
    if (show) {
      triggerElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      return;
    }
    const previousTrigger = triggerElement;
    triggerElement = null;
    await nextTick();
    if (!props.show && previousTrigger?.isConnected) {
      previousTrigger.focus({ preventScroll: true });
    }
  },
  { immediate: true },
);
</script>
