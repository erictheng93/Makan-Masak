/**
 * Menu Validation Schemas
 * Zod schemas for validating menu-related requests
 */

import { z } from "zod";

// Base validation schemas
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.lazy(() => z.number().int().min(0));
// `.trim()` MUST come before `.min(1)`. Zod runs checks in chain order, so
// `.min(1).trim()` measured the untrimmed string: a name of "   " passed the
// length check and was then trimmed to "", so the API answered 201 and stored
// a nameless menu item / category that rendered as a blank row on the public
// customer menu with no way to tell what it was.
const nonEmptyString = z.string().trim().min(1);
const optionalUrl = z.lazy(() => z.url().nullish());
const priceSchema = z.lazy(() => z.number().positive());
const MAX_PAGE = 1000;

/**
 * A reference to an already-uploaded image — never image bytes.
 *
 * This used to also accept `data:image/...;base64,...` up to ~10MB, which was
 * written verbatim into `menu_items.image_url` / `categories.image_url`. Because
 * the public menu endpoint has no pagination, one such row was re-serialised
 * into every `GET /menu/:restaurantId` response and into the KV cache entry
 * (25MB per-value ceiling), and multi-MB payloads simply timed out (#85).
 *
 * The real upload path is R2 via the image-processor
 * (`apps/admin-dashboard/src/composables/useImageUpload.ts`), which returns the
 * `imageUrl` / `imageId` / `imageVariants` to send here, so the data URL branch
 * was an unused back door. Rows that already hold a data URL still read back
 * fine — only new writes are blocked.
 */
const MAX_IMAGE_URL_CHARS = 2048;

const imageUrlSchema = z.lazy(() =>
  z
    .string()
    .max(MAX_IMAGE_URL_CHARS)
    .refine(
      (value) =>
        // Protocol-relative ("//host/x") is excluded: it is not a path on this
        // origin, it silently points at a third-party host.
        /^https?:\/\//i.test(value) ||
        (value.startsWith("/") && !value.startsWith("//")),
      {
        message:
          "imageUrl must be an http(s) URL or a /-relative path — upload the image first and send the returned URL, inline base64 data is not accepted",
      },
    )
    .nullish(),
);

/**
 * A `?limit=` on a public, unauthenticated endpoint.
 *
 * Without the ceiling, `?limit=999999` was a legal way for anyone to pull a
 * restaurant's whole catalogue in a single query (#85). The cap belongs in the
 * schema so every route sharing it inherits the bound.
 */
const boundedLimitQuery = (defaultValue: string, max: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .optional()
    .prefault(defaultValue)
    .pipe(z.number().int().min(1).max(max));

const MAX_PAGE_SIZE = 100;
const optionPublicIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,50}$/);
const optionKindSchema = z.lazy(() => z.enum(["size", "choice", "addon"]));
const optionGroupTypeSchema = z.enum(["single", "multiple"]);

// Menu Item Option Schemas
//
// Every object here is strict. `options` is free-form JSON typed by hand in the
// admin editor, and a non-strict object silently DROPS what it does not
// recognise: writing "addons" instead of "addOns" stored `{}` and answered 201,
// so the owner saw a saved item and the customer saw no add-ons, with nothing
// anywhere to say why. Strict turns that into a 400 naming the key.
//
// The optional fields below are the ones the rest of the system already reads
// or declares — CustomizationModal falls back to `priceModifier` when
// `priceAdjustment` is absent, and shared-types declares `available` and a
// per-choice `description`. They are listed so strict rejects typos without
// also rejecting configurations that work today.
const menuItemSizeSchema = z.lazy(() =>
  z
    .object({
      id: z.string(),
      name: nonEmptyString.max(50),
      priceAdjustment: z.number(),
      priceModifier: z.number().optional(),
      description: z.string().max(200).optional(),
      isDefault: z.boolean().optional(),
    })
    .strict(),
);

const menuItemCustomizationChoiceSchema = z.lazy(() =>
  z
    .object({
      id: z.string(),
      name: nonEmptyString.max(100),
      priceAdjustment: z.number().default(0),
      priceModifier: z.number().optional(),
      description: z.string().max(200).optional(),
      isDefault: z.boolean().optional(),
    })
    .strict(),
);

