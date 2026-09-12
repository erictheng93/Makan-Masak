<template>
  <div class="space-y-4">
    <!-- Compose -->
    <section class="rounded-3xl bg-white p-5 shadow-ios-card">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-[17px] font-semibold text-ios-text">
          {{ t("broadcasts.compose.heading") }}
        </h2>
        <span
          data-testid="broadcast-quota"
          class="inline-flex rounded-full px-3 py-1 text-[12px] font-semibold"
          :class="
            remainingQuota > 0
              ? 'bg-ios-blue-soft text-ios-blue-deep'
              : 'bg-ios-orange-soft text-ios-orange-deep'
          "
        >
          {{
            remainingQuota > 0
              ? t("broadcasts.quota.remaining", {
                  remaining: remainingQuota,
                  limit: quotaLimit,
                })
              : t("broadcasts.quota.exhausted")
          }}
        </span>
      </div>

      <label class="mt-4 block">
        <span class="flex items-baseline justify-between gap-2">
          <span class="text-[12px] font-medium text-ios-secondary">
            {{ t("broadcasts.compose.titleLabel") }}
          </span>
          <span
            data-testid="broadcast-title-counter"
            class="text-[12px] tabular-nums text-ios-tertiary"
          >
            {{ title.length }} / {{ TITLE_MAX }}
          </span>
        </span>
        <input
          v-model="title"
          data-testid="broadcast-title"
          type="text"
          :maxlength="TITLE_MAX"
          :placeholder="t('broadcasts.compose.titlePlaceholder')"
          class="mt-1 w-full rounded-2xl bg-ios-bg px-3 py-2.5 text-[14px] text-ios-text outline-none focus:ring-2 focus:ring-ios-blue"
        />
      </label>

      <label class="mt-3 block">
        <span class="flex items-baseline justify-between gap-2">
          <span class="text-[12px] font-medium text-ios-secondary">
            {{ t("broadcasts.compose.bodyLabel") }}
          </span>
          <span
            data-testid="broadcast-body-counter"
            class="text-[12px] tabular-nums text-ios-tertiary"
          >
            {{ body.length }} / {{ BODY_MAX }}
          </span>
        </span>
        <textarea
          v-model="body"
          data-testid="broadcast-body"
          rows="3"
          :maxlength="BODY_MAX"
          :placeholder="t('broadcasts.compose.bodyPlaceholder')"
          class="mt-1 w-full resize-none rounded-2xl bg-ios-bg px-3 py-2.5 text-[14px] leading-relaxed text-ios-text outline-none focus:ring-2 focus:ring-ios-blue"
        />
      </label>

      <label class="mt-3 block">
        <span class="text-[12px] font-medium text-ios-secondary">
          {{ t("broadcasts.compose.urlLabel") }}
        </span>
        <input
          v-model="url"
          data-testid="broadcast-url"
          type="text"
          maxlength="2048"
          :placeholder="t('broadcasts.compose.urlPlaceholder')"
          class="mt-1 w-full rounded-2xl bg-ios-bg px-3 py-2.5 text-[14px] text-ios-text outline-none focus:ring-2 focus:ring-ios-blue"
        />
        <span class="mt-1 block text-[12px] text-ios-secondary">
          {{ t("broadcasts.compose.urlHint") }}
        </span>
      </label>

      <!-- Restaurant scope only: the market route drops this flag rather than
           defaulting it, so offering the control in market mode would give the
           operator a switch whose two positions do the same thing. -->
      <label
        v-if="scopeType === 'restaurant'"
        class="mt-4 flex items-start gap-3 rounded-2xl bg-ios-bg p-3"
      >
        <input
          v-model="includeMarketFollowers"
          data-testid="broadcast-include-market"
          type="checkbox"
          class="mt-0.5 h-4 w-4 shrink-0 rounded accent-ios-blue"
        />
        <span>
          <span class="block text-[13px] font-semibold text-ios-text">
            {{ t("broadcasts.compose.includeMarket") }}
          </span>
          <span
            class="mt-0.5 block text-[12px] leading-relaxed text-ios-secondary"
          >
            {{ t("broadcasts.compose.includeMarketHint") }}
          </span>
        </span>
      </label>

      <p
        v-if="rateLimitMessage"
        data-testid="broadcast-rate-limited"
        class="mt-3 rounded-2xl bg-ios-orange-soft px-3 py-2 text-[13px] text-ios-orange-deep"
      >
        {{ rateLimitMessage }}
      </p>

      <div class="mt-4 flex justify-end">
        <button
          type="button"
          data-testid="broadcast-submit"
          :disabled="!canCompose"
          class="rounded-full bg-ios-blue px-5 py-2.5 text-[14px] font-semibold text-white transition-transform duration-200 ease-out active:scale-95 disabled:opacity-40"
          @click="openConfirm"
        >
          {{ t("broadcasts.compose.submit") }}
        </button>
      </div>
    </section>

    <!-- Confirm. There is no audience-preview endpoint, so this step names who
         will be reached and deliberately promises no number. -->
    <section
      v-if="isConfirming"
      data-testid="broadcast-confirm-panel"
      class="rounded-3xl bg-white p-5 shadow-ios-card"
    >
      <h3 class="text-[15px] font-semibold text-ios-text">
        {{ t("broadcasts.confirm.heading") }}
      </h3>
      <p class="mt-2 text-[14px] leading-relaxed text-ios-text">
        {{ confirmAudienceText }}
      </p>
      <p class="mt-1 text-[13px] text-ios-secondary">
        {{ t("broadcasts.confirm.irreversible") }}
      </p>
      <div class="mt-3 rounded-2xl bg-ios-bg p-3">
        <p class="text-[14px] font-semibold text-ios-text">
          {{ trimmedTitle }}
        </p>
        <p
          class="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ios-secondary"
        >
          {{ trimmedBody }}
        </p>
      </div>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          data-testid="broadcast-cancel"
          class="rounded-full bg-ios-bg px-4 py-2.5 text-[14px] font-semibold text-ios-text transition-transform duration-200 ease-out active:scale-95"
          @click="isConfirming = false"
        >
          {{ t("broadcasts.confirm.cancel") }}
        </button>
        <button
          type="button"
          data-testid="broadcast-confirm"
          :disabled="isSending"
          class="rounded-full bg-ios-blue px-5 py-2.5 text-[14px] font-semibold text-white transition-transform duration-200 ease-out active:scale-95 disabled:opacity-40"
          @click="submit"
        >
          {{
            isSending
              ? t("broadcasts.compose.sending")
              : t("broadcasts.confirm.send")
          }}
        </button>
      </div>
    </section>

    <!-- Result -->
    <section
      v-if="result"
      data-testid="broadcast-result"
      class="rounded-3xl bg-white p-5 shadow-ios-card"
    >
      <h3 class="text-[15px] font-semibold text-ios-green-deep">
        {{ t("broadcasts.result.heading") }}
      </h3>
      <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div
          v-for="cell in resultCells"
          :key="cell.key"
          class="rounded-2xl bg-ios-bg p-3"
        >
          <dt class="text-[12px] text-ios-secondary">{{ cell.label }}</dt>
          <dd
            :data-testid="`broadcast-result-${cell.key}`"
            class="mt-1 text-[22px] font-bold tabular-nums leading-none text-ios-text"
          >
            {{ cell.value }}
          </dd>
        </div>
      </dl>
      <p class="mt-3 text-[12px] leading-relaxed text-ios-secondary">
        {{ t("broadcasts.result.note") }}
      </p>
    </section>

    <!-- History -->
    <section class="rounded-3xl bg-white p-5 shadow-ios-card">
      <h2 class="text-[17px] font-semibold text-ios-text">
        {{ t("broadcasts.history.heading") }}
      </h2>

      <p
        v-if="isLoading"
        class="mt-4 text-center text-[14px] text-ios-secondary"
      >
        {{ t("common.loading") }}
      </p>
      <p
        v-else-if="history.length === 0"
        data-testid="broadcast-history-empty"
        class="mt-4 text-center text-[14px] text-ios-secondary"
      >
        {{ t("broadcasts.history.empty") }}
      </p>

      <ul v-else class="mt-3 space-y-3">
        <li
          v-for="item in history"
          :key="item.id"
          data-testid="broadcast-history-item"
          class="rounded-2xl bg-ios-bg p-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <p class="text-[14px] font-semibold text-ios-text">
              {{ item.title }}
            </p>
            <p class="text-[12px] text-ios-secondary">
              {{
                t("broadcasts.history.sentAt", {
                  time: formatDateTime(item.createdAt),
                })
              }}
            </p>
          </div>
          <p
            class="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ios-text"
          >
            {{ item.body }}
          </p>
          <p v-if="item.url" class="mt-1.5 text-[12px] text-ios-blue-deep">
            {{ t("broadcasts.history.linkLabel") }}: {{ item.url }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="cell in historyCells(item)"
              :key="cell.key"
              class="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] text-ios-text"
            >
              {{ cell.label }}
              <span class="font-semibold tabular-nums">{{ cell.value }}</span>
            </span>
          </div>
        </li>
      </ul>

      <nav
        v-if="pagination && pagination.totalPages > 1"
        class="mt-4 flex flex-wrap items-center justify-between gap-3"
      >
        <p class="text-[12px] text-ios-secondary">
          {{
            t("broadcasts.history.pagination", {
              page: pagination.page,
              totalPages: pagination.totalPages,
              total: pagination.total,
            })
          }}
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="broadcast-history-prev"
            :disabled="page <= 1 || isLoading"
            class="rounded-full bg-ios-bg px-4 py-2 text-[13px] font-semibold text-ios-text transition-transform duration-200 ease-out active:scale-95 disabled:opacity-40"
            @click="goToPage(page - 1)"
          >
            {{ t("broadcasts.history.prev") }}
          </button>
          <button
            type="button"
            data-testid="broadcast-history-next"
            :disabled="page >= pagination.totalPages || isLoading"
            class="rounded-full bg-ios-bg px-4 py-2 text-[13px] font-semibold text-ios-text transition-transform duration-200 ease-out active:scale-95 disabled:opacity-40"
            @click="goToPage(page + 1)"
          >
            {{ t("broadcasts.history.next") }}
          </button>
        </div>
      </nav>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useToast } from "vue-toastification";
