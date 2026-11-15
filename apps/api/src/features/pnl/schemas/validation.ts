import { z } from "zod";
import { EXPENSE_CATEGORIES } from "@makanmasak/database";

/** YYYY-MM-DD that is a real calendar day (rejects 2026-02-31). */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
    {
      message: "Not a real calendar date",
    },
  );

export const restaurantParamSchema = z.object({
  restaurantId: z.string().trim().min(1),
});

export const expenseParamSchema = restaurantParamSchema.extend({
  expenseId: z.string().trim().min(1),
});

export const dailyQuerySchema = z.object({ date: dateSchema.optional() });

export const createExpenseSchema = z.object({
  date: dateSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  note: z.string().trim().max(200).optional(),
});

export type RestaurantParamInput = z.infer<typeof restaurantParamSchema>;
export type ExpenseParamInput = z.infer<typeof expenseParamSchema>;
export type DailyQueryInput = z.infer<typeof dailyQuerySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
