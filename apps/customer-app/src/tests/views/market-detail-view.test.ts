import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketDetailView from "@/views/MarketDetailView.vue";
import { customerIdentityApi } from "@/services/customerIdentityApi";
import { discoveryApi } from "@/services/discoveryApi";
import { useMarketCartStore } from "@/stores/marketCart";
import { useMarketsStore } from "@/stores/markets";
import {
  clearCustomerAccessToken,
  setCustomerAccessToken,
} from "@/services/customerAccessToken";

const routerPush = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());
const routerBack = vi.hoisted(() => vi.fn());
const createMarketCheckout = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const routeQuery = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: { slug: "fengjia" },
    fullPath: "/markets/fengjia",
    query: routeQuery,
  }),
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
    back: routerBack,
  }),
}));

vi.mock("@/stores/markets", () => ({
  useMarketsStore: vi.fn(),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
  }),
}));

vi.mock("@/services/orderApi", () => ({
  orderApi: {
    createMarketCheckout,
  },
}));

vi.mock("@/services/customerIdentityApi", () => ({
  customerIdentityApi: {
    listFavorites: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    listRecentMarkets: vi.fn(),
    recordRecentMarket: vi.fn(),
  },
}));

vi.mock("@/services/discoveryApi", () => ({
  discoveryApi: {
    getTakeawayEligibility: vi.fn(),
  },
}));

vi.mock("@/services/restaurantContactApi", () => ({
  restaurantContactApi: {
    getContactProfile: vi.fn(),
  },
}));

vi.mock("@/utils/seoMeta", () => ({
  applyMarketSeoMeta: vi.fn(),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (amount: number) => `NT$${amount}`,
  }),
}));

// The view reads the locale so vendor item names follow the visitor's language
// (#112). Mounted without an i18n plugin, the real composable throws "Need to
// install with `app.use` function".
vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
    currentLanguage: ref("zh-TW"),
  }),
}));

function marketStore(overrides: Record<string, unknown> = {}) {
  return {
    selectedMarket: {
      id: "market-1",
      slug: "fengjia",
      name: "逢甲夜市",
    },
    vendors: [],
    vendorCount: 0,
    explorationSummary: {
      dishSearchUrl: "/api/v1/discovery/search?marketSlug=fengjia",
      serviceSearchUrl: "/api/v1/discovery/services?marketSlug=fengjia",
      dishCategories: [
        {
          categoryName: "炸物",
          catalogType: "menu_item",
          count: 3,
          searchUrl:
            "/api/v1/discovery/search?marketSlug=fengjia&catalogType=menu_item&categoryName=%E7%82%B8%E7%89%A9",
        },
        {
          categoryName: "配件",
          catalogType: "product",
          count: 4,
          searchUrl:
            "/api/v1/discovery/search?marketSlug=fengjia&catalogType=product&categoryName=%E9%85%8D%E4%BB%B6",
        },
      ],
      menuItemCategories: [
        {
          categoryName: "炸物",
          catalogType: "menu_item",
          count: 3,
          searchUrl:
            "/api/v1/discovery/search?marketSlug=fengjia&catalogType=menu_item&categoryName=%E7%82%B8%E7%89%A9",
        },
      ],
      productCategories: [
        {
          categoryName: "配件",
          catalogType: "product",
          count: 4,
          searchUrl:
            "/api/v1/discovery/search?marketSlug=fengjia&catalogType=product&categoryName=%E9%85%8D%E4%BB%B6",
        },
      ],
      serviceTypes: [
        {
          serviceType: "pickup",
          count: 2,
          searchUrl:
            "/api/v1/discovery/services?marketSlug=fengjia&serviceType=pickup",
        },
      ],
    },
    loading: false,
    vendorsLoading: false,
    hasMoreVendors: false,
    error: null,
    loadMarketDetail: vi.fn().mockResolvedValue(undefined),
    loadVendors: vi.fn().mockResolvedValue(undefined),
    loadMoreVendors: vi.fn().mockResolvedValue(undefined),
    resetSelectedMarket: vi.fn(),
    ...overrides,
  };
}

