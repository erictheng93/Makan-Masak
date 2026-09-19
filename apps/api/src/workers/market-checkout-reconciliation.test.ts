import { describe, expect, it, vi } from "vitest";
import { reconcilePendingMarketCheckoutPayments } from "./market-checkout-reconciliation";
import { mockMarketCheckoutProviderPaidStatusResponse } from "../features/market-checkouts/testing/mockMarketCheckoutProviderContract";
import { MarketCheckoutVoucherService } from "../features/market-checkouts/services/MarketCheckoutVoucherService";

function createEnv(rows: unknown[]) {
  const kv = new Map<string, string>();
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((..._args: unknown[]) => ({
      raw: vi.fn(async () => {
        if (sql.includes("market_checkout_payments")) {
          return rows.map(paymentRowToRaw);
        }
        return [];
      }),
      all: vi.fn(async () => {
        if (sql.includes("market_checkout_payments")) {
          return { results: rows };
        }
        return { results: [] };
      }),
      first: vi.fn(async () => {
        if (sql.includes("market_checkout_payments")) {
          return rows[0] ?? null;
        }
        return null;
      }),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
    })),
  }));

  return {
    DB: { prepare },
    CACHE_KV: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kv.set(key, value);
      }),
    },
    MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
    MARKET_CHECKOUT_PROVIDER_STATUS_URL:
      "https://payments.example.test/market-split/status",
    MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "provider-token",
  };
}

function paymentRowToRaw(row: unknown): unknown[] {
  const payment = row as Record<string, unknown>;
  return [
    payment.payment_id,
    payment.checkout_id,
    payment.market_id,
    payment.provider,
    payment.split_mode,
    payment.idempotency_key,
    payment.status,
    payment.amount_cents,
    payment.paid_amount_cents,
    payment.refunded_amount_cents,
    payment.currency,
    payment.country_code,
    payment.child_payment_ids,
    payment.provider_transaction_id,
    payment.provider_payload,
    payment.created_at_ms,
    payment.updated_at_ms,
    payment.session_payment_summary,
  ];
}

function preparedSqlIncludes(
  env: ReturnType<typeof createEnv>,
  fragment: string,
) {
  const normalizedFragment = normalizeSql(fragment);
  return env.DB.prepare.mock.calls.some(([sql]) =>
    normalizeSql(sql).includes(normalizedFragment),
  );
}

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replaceAll('"', "");
}

