/**
 * Real-D1 tests for MarketCheckoutVoucherService (卷 voucher redemption).
 *
 * Runs the real implementation against a Miniflare D1 database through Drizzle
 * so the money-adjacent SQL is proven against actual SQLite semantics:
 *   - platform-wide-only validation + discount pricing
 *   - proportional discount split recorded in coupon_usage
 *   - used_count increments exactly once per checkout, idempotent on replay
 *   - refund marking
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  coupons,
  couponUsage,
  marketCheckoutChildOrders,
  marketCheckoutSessions,
  markets,
  orders,
  restaurants,
} from "@makanmasak/database";
import { eq } from "drizzle-orm";
import type { Env } from "../../types/env";
import { MarketCheckoutVoucherService } from "../../features/market-checkouts/services/MarketCheckoutVoucherService";

let testDb: TestDatabase;

function makeService(): MarketCheckoutVoucherService {
  return new MarketCheckoutVoucherService({
    DB: testDb.bindings.DB,
    CACHE_KV: testDb.bindings.CACHE_KV,
  } as Env);
}

interface SeedCouponOptions {
  code: string;
  discountType?: "percentage" | "fixed";
  /** Basis points (e.g. 1000 = 10%) for percentage discounts. */
  discountPercentageBps?: number | null;
  /** Cent amount for fixed discounts. */
  discountValueCents?: number | null;
  maxDiscountAmountCents?: number | null;
  minOrderAmountCents?: number | null;
  restaurantId?: string | null;
  validFrom?: Date;
  validTo?: Date;
  isActive?: boolean;
  isVisible?: boolean;
  usageLimit?: number | null;
  usedCount?: number;
}

async function seedCoupon(options: SeedCouponOptions): Promise<number> {
  const discountType = options.discountType ?? "percentage";
  const [row] = await testDb.drizzle
    .insert(coupons)
    .values({
      code: options.code,
      name: options.code,
      restaurantId: options.restaurantId ?? null,
      discountType,
      discountPercentageBps:
        discountType === "percentage"
          ? (options.discountPercentageBps ?? 1000)
          : null,
      discountValueCents:
        discountType === "fixed" ? (options.discountValueCents ?? 1000) : null,
      maxDiscountAmountCents: options.maxDiscountAmountCents ?? null,
      minOrderAmountCents: options.minOrderAmountCents ?? 0,
      validFrom: options.validFrom ?? new Date("2020-01-01T00:00:00.000Z"),
      validTo: options.validTo ?? new Date("2099-12-31T00:00:00.000Z"),
      isActive: options.isActive ?? true,
      isVisible: options.isVisible ?? true,
      usageLimit: options.usageLimit ?? null,
      usedCount: options.usedCount ?? 0,
    })
    .returning({ id: coupons.id });
  return row.id;
}

const TEST_RESTAURANT_ID = "r-test";

async function seedRestaurant(id: string = TEST_RESTAURANT_ID): Promise<void> {
  await testDb.drizzle.insert(restaurants).values({
    id,
    name: "Test Stall",
    type: "street_food",
    category: "snack",
    address: "1 Night Market Rd",
    district: "West",
    phone: "0900000000",
  });
}

async function seedMarketCheckout(
  checkoutId: string,
  childOrderIds: string[],
): Promise<void> {
  const now = new Date();
  await testDb.drizzle.insert(markets).values({
    id: "market-test",
    slug: "market-test",
    name: "Test Market",
    type: "night_market",
    city: "Test City",
    district: "Test District",
    address: "1 Market Rd",
    latitude: 24.15,
    longitude: 120.67,
    createdAt: now,
    updatedAt: now,
  });
  await testDb.drizzle.insert(marketCheckoutSessions).values({
    id: checkoutId,
    marketId: "market-test",
    marketSlug: "market-test",
    marketName: "Test Market",
    status: "paid",
    paymentStatus: "paid",
    subtotalCents: 24000,
    childOrderCount: childOrderIds.length,
    createdAt: now,
    updatedAt: now,
  });
  await testDb.drizzle.insert(marketCheckoutChildOrders).values(
    childOrderIds.map((orderId) => ({
      checkoutId,
      restaurantId: TEST_RESTAURANT_ID,
      restaurantName: "Test Stall",
      orderId,
      orderNumber: `ORDER-${orderId}`,
      totalAmountCents: 0,
      tokenExpiresAt: now,
      createdAt: now,
    })),
  );
}

