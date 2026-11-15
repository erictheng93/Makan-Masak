import { z } from "zod";
import { EXPENSE_CATEGORIES, PLATFORM_TYPES } from "@makanmasak/database";

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

/** Range length is checked by the service (PNL_RANGE_INVALID), not here. */
export const rangeQuerySchema = z.object({ from: dateSchema, to: dateSchema });

const bps = z.number().int().min(0).max(10_000);
/** Unknown platform keys are rejected here; missing keys mean 0. */
export const ratesSchema = z.object({
  // Keys depend on the shop's orders, so PnlService.setRates checks them.
  paymentFeeBps: z.record(z.string().min(1).max(50), bps),
  platformCommissionBps: z.partialRecord(
    z.enum(Object.values(PLATFORM_TYPES)),
    bps,
  ),
});

export type RestaurantParamInput = z.infer<typeof restaurantParamSchema>;
export type ExpenseParamInput = z.infer<typeof expenseParamSchema>;
export type DailyQueryInput = z.infer<typeof dailyQuerySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type RangeQueryInput = z.infer<typeof rangeQuerySchema>;
export type RatesInput = z.infer<typeof ratesSchema>;
