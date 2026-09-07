import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopCartModal from "@/components/ShopCartModal.vue";

const post = vi.hoisted(() => vi.fn());
const hasCustomerAccessToken = vi.hoisted(() => vi.fn());
const clearCart = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: toastError, warning: vi.fn() }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string) => key,
    currentLanguage: ref("zh-TW"),
  }),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (value: number) => `$${value}` }),
}));

vi.mock("@/utils/localized-menu-content", () => ({
  getLocalizedMenuName: (item: { name?: string }) => item.name ?? "",
}));

vi.mock("@/services/api", () => ({
  apiClient: { get: vi.fn(), post },
}));

vi.mock("@/services/customerAccessToken", () => ({
  hasCustomerAccessToken,
}));

vi.mock("@/stores/shopCart", () => ({
  useShopCartStore: () => ({
    isEmpty: false,
    items: [
      {
        id: "42",
        menuItem: { id: 42, name: "鹽酥雞" },
        quantity: 1,
        customizations: undefined,
        notes: "",
        price: 120,
        totalPrice: 120,
      },
    ],
    subtotal: 120,
    totalWithDelivery: 120,
    fulfillmentType: "takeaway",
    deliveryFee: 0,
    clearCart,
    updateQuantity: vi.fn(),
    removeItem: vi.fn(),
    setDeliveryInfo: vi.fn(),
  }),
}));

const SHOP_QR_CODE = "SHOP-restaurant-1-1785563580";

function mountModal(props: Record<string, unknown> = {}) {
  return mount(ShopCartModal, {
    props: {
      show: true,
      restaurantId: "restaurant-1",
      ...props,
    },
    global: { stubs: { Teleport: true, Transition: false } },
  });
}

async function checkout(props: Record<string, unknown> = {}) {
  const wrapper = mountModal(props);
  await wrapper.get('[data-testid="submit-order-btn"]').trigger("click");
  await flushPromises();
  return wrapper;
}

describe("ShopCartModal checkout payload", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ order: { id: 501 }, guestToken: "gt_test" });
    hasCustomerAccessToken.mockReset();
    hasCustomerAccessToken.mockReturnValue(false);
    clearCart.mockReset();
    routerPush.mockReset();
    toastError.mockReset();
  });

  it("sends no pickup digits — the order number is the pickup identifier", async () => {
    await checkout();

    const [, payload] = post.mock.calls[0];
    expect(payload).not.toHaveProperty("phoneLastDigits");
    expect(routerPush).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ShopOrderTracking",
        query: { type: "shop" },
      }),
    );
  });

  /**
   * The toast used to be `getErrorMessage(error, fallback)`, which returns the
   * thrown error's own message -- the server's English sentence -- whenever
   * there was one. `t` is the identity function here, so a leak would show up
   * as the sentence itself rather than a key.
   */
  it("shows a translation key, never the server's sentence, when checkout fails", async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error("Menu item 101 is not available"), {
        response: {
          status: 409,
          data: {
            success: false,
            error: {
              code: "MENU_ITEM_UNAVAILABLE",
              message: "Menu item 101 is not available",
            },
          },
        },
      }),
    );

    await checkout();

    expect(toastError).toHaveBeenCalledWith(
      "toast.orderSubmitMenuItemUnavailable",
    );
    expect(toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("Menu item"),
    );
  });

  it("falls back to localized copy for a code it does not know", async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error("Some unmapped backend detail"), {
        response: {
          status: 503,
          data: {
            success: false,
            error: {
              code: "SOMETHING_NEW",
              message: "Some unmapped backend detail",
            },
          },
        },
      }),
    );

    await checkout();

    const [shown] = toastError.mock.calls[0];
    expect(shown).not.toContain("unmapped backend");
    expect(shown).toMatch(/^(toast|errorPresentation)\./);
  });

  it("sends the scanned code so the server can retire an old sticker", async () => {
    await checkout({ shopQrCode: SHOP_QR_CODE });

    expect(post).toHaveBeenCalledWith(
      "/guest-orders",
      expect.objectContaining({ shopQrCode: SHOP_QR_CODE }),
    );
  });

  it("omits the field entirely when the session did not start from a scan", async () => {
    // The server reads "absent" as nothing to check. Sending an empty string
    // instead would look like a scan of a code that matches nothing.
    await checkout();

    const [, payload] = post.mock.calls[0];
    expect(payload).not.toHaveProperty("shopQrCode");
  });

  it("sends it on the authenticated endpoint too", async () => {
    hasCustomerAccessToken.mockReturnValue(true);
    post.mockResolvedValue({ id: 501 });

    await checkout({ shopQrCode: SHOP_QR_CODE });

    expect(post).toHaveBeenCalledWith(
      "/orders",
      expect.objectContaining({ shopQrCode: SHOP_QR_CODE }),
    );
  });

  it("reuses one idempotency key across a retry of the same cart", async () => {
    // Takeaway goes to the same endpoints and the same client_mutation_id
    // column as dine-in. Without a key a customer whose connection dropped
    // mid-submit taps again and the shop makes the order twice.
    hasCustomerAccessToken.mockReturnValue(true);
    post.mockRejectedValueOnce(new Error("Network Error"));
    post.mockResolvedValue({ id: 501 });

    const wrapper = mountModal();
    const submit = wrapper.get('[data-testid="submit-order-btn"]');

    await submit.trigger("click");
    await flushPromises();
    const firstKey = post.mock.calls[0][1].clientMutationId;
    expect(typeof firstKey).toBe("string");
    expect(firstKey.length).toBeGreaterThan(0);

    await submit.trigger("click");
    await flushPromises();

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1].clientMutationId).toBe(firstKey);
  });

  it("mints a fresh key for the cart that follows a committed order", async () => {
    hasCustomerAccessToken.mockReturnValue(true);
    post.mockResolvedValue({ id: 501 });

    const wrapper = mountModal();
    const submit = wrapper.get('[data-testid="submit-order-btn"]');

    await submit.trigger("click");
    await flushPromises();
    const firstKey = post.mock.calls[0][1].clientMutationId;

    await submit.trigger("click");
    await flushPromises();

    expect(post.mock.calls[1][1].clientMutationId).not.toBe(firstKey);
  });
});
