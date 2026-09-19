import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";

const auth = vi.hoisted(() => ({
  user: {
    id: "user-42",
    username: "cashier",
    role: 4,
    restaurantId: "rest-1",
  } as AuthUser,
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: Context, next: Next) => {
    c.set("user", auth.user);
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

const service = vi.hoisted(() => ({
  process: vi.fn(),
}));

vi.mock("../services/MarketCheckoutPOSPaymentService", () => ({
  MarketCheckoutPOSPaymentService: class {
    process = service.process;
  },
}));

import app from "./market-checkouts";
import { ApiError } from "../../../shared/utils/api-error";

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

const env = { DB: {} } as never;

function postPayment(
  checkoutId: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(
    `/market-checkouts/${checkoutId}/pay`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    },
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = {
    id: "user-42",
    username: "cashier",
    role: 4,
    restaurantId: "rest-1",
  };
  service.process.mockResolvedValue({
    checkoutId: "checkout-1",
    status: "paid",
  });
});

describe("POS market checkout routes", () => {
  it("processes a market checkout payment with operator metadata", async () => {
    const response = await postPayment(
      "checkout-1",
      {
        registerId: "11111111-1111-4111-8111-111111111111",
        paymentMethod: "card",
      },
      { "Idempotency-Key": "pay-once" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { checkoutId: "checkout-1", status: "paid" },
    });
    expect(service.process).toHaveBeenCalledWith({
      checkoutId: "checkout-1",
      registerId: "11111111-1111-4111-8111-111111111111",
      shiftId: undefined,
      paymentMethod: "card",
      country: undefined,
      currency: undefined,
      operatorId: "user-42",
      operatorRole: 4,
      operatorRestaurantId: "rest-1",
      idempotencyKey: "pay-once",
    });
  });

  it("rejects invalid payment bodies before calling the service", async () => {
    const response = await postPayment("checkout-1", {
      registerId: "not-a-uuid",
    });

    expect(response.status).toBe(400);
    expect(service.process).not.toHaveBeenCalled();
  });
});
