import {
  DEFAULT_CURRENCY,
  formatCurrency,
  getCurrencyConfig,
  normalizeCurrencyCode,
} from "@makanmasak/utils";
import { PNL_MAX_RANGE_DAYS, type PnlRange } from "@/services/pnlService";
import { toCsv } from "@/utils/csv";

/** Cents formatted in the statement's own currency; losses get a real minus. */
export function formatPnlMoney(cents: number, currency: string): string {
  const code = normalizeCurrencyCode(currency) ?? DEFAULT_CURRENCY;
  const text = formatCurrency(Math.abs(cents) / 100, code);
  return cents < 0 ? `−${text}` : text;
}

/** Shift a YYYY-MM-DD day by whole days (UTC maths, so DST cannot skew it). */
export function shiftDay(day: string, offset: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}

/** Inclusive number of calendar days from `from` to `to`. */
export function inclusiveDays(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
}

export const PNL_RANGE_DEFAULT_DAYS = 7;
export { PNL_MAX_RANGE_DAYS };

/** Plain major-unit number for the currency: no symbol, no separators. */
function plainAmount(cents: number, currency: string): string {
  const code = normalizeCurrencyCode(currency) ?? DEFAULT_CURRENCY;
  const decimals = getCurrencyConfig(code)?.decimals ?? 0;
  return (cents / 100).toFixed(decimals);
}

export interface PnlCsvHeaders {
  date: string;
  orders: string;
  netRevenue: string;
  cogs: string;
  grossProfit: string;
  fees: string;
  labor: string;
  expenses: string;
  netProfit: string;
  totals: string;
}

/**
 * Per-day rows plus a totals row, UTF-8 with BOM so Excel reads the Chinese
 * headers. Only dates and numbers are exported (no free text), so no formula
 * injection guard is needed beyond what `toCsv` already does.
 */
export function buildPnlRangeCsv(
  range: PnlRange,
  headers: PnlCsvHeaders,
): string {
  const cells = (r: PnlRange["totals"]) => [
    r.orderCount,
    plainAmount(r.netRevenueCents, range.currency),
    plainAmount(r.cogsCents, range.currency),
    plainAmount(r.grossProfitCents, range.currency),
    plainAmount(r.feesCents, range.currency),
    plainAmount(r.laborCents, range.currency),
    plainAmount(r.expensesCents, range.currency),
    plainAmount(r.netProfitCents, range.currency),
  ];
  return `﻿${toCsv([
    [
      headers.date,
      headers.orders,
      headers.netRevenue,
      headers.cogs,
      headers.grossProfit,
      headers.fees,
      headers.labor,
      headers.expenses,
      headers.netProfit,
    ],
    ...range.days.map((day) => [day.date, ...cells(day)]),
    [headers.totals, ...cells(range.totals)],
  ])}`;
}

/** Browser download of a CSV string (same approach as the sibling exports). */
export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type PnlStatus = "profit" | "loss" | "even";

/** Exactly zero is neither a profit nor a loss. */
export function pnlStatus(netCents: number): PnlStatus {
  return netCents < 0 ? "loss" : netCents > 0 ? "profit" : "even";
}

/** Surface + text colours for a net-profit banner. */
export const PNL_STATUS_CLASS: Record<PnlStatus, string> = {
  profit: "bg-ios-green-soft text-ios-green-deep",
  loss: "bg-ios-red-soft text-ios-red-deep",
  even: "bg-ios-bg text-ios-text",
};

export function pnlStatusLabel(
  status: PnlStatus,
  t: (key: string) => string,
): string {
  // Literal keys, so the i18n parity scan can see them.
  if (status === "loss") return t("dailyPnl.net.loss");
  if (status === "even") return t("dailyPnl.net.even");
  return t("dailyPnl.net.profit");
}
