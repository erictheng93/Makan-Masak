import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import CartView from "@/views/CartView.vue";

const apiGet = vi.hoisted(() => vi.fn());

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
    items: [],
    subtotal: 100,
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
  apiClient: { get: apiGet, post: vi.fn() },
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

describe("CartView fixed-amount coupon label", () => {
  // formatPrice already carries the symbol; a literal `$` in front of it
  // printed "$NT$20" (#390).
  it("shows the currency symbol once in the list and on the apply button", async () => {
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
    expect(wrapper.text().split("NT$20 common.off")).toHaveLength(3);
    expect(wrapper.text()).not.toContain("$NT$");
    wrapper.unmount();
  });
});
