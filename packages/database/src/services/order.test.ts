import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, getTableColumns, sql } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import {
  categories,
  coupons,
  waitingList,
  ingredientDefinitions,
  ingredientStockMovements,
  menuItemIngredients,
  couponUsage,
  menuItems,
  menuItemOptionGroups,
  optionChoices,
  optionGroups,
  orderItems,
  orders,
  restaurants,
  users,
} from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { orderMenuItemSummaryColumns, OrderService } from "./order";

const restaurantId = "restaurant-price-test";
const menuItemId = 101;
const couponUserId = "018f0000-0000-7000-8000-000000000077";

function findUncoveredProjectionColumns(
  tableColumns: string[],
  projectedColumns: Iterable<string>,
  exemptColumns: Iterable<string>,
): string[] {
  const projected = new Set(projectedColumns);
  const exempt = new Set(exemptColumns);
  return tableColumns.filter(
    (column) => !projected.has(column) && !exempt.has(column),
  );
}

describe("OrderService projection drift guards", () => {
  const menuItemColumns = Object.keys(getTableColumns(menuItems));
  const orderMenuItemSummaryExemptColumns = [
    "restaurantId",
    "categoryId",
    "catalogType",
    "description",
    "ingredients",
    "priceCents",
    "originalPriceCents",
    "costPriceCents",
    "imageVariants",
    "imageId",
    "isAvailable",
    "isFeatured",
    "isPopular",
    "sortOrder",
    "inventoryCount",
    "minInventoryAlert",
    "spiceLevel",
    "preparationTime",
    "calories",
    "dietaryInfo",
    "allergens",
    "options",
    "availableHours",
    "orderCount",
    "rating",
    "reviewCount",
    "viewCount",
    "tags",
    "keywords",
    "createdAt",
    "updatedAt",
    "deletedAt",
  ];

  it("keeps order menu item summaries explicit about included/exempt fields", () => {
    expect(
      findUncoveredProjectionColumns(
        menuItemColumns,
        Object.keys(orderMenuItemSummaryColumns),
        orderMenuItemSummaryExemptColumns,
      ),
    ).toEqual([]);
  });

  it("fails closed when a new menu item column is neither projected nor exempted", () => {
    const futureColumn = "__futureColumn";

    expect(
      findUncoveredProjectionColumns(
        [...menuItemColumns, futureColumn],
        Object.keys(orderMenuItemSummaryColumns),
        orderMenuItemSummaryExemptColumns,
      ),
    ).toContain(futureColumn);
  });
});

