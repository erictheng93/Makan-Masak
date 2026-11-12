<template>
  <div
    class="bg-white rounded-2xl p-4 shadow-card"
    data-testid="cart-item"
    :data-menu-item-id="item.menuItem.id"
  >
    <div class="flex space-x-4">
      <!-- 商品圖片 -->
      <div class="flex-shrink-0">
        <div class="w-16 h-16 rounded-lg overflow-hidden bg-gray-100">
          <img
            v-if="item.menuItem.imageUrl"
            v-bind="thumb"
            :alt="getLocalizedMenuName(item.menuItem, currentLanguage)"
            class="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            @error="handleImageError"
          />
          <div
            v-else
            class="w-full h-full flex items-center justify-center text-gray-400"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
        </div>
      </div>

      <!-- 商品資訊 -->
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between mb-2">
          <div class="flex-1 min-w-0 mr-2">
            <!-- Two lines, not truncate: a non-Chinese, non-English locale
                 renders "English（中文）", and one line would ellipsis away the
                 Chinese half — the half a customer points at to order. -->
            <h3 class="text-base font-semibold text-ios-text line-clamp-2">
              {{ getLocalizedMenuName(item.menuItem, currentLanguage) }}
            </h3>

            <!-- 規格資訊 -->
            <div v-if="customizationText" class="mt-1">
              <p class="text-sm text-ios-secondary">
                {{ customizationText }}
              </p>
            </div>
          </div>

          <!-- 移除按鈕 -->
          <button
            data-testid="remove-item"
            :aria-label="`${t('cart.remove')} ${getLocalizedMenuName(item.menuItem, currentLanguage)}`"
            class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-ios-secondary active:bg-ios-red/10 active:text-ios-red transition-all duration-200"
            @click="$emit('remove', item.id)"
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

        <!-- 價格和數量控制 -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-baseline space-x-1">
            <span class="text-base font-semibold text-ios-text">
              {{ formatPrice(itemTotal) }}
            </span>
            <span v-if="item.quantity > 1" class="text-sm text-ios-secondary">
              ({{ formatPrice(item.price) }} × {{ item.quantity }})
            </span>
          </div>

          <!-- 數量控制 -->
          <div class="flex items-center space-x-3">
            <button
              :data-testid="`qty-decrease-${item.id}`"
              :disabled="item.quantity <= 1"
              class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-ios-text active:bg-gray-200 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              :aria-label="`${t('customizationLimits.decrease')} ${getLocalizedMenuName(item.menuItem, currentLanguage)}`"
              @click="updateQuantity(item.quantity - 1)"
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
                  d="M20 12H4"
                />
              </svg>
            </button>

            <span
              :data-testid="`cart-item-quantity-${item.id}`"
              class="text-base font-medium text-ios-text min-w-[2rem] text-center"
            >
              {{ item.quantity }}
            </span>

            <button
              :disabled="item.quantity >= 99"
              :data-testid="`qty-increase-${item.id}`"
              class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-ios-text active:bg-gray-200 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              :aria-label="`${t('customizationLimits.increase')} ${getLocalizedMenuName(item.menuItem, currentLanguage)}`"
              @click="updateQuantity(item.quantity + 1)"
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          </div>
        </div>

        <!-- 備註 -->
        <div v-if="showNotesInput" class="mt-3">
          <textarea
            :data-testid="`cart-item-notes-${item.id}`"
            :aria-label="t('cart.notes')"
            :value="item.notes || ''"
            :placeholder="t('cart.notes')"
            rows="2"
            class="w-full px-4 py-3 text-sm bg-gray-100 rounded-xl border-0 focus:ring-2 focus:ring-ios-blue/30 focus:bg-white text-ios-text placeholder:text-ios-tertiary resize-none transition-all duration-200"
            @input="updateNotes(($event.target as HTMLTextAreaElement).value)"
          />
        </div>

        <!-- 備註切換按鈕 -->
        <button
          :data-testid="`cart-item-notes-toggle-${item.id}`"
          class="mt-2 text-sm text-ios-blue active:opacity-70 transition-opacity duration-200 flex items-center space-x-1"
          @click="showNotesInput = !showNotesInput"
        >
          <svg
            class="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          <span
            >{{ showNotesInput ? t("cart.hideNotes") : t("cart.addNotes")
            }}{{ t("cart.notes") }}</span
          >
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useCurrency } from "@/composables/useCurrency";
import type { CartItem } from "@makanmasak/shared-types";
import { useI18n } from "@/composables/useI18n";
import { menuImageAttrs } from "@/utils/menu-image";
import { getLocalizedMenuName } from "@/utils/localized-menu-content";

// Props
const props = defineProps<{
  item: CartItem;
}>();

// Emits
const emits = defineEmits<{
  "update-quantity": [itemId: string, quantity: number];
  "update-notes": [itemId: string, notes: string];
  remove: [itemId: string];
}>();

const { t, currentLanguage } = useI18n();
const { formatPrice } = useCurrency();

// State
const showNotesInput = ref(!!props.item.notes);

// Computed
const itemTotal = computed(() => {
  return props.item.price * props.item.quantity;
});

const customizationText = computed(() => {
  if (!props.item.customizations) return "";

  const parts: string[] = [];
  const customizations = props.item.customizations;

  // 尺寸 - size is now an object with name property
  if (customizations.size) {
    parts.push(customizations.size.name);
  }

  // 客製化選項 - options is now an array of objects
  if (customizations.options && customizations.options.length > 0) {
    const optionNames = customizations.options.map(
      (option) => option.choiceName,
    );
    parts.push(...optionNames);
  }

  // 加購項目 - addOns is now an array of objects
  if (customizations.addOns && customizations.addOns.length > 0) {
    const addOnNames = customizations.addOns.map((addOn) => `+${addOn.name}`);
    parts.push(...addOnNames);
  }

  return parts.join(", ");
});

// Methods
// w-16 is 56px under the 14px mobile root, 64px above 768px. DPR 3 -> small.
const thumb = computed(() =>
  menuImageAttrs(
    props.item.menuItem.imageUrl,
    props.item.menuItem.imageVariants,
    "(min-width: 769px) 64px, 56px",
    "thumbnail",
  ),
);

const handleImageError = (event: Event) => {
  const img = event.target as HTMLImageElement;
  img.style.display = "none";
};

const updateQuantity = (newQuantity: number) => {
  if (newQuantity < 1 || newQuantity > 99) return;
  emits("update-quantity", props.item.id, newQuantity);
};

const updateNotes = (notes: string) => {
  emits("update-notes", props.item.id, notes);
};
</script>
