import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopMenuView from "@/views/ShopMenuView.vue";
import { menuApi } from "@/services/menuApi";
import { discoveryApi } from "@/services/discoveryApi";
import { restaurantContactApi } from "@/services/restaurantContactApi";

const routerPush = vi.hoisted(() => vi.fn());
const marketCartAddItem = vi.hoisted(() => vi.fn());
const menuItemsFixture = vi.hoisted(() => ({
  items: null as Array<Record<string, unknown>> | null,
}));
const serviceItemsFixture = vi.hoisted(() => ({
  items: null as Array<Record<string, unknown>> | null,
}));
const marketMembershipsFixture = vi.hoisted(() => ({
  memberships: null as Array<Record<string, unknown>> | null,
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    path: "/restaurant/restaurant-1/shop/menu",
    fullPath:
      "/restaurant/restaurant-1/shop/menu?services=true&returnPath=/markets/fengjia",
  }),
  useRouter: () => ({ back: vi.fn(), push: routerPush }),
}));

// ShopMenuView renders the shop's review block, which reaches for the API the
// moment someone opens it. Nothing in this suite opens it; the mock only keeps
// `@/services/api` (and its required VITE_API_BASE_URL) out of the graph.
vi.mock("@/services/orderApi", () => ({
  orderApi: { getRestaurantReviews: vi.fn() },
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    // Every param, not just `name`: the entry-context banner nests one
    // translated label inside another via `target`, so a mock that only
    // interpolated `name` rendered "undefined" and hid what it was asserting.
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
  }),
}));

vi.mock("@/composables/useBreakpoint", () => ({
  useIsDesktop: () => ref(false),
}));

vi.mock("@/stores/app", () => ({
  useAppStore: () => ({
    currentRestaurant: null,
    setRestaurantContext: vi.fn(),
  }),
}));

vi.mock("@/stores/shopCart", () => ({
  useShopCartStore: () => ({
    itemCount: 0,
    items: [],
    subtotal: 0,
    fulfillmentType: "takeaway",
    initializeCart: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
  }),
}));

vi.mock("@/stores/marketCart", () => ({
  useMarketCartStore: () => ({
    addItem: marketCartAddItem,
    cartForMarket: vi.fn(() => null),
    itemCountForCart: vi.fn(() => 0),
    subtotalForCart: vi.fn(() => 0),
  }),
}));

vi.mock("@/utils/seoMeta", () => ({
  applyShopMenuSeoMeta: vi.fn(),
}));

vi.mock("@/components/MenuItemCard.vue", () => ({
  default: {
    props: ["item", "isFeatured", "anchorId"],
    emits: ["addToCart", "viewDetails"],
    template: `
      <article
        :id="anchorId === null ? undefined : anchorId"
        :data-testid="isFeatured ? 'featured-menu-card' : 'menu-card'"
      >
        {{ item.name }}
        <button
          type="button"
          data-testid="menu-card-add"
          @click="$emit('addToCart', { item, quantity: 1 })"
        >
          add
        </button>
      </article>
    `,
  },
}));

