import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  orderItems,
  orders,
  ingredientDefinitions,
  ingredientStockMovements,
  menuItemIngredients,
  menuItems,
  platformMenuMappings,
  platformOrders,
  platformWebhookLogs,
  restaurants,
} from "@makanmasak/database";
import type { Env } from "../../types/env";
import { PlatformOrderService } from "../../features/integrations/services/PlatformOrderService";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";

/**
 * Issue #237: a redelivered platform notification used to write `orders` and
 * `order_items`, then collide with the unique index on the mapping row it
 * writes last. D1 has no rollback for that, so the order rows stayed behind
 * with nothing pointing at them.
 *
 * These run against a real migrated database because the defence is the
 * schema's — the partial unique index from
 * `0005_platform_webhook_event_dedup.sql` and the mapping index from the
 * baseline. Mocked query builders cannot reject anything.
 */

let testDb: TestDatabase;
let seed: SeedHelpers;

beforeAll(async () => {
  testDb = await createTestDatabase();
  seed = buildSeedHelpers(testDb);
}, 300_000);

afterAll(async () => {
  await testDb?.dispose();
});

beforeEach(async () => {
  await testDb.truncateAll();
});

function uberPayload(platformOrderId: string) {
  return {
    id: platformOrderId,
    store: { id: "store-1" },
    eater: { first_name: "Ari", phone: "0912345678" },
    delivery_info: { location: { address: "1 Main Street" } },
    cart: {
      items: [
        {
          id: "platform-item-1",
          title: "Laksa",
          quantity: 2,
          price: { unit_price: { amount: 600, currency_code: "MYR" } },
        },
      ],
    },
    payment: {
      charges: {
        total: { amount: 1300, currency_code: "MYR" },
        sub_total: { amount: 1200, currency_code: "MYR" },
        tax: { amount: 100, currency_code: "MYR" },
      },
    },
  };
}

async function orphanCount(restaurantId: string): Promise<number> {
  const rows = await testDb.drizzle
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .leftJoin(platformOrders, eq(platformOrders.orderId, orders.id))
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.orderSource, "uber_eats"),
        isNull(platformOrders.id),
      ),
    );

  return Number(rows[0]?.count ?? 0);
}

