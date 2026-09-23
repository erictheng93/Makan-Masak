/**
 * moduleGate middleware — subscription plan enforcement.
 *
 * ## Why this suite is not vacuous
 *
 * The obvious way to test a table-driven gate is:
 *
 *     expect(allowed).toBe(PLAN_DEFAULT_MODULES[tier][module] ?? false)
 *
 * That is tautological: it compares the implementation to the exact constant
 * the implementation reads, so a corrupted constant (e.g. someone adds
 * `pos: true` to `basic`) is invisible, and any implementation that merely
 * echoes the constant passes.
 *
 * Instead this file keeps TWO independent sources of truth:
 *
 *   1. `EXPECTED_GRANTS` — a literal, hand-transcribed tier -> module table
 *      written from the product spec (basic = 3 core modules; pro = core + 6
 *      pro modules; enterprise = all 15; trial = all 15). It never reads
 *      `PLAN_DEFAULT_MODULES`.
 *   2. `PLAN_DEFAULT_MODULES` / `MODULES` — the shipped constants.
 *
 * The behavioural matrix asserts `moduleGate` against (1), the literal table.
 * A separate "source of truth guard" describe block asserts (1) === (2) in
 * both directions, including key sets. So:
 *
 *   - a broken `resolveModule` (e.g. `return true`) fails 18 deny cases;
 *   - `return false` fails 42 allow cases;
 *   - a tier lookup bug (basic reading pro's row) fails;
 *   - a corrupted `PLAN_DEFAULT_MODULES` fails the guard block, which points
 *     directly at the literal table so the drift has to be acknowledged;
 *   - a newly added module in `MODULES` with no literal-table entry fails the
 *     guard, so the matrix can never silently shrink.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  restaurants,
  shopSubscriptions,
  MODULES,
  PLAN_DEFAULT_MODULES,
  type ModuleKey,
  type ModuleMap,
  type PlanTier,
} from "@makanmasak/database";
import { ApiError } from "../../shared/utils/api-error";
import type { Env } from "../../types/env";
import {
  invalidateSubscriptionCache,
  invalidateSubscriptionCacheForEnv,
  moduleGate,
  subscriptionCacheKey,
} from "../../middleware/moduleGate";

// ─── Independent oracle (source of truth #1) ─────────────────────────────────
// Hand-transcribed from the product spec. Deliberately NOT derived from
// PLAN_DEFAULT_MODULES.

const CORE_MODULES = [
  "menu_management",
  "table_management",
  "online_ordering",
] as const satisfies readonly ModuleKey[];

const PRO_ONLY_MODULES = [
  "pos",
  "kitchen_display",
  "receipt_printing",
  "coupons",
  "reservations",
  "analytics",
] as const satisfies readonly ModuleKey[];

const ENTERPRISE_ONLY_MODULES = [
  "ai_analytics",
  "platform_integration",
  "loyalty",
  "inventory",
  "staff_management",
] as const satisfies readonly ModuleKey[];

const ALL_MODULES: readonly ModuleKey[] = [
  ...CORE_MODULES,
  ...PRO_ONLY_MODULES,
  ...ENTERPRISE_ONLY_MODULES,
];

const ALL_TIERS: readonly PlanTier[] = ["trial", "basic", "pro", "enterprise"];

const EXPECTED_GRANTS: Record<PlanTier, readonly ModuleKey[]> = {
  basic: CORE_MODULES,
  pro: [...CORE_MODULES, ...PRO_ONLY_MODULES],
  enterprise: ALL_MODULES,
  trial: ALL_MODULES,
};

function expectedAllow(tier: PlanTier, module: ModuleKey): boolean {
  return EXPECTED_GRANTS[tier].includes(module);
}

// ─── Test harness ────────────────────────────────────────────────────────────

let testDb: TestDatabase;

/** Minimal in-memory stand-in for a KVNamespace, with call recording. */
class FakeKv {
  readonly store = new Map<string, string>();
  readonly gets: string[] = [];
  readonly puts: Array<{
    key: string;
    value: string;
    options?: { expirationTtl?: number };
  }> = [];
  readonly deletes: string[] = [];

