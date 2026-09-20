/**
 * A paid market checkout must leave every *child order* paid, on real D1.
 *
 * The customer pays one aggregate amount, but each vendor owns its own `orders`
 * row, and that row is what the kitchen display and the vendor's admin
 * dashboard read. Until this suite existed, only the POS path wrote it: an
 * online checkout settled for the full amount while both vendors still saw
 * `payment_status = 'pending'`.
 *
 * The reference for "paid" is the POS path
 * (`features/pos/services/MarketCheckoutPOSPaymentService.ts`): a
 * `payment_transactions` row per vendor plus `orders.payment_status`,
 * `payment_method`, `payment_transaction_id` and `paid_at_ms` — and *not*
 * `orders.status`, which stays the vendor's to advance.
 *
 * Provider adapter and webhook shapes are faked exactly as in
 * `market-checkout-provider-money.real.integration.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import {
  marketCheckoutPayments,
  markets,
  orders,
  paymentTransactions,
  restaurantMarketMemberships,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";
import { readData } from "../helpers/read-json";
import type { PublicMarketCheckoutSession } from "../../features/market-checkouts/routes";

const ADAPTER = "https://fake-adapter.test";
const WEBHOOK_SECRET = "fake-provider-webhook-secret";
const PRICES: [number, number] = [17900, 5200];
const TOTAL_CENTS = PRICES[0] + PRICES[1];

const CUSTOMER_HEADERS = {
  host: "test",
  origin: "https://test",
  "content-type": "application/json",
};
const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  cookie: `csrf_token=${"a".repeat(64)}`,
  "x-csrf-token": "a".repeat(64),
};

interface AdapterState {
  requests: Array<{ url: string; body: Record<string, unknown> }>;
  createResponse?: (body: Record<string, unknown>) => Record<string, unknown>;
  statusResponse?: (body: Record<string, unknown>) => Record<string, unknown>;
  refundResponse?: (body: Record<string, unknown>) => Record<string, unknown>;
}

describe("market checkout child order settlement - real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: SeedHelpers;
  let adapter: AdapterState;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  }, 300000);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
    Object.assign(testApp.env, {
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL: `${ADAPTER}/payments`,
      MARKET_CHECKOUT_PROVIDER_STATUS_URL: `${ADAPTER}/status`,
      MARKET_CHECKOUT_PROVIDER_REFUND_URL: `${ADAPTER}/refunds`,
      MARKET_CHECKOUT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    adapter = { requests: [] };
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.startsWith(ADAPTER)) return originalFetch(input, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      adapter.requests.push({ url, body });
      return Response.json(fakeAdapterAnswer(url, body));
    }) as typeof fetch;
  });

  function fakeAdapterAnswer(url: string, body: Record<string, unknown>) {
    if (url.endsWith("/payments")) {
      return (
        adapter.createResponse?.(body) ?? {
          provider: "stripe",
          providerTransactionId: `pi_${String(body.checkoutId)}`,
          status: "requires_action",
          authorizedAmountCents: 0,
          allocations: [],
          nextAction: {
            type: "redirect",
            redirectUrl: `https://fake-pay.test/confirm/${String(body.checkoutId)}`,
          },
        }
      );
    }
    if (url.endsWith("/status")) {
      return (
        adapter.statusResponse?.(body) ?? {
          provider: "stripe",
          providerTransactionId: body.providerTransactionId,
          status: "paid",
          amountReceivedCents: body.amountCents,
          currency: body.currency,
          eventId: `lookup-${String(body.paymentId)}`,
        }
      );
    }
    return (
      adapter.refundResponse?.(body) ?? {
        provider: "stripe",
        providerTransactionId: body.providerTransactionId,
        refundId: `re_${String(body.checkoutId)}`,
        status: "refunded",
        refundedAmountCents: body.amountCents,
        currency: body.currency,
      }
    );
  }

  async function createCheckout() {
    const now = new Date();
    const [market] = await testApp.testDb.drizzle
      .insert(markets)
      .values({
        id: `market-${crypto.randomUUID()}`,
        slug: `child-settle-${crypto.randomUUID()}`,
        name: "Child settlement market",
        type: "night_market",
        description: "child settlement fixture",
        city: "City",
        district: "District",
        address: "1 Market Street",
        latitude: 24.1,
        longitude: 120.6,
        openingHours: {},
        platformFeeRateBps: 350,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const settings = {
      allowOnlineOrdering: true,
      allowGuestOrders: true,
      currency: "TWD",
    };
    const vendorA = await seed.restaurant({ name: "Stall A", settings });
    const vendorB = await seed.restaurant({ name: "Stall B", settings });
    const [itemA, itemB] = await Promise.all([
      seed.menuItem(vendorA.id, {
        name: "Item A",
        price: PRICES[0] / 100,
        priceCents: PRICES[0],
      }),
      seed.menuItem(vendorB.id, {
        name: "Item B",
        price: PRICES[1] / 100,
        priceCents: PRICES[1],
      }),
    ]);
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values([
      {
        restaurantId: String(vendorA.id),
        marketId: market.id,
        stallNumber: "A01",
        joinedAt: now,
      },
      {
        restaurantId: String(vendorB.id),
        marketId: market.id,
        stallNumber: "B01",
        joinedAt: now,
      },
    ]);

    const response = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: CUSTOMER_HEADERS,
        body: JSON.stringify({
          marketSlug: market.slug,
          guestName: "Settlement Guest",
          phoneLastDigits: "123",
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
    expect(response.status).toBe(201);
    const created = await readData<{
      checkout: PublicMarketCheckoutSession;
      childOrders: Array<{ guestToken: string }>;
    }>(response);
    return {
      checkoutId: created.checkout.id,
      paymentId: `market_pay_${created.checkout.id}`,
      guestToken: created.childOrders[0]!.guestToken,
      vendorId: String(vendorA.id),
      orderIds: created.checkout.childOrders.map((child) =>
        String(child.orderId),
      ),
    };
  }

  async function pay(checkout: { checkoutId: string; guestToken: string }) {
    return testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/${checkout.checkoutId}/pay`,
        {
          method: "POST",
          headers: {
            ...CUSTOMER_HEADERS,
            "x-guest-token": checkout.guestToken,
            "idempotency-key": `pay-${checkout.checkoutId}`,
          },
          body: JSON.stringify({
            method: "market_online",
            country: "TW",
            currency: "TWD",
          }),
        },
      ),
    );
  }

  function paymentIntentSucceeded(
    checkout: { checkoutId: string; paymentId: string },
    eventId: string,
    amount = TOTAL_CENTS,
  ) {
    return {
      id: eventId,
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: `pi_${checkout.checkoutId}`,
          object: "payment_intent",
          amount,
          amount_received: amount,
          currency: "twd",
          status: "succeeded",
          metadata: {
            marketCheckoutId: checkout.checkoutId,
            marketCheckoutPaymentId: checkout.paymentId,
          },
        },
      },
    };
  }

  async function stripeWebhook(event: Record<string, unknown>) {
    const raw = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await hmacHex(WEBHOOK_SECRET, `${timestamp}.${raw}`);
    const response = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/market-checkouts/payment-webhooks/stripe",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": `t=${timestamp},v1=${signature}`,
          },
          body: raw,
        },
      ),
    );
    expect(response.status).toBe(200);
    return readData<Record<string, unknown>>(response);
  }

  async function reconcile(checkout: { checkoutId: string; vendorId: string }) {
    const adminToken = await testApp.authHelper.adminToken(checkout.vendorId);
    const response = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/admin/${checkout.checkoutId}/reconcile`,
        {
          method: "POST",
          headers: { ...CSRF_HEADERS, authorization: `Bearer ${adminToken}` },
        },
      ),
    );
    expect(response.status).toBe(200);
    return readData<{ reconciliation: Record<string, unknown> }>(response);
  }

  async function refund(checkout: { checkoutId: string; vendorId: string }) {
    const adminToken = await testApp.authHelper.adminToken(checkout.vendorId);
    return testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/${checkout.checkoutId}/refund`,
        {
          method: "POST",
          headers: {
            ...CSRF_HEADERS,
            authorization: `Bearer ${adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ reason: "child_settlement_round_trip" }),
        },
      ),
    );
  }

  async function childOrderRows(orderIds: string[]) {
    return testApp.testDb.drizzle
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
      .where(inArray(orders.id, orderIds))
      .orderBy(asc(orders.id))
      .all();
  }

  async function childPaymentRows(checkoutId: string) {
    const rows = await testApp.testDb.drizzle
      .select({
        transactionId: paymentTransactions.transactionId,
        orderId: paymentTransactions.orderId,
        restaurantId: paymentTransactions.restaurantId,
        amountCents: paymentTransactions.amountCents,
        currency: paymentTransactions.currency,
        countryCode: paymentTransactions.countryCode,
        gateway: paymentTransactions.gateway,
        status: paymentTransactions.status,
        paymentMethod: paymentTransactions.paymentMethod,
        completedAt: paymentTransactions.completedAt,
      })
      .from(paymentTransactions)
      .orderBy(asc(paymentTransactions.transactionId))
      .all();
    return rows.filter((row) =>
      row.transactionId.startsWith(`mkt_${checkoutId}_`),
    );
  }

  it("a provider webhook marks both child orders paid, POS-shaped", async () => {
    const checkout = await createCheckout();
    expect((await pay(checkout)).status).toBe(202);

    // Before the webhook: the customer has not paid, so neither has a vendor.
    expect(await childOrderRows(checkout.orderIds)).toEqual([
      expect.objectContaining({ paymentStatus: "pending", paidAt: null }),
      expect.objectContaining({ paymentStatus: "pending", paidAt: null }),
    ]);

    const result = await stripeWebhook(
      paymentIntentSucceeded(checkout, "evt_paid_1"),
    );
    expect(result).toMatchObject({ reconciled: true, status: "paid" });

    const paymentRow = await testApp.testDb.drizzle
      .select()
      .from(marketCheckoutPayments)
      .where(eq(marketCheckoutPayments.checkoutId, checkout.checkoutId))
      .get();
    expect(paymentRow).toMatchObject({
      status: "paid",
      paidAmountCents: TOTAL_CENTS,
      currency: "TWD",
    });

    const childOrders = await childOrderRows(checkout.orderIds);
    expect(childOrders).toHaveLength(2);
    for (const child of childOrders) {
      expect(child).toMatchObject({
        paymentStatus: "completed",
        paymentMethod: "online",
        paymentTransactionId: `mkt_${checkout.checkoutId}_${child.id}`,
        // The vendor's workflow status is theirs; paying does not advance it.
        status: "pending",
      });
      expect(child.paidAt).toBeInstanceOf(Date);
    }

    const childPayments = await childPaymentRows(checkout.checkoutId);
    expect(childPayments).toHaveLength(2);
    expect(
      childPayments.map((row) => row.amountCents).sort((a, b) => a - b),
    ).toEqual([...PRICES].sort((a, b) => a - b));
    for (const row of childPayments) {
      expect(row).toMatchObject({
        status: "paid",
        currency: "TWD",
        countryCode: "TW",
        gateway: "stripe",
        paymentMethod: "online",
      });
      expect(row.completedAt).toBeInstanceOf(Date);
    }
    // Each vendor is paid for its own order, not the aggregate.
    expect(new Set(childPayments.map((row) => row.restaurantId)).size).toBe(2);
  }, 60000);

  it("redelivery and a later reconciliation neither double-write nor rewind a vendor", async () => {
    const checkout = await createCheckout();
    expect((await pay(checkout)).status).toBe(202);
    await stripeWebhook(paymentIntentSucceeded(checkout, "evt_paid_1"));

    const [firstChild] = await childOrderRows(checkout.orderIds);
    const firstPaidAt = firstChild!.paidAt;

    // A vendor picks the order up before the provider redelivers.
    await testApp.testDb.drizzle
      .update(orders)
      .set({ status: "preparing" })
      .where(eq(orders.id, firstChild!.id))
      .run();

    // Redelivery under a fresh event id: the duplicate-event short circuit does
    // not apply, so this exercises the settlement's own idempotency.
    const redelivered = await stripeWebhook(
      paymentIntentSucceeded(checkout, "evt_paid_redelivered"),
    );
    expect(redelivered).toMatchObject({ reconciled: true, status: "paid" });

    // And a reconciliation run after the webhook already settled.
    expect(await reconcile(checkout)).toMatchObject({
      reconciliation: { status: "paid" },
    });

    expect(await childPaymentRows(checkout.checkoutId)).toHaveLength(2);
    const after = await childOrderRows(checkout.orderIds);
    expect(after).toHaveLength(2);
    expect(after.find((row) => row.id === firstChild!.id)).toMatchObject({
      status: "preparing",
      paymentStatus: "completed",
      paidAt: firstPaidAt,
    });
  }, 60000);

  it("a held webhook leaves the child orders pending and unpaid", async () => {
    const checkout = await createCheckout();
    expect((await pay(checkout)).status).toBe(202);

    const underpaid = await stripeWebhook(
      paymentIntentSucceeded(checkout, "evt_under_1", TOTAL_CENTS - 1),
    );
    expect(underpaid).toMatchObject({
      reconciled: false,
      reviewRequired: true,
      reviewReason: "AMOUNT_MISMATCH",
    });

    expect(await childPaymentRows(checkout.checkoutId)).toHaveLength(0);
    for (const child of await childOrderRows(checkout.orderIds)) {
      expect(child).toMatchObject({
        paymentStatus: "pending",
        paymentTransactionId: null,
        paidAt: null,
      });
    }
  }, 60000);

  it("a full refund carries down to the child orders", async () => {
    const checkout = await createCheckout();
    expect((await pay(checkout)).status).toBe(202);
    await stripeWebhook(paymentIntentSucceeded(checkout, "evt_paid_1"));

    expect((await refund(checkout)).status).toBe(200);

    const childPayments = await childPaymentRows(checkout.checkoutId);
    expect(childPayments).toHaveLength(2);
    for (const row of childPayments) {
      expect(row.status).toBe("refunded");
    }
    for (const child of await childOrderRows(checkout.orderIds)) {
      expect(child.paymentStatus).toBe("refunded");
      expect(child.refundAmountCents).toBeGreaterThan(0);
    }

    // A webhook that arrives after the refund must not resurrect the payment.
    await stripeWebhook(paymentIntentSucceeded(checkout, "evt_paid_late"));
    for (const child of await childOrderRows(checkout.orderIds)) {
      expect(child.paymentStatus).toBe("refunded");
    }
  }, 60000);
});

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
