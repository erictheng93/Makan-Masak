import type { Env } from "../../../types/env";
import { CreditService } from "../../credits/services/CreditService";
import { isFeatureEnabled } from "../../../shared/feature-adoption";
import { normalizeCurrencyCode } from "@makanmasak/utils";
import {
  ISO_4217_EXPONENTS,
  assertCurrencyAlignedCents,
  centsToIsoMinorUnits,
  verifyProviderMoney,
  type ProviderMoneyIssue,
} from "../../../shared/utils/provider-money";

export type MarketCheckoutChildPaymentStatus = "paid" | "failed" | "refunded";
export type MarketCheckoutSplitMode = "child_transactions" | "provider_split";
export type MarketCheckoutPaymentProviderReadiness =
  | "ready"
  | "warning"
  | "not_configured";
export type MarketCheckoutProviderAdapterOperation =
  | "create_payment"
  | "status_lookup"
  | "webhook_verification"
  | "refund";

export const MARKET_CHECKOUT_PROVIDER_ADAPTER_OPERATIONS = [
  "create_payment",
  "status_lookup",
  "webhook_verification",
  "refund",
] as const satisfies readonly MarketCheckoutProviderAdapterOperation[];

export interface MarketCheckoutPaymentChildOrder {
  restaurantId: string;
  restaurantName: string;
  orderId: string;
  orderNumber: string;
  totalAmount: number;
  /** Integer cents; preferred over `totalAmount` whenever present. */
  totalAmountCents?: number | null;
}

/**
 * A child order's amount in integer cents: the stored cents column when there
 * is one, and only otherwise the legacy float `totalAmount`.
 */
export function childOrderAmountCents(child: {
  totalAmount?: number | null;
  totalAmountCents?: number | null;
}): number {
  if (child.totalAmountCents != null) return Number(child.totalAmountCents);
  return Math.round(Number(child.totalAmount ?? 0) * 100);
}

export interface MarketCheckoutChildPayment {
  restaurantId: string;
  restaurantName: string;
  orderId: string;
  orderNumber: string;
  paymentId?: string;
  refundId?: string;
  status: MarketCheckoutChildPaymentStatus;
  amount: number;
  amountCents: number;
  errorMessage?: string;
}

export interface MarketCheckoutPaymentProviderInput {
  checkoutId: string;
  marketSlug: string;
  childOrders: MarketCheckoutPaymentChildOrder[];
  existingChildPayments?: MarketCheckoutChildPayment[];
  method: string;
  country: "TW" | "MY" | "VN";
  currency: "TWD" | "MYR" | "VND";
  customerInfo?: unknown;
  providerInput?: Record<string, unknown>;
  requestIdempotencyKey?: string;
}

export interface MarketCheckoutPaymentProviderResult {
  provider: string;
  splitMode: MarketCheckoutSplitMode;
  idempotencyKey: string;
  paymentStatus?: "paid" | "pending";
  childPayments: MarketCheckoutChildPayment[];
  providerTransactionId?: string;
  nextAction?: MarketCheckoutProviderNextAction;
}

export interface MarketCheckoutPaymentProvider {
  process(
    input: MarketCheckoutPaymentProviderInput,
  ): Promise<MarketCheckoutPaymentProviderResult>;
}

export interface MarketCheckoutPaymentProviderStatus {
  splitMode: MarketCheckoutSplitMode;
  readiness: MarketCheckoutPaymentProviderReadiness;
  providerKind: "internal_child_transactions" | "http_provider_split";
  providerSplitUrlConfigured: boolean;
  providerSplitHealthUrlConfigured: boolean;
  providerStatusUrlConfigured: boolean;
  providerRefundUrlConfigured: boolean;
  providerSplitTokenConfigured: boolean;
  providerSplitSigningConfigured: boolean;
  providerWebhookSecretConfigured: boolean;
  capabilities: string[];
  missingConfiguration: string[];
  notes: string[];
}

export interface MarketCheckoutPaymentProviderConnectivityCheck {
  status: "passed" | "skipped" | "failed";
  checkedAt: string;
  splitMode: MarketCheckoutSplitMode;
  target?: string;
  message: string;
  responseStatus?: number;
  capabilities?: string[];
}

export interface MarketCheckoutProviderSplitAllocation {
  restaurantId: string;
  restaurantName: string;
  orderId: string;
  orderNumber: string;
  amountCents: number;
}

