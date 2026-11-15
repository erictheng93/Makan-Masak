import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { categories, menuItems } from "@makanmasak/database";
import {
  MAX_BULK_CREATE_ITEMS,
  bulkCreateMenuItemsSchema,
  createCategorySchema,
  createMenuItemSchema,
  featuredItemsQuerySchema,
  menuFilterSchema,
  popularItemsQuerySchema,
  updateCategorySchema,
  updateMenuItemSchema,
  validateCompleteMenuItem,
  validateCustomizationOptions,
  validateMenuItemAvailability,
  validatePriceConsistency,
} from "./validation";

/** An `updatedAt` as the API serialises it: ISO-8601, millisecond precision. */
const ITEM_VERSION = "2026-07-30T08:15:30.250Z";

describe("menu validation schemas", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses menu items with defaults and an uploaded image URL", () => {
    const parsed = createMenuItemSchema.parse({
      categoryId: 1,
      name: "  Nasi Lemak  ",
      price: 12,
      imageId: "01940000-0000-7000-8000-000000000001",
      imageUrl: "https://images.example.com/nasi-lemak/medium.webp",
    });

    expect(parsed).toMatchObject({
      categoryId: 1,
      name: "Nasi Lemak",
      price: 12,
      imageId: "01940000-0000-7000-8000-000000000001",
      imageUrl: "https://images.example.com/nasi-lemak/medium.webp",
      spiceLevel: 0,
      preparationTime: 15,
    });
  });

  // Issue #78: these fields were absent from createMenuItemSchema, so zod's
  // default strip mode silently discarded them while the API answered 201.
  it("preserves availability/featured/sort fields on create (#78)", () => {
    const parsed = createMenuItemSchema.parse({
      categoryId: 1,
      name: "審計品項A",
      price: 100,
      isFeatured: true,
      isAvailable: false,
      isPopular: true,
      sortOrder: 7,
      inventoryCount: 3,
    });

    expect(parsed).toMatchObject({
      isFeatured: true,
      isAvailable: false,
      isPopular: true,
      sortOrder: 7,
      inventoryCount: 3,
    });
  });

  it("leaves availability/featured/sort fields absent when not sent, and validates them when sent", () => {
    const parsed = createMenuItemSchema.parse({
      categoryId: 1,
      name: "Plain",
      price: 10,
    });
    // DB layer owns the defaults (isAvailable=true, sortOrder=0); the schema
    // must not materialise keys the caller never sent.
    expect(parsed).not.toHaveProperty("isAvailable");
    expect(parsed).not.toHaveProperty("sortOrder");

    expect(() =>
      createMenuItemSchema.parse({
        categoryId: 1,
        name: "Bad",
        price: 10,
        sortOrder: -1,
      }),
    ).toThrow();
    expect(() =>
      createMenuItemSchema.parse({
        categoryId: 1,
        name: "Bad",
        price: 10,
        isAvailable: "yes",
      }),
    ).toThrow();
  });

  // The admin dashboard always sends imageVariants: null when no image is
  // uploaded (useMenuManagement.ts `form.imageVariants ?? null`) — the schema
  // must accept null, like imageUrl/imageId already do.
  it("accepts the exact no-image dashboard create payload (#78)", () => {
    const parsed = createMenuItemSchema.parse({
      name: "測試品項",
      price: 100,
      categoryId: 1,
      catalogType: "menu_item",
      imageUrl: null,
      imageId: null,
      imageVariants: null,
      isFeatured: true,
      isAvailable: false,
      sortOrder: 7,
    });

    expect(parsed).toMatchObject({
      isFeatured: true,
      isAvailable: false,
      sortOrder: 7,
      imageVariants: null,
    });
  });

  it("rejects unsafe image URLs and inconsistent prices", () => {
    expect(() =>
      createMenuItemSchema.parse({
        categoryId: 1,
        name: "Soup",
        price: 8,
        imageUrl: "data:text/html;base64,PGgxPk5vPC9oMT4=",
      }),
    ).toThrow(/imageUrl/);

    expect(() => validatePriceConsistency(12, 10)).toThrow(
      /higher than original price/,
    );
  });

  // Issue #85: imageUrl accepted a base64 data URL of up to ~10MB and the API
  // wrote it straight into menu_items.image_url, so the unpaginated public menu
  // response (and its KV cache entry) carried the image bytes on every request.
  // Images go to R2 through the image-processor; the column holds a reference.
  describe("imageUrl only accepts a reference to an uploaded image (#85)", () => {
    const dataUrl = `data:image/png;base64,${Buffer.from(
      "x".repeat(1024),
    ).toString("base64")}`;

    it("rejects image data URLs, even well-formed small ones", () => {
      for (const schema of [createMenuItemSchema, createCategorySchema]) {
        expect(() =>
          schema.parse({
            categoryId: 1,
            name: "Rendang",
            price: 15,
            imageUrl: dataUrl,
          }),
        ).toThrow(/imageUrl/);
      }
    });

    it("accepts absolute and root-relative image references", () => {
      expect(
        createMenuItemSchema.parse({
          categoryId: 1,
          name: "Rendang",
          price: 15,
          imageUrl: "https://images.example.com/rendang.webp",
        }),
      ).toMatchObject({ imageUrl: "https://images.example.com/rendang.webp" });

      expect(
        createMenuItemSchema.parse({
          categoryId: 1,
          name: "Rendang",
          price: 15,
          imageUrl: "/uploads/x.png",
        }),
      ).toMatchObject({ imageUrl: "/uploads/x.png" });

      expect(
        createCategorySchema.parse({
          name: "主食",
          imageUrl: "/uploads/x.png",
        }),
      ).toMatchObject({ imageUrl: "/uploads/x.png" });

      // null stays valid — that is how the dashboard clears an image.
      // updatedAt rides along because clearing an image is a form save, and
      // those now carry the optimistic-lock precondition (#85).
      expect(
        updateMenuItemSchema.parse({ imageUrl: null, updatedAt: ITEM_VERSION }),
      ).toMatchObject({
        imageUrl: null,
      });
    });

    it("rejects a URL long enough to be a payload rather than a reference", () => {
      expect(() =>
        createMenuItemSchema.parse({
          categoryId: 1,
          name: "Rendang",
          price: 15,
          imageUrl: `https://images.example.com/${"a".repeat(2100)}.webp`,
        }),
      ).toThrow(/imageUrl/);
    });

    it("rejects protocol-relative URLs that point off-origin", () => {
      expect(() =>
        createMenuItemSchema.parse({
          categoryId: 1,
          name: "Rendang",
          price: 15,
          imageUrl: "//evil.example.com/x.png",
        }),
      ).toThrow(/imageUrl/);
    });
  });

  // Issue #85: these are public, unauthenticated endpoints — an uncapped limit
  // let anyone pull an entire catalogue in one query, and page=0 produced a
  // negative OFFSET.
  describe("public query limits are bounded (#85)", () => {
    it("caps search limit at 100 and requires page >= 1", () => {
      expect(menuFilterSchema.parse({ limit: "100", page: "3" })).toMatchObject(
        {
          limit: 100,
          page: 3,
        },
      );

      expect(() => menuFilterSchema.parse({ limit: "101" })).toThrow();
      expect(() => menuFilterSchema.parse({ limit: "999999" })).toThrow();
      expect(() => menuFilterSchema.parse({ limit: "0" })).toThrow();
      expect(() => menuFilterSchema.parse({ page: "0" })).toThrow();
    });

    it("caps featured and popular limits at 100 while keeping the defaults", () => {
      for (const schema of [
        featuredItemsQuerySchema,
        popularItemsQuerySchema,
      ]) {
        expect(schema.parse({})).toMatchObject({ limit: 10 });
        expect(schema.parse({ limit: "100" })).toMatchObject({ limit: 100 });
        expect(() => schema.parse({ limit: "999999" })).toThrow();
        expect(() => schema.parse({ limit: "0" })).toThrow();
      }
    });
  });

  it("validates required customization and size defaults", () => {
    expect(() =>
      validateCustomizationOptions({
        customizations: [
          {
            name: "Spice",
            required: true,
            type: "single",
            choices: [{ isDefault: false }],
          },
        ],
      }),
    ).toThrow(/must have a default choice/);

    expect(() =>
      validateCustomizationOptions({
        sizes: [{ isDefault: true }, { isDefault: true }],
      }),
    ).toThrow(/Exactly one size/);

    expect(
      validateCompleteMenuItem.parse({
        categoryId: 1,
        name: "Tea",
        price: 4,
        originalPrice: 5,
        options: {
          sizes: [{ id: "s", name: "Small", priceAdjustment: 0 }],
        },
      }),
    ).toMatchObject({ name: "Tea" });
  });

  it("rejects an unrecognised options key instead of silently dropping it", () => {
    const withMisspelledSection = {
      categoryId: 1,
      name: "Tea",
      price: 4,
      // The exact typo that used to be stripped: the item saved with 201 and
      // no add-ons, and nothing told the owner their JSON never landed.
      options: { addons: [{ id: "a", name: "Pearl", price: 10 }] },
    };

    expect(() => createMenuItemSchema.parse(withMisspelledSection)).toThrow(
      /addons/,
    );

    expect(() =>
      createMenuItemSchema.parse({
        categoryId: 1,
        name: "Tea",
        price: 4,
        options: {
          sizes: [
            { id: "s", name: "Small", priceAdjustment: 0, sizeName: "L" },
          ],
        },
      }),
    ).toThrow(/sizeName/);
  });

  it("keeps accepting the option fields the storefront already reads", () => {
    // CustomizationModal falls back to priceModifier, and shared-types declares
    // available / a per-choice description — strict must not reject these.
    expect(
      createMenuItemSchema.parse({
        categoryId: 1,
        name: "Tea",
        price: 4,
        options: {
          sizes: [
            { id: "s", name: "Small", priceAdjustment: 0, priceModifier: 0 },
          ],
          customizations: [
            {
              id: "c",
              name: "Ice",
              type: "single",
              required: false,
              choices: [
                {
                  id: "c1",
                  name: "Less",
                  priceAdjustment: 0,
                  description: "half ice",
                },
              ],
            },
          ],
          addOns: [{ id: "a", name: "Pearl", price: 10, available: true }],
        },
      }),
    ).toMatchObject({ name: "Tea" });
  });

  it("accepts null when clearing optional menu item fields", () => {
    expect(
      updateMenuItemSchema.parse({
        // Carries the optimistic-lock precondition because clearing a field is
        // a read-modify-write of a form the client rendered earlier — the
        // schema rejects such a body without it (#85).
        updatedAt: 1_700_000_000_000,
        nameEn: null,
        description: null,
        originalPrice: null,
        calories: null,
        ingredients: null,
        keywords: null,
        options: null,
      }),
    ).toMatchObject({
      nameEn: null,
      description: null,
      originalPrice: null,
      calories: null,
      ingredients: null,
      keywords: null,
      options: null,
    });
  });

  it("checks availability windows and query transforms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 7, 10, 30, 0));

    expect(
      validateMenuItemAvailability({
        isAvailable: true,
        inventoryCount: 5,
        availableHours: {
          start: "10:00",
          end: "11:00",
          days: [0],
        },
      }),
    ).toBe(true);
    expect(
      validateMenuItemAvailability({
        isAvailable: true,
        inventoryCount: 5,
        availableHours: {
          start: "11:00",
          end: "12:00",
          days: [0],
        },
      }),
    ).toBe(false);

    expect(
      menuFilterSchema.parse({
        categoryId: "12",
        minPrice: "3.5",
        isAvailable: "true",
      }),
    ).toMatchObject({
      categoryId: 12,
      minPrice: 3.5,
      isAvailable: true,
      page: 1,
      limit: 20,
    });

    expect(menuFilterSchema.parse({ page: "1000", limit: "100" })).toEqual({
      page: 1000,
      limit: 100,
    });
    expect(() => menuFilterSchema.parse({ page: "1001" })).toThrow();
    expect(() => menuFilterSchema.parse({ limit: "101" })).toThrow();
  });

  it("caps featured and popular item result sizes", () => {
    expect(() => featuredItemsQuerySchema.parse({ limit: "101" })).toThrow();
    expect(() => popularItemsQuerySchema.parse({ limit: "101" })).toThrow();
  });
});

