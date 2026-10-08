<!-- apps/customer-app/src/components/DesktopCartPanel.vue -->
<template>
  <!--
    self-stretch: the menu row is items-start, which would size this aside to
    the panel itself and leave the sticky child no room to stick. top-36 keeps
    it clear of the menu header (back button + category chips, ~128px).
  -->
  <aside class="w-[300px] flex-shrink-0 self-stretch">
    <div class="sticky top-36">
      <div class="bg-white rounded-2xl shadow-card p-5">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-ios-text">
            {{ t("shopCart.title") }}
          </h3>
          <span
            class="w-6 h-6 bg-ios-blue text-white text-xs rounded-full flex items-center justify-center font-bold"
          >
            {{ itemCount }}
          </span>
        </div>

        <!-- Cart items -->
        <div class="divide-y divide-ios-separator">
          <div v-for="item in items" :key="item.id" class="py-3 first:pt-0">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <!-- line-clamp rather than truncate: see CartItemCard — the
                     bilingual form must not lose its Chinese half. -->
                <p class="text-sm font-medium text-ios-text line-clamp-2">
                  {{ getLocalizedMenuName(item.menuItem, currentLanguage) }}
                </p>
                <p
                  v-if="item.customizations"
                  class="text-xs text-ios-secondary mt-0.5 truncate"
                >
                  {{ formatCustomizations(item.customizations) }}
                </p>
              </div>
              <button
                class="text-ios-secondary hover:text-ios-red transition-colors p-1 -mr-1"
                @click="$emit('remove-item', item.id)"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div class="flex items-center justify-between mt-2">
              <!-- Quantity controls -->
              <div class="flex items-center gap-2">
                <button
                  class="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-ios-text active:scale-95 transition-transform text-sm"
                  @click="$emit('update-quantity', item.id, item.quantity - 1)"
                >
                  −
                </button>
                <span class="text-sm font-medium text-ios-text w-5 text-center">
                  {{ item.quantity }}
                </span>
                <button
                  class="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-ios-text active:scale-95 transition-transform text-sm"
                  @click="$emit('update-quantity', item.id, item.quantity + 1)"
                >
                  +
                </button>
              </div>
              <span class="text-sm font-semibold text-ios-text">
                {{ formatPrice(item.totalPrice) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Subtotal + Checkout -->
        <div class="mt-4 pt-4 border-t border-ios-separator">
          <div class="flex items-center justify-between mb-4">
            <span class="text-sm font-medium text-ios-secondary">
              {{ t("shopCart.subtotal") }}
            </span>
            <span class="text-lg font-bold text-ios-blue">
              {{ formatPrice(subtotal) }}
            </span>
          </div>
          <button
            class="w-full py-3 bg-ios-blue text-white font-semibold rounded-full active:scale-[0.98] transition-transform duration-150 shadow-card-sm"
            @click="$emit('checkout')"
          >
            {{ t("shopCart.confirmOrder") }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from "@/composables/useI18n";
import { useCurrency } from "@/composables/useCurrency";
import { getLocalizedMenuName } from "@/utils/localized-menu-content";
import type {
  CartItem,
  SelectedCustomizations,
} from "@makanmasak/shared-types";

defineProps<{
  items: CartItem[];
  itemCount: number;
  subtotal: number;
}>();

defineEmits<{
  checkout: [];
  "remove-item": [id: string];
  "update-quantity": [id: string, quantity: number];
}>();

const { t, currentLanguage } = useI18n();
const { formatPrice } = useCurrency();

const formatCustomizations = (customizations?: SelectedCustomizations) => {
  if (!customizations) return "";
  const parts: string[] = [];
  if (customizations.size) parts.push(customizations.size.name);
  if (customizations.options?.length) {
    parts.push(...customizations.options.map((o) => o.choiceName));
  }
  if (customizations.addOns?.length) {
    parts.push(...customizations.addOns.map((a) => a.name));
  }
  return parts.join(", ");
};
</script>
