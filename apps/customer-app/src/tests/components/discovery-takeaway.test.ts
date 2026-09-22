import { describe, expect, it, vi } from "vitest";
import { mount, RouterLinkStub } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useAppStore } from "@/stores/app";
import DishResultCard from "@/components/discovery/DishResultCard.vue";
import RestaurantCard from "@/components/discovery/RestaurantCard.vue";

vi.mock("vue-i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/utils/i18n", () => ({
  translate: (key: string) => key,
}));

vi.mock("@/i18n", () => ({
  i18n: {
    global: {
      locale: { value: "zh-TW" },
      t: (key: string) => key,
    },
  },
  switchLanguage: vi.fn(),
  SUPPORTED_LANGUAGES: [],
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("discovery takeaway buttons", () => {
  it("shows immediate takeaway for open takeaway dish results", async () => {
    const wrapper = mount(DishResultCard, {
      props: {
        dish: {
          menuItemId: 1,
          dishName: "Market Bao",
          price: 60,
          categoryName: null,
          restaurantId: "r1",
          restaurantName: "包子攤",
          district: "北區",
          isOpen: true,
          supportsTakeaway: true,
          supportsDelivery: false,
          tags: [],
        },
      },
      global: {
        plugins: [createPinia()],
      },
    });

    await wrapper.get('[data-testid="dish-takeaway-button"]').trigger("click");

    expect(wrapper.emitted("takeaway")?.[0]).toBeTruthy();
  });

  // Search results span restaurants; the card must price a dish in the
  // restaurant that sells it, not in whichever shop was visited last.
  it("prices a dish in the dish's own currency", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useAppStore().currentRestaurant = {
      id: "other-restaurant",
      settings: { currency: "TWD" },
    } as never;

    const wrapper = mount(DishResultCard, {
      props: {
        dish: {
          menuItemId: 1,
          dishName: "Nasi Lemak",
          price: 12.5,
          currency: "MYR",
          categoryName: null,
          restaurantId: "r1",
          restaurantName: "馬來攤",
          district: "北區",
          isOpen: true,
          supportsTakeaway: false,
          supportsDelivery: false,
          tags: [],
        },
      },
      global: { plugins: [pinia] },
    });

    expect(wrapper.get('[data-testid="dish-result-price"]').text()).toBe(
      "RM 12.50",
    );
  });

  it("falls back to the platform default when a result carries no currency", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useAppStore().currentRestaurant = {
      id: "other-restaurant",
      settings: { currency: "MYR" },
    } as never;

    const wrapper = mount(DishResultCard, {
      props: {
        dish: {
          menuItemId: 1,
          dishName: "Bao",
          price: 60,
          categoryName: null,
          restaurantId: "r1",
          restaurantName: "包子攤",
          district: "北區",
          isOpen: true,
          supportsTakeaway: false,
          supportsDelivery: false,
          tags: [],
        },
      },
      global: { plugins: [pinia] },
    });

    // Not "RM 60.00": an unlabelled row is the default, never the currency of
    // the shop the customer happens to be in.
    expect(wrapper.get('[data-testid="dish-result-price"]').text()).toBe(
      "NT$60",
    );
  });

  it("shows available service labels on dish results", () => {
    const wrapper = mount(DishResultCard, {
      props: {
        dish: {
          menuItemId: 1,
          dishName: "Market Bao",
          price: 60,
          categoryName: null,
          restaurantId: "r1",
          restaurantName: "包子攤",
          district: "北區",
          isOpen: true,
          supportsTakeaway: true,
          supportsDelivery: true,
          tags: [],
        },
      },
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.get('[data-testid="dish-service-labels"]').text()).toContain(
      "可外帶",
    );
    expect(wrapper.get('[data-testid="dish-service-labels"]').text()).toContain(
      "可外送",
    );
  });

  it("shows product result labels and action text", () => {
    const wrapper = mount(DishResultCard, {
      props: {
        dish: {
          resultType: "product",
          menuItemId: 1,
          dishName: "手機殼",
          price: 199,
          categoryName: "配件",
          restaurantId: "r1",
          restaurantName: "配件攤",
          district: "西屯區",
          isOpen: true,
          supportsTakeaway: false,
          supportsDelivery: false,
          tags: [],
        },
      },
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.get('[data-testid="dish-result-type"]').text()).toContain(
      "商品",
    );
    expect(wrapper.get('[data-testid="dish-result-open-menu"]').text()).toBe(
      "查看商品",
    );
  });

  it("keeps menu item result labels distinct from products", () => {
    const wrapper = mount(DishResultCard, {
      props: {
        dish: {
          resultType: "menu_item",
          menuItemId: 1,
          dishName: "雞排",
          price: 85,
          categoryName: "小吃",
          restaurantId: "r1",
          restaurantName: "雞排攤",
          district: "西屯區",
          isOpen: true,
          supportsTakeaway: false,
          supportsDelivery: false,
          tags: [],
        },
      },
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.get('[data-testid="dish-result-type"]').text()).toContain(
      "餐點",
    );
    expect(wrapper.get('[data-testid="dish-result-open-menu"]').text()).toBe(
      "查看菜單",
    );
  });

  it("uses explicit product price labels when provided", () => {
    const wrapper = mount(DishResultCard, {
      props: {
        dish: {
          resultType: "product",
          menuItemId: 1,
          dishName: "客製手機殼",
          price: 0,
          priceCents: null,
          priceLabel: "依規格報價",
          categoryName: "配件",
          restaurantId: "r1",
          restaurantName: "配件攤",
          district: "西屯區",
          isOpen: true,
          supportsTakeaway: false,
          supportsDelivery: false,
          tags: [],
        },
      },
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.get('[data-testid="dish-result-price"]').text()).toBe(
      "依規格報價",
    );
  });

  it("links dish results back to their market context", () => {
    const wrapper = mount(DishResultCard, {
      props: {
        dish: {
          menuItemId: 1,
          dishName: "Market Bao",
          price: 60,
          categoryName: null,
          restaurantId: "r1",
          restaurantName: "包子攤",
          district: "西屯區",
          isOpen: true,
          supportsTakeaway: false,
          supportsDelivery: false,
          tags: [],
          marketVendor: {
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            marketUrl: "/markets/fengjia",
            stallNumber: "G-12",
            locationLabel: "入口第一排",
            isPrimary: true,
          },
        },
      },
      global: {
        plugins: [createPinia()],
        stubs: { RouterLink: RouterLinkStub },
      },
    });

    const link = wrapper.get('[data-testid="dish-market-link"]');
    expect(link.text()).toContain("逢甲夜市");
    expect(link.text()).toContain("G-12");
    expect(link.text()).toContain("入口第一排");
    expect(wrapper.getComponent(RouterLinkStub).props("to")).toBe(
      "/markets/fengjia",
    );
  });

  it("hides immediate takeaway when restaurant is closed", () => {
    const wrapper = mount(RestaurantCard, {
      props: {
        restaurant: {
          restaurantId: "r1",
          name: "雞排攤",
          type: "snack",
          district: "西屯區",
          priceRange: 1,
          rating: 4.5,
          isOpen: false,
          supportsTakeaway: true,
          supportsDelivery: false,
          imageUrl: null,
        },
      },
      global: {
        plugins: [createPinia()],
      },
    });

    expect(
      wrapper.find('[data-testid="restaurant-takeaway-button"]').exists(),
    ).toBe(false);
  });

  it("emits a table-reservation action for a restaurant", async () => {
    const restaurant = {
      restaurantId: "r1",
      name: "雞排攤",
      type: "snack",
      district: "西屯區",
      priceRange: 1,
      rating: 4.5,
      isOpen: true,
      supportsTakeaway: false,
      supportsDelivery: false,
      imageUrl: null,
    };
    const wrapper = mount(RestaurantCard, {
      props: { restaurant },
      global: { plugins: [createPinia()] },
    });

    await wrapper
      .get('[data-testid="restaurant-reservation-button"]')
      .trigger("click");

    expect(wrapper.emitted("reserve")).toEqual([[restaurant]]);
  });

  it("does not expose onboarding placeholders and distinguishes missing hours", () => {
    const wrapper = mount(RestaurantCard, {
      props: {
        restaurant: {
          restaurantId: "r1",
          name: "Demo Noodles",
          type: "onboarding",
          city: "台中市",
          district: "onboarding-demo-noodles",
          priceRange: null,
          rating: null,
          isOpen: false,
          openingHoursStatus: "unavailable",
          supportsTakeaway: false,
          supportsDelivery: false,
          imageUrl: null,
        },
      },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.text()).toContain("台中市");
    expect(wrapper.text()).not.toContain("onboarding");
    expect(
      wrapper.get('[data-testid="restaurant-hours-unavailable"]').text(),
    ).toBe("discovery.hoursUnavailable");
    expect(wrapper.text()).not.toContain("discovery.closed");
  });

  it("hides placeholder districts and labels missing hours on dish results", () => {
    const wrapper = mount(DishResultCard, {
      props: {
        dish: {
          menuItemId: 1,
          dishName: "Demo Bao",
          price: 60,
          categoryName: null,
          restaurantId: "r1",
          restaurantName: "Demo Stall",
          district: "onboarding-demo-stall",
          isOpen: false,
          openingHoursStatus: "unavailable",
          supportsTakeaway: false,
          supportsDelivery: false,
          tags: [],
        },
      },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.text()).not.toContain("onboarding");
    expect(wrapper.get('[data-testid="dish-hours-unavailable"]').text()).toBe(
      "discovery.hoursUnavailable",
    );
  });

  it("shows available service labels on restaurant results", () => {
    const wrapper = mount(RestaurantCard, {
      props: {
        restaurant: {
          restaurantId: "r1",
          name: "雞排攤",
          type: "snack",
          district: "西屯區",
          priceRange: 1,
          rating: 4.5,
          isOpen: true,
          supportsTakeaway: true,
          supportsDelivery: true,
          imageUrl: null,
        },
      },
      global: {
        plugins: [createPinia()],
      },
    });

    expect(
      wrapper.get('[data-testid="restaurant-service-labels"]').text(),
    ).toContain("可外帶");
    expect(
      wrapper.get('[data-testid="restaurant-service-labels"]').text(),
    ).toContain("可外送");
  });

  it("shows distance metadata on restaurant results", () => {
    const wrapper = mount(RestaurantCard, {
      props: {
        restaurant: {
          restaurantId: "r1",
          name: "雞排攤",
          type: "snack",
          district: "西屯區",
          priceRange: 1,
          rating: 4.5,
          isOpen: true,
          supportsTakeaway: true,
          supportsDelivery: true,
          imageUrl: null,
          distanceKm: 0.32,
        },
      },
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.text()).toContain("0.3 km");
  });

  it("links restaurant results back to their market context", () => {
    const wrapper = mount(RestaurantCard, {
      props: {
        restaurant: {
          restaurantId: "r1",
          name: "包子攤",
          type: "street_food",
          district: "西屯區",
          priceRange: null,
          rating: null,
          isOpen: true,
          supportsTakeaway: false,
          supportsDelivery: false,
          imageUrl: null,
          marketVendor: {
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            marketUrl: "/markets/fengjia",
            stallNumber: "G-12",
            locationLabel: "入口第一排",
            isPrimary: true,
          },
        },
      },
      global: {
        plugins: [createPinia()],
        stubs: { RouterLink: RouterLinkStub },
      },
    });

    const link = wrapper.get('[data-testid="restaurant-market-link"]');
    expect(link.text()).toContain("逢甲夜市");
    expect(link.text()).toContain("G-12");
    expect(link.text()).toContain("入口第一排");
    expect(wrapper.getComponent(RouterLinkStub).props("to")).toBe(
      "/markets/fengjia",
    );
  });
});