async function seedOrder(
  id: string,
  totalCents: number,
  restaurantId: string = TEST_RESTAURANT_ID,
): Promise<void> {
  await testDb.drizzle.insert(orders).values({
    id,
    restaurantId,
    orderNumber: `ORDER-${id}`,
    subtotalCents: totalCents,
    totalAmountCents: totalCents,
    status: "pending",
  });
}

async function usageFor(couponId: number) {
  return testDb.drizzle
    .select()
    .from(couponUsage)
    .where(eq(couponUsage.couponId, couponId))
    .all();
}

async function usedCountFor(couponId: number): Promise<number> {
  const [row] = await testDb.drizzle
    .select({ usedCount: coupons.usedCount })
    .from(coupons)
    .where(eq(coupons.id, couponId))
    .all();
  return row?.usedCount ?? 0;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.dispose();
});

beforeEach(async () => {
  await testDb.truncateAll();
});

describe("MarketCheckoutVoucherService — validateAndPrice", () => {
  it("prices a platform-wide percentage voucher and splits proportionally", async () => {
    await seedCoupon({ code: "MARKET10", discountPercentageBps: 1000 });

    const applied = await makeService().validateAndPrice({
      currency: "TWD",
      code: "market10", // case-insensitive
      subtotalCents: 24000,
      childOrders: [
        { orderId: "101", amountCents: 16000 },
        { orderId: "102", amountCents: 8000 },
      ],
    });

    expect(applied.discountCents).toBe(2400);
    expect(applied.allocations).toEqual([
      { orderId: "101", amountCents: 16000, discountCents: 1600 },
      { orderId: "102", amountCents: 8000, discountCents: 800 },
    ]);
  });

  it("rejects a vendor-scoped coupon at market checkout", async () => {
    await seedRestaurant("restaurant-1");
    await seedCoupon({ code: "SHOPONLY", restaurantId: "restaurant-1" });

    await expect(
      makeService().validateAndPrice({
        currency: "TWD",
        code: "SHOPONLY",
        subtotalCents: 24000,
        childOrders: [{ orderId: "101", amountCents: 24000 }],
      }),
    ).rejects.toMatchObject({ code: "VOUCHER_NOT_APPLICABLE" });
  });

  it("rejects when the subtotal is below the minimum order", async () => {
    await seedCoupon({ code: "MIN500", minOrderAmountCents: 50000 });

    await expect(
      makeService().validateAndPrice({
        currency: "TWD",
        code: "MIN500",
        subtotalCents: 24000,
        childOrders: [{ orderId: "101", amountCents: 24000 }],
      }),
    ).rejects.toMatchObject({ code: "VOUCHER_MIN_ORDER_NOT_MET" });
  });

  it("rejects an exhausted voucher", async () => {
    await seedCoupon({ code: "ONEUSE", usageLimit: 1, usedCount: 1 });

    await expect(
      makeService().validateAndPrice({
        currency: "TWD",
        code: "ONEUSE",
        subtotalCents: 24000,
        childOrders: [{ orderId: "101", amountCents: 24000 }],
      }),
    ).rejects.toMatchObject({ code: "VOUCHER_EXHAUSTED" });
  });

  it("rejects an expired voucher", async () => {
    await seedCoupon({
      code: "OLD",
      validTo: new Date("2020-01-02T00:00:00.000Z"),
    });

    await expect(
      makeService().validateAndPrice({
        currency: "TWD",
        code: "OLD",
        subtotalCents: 24000,
        childOrders: [{ orderId: "101", amountCents: 24000 }],
      }),
    ).rejects.toMatchObject({ code: "VOUCHER_EXPIRED" });
  });

  it("rejects an unknown code", async () => {
    await expect(
      makeService().validateAndPrice({
        currency: "TWD",
        code: "NOPE",
        subtotalCents: 24000,
        childOrders: [{ orderId: "101", amountCents: 24000 }],
      }),
    ).rejects.toMatchObject({ code: "VOUCHER_NOT_FOUND" });
  });
});

