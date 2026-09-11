<template>
  <div class="min-h-screen bg-ios-bg p-4 md:p-6">
    <div class="mx-auto max-w-4xl">
      <header class="mb-5">
        <h1 class="text-[22px] font-bold text-ios-text">
          {{ t("reviews.title") }}
        </h1>
        <p class="mt-1 text-[13px] text-ios-secondary">
          {{ t("reviews.description") }}
        </p>
      </header>

      <div
        v-if="!restaurantId"
        data-testid="reviews-no-restaurant"
        class="rounded-3xl bg-white p-10 text-center shadow-ios-sm"
      >
        <p class="text-[15px] font-semibold text-ios-text">
          {{ t("reviews.errors.noRestaurant") }}
        </p>
      </div>

      <div
        v-else-if="isInitialLoading"
        class="rounded-3xl bg-white p-10 text-center text-[14px] text-ios-secondary shadow-ios-sm"
      >
        {{ t("common.loading") }}
      </div>

      <!-- A restaurant with no reviews at all gets one card, not a 0.00
           average over five empty bars and a filter bar that can only make
           the page emptier. -->
      <div
        v-else-if="summary && summary.count === 0"
        data-testid="reviews-empty"
        class="rounded-3xl bg-white p-10 text-center shadow-ios-sm"
      >
        <p class="text-[15px] font-semibold text-ios-text">
          {{ t("reviews.empty.title") }}
        </p>
        <p class="mt-2 text-[13px] text-ios-secondary">
          {{ t("reviews.empty.hint") }}
        </p>
      </div>

      <template v-else-if="summary">
        <section
          data-testid="reviews-summary"
          class="rounded-3xl bg-white p-5 shadow-ios-card"
        >
          <div class="flex flex-wrap items-start gap-6">
            <div class="min-w-[120px]">
              <p class="text-[12px] font-medium text-ios-secondary">
                {{ t("reviews.summary.average") }}
              </p>
              <p
                data-testid="reviews-average"
                class="mt-1 text-[40px] font-bold leading-none text-ios-text"
              >
                {{ averageLabel }}
              </p>
              <div class="mt-2 flex items-center gap-0.5">
                <Star
                  v-for="star in 5"
                  :key="star"
                  class="h-4 w-4"
                  :class="
                    star <= Math.round(summary.average)
                      ? 'text-ios-orange'
                      : 'text-ios-tertiary'
                  "
                  :fill="
                    star <= Math.round(summary.average)
                      ? 'currentColor'
                      : 'none'
                  "
                  aria-hidden="true"
                />
              </div>
              <p class="mt-2 text-[13px] text-ios-secondary">
                {{ t("reviews.summary.count", { count: summary.count }) }}
              </p>
              <span
                data-testid="reviews-unreplied"
                class="mt-2 inline-flex rounded-full px-3 py-1 text-[12px] font-semibold"
                :class="
                  summary.unrepliedCount > 0
                    ? 'bg-ios-orange-soft text-ios-orange-deep'
                    : 'bg-ios-green-soft text-ios-green-deep'
                "
              >
                {{
                  summary.unrepliedCount > 0
                    ? t("reviews.summary.unreplied", {
                        count: summary.unrepliedCount,
                      })
                    : t("reviews.summary.allReplied")
                }}
              </span>
            </div>

            <div class="min-w-[200px] flex-1">
              <p class="mb-2 text-[12px] font-medium text-ios-secondary">
                {{ t("reviews.summary.distribution") }}
              </p>
              <div
                v-for="row in distributionRows"
                :key="row.rating"
                :data-testid="`reviews-distribution-${row.rating}`"
                class="mb-1.5 flex items-center gap-2 last:mb-0"
              >
                <span class="w-12 shrink-0 text-[12px] text-ios-secondary">
                  {{ t("reviews.summary.starLabel", { rating: row.rating }) }}
                </span>
                <span class="h-2 flex-1 rounded-full bg-ios-bg">
                  <span
                    class="block h-2 rounded-full bg-ios-orange transition-all duration-300 ease-out"
                    :style="{ width: `${row.percent}%` }"
                  />
                </span>
                <span
                  class="w-8 shrink-0 text-right text-[12px] font-semibold text-ios-text"
                >
                  {{ row.count }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section class="mt-4 rounded-2xl bg-white p-4 shadow-ios-sm">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[12px] font-medium text-ios-secondary">
              {{ t("reviews.filters.rating") }}
            </span>
            <button
              type="button"
              data-testid="reviews-filter-rating-all"
              class="rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors duration-200"
              :class="chipClass(rating === null)"
              @click="selectRating(null)"
            >
              {{ t("reviews.filters.all") }}
            </button>
            <button
              v-for="value in RATINGS"
              :key="value"
              type="button"
              :data-testid="`reviews-filter-rating-${value}`"
              class="rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors duration-200"
              :class="chipClass(rating === value)"
              @click="selectRating(value)"
            >
              {{ value }}
            </button>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="text-[12px] font-medium text-ios-secondary">
              {{ t("reviews.filters.replied") }}
            </span>
            <button
              v-for="option in REPLIED_OPTIONS"
              :key="option.key"
              type="button"
              :data-testid="`reviews-filter-replied-${option.key}`"
              class="rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors duration-200"
              :class="chipClass(replied === option.value)"
              @click="selectReplied(option.value)"
            >
              {{ t(option.labelKey) }}
            </button>
          </div>

          <div class="mt-3 flex flex-wrap items-end gap-3">
            <label class="text-[12px] font-medium text-ios-secondary">
              {{ t("reviews.filters.from") }}
              <input
                v-model="fromDate"
                type="date"
                data-testid="reviews-filter-from"
                class="mt-1 block rounded-xl bg-ios-bg px-3 py-2 text-[13px] text-ios-text outline-none"
                @change="applyFilters"
              />
            </label>
            <label class="text-[12px] font-medium text-ios-secondary">
              {{ t("reviews.filters.to") }}
              <input
                v-model="toDate"
                type="date"
                data-testid="reviews-filter-to"
                class="mt-1 block rounded-xl bg-ios-bg px-3 py-2 text-[13px] text-ios-text outline-none"
                @change="applyFilters"
              />
            </label>
            <button
              v-if="hasFilters"
              type="button"
              data-testid="reviews-filter-reset"
              class="rounded-full bg-ios-bg px-3 py-2 text-[13px] font-semibold text-ios-text transition-transform duration-150 active:scale-95"
              @click="resetFilters"
            >
              {{ t("reviews.filters.reset") }}
            </button>
          </div>
        </section>

        <div
          v-if="isListLoading"
          class="mt-4 rounded-2xl bg-white p-8 text-center text-[14px] text-ios-secondary shadow-ios-sm"
        >
          {{ t("common.loading") }}
        </div>

        <div
          v-else-if="reviews.length === 0"
          data-testid="reviews-empty-filtered"
          class="mt-4 rounded-3xl bg-white p-10 text-center shadow-ios-sm"
        >
          <p class="text-[15px] font-semibold text-ios-text">
            {{ t("reviews.empty.filteredTitle") }}
          </p>
          <p class="mt-2 text-[13px] text-ios-secondary">
            {{ t("reviews.empty.filteredHint") }}
          </p>
        </div>

        <ul v-else class="mt-4 space-y-3">
          <li
            v-for="item in reviews"
            :key="item.id"
            data-testid="review-card"
            :data-rating="item.rating"
            :data-replied="item.reply ? 'yes' : 'no'"
            class="rounded-2xl bg-white p-4 shadow-ios-sm"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex items-center gap-0.5">
                  <Star
                    v-for="star in 5"
                    :key="star"
                    class="h-4 w-4"
                    :class="
                      star <= item.rating
                        ? 'text-ios-orange'
                        : 'text-ios-tertiary'
                    "
                    :fill="star <= item.rating ? 'currentColor' : 'none'"
                    aria-hidden="true"
                  />
                </div>
                <p class="mt-1.5 text-[14px] font-semibold text-ios-text">
                  {{ item.customerName || t("reviews.card.guest") }}
                </p>
                <p class="mt-0.5 text-[12px] text-ios-secondary">
                  {{
                    item.orderNumber
                      ? t("reviews.card.order", {
                          orderNumber: item.orderNumber,
                        })
                      : t("reviews.card.orderUnknown")
                  }}
                </p>
              </div>
              <p
                class="text-[12px] text-ios-secondary"
                :title="formatDateTime(item.createdAt)"
              >
                {{ formatRelativeTime(item.createdAt) }}
              </p>
            </div>

            <p
              v-if="item.content"
              class="mt-3 whitespace-pre-line text-[14px] leading-relaxed text-ios-text"
            >
              {{ item.content }}
            </p>
            <p v-else class="mt-3 text-[13px] italic text-ios-secondary">
              {{ t("reviews.card.noContent") }}
            </p>

            <div v-if="item.items.length > 0" class="mt-3">
              <p class="text-[12px] font-medium text-ios-secondary">
                {{ t("reviews.card.dishRatings") }}
              </p>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <span
                  v-for="dish in item.items"
                  :key="dish.menuItemId"
                  class="inline-flex items-center gap-1 rounded-full bg-ios-bg px-2.5 py-1 text-[12px] text-ios-text"
                >
                  {{ dish.menuItemName || t("reviews.card.dishUnknown") }}
                  <Star
                    class="h-3 w-3 text-ios-orange"
                    fill="currentColor"
                    aria-hidden="true"
                  />
                  {{ dish.rating }}
                </span>
              </div>
            </div>

            <div
              v-if="item.reply"
              data-testid="review-reply"
              class="mt-3 rounded-xl bg-ios-bg p-3"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-[12px] font-semibold text-ios-blue-deep">
                  {{ t("reviews.card.replyHeading") }}
                </p>
                <p
                  v-if="item.reply.repliedAt"
                  class="text-[12px] text-ios-secondary"
                >
                  {{ formatRelativeTime(item.reply.repliedAt) }}
                </p>
              </div>
              <p
                class="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ios-text"
              >
                {{ item.reply.content }}
              </p>
            </div>

            <!-- A plain div rather than a <form>: the only control is the
                 textarea, where Enter inserts a newline, so a submit event
                 has no way to be raised other than this button. -->
            <div v-else class="mt-3">
              <textarea
                :value="drafts[item.id] ?? ''"
                data-testid="review-reply-input"
                rows="2"
                maxlength="1000"
                :placeholder="t('reviews.card.replyPlaceholder')"
                class="w-full resize-none rounded-xl bg-ios-bg px-3 py-2 text-[13px] text-ios-text outline-none"
                @input="onDraftInput(item.id, $event)"
              />
              <div class="mt-2 flex justify-end">
                <button
                  type="button"
                  data-testid="review-reply-submit"
                  :disabled="!canSubmit(item.id)"
                  class="rounded-full bg-ios-blue px-4 py-2 text-[13px] font-semibold text-white transition-transform duration-150 active:scale-95 disabled:opacity-40"
                  @click="submitReply(item)"
                >
                  {{
                    pendingReplyId === item.id
                      ? t("reviews.card.replySending")
                      : t("reviews.card.replySubmit")
                  }}
                </button>
              </div>
            </div>
          </li>
        </ul>

        <nav
          v-if="pagination && pagination.totalPages > 1"
          class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-ios-sm"
        >
          <p class="text-[12px] text-ios-secondary">
            {{
              t("reviews.pagination.summary", {
                page: pagination.page,
                totalPages: pagination.totalPages,
                total: pagination.total,
              })
            }}
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              data-testid="reviews-pagination-prev"
              :disabled="page <= 1 || isListLoading"
              class="rounded-full bg-ios-bg px-4 py-2 text-[13px] font-semibold text-ios-text transition-transform duration-150 active:scale-95 disabled:opacity-40"
              @click="goToPage(page - 1)"
            >
              {{ t("reviews.pagination.prev") }}
            </button>
            <button
              type="button"
              data-testid="reviews-pagination-next"
              :disabled="page >= pagination.totalPages || isListLoading"
              class="rounded-full bg-ios-bg px-4 py-2 text-[13px] font-semibold text-ios-text transition-transform duration-150 active:scale-95 disabled:opacity-40"
              @click="goToPage(page + 1)"
            >
              {{ t("reviews.pagination.next") }}
            </button>
          </div>
        </nav>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Star } from "lucide-vue-next";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useAuthStore } from "@/stores/auth";
