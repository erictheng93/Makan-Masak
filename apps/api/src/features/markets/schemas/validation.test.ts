import { describe, expect, it } from "vitest";
import {
  bulkCreateMarketsSchema,
  createMarketSchema,
  updateMarketSchema,
} from "./validation";
import { evaluateMarketPublicReadiness } from "../utils/publicReadiness";

const market = {
  slug: "test-market",
  name: "Test Market",
  type: "night_market",
  city: "Taipei",
  district: "Datong",
  address: "Main Street",
  latitude: 25,
  longitude: 121,
};
const readyProfile = {
  ...market,
  description: "A market",
  vendorCount: 1,
  searchableProductCount: 1,
};

describe("market opening hours contract", () => {
  it.each([
    { mon: { open: "10:00", close: "22:00" } },
    { monday: { open: "18:00", close: "02:00" }, tuesday: { closed: true } },
  ])("accepts weekday schedules and overnight hours: %j", (openingHours) => {
    expect(
      createMarketSchema.safeParse({ ...market, openingHours }).success,
    ).toBe(true);
    expect(
      evaluateMarketPublicReadiness({ ...readyProfile, openingHours }).ready,
    ).toBe(true);
  });

  it.each(
    [
      [{ open: "10:00", close: "22:00" }],
      { nonsense: { open: "10:00", close: "22:00" } },
      { mon: { open: "25:00", close: "22:00" } },
      { mon: { open: "10:00" } },
      { mon: "10:00-22:00" },
      { mon: { open: "10:00", close: "22:00", closed: "false" } },
    ].map((openingHours) => ({ openingHours })),
  )(
    "rejects malformed schedules in every write path: %j",
    ({ openingHours }) => {
      expect(
        createMarketSchema.safeParse({ ...market, openingHours }).success,
      ).toBe(false);
      expect(updateMarketSchema.safeParse({ openingHours }).success).toBe(
        false,
      );
      expect(
        bulkCreateMarketsSchema.safeParse({
          markets: [{ ...market, openingHours }],
        }).success,
      ).toBe(false);
      expect(
        evaluateMarketPublicReadiness({ ...readyProfile, openingHours }).ready,
      ).toBe(false);
    },
  );

  it.each([null, {}, { mon: { closed: true } }])(
    "allows incomplete drafts without making them public: %j",
    (openingHours) => {
      expect(
        createMarketSchema.safeParse({ ...market, openingHours }).success,
      ).toBe(true);
      expect(
        evaluateMarketPublicReadiness({ ...readyProfile, openingHours }).issues,
      ).toContainEqual({ key: "openingHours", severity: "required" });
    },
  );

  it("keeps closed-day defaults while parsing the shared contract", () => {
    expect(
      createMarketSchema.parse({
        ...market,
        openingHours: { mon: { closed: true } },
      }).openingHours,
    ).toEqual({ mon: { closed: true, open: "00:00", close: "00:00" } });
  });
});

describe("market country code contract", () => {
  it("accepts supported country codes in create, update, and bulk inputs", () => {
    expect(
      createMarketSchema.parse({ ...market, countryCode: "MY" }),
    ).toHaveProperty("countryCode", "MY");
    expect(updateMarketSchema.parse({ countryCode: "TW" })).toHaveProperty(
      "countryCode",
      "TW",
    );
    expect(
      bulkCreateMarketsSchema.parse({
        markets: [{ ...market, countryCode: "TW" }],
      }).markets[0],
    ).toHaveProperty("countryCode", "TW");
  });

  it("rejects unsupported country codes", () => {
    expect(
      createMarketSchema.safeParse({ ...market, countryCode: "US" }).success,
    ).toBe(false);
  });
});
