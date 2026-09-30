/** POS promotions are the same electronic coupons used by customer checkout. */
import { Hono } from "hono";
import {
  authMiddleware,
  requireRole,
  type AuthUser,
} from "../../../middleware/auth";
import { moduleGate } from "../../../middleware/moduleGate";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../../middleware/validation";
import {
  badRequest,
  forbidden,
  notFound,
} from "../../../shared/utils/api-error";
import { CouponsService } from "../../coupons/services/CouponsService";
import {
  createCouponSchema,
  updateCouponSchema,
  couponFiltersSchema,
  idParamSchema,
  type CreateCouponInput,
  type UpdateCouponInput,
} from "../../coupons/schemas/validation";
import type { Env } from "../../../types/env";

const app = new Hono<{ Bindings: Env }>();
app.use("*", authMiddleware, moduleGate("coupons"));

function restaurantScope(user: AuthUser, requested?: string): string {
  const restaurantId =
    requested ??
    (user.restaurantId == null ? undefined : String(user.restaurantId));
  if (!restaurantId) throw badRequest("需要指定餐廳ID");
  if (user.role !== 0 && restaurantId !== String(user.restaurantId))
    throw forbidden("只能管理自己餐廳的促銷");
  return restaurantId;
}

function couponData(input: CreateCouponInput | UpdateCouponInput) {
  const { validFrom, validTo, ...data } = input;
  return {
    ...data,
    ...(validFrom === undefined ? {} : { validFrom: new Date(validFrom) }),
    ...(validTo === undefined ? {} : { validTo: new Date(validTo) }),
  };
}

async function ownedCoupon(
  service: CouponsService,
  user: AuthUser,
  id: number,
) {
  const coupon = await service.getCoupon(id);
  if (!coupon) throw notFound("促銷不存在");
  if (user.role !== 0 && coupon.restaurantId !== String(user.restaurantId))
    throw forbidden("只能管理自己餐廳的促銷");
  return coupon;
}

app.get(
  "/",
  requireRole([0, 1, 4]),
  validateQuery(couponFiltersSchema),
  async (c) => {
    const user = c.get("user");
    const { restaurantId, page, limit } = c.get("validatedQuery");
    const service = new CouponsService(c.env.DB, c.env);
    const result = await service.getCouponsWithEnhancedFilters(
      {
        restaurantId: restaurantScope(user, restaurantId),
        ...(user.role === 4
          ? { isVisible: true, status: "active" as const }
          : {}),
      },
      page,
      limit,
    );
    return c.json({
      success: true,
      data: {
        promotions: result.coupons,
        pagination: { page: result.page, pages: result.pages },
      },
    });
  },
);

app.post(
  "/",
  requireRole([0, 1]),
  validateBody(createCouponSchema),
  async (c) => {
    const input = c.get("validatedBody") as CreateCouponInput;
    if (input.discountType === "percentage" && input.discountValue > 100)
      throw badRequest("百分比折扣不能超過 100%");
    const service = new CouponsService(c.env.DB, c.env);
    const coupon = await service.createCouponWithValidation({
      ...input,
      restaurantId: restaurantScope(c.get("user"), input.restaurantId),
      createdBy: c.get("user").id,
      validFrom: new Date(input.validFrom),
      validTo: new Date(input.validTo),
    });
    return c.json(
      { success: true, data: service.formatCouponMoneyFields(coupon) },
      201,
    );
  },
);

app.put(
  "/:id",
  requireRole([0, 1]),
  validateParams(idParamSchema),
  validateBody(updateCouponSchema),
  async (c) => {
    const service = new CouponsService(c.env.DB, c.env);
    const { id } = c.get("validatedParams");
    const current = await ownedCoupon(service, c.get("user"), id);
    const input = c.get("validatedBody") as UpdateCouponInput;
    const data = couponData(input);
    if (
      (data.validFrom ?? current.validFrom) >= (data.validTo ?? current.validTo)
    )
      throw badRequest("有效期結束時間必須晚於開始時間");
    const coupon = await service.updateCoupon(id, data);
    if (!coupon) throw notFound("促銷不存在");
    return c.json({
      success: true,
      data: service.formatCouponMoneyFields(coupon),
    });
  },
);

app.delete(
  "/:id",
  requireRole([0, 1]),
  validateParams(idParamSchema),
  async (c) => {
    const service = new CouponsService(c.env.DB, c.env);
    const { id } = c.get("validatedParams");
    await ownedCoupon(service, c.get("user"), id);
    await service.deleteCoupon(id);
    return c.json({ success: true });
  },
);

export default app;
