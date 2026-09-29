<template>
  <div class="min-h-screen bg-ios-bg">
    <nav class="sticky top-0 z-10 border-b border-gray-100 bg-white shadow-sm">
      <div class="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
        <button
          type="button"
          data-testid="market-detail-back"
          class="text-gray-500 hover:text-gray-700"
          :aria-label="t('markets.common.back')"
          @click="goBack"
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
        <h1 class="truncate text-lg font-semibold text-gray-900">
          {{ store.selectedMarket?.name || t("markets.detail.fallbackTitle") }}
        </h1>
        <button
          v-if="store.selectedMarket"
          type="button"
          data-testid="market-favorite-toggle"
          class="ml-auto rounded-lg border border-ios-blue px-3 py-1.5 text-sm font-medium text-ios-blue"
          @click="toggleFavorite"
        >
          {{
            isFavorite
              ? t("markets.detail.following")
              : t("markets.detail.follow")
          }}
        </button>
      </div>
    </nav>

    <main class="mx-auto max-w-md">
      <div v-if="store.loading" class="py-12 text-center text-sm text-gray-500">
        {{ t("markets.common.loading") }}
      </div>
      <div
        v-else-if="store.error"
        class="py-8 text-center text-sm text-red-500"
      >
        {{ t(store.error) }}
      </div>
      <template v-else-if="store.selectedMarket">
        <MarketDetailHero
          :market="store.selectedMarket"
          :vendor-count="store.vendorCount"
        />
        <section class="space-y-4 px-4 py-4">
          <section
            v-if="isPublicSetupIncomplete"
            data-testid="market-public-readiness-notice"
            class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <h2 class="text-base font-semibold text-amber-900">
              {{ t("markets.detail.readinessTitle") }}
            </h2>
            <p class="mt-1 text-sm leading-6 text-amber-800">
              {{ t("markets.detail.readinessDesc") }}
            </p>
          </section>

          <section
            v-if="isCatalogSyncing"
            data-testid="market-catalog-syncing-notice"
            class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3"
          >
            <h2 class="text-base font-semibold text-blue-900">
              {{ t("markets.detail.syncingTitle") }}
            </h2>
            <p class="mt-1 text-sm leading-6 text-blue-800">
              {{
                tWithParams("markets.detail.syncingDesc", {
                  coverage: catalogCoverageLabel,
                })
              }}
            </p>
          </section>

          <section
            v-if="hasExplorationShortcuts"
            data-testid="market-exploration-shortcuts"
            class="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
          >
            <div>
              <h2 class="text-base font-semibold text-gray-900">
                {{ t("markets.detail.exploreTitle") }}
              </h2>
            </div>

            <div v-if="menuItemCategoryFacets.length > 0" class="space-y-2">
              <h3 class="text-sm font-medium text-gray-700">
                {{ t("markets.detail.popularDishes") }}
              </h3>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="facet in menuItemCategoryFacets"
                  :key="facet.categoryName"
                  type="button"
                  :data-testid="`market-dish-facet-${facet.categoryName}`"
                  class="rounded-full border border-ios-blue/30 bg-ios-blue/5 px-3 py-1.5 text-sm font-medium text-ios-blue"
                  @click="applyDishCategoryShortcut(facet.categoryName)"
                >
                  {{ facet.categoryName }}
                  <span class="ml-1 text-xs text-ios-blue/70">
                    {{ facet.count }}
                  </span>
                </button>
              </div>
            </div>

            <div v-if="productCategoryFacets.length > 0" class="space-y-2">
              <h3 class="text-sm font-medium text-gray-700">
                {{ t("markets.detail.popularProducts") }}
              </h3>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="facet in productCategoryFacets"
                  :key="facet.categoryName"
                  type="button"
                  :data-testid="`market-product-facet-${facet.categoryName}`"
                  class="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800"
                  @click="applyProductCategoryShortcut(facet.categoryName)"
                >
                  {{ facet.categoryName }}
                  <span class="ml-1 text-xs text-amber-700">
                    {{ facet.count }}
                  </span>
                </button>
              </div>
            </div>

            <div v-if="serviceTypeFacets.length > 0" class="space-y-2">
              <h3 class="text-sm font-medium text-gray-700">
                {{ t("markets.detail.stallServices") }}
              </h3>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="facet in serviceTypeFacets"
                  :key="facet.serviceType"
                  type="button"
                  :data-testid="`market-service-facet-${facet.serviceType}`"
                  class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700"
                  @click="applyServiceTypeShortcut(facet.serviceType)"
                >
                  {{ serviceTypeLabel(facet.serviceType) }}
                  <span class="ml-1 text-xs text-emerald-600">
                    {{ facet.count }}
                  </span>
                </button>
              </div>
            </div>
          </section>

          <section
            v-if="marketCart && marketCartItemCount > 0"
            data-testid="market-cart-summary"
            class="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-emerald-950">
                  {{ t("markets.detail.cartTitle") }}
                </h2>
                <p class="mt-1 text-sm text-emerald-800">
                  {{
                    tWithParams("markets.detail.cartSummary", {
                      vendors: marketCart.vendors.length,
                      items: marketCartItemCount,
                    })
                  }}
                </p>
              </div>
              <div class="text-right text-base font-semibold text-emerald-950">
                {{ formatPrice(marketCartSubtotal) }}
              </div>
            </div>

            <div class="space-y-2">
              <article
                v-for="vendor in marketCart.vendors"
                :key="vendor.restaurantId"
                class="rounded-lg bg-white px-3 py-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <h3 class="truncate text-sm font-semibold text-gray-900">
                    {{ vendor.name }}
                  </h3>
                  <span class="text-xs font-medium text-gray-500">
                    {{
                      tWithParams("markets.detail.vendorItemCount", {
                        count: vendorItemCount(vendor),
                      })
                    }}
                  </span>
                </div>
                <p class="mt-1 truncate text-sm text-gray-600">
                  {{
                    vendor.items
                      .map((item) =>
                        getLocalizedMenuName(item.menuItem, currentLanguage),
                      )
                      .join(t("format.listSeparator"))
                  }}
                </p>
              </article>
            </div>

            <div class="space-y-2 border-t border-emerald-200 pt-3">
              <label
                class="block text-xs font-medium uppercase tracking-wide text-emerald-800"
                for="market-checkout-phone"
              >
                {{ t("markets.detail.phoneLastDigits") }}
              </label>
              <div class="flex gap-2">
                <input
                  id="market-checkout-phone"
                  v-model="marketCheckoutPhoneLastDigits"
                  type="tel"
                  inputmode="numeric"
                  maxlength="3"
                  pattern="[0-9]{3}"
                  data-testid="market-checkout-phone"
                  class="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
                <!-- Greyed and inert rather than hidden while the API has
                     market checkouts switched off: hiding the basket's only
                     action makes the feature look absent, and letting the
                     request through only produces a refusal. -->
                <button
                  type="button"
                  data-testid="market-checkout-submit"
                  :data-disabled="marketCheckoutsDisabled ? 'true' : undefined"
                  :aria-disabled="marketCheckoutsDisabled ? 'true' : undefined"
                  :title="
                    marketCheckoutsDisabled
                      ? t('markets.common.checkoutUnavailable')
                      : undefined
                  "
                  class="rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed"
                  :class="
                    marketCheckoutsDisabled
                      ? 'bg-gray-200 text-gray-400'
                      : 'bg-emerald-700 text-white disabled:bg-emerald-300'
                  "
                  :disabled="!canSubmitMarketCheckout"
                  @click="submitMarketCheckout"
                >
                  <template v-if="marketCheckoutsDisabled">
                    {{ t("markets.common.checkoutUnavailable") }}
                  </template>
                  <template v-else>
                    {{
                      isSubmittingMarketCheckout
                        ? t("markets.detail.submitting")
                        : t("markets.detail.submit")
                    }}
                  </template>
                </button>
              </div>
              <p
                v-if="marketCheckoutsDisabled"
                data-testid="market-checkout-unavailable-hint"
                class="text-xs text-emerald-800"
              >
                {{ t("markets.detail.checkoutDisabledHint") }}
              </p>
              <p
                v-else-if="marketCart.vendors.length < 2"
                class="text-xs text-emerald-800"
              >
                {{ t("markets.detail.checkoutMinVendors") }}
              </p>
            </div>

            <div
              v-if="marketCheckoutResult"
              data-testid="market-checkout-result"
              class="rounded-lg bg-white px-3 py-2 text-sm text-emerald-900"
            >
              {{
                tWithParams("markets.detail.checkoutSubmitted", {
                  count: marketCheckoutResult.checkout.childOrders.length,
                })
              }}
            </div>
          </section>

          <StallMapInMarket
            :vendors="store.vendors"
            :layout="store.selectedMarket.mapLayout"
            @select-vendor="openVendor"
          />

          <MarketLocationMap
            :market="store.selectedMarket"
            :vendors="store.vendors"
          />

          <VendorListInMarket
            :vendors="store.vendors"
            :loading="store.vendorsLoading"
            :query="vendorQuery"
            :takeaway-only="takeawayOnly"
            :delivery-only="deliveryOnly"
            :has-more="store.hasMoreVendors"
            @update:query="onQueryChange"
            @update:takeaway-only="onTakeawayOnlyChange"
            @update:delivery-only="onDeliveryOnlyChange"
            @select-vendor="openVendor"
            @select-services="openVendorServices"
            @takeaway="startTakeaway"
            @contact-vendor="openContactProfile"
            @use-location="sortVendorsByLocation"
            @load-more="loadMoreVendors"
          />

          <MarketProductSearch
            :key="marketSearchKey"
            :market-id="store.selectedMarket.id"
            :initial-query="marketSearchState.q"
            :initial-category="marketSearchState.categoryName"
            :initial-service-type="marketSearchState.serviceType"
            :initial-result-kind="marketSearchState.resultKind"
            :initial-takeaway="marketSearchState.takeaway"
            :initial-delivery="marketSearchState.delivery"
            :initial-sort-by="marketSearchState.sortBy"
            :initial-lat="marketSearchState.lat"
            :initial-lng="marketSearchState.lng"
            :initial-radius-km="marketSearchState.radiusKm"
            @select="openDishVendor"
            @select-vendor="openVendor"
            @select-vendor-services="openVendorServices"
            @select-service="openServiceVendor"
            @search-state-change="syncMarketSearchState"
            @takeaway="startDishTakeaway"
          />

          <section
            v-if="selectedContactVendor"
            class="rounded-xl border border-gray-200 bg-white p-4"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-gray-900">
                  {{ selectedContactVendor.name }}
                </h2>
                <p class="text-sm text-gray-500">
                  {{ t("markets.detail.contactTitle") }}
                </p>
              </div>
              <button
                type="button"
                class="text-sm font-medium text-gray-500"
                @click="closeContactProfile"
              >
                {{ t("markets.detail.close") }}
              </button>
            </div>

            <div v-if="contactLoading" class="mt-4 text-sm text-gray-500">
              {{ t("markets.detail.contactLoading") }}
            </div>
            <template v-else>
              <div v-if="contactProfile?.faqs.length" class="mt-4 space-y-2">
                <input
                  v-model="faqQuery"
                  type="search"
                  class="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ios-blue focus:outline-none focus:ring-2 focus:ring-ios-blue/20"
                  :placeholder="t('markets.detail.faqPlaceholder')"
                />
                <details
                  v-for="faq in filteredFaqs"
                  :key="faq.id"
                  class="rounded-lg border border-gray-200 px-3 py-2"
                >
                  <summary class="cursor-pointer text-sm font-medium">
                    {{ faq.question }}
                  </summary>
                  <p class="mt-2 text-sm leading-6 text-gray-600">
                    {{ faq.answer }}
                  </p>
                </details>
                <p
                  v-if="filteredFaqs.length === 0"
                  class="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500"
                >
                  {{ t("markets.detail.faqEmpty") }}
                </p>
              </div>
              <div
                v-else
                class="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500"
              >
                {{ t("markets.detail.faqNone") }}
              </div>

              <div class="mt-4 grid grid-cols-2 gap-2">
                <a
                  v-for="channel in availableContactChannels"
                  :key="channel.key"
                  :href="channel.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="rounded-lg bg-ios-blue px-3 py-2 text-center text-sm font-medium text-white"
                >
                  {{ channel.label }}
                </a>
              </div>
              <p
                v-if="availableContactChannels.length === 0"
                class="mt-3 text-sm text-gray-500"
              >
                {{ t("markets.detail.contactNone") }}
              </p>
            </template>
          </section>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "vue-toastification";