import {
  MARKETING_BROADCAST_BODY_MAX_LENGTH,
  MARKETING_BROADCAST_RATE_LIMITS,
  MARKETING_BROADCAST_TITLE_MAX_LENGTH,
  type MarketingBroadcastScope,
} from "@makanmasak/shared-types";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  broadcastsService,
  type BroadcastHistoryItem,
  type BroadcastListResult,
  type BroadcastPagination,
  type SendBroadcastResult,
} from "@/services/broadcastsService";
import { extractApiErrorCode } from "@/utils/errorHandler";

/**
 * 行銷推播的撰寫 / 確認 / 結果 / 紀錄（#335 商圈 Phase 4）。
 *
 * 一個元件服務兩個 scope：店家自己的 `/dashboard/broadcasts`，以及平台在
 * 市場管理頁以市場名義發送。兩邊的請求與回應同形，但額度（3 則 vs 1 則）
 * 與受眾不同，而 `includeMarketFollowers` 只有店家 scope 有 —— 市場路由是
 * 「丟掉」這個欄位而不是預設 false，所以市場模式連控制項都不該出現。
 */

const props = defineProps<{
  scopeType: MarketingBroadcastScope;
  scopeId: string;
}>();

const PAGE_SIZE = 20;
const TITLE_MAX = MARKETING_BROADCAST_TITLE_MAX_LENGTH;
const BODY_MAX = MARKETING_BROADCAST_BODY_MAX_LENGTH;

