<template>
  <div class="bg-white rounded-2xl shadow-sm p-4">
    <!-- Search Bar -->
    <div class="mb-3">
      <div class="relative">
        <div
          class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
        >
          <Search class="h-4 w-4 text-ios-secondary" />
        </div>
        <input
          v-model="searchText"
          type="text"
          class="block w-full pl-9 pr-9 py-2 bg-ios-bg rounded-xl text-sm text-ios-text placeholder-ios-secondary focus:outline-none focus:ring-2 focus:ring-ios-blue/30 transition"
          :placeholder="t('filters.searchPlaceholder')"
          @input="updateSearch"
        />
        <div
          v-if="searchText"
          class="absolute inset-y-0 right-0 pr-3 flex items-center"
        >
          <button
            :aria-label="t('a11y.clearSearch')"
            class="text-ios-secondary hover:text-ios-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            @click="clearSearch"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Status Pill Row -->
    <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      <!-- 全部 pill -->
      <button
        :class="[
          'rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap cursor-pointer transition-all duration-200',
          selectedStatuses.length === 0 && selectedPriorities.length === 0
            ? 'bg-blue-700 text-white shadow-sm'
            : 'bg-ios-bg text-ios-text hover:bg-ios-blue/10',
        ]"
        @click="clearStatusFilters"
      >
        {{ t("filters.all") }} ({{ props.orders.length }})
      </button>

      <!-- 待處理 pill (status 1 = confirmed/pending) -->
      <button
        :class="[
          'rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap cursor-pointer transition-all duration-200',
          selectedStatuses.includes('confirmed')
            ? 'bg-blue-700 text-white shadow-sm'
            : 'bg-ios-orange-soft text-ios-orange hover:opacity-80',
        ]"
        @click="toggleStatusFilter('confirmed')"
      >
        {{ t("filters.pending") }} ({{ pendingCount }})
      </button>

      <!-- 製作中 pill (status 2) -->
      <button
        :class="[
          'rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap cursor-pointer transition-all duration-200',
          selectedStatuses.includes('preparing')
            ? 'bg-blue-700 text-white shadow-sm'
            : 'bg-ios-blue-soft text-ios-blue hover:opacity-80',
        ]"
        @click="toggleStatusFilter('preparing')"
      >
        {{ t("filters.preparing") }} ({{ preparingCount }})
      </button>

      <!-- 完成 pill (status 3) -->
      <button
        :class="[
          'rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap cursor-pointer transition-all duration-200',
          selectedStatuses.includes('ready')
            ? 'bg-blue-700 text-white shadow-sm'
            : 'bg-ios-green-soft text-ios-green hover:opacity-80',
        ]"
        @click="toggleStatusFilter('ready')"
      >
        {{ t("filters.completed") }} ({{ doneCount }})
      </button>

      <!-- 緊急 pill -->
      <button
        :class="[
          'rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap cursor-pointer transition-all duration-200',
          selectedPriorities.includes('urgent')
            ? 'bg-red-700 text-white shadow-sm'
            : 'bg-ios-red-soft text-ios-red hover:opacity-80',
        ]"
        @click="toggleUrgentFilter"
      >
        {{ t("filters.urgent") }} ({{ urgentCount }})
      </button>

      <!-- Divider -->
      <div class="w-px bg-ios-separator self-stretch mx-0.5 flex-shrink-0" />

      <!-- Quick filter pills -->
      <button
        v-for="(filter, key) in quickFilters"
        :key="key"
        :class="[
          'rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap cursor-pointer transition-all duration-200 flex items-center gap-1.5',
          filter.active
            ? 'bg-blue-700 text-white shadow-sm'
            : 'bg-ios-bg text-ios-text hover:bg-ios-blue/10',
        ]"
        @click="applyQuickFilter(key)"
      >
        <component :is="filter.icon" class="w-3.5 h-3.5" />
        {{ filter.label }}
      </button>

      <!-- 外帶/外送 quick pill -->
      <button
        :class="[
          'rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap cursor-pointer transition-all duration-200',
          isTakeawayDeliveryActive
            ? 'bg-orange-700 text-white shadow-sm'
            : 'bg-ios-orange-soft text-ios-orange hover:opacity-80',
        ]"
        @click="toggleTakeawayDeliveryFilter"
      >
        {{ t("filters.takeawayDelivery") }}
      </button>
    </div>

    <!-- Expand / collapse row -->
    <div class="flex items-center justify-between mt-3">
      <div class="flex items-center gap-2">
        <span
          v-if="hasActiveFilters"
          class="px-2.5 py-0.5 bg-ios-blue/10 text-ios-blue rounded-full text-xs font-semibold"
        >
          {{ activeFilterCount }} {{ t("filters.activeFilters") }}
        </span>
        <span v-if="hasActiveFilters" class="text-xs text-ios-secondary">
          {{ t("filters.matchCount") }}
          <span class="font-semibold text-ios-text">{{ filteredCount }}</span>
          {{ t("filters.matchUnit") }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="hasActiveFilters"
          class="text-xs text-ios-red font-semibold hover:opacity-70 transition-opacity"
          @click="clearAllFilters"
        >
          {{ t("common.clearAll") }}
        </button>
        <button
          class="p-1.5 text-ios-secondary hover:text-ios-text rounded-lg hover:bg-ios-bg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
          :title="
            showFilters
              ? t('filters.collapseFilters')
              : t('filters.expandFilters')
          "
          :aria-label="
            showFilters
              ? t('filters.collapseFilters')
              : t('filters.expandFilters')
          "
          @click="showFilters = !showFilters"
        >
          <ChevronDown v-if="!showFilters" class="w-4 h-4" />
          <ChevronUp v-else class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Detailed Filters (collapsible) -->
    <div
      v-if="showFilters"
      class="mt-4 space-y-4 border-t border-ios-separator pt-4"
    >
      <!-- Status Filter -->
      <div>
        <label
          class="block text-xs font-semibold text-ios-secondary mb-2 uppercase tracking-wide"
          >{{ t("filters.orderStatus") }}</label
        >
        <div class="flex flex-wrap gap-2">
          <label
            v-for="status in statusOptions"
            :key="status.value"
            class="flex items-center gap-2 cursor-pointer"
          >
            <input
              v-model="selectedStatuses"
              :value="status.value"
              type="checkbox"
              class="rounded border-ios-separator text-ios-blue focus:ring-ios-blue/30"
            />
            <span class="text-sm text-ios-text">{{ status.label }}</span>
            <span :class="status.badgeClass">{{ status.count || 0 }}</span>
          </label>
        </div>
      </div>

      <!-- Priority Filter -->
      <div>
        <label
          class="block text-xs font-semibold text-ios-secondary mb-2 uppercase tracking-wide"
          >{{ t("filters.priority") }}</label
        >
        <div class="flex flex-wrap gap-2">
          <label
            v-for="priority in priorityOptions"
            :key="priority.value"
            class="flex items-center gap-2 cursor-pointer"
          >
            <input
              v-model="selectedPriorities"
              :value="priority.value"
              type="checkbox"
              class="rounded border-ios-separator text-ios-blue focus:ring-ios-blue/30"
            />
            <span class="text-sm text-ios-text">{{ priority.label }}</span>
            <span :class="priority.badgeClass">{{ priority.count || 0 }}</span>
          </label>
        </div>
      </div>

      <!-- Order Type Filter -->
      <div>
        <h4
          class="text-xs font-semibold text-ios-secondary mb-2 uppercase tracking-wide"
        >
          {{ t("filters.orderType") }}
        </h4>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="type in orderTypeOptions"
            :key="type.value"
            :class="[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-all duration-200',
              selectedOrderTypes.includes(type.value)
                ? type.activeClass
                : 'bg-ios-bg text-ios-text hover:bg-ios-blue/10',
            ]"
          >
            <input
              v-model="selectedOrderTypes"
              type="checkbox"
              :value="type.value"
              class="sr-only"
            />
            {{ type.emoji }} {{ type.label }}
          </label>
        </div>
      </div>

      <!-- Platform Source Filter -->
      <div>
        <h4
          class="text-xs font-semibold text-ios-secondary mb-2 uppercase tracking-wide"
        >
          {{ t("filters.orderSource") }}
        </h4>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="source in orderSourceOptions"
            :key="source.value"
            :class="[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-all duration-200',
              selectedOrderSources.includes(source.value)
                ? source.activeClass
                : 'bg-ios-bg text-ios-text hover:bg-ios-blue/10',
            ]"
          >
            <input
              v-model="selectedOrderSources"
              type="checkbox"
              :value="source.value"
              class="sr-only"
            />
            {{ source.emoji }} {{ source.label }}
          </label>
        </div>
      </div>

      <!-- Time Range Filter -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            class="block text-xs font-semibold text-ios-secondary mb-1 uppercase tracking-wide"
            >{{ t("filters.minWaitTime") }}</label
          >
          <div class="flex items-center gap-2">
            <input
              v-model.number="minElapsedTime"
              type="number"
              min="0"
              max="120"
              class="w-20 px-2 py-1.5 bg-ios-bg border-0 rounded-xl text-sm text-ios-text focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
            />
            <span class="text-sm text-ios-secondary">{{
              t("common.minutes")
            }}</span>
          </div>
        </div>
        <div>
          <label
            class="block text-xs font-semibold text-ios-secondary mb-1 uppercase tracking-wide"
            >{{ t("filters.maxWaitTime") }}</label
          >
          <div class="flex items-center gap-2">
            <input
              v-model.number="maxElapsedTime"
              type="number"
              min="0"
              max="120"
              class="w-20 px-2 py-1.5 bg-ios-bg border-0 rounded-xl text-sm text-ios-text focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
            />
            <span class="text-sm text-ios-secondary">{{
              t("common.minutes")
            }}</span>
          </div>
        </div>
      </div>

      <!-- Table Filter -->
      <div v-if="availableTables.length > 0">
        <label
          class="block text-xs font-semibold text-ios-secondary mb-2 uppercase tracking-wide"
          >{{ t("filters.tableNumber") }}</label
        >
        <div class="flex flex-wrap gap-2">
          <label
            v-for="table in availableTables"
            :key="table.id"
            class="flex items-center gap-2 cursor-pointer"
          >
            <input
              v-model="selectedTables"
              :value="table.id"
              type="checkbox"
              class="rounded border-ios-separator text-ios-blue focus:ring-ios-blue/30"
            />
            <span class="text-sm text-ios-text">{{ table.name }}</span>
            <span
              class="px-2 py-0.5 bg-ios-bg text-ios-secondary rounded-full text-xs font-medium"
              >{{ table.count }}</span
            >
          </label>
        </div>
      </div>

      <!-- Additional Filters -->
      <div>
        <label
          class="block text-xs font-semibold text-ios-secondary mb-2 uppercase tracking-wide"
          >{{ t("filters.otherFilters") }}</label
        >
        <div class="space-y-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="hasNotesFilter"
              type="checkbox"
              class="rounded border-ios-separator text-ios-blue focus:ring-ios-blue/30"
            />
            <span class="text-sm text-ios-text">{{
              t("filters.hasOrderNotes")
            }}</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="hasCustomizationsFilter"
              type="checkbox"
              class="rounded border-ios-separator text-ios-blue focus:ring-ios-blue/30"
            />
            <span class="text-sm text-ios-text">{{
              t("filters.hasCustomizationReq")
            }}</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Clock,
  MessageCircleMore,
  Settings2,
} from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useOrderManagementStore } from "@/stores/orderManagement";
import { storeToRefs } from "pinia";
import type { KitchenOrder, OrderStatus } from "@/types";

