/**
 * System Validation Schemas
 * Zod schemas for input validation in the system feature
 */

import { z } from "zod";

// Error report validation schema
export const errorReportSchema = z.lazy(() =>
  z.object({
    errors: z
      .array(
        z.object({
          type: z.enum([
            "network",
            "api",
            "sse",
            "validation",
            "permission",
            "unknown",
          ]),
          severity: z.enum(["low", "medium", "high", "critical"]),
          code: z.union([z.string(), z.number()]).optional(),
          message: z.string().min(1, "Error message is required"),
          originalError: z.any().optional(),
          context: z.record(z.string(), z.any()).optional(),
          timestamp: z.iso.datetime("Invalid timestamp format"),
          userAgent: z.string().optional(),
          url: z.url("Invalid URL format").optional().or(z.literal("")),
          userId: z.union([z.number(), z.string()]).optional(),
          restaurantId: z.union([z.number(), z.string()]).optional(),
        }),
      )
      .min(1, "At least one error is required"),
  }),
);

// Restaurant ID format: S-YYYYMMDD-NNN (e.g., S-20250124-001)
const restaurantIdString = z
  .string()
  .regex(/^S-\d{8}-\d{3}$/, "Restaurant ID must be in S-YYYYMMDD-NNN format");

// Error stats query parameters
export const errorStatsQuerySchema = z.lazy(() =>
  z.object({
    restaurantId: restaurantIdString.optional(),
    days: z.coerce.number().min(1).max(90).default(7),
  }),
);

// Cleanup query parameters
export const cleanupQuerySchema = z.lazy(() =>
  z.object({
    daysOld: z.coerce.number().min(1).max(365).default(30),
  }),
);

// Health check response schema (for validation)
export const healthCheckResponseSchema = z.lazy(() =>
  z.object({
    success: z.boolean(),
    status: z.enum(["healthy", "unhealthy", "degraded"]),
    timestamp: z.string(),
    checks: z.object({
      database: z.object({
        status: z.enum(["healthy", "unhealthy"]),
        latency: z.string(),
      }),
      cache: z.object({
        status: z.enum(["healthy", "unhealthy"]),
        latency: z.string(),
      }),
      memory: z.object({
        status: z.string(),
        usage: z.string(),
      }),
    }),
    version: z.string(),
    uptime: z.string(),
  }),
);

// Export type inference for TypeScript
export type ErrorReportInput = z.infer<typeof errorReportSchema>;
export type ErrorStatsQuery = z.infer<typeof errorStatsQuerySchema>;
export type CleanupQuery = z.infer<typeof cleanupQuerySchema>;
export type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>;
