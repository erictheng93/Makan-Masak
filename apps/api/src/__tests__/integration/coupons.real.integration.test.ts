/**
 * Real integration — Coupons API
 *
 * Pilot migration (full port). Started life in commit 1 as a 2-test
 * smoke that proved the new `seed.coupon()` helper inserts a valid
 * row through real Drizzle + miniflare D1. This file now covers the
 * same surface area as the legacy coupon integration coverage.
 *
 * Infrastructure notes (learned during port):
 *   - POST /coupons requires CSRF (double-submit cookie pattern).
 *     Helper `csrfHeaders` below matches the contract in
 *     `apps/api/src/middleware/csrf.ts` (64-hex token in both the
 *     X-CSRF-Token header and the csrf_token cookie, with host and
 *     origin that agree).
 *   - POST /coupons/validate is CSRF-EXCLUDED in app-factory.ts:466
 *     (public endpoint).
 *   - createCouponSchema requires validFrom/validTo as
 *     `z.iso.datetime()` — full ISO 8601, not YYYY-MM-DD.
 *     The DB column is TEXT and the service layer stores whatever
 *     the API receives; seed.coupon() writes YYYY-MM-DD directly to
 *     the DB, which is why API-created and seed-created rows differ
 *     in their stored format. Both round-trip through the validate
 *     endpoint because the service compares as strings.
 *   - authHelper.adminToken() defaults userId=1, so the admin user
 *     must be seeded with id: 1 to keep downstream user lookups
 *     happy. See `apps/api/src/__tests__/integration/helpers/issue-test-jwt.ts`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { vi } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readEnvelope, type ServiceData } from "../helpers/read-json";
import type {
  CouponsService,
  FormattedCouponRow,
} from "../../features/coupons/services/CouponsService";
import {
  CouponService as DatabaseCouponService,
  couponDistributions,
  couponUsage,
  coupons,
  customers,
  userCoupons,
} from "@makanmasak/database";
import { and, eq } from "drizzle-orm";

/**
 * A single coupon as the API returns it, derived from the service rather than
 * restated. `createCouponWithValidation` has a concrete return type now, so a
 * schema change reaches this file as a compile error.
 *
 * The interface this replaced declared `id: string`, while `coupons.id` is
 * `integer` autoincrement — nothing caught that, because every signature behind
 * it was `unknown`. `NonNullable` is needed because the base `createCoupon`
 * returns `coupon[0]` unmapped when the insert yields no row, which is also why
 * the assertions below reach through `?.`.
 *
 * Used for the create and deactivate responses; both hand back the same coupon
 * row shape.
 */
type CouponResponse = NonNullable<
  ServiceData<CouponsService["createCouponWithValidation"]>
>;

/**
 * What the list endpoints return: the row `getCoupons` selects plus the three
 * amounts the API-side formatter derives. A different shape from the create
 * response, so it gets its own name rather than borrowing that one.
 */
type ListedCoupon = FormattedCouponRow;

type CouponValidation = ServiceData<
  CouponsService["validateCouponWithBusinessRules"]
>;
type CouponTrends = ServiceData<CouponsService["getCouponUsageTrends"]>;
/**
 * Build the header + cookie pair the CSRF middleware expects for a
 * mutating request. 64-hex matches the length check in
 * apps/api/src/middleware/csrf.ts; host and origin must agree for
 * the same-origin check to pass.
 */
function csrfHeaders(bearer: string) {
  const csrfToken = "a".repeat(64);
  return {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    host: "test",
    origin: "https://test",
    "x-csrf-token": csrfToken,
    cookie: `csrf_token=${csrfToken}`,
  };
}

/**
 * YYYY-MM-DDTHH:mm:ss.sssZ matching zod's datetime() format, relative
 * to now. Centralised so all tests use the same clock and overrides
 * cannot accidentally drift.
 */
function offsetDate(daysOffset: number): Date {
  return new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
}

/** Wire shape: the API still takes ISO-8601 strings. */
function offsetIso(daysOffset: number): string {
  return offsetDate(daysOffset).toISOString();
}

