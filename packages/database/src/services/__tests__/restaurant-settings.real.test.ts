import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../../testing/create-test-database";
import { RestaurantService } from "../restaurant";

let testDb: TestDatabase;
const id = "settings-rest";

const ratesV1 = {
  versions: [
    {
      effectiveFrom: "2026-01-01",
      paymentFeeBps: { card: 250 },
      platformCommissionBps: {},
    },
  ],
};
const ratesV2 = {
  versions: [
    ...ratesV1.versions,
    {
      effectiveFrom: "2026-11-01",
      paymentFeeBps: { card: 300 },
      platformCommissionBps: { foodpanda: 3000 },
    },
  ],
};

beforeAll(async () => {
  testDb = await createTestDatabase();
}, REAL_D1_SETUP_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.dispose();
});

beforeEach(async () => {
  await testDb.truncateAll();
});

async function seed(settings: string | null) {
  await testDb.db
    .prepare(
      `INSERT INTO restaurants
         (id, name, type, category, address, district, phone, settings, created_at_ms, updated_at_ms)
       VALUES (?, 'Settings Test', 'street_food', 'snack', '1 Test Rd', 'West', '0900000000', ?, 1735689600000, 1735689600000)`,
    )
    .bind(id, settings)
    .run();
}

async function storedSettings(): Promise<unknown> {
  const row = await testDb.db
    .prepare(`SELECT settings FROM restaurants WHERE id = ?`)
    .bind(id)
    .first<{ settings: string | null }>();
  return row?.settings == null ? null : JSON.parse(row.settings);
}

/**
 * A service whose settings read is followed, before the UPDATE runs, by a
 * competing PUT /pnl/:id/rates write (the same json_set PnlService issues).
 */
function serviceWithRatesSaveAfterRead(rates: unknown) {
  const service = new RestaurantService(testDb.bindings.DB, {
    JWT_SECRET: "test",
  });
  const db = (service as unknown as { db: { query: { restaurants: any } } }).db;
  const findFirst = db.query.restaurants.findFirst.bind(db.query.restaurants);
  db.query.restaurants.findFirst = async (...args: unknown[]) => {
    const row = await findFirst(...args);
    await testDb.db
      .prepare(
        `UPDATE restaurants SET settings = json_set(coalesce(settings, '{}'), '$.pnlRates', json(?)) WHERE id = ?`,
      )
      .bind(JSON.stringify(rates), id)
      .run();
    return row;
  };
  return service;
}

describe("RestaurantService.updateRestaurant settings merge (real D1)", () => {
  it("keeps rates saved between the generic update's read and its write", async () => {
    await seed(JSON.stringify({ currency: "TWD", pnlRates: ratesV1 }));

    const result = await serviceWithRatesSaveAfterRead(
      ratesV2,
    ).updateRestaurant(id, {
      settings: { allowGuestOrders: false, pnlRates: { bogus: 1 } } as never,
    });

    expect(await storedSettings()).toEqual({
      currency: "TWD",
      allowGuestOrders: false,
      pnlRates: ratesV2,
    });
    // Never echoed back to the client.
    expect(result.settings).not.toHaveProperty("pnlRates");
  });

  it("does not add a pnlRates key to settings that have none", async () => {
    await seed(JSON.stringify({ currency: "TWD", enableTakeaway: false }));

    await new RestaurantService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    }).updateRestaurant(id, {
      settings: { enableTakeaway: true, minOrderAmount: 300 },
    });

    expect(await storedSettings()).toEqual({
      currency: "TWD",
      enableTakeaway: true,
      minOrderAmount: 300,
    });
  });

  it("keeps a legacy-shape pnlRates as stored", async () => {
    const legacy = { paymentFeeBps: { card: 200 }, platformCommissionBps: {} };
    await seed(JSON.stringify({ currency: "TWD", pnlRates: legacy }));

    await new RestaurantService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    }).updateRestaurant(id, { settings: { autoAcceptOrders: true } });

    expect(await storedSettings()).toEqual({
      currency: "TWD",
      autoAcceptOrders: true,
      pnlRates: legacy,
    });
  });

  it("merges per key at write time: a key changed after the read survives, nulls and objects replace", async () => {
    await seed(
      JSON.stringify({
        currency: "TWD",
        theme: { a: 1, b: 2 },
        note: "x",
      }),
    );
    const service = new RestaurantService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const db = (service as unknown as { db: { query: { restaurants: any } } })
      .db;
    const findFirst = db.query.restaurants.findFirst.bind(db.query.restaurants);
    db.query.restaurants.findFirst = async (...args: unknown[]) => {
      const row = await findFirst(...args);
      await testDb.db
        .prepare(
          `UPDATE restaurants SET settings = json_set(settings, '$.autoAcceptOrders', json('true')) WHERE id = ?`,
        )
        .bind(id)
        .run();
      return row;
    };

    await service.updateRestaurant(id, {
      settings: { theme: { a: 9 }, note: null, "dotted.key": [1] } as never,
    });

    expect(await storedSettings()).toEqual({
      currency: "TWD",
      autoAcceptOrders: true,
      theme: { a: 9 },
      note: null,
      "dotted.key": [1],
    });
  });

  it("unwraps legacy double-encoded settings and keeps their keys", async () => {
    await seed(
      JSON.stringify(
        JSON.stringify({
          currency: "MYR",
          allowGuestOrders: true,
          pnlRates: ratesV1,
        }),
      ),
    );

    await new RestaurantService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    }).updateRestaurant(id, { settings: { allowGuestOrders: false } });

    expect(await storedSettings()).toEqual({
      currency: "MYR",
      allowGuestOrders: false,
      pnlRates: ratesV1,
    });
  });

  it("treats NULL settings as empty", async () => {
    await seed(null);

    await new RestaurantService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    }).updateRestaurant(id, { settings: { enableDineIn: true } });

    expect(await storedSettings()).toEqual({ enableDineIn: true });
  });
});
