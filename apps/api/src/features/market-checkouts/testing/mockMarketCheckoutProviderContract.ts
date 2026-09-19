import type {
  MarketCheckoutProviderSplitRefundInput,
  MarketCheckoutProviderSplitRefundResult,
  MarketCheckoutProviderSplitGatewayInput,
  MarketCheckoutProviderSplitGatewayResult,
  MarketCheckoutProviderSplitStatusResult,
} from "../services/MarketCheckoutPaymentProvider";
import { MARKET_CHECKOUT_PROVIDER_ADAPTER_OPERATIONS } from "../services/MarketCheckoutPaymentProvider";

export const mockMarketCheckoutProviderRequiredOperations =
  MARKET_CHECKOUT_PROVIDER_ADAPTER_OPERATIONS;

export const mockMarketCheckoutProviderGatewayInput: MarketCheckoutProviderSplitGatewayInput =
  {
    checkoutId: "checkout-1",
    marketSlug: "fengjia",
    method: "market_online",
    country: "TW",
    currency: "TWD",
    idempotencyKey: "market-checkout:checkout-1",
    amountCents: 24000,
    customerInfo: {
      name: "Market Guest",
      email: "guest@example.test",
      phone: "0912345678",
    },
    providerInput: {
      returnUrl:
        "https://app.example.test/markets/fengjia/checkouts/checkout-1",
      locale: "zh-TW",
    },
    allocations: [
      {
        restaurantId: "restaurant-1",
        restaurantName: "Chicken Stall",
        orderId: "101",
        orderNumber: "A001",
        amountCents: 16000,
      },
      {
        restaurantId: "restaurant-2",
        restaurantName: "Dessert Stall",
        orderId: "102",
        orderNumber: "A002",
        amountCents: 8000,
      },
    ],
  };

export const mockMarketCheckoutProviderPendingResponse: MarketCheckoutProviderSplitGatewayResult =
  {
    provider: "mock_market_provider",
    providerTransactionId: "intent-market-checkout-1",
    status: "requires_action",
    authorizedAmountCents: 0,
    allocations: [],
    nextAction: {
      type: "redirect",
      redirectUrl:
        "https://payments.example.test/confirm/intent-market-checkout-1",
      expiresAt: "2026-06-02T10:30:00.000Z",
      providerPayload: {
        intentId: "intent-market-checkout-1",
      },
    },
  };

export const mockMarketCheckoutProviderPaidResponse: MarketCheckoutProviderSplitGatewayResult =
  {
    provider: "mock_market_provider",
    providerTransactionId: "intent-market-checkout-1",
    status: "paid",
    authorizedAmountCents: 24000,
    currency: "TWD",
    allocations: [
      {
        orderId: "101",
        paymentId: "mock-pay-101",
        amountCents: 16000,
      },
      {
        orderId: "102",
        paymentId: "mock-pay-102",
        amountCents: 8000,
      },
    ],
  };

export const mockMarketCheckoutProviderPaidStatusResponse: MarketCheckoutProviderSplitStatusResult =
  {
    provider: "mock_market_provider",
    providerTransactionId: "intent-market-checkout-1",
    status: "paid",
    amountReceivedCents: 24000,
    currency: "TWD",
    eventId: "reconcile-market-checkout-1",
    eventType: "market_checkout.payment_paid",
  };

export const mockMarketCheckoutProviderRefundInput: MarketCheckoutProviderSplitRefundInput =
  {
    checkoutId: "checkout-1",
    paymentId: "market_pay_checkout-1",
    provider: "mock_market_provider",
    providerTransactionId: "intent-market-checkout-1",
    idempotencyKey: "market-checkout:checkout-1:refund",
    amountCents: 24000,
    currency: "TWD",
    reason: "customer_request",
    allocations: [
      {
        restaurantId: "restaurant-1",
        restaurantName: "Chicken Stall",
        orderId: "101",
        orderNumber: "A001",
        amountCents: 16000,
      },
      {
        restaurantId: "restaurant-2",
        restaurantName: "Dessert Stall",
        orderId: "102",
        orderNumber: "A002",
        amountCents: 8000,
      },
    ],
  };

export const mockMarketCheckoutProviderRefundResponse: MarketCheckoutProviderSplitRefundResult =
  {
    provider: "mock_market_provider",
    providerTransactionId: "intent-market-checkout-1",
    refundId: "refund-market-checkout-1",
    status: "refunded",
    refundedAmountCents: 24000,
    currency: "TWD",
    providerPayload: {
      reason: "customer_request",
    },
  };

export const mockMarketCheckoutProviderPaidWebhookPayload = {
  id: "evt-market-checkout-paid-1",
  type: "market_checkout.payment_paid",
  status: "paid",
  amount_received: 24000,
  currency: "TWD",
  metadata: {
    marketCheckoutId: "checkout-1",
    marketCheckoutPaymentId: "market_pay_checkout-1",
    providerTransactionId: "intent-market-checkout-1",
  },
};

export async function signMockMarketCheckoutWebhook(
  secret: string,
  rawBody: string,
) {
  return hmacSha256Hex(secret, rawBody);
}

async function hmacSha256Hex(secret: string, value: string) {
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
    encoder.encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
