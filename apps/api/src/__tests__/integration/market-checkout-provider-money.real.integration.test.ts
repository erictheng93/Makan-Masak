/**
 * Market checkout money across the payment-provider boundary, end to end on
 * real D1, for every supported currency.
 *
 * The provider adapter is faked at the HTTP boundary: `globalThis.fetch` is
 * intercepted for the configured adapter URLs only, and answers the way an
 * adapter in front of a real gateway would. Webhooks are sent in the shapes
 * the real gateways use (Stripe `payment_intent.succeeded` with the amount in
 * Stripe's unit for the currency; a LINE Pay confirm result in whole TWD),
 * signed the way the webhook route verifies them.
 *
 * Each currency runs: create checkout -> pay (provider_split) -> adapter
 * returns a redirect -> hostile webhooks (underpaid, wrong currency) are held
 * -> the correct webhook marks it paid with the exact paid_amount_cents ->
 * status lookup agrees -> refund round-trip.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  marketCheckoutPayments,
  markets,
  paymentAuditLog,
  restaurantMarketMemberships,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";
import { readData } from "../helpers/read-json";
import type { PublicMarketCheckoutSession } from "../../features/market-checkouts/routes";

type Currency = "TWD" | "MYR" | "VND";

const ADAPTER = "https://fake-adapter.test";
const WEBHOOK_SECRET = "fake-provider-webhook-secret";
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

/** Stripe's unit per currency (docs.stripe.com/currencies). */
const STRIPE_UNITS_PER_CENT: Record<Currency, number> = {
  TWD: 1,
  MYR: 1,
  VND: 1 / 100,
};

const CASES: Array<{
  currency: Currency;
  country: "TW" | "MY" | "VN";
  prices: [number, number];
  currencyExponent: number;
}> = [
  {
    currency: "TWD",
    country: "TW",
    prices: [12000, 8000],
    currencyExponent: 2,
  },
  { currency: "MYR", country: "MY", prices: [1250, 730], currencyExponent: 2 },
  {
    currency: "VND",
    country: "VN",
    prices: [6000000, 4000000],
    currencyExponent: 0,
  },
];

interface AdapterState {
  requests: Array<{ url: string; body: Record<string, unknown> }>;
  /** How create_payment answers; defaults to a redirect (requires_action). */
  createResponse?: (body: Record<string, unknown>) => Record<string, unknown>;
  statusResponse?: (body: Record<string, unknown>) => Record<string, unknown>;
  refundResponse?: (body: Record<string, unknown>) => Record<string, unknown>;
}

