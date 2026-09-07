import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CartView from "@/views/CartView.vue";
// Deliberately the real module, not a mock: it is the single in-memory slot
// CartView reads to pick its submit branch, so setting it here flips the
// component onto the authenticated path exactly as signing in would.
import {
  clearCustomerAccessToken,
  setCustomerAccessToken,
} from "@/services/customerAccessToken";

const routeQuery = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const createOrder = vi.hoisted(() => vi.fn());
const createGuestOrder = vi.hoisted(() => vi.fn());
const initializeCart = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: routeQuery.current }),
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
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

vi.mock("@/stores/cart", () => ({
  useCartStore: () => ({
    isEmpty: false,
    items: [
      {
        id: "42",
        menuItem: { id: 42, name: "Beef Noodles" },
        quantity: 1,
        customizations: undefined,
        notes: "",
      },
    ],
    subtotal: 100,
    initializeCart,
    clearCart: vi.fn(),
    updateQuantity: vi.fn(),
    updateItemNotes: vi.fn(),
    removeItem: vi.fn(),
    getItemById: vi.fn(),
  }),
}));

vi.mock("@/services/orderApi", () => ({
  orderApi: {
    createOrder,
    createGuestOrder,
  },
}));

vi.mock("@/services/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("@/services/menuApi", () => ({
  default: {
    getRestaurant: vi.fn(),
  },
}));

vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({
    data: ref({ name: "Demo Restaurant", settings: {} }),
  }),
  // Calls onSuccess as well as onError. It used to call only onError, which
  // meant every success-path effect -- clearing the cart, resetting the
  // idempotency key, navigating -- was invisible to any test using this stub.
  useMutation: (options: {
    mutationFn: (data: unknown) => unknown;
    onSuccess?: (result: unknown) => void;
    onError?: (error: unknown) => void;
  }) => ({
    mutate: async (data: unknown) => {
      try {
        options.onSuccess?.(await options.mutationFn(data));
      } catch (error) {
        options.onError?.(error);
      }
    },
  }),
}));

vi.mock("@/components/CartItemCard.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/ConfirmationModal.vue", () => ({
  default: {
    emits: ["confirm", "cancel"],
    template: '<button data-testid="confirm" @click="$emit(\'confirm\')" />',
  },
}));
vi.mock("@/components/CouponRecommendation.vue", () => ({
  default: { template: "<div />" },
}));

