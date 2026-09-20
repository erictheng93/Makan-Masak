import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  marketCheckoutChildOrders,
  marketCheckoutSessions,
  markets,
  orders,
  paymentTransactions,
  restaurants,
} from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import type { Env } from "../../../types/env";
import {
  MARKET_CHECKOUT_ORDER_PAYMENT_METHOD,
  marketCheckoutChildPaymentId,
  settleMarketCheckoutChildOrdersPaid,
  settleMarketCheckoutChildOrdersRefunded,
} from "./MarketCheckoutChildOrderSettlement";

/**
 * Driven against a real (in-memory, miniflare) D1 applied from
 * `migrations_fresh`, in the default unit project so it counts toward the
 * `apps/api/src/features/**` coverage gate.
 *
 * A mocked drizzle would not be worth much here: the things that can go wrong
 * are `ON CONFLICT DO NOTHING` on a second settlement, a `COALESCE` that must
 * not move `paid_at_ms`, and a `WHERE` that must exclude an already-refunded
 * order. All three are database behaviour.
 */
describe("MarketCheckoutChildOrderSettlement", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    vi.restoreAllMocks();
  });

  const CHECKOUT_ID = "checkout-settle-1";
  const PAYMENT_ID = "market_pay_checkout-settle-1";
  const VENDOR_A = "vendor-a";
  const VENDOR_B = "vendor-b";
  const ORDER_A = "order-a";
  const ORDER_B = "order-b";
  /** NT$179 and NT$52, the amounts from the reproduction. */
  const AMOUNT_A = 17_900;
  const AMOUNT_B = 5_200;
  const TOTAL = AMOUNT_A + AMOUNT_B;

  function createEnv(): Env {
    return {
      NODE_ENV: "test",
      JWT_SECRET: "test",
      API_VERSION: "v1",
      ENCRYPTION_KEY: "test",
      DB: testDb.bindings.DB,
      CACHE_KV: testDb.bindings.CACHE_KV,
    } as unknown as Env;
  }

  function paidInput(overrides: Record<string, unknown> = {}) {
    return {
      checkoutId: CHECKOUT_ID,
      marketCheckoutPaymentId: PAYMENT_ID,
      paymentMethod: MARKET_CHECKOUT_ORDER_PAYMENT_METHOD,
      gateway: "stripe",
      currency: "TWD",
      country: "TW",
      chargedTotalCents: TOTAL,
      providerTransactionId: "pi_checkout-settle-1",
      nowMs: 1_800_000_000_000,
      ...overrides,
    };
  }

  async function seedCheckout(
    options: {
      appliedVoucher?: Record<string, unknown> | null;
    } = {},
  ) {
    const created = new Date(Date.parse("2026-06-01T10:00:00.000Z"));
    const [market] = await testDb.drizzle
      .insert(markets)
      .values({
        id: "market-settle-1",
        slug: `settle-market-${crypto.randomUUID()}`,
        name: "測試夜市",
        type: "night_market",
        city: "台中市",
        district: "西屯區",
        address: "台中市西屯區文華路",
        latitude: 24.1764,
        longitude: 120.6466,
        platformFeeRateBps: 350,
        isActive: true,
        createdAt: created,
        updatedAt: created,
      })
      .returning();

    for (const [id, name] of [
      [VENDOR_A, "攤位 A"],
      [VENDOR_B, "攤位 B"],
    ]) {
      await testDb.drizzle.insert(restaurants).values({
        id,
        name,
        type: "台式",
        category: "小吃",
        address: "夜市 1 號",
        district: "西屯區",
        city: "台中市",
        phone: "0400000000",
        isActive: true,
        createdAt: created,
        updatedAt: created,
      });
    }

    await testDb.drizzle.insert(marketCheckoutSessions).values({
      id: CHECKOUT_ID,
      marketId: market.id,
      marketSlug: market.slug,
      marketName: market.name,
      platformFeeRateBps: 350,
      status: "submitted",
      paymentStatus: "pending",
      subtotalCents: TOTAL,
      childOrderCount: 2,
      paymentSummary: { status: "pending", totalAmountCents: TOTAL },
      appliedVoucher: options.appliedVoucher ?? null,
      createdAt: created,
      updatedAt: created,
    });

    for (const [orderId, restaurantId, amountCents, orderNumber] of [
      [ORDER_A, VENDOR_A, AMOUNT_A, "A-0001"],
      [ORDER_B, VENDOR_B, AMOUNT_B, "B-0001"],
    ] as Array<[string, string, number, string]>) {
      await testDb.drizzle.insert(orders).values({
        id: orderId,
        restaurantId,
        orderNumber,
        status: "pending",
        orderSource: "market_checkout",
        totalAmountCents: amountCents,
        subtotalCents: amountCents,
        paymentStatus: "pending",
        createdAt: created,
        updatedAt: created,
      });
      await testDb.drizzle.insert(marketCheckoutChildOrders).values({
        checkoutId: CHECKOUT_ID,
        restaurantId,
        restaurantName: `攤位 ${restaurantId}`,
        orderId,
        orderNumber,
        totalAmountCents: amountCents,
        tokenExpiresAt: created,
        createdAt: created,
      });
    }
  }

  async function orderRows() {
    return testDb.drizzle
      .select({
        id: orders.id,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        paymentMethod: orders.paymentMethod,
        paymentTransactionId: orders.paymentTransactionId,
        paidAt: orders.paidAt,
        refundAmountCents: orders.refundAmountCents,
      })
      .from(orders)
      .orderBy(orders.id)
      .all();
  }

  async function transactionRows() {
    return testDb.drizzle
      .select()
      .from(paymentTransactions)
      .orderBy(paymentTransactions.transactionId)
      .all();
  }

  it("derives an id from the checkout and the order alone", () => {
    expect(marketCheckoutChildPaymentId("c1", "o1")).toBe("mkt_c1_o1");
    // Two settlement paths for the same money must agree on the row.
    expect(marketCheckoutChildPaymentId("c1", "o1")).toBe(
      marketCheckoutChildPaymentId("c1", "o1"),
    );
  });

  describe("settleMarketCheckoutChildOrdersPaid", () => {
    it("writes a payment row per vendor and marks each order completed", async () => {
      await seedCheckout();

      const result = await settleMarketCheckoutChildOrdersPaid(
        createEnv(),
        paidInput(),
      );

      expect(result).toEqual({ settled: 2 });
      expect(await orderRows()).toEqual([
        expect.objectContaining({
          id: ORDER_A,
          paymentStatus: "completed",
          paymentMethod: "online",
          paymentTransactionId: `mkt_${CHECKOUT_ID}_${ORDER_A}`,
          paidAt: new Date(1_800_000_000_000),
          // The vendor's workflow status stays the vendor's.
          status: "pending",
        }),
        expect.objectContaining({
          id: ORDER_B,
          paymentStatus: "completed",
          paymentTransactionId: `mkt_${CHECKOUT_ID}_${ORDER_B}`,
        }),
      ]);
      expect(await transactionRows()).toEqual([
        expect.objectContaining({
          transactionId: `mkt_${CHECKOUT_ID}_${ORDER_A}`,
          orderId: ORDER_A,
          restaurantId: VENDOR_A,
          amountCents: AMOUNT_A,
          currency: "TWD",
          countryCode: "TW",
          gateway: "stripe",
          status: "paid",
          paymentMethod: "online",
          providerTransactionId: "pi_checkout-settle-1",
          idempotencyKey: `market-checkout:${CHECKOUT_ID}:${ORDER_A}`,
        }),
        expect.objectContaining({
          transactionId: `mkt_${CHECKOUT_ID}_${ORDER_B}`,
          restaurantId: VENDOR_B,
          amountCents: AMOUNT_B,
        }),
      ]);
    });

    it("uses the caller's allocations when the provider supplied a split", async () => {
      await seedCheckout();

      const result = await settleMarketCheckoutChildOrdersPaid(
        createEnv(),
        paidInput({
          gateway: "credit_balance",
          allocations: [
            { orderId: ORDER_A, restaurantId: VENDOR_A, amountCents: AMOUNT_A },
            { orderId: ORDER_B, restaurantId: VENDOR_B, amountCents: AMOUNT_B },
          ],
        }),
      );

      expect(result).toEqual({ settled: 2 });
      expect((await transactionRows()).map((row) => row.gateway)).toEqual([
        "credit_balance",
        "credit_balance",
      ]);
    });

    it("subtracts a 卷 discount from the vendor's share, so the shares still add up", async () => {
      await seedCheckout({
        appliedVoucher: {
          couponId: 7,
          code: "NT100",
          name: "折 NT$100",
          discountCents: 10_000,
          allocations: [
            { orderId: ORDER_A, amountCents: AMOUNT_A, discountCents: 7_750 },
            { orderId: ORDER_B, amountCents: AMOUNT_B, discountCents: 2_250 },
          ],
        },
      });

      const result = await settleMarketCheckoutChildOrdersPaid(
        createEnv(),
        paidInput({ chargedTotalCents: TOTAL - 10_000 }),
      );

      expect(result).toEqual({ settled: 2 });
      expect((await transactionRows()).map((row) => row.amountCents)).toEqual([
        AMOUNT_A - 7_750,
        AMOUNT_B - 2_250,
      ]);
    });

    it("sums the allocations of a stacked voucher bundle", async () => {
      await seedCheckout({
        appliedVoucher: {
          vouchers: [
            {
              couponId: 7,
              code: "A",
              name: "A",
              discountCents: 2_000,
              allocations: [
                {
                  orderId: ORDER_A,
                  amountCents: AMOUNT_A,
                  discountCents: 2000,
                },
              ],
            },
            {
              couponId: 8,
              code: "B",
              name: "B",
              discountCents: 1_000,
              allocations: [
                {
                  orderId: ORDER_A,
                  amountCents: AMOUNT_A,
                  discountCents: 1000,
                },
              ],
            },
          ],
          discountCents: 3_000,
          allocations: [],
        },
      });

      const result = await settleMarketCheckoutChildOrdersPaid(
        createEnv(),
        paidInput({ chargedTotalCents: TOTAL - 3_000 }),
      );

      expect(result).toEqual({ settled: 2 });
      expect((await transactionRows()).map((row) => row.amountCents)).toEqual([
        AMOUNT_A - 3_000,
        AMOUNT_B,
      ]);
    });

    it("is idempotent: a second settlement adds no row and does not move paid_at", async () => {
      await seedCheckout();
      const env = createEnv();
      await settleMarketCheckoutChildOrdersPaid(env, paidInput());

      const result = await settleMarketCheckoutChildOrdersPaid(
        env,
        paidInput({ nowMs: 1_900_000_000_000 }),
      );

      expect(result).toEqual({ settled: 2 });
      expect(await transactionRows()).toHaveLength(2);
      for (const row of await orderRows()) {
        expect(row.paidAt).toEqual(new Date(1_800_000_000_000));
      }
    });

    it("does not resurrect an order that has since been refunded", async () => {
      await seedCheckout();
      const env = createEnv();
      await settleMarketCheckoutChildOrdersPaid(env, paidInput());
      await settleMarketCheckoutChildOrdersRefunded(env, {
        checkoutId: CHECKOUT_ID,
        status: "refunded",
      });

      await settleMarketCheckoutChildOrdersPaid(env, paidInput());

      for (const row of await orderRows()) {
        expect(row.paymentStatus).toBe("refunded");
      }
    });

    it("writes nothing when the checkout has no child orders", async () => {
      const result = await settleMarketCheckoutChildOrdersPaid(
        createEnv(),
        paidInput(),
      );

      expect(result).toEqual({
        settled: 0,
        skippedReason: "no_child_orders",
      });
      expect(await transactionRows()).toHaveLength(0);
    });

    it("writes nothing when the shares do not add up to what was charged", async () => {
      await seedCheckout();
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await settleMarketCheckoutChildOrdersPaid(
        createEnv(),
        // A voucher was applied but never recorded on the session: the derived
        // shares would over-pay both vendors.
        paidInput({ chargedTotalCents: TOTAL - 5_000 }),
      );

      expect(result).toEqual({
        settled: 0,
        skippedReason: "allocation_total_mismatch",
      });
      expect(await transactionRows()).toHaveLength(0);
      expect(await orderRows()).toEqual([
        expect.objectContaining({ paymentStatus: "pending" }),
        expect.objectContaining({ paymentStatus: "pending" }),
      ]);
      expect(logged).toHaveBeenCalledWith(
        "marketCheckout.childSettlement.allocationMismatch",
        expect.objectContaining({
          checkoutId: CHECKOUT_ID,
          chargedTotalCents: TOTAL - 5_000,
          allocatedCents: TOTAL,
        }),
      );
    });

    it("ignores an unreadable applied_voucher rather than guessing a discount", async () => {
      await seedCheckout({ appliedVoucher: { allocations: "not-an-array" } });

      const result = await settleMarketCheckoutChildOrdersPaid(
        createEnv(),
        paidInput(),
      );

      expect(result).toEqual({ settled: 2 });
      expect((await transactionRows()).map((row) => row.amountCents)).toEqual([
        AMOUNT_A,
        AMOUNT_B,
      ]);
    });
  });

  describe("settleMarketCheckoutChildOrdersRefunded", () => {
    it("marks a fully refunded checkout's child orders refunded, with the exact amount", async () => {
      await seedCheckout();
      const env = createEnv();
      await settleMarketCheckoutChildOrdersPaid(env, paidInput());

      const result = await settleMarketCheckoutChildOrdersRefunded(env, {
        checkoutId: CHECKOUT_ID,
        status: "refunded",
        nowMs: 1_800_000_100_000,
      });

      expect(result).toEqual({ settled: 2 });
      expect((await transactionRows()).map((row) => row.status)).toEqual([
        "refunded",
        "refunded",
      ]);
      expect(await orderRows()).toEqual([
        expect.objectContaining({
          paymentStatus: "refunded",
          refundAmountCents: AMOUNT_A,
        }),
        expect.objectContaining({
          paymentStatus: "refunded",
          refundAmountCents: AMOUNT_B,
        }),
      ]);
    });

    it("records a partial refund without attributing an amount to one vendor", async () => {
      await seedCheckout();
      const env = createEnv();
      await settleMarketCheckoutChildOrdersPaid(env, paidInput());

      const result = await settleMarketCheckoutChildOrdersRefunded(env, {
        checkoutId: CHECKOUT_ID,
        status: "partial_refunded",
      });

      expect(result).toEqual({ settled: 2 });
      // An aggregate refund cannot be attributed to one vendor, so no amount
      // is invented: the column keeps whatever it had.
      expect(await orderRows()).toEqual([
        expect.objectContaining({
          paymentStatus: "partial_refunded",
          refundAmountCents: null,
        }),
        expect.objectContaining({
          paymentStatus: "partial_refunded",
          refundAmountCents: null,
        }),
      ]);
    });

    it("is idempotent: a second refund finds no paid row left to touch", async () => {
      await seedCheckout();
      const env = createEnv();
      await settleMarketCheckoutChildOrdersPaid(env, paidInput());
      await settleMarketCheckoutChildOrdersRefunded(env, {
        checkoutId: CHECKOUT_ID,
        status: "refunded",
      });

      const result = await settleMarketCheckoutChildOrdersRefunded(env, {
        checkoutId: CHECKOUT_ID,
        status: "refunded",
      });

      expect(result).toEqual({ settled: 0 });
    });

    it("leaves a checkout this module never settled alone", async () => {
      await seedCheckout();

      const result = await settleMarketCheckoutChildOrdersRefunded(
        createEnv(),
        { checkoutId: CHECKOUT_ID, status: "refunded" },
      );

      expect(result).toEqual({ settled: 0 });
      expect(await orderRows()).toEqual([
        expect.objectContaining({ paymentStatus: "pending" }),
        expect.objectContaining({ paymentStatus: "pending" }),
      ]);
    });

    it("does nothing for a checkout with no child orders", async () => {
      const result = await settleMarketCheckoutChildOrdersRefunded(
        createEnv(),
        { checkoutId: "unknown-checkout", status: "refunded" },
      );

      expect(result).toEqual({
        settled: 0,
        skippedReason: "no_child_orders",
      });
    });
  });
});
