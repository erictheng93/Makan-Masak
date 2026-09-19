/**
 * Coupons Feature Service
 *
 * Business logic for coupon management and operations
 */

import {
  CouponService as BaseCouponService,
  couponDiscountCents,
} from "@makanmasak/database";
import { computeDiscountCents, type CurrencyCode } from "@makanmasak/utils";
import { coupons, couponUsage, orderItems, orders } from "@makanmasak/database";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../../shared/utils/api-error";
import {
  fromCents,
  percentageFromBps,
  toCents,
  toRequiredCents,
} from "../../../shared/utils/money";
import type {
  CreateCouponData,
  CouponFilters,
  CouponValidationResult,
  PaginatedCouponsResponse,
  CouponStats,
} from "../types";

interface AvailableCoupon {
  id: number;
  discountType: string;
  discountValue: number;
  discountPercentageBps?: number | null;
  discountValueCents?: number | null;
  maxDiscountAmount?: number | null;
  maxDiscountAmountCents?: number | null;
  minOrderAmount?: number | null;
  minOrderAmountCents?: number | null;
}

/**
 * Exactly what formatCouponMoneyFields reads.
 *
 * The constraint used to be AvailableCoupon, which also demands `id` and a
 * non-null `discountValue` — neither of which the formatter touches, and
 * `discountValue` is one of the three values it produces. Requiring the output
 * as input forced callers holding a database row to cast, and the cast erased
 * the row's own fields (`code`, `name`) from the result.
 */
interface CouponMoneyFields {
  discountType: string;
  discountPercentageBps?: number | null;
  discountValueCents?: number | null;
  maxDiscountAmountCents?: number | null;
  minOrderAmountCents?: number | null;
}

/** The three amounts the formatter derives from the cents columns. */
interface FormattedCouponMoney {
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number | null;
}

/**
 * One coupon exactly as the list endpoints return it: the row `getCoupons`
 * selects, plus the three amounts `formatCouponMoneyFields` derives. Derived
 * rather than restated so a schema change lands here as a compile error.
 */
export type FormattedCouponRow = Awaited<
  ReturnType<BaseCouponService["getCoupons"]>
>["coupons"][number] &
  FormattedCouponMoney;

interface CouponUsageByDay {
  date: string;
  usageCount: number;
  totalDiscount: number;
}

interface CouponTopUser {
  userId: string;
  username?: string | null;
  usageCount: number;
  totalDiscount: number;
}

interface CouponUsageTrendPoint {
  period: string;
  totalUsage: number;
  totalSavings: number;
}

// packages/database 不能 import API 層的 ApiError，因此基底服務擲出
// 帶穩定 code 的 CouponEligibilityError；在此統一轉譯成 ApiError，
// 讓路由層不需要再做字串比對的錯誤映射。
const CouponEligibilityError = BaseCouponService.EligibilityError;
const CouponDuplicateCodeError = BaseCouponService.DuplicateCodeError;
const CouponDistributionTargetError = BaseCouponService.DistributionTargetError;

function toCouponApiError(error: unknown): unknown {
  if (error instanceof CouponDuplicateCodeError) {
    return conflict(error.message, "COUPON_CODE_EXISTS");
  }

  // The preflight lookup gives a friendly answer in the usual case, while the
  // database constraint remains authoritative under concurrent creates.
  const uniqueCodeViolation = (value: unknown): boolean => {
    if (!(value instanceof Error)) return false;
    // 0013 replaced the single-column index with two partial ones, so SQLite
    // now reports "coupons.restaurant_id, coupons.code" for a tenant collision
    // and "coupons.code" for a platform one. Anchoring on the column rather
    // than the whole list catches both.
    if (
      /unique constraint failed:[^\n]*\bcoupons\.code\b/i.test(value.message)
    ) {
      return true;
    }
    return uniqueCodeViolation((value as Error & { cause?: unknown }).cause);
  };

  if (uniqueCodeViolation(error)) {
    return conflict("此優惠券代碼在本店已存在，請換一個", "COUPON_CODE_EXISTS");
  }

  if (!(error instanceof CouponEligibilityError)) {
    return error;
  }

  switch (error.code) {
    case "COUPON_NOT_FOUND":
    case "COUPON_NOT_VISIBLE":
      return notFound(error.message, "COUPON_NOT_FOUND");
    case "COUPON_WRONG_RESTAURANT":
      return forbidden(error.message, error.code);
    case "COUPON_ALREADY_USED":
    case "COUPON_USAGE_LIMIT_REACHED":
    case "COUPON_USER_LIMIT_REACHED":
      return conflict(error.message, error.code);
    default:
      return badRequest(error.message, error.code);
  }
}

