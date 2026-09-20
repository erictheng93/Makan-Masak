import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { restaurants } from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  assertClientCurrencyMatches,
  countryForCurrency,
  currencyFromRestaurantSettings,
  displayCurrencyFromRestaurantSettings,
  resolveCurrencyForRequest,
  resolveRestaurantCurrency,
  resolveSharedRestaurantCurrency,
  sharedCurrency,
} from "./restaurant-currency";

function expectApiError(fn: () => unknown, code: string, status: number) {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code, status });
    return;
  }
  throw new Error(`expected ${code} to be thrown`);
}

describe("currencyFromRestaurantSettings", () => {
  it("reads a supported currency, normalising case and whitespace", () => {
    expect(currencyFromRestaurantSettings({ currency: "MYR" }, "r1")).toBe(
      "MYR",
    );
    expect(currencyFromRestaurantSettings({ currency: " vnd " }, "r1")).toBe(
      "VND",
    );
  });

  it("defaults an unset currency to TWD", () => {
    for (const settings of [
      null,
      undefined,
      {},
      { currency: null },
      { currency: "" },
      { currency: "   " },
      [],
      42,
      "not json",
    ]) {
      expect(currencyFromRestaurantSettings(settings, "r1")).toBe("TWD");
    }
  });

  it("reads a double-encoded settings string", () => {
    expect(
      currencyFromRestaurantSettings(JSON.stringify({ currency: "MYR" }), "r1"),
    ).toBe("MYR");
  });

  it("fails closed on a currency that is set but unsupported", () => {
    for (const currency of ["USD", "NTD", 458, true]) {
      expectApiError(
        () => currencyFromRestaurantSettings({ currency }, "r1"),
        "RESTAURANT_CURRENCY_INVALID",
        500,
      );
    }
  });
});

describe("displayCurrencyFromRestaurantSettings", () => {
  it("reads what the strict variant reads", () => {
    expect(displayCurrencyFromRestaurantSettings({ currency: " myr " })).toBe(
      "MYR",
    );
    expect(
      displayCurrencyFromRestaurantSettings(
        JSON.stringify({ currency: "VND" }),
      ),
    ).toBe("VND");
    expect(displayCurrencyFromRestaurantSettings(null)).toBe("TWD");
  });

  it("labels an unsupported currency as the default instead of throwing", () => {
    for (const currency of ["USD", "NTD", 458, true]) {
      expect(displayCurrencyFromRestaurantSettings({ currency })).toBe("TWD");
    }
  });
});

describe("countryForCurrency", () => {
  it("maps each currency to its settlement country", () => {
    expect(countryForCurrency("TWD")).toBe("TW");
    expect(countryForCurrency("MYR")).toBe("MY");
    expect(countryForCurrency("VND")).toBe("VN");
  });
});

describe("sharedCurrency", () => {
  it("returns the currency every restaurant shares", () => {
    expect(
      sharedCurrency([
        { restaurantId: "a", currency: "MYR" },
        { restaurantId: "b", currency: "MYR" },
      ]),
    ).toBe("MYR");
  });

  it("rejects vendors in different currencies", () => {
    try {
      sharedCurrency([
        { restaurantId: "a", currency: "TWD" },
        { restaurantId: "b", currency: "MYR" },
      ]);
      throw new Error("expected MIXED_CURRENCY_CHECKOUT");
    } catch (error) {
      // The distinct codes, not a restaurantId -> code map: the caller needs
      // to know the cart spans currencies, not a per-tenant readout of how
      // each vendor is configured.
      expect(error).toMatchObject({
        code: "MIXED_CURRENCY_CHECKOUT",
        status: 409,
        details: { currencies: ["MYR", "TWD"] },
      });
      expect(
        JSON.stringify((error as { details: unknown }).details),
      ).not.toContain('"a"');
    }
  });

  it("rejects an empty set", () => {
    expectApiError(() => sharedCurrency([]), "BAD_REQUEST", 400);
  });
});

describe("assertClientCurrencyMatches / resolveCurrencyForRequest", () => {
  it("accepts an absent or matching client claim", () => {
    expect(() => assertClientCurrencyMatches("MYR", {})).not.toThrow();
    expect(() =>
      assertClientCurrencyMatches("MYR", { currency: null, country: null }),
    ).not.toThrow();
    expect(() =>
      assertClientCurrencyMatches("MYR", { currency: "myr", country: "my" }),
    ).not.toThrow();
  });

  it("rejects a different currency or country", () => {
    expectApiError(
      () => assertClientCurrencyMatches("MYR", { currency: "TWD" }),
      "CURRENCY_MISMATCH",
      400,
    );
    expectApiError(
      () => assertClientCurrencyMatches("MYR", { country: "TW" }),
      "CURRENCY_MISMATCH",
      400,
    );
  });

  it("returns the server currency and derived country", () => {
    expect(resolveCurrencyForRequest("VND", {})).toEqual({
      currency: "VND",
      country: "VN",
    });
    expectApiError(
      () => resolveCurrencyForRequest("VND", { currency: "TWD" }),
      "CURRENCY_MISMATCH",
      400,
    );
  });
});

describe("restaurant currency resolution against real D1", () => {
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

  async function seedRestaurant(settings: Record<string, unknown> | null) {
    const now = new Date();
    const [row] = await testDb.drizzle
      .insert(restaurants)
      .values({
        name: `Currency ${crypto.randomUUID()}`,
        type: "cafe",
        category: "food",
        address: "1 Currency Street",
        district: "Central",
        city: "Taipei",
        phone: "0200000000",
        email: `currency-${crypto.randomUUID()}@example.com`,
        businessHours: {},
        settings,
        isAvailable: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      } as never)
      .returning({ id: restaurants.id });
    return row!.id;
  }

  it("resolves a restaurant's own currency, defaulting when unset", async () => {
    const myr = await seedRestaurant({ currency: "MYR" });
    const unset = await seedRestaurant(null);

    await expect(resolveRestaurantCurrency(testDb.db, myr)).resolves.toBe(
      "MYR",
    );
    await expect(resolveRestaurantCurrency(testDb.db, unset)).resolves.toBe(
      "TWD",
    );
  });

  it("fails closed on an unsupported stored currency", async () => {
    const usd = await seedRestaurant({ currency: "USD" });
    await expect(
      resolveRestaurantCurrency(testDb.db, usd),
    ).rejects.toMatchObject({ code: "RESTAURANT_CURRENCY_INVALID" });
  });

  it("reports a missing restaurant", async () => {
    await expect(
      resolveRestaurantCurrency(testDb.db, "missing"),
    ).rejects.toMatchObject({ code: "RESTAURANT_NOT_FOUND", status: 404 });
    const myr = await seedRestaurant({ currency: "MYR" });
    await expect(
      resolveSharedRestaurantCurrency(testDb.db, [myr, "missing"]),
    ).rejects.toMatchObject({ code: "RESTAURANT_NOT_FOUND" });
  });

  it("resolves the currency a set of restaurants shares", async () => {
    const a = await seedRestaurant({ currency: "MYR" });
    const b = await seedRestaurant({ currency: "myr" });
    const twd = await seedRestaurant({});

    await expect(
      resolveSharedRestaurantCurrency(testDb.db, [a, b, a]),
    ).resolves.toBe("MYR");
    await expect(
      resolveSharedRestaurantCurrency(testDb.db, [a, twd]),
    ).rejects.toMatchObject({ code: "MIXED_CURRENCY_CHECKOUT", status: 409 });
    await expect(
      resolveSharedRestaurantCurrency(testDb.db, []),
    ).rejects.toMatchObject({ status: 400 });
  });
});