describe("OrderService order pricing", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await seedMenuItem(testDb);
  });

  // The customer app enforces these by disabling controls. A request that never
  // went through that UI has to meet the same rules, or "required" and
  // "maxSelections" are decorations the owner sets and nothing keeps.
  describe("customization group rules", () => {
    const service = () =>
      new OrderService(testDb.bindings.DB, { JWT_SECRET: "test" });

    async function seedGroups(
      groups: NonNullable<
        NonNullable<typeof menuItems.$inferInsert.options>["customizations"]
      >,
    ) {
      await testDb.drizzle
        .update(menuItems)
        .set({ options: { customizations: groups } })
        .where(eq(menuItems.id, menuItemId));
    }

    it("refuses an order that skips a required group", async () => {
      await seedGroups([
        {
          id: "spice",
          name: "Spice",
          type: "single",
          required: true,
          choices: [{ id: "hot", name: "Hot", priceAdjustment: 0 }],
        },
      ]);

      await expect(
        service().createOrder({
          restaurantId,
          items: [{ menuItemId, quantity: 1 }],
        }),
      ).rejects.toThrow(/Invalid customization: group spice is required/);
    });

    it("refuses two choices from a single-choice group", async () => {
      await seedGroups([
        {
          id: "spice",
          name: "Spice",
          type: "single",
          required: false,
          choices: [
            { id: "hot", name: "Hot", priceAdjustment: 0 },
            { id: "mild", name: "Mild", priceAdjustment: 0 },
          ],
        },
      ]);

      await expect(
        service().createOrder({
          restaurantId,
          items: [
            {
              menuItemId,
              quantity: 1,
              customizations: {
                options: [
                  {
                    id: "spice",
                    optionName: "Spice",
                    choiceId: "hot",
                    choiceName: "Hot",
                  },
                  {
                    id: "spice",
                    optionName: "Spice",
                    choiceId: "mild",
                    choiceName: "Mild",
                  },
                ],
              },
            },
          ],
        }),
      ).rejects.toThrow(
        /Invalid customization: group spice accepts a single choice/,
      );
    });

    it("refuses more choices than maxSelections allows", async () => {
      await seedGroups([
        {
          id: "toppings",
          name: "Toppings",
          type: "multiple",
          required: false,
          maxSelections: 1,
          choices: [
            { id: "pearl", name: "Pearl", priceAdjustment: 0 },
            { id: "jelly", name: "Jelly", priceAdjustment: 0 },
          ],
        },
      ]);

      await expect(
        service().createOrder({
          restaurantId,
          items: [
            {
              menuItemId,
              quantity: 1,
              customizations: {
                options: [
                  {
                    id: "toppings",
                    optionName: "Toppings",
                    choiceId: "pearl",
                    choiceName: "Pearl",
                  },
                  {
                    id: "toppings",
                    optionName: "Toppings",
                    choiceId: "jelly",
                    choiceName: "Jelly",
                  },
                ],
              },
            },
          ],
        }),
      ).rejects.toThrow(
        /Invalid customization: group toppings allows at most 1 choices/,
      );
    });

    // The seeded egg is capped at 3. Until the modal grew a stepper nothing
    // could send more than one, so this bound had never been exercised.
    it("refuses an add-on quantity above its cap", async () => {
      await expect(
        service().createOrder({
          restaurantId,
          items: [
            {
              menuItemId,
              quantity: 1,
              customizations: {
                addOns: [
                  {
                    id: "egg",
                    name: "Egg",
                    unitPrice: 1,
                    quantity: 4,
                    totalPrice: 4,
                  },
                ],
              },
            },
          ],
        }),
      ).rejects.toThrow(/Add-on egg quantity exceeds maximum/);
    });

    it("prices a multi-unit add-on from the catalog", async () => {
      const order = await service().createOrder({
        restaurantId,
        items: [
          {
            menuItemId,
            quantity: 1,
            customizations: {
              addOns: [
                {
                  id: "egg",
                  name: "Egg",
                  unitPrice: -99,
                  quantity: 3,
                  totalPrice: -297,
                },
              ],
            },
          },
        ],
      });

      // 10.00 base + 3 x 1.00 catalog price, not the client's numbers.
      expect(order.subtotal).toBe(13);
      expect(order.items?.[0].customizations?.addOns?.[0]).toMatchObject({
        quantity: 3,
        unitPrice: 1,
        totalPrice: 3,
      });
    });

    it("accepts a selection that satisfies every group rule", async () => {
      await seedGroups([
        {
          id: "toppings",
          name: "Toppings",
          type: "multiple",
          required: true,
          maxSelections: 2,
          choices: [
            { id: "pearl", name: "Pearl", priceAdjustment: 0 },
            { id: "jelly", name: "Jelly", priceAdjustment: 0 },
          ],
        },
      ]);

      const order = await service().createOrder({
        restaurantId,
        items: [
          {
            menuItemId,
            quantity: 1,
            customizations: {
              options: [
                {
                  id: "toppings",
                  optionName: "Toppings",
                  choiceId: "pearl",
                  choiceName: "Pearl",
                },
                {
                  id: "toppings",
                  optionName: "Toppings",
                  choiceId: "jelly",
                  choiceName: "Jelly",
                },
              ],
            },
          },
        ],
      });

      expect(order.items?.[0].customizations?.options).toHaveLength(2);
    });
  });

  it("prices selected customizations from the catalog instead of client prices", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });

    const order = await service.createOrder({
      restaurantId,
      items: [
        {
          menuItemId,
          quantity: 1,
          customizations: {
            size: {
              id: "large",
              name: "Large",
              priceAdjustment: -9.99,
            },
            options: [
              {
                id: "spice",
                optionName: "Spice",
                choiceId: "hot",
                choiceName: "Hot",
                priceAdjustment: -9.99,
              },
            ],
            addOns: [
              {
                id: "egg",
                name: "Egg",
                unitPrice: -9.99,
                quantity: 2,
                totalPrice: -19.98,
              },
            ],
          },
        },
      ],
    });

    expect(order.subtotal).toBe(15.5);
    expect(order.totalAmount).toBe(15.5);
    expect(order.items?.[0]).toMatchObject({
      unitPrice: 15.5,
      totalPrice: 15.5,
      customizations: {
        size: { id: "large", name: "Large", priceAdjustment: 2 },
        options: [
          {
            id: "spice",
            optionName: "Spice",
            choiceId: "hot",
            choiceName: "Hot",
            priceAdjustment: 1.5,
          },
        ],
        addOns: [
          {
            id: "egg",
            name: "Egg",
            unitPrice: 1,
            quantity: 2,
            totalPrice: 2,
          },
        ],
      },
    });
  });

  it("rejects unknown customization choices", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        service.createOrder({
          restaurantId,
          items: [
            {
              menuItemId,
              quantity: 1,
              customizations: {
                options: [
                  {
                    id: "spice",
                    optionName: "Spice",
                    choiceId: "not-on-menu",
                    choiceName: "Hidden discount",
                    priceAdjustment: -9.99,
                  },
                ],
              },
            },
          ],
        }),
      ).rejects.toThrow(
        "Unknown customization choice not-on-menu for menu item 101",
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  describe("assembled option row validation", () => {
    async function replaceCatalogWithOptionRows() {
      await testDb.drizzle
        .update(menuItems)
        .set({ options: null })
        .where(eq(menuItems.id, menuItemId));
      await testDb.drizzle.insert(optionGroups).values([
        {
          id: "order-group-spice",
          restaurantId,
          publicId: "spice",
          kind: "choice",
          name: "Spice",
          type: "multiple",
          required: true,
          maxSelections: 1,
          sortOrder: 1,
        },
        {
          id: "order-group-addons",
          restaurantId,
          publicId: "addOns",
          kind: "addon",
          name: "Add-ons",
          type: "multiple",
          required: false,
          sortOrder: 2,
        },
      ]);
      await testDb.drizzle.insert(optionChoices).values([
        {
          id: "order-choice-hot",
          groupId: "order-group-spice",
          publicId: "hot",
          name: "Hot",
          priceAdjustmentCents: 150,
          sortOrder: 1,
        },
        {
          id: "order-choice-mild",
          groupId: "order-group-spice",
          publicId: "mild",
          name: "Mild",
          priceAdjustmentCents: 0,
          sortOrder: 2,
        },
        {
          id: "order-choice-egg",
          groupId: "order-group-addons",
          publicId: "egg",
          name: "Egg",
          priceAdjustmentCents: 100,
          maxQuantity: 3,
          sortOrder: 1,
        },
      ]);
      await testDb.drizzle.insert(menuItemOptionGroups).values([
        {
          menuItemId,
          groupId: "order-group-spice",
          sortOrder: 1,
        },
        {
          menuItemId,
          groupId: "order-group-addons",
          sortOrder: 2,
        },
      ]);
    }

    it("enforces required, maxSelections, and maxQuantity from rows", async () => {
      const service = new OrderService(testDb.bindings.DB, {
        JWT_SECRET: "test",
      });
      await replaceCatalogWithOptionRows();

      await expect(
        service.createOrder({
          restaurantId,
          items: [{ menuItemId, quantity: 1 }],
        }),
      ).rejects.toThrow(/Invalid customization: group spice is required/);

      await expect(
        service.createOrder({
          restaurantId,
          items: [
            {
              menuItemId,
              quantity: 1,
              customizations: {
                options: [
                  {
                    id: "spice",
                    optionName: "Spice",
                    choiceId: "hot",
                    choiceName: "Hot",
                  },
                  {
                    id: "spice",
                    optionName: "Spice",
                    choiceId: "mild",
                    choiceName: "Mild",
                  },
                ],
              },
            },
          ],
        }),
      ).rejects.toThrow(/Invalid customization: group spice allows at most 1/);

      await expect(
        service.createOrder({
          restaurantId,
          items: [
            {
              menuItemId,
              quantity: 1,
              customizations: {
                options: [
                  {
                    id: "spice",
                    optionName: "Spice",
                    choiceId: "hot",
                    choiceName: "Hot",
                  },
                ],
                addOns: [
                  {
                    id: "egg",
                    name: "Egg",
                    unitPrice: 1,
                    quantity: 4,
                    totalPrice: 4,
                  },
                ],
              },
            },
          ],
        }),
      ).rejects.toThrow(/Add-on egg quantity exceeds maximum/);
    });
  });

  it("filters orders by canonical payment status", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const pendingOrder = await service.createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });
    const completedOrder = await service.createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });
    await testDb.drizzle
      .update(orders)
      .set({ paymentStatus: "completed" })
      .where(eq(orders.id, completedOrder.id));

    const result = await service.getOrders({
      restaurantId,
      paymentStatus: "pending",
    });

    expect(result.orders.map((order) => order.id)).toEqual([pendingOrder.id]);
    expect(result.pagination.total).toBe(1);
  });

  it("hands back a partially refunded status instead of rewriting it to pending", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const order = await service.createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    // What refundPayment writes for a partial refund. The column is
    // unconstrained TEXT, so the value lands whether or not the read path
    // knows it; `toOrderPaymentStatus` falls back to "pending" for anything
    // outside ORDER_PAYMENT_STATUSES, which turned every partially refunded
    // order into an apparently unpaid one (#311).
    await testDb.drizzle
      .update(orders)
      .set({ paymentStatus: "partial_refunded" })
      .where(eq(orders.id, order.id));

    // The list path is enough: getOrder and getOrders both project through the
    // same `mapToOrder`, so either one exercises the fallback.
    const listed = await service.getOrders({
      restaurantId,
      paymentStatus: "partial_refunded",
    });
    expect(listed.orders.map((o) => o.id)).toEqual([order.id]);
    expect(listed.orders[0]?.paymentStatus).toBe("partial_refunded");
  });

  it("searches the complete order set by customer name", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const adaOrder = await service.createOrder({
      restaurantId,
      customerInfo: { name: "Ada Lovelace" },
      items: [{ menuItemId, quantity: 1 }],
    });
    await service.createOrder({
      restaurantId,
      customerInfo: { name: "Grace Hopper" },
      items: [{ menuItemId, quantity: 1 }],
    });

    const result = await service.getOrders({ restaurantId, search: "Ada" });

    expect(result.orders.map((order) => order.id)).toEqual([adaOrder.id]);
    expect(result.pagination.total).toBe(1);
  });
});