function mountView() {
  return mount(MarketDetailView, {
    global: {
      stubs: {
        MarketDetailHero: true,
        MarketLocationMap: {
          props: ["market", "vendors"],
          template: `
            <section data-testid="market-location-map">
              {{ market.name }}|{{ vendors.length }}
            </section>
          `,
        },
        StallMapInMarket: {
          props: ["vendors"],
          emits: ["selectVendor"],
          template: `
            <section data-testid="stall-map">
              <button
                data-testid="stall-map-open-vendor"
                @click="$emit('selectVendor', {
                  restaurantId: 'stall-map-restaurant',
                  name: '地圖雞排攤',
                  type: 'market_stall',
                  district: '西屯區',
                  priceRange: null,
                  rating: null,
                  isOpen: true,
                  supportsTakeaway: true,
                  supportsDelivery: false,
                  imageUrl: null,
                  stallNumber: 'C-01',
                  isPrimary: true
                })"
              >
                stall map
              </button>
            </section>
          `,
        },
        VendorListInMarket: {
          props: [
            "vendors",
            "loading",
            "query",
            "takeawayOnly",
            "deliveryOnly",
            "hasMore",
          ],
          emits: [
            "update:query",
            "update:takeawayOnly",
            "update:deliveryOnly",
            "selectVendor",
            "selectServices",
            "takeaway",
            "contactVendor",
            "loadMore",
            "useLocation",
          ],
          template: `
            <section data-testid="vendor-list">
              <div data-testid="vendor-list-has-more">{{ hasMore }}</div>
              <button
                data-testid="open-market-vendor"
                @click="$emit('selectVendor', {
                  restaurantId: 'restaurant-1',
                  name: '雞排攤',
                  type: 'market_stall',
                  district: '西屯區',
                  priceRange: null,
                  rating: null,
                  isOpen: true,
                  supportsTakeaway: true,
                  supportsDelivery: false,
                  imageUrl: null,
                  stallNumber: 'A-01',
                  isPrimary: true
                })"
              >
                open vendor
              </button>
              <button
                data-testid="open-market-vendor-services"
                @click="$emit('selectServices', {
                  restaurantId: 'restaurant-1',
                  name: '雞排攤',
                  type: 'market_stall',
                  district: '西屯區',
                  priceRange: null,
                  rating: null,
                  isOpen: true,
                  supportsTakeaway: true,
                  supportsDelivery: false,
                  imageUrl: null,
                  stallNumber: 'A-01',
                  isPrimary: true,
                  availableMenuItemCount: 3,
                  publicServiceItemCount: 2
                })"
              >
                open vendor services
              </button>
              <button
                data-testid="takeaway-market-vendor"
                @click="$emit('takeaway', { restaurantId: 'restaurant-1', isOpen: true })"
              >
                takeaway vendor
              </button>
              <button
                data-testid="vendor-list-load-more"
                @click="$emit('loadMore')"
              >
                load more vendors
              </button>
              <button
                data-testid="vendor-list-delivery"
                @click="$emit('update:deliveryOnly', true)"
              >
                delivery
              </button>
              <button
                data-testid="vendor-list-use-location"
                @click="$emit('useLocation')"
              >
                use location
              </button>
            </section>
          `,
        },
        MarketProductSearch: {
          props: [
            "marketId",
            "initialQuery",
            "initialCategory",
            "initialServiceType",
            "initialResultKind",
            "initialTakeaway",
            "initialDelivery",
            "initialSortBy",
            "initialLat",
            "initialLng",
            "initialRadiusKm",
          ],
          emits: [
            "select",
            "takeaway",
            "selectService",
            "selectVendor",
            "selectVendorServices",
            "searchStateChange",
          ],
          template: `
            <section data-testid="market-product-search">
              <div data-testid="market-product-search-props">
                {{ initialQuery }}|{{ initialCategory }}|{{ initialServiceType }}|{{ initialResultKind }}|{{ initialTakeaway }}|{{ initialDelivery }}|{{ initialSortBy }}|{{ initialLat }}|{{ initialLng }}|{{ initialRadiusKm }}
              </div>
              <button
                data-testid="select-dish"
                @click="$emit('select', {
                  menuItemId: 42,
                  dishName: '章魚燒',
                  price: 80,
                  categoryName: '小吃',
                  restaurantId: 'restaurant-1',
                  restaurantName: '章魚燒攤',
                  district: '西屯區',
                  isOpen: true,
                  supportsTakeaway: true,
                  supportsDelivery: false,
                  tags: []
                })"
              >
                open dish
              </button>
              <button
                data-testid="takeaway-dish"
                @click="$emit('takeaway', {
                  menuItemId: 42,
                  dishName: '章魚燒',
                  price: 80,
                  categoryName: '小吃',
                  restaurantId: 'restaurant-1',
                  restaurantName: '章魚燒攤',
                  district: '西屯區',
                  isOpen: true,
                  supportsTakeaway: true,
                  supportsDelivery: false,
                  tags: []
                })"
              >
                takeaway dish
              </button>
              <button
                data-testid="select-service"
                @click="$emit('selectService', {
                  serviceItemId: 7,
                  name: '代客切水果',
                  description: '現場代切並分裝',
                  serviceType: 'general',
                  priceCents: 3000,
                  priceLabel: null,
                  durationMinutes: null,
                  requiresBooking: false,
                  bookingUrl: null,
                  tags: [],
                  restaurantId: 'service-restaurant-1',
                  restaurantName: '水果攤',
                  district: '西屯區',
                  city: '台中市',
                  isOpen: true
                })"
              >
                open service
              </button>
              <button
                data-testid="select-vendor-result"
                @click="$emit('selectVendor', {
                  restaurantId: 'vendor-restaurant-1',
                  name: '雞排攤',
                  type: 'market_stall',
                  district: '西屯區',
                  priceRange: null,
                  rating: null,
                  isOpen: true,
                  supportsTakeaway: true,
                  supportsDelivery: false,
                  imageUrl: null
                })"
              >
                open vendor result
              </button>
              <button
                data-testid="select-vendor-service-result"
                @click="$emit('selectVendorServices', {
                  restaurantId: 'vendor-restaurant-1',
                  name: '雞排攤',
                  type: 'market_stall',
                  district: '西屯區',
                  priceRange: null,
                  rating: null,
                  isOpen: true,
                  supportsTakeaway: true,
                  supportsDelivery: false,
                  imageUrl: null
                })"
              >
                open vendor service result
              </button>
              <button
                data-testid="sync-market-search"
                @click="$emit('searchStateChange', {
                  q: '雞排',
                  categoryName: '小吃',
                  serviceType: 'delivery',
                  resultKind: 'product',
                  takeaway: true,
                  delivery: true,
                  sortBy: 'popular',
                  lat: undefined,
                  lng: undefined,
                  radiusKm: undefined
                })"
              >
                sync search
              </button>
              <button
                data-testid="sync-distance-search"
                @click="$emit('searchStateChange', {
                  q: '',
                  categoryName: '',
                  serviceType: '',
                  resultKind: 'all',
                  takeaway: false,
                  delivery: false,
                  sortBy: 'distance',
                  lat: 24.1764,
                  lng: 120.6466,
                  radiusKm: 2
                })"
              >
                sync distance search
              </button>
            </section>
          `,
        },
      },
    },
  });
}

