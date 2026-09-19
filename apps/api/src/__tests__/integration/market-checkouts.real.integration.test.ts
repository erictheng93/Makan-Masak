import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  cashMovements,
  cashShifts,
  coupons,
  couponUsage,
  marketCheckoutChildOrders,
  marketCheckoutPayments,
  marketCheckoutSessions,
  markets,
  orders,
  paymentTransactions,
  restaurantMarketMemberships,
  restaurants,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";
import { CreditService } from "../../features/credits/services/CreditService";
import { readData } from "../helpers/read-json";
import type {
  MarketCheckoutSummaryItem,
  PublicMarketCheckoutSession,
} from "../../features/market-checkouts/routes";

type CheckoutEnvelope = { checkout: PublicMarketCheckoutSession };
type CreatedCheckout = CheckoutEnvelope & {
  childOrders: Array<{
    orderId: string;
    restaurantId: string;
    guestToken: string;
  }>;
};
type PaidCheckout = CheckoutEnvelope & {
  payment: PublicMarketCheckoutSession["payment"];
  refunds?: Array<{ orderId: string }>;
};
type AppliedVoucher = CheckoutEnvelope & {
  vouchers: Array<{ code: string; discountCents: number }>;
  subtotalCents: number;
  discountCents: number;
  payableCents: number;
};
type AdminCheckoutList = {
  checkouts: MarketCheckoutSummaryItem[];
  total: number;
  page: number;
  limit: number;
};

/**
 * What a shopper's browser carries into the mutating checkout endpoints.
 *
 * Those routes require proof the caller holds the checkout, and a guest order
 * token minted at creation is that proof for a shopper with no account. It goes
 * in its own header because the client's Authorization slot holds either the
 * customer JWT or the guest token, never both.
 */
function holderHeaders(created: CreatedCheckout) {
  return { "x-guest-token": created.childOrders[0]!.guestToken };
}

const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  cookie: `csrf_token=${"a".repeat(64)}`,
  "x-csrf-token": "a".repeat(64),
};
const CUSTOMER_HEADERS = {
  host: "test",
  origin: "https://test",
  "content-type": "application/json",
};
const POS_BASE = "https://test/api/v1/pos";

