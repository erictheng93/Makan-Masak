/**
 * Currency formatting utilities for MakanMasak platform
 *
 * Provides a shared currency configuration and formatting functions
 * that all apps (admin dashboard, customer app, etc.) can use.
 * Data sourced from REGION_CONFIGS in queue-core but focused on currency only.
 */

/** Supported currency codes — matches CurrencyCode in shared-types */
export type CurrencyCode = "TWD" | "MYR" | "VND";

export interface CurrencyFormatConfig {
  symbol: string;
  position: "before" | "after";
  space: boolean;
  decimals: number;
  locale: string;
}

/**
 * Currency configuration mapping.
 * Each supported CurrencyCode maps to its display formatting rules.
 */
export const CURRENCY_CONFIGS: Record<CurrencyCode, CurrencyFormatConfig> = {
  TWD: {
    symbol: "NT$",
    position: "before",
    space: false,
    decimals: 0,
    locale: "zh-TW",
  },
  MYR: {
    symbol: "RM",
    position: "before",
    space: true,
    decimals: 2,
    locale: "ms-MY",
  },
  VND: {
    symbol: "\u20AB",
    position: "after",
    space: true,
    decimals: 0,
    locale: "vi-VN",
  },
};

/** Default currency when restaurant has no setting */
export const DEFAULT_CURRENCY: CurrencyCode = "TWD";

/**
 * Format an amount with full currency display using Intl.NumberFormat.
 *
 * @param amount - The numeric amount to format
 * @param currency - Currency code (defaults to MYR)
 * @returns Formatted string like "RM 12.50", "NT$350", "100,000 \u20AB"
 */
export const formatCurrency = (
  amount: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string => {
  const config = CURRENCY_CONFIGS[currency];
  if (!config) return amount.toString();

  const formatter = new Intl.NumberFormat(config.locale, {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
  });

  const formatted = formatter.format(amount);
  const space = config.space ? " " : "";

  if (config.position === "before") {
    return `${config.symbol}${space}${formatted}`;
  }
  return `${formatted}${space}${config.symbol}`;
};

/**
 * Quick lookup for a currency's display symbol.
 */
export const getCurrencySymbol = (
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string => {
  return CURRENCY_CONFIGS[currency]?.symbol ?? currency;
};

/**
 * Get the full format config for a currency code.
 */
export const getCurrencyConfig = (
  currency: CurrencyCode = DEFAULT_CURRENCY,
): CurrencyFormatConfig | undefined => {
  return CURRENCY_CONFIGS[currency];
};

/**
 * Narrow an untrusted value (a `restaurants.settings.currency` JSON field, a
 * request body) to a supported currency code. Returns `null` for anything
 * else so the caller decides between rejecting and defaulting — do not
 * silently default on a value that came from a client.
 */
export const normalizeCurrencyCode = (value: unknown): CurrencyCode | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return code in CURRENCY_CONFIGS ? (code as CurrencyCode) : null;
};

/**
 * Every money column stores integer "cents": major units × 100, for every
 * currency. That is storage, not precision. A currency's real precision is
 * its `decimals`: TWD and VND have no fractional unit in circulation, so a
 * TWD amount is only valid in whole-dollar steps of 100 cents.
 *
 * Returns the smallest valid step, in cents: TWD 100, VND 100, MYR 1.
 */
export const currencyStepCents = (currency: CurrencyCode): number => {
  const decimals = CURRENCY_CONFIGS[currency]?.decimals;
  if (decimals === undefined) {
    throw new Error(`Unsupported currency: ${String(currency)}`);
  }
  return 10 ** Math.max(0, 2 - decimals);
};

/**
 * Round an integer-cents amount to the currency's real precision, half away
 * from zero (so a refund rounds the same way as the charge it reverses).
 *
 *   roundToCurrencyCents(1550, "TWD") === 1600   // NT$15.50 → NT$16
 *   roundToCurrencyCents(1549, "TWD") === 1500
 *   roundToCurrencyCents(1550, "MYR") === 1550   // RM15.50 stays
 *
 * Apply it to each derived line (tax, service charge, percentage discount,
 * fee) as it is computed, not only to the grand total — otherwise the printed
 * lines no longer add up to the total the customer pays.
 */
export const roundToCurrencyCents = (
  cents: number,
  currency: CurrencyCode,
): number => {
  if (!Number.isFinite(cents)) {
    throw new Error("Money amount must be finite");
  }
  const step = currencyStepCents(currency);
  const sign = cents < 0 ? -1 : 1;
  // Math.round on the raw quotient first absorbs float noise from callers
  // that multiplied by a rate (15500 * 0.1 = 1550.0000000000002).
  const units = Math.round(Math.round(Math.abs(cents) * 1e6) / 1e6 / step);
  const rounded = sign * units * step;
  return rounded === 0 ? 0 : rounded;
};

/** True when `cents` is an integer on the currency's step (TWD: ×100). */
export const isCurrencyAlignedCents = (
  cents: number,
  currency: CurrencyCode,
): boolean =>
  Number.isInteger(cents) && cents % currencyStepCents(currency) === 0;

/**
 * Split `totalCents` across `weights` in proportion, every share on the
 * currency's step, shares summing exactly to `totalCents` (largest remainder;
 * ties go to the earlier index). Use it for bill splits and for spreading a
 * discount or fee across child orders — `Math.floor` per share plus "the
 * remainder goes to the last one" produces NT$33.33 shares.
 *
 *   allocateCents(10000, [1, 1, 1], "TWD") → [3400, 3300, 3300]
 */
export const allocateCents = (
  totalCents: number,
  weights: readonly number[],
  currency: CurrencyCode,
): number[] => {
  if (weights.length === 0) return [];
  const step = currencyStepCents(currency);
  if (!isCurrencyAlignedCents(totalCents, currency)) {
    throw new Error(
      `Total ${totalCents} is not aligned to the ${currency} step of ${step} cents`,
    );
  }
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new Error("Allocation weights must be finite and non-negative");
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  // All-zero weights: split evenly rather than dividing by zero.
  const effective = weightSum > 0 ? weights : weights.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : weights.length;

  const totalUnits = totalCents / step;
  const exact = effective.map((w) => (totalUnits * w) / effectiveSum);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = totalUnits - floors.reduce((sum, x) => sum + x, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors.map((units) => units * step);
};
