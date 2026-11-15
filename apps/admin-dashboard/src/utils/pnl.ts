import {
  DEFAULT_CURRENCY,
  formatCurrency,
  getCurrencyConfig,
  normalizeCurrencyCode,
} from "@makanmasak/utils";
import {
  PNL_MAX_RANGE_DAYS,
  type DailyPnl,
  type ExpenseCategory,
  type PnlRange,
} from "@/services/pnlService";
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

export type PnlCell = string | number;

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
 * Header + per-day rows + totals row. `amount` decides how a cents figure
 * lands in a cell: a plain major-unit string for CSV, a real number for Excel.
 */
function rangeRows(
  range: PnlRange,
  headers: PnlCsvHeaders,
  amount: (cents: number) => PnlCell,
): PnlCell[][] {
  const cells = (r: PnlRange["totals"]): PnlCell[] => [
    r.orderCount,
    amount(r.netRevenueCents),
    amount(r.cogsCents),
    amount(r.grossProfitCents),
    amount(r.feesCents),
    amount(r.laborCents),
    amount(r.expensesCents),
    amount(r.netProfitCents),
  ];
  return [
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
  ];
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
  return `\uFEFF${toCsv(rangeRows(range, headers, (c) => plainAmount(c, range.currency)))}`;
}

/** The same table as real numeric cells (major units), for the Excel export. */
export function buildPnlRangeSheet(
  range: PnlRange,
  headers: PnlCsvHeaders,
): PnlCell[][] {
  return rangeRows(range, headers, (c) => c / 100);
}

export interface PnlDayLabels {
  date: string;
  item: string;
  amount: string;
  grossSales: string;
  discount: string;
  refund: string;
  collected: string;
  tax: string;
  netRevenue: string;
  cogs: string;
  grossProfit: string;
  grossMargin: string;
  paymentFee: string;
  platformCommission: string;
  labor: string;
  expenses: string;
  entries: string;
  category: string;
  note: string;
  netProfit: string;
}

/** Free text may start with =, +, -, @, tab or CR; prefix ' so a sheet never evaluates it. */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function dayRows(
  day: DailyPnl,
  labels: PnlDayLabels,
  categoryLabel: (category: ExpenseCategory) => string,
  amount: (cents: number) => PnlCell,
): PnlCell[][] {
  const margin =
    day.revenue.netRevenueCents === 0
      ? "—"
      : `${((day.grossProfitCents / day.revenue.netRevenueCents) * 100).toFixed(1)}%`;
  return [
    [labels.date, day.date],
    [labels.item, labels.amount],
    [labels.grossSales, amount(day.revenue.grossSalesCents)],
    [labels.discount, amount(day.revenue.discountCents)],
    [labels.refund, amount(day.revenue.refundCents)],
    [labels.collected, amount(day.revenue.collectedCents)],
    [labels.tax, amount(day.revenue.taxCents)],
    [labels.netRevenue, amount(day.revenue.netRevenueCents)],
    [labels.cogs, amount(day.cogs.totalCents)],
    [labels.grossProfit, amount(day.grossProfitCents)],
    [labels.grossMargin, margin],
    // Same as the screen: no fee lines until rates are configured.
    ...(day.fees.configured
      ? [
          [labels.paymentFee, amount(day.fees.paymentFeeCents)],
          [labels.platformCommission, amount(day.fees.platformCommissionCents)],
        ]
      : []),
    [labels.labor, amount(day.labor.costCents)],
    ...day.expenses.byCategory.map((row) => [
      categoryLabel(row.category),
      amount(row.amountCents),
    ]),
    [labels.expenses, amount(day.expenses.totalCents)],
    [labels.netProfit, amount(day.netProfitCents)],
    [],
    [labels.entries],
    [labels.category, labels.note, labels.amount],
    ...day.expenses.items.map((item) => [
      categoryLabel(item.category),
      neutralizeFormula(item.note ?? ""),
      amount(item.amountCents),
    ]),
  ];
}

export function buildPnlDayCsv(
  day: DailyPnl,
  labels: PnlDayLabels,
  categoryLabel: (category: ExpenseCategory) => string,
): string {
  return `\uFEFF${toCsv(dayRows(day, labels, categoryLabel, (c) => plainAmount(c, day.currency)))}`;
}

export function buildPnlDaySheet(
  day: DailyPnl,
  labels: PnlDayLabels,
  categoryLabel: (category: ExpenseCategory) => string,
): PnlCell[][] {
  return dayRows(day, labels, categoryLabel, (c) => c / 100);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Browser download of a CSV string (same approach as the sibling exports). */
export function downloadCsv(csv: string, filename: string): void {
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename);
}

/** One sheet from rows of cells; SheetJS is loaded on demand so the page chunk stays small. */
export async function downloadXlsx(
  rows: PnlCell[][],
  filename: string,
  sheetName: string,
): Promise<void> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const columns = Math.max(...rows.map((row) => row.length));
  sheet["!cols"] = Array.from({ length: columns }, (_, col) => ({
    wch: Math.min(
      40,
      Math.max(10, ...rows.map((row) => String(row[col] ?? "").length + 2)),
    ),
  }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  const data = XLSX.write(book, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
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
