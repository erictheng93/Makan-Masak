import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, orders, receipts } from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData } from "../helpers/read-json";

const ENDPOINT = "https://test/api/v1/guest-orders";

interface Shop {
  restaurantId: string;
  menuItemId: number;
}

interface CreatedGuestOrder {
  order: { id: string; status: string; confirmedAt: number | null };
}

describe("Automatic order confirmation — real D1 (#368)", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    await testApp?.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  it("confirms a guest order and queues its kitchen ticket when enabled", async () => {
    const shop = await seedShop(true);
    const response = await postGuestOrder(shop);

    expect(response.status).toBe(201);
    const created = await readData<CreatedGuestOrder>(response);
    expect(created.order).toMatchObject({ status: "confirmed" });
    expect(created.order.confirmedAt).toEqual(expect.any(Number));

    const row = await testApp.testDb.drizzle
      .select({ status: orders.status, confirmedAt: orders.confirmedAt })
      .from(orders)
      .where(eq(orders.id, created.order.id))
      .get();
    expect(row).toMatchObject({ status: "confirmed" });
    expect(row?.confirmedAt).toBeInstanceOf(Date);

    const kitchenTickets = await testApp.testDb.drizzle
      .select({ id: receipts.id })
      .from(receipts)
      .where(eq(receipts.orderId, created.order.id));
    expect(kitchenTickets).toHaveLength(1);
  });

  it.each([undefined, false])(
    "leaves a guest order pending and creates no kitchen ticket when autoAcceptOrders is %s",
    async (autoAcceptOrders) => {
      const shop = await seedShop(autoAcceptOrders);
      const response = await postGuestOrder(shop);

      expect(response.status).toBe(201);
      const created = await readData<CreatedGuestOrder>(response);
      expect(created.order).toMatchObject({ status: "pending" });
      expect(created.order.confirmedAt).toBeNull();

      const row = await testApp.testDb.drizzle
        .select({ status: orders.status, confirmedAt: orders.confirmedAt })
        .from(orders)
        .where(eq(orders.id, created.order.id))
        .get();
      expect(row).toMatchObject({ status: "pending", confirmedAt: null });

      const kitchenTickets = await testApp.testDb.drizzle
        .select({ id: receipts.id })
        .from(receipts)
        .where(eq(receipts.orderId, created.order.id));
      expect(kitchenTickets).toHaveLength(0);
    },
  );

  async function seedShop(autoAcceptOrders?: boolean): Promise<Shop> {
    const restaurant = await seed.restaurant({
      enableShopMode: true,
      settings: {
        allowOnlineOrdering: true,
        allowGuestOrders: true,
        currency: "TWD",
        ...(autoAcceptOrders === undefined ? {} : { autoAcceptOrders }),
      },
    });
    const item = await seed.menuItem(restaurant.id);
    return { restaurantId: restaurant.id, menuItemId: item.id };
  }

  function postGuestOrder(shop: Shop) {
    return testApp.app.fetch(
      new Request(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          restaurantId: shop.restaurantId,
          guestName: "Auto-accept guest",
          orderType: "shop",
          items: [{ menuItemId: shop.menuItemId, quantity: 1 }],
          deliveryInfo: { type: "takeaway" },
        }),
      }),
    );
  }
});
