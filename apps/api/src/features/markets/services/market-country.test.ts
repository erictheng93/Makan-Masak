import { describe, expect, it } from "vitest";
import { resolveMarketCountry } from "./market-country";

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