vi.mock("@/components/MenuItemModal.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@/components/CustomizationModal.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@/components/ShopCartModal.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@/components/DesktopCartPanel.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@tanstack/vue-query", () => ({
  useQuery: (options: { queryKey: string[]; queryFn: () => unknown }) => {
    if (options.queryKey[0] === "restaurant") {
      return {
        data: ref({
          id: "restaurant-1",
          name: "服務測試店",
          enableShopMode: true,
          settings: { currency: "TWD" },
        }),
        isLoading: ref(false),
        error: ref(null),
        refetch: vi.fn(),
      };
    }

    // No `?qr=` in this suite's route, so the verification never runs. Matched
    // explicitly anyway — the fallthrough below returns service items, which
    // would read as a failed verification and block ordering.
    if (options.queryKey[0] === "shop-qr-verify") {
      return {
        data: ref(undefined),
        isLoading: ref(false),
        error: ref(null),
        refetch: vi.fn(),
      };
    }

    if (options.queryKey[0] === "menu") {
      return {
        data: ref({
          categories: [
            {
              id: 10,
              restaurantId: "restaurant-1",
              name: "小吃",
              sortOrder: 0,
              status: 1,
            },
          ],
          menuItems:
            menuItemsFixture.items !== null
              ? menuItemsFixture.items
              : [
                  {
                    id: 42,
                    restaurantId: "restaurant-1",
                    categoryId: 10,
                    name: "章魚燒",
                    price: 8000,
                    spiceLevel: 0,
                    sortOrder: 1,
                    isAvailable: true,
                    isFeatured: false,
                    inventoryCount: null,
                    orderCount: 0,
                    createdAt: "",
                    updatedAt: "",
                  },
                ],
        }),
        isLoading: ref(false),
        error: ref(null),
        refetch: vi.fn(),
      };
    }

    if (options.queryKey[0] === "restaurant-markets") {
      return {
        data: ref({
          memberships:
            marketMembershipsFixture.memberships !== null
              ? marketMembershipsFixture.memberships
              : [
                  {
                    marketId: "market-1",
                    stallNumber: "A-18",
                    isPrimary: true,
                    market: {
                      id: "market-1",
                      slug: "fengjia",
                      name: "逢甲夜市",
                      type: "night_market",
                      city: "台中市",
                      district: "西屯區",
                    },
                    marketUrl: "/markets/fengjia",
                  },
                ],
        }),
        isLoading: ref(false),
        error: ref(null),
        refetch: vi.fn(),
      };
    }

    return {
      data: ref(
        serviceItemsFixture.items !== null
          ? serviceItemsFixture.items
          : [
              {
                id: 1,
                restaurantId: "restaurant-1",
                name: "預約外送",
                description: "滿額可預約外送",
                serviceType: "delivery",
                priceLabel: "依距離報價",
                requiresBooking: true,
                sortOrder: 0,
                isActive: true,
                isPublic: true,
                createdAt: "",
                updatedAt: "",
              },
            ],
      ),
      isLoading: ref(false),
      error: ref(null),
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: {
    getRestaurant: vi.fn(),
    getMenu: vi.fn(),
  },
}));

vi.mock("@/services/shopQrApi", () => ({
  shopQrApi: {
    verify: vi.fn(),
  },
}));

vi.mock("@/services/discoveryApi", () => ({
  discoveryApi: {
    getRestaurantMarkets: vi.fn(),
  },
}));

vi.mock("@/services/restaurantContactApi", () => ({
  restaurantContactApi: {
    listServiceItems: vi.fn(),
  },
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (amount: number) => `NT$${amount}`,
    currencyCode: computed(() => "TWD"),
  }),
}));

