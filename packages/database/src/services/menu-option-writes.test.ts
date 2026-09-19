import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  categories,
  menuItems,
  menuItemOptionChoiceOverrides,
  menuItemOptionGroups,
  optionChoices,
  optionGroups,
  restaurants,
} from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { MenuService } from "./menu";
import { loadAssembledMenuItemOptions } from "./menu-options";
import { OrderService } from "./order";

const restaurantId = "restaurant-option-writes";

describe("option group writes", () => {
  let testDb: TestDatabase;
  let categoryId: number;
  let menuItemId: number;

  const menuService = () =>
    new MenuService(testDb.bindings.DB, { JWT_SECRET: "test" });

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
      name: "Option Writes",
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
      .values({ restaurantId, name: "Drinks", sortOrder: 1 })
      .returning({ id: categories.id });
    categoryId = category.id;
    const [item] = await testDb.drizzle
      .insert(menuItems)
      .values({
        restaurantId,
        categoryId,
        name: "Milk Tea",
        priceCents: 6000,
        isAvailable: true,
        inventoryCount: 10,
        options: null,
      })
      .returning({ id: menuItems.id });
    menuItemId = item.id;
  });

  async function seedGroup(
    id: string,
    publicId: string,
    overrides: Partial<typeof optionGroups.$inferInsert> = {},
  ) {
    await testDb.drizzle.insert(optionGroups).values({
      id,
      restaurantId,
      publicId,
      kind: "choice",
      name: publicId,
      type: "single",
      ...overrides,
    });
  }

  /**
   * The publicId invariant is enforced in MenuService.createOptionGroup, NOT
   * by a unique index on (restaurant_id, public_id).
   *
   * A DB-level constraint would be stricter than the data model allows: the
   * legacy backfill (backfillMenuItemOptions) emits one group per menu item
   * with the fixed publicIds `sizes` and `addOns`, because those are the
   * strings existing carts and order snapshots already reference. Two items
   * with different sizes therefore legitimately hold two live groups both
   * called `sizes`. Migration 0009 added that index and was withdrawn once it
   * broke the backfill.
   *
   * So a raw insert must still succeed — that is the backfill's path — while
   * the owner-facing create path rejects the duplicate. The next test pins
   * that half.
   */
  it("leaves raw inserts unconstrained so the per-item backfill stays possible", async () => {
    await seedGroup("group-1", "spice");
    await expect(seedGroup("group-2", "spice")).resolves.not.toThrow();

    const live = await testDb.drizzle
      .select({ id: optionGroups.id })
      .from(optionGroups)
      .where(eq(optionGroups.publicId, "spice"));
    expect(live).toHaveLength(2);
  });

  it("frees a public id once the group holding it is soft deleted", async () => {
    const service = menuService();
    const created = await service.createOptionGroup({
      id: "group-1",
      restaurantId,
      publicId: "spice",
      kind: "choice",
      name: "Spice",
      type: "single",
    });

    await service.softDeleteOptionGroup(created.id);

    await expect(
      service.createOptionGroup({
        id: "group-2",
        restaurantId,
        publicId: "spice",
        kind: "choice",
        name: "Spice again",
        type: "single",
      }),
    ).resolves.toMatchObject({ publicId: "spice" });
  });

  it("returns a semantic conflict when creating a duplicate group", async () => {
    const service = menuService();
    await service.createOptionGroup({
      id: "group-1",
      restaurantId,
      publicId: "spice",
      kind: "choice",
      name: "Spice",
      type: "single",
    });

    await expect(
      service.createOptionGroup({
        id: "group-2",
        restaurantId,
        publicId: "spice",
        kind: "choice",
        name: "Other spice",
        type: "single",
      }),
    ).rejects.toThrow("Option group public id already exists for restaurant");
  });

  it("returns a semantic conflict when creating a duplicate choice", async () => {
    const service = menuService();
    await seedGroup("group-1", "spice");
    await service.createOptionChoice({
      id: "choice-hot-1",
      groupId: "group-1",
      publicId: "hot",
      name: "Hot",
    });

    await expect(
      service.createOptionChoice({
        id: "choice-hot-2",
        groupId: "group-1",
        publicId: "hot",
        name: "Also hot",
      }),
    ).rejects.toThrow("Option choice public id already exists in group");
  });

  it("counts how many menu items use each option group", async () => {
    await seedGroup("group-used", "used");
    await seedGroup("group-unused", "unused");
    const [other] = await testDb.drizzle
      .insert(menuItems)
      .values({
        restaurantId,
        categoryId,
        name: "Green Tea",
        priceCents: 5000,
        isAvailable: true,
        options: null,
      })
      .returning({ id: menuItems.id });

    await menuService().linkMenuItemOptionGroup({
      menuItemId,
      groupId: "group-used",
    });
    await menuService().linkMenuItemOptionGroup({
      menuItemId: other.id,
      groupId: "group-used",
    });

    const groups = await menuService().listOptionGroups(restaurantId);
    const usageByGroupId = new Map(
      groups.map((group) => [group.id, group.usageCount]),
    );

    expect(usageByGroupId.get("group-used")).toBe(2);
    expect(usageByGroupId.get("group-unused")).toBe(0);
  });

  it("lists a menu item's option group links and choice overrides", async () => {
    await seedGroup("group-1", "spice");
    await testDb.drizzle.insert(optionChoices).values([
      {
        id: "choice-hot",
        groupId: "group-1",
        publicId: "hot",
        name: "Hot",
        sortOrder: 2,
      },
      {
        id: "choice-mild",
        groupId: "group-1",
        publicId: "mild",
        name: "Mild",
        sortOrder: 1,
      },
    ]);

    await menuService().replaceMenuItemOptionGroups(menuItemId, [
      {
        groupId: "group-1",
        sortOrder: 3,
        requiredOverride: true,
        maxSelectionsOverride: null,
        choiceOverrides: [
          {
            choiceId: "choice-hot",
            isHidden: true,
            priceAdjustmentCents: 1500,
          },
        ],
      },
    ]);

    await expect(
      menuService().listMenuItemOptionGroups(menuItemId),
    ).resolves.toEqual({
      groups: [
        {
          groupId: "group-1",
          sortOrder: 3,
          requiredOverride: true,
          maxSelectionsOverride: null,
          choiceOverrides: [
            {
              choiceId: "choice-hot",
              isHidden: true,
              priceAdjustmentCents: 1500,
            },
          ],
        },
      ],
    });
  });

  it("takes a soft-deleted group out of the assembled options", async () => {
    await testDb.drizzle
      .update(menuItems)
      .set({
        options: {
          customizations: [
            {
              id: "legacy-spice",
              name: "Legacy spice",
              type: "single",
              required: false,
              choices: [
                { id: "legacy-hot", name: "Legacy hot", priceAdjustment: 9 },
              ],
            },
          ],
        },
      })
      .where(eq(menuItems.id, menuItemId));
    await seedGroup("group-1", "spice");
    await testDb.drizzle.insert(optionChoices).values({
      id: "choice-hot",
      groupId: "group-1",
      publicId: "hot",
      name: "Hot",
    });
    await menuService().linkMenuItemOptionGroup({
      menuItemId,
      groupId: "group-1",
    });

    const assembled = async () => {
      const [item] = await testDb.drizzle
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, menuItemId));
      return (await loadAssembledMenuItemOptions(testDb.drizzle, [item])).get(
        menuItemId,
      );
    };

    expect((await assembled())?.customizations).toHaveLength(1);
    expect(await menuService().softDeleteOptionGroup("group-1")).toBe(true);
    expect((await assembled())?.customizations).toBeUndefined();
    const [storedItem] = await testDb.drizzle
      .select({ options: menuItems.options })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId));
    expect(storedItem.options).toBeNull();
    // The link survives, so the delete is reversible.
    expect(
      await testDb.drizzle.select().from(menuItemOptionGroups),
    ).toHaveLength(1);
  });

  it("removes overrides with the choice they point at", async () => {
    await seedGroup("group-1", "spice");
    await testDb.drizzle.insert(optionChoices).values({
      id: "choice-hot",
      groupId: "group-1",
      publicId: "hot",
      name: "Hot",
    });
    await menuService().linkMenuItemOptionGroup({
      menuItemId,
      groupId: "group-1",
    });
    await menuService().upsertMenuItemOptionChoiceOverride({
      menuItemId,
      choiceId: "choice-hot",
      isHidden: true,
    });

    expect(await menuService().deleteOptionChoice("choice-hot")).toBe(true);

    expect(
      await testDb.drizzle.select().from(menuItemOptionChoiceOverrides),
    ).toHaveLength(0);
  });

  it("reports a miss instead of throwing when there is nothing to remove", async () => {
    expect(
      await menuService().unlinkMenuItemOptionGroup(menuItemId, "missing"),
    ).toBe(false);
    expect(await menuService().deleteOptionChoice("missing")).toBe(false);
    expect(
      await menuService().deleteMenuItemOptionChoiceOverride(
        menuItemId,
        "missing",
      ),
    ).toBe(false);
  });

  // The owner flips the switch mid-service; a modal opened a minute earlier
  // still shows what has since run out.
  describe("sold out is refused at submit", () => {
    const orderService = () =>
      new OrderService(testDb.bindings.DB, { JWT_SECRET: "test" });

    beforeEach(async () => {
      await seedGroup("group-sweet", "sweetness");
      await testDb.drizzle.insert(optionChoices).values([
        {
          id: "choice-half",
          groupId: "group-sweet",
          publicId: "half",
          name: "半糖",
          isAvailable: false,
        },
        {
          id: "choice-full",
          groupId: "group-sweet",
          publicId: "full",
          name: "全糖",
        },
      ]);
      await testDb.drizzle
        .insert(menuItemOptionGroups)
        .values({ menuItemId, groupId: "group-sweet" });
    });

    it("refuses a sold-out choice", async () => {
      await expect(
        orderService().createOrder({
          restaurantId,
          items: [
            {
              menuItemId,
              quantity: 1,
              customizations: {
                options: [
                  {
                    id: "sweetness",
                    optionName: "sweetness",
                    choiceId: "half",
                    choiceName: "半糖",
                  },
                ],
              },
            },
          ],
        }),
      ).rejects.toThrow(/Invalid customization: choice half is sold out/);
    });

    it("still takes the choice that is in stock", async () => {
      const order = await orderService().createOrder({
        restaurantId,
        items: [
          {
            menuItemId,
            quantity: 1,
            customizations: {
              options: [
                {
                  id: "sweetness",
                  optionName: "sweetness",
                  choiceId: "full",
                  choiceName: "全糖",
                },
              ],
            },
          },
        ],
      });

      expect(order.items?.[0].customizations?.options).toHaveLength(1);
    });
  });
});