// Issue #107: the admin item form and category form have always had an English
// name input, and item search filters on it, but no column and no schema field
// existed — so zod stripped it and every save discarded it while returning 2xx.
describe("menu item costPrice", () => {
  const base = { categoryId: 1, name: "Tea", price: 4 };

  it("is optional, accepts 0 and null, and survives parsing", () => {
    expect(createMenuItemSchema.parse(base)).not.toHaveProperty("costPrice");
    expect(createMenuItemSchema.parse({ ...base, costPrice: 0 })).toMatchObject(
      { costPrice: 0 },
    );
    expect(
      updateMenuItemSchema.parse({
        updatedAt: 1_700_000_000_000,
        costPrice: null,
      }),
    ).toMatchObject({ costPrice: null });
  });

  it("rejects a negative cost but never compares it with price", () => {
    expect(
      createMenuItemSchema.safeParse({ ...base, costPrice: -1 }).success,
    ).toBe(false);
    expect(
      createMenuItemSchema.safeParse({ ...base, costPrice: 9 }).success,
    ).toBe(true);
  });
});

describe("English name round-trips through the request schemas (#107)", () => {
  it("keeps nameEn on menu item create and update", () => {
    expect(
      createMenuItemSchema.parse({
        categoryId: 1,
        name: "海南雞飯",
        nameEn: "Hainanese Chicken Rice",
        price: 120,
      }),
    ).toMatchObject({ nameEn: "Hainanese Chicken Rice" });

    expect(
      updateMenuItemSchema.parse({
        nameEn: "Chicken Rice",
        updatedAt: ITEM_VERSION,
      }),
    ).toMatchObject({ nameEn: "Chicken Rice" });

    // Clearing the field has to survive too, otherwise there is no way to
    // remove an English name once set.
    expect(
      updateMenuItemSchema.parse({ nameEn: null, updatedAt: ITEM_VERSION }),
    ).toMatchObject({
      nameEn: null,
    });
  });

  it("keeps nameEn on category create and update", () => {
    expect(
      createCategorySchema.parse({ name: "主食", nameEn: "Main Dishes" }),
    ).toMatchObject({ nameEn: "Main Dishes" });

    expect(updateCategorySchema.parse({ nameEn: "Mains" })).toMatchObject({
      nameEn: "Mains",
    });
  });

  it("rejects an over-long nameEn instead of silently truncating", () => {
    expect(() =>
      createMenuItemSchema.parse({
        categoryId: 1,
        name: "x",
        price: 1,
        nameEn: "e".repeat(201),
      }),
    ).toThrow();
    expect(() =>
      createCategorySchema.parse({ name: "x", nameEn: "e".repeat(51) }),
    ).toThrow();
  });
});

