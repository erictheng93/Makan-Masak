import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { categories as categoriesTable } from "@makanmasak/database";
import { Status } from "@makanmasak/shared-types";
import { MenuService } from "./MenuService";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MenuService", () => {
  function createPublicDb(rows: unknown[] = [{ id: "rest-1" }]) {
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => rows),
          })),
        })),
      })),
    };
  }

  function createService(options?: {
    db?: unknown;
    dbService?: Record<string, unknown>;
  }) {
    const dbService = {
      getMenu: vi.fn(),
      getMenuItem: vi.fn(),
      createMenuItem: vi.fn(),
      updateMenuItem: vi.fn(),
      // Soft delete writes deleted_at_ms in the DB layer (#80); defaults to
      // "row existed and was deleted".
      softDeleteMenuItem: vi.fn(async () => true),
      createCategory: vi.fn(),
      updateCategory: vi.fn(),
      getCategory: vi.fn(),
      // Category deletion writes deleted_at_ms too, for the same reason items
      // do: the menu reads filter on that column, not on isActive.
      softDeleteCategory: vi.fn(async () => true),
      // The "is this category empty?" guard counts by category id alone, not
      // through searchMenuItems — that query's category-visibility conditions
      // made a hidden category read as empty. Defaults to empty.
      countItemsInCategory: vi.fn(async () => 0),
      searchMenuItems: vi.fn(),
      reorderCategories: vi.fn(),
      getFeaturedItems: vi.fn(),
      getPopularItems: vi.fn(),
      batchUpdateAvailability: vi.fn(),
      batchUpdatePricesScoped: vi.fn(),
      // Stored prices for the negative-discount check (#81); defaults to "no
      // stored originalPrice anywhere", which no update can conflict with.
      getMenuItemPrices: vi.fn(async () => new Map()),
      batchMoveItemsScoped: vi.fn(),
      // Ownership gate for the batch endpoints. Defaults to "every id asked
      // for is owned" so existing tests exercise the happy path; a test that
      // wants the rejection overrides it.
      findOwnedMenuItemIds: vi.fn(
        async (_restaurantId: string, ids: number[]) => new Set(ids),
      ),
      // Same "everything asked for is owned" default for the bulk-create
      // category gate (#85); the rejection test overrides it.
      findOwnedCategoryIds: vi.fn(
        async (_restaurantId: string, ids: number[]) => new Set(ids),
      ),
      bulkCreateMenuItems: vi.fn(async (items: unknown[]) =>
        items.map((_item, index) => menuItem({ id: 200 + index })),
      ),
      incrementOrderCount: vi.fn(),
      incrementViewCount: vi.fn(),
      // Top-N now happens in SQL rather than by re-sorting a page of
      // searchMenuItems results in JS (#84), so the service delegates to these.
      getMostViewedItems: vi.fn(async () => []),
      getHighestRatedItems: vi.fn(async () => []),
      getRecentlyAddedItems: vi.fn(async () => []),
      ...options?.dbService,
    };
    const service = new MenuService({ DB: {} as D1Database } as never);
    Object.defineProperty(service, "db", {
      value: options?.db ?? createPublicDb(),
    });
    Object.defineProperty(service, "dbService", { value: dbService });
    return { service, dbService };
  }

  function menuItem(overrides: Record<string, unknown> = {}) {
    return {
      id: 101,
      restaurantId: "rest-1",
      categoryId: 7,
      name: "Laksa",
      description: "Rich curry soup",
      price: 180,
      originalPrice: 220,
      imageId: "01940000-0000-7000-8000-000000000001",
      isAvailable: true,
      isFeatured: false,
      isPopular: false,
      sortOrder: 3,
      inventoryCount: 5,
      orderCount: 4,
      allergens: ["shellfish"],
      dietaryInfo: { halal: true },
      spiceLevel: 2,
      rating: 4.5,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("preserves null inventory as unlimited stock in menu item responses", () => {
    const { service } = createService();
    const transformed = (
      service as unknown as {
        transformMenuItem: (
          item: Record<string, unknown>,
        ) => Record<string, unknown>;
      }
    ).transformMenuItem(menuItem({ inventoryCount: null }));

    expect(transformed.inventoryCount).toBeNull();
  });

  function category(overrides: Record<string, unknown> = {}) {
    return {
      id: 7,
      restaurantId: "rest-1",
      name: "Noodles",
      description: "Comfort food",
      sortOrder: 2,
      isActive: true,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-02T00:00:00.000Z"),
      ...overrides,
    };
  }

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

  it("keeps category transforms explicit for every surfaced DB column", () => {
    const tableColumns = Object.keys(getTableColumns(categoriesTable));
    const { service } = createService();
    const transformed = (
      service as unknown as {
        transformCategory: (
          category: Record<string, unknown>,
        ) => Record<string, unknown>;
      }
    ).transformCategory({
      ...Object.fromEntries(tableColumns.map((column) => [column, column])),
      isActive: true,
      isVisible: true,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    });

    expect(
      findUncoveredProjectionColumns(tableColumns, Object.keys(transformed), [
        "iconUrl",
        "availableHours",
        "deletedAt",
      ]),
    ).toEqual([]);
  });

  it("fails closed when a new category column is neither transformed nor exempted", () => {
    const tableColumns = Object.keys(getTableColumns(categoriesTable));
    const futureColumn = "__futureColumn";
    const { service } = createService();
    const transformed = (
      service as unknown as {
        transformCategory: (
          category: Record<string, unknown>,
        ) => Record<string, unknown>;
      }
    ).transformCategory({
      ...Object.fromEntries(tableColumns.map((column) => [column, column])),
      isActive: true,
      isVisible: true,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    });

    expect(
      findUncoveredProjectionColumns(
        [...tableColumns, futureColumn],
        Object.keys(transformed),
        ["iconUrl", "availableHours", "deletedAt"],
      ),
    ).toContain(futureColumn);
  });

  it("returns null for public menu reads when the restaurant is unavailable", async () => {
    const { service, dbService } = createService({ db: createPublicDb([]) });

    await expect(service.getMenu("rest-1")).resolves.toBeNull();
    expect(dbService.getMenu).not.toHaveBeenCalled();
  });

  it("fetches and transforms menus when public access is allowed", async () => {
    const { service, dbService } = createService({
      dbService: {
        getMenu: vi.fn(async () => ({
          categories: [category({ status: Status.ACTIVE })],
          menuItems: [
            menuItem({
              categoryId: "7",
              restaurantId: 42,
              isAvailable: undefined,
              allergens: undefined,
            }),
          ],
        })),
      },
    });

    await expect(service.getMenu("rest-1")).resolves.toMatchObject({
      categories: [
        {
          id: 7,
          restaurantId: "rest-1",
          status: Status.ACTIVE,
          createdAt: new Date("2026-06-01T00:00:00.000Z").getTime(),
        },
      ],
      menuItems: [
        {
          id: 101,
          imageId: "01940000-0000-7000-8000-000000000001",
          restaurantId: "42",
          categoryId: 7,
          isAvailable: false,
          allergens: [],
          reviewCount: 0,
          viewCount: 0,
        },
      ],
    });
    expect(dbService.getMenu).toHaveBeenCalledWith("rest-1", undefined);
  });

  it("bypasses the public availability gate for privileged menu reads", async () => {
    // The row here stands in for "the restaurant exists and is not deleted".
    // The privileged path deliberately does NOT require isActive: an owner
    // whose restaurant is paused still has to read their own menu (#84).
    const db = createPublicDb([{ id: "rest-1" }]);
    const { service, dbService } = createService({
      db,
      dbService: {
        getMenu: vi.fn(async () => ({
          categories: [category()],
          menuItems: [menuItem()],
        })),
      },
    });

    await expect(
      service.getMenu("rest-1", { includeUnavailable: true }),
    ).resolves.toMatchObject({ menuItems: [{ id: 101 }] });
    expect(db.select).toHaveBeenCalledOnce();
    expect(dbService.getMenu).toHaveBeenCalledWith("rest-1", {
      includeUnavailable: true,
    });
  });

  it("still returns null for privileged reads of a restaurant that does not exist", async () => {
    const { service, dbService } = createService({
      db: createPublicDb([]),
      dbService: {
        getMenu: vi.fn(async () => ({ categories: [], menuItems: [] })),
      },
    });

    await expect(
      service.getMenu("missing", { includeUnavailable: true }),
    ).resolves.toBeNull();
    expect(dbService.getMenu).not.toHaveBeenCalled();
  });

  it("returns null for missing menu item and category reads", async () => {
    const { service, dbService } = createService({
      dbService: {
        getMenuItem: vi.fn(async () => null),
        getCategory: vi.fn(async () => null),
      },
    });

    await expect(service.getMenuItem(404)).resolves.toBeNull();
    await expect(service.getCategoryById(404)).resolves.toBeNull();
    expect(dbService.getMenuItem).toHaveBeenCalledWith(404);
    expect(dbService.getCategory).toHaveBeenCalledWith(404);
  });

  it("creates menu items only after category restaurant validation", async () => {
    const created = menuItem({ id: 202, restaurantId: "rest-1" });
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => category()),
        createMenuItem: vi.fn(async () => created),
      },
    });

    await expect(
      service.createMenuItem({
        restaurantId: "rest-1",
        categoryId: 7,
        name: "Laksa",
        price: 180,
        imageId: "01940000-0000-7000-8000-000000000002",
      } as never),
    ).resolves.toMatchObject({ id: 202, restaurantId: "rest-1" });
    expect(dbService.createMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "rest-1",
        categoryId: 7,
        name: "Laksa",
        imageId: "01940000-0000-7000-8000-000000000002",
      }),
    );
  });

  it("rejects menu item creation when the category belongs to another restaurant", async () => {
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => category({ restaurantId: "other" })),
      },
    });

    await expect(
      service.createMenuItem({
        restaurantId: "rest-1",
        categoryId: 7,
        name: "Laksa",
        price: 180,
      } as never),
    ).rejects.toThrow("Category does not belong to the specified restaurant");
    expect(dbService.createMenuItem).not.toHaveBeenCalled();
  });

  it("rejects menu item creation when the category is missing", async () => {
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => null),
      },
    });

    await expect(
      service.createMenuItem({
        restaurantId: "rest-1",
        categoryId: 404,
        name: "Laksa",
        price: 180,
      } as never),
    ).rejects.toThrow("Category not found");
    expect(dbService.createMenuItem).not.toHaveBeenCalled();
  });

  it("updates menu items with prefetched data and validates category moves", async () => {
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => category({ id: 8 })),
        updateMenuItem: vi.fn(async () =>
          menuItem({ id: 101, categoryId: 8, restaurantId: "rest-1" }),
        ),
      },
    });

    await expect(
      service.updateMenuItem(
        101,
        {
          categoryId: 8,
          restaurantId: "rest-1",
          name: "New Laksa",
          imageId: null,
        },
        menuItem({ categoryId: 7 }) as never,
      ),
    ).resolves.toMatchObject({ id: 101, categoryId: 8 });
    expect(dbService.updateMenuItem).toHaveBeenCalledWith(101, {
      categoryId: 8,
      restaurantId: "rest-1",
      name: "New Laksa",
      imageId: null,
    });
  });

  // Issue #85: the admin form saves every field it rendered, so without a
  // version check an owner changing a price silently reverted the sold-out flag
  // a chef had set while the form was open — and the same in reverse.
  describe("optimistic locking on menu item updates (#85)", () => {
    /** The stored row's updated_at_ms, as Drizzle hands it over. */
    const storedAt = new Date("2026-07-30T08:15:30.250Z");

    function createLockService() {
      return createService({
        dbService: {
          updateMenuItem: vi.fn(async () => menuItem()),
        },
      });
    }

    it("refuses a stale version with MENU_ITEM_MODIFIED and writes nothing", async () => {
      const { service, dbService } = createLockService();

      await expect(
        service.updateMenuItem(
          101,
          { price: 210, updatedAt: storedAt.getTime() - 60_000 },
          menuItem({ updatedAt: storedAt }) as never,
        ),
      ).rejects.toMatchObject({
        code: "MENU_ITEM_MODIFIED",
        status: 409,
      });

      expect(dbService.updateMenuItem).not.toHaveBeenCalled();
    });

    it("accepts the current version and never writes updatedAt as a column", async () => {
      const { service, dbService } = createLockService();

      await expect(
        service.updateMenuItem(
          101,
          { price: 210, updatedAt: storedAt.getTime() },
          menuItem({ updatedAt: storedAt }) as never,
        ),
      ).resolves.toMatchObject({ id: 101 });

      expect(dbService.updateMenuItem).toHaveBeenCalledOnce();
      expect(dbService.updateMenuItem).toHaveBeenCalledWith(101, {
        price: 210,
        restaurantId: undefined,
      });
    });

    it("compares instants, not representations, across the JSON round trip", async () => {
      // This is the exact round trip the dashboard performs: the response
      // serialised the Date to an ISO string, the client echoed it back, and the
      // request schema turned it into epoch ms. A string comparison would fail
      // here even though nothing changed.
      const { service, dbService } = createLockService();
      const overWire = JSON.parse(JSON.stringify({ updatedAt: storedAt }))
        .updatedAt as string;

      await expect(
        service.updateMenuItem(
          101,
          { price: 210, updatedAt: Date.parse(overWire) },
          menuItem({ updatedAt: storedAt }) as never,
        ),
      ).resolves.toMatchObject({ id: 101 });
      expect(dbService.updateMenuItem).toHaveBeenCalledOnce();
    });

    it("blocks the sold-out scenario from the issue end to end", async () => {
      // The owner opened the form while the item was available, a chef marked it
      // sold out, then the owner saved the whole form back.
      const { service, dbService } = createLockService();
      const formLoadedAt = storedAt.getTime();
      const chefFlippedAt = new Date(formLoadedAt + 30_000);

      await expect(
        service.updateMenuItem(
          101,
          { price: 210, isAvailable: true, updatedAt: formLoadedAt },
          menuItem({
            isAvailable: false,
            updatedAt: chefFlippedAt,
          }) as never,
        ),
      ).rejects.toMatchObject({ code: "MENU_ITEM_MODIFIED" });

      expect(dbService.updateMenuItem).not.toHaveBeenCalled();
    });

    it("fails closed when the stored row has no readable timestamp", async () => {
      // Nothing to compare against means the write cannot be verified. Waving
      // it through would make the lock silently absent exactly when the data is
      // in the state we understand least.
      const { service, dbService } = createLockService();

      await expect(
        service.updateMenuItem(
          101,
          { price: 210, updatedAt: storedAt.getTime() },
          menuItem({ updatedAt: "not-a-timestamp" }) as never,
        ),
      ).rejects.toMatchObject({
        code: "MENU_ITEM_MODIFIED",
        status: 409,
      });

      expect(dbService.updateMenuItem).not.toHaveBeenCalled();
    });

    it("leaves a stock-only update unchecked when no version is sent", async () => {
      const { service, dbService } = createLockService();

      await expect(
        service.updateMenuItem(
          101,
          { isAvailable: false },
          menuItem({ updatedAt: storedAt }) as never,
        ),
      ).resolves.toMatchObject({ id: 101 });

      expect(dbService.updateMenuItem).toHaveBeenCalledWith(101, {
        isAvailable: false,
        restaurantId: undefined,
      });
    });
  });

  // Issue #85: the CSV importer POSTed one item per row, so a batch that failed
  // part-way left the earlier rows committed and re-running it duplicated them.
  describe("bulk menu item creation (#85)", () => {
    function rows(count: number, categoryId = 7) {
      return Array.from({ length: count }, (_, index) => ({
        categoryId,
        name: `Item ${index}`,
        price: 10 + index,
      }));
    }

    it("writes the whole batch in one call with the path restaurant injected", async () => {
      const { service, dbService } = createService();

      const created = await service.bulkCreateMenuItems("rest-1", rows(3));

      expect(created).toHaveLength(3);
      expect(dbService.bulkCreateMenuItems).toHaveBeenCalledOnce();
      expect(dbService.bulkCreateMenuItems).toHaveBeenCalledWith([
        expect.objectContaining({ name: "Item 0", restaurantId: "rest-1" }),
        expect.objectContaining({ name: "Item 1", restaurantId: "rest-1" }),
        expect.objectContaining({ name: "Item 2", restaurantId: "rest-1" }),
      ]);
      // One ownership query for the whole batch, not one per row.
      expect(dbService.findOwnedCategoryIds).toHaveBeenCalledOnce();
      expect(dbService.findOwnedCategoryIds).toHaveBeenCalledWith(
        "rest-1",
        [7],
      );
      expect(dbService.createMenuItem).not.toHaveBeenCalled();
    });

    it("rejects the batch and writes nothing when a row points at another restaurant's category", async () => {
      const { service, dbService } = createService({
        dbService: {
          // 7 belongs to rest-1; 99 does not.
          findOwnedCategoryIds: vi.fn(async () => new Set([7])),
        },
      });
      const items = rows(10);
      items[6].categoryId = 99;

      const rejection = await service
        .bulkCreateMenuItems("rest-1", items)
        .catch((error) => error);

      expect(rejection).toMatchObject({
        code: "CATEGORY_RESTAURANT_MISMATCH",
        status: 403,
      });
      // The failing row has to be identifiable, or the importer can only say
      // "something failed" — which is what the per-item loop did (#85).
      expect(rejection.details).toEqual([
        expect.objectContaining({ index: 6, field: "categoryId" }),
      ]);
      expect(dbService.bulkCreateMenuItems).not.toHaveBeenCalled();
    });

    it("does nothing at all for an empty batch", async () => {
      const { service, dbService } = createService();

      await expect(service.bulkCreateMenuItems("rest-1", [])).resolves.toEqual(
        [],
      );
      expect(dbService.findOwnedCategoryIds).not.toHaveBeenCalled();
      expect(dbService.bulkCreateMenuItems).toHaveBeenCalledWith([]);
    });
  });

  it("rejects updates for missing menu items before writing", async () => {
    const { service, dbService } = createService({
      dbService: {
        getMenuItem: vi.fn(async () => null),
      },
    });

    await expect(
      service.updateMenuItem(404, { name: "Missing" }),
    ).rejects.toThrow("Menu item not found");
    expect(dbService.updateMenuItem).not.toHaveBeenCalled();
  });

  it("soft deletes menu items via deletedAt and reports missing items as false", async () => {
    const { service, dbService } = createService({
      dbService: {
        softDeleteMenuItem: vi.fn(async () => true),
      },
    });

    await expect(
      service.deleteMenuItem(101, menuItem() as never),
    ).resolves.toBe(true);
    // The delete must go through the dedicated soft-delete path — the old
    // implementation wrote sortOrder: -1 through updateMenuItem, a marker
    // nothing else understood (#80).
    expect(dbService.softDeleteMenuItem).toHaveBeenCalledWith(101);
    expect(dbService.updateMenuItem).not.toHaveBeenCalled();

    await expect(service.deleteMenuItem(404, null as never)).resolves.toBe(
      false,
    );
  });

  it("reports false when the row was already soft-deleted underneath us", async () => {
    const { service, dbService } = createService({
      dbService: {
        softDeleteMenuItem: vi.fn(async () => false),
      },
    });

    await expect(
      service.deleteMenuItem(101, menuItem() as never),
    ).resolves.toBe(false);
    expect(dbService.softDeleteMenuItem).toHaveBeenCalledOnce();
  });

  it("creates and updates categories with normalized status and timestamps", async () => {
    const { service, dbService } = createService({
      dbService: {
        createCategory: vi.fn(async () => category({ id: 9 })),
        updateCategory: vi.fn(async () => category({ id: 9, isActive: false })),
      },
    });

    await expect(
      service.createCategory({
        restaurantId: "rest-1",
        name: "Drinks",
        sortOrder: 1,
      } as never),
    ).resolves.toMatchObject({
      id: 9,
      restaurantId: "rest-1",
      status: Status.ACTIVE,
      createdAt: new Date("2026-06-01T00:00:00.000Z").getTime(),
    });
    await expect(
      service.updateCategory(9, { isActive: false } as never),
    ).resolves.toMatchObject({
      id: 9,
      status: Status.INACTIVE,
    });
  });

  it("blocks category deletion when menu items still reference it", async () => {
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => category()),
        countItemsInCategory: vi.fn(async () => 1),
      },
    });

    await expect(service.deleteCategory(7)).rejects.toThrow(
      "Cannot delete category that contains menu items",
    );
    expect(dbService.softDeleteCategory).not.toHaveBeenCalled();
  });

  it("counts the category's items directly rather than through the visibility-filtered search", async () => {
    // searchMenuItems' WHERE carries publicCategoryConditions, which are
    // conditions on the category — a hidden one reported zero items whatever
    // it held, so the emptiness guard passed for a full category.
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => category({ isVisible: false })),
        countItemsInCategory: vi.fn(async () => 3),
      },
    });

    await expect(service.deleteCategory(7)).rejects.toThrow(
      "Cannot delete category that contains menu items",
    );
    expect(dbService.countItemsInCategory).toHaveBeenCalledWith(7);
    expect(dbService.searchMenuItems).not.toHaveBeenCalled();
  });

  it("reports missing categories as already deleted", async () => {
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => null),
      },
    });

    await expect(service.deleteCategory(404)).resolves.toBe(false);
    expect(dbService.countItemsInCategory).not.toHaveBeenCalled();
    expect(dbService.softDeleteCategory).not.toHaveBeenCalled();
  });

  it("deletes empty categories by writing deleted_at_ms, not just isActive", async () => {
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => category()),
        countItemsInCategory: vi.fn(async () => 0),
      },
    });

    await expect(service.deleteCategory(7)).resolves.toBe(true);
    expect(dbService.softDeleteCategory).toHaveBeenCalledWith(7);
    // The admin menu read filters categories on deletedAt alone, so marking
    // isActive was invisible to it and the category came straight back.
    expect(dbService.updateCategory).not.toHaveBeenCalled();
  });

  it("reports an already-deleted category as gone instead of succeeding twice", async () => {
    const { service } = createService({
      dbService: {
        getCategory: vi.fn(async () => category()),
        countItemsInCategory: vi.fn(async () => 0),
        softDeleteCategory: vi.fn(async () => false),
      },
    });

    await expect(service.deleteCategory(7)).resolves.toBe(false);
  });

  it("searches, highlights featured and popular items, and performs counters", async () => {
    const { service, dbService } = createService({
      dbService: {
        searchMenuItems: vi.fn(async () => ({
          items: [menuItem({ id: 1 })],
          pagination: { page: 2, limit: 5, total: 1 },
        })),
        getFeaturedItems: vi.fn(async () => [menuItem({ isFeatured: true })]),
        getPopularItems: vi.fn(async () => [menuItem({ isPopular: true })]),
      },
    });

    await expect(
      service.searchMenuItems("rest-1", {
        search: "laksa",
        categoryId: 7,
        page: 2,
        limit: 5,
      }),
    ).resolves.toMatchObject({
      items: [{ id: 1 }],
      pagination: { page: 2, limit: 5, total: 1 },
    });
    expect(dbService.searchMenuItems).toHaveBeenCalledWith(
      "rest-1",
      expect.objectContaining({ search: "laksa", categoryId: 7 }),
      2,
      5,
    );
    await expect(service.getFeaturedItems("rest-1")).resolves.toMatchObject([
      { isFeatured: true },
    ]);
    await expect(service.getPopularItems("rest-1", 3)).resolves.toMatchObject([
      { isPopular: true },
    ]);
    await service.incrementOrderCount(101, 2);
    await service.incrementViewCount(101);
    expect(dbService.incrementOrderCount).toHaveBeenCalledWith(101, 2);
    expect(dbService.incrementViewCount).toHaveBeenCalledWith(101);
  });

  it("batch updates availability, prices, and category moves", async () => {
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => category({ id: 8 })),
      },
    });

    await service.batchUpdateAvailability("rest-1", [
      { id: 101, isAvailable: false },
    ]);
    await service.batchUpdatePrices("rest-1", [
      { id: 101, price: 190, originalPrice: 220 },
      { id: 102, price: 95 },
    ] as never);
    await service.batchMoveItems("rest-1", [
      { id: 101, categoryId: 8 },
      { id: 102, categoryId: 8 },
    ]);

    expect(dbService.batchUpdateAvailability).toHaveBeenCalledWith("rest-1", [
      { id: 101, isAvailable: false },
    ]);

    // Prices and moves used to loop over updateMenuItem(), whose WHERE matched
    // on id alone — that was the cross-tenant hole (#77). They now go through
    // restaurant-scoped batch statements applied in one D1 transaction.
    expect(dbService.updateMenuItem).not.toHaveBeenCalled();
    expect(dbService.batchUpdatePricesScoped).toHaveBeenCalledWith("rest-1", [
      { id: 101, price: 190, originalPrice: 220 },
      { id: 102, price: 95 },
    ]);
    expect(dbService.batchMoveItemsScoped).toHaveBeenCalledWith("rest-1", [
      { id: 101, categoryId: 8 },
      { id: 102, categoryId: 8 },
    ]);

    // Every batch checks ownership before writing anything.
    expect(dbService.findOwnedMenuItemIds).toHaveBeenCalledTimes(3);
  });

  it("rejects a batch naming an item from another restaurant", async () => {
    const { service, dbService } = createService({
      dbService: {
        getCategory: vi.fn(async () => category({ id: 8 })),
        // 101 belongs to rest-1; 999 does not.
        findOwnedMenuItemIds: vi.fn(async () => new Set([101])),
      },
    });

    await expect(
      service.batchUpdatePrices("rest-1", [
        { id: 101, price: 10 },
        { id: 999, price: 10 },
      ] as never),
    ).rejects.toMatchObject({ code: "MENU_ITEM_RESTAURANT_MISMATCH" });

    // All-or-nothing: the owned id must not be written either.
    expect(dbService.batchUpdatePricesScoped).not.toHaveBeenCalled();
  });

  /**
   * The DB-aware half of the negative-discount rule (#81): the schemas judge a
   * body that carries both price and originalPrice, but a partial body only
   * carries one half — the other half is in the database.
   */
  describe("stored-price consistency (#81)", () => {
    it("refuses a partial update whose new price exceeds the stored originalPrice", async () => {
      const { service, dbService } = createService({
        dbService: {
          getMenuItem: vi.fn(async () =>
            menuItem({ price: 180, originalPrice: 220 }),
          ),
        },
      });

      await expect(
        service.updateMenuItem(101, {
          price: 300,
          updatedAt: undefined,
        } as never),
      ).rejects.toMatchObject({ code: "PRICE_ABOVE_ORIGINAL", status: 400 });
      expect(dbService.updateMenuItem).not.toHaveBeenCalled();
    });

    it("refuses lowering originalPrice below the stored price", async () => {
      const { service, dbService } = createService({
        dbService: {
          getMenuItem: vi.fn(async () =>
            menuItem({ price: 180, originalPrice: 220 }),
          ),
        },
      });

      await expect(
        service.updateMenuItem(101, { originalPrice: 100 } as never),
      ).rejects.toMatchObject({ code: "PRICE_ABOVE_ORIGINAL" });
      expect(dbService.updateMenuItem).not.toHaveBeenCalled();
    });

    it("allows clearing originalPrice outright", async () => {
      const { service, dbService } = createService({
        dbService: {
          getMenuItem: vi.fn(async () =>
            menuItem({ price: 180, originalPrice: 220 }),
          ),
          updateMenuItem: vi.fn(async () => menuItem({ originalPrice: null })),
        },
      });

      await service.updateMenuItem(101, { originalPrice: null } as never);
      expect(dbService.updateMenuItem).toHaveBeenCalledOnce();
    });

    it("refuses a batch entry whose price exceeds the stored originalPrice", async () => {
      const { service, dbService } = createService({
        dbService: {
          getMenuItemPrices: vi.fn(
            async () => new Map([[101, { price: 180, originalPrice: 220 }]]),
          ),
        },
      });

      await expect(
        service.batchUpdatePrices("rest-1", [{ id: 101, price: 300 }] as never),
      ).rejects.toMatchObject({ code: "PRICE_ABOVE_ORIGINAL" });
      expect(dbService.batchUpdatePricesScoped).not.toHaveBeenCalled();
    });

    it("lets a batch entry override the stored originalPrice consistently", async () => {
      const { service, dbService } = createService({
        dbService: {
          getMenuItemPrices: vi.fn(
            async () => new Map([[101, { price: 180, originalPrice: 220 }]]),
          ),
        },
      });

      await service.batchUpdatePrices("rest-1", [
        { id: 101, price: 300, originalPrice: 350 },
      ] as never);
      expect(dbService.batchUpdatePricesScoped).toHaveBeenCalledOnce();
    });
  });

  it("transforms raw category fields used by management views", async () => {
    const { service } = createService({
      dbService: {
        getCategory: vi.fn(async () =>
          category({
            description: null,
            parentId: 2,
            isVisible: false,
            itemCount: 6,
          }),
        ),
      },
    });

    await expect(service.getCategoryById(7)).resolves.toMatchObject({
      id: 7,
      description: undefined,
      parentId: 2,
      isVisible: false,
      itemCount: 6,
    });
  });

  it("computes analytics from the transformed menu", async () => {
    const service = new MenuService({ DB: {} as D1Database } as never);
    const getMenu = vi.spyOn(service, "getMenu").mockResolvedValue({
      categories: [
        category({ id: 7, name: "Noodles", createdAt: "", updatedAt: "" }),
        category({ id: 8, name: "Rice", createdAt: "", updatedAt: "" }),
      ],
      menuItems: [
        menuItem({
          id: 1,
          categoryId: 7,
          price: 100,
          isAvailable: true,
          isFeatured: true,
          isPopular: true,
          orderCount: 5,
          dietaryInfo: { vegetarian: true, halal: true },
          spiceLevel: 1,
        }),
        menuItem({
          id: 2,
          categoryId: 8,
          price: 300,
          isAvailable: false,
          isFeatured: false,
          isPopular: false,
          orderCount: 2,
          dietaryInfo: { vegan: true, glutenFree: true },
          spiceLevel: 3,
        }),
      ],
    } as never);

    await expect(service.getMenuAnalytics("rest-1")).resolves.toMatchObject({
      totalItems: 2,
      availableItems: 1,
      featuredItems: 1,
      popularItems: 1,
      averagePrice: 200,
      priceRange: { min: 100, max: 300 },
      categoryDistribution: [
        {
          categoryId: 7,
          categoryName: "Noodles",
          itemCount: 1,
          percentage: 50,
        },
        {
          categoryId: 8,
          categoryName: "Rice",
          itemCount: 1,
          percentage: 50,
        },
      ],
      topPerformingItems: [
        { id: 1, name: "Laksa", orderCount: 5, revenue: 500, rating: 4.5 },
        { id: 2, name: "Laksa", orderCount: 2, revenue: 600, rating: 4.5 },
      ],
      dietaryInfoStats: {
        vegetarian: 1,
        vegan: 1,
        glutenFree: 1,
        halal: 1,
      },
      spiceLevelDistribution: { 1: 1, 3: 1 },
    });

    // availableItems used to be identically equal to totalItems because
    // analytics read the *public* menu, which is already filtered to
    // isAvailable — so an owner could never see how many items were paused
    // (#84). The fix is this argument.
    expect(getMenu).toHaveBeenCalledWith(
      "rest-1",
      expect.objectContaining({ includeUnavailable: true }),
    );
  });

  it("reports paused items so availableItems can be lower than totalItems (#84)", async () => {
    const service = new MenuService({ DB: {} as D1Database } as never);
    vi.spyOn(service, "getMenu").mockResolvedValue({
      categories: [category({ id: 7, createdAt: "", updatedAt: "" })],
      menuItems: [
        menuItem({ id: 1, categoryId: 7, price: 100, isAvailable: true }),
        menuItem({ id: 2, categoryId: 7, price: 500, isAvailable: false }),
        menuItem({ id: 3, categoryId: 7, price: 300, isAvailable: false }),
      ],
    } as never);

    const analytics = await service.getMenuAnalytics("rest-1");

    expect(analytics.totalItems).toBe(3);
    expect(analytics.availableItems).toBe(1);
    expect(analytics.availableItems).toBeLessThan(analytics.totalItems);
    // The neutrally-named aggregates must span the whole catalogue too, not
    // just the on-sale slice.
    expect(analytics.priceRange).toEqual({ min: 100, max: 500 });
    expect(analytics.categoryDistribution).toEqual([
      expect.objectContaining({ categoryId: 7, itemCount: 3 }),
    ]);
  });

  it("reports empty analytics without infinite price bounds", async () => {
    const service = new MenuService({ DB: {} as D1Database } as never);
    vi.spyOn(service, "getMenu").mockResolvedValue({
      categories: [category({ id: 7, createdAt: "", updatedAt: "" })],
      menuItems: [],
    } as never);

    await expect(service.getMenuAnalytics("rest-1")).resolves.toMatchObject({
      totalItems: 0,
      averagePrice: 0,
      priceRange: { min: 0, max: 0 },
      categoryDistribution: [],
      topPerformingItems: [],
      dietaryInfoStats: {
        vegetarian: 0,
        vegan: 0,
        glutenFree: 0,
        halal: 0,
      },
      spiceLevelDistribution: {},
    });
  });

  it("rejects analytics when the menu cannot be loaded", async () => {
    const service = new MenuService({ DB: {} as D1Database } as never);
    vi.spyOn(service, "getMenu").mockResolvedValue(null);

    await expect(service.getMenuAnalytics("missing")).rejects.toThrow(
      "Menu not found for restaurant",
    );
  });

  /**
   * Regression coverage for #84.3.
   *
   * The three Top-N lists used to call searchMenuItems(restaurantId,
   * {isAvailable:true}, 1, limit) — which orders by isFeatured/orderCount/
   * sortOrder — and then re-sort those `limit` rows in JS. On a menu with more
   * than `limit` items that ranked the wrong candidate set. Ordering and
   * limiting must happen in SQL, so the service must not paginate-then-sort.
   */
  it("delegates each popularity list to its own ordered query (#84)", async () => {
    const { service, dbService } = createService({
      dbService: {
        getPopularItems: vi.fn(async () => [menuItem({ id: 1 })]),
        getMostViewedItems: vi.fn(async () => [
          menuItem({ id: 3, viewCount: 9 }),
          menuItem({ id: 2, viewCount: 5 }),
        ]),
        getHighestRatedItems: vi.fn(async () => [
          menuItem({ id: 3, rating: 5 }),
          menuItem({ id: 2, rating: 3 }),
        ]),
        getRecentlyAddedItems: vi.fn(async () => [
          menuItem({ id: 3, createdAt: "2026-06-03T00:00:00.000Z" }),
          menuItem({ id: 2, createdAt: "2026-06-01T00:00:00.000Z" }),
        ]),
      },
    });

    await expect(service.getPopularityMetrics("rest-1")).resolves.toMatchObject(
      {
        mostOrdered: [{ id: 1 }],
        mostViewed: [{ id: 3, viewCount: 9 }, { id: 2 }],
        highestRated: [{ id: 3, rating: 5 }, { id: 2 }],
        recentlyAdded: [{ id: 3 }, { id: 2 }],
      },
    );

    // The DB-ordered result must be preserved verbatim, not re-sorted.
    expect(dbService.getMostViewedItems).toHaveBeenCalledWith("rest-1", 10);
    expect(dbService.getHighestRatedItems).toHaveBeenCalledWith("rest-1", 10);
    expect(dbService.getRecentlyAddedItems).toHaveBeenCalledWith("rest-1", 10);
    // The take-10-then-sort path is gone.
    expect(dbService.searchMenuItems).not.toHaveBeenCalled();
  });

  it("carries real view and review counts through the transform (#84)", async () => {
    const { service } = createService({
      dbService: {
        getMenuItem: vi.fn(async () =>
          menuItem({ viewCount: 42, reviewCount: 7 }),
        ),
      },
    });

    // transformMenuItem used to hardcode `viewCount: 0, reviewCount: 0`, so the
    // values incrementViewCount had been writing were invisible to every read.
    await expect(service.getMenuItem(101)).resolves.toMatchObject({
      viewCount: 42,
      reviewCount: 7,
    });
  });

  it("defaults view and review counts when the row predates the columns", async () => {
    const { service } = createService({
      dbService: {
        getMenuItem: vi.fn(async () =>
          menuItem({ viewCount: undefined, reviewCount: undefined }),
        ),
      },
    });

    await expect(service.getMenuItem(101)).resolves.toMatchObject({
      viewCount: 0,
      reviewCount: 0,
    });
  });
});
