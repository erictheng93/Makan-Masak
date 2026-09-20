/**
 * Plugs a shop's own e-wallet into the market-checkout payment flow.
 *
 * `ProviderSplitMarketCheckoutPaymentProvider` already does the parts that are
 * the same whatever the gateway is — summing allocations, refusing an amount
 * off the currency's step, checking the authorized total. All this module adds
 * is "which shop's wallet, and with whose credentials", so the edit inside
 * `createMarketCheckoutPaymentProvider` stays to one branch.
 *
 * **One merchant account per charge.** A market checkout is multi-vendor by
 * construction (`createMarketCheckoutSchema` requires at least two), and a
 * wallet charge settles into exactly one merchant account. That is fine while
 * every vendor in the cart has connected the *same* account — one operator
 * running several stalls, which is the ordinary night-market case. Vendors with
 * different merchant accounts would need two authorizations and two customer
 * redirects against one payment row, which this contract cannot express, so
 * that cart is refused rather than settled into whichever account came first.
 * A mixed-merchant cart needs the platform adapter.
 */
import type { Env } from "../../../types/env";
import { ApiError } from "../../../shared/utils/api-error";
import { normalizeCurrencyCode } from "@makanmasak/utils";
import type {
  MarketCheckoutProviderSplitGateway,
  MarketCheckoutProviderSplitGatewayInput,
  MarketCheckoutProviderSplitGatewayResult,
  MarketCheckoutProviderSplitRefundInput,
  MarketCheckoutProviderSplitRefundResult,
} from "../../market-checkouts/services/MarketCheckoutPaymentProvider";
import {
  ShopPaymentCredentialService,
  type ShopWalletGatewayCredentials,
} from "./ShopPaymentCredentialService";
import {
  ShopWalletPaymentAdapter,
  notImplementedShopWalletGateway,
  type ShopWalletGateway,
  type ShopWalletGatewayRequest,
  type ShopWalletGatewayResponse,
} from "./ShopWalletGateway";
import { isShopPaymentProvider, type ShopPaymentProvider } from "../types";

/**
 * Market-checkout `method` values that mean "charge the shop's own wallet".
 * The method is the provider name, so `shop_wallet:tng` reads the same in a
 * request body, a stored payment row and a log line.
 */
export const SHOP_WALLET_METHOD_PREFIX = "shop_wallet:";

/** `"shop_wallet:tng"` → `"tng"`; anything else → null. */
export function shopWalletProviderFromMethod(
  method: string | undefined,
): ShopPaymentProvider | null {
  if (!method?.startsWith(SHOP_WALLET_METHOD_PREFIX)) return null;
  const provider = method.slice(SHOP_WALLET_METHOD_PREFIX.length);
  return isShopPaymentProvider(provider) ? provider : null;
}

/**
 * Whether a stored payment row was taken through a shop wallet. Refunds
 * dispatch on this: a shop-wallet charge must be refunded from the shop's own
 * account, never through the platform's shared adapter.
 */
export function isShopWalletPaymentProvider(
  provider: string | undefined,
): provider is string {
  return shopWalletProviderFromMethod(provider) !== null;
}

function providerName(provider: ShopPaymentProvider): string {
  return `${SHOP_WALLET_METHOD_PREFIX}${provider}`;
}

function requireCurrency(currency: string) {
  const normalized = normalizeCurrencyCode(currency);
  if (!normalized) {
    throw new ApiError(
      "SHOP_WALLET_CURRENCY_UNSUPPORTED",
      `Shop wallet payments cannot settle ${String(currency)}`,
      400,
      { currency },
    );
  }
  return normalized;
}

/**
 * The one merchant account every vendor in this cart is paid through.
 *
 * Each vendor's credential is loaded on its own — a vendor that has not
 * connected the wallet, or has disabled it, fails here rather than being
 * quietly charged to a neighbour's account — and then all of them must agree
 * on provider, merchant id and environment.
 */
