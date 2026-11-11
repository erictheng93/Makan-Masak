import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  discoveryApi,
  type DishSearchResult,
  type RestaurantListItem,
  type SearchFilters,
  type ServiceSearchResult,
} from "@/services/discoveryApi";

export const useDiscoveryStore = defineStore("discovery", () => {
  // State
  const searchQuery = ref("");
  const filters = ref<SearchFilters>({});
  const dishResults = ref<DishSearchResult[]>([]);
  const serviceResults = ref<ServiceSearchResult[]>([]);
  const restaurantResults = ref<RestaurantListItem[]>([]);
  const popularKeywords = ref<string[]>([]);
  const popularDishes = ref<DishSearchResult[]>([]);
  const popularRestaurants = ref<RestaurantListItem[]>([]);
  const loading = ref(false);
  /**
   * An i18n key, never prose — the views render it through `t()`. A server
   * message baked in here can only ever be in one language.
   */
  const error = ref<string | null>(null);
  // Popular content and result requests run independently on entry.
  const popularLoadFailed = ref(false);
  const resultsLoadFailed = ref(false);
  const total = ref(0);
  const page = ref(1);
  const mode = ref<"search" | "browse">("browse");

  // Computed
  const hasResults = computed(
    () =>
      dishResults.value.length > 0 ||
      serviceResults.value.length > 0 ||
      restaurantResults.value.length > 0,
  );
  const isSearchMode = computed(() => mode.value === "search");

  function hasDiscoverySearchScope(searchFilters: SearchFilters) {
    return Boolean(
      searchFilters.marketId ||
      searchFilters.marketSlug ||
      searchFilters.categoryName ||
      searchFilters.city ||
      searchFilters.district ||
      searchFilters.serviceType,
    );
  }

  // Actions
  async function searchDishes(query: string) {
    searchQuery.value = query;
    mode.value = "search";
    resultsLoadFailed.value = false;
    loading.value = true;
    error.value = null;

    try {
      const trimmedQuery = query.trim();
      const { serviceType, ...dishFilters } = filters.value;
      const dishSearchFilters = {
        ...(trimmedQuery ? { q: trimmedQuery } : {}),
        ...dishFilters,
        page: page.value,
      };
      const canSearchDishes = Boolean(
        trimmedQuery ||
        filters.value.marketId ||
        filters.value.marketSlug ||
        filters.value.categoryName ||
        filters.value.city ||
        filters.value.district,
      );
      const canSearchServices = Boolean(
        trimmedQuery ||
        filters.value.marketId ||
        filters.value.marketSlug ||
        filters.value.city ||
        filters.value.district ||
        serviceType,
      );
      const [dishResult, serviceResult] = await Promise.all([
        canSearchDishes
          ? discoveryApi.searchDishes(dishSearchFilters)
          : Promise.resolve({ results: [], total: 0 }),
        canSearchServices
          ? discoveryApi.searchServices({
              q: trimmedQuery || undefined,
              city: filters.value.city,
              district: filters.value.district,
              marketId: filters.value.marketId,
              marketSlug: filters.value.marketSlug,
              serviceType,
              takeaway: filters.value.takeaway,
              delivery: filters.value.delivery,
              page: page.value,
            })
          : Promise.resolve({ results: [], total: 0 }),
      ]);
      dishResults.value = dishResult.results;
      serviceResults.value = serviceResult.results;
      total.value = dishResult.total + serviceResult.total;
    } catch (e) {
      console.error("Discovery search failed:", e);
      resultsLoadFailed.value = true;
      error.value = "discovery.searchFailed";
    } finally {
      loading.value = false;
    }
  }

  async function browseRestaurants() {
    mode.value = "browse";
    resultsLoadFailed.value = false;
    loading.value = true;
    error.value = null;

    try {
      const result = await discoveryApi.browseRestaurants({
        ...filters.value,
        page: page.value,
      });
      serviceResults.value = [];
      restaurantResults.value = result.results;
      total.value = result.total;
    } catch (e) {
      console.error("Discovery browse failed:", e);
      resultsLoadFailed.value = true;
      error.value = "discovery.browseFailed";
    } finally {
      loading.value = false;
    }
  }

  async function loadPopular() {
    popularLoadFailed.value = false;
    loading.value = true;
    error.value = null;

    try {
      const result = await discoveryApi.getPopular();
      popularKeywords.value = result.keywords;
      popularDishes.value = result.dishes;
      popularRestaurants.value = result.restaurants;
    } catch (e) {
      console.error("Discovery popular load failed:", e);
      popularLoadFailed.value = true;
      error.value = "discovery.popularFailed";
    } finally {
      loading.value = false;
    }
  }

  function updateFilters(newFilters: Partial<SearchFilters>) {
    filters.value = { ...filters.value, ...newFilters };
    page.value = 1;
    if (
      (mode.value === "search" && searchQuery.value) ||
      hasDiscoverySearchScope(filters.value)
    ) {
      searchDishes(searchQuery.value);
    } else {
      browseRestaurants();
    }
  }

  function clearSearch() {
    searchQuery.value = "";
    dishResults.value = [];
    serviceResults.value = [];
    mode.value = "browse";
    page.value = 1;
  }

  function resetAll() {
    searchQuery.value = "";
    filters.value = {};
    dishResults.value = [];
    serviceResults.value = [];
    restaurantResults.value = [];
    error.value = null;
    popularLoadFailed.value = false;
    resultsLoadFailed.value = false;
    total.value = 0;
    page.value = 1;
    mode.value = "browse";
  }

  return {
    searchQuery,
    filters,
    dishResults,
    serviceResults,
    restaurantResults,
    popularKeywords,
    popularDishes,
    popularRestaurants,
    loading,
    error,
    popularLoadFailed,
    resultsLoadFailed,
    total,
    page,
    mode,
    hasResults,
    isSearchMode,
    searchDishes,
    browseRestaurants,
    loadPopular,
    updateFilters,
    clearSearch,
    resetAll,
  };
});
