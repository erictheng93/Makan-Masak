<template>
  <div class="pnl-print-page ui-page min-h-screen bg-ios-bg p-4 md:p-6">
    <div class="mx-auto max-w-3xl">
      <header class="mb-4">
        <h1 class="ui-page-heading text-[22px] font-bold text-ios-text">
          {{ t("dailyPnl.title") }}
        </h1>
        <p class="pnl-noprint mt-1 text-[13px] text-ios-secondary">
          {{ t("dailyPnl.description") }}
        </p>
        <p
          data-testid="pnl-print-period"
          class="pnl-print-only mt-1 text-[14px] text-ios-text"
        >
          {{ printPeriod }}
        </p>
      </header>

      <!-- Same place in both modes; only the date input comes and goes. -->
      <div class="pnl-noprint mb-4 flex flex-wrap items-end gap-3">
        <div
          role="group"
          :aria-label="t('dailyPnl.mode.label')"
          class="flex rounded-full bg-white p-1 shadow-ios-sm"
        >
          <button
            v-for="option in modes"
            :key="option.id"
            type="button"
            :data-testid="`pnl-mode-${option.id}`"
            :aria-pressed="mode === option.id"
            class="rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors duration-200"
            :class="
              mode === option.id ? 'bg-ios-blue text-white' : 'text-ios-text'
            "
            @click="mode = option.id"
          >
            {{ option.label }}
          </button>
        </div>
        <button
          v-if="restaurantId"
          type="button"
          data-testid="pnl-rates-open"
          :aria-expanded="ratesOpen"
          class="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-ios-text shadow-ios-sm transition-colors duration-200"
          @click="ratesOpen = !ratesOpen"
        >
          {{ t("dailyPnl.rates.open") }}
        </button>
        <label
          v-if="mode === 'day'"
          class="text-[12px] font-medium text-ios-secondary"
        >
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
        <div
          v-if="restaurantId && exportReady"
          role="group"
          :aria-label="t('dailyPnl.export.label')"
          class="ml-auto flex items-center gap-2"
        >
          <span class="text-[12px] font-medium text-ios-secondary">
            {{ t("dailyPnl.export.label") }}
          </span>
          <button
            type="button"
            data-testid="pnl-export-csv"
            class="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-ios-text shadow-ios-sm transition-colors duration-200"
            @click="exportCsv"
          >
            {{ t("dailyPnl.export.csv") }}
          </button>
          <button
            type="button"
            data-testid="pnl-export-xlsx"
            class="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-ios-text shadow-ios-sm transition-colors duration-200"
            @click="exportXlsx"
          >
            {{ t("dailyPnl.export.excel") }}
          </button>
          <button
            type="button"
            data-testid="pnl-print"
            class="rounded-full bg-ios-blue px-4 py-2 text-[13px] font-semibold text-white transition-colors duration-200"
            @click="printPage"
          >
            {{ t("dailyPnl.export.print") }}
          </button>
        </div>
      </div>

      <PnlRatesForm
        v-if="ratesOpen && restaurantId"
        :restaurant-id="restaurantId"
        :today="today"
        @close="ratesOpen = false"
        @saved="onRatesSaved"
      />

      <div
        v-if="!restaurantId"
        data-testid="pnl-no-restaurant"
        class="ui-panel rounded-3xl bg-white p-10 text-center text-[15px] font-semibold text-ios-text shadow-ios-sm"
      >
        {{ t("dailyPnl.noRestaurant") }}
      </div>

      <PnlRangePanel
        v-else-if="mode === 'range'"
        :restaurant-id="restaurantId"
        :today="today"
        :refresh-key="rangeKey"
        @pick="pickDay"
        @loaded="rangeData = $event"
      />

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
            <template v-if="statement.revenue.taxCents > 0">
              <div class="flex justify-between py-1.5">
                <dt class="text-ios-text">
                  {{ t("dailyPnl.revenue.collected") }}
                </dt>
                <dd data-testid="pnl-collected" class="tabular-nums">
                  {{ money(statement.revenue.collectedCents) }}
                </dd>
              </div>
              <div class="flex justify-between py-1.5">
                <dt class="text-ios-text">− {{ t("dailyPnl.revenue.tax") }}</dt>
                <dd data-testid="pnl-tax" class="tabular-nums">
                  {{ money(statement.revenue.taxCents) }}
                </dd>
              </div>
            </template>
            <div
              class="flex justify-between rounded-xl bg-ios-bg px-3 py-2 font-bold"
            >
              <dt class="text-ios-text">= {{ netRevenueLabel }}</dt>
              <dd data-testid="pnl-net-revenue" class="tabular-nums">
                {{ money(statement.revenue.netRevenueCents) }}
              </dd>
            </div>
          </dl>
          <p class="mt-2 text-[12px] text-ios-secondary">
            {{
              t("dailyPnl.revenue.serviceMemo", {
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
          <p
            v-if="statement.revenue.taxCents > 0"
            data-testid="pnl-collected-note"
            class="mt-1 text-[12px] text-ios-secondary"
          >
            {{ t("dailyPnl.revenue.collectedNote") }}
          </p>

          <dl class="mt-1 text-[14px]">
            <div class="flex justify-between py-1.5">
              <dt class="text-ios-text">− {{ t("dailyPnl.cogs.title") }}</dt>
              <dd data-testid="pnl-cogs" class="tabular-nums">
                {{ money(statement.cogs.totalCents) }}
              </dd>
            </div>
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

          <dl class="mt-3 text-[14px]">
            <div
              v-if="!statement.fees.configured"
              data-testid="pnl-fees-unconfigured"
              class="py-1.5 text-[13px] text-ios-secondary"
            >
              {{ t("dailyPnl.fees.notConfigured") }}
              <button
                type="button"
                data-testid="pnl-fees-setup"
                class="pnl-noprint font-semibold text-ios-blue underline underline-offset-2"
                @click="ratesOpen = true"
              >
                {{ t("dailyPnl.fees.setRates") }}
              </button>
            </div>
            <template v-else>
              <div class="flex justify-between py-1.5">
                <dt class="text-ios-text">
                  − {{ t("dailyPnl.fees.payment") }}
                </dt>
                <dd data-testid="pnl-payment-fee" class="tabular-nums">
                  {{ money(statement.fees.paymentFeeCents) }}
                </dd>
              </div>
              <div class="flex justify-between py-1.5">
                <dt class="text-ios-text">
                  − {{ t("dailyPnl.fees.platform") }}
                </dt>
                <dd data-testid="pnl-platform-commission" class="tabular-nums">
                  {{ money(statement.fees.platformCommissionCents) }}
                </dd>
              </div>
            </template>
            <div class="flex justify-between py-1.5">
              <dt class="text-ios-text">− {{ t("dailyPnl.labor.title") }}</dt>
              <dd data-testid="pnl-labor" class="tabular-nums">
                {{ money(statement.labor.costCents) }}
              </dd>
            </div>
            <div class="flex justify-between py-1.5">
              <dt class="text-ios-text">
                − {{ t("dailyPnl.expenses.title") }}
              </dt>
              <dd data-testid="pnl-expenses-total" class="tabular-nums">
                {{ money(statement.expenses.totalCents) }}
              </dd>
            </div>
            <div
              v-for="row in statement.expenses.byCategory"
              :key="row.category"
              class="flex justify-between py-1 pl-5 text-[13px] text-ios-secondary"
            >
              <dt>{{ categoryLabel(row.category) }}</dt>
              <dd class="tabular-nums">{{ money(row.amountCents) }}</dd>
            </div>
          </dl>
          <p
            v-if="statement.labor.shiftsMissingRate > 0"
            data-testid="pnl-labor-missing-rate"
            class="mt-1 text-[12px] text-ios-secondary"
          >
            {{
              t("dailyPnl.labor.missingRate", {
                count: statement.labor.shiftsMissingRate,
              })
            }}
            <RouterLink
              to="/dashboard/employees"
              data-testid="pnl-labor-set-wage"
              class="pnl-noprint font-semibold text-ios-blue underline underline-offset-2"
            >
              {{ t("dailyPnl.labor.setWage") }}
            </RouterLink>
          </p>

          <div
            data-testid="pnl-net-profit"
            :data-status="netStatus"
            class="mt-6 flex items-center justify-between rounded-2xl px-4 py-4"
            :class="netClass"
          >
            <div class="flex items-center gap-2">
              <span class="text-[15px] font-bold">
                {{ t("dailyPnl.net.title") }}
              </span>
              <span
                data-testid="pnl-net-label"
                class="rounded-full bg-white px-2.5 py-0.5 text-[12px] font-bold"
              >
                {{ netLabel }}
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
            {{ t("dailyPnl.expenses.entryTitle") }}
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
                  class="pnl-noprint rounded-full p-2 text-ios-red transition-colors duration-200 hover:bg-ios-red-soft disabled:opacity-50"
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
            class="pnl-noprint mt-4 flex flex-wrap items-end gap-3"
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
          <p class="pnl-noprint mt-3 text-[12px] text-ios-secondary">
            {{ t("dailyPnl.labor.expenseNote") }}
          </p>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { Trash2 } from "lucide-vue-next";
import { useToast } from "vue-toastification";
import {
  DEFAULT_CURRENCY,
  currencyStepCents,
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
  type PnlRange,
} from "@/services/pnlService";
import PnlRangePanel from "@/components/pnl/PnlRangePanel.vue";
import PnlRatesForm from "@/components/pnl/PnlRatesForm.vue";
import { extractApiErrorCode } from "@/utils/errorHandler";
import {
  PNL_STATUS_CLASS,
  buildPnlDayCsv,
  buildPnlDaySheet,
  buildPnlRangeCsv,
  buildPnlRangeSheet,
  downloadCsv,
  downloadXlsx,
  formatPnlMoney,
  pnlStatus,
  pnlStatusLabel,
} from "@/utils/pnl";

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
const mode = ref<"day" | "range">("day");
const ratesOpen = ref(false);
const rangeKey = ref(0);
const modes = computed(() => [
  { id: "day" as const, label: t("dailyPnl.mode.day") },
  { id: "range" as const, label: t("dailyPnl.mode.range") },
]);
const statement = ref<DailyPnl | null>(null);
const rangeData = ref<PnlRange | null>(null);
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

const netStatus = computed(() =>
  pnlStatus(statement.value?.netProfitCents ?? 0),
);
const netClass = computed(() => PNL_STATUS_CLASS[netStatus.value]);
const netLabel = computed(() => pnlStatusLabel(netStatus.value, t));

const grossMarginLabel = computed(() => {
  const current = statement.value;
  if (!current || current.revenue.netRevenueCents === 0) return "—";
  const margin =
    (current.grossProfitCents / current.revenue.netRevenueCents) * 100;
  return `${margin.toFixed(1)}%`;
});

function money(cents: number): string {
  return formatPnlMoney(cents, currency.value);
}

/** Exports and print act on whatever the current mode has on screen. */
const exportReady = computed(() =>
  mode.value === "day" ? statement.value !== null : rangeData.value !== null,
);

const printPeriod = computed(() =>
  mode.value === "range" && rangeData.value
    ? `${rangeData.value.from} – ${rangeData.value.to}`
    : date.value,
);

const netRevenueLabel = computed(() =>
  (statement.value?.revenue.taxCents ?? 0) > 0
    ? t("dailyPnl.revenue.netExTax")
    : t("dailyPnl.revenue.net"),
);

const rangeHeaders = computed(() => ({
  date: t("dailyPnl.range.columns.date"),
  orders: t("dailyPnl.range.columns.orders"),
  netRevenue: t("dailyPnl.range.columns.netRevenue"),
  cogs: t("dailyPnl.range.columns.cogs"),
  grossProfit: t("dailyPnl.range.columns.grossProfit"),
  fees: t("dailyPnl.range.columns.fees"),
  labor: t("dailyPnl.range.columns.labor"),
  expenses: t("dailyPnl.range.columns.expenses"),
  netProfit: t("dailyPnl.range.columns.netProfit"),
  totals: t("dailyPnl.range.totals"),
}));

const dayLabels = computed(() => ({
  date: t("dailyPnl.date"),
  item: t("dailyPnl.export.item"),
  amount: t("dailyPnl.export.amount"),
  grossSales: t("dailyPnl.revenue.grossSales"),
  discount: t("dailyPnl.revenue.discount"),
  refund: t("dailyPnl.revenue.refund"),
  collected: t("dailyPnl.revenue.collected"),
  tax: t("dailyPnl.revenue.tax"),
  netRevenue: t("dailyPnl.revenue.netExTax"),
  cogs: t("dailyPnl.cogs.title"),
  grossProfit: t("dailyPnl.cogs.grossProfit"),
  grossMargin: t("dailyPnl.cogs.grossMargin"),
  paymentFee: t("dailyPnl.fees.payment"),
  platformCommission: t("dailyPnl.fees.platform"),
  labor: t("dailyPnl.labor.title"),
  expenses: t("dailyPnl.expenses.title"),
  entries: t("dailyPnl.expenses.entryTitle"),
  category: t("dailyPnl.expenses.category"),
  note: t("dailyPnl.expenses.note"),
  netProfit: t("dailyPnl.net.title"),
}));

function exportCsv(): void {
  if (mode.value === "range" && rangeData.value) {
    const r = rangeData.value;
    downloadCsv(
      buildPnlRangeCsv(r, rangeHeaders.value),
      `pnl_${r.from}_${r.to}.csv`,
    );
  } else if (mode.value === "day" && statement.value) {
    downloadCsv(
      buildPnlDayCsv(statement.value, dayLabels.value, categoryLabel),
      `pnl_${statement.value.date}.csv`,
    );
  }
}

async function exportXlsx(): Promise<void> {
  const sheetName = t("dailyPnl.title");
  try {
    if (mode.value === "range" && rangeData.value) {
      const r = rangeData.value;
      await downloadXlsx(
        buildPnlRangeSheet(r, rangeHeaders.value),
        `pnl_${r.from}_${r.to}.xlsx`,
        sheetName,
      );
    } else if (mode.value === "day" && statement.value) {
      await downloadXlsx(
        buildPnlDaySheet(statement.value, dayLabels.value, categoryLabel),
        `pnl_${statement.value.date}.xlsx`,
        sheetName,
      );
    }
  } catch {
    toast.error(t("dailyPnl.errors.exportFailed"));
  }
}

function printPage(): void {
  window.print();
}

function pickDay(day: string): void {
  date.value = day;
  mode.value = "day";
}

async function onRatesSaved(): Promise<void> {
  rangeKey.value += 1;
  await load(true);
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
    case "EXPENSE_DATE_IN_FUTURE":
      toast.error(t("dailyPnl.errors.dateInFuture"));
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
onUnmounted(() => {
  rangeData.value = null;
});
</script>

<!-- Unscoped on purpose (it has to reach the layout shell), but every rule is
     behind body:has(.pnl-print-page), so it cannot touch any other page. -->
<style>
.pnl-print-only {
  display: none;
}

@media print {
  body:has(.pnl-print-page) .pnl-print-only {
    display: block;
  }
  body:has(.pnl-print-page) .pnl-noprint,
  body:has(.pnl-print-page) .admin-shell > :not(.min-w-0),
  body:has(.pnl-print-page) .admin-shell > .min-w-0 > :not(main),
  body:has(.pnl-print-page) .Vue-Toastification__container,
  body:has(.pnl-print-page) .nav-progress {
    display: none !important;
  }
  body:has(.pnl-print-page) .admin-shell,
  body:has(.pnl-print-page) .admin-shell > .min-w-0,
  body:has(.pnl-print-page) .admin-content {
    display: block;
    height: auto;
    overflow: visible;
  }
  body:has(.pnl-print-page) .pnl-print-page {
    min-height: 0;
    padding: 0;
    background: #fff;
  }
  body:has(.pnl-print-page) .pnl-print-page .ui-panel {
    box-shadow: none;
    break-inside: avoid;
  }
  body:has(.pnl-print-page) .pnl-table-wrap {
    overflow: visible;
  }
  body:has(.pnl-print-page) .pnl-table {
    min-width: 0;
    font-size: 11px;
  }
  body:has(.pnl-print-page) .pnl-table .sticky {
    position: static;
  }
  body:has(.pnl-print-page) .pnl-table tr {
    break-inside: avoid;
  }
}
</style>
