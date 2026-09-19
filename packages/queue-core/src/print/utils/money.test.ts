import { describe, expect, it } from "vitest";
import type { CountryCode, PrintRequest } from "@makanmasak/shared-types";
import {
  REGION_CONFIGS,
  formatCurrency,
  getCurrencyConfig,
} from "../config/regions";
import { RegionManager } from "../services/RegionManager";
import { ReceiptFormattingService } from "../formatters/ReceiptFormattingService";
import { CommandBuilder } from "../commands/CommandBuilder";
import {
  currencyDecimals,
  formatCurrencyAmount,
  formatRegionMoney,
  roundMoney,
} from "./money";

// The strings the web apps print through @makanmasak/utils formatCurrency.
// A receipt that disagrees with the screen it was printed from reads as a
// different amount.
const CASES: Array<[CountryCode, number, string]> = [
  ["TW", 350, "NT$350"],
  ["TW", 12345, "NT$12,345"],
  ["MY", 12.5, "RM 12.50"],
  ["MY", 1234.5, "RM 1,234.50"],
  ["VN", 350000, "350.000 ₫"],
];

describe("receipt money formatting", () => {
  it.each(CASES)("%s %s → %s", (country, amount, expected) => {
    expect(formatRegionMoney(amount, REGION_CONFIGS[country])).toBe(expected);
    expect(formatCurrency(amount, country)).toBe(expected);
    expect(new RegionManager().formatCurrency(amount, country)).toBe(expected);
    expect(formatCurrencyAmount(amount, REGION_CONFIGS[country].currency)).toBe(
      expected,
    );
  });

  it("keys precision on the currency code, not the symbol", () => {
    // RegionManager used to test "₫" against ["JPY","KRW","VND"].
    expect(new RegionManager().formatCurrency(350000.4, "VN")).toBe(
      "350.000 ₫",
    );
    expect(getCurrencyConfig("VN")?.decimals).toBe(0);
    expect(getCurrencyConfig("TW")?.decimals).toBe(0);
    expect(getCurrencyConfig("MY")?.decimals).toBe(2);
    expect(currencyDecimals("TWD")).toBe(0);
  });

  it("rounds half away from zero and never prints -0", () => {
    expect(roundMoney(12.5, "TWD")).toBe(13);
    expect(roundMoney(-12.5, "TWD")).toBe(-13);
    expect(roundMoney(1.005, "MYR")).toBe(1.01);
    expect(Object.is(roundMoney(-0.4, "TWD"), 0)).toBe(true);
    expect(formatRegionMoney(-0.4, REGION_CONFIGS.TW)).toBe("NT$0");
    expect(formatRegionMoney(-50, REGION_CONFIGS.TW)).toBe("-NT$50");
  });

  it("prints a bare two-decimal number when the currency is unknown", () => {
    expect(formatCurrencyAmount(350, undefined)).toBe("350.00");
  });
});

const request = (
  country: CountryCode,
  order: PrintRequest["data"]["order"],
): PrintRequest => ({
  country,
  type: "receipt",
  restaurantId: "restaurant-1",
  data: { order },
});

describe("receipts per currency", () => {
  it("rounds the Taiwan 5% tax fallback to whole dollars", async () => {
    const content = await new ReceiptFormattingService().formatReceipt(
      request("TW", {
        id: "order-1",
        createdAt: new Date("2026-09-19T00:00:00.000Z"),
        items: [{ name: "滷肉飯", quantity: 1, price: 333 }],
        subtotal: 333,
        total: 350,
      }),
    );

    // 333 * 0.05 = 16.650000000000002
    expect(content.summary.tax[0].amount).toBe(17);
    expect(content.summary.currency).toBe("TWD");
  });

  it("rounds the Malaysia 6% tax fallback to sen", async () => {
    const content = await new ReceiptFormattingService().formatReceipt(
      request("MY", {
        id: "order-2",
        createdAt: new Date("2026-09-19T00:00:00.000Z"),
        items: [{ name: "Nasi Lemak", quantity: 1, price: 12.35 }],
        subtotal: 12.35,
        total: 13.09,
      }),
    );

    // 12.35 * 0.06 = 0.741
    expect(content.summary.tax[0].amount).toBe(0.74);
    expect(content.summary.currency).toBe("MYR");
  });

  it.each([
    ["TW", 350, "NT$350", "$350.00"],
    ["MY", 12.5, "RM 12.50", "$12.50"],
    ["VN", 350000, "350.000 ₫", "350000.00"],
  ] as const)(
    "%s: ESC/POS and the text preview print %s",
    async (country, amount, expected, legacy) => {
      const service = new ReceiptFormattingService();
      const order = {
        id: "order-3",
        createdAt: new Date("2026-09-19T00:00:00.000Z"),
        items: [{ name: "Item", quantity: 1, price: amount }],
        subtotal: amount,
        tax: 0,
        total: amount,
      };

      const content = await service.formatReceipt(request(country, order));
      const escpos = CommandBuilder.fromPrintContent(content).buildESCPOS();
      expect(escpos).toContain(expected);

      const { preview } = await service.previewReceipt(request(country, order));
      expect(preview).toContain(expected);
      expect(preview).not.toContain(legacy);
    },
  );
});
