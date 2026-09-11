import { api, unwrapApiPayload } from "@/services/api";

/**
 * Owner-facing customer reviews (#286), mounted server-side at
 * `/api/v1/reviews`.
 *
 * Deliberately not `/feedback`: that is the platform's own support-ticket
 * queue, and #266 records the two being confused. They share no route, no
 * service and no page.
 */

export interface ReviewItemRating {
  menuItemId: number;
  menuItemName: string | null;
  rating: number;
}

export interface ReviewReply {
  content: string;
  repliedBy: string | null;
  repliedAt: number | null;
}

/** One row of the owner list. Timestamps are Unix milliseconds. */
export interface OwnerReview {
  id: string;
  orderId: string;
  orderNumber: string | null;
  restaurantId: string;
  customerId: string | null;
  customerName: string | null;
  rating: number;
  content: string | null;
  createdAt: number;
  updatedAt: number;
  reply: ReviewReply | null;
  items: ReviewItemRating[];
}

export interface ReviewPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ReviewListResult {
  reviews: OwnerReview[];
  pagination: ReviewPagination;
}

export type ReviewRating = 1 | 2 | 3 | 4 | 5;

export type ReviewDistribution = Record<`${ReviewRating}`, number>;

export interface ReviewSummary {
  /** Mean rating to 2dp, 0 when there are no reviews. */
  average: number;
  count: number;
  distribution: ReviewDistribution;
  unrepliedCount: number;
}

export interface ReviewListParams {
  page?: number;
  /** Server ceiling is 100. */
  limit?: number;
  rating?: ReviewRating;
  replied?: boolean;
  /** Unix milliseconds, inclusive. */
  from?: number;
  /** Unix milliseconds, inclusive. */
  to?: number;
}

type QueryValue = string | number;

/**
 * Drop every unset filter rather than sending it as `undefined`.
 *
 * The server's query schema validates `rating` as `/^[1-5]$/` and `from`/`to`
 * as `/^\d+$/`, so an empty value is a 400 rather than "no filter". `replied`
 * is stringified because its enum reads a bare `?replied` as `true` — only the
 * literal "false" selects unreplied.
 */
function toQuery(params: ReviewListParams): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {};

  if (params.page !== undefined) query.page = params.page;
  if (params.limit !== undefined) query.limit = params.limit;
  if (params.rating !== undefined) query.rating = params.rating;
  if (params.replied !== undefined) query.replied = String(params.replied);
  if (params.from !== undefined) query.from = params.from;
  if (params.to !== undefined) query.to = params.to;

  return query;
}

function reviewsPath(restaurantId: string): string {
  return `/reviews/${encodeURIComponent(restaurantId)}`;
}

export const reviewsService = {
  /** GET /api/v1/reviews/:restaurantId/summary */
  async getSummary(restaurantId: string): Promise<ReviewSummary> {
    const response = await api.get<ReviewSummary>(
      `${reviewsPath(restaurantId)}/summary`,
    );
    return unwrapApiPayload<ReviewSummary>(response.data);
  },

  /** GET /api/v1/reviews/:restaurantId — newest first. */
  async list(
    restaurantId: string,
    params: ReviewListParams = {},
  ): Promise<ReviewListResult> {
    const response = await api.get<ReviewListResult>(
      reviewsPath(restaurantId),
      toQuery(params),
    );
    return unwrapApiPayload<ReviewListResult>(response.data);
  },

  /**
   * POST /api/v1/reviews/:restaurantId/:reviewId/reply
   *
   * Returns the whole updated row, so the caller can swap one card's state
   * without re-reading the list.
   */
  async reply(
    restaurantId: string,
    reviewId: string,
    content: string,
  ): Promise<OwnerReview> {
    const response = await api.post<OwnerReview>(
      `${reviewsPath(restaurantId)}/${encodeURIComponent(reviewId)}/reply`,
      { content },
    );
    return unwrapApiPayload<OwnerReview>(response.data);
  },
};
