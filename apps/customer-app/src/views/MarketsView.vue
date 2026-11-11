<template>
  <div class="customer-shell min-h-screen bg-ios-bg">
    <nav class="sticky top-0 z-10 border-b border-gray-100 bg-white shadow-sm">
      <div class="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
        <button
          type="button"
          class="text-gray-500 hover:text-gray-700"
          :aria-label="t('markets.common.back')"
          @click="$router.back()"
        >
          <svg
            class="h-6 w-6"
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
          {{ t("markets.directory.title") }}
        </h1>
      </div>
    </nav>

    <main class="mx-auto max-w-md space-y-4 px-4 py-4">
      <section class="space-y-3">
        <form
          data-testid="markets-search-form"
          class="flex gap-2"
          @submit.prevent="reloadList"
        >
          <input
            v-model="query"
            :aria-label="t('markets.common.search')"
            data-testid="markets-search-input"
            type="search"
            class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
            :placeholder="t('markets.directory.searchPlaceholder')"
          />
          <button
            type="submit"
            class="h-10 shrink-0 rounded-lg bg-ios-blue px-4 text-sm font-medium text-white"
          >
            {{ t("markets.common.search") }}
          </button>
        </form>
        <div class="flex gap-2">
          <select
            v-model="city"
            :aria-label="t('markets.directory.allCities')"
            data-testid="markets-city-select"
            class="h-10 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
            @change="onCityChange"
          >
            <option value="">{{ t("markets.directory.allCities") }}</option>
            <option
              v-for="area in marketAreas"
              :key="area.city"
              :value="area.city"
            >
              {{ area.city }}
            </option>
          </select>
          <select
            v-model="district"
            :aria-label="t('markets.directory.allDistricts')"
            data-testid="markets-district-select"
            class="h-10 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
            @change="reloadList"
          >
            <option value="">{{ t("markets.directory.allDistricts") }}</option>
            <option v-for="item in districts" :key="item" :value="item">
              {{ item }}
            </option>
          </select>
        </div>
        <select
          v-model="marketType"
          :aria-label="t('markets.directory.allTypes')"
          data-testid="markets-type-select"
          class="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
          @change="reloadList"
        >
          <option value="">{{ t("markets.directory.allTypes") }}</option>
          <option
            v-for="option in MARKET_TYPE_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ t(option.labelKey) }}
          </option>
        </select>
        <button
          type="button"
          class="w-full rounded-lg border border-ios-blue px-3 py-2 text-sm font-medium text-ios-blue disabled:border-gray-300 disabled:text-gray-400"
          :disabled="locating"
          @click="loadNearby"
        >
          {{
            locating
              ? t("markets.common.locating")
              : t("markets.directory.findNearby")
          }}
        </button>
      </section>

      <div v-if="store.loading" class="py-12 text-center text-sm text-gray-500">
        {{ t("markets.common.loading") }}
      </div>
      <div
        v-else-if="store.error"
        class="py-8 text-center text-sm text-red-500"
      >
        {{ t(store.error) }}
      </div>
      <template v-else>
        <details v-if="favoriteMarkets.length > 0" class="space-y-3">
          <summary class="text-sm font-medium text-gray-700">
            {{ t("markets.directory.favorites") }}
          </summary>
          <MarketCard
            v-for="market in favoriteMarkets"
            :key="`favorite-${market.id}`"
            :market="market"
            @select="openMarket"
          />
        </details>

        <details v-if="recentMarkets.length > 0" class="space-y-3">
          <summary class="text-sm font-medium text-gray-700">
            {{ t("markets.directory.recentVisits") }}
          </summary>
          <MarketCard
            v-for="market in recentMarkets"
            :key="`recent-${market.id}`"
            :market="market"
            @select="openMarket"
          />
        </details>

        <details v-if="recentCheckouts.length > 0" class="space-y-3">
          <summary class="text-sm font-medium text-gray-700">
            {{ t("markets.directory.recentOrders") }}
          </summary>
          <!-- Kept visible but inert while the API has market checkouts
               switched off. The tracking screen this opens does nothing but
               read /market-checkouts, so following the link would land the
               user on a refusal; dropping the list instead would silently
               lose orders they already placed. -->
          <button
            v-for="checkout in recentCheckouts"
            :key="checkout.id"
            type="button"
            data-testid="recent-market-checkout"
            :data-disabled="marketCheckoutsDisabled ? 'true' : undefined"
            :aria-disabled="marketCheckoutsDisabled ? 'true' : undefined"
            :title="
              marketCheckoutsDisabled
                ? t('markets.common.checkoutUnavailable')
                : undefined
            "
            :disabled="marketCheckoutsDisabled"
            class="w-full rounded-xl border border-gray-200 px-4 py-3 text-left disabled:cursor-not-allowed"
            :class="marketCheckoutsDisabled ? 'bg-gray-50' : 'bg-white'"
            @click="openCheckout(checkout)"
          >
            <span
              class="block text-sm font-semibold"
              :class="
                marketCheckoutsDisabled ? 'text-gray-400' : 'text-gray-900'
              "
            >
              {{ checkout.marketName }}
            </span>
            <span
              class="mt-1 block text-xs"
              :class="
                marketCheckoutsDisabled ? 'text-gray-400' : 'text-gray-500'
              "
            >
              <template v-if="marketCheckoutsDisabled">
                {{ t("markets.common.checkoutUnavailable") }}
              </template>
              <template v-else>
                {{
                  tWithParams("markets.directory.checkoutStallCount", {
                    count: checkout.childOrderCount,
                  })
                }}
                {{ marketCheckoutPaymentLabel(checkout.paymentStatus) }}
              </template>
            </span>
          </button>
        </details>

        <section v-if="store.nearbyMarkets.length > 0" class="space-y-3">
          <h2 class="text-sm font-medium text-gray-700">
            {{ t("markets.directory.nearby") }}
          </h2>
          <MarketCard
            v-for="market in store.nearbyMarkets"
            :key="`nearby-${market.id}`"
            :market="market"
            @select="openMarket"
          />
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-medium text-gray-700">
            {{ t("markets.directory.allMarkets") }}
            <span class="ml-2 text-ios-text/70"
              >({{ store.markets.length }})</span
            >
          </h2>
          <MarketCard
            v-for="market in store.markets"
            :key="market.id"
            :market="market"
            @select="openMarket"
          />
          <div
            v-if="!store.hasMarkets"
            data-testid="markets-empty-state"
            class="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center"
          >
            <span class="block text-sm font-medium text-gray-700">
              {{
                hasDirectoryFilters
                  ? t("markets.directory.emptyFiltered")
                  : t("markets.directory.emptyNoData")
              }}
            </span>
            <span class="mt-1 block text-sm text-gray-500">
              {{
                hasDirectoryFilters
                  ? t("markets.directory.emptyFilteredDesc")
                  : t("markets.directory.emptyNoDataDesc")
              }}
            </span>
            <button
              v-if="hasDirectoryFilters"
              type="button"
              data-testid="markets-clear-filters"
              class="mt-4 h-9 rounded-lg border border-ios-blue px-3 text-sm font-medium text-ios-blue"
              @click="clearFilters"
            >
              {{ t("markets.common.clearFilters") }}
            </button>
          </div>
          <button
            v-if="store.hasMoreMarkets"
            type="button"
            data-testid="markets-load-more"
            class="h-10 w-full rounded-lg border border-ios-blue px-4 text-sm font-medium text-ios-blue disabled:border-gray-300 disabled:text-gray-400"
            :disabled="store.loading"
            @click="loadMoreMarkets"
          >
            {{
              store.loading
                ? t("markets.common.loading")
                : t("markets.directory.loadMoreMarkets")
            }}
          </button>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import MarketCard from "@/components/markets/MarketCard.vue";
