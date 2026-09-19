import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { coupons, menuItems, orders, splitBills } from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, type ServiceData } from "../helpers/read-json";
import type { OrdersService } from "../../features/orders/services/OrdersService";
import { GroupOrdersService } from "../../features/group-orders/services/GroupOrdersService";

type Order = NonNullable<ServiceData<OrdersService["getOrder"]>>;

/**
 * Money on each currency's real precision, end to end through the routes:
 * TWD and VND derived amounts are whole units, MYR keeps the sen, and a TWD
 * restaurant cannot be configured with a fractional price.
 */
function csrfHeaders(bearer: string) {
  const csrfToken = "a".repeat(64);
  return {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    host: "test",
    origin: "https://test",
    "x-csrf-token": csrfToken,
    cookie: `csrf_token=${csrfToken}`,
  };
}

describe("currency precision — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  async function insertActiveSubscription(restaurantId: string) {
    await testApp.env.DB.prepare(
      `INSERT INTO shop_subscriptions
        (id, restaurant_id, plan_tier, module_overrides,
         is_active, trial_ends_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'trial', '{}', 1, ?, ?, ?)`,
    )
      .bind(
        `sub-${restaurantId}`,
        restaurantId,
        Date.now() + 24 * 60 * 60 * 1000,
        Date.now(),
        Date.now(),
      )
      .run();
  }

  async function restaurantWith(settings: Record<string, unknown>) {
    const restaurant = await seed.restaurant({
      enableShopMode: true,
      settings: {
        allowOnlineOrdering: true,
        allowGuestOrders: true,
        ...settings,
      },
    });
    const restaurantId = String(restaurant.id);
    await seed.user({
      id: 1,
      role: 0,
      username: `admin-${restaurantId.slice(-6)}`,
      restaurantId,
    });
    const token = await testApp.authHelper.adminToken(restaurantId);
    return { restaurantId, token };
  }

  async function placeOrder(
    settings: Record<string, unknown>,
    priceCents: number,
    extra: Record<string, unknown> = {},
  ) {
    const { restaurantId, token } = await restaurantWith(settings);
    const item = await seed.menuItem(restaurantId, {
      isAvailable: true,
      priceCents,
    });
    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/orders", {
        method: "POST",
        headers: csrfHeaders(token),
        body: JSON.stringify({
          restaurantId,
          items: [{ menuItemId: item.id, quantity: 1 }],
          ...extra,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const order = await readData<Order>(res);
    const [row] = await testApp.testDb.drizzle
      .select()
      .from(orders)
      .where(eq(orders.id, order.id));
    return { order, row, restaurantId };
  }

  describe("orders", () => {
    it("TWD NT$155 + 10% service = NT$16 service, NT$171 total", async () => {
      const { order, row } = await placeOrder(
        { currency: "TWD", serviceChargeRate: 0.1 },
        15500,
      );
      expect(row).toMatchObject({
        serviceChargeCents: 1600,
        totalAmountCents: 17100,
      });
      expect(order).toMatchObject({ serviceCharge: 16, totalAmount: 171 });
    });

    it("TWD 5% tax on NT$355 = NT$18, total NT$373", async () => {
      const { row } = await placeOrder(
        { currency: "TWD", taxRate: 0.05 },
        35500,
      );
      expect(row).toMatchObject({
        taxAmountCents: 1800,
        totalAmountCents: 37300,
      });
    });

    it("VND 8% on 12,345 = 988", async () => {
      const { row } = await placeOrder(
        { currency: "VND", taxRate: 0.08 },
        1234500,
      );
      expect(row).toMatchObject({
        taxAmountCents: 98800,
        totalAmountCents: 1333300,
      });
    });

    it("MYR keeps sen: RM155 + 10% = RM15.50", async () => {
      const { row } = await placeOrder(
        { currency: "MYR", serviceChargeRate: 0.1 },
        15500,
      );
      expect(row).toMatchObject({
        serviceChargeCents: 1550,
        totalAmountCents: 17050,
      });
    });

    it("a 15% coupon on NT$155 takes NT$23", async () => {
      const { restaurantId, token } = await restaurantWith({ currency: "TWD" });
      const item = await seed.menuItem(restaurantId, {
        isAvailable: true,
        priceCents: 15500,
      });
      await testApp.testDb.drizzle.insert(coupons).values({
        restaurantId,
        code: "PCT15",
        name: "15% off",
        discountType: "percentage",
        discountPercentageBps: 1500,
        validFrom: new Date(Date.now() - 86_400_000),
        validTo: new Date(Date.now() + 86_400_000),
        isActive: true,
        isVisible: true,
      });

      const res = await testApp.app.fetch(
        new Request("https://test/api/v1/orders", {
          method: "POST",
          headers: csrfHeaders(token),
          body: JSON.stringify({
            restaurantId,
            items: [{ menuItemId: item.id, quantity: 1 }],
            couponCode: "PCT15",
          }),
        }),
      );

      expect(res.status).toBe(201);
      const order = await readData<Order>(res);
      expect(order).toMatchObject({ discountAmount: 23, totalAmount: 132 });
    });
  });

  describe("configuration precision", () => {
    it("rejects a NT$12.50 menu price for TWD and accepts RM12.50 for MYR", async () => {
      for (const [currency, expectedStatus] of [
        ["TWD", 400],
        ["MYR", 201],
      ] as const) {
        await testApp.testDb.truncateAll();
        const { restaurantId, token } = await restaurantWith({ currency });
        await insertActiveSubscription(restaurantId);
        const item = await seed.menuItem(restaurantId, { isAvailable: true });
        const [category] = await testApp.testDb.drizzle
          .select({ categoryId: menuItems.categoryId })
          .from(menuItems)
          .where(eq(menuItems.id, item.id));

        const res = await testApp.app.fetch(
          new Request(`https://test/api/v1/menu/${restaurantId}/items`, {
            method: "POST",
            headers: csrfHeaders(token),
            body: JSON.stringify({
              categoryId: category.categoryId,
              name: "Tea",
              price: 12.5,
            }),
          }),
        );

        expect(res.status).toBe(expectedStatus);
        if (expectedStatus === 400) {
          await expect(res.json()).resolves.toMatchObject({
            success: false,
            error: {
              code: "CURRENCY_PRECISION",
              details: {
                currency: "TWD",
                fields: [{ field: "price", amount: 12.5 }],
              },
            },
          });
        }
      }
    });

    it("rejects a fractional fixed coupon amount for TWD", async () => {
      const { restaurantId, token } = await restaurantWith({ currency: "TWD" });

      const res = await testApp.app.fetch(
        new Request("https://test/api/v1/coupons", {
          method: "POST",
          headers: csrfHeaders(token),
          body: JSON.stringify({
            code: "HALF",
            name: "Half dollar",
            discountType: "fixed",
            discountValue: 12.5,
            validFrom: new Date(Date.now()).toISOString(),
            validTo: new Date(Date.now() + 86_400_000).toISOString(),
            restaurantId,
          }),
        }),
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: { code: "CURRENCY_PRECISION" },
      });
    });

    it("rejects a fractional TWD delivery fee in restaurant settings", async () => {
      const { restaurantId, token } = await restaurantWith({ currency: "TWD" });

      const res = await testApp.app.fetch(
        new Request(`https://test/api/v1/restaurants/${restaurantId}`, {
          method: "PUT",
          headers: csrfHeaders(token),
          body: JSON.stringify({ settings: { deliveryFee: 12.5 } }),
        }),
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: "CURRENCY_PRECISION",
          details: {
            fields: [{ field: "settings.deliveryFee", amount: 12.5 }],
          },
        },
      });
    });
  });

  describe("group orders", () => {
    it("splits NT$100 three ways as 34/33/33", async () => {
      const { restaurantId } = await restaurantWith({ currency: "TWD" });
      const item = await seed.menuItem(restaurantId, {
        isAvailable: true,
        priceCents: 10000,
      });
      const service = () =>
        new GroupOrdersService(testApp.env.DB, testApp.env.CACHE_KV);
      const created = await service().createGroupOrder(
        { restaurantId, hostName: "Host" } as never,
        null,
      );
      if (!created.data) throw new Error(created.error);
      const { groupOrderId, shareCode } = created.data;
      for (const memberName of ["Bo", "Cy"]) {
        const joined = await service().joinGroup(shareCode, { memberName });
        if (!joined.success) throw new Error(joined.error);
      }
      await service().addCartItem(groupOrderId, {
        memberId: created.data.host.id,
        menuItemId: Number(item.id),
        quantity: 1,
      } as never);

      const result = await service().splitBill(groupOrderId, {
        splitType: "equal",
      });

      expect(result.success).toBe(true);
      const bills = await testApp.testDb.drizzle
        .select({ totalAmountCents: splitBills.totalAmountCents })
        .from(splitBills)
        .where(eq(splitBills.groupOrderId, groupOrderId));
      expect(
        bills.map((bill) => bill.totalAmountCents).sort((a, b) => b! - a!),
      ).toEqual([3400, 3300, 3300]);
    });

    it("POST /split rejects an off-step TWD shared amount and leaves the bills alone", async () => {
      const { restaurantId } = await restaurantWith({ currency: "TWD" });
      const item = await seed.menuItem(restaurantId, {
        isAvailable: true,
        priceCents: 10000,
      });
      const service = () =>
        new GroupOrdersService(testApp.env.DB, testApp.env.CACHE_KV);
      const created = await service().createGroupOrder(
        { restaurantId, hostName: "Host" } as never,
        null,
      );
      if (!created.data) throw new Error(created.error);
      const { groupOrderId, memberToken } = created.data;
      await service().addCartItem(groupOrderId, {
        memberId: created.data.host.id,
        menuItemId: Number(item.id),
        quantity: 1,
      } as never);

      const billTotals = async () =>
        (
          await testApp.testDb.drizzle
            .select({ totalAmountCents: splitBills.totalAmountCents })
            .from(splitBills)
            .where(eq(splitBills.groupOrderId, groupOrderId))
        ).map((bill) => bill.totalAmountCents);
      // Adding to the cart already keeps a running bill per member.
      const before = await billTotals();

      const csrfToken = "a".repeat(64);
      const split = (body: Record<string, unknown>) =>
        testApp.app.fetch(
          new Request(
            `https://test/api/v1/orders/group/${groupOrderId}/split`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                host: "test",
                origin: "https://test",
                "x-csrf-token": csrfToken,
                cookie: `csrf_token=${csrfToken}`,
              },
              body: JSON.stringify({
                memberToken,
                splitType: "equal",
                ...body,
              }),
            },
          ),
        );

      const rejected = await split({
        sharedServiceChargeCents: 1250,
        sharedTaxCents: 500,
      });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({
        success: false,
        error: {
          code: "CURRENCY_PRECISION",
          details: {
            currency: "TWD",
            fields: [{ field: "sharedServiceChargeCents", amount: 12.5 }],
          },
        },
      });
      expect(await billTotals()).toEqual(before);

      const accepted = await split({
        sharedServiceChargeCents: 1000,
        sharedTaxCents: 500,
      });
      expect(accepted.status).toBe(200);
      expect(await billTotals()).toEqual([11500]);
    });
  });
});