describe("MarketDetailView", () => {
  beforeEach(() => {
    clearCustomerAccessToken();
    localStorage.clear();
    setActivePinia(createPinia());
    routerPush.mockReset();
    routerReplace.mockReset();
    routerBack.mockReset();
    createMarketCheckout.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    vi.mocked(customerIdentityApi.listFavorites).mockReset();
    vi.mocked(customerIdentityApi.listFavorites).mockResolvedValue([]);
    vi.mocked(customerIdentityApi.addFavorite).mockReset();
    vi.mocked(customerIdentityApi.addFavorite).mockResolvedValue({
      id: 1,
      targetType: "market",
      targetId: "market-1",
      createdAtMs: Date.now(),
    });
    vi.mocked(customerIdentityApi.removeFavorite).mockReset();
    vi.mocked(customerIdentityApi.recordRecentMarket).mockReset();
    vi.mocked(customerIdentityApi.recordRecentMarket).mockResolvedValue({
      marketId: "market-1",
      visitedAtMs: Date.now(),
    });
    for (const key of Object.keys(routeQuery)) {
      delete routeQuery[key];
    }
    vi.mocked(useMarketsStore).mockReturnValue(marketStore() as never);
  });

  it("records recent market visits and toggles favorite markets", async () => {
    setCustomerAccessToken("customer-token");
    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(localStorage.getItem("makanmakan_recent_markets")).toContain(
        "fengjia",
      );
      expect(customerIdentityApi.recordRecentMarket).toHaveBeenCalledWith(
        expect.objectContaining({
          marketId: "market-1",
        }),
      );
    });

    await wrapper
      .get('[data-testid="market-favorite-toggle"]')
      .trigger("click");

    expect(localStorage.getItem("makanmakan_favorite_markets")).toContain(
      "fengjia",
    );
    expect(wrapper.get('[data-testid="market-favorite-toggle"]').text()).toBe(
      "markets.detail.following",
    );

    await wrapper
      .get('[data-testid="market-favorite-toggle"]')
      .trigger("click");

    expect(localStorage.getItem("makanmakan_favorite_markets")).toBe("[]");
    expect(wrapper.get('[data-testid="market-favorite-toggle"]').text()).toBe(
      "markets.detail.follow",
    );
  });

  it("opens vendors from the stall map", async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="stall-map-open-vendor"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "stall-map-restaurant" },
      query: {
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("blocks entry when a listed stall has not opened today", async () => {
    vi.mocked(discoveryApi.getTakeawayEligibility).mockResolvedValueOnce({
      eligible: true,
      shopQrCode: "SHOP-restaurant-1",
    });
    vi.mocked(useMarketsStore).mockReturnValue(
      marketStore({
        vendors: [{ restaurantId: "restaurant-1", isOpen: false }],
      }) as never,
    );
    const wrapper = mountView();

    await wrapper.get('[data-testid="open-market-vendor"]').trigger("click");
    await wrapper
      .get('[data-testid="open-market-vendor-services"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="takeaway-market-vendor"]')
      .trigger("click");

    expect(routerPush).not.toHaveBeenCalled();
    expect(discoveryApi.getTakeawayEligibility).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("markets.vendors.notOpenToday");
  });

  it("renders external market location map alongside the stall map", () => {
    vi.mocked(useMarketsStore).mockReturnValue(
      marketStore({
        selectedMarket: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          latitude: 24.1764,
          longitude: 120.6466,
        },
        vendors: [
          {
            restaurantId: "restaurant-1",
            name: "雞排攤",
            type: "market_stall",
            district: "西屯區",
            priceRange: null,
            rating: null,
            isOpen: true,
            supportsTakeaway: true,
            supportsDelivery: false,
            imageUrl: null,
            latitude: 24.1765,
            longitude: 120.6467,
            stallNumber: "A-01",
            isPrimary: true,
            availableMenuItemCount: 3,
            publicServiceItemCount: 1,
          },
        ],
      }) as never,
    );

    const wrapper = mountView();

    expect(wrapper.get('[data-testid="market-location-map"]').text()).toContain(
      "逢甲夜市|1",
    );
    expect(wrapper.find('[data-testid="stall-map"]').exists()).toBe(true);
  });

  it("shows a grouped market basket summary", () => {
    const cartStore = useMarketCartStore();
    cartStore.addItem({
      marketSlug: "fengjia",
      marketName: "逢甲夜市",
      restaurantId: "restaurant-1",
      restaurantName: "雞排攤",
      item: {
        id: 42,
        restaurantId: "restaurant-1",
        categoryId: 10,
        catalogType: "menu_item",
        name: "章魚燒",
        price: 80,
        spiceLevel: 0,
        sortOrder: 1,
        isAvailable: true,
        isFeatured: false,
        inventoryCount: null,
        orderCount: 0,
        createdAt: 1786_000_000_000,
        updatedAt: 1786_000_000_000,
      },
      quantity: 2,
    });

    const wrapper = mountView();

    const summary = wrapper.get('[data-testid="market-cart-summary"]');
    expect(summary.text()).toContain("markets.detail.cartTitle");
    expect(summary.text()).toContain("markets.detail.cartSummary:1,");
    expect(summary.text()).toContain("markets.detail.vendorItemCount:2");
    expect(summary.text()).toContain("章魚燒");
    expect(summary.text()).toContain("NT$160");
  });

  it("submits a multi-vendor market checkout from the basket", async () => {
    createMarketCheckout.mockResolvedValueOnce({
      checkout: {
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            tokenExpiresAt: "",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 102,
            orderNumber: "A002",
            totalAmount: 80,
            tokenExpiresAt: "",
          },
        ],
        subtotal: 240,
        createdAt: 1786_000_000_000,
      },
      childOrders: [],
    });
    const cartStore = useMarketCartStore();
    cartStore.addItem({
      marketSlug: "fengjia",
      marketName: "逢甲夜市",
      restaurantId: "restaurant-1",
      restaurantName: "雞排攤",
      item: {
        id: 42,
        restaurantId: "restaurant-1",
        categoryId: 10,
        catalogType: "menu_item",
        name: "章魚燒",
        price: 80,
        spiceLevel: 0,
        sortOrder: 1,
        isAvailable: true,
        isFeatured: false,
        inventoryCount: null,
        orderCount: 0,
        createdAt: 1786_000_000_000,
        updatedAt: 1786_000_000_000,
      },
      quantity: 2,
    });
    cartStore.addItem({
      marketSlug: "fengjia",
      marketName: "逢甲夜市",
      restaurantId: "restaurant-2",
      restaurantName: "甜點攤",
      item: {
        id: 43,
        restaurantId: "restaurant-2",
        categoryId: 11,
        catalogType: "menu_item",
        name: "豆花",
        price: 80,
        spiceLevel: 0,
        sortOrder: 1,
        isAvailable: true,
        isFeatured: false,
        inventoryCount: null,
        orderCount: 0,
        createdAt: 1786_000_000_000,
        updatedAt: 1786_000_000_000,
      },
      quantity: 1,
    });

    const wrapper = mountView();
    await wrapper.get('[data-testid="market-checkout-phone"]').setValue("789");
    await wrapper
      .get('[data-testid="market-checkout-submit"]')
      .trigger("click");

    expect(createMarketCheckout).toHaveBeenCalledWith({
      marketSlug: "fengjia",
      guestName: "Guest",
      phoneLastDigits: "789",
      vendors: [
        {
          restaurantId: "restaurant-1",
          items: [
            {
              menuItemId: 42,
              quantity: 2,
              customizations: undefined,
              notes: undefined,
            },
          ],
        },
        {
          restaurantId: "restaurant-2",
          items: [
            {
              menuItemId: 43,
              quantity: 1,
              customizations: undefined,
              notes: undefined,
            },
          ],
        },
      ],
    });
    await vi.waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith({
        name: "MarketCheckoutTracking",
        params: {
          slug: "fengjia",
          checkoutId: "checkout-1",
        },
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith("markets.detail.checkoutSuccess");
    expect(cartStore.cartForMarket("fengjia")).toBeNull();
  });

  it("removes only stalls named by a not-open-today checkout error", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost");
    const { ApiException } = await import("@/services/api");
    vi.unstubAllEnvs();
    const cartStore = useMarketCartStore();
    for (const [restaurantId, id] of [
      ["restaurant-1", 42],
      ["restaurant-2", 43],
    ] as const) {
      cartStore.addItem({
        marketSlug: "fengjia",
        marketName: "逢甲夜市",
        restaurantId,
        restaurantName: restaurantId,
        item: {
          id,
          restaurantId,
          categoryId: 10,
          catalogType: "menu_item",
          name: "章魚燒",
          price: 80,
          spiceLevel: 0,
          sortOrder: 1,
          isAvailable: true,
          isFeatured: false,
          inventoryCount: null,
          orderCount: 0,
          createdAt: 1786_000_000_000,
          updatedAt: 1786_000_000_000,
        },
        quantity: 1,
      });
    }
    createMarketCheckout.mockRejectedValueOnce(
      new ApiException(
        "VENDOR_NOT_OPEN_TODAY",
        "Some vendors are not open today",
        { restaurantIds: ["restaurant-1"] },
        409,
      ),
    );
    const wrapper = mountView();
    await wrapper.get('[data-testid="market-checkout-phone"]').setValue("789");
    await wrapper
      .get('[data-testid="market-checkout-submit"]')
      .trigger("click");

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "markets.detail.vendorNotOpenToday",
      );
    });
    expect(
      cartStore.cartForMarket("fengjia")?.vendors.map((v) => v.restaurantId),
    ).toEqual(["restaurant-2"]);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("passes shareable query state into market product search", () => {
    routeQuery.q = "雞排";
    routeQuery.categoryName = "小吃";
    routeQuery.serviceType = "delivery";
    routeQuery.resultKind = "product";
    routeQuery.takeaway = "true";
    routeQuery.delivery = "true";
    routeQuery.sortBy = "popular";

    const wrapper = mountView();

    expect(
      wrapper.get('[data-testid="market-product-search-props"]').text(),
    ).toContain("雞排|小吃|delivery|product|true|true|popular|||");
  });

  it("restores shareable distance search coordinates from the URL", () => {
    routeQuery.sortBy = "distance";
    routeQuery.lat = "24.1764";
    routeQuery.lng = "120.6466";
    routeQuery.radiusKm = "2";

    const wrapper = mountView();

    expect(
      wrapper.get('[data-testid="market-product-search-props"]').text(),
    ).toContain("|||all|false|false|distance|24.1764|120.6466|2");
  });

  it("restores vendor-only market searches from the URL", () => {
    routeQuery.q = "B-12";
    routeQuery.resultKind = "vendor";

    const wrapper = mountView();

    expect(
      wrapper.get('[data-testid="market-product-search-props"]').text(),
    ).toContain("B-12|||vendor|false|false|relevance");
  });

  it("syncs market product search state into the URL", async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="sync-market-search"]').trigger("click");

    expect(routerReplace).toHaveBeenCalledWith({
      query: {
        q: "雞排",
        categoryName: "小吃",
        serviceType: "delivery",
        resultKind: "product",
        takeaway: "true",
        delivery: "true",
        sortBy: "popular",
      },
    });
  });

  it("syncs distance search coordinates into the URL", async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="sync-distance-search"]').trigger("click");

    expect(routerReplace).toHaveBeenCalledWith({
      query: {
        sortBy: "distance",
        lat: "24.1764",
        lng: "120.6466",
        radiusKm: "2",
      },
    });
  });

  it("renders market exploration shortcuts and applies them to product search", async () => {
    const wrapper = mountView();

    expect(
      wrapper.get('[data-testid="market-dish-facet-炸物"]').text(),
    ).toContain("炸物");
    expect(
      wrapper.get('[data-testid="market-product-facet-配件"]').text(),
    ).toContain("配件");
    expect(
      wrapper.get('[data-testid="market-service-facet-pickup"]').text(),
    ).toContain("markets.serviceType.pickup");

    await wrapper
      .get('[data-testid="market-dish-facet-炸物"]')
      .trigger("click");

    expect(
      wrapper.get('[data-testid="market-product-search-props"]').text(),
    ).toContain("|炸物||menu_item|false|false|relevance");
    expect(routerReplace).toHaveBeenLastCalledWith({
      query: {
        categoryName: "炸物",
        resultKind: "menu_item",
      },
    });

    await wrapper
      .get('[data-testid="market-service-facet-pickup"]')
      .trigger("click");

    expect(
      wrapper.get('[data-testid="market-product-search-props"]').text(),
    ).toContain("||pickup|service|false|false|relevance");
    expect(routerReplace).toHaveBeenLastCalledWith({
      query: {
        serviceType: "pickup",
        resultKind: "service",
      },
    });

    await wrapper
      .get('[data-testid="market-product-facet-配件"]')
      .trigger("click");

    expect(
      wrapper.get('[data-testid="market-product-search-props"]').text(),
    ).toContain("|配件||product|false|false|relevance");
    expect(routerReplace).toHaveBeenLastCalledWith({
      query: {
        categoryName: "配件",
        resultKind: "product",
      },
    });
  });

  it("shows a public setup notice for incomplete market detail pages", () => {
    vi.mocked(useMarketsStore).mockReturnValue(
      marketStore({
        selectedMarket: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          publicReadiness: {
            ready: false,
            score: 57,
            completedCount: 4,
            totalCount: 7,
            issues: [
              { key: "openingHours", severity: "required" },
              { key: "products", severity: "required" },
            ],
          },
        },
      }) as never,
    );

    const wrapper = mountView();

    const notice = wrapper.get(
      '[data-testid="market-public-readiness-notice"]',
    );
    expect(notice.text()).toContain("markets.detail.readinessTitle");
    expect(notice.text()).toContain("markets.detail.readinessDesc");
    expect(notice.text()).not.toContain("openingHours");
    expect(notice.text()).not.toContain("products");
  });

  it("shows a syncing notice when catalog coverage exists before shortcuts refresh", () => {
    vi.mocked(useMarketsStore).mockReturnValue(
      marketStore({
        selectedMarket: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          catalogCoverage: {
            searchableProductCount: 4,
            publicServiceCount: 2,
          },
        },
        explorationSummary: {
          dishSearchUrl: "/api/v1/discovery/search?marketSlug=fengjia",
          serviceSearchUrl: "/api/v1/discovery/services?marketSlug=fengjia",
          dishCategories: [],
          menuItemCategories: [],
          productCategories: [],
          serviceTypes: [],
        },
      }) as never,
    );

    const wrapper = mountView();

    const notice = wrapper.get('[data-testid="market-catalog-syncing-notice"]');
    expect(notice.text()).toContain("markets.detail.syncingTitle");
    expect(notice.text()).toContain("markets.detail.coverageProducts:4");
    expect(notice.text()).toContain("markets.detail.coverageServices:2");
  });

  it("preserves directory return context while syncing market search state", async () => {
    routeQuery.returnPath = "/markets?q=夜市&city=台中市";
    routeQuery.returnLabel = "夜市與商圈";
    const wrapper = mountView();

    await wrapper.get('[data-testid="sync-market-search"]').trigger("click");

    expect(routerReplace).toHaveBeenCalledWith({
      query: {
        q: "雞排",
        categoryName: "小吃",
        serviceType: "delivery",
        resultKind: "product",
        takeaway: "true",
        delivery: "true",
        sortBy: "popular",
        returnPath: "/markets?q=夜市&city=台中市",
        returnLabel: "夜市與商圈",
      },
    });
  });

  it("opens a market dish result in the shop menu with a stable item deep link", async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="select-dish"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        itemId: "42",
        categoryName: "小吃",
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("keeps market product filters in the shop menu return path", async () => {
    routeQuery.q = "雞排";
    routeQuery.categoryName = "小吃";
    routeQuery.resultKind = "menu_item";
    routeQuery.sortBy = "popular";
    const wrapper = mountView();

    await wrapper.get('[data-testid="select-dish"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        itemId: "42",
        categoryName: "小吃",
        returnPath:
          "/markets/fengjia?q=%E9%9B%9E%E6%8E%92&categoryName=%E5%B0%8F%E5%90%83&resultKind=menu_item&sortBy=popular",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("opens a market vendor in the shop menu with market return context", async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="open-market-vendor"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("keeps market vendor filters in the shop menu return path", async () => {
    routeQuery.vendorQ = "A-12";
    routeQuery.vendorDelivery = "true";
    routeQuery.vendorSortBy = "distance";
    routeQuery.vendorLat = "24.1764";
    routeQuery.vendorLng = "120.6466";
    routeQuery.vendorRadiusKm = "2";
    const wrapper = mountView();

    await wrapper.get('[data-testid="open-market-vendor"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        returnPath:
          "/markets/fengjia?vendorQ=A-12&vendorDelivery=true&vendorSortBy=distance&vendorLat=24.1764&vendorLng=120.6466&vendorRadiusKm=2",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("opens a market vendor service section in the shop menu", async () => {
    const wrapper = mountView();

    await wrapper
      .get('[data-testid="open-market-vendor-services"]')
      .trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        services: "true",
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("starts takeaway for a market dish result through the shop QR entry point", async () => {
    vi.mocked(discoveryApi.getTakeawayEligibility).mockResolvedValueOnce({
      eligible: true,
      shopQrCode: "SHOP-restaurant-1",
    });
    const wrapper = mountView();

    await wrapper.get('[data-testid="takeaway-dish"]').trigger("click");

    expect(discoveryApi.getTakeawayEligibility).toHaveBeenCalledWith(
      "restaurant-1",
    );
    expect(routerPush).toHaveBeenCalledWith({
      name: "OrderTypeLanding",
      params: { restaurantId: "restaurant-1" },
      query: {
        qr: "SHOP-restaurant-1",
        itemId: "42",
        categoryName: "小吃",
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("opens a market service result in the shop menu", async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="select-service"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "service-restaurant-1" },
      query: {
        serviceItemId: "7",
        services: "true",
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("keeps market service filters in the shop menu return path", async () => {
    routeQuery.serviceType = "pickup";
    routeQuery.resultKind = "service";
    routeQuery.sortBy = "open_now";
    const wrapper = mountView();

    await wrapper.get('[data-testid="select-service"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "service-restaurant-1" },
      query: {
        serviceItemId: "7",
        services: "true",
        returnPath:
          "/markets/fengjia?serviceType=pickup&resultKind=service&sortBy=open_now",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("opens a direct market vendor result in the shop menu", async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="select-vendor-result"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "vendor-restaurant-1" },
      query: {
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("opens a direct market vendor service result in the shop menu", async () => {
    const wrapper = mountView();

    await wrapper
      .get('[data-testid="select-vendor-service-result"]')
      .trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "vendor-restaurant-1" },
      query: {
        services: "true",
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("loads more market vendors without losing the active filters", async () => {
    const store = marketStore({
      hasMoreVendors: true,
      loadMoreVendors: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(useMarketsStore).mockReturnValue(store as never);
    const wrapper = mountView();

    await wrapper.get('[data-testid="vendor-list-load-more"]').trigger("click");

    expect(store.loadMoreVendors).toHaveBeenCalledWith("fengjia", {
      q: undefined,
      takeaway: undefined,
      delivery: undefined,
    });
    expect(wrapper.get('[data-testid="vendor-list-has-more"]').text()).toBe(
      "true",
    );
  });

  it("filters market vendors by delivery support", async () => {
    const store = marketStore();
    vi.mocked(useMarketsStore).mockReturnValue(store as never);
    const wrapper = mountView();

    await wrapper.get('[data-testid="vendor-list-delivery"]').trigger("click");

    expect(store.loadVendors).toHaveBeenCalledWith("fengjia", {
      q: undefined,
      takeaway: undefined,
      delivery: true,
    });
  });

  it("restores market vendor filters from the URL", async () => {
    routeQuery.vendorQ = "A-12";
    routeQuery.vendorDelivery = "true";
    routeQuery.vendorSortBy = "distance";
    routeQuery.vendorLat = "24.1764";
    routeQuery.vendorLng = "120.6466";
    routeQuery.vendorRadiusKm = "2";
    const store = marketStore();
    vi.mocked(useMarketsStore).mockReturnValue(store as never);

    mountView();

    await vi.waitFor(() => {
      expect(store.loadVendors).toHaveBeenCalledWith("fengjia", {
        q: "A-12",
        takeaway: undefined,
        delivery: true,
        sortBy: "distance",
        lat: 24.1764,
        lng: 120.6466,
        radiusKm: 2,
      });
    });
  });

  it("sorts market vendors by current distance", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) =>
          success({
            coords: {
              latitude: 24.1764,
              longitude: 120.6466,
            },
          }),
        ),
      },
    });
    const store = marketStore();
    vi.mocked(useMarketsStore).mockReturnValue(store as never);
    const wrapper = mountView();

    await wrapper
      .get('[data-testid="vendor-list-use-location"]')
      .trigger("click");

    expect(store.loadVendors).toHaveBeenCalledWith("fengjia", {
      q: undefined,
      takeaway: undefined,
      delivery: undefined,
      sortBy: "distance",
      lat: 24.1764,
      lng: 120.6466,
      radiusKm: 2,
    });
    expect(routerReplace).toHaveBeenCalledWith({
      query: {
        vendorSortBy: "distance",
        vendorLat: "24.1764",
        vendorLng: "120.6466",
        vendorRadiusKm: "2",
      },
    });
  });

  it("returns to the market directory context when provided", async () => {
    routeQuery.returnPath = "/markets?q=夜市&city=台中市";
    routeQuery.returnLabel = "夜市與商圈";
    const wrapper = mountView();

    await wrapper.get('[data-testid="market-detail-back"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith("/markets?q=夜市&city=台中市");
    expect(routerBack).not.toHaveBeenCalled();
  });

  it("ignores unsafe external return paths", async () => {
    routeQuery.returnPath = "https://example.com/phishing";
    routeQuery.returnLabel = "外部網站";
    const wrapper = mountView();

    await wrapper.get('[data-testid="market-detail-back"]').trigger("click");

    expect(routerPush).not.toHaveBeenCalled();
    expect(routerBack).toHaveBeenCalledTimes(1);
  });
});