import { useMarketsStore } from "@/stores/markets";
import {
  marketsApi,
  type MarketArea,
  type MarketListItem,
} from "@/services/marketsApi";
import {
  hydrateFavoriteMarketsFromIdentity,
  hydrateRecentMarketsFromIdentity,
  listFavoriteMarkets,
  listRecentMarkets,
} from "@/utils/marketEngagement";
import {
  listRecentMarketCheckouts,
  type StoredMarketCheckout,
} from "@/utils/marketCheckouts";
import { hasCustomerAccessToken } from "@/services/customerAccessToken";
import { orderApi } from "@/services/orderApi";
import { isMarketType, MARKET_TYPE_OPTIONS } from "@/utils/marketTypes";
import { useFeatureAvailability } from "@/composables/useFeatureAvailability";
import { useI18n } from "@/composables/useI18n";

const router = useRouter();
const route = useRoute();
const store = useMarketsStore();
const { t, tWithParams } = useI18n();
const { isDisabled } = useFeatureAvailability();
const marketCheckoutsDisabled = computed(() => isDisabled("marketCheckouts"));
const query = ref(firstQueryString(route.query.q));
const city = ref(firstQueryString(route.query.city));
const district = ref(firstQueryString(route.query.district));
const marketType = ref(marketTypeFromQuery(route.query.type));
const nearbyLocation = ref(nearbyLocationFromQuery());
const locating = ref(false);
const marketAreas = ref<MarketArea[]>([]);
const favoriteMarkets = ref<MarketListItem[]>([]);
const recentMarkets = ref<MarketListItem[]>([]);
const recentCheckouts = ref<StoredMarketCheckout[]>([]);
const hasDirectoryFilters = computed(
  () =>
    query.value.trim().length > 0 ||
    city.value.length > 0 ||
    district.value.length > 0 ||
    marketType.value.length > 0 ||
    nearbyLocation.value != null,
);