async function resolveSharedMerchantAccount(
  credentials: Pick<ShopPaymentCredentialService, "loadGatewayCredentials">,
  provider: ShopPaymentProvider,
  allocations: ReadonlyArray<{ restaurantId: string }>,
): Promise<ShopWalletGatewayCredentials> {
  const restaurantIds = [...new Set(allocations.map((a) => a.restaurantId))];
  if (restaurantIds.length === 0) {
    throw new ApiError(
      "SHOP_WALLET_NO_VENDORS",
      "A shop wallet charge needs at least one vendor",
      400,
    );
  }

  const connections = await Promise.all(
    restaurantIds.map((id) => credentials.loadGatewayCredentials(id, provider)),
  );
  const first = connections[0]!;
  const differs = connections.some(
    (c) =>
      c.merchantId !== first.merchantId || c.environment !== first.environment,
  );
  if (differs) {
    throw new ApiError(
      "SHOP_WALLET_MULTI_MERCHANT_UNSUPPORTED",
      "Every vendor in one checkout must be paid through the same merchant account",
      409,
      { provider, restaurantIds },
    );
  }
  return first;
}

export class ShopWalletMarketCheckoutGateway implements MarketCheckoutProviderSplitGateway {
  constructor(
    private readonly env: Env,
    private readonly provider: ShopPaymentProvider,
    private readonly gateway: ShopWalletGateway = notImplementedShopWalletGateway,
    private readonly credentials = new ShopPaymentCredentialService(env),
  ) {}

  async process(
    input: MarketCheckoutProviderSplitGatewayInput,
  ): Promise<MarketCheckoutProviderSplitGatewayResult> {
    const currency = requireCurrency(input.currency);
    const connection = await resolveSharedMerchantAccount(
      this.credentials,
      this.provider,
      input.allocations,
    );
    const adapter = new ShopWalletPaymentAdapter(connection, this.gateway);

    const settlement = await adapter.charge({
      reference: input.checkoutId,
      idempotencyKey: input.idempotencyKey,
      amountCents: input.amountCents,
      currency,
      metadata: {
        marketSlug: input.marketSlug,
        vendorCount: String(
          new Set(input.allocations.map((a) => a.restaurantId)).size,
        ),
      },
    });

    const provider = providerName(this.provider);
    if (settlement.status !== "paid") {
      return {
        provider,
        providerTransactionId: settlement.providerTransactionId,
        // Anything short of a completed authorization leaves the payment
        // pending; a webhook or reconciliation decides the final state. A
        // charge has no business answering "refunded", so it is not given a
        // path that would record one.
        status:
          settlement.status === "requires_action"
            ? "requires_action"
            : "pending",
        authorizedAmountCents: 0,
        allocations: [],
        nextAction: settlement.nextAction,
      };
    }

    // `paid` synchronously: the adapter has already checked that the wallet
    // authorized this exact amount in this exact currency.
    return {
      provider,
      providerTransactionId: settlement.providerTransactionId,
      status: "paid",
      authorizedAmountCents: settlement.amountCents ?? input.amountCents,
      currency: settlement.currency ?? currency,
      allocations: input.allocations.map((allocation) => ({
        orderId: allocation.orderId,
        paymentId: `${settlement.providerTransactionId}:${allocation.orderId}`,
        amountCents: allocation.amountCents,
      })),
    };
  }
}

/**
 * Refund a shop-wallet market checkout through that shop's own wallet.
 *
 * Same shape as `refundMarketCheckoutProviderSplitPayment` so the route's
 * downstream ledger handling is untouched.
 */
export async function refundShopWalletMarketCheckoutPayment(
  env: Env,
  input: MarketCheckoutProviderSplitRefundInput,
  gateway: ShopWalletGateway = createShopWalletGateway(env),
  credentials = new ShopPaymentCredentialService(env),
): Promise<MarketCheckoutProviderSplitRefundResult> {
  const provider = shopWalletProviderFromMethod(input.provider);
  if (!provider) {
    throw new ApiError(
      "SHOP_WALLET_PROVIDER_UNSUPPORTED",
      `${input.provider} is not a shop wallet payment`,
      409,
      { provider: input.provider },
    );
  }
  const currency = requireCurrency(input.currency ?? "");
  const connection = await resolveSharedMerchantAccount(
    credentials,
    provider,
    input.allocations,
  );

  const settlement = await new ShopWalletPaymentAdapter(
    connection,
    gateway,
  ).refund({
    reference: input.checkoutId,
    idempotencyKey: input.idempotencyKey ?? `${input.paymentId}:refund`,
    amountCents: input.amountCents,
    currency,
    providerTransactionId: input.providerTransactionId,
    reason: input.reason,
  });

  return {
    provider: providerName(provider),
    providerTransactionId: settlement.providerTransactionId,
    refundId: settlement.refundId ?? settlement.providerTransactionId,
    status: settlement.status === "refunded" ? "refunded" : "pending",
    refundedAmountCents: settlement.amountCents ?? 0,
    currency: settlement.currency ?? currency,
    eventType: "market_checkout.payment_refunded",
  };
}

