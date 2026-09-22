<template>
  <div class="min-h-screen bg-ios-bg">
    <nav class="bg-white shadow-sm border-b border-gray-100 sticky top-0 z-10">
      <div class="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
        <button
          class="text-gray-500 hover:text-gray-700"
          @click="$router.back()"
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <h1 class="text-lg font-semibold text-gray-900">
          {{ t("discovery.title") }}
        </h1>
      </div>
    </nav>

    <main class="max-w-md mx-auto px-4 py-4 space-y-4">
      <SearchBar
        v-model="store.searchQuery"
        :keywords="store.popularKeywords"
        @search="searchAndSync($event)"
        @clear="clearSearchAndSync"
      />

      <section v-if="marketOptions.length > 0" class="space-y-2">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-medium text-gray-700">選擇夜市或商圈</h2>
          <router-link
            to="/markets"
            data-testid="discovery-market-directory-link"
            class="shrink-0 text-xs font-medium text-ios-blue"
          >
            查看全部夜市與商圈
          </router-link>
        </div>
        <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <button
            v-for="market in marketOptions"
            :key="market.id"
            type="button"
            data-testid="discovery-market-chip"
            class="h-9 shrink-0 rounded-full border px-3 text-sm font-medium"
            :class="
              isSelectedMarket(market)
                ? 'border-ios-blue bg-ios-blue text-white'
                : 'border-gray-300 bg-white text-gray-700'
            "
            :aria-pressed="isSelectedMarket(market)"
            @click="toggleMarketFilter(market)"
          >
            {{ market.name }}
          </button>
        </div>
      </section>

      <FilterPanel
        :filters="store.filters"
        :cities="cities"
        :districts="districts"
        :categories="categoryOptions"
        :service-types="serviceTypeOptions"
        @update:filters="updateFiltersAndSync($event)"
      />

      <div v-if="store.loading" class="flex justify-center py-12">
        <div
          class="animate-spin rounded-full h-8 w-8 border-b-2 border-ios-blue"
        ></div>
      </div>

      <div v-else-if="store.error" class="text-center py-8">
        <p class="text-red-500 text-sm">{{ t(store.error) }}</p>
      </div>

      <template v-else>
        <!-- Search results (dishes) -->
        <div
          v-if="
            store.isSearchMode &&
            (store.dishResults.length > 0 || store.serviceResults.length > 0)
          "
          class="space-y-3"
        >
          <p class="text-sm text-gray-500">
            {{ tWithParams("discovery.resultsCount", { count: store.total }) }}
          </p>
          <DishResultCard
            v-for="dish in store.dishResults"
            :key="dish.menuItemId"
            :dish="dish"
            @select="onDishSelect"
            @takeaway="onDishTakeaway"
          />
          <article
            v-for="service in store.serviceResults"
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
                    服務
                  </span>
                </div>
                <p class="mt-1 truncate text-sm text-gray-500">
                  {{ service.restaurantName }}
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
            <RouterLink
              v-if="serviceMarketContextUrl(service)"
              :to="serviceMarketContextUrl(service)"
              data-testid="service-market-link"
              class="mt-3 inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md bg-ios-bg px-2.5 py-1.5 text-xs font-medium text-ios-blue"
            >
              <span>在 {{ service.marketVendor?.marketName }}</span>
              <span
                v-if="service.marketVendor?.stallNumber"
                class="text-ios-secondary"
              >
                · 攤位 {{ service.marketVendor.stallNumber }}
              </span>
              <span
                v-if="service.marketVendor?.locationLabel"
                class="text-ios-secondary"
              >
                · {{ service.marketVendor.locationLabel }}
              </span>
            </RouterLink>
            <div
              v-else-if="
                service.marketVendor?.stallNumber ||
                service.marketVendor?.locationLabel
              "
              class="mt-3 inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md bg-ios-bg px-2.5 py-1.5 text-xs font-medium text-ios-secondary"
            >
              <span v-if="service.marketVendor?.stallNumber">
                攤位 {{ service.marketVendor.stallNumber }}
              </span>
              <span v-if="service.marketVendor?.locationLabel">
                {{ service.marketVendor.locationLabel }}
              </span>
            </div>
            <div
              v-if="service.tags.length > 0"
              class="mt-2 flex flex-wrap gap-1"
            >
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
                {{ serviceOpeningHoursLabel(service) }}
              </p>
              <div class="flex flex-wrap justify-end gap-2">
                <button
                  v-if="service.requiresBooking"
                  type="button"
                  data-testid="discovery-service-booking"
                  class="h-9 rounded-lg border border-emerald-500 px-3 text-sm font-medium text-emerald-700"
                  @click="onServiceBooking(service)"
                >
                  直接預約
                </button>
                <a
                  v-else-if="safeExternalHref(service.bookingUrl)"
                  :href="safeExternalHref(service.bookingUrl)!"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="discovery-service-booking-url"
                  class="inline-flex h-9 items-center rounded-lg border border-emerald-500 px-3 text-sm font-medium text-emerald-700"
                >
                  開啟預約
                </a>
                <button
                  type="button"
                  data-testid="select-service"
                  class="h-9 rounded-lg border border-ios-blue px-3 text-sm font-medium text-ios-blue"
                  @click="onServiceSelect(service)"
                >
                  查看服務
                </button>
              </div>
            </div>
          </article>
        </div>

        <!-- Browse mode (restaurants) -->
        <div v-else-if="!store.isSearchMode" class="space-y-3">
          <!-- Popular dishes section -->
          <div v-if="store.popularDishes.length > 0 && !store.hasResults">
            <h3 class="text-sm font-medium text-gray-700 mb-2">
              {{ t("discovery.popularDishes") }}
            </h3>
            <div class="space-y-2">
              <DishResultCard
                v-for="dish in store.popularDishes.slice(0, 5)"
                :key="dish.menuItemId"
                :dish="dish"
                @select="onDishSelect"
                @takeaway="onDishTakeaway"
              />
            </div>
          </div>

          <!-- Restaurant list -->
          <div v-if="store.restaurantResults.length > 0">
            <h3 class="text-sm font-medium text-gray-700 mb-2">
              {{ t("discovery.restaurants") }}
            </h3>
            <div class="space-y-2">
              <RestaurantCard
                v-for="r in store.restaurantResults"
                :key="r.restaurantId"
                :restaurant="r"
                @select="onRestaurantSelect"
                @takeaway="onRestaurantTakeaway"
                @reserve="onRestaurantReservation"
              />
            </div>
          </div>

          <!-- Popular restaurants fallback -->
          <div
            v-else-if="store.popularRestaurants.length > 0 && !store.hasResults"
          >
            <h3 class="text-sm font-medium text-gray-700 mb-2">
              {{ t("discovery.popularRestaurants") }}
            </h3>
            <div class="space-y-2">
              <RestaurantCard
                v-for="r in store.popularRestaurants"
                :key="r.restaurantId"
                :restaurant="r"
                @select="onRestaurantSelect"
                @takeaway="onRestaurantTakeaway"
                @reserve="onRestaurantReservation"
              />
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-if="
            store.isSearchMode &&
            store.dishResults.length === 0 &&
            store.serviceResults.length === 0 &&
            store.searchQuery
          "
          class="text-center py-12"
        >
          <p class="text-gray-500">{{ t("discovery.noResults") }}</p>
        </div>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "@/composables/useI18n";
