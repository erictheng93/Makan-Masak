import { describe, expect, it } from "vitest";
import type { CountryCode } from "@makanmasak/shared-types";
import { REGION_CONFIGS } from "../config/regions";
import {
  ReceiptFormatterFactory,
  type ReceiptData,
} from "./ReceiptFormatterFactory";

/**
 * Cash-rounding pass-through (#405).
 *
 * The regional formatters are what turn a payment payload into the summary a
 * driver prints, so this is where the adjustment either survives or silently
 * disappears.
 */
function format(country: CountryCode, data: ReceiptData) {
  return ReceiptFormatterFactory.createFormatter(
    country,
    REGION_CONFIGS[country],
  ).formatReceipt(data);
}

function receipt(
  payment: ReceiptData["payment"],
  total = 10.33,
): ReceiptData {
  return {
    order: {
      id: "order-1",
      items: [{ name: "Nasi Lemak", quantity: 1, price: total }],
      subtotal: total,
      tax: 0,
      total,
    },
    restaurant: { name: "Warung", address: "KL" },
    cashier: { name: "Cashier" },
    payment,
  };
}

describe("regional receipt formatters — cash rounding", () => {
  it("carries a MYR cash rounding adjustment into the summary", () => {
    const content = format(
      "MY",
      receipt({ method: "cash", amount: 10.35, roundingAdjustment: 0.02 }),
    );

    expect(content.summary.total).toBe(10.33);
    expect(content.summary.roundingAdjustment).toBe(0.02);
    expect(content.summary.amountDue).toBe(10.35);
  });

  it("carries a downward adjustment with its sign intact", () => {
    const content = format(
      "MY",
      receipt(
        { method: "cash", amount: 10.3, roundingAdjustment: -0.02 },
        10.32,
      ),
    );

    expect(content.summary.roundingAdjustment).toBe(-0.02);
    expect(content.summary.amountDue).toBe(10.3);
  });

  it("leaves the summary untouched for a card payment", () => {
    const content = format(
      "MY",
      receipt({ method: "credit_card", amount: 10.33 }),
    );

    expect(content.summary.roundingAdjustment).toBeUndefined();
    expect(content.summary.amountDue).toBeUndefined();
  });

  it("leaves the summary untouched when the adjustment is zero", () => {
    const content = format(
      "MY",
      receipt({ method: "cash", amount: 10.35, roundingAdjustment: 0 }),
    );

    expect(content.summary.roundingAdjustment).toBeUndefined();
  });

  it("drops an adjustment too small to exist in the currency", () => {
    // TWD has no fractional unit, so a stray 0.02 rounds to nothing rather
    // than printing a line that reads "+NT$0".
    const content = format(
      "TW",
      receipt({ method: "cash", amount: 350, roundingAdjustment: 0.02 }, 350),
    );

    expect(content.summary.roundingAdjustment).toBeUndefined();
  });

  it("leaves a VND receipt untouched", () => {
    const content = format(
      "VN",
      receipt({ method: "cash", amount: 100000 }, 100000),
    );

    expect(content.summary.roundingAdjustment).toBeUndefined();
  });
});