// Props
interface Props {
  orders: KitchenOrder[];
  filteredCount: number;
}

const props = defineProps<Props>();

const { t } = useI18n();

// Store
const orderManagementStore = useOrderManagementStore();
const { hasActiveFilters } = storeToRefs(orderManagementStore);

// Local state
const showFilters = ref(false);
const searchText = ref("");
const selectedStatuses = ref<OrderStatus[]>([]);
const selectedPriorities = ref<Array<"normal" | "high" | "urgent">>([]);
const selectedTables = ref<number[]>([]);
const selectedOrderTypes = ref<string[]>([]);
const selectedOrderSources = ref<string[]>([]);
const minElapsedTime = ref<number>();
const maxElapsedTime = ref<number>();
const hasNotesFilter = ref(false);
const hasCustomizationsFilter = ref(false);

const orderTypeOptions = computed(() => [
  {
    value: "dine_in",
    label: t("orderType.dineIn"),
    emoji: "🪑",
    activeClass: "bg-ios-blue-soft text-ios-blue",
  },
  {
    value: "takeaway",
    label: t("orderType.takeaway"),
    emoji: "🛍️",
    activeClass: "bg-green-100 text-green-700",
  },
  {
    value: "delivery",
    label: t("orderType.delivery"),
    emoji: "🛵",
    activeClass: "bg-orange-100 text-orange-700",
  },
]);