import { useDiscoveryStore } from "@/stores/discovery";
import SearchBar from "@/components/discovery/SearchBar.vue";
import FilterPanel from "@/components/discovery/FilterPanel.vue";
import DishResultCard from "@/components/discovery/DishResultCard.vue";
import RestaurantCard from "@/components/discovery/RestaurantCard.vue";
import type {
  DishSearchResult,
  RestaurantListItem,
  SearchFilters,
  ServiceSearchResult,
  ServiceTypeFacet,
} from "@/services/discoveryApi";
import { discoveryApi } from "@/services/discoveryApi";
import { marketsApi, type MarketListItem } from "@/services/marketsApi";
import {
  shopMenuItemQuery,
  shopMenuReturnQuery,
  shopMenuServiceQuery,
} from "@/utils/shopMenuDeepLink";
import { useCurrency } from "@/composables/useCurrency";
import { safeExternalHref } from "@/utils/safeExternalHref";

const { t, tWithParams } = useI18n();
const router = useRouter();
const route = useRoute();
const store = useDiscoveryStore();
const { formatPriceIn } = useCurrency();
const marketOptions = ref<MarketListItem[]>([]);
const marketAreas = ref<{ city: string; districts: string[] }[]>([]);
const categoryOptions = ref<string[]>([]);
const serviceTypeOptions = ref<ServiceTypeFacet[]>([]);

const selectedMarket = computed(() => {
  const { marketId, marketSlug } = store.filters;
  return marketOptions.value.find(
    (market) =>
      (marketSlug && market.slug === marketSlug) ||
      (marketId && market.id === marketId),
  );
});
const selectedMarketName = computed(() => {
  return selectedMarket.value?.name ?? "";
});
const selectedCity = computed(() => store.filters.city);
const cities = computed(() => marketAreas.value.map((area) => area.city));
const districts = computed(() => {
  const areas = selectedCity.value
    ? marketAreas.value.filter((area) => area.city === selectedCity.value)
    : marketAreas.value;

  return Array.from(new Set(areas.flatMap((area) => area.districts))).sort(
    (left, right) => left.localeCompare(right, "zh-Hant"),
  );
});

