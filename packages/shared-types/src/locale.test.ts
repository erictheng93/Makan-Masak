import { describe, expect, it } from "vitest";
import {
  COUNTRY_PROFILES,
  SUPPORTED_COUNTRIES,
  citiesForCountry,
  normalizeCountryCode,
} from "./locale";

describe("COUNTRY_PROFILES", () => {
  it("maps each supported country to its currency and timezone", () => {
    expect(COUNTRY_PROFILES.TW).toMatchObject({
      currency: "TWD",
      timezone: "Asia/Taipei",
      phonePrefix: "+886",
    });
    expect(COUNTRY_PROFILES.MY).toMatchObject({
      currency: "MYR",
      timezone: "Asia/Kuala_Lumpur",
      phonePrefix: "+60",
    });
  });

  it("only offers countries the platform can actually settle", () => {
    // VND is a supported currency but no Vietnamese payment or invoice
    // support exists, so it must not appear in the onboarding dropdown.
    expect([...SUPPORTED_COUNTRIES]).toEqual(["TW", "MY"]);
  });

  it("gives every country a non-empty city list with no duplicates", () => {
    for (const country of SUPPORTED_COUNTRIES) {
      const cities = citiesForCountry(country);
      expect(cities.length).toBeGreaterThan(0);
      expect(new Set(cities).size).toBe(cities.length);
    }
  });

  it("includes the cities production already uses", () => {
    expect(citiesForCountry("TW")).toContain("台中市");
    expect(citiesForCountry("MY")).toContain("Kuala Lumpur");
  });
});

describe("normalizeCountryCode", () => {
  it.each([
    ["TW", "TW"],
    [" my ", "MY"],
    ["tw", "TW"],
    ["VN", null],
    ["", null],
    [undefined, null],
    [60, null],
  ])("narrows %p to %p", (input, expected) => {
    expect(normalizeCountryCode(input)).toBe(expected);
  });
});
