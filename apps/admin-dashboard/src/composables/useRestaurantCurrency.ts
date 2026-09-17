import { watch } from "vue";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { clearRestaurantCurrency, setRestaurantCurrency } from "./useCurrency";

/** Initialize the existing formatter on entry and whenever restaurant context changes. */
export function useRestaurantCurrency() {
  const auth = useAuthStore();
  watch(
    () => auth.restaurantId,
    async (restaurantId, _previous, onCleanup) => {
      let active = true;
      onCleanup(() => {
        active = false;
      });
      clearRestaurantCurrency();
      if (restaurantId == null) return;
      try {
        const response = await api.get<{ settings?: { currency?: string } }>(
          `/restaurants/${encodeURIComponent(restaurantId)}`,
        );
        const code = response.data.data?.settings?.currency;
        if (
          active &&
          response.data.success &&
          (code === "TWD" || code === "MYR" || code === "VND")
        ) {
          setRestaurantCurrency(code);
        }
      } catch (error) {
        if (active) console.error("Failed to load restaurant currency:", error);
      }
    },
    { immediate: true },
  );
}
