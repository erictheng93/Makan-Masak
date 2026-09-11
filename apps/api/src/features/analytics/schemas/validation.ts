/**
 * Analytics Validation Schemas
 * Zod schemas for input validation in the analytics feature
 */

import { z } from "zod";
import { boundedLimitQuery } from "../../../middleware/validation";

const restaurantIdSchema = z.string().trim().min(1).max(128).optional();

function normalizeRestaurantIdAlias(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const query = input as Record<string, unknown>;
  return {
    ...query,
    restaurantId: query.restaurantId ?? query.restaurant_id,
  };
}

function queryWithRestaurantId<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess(
    normalizeRestaurantIdAlias,
    z.object({
      restaurantId: restaurantIdSchema,
      ...shape,
    }),
  );
}

const analyticsQueryShape = {
  dateFrom: z.lazy(() => z.iso.datetime().optional()),
  dateTo: z.lazy(() => z.iso.datetime().optional()),
  groupBy: z.lazy(() =>
    z.enum(["day", "week", "month", "year"]).default("day"),
  ),
  limit: boundedLimitQuery("30"),
};

// Base analytics query schema
export const analyticsQuerySchema = queryWithRestaurantId(analyticsQueryShape);

// Dashboard query schema
export const dashboardQuerySchema = queryWithRestaurantId({
  period: z.enum(["today", "week", "month", "year"]).default("today"),
});

// Revenue analytics query schema
export const revenueQuerySchema = queryWithRestaurantId({
  ...analyticsQueryShape,
  includeComparison: z
    .string()
    .transform((val) => val === "true")
    .prefault("false"),
});

// Performance analytics query schema
export const performanceQuerySchema = queryWithRestaurantId({
  ...analyticsQueryShape,
  metric: z
    .enum(["orders", "revenue", "avg_order_value", "customer_count"])
    .default("orders"),
});

// Export query schema
export const exportQuerySchema = queryWithRestaurantId({
  ...analyticsQueryShape,
  type: z
    .enum(["dashboard", "revenue", "products", "customers", "performance"])
    .default("dashboard"),
  format: z.enum(["json", "csv"]).default("json"),
});

// Real-time dashboard query schema
export const realtimeDashboardQuerySchema = queryWithRestaurantId({});

// Owner dashboard query schema
export const ownerDashboardQuerySchema = queryWithRestaurantId({});

// Financial report query schema
export const financialReportQuerySchema = queryWithRestaurantId({
  period: z.enum(["daily", "weekly", "monthly", "yearly"]).default("monthly"),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  month: z
    .string()
    .regex(/^(0?[1-9]|1[0-2])$/)
    .optional(),
});

// SSE query schema
export const sseQuerySchema = z.lazy(() =>
  z.object({
    lastEventId: z.string().optional(),
  }),
);

// Date range validation helper
export const dateRangeSchema = z.lazy(() =>
  z
    .object({
      dateFrom: z.iso.datetime(),
      dateTo: z.iso.datetime(),
    })
    .refine((data) => new Date(data.dateFrom) <= new Date(data.dateTo), {
      message: "dateFrom must be before or equal to dateTo",
      path: ["dateFrom"],
    }),
);

// Export type inference for TypeScript
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type RevenueQuery = z.infer<typeof revenueQuerySchema>;
export type PerformanceQuery = z.infer<typeof performanceQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type RealtimeDashboardQuery = z.infer<
  typeof realtimeDashboardQuerySchema
>;
export type OwnerDashboardQuery = z.infer<typeof ownerDashboardQuerySchema>;
export type FinancialReportQuery = z.infer<typeof financialReportQuerySchema>;
export type SSEQuery = z.infer<typeof sseQuerySchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