import {
  reviewsService,
  type OwnerReview,
  type ReviewListParams,
  type ReviewPagination,
  type ReviewRating,
  type ReviewSummary,
} from "@/services/reviewsService";
import { extractApiErrorCode } from "@/utils/errorHandler";

/**
 * 顧客評價（#286）。
 *
 * 這頁跟 /dashboard/feedback 是兩件事：那是平台自己的客服工單佇列，#266 記過
 * 兩者被混為一談。這裡只處理「顧客對某張訂單的評分與評語」。
 */

const PAGE_SIZE = 20;
const RATINGS: ReviewRating[] = [5, 4, 3, 2, 1];
const REPLIED_OPTIONS = [
  { key: "all", value: null, labelKey: "reviews.filters.all" },
  { key: "no", value: false, labelKey: "reviews.filters.repliedNo" },
  { key: "yes", value: true, labelKey: "reviews.filters.repliedYes" },
] as const;

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();
const { formatDateTime, formatRelativeTime, startOfDay, endOfDay } =
  useDateFormatter();

const restaurantId = computed(() => authStore.restaurantId);

const summary = ref<ReviewSummary | null>(null);
const reviews = ref<OwnerReview[]>([]);
const pagination = ref<ReviewPagination | null>(null);
const page = ref(1);
const rating = ref<ReviewRating | null>(null);
const replied = ref<boolean | null>(null);
const fromDate = ref("");
const toDate = ref("");
const isInitialLoading = ref(false);
const isListLoading = ref(false);
const pendingReplyId = ref<string | null>(null);
const drafts = reactive<Record<string, string>>({});