import MarketDetailHero from "@/components/markets/MarketDetailHero.vue";
import MarketProductSearch from "@/components/markets/MarketProductSearch.vue";
import StallMapInMarket from "@/components/markets/StallMapInMarket.vue";
import VendorListInMarket from "@/components/markets/VendorListInMarket.vue";
import { useMarketCartStore, type MarketCartVendor } from "@/stores/marketCart";
import { useMarketsStore } from "@/stores/markets";
import { discoveryApi } from "@/services/discoveryApi";
import type {
  DishSearchResult,
  SearchFilters,
  ServiceSearchResult,
} from "@/services/discoveryApi";
import type { MarketVendor } from "@/services/marketsApi";
import {
  restaurantContactApi,
  type RestaurantContactProfile,
} from "@/services/restaurantContactApi";
import { applyMarketSeoMeta } from "@/utils/seoMeta";
import {
  isFavoriteMarket,
  recordRecentMarket,
  syncRecentMarketVisit,
  syncFavoriteMarketPreference,
  toggleFavoriteMarket,
} from "@/utils/marketEngagement";
import {
  shopMenuItemQuery,
  shopMenuReturnQuery,
  shopMenuServiceQuery,
  shopMenuServicesQuery,
} from "@/utils/shopMenuDeepLink";
import { useCurrency } from "@/composables/useCurrency";
import { useI18n } from "@/composables/useI18n";
import { getLocalizedMenuName } from "@/utils/localized-menu-content";
import { useFeatureAvailability } from "@/composables/useFeatureAvailability";
import { orderApi, type MarketCheckoutResponse } from "@/services/orderApi";
import { parseUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const route = useRoute();
const router = useRouter();
const toast = useToast();
const store = useMarketsStore();
const marketCartStore = useMarketCartStore();
const { formatPrice } = useCurrency();
const { t, tWithParams, currentLanguage } = useI18n();
const { isDisabled } = useFeatureAvailability();
const marketCheckoutsDisabled = computed(() => isDisabled("marketCheckouts"));
const MarketLocationMap = defineAsyncComponent(
  () => import("@/components/markets/MarketLocationMap.vue"),
);
const vendorQuery = ref(firstQueryString(route.query.vendorQ));
const takeawayOnly = ref(queryBoolean(route.query.vendorTakeaway));
const deliveryOnly = ref(queryBoolean(route.query.vendorDelivery));
const initialVendorLocation =
  firstQueryString(route.query.vendorSortBy) === "distance" &&
  queryNumber(route.query.vendorLat) != null &&
  queryNumber(route.query.vendorLng) != null
    ? {
        lat: queryNumber(route.query.vendorLat) as number,
        lng: queryNumber(route.query.vendorLng) as number,
        radiusKm: queryNumber(route.query.vendorRadiusKm) ?? 2,
      }
    : null;
const vendorLocation = ref<{
  lat: number;
  lng: number;
  radiusKm: number;
} | null>(initialVendorLocation);
const selectedContactVendor = ref<MarketVendor | null>(null);
const contactProfile = ref<RestaurantContactProfile | null>(null);
const contactLoading = ref(false);
const faqQuery = ref("");
const isFavorite = ref(false);
// Empty, not "000": the submit button stays disabled until three digits are
// actually typed (see canSubmitMarketCheckout), so the recovery credential is
// always one the customer chose. A prefilled placeholder that happens to pass
// validation gets submitted untouched by most people.
const marketCheckoutPhoneLastDigits = ref("");
const isSubmittingMarketCheckout = ref(false);
const marketCheckoutResult = ref<MarketCheckoutResponse | null>(null);
let queryTimer: ReturnType<typeof setTimeout> | undefined;
type MarketSearchState = {
  q: string;
  categoryName: string;
  serviceType: NonNullable<SearchFilters["serviceType"]> | "";
  resultKind: MarketSearchResultKind;
  takeaway: boolean;
  delivery: boolean;
  sortBy: MarketSearchSort;
  lat?: number;
  lng?: number;
  radiusKm?: number;
};
type MarketSearchResultKind =
  | "all"
  | "menu_item"
  | "product"
  | "service"
  | "vendor";
type MarketSearchSort =
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "popular"
  | "open_now"
  | "distance";

function firstQueryString(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string") ?? "";
  }
  return typeof value === "string" ? value : "";
}