const districts = computed(() => {
  const areas =
    city.value === ""
      ? marketAreas.value
      : marketAreas.value.filter((area) => area.city === city.value);

  return Array.from(new Set(areas.flatMap((area) => area.districts))).sort(
    (left, right) => left.localeCompare(right, "zh-Hant"),
  );
});

function reloadList() {
  syncDirectoryQuery();
  Promise.resolve(store.loadMarkets(loadMarketsInput()))
    .then(refreshMarketEngagementFromIdentity)
    .catch((error) => {
      console.error("Failed to load market directory:", error);
    });
}

async function refreshMarketEngagementFromIdentity() {
  try {
    await Promise.all([
      hydrateFavoriteMarketsFromIdentity(store.markets),
      hydrateRecentMarketsFromIdentity(store.markets),
    ]);
    favoriteMarkets.value = listFavoriteMarkets().map(storedMarketToListItem);
    recentMarkets.value = listRecentMarkets().map(storedMarketToListItem);
  } catch (error) {
    console.error("Failed to sync market engagement:", error);
  }
}

function loadMarketsInput() {
  return {
    q: query.value.trim() || undefined,
    city: city.value || undefined,
    district: district.value || undefined,
    type: marketType.value || undefined,
  };
}

function loadMoreMarkets() {
  Promise.resolve(store.loadMoreMarkets(loadMarketsInput())).then(
    refreshMarketEngagementFromIdentity,
  );
}

function onCityChange() {
  district.value = "";
  reloadList();
}

function clearFilters() {
  query.value = "";
  city.value = "";
  district.value = "";
  marketType.value = "";
  nearbyLocation.value = null;
  reloadList();
}

function firstQueryString(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string") ?? "";
  }

  return typeof value === "string" ? value : "";
}