const averageLabel = computed(() => (summary.value?.average ?? 0).toFixed(2));

const hasFilters = computed(
  () =>
    rating.value !== null ||
    replied.value !== null ||
    fromDate.value !== "" ||
    toDate.value !== "",
);

const distributionRows = computed(() => {
  const current = summary.value;
  if (!current) return [];

  // Percentages are of the busiest bucket rather than of the total, so a
  // 90%-five-star restaurant still shows a readable 2-star bar.
  const counts = RATINGS.map((value) => current.distribution[`${value}`] ?? 0);
  const peak = Math.max(...counts, 1);

  return RATINGS.map((value, index) => ({
    rating: value,
    count: counts[index],
    percent: Math.round((counts[index] / peak) * 100),
  }));
});

/**
 * `new Date("2026-09-01")` is parsed as UTC midnight, so west of Greenwich it
 * lands on the previous local day. Building the date from its parts keeps the
 * boundary on the day the owner picked, in their own timezone.
 */
function toDayBoundaryMs(value: string, edge: "start" | "end"): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;

  const local = new Date(year, month - 1, day);
  return (edge === "start" ? startOfDay(local) : endOfDay(local)).getTime();
}

const listParams = computed<ReviewListParams>(() => {
  const params: ReviewListParams = { page: page.value, limit: PAGE_SIZE };

  if (rating.value !== null) params.rating = rating.value;
  if (replied.value !== null) params.replied = replied.value;

  const from = toDayBoundaryMs(fromDate.value, "start");
  if (from !== null) params.from = from;
  const to = toDayBoundaryMs(toDate.value, "end");
  if (to !== null) params.to = to;

  return params;
});

