import { Hono } from "hono";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import type { AuthUser } from "../../../middleware/auth";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../../shared/middleware";
import { forbidden, notFound } from "../../../shared/utils/api-error";
import { ReviewService } from "../services/ReviewService";
import {
  replyToReviewSchema,
  restaurantParamSchema,
  reviewListQuerySchema,
  reviewReplyParamSchema,
  type ReplyToReviewInput,
  type RestaurantParamInput,
  type ReviewListQueryInput,
  type ReviewReplyParamInput,
} from "../schemas/validation";
import type { Env } from "../../../types/env";

/**
 * Owner-facing reviews, mounted at `/api/v1/reviews`.
 *
 * Separate from `/feedback`, which is the platform's own support-ticket queue
 * (#266). Mixing diner reviews into it would put two different audiences and
 * two different retention stories behind one list.
 */
const app = new Hono<{ Bindings: Env }>();

/** Admin (0) and owner (1). No staff role has a reviews surface. */
const REVIEW_ROLES = [0, 1];

/**
 * Tenancy guard, written in the handler rather than mounted as middleware.
 *
 * `requireRestaurantAccess` does the same job, but a test that mocks auth by
 * hand never executes a mounted middleware chain — the guard then looks
 * covered while being absent from every test. Calling it explicitly means the
 * guard is part of the handler under test.
 *
 * Takes `env` and `user` rather than the Context: Hono narrows the context
 * type per route from the validation middleware, so one helper with a
 * `Context` parameter does not typecheck across all three handlers (the same
 * constraint the alerts feature records).
 */
function assertRestaurantScope(
  env: Env,
  user: AuthUser,
  restaurantId: string,
): void {
  // Single-tenant deployments authorise exactly one restaurant, admins
  // included. Mirrors requireRestaurantAccess.
  if (env.DEPLOYMENT_MODE === "independent") {
    if (!env.TENANT_ID || restaurantId !== env.TENANT_ID) {
      throw forbidden("Access denied to this restaurant", "FORBIDDEN");
    }
    return;
  }

  if (user.role === 0) return;

  if (!user.restaurantId || String(user.restaurantId) !== restaurantId) {
    throw forbidden("Access denied to this restaurant", "FORBIDDEN");
  }
}

/**
 * List a restaurant's reviews.
 * GET /api/v1/reviews/:restaurantId
 */
app.get(
  "/:restaurantId",
  authMiddleware,
  requireRole(REVIEW_ROLES),
  validateParams(restaurantParamSchema),
  validateQuery(reviewListQuerySchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams") as RestaurantParamInput;
    assertRestaurantScope(c.env, c.get("user"), restaurantId);

    const query = c.get("validatedQuery") as ReviewListQueryInput;
    const service = new ReviewService(c.env.DB);
    const result = await service.listRestaurantReviews(restaurantId, query);

    return c.json({ success: true, data: result });
  },
);

/**
 * Rating distribution and reply backlog for one restaurant.
 * GET /api/v1/reviews/:restaurantId/summary
 */
app.get(
  "/:restaurantId/summary",
  authMiddleware,
  requireRole(REVIEW_ROLES),
  validateParams(restaurantParamSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams") as RestaurantParamInput;
    assertRestaurantScope(c.env, c.get("user"), restaurantId);

    const service = new ReviewService(c.env.DB);
    const summary = await service.getRestaurantSummary(restaurantId);

    return c.json({ success: true, data: summary });
  },
);

/**
 * Reply to one review.
 * POST /api/v1/reviews/:restaurantId/:reviewId/reply
 */
app.post(
  "/:restaurantId/:reviewId/reply",
  authMiddleware,
  requireRole(REVIEW_ROLES),
  validateParams(reviewReplyParamSchema),
  validateBody(replyToReviewSchema),
  async (c) => {
    const { restaurantId, reviewId } = c.get(
      "validatedParams",
    ) as ReviewReplyParamInput;
    const user = c.get("user");
    assertRestaurantScope(c.env, user, restaurantId);

    const { content } = c.get("validatedBody") as ReplyToReviewInput;
    const service = new ReviewService(c.env.DB);
    const review = await service.replyToReview(
      restaurantId,
      reviewId,
      user.id,
      content,
    );

    // A miss is either "no such review" or "not this restaurant's review".
    // Both answer 404: saying which would confirm an id exists elsewhere.
    if (!review) throw notFound("Review not found", "REVIEW_NOT_FOUND");

    return c.json({ success: true, data: review });
  },
);

export default app;
