import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, restaurants } from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";

const CSRF_TOKEN = "c".repeat(64);
const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  "x-csrf-token": CSRF_TOKEN,
  cookie: `csrf_token=${CSRF_TOKEN}`,
};

const PNL_RATES = {
  paymentFeeBps: { card: 250, line_pay: 220 },
  platformCommissionBps: { uber_eats: 3000 },
};

// pnlRates is owner-only (served by /pnl/rates); it must never reach a
// restaurant payload, and hiding it must not let a settings save erase it.
describe("restaurant pnlRates privacy — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: SeedHelpers;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  async function shopWithOwner() {
    const restaurant = await seed.restaurant({
      settings: { currency: "TWD", pnlRates: PNL_RATES },
    });
    const owner = await seed.user({ restaurantId: restaurant.id, role: 1 });
    const token = await testApp.authHelper.ownerToken(owner.id, restaurant.id);
    return { restaurantId: restaurant.id, token };
  }

  const publicRead = (restaurantId: string) =>
    testApp.app.fetch(
      new Request(`https://test/api/v1/restaurants/${restaurantId}`),
    );

  const update = (
    restaurantId: string,
    token: string,
    settings: Record<string, unknown>,
  ) =>
    testApp.app.fetch(
      new Request(`https://test/api/v1/restaurants/${restaurantId}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...CSRF_HEADERS,
        },
        body: JSON.stringify({ settings }),
      }),
    );

  const storedSettings = async (restaurantId: string) => {
    const [row] = await testApp.testDb.drizzle
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId));
    return row.settings as Record<string, unknown>;
  };

  it("keeps pnlRates out of the public restaurant read, cached or not", async () => {
    const shop = await shopWithOwner();

    for (let i = 0; i < 2; i++) {
      const response = await publicRead(shop.restaurantId);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { settings?: Record<string, unknown> };
      };
      expect(body.data.settings).toMatchObject({ currency: "TWD" });
      expect(body.data.settings).not.toHaveProperty("pnlRates");
    }
  });

  it("preserves pnlRates through an ordinary settings save", async () => {
    const shop = await shopWithOwner();

    // What the admin settings page sends: its own keys only.
    const save = await update(shop.restaurantId, shop.token, {
      currency: "TWD",
      allowGuestOrders: false,
    });
    expect(save.status).toBe(200);
    const saved = (await save.json()) as {
      data: { settings?: Record<string, unknown> };
    };
    expect(saved.data.settings).not.toHaveProperty("pnlRates");

    // A client echoing back the (stripped) settings it read.
    const read = (await (await publicRead(shop.restaurantId)).json()) as {
      data: { settings: Record<string, unknown> };
    };
    const echo = await update(
      shop.restaurantId,
      shop.token,
      read.data.settings,
    );
    expect(echo.status).toBe(200);

    expect(await storedSettings(shop.restaurantId)).toMatchObject({
      currency: "TWD",
      allowGuestOrders: false,
      pnlRates: PNL_RATES,
    });
  });

  it("never writes pnlRates through the generic settings save", async () => {
    const shop = await shopWithOwner();

    // The key is dropped, not refused: PUT /pnl/:id/rates is its only writer.
    const res = await update(shop.restaurantId, shop.token, {
      allowGuestOrders: false,
      pnlRates: { versions: [] },
    });

    expect(res.status).toBe(200);
    expect(await storedSettings(shop.restaurantId)).toMatchObject({
      pnlRates: PNL_RATES,
    });
  });
});
