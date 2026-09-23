/**
 * Regional policy checks used by execution points in the spec §6 table.
 * Ceiling policies fail closed with 503 when unavailable or invalid; pricing
 * defaults fall back to the current value of 0 when unavailable.
 */
import {
  EMPTY_REGION_POLICIES,
  type NativePaymentProvider,
  type PaidPlanTier,
  type PlanTier,
} from "@makanmasak/database";
import type { SupportedCountryCode } from "@makanmasak/shared-types";
import { ApiError } from "../utils/api-error";
import {
  marketIdBySlug,
  policyUnavailable,
  requirePolicy,
  resolveRegionPolicies,
  restaurantCountryCode,
  type RegionPolicyDeps,
} from "./regionPolicies";

async function lookup<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw policyUnavailable(error);
  }
}

/** New connections, re-enables, and charges only; never call for refunds or lookups. */
export async function assertPaymentProviderAllowed(
  deps: RegionPolicyDeps,
  input: {
    restaurantId: string;
    provider: NativePaymentProvider;
    marketSlug?: string | null;
  },
): Promise<void> {
  const [countryCode, marketId] = await lookup(() =>
    Promise.all([
      restaurantCountryCode(deps.DB, input.restaurantId),
      input.marketSlug ? marketIdBySlug(deps.DB, input.marketSlug) : null,
    ]),
  );
  if (input.marketSlug && !marketId) {
    // Skipping an unknown checkout market would fail open on its policy layer.
    throw policyUnavailable(
      new Error("market " + input.marketSlug + " not found"),
    );
  }
  const effective = await resolveRegionPolicies(deps, {
    countryCode,
    marketId,
  });
  requirePolicy(effective, "payments.allowed_providers");
  if (
    effective.allowedProviders &&
    !effective.allowedProviders.has(input.provider)
  ) {
    throw new ApiError(
      "PAYMENT_PROVIDER_NOT_ALLOWED",
      input.provider + " is not available in this region",
      403,
      { provider: input.provider },
    );
  }
}
export async function assertPlanTierAllowed(
  deps: RegionPolicyDeps,
  input: { restaurantId: string; planTier: PlanTier },
): Promise<void> {
  if (input.planTier === "trial") return;
  const countryCode = await lookup(() =>
    restaurantCountryCode(deps.DB, input.restaurantId),
  );
  const effective = await resolveRegionPolicies(deps, { countryCode });
  requirePolicy(effective, "plans.allowed_tiers");
  if (
    effective.allowedPaidTiers &&
    !effective.allowedPaidTiers.has(input.planTier as PaidPlanTier)
  ) {
    throw new ApiError(
      "PLAN_NOT_AVAILABLE_IN_REGION",
      "The " + input.planTier + " plan is not offered in this region",
      400,
      { planTier: input.planTier },
    );
  }
}

/** A fee-charging market needs a country and must stay below its country's cap. */
export async function assertMarketFeeWithinRegionCap(
  deps: RegionPolicyDeps,
  input: {
    countryCode: SupportedCountryCode | null;
    platformFeeRateBps: number;
  },
): Promise<void> {
  if (input.platformFeeRateBps === 0) return;
  if (!input.countryCode) {
    throw new ApiError(
      "MARKET_COUNTRY_REQUIRED",
      "A market that charges a platform fee needs a country",
      400,
    );
  }
  // Read D1 directly, not KV. Checkout never clamps to the cap, so a fee saved
  // against a stale cached layer (spec §5.2) would stay above it for good.
  // Market writes are rare admin actions; the uncached read costs nothing.
  const effective = await resolveRegionPolicies(
    { DB: deps.DB },
    { countryCode: input.countryCode },
  );
  requirePolicy(effective, "platform.max_fee_rate_bps");
  const cap = effective.maxFeeRateBps;
  if (cap !== null && input.platformFeeRateBps > cap) {
    throw new ApiError(
      "PLATFORM_FEE_ABOVE_REGION_CAP",
      "Platform fee exceeds the " + input.countryCode + " cap",
      400,
      { maxFeeRateBps: cap, requested: input.platformFeeRateBps },
    );
  }
}

/** Store settings win; unset values use policy defaults and then the current 0. */
export async function resolvePricingRates(
  deps: RegionPolicyDeps,
  input: {
    countryCode: string | null | undefined;
    settings:
      | { taxRate?: number | null; serviceChargeRate?: number | null }
      | null
      | undefined;
  },
): Promise<{ taxRate: number; serviceChargeRate: number }> {
  const ownTax = input.settings?.taxRate ?? null;
  const ownService = input.settings?.serviceChargeRate ?? null;
  if (ownTax !== null && ownService !== null) {
    return { taxRate: ownTax, serviceChargeRate: ownService };
  }

  let effective = EMPTY_REGION_POLICIES;
  try {
    effective = await resolveRegionPolicies(deps, {
      countryCode: input.countryCode,
    });
  } catch {
    // Defaults do not block a transaction; policyUnavailable already logged.
  }
  return {
    taxRate: ownTax ?? effective.defaultTaxRate ?? 0,
    serviceChargeRate: ownService ?? effective.defaultServiceChargeRate ?? 0,
  };
}