function onDishSelect(dish: DishSearchResult) {
  router.push({
    name: "ShopMenu",
    params: { restaurantId: dish.restaurantId },
    query: {
      ...shopMenuItemQuery(dish),
      ...shopMenuReturnQuery({
        path: route.fullPath,
        label: discoveryReturnLabel.value,
      }),
    },
  });
}

function onRestaurantSelect(restaurant: RestaurantListItem) {
  router.push({
    name: "ShopMenu",
    params: { restaurantId: restaurant.restaurantId },
    query: shopMenuReturnQuery({
      path: route.fullPath,
      label: discoveryReturnLabel.value,
    }),
  });
}

function onRestaurantReservation(restaurant: RestaurantListItem) {
  router.push({
    name: "Reservation",
    params: { restaurantId: restaurant.restaurantId },
  });
}

function onServiceSelect(service: ServiceSearchResult) {
  router.push({
    name: "ShopMenu",
    params: { restaurantId: service.restaurantId },
    query: {
      ...shopMenuServiceQuery(service),
      ...shopMenuReturnQuery({
        path: route.fullPath,
        label: discoveryReturnLabel.value,
      }),
    },
  });
}

function onServiceBooking(service: ServiceSearchResult) {
  router.push({
    name: "ServiceBooking",
    params: {
      restaurantId: service.restaurantId,
      serviceItemId: String(service.serviceItemId),
    },
  });
}

const discoveryReturnLabel = computed(
  () => selectedMarketName.value || "搜尋結果",
);

function servicePriceLabel(service: ServiceSearchResult) {
  if (service.priceLabel) return service.priceLabel;
  if (typeof service.priceCents === "number") {
    // Service results span restaurants: price each in its own currency.
    return formatPriceIn(service.priceCents / 100, service.currency);
  }
  return "";
}

function serviceOpeningHoursLabel(service: ServiceSearchResult) {
  if (service.openingHoursStatus === "unavailable") {
    return t("discovery.hoursUnavailable");
  }
  return service.isOpen ? t("discovery.open") : t("discovery.closed");
}

function serviceMarketContextUrl(service: ServiceSearchResult) {
  const marketVendor = service.marketVendor;
  if (!marketVendor?.marketName) return "";
  return (
    marketVendor.marketUrl ||
    (marketVendor.marketSlug ? `/markets/${marketVendor.marketSlug}` : "")
  );
}

function firstQueryString(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string") ?? "";
  }
  return typeof value === "string" ? value : "";
}

function queryBoolean(value: unknown) {
  const rawValue = firstQueryString(value);
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  return undefined;
}

function isServiceType(
  value: string,
): value is NonNullable<SearchFilters["serviceType"]> {
  return [
    "general",
    "booking",
    "pickup",
    "delivery",
    "consultation",
    "rental",
    "activity",
  ].includes(value);
}

function filtersFromRouteQuery() {
  const serviceType = firstQueryString(route.query.serviceType);
  const marketSlug = firstQueryString(route.query.marketSlug) || undefined;
  return {
    city: firstQueryString(route.query.city) || undefined,
    district: firstQueryString(route.query.district) || undefined,
    marketId: marketSlug
      ? undefined
      : firstQueryString(route.query.marketId) || undefined,
    marketSlug,
    categoryName: firstQueryString(route.query.categoryName) || undefined,
    serviceType: isServiceType(serviceType) ? serviceType : undefined,
    takeaway: queryBoolean(route.query.takeaway),
    delivery: queryBoolean(route.query.delivery),
  };
}

function queryFromFilters(filters = store.filters, query = store.searchQuery) {
  return {
    ...(filters.city ? { city: filters.city } : {}),
    ...(filters.district ? { district: filters.district } : {}),
    ...(filters.marketSlug
      ? { marketSlug: filters.marketSlug }
      : filters.marketId
        ? { marketId: filters.marketId }
        : {}),
    ...(filters.categoryName ? { categoryName: filters.categoryName } : {}),
    ...(filters.serviceType ? { serviceType: filters.serviceType } : {}),
    ...(filters.takeaway ? { takeaway: "true" } : {}),
    ...(filters.delivery ? { delivery: "true" } : {}),
    ...(query.trim() ? { q: query.trim() } : {}),
  };
}

function syncUrl(filters = store.filters, query = store.searchQuery) {
  router.replace({ query: queryFromFilters(filters, query) });
}

