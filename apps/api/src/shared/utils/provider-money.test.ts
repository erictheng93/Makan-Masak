import { describe, expect, it } from "vitest";
import {
  assertCurrencyAlignedCents,
  centsToIsoMinorUnits,
  centsToProviderAmount,
  isNativePaymentProvider,
  providerAmountToCents,
  verifyProviderMoney,
} from "./provider-money";

describe("providerAmountToCents", () => {
  it.each([
    // Stripe: TWD/MYR two-decimal, VND zero-decimal.
    ["stripe", "twd", 25000, 25000],
    ["stripe", "myr", 1250, 1250],
    ["stripe", "vnd", 100000, 10000000],
    // LINE Pay / ECPay / NewebPay: whole TWD.
    ["linepay", "TWD", 250, 25000],
    ["ecpay", "TWD", 250, 25000],
    ["newebpay", "TWD", 250, 25000],
    // Our HTTP adapters: internal cents for every currency.
    ["mock_market_provider", "VND", 10000000, 10000000],
    ["mock_market_provider", "TWD", 25000, 25000],
  ])("%s %s %d → %d cents", (provider, currency, amount, cents) => {
    expect(providerAmountToCents(provider, currency, amount)).toEqual({
      ok: true,
      cents,
      currency: currency.toUpperCase(),
    });
  });

  it("is case-insensitive on the provider name", () => {
    expect(providerAmountToCents("Stripe", "VND", 5)).toMatchObject({
      ok: true,
      cents: 500,
    });
  });

  it("refuses a currency the provider cannot settle", () => {
    expect(providerAmountToCents("linepay", "MYR", 250)).toEqual({
      ok: false,
      issue: expect.objectContaining({ code: "CURRENCY_UNSUPPORTED" }),
    });
  });

  it("refuses currencies the platform does not support", () => {
    expect(providerAmountToCents("stripe", "usd", 100)).toEqual({
      ok: false,
      issue: expect.objectContaining({ code: "CURRENCY_UNSUPPORTED" }),
    });
  });

  it("reports a missing currency", () => {
    expect(providerAmountToCents("stripe", undefined, 100)).toEqual({
      ok: false,
      issue: expect.objectContaining({ code: "CURRENCY_MISSING" }),
    });
  });

  it("names the unsupported currency before judging the amount", () => {
    expect(providerAmountToCents("linepay", "MYR", 19.8)).toEqual({
      ok: false,
      issue: expect.objectContaining({ code: "CURRENCY_UNSUPPORTED" }),
    });
  });

  it("refuses fractional provider amounts", () => {
    expect(providerAmountToCents("linepay", "TWD", 250.5)).toEqual({
      ok: false,
      issue: expect.objectContaining({ code: "AMOUNT_NOT_INTEGER" }),
    });
  });
});

describe("centsToProviderAmount", () => {
  it("converts internal cents to each provider's unit", () => {
    expect(centsToProviderAmount("stripe", "VND", 10000000)).toBe(100000);
    expect(centsToProviderAmount("stripe", "TWD", 25000)).toBe(25000);
    expect(centsToProviderAmount("linepay", "TWD", 25000)).toBe(250);
    expect(centsToProviderAmount("adapter", "MYR", 1250)).toBe(1250);
  });

  it("refuses amounts that are not whole provider units", () => {
    expect(() => centsToProviderAmount("linepay", "TWD", 25050)).toThrow(
      "not a whole linepay amount",
    );
  });

  it("refuses currencies the provider cannot settle", () => {
    expect(() => centsToProviderAmount("ecpay", "VND", 100)).toThrow(
      "does not settle VND",
    );
  });
});

describe("centsToIsoMinorUnits", () => {
  it("maps internal cents onto ISO 4217 minor units", () => {
    expect(centsToIsoMinorUnits(25000, "TWD")).toBe(25000);
    expect(centsToIsoMinorUnits(1250, "MYR")).toBe(1250);
    expect(centsToIsoMinorUnits(10000000, "VND")).toBe(100000);
  });

  it("refuses amounts off the currency step", () => {
    expect(() => centsToIsoMinorUnits(1550, "TWD")).toThrow(
      "not aligned to the TWD step of 100 cents",
    );
    expect(() => centsToIsoMinorUnits(150, "VND")).toThrow("VND step");
    expect(() => assertCurrencyAlignedCents(12.5, "MYR")).toThrow("MYR step");
  });
});

describe("isNativePaymentProvider", () => {
  it("recognises only the native gateways", () => {
    expect(isNativePaymentProvider("stripe")).toBe(true);
    expect(isNativePaymentProvider("LINEPAY")).toBe(true);
    expect(isNativePaymentProvider("mock_market_provider")).toBe(false);
  });
});

describe("verifyProviderMoney", () => {
  const base = {
    expectedCents: 25000,
    expectedCurrency: "TWD",
    receivedCents: 25000,
    receivedCurrency: "twd",
  };

  it("accepts an exact match", () => {
    expect(verifyProviderMoney(base)).toBeNull();
  });

  it.each([
    [{ expectedCurrency: null }, "CURRENCY_MISSING"],
    [{ receivedCurrency: undefined }, "CURRENCY_MISSING"],
    [{ receivedCurrency: "" }, "CURRENCY_MISSING"],
    [{ receivedCurrency: "USD" }, "CURRENCY_MISMATCH"],
    [{ receivedCurrency: "MYR" }, "CURRENCY_MISMATCH"],
    [{ receivedCents: undefined }, "AMOUNT_MISSING"],
    [{ receivedCents: 250.5 }, "AMOUNT_NOT_INTEGER"],
    [{ receivedCents: 24900 }, "AMOUNT_MISMATCH"],
    [{ receivedCents: 25100 }, "AMOUNT_MISMATCH"],
  ])("flags %o as %s", (patch, code) => {
    expect(verifyProviderMoney({ ...base, ...patch })).toEqual(
      expect.objectContaining({ code }),
    );
  });

  it("allows a partial amount in at_most mode but never more", () => {
    expect(
      verifyProviderMoney({ ...base, receivedCents: 1000, mode: "at_most" }),
    ).toBeNull();
    expect(
      verifyProviderMoney({ ...base, receivedCents: 25100, mode: "at_most" }),
    ).toEqual(expect.objectContaining({ code: "AMOUNT_EXCEEDS_EXPECTED" }));
  });
});