// `nonEmptyString` was `z.string().min(1).trim()`, which measures the string
// BEFORE trimming: a name of "   " passed min(1), was trimmed to "", and the
// API answered 201. Production ended up with a nameless menu item and a
// nameless category, both rendered as blank rows on the public customer menu.
describe("whitespace-only names are rejected, not stored as empty", () => {
  const BLANK = ["   ", "\t", "\n", " 　 "];

  it.each(BLANK)("rejects a menu item named %j", (name) => {
    expect(() =>
      createMenuItemSchema.parse({ categoryId: 1, name, price: 100 }),
    ).toThrow();
  });

  it.each(BLANK)("rejects a category named %j", (name) => {
    expect(() => createCategorySchema.parse({ name })).toThrow();
  });

  it("rejects a whitespace-only rename through the update schemas", () => {
    expect(() =>
      updateMenuItemSchema.parse({ name: "   ", updatedAt: ITEM_VERSION }),
    ).toThrow();
    expect(() => updateCategorySchema.parse({ name: "   " })).toThrow();
  });

  it("still trims padded names down to their content", () => {
    expect(
      createMenuItemSchema.parse({
        categoryId: 1,
        name: "  皮蛋瘦肉粥  ",
        price: 100,
      }),
    ).toMatchObject({ name: "皮蛋瘦肉粥" });
  });

  it("rejects whitespace-only names nested in customization options", () => {
    expect(() =>
      createMenuItemSchema.parse({
        categoryId: 1,
        name: "廣東粥",
        price: 100,
        options: { addOns: [{ id: "a", name: "  ", price: 10 }] },
      }),
    ).toThrow();
  });
});

