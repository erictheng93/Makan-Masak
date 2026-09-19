import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";
import { MarketCheckoutPaymentWebhookService } from "./MarketCheckoutPaymentWebhookService";
import { MarketCheckoutVoucherService } from "./MarketCheckoutVoucherService";
import {
  mockMarketCheckoutProviderPaidWebhookPayload,
  signMockMarketCheckoutWebhook,
} from "../testing/mockMarketCheckoutProviderContract";

function createEnv(options: {
  auditInserted?: boolean;
  paymentRow?: Record<string, unknown> | null;
  cachedSession?: Record<string, unknown> | null;
  cachedIndex?: Array<Record<string, unknown>>;
}): Env {
  const kv = new Map<string, string>();
  if (options.cachedSession) {
    kv.set(
      `market_checkout:${options.paymentRow?.checkout_id ?? "checkout-1"}`,
      JSON.stringify(options.cachedSession),
    );
  }
  if (options.cachedIndex) {
    kv.set("market_checkout:index", JSON.stringify(options.cachedIndex));
  }

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        raw: vi.fn(async () => {
          if (!sql.includes("market_checkout_payments")) return [];
          return options.paymentRow == null
            ? []
            : [paymentRowToRaw(options.paymentRow)];
        }),
        first: vi.fn(async () => {
          if (sql.includes("FROM market_checkout_payments")) {
            return options.paymentRow ?? null;
          }
          return null;
        }),
        run: vi.fn(async () => ({
          meta: {
            changes: sql.includes("INSERT OR IGNORE INTO payment_audit_log")
              ? options.auditInserted === false
                ? 0
                : 1
              : 1,
          },
          params,
        })),
      })),
    })),
  };

  return {
    NODE_ENV: "test",
    JWT_SECRET: "test",
    API_VERSION: "v1",
    ENCRYPTION_KEY: "test",
    MARKET_CHECKOUT_WEBHOOK_SECRET: "market-secret",
    DB: db,
    CACHE_KV: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kv.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        kv.delete(key);
      }),
    },
  } as unknown as Env;
}

function paymentRowToRaw(row: Record<string, unknown>): unknown[] {
  return [
    row.payment_id,
    row.checkout_id,
    row.market_id,
    row.provider,
    row.split_mode,
    row.idempotency_key,
    row.status,
    row.amount_cents,
    row.paid_amount_cents,
    row.refunded_amount_cents,
    row.currency,
    row.country_code,
    row.child_payment_ids,
    row.provider_transaction_id,
    row.provider_payload,
    row.created_at_ms,
    row.updated_at_ms,
    row.session_payment_summary,
  ];
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: "market_pay_checkout-1",
    checkout_id: "checkout-1",
    market_id: "market-1",
    provider: "stripe",
    split_mode: "provider_split",
    idempotency_key: "market-checkout:checkout-1",
    status: "pending",
    amount_cents: 12500,
    paid_amount_cents: 0,
    refunded_amount_cents: 0,
    currency: "TWD",
    country_code: "TW",
    child_payment_ids: JSON.stringify(["pi_1:1001", "pi_1:1002"]),
    provider_transaction_id: null,
    provider_payload: JSON.stringify({ source: "market-checkouts" }),
    created_at_ms: Date.parse("2026-06-01T10:00:00.000Z"),
    updated_at_ms: Date.parse("2026-06-01T10:00:00.000Z"),
    session_payment_summary: JSON.stringify({
      status: "pending",
      method: "stripe",
      currency: "TWD",
      country: "TW",
      totalAmount: 125,
      totalAmountCents: 12500,
      paidAmount: 0,
      paidAmountCents: 0,
      childPayments: [],
    }),
    ...overrides,
  };
}

async function stripeSignature(secret: string, rawBody: string) {
  const timestamp = "1780308000";
  const signature = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return `t=${timestamp},v1=${signature}`;
}

async function linePaySignature(secret: string, rawBody: string) {
  const nonce = "linepay-nonce-1";
  const signature = await hmacSha256Base64(
    secret,
    `${secret}${rawBody}${nonce}`,
  );
  return { nonce, signature };
}

