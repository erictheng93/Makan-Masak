import { resolveGuestCouponIdentity } from "../../guest-orders/services/guest-coupon-identity";
/**
 * Coupons Feature Routes
 *
 * Modular route handlers for coupon management
 */

import { Hono } from "hono";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import { moduleGate } from "../../../middleware/moduleGate";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../middleware/validation";
import { CouponsService } from "../services/CouponsService";
import {
  validateCouponSchema,
  createCouponSchema,
  updateCouponSchema,
  couponFiltersSchema,
  idParamSchema,
  restaurantIdParamSchema,
  bulkActionSchema,
  useCouponSchema,
  distributeCouponSchema,
  type BulkActionInput,
  type DistributeCouponInput,
  type CouponFiltersInput,
  type CreateCouponInput,
  type IdParamInput,
  type RestaurantIdParamInput,
  type UpdateCouponInput,
  type UseCouponInput,
  type ValidateCouponInput,
} from "../schemas/validation";
import type { Env } from "../../../types/env";
import {
  notFound,
  forbidden,
  badRequest,
} from "../../../shared/utils/api-error";
import type { CouponFilters, CreateCouponData } from "../types";

const routes = new Hono<{ Bindings: Env }>();

function createCouponsService(env: Env): CouponsService {
  return new CouponsService(env.DB, env);
}

function userRestaurantId(user: { restaurantId?: string | number }): string {
  return String(user.restaurantId);
}

function toCouponFilters(input: CouponFiltersInput): CouponFilters {
  const { page: _page, limit: _limit, ...filters } = input;
  return filters;
}

/**
 * The wire carries ISO-8601 strings (`z.iso.datetime()`); `coupons.valid_from_ms`
 * is INTEGER ms. This boundary is where the two meet -- keeping the conversion
 * here means every comparison downstream, in JS and in SQL alike, is numeric
 * rather than lexicographic (#271).
 */
function toCreateCouponData(input: CreateCouponInput): CreateCouponData {
  const { validFrom, validTo, ...rest } = input;
  return {
    ...rest,
    validFrom: new Date(validFrom),
    validTo: new Date(validTo),
  };
}

function toUpdateCouponData(
  input: UpdateCouponInput,
): Partial<CreateCouponData> {
  const { validFrom, validTo, ...rest } = input;
  return {
    ...rest,
    ...(validFrom === undefined ? {} : { validFrom: new Date(validFrom) }),
    ...(validTo === undefined ? {} : { validTo: new Date(validTo) }),
  };
}

/**
 * 驗證優惠券代碼
 * POST /api/v1/coupons/validate
 * 公開端點，用於前端驗證優惠券
 */
routes.post("/validate", validateBody(validateCouponSchema), async (c) => {
  const data = c.get("validatedBody") as ValidateCouponInput;
  const couponsService = createCouponsService(c.env);

  const result = await couponsService.validateCouponWithBusinessRules(
    data.code,
    data.restaurantId,
    data.orderAmount,
    data.userId,
    data.menuItems,
    data.userId ? undefined : await resolveGuestCouponIdentity(c.req),
  );

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * 獲取可用優惠券列表 (供客戶使用)
 * GET /api/v1/coupons/available/:restaurantId
 */
routes.get(
  "/available/:restaurantId",
  validateParams(restaurantIdParamSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedParams") as RestaurantIdParamInput;
    const couponsService = createCouponsService(c.env);

    const availableCoupons =
      await couponsService.getAvailableCouponsForUser(restaurantId);

    return c.json({
      success: true,
      data: availableCoupons,
    });
  },
);

/**
 * 創建優惠券 (管理員和店主)
 * POST /api/v1/coupons
 */
routes.post(
  "/",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]), // 管理員和店主
  validateBody(createCouponSchema),
  async (c) => {
    const data = toCreateCouponData(
      c.get("validatedBody") as CreateCouponInput,
    );
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    // 權限檢查：店主只能為自己的餐廳創建優惠券
    if (user.role === 1) {
      data.restaurantId = userRestaurantId(user);
    }

    // 設置創建者
    data.createdBy = user.id;

    const coupon = await couponsService.createCouponWithValidation(data);

    return c.json(
      {
        success: true,
        data: coupon,
      },
      201,
    );
  },
);

/**
 * 獲取優惠券列表 (管理功能)
 * GET /api/v1/coupons
 */
routes.get(
  "/",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]), // 管理員和店主
  validateQuery(couponFiltersSchema),
  async (c) => {
    const query = c.get("validatedQuery") as CouponFiltersInput;
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    const filters: CouponFilters = toCouponFilters(query);

    // 權限過濾：店主只能查看自己餐廳的優惠券
    if (user.role === 1) {
      filters.restaurantId = userRestaurantId(user);
    }

    const result = await couponsService.getCouponsWithEnhancedFilters(
      filters,
      query.page,
      query.limit,
    );

    return c.json({
      success: true,
      data: result.coupons,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        pages: result.pages,
      },
    });
  },
);

/**
 * 獲取優惠券彙總統計
 * GET /api/v1/coupons/stats/summary
 */
