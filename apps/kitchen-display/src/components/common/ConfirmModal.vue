<template>
  <Teleport to="body">
    <TransitionRoot
      as="template"
      :show="Boolean(modalState)"
      appear
      @after-leave="restoreFocus"
    >
      <Dialog
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @close="close(false)"
      >
        <TransitionChild
          as="template"
          enter="confirm-modal-enter-active"
          enter-from="confirm-modal-enter-from"
          enter-to="opacity-100"
          leave="confirm-modal-leave-active"
          leave-from="opacity-100"
          leave-to="confirm-modal-leave-to"
        >
          <div
            class="fixed inset-0 bg-black/30 backdrop-blur-sm"
            @click="close(false)"
          />
        </TransitionChild>
        <TransitionChild
          as="template"
          enter="confirm-modal-enter-active"
          enter-from="confirm-modal-enter-from"
          enter-to="opacity-100"
          leave="confirm-modal-leave-active"
          leave-from="opacity-100"
          leave-to="confirm-modal-leave-to"
        >
          <DialogPanel
            class="relative bg-white rounded-3xl shadow-card-lg max-w-sm w-full"
          >
            <div class="p-6 text-center">
              <div
                class="mx-auto flex items-center justify-center h-12 w-12 rounded-full mb-4"
                :class="
                  displayedState?.type === 'danger'
                    ? 'bg-ios-red/10'
                    : 'bg-ios-orange/10'
                "
              >
                <AlertTriangle
                  class="h-6 w-6"
                  :class="
                    displayedState?.type === 'danger'
                      ? 'text-ios-red'
                      : 'text-ios-orange'
                  "
                />
              </div>
              <DialogTitle
                as="h3"
                class="text-[17px] font-bold text-ios-text mb-2"
              >
                {{ displayedState?.title }}
              </DialogTitle>
              <p class="text-[14px] text-ios-secondary mb-6">
                {{ displayedState?.message }}
              </p>
              <div class="flex gap-2.5 justify-center">
                <button
                  class="px-5 py-2.5 text-[14px] font-semibold text-ios-text bg-ios-bg rounded-full hover:bg-ios-separator transition-colors"
                  @click="close(false)"
                >
                  {{ t("confirmModal.cancel") }}
                </button>
                <button
                  class="px-5 py-2.5 text-[14px] font-semibold text-white rounded-full transition-colors"
                  :class="
                    displayedState?.type === 'danger'
                      ? 'bg-red-700 hover:bg-ios-red/90 shadow-[0_2px_8px_rgba(255,59,48,0.25)]'
                      : 'bg-orange-700 hover:bg-ios-orange/90 shadow-[0_2px_8px_rgba(255,149,0,0.25)]'
                  "
                  @click="close(true)"
                >
                  {{ displayedState?.confirmLabel }}
                </button>
              </div>
            </div>
          </DialogPanel>
        </TransitionChild>
      </Dialog>
    </TransitionRoot>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionRoot,
  TransitionChild,
} from "@headlessui/vue";
import { AlertTriangle } from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";

const { t } = useI18n();

const { modalState, close } = useConfirmModal();
const restoreFocus = useDialogReturnFocus(() => Boolean(modalState.value));
// Retain the last message while Headless UI finishes the leave transition.
const displayedState = ref(modalState.value);
watch(
  modalState,
  (state) => {
    if (state) displayedState.value = state;
  },
  { flush: "sync" },
);
</script>

<style scoped>
.confirm-modal-enter-active,
.confirm-modal-leave-active {
  transition: opacity 0.2s ease-out;
}

.confirm-modal-enter-from,
.confirm-modal-leave-to {
  opacity: 0;
}
</style>
