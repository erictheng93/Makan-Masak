// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import POSManagementView from "./POSManagementView.vue";
import CouponFormModal from "@/components/coupons/CouponFormModal.vue";
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

const access = vi.hoisted(() => ({ role: 1, coupons: true }));
vi.mock("@makanmasak/shared/stores/moduleAccess", () => ({
  useModuleAccessStore: () => ({
    isLoaded: true,
    effectiveModules: { coupons: access.coupons },
  }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
    user: { id: 7, role: access.role },
  }),
}));

vi.mock("@/services/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => api.get(...(args as [string])),
    post: (...args: unknown[]) => api.post(...(args as [string, unknown])),
    put: (...args: unknown[]) => api.put(...(args as [string, unknown])),
    delete: (...args: unknown[]) => api.delete(...(args as [string])),
  },
  unwrapApiData: (response: { data: { data: unknown } }) => response.data.data,
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  unwrapApiList: (payload: unknown) => payload,
  unwrapApiPayload: (payload: unknown) => payload,
}));

vi.mock("@/services/posService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/posService")>();
  return { posService: { ...actual.posService, payMarketCheckout: vi.fn() } };
});

describe("POSManagementView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.role = 1;
    access.coupons = true;
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
              expectedAmount: 550,
              totalSales: 120,
              totalTransactions: 4,
              status: "active",
            },
          },
        } as never;
      }
      if (url === "/pos/promotions")
        return {
          data: {
            success: true,
            data: {
              promotions: [
                {
                  id: 1,
                  code: "LUNCH10",
                  name: "Lunch discount",
                  description: "Electronic coupon",
                  discountType: "percentage",
                  discountValue: 10,
                  minOrderAmount: 0,
                  usedCount: 0,
                  validFrom: "2020-01-01T00:00:00Z",
                  validTo: "2099-01-01T00:00:00Z",
                  isActive: true,
                  isVisible: true,
                },
              ],
              pagination: { page: 1, pages: 1 },
            },
          },
        } as never;
      if (url === "/pos/reports/daily") {
        return {
          data: {
            success: true,
            data: {
              summary: {
                totalSales: 120,
                totalOrders: 4,
                totalRefundAmount: 0,
                avgOrderValue: 30,
              },
              shifts: [
                {
                  id: "shift-1",
                  registerId: "register-1",
                  totalSalesCents: 12000,
                  totalTransactions: 4,
                },
                {
                  id: "other",
                  registerId: "register-2",
                  totalSalesCents: 987900,
                  totalTransactions: 95,
                },
              ],
            },
          },
        } as never;
      }
      if (url === "/pos/shifts/shift-1/cash-movements") {
        return {
          data: {
            success: true,
            data: {
              movements: [
                {
                  id: "movement-1",
                  registerId: "register-1",
                  type: "cash_out",
                  amountCents: 1250,
                  description: "Drawer withdrawal",
                  recordedBy: "7",
                  createdAt: "2026-06-01T09:00:00Z",
                },
              ],
              pagination: { page: 1, limit: 20, hasMore: false },
            },
          },
        } as never;
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

  it("loads the selected register totals, drawer balance and real cash movement envelope without unsupported requests", async () => {
    const wrapper = mount(POSManagementView);
    await flushPromises();
    const paths = vi.mocked(api.get).mock.calls.map(([url]) => url);
    expect(paths).not.toContain("/pos/registers/register-1/stats/daily");
    expect(paths).toContain("/pos/reports/daily");
    expect(paths).toContain("/pos/shifts/shift-1/cash-movements");
    expect(wrapper.text()).toContain("$120.00");
    expect(wrapper.text()).toContain("$550.00");
    expect(wrapper.text()).toContain("Drawer withdrawal");
    expect(wrapper.text()).toContain("-$12.50");
    expect(wrapper.text()).not.toContain("$9999.00");

    wrapper.unmount();
  });

  it("calls a running shift in progress even when it has no name, and only an absent one not started", async () => {
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (...args) => {
      const response = (await get(...args)) as {
        data: { data: Record<string, unknown> | null };
      };
      if (args[0] === "/pos/shifts/current/register-1" && response.data.data) {
        return {
          data: { success: true, data: { ...response.data.data, name: "" } },
        } as never;
      }
      return response as never;
    });
    const wrapper = mount(POSManagementView);
    await flushPromises();

    expect(wrapper.text()).toContain("pos.shift: pos.shiftActive");
    expect(wrapper.text()).not.toContain("pos.notStarted");

    wrapper.unmount();
  });

  it("clears the previous register's shift, transactions and totals when selecting an idle register", async () => {
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (...args) => {
      const response = await get(...args);
      if (args[0] === "/pos/registers") {
        (response.data.data as unknown[]).push({
          id: "register-2",
          name: "Idle Register",
          isActive: true,
        });
      }
      if (args[0] === "/pos/reports/daily") {
        if (
          (args[1] as { params?: { registerId?: string } })?.params
            ?.registerId === "register-2"
        )
          Object.assign(response.data.data as object, {
            summary: { totalSales: 0, totalOrders: 0, avgOrderValue: 0 },
            shifts: [],
          });
        else
          (response.data.data as { shifts: unknown[] }).shifts = [
            {
              id: "shift-1",
              registerId: "register-1",
              totalSalesCents: 12000,
              totalTransactions: 4,
            },
          ];
      }
      return response;
    });
    const wrapper = mount(POSManagementView);
    await flushPromises();
    await wrapper
      .findAll("h3")
      .find((h) => h.text() === "Idle Register")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Drawer withdrawal");
    expect(wrapper.text()).not.toContain("$120.00");
    expect(wrapper.find('[data-testid="pos-open-end-shift"]').exists()).toBe(
      false,
    );
    expect(api.get).toHaveBeenCalledWith("/pos/shifts/current/register-2");
    wrapper.unmount();
  });

  it("shows usable electronic coupon codes to cashiers without management controls", async () => {
    access.role = 4;
    const wrapper = mount(POSManagementView);
    await flushPromises();
    expect(wrapper.text()).toContain("LUNCH10");
    expect(wrapper.text()).not.toContain("pos.promotionManagement");
    wrapper.unmount();
  });

  it("does not request promotions when the coupon module is unavailable", async () => {
    access.coupons = false;
    const wrapper = mount(POSManagementView);
    await flushPromises();
    expect(vi.mocked(api.get).mock.calls.map(([url]) => url)).not.toContain(
      "/pos/promotions",
    );
    wrapper.unmount();
  });

  it("edits, creates and deletes electronic promotions with the shared coupon form", async () => {
    vi.mocked(api.put).mockResolvedValue({
      data: { success: true, data: {} },
    } as never);
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, data: {} },
    } as never);
    vi.mocked(api.delete).mockResolvedValue({
      data: { success: true },
    } as never);
    const wrapper = mount(POSManagementView);
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "pos.promotionManagement")!
      .trigger("click");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "pos.edit")!
      .trigger("click");
    const form = wrapper.getComponent(CouponFormModal);
    expect(form.props("coupon")?.code).toBe("LUNCH10");
    const input = {
      code: "LUNCH20",
      name: "Updated lunch",
      description: "Electronic",
      discountType: "fixed" as const,
      discountValue: 20,
      minOrderAmount: 100,
      validFrom: "2026-09-01T00:00:00Z",
      validTo: "2026-10-31T00:00:00Z",
      isActive: true,
      isVisible: true,
    };
    form.vm.$emit("save", input);
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith("/pos/promotions/1", input);
    expect(wrapper.findComponent(CouponFormModal).exists()).toBe(false);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "pos.addPromotion")!
      .trigger("click");
    wrapper.getComponent(CouponFormModal).vm.$emit("save", input);
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/pos/promotions", {
      ...input,
      restaurantId: "restaurant-1",
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "common.delete")!
      .trigger("click");
    await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("/pos/promotions/1");
    confirm.mockRestore();
    wrapper.unmount();
  });

  it("returns to the valid promotion page after deleting the last item", async () => {
    const get = vi.mocked(api.get).getMockImplementation()!;
    let deleted = false;
    vi.mocked(api.get).mockImplementation(async (...args) => {
      const response = await get(...args);
      if (args[0] === "/pos/promotions") {
        const page = (args[1] as { params: { page: number } }).params.page;
        const data = response.data.data as {
          promotions: unknown[];
          pagination: { page: number; pages: number };
        };
        data.pagination = { page, pages: deleted ? 1 : 2 };
        if (page === 2 && deleted) data.promotions = [];
      }
      return response;
    });
    vi.mocked(api.delete).mockImplementation(async () => {
      deleted = true;
      return { data: { success: true } } as never;
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(POSManagementView);
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "pos.promotionManagement")!
      .trigger("click");
    await wrapper.get('[data-testid="pos-promotions-next"]').trigger("click");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "common.delete")!
      .trigger("click");
    await flushPromises();
    expect(api.get).toHaveBeenLastCalledWith("/pos/promotions", {
      params: { page: 1, restaurantId: "restaurant-1" },
    });
    expect(wrapper.text()).toContain("LUNCH10");
    confirm.mockRestore();
    wrapper.unmount();
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
