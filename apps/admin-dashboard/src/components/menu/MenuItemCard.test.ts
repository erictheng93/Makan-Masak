// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import MenuItemCard from "./MenuItemCard.vue";
import type { MenuItemData } from "@/composables/useMenuManagement";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: ref("zh-TW"),
  }),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (value: number) => `$${value}` }),
}));

vi.mock("@/components/OptimizedImage.vue", () => ({
  default: { name: "OptimizedImage", template: "<img />" },
}));

function buildItem(overrides: Partial<MenuItemData> = {}): MenuItemData {
  return {
    id: 10,
    categoryId: 1,
    catalogType: "menu_item",
    name: "海南雞飯",
    price: 120,
    isFeatured: false,
    isAvailable: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe("admin MenuItemCard", () => {
  it("shows how many diners saved the dish, even before its first order", () => {
    const wrapper = mount(MenuItemCard, {
      props: { item: buildItem({ favoriteCount: 4, orderCount: 0 }) },
    });

    const count = wrapper.get('[data-testid="favorite-count"]');
    expect(count.text()).toContain("4");
    expect(count.text()).toContain("menu.metrics.saved");
    expect(wrapper.text()).not.toContain("menu.metrics.sold");
  });

  it("shows nothing when nobody has saved it", () => {
    const wrapper = mount(MenuItemCard, {
      props: { item: buildItem({ favoriteCount: 0 }) },
    });

    expect(wrapper.find('[data-testid="favorite-count"]').exists()).toBe(false);
  });
});