describe("platform webhook deduplication", () => {
  async function setupRestaurant() {
    const restaurant = await seed.restaurant({ settings: { currency: "MYR" } });
    const menuItem = await seed.menuItem(restaurant.id, { inventoryCount: 5 });

    await testDb.drizzle.insert(platformMenuMappings).values({
      restaurantId: restaurant.id,
      platform: "uber_eats",
      platformItemId: "platform-item-1",
      menuItemId: menuItem.id,
    });

    const env = {
      DB: testDb.bindings.DB,
      ENCRYPTION_KEY: "test-encryption-key",
    } as unknown as Env;

    return {
      restaurantId: restaurant.id,
      menuItemId: menuItem.id,
      service: new PlatformOrderService(env),
    };
  }

  it("stores synthetic MYR Uber minor units once in real D1", async () => {
    // Synthetic API-shaped fixture; no live Uber sandbox payload is available.
    const restaurant = await seed.restaurant({ settings: { currency: "MYR" } });
    const menuItem = await seed.menuItem(restaurant.id);
    await testDb.drizzle.insert(platformMenuMappings).values({
      restaurantId: restaurant.id,
      platform: "uber_eats",
      platformItemId: "item-1",
      menuItemId: menuItem.id,
    });
    const service = new PlatformOrderService({ DB: testDb.bindings.DB } as Env);
    const orderId = await service.processWebhook(
      "uber_eats",
      {
        id: "synthetic-myr-order",
        store: { id: "store-1" },
        cart: {
          special_instructions: "Pack separately",
          items: [
            {
              id: "item-1",
              title: "Tea",
              quantity: 1,
              special_instructions: "No ice",
              price: {
                unit_price: {
                  amount: 1399,
                  currency_code: "MYR",
                  formatted_amount: "RM13.99",
                },
              },
              selected_modifier_groups: [
                {
                  id: "milk",
                  title: "Milk",
                  selected_items: [
                    {
                      id: "oat",
                      title: "Oat",
                      price: {
                        unit_price: { amount: 99, currency_code: "MYR" },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        payment: {
          charges: {
            total: {
              amount: 1399,
              currency_code: "MYR",
              formatted_amount: "RM13.99",
            },
            sub_total: { amount: 1399, currency_code: "MYR" },
            tax: { amount: 0, currency_code: "MYR" },
          },
        },
      },
      restaurant.id,
    );

    const [order] = await testDb.drizzle
      .select({
        totalAmountCents: orders.totalAmountCents,
        notes: orders.notes,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    const [line] = await testDb.drizzle
      .select({
        unitPriceCents: orderItems.unitPriceCents,
        notes: orderItems.notes,
        customizations: orderItems.customizations,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    expect(order.totalAmountCents).toBe(1399);
    expect(order.notes).toBe("Pack separately");
    expect(line.unitPriceCents).toBe(1399);
    expect(line.notes).toBe("No ice");
    expect(line.customizations?.options).toEqual([
      {
        id: "0",
        optionName: "Milk",
        choiceId: "0",
        choiceName: "Oat",
        priceAdjustment: 0.99,
      },
    ]);
  });

  it("maps a redelivered platform order to the same internal order and leaves no orphan", async () => {
    const { restaurantId, service } = await setupRestaurant();

    const first = await service.processWebhook(
      "uber_eats",
      uberPayload("uber-order-1"),
      restaurantId,
    );
    const second = await service.processWebhook(
      "uber_eats",
      uberPayload("uber-order-1"),
      restaurantId,
    );

    expect(second).toBe(first);

    const orderRows = await testDb.drizzle
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.restaurantId, restaurantId));
    const mappingRows = await testDb.drizzle
      .select({ id: platformOrders.id })
      .from(platformOrders)
      .where(eq(platformOrders.restaurantId, restaurantId));
    const itemRows = await testDb.drizzle
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.orderId, first));

    expect(orderRows).toHaveLength(1);
    expect(mappingRows).toHaveLength(1);
    expect(itemRows).toHaveLength(1);
    expect(await orphanCount(restaurantId)).toBe(0);
  });

  it("commits mapped-item inventory, ingredient ledger, and order counters exactly once", async () => {
    const restaurant = await seed.restaurant({ settings: { currency: "MYR" } });
    const menuItem = await seed.menuItem(restaurant.id, { inventoryCount: 5 });
    const [ingredient] = await testDb.drizzle
      .insert(ingredientDefinitions)
      .values({
        restaurantId: restaurant.id,
        name: "Rice",
        unit: "kg",
        currentStock: 10,
        isActive: true,
      } as never)
      .returning({ id: ingredientDefinitions.id });
    await testDb.drizzle.insert(menuItemIngredients).values({
      menuItemId: menuItem.id,
      ingredientId: ingredient.id,
      quantityPerServing: 0.5,
      unit: "kg",
      isOptional: false,
    } as never);
    await testDb.drizzle.insert(platformMenuMappings).values({
      restaurantId: restaurant.id,
      platform: "uber_eats",
      platformItemId: "platform-item-1",
      menuItemId: menuItem.id,
    });
    const service = new PlatformOrderService({
      DB: testDb.bindings.DB,
      ENCRYPTION_KEY: "test-encryption-key",
    } as Env);

    const orderId = await service.processWebhook(
      "uber_eats",
      uberPayload("uber-order-stock"),
      restaurant.id,
    );
    await expect(
      service.processWebhook(
        "uber_eats",
        uberPayload("uber-order-stock"),
        restaurant.id,
      ),
    ).resolves.toBe(orderId);

    const [menu] = await testDb.drizzle
      .select({
        inventoryCount: menuItems.inventoryCount,
        orderCount: menuItems.orderCount,
      })
      .from(menuItems)
      .where(eq(menuItems.id, menuItem.id));
    const [restaurantCounts] = await testDb.drizzle
      .select({ totalOrders: restaurants.totalOrders })
      .from(restaurants)
      .where(eq(restaurants.id, restaurant.id));
    const [stock] = await testDb.drizzle
      .select({ currentStock: ingredientDefinitions.currentStock })
      .from(ingredientDefinitions)
      .where(eq(ingredientDefinitions.id, ingredient.id));
    const movements = await testDb.drizzle
      .select({
        delta: ingredientStockMovements.delta,
        balanceAfter: ingredientStockMovements.balanceAfter,
        orderId: ingredientStockMovements.orderId,
        reason: ingredientStockMovements.reason,
      })
      .from(ingredientStockMovements)
      .where(eq(ingredientStockMovements.ingredientId, ingredient.id));

    expect(menu).toMatchObject({ inventoryCount: 3, orderCount: 2 });
    expect(restaurantCounts.totalOrders).toBe(1);
    expect(stock.currentStock).toBe(9);
    expect(movements).toEqual([
      {
        delta: -1,
        balanceAfter: 9,
        orderId,
        reason: "order_consumption",
      },
    ]);
  });

  it("restores platform-order inventory and nets the ingredient ledger on cancellation", async () => {
    const restaurant = await seed.restaurant({ settings: { currency: "MYR" } });
    const menuItem = await seed.menuItem(restaurant.id, { inventoryCount: 5 });
    const [ingredient] = await testDb.drizzle
      .insert(ingredientDefinitions)
      .values({
        restaurantId: restaurant.id,
        name: "Rice",
        unit: "kg",
        currentStock: 10,
        isActive: true,
      } as never)
      .returning({ id: ingredientDefinitions.id });
    await testDb.drizzle.insert(menuItemIngredients).values({
      menuItemId: menuItem.id,
      ingredientId: ingredient.id,
      quantityPerServing: 0.5,
      unit: "kg",
      isOptional: false,
    } as never);
    await testDb.drizzle.insert(platformMenuMappings).values({
      restaurantId: restaurant.id,
      platform: "uber_eats",
      platformItemId: "platform-item-1",
      menuItemId: menuItem.id,
    });
    const env = {
      DB: testDb.bindings.DB,
      ENCRYPTION_KEY: "test-encryption-key",
      JWT_SECRET: "test-jwt-secret",
      CACHE_KV: {
        get: async () => null,
        put: async () => undefined,
        delete: async () => undefined,
        list: async () => ({ keys: [] }),
      },
    } as unknown as Env;
    const orderId = await new PlatformOrderService(env).processWebhook(
      "uber_eats",
      uberPayload("uber-order-cancel"),
      restaurant.id,
    );

    await expect(
      new PlatformOrderService(env).processCancellation(
        "uber_eats",
        {
          order: { id: "uber-order-cancel" },
          reason: "Cancelled on Uber Eats",
        },
        restaurant.id,
      ),
    ).resolves.toEqual({ handled: true });

    await expect(
      new PlatformOrderService(env).processCancellation(
        "uber_eats",
        { order: { id: "uber-order-cancel" } },
        restaurant.id,
      ),
    ).resolves.toEqual({ handled: true });

    const [cancelledOrder] = await testDb.drizzle
      .select({ status: orders.status, cancelledAt: orders.cancelledAt })
      .from(orders)
      .where(eq(orders.id, orderId));
    const [mapping] = await testDb.drizzle
      .select({ platformStatus: platformOrders.platformStatus })
      .from(platformOrders)
      .where(eq(platformOrders.orderId, orderId));

    expect(cancelledOrder).toMatchObject({ status: "cancelled" });
    expect(cancelledOrder.cancelledAt).toBeInstanceOf(Date);
    expect(mapping).toEqual({ platformStatus: "cancelled" });

    const [menu] = await testDb.drizzle
      .select({ inventoryCount: menuItems.inventoryCount })
      .from(menuItems)
      .where(eq(menuItems.id, menuItem.id));
    const [stock] = await testDb.drizzle
      .select({ currentStock: ingredientDefinitions.currentStock })
      .from(ingredientDefinitions)
      .where(eq(ingredientDefinitions.id, ingredient.id));
    const movements = await testDb.drizzle
      .select({
        delta: ingredientStockMovements.delta,
        reason: ingredientStockMovements.reason,
      })
      .from(ingredientStockMovements)
      .where(eq(ingredientStockMovements.orderId, orderId));

    expect(menu.inventoryCount).toBe(5);
    expect(stock.currentStock).toBe(10);
    expect(movements).toEqual([
      { delta: -1, reason: "order_consumption" },
      { delta: 1, reason: "order_cancellation" },
    ]);
    expect(movements.reduce((sum, movement) => sum + movement.delta, 0)).toBe(
      0,
    );
  });

  it("records paid platform sales below tracked inventory without a ledger recipe", async () => {
    const restaurant = await seed.restaurant({ settings: { currency: "MYR" } });
    const menuItem = await seed.menuItem(restaurant.id, { inventoryCount: 1 });
    await testDb.drizzle.insert(platformMenuMappings).values({
      restaurantId: restaurant.id,
      platform: "uber_eats",
      platformItemId: "platform-item-1",
      menuItemId: menuItem.id,
    });
    const service = new PlatformOrderService({
      DB: testDb.bindings.DB,
      ENCRYPTION_KEY: "test-encryption-key",
    } as Env);

    await expect(
      service.processWebhook(
        "uber_eats",
        uberPayload("uber-order-negative-stock"),
        restaurant.id,
      ),
    ).resolves.toEqual(expect.any(String));

    const [menu] = await testDb.drizzle
      .select({ inventoryCount: menuItems.inventoryCount })
      .from(menuItems)
      .where(eq(menuItems.id, menuItem.id));
    const movements = await testDb.drizzle
      .select({ id: ingredientStockMovements.id })
      .from(ingredientStockMovements);

    expect(menu.inventoryCount).toBe(-1);
    expect(movements).toEqual([]);
  });

  it("keeps untracked platform menu inventory null", async () => {
    const restaurant = await seed.restaurant({ settings: { currency: "MYR" } });
    const menuItem = await seed.menuItem(restaurant.id, {
      inventoryCount: null,
    });
    await testDb.drizzle.insert(platformMenuMappings).values({
      restaurantId: restaurant.id,
      platform: "uber_eats",
      platformItemId: "platform-item-1",
      menuItemId: menuItem.id,
    });
    const service = new PlatformOrderService({
      DB: testDb.bindings.DB,
      ENCRYPTION_KEY: "test-encryption-key",
    } as Env);

    await service.processWebhook(
      "uber_eats",
      uberPayload("uber-order-untracked-stock"),
      restaurant.id,
    );

    const [menu] = await testDb.drizzle
      .select({ inventoryCount: menuItems.inventoryCount })
      .from(menuItems)
      .where(eq(menuItems.id, menuItem.id));
    expect(menu.inventoryCount).toBeNull();
  });

  it("ignores a stale mapping that points at another restaurant's menu item", async () => {
    const sourceRestaurant = await seed.restaurant({
      settings: { currency: "MYR" },
    });
    const targetRestaurant = await seed.restaurant({
      settings: { currency: "MYR" },
    });
    const sourceMenuItem = await seed.menuItem(sourceRestaurant.id, {
      inventoryCount: 5,
    });
    await testDb.drizzle.insert(platformMenuMappings).values({
      restaurantId: targetRestaurant.id,
      platform: "uber_eats",
      platformItemId: "platform-item-1",
      menuItemId: sourceMenuItem.id,
    });
    const service = new PlatformOrderService({
      DB: testDb.bindings.DB,
      ENCRYPTION_KEY: "test-encryption-key",
    } as Env);

    const orderId = await service.processWebhook(
      "uber_eats",
      uberPayload("uber-order-cross-tenant-mapping"),
      targetRestaurant.id,
    );

    const itemRows = await testDb.drizzle
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const [sourceMenu] = await testDb.drizzle
      .select({ inventoryCount: menuItems.inventoryCount })
      .from(menuItems)
      .where(eq(menuItems.id, sourceMenuItem.id));
    const movements = await testDb.drizzle
      .select({ id: ingredientStockMovements.id })
      .from(ingredientStockMovements)
      .where(eq(ingredientStockMovements.orderId, orderId));

    expect(itemRows).toEqual([]);
    expect(sourceMenu.inventoryCount).toBe(5);
    expect(movements).toEqual([]);
  });

  it("keeps a single order when two deliveries of the same platform order race", async () => {
    const { restaurantId, menuItemId, service } = await setupRestaurant();

    const results = await Promise.all([
      service.processWebhook(
        "uber_eats",
        uberPayload("uber-order-race"),
        restaurantId,
      ),
      service.processWebhook(
        "uber_eats",
        uberPayload("uber-order-race"),
        restaurantId,
      ),
    ]);

    expect(results[0]).toBe(results[1]);

    const orderRows = await testDb.drizzle
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.restaurantId, restaurantId));

    expect(orderRows).toHaveLength(1);
    // The loser's batch is a transaction: its order and items never commit.
    expect(await orphanCount(restaurantId)).toBe(0);
    const [menu] = await testDb.drizzle
      .select({
        inventoryCount: menuItems.inventoryCount,
        orderCount: menuItems.orderCount,
      })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    const [restaurant] = await testDb.drizzle
      .select({ totalOrders: restaurants.totalOrders })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId));
    expect(menu).toMatchObject({ inventoryCount: 3, orderCount: 2 });
    expect(restaurant.totalOrders).toBe(1);
  });

  it("rolls the order rows back when the mapping insert violates the unique index", async () => {
    const { restaurantId, service } = await setupRestaurant();

    const existingOrderId = await service.processWebhook(
      "uber_eats",
      uberPayload("uber-order-taken"),
      restaurantId,
    );

    // What the loser of a race issues: a fresh order plus a mapping row that
    // the index already holds. The point of the batch is that the first
    // statement does not survive the second one's rejection.
    const losingOrderId = "01900000-0000-7000-8000-000000000999";
    const now = new Date();

    await expect(
      testDb.drizzle.batch([
        testDb.drizzle.insert(orders).values({
          id: losingOrderId,
          restaurantId,
          orderNumber: "PL-loser",
          status: "pending",
          orderSource: "uber_eats",
          totalAmountCents: 1300,
          subtotalCents: 1200,
          taxAmountCents: 100,
          serviceChargeCents: 0,
          discountAmountCents: 0,
          createdAt: now,
          updatedAt: now,
        }),
        testDb.drizzle.insert(platformOrders).values({
          orderId: losingOrderId,
          restaurantId,
          platform: "uber_eats",
          platformOrderId: "uber-order-taken",
          platformStatus: "received",
          createdAt: now,
          updatedAt: now,
        }),
      ]),
    ).rejects.toThrow();

    const orderRows = await testDb.drizzle
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.restaurantId, restaurantId));

    expect(orderRows.map((row) => row.id)).toEqual([existingOrderId]);
    expect(await orphanCount(restaurantId)).toBe(0);
  });

  it("rejects a duplicate provider event id and still accepts logs without one", async () => {
    const reserve = (platformEventId: string | null) =>
      testDb.drizzle
        .insert(platformWebhookLogs)
        .values({
          platform: "uber_eats",
          eventType: "order.created",
          platformEventId,
          status: "received",
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: platformWebhookLogs.id });

    expect(await reserve("event-1")).toHaveLength(1);
    expect(await reserve("event-1")).toHaveLength(0);

    // The index is partial, so an absent provider event id never collides.
    expect(await reserve(null)).toHaveLength(1);
    expect(await reserve(null)).toHaveLength(1);
  });
});
