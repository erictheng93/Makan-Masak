import { describe, it, expect } from "vitest";
import {
  cashRoundedCents,
  cashRoundingAdjustmentCents,
  cashStepCents,
  collectableAmount,
  settlesInPhysicalCash,
} from "./cash-rounding";

describe("settlesInPhysicalCash", () => {
  it("treats only cash as physically tendered", () => {
    expect(settlesInPhysicalCash("cash")).toBe(true);
  });

  it("treats every electronic method as exact", () => {
    for (const method of [
      "card",
      "credit_card",
      "debit_card",
      "digital_wallet",
      "ewallet",
      "touch_n_go",
      "grab_pay",
      "fpx",
      "bank_transfer",
      "online",
      "credits",
      "split",
      "other",
    ]) {
      expect(settlesInPhysicalCash(method)).toBe(false);
    }
  });

  it("tolerates the casing and padding a stored column can carry", () => {
    expect(settlesInPhysicalCash(" CASH ")).toBe(true);
    expect(settlesInPhysicalCash("Cash")).toBe(true);
  });

  it("is false for a missing method rather than throwing", () => {
    expect(settlesInPhysicalCash(null)).toBe(false);
    expect(settlesInPhysicalCash(undefined)).toBe(false);
    expect(settlesInPhysicalCash("")).toBe(false);
  });
});

describe("cashStepCents", () => {
  it("is 5 sen for MYR and absent for the whole-unit currencies", () => {
    expect(cashStepCents("MYR")).toBe(5);
    expect(cashStepCents("TWD")).toBeNull();
    expect(cashStepCents("VND")).toBeNull();
  });
});

describe("cashRoundedCents (MYR)", () => {
  it("rounds RM10.33 up to RM10.35", () => {
    expect(cashRoundedCents(1033, "MYR")).toBe(1035);
  });

  it("rounds RM10.32 down to RM10.30", () => {
    expect(cashRoundedCents(1032, "MYR")).toBe(1030);
  });

  it("leaves an exact multiple of 5 sen alone", () => {
    for (const cents of [0, 5, 500, 1030, 1035, 99995]) {
      expect(cashRoundedCents(cents, "MYR")).toBe(cents);
    }
  });

  it("rounds each residue class the way BNM's table does", () => {
    // 1 and 2 sen down, 3 and 4 sen up, repeating every 5 sen.
    expect(cashRoundedCents(1031, "MYR")).toBe(1030);
    expect(cashRoundedCents(1032, "MYR")).toBe(1030);
    expect(cashRoundedCents(1033, "MYR")).toBe(1035);
    expect(cashRoundedCents(1034, "MYR")).toBe(1035);
    expect(cashRoundedCents(1036, "MYR")).toBe(1035);
    expect(cashRoundedCents(1037, "MYR")).toBe(1035);
    expect(cashRoundedCents(1038, "MYR")).toBe(1040);
    expect(cashRoundedCents(1039, "MYR")).toBe(1040);
  });

  it("rounds the RM10.325 midpoint away from zero", () => {
    // Not a reachable stored amount (cents are integers), but a caller that
    // multiplied by a rate can hand one in, and the tie must not fall back
    // toward zero or a refund would round differently from its charge.
    expect(cashRoundedCents(1032.5, "MYR")).toBe(1035);
    expect(cashRoundedCents(1037.5, "MYR")).toBe(1040);
    expect(cashRoundedCents(-1032.5, "MYR")).toBe(-1035);
  });

  it("absorbs float noise from a caller that multiplied by a rate", () => {
    expect(cashRoundedCents(1033.0000000000002, "MYR")).toBe(1035);
  });

  it("mirrors the charge when the amount is negative (a refund)", () => {
    expect(cashRoundedCents(-1033, "MYR")).toBe(-1035);
    expect(cashRoundedCents(-1032, "MYR")).toBe(-1030);
    expect(cashRoundedCents(-1035, "MYR")).toBe(-1035);
  });

  it("never returns -0", () => {
    expect(Object.is(cashRoundedCents(-1, "MYR"), 0)).toBe(true);
  });

  it("rejects a non-finite amount", () => {
    expect(() => cashRoundedCents(Number.NaN, "MYR")).toThrow(
      "Money amount must be finite",
    );
    expect(() => cashRoundedCents(Number.POSITIVE_INFINITY, "MYR")).toThrow(
      "Money amount must be finite",
    );
  });
});

