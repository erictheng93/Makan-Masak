/**
 * 地區政策的後台 CRUD（spec §7）。值的合法性與層級限制由 @makanmasak/database
 * 的登記表決定；這裡負責範圍存在性、兩道寫入門檻（國別未知的店、費率上限
 * 對既有市集）、稽核，以及清除 apps/api 讀取時用的範圍快取（兩邊共用
 * 同一個 CACHE_KV namespace）。
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import {
  AUDIT_ACTIONS,
  auditLogs,
  describeRegionPolicies,
  isRegionPolicyKey,
  markets,
  POLICY_SCOPE_TYPES,
  regionPolicies,
  regionPolicyCacheKey,
  restaurants,
  validateRegionPolicyValue,
  type PolicyScopeType,
  type RegionPolicyKey,
} from "@makanmasak/database";
import {
  normalizeCountryCode,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import { ApiError } from "@makanmasak/utils";
import type { ManagementEnv } from "../types";
import type { ManagementUser } from "../middleware/auth";

const router = new Hono<{
  Bindings: ManagementEnv;
  Variables: { managementUser: ManagementUser };
}>();

type PlatformDb = ReturnType<typeof drizzle>;
type Scope = { type: PolicyScopeType; id: string };

/** 國家層的這些 key 會漏掉國別未知的店，寫入前要過門檻（spec D10）。 */
const GATED_BY_UNKNOWN_COUNTRY: ReadonlySet<RegionPolicyKey> = new Set([
  "modules.disabled",
  "payments.allowed_providers",
  "plans.allowed_tiers",
]);
const UNKNOWN_COUNTRY_SAMPLE_SIZE = 50;

function platformDb(env: ManagementEnv): PlatformDb {
  if (!env.PLATFORM_DB) {
    throw new ApiError(
      "PLATFORM_DB_UNAVAILABLE",
      "Platform database is unavailable",
      500,
    );
  }
  return drizzle(env.PLATFORM_DB);
}

async function requireScope(
  db: PlatformDb,
  rawType: string | undefined,
  rawId: string | undefined,
): Promise<Scope> {
  const type = POLICY_SCOPE_TYPES.find((t) => t === rawType);
  if (!type || !rawId) {
    throw new ApiError("POLICY_SCOPE_INVALID", "Unknown policy scope", 400);
  }
  if (type === "country") {
    const country = normalizeCountryCode(rawId);
    if (!country || country !== rawId) {
      throw new ApiError("POLICY_SCOPE_INVALID", "Unsupported country", 400);
    }
    return { type, id: country };
  }
  const [market] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(and(eq(markets.id, rawId), isNull(markets.deletedAt)))
    .limit(1);
  if (!market) {
    throw new ApiError("POLICY_SCOPE_NOT_FOUND", "Market not found", 404);
  }
  return { type, id: market.id };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readValue(db: PlatformDb, scope: Scope, policyKey: string) {
  const [row] = await db
    .select({ value: regionPolicies.value })
    .from(regionPolicies)
    .where(
      and(
        eq(regionPolicies.scopeType, scope.type),
        eq(regionPolicies.scopeId, scope.id),
        eq(regionPolicies.policyKey, policyKey),
      ),
    )
    .limit(1);
  return row ? safeJson(row.value) : undefined;
}

const restaurantsWithoutCountryWhere = and(
  isNull(restaurants.countryCode),
  isNull(restaurants.deletedAt),
);

async function countRestaurantsWithoutCountry(db: PlatformDb): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(restaurants)
    .where(restaurantsWithoutCountryWhere);
  return result?.value ?? 0;
}

/** 回傳本次寫入時確認的店家數（沒有國別未知的店時為 0）。 */
async function assertUnknownCountryAcknowledged(
  db: PlatformDb,
  acknowledged: unknown,
): Promise<number> {
  // Deliberately re-count for every write. A prior UI confirmation is not
  // reusable after new restaurants without a country have been created.
  const total = await countRestaurantsWithoutCountry(db);
  if (total === 0 || acknowledged === total) return total;
  const sample = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(restaurantsWithoutCountryWhere)
    .orderBy(restaurants.id)
    .limit(UNKNOWN_COUNTRY_SAMPLE_SIZE);
  throw new ApiError(
    "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY",
    `${total} restaurants have no country and would not follow this policy`,
    409,
    { count: total, restaurants: sample },
  );
}

/** 上限不能低於該國任何收費市集；國別未知的收費市集會逃過上限，也要先處理。 */
async function assertCapCoversExistingMarkets(
  db: PlatformDb,
  country: SupportedCountryCode,
  cap: number,
): Promise<void> {
  const columns = {
    id: markets.id,
    name: markets.name,
    platformFeeRateBps: markets.platformFeeRateBps,
  };
  const [above, withoutCountry] = await Promise.all([
    db
      .select(columns)
      .from(markets)
      .where(
        and(
          eq(markets.countryCode, country),
          isNull(markets.deletedAt),
          gt(markets.platformFeeRateBps, cap),
        ),
      ),
    db
      .select(columns)
      .from(markets)
      .where(
        and(
          isNull(markets.countryCode),
          isNull(markets.deletedAt),
          gt(markets.platformFeeRateBps, 0),
        ),
      ),
  ]);
  if (above.length > 0 || withoutCountry.length > 0) {
    throw new ApiError(
      "POLICY_CAP_BELOW_EXISTING_MARKET_FEES",
      "Fix these markets before setting the cap",
      409,
      { markets: above, marketsWithoutCountry: withoutCountry },
    );
  }
}

