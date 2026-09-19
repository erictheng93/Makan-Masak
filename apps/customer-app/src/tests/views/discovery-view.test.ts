import { mount, RouterLinkStub } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveryView from "@/views/DiscoveryView.vue";
import { discoveryApi } from "@/services/discoveryApi";
import { marketsApi } from "@/services/marketsApi";
import { useDiscoveryStore } from "@/stores/discovery";

const routerPush = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());
const routeQuery = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("vue-router", () => ({
  useRoute: () => ({
    fullPath: "/discover?q=%E5%A4%96%E9%80%81",
    query: routeQuery,
  }),
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
  }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${params.count}`,
  }),
}));

// The fake keeps the real composable's distinction: `formatPrice` follows the
// bound currency source, `formatPriceIn` follows the row's own currency. A
// test can then see which one a list passes.
vi.mock("@/composables/useCurrency", () => ({
  useCurrency: (source?: () => unknown) => ({
    formatPrice: (amount: number) =>
      `${(source?.() as string) ?? "TWD"}${amount}`,
    formatPriceIn: (amount: number, currency?: string) =>
      `${currency ?? "TWD"}${amount}`,
  }),
}));

vi.mock("@/stores/discovery", () => ({
  useDiscoveryStore: vi.fn(),
}));

vi.mock("@/services/discoveryApi", () => ({
  discoveryApi: {
    getTakeawayEligibility: vi.fn(),
    listCategories: vi.fn(),
    listServiceTypes: vi.fn(),
  },
}));

vi.mock("@/services/marketsApi", () => ({
  marketsApi: {
    listMarkets: vi.fn(),
    listAreas: vi.fn(),
    getMarket: vi.fn(),
  },
}));

function dish() {
  return {
    menuItemId: 42,
    dishName: "章魚燒",
    price: 80,
    categoryName: "小吃",
    restaurantId: "restaurant-1",
    restaurantName: "章魚燒攤",
    district: "西屯區",
    isOpen: true,
    supportsTakeaway: true,
    supportsDelivery: false,
    tags: [],
  };
}

function discoveryStore(overrides: Record<string, unknown> = {}) {
  return {
    searchQuery: "章魚燒",
    popularKeywords: [],
    filters: {},
    loading: false,
    error: null,
    isSearchMode: true,
    dishResults: [dish()],
    serviceResults: [],
    restaurantResults: [],
    popularDishes: [],
    popularRestaurants: [],
    hasResults: true,
    total: 1,
    searchDishes: vi.fn(),
    clearSearch: vi.fn(),
    updateFilters: vi.fn(),
    loadPopular: vi.fn(),
    browseRestaurants: vi.fn(),
    ...overrides,
  };
}

function mountView() {
  return mount(DiscoveryView, {
    global: {
      stubs: {
        SearchBar: true,
        FilterPanel: {
          props: ["cities", "districts", "categories", "serviceTypes"],
          template: `
            <div>
              <div data-testid="city-filter-options">{{ cities.join(",") }}</div>
              <div data-testid="district-filter-options">{{ districts.join(",") }}</div>
              <div data-testid="category-filter-options">{{ categories.join(",") }}</div>
              <div data-testid="service-type-filter-options">
                {{ serviceTypes.map((facet) => facet.serviceType + ':' + facet.count).join(',') }}
              </div>
            </div>
          `,
        },
        DishResultCard: {
          props: ["dish"],
          emits: ["select", "takeaway"],
          template: `
            <article>
              <button data-testid="select-dish" @click="$emit('select', dish)">
                select dish
              </button>
              <button
                data-testid="takeaway-dish"
                @click="$emit('takeaway', dish)"
              >
                takeaway dish
              </button>
            </article>
          `,
        },
        RestaurantCard: true,
        RouterLink: RouterLinkStub,
      },
    },
  });
}

describe("DiscoveryView", () => {
  beforeEach(() => {
    routerPush.mockReset();
    routerReplace.mockReset();
    for (const key of Object.keys(routeQuery)) {
      delete routeQuery[key];
    }
    vi.mocked(marketsApi.listMarkets).mockResolvedValue({
      markets: [],
      total: 0,
      page: 1,
      limit: 20,
    } as never);
    vi.mocked(marketsApi.listAreas).mockResolvedValue({
      areas: [],
    } as never);
    vi.mocked(marketsApi.getMarket).mockResolvedValue({
      market: {
        id: "market-1",
        slug: "fengjia",
        name: "逢甲夜市",
      },
      vendorCount: 1,
    } as never);
    vi.mocked(discoveryApi.listCategories).mockResolvedValue({
      categories: [],
    } as never);
    vi.mocked(discoveryApi.listServiceTypes).mockResolvedValue({
      serviceTypes: [],
    } as never);
    vi.mocked(useDiscoveryStore).mockReturnValue(discoveryStore() as never);
  });

  it("opens a dish result in the shop menu with a stable item deep link", async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="select-dish"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        itemId: "42",
        categoryName: "小吃",
        returnPath: "/discover?q=%E5%A4%96%E9%80%81",
        returnLabel: "搜尋結果",
      },
    });
  });

  it("uses the selected market name as shop menu return context", async () => {
    vi.mocked(marketsApi.listMarkets).mockResolvedValueOnce({
      markets: [
        {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    } as never);
    const store = discoveryStore({
      filters: { marketId: "market-1" },
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);
    const wrapper = mountView();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("逢甲夜市");
    });
    await wrapper.get('[data-testid="select-dish"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        itemId: "42",
        categoryName: "小吃",
        returnPath: "/discover?q=%E5%A4%96%E9%80%81",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("uses the selected market slug as shop menu return context", async () => {
    vi.mocked(marketsApi.listMarkets).mockResolvedValueOnce({
      markets: [
        {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    } as never);
    const store = discoveryStore({
      filters: { marketSlug: "fengjia" },
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);
    const wrapper = mountView();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("逢甲夜市");
    });
    await wrapper.get('[data-testid="select-dish"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        itemId: "42",
        categoryName: "小吃",
        returnPath: "/discover?q=%E5%A4%96%E9%80%81",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("loads a selected market slug that is outside the first market options", async () => {
    routeQuery.marketSlug = "miaokou";
    vi.mocked(marketsApi.listMarkets).mockResolvedValueOnce({
      markets: [],
      total: 0,
      page: 1,
      limit: 20,
    } as never);
    vi.mocked(marketsApi.getMarket).mockResolvedValueOnce({
      market: {
        id: "market-2",
        slug: "miaokou",
        name: "基隆廟口夜市",
      },
      vendorCount: 12,
    } as never);
    const store = discoveryStore({
      searchQuery: "",
      filters: {},
      searchDishes: vi.fn(),
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);
    const wrapper = mountView();

    await vi.waitFor(() => {
      expect(marketsApi.getMarket).toHaveBeenCalledWith("miaokou");
      expect(wrapper.text()).toContain("基隆廟口夜市");
    });
    await wrapper.get('[data-testid="select-dish"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        itemId: "42",
        categoryName: "小吃",
        returnPath: "/discover?q=%E5%A4%96%E9%80%81",
        returnLabel: "基隆廟口夜市",
      },
    });
  });

  it("starts takeaway for a dish result with the item deep link preserved", async () => {
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
      query: { qr: "SHOP-restaurant-1", itemId: "42", categoryName: "小吃" },
    });
  });

  it("opens a service result in the shop menu with a stable service deep link", async () => {
    const store = discoveryStore({
      dishResults: [],
      serviceResults: [
        {
          serviceItemId: 7,
          name: "代客切水果",
          description: "現場代切並分裝",
          serviceType: "general",
          priceCents: 3000,
          priceLabel: null,
          durationMinutes: null,
          requiresBooking: false,
          bookingUrl: null,
          tags: ["水果"],
          restaurantId: "service-restaurant-1",
          restaurantName: "水果攤",
          district: "西屯區",
          city: "台中市",
          isOpen: true,
          marketVendor: {
            marketId: "market-1",
            stallNumber: "S-12",
            isPrimary: true,
          },
        },
      ],
      total: 1,
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);
    const wrapper = mountView();

    expect(wrapper.text()).toContain("代客切水果");
    expect(wrapper.text()).toContain("攤位 S-12");
    expect(wrapper.get('[data-testid="select-service"]').text()).toContain(
      "查看服務",
    );
    await wrapper.get('[data-testid="select-service"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "service-restaurant-1" },
      query: {
        serviceItemId: "7",
        services: "true",
        returnPath: "/discover?q=%E5%A4%96%E9%80%81",
        returnLabel: "搜尋結果",
      },
    });
  });

  // A service list spans restaurants, so each row is priced in its own
  // restaurant's currency rather than in one currency for the whole page.
  it("prices each service result in its own restaurant's currency", async () => {
    const baseService = {
      name: "代客切水果",
      description: "現場代切並分裝",
      serviceType: "general",
      priceCents: 3000,
      priceLabel: null,
      durationMinutes: null,
      requiresBooking: false,
      bookingUrl: null,
      tags: [],
      restaurantName: "水果攤",
      district: "西屯區",
      city: "台中市",
      isOpen: true,
    };
    const store = discoveryStore({
      dishResults: [],
      serviceResults: [
        {
          ...baseService,
          serviceItemId: 7,
          restaurantId: "service-myr",
          currency: "MYR",
        },
        {
          ...baseService,
          serviceItemId: 8,
          restaurantId: "service-plain",
        },
      ],
      total: 2,
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    const wrapper = mountView();
    await wrapper.vm.$nextTick();

    const text = wrapper.text();
    expect(text).toContain("MYR30");
    expect(text).toContain("TWD30");
  });

  it("opens bookable service search results in the site booking flow", async () => {
    const store = discoveryStore({
      dishResults: [],
      serviceResults: [
        {
          serviceItemId: 7,
          name: "代客切水果",
          description: "現場代切並分裝",
          serviceType: "booking",
          priceCents: 3000,
          priceLabel: null,
          durationMinutes: null,
          requiresBooking: true,
          bookingUrl: "https://booking.example/service-7",
          tags: ["水果"],
          restaurantId: "service-restaurant-1",
          restaurantName: "水果攤",
          district: "西屯區",
          city: "台中市",
          isOpen: true,
        },
      ],
      total: 1,
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    const wrapper = mountView();

    const bookingButton = wrapper.get(
      '[data-testid="discovery-service-booking"]',
    );
    expect(bookingButton.text()).toContain("直接預約");
    await bookingButton.trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ServiceBooking",
      params: {
        restaurantId: "service-restaurant-1",
        serviceItemId: "7",
      },
    });
    expect(wrapper.get('[data-testid="select-service"]').text()).toContain(
      "查看服務",
    );
  });

  it("shows an external booking link for service results without in-app booking", async () => {
    const store = discoveryStore({
      dishResults: [],
      serviceResults: [
        {
          serviceItemId: 7,
          name: "代客切水果",
          description: "現場代切並分裝",
          serviceType: "general",
          priceCents: 3000,
          priceLabel: null,
          durationMinutes: null,
          requiresBooking: false,
          bookingUrl: "https://booking.example/service-7",
          tags: ["水果"],
          restaurantId: "service-restaurant-1",
          restaurantName: "水果攤",
          district: "西屯區",
          city: "台中市",
          isOpen: true,
        },
      ],
      total: 1,
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    const wrapper = mountView();

    const bookingLink = wrapper.get(
      '[data-testid="discovery-service-booking-url"]',
    );
    expect(bookingLink.text()).toContain("開啟預約");
    expect(bookingLink.attributes("href")).toBe(
      "https://booking.example/service-7",
    );
    expect(bookingLink.attributes("target")).toBe("_blank");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("uses the selected market name when opening a service result", async () => {
    vi.mocked(marketsApi.listMarkets).mockResolvedValueOnce({
      markets: [
        {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    } as never);
    const store = discoveryStore({
      filters: { marketId: "market-1", serviceType: "pickup" },
      dishResults: [],
      serviceResults: [
        {
          serviceItemId: 7,
          name: "代客切水果",
          description: "現場代切並分裝",
          serviceType: "pickup",
          priceCents: 3000,
          priceLabel: null,
          durationMinutes: null,
          requiresBooking: false,
          bookingUrl: null,
          tags: ["水果"],
          restaurantId: "service-restaurant-1",
          restaurantName: "水果攤",
          district: "西屯區",
          city: "台中市",
          isOpen: true,
        },
      ],
      total: 1,
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);
    const wrapper = mountView();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("逢甲夜市");
    });
    await wrapper.get('[data-testid="select-service"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "service-restaurant-1" },
      query: {
        serviceItemId: "7",
        services: "true",
        returnPath: "/discover?q=%E5%A4%96%E9%80%81",
        returnLabel: "逢甲夜市",
      },
    });
  });

  it("lets customers scope discovery searches to a market slug", async () => {
    vi.mocked(marketsApi.listMarkets).mockResolvedValueOnce({
      markets: [
        {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    } as never);
    const store = discoveryStore({
      filters: {},
      updateFilters: vi.fn(),
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("逢甲夜市");
    });
    await wrapper.get('[data-testid="discovery-market-chip"]').trigger("click");

    expect(store.updateFilters).toHaveBeenCalledWith({
      marketId: undefined,
      marketSlug: "fengjia",
    });
    expect(routerReplace).toHaveBeenCalledWith({
      query: { marketSlug: "fengjia", q: "章魚燒" },
    });
  });

  it("links from discovery market chips to the full market directory", async () => {
    vi.mocked(marketsApi.listMarkets).mockResolvedValueOnce({
      markets: [
        {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    } as never);
    vi.mocked(useDiscoveryStore).mockReturnValue(discoveryStore() as never);

    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("逢甲夜市");
    });

    const link = wrapper.get('[data-testid="discovery-market-directory-link"]');
    expect(link.text()).toContain("查看全部夜市與商圈");
    expect(
      wrapper
        .findAllComponents(RouterLinkStub)
        .some((routerLink) => routerLink.props("to") === "/markets"),
    ).toBe(true);
  });

  it("initializes a shareable search from the URL query", () => {
    routeQuery.q = "外送";
    routeQuery.marketId = "market-1";
    routeQuery.categoryName = "小吃";
    routeQuery.serviceType = "delivery";
    routeQuery.takeaway = "true";
    const store = discoveryStore({
      searchQuery: "",
      filters: {},
      searchDishes: vi.fn(),
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    mountView();

    expect(store.filters).toEqual({
      marketId: "market-1",
      categoryName: "小吃",
      serviceType: "delivery",
      takeaway: true,
    });
    expect(store.searchQuery).toBe("外送");
    expect(store.searchDishes).toHaveBeenCalledWith("外送");
    expect(store.browseRestaurants).not.toHaveBeenCalled();
  });

  it("initializes a shareable search from a market slug URL query", async () => {
    routeQuery.q = "外送";
    routeQuery.marketSlug = "fengjia";
    const store = discoveryStore({
      searchQuery: "",
      filters: {},
      searchDishes: vi.fn(),
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    mountView();

    expect(store.filters).toEqual({ marketSlug: "fengjia" });
    expect(store.searchQuery).toBe("外送");
    expect(store.searchDishes).toHaveBeenCalledWith("外送");
    await vi.waitFor(() => {
      expect(discoveryApi.listCategories).toHaveBeenCalledWith({
        city: undefined,
        district: undefined,
        marketId: undefined,
        marketSlug: "fengjia",
        takeaway: undefined,
        delivery: undefined,
      });
    });
    expect(discoveryApi.listServiceTypes).toHaveBeenCalledWith({
      city: undefined,
      district: undefined,
      marketId: undefined,
      marketSlug: "fengjia",
      takeaway: undefined,
      delivery: undefined,
    });
  });

  it("searches service results from a URL query that only has a service type", () => {
    routeQuery.serviceType = "delivery";
    const store = discoveryStore({
      searchQuery: "",
      filters: {},
      searchDishes: vi.fn(),
      browseRestaurants: vi.fn(),
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    mountView();

    expect(store.filters).toEqual({ serviceType: "delivery" });
    expect(store.searchDishes).toHaveBeenCalledWith("");
    expect(store.browseRestaurants).not.toHaveBeenCalled();
  });

  it("syncs text searches into the URL query", async () => {
    const searchDishes = vi.fn();
    const store = discoveryStore({
      searchQuery: "章魚燒",
      filters: { marketId: "market-1", serviceType: "delivery" },
      searchDishes,
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    const wrapper = mountView();

    wrapper.getComponent({ name: "SearchBar" }).vm.$emit("search", "外送");

    expect(searchDishes).toHaveBeenCalledWith("外送");
    expect(routerReplace).toHaveBeenCalledWith({
      query: {
        marketId: "market-1",
        serviceType: "delivery",
        q: "外送",
      },
    });
  });

  it("builds city and district filters from public market areas", async () => {
    vi.mocked(marketsApi.listAreas).mockResolvedValueOnce({
      areas: [
        { city: "台中市", districts: ["西屯區", "北區"] },
        { city: "台北市", districts: ["萬華區"] },
      ],
    } as never);

    const wrapper = mountView();

    await vi.waitFor(() => {
      expect(
        wrapper.get('[data-testid="city-filter-options"]').text(),
      ).toContain("台北市");
      expect(
        wrapper.get('[data-testid="district-filter-options"]').text(),
      ).toContain("萬華區");
    });
    expect(
      wrapper.get('[data-testid="district-filter-options"]').text(),
    ).toContain("西屯區");
  });

  it("loads category filters with the selected market scope", async () => {
    vi.mocked(discoveryApi.listCategories).mockResolvedValueOnce({
      categories: ["小吃", "飲品"],
    } as never);
    const store = discoveryStore({
      filters: { marketId: "market-1" },
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    const wrapper = mountView();

    await vi.waitFor(() => {
      expect(
        wrapper.get('[data-testid="category-filter-options"]').text(),
      ).toContain("飲品");
    });
    expect(discoveryApi.listCategories).toHaveBeenCalledWith({
      city: undefined,
      district: undefined,
      marketId: "market-1",
      takeaway: undefined,
      delivery: undefined,
    });
  });

  it("loads category filters with the selected market slug scope", async () => {
    vi.mocked(discoveryApi.listCategories).mockResolvedValueOnce({
      categories: ["小吃", "飲品"],
    } as never);
    const store = discoveryStore({
      filters: { marketSlug: "fengjia" },
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    const wrapper = mountView();

    await vi.waitFor(() => {
      expect(
        wrapper.get('[data-testid="category-filter-options"]').text(),
      ).toContain("飲品");
    });
    expect(discoveryApi.listCategories).toHaveBeenCalledWith({
      city: undefined,
      district: undefined,
      marketId: undefined,
      marketSlug: "fengjia",
      takeaway: undefined,
      delivery: undefined,
    });
  });

  it("loads service type filters with the selected market scope", async () => {
    vi.mocked(discoveryApi.listServiceTypes).mockResolvedValueOnce({
      serviceTypes: [
        { serviceType: "delivery", count: 2 },
        { serviceType: "booking", count: 1 },
      ],
    } as never);
    const store = discoveryStore({
      filters: { marketId: "market-1" },
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    const wrapper = mountView();

    await vi.waitFor(() => {
      expect(
        wrapper.get('[data-testid="service-type-filter-options"]').text(),
      ).toContain("delivery:2");
    });
    expect(discoveryApi.listServiceTypes).toHaveBeenCalledWith({
      city: undefined,
      district: undefined,
      marketId: "market-1",
      takeaway: undefined,
      delivery: undefined,
    });
  });

  it("loads service type filters with selected fulfillment filters", async () => {
    vi.mocked(discoveryApi.listServiceTypes).mockResolvedValueOnce({
      serviceTypes: [{ serviceType: "delivery", count: 1 }],
    } as never);
    const store = discoveryStore({
      filters: {
        marketId: "market-1",
        takeaway: true,
        delivery: true,
      },
    });
    vi.mocked(useDiscoveryStore).mockReturnValue(store as never);

    mountView();

    await vi.waitFor(() => {
      expect(discoveryApi.listServiceTypes).toHaveBeenCalledWith({
        city: undefined,
        district: undefined,
        marketId: "market-1",
        takeaway: true,
        delivery: true,
      });
    });
  });
});
