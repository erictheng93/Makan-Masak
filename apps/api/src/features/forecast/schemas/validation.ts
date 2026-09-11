// apps/api/src/features/forecast/schemas/validation.ts
import { z } from "zod";

const dateStringSchema = z.lazy(() =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
);

/**
 * Forecast generation performs work once per date. A 31-day inclusive horizon
 * supports month-ahead operations while bounding database and cache work.
 */
export const MAX_FORECAST_RANGE_DAYS = 31;

interface DateRange {
  startDate?: string;
  endDate?: string;
}

const rangeIsOrdered = ({ startDate, endDate }: DateRange) =>
  !startDate || !endDate || startDate <= endDate;

const rangeIsWithinLimit = ({ startDate, endDate }: DateRange) => {
  if (!startDate || !endDate) return true;

  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  const rangeDays = (end - start) / 86_400_000 + 1;
  return rangeDays <= MAX_FORECAST_RANGE_DAYS;
};

const orderedRangeRefinement = {
  message: "startDate must be before or equal to endDate",
  path: ["endDate"],
};

const boundedRangeRefinement = {
  message: `Date range cannot exceed ${MAX_FORECAST_RANGE_DAYS} days`,
  path: ["endDate"],
};

export const generateForecastSchema = z.lazy(() =>
  z
    .object({
      startDate: dateStringSchema,
      endDate: dateStringSchema,
      type: z.enum(["item_level", "ingredient_level"]).default("item_level"),
      useAI: z.boolean().default(false),
    })
    .refine(rangeIsOrdered, orderedRangeRefinement)
    .refine(rangeIsWithinLimit, boundedRangeRefinement),
);

export const getForecastQuerySchema = z.lazy(() =>
  z
    .object({
      date: dateStringSchema.optional(),
      startDate: dateStringSchema.optional(),
      endDate: dateStringSchema.optional(),
      type: z.enum(["item_level", "ingredient_level"]).optional(),
    })
    .refine((data) => data.date || (data.startDate && data.endDate), {
      message: "Either 'date' or both 'startDate' and 'endDate' are required",
    })
    .refine(rangeIsOrdered, orderedRangeRefinement)
    .refine(rangeIsWithinLimit, boundedRangeRefinement),
);

export const accuracyQuerySchema = z.lazy(() =>
  z
    .object({
      startDate: dateStringSchema,
      endDate: dateStringSchema,
    })
    .refine(rangeIsOrdered, orderedRangeRefinement)
    .refine(rangeIsWithinLimit, boundedRangeRefinement),
);

export const ingredientForecastQuerySchema = z.lazy(() =>
  z
    .object({
      startDate: dateStringSchema,
      endDate: dateStringSchema,
    })
    .refine(rangeIsOrdered, orderedRangeRefinement)
    .refine(rangeIsWithinLimit, boundedRangeRefinement),
);

export const restaurantIdParamSchema = z.object({
  restaurantId: z.string().min(1, "restaurantId is required"),
});