const INJECTED_FAILURE = "injected D1 failure";

/**
 * Wraps a real D1 binding so that any statement whose SQL matches
 * `shouldFail` throws — simulating the transient write failures D1 can
 * surface in production. A failed db.batch() never partially commits
 * (D1 batches are transactional), so the wrapper also rejects whole
 * batches containing a matching statement.
 */
function withFailureInjection(
  db: D1Database,
  shouldFail: (sql: string) => boolean,
): D1Database {
  type WrappedStatement = D1PreparedStatement & {
    __sql: string;
    __real: D1PreparedStatement;
  };

  const wrapStatement = (
    stmt: D1PreparedStatement,
    sqlText: string,
  ): WrappedStatement => ({
    __sql: sqlText,
    __real: stmt,
    bind: (...args: unknown[]) => wrapStatement(stmt.bind(...args), sqlText),
    run: async (...args: unknown[]) => {
      if (shouldFail(sqlText)) throw new Error(INJECTED_FAILURE);
      return stmt.run(...args);
    },
    all: async (...args: unknown[]) => {
      if (shouldFail(sqlText)) throw new Error(INJECTED_FAILURE);
      return stmt.all(...args);
    },
    first: async (...args: unknown[]) => {
      if (shouldFail(sqlText)) throw new Error(INJECTED_FAILURE);
      return stmt.first(...args);
    },
    raw: async (...args: unknown[]) => {
      if (shouldFail(sqlText)) throw new Error(INJECTED_FAILURE);
      return stmt.raw(...args);
    },
  });

  return {
    prepare: (sqlText: string) => wrapStatement(db.prepare(sqlText), sqlText),
    batch: async (statements: D1PreparedStatement[]) => {
      if (
        statements.some(
          (statement) =>
            "__sql" in statement &&
            typeof statement.__sql === "string" &&
            shouldFail(statement.__sql),
        )
      ) {
        throw new Error(INJECTED_FAILURE);
      }
      return db.batch(
        statements.map((statement) =>
          "__real" in statement ? statement.__real : statement,
        ),
      );
    },
    exec: (query: string) => db.exec(query),
    dump: () => db.dump(),
  } as unknown as D1Database;
}

function withBeforeBatch(
  db: D1Database,
  beforeBatch: () => Promise<void>,
): D1Database {
  let pending = true;
  return {
    prepare: (query: string) => db.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      if (pending) {
        pending = false;
        await beforeBatch();
      }
      return db.batch(statements);
    },
    exec: (query: string) => db.exec(query),
    dump: () => db.dump(),
  } as unknown as D1Database;
}

describe("OrderService applyOrderDiscount", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await seedMenuItem(testDb);
  });

  const service = () =>
    new OrderService(testDb.bindings.DB, { JWT_SECRET: "test" });

  async function seedOrder() {
    return service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });
  }

  it("derives the money from the order's own cents and rewrites the total", async () => {
    const order = await seedOrder();
    const discounted = await service().applyOrderDiscount(order.id, 10);

    const base =
      (order.subtotal ?? 0) +
      (order.taxAmount ?? 0) +
      (order.serviceCharge ?? 0);

    expect(discounted.discountAmount).toBeCloseTo(base * 0.1, 2);
    expect(discounted.totalAmount).toBeCloseTo(
      (order.totalAmount ?? 0) - (discounted.discountAmount ?? 0),
      2,
    );
  });

  it("bumps the version so a concurrent writer loses", async () => {
    const order = await seedOrder();
    const discounted = await service().applyOrderDiscount(order.id, 10);
    expect(discounted.version).toBe((order.version ?? 0) + 1);

    // The stale caller still holds the pre-discount version.
    await expect(
      service().applyOrderDiscount(order.id, 20, order.version),
    ).rejects.toThrow(/version conflict/i);
  });

  it("refuses a percentage outside 0-100 rather than clamping silently", async () => {
    const order = await seedOrder();
    await expect(service().applyOrderDiscount(order.id, 101)).rejects.toThrow(
      /between 0 and 100/i,
    );
    await expect(service().applyOrderDiscount(order.id, -1)).rejects.toThrow(
      /between 0 and 100/i,
    );
  });

  it("never lets the total go negative at 100%", async () => {
    const order = await seedOrder();
    const discounted = await service().applyOrderDiscount(order.id, 100);
    expect(discounted.totalAmount).toBeGreaterThanOrEqual(0);
  });

  it("refuses to overwrite a coupon discount", async () => {
    const order = await seedOrder();
    await testDb.drizzle
      .update(orders)
      .set({ couponCode: "SAVE10" })
      .where(eq(orders.id, order.id));

    // One column holds one figure; a manual discount would cancel the coupon
    // while coupon_code went on claiming it applied (#327).
    await expect(service().applyOrderDiscount(order.id, 10)).rejects.toThrow(
      /coupon discount/i,
    );
  });

  it("refuses once the order is finalized", async () => {
    const order = await seedOrder();
    await testDb.drizzle
      .update(orders)
      .set({ status: "paid" })
      .where(eq(orders.id, order.id));

    await expect(service().applyOrderDiscount(order.id, 10)).rejects.toThrow(
      /version conflict/i,
    );
  });
});

