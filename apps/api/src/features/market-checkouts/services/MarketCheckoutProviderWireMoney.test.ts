import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";
import {
  HttpProviderSplitGateway,
  ProviderSplitMarketCheckoutPaymentProvider,
  childOrderAmountCents,
  queryMarketCheckoutProviderSplitStatus,
  refundMarketCheckoutProviderSplitPayment,
  verifyProviderRefundResult,
  withProviderWireMoney,
  type MarketCheckoutPaymentProviderInput,
} from "./MarketCheckoutPaymentProvider";

const providerEnv = {
  MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
  MARKET_CHECKOUT_PROVIDER_STATUS_URL: "https://adapter.test/status",
  MARKET_CHECKOUT_PROVIDER_REFUND_URL: "https://adapter.test/refunds",
} as Env;

function buildPaymentInput(
  overrides: Partial<MarketCheckoutPaymentProviderInput> = {},
): MarketCheckoutPaymentProviderInput {
  return {
    checkoutId: "checkout-vnd",
    marketSlug: "ben-thanh",
    method: "market_online",
    country: "VN",
    currency: "VND",
    childOrders: [
      {
        restaurantId: "restaurant-1",
        restaurantName: "Pho Stall",
        orderId: "2001",
        orderNumber: "V001",
        totalAmount: 60000,
        totalAmountCents: 6000000,
      },
      {
        restaurantId: "restaurant-2",
        restaurantName: "Coffee Stall",
        orderId: "2002",
        orderNumber: "V002",
        totalAmount: 40000,
        totalAmountCents: 4000000,
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

describe("childOrderAmountCents", () => {
  it("prefers the integer cents column over the float amount", () => {
    expect(
      childOrderAmountCents({ totalAmount: 0.1 + 0.2, totalAmountCents: 30 }),
    ).toBe(30);
    expect(childOrderAmountCents({ totalAmount: 12.34 })).toBe(1234);
    expect(childOrderAmountCents({})).toBe(0);
  });
});

describe("withProviderWireMoney", () => {
  it("adds ISO 4217 minor units next to internal cents", () => {
    expect(
      withProviderWireMoney({
        amountCents: 10000000,
        currency: "VND",
        allocations: [
          {
            restaurantId: "r1",
            restaurantName: "Pho",
            orderId: "1",
            orderNumber: "V1",
            amountCents: 10000000,
          },
        ],
      }),
    ).toMatchObject({
      amountCents: 10000000,
      amountMinor: 100000,
      currencyExponent: 0,
      allocations: [{ amountCents: 10000000, amountMinor: 100000 }],
    });
    expect(
      withProviderWireMoney({ amountCents: 25000, currency: "TWD" }),
    ).toEqual({
      amountCents: 25000,
      currency: "TWD",
      amountMinor: 25000,
      currencyExponent: 2,
    });
    expect(
      withProviderWireMoney({ amountCents: 1250, currency: "myr" }),
    ).toMatchObject({ amountMinor: 1250, currencyExponent: 2 });
  });

  it("refuses a missing or unsupported currency", () => {
    expect(() => withProviderWireMoney({ amountCents: 100 })).toThrow(
      "needs a supported currency",
    );
    expect(() =>
      withProviderWireMoney({ amountCents: 100, currency: "USD" }),
    ).toThrow("needs a supported currency");
  });

  it("refuses an amount off the currency step", () => {
    expect(() =>
      withProviderWireMoney({ amountCents: 1550, currency: "TWD" }),
    ).toThrow("not aligned to the TWD step");
  });
});

describe("ProviderSplitMarketCheckoutPaymentProvider money checks", () => {
  it("sends VND with its ISO minor units and accepts a matching authorization", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        provider: "fake_adapter",
        providerTransactionId: "pi_vnd",
        status: "paid",
        authorizedAmountCents: 10000000,
        currency: "VND",
        allocations: [
          { orderId: "2001", amountCents: 6000000 },
          { orderId: "2002", amountCents: 4000000 },
        ],
      }),
    );
    const provider = new ProviderSplitMarketCheckoutPaymentProvider(
      new HttpProviderSplitGateway(
        "https://adapter.test/payments",
        undefined,
        fetcher as unknown as typeof fetch,
      ),
    );

    const result = await provider.process(buildPaymentInput());

    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      currency: "VND",
      amountCents: 10000000,
      amountMinor: 100000,
      currencyExponent: 0,
      allocations: [
        { orderId: "2001", amountCents: 6000000, amountMinor: 60000 },
        { orderId: "2002", amountCents: 4000000, amountMinor: 40000 },
      ],
    });
    expect(result).toMatchObject({
      paymentStatus: "paid",
      childPayments: [
        expect.objectContaining({ orderId: "2001", amountCents: 6000000 }),
        expect.objectContaining({ orderId: "2002", amountCents: 4000000 }),
      ],
    });
  });

  it("refuses to ask the adapter for an amount off the currency step", async () => {
    const gateway = { process: vi.fn() };
    const provider = new ProviderSplitMarketCheckoutPaymentProvider(gateway);

    await expect(
      provider.process(
        buildPaymentInput({
          currency: "TWD",
          country: "TW",
          childOrders: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "Noodle Stall",
              orderId: "1001",
              orderNumber: "A001",
              totalAmount: 15.5,
              totalAmountCents: 1550,
            },
          ],
        }),
      ),
    ).rejects.toThrow("not aligned to the TWD step of 100 cents");
    expect(gateway.process).not.toHaveBeenCalled();
  });

  it.each([
    [{ currency: "USD" }, "CURRENCY_MISMATCH"],
    [{ currency: undefined }, "CURRENCY_MISSING"],
  ])(
    "rejects an authorization in the wrong currency (%o)",
    async (patch, code) => {
      const gateway = {
        process: vi.fn(async () => ({
          provider: "fake_adapter",
          providerTransactionId: "pi_vnd",
          status: "paid" as const,
          authorizedAmountCents: 10000000,
          allocations: [
            { orderId: "2001", amountCents: 6000000 },
            { orderId: "2002", amountCents: 4000000 },
          ],
          ...patch,
        })),
      };
      const provider = new ProviderSplitMarketCheckoutPaymentProvider(gateway);

      await expect(provider.process(buildPaymentInput())).rejects.toThrow(
        `authorized currency does not match checkout currency (${code})`,
      );
      expect(gateway.process).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 10000000, currency: "VND" }),
      );
    },
  );

  it("rejects an authorization in whole dong instead of cents", async () => {
    const gateway = {
      process: vi.fn(async () => ({
        provider: "fake_adapter",
        providerTransactionId: "pi_vnd",
        status: "paid" as const,
        authorizedAmountCents: 100000,
        currency: "VND",
        allocations: [],
      })),
    };
    const provider = new ProviderSplitMarketCheckoutPaymentProvider(gateway);

    await expect(provider.process(buildPaymentInput())).rejects.toThrow(
      "authorized amount does not match checkout total",
    );
    expect(gateway.process).toHaveBeenCalledOnce();
  });
});

