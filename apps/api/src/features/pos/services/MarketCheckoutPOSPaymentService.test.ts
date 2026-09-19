import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";
import { MarketCheckoutPOSPaymentService } from "./MarketCheckoutPOSPaymentService";

function createEnv() {
  const kv = new Map<string, string>();
  kv.set(
    "market_checkout:checkout-1",
    JSON.stringify({ id: "checkout-1", payment: { status: "pending" } }),
  );
  kv.set(
    "market_checkout:index",
    JSON.stringify([{ id: "checkout-1", paymentStatus: "pending" }]),
  );

  const preparedStatements: Array<{
    sql: string;
    bind: ReturnType<typeof vi.fn>;
  }> = [];

  const db = {
    prepare: vi.fn((sql: string) => {
      const statement = {
        sql,
        bind: vi.fn((...params: unknown[]) => ({
          first: vi.fn(async () => firstRowFor(sql)),
          all: vi.fn(async () => ({ results: allRowsFor(sql) })),
          raw: vi.fn(async () => {
            const rows = allRowsFor(sql);
            if (rows.length > 0) return rows.map((row) => Object.values(row));
            const row = firstRowFor(sql);
            return row ? [Object.values(row)] : [];
          }),
          run: vi.fn(async () => ({ meta: { changes: 1 }, params })),
        })),
      };
      preparedStatements.push(statement);
      return statement;
    }),
    batch: vi.fn(async (statements: unknown[]) => statements),
  };

  return {
    env: {
      DB: db,
      CACHE_KV: {
        get: vi.fn(async (key: string) => kv.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
          kv.set(key, value);
        }),
        delete: vi.fn(),
      },
    } as unknown as Env,
    preparedStatements,
  };
}

function firstRowFor(sql: string) {
  const normalizedSql = sql.toLowerCase();
  if (normalizedSql.includes('from "market_checkout_sessions"')) {
    return {
      id: "checkout-1",
      market_id: "market-1",
      market_slug: "fengjia",
      market_name: "逢甲夜市",
      platform_fee_rate_bps: 350,
      payment_status: "pending",
      payment_summary: null,
      subtotal_cents: 20000,
      child_order_count: 2,
      created_at_ms: Date.parse("2026-06-01T10:00:00.000Z"),
    };
  }
  if (normalizedSql.includes('from "cash_shifts"')) {
    return {
      shift_id: "11111111-1111-4111-8111-111111111111",
      register_id: "22222222-2222-4222-8222-222222222222",
      restaurant_id: "restaurant-1",
    };
  }
  return null;
}

function allRowsFor(sql: string) {
  const normalizedSql = sql.toLowerCase();
  if (normalizedSql.includes('from "market_checkout_child_orders"')) {
    return [
      {
        restaurant_id: "restaurant-1",
        restaurant_name: "雞排攤",
        order_id: 1001,
        order_number: "A001",
        total_amount_cents: 12000,
      },
      {
        restaurant_id: "restaurant-2",
        restaurant_name: "甜點攤",
        order_id: 1002,
        order_number: "A002",
        total_amount_cents: 8000,
      },
    ];
  }
  return [];
}

describe("MarketCheckoutPOSPaymentService", () => {
  it("records a POS payment for the checkout, child orders, and active shift", async () => {
    const { env, preparedStatements } = createEnv();

    const result = await new MarketCheckoutPOSPaymentService(env).process({
      checkoutId: "checkout-1",
      registerId: "22222222-2222-4222-8222-222222222222",
      shiftId: "11111111-1111-4111-8111-111111111111",
      paymentMethod: "cash",
      country: "TW",
      currency: "TWD",
      operatorId: "user-7",
      operatorRole: 4,
      operatorRestaurantId: "restaurant-1",
      idempotencyKey: "pos-checkout-1",
    });

    expect(result.payment).toMatchObject({
      status: "paid",
      method: "pos_cash",
      totalAmountCents: 20000,
      paidAmountCents: 20000,
      parentPayment: {
        paymentId: "market_pay_checkout-1",
        provider: "pos_cash",
        idempotencyKey: "pos-checkout-1",
      },
    });
    expect(result.checkout.childOrders).toEqual([
      expect.objectContaining({
        orderId: 1001,
        totalAmount: 120,
        totalAmountCents: 12000,
      }),
      expect.objectContaining({
        orderId: 1002,
        totalAmount: 80,
        totalAmountCents: 8000,
      }),
    ]);

    const preparedSql = vi
      .mocked(env.DB.prepare)
      .mock.calls.map(([sql]) => sql);
    expect(
      preparedSql.some((sql) => sql.includes("payment_transactions")),
    ).toBe(true);
    expect(
      preparedSql.some((sql) => sql.toLowerCase().includes('update "orders"')),
    ).toBe(true);
    expect(
      preparedSql.some((sql) => sql.includes("market_checkout_payments")),
    ).toBe(true);
    expect(
      preparedSql.some((sql) =>
        sql.toLowerCase().includes('update "cash_shifts"'),
      ),
    ).toBe(true);
    expect(preparedSql.some((sql) => sql.includes("cash_movements"))).toBe(
      true,
    );
    const boundParams = preparedStatements.flatMap((statement) =>
      statement.bind.mock.calls.flat(),
    );
    expect(boundParams.filter((param) => param instanceof Date)).toEqual([]);
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:index",
      expect.stringContaining('"paymentStatus":"paid"'),
      { expirationTtl: 14400 },
    );
  });
  it.each([
    // 3.5% of NT$120 = NT$4.20 -> NT$4; of NT$80 = NT$2.80 -> NT$3.
    ["TWD", "TW", [400, 300], [11600, 7700]],
    // MYR keeps sen: RM4.20 and RM2.80.
    ["MYR", "MY", [420, 280], [11580, 7720]],
  ] as const)(
    "rounds each vendor's platform fee on the %s step",
    async (currency, country, fees, nets) => {
      const { env } = createEnv();

      const result = await new MarketCheckoutPOSPaymentService(env).process({
        checkoutId: "checkout-1",
        registerId: "22222222-2222-4222-8222-222222222222",
        shiftId: "11111111-1111-4111-8111-111111111111",
        paymentMethod: "cash",
        country,
        currency,
        operatorId: "user-7",
        operatorRole: 4,
        operatorRestaurantId: "restaurant-1",
        idempotencyKey: `pos-checkout-${currency}`,
      });

      const settlement = (
        result.payment as {
          settlement: {
            platformFeeCents: number;
            vendorAllocations: Array<{
              platformFeeCents: number;
              netAmountCents: number;
            }>;
          };
        }
      ).settlement;
      expect(
        settlement.vendorAllocations.map((a) => a.platformFeeCents),
      ).toEqual(fees);
      expect(settlement.vendorAllocations.map((a) => a.netAmountCents)).toEqual(
        nets,
      );
      expect(settlement.platformFeeCents).toBe(fees[0] + fees[1]);
    },
  );
});