function chipClass(active: boolean): string {
  return active
    ? "bg-ios-blue text-white"
    : "bg-ios-bg text-ios-secondary hover:text-ios-text";
}

function canSubmit(reviewId: string): boolean {
  return (
    pendingReplyId.value === null && (drafts[reviewId] ?? "").trim().length > 0
  );
}

function onDraftInput(reviewId: string, event: Event): void {
  drafts[reviewId] = (event.target as HTMLTextAreaElement).value;
}

/**
 * One toast per failure, with the code-specific copy when the server sent a
 * code. `fallback` is passed already translated so every key stays a literal
 * the i18n parity scan can see.
 */
function reportError(cause: unknown, fallback: string): void {
  switch (extractApiErrorCode(cause)) {
    case "FORBIDDEN":
      toast.error(t("reviews.errors.forbidden"));
      return;
    case "REVIEW_NOT_FOUND":
      toast.error(t("reviews.errors.notFound"));
      return;
    default:
      toast.error(fallback);
  }
}

function applyList(result: {
  reviews: OwnerReview[];
  pagination: ReviewPagination;
}): void {
  reviews.value = result.reviews;
  pagination.value = result.pagination;
}

async function loadAll(): Promise<void> {
  const id = restaurantId.value;
  if (!id) return;

  isInitialLoading.value = true;
  try {
    // One round trip's worth of latency, and one catch — so a tenancy refusal
    // that fails both calls still produces a single toast.
    const [summaryResult, listResult] = await Promise.all([
      reviewsService.getSummary(id),
      reviewsService.list(id, listParams.value),
    ]);
    summary.value = summaryResult;
    applyList(listResult);
  } catch (cause) {
    reportError(cause, t("reviews.errors.loadFailed"));
  } finally {
    isInitialLoading.value = false;
  }
}

