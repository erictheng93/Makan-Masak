// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import POSManagementView from "./POSManagementView.vue";
import { api } from "@/services/api";
import { posService } from "@/services/posService";

// locale is not decoration here: the view formats timestamps through
// useDateFormatter, which reads locale.value to pick a date format. A mock
// returning only `t` makes that read throw as soon as a date is rendered.
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: ref("zh-TW"),
  }),
}));

import {
  clearRestaurantCurrency,
  setRestaurantCurrency,
} from "@/composables/useCurrency";

vi.mock("@/composables/useCurrency", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/composables/useCurrency")>();
  return {
    ...actual,
    useCurrency: () => ({
      ...actual.useCurrency(),
      currencySymbol: "$",
      formatPrice: (value: number) => `$${value.toFixed(2)}`,
    }),
  };
});

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
    user: { id: 7 },
  }),
}));

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  unwrapApiList: (payload: unknown) => payload,
  unwrapApiPayload: (payload: unknown) => payload,
}));

vi.mock("@/services/posService", () => ({
  posService: {
    payMarketCheckout: vi.fn(),
  },
}));

describe("POSManagementView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/pos/registers") {
        return {
          data: {
            success: true,
            data: [
              {
                id: "register-1",
                name: "Main Register",
                // This is the actual API contract: a configured register
                // has no fabricated currentBalance field.
                isActive: true,
                currentShiftId: "shift-1",
                updatedAt: "2026-06-01T10:00:00.000Z",
                location: "Front",
              },
            ],
          },
        } as never;
      }
      if (url === "/pos/shifts/current/register-1") {
        return {
          data: {
            success: true,
            data: {
              id: "shift-1",
              name: "Morning",
              startedAt: "2026-06-01T08:00:00.000Z",
              registerId: "register-1",
              operatorId: 7,
              startAmount: 500,
              totalSales: 120,
              totalTransactions: 4,
              status: "active",
            },
          },
        } as never;
      }
      if (url === "/pos/registers/register-1/stats/daily") {
        return {
          data: {
            success: true,
            data: { totalSales: 120, totalOrders: 4, avgOrderValue: 30 },
          },
        } as never;
      }
      if (url === "/pos/registers/register-1/cash-movements") {
        return { data: { success: true, data: [] } } as never;
      }
      if (url === "/pos/promotions") {
        return { data: { success: true, data: [] } } as never;
      }
      return { data: { success: true, data: null } } as never;
    });
    vi.mocked(posService.payMarketCheckout).mockResolvedValue({
      checkout: { id: "checkout-1", paymentStatus: "paid" },
      payment: {
        status: "paid",
        method: "pos_card",
        totalAmountCents: 20000,
        paidAmountCents: 20000,
      },
    });
  });

  it("pays a market checkout through the selected register and active shift", async () => {
    const wrapper = mount(POSManagementView);
    await flushPromises();

    await wrapper
      .get('[data-testid="pos-market-checkout-id"]')
      .setValue("checkout-1");
    await wrapper
      .get('[data-testid="pos-market-checkout-payment-method"]')
      .setValue("card");
    await wrapper
      .get('[data-testid="pos-market-checkout-pay"]')
      .trigger("click");
    await flushPromises();

    expect(posService.payMarketCheckout).toHaveBeenCalledWith({
      checkoutId: "checkout-1",
      registerId: "register-1",
      shiftId: "shift-1",
      paymentMethod: "card",
    });
    expect(wrapper.text()).not.toContain("NaN");
  });

  it.each([
    ["TWD", "1", "0"],
    ["MYR", "0.01", "0.00"],
  ] as const)(
    "steps the quick-payment amount by the %s unit",
    async (code, step, placeholder) => {
      setRestaurantCurrency(code);
      const wrapper = mount(POSManagementView);
      await flushPromises();

      const amount = wrapper.get('[data-testid="pos-quick-payment-amount"]');
      expect(amount.attributes("step")).toBe(step);
      expect(amount.attributes("placeholder")).toBe(placeholder);
      wrapper.unmount();
      clearRestaurantCurrency();
    },
  );

  it("requires an entered drawer count before ending the active shift", async () => {
    const wrapper = mount(POSManagementView);
    await flushPromises();

    await wrapper.get('[data-testid="pos-open-end-shift"]').trigger("click");
    expect(
      wrapper
        .get('[data-testid="pos-confirm-end-shift"]')
        .attributes("disabled"),
    ).toBeDefined();

    await wrapper.get('[data-testid="pos-ending-cash-amount"]').setValue(1130);
    await wrapper.get('[data-testid="pos-confirm-end-shift"]').trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/pos/shifts/shift-1/end", {
      actualAmount: 1130,
    });
  });
});
