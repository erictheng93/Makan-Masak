import { describe, expect, it, vi, type Mock } from "vitest";
import type { ShopPaymentCredentialService } from "./ShopPaymentCredentialService";
import { ApiError } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";
import type { MarketCheckoutProviderSplitGatewayInput } from "../../market-checkouts/services/MarketCheckoutPaymentProvider";
import type {
  ShopWalletGateway,
  ShopWalletGatewayRequest,
  ShopWalletGatewayResponse,
} from "./ShopWalletGateway";
import {
  ShopWalletMarketCheckoutGateway,
  createShopWalletGateway,
  httpShopWalletGateway,
  isShopWalletPaymentProvider,
  refundShopWalletMarketCheckoutPayment,
  shopWalletProviderFromMethod,
  withoutCredentials,
} from "./ShopWalletMarketCheckoutGateway";

const env = {} as Env;

/**
 * Answers with one merchant account per restaurant. The default has every
 * restaurant on the same account, which is the case a shop wallet can settle.
 */
function credentialsStub(byRestaurant: Record<string, string> = {}): Pick<
  ShopPaymentCredentialService,
  "loadGatewayCredentials"
> & {
  loadGatewayCredentials: Mock;
} {
  return {
    loadGatewayCredentials: vi.fn(async (restaurantId: string) => ({
      provider: "tng" as const,
      merchantId: byRestaurant[restaurantId] ?? "TNG-MERCHANT-7788",
      environment: "sandbox" as const,
      secret: { merchantKey: "never-on-the-wire" },
    })),
  };
}

function gatewayStub(response: Partial<ShopWalletGatewayResponse> = {}) {
  const calls: ShopWalletGatewayRequest[] = [];
  const gateway: ShopWalletGateway = vi.fn(async (request) => {
    calls.push(request);
    return {
      providerTransactionId: "tng-txn-1",
      status: "paid",
      providerAmount: request.providerAmount,
      currency: request.currency,
      ...response,
    } as ShopWalletGatewayResponse;
  });
  return { gateway, calls };
}

function splitInput(
  overrides: Partial<MarketCheckoutProviderSplitGatewayInput> = {},
): MarketCheckoutProviderSplitGatewayInput {
  return {
    checkoutId: "checkout-1",
    marketSlug: "jalan-alor",
    method: "shop_wallet:tng",
    country: "MY",
    currency: "MYR",
    idempotencyKey: "idem-1",
    amountCents: 3000,
    allocations: [
      {
        restaurantId: "rest-1",
        restaurantName: "Stall A",
        orderId: "order-1",
        orderNumber: "ORD-1",
        amountCents: 3000,
      },
    ],
    ...overrides,
  };
}

describe("shopWalletProviderFromMethod", () => {
  it.each([
    ["shop_wallet:tng", "tng"],
    ["shop_wallet:grabpay", "grabpay"],
  ])("maps %s to %s", (method, provider) => {
    expect(shopWalletProviderFromMethod(method)).toBe(provider);
    expect(isShopWalletPaymentProvider(method)).toBe(true);
  });

  it.each(["market_online", "credits", "shop_wallet:paypal", "tng", undefined])(
    "does not claim %s",
    (method) => {
      expect(shopWalletProviderFromMethod(method)).toBeNull();
      expect(isShopWalletPaymentProvider(method)).toBe(false);
    },
  );
});

