import { computed, ref, watch } from "vue";
import {
  DEFAULT_CURRENCY,
  formatCurrency,
  type CurrencyCode,
} from "@makanmasak/utils";
import api from "@/services/authApi";
import { useAuthStore } from "@/stores/auth";

/** Kitchen statistics use the signed-in restaurant's currency, not UI locale. */
export function useCurrency() {
  const auth = useAuthStore();
  const currencyCode = ref<CurrencyCode>(DEFAULT_CURRENCY);

  watch(
    () => auth.restaurantId,
    async (restaurantId, _previous, onCleanup) => {
      let active = true;
      onCleanup(() => {
        active = false;
      });
      currencyCode.value = DEFAULT_CURRENCY;
      if (restaurantId == null) return;

      try {
        const response = await api.get<{
          success: boolean;
          data?: { settings?: { currency?: string } };
        }>(`/restaurants/${encodeURIComponent(restaurantId)}`);
        const code = response.data.data?.settings?.currency;
        if (
          active &&
          response.data.success &&
          (code === "TWD" || code === "MYR" || code === "VND")
        ) {
          currencyCode.value = code;
        }
      } catch (error) {
        if (active) console.error("Failed to load restaurant currency:", error);
      }
    },
    { immediate: true },
  );

  return {
    currencyCode: computed(() => currencyCode.value),
    formatPrice: (amount: number) => formatCurrency(amount, currencyCode.value),
  };
}
