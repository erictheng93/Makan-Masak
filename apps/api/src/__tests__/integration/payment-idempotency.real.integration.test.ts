import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  orders,
  paymentTransactions,
  OrderService,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { PaymentService } from "../../features/payments/services/PaymentService";

/**
 * The unit tests for the replay path run against a select mock, so they can
 * only show that no write was *issued*. "Exactly one transaction row exists"
 * is a statement about the database, and the partial unique index that backs
 * it only exists there — hence these.
 */
describe("payment idempotency replay", () => {
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

  const service = () => new PaymentService(testApp.env);

  const staffActor = (restaurantId: string) => ({
    kind: "staff" as const,
    user: {
      id: "018f0000-0000-7000-8000-000000000007",
      username: "cashier",
      role: 4,
      restaurantId,
    },
  });

  const payment = (orderId: string) => ({
    orderId,
    paymentMode: "full" as const,
    amount: 120,
    expectedTotal: 120,
    method: "cash",
  });

  const recordedRows = (key: string) =>
    testApp.testDb.drizzle
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.idempotencyKey, key));

  it("returns the first result and writes no second row when a key is retried", async () => {
    const restaurant = await seed.restaurant();
    const order = await seed.order(restaurant.id);

    const first = await service().processPayment(payment(order.id), {
      idempotencyKey: "idem-real-1",
      actor: staffActor(restaurant.id),
    });
    expect(first.status).toBe(200);

    // The order is `paid` by now, so a replay that ran after the payable-state
    // check would 409 instead of replaying. It has to short-circuit earlier.
    const replay = await service().processPayment(payment(order.id), {
      idempotencyKey: "idem-real-1",
      actor: staffActor(restaurant.id),
    });

    expect(replay).toEqual(first);
    await expect(recordedRows("idem-real-1")).resolves.toHaveLength(1);
  });

  it("stores a payment status the read path hands back, not one it rewrites to pending", async () => {
    const restaurant = await seed.restaurant();
    const order = await seed.order(restaurant.id);

    await service().processPayment(payment(order.id), {
      idempotencyKey: "idem-real-paid",
      actor: staffActor(restaurant.id),
    });

    // orders.payment_status is unconstrained TEXT, so a value outside
    // ORDER_PAYMENT_STATUSES does not fail the write -- it lands, and
    // `toOrderPaymentStatus` quietly rewrites it to "pending" on the way out.
    // A genuinely paid order then reads back as unpaid (#311). Checking the
    // cell alone would miss the rewrite; checking the read alone would pass on
    // a write that never happened. Both ends, or neither proves anything.
    const [row] = await testApp.testDb.drizzle
      .select({ paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(row?.paymentStatus).toBe("completed");

    const readBack = await new OrderService(
      testApp.env.DB,
      testApp.env,
    ).getOrder(order.id);
    expect(readBack?.paymentStatus).toBe("completed");
  });

  it("refuses a key already recorded against a different order", async () => {
    const restaurant = await seed.restaurant();
    const paid = await seed.order(restaurant.id);
    const unpaid = await seed.order(restaurant.id);

    await service().processPayment(payment(paid.id), {
      idempotencyKey: "idem-real-2",
      actor: staffActor(restaurant.id),
    });

    await expect(
      service().processPayment(payment(unpaid.id), {
        idempotencyKey: "idem-real-2",
        actor: staffActor(restaurant.id),
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_ORDER_MISMATCH",
      status: 422,
    });

    // The reused key must not settle the second order behind the caller's back,
    // and must not leave a partial row for it either.
    await expect(recordedRows("idem-real-2")).resolves.toHaveLength(1);
    await expect(
      testApp.testDb.drizzle
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.orderId, unpaid.id)),
    ).resolves.toEqual([]);
  });
});

/**
 * The admin cashier posts a payment with no currency at all, so before the
 * server resolved it every MYR restaurant's payment was recorded as TWD. These
 * go through the HTTP route the cashier uses, not the service, because the
 * TW/TWD default lived in the route schema.
 */
