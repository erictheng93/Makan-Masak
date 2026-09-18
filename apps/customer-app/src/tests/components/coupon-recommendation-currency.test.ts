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
// TWD prints no decimals; the formatter owns that, the component does not.
vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (value: number) => `NT$${value}`,
    currencySymbol: computed(() => "NT$"),
  }),
}));

describe("CouponRecommendation currency precision", () => {
  it("leaves the decimal places to the formatter", () => {
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