describe("ShopMenuView service items", () => {
  let scrollIntoView: Element["scrollIntoView"];

  beforeEach(() => {
    routerPush.mockReset();
    marketCartAddItem.mockReset();
    menuItemsFixture.items = null;
    serviceItemsFixture.items = null;
    marketMembershipsFixture.memberships = null;
    scrollIntoView = vi.fn() as Element["scrollIntoView"];
    Element.prototype.scrollIntoView = scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
  });

  it("renders public restaurant service items beside the menu", () => {
    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1" },
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    expect(menuApi.getRestaurant).toBeDefined();
    expect(restaurantContactApi.listServiceItems).toBeDefined();
    expect(wrapper.get('[data-testid="shop-service-items"]').text()).toContain(
      "預約外送",
    );
    expect(wrapper.get('[data-testid="shop-service-items"]').text()).toContain(
      "滿額可預約外送",
    );
    expect(wrapper.get('[data-testid="shop-service-items"]').text()).toContain(
      "依距離報價",
    );
  });

  it("highlights and scrolls to a linked service item", async () => {
    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1", linkedServiceItemId: "1" },
      attachTo: document.body,
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const service = wrapper.get("#service-item-1");
    expect(service.classes()).toContain("border-ios-blue");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    wrapper.unmount();
  });

  it("scrolls to the public services section from a vendor service link", async () => {
    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1", linkedServices: "true" },
      attachTo: document.body,
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.find("#shop-service-items").exists()).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    wrapper.unmount();
  });

  it("opens the internal service booking flow for bookable services", async () => {
    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1", linkedServices: "true" },
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-testid="shop-service-booking"]').trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "ServiceBooking",
      params: {
        restaurantId: "restaurant-1",
        serviceItemId: "1",
      },
    });
    wrapper.unmount();
  });

  it("shows the linked service target and returns to the search context", async () => {
    const wrapper = mount(ShopMenuView, {
      props: {
        restaurantId: "restaurant-1",
        linkedServiceItemId: "1",
        returnPath: "/discover?q=%E5%A4%96%E9%80%81",
        returnLabel: "搜尋結果",
      },
      global: {
        stubs: {
          MenuItemCard: true,
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    const context = wrapper.get('[data-testid="shop-menu-entry-context"]');
    expect(context.text()).toContain("預約外送");
    expect(context.text()).toContain("搜尋結果");

    await wrapper
      .get('[data-testid="shop-menu-return-context"]')
      .trigger("click");

    expect(routerPush).toHaveBeenCalledWith("/discover?q=%E5%A4%96%E9%80%81");
  });

  it("shows public market membership and opens the market page with shop return context", async () => {
    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1" },
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    expect(discoveryApi.getRestaurantMarkets).toBeDefined();
    const marketContext = wrapper.get('[data-testid="shop-market-context"]');
    expect(marketContext.text()).toContain("逢甲夜市");
    expect(marketContext.text()).toContain("夜市");
    expect(marketContext.text()).toContain("A-18");

    await wrapper
      .get('[data-testid="shop-market-link-fengjia"]')
      .trigger("click");

    expect(routerPush).toHaveBeenCalledWith(
      "/markets/fengjia?returnPath=%2Frestaurant%2Frestaurant-1%2Fshop%2Fmenu%3Fservices%3Dtrue%26returnPath%3D%2Fmarkets%2Ffengjia&returnLabel=%E6%9C%8D%E5%8B%99%E6%B8%AC%E8%A9%A6%E5%BA%97",
    );
  });

  it("shows market membership venue types on shop menus", () => {
    marketMembershipsFixture.memberships = [
      {
        marketId: "market-2",
        stallNumber: "B-02",
        isPrimary: true,
        market: {
          id: "market-2",
          slug: "jingming",
          name: "精明街區",
          type: "commercial_district",
          city: "台中市",
          district: "西區",
        },
        marketUrl: "/markets/jingming",
      },
    ];

    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1" },
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    const marketContext = wrapper.get('[data-testid="shop-market-context"]');
    expect(marketContext.text()).toContain("精明街區");
    expect(
      wrapper.get('[data-testid="shop-market-type-jingming"]').text(),
    ).toBe("markets.type.commercial_district");
    expect(marketContext.text()).toContain("B-02");
  });

  it("mirrors market-origin menu additions into the market basket", async () => {
    const wrapper = mount(ShopMenuView, {
      props: {
        restaurantId: "restaurant-1",
        returnPath: "/markets/fengjia?q=%E9%9B%9E%E6%8E%92",
        returnLabel: "逢甲夜市",
      },
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    await wrapper.get('[data-testid="menu-card-add"]').trigger("click");

    expect(marketCartAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        marketSlug: "fengjia",
        marketName: "逢甲夜市",
        restaurantId: "restaurant-1",
        restaurantName: "服務測試店",
        quantity: 1,
      }),
    );
  });

  it("shows the linked menu item target when opening from a dish result", () => {
    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1", linkedItemId: "42" },
      global: {
        stubs: {
          MenuItemCard: true,
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    expect(
      wrapper.get('[data-testid="shop-menu-entry-context"]').text(),
    ).toContain("章魚燒");
  });

  it("keeps linked menu item anchors on category cards instead of featured duplicates", () => {
    menuItemsFixture.items = [
      {
        id: 42,
        restaurantId: "restaurant-1",
        categoryId: 10,
        name: "章魚燒",
        price: 8000,
        spiceLevel: 0,
        sortOrder: 1,
        isAvailable: true,
        isFeatured: true,
        inventoryCount: null,
        orderCount: 0,
        createdAt: "",
        updatedAt: "",
      },
    ];

    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1", linkedItemId: "42" },
      global: {
        stubs: {
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    expect(
      wrapper.get('[data-testid="featured-menu-card"]').attributes("id"),
    ).toBeUndefined();
    expect(wrapper.get('[data-testid="menu-card"]').attributes("id")).toBe(
      "menu-item-42",
    );
  });

  it("keeps service-only shops usable when no menu items are published", () => {
    menuItemsFixture.items = [];

    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1" },
      global: {
        stubs: {
          MenuItemCard: true,
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    expect(wrapper.get('[data-testid="shop-service-items"]').text()).toContain(
      "預約外送",
    );
    expect(wrapper.get('[data-testid="shop-empty-menu"]').text()).toContain(
      "尚未提供可點選的菜單商品",
    );
    expect(wrapper.find('[data-testid="shop-empty-services"]').exists()).toBe(
      false,
    );
  });

  it("keeps menu-only shops clear when no public services are published", () => {
    serviceItemsFixture.items = [];

    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1" },
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    expect(wrapper.get('[data-testid="menu-card"]').text()).toContain("章魚燒");
    expect(wrapper.get('[data-testid="shop-empty-services"]').text()).toContain(
      "尚未提供公開服務",
    );
    expect(wrapper.find('[data-testid="shop-empty-menu"]').exists()).toBe(
      false,
    );
  });

  it("filters dish items by canonical and English names", async () => {
    menuItemsFixture.items = [
      {
        id: 42,
        restaurantId: "restaurant-1",
        categoryId: 10,
        catalogType: "menu_item",
        name: "Original Chicken",
        nameEn: "Hainanese Chicken Rice",
        price: 8000,
        spiceLevel: 0,
        sortOrder: 1,
        isAvailable: true,
        isFeatured: false,
        inventoryCount: null,
        orderCount: 0,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: 43,
        restaurantId: "restaurant-1",
        categoryId: 10,
        catalogType: "menu_item",
        name: "Original Noodles",
        nameEn: "Soup Noodles",
        price: 9000,
        spiceLevel: 0,
        sortOrder: 2,
        isAvailable: true,
        isFeatured: false,
        inventoryCount: null,
        orderCount: 0,
        createdAt: "",
        updatedAt: "",
      },
    ];

    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1" },
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    const searchInput = wrapper.get('input[type="text"]');

    await searchInput.setValue("hainanese");
    const englishSearchResults = wrapper
      .findAll('[data-testid="menu-card"]')
      .map((card) => card.text());
    expect(englishSearchResults).toHaveLength(1);
    expect(englishSearchResults[0]).toContain("Original Chicken");
    expect(englishSearchResults[0]).not.toContain("Original Noodles");

    await searchInput.setValue("Original Noodles");
    const canonicalSearchResults = wrapper
      .findAll('[data-testid="menu-card"]')
      .map((card) => card.text());
    expect(canonicalSearchResults).toHaveLength(1);
    expect(canonicalSearchResults[0]).toContain("Original Noodles");
    expect(canonicalSearchResults[0]).not.toContain("Original Chicken");
  });

  it("separates dish menu items from product catalog items", () => {
    menuItemsFixture.items = [
      {
        id: 42,
        restaurantId: "restaurant-1",
        categoryId: 10,
        catalogType: "menu_item",
        name: "章魚燒",
        price: 8000,
        spiceLevel: 0,
        sortOrder: 1,
        isAvailable: true,
        isFeatured: false,
        inventoryCount: null,
        orderCount: 0,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: 77,
        restaurantId: "restaurant-1",
        categoryId: 10,
        catalogType: "product",
        name: "夜市限定杯套",
        price: 12000,
        spiceLevel: 0,
        sortOrder: 2,
        isAvailable: true,
        isFeatured: false,
        inventoryCount: null,
        orderCount: 0,
        createdAt: "",
        updatedAt: "",
      },
    ];

    const wrapper = mount(ShopMenuView, {
      props: { restaurantId: "restaurant-1" },
      global: {
        stubs: {
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    const dishSection = wrapper.get('[data-testid="shop-dish-items"]');
    const productSection = wrapper.get('[data-testid="shop-product-items"]');

    expect(dishSection.text()).toContain("章魚燒");
    expect(dishSection.text()).not.toContain("夜市限定杯套");
    expect(productSection.text()).toContain("夜市限定杯套");
    expect(productSection.text()).not.toContain("章魚燒");
  });

  it("ignores unsafe return paths", async () => {
    const wrapper = mount(ShopMenuView, {
      props: {
        restaurantId: "restaurant-1",
        returnPath: "https://example.com/phishing",
        returnLabel: "外部網站",
      },
      global: {
        stubs: {
          MenuItemCard: true,
          MenuItemModal: true,
          CustomizationModal: true,
          ShopCartModal: true,
          DesktopCartPanel: true,
        },
      },
    });

    expect(
      wrapper.find('[data-testid="shop-menu-return-context"]').exists(),
    ).toBe(false);
  });
});
