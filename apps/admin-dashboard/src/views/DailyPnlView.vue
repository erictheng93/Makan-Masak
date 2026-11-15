<template>
  <div class="ui-page min-h-screen bg-ios-bg p-4 md:p-6">
    <div class="mx-auto max-w-3xl">
      <header class="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="ui-page-heading text-[22px] font-bold text-ios-text">
            {{ t("dailyPnl.title") }}
          </h1>
          <p class="mt-1 text-[13px] text-ios-secondary">
            {{ t("dailyPnl.description") }}
          </p>
        </div>
        <label class="text-[12px] font-medium text-ios-secondary">
          {{ t("dailyPnl.date") }}
          <input
            v-model="date"
            type="date"
            :max="today"
            required
            data-testid="pnl-date"
            class="mt-1 block rounded-xl bg-white px-3 py-2 text-[14px] text-ios-text shadow-ios-sm outline-none"
          />
        </label>
      </header>

      <div
        v-if="!restaurantId"
        data-testid="pnl-no-restaurant"
        class="ui-panel rounded-3xl bg-white p-10 text-center text-[15px] font-semibold text-ios-text shadow-ios-sm"
      >
        {{ t("dailyPnl.noRestaurant") }}
      </div>

      <div
        v-else-if="statement === null && isLoading"
        data-testid="pnl-loading"
        class="ui-panel rounded-3xl bg-white p-10 text-center text-[14px] text-ios-secondary shadow-ios-sm"
      >
        {{ t("common.loading") }}
      </div>

      <div
        v-else-if="statement === null"
        role="alert"
        data-testid="pnl-error"
        class="ui-panel rounded-3xl bg-white p-10 text-center shadow-ios-sm"
      >
        <p class="text-[15px] font-semibold text-ios-text">
          {{ t("dailyPnl.errors.loadFailed") }}
        </p>
        <button
          type="button"
          data-testid="pnl-retry"
          class="mt-4 rounded-full bg-ios-blue px-5 py-2 text-[14px] font-semibold text-white transition-colors duration-200"
          @click="load()"
        >
          {{ t("common.retry") }}
        </button>
      </div>

      <template v-else>
        <div
          v-if="statement.cogs.itemsMissingCost > 0"
          role="status"
          data-testid="pnl-missing-cost"
          class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-ios-orange-soft px-4 py-3 text-[13px] font-medium text-ios-orange-deep"
        >
          <span>
            {{
              t("dailyPnl.warning.missingCost", {
                count: statement.cogs.itemsMissingCost,
              })
            }}
          </span>
          <RouterLink
            to="/dashboard/menu"
            class="font-semibold underline underline-offset-2"
          >
            {{ t("dailyPnl.warning.manageMenu") }}
          </RouterLink>
        </div>

        <section
          data-testid="pnl-statement"
          class="ui-panel rounded-3xl bg-white p-5 shadow-ios-card"
        >
          <h2 class="text-[15px] font-bold text-ios-text">
            {{ t("dailyPnl.revenue.title") }}
          </h2>
          <dl class="mt-2 text-[14px]">
            <div class="flex justify-between py-1.5">
              <dt class="text-ios-text">
                {{ t("dailyPnl.revenue.grossSales") }}
              </dt>
              <dd data-testid="pnl-gross-sales" class="tabular-nums">
                {{ money(statement.revenue.grossSalesCents) }}
              </dd>
            </div>
            <div class="flex justify-between py-1.5">
              <dt class="text-ios-text">
                − {{ t("dailyPnl.revenue.discount") }}
              </dt>
              <dd class="tabular-nums">
                {{ money(statement.revenue.discountCents) }}
              </dd>
            </div>
            <div class="flex justify-between py-1.5">
              <dt class="text-ios-text">
                − {{ t("dailyPnl.revenue.refund") }}
              </dt>
              <dd class="tabular-nums">
                {{ money(statement.revenue.refundCents) }}
              </dd>
            </div>
            <div
              class="flex justify-between rounded-xl bg-ios-bg px-3 py-2 font-bold"
            >
              <dt class="text-ios-text">= {{ t("dailyPnl.revenue.net") }}</dt>
              <dd data-testid="pnl-net-revenue" class="tabular-nums">
                {{ money(statement.revenue.netRevenueCents) }}
              </dd>
            </div>
          </dl>
          <p class="mt-2 text-[12px] text-ios-secondary">
            {{
              t("dailyPnl.revenue.taxService", {
                tax: money(statement.revenue.taxCents),
                service: money(statement.revenue.serviceChargeCents),
              })
            }}
            ·
            <span data-testid="pnl-order-count">
              {{
                t("dailyPnl.revenue.orders", {
                  count: statement.revenue.orderCount,
                })
              }}
            </span>
          </p>

          <div class="mt-5 flex justify-between text-[15px] font-bold">
            <h2 class="text-ios-text">{{ t("dailyPnl.cogs.title") }}</h2>
            <span data-testid="pnl-cogs" class="tabular-nums">
              − {{ money(statement.cogs.totalCents) }}
            </span>
          </div>
          <dl class="mt-2 text-[14px]">
            <div
              class="flex justify-between rounded-xl bg-ios-bg px-3 py-2 font-bold"
            >
              <dt class="text-ios-text">
                = {{ t("dailyPnl.cogs.grossProfit") }}
              </dt>
              <dd data-testid="pnl-gross-profit" class="tabular-nums">
                {{ money(statement.grossProfitCents) }}
              </dd>
            </div>
            <div class="flex justify-between px-3 py-1.5 text-ios-secondary">
              <dt>{{ t("dailyPnl.cogs.grossMargin") }}</dt>
              <dd data-testid="pnl-gross-margin" class="tabular-nums">
                {{ grossMarginLabel }}
              </dd>
            </div>
          </dl>
          <p class="mt-2 text-[12px] text-ios-secondary">
            {{ t("dailyPnl.costNote") }}
          </p>

          <div class="mt-5 flex justify-between text-[15px] font-bold">
            <h2 class="text-ios-text">{{ t("dailyPnl.expenses.title") }}</h2>
            <span data-testid="pnl-expenses-total" class="tabular-nums">
              − {{ money(statement.expenses.totalCents) }}
            </span>
          </div>
          <p
            v-if="statement.expenses.byCategory.length === 0"
            class="mt-2 text-[13px] text-ios-secondary"
          >
            {{ t("dailyPnl.expenses.empty") }}
          </p>
          <dl v-else class="mt-2 text-[14px]">
            <div
              v-for="row in statement.expenses.byCategory"
              :key="row.category"
              class="flex justify-between py-1.5"
            >
              <dt class="text-ios-text">{{ categoryLabel(row.category) }}</dt>
              <dd class="tabular-nums">{{ money(row.amountCents) }}</dd>
            </div>
          </dl>

          <div
            data-testid="pnl-net-profit"
            :data-status="isLoss ? 'loss' : 'profit'"
            class="mt-6 flex items-center justify-between rounded-2xl px-4 py-4"
            :class="
              isLoss
                ? 'bg-ios-red-soft text-ios-red-deep'
                : 'bg-ios-green-soft text-ios-green-deep'
            "
          >
            <div class="flex items-center gap-2">
              <span class="text-[15px] font-bold">
                {{ t("dailyPnl.net.title") }}
              </span>
              <span
                data-testid="pnl-net-label"
                class="rounded-full bg-white px-2.5 py-0.5 text-[12px] font-bold"
              >
                {{ isLoss ? t("dailyPnl.net.loss") : t("dailyPnl.net.profit") }}
              </span>
            </div>
            <span
              data-testid="pnl-net-amount"
              class="text-[22px] font-bold tabular-nums"
            >
              {{ money(statement.netProfitCents) }}
            </span>
          </div>
        </section>

        <section class="ui-panel mt-4 rounded-3xl bg-white p-5 shadow-ios-sm">
          <h2 class="text-[15px] font-bold text-ios-text">
            {{ t("dailyPnl.expenses.title") }}
          </h2>

          <ul
            v-if="statement.expenses.items.length > 0"
            data-testid="pnl-expense-list"
            class="mt-2"
          >
            <li
              v-for="expense in statement.expenses.items"
              :key="expense.id"
              :data-testid="`pnl-expense-${expense.id}`"
              class="flex items-center justify-between gap-3 py-2 text-[14px]"
            >
              <div class="min-w-0">
                <p class="font-medium text-ios-text">
                  {{ categoryLabel(expense.category) }}
                </p>
                <p
                  v-if="expense.note"
                  class="truncate text-[12px] text-ios-secondary"
                >
                  {{ expense.note }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span class="tabular-nums">{{
                  money(expense.amountCents)
                }}</span>
                <button
                  type="button"
                  :data-testid="`pnl-expense-delete-${expense.id}`"
                  :aria-label="`${t('dailyPnl.expenses.delete')}: ${categoryLabel(expense.category)} ${money(expense.amountCents)}`"
                  :disabled="busy"
                  class="rounded-full p-2 text-ios-red transition-colors duration-200 hover:bg-ios-red-soft disabled:opacity-50"
                  @click="removeExpense(expense)"
                >
                  <Trash2 class="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          </ul>
          <p v-else class="mt-2 text-[13px] text-ios-secondary">
            {{ t("dailyPnl.expenses.empty") }}
          </p>

          <form
            data-testid="pnl-expense-form"
            class="mt-4 flex flex-wrap items-end gap-3"
            @submit.prevent="submitExpense"
          >
            <label class="text-[12px] font-medium text-ios-secondary">
              {{ t("dailyPnl.expenses.category") }}
              <select
                v-model="form.category"
                data-testid="pnl-expense-category"
                class="mt-1 block rounded-xl bg-ios-bg px-3 py-2 text-[14px] text-ios-text outline-none"
              >
                <option
                  v-for="category in EXPENSE_CATEGORIES"
                  :key="category"
                  :value="category"
                >
                  {{ categoryLabel(category) }}
                </option>
              </select>
            </label>
            <label class="text-[12px] font-medium text-ios-secondary">
              {{ t("dailyPnl.expenses.amount", { symbol: currencySymbol }) }}
              <input
                v-model.number="form.amount"
                type="number"
                min="0"
                :step="amountStep"
                inputmode="decimal"
                data-testid="pnl-expense-amount"
                class="mt-1 block w-36 rounded-xl bg-ios-bg px-3 py-2 text-[14px] text-ios-text outline-none"
              />
            </label>
            <label
              class="min-w-[140px] flex-1 text-[12px] font-medium text-ios-secondary"
            >
              {{ t("dailyPnl.expenses.note") }}
              <input
                v-model="form.note"
                type="text"
                maxlength="200"
                data-testid="pnl-expense-note"
                class="mt-1 block w-full rounded-xl bg-ios-bg px-3 py-2 text-[14px] text-ios-text outline-none"
              />
            </label>
            <button
              type="submit"
              data-testid="pnl-expense-add"
              :disabled="busy"
              class="rounded-full bg-ios-blue px-5 py-2 text-[14px] font-semibold text-white transition-colors duration-200 disabled:opacity-50"
            >
              {{ t("dailyPnl.expenses.add") }}
            </button>
          </form>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { Trash2 } from "lucide-vue-next";
import { useToast } from "vue-toastification";
import {
  DEFAULT_CURRENCY,
  currencyStepCents,
  formatCurrency,
  getCurrencySymbol,
  normalizeCurrencyCode,
  roundToCurrencyCents,
} from "@makanmasak/utils";
import { useI18n } from "@/i18n";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useAuthStore } from "@/stores/auth";
import {
  EXPENSE_CATEGORIES,
  pnlService,
  type DailyExpense,
  type DailyPnl,
  type ExpenseCategory,
} from "@/services/pnlService";
import { extractApiErrorCode } from "@/utils/errorHandler";

