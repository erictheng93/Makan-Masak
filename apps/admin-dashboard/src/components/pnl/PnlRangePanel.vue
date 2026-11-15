<template>
  <div data-testid="pnl-range">
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="text-[12px] font-medium text-ios-secondary">
        {{ t("dailyPnl.range.from") }}
        <input
          v-model="from"
          type="date"
          :max="today"
          required
          data-testid="pnl-range-from"
          class="mt-1 block rounded-xl bg-white px-3 py-2 text-[14px] text-ios-text shadow-ios-sm outline-none"
        />
      </label>
      <label class="text-[12px] font-medium text-ios-secondary">
        {{ t("dailyPnl.range.to") }}
        <input
          v-model="to"
          type="date"
          :max="today"
          required
          data-testid="pnl-range-to"
          class="mt-1 block rounded-xl bg-white px-3 py-2 text-[14px] text-ios-text shadow-ios-sm outline-none"
        />
      </label>
      <button
        v-if="range"
        type="button"
        data-testid="pnl-range-export"
        class="ml-auto rounded-full bg-ios-blue px-5 py-2 text-[14px] font-semibold text-white transition-colors duration-200"
        @click="exportCsv"
      >
        {{ t("dailyPnl.range.export") }}
      </button>
    </div>
    <p
      v-if="clamped"
      role="status"
      data-testid="pnl-range-clamped"
      class="mb-4 rounded-2xl bg-ios-orange-soft px-4 py-3 text-[13px] font-medium text-ios-orange-deep"
    >
      {{ t("dailyPnl.range.clamped", { days: PNL_MAX_RANGE_DAYS }) }}
    </p>

    <div
      v-if="range === null && isLoading"
      data-testid="pnl-range-loading"
      class="ui-panel rounded-3xl bg-white p-10 text-center text-[14px] text-ios-secondary shadow-ios-sm"
    >
      {{ t("common.loading") }}
    </div>
    <div
      v-else-if="range === null"
      role="alert"
      data-testid="pnl-range-error"
      class="ui-panel rounded-3xl bg-white p-10 text-center shadow-ios-sm"
    >
      <p class="text-[15px] font-semibold text-ios-text">
        {{
          invalid ? t("dailyPnl.range.invalid") : t("dailyPnl.range.loadFailed")
        }}
      </p>
      <button
        v-if="!invalid"
        type="button"
        data-testid="pnl-range-retry"
        class="mt-4 rounded-full bg-ios-blue px-5 py-2 text-[14px] font-semibold text-white"
        @click="load()"
      >
        {{ t("common.retry") }}
      </button>
    </div>

    <template v-else>
      <section
        data-testid="pnl-range-totals"
        class="ui-panel rounded-3xl bg-white p-5 shadow-ios-card"
      >
        <h2 class="text-[15px] font-bold text-ios-text">
          {{ t("dailyPnl.range.totals") }}
          <span class="text-[12px] font-medium text-ios-secondary">
            {{ range.from }} – {{ range.to }}
          </span>
        </h2>
        <dl class="mt-2 text-[14px]">
          <div
            v-for="line in totalLines"
            :key="line.id"
            class="flex justify-between py-1.5"
            :class="line.strong ? 'rounded-xl bg-ios-bg px-3 font-bold' : ''"
          >
            <dt class="text-ios-text">{{ line.label }}</dt>
            <dd
              :data-testid="`pnl-range-total-${line.id}`"
              class="tabular-nums"
            >
              {{ money(line.cents) }}
            </dd>
          </div>
        </dl>
        <div
          data-testid="pnl-range-net"
          :data-status="pnlStatus(range.totals.netProfitCents)"
          class="mt-4 flex items-center justify-between rounded-2xl px-4 py-3"
          :class="PNL_STATUS_CLASS[pnlStatus(range.totals.netProfitCents)]"
        >
          <span class="flex items-center gap-2 text-[15px] font-bold">
            {{ t("dailyPnl.range.columns.netProfit") }}
            <span
              class="rounded-full bg-white px-2.5 py-0.5 text-[12px] font-bold"
            >
              {{ pnlStatusLabel(pnlStatus(range.totals.netProfitCents), t) }}
            </span>
          </span>
          <span class="text-[20px] font-bold tabular-nums">
            {{ money(range.totals.netProfitCents) }}
          </span>
        </div>
      </section>

      <section class="ui-panel mt-4 rounded-3xl bg-white p-5 shadow-ios-sm">
        <p class="text-[12px] text-ios-secondary">
          {{ t("dailyPnl.range.hint") }}
        </p>
        <!-- The table scrolls inside this box, so the page itself never does. -->
        <div
          class="mt-2 overflow-x-auto"
          role="region"
          tabindex="0"
          :aria-label="t('dailyPnl.range.tableLabel')"
        >
          <table
            data-testid="pnl-range-table"
            class="w-full min-w-[720px] border-separate border-spacing-0 text-[13px]"
          >
            <thead>
              <tr class="text-left text-ios-secondary">
                <th
                  v-for="(col, index) in columns"
                  :key="col.id"
                  scope="col"
                  class="whitespace-nowrap px-2 py-2 font-medium"
                  :class="
                    index === 0 ? 'sticky left-0 z-10 bg-white' : 'text-right'
                  "
                >
                  {{ col.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="day in range.days"
                :key="day.date"
                :data-testid="`pnl-range-row-${day.date}`"
                class="cursor-pointer transition-colors duration-200 hover:bg-ios-bg"
                @click="emit('pick', day.date)"
              >
                <th
                  scope="row"
                  class="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-2 text-left font-medium"
                >
                  <button
                    type="button"
                    :data-testid="`pnl-range-pick-${day.date}`"
                    class="rounded-lg text-ios-blue underline underline-offset-2"
                    @click.stop="emit('pick', day.date)"
                  >
                    {{ day.date }}
                  </button>
                </th>
                <td
                  class="px-2 py-2 text-right font-bold tabular-nums"
                  :data-status="pnlStatus(day.netProfitCents)"
                  :class="
                    day.netProfitCents < 0
                      ? 'text-ios-red-deep'
                      : day.netProfitCents > 0
                        ? 'text-ios-green-deep'
                        : 'text-ios-text'
                  "
                >
                  <!-- The minus sign and 虧 tag mean a loss without colour. -->
                  <span
                    v-if="day.netProfitCents < 0"
                    class="mr-1 rounded-full bg-ios-red-soft px-1.5 py-0.5 text-[11px]"
                  >
                    {{ t("dailyPnl.net.loss") }}
                  </span>
                  {{ money(day.netProfitCents) }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums">
                  {{ day.orderCount }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums">
                  {{ money(day.netRevenueCents) }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums">
                  {{ money(day.cogsCents) }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums">
                  {{ money(day.grossProfitCents) }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums">
                  {{ money(day.feesCents) }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums">
                  {{ money(day.laborCents) }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums">
                  {{ money(day.expensesCents) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import {
  PNL_MAX_RANGE_DAYS,
  pnlService,
  type PnlRange,
} from "@/services/pnlService";
import { extractApiErrorCode } from "@/utils/errorHandler";
import {
  PNL_RANGE_DEFAULT_DAYS,
  PNL_STATUS_CLASS,
  pnlStatus,
  pnlStatusLabel,
  buildPnlRangeCsv,
  downloadCsv,
  formatPnlMoney,
  inclusiveDays,
  shiftDay,
} from "@/utils/pnl";

const props = defineProps<{
  restaurantId: string;
  today: string;
  /** Bump to refetch (e.g. after the fee rates changed). */
  refreshKey?: number;
}>();
const emit = defineEmits<{ pick: [date: string] }>();

const { t } = useI18n();

const to = ref(props.today);
const from = ref(shiftDay(props.today, 1 - PNL_RANGE_DEFAULT_DAYS));
const range = ref<PnlRange | null>(null);
const isLoading = ref(false);
const invalid = ref(false);
const clamped = ref(false);

const money = (cents: number) =>
  formatPnlMoney(cents, range.value?.currency ?? "TWD");

const columns = computed(() => [
  { id: "date", label: t("dailyPnl.range.columns.date") },
  // Right after the sticky date so it is visible without scrolling.
  { id: "netProfit", label: t("dailyPnl.range.columns.netProfit") },
  { id: "orders", label: t("dailyPnl.range.columns.orders") },
  { id: "netRevenue", label: t("dailyPnl.range.columns.netRevenue") },
  { id: "cogs", label: t("dailyPnl.range.columns.cogs") },
  { id: "grossProfit", label: t("dailyPnl.range.columns.grossProfit") },
  { id: "fees", label: t("dailyPnl.range.columns.fees") },
  { id: "labor", label: t("dailyPnl.range.columns.labor") },
  { id: "expenses", label: t("dailyPnl.range.columns.expenses") },
]);

// Same order as the single-day statement.
const totalLines = computed(() => {
  const totals = range.value?.totals;
  if (!totals) return [];
  return [
    {
      id: "netRevenue",
      label: t("dailyPnl.revenue.net"),
      cents: totals.netRevenueCents,
      strong: true,
    },
    {
      id: "cogs",
      label: `− ${t("dailyPnl.cogs.title")}`,
      cents: totals.cogsCents,
    },
    {
      id: "grossProfit",
      label: `= ${t("dailyPnl.cogs.grossProfit")}`,
      cents: totals.grossProfitCents,
      strong: true,
    },
    {
      id: "fees",
      label: `− ${t("dailyPnl.range.columns.fees")}`,
      cents: totals.feesCents,
    },
    {
      id: "labor",
      label: `− ${t("dailyPnl.labor.title")}`,
      cents: totals.laborCents,
    },
    {
      id: "expenses",
      label: `− ${t("dailyPnl.expenses.title")}`,
      cents: totals.expensesCents,
    },
  ];
});

let loadToken = 0;
let justClamped = false;

async function load(): Promise<void> {
  const token = ++loadToken;
  range.value = null;
  invalid.value = false;
  isLoading.value = true;
  try {
    const result = await pnlService.getRange(
      props.restaurantId,
      from.value,
      to.value,
    );
    if (token === loadToken) range.value = result;
  } catch (cause) {
    if (token === loadToken) {
      invalid.value = extractApiErrorCode(cause) === "PNL_RANGE_INVALID";
    }
  } finally {
    if (token === loadToken) isLoading.value = false;
  }
}

watch([from, to], () => {
  if (!from.value || !to.value) return;
  if (to.value > props.today) {
    to.value = props.today;
    return;
  }
  if (justClamped) justClamped = false;
  else clamped.value = false;
  if (from.value > to.value) {
    from.value = to.value;
    return;
  }
  if (inclusiveDays(from.value, to.value) > PNL_MAX_RANGE_DAYS) {
    clamped.value = true;
    justClamped = true; // the re-run triggered by the assignment keeps the note
    from.value = shiftDay(to.value, 1 - PNL_MAX_RANGE_DAYS);
    return;
  }
  void load();
});
watch(
  () => props.refreshKey,
  () => void load(),
);

function exportCsv(): void {
  const current = range.value;
  if (!current) return;
  downloadCsv(
    buildPnlRangeCsv(current, {
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
    }),
    `pnl_${current.from}_${current.to}.csv`,
  );
}

onMounted(() => void load());
</script>
