/**
 * #188: `ShopMenuView` is reachable without passing `OrderTypeLandingView` —
 * market and discovery vendor links open it directly, and so does a bookmark.
 * It therefore has to ask the same two questions itself, and answer them by
 * removing ordering rather than the menu.
 */
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopMenuView from "@/views/ShopMenuView.vue";

const toastError = vi.hoisted(() => vi.fn());
const shopCartAddItem = vi.hoisted(() => vi.fn());

/** Flipped per test; read by the `useQuery` mock below. */
const shopState = vi.hoisted(() => ({
  enableShopMode: true as boolean,
  verification: undefined as
    | undefined
    | { valid: boolean; restaurantId?: string },
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    path: "/restaurant/restaurant-1/shop/menu",
    fullPath: "/restaurant/restaurant-1/shop/menu",
  }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

// ShopMenuView renders the shop's review block, which reaches for the API the
// moment someone opens it. Nothing in this suite opens it; the mock only keeps
// `@/services/api` (and its required VITE_API_BASE_URL) out of the graph.
vi.mock("@/services/orderApi", () => ({
  orderApi: { getRestaurantReviews: vi.fn() },
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: toastError }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
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
    addItem: shopCartAddItem,
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
  }),
}));

vi.mock("@/stores/marketCart", () => ({
  useMarketCartStore: () => ({
    addItem: vi.fn(),
    cartForMarket: vi.fn(() => null),
    itemCountForCart: vi.fn(() => 0),
    subtotalForCart: vi.fn(() => 0),
  }),
}));

vi.mock("@/utils/seoMeta", () => ({ applyShopMenuSeoMeta: vi.fn() }));

// Kept real enough to prove the button state, since "can browse, cannot order"
// is exactly what the disabled attribute carries.
vi.mock("@/components/MenuItemCard.vue", () => ({
  default: {
    props: ["item", "isFeatured", "anchorId", "orderingDisabled"],
    emits: ["addToCart", "viewDetails"],
    template: `
      <article data-testid="menu-card">
        {{ item.name }}
        <button
          type="button"
          data-testid="menu-card-add"
          :disabled="orderingDisabled"
          @click="$emit('addToCart', { item, quantity: 1 })"
        >add</button>
        <!--
          Stands in for a surface that never got the flag — the detail modal
          reached through "view details", or a future one. The view's own guard
          is what has to stop this.
        -->
        <button
          type="button"
          data-testid="menu-card-add-unguarded"
          @click="$emit('addToCart', { item, quantity: 1 })"
        >add anyway</button>
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
  default: {
    props: ["show", "restaurantId", "shopQrCode", "orderingDisabled"],
    template: `<div data-testid="cart-modal" :data-ordering-disabled="String(!!orderingDisabled)" />`,
  },
}));
vi.mock("@/components/DesktopCartPanel.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@tanstack/vue-query", () => ({
  useQuery: (options: { queryKey: string[] }) => {
    const stub = { isLoading: ref(false), error: ref(null), refetch: vi.fn() };

    if (options.queryKey[0] === "restaurant") {
      return {
        ...stub,
        data: ref({
          id: "restaurant-1",
          name: "測試店",
          enableShopMode: shopState.enableShopMode,
          settings: { currency: "TWD" },
        }),
      };
    }

    if (options.queryKey[0] === "shop-qr-verify") {
      return { ...stub, data: ref(shopState.verification) };
    }

    if (options.queryKey[0] === "menu") {
      return {
        ...stub,
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
          menuItems: [
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
      };
    }

    if (options.queryKey[0] === "restaurant-markets") {
      return { ...stub, data: ref({ memberships: [] }) };
    }

    return { ...stub, data: ref([]) };
  },
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: { getRestaurant: vi.fn(), getMenu: vi.fn() },
}));
vi.mock("@/services/discoveryApi", () => ({
  discoveryApi: { getRestaurantMarkets: vi.fn() },
}));
vi.mock("@/services/restaurantContactApi", () => ({
  restaurantContactApi: { listServiceItems: vi.fn() },
}));
vi.mock("@/services/shopQrApi", () => ({
  shopQrApi: { verify: vi.fn() },
}));

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(ShopMenuView, {
    props: { restaurantId: "restaurant-1", ...props },
  });
}

describe("ShopMenuView ordering gate", () => {
  beforeEach(() => {
    toastError.mockReset();
    shopCartAddItem.mockReset();
    shopState.enableShopMode = true;
    shopState.verification = undefined;
  });

  it("orders normally when the shop channel is open", () => {
    const wrapper = mountMenu();

    expect(wrapper.find('[data-testid="shop-ordering-blocked"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.get('[data-testid="menu-card-add"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("keeps the menu but stops ordering when shop mode is off", async () => {
    shopState.enableShopMode = false;

    const wrapper = mountMenu();

    const banner = wrapper.get('[data-testid="shop-ordering-blocked"]');
    expect(banner.attributes("data-block-reason")).toBe("shopDisabled");
    expect(banner.text()).toContain("shopMenu.shopDisabledTitle");

    // The menu itself is untouched — that is the whole point of this state.
    expect(wrapper.find('[data-testid="menu-card"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("章魚燒");

    expect(
      wrapper.get('[data-testid="menu-card-add"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper
        .get('[data-testid="cart-modal"]')
        .attributes("data-ordering-disabled"),
    ).toBe("true");
  });

  it("stops ordering when the code that got here has been retired", () => {
    shopState.verification = { valid: false };

    const wrapper = mountMenu({ shopQrCode: "SHOP-restaurant-1-old" });

    expect(
      wrapper
        .get('[data-testid="shop-ordering-blocked"]')
        .attributes("data-block-reason"),
    ).toBe("qrRevoked");
    expect(wrapper.find('[data-testid="menu-card"]').exists()).toBe(true);
  });

  it("stops ordering when the code verifies against another restaurant", () => {
    shopState.verification = { valid: true, restaurantId: "restaurant-2" };

    const wrapper = mountMenu({ shopQrCode: "SHOP-restaurant-2-1" });

    expect(
      wrapper
        .get('[data-testid="shop-ordering-blocked"]')
        .attributes("data-block-reason"),
    ).toBe("qrRevoked");
  });

  it("refuses the add itself, not just the button", async () => {
    shopState.enableShopMode = false;

    const wrapper = mountMenu();
    await wrapper
      .get('[data-testid="menu-card-add-unguarded"]')
      .trigger("click");

    expect(shopCartAddItem).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("shopMenu.shopDisabledTitle");
  });

  it("still adds through that same surface when the channel is open", async () => {
    const wrapper = mountMenu();
    await wrapper
      .get('[data-testid="menu-card-add-unguarded"]')
      .trigger("click");

    expect(shopCartAddItem).toHaveBeenCalledOnce();
    expect(toastError).not.toHaveBeenCalled();
  });
});
