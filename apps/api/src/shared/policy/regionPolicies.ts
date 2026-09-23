/**
 * Reads and merges country and market regional policies.
 * Spec: docs/superpowers/specs/2026-09-23-region-policies-design.md §5
 *
 * The cache is scoped by policy key (policy:v1:country:MY). management-api
 * deletes the same key after a write. A read can race with invalidation and
 * write an old value back, so the effective guarantee is about six minutes
 * (TTL plus KV edge caching), as described in spec §5.2.
 *
 * Read failures throw POLICY_UNAVAILABLE (503). Invalid ceiling keys are
 * recorded in unavailableKeys and converted to 503 by requirePolicy.
 */
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import {
  EMPTY_REGION_POLICIES,
  markets,
  mergeRegionPolicies,
  parseRegionPolicyLayer,
  regionPolicies,
  regionPolicyCacheKey,
  restaurants,
  type EffectiveRegionPolicies,
  type LoadedRegionPolicyLayer,
  type PolicyScopeType,
  type RegionPolicyKey,
} from "@makanmasak/database";
import {
  normalizeCountryCode,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import { ApiError } from "../utils/api-error";

export const REGION_POLICY_CACHE_TTL_SECONDS = 300;

export interface RegionPolicyDeps {
  DB: D1Database;
  CACHE_KV?: KVNamespace;
}

export function policyUnavailable(cause: unknown): ApiError {
  console.error("[region-policies] policy unavailable", cause);
  return new ApiError(
    "POLICY_UNAVAILABLE",
    "Regional policy is temporarily unavailable",
    503,
  );
}

/** Invalid stored ceiling policy data must block the operation (spec D7). */
export function requirePolicy(
  effective: EffectiveRegionPolicies,
  key: RegionPolicyKey,
): void {
  if (effective.unavailableKeys.has(key)) {
    throw policyUnavailable(new Error("invalid stored policy " + key));
  }
}

async function loadLayer(
  deps: RegionPolicyDeps,
  scopeType: PolicyScopeType,
  scopeId: string,
): Promise<LoadedRegionPolicyLayer> {
  const cacheKey = regionPolicyCacheKey(scopeType, scopeId);
  if (deps.CACHE_KV) {
    const cached = await deps.CACHE_KV.get<LoadedRegionPolicyLayer>(
      cacheKey,
      "json",
    );
    if (cached) return cached;
  }

  const rows = await drizzle(deps.DB)
    .select({
      policyKey: regionPolicies.policyKey,
      value: regionPolicies.value,
    })
    .from(regionPolicies)
    .where(
      and(
        eq(regionPolicies.scopeType, scopeType),
        eq(regionPolicies.scopeId, scopeId),
      ),
    );

  const layer = parseRegionPolicyLayer(scopeType, rows);
  if (layer.invalidKeys.length > 0) {
    console.error("[region-policies] invalid policy rows", {
      scopeType,
      scopeId,
      keys: layer.invalidKeys,
    });
  }

  if (deps.CACHE_KV) {
    await deps.CACHE_KV.put(cacheKey, JSON.stringify(layer), {
      expirationTtl: REGION_POLICY_CACHE_TTL_SECONDS,
    });
  }
  return layer;
}

/** Unknown country skips its country layer; market layer loads only when explicit. */
export async function resolveRegionPolicies(
  deps: RegionPolicyDeps,
  scope: { countryCode: string | null | undefined; marketId?: string | null },
): Promise<EffectiveRegionPolicies> {
  const country = normalizeCountryCode(scope.countryCode);
  const marketId = scope.marketId ?? null;
  if (!country && !marketId) return EMPTY_REGION_POLICIES;

  try {
    const [countryLayer, marketLayer] = await Promise.all([
      country ? loadLayer(deps, "country", country) : null,
      marketId ? loadLayer(deps, "market", marketId) : null,
    ]);
    return mergeRegionPolicies(countryLayer, marketLayer);
  } catch (error) {
    throw policyUnavailable(error);
  }
}

export async function restaurantCountryCode(
  db: D1Database,
  restaurantId: string,
): Promise<SupportedCountryCode | null> {
  const [row] = await drizzle(db)
    .select({ countryCode: restaurants.countryCode })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return normalizeCountryCode(row?.countryCode);
}

export async function marketIdBySlug(
  db: D1Database,
  slug: string,
): Promise<string | null> {
  const [row] = await drizzle(db)
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.slug, slug))
    .limit(1);
  return row?.id ?? null;
}
