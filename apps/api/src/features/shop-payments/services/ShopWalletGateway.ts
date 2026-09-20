/**
 * The seam between MakanMasak and a shop's own e-wallet.
 *
 * Everything on our side of this file is written and tested: resolving the
 * shop's credentials, converting money into the provider's unit, checking what
 * comes back. Everything on the far side — the actual HTTP call to Touch 'n Go
 * or GrabPay — is a single injected function, because nobody has sandbox
 * credentials for either wallet yet and speculative request-building would be
 * code that has never been run against the thing it claims to talk to.
 *
 * ## Implementing the real call
 *
 * Write a `ShopWalletGateway` and pass it to `ShopWalletPaymentAdapter`. It
 * receives a fully-built, fully-converted request and returns the provider's
 * answer in the same vocabulary; the adapter verifies amount and currency
 * before anything is treated as paid. What the implementation still owes:
 *
 * - **Endpoint + auth.** Per provider and per `environment`
 *   (`sandbox` | `production`). The credentials arrive decrypted in
 *   `request.credentials`; they must not be logged, echoed into an error
 *   message, or attached to a trace.
 * - **Webhook signature verification.** Wallets confirm asynchronously.
 *   `credentials.webhookSecret` is the shop's own callback secret, so
 *   verification is per-shop — resolve the credential from the merchant id in
 *   the callback, then verify. Never trust a callback body before that.
 * - **The unit rule.** `request.providerAmount` is what this repo believes the
 *   provider's `amount` field takes, derived from
 *   `PROVIDER_AMOUNT_FACTORS` in `shared/utils/provider-money.ts`. Both wallet
 *   rows there are **UNVERIFIED** (see that file's header) — corroborated only
 *   by third-party resellers, not by either provider's own contract. Confirm
 *   sen-versus-ringgit against the sandbox contract you are actually issued
 *   and correct the factor before the first real charge. A wrong factor is a
 *   100× error and nothing downstream can detect it.
 * - **Idempotency.** `request.idempotencyKey` is stable per operation; put it
 *   wherever the provider takes one so a retry cannot double-charge.
 *
 * Provider references, such as they are:
 * - Touch 'n Go eWallet: merchant onboarding at
 *   https://www.touchngo.com.my/merchant/ ; the only public TNG Digital
 *   developer site is https://miniprogram.tngdigital.com.my/docs/ , which
 *   covers the in-wallet Mini Program runtime rather than a merchant API.
 * - GrabPay: https://developer.grab.com/docs/grabpay/ (partner credentials
 *   required to read past the overview).
 */
import {
  ISO_4217_EXPONENTS,
  centsToIsoMinorUnits,
  centsToProviderAmount,
  providerAmountToCents,
  verifyProviderMoney,
  type ProviderMoneyIssue,
} from "../../../shared/utils/provider-money";
import type { CurrencyCode } from "@makanmasak/utils";
import { ApiError } from "../../../shared/utils/api-error";
import type {
  ShopPaymentEnvironment,
  ShopPaymentProvider,
  ShopWalletSecretPayload,
} from "../types";

export type ShopWalletOperation = "charge" | "refund" | "status";

/** Where the customer is sent, when the wallet confirms out of band. */
export interface ShopWalletNextAction {
  type: "redirect" | "client_secret" | "sdk_confirmation";
  redirectUrl?: string;
  clientSecret?: string;
  expiresAt?: string;
  providerPayload?: Record<string, unknown>;
}

/**
 * One request to a shop's wallet. Money has already been converted and
 * checked; the gateway's job is transport, not arithmetic.
 */
