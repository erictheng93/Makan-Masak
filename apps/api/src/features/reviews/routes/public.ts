import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { restaurants } from "@makanmasak/database";
import { validateParams, validateQuery } from "../../../shared/middleware";
import { notFound } from "../../../shared/utils/api-error";
import { ReviewService } from "../services/ReviewService";
import {
  publicRestaurantParamSchema,
  publicReviewListQuerySchema,
  type PublicRestaurantParamInput,
  type PublicReviewListQueryInput,
} from "../schemas/validation";
import type { Env } from "../../../types/env";

/**
 * The restaurant page's public review list, mounted at `/api/v1/restaurants`.
 *
 * Anyone may read it, so the projection carries no customer id, no order id
 * and no replier id — only a masked display name. See
 * `ReviewService.listPublicReviews`.
 */
const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/v1/restaurants/:id/reviews
 */
app.get(
  "/:id/reviews",
  validateParams(publicRestaurantParamSchema),
  validateQuery(publicReviewListQuerySchema),
  async (c) => {
    const { id: restaurantId } = c.get(
      "validatedParams",
    ) as PublicRestaurantParamInput;
    const { page, limit } = c.get(
      "validatedQuery",
    ) as PublicReviewListQueryInput;

    // An unknown restaurant answers 404 rather than an empty page: an id that
    // returns 200 for anything is indistinguishable from a typo.
    const db = drizzle(c.env.DB);
    const [restaurant] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);
    if (!restaurant) {
      throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
    }

    const service = new ReviewService(c.env.DB);
    const result = await service.listPublicReviews(restaurantId, page, limit);

    return c.json({ success: true, data: result });
  },
);

export default app;
