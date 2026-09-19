import { describe, expect, it } from "vitest";
import {
  cashMovementSchema,
  marketCheckoutPosPaymentSchema,
  printReceiptSchema,
  queryPaginationSchema,
  registerQuerySchema,
  startShiftSchema,
} from "./validation";

const registerId = "018ffb9a-7b8a-7c3d-9f23-123456789abc";

describe("POS validation schemas", () => {
  it("validates shift starts and cash movements", () => {
    expect(
      startShiftSchema.parse({
        registerId,
        operatorId: "1",
        startAmount: 1000,
      }),
    ).toMatchObject({ registerId, operatorId: "1" });

    expect(
      cashMovementSchema.parse({
        type: "deposit",
        amount: -50,
        description: "Bank drop",
      }),
    ).toMatchObject({ type: "deposit", amount: -50 });

    expect(() =>
      cashMovementSchema.parse({
        type: "deposit",
        amount: 19.995,
        description: "Bank drop",
      }),
    ).toThrow();
  });

  it("applies receipt and market checkout payment defaults", () => {
    expect(printReceiptSchema.parse({ orderId: "10" })).toEqual({
      orderId: "10",
      templateName: "standard",
      receiptType: "customer",
      copies: 1,
    });

    // No currency default: the checkout's vendors decide it server-side.
    expect(marketCheckoutPosPaymentSchema.parse({ registerId })).toEqual({
      registerId,
      paymentMethod: "cash",
    });
  });

  it("transforms pagination query params", () => {
    expect(queryPaginationSchema.parse({ page: "3", limit: "40" })).toEqual({
      page: 3,
      limit: 40,
    });
    expect(registerQuerySchema.parse({ restaurantId: "restaurant-1" })).toEqual(
      {
        restaurantId: "restaurant-1",
        page: 1,
        limit: 20,
      },
    );

    expect(() =>
      printReceiptSchema.parse({ orderId: "10", copies: 6 }),
    ).toThrow();
  });
});