describe("cashRoundedCents (whole-unit currencies)", () => {
  it("leaves TWD and VND amounts untouched", () => {
    for (const cents of [0, 100, 1033, 17050, -1033]) {
      expect(cashRoundedCents(cents, "TWD")).toBe(cents);
      expect(cashRoundedCents(cents, "VND")).toBe(cents);
    }
  });

  it("leaves a legacy off-step TWD total payable at the figure it was priced", () => {
    // NT$170.50 was priced before per-line rounding existed. Cash rounding
    // must not quietly move it to NT$171.
    expect(cashRoundedCents(17050, "TWD")).toBe(17050);
    expect(cashRoundingAdjustmentCents(17050, "TWD")).toBe(0);
  });
});

describe("cashRoundingAdjustmentCents", () => {
  it("stays within −2..+2 sen for every MYR total", () => {
    for (let cents = 0; cents <= 200; cents += 1) {
      const adjustment = cashRoundingAdjustmentCents(cents, "MYR");
      expect(adjustment).toBeGreaterThanOrEqual(-2);
      expect(adjustment).toBeLessThanOrEqual(2);
      expect(cents + adjustment).toBe(cashRoundedCents(cents, "MYR"));
    }
  });

  it("reports the worked examples from the issue", () => {
    expect(cashRoundingAdjustmentCents(1033, "MYR")).toBe(2);
    expect(cashRoundingAdjustmentCents(1032, "MYR")).toBe(-2);
    expect(cashRoundingAdjustmentCents(1035, "MYR")).toBe(0);
  });

  it("is always 0 for TWD and VND", () => {
    for (const cents of [0, 1033, 17050]) {
      expect(cashRoundingAdjustmentCents(cents, "TWD")).toBe(0);
      expect(cashRoundingAdjustmentCents(cents, "VND")).toBe(0);
    }
  });
});

describe("collectableAmount", () => {
  it("rounds an MYR cash payment and reports the adjustment", () => {
    expect(
      collectableAmount(1033, { currency: "MYR", paymentMethod: "cash" }),
    ).toEqual({ collectableCents: 1035, roundingAdjustmentCents: 2 });
  });

  it("collects the exact total for an MYR card payment", () => {
    expect(
      collectableAmount(1033, { currency: "MYR", paymentMethod: "card" }),
    ).toEqual({ collectableCents: 1033, roundingAdjustmentCents: 0 });
  });

  it("collects the exact total for every MYR e-wallet", () => {
    for (const method of ["touch_n_go", "grab_pay", "fpx", "digital_wallet"]) {
      expect(
        collectableAmount(1033, { currency: "MYR", paymentMethod: method }),
      ).toEqual({ collectableCents: 1033, roundingAdjustmentCents: 0 });
    }
  });

  it("leaves a TWD cash payment alone", () => {
    expect(
      collectableAmount(35000, { currency: "TWD", paymentMethod: "cash" }),
    ).toEqual({ collectableCents: 35000, roundingAdjustmentCents: 0 });
  });

  it("leaves a VND cash payment alone", () => {
    expect(
      collectableAmount(10000000, { currency: "VND", paymentMethod: "cash" }),
    ).toEqual({ collectableCents: 10000000, roundingAdjustmentCents: 0 });
  });

  it("collects the exact total when no method is known", () => {
    expect(
      collectableAmount(1033, { currency: "MYR", paymentMethod: null }),
    ).toEqual({ collectableCents: 1033, roundingAdjustmentCents: 0 });
  });

  it("rounds a negative MYR cash amount the same way, for refunds", () => {
    expect(
      collectableAmount(-1033, { currency: "MYR", paymentMethod: "cash" }),
    ).toEqual({ collectableCents: -1035, roundingAdjustmentCents: -2 });
  });
});
