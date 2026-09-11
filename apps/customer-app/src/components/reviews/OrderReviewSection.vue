<template>
  <div v-if="isVisible" :class="['space-y-3', SURFACE_CLASSES[variant]]">
    <!-- 已評價：唯讀 -->
    <OrderReviewCard v-if="review" :review="review" />

    <!-- 評價表單 -->
    <OrderReviewForm
      v-else-if="showForm"
      :order-id="orderId"
      :dishes="dishes"
      @submitted="handleSubmitted"
      @not-reviewable="handleNotReviewable"
      @cancel="showForm = false"
    />

    <!-- 訂單已不可評價 -->
    <p
      v-else-if="notReviewable"
      data-testid="order-review-unavailable"
      class="text-sm text-ios-secondary"
    >
      {{ t("review.notReviewable") }}
    </p>

    <!-- 尚未評價：邀請 -->
    <div v-else-if="canReview" class="flex items-center justify-between gap-3">
      <p class="min-w-0 text-sm text-ios-secondary">
        {{ t("review.ctaHint") }}
      </p>
      <button
        type="button"
        data-testid="order-review-cta"
        class="shrink-0 rounded-full bg-ios-blue/10 px-4 py-2 text-sm font-semibold text-ios-blue transition-transform duration-200 ease-out active:scale-[0.98]"
        @click="showForm = true"
      >
        {{ t("review.cta") }}
      </button>
    </div>

    <p
      v-else-if="loadFailed"
      data-testid="order-review-load-failed"
      class="text-sm text-ios-secondary"
    >
      {{ t("review.loadFailed") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import { orderApi, type OrderReview } from "@/services/orderApi";
import OrderReviewCard from "./OrderReviewCard.vue";
import OrderReviewForm from "./OrderReviewForm.vue";

/**
 * The review affordance for one order (#286): invites a review, hosts the
 * form, and then shows what was written — including any reply from the shop.
 *
 * It takes the order it is given rather than fetching one. Both hosts already
 * hold the order (`OrderTrackingView` from its `useQuery`, `OrderHistoryView`
 * from its list), and a second read of the same order would double the cost of
 * a history page for nothing.
 */
const props = withDefaults(
  defineProps<{
    orderId: string;
    orderStatus: string;
    /** The order's line items, as the host already has them. */
    items?: Array<{
      menuItemId: number;
      name?: string | null;
      menuItem?: { name?: string | null } | null;
    }> | null;
    /**
     * Chrome, chosen by the host: `card` is a standalone card in a stack of
     * cards, `inset` a hairline-separated block inside someone else's card.
     * It lives here rather than in a host wrapper so that an order with
     * nothing to show leaves no empty box behind.
     */
    variant?: "plain" | "card" | "inset";
  }>(),
  { items: null, variant: "plain" },
);

const SURFACE_CLASSES: Record<"plain" | "card" | "inset", string> = {
  plain: "",
  card: "rounded-2xl bg-ios-card p-6 shadow-card",
  inset: "mt-4 border-t border-ios-separator pt-4",
};

const variant = computed(() => props.variant);

const { t } = useI18n();

/** Mirrors `REVIEWABLE_ORDER_STATUSES` in the API's ReviewService. */
const REVIEWABLE_STATUSES = new Set(["delivered", "paid"]);

const review = ref<OrderReview | null>(null);
const isLoading = ref(false);
const loadFailed = ref(false);
const showForm = ref(false);
const notReviewable = ref(false);

const isReviewable = computed(() =>
  REVIEWABLE_STATUSES.has(String(props.orderStatus).toLowerCase()),
);

const canReview = computed(
  () => isReviewable.value && !isLoading.value && !loadFailed.value,
);

const isVisible = computed(
  () => review.value !== null || (isReviewable.value && !isLoading.value),
);

/**
 * One row per dish, not per order line: the contract keys item ratings on
 * `menuItemId`, and an order that lists the same dish twice would otherwise
 * offer two rows that collapse into one rating server-side.
 */
const dishes = computed(() => {
  const seen = new Map<number, { menuItemId: number; name: string }>();
  for (const item of props.items ?? []) {
    if (typeof item?.menuItemId !== "number" || seen.has(item.menuItemId)) {
      continue;
    }
    seen.set(item.menuItemId, {
      menuItemId: item.menuItemId,
      name: item.name || item.menuItem?.name || `#${item.menuItemId}`,
    });
  }
  return [...seen.values()];
});

function handleSubmitted(submitted: OrderReview) {
  review.value = submitted;
  showForm.value = false;
}

function handleNotReviewable() {
  showForm.value = false;
  notReviewable.value = true;
}

async function loadExistingReview() {
  isLoading.value = true;
  loadFailed.value = false;
  try {
    review.value = await orderApi.getOrderReview(props.orderId);
  } catch (error: unknown) {
    // `getOrderReview` already turns "not reviewed yet" into null, so reaching
    // here means the read itself failed. Say so rather than inviting a review
    // that may turn out to be a duplicate.
    console.error("讀取訂單評價失敗:", error);
    loadFailed.value = true;
  } finally {
    isLoading.value = false;
  }
}

watch(
  // An order reaches `delivered` while this screen is open — the tracking view
  // pushes that in over the websocket — so the read is keyed on the status,
  // not on mount.
  () => [props.orderId, isReviewable.value] as const,
  ([, reviewable], previous) => {
    if (!reviewable) return;
    if (previous && previous[0] === props.orderId && previous[1]) return;
    void loadExistingReview();
  },
  { immediate: true },
);
</script>