const menuItemCustomizationSchema = z.lazy(() =>
  z
    .object({
      id: z.string(),
      name: nonEmptyString.max(100),
      type: z.enum(["single", "multiple"]),
      required: z.boolean(),
      maxSelections: positiveInteger.optional(),
      choices: z.array(menuItemCustomizationChoiceSchema).min(1),
    })
    .strict(),
);

const menuItemAddOnSchema = z.lazy(() =>
  z
    .object({
      id: z.string(),
      name: nonEmptyString.max(100),
      price: z.number().nonnegative(),
      available: z.boolean().optional(),
      description: z.string().max(200).optional(),
      maxQuantity: positiveInteger.optional(),
      category: z.string().max(50).optional(),
    })
    .strict(),
);

const menuItemOptionsSchema = z.lazy(() =>
  z
    .object({
      sizes: z.array(menuItemSizeSchema).optional(),
      customizations: z.array(menuItemCustomizationSchema).optional(),
      addOns: z.array(menuItemAddOnSchema).optional(),
    })
    .strict(),
);

// Dietary Information Schema
const dietaryInfoSchema = z.lazy(() =>
  z.object({
    vegetarian: z.boolean().optional(),
    vegan: z.boolean().optional(),
    halal: z.boolean().optional(),
    glutenFree: z.boolean().optional(),
    dairyFree: z.boolean().optional(),
    nutFree: z.boolean().optional(),
    seafoodFree: z.boolean().optional(),
    organic: z.boolean().optional(),
    localSource: z.boolean().optional(),
  }),
);

// Image Variants Schema
const imageVariantsSchema = z.lazy(() =>
  z.object({
    thumbnail: optionalUrl,
    small: optionalUrl,
    medium: optionalUrl,
    large: optionalUrl,
  }),
);

// Available Hours Schema
const availableHoursSchema = z.lazy(() =>
  z.object({
    start: z
      .string()
      .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .optional(),
    end: z
      .string()
      .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .optional(),
    days: z.array(z.number().int().min(0).max(6)).optional(),
  }),
);

// Menu Item Schemas
/**
 * Field shape without creation defaults.
 *
 * Update schemas partial() this rather than the create schema. Zod 4's
 * .partial() does NOT strip .default(), so partialling a schema that carries
 * defaults makes every field with one materialise on an absent key — and the
 * update services write whatever keys are present, silently overwriting columns
 * the caller never mentioned. Keep defaults in createMenuItemSchema only.
 */
const menuItemBaseSchema = z.object({
  categoryId: positiveInteger,
  catalogType: z.enum(["menu_item", "product"]).optional(),
  name: nonEmptyString.max(100),
  // Nullable so an emptied description can be removed. `optional()` alone made
  // clearing impossible: the form dropped the key and a partial update only
  // writes the keys it carries, so the stored text survived every save.
  description: z.string().max(500).nullish(),
  ingredients: z.string().max(200).nullish(),
  price: priceSchema,
  originalPrice: priceSchema.nullish(),
  // The admin form has always collected an English name and filters search on
  // it, but there was no column and no schema field, so it was stripped on
  // every save. Backed by menu_items.name_en as of migration 0076 (#107).
  nameEn: z.string().max(200).nullish(),
  imageUrl: imageUrlSchema,
  imageId: z.uuid().nullish(),
  // The admin dashboard sends imageVariants: null for no-image saves, so null
  // must be accepted here just like imageUrl/imageId (#78).
  imageVariants: imageVariantsSchema.nullish(),
  spiceLevel: z.number().int().min(0).max(5).optional(),
  preparationTime: positiveInteger.optional(),
  calories: positiveInteger.nullish(),
  dietaryInfo: dietaryInfoSchema.optional(),
  allergens: z.array(z.string()).optional(),
  options: menuItemOptionsSchema.nullish(),
  availableHours: availableHoursSchema.optional(),
  tags: z.array(z.string()).optional(),
  keywords: z.string().max(200).nullish(),
  // These five must live on the base schema so BOTH create and update accept
  // them. They used to exist only on updateMenuItemSchema, so create requests
  // had them silently stripped while the API still answered 201 (#78).
  // No defaults here — the DB layer owns those (isAvailable=true, sortOrder=0).
  isAvailable: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  sortOrder: nonNegativeInteger.optional(),
  inventoryCount: nonNegativeInteger.nullish(),
  minInventoryAlert: nonNegativeInteger.nullish(),
});

