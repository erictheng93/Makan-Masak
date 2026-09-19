<template>
  <article
    class="bg-ios-card rounded-2xl p-4 shadow-[0_2px_8px_rgb(0,0,0,0.04)] transition-shadow hover:shadow-[0_4px_16px_rgb(0,0,0,0.06)]"
  >
    <button
      type="button"
      class="block w-full text-left focus:outline-none focus:ring-2 focus:ring-ios-blue focus:ring-offset-2"
      @click="$emit('select', dish)"
    >
      <div class="flex items-start justify-between">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h4 class="truncate font-medium text-gray-900">
              {{ dish.dishName }}
            </h4>
            <span
              v-if="resultTypeLabel"
              data-testid="dish-result-type"
              class="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            >
              {{ resultTypeLabel }}
            </span>
          </div>
          <p class="mt-0.5 truncate text-sm text-gray-500">
            {{ dish.restaurantName }}
            <span v-if="dish.district" class="text-gray-400">
              · {{ dish.district }}
            </span>
            <span v-if="dish.marketVendor?.stallNumber" class="text-gray-400">
              · 攤位 {{ dish.marketVendor.stallNumber }}
            </span>
            <span v-if="distanceLabel" class="text-gray-400">
              · {{ distanceLabel }}
            </span>
          </p>
          <div class="mt-2 flex items-center gap-2">
            <span
              data-testid="dish-result-price"
              class="font-semibold text-ios-blue"
            >
              {{ productPriceLabel }}
            </span>
            <span
              v-if="dish.isOpen"
              class="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700"
            >
              {{ t("discovery.open") }}
            </span>
            <span
              v-else
              class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
            >
              {{ t("discovery.closed") }}
            </span>
          </div>
          <div
            v-if="serviceLabels.length > 0"
            data-testid="dish-service-labels"
            class="mt-2 flex flex-wrap gap-1"
          >
            <span
              v-for="label in serviceLabels"
              :key="label"
              class="rounded bg-ios-bg px-2 py-0.5 text-xs text-ios-secondary"
            >
              {{ label }}
            </span>
          </div>
        </div>
      </div>
      <div v-if="dish.tags.length > 0" class="mt-2 flex flex-wrap gap-1">
        <span
          v-for="tag in dish.tags.slice(0, 3)"
          :key="tag"
          class="rounded bg-gray-50 px-2 py-0.5 text-xs text-gray-500"
        >
          {{ tag }}
        </span>
      </div>
    </button>
    <RouterLink
      v-if="marketContextUrl"
      :to="marketContextUrl"
      data-testid="dish-market-link"
      class="mt-3 inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md bg-ios-bg px-2.5 py-1.5 text-xs font-medium text-ios-blue"
    >
      <span>在 {{ dish.marketVendor?.marketName }}</span>
      <span v-if="dish.marketVendor?.stallNumber" class="text-ios-secondary">
        · 攤位 {{ dish.marketVendor.stallNumber }}
      </span>
      <span v-if="dish.marketVendor?.locationLabel" class="text-ios-secondary">
        · {{ dish.marketVendor.locationLabel }}
      </span>
    </RouterLink>
    <div class="mt-3 grid gap-2" :class="canTakeaway ? 'grid-cols-2' : ''">
      <button
        type="button"
        data-testid="dish-result-open-menu"
        class="rounded-lg border border-ios-blue px-3 py-2 text-sm font-medium text-ios-blue"
        @click="$emit('select', dish)"
      >
        {{ openActionLabel }}
      </button>
      <button
        v-if="canTakeaway"
        type="button"
        data-testid="dish-takeaway-button"
        class="rounded-lg bg-ios-blue px-3 py-2 text-sm font-medium text-white"
        @click="$emit('takeaway', dish)"
      >
        立即外帶
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { useCurrency } from "@/composables/useCurrency";
import type { DishSearchResult } from "@/services/discoveryApi";

const { t } = useI18n();

const props = defineProps<{
  dish: DishSearchResult;
}>();

// Search results span restaurants, so the card prices in the dish's own
// currency rather than in the last-visited shop's.
const { formatPrice } = useCurrency(() => props.dish.currency);

defineEmits<{
  select: [dish: DishSearchResult];
  takeaway: [dish: DishSearchResult];
}>();

const canTakeaway = computed(
  () => props.dish.isOpen && props.dish.supportsTakeaway,
);

const serviceLabels = computed(() => {
  const labels: string[] = [];
  if (props.dish.supportsTakeaway) labels.push("可外帶");
  if (props.dish.supportsDelivery) labels.push("可外送");
  return labels;
});

const resultTypeLabel = computed(() => {
  if (props.dish.resultType === "product") return "商品";
  if (props.dish.resultType === "menu_item") return "餐點";
  return "";
});

const openActionLabel = computed(() =>
  props.dish.resultType === "product" ? "查看商品" : "查看菜單",
);

const productPriceLabel = computed(() => {
  if (props.dish.priceLabel) return props.dish.priceLabel;
  return formatPrice(props.dish.price);
});

const distanceLabel = computed(() =>
  typeof props.dish.distanceKm === "number"
    ? `${props.dish.distanceKm.toFixed(1)} km`
    : "",
);

const marketContextUrl = computed(() => {
  const marketVendor = props.dish.marketVendor;
  if (!marketVendor?.marketName) return "";
  return (
    marketVendor.marketUrl ||
    (marketVendor.marketSlug ? `/markets/${marketVendor.marketSlug}` : "")
  );
});
</script>
