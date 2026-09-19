import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error";
import {
  assertCurrencyAlignedCents,
  isAlignedInEveryCurrency,
  computeDiscountCents,
  floorToCurrencyCents,
  percentOfCents,
} from "./money-rounding";

describe("floorToCurrencyCents", () => {
  it("truncates toward zero on the currency step", () => {
    expect(floorToCurrencyCents(1250, "TWD")).toBe(1200);
    expect(floorToCurrencyCents(1299, "VND")).toBe(1200);
    expect(floorToCurrencyCents(-1250, "TWD")).toBe(-1200);
    expect(floorToCurrencyCents(-50, "TWD")).toBe(0);
    expect(floorToCurrencyCents(1250, "MYR")).toBe(1250);
  });

  it("rejects non-finite input", () => {
    expect(() => floorToCurrencyCents(Number.NaN, "TWD")).toThrow(
      "Money amount must be finite",
    );
  });
});

describe("percentOfCents", () => {
  it.each([
    [15500, 10, "TWD", 1600], // NT$15.50 → NT$16
    [35500, 5, "TWD", 1800], // NT$17.75 → NT$18
    [15500, 15, "TWD", 2300], // NT$23.25 → NT$23
    [1234500, 8, "VND", 98800], // 987.6 → 988
    [15500, 10, "MYR", 1550], // RM15.50 stays
    [2350, 10, "MYR", 235],
  ] as const)("%p x %p%% in %s = %p", (base, pct, currency, expected) => {
    expect(percentOfCents(base, pct, currency)).toBe(expected);
  });
});

describe("computeDiscountCents", () => {
  it("rounds a percentage discount to whole TWD", () => {
    expect(
      computeDiscountCents(
        { discountType: "percentage", percent: 15 },
        15500,
        "TWD",
      ),
    ).toBe(2300);
  });

  it("keeps sen for MYR", () => {
    expect(
      computeDiscountCents(
        { discountType: "percentage", percent: 10 },
        2350,
        "MYR",
      ),
    ).toBe(235);
  });

  it("rounds first, then caps", () => {
    // 15% of NT$155 = NT$23.25 → NT$23, capped at NT$20.
    expect(
      computeDiscountCents(
        { discountType: "percentage", percent: 15, maxDiscountCents: 2000 },
        15500,
        "TWD",
      ),
    ).toBe(2000);
  });

  it("floors a legacy unaligned cap so the discount stays aligned", () => {
    expect(
      computeDiscountCents(
        { discountType: "percentage", percent: 50, maxDiscountCents: 1250 },
        15500,
        "TWD",
      ),
    ).toBe(1200);
  });

  it("treats a null cap as uncapped and zero as a real ceiling", () => {
    expect(
      computeDiscountCents(
        { discountType: "percentage", percent: 50, maxDiscountCents: null },
        10000,
        "TWD",
      ),
    ).toBe(5000);
    expect(
      computeDiscountCents(
        { discountType: "percentage", percent: 50, maxDiscountCents: 0 },
        10000,
        "TWD",
      ),
    ).toBe(0);
  });

  it("floors a legacy fractional fixed amount", () => {
    expect(
      computeDiscountCents(
        { discountType: "fixed", fixedCents: 1250 },
        15500,
        "TWD",
      ),
    ).toBe(1200);
    expect(computeDiscountCents({ discountType: "fixed" }, 15500, "TWD")).toBe(
      0,
    );
  });

  it("never exceeds the (floored) base", () => {
    expect(
      computeDiscountCents(
        { discountType: "fixed", fixedCents: 50000 },
        1250,
        "TWD",
      ),
    ).toBe(1200);
    expect(
      computeDiscountCents(
        { discountType: "percentage", percent: 10 },
        -500,
        "TWD",
      ),
    ).toBe(0);
  });
});

describe("assertCurrencyAlignedCents", () => {
  it("accepts aligned and absent amounts", () => {
    expect(() =>
      assertCurrencyAlignedCents("TWD", [
        { field: "price", cents: 1200 },
        { field: "originalPrice", cents: null },
        { field: "costPrice", cents: undefined },
      ]),
    ).not.toThrow();
    expect(() =>
      assertCurrencyAlignedCents("MYR", [{ field: "price", cents: 1250 }]),
    ).not.toThrow();
  });

  it("rejects fractional TWD with a CURRENCY_PRECISION 400 naming each field", () => {
    let caught: unknown;
    try {
      assertCurrencyAlignedCents("TWD", [
        { field: "price", cents: 1250 },
        { field: "originalPrice", cents: 1500 },
        { field: "options.addOns[0].price", cents: 1005 },
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe("CURRENCY_PRECISION");
    expect(apiError.details).toEqual({
      currency: "TWD",
      stepCents: 100,
      fields: [
        { field: "price", amount: 12.5 },
        { field: "options.addOns[0].price", amount: 10.05 },
      ],
    });
  });
});

describe("isAlignedInEveryCurrency", () => {
  it("is true only when every present amount is a whole major unit", () => {
    expect(
      isAlignedInEveryCurrency([
        { field: "a", cents: 1200 },
        { field: "b", cents: null },
      ]),
    ).toBe(true);
    expect(isAlignedInEveryCurrency([{ field: "a", cents: 1250 }])).toBe(false);
    expect(isAlignedInEveryCurrency([{ field: "a", cents: 12.5 }])).toBe(false);
  });
});