// Issue #85: PUT /menu/items/:id had no version check while the admin form
// saved every field it rendered, so an owner changing a price silently reverted
// a sold-out flag a chef had set in the meantime.
describe("menu item updates carry an optimistic-lock precondition (#85)", () => {
  it("normalises both accepted wire formats to epoch ms", () => {
    // What a JSON round-trip of the API's own response produces...
    expect(
      updateMenuItemSchema.parse({ price: 210, updatedAt: ITEM_VERSION }),
    ).toMatchObject({ updatedAt: Date.parse(ITEM_VERSION) });

    // ...and what a client that parsed the date itself would send.
    expect(
      updateMenuItemSchema.parse({
        price: 210,
        updatedAt: Date.parse(ITEM_VERSION),
      }),
    ).toMatchObject({ updatedAt: Date.parse(ITEM_VERSION) });

    // Same instant written with a numeric offset instead of Z — the reason the
    // comparison is done on epoch ms and never on the string.
    expect(
      updateMenuItemSchema.parse({
        price: 210,
        updatedAt: "2026-07-30T10:15:30.250+02:00",
      }),
    ).toMatchObject({ updatedAt: Date.parse(ITEM_VERSION) });
  });

  it("rejects a field-changing update that omits the version", () => {
    for (const body of [
      { price: 210 },
      { name: "Renamed" },
      { categoryId: 4 },
      { isAvailable: false, price: 210 },
    ]) {
      expect(() => updateMenuItemSchema.parse(body)).toThrow(/updatedAt/);
    }
  });

  it("still accepts a stock-only update with no version", () => {
    // A chef flipping availability has no rendered form to be stale, and the
    // newest stock decision should win — see STOCK_ONLY_ITEM_FIELDS.
    expect(updateMenuItemSchema.parse({ isAvailable: false })).toEqual({
      isAvailable: false,
    });
    expect(
      updateMenuItemSchema.parse({ isAvailable: false, inventoryCount: 0 }),
    ).toEqual({ isAvailable: false, inventoryCount: 0 });
  });

  it("rejects a version that is not a timestamp", () => {
    for (const updatedAt of ["yesterday", "", -1, null]) {
      expect(() =>
        updateMenuItemSchema.parse({ price: 210, updatedAt }),
      ).toThrow();
    }
  });
});