function queryBoolean(value: unknown) {
  return firstQueryString(value) === "true";
}

function queryNumber(value: unknown) {
  const rawValue = firstQueryString(value);
  if (!rawValue) return undefined;

  const numberValue = Number(rawValue);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function isSortBy(value: string): value is MarketSearchState["sortBy"] {
  return [
    "relevance",
    "price_asc",
    "price_desc",
    "popular",
    "open_now",
    "distance",
  ].includes(value);
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

function isMarketSearchResultKind(
  value: string,
): value is MarketSearchResultKind {
  return ["all", "menu_item", "product", "service", "vendor"].includes(value);
}

function marketSearchStateFromQuery(): MarketSearchState {
  const sortBy = firstQueryString(route.query.sortBy);
  const serviceType = firstQueryString(route.query.serviceType);
  const resultKind = firstQueryString(route.query.resultKind);
  const lat = queryNumber(route.query.lat);
  const lng = queryNumber(route.query.lng);
  const radiusKm = queryNumber(route.query.radiusKm);
  return {
    q: firstQueryString(route.query.q),
    categoryName: firstQueryString(route.query.categoryName),
    serviceType: isServiceType(serviceType) ? serviceType : "",
    resultKind: isMarketSearchResultKind(resultKind) ? resultKind : "all",
    takeaway: queryBoolean(route.query.takeaway),
    delivery: queryBoolean(route.query.delivery),
    sortBy: isSortBy(sortBy) ? sortBy : "relevance",
    ...(lat != null ? { lat } : {}),
    ...(lng != null ? { lng } : {}),
    ...(radiusKm != null ? { radiusKm } : {}),
  };
}

const marketSearchState = ref<MarketSearchState>(marketSearchStateFromQuery());
const marketSearchKey = ref(0);
const returnContext = computed(() => {
  const path = firstQueryString(route.query.returnPath).trim();
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;

  const label =
    firstQueryString(route.query.returnLabel).trim() ||
    t("markets.detail.previousPage");
  return { path, label };
});
const menuItemCategoryFacets = computed(
  () =>
    store.explorationSummary?.menuItemCategories ??
    (store.explorationSummary?.dishCategories ?? []).filter(
      (facet) => facet.catalogType !== "product",
    ),
);
const productCategoryFacets = computed(
  () =>
    store.explorationSummary?.productCategories ??
    (store.explorationSummary?.dishCategories ?? []).filter(
      (facet) => facet.catalogType === "product",
    ),
);
const serviceTypeFacets = computed(() =>
  (store.explorationSummary?.serviceTypes ?? []).filter(
    (
      facet,
    ): facet is typeof facet & {
      serviceType: NonNullable<SearchFilters["serviceType"]>;
    } => isServiceType(facet.serviceType),
  ),
);
const hasExplorationShortcuts = computed(
  () =>
    menuItemCategoryFacets.value.length > 0 ||
    productCategoryFacets.value.length > 0 ||
    serviceTypeFacets.value.length > 0,
);
const catalogCoverage = computed(() => store.selectedMarket?.catalogCoverage);
const searchableProductCount = computed(
  () => catalogCoverage.value?.searchableProductCount ?? 0,
);
const publicServiceCount = computed(
  () => catalogCoverage.value?.publicServiceCount ?? 0,
);
const hasSearchableCatalogCoverage = computed(
  () => searchableProductCount.value > 0 || publicServiceCount.value > 0,
);
const isCatalogSyncing = computed(
  () => hasSearchableCatalogCoverage.value && !hasExplorationShortcuts.value,
);
const catalogCoverageLabel = computed(() => {
  const labels: string[] = [];
  if (searchableProductCount.value > 0) {
    labels.push(
      tWithParams("markets.detail.coverageProducts", {
        count: searchableProductCount.value,
      }),
    );
  }
  if (publicServiceCount.value > 0) {
    labels.push(
      tWithParams("markets.detail.coverageServices", {
        count: publicServiceCount.value,
      }),
    );
  }
  return labels.join(t("format.listSeparator"));
});
const isPublicSetupIncomplete = computed(
  () => store.selectedMarket?.publicReadiness?.ready === false,
);
const marketCart = computed(() => marketCartStore.cartForMarket(slug()));
const marketCartItemCount = computed(() =>
  marketCart.value ? marketCartStore.itemCountForCart(marketCart.value) : 0,
);
const marketCartSubtotal = computed(() =>
  marketCart.value ? marketCartStore.subtotalForCart(marketCart.value) : 0,
);
const canSubmitMarketCheckout = computed(
  () =>
    !marketCheckoutsDisabled.value &&
    !!marketCart.value &&
    marketCart.value.vendors.length >= 2 &&
    /^\d{3}$/.test(marketCheckoutPhoneLastDigits.value) &&
    !isSubmittingMarketCheckout.value &&
    !marketCheckoutResult.value,
);

const slug = () => String(route.params.slug);

function loadVendors() {
  store.loadVendors(slug(), vendorFilters());
}

function vendorFilters() {
  return {
    q: vendorQuery.value || undefined,
    takeaway: takeawayOnly.value || undefined,
    delivery: deliveryOnly.value || undefined,
    ...(vendorLocation.value
      ? {
          sortBy: "distance" as const,
          lat: vendorLocation.value.lat,
          lng: vendorLocation.value.lng,
          radiusKm: vendorLocation.value.radiusKm,
        }
      : {}),
  };
}

function loadMoreVendors() {
  store.loadMoreVendors(slug(), vendorFilters());
}

function onQueryChange(value: string) {
  vendorQuery.value = value;
  syncVendorQueryState();
  if (queryTimer) clearTimeout(queryTimer);
  queryTimer = setTimeout(loadVendors, 250);
}

function onTakeawayOnlyChange(value: boolean) {
  takeawayOnly.value = value;
  syncVendorQueryState();
  loadVendors();
}

function onDeliveryOnlyChange(value: boolean) {
  deliveryOnly.value = value;
  syncVendorQueryState();
  loadVendors();
}

function sortVendorsByLocation() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      vendorLocation.value = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        radiusKm: 2,
      };
      syncVendorQueryState();
      loadVendors();
    },
    () => {
      vendorLocation.value = null;
      syncVendorQueryState();
      loadVendors();
    },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
  );
}

