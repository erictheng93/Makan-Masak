import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import type { ModuleKey } from "@makanmasak/database";

const auth = vi.hoisted(() => ({
  user: undefined as undefined | AuthUser,
}));

vi.mock("../../../shared/middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../shared/middleware")>();

  return {
    ...actual,
    optionalAuth: vi.fn(async (c, next) => {
      if (auth.user) c.set("user", auth.user);
      await next();
    }),
    authMiddleware: vi.fn(async (c, next) => {
      c.set(
        "user",
        auth.user ?? {
          id: "user-7",
          username: "admin",
          role: 0,
          restaurantId: "rest-1",
        },
      );
      await next();
    }),
    // The real role guard, not a stub: the role table on these routes is the
    // thing under test (#85), so a pass-through mock would assert nothing.
    requireRole: vi.fn(actual.requireRole),
    requireRestaurantAccess: vi.fn(actual.requireRestaurantAccess),
  };
});

const gateMocks = vi.hoisted(() => ({
  moduleGate: vi.fn(
    (_module: ModuleKey) => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  ),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: gateMocks.moduleGate,
}));

const backfillMenuItemOptions = vi.hoisted(() => vi.fn());

vi.mock("@makanmasak/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@makanmasak/database")>();
  return { ...actual, backfillMenuItemOptions };
});

const serviceFns = vi.hoisted(() => ({
  getMenu: vi.fn(),
  isPublicRestaurantAvailable: vi.fn(),
  getFeaturedItems: vi.fn(),
  getPopularItems: vi.fn(),
  searchMenuItems: vi.fn(),
  getMenuItem: vi.fn(),
  incrementViewCount: vi.fn(),
  createMenuItem: vi.fn(),
  bulkCreateMenuItems: vi.fn(),
  updateMenuItem: vi.fn(),
  deleteMenuItem: vi.fn(),
  batchUpdateAvailability: vi.fn(),
  batchUpdatePrices: vi.fn(),
  batchMoveItems: vi.fn(),
  createCategory: vi.fn(),
  getCategoryById: vi.fn(),
  updateCategory: vi.fn(),
  reorderCategories: vi.fn(),
  deleteCategory: vi.fn(),
  getMenuAnalytics: vi.fn(),
  getPopularityMetrics: vi.fn(),
  listOptionGroups: vi.fn(),
  getOptionGroup: vi.fn(),
  createOptionGroup: vi.fn(),
  updateOptionGroup: vi.fn(),
  deleteOptionGroup: vi.fn(),
  getOptionChoice: vi.fn(),
  createOptionChoice: vi.fn(),
  updateOptionChoice: vi.fn(),
  deleteOptionChoice: vi.fn(),
  listMenuItemOptionGroups: vi.fn(),
  replaceMenuItemOptionGroups: vi.fn(),
}));

vi.mock("../services/MenuService", () => ({
  MenuService: class {
    getMenu = serviceFns.getMenu;
    isPublicRestaurantAvailable = serviceFns.isPublicRestaurantAvailable;
    getFeaturedItems = serviceFns.getFeaturedItems;
    getPopularItems = serviceFns.getPopularItems;
    searchMenuItems = serviceFns.searchMenuItems;
    getMenuItem = serviceFns.getMenuItem;
    incrementViewCount = serviceFns.incrementViewCount;
    createMenuItem = serviceFns.createMenuItem;
    bulkCreateMenuItems = serviceFns.bulkCreateMenuItems;
    updateMenuItem = serviceFns.updateMenuItem;
    deleteMenuItem = serviceFns.deleteMenuItem;
    batchUpdateAvailability = serviceFns.batchUpdateAvailability;
    batchUpdatePrices = serviceFns.batchUpdatePrices;
    batchMoveItems = serviceFns.batchMoveItems;
    createCategory = serviceFns.createCategory;
    getCategoryById = serviceFns.getCategoryById;
    updateCategory = serviceFns.updateCategory;
    reorderCategories = serviceFns.reorderCategories;
    deleteCategory = serviceFns.deleteCategory;
    getMenuAnalytics = serviceFns.getMenuAnalytics;
    getPopularityMetrics = serviceFns.getPopularityMetrics;
    listOptionGroups = serviceFns.listOptionGroups;
    getOptionGroup = serviceFns.getOptionGroup;
    createOptionGroup = serviceFns.createOptionGroup;
    updateOptionGroup = serviceFns.updateOptionGroup;
    deleteOptionGroup = serviceFns.deleteOptionGroup;
    getOptionChoice = serviceFns.getOptionChoice;
    createOptionChoice = serviceFns.createOptionChoice;
    updateOptionChoice = serviceFns.updateOptionChoice;
    deleteOptionChoice = serviceFns.deleteOptionChoice;
    listMenuItemOptionGroups = serviceFns.listMenuItemOptionGroups;
    replaceMenuItemOptionGroups = serviceFns.replaceMenuItemOptionGroups;
  },
}));

const syncFns = vi.hoisted(() => ({
  onMenuItemChanged: vi.fn(),
  onCategoryChanged: vi.fn(),
}));

vi.mock("../../discovery/services/SearchIndexSyncService", () => ({
  createSearchIndexSync: vi.fn(() => syncFns),
}));

import routes from "./index";
import { ApiError } from "../../../shared/utils/api-error";