describe("provider status lookup wire format", () => {
  it("sends minor units when the payment has a currency", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ provider: "fake_adapter", status: "pending" }),
    );

    await queryMarketCheckoutProviderSplitStatus(
      providerEnv,
      {
        checkoutId: "c1",
        paymentId: "p1",
        provider: "fake_adapter",
        amountCents: 10000000,
        currency: "VND",
      },
      fetcher as unknown as typeof fetch,
    );

    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      amountCents: 10000000,
      amountMinor: 100000,
      currencyExponent: 0,
    });
  });

  it("still looks up a legacy payment that has no currency", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ provider: "fake_adapter", status: "pending" }),
    );

    await queryMarketCheckoutProviderSplitStatus(
      providerEnv,
      {
        checkoutId: "c1",
        paymentId: "p1",
        provider: "fake_adapter",
        amountCents: 100,
      },
      fetcher as unknown as typeof fetch,
    );

    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("amountMinor");
  });

  it("rejects fractional amounts instead of rounding them", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        provider: "fake_adapter",
        status: "paid",
        amountReceivedCents: 12500.4,
        currency: "TWD",
      }),
    );

    await expect(
      queryMarketCheckoutProviderSplitStatus(
        providerEnv,
        {
          checkoutId: "c1",
          paymentId: "p1",
          provider: "fake_adapter",
          amountCents: 12500,
          currency: "TWD",
        },
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Invalid provider status lookup amount");
  });
});