export interface MarketCheckoutProviderSplitGatewayInput {
  checkoutId: string;
  marketSlug: string;
  method: string;
  country: "TW" | "MY" | "VN";
  currency: "TWD" | "MYR" | "VND";
  idempotencyKey: string;
  amountCents: number;
  customerInfo?: unknown;
  providerInput?: Record<string, unknown>;
  allocations: MarketCheckoutProviderSplitAllocation[];
}

export interface MarketCheckoutProviderSplitGatewayResult {
  provider: string;
  providerTransactionId: string;
  status?: "paid" | "pending" | "requires_action";
  authorizedAmountCents: number;
  /** Required on `paid`: the currency the provider actually authorized. */
  currency?: string;
  allocations: Array<
    Pick<MarketCheckoutProviderSplitAllocation, "orderId"> & {
      paymentId?: string;
      amountCents: number;
    }
  >;
  nextAction?: MarketCheckoutProviderNextAction;
}

export interface MarketCheckoutProviderSplitStatusInput {
  checkoutId: string;
  paymentId: string;
  provider: string;
  providerTransactionId?: string;
  idempotencyKey?: string;
  amountCents: number;
  currency?: string;
  country?: string;
}

export interface MarketCheckoutProviderSplitStatusResult {
  provider: string;
  providerTransactionId?: string;
  status: "paid" | "pending" | "failed" | "refunded" | "partial_refunded";
  amountReceivedCents?: number;
  amountRefundedCents?: number;
  currency?: string;
  eventId?: string;
  eventType?: string;
  providerPayload?: Record<string, unknown>;
}

export interface MarketCheckoutProviderSplitRefundInput {
  checkoutId: string;
  paymentId: string;
  provider: string;
  providerTransactionId?: string;
  idempotencyKey?: string;
  amountCents: number;
  currency?: string;
  reason?: string;
  allocations: MarketCheckoutProviderSplitAllocation[];
}

export interface MarketCheckoutProviderSplitRefundResult {
  provider: string;
  providerTransactionId?: string;
  refundId: string;
  status: "refunded" | "partial_refunded" | "pending" | "failed";
  refundedAmountCents: number;
  currency?: string;
  eventId?: string;
  eventType?: string;
  providerPayload?: Record<string, unknown>;
}

export interface MarketCheckoutProviderNextAction {
  type: "redirect" | "client_secret" | "sdk_confirmation";
  redirectUrl?: string;
  clientSecret?: string;
  expiresAt?: string;
  providerPayload?: Record<string, unknown>;
}

export interface MarketCheckoutProviderSplitGateway {
  process(
    input: MarketCheckoutProviderSplitGatewayInput,
  ): Promise<MarketCheckoutProviderSplitGatewayResult>;
}

export class ProviderSplitMarketCheckoutPaymentProvider implements MarketCheckoutPaymentProvider {
  constructor(private readonly gateway: MarketCheckoutProviderSplitGateway) {}

  async process(
    input: MarketCheckoutPaymentProviderInput,
  ): Promise<MarketCheckoutPaymentProviderResult> {
    const parentIdempotencyKey =
      input.requestIdempotencyKey ?? `market-checkout:${input.checkoutId}`;
    const allocations = input.childOrders.map((child) => ({
      restaurantId: child.restaurantId,
      restaurantName: child.restaurantName,
      orderId: child.orderId,
      orderNumber: child.orderNumber,
      amountCents: childOrderAmountCents(child),
    }));
    const amountCents = allocations.reduce(
      (sum, allocation) => sum + allocation.amountCents,
      0,
    );
    // Refuse before anything leaves the Worker: an adapter must never be asked
    // to authorize NT$15.50 or a fraction of a dong.
    for (const allocation of allocations) {
      assertCurrencyAlignedCents(allocation.amountCents, input.currency);
    }
    assertCurrencyAlignedCents(amountCents, input.currency);

    const result = await this.gateway.process({
      checkoutId: input.checkoutId,
      marketSlug: input.marketSlug,
      method: input.method,
      country: input.country,
      currency: input.currency,
      idempotencyKey: parentIdempotencyKey,
      amountCents,
      customerInfo: input.customerInfo,
      providerInput: input.providerInput,
      allocations,
    });
    if (result.status === "pending" || result.status === "requires_action") {
      return {
        provider: result.provider,
        splitMode: "provider_split",
        idempotencyKey: parentIdempotencyKey,
        paymentStatus: "pending",
        providerTransactionId: result.providerTransactionId,
        childPayments: [],
        nextAction: result.nextAction,
      };
    }

    const authorizationIssue = verifyProviderMoney({
      expectedCents: amountCents,
      expectedCurrency: input.currency,
      receivedCents: result.authorizedAmountCents,
      receivedCurrency: result.currency,
    });
    if (authorizationIssue) {
      throw new Error(
        authorizationIssue.code.startsWith("CURRENCY_")
          ? `Provider split authorized currency does not match checkout currency (${authorizationIssue.code})`
          : "Provider split authorized amount does not match checkout total",
      );
    }

    const allocationByOrderId = validateProviderSplitAllocations(
      allocations,
      result.allocations,
    );

    return {
      provider: result.provider,
      splitMode: "provider_split",
      idempotencyKey: parentIdempotencyKey,
      paymentStatus: "paid",
      providerTransactionId: result.providerTransactionId,
      nextAction: result.nextAction,
      childPayments: input.childOrders.map((child) => {
        const allocation = allocationByOrderId.get(child.orderId)!;
        const amountCents = allocation.amountCents;

        return {
          restaurantId: child.restaurantId,
          restaurantName: child.restaurantName,
          orderId: child.orderId,
          orderNumber: child.orderNumber,
          paymentId:
            allocation.paymentId ??
            `${result.providerTransactionId}:${child.orderId}`,
          status: "paid" as const,
          amount: amountCents / 100,
          amountCents,
        };
      }),
    };
  }
}

