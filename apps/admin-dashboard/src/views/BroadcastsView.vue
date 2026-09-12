<template>
  <div class="min-h-screen bg-ios-bg p-4 md:p-6">
    <div class="mx-auto max-w-4xl">
      <header class="mb-5">
        <h1 class="text-[22px] font-bold text-ios-text">
          {{ t("broadcasts.title") }}
        </h1>
        <p class="mt-1 text-[13px] text-ios-secondary">
          {{ t("broadcasts.description") }}
        </p>
      </header>

      <div
        v-if="!restaurantId"
        data-testid="broadcast-no-restaurant"
        class="rounded-3xl bg-white p-10 text-center shadow-ios-sm"
      >
        <p class="text-[15px] font-semibold text-ios-text">
          {{ t("broadcasts.errors.noRestaurant") }}
        </p>
      </div>

      <BroadcastComposer
        v-else
        scope-type="restaurant"
        :scope-id="restaurantId"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import BroadcastComposer from "@/components/broadcasts/BroadcastComposer.vue";

/**
 * 推播訊息（#335 商圈 Phase 4），店家 scope。
 *
 * 這頁只負責「哪一家店」與頁面外框；撰寫、確認、結果與發送紀錄都在
 * BroadcastComposer，平台端的市場推播共用同一個元件（PlatformMarketsView）。
 */

const { t } = useI18n();
const authStore = useAuthStore();

const restaurantId = computed(() => authStore.restaurantId);
</script>
