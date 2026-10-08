<template>
  <section
    class="rounded-2xl bg-white p-6 shadow-ios-card"
    aria-labelledby="open-report-title"
  >
    <div class="flex flex-wrap items-end justify-between gap-4">
      <h2 id="open-report-title" class="text-lg font-semibold text-ios-text">
        {{ t("marketOpenReport.title") }}
      </h2>
      <div class="flex flex-wrap items-end gap-3">
        <label class="text-sm text-ios-secondary">
          {{ t("marketOpenReport.from") }}
          <input
            v-model="from"
            type="date"
            data-testid="open-report-from"
            class="mt-1 block rounded-full bg-ios-bg px-4 py-2 text-sm text-ios-text"
            @change="load"
          />
        </label>
        <label class="text-sm text-ios-secondary">
          {{ t("marketOpenReport.to") }}
          <input
            v-model="to"
            type="date"
            data-testid="open-report-to"
            class="mt-1 block rounded-full bg-ios-bg px-4 py-2 text-sm text-ios-text"
            @change="load"
          />
        </label>
        <div class="flex rounded-full bg-ios-bg p-1" role="tablist">
          <button
            v-for="option in views"
            :key="option"
            type="button"
            role="tab"
            :aria-selected="view === option"
            :data-testid="`open-report-view-${option}`"
            class="min-h-9 rounded-full px-4 text-sm font-medium transition-colors duration-200 ease-out"
            :class="
              view === option
                ? 'bg-white text-ios-text shadow-ios-card'
                : 'text-ios-secondary'
            "
            @click="view = option"
          >
            {{ t(`marketOpenReport.view.${option}`) }}
          </button>
        </div>
        <button
          type="button"
          data-testid="open-report-export"
          :disabled="!report"
          class="min-h-11 rounded-full bg-ios-blue px-5 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-ios-blue/90 disabled:opacity-60"
          @click="exportCsv"
        >
          {{ t("marketOpenReport.export") }}
        </button>
      </div>
    </div>

    <p v-if="loadFailed" role="alert" class="mt-4 text-sm text-ios-red">
      {{ t("marketOpenReport.loadFailed") }}
    </p>
    <p v-if="exportFailed" role="alert" class="mt-4 text-sm text-ios-red">
      {{ t("marketOpenReport.exportFailed") }}
    </p>

    <div v-if="report" class="mt-4 overflow-x-auto">
      <table v-if="view === 'daily'" class="w-full text-left text-sm">
        <thead class="text-xs text-ios-secondary">
          <tr>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.date") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.vendor") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.opened") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.closed") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.hours") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.openedBy") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.orders") }}</th>
            <th class="py-2">{{ t("marketOpenReport.col.revenue") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in report.daily"
            :key="`${row.restaurantId}-${row.businessDate}`"
            :data-testid="`open-report-daily-${row.restaurantId}-${row.businessDate}`"
            :data-auto-closed="String(row.autoClosed)"
          >
            <td class="py-2 pr-4">{{ row.businessDate }}</td>
            <td class="py-2 pr-4">{{ vendorLabel(row) }}</td>
            <td class="py-2 pr-4">
              {{ localTime(row.firstOpenedAtMs, row.offsetMinutes) }}
            </td>
            <td class="py-2 pr-4">
              {{ localTime(row.lastClosedAtMs, row.offsetMinutes) }}
              <span
                v-if="row.autoClosed"
                class="ml-1 text-xs text-ios-secondary"
                >{{ t("marketOpenReport.autoClosed") }}</span
              >
            </td>
            <td class="py-2 pr-4">{{ hours(row.openMinutes) }}</td>
            <td class="py-2 pr-4">{{ row.openedBy ?? "" }}</td>
            <td class="py-2 pr-4">{{ row.orderCount }}</td>
            <td class="py-2">{{ money(row.revenueCents, row.currency) }}</td>
          </tr>
        </tbody>
      </table>

      <table v-else class="w-full text-left text-sm">
        <thead class="text-xs text-ios-secondary">
          <tr>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.vendor") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.openDays") }}</th>
            <th class="py-2 pr-4">
              {{ t("marketOpenReport.col.attendance") }}
            </th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.avgHours") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.orders") }}</th>
            <th class="py-2">{{ t("marketOpenReport.col.revenue") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in report.summary"
            :key="row.restaurantId"
            :data-testid="`open-report-summary-${row.restaurantId}`"
          >
            <td class="py-2 pr-4">{{ vendorLabel(row) }}</td>
            <td class="py-2 pr-4">
              {{ row.openDays }} / {{ row.expectedDays }}
            </td>
            <td class="py-2 pr-4">
              {{
                row.attendanceRate === null
                  ? "—"
                  : `${Math.round(row.attendanceRate * 100)}%`
              }}
            </td>
            <td class="py-2 pr-4">{{ hours(row.avgOpenMinutes) }}</td>
            <td class="py-2 pr-4">{{ row.orderCount }}</td>
            <td class="py-2">{{ money(row.revenueCents, row.currency) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { formatCurrency } from "@makanmasak/utils";
import type { CurrencyCode } from "@makanmasak/shared-types";
import { useI18n } from "@/i18n";
import {
  marketsService,
  type MarketOpenReport,
  type MarketOpenReportScope,
} from "@/services/marketsService";

const props = defineProps<{ scope: MarketOpenReportScope }>();

const { t } = useI18n();
const views = ["daily", "summary"] as const;
const view = ref<(typeof views)[number]>("daily");
// ponytail: the viewer's local calendar date. It never falls before the stall's
// business date while the viewer is at or ahead of the stall's timezone; a
// viewer far behind it would need the stall's offset from the report first.
function isoDay(offsetDays: number) {
  const day = new Date();
  day.setDate(day.getDate() + offsetDays);
  const month = String(day.getMonth() + 1).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, "0")}`;
}
const from = ref(isoDay(-6));
const to = ref(isoDay(0));
const report = ref<MarketOpenReport | null>(null);
const loadFailed = ref(false);
const exportFailed = ref(false);
let latestLoad = 0;

async function load() {
  const loadId = ++latestLoad;
  report.value = null;
  loadFailed.value = false;
  exportFailed.value = false;
  try {
    const result = await marketsService.getMarketOpenReport(props.scope, {
      from: from.value,
      to: to.value,
    });
    if (loadId === latestLoad) report.value = result;
  } catch {
    if (loadId === latestLoad) loadFailed.value = true;
  }
}

async function exportCsv() {
  exportFailed.value = false;
  try {
    const blob = await marketsService.exportMarketOpenReportCsv(
      props.scope,
      { from: from.value, to: to.value },
      view.value,
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `market-open-report-${view.value}-${from.value}-${to.value}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    exportFailed.value = true;
  }
}

function vendorLabel(row: { vendorName: string; stallNumber: string | null }) {
  return row.stallNumber
    ? `${row.stallNumber} ${row.vendorName}`
    : row.vendorName;
}

function localTime(ms: number | null, offsetMinutes: number) {
  if (ms === null) return "";
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(11, 16);
}

function hours(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function money(cents: number, currency: string) {
  return formatCurrency(cents / 100, currency as CurrencyCode);
}

onMounted(load);
// Keyed on the values: parents pass `scope` as an inline object, so a fresh
// object arrives on every parent render and a reference watch would reload.
watch(
  () =>
    [
      props.scope.kind,
      props.scope.marketId,
      props.scope.kind === "owner" ? props.scope.restaurantId : "",
    ].join("|"),
  load,
);
</script>