/**
 * Business rules attached to the schemas the routes actually validate with.
 *
 * These rules used to live only on `validateCompleteMenuItem`, which no route
 * ever imported — the rules had green tests and never executed, so the API
 * happily created "original $100, special $200" items (#81). They are zod
 * issues (not thrown Errors) so a violation surfaces as the standard 400
 * VALIDATION_ERROR envelope instead of a 500.
 */
const priceConsistencyRule = (
  data: { price?: number; originalPrice?: number | null },
  ctx: z.core.$RefinementCtx,
) => {
  if (
    data.price !== undefined &&
    data.originalPrice !== undefined &&
    data.originalPrice !== null &&
    data.price > data.originalPrice
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["price"],
      message:
        "price cannot be higher than originalPrice — the discounted price must not exceed the price it is discounted from",
    });
  }
};

const customizationRule = (
  options: CustomizationOptions | null | undefined,
  ctx: z.core.$RefinementCtx,
) => {
  const failure = findCustomizationProblem(options);
  if (failure) {
    ctx.addIssue({ code: "custom", path: ["options"], message: failure });
  }
};

export const createMenuItemSchema = menuItemBaseSchema
  .extend({
    spiceLevel: z.number().int().min(0).max(5).optional().default(0),
    preparationTime: positiveInteger.optional().default(15),
  })
  .superRefine((data, ctx) => {
    priceConsistencyRule(data, ctx);
    customizationRule(data.options, ctx);
  });

/**
 * The only fields whose value does not depend on what the client last read.
 *
 * A body that writes just these is a stock decision ("we've run out"), and the
 * newest stock decision is the one that should win — so it needs no optimistic
 * lock. Anything else is a read-modify-write of a form the client rendered
 * earlier, which is where the lost update in #85 lives. Deliberately the same
 * set as CHEF_EDITABLE_ITEM_FIELDS in the routes: both answer "is this request
 * only about stock?".
 */
export const STOCK_ONLY_ITEM_FIELDS = [
  "isAvailable",
  "inventoryCount",
] as const;

/**
 * The optimistic-lock precondition: the `updatedAt` the client last read.
 *
 * Wire format is deliberately either shape, both normalised to epoch
 * milliseconds here so the service compares integers and never strings:
 *
 * - a raw epoch-ms integer, which current API responses produce;
 * - an ISO-8601 instant from a legacy client or a cached response replay.
 *   `Date.parse()` preserves millisecond precision, so either form reaches the
 *   service as the same integer.
 *
 * String comparison would have been the trap here: "…789Z" and "…789+00:00"
 * are the same instant and different strings.
 */
const updatedAtPrecondition = z.lazy(() =>
  z
    .union([z.number().int().min(0), z.iso.datetime({ offset: true })])
    .transform((value) =>
      typeof value === "number" ? value : Date.parse(value),
    ),
);

export const updateMenuItemSchema = z.lazy(() =>
  menuItemBaseSchema
    .partial()
    .extend({
      // Optional in the schema, mandatory in practice for every body that could
      // clobber a concurrent edit — see the refinement below. Making it
      // unconditionally required would reject a chef's stock-only PUT, which is
      // the one caller that legitimately has no form state to be stale.
      updatedAt: updatedAtPrecondition.optional(),
    })
    .refine(
      (data) =>
        data.updatedAt !== undefined ||
        Object.keys(data).every((field) =>
          (STOCK_ONLY_ITEM_FIELDS as readonly string[]).includes(field),
        ),
      {
        path: ["updatedAt"],
        message: `updatedAt is required unless the request only changes ${STOCK_ONLY_ITEM_FIELDS.join(
          " / ",
        )} — send back the updatedAt you read for this item so a concurrent edit cannot be silently overwritten`,
      },
    )
    // Same business rules as create, applied to what the body carries. A partial
    // body that sends only one of price/originalPrice is checked against the
    // stored other half in MenuService.updateMenuItem — the schema cannot see
    // the DB (#81).
    .superRefine((data, ctx) => {
      priceConsistencyRule(data, ctx);
      customizationRule(data.options, ctx);
    }),
);

// Category Schemas
// Defaults live on the create schema only — see menuItemBaseSchema.
const categoryBaseSchema = z.object({
  name: nonEmptyString.max(50),
  // Same stripped-field bug as menu items — the form always sent it, no column
  // existed, zod dropped it (#107). Backed by categories.name_en (0076).
  nameEn: z.string().max(50).nullish(),
  description: z.string().max(200).optional(),
  sortOrder: nonNegativeInteger.optional(),
  imageUrl: imageUrlSchema,
});