describe("CartView seat orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Row id and printed number deliberately differ: seat "02" on this table
    // is row 6. The header must show "02".
    routeQuery.current = { seatId: "6", seatNumber: "02" };
    sessionStorage.clear();
    clearCustomerAccessToken();
    createOrder.mockResolvedValue({ id: 123 });
    createGuestOrder.mockResolvedValue({ order: { id: 123 } });
  });

  it("initializes the cart for the seat and submits a seat guest order", async () => {
    const wrapper = mount(CartView, {
      props: {
        restaurantId: "restaurant-1",
        tableId: 4,
      },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    await flushPromises();
    expect(initializeCart).toHaveBeenCalledWith("restaurant-1", 4, 6);
    expect(wrapper.text()).toContain("menu.seatContext");

    await wrapper.find("button[data-testid='confirm']").trigger("click");

    expect(createGuestOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        orderType: "seat",
        tableId: 4,
        seatId: 6,
      }),
    );
  });

  it("carries a mutation id, and reuses it when the guest retries the same cart", async () => {
    // The server has always enforced this: orders has a unique index on
    // (restaurant_id, client_mutation_id) and a violation becomes a 409. No
    // caller was sending a key, so the mechanism was dead. A guest whose
    // connection drops mid-submit is told "please try again" -- the second tap
    // has to be the same order, not a second one.
    createGuestOrder.mockRejectedValueOnce(new Error("Network Error"));

    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });
    await flushPromises();

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    const firstKey = createGuestOrder.mock.calls[0][0].clientMutationId;
    expect(typeof firstKey).toBe("string");
    expect(firstKey.length).toBeGreaterThan(0);

    // Second tap after the failure: same cart, so the same key.
    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    expect(createGuestOrder).toHaveBeenCalledTimes(2);
    expect(createGuestOrder.mock.calls[1][0].clientMutationId).toBe(firstKey);
  });

  it("mints a fresh mutation id once an order has gone through", async () => {
    // Otherwise a guest ordering a second round would be deduplicated against
    // their first order and never get their food.
    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });
    await flushPromises();

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();
    const firstKey = createGuestOrder.mock.calls[0][0].clientMutationId;

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    expect(createGuestOrder.mock.calls[1][0].clientMutationId).not.toBe(
      firstKey,
    );
  });

  it("carries a mutation id on the authenticated path too", async () => {
    // The authenticated path has no KV active-order lock behind it -- that
    // guard is guest-only -- so this key is the only thing standing between a
    // dropped connection and a second order.
    setCustomerAccessToken("customer-token");
    createOrder.mockRejectedValueOnce(new Error("Network Error"));

    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });
    await flushPromises();

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    expect(createGuestOrder).not.toHaveBeenCalled();
    const firstKey = createOrder.mock.calls[0][0].clientMutationId;
    expect(typeof firstKey).toBe("string");
    expect(firstKey.length).toBeGreaterThan(0);

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls[1][0].clientMutationId).toBe(firstKey);
  });

  it("mints a fresh mutation id once an authenticated order has gone through", async () => {
    setCustomerAccessToken("customer-token");

    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });
    await flushPromises();

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();
    const firstKey = createOrder.mock.calls[0][0].clientMutationId;

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    expect(createOrder.mock.calls[1][0].clientMutationId).not.toBe(firstKey);
  });

  it("keeps the same key when the customer signs in between two attempts", async () => {
    // Signing in is one of the obvious things to try after a failed submit,
    // and it moves the same cart from /guest-orders to /orders. Both write the
    // same client_mutation_id column under the same unique index, so one key
    // spanning the switch is what makes the retry a retry. A per-branch key
    // would look like a fresh order and the kitchen would cook twice.
    createGuestOrder.mockRejectedValueOnce(new Error("Network Error"));

    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });
    await flushPromises();

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();
    const guestKey = createGuestOrder.mock.calls[0][0].clientMutationId;

    setCustomerAccessToken("customer-token");

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].clientMutationId).toBe(guestKey);
  });

  it("omits the seat label when only the row id is known", async () => {
    // Older links carry just seatId. Showing String(seatId).padStart(2,"0")
    // told a diner at sticker "02" they were at "06", so the label is dropped
    // rather than invented — the order still carries the id.
    routeQuery.current = { seatId: "6" };

    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });

    await flushPromises();
    expect(initializeCart).toHaveBeenCalledWith("restaurant-1", 4, 6);
    expect(wrapper.text()).not.toContain("menu.seatContext");
    expect(wrapper.text()).not.toContain("06");

    await wrapper.find("button[data-testid='confirm']").trigger("click");
    expect(createGuestOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderType: "seat", tableId: 4, seatId: 6 }),
    );
  });

  it("names the network as the problem instead of blaming the order", async () => {
    createGuestOrder.mockRejectedValue(
      Object.assign(new Error("Network Error"), {
        code: "NETWORK_ERROR",
      }),
    );

    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });

    await flushPromises();
    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    // Was `toast.orderSubmitFailed` -- accurate but unhelpful, since the order
    // never reached the server. The shared resolver classifies the transport
    // failure instead, so the toast points at the connection rather than
    // leaving the customer wondering what was wrong with their cart.
    expect(toastError).toHaveBeenCalledWith("errorPresentation.network");
  });

  it("uses localized copy for API business errors", async () => {
    createGuestOrder.mockRejectedValue(
      Object.assign(
        new Error(
          "You already have an active order at this restaurant. Please wait for it to complete.",
        ),
        {
          code: "ACTIVE_GUEST_ORDER_EXISTS",
          status: 429,
        },
      ),
    );

    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });

    await flushPromises();
    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    expect(toastError).toHaveBeenCalledWith(
      "toast.orderSubmitActiveGuestOrder",
    );
  });

  it("uses the status copy for an unmapped code, never the server prose", async () => {
    createGuestOrder.mockRejectedValue(
      Object.assign(new Error("Unexpected backend implementation detail"), {
        code: "UNMAPPED_BACKEND_ERROR",
        status: 429,
      }),
    );

    const wrapper = mount(CartView, {
      props: { restaurantId: "restaurant-1", tableId: 4 },
      global: { stubs: { RouterLink: true } },
    });

    await flushPromises();
    await wrapper.find("button[data-testid='confirm']").trigger("click");
    await flushPromises();

    // The code has no mapping, so the 429 decides the copy: "too many
    // requests" is something the customer can act on, unlike a generic submit
    // failure. What must never surface is the server's own sentence.
    expect(toastError).toHaveBeenCalledWith(
      "errorPresentation.tooManyRequests",
    );
    expect(toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("Unexpected backend"),
    );
  });
});
