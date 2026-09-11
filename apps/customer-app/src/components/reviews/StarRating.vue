<template>
  <span
    class="inline-flex items-center gap-0.5"
    role="img"
    :aria-label="tWithParams('review.starLabel', { count: rounded })"
  >
    <svg
      v-for="star in STAR_VALUES"
      :key="star"
      :class="[
        sizeClass,
        star <= rounded ? 'text-ios-orange' : 'text-ios-separator',
      ]"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        d="M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.41l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.94L12 2.6z"
      />
    </svg>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "@/composables/useI18n";

/**
 * Read-only star readout. Filled count is rounded rather than truncated so a
 * 4.6 average does not display as four stars alongside the number "4.6".
 */
const props = withDefaults(
  defineProps<{
    rating: number;
    sizeClass?: string;
  }>(),
  { sizeClass: "w-4 h-4" },
);

const { tWithParams } = useI18n();

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

const rounded = computed(() =>
  Math.min(5, Math.max(0, Math.round(props.rating))),
);
</script>
