<template>
  <div class="flex items-start space-x-3 py-3">
    <!-- 商品圖片 -->
    <div class="flex-shrink-0">
      <div class="w-12 h-12 rounded-xl overflow-hidden bg-gray-100">
        <img
          v-if="item.menuItem?.imageUrl"
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
            class="w-5 h-5"
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
      <div class="flex items-start justify-between">
        <div class="flex-1 min-w-0 mr-2">
          <h4 class="text-sm font-medium text-ios-text">
            {{
              item.menuItem
                ? getLocalizedMenuName(item.menuItem, currentLanguage)
                : t("orderItem.unknownItem")
            }}
          </h4>

          <!-- 客製化資訊 -->
          <div v-if="customizationText" class="mt-1">
            <p class="text-xs text-ios-secondary">
              {{ customizationText }}
            </p>
          </div>

          <!-- 備註 -->
          <div v-if="item.notes" class="mt-1">
            <p class="text-xs text-ios-secondary">
              <span class="font-medium">{{ t("orderItem.notes") }}</span
              >{{ item.notes }}
            </p>
          </div>

          <!-- 狀態標籤 -->
          <div v-if="showStatus" class="mt-2">
            <span
              :class="[
                'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                statusClasses,
              ]"
            >
              <div
                v-if="item.status === 'preparing'"
                class="w-2 h-2 bg-current rounded-full animate-pulse mr-1"
              />
              {{ statusText }}
            </span>
          </div>
        </div>

        <!-- 數量和價格 -->
        <div class="text-right">
          <div class="text-sm text-ios-secondary">× {{ item.quantity }}</div>
          <div class="text-sm font-medium text-ios-text">
            {{ formatPrice(itemTotal) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useCurrency } from "@/composables/useCurrency";
import { type OrderItem } from "@makanmasak/shared-types";
import { useI18n } from "@/composables/useI18n";
import { menuImageAttrs } from "@/utils/menu-image";
import { getLocalizedMenuName } from "@/utils/localized-menu-content";

// Props
const props = defineProps<{
  item: OrderItem;
  showStatus?: boolean;
}>();

const { t, currentLanguage } = useI18n();
const { formatPrice } = useCurrency();

// Computed
const itemTotal = computed(() => {
  return props.item.totalPrice;
});

const customizationText = computed(() => {
  if (!props.item.customizations) return "";

  const parts: string[] = [];
  const customizations = props.item.customizations;

  // 尺寸
  if (customizations.size) {
    parts.push(customizations.size.name);
  }

  // 客製化選項
  if (customizations.options && customizations.options.length > 0) {
    const optionNames = customizations.options.map((opt) => opt.choiceName);
    parts.push(...optionNames);
  }

  // 加購項目
  if (customizations.addOns && customizations.addOns.length > 0) {
    const addOnNames = customizations.addOns.map((addOn) => `+${addOn.name}`);
    parts.push(...addOnNames);
  }

  return parts.join(", ");
});

const statusMap = computed<Record<string, string>>(() => ({
  pending: t("orderItem.statusPending"),
  preparing: t("orderItem.statusPreparing"),
  ready: t("orderItem.statusReady"),
  served: t("orderItem.statusServed"),
}));

const statusText = computed(() => {
  if (!props.showStatus || props.item.status === undefined) return "";
  return (
    statusMap.value[props.item.status as keyof typeof statusMap.value] || ""
  );
});

const statusClasses = computed(() => {
  if (!props.showStatus || props.item.status === undefined) return "";

  const classMap: Record<string, string> = {
    pending: "bg-ios-orange/15 text-ios-orange",
    preparing: "bg-ios-orange/15 text-ios-orange",
    ready: "bg-ios-green/15 text-ios-green",
    served: "bg-gray-100 text-ios-secondary",
  };

  return (
    classMap[props.item.status as keyof typeof classMap] ||
    "bg-gray-100 text-ios-secondary"
  );
});

// Methods
// w-12 is 42px under the 14px mobile root, 48px above 768px. Order payloads
// carry no imageVariants yet, so this resolves to the plain imageUrl.
const thumb = computed(() =>
  menuImageAttrs(
    props.item.menuItem?.imageUrl,
    (props.item.menuItem as { imageVariants?: unknown } | undefined)
      ?.imageVariants,
    "(min-width: 769px) 48px, 42px",
    "thumbnail",
  ),
);

const handleImageError = (event: Event) => {
  const img = event.target as HTMLImageElement;
  img.style.display = "none";
};
</script>
