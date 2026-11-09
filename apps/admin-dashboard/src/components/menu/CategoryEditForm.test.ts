// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import CategoryEditForm from "./CategoryEditForm.vue";
import type { CategoryData } from "@/composables/useMenuManagement";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: ref("zh-TW"),
  }),
}));

function buildCategory(overrides: Partial<CategoryData> = {}): CategoryData {
  return {
    id: 1,
    name: "主食",
    nameEn: "Mains",
    description: "飯麵類",
    sortOrder: 2,
    isActive: true,
    isVisible: true,
    ...overrides,
  };
}

function mountForm(editingCategory: CategoryData | null = null) {
  return mount(CategoryEditForm, { props: { editingCategory } });
}

describe("CategoryEditForm", () => {
  /**
   * Regression coverage for #83: categories could be hidden through the API but
   * nothing in the dashboard could turn visibility back on.
   */
  it("reflects a hidden category in the visibility switch", () => {
    const wrapper = mountForm(buildCategory({ isVisible: false }));

    expect(
      wrapper
        .get('[data-testid="admin-category-visible-toggle"]')
        .attributes("aria-checked"),
    ).toBe("false");
  });

  it("defaults to visible for a new category", () => {
    const wrapper = mountForm(null);

    expect(
      wrapper
        .get('[data-testid="admin-category-visible-toggle"]')
        .attributes("aria-checked"),
    ).toBe("true");
  });

  it("treats a payload without the flag as visible", () => {
    const wrapper = mountForm({
      id: 5,
      name: "新分類",
      sortOrder: 0,
    } as CategoryData);

    expect(
      wrapper
        .get('[data-testid="admin-category-visible-toggle"]')
        .attributes("aria-checked"),
    ).toBe("true");
  });

  it("submits isVisible:true so a hidden category can be un-hidden", async () => {
    const wrapper = mountForm(buildCategory({ isVisible: false }));

    await wrapper
      .get('[data-testid="admin-category-visible-toggle"]')
      .trigger("click");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("save")).toHaveLength(1);
    expect(wrapper.emitted("save")![0]).toEqual([
      expect.objectContaining({ name: "主食", isVisible: true }),
      1,
    ]);
  });

  it("submits isVisible:false when the owner hides a visible category", async () => {
    const wrapper = mountForm(buildCategory());

    await wrapper
      .get('[data-testid="admin-category-visible-toggle"]')
      .trigger("click");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("save")![0]).toEqual([
      expect.objectContaining({ isVisible: false, sortOrder: 2 }),
      1,
    ]);
  });

  it("exposes the switch with an accessible role and label", () => {
    const wrapper = mountForm(buildCategory());
    const toggle = wrapper.get('[data-testid="admin-category-visible-toggle"]');

    expect(toggle.attributes("role")).toBe("switch");
    expect(toggle.attributes("aria-label")).toBe("menu.form.categoryVisible");
    // A button inside a form must not submit it implicitly.
    expect(toggle.attributes("type")).toBe("button");
  });

  it("disables submit and ignores a second submit while saving", async () => {
    const wrapper = mount(CategoryEditForm, {
      props: { editingCategory: null, saving: true },
    });
    const submit = wrapper.get('[data-testid="admin-category-submit"]');

    expect(submit.attributes("disabled")).toBeDefined();
    expect(submit.text()).toBe("common.saving");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("save")).toBeUndefined();
  });
});