function readProviderInputString(
  providerInput: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = providerInput?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Pays a market checkout in full from a stored-value credit (代幣) balance.
 * Settlement is synchronous and atomic (no external gateway, webhook, or
 * nextAction): the wallet deduction either covers the whole total or throws.
 * Card credentials flow through `providerInput` (`creditCardPublicId`,
 * optional `creditCardPin`).
 */
export class CreditBalanceMarketCheckoutPaymentProvider implements MarketCheckoutPaymentProvider {
  constructor(
    private readonly env: Env,
    private readonly creditService = new CreditService(env),
  ) {}

  async process(
    input: MarketCheckoutPaymentProviderInput,
  ): Promise<MarketCheckoutPaymentProviderResult> {
    const parentIdempotencyKey =
      input.requestIdempotencyKey ?? `market-checkout:${input.checkoutId}`;
    const publicId = readProviderInputString(
      input.providerInput,
      "creditCardPublicId",
    );
    if (!publicId) {
      throw new Error("Credit card public id is required for credit payment");
    }
    const pin = readProviderInputString(input.providerInput, "creditCardPin");

    const amountCents = input.childOrders.reduce(
      (sum, child) => sum + Math.round(Number(child.totalAmount ?? 0) * 100),
      0,
    );

    const result = await this.creditService.spend({
      publicId,
      amountCents,
      currency: input.currency,
      idempotencyKey: parentIdempotencyKey,
      sourceType: "market_checkout",
      sourceId: input.checkoutId,
      pin,
    });

    return {
      provider: "credit_balance",
      splitMode: "provider_split",
      idempotencyKey: parentIdempotencyKey,
      paymentStatus: "paid",
      providerTransactionId: result.ledgerEntryId,
      childPayments: input.childOrders.map((child) => {
        const childAmountCents = Math.round(
          Number(child.totalAmount ?? 0) * 100,
        );
        return {
          restaurantId: child.restaurantId,
          restaurantName: child.restaurantName,
          orderId: child.orderId,
          orderNumber: child.orderNumber,
          paymentId: `${result.ledgerEntryId}:${child.orderId}`,
          status: "paid" as const,
          amount: childAmountCents / 100,
          amountCents: childAmountCents,
        };
      }),
    };
  }
}

class UnconfiguredProviderSplitGateway implements MarketCheckoutProviderSplitGateway {
  async process(): Promise<MarketCheckoutProviderSplitGatewayResult> {
    throw new Error("Market checkout provider split gateway is not configured");
  }
}

export class HttpProviderSplitGateway implements MarketCheckoutProviderSplitGateway {
  constructor(
    private readonly endpoint: string,
    private readonly bearerToken?: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly signingSecret?: string,
  ) {}

  async process(
    input: MarketCheckoutProviderSplitGatewayInput,
  ): Promise<MarketCheckoutProviderSplitGatewayResult> {
    const body = JSON.stringify(withProviderWireMoney(input));
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(this.bearerToken
        ? { authorization: `Bearer ${this.bearerToken}` }
        : {}),
    };

    if (this.signingSecret) {
      const timestamp = new Date().toISOString();
      headers["x-market-checkout-signature-algorithm"] = "hmac-sha256";
      headers["x-market-checkout-signature-timestamp"] = timestamp;
      headers["x-market-checkout-signature"] =
        await signMarketCheckoutProviderSplitPayload(
          this.signingSecret,
          timestamp,
          body,
        );
    }

    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(
        `Market checkout provider split gateway failed: ${response.status}`,
      );
    }

    const payload =
      (await response.json()) as Partial<MarketCheckoutProviderSplitGatewayResult>;
    return parseHttpGatewayResult(payload);
  }
}