function hasDiscoverySearchScope(filters: SearchFilters, query: string) {
  return Boolean(
    query.trim() ||
    filters.marketId ||
    filters.marketSlug ||
    filters.categoryName ||
    filters.city ||
    filters.district ||
    filters.serviceType,
  );
}

function searchAndSync(query: string) {
  store.searchDishes(query);
  syncUrl(store.filters, query);
}

function clearSearchAndSync() {
  store.clearSearch();
  syncUrl(store.filters, "");
}

function updateFiltersAndSync(filters: SearchFilters) {
  const nextFilters = { ...store.filters, ...filters };
  store.updateFilters(filters);
  syncUrl(nextFilters, store.searchQuery);
}

async function startTakeaway(
  restaurantId: string,
  query: Record<string, string> = {},
) {
  const result = await discoveryApi.getTakeawayEligibility(restaurantId);
  if (!result.eligible) {
    store.error = "discovery.takeawayUnavailable";
    return;
  }
  router.push({
    name: "OrderTypeLanding",
    params: { restaurantId },
    query: { qr: result.shopQrCode, ...query },
  });
}

function onDishTakeaway(dish: DishSearchResult) {
  startTakeaway(dish.restaurantId, shopMenuItemQuery(dish));
}

function onRestaurantTakeaway(restaurant: RestaurantListItem) {
  startTakeaway(restaurant.restaurantId);
}

function isSelectedMarket(market: MarketListItem) {
  return store.filters.marketSlug
    ? store.filters.marketSlug === market.slug
    : store.filters.marketId === market.id;
}

function toggleMarketFilter(market: MarketListItem) {
  const isSelected = isSelectedMarket(market);
  updateFiltersAndSync({
    marketId: undefined,
    marketSlug: isSelected ? undefined : market.slug,
  });
}

async function loadMarketOptions() {
  try {
    const response = await marketsApi.listMarkets({ limit: 20 });
    marketOptions.value = response.markets;
  } catch (error) {
    console.error("Failed to load discovery markets:", error);
  }
  await loadSelectedMarketOption();

  try {
    const response = await marketsApi.listAreas();
    marketAreas.value = response.areas;
  } catch (error) {
    console.error("Failed to load discovery market areas:", error);
  }
}

async function loadSelectedMarketOption() {
  const marketSlug = store.filters.marketSlug;
  if (
    !marketSlug ||
    marketOptions.value.some((market) => market.slug === marketSlug)
  ) {
    return;
  }

  try {
    const response = await marketsApi.getMarket(marketSlug);
    marketOptions.value = [response.market, ...marketOptions.value];
  } catch (error) {
    console.error("Failed to load selected discovery market:", error);
  }
}

async function loadCategoryOptions() {
  try {
    const response = await discoveryApi.listCategories({
      city: store.filters.city,
      district: store.filters.district,
      marketId: store.filters.marketSlug ? undefined : store.filters.marketId,
      marketSlug: store.filters.marketSlug,
      takeaway: store.filters.takeaway,
      delivery: store.filters.delivery,
    });
    categoryOptions.value = response.categories;
  } catch (error) {
    console.error("Failed to load discovery categories:", error);
  }
}

async function loadServiceTypeOptions() {
  try {
    const response = await discoveryApi.listServiceTypes({
      city: store.filters.city,
      district: store.filters.district,
      marketId: store.filters.marketSlug ? undefined : store.filters.marketId,
      marketSlug: store.filters.marketSlug,
      takeaway: store.filters.takeaway,
      delivery: store.filters.delivery,
    });
    serviceTypeOptions.value = response.serviceTypes;
  } catch (error) {
    console.error("Failed to load discovery service types:", error);
    serviceTypeOptions.value = [];
  }
}

onMounted(() => {
  store.loadPopular();
  const initialFilters = filtersFromRouteQuery();
  const initialQuery = firstQueryString(route.query.q);
  const hasInitialFilters = Object.values(initialFilters).some(
    (value) => value !== undefined,
  );

  if (hasInitialFilters) {
    store.filters = initialFilters;
  }
  if (initialQuery) {
    store.searchQuery = initialQuery;
  }

  if (hasDiscoverySearchScope(initialFilters, initialQuery)) {
    store.searchDishes(initialQuery);
  } else {
    store.browseRestaurants();
  }
  loadMarketOptions();
  loadCategoryOptions();
  loadServiceTypeOptions();
});

watch(
  () => [
    store.filters.city,
    store.filters.district,
    store.filters.marketId,
    store.filters.marketSlug,
    store.filters.takeaway,
    store.filters.delivery,
  ],
  () => {
    loadCategoryOptions();
    loadServiceTypeOptions();
  },
);
</script>
