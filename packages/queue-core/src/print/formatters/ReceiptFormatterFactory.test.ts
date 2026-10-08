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

function receipt(payment: ReceiptData["payment"], total = 10.33): ReceiptData {
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

describe("regional receipt formatters — what the header says", () => {
  it.each(["TW", "MY", "VN"] as const)(
    "prints the order number a person reads, not the row id (%s)",
    (country) => {
      const data = receipt(undefined);
      data.order!.orderNumber = "A-1001";

      expect(format(country, data).header.transactionInfo.orderId).toBe(
        "A-1001",
      );
    },
  );

  it("falls back to the row id when the order has no number", () => {
    expect(
      format("TW", receipt(undefined)).header.transactionInfo.orderId,
    ).toBe("order-1");
  });
});

describe("regional receipt formatters — legal notice", () => {
  it("does not call a TW receipt an invoice when none was issued", () => {
    expect(format("TW", receipt(undefined)).footer.legalNotice).toBeUndefined();
  });

  it("prints the provider's invoice when one is attached, its own wording first", () => {
    const withNumber = receipt(undefined);
    withNumber.invoice = { provider: "acme", number: "AB-12345678" };
    expect(format("TW", withNumber).footer.legalNotice).toBe(
      "電子發票 AB-12345678",
    );

    const withNotice = receipt(undefined);
    withNotice.invoice = {
      provider: "acme",
      number: "AB-12345678",
      notice: "電子發票證明聯 AB-12345678",
    };
    expect(format("TW", withNotice).footer.legalNotice).toBe(
      "電子發票證明聯 AB-12345678",
    );
  });

  it.each([
    ["MY", "GST/SST No: T-99"],
    ["VN", "Mã số thuế: T-99"],
  ] as const)(
    "prints only the shop's own tax number (%s)",
    (country, expected) => {
      const data = receipt(undefined);
      data.restaurant = { ...data.restaurant, taxNumber: "T-99" };
      expect(format(country, data).footer.legalNotice).toBe(expected);
      expect(
        format(country, receipt(undefined)).footer.legalNotice,
      ).toBeUndefined();
    },
  );
});