describe("reconcilePendingMarketCheckoutPayments", () => {
  it("reconciles stale pending provider split payments through provider status lookup", async () => {
    const redeemSpy = vi
      .spyOn(MarketCheckoutVoucherService.prototype, "redeem")
      .mockResolvedValueOnce();
    const staleUpdatedAt = Date.parse("2026-06-01T10:00:00.000Z");
    const env = createEnv([
      {
        payment_id: "market_pay_checkout-1",
        checkout_id: "checkout-1",
        market_id: "market-1",
        provider: "mock_market_provider",
        split_mode: "provider_split",
        idempotency_key: "market-checkout:checkout-1",
        status: "pending",
        amount_cents: 24000,
        paid_amount_cents: 0,
        refunded_amount_cents: 0,
        currency: "TWD",
        country_code: "TW",
        child_payment_ids: JSON.stringify([]),
        provider_transaction_id: "intent-market-checkout-1",
        provider_payload: JSON.stringify({ source: "market-checkouts" }),
        created_at_ms: staleUpdatedAt - 60_000,
        updated_at_ms: staleUpdatedAt,
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
      },
    ]);
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        payment: { status: "pending" },
        appliedVoucher: {
          couponId: 42,
          code: "ASYNC10",
          name: "ASYNC10",
          discountCents: 2400,
          allocations: [
            { orderId: 1001, amountCents: 16000, discountCents: 1600 },
            { orderId: 1002, amountCents: 8000, discountCents: 800 },
          ],
        },
      }),
    );
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify(mockMarketCheckoutProviderPaidStatusResponse),
        ),
    );

    const result = await reconcilePendingMarketCheckoutPayments(env as never, {
      nowMs: Date.parse("2026-06-01T10:45:00.000Z"),
      pendingAfterMs: 30 * 60 * 1000,
      limit: 10,
      fetcher: fetcher as never,
    });

    expect(result).toMatchObject({
      scanned: 1,
      reconciled: 1,
      failed: 0,
      skipped: 0,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://payments.example.test/market-split/status",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer provider-token",
        }),
      }),
    );
    const request = (
      fetcher.mock.calls as unknown as Array<[string, RequestInit]>
    )[0]?.[1] as { body?: string } | undefined;
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      providerTransactionId: "intent-market-checkout-1",
    });
    expect(preparedSqlIncludes(env, "update market_checkout_payments")).toBe(
      true,
    );
    expect(redeemSpy).toHaveBeenCalledWith({
      couponId: 42,
      code: "ASYNC10",
      name: "ASYNC10",
      discountCents: 2400,
      fundedBy: "platform",
      restaurantId: undefined,
      allocations: [
        { orderId: 1001, amountCents: 16000, discountCents: 1600 },
        { orderId: 1002, amountCents: 8000, discountCents: 800 },
      ],
    });
    redeemSpy.mockRestore();
  });

  it("counts a status lookup with mismatched money as failed, not reconciled", async () => {
    const staleUpdatedAt = Date.parse("2026-06-01T10:00:00.000Z");
    const env = createEnv([
      {
        payment_id: "market_pay_checkout-1",
        checkout_id: "checkout-1",
        market_id: "market-1",
        provider: "mock_market_provider",
        split_mode: "provider_split",
        idempotency_key: "market-checkout:checkout-1",
        status: "pending",
        amount_cents: 24000,
        paid_amount_cents: 0,
        refunded_amount_cents: 0,
        currency: "TWD",
        country_code: "TW",
        child_payment_ids: JSON.stringify([]),
        provider_transaction_id: "intent-market-checkout-1",
        provider_payload: null,
        created_at_ms: staleUpdatedAt - 60_000,
        updated_at_ms: staleUpdatedAt,
        session_payment_summary: null,
      },
    ]);
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...mockMarketCheckoutProviderPaidStatusResponse,
            amountReceivedCents: 240,
          }),
        ),
    );

    const result = await reconcilePendingMarketCheckoutPayments(env as never, {
      nowMs: Date.parse("2026-06-01T10:45:00.000Z"),
      pendingAfterMs: 30 * 60 * 1000,
      limit: 10,
      fetcher: fetcher as never,
    });

    expect(result).toMatchObject({
      scanned: 1,
      reconciled: 0,
      failed: 1,
      skipped: 0,
      results: [
        {
          checkoutId: "checkout-1",
          paymentId: "market_pay_checkout-1",
          error: "Provider amount held for review: AMOUNT_MISMATCH",
        },
      ],
    });
    expect(preparedSqlIncludes(env, "update market_checkout_sessions")).toBe(
      false,
    );
  });

  it("reconciles stale pending provider split refunds through provider status lookup", async () => {
    const staleUpdatedAt = Date.parse("2026-06-01T10:00:00.000Z");
    const env = createEnv([
      {
        payment_id: "market_pay_checkout-1",
        checkout_id: "checkout-1",
        market_id: "market-1",
        provider: "mock_market_provider",
        split_mode: "provider_split",
        idempotency_key: "market-checkout:checkout-1",
        status: "paid",
        amount_cents: 24000,
        paid_amount_cents: 24000,
        refunded_amount_cents: 0,
        currency: "TWD",
        country_code: "TW",
        child_payment_ids: JSON.stringify(["mock-pay-101", "mock-pay-102"]),
        provider_transaction_id: "intent-market-checkout-1",
        provider_payload: JSON.stringify({
          source: "market-checkouts",
          lastRefund: {
            provider: "mock_market_provider",
            eventId: "refund-pending-1",
            eventType: "market_checkout.refund_pending",
            status: "pending",
            receivedAt: "2026-06-01T10:00:00.000Z",
          },
        }),
        created_at_ms: staleUpdatedAt - 60_000,
        updated_at_ms: staleUpdatedAt,
        session_payment_summary: JSON.stringify({
          status: "paid",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 240,
          totalAmountCents: 24000,
          paidAmount: 240,
          paidAmountCents: 24000,
          refundedAmount: 0,
          refundedAmountCents: 0,
          childPayments: [],
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "paid",
            provider: "mock_market_provider",
            splitMode: "provider_split",
            idempotencyKey: "market-checkout:checkout-1",
            providerTransactionId: "intent-market-checkout-1",
            amountCents: 24000,
            paidAmountCents: 24000,
            refundedAmountCents: 0,
            childPaymentIds: ["mock-pay-101", "mock-pay-102"],
            createdAt: "2026-06-01T09:59:00.000Z",
            updatedAt: "2026-06-01T10:00:00.000Z",
            lastRefund: {
              provider: "mock_market_provider",
              eventId: "refund-pending-1",
              eventType: "market_checkout.refund_pending",
              status: "pending",
              receivedAt: "2026-06-01T10:00:00.000Z",
            },
          },
        }),
      },
    ]);
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...mockMarketCheckoutProviderPaidStatusResponse,
            status: "refunded",
            amountReceivedCents: 24000,
            amountRefundedCents: 24000,
            eventId: "reconcile-refund-1",
            eventType: "market_checkout.payment_refunded",
          }),
        ),
    );

    const result = await reconcilePendingMarketCheckoutPayments(env as never, {
      nowMs: Date.parse("2026-06-01T10:45:00.000Z"),
      pendingAfterMs: 30 * 60 * 1000,
      limit: 10,
      fetcher: fetcher as never,
    });

    expect(result).toMatchObject({
      scanned: 1,
      reconciled: 1,
      failed: 0,
      skipped: 0,
    });
    const request = (
      fetcher.mock.calls as unknown as Array<[string, RequestInit]>
    )[0]?.[1] as { body?: string } | undefined;
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      providerTransactionId: "intent-market-checkout-1",
    });
    expect(preparedSqlIncludes(env, "update market_checkout_payments")).toBe(
      true,
    );
  });

  it("skips when provider status lookup is not configured", async () => {
    const env = createEnv([]);
    delete (env as { MARKET_CHECKOUT_PROVIDER_STATUS_URL?: string })
      .MARKET_CHECKOUT_PROVIDER_STATUS_URL;

    await expect(
      reconcilePendingMarketCheckoutPayments(env as never),
    ).resolves.toMatchObject({
      scanned: 0,
      reconciled: 0,
      failed: 0,
      skipped: 0,
      skippedReason: "provider_status_lookup_not_configured",
    });
  });
});
