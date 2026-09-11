import { z } from "zod";
import {
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";

export const restaurantIdParamSchema = z.object({
  restaurantId: z.string().min(1, "restaurantId is required"),
});

export const ingredientIdParamSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().min(1, "restaurantId is required"),
    id: z.string().regex(/^\d+$/, "id must be numeric").transform(Number),
  }),
);

export const menuItemIdParamSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().min(1, "restaurantId is required"),
    menuItemId: z
      .string()
      .regex(/^\d+$/, "menuItemId must be numeric")
      .transform(Number),
  }),
);

export const createIngredientSchema = z.lazy(() =>
  z.object({
    name: z.string().min(1, "Name is required").max(200),
    unit: z.string().min(1, "Unit is required").max(50),
    category: z.string().max(100).optional(),
    costPerUnit: z.number().min(0).optional(),
    supplier: z.string().max(200).optional(),
    minStockLevel: z.number().min(0).optional(),
    currentStock: z.number().min(0).optional(),
  }),
);

// The nullable optionals are the "clear this field" half of the update
// contract: omitted leaves the column untouched, explicit null writes NULL.
export const updateIngredientSchema = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(200).optional(),
    unit: z.string().min(1).max(50).optional(),
    category: z.string().max(100).nullable().optional(),
    costPerUnit: z.number().min(0).nullable().optional(),
    supplier: z.string().max(200).nullable().optional(),
    minStockLevel: z.number().min(0).nullable().optional(),
    // Stock cannot be cleared once movement history is tracked because ledger
    // balances are non-null. Omission still means "leave it unchanged".
    currentStock: z.number().min(0).optional(),
  }),
);

export const bulkImportSchema = z.lazy(() =>
  z.object({
    ingredients: z
      .array(createIngredientSchema)
      .min(1, "At least one ingredient is required")
      .max(500, "Maximum 500 ingredients per import"),
  }),
);

export const updateStockSchema = z.lazy(() =>
  z.object({
    quantity: z.number().min(0, "Quantity must be non-negative"),
  }),
);

/**
 * A signed delta, because "took in 10 kg" and "threw away 2 kg" are what the
 * owner actually does. Zero is rejected: it would write a ledger row that
 * explains nothing.
 *
 * `reason` is a closed set here even though the column is free text — the
 * column stays open so order consumption (#278) can add its own tag without a
 * migration, but nothing an owner types should land in it.
 */
export const adjustStockSchema = z.lazy(() =>
  z.object({
    delta: z
      .number()
      .refine((v) => v !== 0, "Delta must not be zero")
      .refine(Number.isFinite, "Delta must be a finite number"),
    reason: z.enum(["purchase", "waste", "correction", "transfer"]),
    note: z.string().max(500).nullable().optional(),
  }),
);

export const setRecipeSchema = z.lazy(() =>
  z.object({
    ingredients: z.array(
      z.object({
        ingredientId: z.number().int().positive(),
        quantityPerServing: z.number().positive(),
        unit: z.string().min(1).max(50),
        isOptional: z.boolean().optional().default(false),
      }),
    ),
  }),
);

export const ingredientListQuerySchema = z.lazy(() =>
  z.object({
    page: boundedPageQuery(),
    limit: boundedLimitQuery("50"),
    category: z.string().optional(),
    search: z.string().optional(),
    includeInactive: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    // Server-side because the list is paginated: filtering the loaded page
    // client-side would report "no low stock" while page 2 is full of it.
    lowStock: z
      .string()
      .optional()
      .transform((v) => v === "true"),
  }),
);
