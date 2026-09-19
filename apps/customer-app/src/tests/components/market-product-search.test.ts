import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import MarketProductSearch from "@/components/markets/MarketProductSearch.vue";
import {
  discoveryApi,
  type DishSearchResult,
  type RestaurantListItem,
  type ServiceSearchResult,
} from "@/services/discoveryApi";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPush,
  }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
    currentLanguage: ref("zh-TW"),
  }),
}));

vi.mock("vue-i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key,
      tWithParams: (key: string, params: Record<string, unknown>) =>
        `${key}:${Object.values(params).join(",")}`,
      currentLanguage: ref("zh-TW"),
    }),
  };
});

// `formatPrice` follows the bound source, `formatPriceIn` the row's own
// currency — the same split as the real composable, so a test can see which
// one a list of several vendors uses.
vi.mock("@/composables/useCurrency", () => ({
  useCurrency: (source?: () => unknown) => ({
    formatPrice: (value: number) => `${(source?.() as string) ?? "$"}${value}`,
    formatPriceIn: (value: number, currency?: string) =>
      `${currency ?? "TWD"}${value}`,
  }),
}));

vi.mock("@/services/discoveryApi", () => ({
  discoveryApi: {
    searchDishes: vi.fn(),
    searchServices: vi.fn(),
    browseRestaurants: vi.fn(),
    listCategories: vi.fn(),
    listServiceTypes: vi.fn(),
  },
}));

