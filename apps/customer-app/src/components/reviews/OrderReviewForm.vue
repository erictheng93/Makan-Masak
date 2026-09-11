<template>
  <form
    data-testid="order-review-form"
    class="space-y-5"
    @submit.prevent="handleSubmit"
  >
    <div>
      <h3 class="text-base font-semibold text-ios-text">
        {{ t("review.formTitle") }}
      </h3>
      <p class="mt-0.5 text-sm text-ios-secondary">
        {{ t("review.ratingLabel") }}
      </p>
    </div>

    <!-- 整體評分 -->
    <div class="flex items-center gap-1">
      <button
        v-for="star in STAR_VALUES"
        :key="star"
        type="button"
        :data-testid="`order-review-star-${star}`"
        :aria-label="tWithParams('review.starLabel', { count: star })"
        :aria-pressed="rating === star"
        class="rounded-full p-1 transition-transform duration-200 ease-out active:scale-90"
        :class="star <= rating ? 'text-ios-orange' : 'text-ios-separator'"
        @click="rating = star"
      >
        <svg class="h-9 w-9" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.41l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.94L12 2.6z"
          />
        </svg>
      </button>
      <span v-if="rating === 0" class="ml-2 text-sm text-ios-secondary">
        {{ t("review.ratingHint") }}
      </span>
    </div>

    <!-- 文字評語 -->
    <div class="space-y-1.5">
      <label
        for="order-review-content"
        class="block text-sm font-medium text-ios-text"
      >
        {{ t("review.contentLabel") }}
      </label>
      <textarea
        id="order-review-content"
        v-model="content"
        data-testid="order-review-content"
        rows="3"
        :maxlength="CONTENT_MAX_LENGTH"
        :placeholder="t('review.contentPlaceholder')"
        class="w-full rounded-2xl border-0 bg-ios-bg px-4 py-3 text-sm text-ios-text placeholder:text-ios-tertiary transition-all duration-200 focus:bg-white focus:ring-2 focus:ring-ios-blue/30"
      />
      <p class="text-right text-xs text-ios-tertiary">
        {{
          tWithParams("review.contentCounter", {
            current: content.length,
            max: CONTENT_MAX_LENGTH,
          })
        }}
      </p>
    </div>

    <!-- 單品評分 -->
    <div v-if="dishes.length > 0" class="space-y-3">
      <p class="text-sm font-medium text-ios-text">
        {{ t("review.itemsHeading") }}
      </p>
      <div
        v-for="dish in dishes"
        :key="dish.menuItemId"
        class="flex items-center justify-between gap-3 rounded-2xl bg-ios-bg px-4 py-2.5"
      >
        <span class="min-w-0 flex-1 truncate text-sm text-ios-text">
          {{ dish.name }}
        </span>
        <div class="flex shrink-0 items-center gap-0.5">
          <button
            v-for="star in STAR_VALUES"
            :key="star"
            type="button"
            :data-testid="`order-review-item-${dish.menuItemId}-star-${star}`"
            :aria-label="tWithParams('review.starLabel', { count: star })"
            :aria-pressed="itemRatings[dish.menuItemId] === star"
            class="rounded-full p-0.5 transition-transform duration-200 ease-out active:scale-90"
            :class="
              star <= (itemRatings[dish.menuItemId] ?? 0)
                ? 'text-ios-orange'
                : 'text-ios-separator'
            "
            @click="setItemRating(dish.menuItemId, star)"
          >
            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.41l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.94L12 2.6z"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <p
      v-if="errorMessage"
      data-testid="order-review-error"
      class="rounded-2xl bg-ios-red/10 px-4 py-3 text-sm text-ios-red"
    >
      {{ errorMessage }}
    </p>

    <div class="flex items-center gap-3">
      <button
        type="submit"
        data-testid="order-review-submit"
        :disabled="!canSubmit"
        class="flex-1 rounded-full bg-ios-blue px-4 py-3 text-sm font-semibold text-white transition-transform duration-200 ease-out active:scale-[0.98] disabled:opacity-40"
        @click.prevent="handleSubmit"
      >
        {{ isSubmitting ? t("review.submitting") : t("review.submit") }}
      </button>
      <button
        type="button"
        data-testid="order-review-cancel"
        class="rounded-full bg-ios-bg px-4 py-3 text-sm font-semibold text-ios-secondary transition-transform duration-200 ease-out active:scale-[0.98]"
        @click="emit('cancel')"
      >
        {{ t("review.cancel") }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useToast } from "vue-toastification";
