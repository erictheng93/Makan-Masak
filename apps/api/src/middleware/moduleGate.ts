/**
 * Module Gate Middleware
 *
 * Enforces per-restaurant module access based on their subscription.
 * - Admin (role 0) bypasses the gate unconditionally.
 * - Results are cached in KV for 5 minutes to avoid DB round-trips on every request.
 * - The cache is invalidated when an admin updates a subscription.
 *
 * Usage:
 *   router.get('/kitchen', authMiddleware, moduleGate('kitchen_display'), handler)
 */

import { Context, Next } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Env } from "../types/env";
import { forbidden } from "../shared/utils/api-error";
import {
  shopSubscriptions,
  restaurants,
  PLAN_DEFAULT_MODULES,
  type ModuleKey,
  type ModuleMap,
  type PlanTier,
} from "@makanmasak/database";
import {
  normalizeCountryCode,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import {
  requirePolicy,
  resolveRegionPolicies,
} from "../shared/policy/regionPolicies";

// KV cache TTL: 5 minutes.  Short enough to make kill-switch effective quickly.
export const CACHE_TTL_SECONDS = 300;

export interface CachedSubscription {
  isActive: boolean;
  planTier: PlanTier;
  moduleOverrides: ModuleMap;
  trialEndsAt: number | null;
  /** Older KV entries omit this field and are treated as country unknown. */
  countryCode?: SupportedCountryCode | null;
}

/** Single definition of the KV cache key shape shared by every reader/writer. */
export function subscriptionCacheKey(restaurantId: string): string {
  return `subscription:${restaurantId}`;
}

/** Returns the effective access state for a single module given the subscription. */
function resolveModule(sub: CachedSubscription, module: ModuleKey): boolean {
  if (!sub.isActive) return false;

  // Check trial expiry
  if (sub.planTier === "trial" && sub.trialEndsAt !== null) {
    if (Date.now() > sub.trialEndsAt) return false;
  }

  // Override takes priority over plan default
  const override = sub.moduleOverrides[module];
  if (override !== undefined) return override;

  // Fall back to plan default
  return PLAN_DEFAULT_MODULES[sub.planTier][module] ?? false;
}

/**
 * Fetch subscription from KV cache, falling back to DB.
 * Writes through to KV on a cache miss.
 */
export async function loadCachedSubscription(
  env: Pick<Env, "DB" | "CACHE_KV">,
  restaurantId: string,
): Promise<CachedSubscription | null> {
  const cacheKey = subscriptionCacheKey(restaurantId);

  const cached = await env.CACHE_KV.get<CachedSubscription>(cacheKey, "json");
  if (cached) return cached;

  const db = drizzle(env.DB);
  const [row] = await db
    .select({
      isActive: shopSubscriptions.isActive,
      planTier: shopSubscriptions.planTier,
      moduleOverrides: shopSubscriptions.moduleOverrides,
      trialEndsAt: shopSubscriptions.trialEndsAt,
    })
    .from(shopSubscriptions)
    .where(eq(shopSubscriptions.restaurantId, restaurantId))
    .limit(1);

  if (!row) return null;

  const [restaurant] = await db
    .select({ countryCode: restaurants.countryCode })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const sub: CachedSubscription = {
    isActive: row.isActive,
    planTier: row.planTier as PlanTier,
    moduleOverrides: (row.moduleOverrides ?? {}) as ModuleMap,
    trialEndsAt: row.trialEndsAt ? row.trialEndsAt.getTime() : null,
    countryCode: normalizeCountryCode(restaurant?.countryCode),
  };

  await env.CACHE_KV.put(cacheKey, JSON.stringify(sub), {
    expirationTtl: CACHE_TTL_SECONDS,
  });

  return sub;
}

/** 國家層關閉的模組；國別不明時是空集合。資料無效或讀取失敗丟 503。 */
export async function regionDisabledModules(
  env: Pick<Env, "DB" | "CACHE_KV">,
  sub: CachedSubscription,
): Promise<ReadonlySet<ModuleKey>> {
  const effective = await resolveRegionPolicies(env, {
    countryCode: sub.countryCode ?? null,
  });
  requirePolicy(effective, "modules.disabled");
  return effective.modulesDisabled;
}

/**
 * Invalidate the subscription cache for a restaurant.
 *
 * This is the core entry point: it only needs the `CACHE_KV` binding, so it
 * works from any context that holds an `Env` — cron jobs, webhook handlers,
 * and plain services that only have `this.env`, none of which have a Hono
 * `Context` to call `invalidateSubscriptionCache(c, ...)` with.
 *
 * Call this after any write (admin, billing webhook, cron job, etc.) that
 * changes `shop_subscriptions.is_active`, `plan_tier`, or `module_overrides`.
 */
export async function invalidateSubscriptionCacheForEnv(
  env: Pick<Env, "CACHE_KV">,
  restaurantId: string,
): Promise<void> {
  await env.CACHE_KV.delete(subscriptionCacheKey(restaurantId));
}

/**
 * Context-taking convenience wrapper around {@link invalidateSubscriptionCacheForEnv}.
 * Call this after any admin update to subscription/modules made from a route handler.
 */
export async function invalidateSubscriptionCache(
  c: Context<{ Bindings: Env }>,
  restaurantId: string,
): Promise<void> {
  await invalidateSubscriptionCacheForEnv(c.env, restaurantId);
}

/**
 * Module gate middleware factory.
 *
 * @param module - The ModuleKey that the route requires
 *
 * @example
 *   router.get('/display', authMiddleware, moduleGate('kitchen_display'), handler)
 */
export function moduleGate(
  module: ModuleKey,
  resolveGuestRestaurantId?: (
    c: Context<{ Bindings: Env }>,
  ) => string | undefined | Promise<string | undefined>,
) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const user = c.get("user");

    // Admins bypass all module gates
    if (user?.role === 0) {
      await next();
      return;
    }

    const restaurantId =
      user?.restaurantId == null
        ? await resolveGuestRestaurantId?.(c)
        : String(user.restaurantId);

    if (!restaurantId) {
      throw forbidden(
        "No restaurant associated with this account",
        "NO_RESTAURANT",
      );
    }

    const sub = await loadCachedSubscription(c.env, restaurantId);

    if (!sub) {
      // No subscription record means the restaurant hasn't been onboarded yet
      throw forbidden(
        "Subscription not found. Please contact support.",
        "SUBSCRIPTION_NOT_FOUND",
      );
    }

    if (!resolveModule(sub, module)) {
      const isTrialExpired =
        sub.planTier === "trial" &&
        sub.trialEndsAt !== null &&
        Date.now() > sub.trialEndsAt;

      throw forbidden(
        isTrialExpired
          ? "Trial period has ended. Please upgrade your plan."
          : "This feature is not included in your current plan.",
        isTrialExpired ? "TRIAL_EXPIRED" : "MODULE_NOT_ENABLED",
      );
    }

    // 地區政策是上限：國家關掉的模組，方案與單店覆寫都開不起來。
    if ((await regionDisabledModules(c.env, sub)).has(module)) {
      throw forbidden(
        "This feature is not available in your region.",
        "MODULE_NOT_AVAILABLE_IN_REGION",
      );
    }

    await next();
  };
}
