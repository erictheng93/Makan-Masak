// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCurrency,
  clearRestaurantCurrency,
  setRestaurantCurrency,
} from "./useCurrency";
import { useRestaurantCurrency } from "./useRestaurantCurrency";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
let auth: { restaurantId: string | null };
vi.mock("@/services/api", () => ({ api: { get: mocks.get } }));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => auth }));

const Harness = defineComponent({
  setup() {
    useRestaurantCurrency();
    return useCurrency();
  },
  template: "<span>{{ formatPrice(1234.56) }}</span>",
});
function response(currency?: string) {
  return { data: { success: true, data: { settings: { currency } } } };
}
beforeEach(() => {
  mocks.get.mockReset();
  auth = reactive({ restaurantId: "shop-a" });
});
afterEach(clearRestaurantCurrency);

describe("admin restaurant currency context", () => {
  it("loads the shop currency before anyone opens Settings and observes later saves", async () => {
    mocks.get.mockResolvedValue(response("MYR"));
    const wrapper = mount(Harness);
    await flushPromises();
    expect(mocks.get).toHaveBeenCalledWith("/restaurants/shop-a");
    expect(wrapper.text()).toBe("RM 1,234.56");
    setRestaurantCurrency("VND");
    await nextTick();
    expect(wrapper.text()).toBe("1.235 ₫");
    wrapper.unmount();
  });

  it("discards old requests on switching shops and clears currency on logout", async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    mocks.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const wrapper = mount(Harness);
    mocks.get.mockResolvedValueOnce(response("VND"));
    auth.restaurantId = "shop-b";
    await flushPromises();
    expect(mocks.get).toHaveBeenLastCalledWith("/restaurants/shop-b");
    expect(wrapper.text()).toBe("1.235 ₫");
    resolveOld(response("MYR"));
    await flushPromises();
    expect(wrapper.text()).toBe("1.235 ₫");
    auth.restaurantId = null;
    await nextTick();
    expect(wrapper.text()).toBe("NT$1,235");
    expect(sessionStorage.getItem("admin_restaurant_currency")).toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it.each([undefined, "USD"])(
    "resets stale currency when the shop has no supported setting (%s)",
    async (code) => {
      setRestaurantCurrency("MYR");
      mocks.get.mockResolvedValue(response(code));
      const wrapper = mount(Harness);
      await flushPromises();
      expect(wrapper.text()).toBe("NT$1,235");
      expect(mocks.get).toHaveBeenCalledOnce();
      wrapper.unmount();
    },
  );
});
