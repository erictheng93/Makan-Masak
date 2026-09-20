import { describe, expect, it } from "vitest";
import { buildProvisionedRestaurantValues } from "../services/OnboardingService";

describe("buildProvisionedRestaurantValues", () => {
  const base = {
    id: "rest-1",
    businessName: "Nasi Lemak Stall",
    contactEmail: "owner@example.test",
    phone: "+60123456789",
    address: "Jalan 1",
    district: "Bukit Bintang",
  };

  it("prices a Malaysian shop in MYR on Kuala Lumpur time", () => {
    const values = buildProvisionedRestaurantValues({
      ...base,
      countryCode: "MY",
      city: "Kuala Lumpur",
    });

    expect(values).toMatchObject({
      countryCode: "MY",
      timezone: "Asia/Kuala_Lumpur",
      settings: { currency: "MYR" },
      city: "Kuala Lumpur",
    });
  });

  it("prices a Taiwanese shop in TWD on Taipei time", () => {
    const values = buildProvisionedRestaurantValues({
      ...base,
      countryCode: "TW",
      city: "台中市",
    });

    expect(values).toMatchObject({
      countryCode: "TW",
      timezone: "Asia/Taipei",
      settings: { currency: "TWD" },
      city: "台中市",
    });
  });

  it("uses the selected country's first city for legacy rows without one", () => {
    expect(
      buildProvisionedRestaurantValues({
        ...base,
        countryCode: "MY",
        city: null,
      }).city,
    ).toBe("Kuala Lumpur");
  });

  it("rejects a missing or unsupported stored country", () => {
    expect(() =>
      buildProvisionedRestaurantValues({
        ...base,
        countryCode: null,
        city: "Kuala Lumpur",
      }),
    ).toThrow("Unsupported onboarding country");
    expect(() =>
      buildProvisionedRestaurantValues({
        ...base,
        countryCode: "SG",
        city: "Singapore",
      }),
    ).toThrow("Unsupported onboarding country");
  });
});