export function createMarketCheckoutPaymentProvider(
  env: Env,
  method?: string,
): MarketCheckoutPaymentProvider {
  if (method === "credits") {
    if (
      !isFeatureEnabled(
        { STORED_VALUE_CREDITS_ENABLED: env.STORED_VALUE_CREDITS_ENABLED },
        "storedValueCredits",
      )
    ) {
      throw new Error("Market checkout payment provider is not configured");
    }
    return new CreditBalanceMarketCheckoutPaymentProvider(env);
  }
  const splitMode = env.MARKET_CHECKOUT_SPLIT_MODE;
  if (splitMode === "provider_split") {
    return new ProviderSplitMarketCheckoutPaymentProvider(
      env.MARKET_CHECKOUT_PROVIDER_SPLIT_URL
        ? new HttpProviderSplitGateway(
            env.MARKET_CHECKOUT_PROVIDER_SPLIT_URL,
            env.MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN,
            fetch,
            env.MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET,
          )
        : new UnconfiguredProviderSplitGateway(),
    );
  }

  throw new Error("Market checkout payment provider is not configured");
}

/**
 * Refund a credit-funded market checkout by crediting the stored-value balance
 * back. Returns the generic refund result shape so the route reuses the same
 * downstream settlement/persistence logic as provider-split refunds.
 */
export async function refundCreditMarketCheckoutPayment(
  env: Env,
  input: {
    spendIdempotencyKey: string;
    refundIdempotencyKey: string;
    amountCents: number;
    currency: string;
    checkoutId: string;
    providerTransactionId?: string;
  },
  creditService = new CreditService(env),
): Promise<MarketCheckoutProviderSplitRefundResult> {
  const result = await creditService.refundByOriginalSpend({
    spendIdempotencyKey: input.spendIdempotencyKey,
    refundIdempotencyKey: input.refundIdempotencyKey,
    amountCents: input.amountCents,
    currency: input.currency,
    sourceType: "market_checkout",
    sourceId: input.checkoutId,
  });

  return {
    provider: "credit_balance",
    providerTransactionId: input.providerTransactionId,
    refundId: result.ledgerEntryId,
    status: "refunded",
    refundedAmountCents: input.amountCents,
    currency: input.currency,
    eventType: "market_checkout.payment_refunded",
  };
}