describe("payment currency authority", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  const CSRF_HEADERS = {
    host: "test",
    origin: "https://test",
    cookie: `csrf_token=${"a".repeat(64)}`,
    "x-csrf-token": "a".repeat(64),
  };

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

  async function restaurantWithCashier(settings: Record<string, unknown>) {
    const restaurant = await seed.restaurant({ settings });
    // /payments sits behind the online_ordering module gate.
    await testApp.env.DB.prepare(
      `INSERT INTO shop_subscriptions
        (id, restaurant_id, plan_tier, module_overrides,
         is_active, trial_ends_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'trial', ?, 1, ?, ?, ?)`,
    )
      .bind(
        `sub-${restaurant.id}`,
        restaurant.id,
        JSON.stringify({ online_ordering: true }),
        Date.now() + 24 * 60 * 60 * 1000,
        Date.now(),
        Date.now(),
      )
      .run();
    const cashier = await seed.user({ role: 4, restaurantId: restaurant.id });
    const token = await testApp.authHelper.staffToken(
      cashier.id,
      4,
      restaurant.id,
    );
    return { restaurantId: restaurant.id, token };
  }

  function postPayment(
    token: string,
    body: Record<string, unknown>,
    path = "/api/v1/payments",
  ) {
    return testApp.app.fetch(
      new Request(`https://test${path}`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": `currency-${crypto.randomUUID()}`,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  const rowsFor = (orderId: string) =>
    testApp.testDb.drizzle
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, orderId));

  it("records an MYR restaurant's cashier payment as MYR", async () => {
    const { restaurantId, token } = await restaurantWithCashier({
      currency: "MYR",
    });
    const order = await seed.order(restaurantId, {
      totalAmount: 45.5,
      totalAmountCents: 4550,
    });

    const response = await postPayment(token, {
      orderId: order.id,
      restaurantId,
      amount: 45.5,
      method: "cash",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { metadata: { currency: "MYR", country: "MY" } },
    });
    await expect(rowsFor(order.id)).resolves.toEqual([
      expect.objectContaining({
        amountCents: 4550,
        currency: "MYR",
        countryCode: "MY",
        status: "paid",
      }),
    ]);
  });

  it("records the MYR cash amount collected while card stays at the exact order total", async () => {
    const { restaurantId, token } = await restaurantWithCashier({
      currency: "MYR",
    });
    const cashOrder = await seed.order(restaurantId, {
      totalAmount: 10.33,
      totalAmountCents: 1033,
    });

    const cash = await postPayment(token, {
      orderId: cashOrder.id,
      restaurantId,
      amount: 10.35,
      expectedTotal: 10.33,
      method: "cash",
    });

    expect(cash.status).toBe(200);
    expect(await cash.json()).toMatchObject({
      data: {
        metadata: {
          authorizedTotal: 10.33,
          collectedTotal: 10.35,
          roundingAdjustment: 0.02,
        },
      },
    });
    await expect(rowsFor(cashOrder.id)).resolves.toEqual([
      expect.objectContaining({
        amountCents: 1035,
        roundingAdjustmentCents: 2,
        currency: "MYR",
        paymentMethod: "cash",
      }),
    ]);

    const cardOrder = await seed.order(restaurantId, {
      totalAmount: 10.33,
      totalAmountCents: 1033,
    });
    const card = await postPayment(token, {
      orderId: cardOrder.id,
      restaurantId,
      amount: 10.33,
      method: "card",
    });

    expect(card.status).toBe(200);
    await expect(rowsFor(cardOrder.id)).resolves.toEqual([
      expect.objectContaining({
        amountCents: 1033,
        roundingAdjustmentCents: 0,
        currency: "MYR",
        paymentMethod: "card",
      }),
    ]);
  });

  it("rejects a client currency that disagrees and records nothing", async () => {
    const { restaurantId, token } = await restaurantWithCashier({
      currency: "MYR",
    });
    const order = await seed.order(restaurantId);

    const response = await postPayment(token, {
      orderId: order.id,
      restaurantId,
      amount: 120,
      method: "cash",
      country: "TW",
      currency: "TWD",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "CURRENCY_MISMATCH" },
    });
    await expect(rowsFor(order.id)).resolves.toEqual([]);
    const [row] = await testApp.testDb.drizzle
      .select({ paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(row?.paymentStatus).toBe("pending");
  });

  it("fails closed on a restaurant whose stored currency is unsupported", async () => {
    const { restaurantId, token } = await restaurantWithCashier({
      currency: "USD",
    });
    const order = await seed.order(restaurantId);

    const response = await postPayment(token, {
      orderId: order.id,
      restaurantId,
      amount: 120,
      method: "cash",
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "RESTAURANT_CURRENCY_INVALID" },
    });
    await expect(rowsFor(order.id)).resolves.toEqual([]);
  });

  it("refuses an unsupported restaurant currency setting and honours a supported one", async () => {
    const { restaurantId, token } = await restaurantWithCashier({
      allowGuestOrders: true,
    });
    const adminToken = await testApp.authHelper.adminToken(restaurantId);
    const putSettings = (currency: string) =>
      testApp.app.fetch(
        new Request(`https://test/api/v1/restaurants/${restaurantId}`, {
          method: "PUT",
          headers: {
            ...CSRF_HEADERS,
            authorization: `Bearer ${adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ settings: { currency } }),
        }),
      );

    const usd = await putSettings("USD");
    expect(usd.status).toBe(400);
    expect(await usd.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const myr = await putSettings("MYR");
    expect(myr.status).toBe(200);

    const order = await seed.order(restaurantId);
    const pay = await postPayment(token, {
      orderId: order.id,
      restaurantId,
      amount: 120,
      method: "cash",
    });
    expect(pay.status).toBe(200);
    await expect(rowsFor(order.id)).resolves.toEqual([
      expect.objectContaining({ currency: "MYR", countryCode: "MY" }),
    ]);
  });

  it("refuses a TWD split line with cents but accepts whole dollars", async () => {
    const { restaurantId, token } = await restaurantWithCashier({
      currency: "TWD",
    });
    const order = await seed.order(restaurantId);

    const offStep = await postPayment(token, {
      orderId: order.id,
      restaurantId,
      paymentMode: "partial",
      payments: [
        { method: "cash", amount: 60.5 },
        { method: "card", amount: 59.5 },
      ],
    });
    expect(offStep.status).toBe(400);
    expect(await offStep.json()).toMatchObject({
      error: { code: "AMOUNT_PRECISION_INVALID" },
    });

    const whole = await postPayment(token, {
      orderId: order.id,
      restaurantId,
      paymentMode: "partial",
      payments: [
        { method: "cash", amount: 60 },
        { method: "card", amount: 60 },
      ],
    });
    expect(whole.status).toBe(200);
    await expect(rowsFor(order.id)).resolves.toEqual([
      expect.objectContaining({ amountCents: 12000, currency: "TWD" }),
    ]);
  });
});