// Issue #85: the CSV importer POSTed one item per row, so the only bound on an
// import was the operator's patience and each row committed on its own.
describe("bulk menu item creation is bounded (#85)", () => {
  function row(overrides: Record<string, unknown> = {}) {
    return { categoryId: 1, name: "Rendang", price: 15, ...overrides };
  }

  it("parses a batch and applies the same per-item defaults as a single create", () => {
    const parsed = bulkCreateMenuItemsSchema.parse({ items: [row(), row()] });

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({
      name: "Rendang",
      price: 15,
      spiceLevel: 0,
      preparationTime: 15,
    });
  });

  it("rejects an empty batch and one over the cap", () => {
    expect(() => bulkCreateMenuItemsSchema.parse({ items: [] })).toThrow();
    expect(() =>
      bulkCreateMenuItemsSchema.parse({
        items: Array.from({ length: MAX_BULK_CREATE_ITEMS + 1 }, () => row()),
      }),
    ).toThrow();
    expect(
      bulkCreateMenuItemsSchema.parse({
        items: Array.from({ length: MAX_BULK_CREATE_ITEMS }, () => row()),
      }).items,
    ).toHaveLength(MAX_BULK_CREATE_ITEMS);
  });

  it("names the offending row index when one item is invalid", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      index === 6 ? row({ price: -1 }) : row(),
    );

    const result = bulkCreateMenuItemsSchema.safeParse({ items });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["items", 6, "price"]);
  });
});