routes.get(
  "/stats/summary",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]),
  async (c) => {
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    const restaurantId = user.role === 1 ? userRestaurantId(user) : undefined;
    const stats = await couponsService.getCouponSummaryStats(restaurantId);

    return c.json({
      success: true,
      data: stats,
    });
  },
);

/**
 * 獲取單個優惠券詳情
 * GET /api/v1/coupons/:id
 */
routes.get(
  "/:id",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]), // 管理員和店主
  validateParams(idParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    const coupon = await couponsService.getCoupon(id);

    if (!coupon) {
      throw notFound("Coupon not found");
    }

    // 權限檢查：店主只能查看自己餐廳的優惠券
    if (
      user.role === 1 &&
      String(coupon.restaurantId) !== userRestaurantId(user)
    ) {
      throw forbidden("Access denied");
    }

    return c.json({
      success: true,
      data: couponsService.formatCouponMoneyFields(coupon),
    });
  },
);

/**
 * 更新優惠券
 * PUT /api/v1/coupons/:id
 */
routes.put(
  "/:id",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]), // 管理員和店主
  validateParams(idParamSchema),
  validateBody(updateCouponSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const data = toUpdateCouponData(
      c.get("validatedBody") as UpdateCouponInput,
    );
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    // 獲取現有優惠券
    const existingCoupon = await couponsService.getCoupon(id);

    if (!existingCoupon) {
      throw notFound("Coupon not found");
    }

    // 權限檢查：店主只能更新自己餐廳的優惠券
    if (
      user.role === 1 &&
      String(existingCoupon.restaurantId) !== userRestaurantId(user)
    ) {
      throw forbidden("Access denied");
    }

    const updatedCoupon = await couponsService.updateCoupon(id, data);

    // The existence check above and this UPDATE are two statements: a coupon
    // deleted in between leaves nothing to return, and formatting undefined
    // would answer 500 where 404 is the truth.
    if (!updatedCoupon) {
      throw notFound("Coupon not found");
    }

    return c.json({
      success: true,
      data: couponsService.formatCouponMoneyFields(updatedCoupon),
    });
  },
);

/**
 * 停用優惠券
 * POST /api/v1/coupons/:id/deactivate
 */
routes.post(
  "/:id/deactivate",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]), // 管理員和店主
  validateParams(idParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    // 獲取現有優惠券
    const existingCoupon = await couponsService.getCoupon(id);

    if (!existingCoupon) {
      throw notFound("Coupon not found");
    }

    // 權限檢查：店主只能停用自己餐廳的優惠券
    if (
      user.role === 1 &&
      String(existingCoupon.restaurantId) !== userRestaurantId(user)
    ) {
      throw forbidden("Access denied");
    }

    const deactivatedCoupon = await couponsService.deactivateCoupon(id);

    if (!deactivatedCoupon) {
      throw notFound("Coupon not found");
    }

    return c.json({
      success: true,
      data: couponsService.formatCouponMoneyFields(deactivatedCoupon),
      message: "Coupon deactivated successfully",
    });
  },
);

/**
 * 刪除優惠券
 * DELETE /api/v1/coupons/:id
 */
routes.delete(
  "/:id",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0]), // 僅管理員
  validateParams(idParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const couponsService = createCouponsService(c.env);

    // 檢查優惠券是否存在
    const existingCoupon = await couponsService.getCoupon(id);

    if (!existingCoupon) {
      throw notFound("Coupon not found");
    }

    await couponsService.deleteCoupon(id);

    return c.json({
      success: true,
      message: "Coupon deleted successfully",
    });
  },
);

/**
 * 獲取優惠券使用統計
 * GET /api/v1/coupons/:id/stats
 */
routes.get(
  "/:id/stats",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]), // 管理員和店主
  validateParams(idParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    // 獲取優惠券資訊
    const coupon = await couponsService.getCoupon(id);

    if (!coupon) {
      throw notFound("Coupon not found");
    }

    // 權限檢查：店主只能查看自己餐廳的優惠券統計
    if (
      user.role === 1 &&
      String(coupon.restaurantId) !== userRestaurantId(user)
    ) {
      throw forbidden("Access denied");
    }

    const stats = await couponsService.getComprehensiveCouponStats(id);
    const formattedCoupon = couponsService.formatCouponMoneyFields(coupon);

    return c.json({
      success: true,
      data: {
        coupon: {
          id: formattedCoupon.id,
          code: formattedCoupon.code,
          name: formattedCoupon.name,
          discountType: formattedCoupon.discountType,
          discountValue: formattedCoupon.discountValue,
        },
        stats,
      },
    });
  },
);

/**
 * 批量操作優惠券
 * POST /api/v1/coupons/bulk
 */
