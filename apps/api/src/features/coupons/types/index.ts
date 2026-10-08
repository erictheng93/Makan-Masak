/**
 * Coupons Feature Types
 *
 * Type definitions for the coupons feature module
 */

import type {
  DiscountType,
  DistributionType,
  TargetType,
  UsageStatus,
} from "@makanmasak/database";

// 優惠券驗證結果接口
export interface CouponValidationResult {
  valid: boolean;
  coupon?: unknown;
  error?: string;
  discountAmount?: number;
  finalAmount?: number;
}

// 優惠券創建資料接口
export interface CreateCouponData {
  restaurantId?: string;
  code: string;
  name: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number;
  applicableMenuItems?: number[];
  applicableCategories?: number[];
  incompatibleCouponIds?: number[];
  usageLimit?: number | null;
  usageLimitPerUser?: number | null;
  /** INTEGER ms 欄位；zod 收 ISO 字串，路由邊界轉成 Date（#271） */
  validFrom: Date;
  validTo: Date;
  isActive?: boolean;
  isVisible?: boolean;
  createdBy?: string;
}

// 優惠券使用資料接口
export interface UseCouponData {
  couponId: number;
  orderId: string;
  userId?: string;
  discountAmount: number;
  originalAmount: number;
  finalAmount: number;
}

// 優惠券查詢過濾器
export interface CouponFilters {
  restaurantId?: string;
  isActive?: boolean;
  isVisible?: boolean;
  discountType?: DiscountType;
  status?: "active" | "expired" | "exhausted" | "inactive";
  validOnly?: boolean;
  search?: string;
}

// 優惠券統計數據
export interface CouponStats {
  totalUsed: number;
  totalDiscount: number;
  avgDiscount: number;
  lastUsed: string | null;
}

// 優惠券驗證請求
export interface ValidateCouponRequest {
  code: string;
  restaurantId: string;
  orderAmount: number;
  userId?: string;
  menuItems?: Array<{ menuItemId: number; quantity: number }>;
}

// 優惠券發放資料
export interface CouponDistributionData {
  couponId: number;
  distributionType: DistributionType;
  targetType?: TargetType;
  targetCriteria?: unknown;
  totalDistributed?: number;
  expiresAt?: string;
  notes?: string;
  createdBy?: string;
}

// 優惠券模板資料
export interface CouponTemplateData {
  restaurantId?: string;
  name: string;
  description?: string;
  templateData: unknown;
  isSystemTemplate?: boolean;
  createdBy?: string;
}

// 分頁響應
//
// Generic so a caller that knows its row shape can say so. The default keeps
// every existing consumer compiling unchanged; CouponsService passes the
// formatted row type it actually produces.
export interface PaginatedCouponsResponse<TCoupon = unknown> {
  coupons: TCoupon[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// API 響應基礎接口
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// 優惠券詳情響應
export interface CouponDetailsResponse extends ApiResponse {
  data: {
    coupon: {
      id: number;
      code: string;
      name: string;
      discountType: DiscountType;
      discountValue: number;
    };
    stats: CouponStats;
  };
}

export type { DiscountType, DistributionType, TargetType, UsageStatus };
