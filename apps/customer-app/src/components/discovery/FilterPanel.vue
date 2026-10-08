<template>
  <div
    class="bg-ios-card rounded-2xl shadow-[0_2px_8px_rgb(0,0,0,0.04)] overflow-hidden"
  >
    <button
      data-testid="discovery-filter-toggle"
      class="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-700"
      @click="isOpen = !isOpen"
    >
      <span>{{ t("discovery.filters") }}</span>
      <svg
        class="w-4 h-4 transition-transform"
        :class="{ 'rotate-180': isOpen }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>
    <div
      v-if="isOpen"
      class="px-4 pb-4 space-y-4 border-t border-ios-separator"
    >
      <div class="pt-3 flex flex-wrap gap-2">
        <button
          class="px-3 py-1.5 text-xs rounded-full transition-colors"
          :class="
            filters.openNow
              ? 'bg-ios-green/15 text-ios-green font-semibold'
              : 'bg-ios-bg text-ios-secondary hover:bg-ios-separator'
          "
          :aria-pressed="filters.openNow"
          @click="toggle('openNow')"
        >
          {{ t("discovery.openNow") }}
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-full transition-colors"
          :class="
            filters.takeaway
              ? 'bg-ios-blue/15 text-ios-blue font-semibold'
              : 'bg-ios-bg text-ios-secondary hover:bg-ios-separator'
          "
          :aria-pressed="filters.takeaway"
          @click="toggle('takeaway')"
        >
          {{ t("discovery.takeaway") }}
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-full transition-colors"
          :class="
            filters.delivery
              ? 'bg-ios-orange/15 text-ios-orange font-semibold'
              : 'bg-ios-bg text-ios-secondary hover:bg-ios-separator'
          "
          :aria-pressed="filters.delivery"
          @click="toggle('delivery')"
        >
          {{ t("discovery.delivery") }}
        </button>
      </div>
      <div v-if="cities.length > 0">
        <label class="text-xs font-medium text-gray-500 mb-1 block">
          {{ t("discovery.city") }}
        </label>
        <select
          :value="filters.city || ''"
          data-testid="discovery-city-select"
          class="w-full text-sm bg-ios-bg rounded-xl px-3 py-2 focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
          @change="onCityChange"
        >
          <option value="">{{ t("discovery.allCities") }}</option>
          <option v-for="city in cities" :key="city" :value="city">
            {{ city }}
          </option>
        </select>
      </div>
      <div v-if="districts.length > 0">
        <label class="text-xs font-medium text-gray-500 mb-1 block">
          {{ t("discovery.district") }}
        </label>
        <select
          :value="filters.district || ''"
          class="w-full text-sm bg-ios-bg rounded-xl px-3 py-2 focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
          @change="onDistrictChange"
        >
          <option value="">{{ t("discovery.allDistricts") }}</option>
          <option v-for="d in districts" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <div v-if="categories.length > 0">
        <label class="text-xs font-medium text-gray-500 mb-1 block">
          {{ t("discovery.category") }}
        </label>
        <select
          :value="filters.categoryName || ''"
          data-testid="discovery-category-select"
          class="w-full text-sm bg-ios-bg rounded-xl px-3 py-2 focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
          @change="onCategoryChange"
        >
          <option value="">{{ t("discovery.allCategories") }}</option>
          <option
            v-for="category in categories"
            :key="category"
            :value="category"
          >
            {{ category }}
          </option>
        </select>
      </div>
      <div v-if="serviceTypeOptions.length > 0">
        <label class="text-xs font-medium text-gray-500 mb-1 block">
          服務類型
        </label>
        <select
          :value="filters.serviceType || ''"
          data-testid="discovery-service-type-select"
          class="w-full text-sm bg-ios-bg rounded-xl px-3 py-2 focus:ring-2 focus:ring-ios-blue focus:bg-white transition"
          @change="onServiceTypeChange"
        >
          <option value="">全部服務</option>
          <option
            v-for="option in serviceTypeOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }} {{ option.count }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { SearchFilters, ServiceTypeFacet } from "@/services/discoveryApi";

const { t } = useI18n();

const props = defineProps<{
  filters: SearchFilters;
  cities: string[];
  districts: string[];
  categories: string[];
  serviceTypes: ServiceTypeFacet[];
}>();

const emit = defineEmits<{
  "update:filters": [filters: SearchFilters];
}>();

const isOpen = ref(false);
const serviceTypeLabels = new Map<
  NonNullable<SearchFilters["serviceType"]>,
  string
>([
  ["general", "一般服務"],
  ["booking", "預約"],
  ["pickup", "自取"],
  ["delivery", "外送"],
  ["consultation", "諮詢"],
  ["rental", "租借"],
  ["activity", "活動"],
]);
const serviceTypeOptions = computed(() =>
  props.serviceTypes.map((facet) => ({
    value: facet.serviceType,
    label: serviceTypeLabels.get(facet.serviceType) ?? facet.serviceType,
    count: facet.count,
  })),
);

function toggle(key: "openNow" | "takeaway" | "delivery") {
  emit("update:filters", {
    ...props.filters,
    [key]: !props.filters[key],
  });
}

function onDistrictChange(e: Event) {
  const target = e.target as HTMLSelectElement;
  emit("update:filters", {
    ...props.filters,
    district: target.value || undefined,
  });
}

function onCityChange(e: Event) {
  const target = e.target as HTMLSelectElement;
  emit("update:filters", {
    ...props.filters,
    city: target.value || undefined,
    district: undefined,
  });
}

function onCategoryChange(e: Event) {
  const target = e.target as HTMLSelectElement;
  emit("update:filters", {
    ...props.filters,
    categoryName: target.value || undefined,
  });
}

function onServiceTypeChange(e: Event) {
  const target = e.target as HTMLSelectElement;
  emit("update:filters", {
    ...props.filters,
    serviceType: (target.value || undefined) as SearchFilters["serviceType"],
  });
}
</script>