describe("MarketProductSearch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });
    vi.mocked(discoveryApi.searchDishes).mockResolvedValue({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.listCategories).mockResolvedValue({
      categories: [],
    } as never);
    vi.mocked(discoveryApi.listServiceTypes).mockResolvedValue({
      serviceTypes: [],
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValue({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.browseRestaurants).mockResolvedValue({
      results: [],
      total: 0,
    } as never);
  });

  function dish(overrides: Partial<DishSearchResult> = {}): DishSearchResult {
    return {
      menuItemId: 1,
      dishName: "章魚燒",
      price: 80,
      categoryName: "小吃",
      restaurantId: "r1",
      restaurantName: "一中章魚燒",
      district: "北區",
      isOpen: true,
      supportsTakeaway: true,
      supportsDelivery: false,
      tags: ["熱門"],
      marketVendor: null,
      ...overrides,
    };
  }

  function service(
    overrides: Partial<ServiceSearchResult> = {},
  ): ServiceSearchResult {
    return {
      serviceItemId: 10,
      name: "代客切水果",
      description: "現場代切並分裝",
      serviceType: "general",
      priceCents: 3000,
      priceLabel: null,
      durationMinutes: null,
      requiresBooking: false,
      bookingUrl: null,
      tags: ["水果"],
      restaurantId: "service-r1",
      restaurantName: "水果攤",
      district: "西屯區",
      city: "台中市",
      isOpen: true,
      marketVendor: null,
      ...overrides,
    };
  }

  function restaurant(
    overrides: Partial<RestaurantListItem> = {},
  ): RestaurantListItem {
    return {
      restaurantId: "vendor-r1",
      name: "雞排攤",
      type: "market_stall",
      district: "西屯區",
      priceRange: null,
      rating: null,
      isOpen: true,
      supportsTakeaway: true,
      supportsDelivery: false,
      imageUrl: null,
      marketVendor: {
        marketId: "market-1",
        stallNumber: "B-12",
        isPrimary: true,
      },
      ...overrides,
    };
  }

  // A market's vendors are separate restaurants, so service prices are
  // labelled per row rather than with one currency for the whole market.
  it("prices each service result in its own vendor's currency", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [
        service({
          serviceItemId: 11,
          restaurantId: "vendor-myr",
          currency: "MYR",
        } as never),
        service({ serviceItemId: 12, restaurantId: "vendor-plain" }),
      ],
      total: 2,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: { marketId: "market-1", categories: ["小吃"], autoLoad: false },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("切水果");
    await wrapper.get("form").trigger("submit.prevent");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("MYR30");
      expect(wrapper.text()).toContain("TWD30");
    });
  });

  it("searches products within the selected market", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [dish()],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        categories: ["小吃", "飲品"],
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("章魚燒");
    await wrapper
      .get('[data-testid="market-product-category-select"]')
      .setValue("小吃");
    await wrapper
      .get('[data-testid="market-product-sort-select"]')
      .setValue("popular");
    await wrapper.get("form").trigger("submit.prevent");

    await vi.waitFor(() => {
      expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
        q: "章魚燒",
        marketId: "market-1",
        categoryName: "小吃",
        sortBy: "popular",
        takeaway: undefined,
        page: 1,
        limit: 20,
      });
    });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("章魚燒");
      expect(wrapper.text()).toContain("一中章魚燒");
    });

    const openMenuButton = wrapper.get('[data-testid="dish-result-open-menu"]');
    expect(openMenuButton.text()).toContain("查看菜單");

    await openMenuButton.trigger("click");

    expect(wrapper.emitted("select")?.[0][0]).toMatchObject({
      menuItemId: 1,
      restaurantId: "r1",
      dishName: "章魚燒",
    });
  });

  it("makes vendor and stall searches visible in market results", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [
        dish({
          dishName: "招牌甜甜圈",
          restaurantName: "甜點攤",
          marketVendor: {
            marketId: "market-1",
            stallNumber: "D-22",
            isPrimary: true,
          },
        }),
      ],
      total: 1,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [
        service({
          name: "代客切水果",
          restaurantName: "水果攤",
          marketVendor: {
            marketId: "market-1",
            stallNumber: "S-12",
            isPrimary: false,
          },
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        categories: ["小吃"],
        autoLoad: false,
      },
    });

    expect(
      wrapper.get('[data-testid="market-product-search-title"]').text(),
    ).toContain("markets.search.title");
    expect(
      wrapper
        .get<HTMLInputElement>('[data-testid="market-product-search-input"]')
        .attributes("placeholder"),
    ).toContain("markets.search.placeholder");

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("D-22");
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchDishes).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "D-22",
        marketId: "market-1",
      }),
    );
    expect(discoveryApi.searchServices).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "D-22",
        marketId: "market-1",
      }),
    );
    expect(wrapper.text()).toContain("甜點攤");
    expect(wrapper.text()).toContain("攤位 D-22");
    expect(wrapper.text()).toContain("水果攤");
    expect(wrapper.text()).toContain("markets.common.stallWithNumber:S-12");
  });

  it("keeps keyword searches on relevance ordering by default", async () => {
    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("雞排");
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
      q: "雞排",
      marketId: "market-1",
      categoryName: undefined,
      takeaway: undefined,
      page: 1,
      limit: 20,
    });
    expect(discoveryApi.searchServices).toHaveBeenCalledWith({
      q: "雞排",
      marketId: "market-1",
      serviceType: undefined,
      page: 1,
      limit: 20,
    });
  });

  it("renders direct vendor results in market search", async () => {
    vi.mocked(discoveryApi.browseRestaurants).mockResolvedValueOnce({
      results: [
        restaurant({
          availableMenuItemCount: 3,
          publicServiceItemCount: 2,
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("B-12");
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.browseRestaurants).toHaveBeenCalledWith({
      q: "B-12",
      marketId: "market-1",
      sortBy: "popular",
      takeaway: undefined,
      page: 1,
      limit: 20,
    });
    expect(wrapper.text()).toContain("雞排攤");
    expect(wrapper.text()).toContain("markets.common.stallWithNumber:B-12");
    expect(
      wrapper.get('[data-testid="vendor-result-access"]').text(),
    ).toContain("markets.common.menuItemCount:3");
    expect(
      wrapper.get('[data-testid="vendor-result-access"]').text(),
    ).toContain("markets.common.serviceCount:2");
    expect(wrapper.get('[data-testid="vendor-result-open-menu"]').text()).toBe(
      "markets.common.viewMenu",
    );
    expect(
      wrapper.get('[data-testid="vendor-result-open-services"]').text(),
    ).toBe("markets.common.viewServices");

    await wrapper
      .get('[data-testid="vendor-result-open-menu"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="vendor-result-open-services"]')
      .trigger("click");

    expect(wrapper.emitted("selectVendor")?.[0][0]).toMatchObject({
      restaurantId: "vendor-r1",
      name: "雞排攤",
    });
    expect(wrapper.emitted("selectVendorServices")?.[0][0]).toMatchObject({
      restaurantId: "vendor-r1",
      name: "雞排攤",
    });
  });

  it("disables direct vendor service links when no public services are available", async () => {
    vi.mocked(discoveryApi.browseRestaurants).mockResolvedValueOnce({
      results: [
        restaurant({
          availableMenuItemCount: 1,
          publicServiceItemCount: 0,
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("B-12");
    await wrapper.get("form").trigger("submit.prevent");

    expect(
      wrapper.get('[data-testid="vendor-result-access"]').text(),
    ).toContain("markets.common.noServices");

    const servicesButton = wrapper.get(
      '[data-testid="vendor-result-open-services"]',
    );
    expect(servicesButton.attributes("disabled")).toBeDefined();

    await servicesButton.trigger("click");

    expect(wrapper.emitted("selectVendorServices")).toBeUndefined();
  });

  it("disables direct vendor menu links when no menu items are available", async () => {
    vi.mocked(discoveryApi.browseRestaurants).mockResolvedValueOnce({
      results: [
        restaurant({
          availableMenuItemCount: 0,
          publicServiceItemCount: 2,
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("B-12");
    await wrapper.get("form").trigger("submit.prevent");

    expect(
      wrapper.get('[data-testid="vendor-result-access"]').text(),
    ).toContain("markets.common.noMenuItems");

    const menuButton = wrapper.get('[data-testid="vendor-result-open-menu"]');
    expect(menuButton.attributes("disabled")).toBeDefined();

    await menuButton.trigger("click");
    await wrapper
      .get('[data-testid="vendor-result-open-services"]')
      .trigger("click");

    expect(wrapper.emitted("selectVendor")).toBeUndefined();
    expect(wrapper.emitted("selectVendorServices")?.[0][0]).toMatchObject({
      restaurantId: "vendor-r1",
      name: "雞排攤",
    });
  });

  it("uses initial filters for shareable market service searches", async () => {
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [service({ name: "分享外送", serviceType: "delivery" })],
      total: 1,
    } as never);
    vi.mocked(discoveryApi.listServiceTypes).mockResolvedValueOnce({
      serviceTypes: [{ serviceType: "delivery", count: 1 }],
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        categories: ["小吃", "飲品"],
        autoLoad: false,
        initialQuery: "雞排",
        initialCategory: "小吃",
        initialServiceType: "delivery",
        initialTakeaway: true,
        initialSortBy: "popular",
      },
    });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("markets.serviceType.delivery 1");
    });
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchDishes).not.toHaveBeenCalled();
    expect(discoveryApi.browseRestaurants).not.toHaveBeenCalled();
    expect(discoveryApi.searchServices).toHaveBeenCalledWith({
      q: "雞排",
      marketId: "market-1",
      serviceType: "delivery",
      sortBy: "popular",
      takeaway: true,
      page: 1,
      limit: 20,
    });
    expect(wrapper.emitted("searchStateChange")?.at(-1)?.[0]).toMatchObject({
      q: "雞排",
      categoryName: "",
      serviceType: "delivery",
      resultKind: "service",
      takeaway: true,
      sortBy: "popular",
    });
  });

  it("searches and renders service items within the selected market", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [dish()],
      total: 1,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [service()],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("切水果");
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchServices).toHaveBeenCalledWith({
      q: "切水果",
      marketId: "market-1",
      serviceType: undefined,
      page: 1,
      limit: 20,
    });
    expect(wrapper.text()).toContain("代客切水果");
    expect(wrapper.text()).toContain("水果攤");
    // No currency on the fixture row: the default, not the current shop's.
    expect(wrapper.text()).toContain("TWD30");

    const openServiceButton = wrapper.get(
      '[data-testid="service-result-open"]',
    );
    expect(openServiceButton.text()).toContain("markets.common.viewServices");

    await openServiceButton.trigger("click");

    expect(wrapper.emitted("selectService")?.[0][0]).toMatchObject({
      restaurantId: "service-r1",
      name: "代客切水果",
    });
  });

  it("opens bookable market service results in the site booking flow", async () => {
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [
        service({
          requiresBooking: true,
          bookingUrl: "https://booking.example/service-10",
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-result-kind-service"]')
      .trigger("click");
    await wrapper.get("form").trigger("submit.prevent");

    const bookingButton = wrapper.get('[data-testid="service-result-booking"]');
    expect(bookingButton.text()).toContain("markets.search.bookDirect");
    await bookingButton.trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ServiceBooking",
      params: {
        restaurantId: "service-r1",
        serviceItemId: "10",
      },
    });
    expect(wrapper.get('[data-testid="service-result-open"]').text()).toContain(
      "markets.common.viewServices",
    );
  });

  it("shows external booking links for market services without in-app booking", async () => {
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [
        service({
          requiresBooking: false,
          bookingUrl: "https://booking.example/service-10",
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-result-kind-service"]')
      .trigger("click");
    await wrapper.get("form").trigger("submit.prevent");

    const bookingLink = wrapper.get(
      '[data-testid="service-result-booking-url"]',
    );
    expect(bookingLink.text()).toContain("markets.search.openBooking");
    expect(bookingLink.attributes("href")).toBe(
      "https://booking.example/service-10",
    );
    expect(bookingLink.attributes("target")).toBe("_blank");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("switches to service results when filtering by service type", async () => {
    vi.mocked(discoveryApi.listServiceTypes).mockResolvedValueOnce({
      serviceTypes: [{ serviceType: "delivery", count: 2 }],
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [
        service({
          name: "市場外送",
          serviceType: "delivery",
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("markets.serviceType.delivery 2");
    });
    await wrapper
      .get('[data-testid="market-service-type-select"]')
      .setValue("delivery");
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchServices).toHaveBeenCalledWith({
      q: undefined,
      marketId: "market-1",
      serviceType: "delivery",
      page: 1,
      limit: 20,
    });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("市場外送");
    });
    expect(discoveryApi.searchDishes).not.toHaveBeenCalled();
    expect(discoveryApi.browseRestaurants).not.toHaveBeenCalled();
    expect(wrapper.emitted("searchStateChange")?.at(-1)?.[0]).toEqual({
      q: "",
      categoryName: "",
      serviceType: "delivery",
      resultKind: "service",
      takeaway: false,
      delivery: false,
      sortBy: "relevance",
    });
  });

  it("normalizes initial service type filters to service results", async () => {
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [
        service({
          name: "市場外送",
          serviceType: "delivery",
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        initialCategory: "小吃",
        initialServiceType: "delivery",
      },
    });

    await vi.waitFor(() => {
      expect(discoveryApi.searchServices).toHaveBeenCalledWith({
        q: undefined,
        marketId: "market-1",
        serviceType: "delivery",
        page: 1,
        limit: 20,
      });
    });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("市場外送");
    });
    expect(discoveryApi.searchDishes).not.toHaveBeenCalled();
    expect(discoveryApi.browseRestaurants).not.toHaveBeenCalled();
    expect(wrapper.emitted("searchStateChange")?.at(-1)?.[0]).toEqual({
      q: "",
      categoryName: "",
      serviceType: "delivery",
      resultKind: "service",
      takeaway: false,
      delivery: false,
      sortBy: "relevance",
    });
  });

  it("sorts market catalog and service results by open status", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [dish({ dishName: "營業中雞排" })],
      total: 1,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [service({ name: "營業中代切" })],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-sort-select"]')
      .setValue("open_now");
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
      q: undefined,
      marketId: "market-1",
      categoryName: undefined,
      sortBy: "open_now",
      takeaway: undefined,
      page: 1,
      limit: 20,
    });
    expect(discoveryApi.searchServices).toHaveBeenCalledWith({
      q: undefined,
      marketId: "market-1",
      serviceType: undefined,
      sortBy: "open_now",
      page: 1,
      limit: 20,
    });
    expect(
      wrapper.get('[data-testid="market-product-search-summary"]').text(),
    ).toContain("markets.search.filterSort:markets.search.sort.open_now");
    expect(wrapper.emitted("searchStateChange")?.at(-1)?.[0]).toMatchObject({
      sortBy: "open_now",
    });
  });

  it("sorts market catalog service and vendor results by current distance", async () => {
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
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [dish({ dishName: "最近雞排", distanceKm: 0.12 })],
      total: 1,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [service({ name: "最近代切", distanceKm: 0.2 })],
      total: 1,
    } as never);
    vi.mocked(discoveryApi.browseRestaurants).mockResolvedValueOnce({
      results: [restaurant({ name: "最近店鋪", distanceKm: 0.3 })],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-use-location"]')
      .trigger("click");

    await vi.waitFor(() => {
      expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
        q: undefined,
        marketId: "market-1",
        categoryName: undefined,
        sortBy: "distance",
        lat: 24.1764,
        lng: 120.6466,
        radiusKm: 2,
        takeaway: undefined,
        page: 1,
        limit: 20,
      });
      expect(discoveryApi.searchServices).toHaveBeenCalledWith({
        q: undefined,
        marketId: "market-1",
        serviceType: undefined,
        sortBy: "distance",
        lat: 24.1764,
        lng: 120.6466,
        radiusKm: 2,
        page: 1,
        limit: 20,
      });
      expect(discoveryApi.browseRestaurants).toHaveBeenCalledWith({
        q: undefined,
        marketId: "market-1",
        sortBy: "distance",
        lat: 24.1764,
        lng: 120.6466,
        radiusKm: 2,
        page: 1,
        limit: 20,
      });
    });
    expect(
      wrapper.get('[data-testid="market-product-search-summary"]').text(),
    ).toContain("markets.search.filterSort:markets.search.sort.distance");
    expect(wrapper.text()).toContain("0.1 km");
    expect(wrapper.text()).toContain("0.2 km");
    expect(wrapper.text()).toContain("0.3 km");
  });

  it("filters market catalog results to products", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [
        dish({
          resultType: "product",
          dishName: "造型手機殼",
          categoryName: "配件",
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-result-kind-product"]')
      .trigger("click");
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
      q: undefined,
      marketId: "market-1",
      catalogType: "product",
      categoryName: undefined,
      takeaway: undefined,
      page: 1,
      limit: 20,
    });
    expect(discoveryApi.searchServices).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("造型手機殼");
    expect(
      wrapper.get('[data-testid="market-product-search-summary"]').text(),
    ).toContain("markets.search.filterKind:markets.search.resultKind.product");
    expect(wrapper.emitted("searchStateChange")?.at(-1)?.[0]).toEqual({
      q: "",
      categoryName: "",
      serviceType: "",
      resultKind: "product",
      takeaway: false,
      delivery: false,
      sortBy: "relevance",
    });
  });

  it("filters market results to services without querying catalog items", async () => {
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [service({ name: "代客包裝" })],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-result-kind-service"]')
      .trigger("click");
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchDishes).not.toHaveBeenCalled();
    expect(discoveryApi.searchServices).toHaveBeenCalledWith({
      q: undefined,
      marketId: "market-1",
      serviceType: undefined,
      page: 1,
      limit: 20,
    });
    expect(wrapper.text()).toContain("代客包裝");
    expect(
      wrapper.get('[data-testid="market-product-search-summary"]').text(),
    ).toContain("markets.search.filterKind:markets.search.resultKind.service");
  });

  it("filters market results to vendors without querying catalog or services", async () => {
    vi.mocked(discoveryApi.browseRestaurants).mockResolvedValueOnce({
      results: [
        restaurant({
          name: "修鞋攤",
          marketVendor: {
            marketId: "market-1",
            stallNumber: "R-03",
            isPrimary: true,
          },
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-result-kind-vendor"]')
      .trigger("click");
    expect(
      wrapper.find('[data-testid="market-product-category-select"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="market-product-sort-select"]').exists(),
    ).toBe(false);
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchDishes).not.toHaveBeenCalled();
    expect(discoveryApi.searchServices).not.toHaveBeenCalled();
    expect(discoveryApi.browseRestaurants).toHaveBeenCalledWith({
      q: undefined,
      marketId: "market-1",
      sortBy: "popular",
      page: 1,
      limit: 20,
    });
    expect(wrapper.text()).toContain("修鞋攤");
    expect(wrapper.text()).toContain("markets.common.stallWithNumber:R-03");
    expect(
      wrapper.get('[data-testid="market-product-search-summary"]').text(),
    ).toContain("markets.search.filterKind:markets.search.resultKind.vendor");
    expect(wrapper.emitted("searchStateChange")?.at(-1)?.[0]).toEqual({
      q: "",
      categoryName: "",
      serviceType: "",
      resultKind: "vendor",
      takeaway: false,
      delivery: false,
      sortBy: "relevance",
    });
  });

  it("applies the takeaway filter to market services", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [service({ name: "可外帶代切" })],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchServices).toHaveBeenCalledWith({
      q: undefined,
      marketId: "market-1",
      serviceType: undefined,
      takeaway: true,
      page: 1,
      limit: 20,
    });
  });

  it("applies the delivery filter to market services", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [service({ name: "可外送代切", serviceType: "delivery" })],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-delivery-filter"]')
      .setValue(true);
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.listCategories).toHaveBeenLastCalledWith({
      marketId: "market-1",
      delivery: true,
    });
    expect(discoveryApi.listServiceTypes).toHaveBeenLastCalledWith({
      marketId: "market-1",
      delivery: true,
    });
    expect(discoveryApi.searchDishes).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: true,
      }),
    );
    expect(discoveryApi.searchServices).toHaveBeenCalledWith({
      q: undefined,
      marketId: "market-1",
      serviceType: undefined,
      delivery: true,
      page: 1,
      limit: 20,
    });
  });

  it("summarizes active market search filters", async () => {
    vi.mocked(discoveryApi.listServiceTypes).mockResolvedValueOnce({
      serviceTypes: [{ serviceType: "delivery", count: 2 }],
    } as never);
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [dish({ dishName: "雞排便當" })],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        categories: ["小吃", "飲品"],
        autoLoad: false,
      },
    });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("markets.serviceType.delivery 2");
    });
    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("雞排");
    await wrapper
      .get('[data-testid="market-product-category-select"]')
      .setValue("小吃");
    await wrapper
      .get('[data-testid="market-service-type-select"]')
      .setValue("delivery");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper
      .get('[data-testid="market-product-delivery-filter"]')
      .setValue(true);
    await wrapper
      .get('[data-testid="market-product-sort-select"]')
      .setValue("popular");
    await wrapper.get("form").trigger("submit.prevent");

    const summary = wrapper.get(
      '[data-testid="market-product-search-summary"]',
    );

    expect(summary.text()).toContain("markets.search.filterKeyword:雞排");
    expect(summary.text()).toContain(
      "markets.search.filterService:markets.serviceType.delivery",
    );
    expect(summary.text()).toContain("markets.search.takeawayOnly");
    expect(summary.text()).toContain("markets.search.deliveryOnly");
    expect(summary.text()).toContain(
      "markets.search.filterSort:markets.search.sort.popular",
    );
  });

  it("clears filters from an empty market search", async () => {
    vi.mocked(discoveryApi.listServiceTypes).mockResolvedValueOnce({
      serviceTypes: [{ serviceType: "delivery", count: 1 }],
    } as never);
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [dish({ dishName: "市場雞排" })],
      total: 1,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValue({
      results: [],
      total: 0,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        categories: ["小吃", "飲品"],
        autoLoad: false,
      },
    });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("markets.serviceType.delivery 1");
    });
    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("不存在");
    await wrapper
      .get('[data-testid="market-product-category-select"]')
      .setValue("小吃");
    await wrapper
      .get('[data-testid="market-service-type-select"]')
      .setValue("delivery");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get("form").trigger("submit.prevent");

    expect(wrapper.text()).toContain("markets.search.emptyFiltered");

    await wrapper
      .get('[data-testid="market-product-clear-filters"]')
      .trigger("click");

    expect(discoveryApi.searchDishes).toHaveBeenLastCalledWith({
      q: undefined,
      marketId: "market-1",
      categoryName: undefined,
      takeaway: undefined,
      page: 1,
      limit: 20,
    });
    expect(discoveryApi.searchServices).toHaveBeenLastCalledWith({
      q: undefined,
      marketId: "market-1",
      serviceType: undefined,
      page: 1,
      limit: 20,
    });
    expect(discoveryApi.listServiceTypes).toHaveBeenLastCalledWith({
      marketId: "market-1",
      takeaway: undefined,
    });
    expect(wrapper.emitted("searchStateChange")?.at(-1)?.[0]).toEqual({
      q: "",
      categoryName: "",
      serviceType: "",
      resultKind: "all",
      takeaway: false,
      delivery: false,
      sortBy: "relevance",
    });
    expect(wrapper.text()).toContain("市場雞排");
  });

  it("explains empty market catalogs before filters are applied", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper.get("form").trigger("submit.prevent");

    expect(
      wrapper.get('[data-testid="market-product-empty-state"]').text(),
    ).toContain("markets.search.emptyNoCatalog");
    expect(
      wrapper.find('[data-testid="market-product-clear-filters"]').exists(),
    ).toBe(false);
  });

  it("explains catalog sync gaps when market scope has catalog coverage", async () => {
    const scope = {
      market: {
        marketId: "market-1",
        hasSearchableCatalog: true,
        searchableProductCount: 4,
        publicServiceCount: 2,
      },
    };
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
      scope,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [],
      total: 0,
      scope,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper.get("form").trigger("submit.prevent");

    expect(
      wrapper.get('[data-testid="market-product-empty-state"]').text(),
    ).toContain("markets.search.emptySyncing");
  });

  it("explains filtered empty market catalog searches", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("不存在");
    await wrapper.get("form").trigger("submit.prevent");

    expect(
      wrapper.get('[data-testid="market-product-empty-state"]').text(),
    ).toContain("markets.search.emptyFiltered");
    expect(
      wrapper.find('[data-testid="market-product-clear-filters"]').exists(),
    ).toBe(true);
  });

  it("offers a vendor fallback when a market search has no matches", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.browseRestaurants)
      .mockResolvedValueOnce({
        results: [],
        total: 0,
      } as never)
      .mockResolvedValueOnce({
        results: [restaurant({ name: "全部店鋪雞排攤" })],
        total: 1,
      } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        categories: ["小吃"],
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("不存在");
    await wrapper
      .get('[data-testid="market-product-category-select"]')
      .setValue("小吃");
    await wrapper.get("form").trigger("submit.prevent");

    await wrapper
      .get('[data-testid="market-empty-browse-vendors"]')
      .trigger("click");

    expect(discoveryApi.browseRestaurants).toHaveBeenLastCalledWith({
      q: undefined,
      marketId: "market-1",
      sortBy: "popular",
      page: 1,
      limit: 20,
    });
    expect(wrapper.text()).toContain("全部店鋪雞排攤");
    expect(wrapper.emitted("searchStateChange")?.at(-1)?.[0]).toEqual({
      q: "",
      categoryName: "",
      serviceType: "",
      resultKind: "vendor",
      takeaway: false,
      delivery: false,
      sortBy: "relevance",
    });
  });

  it("offers a service fallback when a market search has no matches", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices)
      .mockResolvedValueOnce({
        results: [],
        total: 0,
      } as never)
      .mockResolvedValueOnce({
        results: [service({ name: "全部服務代切" })],
        total: 1,
      } as never);
    vi.mocked(discoveryApi.browseRestaurants).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("不存在");
    await wrapper.get("form").trigger("submit.prevent");

    await wrapper
      .get('[data-testid="market-empty-browse-services"]')
      .trigger("click");

    expect(discoveryApi.searchServices).toHaveBeenLastCalledWith({
      q: undefined,
      marketId: "market-1",
      serviceType: undefined,
      page: 1,
      limit: 20,
    });
    expect(wrapper.text()).toContain("全部服務代切");
    expect(wrapper.emitted("searchStateChange")?.at(-1)?.[0]).toEqual({
      q: "",
      categoryName: "",
      serviceType: "",
      resultKind: "service",
      takeaway: false,
      delivery: false,
      sortBy: "relevance",
    });
  });

  it("loads service type facets for the selected market", async () => {
    vi.mocked(discoveryApi.listServiceTypes).mockResolvedValueOnce({
      serviceTypes: [
        { serviceType: "delivery", count: 2 },
        { serviceType: "booking", count: 1 },
      ],
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await vi.waitFor(() => {
      expect(discoveryApi.listServiceTypes).toHaveBeenCalledWith({
        marketId: "market-1",
      });
      expect(wrapper.text()).toContain("markets.serviceType.delivery 2");
      expect(wrapper.text()).toContain("markets.serviceType.booking 1");
      expect(wrapper.text()).not.toContain("租借");
    });
  });

  it("reloads market facets with the takeaway filter", async () => {
    vi.mocked(discoveryApi.listCategories)
      .mockResolvedValueOnce({
        categories: ["小吃", "飲品"],
      } as never)
      .mockResolvedValueOnce({
        categories: ["小吃"],
      } as never);
    vi.mocked(discoveryApi.listServiceTypes)
      .mockResolvedValueOnce({
        serviceTypes: [{ serviceType: "booking", count: 1 }],
      } as never)
      .mockResolvedValueOnce({
        serviceTypes: [{ serviceType: "delivery", count: 1 }],
      } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await vi.waitFor(() => {
      expect(discoveryApi.listServiceTypes).toHaveBeenCalledWith({
        marketId: "market-1",
      });
    });

    await wrapper.get('input[type="checkbox"]').setValue(true);

    await vi.waitFor(() => {
      expect(discoveryApi.listCategories).toHaveBeenLastCalledWith({
        marketId: "market-1",
        takeaway: true,
      });
      expect(discoveryApi.listServiceTypes).toHaveBeenLastCalledWith({
        marketId: "market-1",
        takeaway: true,
      });
      expect(wrapper.text()).toContain("markets.serviceType.delivery 1");
    });
  });

  it("browses all market products and services before entering a keyword", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [
        dish({
          dishName: "市場雞排",
          categoryName: "小吃",
        }),
      ],
      total: 1,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [
        service({
          name: "市場代客切水果",
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
      },
    });

    await vi.waitFor(() => {
      expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
        q: undefined,
        marketId: "market-1",
        categoryName: undefined,
        takeaway: undefined,
        page: 1,
        limit: 20,
      });
      expect(discoveryApi.searchServices).toHaveBeenCalledWith({
        q: undefined,
        marketId: "market-1",
        serviceType: undefined,
        page: 1,
        limit: 20,
      });
      expect(wrapper.text()).toContain("市場雞排");
      expect(wrapper.text()).toContain("市場代客切水果");
    });
  });

  it("loads additional market-scoped product results", async () => {
    vi.mocked(discoveryApi.searchDishes)
      .mockResolvedValueOnce({
        results: Array.from({ length: 20 }, (_, index) =>
          dish({
            menuItemId: index + 1,
            dishName: `章魚燒 ${index + 1}`,
          }),
        ),
        total: 25,
      } as never)
      .mockResolvedValueOnce({
        results: [
          dish({
            menuItemId: 21,
            dishName: "章魚燒 21",
          }),
        ],
        total: 25,
      } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("章魚燒");
    await wrapper.get("form").trigger("submit.prevent");

    await wrapper
      .get('[data-testid="market-product-load-more"]')
      .trigger("click");

    expect(discoveryApi.searchDishes).toHaveBeenLastCalledWith({
      q: "章魚燒",
      marketId: "market-1",
      categoryName: undefined,
      takeaway: undefined,
      page: 2,
      limit: 20,
    });
    expect(wrapper.text()).toContain("章魚燒 1");
    expect(wrapper.text()).toContain("章魚燒 21");
  });

  it("browses products by category without a keyword", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [
        dish({
          dishName: "珍珠奶茶",
          categoryName: "飲品",
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        categories: ["小吃", "飲品"],
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-category-select"]')
      .setValue("飲品");
    await wrapper.get("form").trigger("submit.prevent");

    expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
      q: undefined,
      marketId: "market-1",
      categoryName: "飲品",
      takeaway: undefined,
      page: 1,
      limit: 20,
    });
    expect(wrapper.text()).toContain("珍珠奶茶");
  });

  it("emits takeaway from a market-scoped product result", async () => {
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [
        dish({
          menuItemId: 2,
          dishName: "地瓜球",
          price: 50,
          categoryName: null,
          restaurantId: "r2",
          restaurantName: "甜點攤",
          district: "西屯區",
          isOpen: true,
          supportsTakeaway: true,
          supportsDelivery: false,
          tags: [],
        }),
      ],
      total: 1,
    } as never);

    const wrapper = mount(MarketProductSearch, {
      props: {
        marketId: "market-1",
        autoLoad: false,
      },
    });

    await wrapper
      .get('[data-testid="market-product-search-input"]')
      .setValue("地瓜球");
    await wrapper.get("form").trigger("submit.prevent");
    await wrapper.get('[data-testid="dish-takeaway-button"]').trigger("click");

    expect(wrapper.emitted("takeaway")?.[0][0]).toMatchObject({
      restaurantId: "r2",
      dishName: "地瓜球",
    });
  });
});