export const createCategorySchema = categoryBaseSchema.extend({
  sortOrder: nonNegativeInteger.optional().default(0),
});

export const updateCategorySchema = categoryBaseSchema.partial().extend({
  isActive: z.boolean().optional(),
  isVisible: z.boolean().optional(),
});

// Search and Filter Schemas
export const menuFilterSchema = z.lazy(() =>
  z.object({
    categoryId: z.string().regex(/^\d+$/).transform(Number).optional(),
    minPrice: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .transform(Number)
      .optional(),
    maxPrice: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .transform(Number)
      .optional(),
    spiceLevel: z.string().regex(/^\d+$/).transform(Number).optional(),
    dietaryPreferences: z.string().optional(),
    isAvailable: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    isFeatured: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    search: z.string().optional(),
    // page must be >=1 (page=0 produced a negative OFFSET downstream) and
    // bounded above so a public caller cannot page arbitrarily deep.
    page: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .optional()
      .prefault("1")
      .pipe(z.number().int().min(1).max(MAX_PAGE)),
    limit: boundedLimitQuery("20", MAX_PAGE_SIZE),
  }),
);

// Bulk Operation Schemas

/**
 * Same ceiling as the other bulk endpoints. It is not cosmetic: the CSV import
 * used to POST one item per row in a loop, so the only bound on a single import
 * was the operator's patience, and each row was a separate committed write
 * (#85). One request now carries the whole batch, which makes an explicit cap
 * the difference between a bounded payload and a new unbounded one.
 */
export const MAX_BULK_CREATE_ITEMS = 100;

export const bulkCreateMenuItemsSchema = z.lazy(() =>
  z.object({
    items: z.array(createMenuItemSchema).min(1).max(MAX_BULK_CREATE_ITEMS),
  }),
);

export const bulkAvailabilityUpdateSchema = z.lazy(() =>
  z.object({
    updates: z
      .array(
        z.object({
          id: positiveInteger,
          isAvailable: z.boolean(),
        }),
      )
      .min(1)
      .max(100), // Limit bulk operations to 100 items
  }),
);

export const bulkPriceUpdateSchema = z.lazy(() =>
  z.object({
    updates: z
      .array(
        z
          .object({
            id: positiveInteger,
            price: priceSchema,
            originalPrice: priceSchema.optional(),
          })
          // Same negative-discount gate as the single-item schemas — the batch
          // endpoint was the second way to create "original $100, special $200"
          // (#81). Entries that send only `price` are checked against the stored
          // originalPrice in MenuService.batchUpdatePrices.
          .superRefine(priceConsistencyRule),
      )
      .min(1)
      .max(100),
  }),
);

export const bulkCategoryMoveSchema = z.lazy(() =>
  z.object({
    updates: z
      .array(
        z.object({
          id: positiveInteger,
          categoryId: positiveInteger,
        }),
      )
      .min(1)
      .max(100),
  }),
);

// Parameter Schemas
export const restaurantIdParamSchema = z.object({
  restaurantId: z.string().min(1),
});

export const menuItemIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const categoryIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const optionGroupIdParamSchema = z.lazy(() =>
  z.object({
    groupId: z.string().min(1),
  }),
);

export const optionChoiceIdParamSchema = z.lazy(() =>
  z.object({
    choiceId: z.string().min(1),
  }),
);

export const createOptionGroupSchema = z.lazy(() =>
  z
    .object({
      publicId: optionPublicIdSchema,
      kind: optionKindSchema,
      name: nonEmptyString.max(100),
      type: optionGroupTypeSchema,
      required: z.boolean().optional(),
      maxSelections: positiveInteger.optional(),
      sortOrder: nonNegativeInteger.optional(),
    })
    .strict(),
);

export const updateOptionGroupSchema = z.lazy(() =>
  z
    .object({
      name: nonEmptyString.max(100).optional(),
      type: optionGroupTypeSchema.optional(),
      required: z.boolean().optional(),
      maxSelections: positiveInteger.nullable().optional(),
      sortOrder: nonNegativeInteger.optional(),
    })
    .strict(),
);

