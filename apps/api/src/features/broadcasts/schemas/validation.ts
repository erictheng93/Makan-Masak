/**
 * Request validation for marketing broadcasts (#335).
 */

import { z } from "zod";
import {
  MARKETING_BROADCAST_BODY_MAX_LENGTH,
  MARKETING_BROADCAST_TITLE_MAX_LENGTH,
} from "@makanmasak/shared-types";

/**
 * The click target carried in the push payload.
 *
 * Absolute `https://` or site-relative `/...` only. The service worker hands
 * this to `clients.openWindow`, so accepting an arbitrary scheme here would
 * let a shop owner ship `javascript:` or a custom-scheme deep link to every
 * one of its followers.
 */
const broadcastUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => value.startsWith("https://") || value.startsWith("/"), {
    message: "url must be an absolute https URL or a site-relative path",
  });

export const sendBroadcastSchema = z.object({
  title: z.string().trim().min(1).max(MARKETING_BROADCAST_TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(MARKETING_BROADCAST_BODY_MAX_LENGTH),
  url: broadcastUrlSchema.optional(),
  /**
   * Restaurant scope only. Reaches customers who follow the market this
   * restaurant trades in but not the restaurant itself — and only those of
   * them who turned `followedOnly` off. Ignored by the market route.
   */
  includeMarketFollowers: z.boolean().default(false),
});

export type SendBroadcastInput = z.infer<typeof sendBroadcastSchema>;

export const broadcastScopeParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

export type BroadcastScopeParamInput = z.infer<
  typeof broadcastScopeParamSchema
>;

export const broadcastHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type BroadcastHistoryQueryInput = z.infer<
  typeof broadcastHistoryQuerySchema
>;
