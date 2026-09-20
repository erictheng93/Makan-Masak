/**
 * A Malaysian shop's own e-wallet, end to end on real D1.
 *
 * Mirrors `market-checkout-provider-money.real.integration.test.ts`: the
 * wallet is faked at the HTTP boundary (`globalThis.fetch` intercepted for the
 * configured adapter URL only) and the webhook is signed the way the route
 * verifies it. What is real here is everything between — the owner-scoped CRUD
 * that stores the credential encrypted, the adapter that converts and checks
 * the money, and the market-checkout settlement it plugs into.
 *
 * The run: two stalls of one operator connect the same Touch 'n Go merchant
 * account (a market checkout is multi-vendor by schema) -> customer pays with
 * `shop_wallet:tng` -> the wallet is asked for the exact total in sen, with no
 * secret on the wire -> an underpaid webhook is held -> the correct webhook
 * marks it paid -> an admin refund goes back through the operator's wallet.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  marketCheckoutPayments,
  markets,
  restaurantMarketMemberships,
  shopPaymentCredentials,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";
import { readData } from "../helpers/read-json";
import type { PublicMarketCheckoutSession } from "../../features/market-checkouts/routes";

const WALLET = "https://fake-wallet.test";
const WEBHOOK_SECRET = "fake-shop-wallet-webhook-secret";

/** The secret bytes that must not appear on the wire or in any response. */
const MERCHANT_KEY = "tng-merchant-key-SHOULD-NEVER-LEAK";

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

interface WalletState {
  requests: Array<{ url: string; body: Record<string, unknown> }>;
  answer?: (body: Record<string, unknown>) => Record<string, unknown>;
}