function bindParamsFor(env: Env, sqlFragment: string) {
  const normalizedFragment = sqlFragment.toLowerCase();
  const callIndex = vi
    .mocked(env.DB.prepare)
    .mock.calls.findIndex(([sql]) =>
      normalizeSql(sql).includes(normalizedFragment),
    );
  expect(callIndex).toBeGreaterThanOrEqual(0);

  const prepared = vi.mocked(env.DB.prepare).mock.results[callIndex]?.value;
  return vi.mocked(prepared.bind).mock.calls[0] ?? [];
}

function expectHeldForReview(
  env: Env,
  reason: string,
  reportedCents: number | null,
) {
  const auditParams = vi
    .mocked(env.DB.prepare)
    .mock.results.flatMap((result, index) =>
      normalizeSql(vi.mocked(env.DB.prepare).mock.calls[index][0]).includes(
        "insert or ignore into payment_audit_log",
      )
        ? vi.mocked(result.value.bind).mock.calls
        : [],
    )
    .find((params) => params.includes("failure"));
  expect(auditParams).toEqual(
    expect.arrayContaining([
      "market_pay_checkout-1",
      "failure",
      reportedCents,
      `MARKET_CHECKOUT_WEBHOOK_${reason}`,
    ]),
  );

  const paymentUpdate = bindParamsFor(env, "update market_checkout_payments");
  expect(paymentUpdate).toEqual(
    expect.arrayContaining([
      expect.stringContaining('"status":"review_required"'),
      "market_pay_checkout-1",
    ]),
  );
  expect(paymentUpdate).not.toContain("paid");
  expect(
    vi
      .mocked(env.DB.prepare)
      .mock.calls.some(([sql]) =>
        normalizeSql(sql).includes("update market_checkout_sessions"),
      ),
  ).toBe(false);
  expect(env.CACHE_KV.put).not.toHaveBeenCalled();
}

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replaceAll('"', "");
}

