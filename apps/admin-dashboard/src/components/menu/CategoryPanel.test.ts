// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import CategoryPanel from "./CategoryPanel.vue";
import type {
  CategoryData,
  MenuItemData,
} from "@/composables/useMenuManagement";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    locale: ref("zh-TW"),
  }),
}));

// VueDraggable renders a plain wrapper here — drag behaviour is not under test
// and the real component needs a DOM layout engine.
vi.mock("vue-draggable-plus", () => ({
  VueDraggable: {
    name: "VueDraggable",
    template: "<div><slot /></div>",
  },
}));

function buildCategory(overrides: Partial<CategoryData> = {}): CategoryData {
  return {
    id: 1,
    name: "主食",
    sortOrder: 0,
    isActive: true,
    isVisible: true,
    ...overrides,
  };
}

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

function mountPanel(
  categories: CategoryData[],
  menuItems: MenuItemData[] = [],
) {
  return mount(CategoryPanel, {
    props: { categories, menuItems, selectedCategoryId: null },
  });
}

function rowFor(wrapper: ReturnType<typeof mountPanel>, id: number) {
  return wrapper.get(`[data-testid="category-row"][data-category-id="${id}"]`);
}

describe("CategoryPanel", () => {
  /**
   * Regression coverage for #83. A hidden category used to disappear from the
   * owner's own dashboard together with every item in it, so there was no row to
   * click and no way to un-hide it.
   */
  it("still lists a hidden category and flags it", () => {
    const wrapper = mountPanel(
      [
        buildCategory({ id: 1, name: "主食" }),
        buildCategory({ id: 2, name: "季節限定", isVisible: false }),
      ],
      [buildItem({ id: 10, categoryId: 1 })],
    );

    expect(wrapper.findAll('[data-testid="category-row"]')).toHaveLength(2);
    expect(rowFor(wrapper, 2).attributes("data-hidden")).toBe("true");
    expect(rowFor(wrapper, 1).attributes("data-hidden")).toBe("false");
  });

  it("shows the hidden badge only on hidden categories", () => {
    const wrapper = mountPanel([
      buildCategory({ id: 1 }),
      buildCategory({ id: 2, isVisible: false }),
    ]);

    expect(
      rowFor(wrapper, 1).find('[data-testid="category-hidden-badge"]').exists(),
    ).toBe(false);

    const badge = rowFor(wrapper, 2).get(
      '[data-testid="category-hidden-badge"]',
    );
    expect(badge.text()).toContain("menu.categoryPanel.hidden");
    expect(rowFor(wrapper, 2).text()).toContain(
      "menu.categoryPanel.hiddenHint",
    );
  });

  it("treats an inactive category as hidden too", () => {
    const wrapper = mountPanel([buildCategory({ id: 3, isActive: false })]);

    expect(rowFor(wrapper, 3).attributes("data-hidden")).toBe("true");
  });

  it("does not flag categories whose flags are absent from the payload", () => {
    const wrapper = mountPanel([
      { id: 4, name: "新分類", sortOrder: 0 } as CategoryData,
    ]);

    expect(rowFor(wrapper, 4).attributes("data-hidden")).toBe("false");
  });

  it("emits edit-category so a hidden category can be reopened", async () => {
    const hidden = buildCategory({ id: 2, isVisible: false });
    const wrapper = mountPanel([hidden]);

    await wrapper.get('[data-testid="admin-category-edit-2"]').trigger("click");

    expect(wrapper.emitted("edit-category")).toEqual([[hidden]]);
  });
});

describe("CategoryPanel compact (phone)", () => {
  const categories = [
    buildCategory({ id: 1, name: "主食" }),
    buildCategory({ id: 2, name: "飲料" }),
  ];

  it("renders All plus one chip per category and emits select", async () => {
    const wrapper = mount(CategoryPanel, {
      props: {
        categories,
        menuItems: [],
        selectedCategoryId: null,
        compact: true,
      },
    });

    expect(wrapper.findAll('[data-testid="category-chip"]')).toHaveLength(2);
    expect(
      wrapper
        .get('[data-testid="category-chip-all"]')
        .attributes("aria-pressed"),
    ).toBe("true");
    expect(wrapper.find('[data-testid="category-row"]').exists()).toBe(false);

    await wrapper.findAll('[data-testid="category-chip"]')[1]!.trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([2]);
    await wrapper.get('[data-testid="category-chip-all"]').trigger("click");
    expect(wrapper.emitted("select")?.[1]).toEqual([null]);
  });

  it("reaches add/edit/delete through the labelled manage button", async () => {
    const wrapper = mount(CategoryPanel, {
      props: {
        categories,
        menuItems: [],
        selectedCategoryId: null,
        compact: true,
      },
    });

    expect(wrapper.find('[data-testid="add-category-btn"]').exists()).toBe(
      false,
    );
    const manage = wrapper.get('[data-testid="manage-categories-btn"]');
    expect(manage.attributes("aria-label")).toBe("menu.manageCategories");
    await manage.trigger("click");

    await wrapper.get('[data-testid="add-category-btn"]').trigger("click");
    await wrapper.get('[data-testid="admin-category-edit-1"]').trigger("click");
    await wrapper
      .get('[data-testid="admin-category-delete-2"]')
      .trigger("click");
    expect(wrapper.emitted("add-category")).toHaveLength(1);
    expect(wrapper.emitted("edit-category")?.[0]).toEqual([categories[0]]);
    expect(wrapper.emitted("delete-category")?.[0]).toEqual([categories[1]]);
  });
});