export class CouponsService extends BaseCouponService {
  formatCouponMoneyFields<T extends CouponMoneyFields>(
    coupon: T,
  ): T & FormattedCouponMoney {
    const minOrderAmount = amountFromCents(coupon.minOrderAmountCents);
    const maxDiscountAmount = amountFromCents(coupon.maxDiscountAmountCents);
    const discountValue =
      coupon.discountType === "percentage"
        ? (percentageFromBps(coupon.discountPercentageBps) ?? 0)
        : (amountFromCents(coupon.discountValueCents) ?? 0);

    return {
      ...coupon,
      discountValue,
      maxDiscountAmount,
      minOrderAmount,
    };
  }

  /**
   * Enhanced coupon validation with business rules
   */
  async validateCouponWithBusinessRules(
    code: string,
    restaurantId: string,
    orderAmount: number,
    userId?: string,
    menuItems?: Array<{ menuItemId: number; quantity: number }>,
  ): Promise<CouponValidationResult> {
    // Use base validation
    const baseResult = await this.validateCoupon(
      code,
      restaurantId,
      orderAmount,
      userId,
      menuItems,
    );

    if (!baseResult.valid) {
      return baseResult;
    }

    // Additional business rules can be added here
    // For example: customer tier validation, geographic restrictions, etc.

    return baseResult;
  }

  /**
   * Get coupons with enhanced filtering and sorting
   */
  async getCouponsWithEnhancedFilters(
    filters: CouponFilters = {},
    page = 1,
    limit = 20,
    _sortBy = "createdAt",
    _sortOrder: "desc" | "asc" = "desc",
  ): Promise<PaginatedCouponsResponse<FormattedCouponRow>> {
    const result = await this.getCoupons(filters, page, limit);
    const couponList = result.coupons.map((coupon) =>
      this.formatCouponMoneyFields(coupon),
    );

    // Add pages calculation
    const pages = Math.ceil(result.total / result.limit);

    return {
      coupons: couponList,
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages,
    };
  }

  /**
   * Create coupon with duplicate check and validation
   */
  async createCouponWithValidation(
    data: CreateCouponData,
  ): ReturnType<BaseCouponService["createCoupon"]> {
    // Validate date range
    if (data.validFrom >= data.validTo) {
      throw badRequest("有效期結束時間必須晚於開始時間", "INVALID_DATE_RANGE");
    }

    // Validate discount value
    if (data.discountType === "percentage" && data.discountValue > 100) {
      throw badRequest("百分比折扣不能超過 100%", "INVALID_DISCOUNT_VALUE");
    }

    try {
      return await this.createCoupon(data);
    } catch (error) {
      throw toCouponApiError(error);
    }
  }

  /**
   * `code` is permitted by updateCouponSchema, so an edit can collide with an
   * existing code just as a create can. The
   * base method has no preflight lookup, which leaves the unique constraint
   * as the only signal -- and untranslated it sanitises to GENERIC_ERROR, so
   * the client sees a 500 plus a HIGH-severity Slack page instead of the 409
   * the dashboard already branches on.
   */
  override async updateCoupon(id: number, updates: Partial<CreateCouponData>) {
    try {
      return await super.updateCoupon(id, updates);
    } catch (error) {
      throw toCouponApiError(error);
    }
  }

  /**
   * Issue a coupon to an audience, mapping an unsupported target to a 400.
   *
   * "group" names a concept the schema has no table for; the data layer refuses
   * it rather than resolving to an empty audience and reporting a successful
   * distribution to nobody.
   */
  async distributeCouponToAudience(
    input: Parameters<BaseCouponService["distributeCoupon"]>[0],
  ): ReturnType<BaseCouponService["distributeCoupon"]> {
    try {
      return await this.distributeCoupon(input);
    } catch (error) {
      if (error instanceof CouponDistributionTargetError) {
        throw badRequest(error.message, error.code);
      }
      throw error;
    }
  }

  /**
   * Get comprehensive coupon statistics
   */
  async getComprehensiveCouponStats(couponId: number): Promise<
    CouponStats & {
      usageByDay: CouponUsageByDay[];
      topUsers: CouponTopUser[];
      averageOrderValue: number;
    }
  > {
    const baseStats = await this.getCouponStats(couponId);

    // Spelled out rather than spread, because every field can be absent and
    // the published contract is not: the aggregate row itself is optional, and
    // SUM/AVG over zero usage rows are NULL rather than 0 — the COALESCE in
    // the query only covers null amounts within a row, not the absence of
    // rows. A coupon nobody has redeemed has discounted nothing, so this says
    // 0 instead of handing consumers a null to guess at.
    // Additional analytics can be added here.
    return {
      totalUsed: baseStats?.totalUsed ?? 0,
      totalDiscount: baseStats?.totalDiscount ?? 0,
      avgDiscount: baseStats?.avgDiscount ?? 0,
      lastUsed: baseStats?.lastUsed ?? null,
      usageByDay: [],
      topUsers: [],
      averageOrderValue: 0,
    };
  }

