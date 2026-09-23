/**
 * A restaurant created outside onboarding must still get a country, or it
 * silently skips every country ceiling policy set before it existed (region
 * policies spec §4.4). Real D1, because the country is read back from the row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { restaurants } from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { RestaurantService } from "./restaurant";

const base = {
  name: "New Shop",
  type: "restaurant",
  category: "casual",
  address: "1 Test St",
  district: "Test District",
  phone: "0912345678",
};

describe("restaurant country on create", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  const service = () =>
    new RestaurantService(testDb.bindings.DB, { JWT_SECRET: "test" });

  async function stored(id: string) {
    const [row] = await testDb.drizzle
      .select({
        countryCode: restaurants.countryCode,
        timezone: restaurants.timezone,
        settings: restaurants.settings,
      })
      .from(restaurants)
      .where(eq(restaurants.id, id));
    return row;
  }

  it("derives TW, TWD and Asia/Taipei for the default city", async () => {
    const created = await service().createRestaurant(base);
    await expect(stored(String(created.id))).resolves.toMatchObject({
      countryCode: "TW",
      timezone: "Asia/Taipei",
      settings: expect.objectContaining({ currency: "TWD" }),
    });
  });

  it("derives MY and MYR from a Malaysian city", async () => {
    const created = await service().createRestaurant({
      ...base,
      city: "Penang",
    });
    await expect(stored(String(created.id))).resolves.toMatchObject({
      countryCode: "MY",
      timezone: "Asia/Kuala_Lumpur",
      settings: expect.objectContaining({ currency: "MYR" }),
    });
  });

  it("accepts an explicit country for a city outside the lists", async () => {
    const created = await service().createRestaurant({
      ...base,
      city: "Taipei",
      countryCode: "TW",
    });
    await expect(stored(String(created.id))).resolves.toMatchObject({
      countryCode: "TW",
    });
  });

  it("refuses a restaurant whose country cannot be determined", async () => {
    await expect(
      service().createRestaurant({ ...base, city: "Taipei" }),
    ).rejects.toMatchObject({
      code: "RESTAURANT_COUNTRY_REQUIRED",
      status: 400,
    });
  });

  it("refuses a country that contradicts the city", async () => {
    await expect(
      service().createRestaurant({
        ...base,
        city: "Penang",
        countryCode: "TW",
      }),
    ).rejects.toMatchObject({
      code: "RESTAURANT_COUNTRY_CITY_MISMATCH",
      status: 400,
    });
  });

  it("refuses a currency that contradicts the country", async () => {
    await expect(
      service().createRestaurant({
        ...base,
        city: "Penang",
        settings: { currency: "TWD" },
      } as never),
    ).rejects.toMatchObject({
      code: "RESTAURANT_COUNTRY_CURRENCY_MISMATCH",
      status: 400,
    });
  });
});
