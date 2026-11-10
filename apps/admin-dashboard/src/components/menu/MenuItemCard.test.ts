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

  describe("compact (phone) row", () => {
    it("shows name, price and a one-tap sale switch with accessible names", async () => {
      const wrapper = mount(MenuItemCard, {
        props: { item: buildItem({ isAvailable: true }), compact: true },
      });

      expect(wrapper.text()).toContain("海南雞飯");
      expect(wrapper.text()).toContain("$120");
      const toggle = wrapper.get('[data-testid="admin-menu-item-toggle-10"]');
      expect(toggle.attributes("role")).toBe("switch");
      expect(toggle.attributes("aria-checked")).toBe("true");
      expect(toggle.attributes("aria-label")).toBe("menu.actionUnpublish");

      await toggle.trigger("click");
      expect(wrapper.emitted("toggle-status")).toHaveLength(1);
    });

    it("keeps edit and delete behind a labelled overflow button", async () => {
      const item = buildItem();
      const wrapper = mount(MenuItemCard, { props: { item, compact: true } });

      expect(
        wrapper.find('[data-testid="admin-menu-item-edit-10"]').exists(),
      ).toBe(false);
      const more = wrapper.get('[data-testid="admin-menu-item-more-10"]');
      expect(more.attributes("aria-label")).toBe("menu.moreActions");
      await more.trigger("click");
      expect(more.attributes("aria-expanded")).toBe("true");

      await wrapper
        .get('[data-testid="admin-menu-item-edit-10"]')
        .trigger("click");
      await wrapper
        .get('[data-testid="admin-menu-item-delete-10"]')
        .trigger("click");
      expect(wrapper.emitted("edit")?.[0]).toEqual([item]);
      expect(wrapper.emitted("delete")?.[0]).toEqual([item]);
    });
  });
});