describe("OrderService createOrder atomicity", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await seedMenuItem(testDb);
    await seedCoupon(testDb);
  });

  const couponOrder = {
    restaurantId,
    couponCode: "SAVE5",
    items: [{ menuItemId, quantity: 2 }],
  };

  it("persists order, items, coupon usage, and counters together on success", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });

    const order = await service.createOrder(couponOrder);

    expect(order.subtotal).toBe(20);
    expect(order.discountAmount).toBe(5);
    expect(order.totalAmount).toBe(15);
    expect(order.items).toHaveLength(1);

    const [usage] = await testDb.drizzle.select().from(couponUsage);
    expect(usage).toMatchObject({
      orderId: order.id,
      discountAmountCents: 500,
      status: "active",
    });

    const [coupon] = await testDb.drizzle.select().from(coupons);
    expect(coupon.usedCount).toBe(1);

    const [item] = await testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(item.inventoryCount).toBe(8);
    expect(item.orderCount).toBe(2);

    const [restaurant] = await testDb.drizzle
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId));
    expect(restaurant.totalOrders).toBe(1);
  });

  it("creates human-readable order numbers without embedding restaurant ids", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });

    const order = await service.createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    expect(order.orderNumber).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
    );
    expect(order.orderNumber).not.toContain(restaurantId.toUpperCase());
    expect(order.orderNumber.length).toBe(9);
  });

  it("enforces per-user coupon limits and records the coupon user", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    await testDb.drizzle
      .update(coupons)
      .set({ usageLimitPerUser: 1 })
      .where(eq(coupons.code, "SAVE5"));
    await testDb.drizzle.insert(users).values({
      id: couponUserId,
      username: "coupon-user-77",
      fullName: "Coupon User",
      passwordHash: "hash",
      role: 5,
      restaurantId,
      isActive: true,
      isVerified: true,
    });

    const firstOrder = await service.createOrder({
      ...couponOrder,
      couponUserId,
      clientMutationId: "coupon-user-first",
    });

    const [usage] = await testDb.drizzle.select().from(couponUsage);
    expect(usage).toMatchObject({
      orderId: firstOrder.id,
      userId: couponUserId,
      status: "active",
    });

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        service.createOrder({
          ...couponOrder,
          couponUserId,
          clientMutationId: "coupon-user-second",
        }),
      ).rejects.toThrow("您已達到此優惠券的使用次數上限");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("adds items to an existing order and updates totals and inventory", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const order = await service.createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    const updated = await service.addItemsToOrder(order.id, [
      { menuItemId, quantity: 2, notes: "extra sambal" },
    ]);

    expect(updated.items).toHaveLength(2);
    expect(updated.subtotal).toBe(30);
    expect(updated.totalAmount).toBe(30);
    expect(updated.items?.[1]).toMatchObject({
      menuItemId,
      quantity: 2,
      totalPrice: 20,
      notes: "extra sambal",
    });

    const persistedItems = await testDb.drizzle.select().from(orderItems);
    expect(persistedItems).toHaveLength(2);

    const [item] = await testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(item.inventoryCount).toBe(7);
    expect(item.orderCount).toBe(3);
  });

  it("rejects adding items to non-open orders", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const order = await service.createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });
    await service.updateOrderStatus(order.id, { status: "ready" });

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        service.addItemsToOrder(order.id, [{ menuItemId, quantity: 1 }]),
      ).rejects.toThrow("Cannot add items to an order with status: ready");
    } finally {
      consoleError.mockRestore();
    }

    const persistedItems = await testDb.drizzle.select().from(orderItems);
    expect(persistedItems).toHaveLength(1);
  });

  it("rejects a stale expectedVersion when adding items", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const order = await service.createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });
    // Another actor advances the order between the client reading it and
    // sending its edit.
    await service.updateOrderStatus(order.id, { status: "confirmed" });

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        service.addItemsToOrder(
          order.id,
          [{ menuItemId, quantity: 1 }],
          order.version,
        ),
      ).rejects.toThrow("Order version conflict");
    } finally {
      consoleError.mockRestore();
    }

    const persistedItems = await testDb.drizzle.select().from(orderItems);
    expect(persistedItems).toHaveLength(1);
  });

  it("rejects duplicate menu item lines that exceed available inventory together", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        service.createOrder({
          restaurantId,
          items: [
            { menuItemId, quantity: 6 },
            { menuItemId, quantity: 6 },
          ],
        }),
      ).rejects.toThrow("Insufficient inventory for Nasi Lemak");
    } finally {
      consoleError.mockRestore();
    }

    await expect(testDb.drizzle.select().from(orders)).resolves.toEqual([]);
    await expect(testDb.drizzle.select().from(orderItems)).resolves.toEqual([]);

    const [item] = await testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(item.inventoryCount).toBe(10);
    expect(item.orderCount).toBe(0);
  });

  it.each([
    ["order items insert", /insert into\s+"?order_items"?/i],
    ["inventory update", /update\s+"?menu_items"?/i],
  ])(
    "leaves no partial writes when the %s fails",
    async (_label, failurePattern) => {
      const service = new OrderService(
        withFailureInjection(testDb.bindings.DB, (sqlText) =>
          failurePattern.test(sqlText),
        ),
        { JWT_SECRET: "test" },
      );
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        // The surfaced message varies (drizzle wraps injected errors as
        // "Failed query: ..."), so only the rejection itself is asserted —
        // the no-partial-write checks below are the actual contract.
        await expect(service.createOrder(couponOrder)).rejects.toThrow();
      } finally {
        consoleError.mockRestore();
      }

      // Nothing from the failed attempt may remain: no orphan order, no
      // items, no coupon consumption, no inventory drift.
      await expect(testDb.drizzle.select().from(orders)).resolves.toEqual([]);
      await expect(testDb.drizzle.select().from(orderItems)).resolves.toEqual(
        [],
      );
      await expect(testDb.drizzle.select().from(couponUsage)).resolves.toEqual(
        [],
      );

      const [coupon] = await testDb.drizzle.select().from(coupons);
      expect(coupon.usedCount).toBe(0);

      const [item] = await testDb.drizzle
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, menuItemId));
      expect(item.inventoryCount).toBe(10);
      expect(item.orderCount).toBe(0);

      const [restaurant] = await testDb.drizzle
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId));
      expect(restaurant.totalOrders ?? 0).toBe(0);
    },
  );
});