export function getMarketCheckoutPaymentProviderStatus(
  env: Env,
): MarketCheckoutPaymentProviderStatus {
  const splitMode =
    env.MARKET_CHECKOUT_SPLIT_MODE === "provider_split"
      ? "provider_split"
      : "child_transactions";
  const providerSplitUrlConfigured = Boolean(
    env.MARKET_CHECKOUT_PROVIDER_SPLIT_URL,
  );
  const providerSplitHealthUrlConfigured = Boolean(
    env.MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL,
  );
  const providerStatusUrlConfigured = Boolean(
    env.MARKET_CHECKOUT_PROVIDER_STATUS_URL,
  );
  const providerRefundUrlConfigured = Boolean(
    env.MARKET_CHECKOUT_PROVIDER_REFUND_URL,
  );
  const providerSplitTokenConfigured = Boolean(
    env.MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN,
  );
  const providerSplitSigningConfigured = Boolean(
    env.MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET,
  );
  const providerWebhookSecretConfigured = Boolean(
    env.MARKET_CHECKOUT_WEBHOOK_SECRET,
  );

  if (splitMode === "provider_split") {
    const missingConfiguration: string[] = [];
    if (!providerSplitUrlConfigured) {
      missingConfiguration.push("MARKET_CHECKOUT_PROVIDER_SPLIT_URL");
    }
    if (providerSplitUrlConfigured && !providerWebhookSecretConfigured) {
      missingConfiguration.push("MARKET_CHECKOUT_WEBHOOK_SECRET");
    }
    if (providerSplitUrlConfigured && !providerStatusUrlConfigured) {
      missingConfiguration.push("MARKET_CHECKOUT_PROVIDER_STATUS_URL");
    }
    if (providerSplitUrlConfigured && !providerRefundUrlConfigured) {
      missingConfiguration.push("MARKET_CHECKOUT_PROVIDER_REFUND_URL");
    }
    const providerCapabilities = [
      ...MARKET_CHECKOUT_PROVIDER_ADAPTER_OPERATIONS,
      "aggregate_authorization",
      "provider_allocations",
      "health_check",
      "webhook_status_sync",
      "provider_status_lookup",
      "refunds",
    ];
    if (providerSplitSigningConfigured) {
      providerCapabilities.push("signed_requests");
    }
    if (providerWebhookSecretConfigured) {
      providerCapabilities.push("signed_webhooks");
    }

    return {
      splitMode,
      readiness: !providerSplitUrlConfigured
        ? "not_configured"
        : providerWebhookSecretConfigured &&
            providerStatusUrlConfigured &&
            providerRefundUrlConfigured
          ? "ready"
          : "warning",
      providerKind: "http_provider_split",
      providerSplitUrlConfigured,
      providerSplitHealthUrlConfigured,
      providerStatusUrlConfigured,
      providerRefundUrlConfigured,
      providerSplitTokenConfigured,
      providerSplitSigningConfigured,
      providerWebhookSecretConfigured,
      capabilities: providerSplitUrlConfigured
        ? providerCapabilities
        : ["webhook_status_sync", "refunds"],
      missingConfiguration,
      notes: providerSplitUrlConfigured
        ? [
            providerSplitTokenConfigured
              ? "Provider split gateway is configured with bearer-token authentication."
              : "Provider split gateway is configured without bearer-token authentication.",
            providerSplitSigningConfigured
              ? "Provider split gateway requests are signed with HMAC-SHA256."
              : "Provider split gateway requests are not signed; configure a signing secret before production use.",
            providerWebhookSecretConfigured
              ? "Market checkout webhooks are verified with MARKET_CHECKOUT_WEBHOOK_SECRET."
              : "Market checkout webhook verification secret is not configured; payment status callbacks will be rejected.",
            providerStatusUrlConfigured
              ? "Provider status lookup URL is configured for manual reconciliation."
              : "Provider status lookup URL is not configured; manual reconciliation will be unavailable.",
            providerRefundUrlConfigured
              ? "Provider refund URL is configured for provider split refunds."
              : "Provider refund URL is not configured; provider split refunds will be unavailable.",
            providerSplitHealthUrlConfigured
              ? "Provider split health check URL is configured."
              : "Provider split health check URL is not configured; connectivity is not verified.",
          ]
        : [
            "Provider split mode is enabled but no HTTP gateway URL is configured.",
          ],
    };
  }

  return {
    splitMode,
    readiness: "not_configured",
    providerKind: "internal_child_transactions",
    providerSplitUrlConfigured,
    providerSplitHealthUrlConfigured,
    providerStatusUrlConfigured,
    providerRefundUrlConfigured,
    providerSplitTokenConfigured,
    providerSplitSigningConfigured,
    providerWebhookSecretConfigured,
    capabilities: [],
    missingConfiguration: [
      "MARKET_CHECKOUT_SPLIT_MODE",
      ...(!providerSplitUrlConfigured
        ? ["MARKET_CHECKOUT_PROVIDER_SPLIT_URL"]
        : []),
    ],
    notes: [
      "Customer online payments are unavailable; configure provider_split and its gateway URL. Cash payments use the staff POS route.",
    ],
  };
}

