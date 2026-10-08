import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orders, waitingList } from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readError } from "../helpers/read-json";

// The onboarding page sends prospects to a real showcase shop (is_demo, 0033).
// They may browse it end to end, but nothing may reach a kitchen or a queue,
// and it must never surface in real customers' discovery results.
describe("Demo restaurant — real D1", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });
  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });
  afterAll(async () => {
    await testApp?.dispose();
  });

  async function seedShop(isDemo: boolean) {
    const restaurant = await seed.restaurant({
      enableShopMode: true,
      isDemo,
      name: isDemo ? "Showcase Kitchen" : "Real Kitchen",
    });
    const item = await seed.menuItem(restaurant.id);
    return { restaurantId: restaurant.id, menuItemId: item.id };
  }

  function postGuestOrder(shop: { restaurantId: string; menuItemId: number }) {
    return testApp.app.fetch(
      new Request("https://test/api/v1/guest-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          restaurantId: shop.restaurantId,
          guestName: "Prospect",
          orderType: "shop",
          items: [{ menuItemId: shop.menuItemId, quantity: 1 }],
          deliveryInfo: { type: "takeaway" },
        }),
      }),
    );
  }

  it("refuses a guest order at the demo shop and writes nothing", async () => {
    const demo = await seedShop(true);

    const response = await postGuestOrder(demo);

    expect(response.status).toBe(403);
    expect((await readError(response)).code).toBe("DEMO_RESTAURANT");
    expect(await testApp.testDb.drizzle.select().from(orders)).toHaveLength(0);
  });

  it("still takes a guest order at an ordinary shop", async () => {
    const real = await seedShop(false);

    const response = await postGuestOrder(real);

    expect(response.status).toBe(201);
    expect(await testApp.testDb.drizzle.select().from(orders)).toHaveLength(1);
  });

  it("refuses to queue a party at the demo shop", async () => {
    const demo = await seedShop(true);

    const response = await testApp.app.fetch(
      new Request("https://test/api/v1/waiting-list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          restaurantId: demo.restaurantId,
          customerName: "Prospect",
          customerPhone: "0912345678",
          partySize: 2,
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect((await readError(response)).code).toBe("DEMO_RESTAURANT");
    expect(
      await testApp.testDb.drizzle.select().from(waitingList),
    ).toHaveLength(0);
  });

  it("tells the customer app the shop is a demo", async () => {
    const demo = await seedShop(true);

    const response = await testApp.app.fetch(
      new Request(`https://test/api/v1/restaurants/${demo.restaurantId}`),
    );

    expect(response.status).toBe(200);
    expect(await readData<{ isDemo: boolean }>(response)).toMatchObject({
      isDemo: true,
    });
  });

  it("keeps the demo shop out of discovery browse", async () => {
    await seedShop(true);
    await seedShop(false);

    const response = await testApp.app.fetch(
      new Request("https://test/api/v1/discovery/restaurants?q=Kitchen"),
    );

    expect(response.status).toBe(200);
    const body = await readData<{ results: { name: string }[] }>(response);
    expect(body.results.map((r) => r.name)).toEqual(["Real Kitchen"]);
  });
});