// moduleGate(...) is called once per route at registration (module import
// time), not per-request — capture the keys now, before any
// vi.clearAllMocks() in beforeEach wipes the call history.
const moduleGateRegistrationKeys = gateMocks.moduleGate.mock.calls.map(
  (call) => call[0],
);

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function createEnv() {
  return {
    DB: {},
    CACHE_KV: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
}

/**
 * Promises the handler handed to `executionCtx.waitUntil` during the most
 * recent `request(...)`. The runtime keeps the invocation alive for these
 * after the response is sent; if one of them rejects, the Workers runtime
 * reports the whole invocation as `outcome: "exception"` even though the
 * client already has its 200 (#325).
 */
let waitUntilPromises: Promise<unknown>[] = [];

function request(path: string, method = "GET", body?: unknown) {
  waitUntilPromises = [];
  return routes.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
    },
    createEnv() as never,
    {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      }),
      passThroughOnException: vi.fn(),
    } as never,
  );
}

const menu = {
  categories: [{ id: 3, name: "Noodles" }],
  menuItems: [{ id: 11, name: "Laksa", restaurantId: "rest-1" }],
};

const item = {
  id: 11,
  restaurantId: "rest-1",
  categoryId: 3,
  name: "Laksa",
  price: 180,
  updatedAt: "2026-07-30T08:15:30.250Z",
};

/**
 * The optimistic-lock precondition every field-changing PUT now has to carry
 * (#85) — the `updatedAt` the client last read, in the ISO form the API emits.
 */
const ITEM_VERSION = item.updatedAt;

const category = {
  id: 3,
  restaurantId: "rest-1",
  name: "Noodles",
};

const optionGroup = {
  id: "group-1",
  restaurantId: "rest-1",
  publicId: "spice",
  kind: "choice",
  name: "Spice",
  type: "single",
  required: true,
  maxSelections: 1,
  sortOrder: 0,
  choices: [],
};

const optionChoice = {
  id: "choice-1",
  groupId: "group-1",
  restaurantId: "rest-1",
  publicId: "hot",
  name: "Hot",
  priceAdjustment: 1.5,
  isDefault: false,
  isAvailable: true,
  maxQuantity: null,
  sortOrder: 0,
};

const ROLE = { ADMIN: 0, OWNER: 1, CHEF: 2 } as const;

function buildUser(
  role: number,
  overrides: Record<string, unknown> = {},
): AuthUser {
  return {
    id: "user-9",
    username: "owner",
    role,
    restaurantId: "rest-1",
    ...overrides,
  };
}

function itemBody(overrides: Record<string, unknown> = {}) {
  return {
    categoryId: 3,
    name: "Laksa",
    price: 180,
    description: "Curry noodles",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = undefined;

  serviceFns.getMenu.mockResolvedValue(menu);
  serviceFns.isPublicRestaurantAvailable.mockResolvedValue(true);
  serviceFns.getFeaturedItems.mockResolvedValue([item]);
  serviceFns.getPopularItems.mockResolvedValue([item]);
  serviceFns.searchMenuItems.mockResolvedValue({
    items: [item],
    pagination: { page: 2, limit: 5, total: 1 },
  });
  serviceFns.getMenuItem.mockResolvedValue(item);
  serviceFns.incrementViewCount.mockResolvedValue(undefined);
  serviceFns.createMenuItem.mockResolvedValue(item);
  serviceFns.bulkCreateMenuItems.mockResolvedValue([item]);
  serviceFns.updateMenuItem.mockResolvedValue({ ...item, name: "Updated" });
  serviceFns.deleteMenuItem.mockResolvedValue(true);
  serviceFns.batchUpdateAvailability.mockResolvedValue(undefined);
  serviceFns.batchUpdatePrices.mockResolvedValue(undefined);
  serviceFns.batchMoveItems.mockResolvedValue(undefined);
  serviceFns.createCategory.mockResolvedValue(category);
  serviceFns.getCategoryById.mockResolvedValue(category);
  serviceFns.updateCategory.mockResolvedValue({
    ...category,
    name: "Updated",
  });
  serviceFns.reorderCategories.mockResolvedValue(undefined);
  serviceFns.deleteCategory.mockResolvedValue(true);
  serviceFns.getMenuAnalytics.mockResolvedValue({ totalItems: 1 });
  serviceFns.getPopularityMetrics.mockResolvedValue({ mostOrdered: [item] });
  serviceFns.listOptionGroups.mockResolvedValue([optionGroup]);
  serviceFns.getOptionGroup.mockResolvedValue(optionGroup);
  serviceFns.createOptionGroup.mockResolvedValue(optionGroup);
  serviceFns.updateOptionGroup.mockResolvedValue(optionGroup);
  serviceFns.deleteOptionGroup.mockResolvedValue(true);
  serviceFns.getOptionChoice.mockResolvedValue(optionChoice);
  serviceFns.createOptionChoice.mockResolvedValue(optionChoice);
  serviceFns.updateOptionChoice.mockResolvedValue(optionChoice);
  serviceFns.deleteOptionChoice.mockResolvedValue(true);
  serviceFns.listMenuItemOptionGroups.mockResolvedValue({ groups: [] });
  serviceFns.replaceMenuItemOptionGroups.mockResolvedValue(undefined);
  syncFns.onMenuItemChanged.mockResolvedValue(undefined);
  syncFns.onCategoryChanged.mockResolvedValue(undefined);
});