export const createOptionChoiceSchema = z.lazy(() =>
  z
    .object({
      publicId: optionPublicIdSchema,
      name: nonEmptyString.max(100),
      priceAdjustment: z.number().optional(),
      isDefault: z.boolean().optional(),
      isAvailable: z.boolean().optional(),
      maxQuantity: positiveInteger.optional(),
      sortOrder: nonNegativeInteger.optional(),
    })
    .strict(),
);

export const updateOptionChoiceSchema = z.lazy(() =>
  z
    .object({
      name: nonEmptyString.max(100).optional(),
      priceAdjustment: z.number().optional(),
      isDefault: z.boolean().optional(),
      isAvailable: z.boolean().optional(),
      maxQuantity: positiveInteger.nullable().optional(),
      sortOrder: nonNegativeInteger.optional(),
    })
    .strict(),
);

export const replaceMenuItemOptionGroupsSchema = z.lazy(() =>
  z
    .object({
      groups: z.array(
        z
          .object({
            groupId: z.string().min(1),
            sortOrder: nonNegativeInteger.optional(),
            requiredOverride: z.boolean().nullable().optional(),
            maxSelectionsOverride: positiveInteger.nullable().optional(),
            choiceOverrides: z
              .array(
                z
                  .object({
                    choiceId: z.string().min(1),
                    isHidden: z.boolean().optional(),
                    priceAdjustment: z.number().nullable().optional(),
                  })
                  .strict(),
              )
              .optional(),
          })
          .strict(),
      ),
    })
    .strict()
    .superRefine((data, ctx) => {
      const groupIds = new Set<string>();
      data.groups.forEach((group, groupIndex) => {
        if (groupIds.has(group.groupId)) {
          ctx.addIssue({
            code: "custom",
            path: ["groups", groupIndex, "groupId"],
            message: "groupId must be unique within groups",
          });
        }
        groupIds.add(group.groupId);

        const choiceIds = new Set<string>();
        group.choiceOverrides?.forEach((override, overrideIndex) => {
          if (choiceIds.has(override.choiceId)) {
            ctx.addIssue({
              code: "custom",
              path: [
                "groups",
                groupIndex,
                "choiceOverrides",
                overrideIndex,
                "choiceId",
              ],
              message: "choiceId must be unique within choiceOverrides",
            });
          }
          choiceIds.add(override.choiceId);
        });
      });
    }),
);

// Query Parameter Schemas
export const featuredItemsQuerySchema = z.lazy(() =>
  z.object({
    limit: boundedLimitQuery("10", MAX_PAGE_SIZE),
  }),
);

export const popularItemsQuerySchema = z.lazy(() =>
  z.object({
    limit: boundedLimitQuery("10", MAX_PAGE_SIZE),
  }),
);

export const analyticsQuerySchema = z.lazy(() =>
  z.object({
    startDate: z.iso.datetime().optional(),
    endDate: z.iso.datetime().optional(),
    includeDetails: z
      .string()
      .transform((val) => val === "true")
      .optional(),
  }),
);

// Import/Export Schemas
export const menuImportSchema = z.lazy(() =>
  z.object({
    categories: z.array(
      createCategorySchema.omit({ sortOrder: true }).extend({
        sortOrder: z.number().int().min(0).optional(),
      }),
    ),
    menuItems: z.array(createMenuItemSchema),
  }),
);

export const menuExportQuerySchema = z.lazy(() =>
  z.object({
    format: z.enum(["json", "csv", "xlsx"]).optional().default("json"),
    includeImages: z
      .string()
      .transform((val) => val === "true")
      .optional()
      .prefault("false"),
    includeAnalytics: z
      .string()
      .transform((val) => val === "true")
      .optional()
      .prefault("false"),
    categories: z.string().optional(), // Comma-separated category IDs
  }),
);

// Complex validation functions
interface AvailabilityShape {
  isAvailable?: boolean;
  inventoryCount?: number;
  availableHours?: {
    start?: string;
    end?: string;
    days?: number[];
  };
}

export const validateMenuItemAvailability = (item: AvailabilityShape) => {
  if (!item.isAvailable && item.inventoryCount === 0) {
    return false;
  }
  if (item.availableHours) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    if (item.availableHours.start && item.availableHours.end) {
      const [startHour, startMinute] = item.availableHours.start
        .split(":")
        .map(Number);
      const [endHour, endMinute] = item.availableHours.end
        .split(":")
        .map(Number);
      const startTime = startHour * 60 + startMinute;
      const endTime = endHour * 60 + endMinute;

      if (currentTime < startTime || currentTime > endTime) {
        return false;
      }
    }

    if (
      item.availableHours.days &&
      !item.availableHours.days.includes(now.getDay())
    ) {
      return false;
    }
  }
  return true;
};

