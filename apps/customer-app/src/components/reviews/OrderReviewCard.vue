<template>
  <section data-testid="order-review-card" class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-base font-semibold text-ios-text">
        {{ t("review.myReviewTitle") }}
      </h3>
      <div class="flex items-center gap-2">
        <StarRating :rating="review.rating" size-class="w-4 h-4" />
        <span class="text-sm font-medium text-ios-secondary">
          {{ tWithParams("review.ratingValue", { rating: review.rating }) }}
        </span>
      </div>
    </div>

    <p
      v-if="review.content"
      class="whitespace-pre-line text-sm leading-relaxed text-ios-text"
    >
      {{ review.content }}
    </p>

    <ul v-if="review.items.length > 0" class="flex flex-wrap gap-2">
      <li
        v-for="item in review.items"
        :key="item.menuItemId"
        :data-testid="`order-review-card-item-${item.menuItemId}`"
        class="inline-flex items-center gap-1.5 rounded-full bg-ios-bg px-3 py-1"
      >
        <span class="text-xs font-medium text-ios-text">
          {{ item.menuItemName ?? `#${item.menuItemId}` }}
        </span>
        <StarRating :rating="item.rating" size-class="w-3 h-3" />
      </li>
    </ul>

    <div
      v-if="review.reply"
      data-testid="order-review-reply"
      class="rounded-2xl bg-ios-blue/5 px-4 py-3"
    >
      <p class="text-xs font-semibold text-ios-blue">
        {{ t("review.replyLabel") }}
      </p>
      <p class="mt-1 whitespace-pre-line text-sm leading-relaxed text-ios-text">
        {{ review.reply.content }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from "@/composables/useI18n";
import StarRating from "./StarRating.vue";
import type { OrderReview } from "@/services/orderApi";

defineProps<{ review: OrderReview }>();

const { t, tWithParams } = useI18n();
</script>