describe("Coupons API — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;
  let restaurantId: string;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    // Guarded so a beforeAll timeout does not cascade into a
    // second failure that obscures the original cause.
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
    const restaurant = await seed.restaurant();
    restaurantId = String(restaurant.id);
    // The diner endpoints (validate, available) are gated on `coupons`.
    await insertActiveSubscription(restaurantId);

    // Seed the admin user row with id=1 so downstream user lookups
    // (e.g., createdBy, audit logs) do not trip on a missing FK.
    await seed.user({
      id: 1,
      username: "admin-coupons",
      role: 0,
      restaurantId,
    });
    adminToken = await testApp.authHelper.adminToken(restaurantId);
  });

  async function insertActiveSubscription(targetRestaurantId: string) {
    await testApp.env.DB.prepare(
      `INSERT INTO shop_subscriptions
        (id, restaurant_id, plan_tier, module_overrides,
         is_active, trial_ends_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'trial', '{}', 1, ?, ?, ?)`,
    )
      .bind(
        `sub-${targetRestaurantId}`,
        targetRestaurantId,
        Date.now() + 24 * 60 * 60 * 1000,
        Date.now(),
        Date.now(),
      )
      .run();
  }

  // ── POST /coupons (create) ────────────────────────────────────────────────

  it("POST /coupons creates a percentage coupon and returns 201", async () => {
    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons", {
        method: "POST",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({
          code: "WELCOME15",
          name: "Welcome 15% Off",
          description: "New customer welcome discount",
          discountType: "percentage",
          discountValue: 15,
          minOrderAmount: 50,
          maxDiscountAmount: 200,
          validFrom: offsetIso(0),
          validTo: offsetIso(30),
          restaurantId,
        }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await readEnvelope<CouponResponse>(res);
    expect(body.success).toBe(true);
    expect(body.data?.code).toBe("WELCOME15");
    expect(body.data?.discountType).toBe("percentage");
    expect(body.data?.discountValue).toBe(15);
  });

  it("POST /coupons creates a fixed-amount coupon and returns 201", async () => {
    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons", {
        method: "POST",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({
          code: "FLAT50",
          name: "Flat $50 Off",
          discountType: "fixed",
          discountValue: 50,
          minOrderAmount: 200,
          validFrom: offsetIso(0),
          validTo: offsetIso(60),
          restaurantId,
        }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await readEnvelope<CouponResponse>(res);
    expect(body.success).toBe(true);
    expect(body.data?.code).toBe("FLAT50");
    expect(body.data?.discountType).toBe("fixed");
    expect(body.data?.discountValue).toBe(50);
  });

  it("POST /coupons returns COUPON_CODE_EXISTS for a duplicate preflight", async () => {
    await seed.coupon(restaurantId, { code: "DUPLICATE-CODE" });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons", {
        method: "POST",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({
          code: "DUPLICATE-CODE",
          name: "Duplicate",
          discountType: "fixed",
          discountValue: 10,
          validFrom: offsetIso(0),
          validTo: offsetIso(30),
          restaurantId,
        }),
      }),
    );

    expect(res.status).toBe(409);
    const body = await readEnvelope(res);
    expect(body.error?.code).toBe("COUPON_CODE_EXISTS");
  });

  it("lets two restaurants each own the same coupon code", async () => {
    // The old coupons_code_unique was on `code` alone, so whichever shop
    // claimed WELCOME10 first locked the whole platform out of it (#269).
    const shopA = await seed.restaurant({ name: "Shared Code A" });
    const shopB = await seed.restaurant({ name: "Shared Code B" });

    const a = await seed.coupon(String(shopA.id), { code: "SHARED-CODE" });
    const b = await seed.coupon(String(shopB.id), { code: "SHARED-CODE" });

    expect(a.id).not.toBe(b.id);

    const rows = await testApp.testDb.drizzle
      .select({ id: coupons.id, restaurantId: coupons.restaurantId })
      .from(coupons)
      .where(eq(coupons.code, "SHARED-CODE"));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.restaurantId))).toEqual(
      new Set([String(shopA.id), String(shopB.id)]),
    );
  });

  it("frees a soft-deleted coupon's code for reuse in the same restaurant", async () => {
    // deleteCoupon only sets deleted_at_ms, so without the predicate on the
    // unique index a deleted coupon would hold its code forever.
    const created = await seed.coupon(restaurantId, { code: "REUSE-ME" });

    const deleted = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${created.id}`, {
        method: "DELETE",
        headers: csrfHeaders(adminToken),
      }),
    );
    expect(deleted.status).toBe(200);

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons", {
        method: "POST",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({
          code: "REUSE-ME",
          name: "Reused",
          discountType: "fixed",
          discountValue: 10,
          validFrom: offsetIso(0),
          validTo: offsetIso(30),
          restaurantId,
        }),
      }),
    );

    expect(res.status).toBe(201);
  });

  it("resolves a shared code to the restaurant's own coupon, not the platform one", async () => {
    // A bare `code` lookup is ambiguous now. The restaurant's own coupon has
    // to win, or its customers would be priced off a platform coupon that
    // merely shares the code.
    await testApp.testDb.drizzle.insert(coupons).values({
      restaurantId: null,
      code: "OVERLAP",
      name: "Platform overlap",
      discountType: "fixed",
      discountValueCents: 100,
      minOrderAmountCents: 0,
      validFrom: offsetDate(-1),
      validTo: offsetDate(30),
      isActive: true,
      isVisible: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Inserted directly rather than through seed.coupon(): the seeder passes a
    // legacy `discountValue` key that the schema no longer has, so the amount
    // would land as NULL and the assertion below could not tell the two apart.
    await testApp.testDb.drizzle.insert(coupons).values({
      restaurantId,
      code: "OVERLAP",
      name: "Shop overlap",
      discountType: "fixed",
      discountValueCents: 700,
      minOrderAmountCents: 0,
      validFrom: offsetDate(-1),
      validTo: offsetDate(30),
      isActive: true,
      isVisible: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "OVERLAP",
          restaurantId,
          orderAmount: 500,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await readEnvelope<CouponValidation>(res);
    expect(body.data?.valid).toBe(true);
    // 7 from the shop's own coupon, not 1 from the platform one.
    expect(body.data?.discountAmount).toBe(7);
  });

  // ── POST /coupons/:id/distribute ─────────────────────────────────────────

  async function seedCustomerWithOrders(
    restaurant: string,
    orderCount: number,
  ): Promise<string> {
    const [customer] = await testApp.testDb.drizzle
      .insert(customers)
      .values({
        displayName: `Diner ${Math.random().toString(36).slice(2, 8)}`,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: customers.id });
    for (let i = 0; i < orderCount; i += 1) {
      await seed.order(restaurant, { customerId: customer!.id });
    }
    return customer!.id;
  }

  it("issues one holdable instance per customer who has ordered here", async () => {
    // coupon_distributions and user_coupons existed with no route and no UI, so
    // the documented "建立 · 發放" flow only ever did the first half (#269 §5).
    const regular = await seedCustomerWithOrders(restaurantId, 3);
    const firstTimer = await seedCustomerWithOrders(restaurantId, 1);
    const coupon = await seed.coupon(restaurantId, { code: "GIVEAWAY" });

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${coupon.id}/distribute`, {
        method: "POST",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({ distributionType: "manual", targetType: "all" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await readEnvelope<{
      issued: number;
      skipped: number;
      targeted: number;
    }>(res);
    expect(body.data?.issued).toBe(2);
    expect(body.data?.skipped).toBe(0);

    const held = await testApp.testDb.drizzle
      .select({ ownerCustomerId: userCoupons.ownerCustomerId })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, coupon.id));
    expect(new Set(held.map((row) => row.ownerCustomerId))).toEqual(
      new Set([regular, firstTimer]),
    );

    const batches = await testApp.testDb.drizzle
      .select({ total: couponDistributions.totalDistributed })
      .from(couponDistributions)
      .where(eq(couponDistributions.couponId, coupon.id));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.total).toBe(2);
  });

  it("skips customers already holding the coupon when a batch is re-run", async () => {
    await seedCustomerWithOrders(restaurantId, 2);
    const coupon = await seed.coupon(restaurantId, { code: "RERUN" });

    const distribute = () =>
      testApp.app.fetch(
        new Request(`https://test/api/v1/coupons/${coupon.id}/distribute`, {
          method: "POST",
          headers: csrfHeaders(adminToken),
          body: JSON.stringify({
            distributionType: "manual",
            targetType: "all",
          }),
        }),
      );

    const first = await readEnvelope<{ issued: number }>(await distribute());
    expect(first.data?.issued).toBe(1);

    const second = await readEnvelope<{ issued: number; skipped: number }>(
      await distribute(),
    );
    expect(second.data?.issued).toBe(0);
    expect(second.data?.skipped).toBe(1);

    const held = await testApp.testDb.drizzle
      .select({ id: userCoupons.id })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, coupon.id));
    expect(held).toHaveLength(1);
  });

  it("targets new customers and regulars by their order count here", async () => {
    const regular = await seedCustomerWithOrders(restaurantId, 5);
    const firstTimer = await seedCustomerWithOrders(restaurantId, 1);
    const newOnly = await seed.coupon(restaurantId, { code: "NEW-ONLY" });
    const vipOnly = await seed.coupon(restaurantId, { code: "VIP-ONLY" });

    const post = (id: number, payload: Record<string, unknown>) =>
      testApp.app.fetch(
        new Request(`https://test/api/v1/coupons/${id}/distribute`, {
          method: "POST",
          headers: csrfHeaders(adminToken),
          body: JSON.stringify(payload),
        }),
      );

    await post(newOnly.id, {
      distributionType: "manual",
      targetType: "new_user",
    });
    await post(vipOnly.id, {
      distributionType: "manual",
      targetType: "vip",
      targetCriteria: { minOrders: 3 },
    });

    const newHolders = await testApp.testDb.drizzle
      .select({ owner: userCoupons.ownerCustomerId })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, newOnly.id));
    expect(newHolders.map((row) => row.owner)).toEqual([firstTimer]);

    const vipHolders = await testApp.testDb.drizzle
      .select({ owner: userCoupons.ownerCustomerId })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, vipOnly.id));
    expect(vipHolders.map((row) => row.owner)).toEqual([regular]);
  });

  it("refuses a target the schema has no audience for instead of issuing to nobody", async () => {
    const coupon = await seed.coupon(restaurantId, { code: "NO-GROUPS" });

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${coupon.id}/distribute`, {
        method: "POST",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({
          distributionType: "manual",
          targetType: "group",
        }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await readEnvelope(res);
    expect(body.error?.code).toBe("COUPON_DISTRIBUTION_TARGET_UNSUPPORTED");

    const held = await testApp.testDb.drizzle
      .select({ id: userCoupons.id })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, coupon.id));
    expect(held).toHaveLength(0);
  });

  // ── POST /coupons/:id/distribute — audience tenancy ──────────────────────

  /**
   * `targetType: "user"` is the one branch whose audience is named by the
   * caller rather than derived from orders, and it used to be handed back
   * unfiltered. The route proves only that the *coupon* belongs to the caller's
   * restaurant, so an owner could issue their own coupon to any customer id
   * they could name — the #265/#275 shape.
   *
   * These have to run against real D1. The route-level unit tests mock the auth
   * middleware and the service both, so they cannot see a middleware that never
   * ran; a mocked drizzle cannot tell a scoped query from an unscoped one.
   */
  async function seedShopWithOwner(name: string, username: string) {
    const restaurant = await seed.restaurant({ name });
    await insertActiveSubscription(String(restaurant.id));
    const owner = await seed.user({
      username,
      role: 1,
      restaurantId: String(restaurant.id),
    });
    const token = await testApp.authHelper.ownerToken(
      owner.id,
      String(restaurant.id),
    );
    return { restaurantId: String(restaurant.id), token };
  }

  function distributeAs(
    token: string,
    couponId: number,
    payload: Record<string, unknown>,
  ) {
    return testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${couponId}/distribute`, {
        method: "POST",
        headers: csrfHeaders(token),
        body: JSON.stringify(payload),
      }),
    );
  }

  function customerRow(customerId: string) {
    return testApp.testDb.drizzle
      .select()
      .from(customers)
      .where(eq(customers.id, customerId));
  }

  it("drops named customers who have never ordered at the coupon's restaurant", async () => {
    const shopA = await seedShopWithOwner("Audience A", "audience-owner-a");
    const shopB = await seedShopWithOwner("Audience B", "audience-owner-b");

    const mine = await seedCustomerWithOrders(shopA.restaurantId, 2);
    const theirs = await seedCustomerWithOrders(shopB.restaurantId, 2);
    const victimBefore = await customerRow(theirs);

    const coupon = await seed.coupon(shopA.restaurantId, { code: "POACH" });

    const res = await distributeAs(shopA.token, coupon.id, {
      distributionType: "manual",
      targetType: "user",
      targetCriteria: { customerIds: [mine, theirs] },
    });

    // Dropped silently rather than refused with a 400 naming the id: the
    // audience is derived on every other branch too, and `targeted` already
    // tells a legitimate caller that 2 ids resolved to 1 recipient.
    expect(res.status).toBe(201);
    const body = await readEnvelope<{
      targeted: number;
      issued: number;
      skipped: number;
    }>(res);
    expect(body.data?.targeted).toBe(1);
    expect(body.data?.issued).toBe(1);

    const held = await testApp.testDb.drizzle
      .select({ owner: userCoupons.ownerCustomerId })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, coupon.id));
    expect(held.map((row) => row.owner)).toEqual([mine]);

    // The batch must not book recipients it never wrote, or the shop's own
    // distribution history becomes the cover story for the leak.
    const [batch] = await testApp.testDb.drizzle
      .select({ total: couponDistributions.totalDistributed })
      .from(couponDistributions)
      .where(eq(couponDistributions.couponId, coupon.id));
    expect(batch?.total).toBe(1);

    expect(await customerRow(theirs)).toEqual(victimBefore);
  });

  it("drops a named customer whose only order here was cancelled", async () => {
    const shop = await seedShopWithOwner("Audience C", "audience-owner-c");
    const [customer] = await testApp.testDb.drizzle
      .insert(customers)
      .values({
        displayName: "Cancelled Only",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: customers.id });
    await seed.order(shop.restaurantId, {
      customerId: customer!.id,
      status: "cancelled",
    });

    const coupon = await seed.coupon(shop.restaurantId, { code: "CANCELLED" });
    const res = await distributeAs(shop.token, coupon.id, {
      distributionType: "manual",
      targetType: "user",
      targetCriteria: { customerIds: [customer!.id] },
    });

    expect(res.status).toBe(201);
    const body = await readEnvelope<{ targeted: number; issued: number }>(res);
    expect(body.data?.targeted).toBe(0);
    expect(body.data?.issued).toBe(0);

    const held = await testApp.testDb.drizzle
      .select({ id: userCoupons.id })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, coupon.id));
    expect(held).toHaveLength(0);
  });

  it("issues to named customers who have ordered here", async () => {
    // Positive control for the two drops above: the guard must narrow the
    // audience, not close the feature.
    const shop = await seedShopWithOwner("Audience D", "audience-owner-d");
    const first = await seedCustomerWithOrders(shop.restaurantId, 1);
    const second = await seedCustomerWithOrders(shop.restaurantId, 4);
    const coupon = await seed.coupon(shop.restaurantId, { code: "NAMED-OK" });

    const res = await distributeAs(shop.token, coupon.id, {
      distributionType: "manual",
      targetType: "user",
      targetCriteria: { customerIds: [first, second] },
    });

    expect(res.status).toBe(201);
    const body = await readEnvelope<{ targeted: number; issued: number }>(res);
    expect(body.data?.targeted).toBe(2);
    expect(body.data?.issued).toBe(2);

    const held = await testApp.testDb.drizzle
      .select({ owner: userCoupons.ownerCustomerId })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, coupon.id));
    expect(new Set(held.map((row) => row.owner))).toEqual(
      new Set([first, second]),
    );
  });

  it("lets an admin issue a platform coupon to any named customer", async () => {
    // A platform coupon has no restaurant, so "has ordered here" does not
    // apply; the audience is every active customer. Same shape of customer as
    // the drop case above — a stranger to the coupon's issuer, refused for a
    // shop's coupon and reachable for a platform one.
    const shopB = await seedShopWithOwner("Audience E", "audience-owner-e");
    const stranger = await seedCustomerWithOrders(shopB.restaurantId, 1);

    const [platformCoupon] = await testApp.testDb.drizzle
      .insert(coupons)
      .values({
        restaurantId: null,
        code: "PLATFORM-GIFT",
        name: "Platform gift",
        discountType: "fixed",
        discountValueCents: 100,
        minOrderAmountCents: 0,
        validFrom: offsetDate(-1),
        validTo: offsetDate(30),
        isActive: true,
        isVisible: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: coupons.id });

    const res = await distributeAs(adminToken, platformCoupon!.id, {
      distributionType: "manual",
      targetType: "user",
      targetCriteria: { customerIds: [stranger] },
    });

    expect(res.status).toBe(201);
    const body = await readEnvelope<{ targeted: number; issued: number }>(res);
    expect(body.data?.targeted).toBe(1);
    expect(body.data?.issued).toBe(1);

    const held = await testApp.testDb.drizzle
      .select({ owner: userCoupons.ownerCustomerId })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, platformCoupon!.id));
    expect(held.map((row) => row.owner)).toEqual([stranger]);
  });

  it("refuses an owner reaching a platform coupon's distribution", async () => {
    const shop = await seedShopWithOwner("Audience F", "audience-owner-f");
    const mine = await seedCustomerWithOrders(shop.restaurantId, 1);

    const [platformCoupon] = await testApp.testDb.drizzle
      .insert(coupons)
      .values({
        restaurantId: null,
        code: "PLATFORM-LOCKED",
        name: "Platform locked",
        discountType: "fixed",
        discountValueCents: 100,
        minOrderAmountCents: 0,
        validFrom: offsetDate(-1),
        validTo: offsetDate(30),
        isActive: true,
        isVisible: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: coupons.id });

    const res = await distributeAs(shop.token, platformCoupon!.id, {
      distributionType: "manual",
      targetType: "user",
      targetCriteria: { customerIds: [mine] },
    });

    expect(res.status).toBe(403);

    const held = await testApp.testDb.drizzle
      .select({ id: userCoupons.id })
      .from(userCoupons)
      .where(eq(userCoupons.couponId, platformCoupon!.id));
    expect(held).toHaveLength(0);
  });

  // ── GET /coupons (list) ───────────────────────────────────────────────────

  it("GET /coupons lists seeded coupons for the admin", async () => {
    // Seed 3 coupons directly — faster than 3 POSTs and isolates the
    // list endpoint from the create endpoint.
    await seed.coupon(restaurantId, { code: "LIST1", name: "List Coupon 1" });
    await seed.coupon(restaurantId, { code: "LIST2", name: "List Coupon 2" });
    await seed.coupon(restaurantId, { code: "LIST3", name: "List Coupon 3" });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons?page=1&limit=20", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const body = await readEnvelope<ListedCoupon[]>(res);
    expect(body.success).toBe(true);
    // GET /coupons puts `result.coupons` straight in `data`; the pagination
    // block is a sibling of it, not a wrapper around it.
    const items = body.data ?? [];
    expect(items.length).toBeGreaterThanOrEqual(3);
    const codes = items.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["LIST1", "LIST2", "LIST3"]));
  });

  // ── POST /coupons/validate (public, CSRF-excluded) ───────────────────────

  it("POST /coupons/validate accepts an active coupon and returns discount math", async () => {
    // seed.coupon() defaults to validFrom: yesterday, validTo: +30d,
    // isActive: true, isVisible: true, discountType: percentage, value: 10.
    const created = await seed.coupon(restaurantId);

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: created.code,
          restaurantId,
          orderAmount: 500,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await readEnvelope<CouponValidation>(res);
    expect(body.success).toBe(true);
    expect(body.data?.valid).toBe(true);
    // 10% of 500 = 50. The service may or may not surface
    // discountAmount/finalAmount depending on wire shape; assert what
    // legacy asserted — just that the fields are populated.
    expect(body.data?.discountAmount).toBeDefined();
    expect(body.data?.finalAmount).toBeDefined();
  });

  it("POST /coupons/validate returns valid:false for an expired coupon", async () => {
    // Past window — seed.coupon with explicit date strings.
    const created = await seed.coupon(restaurantId, {
      code: "EXPIRED99",
      validFrom: new Date("2020-01-01T00:00:00.000Z"),
      validTo: new Date("2020-12-31T00:00:00.000Z"),
    });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: created.code,
          restaurantId,
          orderAmount: 100,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await readEnvelope<CouponValidation>(res);
    expect(body.success).toBe(true);
    // Validation returns valid:false for expired coupons (does NOT throw).
    expect(body.data?.valid).toBe(false);
    expect(body.data?.error).toBeDefined();
  });

  // ── POST /coupons/:id/deactivate ──────────────────────────────────────────

  it("POST /coupons/:id/deactivate flips isActive to false", async () => {
    const created = await seed.coupon(restaurantId, { code: "DEACT10" });

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${created.id}/deactivate`, {
        method: "POST",
        headers: csrfHeaders(adminToken),
      }),
    );

    expect(res.status).toBe(200);
    const body = await readEnvelope<CouponResponse>(res);
    expect(body.success).toBe(true);
    // `is_active` is declared integer({ mode: "boolean" }), and this response
    // comes back through Drizzle's .returning(), so it is the JS boolean false
    // rather than SQLite's 0. The previous assertion accepted either because
    // the response type was `unknown` and it could not tell; now that the type
    // is derived from the service, `=== 0` no longer compiles (TS2367).
    expect(body.data?.isActive).toBe(false);
  });

  // ── Auth gate on list endpoint ────────────────────────────────────────────

  it("GET /coupons without Authorization returns 401", async () => {
    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons"),
    );

    expect(res.status).toBe(401);
    const body = await readEnvelope(res);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  it("GET /coupons/analytics/trends returns real coupon usage aggregates", async () => {
    const coupon = await seed.coupon(restaurantId, {
      code: "TREND25",
      discountType: "fixed",
      discountValue: 25,
      discountValueCents: 2500,
    });
    const order = await seed.order(restaurantId, {
      subtotal: 100,
      subtotalCents: 10000,
      discountAmount: 25,
      discountAmountCents: 2500,
      totalAmount: 75,
      totalAmountCents: 7500,
    });

    const useRes = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons/use", {
        method: "POST",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({
          couponId: coupon.id,
          orderId: order.id,
          discountAmount: 25,
          originalAmount: 100,
          finalAmount: 75,
        }),
      }),
    );

    expect(useRes.status).toBe(200);

    const trendsRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/coupons/analytics/trends?restaurantId=${restaurantId}`,
        {
          headers: { authorization: `Bearer ${adminToken}` },
        },
      ),
    );

    expect(trendsRes.status).toBe(200);
    const trends = await readData<CouponTrends>(trendsRes);
    expect(trends).toMatchObject({
      totalCoupons: 1,
      activeCoupons: 1,
      totalUsage: 1,
      totalSavings: 25,
    });
    expect(trends.usageByPeriod).toEqual([
      expect.objectContaining({
        totalUsage: 1,
        totalSavings: 25,
      }),
    ]);
  });

  it("rejects role-5 customer tokens on POST /coupons/use", async () => {
    const coupon = await seed.coupon(restaurantId, {
      code: "CUSTOMERNO",
      discountValueCents: 1000,
      isVisible: true,
    });
    const order = await seed.order(restaurantId, {
      subtotal: 100,
      subtotalCents: 10000,
      discountAmount: 0,
      discountAmountCents: 0,
      totalAmount: 100,
      totalAmountCents: 10000,
    });
    const customer = await seed.user({
      username: "coupon-customer",
      role: 5,
      restaurantId,
    });
    const customerToken = await testApp.authHelper.customerToken(customer.id);

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons/use", {
        method: "POST",
        headers: csrfHeaders(customerToken),
        body: JSON.stringify({
          couponId: coupon.id,
          orderId: order.id,
          discountAmount: 10,
          originalAmount: 100,
          finalAmount: 90,
        }),
      }),
    );

    expect(res.status).toBe(401);
    const body = await readEnvelope(res);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("TOKEN_INVALID");
  });

  it("enforces coupons owner access and cross-restaurant scope on analytics trends", async () => {
    const restaurantA = await seed.restaurant({ name: "Coupon Owner A" });
    const restaurantB = await seed.restaurant({ name: "Coupon Owner B" });
    await insertActiveSubscription(String(restaurantA.id));
    await insertActiveSubscription(String(restaurantB.id));

    const ownerA = await seed.user({
      username: "coupon-owner-a",
      role: 1,
      restaurantId: String(restaurantA.id),
    });
    const ownerAToken = await testApp.authHelper.ownerToken(
      ownerA.id,
      String(restaurantA.id),
    );
    const ownerB = await seed.user({
      username: "coupon-owner-b",
      role: 1,
      restaurantId: String(restaurantB.id),
    });
    const ownerBToken = await testApp.authHelper.ownerToken(
      ownerB.id,
      String(restaurantB.id),
    );

    const couponA = await seed.coupon(restaurantA.id, {
      code: "TICKET01A",
      discountValueCents: 1000,
      isVisible: true,
    });
    const couponB = await seed.coupon(restaurantB.id, {
      code: "TICKET01B",
      discountValueCents: 2000,
      isVisible: true,
    });

    const orderA = await seed.order(restaurantA.id, {
      subtotal: 300,
      subtotalCents: 30000,
      totalAmount: 290,
      totalAmountCents: 29000,
      discountAmount: 10,
      discountAmountCents: 1000,
    });
    const orderB = await seed.order(restaurantB.id, {
      subtotal: 300,
      subtotalCents: 30000,
      totalAmount: 280,
      totalAmountCents: 28000,
      discountAmount: 20,
      discountAmountCents: 2000,
    });

    const useARes = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons/use", {
        method: "POST",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({
          couponId: couponA.id,
          orderId: orderA.id,
          discountAmount: 10,
          originalAmount: 300,
          finalAmount: 290,
        }),
      }),
    );
    expect(useARes.status).toBe(200);

    const useBRes = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons/use", {
        method: "POST",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({
          couponId: couponB.id,
          orderId: orderB.id,
          discountAmount: 20,
          originalAmount: 300,
          finalAmount: 280,
        }),
      }),
    );
    expect(useBRes.status).toBe(200);

    const trendsOwnRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/coupons/analytics/trends?restaurantId=${restaurantA.id}`,
        {
          headers: { authorization: `Bearer ${ownerAToken}` },
        },
      ),
    );
    expect(trendsOwnRes.status).toBe(200);
    const trendsOwn = await readData<CouponTrends>(trendsOwnRes);
    expect(trendsOwn.totalCoupons).toBe(1);
    expect(trendsOwn.totalUsage).toBe(1);

    const trendsCrossRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/coupons/analytics/trends?restaurantId=${restaurantB.id}`,
        {
          headers: { authorization: `Bearer ${ownerAToken}` },
        },
      ),
    );
    expect(trendsCrossRes.status).toBe(403);

    const trendsOwnerBRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/coupons/analytics/trends?restaurantId=${restaurantB.id}`,
        {
          headers: { authorization: `Bearer ${ownerBToken}` },
        },
      ),
    );
    expect(trendsOwnerBRes.status).toBe(200);
    const trendsOwnerB = await readData<CouponTrends>(trendsOwnerBRes);
    expect(trendsOwnerB.totalCoupons).toBe(1);
    expect(trendsOwnerB.totalUsage).toBe(1);
  });

  it("enforces owner/cross-restaurant permission for coupon deactivation and admin full access", async () => {
    const restaurantA = await seed.restaurant({ name: "Coupon Owner C" });
    const restaurantB = await seed.restaurant({ name: "Coupon Owner D" });
    await insertActiveSubscription(String(restaurantA.id));
    await insertActiveSubscription(String(restaurantB.id));

    const ownerA = await seed.user({
      username: "coupon-owner-cross-a",
      role: 1,
      restaurantId: String(restaurantA.id),
    });
    const ownerAToken = await testApp.authHelper.ownerToken(
      ownerA.id,
      String(restaurantA.id),
    );

    const couponA = await seed.coupon(restaurantA.id, { code: "TICKET01C" });
    const couponB = await seed.coupon(restaurantB.id, { code: "TICKET01D" });

    const ownerOwnRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${couponA.id}/deactivate`, {
        method: "POST",
        headers: csrfHeaders(ownerAToken),
      }),
    );
    expect(ownerOwnRes.status).toBe(200);

    const ownerOtherRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${couponB.id}/deactivate`, {
        method: "POST",
        headers: csrfHeaders(ownerAToken),
      }),
    );
    expect(ownerOtherRes.status).toBe(403);

    const adminResOwn = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${couponA.id}/deactivate`, {
        method: "POST",
        headers: csrfHeaders(adminToken),
      }),
    );
    expect(adminResOwn.status).toBe(200);

    const adminResOther = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${couponB.id}/deactivate`, {
        method: "POST",
        headers: csrfHeaders(adminToken),
      }),
    );
    expect(adminResOther.status).toBe(200);

    const owner = await seed.user({
      username: "coupon-chef",
      role: 2,
      restaurantId: String(restaurantA.id),
    });
    const chefToken = await testApp.authHelper.staffToken(
      owner.id,
      2,
      String(restaurantA.id),
    );
    const chefRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${couponA.id}/deactivate`, {
        method: "POST",
        headers: csrfHeaders(chefToken),
      }),
    );
    expect(chefRes.status).toBe(403);

    // A request with neither a CSRF token nor credentials is now rejected by
    // CSRF (403) before authentication is reached (401). CSRF is a global
    // middleware and auth is per-route, so once CSRF was registered ahead of
    // the feature mounts — which is what makes it run at all — it necessarily
    // runs first. Rejecting a tokenless state-changing request before doing
    // any auth work is the safer order: it does not reveal whether the
    // credentials would have been accepted. Real clients send both tokens and
    // are unaffected.
    const unauthedRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${couponA.id}/deactivate`, {
        method: "POST",
      }),
    );
    expect(unauthedRes.status).toBe(403);
  });

  it("clears nullable limits and soft-deletes without deleting usage history", async () => {
    const coupon = await seed.coupon(restaurantId, {
      code: "CLEAR-LIMITS",
      usageLimit: 5,
      usageLimitPerUser: 2,
      maxDiscountAmountCents: 1000,
    });
    const order = await seed.order(restaurantId);
    await testApp.testDb.drizzle.insert(couponUsage).values({
      couponId: coupon.id,
      orderId: order.id,
      status: "active",
      discountAmountCents: 100,
      originalAmountCents: 1000,
      finalAmountCents: 900,
    });

    const update = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${coupon.id}`, {
        method: "PUT",
        headers: csrfHeaders(adminToken),
        body: JSON.stringify({
          usageLimit: null,
          usageLimitPerUser: null,
          maxDiscountAmount: null,
        }),
      }),
    );
    expect(update.status).toBe(200);
    const [updated] = await testApp.testDb.drizzle
      .select()
      .from(coupons)
      .where(eq(coupons.id, coupon.id));
    expect(updated).toMatchObject({
      usageLimit: null,
      usageLimitPerUser: null,
      maxDiscountAmountCents: null,
    });

    const deleted = await testApp.app.fetch(
      new Request(`https://test/api/v1/coupons/${coupon.id}`, {
        method: "DELETE",
        headers: csrfHeaders(adminToken),
      }),
    );
    expect(deleted.status).toBe(200);
    const [softDeleted] = await testApp.testDb.drizzle
      .select()
      .from(coupons)
      .where(eq(coupons.id, coupon.id));
    expect(softDeleted?.deletedAt).toBeInstanceOf(Date);
    const usageRows = await testApp.testDb.drizzle
      .select()
      .from(couponUsage)
      .where(eq(couponUsage.couponId, coupon.id));
    expect(usageRows).toHaveLength(1);

    const list = await testApp.app.fetch(
      new Request("https://test/api/v1/coupons?page=1&limit=20", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    const body = await readEnvelope<ListedCoupon[]>(list);
    expect((body.data ?? []).map((row) => row.id)).not.toContain(coupon.id);
  });

  it("releases a cancelled usage in one atomic D1 batch and retries without a second decrement", async () => {
    const coupon = await seed.coupon(restaurantId, {
      code: "CANCEL-ONCE",
      usedCount: 1,
    });
    const order = await seed.order(restaurantId);
    await testApp.testDb.drizzle.insert(couponUsage).values({
      couponId: coupon.id,
      orderId: order.id,
      status: "active",
    });
    const service = new DatabaseCouponService(testApp.env.DB, {
      JWT_SECRET: "test",
    });

    await Promise.all([
      service.releaseUsageForCancelledOrder(order.id),
      service.releaseUsageForCancelledOrder(order.id),
    ]);

    const [storedCoupon] = await testApp.testDb.drizzle
      .select()
      .from(coupons)
      .where(eq(coupons.id, coupon.id));
    const [usage] = await testApp.testDb.drizzle
      .select()
      .from(couponUsage)
      .where(
        and(
          eq(couponUsage.couponId, coupon.id),
          eq(couponUsage.orderId, order.id),
        ),
      );
    expect(storedCoupon?.usedCount).toBe(0);
    expect(usage).toMatchObject({ status: "cancelled" });
    expect(usage?.refundCountReleasedAt).toBeInstanceOf(Date);
  });

  it("rolls back all D1 batch writes when a later statement fails", async () => {
    const coupon = await seed.coupon(restaurantId, {
      code: "BATCH-ROLLBACK",
      usedCount: 1,
    });

    await expect(
      testApp.env.DB.batch([
        testApp.env.DB.prepare(
          "UPDATE coupons SET used_count = 0 WHERE id = ?",
        ).bind(coupon.id),
        testApp.env.DB.prepare(
          "UPDATE coupon_table_that_does_not_exist SET x = 1",
        ),
      ]),
    ).rejects.toThrow();

    const [storedCoupon] = await testApp.testDb.drizzle
      .select()
      .from(coupons)
      .where(eq(coupons.id, coupon.id));
    expect(storedCoupon?.usedCount).toBe(1);
  });

  it("filters active, expired, exhausted, and inactive statuses at their exact time boundaries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00.000Z"));
    try {
      // The auth helper signs JWT expiry from Date.now(), so mint after
      // freezing the clock used by the service and this boundary test.
      const frozenAdminToken =
        await testApp.authHelper.adminToken(restaurantId);
      const now = new Date();
      await seed.coupon(restaurantId, {
        code: "ACTIVE-AT-END",
        validFrom: new Date("2026-08-28T11:00:00.000Z"),
        validTo: now,
      });
      await seed.coupon(restaurantId, {
        code: "EXPIRED",
        validFrom: new Date("2026-08-28T10:00:00.000Z"),
        validTo: new Date("2026-08-28T11:59:59.999Z"),
      });
      await seed.coupon(restaurantId, {
        code: "EXHAUSTED",
        validFrom: new Date("2026-08-28T11:00:00.000Z"),
        validTo: new Date("2026-08-28T13:00:00.000Z"),
        usageLimit: 2,
        usedCount: 2,
      });
      await seed.coupon(restaurantId, {
        code: "INACTIVE",
        isActive: false,
        validFrom: new Date("2026-08-28T11:00:00.000Z"),
        validTo: new Date("2026-08-28T13:00:00.000Z"),
      });
      await seed.coupon(restaurantId, {
        code: "SCHEDULED",
        validFrom: new Date("2026-08-28T13:00:00.000Z"),
        validTo: new Date("2026-08-29T13:00:00.000Z"),
      });

      for (const [status, expectedCode] of [
        ["active", "ACTIVE-AT-END"],
        ["expired", "EXPIRED"],
        ["exhausted", "EXHAUSTED"],
        ["inactive", "INACTIVE"],
      ] as const) {
        const response = await testApp.app.fetch(
          new Request(`https://test/api/v1/coupons?status=${status}`, {
            headers: { authorization: `Bearer ${frozenAdminToken}` },
          }),
        );
        expect(response.status).toBe(200);
        const body = await readEnvelope<ListedCoupon[]>(response);
        const codes = (body.data ?? []).map((row) => row.code);
        expect(codes).toContain(expectedCode);
        expect(codes).not.toContain("SCHEDULED");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
