import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import {
  categories,
  menuItems,
  optionChoices,
  optionGroups,
} from "@makanmasak/database";
import { eq } from "drizzle-orm";
import {
  readData,
  readEnvelope,
  readError,
  type ServiceData,
} from "../helpers/read-json";
import type { MenuService } from "../../features/menu/services/MenuService";

// The menu routes wrap a service result in the standard envelope, so the
// response shapes are derived from MenuService rather than restated here.
type Menu = ServiceData<MenuService["getMenu"]>;
type MenuItemRow = ServiceData<MenuService["getMenuItem"]>;
type OptionGroupList = ServiceData<MenuService["listOptionGroups"]>;
type OptionGroup = ServiceData<MenuService["createOptionGroup"]>;
type OptionChoice = ServiceData<MenuService["createOptionChoice"]>;
type MenuItemOptionGroups = ServiceData<
  MenuService["listMenuItemOptionGroups"]
>;
type MenuSearchItems = ServiceData<MenuService["searchMenuItems"]>["items"];
type FeaturedItems = ServiceData<MenuService["getFeaturedItems"]>;
type PopularItems = ServiceData<MenuService["getPopularItems"]>;
type MenuAnalytics = ServiceData<MenuService["getMenuAnalytics"]>;
type PopularityMetrics = ServiceData<MenuService["getPopularityMetrics"]>;
type CategoryRow = ServiceData<MenuService["createCategory"]>;
type BulkCreatedItems = {
  created: number;
  items: ServiceData<MenuService["bulkCreateMenuItems"]>;
};

/**
 * Matches the double-submit contract in apps/api/src/middleware/csrf.ts:
 * a 64-hex token in both the X-CSRF-Token header and the csrf_token cookie,
 * with host and origin that agree.
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

/**
 * POST/PUT /menu items sit behind moduleGate("menu_management"), so a shop
 * needs an active subscription or the route answers 403 SUBSCRIPTION_NOT_FOUND
 * before the schema is ever reached.
 */
