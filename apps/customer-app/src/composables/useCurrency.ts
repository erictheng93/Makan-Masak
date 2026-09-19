import { computed } from "vue";
import type { CurrencyCode } from "@makanmasak/shared-types";
import {
  formatCurrency as sharedFormatCurrency,
  getCurrencySymbol as sharedGetCurrencySymbol,
  normalizeCurrencyCode,
  DEFAULT_CURRENCY,
} from "@makanmasak/utils";
import { useAppStore } from "@/stores/app";

/**
 * Composable for currency formatting in customer app components.
 *
 * Without an argument it reads the currency of `appStore.currentRestaurant`
 * — the restaurant the diner is ordering from. A page that shows money from a
 * restaurant that may not be the current one (a service booking reached by a
 * deep link, a list spanning several restaurants) must pass `currencySource`
 * instead. That source is authoritative: when it yields nothing usable the
 * platform default applies, never the last-visited restaurant's currency.
 *
 * Usage:
 * ```vue
 * const { formatPrice, currencySymbol } = useCurrency()
 * // In template: {{ formatPrice(12.5) }}  → "RM 12.50"
 * ```
 */
export function useCurrency(currencySource?: () => unknown) {
  const appStore = useAppStore();

  const currencyCode = computed<CurrencyCode>(() => {
    const raw = currencySource
      ? currencySource()
      : appStore.currentRestaurant?.settings?.currency;
    return normalizeCurrencyCode(raw) ?? DEFAULT_CURRENCY;
  });

  const currencySymbol = computed(() =>
    sharedGetCurrencySymbol(currencyCode.value),
  );

  /**
   * Format a price amount using the current restaurant's currency.
   * Accepts major currency units, not cents (e.g. 320 = NT$320).
   */
  const formatPrice = (amount: number): string => {
    if (typeof amount !== "number" || isNaN(amount)) {
      return sharedFormatCurrency(0, currencyCode.value);
    }
    return sharedFormatCurrency(amount, currencyCode.value);
  };

  /**
   * Format a dollar amount directly (no cents conversion).
   */
  const formatAmount = (amount: number): string => {
    return sharedFormatCurrency(amount, currencyCode.value);
  };

  /** Format an integer-cents amount (major × 100, for every currency). */
  const formatCents = (cents: number): string => formatPrice(cents / 100);

  return {
    formatPrice,
    formatAmount,
    formatCents,
    currencySymbol,
    currencyCode,
  };
}
