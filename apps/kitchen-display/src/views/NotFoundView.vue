<template>
  <div
    class="kitchen-page ui-page bg-ios-bg min-h-screen flex items-center justify-center px-6"
  >
    <div class="ui-empty-state text-center max-w-md">
      <SearchX class="w-12 h-12 text-ios-tertiary mx-auto" />
      <h1 class="text-[22px] font-bold text-ios-text mt-4">
        {{ t("errorPages.notFoundTitle") }}
      </h1>
      <p class="text-sm text-ios-secondary mt-2">
        {{ t("errorPages.notFoundDescription") }}
      </p>
      <button
        class="bg-blue-700 text-white rounded-full px-6 py-3 font-bold mt-6 min-h-[44px]"
        @click="$router.push('/login')"
      >
        {{ t("errorPages.reLogin") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SearchX } from "lucide-vue-next";
import { useI18n } from "@/i18n";

const { t } = useI18n();
</script>