function syncVendorQueryState() {
  router.replace({
    query: {
      ...currentMarketQuery(),
      ...marketDirectoryReturnQuery(),
    },
  });
}

function currentMarketQuery() {
  const query = { ...route.query };
  for (const key of [
    "q",
    "categoryName",
    "serviceType",
    "resultKind",
    "takeaway",
    "delivery",
    "sortBy",
    "lat",
    "lng",
    "radiusKm",
    "vendorQ",
    "vendorTakeaway",
    "vendorDelivery",
    "vendorSortBy",
    "vendorLat",
    "vendorLng",
    "vendorRadiusKm",
  ]) {
    delete query[key];
  }

  const state = marketSearchState.value;
  if (state.q) query.q = state.q;
  if (state.categoryName) query.categoryName = state.categoryName;
  if (state.serviceType) query.serviceType = state.serviceType;
  if (state.resultKind !== "all") query.resultKind = state.resultKind;
  if (state.takeaway) query.takeaway = "true";
  if (state.delivery) query.delivery = "true";
  if (state.sortBy !== "relevance") query.sortBy = state.sortBy;
  if (state.sortBy === "distance" && state.lat != null) {
    query.lat = String(state.lat);
  }
  if (state.sortBy === "distance" && state.lng != null) {
    query.lng = String(state.lng);
  }
  if (state.sortBy === "distance" && state.radiusKm != null) {
    query.radiusKm = String(state.radiusKm);
  }

  const vendorSearch = vendorQuery.value.trim();
  if (vendorSearch) query.vendorQ = vendorSearch;
  if (takeawayOnly.value) query.vendorTakeaway = "true";
  if (deliveryOnly.value) query.vendorDelivery = "true";
  if (vendorLocation.value) {
    query.vendorSortBy = "distance";
    query.vendorLat = String(vendorLocation.value.lat);
    query.vendorLng = String(vendorLocation.value.lng);
    query.vendorRadiusKm = String(vendorLocation.value.radiusKm);
  }

  return query;
}

