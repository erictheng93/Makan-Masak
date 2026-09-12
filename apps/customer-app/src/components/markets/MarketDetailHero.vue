<template>
  <section class="bg-white">
    <div class="h-44 bg-gray-100">
      <img
        v-if="market.bannerUrl || market.logoUrl"
        :src="market.bannerUrl || market.logoUrl || ''"
        :alt="market.name"
        class="h-full w-full object-cover"
      />
      <div
        v-else
        class="flex h-full items-center justify-center text-lg font-semibold text-gray-500"
      >
        {{ market.name }}
      </div>
    </div>
    <div class="space-y-3 px-4 py-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-xl font-semibold text-gray-900">
            {{ market.name }}
          </h1>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              data-testid="market-detail-type"
              class="rounded-full bg-ios-blue/10 px-2 py-0.5 text-xs font-medium text-ios-blue"
            >
              {{ typeLabel }}
            </span>
            <span class="text-sm text-gray-500">
              {{ market.city }} · {{ market.district }}
            </span>
          </div>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-2">
          <span
            class="rounded-full bg-ios-blue/10 px-3 py-1 text-sm font-medium text-ios-blue"
          >
            {{
              tWithParams("markets.common.stallCount", { count: vendorCount })
            }}
          </span>
          <FollowButton
            target-type="market"
            :target-id="market.id"
            :name="market.name"
          />
        </div>
      </div>
      <p v-if="market.description" class="text-sm leading-6 text-gray-700">
        {{ market.description }}
      </p>
      <p class="text-sm text-gray-500">{{ market.address }}</p>
      <div v-if="market.tags?.length" class="flex flex-wrap gap-2">
        <span
          v-for="tag in market.tags.slice(0, 5)"
          :key="tag"
          class="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600"
        >
          {{ tag }}
        </span>
      </div>

      <div
        v-if="galleryImages.length"
        class="grid grid-cols-3 gap-2"
        :aria-label="t('markets.hero.gallery')"
      >
        <img
          v-for="imageUrl in galleryImages"
          :key="imageUrl"
          :src="imageUrl"
          :alt="tWithParams('markets.hero.galleryAlt', { name: market.name })"
          class="aspect-square rounded-lg object-cover"
          loading="lazy"
          data-testid="market-gallery-image"
        />
      </div>

      <section v-if="openingHoursRows.length" class="rounded-xl bg-gray-50 p-3">
        <h2 class="text-sm font-semibold text-gray-900">
          {{ t("markets.hero.openingHours") }}
        </h2>
        <dl class="mt-2 grid grid-cols-1 gap-1 text-sm text-gray-600">
          <div
            v-for="row in openingHoursRows"
            :key="row.key"
            class="flex justify-between gap-3"
          >
            <dt>{{ row.label }}</dt>
            <dd class="font-medium text-gray-800">{{ row.value }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { MarketDetail } from "@/services/marketsApi";
import { marketTypeLabelKey } from "@/utils/marketTypes";
import { useI18n } from "@/composables/useI18n";
import FollowButton from "@/components/follow/FollowButton.vue";

const props = defineProps<{
  market: MarketDetail;
  vendorCount: number;
}>();

const { t, tWithParams } = useI18n();

const weekdayOrder = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const galleryImages = computed(() =>
  (props.market.imageUrls ?? []).filter(Boolean).slice(0, 6),
);

const typeLabel = computed(() => t(marketTypeLabelKey(props.market.type)));

const openingHoursRows = computed(() => {
  const hours = props.market.openingHours;
  if (!hours) return [];

  return weekdayOrder
    .filter((key) => hours[key])
    .map((key) => {
      const value = hours[key];
      return {
        key,
        label: t(`markets.weekday.long.${key}`),
        value: value.closed
          ? t("markets.common.closedShort")
          : `${value.open}-${value.close}`,
      };
    });
});
</script>
