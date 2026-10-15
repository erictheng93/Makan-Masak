import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
    currentLanguage: ref("zh-TW"),
  }),
}));
import MarketDetailHero from "@/components/markets/MarketDetailHero.vue";
import type { MarketDetail } from "@/services/marketsApi";
import { provideRouterInjection } from "@/tests/helpers/router-injection";

function market(overrides: Partial<MarketDetail> = {}): MarketDetail {
  return {
    id: "market-1",
    slug: "fengjia",
    name: "逢甲夜市",
    type: "night_market",
    description: "人氣小吃聚落",
    city: "台中市",
    district: "西屯區",
    address: "台中市西屯區文華路",
    latitude: 24.1764,
    longitude: 120.6466,
    bannerUrl: "https://example.com/banner.jpg",
    logoUrl: "https://example.com/logo.jpg",
    tags: ["夜市", "小吃"],
    vendorCount: 12,
    openingHours: null,
    imageUrls: null,
    ...overrides,
  };
}

provideRouterInjection();

describe("MarketDetailHero", () => {
  it("shows the venue type on market detail pages", () => {
    const wrapper = mount(MarketDetailHero, {
      props: {
        market: market({
          name: "精明商圈",
          type: "commercial_district",
        }),
        vendorCount: 8,
      },
    });

    expect(wrapper.get('[data-testid="market-detail-type"]').text()).toBe(
      "markets.type.commercial_district",
    );
  });

  it("renders gallery images and weekly opening hours", () => {
    const wrapper = mount(MarketDetailHero, {
      props: {
        market: market({
          imageUrls: [
            "https://example.com/gallery-1.jpg",
            "https://example.com/gallery-2.jpg",
          ],
          openingHours: {
            friday: { open: "17:00", close: "23:30" },
            saturday: { open: "16:00", close: "23:59", closed: false },
            sunday: { open: "16:00", close: "23:00", closed: true },
          },
        }),
        vendorCount: 12,
      },
    });

    const gallery = wrapper.findAll('[data-testid="market-gallery-image"]');
    expect(gallery).toHaveLength(2);
    expect(gallery[0].attributes("src")).toBe(
      "https://example.com/gallery-1.jpg",
    );
    expect(wrapper.text()).toContain("markets.hero.openingHours");
    expect(wrapper.text()).toContain("markets.weekday.long.friday");
    expect(wrapper.text()).toContain("17:00-23:30");
    expect(wrapper.text()).toContain("markets.weekday.long.saturday");
    expect(wrapper.text()).toContain("16:00-23:59");
    expect(wrapper.text()).toContain("markets.weekday.long.sunday");
    expect(wrapper.text()).toContain("markets.common.closedShort");
  });
});