import { useI18n } from "@/composables/useI18n";
import { orderApi, type OrderReview } from "@/services/orderApi";
import { isRecord } from "@/utils/unknown";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

/** Mirrors `REVIEW_CONTENT_MAX_LENGTH` in the API's review validation. */
const CONTENT_MAX_LENGTH = 1000;
const STAR_VALUES = [1, 2, 3, 4, 5] as const;

const props = defineProps<{
  orderId: string;
  /** One entry per distinct dish; see `OrderReviewSection`. */
  dishes: Array<{ menuItemId: number; name: string }>;
}>();

const emit = defineEmits<{
  submitted: [review: OrderReview];
  "not-reviewable": [];
  cancel: [];
}>();

const { t, tWithParams } = useI18n();
const toast = useToast();

const rating = ref(0);
const content = ref("");
const itemRatings = reactive<Record<number, number>>({});
const isSubmitting = ref(false);
const errorMessage = ref("");

const canSubmit = computed(() => rating.value > 0 && !isSubmitting.value);

/** Tapping the star already selected clears that dish's rating again. */
function setItemRating(menuItemId: number, star: number) {
  if (itemRatings[menuItemId] === star) {
    delete itemRatings[menuItemId];
    return;
  }
  itemRatings[menuItemId] = star;
}

/**
 * Reached from the button's click and from the form's native submit. The
 * guard below is what makes that safe: `isSubmitting` flips before the first
 * await, so the second call of a doubled event returns immediately.
 */
async function handleSubmit() {
  if (!canSubmit.value) return;

  isSubmitting.value = true;
  errorMessage.value = "";

  try {
    const review = await orderApi.submitOrderReview(props.orderId, {
      rating: rating.value,
      content: content.value,
      items: Object.entries(itemRatings).map(([menuItemId, itemRating]) => ({
        menuItemId: Number(menuItemId),
        rating: itemRating,
      })),
    });
    toast.success(t("review.success"));
    emit("submitted", review);
  } catch (error: unknown) {
    await handleSubmitError(error);
  } finally {
    isSubmitting.value = false;
  }
}

async function handleSubmitError(error: unknown) {
  const code = isRecord(error) ? error.code : undefined;

  // The order moved on (or never qualified). Nothing the diner can retry, so
  // the section retires the whole affordance rather than showing a red box.
  if (code === "ORDER_NOT_REVIEWABLE") {
    emit("not-reviewable");
    return;
  }

  // A duplicate means there is already a review to read — a second tab, or a
  // retry after a response went missing. Show it instead of the conflict.
  if (code === "REVIEW_ALREADY_EXISTS") {
    const existing = await orderApi
      .getOrderReview(props.orderId)
      .catch(() => null);
    if (existing) {
      emit("submitted", existing);
      return;
    }
    errorMessage.value = t("review.alreadyReviewed");
    return;
  }

  console.error("提交評價失敗:", error);
  errorMessage.value = resolveUserFacingError(error, t, {
    codeKeys: {
      REVIEW_ITEM_NOT_IN_ORDER: "review.itemNotInOrder",
      REVIEW_ITEM_DUPLICATE: "review.itemDuplicate",
    },
    fallbackKey: "review.submitFailed",
  }).message;
}
</script>
