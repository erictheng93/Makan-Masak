// @vitest-environment jsdom

import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import CouponFormModal from "./CouponFormModal.vue";
import {
  clearRestaurantCurrency,
  setRestaurantCurrency,
} from "@/composables/useCurrency";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useCurrency", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/composables/useCurrency")>();
  return {
    ...actual,
    // Real step/placeholder helpers, which follow setRestaurantCurrency.
    useCurrency: () => ({
      ...actual.useCurrency(),
      formatPrice: (value: number) => String(value),
    }),
  };
});
vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({ formatDate: (value: string) => value }),
}));

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: { get: apiGet } }));
apiGet.mockResolvedValue({ data: { data: [], pagination: { total: 0 } } });

function coupon() {
  return {
    id: 1,
    code: "SAVE10",
    name: "Save 10",
    description: "",
    discountType: "percentage" as const,
    discountValue: 10,
    maxDiscountAmount: 20,
    minOrderAmount: 0,
    usageLimit: 5,
    usageLimitPerUser: 2,
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: "2026-09-01T00:00:00.000Z",
    isActive: true,
    isVisible: true,
  };
}

describe("CouponFormModal", () => {
  it("preserves exclusions across pages and lets the merchant remove them", async () => {
    apiGet.mockResolvedValueOnce({
      data: {
        data: [coupon(), { ...coupon(), id: 2, code: "OTHER" }],
        pagination: { total: 2 },
      },
    });
    const wrapper = mount(CouponFormModal, {
      props: {
        coupon: { ...coupon(), incompatibleCouponIds: [2, 99] },
        restaurantId: "shop",
      },
    });
    await flushPromises();
    expect(apiGet).toHaveBeenCalledWith(
      "/coupons",
      expect.objectContaining({ restaurantId: "shop" }),
    );
    expect(wrapper.find('[data-testid="incompatible-1"]').exists()).toBe(false);
    await wrapper.get('[data-testid="incompatible-2"]').setValue(false);
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("save")![0][0]).toMatchObject({
      incompatibleCouponIds: [99],
    });
  });
  it("can clear exclusions even when a referenced coupon is no longer listed", async () => {
    const wrapper = mount(CouponFormModal, {
      props: { coupon: { ...coupon(), incompatibleCouponIds: [99] } },
    });
    await flushPromises();
    await wrapper
      .get('[data-testid="clear-incompatible-coupons"]')
      .trigger("click");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("save")![0][0]).toMatchObject({
      incompatibleCouponIds: [],
    });
  });

  it("defaults a new coupon start time to now, not tomorrow", async () => {
    const before = Date.now() - 60_000;
    const wrapper = mount(CouponFormModal);
    await nextTick();
    const start = wrapper.find('input[type="datetime-local"]')
      .element as HTMLInputElement;

    expect(new Date(start.value).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(start.value).getTime()).toBeLessThanOrEqual(
      Date.now() + 60_000,
    );
  });

  it("emits explicit nulls when an edited owner clears optional limits", async () => {
    const wrapper = mount(CouponFormModal, { props: { coupon: coupon() } });
    await nextTick();
    const numberInputs = wrapper.findAll('input[type="number"]');
    await numberInputs[1].setValue("");
    await numberInputs[3].setValue("");
    await numberInputs[4].setValue("");
    await wrapper.find("form").trigger("submit");

    const payload = wrapper.emitted("save")![0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      maxDiscountAmount: null,
      usageLimit: null,
      usageLimitPerUser: null,
    });
  });

  describe("money inputs follow the shop currency", () => {
    afterEach(clearRestaurantCurrency);

    it("TWD: whole-dollar steps and placeholders", async () => {
      clearRestaurantCurrency();
      const wrapper = mount(CouponFormModal, {
        props: { coupon: { ...coupon(), discountType: "fixed" as const } },
      });
      await nextTick();
      const value = wrapper.get('[data-testid="coupon-discount-value"]');
      expect(value.attributes("step")).toBe("1");
      expect(value.attributes("placeholder")).toBe("5");
      const minOrder = wrapper.get('[data-testid="coupon-min-order"]');
      expect(minOrder.attributes("step")).toBe("1");
      expect(minOrder.attributes("placeholder")).toBe("0");
    });

    it("MYR: sen steps, and a percentage keeps its own step", async () => {
      setRestaurantCurrency("MYR");
      const wrapper = mount(CouponFormModal, { props: { coupon: coupon() } });
      await nextTick();
      const maxDiscount = wrapper.get('[data-testid="coupon-max-discount"]');
      expect(maxDiscount.attributes("step")).toBe("0.01");
      expect(maxDiscount.attributes("placeholder")).toBe("50.00");
      expect(
        wrapper.get('[data-testid="coupon-discount-value"]').attributes("step"),
      ).toBe("0.01");
      expect(
        wrapper
          .get('[data-testid="coupon-min-order"]')
          .attributes("placeholder"),
      ).toBe("0.00");
    });
  });
});