describe("MarketCheckoutPaymentWebhookService", () => {
  it("reconciles a signed provider payment event into parent ledger and session summary", async () => {
    const redeemSpy = vi
      .spyOn(MarketCheckoutVoucherService.prototype, "redeem")
      .mockResolvedValueOnce();
    const rawBody = JSON.stringify({
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_1",
          object: "payment_intent",
          amount_received: 12500,
          currency: "twd",
          metadata: {
            marketCheckoutId: "checkout-1",
          },
        },
      },
    });
    const env = createEnv({
      paymentRow: paymentRow(),
      cachedSession: {
        id: "checkout-1",
        payment: { status: "pending" },
        appliedVoucher: {
          couponId: 42,
          code: "ASYNC10",
          name: "ASYNC10",
          discountCents: 1250,
          allocations: [
            { orderId: 1001, amountCents: 8000, discountCents: 800 },
            { orderId: 1002, amountCents: 4500, discountCents: 450 },
          ],
        },
      },
      cachedIndex: [
        {
          id: "checkout-1",
          paymentStatus: "pending",
          updatedAt: "2026-06-01T10:00:00.000Z",
        },
      ],
    });
    const headers = new Headers({
      "stripe-signature": await stripeSignature("market-secret", rawBody),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "stripe",
      rawBody,
      headers,
    );

    expect(result).toMatchObject({
      duplicate: false,
      reconciled: true,
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      status: "paid",
    });

    const prepareCalls = vi.mocked(env.DB.prepare).mock.calls;
    const paymentUpdateIndex = prepareCalls.findIndex(([sql]) =>
      normalizeSql(sql).includes("update market_checkout_payments"),
    );
    const sessionUpdateIndex = prepareCalls.findIndex(([sql]) =>
      normalizeSql(sql).includes("update market_checkout_sessions"),
    );
    expect(paymentUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(sessionUpdateIndex).toBeGreaterThanOrEqual(0);

    const paymentUpdate = vi.mocked(env.DB.prepare).mock.results[
      paymentUpdateIndex
    ]?.value;
    expect(vi.mocked(paymentUpdate.bind).mock.calls[0]).toEqual(
      expect.arrayContaining([
        "paid",
        12500,
        0,
        "pi_1",
        expect.stringContaining('"eventId":"evt_1"'),
        "market_pay_checkout-1",
      ]),
    );

    const sessionUpdate = vi.mocked(env.DB.prepare).mock.results[
      sessionUpdateIndex
    ]?.value;
    const sessionParams = vi.mocked(sessionUpdate.bind).mock.calls[0];
    const paymentSummary = JSON.parse(String(sessionParams?.[1])) as {
      status: string;
      paidAmountCents: number;
      parentPayment: { providerTransactionId: string };
    };
    expect(paymentSummary).toMatchObject({
      status: "paid",
      paidAmountCents: 12500,
      parentPayment: {
        providerTransactionId: "pi_1",
      },
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"status":"paid"'),
      { expirationTtl: 14400 },
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:index",
      expect.stringContaining('"paymentStatus":"paid"'),
      { expirationTtl: 14400 },
    );
    expect(redeemSpy).toHaveBeenCalledWith({
      couponId: 42,
      code: "ASYNC10",
      name: "ASYNC10",
      discountCents: 1250,
      fundedBy: "platform",
      restaurantId: undefined,
      allocations: [
        { orderId: 1001, amountCents: 8000, discountCents: 800 },
        { orderId: 1002, amountCents: 4500, discountCents: 450 },
      ],
    });
    redeemSpy.mockRestore();
  });

  it("deduplicates provider events through payment audit log", async () => {
    const rawBody = JSON.stringify({
      id: "evt_duplicate",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_duplicate",
          metadata: { marketCheckoutId: "checkout-1" },
        },
      },
    });
    const env = createEnv({
      auditInserted: false,
      paymentRow: paymentRow(),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "stripe",
      rawBody,
      new Headers({
        "stripe-signature": await stripeSignature("market-secret", rawBody),
      }),
    );

    expect(result).toMatchObject({
      duplicate: true,
      reconciled: false,
    });
    expect(
      vi
        .mocked(env.DB.prepare)
        .mock.calls.some(([sql]) =>
          normalizeSql(sql).includes("update market_checkout_payments"),
        ),
    ).toBe(false);
  });

  it("ignores signed provider events that do not map to a payment status", async () => {
    const rawBody = JSON.stringify({
      id: "evt_unknown",
      type: "customer.created",
      data: {
        object: {
          id: "cus_1",
        },
      },
    });
    const env = createEnv({
      paymentRow: paymentRow(),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "stripe",
      rawBody,
      new Headers({
        "stripe-signature": await stripeSignature("market-secret", rawBody),
      }),
    );

    expect(result).toEqual({
      provider: "stripe",
      eventId: "evt_unknown",
      eventType: "customer.created",
      duplicate: false,
      reconciled: false,
    });
    const prepareCalls = vi.mocked(env.DB.prepare).mock.calls;
    expect(
      prepareCalls.some(([sql]) => sql.includes("payment_audit_log")),
    ).toBe(false);
    expect(
      prepareCalls.some(([sql]) =>
        normalizeSql(sql).includes("update market_checkout_payments"),
      ),
    ).toBe(false);
  });

  it("requires a payment, checkout, or provider transaction identifier", async () => {
    const rawBody = JSON.stringify({
      id: "evt_missing_identifier",
      type: "payment_intent.succeeded",
    });
    const env = createEnv({
      paymentRow: paymentRow(),
    });

    await expect(
      new MarketCheckoutPaymentWebhookService(env).handle(
        "stripe",
        rawBody,
        new Headers({
          "stripe-signature": await stripeSignature("market-secret", rawBody),
        }),
      ),
    ).rejects.toMatchObject({
      code: "MARKET_CHECKOUT_PAYMENT_IDENTIFIER_REQUIRED",
      status: 400,
    });

    const prepareCalls = vi.mocked(env.DB.prepare).mock.calls;
    expect(
      prepareCalls.some(([sql]) => sql.includes("payment_audit_log")),
    ).toBe(true);
    expect(
      prepareCalls.some(([sql]) =>
        normalizeSql(sql).includes("update market_checkout_payments"),
      ),
    ).toBe(false);
  });

  it("rejects reconciliable provider events when the payment row is missing", async () => {
    const rawBody = JSON.stringify({
      id: "evt_missing_payment",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_missing",
          metadata: {
            marketCheckoutId: "checkout-missing",
          },
        },
      },
    });
    const env = createEnv({
      paymentRow: null,
    });

    await expect(
      new MarketCheckoutPaymentWebhookService(env).handle(
        "stripe",
        rawBody,
        new Headers({
          "stripe-signature": await stripeSignature("market-secret", rawBody),
        }),
      ),
    ).rejects.toMatchObject({
      code: "MARKET_CHECKOUT_PAYMENT_NOT_FOUND",
      status: 404,
    });

    expect(
      vi
        .mocked(env.DB.prepare)
        .mock.calls.some(([sql]) =>
          normalizeSql(sql).includes("update market_checkout_payments"),
        ),
    ).toBe(false);
  });

  it("reconciles the mock provider paid webhook fixture", async () => {
    const rawBody = JSON.stringify(
      mockMarketCheckoutProviderPaidWebhookPayload,
    );
    const env = createEnv({
      paymentRow: paymentRow({
        provider: "mock_market_provider",
        amount_cents: 24000,
        provider_transaction_id: "intent-market-checkout-1",
        session_payment_summary: JSON.stringify({
          status: "pending",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 240,
          totalAmountCents: 24000,
          paidAmount: 0,
          paidAmountCents: 0,
          childPayments: [],
        }),
      }),
    });
    const headers = new Headers({
      "x-webhook-signature": await signMockMarketCheckoutWebhook(
        "market-secret",
        rawBody,
      ),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "mock_market_provider",
      rawBody,
      headers,
    );

    expect(result).toMatchObject({
      provider: "mock_market_provider",
      eventId: "evt-market-checkout-paid-1",
      eventType: "market_checkout.payment_paid",
      reconciled: true,
      status: "paid",
    });
  });

  it("reconciles a signed LINE Pay confirm result in whole TWD", async () => {
    // LINE Pay's confirm response: whole-TWD amounts, a 19-digit numeric
    // transactionId, and no currency (the adapter adds the one it confirmed).
    const rawBody = `{"returnCode":"0000","returnMessage":"Success.","currency":"TWD","info":{"orderId":"market_pay_checkout-1","transactionId":2018082512345678910,"payInfo":[{"method":"CREDIT_CARD","amount":100},{"method":"POINT","amount":25}]}}`;
    const env = createEnv({
      paymentRow: paymentRow({
        provider: "linepay",
        provider_transaction_id: "linepay-txn-1",
      }),
      cachedSession: {
        id: "checkout-1",
        payment: { status: "pending" },
      },
    });
    const { nonce, signature } = await linePaySignature(
      "market-secret",
      rawBody,
    );

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "linepay",
      rawBody,
      new Headers({
        "x-linepay-nonce": nonce,
        "x-linepay-signature": signature,
      }),
    );

    expect(result).toMatchObject({
      provider: "linepay",
      eventId: "linepay-confirm:2018082512345678910",
      duplicate: false,
      reconciled: true,
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      status: "paid",
    });
    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining([
        "paid",
        12500,
        0,
        "2018082512345678910",
        "market_pay_checkout-1",
      ]),
    );
  });

  it("reads LINE Pay amounts as whole TWD, so a cents-sized amount is held for review", async () => {
    // NT$125 checkout; 12500 on the LINE Pay route means NT$12,500.
    const rawBody = JSON.stringify({
      id: "linepay-event-cents",
      type: "market_checkout.payment_paid",
      amount_received: 12500,
      currency: "TWD",
      metadata: { marketCheckoutId: "checkout-1" },
    });
    const env = createEnv({ paymentRow: paymentRow({ provider: "linepay" }) });
    const { nonce, signature } = await linePaySignature(
      "market-secret",
      rawBody,
    );

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "linepay",
      rawBody,
      new Headers({
        "x-linepay-nonce": nonce,
        "x-linepay-signature": signature,
      }),
    );

    expect(result).toMatchObject({
      reconciled: false,
      reviewRequired: true,
      reviewReason: "AMOUNT_MISMATCH",
    });
    expectHeldForReview(env, "AMOUNT_MISMATCH", 1250000);
  });

  it("ignores a LINE Pay confirm that did not succeed", async () => {
    const rawBody = JSON.stringify({
      returnCode: "1150",
      returnMessage: "Transaction record not found.",
      info: { orderId: "market_pay_checkout-1", transactionId: "1" },
    });
    const env = createEnv({ paymentRow: paymentRow({ provider: "linepay" }) });
    const { nonce, signature } = await linePaySignature(
      "market-secret",
      rawBody,
    );

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "linepay",
      rawBody,
      new Headers({
        "x-linepay-nonce": nonce,
        "x-linepay-signature": signature,
      }),
    );

    expect(result).toMatchObject({ reconciled: false, duplicate: false });
    expect(result.status).toBeUndefined();
  });

  it("converts Stripe VND amounts from whole dong", async () => {
    // ₫100,000 is 10,000,000 internal cents and `amount_received: 100000`.
    const rawBody = JSON.stringify({
      id: "evt_vnd",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_vnd",
          object: "payment_intent",
          amount: 100000,
          amount_received: 100000,
          currency: "vnd",
          metadata: { marketCheckoutId: "checkout-1" },
        },
      },
    });
    const env = createEnv({
      paymentRow: paymentRow({
        amount_cents: 10000000,
        currency: "VND",
        country_code: "VN",
      }),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "stripe",
      rawBody,
      new Headers({
        "stripe-signature": await stripeSignature("market-secret", rawBody),
      }),
    );

    expect(result).toMatchObject({ reconciled: true, status: "paid" });
    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining(["paid", 10000000, 0, "pi_vnd"]),
    );
  });

  it.each([
    [
      "an underpaid Stripe VND intent",
      { amount_received: 99999, currency: "vnd" },
      { amount_cents: 10000000, currency: "VND" },
      "AMOUNT_MISMATCH",
      9999900,
    ],
    [
      "a payment in another currency",
      { amount_received: 12500, currency: "usd" },
      {},
      "CURRENCY_MISMATCH",
      null,
    ],
    [
      "a payment with no amount",
      { currency: "twd" },
      {},
      "AMOUNT_MISSING",
      null,
    ],
    [
      "a payment with no currency",
      { amount_received: 12500 },
      {},
      "CURRENCY_MISSING",
      null,
    ],
    [
      "a payment row with no currency to check against",
      { amount_received: 12500, currency: "twd" },
      { currency: null },
      "CURRENCY_MISSING",
      12500,
    ],
  ])(
    "holds %s for review instead of marking it paid",
    async (_label, object, rowOverrides, reason, reportedCents) => {
      const rawBody = JSON.stringify({
        id: "evt_review",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_review",
            object: "payment_intent",
            ...object,
            metadata: { marketCheckoutId: "checkout-1" },
          },
        },
      });
      const env = createEnv({ paymentRow: paymentRow(rowOverrides) });

      const result = await new MarketCheckoutPaymentWebhookService(env).handle(
        "stripe",
        rawBody,
        new Headers({
          "stripe-signature": await stripeSignature("market-secret", rawBody),
        }),
      );

      expect(result).toEqual({
        provider: "stripe",
        eventId: "evt_review",
        eventType: "payment_intent.succeeded",
        duplicate: false,
        reconciled: false,
        checkoutId: "checkout-1",
        paymentId: "market_pay_checkout-1",
        reviewRequired: true,
        reviewReason: reason,
      });
      expectHeldForReview(env, reason, reportedCents);
    },
  );

  it("settles a partial Stripe charge.refunded against the PaymentIntent", async () => {
    const rawBody = JSON.stringify({
      id: "evt_charge_refunded",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_1",
          object: "charge",
          amount: 12500,
          amount_captured: 12500,
          amount_refunded: 5000,
          refunded: false,
          currency: "twd",
          payment_intent: "pi_1",
          metadata: {},
        },
      },
    });
    const env = createEnv({
      paymentRow: paymentRow({
        status: "paid",
        paid_amount_cents: 12500,
        provider_transaction_id: "pi_1",
      }),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "stripe",
      rawBody,
      new Headers({
        "stripe-signature": await stripeSignature("market-secret", rawBody),
      }),
    );

    expect(result).toMatchObject({
      reconciled: true,
      status: "partial_refunded",
    });
    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining([
        "partial_refunded",
        12500,
        5000,
        "pi_1",
        "market_pay_checkout-1",
      ]),
    );
  });

  it.each([
    ["more than was paid", 12600, "AMOUNT_EXCEEDS_EXPECTED"],
    ["nothing", 0, "AMOUNT_MISMATCH"],
  ])("holds a refund of %s for review", async (_label, refunded, reason) => {
    const rawBody = JSON.stringify({
      id: "evt_refund_review",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_1",
          object: "charge",
          amount_refunded: refunded,
          currency: "twd",
          payment_intent: "pi_1",
        },
      },
    });
    const env = createEnv({
      paymentRow: paymentRow({ status: "paid", paid_amount_cents: 12500 }),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "stripe",
      rawBody,
      new Headers({
        "stripe-signature": await stripeSignature("market-secret", rawBody),
      }),
    );

    expect(result).toMatchObject({
      reviewRequired: true,
      reviewReason: reason,
    });
    expectHeldForReview(env, reason, refunded);
  });

  it("holds a refund event with no amount for review", async () => {
    const rawBody = JSON.stringify({
      id: "evt_refund_no_amount",
      type: "market_checkout.payment_refunded",
      currency: "TWD",
      metadata: { marketCheckoutId: "checkout-1" },
    });
    const env = createEnv({
      paymentRow: paymentRow({ status: "paid", paid_amount_cents: 12500 }),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "mock_market_provider",
      rawBody,
      new Headers({
        "x-webhook-signature": await signMockMarketCheckoutWebhook(
          "market-secret",
          rawBody,
        ),
      }),
    );

    expect(result).toMatchObject({
      reviewRequired: true,
      reviewReason: "AMOUNT_MISSING",
    });
  });

  it("holds a fractional internal-cents amount for review", async () => {
    const rawBody = JSON.stringify({
      id: "evt_fraction",
      type: "market_checkout.payment_paid",
      amount_cents: 12500.5,
      currency: "TWD",
      metadata: { marketCheckoutId: "checkout-1" },
    });
    const env = createEnv({
      paymentRow: paymentRow({ provider: "mock_market_provider" }),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "mock_market_provider",
      rawBody,
      new Headers({
        "x-webhook-signature": await signMockMarketCheckoutWebhook(
          "market-secret",
          rawBody,
        ),
      }),
    );

    expect(result).toMatchObject({
      reviewRequired: true,
      reviewReason: "AMOUNT_NOT_INTEGER",
    });
  });

  it("reconciles failed status payloads with payment summary fallbacks", async () => {
    const rawBody = JSON.stringify({
      id: "evt_failed_status",
      status: "failed",
      metadata: {
        market_checkout_payment_id: "market_pay_checkout-1",
        market_checkout_id: "checkout-1",
        provider_transaction_id: "txn_failed_1",
      },
    });
    const env = createEnv({
      paymentRow: paymentRow({
        provider: "",
        idempotency_key: null,
        paid_amount_cents: 2500,
        refunded_amount_cents: 300,
        currency: null,
        country_code: null,
        child_payment_ids: "not-json",
        provider_payload: null,
        session_payment_summary: null,
      }),
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "mock_market_provider",
      rawBody,
      new Headers({
        "x-webhook-signature": await signMockMarketCheckoutWebhook(
          "market-secret",
          rawBody,
        ),
      }),
    );

    expect(result).toMatchObject({
      eventId: "evt_failed_status",
      eventType: "unknown",
      status: "failed",
      reconciled: true,
    });
    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining([
        "failed",
        2500,
        300,
        "txn_failed_1",
        expect.stringContaining('"status":"failed"'),
        "market_pay_checkout-1",
      ]),
    );

    const sessionParams = bindParamsFor(env, "UPDATE market_checkout_sessions");
    const paymentSummary = JSON.parse(String(sessionParams[1])) as {
      method: string;
      currency: string;
      country: string;
      failedAt: string;
      parentPayment: {
        provider: string;
        idempotencyKey: string;
        childPaymentIds: string[];
      };
    };
    expect(paymentSummary).toMatchObject({
      method: "",
      currency: "TWD",
      country: "TW",
      parentPayment: {
        provider: "mock_market_provider",
        idempotencyKey: "market-checkout:checkout-1",
        childPaymentIds: [],
      },
    });
    expect(paymentSummary.failedAt).toEqual(expect.any(String));
    expect(env.CACHE_KV.put).not.toHaveBeenCalled();
  });

  it("reconciles full refunds and preserves object-based summary details", async () => {
    const rawBody = JSON.stringify({
      data: {
        object: {
          id: "pi_refunded",
          amount_refunded: 12500,
          currency: "twd",
          metadata: {
            marketCheckoutId: "checkout-1",
          },
        },
      },
    });
    const env = createEnv({
      paymentRow: paymentRow({
        paid_amount_cents: 12500,
        provider_payload: "null",
        session_payment_summary: {
          method: "card",
          currency: "USD",
          country: "US",
          childPayments: [{ paymentId: "child-1" }],
          parentPayment: { note: "existing" },
        },
      }),
      cachedIndex: [{ id: "checkout-1", paymentStatus: "paid" }],
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "stripe",
      rawBody,
      new Headers({
        "x-provider-event-type": "charge.refunded",
        "stripe-signature": await stripeSignature("market-secret", rawBody),
      }),
    );

    expect(result).toMatchObject({
      eventId: "pi_refunded",
      eventType: "charge.refunded",
      status: "refunded",
      reconciled: true,
    });
    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining([
        "refunded",
        12500,
        12500,
        "pi_refunded",
        expect.stringContaining('"eventType":"charge.refunded"'),
        "market_pay_checkout-1",
      ]),
    );

    const sessionParams = bindParamsFor(env, "UPDATE market_checkout_sessions");
    const paymentSummary = JSON.parse(String(sessionParams[1])) as {
      method: string;
      currency: string;
      country: string;
      childPayments: unknown[];
      refundedAt: string;
      parentPayment: { note: string };
    };
    // The payment row's currency is authoritative over a stale summary.
    expect(paymentSummary).toMatchObject({
      method: "card",
      currency: "TWD",
      country: "US",
      childPayments: [{ paymentId: "child-1" }],
      parentPayment: { note: "existing" },
    });
    expect(paymentSummary.refundedAt).toEqual(expect.any(String));
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:index",
      expect.stringContaining('"paymentStatus":"refunded"'),
      { expirationTtl: 14400 },
    );
  });

  it("reconciles partial refunds and mixed cache index rows", async () => {
    const rawBody = JSON.stringify({
      data: {
        object: {
          status: "partially_refunded",
          amount_refunded: 5000,
          currency: "twd",
          metadata: {
            marketCheckoutId: "checkout-1",
          },
        },
      },
    });
    const env = createEnv({
      paymentRow: paymentRow({
        refunded_amount_cents: -50,
        provider_transaction_id: "existing-provider-txn",
        provider_payload: "{bad-json",
        child_payment_ids: JSON.stringify([123, "child-1", null, "child-2"]),
        session_payment_summary: "[]",
      }),
      cachedIndex: [
        null as unknown as Record<string, unknown>,
        { id: "checkout-2", paymentStatus: "paid" },
        { id: "checkout-1", paymentStatus: "paid" },
      ],
    });

    const result = await new MarketCheckoutPaymentWebhookService(env).handle(
      "stripe",
      rawBody,
      new Headers({
        "stripe-signature": await stripeSignature("market-secret", rawBody),
      }),
    );

    expect(result).toMatchObject({
      eventId: null,
      eventType: "unknown",
      status: "partial_refunded",
      reconciled: true,
    });
    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining([
        "partial_refunded",
        12500,
        5000,
        "existing-provider-txn",
        expect.stringContaining('"status":"partial_refunded"'),
        "market_pay_checkout-1",
      ]),
    );

    const sessionParams = bindParamsFor(env, "UPDATE market_checkout_sessions");
    const paymentSummary = JSON.parse(String(sessionParams[1])) as {
      childPayments: unknown[];
      parentPayment: {
        providerTransactionId: string;
        childPaymentIds: string[];
      };
      refundedAt: string;
    };
    expect(paymentSummary).toMatchObject({
      childPayments: [],
      parentPayment: {
        providerTransactionId: "existing-provider-txn",
        childPaymentIds: ["child-1", "child-2"],
      },
    });
    expect(paymentSummary.refundedAt).toEqual(expect.any(String));

    const indexPut = vi
      .mocked(env.CACHE_KV.put)
      .mock.calls.find(([key]) => key === "market_checkout:index");
    expect(indexPut?.[1]).toContain('"id":"checkout-2"');
    expect(indexPut?.[1]).toContain('"paymentStatus":"partial_refunded"');
  });

  it("skips cache index rewrites when the cached index is not an array", async () => {
    const rawBody = JSON.stringify({
      id: "evt_failed_cache",
      type: "payment_intent.payment_failed",
      metadata: {
        marketCheckoutId: "checkout-1",
      },
    });
    const env = createEnv({
      paymentRow: paymentRow(),
    });
    await env.CACHE_KV.put("market_checkout:index", JSON.stringify({}));
    vi.mocked(env.CACHE_KV.put).mockClear();

    await new MarketCheckoutPaymentWebhookService(env).handle(
      "stripe",
      rawBody,
      new Headers({
        "stripe-signature": await stripeSignature("market-secret", rawBody),
      }),
    );

    expect(
      vi
        .mocked(env.CACHE_KV.put)
        .mock.calls.some(([key]) => key === "market_checkout:index"),
    ).toBe(false);
  });

  it("rejects invalid provider signatures", async () => {
    const env = createEnv({
      paymentRow: paymentRow(),
    });

    await expect(
      new MarketCheckoutPaymentWebhookService(env).handle(
        "stripe",
        JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" }),
        new Headers({ "x-webhook-signature": "bad-signature" }),
      ),
    ).rejects.toThrow("Invalid webhook signature");
  });

  it("rejects unsigned provider events before mutating payment state", async () => {
    const env = createEnv({
      paymentRow: paymentRow(),
      cachedSession: {
        id: "checkout-1",
        payment: { status: "pending" },
      },
      cachedIndex: [{ id: "checkout-1", paymentStatus: "pending" }],
    });

    await expect(
      new MarketCheckoutPaymentWebhookService(env).handle(
        "stripe",
        JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" }),
        new Headers(),
      ),
    ).rejects.toThrow("Missing webhook signature");

    const prepareCalls = vi.mocked(env.DB.prepare).mock.calls;
    expect(
      prepareCalls.some(([sql]) => sql.includes("payment_audit_log")),
    ).toBe(false);
    expect(
      prepareCalls.some(([sql]) =>
        normalizeSql(sql).includes("update market_checkout_payments"),
      ),
    ).toBe(false);
    expect(env.CACHE_KV.put).not.toHaveBeenCalled();
  });

  it("uses the Stripe fallback secret and rejects missing webhook secrets", async () => {
    const rawBody = JSON.stringify({
      id: "evt_stripe_fallback",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_fallback",
          amount_received: 12500,
          currency: "twd",
          metadata: { marketCheckoutId: "checkout-1" },
        },
      },
    });
    const env = createEnv({
      paymentRow: paymentRow(),
    });
    env.MARKET_CHECKOUT_WEBHOOK_SECRET = undefined;
    env.STRIPE_WEBHOOK_SECRET = "stripe-secret";

    await expect(
      new MarketCheckoutPaymentWebhookService(env).handle(
        "stripe",
        rawBody,
        new Headers({
          "stripe-signature": await stripeSignature("stripe-secret", rawBody),
        }),
      ),
    ).resolves.toMatchObject({
      eventId: "evt_stripe_fallback",
      status: "paid",
      reconciled: true,
    });

    const missingSecretEnv = createEnv({
      paymentRow: paymentRow(),
    });
    missingSecretEnv.MARKET_CHECKOUT_WEBHOOK_SECRET = undefined;
    missingSecretEnv.STRIPE_WEBHOOK_SECRET = undefined;

    await expect(
      new MarketCheckoutPaymentWebhookService(missingSecretEnv).handle(
        "stripe",
        rawBody,
        new Headers({
          "stripe-signature": await stripeSignature("stripe-secret", rawBody),
        }),
      ),
    ).rejects.toThrow("Market checkout webhook secret is not configured");
  });

  it("rejects missing and invalid LINE Pay signatures", async () => {
    const rawBody = JSON.stringify({
      id: "linepay-event-invalid",
      type: "market_checkout.payment_paid",
    });
    const env = createEnv({
      paymentRow: paymentRow(),
    });

    await expect(
      new MarketCheckoutPaymentWebhookService(env).handle(
        "linepay",
        rawBody,
        new Headers(),
      ),
    ).rejects.toThrow("Missing LINE Pay webhook signature");

    await expect(
      new MarketCheckoutPaymentWebhookService(env).handle(
        "linepay",
        rawBody,
        new Headers({
          "x-linepay-nonce": "nonce",
          "x-linepay-signature": "invalid",
        }),
      ),
    ).rejects.toThrow("Invalid LINE Pay webhook signature");
  });
});

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

async function hmacSha256Base64(secret: string, value: string) {
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
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
