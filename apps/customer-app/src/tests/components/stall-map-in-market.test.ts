import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
    currentLanguage: ref("zh-TW"),
  }),
}));
import StallMapInMarket from "@/components/markets/StallMapInMarket.vue";
import type { MarketVendor } from "@/services/marketsApi";

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
    stallNumber: "A-01",
    locationLabel: "入口第一排",
    isPrimary: true,
    availableMenuItemCount: 3,
    publicServiceItemCount: 1,
    ...overrides,
  };
}

describe("StallMapInMarket", () => {
  it("groups vendors by location label and shows stall numbers", () => {
    const wrapper = mount(StallMapInMarket, {
      props: {
        vendors: [
          vendor({ restaurantId: "r2", name: "甜不辣", stallNumber: "A-10" }),
          vendor({
            restaurantId: "r1",
            name: "雞排攤",
            stallNumber: "A-02",
          }),
          vendor({
            restaurantId: "r3",
            name: "飲料攤",
            stallNumber: "B-01",
            locationLabel: "文華路側",
          }),
        ],
      },
    });

    expect(wrapper.text()).toContain("markets.stallMap.defaultTitle");
    expect(wrapper.text()).toContain("入口");
    expect(wrapper.text()).toContain("markets.stallMap.aisle");
    expect(wrapper.text()).toContain("markets.stallMap.exit");
    expect(wrapper.text()).toContain("markets.common.stallCount:3");
    expect(wrapper.text()).toContain("markets.stallMap.openCount:3");
    expect(wrapper.text()).toContain("入口第一排");
    expect(wrapper.text()).toContain("文華路側");
    expect(wrapper.text()).toContain("markets.common.stallWithNumber:A-02");
    expect(wrapper.text()).toContain("markets.common.stallWithNumber:A-10");
    expect(wrapper.text()).toContain("markets.common.stallWithNumber:B-01");
    expect(wrapper.text()).toContain("markets.stallMap.menuCount:3");
    expect(wrapper.text()).toContain("markets.stallMap.serviceCount:1");
  });

  it("renders positioned vendors on the stall map when map coordinates exist", async () => {
    const selectedVendor = vendor({
      restaurantId: "r1",
      mapPosition: { x: 25, y: 40 },
    });
    const wrapper = mount(StallMapInMarket, {
      props: {
        vendors: [selectedVendor],
      },
    });

    const mapVendor = wrapper.get('[data-testid="stall-position-vendor-r1"]');

    expect(wrapper.find('[data-testid="stall-position-map"]').exists()).toBe(
      true,
    );
    expect(mapVendor.attributes("style")).toContain("left: 25%");
    expect(mapVendor.attributes("style")).toContain("top: 40%");

    await mapVendor.trigger("click");

    expect(wrapper.emitted("selectVendor")?.[0]).toEqual([selectedVendor]);
  });

  it("uses market map layout metadata when rendering a positioned map", () => {
    const wrapper = mount(StallMapInMarket, {
      props: {
        layout: {
          title: "逢甲入口地圖",
          description: "藍線為主動線，攤位依現場編號定位。",
          imageUrl: "https://example.com/fengjia-map.png",
          width: 1200,
          height: 800,
        },
        vendors: [
          vendor({
            restaurantId: "r1",
            mapPosition: { x: 25, y: 40 },
          }),
        ],
      },
    });

    const map = wrapper.get('[data-testid="stall-position-map"]');

    expect(wrapper.text()).toContain("逢甲入口地圖");
    expect(wrapper.text()).toContain("藍線為主動線");
    expect(map.attributes("style")).toContain(
      'background-image: url("https://example.com/fengjia-map.png")',
    );
    expect(map.attributes("style")).toContain("aspect-ratio: 1200 / 800");
  });

  it("sorts stall numbers naturally inside each lane", () => {
    const wrapper = mount(StallMapInMarket, {
      props: {
        vendors: [
          vendor({ restaurantId: "r10", name: "十號攤", stallNumber: "A-10" }),
          vendor({ restaurantId: "r2", name: "二號攤", stallNumber: "A-02" }),
          vendor({ restaurantId: "r1", name: "一號攤", stallNumber: "A-01" }),
        ],
      },
    });

    expect(
      wrapper
        .findAll('[data-testid^="stall-map-vendor-"]')
        .map((node) => node.text()),
    ).toEqual([
      expect.stringContaining("markets.common.stallWithNumber:A-01"),
      expect.stringContaining("markets.common.stallWithNumber:A-02"),
      expect.stringContaining("markets.common.stallWithNumber:A-10"),
    ]);
  });

  it("shows unavailable vendors and data gaps without hiding them", () => {
    const wrapper = mount(StallMapInMarket, {
      props: {
        vendors: [
          vendor({
            restaurantId: "r1",
            isOpen: false,
            availableMenuItemCount: 0,
            publicServiceItemCount: 0,
          }),
        ],
      },
    });

    expect(wrapper.text()).toContain("markets.stallMap.openCount:0");
    expect(wrapper.text()).toContain("markets.vendors.notOpenToday");
    expect(wrapper.text()).toContain("markets.common.dataPending");
    const stall = wrapper.get('[data-testid="stall-map-vendor-r1"]');
    expect(stall.attributes("data-status")).toBe("closed-today");
    expect(stall.attributes("disabled")).toBeDefined();
  });

  it("blocks positioned stalls that have not opened today", async () => {
    const wrapper = mount(StallMapInMarket, {
      props: {
        vendors: [vendor({ isOpen: false, mapPosition: { x: 25, y: 40 } })],
      },
    });
    const stall = wrapper.get(
      '[data-testid="stall-position-vendor-restaurant-1"]',
    );
    expect(stall.attributes("data-status")).toBe("closed-today");
    expect(stall.attributes("disabled")).toBeDefined();
    expect(stall.text()).toContain("markets.vendors.notOpenToday");
    await stall.trigger("click");
    expect(wrapper.emitted("selectVendor")).toBeUndefined();
  });

  it("opens a vendor from the stall map", async () => {
    const selectedVendor = vendor({ restaurantId: "r1" });
    const wrapper = mount(StallMapInMarket, {
      props: {
        vendors: [selectedVendor],
      },
    });

    await wrapper.get('[data-testid="stall-map-vendor-r1"]').trigger("click");

    expect(wrapper.emitted("selectVendor")?.[0]).toEqual([selectedVendor]);
  });

  it("hides itself when no vendor has a stall number", () => {
    const wrapper = mount(StallMapInMarket, {
      props: {
        vendors: [vendor({ stallNumber: null })],
      },
    });

    expect(wrapper.find('[data-testid="stall-map"]').exists()).toBe(false);
  });
});