describe("OrderService cancelOrder atomicity", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await seedMenuItem(testDb);
  });

  it("restores inventory only for the cancellation that changes order status", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const order = await service.createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });

    const [afterCreate] = await testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(afterCreate.inventoryCount).toBe(8);

    await expect(service.cancelOrder(order.id, "customer")).resolves.toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(service.cancelOrder(order.id, "duplicate")).rejects.toThrow(
        "Order cannot be cancelled",
      );
    } finally {
      consoleError.mockRestore();
    }

    const [afterDuplicateCancel] = await testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(afterDuplicateCancel.inventoryCount).toBe(10);
  });

  it("does not double-restore inventory for concurrent duplicate cancellations", async () => {
    const service = new OrderService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const order = await service.createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const results = await Promise.allSettled([
        service.cancelOrder(order.id, "customer"),
        service.cancelOrder(order.id, "duplicate"),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toEqual(
        expect.objectContaining({ message: "Order cannot be cancelled" }),
      );
    } finally {
      consoleError.mockRestore();
    }

    const [afterConcurrentCancel] = await testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(afterConcurrentCancel.inventoryCount).toBe(10);

    const [persistedOrder] = await testDb.drizzle
      .select()
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(persistedOrder.status).toBe("cancelled");
  });
});

async function seedCoupon(testDb: TestDatabase) {
  await testDb.drizzle.insert(coupons).values({
    restaurantId,
    code: "SAVE5",
    name: "RM5 off",
    discountType: "fixed",
    discountValueCents: 500,
    usageLimit: 5,
    usedCount: 0,
    validFrom: new Date("2020-01-01T00:00:00.000Z"),
    validTo: new Date("2099-12-31T00:00:00.000Z"),
    isActive: true,
    isVisible: true,
  });
}

describe("OrderService changeOrderItemQuantity", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await seedMenuItem(testDb);
  });

  const service = () =>
    new OrderService(testDb.bindings.DB, { JWT_SECRET: "test" });

  async function menuItemRow() {
    const [row] = await testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    return row;
  }

  function silenceServiceErrors() {
    return vi.spyOn(console, "error").mockImplementation(() => undefined);
  }

  it("reduces a line, restores its stock, and recomputes the total", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 3 }],
    });
    expect((await menuItemRow()).inventoryCount).toBe(7);

    const lineId = order.items![0].id;
    const updated = await service().changeOrderItemQuantity(
      order.id,
      lineId,
      1,
    );

    expect(updated.items).toHaveLength(1);
    expect(updated.items![0]).toMatchObject({ quantity: 1, totalPrice: 10 });
    expect(updated.subtotal).toBe(10);
    expect(updated.totalAmount).toBe(10);
    // The two the kitchen no longer needs go back on the shelf.
    expect((await menuItemRow()).inventoryCount).toBe(9);
    expect(updated.version).toBe(order.version + 1);
  });

  it("increases a line and takes the extra stock", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    const updated = await service().changeOrderItemQuantity(
      order.id,
      order.items![0].id,
      4,
    );

    expect(updated.items![0]).toMatchObject({ quantity: 4, totalPrice: 40 });
    expect(updated.subtotal).toBe(40);
    expect((await menuItemRow()).inventoryCount).toBe(6);
  });

  it("removes a line entirely when the quantity is 0", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [
        { menuItemId, quantity: 2 },
        { menuItemId, quantity: 1, notes: "no chilli" },
      ],
    });
    expect((await menuItemRow()).inventoryCount).toBe(7);

    const updated = await service().changeOrderItemQuantity(
      order.id,
      order.items![0].id,
      0,
    );

    expect(updated.items).toHaveLength(1);
    expect(updated.items![0].notes).toBe("no chilli");
    expect(updated.subtotal).toBe(10);
    expect((await menuItemRow()).inventoryCount).toBe(9);

    const persisted = await testDb.drizzle
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    expect(persisted).toHaveLength(1);
  });

  it("refuses to remove the last line, so an empty order cannot exist", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    const consoleError = silenceServiceErrors();
    try {
      await expect(
        service().changeOrderItemQuantity(order.id, order.items![0].id, 0),
      ).rejects.toThrow("Cannot remove the last item");
    } finally {
      consoleError.mockRestore();
    }

    const persisted = await testDb.drizzle
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    expect(persisted).toHaveLength(1);
  });

  it("refuses to edit an order the kitchen has already started", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });
    await service().updateOrderStatus(order.id, { status: "preparing" });

    const consoleError = silenceServiceErrors();
    try {
      await expect(
        service().changeOrderItemQuantity(order.id, order.items![0].id, 1),
      ).rejects.toThrow(
        "Cannot modify items on an order with status: preparing",
      );
    } finally {
      consoleError.mockRestore();
    }

    // Nothing moved: not the line, not the shelf.
    const [line] = await testDb.drizzle
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    expect(line.quantity).toBe(2);
    expect((await menuItemRow()).inventoryCount).toBe(8);
  });

  it("rejects a stale expectedVersion before anything moves", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 3 }],
    });
    // Someone else advances the order first.
    await service().updateOrderStatus(order.id, { status: "confirmed" });

    const consoleError = silenceServiceErrors();
    try {
      await expect(
        service().changeOrderItemQuantity(
          order.id,
          order.items![0].id,
          1,
          order.version,
        ),
      ).rejects.toThrow("Order version conflict");
    } finally {
      consoleError.mockRestore();
    }

    const [line] = await testDb.drizzle
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    expect(line.quantity).toBe(3);
    expect((await menuItemRow()).inventoryCount).toBe(7);
  });

  it("refuses an increase the shelf cannot cover, leaving the order untouched", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    const consoleError = silenceServiceErrors();
    try {
      await expect(
        service().changeOrderItemQuantity(order.id, order.items![0].id, 20),
      ).rejects.toThrow("Insufficient inventory");
    } finally {
      consoleError.mockRestore();
    }

    const [line] = await testDb.drizzle
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    expect(line.quantity).toBe(1);
    expect((await menuItemRow()).inventoryCount).toBe(9);
    // The order row must not have advanced either -- a version bump with no
    // change is how a client's next optimistic write gets rejected for nothing.
    const refreshed = await service().getOrder(order.id);
    expect(refreshed!.version).toBe(order.version);
  });

  it("refuses an item id that belongs to a different order", async () => {
    const mine = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });
    const theirs = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    const consoleError = silenceServiceErrors();
    try {
      await expect(
        service().changeOrderItemQuantity(mine.id, theirs.items![0].id, 0),
      ).rejects.toThrow("Order item not found");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("restores ingredient stock proportionally when a line shrinks", async () => {
    const [ingredient] = await testDb.drizzle
      .insert(ingredientDefinitions)
      .values({
        restaurantId,
        name: "Rice",
        unit: "kg",
        currentStock: 20,
        isActive: true,
      } as never)
      .returning({ id: ingredientDefinitions.id });
    await testDb.drizzle.insert(menuItemIngredients).values({
      menuItemId,
      ingredientId: ingredient.id,
      quantityPerServing: 0.25,
      unit: "kg",
      isOptional: false,
    } as never);

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 4 }],
    });
    const [afterOrder] = await testDb.drizzle
      .select({ currentStock: ingredientDefinitions.currentStock })
      .from(ingredientDefinitions)
      .where(eq(ingredientDefinitions.id, ingredient.id));
    expect(afterOrder.currentStock).toBeCloseTo(19);

    await service().changeOrderItemQuantity(order.id, order.items![0].id, 1);

    const [afterShrink] = await testDb.drizzle
      .select({ currentStock: ingredientDefinitions.currentStock })
      .from(ingredientDefinitions)
      .where(eq(ingredientDefinitions.id, ingredient.id));
    expect(afterShrink.currentStock).toBeCloseTo(19.75);

    const ledger = await testDb.drizzle
      .select({
        delta: ingredientStockMovements.delta,
        reason: ingredientStockMovements.reason,
      })
      .from(ingredientStockMovements)
      .where(eq(ingredientStockMovements.orderId, order.id));
    expect(ledger).toEqual([
      expect.objectContaining({ delta: -1, reason: "order_consumption" }),
      expect.objectContaining({ delta: 0.75, reason: "order_item_removal" }),
    ]);
  });

  it("keeps a coupon-discounted order from going negative when it shrinks", async () => {
    // A 5-off coupon on a 30 order. Shrinking to a single 10 item leaves 5 due,
    // and shrinking further would drive the arithmetic below zero.
    await seedCoupon(testDb);
    const order = await service().createOrder({
      restaurantId,
      couponCode: "SAVE5",
      items: [{ menuItemId, quantity: 3 }],
    });
    expect(order.totalAmount).toBe(25);

    const halved = await service().changeOrderItemQuantity(
      order.id,
      order.items![0].id,
      1,
    );
    expect(halved.subtotal).toBe(10);
    expect(halved.totalAmount).toBe(5);
    expect(halved.totalAmount).toBeGreaterThanOrEqual(0);
  });
});

