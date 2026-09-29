import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import VendorListInMarket from "@/components/markets/VendorListInMarket.vue";
import RestaurantCard from "@/components/discovery/RestaurantCard.vue";
import type { MarketVendor } from "@/services/marketsApi";

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

vi.mock("@/utils/i18n", () => ({
  translate: (key: string) => key,
}));

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
    locationLabel: null,
    marketHours: null,
    effectiveBusinessHours: null,
    isPrimary: true,
    availableMenuItemCount: 3,
    publicServiceItemCount: 2,
    ...overrides,
  };
}

describe("VendorListInMarket", () => {
  it("shows an unopened stall but blocks its menu and services", async () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [vendor({ isOpen: false })],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    const card = wrapper.get('[data-testid="market-vendor-restaurant-1"]');
    expect(card.attributes("data-status")).toBe("closed-today");
    expect(card.text()).toContain("markets.vendors.notOpenToday");
    for (const action of ["menu", "services"]) {
      const button = wrapper.get(
        `[data-testid="open-vendor-${action}-restaurant-1"]`,
      );
      expect(button.attributes("disabled")).toBeDefined();
      await button.trigger("click");
    }
    await wrapper.get("article button").trigger("click");
    expect(
      wrapper.find('[data-testid="restaurant-takeaway-button"]').exists(),
    ).toBe(false);
    wrapper
      .findComponent(RestaurantCard)
      .vm.$emit("takeaway", vendor({ isOpen: false }));
    expect(wrapper.emitted("selectVendor")).toBeUndefined();
    expect(wrapper.emitted("selectServices")).toBeUndefined();
    expect(wrapper.emitted("takeaway")).toBeUndefined();
  });

  it("emits loadMore when more market vendors are available", async () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [vendor()],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
        hasMore: true,
      },
    });

    await wrapper.get('[data-testid="vendor-list-load-more"]').trigger("click");

    expect(wrapper.emitted("loadMore")).toHaveLength(1);
  });

  it("hides load more when all market vendors are loaded", () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [vendor()],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
        hasMore: false,
      },
    });

    expect(wrapper.find('[data-testid="vendor-list-load-more"]').exists()).toBe(
      false,
    );
  });

  it("emits delivery filter changes for market vendors", async () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [vendor({ supportsDelivery: true })],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    await wrapper.get('[data-testid="vendor-delivery-filter"]').setValue(true);

    expect(wrapper.emitted("update:deliveryOnly")).toEqual([[true]]);
  });

  it("emits a location sort request for market vendors", async () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [vendor()],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    await wrapper.get('[data-testid="vendor-use-location"]').trigger("click");

    expect(wrapper.emitted("useLocation")).toHaveLength(1);
  });

  it("shows stall numbers, location labels, and direct entry points", async () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [vendor({ locationLabel: "文華路入口第一排" })],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    expect(wrapper.text()).toContain("markets.common.stallWithNumber:A-01");
    expect(wrapper.text()).toContain("文華路入口第一排");
    expect(
      wrapper.get('[data-testid="open-vendor-menu-restaurant-1"]').text(),
    ).toBe("markets.common.viewMenu");
    expect(
      wrapper.get('[data-testid="open-vendor-services-restaurant-1"]').text(),
    ).toBe("markets.common.viewServices");

    await wrapper
      .get('[data-testid="open-vendor-menu-restaurant-1"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="open-vendor-services-restaurant-1"]')
      .trigger("click");

    expect(wrapper.emitted("selectVendor")?.[0]).toEqual([
      vendor({ locationLabel: "文華路入口第一排" }),
    ]);
    expect(wrapper.emitted("selectServices")?.[0]).toEqual([
      vendor({ locationLabel: "文華路入口第一排" }),
    ]);
  });

  it("shows market-specific hours when a stall overrides restaurant hours", () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [
          vendor({
            marketHours: {
              monday: { open: "17:00", close: "23:00" },
            },
            effectiveBusinessHours: {
              monday: { open: "17:00", close: "23:00" },
            },
          }),
        ],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    expect(wrapper.get('[data-testid="vendor-market-hours"]').text()).toContain(
      "markets.vendors.marketHours",
    );
    expect(wrapper.text()).toContain(
      "markets.weekday.short.monday 17:00-23:00",
    );
  });

  it("keeps the service entry disabled when a vendor has no public services", () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [vendor({ publicServiceItemCount: 0 })],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    expect(
      wrapper
        .get('[data-testid="open-vendor-services-restaurant-1"]')
        .attributes("disabled"),
    ).toBeDefined();
  });

  it("keeps the menu entry disabled when a vendor has no available menu items", async () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [
          vendor({
            availableMenuItemCount: 0,
            publicServiceItemCount: 2,
          }),
        ],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    const menuButton = wrapper.get(
      '[data-testid="open-vendor-menu-restaurant-1"]',
    );
    expect(menuButton.attributes("disabled")).toBeDefined();

    await menuButton.trigger("click");
    await wrapper
      .get('[data-testid="open-vendor-services-restaurant-1"]')
      .trigger("click");

    expect(wrapper.emitted("selectVendor")).toBeUndefined();
    expect(wrapper.emitted("selectServices")?.[0]).toEqual([
      vendor({
        availableMenuItemCount: 0,
        publicServiceItemCount: 2,
      }),
    ]);
  });

  it("opens service-only vendors from the main card entry point", async () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [
          vendor({
            availableMenuItemCount: 0,
            publicServiceItemCount: 2,
          }),
        ],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    await wrapper.get("article button").trigger("click");

    expect(wrapper.emitted("selectVendor")).toBeUndefined();
    expect(wrapper.emitted("selectServices")?.[0]).toEqual([
      vendor({
        availableMenuItemCount: 0,
        publicServiceItemCount: 2,
      }),
    ]);
  });

  it("does not open vendors that have no menu or services from the main card", async () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [
          vendor({
            availableMenuItemCount: 0,
            publicServiceItemCount: 0,
          }),
        ],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    await wrapper.get("article button").trigger("click");

    expect(wrapper.emitted("selectVendor")).toBeUndefined();
    expect(wrapper.emitted("selectServices")).toBeUndefined();
  });

  it("shows menu and service availability before opening a vendor", () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [
          vendor({
            restaurantId: "restaurant-1",
            availableMenuItemCount: 3,
            publicServiceItemCount: 2,
          }),
          vendor({
            restaurantId: "restaurant-2",
            name: "空資料攤",
            availableMenuItemCount: 0,
            publicServiceItemCount: 0,
          }),
        ],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
      },
    });

    const readyVendor = wrapper.get(
      '[data-testid="vendor-availability-restaurant-1"]',
    );
    const emptyVendor = wrapper.get(
      '[data-testid="vendor-availability-restaurant-2"]',
    );

    expect(readyVendor.text()).toContain("markets.common.menuItemCount:3");
    expect(readyVendor.text()).toContain("markets.common.serviceCount:2");
    expect(emptyVendor.text()).toContain("markets.common.noMenuItems");
    expect(emptyVendor.text()).toContain("markets.common.noServices");
  });
});