const orderSourceOptions = computed(() => [
  {
    value: "direct",
    label: t("filters.sourceSelf"),
    emoji: "\uD83C\uDFE0",
    activeClass: "bg-ios-blue-soft text-ios-blue",
  },
  {
    value: "market_checkout",
    label: t("platform.marketCheckout"),
    emoji: "\uD83C\uDFEE",
    activeClass: "bg-orange-100 text-orange-700",
  },
  {
    value: "uber_eats",
    label: t("platform.uberEats"),
    emoji: "\uD83D\uDFE2",
    activeClass: "bg-green-100 text-green-700",
  },
  {
    value: "foodpanda",
    label: t("platform.foodpanda"),
    emoji: "\uD83E\uDE77",
    activeClass: "bg-teal-100 text-teal-700",
  },
]);

// Computed counts for the pill row
const pendingCount = computed(
  () => props.orders.filter((o) => o.status === "confirmed").length,
);
const preparingCount = computed(
  () => props.orders.filter((o) => o.status === "preparing").length,
);
const doneCount = computed(
  () => props.orders.filter((o) => o.status === "ready").length,
);
const urgentCount = computed(
  () => props.orders.filter((o) => o.priority === "urgent").length,
);

// Computed
const activeFilterCount = computed(() => {
  let count = 0;
  if (searchText.value) count++;
  if (selectedStatuses.value.length > 0) count++;
  if (selectedPriorities.value.length > 0) count++;
  if (selectedTables.value.length > 0) count++;
  if (selectedOrderTypes.value.length > 0) count++;
  if (selectedOrderSources.value.length > 0) count++;
  if (minElapsedTime.value !== undefined) count++;
  if (maxElapsedTime.value !== undefined) count++;
  if (hasNotesFilter.value) count++;
  if (hasCustomizationsFilter.value) count++;
  return count;
});

