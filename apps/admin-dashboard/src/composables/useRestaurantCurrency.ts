import { watch } from "vue";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { normalizeCurrencyCode } from "@makanmasak/utils";
import {
  clearRestaurantCurrency,
  getRestaurantCurrencyOwner,
  setRestaurantCurrency,
} from "./useCurrency";

/**
 * Initialize the existing formatter on entry and whenever restaurant context
 * changes.
 *
 * A currency remembered for this same restaurant (a reload of the tab) is
 * kept while the restaurant is re-fetched, so an MYR shop does not render
 * NT$ for the length of that request. Anything remembered for another shop,
 * or for no known shop, is cleared first.
 */
export function useRestaurantCurrency() {
  const auth = useAuthStore();
  watch(
    () => auth.restaurantId,
    async (restaurantId, _previous, onCleanup) => {
      let active = true;
      onCleanup(() => {
        active = false;
      });
      if (
        restaurantId == null ||
        getRestaurantCurrencyOwner() !== String(restaurantId)
      ) {
        clearRestaurantCurrency();
      }
      if (restaurantId == null) return;
      try {
        const response = await api.get<{ settings?: { currency?: string } }>(
          `/restaurants/${encodeURIComponent(restaurantId)}`,
        );
        const code = normalizeCurrencyCode(
          response.data.data?.settings?.currency,
        );
        if (active && response.data.success) {
          if (code) setRestaurantCurrency(code, String(restaurantId));
          else clearRestaurantCurrency();
        }
      } catch (error) {
        if (active) console.error("Failed to load restaurant currency:", error);
      }
    },
    { immediate: true },
  );
}
