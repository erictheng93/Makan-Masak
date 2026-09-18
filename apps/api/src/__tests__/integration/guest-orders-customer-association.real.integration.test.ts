/**
 * Real integration — customer attribution on POST /api/v1/guest-orders (#294).
 *
 * The fix (3e38d99f) mounts `optionalCanonicalCustomerAuthMiddleware` on the
 * create route and forwards `customerId: customer?.id` into
 * `OrdersService.createOrder`. The route-level unit tests next to that route
 * cannot substantiate the claim: they assemble their own env and assert on what
 * `createOrder` was *called* with. This repo has twice shipped a tenancy hole
 * that hand-written auth mocks swallowed silently (#265, #275), so a mock-level
 * assertion is not evidence about a middleware chain.
 *
 * Everything below therefore runs the real Hono app over a real migrated D1 and
 * reads `orders.customer_id` back out of the database. The response body is
 * never the source of truth for attribution.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sign, verify } from "hono/jwt";
import { customers, eq, orders } from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData } from "../helpers/read-json";

const CREATE_ENDPOINT = "https://test/api/v1/guest-orders";

interface GuestOrderCreated {
  order: { id: string; orderNumber: string; status: string };
  guestToken: string;
  tokenExpiresAt: string;
}

interface OtpChallenge {
  devOtp?: string;
}

interface CustomerSession {
  accessToken: string;
  customer: { id: string };
}

interface Shop {
  restaurantId: string;
  menuItemId: number;
}

describe("Guest orders — customer attribution (real D1)", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  afterAll(async () => {
    await testApp?.dispose();
  });

  // ── Case 1 ────────────────────────────────────────────────────────────────
  it("attributes an order to the customer behind a real canonical customer token", async () => {
    const shop = await seedShop();
    const session = await loginCustomer("+886911000001");

    const res = await postGuestOrder(shop, {
      authorization: `Bearer ${session.accessToken}`,
    });

    expect(res.status).toBe(201);
    const created = await readData<GuestOrderCreated>(res);

    // The database, not the response envelope, is what #294 is about.
    const row = await readOrderRow(created.order.id);
    expect(row).toBeDefined();
    expect(row!.customerId).toBe(session.customer.id);
    expect(row!.restaurantId).toBe(shop.restaurantId);
  });

  // ── Case 2 ────────────────────────────────────────────────────────────────
  it("leaves customer_id NULL with no token, and the guest-token flow still works end to end", async () => {
    const shop = await seedShop();

    const res = await postGuestOrder(shop);
    expect(res.status).toBe(201);
    const created = await readData<GuestOrderCreated>(res);

    const row = await readOrderRow(created.order.id);
    expect(row).toBeDefined();
    expect(row!.customerId).toBeNull();

    // "不要改變任何既有的訪客行為": the minted guest token must still open the
    // order it was minted for.
    expect(created.guestToken).toMatch(/^gt_[0-9a-f]{64}$/);
    expect(Date.parse(created.tokenExpiresAt)).toBeGreaterThan(Date.now());

    const readBack = await testApp.app.fetch(
      new Request(`${CREATE_ENDPOINT}/${created.order.id}`, {
        headers: { authorization: `Bearer ${created.guestToken}` },
      }),
    );
    expect(readBack.status).toBe(200);
    const fetched = await readData<{ order: { id: string } }>(readBack);
    expect(fetched.order.id).toBe(created.order.id);
  });

  it("exchanges a shop guest token only for its own order-scoped realtime room", async () => {
    const shop = await seedShop();
    const created = await readData<GuestOrderCreated>(
      await postGuestOrder(shop),
    );
    const row = await readOrderRow(created.order.id);
    expect(row!.tableId).toBeNull();

    const realtimeRes = await testApp.app.fetch(
      new Request("https://test/api/v1/realtime/auth/guest-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          restaurantId: shop.restaurantId,
          orderId: created.order.id,
          guestToken: created.guestToken,
        }),
      }),
    );
    expect(realtimeRes.status).toBe(200);
    const realtime = await readData<{ token: string }>(realtimeRes);
    const payload = await verify(
      realtime.token,
      testApp.env.JWT_SECRET,
      "HS256",
    );

    expect(payload).toMatchObject({
      roomType: "customer",
      roomId: `order:${created.order.id}`,
      restaurantId: shop.restaurantId,
      orderId: created.order.id,
      scope: "guest-realtime",
    });
    expect(payload.tableId).toBeUndefined();

    const otherShop = await seedShop();
    const otherOrder = await readData<GuestOrderCreated>(
      await postGuestOrder(otherShop),
    );
    const mismatchedRes = await testApp.app.fetch(
      new Request("https://test/api/v1/realtime/auth/guest-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          restaurantId: otherShop.restaurantId,
          orderId: otherOrder.order.id,
          guestToken: created.guestToken,
        }),
      }),
    );
    expect(mismatchedRes.status).toBe(400);
  });

  it("returns the same response shape with and without a customer token", async () => {
    const anonymousShop = await seedShop();
    const anonymous = await readData<GuestOrderCreated>(
      await postGuestOrder(anonymousShop),
    );

    const attributedShop = await seedShop();
    const session = await loginCustomer("+886911000002");
    const attributed = await readData<GuestOrderCreated>(
      await postGuestOrder(attributedShop, {
        authorization: `Bearer ${session.accessToken}`,
      }),
    );

    // The envelope a guest client reads is untouched.
    expect(Object.keys(attributed).sort()).toEqual(
      Object.keys(anonymous).sort(),
    );

    // Inside `order`, attribution is purely additive. `customerId` and the
    // joined `customer` summary appear only when there is a customer, because
    // OrderService maps a null customer id to `undefined` and JSON drops it.
    // Pinning the delta exactly is the point: a guest client that reads any
    // other field keeps reading the same thing, and a future change that
    // widens what a customer token adds to this response has to come here
    // and say so.
    const anonymousKeys = Object.keys(anonymous.order);
    const attributedKeys = Object.keys(attributed.order);
    expect(attributedKeys).toEqual(expect.arrayContaining(anonymousKeys));
    expect(
      attributedKeys.filter((key) => !anonymousKeys.includes(key)).sort(),
    ).toEqual(["customer", "customerId"]);
    expect(attributed.order.status).toBe(anonymous.order.status);

    // Attribution is the only difference the database should show.
    const anonymousRow = await readOrderRow(anonymous.order.id);
    const attributedRow = await readOrderRow(attributed.order.id);
    expect(anonymousRow!.customerId).toBeNull();
    expect(attributedRow!.customerId).toBe(session.customer.id);
    expect(attributedRow!.orderType).toBe(anonymousRow!.orderType);
    expect(attributedRow!.totalAmountCents).toBe(
      anonymousRow!.totalAmountCents,
    );
  });

  // ── Case 3 ────────────────────────────────────────────────────────────────
  //
  // The middleware is *optional*: a token it cannot use must not turn an
  // otherwise valid guest order into a 401. This is the branch most likely to
  // regress, because every rejection in the strict sibling
  // (`canonicalCustomerAuthMiddleware`) throws, and the optional one has to
  // convert each of those into "carry on anonymously" instead.
  describe("an unusable Authorization header never blocks the order", () => {
    const badTokens: Array<
      [string, (ctx: BadTokenContext) => Promise<string>]
    > = [
      ["a malformed, non-JWT string", async () => "not-a-json-web-token"],
      [
        "an expired customer token for a real customer",
        async ({ customerId, secret }) =>
          signCustomerToken(secret, customerId, {
            iat: nowSeconds() - 7200,
            exp: nowSeconds() - 3600,
          }),
      ],
      [
        "a customer token signed with the wrong secret",
        async ({ customerId }) =>
          signCustomerToken(
            "a-different-secret-of-at-least-32-chars",
            customerId,
          ),
      ],
      [
        "a well-formed customer token for a customer that does not exist",
        async ({ secret }) =>
          signCustomerToken(secret, "01900000-0000-7000-8000-000000009999"),
      ],
      [
        "a customer token for a soft-deleted / inactive customer",
        async ({ inactiveCustomerId, secret }) =>
          signCustomerToken(secret, inactiveCustomerId),
      ],
      [
        "a binding token, which the strict middleware rejects outright",
        async ({ customerId, secret }) =>
          sign(
            {
              sub: customerId,
              type: "customer_bind",
              iat: nowSeconds(),
              exp: nowSeconds() + 600,
            },
            secret,
          ),
      ],
      [
        "a staff bearer token, which is not a customer token at all",
        async ({ ownerToken }) => ownerToken,
      ],
    ];

    it.each(badTokens)(
      "still creates an unattributed order for %s",
      async (_label, buildToken) => {
        const shop = await seedShop();
        const ctx = await buildBadTokenContext(shop.restaurantId);
        const token = await buildToken(ctx);

        const res = await postGuestOrder(shop, {
          authorization: `Bearer ${token}`,
        });

        expect(res.status).toBe(201);
        const created = await readData<GuestOrderCreated>(res);
        const row = await readOrderRow(created.order.id);
        expect(row!.customerId).toBeNull();
      },
    );
  });

  // ── Case 4 ────────────────────────────────────────────────────────────────
  //
  // Designed behaviour: ATTRIBUTE, do not reject.
  //
  // There is no such thing as "another restaurant's customer" to reject.
  // `customers` (packages/database/src/schema/customers.ts) is a platform-wide
  // identity table — it carries no restaurant_id, and `loadTokenCustomer`
  // (middleware/auth.ts) selects on `id` + `status = 'active'` with no tenant
  // predicate. One person holds one customer identity across every stall in
  // the night market, which is the whole point: the address book and the
  // member-facing order history in #294 hang off that single id.
  //
  // Tenant scoping is enforced one layer up, in the `restaurant_customers`
  // projection (migration 0016), which is keyed on (restaurant_id, customer_id)
  // — so restaurant B learns nothing about what this customer did at A even
  // though both orders carry the same customers.id. Rejecting the token here
  // would instead break the ordinary case of a returning customer visiting a
  // new stall.
  it("attributes a customer's order at a restaurant they have never ordered at before", async () => {
    const shopA = await seedShop();
    const shopB = await seedShop();
    const session = await loginCustomer("+886911000003");

    const atA = await readData<GuestOrderCreated>(
      await postGuestOrder(shopA, {
        authorization: `Bearer ${session.accessToken}`,
      }),
    );
    const atB = await readData<GuestOrderCreated>(
      await postGuestOrder(shopB, {
        authorization: `Bearer ${session.accessToken}`,
      }),
    );

    const rowA = await readOrderRow(atA.order.id);
    const rowB = await readOrderRow(atB.order.id);

    expect(rowA!.customerId).toBe(session.customer.id);
    expect(rowB!.customerId).toBe(session.customer.id);
    expect(rowA!.restaurantId).toBe(shopA.restaurantId);
    expect(rowB!.restaurantId).toBe(shopB.restaurantId);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function seedShop(): Promise<Shop> {
    // `enableShopMode` is the owner's switch for the shop-QR channel and
    // `settings.allowGuestOrders` (set by the seed helper) is the guest-order
    // switch; both are required before this route will write anything.
    const restaurant = await seed.restaurant({ enableShopMode: true });
    const item = await seed.menuItem(restaurant.id);
    return { restaurantId: String(restaurant.id), menuItemId: item.id };
  }

  function postGuestOrder(shop: Shop, headers: Record<string, string> = {}) {
    return testApp.app.fetch(
      new Request(CREATE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          restaurantId: shop.restaurantId,
          guestName: "Guest",
          orderType: "shop",
          items: [{ menuItemId: shop.menuItemId, quantity: 1 }],
          deliveryInfo: { type: "takeaway" },
        }),
      }),
    );
  }

  async function readOrderRow(orderId: string) {
    const [row] = await testApp.testDb.drizzle
      .select({
        id: orders.id,
        customerId: orders.customerId,
        restaurantId: orders.restaurantId,
        tableId: orders.tableId,
        orderType: orders.orderType,
        totalAmountCents: orders.totalAmountCents,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    return row;
  }

  /**
   * A customer identity minted the way the product mints it: request an OTP,
   * verify it, keep the access token the API hands back. Hand-signing the token
   * would test the middleware against a token no endpoint actually issues.
   */
  async function loginCustomer(phone: string): Promise<CustomerSession> {
    const otpRes = await testApp.app.fetch(
      new Request("https://test/api/v1/customer/auth/request-otp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Spread the per-IP OTP counter, which lives in KV and — unlike the
          // D1 tables — is not cleared between tests in this file.
          "CF-Connecting-IP": `203.0.113.${phone.slice(-2)}`,
        },
        body: JSON.stringify({ phone }),
      }),
    );
    const challenge = await readData<OtpChallenge>(otpRes);

    const verifyRes = await testApp.app.fetch(
      new Request("https://test/api/v1/customer/auth/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, otp: challenge.devOtp }),
      }),
    );
    return readData<CustomerSession>(verifyRes);
  }

  interface BadTokenContext {
    secret: string;
    customerId: string;
    inactiveCustomerId: string;
    ownerToken: string;
  }

  /**
   * Everything a negative case might need to point its token at something real.
   * The subjects are inserted directly rather than logged in: the point of
   * these cases is that the *token* is unusable, so the customer behind it must
   * genuinely exist and be active, otherwise a passing test proves nothing.
   */
  async function buildBadTokenContext(
    restaurantId: string,
  ): Promise<BadTokenContext> {
    const suffix = String(Date.now()).slice(-7);
    const [active] = await testApp.testDb.drizzle
      .insert(customers)
      .values({
        displayName: "Active Customer",
        primaryPhone: `+8869${suffix}1`,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: customers.id });
    const [inactive] = await testApp.testDb.drizzle
      .insert(customers)
      .values({
        displayName: "Inactive Customer",
        primaryPhone: `+8869${suffix}2`,
        status: "disabled",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: customers.id });

    const owner = await seed.user({
      username: `guest-order-owner-${suffix}`,
      role: 1,
      restaurantId,
    });

    return {
      secret: testApp.env.JWT_SECRET,
      customerId: active!.id,
      inactiveCustomerId: inactive!.id,
      ownerToken: await testApp.authHelper.ownerToken(owner.id, restaurantId),
    };
  }
});

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** The claim shape CustomerSessionService issues for an access token. */
function signCustomerToken(
  secret: string,
  customerId: string,
  times: { iat?: number; exp?: number } = {},
): Promise<string> {
  const now = nowSeconds();
  return sign(
    {
      sub: customerId,
      type: "customer",
      iat: times.iat ?? now,
      exp: times.exp ?? now + 900,
    },
    secret,
  );
}
