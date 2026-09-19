import { ref, computed } from "vue";
import type { CurrencyCode } from "@makanmasak/shared-types";
import {
  formatCurrency as sharedFormatCurrency,
  getCurrencySymbol as sharedGetCurrencySymbol,
  getCurrencyConfig,
  currencyStepCents,
  roundToCurrencyCents,
  normalizeCurrencyCode,
  DEFAULT_CURRENCY,
} from "@makanmasak/utils";

const STORAGE_KEY = "admin_restaurant_currency";
/** Which restaurant the stored currency belongs to. */
const OWNER_KEY = "admin_restaurant_currency_owner";

/**
 * Reactive currency ref backed by sessionStorage for per-tab isolation.
 * Shared across all components that call useCurrency() in the same tab.
 */
const currencyCode = ref<CurrencyCode>(
  normalizeCurrencyCode(sessionStorage.getItem(STORAGE_KEY)) ??
    DEFAULT_CURRENCY,
);

/**
 * Set the active restaurant's currency.
 * Called by SettingsView on load/save, or when switching restaurants.
 * Pass the restaurant id when it is known, so a reload of the same shop can
 * keep showing its currency while the restaurant is re-fetched.
 */
export const setRestaurantCurrency = (
  code: CurrencyCode,
  restaurantId?: string,
) => {
  currencyCode.value = code;
  sessionStorage.setItem(STORAGE_KEY, code);
  if (restaurantId) sessionStorage.setItem(OWNER_KEY, restaurantId);
};

/**
 * Clear currency (e.g., on logout or restaurant deselect).
 */
export const clearRestaurantCurrency = () => {
  currencyCode.value = DEFAULT_CURRENCY;
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(OWNER_KEY);
};

/** The restaurant the remembered currency was loaded for, if any. */
export const getRestaurantCurrencyOwner = (): string | null =>
  sessionStorage.getItem(OWNER_KEY);

/**
 * Composable for currency formatting in admin dashboard components.
 *
 * Usage:
 * ```vue
 * const { formatPrice, currencySymbol, inputStep } = useCurrency()
 * // In template: {{ formatPrice(12.50) }}  → "RM 12.50" or "NT$13"
 * // <input type="number" :step="inputStep" :placeholder="inputPlaceholder">
 * ```
 */
export function useCurrency() {
  const currencySymbol = computed(() =>
    sharedGetCurrencySymbol(currencyCode.value),
  );

  /** Fraction digits the currency actually has: TWD/VND 0, MYR 2. */
  const decimals = computed(
    () => getCurrencyConfig(currencyCode.value)?.decimals ?? 2,
  );

  /**
   * `step` for a major-unit money `<input type="number">`: "1" for TWD/VND,
   * "0.01" for MYR. Browsers flag an off-step value as invalid, so a TWD
   * price field no longer accepts NT$12.50.
   */
  const inputStep = computed(() =>
    decimals.value > 0
      ? (1 / 10 ** decimals.value).toFixed(decimals.value)
      : "1",
  );

  /** Placeholder for a money input: "0" for TWD/VND, "0.00" for MYR. */
  const inputPlaceholder = computed(() => (0).toFixed(decimals.value));

  /**
   * Format an amount using the current restaurant's currency.
   * Accepts major currency units, not cents.
   * Replaces all local formatMoney() implementations.
   */
  const formatPrice = (amount: number): string => {
    return sharedFormatCurrency(amount, currencyCode.value);
  };

  /** Format an integer-cents amount (major × 100, for every currency). */
  const formatCents = (cents: number): string => formatPrice(cents / 100);

  /**
   * Major units typed into an input → integer cents on the currency's step
   * (TWD 12.5 → 1300, MYR 12.5 → 1250).
   */
  const majorToCents = (amount: number): number =>
    roundToCurrencyCents(Math.round(amount * 100), currencyCode.value);

  /** Integer cents → major units for an input's model value. */
  const centsToMajor = (cents: number): number => cents / 100;

  return {
    formatPrice,
    formatCents,
    majorToCents,
    centsToMajor,
    currencySymbol,
    decimals,
    inputStep,
    inputPlaceholder,
    stepCents: computed(() => currencyStepCents(currencyCode.value)),
    currencyCode: computed(() => currencyCode.value),
  };
}
