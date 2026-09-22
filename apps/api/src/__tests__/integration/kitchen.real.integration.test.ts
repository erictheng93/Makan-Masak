import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import { eq } from "drizzle-orm";
import {
  categories,
  menuItems,
  orderItems,
  orders,
  restaurants,
} from "@makanmasak/database";
import type { Env } from "../../types/env";
import { KitchenService } from "../../features/kitchen/services/KitchenService";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.dispose();
});

beforeEach(async () => {
  await testDb.truncateAll();
});

function buildEnv(): Env {
  return {
    DB: testDb.bindings.DB,
    CACHE_KV: testDb.bindings.CACHE_KV,
  } as Env;
}

describe("KitchenService real D1 integration", () => {
  it("links kitchen item progress to canonical order timestamps", async () => {
    const now = new Date("2026-06-07T12:00:00.000Z");
    const restaurantId = "kitchen-real-restaurant";

    await testDb.drizzle.insert(restaurants).values({
      id: restaurantId,
      name: "Kitchen Real Restaurant",
      type: "restaurant",
      category: "casual",
      address: "1 Kitchen St",
      district: "Central",
      city: "Taipei",
      phone: "0200000000",
      settings: {},
      isAvailable: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    } as never);

    const [category] = await testDb.drizzle
      .insert(categories)
      .values({
        restaurantId,
        name: "Mains",
        sortOrder: 1,
        isActive: true,
        isVisible: true,
        createdAt: now,
        updatedAt: now,
      } as never)
      .returning();

    const [menuItem] = await testDb.drizzle
      .insert(menuItems)
      .values({
        restaurantId,
        categoryId: category.id,
        name: "Nasi Lemak",
        price: 120,
        priceCents: 12000,
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      } as never)
      .returning();

    const [order] = await testDb.drizzle
      .insert(orders)
      .values({
        restaurantId,
        orderNumber: "KIT-001",
        status: "confirmed",
        orderType: "table",
        orderSource: "direct",
        subtotal: 120,
        totalAmount: 120,
        subtotalCents: 12000,
        totalAmountCents: 12000,
        taxAmount: 0,
        taxAmountCents: 0,
        serviceCharge: 0,
        serviceChargeCents: 0,
        discountAmount: 0,
        discountAmountCents: 0,
        paymentStatus: "pending",
        customerInfo: {},
        promotionIds: [],
        createdAt: now,
        updatedAt: now,
      } as never)
      .returning();

    const [orderItem] = await testDb.drizzle
      .insert(orderItems)
      .values({
        orderId: order.id,
        menuItemId: menuItem.id,
        quantity: 1,
        unitPrice: 120,
        totalPrice: 120,
        unitPriceCents: 12000,
        totalPriceCents: 12000,
        status: "pending",
        itemSnapshot: { name: "Nasi Lemak", price: 120 },
        createdAt: now,
        updatedAt: now,
      } as never)
      .returning();

    const kitchenService = new KitchenService(buildEnv());

    await expect(
      kitchenService.updateOrderItemStatus(
        restaurantId,
        order.id,
        orderItem.id,
        { status: "preparing", notes: "fire" },
        "kitchen-real-chef",
      ),
    ).resolves.toMatchObject({
      orderId: order.id,
      itemId: orderItem.id,
      status: "preparing",
      orderStatus: "preparing",
    });

    const [preparingItem] = await testDb.drizzle
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, orderItem.id));
    const [preparingOrder] = await testDb.drizzle
      .select()
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(preparingItem.status).toBe("preparing");
    expect(preparingOrder.status).toBe("preparing");
    expect(preparingOrder.preparingAt).toBeInstanceOf(Date);
    expect(preparingOrder.readyAt).toBeNull();

    await expect(
      kitchenService.updateOrderItemStatus(
        restaurantId,
        order.id,
        orderItem.id,
        { status: "ready", notes: "plated" },
        "kitchen-real-chef",
      ),
    ).resolves.toMatchObject({
      orderId: order.id,
      itemId: orderItem.id,
      status: "ready",
      orderStatus: "ready",
    });

    const [readyItem] = await testDb.drizzle
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, orderItem.id));
    const [readyOrder] = await testDb.drizzle
      .select()
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(readyItem.status).toBe("ready");
    expect(readyOrder.status).toBe("ready");
    expect(readyOrder.preparingAt).toBeInstanceOf(Date);
    expect(readyOrder.readyAt).toBeInstanceOf(Date);
  });
});