const isTakeawayDeliveryActive = computed(
  () =>
    selectedOrderTypes.value.includes("takeaway") &&
    selectedOrderTypes.value.includes("delivery") &&
    !selectedOrderTypes.value.includes("dine_in"),
);

const statusOptions = computed(() => [
  {
    value: "confirmed" as OrderStatus,
    label: t("filters.confirmed"),
    count: props.orders.filter((o) => o.status === "confirmed").length,
    badgeClass:
      "px-2 py-0.5 bg-ios-orange-soft text-ios-orange rounded-full text-xs font-medium",
  },
  {
    value: "preparing" as OrderStatus,
    label: t("filters.preparing"),
    count: props.orders.filter((o) => o.status === "preparing").length,
    badgeClass:
      "px-2 py-0.5 bg-ios-blue-soft text-ios-blue rounded-full text-xs font-medium",
  },
  {
    value: "ready" as OrderStatus,
    label: t("filters.readyStatus"),
    count: props.orders.filter((o) => o.status === "ready").length,
    badgeClass:
      "px-2 py-0.5 bg-ios-green-soft text-ios-green rounded-full text-xs font-medium",
  },
]);

const priorityOptions = computed(() => [
  {
    value: "normal",
    label: t("filters.priorityNormal"),
    count: props.orders.filter((o) => o.priority === "normal").length,
    badgeClass:
      "px-2 py-0.5 bg-ios-bg text-ios-secondary rounded-full text-xs font-medium",
  },
  {
    value: "high",
    label: t("filters.priorityImportant"),
    count: props.orders.filter((o) => o.priority === "high").length,
    badgeClass:
      "px-2 py-0.5 bg-ios-orange-soft text-ios-orange rounded-full text-xs font-medium",
  },
  {
    value: "urgent",
    label: t("filters.priorityUrgent"),
    count: props.orders.filter((o) => o.priority === "urgent").length,
    badgeClass:
      "px-2 py-0.5 bg-ios-red-soft text-ios-red rounded-full text-xs font-medium",
  },
]);

const availableTables = computed(() => {
  const tableMap = new Map<
    number,
    { id: number; name: string; count: number }
  >();

  props.orders.forEach((order) => {
    if (order.tableId === undefined || order.tableName === undefined) return;
    const existing = tableMap.get(order.tableId);
    if (existing) {
      existing.count++;
    } else {
      tableMap.set(order.tableId, {
        id: order.tableId,
        name: order.tableName,
        count: 1,
      });
    }
  });

  return Array.from(tableMap.values()).sort((a, b) => a.id - b.id);
});

