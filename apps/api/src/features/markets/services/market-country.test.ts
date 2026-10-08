import { describe, expect, it } from "vitest";
import { resolveMarketCountry, vendorCountry } from "./market-country";

describe("resolveMarketCountry", () => {
  it("derives the country from a known city", () => {
    expect(resolveMarketCountry({ city: "台中市" })).toBe("TW");
    expect(resolveMarketCountry({ city: "Penang" })).toBe("MY");
  });

  it("returns null for an unknown city with no explicit country", () => {
    expect(resolveMarketCountry({ city: "Taichung" })).toBeNull();
  });

  it("accepts an explicit country for an unknown city", () => {
    expect(resolveMarketCountry({ city: "Taichung", countryCode: "TW" })).toBe(
      "TW",
    );
  });

  it("rejects an explicit country that contradicts the city", () => {
    expect(() =>
      resolveMarketCountry({ city: "台中市", countryCode: "MY" }),
    ).toThrow(
      expect.objectContaining({ code: "MARKET_COUNTRY_CITY_MISMATCH" }),
    );
  });
});

describe("vendorCountry", () => {
  it("uses the market's country for a city outside the lists", () => {
    expect(vendorCountry("TW", "Taipei")).toBe("TW");
  });

  it("derives from the city when the market has no country", () => {
    expect(vendorCountry(null, "Penang")).toBe("MY");
  });

  it("rejects a vendor city in another country", () => {
    expect(() => vendorCountry("TW", "Penang")).toThrow(
      expect.objectContaining({ code: "RESTAURANT_COUNTRY_CITY_MISMATCH" }),
    );
  });

  it("rejects a vendor whose country cannot be determined", () => {
    expect(() => vendorCountry(null, "Taipei")).toThrow(
      expect.objectContaining({ code: "RESTAURANT_COUNTRY_REQUIRED" }),
    );
  });
});