describe("menu routes", () => {
  it("returns public menus and lets admins include unavailable items", async () => {
    let response = await request("/rest-1");

    expect(response.status).toBe(200);
    expect(serviceFns.getMenu).toHaveBeenCalledWith("rest-1", {
      includeUnavailable: false,
    });

    auth.user = { id: "user-1", username: "admin", role: 0 };
    response = await request("/rest-1?includeAll=true");

    expect(response.status).toBe(200);
    expect(serviceFns.getMenu).toHaveBeenLastCalledWith("rest-1", {
      includeUnavailable: true,
    });

    serviceFns.getMenu.mockResolvedValueOnce(null);
    response = await request("/missing");

    expect(response.status).toBe(404);
  });

  it("scopes includeAll to the owner's own restaurant", async () => {
    // An owner of rest-2 must not see rest-1's unavailable items.
    auth.user = {
      id: "user-2",
      username: "owner",
      role: 1,
      restaurantId: "rest-2",
    };
    let response = await request("/rest-1?includeAll=true");

    expect(response.status).toBe(200);
    expect(serviceFns.getMenu).toHaveBeenLastCalledWith("rest-1", {
      includeUnavailable: false,
    });

    // An owner with no restaurant on their token is not privileged anywhere.
    auth.user = { id: "user-3", username: "owner", role: 1 };
    response = await request("/rest-1?includeAll=true");

    expect(response.status).toBe(200);
    expect(serviceFns.getMenu).toHaveBeenLastCalledWith("rest-1", {
      includeUnavailable: false,
    });

    // Their own restaurant still works.
    auth.user = {
      id: "user-2",
      username: "owner",
      role: 1,
      restaurantId: "rest-2",
    };
    response = await request("/rest-2?includeAll=true");

    expect(response.status).toBe(200);
    expect(serviceFns.getMenu).toHaveBeenLastCalledWith("rest-2", {
      includeUnavailable: true,
    });
  });

  it("serves featured, popular, search, and item detail public endpoints", async () => {
    let response = await request("/rest-1/featured?limit=4");

    expect(response.status).toBe(200);
    expect(serviceFns.isPublicRestaurantAvailable).toHaveBeenCalledWith(
      "rest-1",
    );
    expect(serviceFns.getFeaturedItems).toHaveBeenCalledWith("rest-1", 4);

    response = await request("/rest-1/popular?limit=3");
    expect(response.status).toBe(200);
    expect(serviceFns.getPopularItems).toHaveBeenCalledWith("rest-1", 3);

    response = await request(
      "/rest-1/search?categoryId=3&minPrice=100&maxPrice=300&spiceLevel=2&dietaryPreferences=halal, vegan&isFeatured=true&search=laksa&page=2&limit=5",
    );
    expect(response.status).toBe(200);
    expect(serviceFns.searchMenuItems).toHaveBeenCalledWith("rest-1", {
      categoryId: 3,
      priceRange: [100, 300],
      spiceLevel: 2,
      dietaryPreferences: ["halal", "vegan"],
      isAvailable: true,
      isFeatured: true,
      search: "laksa",
      page: 2,
      limit: 5,
    });

    response = await request("/items/11");
    expect(response.status).toBe(200);
    expect(serviceFns.incrementViewCount).toHaveBeenCalledWith(11);

    serviceFns.isPublicRestaurantAvailable.mockResolvedValueOnce(false);
    response = await request("/rest-1/featured");
    expect(response.status).toBe(404);

    serviceFns.getMenuItem.mockResolvedValueOnce(null);
    response = await request("/items/404");
    expect(response.status).toBe(404);
  });

  // #325 investigated intermittent ERR_CONNECTION_CLOSED and asked whether an
  // uncaught Worker exception was recycling the isolate. This route was the one
  // place in apps/api that handed an unguarded promise to waitUntil:
  // MenuService.incrementViewCount logs and then *rethrows*, so a transient D1
  // write failure on a public menu read became an unhandled rejection and the
  // invocation was reported `exception` after a 200 had already gone out.
  // Every other waitUntil in the repo already swallows its own errors.
  it("keeps a failing view-count write from rejecting the waitUntil promise", async () => {
    serviceFns.incrementViewCount.mockRejectedValueOnce(
      new Error("D1_ERROR: database is locked"),
    );

    const response = await request("/items/11");

    // The client is unaffected: the count is bookkeeping, not part of the read.
    expect(response.status).toBe(200);
    expect(serviceFns.incrementViewCount).toHaveBeenCalledWith(11);

    // And the background work the runtime is still holding must settle rather
    // than reject. Awaiting it here is the assertion.
    expect(waitUntilPromises).toHaveLength(1);
    await expect(waitUntilPromises[0]).resolves.toBeUndefined();
  });

  it("creates, updates, and deletes menu items with search sync", async () => {
    let response = await request("/rest-1/items", "POST", itemBody());

    expect(response.status).toBe(201);
    expect(serviceFns.createMenuItem).toHaveBeenCalledWith({
      categoryId: 3,
      name: "Laksa",
      price: 180,
      description: "Curry noodles",
      spiceLevel: 0,
      preparationTime: 15,
      restaurantId: "rest-1",
    });
    expect(syncFns.onMenuItemChanged).toHaveBeenCalledWith(11);

    response = await request("/items/11", "PUT", {
      name: "Updated",
      isFeatured: true,
      updatedAt: ITEM_VERSION,
    });
    expect(response.status).toBe(200);
    expect(serviceFns.updateMenuItem).toHaveBeenCalledWith(
      11,
      // The route hands the precondition to the service as epoch ms; the
      // service is what compares and strips it.
      expect.objectContaining({
        name: "Updated",
        isFeatured: true,
        updatedAt: Date.parse(ITEM_VERSION),
      }),
      item,
    );

    response = await request("/items/11", "DELETE");
    expect(response.status).toBe(200);
    expect(serviceFns.deleteMenuItem).toHaveBeenCalledWith(11, item);
  });

  it("blocks menu item mutation when item access fails", async () => {
    auth.user = {
      id: "user-8",
      username: "owner",
      role: 1,
      restaurantId: "other",
    };

    let response = await request("/items/11", "PUT", {
      name: "Updated",
      updatedAt: ITEM_VERSION,
    });

    expect(response.status).toBe(403);
    expect(serviceFns.updateMenuItem).not.toHaveBeenCalled();

    serviceFns.getMenuItem.mockResolvedValueOnce(null);
    auth.user = { id: "user-1", username: "admin", role: 0 };
    response = await request("/items/11", "DELETE");

    expect(response.status).toBe(404);

    serviceFns.getMenuItem.mockResolvedValueOnce(item);
    serviceFns.deleteMenuItem.mockResolvedValueOnce(false);
    response = await request("/items/11", "DELETE");

    expect(response.status).toBe(404);
  });

  it("runs bulk menu item management workflows", async () => {
    let response = await request("/rest-1/items/availability", "PATCH", {
      updates: [{ id: 11, isAvailable: false }],
    });

    expect(response.status).toBe(200);
    expect(serviceFns.batchUpdateAvailability).toHaveBeenCalledWith("rest-1", [
      { id: 11, isAvailable: false },
    ]);
    expect(syncFns.onMenuItemChanged).toHaveBeenCalledWith(11);

    response = await request("/rest-1/items/prices", "PATCH", {
      updates: [{ id: 11, price: 190, originalPrice: 220 }],
    });
    expect(response.status).toBe(200);
    expect(serviceFns.batchUpdatePrices).toHaveBeenCalledWith("rest-1", [
      { id: 11, price: 190, originalPrice: 220 },
    ]);

    response = await request("/rest-1/items/categories", "PATCH", {
      updates: [{ id: 11, categoryId: 4 }],
    });
    expect(response.status).toBe(200);
    expect(serviceFns.batchMoveItems).toHaveBeenCalledWith("rest-1", [
      { id: 11, categoryId: 4 },
    ]);
  });

  describe("option group management", () => {
    it("lists, creates, updates, and deletes option groups", async () => {
      auth.user = buildUser(ROLE.OWNER);

      let response = await request("/rest-1/option-groups");
      expect(response.status).toBe(200);
      expect(serviceFns.listOptionGroups).toHaveBeenCalledWith("rest-1");

      response = await request("/rest-1/option-groups", "POST", {
        publicId: "spice",
        kind: "choice",
        name: "Spice",
        type: "single",
        required: true,
        maxSelections: 1,
        sortOrder: 2,
      });
      expect(response.status).toBe(201);
      expect(serviceFns.createOptionGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: "rest-1",
          publicId: "spice",
          kind: "choice",
          name: "Spice",
          type: "single",
          required: true,
          maxSelections: 1,
          sortOrder: 2,
        }),
      );

      response = await request("/option-groups/group-1", "PUT", {
        name: "Heat",
        maxSelections: null,
      });
      expect(response.status).toBe(200);
      expect(serviceFns.updateOptionGroup).toHaveBeenCalledWith("group-1", {
        name: "Heat",
        maxSelections: null,
      });

      response = await request("/option-groups/group-1", "DELETE");
      expect(response.status).toBe(200);
      expect(serviceFns.deleteOptionGroup).toHaveBeenCalledWith("group-1");
    });

    it("manages choices and converts priceAdjustment yuan to cents", async () => {
      auth.user = buildUser(ROLE.OWNER);

      let response = await request("/option-groups/group-1/choices", "POST", {
        publicId: "hot",
        name: "Hot",
        priceAdjustment: 1.5,
        isAvailable: false,
        maxQuantity: 2,
      });
      expect(response.status).toBe(201);
      expect(serviceFns.createOptionChoice).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: "group-1",
          publicId: "hot",
          priceAdjustmentCents: 150,
          isAvailable: false,
          maxQuantity: 2,
        }),
      );

      response = await request("/option-choices/choice-1", "PATCH", {
        priceAdjustment: 2.25,
        isAvailable: false,
        maxQuantity: null,
      });
      expect(response.status).toBe(200);
      expect(serviceFns.updateOptionChoice).toHaveBeenCalledWith("choice-1", {
        priceAdjustmentCents: 225,
        isAvailable: false,
        maxQuantity: null,
      });

      response = await request("/option-choices/choice-1", "DELETE");
      expect(response.status).toBe(200);
      expect(serviceFns.deleteOptionChoice).toHaveBeenCalledWith("choice-1");
    });

    it("maps duplicate option choice publicId conflicts to 409", async () => {
      auth.user = buildUser(ROLE.OWNER);
      serviceFns.createOptionChoice.mockRejectedValueOnce(
        new Error("Option choice public id already exists in group"),
      );

      const response = await request("/option-groups/group-1/choices", "POST", {
        publicId: "hot",
        name: "Hot",
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({
          code: "OPTION_CHOICE_PUBLIC_ID_CONFLICT",
        }),
      });
    });

    it("replaces an item's option groups and maps override prices to cents", async () => {
      auth.user = buildUser(ROLE.OWNER);

      let response = await request("/items/11/option-groups");
      expect(response.status).toBe(200);
      expect(serviceFns.listMenuItemOptionGroups).toHaveBeenCalledWith(11);

      response = await request("/items/11/option-groups", "PUT", {
        groups: [
          {
            groupId: "group-1",
            sortOrder: 3,
            requiredOverride: false,
            maxSelectionsOverride: 2,
            choiceOverrides: [
              {
                choiceId: "choice-1",
                isHidden: true,
                priceAdjustment: 1.5,
              },
            ],
          },
        ],
      });

      expect(response.status).toBe(200);
      expect(serviceFns.replaceMenuItemOptionGroups).toHaveBeenCalledWith(11, [
        {
          groupId: "group-1",
          sortOrder: 3,
          requiredOverride: false,
          maxSelectionsOverride: 2,
          choiceOverrides: [
            {
              choiceId: "choice-1",
              isHidden: true,
              priceAdjustmentCents: 150,
            },
          ],
        },
      ]);
    });

    it("maps duplicate publicId link conflicts to 409", async () => {
      serviceFns.replaceMenuItemOptionGroups.mockRejectedValueOnce(
        new Error(
          "Menu item 11 already offers an option group with public id spice",
        ),
      );

      const response = await request("/items/11/option-groups", "PUT", {
        groups: [{ groupId: "group-1" }, { groupId: "group-2" }],
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({
          code: "OPTION_GROUP_PUBLIC_ID_CONFLICT",
        }),
      });
    });

    it("rejects publicId on option group update", async () => {
      const response = await request("/option-groups/group-1", "PUT", {
        publicId: "new-spice",
      });

      expect(response.status).toBe(400);
      expect(serviceFns.updateOptionGroup).not.toHaveBeenCalled();
    });

    it("rejects duplicate group ids before replacing item option groups", async () => {
      const response = await request("/items/11/option-groups", "PUT", {
        groups: [{ groupId: "group-1" }, { groupId: "group-1" }],
      });

      expect(response.status).toBe(400);
      expect(serviceFns.replaceMenuItemOptionGroups).not.toHaveBeenCalled();
    });

    it("returns 404 for missing option group or choice resources", async () => {
      serviceFns.getOptionGroup.mockResolvedValueOnce(null);
      let response = await request("/option-groups/missing", "PUT", {
        name: "Heat",
      });
      expect(response.status).toBe(404);

      serviceFns.getOptionChoice.mockResolvedValueOnce(null);
      response = await request("/option-choices/missing", "PATCH", {
        isAvailable: false,
      });
      expect(response.status).toBe(404);
    });

    it("returns 403 when an owner touches another restaurant's option resources", async () => {
      auth.user = buildUser(ROLE.OWNER, { restaurantId: "other" });

      const cases: Array<[string, string, unknown | undefined]> = [
        ["/rest-1/option-groups", "GET", undefined],
        [
          "/rest-1/option-groups",
          "POST",
          {
            publicId: "spice",
            kind: "choice",
            name: "Spice",
            type: "single",
          },
        ],
        ["/option-groups/group-1", "PUT", { name: "Heat" }],
        ["/option-groups/group-1", "DELETE", undefined],
        [
          "/option-groups/group-1/choices",
          "POST",
          { publicId: "hot", name: "Hot", priceAdjustment: 1 },
        ],
        ["/option-choices/choice-1", "PATCH", { isAvailable: false }],
        ["/option-choices/choice-1", "DELETE", undefined],
        ["/items/11/option-groups", "GET", undefined],
        [
          "/items/11/option-groups",
          "PUT",
          { groups: [{ groupId: "group-1" }] },
        ],
        // Platform maintenance: an owner may not walk every restaurant.
        ["/option-groups/backfill", "POST", {}],
      ];

      for (const [path, method, body] of cases) {
        const response = await request(path, method, body);
        expect(response.status, `${method} ${path}`).toBe(403);
      }
    });
  });

  describe("option backfill", () => {
    beforeEach(() => {
      backfillMenuItemOptions.mockReset();
    });

    it("lets an admin convert legacy JSON options and reports the counts", async () => {
      auth.user = buildUser(ROLE.ADMIN, { restaurantId: null });
      backfillMenuItemOptions.mockResolvedValue({
        menuItemsScanned: 3,
        menuItemsBackfilled: 3,
        groupsInserted: 6,
        choicesInserted: 10,
        groupsReused: 0,
      });

      const response = await request("/option-groups/backfill", "POST", {});

      expect(response.status).toBe(200);
      expect(backfillMenuItemOptions).toHaveBeenCalledOnce();
      const body = (await response.json()) as {
        data: { menuItemsBackfilled: number; groupsReused: number };
      };
      expect(body.data).toMatchObject({
        menuItemsBackfilled: 3,
        groupsReused: 0,
      });
    });

    // Re-running is the recovery path after a partial failure, so a second
    // call has to be a no-op rather than a second set of groups.
    it("reports nothing left to do on a second run", async () => {
      auth.user = buildUser(ROLE.ADMIN, { restaurantId: null });
      backfillMenuItemOptions.mockResolvedValue({
        menuItemsScanned: 3,
        menuItemsBackfilled: 0,
        groupsInserted: 0,
        choicesInserted: 0,
        groupsReused: 0,
      });

      const response = await request("/option-groups/backfill", "POST", {});

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { menuItemsBackfilled: number };
      };
      expect(body.data.menuItemsBackfilled).toBe(0);
    });
  });

  it("creates, updates, reorders, and deletes categories", async () => {
    let response = await request("/rest-1/categories", "POST", {
      name: "Noodles",
      sortOrder: 1,
    });

    expect(response.status).toBe(201);
    expect(serviceFns.createCategory).toHaveBeenCalledWith({
      name: "Noodles",
      sortOrder: 1,
      restaurantId: "rest-1",
    });

    response = await request("/categories/3", "PUT", { name: "Updated" });
    expect(response.status).toBe(200);
    expect(serviceFns.updateCategory).toHaveBeenCalledWith(3, {
      name: "Updated",
    });
    expect(syncFns.onCategoryChanged).toHaveBeenCalledWith(3);

    response = await request("/rest-1/categories/reorder", "PATCH", {
      categories: [{ id: 3, sortOrder: 2 }],
    });
    expect(response.status).toBe(200);
    expect(serviceFns.reorderCategories).toHaveBeenCalledWith("rest-1", [
      { id: 3, sortOrder: 2 },
    ]);

    response = await request("/categories/3", "DELETE");
    expect(response.status).toBe(200);
    expect(serviceFns.deleteCategory).toHaveBeenCalledWith(3);
  });

  it("blocks category mutations on missing or unauthorized categories", async () => {
    auth.user = {
      id: "user-8",
      username: "owner",
      role: 1,
      restaurantId: "other",
    };

    let response = await request("/categories/3", "PUT", { name: "Updated" });

    expect(response.status).toBe(403);
    expect(serviceFns.updateCategory).not.toHaveBeenCalled();

    serviceFns.getCategoryById.mockResolvedValueOnce(null);
    auth.user = { id: "user-1", username: "admin", role: 0 };
    response = await request("/categories/3", "DELETE");

    expect(response.status).toBe(404);

    serviceFns.getCategoryById.mockResolvedValueOnce(category);
    serviceFns.deleteCategory.mockResolvedValueOnce(false);
    response = await request("/categories/3", "DELETE");

    expect(response.status).toBe(404);
  });

  it("returns menu analytics and popularity metrics", async () => {
    let response = await request("/rest-1/analytics?includeDetails=true");

    expect(response.status).toBe(200);
    expect(serviceFns.getMenuAnalytics).toHaveBeenCalledWith("rest-1");

    response = await request("/rest-1/popularity");

    expect(response.status).toBe(200);
    expect(serviceFns.getPopularityMetrics).toHaveBeenCalledWith("rest-1");

    // /popularity surfaces order-derived sales data and must require the
    // "analytics" (pro-tier) module, not "menu_management" (see
    // module-gate.test.ts for the real, unmocked-gate proof).
    expect(moduleGateRegistrationKeys).toContain("analytics");
  });

  // Issue #85: bulk price updates were already ADMIN/OWNER-only, yet a chef
  // could change the very same prices one item at a time — and creating an item
  // sets its price. A chef's writes are now stock and availability only.
  describe("chef writes are limited to stock and availability (#85)", () => {
    it("lets a chef flip availability and inventory on a single item", async () => {
      auth.user = buildUser(ROLE.CHEF);

      const response = await request("/items/11", "PUT", {
        isAvailable: false,
        inventoryCount: 0,
      });

      expect(response.status).toBe(200);
      expect(serviceFns.updateMenuItem).toHaveBeenCalledOnce();
      expect(serviceFns.updateMenuItem).toHaveBeenCalledWith(
        11,
        expect.objectContaining({ isAvailable: false, inventoryCount: 0 }),
        item,
      );
    });

    it("rejects a chef PUT carrying a price, naming the refused field", async () => {
      auth.user = buildUser(ROLE.CHEF);

      // updatedAt is present so the body is schema-valid and the role/field
      // rule is unambiguously what refuses it — without it the optimistic-lock
      // refinement would answer 400 first (see the #85 lock tests below).
      const response = await request("/items/11", "PUT", {
        isAvailable: false,
        price: 999,
        updatedAt: ITEM_VERSION,
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({
          code: "CHEF_FIELD_NOT_ALLOWED",
          message: expect.stringContaining("price"),
        }),
      });
      // Refused on the body alone, before any DB work.
      expect(serviceFns.getMenuItem).not.toHaveBeenCalled();
      expect(serviceFns.updateMenuItem).not.toHaveBeenCalled();
    });

    it("rejects a chef PUT that renames or recategorises an item", async () => {
      auth.user = buildUser(ROLE.CHEF);

      const response = await request("/items/11", "PUT", {
        name: "Cheaper Laksa",
        categoryId: 4,
        updatedAt: ITEM_VERSION,
      });

      expect(response.status).toBe(403);
      expect(serviceFns.updateMenuItem).not.toHaveBeenCalled();
    });

    it("blocks a chef from creating items, since create sets a price", async () => {
      auth.user = buildUser(ROLE.CHEF);

      const response = await request("/rest-1/items", "POST", itemBody());

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({ code: "INSUFFICIENT_ROLE" }),
      });
      expect(serviceFns.createMenuItem).not.toHaveBeenCalled();
    });

    it("keeps bulk availability open to a chef and bulk prices closed", async () => {
      auth.user = buildUser(ROLE.CHEF);

      let response = await request("/rest-1/items/availability", "PATCH", {
        updates: [{ id: 11, isAvailable: false }],
      });

      expect(response.status).toBe(200);
      expect(serviceFns.batchUpdateAvailability).toHaveBeenCalledOnce();

      response = await request("/rest-1/items/prices", "PATCH", {
        updates: [{ id: 11, price: 190 }],
      });

      expect(response.status).toBe(403);
      expect(serviceFns.batchUpdatePrices).not.toHaveBeenCalled();
    });

    it("leaves owners free to change prices and create items", async () => {
      auth.user = buildUser(ROLE.OWNER);

      let response = await request("/items/11", "PUT", {
        price: 210,
        updatedAt: ITEM_VERSION,
      });

      expect(response.status).toBe(200);
      expect(serviceFns.updateMenuItem).toHaveBeenCalledWith(
        11,
        expect.objectContaining({ price: 210 }),
        item,
      );

      response = await request("/rest-1/items", "POST", itemBody());

      expect(response.status).toBe(201);
      expect(serviceFns.createMenuItem).toHaveBeenCalledWith(
        expect.objectContaining({ price: 180, restaurantId: "rest-1" }),
      );
    });
  });

  // Issue #85: these three are public and unauthenticated, and the menu has no
  // pagination ceiling of its own, so an uncapped limit was a free full-catalogue
  // dump; page=0 produced a negative OFFSET.
  describe("public list endpoints bound their query limits (#85)", () => {
    it("rejects limit=999999 on search, featured, and popular", async () => {
      for (const path of [
        "/rest-1/search?limit=999999",
        "/rest-1/featured?limit=999999",
        "/rest-1/popular?limit=999999",
      ]) {
        const response = await request(path);
        expect(response.status).toBe(400);
      }

      expect(serviceFns.searchMenuItems).not.toHaveBeenCalled();
      expect(serviceFns.getFeaturedItems).not.toHaveBeenCalled();
      expect(serviceFns.getPopularItems).not.toHaveBeenCalled();
    });

    it("still serves the maximum allowed page size", async () => {
      let response = await request("/rest-1/search?limit=100");

      expect(response.status).toBe(200);
      expect(serviceFns.searchMenuItems).toHaveBeenCalledWith(
        "rest-1",
        expect.objectContaining({ limit: 100, page: 1 }),
      );

      response = await request("/rest-1/featured?limit=100");

      expect(response.status).toBe(200);
      expect(serviceFns.getFeaturedItems).toHaveBeenCalledWith("rest-1", 100);
    });

    it("rejects page=0 on search", async () => {
      const response = await request("/rest-1/search?page=0");

      expect(response.status).toBe(400);
      expect(serviceFns.searchMenuItems).not.toHaveBeenCalled();
    });
  });

  // Issue #85: the CSV importer POSTed one item per row from the browser, so a
  // batch that failed on row 7 left rows 1-6 committed and re-running it
  // duplicated them.
  describe("bulk item creation (#85)", () => {
    beforeEach(() => {
      serviceFns.bulkCreateMenuItems.mockResolvedValue([
        { ...item, id: 11 },
        { ...item, id: 12 },
      ]);
    });

    it("creates a whole batch in one call and reports the count", async () => {
      auth.user = buildUser(ROLE.OWNER);

      const response = await request("/rest-1/items/bulk", "POST", {
        items: [itemBody(), itemBody({ name: "Rendang" })],
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        data: expect.objectContaining({ created: 2 }),
      });
      // One call for the batch, not one per row.
      expect(serviceFns.bulkCreateMenuItems).toHaveBeenCalledOnce();
      expect(serviceFns.bulkCreateMenuItems).toHaveBeenCalledWith("rest-1", [
        expect.objectContaining({ name: "Laksa", price: 180 }),
        expect.objectContaining({ name: "Rendang" }),
      ]);
      expect(serviceFns.createMenuItem).not.toHaveBeenCalled();
      expect(syncFns.onMenuItemChanged).toHaveBeenCalledWith(11);
      expect(syncFns.onMenuItemChanged).toHaveBeenCalledWith(12);
    });

    it("writes nothing and names the failing row when one item is invalid", async () => {
      auth.user = buildUser(ROLE.OWNER);
      const items = Array.from({ length: 10 }, (_, index) =>
        index === 6 ? itemBody({ price: -5 }) : itemBody(),
      );

      const response = await request("/rest-1/items/bulk", "POST", { items });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
      });
      expect(serviceFns.bulkCreateMenuItems).not.toHaveBeenCalled();
    });

    it("rejects a batch over the item cap", async () => {
      auth.user = buildUser(ROLE.OWNER);

      const response = await request("/rest-1/items/bulk", "POST", {
        items: Array.from({ length: 101 }, () => itemBody()),
      });

      expect(response.status).toBe(400);
      expect(serviceFns.bulkCreateMenuItems).not.toHaveBeenCalled();
    });

    it("is closed to a chef, like the single create it batches", async () => {
      auth.user = buildUser(ROLE.CHEF);

      const response = await request("/rest-1/items/bulk", "POST", {
        items: [itemBody()],
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({ code: "INSUFFICIENT_ROLE" }),
      });
      expect(serviceFns.bulkCreateMenuItems).not.toHaveBeenCalled();
    });

    it("surfaces the service's per-row rejection details unchanged", async () => {
      auth.user = buildUser(ROLE.OWNER);
      serviceFns.bulkCreateMenuItems.mockRejectedValueOnce(
        new ApiError(
          "CATEGORY_RESTAURANT_MISMATCH",
          "One or more categories do not belong to the specified restaurant",
          403,
          [{ index: 6, field: "categoryId", message: "Category 99 …" }],
        ),
      );

      const response = await request("/rest-1/items/bulk", "POST", {
        items: [itemBody()],
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({
          code: "CATEGORY_RESTAURANT_MISMATCH",
        }),
      });
    });
  });

  // Issue #85: PUT /menu/items/:id had no version check, and the admin form
  // saves every field it rendered.
  describe("single item updates require a version unless they are stock-only (#85)", () => {
    it("refuses a field-changing PUT with no version, before any DB work", async () => {
      auth.user = buildUser(ROLE.OWNER);

      const response = await request("/items/11", "PUT", { price: 210 });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
      });
      expect(serviceFns.getMenuItem).not.toHaveBeenCalled();
      expect(serviceFns.updateMenuItem).not.toHaveBeenCalled();
    });

    it("passes a 409 from the service through as MENU_ITEM_MODIFIED", async () => {
      auth.user = buildUser(ROLE.OWNER);
      serviceFns.updateMenuItem.mockRejectedValueOnce(
        new ApiError(
          "MENU_ITEM_MODIFIED",
          "This menu item was changed by someone else since you loaded it",
          409,
        ),
      );

      const response = await request("/items/11", "PUT", {
        price: 210,
        updatedAt: "2026-07-30T07:00:00.000Z",
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({ code: "MENU_ITEM_MODIFIED" }),
      });
    });

    it("lets a chef's stock-only PUT through with no version", async () => {
      auth.user = buildUser(ROLE.CHEF);

      const response = await request("/items/11", "PUT", {
        isAvailable: false,
      });

      expect(response.status).toBe(200);
      expect(serviceFns.updateMenuItem).toHaveBeenCalledWith(
        11,
        { isAvailable: false },
        item,
      );
    });
  });

  // Issue #85: a base64 data URL used to be stored verbatim in
  // menu_items.image_url and then re-served on every public menu request.
  it("refuses a base64 data URL as an item image (#85)", async () => {
    const response = await request(
      "/rest-1/items",
      "POST",
      itemBody({ imageUrl: `data:image/png;base64,${"A".repeat(2048)}` }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    });
    expect(serviceFns.createMenuItem).not.toHaveBeenCalled();
  });

  /**
   * Issue #81: the price/customization business rules lived only on
   * `validateCompleteMenuItem`, which no route imported, so their green tests
   * proved nothing about the API. These go through the real validateBody
   * middleware to prove the rules now run where requests arrive.
   */
  describe("price and customization rules run at the route (#81)", () => {
    it("refuses creating an item priced above its original price", async () => {
      const response = await request(
        "/rest-1/items",
        "POST",
        itemBody({ price: 200, originalPrice: 100 }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
      });
      expect(serviceFns.createMenuItem).not.toHaveBeenCalled();
    });

    it("still accepts a genuine discount", async () => {
      const response = await request(
        "/rest-1/items",
        "POST",
        itemBody({ price: 100, originalPrice: 200 }),
      );

      expect(response.status).toBe(201);
      expect(serviceFns.createMenuItem).toHaveBeenCalledOnce();
    });

    it("refuses an update whose own body carries a negative discount", async () => {
      const response = await request("/items/11", "PUT", {
        price: 300,
        originalPrice: 150,
        updatedAt: ITEM_VERSION,
      });

      expect(response.status).toBe(400);
      expect(serviceFns.updateMenuItem).not.toHaveBeenCalled();
    });

    it("refuses a batch price entry above its own original price", async () => {
      const response = await request("/rest-1/items/prices", "PATCH", {
        updates: [{ id: 11, price: 300, originalPrice: 100 }],
      });

      expect(response.status).toBe(400);
      expect(serviceFns.batchUpdatePrices).not.toHaveBeenCalled();
    });

    it("refuses a required single-choice customization with no default", async () => {
      const response = await request(
        "/rest-1/items",
        "POST",
        itemBody({
          options: {
            customizations: [
              {
                id: "spice",
                name: "Spice",
                type: "single",
                required: true,
                choices: [
                  { id: "mild", name: "Mild", priceAdjustment: 0 },
                  { id: "hot", name: "Hot", priceAdjustment: 0 },
                ],
              },
            ],
          },
        }),
      );

      expect(response.status).toBe(400);
      expect(serviceFns.createMenuItem).not.toHaveBeenCalled();
    });

    it("refuses multiple sizes without exactly one default", async () => {
      const response = await request(
        "/rest-1/items",
        "POST",
        itemBody({
          options: {
            sizes: [
              { id: "s", name: "Small", priceAdjustment: 0, isDefault: true },
              { id: "l", name: "Large", priceAdjustment: 20, isDefault: true },
            ],
          },
        }),
      );

      expect(response.status).toBe(400);
      expect(serviceFns.createMenuItem).not.toHaveBeenCalled();
    });
  });
});
