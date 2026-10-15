import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import MenuItemCard from "@/components/MenuItemCard.vue";
import type { MenuItem } from "@makanmasak/shared-types";
import { provideRouterInjection } from "@/tests/helpers/router-injection";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${params.count}`,
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
    createdAt: 1786_000_000_000,
    updatedAt: 1786_000_000_000,
    restaurantId: "restaurant-1",
    categoryId: 1,
    catalogType: "menu_item",
    name: "滷肉飯",
    description: "招牌餐點",
    price: 5000,
    imageUrl: "https://images.example.com/original.jpg",
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
  };
}

provideRouterInjection();

describe("MenuItemCard", () => {
  // The standard list thumbnail sits in a 70px box: DPR 2 needs ~140 device px
  // and DPR 3 needs ~210, so a single hardcoded size is wrong on one of them
  // (#65). The candidates below let the browser resolve it per device.
  //
  // sizes must stay in px. The preload scanner resolves rem against the default
  // 16px root, before this app's 14px root applies, so "5rem" reads as 80px and
  // silently costs DPR 2 the smaller candidate.
  it("offers thumbnail and small candidates for the standard list image", () => {
    const wrapper = mount(MenuItemCard, {
      props: {
        item: menuItem(),
      },
    });

    const img = wrapper.get("img");

    expect(img.attributes("srcset")).toBe(
      "https://images.example.com/thumbnail.jpg 150w, https://images.example.com/small.jpg 300w",
    );
    expect(img.attributes("sizes")).toBe("70px");
  });

  it("keeps a thumbnail src so srcset-less clients never load medium", () => {
    const wrapper = mount(MenuItemCard, {
      props: {
        item: menuItem(),
      },
    });

    expect(wrapper.get("img").attributes("src")).toBe(
      "https://images.example.com/thumbnail.jpg",
    );
  });

  it("falls back to medium for old standard list items without thumbnail", () => {
    const wrapper = mount(MenuItemCard, {
      props: {
        item: menuItem({
          imageVariants: {
            medium: "https://images.example.com/medium.jpg",
          },
        }),
      },
    });

    const img = wrapper.get("img");

    expect(img.attributes("src")).toBe("https://images.example.com/medium.jpg");
    // No candidates exist, so the attribute must be absent rather than empty —
    // an empty srcset would suppress the src in some browsers.
    expect(img.attributes("srcset")).toBeUndefined();
  });

  it("still builds a candidate list when only one variant size exists", () => {
    const wrapper = mount(MenuItemCard, {
      props: {
        item: menuItem({
          imageVariants: {
            small: "https://images.example.com/small.jpg",
            medium: "https://images.example.com/medium.jpg",
          },
        }),
      },
    });

    expect(wrapper.get("img").attributes("srcset")).toBe(
      "https://images.example.com/small.jpg 300w",
    );
  });

  it("offers medium and large candidates for the featured large image", () => {
    const wrapper = mount(MenuItemCard, {
      props: {
        item: menuItem(),
        isFeatured: true,
      },
    });

    const img = wrapper.get("img");

    expect(img.attributes("src")).toBe("https://images.example.com/medium.jpg");
    expect(img.attributes("srcset")).toBe(
      "https://images.example.com/medium.jpg 600w, https://images.example.com/large.jpg 1200w",
    );
    expect(img.attributes("sizes")).toBe("(min-width: 1024px) 382px, 334px");
  });

  it("keeps a featured srcset when only the medium variant exists", () => {
    const wrapper = mount(MenuItemCard, {
      props: {
        item: menuItem({
          imageVariants: {
            medium: "https://images.example.com/medium.jpg",
          },
        }),
        isFeatured: true,
      },
    });

    const img = wrapper.get("img");

    expect(img.attributes("src")).toBe("https://images.example.com/medium.jpg");
    expect(img.attributes("srcset")).toBe(
      "https://images.example.com/medium.jpg 600w",
    );
    expect(img.attributes("sizes")).toBe("(min-width: 1024px) 382px, 334px");
  });

  it("omits the featured srcset when no image variants exist", () => {
    const wrapper = mount(MenuItemCard, {
      props: {
        item: menuItem({
          imageVariants: undefined,
        }),
        isFeatured: true,
      },
    });

    const img = wrapper.get("img");

    expect(img.attributes("src")).toBe(
      "https://images.example.com/original.jpg",
    );
    expect(img.attributes("srcset")).toBeUndefined();
    expect(img.attributes("sizes")).toBe("(min-width: 1024px) 382px, 334px");
  });

  // A tracked count of 0 used to read as "tracking is off", so the card offered
  // an add button for stock the order path would refuse to claim — the owner
  // had no way to type 0 until the admin inventory field shipped (#166).
  describe("stock", () => {
    const card = (item: Partial<MenuItem>) =>
      mount(MenuItemCard, { props: { item: menuItem(item) } });

    it("sells an item whose stock is not tracked", () => {
      const wrapper = card({ inventoryCount: null });

      expect(wrapper.find('[data-testid="menu-item-add-1"]').exists()).toBe(
        true,
      );
      expect(wrapper.text()).not.toContain("menuItemCard.soldOut");
    });

    it("sells an item that still has stock", () => {
      const wrapper = card({ inventoryCount: 3 });

      expect(wrapper.find('[data-testid="menu-item-add-1"]').exists()).toBe(
        true,
      );
      expect(wrapper.text()).not.toContain("menuItemCard.soldOut");
    });

    it("treats a tracked count of zero as sold out", () => {
      const wrapper = card({ inventoryCount: 0 });

      expect(wrapper.find('[data-testid="menu-item-add-1"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).toContain("menuItemCard.soldOut");
    });
  });
});
