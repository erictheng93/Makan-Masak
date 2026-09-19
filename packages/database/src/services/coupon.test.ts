import { describe, expect, it, vi } from "vitest";
import {
  couponDiscountCents,
  CouponEligibilityError,
  CouponService,
  type CreateCouponData,
  type RedeemableCouponRow,
} from "./coupon";

describe("CouponService.updateCoupon", () => {
  it("does not update coupon restaurant ownership", async () => {
    let writtenValues: Record<string, unknown> | undefined;
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn((values: Record<string, unknown>) => {
      writtenValues = values;
      return { where };
    });
    const service = Object.create(CouponService.prototype) as CouponService;
    Object.assign(service, {
      db: {
        update: vi.fn(() => ({ set })),
      },
    });

    await service.updateCoupon(10, {
      restaurantId: "restaurant-2",
      name: "Moved coupon",
    } as Partial<CreateCouponData>);

    expect(writtenValues).toMatchObject({ name: "Moved coupon" });
    expect(writtenValues).not.toHaveProperty("restaurantId");
  });
});

describe("CouponService.assertCouponRedeemable per-user limit", () => {
  function buildCoupon(
    overrides: Partial<RedeemableCouponRow> = {},
  ): RedeemableCouponRow {
    return {
      id: 10,
      restaurantId: "restaurant-1",
      deletedAt: null,
      isActive: true,
      isVisible: true,
      validFrom: new Date("2000-01-01T00:00:00.000Z"),
      validTo: new Date("2999-12-31T00:00:00.000Z"),
      usageLimit: null,
      usedCount: 0,
      usageLimitPerUser: null,
      minOrderAmountCents: null,
      applicableMenuItems: null,
      applicableCategories: null,
      ...overrides,
    };
  }

  function buildService(usageCount = 0) {
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ count: usageCount }]),
      })),
    }));
    const service = Object.create(CouponService.prototype) as CouponService;
    Object.assign(service, { db: { select } });
    return { service, select };
  }

  it("rejects a guest redemption when the coupon has a per-user limit but no global cap", async () => {
    const { service, select } = buildService();

    await expect(
      service.assertCouponRedeemable(
        buildCoupon({ usageLimitPerUser: 1, usageLimit: null }),
        {
          restaurantId: "restaurant-1",
          orderAmountCents: 1000,
          mode: "redeem",
        },
      ),
    ).rejects.toMatchObject({ code: "COUPON_REQUIRES_IDENTITY" });
    // 沒有身分可數，所以連 coupon_usage 都不該去查
    expect(select).not.toHaveBeenCalled();
  });

  it("still lets a guest redeem when a global cap bounds the damage", async () => {
    const { service, select } = buildService();

    await expect(
      service.assertCouponRedeemable(
        buildCoupon({ usageLimitPerUser: 1, usageLimit: 5, usedCount: 0 }),
        {
          restaurantId: "restaurant-1",
          orderAmountCents: 1000,
          mode: "redeem",
        },
      ),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("keeps counting per-user usage for an identified caller", async () => {
    const { service, select } = buildService(1);

    await expect(
      service.assertCouponRedeemable(buildCoupon({ usageLimitPerUser: 1 }), {
        restaurantId: "restaurant-1",
        orderAmountCents: 1000,
        userId: "user-1",
        mode: "redeem",
      }),
    ).rejects.toMatchObject({ code: "COUPON_USER_LIMIT_REACHED" });
    expect(select).toHaveBeenCalledOnce();
  });

  it("leaves guest redemption untouched when no per-user limit is set", async () => {
    const { service, select } = buildService();

    await expect(
      service.assertCouponRedeemable(buildCoupon(), {
        restaurantId: "restaurant-1",
        orderAmountCents: 1000,
        mode: "redeem",
      }),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("surfaces the identity failure as a CouponEligibilityError", async () => {
    const { service } = buildService();

    await expect(
      service.assertCouponRedeemable(buildCoupon({ usageLimitPerUser: 2 }), {
        restaurantId: "restaurant-1",
        orderAmountCents: 1000,
        mode: "validate",
      }),
    ).rejects.toBeInstanceOf(CouponEligibilityError);
  });
});

describe("couponDiscountCents", () => {
  const percentage = (bps: number, maxDiscountAmountCents: number | null) => ({
    discountType: "percentage" as const,
    discountPercentageBps: bps,
    discountValueCents: null,
    maxDiscountAmountCents,
  });

  it("rounds a 15% TWD discount on NT$155 to NT$23", () => {
    expect(couponDiscountCents(percentage(1500, null), 15500, "TWD")).toBe(
      2300,
    );
  });

  it("keeps sen for MYR", () => {
    expect(couponDiscountCents(percentage(1500, null), 15500, "MYR")).toBe(
      2325,
    );
  });

  it("rounds first, then caps", () => {
    expect(couponDiscountCents(percentage(1500, 2000), 15500, "TWD")).toBe(
      2000,
    );
  });
});

describe("CouponService.validateCoupon currency precision", () => {
  function buildService(currency: string | undefined) {
    const coupon = {
      id: 7,
      restaurantId: "restaurant-1",
      code: "PCT15",
      deletedAt: null,
      isActive: true,
      isVisible: true,
      validFrom: new Date("2000-01-01T00:00:00.000Z"),
      validTo: new Date("2999-12-31T00:00:00.000Z"),
      usageLimit: null,
      usedCount: 0,
      usageLimitPerUser: null,
      minOrderAmountCents: null,
      applicableMenuItems: null,
      applicableCategories: null,
      discountType: "percentage",
      discountPercentageBps: 1500,
      discountValueCents: null,
      maxDiscountAmountCents: null,
    };
    const restaurantsFindFirst = vi.fn(async () =>
      currency === undefined ? undefined : { settings: { currency } },
    );
    const service = Object.create(CouponService.prototype) as CouponService;
    Object.assign(service, {
      db: {
        query: {
          coupons: { findFirst: vi.fn(async () => coupon) },
          restaurants: { findFirst: restaurantsFindFirst },
        },
      },
    });
    return { service, restaurantsFindFirst };
  }

  it("reads the restaurant currency when the caller does not pass one", async () => {
    const { service, restaurantsFindFirst } = buildService("TWD");

    const result = await service.validateCoupon("pct15", "restaurant-1", 155);

    expect(result).toMatchObject({
      valid: true,
      discountAmount: 23,
      finalAmount: 132,
    });
    expect(restaurantsFindFirst).toHaveBeenCalledOnce();
  });

  it("uses the caller's currency without another lookup", async () => {
    const { service, restaurantsFindFirst } = buildService("TWD");

    const result = await service.validateCoupon(
      "pct15",
      "restaurant-1",
      155,
      undefined,
      undefined,
      { currency: "MYR" },
    );

    expect(result).toMatchObject({ discountAmount: 23.25 });
    expect(restaurantsFindFirst).not.toHaveBeenCalled();
  });

  it("defaults an unknown restaurant to TWD precision", async () => {
    const { service } = buildService(undefined);

    const result = await service.validateCoupon("pct15", "restaurant-1", 155);

    expect(result).toMatchObject({ discountAmount: 23 });
  });
});
