import { flushPromises, mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CartView from "@/views/CartView.vue";

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const cartState = vi.hoisted(() => ({ subtotal: 100, quantity: 1 }));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string) => key,
    currentLanguage: ref("zh-TW"),
  }),
}));
// A formatter that owns its symbol, like the real one does.
vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (value: number) => `NT$${value}` }),
}));
vi.mock("@/stores/cart", () => ({
  useCartStore: () => ({
    isEmpty: false,
    get items() {
      return [
        {
          id: "item",
          menuItem: { id: 42 },
          quantity: reactive(cartState).quantity,
        },
      ];
    },
    get subtotal() {
      return reactive(cartState).subtotal;
    },
    initializeCart: vi.fn(),
    clearCart: vi.fn(),
    updateQuantity: vi.fn(),
    updateItemNotes: vi.fn(),
    removeItem: vi.fn(),
    getItemById: vi.fn(),
  }),
}));
vi.mock("@/services/orderApi", () => ({
  orderApi: { createOrder: vi.fn(), createGuestOrder: vi.fn() },
}));
vi.mock("@/services/api", () => ({
  apiClient: { get: apiGet, post: apiPost },
}));
vi.mock("@/services/menuApi", () => ({
  default: { getRestaurant: vi.fn() },
}));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({ data: ref({ name: "Demo Restaurant", settings: {} }) }),
  useMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/CartItemCard.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/ConfirmationModal.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/CouponRecommendation.vue", () => ({
  default: { template: "<div />" },
}));

describe("CartView coupon selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reactive(cartState).subtotal = 100;
    reactive(cartState).quantity = 1;
    apiGet.mockResolvedValue([
      {
        id: 1,
        code: "TEN",
        name: "Ten percent",
        discountType: "percentage",
        discountValue: 10,
      },
      {
        id: 2,
        code: "TWENTY",
        name: "Twenty percent",
        discountType: "percentage",
        discountValue: 20,
      },
    ]);
    apiPost.mockImplementation(
      async (_url: string, body: { codes: string[] }) => ({
        valid: true,
        appliedCoupons: body.codes.map((code, i) => ({
          couponId: i + 1,
          code,
          name: code,
          discountAmount: [10, 18, 5][i],
        })),
        discountAmount: [0, 10, 28, 33][body.codes.length],
      }),
    );
  });
  const render = () =>
    mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });
  const enterCode = async (
    wrapper: ReturnType<typeof render>,
    code: string,
  ) => {
    await wrapper.get('[data-testid="coupon-code"]').setValue(code);
    await wrapper.get('[data-testid="coupon-apply"]').trigger("click");
    await flushPromises();
  };

  it("selects two issued coupons, adds a code, and recomputes after removal", async () => {
    const wrapper = render();
    await wrapper.get('[data-testid="cart-view-coupons"]').trigger("click");
    await flushPromises();
    await wrapper.findAll('[role="checkbox"]')[0].trigger("keydown.space");
    await flushPromises();
    await wrapper.findAll('[role="checkbox"]')[1].trigger("click");
    await flushPromises();
    await enterCode(wrapper, " five ");
    expect(apiPost).toHaveBeenLastCalledWith("/coupons/validate", {
      codes: ["TEN", "TWENTY", "FIVE"],
      restaurantId: "restaurant-1",
      orderAmount: 100,
      menuItems: [{ menuItemId: 42, quantity: 1 }],
    });
    expect(
      wrapper
        .findAll('[data-testid="selected-coupon"]')
        .map((row) => row.text()),
    ).toEqual([
      expect.stringContaining("NT$10"),
      expect.stringContaining("NT$18"),
      expect.stringContaining("NT$5"),
    ]);
    expect(wrapper.get('[data-testid="submit-order-btn"]').text()).toContain(
      "NT$67",
    );
    await wrapper
      .get('[aria-label="cart.removeCoupon TWENTY"]')
      .trigger("click");
    await flushPromises();
    expect(apiPost).toHaveBeenLastCalledWith(
      "/coupons/validate",
      expect.objectContaining({ codes: ["TEN", "FIVE"] }),
    );
    expect(wrapper.findAll('[data-testid="selected-coupon"]')).toHaveLength(2);
    wrapper.unmount();
  });

  it("blocks incompatible or stale previews and allows removing an invalid selection", async () => {
    const wrapper = render();
    await enterCode(wrapper, "TEN");
    apiPost.mockResolvedValueOnce({
      valid: false,
      error: "Incompatible coupons",
    });
    await enterCode(wrapper, "OTHER");
    expect(wrapper.text()).toContain("Incompatible coupons");
    expect(
      wrapper.get('[data-testid="submit-order-btn"]').attributes("disabled"),
    ).toBeDefined();
    await wrapper
      .get('[aria-label="cart.removeCoupon OTHER"]')
      .trigger("click");
    await flushPromises();
    expect(
      wrapper.get('[data-testid="submit-order-btn"]').attributes("disabled"),
    ).toBeUndefined();
    let resolvePreview!: (value: unknown) => void;
    apiPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    reactive(cartState).subtotal = 200;
    await flushPromises();
    expect(
      wrapper.get('[data-testid="submit-order-btn"]').attributes("disabled"),
    ).toBeDefined();
    await wrapper.get('[aria-label="cart.removeCoupon TEN"]').trigger("click");
    resolvePreview({
      valid: true,
      appliedCoupons: [{ code: "TEN", discountAmount: 90 }],
      discountAmount: 90,
    });
    await flushPromises();
    expect(wrapper.get('[data-testid="submit-order-btn"]').text()).toContain(
      "NT$200",
    );
    expect(wrapper.findAll('[data-testid="selected-coupon"]')).toHaveLength(0);
    wrapper.unmount();
  });

  it("revalidates item quantities and ignores an earlier response", async () => {
    const wrapper = render();
    let resolveFirst!: (value: unknown) => void;
    apiPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await enterCode(wrapper, "TEN");
    reactive(cartState).quantity = 2;
    await flushPromises();
    expect(apiPost).toHaveBeenLastCalledWith(
      "/coupons/validate",
      expect.objectContaining({ menuItems: [{ menuItemId: 42, quantity: 2 }] }),
    );
    resolveFirst({ valid: false, error: "Old error" });
    await flushPromises();
    expect(wrapper.text()).not.toContain("Old error");
    expect(
      wrapper.get('[data-testid="submit-order-btn"]').attributes("disabled"),
    ).toBeUndefined();
    wrapper.unmount();
  });
  // formatPrice already carries the symbol; a literal `$` in front of it
  // printed "$NT$20" (#390).
  it("shows the currency symbol once in each fixed discount label", async () => {
    apiGet.mockResolvedValue([
      {
        id: 1,
        code: "TWENTY",
        name: "Twenty off",
        discountType: "fixed",
        discountValue: 20,
      },
    ]);
    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });

    await wrapper.find('[data-testid="cart-view-coupons"]').trigger("click");
    await flushPromises();
    expect(apiGet).toHaveBeenCalledWith("/coupons/available/restaurant-1");

    await wrapper.find("h5").trigger("click");
    expect(wrapper.text().split("NT$20 common.off")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("$NT$");
    wrapper.unmount();
  });
});