/**
 * #278. The acceptance criteria are lifecycle properties, so they are checked
 * through OrderService rather than against the consumption service directly --
 * the wiring (claim before the batch, ledger rows inside it, restore on
 * cancel) is the part that can regress without the unit tests noticing.
 */
describe("OrderService ingredient consumption", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await seedMenuItem(testDb);
  });

  const service = () =>
    new OrderService(
      testDb.bindings.DB as unknown as D1Database,
      {
        JWT_SECRET: "test-secret",
      } as never,
    );

  async function seedIngredientWithRecipe(
    quantityPerServing: number,
    overrides: Record<string, unknown> = {},
  ) {
    const [ingredient] = await testDb.drizzle
      .insert(ingredientDefinitions)
      .values({
        restaurantId,
        name: "Rice",
        unit: "kg",
        currentStock: 20,
        isActive: true,
        ...overrides,
      } as never)
      .returning({ id: ingredientDefinitions.id });

    await testDb.drizzle.insert(menuItemIngredients).values({
      menuItemId,
      ingredientId: ingredient.id,
      quantityPerServing,
      unit: "kg",
      isOptional: false,
    } as never);

    return ingredient.id;
  }

  async function stockOf(ingredientId: number) {
    const [row] = await testDb.drizzle
      .select({ currentStock: ingredientDefinitions.currentStock })
      .from(ingredientDefinitions)
      .where(eq(ingredientDefinitions.id, ingredientId));
    return row?.currentStock ?? null;
  }

  async function ledgerFor(orderId: string) {
    return testDb.drizzle
      .select({
        delta: ingredientStockMovements.delta,
        reason: ingredientStockMovements.reason,
      })
      .from(ingredientStockMovements)
      .where(eq(ingredientStockMovements.orderId, orderId));
  }

  it("deducts ingredient stock when the order is placed", async () => {
    const rice = await seedIngredientWithRecipe(0.25);

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });

    expect(await stockOf(rice)).toBeCloseTo(19.5);
    // The ledger row carries the order, which is what makes the cancellation
    // reversible without consulting the recipe again.
    expect(await ledgerFor(order.id)).toEqual([
      expect.objectContaining({ delta: -0.5, reason: "order_consumption" }),
    ]);
  });

  it("leaves a dish with no recipe alone", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });

    expect(order.id).toBeTruthy();
    expect(await ledgerFor(order.id)).toEqual([]);
  });

  it("restores ingredient stock when the order is cancelled", async () => {
    const rice = await seedIngredientWithRecipe(0.5);

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 3 }],
    });
    expect(await stockOf(rice)).toBeCloseTo(18.5);

    await service().cancelOrder(order.id, "Customer changed their mind");

    expect(await stockOf(rice)).toBe(20);
    expect(await ledgerFor(order.id)).toEqual([
      expect.objectContaining({ reason: "order_consumption" }),
      expect.objectContaining({ delta: 1.5, reason: "order_cancellation" }),
    ]);
  });

  it("does not restore a second time when the order was already cancelled", async () => {
    const rice = await seedIngredientWithRecipe(0.5);

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });
    await service().cancelOrder(order.id, "First cancel");
    expect(await stockOf(rice)).toBe(20);

    // The restore runs only after the cancel row is confirmed changed. A
    // conditional UPDATE matching zero rows is not a batch failure, so if the
    // order were restored first its ledger row would already be durable and
    // undoing the stock would leave a movement nothing can reconcile.
    await expect(
      service().cancelOrder(order.id, "Second cancel"),
    ).rejects.toThrow(/cannot be cancelled/i);

    expect(await stockOf(rice)).toBe(20);
    expect(await ledgerFor(order.id)).toHaveLength(2);
  });

  it("restores exactly once when two cancellations race", async () => {
    const rice = await seedIngredientWithRecipe(0.5);

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });
    expect(await stockOf(rice)).toBeCloseTo(19);

    // Both calls read the order while it is still cancellable, so both get
    // past the status guard at the top of cancelOrder. Only one of their
    // conditional UPDATEs can match a row -- and the loser must not restore,
    // because a zero-match UPDATE is not a batch failure and its ledger row
    // would already be durable.
    const results = await Promise.allSettled([
      service().cancelOrder(order.id, "A"),
      service().cancelOrder(order.id, "B"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    expect(await stockOf(rice)).toBe(20);
    expect(await ledgerFor(order.id)).toEqual([
      expect.objectContaining({ reason: "order_consumption" }),
      expect.objectContaining({ delta: 1, reason: "order_cancellation" }),
    ]);
  });

  it("leaves no partial add effects when add-items races cancellation", async () => {
    const rice = await seedIngredientWithRecipe(0.5);
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    await Promise.allSettled([
      service().addItemsToOrder(order.id, [{ menuItemId, quantity: 1 }]),
      service().cancelOrder(order.id, "Concurrent cancellation"),
    ]);

    const [persisted] = await testDb.drizzle
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id));
    const items = await testDb.drizzle
      .select({ quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    if (persisted.status === "cancelled") {
      const [net] = await testDb.drizzle
        .select({
          net: sql<number>`COALESCE(SUM(${ingredientStockMovements.delta}), 0)`,
        })
        .from(ingredientStockMovements)
        .where(eq(ingredientStockMovements.orderId, order.id));
      expect(net.net).toBeCloseTo(0);
      expect(await stockOf(rice)).toBe(20);
    } else {
      // Cancellation lost its CAS, so only a complete add (never an orphan
      // item/inventory movement) may be visible.
      expect(items).toHaveLength(2);
      expect(await stockOf(rice)).toBeCloseTo(19);
    }
  });

  it("aborts a stale add batch before any dependent write", async () => {
    const rice = await seedIngredientWithRecipe(0.5);
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });
    const [before] = await testDb.drizzle
      .select({
        subtotalCents: orders.subtotalCents,
        totalAmountCents: orders.totalAmountCents,
        version: orders.version,
      })
      .from(orders)
      .where(eq(orders.id, order.id));

    const staleService = new OrderService(
      withBeforeBatch(testDb.bindings.DB as unknown as D1Database, async () => {
        await testDb.drizzle
          .update(orders)
          .set({ version: sql`${orders.version} + 1` })
          .where(eq(orders.id, order.id));
      }),
      { JWT_SECRET: "test-secret" } as never,
    );

    await expect(
      staleService.addItemsToOrder(order.id, [{ menuItemId, quantity: 1 }]),
    ).rejects.toThrow("Order cannot accept items");

    const [persisted] = await testDb.drizzle
      .select({
        subtotalCents: orders.subtotalCents,
        totalAmountCents: orders.totalAmountCents,
        version: orders.version,
      })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(persisted).toEqual({
      ...before,
      version: before.version + 1,
    });
    expect(
      await testDb.drizzle
        .select({ id: orderItems.id })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id)),
    ).toHaveLength(1);
    const [menuStock] = await testDb.drizzle
      .select({
        inventoryCount: menuItems.inventoryCount,
        orderCount: menuItems.orderCount,
      })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(menuStock).toMatchObject({ inventoryCount: 9, orderCount: 1 });
    expect(await stockOf(rice)).toBeCloseTo(19.5);
    expect(await ledgerFor(order.id)).toHaveLength(1);
  });

  it("keeps the customer's note and puts the cancellation reason in internalNotes", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
      notes: "不要香菜",
    });

    await service().cancelOrder(order.id, "Waiting list entry cancelled");

    const [row] = await testDb.drizzle
      .select({ notes: orders.notes, internalNotes: orders.internalNotes })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(row.notes).toBe("不要香菜");
    expect(row.internalNotes).toBe("Waiting list entry cancelled");
  });

  it("deducts again when items are added to an existing order", async () => {
    const rice = await seedIngredientWithRecipe(0.5);

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });
    await service().addItemsToOrder(order.id, [{ menuItemId, quantity: 2 }]);

    expect(await stockOf(rice)).toBeCloseTo(18.5);
    expect(await ledgerFor(order.id)).toHaveLength(2);
  });

  it("rolls back create, add, and cancel together when an ingredient ledger write fails", async () => {
    const rice = await seedIngredientWithRecipe(0.5);
    const rejectsLedgerWrite = async (operation: () => Promise<unknown>) => {
      await testDb.bindings.DB.exec(
        "CREATE TRIGGER fail_order_ledger BEFORE INSERT ON ingredient_stock_movements BEGIN SELECT RAISE(ABORT, 'forced ledger failure'); END",
      );
      try {
        await expect(operation()).rejects.toThrow("forced ledger failure");
      } finally {
        await testDb.bindings.DB.exec("DROP TRIGGER fail_order_ledger");
      }
    };

    await rejectsLedgerWrite(() =>
      service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 1 }],
      }),
    );
    expect(await testDb.drizzle.select().from(orders)).toEqual([]);
    expect(await stockOf(rice)).toBe(20);
    let [menuStock] = await testDb.drizzle
      .select({
        inventoryCount: menuItems.inventoryCount,
        orderCount: menuItems.orderCount,
      })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(menuStock).toMatchObject({ inventoryCount: 10, orderCount: 0 });

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });
    const [beforeFailedMutations] = await testDb.drizzle
      .select({
        status: orders.status,
        version: orders.version,
        subtotalCents: orders.subtotalCents,
        totalAmountCents: orders.totalAmountCents,
      })
      .from(orders)
      .where(eq(orders.id, order.id));
    await rejectsLedgerWrite(() =>
      service().addItemsToOrder(order.id, [{ menuItemId, quantity: 1 }]),
    );
    expect(await testDb.drizzle.select().from(orderItems)).toHaveLength(1);
    expect(await stockOf(rice)).toBeCloseTo(19.5);
    [menuStock] = await testDb.drizzle
      .select({
        inventoryCount: menuItems.inventoryCount,
        orderCount: menuItems.orderCount,
      })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(menuStock).toMatchObject({ inventoryCount: 9, orderCount: 1 });

    await rejectsLedgerWrite(() =>
      service().cancelOrder(order.id, "Failure injection"),
    );
    const [persisted] = await testDb.drizzle
      .select({
        status: orders.status,
        version: orders.version,
        subtotalCents: orders.subtotalCents,
        totalAmountCents: orders.totalAmountCents,
      })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(persisted).toEqual(beforeFailedMutations);
    expect(await stockOf(rice)).toBeCloseTo(19.5);
    [menuStock] = await testDb.drizzle
      .select({
        inventoryCount: menuItems.inventoryCount,
        orderCount: menuItems.orderCount,
      })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(menuStock).toMatchObject({ inventoryCount: 9, orderCount: 1 });
    expect(await ledgerFor(order.id)).toHaveLength(1);
  });

  it("stamps cancelledAt so the projected field is not always null", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    await service().cancelOrder(order.id, "Changed their mind");

    const [row] = await testDb.drizzle
      .select({ cancelledAt: orders.cancelledAt })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(row.cancelledAt).toBeInstanceOf(Date);
  });

  it("restores both inventories when a waiting list entry is cancelled", async () => {
    const rice = await seedIngredientWithRecipe(0.5);
    const [entry] = await testDb.drizzle
      .insert(waitingList)
      .values({
        id: "018f0000-0000-7000-8000-000000000901",
        restaurantId,
        customerName: "Pre-order customer",
        customerPhone: "0912345678",
        partySize: 2,
        queueNumber: 1,
        status: "waiting",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as never)
      .returning({ id: waitingList.id });

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
      waitingListId: entry.id,
      waitingListCustomerPhone: "0912345678",
    });
    expect(await stockOf(rice)).toBeCloseTo(19);

    await service().cancelWaitingListPreOrders(entry.id);

    // The bare UPDATE this replaced restored neither of these.
    expect(await stockOf(rice)).toBe(20);
    const [item] = await testDb.drizzle
      .select({ inventoryCount: menuItems.inventoryCount })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(item.inventoryCount).toBe(10);
    expect(await ledgerFor(order.id)).toEqual([
      expect.objectContaining({ reason: "order_consumption" }),
      expect.objectContaining({ delta: 1, reason: "order_cancellation" }),
    ]);
  });

  it("restores inventory when cancelled through the status endpoint's path", async () => {
    const rice = await seedIngredientWithRecipe(0.5);

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });
    expect(await stockOf(rice)).toBeCloseTo(19);

    // PUT /orders/:id/status reaches updateOrderStatus, which used to flip the
    // status with a bare UPDATE and restore nothing (#282).
    await service().updateOrderStatus(order.id, {
      status: "cancelled",
      notes: "Cancelled from the status endpoint",
    });

    expect(await stockOf(rice)).toBe(20);
    const [item] = await testDb.drizzle
      .select({ inventoryCount: menuItems.inventoryCount })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(item.inventoryCount).toBe(10);
    expect(await ledgerFor(order.id)).toEqual([
      expect.objectContaining({ reason: "order_consumption" }),
      expect.objectContaining({ delta: 1, reason: "order_cancellation" }),
    ]);
  });

  it("cancels an order that is already being prepared", async () => {
    const rice = await seedIngredientWithRecipe(0.5);

    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
    });
    await service().updateOrderStatus(order.id, { status: "confirmed" });
    const preparing = await service().updateOrderStatus(order.id, {
      status: "preparing",
    });

    // ORDER_STATUS_TRANSITIONS allows preparing -> cancelled, and
    // cancellableOrderStatuses is now aligned with it.
    await service().cancelOrder(order.id, "Kitchen ran out");

    expect(await stockOf(rice)).toBe(20);
    expect(preparing.status).toBe("preparing");
  });

  it("reports a version conflict as a version conflict, not as uncancellable", async () => {
    const order = await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 1 }],
    });

    // The API maps these two to different codes, so the delegation must not
    // collapse them.
    await expect(
      service().cancelOrder(order.id, "Stale", order.version + 99),
    ).rejects.toThrow(/version conflict/i);
  });

  it("puts the ingredients back when the order's own batch fails", async () => {
    const rice = await seedIngredientWithRecipe(0.5);

    await service().createOrder({
      restaurantId,
      items: [{ menuItemId, quantity: 2 }],
      clientMutationId: "duplicate-mutation",
    });
    expect(await stockOf(rice)).toBeCloseTo(19);

    // (restaurant_id, client_mutation_id) is uniquely indexed, so this insert
    // fails inside the batch -- after the ingredients were already deducted in
    // a batch of their own. That is the compensation path; without it the
    // stock would stay down with no order and no ledger row to explain it.
    await expect(
      service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 2 }],
        clientMutationId: "duplicate-mutation",
      }),
    ).rejects.toThrow();

    expect(await stockOf(rice)).toBeCloseTo(19);
    // The failed order's ledger rows died with its batch, and the revert
    // deliberately writes none of its own.
    const allRows = await testDb.drizzle
      .select({ delta: ingredientStockMovements.delta })
      .from(ingredientStockMovements);
    expect(allRows).toHaveLength(1);
  });

  it("does not deduct twice when the order fails to be created", async () => {
    const rice = await seedIngredientWithRecipe(0.5);

    // inventoryCount is 10, so this is refused by the menu-item claim that
    // runs before ingredients are touched at all.
    await expect(
      service().createOrder({
        restaurantId,
        items: [{ menuItemId, quantity: 99 }],
      }),
    ).rejects.toThrow(/Insufficient inventory/);

    expect(await stockOf(rice)).toBe(20);
  });
});

