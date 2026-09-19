import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { categories, menuItems, orders, restaurants } from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { OrderService } from "./order";

const restaurantId = "restaurant-delivery-test";
const menuItemId = 501;

type FulfillmentSettings = {
  enableDelivery?: boolean;
  deliveryFee?: number;
  supportsDelivery?: boolean;
};

/**
 * 外送費從未被計入訂單總額，且伺服器端從不檢查 `enableDelivery`（#295）。
 *
 * 兩者都只在建單服務層看得到，所以測試打的是 `OrderService.createOrder`
 * 本身，而不是任何一條路由 —— orders / guest-orders / market-checkouts /
 * group-orders 都會走到這裡。
 */
describe("OrderService delivery orders", () => {
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
    new OrderService(testDb.bindings.DB, { JWT_SECRET: "test" });

  const deliveryAddress = {
    type: "delivery" as const,
    address: "1 Jalan Test",
    phone: "0912345678",
  };

  async function seedShop({
    enableDelivery,
    deliveryFee,
    supportsDelivery = false,
  }: FulfillmentSettings) {
    await testDb.drizzle.insert(restaurants).values({
      id: restaurantId,
      name: "Delivery Test Restaurant",
      type: "restaurant",
      category: "casual",
      address: "1 Test St",
      district: "Test District",
      city: "Test City",
      phone: "0912345678",
      isAvailable: true,
      supportsDelivery,
      settings: {
        taxRate: 0,
        serviceChargeRate: 0,
        minOrderAmount: 0,
        enableDelivery,
        deliveryFee,
      },
    });

    const [category] = await testDb.drizzle
      .insert(categories)
      .values({ restaurantId, name: "Meals", sortOrder: 1 })
      .returning({ id: categories.id });

    await testDb.drizzle.insert(menuItems).values({
      id: menuItemId,
      restaurantId,
      categoryId: category.id,
      name: "Nasi Lemak",
      priceCents: 1000,
      isAvailable: true,
      inventoryCount: 10,
    });
  }

  describe("delivery fee reaches the amount the customer pays", () => {
    it("adds the shop's delivery fee to the order total", async () => {
      await seedShop({ enableDelivery: true, deliveryFee: 5 });

      const order = await service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryInfo: deliveryAddress,
      });

      expect(order.subtotal).toBe(10);
      expect(order.totalAmount).toBe(15);
    });

    // 外送費原本是顧客端送上來的，所以「自己填 0 元外送費」是成立的。
    it("prices from the shop settings, not from the request body", async () => {
      await seedShop({ enableDelivery: true, deliveryFee: 5 });

      const order = await service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryInfo: { ...deliveryAddress, deliveryFee: 0 },
      });

      expect(order.totalAmount).toBe(15);
      expect(order.deliveryInfo?.deliveryFee).toBe(5);
    });

    it("charges nothing extra when the shop set no fee", async () => {
      await seedShop({ enableDelivery: true });

      const order = await service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryInfo: { ...deliveryAddress, deliveryFee: 99 },
      });

      expect(order.totalAmount).toBe(10);
    });

    it("keeps tax and service charge off the delivery fee", async () => {
      await seedShop({ enableDelivery: true, deliveryFee: 5 });
      await testDb.drizzle
        .update(restaurants)
        .set({
          settings: {
            taxRate: 0.1,
            serviceChargeRate: 0.1,
            minOrderAmount: 0,
            enableDelivery: true,
            deliveryFee: 5,
          },
        })
        .where(eq(restaurants.id, restaurantId));

      const order = await service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryInfo: deliveryAddress,
      });

      // 10 餐點 + 1 稅 + 1 服務費 + 5 外送費，稅基是 subtotal 而非含運總額。
      expect(order.taxAmount).toBe(1);
      expect(order.serviceCharge).toBe(1);
      expect(order.totalAmount).toBe(17);
    });

    // addItemsToOrder 重算整張訂單而非加總差額，漏掉外送費就等於加點一次
    // 免掉一次運費。
    it("keeps the delivery fee when items are added later", async () => {
      await seedShop({ enableDelivery: true, deliveryFee: 5 });

      const order = await service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryInfo: deliveryAddress,
      });
      const updated = await service().addItemsToOrder(order.id, [
        { menuItemId, quantity: 1 },
      ]);

      expect(updated.subtotal).toBe(20);
      expect(updated.totalAmount).toBe(25);
    });

    // changeOrderItemQuantity recomputes the whole order too, and used to
    // leave the fee out: raising or lowering a line waived the courier.
    it("keeps the delivery fee when a line's quantity changes", async () => {
      await seedShop({ enableDelivery: true, deliveryFee: 5 });

      const order = await service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 2 }],
        deliveryInfo: deliveryAddress,
      });
      expect(order.totalAmount).toBe(25);
      const lineId = order.items![0].id;

      const raised = await service().changeOrderItemQuantity(
        order.id,
        lineId,
        3,
      );
      expect(raised.subtotal).toBe(30);
      expect(raised.totalAmount).toBe(35);

      const lowered = await service().changeOrderItemQuantity(
        order.id,
        lineId,
        1,
      );
      expect(lowered.subtotal).toBe(10);
      expect(lowered.totalAmount).toBe(15);

      const [row] = await testDb.drizzle
        .select({ totalAmountCents: orders.totalAmountCents })
        .from(orders)
        .where(eq(orders.id, order.id));
      expect(row.totalAmountCents).toBe(1500);
    });

    it("leaves takeaway and dine-in totals untouched", async () => {
      await seedShop({ enableDelivery: true, deliveryFee: 5 });

      const takeaway = await service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryInfo: { type: "takeaway", deliveryFee: 5 },
      });

      expect(takeaway.totalAmount).toBe(10);
      expect(takeaway.deliveryInfo?.deliveryFee).toBe(0);
    });
  });

  describe("enableDelivery gate", () => {
    it("refuses a delivery order when the shop never enabled delivery", async () => {
      await seedShop({ deliveryFee: 5 });

      await expect(
        service().createOrder({
          restaurantId,
          items: [{ menuItemId, quantity: 1 }],
          deliveryInfo: deliveryAddress,
        }),
      ).rejects.toThrow("DELIVERY_NOT_ENABLED");

      expect(await testDb.drizzle.select().from(orders)).toHaveLength(0);
    });

    it("refuses a delivery order when the shop turned delivery off", async () => {
      await seedShop({ enableDelivery: false, deliveryFee: 5 });

      await expect(
        service().createOrder({
          restaurantId,
          items: [{ menuItemId, quantity: 1 }],
          deliveryInfo: deliveryAddress,
        }),
      ).rejects.toThrow("DELIVERY_NOT_ENABLED");
    });

    // 探索頁的「可外送」標籤讀的是 supports_delivery 欄位。掛著標籤卻拒收自己
    // 招來的訂單，比放行更糟。
    it("accepts a delivery order carried by the supports_delivery column alone", async () => {
      await seedShop({ supportsDelivery: true, deliveryFee: 5 });

      const order = await service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
        deliveryInfo: deliveryAddress,
      });

      expect(order.totalAmount).toBe(15);
    });

    // 內用/外帶的旗標對從未存過設定的店家是 undefined，不能當成「關閉」。
    it("does not gate takeaway or dine-in", async () => {
      await seedShop({});

      await expect(
        service().createOrder({
          restaurantId,
          items: [{ menuItemId, quantity: 1 }],
          deliveryInfo: { type: "takeaway" },
        }),
      ).resolves.toMatchObject({ totalAmount: 10 });

      await expect(
        service().createOrder({
          restaurantId,
          items: [{ menuItemId, quantity: 1 }],
          deliveryInfo: { type: "dine_in" },
        }),
      ).resolves.toMatchObject({ totalAmount: 10 });
    });
  });
});