export interface ShopWalletGatewayRequest {
  operation: ShopWalletOperation;
  provider: ShopPaymentProvider;
  environment: ShopPaymentEnvironment;
  /** The shop's merchant account at the provider. */
  merchantId: string;
  /** Decrypted. Never log, echo or serialize this into an error. */
  credentials: ShopWalletSecretPayload;
  /** Our identifier for the thing being paid (checkout id, payment id). */
  reference: string;
  idempotencyKey: string;
  /**
   * The number to place in the provider's own `amount` field, in the
   * provider's unit. Derived through `PROVIDER_AMOUNT_FACTORS`.
   */
  providerAmount: number;
  /**
   * The same amount in ISO 4217 minor units, with its exponent — this repo's
   * wire convention (see the market-checkout adapter runbook). For MYR the two
   * numbers coincide; they do not for every currency, which is why both are
   * carried rather than one being inferred.
   */
  amountMinor: number;
  currencyExponent: number;
  currency: CurrencyCode;
  /** Internal cents, for logging and reconciliation. Never sent as-is. */
  amountCents: number;
  /** Set on refunds and status lookups once the provider has an id for it. */
  providerTransactionId?: string;
  returnUrl?: string;
  reason?: string;
  metadata?: Record<string, string>;
}

/**
 * What the provider said. `providerAmount` is read back in the provider's own
 * unit and converted here, so a provider that answers in a different unit than
 * it was asked in is caught rather than believed.
 */
export interface ShopWalletGatewayResponse {
  providerTransactionId: string;
  status: "paid" | "pending" | "requires_action" | "failed" | "refunded";
  providerAmount?: number;
  currency?: string;
  refundId?: string;
  nextAction?: ShopWalletNextAction;
  providerPayload?: Record<string, unknown>;
}

/** The single injected call. Fake in tests, real HTTP in production. */
export type ShopWalletGateway = (
  request: ShopWalletGatewayRequest,
) => Promise<ShopWalletGatewayResponse>;

/**
 * Thrown by the default gateway. Not a generic "not implemented": it names the
 * provider and where to go and read, because the thing that hits it is a
 * deployment with a wallet connected and no adapter wired up.
 */
export class ShopWalletGatewayNotImplementedError extends ApiError {
  constructor(provider: ShopPaymentProvider, operation: ShopWalletOperation) {
    super(
      "SHOP_WALLET_GATEWAY_NOT_IMPLEMENTED",
      `No ${provider} gateway is wired up for ${operation}. ` +
        `Implement ShopWalletGateway against ${PROVIDER_DOC_URLS[provider]} ` +
        "and confirm the amount unit before enabling live payments.",
      501,
      { provider, operation, docUrl: PROVIDER_DOC_URLS[provider] },
    );
  }
}

export const PROVIDER_DOC_URLS: Record<ShopPaymentProvider, string> = {
  tng: "https://www.touchngo.com.my/merchant/",
  grabpay: "https://developer.grab.com/docs/grabpay/",
};

/** The gateway a deployment gets until somebody writes the real one. */
export const notImplementedShopWalletGateway: ShopWalletGateway = (request) => {
  return Promise.reject(
    new ShopWalletGatewayNotImplementedError(
      request.provider,
      request.operation,
    ),
  );
};

export interface ShopWalletOperationInput {
  reference: string;
  idempotencyKey: string;
  amountCents: number;
  currency: CurrencyCode;
  providerTransactionId?: string;
  returnUrl?: string;
  reason?: string;
  metadata?: Record<string, string>;
}

export interface ShopWalletSettlement {
  providerTransactionId: string;
  status: ShopWalletGatewayResponse["status"];
  /** Present once the provider has committed to an amount. */
  amountCents?: number;
  currency?: string;
  refundId?: string;
  nextAction?: ShopWalletNextAction;
}

/**
 * Turns an amount in internal cents into a provider call and back again.
 *
 * The adapter, not the gateway, owns every money decision: the conversion out,
 * the conversion back, and the comparison between them. A gateway that returns
 * a different amount or a different currency than it was asked for produces a
 * `SHOP_WALLET_AMOUNT_MISMATCH` here and never reaches a "paid" write.
 */
export class ShopWalletPaymentAdapter {
  constructor(
    private readonly connection: {
      provider: ShopPaymentProvider;
      environment: ShopPaymentEnvironment;
      merchantId: string;
      secret: ShopWalletSecretPayload;
    },
    private readonly gateway: ShopWalletGateway = notImplementedShopWalletGateway,
  ) {}

  charge(input: ShopWalletOperationInput): Promise<ShopWalletSettlement> {
    return this.run("charge", input, "exact");
  }