const quickFilters = computed(() => ({
  overdue: {
    label: t("filters.overdue"),
    icon: Clock,
    active: minElapsedTime.value === 15,
  },
  withNotes: {
    label: t("filters.hasNotes"),
    icon: MessageCircleMore,
    active: hasNotesFilter.value,
  },
  customized: {
    label: t("filters.hasCustomization"),
    icon: Settings2,
    active: hasCustomizationsFilter.value,
  },
}));

// Methods
const updateSearch = () => {
  orderManagementStore.setFilter("searchText", searchText.value);
};

const clearSearch = () => {
  searchText.value = "";
  updateSearch();
};

const clearStatusFilters = () => {
  selectedStatuses.value = [];
  selectedPriorities.value = [];
};

const toggleStatusFilter = (status: OrderStatus) => {
  if (selectedStatuses.value.includes(status)) {
    selectedStatuses.value = selectedStatuses.value.filter((s) => s !== status);
  } else {
    selectedStatuses.value = [...selectedStatuses.value, status];
  }
};

const toggleUrgentFilter = () => {
  if (selectedPriorities.value.includes("urgent")) {
    selectedPriorities.value = selectedPriorities.value.filter(
      (p) => p !== "urgent",
    );
  } else {
    selectedPriorities.value = [...selectedPriorities.value, "urgent"];
  }
};

const applyQuickFilter = (filterKey: string) => {
  switch (filterKey) {
    case "urgent":
      if (selectedPriorities.value.includes("urgent")) {
        selectedPriorities.value = selectedPriorities.value.filter(
          (p) => p !== "urgent",
        );
      } else {
        selectedPriorities.value = ["urgent"];
      }
      break;
    case "preparing":
      if (selectedStatuses.value.includes("preparing")) {
        selectedStatuses.value = selectedStatuses.value.filter(
          (s) => s !== "preparing",
        );
      } else {
        selectedStatuses.value = ["preparing"];
      }
      break;
    case "overdue":
      if (minElapsedTime.value === 15) {
        minElapsedTime.value = undefined;
      } else {
        minElapsedTime.value = 15;
      }
      break;
    case "withNotes":
      hasNotesFilter.value = !hasNotesFilter.value;
      break;
    case "customized":
      hasCustomizationsFilter.value = !hasCustomizationsFilter.value;
      break;
  }
};

const clearAllFilters = () => {
  searchText.value = "";
  selectedStatuses.value = [];
  selectedPriorities.value = [];
  selectedTables.value = [];
  selectedOrderTypes.value = [];
  selectedOrderSources.value = [];
  minElapsedTime.value = undefined;
  maxElapsedTime.value = undefined;
  hasNotesFilter.value = false;
  hasCustomizationsFilter.value = false;
  orderManagementStore.clearFilters();
};

const toggleTakeawayDeliveryFilter = () => {
  if (isTakeawayDeliveryActive.value) {
    selectedOrderTypes.value = [];
  } else {
    selectedOrderTypes.value = ["takeaway", "delivery"];
  }
};

// Watch for changes and update store
watch(selectedStatuses, (newValue) => {
  orderManagementStore.setFilter(
    "status",
    newValue.length > 0 ? newValue : undefined,
  );
});

watch(selectedPriorities, (newValue) => {
  orderManagementStore.setFilter(
    "priority",
    newValue.length > 0 ? newValue : undefined,
  );
});

watch(selectedTables, (newValue) => {
  orderManagementStore.setFilter(
    "tableIds",
    newValue.length > 0 ? newValue : undefined,
  );
});

watch(minElapsedTime, (newValue) => {
  orderManagementStore.setFilter("minElapsedTime", newValue);
});

watch(maxElapsedTime, (newValue) => {
  orderManagementStore.setFilter("maxElapsedTime", newValue);
});

watch(hasNotesFilter, (newValue) => {
  orderManagementStore.setFilter("hasNotes", newValue ? true : undefined);
});

watch(hasCustomizationsFilter, (newValue) => {
  orderManagementStore.setFilter(
    "hasCustomizations",
    newValue ? true : undefined,
  );
});

watch(selectedOrderTypes, (newValue) => {
  orderManagementStore.setFilter(
    "orderTypes",
    newValue.length > 0 ? newValue : undefined,
  );
});

watch(selectedOrderSources, (newValue) => {
  orderManagementStore.setFilter(
    "orderSources",
    newValue.length > 0 ? newValue : undefined,
  );
});
</script>
