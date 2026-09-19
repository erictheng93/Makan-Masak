import { DEFAULT_CURRENCY, type CurrencyCode } from "@makanmasak/utils";
import { importPriceProblem, type MenuItemImportInput } from "./menuItemImport";

export interface ImageMenuCategoryDraft {
  key: string;
  name: string;
  sortOrder: number;
}

export interface ImageAssistedMenuItemDraft {
  id: string;
  name: string;
  price: string;
  categoryKey: string;
  description: string;
  isAvailable: boolean;
  sortOrder: string;
}

export type ImageAssistedMenuItemErrors = Record<
  string,
  Partial<Record<keyof ImageAssistedMenuItemDraft, ImageAssistedMenuErrorCode>>
>;

export type ImageAssistedMenuErrorCode =
  | "nameRequired"
  | "priceRequired"
  | "priceInvalid"
  | "priceWholeUnits"
  | "priceTooPrecise"
  | "categoryRequired"
  | "sortOrderRequired"
  | "sortOrderInvalid";

export type ImageMenuCategoryErrors = Record<string, "categoryNameRequired">;

export function validateImageAssistedMenuCategories(
  drafts: ImageMenuCategoryDraft[],
): ImageMenuCategoryErrors {
  return Object.fromEntries(
    drafts
      .filter((draft) => !draft.name.trim())
      .map((draft) => [draft.key, "categoryNameRequired"]),
  );
}

export function validateImageAssistedMenuItems(
  drafts: ImageAssistedMenuItemDraft[],
  categoryIds: ReadonlyMap<string, number>,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): { items: MenuItemImportInput[]; errors: ImageAssistedMenuItemErrors } {
  const errors: ImageAssistedMenuItemErrors = {};
  const items: MenuItemImportInput[] = [];

  for (const draft of drafts) {
    const rowErrors: Partial<
      Record<keyof ImageAssistedMenuItemDraft, ImageAssistedMenuErrorCode>
    > = {};
    const price = Number(draft.price);
    const sortOrder = Number(draft.sortOrder);
    const categoryId = categoryIds.get(draft.categoryKey);

    if (!draft.name.trim()) rowErrors.name = "nameRequired";
    if (!draft.price.trim()) {
      rowErrors.price = "priceRequired";
    } else {
      const problem = importPriceProblem(price, currency);
      if (problem === "invalid") rowErrors.price = "priceInvalid";
      else if (problem === "wholeUnits") rowErrors.price = "priceWholeUnits";
      else if (problem === "tooPrecise") rowErrors.price = "priceTooPrecise";
    }
    if (categoryId === undefined) rowErrors.categoryKey = "categoryRequired";
    if (!draft.sortOrder.trim()) {
      rowErrors.sortOrder = "sortOrderRequired";
    } else if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      rowErrors.sortOrder = "sortOrderInvalid";
    }

    if (Object.keys(rowErrors).length > 0) {
      errors[draft.id] = rowErrors;
      continue;
    }

    if (categoryId === undefined) {
      continue;
    }

    items.push({
      name: draft.name.trim(),
      price,
      categoryId,
      ...(draft.description.trim()
        ? { description: draft.description.trim() }
        : {}),
      isAvailable: draft.isAvailable,
      isFeatured: false,
      catalogType: "menu_item",
      sortOrder,
    });
  }

  return Object.keys(errors).length > 0
    ? { items: [], errors }
    : { items, errors };
}
