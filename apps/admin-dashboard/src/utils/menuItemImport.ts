import Papa from "papaparse";
import type { CategoryData } from "@/composables/useMenuManagement";
import {
  getCurrencyConfig,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@makanmasak/utils";

export type ImportPriceProblem = "invalid" | "wholeUnits" | "tooPrecise";

/**
 * Check a price typed in major units against the shop currency. TWD and VND
 * have no fractional unit, so NT$12.5 is rejected; MYR takes up to two
 * decimals, so RM12.50 is accepted. Returns null when the price is usable.
 */
export function importPriceProblem(
  price: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): ImportPriceProblem | null {
  if (!Number.isFinite(price) || price < 0) return "invalid";
  const decimals = getCurrencyConfig(currency)?.decimals ?? 0;
  const scaled = price * 10 ** decimals;
  // Tolerate float noise: 12.1 * 100 is 1209.9999999999998.
  if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return null;
  return decimals === 0 ? "wholeUnits" : "tooPrecise";
}

export interface MenuItemImportInput {
  name: string;
  categoryId: number;
  catalogType: "menu_item" | "product";
  price: number;
  description?: string;
  imageUrl?: string | null;
  isFeatured: boolean;
  isAvailable: boolean;
  sortOrder: number;
  tags?: string[];
  keywords?: string;
}

export interface MenuItemImportRow {
  line: number;
  name: string;
  categoryName: string;
  price: string;
  errors: string[];
  raw: CsvRow;
  /** Set once the row has no errors. */
  item: MenuItemImportInput | null;
}

export interface MenuItemImportParseResult {
  /** Valid rows only; rows with errors are skipped, not fatal. */
  items: MenuItemImportInput[];
  /** CSV line of each entry in `items`, so API row indexes map back after skipped rows. */
  lines: number[];
  /** Problems with the whole paste (header, empty); these block the import. */
  errors: string[];
  rows: MenuItemImportRow[];
}

const csvFields = [
  "name",
  "category",
  "price",
  "description",
  "imageUrl",
  "isFeatured",
  "isAvailable",
  "sortOrder",
  "catalogType",
  "tags",
  "keywords",
] as const;

type CsvField = (typeof csvFields)[number];
type CsvRow = Record<CsvField, string | undefined>;

const fieldLabels: Record<CsvField, string> = {
  name: "名稱",
  category: "分類",
  price: "價格",
  description: "說明",
  imageUrl: "圖片網址",
  isFeatured: "推薦",
  isAvailable: "供應中",
  sortOrder: "排序",
  catalogType: "類型",
  tags: "標籤",
  keywords: "搜尋關鍵字",
};

const headerAliases: Record<string, CsvField> = {
  ...Object.fromEntries(csvFields.map((field) => [field.toLowerCase(), field])),
  ...Object.fromEntries(
    Object.entries(fieldLabels).map(([field, label]) => [label, field]),
  ),
  品名: "name",
  菜名: "name",
  商品名稱: "name",
  菜品名稱: "name",
  类别: "category",
  分类: "category",
  類別: "category",
  售價: "price",
  单价: "price",
  單價: "price",
  价格: "price",
  售价: "price",
  说明: "description",
  描述: "description",
  介紹: "description",
  圖片: "imageUrl",
  招牌: "isFeatured",
  上架: "isAvailable",
  标签: "tags",
  關鍵字: "keywords",
  关键字: "keywords",
};

function normalizeHeader(header: string) {
  const trimmed = header.trim();
  return (
    headerAliases[trimmed.toLowerCase()] ?? headerAliases[trimmed] ?? trimmed
  );
}

export function buildMenuItemImportTemplate(
  categoryName = "主食",
  marketKeyword = "",
) {
  const keywords = ["蚵仔煎", "夜市", marketKeyword].filter(Boolean).join(" ");
  // Tab separated, so it pastes into Excel as columns and back out again.
  return [
    ["名稱", "價格", "分類", "說明", "搜尋關鍵字"],
    ["蚵仔煎", "70", categoryName, "招牌小吃", keywords],
    ["紅茶", "25", categoryName, "古早味紅茶", ""],
  ]
    .map((cells) => cells.join("\t"))
    .join("\n");
}

export function parseMenuItemImport(
  text: string,
  categories: CategoryData[],
  currency: CurrencyCode = DEFAULT_CURRENCY,
  defaultCategoryId: number | null = null,
): MenuItemImportParseResult {
  if (!text.trim()) {
    return {
      items: [],
      lines: [],
      errors: ["請貼上要匯入的商品資料。"],
      rows: [],
    };
  }

  // No delimiter given: Papa detects tabs (pasted from Excel) or commas.
  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
    transform: (value) => value.trim(),
  });
  // A stale selection (e.g. left over from another restaurant) must not win.
  const validDefaultCategoryId =
    defaultCategoryId !== null &&
    categories.some((category) => category.id === defaultCategoryId)
      ? defaultCategoryId
      : null;
  const fallbackCategoryId =
    validDefaultCategoryId ??
    (categories.length === 1 ? categories[0].id : null);

  const rows: MenuItemImportRow[] = parsed.data.map((row, index) => {
    const line = index + 2;
    return {
      line,
      name: normalizeCell(row.name) ?? "",
      categoryName:
        normalizeCell(row.category) ??
        categories.find((category) => category.id === fallbackCategoryId)
          ?.name ??
        "",
      price: normalizeCell(row.price) ?? "",
      errors: validateMenuItemImportRow(
        row,
        categories,
        currency,
        fallbackCategoryId,
      ),
      raw: row,
      item: null,
    };
  });

  const globalErrors: string[] = [];
  if (!parsed.meta.fields?.includes("name")) {
    globalErrors.push(
      "第 1 列必須是表頭，至少要有「名稱」和「價格」兩欄（可按「載入範例」參考）。",
    );
  }
  for (const error of parsed.errors) {
    // Excel drops trailing empty cells; a short row just means blank fields.
    if (error.code === "TooFewFields") continue;
    const message =
      error.code === "TooManyFields"
        ? "欄位比表頭多，文字裡的逗號請改用全形「，」或從 Excel 直接複製貼上。"
        : `格式不正確 (${error.message})。`;
    const row = error.row === undefined ? undefined : rows[error.row];
    if (row) {
      row.errors.unshift(message);
    } else {
      globalErrors.push(message);
    }
  }

  if (rows.length === 0 && globalErrors.length === 0) {
    globalErrors.push("請貼上至少一筆商品資料。");
  }

  for (const row of rows) {
    if (row.errors.length === 0) {
      row.item = csvRowToMenuItem(
        row.raw,
        categories,
        fallbackCategoryId,
        currency,
      );
    }
  }

  const submitted = globalErrors.length ? [] : rows.filter((row) => row.item);
  return {
    items: submitted.map((row) => row.item as MenuItemImportInput),
    lines: submitted.map((row) => row.line),
    errors: globalErrors,
    rows,
  };
}

