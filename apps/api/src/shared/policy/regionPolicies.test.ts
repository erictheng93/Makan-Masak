/**
 * Resolver and guards against real D1 (migrations_fresh, including 0031/0032)
 * and real KV. Kept in the unit project like ShopPaymentCredentialService.test.ts.
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
import { markets, regionPolicies } from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  buildSeedHelpers,
  type SeedHelpers,
} from "../../__tests__/integration/helpers/seed-helper";
import {
  marketIdBySlug,
  resolveRegionPolicies,
  restaurantCountryCode,
} from "./regionPolicies";
import {
  assertMarketFeeWithinRegionCap,
  assertPaymentProviderAllowed,
  assertPlanTierAllowed,
  resolvePricingRates,
} from "./regionPolicyGuards";

describe("region policies against real D1", () => {
  let testDb: TestDatabase;
  let seed: SeedHelpers;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    seed = buildSeedHelpers(testDb);
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    const { keys } = await testDb.bindings.CACHE_KV.list();
    await Promise.all(
      keys.map(({ name }) => testDb.bindings.CACHE_KV.delete(name)),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const deps = () => ({
    DB: testDb.bindings.DB,
    CACHE_KV: testDb.bindings.CACHE_KV,
  });

  const brokenKv = () => ({
    DB: testDb.bindings.DB,
    CACHE_KV: {
      get: vi.fn().mockRejectedValue(new Error("kv down")),
    } as unknown as KVNamespace,
  });

  async function setPolicy(
    scopeType: "country" | "market",
    scopeId: string,
    policyKey: string,
    value: string,
  ) {
    await testDb.drizzle
      .insert(regionPolicies)
      .values({ scopeType, scopeId, policyKey, value });
    await testDb.bindings.CACHE_KV.delete(
      "policy:v1:" + scopeType + ":" + scopeId,
    );
  }

  async function seedMarket(id: string, slug: string, city: string) {
    const now = new Date();
    await testDb.drizzle.insert(markets).values({
      id,
      slug,
      name: slug,
      type: "night_market",
      city,
      district: "Central",
      address: "1 Market Road",
      latitude: 0,
      longitude: 0,
      createdAt: now,
      updatedAt: now,
    } as never);
  }

  const myShop = () =>
    seed.restaurant({ countryCode: "MY", settings: { currency: "MYR" } });

  it("enforces STRICT and the scope/key unique index", async () => {
    await setPolicy("country", "MY", "modules.disabled", "[]");
    await expect(
      setPolicy("country", "MY", "modules.disabled", '["pos"]'),
    ).rejects.toThrow();
    const { results } = await testDb.bindings.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'policies'",
    ).all<{ sql: string }>();
    expect(results[0]!.sql.trim().endsWith(") STRICT")).toBe(true);
  });

  it("returns empty policies for an unknown country", async () => {
    const effective = await resolveRegionPolicies(deps(), {
      countryCode: null,
    });
    expect(effective.modulesDisabled.size).toBe(0);
    expect(effective.allowedProviders).toBeNull();
  });

  it("merges the country and market layers", async () => {
    await seedMarket("m-1", "jalan-alor", "Kuala Lumpur");
    await setPolicy(
      "country",
      "MY",
      "payments.allowed_providers",
      '["tng","grabpay"]',
    );
    await setPolicy("market", "m-1", "payments.allowed_providers", '["tng"]');

    const effective = await resolveRegionPolicies(deps(), {
      countryCode: "MY",
      marketId: "m-1",
    });
    expect([...effective.allowedProviders!]).toEqual(["tng"]);
  });

  it("serves the layer from KV after the first read", async () => {
    await setPolicy("country", "MY", "modules.disabled", '["pos"]');
    await resolveRegionPolicies(deps(), { countryCode: "MY" });
    await testDb.drizzle.delete(regionPolicies);

    const effective = await resolveRegionPolicies(deps(), {
      countryCode: "MY",
    });
    expect([...effective.modulesDisabled]).toEqual(["pos"]);
  });

  it("works without KV", async () => {
    await setPolicy("country", "MY", "modules.disabled", '["pos"]');
    const effective = await resolveRegionPolicies(
      { DB: testDb.bindings.DB },
      { countryCode: "MY" },
    );
    expect([...effective.modulesDisabled]).toEqual(["pos"]);
  });

  it("drops a corrupt default but keeps it out of unavailableKeys", async () => {
    await setPolicy("country", "MY", "pricing.default_tax_rate_bps", "oops");
    const effective = await resolveRegionPolicies(deps(), {
      countryCode: "MY",
    });
    expect(effective.defaultTaxRate).toBeNull();
    expect(effective.unavailableKeys.size).toBe(0);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("invalid policy rows"),
      expect.objectContaining({ keys: ["pricing.default_tax_rate_bps"] }),
    );
  });

  it("blocks a charge when the provider policy is corrupt", async () => {
    const shop = await myShop();
    await setPolicy("country", "MY", "payments.allowed_providers", '["nope"]');
    await expect(
      assertPaymentProviderAllowed(deps(), {
        restaurantId: shop.id,
        provider: "tng",
      }),
    ).rejects.toMatchObject({
      code: "POLICY_UNAVAILABLE",
      status: 503,
    });
  });

  it("fails closed when the store is down", async () => {
    const shop = await myShop();
    const broken = brokenKv();
    await expect(
      assertPaymentProviderAllowed(broken, {
        restaurantId: shop.id,
        provider: "tng",
      }),
    ).rejects.toMatchObject({
      code: "POLICY_UNAVAILABLE",
      status: 503,
    });
    expect(broken.CACHE_KV.get).toHaveBeenCalledWith(
      "policy:v1:country:MY",
      "json",
    );
  });

  it("fails closed when the checkout market cannot be found", async () => {
    const shop = await myShop();
    await expect(
      assertPaymentProviderAllowed(deps(), {
        restaurantId: shop.id,
        provider: "tng",
        marketSlug: "missing",
      }),
    ).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
  });

  it("looks up a restaurant country and a market id", async () => {
    const shop = await myShop();
    await seedMarket("m-2", "pasar", "Selangor");
    expect(await restaurantCountryCode(testDb.bindings.DB, shop.id)).toBe("MY");
    expect(await marketIdBySlug(testDb.bindings.DB, "pasar")).toBe("m-2");
    expect(await marketIdBySlug(testDb.bindings.DB, "missing")).toBeNull();
  });

  describe("assertPaymentProviderAllowed", () => {
    it("allows anything when no policy is set", async () => {
      const shop = await myShop();
      await expect(
        assertPaymentProviderAllowed(deps(), {
          restaurantId: shop.id,
          provider: "grabpay",
        }),
      ).resolves.toBeUndefined();
    });

    it("blocks a provider the market excludes", async () => {
      const shop = await myShop();
      await seedMarket("m-3", "night", "Penang");
      await setPolicy("market", "m-3", "payments.allowed_providers", '["tng"]');
      await expect(
        assertPaymentProviderAllowed(deps(), {
          restaurantId: shop.id,
          provider: "grabpay",
          marketSlug: "night",
        }),
      ).rejects.toMatchObject({
        code: "PAYMENT_PROVIDER_NOT_ALLOWED",
        status: 403,
      });
    });
  });

  describe("assertPlanTierAllowed", () => {
    it("always allows trial", async () => {
      const shop = await myShop();
      await setPolicy("country", "MY", "plans.allowed_tiers", '["basic"]');
      await expect(
        assertPlanTierAllowed(deps(), {
          restaurantId: shop.id,
          planTier: "trial",
        }),
      ).resolves.toBeUndefined();
    });

    it("blocks a paid tier the country does not sell", async () => {
      const shop = await myShop();
      await setPolicy("country", "MY", "plans.allowed_tiers", '["basic"]');
      await expect(
        assertPlanTierAllowed(deps(), {
          restaurantId: shop.id,
          planTier: "pro",
        }),
      ).rejects.toMatchObject({
        code: "PLAN_NOT_AVAILABLE_IN_REGION",
        status: 400,
      });
    });

    it("fails closed when the country plan policy is corrupt", async () => {
      const shop = await myShop();
      await setPolicy("country", "MY", "plans.allowed_tiers", '["trial"]');
      await expect(
        assertPlanTierAllowed(deps(), {
          restaurantId: shop.id,
          planTier: "pro",
        }),
      ).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE", status: 503 });
    });
  });

  describe("assertMarketFeeWithinRegionCap", () => {
    it("lets a free market through without a country", async () => {
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: null,
          platformFeeRateBps: 0,
        }),
      ).resolves.toBeUndefined();
    });

    it("requires a country for a fee-charging market", async () => {
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: null,
          platformFeeRateBps: 100,
        }),
      ).rejects.toMatchObject({ code: "MARKET_COUNTRY_REQUIRED", status: 400 });
    });

    it("enforces the country cap", async () => {
      await setPolicy("country", "TW", "platform.max_fee_rate_bps", "800");
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: "TW",
          platformFeeRateBps: 900,
        }),
      ).rejects.toMatchObject({
        code: "PLATFORM_FEE_ABOVE_REGION_CAP",
        status: 400,
      });
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: "TW",
          platformFeeRateBps: 800,
        }),
      ).resolves.toBeUndefined();
    });

    it("reads the cap from D1 even when KV still holds the old layer", async () => {
      // A reader cached TW before any cap existed; the cap then lands in D1
      // while that cache entry is still alive (the race in spec §5.2).
      await resolveRegionPolicies(deps(), { countryCode: "TW" });
      await testDb.drizzle.insert(regionPolicies).values({
        scopeType: "country",
        scopeId: "TW",
        policyKey: "platform.max_fee_rate_bps",
        value: "800",
      });

      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: "TW",
          platformFeeRateBps: 900,
        }),
      ).rejects.toMatchObject({ code: "PLATFORM_FEE_ABOVE_REGION_CAP" });
    });

    it("blocks the write when the cap is corrupt", async () => {
      await setPolicy("country", "TW", "platform.max_fee_rate_bps", '"high"');
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: "TW",
          platformFeeRateBps: 100,
        }),
      ).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE", status: 503 });
    });
  });

  describe("resolvePricingRates", () => {
    it("fills unset rates from the country default", async () => {
      await setPolicy("country", "MY", "pricing.default_tax_rate_bps", "600");
      await expect(
        resolvePricingRates(deps(), {
          countryCode: "MY",
          settings: { serviceChargeRate: 0.1 },
        }),
      ).resolves.toEqual({ taxRate: 0.06, serviceChargeRate: 0.1 });
    });

    it("keeps the shop's own rate over the default", async () => {
      await setPolicy("country", "MY", "pricing.default_tax_rate_bps", "600");
      await expect(
        resolvePricingRates(deps(), {
          countryCode: "MY",
          settings: { taxRate: 0, serviceChargeRate: 0 },
        }),
      ).resolves.toEqual({ taxRate: 0, serviceChargeRate: 0 });
    });

    it("falls back to 0 when the policy store is down", async () => {
      await expect(
        resolvePricingRates(brokenKv(), {
          countryCode: "MY",
          settings: null,
        }),
      ).resolves.toEqual({ taxRate: 0, serviceChargeRate: 0 });
    });
  });
});