async function seedMenuItem(testDb: TestDatabase) {
  await testDb.drizzle.insert(restaurants).values({
    id: restaurantId,
    name: "Price Test Restaurant",
    type: "restaurant",
    category: "casual",
    address: "1 Test St",
    district: "Test District",
    city: "Test City",
    phone: "0912345678",
    isAvailable: true,
    settings: {
      taxRate: 0,
      serviceChargeRate: 0,
      minOrderAmount: 0,
    },
  });

  const [category] = await testDb.drizzle
    .insert(categories)
    .values({
      restaurantId,
      name: "Meals",
      sortOrder: 1,
    })
    .returning({ id: categories.id });

  await testDb.drizzle.insert(menuItems).values({
    id: menuItemId,
    restaurantId,
    categoryId: category.id,
    name: "Nasi Lemak",
    priceCents: 1000,
    isAvailable: true,
    inventoryCount: 10,
    options: {
      sizes: [
        {
          id: "large",
          name: "Large",
          priceAdjustment: 2,
        },
      ],
      customizations: [
        {
          id: "spice",
          name: "Spice",
          type: "single",
          required: false,
          choices: [
            {
              id: "hot",
              name: "Hot",
              priceAdjustment: 1.5,
            },
          ],
        },
      ],
      addOns: [
        {
          id: "egg",
          name: "Egg",
          price: 1,
          maxQuantity: 3,
        },
      ],
    },
  });
}
