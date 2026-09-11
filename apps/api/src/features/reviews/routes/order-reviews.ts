import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { orders } from "@makanmasak/database";
import { optionalCanonicalCustomerAuthMiddleware } from "../../../middleware/auth";
import type { AuthCustomer } from "../../../middleware/auth";
import {
  getGuestBearerToken,
  type GuestTokenData,
} from "../../../middleware/guestAuth";
import { resolveOrderIdentity } from "../../../shared/services/order-identity";
import { validateBody, validateParams } from "../../../shared/middleware";
import {
  forbidden,
  notFound,
  unauthorized,
} from "../../../shared/utils/api-error";
import { ReviewService } from "../services/ReviewService";
import {
  orderReviewParamSchema,
  submitOrderReviewSchema,
  type OrderReviewParamInput,
  type SubmitOrderReviewInput,
} from "../schemas/validation";
import type { ReviewableOrder } from "../types";
import type { Env } from "../../../types/env";

/**
 * The diner-facing half of reviews, mounted under `/api/v1/orders`.
 *
 * `POST /orders/:id/review` is the path `apps/customer-app`'s
 * `orderApi.submitOrderReview` has always posted to; no route answered it
 * until now, so the body shape it sends is accepted verbatim rather than
 * redesigned (see `schemas/validation.ts`).
 */
const app = new Hono<{ Bindings: Env }>();

/**
 * Who may review an order: the customer the order belongs to, or the guest
 * holding that order's KV token. Exactly the two identities the tracking
 * routes accept, resolved through the same `resolveOrderIdentity` so an order
 * number works wherever an id does.
 *
 * Written here rather than as middleware on purpose: the check needs both the
 * resolved order row and the two auth mechanisms at once, and a middleware
 * that only proved *an* identity would leave the ownership comparison to
 * whichever handler remembered to make it.
 */
async function authorizeOrderReviewer(
  c: {
    env: Env;
    req: { header(name: string): string | undefined };
    get(key: "customer"): AuthCustomer | undefined;
  },
  orderIdParam: string,
): Promise<ReviewableOrder> {
  const authorization = c.req.header("Authorization");
  if (!authorization) {
    throw unauthorized(
      "Authentication is required to review an order",
      "MISSING_AUTH_TOKEN",
    );
  }

  const identity = await resolveOrderIdentity(c.env.DB, orderIdParam, {
    requireRestaurantForAliases: false,
  });

  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({
      id: orders.id,
      restaurantId: orders.restaurantId,
      status: orders.status,
      customerId: orders.customerId,
    })
    .from(orders)
    .where(eq(orders.id, identity.id))
    .limit(1);

  if (!row) throw notFound("Order not found", "ORDER_NOT_FOUND");

  const customer = c.get("customer");
  if (customer && row.customerId && row.customerId === customer.id) {
    return row;
  }

  const guestToken = getGuestBearerToken(authorization);
  if (guestToken) {
    const tokenData = (await c.env.CACHE_KV.get(
      `guest_token:${guestToken}`,
      "json",
    )) as GuestTokenData | null;
    if (tokenData?.orderId === row.id) {
      return row;
    }
  }

  // Same wording as guestTokenAuth's own mismatch: possession of a token for a
  // different order is not a weaker form of access to this one.
  throw forbidden("Token does not match this order", "ORDER_ACCESS_DENIED");
}

/**
 * Submit the review for an order.
 * POST /api/v1/orders/:id/review
 */
app.post(
  "/:id/review",
  optionalCanonicalCustomerAuthMiddleware,
  validateParams(orderReviewParamSchema),
  validateBody(submitOrderReviewSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as OrderReviewParamInput;
    const body = c.get("validatedBody") as SubmitOrderReviewInput;

    const order = await authorizeOrderReviewer(c, id);
    const service = new ReviewService(c.env.DB);

    const items = await service.resolveOrderItems(order.id, {
      items: body.items,
      itemRatings: body.itemRatings,
    });

    const review = await service.submitOrderReview(order, {
      rating: body.rating,
      // `content` is this feature's field name; `comment` is what the customer
      // app sends. Neither is required, and `content` wins when both arrive.
      content: body.content ?? body.comment ?? null,
      items,
      customerId: c.get("customer")?.id ?? order.customerId,
    });

    return c.json({ success: true, data: review }, 201);
  },
);

/**
 * Read back the review this diner left, including any owner reply.
 * GET /api/v1/orders/:id/review
 */
app.get(
  "/:id/review",
  optionalCanonicalCustomerAuthMiddleware,
  validateParams(orderReviewParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as OrderReviewParamInput;

    const order = await authorizeOrderReviewer(c, id);
    const service = new ReviewService(c.env.DB);
    const review = await service.getOrderReview(order.id);

    if (!review) {
      throw notFound("This order has not been reviewed", "REVIEW_NOT_FOUND");
    }

    return c.json({ success: true, data: review });
  },
);

export default app;
