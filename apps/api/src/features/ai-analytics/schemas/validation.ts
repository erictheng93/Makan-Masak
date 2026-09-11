/**
 * AI Analytics Validation Schemas
 * Zod schemas for request validation
 */

import { z } from "zod";
import { boundedLimitQuery } from "../../../middleware/validation";

// Time range schema
export const timeRangeSchema = z.lazy(() =>
  z.object({
    range: z.enum(["7d", "14d", "30d", "90d", "180d", "1y", "custom"]),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
);

// AI provider enum
export const aiProviderSchema = z.lazy(() =>
  z.enum(["anthropic", "openai", "google", "deepseek", "custom"]),
);

// Configure AI schema
export const configureAISchema = z.lazy(() =>
  z.object({
    restaurantId: z.string(),
    provider: aiProviderSchema,
    apiKey: z.string().min(10),
    model: z.string().optional(),
    customBaseUrl: z.url().optional(),
  }),
);

// Test provider schema
export const testProviderSchema = z.lazy(() =>
  z.object({
    provider: aiProviderSchema,
    apiKey: z.string().min(10),
    model: z.string().optional(),
    baseUrl: z.url().optional(),
  }),
);

// Generate analytics schema
export const generateAnalyticsSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string(),
    timeRange: timeRangeSchema,
    includeForecasting: z.boolean().optional(),
    refreshCache: z.boolean().optional(),
  }),
);

// Product query schema
export const productQuerySchema = z.lazy(() =>
  z.object({
    timeRange: z.string().default("30d"),
    limit: boundedLimitQuery("10"),
  }),
);

// Usage query schema
export const usageQuerySchema = z.lazy(() =>
  z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
);

// Export schema types
export type TimeRangeInput = z.infer<typeof timeRangeSchema>;
export type ConfigureAIInput = z.infer<typeof configureAISchema>;
export type TestProviderInput = z.infer<typeof testProviderSchema>;
export type GenerateAnalyticsInput = z.infer<typeof generateAnalyticsSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;
export type UsageQueryInput = z.infer<typeof usageQuerySchema>;