async function seedMarket(testApp: RealIntegrationTestApp) {
  const now = new Date();
  const [market] = await testApp.testDb.drizzle
    .insert(markets)
    .values({
      id: `market-${crypto.randomUUID()}`,
      slug: `checkout-market-${crypto.randomUUID()}`,
      name: "持久化測試夜市",
      type: "night_market",
      description: "Market checkout persistence fixture",
      city: "台中市",
      district: "西屯區",
      address: "台中市西屯區文華路",
      latitude: 24.1764,
      longitude: 120.6466,
      openingHours: {
        friday: { open: "17:00", close: "23:30" },
      },
      platformFeeRateBps: 350,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return market;
}

async function seedPlatformVoucher(
  testApp: RealIntegrationTestApp,
  code: string,
) {
  const [coupon] = await testApp.testDb.drizzle
    .insert(coupons)
    .values({
      code,
      name: code,
      restaurantId: null,
      discountType: "percentage",
      discountPercentageBps: 1000,
      minOrderAmountCents: 0,
      validFrom: new Date("2020-01-01T00:00:00.000Z"),
      validTo: new Date("2099-12-31T00:00:00.000Z"),
      isActive: true,
      isVisible: true,
      usedCount: 0,
    })
    .returning({ id: coupons.id });
  return coupon.id;
}

async function seedVendorVoucher(
  testApp: RealIntegrationTestApp,
  code: string,
  restaurantId: string,
) {
  const [coupon] = await testApp.testDb.drizzle
    .insert(coupons)
    .values({
      code,
      name: code,
      restaurantId,
      discountType: "fixed",
      discountValueCents: 500,
      minOrderAmountCents: 0,
      validFrom: new Date("2020-01-01T00:00:00.000Z"),
      validTo: new Date("2099-12-31T00:00:00.000Z"),
      isActive: true,
      isVisible: true,
      usedCount: 0,
    })
    .returning({ id: coupons.id });
  return coupon.id;
}

async function issueCreditCard(
  testApp: RealIntegrationTestApp,
  balanceCents: number,
  currency: "TWD" | "MYR" | "VND" = "TWD",
) {
  const card = await new CreditService(testApp.env as never).issueCard({
    currency,
    initialBalanceCents: balanceCents,
  });
  return card.publicId;
}

describe("Market checkouts API - real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: SeedHelpers;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  }, 300000);

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
    // Credit settlement is opt-in; tests that spend real balances enable it.
    testApp.env.STORED_VALUE_CREDITS_ENABLED = "true";
  });

  it("rejects unconfigured payment without CSRF, then settles real credits after enablement", async () => {
    testApp.env.STORED_VALUE_CREDITS_ENABLED = "false";
    const pushDeliveries: Array<{
      endpoint: string;
      payload: Record<string, unknown>;
    }> = [];
    testApp.env.WEB_PUSH_DELIVERER = async (delivery) => {
      pushDeliveries.push({
        endpoint: delivery.subscription.endpoint,
        payload: delivery.payload,
      });
      return { ok: true, status: 201 };
    };

    const market = await seedMarket(testApp);
    expect(market.platformFeeRateBps).toBe(350);
    const vendorA = await seed.restaurant({ name: "雞排攤" });
    const vendorB = await seed.restaurant({ name: "甜點攤" });
    const [itemA, itemB] = await Promise.all([
      seed.menuItem(vendorA.id, {
        name: "雞排",
        price: 120,
        priceCents: 12000,
      }),
      seed.menuItem(vendorB.id, {
        name: "地瓜球",
        price: 80,
        priceCents: 8000,
      }),
    ]);

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(vendorA.id),
        marketId: market.id,
        stallNumber: "A01",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(vendorB.id),
        marketId: market.id,
        stallNumber: "B02",
        joinedAt: new Date(),
      },
    ]);
    await Promise.all([
      putRestaurantPushSubscription(String(vendorA.id), "vendor-a"),
      putRestaurantPushSubscription(String(vendorB.id), "vendor-b"),
    ]);

    const createRes = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: CUSTOMER_HEADERS,
        body: JSON.stringify({
          marketSlug: market.slug,
          guestName: "Market Guest",
          phoneLastDigits: "789",
          vendors: [
            {
              restaurantId: String(vendorA.id),
              items: [{ menuItemId: itemA.id, quantity: 1 }],
            },
            {
              restaurantId: String(vendorB.id),
              items: [{ menuItemId: itemB.id, quantity: 1 }],
            },
          ],
        }),
      }),
    );

    expect(createRes.status).toBe(201);
    const createJson = await readData<CreatedCheckout>(createRes);
    const checkoutId = createJson.checkout.id as string;
    expect(createJson.checkout.childOrders).toHaveLength(2);
    expect(createJson.checkout.market.platformFeeRateBps).toBe(350);
    expect(pushDeliveries).toHaveLength(2);
    expect(pushDeliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint: "https://push.example.test/vendor-a",
          payload: expect.objectContaining({
            type: "new_order",
            orderSource: "market_checkout",
            title: "市場結帳新訂單",
            priority: "high",
            requireInteraction: true,
          }),
        }),
        expect.objectContaining({
          endpoint: "https://push.example.test/vendor-b",
          payload: expect.objectContaining({
            type: "new_order",
            orderSource: "market_checkout",
            title: "市場結帳新訂單",
            priority: "high",
            requireInteraction: true,
          }),
        }),
      ]),
    );

    const persistedSession = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutSessions)
      .where(eq(marketCheckoutSessions.id, checkoutId))
      .get();
    expect(persistedSession).toMatchObject({
      id: checkoutId,
      marketId: market.id,
      marketSlug: market.slug,
      marketName: "持久化測試夜市",
      platformFeeRateBps: 350,
      paymentStatus: "pending",
      subtotalCents: 20000,
      childOrderCount: 2,
    });

    const persistedChildren = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutChildOrders)
      .where(eq(marketCheckoutChildOrders.checkoutId, checkoutId))
      .all();
    expect(persistedChildren).toHaveLength(2);
    expect(
      persistedChildren
        .map((child) => child.totalAmountCents)
        .sort((a, b) => a - b),
    ).toEqual([8000, 12000]);

    const childOrderIds = persistedChildren.map((child) => child.orderId);
    const [childOrder] = await testApp.testDb.drizzle
      .select()
      .from(orders)
      .where(eq(orders.id, childOrderIds[0]))
      .all();
    expect(childOrder?.orderSource).toBe("market_checkout");

    await testApp.env.CACHE_KV.delete(`market_checkout:${checkoutId}`);
    await testApp.env.CACHE_KV.delete("market_checkout:index");

    const publicRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/market-checkouts/${checkoutId}`),
    );
    expect(publicRes.status).toBe(200);
    const publicJson = await readData<CheckoutEnvelope>(publicRes);
    expect(publicJson.checkout).toMatchObject({
      id: checkoutId,
      market: { slug: market.slug, platformFeeRateBps: 350 },
      subtotal: 20000,
    });
    expect(publicJson.checkout.childOrders).toHaveLength(2);

    for (const method of ["market_online", "line_pay", "credits"]) {
      const rejectedPayment = await testApp.app.fetch(
        new Request(`https://test/api/v1/market-checkouts/${checkoutId}/pay`, {
          method: "POST",
          headers: { ...CUSTOMER_HEADERS, ...holderHeaders(createJson) },
          body: JSON.stringify({ method }),
        }),
      );
      expect(rejectedPayment.status).toBe(409);
      expect(await rejectedPayment.json()).toMatchObject({
        error: { code: "MARKET_CHECKOUT_PAYMENT_NOT_CONFIGURED" },
      });
    }
    const unpaidOrders = await testApp.testDb.drizzle
      .select({ paymentStatus: orders.paymentStatus, paidAt: orders.paidAt })
      .from(orders)
      .where(inArray(orders.id, childOrderIds))
      .all();
    expect(unpaidOrders).toHaveLength(2);
    expect(unpaidOrders).toEqual([
      { paymentStatus: "pending", paidAt: null },
      { paymentStatus: "pending", paidAt: null },
    ]);
    expect(
      await testApp.testDb.drizzle.select().from(paymentTransactions).all(),
    ).toHaveLength(0);
    expect(
      await testApp.testDb.drizzle.select().from(marketCheckoutPayments).all(),
    ).toHaveLength(0);
    const unpaidSession = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutSessions)
      .where(eq(marketCheckoutSessions.id, checkoutId))
      .get();
    expect(unpaidSession?.paymentStatus).toBe("pending");

    await seedPlatformVoucher(testApp, "GUEST10");
    const voucherRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/${checkoutId}/voucher`,
        {
          method: "POST",
          headers: { ...CUSTOMER_HEADERS, ...holderHeaders(createJson) },
          body: JSON.stringify({ code: "GUEST10" }),
        },
      ),
    );
    expect(voucherRes.status).toBe(200);
    expect((await readData<AppliedVoucher>(voucherRes)).payableCents).toBe(
      18000,
    );
    const removeVoucherRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/${checkoutId}/voucher`,
        {
          method: "DELETE",
          headers: { ...CUSTOMER_HEADERS, ...holderHeaders(createJson) },
        },
      ),
    );
    expect(removeVoucherRes.status).toBe(200);

    // Preserve the successful settlement/refund lifecycle using a provider
    // that actually deducts funds, rather than the retired free-payment path.
    testApp.env.STORED_VALUE_CREDITS_ENABLED = "true";
    const creditCardPublicId = await issueCreditCard(testApp, 50000);
    const payRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/market-checkouts/${checkoutId}/pay`, {
        method: "POST",
        headers: {
          ...holderHeaders(createJson),
          ...CUSTOMER_HEADERS,
          "content-type": "application/json",
          "idempotency-key": `market-pay-${checkoutId}`,
        },
        body: JSON.stringify({
          method: "credits",
          providerInput: { creditCardPublicId },
        }),
      }),
    );
    expect(payRes.status).toBe(200);

    const paidSession = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutSessions)
      .where(eq(marketCheckoutSessions.id, checkoutId))
      .get();
    expect(paidSession?.paymentStatus).toBe("paid");
    expect(paidSession?.paymentSummary).toMatchObject({
      status: "paid",
      totalAmount: 200,
      paidAmount: 200,
      parentPayment: {
        status: "paid",
        provider: "credit_balance",
        splitMode: "provider_split",
        amountCents: 20000,
        paidAmountCents: 20000,
        refundedAmountCents: 0,
      },
      settlement: {
        platformFeeRateBps: 350,
        platformFeeCents: 700,
        vendorNetAmountCents: 19300,
      },
    });

    const [parentPayment] = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutPayments)
      .where(eq(marketCheckoutPayments.checkoutId, checkoutId))
      .all();
    expect(parentPayment).toMatchObject({
      paymentId: `market_pay_${checkoutId}`,
      checkoutId,
      marketId: market.id,
      provider: "credit_balance",
      splitMode: "provider_split",
      idempotencyKey: `market-pay-${checkoutId}`,
      status: "paid",
      amountCents: 20000,
      paidAmountCents: 20000,
      refundedAmountCents: 0,
      currency: "TWD",
      countryCode: "TW",
    });
    expect(parentPayment?.childPaymentIds).toHaveLength(2);
    expect(parentPayment?.providerPayload).toMatchObject({
      source: "market-checkouts",
      splitMode: "provider_split",
      settlement: {
        platformFeeRateBps: 350,
        platformFeeCents: 700,
        vendorNetAmountCents: 19300,
      },
    });
    expect(parentPayment?.completedAt).toBeInstanceOf(Date);

    const adminToken = await testApp.authHelper.adminToken(String(vendorA.id));
    const adminRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/admin?paymentStatus=paid`,
        {
          headers: { authorization: `Bearer ${adminToken}` },
        },
      ),
    );
    expect(adminRes.status).toBe(200);
    const adminJson = await readData<AdminCheckoutList>(adminRes);
    expect(adminJson.checkouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: checkoutId,
          paymentStatus: "paid",
          childOrderCount: 2,
        }),
      ]),
    );

    const refundRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/market-checkouts/${checkoutId}/refund`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "integration_refund" }),
      }),
    );
    expect(refundRes.status).toBe(200);

    const refundedParentPayment = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutPayments)
      .where(eq(marketCheckoutPayments.checkoutId, checkoutId))
      .get();
    expect(refundedParentPayment).toMatchObject({
      paymentId: `market_pay_${checkoutId}`,
      status: "refunded",
      amountCents: 20000,
      paidAmountCents: 20000,
      refundedAmountCents: 20000,
      currency: "TWD",
      countryCode: "TW",
    });
    expect(refundedParentPayment?.refundedAt).toBeInstanceOf(Date);

    const adminDetailRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/market-checkouts/admin/${checkoutId}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    expect(adminDetailRes.status).toBe(200);
    const adminDetailJson = await readData<CheckoutEnvelope>(adminDetailRes);
    expect(adminDetailJson.checkout.payment).toMatchObject({
      status: "refunded",
      refundedAmountCents: 20000,
      parentPayment: {
        status: "refunded",
        refundedAmountCents: 20000,
      },
    });
  });

  it("marks redeemed voucher usage refunded when a paid market checkout is refunded", async () => {
    const market = await seedMarket(testApp);
    const couponId = await seedPlatformVoucher(testApp, "REFUND10");
    const creditCardPublicId = await issueCreditCard(testApp, 50000);
    const vendorA = await seed.restaurant({ name: "退款雞排攤" });
    const vendorB = await seed.restaurant({ name: "退款甜點攤" });
    const [itemA, itemB] = await Promise.all([
      seed.menuItem(vendorA.id, {
        name: "退款雞排",
        price: 120,
        priceCents: 12000,
      }),
      seed.menuItem(vendorB.id, {
        name: "退款地瓜球",
        price: 80,
        priceCents: 8000,
      }),
    ]);

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(vendorA.id),
        marketId: market.id,
        stallNumber: "R01",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(vendorB.id),
        marketId: market.id,
        stallNumber: "R02",
        joinedAt: new Date(),
      },
    ]);

    const createRes = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: { ...CSRF_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          marketSlug: market.slug,
          guestName: "Voucher Refund Guest",
          phoneLastDigits: "456",
          vendors: [
            {
              restaurantId: String(vendorA.id),
              items: [{ menuItemId: itemA.id, quantity: 1 }],
            },
            {
              restaurantId: String(vendorB.id),
              items: [{ menuItemId: itemB.id, quantity: 1 }],
            },
          ],
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createJson = await readData<CreatedCheckout>(createRes);
    const checkoutId = createJson.checkout.id as string;

    const applyVoucherRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/${checkoutId}/voucher`,
        {
          method: "POST",
          headers: {
            ...holderHeaders(createJson),
            ...CSRF_HEADERS,
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: "REFUND10" }),
        },
      ),
    );
    expect(applyVoucherRes.status).toBe(200);

    const payRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/market-checkouts/${checkoutId}/pay`, {
        method: "POST",
        headers: {
          ...holderHeaders(createJson),
          ...CSRF_HEADERS,
          "content-type": "application/json",
          "idempotency-key": `market-voucher-pay-${checkoutId}`,
        },
        body: JSON.stringify({
          method: "credits",
          providerInput: { creditCardPublicId },
        }),
      }),
    );
    expect(payRes.status).toBe(200);

    const activeUsage = await testApp.testDb.drizzle
      .select()
      .from(couponUsage)
      .where(eq(couponUsage.couponId, couponId))
      .all();
    expect(activeUsage).toHaveLength(2);
    expect(activeUsage.every((usage) => usage.status === "active")).toBe(true);

    const adminToken = await testApp.authHelper.adminToken(String(vendorA.id));
    const refundRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/market-checkouts/${checkoutId}/refund`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "voucher_refund" }),
      }),
    );
    expect(refundRes.status).toBe(200);

    const refundedUsage = await testApp.testDb.drizzle
      .select()
      .from(couponUsage)
      .where(eq(couponUsage.couponId, couponId))
      .all();
    expect(refundedUsage).toHaveLength(2);
    expect(refundedUsage.every((usage) => usage.status === "refunded")).toBe(
      true,
    );
  });

  it("persists applied vouchers so checkout can pay discounted total after KV expiry", async () => {
    const market = await seedMarket(testApp);
    const couponId = await seedPlatformVoucher(testApp, "PERSIST10");
    const creditCardPublicId = await issueCreditCard(testApp, 50000);
    const vendorA = await seed.restaurant({ name: "持久券雞排攤" });
    const vendorB = await seed.restaurant({ name: "持久券甜點攤" });
    const [itemA, itemB] = await Promise.all([
      seed.menuItem(vendorA.id, {
        name: "持久券雞排",
        price: 120,
        priceCents: 12000,
      }),
      seed.menuItem(vendorB.id, {
        name: "持久券地瓜球",
        price: 80,
        priceCents: 8000,
      }),
    ]);

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(vendorA.id),
        marketId: market.id,
        stallNumber: "V01",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(vendorB.id),
        marketId: market.id,
        stallNumber: "V02",
        joinedAt: new Date(),
      },
    ]);

    const createRes = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: { ...CSRF_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          marketSlug: market.slug,
          guestName: "Persisted Voucher Guest",
          phoneLastDigits: "654",
          vendors: [
            {
              restaurantId: String(vendorA.id),
              items: [{ menuItemId: itemA.id, quantity: 1 }],
            },
            {
              restaurantId: String(vendorB.id),
              items: [{ menuItemId: itemB.id, quantity: 1 }],
            },
          ],
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createJson = await readData<CreatedCheckout>(createRes);
    const checkoutId = createJson.checkout.id as string;

    const applyVoucherRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/${checkoutId}/voucher`,
        {
          method: "POST",
          headers: {
            ...holderHeaders(createJson),
            ...CSRF_HEADERS,
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: "PERSIST10" }),
        },
      ),
    );
    expect(applyVoucherRes.status).toBe(200);
    const applyVoucherJson = await readData<AppliedVoucher>(applyVoucherRes);
    expect(applyVoucherJson.payableCents).toBe(18000);

    await testApp.env.CACHE_KV.delete(`market_checkout:${checkoutId}`);

    // Read as the holder: the applied voucher is part of what the redacted
    // view withholds, and what this asserts is that it survived KV expiry into
    // D1 — an owner-facing claim.
    const publicRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/market-checkouts/${checkoutId}`, {
        headers: holderHeaders(createJson),
      }),
    );
    expect(publicRes.status).toBe(200);
    const publicJson = await readData<CheckoutEnvelope>(publicRes);
    expect(publicJson.checkout.appliedVoucher).toMatchObject({
      couponId,
      code: "PERSIST10",
      discountCents: 2000,
    });

    const payRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/market-checkouts/${checkoutId}/pay`, {
        method: "POST",
        headers: {
          ...holderHeaders(createJson),
          ...CSRF_HEADERS,
          "content-type": "application/json",
          "idempotency-key": `market-voucher-persist-pay-${checkoutId}`,
        },
        body: JSON.stringify({
          method: "credits",
          providerInput: { creditCardPublicId },
        }),
      }),
    );
    expect(payRes.status).toBe(200);
    const payJson = await readData<PaidCheckout>(payRes);
    expect(payJson.payment).toMatchObject({
      status: "paid",
      totalAmountCents: 18000,
      paidAmountCents: 18000,
    });

    const usage = await testApp.testDb.drizzle
      .select()
      .from(couponUsage)
      .where(eq(couponUsage.couponId, couponId))
      .all();
    expect(usage).toHaveLength(2);
    expect(usage.every((row) => row.status === "active")).toBe(true);
    expect(usage.reduce((sum, row) => sum + row.discountAmountCents!, 0)).toBe(
      2000,
    );
  });

  it("stacks platform and vendor vouchers before credit checkout payment", async () => {
    const market = await seedMarket(testApp);
    const creditCardPublicId = await issueCreditCard(testApp, 50000);
    const vendorA = await seed.restaurant({ name: "疊券雞排攤" });
    const vendorB = await seed.restaurant({ name: "疊券甜點攤" });
    const [platformCouponId, vendorCouponId] = await Promise.all([
      seedPlatformVoucher(testApp, "STACK10"),
      seedVendorVoucher(testApp, "SHOP500", String(vendorA.id)),
    ]);
    const [itemA, itemB] = await Promise.all([
      seed.menuItem(vendorA.id, {
        name: "疊券雞排",
        price: 120,
        priceCents: 12000,
      }),
      seed.menuItem(vendorB.id, {
        name: "疊券地瓜球",
        price: 80,
        priceCents: 8000,
      }),
    ]);

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(vendorA.id),
        marketId: market.id,
        stallNumber: "S01",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(vendorB.id),
        marketId: market.id,
        stallNumber: "S02",
        joinedAt: new Date(),
      },
    ]);

    const createRes = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: { ...CSRF_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          marketSlug: market.slug,
          guestName: "Stacked Voucher Guest",
          phoneLastDigits: "321",
          vendors: [
            {
              restaurantId: String(vendorA.id),
              items: [{ menuItemId: itemA.id, quantity: 1 }],
            },
            {
              restaurantId: String(vendorB.id),
              items: [{ menuItemId: itemB.id, quantity: 1 }],
            },
          ],
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createJson = await readData<CreatedCheckout>(createRes);
    const checkoutId = createJson.checkout.id as string;

    const platformApplyRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/${checkoutId}/voucher`,
        {
          method: "POST",
          headers: {
            ...holderHeaders(createJson),
            ...CSRF_HEADERS,
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: "STACK10" }),
        },
      ),
    );
    expect(platformApplyRes.status).toBe(200);
    const platformApplyJson = await readData<AppliedVoucher>(platformApplyRes);
    expect(platformApplyJson.payableCents).toBe(18000);

    const vendorApplyRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/${checkoutId}/voucher`,
        {
          method: "POST",
          headers: {
            ...holderHeaders(createJson),
            ...CSRF_HEADERS,
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: "SHOP500" }),
        },
      ),
    );
    expect(vendorApplyRes.status).toBe(200);
    const vendorApplyJson = await readData<AppliedVoucher>(vendorApplyRes);
    expect(vendorApplyJson).toMatchObject({
      discountCents: 2500,
      payableCents: 17500,
    });
    expect(vendorApplyJson.vouchers).toHaveLength(2);
    expect(vendorApplyJson.checkout.appliedVoucher).toMatchObject({
      discountCents: 2500,
      vouchers: [
        { couponId: platformCouponId, code: "STACK10" },
        { couponId: vendorCouponId, code: "SHOP500" },
      ],
    });

    const payRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/market-checkouts/${checkoutId}/pay`, {
        method: "POST",
        headers: {
          ...holderHeaders(createJson),
          ...CSRF_HEADERS,
          "content-type": "application/json",
          "idempotency-key": `market-voucher-stack-pay-${checkoutId}`,
        },
        body: JSON.stringify({
          method: "credits",
          providerInput: { creditCardPublicId },
        }),
      }),
    );
    expect(payRes.status).toBe(200);
    const payJson = await readData<PaidCheckout>(payRes);
    expect(payJson.payment).toMatchObject({
      status: "paid",
      totalAmountCents: 17500,
      paidAmountCents: 17500,
      settlement: {
        platformFeeRateBps: 350,
        // Fees round to whole NT$ per vendor: NT$4.03 -> NT$4, NT$2.80 -> NT$3.
        platformFeeCents: 700,
        vendorNetAmountCents: 18800,
        vendorAllocations: [
          expect.objectContaining({
            restaurantId: String(vendorA.id),
            grossAmountCents: 10300,
            originalAmountCents: 12000,
            platformDiscountCents: 1200,
            vendorDiscountCents: 500,
            settlementBaseCents: 11500,
            platformFeeCents: 400,
            netAmountCents: 11100,
          }),
          expect.objectContaining({
            restaurantId: String(vendorB.id),
            grossAmountCents: 7200,
            originalAmountCents: 8000,
            platformDiscountCents: 800,
            vendorDiscountCents: 0,
            settlementBaseCents: 8000,
            platformFeeCents: 300,
            netAmountCents: 7700,
          }),
        ],
      },
    });

    const adminToken = await testApp.authHelper.adminToken(String(vendorA.id));
    const accountingRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/admin/accounting/export?paymentStatus=paid`,
        {
          headers: { authorization: `Bearer ${adminToken}` },
        },
      ),
    );
    expect(accountingRes.status).toBe(200);
    const accountingCsv = await accountingRes.text();
    expect(accountingCsv).toContain("platform-funded voucher discount");
    expect(accountingCsv).toContain(
      ",5000,discounts_contra_revenue,debit,1200,",
    );
    expect(accountingCsv).toContain(
      ",5000,discounts_contra_revenue,debit,800,",
    );
    expect(accountingCsv).toContain(",2200,vendor_payable,credit,11100,");
    expect(accountingCsv).toContain(",2200,vendor_payable,credit,7700,");

    const platformUsage = await testApp.testDb.drizzle
      .select()
      .from(couponUsage)
      .where(eq(couponUsage.couponId, platformCouponId))
      .all();
    const vendorUsage = await testApp.testDb.drizzle
      .select()
      .from(couponUsage)
      .where(eq(couponUsage.couponId, vendorCouponId))
      .all();
    expect(platformUsage).toHaveLength(2);
    expect(vendorUsage).toHaveLength(1);
    expect(
      platformUsage.reduce((sum, row) => sum + row.discountAmountCents!, 0),
    ).toBe(2000);
    expect(vendorUsage[0]).toMatchObject({
      discountAmountCents: 500,
    });
  });

  it("records market checkout onsite payment through an active POS shift", async () => {
    const market = await seedMarket(testApp);
    const vendorA = await seed.restaurant({ name: "現場收款攤" });
    const vendorB = await seed.restaurant({ name: "配合攤" });
    const [itemA, itemB] = await Promise.all([
      seed.menuItem(vendorA.id, {
        name: "現場雞排",
        price: 120,
        priceCents: 12000,
      }),
      seed.menuItem(vendorB.id, {
        name: "現場甜點",
        price: 80,
        priceCents: 8000,
      }),
    ]);

    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(vendorA.id),
        marketId: market.id,
        stallNumber: "P01",
        joinedAt: new Date(),
      },
      {
        restaurantId: String(vendorB.id),
        marketId: market.id,
        stallNumber: "P02",
        joinedAt: new Date(),
      },
    ]);
    await insertSubscription(String(vendorA.id));

    const owner = await seed.user({
      role: 1,
      restaurantId: String(vendorA.id),
    });
    const cashier = await seed.user({
      role: 4,
      restaurantId: String(vendorA.id),
    });
    const ownerToken = await testApp.authHelper.ownerToken(
      owner.id,
      String(vendorA.id),
    );
    const cashierToken = await testApp.authHelper.staffToken(
      cashier.id,
      4,
      String(vendorA.id),
    );
    const registerRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/registers`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Market POS Register",
          restaurantId: String(vendorA.id),
        }),
      }),
    );
    expect(registerRes.status).toBe(200);
    const registerJson = await readData<{ id: string }>(registerRes);
    const registerId = registerJson.id as string;

    const shiftRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/shifts/start`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${cashierToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          registerId,
          operatorId: cashier.id,
          startAmount: 500,
        }),
      }),
    );
    expect(shiftRes.status).toBe(200);
    const shiftJson = await readData<{ id: string }>(shiftRes);
    const shiftId = shiftJson.id as string;

    const createRes = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: { ...CSRF_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          marketSlug: market.slug,
          guestName: "Onsite Guest",
          phoneLastDigits: "456",
          vendors: [
            {
              restaurantId: String(vendorA.id),
              items: [{ menuItemId: itemA.id, quantity: 1 }],
            },
            {
              restaurantId: String(vendorB.id),
              items: [{ menuItemId: itemB.id, quantity: 1 }],
            },
          ],
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createJson = await readData<CreatedCheckout>(createRes);
    const checkoutId = createJson.checkout.id as string;

    const posPayRes = await testApp.app.fetch(
      new Request(`${POS_BASE}/market-checkouts/${checkoutId}/pay`, {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          authorization: `Bearer ${cashierToken}`,
          "content-type": "application/json",
          "idempotency-key": `pos-${checkoutId}`,
        },
        body: JSON.stringify({
          registerId,
          shiftId,
          paymentMethod: "cash",
        }),
      }),
    );

    expect(posPayRes.status).toBe(200);
    const posPayJson = await readData<PaidCheckout>(posPayRes);
    expect(posPayJson.payment).toMatchObject({
      status: "paid",
      method: "pos_cash",
      totalAmountCents: 20000,
      paidAmountCents: 20000,
      parentPayment: {
        paymentId: `market_pay_${checkoutId}`,
        provider: "pos_cash",
        idempotencyKey: `pos-${checkoutId}`,
      },
    });

    const paidSession = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutSessions)
      .where(eq(marketCheckoutSessions.id, checkoutId))
      .get();
    expect(paidSession?.paymentStatus).toBe("paid");
    expect(paidSession?.paymentSummary).toMatchObject({
      status: "paid",
      method: "pos_cash",
      parentPayment: {
        provider: "pos_cash",
      },
    });

    const parentPayment = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutPayments)
      .where(eq(marketCheckoutPayments.checkoutId, checkoutId))
      .get();
    expect(parentPayment).toMatchObject({
      paymentId: `market_pay_${checkoutId}`,
      provider: "pos_cash",
      status: "paid",
      amountCents: 20000,
      paidAmountCents: 20000,
      // Resolved from the vendors: the POS request sent no currency.
      currency: "TWD",
      countryCode: "TW",
    });
    expect(parentPayment?.providerPayload).toMatchObject({
      source: "pos_market_checkout",
      registerId,
      shiftId,
      paymentMethod: "cash",
    });

    const childRows = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutChildOrders)
      .where(eq(marketCheckoutChildOrders.checkoutId, checkoutId))
      .all();
    const childPaymentTransactions = await Promise.all(
      childRows.map((child) =>
        testApp.testDb.drizzle
          .select()
          .from(paymentTransactions)
          .where(eq(paymentTransactions.orderId, child.orderId))
          .get(),
      ),
    );
    expect(childPaymentTransactions).toHaveLength(2);
    expect(childPaymentTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paymentMethod: "cash",
          gateway: "pos",
          status: "paid",
        }),
      ]),
    );

    const paidChildOrder = await testApp.testDb.drizzle
      .select()
      .from(orders)
      .where(eq(orders.id, childRows[0].orderId))
      .get();
    // orders.payment_status and market_checkout_sessions.payment_status are
    // deliberately different vocabularies. ORDER_PAYMENT_STATUSES has no
    // "paid" member, so writing it made the value read back as pending —
    // that was #311, fixed in c096a0f7. The session assertions above keep
    // saying "paid" because that table really does use it.
    expect(paidChildOrder?.paymentStatus).toBe("completed");
    expect(paidChildOrder?.paymentMethod).toBe("cash");

    const updatedShift = await testApp.testDb.drizzle
      .select()
      .from(cashShifts)
      .where(eq(cashShifts.id, shiftId))
      .get();
    expect(updatedShift).toMatchObject({
      totalSalesCents: 20000,
      cashSalesCents: 20000,
      totalTransactions: 1,
    });

    const saleMovement = await testApp.testDb.drizzle
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.shiftId, shiftId))
      .all();
    expect(saleMovement).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "sale",
          amountCents: 20000,
          referenceType: "market_checkout",
          paymentMethod: "cash",
        }),
      ]),
    );
  });

  describe("currency authority", () => {
    /**
     * A checkout whose vendors price in the given currencies. Returns the
     * creation response unparsed, so a mixed-currency request can assert its
     * rejection, plus the vendor ids.
     */
    async function createCheckoutInCurrencies(
      currencies: Array<string | undefined>,
    ) {
      const market = await seedMarket(testApp);
      const vendors = await Promise.all(
        currencies.map(async (currency, index) => {
          const vendor = await seed.restaurant({
            name: `幣別攤 ${index}`,
            settings: {
              allowOnlineOrdering: true,
              allowGuestOrders: true,
              ...(currency !== undefined && { currency }),
            },
          });
          const item = await seed.menuItem(vendor.id, {
            name: `幣別品項 ${index}`,
            price: 100,
            priceCents: 10000,
          });
          return { vendorId: String(vendor.id), itemId: item.id };
        }),
      );
      await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values(
        vendors.map((vendor, index) => ({
          restaurantId: vendor.vendorId,
          marketId: market.id,
          stallNumber: `C${index}`,
          joinedAt: new Date(),
        })),
      );
      const response = await testApp.app.fetch(
        new Request("https://test/api/v1/market-checkouts", {
          method: "POST",
          headers: CUSTOMER_HEADERS,
          body: JSON.stringify({
            marketSlug: market.slug,
            guestName: "Currency Guest",
            phoneLastDigits: "321",
            vendors: vendors.map((vendor) => ({
              restaurantId: vendor.vendorId,
              items: [{ menuItemId: vendor.itemId, quantity: 1 }],
            })),
          }),
        }),
      );
      return { response, vendors };
    }

    // A market checkout needs at least two vendors.
    async function createPayableCheckout(currency: string | undefined) {
      const { response } = await createCheckoutInCurrencies([
        currency,
        currency,
      ]);
      expect(response.status).toBe(201);
      return readData<CreatedCheckout>(response);
    }

    function payWithCredits(
      created: CreatedCheckout,
      creditCardPublicId: string,
      claim: { currency?: string; country?: string } = {},
    ) {
      return testApp.app.fetch(
        new Request(
          `https://test/api/v1/market-checkouts/${created.checkout.id}/pay`,
          {
            method: "POST",
            headers: {
              ...CUSTOMER_HEADERS,
              ...holderHeaders(created),
              "idempotency-key": `currency-pay-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
              method: "credits",
              providerInput: { creditCardPublicId },
              ...claim,
            }),
          },
        ),
      );
    }

    async function balanceOf(publicId: string) {
      const balance = await new CreditService(testApp.env as never).getBalance(
        publicId,
      );
      return balance.balanceCents;
    }

    it("does not let a TWD card pay an MYR checkout, whatever the client claims", async () => {
      const created = await createPayableCheckout("MYR");
      const twdCard = await issueCreditCard(testApp, 50000, "TWD");

      // Omitted: the server resolves MYR and the TWD card is refused.
      const omitted = await payWithCredits(created, twdCard);
      expect(omitted.status).toBe(202);
      expect(await readData<PaidCheckout>(omitted)).toMatchObject({
        payment: { status: "failed", currency: "MYR", country: "MY" },
      });

      // Lying: claiming TWD is a mismatch, rejected before any provider call.
      const lying = await payWithCredits(created, twdCard, {
        currency: "TWD",
        country: "TW",
      });
      expect(lying.status).toBe(400);
      expect(await lying.json()).toMatchObject({
        error: {
          code: "CURRENCY_MISMATCH",
          details: { expectedCurrency: "MYR", expectedCountry: "MY" },
        },
      });

      expect(await balanceOf(twdCard)).toBe(50000);
      const childOrderIds = created.checkout.childOrders.map((child) =>
        String(child.orderId),
      );
      const childOrders = await testApp.testDb.drizzle
        .select({ paymentStatus: orders.paymentStatus })
        .from(orders)
        .where(inArray(orders.id, childOrderIds))
        .all();
      expect(childOrders).toEqual([
        { paymentStatus: "pending" },
        { paymentStatus: "pending" },
      ]);
    });

    it("settles an MYR checkout from an MYR card with no currency sent", async () => {
      const created = await createPayableCheckout("MYR");
      const myrCard = await issueCreditCard(testApp, 50000, "MYR");

      const response = await payWithCredits(created, myrCard);

      expect(response.status).toBe(200);
      expect(await readData<PaidCheckout>(response)).toMatchObject({
        payment: { status: "paid", currency: "MYR", country: "MY" },
      });
      expect(await balanceOf(myrCard)).toBe(30000);
      const parentPayment = await testApp.testDb.drizzle
        .select()
        .from(marketCheckoutPayments)
        .where(eq(marketCheckoutPayments.checkoutId, created.checkout.id))
        .get();
      expect(parentPayment).toMatchObject({
        status: "paid",
        currency: "MYR",
        countryCode: "MY",
      });
    });

    it("defaults a vendor with no currency setting to TWD", async () => {
      const created = await createPayableCheckout(undefined);
      const twdCard = await issueCreditCard(testApp, 50000, "TWD");

      const response = await payWithCredits(created, twdCard, {
        currency: "TWD",
      });

      expect(response.status).toBe(200);
      expect(await readData<PaidCheckout>(response)).toMatchObject({
        payment: { status: "paid", currency: "TWD", country: "TW" },
      });
    });

    it("rejects a checkout across vendors in different currencies", async () => {
      const { response, vendors } = await createCheckoutInCurrencies([
        "TWD",
        "MYR",
      ]);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "MIXED_CURRENCY_CHECKOUT" },
      });
      const created = await testApp.testDb.drizzle
        .select({ id: orders.id })
        .from(orders)
        .where(
          inArray(
            orders.restaurantId,
            vendors.map((vendor) => vendor.vendorId),
          ),
        )
        .all();
      expect(created).toEqual([]);
    });

    it("rejects paying once a vendor's currency has diverged after creation", async () => {
      const { response, vendors } = await createCheckoutInCurrencies([
        "MYR",
        "MYR",
      ]);
      expect(response.status).toBe(201);
      const created = await readData<CreatedCheckout>(response);
      await testApp.testDb.drizzle
        .update(restaurants)
        .set({
          settings: {
            allowOnlineOrdering: true,
            allowGuestOrders: true,
            currency: "TWD",
          },
        })
        .where(eq(restaurants.id, vendors[1]!.vendorId));
      const myrCard = await issueCreditCard(testApp, 50000, "MYR");

      const pay = await payWithCredits(created, myrCard);

      expect(pay.status).toBe(409);
      expect(await pay.json()).toMatchObject({
        error: { code: "MIXED_CURRENCY_CHECKOUT" },
      });
      expect(await balanceOf(myrCard)).toBe(50000);
    });
  });

  async function putRestaurantPushSubscription(
    restaurantId: string,
    suffix: string,
  ) {
    await testApp.env.CACHE_KV.put(
      `push:subscription:${encodeURIComponent(restaurantId)}:user-1:${suffix}`,
      JSON.stringify({
        id: suffix,
        userId: 1,
        username: "kitchen",
        userRole: 2,
        userType: "kitchen",
        restaurantId,
        subscription: {
          endpoint: `https://push.example.test/${suffix}`,
          keys: {
            p256dh: `${suffix}-p256dh`,
            auth: `${suffix}-auth`,
          },
        },
        deviceInfo: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  function insertSubscription(restaurantId: string) {
    return testApp.env.DB.prepare(
      `INSERT INTO shop_subscriptions
        (id, restaurant_id, plan_tier, module_overrides,
         is_active, trial_ends_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'trial', ?, 1, ?, ?, ?)`,
    )
      .bind(
        `sub-${restaurantId}`,
        restaurantId,
        JSON.stringify({ pos: true }),
        Date.now() + 24 * 60 * 60 * 1000,
        Date.now(),
        Date.now(),
      )
      .run();
  }
});
