// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IngredientsView from "./IngredientsView.vue";
import type { IngredientDefinitionResponse } from "@makanmasak/shared-types";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["error"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

const ingredientApi = vi.hoisted(() => ({
  list: vi.fn(),
  listAll: vi.fn(),
  getCategories: vi.fn(),
  listMenuItems: vi.fn(),
  getMissingRecipes: vi.fn(),
  getRecipe: vi.fn(),
  setRecipe: vi.fn(),
}));

vi.mock("@/services/ingredientApi", () => ({ ingredientApi }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: "restaurant-1" }),
}));
vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: vi.fn() }),
}));
// Echo the fallback key so each test records which one its path uses — a key
// that does not exist in the locale files would otherwise render as the raw
// key at runtime while a fixed-string mock stayed green.
vi.mock("@makanmasak/shared/utils/user-facing-error", () => ({
  resolveUserFacingError: (
    _error: unknown,
    _t: unknown,
    options: { fallbackKey: string },
  ) => ({ message: options.fallbackKey }),
}));

function ingredient(id: number, name: string): IngredientDefinitionResponse {
  return {
    id,
    name,
    unit: "kg",
    category: null,
    costPerUnit: null,
    supplier: null,
    minStockLevel: null,
    currentStock: 10,
    isActive: true,
  };
}

function mountView() {
  return mount(IngredientsView, {
    global: {
      stubs: {
        IngredientTable: true,
        IngredientForm: true,
        BulkImportDialog: true,
        StockAdjustDialog: true,
        RecipeEditor: {
          name: "RecipeEditor",
          props: [
            "menuItemId",
            "menuItemName",
            "initialEntries",
            "availableIngredients",
            "submitting",
            "error",
          ],
          emits: ["save", "close"],
          template:
            '<div data-testid="recipe-editor"><button data-testid="stub-save" @click="$emit(\'save\', [])" /></div>',
        },
      },
    },
  });
}

async function openDish(wrapper: ReturnType<typeof mountView>) {
  await wrapper.get('[data-testid="open-recipes"]').trigger("click");
  await flushPromises();
  await wrapper.get('[data-testid="edit-recipe-10"]').trigger("click");
  await flushPromises();
}

describe("IngredientsView recipe editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ingredientApi.list.mockResolvedValue({
      items: [ingredient(1, "Visible ingredient")],
      total: 1,
    });
    ingredientApi.listAll.mockResolvedValue([
      ingredient(1, "Visible ingredient"),
      ingredient(101, "Ingredient from another page"),
    ]);
    ingredientApi.getCategories.mockResolvedValue([]);
    ingredientApi.listMenuItems.mockResolvedValue([
      { id: 10, name: "Unavailable dish" },
    ]);
    ingredientApi.getMissingRecipes.mockResolvedValue([]);
    ingredientApi.getRecipe.mockResolvedValue([]);
  });

  it("keeps the editor closed and surfaces an error when recipe loading fails", async () => {
    ingredientApi.getRecipe.mockRejectedValueOnce(new Error("network error"));
    const wrapper = mountView();
    await flushPromises();

    await openDish(wrapper);

    expect(wrapper.find('[data-testid="recipe-editor"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="recipe-error"]').text()).toBe(
      "common.loadFailed",
    );
    expect(wrapper.find('[data-testid="edit-recipe-10"]').exists()).toBe(true);
  });

  it("keeps the editor open and surfaces the reason when saving fails", async () => {
    // Both rejections a user reaches here are fixable in the dialog — a
    // quantity still at its default 0, or a unit edited away from the stock
    // unit — so closing the editor would throw the edits away.
    ingredientApi.setRecipe.mockRejectedValueOnce(new Error("400"));
    const wrapper = mountView();
    await flushPromises();
    await openDish(wrapper);

    await wrapper.get('[data-testid="stub-save"]').trigger("click");
    await flushPromises();

    const editor = wrapper.getComponent({ name: "RecipeEditor" });
    expect(editor.props()).toMatchObject({
      error: "ingredients.recipeSaveFailed",
      submitting: false,
    });
  });

  it("marks the editor as submitting while the save is in flight", async () => {
    let release!: () => void;
    ingredientApi.setRecipe.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const wrapper = mountView();
    await flushPromises();
    await openDish(wrapper);

    await wrapper.get('[data-testid="stub-save"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.getComponent({ name: "RecipeEditor" }).props("submitting"),
    ).toBe(true);

    release();
    await flushPromises();
    expect(wrapper.find('[data-testid="recipe-editor"]').exists()).toBe(false);
  });

  it("uses the complete unfiltered ingredient list in the recipe editor", async () => {
    const wrapper = mountView();
    await flushPromises();

    await openDish(wrapper);

    expect(ingredientApi.listAll).toHaveBeenCalledWith("restaurant-1");
    expect(
      wrapper.getComponent({ name: "RecipeEditor" }).props(),
    ).toMatchObject({
      availableIngredients: [
        ingredient(1, "Visible ingredient"),
        ingredient(101, "Ingredient from another page"),
      ],
    });
  });
});
