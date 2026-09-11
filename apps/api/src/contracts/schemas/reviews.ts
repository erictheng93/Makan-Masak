/**
 * Reviews API Response Contracts (#286)
 *
 * The STABLE response shapes for customer reviews. Three audiences read three
 * different projections of the same table, and the difference between them is
 * the contract's main job: the public list must never grow a customer, order,
 * or replier identifier, so it is declared `strict()` rather than `loose()` —
 * a field added there fails the snapshot instead of shipping.
 */

import { z } from "zod";
import { successEnvelope } from "../helpers";

// ---------------------------------------------------------------------------
// Sub-Schemas
// ---------------------------------------------------------------------------

export const ReviewItemRatingSchema = z.object({
  menuItemId: z.number().int(),
  menuItemName: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
});

export const ReviewReplySchema = z.object({
  content: z.string(),
  repliedBy: z.string().nullable(),
  repliedAt: z.number().int().nullable(),
});

/** What the diner who wrote the review reads back. */
export const OrderReviewSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  restaurantId: z.string(),
  rating: z.number().int().min(1).max(5),
  content: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  reply: ReviewReplySchema.nullable(),
  items: z.array(ReviewItemRatingSchema),
});

/** One row of the owner list. Adds the identity an owner is entitled to. */
export const OwnerReviewSchema = OrderReviewSchema.extend({
  orderNumber: z.string().nullable(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
});

/** One row of the public list. No customer, order, or replier identifier. */
export const PublicReviewSchema = z
  .object({
    id: z.string(),
    rating: z.number().int().min(1).max(5),
    content: z.string().nullable(),
    createdAt: z.number().int(),
    authorName: z.string().nullable(),
    reply: z
      .object({ content: z.string(), repliedAt: z.number().int().nullable() })
      .strict()
      .nullable(),
  })
  .strict();

export const ReviewPaginationSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

// ---------------------------------------------------------------------------
// Response Contracts
// ---------------------------------------------------------------------------

/** POST /api/v1/orders/:id/review (201) and GET /api/v1/orders/:id/review */
export const SubmitOrderReviewResponse = successEnvelope(OrderReviewSchema);
export const GetOrderReviewResponse = successEnvelope(OrderReviewSchema);

/** GET /api/v1/reviews/:restaurantId */
export const ListRestaurantReviewsResponse = successEnvelope(
  z.object({
    reviews: z.array(OwnerReviewSchema),
    pagination: ReviewPaginationSchema,
  }),
);

/** GET /api/v1/reviews/:restaurantId/summary */
export const RestaurantReviewSummaryResponse = successEnvelope(
  z.object({
    average: z.number(),
    count: z.number().int(),
    distribution: z.object({
      "1": z.number().int(),
      "2": z.number().int(),
      "3": z.number().int(),
      "4": z.number().int(),
      "5": z.number().int(),
    }),
    unrepliedCount: z.number().int(),
  }),
);

/** POST /api/v1/reviews/:restaurantId/:reviewId/reply */
export const ReplyToReviewResponse = successEnvelope(OwnerReviewSchema);

/** GET /api/v1/restaurants/:id/reviews */
export const ListPublicReviewsResponse = successEnvelope(
  z.object({
    reviews: z.array(PublicReviewSchema),
    pagination: ReviewPaginationSchema,
  }),
);