/**
 * 日帳損益表。All figures arrive as integer cents plus the statement's own
 * currency, so every amount is formatted with that currency rather than the
 * global admin one.
 */

const { t } = useI18n();
const toast = useToast();
const { confirm } = useConfirmModal();
const authStore = useAuthStore();

const restaurantId = computed(() => authStore.restaurantId);

/** Local calendar day as YYYY-MM-DD (toISOString would be the UTC day). */
function localDay(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const today = localDay();
const date = ref(today);
const statement = ref<DailyPnl | null>(null);
const isLoading = ref(false);
const busy = ref(false);
const form = reactive<{
  category: ExpenseCategory;
  amount: number | "";
  note: string;
}>({ category: "labor", amount: "", note: "" });

const currency = computed(
  () => normalizeCurrencyCode(statement.value?.currency) ?? DEFAULT_CURRENCY,
);
const currencySymbol = computed(() => getCurrencySymbol(currency.value));
/** Major-unit `step` for the amount input: 1 for TWD/VND, 0.01 for MYR. */
const amountStep = computed(() =>
  String(currencyStepCents(currency.value) / 100),
);

const isLoss = computed(() => (statement.value?.netProfitCents ?? 0) < 0);

const grossMarginLabel = computed(() => {
  const current = statement.value;
  if (!current || current.revenue.netRevenueCents === 0) return "—";
  const margin =
    (current.grossProfitCents / current.revenue.netRevenueCents) * 100;
  return `${margin.toFixed(1)}%`;
});

function money(cents: number): string {
  const text = formatCurrency(Math.abs(cents) / 100, currency.value);
  return cents < 0 ? `−${text}` : text;
}

// Literal keys, so the i18n parity scan can see every one of them.
function categoryLabel(category: ExpenseCategory): string {
  switch (category) {
    case "labor":
      return t("dailyPnl.expenses.categories.labor");
    case "rent":
      return t("dailyPnl.expenses.categories.rent");
    case "utilities":
      return t("dailyPnl.expenses.categories.utilities");
    case "purchase":
      return t("dailyPnl.expenses.categories.purchase");
    default:
      return t("dailyPnl.expenses.categories.misc");
  }
}

function reportError(cause: unknown, fallback: string): void {
  switch (extractApiErrorCode(cause)) {
    case "CURRENCY_PRECISION":
      toast.error(t("dailyPnl.errors.precision"));
      return;
    case "EXPENSE_NOT_FOUND":
      toast.error(t("dailyPnl.errors.notFound"));
      return;
    default:
      toast.error(fallback);
  }
}

let loadToken = 0;

/** `keep` leaves the current statement on screen while a refetch is in flight. */
async function load(keep = false): Promise<void> {
  const id = restaurantId.value;
  if (!id) return;

  const token = ++loadToken;
  if (!keep) statement.value = null;
  isLoading.value = true;
  try {
    const result = await pnlService.getDaily(id, date.value);
    if (token === loadToken) statement.value = result;
  } catch (cause) {
    if (token === loadToken && keep) {
      reportError(cause, t("dailyPnl.errors.loadFailed"));
    }
  } finally {
    if (token === loadToken) isLoading.value = false;
  }
}

watch(date, (value) => {
  if (value > today) {
    date.value = today;
    return;
  }
  if (value) void load();
});

async function submitExpense(): Promise<void> {
  const id = restaurantId.value;
  const amount = form.amount;
  if (!id || busy.value) return;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    toast.error(t("dailyPnl.errors.amountInvalid"));
    return;
  }

  busy.value = true;
  try {
    const note = form.note.trim();
    await pnlService.addExpense(id, {
      date: date.value,
      category: form.category,
      amountCents: roundToCurrencyCents(
        Math.round(amount * 100),
        currency.value,
      ),
      ...(note ? { note } : {}),
    });
    toast.success(t("dailyPnl.toast.added"));
    form.amount = "";
    form.note = "";
    await load(true);
  } catch (cause) {
    reportError(cause, t("dailyPnl.errors.addFailed"));
  } finally {
    busy.value = false;
  }
}

async function removeExpense(expense: DailyExpense): Promise<void> {
  const id = restaurantId.value;
  if (!id || busy.value) return;

  const confirmed = await confirm({
    type: "danger",
    title: t("dailyPnl.expenses.deleteTitle"),
    message: t("dailyPnl.expenses.deleteMessage", {
      category: categoryLabel(expense.category),
      amount: money(expense.amountCents),
    }),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed) return;

  busy.value = true;
  try {
    await pnlService.deleteExpense(id, expense.id);
    toast.success(t("dailyPnl.toast.deleted"));
    await load(true);
  } catch (cause) {
    reportError(cause, t("dailyPnl.errors.deleteFailed"));
    // A 404 means it is already gone; show the truth either way.
    await load(true);
  } finally {
    busy.value = false;
  }
}

onMounted(() => void load());
</script>
