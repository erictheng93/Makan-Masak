<template>
  <div class="space-y-4">
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 5" :key="i" class="animate-pulse">
        <div class="flex items-center justify-between py-3">
          <div class="flex items-center space-x-3">
            <div class="w-12 h-12 bg-gray-300 rounded-lg" />
            <div class="space-y-2">
              <div class="h-4 bg-gray-300 rounded w-32" />
              <div class="h-3 bg-gray-300 rounded w-24" />
            </div>
          </div>
          <div class="space-y-2">
            <div class="h-4 bg-gray-300 rounded w-16" />
            <div class="h-3 bg-gray-300 rounded w-20" />
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="!items || items.length === 0"
      class="text-center py-8 text-gray-500"
    >
      <Package class="w-16 h-16 mx-auto mb-4 text-gray-300" />
      <p>{{ t("charts.topMenuItems.noData") }}</p>
    </div>

    <div v-else class="space-y-1">
      <div
        v-for="(item, index) in items"
        :key="item.id"
        class="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
        @click="$emit('itemClick', item)"
      >
        <div class="flex items-center space-x-3">
          <div class="flex-shrink-0 relative">
            <div
              class="w-12 h-12 rounded-lg bg-gradient-to-br shadow-sm flex items-center justify-center"
              :class="getRankColor(index)"
            >
              <span class="text-white font-bold text-sm">#{{ index + 1 }}</span>
            </div>
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center space-x-2">
              <p class="text-sm font-medium text-gray-900 truncate">
                {{ item.name }}
              </p>
              <span
                v-if="item.category"
                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600"
              >
                {{ item.category }}
              </span>
            </div>
            <div class="flex items-center space-x-2 mt-1">
              <p class="text-xs text-gray-500">
                {{ t("charts.topMenuItems.sold", { count: item.quantity }) }}
              </p>
              <span class="text-gray-300">•</span>
              <p class="text-xs text-green-600 font-medium">
                {{ formatPrice(item.revenue) }}
              </p>
            </div>
          </div>
        </div>

        <div class="flex-shrink-0 text-right">
          <div class="flex items-center space-x-2">
            <div class="text-right">
              <p class="text-sm font-semibold text-gray-900">
                {{ item.quantity }}
              </p>
              <p class="text-xs text-gray-500">
                {{ t("charts.topMenuItems.quantity") }}
              </p>
            </div>

            <div class="w-16">
              <div class="bg-gray-200 rounded-full h-2">
                <div
                  class="h-2 rounded-full transition-all duration-500"
                  :class="getRankBarColor(index)"
                  :style="{ width: getProgressWidth(item, index) + '%' }"
                />
              </div>
              <p class="text-xs text-gray-500 mt-1 text-center">
                {{ getPercentage(item) }}%
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="items && items.length > 0 && !loading"
      class="pt-4 border-t border-gray-100"
    >
      <div class="flex items-center justify-between text-sm">
        <span class="text-gray-600">{{
          t("charts.topMenuItems.totalLabel")
        }}</span>
        <span class="font-medium text-gray-900">
          {{
            t("charts.topMenuItems.totalValue", {
              quantity: totalQuantity,
              revenue: formatPrice(totalRevenue),
            })
          }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Package } from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";

const { t } = useI18n();
const { formatPrice } = useCurrency();

interface TopMenuItem {
  id: string;
  name: string;
  quantity: number;
  revenue: number;
  category?: string;
  percentage?: number;
}

interface TopMenuItemsProps {
  items: TopMenuItem[];
  loading?: boolean;
  maxItems?: number;
}

const props = withDefaults(defineProps<TopMenuItemsProps>(), {
  loading: false,
  maxItems: 10,
});

defineEmits<{
  itemClick: [item: TopMenuItem];
}>();

const totalQuantity = computed(() => {
  return props.items.reduce((sum, item) => sum + item.quantity, 0);
});

const totalRevenue = computed(() => {
  return props.items.reduce((sum, item) => sum + item.revenue, 0);
});

const maxQuantity = computed(() => {
  if (!props.items || props.items.length === 0) return 0;
  return Math.max(...props.items.map((item) => item.quantity));
});

const getRankColor = (index: number) => {
  const colors = [
    "from-yellow-400 to-yellow-600", // Gold - 1st place
    "from-gray-400 to-gray-600", // Silver - 2nd place
    "from-orange-400 to-orange-600", // Bronze - 3rd place
    "from-blue-400 to-blue-600", // Blue - 4th place
    "from-teal-400 to-teal-600", // Purple - 5th place
  ];

  if (index < colors.length) {
    return colors[index];
  }
  return "from-gray-300 to-gray-500"; // Default for lower ranks
};

const getRankBarColor = (index: number) => {
  const colors = [
    "bg-yellow-400", // Gold
    "bg-gray-400", // Silver
    "bg-orange-400", // Bronze
    "bg-blue-400", // Blue
    "bg-teal-400", // Purple
  ];

  if (index < colors.length) {
    return colors[index];
  }
  return "bg-gray-300"; // Default
};

const getProgressWidth = (item: TopMenuItem, index: number) => {
  if (maxQuantity.value === 0) return 0;

  // Top 3 items get higher minimum width for visibility
  const minWidth = index < 3 ? 20 : 10;
  const calculatedWidth = (item.quantity / maxQuantity.value) * 100;

  return Math.max(minWidth, calculatedWidth);
};

const getPercentage = (item: TopMenuItem) => {
  if (totalQuantity.value === 0) return 0;
  return Math.round((item.quantity / totalQuantity.value) * 100);
};
</script>
