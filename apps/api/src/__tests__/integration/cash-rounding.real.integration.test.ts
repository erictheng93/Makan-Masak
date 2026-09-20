import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData } from "../helpers/read-json";

/**
 * MYR cash rounding against real D1 (#405).
 *
 * Bank Negara's rounding mechanism collects a cash bill to the nearest 5 sen.
 * Unit tests pin the arithmetic; this file pins what lands in the database,
 * which is the part the shift count and the tax return read:
 *
 *   - `payment_transactions.amount_cents` is what was collected
 *   - `payment_transactions.rounding_adjustment_cents` is the difference
 *   - `orders.total_amount_cents` never moves
 *
 * Real D1 rather than a mocked db on purpose: the column is NOT NULL with a
 * DEFAULT, the order total is read back from the row the service wrote, and
 * the shift report aggregates across both tables — none of which a fixture db
 * can show.
 */
describe("MYR cash rounding — real D1", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    await testApp?.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  const CSRF = "a".repeat(64);
  let idempotencyCounter = 0;

  function call(path: string, token: string, method = "GET", body?: unknown) {
    idempotencyCounter += 1;
    return testApp.app.fetch(
      new Request(`https://test/api/v1${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          host: "test",
          origin: "https://test",
          cookie: `csrf_token=${CSRF}`,
          "x-csrf-token": CSRF,
          "Idempotency-Key": `idem-${idempotencyCounter}-${Date.now()}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  /** `/pos/*` sits behind moduleGate("pos"), which 403s without a subscription. */
  async function insertActiveSubscription(restaurantId: string) {
    const now = Date.now();
    await testApp.env.DB.prepare(
      `INSERT INTO shop_subscriptions
         (id, restaurant_id, plan_tier, module_overrides,
          is_active, trial_ends_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'trial', '{}', 1, ?, ?, ?)`,
    )
      .bind(
        `sub-${restaurantId}`,
        restaurantId,
        now + 24 * 60 * 60 * 1000,
        now,
        now,
      )
      .run();
  }

  interface Shop {
    restaurantId: string;
    ownerId: string;
    ownerToken: string;
  }

  async function shopIn(currency: "MYR" | "TWD"): Promise<Shop> {
    const restaurant = await seed.restaurant({
      settings: {
        allowOnlineOrdering: true,
        allowGuestOrders: true,
        currency,
      },
    });
    const restaurantId = String(restaurant.id);
    await insertActiveSubscription(restaurantId);
    const owner = await seed.user({
      username: `owner-${currency.toLowerCase()}-${Date.now()}`,
      role: 1,
      restaurantId,
    });
    return {
      restaurantId,
      ownerId: owner.id,
      ownerToken: await testApp.authHelper.ownerToken(owner.id, restaurantId),
    };
  }

  async function payableOrder(restaurantId: string, totalCents: number) {
    return seed.order(restaurantId, {
      status: "delivered",
      paymentStatus: "pending",
      subtotalCents: totalCents,
      subtotal: totalCents / 100,
      totalAmountCents: totalCents,
      totalAmount: totalCents / 100,
      createdAt: new Date(),
    });
  }

  async function readPayment(orderId: string) {
    const row = await testApp.env.DB.prepare(
      `SELECT amount_cents, rounding_adjustment_cents, payment_method, currency
         FROM payment_transactions WHERE order_id = ?`,
    )
      .bind(orderId)
      .first<{
        amount_cents: number;
        rounding_adjustment_cents: number;
        payment_method: string;
        currency: string | null;
      }>();
    return row;
  }

  async function readOrderTotal(orderId: string) {
    const row = await testApp.env.DB.prepare(
      `SELECT total_amount_cents FROM orders WHERE id = ?`,
    )
      .bind(orderId)
      .first<{ total_amount_cents: number }>();
    return row?.total_amount_cents;
  }

  it("collects RM10.35 for a RM10.33 cash order and leaves the order total alone", async () => {
    const shop = await shopIn("MYR");
    const order = await payableOrder(shop.restaurantId, 1033);

    const res = await call("/payments", shop.ownerToken, "POST", {
      orderId: order.id,
      paymentMode: "full",
      amount: 10.35,
      expectedTotal: 10.33,
      method: "cash",
      closeOrder: true,
    });
    expect(res.status).toBe(200);

    const payload = await readData<{
      metadata: {
        authorizedTotal: number;
        collectedTotal: number;
        roundingAdjustment: number;
      };
    }>(res);
    expect(payload.metadata).toMatchObject({
      authorizedTotal: 10.33,
      collectedTotal: 10.35,
      roundingAdjustment: 0.02,
    });

    expect(await readPayment(order.id)).toMatchObject({
      amount_cents: 1035,
      rounding_adjustment_cents: 2,
      payment_method: "cash",
      currency: "MYR",
    });
    expect(await readOrderTotal(order.id)).toBe(1033);
  });

  it("collects the exact RM10.33 when the same order is paid by card", async () => {
    const shop = await shopIn("MYR");
    const order = await payableOrder(shop.restaurantId, 1033);

    const res = await call("/payments", shop.ownerToken, "POST", {
      orderId: order.id,
      paymentMode: "full",
      amount: 10.33,
      expectedTotal: 10.33,
      method: "card",
      closeOrder: true,
    });
    expect(res.status).toBe(200);

    expect(await readPayment(order.id)).toMatchObject({
      amount_cents: 1033,
      rounding_adjustment_cents: 0,
      payment_method: "card",
    });
    expect(await readOrderTotal(order.id)).toBe(1033);
  });

  it("rounds a RM10.32 cash order down and records a negative adjustment", async () => {
    const shop = await shopIn("MYR");
    const order = await payableOrder(shop.restaurantId, 1032);

    const res = await call("/payments", shop.ownerToken, "POST", {
      orderId: order.id,
      paymentMode: "full",
      amount: 10.3,
      expectedTotal: 10.32,
      method: "cash",
      closeOrder: true,
    });
    expect(res.status).toBe(200);

    expect(await readPayment(order.id)).toMatchObject({
      amount_cents: 1030,
      rounding_adjustment_cents: -2,
    });
    expect(await readOrderTotal(order.id)).toBe(1032);
  });

  it("refuses a cash amount that is neither the total nor the rounded total", async () => {
    const shop = await shopIn("MYR");
    const order = await payableOrder(shop.restaurantId, 1033);

    const res = await call("/payments", shop.ownerToken, "POST", {
      orderId: order.id,
      paymentMode: "full",
      amount: 10.34,
      expectedTotal: 10.33,
      method: "cash",
      closeOrder: true,
    });

    expect(res.status).toBe(409);
    expect(await readPayment(order.id)).toBeNull();
  });

  it("records a zero adjustment for a TWD cash order", async () => {
    const shop = await shopIn("TWD");
    const order = await payableOrder(shop.restaurantId, 35000);

    const res = await call("/payments", shop.ownerToken, "POST", {
      orderId: order.id,
      paymentMode: "full",
      amount: 350,
      expectedTotal: 350,
      method: "cash",
      closeOrder: true,
    });
    expect(res.status).toBe(200);

    expect(await readPayment(order.id)).toMatchObject({
      amount_cents: 35000,
      rounding_adjustment_cents: 0,
      currency: "TWD",
    });
  });

  it("refunds what the rounded cash payment collected, not the order total", async () => {
    const shop = await shopIn("MYR");
    const order = await payableOrder(shop.restaurantId, 1033);

    const payRes = await call("/payments", shop.ownerToken, "POST", {
      orderId: order.id,
      paymentMode: "full",
      amount: 10.35,
      expectedTotal: 10.33,
      method: "cash",
      closeOrder: true,
    });
    expect(payRes.status).toBe(200);
    const paid = await readData<{ transactionId: string }>(payRes);

    const refundRes = await call("/payments/refund", shop.ownerToken, "POST", {
      transactionId: paid.transactionId,
      reason: "customer returned it",
    });
    expect(refundRes.status).toBe(200);

    const refund = await testApp.env.DB.prepare(
      `SELECT amount_cents FROM refund_transactions WHERE order_id = ?`,
    )
      .bind(order.id)
      .first<{ amount_cents: number }>();
    expect(refund?.amount_cents).toBe(1035);
  });

  describe("cash shift reconciliation", () => {
    it("reports the rounding gain on its own line and no drawer discrepancy", async () => {
      // Three MYR cash orders rounding +2 / -1 / +1 sen: the drawer ends up
      // 2 sen above what the order totals say, and that 2 sen has a name.
      const shop = await shopIn("MYR");

      const registerRes = await call(
        "/pos/registers",
        shop.ownerToken,
        "POST",
        { name: "Rounding Register", restaurantId: shop.restaurantId },
      );
      expect(registerRes.status).toBe(200);
      const register = await readData<{ id: string }>(registerRes);

      const shiftRes = await call(
        "/pos/shifts/start",
        shop.ownerToken,
        "POST",
        {
          registerId: register.id,
          operatorId: shop.ownerId,
          startAmount: 100,
        },
      );
      expect(shiftRes.status).toBe(200);
      const shift = await readData<{ id: string }>(shiftRes);

      // 1033 → 1035 (+2), 1031 → 1030 (-1), 1034 → 1035 (+1). Net +2 sen.
      for (const [totalCents, collected] of [
        [1033, 10.35],
        [1031, 10.3],
        [1034, 10.35],
      ] as const) {
        const order = await payableOrder(shop.restaurantId, totalCents);
        const res = await call("/payments", shop.ownerToken, "POST", {
          orderId: order.id,
          paymentMode: "full",
          amount: collected,
          expectedTotal: totalCents / 100,
          method: "cash",
          closeOrder: true,
        });
        expect(res.status).toBe(200);
      }

      // Count the drawer: the RM100 float plus the 2 sen rounding gain.
      const endRes = await call(
        `/pos/shifts/${shift.id}/end`,
        shop.ownerToken,
        "POST",
        { actualAmount: 100.02 },
      );
      expect(endRes.status).toBe(200);

      const reportRes = await call(
        `/pos/shifts/${shift.id}/report`,
        shop.ownerToken,
      );
      expect(reportRes.status).toBe(200);

      const report = await readData<{
        reportData: {
          summary: {
            expectedAmount: number;
            cashRoundingAdjustment: number;
            roundedCashPayments: number;
            expectedCashAmount: number;
            difference: number;
            recordedDifference: number;
          };
        };
      }>(reportRes);

      expect(report.reportData.summary.cashRoundingAdjustment).toBeCloseTo(
        0.02,
        2,
      );
      expect(report.reportData.summary.roundedCashPayments).toBe(3);
      // The drawer holds the RM100 float plus the 2 sen the rounding gained,
      // so counting RM100.02 is a balanced till — not a 2 sen overage.
      expect(report.reportData.summary.expectedCashAmount).toBeCloseTo(
        report.reportData.summary.expectedAmount + 0.02,
        2,
      );
      expect(report.reportData.summary.difference).toBeCloseTo(0, 2);
      // The shift row's own difference still carries the unexplained-looking
      // 2 sen, so the report can be reconciled against the database.
      expect(report.reportData.summary.recordedDifference).toBeCloseTo(0.02, 2);
    });

    it("reports no rounding for a TWD shift", async () => {
      const shop = await shopIn("TWD");

      const registerRes = await call(
        "/pos/registers",
        shop.ownerToken,
        "POST",
        { name: "TWD Register", restaurantId: shop.restaurantId },
      );
      const register = await readData<{ id: string }>(registerRes);
      const shiftRes = await call(
        "/pos/shifts/start",
        shop.ownerToken,
        "POST",
        {
          registerId: register.id,
          operatorId: shop.ownerId,
          startAmount: 100,
        },
      );
      const shift = await readData<{ id: string }>(shiftRes);

      const order = await payableOrder(shop.restaurantId, 35000);
      expect(
        (
          await call("/payments", shop.ownerToken, "POST", {
            orderId: order.id,
            paymentMode: "full",
            amount: 350,
            expectedTotal: 350,
            method: "cash",
            closeOrder: true,
          })
        ).status,
      ).toBe(200);

      const reportRes = await call(
        `/pos/shifts/${shift.id}/report`,
        shop.ownerToken,
      );
      const report = await readData<{
        reportData: {
          summary: {
            cashRoundingAdjustment: number;
            roundedCashPayments: number;
          };
        };
      }>(reportRes);

      expect(report.reportData.summary.cashRoundingAdjustment).toBe(0);
      expect(report.reportData.summary.roundedCashPayments).toBe(0);
    });
  });
});
