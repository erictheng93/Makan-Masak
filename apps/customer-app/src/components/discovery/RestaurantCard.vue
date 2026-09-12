<template>
  <article
    class="rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
  >
    <button
      type="button"
      class="block w-full text-left focus:outline-none focus:ring-2 focus:ring-ios-blue focus:ring-offset-2"
      @click="$emit('select', restaurant)"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100"
        >
          <img
            v-if="restaurant.imageUrl"
            :src="restaurant.imageUrl"
            :alt="restaurant.name"
            class="h-full w-full object-cover"
          />
          <svg
            v-else
            class="h-7 w-7 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-5 0H9m0 0H7m2 0v-9m10 9v-9M9 8h6m-6 4h6"
            />
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <h4 class="truncate font-medium text-gray-900">
            {{ restaurant.name }}
          </h4>
          <p class="truncate text-sm text-gray-500">
            {{ restaurant.type }}
            <span v-if="restaurant.district" class="text-gray-400">
              · {{ restaurant.district }}
            </span>
            <span v-if="distanceLabel" class="text-gray-400">
              · {{ distanceLabel }}
            </span>
          </p>
          <div class="mt-1 flex items-center gap-2">
            <span
              v-if="restaurant.isOpen"
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
            <span v-if="restaurant.rating" class="text-xs text-yellow-600">
              {{ restaurant.rating.toFixed(1) }}
            </span>
          </div>
          <div
            v-if="serviceLabels.length > 0"
            data-testid="restaurant-service-labels"
            class="mt-2 flex flex-wrap gap-1"
          >
            <span
              v-for="label in serviceLabels"
              :key="label"
              class="rounded bg-gray-50 px-2 py-0.5 text-xs text-gray-500"
            >
              {{ label }}
            </span>
          </div>
        </div>
      </div>
    </button>
    <RouterLink
      v-if="marketContextUrl"
      :to="marketContextUrl"
      data-testid="restaurant-market-link"
      class="mt-3 inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md bg-ios-bg px-2.5 py-1.5 text-xs font-medium text-ios-blue"
    >
      <span>在 {{ restaurant.marketVendor?.marketName }}</span>
      <span
        v-if="restaurant.marketVendor?.stallNumber"
        class="text-ios-secondary"
      >
        · 攤位 {{ restaurant.marketVendor.stallNumber }}
      </span>
      <span
        v-if="restaurant.marketVendor?.locationLabel"
        class="text-ios-secondary"
      >
        · {{ restaurant.marketVendor.locationLabel }}
      </span>
    </RouterLink>
    <!-- Outside the card-wide <button> above on purpose: a button inside a
         button is invalid, and the browser would swallow one of the two
         clicks. -->
    <div class="mt-3 flex items-center gap-2">
      <FollowButton
        target-type="restaurant"
        :target-id="restaurant.restaurantId"
        :name="restaurant.name"
        compact
      />
      <button
        v-if="canTakeaway"
        type="button"
        data-testid="restaurant-takeaway-button"
        class="flex-1 rounded-lg bg-ios-blue px-3 py-2 text-sm font-medium text-white"
        @click="$emit('takeaway', restaurant)"
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
import type { RestaurantListItem } from "@/services/discoveryApi";
import FollowButton from "@/components/follow/FollowButton.vue";

const { t } = useI18n();

const props = defineProps<{
  restaurant: RestaurantListItem;
}>();

defineEmits<{
  select: [restaurant: RestaurantListItem];
  takeaway: [restaurant: RestaurantListItem];
}>();

const canTakeaway = computed(
  () => props.restaurant.isOpen && props.restaurant.supportsTakeaway,
);

const serviceLabels = computed(() => {
  const labels: string[] = [];
  if (props.restaurant.supportsTakeaway) labels.push("可外帶");
  if (props.restaurant.supportsDelivery) labels.push("可外送");
  return labels;
});

const distanceLabel = computed(() =>
  typeof props.restaurant.distanceKm === "number"
    ? `${props.restaurant.distanceKm.toFixed(1)} km`
    : "",
);

const marketContextUrl = computed(() => {
  const marketVendor = props.restaurant.marketVendor;
  if (!marketVendor?.marketName) return "";
  return (
    marketVendor.marketUrl ||
    (marketVendor.marketSlug ? `/markets/${marketVendor.marketSlug}` : "")
  );
});
</script>
