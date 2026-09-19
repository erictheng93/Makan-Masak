/**
 * Money formatting for printed receipts.
 *
 * Kept inside queue-core rather than imported from @makanmasak/utils because
 * this package is compiled to dist/ with its own rootDir and shipped to the
 * local print agent; the rules below deliberately mirror utils'
 * CURRENCY_CONFIGS (TWD 0, MYR 2, VND 0 decimals), and money.test.ts pins the
 * output to the strings the web apps render ("NT$350", "RM 12.50",
 * "350.000 ₫").
 */
import type { CurrencyCode, RegionConfig } from "@makanmasak/shared-types";
import { REGION_CONFIGS } from "../config/regions";

/** Fraction digits a currency actually has in circulation. */
const CURRENCY_DECIMALS: Record<string, number> = {
  TWD: 0,
  MYR: 2,
  VND: 0,
  JPY: 0,
  KRW: 0,
};

/** 0 for TWD/VND, 2 for MYR; 2 for a code this table does not know. */
export function currencyDecimals(currency: string | undefined): number {
  if (!currency) return 2;
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

/**
 * Round a major-unit amount to the currency's precision, half away from zero,
 * never returning -0. Use it on every derived line (a tax computed from a
 * rate) so the printed lines add up to the total.
 */
export function roundMoney(amount: number, currency: string | undefined) {
  if (!Number.isFinite(amount)) return 0;
  const factor = 10 ** currencyDecimals(currency);
  // Math.round on the scaled value first absorbs float noise (0.1 * 3).
  const scaled = Math.round(Math.abs(amount) * factor * 1e6) / 1e6;
  const rounded = (Math.sign(amount) * Math.round(scaled)) / factor;
  return rounded === 0 ? 0 : rounded;
}

type MoneyFormat = Pick<RegionConfig, "currency" | "numberFormat">;

function regionForCurrency(currency: CurrencyCode): MoneyFormat | undefined {
  return Object.values(REGION_CONFIGS).find(
    (region) => region.currency === currency,
  );
}

/**
 * Format a major-unit amount with the region's symbol, separators and the
 * currency's decimals: TW "NT$350", MY "RM 12.50", VN "350.000 ₫". A negative
 * amount carries its sign before the symbol ("-NT$50").
 */
export function formatRegionMoney(amount: number, format: MoneyFormat): string {
  const decimals = currencyDecimals(format.currency);
  const value = roundMoney(amount, format.currency);
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split(".");
  const grouped = whole.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    format.numberFormat.thousand,
  );
  const number = fraction
    ? `${grouped}${format.numberFormat.decimal}${fraction}`
    : grouped;
  const { symbol, position, space } = format.numberFormat.currency;
  const gap = space ? " " : "";
  const body =
    position === "before"
      ? `${symbol}${gap}${number}`
      : `${number}${gap}${symbol}`;
  return value < 0 ? `-${body}` : body;
}

/**
 * Format by currency code alone, for code that only has a PrintContent.
 * Without a known currency the amount prints as a bare two-decimal number —
 * the historical output — rather than guessing a symbol.
 */
export function formatCurrencyAmount(
  amount: number,
  currency: CurrencyCode | undefined,
): string {
  const format = currency ? regionForCurrency(currency) : undefined;
  if (!format) {
    return (Number.isFinite(amount) ? amount : 0).toFixed(2);
  }
  return formatRegionMoney(amount, format);
}
