/**
 * POS market checkout routes
 */

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import { validateBody, validateParams } from "../../../middleware/validation";
import type { Env } from "../../../types/env";
import { marketCheckoutPosPaymentSchema } from "../schemas";
import { MarketCheckoutPOSPaymentService } from "../services/MarketCheckoutPOSPaymentService";

const app = new Hono<{ Bindings: Env }>();

app.post(
  "/market-checkouts/:checkoutId/pay",
  authMiddleware,
  requireRole([0, 1, 4]),
  validateParams(
    z.lazy(() =>
      z.object({
        checkoutId: z.string().min(1),
      }),
    ),
  ),
  validateBody(marketCheckoutPosPaymentSchema),
  async (c) => {
    const { checkoutId } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const user = c.get("user");

    const result = await new MarketCheckoutPOSPaymentService(c.env).process({
      checkoutId,
      registerId: body.registerId,
      shiftId: body.shiftId,
      paymentMethod: body.paymentMethod,
      country: body.country,
      currency: body.currency,
      operatorId: user.id,
      operatorRole: user.role,
      operatorRestaurantId: user.restaurantId,
      idempotencyKey: c.req.header("Idempotency-Key"),
    });

    return c.json({
      success: true,
      data: result,
    });
  },
);

export default app;