async function insertActiveSubscription(
  testApp: RealIntegrationTestApp,
  restaurantId: string,
) {
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

describe("Menu API — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
    // No per-hook timeout override here: on a cold cache this hook replays the
    // whole migrations_fresh track to build the shared D1 baseline, which now
    // exceeds 60s. vitest.real-integration.config.ts sets hookTimeout to the
    // intended 5-minute bound for exactly this.
  });

  afterAll(async () => {
    await testApp?.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  it("returns menu with categories and menuItems joined", async () => {
    const restaurant = await seed.restaurant();

    // seed.menuItem internally creates a throwaway category + menu item for
    // this restaurant. Pass explicit overrides to defeat factory flake.
    const item = await seed.menuItem(restaurant.id, {
      isAvailable: true,
      isFeatured: true,
      priceCents: 15000,
      name: "Nasi Lemak",
    });

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}`),
    );

    expect(res.status).toBe(200);
    const json = await readData<Menu>(res);

    const data = json;

    // Response shape: { categories: [...], menuItems: [...] }
    // No `restaurant` wrapper — transformMenuStructure only returns these two arrays.
    expect(Array.isArray(data.categories)).toBe(true);
    expect(data.categories.length).toBeGreaterThanOrEqual(1);

    expect(Array.isArray(data.menuItems)).toBe(true);
    expect(data.menuItems.length).toBeGreaterThanOrEqual(1);

    // The seeded item should appear in the flat menuItems list.
    const found = data.menuItems.find((i) => i.id === item.id);
    if (!found) {
      throw new Error(`seeded item ${item.id} missing from the menu`);
    }
    expect(found.name).toBe("Nasi Lemak");
    expect(found.price).toBe(150);
  });

  it("returns empty arrays for a restaurant with no menu items", async () => {
    const restaurant = await seed.restaurant();

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}`),
    );

    // Route returns 404 when no menu exists (getMenu returns null for unknown
    // restaurant), so either 200+empty or 404 are valid here.
    // We assert on the actual behavior rather than an assumption.
    if (res.status === 200) {
      const json = await readData<Menu>(res);
      expect(Array.isArray(json.categories)).toBe(true);
      expect(Array.isArray(json.menuItems)).toBe(true);
    } else {
      expect(res.status).toBe(404);
    }
  });

  it("filters unavailable items from public request", async () => {
    const restaurant = await seed.restaurant();

    // Seed one available and one unavailable item.
    const available = await seed.menuItem(restaurant.id, {
      isAvailable: true,
      name: "Available Item",
    });
    const unavailable = await seed.menuItem(restaurant.id, {
      isAvailable: false,
      name: "Hidden Item",
    });

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}`),
    );
    expect(res.status).toBe(200);
    const json = await readData<Menu>(res);

    const items = json.menuItems ?? [];
    const availableFound = items.find((i) => i.id === available.id);
    const unavailableFound = items.find((i) => i.id === unavailable.id);

    // Available item must be visible to public callers.
    expect(availableFound).toBeTruthy();
    // Unavailable item should NOT appear in the public (unauthenticated) response.
    expect(unavailableFound).toBeUndefined();
  });

  it("filters unavailable items from public menu search by default", async () => {
    const restaurant = await seed.restaurant();

    await seed.menuItem(restaurant.id, {
      isAvailable: true,
      name: "Searchable Available Item",
    });
    await seed.menuItem(restaurant.id, {
      isAvailable: false,
      name: "Searchable Hidden Item",
    });

    const [defaultRes, unavailableQueryRes] = await Promise.all([
      testApp.app.fetch(
        new Request(
          `https://test/api/v1/menu/${restaurant.id}/search?search=Searchable`,
        ),
      ),
      testApp.app.fetch(
        new Request(
          `https://test/api/v1/menu/${restaurant.id}/search?search=Searchable&isAvailable=false`,
        ),
      ),
    ]);

    expect([defaultRes.status, unavailableQueryRes.status]).toEqual([200, 200]);
    const responses = await Promise.all([
      readData<MenuSearchItems>(defaultRes),
      readData<MenuSearchItems>(unavailableQueryRes),
    ]);

    for (const json of responses) {
      expect(json.map((item) => item.name)).toEqual([
        "Searchable Available Item",
      ]);
    }
  });

  it("round-trips option choice price and sold-out state through assembled menu", async () => {
    // MYR: the RM1.50 option prices below are legitimate sen. A TWD shop
    // cannot price an option at NT$1.50 (CURRENCY_PRECISION).
    const restaurant = await seed.restaurant({
      settings: {
        allowOnlineOrdering: true,
        allowGuestOrders: true,
        currency: "MYR",
      },
    });
    await insertActiveSubscription(testApp, String(restaurant.id));
    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );
    const item = await seed.menuItem(restaurant.id, {
      name: "Assembled Spice Item",
      isAvailable: true,
    });

    const groupRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/option-groups`, {
        method: "POST",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({
          publicId: "spice",
          kind: "choice",
          name: "Spice",
          type: "multiple",
          required: true,
          maxSelections: 3,
        }),
      }),
    );
    expect(groupRes.status).toBe(201);
    const groupJson = await readData<OptionGroup>(groupRes);

    const choiceRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/menu/option-groups/${groupJson.id}/choices`,
        {
          method: "POST",
          headers: csrfHeaders(ownerToken),
          body: JSON.stringify({
            publicId: "hot",
            name: "Hot",
            priceAdjustment: 1.5,
            isDefault: true,
            maxQuantity: 2,
          }),
        },
      ),
    );
    expect(choiceRes.status).toBe(201);
    const choiceJson = await readData<OptionChoice>(choiceRes);
    expect(choiceJson.priceAdjustment).toBe(1.5);

    const storedChoice = await testApp.testDb.drizzle
      .select({ priceAdjustmentCents: optionChoices.priceAdjustmentCents })
      .from(optionChoices)
      .where(eq(optionChoices.id, choiceJson.id));
    expect(storedChoice).toEqual([{ priceAdjustmentCents: 150 }]);

    const clearGroupLimitRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/option-groups/${groupJson.id}`, {
        method: "PUT",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({ type: "single", maxSelections: null }),
      }),
    );
    expect(clearGroupLimitRes.status).toBe(200);

    const clearChoiceLimitRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/option-choices/${choiceJson.id}`, {
        method: "PATCH",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({ maxQuantity: null }),
      }),
    );
    expect(clearChoiceLimitRes.status).toBe(200);

    const linkRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/items/${item.id}/option-groups`, {
        method: "PUT",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({
          groups: [{ groupId: groupJson.id }],
        }),
      }),
    );
    expect(linkRes.status).toBe(200);

    const patchRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/option-choices/${choiceJson.id}`, {
        method: "PATCH",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({ isAvailable: false }),
      }),
    );
    expect(patchRes.status).toBe(200);

    const listRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/option-groups`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );
    expect(listRes.status).toBe(200);
    const listJson = await readData<OptionGroupList>(listRes);
    expect(listJson[0]).toMatchObject({
      type: "single",
      maxSelections: null,
      usageCount: 1,
    });
    expect(listJson[0].choices[0]).toMatchObject({
      priceAdjustment: 1.5,
      maxQuantity: null,
      isAvailable: false,
    });

    const menuRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}`),
    );
    expect(menuRes.status).toBe(200);
    const menuJson = await readData<Menu>(menuRes);
    const assembledItem = menuJson.menuItems.find(
      (menuItem) => menuItem.id === item.id,
    );
    if (!assembledItem?.options) {
      throw new Error(`item ${item.id} came back without assembled options`);
    }
    expect(assembledItem.options.customizations).toEqual([
      {
        id: "spice",
        name: "Spice",
        type: "single",
        required: true,
        choices: [
          {
            id: "hot",
            name: "Hot",
            priceAdjustment: 1.5,
            isDefault: true,
            available: false,
          },
        ],
      },
    ]);
  });

  it("replaces item option groups and rejects duplicate public ids", async () => {
    // MYR: the RM1.50 option prices below are legitimate sen. A TWD shop
    // cannot price an option at NT$1.50 (CURRENCY_PRECISION).
    const restaurant = await seed.restaurant({
      settings: {
        allowOnlineOrdering: true,
        allowGuestOrders: true,
        currency: "MYR",
      },
    });
    await insertActiveSubscription(testApp, String(restaurant.id));
    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );
    const item = await seed.menuItem(restaurant.id, {
      name: "Replace Option Item",
      isAvailable: true,
    });

    async function createGroup(publicId: string, name: string) {
      const groupRes = await testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${restaurant.id}/option-groups`, {
          method: "POST",
          headers: csrfHeaders(ownerToken),
          body: JSON.stringify({
            publicId,
            kind: "choice",
            name,
            type: "single",
            required: false,
          }),
        }),
      );
      expect(groupRes.status).toBe(201);
      const groupJson = await readData<OptionGroup>(groupRes);

      const choiceRes = await testApp.app.fetch(
        new Request(
          `https://test/api/v1/menu/option-groups/${groupJson.id}/choices`,
          {
            method: "POST",
            headers: csrfHeaders(ownerToken),
            body: JSON.stringify({
              publicId: `${publicId}-choice`,
              name: `${name} Choice`,
              priceAdjustment: 0,
            }),
          },
        ),
      );
      expect(choiceRes.status).toBe(201);
      const choiceJson = await readData<OptionChoice>(choiceRes);
      return { group: groupJson, choice: choiceJson };
    }

    const oldOption = await createGroup("old_spice", "Old Spice");
    const newOption = await createGroup("new_spice", "New Spice");

    let replaceRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/items/${item.id}/option-groups`, {
        method: "PUT",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({
          groups: [{ groupId: oldOption.group.id }],
        }),
      }),
    );
    expect(replaceRes.status).toBe(200);

    replaceRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/items/${item.id}/option-groups`, {
        method: "PUT",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({
          groups: [
            {
              groupId: newOption.group.id,
              requiredOverride: true,
              choiceOverrides: [
                {
                  choiceId: newOption.choice.id,
                  priceAdjustment: 1.5,
                },
              ],
            },
          ],
        }),
      }),
    );
    expect(replaceRes.status).toBe(200);

    const itemGroupsRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/items/${item.id}/option-groups`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );
    expect(itemGroupsRes.status).toBe(200);
    const itemGroupsJson = await readData<MenuItemOptionGroups>(itemGroupsRes);
    expect(itemGroupsJson).toEqual({
      groups: [
        {
          groupId: newOption.group.id,
          sortOrder: 0,
          requiredOverride: true,
          maxSelectionsOverride: null,
          choiceOverrides: [
            {
              choiceId: newOption.choice.id,
              isHidden: false,
              priceAdjustment: 1.5,
            },
          ],
        },
      ],
    });

    const groupListRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/option-groups`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );
    expect(groupListRes.status).toBe(200);
    const groupListJson = await readData<OptionGroupList>(groupListRes);
    const usageByGroupId = new Map(
      groupListJson.map((group) => [group.id, group.usageCount]),
    );
    expect(usageByGroupId.get(oldOption.group.id)).toBe(0);
    expect(usageByGroupId.get(newOption.group.id)).toBe(1);

    const menuRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}`),
    );
    expect(menuRes.status).toBe(200);
    const menuJson = await readData<Menu>(menuRes);
    const assembledItem = menuJson.menuItems.find(
      (menuItem) => menuItem.id === item.id,
    );
    if (!assembledItem?.options) {
      throw new Error(`item ${item.id} came back without assembled options`);
    }
    expect(assembledItem.options.customizations).toEqual([
      {
        id: "new_spice",
        name: "New Spice",
        type: "single",
        required: true,
        choices: [
          {
            id: "new_spice-choice",
            name: "New Spice Choice",
            priceAdjustment: 1.5,
          },
        ],
      },
    ]);

    // Two live groups sharing a publicId can no longer be created through the
    // API -- MenuService.createOptionGroup rejects the second. They still
    // occur legitimately: backfillMenuItemOptions writes straight through
    // db.batch() and gives every item's group the fixed publicId `sizes` /
    // `addOns`. So seed the duplicate the way the backfill does, which is the
    // only way this restaurant can actually reach the per-item guard below.
    const firstDuplicate = await createGroup("same_public", "Same Public A");
    const [backfilledDuplicate] = await testApp.testDb.drizzle
      .insert(optionGroups)
      .values({
        id: "backfilled-same-public",
        restaurantId: String(restaurant.id),
        publicId: "same_public",
        kind: "choice",
        name: "Same Public B",
        type: "single",
      })
      .returning();
    const secondDuplicate = { group: backfilledDuplicate };
    const conflictRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/items/${item.id}/option-groups`, {
        method: "PUT",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({
          groups: [
            { groupId: firstDuplicate.group.id },
            { groupId: secondDuplicate.group.id },
          ],
        }),
      }),
    );
    expect(conflictRes.status).toBe(409);
    await expect(conflictRes.json()).resolves.toMatchObject({
      success: false,
      error: expect.objectContaining({
        code: "OPTION_GROUP_PUBLIC_ID_CONFLICT",
      }),
    });

    const activeGroups = await testApp.testDb.drizzle
      .select({ publicId: optionGroups.publicId })
      .from(optionGroups)
      .where(eq(optionGroups.restaurantId, String(restaurant.id)));
    expect(activeGroups.map((group) => group.publicId)).toContain(
      "same_public",
    );
  });

  it("hides public menu items that belong to private categories", async () => {
    const restaurant = await seed.restaurant();
    const now = new Date();
    const [visibleCategory, inactiveCategory, hiddenCategory, deletedCategory] =
      await testApp.testDb.drizzle
        .insert(categories)
        .values([
          {
            restaurantId: String(restaurant.id),
            name: "Visible Public Category",
            sortOrder: 0,
            isActive: true,
            isVisible: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            restaurantId: String(restaurant.id),
            name: "Inactive Private Category",
            sortOrder: 1,
            isActive: false,
            isVisible: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            restaurantId: String(restaurant.id),
            name: "Hidden Private Category",
            sortOrder: 2,
            isActive: true,
            isVisible: false,
            createdAt: now,
            updatedAt: now,
          },
          {
            restaurantId: String(restaurant.id),
            name: "Deleted Private Category",
            sortOrder: 3,
            isActive: true,
            isVisible: true,
            deletedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning();

    await seed.menuItem(restaurant.id, {
      categoryId: visibleCategory.id,
      name: "Public Category Item",
      isAvailable: true,
      isFeatured: true,
      orderCount: 10,
    });
    await seed.menuItem(restaurant.id, {
      categoryId: inactiveCategory.id,
      name: "Inactive Category Item",
      isAvailable: true,
      isFeatured: true,
      orderCount: 40,
    });
    await seed.menuItem(restaurant.id, {
      categoryId: hiddenCategory.id,
      name: "Hidden Category Item",
      isAvailable: true,
      isFeatured: true,
      orderCount: 30,
    });
    await seed.menuItem(restaurant.id, {
      categoryId: deletedCategory.id,
      name: "Deleted Category Item",
      isAvailable: true,
      isFeatured: true,
      orderCount: 20,
    });

    const [menuRes, featuredRes, popularRes, searchRes] = await Promise.all([
      testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${restaurant.id}`),
      ),
      testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${restaurant.id}/featured`),
      ),
      testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${restaurant.id}/popular`),
      ),
      testApp.app.fetch(
        new Request(
          `https://test/api/v1/menu/${restaurant.id}/search?search=Category+Item`,
        ),
      ),
    ]);

    expect([
      menuRes.status,
      featuredRes.status,
      popularRes.status,
      searchRes.status,
    ]).toEqual([200, 200, 200, 200]);

    const menuJson = await readData<Menu>(menuRes);
    const featuredJson = await readData<FeaturedItems>(featuredRes);
    const popularJson = await readData<PopularItems>(popularRes);
    const searchJson = await readData<MenuSearchItems>(searchRes);

    expect(menuJson.menuItems.map((item) => item.name)).toEqual([
      "Public Category Item",
    ]);
    expect(featuredJson.map((item) => item.name)).toEqual([
      "Public Category Item",
    ]);
    expect(popularJson.map((item) => item.name)).toEqual([
      "Public Category Item",
    ]);
    expect(searchJson.map((item) => item.name)).toEqual([
      "Public Category Item",
    ]);
  });

  it("does not expose public menus for inactive or deleted restaurants", async () => {
    const inactiveRestaurant = await seed.restaurant({
      name: "Inactive Public Menu Vendor",
      isActive: false,
    });
    const deletedRestaurant = await seed.restaurant({
      name: "Deleted Public Menu Vendor",
      deletedAt: new Date(),
    });

    await seed.menuItem(inactiveRestaurant.id, {
      isAvailable: true,
      name: "Inactive Vendor Item",
    });
    await seed.menuItem(deletedRestaurant.id, {
      isAvailable: true,
      name: "Deleted Vendor Item",
    });

    const [inactiveRes, deletedRes] = await Promise.all([
      testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${inactiveRestaurant.id}`),
      ),
      testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${deletedRestaurant.id}`),
      ),
    ]);

    expect(inactiveRes.status).toBe(404);
    expect(deletedRes.status).toBe(404);
  });

  it("does not expose public menu helper endpoints for inactive or deleted restaurants", async () => {
    const inactiveRestaurant = await seed.restaurant({
      name: "Inactive Public Menu Helper Vendor",
      isActive: false,
    });
    const deletedRestaurant = await seed.restaurant({
      name: "Deleted Public Menu Helper Vendor",
      deletedAt: new Date(),
    });

    await seed.menuItem(inactiveRestaurant.id, {
      isAvailable: true,
      isFeatured: true,
      isPopular: true,
      name: "Inactive Helper Item",
    });
    await seed.menuItem(deletedRestaurant.id, {
      isAvailable: true,
      isFeatured: true,
      isPopular: true,
      name: "Deleted Helper Item",
    });

    const urls = [
      `https://test/api/v1/menu/${inactiveRestaurant.id}/featured`,
      `https://test/api/v1/menu/${inactiveRestaurant.id}/popular`,
      `https://test/api/v1/menu/${inactiveRestaurant.id}/search?search=Helper`,
      `https://test/api/v1/menu/${deletedRestaurant.id}/featured`,
      `https://test/api/v1/menu/${deletedRestaurant.id}/popular`,
      `https://test/api/v1/menu/${deletedRestaurant.id}/search?search=Helper`,
    ];

    const responses = await Promise.all(
      urls.map((url) => testApp.app.fetch(new Request(url))),
    );

    expect(responses.map((res) => res.status)).toEqual([
      404, 404, 404, 404, 404, 404,
    ]);
  });

  // Issue #78: createMenuItemSchema silently stripped these fields, so the
  // API answered 201 while writing none of them. Full round-trip proof:
  // POST persists them, and a subsequent GET reads the same values back.
  it("POST /:restaurantId/items persists availability/featured/sort fields (#78)", async () => {
    const restaurant = await seed.restaurant();
    await seed.user({
      id: 1,
      username: "admin-menu-78",
      role: 0,
      restaurantId: String(restaurant.id),
    });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );
    const now = new Date();
    const [category] = await testApp.testDb.drizzle
      .insert(categories)
      .values({
        restaurantId: String(restaurant.id),
        name: "Issue 78 Category",
        sortOrder: 0,
        isActive: true,
        isVisible: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: categories.id });

    const csrfToken = "a".repeat(64);
    const createRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
          host: "test",
          origin: "https://test",
          "x-csrf-token": csrfToken,
          cookie: `csrf_token=${csrfToken}`,
        },
        body: JSON.stringify({
          name: "審計品項A",
          categoryId: category.id,
          price: 100,
          isFeatured: true,
          isAvailable: false,
          isPopular: true,
          sortOrder: 7,
          inventoryCount: 3,
          // The dashboard always sends these as null when no image is set;
          // they used to fail validation outright (imageVariants) — also #78.
          imageUrl: null,
          imageId: null,
          imageVariants: null,
        }),
      }),
    );

    expect(createRes.status).toBe(201);
    const created = await readData<MenuItemRow>(createRes);
    expect(created).toMatchObject({
      isFeatured: true,
      isAvailable: false,
      isPopular: true,
      sortOrder: 7,
      inventoryCount: 3,
    });

    // Read back through the API (includeAll=true lets the admin see the
    // unavailable item) to prove the values came from the database, not just
    // the request echo.
    const getRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}?includeAll=true`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    expect(getRes.status).toBe(200);
    const menu = await readData<Menu>(getRes);
    const item = menu.menuItems.find((i) => i.id === created.id);
    expect(item).toMatchObject({
      isFeatured: true,
      isAvailable: false,
      isPopular: true,
      sortOrder: 7,
    });
  });

  /**
   * Regression coverage for #78.
   *
   * createMenuItemSchema was missing isAvailable / isFeatured / isPopular /
   * sortOrder / inventoryCount, and validateBody uses schema.parse(), which
   * silently strips undeclared keys rather than erroring. The API answered 201
   * while dropping exactly the fields the shop owner had just set — a "sold
   * out" item went on sale, "featured" never showed, and sortOrder was always 0.
   *
   * Every other test in this file seeds rows through seed.menuItem(), which
   * writes to D1 directly and never exercises the schema. These go through the
   * real POST/PUT routes so the strip is observable.
   */
  it("persists availability, featured and sortOrder sent to POST /items (#78)", async () => {
    const restaurant = await seed.restaurant();
    const now = new Date();
    const [category] = await testApp.testDb.drizzle
      .insert(categories)
      .values({
        restaurantId: String(restaurant.id),
        name: "審計分類",
        sortOrder: 0,
        isActive: true,
        isVisible: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await insertActiveSubscription(testApp, String(restaurant.id));
    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
        method: "POST",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({
          name: "審計品項A",
          categoryId: category.id,
          price: 100,
          isFeatured: true,
          isAvailable: false,
          sortOrder: 7,
        }),
      }),
    );

    expect(res.status).toBe(201);
    const json = await readData<MenuItemRow>(res);

    // The response must not claim defaults the caller did not ask for.
    expect(json).toMatchObject({
      isAvailable: false,
      isFeatured: true,
      sortOrder: 7,
    });

    // And the values must actually be in D1, not just echoed back.
    const stored = await testApp.testDb.drizzle
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, json.id));

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      isAvailable: false,
      isFeatured: true,
      sortOrder: 7,
    });
  });

  it("keeps DB defaults when the create request omits those fields (#78)", async () => {
    const restaurant = await seed.restaurant();
    const now = new Date();
    const [category] = await testApp.testDb.drizzle
      .insert(categories)
      .values({
        restaurantId: String(restaurant.id),
        name: "審計分類",
        sortOrder: 0,
        isActive: true,
        isVisible: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await insertActiveSubscription(testApp, String(restaurant.id));
    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
        method: "POST",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({
          name: "審計品項B",
          categoryId: category.id,
          price: 100,
        }),
      }),
    );

    expect(res.status).toBe(201);
    const json = await readData<MenuItemRow>(res);

    // Adding the fields to the schema must not move the defaults out of the DB
    // layer: an omitted field still lands on available / not featured / 0.
    expect(json).toMatchObject({
      isAvailable: true,
      isFeatured: false,
      sortOrder: 0,
    });
  });

  /**
   * Regression coverage for #107 — same root cause as #78.
   *
   * The admin item form and category form both have an English-name input, and
   * the item list filters search on it, but neither `menu_items` nor
   * `categories` had a `name_en` column and neither request schema declared the
   * key. Every save returned 2xx with the English name thrown away.
   *
   * These go through the real routes and then read the D1 row, so a schema that
   * strips the field or a missing column both fail here.
   */
  it("persists nameEn on menu item create and update (#107)", async () => {
    const restaurant = await seed.restaurant();
    const now = new Date();
    const [category] = await testApp.testDb.drizzle
      .insert(categories)
      .values({
        restaurantId: String(restaurant.id),
        name: "英文名分類",
        sortOrder: 0,
        isActive: true,
        isVisible: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await insertActiveSubscription(testApp, String(restaurant.id));
    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );

    const createRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
        method: "POST",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({
          name: "海南雞飯",
          nameEn: "Hainanese Chicken Rice",
          categoryId: category.id,
          price: 120,
        }),
      }),
    );

    expect(createRes.status).toBe(201);
    const created = await readData<MenuItemRow>(createRes);
    expect(created).toMatchObject({ nameEn: "Hainanese Chicken Rice" });

    const storedAfterCreate = await testApp.testDb.drizzle
      .select({ nameEn: menuItems.nameEn })
      .from(menuItems)
      .where(eq(menuItems.id, created.id));
    expect(storedAfterCreate).toEqual([{ nameEn: "Hainanese Chicken Rice" }]);

    // The admin GET path builds its items through mapToMenuItem, which had to
    // be extended too — persisting but not reading back would leave the form
    // blank on every reopen.
    const getRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}?includeAll=true`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );
    expect(getRes.status).toBe(200);
    const menu = await readData<Menu>(getRes);
    expect(menu.menuItems.find((i) => i.id === created.id)).toMatchObject({
      nameEn: "Hainanese Chicken Rice",
    });

    // updatedAt rides along because renaming is a form save, and those now
    // carry the optimistic-lock precondition (#85). It comes straight from the
    // create response, which is exactly what the dashboard has in hand.
    const updateRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/items/${created.id}`, {
        method: "PUT",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({
          nameEn: "Chicken Rice",
          updatedAt: created.updatedAt,
        }),
      }),
    );

    expect(updateRes.status).toBe(200);
    await expect(updateRes.json()).resolves.toMatchObject({
      data: { nameEn: "Chicken Rice" },
    });

    const storedAfterUpdate = await testApp.testDb.drizzle
      .select({ nameEn: menuItems.nameEn })
      .from(menuItems)
      .where(eq(menuItems.id, created.id));
    expect(storedAfterUpdate).toEqual([{ nameEn: "Chicken Rice" }]);
  });

  it("persists nameEn on category create and update (#107)", async () => {
    const restaurant = await seed.restaurant();
    await insertActiveSubscription(testApp, String(restaurant.id));
    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );

    const createRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/categories`, {
        method: "POST",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({ name: "主食", nameEn: "Main Dishes" }),
      }),
    );

    expect(createRes.status).toBe(201);
    const created = await readData<CategoryRow>(createRes);
    expect(created).toMatchObject({ nameEn: "Main Dishes" });

    // updateCategory's signature accepted nameEn while the column did not
    // exist, so this request used to reach Drizzle's update builder with a key
    // it could not resolve.
    const updateRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/categories/${created.id}`, {
        method: "PUT",
        headers: csrfHeaders(ownerToken),
        body: JSON.stringify({ nameEn: "Mains" }),
      }),
    );

    expect(updateRes.status).toBe(200);

    const stored = await testApp.testDb.drizzle
      .select({ nameEn: categories.nameEn })
      .from(categories)
      .where(eq(categories.id, created.id));
    expect(stored).toEqual([{ nameEn: "Mains" }]);

    // The menu read path projects category fields explicitly, so a missing
    // entry there would hide the value from the admin form.
    const getRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}?includeAll=true`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );
    expect(getRes.status).toBe(200);
    const menu = await readData<Menu>(getRes);
    expect(menu.categories.find((c) => c.id === created.id)).toMatchObject({
      nameEn: "Mains",
    });
  });

  /**
   * Regression coverage for #83.
   *
   * `includeAll=true` relaxed only the *item* filter. The category filter stayed
   * at isActive AND isVisible AND not-deleted, so hiding a category removed it
   * — and every item in it — from the owner's own dashboard, which reads exactly
   * this endpoint, with nothing in the UI able to put it back.
   *
   * The public half of the assertion is the important guardrail: relaxing the
   * admin read must not leak a hidden category to unauthenticated callers.
   */
  it("shows hidden categories to the owner and keeps them off the public menu (#83)", async () => {
    const restaurant = await seed.restaurant();
    const now = new Date();
    const [visibleCategory, hiddenCategory, inactiveCategory, deletedCategory] =
      await testApp.testDb.drizzle
        .insert(categories)
        .values([
          {
            restaurantId: String(restaurant.id),
            name: "常駐分類",
            sortOrder: 0,
            isActive: true,
            isVisible: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            restaurantId: String(restaurant.id),
            name: "季節限定",
            sortOrder: 1,
            isActive: true,
            isVisible: false,
            createdAt: now,
            updatedAt: now,
          },
          {
            restaurantId: String(restaurant.id),
            name: "已停用分類",
            sortOrder: 2,
            isActive: false,
            isVisible: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            restaurantId: String(restaurant.id),
            name: "已刪除分類",
            sortOrder: 3,
            isActive: true,
            isVisible: true,
            deletedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning();

    // Inserted directly rather than through seed.menuItem, which creates a
    // throwaway category of its own per call and would pollute the category
    // assertions below.
    await testApp.testDb.drizzle.insert(menuItems).values([
      {
        restaurantId: String(restaurant.id),
        categoryId: visibleCategory.id,
        name: "常駐品項",
        priceCents: 12000,
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        restaurantId: String(restaurant.id),
        categoryId: hiddenCategory.id,
        name: "隱藏分類品項",
        priceCents: 12000,
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        restaurantId: String(restaurant.id),
        categoryId: inactiveCategory.id,
        name: "停用分類品項",
        priceCents: 12000,
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        restaurantId: String(restaurant.id),
        categoryId: deletedCategory.id,
        name: "刪除分類品項",
        priceCents: 12000,
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );

    const adminRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}?includeAll=true`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );
    expect(adminRes.status).toBe(200);
    const adminMenu = await readData<Menu>(adminRes);

    // Hidden and inactive categories are present; only the soft-deleted one is
    // withheld, because "deleted" is not a state the editor resurrects.
    expect(adminMenu.categories.map((cat) => cat.name).sort()).toEqual(
      ["季節限定", "已停用分類", "常駐分類"].sort(),
    );
    expect(
      adminMenu.categories.find((cat) => cat.id === hiddenCategory.id),
    ).toMatchObject({ isVisible: false, isActive: true, itemCount: 1 });
    expect(
      adminMenu.categories.find((cat) => cat.id === inactiveCategory.id),
    ).toMatchObject({ isActive: false });

    // The items inside the hidden category came back too — they used to vanish
    // with their category.
    expect(adminMenu.menuItems.map((item) => item.name).sort()).toEqual(
      ["停用分類品項", "常駐品項", "隱藏分類品項"].sort(),
    );

    const publicRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}`),
    );
    expect(publicRes.status).toBe(200);
    const publicMenu = await readData<Menu>(publicRes);

    expect(publicMenu.categories.map((cat) => cat.name)).toEqual(["常駐分類"]);
    expect(publicMenu.menuItems.map((item) => item.name)).toEqual(["常駐品項"]);
  });

  /**
   * Regression coverage for #84.1.
   *
   * getMenuAnalytics() read the public menu, which is already filtered to
   * isAvailable, so `availableItems` was identically equal to `totalItems` and
   * an owner could never see how many items were paused. priceRange and the
   * distributions were silently scoped to on-sale items too.
   */
  it("counts paused items in analytics so availableItems differs from totalItems (#84)", async () => {
    const restaurant = await seed.restaurant();
    await insertActiveSubscription(testApp, String(restaurant.id));
    const now = new Date();
    const [category] = await testApp.testDb.drizzle
      .insert(categories)
      .values({
        restaurantId: String(restaurant.id),
        name: "分析分類",
        sortOrder: 0,
        isActive: true,
        isVisible: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await seed.menuItem(restaurant.id, {
      categoryId: category.id,
      name: "供應中",
      isAvailable: true,
      priceCents: 10000,
    });
    await seed.menuItem(restaurant.id, {
      categoryId: category.id,
      name: "已暫停",
      isAvailable: false,
      priceCents: 50000,
    });

    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );
    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/analytics`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await readData<MenuAnalytics>(res);
    expect(json).toMatchObject({
      totalItems: 2,
      availableItems: 1,
      priceRange: { min: 100, max: 500 },
    });
    expect(json.categoryDistribution).toEqual([
      expect.objectContaining({ categoryId: category.id, itemCount: 2 }),
    ]);
  });

  /**
   * Regression coverage for #84.1 (second half).
   *
   * getMenu() gates on isPublicRestaurantAvailable, which requires isActive, so
   * an owner whose restaurant was paused got 404 MENU_NOT_FOUND for their own
   * analytics. The public gate must stay intact — asserted here too.
   */
  it("serves owner analytics for an inactive restaurant while the public menu stays 404 (#84)", async () => {
    const restaurant = await seed.restaurant({
      name: "Paused Analytics Vendor",
      isActive: false,
    });
    await insertActiveSubscription(testApp, String(restaurant.id));
    await seed.menuItem(restaurant.id, {
      name: "暫停營業品項",
      isAvailable: true,
      priceCents: 20000,
    });

    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );

    const [analyticsRes, adminMenuRes, publicRes] = await Promise.all([
      testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${restaurant.id}/analytics`, {
          headers: { authorization: `Bearer ${ownerToken}` },
        }),
      ),
      testApp.app.fetch(
        new Request(
          `https://test/api/v1/menu/${restaurant.id}?includeAll=true`,
          { headers: { authorization: `Bearer ${ownerToken}` } },
        ),
      ),
      testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${restaurant.id}`),
      ),
    ]);

    expect(analyticsRes.status).toBe(200);
    await expect(analyticsRes.json()).resolves.toMatchObject({
      data: { totalItems: 1 },
    });
    expect(adminMenuRes.status).toBe(200);
    // The public path keeps its isActive gate — no data leak from relaxing the
    // admin path.
    expect(publicRes.status).toBe(404);
  });

  /**
   * The relaxed admin gate drops isActive but keeps not-deleted, so a restaurant
   * that is genuinely gone still 404s rather than serving analytics.
   *
   * A truly nonexistent id cannot be tested through this route:
   * shop_subscriptions.restaurant_id is a foreign key, so there is no way to
   * satisfy moduleGate for an id that has no restaurant row, and the request
   * would 403 at the gate before reaching the service. The unit test
   * "still returns null for privileged reads of a restaurant that does not
   * exist" covers that half.
   */
  it("still 404s owner analytics for a soft-deleted restaurant (#84)", async () => {
    const restaurant = await seed.restaurant({
      name: "Deleted Analytics Vendor",
      deletedAt: new Date(),
    });
    await insertActiveSubscription(testApp, String(restaurant.id));
    await seed.menuItem(restaurant.id, { isAvailable: true });
    const adminToken = await testApp.authHelper.adminToken(
      String(restaurant.id),
    );

    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/analytics`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );

    expect(res.status).toBe(404);
    expect(await readEnvelope(res)).toMatchObject({
      success: false,
      error: { code: "MENU_NOT_FOUND" },
    });
  });

  /**
   * Regression coverage for #84.2.
   *
   * menuItemSelectColumns never selected view_count/review_count and
   * transformMenuItem hardcoded both to 0, so incrementViewCount's writes were
   * invisible on every read path.
   */
  it("reads back a real view count instead of a hardcoded 0 (#84)", async () => {
    const restaurant = await seed.restaurant();
    const viewed = await seed.menuItem(restaurant.id, {
      name: "被瀏覽的品項",
      isAvailable: true,
      viewCount: 37,
      reviewCount: 4,
    });
    // A second item that is never fetched by id, so GET /items/:id's
    // fire-and-forget incrementViewCount cannot make the menu-read assertion
    // below racy.
    const untouched = await seed.menuItem(restaurant.id, {
      name: "未被瀏覽的品項",
      isAvailable: true,
      viewCount: 21,
      reviewCount: 3,
    });

    const detailRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/items/${viewed.id}`),
    );
    expect(detailRes.status).toBe(200);
    const detail = await readData<MenuItemRow>(detailRes);
    // The response is built before the waitUntil increment, so it carries the
    // stored value — which used to be reported as 0 regardless.
    expect(detail).toMatchObject({ viewCount: 37, reviewCount: 4 });

    // And the values arrive through the whole-menu read too, which uses a
    // different query and mapper.
    const menuRes = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}`),
    );
    const menu = await readData<Menu>(menuRes);
    expect(menu.menuItems.find((i) => i.id === untouched.id)).toMatchObject({
      viewCount: 21,
      reviewCount: 3,
    });
  });

  /**
   * Regression coverage for #84.3.
   *
   * The Top-N lists fetched `limit` rows through searchMenuItems (ordered by
   * isFeatured/orderCount/sortOrder) and re-sorted them in JS, so with more
   * than `limit` items the ranking came from the wrong candidate set. Here the
   * highest view counts sit on the rows the old ordering would have ranked last,
   * and `limit` is smaller than the number of items.
   */
  it("ranks popularity lists across the whole menu, not just the first page (#84)", async () => {
    const restaurant = await seed.restaurant();
    await insertActiveSubscription(testApp, String(restaurant.id));
    const now = new Date();
    const [category] = await testApp.testDb.drizzle
      .insert(categories)
      .values({
        restaurantId: String(restaurant.id),
        name: "排行分類",
        sortOrder: 0,
        isActive: true,
        isVisible: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // 12 items. The old ordering (isFeatured DESC, orderCount DESC) puts the
    // featured/high-orderCount rows first, but the top view counts and ratings
    // are deliberately on the *unfeatured, low-orderCount* rows.
    for (let index = 0; index < 12; index += 1) {
      await seed.menuItem(restaurant.id, {
        categoryId: category.id,
        name: `排行品項${String(index).padStart(2, "0")}`,
        isAvailable: true,
        isFeatured: index < 10,
        orderCount: 100 - index,
        viewCount: index,
        rating: index === 0 ? 0 : index / 2,
        reviewCount: index,
      });
    }

    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );
    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/menu/${restaurant.id}/popularity`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await readData<PopularityMetrics>(res);

    // Globally correct top 10 by view count: 11 down to 2.
    expect(json.mostViewed.map((item) => item.viewCount)).toEqual([
      11, 10, 9, 8, 7, 6, 5, 4, 3, 2,
    ]);

    // rating > 0 is filtered in SQL, so the list is a full 10 rows rather than
    // being trimmed after the slice. Item 00 (rating 0) is the only exclusion.
    expect(json.highestRated).toHaveLength(10);
    expect(json.highestRated[0].rating).toBe(5.5);
    expect(json.highestRated.every((item) => (item.rating ?? 0) > 0)).toBe(
      true,
    );

    expect(json.recentlyAdded).toHaveLength(10);
  });

  /**
   * Regression coverage for #84.4.
   *
   * The stored categories.item_count was only ever written by createMenuItem,
   * so moving an item to another category left both categories reporting stale
   * numbers. The column is gone; counts are derived live from menu_items, so
   * both sides must report the truth immediately after a move.
   */
  it("reports live category item counts after a cross-category move (#84)", async () => {
    const restaurant = await seed.restaurant();
    await insertActiveSubscription(testApp, String(restaurant.id));
    const now = new Date();
    const [source, destination] = await testApp.testDb.drizzle
      .insert(categories)
      .values([
        {
          restaurantId: String(restaurant.id),
          name: "來源分類",
          sortOrder: 0,
          isActive: true,
          isVisible: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          restaurantId: String(restaurant.id),
          name: "目標分類",
          sortOrder: 1,
          isActive: true,
          isVisible: true,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .returning();

    const moved = await seed.menuItem(restaurant.id, {
      categoryId: source.id,
      name: "會被搬走的品項",
      isAvailable: true,
    });
    await seed.menuItem(restaurant.id, {
      categoryId: source.id,
      name: "留在來源的品項",
      isAvailable: true,
    });

    const ownerToken = await testApp.authHelper.ownerToken(
      1,
      String(restaurant.id),
    );

    const readCounts = async () => {
      const res = await testApp.app.fetch(
        new Request(
          `https://test/api/v1/menu/${restaurant.id}?includeAll=true`,
          { headers: { authorization: `Bearer ${ownerToken}` } },
        ),
      );
      expect(res.status).toBe(200);
      const json = await readData<Menu>(res);
      return Object.fromEntries(
        json.categories.map((cat) => [cat.id, cat.itemCount]),
      ) as Record<number, number>;
    };

    expect(await readCounts()).toMatchObject({
      [source.id]: 2,
      [destination.id]: 0,
    });

    // Move through the real route so the menu cache is invalidated the same way
    // production does it. The old stored counter was never touched by this path.
    const moveRes = await testApp.app.fetch(
      new Request(
        `https://test/api/v1/menu/${restaurant.id}/items/categories`,
        {
          method: "PATCH",
          headers: csrfHeaders(ownerToken),
          body: JSON.stringify({
            updates: [{ id: moved.id, categoryId: destination.id }],
          }),
        },
      ),
    );
    expect(moveRes.status).toBe(200);

    expect(await readCounts()).toMatchObject({
      [source.id]: 1,
      [destination.id]: 1,
    });

    // And the stored column really is gone from the table.
    const columnRows = await testApp.env.DB.prepare(
      "SELECT name FROM pragma_table_info('categories')",
    ).all<{ name: string }>();
    expect((columnRows.results ?? []).map((row) => row.name)).not.toContain(
      "item_count",
    );
  });

  /**
   * Issue #85 — CSV import used to be a per-item POST loop in the browser.
   *
   * A batch that failed on row 7 left rows 1-6 committed, reported one generic
   * error, and duplicated everything on retry because the menu has no name
   * uniqueness. These go through the real route and then count rows in D1, so a
   * non-atomic implementation fails here.
   */
  describe("bulk item import is atomic (#85)", () => {
    async function setupOwner() {
      const restaurant = await seed.restaurant();
      const now = new Date();
      const [category] = await testApp.testDb.drizzle
        .insert(categories)
        .values({
          restaurantId: String(restaurant.id),
          name: "匯入分類",
          sortOrder: 0,
          isActive: true,
          isVisible: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await insertActiveSubscription(testApp, String(restaurant.id));
      const ownerToken = await testApp.authHelper.ownerToken(
        1,
        String(restaurant.id),
      );
      return { restaurant, category, ownerToken };
    }

    function importRequest(
      restaurantId: string,
      token: string,
      items: unknown[],
    ) {
      return new Request(
        `https://test/api/v1/menu/${restaurantId}/items/bulk`,
        {
          method: "POST",
          headers: csrfHeaders(token),
          body: JSON.stringify({ items }),
        },
      );
    }

    async function countItems(restaurantId: string) {
      const rows = await testApp.testDb.drizzle
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(eq(menuItems.restaurantId, restaurantId));
      return rows.length;
    }

    it("creates exactly N items for a valid batch of N", async () => {
      const { restaurant, category, ownerToken } = await setupOwner();
      const items = Array.from({ length: 5 }, (_, index) => ({
        name: `匯入品項 ${index}`,
        categoryId: category.id,
        price: 50 + index,
      }));

      const res = await testApp.app.fetch(
        importRequest(String(restaurant.id), ownerToken, items),
      );

      expect(res.status).toBe(201);
      const json = await readData<BulkCreatedItems>(res);
      expect(json.created).toBe(5);
      expect(json.items).toHaveLength(5);
      expect(await countItems(String(restaurant.id))).toBe(5);
    });

    it("writes zero rows and names the failing index when row 7 is invalid", async () => {
      const { restaurant, category, ownerToken } = await setupOwner();
      const items = Array.from({ length: 10 }, (_, index) => ({
        name: `匯入品項 ${index}`,
        categoryId: category.id,
        // Row 7 (index 6) carries a price the schema refuses.
        price: index === 6 ? -1 : 50,
      }));

      const res = await testApp.app.fetch(
        importRequest(String(restaurant.id), ownerToken, items),
      );

      expect(res.status).toBe(400);
      const json = await readError(res);
      expect(json.code).toBe("VALIDATION_ERROR");
      // The client has to be able to point at the row that stopped the import.
      expect(json.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "items.6.price" }),
        ]),
      );
      expect(await countItems(String(restaurant.id))).toBe(0);
    });

    it("rejects a row referencing another restaurant's category and writes nothing", async () => {
      const { restaurant, category, ownerToken } = await setupOwner();
      const otherRestaurant = await seed.restaurant({ name: "隔壁攤" });
      const now = new Date();
      const [foreignCategory] = await testApp.testDb.drizzle
        .insert(categories)
        .values({
          restaurantId: String(otherRestaurant.id),
          name: "別人的分類",
          sortOrder: 0,
          isActive: true,
          isVisible: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const res = await testApp.app.fetch(
        importRequest(String(restaurant.id), ownerToken, [
          { name: "自己的", categoryId: category.id, price: 50 },
          { name: "偷渡的", categoryId: foreignCategory.id, price: 60 },
        ]),
      );

      expect(res.status).toBe(403);
      const json = await readError(res);
      expect(json.code).toBe("CATEGORY_RESTAURANT_MISMATCH");
      expect(json.details).toEqual([
        expect.objectContaining({ index: 1, field: "categoryId" }),
      ]);
      // All-or-nothing: the legitimate first row must not have landed either.
      expect(await countItems(String(restaurant.id))).toBe(0);
    });

    it("rejects a batch over the 100-item cap", async () => {
      const { restaurant, category, ownerToken } = await setupOwner();
      const items = Array.from({ length: 101 }, (_, index) => ({
        name: `匯入品項 ${index}`,
        categoryId: category.id,
        price: 50,
      }));

      const res = await testApp.app.fetch(
        importRequest(String(restaurant.id), ownerToken, items),
      );

      expect(res.status).toBe(400);
      expect(await countItems(String(restaurant.id))).toBe(0);
    });

    it("is closed to a chef, like the single create it batches", async () => {
      const { restaurant, category } = await setupOwner();
      const chefToken = await testApp.authHelper.staffToken(
        2,
        2,
        String(restaurant.id),
      );

      const res = await testApp.app.fetch(
        importRequest(String(restaurant.id), chefToken, [
          { name: "廚師想新增", categoryId: category.id, price: 50 },
        ]),
      );

      expect(res.status).toBe(403);
      expect(await countItems(String(restaurant.id))).toBe(0);
    });
  });

  /**
   * Issue #85 — PUT /menu/items/:id had no version check while the admin form
   * saved every field it rendered.
   *
   * The wire format is what usually breaks this: the API serialises
   * menu_items.updated_at_ms (INTEGER ms, a Date in Drizzle) to epoch ms, and
   * the client echoes that number back. The schema also accepts ISO strings for
   * legacy clients and cached replays, so both branches stay covered here.
   */
  describe("concurrent edits are refused instead of overwritten (#85)", () => {
    async function setupItem() {
      const restaurant = await seed.restaurant();
      const now = new Date();
      const [category] = await testApp.testDb.drizzle
        .insert(categories)
        .values({
          restaurantId: String(restaurant.id),
          name: "併發分類",
          sortOrder: 0,
          isActive: true,
          isVisible: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await insertActiveSubscription(testApp, String(restaurant.id));
      const ownerToken = await testApp.authHelper.ownerToken(
        1,
        String(restaurant.id),
      );

      const createRes = await testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
          method: "POST",
          headers: csrfHeaders(ownerToken),
          body: JSON.stringify({
            name: "牛肉麵",
            categoryId: category.id,
            price: 180,
            isAvailable: true,
          }),
        }),
      );
      expect(createRes.status).toBe(201);
      const created = await readData<MenuItemRow>(createRes);
      return { restaurant, category, ownerToken, item: created };
    }

    function putItem(id: number, token: string, body: unknown) {
      return new Request(`https://test/api/v1/menu/items/${id}`, {
        method: "PUT",
        headers: csrfHeaders(token),
        body: JSON.stringify(body),
      });
    }

    async function readItem(id: number) {
      const [row] = await testApp.testDb.drizzle
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, id));
      return row;
    }

    it("accepts the version the client read and refuses it once stale", async () => {
      const { ownerToken, item } = await setupItem();

      // The exact epoch-ms value the API handed the client, echoed back
      // unchanged.
      const firstRes = await testApp.app.fetch(
        putItem(item.id, ownerToken, {
          name: "牛肉麵",
          price: 200,
          updatedAt: item.updatedAt,
        }),
      );
      expect(firstRes.status).toBe(200);
      const updated = await readData<MenuItemRow>(firstRes);
      expect(updated.price).toBe(200);
      // The write moved the version on, which is what makes the next attempt stale.
      expect(updated.updatedAt).not.toBe(item.updatedAt);

      const staleRes = await testApp.app.fetch(
        putItem(item.id, ownerToken, {
          name: "牛肉麵",
          price: 250,
          updatedAt: item.updatedAt,
        }),
      );

      expect(staleRes.status).toBe(409);
      const conflictJson = await readError(staleRes);
      expect(conflictJson.code).toBe("MENU_ITEM_MODIFIED");
      // Refused, not partially applied.
      expect((await readItem(item.id)).priceCents).toBe(20000);
    });

    it("blocks the sold-out scenario from the issue end to end", async () => {
      const { ownerToken, item } = await setupItem();
      const chefToken = await testApp.authHelper.staffToken(
        2,
        2,
        String(item.restaurantId),
      );

      // The owner opens 牛肉麵 to change its price; `item.updatedAt` is the
      // version their form holds. Meanwhile a chef marks it sold out — a
      // stock-only PUT, which needs no version of its own.
      const chefRes = await testApp.app.fetch(
        putItem(item.id, chefToken, { isAvailable: false }),
      );
      expect(chefRes.status).toBe(200);
      expect((await readItem(item.id)).isAvailable).toBe(false);

      // The owner now saves the whole form, which still says isAvailable: true.
      const ownerRes = await testApp.app.fetch(
        putItem(item.id, ownerToken, {
          name: "牛肉麵",
          price: 200,
          isAvailable: true,
          updatedAt: item.updatedAt,
        }),
      );

      expect(ownerRes.status).toBe(409);
      const stored = await readItem(item.id);
      // The sold-out item did not go back on sale, and the price did not change.
      expect(stored.isAvailable).toBe(false);
      expect(stored.priceCents).toBe(18000);
    });

    it("refuses a field-changing save that omits the version entirely", async () => {
      const { ownerToken, item } = await setupItem();

      const res = await testApp.app.fetch(
        putItem(item.id, ownerToken, { name: "牛肉麵", price: 300 }),
      );

      expect(res.status).toBe(400);
      const json = await readError(res);
      expect(json.code).toBe("VALIDATION_ERROR");
      expect((await readItem(item.id)).priceCents).toBe(18000);
    });

    it("accepts an ISO version as well as the epoch-ms one", async () => {
      const { ownerToken, item } = await setupItem();

      const res = await testApp.app.fetch(
        putItem(item.id, ownerToken, {
          price: 210,
          // item.updatedAt is epoch ms on the wire now. The ISO branch exists
          // for legacy clients and cached replays, so it has to be built
          // explicitly.
          updatedAt: new Date(item.updatedAt).toISOString(),
        }),
      );

      expect(res.status).toBe(200);
      expect((await readItem(item.id)).priceCents).toBe(21000);
    });
  });

  /**
   * Regression coverage for #80 — the issue's exact repro.
   *
   * Deleting an item used to write sortOrder: -1 while deleted_at_ms stayed
   * NULL. deleteCategory counted items through searchMenuItems, which knew
   * nothing of the convention, so a category whose items had all been deleted
   * answered 409 CATEGORY_HAS_MENU_ITEMS forever, while the dashboard showed
   * "itemCount: 2" over an empty list.
   */
  describe("soft delete via deleted_at_ms (#80)", () => {
    async function setupCategoryWithItems() {
      const restaurant = await seed.restaurant();
      const now = new Date();
      const [category] = await testApp.testDb.drizzle
        .insert(categories)
        .values({
          restaurantId: String(restaurant.id),
          name: "審計測試分類",
          sortOrder: 0,
          isActive: true,
          isVisible: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await insertActiveSubscription(testApp, String(restaurant.id));
      const ownerToken = await testApp.authHelper.ownerToken(
        1,
        String(restaurant.id),
      );

      const itemIds: number[] = [];
      for (const name of ["審計品項A", "審計品項B"]) {
        const res = await testApp.app.fetch(
          new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
            method: "POST",
            headers: csrfHeaders(ownerToken),
            body: JSON.stringify({ name, categoryId: category.id, price: 100 }),
          }),
        );
        expect(res.status).toBe(201);
        itemIds.push((await readData<MenuItemRow>(res)).id);
      }
      return { restaurant, category, ownerToken, itemIds };
    }

    function deleteRequest(path: string, token: string) {
      return new Request(`https://test/api/v1/menu/${path}`, {
        method: "DELETE",
        headers: csrfHeaders(token),
      });
    }

    it("lets the owner delete a category after deleting all of its items", async () => {
      const { restaurant, category, ownerToken, itemIds } =
        await setupCategoryWithItems();

      for (const id of itemIds) {
        const res = await testApp.app.fetch(
          deleteRequest(`items/${id}`, ownerToken),
        );
        expect(res.status).toBe(200);
      }

      // The delete wrote the real column, not the sortOrder convention.
      for (const id of itemIds) {
        const [row] = await testApp.testDb.drizzle
          .select({
            deletedAt: menuItems.deletedAt,
            sortOrder: menuItems.sortOrder,
          })
          .from(menuItems)
          .where(eq(menuItems.id, id));
        expect(row.deletedAt).toBeInstanceOf(Date);
        expect(row.sortOrder).not.toBe(-1);
      }

      // The admin read no longer shows the contradiction from the issue:
      // itemCount and the item list agree on "empty".
      const adminRes = await testApp.app.fetch(
        new Request(
          `https://test/api/v1/menu/${restaurant.id}?includeAll=true`,
          { headers: { authorization: `Bearer ${ownerToken}` } },
        ),
      );
      expect(adminRes.status).toBe(200);
      const adminMenu = await readData<Menu>(adminRes);
      const adminCategory = adminMenu.categories.find(
        (c) => c.id === category.id,
      );
      expect(adminCategory).toMatchObject({ itemCount: 0 });
      expect(adminMenu.menuItems.filter((i) => itemIds.includes(i.id))).toEqual(
        [],
      );

      // The headline: the emptied category can now actually be deleted.
      const deleteCategoryRes = await testApp.app.fetch(
        deleteRequest(`categories/${category.id}`, ownerToken),
      );
      expect(deleteCategoryRes.status).toBe(200);
    });

    it("still refuses to delete a category that has live items", async () => {
      const { category, ownerToken, itemIds } = await setupCategoryWithItems();

      // Delete only one of the two items — the other keeps the category busy.
      const res = await testApp.app.fetch(
        deleteRequest(`items/${itemIds[0]}`, ownerToken),
      );
      expect(res.status).toBe(200);

      const deleteCategoryRes = await testApp.app.fetch(
        deleteRequest(`categories/${category.id}`, ownerToken),
      );
      expect(deleteCategoryRes.status).toBe(409);
      const json = await readError(deleteCategoryRes);
      expect(json.code).toBe("CATEGORY_HAS_MENU_ITEMS");
    });

    it("keeps a deleted item out of updates and repeated deletes", async () => {
      const { ownerToken, itemIds } = await setupCategoryWithItems();
      const [id] = itemIds;

      const firstDelete = await testApp.app.fetch(
        deleteRequest(`items/${id}`, ownerToken),
      );
      expect(firstDelete.status).toBe(200);

      // A deleted item reads as gone — an update cannot resurrect it, and a
      // second delete is a 404 rather than a timestamp rewrite.
      const updateRes = await testApp.app.fetch(
        new Request(`https://test/api/v1/menu/items/${id}`, {
          method: "PUT",
          headers: csrfHeaders(ownerToken),
          body: JSON.stringify({ isAvailable: true }),
        }),
      );
      expect(updateRes.status).toBe(404);

      const secondDelete = await testApp.app.fetch(
        deleteRequest(`items/${id}`, ownerToken),
      );
      expect(secondDelete.status).toBe(404);
    });
  });

  /**
   * Category deletion had the same shape of defect the item soft delete did,
   * one level up.
   *
   * deleteCategory marked removal with isActive:false, but the owner's menu
   * read filters categories on deleted_at_ms alone (adminCategoryConditions,
   * introduced with #83). The delete wrote one column and the read looked at
   * another, so a deleted category returned on the next fetch wearing the
   * "hidden" badge — indistinguishable from one the owner had merely hidden,
   * and unremovable because every repeat delete answered 200 and changed
   * nothing.
   *
   * The emptiness guard had a second, independent hole: it counted items via
   * searchMenuItems, whose WHERE carries publicCategoryConditions. Those are
   * conditions on the CATEGORY, so a category with isVisible:false counted
   * zero items however many it held.
   */
  describe("category deletion agrees with the menu read (#80/#83)", () => {
    async function seedCategory(overrides: { isVisible?: boolean } = {}) {
      const restaurant = await seed.restaurant();
      const now = new Date();
      const [category] = await testApp.testDb.drizzle
        .insert(categories)
        .values({
          restaurantId: String(restaurant.id),
          name: "要被刪掉的分類",
          sortOrder: 0,
          isActive: true,
          isVisible: overrides.isVisible ?? true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await insertActiveSubscription(testApp, String(restaurant.id));
      const ownerToken = await testApp.authHelper.ownerToken(
        1,
        String(restaurant.id),
      );
      return { restaurant, category, ownerToken };
    }

    function deleteCategoryRequest(categoryId: number, token: string) {
      return new Request(`https://test/api/v1/menu/categories/${categoryId}`, {
        method: "DELETE",
        headers: csrfHeaders(token),
      });
    }

    async function adminCategories(restaurantId: string, token: string) {
      const res = await testApp.app.fetch(
        new Request(
          `https://test/api/v1/menu/${restaurantId}?includeAll=true`,
          {
            headers: { authorization: `Bearer ${token}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = await readData<Menu>(res);
      return body.categories as Array<{ id: number; name: string }>;
    }

    it("removes a deleted category from the owner's own dashboard", async () => {
      const { restaurant, category, ownerToken } = await seedCategory();

      expect(
        (await adminCategories(String(restaurant.id), ownerToken)).map(
          (c) => c.id,
        ),
      ).toContain(category.id);

      const res = await testApp.app.fetch(
        deleteCategoryRequest(category.id, ownerToken),
      );
      expect(res.status).toBe(200);

      // The delete wrote the column the read filters on, not just isActive.
      const [row] = await testApp.testDb.drizzle
        .select({
          deletedAt: categories.deletedAt,
          isActive: categories.isActive,
        })
        .from(categories)
        .where(eq(categories.id, category.id));
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(row.isActive).toBe(false);

      expect(
        (await adminCategories(String(restaurant.id), ownerToken)).map(
          (c) => c.id,
        ),
      ).not.toContain(category.id);
    });

    it("answers 404 for a second delete instead of succeeding again", async () => {
      const { category, ownerToken } = await seedCategory();

      const first = await testApp.app.fetch(
        deleteCategoryRequest(category.id, ownerToken),
      );
      expect(first.status).toBe(200);

      const second = await testApp.app.fetch(
        deleteCategoryRequest(category.id, ownerToken),
      );
      expect(second.status).toBe(404);
    });

    it("refuses to edit a deleted category", async () => {
      const { category, ownerToken } = await seedCategory();

      const del = await testApp.app.fetch(
        deleteCategoryRequest(category.id, ownerToken),
      );
      expect(del.status).toBe(200);

      const res = await testApp.app.fetch(
        new Request(`https://test/api/v1/menu/categories/${category.id}`, {
          method: "PUT",
          headers: csrfHeaders(ownerToken),
          body: JSON.stringify({ name: "復活的分類" }),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("still refuses to delete a HIDDEN category holding a live item", async () => {
      const { restaurant, category, ownerToken } = await seedCategory({
        isVisible: false,
      });

      const create = await testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
          method: "POST",
          headers: csrfHeaders(ownerToken),
          body: JSON.stringify({
            name: "活著的品項",
            categoryId: category.id,
            price: 100,
          }),
        }),
      );
      expect(create.status).toBe(201);

      const res = await testApp.app.fetch(
        deleteCategoryRequest(category.id, ownerToken),
      );
      expect(res.status).toBe(409);
      expect((await readError(res)).code).toBe("CATEGORY_HAS_MENU_ITEMS");
    });

    it("blocks the delete for a paused item too, not just an on-sale one", async () => {
      const { restaurant, category, ownerToken } = await seedCategory();

      const create = await testApp.app.fetch(
        new Request(`https://test/api/v1/menu/${restaurant.id}/items`, {
          method: "POST",
          headers: csrfHeaders(ownerToken),
          body: JSON.stringify({
            name: "暫停供應的品項",
            categoryId: category.id,
            price: 100,
            isAvailable: false,
          }),
        }),
      );
      expect(create.status).toBe(201);

      const res = await testApp.app.fetch(
        deleteCategoryRequest(category.id, ownerToken),
      );
      expect(res.status).toBe(409);
    });

    it("lets a hidden but empty category be deleted", async () => {
      const { category, ownerToken } = await seedCategory({ isVisible: false });

      const res = await testApp.app.fetch(
        deleteCategoryRequest(category.id, ownerToken),
      );
      expect(res.status).toBe(200);
    });
  });
});