describe("provider refund wire format and verification", () => {
  const refundInput = {
    checkoutId: "c1",
    paymentId: "p1",
    provider: "fake_adapter",
    providerTransactionId: "pi_1",
    amountCents: 25000,
    currency: "TWD",
    allocations: [
      {
        restaurantId: "r1",
        restaurantName: "Stall",
        orderId: "1",
        orderNumber: "A1",
        amountCents: 25000,
      },
    ],
  };

  it("sends minor units and refuses to refund without a currency", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        provider: "fake_adapter",
        refundId: "re_1",
        status: "refunded",
        refundedAmountCents: 25000,
        currency: "TWD",
      }),
    );

    await refundMarketCheckoutProviderSplitPayment(
      providerEnv,
      refundInput,
      fetcher as unknown as typeof fetch,
    );
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      amountMinor: 25000,
      currencyExponent: 2,
      allocations: [{ amountMinor: 25000 }],
    });

    await expect(
      refundMarketCheckoutProviderSplitPayment(
        providerEnv,
        { ...refundInput, currency: undefined },
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow("needs a supported currency");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects a fractional refunded amount", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        provider: "fake_adapter",
        refundId: "re_1",
        status: "refunded",
        refundedAmountCents: 250.5,
        currency: "TWD",
      }),
    );

    await expect(
      refundMarketCheckoutProviderSplitPayment(
        providerEnv,
        refundInput,
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Invalid provider refund amount");
  });

  it.each([
    [{ status: "refunded", refundedAmountCents: 25000, currency: "TWD" }, null],
    [
      {
        status: "partial_refunded",
        refundedAmountCents: 1000,
        currency: "twd",
      },
      null,
    ],
    [{ status: "pending", refundedAmountCents: 0 }, null],
    [{ status: "failed", refundedAmountCents: 0 }, null],
    [{ status: "refunded", refundedAmountCents: 25000 }, "CURRENCY_MISSING"],
    [
      { status: "refunded", refundedAmountCents: 25000, currency: "MYR" },
      "CURRENCY_MISMATCH",
    ],
    [
      { status: "refunded", refundedAmountCents: 2500000, currency: "TWD" },
      "AMOUNT_EXCEEDS_EXPECTED",
    ],
    [
      { status: "refunded", refundedAmountCents: 0, currency: "TWD" },
      "AMOUNT_MISMATCH",
    ],
  ] as const)("verifies refund result %o → %s", (patch, code) => {
    const issue = verifyProviderRefundResult(
      { amountCents: 25000, currency: "TWD" },
      { provider: "fake_adapter", refundId: "re_1", ...patch },
    );
    expect(issue?.code ?? null).toBe(code);
  });
});

describe("HTTP gateways call fetch unbound", () => {
  // workerd's global fetch throws "Illegal invocation" when called as a method
  // of another object; this stand-in does the same.
  function strictFetch(this: unknown) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Illegal invocation");
    }
    return Promise.resolve(
      jsonResponse({
        provider: "fake_adapter",
        providerTransactionId: "pi_1",
        status: "requires_action",
        authorizedAmountCents: 0,
        allocations: [],
      }),
    );
  }

  it("does not call the injected fetch as a method of the gateway", async () => {
    const gateway = new HttpProviderSplitGateway(
      "https://adapter.test/payments",
      undefined,
      strictFetch as unknown as typeof fetch,
    );

    await expect(
      gateway.process({
        checkoutId: "c1",
        marketSlug: "m",
        method: "market_online",
        country: "TW",
        currency: "TWD",
        idempotencyKey: "k",
        amountCents: 10000,
        allocations: [],
      }),
    ).resolves.toMatchObject({ providerTransactionId: "pi_1" });
  });
});