/** The rows that were not imported, as text the owner can fix and resubmit. */
export function buildMenuItemImportRetryText(rows: MenuItemImportRow[]) {
  const failed = rows.filter((row) => row.errors.length > 0);
  if (!failed.length) return "";
  const fields = csvFields.filter((field) =>
    failed.some((row) => row.raw[field] !== undefined),
  );
  // Header rides as an ordinary row: with `fields` Papa truncates every row to
  // the header width, which would drop the surplus cells of a TooManyFields row.
  return Papa.unparse(
    [
      fields.map((field) => fieldLabels[field]),
      ...failed.map((row) => [
        ...fields.map((field) => row.raw[field] ?? ""),
        // Papa parks cells beyond the header here; keep them so the owner's text survives.
        ...((row.raw as { __parsed_extra?: string[] }).__parsed_extra ?? []),
      ]),
    ],
    { delimiter: "\t" },
  );
}

function csvRowToMenuItem(
  row: CsvRow,
  categories: CategoryData[],
  fallbackCategoryId: number | null,
  currency: CurrencyCode,
): MenuItemImportInput | null {
  const categoryId = resolveCategoryId(
    row.category,
    categories,
    fallbackCategoryId,
  );
  if (!categoryId) return null;

  const tags = parseTags(row.tags);
  const item: MenuItemImportInput = {
    name: normalizeCell(row.name) ?? "",
    categoryId,
    catalogType: parseCatalogType(row.catalogType) ?? "menu_item",
    price: parsePrice(row.price, currency) ?? 0,
    isFeatured: parseBoolean(row.isFeatured, false),
    isAvailable: parseBoolean(row.isAvailable, true),
    sortOrder: parseOptionalNumber(row.sortOrder) ?? 0,
  };
  assignIfDefined(item, "description", normalizeCell(row.description));
  assignIfDefined(item, "imageUrl", normalizeCell(row.imageUrl));

  if (tags.length) {
    item.tags = tags;
  }

  item.keywords = (normalizeCell(row.keywords) ?? tags.join(" ")) || undefined;

  return item;
}

function assignIfDefined<T extends keyof MenuItemImportInput>(
  item: MenuItemImportInput,
  key: T,
  value: MenuItemImportInput[T] | undefined,
) {
  if (value !== undefined) {
    item[key] = value;
  }
}

