<template>
  <Teleport to="body">
    <Transition name="confirm-modal">
      <div
        v-if="modalState"
        v-dialog-focus
        data-testid="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
        tabindex="-1"
        class="fixed inset-0 z-50 overflow-y-auto"
        @keydown.esc.stop.prevent="close(false)"
      >
        <div class="flex items-center justify-center min-h-screen px-4">
          <div
            class="fixed inset-0 bg-black/30 backdrop-blur-sm"
            @click="close(false)"
          />
          <div
            class="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto"
          >
            <div class="p-6 text-center">
              <div
                class="mx-auto flex items-center justify-center h-12 w-12 rounded-full mb-4"
                :class="
                  modalState.type === 'danger'
                    ? 'bg-ios-error/10'
                    : 'bg-ios-warning/10'
                "
              >
                <AlertTriangle
                  class="h-6 w-6"
                  :class="
                    modalState.type === 'danger'
                      ? 'text-ios-error'
                      : 'text-ios-warning'
                  "
                />
              </div>
              <h3
                id="confirm-modal-title"
                class="text-[17px] font-bold text-ios-text mb-2"
              >
                {{ modalState.title }}
              </h3>
              <p
                id="confirm-modal-message"
                class="text-[14px] text-ios-secondary mb-6"
              >
                {{ modalState.message }}
              </p>
              <div
                v-for="section in modalState.sections"
                :key="section.heading"
                class="mb-4 text-left"
                :class="
                  section.caution ? 'rounded-xl bg-ios-warning/10 p-3' : ''
                "
                data-testid="confirm-modal-section"
                :data-blocking="section.blocking ? 'true' : 'false'"
                :data-caution="section.caution ? 'true' : 'false'"
              >
                <p class="text-[13px] font-semibold text-ios-text mb-1.5">
                  {{ section.heading }}
                </p>
                <ul
                  class="list-disc space-y-1 pl-5 text-[13px]"
                  :class="
                    section.blocking
                      ? 'text-ios-red'
                      : section.caution
                        ? 'text-ios-text'
                        : 'text-ios-secondary'
                  "
                >
                  <li v-for="item in section.items" :key="item">{{ item }}</li>
                </ul>
              </div>
              <RouterLink
                v-if="modalState.link"
                :to="modalState.link.to"
                class="mb-4 inline-block text-[14px] font-semibold text-ios-blue"
                data-testid="confirm-modal-link"
                @click="close(false)"
              >
                {{ modalState.link.label }}
              </RouterLink>
              <a
                v-if="modalState.help"
                :href="modalState.help.href"
                target="_blank"
                rel="noopener noreferrer"
                class="mb-4 block text-[13px] font-semibold text-ios-blue"
                data-testid="confirm-modal-help"
              >
                {{ modalState.help.label }}
              </a>
              <div class="flex gap-2.5 justify-center">
                <button
                  data-testid="confirm-modal-cancel"
                  class="px-5 py-2.5 text-[14px] font-semibold text-ios-text bg-ios-bg rounded-full hover:bg-ios-separator transition-colors"
                  @click="close(false)"
                >
                  {{ t("common.cancel") }}
                </button>
                <button
                  data-testid="confirm-modal-confirm"
                  :disabled="modalState.confirmDisabled"
                  class="px-5 py-2.5 text-[14px] font-semibold text-white rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  :class="
                    modalState.type === 'danger'
                      ? 'bg-ios-error hover:bg-ios-error/90 shadow-[0_2px_8px_rgba(255,59,48,0.25)]'
                      : 'bg-ios-warning hover:bg-ios-warning/90 shadow-[0_2px_8px_rgba(255,149,0,0.25)]'
                  "
                  @click="close(true)"
                >
                  {{ modalState.confirmLabel }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { AlertTriangle } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import { useI18n } from "@/i18n";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { vDialogFocus } from "@/utils/dialog-focus";

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
