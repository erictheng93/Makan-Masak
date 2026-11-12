import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import MenuItemModal from "@/components/MenuItemModal.vue";
import type { MenuItem } from "@makanmasak/shared-types";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string) => key,
    currentLanguage: { value: "zh-TW" },
  }),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ formatPrice: (price: number) => `$${price}` }),
}));

function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 1,
    createdAt: 1786_000_000_000,
    updatedAt: 1786_000_000_000,
    restaurantId: "restaurant-1",
    categoryId: 1,
    catalogType: "menu_item",
    name: "滷肉飯",
    description: "招牌餐點",
    price: 5000,
    imageUrl: "https://images.example.com/medium.jpg",
    imageVariants: {
      thumbnail: "https://images.example.com/thumbnail.jpg",
      small: "https://images.example.com/small.jpg",
      medium: "https://images.example.com/medium.jpg",
      large: "https://images.example.com/large.jpg",
    },
    spiceLevel: 0,
    sortOrder: 0,
    isAvailable: true,
    isFeatured: false,
    inventoryCount: null,
    orderCount: 0,
    ...overrides,
  } as MenuItem;
}

describe("MenuItemModal hero image", () => {
  it("offers every variant and sizes it to the sheet width", () => {
    const wrapper = mount(MenuItemModal, {
      props: { show: true, item: menuItem() },
      global: { stubs: { teleport: true } },
    });
    const img = wrapper.get("img");

    expect(img.attributes("src")).toBe("https://images.example.com/large.jpg");
    expect(img.attributes("srcset")).toBe(
      "https://images.example.com/thumbnail.jpg 150w, https://images.example.com/small.jpg 300w, https://images.example.com/medium.jpg 600w, https://images.example.com/large.jpg 1200w",
    );
    expect(img.attributes("sizes")).toBe(
      "(min-width: 769px) 448px, min(100vw, 392px)",
    );
    // First thing in an opened sheet: must not be deferred.
    expect(img.attributes("loading")).toBeUndefined();
  });

  it("still renders imageUrl when the item has no variants", () => {
    const wrapper = mount(MenuItemModal, {
      props: { show: true, item: menuItem({ imageVariants: undefined }) },
      global: { stubs: { teleport: true } },
    });
    const img = wrapper.get("img");

    expect(img.attributes("src")).toBe("https://images.example.com/medium.jpg");
    expect(img.attributes("srcset")).toBeUndefined();
  });
});