async function loadList(): Promise<void> {
  const id = restaurantId.value;
  if (!id) return;

  isListLoading.value = true;
  try {
    applyList(await reviewsService.list(id, listParams.value));
  } catch (cause) {
    reportError(cause, t("reviews.errors.loadFailed"));
  } finally {
    isListLoading.value = false;
  }
}

function applyFilters(): void {
  page.value = 1;
  void loadList();
}

function selectRating(value: ReviewRating | null): void {
  rating.value = value;
  applyFilters();
}

function selectReplied(value: boolean | null): void {
  replied.value = value;
  applyFilters();
}

function resetFilters(): void {
  rating.value = null;
  replied.value = null;
  fromDate.value = "";
  toDate.value = "";
  applyFilters();
}

function goToPage(next: number): void {
  page.value = next;
  void loadList();
}

async function submitReply(item: OwnerReview): Promise<void> {
  const id = restaurantId.value;
  const content = (drafts[item.id] ?? "").trim();
  if (!id || !content || pendingReplyId.value !== null) return;

  pendingReplyId.value = item.id;
  try {
    const updated = await reviewsService.reply(id, item.id, content);

    // Swap the one row the server sent back. Re-reading the page would scroll
    // the owner away from the card they just answered, and would renumber the
    // list under them when the unreplied filter is on.
    const index = reviews.value.findIndex((row) => row.id === updated.id);
    if (index >= 0) reviews.value[index] = updated;
    delete drafts[item.id];

    if (summary.value && summary.value.unrepliedCount > 0) {
      summary.value.unrepliedCount -= 1;
    }
    toast.success(t("reviews.messages.replied"));
  } catch (cause) {
    reportError(cause, t("reviews.errors.replyFailed"));
  } finally {
    pendingReplyId.value = null;
  }
}

onMounted(loadAll);
</script>