describe("shop wallet market checkout - real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: SeedHelpers;
  let wallet: WalletState;
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
      SHOP_WALLET_GATEWAY_URL: `${WALLET}/operations`,
      SHOP_WALLET_GATEWAY_TOKEN: "wallet-adapter-token",
      MARKET_CHECKOUT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    wallet = { requests: [] };
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.startsWith(WALLET)) return originalFetch(input, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      wallet.requests.push({ url, body });
      return Response.json(wallet.answer?.(body) ?? defaultWalletAnswer(body));
    }) as typeof fetch;
  });

  /**
   * A wallet that redirects the customer for a charge and settles a refund
   * immediately — the shape both providers' hosted flows take.
   */
  function defaultWalletAnswer(body: Record<string, unknown>) {
    const reference = String(body.reference);
    if (body.operation === "refund") {
      return {
        providerTransactionId: String(body.providerTransactionId),
        status: "refunded",
        refundId: `tng_re_${reference}`,
        providerAmount: body.providerAmount,
        currency: body.currency,
      };
    }
    return {
      providerTransactionId: `tng_txn_${reference}`,
      status: "requires_action",
      nextAction: {
        type: "redirect",
        redirectUrl: `https://fake-wallet.test/confirm/${reference}`,
      },
    };
  }

  /**
   * A market with two stalls, both owned by one operator. `createMarketCheckoutSchema`
   * requires at least two vendors, and a wallet charge settles into one
   * merchant account, so the two are connected to the same one.
   */
  async function seedShop(currency: "MYR" | "TWD" = "MYR") {
    const now = new Date();
    const [market] = await testApp.testDb.drizzle
      .insert(markets)
      .values({
        id: `market-${crypto.randomUUID()}`,
        slug: `wallet-${crypto.randomUUID()}`,
        name: "Jalan Alor",
        type: "night_market",
        description: "shop wallet fixture",
        city: "Kuala Lumpur",
        district: "Bukit Bintang",
        address: "1 Jalan Alor",
        latitude: 3.14,
        longitude: 101.7,
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
        name: "Char Kuey Teow",
        price: 12.5,
        priceCents: 1250,
      }),
      seed.menuItem(vendorB.id, {
        name: "Teh Tarik",
        price: 3.5,
        priceCents: 350,
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
        stallNumber: "A02",
        joinedAt: now,
      },
    ]);

    const [ownerA, ownerB] = await Promise.all([
      seed.user({ role: 1, restaurantId: String(vendorA.id) }),
      seed.user({ role: 1, restaurantId: String(vendorB.id) }),
    ]);

    return {
      marketSlug: market.slug,
      restaurantId: String(vendorA.id),
      secondRestaurantId: String(vendorB.id),
      menuItemId: itemA.id,
      secondMenuItemId: itemB.id,
      totalCents: 1250 + 350,
      ownerToken: await testApp.authHelper.ownerToken(
        ownerA.id,
        String(vendorA.id),
      ),
      secondOwnerToken: await testApp.authHelper.ownerToken(
        ownerB.id,
        String(vendorB.id),
      ),
    };
  }

  function ownerRequest(
    token: string,
    path: string,
    init: RequestInit & { body?: string } = {},
  ) {
    return testApp.app.fetch(
      new Request(`https://test/api/v1/shop-payments${path}`, {
        ...init,
        headers: {
          ...CSRF_HEADERS,
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      }),
    );
  }

  function connectOne(
    token: string,
    restaurantId: string,
    merchantId = "TNG-MERCHANT-7788",
  ) {
    return ownerRequest(token, `/${restaurantId}/tng/connect`, {
      method: "POST",
      body: JSON.stringify({
        merchantId,
        displayName: "Jalan Alor stall",
        environment: "sandbox",
        secret: { merchantKey: MERCHANT_KEY, webhookSecret: "hook-secret" },
      }),
    });
  }

  /** Both stalls onto the operator's single merchant account. */
  async function connectWallet(shop: Awaited<ReturnType<typeof seedShop>>) {
    const first = await connectOne(shop.ownerToken, shop.restaurantId);
    if (first.status !== 201) return first;
    return connectOne(shop.secondOwnerToken, shop.secondRestaurantId);
  }

  async function createCheckout(shop: Awaited<ReturnType<typeof seedShop>>) {
    const response = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: CUSTOMER_HEADERS,
        body: JSON.stringify({
          marketSlug: shop.marketSlug,
          guestName: "Wallet Guest",
          phoneLastDigits: "123",
          vendors: [
            {
              restaurantId: shop.restaurantId,
              items: [{ menuItemId: shop.menuItemId, quantity: 1 }],
            },
            {
              restaurantId: shop.secondRestaurantId,
              items: [{ menuItemId: shop.secondMenuItemId, quantity: 1 }],
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
    };
  }

  function pay(checkout: { checkoutId: string; guestToken: string }) {
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
            method: "shop_wallet:tng",
            country: "MY",
            currency: "MYR",
          }),
        },
      ),
    );
  }

  /** The generic `market_checkout.payment_*` event, signed as the route wants. */
  async function walletWebhook(event: Record<string, unknown>) {
    const raw = JSON.stringify(event);
    const response = await testApp.app.fetch(
      new Request(
        "https://test/api/v1/market-checkouts/payment-webhooks/shop_wallet",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-signature": await hmacHex(WEBHOOK_SECRET, raw),
          },
          body: raw,
        },
      ),
    );
    expect(response.status).toBe(200);
    return readData<Record<string, unknown>>(response);
  }

  function paidEvent(
    checkout: { checkoutId: string; paymentId: string },
    eventId: string,
    amountCents: number,
    currency = "MYR",
  ) {
    return {
      id: eventId,
      type: "market_checkout.payment_paid",
      amount_cents: amountCents,
      currency,
      metadata: {
        marketCheckoutId: checkout.checkoutId,
        marketCheckoutPaymentId: checkout.paymentId,
        providerTransactionId: `tng_txn_${checkout.checkoutId}`,
      },
    };
  }

  function paymentRow(checkoutId: string) {
    return testApp.testDb.drizzle
      .select()
      .from(marketCheckoutPayments)
      .where(eq(marketCheckoutPayments.checkoutId, checkoutId))
      .get();
  }

  /**
   * A refused charge is not an HTTP error: the pay route catches a provider
   * failure, records a failed payment against the checkout and answers 202, so
   * the customer can try another method. The refusal shows up in the payload.
   */
  async function expectPaymentRefused(
    response: Response,
    match: RegExp,
  ): Promise<void> {
    expect(response.status).toBe(202);
    const json = await readData<{
      payment: {
        status: string;
        childPayments: Array<{ errorMessage?: string }>;
      };
    }>(response);
    expect(json.payment.status).toBe("failed");
    expect(
      json.payment.childPayments.map((p) => p.errorMessage ?? "").join(" "),
    ).toMatch(match);
  }

  it("connects a wallet, stores the secret encrypted and never returns it", async () => {
    const shop = await seedShop();
    const response = await connectWallet(shop);
    expect(response.status).toBe(201);

    const body = await response.text();
    expect(body).not.toContain(MERCHANT_KEY);
    expect(body).not.toContain("hook-secret");
    expect(body).not.toContain("TNG-MERCHANT-7788");
    expect(JSON.parse(body).data).toMatchObject({
      provider: "tng",
      status: "connected",
      merchantIdMasked: "••••7788",
      secretConfigured: true,
    });

    const row = await testApp.testDb.drizzle
      .select()
      .from(shopPaymentCredentials)
      .where(eq(shopPaymentCredentials.restaurantId, shop.restaurantId))
      .get();
    expect(row?.secretPayloadEncrypted).not.toContain(MERCHANT_KEY);
    expect(row?.merchantId).toBe("TNG-MERCHANT-7788");
  }, 60000);

  it("refuses one owner reaching another shop's credentials", async () => {
    const [shopA, shopB] = [await seedShop(), await seedShop()];
    await connectWallet(shopB);

    const response = await ownerRequest(
      shopA.ownerToken,
      `/${shopB.restaurantId}/tng`,
    );
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(JSON.parse(body).error.code).toBe(
      "SHOP_PAYMENT_CREDENTIAL_FORBIDDEN",
    );
    expect(body).not.toContain("••••7788");
  }, 60000);

  it("refuses a TWD shop connecting a wallet that settles MYR only", async () => {
    const shop = await seedShop("TWD");
    const response = await connectOne(shop.ownerToken, shop.restaurantId);

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; details?: unknown };
    };
    expect(body.error.code).toBe("SHOP_PAYMENT_PROVIDER_CURRENCY_UNSUPPORTED");
  }, 60000);

  it("pay -> held underpayment -> paid -> refund, all through the shop's wallet", async () => {
    const shop = await seedShop();
    expect((await connectWallet(shop)).status).toBe(201);
    const checkout = await createCheckout(shop);

    // 1. Pay. The wallet is asked for RM16.00 = 1600 sen, and gets no secret.
    const payResponse = await pay(checkout);
    expect(payResponse.status).toBe(202);
    const payJson = await readData<{
      payment: { status: string; parentPayment: { nextAction?: unknown } };
    }>(payResponse);
    expect(payJson.payment.status).toBe("pending");
    expect(payJson.payment.parentPayment.nextAction).toMatchObject({
      type: "redirect",
    });

    const chargeRequest = wallet.requests.at(0);
    expect(chargeRequest?.body).toMatchObject({
      operation: "charge",
      provider: "tng",
      environment: "sandbox",
      merchantId: "TNG-MERCHANT-7788",
      currency: "MYR",
      amountCents: 1600,
      providerAmount: 1600,
      amountMinor: 1600,
      currencyExponent: 2,
    });
    // The whole serialized request, not just the fields named above.
    expect(JSON.stringify(chargeRequest?.body)).not.toContain(MERCHANT_KEY);
    expect(chargeRequest?.body).not.toHaveProperty("credentials");

    // 2. An underpaid callback is held rather than believed.
    const underpaid = await walletWebhook(
      paidEvent(checkout, "evt_under", 1599),
    );
    expect(underpaid).toMatchObject({
      reconciled: false,
      reviewRequired: true,
      reviewReason: "AMOUNT_MISMATCH",
    });
    expect(await paymentRow(checkout.checkoutId)).toMatchObject({
      status: "pending",
      paidAmountCents: 0,
    });

    // 3. The right amount in the wrong currency is held too.
    const wrongCurrency = await walletWebhook(
      paidEvent(checkout, "evt_sgd", 1600, "SGD"),
    );
    expect(wrongCurrency).toMatchObject({ reviewRequired: true });

    // 4. The real confirmation.
    const paid = await walletWebhook(paidEvent(checkout, "evt_paid", 1600));
    expect(paid).toMatchObject({ reconciled: true, status: "paid" });
    const paidRow = await paymentRow(checkout.checkoutId);
    expect(paidRow).toMatchObject({
      status: "paid",
      paidAmountCents: 1600,
      amountCents: 1600,
      currency: "MYR",
      provider: "shop_wallet:tng",
    });

    // 5. Refund goes back through the shop's own wallet, not the platform's
    //    adapter — the refund request carries the same merchant account.
    const adminToken = await testApp.authHelper.adminToken(shop.restaurantId);
    const refundResponse = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/market-checkouts/${checkout.checkoutId}/refund`,
        {
          method: "POST",
          headers: {
            ...CSRF_HEADERS,
            "content-type": "application/json",
            authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ reason: "customer cancelled" }),
        },
      ),
    );
    expect(refundResponse.status).toBe(200);

    const refundRequest = wallet.requests.find(
      (r) => r.body.operation === "refund",
    );
    expect(refundRequest?.body).toMatchObject({
      operation: "refund",
      merchantId: "TNG-MERCHANT-7788",
      providerAmount: 1600,
      amountMinor: 1600,
      currency: "MYR",
      reason: "customer cancelled",
    });
    expect(JSON.stringify(refundRequest?.body)).not.toContain(MERCHANT_KEY);

    expect(await paymentRow(checkout.checkoutId)).toMatchObject({
      status: "refunded",
      refundedAmountCents: 1600,
    });
  }, 120000);

  it("refuses to charge when one stall has disconnected its wallet", async () => {
    const shop = await seedShop();
    expect((await connectWallet(shop)).status).toBe(201);
    const disconnect = await ownerRequest(
      shop.secondOwnerToken,
      `/${shop.secondRestaurantId}/tng`,
      { method: "DELETE" },
    );
    expect(disconnect.status).toBe(200);

    const checkout = await createCheckout(shop);
    await expectPaymentRefused(
      await pay(checkout),
      /has not connected that payment provider/,
    );
    expect(wallet.requests).toHaveLength(0);
  }, 60000);

  it("refuses a cart whose stalls settle into different merchant accounts", async () => {
    const shop = await seedShop();
    expect((await connectOne(shop.ownerToken, shop.restaurantId)).status).toBe(
      201,
    );
    expect(
      (
        await connectOne(
          shop.secondOwnerToken,
          shop.secondRestaurantId,
          "TNG-MERCHANT-9999",
        )
      ).status,
    ).toBe(201);

    const checkout = await createCheckout(shop);
    await expectPaymentRefused(await pay(checkout), /same merchant account/);
    expect(wallet.requests).toHaveLength(0);
  }, 60000);

  it("rejects a wallet that authorizes a different amount", async () => {
    const shop = await seedShop();
    expect((await connectWallet(shop)).status).toBe(201);
    wallet.answer = (body) => ({
      providerTransactionId: `tng_txn_${String(body.reference)}`,
      status: "paid",
      // One sen short — the adapter converts back and compares.
      providerAmount: 1599,
      currency: "MYR",
    });

    const checkout = await createCheckout(shop);
    await expectPaymentRefused(
      await pay(checkout),
      /does not match what was requested/,
    );
    expect(await paymentRow(checkout.checkoutId)).not.toMatchObject({
      status: "paid",
    });
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