describe("market checkout provider money - real integration", () => {
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

  async function createCheckout(currency: Currency, prices: [number, number]) {
    const now = new Date();
    const [market] = await testApp.testDb.drizzle
      .insert(markets)
      .values({
        id: `market-${crypto.randomUUID()}`,
        slug: `money-${currency.toLowerCase()}-${crypto.randomUUID()}`,
        name: `${currency} market`,
        type: "night_market",
        description: "provider money fixture",
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
      currency,
    };
    const vendorA = await seed.restaurant({ name: "Stall A", settings });
    const vendorB = await seed.restaurant({ name: "Stall B", settings });
    const [itemA, itemB] = await Promise.all([
      seed.menuItem(vendorA.id, {
        name: "Item A",
        price: prices[0] / 100,
        priceCents: prices[0],
      }),
      seed.menuItem(vendorB.id, {
        name: "Item B",
        price: prices[1] / 100,
        priceCents: prices[1],
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
          guestName: "Money Guest",
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
    };
  }

  async function pay(
    checkout: Awaited<ReturnType<typeof createCheckout>>,
    currency: Currency,
    country: string,
  ) {
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
          body: JSON.stringify({ method: "market_online", country, currency }),
        },
      ),
    );
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

  async function linePayConfirm(raw: string) {
    const nonce = crypto.randomUUID();
    const signature = await hmacBase64(
      WEBHOOK_SECRET,
      `${WEBHOOK_SECRET}${raw}${nonce}`,
    );
    const response = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/market-checkouts/payment-webhooks/linepay",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-linepay-nonce": nonce,
            "x-linepay-signature": signature,
          },
          body: raw,
        },
      ),
    );
    expect(response.status).toBe(200);
    return readData<Record<string, unknown>>(response);
  }

  function paymentIntentSucceeded(
    checkout: { checkoutId: string; paymentId: string },
    eventId: string,
    amount: number,
    currency: string,
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
          currency,
          status: "succeeded",
          metadata: {
            marketCheckoutId: checkout.checkoutId,
            marketCheckoutPaymentId: checkout.paymentId,
          },
        },
      },
    };
  }

  async function paymentRow(checkoutId: string) {
    return testApp.testDb.drizzle
      .select()
      .from(marketCheckoutPayments)
      .where(eq(marketCheckoutPayments.checkoutId, checkoutId))
      .get();
  }

  async function reviewAudits(paymentId: string) {
    return testApp.testDb.drizzle
      .select()
      .from(paymentAuditLog)
      .where(
        and(
          eq(paymentAuditLog.paymentTransactionId, paymentId),
          eq(paymentAuditLog.eventType, "failure"),
        ),
      )
      .all();
  }

  it.each(CASES)(
    "$currency: pay -> held hostile webhooks -> paid -> status lookup agrees -> refund",
    async ({ currency, country, prices, currencyExponent }) => {
      const totalCents = prices[0] + prices[1];
      const toStripe = (cents: number) =>
        Math.round(cents * STRIPE_UNITS_PER_CENT[currency]);
      const checkout = await createCheckout(currency, prices);

      // 1. Pay: the adapter is asked for the exact amount in both units.
      const payResponse = await pay(checkout, currency, country);
      expect(payResponse.status).toBe(202);
      const payJson = await readData<{
        payment: { status: string; parentPayment: { nextAction?: unknown } };
      }>(payResponse);
      expect(payJson.payment.status).toBe("pending");
      expect(payJson.payment.parentPayment.nextAction).toMatchObject({
        type: "redirect",
      });
      const createRequest = adapter.requests.find((r) =>
        r.url.endsWith("/payments"),
      );
      expect(createRequest?.body).toMatchObject({
        currency,
        amountCents: totalCents,
        amountMinor: currencyExponent === 0 ? totalCents / 100 : totalCents,
        currencyExponent,
      });
      expect(
        (createRequest?.body.allocations as Array<{ amountCents: number }>)
          .map((a) => a.amountCents)
          .sort((a, b) => a - b),
      ).toEqual([...prices].sort((a, b) => a - b));

      // 2. Underpaid by one unit of the currency: held, not paid.
      const underpaid = await stripeWebhook(
        paymentIntentSucceeded(
          checkout,
          `evt_under_${currency}`,
          toStripe(totalCents) - 1,
          currency.toLowerCase(),
        ),
      );
      expect(underpaid).toMatchObject({
        reconciled: false,
        reviewRequired: true,
        reviewReason: "AMOUNT_MISMATCH",
      });

      // 3. The right number in the wrong currency: held, not paid.
      const wrongCurrency = await stripeWebhook(
        paymentIntentSucceeded(
          checkout,
          `evt_usd_${currency}`,
          toStripe(totalCents),
          "usd",
        ),
      );
      expect(wrongCurrency).toMatchObject({
        reviewRequired: true,
        reviewReason: "CURRENCY_MISMATCH",
      });

      const held = await paymentRow(checkout.checkoutId);
      expect(held).toMatchObject({
        status: "pending",
        paidAmountCents: 0,
        amountCents: totalCents,
        currency,
      });
      expect(held?.providerPayload).toMatchObject({
        lastWebhook: {
          status: "review_required",
          reviewReason: "CURRENCY_MISMATCH",
        },
      });
      expect(await reviewAudits(checkout.paymentId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            errorCode: "MARKET_CHECKOUT_WEBHOOK_AMOUNT_MISMATCH",
            providerEventId: `evt_under_${currency}:review`,
          }),
          expect.objectContaining({
            errorCode: "MARKET_CHECKOUT_WEBHOOK_CURRENCY_MISMATCH",
          }),
        ]),
      );

      // 4. The real payment, in Stripe's unit for this currency.
      const paid = await stripeWebhook(
        paymentIntentSucceeded(
          checkout,
          `evt_paid_${currency}`,
          toStripe(totalCents),
          currency.toLowerCase(),
        ),
      );
      expect(paid).toMatchObject({ reconciled: true, status: "paid" });
      expect(await paymentRow(checkout.checkoutId)).toMatchObject({
        status: "paid",
        paidAmountCents: totalCents,
        refundedAmountCents: 0,
        providerTransactionId: `pi_${checkout.checkoutId}`,
      });

      // 5. Status lookup (admin reconcile) agrees and changes nothing.
      const adminToken = await testApp.authHelper.adminToken(checkout.vendorId);
      const reconcileResponse = await testApp.app.fetch(
        new Request(
          `https://test/api/v1/market-checkouts/admin/${checkout.checkoutId}/reconcile`,
          {
            method: "POST",
            headers: { ...CSRF_HEADERS, authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(reconcileResponse.status).toBe(200);
      expect(
        await readData<{ reconciliation: Record<string, unknown> }>(
          reconcileResponse,
        ),
      ).toMatchObject({ reconciliation: { status: "paid" } });
      const lookup = adapter.requests.find((r) => r.url.endsWith("/status"));
      expect(lookup?.body).toMatchObject({
        amountCents: totalCents,
        currency,
        currencyExponent,
      });
      expect(await paymentRow(checkout.checkoutId)).toMatchObject({
        status: "paid",
        paidAmountCents: totalCents,
      });

      // 6. Refund round-trip.
      const refundResponse = await testApp.app.fetch(
        new Request(
          `https://test/api/v1/market-checkouts/${checkout.checkoutId}/refund`,
          {
            method: "POST",
            headers: {
              ...CSRF_HEADERS,
              authorization: `Bearer ${adminToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ reason: "money_round_trip" }),
          },
        ),
      );
      expect(refundResponse.status).toBe(200);
      const refundRequest = adapter.requests.find((r) =>
        r.url.endsWith("/refunds"),
      );
      expect(refundRequest?.body).toMatchObject({
        amountCents: totalCents,
        currency,
        currencyExponent,
      });
      expect(await paymentRow(checkout.checkoutId)).toMatchObject({
        status: "refunded",
        paidAmountCents: totalCents,
        refundedAmountCents: totalCents,
        currency,
      });
    },
    60000,
  );

  it("TWD: a LINE Pay confirm result is read in whole NT$", async () => {
    const checkout = await createCheckout("TWD", [12000, 8000]);
    expect((await pay(checkout, "TWD", "TW")).status).toBe(202);

    // NT$200 as LINE Pay reports it: 150 by card + 50 in points, whole TWD,
    // and a 19-digit transaction id that JSON numbers cannot hold exactly.
    const confirm = `{"returnCode":"0000","returnMessage":"Success.","currency":"TWD","info":{"orderId":"${checkout.paymentId}","transactionId":2026091912345678901,"payInfo":[{"method":"CREDIT_CARD","amount":150},{"method":"POINT","amount":50}]}}`;
    const result = await linePayConfirm(confirm);

    expect(result).toMatchObject({
      reconciled: true,
      status: "paid",
      eventId: "linepay-confirm:2026091912345678901",
    });
    expect(await paymentRow(checkout.checkoutId)).toMatchObject({
      status: "paid",
      paidAmountCents: 20000,
      providerTransactionId: "2026091912345678901",
    });
  }, 60000);

  it("TWD: a cents-sized amount on the LINE Pay route is held (it means NT$20,000)", async () => {
    const checkout = await createCheckout("TWD", [12000, 8000]);
    expect((await pay(checkout, "TWD", "TW")).status).toBe(202);

    const confirm = `{"returnCode":"0000","currency":"TWD","info":{"orderId":"${checkout.paymentId}","transactionId":"2026091900000000001","payInfo":[{"method":"CREDIT_CARD","amount":20000}]}}`;
    const result = await linePayConfirm(confirm);

    expect(result).toMatchObject({
      reviewRequired: true,
      reviewReason: "AMOUNT_MISMATCH",
    });
    expect(await paymentRow(checkout.checkoutId)).toMatchObject({
      status: "pending",
      paidAmountCents: 0,
    });
  }, 60000);

  it("VND: an adapter that authorizes whole dong instead of cents fails the payment", async () => {
    adapter.createResponse = (body) => ({
      provider: "stripe",
      providerTransactionId: `pi_${String(body.checkoutId)}`,
      status: "paid",
      // amountMinor (whole dong) echoed where internal cents were expected.
      authorizedAmountCents: body.amountMinor,
      currency: body.currency,
      allocations: (
        body.allocations as Array<{ orderId: string; amountMinor: number }>
      ).map((a) => ({ orderId: a.orderId, amountCents: a.amountMinor })),
    });
    const checkout = await createCheckout("VND", [6000000, 4000000]);

    const response = await pay(checkout, "VND", "VN");

    expect(response.status).toBe(202);
    const json = await readData<{ payment: { status: string } }>(response);
    expect(json.payment.status).toBe("failed");
    expect(await paymentRow(checkout.checkoutId)).toMatchObject({
      status: "failed",
      paidAmountCents: 0,
    });
  }, 60000);

  it("MYR: a status lookup reporting less than the payment is held, not applied", async () => {
    const checkout = await createCheckout("MYR", [1250, 730]);
    expect((await pay(checkout, "MYR", "MY")).status).toBe(202);
    adapter.statusResponse = (body) => ({
      provider: "stripe",
      providerTransactionId: body.providerTransactionId,
      status: "paid",
      amountReceivedCents: Number(body.amountCents) - 1,
      currency: body.currency,
      eventId: "lookup-underpaid",
    });
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
    expect(
      await readData<{ reconciliation: Record<string, unknown> }>(response),
    ).toMatchObject({
      reconciliation: {
        status: "pending",
        reviewRequired: true,
        reviewReason: "AMOUNT_MISMATCH",
      },
    });
    expect(await paymentRow(checkout.checkoutId)).toMatchObject({
      status: "pending",
      paidAmountCents: 0,
    });
    expect(await reviewAudits(checkout.paymentId)).toEqual([
      expect.objectContaining({
        errorCode: "MARKET_CHECKOUT_RECONCILIATION_AMOUNT_MISMATCH",
        amount: 1979,
        currency: "MYR",
      }),
    ]);
  }, 60000);
});

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmacHex(secret: string, value: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacBase64(secret: string, value: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(value),
  );
  let binary = "";
  for (const byte of new Uint8Array(signature)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
