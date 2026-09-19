import { describe, expect, it } from "vitest";
import {
  computeOrderTotals,
  recoverChargeRate,
  resolveRestaurantCurrency,
} from "./order-totals";

describe("resolveRestaurantCurrency", () => {
  it.each([
    ["MYR", "MYR"],
    ["vnd", "VND"],
    ["USD", "TWD"],
    [undefined, "TWD"],
    [42, "TWD"],
  ])("resolves %p to %p", (input, expected) => {
    expect(resolveRestaurantCurrency(input)).toBe(expected);
  });
});

describe("computeOrderTotals", () => {
  it("rounds a TWD service charge to whole dollars: NT$155 + 10% = NT$171", () => {
    const totals = computeOrderTotals({
      currency: "TWD",
      subtotalCents: 15500,
      serviceChargeRate: 0.1,
    });
    expect(totals).toMatchObject({
      serviceChargeCents: 1600,
      totalAmountCents: 17100,
      serviceCharge: 16,
      totalAmount: 171,
    });
  });

  it("rounds TWD tax: 5% on NT$355 = NT$18, total NT$373", () => {
    const totals = computeOrderTotals({
      currency: "TWD",
      subtotalCents: 35500,
      taxRate: 0.05,
    });
    expect(totals.taxAmountCents).toBe(1800);
    expect(totals.totalAmountCents).toBe(37300);
  });

  it("rounds VND tax: 8% on 12,345 = 988", () => {
    const totals = computeOrderTotals({
      currency: "VND",
      subtotalCents: 1234500,
      taxRate: 0.08,
    });
    expect(totals.taxAmountCents).toBe(98800);
    expect(totals.totalAmountCents).toBe(1333300);
  });

  it("keeps sen for MYR: RM155 + 10% = RM15.50", () => {
    const totals = computeOrderTotals({
      currency: "MYR",
      subtotalCents: 15500,
      serviceChargeRate: 0.1,
    });
    expect(totals.serviceChargeCents).toBe(1550);
    expect(totals.totalAmountCents).toBe(17050);
  });

  it("keeps already-charged amounts instead of re-deriving them", () => {
    const totals = computeOrderTotals({
      currency: "TWD",
      subtotalCents: 15500,
      taxRate: 0.5,
      taxAmountCents: 800,
      serviceChargeRate: 0.5,
      serviceChargeCents: 1600,
      discountCents: 2300,
      deliveryFeeCents: 5000,
    });
    expect(totals).toMatchObject({
      taxAmountCents: 800,
      serviceChargeCents: 1600,
      discountAmountCents: 2300,
      deliveryFeeCents: 5000,
      totalAmountCents: 15500 + 800 + 1600 + 5000 - 2300,
    });
  });

  it("floors legacy fractional configured amounts (discount, delivery fee)", () => {
    const totals = computeOrderTotals({
      currency: "TWD",
      subtotalCents: 10000,
      discountCents: 1250,
      deliveryFeeCents: 3050,
    });
    expect(totals.discountAmountCents).toBe(1200);
    expect(totals.deliveryFeeCents).toBe(3000);
    expect(totals.totalAmountCents).toBe(11800);
  });

  it("keeps a legacy fractional TWD subtotal but rounds the grand total", () => {
    // A menu item priced NT$12.50 before precision was enforced.
    const totals = computeOrderTotals({
      currency: "TWD",
      subtotalCents: 1250,
      taxRate: 0.05,
    });
    expect(totals.subtotalCents).toBe(1250);
    expect(totals.taxAmountCents).toBe(100); // NT$0.625 → NT$1
    expect(totals.totalAmountCents).toBe(1400); // NT$13.50 → NT$14
  });
});

describe("recoverChargeRate", () => {
  it("is zero for an empty subtotal", () => {
    expect(recoverChargeRate(0.1, 0, 0, "TWD")).toBe(0);
  });

  it("prefers the configured rate when it reproduces the rounded amount", () => {
    // 5% of NT$10 is stored as NT$1; the ratio alone would read 10%.
    expect(recoverChargeRate(0.05, 1000, 100, "TWD")).toBe(0.05);
  });

  it("prefers the configured rate for an order stored before rounding", () => {
    expect(recoverChargeRate(0.1, 15500, 1550, "TWD")).toBe(0.1);
  });

  it("falls back to the stored ratio when the rate changed since", () => {
    expect(recoverChargeRate(0.2, 10000, 1000, "TWD")).toBe(0.1);
    expect(recoverChargeRate(undefined, 10000, 500, "TWD")).toBe(0.05);
    expect(recoverChargeRate(Number.NaN, 10000, 0, "TWD")).toBe(0);
  });
});
