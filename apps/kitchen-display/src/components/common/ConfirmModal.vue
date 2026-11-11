<template>
  <Teleport to="body">
    <Transition name="confirm-modal">
      <Dialog
        v-if="modalState"
        :open="true"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @close="close(false)"
      >
        <div
          class="fixed inset-0 bg-black/30 backdrop-blur-sm"
          @click="close(false)"
        />
        <DialogPanel
          class="relative bg-white rounded-3xl shadow-card-lg max-w-sm w-full"
        >
          <div class="p-6 text-center">
            <div
              class="mx-auto flex items-center justify-center h-12 w-12 rounded-full mb-4"
              :class="
                modalState.type === 'danger'
                  ? 'bg-ios-red/10'
                  : 'bg-ios-orange/10'
              "
            >
              <AlertTriangle
                class="h-6 w-6"
                :class="
                  modalState.type === 'danger'
                    ? 'text-ios-red'
                    : 'text-ios-orange'
                "
              />
            </div>
            <DialogTitle
              as="h3"
              class="text-[17px] font-bold text-ios-text mb-2"
            >
              {{ modalState.title }}
            </DialogTitle>
            <p class="text-[14px] text-ios-secondary mb-6">
              {{ modalState.message }}
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
                  modalState.type === 'danger'
                    ? 'bg-red-700 hover:bg-ios-red/90 shadow-[0_2px_8px_rgba(255,59,48,0.25)]'
                    : 'bg-orange-700 hover:bg-ios-orange/90 shadow-[0_2px_8px_rgba(255,149,0,0.25)]'
                "
                @click="close(true)"
              >
                {{ modalState.confirmLabel }}
              </button>
            </div>
          </div>
        </DialogPanel>
      </Dialog>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/vue";
import { AlertTriangle } from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useConfirmModal } from "@/composables/useConfirmModal";

const { t } = useI18n();

const { modalState, close } = useConfirmModal();
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
