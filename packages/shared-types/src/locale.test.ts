import { describe, expect, it } from "vitest";
import {
  COUNTRY_PROFILES,
  SUPPORTED_COUNTRIES,
  cityVariants,
  keywordVariants,
  citiesForCountry,
  countryForCity,
  defaultOnboardingLocale,
  normalizeCountryCode,
  selectableCitiesForCountry,
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

  it("hides the 台中市 alias from the selectable list but still accepts it", () => {
    const selectable = selectableCitiesForCountry("TW");
    expect(selectable).toContain("臺中市");
    expect(selectable).not.toContain("台中市");
    expect(citiesForCountry("TW")).toContain("台中市");
    expect(selectableCitiesForCountry("MY")).toEqual(citiesForCountry("MY"));
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

describe("defaultOnboardingLocale", () => {
  it("writes to an applicant in the country's language", () => {
    expect(defaultOnboardingLocale("TW")).toBe("zh-TW");
    expect(defaultOnboardingLocale("MY")).toBe("ms-MY");
  });
});

describe("countryForCity", () => {
  it.each(["台北市", "臺北市", "台中市", "台南市", "台東縣"])(
    "treats 台 and 臺 alike: %s is Taiwan",
    (city) => {
      expect(countryForCity(city)).toBe("TW");
    },
  );

  it("returns null for an unknown city", () => {
    expect(countryForCity("火星市")).toBeNull();
  });
});

describe("cityVariants", () => {
  it("returns every spelling of a city, whichever one is given", () => {
    expect(cityVariants("台中市").sort()).toEqual(["台中市", "臺中市"]);
    expect(cityVariants("臺中市").sort()).toEqual(["台中市", "臺中市"]);
    expect(cityVariants("Kuala Lumpur")).toEqual(["Kuala Lumpur"]);
  });
});

describe("keywordVariants", () => {
  it("adds the swapped spelling in both directions", () => {
    expect(keywordVariants("台中")).toEqual(["台中", "臺中"]);
    expect(keywordVariants("臺中")).toEqual(["臺中", "台中"]);
  });
  it("normalises every occurrence of a mixed query to each form", () => {
    expect(keywordVariants("臺北台南").sort()).toEqual(
      ["臺北台南", "臺北臺南", "台北台南"].sort(),
    );
  });
  it("returns the query itself when it has neither character", () => {
    expect(keywordVariants("牛肉麵")).toEqual(["牛肉麵"]);
    expect(keywordVariants("")).toEqual([""]);
  });
});
