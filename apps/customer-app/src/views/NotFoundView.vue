<template>
  <div
    class="customer-shell min-h-screen bg-ios-bg flex items-center justify-center px-5"
  >
    <div
      class="w-full max-w-md bg-ios-card rounded-3xl shadow-[0_4px_16px_rgb(0,0,0,0.06)] p-8 text-center"
    >
      <div class="mb-6">
        <div class="text-2xl font-semibold text-ios-tertiary mb-3">404</div>
        <div
          class="w-12 h-12 mx-auto rounded-full bg-ios-bg flex items-center justify-center"
        >
          <svg
            class="w-6 h-6 text-ios-secondary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-3-1v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
      </div>

      <h1 class="text-2xl font-bold text-ios-text mb-2">
        {{ t("errorBoundary.notFoundTitle") }}
      </h1>
      <p class="text-ios-secondary mb-8">
        {{ t("errorBoundary.notFoundMessage") }}
      </p>

      <div class="space-y-3">
        <button
          class="w-full bg-ios-blue hover:bg-ios-blue/90 text-white font-semibold py-3.5 px-6 rounded-full transition-colors"
          @click="goBack"
        >
          {{ t("common.back") }}
        </button>

        <button
          class="w-full bg-ios-bg hover:bg-ios-separator text-ios-text font-semibold py-3.5 px-6 rounded-full transition-colors"
          @click="goHome"
        >
          {{ t("common.home") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useI18n } from "@/composables/useI18n";

const router = useRouter();
const { t } = useI18n();

const goBack = () => {
  window.history.back();
};

const goHome = () => {
  router.push("/");
};
</script>
