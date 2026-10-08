import { describe, expect, it } from "vitest";
import { countryForCity } from "@makanmasak/shared-types";
import {
  EMPTY_REGION_POLICIES,
  describeRegionPolicies,
  mergeRegionPolicies,
  parseRegionPolicyLayer,
  regionPolicyCacheKey,
  validateRegionPolicyValue,
  type LoadedRegionPolicyLayer,
  type RegionPolicyLayer,
} from "./region-policies";

const loaded = (
  values: RegionPolicyLayer,
  invalidKeys: string[] = [],
): LoadedRegionPolicyLayer => ({ values, invalidKeys });

describe("validateRegionPolicyValue", () => {
  it("accepts a valid module list at country scope", () => {
    expect(
      validateRegionPolicyValue("modules.disabled", "country", ["pos"]),
    ).toEqual({ ok: true, value: ["pos"] });
  });

  it("rejects unknown keys", () => {
    expect(validateRegionPolicyValue("nope", "country", 1)).toMatchObject({
      ok: false,
      code: "POLICY_KEY_UNKNOWN",
    });
  });

  it.each([
    ["modules.disabled", ["pos"]],
    ["pricing.default_tax_rate_bps", 500],
    ["pricing.default_service_charge_rate_bps", 500],
    ["plans.allowed_tiers", ["pro"]],
    ["platform.max_fee_rate_bps", 500],
  ])("keeps %s off the market scope (no market context)", (key, value) => {
    expect(validateRegionPolicyValue(key, "market", value)).toMatchObject({
      ok: false,
      code: "POLICY_SCOPE_NOT_ALLOWED",
    });
  });

  it("allows payment providers at market scope", () => {
    expect(
      validateRegionPolicyValue("payments.allowed_providers", "market", [
        "tng",
      ]),
    ).toEqual({ ok: true, value: ["tng"] });
  });

  it.each([
    ["modules.disabled", ["not_a_module"]],
    ["modules.disabled", ["pos", "pos"]],
    ["payments.allowed_providers", ["touch_n_go"]],
    ["plans.allowed_tiers", ["trial"]],
    ["pricing.default_tax_rate_bps", 10001],
    ["pricing.default_tax_rate_bps", 5.5],
    ["platform.max_fee_rate_bps", -1],
  ])("rejects %s = %j", (key, value) => {
    expect(validateRegionPolicyValue(key, "country", value)).toMatchObject({
      ok: false,
      code: "POLICY_VALUE_INVALID",
    });
  });
});

describe("parseRegionPolicyLayer", () => {
  it("keeps valid rows and reports invalid ones", () => {
    expect(
      parseRegionPolicyLayer("country", [
        { policyKey: "modules.disabled", value: '["pos"]' },
        { policyKey: "pricing.default_tax_rate_bps", value: "not json" },
        { policyKey: "plans.allowed_tiers", value: '["trial"]' },
        { policyKey: "unknown.key", value: "1" },
      ]),
    ).toEqual({
      values: { "modules.disabled": ["pos"] },
      invalidKeys: [
        "pricing.default_tax_rate_bps",
        "plans.allowed_tiers",
        "unknown.key",
      ],
    });
  });
});

describe("mergeRegionPolicies", () => {
  it("is a no-op with no layers", () => {
    expect(mergeRegionPolicies(null, null)).toEqual(EMPTY_REGION_POLICIES);
    expect(EMPTY_REGION_POLICIES.modulesDisabled.size).toBe(0);
    expect(EMPTY_REGION_POLICIES.allowedProviders).toBeNull();
    expect(EMPTY_REGION_POLICIES.defaultTaxRate).toBeNull();
    expect(EMPTY_REGION_POLICIES.allowedPaidTiers).toBeNull();
    expect(EMPTY_REGION_POLICIES.maxFeeRateBps).toBeNull();
    expect(EMPTY_REGION_POLICIES.unavailableKeys.size).toBe(0);
  });

  it("intersects allowed providers and ignores unset layers", () => {
    expect([
      ...mergeRegionPolicies(
        loaded({ "payments.allowed_providers": ["tng", "grabpay"] }),
        loaded({ "payments.allowed_providers": ["tng", "stripe"] }),
      ).allowedProviders!,
    ]).toEqual(["tng"]);
    expect([
      ...mergeRegionPolicies(
        loaded({ "payments.allowed_providers": ["tng"] }),
        loaded({}),
      ).allowedProviders!,
    ]).toEqual(["tng"]);
  });

  it("reads country-only keys and converts bps", () => {
    const merged = mergeRegionPolicies(
      loaded({
        "modules.disabled": ["pos"],
        "pricing.default_tax_rate_bps": 500,
        "pricing.default_service_charge_rate_bps": 1000,
        "plans.allowed_tiers": ["pro"],
        "platform.max_fee_rate_bps": 800,
      }),
      null,
    );
    expect([...merged.modulesDisabled]).toEqual(["pos"]);
    expect(merged.defaultTaxRate).toBe(0.05);
    expect(merged.defaultServiceChargeRate).toBe(0.1);
    expect([...merged.allowedPaidTiers!]).toEqual(["pro"]);
    expect(merged.maxFeeRateBps).toBe(800);
  });

  it("marks invalid ceiling keys unavailable from either layer", () => {
    const merged = mergeRegionPolicies(
      loaded({}, ["modules.disabled", "platform.max_fee_rate_bps"]),
      loaded({}, ["payments.allowed_providers"]),
    );
    expect([...merged.unavailableKeys].sort()).toEqual([
      "modules.disabled",
      "payments.allowed_providers",
      "platform.max_fee_rate_bps",
    ]);
  });

  it("treats invalid default keys and unknown keys as unset, not unavailable", () => {
    const merged = mergeRegionPolicies(
      loaded({}, ["pricing.default_tax_rate_bps", "unknown.key"]),
      null,
    );
    expect(merged.unavailableKeys.size).toBe(0);
    expect(merged.defaultTaxRate).toBeNull();
  });
});

describe("helpers", () => {
  it("builds scope cache keys", () => {
    expect(regionPolicyCacheKey("country", "MY")).toBe("policy:v1:country:MY");
  });

  it("describes every key for the portal", () => {
    expect(describeRegionPolicies().map((d) => d.key)).toEqual([
      "modules.disabled",
      "payments.allowed_providers",
      "pricing.default_tax_rate_bps",
      "pricing.default_service_charge_rate_bps",
      "plans.allowed_tiers",
      "platform.max_fee_rate_bps",
    ]);
  });

  it.each([
    ["台中市", "TW"],
    ["臺中市", "TW"],
    ["Selangor", "MY"],
    ["Taichung", null],
    ["Hanoi", null],
  ])("maps city %s to %s", (city, country) => {
    expect(countryForCity(city)).toBe(country);
  });
});
