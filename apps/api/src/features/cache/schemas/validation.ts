/**
 * Cache Feature Validation Schemas
 * Zod schemas for cache feature request validation
 */

import { z } from "zod";

export const invalidateTagsSchema = z.lazy(() =>
  z.object({
    tags: z.array(z.string()).min(1).max(10),
    reason: z.string().max(200).optional(),
  }),
);

export const warmupSchema = z.lazy(() =>
  z.object({
    keys: z
      .array(
        z.object({
          key: z.string(),
          strategy: z.enum([
            "MENU",
            "RESTAURANT",
            "ANALYTICS",
            "SESSION",
            "TABLE",
            "QR_CODE",
          ]),
        }),
      )
      .min(1)
      .max(50),
  }),
);

export const cleanupSchema = z.lazy(() =>
  z.object({
    maxAge: z.number().int().positive().max(86400).optional().default(3600), // 1小時默認
    dryRun: z.boolean().optional().default(false),
  }),
);

export type InvalidateTagsRequest = z.infer<typeof invalidateTagsSchema>;
export type WarmupRequest = z.infer<typeof warmupSchema>;
export type CleanupRequest = z.infer<typeof cleanupSchema>;