  // moduleGate only ever calls get(key, "json")
  async get<T>(key: string, _type?: "json"): Promise<T | null> {
    this.gets.push(key);
    const raw = this.store.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.puts.push({ key, value, options });
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key);
    this.store.delete(key);
  }
}

/**
 * A binding that explodes on any property access. Used to prove a code path
 * never performs a lookup.
 */
function poisonedBinding(label: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `${label} was accessed (property ${String(prop)}) but must not be`,
        );
      },
    },
  );
}

let kv: FakeKv;

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    DB: testDb.bindings.DB,
    CACHE_KV: kv,
    ...overrides,
  } as unknown as Env;
}

interface GateUser {
  role: number;
  restaurantId?: string | null;
}

type GateResult =
  | { allowed: true }
  | { allowed: false; code: string; status: number; message: string };

/**
 * Runs the middleware and normalises the outcome.
 * Rethrows anything that is not an ApiError so real bugs are never swallowed.
 */
async function attemptGate(
  module: ModuleKey,
  user: GateUser | undefined,
  env: Env = makeEnv(),
): Promise<GateResult> {
  let nextCalled = false;
  const ctx = {
    env,
    get: (key: string) => (key === "user" ? user : undefined),
  };

  try {
    await moduleGate(module)(ctx as never, async () => {
      nextCalled = true;
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        allowed: false,
        code: error.code,
        status: error.status,
        message: error.message,
      };
    }
    throw error;
  }

  if (!nextCalled) {
    throw new Error(
      `moduleGate('${module}') neither called next() nor threw — the gate is a no-op`,
    );
  }
  return { allowed: true };
}

let restaurantCounter = 0;

/** Seeds a restaurant + subscription row and returns the restaurant id. */
async function seedSubscription(input: {
  planTier: PlanTier;
  isActive?: boolean;
  moduleOverrides?: ModuleMap;
  trialEndsAt?: Date | null;
  idHint?: string;
}): Promise<string> {
  restaurantCounter += 1;
  const restaurantId = `mg-${input.idHint ?? input.planTier}-${restaurantCounter}`;

  await testDb.drizzle.insert(restaurants).values({
    id: restaurantId,
    name: `Module Gate Test ${restaurantCounter}`,
    type: "street_food",
    category: "snack",
    address: "1 Test Rd",
    district: "West",
    phone: "0900000000",
  });

  await testDb.drizzle.insert(shopSubscriptions).values({
    restaurantId,
    planTier: input.planTier,
    isActive: input.isActive ?? true,
    moduleOverrides: input.moduleOverrides ?? {},
    trialEndsAt: input.trialEndsAt ?? null,
  });

  return restaurantId;
}

/** Far enough in the future that the trial tier is never expired in tests. */
const FAR_FUTURE = new Date("2099-01-01T00:00:00.000Z");

/** One restaurant per tier, shared by the 60-case matrix. */
const tierRestaurantId: Partial<Record<PlanTier, string>> = {};

beforeAll(async () => {
  testDb = await createTestDatabase();
  await testDb.truncateAll();

  for (const tier of ALL_TIERS) {
    tierRestaurantId[tier] = await seedSubscription({
      planTier: tier,
      isActive: true,
      trialEndsAt: tier === "trial" ? FAR_FUTURE : null,
      idHint: `matrix-${tier}`,
    });
  }
});

afterAll(async () => {
  await testDb?.dispose();
});