/**
 * Drift guard for the #78 / #107 failure class.
 *
 * Both bugs were the same shape: a writable column existed (or was wanted) and
 * the UI sent it, but the zod schema never declared the key, so `parse()`
 * stripped it and the API answered 2xx while throwing the value away. Neither
 * a type error nor a runtime error ever fired.
 *
 * These tests make that drift fail in CI. Every column must be either declared
 * in the request schema or explicitly listed as server-owned — so adding a
 * column forces a deliberate decision about whether the API exposes it, rather
 * than defaulting to "silently unreachable".
 */
describe("request schemas do not drift from the writable columns", () => {
  /** zod key -> column property, where the API name differs from the column. */
  const MENU_ITEM_ALIASES: Record<string, string> = {
    price: "priceCents",
    originalPrice: "originalPriceCents",
    costPrice: "costPriceCents",
  };

  const MENU_ITEM_SERVER_OWNED = new Set([
    "id",
    "restaurantId", // comes from the path, not the body
    "orderCount",
    "rating",
    "reviewCount",
    "viewCount",
    "createdAt",
    "updatedAt",
    "deletedAt",
  ]);

  const CATEGORY_SERVER_OWNED = new Set([
    "id",
    "restaurantId",
    "iconUrl", // no UI yet
    "availableHours", // no UI yet
    "createdAt",
    "updatedAt",
    "deletedAt",
  ]);

  it("declares every client-writable menu_items column", () => {
    const declared = new Set(
      Object.keys(createMenuItemSchema.shape).map(
        (key) => MENU_ITEM_ALIASES[key] ?? key,
      ),
    );
    const undeclared = Object.keys(getTableColumns(menuItems)).filter(
      (column) => !declared.has(column) && !MENU_ITEM_SERVER_OWNED.has(column),
    );

    expect(undeclared).toEqual([]);
  });

  it("declares every client-writable categories column", () => {
    // isActive / isVisible are update-only by design, so the union is what the
    // API can accept across both routes.
    const declared = new Set([
      ...Object.keys(createCategorySchema.shape),
      ...Object.keys(updateCategorySchema.shape),
    ]);
    const undeclared = Object.keys(getTableColumns(categories)).filter(
      (column) => !declared.has(column) && !CATEGORY_SERVER_OWNED.has(column),
    );

    expect(undeclared).toEqual([]);
  });

  it("has no schema key that maps to a missing column", () => {
    const menuItemColumns = new Set(Object.keys(getTableColumns(menuItems)));
    const orphanItemKeys = Object.keys(createMenuItemSchema.shape).filter(
      (key) => !menuItemColumns.has(MENU_ITEM_ALIASES[key] ?? key),
    );
    expect(orphanItemKeys).toEqual([]);

    // updateCategory's service signature accepted `nameEn` for a long time
    // while the column did not exist — a request that reached it would have
    // crashed in Drizzle's update builder (#107).
    const categoryColumns = new Set(Object.keys(getTableColumns(categories)));
    const orphanCategoryKeys = [
      ...Object.keys(createCategorySchema.shape),
      ...Object.keys(updateCategorySchema.shape),
    ].filter((key) => !categoryColumns.has(key));
    expect(orphanCategoryKeys).toEqual([]);
  });
});
