<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold text-ios-text">
      {{ t("marketOpenReport.pageTitle") }}
    </h1>
    <label
      v-if="memberships.length > 1"
      class="block text-sm text-ios-secondary"
    >
      {{ t("marketOpenReport.market") }}
      <select
        v-model="marketId"
        data-testid="open-report-market"
        class="mt-1 block rounded-full bg-white px-4 py-2 text-sm text-ios-text shadow-ios-card"
      >
        <option v-for="m in memberships" :key="m.marketId" :value="m.marketId">
          {{ m.market.name }}
        </option>
      </select>
    </label>
    <MarketOpenReportPanel v-if="scope" :scope="scope" />
    <p v-else-if="loaded" class="text-sm text-ios-secondary">
      {{ t("marketOpenReport.noMarkets") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import MarketOpenReportPanel from "@/components/markets/MarketOpenReportPanel.vue";
import {
  marketsService,
  type RestaurantMarketMembership,
} from "@/services/marketsService";

const { t } = useI18n();
const authStore = useAuthStore();
const memberships = ref<RestaurantMarketMembership[]>([]);
const marketId = ref("");
const loaded = ref(false);

const scope = computed(() =>
  authStore.restaurantId && marketId.value
    ? {
        kind: "owner" as const,
        restaurantId: authStore.restaurantId,
        marketId: marketId.value,
      }
    : null,
);

onMounted(async () => {
  if (authStore.restaurantId) {
    memberships.value = await marketsService
      .listRestaurantMemberships(authStore.restaurantId)
      .catch(() => []);
    marketId.value = memberships.value[0]?.marketId ?? "";
  }
  loaded.value = true;
});
</script>