const { t } = useI18n();
const toast = useToast();
const { formatDateTime } = useDateFormatter();

const title = ref("");
const body = ref("");
const url = ref("");
const includeMarketFollowers = ref(false);
const isConfirming = ref(false);
const isSending = ref(false);
const isLoading = ref(false);
const result = ref<SendBroadcastResult | null>(null);
const rateLimitWaitMs = ref<number | null>(null);
const history = ref<BroadcastHistoryItem[]>([]);
const pagination = ref<BroadcastPagination | null>(null);
const page = ref(1);

/**
 * The rows the quota is counted from, held apart from `history`.
 *
 * Only page 1 can contain the current window — the list is newest-first — so
 * counting the visible page instead would report a refilled budget the moment
 * the operator looked at page 2.
 */
const recentRows = ref<BroadcastHistoryItem[]>([]);

const quotaLimit = computed(
  () => MARKETING_BROADCAST_RATE_LIMITS[props.scopeType].limit,
);

const sentInWindow = computed(() => {
  const { windowMs } = MARKETING_BROADCAST_RATE_LIMITS[props.scopeType];
  const since = Date.now() - windowMs;
  return recentRows.value.filter((row) => row.createdAt >= since).length;
});

const remainingQuota = computed(() =>
  Math.max(0, quotaLimit.value - sentInWindow.value),
);

const trimmedTitle = computed(() => title.value.trim());
const trimmedBody = computed(() => body.value.trim());
const trimmedUrl = computed(() => url.value.trim());

const canCompose = computed(
  () =>
    trimmedTitle.value.length > 0 &&
    trimmedBody.value.length > 0 &&
    remainingQuota.value > 0 &&
    rateLimitWaitMs.value === null &&
    !isSending.value,
);

/**
 * The audience sentence, chosen with literal keys so the i18n key-coverage
 * scan can see both of them.
 */
const confirmAudienceText = computed(() =>
  props.scopeType === "market"
    ? t("broadcasts.confirm.audienceMarket")
    : t("broadcasts.confirm.audience"),
);

const rateLimitMessage = computed(() => {
  const waitMs = rateLimitWaitMs.value;
  if (waitMs === null) return "";

  // Round up: "0 分後可再發送" next to a disabled button reads as a bug.
  const totalMinutes = Math.max(1, Math.ceil(waitMs / 60_000));
  return t("broadcasts.errors.rateLimited", {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  });
});

