import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
    currentLanguage: ref("zh-TW"),
  }),
}));
import MarketLocationMap from "@/components/markets/MarketLocationMap.vue";
import { loadMarketMapRuntime } from "@/components/markets/mapRuntime";
import type { MarketDetail, MarketVendor } from "@/services/marketsApi";

const mapRemove = vi.hoisted(() => vi.fn());
const mapOn = vi.hoisted(() => vi.fn());
const mapAddSource = vi.hoisted(() => vi.fn());
const mapAddLayer = vi.hoisted(() => vi.fn());
const mapFitBounds = vi.hoisted(() => vi.fn());
const mapAddControl = vi.hoisted(() => vi.fn());
const mapResize = vi.hoisted(() => vi.fn());
const markerSetLngLat = vi.hoisted(() => vi.fn().mockReturnThis());
const markerSetPopup = vi.hoisted(() => vi.fn().mockReturnThis());
const markerAddTo = vi.hoisted(() => vi.fn().mockReturnThis());
const popupSetText = vi.hoisted(() => vi.fn().mockReturnThis());
const addProtocol = vi.hoisted(() => vi.fn());
const protocolTile = vi.hoisted(() => vi.fn());
const maplibreMock = vi.hoisted(() => ({
  Map: vi.fn().mockImplementation(function () {
    return {
      on: mapOn,
      addSource: mapAddSource,
      addLayer: mapAddLayer,
      fitBounds: mapFitBounds,
      addControl: mapAddControl,
      resize: mapResize,
      remove: mapRemove,
    };
  }),
  Marker: vi.fn().mockImplementation(function () {
    return {
      setLngLat: markerSetLngLat,
      setPopup: markerSetPopup,
      addTo: markerAddTo,
    };
  }),
  Popup: vi.fn().mockImplementation(function () {
    return {
      setText: popupSetText,
    };
  }),
  NavigationControl: vi.fn(),
  LngLatBounds: vi.fn().mockImplementation(function () {
    return {
      extend: vi.fn().mockReturnThis(),
    };
  }),
  addProtocol,
}));

function createMapMock() {
  return {
    on: mapOn,
    addSource: mapAddSource,
    addLayer: mapAddLayer,
    fitBounds: mapFitBounds,
    addControl: mapAddControl,
    resize: mapResize,
    remove: mapRemove,
  };
}

vi.mock("@/components/markets/mapRuntime", () => ({
  loadMarketMapRuntime: vi.fn(),
}));

function market(overrides: Partial<MarketDetail> = {}): MarketDetail {
  return {
    id: "market-1",
    slug: "fengjia",
    name: "逢甲夜市",
    type: "night_market",
    description: null,
    city: "台中市",
    district: "西屯區",
    address: "文華路",
    latitude: 24.1764,
    longitude: 120.6466,
    bannerUrl: null,
    logoUrl: null,
    tags: null,
    vendorCount: 1,
    ...overrides,
  };
}

function vendor(overrides: Partial<MarketVendor> = {}): MarketVendor {
  return {
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
    ...overrides,
  };
}

describe("MarketLocationMap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    maplibreMock.Map.mockImplementation(function () {
      return createMapMock();
    });
    maplibreMock.Marker.mockImplementation(function () {
      const marker = {
        setLngLat: (value: [number, number]) => {
          markerSetLngLat(value);
          return marker;
        },
        setPopup: (value: unknown) => {
          markerSetPopup(value);
          return marker;
        },
        addTo: (value: unknown) => {
          markerAddTo(value);
          return marker;
        },
      };
      return marker;
    });
    maplibreMock.Popup.mockImplementation(function () {
      const popup = {
        setText: (value: string) => {
          popupSetText(value);
          return popup;
        },
      };
      return popup;
    });
    maplibreMock.LngLatBounds.mockImplementation(function () {
      return {
        extend: vi.fn().mockReturnThis(),
      };
    });
    vi.mocked(loadMarketMapRuntime).mockResolvedValue({
      maplibregl: maplibreMock as never,
      registerPmTilesProtocol: () => addProtocol("pmtiles", protocolTile),
    });
  });

  it("renders market map shell with navigation link", () => {
    const wrapper = mount(MarketLocationMap, {
      props: {
        market: market(),
        vendors: [vendor()],
      },
    });

    expect(wrapper.get('[data-testid="market-location-map"]').text()).toContain(
      "markets.map.title",
    );
    expect(wrapper.get('[data-testid="market-location-address"]').text()).toBe(
      "文華路",
    );
    expect(
      wrapper
        .get('[data-testid="market-location-navigation"]')
        .attributes("href"),
    ).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=24.1764%2C120.6466",
    );
  });

  it("initializes maplibre and plots market boundary plus vendor markers", async () => {
    mapOn.mockImplementation((event: string, callback: () => void) => {
      if (event === "load") callback();
    });
    mount(MarketLocationMap, {
      props: {
        market: market({
          boundaryGeojson: {
            type: "Polygon",
            coordinates: [
              [
                [120.646, 24.176],
                [120.647, 24.176],
                [120.647, 24.177],
                [120.646, 24.177],
                [120.646, 24.176],
              ],
            ],
          },
        }),
        vendors: [
          vendor(),
          vendor({ restaurantId: "missing-coordinates", latitude: null }),
        ],
      },
    });
    await vi.dynamicImportSettled();

    expect(addProtocol).toHaveBeenCalledWith("pmtiles", expect.any(Function));
    expect(mapAddSource).toHaveBeenCalledWith(
      "market-boundary",
      expect.objectContaining({
        type: "geojson",
      }),
    );
    expect(mapAddLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "market-boundary-fill",
        type: "fill",
      }),
    );
    expect(markerSetLngLat).toHaveBeenCalledWith([120.6466, 24.1764]);
    expect(markerSetLngLat).toHaveBeenCalledWith([120.6467, 24.1765]);
    expect(markerSetLngLat).toHaveBeenCalledTimes(2);
  });

  it("labels closed vendor marker popups with today's open state", async () => {
    mapOn.mockImplementation((event: string, callback: () => void) => {
      if (event === "load") callback();
    });
    mount(MarketLocationMap, {
      props: { market: market(), vendors: [vendor({ isOpen: false })] },
    });
    await vi.dynamicImportSettled();

    expect(popupSetText).toHaveBeenCalledWith(
      expect.stringContaining("markets.vendors.notOpenToday"),
    );
  });

  it("uses the production PMTiles style when production map env is not injected", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_MAP_STYLE_URL", "");
    vi.stubEnv("VITE_MAP_PM_TILES_URL", "");
    vi.stubEnv("VITE_MAP_GLYPHS_URL", "");

    mount(MarketLocationMap, {
      props: {
        market: market(),
        vendors: [vendor()],
      },
    });
    await vi.dynamicImportSettled();

    expect(maplibreMock.Map).toHaveBeenCalledWith(
      expect.objectContaining({
        style: expect.objectContaining({
          glyphs:
            "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
          sources: expect.objectContaining({
            protomaps: expect.objectContaining({
              url: "pmtiles://https://pub-2c3683e1158d4d579317f24fc66a34b3.r2.dev/taiwan.pmtiles",
            }),
          }),
        }),
      }),
    );
  });

  it("removes the map instance on unmount", async () => {
    mapOn.mockImplementation((event: string, callback: () => void) => {
      if (event === "load") callback();
    });
    const wrapper = mount(MarketLocationMap, {
      props: {
        market: market(),
        vendors: [vendor()],
      },
    });
    await vi.dynamicImportSettled();

    wrapper.unmount();

    expect(mapRemove).toHaveBeenCalled();
  });
});
