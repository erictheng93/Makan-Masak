import { z } from "zod";
import {
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";

/** Owner replies and diner comments share one ceiling. */
export const REVIEW_CONTENT_MAX_LENGTH = 1000;

const ratingSchema = z.lazy(() => z.coerce.number().int().min(1).max(5));

const contentSchema = z.lazy(() =>
  z
    .string()
    .trim()
    .max(REVIEW_CONTENT_MAX_LENGTH)
    .transform((value) => (value.length === 0 ? null : value)),
);

/**
 * Per-item rating in the shape this feature defines.
 *
 * `menuItemId` rather than an order-item id: the aggregate being recomputed
 * hangs off `menu_items.id`, and an order that contains the same dish twice
 * should still produce one rating for that dish.
 */
const itemRatingSchema = z.lazy(() =>
  z.object({
    menuItemId: z.coerce.number().int().positive(),
    rating: ratingSchema,
  }),
);

/**
 * Per-item rating in the shape `apps/customer-app/src/services/orderApi.ts`
 * has always sent (`submitOrderReview`). It predates this endpoint existing at
 * all, so it is accepted rather than broken: `orderItemId` is resolved to its
 * `menuItemId` against the order's own items, and the per-item `comment` is
 * accepted and ignored — only the order-level review carries text.
 */
const legacyItemRatingSchema = z.lazy(() =>
  z.object({
    orderItemId: z.coerce.number().int().positive(),
    rating: ratingSchema,
    comment: z.string().max(REVIEW_CONTENT_MAX_LENGTH).optional(),
  }),
);

export const submitOrderReviewSchema = z.lazy(() =>
  z.object({
    rating: ratingSchema,
    /** Canonical field name. */
    content: contentSchema.nullish(),
    /** Legacy alias sent by the customer app. `content` wins when both appear. */
    comment: contentSchema.nullish(),
    items: z.array(itemRatingSchema).max(50).optional(),
    itemRatings: z.array(legacyItemRatingSchema).max(50).optional(),
  }),
);

export const orderReviewParamSchema = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1),
  }),
);

export const restaurantParamSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().trim().min(1),
  }),
);

/**
 * `commonSchemas.idParam` still requires digits, which no longer matches
 * `restaurants.id` (a TEXT UUID v7). The public list must accept the id the
 * rest of the platform actually hands out.
 */
export const publicRestaurantParamSchema = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1),
  }),
);

export const reviewReplyParamSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().trim().min(1),
    reviewId: z.string().trim().min(1),
  }),
);

export const replyToReviewSchema = z.lazy(() =>
  z.object({
    content: z.string().trim().min(1).max(REVIEW_CONTENT_MAX_LENGTH),
  }),
);

/**
 * `replied` is a tri-state: absent means "either". A bare `?replied` (empty
 * value) is treated as `true`, which is what a checkbox serialised by hand
 * tends to produce.
 */
const repliedFilterSchema = z
  .enum(["true", "false", "1", "0", ""])
  .transform((value) => value !== "false" && value !== "0")
  .optional();

const msTimestampSchema = z.lazy(() =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0))
    .optional(),
);

export const reviewListQuerySchema = z.lazy(() =>
  z.object({
    page: boundedPageQuery(),
    limit: boundedLimitQuery(),
    rating: z
      .string()
      .regex(/^[1-5]$/)
      .transform(Number)
      .optional(),
    replied: repliedFilterSchema,
    from: msTimestampSchema,
    to: msTimestampSchema,
  }),
);

export const publicReviewListQuerySchema = z.lazy(() =>
  z.object({
    page: boundedPageQuery(),
    limit: boundedLimitQuery("10", 50),
  }),
);

export type SubmitOrderReviewInput = z.infer<typeof submitOrderReviewSchema>;
export type OrderReviewParamInput = z.infer<typeof orderReviewParamSchema>;
export type RestaurantParamInput = z.infer<typeof restaurantParamSchema>;
export type PublicRestaurantParamInput = z.infer<
  typeof publicRestaurantParamSchema
>;
export type ReviewReplyParamInput = z.infer<typeof reviewReplyParamSchema>;
export type ReplyToReviewInput = z.infer<typeof replyToReviewSchema>;
export type ReviewListQueryInput = z.infer<typeof reviewListQuerySchema>;
export type PublicReviewListQueryInput = z.infer<
  typeof publicReviewListQuerySchema
>;
