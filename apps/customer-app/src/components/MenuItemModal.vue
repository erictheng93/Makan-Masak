<template>
  <div
    v-if="show && item"
    data-testid="menu-item-modal"
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/30"
    @click.self="$emit('close')"
  >
    <div
      class="bg-white rounded-t-ios-lg shadow-card-lg w-full max-w-md max-h-[85vh] overflow-hidden"
      @click.stop
    >
      <!-- 頂部把手 -->
      <div class="flex justify-center py-2">
        <div class="w-10 h-1 bg-gray-300 rounded-full" />
      </div>

      <div class="overflow-y-auto max-h-full">
        <!-- 商品圖片 -->
        <div class="relative h-64 bg-gray-100">
          <img
            v-if="item.imageUrl"
            v-bind="heroImage"
            decoding="async"
            :alt="getLocalizedMenuName(item, currentLanguage)"
            class="w-full h-full object-cover"
            @error="handleImageError"
          />
          <div
            v-else
            class="w-full h-full flex items-center justify-center text-gray-400"
          >
            <svg
              class="w-16 h-16"
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

          <!-- 關閉按鈕 -->
          <button
            class="absolute top-4 right-4 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center text-ios-text shadow-card-sm active:scale-95 transition-transform duration-150"
            @click="$emit('close')"
          >
            <svg
              class="w-5 h-5"
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

          <!-- 特色標籤 -->
          <div v-if="item.isFeatured" class="absolute top-4 left-4">
            <span
              class="bg-ios-blue shadow-card-sm text-white text-xs font-medium px-3 py-1 rounded-full"
            >
              {{ t("menuItemModal.featured") }}
            </span>
          </div>
        </div>

        <!-- 商品資訊 -->
        <div class="p-6 space-y-4">
          <!-- 基本資訊 -->
          <div>
            <div class="flex items-start justify-between mb-2">
              <h2 class="text-xl font-bold text-ios-text">
                {{ getLocalizedMenuName(item, currentLanguage) }}
              </h2>
              <div class="flex items-center space-x-1">
                <!-- 辣度指示器 -->
                <div v-if="item.spiceLevel > 0" class="flex items-center">
                  <svg
                    v-for="n in item.spiceLevel"
                    :key="n"
                    class="w-4 h-4 text-red-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <p
              v-if="item.description"
              class="text-sm text-ios-secondary leading-relaxed"
            >
              {{ item.description }}
            </p>

            <!-- 飲食資訊標籤 -->
            <div
              v-if="dietaryTags.length > 0"
              class="flex flex-wrap gap-2 mt-3"
            >
              <span
                v-for="tag in dietaryTags"
                :key="tag.key"
                :class="[
                  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                  tag.class,
                ]"
              >
                {{ tag.label }}
              </span>
            </div>
          </div>

          <!-- 價格 -->
          <div class="text-2xl font-bold text-ios-text">
            {{ formatPrice(currentPrice) }}
          </div>

          <!-- 客製化選項 -->
          <div v-if="hasCustomizations">
            <CustomizationOptions
              v-model="selectedCustomizations"
              :item="item"
              @price-change="handlePriceChange"
            />
          </div>

          <!-- 數量選擇 -->
          <div class="flex items-center justify-between py-4">
            <span class="text-base font-medium text-ios-text">{{
              t("menuItemModal.quantity")
            }}</span>
            <div class="flex items-center space-x-3">
              <button
                :disabled="quantity <= 1"
                data-testid="qty-decrease"
                class="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-ios-text active:bg-gray-200 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                @click="quantity = Math.max(1, quantity - 1)"
              >
                <svg
                  class="w-5 h-5"
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
                class="text-lg font-medium text-ios-text min-w-[3rem] text-center"
              >
                {{ quantity }}
              </span>

              <button
                :disabled="quantity >= 99"
                data-testid="qty-increase"
                class="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-ios-text active:bg-gray-200 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                @click="quantity = Math.min(99, quantity + 1)"
              >
                <svg
                  class="w-5 h-5"
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
          <div>
            <label class="block text-sm font-medium text-ios-text mb-2">
              {{ t("menuItemModal.notesLabel") }}
            </label>
            <textarea
              v-model="notes"
              rows="3"
              :placeholder="t('menuItemModal.notesPlaceholder')"
              class="w-full px-4 py-3 bg-gray-100 rounded-xl border-0 focus:ring-2 focus:ring-ios-blue/30 focus:bg-white text-ios-text placeholder:text-ios-tertiary resize-none transition-all duration-200"
            />
          </div>
        </div>
      </div>

      <!-- 底部按鈕 -->
      <div
        class="sticky bottom-0 bg-white/95 backdrop-blur-xl p-6 shadow-[0_-4px_16px_rgb(0,0,0,0.04)]"
      >
        <button
          :disabled="!item.isAvailable || isOutOfStock || orderingDisabled"
          data-testid="menu-item-modal-add"
          class="w-full bg-ios-blue text-white font-semibold py-4 px-6 rounded-full active:scale-[0.98] transition-transform duration-150 disabled:bg-gray-200 disabled:text-gray-400"
          @click="handleAddToCart"
        >
          {{ buttonText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useCurrency } from "@/composables/useCurrency";
import type {
  MenuItem,
  SelectedCustomizations,
} from "@makanmasak/shared-types";
import CustomizationOptions from "./CustomizationOptions.vue";
import { useI18n } from "@/composables/useI18n";
import { menuImageAttrs } from "@/utils/menu-image";
import { getLocalizedMenuName } from "@/utils/localized-menu-content";

// Props
const props = defineProps<{
  show: boolean;
  item?: MenuItem;
  /** See `MenuItemCard` — the channel cannot take orders, the dish is fine. */
  orderingDisabled?: boolean;
}>();

const { t, tWithParams, currentLanguage } = useI18n();
const { formatPrice } = useCurrency();

// Emits
const emits = defineEmits<{
  close: [];
  "add-to-cart": [
    data: {
      item: MenuItem;
      quantity: number;
      customizations?: SelectedCustomizations;
      notes?: string;
    },
  ];
}>();

// State
const quantity = ref(1);
const notes = ref("");
const selectedCustomizations = ref<SelectedCustomizations>({});
const customizationPrice = ref(0);

// Computed
const isOutOfStock = computed(() => {
  // Same rule as MenuItemCard: null means stock is not tracked, a tracked 0 is
  // sold out (#166).
  if (!props.item?.isAvailable) return true;
  const inventoryCount = props.item?.inventoryCount;
  return inventoryCount != null && inventoryCount <= 0;
});

const hasCustomizations = computed(() => {
  if (!props.item) return false;
  const options = props.item.options;
  return !!(
    options?.sizes?.length ||
    options?.customizations?.length ||
    options?.addOns?.length
  );
});

const dietaryTags = computed(() => {
  if (!props.item) return [];

  const tags: Array<{ key: string; label: string; class: string }> = [];
  const dietary = props.item.dietaryInfo;

  if (dietary?.vegetarian) {
    tags.push({
      key: "vegetarian",
      label: t("menu.vegetarian"),
      class: "bg-ios-green-soft text-ios-green-deep",
    });
  }

  if (dietary?.vegan) {
    tags.push({
      key: "vegan",
      label: t("menu.vegan"),
      class: "bg-ios-green-soft text-ios-green-deep",
    });
  }

  if (dietary?.halal) {
    tags.push({
      key: "halal",
      label: t("menu.halal"),
      class: "bg-ios-blue-soft text-ios-blue-deep",
    });
  }

  if (dietary?.glutenFree) {
    tags.push({
      key: "gluten-free",
      label: t("menu.glutenFree"),
      class: "bg-ios-orange-soft text-ios-orange-deep",
    });
  }

  return tags;
});

const currentPrice = computed(() => {
  return (props.item?.price || 0) + customizationPrice.value;
});

const buttonText = computed(() => {
  if (!props.item?.isAvailable) return t("menuItemModal.unavailable");
  if (isOutOfStock.value) return t("menuItemModal.soldOut");

  const total = currentPrice.value * quantity.value;
  // The price goes through vue-i18n's own named interpolation. The message used
  // to be "加入購物車 · ${price}" and was post-processed with .replace("${price}"),
  // which could never match: vue-i18n consumes `{price}` first and, with no
  // named argument passed, renders it as "" — so every customer with a
  // customisable item saw a bare "加入購物車 · $" and no total.
  return tWithParams("menuItemModal.addToCart", {
    price: formatPrice(total),
  });
});

// Methods
// Hero is the first thing in the opened sheet, so it is not lazy. The sheet is
// w-full max-w-md: 392px under the 14px mobile root, 448px above 768px.
const heroImage = computed(() =>
  menuImageAttrs(
    props.item?.imageUrl,
    props.item?.imageVariants,
    "(min-width: 769px) 448px, min(100vw, 392px)",
    "large",
  ),
);

const handleImageError = (event: Event) => {
  const img = event.target as HTMLImageElement;
  img.style.display = "none";
};

const handlePriceChange = (price: number) => {
  customizationPrice.value = price;
};

const handleAddToCart = () => {
  if (!props.item) return;

  emits("add-to-cart", {
    item: props.item,
    quantity: quantity.value,
    customizations:
      Object.keys(selectedCustomizations.value).length > 0
        ? selectedCustomizations.value
        : undefined,
    notes: notes.value.trim() || undefined,
  });

  // 重置狀態
  resetForm();
  emits("close");
};

const resetForm = () => {
  quantity.value = 1;
  notes.value = "";
  selectedCustomizations.value = {};
  customizationPrice.value = 0;
};

// 監聽 show 屬性變化，重置表單
watch(
  () => props.show,
  (newShow) => {
    if (!newShow) {
      resetForm();
    }
  },
);
</script>
