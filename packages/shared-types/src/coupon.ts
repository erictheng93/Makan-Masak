/**
 * Coupon shared types
 *
 * Frontend-facing types for coupon entities and statistics.
 */

export type DiscountType = "percentage" | "fixed";

/** Coupon entity as returned by the API list/detail endpoints */
export interface AppliedCoupon {
  couponId: number;
  code: string;
  name: string;
  discountAmount: number;
}

export interface Coupon {
  restaurantId?: string | null;
  incompatibleCouponIds?: number[];
  id: number;
  code: string;
  name: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount?: number;
  minOrderAmount: number;
  usageLimit?: number;
  usageLimitPerUser?: number;
  usedCount: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  isVisible: boolean;
  createdAt: string;
}

/** Summary stats for the coupon list view (all coupons) */
export interface CouponsSummary {
  total: number;
  active: number;
  totalUsed: number;
  totalSavings: number;
}

/** Stats for an individual coupon (from /coupons/:id/stats) */
export interface CouponDetailStats {
  totalUsed: number;
  totalDiscount: number;
  avgDiscount: number;
  lastUsed?: string;
}