export const validatePriceConsistency = (
  price: number,
  originalPrice?: number,
) => {
  if (originalPrice && price > originalPrice) {
    throw new Error("Price cannot be higher than original price");
  }
  return true;
};

interface CustomizationChoice {
  isDefault?: boolean;
}

interface CustomizationGroup {
  name: string;
  required?: boolean;
  type?: string;
  choices: CustomizationChoice[];
}

interface SizeOption {
  isDefault?: boolean;
}

interface CustomizationOptions {
  customizations?: CustomizationGroup[];
  sizes?: SizeOption[];
}

/**
 * The customization rules as a lookup, so the schemas can report the problem
 * as a zod issue while validateCustomizationOptions keeps its throwing
 * contract for direct callers.
 */
function findCustomizationProblem(
  options: CustomizationOptions | null | undefined,
): string | null {
  if (!options) return null;

  // A required single-choice customization must have a default, or the
  // customer-facing item sheet renders a mandatory group with nothing selected.
  if (options.customizations) {
    for (const customization of options.customizations) {
      if (customization.required && customization.type === "single") {
        const hasDefault = customization.choices.some(
          (choice) => choice.isDefault,
        );
        if (!hasDefault) {
          return `Required customization "${customization.name}" must have a default choice`;
        }
      }
    }
  }

  if (options.sizes && options.sizes.length > 1) {
    const defaultSizes = options.sizes.filter((size) => size.isDefault);
    if (defaultSizes.length !== 1) {
      return "Exactly one size must be marked as default when multiple sizes are available";
    }
  }

  return null;
}

export const validateCustomizationOptions = (
  options: CustomizationOptions | null | undefined,
) => {
  const problem = findCustomizationProblem(options);
  if (problem) {
    throw new Error(problem);
  }
  return true;
};

/**
 * Kept as an alias: the rules it used to carry are now attached to
 * createMenuItemSchema itself, which is what the routes validate with — the
 * standalone version was never imported by any route, so its rules never ran
 * in production (#81).
 */
export const validateCompleteMenuItem = createMenuItemSchema;

// Export all schemas as a single object for easy import
export const menuSchemas = {
  // Creation schemas
  createMenuItem: createMenuItemSchema,
  updateMenuItem: updateMenuItemSchema,
  createCategory: createCategorySchema,
  updateCategory: updateCategorySchema,

  // Search and filter schemas
  menuFilter: menuFilterSchema,

  // Bulk operation schemas
  bulkCreateMenuItems: bulkCreateMenuItemsSchema,
  bulkAvailabilityUpdate: bulkAvailabilityUpdateSchema,
  bulkPriceUpdate: bulkPriceUpdateSchema,
  bulkCategoryMove: bulkCategoryMoveSchema,

  // Parameter schemas
  restaurantIdParam: restaurantIdParamSchema,
  menuItemIdParam: menuItemIdParamSchema,
  categoryIdParam: categoryIdParamSchema,
  optionGroupIdParam: optionGroupIdParamSchema,
  optionChoiceIdParam: optionChoiceIdParamSchema,

  // Option group schemas
  createOptionGroup: createOptionGroupSchema,
  updateOptionGroup: updateOptionGroupSchema,
  createOptionChoice: createOptionChoiceSchema,
  updateOptionChoice: updateOptionChoiceSchema,
  replaceMenuItemOptionGroups: replaceMenuItemOptionGroupsSchema,

  // Query schemas
  featuredItemsQuery: featuredItemsQuerySchema,
  popularItemsQuery: popularItemsQuerySchema,
  analyticsQuery: analyticsQuerySchema,

  // Import/Export schemas
  menuImport: menuImportSchema,
  menuExportQuery: menuExportQuerySchema,

  // Category reorder schema
  categoryReorder: z.lazy(() =>
    z.object({
      categories: z
        .array(
          z.object({
            id: z.number().int().positive(),
            sortOrder: z.number().int().min(0),
          }),
        )
        .min(1),
    }),
  ),

  // Complete validation
  validateCompleteMenuItem,
};
