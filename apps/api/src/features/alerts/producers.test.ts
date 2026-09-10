import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  alertIfBelowMinimum,
  OWNER_ALERTED_PAYMENT_FAILURE_CODES,
  raiseLowStockAlert,
  raiseOverdueOrderAlert,
  raisePaymentFailedAlert,
} from "./producers";
import type { Env } from "../../types/env";

const mocks = vi.hoisted(() => ({ raise: vi.fn() }));

vi.mock("@makanmasak/database", () => ({
  RESTAURANT_ALERT_SEVERITY: {
    CRITICAL: "critical",
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
  },
  RestaurantAlertService: vi.fn(function RestaurantAlertService() {
    return { raise: mocks.raise };
  }),
}));

const env = { DB: {} } as unknown as Env;

function ingredient(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: "椰漿",
    unit: "L",
    currentStock: 2,
    minStockLevel: 5,
    ...overrides,
  };
}

describe("alertIfBelowMinimum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.raise.mockResolvedValue(undefined);
  });

  it("raises when stock has fallen under the minimum", async () => {
    await alertIfBelowMinimum(env, "restaurant-1", ingredient());

    expect(mocks.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        alertType: "inventory_low",
        severity: "high",
        dedupeKey: "inventory:7",
      }),
    );
  });

  // Equal is under: "minimum" is the level you must not drop to.
  it("raises when stock has landed exactly on the minimum", async () => {
    await alertIfBelowMinimum(
      env,
      "restaurant-1",
      ingredient({ currentStock: 5, minStockLevel: 5 }),
    );

    expect(mocks.raise).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while stock is above the minimum", async () => {
    await alertIfBelowMinimum(
      env,
      "restaurant-1",
      ingredient({ currentStock: 6, minStockLevel: 5 }),
    );

    expect(mocks.raise).not.toHaveBeenCalled();
  });

  // Untracked ingredients have no line to be under. Alerting on them would
  // fire for every ingredient a restaurant has ever created.
  it.each([
    ["no minimum set", { minStockLevel: null }],
    ["stock not tracked", { currentStock: null }],
  ])("stays quiet when there is %s", async (_label, overrides) => {
    await alertIfBelowMinimum(env, "restaurant-1", ingredient(overrides));

    expect(mocks.raise).not.toHaveBeenCalled();
  });

  it("stays quiet when the ingredient is missing", async () => {
    await alertIfBelowMinimum(env, "restaurant-1", null);

    expect(mocks.raise).not.toHaveBeenCalled();
  });
});

describe("raiseLowStockAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.raise.mockResolvedValue(undefined);
  });

  it("escalates to critical once stock reaches zero", async () => {
    await raiseLowStockAlert(env, {
      restaurantId: "restaurant-1",
      ingredientId: 7,
      name: "椰漿",
      currentStock: 0,
      minStockLevel: 5,
      unit: "L",
    });

    expect(mocks.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        alertType: "inventory_depleted",
        severity: "critical",
      }),
    );
  });
});

describe("raiseOverdueOrderAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.raise.mockResolvedValue(undefined);
  });

  it("keys on the order so a repeating sweep collapses onto one alert", async () => {
    await raiseOverdueOrderAlert(env, {
      restaurantId: "restaurant-1",
      orderId: "order-1",
      orderNumber: "A-001",
      minutesLate: 35,
      status: "preparing",
    });

    expect(mocks.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        alertType: "order_overdue",
        dedupeKey: "order-overdue:order-1",
      }),
    );
  });
});

describe("raisePaymentFailedAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.raise.mockResolvedValue(undefined);
  });

  function paymentFailure(overrides: Record<string, unknown> = {}) {
    return {
      restaurantId: "restaurant-1",
      orderId: "order-101",
      orderNumber: "A-001",
      errorCode: "PAYMENT_AMOUNT_MISMATCH",
      paymentMode: "full",
      submittedAmount: 119,
      serverTotal: 120,
      currency: "TWD",
      ...overrides,
    };
  }

  // A refused amount is a discrepancy to look at; a payment that blew up
  // mid-batch may have left the order reading paid with no ledger row.
  it("raises the amount mismatches as high", async () => {
    await raisePaymentFailedAlert(env, paymentFailure());

    expect(mocks.raise).toHaveBeenCalledTimes(1);
    expect(mocks.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        alertType: "payment_failed",
        severity: "high",
        details: expect.objectContaining({
          orderId: "order-101",
          orderNumber: "A-001",
          errorCode: "PAYMENT_AMOUNT_MISMATCH",
          submittedAmount: 119,
          serverTotal: 120,
          currency: "TWD",
          paymentMode: "full",
        }),
      }),
    );
  });

  it("escalates a ledger-drift failure to critical", async () => {
    await raisePaymentFailedAlert(
      env,
      paymentFailure({ errorCode: "UNEXPECTED_ERROR" }),
    );

    expect(mocks.raise).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "critical" }),
    );
  });

  // Repeated taps on one order are one problem, not one alert each.
  it("keys on the order so retries collapse onto one alert", async () => {
    await raisePaymentFailedAlert(env, paymentFailure());

    expect(mocks.raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "payment-failed:order-101" }),
    );
  });

  // The presenter drops non-scalars, so a null would only travel to be
  // ignored — and a message interpolating it would show a hole.
  it("omits amounts the attempt never supplied", async () => {
    await raisePaymentFailedAlert(
      env,
      paymentFailure({
        submittedAmount: undefined,
        serverTotal: undefined,
        currency: undefined,
      }),
    );

    const [input] = mocks.raise.mock.calls[0] as [
      { details: Record<string, unknown> },
    ];
    expect(Object.keys(input.details).sort()).toEqual([
      "errorCode",
      "orderId",
      "orderNumber",
      "paymentMode",
    ]);
  });

  // The set is the tuning knob for "which failures bother the owner" (#350):
  // a caller mistake stays in the audit log, money problems reach the panel.
  it("lists only the failures that describe the restaurant's money", () => {
    expect([...OWNER_ALERTED_PAYMENT_FAILURE_CODES].sort()).toEqual([
      "PARTIAL_PAYMENT_TOTAL_MISMATCH",
      "PAYMENT_AMOUNT_MISMATCH",
      "PAYMENT_TOTAL_MISMATCH",
      "UNEXPECTED_ERROR",
    ]);
    for (const quiet of [
      "ORDER_NOT_PAYABLE",
      "IDEMPOTENCY_ORDER_MISMATCH",
      "FORBIDDEN",
      "INSUFFICIENT_ROLE",
      "ORDER_NOT_FOUND",
    ]) {
      expect(OWNER_ALERTED_PAYMENT_FAILURE_CODES.has(quiet)).toBe(false);
    }
  });
});

describe("producer failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The stock movement already committed. Failing the owner's write to report
  // a warning about it would be the worse outcome.
  it("does not fail the caller when the alert insert throws", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.raise.mockRejectedValue(new Error("D1_ERROR: no such table"));

    await expect(
      alertIfBelowMinimum(env, "restaurant-1", ingredient()),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      "alerts.producer.failed",
      expect.objectContaining({ alertType: "inventory_low" }),
    );
    consoleError.mockRestore();
  });
});
