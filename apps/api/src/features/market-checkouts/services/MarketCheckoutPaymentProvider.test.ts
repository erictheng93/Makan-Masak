import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";
import {
  HttpProviderSplitGateway,
  MARKET_CHECKOUT_PROVIDER_ADAPTER_OPERATIONS,
  ProviderSplitMarketCheckoutPaymentProvider,
  checkMarketCheckoutPaymentProviderConnectivity,
  createMarketCheckoutPaymentProvider,
  getMarketCheckoutPaymentProviderStatus,
  queryMarketCheckoutProviderSplitStatus,
  refundMarketCheckoutProviderSplitPayment,
  signMarketCheckoutProviderSplitPayload,
} from "./MarketCheckoutPaymentProvider";
import {
  mockMarketCheckoutProviderGatewayInput,
  mockMarketCheckoutProviderRefundInput,
  mockMarketCheckoutProviderRefundResponse,
  mockMarketCheckoutProviderRequiredOperations,
  mockMarketCheckoutProviderPaidStatusResponse,
  mockMarketCheckoutProviderPendingResponse,
} from "../testing/mockMarketCheckoutProviderContract";

describe("MarketCheckoutPaymentProvider", () => {
  it("processes provider split payments through an injected gateway", async () => {
    const gateway = {
      process: vi.fn(async () => ({
        provider: "stripe_connect",
        providerTransactionId: "pi_market_1",
        authorizedAmountCents: 20000,
        currency: "TWD",
        allocations: [
          { orderId: "1001", paymentId: "alloc-1001", amountCents: 12000 },
          { orderId: "1002", paymentId: "alloc-1002", amountCents: 8000 },
        ],
      })),
    };
    const provider = new ProviderSplitMarketCheckoutPaymentProvider(gateway);

    const result = await provider.process({
      checkoutId: "checkout-1",
      marketSlug: "fengjia",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "Noodle Stall",
          orderId: "1001",
          orderNumber: "A001",
          totalAmount: 120,
        },
        {
          restaurantId: "restaurant-2",
          restaurantName: "Dessert Stall",
          orderId: "1002",
          orderNumber: "A002",
          totalAmount: 80,
        },
      ],
      method: "stripe_connect",
      country: "TW",
      currency: "TWD",
      requestIdempotencyKey: "market-pay-1",
      providerInput: {
        paymentMethodId: "pm_future_1",
        returnUrl: "https://app.example.test/market-checkouts/checkout-1",
      },
    });

    expect(gateway.process).toHaveBeenCalledWith({
      checkoutId: "checkout-1",
      marketSlug: "fengjia",
      method: "stripe_connect",
      country: "TW",
      currency: "TWD",
      idempotencyKey: "market-pay-1",
      amountCents: 20000,
      customerInfo: undefined,
      providerInput: {
        paymentMethodId: "pm_future_1",
        returnUrl: "https://app.example.test/market-checkouts/checkout-1",
      },
      allocations: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "Noodle Stall",
          orderId: "1001",
          orderNumber: "A001",
          amountCents: 12000,
        },
        {
          restaurantId: "restaurant-2",
          restaurantName: "Dessert Stall",
          orderId: "1002",
          orderNumber: "A002",
          amountCents: 8000,
        },
      ],
    });
    expect(result).toEqual({
      provider: "stripe_connect",
      splitMode: "provider_split",
      idempotencyKey: "market-pay-1",
      paymentStatus: "paid",
      providerTransactionId: "pi_market_1",
      nextAction: undefined,
      childPayments: [
        expect.objectContaining({
          orderId: "1001",
          paymentId: "alloc-1001",
          status: "paid",
          amountCents: 12000,
        }),
        expect.objectContaining({
          orderId: "1002",
          paymentId: "alloc-1002",
          status: "paid",
          amountCents: 8000,
        }),
      ],
    });
  });

  it("returns pending provider split payments with a next action", async () => {
    const provider = new ProviderSplitMarketCheckoutPaymentProvider({
      process: vi.fn(async () => ({
        provider: "future_provider",
        providerTransactionId: "intent-market-1",
        status: "requires_action" as const,
        authorizedAmountCents: 0,
        allocations: [],
        nextAction: {
          type: "redirect" as const,
          redirectUrl: "https://payments.example.test/confirm/intent-market-1",
          expiresAt: "2026-06-01T12:00:00.000Z",
        },
      })),
    });

    const result = await provider.process({
      checkoutId: "checkout-1",
      marketSlug: "fengjia",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "Noodle Stall",
          orderId: "1001",
          orderNumber: "A001",
          totalAmount: 120,
        },
      ],
      method: "future_provider",
      country: "TW",
      currency: "TWD",
    });

    expect(result).toEqual({
      provider: "future_provider",
      splitMode: "provider_split",
      idempotencyKey: "market-checkout:checkout-1",
      providerTransactionId: "intent-market-1",
      paymentStatus: "pending",
      childPayments: [],
      nextAction: {
        type: "redirect",
        redirectUrl: "https://payments.example.test/confirm/intent-market-1",
        expiresAt: "2026-06-01T12:00:00.000Z",
      },
    });
  });

  it("parses HTTP provider split next actions", async () => {
    const gateway = new HttpProviderSplitGateway(
      "https://payments.example.test/market-split",
      undefined,
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              provider: "future_provider",
              providerTransactionId: "intent-market-1",
              status: "requires_action",
              authorizedAmountCents: 0,
              allocations: [],
              nextAction: {
                type: "client_secret",
                clientSecret: "pi_secret_1",
              },
            }),
          ),
      ) as never,
    );

    await expect(
      gateway.process({
        checkoutId: "checkout-1",
        marketSlug: "fengjia",
        method: "future_provider",
        country: "TW",
        currency: "TWD",
        idempotencyKey: "market-pay-1",
        amountCents: 12000,
        allocations: [],
      }),
    ).resolves.toMatchObject({
      provider: "future_provider",
      providerTransactionId: "intent-market-1",
      status: "requires_action",
      nextAction: {
        type: "client_secret",
        clientSecret: "pi_secret_1",
      },
    });
  });

  it.each([
    {
      nextAction: { type: "redirect" },
      label: "redirect without redirectUrl",
    },
    {
      nextAction: { type: "client_secret" },
      label: "client_secret without clientSecret",
    },
    {
      nextAction: { type: "sdk_confirmation" },
      label: "sdk_confirmation without providerPayload",
    },
    {
      nextAction: { type: "unsupported_action" },
      label: "unsupported action type",
    },
  ])(
    "rejects invalid HTTP provider split next action: $label",
    async ({ nextAction }) => {
      const gateway = new HttpProviderSplitGateway(
        "https://payments.example.test/market-split",
        undefined,
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                provider: "future_provider",
                providerTransactionId: "intent-market-1",
                status: "requires_action",
                authorizedAmountCents: 0,
                allocations: [],
                nextAction,
              }),
            ),
        ) as never,
      );

      await expect(
        gateway.process({
          checkoutId: "checkout-1",
          marketSlug: "fengjia",
          method: "future_provider",
          country: "TW",
          currency: "TWD",
          idempotencyKey: "market-pay-1",
          amountCents: 12000,
          allocations: [],
        }),
      ).rejects.toThrow(
        "Market checkout provider split next action is invalid",
      );
    },
  );

  it("accepts the mock provider pending fixture as the gateway contract", async () => {
    const gateway = new HttpProviderSplitGateway(
      "https://payments.example.test/market-split",
      undefined,
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(mockMarketCheckoutProviderPendingResponse),
          ),
      ) as never,
    );

    await expect(
      gateway.process(mockMarketCheckoutProviderGatewayInput),
    ).resolves.toMatchObject({
      provider: "mock_market_provider",
      providerTransactionId: "intent-market-checkout-1",
      status: "requires_action",
      authorizedAmountCents: 0,
      allocations: [],
      nextAction: {
        type: "redirect",
        redirectUrl:
          "https://payments.example.test/confirm/intent-market-checkout-1",
      },
    });
  });

  it("rejects an unconfigured payment provider instead of settling child orders", () => {
    expect(() => createMarketCheckoutPaymentProvider({} as Env)).toThrow(
      "Market checkout payment provider is not configured",
    );
  });

  it("posts provider split payments to a configured HTTP gateway", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          provider: "stripe_connect",
          providerTransactionId: "pi_market_1",
          authorizedAmountCents: 20000,
          currency: "TWD",
          allocations: [
            { orderId: "1001", paymentId: "alloc-1001", amountCents: 12000 },
            { orderId: "1002", paymentId: "alloc-1002", amountCents: 8000 },
          ],
        }),
        { status: 200 },
      );
    });
    const gateway = new HttpProviderSplitGateway(
      "https://payments.example.test/market-split",
      "split-token",
      fetcher as never,
    );

    const result = await gateway.process({
      checkoutId: "checkout-1",
      marketSlug: "fengjia",
      method: "stripe_connect",
      country: "TW",
      currency: "TWD",
      idempotencyKey: "market-pay-1",
      amountCents: 20000,
      customerInfo: { name: "Guest" },
      allocations: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "Noodle Stall",
          orderId: "1001",
          orderNumber: "A001",
          amountCents: 12000,
        },
        {
          restaurantId: "restaurant-2",
          restaurantName: "Dessert Stall",
          orderId: "1002",
          orderNumber: "A002",
          amountCents: 8000,
        },
      ],
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://payments.example.test/market-split",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer split-token",
        },
        body: expect.stringContaining('"checkoutId":"checkout-1"'),
      }),
    );
    expect(result).toEqual({
      provider: "stripe_connect",
      providerTransactionId: "pi_market_1",
      authorizedAmountCents: 20000,
      currency: "TWD",
      allocations: [
        { orderId: "1001", paymentId: "alloc-1001", amountCents: 12000 },
        { orderId: "1002", paymentId: "alloc-1002", amountCents: 8000 },
      ],
    });
  });

  it("signs configured HTTP provider split requests with HMAC-SHA256", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            provider: "stripe_connect",
            providerTransactionId: "pi_market_1",
            authorizedAmountCents: 12000,
            currency: "TWD",
            allocations: [
              { orderId: "1001", paymentId: "alloc-1001", amountCents: 12000 },
            ],
          }),
        ),
    );
    const gateway = new HttpProviderSplitGateway(
      "https://payments.example.test/market-split",
      "split-token",
      fetcher as never,
      "split-signing-secret",
    );

    await gateway.process({
      checkoutId: "checkout-1",
      marketSlug: "fengjia",
      method: "stripe_connect",
      country: "TW",
      currency: "TWD",
      idempotencyKey: "market-pay-1",
      amountCents: 12000,
      allocations: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "Noodle Stall",
          orderId: "1001",
          orderNumber: "A001",
          amountCents: 12000,
        },
      ],
    });

    const [, requestInit] = (
      fetcher.mock.calls as unknown as Array<[string, RequestInit]>
    )[0];
    const headers = requestInit?.headers as Record<string, string>;
    const body = requestInit?.body as string;
    const timestamp = headers["x-market-checkout-signature-timestamp"];

    expect(headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer split-token",
      "x-market-checkout-signature-algorithm": "hmac-sha256",
    });
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await expect(
      signMarketCheckoutProviderSplitPayload(
        "split-signing-secret",
        timestamp,
        body,
      ),
    ).resolves.toBe(headers["x-market-checkout-signature"]);
  });

  it("rejects invalid HTTP provider split gateway responses", async () => {
    const gateway = new HttpProviderSplitGateway(
      "https://payments.example.test/market-split",
      undefined,
      vi.fn(
        async () => new Response(JSON.stringify({ provider: "x" })),
      ) as never,
    );

    await expect(
      gateway.process({
        checkoutId: "checkout-1",
        marketSlug: "fengjia",
        method: "stripe_connect",
        country: "TW",
        currency: "TWD",
        idempotencyKey: "market-pay-1",
        amountCents: 12000,
        allocations: [],
      }),
    ).rejects.toThrow(
      "Market checkout provider split gateway response is invalid",
    );
  });

  it("rejects provider split results with mismatched authorized amount", async () => {
    const provider = new ProviderSplitMarketCheckoutPaymentProvider({
      process: vi.fn(async () => ({
        provider: "stripe_connect",
        providerTransactionId: "pi_market_1",
        authorizedAmountCents: 19999,
        currency: "TWD",
        allocations: [{ orderId: "1001", amountCents: 12000 }],
      })),
    });

    await expect(
      provider.process({
        checkoutId: "checkout-1",
        marketSlug: "fengjia",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "Noodle Stall",
            orderId: "1001",
            orderNumber: "A001",
            totalAmount: 120,
          },
        ],
        method: "stripe_connect",
        country: "TW",
        currency: "TWD",
      }),
    ).rejects.toThrow(
      "Provider split authorized amount does not match checkout total",
    );
  });

  it("rejects provider split responses missing child allocations", async () => {
    const provider = new ProviderSplitMarketCheckoutPaymentProvider({
      process: vi.fn(async () => ({
        provider: "stripe_connect",
        providerTransactionId: "pi_market_1",
        authorizedAmountCents: 20000,
        currency: "TWD",
        allocations: [{ orderId: "1001", amountCents: 12000 }],
      })),
    });

    await expect(
      provider.process({
        checkoutId: "checkout-1",
        marketSlug: "fengjia",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "Noodle Stall",
            orderId: "1001",
            orderNumber: "A001",
            totalAmount: 120,
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "Dessert Stall",
            orderId: "1002",
            orderNumber: "A002",
            totalAmount: 80,
          },
        ],
        method: "stripe_connect",
        country: "TW",
        currency: "TWD",
      }),
    ).rejects.toThrow("Provider split response is missing child allocation");
  });

  it("rejects provider split child allocations with mismatched amounts", async () => {
    const provider = new ProviderSplitMarketCheckoutPaymentProvider({
      process: vi.fn(async () => ({
        provider: "stripe_connect",
        providerTransactionId: "pi_market_1",
        authorizedAmountCents: 20000,
        currency: "TWD",
        allocations: [
          { orderId: "1001", amountCents: 11900 },
          { orderId: "1002", amountCents: 8100 },
        ],
      })),
    });

    await expect(
      provider.process({
        checkoutId: "checkout-1",
        marketSlug: "fengjia",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "Noodle Stall",
            orderId: "1001",
            orderNumber: "A001",
            totalAmount: 120,
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "Dessert Stall",
            orderId: "1002",
            orderNumber: "A002",
            totalAmount: 80,
          },
        ],
        method: "stripe_connect",
        country: "TW",
        currency: "TWD",
      }),
    ).rejects.toThrow("Provider split child allocation amount does not match");
  });

  it("rejects duplicate provider split child allocations", async () => {
    const provider = new ProviderSplitMarketCheckoutPaymentProvider({
      process: vi.fn(async () => ({
        provider: "stripe_connect",
        providerTransactionId: "pi_market_1",
        authorizedAmountCents: 12000,
        currency: "TWD",
        allocations: [
          { orderId: "1001", amountCents: 12000 },
          { orderId: "1001", amountCents: 12000 },
        ],
      })),
    });

    await expect(
      provider.process({
        checkoutId: "checkout-1",
        marketSlug: "fengjia",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "Noodle Stall",
            orderId: "1001",
            orderNumber: "A001",
            totalAmount: 120,
          },
        ],
        method: "stripe_connect",
        country: "TW",
        currency: "TWD",
      }),
    ).rejects.toThrow("Provider split returned duplicate child allocation");
  });

  it("creates an explicit provider split provider when configured", async () => {
    const provider = createMarketCheckoutPaymentProvider({
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
    } as Env & { MARKET_CHECKOUT_SPLIT_MODE: string });

    expect(provider).toBeInstanceOf(ProviderSplitMarketCheckoutPaymentProvider);
    await expect(
      provider.process({
        checkoutId: "checkout-1",
        marketSlug: "fengjia",
        childOrders: [],
        method: "stripe_connect",
        country: "TW",
        currency: "TWD",
      }),
    ).rejects.toThrow(
      "Market checkout provider split gateway is not configured",
    );
  });

  it("creates an HTTP provider split provider when endpoint is configured", () => {
    const provider = createMarketCheckoutPaymentProvider({
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
        "https://payments.example.test/market-split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "split-token",
    } as Env);

    expect(provider).toBeInstanceOf(ProviderSplitMarketCheckoutPaymentProvider);
  });

  it("reports customer online payment as unavailable in child transaction mode", () => {
    expect(getMarketCheckoutPaymentProviderStatus({} as Env)).toMatchObject({
      splitMode: "child_transactions",
      readiness: "not_configured",
      providerKind: "internal_child_transactions",
      providerSplitUrlConfigured: false,
      providerSplitHealthUrlConfigured: false,
      providerStatusUrlConfigured: false,
      providerSplitSigningConfigured: false,
      providerWebhookSecretConfigured: false,
      capabilities: [],
      missingConfiguration: [
        "MARKET_CHECKOUT_SPLIT_MODE",
        "MARKET_CHECKOUT_PROVIDER_SPLIT_URL",
      ],
    });
  });

  it("reports provider split as not configured when the gateway URL is missing", () => {
    expect(
      getMarketCheckoutPaymentProviderStatus({
        MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      } as Env),
    ).toMatchObject({
      splitMode: "provider_split",
      readiness: "not_configured",
      providerKind: "http_provider_split",
      providerSplitUrlConfigured: false,
      providerSplitHealthUrlConfigured: false,
      providerStatusUrlConfigured: false,
      providerSplitSigningConfigured: false,
      providerWebhookSecretConfigured: false,
      missingConfiguration: ["MARKET_CHECKOUT_PROVIDER_SPLIT_URL"],
    });
  });

  it("reports provider split as ready when the gateway URL is configured", () => {
    expect(
      getMarketCheckoutPaymentProviderStatus({
        MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
        MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
          "https://payments.example.test/market-split",
        MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL:
          "https://payments.example.test/health",
        MARKET_CHECKOUT_PROVIDER_STATUS_URL:
          "https://payments.example.test/market-split/status",
        MARKET_CHECKOUT_PROVIDER_REFUND_URL:
          "https://payments.example.test/market-split/refunds",
        MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "split-token",
        MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET: "split-signing-secret",
        MARKET_CHECKOUT_WEBHOOK_SECRET: "webhook-secret",
      } as Env),
    ).toMatchObject({
      splitMode: "provider_split",
      readiness: "ready",
      providerKind: "http_provider_split",
      providerSplitUrlConfigured: true,
      providerSplitHealthUrlConfigured: true,
      providerStatusUrlConfigured: true,
      providerRefundUrlConfigured: true,
      providerSplitTokenConfigured: true,
      providerSplitSigningConfigured: true,
      providerWebhookSecretConfigured: true,
      capabilities: expect.arrayContaining([
        "create_payment",
        "status_lookup",
        "webhook_verification",
        "refund",
        "signed_requests",
      ]),
      missingConfiguration: [],
    });
  });

  it("reports provider split as warning when webhook verification is not configured", () => {
    expect(
      getMarketCheckoutPaymentProviderStatus({
        MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
        MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
          "https://payments.example.test/market-split",
      } as Env),
    ).toMatchObject({
      splitMode: "provider_split",
      readiness: "warning",
      providerKind: "http_provider_split",
      providerSplitUrlConfigured: true,
      providerWebhookSecretConfigured: false,
      providerStatusUrlConfigured: false,
      missingConfiguration: [
        "MARKET_CHECKOUT_WEBHOOK_SECRET",
        "MARKET_CHECKOUT_PROVIDER_STATUS_URL",
        "MARKET_CHECKOUT_PROVIDER_REFUND_URL",
      ],
    });
  });

  it("skips provider connectivity checks outside provider split mode", async () => {
    await expect(
      checkMarketCheckoutPaymentProviderConnectivity({} as Env),
    ).resolves.toMatchObject({
      status: "skipped",
      splitMode: "child_transactions",
    });
  });

  it("skips provider connectivity checks when no health URL is configured", async () => {
    await expect(
      checkMarketCheckoutPaymentProviderConnectivity({
        MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
        MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
          "https://payments.example.test/market-split",
      } as Env),
    ).resolves.toMatchObject({
      status: "skipped",
      splitMode: "provider_split",
      target: "https://payments.example.test/market-split",
    });
  });

  it("passes provider connectivity checks against the health URL", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: "Gateway ready",
            capabilities: ["aggregate_authorization"],
          }),
        ),
    );

    await expect(
      checkMarketCheckoutPaymentProviderConnectivity(
        {
          MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
          MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
            "https://payments.example.test/market-split",
          MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL:
            "https://payments.example.test/health",
          MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "split-token",
        } as Env,
        fetcher as never,
      ),
    ).resolves.toMatchObject({
      status: "passed",
      splitMode: "provider_split",
      target: "https://payments.example.test/health",
      responseStatus: 200,
      message: "Gateway ready",
      capabilities: ["aggregate_authorization"],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://payments.example.test/health",
      {
        method: "GET",
        headers: { authorization: "Bearer split-token" },
      },
    );
  });

  it("queries provider split payment status with auth and signed payload", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify(mockMarketCheckoutProviderPaidStatusResponse),
        ),
    );

    await expect(
      queryMarketCheckoutProviderSplitStatus(
        {
          MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
          MARKET_CHECKOUT_PROVIDER_STATUS_URL:
            "https://payments.example.test/market-split/status",
          MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "split-token",
          MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET: "split-signing-secret",
        } as Env,
        {
          checkoutId: "checkout-1",
          paymentId: "market_pay_checkout-1",
          provider: "mock_market_provider",
          providerTransactionId: "intent-market-checkout-1",
          idempotencyKey: "market-checkout:checkout-1",
          amountCents: 24000,
          currency: "TWD",
          country: "TW",
        },
        fetcher as never,
      ),
    ).resolves.toMatchObject({
      provider: "mock_market_provider",
      providerTransactionId: "intent-market-checkout-1",
      status: "paid",
      amountReceivedCents: 24000,
      currency: "TWD",
      eventId: "reconcile-market-checkout-1",
      eventType: "market_checkout.payment_paid",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://payments.example.test/market-split/status",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer split-token",
          "x-market-checkout-signature-algorithm": "hmac-sha256",
          "x-market-checkout-signature": expect.any(String),
        }),
      }),
    );
    const request = (
      fetcher.mock.calls as unknown as Array<[string, RequestInit]>
    )[0]?.[1] as { body?: string } | undefined;
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      provider: "mock_market_provider",
      providerTransactionId: "intent-market-checkout-1",
      amountCents: 24000,
    });
  });

  it("requests provider split refunds with auth and signed payload", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(mockMarketCheckoutProviderRefundResponse)),
    );

    await expect(
      refundMarketCheckoutProviderSplitPayment(
        {
          MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
          MARKET_CHECKOUT_PROVIDER_REFUND_URL:
            "https://payments.example.test/market-split/refunds",
          MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "split-token",
          MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET: "split-signing-secret",
        } as Env,
        mockMarketCheckoutProviderRefundInput,
        fetcher as never,
      ),
    ).resolves.toMatchObject({
      provider: "mock_market_provider",
      providerTransactionId: "intent-market-checkout-1",
      refundId: "refund-market-checkout-1",
      status: "refunded",
      refundedAmountCents: 24000,
      currency: "TWD",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://payments.example.test/market-split/refunds",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer split-token",
          "x-market-checkout-signature-algorithm": "hmac-sha256",
          "x-market-checkout-signature": expect.any(String),
        }),
      }),
    );
    const request = (
      fetcher.mock.calls as unknown as Array<[string, RequestInit]>
    )[0]?.[1] as { body?: string } | undefined;
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      provider: "mock_market_provider",
      providerTransactionId: "intent-market-checkout-1",
      amountCents: 24000,
      reason: "customer_request",
      allocations: expect.arrayContaining([
        expect.objectContaining({ orderId: "101", amountCents: 16000 }),
      ]),
    });
  });

  it("fails provider connectivity checks on non-2xx health responses", async () => {
    await expect(
      checkMarketCheckoutPaymentProviderConnectivity(
        {
          MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
          MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
            "https://payments.example.test/market-split",
          MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL:
            "https://payments.example.test/health",
        } as Env,
        vi.fn(async () => new Response("down", { status: 503 })) as never,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      splitMode: "provider_split",
      responseStatus: 503,
    });
  });
});

describe("market checkout provider adapter contract", () => {
  it("keeps mock provider fixtures aligned with required adapter operations", () => {
    expect(mockMarketCheckoutProviderRequiredOperations).toEqual(
      MARKET_CHECKOUT_PROVIDER_ADAPTER_OPERATIONS,
    );
    expect(MARKET_CHECKOUT_PROVIDER_ADAPTER_OPERATIONS).toEqual([
      "create_payment",
      "status_lookup",
      "webhook_verification",
      "refund",
    ]);
  });
});
