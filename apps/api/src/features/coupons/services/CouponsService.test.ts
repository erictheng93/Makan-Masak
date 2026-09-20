import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CouponService as BaseCouponService,
  orderItems,
} from "@makanmasak/database";
import { CouponsService } from "./CouponsService";

function createService() {
  return new CouponsService({} as D1Database, { JWT_SECRET: "test" });
}

function containsReference(
  value: unknown,
  target: unknown,
  seen = new Set<unknown>(),
): boolean {
  if (value === target) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) =>
    containsReference(child, target, seen),
  );
}

function createSelectChain(
  result: unknown[],
  resultForWhere?: (condition: unknown) => unknown[],
) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn((condition: unknown) =>
      resultForWhere ? createSelectChain(resultForWhere(condition)) : chain,
    ),
    groupBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    orderBy: vi.fn(async () => result),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    restaurantId: "restaurant-1",
    subtotalCents: 10000,
    ...overrides,
  };
}

/**
 * What the inherited coupon methods actually resolve with: the full
 * `coupons` row plus the three currency-unit fields `mapCouponMoneyFields`
 * derives from the `_cents` / `_bps` columns. Spies on `createCoupon`,
 * `updateCoupon`, `deactivateCoupon`, `getCoupons` and `getAvailableCoupons`
 * all have to answer with this shape, not with a hand-picked `{ id }` stub.
 */
type StoredCoupon = Awaited<ReturnType<CouponsService["createCoupon"]>>;

function buildStoredCoupon(
  overrides: Partial<StoredCoupon> = {},
): StoredCoupon {
  return {
    id: 10,
    restaurantId: "restaurant-1",
    code: "SAVE10",
    name: "Save 10",
    description: null,
    discountType: "percentage",
    discountPercentageBps: 1000,
    discountValueCents: null,
    maxDiscountAmountCents: null,
    minOrderAmountCents: null,
    applicableMenuItems: null,
    applicableCategories: null,
    usageLimit: null,
    usageLimitPerUser: null,
    usedCount: 0,
    validFrom: new Date("2026-06-01T00:00:00.000Z"),
    validTo: new Date("2026-07-01T00:00:00.000Z"),
    isActive: true,
    isVisible: true,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    createdBy: null,
    deletedAt: null,
    discountValue: 10,
    maxDiscountAmount: null,
    minOrderAmount: null,
    ...overrides,
  };
}

function buildRedeemableCoupon(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    restaurantId: "restaurant-1",
    code: "SAVE10",
    discountType: "percentage",
    discountPercentageBps: 1000,
    discountValueCents: null,
    maxDiscountAmountCents: null,
    minOrderAmountCents: null,
    applicableMenuItems: null,
    applicableCategories: null,
    usageLimit: null,
    usageLimitPerUser: null,
    usedCount: 0,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validTo: new Date("2026-12-31T00:00:00.000Z"),
    isActive: true,
    isVisible: true,
    deletedAt: null,
    ...overrides,
  };
}

function setupUseCouponService({
  order = buildOrder() as Record<string, unknown> | null,
  coupon = buildRedeemableCoupon() as Record<string, unknown> | null,
  orderItemRows = [] as Array<{
    menuItemId: number;
    quantity: number;
    status?: string;
  }>,
  itemCategoryRows = [] as Array<{
    category: { id: number } | null;
  }>,
  userUsageCount = 0,
  currency = "TWD",
} = {}) {
  const service = createService();
  // select 呼叫順序鏡射 useCouponForOrder：訂單 → 優惠券 →
  // （有適用限制時）訂單商品 → （有每用戶上限時）用戶使用次數
  const select = vi
    .fn()
    .mockReturnValueOnce(createSelectChain(order ? [order] : []))
    .mockReturnValueOnce(createSelectChain(coupon ? [coupon] : []));
  if (coupon && (coupon.applicableMenuItems || coupon.applicableCategories)) {
    const orderItemsSelect = createSelectChain(orderItemRows, (condition) =>
      containsReference(condition, orderItems.status)
        ? orderItemRows.filter((item) => item.status !== "cancelled")
        : orderItemRows,
    );
    select.mockReturnValueOnce(orderItemsSelect);
  }
  if (coupon?.usageLimitPerUser) {
    select.mockReturnValueOnce(createSelectChain([{ count: userUsageCount }]));
  }
  Object.assign(service as unknown as { db: unknown }, {
    db: {
      select,
      query: {
        menuItems: {
          findMany: vi.fn().mockResolvedValue(itemCategoryRows),
        },
        restaurants: {
          findFirst: vi.fn().mockResolvedValue({ settings: { currency } }),
        },
      },
    },
  });
  const useCoupon = vi
    .spyOn(service, "useCoupon")
    .mockResolvedValue({ id: 77 } as never);
  return { service, select, useCoupon };
}