function normalizeCell(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveCategoryId(
  value: string | undefined,
  categories: CategoryData[],
  fallbackCategoryId: number | null,
) {
  const normalized = normalizeCell(value);
  if (!normalized) return fallbackCategoryId;

  const numericId = Number(normalized);
  if (Number.isInteger(numericId)) {
    return categories.some((category) => category.id === numericId)
      ? numericId
      : null;
  }

  return (
    categories.find((category) => category.name === normalized)?.id ?? null
  );
}

function parseOptionalNumber(value: string | undefined) {
  const normalized = normalizeCell(value);
  if (normalized === undefined) return undefined;
  return Number(normalized);
}

/** Accepts what people type in a spreadsheet: "NT$1,200", "70元", "RM12.50". */
function parsePrice(
  value: string | undefined,
  currency: CurrencyCode = DEFAULT_CURRENCY,
) {
  const stripped = normalizeCell(value)
    ?.replace(/^(NT\$|RM|Rp|\$|₫)\s*/i, "")
    .replace(/\s*(元|塊|₫)$/, "")
    // Spaces and NBSP / narrow NBSP are grouping marks in some locales.
    .replace(/[\s  ]/g, "");
  if (!stripped) return undefined;

  const decimals = getCurrencyConfig(currency)?.decimals ?? 0;
  if (decimals > 0) return Number(stripped.replace(/,/g, ""));

  // Whole-unit currencies (TWD, VND): "." and "," are grouping marks, as in
  // vi-VN "1.200.000 ₫". Only accept them as clean groups of three; anything
  // else ("35.5", "1,5", "1.200,50") is ambiguous and must fail validation.
  if (/^\d{1,3}([.,]\d{3})+$/.test(stripped)) {
    return Number(stripped.replace(/[.,]/g, ""));
  }
  // "35.5" stays 35.5 so importPriceProblem reports it as a decimal.
  return /^\d+(\.\d+)?$/.test(stripped) ? Number(stripped) : Number.NaN;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  const normalized = normalizeCell(value);
  if (normalized === undefined) return fallback;
  return ["true", "1", "yes", "y", "v", "是", "有", "✓", "✔"].includes(
    normalized.toLowerCase(),
  );
}

function parseTags(value: string | undefined) {
  return (
    normalizeCell(value)
      ?.split(/[;,，、]/)
      .map((tag) => tag.trim())
      .filter(Boolean) ?? []
  );
}

function validateMenuItemImportRow(
  row: CsvRow,
  categories: CategoryData[],
  currency: CurrencyCode,
  fallbackCategoryId: number | null,
) {
  const errors: string[] = [];

  if (!normalizeCell(row.name)) {
    errors.push(`名稱沒有填。`);
  }

  if (!resolveCategoryId(row.category, categories, fallbackCategoryId)) {
    errors.push(
      normalizeCell(row.category)
        ? `找不到分類「${normalizeCell(row.category)}」，請先在左邊新增這個分類。`
        : `分類沒有填（或先在左邊選好分類再貼上）。`,
    );
  }

  const price = parsePrice(row.price, currency);
  const priceProblem =
    price === undefined ? null : importPriceProblem(price, currency);
  if (price === undefined) {
    errors.push(`價格沒有填。`);
  } else if (priceProblem === "invalid") {
    errors.push(`價格「${row.price}」不是有效的金額。`);
  } else if (priceProblem === "wholeUnits") {
    errors.push(`價格不能有小數（${currency}）。`);
  } else if (priceProblem === "tooPrecise") {
    errors.push(`價格最多兩位小數（${currency}）。`);
  }

  const imageUrl = normalizeCell(row.imageUrl);
  if (imageUrl && !isValidUrl(imageUrl)) {
    errors.push(`圖片網址不是有效的網址。`);
  }

  if (!isOptionalIntegerInRange(parseOptionalNumber(row.sortOrder), 0)) {
    errors.push(`排序必須是 0 以上的整數。`);
  }

  if (normalizeCell(row.catalogType) && !parseCatalogType(row.catalogType)) {
    errors.push(`類型只能填「餐點」或「商品」。`);
  }

  return errors;
}

function parseCatalogType(value: string | undefined) {
  const normalized = normalizeCell(value);
  if (normalized === "menu_item" || normalized === "餐點") return "menu_item";
  if (normalized === "product" || normalized === "商品") return "product";
  return undefined;
}

function isOptionalIntegerInRange(value: number | undefined, min: number) {
  if (value === undefined) return true;
  return Number.isInteger(value) && value >= min;
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