/**
 * The gateway a deployment actually gets.
 *
 * With `SHOP_WALLET_GATEWAY_URL` set it posts the built request to that URL —
 * the seam the local fake provider and the integration tests use. Without it,
 * every operation fails with `ShopWalletGatewayNotImplementedError`, which is
 * the honest state until somebody writes the provider call.
 */
export function createShopWalletGateway(env: Env): ShopWalletGateway {
  if (!env.SHOP_WALLET_GATEWAY_URL) return notImplementedShopWalletGateway;
  return httpShopWalletGateway(
    env.SHOP_WALLET_GATEWAY_URL,
    env.SHOP_WALLET_GATEWAY_TOKEN,
  );
}

/**
 * Posts the built request to an out-of-process adapter.
 *
 * **The shop's decrypted secrets are stripped from the body.** An adapter
 * running somewhere else has no business receiving a merchant's keys over
 * HTTP, and the secret-storage rule does not stop applying because the secret
 * is in flight rather than at rest; it gets the merchant id, which identifies
 * the account without authorising anything, and must hold its own credentials
 * for it. A gateway that legitimately needs the keys is an in-process function
 * — that is what the `ShopWalletGateway` argument is for.
 */
export function httpShopWalletGateway(
  endpoint: string,
  bearerToken?: string,
  fetcher: typeof fetch = fetch,
): ShopWalletGateway {
  return async (request) => {
    const call = fetcher;
    const response = await call(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      },
      body: JSON.stringify(withoutCredentials(request)),
    });
    if (!response.ok) {
      throw new ApiError(
        "SHOP_WALLET_GATEWAY_FAILED",
        `Shop wallet gateway failed: ${response.status}`,
        502,
        { provider: request.provider, status: response.status },
      );
    }
    return parseGatewayResponse(
      (await response.json()) as Partial<ShopWalletGatewayResponse>,
    );
  };
}

/** Exported so a test can assert directly that no secret crosses the wire. */
export function withoutCredentials(
  request: ShopWalletGatewayRequest,
): Omit<ShopWalletGatewayRequest, "credentials"> {
  const { credentials: _secret, ...rest } = request;
  return rest;
}

function parseGatewayResponse(
  payload: Partial<ShopWalletGatewayResponse>,
): ShopWalletGatewayResponse {
  const status = payload.status;
  if (
    typeof payload.providerTransactionId !== "string" ||
    payload.providerTransactionId.length === 0 ||
    !isGatewayStatus(status)
  ) {
    throw new ApiError(
      "SHOP_WALLET_RESPONSE_INVALID",
      "Shop wallet gateway response is invalid",
      502,
    );
  }
  if (
    payload.providerAmount !== undefined &&
    typeof payload.providerAmount !== "number"
  ) {
    throw new ApiError(
      "SHOP_WALLET_RESPONSE_INVALID",
      "Shop wallet gateway returned a non-numeric amount",
      502,
    );
  }
  return {
    providerTransactionId: payload.providerTransactionId,
    status,
    providerAmount: payload.providerAmount,
    currency:
      typeof payload.currency === "string" ? payload.currency : undefined,
    refundId:
      typeof payload.refundId === "string" ? payload.refundId : undefined,
    nextAction: payload.nextAction,
    providerPayload: payload.providerPayload,
  };
}

function isGatewayStatus(
  value: unknown,
): value is ShopWalletGatewayResponse["status"] {
  return (
    value === "paid" ||
    value === "pending" ||
    value === "requires_action" ||
    value === "failed" ||
    value === "refunded"
  );
}