beforeEach(() => {
  // Cold cache for every test: each case exercises the DB read + write-through
  // rather than inheriting another test's cached decision.
  kv = new FakeKv();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Source-of-truth guard ────────────────────────────────────────────────

describe("source of truth guard", () => {
  it("the literal module list matches MODULES exactly", () => {
    expect([...ALL_MODULES].sort()).toEqual([...Object.values(MODULES)].sort());
    expect(ALL_MODULES).toHaveLength(14);
    expect(new Set(ALL_MODULES).size).toBe(ALL_MODULES.length);
  });

  it("covers all four plan tiers", () => {
    expect([...ALL_TIERS].sort()).toEqual(
      [...Object.keys(PLAN_DEFAULT_MODULES)].sort(),
    );
  });

  it.each(ALL_TIERS)(
    "PLAN_DEFAULT_MODULES.%s matches the hand-written expectation table",
    (tier) => {
      const fromConstant = ALL_MODULES.filter(
        (module) => PLAN_DEFAULT_MODULES[tier][module] === true,
      );
      expect([...fromConstant].sort()).toEqual(
        [...EXPECTED_GRANTS[tier]].sort(),
      );
    },
  );

  it.each(ALL_TIERS)(
    "PLAN_DEFAULT_MODULES.%s contains no keys outside MODULES",
    (tier) => {
      const unknownKeys = Object.keys(PLAN_DEFAULT_MODULES[tier]).filter(
        (key) => !(ALL_MODULES as readonly string[]).includes(key),
      );
      expect(unknownKeys).toEqual([]);
    },
  );

  it("expects the documented grant counts per tier", () => {
    expect(EXPECTED_GRANTS.basic).toHaveLength(3);
    expect(EXPECTED_GRANTS.pro).toHaveLength(9);
    expect(EXPECTED_GRANTS.enterprise).toHaveLength(14);
    expect(EXPECTED_GRANTS.trial).toHaveLength(14);
  });
});

// ─── 2. Full tier x module matrix (4 x 15 = 60 cases) ────────────────────────

describe("tier x module matrix", () => {
  describe.each(ALL_TIERS)("plan tier: %s", (tier) => {
    it.each(ALL_MODULES)(`%s`, async (module) => {
      const expected = expectedAllow(tier, module);
      const result = await attemptGate(module, {
        role: 1,
        restaurantId: tierRestaurantId[tier],
      });

      expect(result.allowed).toBe(expected);
      if (!result.allowed) {
        expect(result.status).toBe(403);
        expect(result.code).toBe("MODULE_NOT_ENABLED");
      }
    });
  });

  it("the matrix contains both allow and deny cases (non-vacuity)", () => {
    const cases = ALL_TIERS.flatMap((tier) =>
      ALL_MODULES.map((module) => expectedAllow(tier, module)),
    );
    expect(cases).toHaveLength(56);
    expect(cases.filter(Boolean)).toHaveLength(40);
    expect(cases.filter((allowed) => !allowed)).toHaveLength(16);
  });
});

// ─── 3. The specific escalation cases ────────────────────────────────────────

describe("basic tier cannot reach paid modules", () => {
  it.each(PRO_ONLY_MODULES)("denies pro module: %s", async (module) => {
    const result = await attemptGate(module, {
      role: 1,
      restaurantId: tierRestaurantId.basic,
    });
    expect(result).toMatchObject({
      allowed: false,
      code: "MODULE_NOT_ENABLED",
      status: 403,
    });
  });

  it.each(ENTERPRISE_ONLY_MODULES)(
    "denies enterprise module: %s",
    async (module) => {
      const result = await attemptGate(module, {
        role: 1,
        restaurantId: tierRestaurantId.basic,
      });
      expect(result).toMatchObject({
        allowed: false,
        code: "MODULE_NOT_ENABLED",
        status: 403,
      });
    },
  );

  it.each(CORE_MODULES)("still allows core module: %s", async (module) => {
    const result = await attemptGate(module, {
      role: 1,
      restaurantId: tierRestaurantId.basic,
    });
    expect(result.allowed).toBe(true);
  });
});

describe("pro tier cannot reach enterprise-only modules", () => {
  it.each(ENTERPRISE_ONLY_MODULES)(
    "denies enterprise module: %s",
    async (module) => {
      const result = await attemptGate(module, {
        role: 1,
        restaurantId: tierRestaurantId.pro,
      });
      expect(result).toMatchObject({
        allowed: false,
        code: "MODULE_NOT_ENABLED",
        status: 403,
      });
    },
  );

  it.each(PRO_ONLY_MODULES)("allows pro module: %s", async (module) => {
    const result = await attemptGate(module, {
      role: 1,
      restaurantId: tierRestaurantId.pro,
    });
    expect(result.allowed).toBe(true);
  });
});

// ─── 4. Error code contract (the admin dashboard branches on these) ──────────

describe("error code contract", () => {
  it("returns NO_RESTAURANT when the user has no restaurantId", async () => {
    const result = await attemptGate("menu_management", { role: 1 });
    expect(result).toMatchObject({
      allowed: false,
      code: "NO_RESTAURANT",
      status: 403,
    });
    // The gate must short-circuit before any subscription lookup.
    expect(kv.gets).toEqual([]);
  });

  it("returns NO_RESTAURANT when restaurantId is null", async () => {
    const result = await attemptGate("menu_management", {
      role: 1,
      restaurantId: null,
    });
    expect(result).toMatchObject({ allowed: false, code: "NO_RESTAURANT" });
  });

  it("returns NO_RESTAURANT when there is no user on the context", async () => {
    const result = await attemptGate("menu_management", undefined);
    expect(result).toMatchObject({ allowed: false, code: "NO_RESTAURANT" });
  });

  it("returns SUBSCRIPTION_NOT_FOUND when no subscription row exists", async () => {
    const result = await attemptGate("menu_management", {
      role: 1,
      restaurantId: "mg-never-onboarded",
    });
    expect(result).toMatchObject({
      allowed: false,
      code: "SUBSCRIPTION_NOT_FOUND",
      status: 403,
    });
  });

  it("returns TRIAL_EXPIRED for an expired trial", async () => {
    const restaurantId = await seedSubscription({
      planTier: "trial",
      trialEndsAt: new Date(Date.now() - 60_000),
      idHint: "expired",
    });

    const result = await attemptGate("menu_management", {
      role: 1,
      restaurantId,
    });
    expect(result).toMatchObject({
      allowed: false,
      code: "TRIAL_EXPIRED",
      status: 403,
    });
  });

  it("returns MODULE_NOT_ENABLED for an in-plan-but-not-included module", async () => {
    const result = await attemptGate("ai_analytics", {
      role: 1,
      restaurantId: tierRestaurantId.pro,
    });
    expect(result).toMatchObject({
      allowed: false,
      code: "MODULE_NOT_ENABLED",
      status: 403,
    });
  });

  it("the four codes are mutually distinct", () => {
    const codes = [
      "NO_RESTAURANT",
      "SUBSCRIPTION_NOT_FOUND",
      "TRIAL_EXPIRED",
      "MODULE_NOT_ENABLED",
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("never leaks the module key or restaurant id in the denial message", async () => {
    const result = await attemptGate("ai_analytics", {
      role: 1,
      restaurantId: tierRestaurantId.pro,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).not.toContain("ai_analytics");
      expect(result.message).not.toContain(String(tierRestaurantId.pro));
    }
  });
});

// ─── 5. isActive kill switch ─────────────────────────────────────────────────

describe("isActive: false is a total kill switch", () => {
  let inactiveEnterpriseId: string;
  let inactiveBasicId: string;

  beforeAll(async () => {
    inactiveEnterpriseId = await seedSubscription({
      planTier: "enterprise",
      isActive: false,
      idHint: "inactive-ent",
    });
    inactiveBasicId = await seedSubscription({
      planTier: "basic",
      isActive: false,
      idHint: "inactive-basic",
    });
  });

  it.each(ALL_MODULES)(
    "denies %s for an inactive enterprise subscription",
    async (module) => {
      const result = await attemptGate(module, {
        role: 1,
        restaurantId: inactiveEnterpriseId,
      });
      expect(result).toMatchObject({
        allowed: false,
        code: "MODULE_NOT_ENABLED",
        status: 403,
      });
    },
  );

  it.each(CORE_MODULES)(
    "denies core module %s that the basic tier would otherwise grant",
    async (module) => {
      const result = await attemptGate(module, {
        role: 1,
        restaurantId: inactiveBasicId,
      });
      expect(result.allowed).toBe(false);
    },
  );

  it("isActive:false beats an enabling module override", async () => {
    const restaurantId = await seedSubscription({
      planTier: "basic",
      isActive: false,
      moduleOverrides: { ai_analytics: true },
      idHint: "inactive-override",
    });

    const result = await attemptGate("ai_analytics", {
      role: 1,
      restaurantId,
    });
    expect(result.allowed).toBe(false);
  });
});

// ─── 6. Trial expiry boundary ────────────────────────────────────────────────

/**
 * These run entirely off the KV cache with a poisoned DB binding so the clock
 * can be frozen at exact millisecond boundaries without any Miniflare/D1 work
 * happening under a mocked `Date.now()`.
 *
 * The shape written here mirrors `CachedSubscription` in moduleGate.ts — if
 * that shape changes, these tests are meant to fail.
 */
describe("trial expiry boundary", () => {
  const TRIAL_END_MS = Date.UTC(2026, 7, 1, 0, 0, 0, 0);

  function seedCache(
    restaurantId: string,
    sub: {
      isActive: boolean;
      planTier: PlanTier;
      moduleOverrides: ModuleMap;
      trialEndsAt: number | null;
    },
  ): Env {
    kv.store.set(`subscription:${restaurantId}`, JSON.stringify(sub));
    return makeEnv({ DB: poisonedBinding("DB") });
  }

  function trialSub(trialEndsAt: number | null) {
    return {
      isActive: true,
      planTier: "trial" as PlanTier,
      moduleOverrides: {} as ModuleMap,
      trialEndsAt,
    };
  }

  it("is NOT expired at trialEndsAt - 1ms", async () => {
    const restaurantId = "mg-boundary-before";
    const env = seedCache(restaurantId, trialSub(TRIAL_END_MS));
    vi.spyOn(Date, "now").mockReturnValue(TRIAL_END_MS - 1);

    const result = await attemptGate(
      "ai_analytics",
      { role: 1, restaurantId },
      env,
    );
    expect(result.allowed).toBe(true);
  });

  it("is NOT expired exactly at trialEndsAt (comparison is strict >)", async () => {
    const restaurantId = "mg-boundary-exact";
    const env = seedCache(restaurantId, trialSub(TRIAL_END_MS));
    vi.spyOn(Date, "now").mockReturnValue(TRIAL_END_MS);

    const result = await attemptGate(
      "ai_analytics",
      { role: 1, restaurantId },
      env,
    );
    expect(result.allowed).toBe(true);
  });

  it("IS expired at trialEndsAt + 1ms", async () => {
    const restaurantId = "mg-boundary-after";
    const env = seedCache(restaurantId, trialSub(TRIAL_END_MS));
    vi.spyOn(Date, "now").mockReturnValue(TRIAL_END_MS + 1);

    const result = await attemptGate(
      "ai_analytics",
      { role: 1, restaurantId },
      env,
    );
    expect(result).toMatchObject({ allowed: false, code: "TRIAL_EXPIRED" });
  });

  it("expiry applies to core modules too, not just paid ones", async () => {
    const restaurantId = "mg-boundary-core";
    const env = seedCache(restaurantId, trialSub(TRIAL_END_MS));
    vi.spyOn(Date, "now").mockReturnValue(TRIAL_END_MS + 1);

    const result = await attemptGate(
      "menu_management",
      { role: 1, restaurantId },
      env,
    );
    expect(result).toMatchObject({ allowed: false, code: "TRIAL_EXPIRED" });
  });

  it("trialEndsAt: null is never treated as expired", async () => {
    const restaurantId = "mg-boundary-null";
    const env = seedCache(restaurantId, trialSub(null));
    // Clock far past any plausible trial window.
    vi.spyOn(Date, "now").mockReturnValue(TRIAL_END_MS + 10 * 365 * 86400_000);

    const result = await attemptGate(
      "ai_analytics",
      { role: 1, restaurantId },
      env,
    );
    expect(result.allowed).toBe(true);
  });

  it("trialEndsAt: null from the DB grants the full trial module set", async () => {
    const restaurantId = await seedSubscription({
      planTier: "trial",
      trialEndsAt: null,
      idHint: "trial-null",
    });

    for (const module of ALL_MODULES) {
      const result = await attemptGate(module, { role: 1, restaurantId });
      expect(result.allowed, `module ${module}`).toBe(true);
    }
  });

  it("expiry only applies to the trial tier — a paid plan with a past trialEndsAt is unaffected", async () => {
    const restaurantId = "mg-boundary-paid";
    kv.store.set(
      `subscription:${restaurantId}`,
      JSON.stringify({
        isActive: true,
        planTier: "enterprise",
        moduleOverrides: {},
        trialEndsAt: TRIAL_END_MS,
      }),
    );
    const env = makeEnv({ DB: poisonedBinding("DB") });
    vi.spyOn(Date, "now").mockReturnValue(TRIAL_END_MS + 86_400_000);

    const result = await attemptGate(
      "ai_analytics",
      { role: 1, restaurantId },
      env,
    );
    expect(result.allowed).toBe(true);
  });
});

// ─── 7. moduleOverrides semantics (deliberately bidirectional) ───────────────

describe("moduleOverrides", () => {
  it("can ENABLE a module the tier does not grant", async () => {
    const restaurantId = await seedSubscription({
      planTier: "basic",
      moduleOverrides: { ai_analytics: true },
      idHint: "override-on",
    });

    const result = await attemptGate("ai_analytics", {
      role: 1,
      restaurantId,
    });
    expect(result.allowed).toBe(true);
  });

  it("can DISABLE a module the tier does grant", async () => {
    const restaurantId = await seedSubscription({
      planTier: "pro",
      moduleOverrides: { online_ordering: false },
      idHint: "override-off",
    });

    const result = await attemptGate("online_ordering", {
      role: 1,
      restaurantId,
    });
    expect(result).toMatchObject({
      allowed: false,
      code: "MODULE_NOT_ENABLED",
      status: 403,
    });
  });

  it("only affects the overridden module, not its neighbours", async () => {
    const restaurantId = await seedSubscription({
      planTier: "basic",
      moduleOverrides: { ai_analytics: true, menu_management: false },
      idHint: "override-scoped",
    });

    await expect(
      attemptGate("ai_analytics", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      attemptGate("menu_management", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: false });
    // Untouched neighbours keep the plan default.
    await expect(
      attemptGate("table_management", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      attemptGate("pos", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("an empty override map falls back entirely to plan defaults", async () => {
    const restaurantId = await seedSubscription({
      planTier: "basic",
      moduleOverrides: {},
      idHint: "override-empty",
    });

    for (const module of ALL_MODULES) {
      const result = await attemptGate(module, { role: 1, restaurantId });
      expect(result.allowed, `module ${module}`).toBe(
        expectedAllow("basic", module),
      );
    }
  });

  it("a NULL override column is treated as an empty map", async () => {
    const restaurantId = await seedSubscription({
      planTier: "basic",
      idHint: "override-null",
    });
    await testDb.drizzle
      .update(shopSubscriptions)
      .set({ moduleOverrides: null })
      .where(eq(shopSubscriptions.restaurantId, restaurantId));

    await expect(
      attemptGate("menu_management", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      attemptGate("pos", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: false, code: "MODULE_NOT_ENABLED" });
  });

  it("trial expiry beats an enabling override (expiry is checked first)", async () => {
    const restaurantId = await seedSubscription({
      planTier: "trial",
      trialEndsAt: new Date(Date.now() - 60_000),
      moduleOverrides: { ai_analytics: true },
      idHint: "override-expired",
    });

    const result = await attemptGate("ai_analytics", {
      role: 1,
      restaurantId,
    });
    expect(result).toMatchObject({ allowed: false, code: "TRIAL_EXPIRED" });
  });
});

// ─── 8. Admin (role 0) bypass ────────────────────────────────────────────────

describe("role 0 bypass", () => {
  /** Both bindings explode on touch — proves no lookup happens at all. */
  function poisonedEnv(): Env {
    return {
      DB: poisonedBinding("DB"),
      CACHE_KV: poisonedBinding("CACHE_KV"),
    } as unknown as Env;
  }

  it.each(ALL_MODULES)(
    "admin passes %s without any subscription lookup",
    async (module) => {
      const result = await attemptGate(
        module,
        { role: 0, restaurantId: "mg-never-onboarded" },
        poisonedEnv(),
      );
      expect(result.allowed).toBe(true);
    },
  );

  it("admin passes even with no restaurantId at all", async () => {
    const result = await attemptGate(
      "ai_analytics",
      { role: 0 },
      poisonedEnv(),
    );
    expect(result.allowed).toBe(true);
  });

  it("only role 0 bypasses — roles 1..5 are still gated", async () => {
    for (const role of [1, 2, 3, 4, 5]) {
      const result = await attemptGate("ai_analytics", {
        role,
        restaurantId: tierRestaurantId.basic,
      });
      expect(result, `role ${role}`).toMatchObject({
        allowed: false,
        code: "MODULE_NOT_ENABLED",
      });
    }
  });

  it("a string '0' role does NOT bypass (strict equality)", async () => {
    const result = await attemptGate("ai_analytics", {
      role: "0" as unknown as number,
      restaurantId: tierRestaurantId.basic,
    });
    expect(result).toMatchObject({
      allowed: false,
      code: "MODULE_NOT_ENABLED",
    });
  });
});

// ─── 9. KV cache behaviour ───────────────────────────────────────────────────

describe("subscription cache", () => {
  it("uses the exact key `subscription:<restaurantId>` with a 300s TTL", async () => {
    const restaurantId = tierRestaurantId.pro as string;
    await attemptGate("pos", { role: 1, restaurantId });

    expect(kv.gets).toEqual([`subscription:${restaurantId}`]);
    expect(kv.puts).toHaveLength(1);
    expect(kv.puts[0]).toMatchObject({
      key: `subscription:${restaurantId}`,
      options: { expirationTtl: 300 },
    });
    expect(JSON.parse(kv.puts[0].value)).toEqual({
      isActive: true,
      planTier: "pro",
      moduleOverrides: {},
      trialEndsAt: null,
      countryCode: null,
    });
  });

  it("serves subsequent requests from cache without touching the DB", async () => {
    const restaurantId = tierRestaurantId.pro as string;
    await attemptGate("pos", { role: 1, restaurantId });
    expect(kv.puts).toHaveLength(1);

    // Second call with a poisoned DB must still succeed => cache hit.
    const result = await attemptGate(
      "pos",
      { role: 1, restaurantId },
      makeEnv({ DB: poisonedBinding("DB") }),
    );
    expect(result.allowed).toBe(true);
    expect(kv.puts).toHaveLength(1); // no second write-through
  });

  it("does NOT negative-cache a missing subscription", async () => {
    const restaurantId = "mg-provisioning-race";

    const first = await attemptGate("menu_management", {
      role: 1,
      restaurantId,
    });
    expect(first).toMatchObject({ code: "SUBSCRIPTION_NOT_FOUND" });

    // Nothing was written for the miss.
    expect(kv.puts).toEqual([]);
    expect(kv.store.has(`subscription:${restaurantId}`)).toBe(false);

    // Provision the shop, then retry — must be granted immediately, no TTL wait.
    await testDb.drizzle.insert(restaurants).values({
      id: restaurantId,
      name: "Provisioning Race",
      type: "street_food",
      category: "snack",
      address: "1 Test Rd",
      district: "West",
      phone: "0900000000",
    });
    await testDb.drizzle.insert(shopSubscriptions).values({
      restaurantId,
      planTier: "basic",
      isActive: true,
      moduleOverrides: {},
    });

    const second = await attemptGate("menu_management", {
      role: 1,
      restaurantId,
    });
    expect(second.allowed).toBe(true);
  });

  it("REGRESSION GUARD: a DB downgrade is not seen until the cache is invalidated", async () => {
    const restaurantId = await seedSubscription({
      planTier: "pro",
      idHint: "downgrade",
    });

    // Warm the cache while still on `pro`.
    await expect(
      attemptGate("pos", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: true });

    // Downgrade in the DB, exactly as a billing/management-api writer would.
    await testDb.drizzle
      .update(shopSubscriptions)
      .set({ planTier: "basic" })
      .where(eq(shopSubscriptions.restaurantId, restaurantId));

    // Documented current behaviour: still allowed, for up to the 300s TTL.
    await expect(
      attemptGate("pos", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: true });

    // Explicit invalidation is what makes the downgrade take effect.
    await invalidateSubscriptionCache(
      { env: makeEnv() } as never,
      restaurantId,
    );
    expect(kv.deletes).toEqual([`subscription:${restaurantId}`]);

    await expect(
      attemptGate("pos", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: false, code: "MODULE_NOT_ENABLED" });
  });

  it("invalidation also picks up a deactivation (isActive -> false)", async () => {
    const restaurantId = await seedSubscription({
      planTier: "enterprise",
      idHint: "deactivate",
    });

    await expect(
      attemptGate("ai_analytics", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: true });

    await testDb.drizzle
      .update(shopSubscriptions)
      .set({ isActive: false })
      .where(eq(shopSubscriptions.restaurantId, restaurantId));

    await invalidateSubscriptionCache(
      { env: makeEnv() } as never,
      restaurantId,
    );

    await expect(
      attemptGate("ai_analytics", { role: 1, restaurantId }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("caches per restaurant — one shop's entry never answers for another", async () => {
    const proId = tierRestaurantId.pro as string;
    const basicId = tierRestaurantId.basic as string;

    await expect(
      attemptGate("pos", { role: 1, restaurantId: proId }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      attemptGate("pos", { role: 1, restaurantId: basicId }),
    ).resolves.toMatchObject({ allowed: false });

    expect([...kv.store.keys()].sort()).toEqual(
      [`subscription:${basicId}`, `subscription:${proId}`].sort(),
    );
  });

  it("coerces a numeric restaurantId to the same string cache key", async () => {
    const restaurantId = tierRestaurantId.basic as string;
    await attemptGate("menu_management", {
      role: 1,
      restaurantId: restaurantId as unknown as string,
    });
    expect(kv.gets[0]).toBe(`subscription:${restaurantId}`);
  });
});

// ─── 10. Env-based invalidation for non-request contexts ────────────────────
//
// Cron jobs, webhook handlers, and plain services hold only `this.env` — they
// have no Hono `Context` to pass to `invalidateSubscriptionCache`. This is the
// entry point they use instead. It must delete the exact same key that
// `getSubscription`/`invalidateSubscriptionCache` read and write, so the key
// format is derived from the single shared `subscriptionCacheKey` helper
// rather than re-built ad hoc at each call site.

describe("invalidateSubscriptionCacheForEnv (non-request entry point)", () => {
  it("deletes the exact `subscription:<restaurantId>` key given only an Env-shaped object", async () => {
    const restaurantId = "mg-env-invalidate";
    kv.store.set(
      subscriptionCacheKey(restaurantId),
      JSON.stringify({
        isActive: true,
        planTier: "pro",
        moduleOverrides: {},
        trialEndsAt: null,
      }),
    );

    // Deliberately NOT a Hono Context — just the `{ CACHE_KV }` shape a cron
    // job or service would hold as `this.env`.
    await invalidateSubscriptionCacheForEnv(
      { CACHE_KV: kv as never },
      restaurantId,
    );

    expect(kv.deletes).toEqual([subscriptionCacheKey(restaurantId)]);
    expect(kv.store.has(subscriptionCacheKey(restaurantId))).toBe(false);
  });

  it("matches the key that subscriptionCacheKey() and the Context-based invalidator produce", () => {
    const restaurantId = "mg-key-parity";
    expect(subscriptionCacheKey(restaurantId)).toBe(
      `subscription:${restaurantId}`,
    );
  });

  it("invalidateSubscriptionCache(c, ...) delegates to the same Env-based deletion (no divergence)", async () => {
    const restaurantId = "mg-delegation";
    await invalidateSubscriptionCache(
      { env: makeEnv() } as never,
      restaurantId,
    );
    expect(kv.deletes).toEqual([subscriptionCacheKey(restaurantId)]);
  });
});
