import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";
import { MarketCheckoutPaymentReconciliationService } from "./MarketCheckoutPaymentReconciliationService";
import { MarketCheckoutVoucherService } from "./MarketCheckoutVoucherService";

function createEnv(options: {
  paymentRow?: Record<string, unknown> | null;
  pendingRows?: Array<Record<string, unknown>>;
  cachedSession?: Record<string, unknown> | null;
  cachedIndex?: unknown;
}): Env {
  const kv = new Map<string, string>();
  if (options.cachedSession) {
    kv.set(
      `market_checkout:${options.paymentRow?.checkout_id ?? "checkout-1"}`,
      JSON.stringify(options.cachedSession),
    );
  }
  if (options.cachedIndex !== undefined) {
    kv.set("market_checkout:index", JSON.stringify(options.cachedIndex));
  }

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        raw: vi.fn(async () => {
          if (!sql.includes("market_checkout_payments")) return [];
          if (sql.includes('where "market_checkout_payments"."checkout_id"')) {
            return options.paymentRow == null
              ? []
              : [paymentRowToRaw(options.paymentRow)];
          }
          return (options.pendingRows ?? []).map(paymentRowToRaw);
        }),
        first: vi.fn(async () => {
          if (sql.includes("FROM market_checkout_payments")) {
            return options.paymentRow ?? null;
          }
          return null;
        }),
        all: vi.fn(async () => ({
          results: options.pendingRows ?? [],
        })),
        run: vi.fn(async () => ({
          meta: { changes: 1 },
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
    provider_transaction_id: "pi_1",
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

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replaceAll('"', "");
}

describe("MarketCheckoutPaymentReconciliationService", () => {
  it("builds status lookup input and reports missing or unsupported payments", async () => {
    await expect(
      new MarketCheckoutPaymentReconciliationService(
        createEnv({ paymentRow: null }),
      ).getStatusLookupInput("checkout-1"),
    ).rejects.toMatchObject({
      code: "MARKET_CHECKOUT_PAYMENT_NOT_FOUND",
      status: 404,
    });

    await expect(
      new MarketCheckoutPaymentReconciliationService(
        createEnv({
          paymentRow: paymentRow({ split_mode: "child_transactions" }),
        }),
      ).getStatusLookupInput("checkout-1"),
    ).rejects.toMatchObject({
      code: "MARKET_CHECKOUT_RECONCILIATION_UNSUPPORTED",
      status: 400,
    });

    await expect(
      new MarketCheckoutPaymentReconciliationService(
        createEnv({
          paymentRow: paymentRow({
            provider_transaction_id: null,
            idempotency_key: null,
            currency: null,
            country_code: null,
          }),
        }),
      ).getStatusLookupInput("checkout-1"),
    ).resolves.toEqual({
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      provider: "stripe",
      amountCents: 12500,
      providerTransactionId: undefined,
      idempotencyKey: undefined,
      currency: undefined,
      country: undefined,
    });
  });

  it("lists pending provider status lookup inputs and caches rows for reconciliation", async () => {
    const env = createEnv({
      pendingRows: [
        paymentRow({
          checkout_id: "checkout-1",
          payment_id: "payment-1",
          provider_transaction_id: null,
          idempotency_key: null,
          currency: null,
          country_code: null,
        }),
        paymentRow({
          checkout_id: "checkout-2",
          payment_id: "payment-2",
          provider: "mock_market_provider",
          provider_transaction_id: "intent-2",
          idempotency_key: "idem-2",
          currency: "MYR",
          country_code: "MY",
        }),
      ],
    });
    const service = new MarketCheckoutPaymentReconciliationService(env);

    await expect(
      service.listPendingStatusLookupInputs({
        updatedBeforeMs: 1780308000000,
        limit: 2,
      }),
    ).resolves.toEqual([
      {
        checkoutId: "checkout-1",
        paymentId: "payment-1",
        provider: "stripe",
        amountCents: 12500,
        providerTransactionId: undefined,
        idempotencyKey: undefined,
        currency: undefined,
        country: undefined,
      },
      {
        checkoutId: "checkout-2",
        paymentId: "payment-2",
        provider: "mock_market_provider",
        amountCents: 12500,
        providerTransactionId: "intent-2",
        idempotencyKey: "idem-2",
        currency: "MYR",
        country: "MY",
      },
    ]);
    expect(bindParamsFor(env, "updated_at_ms")).toEqual(
      expect.arrayContaining([1780308000000, 2]),
    );

    const result = await service.reconcile("checkout-2", {
      provider: "mock_market_provider",
      providerTransactionId: "intent-2",
      status: "failed",
      providerPayload: { reason: "declined" },
    });

    expect(result).toMatchObject({
      provider: "mock_market_provider",
      checkoutId: "checkout-2",
      paymentId: "payment-2",
      status: "failed",
      providerTransactionId: "intent-2",
      eventType: "market_checkout.payment_failed",
    });
    expect(
      vi
        .mocked(env.DB.prepare)
        .mock.calls.filter(([sql]) => sql.includes("WHERE p.checkout_id = ?")),
    ).toHaveLength(0);
  });

  it("rejects reconciliation when payment lookup, split mode, or provider mismatch is invalid", async () => {
    await expect(
      new MarketCheckoutPaymentReconciliationService(
        createEnv({ paymentRow: null }),
      ).reconcile("checkout-1", {
        provider: "stripe",
        status: "paid",
      }),
    ).rejects.toMatchObject({
      code: "MARKET_CHECKOUT_PAYMENT_NOT_FOUND",
      status: 404,
    });

    await expect(
      new MarketCheckoutPaymentReconciliationService(
        createEnv({
          paymentRow: paymentRow({ split_mode: "child_transactions" }),
        }),
      ).reconcile("checkout-1", {
        provider: "stripe",
        status: "paid",
      }),
    ).rejects.toMatchObject({
      code: "MARKET_CHECKOUT_RECONCILIATION_UNSUPPORTED",
      status: 400,
    });

    await expect(
      new MarketCheckoutPaymentReconciliationService(
        createEnv({ paymentRow: paymentRow({ provider: "stripe" }) }),
      ).reconcile("checkout-1", {
        provider: "mock_market_provider",
        status: "paid",
      }),
    ).rejects.toMatchObject({
      code: "MARKET_CHECKOUT_RECONCILIATION_PROVIDER_MISMATCH",
      status: 409,
    });
  });

  it("reconciles paid statuses, updates caches, and redeems cached vouchers", async () => {
    const redeemSpy = vi
      .spyOn(MarketCheckoutVoucherService.prototype, "redeem")
      .mockResolvedValueOnce();
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
          ],
        },
      },
      cachedIndex: [{ id: "checkout-1", paymentStatus: "pending" }],
    });

    const result = await new MarketCheckoutPaymentReconciliationService(
      env,
    ).reconcile("checkout-1", {
      provider: "stripe",
      status: "paid",
      amountReceivedCents: 12500,
      currency: "TWD",
      eventId: "evt_reconcile_paid",
    });

    expect(result).toMatchObject({
      provider: "stripe",
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      status: "paid",
      providerTransactionId: "pi_1",
      eventId: "evt_reconcile_paid",
      eventType: "market_checkout.payment_paid",
    });
    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining([
        "paid",
        12500,
        0,
        "pi_1",
        expect.stringContaining('"eventId":"evt_reconcile_paid"'),
        "market_pay_checkout-1",
      ]),
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"paidAt"'),
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
      allocations: [{ orderId: 1001, amountCents: 8000, discountCents: 800 }],
    });
    redeemSpy.mockRestore();
  });

  it("reconciles failed statuses with empty summary and provider payload fallbacks", async () => {
    const env = createEnv({
      paymentRow: paymentRow({
        provider: "mock_market_provider",
        paid_amount_cents: 2500,
        refunded_amount_cents: 300,
        currency: null,
        country_code: null,
        child_payment_ids: null,
        provider_transaction_id: null,
        provider_payload: null,
        session_payment_summary: null,
      }),
      cachedIndex: {},
    });

    await new MarketCheckoutPaymentReconciliationService(env).reconcile(
      "checkout-1",
      {
        provider: "mock_market_provider",
        providerTransactionId: "txn_failed",
        status: "failed",
        eventType: "provider.failed",
      },
    );

    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining([
        "failed",
        2500,
        300,
        "txn_failed",
        expect.stringContaining('"eventType":"provider.failed"'),
        "market_pay_checkout-1",
      ]),
    );

    const sessionParams = bindParamsFor(env, "UPDATE market_checkout_sessions");
    const paymentSummary = JSON.parse(String(sessionParams[1])) as {
      currency: string;
      country: string;
      failedAt: string;
      parentPayment: {
        providerTransactionId: string;
        childPaymentIds: string[];
      };
    };
    expect(paymentSummary).toMatchObject({
      country: "TW",
      parentPayment: {
        providerTransactionId: "txn_failed",
        childPaymentIds: [],
      },
    });
    // No currency anywhere: say nothing rather than invent TWD.
    expect(paymentSummary.currency).toBeUndefined();
    expect(paymentSummary.failedAt).toEqual(expect.any(String));
    expect(env.CACHE_KV.put).not.toHaveBeenCalled();
  });

  it("reconciles refunds and preserves object-based summary details", async () => {
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

    const result = await new MarketCheckoutPaymentReconciliationService(
      env,
    ).reconcile("checkout-1", {
      provider: "stripe",
      providerTransactionId: "refund-txn",
      status: "refunded",
      amountRefundedCents: 12500,
      currency: "TWD",
      providerPayload: { refundId: "refund-1" },
    });

    expect(result).toMatchObject({
      status: "refunded",
      providerTransactionId: "refund-txn",
      eventType: "market_checkout.payment_refunded",
    });
    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining([
        "refunded",
        12500,
        12500,
        "refund-txn",
        expect.stringContaining('"refundId":"refund-1"'),
        "market_pay_checkout-1",
      ]),
    );

    const sessionParams = bindParamsFor(env, "UPDATE market_checkout_sessions");
    const paymentSummary = JSON.parse(String(sessionParams[1])) as {
      method: string;
      childPayments: unknown[];
      parentPayment: { note: string };
      refundedAt: string;
    };
    expect(paymentSummary).toMatchObject({
      method: "card",
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
    const env = createEnv({
      paymentRow: paymentRow({
        refunded_amount_cents: -50,
        provider_payload: "{bad-json",
        child_payment_ids: JSON.stringify([123, "child-1", null, "child-2"]),
        session_payment_summary: "[]",
      }),
      cachedIndex: [
        null,
        { id: "checkout-2", paymentStatus: "paid" },
        { id: "checkout-1", paymentStatus: "paid" },
      ],
    });

    await new MarketCheckoutPaymentReconciliationService(env).reconcile(
      "checkout-1",
      {
        provider: "stripe",
        status: "partial_refunded",
        amountRefundedCents: 5000,
        currency: "TWD",
      },
    );

    expect(bindParamsFor(env, "update market_checkout_payments")).toEqual(
      expect.arrayContaining([
        "partial_refunded",
        12500,
        5000,
        "pi_1",
        expect.stringContaining('"status":"partial_refunded"'),
        "market_pay_checkout-1",
      ]),
    );

    const sessionParams = bindParamsFor(env, "UPDATE market_checkout_sessions");
    const paymentSummary = JSON.parse(String(sessionParams[1])) as {
      childPayments: unknown[];
      parentPayment: {
        childPaymentIds: string[];
      };
      refundedAt: string;
    };
    expect(paymentSummary).toMatchObject({
      childPayments: [],
      parentPayment: {
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
  it("settles a refund status by amount, not by the provider's label", async () => {
    const env = createEnv({
      paymentRow: paymentRow({ status: "paid", paid_amount_cents: 12500 }),
    });

    const result = await new MarketCheckoutPaymentReconciliationService(
      env,
    ).reconcile("checkout-1", {
      provider: "stripe",
      status: "refunded",
      amountRefundedCents: 5000,
      currency: "TWD",
    });

    expect(result).toMatchObject({ status: "partial_refunded" });
    expect(result.reviewRequired).toBeUndefined();
  });

  it.each([
    [
      "an underpaid amount",
      { status: "paid" as const, amountReceivedCents: 12400, currency: "TWD" },
      "AMOUNT_MISMATCH",
    ],
    [
      "a missing amount",
      { status: "paid" as const, currency: "TWD" },
      "AMOUNT_MISSING",
    ],
    [
      "another currency",
      { status: "paid" as const, amountReceivedCents: 12500, currency: "USD" },
      "CURRENCY_MISMATCH",
    ],
    [
      "no currency",
      { status: "paid" as const, amountReceivedCents: 12500 },
      "CURRENCY_MISSING",
    ],
    [
      "a refund larger than the payment",
      {
        status: "refunded" as const,
        amountRefundedCents: 13000,
        currency: "TWD",
      },
      "AMOUNT_EXCEEDS_EXPECTED",
    ],
    [
      "a refund with no amount",
      { status: "partial_refunded" as const, currency: "TWD" },
      "AMOUNT_MISSING",
    ],
    [
      "a refund of nothing",
      {
        status: "partial_refunded" as const,
        amountRefundedCents: 0,
        currency: "TWD",
      },
      "AMOUNT_MISMATCH",
    ],
  ])(
    "holds %s for review without applying it",
    async (_label, patch, reason) => {
      const env = createEnv({ paymentRow: paymentRow() });

      const result = await new MarketCheckoutPaymentReconciliationService(
        env,
      ).reconcile("checkout-1", {
        provider: "stripe",
        eventId: "evt_lookup",
        ...patch,
      });

      expect(result).toMatchObject({
        checkoutId: "checkout-1",
        paymentId: "market_pay_checkout-1",
        status: "pending",
        reviewRequired: true,
        reviewReason: reason,
      });
      const paymentUpdate = bindParamsFor(
        env,
        "update market_checkout_payments",
      );
      expect(paymentUpdate).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"status":"review_required"'),
          "market_pay_checkout-1",
        ]),
      );
      expect(paymentUpdate).not.toContain("paid");
      const auditPrepare = vi
        .mocked(env.DB.prepare)
        .mock.calls.findIndex(([sql]) => sql.includes("payment_audit_log"));
      expect(auditPrepare).toBeGreaterThanOrEqual(0);
      const auditBind = vi.mocked(env.DB.prepare).mock.results[auditPrepare]
        ?.value.bind;
      expect(vi.mocked(auditBind).mock.calls[0]).toEqual(
        expect.arrayContaining([
          "failure",
          "evt_lookup:review",
          `MARKET_CHECKOUT_RECONCILIATION_${reason}`,
        ]),
      );
      expect(
        vi
          .mocked(env.DB.prepare)
          .mock.calls.some(([sql]) =>
            sql.toLowerCase().includes('update "market_checkout_sessions"'),
          ),
      ).toBe(false);
      expect(env.CACHE_KV.put).not.toHaveBeenCalled();
    },
  );
});