describe("CouponsService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes coupon money fields from cent columns", () => {
    const service = createService();

    expect(
      service.formatCouponMoneyFields({
        id: 1,
        discountType: "fixed_amount",
        discountValue: 0,
        discountValueCents: 1250,
        maxDiscountAmount: 0,
        maxDiscountAmountCents: 500,
        minOrderAmount: 0,
        minOrderAmountCents: 2500,
      }),
    ).toMatchObject({
      discountValue: 12.5,
      maxDiscountAmount: 5,
      minOrderAmount: 25,
    });

    expect(
      service.formatCouponMoneyFields({
        id: 2,
        discountType: "percentage",
        discountValue: 0,
        discountPercentageBps: 1500,
        discountValueCents: 9999,
        maxDiscountAmount: null,
        minOrderAmount: null,
        minOrderAmountCents: 1000,
      }),
    ).toMatchObject({
      discountValue: 15,
      maxDiscountAmount: null,
      minOrderAmount: 10,
    });

    expect(
      service.formatCouponMoneyFields({
        id: 3,
        discountType: "percentage",
        discountValue: 0,
        discountPercentageBps: 1250,
        discountValueCents: 9999,
        maxDiscountAmount: null,
        minOrderAmount: null,
        minOrderAmountCents: 1000,
      }),
    ).toMatchObject({
      discountValue: 12.5,
      maxDiscountAmount: null,
      minOrderAmount: 10,
    });
  });

  it("delegates validation and paginated listing to inherited coupon methods", async () => {
    const service = createService();
    const validateCoupon = vi
      .spyOn(service, "validateCoupon")
      .mockResolvedValueOnce({ valid: true, discountAmount: 5 })
      .mockResolvedValueOnce({ valid: false, error: "expired" });
    vi.spyOn(service, "getCoupons").mockResolvedValue({
      // getCoupons joins the restaurant and creator relations onto each row.
      coupons: [
        {
          ...buildStoredCoupon({
            id: 1,
            discountType: "fixed",
            discountValue: 0,
            discountPercentageBps: null,
            discountValueCents: 1000,
            maxDiscountAmount: null,
            minOrderAmount: null,
          }),
          restaurant: { id: "restaurant-1", name: "Test Restaurant" },
          creator: null,
        },
      ],
      total: 21,
      page: 2,
      limit: 10,
    });

    await expect(
      service.validateCouponWithBusinessRules(
        "SAVE10",
        "restaurant-1",
        100,
        "user-42",
        [{ menuItemId: 1, quantity: 2 }],
      ),
    ).resolves.toEqual({ valid: true, discountAmount: 5 });
    expect(validateCoupon).toHaveBeenCalledWith(
      "SAVE10",
      "restaurant-1",
      100,
      "user-42",
      [{ menuItemId: 1, quantity: 2 }],
      { guestIdentity: undefined },
    );
    await expect(
      service.validateCouponWithBusinessRules("OLD", "restaurant-1", 100),
    ).resolves.toEqual({ valid: false, error: "expired" });

    await expect(
      service.getCouponsWithEnhancedFilters(
        { restaurantId: "restaurant-1" },
        2,
        10,
      ),
    ).resolves.toMatchObject({
      total: 21,
      page: 2,
      limit: 10,
      pages: 3,
      coupons: [{ id: 1, discountValue: 10 }],
    });
  });

  it("validates coupon creation before delegating", async () => {
    const service = createService();
    const storedCoupon = buildStoredCoupon({ id: 10 });
    const createCoupon = vi
      .spyOn(service, "createCoupon")
      .mockResolvedValue(storedCoupon);

    await expect(
      service.createCouponWithValidation({
        code: "SAVE10",
        name: "Save 10",
        restaurantId: "restaurant-1",
        discountType: "percentage",
        discountValue: 10,
        validFrom: new Date("2026-06-01T00:00:00.000Z"),
        validTo: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ).resolves.toEqual(storedCoupon);
    expect(createCoupon).toHaveBeenCalledOnce();

    await expect(
      service.createCouponWithValidation({
        code: "BADDATE",
        name: "Bad Date",
        discountType: "percentage",
        discountValue: 10,
        validFrom: new Date("2026-07-01T00:00:00.000Z"),
        validTo: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow();

    await expect(
      service.createCouponWithValidation({
        code: "BADPERCENT",
        name: "Bad Percent",
        discountType: "percentage",
        discountValue: 101,
        validFrom: new Date("2026-06-01T00:00:00.000Z"),
        validTo: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow();
  });

  it("maps duplicate coupon codes to a typed conflict", async () => {
    const service = createService();
    vi.spyOn(service, "createCoupon").mockRejectedValue(
      new BaseCouponService.DuplicateCodeError(),
    );

    await expect(
      service.createCouponWithValidation({
        code: "SAVE10",
        name: "Save 10",
        restaurantId: "restaurant-1",
        discountType: "percentage",
        discountValue: 10,
        validFrom: new Date("2026-06-01T00:00:00.000Z"),
        validTo: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "COUPON_CODE_EXISTS", status: 409 });
  });

  it("maps a wrapped D1 unique-constraint race to the same conflict", async () => {
    const service = createService();
    const error = new Error("D1 execute failed", {
      cause: new Error("UNIQUE constraint failed: coupons.code"),
    });
    vi.spyOn(service, "createCoupon").mockRejectedValue(error);

    await expect(
      service.createCouponWithValidation({
        code: "SAVE10",
        name: "Save 10",
        restaurantId: "restaurant-1",
        discountType: "percentage",
        discountValue: 10,
        validFrom: new Date("2026-06-01T00:00:00.000Z"),
        validTo: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "COUPON_CODE_EXISTS", status: 409 });
  });

  it("maps a duplicate code on the edit path to the same conflict", async () => {
    // `code` is updatable, and the base updateCoupon has no preflight lookup,
    // so the unique constraint is the only signal an edit collision produces.
    // Untranslated it sanitises to GENERIC_ERROR -> 500 plus a HIGH-severity
    // page, while the dashboard branches on COUPON_CODE_EXISTS.
    const service = createService();
    const base = vi
      .spyOn(BaseCouponService.prototype, "updateCoupon")
      .mockRejectedValue(
        new Error("D1 execute failed", {
          cause: new Error("UNIQUE constraint failed: coupons.code"),
        }),
      );

    try {
      await expect(
        service.updateCoupon(10, { code: "SAVE10" }),
      ).rejects.toMatchObject({ code: "COUPON_CODE_EXISTS", status: 409 });
      expect(base).toHaveBeenCalledWith(10, { code: "SAVE10" });
    } finally {
      base.mockRestore();
    }
  });

  it("releases a cancelled order coupon exactly once after claiming its marker", async () => {
    const service = createService();
    const selectWhere = vi.fn().mockResolvedValue([{ id: 7, couponId: 10 }]);
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const updateWhere = vi.fn(() => ({}));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));
    const batch = vi.fn().mockResolvedValue([]);
    Object.assign(service as unknown as { db: unknown }, {
      db: { select: vi.fn(() => ({ from: selectFrom })), update, batch },
    });

    await service.releaseUsageForCancelledOrder("order-1");

    expect(update).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it.each([
    ["no coupon usage", []],
    ["a usage already released by a refund", []],
  ])("does not decrement coupon usage for %s", async (_scenario, released) => {
    const service = createService();
    const batch = vi.fn();
    Object.assign(service as unknown as { db: unknown }, {
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(released) })),
        })),
        batch,
      },
    });

    await service.releaseUsageForCancelledOrder("order-1");

    expect(batch).not.toHaveBeenCalled();
  });

  it("reports zeros for a coupon nobody has redeemed", async () => {
    const service = createService();
    // SUM and AVG over zero usage rows come back NULL, and the aggregate row
    // itself is optional. Consumers get 0, not a null to guess at.
    vi.spyOn(service, "getCouponStats").mockResolvedValue({
      totalUsed: 0,
      totalDiscount: null,
      avgDiscount: null,
      lastUsed: null,
    } as never);

    await expect(
      service.getComprehensiveCouponStats(10),
    ).resolves.toMatchObject({
      totalUsed: 0,
      totalDiscount: 0,
      avgDiscount: 0,
      lastUsed: null,
    });
  });

  it("augments stats and counts bulk operation failures", async () => {
    const service = createService();
    // The real getCouponStats returns totalUsed / totalDiscount / avgDiscount
    // / lastUsed. This mock used to answer with totalUsage and uniqueUsers,
    // fields no version of CouponStats has ever had — the old spread passed
    // the fiction straight through to the assertion.
    vi.spyOn(service, "getCouponStats").mockResolvedValue({
      totalUsed: 3,
      totalDiscount: 25,
      avgDiscount: 8.5,
      lastUsed: "2026-06-07T00:00:00.000Z",
    });
    vi.spyOn(service, "updateCoupon")
      .mockResolvedValueOnce(buildStoredCoupon({ id: 1 }))
      .mockRejectedValueOnce(new Error("update failed"));
    vi.spyOn(service, "deactivateCoupon")
      .mockResolvedValueOnce(buildStoredCoupon({ id: 1, isActive: false }))
      .mockRejectedValueOnce(new Error("deactivate failed"));
    vi.spyOn(service, "deleteCoupon")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("delete failed"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      service.getComprehensiveCouponStats(10),
    ).resolves.toMatchObject({
      totalUsed: 3,
      totalDiscount: 25,
      avgDiscount: 8.5,
      lastUsed: "2026-06-07T00:00:00.000Z",
      usageByDay: [],
      topUsers: [],
      averageOrderValue: 0,
    });
    await expect(service.bulkActivateCoupons([1, 2])).resolves.toEqual({
      success: 1,
      failed: 1,
    });
    await expect(service.bulkDeactivateCoupons([1, 2])).resolves.toEqual({
      success: 1,
      failed: 1,
    });
    await expect(service.bulkDeleteCoupons([1, 2])).resolves.toEqual({
      success: 1,
      failed: 1,
    });
    consoleError.mockRestore();
  });

  it("filters available coupons by minimum order amount", async () => {
    const service = createService();
    vi.spyOn(service, "getAvailableCoupons").mockResolvedValue([
      buildStoredCoupon({
        id: 1,
        discountType: "fixed",
        discountValue: 0,
        discountPercentageBps: null,
        discountValueCents: 500,
        minOrderAmount: null,
        minOrderAmountCents: 2000,
      }),
      buildStoredCoupon({
        id: 2,
        discountType: "fixed",
        discountValue: 0,
        discountPercentageBps: null,
        discountValueCents: 1000,
        minOrderAmount: null,
        minOrderAmountCents: 5000,
      }),
    ]);

    await expect(
      service.getAvailableCouponsForUser("restaurant-1", "user-42", 30),
    ).resolves.toEqual([
      expect.objectContaining({ id: 1, discountValue: 5, minOrderAmount: 20 }),
    ]);
    await expect(
      service.getAvailableCouponsForUser("restaurant-1", "user-42"),
    ).resolves.toHaveLength(2);
  });

  it("calculates fixed and capped percentage savings in currency units", async () => {
    const service = createService();

    await expect(
      service.calculatePotentialSavings(
        [
          {
            id: 1,
            discountType: "percentage",
            discountValue: 0,
            discountPercentageBps: 2000,
            maxDiscountAmount: null,
            maxDiscountAmountCents: 1500,
            minOrderAmount: null,
          },
          {
            id: 2,
            discountType: "fixed_amount",
            discountValue: 0,
            discountValueCents: 12000,
            maxDiscountAmount: null,
            minOrderAmount: null,
          },
        ],
        100,
        "TWD",
      ),
    ).resolves.toEqual([
      { couponId: 1, saving: 15 },
      { couponId: 2, saving: 100 },
    ]);

    await expect(
      service.calculatePotentialSavings(
        [
          {
            id: 3,
            discountType: "percentage",
            discountValue: 0,
            discountPercentageBps: 1000,
            maxDiscountAmount: null,
            minOrderAmount: null,
          },
        ],
        80,
        "TWD",
      ),
    ).resolves.toEqual([{ couponId: 3, saving: 8 }]);
  });

  it("rounds potential savings to the currency's precision", async () => {
    const service = createService();
    const coupons = [
      {
        id: 4,
        discountType: "percentage",
        discountValue: 0,
        discountPercentageBps: 1500,
        maxDiscountAmount: null,
        minOrderAmount: null,
      },
    ];

    // 15% of 155: NT$23.25 → NT$23, RM23.25 stays.
    await expect(
      service.calculatePotentialSavings(coupons, 155, "TWD"),
    ).resolves.toEqual([{ couponId: 4, saving: 23 }]);
    await expect(
      service.calculatePotentialSavings(coupons, 155, "MYR"),
    ).resolves.toEqual([{ couponId: 4, saving: 23.25 }]);
  });

  it("aggregates coupon usage trends from db rows", async () => {
    const service = createService();
    const couponCounts = [{ totalCoupons: 4, activeCoupons: 2 }];
    const usageTotals = [{ totalUsage: 7, totalSavings: 35.5 }];
    const usageByPeriod = [
      { period: "2026-06-01", totalUsage: 3, totalSavings: 15 },
      { period: "2026-06-02", totalUsage: 4, totalSavings: 20.5 },
    ];
    const select = vi
      .fn()
      .mockReturnValueOnce(createSelectChain(couponCounts))
      .mockReturnValueOnce(createSelectChain(usageTotals))
      .mockReturnValueOnce(createSelectChain(usageByPeriod));
    Object.assign(service as unknown as { db: unknown }, {
      db: { select },
    });

    await expect(
      service.getCouponUsageTrends(
        "restaurant-1",
        "2026-06-01",
        "invalid-date",
      ),
    ).resolves.toEqual({
      totalCoupons: 4,
      activeCoupons: 2,
      totalUsage: 7,
      totalSavings: 35.5,
      usageByPeriod,
    });
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("aggregates usage trends with only an end date filter", async () => {
    const service = createService();
    const select = vi
      .fn()
      .mockReturnValueOnce(createSelectChain([]))
      .mockReturnValueOnce(createSelectChain([]))
      .mockReturnValueOnce(createSelectChain([]));
    Object.assign(service as unknown as { db: unknown }, {
      db: { select },
    });

    await expect(
      service.getCouponUsageTrends(undefined, undefined, "2026-06-30"),
    ).resolves.toEqual({
      totalCoupons: 0,
      activeCoupons: 0,
      totalUsage: 0,
      totalSavings: 0,
      usageByPeriod: [],
    });
    expect(select).toHaveBeenCalledTimes(3);
  });

  describe("useCouponForOrder", () => {
    const input = { couponId: 10, orderId: "order-1", userId: "user-1" };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("redeems an eligible coupon and records usage", async () => {
      const { service, useCoupon } = setupUseCouponService();

      await expect(service.useCouponForOrder(input)).resolves.toEqual({
        id: 77,
      });
      expect(useCoupon).toHaveBeenCalledOnce();
      expect(useCoupon).toHaveBeenCalledWith(
        expect.objectContaining({
          couponId: 10,
          orderId: "order-1",
          userId: "user-1",
          discountAmount: 10,
          originalAmount: 100,
          finalAmount: 90,
        }),
      );
    });

    it("rounds a redeemed percentage discount to the restaurant currency", async () => {
      for (const [currency, discountAmount] of [
        ["TWD", 23],
        ["MYR", 23.25],
      ] as const) {
        const { service, useCoupon } = setupUseCouponService({
          order: buildOrder({ subtotalCents: 15500 }),
          coupon: buildRedeemableCoupon({ discountPercentageBps: 1500 }),
          currency,
        });

        await service.useCouponForOrder(input);

        expect(useCoupon).toHaveBeenCalledWith(
          expect.objectContaining({
            discountAmount,
            originalAmount: 155,
            finalAmount: 155 - discountAmount,
          }),
        );
      }
    });

    it("redeems hidden-but-active coupons (isVisible is not enforced at redemption)", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ isVisible: false }),
      });

      await expect(service.useCouponForOrder(input)).resolves.toEqual({
        id: 77,
      });
      expect(useCoupon).toHaveBeenCalledOnce();
    });

    it("denies an inactive coupon", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ isActive: false }),
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_INACTIVE",
        status: 400,
      });
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("denies a soft-deleted coupon", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ deletedAt: new Date("2026-07-01") }),
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_NOT_FOUND",
        status: 404,
      });
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("denies a coupon before its validFrom date", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({
          validFrom: new Date("2026-08-01T00:00:00.000Z"),
        }),
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_NOT_STARTED",
        status: 400,
      });
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("denies a coupon after its validTo date", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({
          validTo: new Date("2026-06-30T00:00:00.000Z"),
        }),
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_EXPIRED",
        status: 400,
      });
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("denies an order below the minimum amount", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ minOrderAmountCents: 20000 }),
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_MIN_ORDER_NOT_MET",
        status: 400,
      });
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("denies a coupon whose advisory usage limit is exhausted", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ usageLimit: 5, usedCount: 5 }),
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_USAGE_LIMIT_REACHED",
        status: 409,
      });
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("maps an atomic claim failure (0 rows updated) to a conflict error", async () => {
      const { service, useCoupon } = setupUseCouponService();
      useCoupon.mockRejectedValueOnce(
        new CouponsService.EligibilityError(
          "COUPON_USAGE_LIMIT_REACHED",
          "Coupon usage limit reached",
        ),
      );

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_USAGE_LIMIT_REACHED",
        status: 409,
      });
      expect(useCoupon).toHaveBeenCalledOnce();
    });

    it("denies a user who reached the per-user limit", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ usageLimitPerUser: 1 }),
        userUsageCount: 1,
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_USER_LIMIT_REACHED",
        status: 409,
      });
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("denies a coupon that belongs to another restaurant", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ restaurantId: "restaurant-2" }),
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_WRONG_RESTAURANT",
        status: 403,
      });
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("denies a coupon when the order has no applicable items", async () => {
      const { service, select, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ applicableMenuItems: [99] }),
        orderItemRows: [{ menuItemId: 1, quantity: 2 }],
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_NOT_APPLICABLE",
        status: 400,
      });
      // 訂單 → 優惠券 → 訂單商品（只有設定了適用限制才查）
      expect(select).toHaveBeenCalledTimes(3);
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("excludes cancelled items when loading coupon eligibility items", async () => {
      const { service, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ applicableMenuItems: [99] }),
        orderItemRows: [
          { menuItemId: 99, quantity: 1, status: "cancelled" },
          { menuItemId: 1, quantity: 1, status: "pending" },
        ],
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_NOT_APPLICABLE",
        status: 400,
      });
      expect(useCoupon).not.toHaveBeenCalled();
    });

    it("denies a coupon when the order has no applicable categories", async () => {
      const { service, select, useCoupon } = setupUseCouponService({
        coupon: buildRedeemableCoupon({ applicableCategories: [99] }),
        orderItemRows: [{ menuItemId: 1, quantity: 2 }],
        itemCategoryRows: [{ category: { id: 7 } }],
      });

      await expect(service.useCouponForOrder(input)).rejects.toMatchObject({
        name: "ApiError",
        code: "COUPON_NOT_APPLICABLE",
        status: 400,
      });
      expect(select).toHaveBeenCalledTimes(3);
      expect(useCoupon).not.toHaveBeenCalled();
    });
  });

  it("claimUsageSlot throws a coded error when the conditional UPDATE claims no slot", async () => {
    const service = createService();
    const run = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    Object.assign(service as unknown as { d1: unknown }, { d1: { prepare } });

    await expect(service.claimUsageSlot(10)).rejects.toMatchObject({
      name: "CouponEligibilityError",
      code: "COUPON_USAGE_LIMIT_REACHED",
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(bind).toHaveBeenCalledWith(10);
  });

  it("rejects soft-deleted coupons in validateCoupon", async () => {
    const service = createService();
    const findFirst = vi
      .fn()
      .mockResolvedValue(
        buildRedeemableCoupon({ deletedAt: new Date("2026-07-01") }),
      );
    Object.assign(service as unknown as { db: unknown }, {
      db: { query: { coupons: { findFirst } } },
    });

    await expect(
      service.validateCoupon("SAVE10", "restaurant-1", 100, "user-1"),
    ).resolves.toEqual({
      valid: false,
      error: "優惠券代碼不存在或已失效",
    });
    expect(findFirst).toHaveBeenCalledOnce();
  });
});
