import { moduleGate } from "../../../middleware/moduleGate";
import { ApiError, badRequest } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

/**
 * Whether `restaurantId`'s plan still includes the `coupons` module, decided by
 * the same gate the coupon routes use. Checkout paths call this before applying
 * a code, so a shop that dropped the module stops honouring coupons it can no
 * longer see or manage. Answers false for an unknown restaurant; a region
 * policy outage (503) still throws.
 */
export async function couponsModuleEnabled(
  env: Pick<Env, "DB" | "CACHE_KV">,
  restaurantId: string,
): Promise<boolean> {
  // No user on the context: gate on the restaurant named, not on the caller's.
  const context = { env, get: () => undefined };
  try {
    await moduleGate("coupons", () => restaurantId)(
      context as never,
      async () => {},
    );
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return false;
    throw error;
  }
}

/**
 * Refuse a coupon on a new order at a shop without the `coupons` module, with
 * the COUPON_INVALID answer checkout already explains to diners. The order
 * service itself never consults the plan, so every route handing it coupon
 * codes calls this first.
 */
export async function assertOrderCouponsAllowed(
  env: Pick<Env, "DB" | "CACHE_KV">,
  restaurantId: string,
  hasCoupon: boolean,
): Promise<void> {
  if (hasCoupon && !(await couponsModuleEnabled(env, restaurantId))) {
    throw badRequest(
      "優惠券驗證失敗: 此餐廳目前不提供優惠券",
      "COUPON_INVALID",
    );
  }
}