describe("ShopWalletMarketCheckoutGateway", () => {
  it("charges the shop's own wallet with its own credentials", async () => {
    const credentials = credentialsStub();
    const { gateway, calls } = gatewayStub();

    const result = await new ShopWalletMarketCheckoutGateway(
      env,
      "tng",
      gateway,
      credentials,
    ).process(splitInput());

    expect(credentials.loadGatewayCredentials).toHaveBeenCalledWith(
      "rest-1",
      "tng",
    );
    expect(calls[0]).toEqual(
      expect.objectContaining({
        merchantId: "TNG-MERCHANT-7788",
        providerAmount: 3000,
        amountMinor: 3000,
        currencyExponent: 2,
        currency: "MYR",
        idempotencyKey: "idem-1",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: "shop_wallet:tng",
        status: "paid",
        authorizedAmountCents: 3000,
        currency: "MYR",
      }),
    );
    expect(result.allocations).toEqual([
      expect.objectContaining({ orderId: "order-1", amountCents: 3000 }),
    ]);
  });

  it("charges once for several stalls that share one merchant account", async () => {
    const credentials = credentialsStub();
    const { gateway, calls } = gatewayStub();
    const input = splitInput({
      amountCents: 5000,
      allocations: [
        {
          restaurantId: "rest-1",
          restaurantName: "Stall A",
          orderId: "order-1",
          orderNumber: "ORD-1",
          amountCents: 3000,
        },
        {
          restaurantId: "rest-2",
          restaurantName: "Stall B",
          orderId: "order-2",
          orderNumber: "ORD-2",
          amountCents: 2000,
        },
      ],
    });

    const result = await new ShopWalletMarketCheckoutGateway(
      env,
      "tng",
      gateway,
      credentials,
    ).process(input);

    // Every vendor's credential is checked; one charge is sent.
    expect(credentials.loadGatewayCredentials).toHaveBeenCalledTimes(2);
    expect(gateway).toHaveBeenCalledOnce();
    expect(calls[0]?.providerAmount).toBe(5000);
    expect(result.allocations.map((a) => a.amountCents).sort()).toEqual([
      2000, 3000,
    ]);
  });

  it("refuses a cart whose stalls settle into different merchant accounts", async () => {
    const credentials = credentialsStub({ "rest-2": "TNG-MERCHANT-9999" });
    const { gateway } = gatewayStub();
    const input = splitInput({
      amountCents: 5000,
      allocations: [
        {
          restaurantId: "rest-1",
          restaurantName: "Stall A",
          orderId: "order-1",
          orderNumber: "ORD-1",
          amountCents: 3000,
        },
        {
          restaurantId: "rest-2",
          restaurantName: "Stall B",
          orderId: "order-2",
          orderNumber: "ORD-2",
          amountCents: 2000,
        },
      ],
    });

    const error = await new ShopWalletMarketCheckoutGateway(
      env,
      "tng",
      gateway,
      credentials,
    )
      .process(input)
      .catch((e: unknown) => e);

    expect((error as ApiError).code).toBe(
      "SHOP_WALLET_MULTI_MERCHANT_UNSUPPORTED",
    );
    // Both credentials were read to find that out; no money was moved.
    expect(credentials.loadGatewayCredentials).toHaveBeenCalledTimes(2);
    expect(gateway).not.toHaveBeenCalled();
  });

  it("passes a redirect through as pending, with nothing authorized yet", async () => {
    const { gateway } = gatewayStub({
      status: "requires_action",
      providerAmount: undefined,
      currency: undefined,
      nextAction: { type: "redirect", redirectUrl: "https://wallet.test/pay" },
    });

    const result = await new ShopWalletMarketCheckoutGateway(
      env,
      "tng",
      gateway,
      credentialsStub(),
    ).process(splitInput());

    expect(result.status).toBe("requires_action");
    expect(result.authorizedAmountCents).toBe(0);
    expect(result.allocations).toEqual([]);
    expect(result.nextAction?.redirectUrl).toBe("https://wallet.test/pay");
  });

  it("rejects a wallet that authorizes a different amount", async () => {
    const { gateway } = gatewayStub({ providerAmount: 2999, currency: "MYR" });

    const error = await new ShopWalletMarketCheckoutGateway(
      env,
      "tng",
      gateway,
      credentialsStub(),
    )
      .process(splitInput())
      .catch((e: unknown) => e);

    expect((error as ApiError).code).toBe("SHOP_WALLET_AMOUNT_MISMATCH");
  });

  it("rejects a currency it cannot recognise before touching credentials", async () => {
    const credentials = credentialsStub();
    const { gateway } = gatewayStub();

    const error = await new ShopWalletMarketCheckoutGateway(
      env,
      "tng",
      gateway,
      credentials,
    )
      .process(splitInput({ currency: "USD" as never }))
      .catch((e: unknown) => e);

    expect((error as ApiError).code).toBe("SHOP_WALLET_CURRENCY_UNSUPPORTED");
    expect(credentials.loadGatewayCredentials).not.toHaveBeenCalled();
  });
});