function openVendor(vendor: { restaurantId: string }) {
  if (vendorIsClosedToday(vendor)) {
    toast.error(t("markets.vendors.notOpenToday"));
    return;
  }
  router.push({
    name: "ShopMenu",
    params: { restaurantId: vendor.restaurantId },
    query: marketReturnQuery(),
  });
}

function openVendorServices(vendor: { restaurantId: string }) {
  if (vendorIsClosedToday(vendor)) {
    toast.error(t("markets.vendors.notOpenToday"));
    return;
  }
  router.push({
    name: "ShopMenu",
    params: { restaurantId: vendor.restaurantId },
    query: {
      ...shopMenuServicesQuery(),
      ...marketReturnQuery(),
    },
  });
}

function vendorIsClosedToday(vendor: {
  restaurantId: string;
  isOpen?: boolean;
}) {
  const listed = store.vendors.find(
    (entry) => entry.restaurantId === vendor.restaurantId,
  );
  return vendor.isOpen === false || listed?.isOpen === false;
}

async function startTakeaway(vendor: MarketVendor) {
  if (vendorIsClosedToday(vendor)) {
    toast.error(t("markets.vendors.notOpenToday"));
    return;
  }
  await startTakeawayForRestaurant(vendor.restaurantId, marketReturnQuery());
}