  /**
   * A refund may come back for less than was asked (a partial the provider
   * capped), never for more, so it is verified `at_most`.
   */
  refund(input: ShopWalletOperationInput): Promise<ShopWalletSettlement> {
    return this.run("refund", input, "at_most");
  }

  status(input: ShopWalletOperationInput): Promise<ShopWalletSettlement> {
    return this.run("status", input, "exact");
  }

  private async run(
    operation: ShopWalletOperation,
    input: ShopWalletOperationInput,
    mode: "exact" | "at_most",
  ): Promise<ShopWalletSettlement> {
    const request = this.buildRequest(operation, input);
    const response = await this.gateway(request);

    if (!response.providerTransactionId) {
      throw new ApiError(
        "SHOP_WALLET_RESPONSE_INVALID",
        `${this.connection.provider} returned no transaction id`,
        502,
        { provider: this.connection.provider, operation },
      );
    }

    // Nothing has moved yet on these, so there is no amount to check.
    if (
      response.status === "pending" ||
      response.status === "requires_action"
    ) {
      return {
        providerTransactionId: response.providerTransactionId,
        status: response.status,
        nextAction: response.nextAction,
      };
    }
    if (response.status === "failed") {
      return {
        providerTransactionId: response.providerTransactionId,
        status: "failed",
      };
    }

    const settledCents = this.readSettledCents(operation, response);
    const issue = verifyProviderMoney({
      expectedCents: input.amountCents,
      expectedCurrency: input.currency,
      receivedCents: settledCents,
      receivedCurrency: response.currency,
      mode,
    });
    if (issue) throw amountMismatch(this.connection.provider, operation, issue);

    return {
      providerTransactionId: response.providerTransactionId,
      status: response.status,
      amountCents: settledCents,
      currency: response.currency,
      refundId: response.refundId,
      nextAction: response.nextAction,
    };
  }

  /** Exposed so tests and the runbook can show exactly what goes on the wire. */
  buildRequest(
    operation: ShopWalletOperation,
    input: ShopWalletOperationInput,
  ): ShopWalletGatewayRequest {
    const { provider, environment, merchantId, secret } = this.connection;
    // Both conversions refuse rather than round: an amount off the currency's
    // step, or a currency this wallet does not settle, throws here instead of
    // becoming a charge for the wrong money.
    const providerAmount = centsToProviderAmount(
      provider,
      input.currency,
      input.amountCents,
    );
    return {
      operation,
      provider,
      environment,
      merchantId,
      credentials: secret,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      providerAmount,
      amountMinor: centsToIsoMinorUnits(input.amountCents, input.currency),
      currencyExponent: ISO_4217_EXPONENTS[input.currency],
      currency: input.currency,
      amountCents: input.amountCents,
      ...(input.providerTransactionId
        ? { providerTransactionId: input.providerTransactionId }
        : {}),
      ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
  }

  /**
   * The provider's number, back in internal cents.
   *
   * `providerAmountToCents` is what makes a provider answering in ringgit
   * while we asked in sen visible: it multiplies by the same factor the
   * request divided by, so the two only agree when the unit did.
   */
  private readSettledCents(
    operation: ShopWalletOperation,
    response: ShopWalletGatewayResponse,
  ): number | undefined {
    if (response.providerAmount === undefined) return undefined;
    const converted = providerAmountToCents(
      this.connection.provider,
      response.currency,
      response.providerAmount,
    );
    if (!converted.ok) {
      throw amountMismatch(
        this.connection.provider,
        operation,
        converted.issue,
      );
    }
    return converted.cents;
  }
}

function amountMismatch(
  provider: ShopPaymentProvider,
  operation: ShopWalletOperation,
  issue: ProviderMoneyIssue,
): ApiError {
  return new ApiError(
    issue.code.startsWith("CURRENCY_")
      ? "SHOP_WALLET_CURRENCY_MISMATCH"
      : "SHOP_WALLET_AMOUNT_MISMATCH",
    `${provider} ${operation} response does not match what was requested`,
    502,
    { provider, operation, reason: issue.code, detail: issue.message },
  );
}