export async function signMarketCheckoutProviderSplitPayload(
  secret: string,
  timestamp: string,
  body: string,
) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${body}`),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function checkMarketCheckoutPaymentProviderConnectivity(
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<MarketCheckoutPaymentProviderConnectivityCheck> {
  const status = getMarketCheckoutPaymentProviderStatus(env);
  const checkedAt = new Date().toISOString();

  if (status.splitMode !== "provider_split") {
    return {
      status: "skipped",
      checkedAt,
      splitMode: status.splitMode,
      message:
        "Provider split connectivity check is skipped because child transaction mode is active.",
    };
  }
  if (!env.MARKET_CHECKOUT_PROVIDER_SPLIT_URL) {
    return {
      status: "failed",
      checkedAt,
      splitMode: status.splitMode,
      message: "Provider split gateway URL is not configured.",
    };
  }
  if (!env.MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL) {
    return {
      status: "skipped",
      checkedAt,
      splitMode: status.splitMode,
      target: env.MARKET_CHECKOUT_PROVIDER_SPLIT_URL,
      message:
        "Provider split gateway URL is configured, but no health check URL is configured.",
    };
  }

  const target = env.MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL;
  try {
    const response = await fetcher(target, {
      method: "GET",
      headers: {
        ...(env.MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN
          ? {
              authorization: `Bearer ${env.MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN}`,
            }
          : {}),
      },
    });
    if (!response.ok) {
      return {
        status: "failed",
        checkedAt,
        splitMode: status.splitMode,
        target,
        responseStatus: response.status,
        message: `Provider split health check failed: ${response.status}`,
      };
    }

    const payload = await parseProviderHealthPayload(response);
    return {
      status: "passed",
      checkedAt,
      splitMode: status.splitMode,
      target,
      responseStatus: response.status,
      capabilities: payload.capabilities,
      message: payload.message ?? "Provider split health check passed.",
    };
  } catch (error) {
    return {
      status: "failed",
      checkedAt,
      splitMode: status.splitMode,
      target,
      message:
        error instanceof Error
          ? error.message
          : "Provider split health check failed.",
    };
  }
}

export async function queryMarketCheckoutProviderSplitStatus(
  env: Env,
  input: MarketCheckoutProviderSplitStatusInput,
  fetcher: typeof fetch = fetch,
): Promise<MarketCheckoutProviderSplitStatusResult> {
  if (env.MARKET_CHECKOUT_SPLIT_MODE !== "provider_split") {
    throw new Error(
      "Market checkout provider status reconciliation requires provider_split mode",
    );
  }
  if (!env.MARKET_CHECKOUT_PROVIDER_STATUS_URL) {
    throw new Error("Market checkout provider status URL is not configured");
  }

  // Read-only, so a legacy row without a currency is still looked up, just
  // without the ISO minor-unit fields.
  const body = JSON.stringify(
    normalizeCurrencyCode(input.currency)
      ? withProviderWireMoney(input)
      : input,
  );
  const headers = await buildProviderSplitHeaders(env, body);

  const response = await fetcher(env.MARKET_CHECKOUT_PROVIDER_STATUS_URL, {
    method: "POST",
    headers,
    body,
  });
  if (!response.ok) {
    throw new Error(
      `Market checkout provider status lookup failed: ${response.status}`,
    );
  }

  return parseHttpStatusResult(
    (await response.json()) as Partial<MarketCheckoutProviderSplitStatusResult>,
  );
}

export async function refundMarketCheckoutProviderSplitPayment(
  env: Env,
  input: MarketCheckoutProviderSplitRefundInput,
  fetcher: typeof fetch = fetch,
): Promise<MarketCheckoutProviderSplitRefundResult> {
  if (env.MARKET_CHECKOUT_SPLIT_MODE !== "provider_split") {
    throw new Error(
      "Market checkout provider refunds require provider_split mode",
    );
  }
  if (!env.MARKET_CHECKOUT_PROVIDER_REFUND_URL) {
    throw new Error("Market checkout provider refund URL is not configured");
  }

  // Money leaves here: no currency, or an amount off its step, is refused.
  const body = JSON.stringify(withProviderWireMoney(input));
  const headers = await buildProviderSplitHeaders(env, body);
  const response = await fetcher(env.MARKET_CHECKOUT_PROVIDER_REFUND_URL, {
    method: "POST",
    headers,
    body,
  });
  if (!response.ok) {
    throw new Error(
      `Market checkout provider refund failed: ${response.status}`,
    );
  }

  return parseHttpRefundResult(
    (await response.json()) as Partial<MarketCheckoutProviderSplitRefundResult>,
  );
}

async function parseProviderHealthPayload(response: Response) {
  try {
    const payload = (await response.json()) as {
      message?: unknown;
      capabilities?: unknown;
    };
    return {
      message:
        typeof payload.message === "string" ? payload.message : undefined,
      capabilities: Array.isArray(payload.capabilities)
        ? payload.capabilities.filter(
            (capability): capability is string =>
              typeof capability === "string",
          )
        : undefined,
    };
  } catch {
    return {};
  }
}

function parseHttpGatewayResult(
  payload: Partial<MarketCheckoutProviderSplitGatewayResult>,
): MarketCheckoutProviderSplitGatewayResult {
  if (
    !payload.provider ||
    !payload.providerTransactionId ||
    typeof payload.authorizedAmountCents !== "number" ||
    !Array.isArray(payload.allocations)
  ) {
    throw new Error(
      "Market checkout provider split gateway response is invalid",
    );
  }

  return {
    provider: payload.provider,
    providerTransactionId: payload.providerTransactionId,
    status: isProviderSplitGatewayStatus(payload.status)
      ? payload.status
      : undefined,
    authorizedAmountCents: payload.authorizedAmountCents,
    currency:
      typeof payload.currency === "string" ? payload.currency : undefined,
    allocations: payload.allocations.map((allocation) => {
      if (
        typeof allocation?.orderId !== "string" ||
        !allocation.orderId ||
        typeof allocation.amountCents !== "number"
      ) {
        throw new Error(
          "Market checkout provider split gateway allocation is invalid",
        );
      }

      return {
        orderId: allocation.orderId,
        paymentId: allocation.paymentId,
        amountCents: allocation.amountCents,
      };
    }),
    nextAction: parseProviderNextAction(payload.nextAction),
  };
}

function parseHttpStatusResult(
  payload: Partial<MarketCheckoutProviderSplitStatusResult>,
): MarketCheckoutProviderSplitStatusResult {
  if (!payload.provider || !payload.status) {
    throw new Error("Invalid provider status lookup response");
  }
  if (
    !["paid", "pending", "failed", "refunded", "partial_refunded"].includes(
      payload.status,
    )
  ) {
    throw new Error("Invalid provider status lookup payment status");
  }

  return {
    provider: payload.provider,
    providerTransactionId:
      typeof payload.providerTransactionId === "string"
        ? payload.providerTransactionId
        : undefined,
    status: payload.status,
    amountReceivedCents: integerCentsOrUndefined(
      payload.amountReceivedCents,
      "Invalid provider status lookup amount",
    ),
    amountRefundedCents: integerCentsOrUndefined(
      payload.amountRefundedCents,
      "Invalid provider status lookup amount",
    ),
    currency:
      typeof payload.currency === "string" ? payload.currency : undefined,
    eventId: typeof payload.eventId === "string" ? payload.eventId : undefined,
    eventType:
      typeof payload.eventType === "string" ? payload.eventType : undefined,
    providerPayload:
      payload.providerPayload && typeof payload.providerPayload === "object"
        ? payload.providerPayload
        : undefined,
  };
}

function parseHttpRefundResult(
  payload: Partial<MarketCheckoutProviderSplitRefundResult>,
): MarketCheckoutProviderSplitRefundResult {
  if (
    !payload.provider ||
    !payload.refundId ||
    !payload.status ||
    typeof payload.refundedAmountCents !== "number"
  ) {
    throw new Error("Invalid provider refund response");
  }
  if (
    !["refunded", "partial_refunded", "pending", "failed"].includes(
      payload.status,
    )
  ) {
    throw new Error("Invalid provider refund status");
  }

  return {
    provider: payload.provider,
    providerTransactionId:
      typeof payload.providerTransactionId === "string"
        ? payload.providerTransactionId
        : undefined,
    refundId: payload.refundId,
    status: payload.status,
    refundedAmountCents: integerCentsOrUndefined(
      payload.refundedAmountCents,
      "Invalid provider refund amount",
    ) as number,
    currency:
      typeof payload.currency === "string" ? payload.currency : undefined,
    eventId: typeof payload.eventId === "string" ? payload.eventId : undefined,
    eventType:
      typeof payload.eventType === "string" ? payload.eventType : undefined,
    providerPayload:
      payload.providerPayload && typeof payload.providerPayload === "object"
        ? payload.providerPayload
        : undefined,
  };
}

/**
 * Wire form of an amount-bearing request to the provider adapter.
 *
 * `amountCents` stays in our internal convention (major × 100 for every
 * currency). Next to it goes the ISO 4217 form an adapter can hand straight
 * to a gateway that uses minor units: `amountMinor` with its
 * `currencyExponent` (TWD 2, MYR 2, VND 0), on the total and on every
 * allocation. For Stripe that is exactly its `amount`; for a whole-unit
 * gateway (LINE Pay, ECPay, NewebPay) it is `amountMinor / 10^currencyExponent`.
 */
export interface MarketCheckoutProviderWireMoney {
  amountMinor: number;
  currencyExponent: number;
}

export function withProviderWireMoney<
  T extends {
    amountCents: number;
    currency?: string;
    allocations?: MarketCheckoutProviderSplitAllocation[];
  },
>(
  input: T,
): T &
  MarketCheckoutProviderWireMoney & {
    allocations?: Array<
      MarketCheckoutProviderSplitAllocation & { amountMinor: number }
    >;
  } {
  const currency = normalizeCurrencyCode(input.currency);
  if (!currency) {
    throw new Error(
      `Market checkout provider request needs a supported currency, got ${String(input.currency)}`,
    );
  }
  return {
    ...input,
    amountMinor: centsToIsoMinorUnits(input.amountCents, currency),
    currencyExponent: ISO_4217_EXPONENTS[currency],
    ...(input.allocations
      ? {
          allocations: input.allocations.map((allocation) => ({
            ...allocation,
            amountMinor: centsToIsoMinorUnits(allocation.amountCents, currency),
          })),
        }
      : {}),
  };
}

/**
 * Check a provider refund response before it touches the ledger: a completed
 * refund must name the currency that was refunded and an amount above zero
 * and no larger than what was asked for. Pending and failed refunds move no
 * money yet, so they pass.
 */
export function verifyProviderRefundResult(
  request: Pick<
    MarketCheckoutProviderSplitRefundInput,
    "amountCents" | "currency"
  >,
  result: MarketCheckoutProviderSplitRefundResult,
): ProviderMoneyIssue | null {
  if (result.status !== "refunded" && result.status !== "partial_refunded") {
    return null;
  }
  const issue = verifyProviderMoney({
    expectedCents: request.amountCents,
    expectedCurrency: request.currency,
    receivedCents: result.refundedAmountCents,
    receivedCurrency: result.currency,
    mode: "at_most",
  });
  if (issue) return issue;
  if (result.refundedAmountCents <= 0) {
    return {
      code: "AMOUNT_MISMATCH",
      message: "Provider reported a completed refund of nothing",
    };
  }
  return null;
}

function integerCentsOrUndefined(value: unknown, message: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(message);
  }
  return value;
}

async function buildProviderSplitHeaders(env: Env, body: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(env.MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN
      ? {
          authorization: `Bearer ${env.MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN}`,
        }
      : {}),
  };
  if (env.MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET) {
    const timestamp = new Date().toISOString();
    headers["x-market-checkout-signature-algorithm"] = "hmac-sha256";
    headers["x-market-checkout-signature-timestamp"] = timestamp;
    headers["x-market-checkout-signature"] =
      await signMarketCheckoutProviderSplitPayload(
        env.MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET,
        timestamp,
        body,
      );
  }
  return headers;
}

function isProviderSplitGatewayStatus(
  value: unknown,
): value is NonNullable<MarketCheckoutProviderSplitGatewayResult["status"]> {
  return value === "paid" || value === "pending" || value === "requires_action";
}

function parseProviderNextAction(
  value: unknown,
): MarketCheckoutProviderNextAction | undefined {
  if (!value || typeof value !== "object") return undefined;
  const action = value as Partial<MarketCheckoutProviderNextAction>;
  if (
    action.type !== "redirect" &&
    action.type !== "client_secret" &&
    action.type !== "sdk_confirmation"
  ) {
    throw new Error("Market checkout provider split next action is invalid");
  }

  if (
    action.type === "redirect" &&
    (typeof action.redirectUrl !== "string" || action.redirectUrl.length === 0)
  ) {
    throw new Error("Market checkout provider split next action is invalid");
  }
  if (
    action.type === "client_secret" &&
    (typeof action.clientSecret !== "string" ||
      action.clientSecret.length === 0)
  ) {
    throw new Error("Market checkout provider split next action is invalid");
  }
  if (
    action.type === "sdk_confirmation" &&
    (!action.providerPayload ||
      typeof action.providerPayload !== "object" ||
      Array.isArray(action.providerPayload))
  ) {
    throw new Error("Market checkout provider split next action is invalid");
  }

  return {
    type: action.type,
    redirectUrl:
      typeof action.redirectUrl === "string" ? action.redirectUrl : undefined,
    clientSecret:
      typeof action.clientSecret === "string" ? action.clientSecret : undefined,
    expiresAt:
      typeof action.expiresAt === "string" ? action.expiresAt : undefined,
    providerPayload:
      action.providerPayload && typeof action.providerPayload === "object"
        ? (action.providerPayload as Record<string, unknown>)
        : undefined,
  };
}

function validateProviderSplitAllocations(
  expectedAllocations: MarketCheckoutProviderSplitAllocation[],
  actualAllocations: MarketCheckoutProviderSplitGatewayResult["allocations"],
) {
  const actualByOrderId = new Map<
    string,
    MarketCheckoutProviderSplitGatewayResult["allocations"][number]
  >();

  for (const allocation of actualAllocations) {
    if (actualByOrderId.has(allocation.orderId)) {
      throw new Error("Provider split returned duplicate child allocation");
    }
    actualByOrderId.set(allocation.orderId, allocation);
  }

  for (const expected of expectedAllocations) {
    const actual = actualByOrderId.get(expected.orderId);
    if (!actual) {
      throw new Error("Provider split response is missing child allocation");
    }
    if (actual.amountCents !== expected.amountCents) {
      throw new Error("Provider split child allocation amount does not match");
    }
  }

  return actualByOrderId;
}