routes.post(
  "/bulk",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]), // 管理員和店主
  validateBody(bulkActionSchema),
  async (c) => {
    const { couponIds, action } = c.get("validatedBody") as BulkActionInput;
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    // 權限檢查：店主只能操作自己餐廳的優惠券
    if (user.role === 1) {
      // Check if all coupons belong to the user's restaurant
      for (const id of couponIds) {
        const coupon = await couponsService.getCoupon(id);
        if (!coupon || String(coupon.restaurantId) !== userRestaurantId(user)) {
          throw forbidden("Access denied for one or more coupons");
        }
      }
    }

    let result: { success: number; failed: number };

    switch (action) {
      case "activate":
        result = await couponsService.bulkActivateCoupons(couponIds);
        break;
      case "deactivate":
        result = await couponsService.bulkDeactivateCoupons(couponIds);
        break;
      case "delete":
        if (user.role !== 0) {
          throw forbidden("Only administrators can delete coupons");
        }
        result = await couponsService.bulkDeleteCoupons(couponIds);
        break;
      default:
        throw badRequest("Invalid action");
    }

    return c.json({
      success: true,
      data: result,
      message: `Bulk ${action} completed. Success: ${result.success}, Failed: ${result.failed}`,
    });
  },
);

/**
 * 記錄優惠券使用 (內部 API)
 * POST /api/v1/coupons/use
 */
routes.post(
  "/use",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1, 4]),
  validateBody(useCouponSchema),
  async (c) => {
    const data = c.get("validatedBody") as UseCouponInput;
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    // 所有資格/限制錯誤都由 CouponsService 以 ApiError 擲出
    // （帶穩定 code，如 COUPON_INACTIVE、COUPON_USAGE_LIMIT_REACHED），
    // 交給全域錯誤處理器輸出統一格式。
    const usageRecord = await couponsService.useCouponForOrder({
      couponId: data.couponId,
      orderId: data.orderId,
      userId: data.userId ?? user.id,
      allowedRestaurantId: user.role === 0 ? undefined : userRestaurantId(user),
    });

    return c.json({
      success: true,
      data: usageRecord,
    });
  },
);

/**
 * 獲取優惠券使用趨勢
 * GET /api/v1/coupons/analytics/trends
 */
routes.get(
  "/analytics/trends",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]), // 管理員和店主
  async (c) => {
    const user = c.get("user");
    const { restaurantId, startDate, endDate } = c.req.query();
    const couponsService = createCouponsService(c.env);

    // 權限檢查：店主只能查看自己餐廳的數據
    if (
      user.role === 1 &&
      restaurantId != null &&
      restaurantId !== userRestaurantId(user)
    ) {
      throw forbidden("Access denied");
    }

    const queryRestaurantId =
      user.role === 1 ? userRestaurantId(user) : restaurantId;

    const trends = await couponsService.getCouponUsageTrends(
      queryRestaurantId,
      startDate,
      endDate,
    );

    return c.json({
      success: true,
      data: trends,
    });
  },
);

/**
 * Issue a coupon to an audience.
 * POST /api/v1/coupons/:id/distribute
 *
 * The tables for this (coupon_distributions, user_coupons) existed with no
 * route and no UI, so the documented "建立 · 發放" flow only ever did the first
 * half (#269).
 */
routes.post(
  "/:id/distribute",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]),
  validateParams(idParamSchema),
  validateBody(distributeCouponSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const body = c.get("validatedBody") as DistributeCouponInput;
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    const coupon = await couponsService.getCoupon(id);
    if (!coupon) {
      throw notFound("Coupon not found");
    }
    // Same shape as every other single-coupon guard here: an owner may only
    // reach their own restaurant's coupons.
    if (
      user.role === 1 &&
      String(coupon.restaurantId) !== userRestaurantId(user)
    ) {
      throw forbidden("Access denied");
    }
    // Stated positively rather than left to the comparison above. A platform
    // coupon's audience is every customer on the platform, so this is the one
    // route where "not my restaurant" and "everyone's restaurant" differ in
    // consequence -- and the comparison only refuses it because
    // `String(undefined) !== "null"`, a coincidence of how an owner without a
    // restaurant stringifies (auth.ts normalises a null claim to undefined).
    if (coupon.restaurantId == null && user.role !== 0) {
      throw forbidden("Access denied");
    }

    const result = await couponsService.distributeCouponToAudience({
      couponId: id,
      distributionType: body.distributionType,
      targetType: body.targetType,
      targetCriteria: body.targetCriteria,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      notes: body.notes ?? null,
      createdBy: String(user.id),
    });

    return c.json({ success: true, data: result }, 201);
  },
);

/**
 * Distribution history for one coupon.
 * GET /api/v1/coupons/:id/distributions
 */
routes.get(
  "/:id/distributions",
  authMiddleware,
  moduleGate("coupons"),
  requireRole([0, 1]),
  validateParams(idParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const user = c.get("user");
    const couponsService = createCouponsService(c.env);

    const coupon = await couponsService.getCoupon(id);
    if (!coupon) {
      throw notFound("Coupon not found");
    }
    if (
      user.role === 1 &&
      String(coupon.restaurantId) !== userRestaurantId(user)
    ) {
      throw forbidden("Access denied");
    }

    const distributions = await couponsService.getCouponDistributions(id);
    return c.json({ success: true, data: distributions });
  },
);

export default routes;
