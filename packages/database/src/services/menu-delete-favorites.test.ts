import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  categories,
  customerFavorites,
  customers,
  menuItems,
  restaurants,
} from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { MenuService } from "./menu";

const restaurantId = "restaurant-delete-favorites";

describe("softDeleteMenuItem and saved dishes", () => {
  let testDb: TestDatabase;
  let deletedId: number;
  let keptId: number;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await testDb.drizzle.insert(restaurants).values({
      id: restaurantId,
      name: "Delete Favorites",
      type: "taiwanese",
      category: "casual",
      address: "1 Test St",
      district: "D",
      city: "C",
      phone: "0912345678",
      isAvailable: true,
    });
    const [category] = await testDb.drizzle
      .insert(categories)
      .values({ restaurantId, name: "Rice", sortOrder: 1 })
      .returning({ id: categories.id });
    const items = await testDb.drizzle
      .insert(menuItems)
      .values(
        ["Braised Pork Rice", "Chicken Rice"].map((name) => ({
          restaurantId,
          categoryId: category.id,
          name,
          priceCents: 5000,
          isAvailable: true,
        })),
      )
      .returning({ id: menuItems.id });
    [deletedId, keptId] = items.map((item) => item.id);
    await testDb.drizzle
      .insert(customers)
      .values({ id: "customer-1", displayName: "Diner" });
    await testDb.drizzle.insert(customerFavorites).values([
      {
        customerId: "customer-1",
        targetType: "dish",
        targetId: `${deletedId}`,
      },
      { customerId: "customer-1", targetType: "dish", targetId: `${keptId}` },
      // Same id string under another target type must survive.
      {
        customerId: "customer-1",
        targetType: "market",
        targetId: `${deletedId}`,
      },
    ]);
  });

  it("removes only that dish's favorites, in the same batch as the delete", async () => {
    const service = new MenuService(testDb.bindings.DB, { JWT_SECRET: "test" });

    await expect(service.softDeleteMenuItem(deletedId)).resolves.toBe(true);

    const remaining = await testDb.drizzle
      .select({
        targetType: customerFavorites.targetType,
        targetId: customerFavorites.targetId,
      })
      .from(customerFavorites);
    expect(remaining).toHaveLength(2);
    expect(remaining).toEqual(
      expect.arrayContaining([
        { targetType: "dish", targetId: `${keptId}` },
        { targetType: "market", targetId: `${deletedId}` },
      ]),
    );
  });
});
