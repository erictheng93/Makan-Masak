import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/utils/api-error";
import {
  PROVIDER_DOC_URLS,
  ShopWalletPaymentAdapter,
  notImplementedShopWalletGateway,
  type ShopWalletGateway,
  type ShopWalletGatewayRequest,
  type ShopWalletGatewayResponse,
} from "./ShopWalletGateway";

function buildConnection(overrides: Record<string, unknown> = {}) {
  return {
    provider: "tng" as const,
    environment: "sandbox" as const,
    merchantId: "MERCHANT-7788",
    secret: { merchantKey: "live-key-do-not-leak" },
    ...overrides,
  };
}

function buildInput(overrides: Record<string, unknown> = {}) {
  return {
    reference: "checkout-1",
    idempotencyKey: "idem-1",
    amountCents: 1250,
    currency: "MYR" as const,
    ...overrides,
  };
}

/** A gateway that records what it was handed and answers with what it is told. */
function stubGateway(response: Partial<ShopWalletGatewayResponse> = {}) {
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

describe("ShopWalletPaymentAdapter request building", () => {
  it("converts internal cents into the provider's unit and the ISO minor unit", async () => {
    const { gateway, calls } = stubGateway();
    // RM12.50 = 1250 internal cents. MYR is ISO exponent 2 and both wallets
    // are recorded as sen-based, so all three numbers coincide here — which is
    // exactly why the assertion names each one separately.
    await new ShopWalletPaymentAdapter(buildConnection(), gateway).charge(
      buildInput(),
    );

    expect(gateway).toHaveBeenCalledOnce();
    expect(calls[0]).toEqual(
      expect.objectContaining({
        operation: "charge",
        provider: "tng",
        environment: "sandbox",
        merchantId: "MERCHANT-7788",
        providerAmount: 1250,
        amountMinor: 1250,
        currencyExponent: 2,
        currency: "MYR",
        amountCents: 1250,
        idempotencyKey: "idem-1",
        reference: "checkout-1",
      }),
    );
  });

  it("hands the decrypted secret to the injected gateway and nowhere else", async () => {
    const { gateway, calls } = stubGateway();
    await new ShopWalletPaymentAdapter(buildConnection(), gateway).charge(
      buildInput(),
    );

    expect(calls[0]?.credentials).toEqual({
      merchantKey: "live-key-do-not-leak",
    });
  });

  it("refuses a currency the wallet does not settle instead of converting it", async () => {
    const { gateway } = stubGateway();
    await expect(
      new ShopWalletPaymentAdapter(buildConnection(), gateway).charge(
        buildInput({ currency: "TWD", amountCents: 25000 }),
      ),
    ).rejects.toThrow(/does not settle TWD/);
    expect(gateway).not.toHaveBeenCalled();
  });

  it("refuses an amount that is not on the currency's step", async () => {
    const { gateway } = stubGateway();
    await expect(
      new ShopWalletPaymentAdapter(
        buildConnection({ provider: "grabpay" }),
        gateway,
      ).charge(buildInput({ amountCents: 12.5 })),
    ).rejects.toThrow(/not aligned to the MYR step|not a whole grabpay amount/);
    expect(gateway).not.toHaveBeenCalled();
  });
});

describe("ShopWalletPaymentAdapter response verification", () => {
  it("converts the provider's amount back to cents and accepts an exact match", async () => {
    const { gateway } = stubGateway({ providerAmount: 1250, currency: "MYR" });
    const settlement = await new ShopWalletPaymentAdapter(
      buildConnection(),
      gateway,
    ).charge(buildInput());

    expect(settlement).toEqual(
      expect.objectContaining({
        providerTransactionId: "tng-txn-1",
        status: "paid",
        amountCents: 1250,
        currency: "MYR",
      }),
    );
  });

  it("rejects a wrong amount", async () => {
    const { gateway } = stubGateway({ providerAmount: 1249, currency: "MYR" });
    const error = await new ShopWalletPaymentAdapter(buildConnection(), gateway)
      .charge(buildInput())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("SHOP_WALLET_AMOUNT_MISMATCH");
  });

  it("rejects a wrong currency even when the number matches", async () => {
    const { gateway } = stubGateway({ providerAmount: 1250, currency: "TWD" });
    const error = await new ShopWalletPaymentAdapter(buildConnection(), gateway)
      .charge(buildInput())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("SHOP_WALLET_CURRENCY_MISMATCH");
  });

  it("rejects a completed settlement that reports no currency at all", async () => {
    const { gateway } = stubGateway({
      providerAmount: 1250,
      currency: undefined,
    });
    const error = await new ShopWalletPaymentAdapter(buildConnection(), gateway)
      .charge(buildInput())
      .catch((e: unknown) => e);

    expect((error as ApiError).code).toBe("SHOP_WALLET_CURRENCY_MISMATCH");
  });

  it("rejects a response with no transaction id", async () => {
    const gateway: ShopWalletGateway = vi.fn(async () => ({
      providerTransactionId: "",
      status: "paid" as const,
      providerAmount: 1250,
      currency: "MYR",
    }));
    const error = await new ShopWalletPaymentAdapter(buildConnection(), gateway)
      .charge(buildInput())
      .catch((e: unknown) => e);

    expect((error as ApiError).code).toBe("SHOP_WALLET_RESPONSE_INVALID");
    expect(gateway).toHaveBeenCalledOnce();
  });

  it("passes a pending answer through without checking an amount nobody committed to", async () => {
    const { gateway } = stubGateway({
      status: "requires_action",
      providerAmount: undefined,
      currency: undefined,
      nextAction: { type: "redirect", redirectUrl: "https://wallet.test/pay" },
    });
    const settlement = await new ShopWalletPaymentAdapter(
      buildConnection(),
      gateway,
    ).charge(buildInput());

    expect(settlement.status).toBe("requires_action");
    expect(settlement.amountCents).toBeUndefined();
    expect(settlement.nextAction?.redirectUrl).toBe("https://wallet.test/pay");
  });

  it("allows a refund for less than was asked but not for more", async () => {
    const under = stubGateway({
      status: "refunded",
      providerAmount: 500,
      currency: "MYR",
      refundId: "refund-1",
    });
    const partial = await new ShopWalletPaymentAdapter(
      buildConnection(),
      under.gateway,
    ).refund(buildInput());
    expect(partial).toEqual(
      expect.objectContaining({ amountCents: 500, refundId: "refund-1" }),
    );

    const over = stubGateway({
      status: "refunded",
      providerAmount: 1251,
      currency: "MYR",
    });
    const error = await new ShopWalletPaymentAdapter(
      buildConnection(),
      over.gateway,
    )
      .refund(buildInput())
      .catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("SHOP_WALLET_AMOUNT_MISMATCH");
  });

  it("checks a status lookup against the payment the same way a charge is checked", async () => {
    const { gateway, calls } = stubGateway({
      providerAmount: 1250,
      currency: "MYR",
    });
    const settlement = await new ShopWalletPaymentAdapter(
      buildConnection(),
      gateway,
    ).status(buildInput({ providerTransactionId: "tng-txn-1" }));

    expect(calls[0]).toEqual(
      expect.objectContaining({
        operation: "status",
        providerTransactionId: "tng-txn-1",
      }),
    );
    expect(settlement.amountCents).toBe(1250);
  });
});

describe("notImplementedShopWalletGateway", () => {
  it.each(["tng", "grabpay"] as const)(
    "names the %s documentation instead of failing anonymously",
    async (provider) => {
      const error = await new ShopWalletPaymentAdapter(
        buildConnection({ provider }),
        notImplementedShopWalletGateway,
      )
        .charge(buildInput())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(
        "SHOP_WALLET_GATEWAY_NOT_IMPLEMENTED",
      );
      expect((error as ApiError).message).toContain(
        PROVIDER_DOC_URLS[provider],
      );
    },
  );
});