describe("refundShopWalletMarketCheckoutPayment", () => {
  const refundInput = {
    checkoutId: "checkout-1",
    paymentId: "market_pay_checkout-1",
    provider: "shop_wallet:tng",
    providerTransactionId: "tng-txn-1",
    idempotencyKey: "idem-1:refund",
    amountCents: 3000,
    currency: "MYR",
    reason: "customer cancelled",
    allocations: [
      {
        restaurantId: "rest-1",
        restaurantName: "Stall A",
        orderId: "order-1",
        orderNumber: "ORD-1",
        amountCents: 3000,
      },
    ],
  };

  it("refunds through the shop's own wallet", async () => {
    const { gateway, calls } = gatewayStub({
      status: "refunded",
      refundId: "tng-refund-1",
    });

    const result = await refundShopWalletMarketCheckoutPayment(
      env,
      refundInput,
      gateway,
      credentialsStub(),
    );

    expect(calls[0]).toEqual(
      expect.objectContaining({
        operation: "refund",
        providerTransactionId: "tng-txn-1",
        providerAmount: 3000,
        reason: "customer cancelled",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: "shop_wallet:tng",
        refundId: "tng-refund-1",
        status: "refunded",
        refundedAmountCents: 3000,
        currency: "MYR",
      }),
    );
  });

  it("refuses to refund a payment that was not taken through a shop wallet", async () => {
    const { gateway } = gatewayStub();
    const error = await refundShopWalletMarketCheckoutPayment(
      env,
      { ...refundInput, provider: "stripe" },
      gateway,
      credentialsStub(),
    ).catch((e: unknown) => e);

    expect((error as ApiError).code).toBe("SHOP_WALLET_PROVIDER_UNSUPPORTED");
    expect(gateway).not.toHaveBeenCalled();
  });
});

describe("httpShopWalletGateway", () => {
  it("never puts the shop's secrets on the wire", async () => {
    const seen: string[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen.push(String(init?.body ?? ""));
      return Response.json({
        providerTransactionId: "txn-1",
        status: "paid",
        providerAmount: 3000,
        currency: "MYR",
      });
    }) as unknown as typeof fetch;

    await new ShopWalletMarketCheckoutGateway(
      env,
      "tng",
      httpShopWalletGateway("https://adapter.test/pay", "token-1", fetcher),
      credentialsStub(),
    ).process(splitInput());

    expect(seen[0]).not.toContain("never-on-the-wire");
    expect(seen[0]).not.toContain("credentials");
    // The merchant id does go, because an adapter has to know which account
    // it is acting for; it identifies without authorising.
    expect(seen[0]).toContain("TNG-MERCHANT-7788");
  });

  it("fails loudly on a non-2xx answer", async () => {
    const fetcher = vi.fn(
      async () => new Response("nope", { status: 503 }),
    ) as unknown as typeof fetch;

    const error = await httpShopWalletGateway(
      "https://adapter.test/pay",
      undefined,
      fetcher,
    )({
      operation: "charge",
      provider: "tng",
      environment: "sandbox",
      merchantId: "M",
      credentials: {},
      reference: "r",
      idempotencyKey: "i",
      providerAmount: 1,
      amountMinor: 1,
      currencyExponent: 2,
      currency: "MYR",
      amountCents: 1,
    }).catch((e: unknown) => e);

    expect((error as ApiError).code).toBe("SHOP_WALLET_GATEWAY_FAILED");
  });

  it("rejects an answer with no usable status", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ providerTransactionId: "txn-1", status: "weird" }),
    ) as unknown as typeof fetch;

    const error = await new ShopWalletMarketCheckoutGateway(
      env,
      "tng",
      httpShopWalletGateway("https://adapter.test/pay", undefined, fetcher),
      credentialsStub(),
    )
      .process(splitInput())
      .catch((e: unknown) => e);

    expect((error as ApiError).code).toBe("SHOP_WALLET_RESPONSE_INVALID");
  });
});

describe("withoutCredentials", () => {
  it("drops the secret and keeps everything else", () => {
    const request: ShopWalletGatewayRequest = {
      operation: "charge",
      provider: "grabpay",
      environment: "production",
      merchantId: "GRAB-1",
      credentials: { clientSecret: "shh" },
      reference: "checkout-1",
      idempotencyKey: "idem-1",
      providerAmount: 1250,
      amountMinor: 1250,
      currencyExponent: 2,
      currency: "MYR",
      amountCents: 1250,
    };

    const wire = withoutCredentials(request);
    expect(wire).not.toHaveProperty("credentials");
    expect(wire).toEqual(
      expect.objectContaining({ merchantId: "GRAB-1", providerAmount: 1250 }),
    );
  });
});

describe("createShopWalletGateway", () => {
  it("falls back to the not-implemented gateway when no adapter URL is set", async () => {
    const error = await createShopWalletGateway({} as Env)({
      operation: "charge",
      provider: "tng",
      environment: "sandbox",
      merchantId: "M",
      credentials: {},
      reference: "r",
      idempotencyKey: "i",
      providerAmount: 1,
      amountMinor: 1,
      currencyExponent: 2,
      currency: "MYR",
      amountCents: 1,
    }).catch((e: unknown) => e);

    expect((error as ApiError).code).toBe(
      "SHOP_WALLET_GATEWAY_NOT_IMPLEMENTED",
    );
  });
});
