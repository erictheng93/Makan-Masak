<template>
  <dialog
    ref="dialogRef"
    class="m-auto w-[min(92vw,26rem)] rounded-3xl bg-white p-0 shadow-xl backdrop:bg-black/30 backdrop:backdrop-blur-sm"
    data-testid="trial-expired-modal"
    aria-labelledby="trial-expired-title"
    @close="acknowledge"
  >
    <div class="p-6">
      <h2 id="trial-expired-title" class="text-xl font-bold text-ios-text">
        {{ t("billing.trialExpiredTitle") }}
      </h2>
      <p class="mt-2 text-sm leading-6 text-ios-secondary">
        {{ t("billing.trialExpiredBanner") }}
      </p>
      <div class="mt-6 flex flex-col gap-2">
        <button
          type="button"
          class="rounded-full bg-ios-bg px-5 py-3 text-sm font-semibold text-ios-text"
          data-testid="trial-expired-modal-continue"
          @click="dialogRef?.close()"
        >
          {{ t("billing.trialExpiredContinue") }}
        </button>
        <router-link
          :to="{ name: 'Billing' }"
          class="rounded-full bg-ios-blue px-5 py-3 text-center text-sm font-semibold text-white"
          data-testid="trial-expired-modal-action"
          @click="dialogRef?.close()"
        >
          {{ t("billing.trialExpiredAction") }}
        </router-link>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useModuleAccess } from "@makanmasak/shared/composables/useModuleAccess";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";

// Shown once per login: auth.ts clears this key on logout, so signing in again
// (even in the same tab) brings the notice back, while a reload does not.
const SEEN_KEY = "trial_expired_modal_seen";

const { t } = useI18n();
const authStore = useAuthStore();
const { isTrialExpired } = useModuleAccess();
const dialogRef = ref<HTMLDialogElement | null>(null);

function alreadySeen() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function acknowledge() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Without storage the modal may reappear on reload; harmless.
  }
}

// Native <dialog>: focus trap, Esc and backdrop come for free. Access state
// loads async after mount, so watch instead of deciding once in onMounted.
watch(
  [isTrialExpired, () => authStore.user?.role, dialogRef],
  ([expired, role, dialog]) => {
    if (
      expired &&
      role === UserRole.OWNER &&
      dialog &&
      !dialog.open &&
      !alreadySeen()
    ) {
      dialog.showModal?.();
    }
  },
  { immediate: true },
);
</script>
