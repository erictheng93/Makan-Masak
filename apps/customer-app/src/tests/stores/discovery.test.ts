import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useDiscoveryStore } from "@/stores/discovery";
import { discoveryApi } from "@/services/discoveryApi";

vi.mock("@/services/discoveryApi", () => ({
  discoveryApi: {
    searchDishes: vi.fn(),
    searchServices: vi.fn(),
    browseRestaurants: vi.fn(),
    getPopular: vi.fn(),
  },
}));

describe("useDiscoveryStore", () => {
  beforeEach(() => {
    vi.mocked(discoveryApi.searchDishes).mockReset();
    vi.mocked(discoveryApi.searchServices).mockReset();
    vi.mocked(discoveryApi.browseRestaurants).mockReset();
    vi.mocked(discoveryApi.getPopular).mockReset();
    // Every search reads `.results`; a call a test does not stub must not
    // resolve to undefined and trip the store's catch.
    for (const method of [
      discoveryApi.searchDishes,
      discoveryApi.searchServices,
      discoveryApi.browseRestaurants,
    ]) {
      vi.mocked(method).mockResolvedValue({ results: [], total: 0 } as never);
    }
  });

  it("passes selected market scope to dish search", async () => {
    setActivePinia(createPinia());
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.browseRestaurants).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);

    const store = useDiscoveryStore();
    store.updateFilters({ marketId: "market-1" });
    await store.searchDishes("章魚燒");

    expect(discoveryApi.searchDishes).toHaveBeenLastCalledWith({
      q: "章魚燒",
      marketId: "market-1",
      page: 1,
    });
  });

  it("browses market dishes when selecting a market without a keyword", async () => {
    setActivePinia(createPinia());
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [
        {
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
        },
      ],
      total: 1,
    } as never);

    const store = useDiscoveryStore();
    store.updateFilters({ marketId: "market-1" });

    await vi.waitFor(() => {
      expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
        marketId: "market-1",
        page: 1,
      });
    });
    expect(discoveryApi.browseRestaurants).not.toHaveBeenCalled();
    expect(store.isSearchMode).toBe(true);
    await vi.waitFor(() => {
      expect(store.dishResults).toHaveLength(1);
    });
  });

  it("browses market dishes by stable market slug", async () => {
    setActivePinia(createPinia());
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);

    const store = useDiscoveryStore();
    store.updateFilters({ marketSlug: "fengjia" });

    await vi.waitFor(() => {
      expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
        marketSlug: "fengjia",
        page: 1,
      });
    });
    expect(discoveryApi.searchServices).toHaveBeenCalledWith({
      marketSlug: "fengjia",
      page: 1,
    });
    expect(discoveryApi.browseRestaurants).not.toHaveBeenCalled();
  });

  it("searches matching services together with market dish results", async () => {
    setActivePinia(createPinia());
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    // updateFilters starts a search of its own, so the payload has to survive
    // both calls rather than be consumed by the first.
    vi.mocked(discoveryApi.searchServices).mockResolvedValue({
      results: [
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
        },
      ],
      total: 1,
    } as never);

    const store = useDiscoveryStore();
    store.updateFilters({ marketId: "market-1" });
    await store.searchDishes("切水果");

    expect(discoveryApi.searchServices).toHaveBeenLastCalledWith({
      q: "切水果",
      marketId: "market-1",
      page: 1,
    });
    expect(store.serviceResults).toHaveLength(1);
    expect(store.total).toBe(1);
  });

  it("passes service type only to service searches", async () => {
    setActivePinia(createPinia());
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);

    const store = useDiscoveryStore();
    store.updateFilters({ marketId: "market-1", serviceType: "delivery" });
    await store.searchDishes("外送");

    expect(discoveryApi.searchDishes).toHaveBeenLastCalledWith({
      q: "外送",
      marketId: "market-1",
      page: 1,
    });
    expect(discoveryApi.searchServices).toHaveBeenLastCalledWith({
      q: "外送",
      marketId: "market-1",
      serviceType: "delivery",
      page: 1,
    });
  });

  it("passes fulfillment filters to service searches", async () => {
    setActivePinia(createPinia());
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);

    const store = useDiscoveryStore();
    store.updateFilters({
      marketId: "market-1",
      takeaway: true,
      delivery: true,
    });
    await store.searchDishes("代客");

    expect(discoveryApi.searchServices).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: "代客",
        marketId: "market-1",
        takeaway: true,
        delivery: true,
        page: 1,
      }),
    );
  });

  it("browses services when service type is the only selected filter", async () => {
    setActivePinia(createPinia());
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);
    vi.mocked(discoveryApi.searchServices).mockResolvedValueOnce({
      results: [
        {
          serviceItemId: 8,
          name: "全站外送",
          description: null,
          serviceType: "delivery",
          priceCents: null,
          priceLabel: null,
          durationMinutes: null,
          requiresBooking: false,
          bookingUrl: null,
          tags: [],
          restaurantId: "service-restaurant-2",
          restaurantName: "外送攤",
          district: "西屯區",
          city: "台中市",
          isOpen: true,
        },
      ],
      total: 1,
    } as never);

    const store = useDiscoveryStore();
    store.updateFilters({ serviceType: "delivery" });

    await vi.waitFor(() => {
      expect(discoveryApi.searchServices).toHaveBeenCalledWith({
        serviceType: "delivery",
        page: 1,
      });
    });
    expect(discoveryApi.browseRestaurants).not.toHaveBeenCalled();
    expect(discoveryApi.searchDishes).not.toHaveBeenCalled();
    expect(store.isSearchMode).toBe(true);
    await vi.waitFor(() => {
      expect(store.serviceResults).toHaveLength(1);
      expect(store.total).toBe(1);
    });
  });

  it("browses category dishes when selecting a category without a keyword", async () => {
    setActivePinia(createPinia());
    vi.mocked(discoveryApi.searchDishes).mockResolvedValueOnce({
      results: [],
      total: 0,
    } as never);

    const store = useDiscoveryStore();
    store.updateFilters({ categoryName: "飲品" });

    await vi.waitFor(() => {
      expect(discoveryApi.searchDishes).toHaveBeenCalledWith({
        categoryName: "飲品",
        page: 1,
      });
    });
    expect(discoveryApi.browseRestaurants).not.toHaveBeenCalled();
  });
});
