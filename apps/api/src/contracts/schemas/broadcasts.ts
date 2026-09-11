/**
 * Marketing Broadcast API Response Contracts (#335)
 *
 * Two audiences, two shapes. The send response is the counts a shop owner
 * needs to see immediately; the history rows are the same counts, durable.
 * Both are declared `strict()` so a field added to the audit projection — a
 * recipient id, a customer name — fails the snapshot instead of shipping.
 */

import { z } from "zod";
import { successEnvelope } from "../helpers";

// ---------------------------------------------------------------------------
// Sub-Schemas
// ---------------------------------------------------------------------------

export const BroadcastScopeSchema = z.enum(["market", "restaurant"]);

/** One row of the send history. */
export const BroadcastHistoryItemSchema = z
  .object({
    id: z.string(),
    scopeType: BroadcastScopeSchema,
    scopeId: z.string(),
    title: z.string(),
    body: z.string(),
    url: z.string().nullable(),
    sentBy: z.string().nullable(),
    audienceCount: z.number().int(),
    deliveredCount: z.number().int(),
    failedCount: z.number().int(),
    skippedCount: z.number().int(),
    createdAt: z.number().int(),
    completedAt: z.number().int().nullable(),
  })
  .strict();

export const BroadcastPaginationSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

// ---------------------------------------------------------------------------
// Response Contracts
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/restaurants/:id/broadcasts (201)
 * POST /api/v1/markets/:id/broadcasts (201)
 *
 * `audienceCount` counts people; the other three count delivery attempts and
 * sum to the number of recipient rows, which is why they do not add up to the
 * audience when somebody has three phones.
 */
export const SendBroadcastResponse = successEnvelope(
  z
    .object({
      id: z.string(),
      audienceCount: z.number().int(),
      deliveredCount: z.number().int(),
      failedCount: z.number().int(),
      skippedCount: z.number().int(),
    })
    .strict(),
);

/**
 * GET /api/v1/restaurants/:id/broadcasts
 * GET /api/v1/markets/:id/broadcasts
 */
export const ListBroadcastsResponse = successEnvelope(
  z.object({
    broadcasts: z.array(BroadcastHistoryItemSchema),
    pagination: BroadcastPaginationSchema,
  }),
);