function auditRow(
  admin: ManagementUser,
  scope: Scope,
  policyKey: string,
  before: unknown,
  after: unknown,
  metadata: Record<string, unknown> = {},
) {
  return {
    userId: null,
    action: AUDIT_ACTIONS.SYSTEM_CONFIG,
    resource: "policies",
    resourceId: `${scope.type}:${scope.id}:${policyKey}`,
    description: `Region policy ${policyKey} ${after === undefined ? "cleared" : "set"} for ${scope.type} ${scope.id} by ${admin.email}`,
    changes: {
      ...(before === undefined ? {} : { before: { value: before } }),
      ...(after === undefined ? {} : { after: { value: after } }),
      metadata: { adminId: admin.id, adminEmail: admin.email, ...metadata },
    },
    success: true,
  };
}

router.get("/registry", (c) =>
  c.json({ success: true, data: { definitions: describeRegionPolicies() } }),
);

router.get("/", async (c) => {
  const db = platformDb(c.env);
  const scope = await requireScope(
    db,
    c.req.query("scope_type"),
    c.req.query("scope_id"),
  );
  const rows = await db
    .select({
      policyKey: regionPolicies.policyKey,
      value: regionPolicies.value,
      updatedBy: regionPolicies.updatedBy,
      updatedAt: regionPolicies.updatedAt,
    })
    .from(regionPolicies)
    .where(
      and(
        eq(regionPolicies.scopeType, scope.type),
        eq(regionPolicies.scopeId, scope.id),
      ),
    );

  const policies = Object.fromEntries(
    rows.map((row) => [
      row.policyKey,
      {
        value: safeJson(row.value),
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.getTime(),
      },
    ]),
  );

  return c.json({
    success: true,
    data: {
      scopeType: scope.type,
      scopeId: scope.id,
      policies,
      ...(scope.type === "country"
        ? {
            restaurantsWithoutCountry: await countRestaurantsWithoutCountry(db),
          }
        : {}),
    },
  });
});

router.put("/:scopeType/:scopeId/:policyKey", async (c) => {
  const db = platformDb(c.env);
  const scope = await requireScope(
    db,
    c.req.param("scopeType"),
    c.req.param("scopeId"),
  );
  const policyKey = c.req.param("policyKey");
  const body = (await c.req.json().catch(() => null)) as {
    value?: unknown;
    acknowledgeRestaurantsWithoutCountry?: unknown;
  } | null;

  const result = validateRegionPolicyValue(policyKey, scope.type, body?.value);
  if (!result.ok) {
    throw new ApiError(
      result.code,
      "Invalid region policy",
      result.code === "POLICY_KEY_UNKNOWN" ? 404 : 400,
      result.issues,
    );
  }

  const metadata: Record<string, unknown> = {};
  if (
    scope.type === "country" &&
    GATED_BY_UNKNOWN_COUNTRY.has(policyKey as RegionPolicyKey)
  ) {
    const acknowledged = await assertUnknownCountryAcknowledged(
      db,
      body?.acknowledgeRestaurantsWithoutCountry,
    );
    if (acknowledged > 0) {
      metadata.acknowledgedRestaurantsWithoutCountry = acknowledged;
    }
  }
  if (policyKey === "platform.max_fee_rate_bps") {
    await assertCapCoversExistingMarkets(
      db,
      scope.id as SupportedCountryCode,
      result.value as number,
    );
  }

  const admin = c.get("managementUser");
  const before = await readValue(db, scope, policyKey);
  const value = JSON.stringify(result.value);
  const now = new Date();

  await db.batch([
    db
      .insert(regionPolicies)
      .values({
        scopeType: scope.type,
        scopeId: scope.id,
        policyKey,
        value,
        updatedBy: admin.email,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          regionPolicies.scopeType,
          regionPolicies.scopeId,
          regionPolicies.policyKey,
        ],
        set: { value, updatedBy: admin.email, updatedAt: now },
      }),
    db
      .insert(auditLogs)
      .values(
        auditRow(admin, scope, policyKey, before, result.value, metadata),
      ),
  ]);
  await c.env.CACHE_KV.delete(regionPolicyCacheKey(scope.type, scope.id));

  return c.json({
    success: true,
    data: {
      scopeType: scope.type,
      scopeId: scope.id,
      policyKey,
      value: result.value,
    },
  });
});

router.delete("/:scopeType/:scopeId/:policyKey", async (c) => {
  const db = platformDb(c.env);
  const scope = await requireScope(
    db,
    c.req.param("scopeType"),
    c.req.param("scopeId"),
  );
  const policyKey = c.req.param("policyKey");
  if (!isRegionPolicyKey(policyKey)) {
    throw new ApiError("POLICY_KEY_UNKNOWN", "Unknown region policy", 404);
  }
  const before = await readValue(db, scope, policyKey);
  if (before === undefined) {
    return c.json({ success: true, data: { deleted: false } });
  }

  const admin = c.get("managementUser");
  await db.batch([
    db
      .delete(regionPolicies)
      .where(
        and(
          eq(regionPolicies.scopeType, scope.type),
          eq(regionPolicies.scopeId, scope.id),
          eq(regionPolicies.policyKey, policyKey),
        ),
      ),
    db
      .insert(auditLogs)
      .values(auditRow(admin, scope, policyKey, before, undefined)),
  ]);
  await c.env.CACHE_KV.delete(regionPolicyCacheKey(scope.type, scope.id));

  return c.json({ success: true, data: { deleted: true } });
});

export default router;
