import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import CouponRecommendation from "@/components/CouponRecommendation.vue";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string) => key,
    currentLanguage: ref("zh-TW"),
  }),
}));
const currency = vi.hoisted(() => ({ code: "TWD" }));

// TWD prints no decimals; the formatter owns that, the component does not.
vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (value: number) =>
      currency.code === "MYR" ? `RM ${value.toFixed(2)}` : `NT$${value}`,
    currencySymbol: computed(() => (currency.code === "MYR" ? "RM" : "NT$")),
    currencyCode: computed(() => currency.code),
  }),
}));

describe("CouponRecommendation currency precision", () => {
  function mountWith(
    code: string,
    orderAmount: number,
    coupon: Record<string, unknown>,
  ) {
    currency.code = code;
    return mount(CouponRecommendation, {
      props: {
        coupons: [
          {
            id: 1,
            code: "PCT",
            name: "Percent off",
            discountType: "percentage",
            ...coupon,
          } as never,
        ],
        orderAmount,
      },
    });
  }

  it("keeps sen like the server: 10% of RM23.50 saves RM2.35", () => {
    const wrapper = mountWith("MYR", 23.5, { discountValue: 10 });
    expect(wrapper.text()).toContain("RM 2.35");
    wrapper.unmount();
  });

  it("rounds to whole TWD like the server: 15% of NT$155 saves NT$23", () => {
    const wrapper = mountWith("TWD", 155, { discountValue: 15 });
    expect(wrapper.text()).toContain("NT$23");
    expect(wrapper.text()).not.toContain("NT$23.25");
    wrapper.unmount();
  });

  it("rounds first, then caps", () => {
    const wrapper = mountWith("TWD", 155, {
      discountValue: 15,
      maxDiscountAmount: 20,
    });
    expect(wrapper.text()).toContain("NT$20");
    wrapper.unmount();
  });

  it("leaves the decimal places to the formatter", () => {
    currency.code = "TWD";
    const wrapper = mount(CouponRecommendation, {
      props: {
        coupons: [
          {
            id: 1,
            code: "TWENTY",
            name: "Twenty off",
            discountType: "fixed",
            discountValue: 20,
          },
        ],
        orderAmount: 100,
      },
    });

    // The badge and the potential-saving line both show the discount.
    expect(wrapper.text().split("NT$20")).toHaveLength(3);
    expect(wrapper.text()).not.toContain("NT$20.00");
    wrapper.unmount();
  });
});
