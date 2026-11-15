import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { coupons } from "@makanmasak/database";
import { moduleGate } from "../../../middleware/moduleGate";
import { ApiError, badRequest } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

/**
 * Whether `restaurantId`'s plan still includes the `coupons` module, decided by
 * the same gate the coupon routes use. Answers false for an unknown
 * restaurant; a region policy outage (503) still throws.
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
 * The `coupons` module governs a shop's own coupon programme, not the
 * platform's promotions (`coupons.restaurant_id IS NULL`). True when the shop
 * lacks the module and one of `codes` resolves to a live coupon the shop owns:
 * CouponService.validateCoupon prefers the shop's row over a platform row with
 * the same code, so such a code would apply the shop's coupon.
 */
export async function refusesShopCoupons(
  env: Pick<Env, "DB" | "CACHE_KV">,
  restaurantId: string,
  codes: readonly string[],
): Promise<boolean> {
  if (codes.length === 0) return false;
  if (await couponsModuleEnabled(env, restaurantId)) return false;
  const owned = await drizzle(env.DB)
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        inArray(
          coupons.code,
          codes.map((code) => code.trim().toUpperCase()),
        ),
        eq(coupons.restaurantId, restaurantId),
        isNull(coupons.deletedAt),
      ),
    )
    .limit(1);
  return owned.length > 0;
}

/**
 * Refuse a shop's own coupon on a new order at a shop without the `coupons`
 * module, with the COUPON_INVALID answer checkout already explains to diners.
 * The order service never consults the plan, so every route handing it coupon
 * codes calls this first.
 */
export async function assertOrderCouponsAllowed(
  env: Pick<Env, "DB" | "CACHE_KV">,
  restaurantId: string,
  codes: readonly string[],
): Promise<void> {
  if (await refusesShopCoupons(env, restaurantId, codes)) {
    throw badRequest(
      "優惠券驗證失敗: 此餐廳目前不提供優惠券",
      "COUPON_INVALID",
    );
  }
}
