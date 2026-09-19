<template>
  <section class="space-y-3">
    <div>
      <h2
        data-testid="market-product-search-title"
        class="text-base font-semibold text-gray-900"
      >
        {{ t("markets.search.title") }}
      </h2>
      <p class="mt-1 text-sm text-gray-500">
        {{ t("markets.search.subtitle") }}
      </p>
    </div>

    <form class="space-y-3" @submit.prevent="submitSearch">
      <div class="flex items-center gap-2">
        <input
          v-model="query"
          data-testid="market-product-search-input"
          type="search"
          class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
          :placeholder="t('markets.search.placeholder')"
        />
        <button
          type="submit"
          class="h-10 shrink-0 rounded-lg bg-ios-blue px-4 text-sm font-medium text-white disabled:bg-gray-300"
          :disabled="loading || !canSearch"
        >
          {{ t("markets.common.search") }}
        </button>
      </div>

      <div
        data-testid="market-result-kind-control"
        class="grid grid-cols-5 gap-1 rounded-lg bg-gray-100 p-1"
      >
        <button
          v-for="option in resultKindOptions"
          :key="option.value"
          type="button"
          :data-testid="`market-result-kind-${option.value}`"
          class="h-9 rounded-md px-1 text-sm font-medium transition-colors"
          :class="
            resultKind === option.value
              ? 'bg-white text-ios-blue shadow-sm'
              : 'text-gray-600'
          "
          @click="selectResultKind(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <label
        class="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm text-gray-700"
      >
        <input
          v-model="takeawayOnly"
          data-testid="market-product-takeaway-filter"
          type="checkbox"
          class="rounded border-gray-300 text-ios-blue focus:ring-ios-blue"
          @change="onFulfillmentFilterChange"
        />
        {{ t("markets.search.takeawayOnly") }}
      </label>
      <label
        class="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm text-gray-700"
      >
        <input
          v-model="deliveryOnly"
          data-testid="market-product-delivery-filter"
          type="checkbox"
          class="rounded border-gray-300 text-ios-blue focus:ring-ios-blue"
          @change="onFulfillmentFilterChange"
        />
        {{ t("markets.search.deliveryOnly") }}
      </label>
      <button
        type="button"
        data-testid="market-product-use-location"
        class="inline-flex h-9 items-center gap-2 rounded-lg border border-ios-blue px-3 text-sm font-medium text-ios-blue disabled:border-gray-300 disabled:text-gray-400"
        :disabled="locating"
        @click="useCurrentLocation"
      >
        {{
          locating ? t("markets.common.locating") : t("markets.common.nearest")
        }}
      </button>
      <select
        v-if="
          resultKind !== 'service' &&
          resultKind !== 'vendor' &&
          categoryOptions.length > 0
        "
        v-model="selectedCategory"
        data-testid="market-product-category-select"
        class="h-9 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
        @change="searchIfReady"
      >
        <option value="">{{ t("markets.search.allCategories") }}</option>
        <option
          v-for="category in categoryOptions"
          :key="category"
          :value="category"
        >
          {{ category }}
        </option>
      </select>
      <select
        v-if="
          (resultKind === 'all' || resultKind === 'service') &&
          serviceTypeOptions.length > 0
        "
        v-model="selectedServiceType"
        data-testid="market-service-type-select"
        class="h-9 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
        @change="onServiceTypeChange"
      >
        <option value="">{{ t("markets.search.allServices") }}</option>
        <option
          v-for="option in serviceTypeOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }} {{ option.count }}
        </option>
      </select>
      <select
        v-if="resultKind !== 'vendor'"
        v-model="sortBy"
        data-testid="market-product-sort-select"
        class="h-9 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
        @change="searchIfReady"
      >
        <option value="relevance">
          {{ t("markets.search.sort.relevance") }}
        </option>
        <option value="price_asc">
          {{ t("markets.search.sort.price_asc") }}
        </option>
        <option value="price_desc">
          {{ t("markets.search.sort.price_desc") }}
        </option>
        <option value="popular">{{ t("markets.search.sort.popular") }}</option>
        <option value="open_now">
          {{ t("markets.search.sort.open_now") }}
        </option>
        <option v-if="userLocation" value="distance">
          {{ t("markets.search.sort.distance") }}
        </option>
      </select>
    </form>

    <section
      v-if="hasSearched || hasActiveFilters"
      data-testid="market-product-search-summary"
      class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
    >
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-medium text-gray-500">
          {{ t("markets.search.activeFilters") }}
        </p>
        <button
          v-if="hasActiveFilters"
          type="button"
          data-testid="market-product-clear-filters"
          class="h-8 shrink-0 rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-700"
          @click="clearFilters"
        >
          {{ t("markets.common.clearFilters") }}
        </button>
      </div>
      <div
        v-if="activeFilterLabels.length > 0"
        class="mt-2 flex flex-wrap gap-1.5"
      >
        <span
          v-for="label in activeFilterLabels"
          :key="label"
          class="rounded-full bg-white px-2 py-1 text-xs text-gray-700 ring-1 ring-gray-200"
        >
          {{ label }}
        </span>
      </div>
      <p v-else class="mt-1 text-sm text-gray-600">
        {{ t("markets.search.browseAll") }}
      </p>
    </section>

    <div
      v-if="loading && combinedResultCount === 0"
      class="py-8 text-center text-sm text-gray-500"
    >
      {{ t("markets.search.searching") }}
    </div>
    <div
      v-else-if="error && combinedResultCount === 0"
      class="py-6 text-center text-sm text-red-500"
    >
      {{ error }}
    </div>
    <div
      v-else-if="hasSearched && combinedResultCount === 0"
      data-testid="market-product-empty-state"
      class="space-y-3 py-8 text-center text-sm text-gray-500"
    >
      <p class="font-medium text-gray-700">
        {{ emptyStateTitle }}
      </p>
      <p class="text-xs text-gray-400">
        {{ emptyStateDescription }}
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <button
          v-if="resultKind !== 'vendor'"
          type="button"
          data-testid="market-empty-browse-vendors"
          class="h-10 rounded-lg border border-ios-blue px-3 text-sm font-medium text-ios-blue"
          @click="browseFallback('vendor')"
        >
          {{ t("markets.search.viewVendorList") }}
        </button>
        <button
          v-if="resultKind !== 'service'"
          type="button"
          data-testid="market-empty-browse-services"
          class="h-10 rounded-lg border border-emerald-500 px-3 text-sm font-medium text-emerald-700"
          @click="browseFallback('service')"
        >
          {{ t("markets.search.viewAvailableServices") }}
        </button>
      </div>
    </div>
    <div v-else-if="combinedResultCount > 0" class="space-y-2">
      <p class="text-sm text-gray-500">
        {{
          tWithParams("markets.search.resultCount", {
            shown: combinedResultCount,
            total: combinedTotal,
          })
        }}
      </p>
      <article
        v-for="vendor in vendorResults"
        :key="vendor.restaurantId"
        class="rounded-lg border border-gray-200 bg-white p-3"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="truncate text-sm font-semibold text-gray-900">
                {{ vendor.name }}
              </h3>
              <span
                class="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
              >
                {{ t("markets.search.vendorTag") }}
              </span>
            </div>
            <p class="mt-1 truncate text-sm text-gray-500">
              {{ vendor.district || t("markets.common.unzoned") }}
              <span
                v-if="vendor.marketVendor?.stallNumber"
                class="text-gray-400"
              >
                ·
                {{
                  tWithParams("markets.common.stallWithNumber", {
                    number: vendor.marketVendor.stallNumber,
                  })
                }}
              </span>
              <span v-if="distanceLabel(vendor)" class="text-gray-400">
                · {{ distanceLabel(vendor) }}
              </span>
            </p>
          </div>
          <span
            class="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
            :class="
              vendor.isOpen
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            "
          >
            {{
              vendor.isOpen
                ? t("markets.common.open")
                : t("markets.common.closed")
            }}
          </span>
        </div>
        <div
          class="mt-2 flex flex-wrap gap-1"
          :data-testid="`vendor-result-services-${vendor.restaurantId}`"
        >
          <span
            v-if="vendor.supportsTakeaway"
            class="rounded bg-ios-bg px-2 py-0.5 text-xs text-ios-secondary"
          >
            {{ t("markets.common.takeawayAvailable") }}
          </span>
          <span
            v-if="vendor.supportsDelivery"
            class="rounded bg-ios-bg px-2 py-0.5 text-xs text-ios-secondary"
          >
            {{ t("markets.common.deliveryAvailable") }}
          </span>
        </div>
        <div
          data-testid="vendor-result-access"
          class="mt-2 flex flex-wrap gap-1"
        >
          <span
            class="rounded px-2 py-0.5 text-xs font-medium"
            :class="
              (vendor.availableMenuItemCount ?? 0) > 0
                ? 'bg-ios-blue/10 text-ios-blue'
                : 'bg-gray-50 text-gray-500'
            "
          >
            {{
              (vendor.availableMenuItemCount ?? 0) > 0
                ? tWithParams("markets.common.menuItemCount", {
                    count: vendor.availableMenuItemCount,
                  })
                : t("markets.common.noMenuItems")
            }}
          </span>
          <span
            class="rounded px-2 py-0.5 text-xs font-medium"
            :class="
              (vendor.publicServiceItemCount ?? 0) > 0
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-gray-50 text-gray-500'
            "
          >
            {{
              (vendor.publicServiceItemCount ?? 0) > 0
                ? tWithParams("markets.common.serviceCount", {
                    count: vendor.publicServiceItemCount,
                  })
                : t("markets.common.noServices")
            }}
          </span>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="vendor-result-open-menu"
            class="rounded-lg border border-ios-blue px-3 py-2 text-sm font-medium text-ios-blue disabled:border-gray-200 disabled:text-gray-400"
            :disabled="(vendor.availableMenuItemCount ?? 0) <= 0"
            @click="$emit('selectVendor', vendor)"
          >
            {{ t("markets.common.viewMenu") }}
          </button>
          <button
            type="button"
            data-testid="vendor-result-open-services"
            class="rounded-lg border border-emerald-500 px-3 py-2 text-sm font-medium text-emerald-700 disabled:border-gray-200 disabled:text-gray-400"
            :disabled="(vendor.publicServiceItemCount ?? 0) <= 0"
            @click="$emit('selectVendorServices', vendor)"
          >
            {{ t("markets.common.viewServices") }}
          </button>
        </div>
      </article>
      <DishResultCard
        v-for="dish in results"
        :key="dish.menuItemId"
        :dish="dish"
        @select="$emit('select', dish)"
        @takeaway="$emit('takeaway', dish)"
      />
      <article
        v-for="service in serviceResults"
        :key="service.serviceItemId"
        class="rounded-lg border border-gray-200 bg-white p-3"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="truncate text-sm font-semibold text-gray-900">
                {{ service.name }}
              </h3>
              <span
                class="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
              >
                {{ t("markets.search.serviceTag") }}
              </span>
            </div>
            <p class="mt-1 truncate text-sm text-gray-500">
              {{ service.restaurantName }}
              <span
                v-if="service.marketVendor?.stallNumber"
                class="text-gray-400"
              >
                ·
                {{
                  tWithParams("markets.common.stallWithNumber", {
                    number: service.marketVendor.stallNumber,
                  })
                }}
              </span>
              <span v-if="distanceLabel(service)" class="text-gray-400">
                · {{ distanceLabel(service) }}
              </span>
            </p>
          </div>
          <span
            v-if="servicePriceLabel(service)"
            class="shrink-0 text-sm font-semibold text-gray-900"
          >
            {{ servicePriceLabel(service) }}
          </span>
        </div>
        <p
          v-if="service.description"
          class="mt-2 line-clamp-2 text-sm leading-5 text-gray-600"
        >
          {{ service.description }}
        </p>
        <div v-if="service.tags.length > 0" class="mt-2 flex flex-wrap gap-1">
          <span
            v-for="tag in service.tags.slice(0, 4)"
            :key="tag"
            class="rounded-full bg-ios-blue/10 px-2 py-0.5 text-xs text-ios-blue"
          >
            {{ tag }}
          </span>
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs text-gray-500">
            {{
              service.isOpen
                ? t("markets.search.openNow")
                : t("markets.search.closedNow")
            }}
          </p>
          <div class="flex flex-wrap justify-end gap-2">
            <button
              v-if="service.requiresBooking"
              type="button"
              data-testid="service-result-booking"
              class="h-9 rounded-lg border border-emerald-500 px-3 text-sm font-medium text-emerald-700"
              @click="openServiceBooking(service)"
            >
              {{ t("markets.search.bookDirect") }}
            </button>
            <a
              v-else-if="safeExternalHref(service.bookingUrl)"
              :href="safeExternalHref(service.bookingUrl)!"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="service-result-booking-url"
              class="inline-flex h-9 items-center rounded-lg border border-emerald-500 px-3 text-sm font-medium text-emerald-700"
            >
              {{ t("markets.search.openBooking") }}
            </a>
            <button
              type="button"
              data-testid="service-result-open"
              class="h-9 rounded-lg border border-ios-blue px-3 text-sm font-medium text-ios-blue"
              @click="$emit('selectService', service)"
            >
              {{ t("markets.common.viewServices") }}
            </button>
          </div>
        </div>
      </article>
      <p
        v-if="error"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
      >
        {{ error }}
      </p>
      <button
        v-if="hasMoreResults"
        type="button"
        data-testid="market-product-load-more"
        class="h-10 w-full rounded-lg border border-ios-blue px-4 text-sm font-medium text-ios-blue disabled:border-gray-300 disabled:text-gray-400"
        :disabled="loading"
        @click="loadMore"
      >
        {{
          loading ? t("markets.common.loading") : t("markets.common.loadMore")
        }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DishResultCard from "@/components/discovery/DishResultCard.vue";
import { useCurrency } from "@/composables/useCurrency";
import { useI18n } from "@/composables/useI18n";
import {
  discoveryApi,
  type DishSearchResult,
  type MarketSearchScopeMetadata,
  type RestaurantListItem,
  type ServiceTypeFacet,
  type ServiceSearchResult,
} from "@/services/discoveryApi";
import { safeExternalHref } from "@/utils/safeExternalHref";

const props = withDefaults(
  defineProps<{
    marketId: string;
    categories?: string[];
    autoLoad?: boolean;
    initialQuery?: string;
    initialCategory?: string;
    initialServiceType?: ServiceTypeFilter | "";
    initialResultKind?: ResultKind;
    initialTakeaway?: boolean;
    initialDelivery?: boolean;
    initialSortBy?: MarketProductSort;
    initialLat?: number;
    initialLng?: number;
    initialRadiusKm?: number;
  }>(),
  {
    categories: () => [],
    autoLoad: true,
    initialQuery: "",
    initialCategory: "",
    initialServiceType: "",
    initialResultKind: "all",
    initialTakeaway: false,
    initialDelivery: false,
    initialSortBy: "relevance",
    initialLat: undefined,
    initialLng: undefined,
    initialRadiusKm: undefined,
  },
);

const emit = defineEmits<{
  select: [dish: DishSearchResult];
  takeaway: [dish: DishSearchResult];
  selectService: [service: ServiceSearchResult];
  selectVendor: [vendor: RestaurantListItem];
  selectVendorServices: [vendor: RestaurantListItem];
  searchStateChange: [
    state: {
      q: string;
      categoryName: string;
      serviceType: ServiceTypeFilter | "";
      resultKind: ResultKind;
      takeaway: boolean;
      delivery: boolean;
      sortBy: MarketProductSort;
      lat?: number;
      lng?: number;
      radiusKm?: number;
    },
  ];
}>();

const { formatPriceIn } = useCurrency();
const { t, tWithParams } = useI18n();
const router = useRouter();
const query = ref(props.initialQuery);
const takeawayOnly = ref(props.initialTakeaway);
const deliveryOnly = ref(props.initialDelivery);
const normalizedInitialResultKind =
  props.initialServiceType && props.initialResultKind === "all"
    ? "service"
    : props.initialResultKind;
const selectedCategory = ref(
  normalizedInitialResultKind === "service" ? "" : props.initialCategory,
);
const selectedServiceType = ref<ServiceTypeFilter | "">(
  props.initialServiceType,
);
const resultKind = ref<ResultKind>(normalizedInitialResultKind);
const initialLocation =
  props.initialLat != null && props.initialLng != null
    ? { lat: props.initialLat, lng: props.initialLng }
    : null;
const sortBy = ref<MarketProductSort>(
  (normalizedInitialResultKind === "vendor" &&
    props.initialSortBy !== "distance") ||
    (props.initialSortBy === "distance" && !initialLocation)
    ? "relevance"
    : props.initialSortBy,
);
const userLocation = ref<{ lat: number; lng: number } | null>(initialLocation);
const radiusKm = ref(props.initialRadiusKm ?? 2);
const locating = ref(false);
const loadedCategories = ref<string[]>([]);
const loadedServiceTypes = ref<ServiceTypeFacet[]>([]);
const results = ref<DishSearchResult[]>([]);
const serviceResults = ref<ServiceSearchResult[]>([]);
const vendorResults = ref<RestaurantListItem[]>([]);
const total = ref(0);
const serviceTotal = ref(0);
const vendorTotal = ref(0);
const marketSearchScope = ref<MarketSearchScopeMetadata | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const hasSearched = ref(false);
const page = ref(1);
const pageSize = 20;
type ServiceTypeFilter =
  | "general"
  | "booking"
  | "pickup"
  | "delivery"
  | "consultation"
  | "rental"
  | "activity";
type ResultKind = "all" | "menu_item" | "product" | "service" | "vendor";
type MarketProductSort =
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "popular"
  | "open_now"
  | "distance";
const RESULT_KINDS: ResultKind[] = [
  "all",
  "menu_item",
  "product",
  "service",
  "vendor",
];
const SERVICE_TYPES: ServiceTypeFilter[] = [
  "general",
  "booking",
  "pickup",
  "delivery",
  "consultation",
  "rental",
  "activity",
];
const resultKindOptions = computed(() =>
  RESULT_KINDS.map((value) => ({
    value,
    label: t(`markets.search.resultKind.${value}`),
  })),
);
const resultKindLabel = (kind: ResultKind) =>
  t(`markets.search.resultKind.${kind}`);
const serviceTypeLabel = (type: ServiceTypeFilter | string) =>
  SERVICE_TYPES.includes(type as ServiceTypeFilter)
    ? t(`markets.serviceType.${type}`)
    : String(type);
const sortLabel = (sort: MarketProductSort) => t(`markets.search.sort.${sort}`);

const combinedResultCount = computed(
  () =>
    vendorResults.value.length +
    results.value.length +
    serviceResults.value.length,
);
const combinedTotal = computed(
  () => vendorTotal.value + total.value + serviceTotal.value,
);
const hasMoreResults = computed(
  () =>
    vendorResults.value.length < vendorTotal.value ||
    results.value.length < total.value ||
    serviceResults.value.length < serviceTotal.value,
);
const categoryOptions = computed(() =>
  props.categories.length > 0 ? props.categories : loadedCategories.value,
);
const serviceTypeOptions = computed(() =>
  loadedServiceTypes.value.map((facet) => ({
    value: facet.serviceType,
    label: serviceTypeLabel(facet.serviceType),
    count: facet.count,
  })),
);
const shouldSearchCatalog = computed(
  () => resultKind.value !== "service" && resultKind.value !== "vendor",
);
const shouldSearchServices = computed(
  () => resultKind.value === "all" || resultKind.value === "service",
);
const shouldSearchVendors = computed(
  () => resultKind.value === "all" || resultKind.value === "vendor",
);
const selectedCatalogType = computed<"menu_item" | "product" | undefined>(() =>
  resultKind.value === "menu_item" || resultKind.value === "product"
    ? resultKind.value
    : undefined,
);
const canSearch = computed(
  () =>
    props.marketId.length > 0 ||
    query.value.trim().length > 0 ||
    selectedCategory.value.length > 0,
);
const activeFilterLabels = computed(() => {
  const labels: string[] = [];
  const trimmed = query.value.trim();

  if (resultKind.value !== "all") {
    labels.push(
      tWithParams("markets.search.filterKind", {
        value: resultKindLabel(resultKind.value),
      }),
    );
  }
  if (trimmed.length > 0) {
    labels.push(
      tWithParams("markets.search.filterKeyword", { value: trimmed }),
    );
  }
  if (selectedCategory.value.length > 0) {
    labels.push(
      tWithParams("markets.search.filterCategory", {
        value: selectedCategory.value,
      }),
    );
  }
  const serviceType = selectedServiceType.value;
  if (serviceType !== "") {
    labels.push(
      tWithParams("markets.search.filterService", {
        value: serviceTypeLabel(serviceType),
      }),
    );
  }
  if (takeawayOnly.value) labels.push(t("markets.search.takeawayOnly"));
  if (deliveryOnly.value) labels.push(t("markets.search.deliveryOnly"));
  if (resultKind.value !== "vendor" && sortBy.value !== "relevance") {
    labels.push(
      tWithParams("markets.search.filterSort", {
        value: sortLabel(sortBy.value),
      }),
    );
  }

  return labels;
});
const hasActiveFilters = computed(() => activeFilterLabels.value.length > 0);
const hasSyncedMarketCatalog = computed(
  () => marketSearchScope.value?.hasSearchableCatalog === true,
);
const emptyStateTitle = computed(() => {
  if (hasActiveFilters.value) {
    return t("markets.search.emptyFiltered");
  }
  if (hasSyncedMarketCatalog.value) {
    return t("markets.search.emptySyncing");
  }
  return t("markets.search.emptyNoCatalog");
});
const emptyStateDescription = computed(() => {
  if (hasActiveFilters.value) {
    return t("markets.search.emptyFilteredDesc");
  }
  if (hasSyncedMarketCatalog.value) {
    return t("markets.search.emptySyncingDesc");
  }
  return t("markets.search.emptyNoCatalogDesc");
});

async function submitSearch() {
  if (!canSearch.value) return;

  page.value = 1;
  results.value = [];
  serviceResults.value = [];
  vendorResults.value = [];
  total.value = 0;
  serviceTotal.value = 0;
  vendorTotal.value = 0;
  marketSearchScope.value = null;
  emitSearchState();
  await fetchResults({ append: false });
}

async function loadMore() {
  if (!hasMoreResults.value || loading.value) return;

  page.value += 1;
  await fetchResults({ append: true });
}

async function fetchResults({ append }: { append: boolean }) {
  const trimmed = query.value.trim();
  if (!canSearch.value) return;

  loading.value = true;
  error.value = null;
  hasSearched.value = true;

  try {
    const locationFilters =
      sortBy.value === "distance" && userLocation.value
        ? {
            lat: userLocation.value.lat,
            lng: userLocation.value.lng,
            radiusKm: radiusKm.value,
          }
        : {};
    const [response, serviceResponse, vendorResponse] = await Promise.all([
      shouldSearchCatalog.value
        ? discoveryApi.searchDishes({
            q: trimmed || undefined,
            marketId: props.marketId,
            ...(selectedCatalogType.value
              ? { catalogType: selectedCatalogType.value }
              : {}),
            categoryName: selectedCategory.value || undefined,
            ...(apiSortBy() ? { sortBy: apiSortBy() } : {}),
            ...locationFilters,
            takeaway: takeawayOnly.value ? true : undefined,
            ...(deliveryOnly.value ? { delivery: true } : {}),
            page: page.value,
            limit: pageSize,
          })
        : Promise.resolve({ results: [], total: 0 }),
      shouldSearchServices.value && (trimmed || props.marketId)
        ? discoveryApi.searchServices({
            q: trimmed || undefined,
            marketId: props.marketId,
            serviceType: selectedServiceType.value || undefined,
            ...(apiSortBy() ? { sortBy: apiSortBy() } : {}),
            ...locationFilters,
            ...(takeawayOnly.value ? { takeaway: true } : {}),
            ...(deliveryOnly.value ? { delivery: true } : {}),
            page: page.value,
            limit: pageSize,
          })
        : Promise.resolve({ results: [], total: 0 }),
      shouldSearchVendors.value && (trimmed || props.marketId)
        ? discoveryApi.browseRestaurants({
            q: trimmed || undefined,
            marketId: props.marketId,
            sortBy: sortBy.value === "distance" ? "distance" : "popular",
            ...locationFilters,
            ...(takeawayOnly.value ? { takeaway: true } : {}),
            ...(deliveryOnly.value ? { delivery: true } : {}),
            page: page.value,
            limit: pageSize,
          })
        : Promise.resolve({ results: [], total: 0 }),
    ]);
    results.value = append
      ? [...results.value, ...response.results]
      : response.results;
    serviceResults.value = append
      ? [...serviceResults.value, ...serviceResponse.results]
      : serviceResponse.results;
    vendorResults.value = append
      ? [...vendorResults.value, ...vendorResponse.results]
      : vendorResponse.results;
    total.value = response.total;
    serviceTotal.value = serviceResponse.total;
    vendorTotal.value = vendorResponse.total;
    const responseMarketScope =
      "scope" in response ? response.scope?.market : null;
    const serviceMarketScope =
      "scope" in serviceResponse ? serviceResponse.scope?.market : null;
    marketSearchScope.value = responseMarketScope ?? serviceMarketScope ?? null;
  } catch (searchError) {
    // The server detail no longer reaches the page, so keep it in the console.
    console.error("Market product search failed:", searchError);
    error.value = t("markets.search.searchFailed");
    if (append) {
      page.value -= 1;
    } else {
      results.value = [];
      serviceResults.value = [];
      vendorResults.value = [];
      total.value = 0;
      serviceTotal.value = 0;
      vendorTotal.value = 0;
      marketSearchScope.value = null;
    }
  } finally {
    loading.value = false;
  }
}

function searchIfReady() {
  if (hasSearched.value && canSearch.value) {
    submitSearch();
  }
}

function onFulfillmentFilterChange() {
  loadCategories();
  loadServiceTypes();
  searchIfReady();
}

function onServiceTypeChange() {
  if (selectedServiceType.value) {
    resultKind.value = "service";
    selectedCategory.value = "";
  }
  searchIfReady();
}

function selectResultKind(nextKind: ResultKind) {
  resultKind.value = nextKind;
  if (nextKind === "service" || nextKind === "vendor") {
    selectedCategory.value = "";
  }
  if (
    nextKind === "menu_item" ||
    nextKind === "product" ||
    nextKind === "vendor"
  ) {
    selectedServiceType.value = "";
  }
  if (nextKind === "vendor") {
    sortBy.value = "relevance";
  }
  loadCategories();
  loadServiceTypes();
  searchIfReady();
}

function clearFilters() {
  query.value = "";
  takeawayOnly.value = false;
  deliveryOnly.value = false;
  selectedCategory.value = "";
  selectedServiceType.value = "";
  resultKind.value = "all";
  sortBy.value = "relevance";
  loadCategories();
  loadServiceTypes();
  submitSearch();
}

function browseFallback(kind: "service" | "vendor") {
  query.value = "";
  takeawayOnly.value = false;
  deliveryOnly.value = false;
  selectedCategory.value = "";
  selectedServiceType.value = "";
  resultKind.value = kind;
  sortBy.value = "relevance";
  loadCategories();
  loadServiceTypes();
  submitSearch();
}

function useCurrentLocation() {
  if (!navigator.geolocation || locating.value) return;

  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      locating.value = false;
      userLocation.value = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      radiusKm.value = 2;
      sortBy.value = "distance";
      submitSearch();
    },
    () => {
      locating.value = false;
      if (sortBy.value === "distance") {
        sortBy.value = "relevance";
      }
    },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
  );
}