  /**
   * Bulk coupon operations
   */
  async bulkActivateCoupons(
    couponIds: number[],
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const id of couponIds) {
      try {
        await this.updateCoupon(id, { isActive: true });
        success++;
      } catch (error) {
        failed++;
        console.error(`Failed to activate coupon ${id}:`, error);
      }
    }

    return { success, failed };
  }

  async bulkDeactivateCoupons(
    couponIds: number[],
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const id of couponIds) {
      try {
        await this.deactivateCoupon(id);
        success++;
      } catch (error) {
        failed++;
        console.error(`Failed to deactivate coupon ${id}:`, error);
      }
    }

    return { success, failed };
  }

  async bulkDeleteCoupons(
    couponIds: number[],
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const id of couponIds) {
      try {
        await this.deleteCoupon(id);
        success++;
      } catch (error) {
        failed++;
        console.error(`Failed to delete coupon ${id}:`, error);
      }
    }

    return { success, failed };
  }

  /**
   * Get available coupons for a specific user
   */
  async getAvailableCouponsForUser(
    restaurantId: string,
    userId?: string,
    orderAmount?: number,
  ): Promise<AvailableCoupon[]> {
    const availableCoupons = (
      await this.getAvailableCoupons(restaurantId, userId)
    ).map((coupon) => this.formatCouponMoneyFields(coupon));

    if (!orderAmount) {
      return availableCoupons;
    }

    // Filter by minimum order amount
    return availableCoupons.filter((coupon) => {
      const minOrderAmount = amountFromCents(coupon.minOrderAmountCents);

      return !minOrderAmount || orderAmount >= minOrderAmount;
    });
  }

  /**
   * Calculate potential savings for multiple coupons
   */
  async calculatePotentialSavings(
    coupons: AvailableCoupon[],
    orderAmount: number,
    currency: CurrencyCode,
  ): Promise<Array<{ couponId: number; saving: number }>> {
    const orderAmountCents = toRequiredCents(orderAmount);

    // Same rule as redemption (computeDiscountCents): rounded to the
    // currency's precision, then capped.
    return coupons.map((coupon) => {
      const normalizedCoupon = this.formatCouponMoneyFields(coupon);
      const isPercentage = normalizedCoupon.discountType === "percentage";
      const savingCents = computeDiscountCents(
        {
          discountType: normalizedCoupon.discountType,
          percent: isPercentage ? normalizedCoupon.discountValue : null,
          fixedCents: isPercentage
            ? null
            : toRequiredCents(normalizedCoupon.discountValue),
          maxDiscountCents: toCents(normalizedCoupon.maxDiscountAmount),
        },
        orderAmountCents,
        currency,
      );
      return { couponId: coupon.id, saving: fromCents(savingCents) };
    });
  }

  async useCouponForOrder(input: {
    couponId: number;
    orderId: string;
    userId?: string;
    allowedRestaurantId?: string;
  }) {
    const [order] = await this.db
      .select({
        id: orders.id,
        restaurantId: orders.restaurantId,
        subtotalCents: orders.subtotalCents,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);

    if (!order) {
      throw notFound("Order not found", "ORDER_NOT_FOUND");
    }

    if (
      input.allowedRestaurantId &&
      order.restaurantId !== input.allowedRestaurantId
    ) {
      throw forbidden("Access denied", "FORBIDDEN");
    }

    const [coupon] = await this.db
      .select()
      .from(coupons)
      .where(eq(coupons.id, input.couponId))
      .limit(1);

    if (!coupon) {
      throw notFound("Coupon not found", "COUPON_NOT_FOUND");
    }

    // 只有在優惠券設定了適用商品/分類限制時才載入訂單商品
    let orderMenuItems:
      | Array<{ menuItemId: number; quantity: number }>
      | undefined;
    if (coupon.applicableMenuItems || coupon.applicableCategories) {
      orderMenuItems = await this.db
        .select({
          menuItemId: orderItems.menuItemId,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.orderId, input.orderId),
            ne(orderItems.status, "cancelled"),
          ),
        );
    }

    const originalAmountCents = order.subtotalCents ?? 0;

    // 單一共享的資格檢查（與 /validate 同一份實作）：
    // 軟刪除、餐廳歸屬、啟用狀態、有效期、總量上限（advisory）、
    // 最低訂單金額、每用戶上限、適用商品/分類。
    // 兌換模式不強制 isVisible — 隱藏但啟用中的代碼可由收銀端兌換。
    try {
      await this.assertCouponRedeemable(coupon, {
        restaurantId: order.restaurantId,
        orderAmountCents: originalAmountCents,
        userId: input.userId,
        menuItems: orderMenuItems,
        mode: "redeem",
      });
    } catch (error) {
      throw toCouponApiError(error);
    }

    // The order's restaurant decides the precision: a TWD discount is whole
    // dollars, rounded first and then capped, as on every other coupon path.
    const discountAmountCents = couponDiscountCents(
      coupon,
      originalAmountCents,
      await this.getRestaurantCurrency(order.restaurantId),
    );
    const finalAmountCents = originalAmountCents - discountAmountCents;

    // useCoupon 內含重複使用檢查與 claimUsageSlot 的原子名額佔用；
    // 其擲出的 CouponEligibilityError（已用過/名額已滿）同樣轉譯為 ApiError。
    try {
      return await this.useCoupon({
        couponId: input.couponId,
        orderId: input.orderId,
        userId: input.userId,
        discountAmount: fromCents(discountAmountCents),
        originalAmount: fromCents(originalAmountCents),
        finalAmount: fromCents(finalAmountCents),
      });
    } catch (error) {
      throw toCouponApiError(error);
    }
  }

  /**
   * Get coupon usage trends
   */
  async getCouponUsageTrends(
    restaurantId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{
    totalCoupons: number;
    activeCoupons: number;
    totalUsage: number;
    totalSavings: number;
    usageByPeriod: CouponUsageTrendPoint[];
  }> {
    const nowMs = Date.now();
    const couponWhere = restaurantId
      ? sql`(${coupons.restaurantId} = ${restaurantId} OR ${coupons.restaurantId} IS NULL)`
      : undefined;
    const usageWhere = this.buildCouponUsageTrendWhere(
      restaurantId,
      startDate,
      endDate,
    );

    const [couponCounts, usageTotals, usageByPeriod] = await Promise.all([
      this.db
        .select({
          totalCoupons: sql<number>`count(*)`,
          activeCoupons: sql<number>`coalesce(sum(CASE
            WHEN ${coupons.isActive} = 1
              AND ${coupons.isVisible} = 1
              AND ${coupons.validFrom} <= ${nowMs}
              AND ${coupons.validTo} >= ${nowMs}
              AND (${coupons.usageLimit} IS NULL OR coalesce(${coupons.usedCount}, 0) < ${coupons.usageLimit})
            THEN 1 ELSE 0 END), 0)`,
        })
        .from(coupons)
        .where(couponWhere),
      this.db
        .select({
          totalUsage: sql<number>`count(${couponUsage.id})`,
          totalSavings: sql<number>`coalesce(sum(COALESCE(${couponUsage.discountAmountCents}, 0)), 0) / 100.0`,
        })
        .from(couponUsage)
        .innerJoin(coupons, eq(couponUsage.couponId, coupons.id))
        .where(usageWhere),
      this.db
        .select({
          period: sql<string>`date(${couponUsage.usedAt} / 1000, 'unixepoch')`,
          totalUsage: sql<number>`count(${couponUsage.id})`,
          totalSavings: sql<number>`coalesce(sum(COALESCE(${couponUsage.discountAmountCents}, 0)), 0) / 100.0`,
        })
        .from(couponUsage)
        .innerJoin(coupons, eq(couponUsage.couponId, coupons.id))
        .where(usageWhere)
        .groupBy(sql`date(${couponUsage.usedAt} / 1000, 'unixepoch')`)
        .orderBy(sql`date(${couponUsage.usedAt} / 1000, 'unixepoch') ASC`),
    ]);

    return {
      totalCoupons: couponCounts[0]?.totalCoupons ?? 0,
      activeCoupons: couponCounts[0]?.activeCoupons ?? 0,
      totalUsage: usageTotals[0]?.totalUsage ?? 0,
      totalSavings: usageTotals[0]?.totalSavings ?? 0,
      usageByPeriod,
    };
  }

  private buildCouponUsageTrendWhere(
    restaurantId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const conditions = [eq(couponUsage.status, "active")];

    if (restaurantId) {
      conditions.push(
        sql`(${coupons.restaurantId} = ${restaurantId} OR ${coupons.restaurantId} IS NULL)`,
      );
    }

    const start = parseDateFilter(startDate);
    if (start) {
      conditions.push(gte(couponUsage.usedAt, start));
    }

    const end = parseDateFilter(endDate);
    if (end) {
      conditions.push(lte(couponUsage.usedAt, end));
    }

    let where = conditions[0];
    for (const condition of conditions.slice(1)) {
      where = and(where, condition)!;
    }
    return where;
  }
}

function parseDateFilter(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function amountFromCents(
  cents: number | null | undefined,
  fallback?: number | null | undefined,
): number | null {
  return cents == null ? (fallback ?? null) : fromCents(cents);
}