function queryNumber(value: unknown) {
  const rawValue = firstQueryString(value);
  if (!rawValue) return undefined;

  const numberValue = Number(rawValue);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function marketTypeFromQuery(value: unknown) {
  const type = firstQueryString(value);
  return isMarketType(type) ? type : "";
}

function nearbyLocationFromQuery() {
  const lat = queryNumber(route.query.nearbyLat);
  const lng = queryNumber(route.query.nearbyLng);
  if (lat == null || lng == null) return null;

  return {
    lat,
    lng,
    radiusKm: queryNumber(route.query.nearbyRadiusKm) ?? 2,
  };
}

function syncDirectoryQuery() {
  router.replace({
    query: currentDirectoryQuery(),
  });
}

function currentDirectoryQuery() {
  return {
    ...(query.value.trim() ? { q: query.value.trim() } : {}),
    ...(city.value ? { city: city.value } : {}),
    ...(district.value ? { district: district.value } : {}),
    ...(marketType.value ? { type: marketType.value } : {}),
    ...(nearbyLocation.value
      ? {
          nearbyLat: String(nearbyLocation.value.lat),
          nearbyLng: String(nearbyLocation.value.lng),
          nearbyRadiusKm: String(nearbyLocation.value.radiusKm),
        }
      : {}),
  };
}

function currentDirectoryPath() {
  const searchParams = new URLSearchParams();
  Object.entries(currentDirectoryQuery()).forEach(([key, value]) => {
    searchParams.set(key, value);
  });
  const queryString = searchParams.toString();
  return `/markets${queryString ? `?${queryString}` : ""}`;
}

async function loadAreas() {
  try {
    const response = await marketsApi.listAreas();
    marketAreas.value = response.areas;
  } catch (error) {
    console.error("Failed to load market area filters:", error);
  }
}

function loadNearby() {
  if (!navigator.geolocation) return;
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      locating.value = false;
      nearbyLocation.value = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        radiusKm: 2,
      };
      syncDirectoryQuery();
      store.loadNearby(nearbyLocation.value);
    },
    () => {
      locating.value = false;
      reloadList();
    },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
  );
}

function loadNearbyFromQuery() {
  if (!nearbyLocation.value) return;
  store.loadNearby(nearbyLocation.value);
}

function openMarket(market: MarketListItem) {
  router.push({
    name: "MarketDetail",
    params: { slug: market.slug },
    query: {
      returnPath: currentDirectoryPath(),
      returnLabel: t("markets.directory.title"),
    },
  });
}

function openCheckout(checkout: StoredMarketCheckout) {
  if (marketCheckoutsDisabled.value) return;

  router.push({
    name: "MarketCheckoutTracking",
    params: {
      slug: checkout.marketSlug,
      checkoutId: checkout.id,
    },
  });
}

onMounted(() => {
  favoriteMarkets.value = listFavoriteMarkets().map(storedMarketToListItem);
  recentMarkets.value = listRecentMarkets().map(storedMarketToListItem);
  void loadRecentCheckouts();
  loadAreas();
  loadNearbyFromQuery();
  reloadList();
});

async function loadRecentCheckouts() {
  if (!hasCustomerAccessToken()) {
    recentCheckouts.value = listRecentMarketCheckouts();
    return;
  }

  try {
    const checkouts = await orderApi.listMyMarketCheckouts();
    recentCheckouts.value = checkouts.map((checkout) => ({
      id: checkout.id,
      marketSlug: checkout.market.slug,
      marketName: checkout.market.name,
      childOrderCount: checkout.childOrderCount,
      totalAmount: checkout.subtotal,
      paymentStatus: checkout.paymentStatus,
      createdAt: checkout.createdAt,
      updatedAt: Date.parse(checkout.createdAt),
    }));
  } catch (error) {
    // The account list is the authoritative one once signed in; falling back to
    // the device list keeps the page useful when the request fails, but it
    // must stay visible in the console rather than looking like a clean load.
    console.error("Failed to load customer market checkouts:", error);
    recentCheckouts.value = listRecentMarketCheckouts();
  }
}

function marketCheckoutPaymentLabel(
  status: StoredMarketCheckout["paymentStatus"],
) {
  return t(`markets.checkoutStatus.${status}`);
}

function storedMarketToListItem(
  market: ReturnType<typeof listFavoriteMarkets>[number],
) {
  return {
    id: market.id,
    slug: market.slug,
    name: market.name,
    type: market.type ?? "night_market",
    description: null,
    city: market.city ?? "",
    district: market.district ?? "",
    address: market.address ?? "",
    latitude: 0,
    longitude: 0,
    bannerUrl: market.bannerUrl ?? null,
    logoUrl: market.logoUrl ?? null,
    tags: null,
    vendorCount: 0,
  } satisfies MarketListItem;
}
</script>
