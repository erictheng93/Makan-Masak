<template>
  <section
    v-if="hasReviews"
    data-testid="shop-reviews"
    class="rounded-2xl bg-ios-card px-4 py-3 shadow-card-sm"
  >
    <div class="flex items-center justify-between gap-3">
      <div data-testid="shop-reviews-summary" class="flex items-center gap-2">
        <StarRating :rating="rating ?? 0" size-class="w-4 h-4" />
        <span class="text-sm font-semibold text-ios-text">
          {{ ratingLabel }}
        </span>
        <span class="text-sm text-ios-secondary">
          {{ tWithParams("review.shopReviewCount", { count: reviewCount }) }}
        </span>
      </div>
      <button
        type="button"
        data-testid="shop-reviews-toggle"
        class="shrink-0 rounded-full bg-ios-blue/10 px-3 py-1.5 text-sm font-semibold text-ios-blue transition-transform duration-200 ease-out active:scale-[0.98]"
        @click="toggle"
      >
        {{ isOpen ? t("review.hide") : t("review.viewAll") }}
      </button>
    </div>

    <div v-if="isOpen" class="mt-3 space-y-3">
      <p
        v-if="isLoading && reviews.length === 0"
        class="text-sm text-ios-secondary"
      >
        {{ t("review.loading") }}
      </p>

      <p
        v-else-if="loadFailed"
        data-testid="shop-reviews-error"
        class="text-sm text-ios-secondary"
      >
        {{ t("review.loadFailed") }}
      </p>

      <p
        v-else-if="reviews.length === 0"
        data-testid="shop-reviews-empty"
        class="text-sm text-ios-secondary"
      >
        {{ t("review.empty") }}
      </p>

      <ul v-else data-testid="shop-reviews-list" class="space-y-3">
        <li
          v-for="item in reviews"
          :key="item.id"
          :data-testid="`shop-review-${item.id}`"
          class="rounded-2xl bg-ios-bg px-4 py-3"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <StarRating :rating="item.rating" size-class="w-3.5 h-3.5" />
              <span class="text-sm font-medium text-ios-text">
                {{ item.authorName || t("review.anonymous") }}
              </span>
            </div>
            <span class="shrink-0 text-xs text-ios-tertiary">
              {{ formatDate(item.createdAt) }}
            </span>
          </div>

          <p
            v-if="item.content"
            class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ios-text"
          >
            {{ item.content }}
          </p>

          <div
            v-if="item.reply"
            class="mt-2 rounded-xl bg-ios-blue/5 px-3 py-2"
          >
            <p class="text-xs font-semibold text-ios-blue">
              {{ t("review.replyLabel") }}
            </p>
            <p
              class="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-ios-text"
            >
              {{ item.reply.content }}
            </p>
          </div>
        </li>
      </ul>

      <button
        v-if="hasMore && !loadFailed"
        type="button"
        data-testid="shop-reviews-load-more"
        :disabled="isLoading"
        class="w-full rounded-full bg-ios-bg py-2.5 text-sm font-semibold text-ios-blue transition-transform duration-200 ease-out active:scale-[0.98] disabled:opacity-40"
        @click="loadPage(page + 1)"
      >
        {{ isLoading ? t("review.loading") : t("review.loadMore") }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import { formatDate } from "@/utils/format";
import { orderApi, type PublicReview } from "@/services/orderApi";
import StarRating from "./StarRating.vue";

/**
 * The shop's public rating, plus the review list behind it (#286).
 *
 * The aggregate comes from the restaurant payload the page already loaded;
 * only opening the list costs a request, and it is paged rather than loaded
 * whole — a busy stall's reviews are not something a menu page should carry.
 */
const props = withDefaults(
  defineProps<{
    restaurantId: string;
    rating?: number | null;
    reviewCount?: number | null;
  }>(),
  { rating: 0, reviewCount: 0 },
);

const { t, tWithParams } = useI18n();

const PAGE_SIZE = 10;

const isOpen = ref(false);
const isLoading = ref(false);
const loadFailed = ref(false);
const reviews = ref<PublicReview[]>([]);
const page = ref(0);
const totalPages = ref(0);

const hasReviews = computed(() => (props.reviewCount ?? 0) > 0);
const hasMore = computed(() => page.value < totalPages.value);

/** One decimal, so a 4.6 average does not render as "4.6000000000000005". */
const ratingLabel = computed(() => (props.rating ?? 0).toFixed(1));

async function loadPage(next: number) {
  if (isLoading.value) return;

  isLoading.value = true;
  loadFailed.value = false;
  try {
    const result = await orderApi.getRestaurantReviews(props.restaurantId, {
      page: next,
      limit: PAGE_SIZE,
    });
    // Appended, not replaced: "載入更多" must not swap the page underneath
    // someone who is still reading it.
    reviews.value =
      next === 1 ? result.reviews : [...reviews.value, ...result.reviews];
    page.value = next;
    totalPages.value = result.pagination.totalPages;
  } catch (error: unknown) {
    console.error("載入店家評價失敗:", error);
    loadFailed.value = true;
  } finally {
    isLoading.value = false;
  }
}

function toggle() {
  isOpen.value = !isOpen.value;
  if (isOpen.value && reviews.value.length === 0 && !isLoading.value) {
    void loadPage(1);
  }
}
</script>