async function startDishTakeaway(dish: DishSearchResult) {
  await startTakeawayForRestaurant(dish.restaurantId, {
    ...shopMenuItemQuery(dish),
    ...marketReturnQuery(),
  });
}

async function startTakeawayForRestaurant(
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

function openDishVendor(dish: DishSearchResult) {
  router.push({
    name: "ShopMenu",
    params: { restaurantId: dish.restaurantId },
    query: {
      ...shopMenuItemQuery(dish),
      ...marketReturnQuery(),
    },
  });
}

function openServiceVendor(service: ServiceSearchResult) {
  router.push({
    name: "ShopMenu",
    params: { restaurantId: service.restaurantId },
    query: {
      ...shopMenuServiceQuery(service),
      ...marketReturnQuery(),
    },
  });
}

function syncMarketSearchState(state: MarketSearchState) {
  marketSearchState.value = state;
  router.replace({
    query: {
      ...currentMarketQuery(),
      ...marketDirectoryReturnQuery(),
    },
  });
}

function applyDishCategoryShortcut(categoryName: string) {
  syncShortcutSearchState({
    q: "",
    categoryName,
    serviceType: "",
    resultKind: "menu_item",
    takeaway: false,
    delivery: false,
    sortBy: "relevance",
    lat: undefined,
    lng: undefined,
    radiusKm: undefined,
  });
}

function applyProductCategoryShortcut(categoryName: string) {
  syncShortcutSearchState({
    q: "",
    categoryName,
    serviceType: "",
    resultKind: "product",
    takeaway: false,
    delivery: false,
    sortBy: "relevance",
    lat: undefined,
    lng: undefined,
    radiusKm: undefined,
  });
}

function applyServiceTypeShortcut(
  serviceType: NonNullable<SearchFilters["serviceType"]>,
) {
  syncShortcutSearchState({
    q: "",
    categoryName: "",
    serviceType,
    resultKind: "service",
    takeaway: false,
    delivery: false,
    sortBy: "relevance",
    lat: undefined,
    lng: undefined,
    radiusKm: undefined,
  });
}

function syncShortcutSearchState(state: MarketSearchState) {
  syncMarketSearchState(state);
  marketSearchKey.value += 1;
}

function serviceTypeLabel(
  serviceType: NonNullable<SearchFilters["serviceType"]>,
) {
  return t(`markets.serviceType.${serviceType}`);
}

function marketReturnQuery() {
  return shopMenuReturnQuery({
    path: currentMarketPath(),
    label: store.selectedMarket?.name ?? t("markets.detail.fallbackTitle"),
  });
}

function currentMarketPath() {
  const query = {
    ...currentMarketQuery(),
    ...marketDirectoryReturnQuery(),
  };
  const searchParams = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (typeof value === "string") searchParams.set(key, value);
  });
  const queryString = searchParams.toString();
  return `/markets/${slug()}${queryString ? `?${queryString}` : ""}`;
}

