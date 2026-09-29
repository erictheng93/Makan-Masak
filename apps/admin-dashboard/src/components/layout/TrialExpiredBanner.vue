<template>
  <div
    v-if="visible"
    class="mx-4 mt-4 flex items-center justify-between gap-3 rounded-2xl bg-ios-orange-soft px-5 py-3 text-sm text-ios-orange-deep"
    data-testid="trial-expired-banner"
  >
    <span>{{ t("billing.trialExpiredBanner") }}</span>
    <div class="flex shrink-0 items-center gap-2">
      <router-link
        :to="{ name: 'Billing' }"
        class="rounded-full bg-ios-orange px-4 py-1.5 font-medium text-white"
      >
        {{ t("billing.trialExpiredAction") }}
      </router-link>
      <button
        type="button"
        class="rounded-full px-3 py-1.5 font-medium"
        :aria-label="t('common.close')"
        @click="dismissed = true"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useModuleAccess } from "@makanmasak/shared/composables/useModuleAccess";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";

const { t } = useI18n();
const authStore = useAuthStore();
const { isTrialExpired } = useModuleAccess();

// Nag-only: dismissing lasts until the next page load, like WinRAR's dialog.
const dismissed = ref(false);
const visible = computed(
  () =>
    isTrialExpired.value &&
    !dismissed.value &&
    authStore.user?.role === UserRole.OWNER,
);
</script>
