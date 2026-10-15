import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, beforeEach } from "vitest";
import MenuItemCard from "@/components/MenuItemCard.vue";
import type { MenuItem } from "@makanmasak/shared-types";
import { vi } from "vitest";
import { provideRouterInjection } from "@/tests/helpers/router-injection";

// #112 shipped with helper unit tests only, so nothing proved a customer ever
// SEES the English name — the helper could have been correct while no component
// called it, which is exactly how the order-detail path stayed dead.
const locale = ref("zh-TW");

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${params.count}`,
    currentLanguage: locale,
  }),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (price: number) => `$${price}`,
  }),
}));

function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 1,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    restaurantId: "restaurant-1",
    categoryId: 1,
    catalogType: "menu_item",
    name: "海南雞飯",
    nameEn: "Hainanese Chicken Rice",
    description: "招牌餐點",
    price: 5000,
    imageUrl: "https://images.example.com/original.jpg",
    spiceLevel: 0,
    sortOrder: 0,
    isAvailable: true,
    isFeatured: false,
    inventoryCount: null,
    orderCount: 0,
    ...overrides,
  } as MenuItem;
}

provideRouterInjection();

describe("menu name rendering follows the visitor's language (#112)", () => {
  beforeEach(() => {
    locale.value = "zh-TW";
  });

  it("shows the canonical name in a Chinese locale", () => {
    const wrapper = mount(MenuItemCard, { props: { item: menuItem() } });

    expect(wrapper.text()).toContain("海南雞飯");
    expect(wrapper.text()).not.toContain("Hainanese Chicken Rice");
  });

  it("shows the English name in an English locale", () => {
    locale.value = "en-US";
    const wrapper = mount(MenuItemCard, { props: { item: menuItem() } });

    expect(wrapper.text()).toContain("Hainanese Chicken Rice");
  });

  it("falls back to the canonical name when the item has none", () => {
    locale.value = "en-US";
    const wrapper = mount(MenuItemCard, {
      // null, the shape the API sends — a blank card would leave the customer
      // nothing to tap.
      props: { item: menuItem({ nameEn: null } as Partial<MenuItem>) },
    });

    expect(wrapper.text()).toContain("海南雞飯");
  });

  it("shows both names for a Latin-alphabet locale with no override of its own", () => {
    locale.value = "ms-MY";
    const wrapper = mount(MenuItemCard, { props: { item: menuItem() } });

    expect(wrapper.text()).toContain("Hainanese Chicken Rice（海南雞飯）");
  });

  it("re-renders when the language is switched while mounted", async () => {
    const wrapper = mount(MenuItemCard, { props: { item: menuItem() } });
    expect(wrapper.text()).toContain("海南雞飯");

    locale.value = "en-US";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Hainanese Chicken Rice");
  });
});