interface CountCell {
  key: "audience" | "delivered" | "failed" | "skipped";
  label: string;
  value: number;
}

function countCells(source: {
  audienceCount: number;
  deliveredCount: number;
  failedCount: number;
  skippedCount: number;
}): CountCell[] {
  return [
    {
      key: "audience",
      label: t("broadcasts.result.audience"),
      value: source.audienceCount,
    },
    {
      key: "delivered",
      label: t("broadcasts.result.delivered"),
      value: source.deliveredCount,
    },
    {
      key: "failed",
      label: t("broadcasts.result.failed"),
      value: source.failedCount,
    },
    {
      key: "skipped",
      label: t("broadcasts.result.skipped"),
      value: source.skippedCount,
    },
  ];
}

const resultCells = computed(() =>
  result.value ? countCells(result.value) : [],
);

function historyCells(item: BroadcastHistoryItem): CountCell[] {
  return countCells(item);
}

/**
 * `details.retryAfterMs` out of the unified error envelope.
 *
 * Read here rather than in the service because it is the view that has to turn
 * it into a wait; the service stays a transport.
 */
function retryAfterMsOf(cause: unknown): number | null {
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;

  const details = asRecord(
    asRecord(asRecord(asRecord(asRecord(cause)?.response)?.data)?.error)
      ?.details,
  );
  const value = details?.retryAfterMs;
  return typeof value === "number" && value > 0 ? value : null;
}

/**
 * One toast per failure, with the code-specific copy when the server sent a
 * code. `fallback` arrives already translated so every key stays a literal the
 * i18n parity scan can see.
 */
function reportError(cause: unknown, fallback: string): void {
  switch (extractApiErrorCode(cause)) {
    case "FORBIDDEN":
    case "INSUFFICIENT_ROLE":
      toast.error(t("broadcasts.errors.forbidden"));
      return;
    case "RESTAURANT_NOT_FOUND":
    case "MARKET_NOT_FOUND":
      toast.error(t("broadcasts.errors.notFound"));
      return;
    case "VALIDATION_ERROR":
      toast.error(t("broadcasts.errors.validation"));
      return;
    default:
      toast.error(fallback);
  }
}

function readHistory(targetPage: number): Promise<BroadcastListResult> {
  const params = { page: targetPage, limit: PAGE_SIZE };
  return props.scopeType === "market"
    ? broadcastsService.listForMarket(props.scopeId, params)
    : broadcastsService.list(props.scopeId, params);
}

async function loadHistory(targetPage: number): Promise<void> {
  if (!props.scopeId) return;

  isLoading.value = true;
  try {
    const listed = await readHistory(targetPage);
    history.value = listed.broadcasts;
    pagination.value = listed.pagination;
    page.value = targetPage;
    if (targetPage === 1) recentRows.value = listed.broadcasts;
  } catch (cause) {
    reportError(cause, t("broadcasts.errors.loadFailed"));
  } finally {
    isLoading.value = false;
  }
}

function goToPage(next: number): void {
  void loadHistory(next);
}

function openConfirm(): void {
  if (!canCompose.value) return;
  result.value = null;
  isConfirming.value = true;
}

async function submit(): Promise<void> {
  if (isSending.value || !canCompose.value) return;

  const payload = {
    title: trimmedTitle.value,
    body: trimmedBody.value,
    ...(trimmedUrl.value ? { url: trimmedUrl.value } : {}),
  };

  isSending.value = true;
  try {
    result.value =
      props.scopeType === "market"
        ? await broadcastsService.sendToMarket(props.scopeId, payload)
        : await broadcastsService.send(props.scopeId, {
            ...payload,
            includeMarketFollowers: includeMarketFollowers.value,
          });

    isConfirming.value = false;
    title.value = "";
    body.value = "";
    url.value = "";
    includeMarketFollowers.value = false;

    // Re-read page 1 so the row just written appears and the quota it spent is
    // counted from the same rows the server limits on.
    await loadHistory(1);
  } catch (cause) {
    const waitMs = retryAfterMsOf(cause);
    if (waitMs !== null) {
      // The budget is spent: keep the composed text, close the confirm step and
      // say how long the wait is rather than offering a button that 429s again.
      rateLimitWaitMs.value = waitMs;
      isConfirming.value = false;
    } else {
      reportError(cause, t("broadcasts.errors.sendFailed"));
    }
  } finally {
    isSending.value = false;
  }
}

watch(
  () => [props.scopeType, props.scopeId],
  () => {
    result.value = null;
    rateLimitWaitMs.value = null;
    isConfirming.value = false;
    recentRows.value = [];
    void loadHistory(1);
  },
);

onMounted(() => loadHistory(1));
</script>
