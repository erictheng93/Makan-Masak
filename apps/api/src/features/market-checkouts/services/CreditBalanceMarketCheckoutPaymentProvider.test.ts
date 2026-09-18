import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../../../types/env";
import type { MarketCheckoutPaymentProviderInput } from "./MarketCheckoutPaymentProvider";
import {
  CreditBalanceMarketCheckoutPaymentProvider,
  createMarketCheckoutPaymentProvider,
} from "./MarketCheckoutPaymentProvider";

const spend = vi.hoisted(() => vi.fn());

vi.mock("../../credits/services/CreditService", () => ({
  CreditService: function CreditService() {
    return { spend };
  },
}));

// The factory now refuses every method whose provider is not configured
// (#400), and credits are configured by the feature flag.
const env = { STORED_VALUE_CREDITS_ENABLED: "true" } as unknown as Env;

const baseInput: MarketCheckoutPaymentProviderInput = {
  checkoutId: "checkout-1",
  marketSlug: "night-market",
  childOrders: [
    {
      restaurantId: "r1",
      restaurantName: "A",
      orderId: "1",
      orderNumber: "A-1",
      totalAmount: 120,
    },
    {
      restaurantId: "r2",
      restaurantName: "B",
      orderId: "2",
      orderNumber: "B-1",
      totalAmount: 80,
    },
  ],
  method: "credits",
  country: "TW",
  currency: "TWD",
  providerInput: { creditCardPublicId: "pub-123", creditCardPin: "1234" },
};

describe("CreditBalanceMarketCheckoutPaymentProvider", () => {
  beforeEach(() => {
    spend.mockReset();
  });

  it("factory selects the credit provider for method=credits", () => {
    expect(createMarketCheckoutPaymentProvider(env, "credits")).toBeInstanceOf(
      CreditBalanceMarketCheckoutPaymentProvider,
    );
  });

  it("factory refuses credits while the stored-value feature is off", () => {
    expect(() =>
      createMarketCheckoutPaymentProvider({} as Env, "credits"),
    ).toThrow(/not configured/);
  });

  it("spends the aggregate total and maps paid child payments", async () => {
    spend.mockResolvedValue({
      ledgerEntryId: "ledger-1",
      accountId: "acc-1",
      balanceAfterCents: 800,
    });
    const provider = new CreditBalanceMarketCheckoutPaymentProvider(env);

    const result = await provider.process(baseInput);

    expect(spend).toHaveBeenCalledOnce();
    expect(spend).toHaveBeenCalledWith(
      expect.objectContaining({
        publicId: "pub-123",
        pin: "1234",
        amountCents: 20000,
        currency: "TWD",
        idempotencyKey: "market-checkout:checkout-1",
        sourceType: "market_checkout",
        sourceId: "checkout-1",
      }),
    );
    expect(result).toMatchObject({
      provider: "credit_balance",
      splitMode: "provider_split",
      paymentStatus: "paid",
      providerTransactionId: "ledger-1",
    });
    expect(result.childPayments).toHaveLength(2);
    expect(result.childPayments[0]).toMatchObject({
      orderId: "1",
      status: "paid",
      amountCents: 12000,
      paymentId: "ledger-1:1",
    });
  });

  it("propagates the request idempotency key when provided", async () => {
    spend.mockResolvedValue({
      ledgerEntryId: "ledger-2",
      accountId: "acc-1",
      balanceAfterCents: 0,
    });
    const provider = new CreditBalanceMarketCheckoutPaymentProvider(env);

    await provider.process({
      ...baseInput,
      requestIdempotencyKey: "req-key-9",
    });

    expect(spend).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "req-key-9" }),
    );
  });

  it("throws when no credit card public id is provided", async () => {
    const provider = new CreditBalanceMarketCheckoutPaymentProvider(env);
    await expect(
      provider.process({ ...baseInput, providerInput: {} }),
    ).rejects.toThrow(/public id/i);
    expect(spend).not.toHaveBeenCalled();
  });
});