function marketDirectoryReturnQuery() {
  if (!returnContext.value) return {};

  return {
    returnPath: returnContext.value.path,
    returnLabel: returnContext.value.label,
  };
}

function goBack() {
  if (returnContext.value) {
    router.push(returnContext.value.path);
    return;
  }

  router.back();
}

function refreshFavoriteState() {
  if (!store.selectedMarket) {
    isFavorite.value = false;
    return;
  }
  isFavorite.value = isFavoriteMarket(store.selectedMarket.id);
}

async function toggleFavorite() {
  if (!store.selectedMarket) return;
  const nextFavorite = toggleFavoriteMarket(store.selectedMarket);
  isFavorite.value = nextFavorite;

  try {
    await syncFavoriteMarketPreference(store.selectedMarket, nextFavorite);
  } catch (error) {
    toggleFavoriteMarket(store.selectedMarket);
    isFavorite.value = !nextFavorite;
    toast.error(t("markets.detail.favoriteSyncFailed"));
    console.error("Failed to sync market favorite:", error);
  }
}

function vendorItemCount(vendor: MarketCartVendor) {
  return vendor.items.reduce((total, item) => total + item.quantity, 0);
}

async function submitMarketCheckout() {
  if (!marketCart.value || !canSubmitMarketCheckout.value) return;

  isSubmittingMarketCheckout.value = true;
  try {
    const checkoutMarketSlug = marketCart.value.marketSlug;
    const checkout = await orderApi.createMarketCheckout({
      marketSlug: checkoutMarketSlug,
      guestName: "Guest",
      phoneLastDigits: marketCheckoutPhoneLastDigits.value,
      vendors: marketCart.value.vendors.map((vendor) => ({
        restaurantId: vendor.restaurantId,
        items: vendor.items.map((item) => ({
          menuItemId: item.menuItem.id,
          quantity: item.quantity,
          customizations: item.customizations,
          notes: item.notes,
        })),
      })),
    });

    marketCheckoutResult.value = checkout;
    marketCartStore.clearMarket(checkoutMarketSlug);
    toast.success(t("markets.detail.checkoutSuccess"));
    router.push({
      name: "MarketCheckoutTracking",
      params: {
        slug: checkoutMarketSlug,
        checkoutId: checkout.checkout.id,
      },
    });
  } catch (error) {
    console.error("Market checkout failed:", error);
    const { code } = parseUserFacingError(error);
    if (code === "VENDOR_NOT_OPEN_TODAY" && marketCart.value) {
      for (const restaurantId of closedVendorIdsFrom(error)) {
        marketCartStore.removeVendor(marketCart.value.marketSlug, restaurantId);
      }
      toast.error(t("markets.detail.vendorNotOpenToday"));
      return;
    }
    toast.error(t("markets.detail.checkoutFailed"));
  } finally {
    isSubmittingMarketCheckout.value = false;
  }
}