function emitSearchState() {
  emit("searchStateChange", {
    q: query.value.trim(),
    categoryName: selectedCategory.value,
    serviceType: selectedServiceType.value,
    resultKind: resultKind.value,
    takeaway: takeawayOnly.value,
    delivery: deliveryOnly.value,
    sortBy: sortBy.value,
    ...(sortBy.value === "distance" && userLocation.value
      ? {
          lat: userLocation.value.lat,
          lng: userLocation.value.lng,
          radiusKm: radiusKm.value,
        }
      : {}),
  });
}

async function loadCategories() {
  if (props.categories.length > 0) return;

  try {
    const response = await discoveryApi.listCategories({
      marketId: props.marketId,
      takeaway: takeawayOnly.value ? true : undefined,
      delivery: deliveryOnly.value ? true : undefined,
      ...(selectedCatalogType.value
        ? { catalogType: selectedCatalogType.value }
        : {}),
    });
    loadedCategories.value = response.categories;
  } catch (categoryError) {
    console.error("Failed to load market product categories:", categoryError);
  }
}

async function loadServiceTypes() {
  try {
    const response = await discoveryApi.listServiceTypes({
      marketId: props.marketId,
      takeaway: takeawayOnly.value ? true : undefined,
      delivery: deliveryOnly.value ? true : undefined,
    });
    loadedServiceTypes.value = response.serviceTypes;
  } catch (serviceTypeError) {
    console.error("Failed to load market service types:", serviceTypeError);
    loadedServiceTypes.value = [];
  }
}

