import { describe, expect, it } from "vitest";
import {
  allocateCents,
  currencyStepCents,
  isCurrencyAlignedCents,
  normalizeCurrencyCode,
  roundToCurrencyCents,
} from "./currency";

describe("normalizeCurrencyCode", () => {
  it.each([
    ["TWD", "TWD"],
    [" myr ", "MYR"],
    ["vnd", "VND"],
    ["USD", null],
    ["", null],
    [undefined, null],
    [100, null],
  ])("narrows %p to %p", (input, expected) => {
    expect(normalizeCurrencyCode(input)).toBe(expected);
  });
});

describe("currencyStepCents", () => {
  it("is whole units for TWD and VND, one sen for MYR", () => {
    expect(currencyStepCents("TWD")).toBe(100);
    expect(currencyStepCents("VND")).toBe(100);
    expect(currencyStepCents("MYR")).toBe(1);
  });
});

describe("roundToCurrencyCents", () => {
  it.each([
    // 10% service charge on NT$155 — the case that produced NT$170.50
    [15500 * 0.1, "TWD", 1600],
    [1549, "TWD", 1500],
    [1550, "TWD", 1600],
    [775, "TWD", 800],
    [-1550, "TWD", -1600],
    [-49, "TWD", 0],
    [1550, "MYR", 1550],
    [1550.4, "MYR", 1550],
    [98760, "VND", 98800],
  ] as const)("rounds %p %s to %p", (cents, currency, expected) => {
    expect(roundToCurrencyCents(cents, currency)).toBe(expected);
  });

  it("absorbs float noise from a rate multiplication", () => {
    // 0.1 * 3 * 1000 = 300.00000000000006
    expect(roundToCurrencyCents(0.1 * 3 * 1000 * 5, "TWD")).toBe(1500);
  });

  it("rejects non-finite input", () => {
    expect(() => roundToCurrencyCents(Number.NaN, "TWD")).toThrow();
  });
});

describe("isCurrencyAlignedCents", () => {
  it("requires whole dollars for TWD but accepts sen for MYR", () => {
    expect(isCurrencyAlignedCents(17000, "TWD")).toBe(true);
    expect(isCurrencyAlignedCents(17050, "TWD")).toBe(false);
    expect(isCurrencyAlignedCents(17050, "MYR")).toBe(true);
    expect(isCurrencyAlignedCents(17050.5, "MYR")).toBe(false);
  });
});

describe("allocateCents", () => {
  it("splits NT$100 three ways in whole dollars that sum to the total", () => {
    const shares = allocateCents(10000, [1, 1, 1], "TWD");
    expect(shares).toEqual([3400, 3300, 3300]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it("splits RM100 three ways in sen", () => {
    expect(allocateCents(10000, [1, 1, 1], "MYR")).toEqual([3334, 3333, 3333]);
  });

  it("allocates proportionally to weights", () => {
    // NT$10 voucher across child orders of NT$50 / NT$30 / NT$20
    expect(allocateCents(1000, [5000, 3000, 2000], "TWD")).toEqual([
      500, 300, 200,
    ]);
  });

  it("splits evenly when every weight is zero", () => {
    expect(allocateCents(300, [0, 0, 0], "TWD")).toEqual([100, 100, 100]);
  });

  it("rejects a total that is not on the currency step", () => {
    expect(() => allocateCents(10050, [1, 1], "TWD")).toThrow();
  });

  it("returns an empty list for no weights", () => {
    expect(allocateCents(1000, [], "TWD")).toEqual([]);
  });
});