function closedVendorIdsFrom(error: unknown): string[] {
  const apiError = error as {
    details?: { restaurantIds?: unknown };
    response?: {
      data?: { error?: { details?: { restaurantIds?: unknown } } };
    };
  } | null;
  const details = apiError?.details ?? apiError?.response?.data?.error?.details;
  return Array.isArray(details?.restaurantIds)
    ? details.restaurantIds.filter((id): id is string => typeof id === "string")
    : [];
}

async function openContactProfile(vendor: MarketVendor) {
  selectedContactVendor.value = vendor;
  contactProfile.value = null;
  faqQuery.value = "";
  contactLoading.value = true;
  try {
    contactProfile.value = await restaurantContactApi.getContactProfile(
      vendor.restaurantId,
    );
  } catch (error) {
    console.error("Failed to load contact profile:", error);
    store.error = "markets.loadContactFailed";
  } finally {
    contactLoading.value = false;
  }
}

function closeContactProfile() {
  selectedContactVendor.value = null;
  contactProfile.value = null;
  faqQuery.value = "";
}

const contactChannelLabels: Record<string, string> = {
  line: "LINE",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  telegram: "Telegram",
};

const availableContactChannels = computed(() => {
  const channels = contactProfile.value?.messagingChannels ?? {};
  return Object.entries(channels)
    .filter(([, url]) => typeof url === "string" && url.length > 0)
    .map(([key, url]) => ({
      key,
      label: contactChannelLabels[key] ?? key,
      url,
    }));
});

const filteredFaqs = computed(() => {
  const query = faqQuery.value.trim().toLowerCase();
  const faqs = contactProfile.value?.faqs ?? [];
  if (!query) return faqs;

  return faqs.filter((faq) => {
    const haystack = [faq.question, faq.answer, ...faq.keywords]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
});

onMounted(async () => {
  await store.loadMarketDetail(slug());
  if (store.selectedMarket) {
    marketCartStore.initializeMarket(
      store.selectedMarket.slug,
      store.selectedMarket.name,
    );
    recordRecentMarket(store.selectedMarket);
    void syncRecentMarketVisit(store.selectedMarket).catch((error) => {
      console.error("Failed to sync recent market visit:", error);
    });
    refreshFavoriteState();
    applyMarketSeoMeta({
      market: store.selectedMarket,
      vendorCount: store.vendorCount,
      path: route.fullPath,
    });
  }
  loadVendors();
});

onBeforeUnmount(() => {
  if (queryTimer) clearTimeout(queryTimer);
  closeContactProfile();
  store.resetSelectedMarket();
});
</script>