describe("MarketCheckoutVoucherService — redeem", () => {
  it("writes one coupon_usage per child and increments used_count once", async () => {
    const couponId = await seedCoupon({
      code: "MARKET10",
      discountPercentageBps: 1000,
    });
    await seedRestaurant();
    await seedOrder("101", 16000);
    await seedOrder("102", 8000);
    const service = makeService();

    const applied = await service.validateAndPrice({
      currency: "TWD",
      code: "MARKET10",
      subtotalCents: 24000,
      childOrders: [
        { orderId: "101", amountCents: 16000 },
        { orderId: "102", amountCents: 8000 },
      ],
    });

    await service.redeem(applied);

    const usage = await usageFor(couponId);
    expect(usage).toHaveLength(2);
    const byOrder = Object.fromEntries(
      usage.map((u) => [Number(u.orderId), u]),
    );
    expect(byOrder[101]).toMatchObject({
      discountAmountCents: 1600,
      originalAmountCents: 16000,
      finalAmountCents: 14400,
      status: "active",
    });
    expect(byOrder[102]).toMatchObject({
      discountAmountCents: 800,
      originalAmountCents: 8000,
      finalAmountCents: 7200,
    });
    expect(await usedCountFor(couponId)).toBe(1);
  });

  it("is idempotent across replays (success path + webhook)", async () => {
    const couponId = await seedCoupon({
      code: "MARKET10",
      discountPercentageBps: 1000,
    });
    await seedRestaurant();
    await seedOrder("101", 16000);
    await seedOrder("102", 8000);
    const service = makeService();
    const applied = await service.validateAndPrice({
      currency: "TWD",
      code: "MARKET10",
      subtotalCents: 24000,
      childOrders: [
        { orderId: "101", amountCents: 16000 },
        { orderId: "102", amountCents: 8000 },
      ],
    });

    await service.redeem(applied);
    await service.redeem(applied);

    expect(await usageFor(couponId)).toHaveLength(2);
    expect(await usedCountFor(couponId)).toBe(1);
  });

  it("marks redemption refunded and releases the checkout's voucher use", async () => {
    const couponId = await seedCoupon({
      code: "MARKET10",
      discountPercentageBps: 1000,
    });
    await seedRestaurant();
    await seedOrder("101", 16000);
    await seedOrder("102", 8000);
    const service = makeService();
    const applied = await service.validateAndPrice({
      currency: "TWD",
      code: "MARKET10",
      subtotalCents: 24000,
      childOrders: [
        { orderId: "101", amountCents: 16000 },
        { orderId: "102", amountCents: 8000 },
      ],
    });
    await service.redeem(applied);
    expect(await usedCountFor(couponId)).toBe(1);

    await service.markRefunded({ couponId, orderIds: ["101", "102"] });
    await service.markRefunded({ couponId, orderIds: ["101", "102"] });

    const usage = await usageFor(couponId);
    expect(usage.every((u) => u.status === "refunded")).toBe(true);
    expect(await usedCountFor(couponId)).toBe(0);
  });

  it("keeps the voucher use counted until every usage row in the checkout is refunded", async () => {
    const couponId = await seedCoupon({
      code: "PARTIAL10",
      discountPercentageBps: 1000,
    });
    await seedRestaurant();
    await seedOrder("101", 16000);
    await seedOrder("102", 8000);
    await seedMarketCheckout("checkout-partial", ["101", "102"]);
    const service = makeService();
    const applied = await service.validateAndPrice({
      currency: "TWD",
      code: "PARTIAL10",
      subtotalCents: 24000,
      childOrders: [
        { orderId: "101", amountCents: 16000 },
        { orderId: "102", amountCents: 8000 },
      ],
    });
    await service.redeem(applied);
    expect(await usedCountFor(couponId)).toBe(1);
    await testDb.drizzle
      .update(coupons)
      .set({ usedCount: 2 })
      .where(eq(coupons.id, couponId));
    expect(await usedCountFor(couponId)).toBe(2);

    await service.markRefunded({ couponId, orderIds: ["102"] });

    const partiallyRefundedUsage = await usageFor(couponId);
    expect(
      Object.fromEntries(
        partiallyRefundedUsage.map((usage) => [
          Number(usage.orderId),
          usage.status,
        ]),
      ),
    ).toEqual({
      101: "active",
      102: "refunded",
    });
    expect(
      partiallyRefundedUsage.every(
        (usage) => usage.refundCountReleasedAt == null,
      ),
    ).toBe(true);
    expect(await usedCountFor(couponId)).toBe(2);

    await service.markRefunded({ couponId, orderIds: ["101"] });
    await service.markRefunded({ couponId, orderIds: ["101", "102"] });

    const fullyRefundedUsage = await usageFor(couponId);
    expect(
      fullyRefundedUsage.every((usage) => usage.status === "refunded"),
    ).toBe(true);
    const releaseMarkersByOrderId = Object.fromEntries(
      fullyRefundedUsage.map((usage) => [
        Number(usage.orderId),
        usage.refundCountReleasedAt,
      ]),
    );
    expect(releaseMarkersByOrderId[101]).toBeInstanceOf(Date);
    expect(releaseMarkersByOrderId[102]).toBeNull();
    expect(await usedCountFor(couponId)).toBe(1);
  });
});
