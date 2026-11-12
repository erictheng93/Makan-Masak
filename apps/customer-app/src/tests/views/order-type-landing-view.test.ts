import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderTypeLandingView from "@/views/OrderTypeLandingView.vue";
import { menuApi } from "@/services/menuApi";
import { shopQrApi } from "@/services/shopQrApi";

const routerPush = vi.hoisted(() => vi.fn());
const routeQuery = vi.hoisted(() => ({
  qr: "SHOP-restaurant-1",
  itemId: "42",
  categoryName: "小吃",
  returnPath: "/markets/fengjia",
  returnLabel: "逢甲夜市",
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/stores/shopCart", () => ({
  useShopCartStore: () => ({
    setFulfillmentType: vi.fn(),
    setDeliveryFee: vi.fn(),
  }),
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: {
    getRestaurant: vi.fn(),
  },
}));

vi.mock("@/services/shopQrApi", () => ({
  shopQrApi: {
    verify: vi.fn(),
  },
}));

describe("OrderTypeLandingView", () => {
  beforeEach(() => {
    routerPush.mockReset();
    vi.mocked(shopQrApi.verify).mockReset();
    vi.mocked(shopQrApi.verify).mockResolvedValue({
      valid: true,
      restaurantId: "restaurant-1",
    });
    delete (
      routeQuery as Partial<typeof routeQuery> & {
        serviceItemId?: string;
      }
    ).serviceItemId;
    Object.assign(routeQuery, {
      qr: "SHOP-restaurant-1",
      itemId: "42",
      categoryName: "小吃",
      returnPath: "/markets/fengjia",
      returnLabel: "逢甲夜市",
    });
    vi.mocked(menuApi.getRestaurant).mockResolvedValue({
      id: "restaurant-1",
      name: "市場入口店",
      enableShopMode: true,
      settings: {
        enableDineIn: true,
        enableTakeaway: true,
        enableDelivery: true,
      },
    } as never);
  });

  it("preserves market item deep-link query when dine-in opens the shop menu", async () => {
    const wrapper = mount(OrderTypeLandingView, {
      props: { restaurantId: "restaurant-1" },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="continue-btn"]').exists()).toBe(true);
    });
    const choices = wrapper.findAll('input[type="radio"]');
    expect(choices).toHaveLength(3);
    expect(
      choices.filter((choice) => (choice.element as HTMLInputElement).checked),
    ).toHaveLength(1);
    await choices[1].setValue(true);
    expect((choices[1].element as HTMLInputElement).checked).toBe(true);
    expect((choices[0].element as HTMLInputElement).checked).toBe(false);
    await choices[0].setValue(true);
    await wrapper.get('[data-testid="continue-btn"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        qr: "SHOP-restaurant-1",
        itemId: "42",
        categoryName: "小吃",
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
        fulfillmentType: "dine-in",
      },
    });
  });

  it("preserves market service deep-link query when dine-in opens the shop menu", async () => {
    delete (routeQuery as Partial<typeof routeQuery>).itemId;
    delete (routeQuery as Partial<typeof routeQuery>).categoryName;
    Object.assign(routeQuery, {
      serviceItemId: "7",
    });

    const wrapper = mount(OrderTypeLandingView, {
      props: { restaurantId: "restaurant-1" },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="continue-btn"]').exists()).toBe(true);
    });
    await wrapper.get('[data-testid="continue-btn"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopMenu",
      params: { restaurantId: "restaurant-1" },
      query: {
        qr: "SHOP-restaurant-1",
        serviceItemId: "7",
        returnPath: "/markets/fengjia",
        returnLabel: "逢甲夜市",
        fulfillmentType: "dine-in",
      },
    });
  });

  it("shows an empty state when no fulfillment methods are enabled", async () => {
    vi.mocked(menuApi.getRestaurant).mockResolvedValueOnce({
      id: "restaurant-1",
      name: "市場入口店",
      description:
        "Provisioned from onboarding application APP-20260727-4OG1RRGC; owner must complete the restaurant profile before publishing.",
      enableShopMode: true,
      settings: {
        enableDineIn: false,
        enableTakeaway: false,
        enableDelivery: false,
      },
    } as never);

    const wrapper = mount(OrderTypeLandingView, {
      props: { restaurantId: "restaurant-1" },
    });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("orderTypeLanding.noMethodsTitle");
    });

    expect(wrapper.text()).toContain("orderTypeLanding.noMethodsDescription");
    expect(wrapper.text()).not.toContain("Provisioned from onboarding");
    expect(wrapper.find('[data-testid="continue-btn"]').exists()).toBe(false);
  });

  it("hides descriptions explicitly marked as onboarding placeholders", async () => {
    vi.mocked(menuApi.getRestaurant).mockResolvedValueOnce({
      id: "restaurant-1",
      name: "市場入口店",
      description:
        "Owner must complete the restaurant profile before publishing.",
      isPlaceholderDescription: true,
      enableShopMode: true,
      settings: {
        enableDineIn: true,
        enableTakeaway: false,
        enableDelivery: false,
      },
    } as never);

    const wrapper = mount(OrderTypeLandingView, {
      props: { restaurantId: "restaurant-1" },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="continue-btn"]').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain("市場入口店");
    expect(wrapper.text()).not.toContain("Owner must complete");
  });
  // #188: the page used to decide it could order from the route params alone.
  // These cover the three ways the server can say otherwise.
  describe("trusting the server over the route", () => {
    // Drains the microtask queue instead of polling on a wall-clock deadline:
    // both requests are mocked, so the state is reachable in a fixed number of
    // ticks, and `vi.waitFor`'s 1s default was tight enough to flake under a
    // loaded parallel run.
    async function mountAndSettle() {
      const wrapper = mount(OrderTypeLandingView, {
        props: { restaurantId: "restaurant-1" },
      });
      await flushPromises();
      expect(wrapper.find('[data-testid="shop-entry-blocked"]').exists()).toBe(
        true,
      );
      return wrapper;
    }

    it("blocks a QR the shop has since regenerated", async () => {
      vi.mocked(shopQrApi.verify).mockResolvedValue({ valid: false });

      const wrapper = await mountAndSettle();

      expect(shopQrApi.verify).toHaveBeenCalledWith("SHOP-restaurant-1");
      expect(
        wrapper
          .get('[data-testid="shop-entry-blocked"]')
          .attributes("data-block-reason"),
      ).toBe("qrRevoked");
      expect(wrapper.text()).toContain("orderTypeLanding.qrRevokedTitle");
      expect(wrapper.find('[data-testid="continue-btn"]').exists()).toBe(false);
    });

    it("blocks a QR that verifies against a different restaurant", async () => {
      vi.mocked(shopQrApi.verify).mockResolvedValue({
        valid: true,
        restaurantId: "restaurant-2",
      });

      const wrapper = await mountAndSettle();

      expect(
        wrapper
          .get('[data-testid="shop-entry-blocked"]')
          .attributes("data-block-reason"),
      ).toBe("qrRevoked");
    });

    // Found on production: with shop mode off every code fails verification,
    // and the diner was told the shop had changed its sticker.
    it("says the shop is not taking orders, not that the sticker is stale, when shop mode is off", async () => {
      vi.mocked(shopQrApi.verify).mockResolvedValue({ valid: false });
      vi.mocked(menuApi.getRestaurant).mockResolvedValue({
        id: "restaurant-1",
        name: "市場入口店",
        enableShopMode: false,
        settings: { enableDineIn: true },
      } as never);

      const wrapper = await mountAndSettle();

      expect(shopQrApi.verify).toHaveBeenCalledWith("SHOP-restaurant-1");
      expect(
        wrapper
          .get('[data-testid="shop-entry-blocked"]')
          .attributes("data-block-reason"),
      ).toBe("shopDisabled");
    });

    it("blocks the no-QR path when the shop has shop mode switched off", async () => {
      delete (routeQuery as Partial<typeof routeQuery>).qr;
      vi.mocked(menuApi.getRestaurant).mockResolvedValue({
        id: "restaurant-1",
        name: "市場入口店",
        enableShopMode: false,
        settings: {
          enableDineIn: true,
          enableTakeaway: true,
          enableDelivery: true,
        },
      } as never);

      const wrapper = await mountAndSettle();

      // Nothing to verify without a code — the flag is the whole answer.
      expect(shopQrApi.verify).not.toHaveBeenCalled();
      expect(
        wrapper
          .get('[data-testid="shop-entry-blocked"]')
          .attributes("data-block-reason"),
      ).toBe("shopDisabled");
      expect(wrapper.text()).toContain("orderTypeLanding.shopDisabledTitle");
      expect(wrapper.find('[data-testid="continue-btn"]').exists()).toBe(false);
    });

    it("offers a retry rather than a verdict when verification cannot be reached", async () => {
      vi.mocked(shopQrApi.verify).mockRejectedValue(new Error("Network Error"));

      const wrapper = mount(OrderTypeLandingView, {
        props: { restaurantId: "restaurant-1" },
      });

      await flushPromises();

      expect(wrapper.text()).toContain("toast.restaurantLoadFailed");
      expect(wrapper.find('[data-testid="shop-entry-blocked"]').exists()).toBe(
        false,
      );
    });
  });

  describe("continuing to the menu", () => {
    function mockShop(overrides: Record<string, unknown> = {}) {
      vi.mocked(menuApi.getRestaurant).mockResolvedValue({
        id: "restaurant-1",
        name: "市場入口店",
        enableShopMode: true,
        settings: {
          enableDineIn: false,
          enableTakeaway: true,
          enableDelivery: false,
          ...overrides,
        },
      } as never);
    }

    async function clickContinue() {
      const wrapper = mount(OrderTypeLandingView, {
        props: { restaurantId: "restaurant-1" },
      });
      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="continue-btn"]').exists()).toBe(
          true,
        );
      });
      await wrapper.get('[data-testid="continue-btn"]').trigger("click");
    }

    it("goes straight to the menu for takeaway", async () => {
      // There is no pickup-digits screen between the two any more; the order
      // number is the pickup identifier.
      mockShop();

      await clickContinue();

      expect(routerPush).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ShopMenu",
          query: expect.objectContaining({ fulfillmentType: "takeaway" }),
        }),
      );
    });

    it("goes straight to the menu for dine-in", async () => {
      mockShop({ enableDineIn: true, enableTakeaway: false });

      await clickContinue();

      expect(routerPush).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ShopMenu",
          query: expect.objectContaining({ fulfillmentType: "dine-in" }),
        }),
      );
    });
  });
});
