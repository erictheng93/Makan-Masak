<template>
  <div
    class="customer-shell min-h-screen bg-ios-bg flex items-center justify-center px-5"
  >
    <div
      class="w-full max-w-md bg-ios-card rounded-3xl shadow-[0_4px_16px_rgb(0,0,0,0.06)] p-8 text-center"
    >
      <div
        class="w-20 h-20 mx-auto mb-6 rounded-full bg-ios-red/10 flex items-center justify-center"
      >
        <svg
          class="w-10 h-10 text-ios-red"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
      </div>

      <h1 class="text-2xl font-bold text-ios-text mb-2">
        {{ t("errors.general") }}
      </h1>
      <p class="text-ios-text/70 mb-8">
        {{ errorMessage || t("errors.generalDesc") }}
      </p>

      <div class="space-y-3">
        <button
          class="w-full bg-ios-blue hover:bg-ios-blue/90 text-white font-semibold py-3.5 px-6 rounded-full transition-colors"
          @click="retry"
        >
          {{ t("errorView.retry") }}
        </button>

        <button
          class="w-full bg-ios-bg hover:bg-ios-separator text-ios-text font-semibold py-3.5 px-6 rounded-full transition-colors"
          @click="goHome"
        >
          {{ t("errorView.goHome") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useI18n } from "@/composables/useI18n";

const router = useRouter();
const route = useRoute();
const { t } = useI18n();

const errorMessage = ref((route.query.message as string) || "");

const retry = () => {
  window.location.reload();
};

const goHome = () => {
  router.push("/");
};
</script>