function servicePriceLabel(service: ServiceSearchResult) {
  if (service.priceLabel) return service.priceLabel;
  if (typeof service.priceCents === "number") {
    // A market's vendors are separate restaurants: price each in its own.
    return formatPriceIn(service.priceCents / 100, service.currency);
  }
  return "";
}

function openServiceBooking(service: ServiceSearchResult) {
  router.push({
    name: "ServiceBooking",
    params: {
      restaurantId: service.restaurantId,
      serviceItemId: String(service.serviceItemId),
    },
  });
}

function distanceLabel(result: { distanceKm?: number }) {
  if (typeof result.distanceKm !== "number") return "";
  return `${result.distanceKm.toFixed(1)} km`;
}

function apiSortBy() {
  return sortBy.value === "relevance" ? undefined : sortBy.value;
}

onMounted(loadCategories);
onMounted(loadServiceTypes);
onMounted(() => {
  if (props.autoLoad) {
    submitSearch();
  }
});

watch(
  () => props.marketId,
  () => {
    selectedCategory.value = "";
    selectedServiceType.value = "";
    resultKind.value = "all";
    loadedCategories.value = [];
    loadedServiceTypes.value = [];
    marketSearchScope.value = null;
    loadCategories();
    loadServiceTypes();
    if (props.autoLoad) {
      submitSearch();
    }
  },
);
</script>
