import { describe, expect, it, vi } from "vitest";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { categories, menuItems } from "../schema";
import {
  mapDatabaseMenuItem,
  mapMenuCategoryRow,
  MenuService,
  menuItemSelectColumns,
} from "./menu";

function createServiceWithDb<TDb extends object>(db: TDb): MenuService {
  const service = new MenuService({} as D1Database, {
    JWT_SECRET: "test",
  });
  (service as unknown as { db: TDb }).db = db;
  return service;
}

function createQuery(result: unknown, capturedWhere: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    where: vi.fn((condition: unknown) => {
      capturedWhere.push(condition);
      return builder;
    }),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    then: (
      resolve: (value: unknown) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

/**
 * Same shape as createQuery, but also records what was handed to orderBy/limit.
 * The Top-N regression (#84) is precisely about those two calls existing at all,
 * so a harness that swallows their arguments cannot catch it.
 */
function createRankingQuery(
  result: unknown,
  captured: {
    where: unknown[];
    orderBy: unknown[][];
    limit: number[];
  },
) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    where: vi.fn((condition: unknown) => {
      captured.where.push(condition);
      return builder;
    }),
    orderBy: vi.fn((...args: unknown[]) => {
      captured.orderBy.push(args);
      return builder;
    }),
    limit: vi.fn((value: number) => {
      captured.limit.push(value);
      return builder;
    }),
    offset: vi.fn(() => builder),
    groupBy: vi.fn(() => builder),
    then: (
      resolve: (value: unknown) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function collectSqlMetadata(input: unknown): {
  columns: string[];
  numbers: number[];
} {
  const columns: string[] = [];
  const numbers: number[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "number") {
      numbers.push(value);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const maybeColumn = value as {
      columnType?: unknown;
      name?: unknown;
      queryChunks?: unknown[];
    };
    if (
      typeof maybeColumn.columnType === "string" &&
      typeof maybeColumn.name === "string"
    ) {
      columns.push(maybeColumn.name);
      return;
    }
    if (Array.isArray(maybeColumn.queryChunks)) {
      maybeColumn.queryChunks.forEach(visit);
    }
  };
  visit(input);
  return { columns, numbers };
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

const MENU_ITEM_OUTPUT_ALIASES: Record<string, string> = {
  price: "priceCents",
  originalPrice: "originalPriceCents",
  costPrice: "costPriceCents",
};

function mappedMenuItemColumnKeys(row: Record<string, unknown>): string[] {
  return Object.keys(mapDatabaseMenuItem(row)).map(
    (key) => MENU_ITEM_OUTPUT_ALIASES[key] ?? key,
  );
}

function rowWithTimestamps(columns: string[]): Record<string, unknown> {
  return {
    ...Object.fromEntries(columns.map((column) => [column, column])),
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
    updatedAt: new Date("2026-08-12T01:00:00.000Z"),
  };
}

describe("MenuService projection drift guards", () => {
  const menuItemColumns = Object.keys(getTableColumns(menuItems));
  const categoryColumns = Object.keys(getTableColumns(categories));

  it("keeps shared menu item select columns explicit for every DB column", () => {
    expect(
      findUncoveredProjectionColumns(
        menuItemColumns,
        Object.keys(menuItemSelectColumns),
        ["deletedAt"],
      ),
    ).toEqual([]);
  });

  it("keeps mapDatabaseMenuItem explicit for every DB column", () => {
    const row = rowWithTimestamps(menuItemColumns);

    expect(
      findUncoveredProjectionColumns(
        menuItemColumns,
        mappedMenuItemColumnKeys(row),
        ["deletedAt"],
      ),
    ).toEqual([]);
  });

  it("keeps getMenu category mapping explicit for every surfaced DB column", () => {
    const row = rowWithTimestamps(categoryColumns);
    const mapped = mapMenuCategoryRow({
      ...row,
      isActive: true,
      isVisible: true,
      menuItems: [],
    });

    expect(
      findUncoveredProjectionColumns(categoryColumns, Object.keys(mapped), [
        "iconUrl",
        "availableHours",
        "deletedAt",
      ]),
    ).toEqual([]);
  });

  it("fails closed when a new DB column is neither projected nor exempted", () => {
    const futureColumn = "__futureColumn";
    const subjects = [
      {
        tableColumns: [...menuItemColumns, futureColumn],
        projectedColumns: Object.keys(menuItemSelectColumns),
        exemptColumns: ["deletedAt"],
      },
      {
        tableColumns: [...menuItemColumns, futureColumn],
        projectedColumns: mappedMenuItemColumnKeys(
          rowWithTimestamps(menuItemColumns),
        ),
        exemptColumns: ["deletedAt"],
      },
      {
        tableColumns: [...categoryColumns, futureColumn],
        projectedColumns: Object.keys(
          mapMenuCategoryRow({
            ...rowWithTimestamps(categoryColumns),
            isActive: true,
            isVisible: true,
            menuItems: [],
          }),
        ),
        exemptColumns: ["iconUrl", "availableHours", "deletedAt"],
      },
    ];

    for (const subject of subjects) {
      expect(
        findUncoveredProjectionColumns(
          subject.tableColumns,
          subject.projectedColumns,
          subject.exemptColumns,
        ),
      ).toContain(futureColumn);
    }
  });
});

describe("menu DTO timestamps", () => {
  it("serializes database timestamps to the shared DTO contract", () => {
    const createdAt = new Date("2026-08-12T00:00:00.000Z");
    const updatedAt = new Date("2026-08-12T01:00:00.000Z");
    const categoryColumns = Object.keys(getTableColumns(categories));
    const menuItemColumns = Object.keys(getTableColumns(menuItems));

    const category = mapMenuCategoryRow({
      ...rowWithTimestamps(categoryColumns),
      isActive: true,
      isVisible: true,
      menuItems: [],
      createdAt,
      updatedAt,
    });
    const item = mapDatabaseMenuItem({
      ...rowWithTimestamps(menuItemColumns),
      createdAt,
      updatedAt,
    });

    expect(category.createdAt).toBe(createdAt.getTime());
    expect(category.updatedAt).toBe(updatedAt.getTime());
    expect(item.createdAt).toBe(createdAt.getTime());
    expect(item.updatedAt).toBe(updatedAt.getTime());
  });
});

describe("MenuService money filters", () => {
  it("filters price ranges against authoritative cents", async () => {
    const capturedWhere: unknown[] = [];
    const results = [[], [{ totalCount: 0 }]];
    const db = {
      select: vi.fn(() => createQuery(results.shift() ?? [], capturedWhere)),
    };
    const service = createServiceWithDb(db);

    await service.searchMenuItems(
      "restaurant-1",
      { priceRange: [100, 300] },
      1,
      20,
    );

    const priceRangeCondition = capturedWhere[0];
    const metadata = collectSqlMetadata(priceRangeCondition);
    expect(metadata.columns).toContain("price_cents");
    expect(metadata.columns).not.toContain("price");
    expect(metadata.numbers).toEqual(expect.arrayContaining([10000, 30000]));
  });
});

/**
 * Bound parameter values (drizzle `Param` nodes) reachable from a condition.
 * collectSqlMetadata only picks up numbers written inline in a `sql` template,
 * which is not how eq()/gt() encode their right-hand side.
 */
function collectBoundParams(input: unknown): unknown[] {
  const values: unknown[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as { value?: unknown; queryChunks?: unknown[] };
    if ("value" in node && !Array.isArray(node.queryChunks)) {
      values.push(node.value);
    }
    if (Array.isArray(node.queryChunks)) {
      node.queryChunks.forEach(visit);
    }
  };
  visit(input);
  return values;
}

function assertSelfAssignsUpdatedAtInGeneratedSql(
  query: { toSQL: () => { sql: string; params: unknown[] } },
  expectedParams: unknown[],
) {
  const generated = query.toSQL();

  expect(generated.sql).toContain(
    '"updated_at_ms" = "menu_items"."updated_at_ms"',
  );
  expect(generated.sql).not.toContain('"updated_at_ms" = ?');
  expect(generated.params).toEqual(expectedParams);
}

/**
 * Regression coverage for #84.
 *
 * The API layer used to build these three lists by taking a page of
 * searchMenuItems() results (ordered by isFeatured/orderCount/sortOrder) and
 * re-sorting them in JS, so a menu with more than `limit` items ranked the
 * wrong candidate set. These assert the ordering and the limit are actually in
 * the SQL, that `rating > 0` is a WHERE clause rather than a post-slice filter,
 * and that the customer-facing category gate is still applied.
 */
describe("MenuService top-N rankings", () => {
  function buildRankingService(rows: unknown[] = []) {
    const captured = {
      where: [] as unknown[],
      orderBy: [] as unknown[][],
      limit: [] as number[],
    };
    const db = {
      select: vi.fn(() => createRankingQuery(rows, captured)),
    };
    return { service: createServiceWithDb(db), captured, db };
  }

  it("orders most-viewed items by view count in SQL and limits there", async () => {
    const { service, captured, db } = buildRankingService();

    await service.getMostViewedItems("restaurant-1", 5);

    expect(db.select).toHaveBeenCalledOnce();
    expect(captured.limit).toEqual([5]);
    expect(collectSqlMetadata(captured.orderBy[0]).columns).toEqual([
      "view_count",
      "order_count",
    ]);
    // Customer-facing list: the category visibility gate must still be there.
    const whereColumns = collectSqlMetadata(captured.where[0]).columns;
    expect(whereColumns).toEqual(
      expect.arrayContaining([
        "is_available",
        "is_active",
        "is_visible",
        "deleted_at_ms",
      ]),
    );
  });

  it("filters rating > 0 in SQL so the limit is honoured", async () => {
    const { service, captured } = buildRankingService();

    await service.getHighestRatedItems("restaurant-1", 3);

    expect(captured.limit).toEqual([3]);
    expect(collectSqlMetadata(captured.orderBy[0]).columns).toEqual([
      "rating",
      "review_count",
    ]);
    // rating appears in the WHERE clause, not only in the ORDER BY — the old
    // code filtered rating > 0 *after* slicing 10 rows, so the list silently
    // came back short.
    expect(collectSqlMetadata(captured.where[0]).columns).toContain("rating");
    expect(collectBoundParams(captured.where[0])).toContain(0);
  });

  it("orders recently added items by creation time in SQL", async () => {
    const { service, captured } = buildRankingService();

    await service.getRecentlyAddedItems("restaurant-1", 4);

    expect(captured.limit).toEqual([4]);
    expect(collectSqlMetadata(captured.orderBy[0]).columns).toEqual([
      "created_at_ms",
      "id",
    ]);
  });

  it("maps view and review counts onto the returned items", async () => {
    const { service } = buildRankingService([
      {
        id: 101,
        restaurantId: "restaurant-1",
        categoryId: 7,
        name: "Laksa",
        priceCents: 18000,
        viewCount: 42,
        reviewCount: 7,
        rating: 4.5,
        createdAt: new Date("2026-08-12T00:00:00.000Z"),
        updatedAt: new Date("2026-08-12T01:00:00.000Z"),
      },
    ]);

    await expect(
      service.getMostViewedItems("restaurant-1", 5),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 101,
        viewCount: 42,
        reviewCount: 7,
        rating: 4.5,
      }),
    ]);
  });
});

/**
 * Regression coverage for #153.
 *
 * Engagement counters are written from public/customer flows. They must not
 * advance updated_at_ms, because the API uses that column as the optimistic-lock
 * version for owner edits.
 */
describe("MenuService engagement counters", () => {
  function buildCounterService() {
    const capturedSet: Record<string, unknown>[] = [];
    const capturedWhere: unknown[] = [];
    const updateBuilder = {
      set: vi.fn((values: Record<string, unknown>) => {
        capturedSet.push(values);
        return updateBuilder;
      }),
      where: vi.fn((condition: unknown) => {
        capturedWhere.push(condition);
        return updateBuilder;
      }),
    };
    const db = { update: vi.fn(() => updateBuilder) };
    return {
      service: createServiceWithDb(db),
      capturedSet,
      capturedWhere,
      db,
    };
  }

  it("increments view count without changing the optimistic-lock timestamp", async () => {
    const { service, capturedSet, capturedWhere, db } = buildCounterService();

    await service.incrementViewCount(101);

    expect(db.update).toHaveBeenCalledWith(menuItems);
    expect(capturedSet[0]).toHaveProperty("viewCount");
    expect(capturedSet[0]).toHaveProperty("updatedAt");
    expect(collectSqlMetadata(capturedSet[0].updatedAt).columns).toEqual([
      "updated_at_ms",
    ]);
    expect(collectSqlMetadata(capturedWhere[0]).columns).toContain("id");
    expect(collectBoundParams(capturedWhere[0])).toContain(101);
  });

  it("pins generated view-count SQL to the existing timestamp column", () => {
    const db = drizzle({} as D1Database);
    const query = db
      .update(menuItems)
      .set({
        viewCount: sql`${menuItems.viewCount} + 1`,
        updatedAt: sql`${menuItems.updatedAt}`,
      })
      .where(eq(menuItems.id, 101));

    assertSelfAssignsUpdatedAtInGeneratedSql(query, [101]);
  });

  it("increments order count without changing the optimistic-lock timestamp", async () => {
    const { service, capturedSet, capturedWhere, db } = buildCounterService();

    await service.incrementOrderCount(101, 3);

    expect(db.update).toHaveBeenCalledWith(menuItems);
    expect(capturedSet[0]).toHaveProperty("orderCount");
    expect(capturedSet[0]).toHaveProperty("updatedAt");
    expect(collectSqlMetadata(capturedSet[0].updatedAt).columns).toEqual([
      "updated_at_ms",
    ]);
    expect(collectSqlMetadata(capturedWhere[0]).columns).toContain("id");
    expect(collectBoundParams(capturedWhere[0])).toContain(101);
  });

  it("pins generated order-count SQL to the existing timestamp column", () => {
    const db = drizzle({} as D1Database);
    const query = db
      .update(menuItems)
      .set({
        orderCount: sql`${menuItems.orderCount} + ${3}`,
        updatedAt: sql`${menuItems.updatedAt}`,
      })
      .where(eq(menuItems.id, 101));

    assertSelfAssignsUpdatedAtInGeneratedSql(query, [3, 101]);
  });
});

/**
 * Regression coverage for #83.
 *
 * `includeUnavailable` only ever relaxed the *item* filter; the category filter
 * stayed at isActive AND isVisible AND not-deleted. Setting a category
 * isVisible:false therefore removed the category and all of its items from the
 * owner's own dashboard, which reads this exact endpoint with includeAll=true,
 * and the dashboard had no control to put it back.
 */
describe("MenuService category visibility", () => {
  interface MenuQueryConfig {
    with: { categories: { where: unknown } };
  }

  function buildMenuService(categoryRows: Record<string, unknown>[]) {
    const capturedConfigs: MenuQueryConfig[] = [];
    const db = {
      select: vi.fn(() => createQuery([], [])),
      query: {
        restaurants: {
          findFirst: vi.fn(async (config: MenuQueryConfig) => {
            capturedConfigs.push(config);
            return { id: "restaurant-1", categories: categoryRows };
          }),
        },
      },
    };
    return { service: createServiceWithDb(db), capturedConfigs, db };
  }

  function categoryRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 7,
      restaurantId: "restaurant-1",
      name: "Noodles",
      nameEn: null,
      description: null,
      sortOrder: 0,
      isActive: true,
      isVisible: true,
      imageUrl: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      menuItems: [],
      ...overrides,
    };
  }

  it("keeps the public read gated on isActive and isVisible", async () => {
    const { service, capturedConfigs, db } = buildMenuService([categoryRow()]);

    await service.getMenu("restaurant-1");

    expect(db.query.restaurants.findFirst).toHaveBeenCalledOnce();
    const columns = collectSqlMetadata(
      capturedConfigs[0].with.categories.where,
    ).columns;
    expect(columns).toEqual(
      expect.arrayContaining(["is_active", "is_visible", "deleted_at_ms"]),
    );
  });

  it("only excludes soft-deleted categories for the admin read", async () => {
    const { service, capturedConfigs } = buildMenuService([categoryRow()]);

    await service.getMenu("restaurant-1", { includeUnavailable: true });

    const columns = collectSqlMetadata(
      capturedConfigs[0].with.categories.where,
    ).columns;
    expect(columns).toEqual(["deleted_at_ms"]);
    expect(columns).not.toContain("is_visible");
    expect(columns).not.toContain("is_active");
  });

  it("carries both visibility flags and a live item count to the client", async () => {
    const { service } = buildMenuService([
      categoryRow({
        isVisible: false,
        menuItems: [
          {
            id: 1,
            restaurantId: "restaurant-1",
            categoryId: 7,
            name: "A",
            createdAt: new Date("2026-08-12T00:00:00.000Z"),
            updatedAt: new Date("2026-08-12T01:00:00.000Z"),
          },
          {
            id: 2,
            restaurantId: "restaurant-1",
            categoryId: 7,
            name: "B",
            createdAt: new Date("2026-08-12T00:00:00.000Z"),
            updatedAt: new Date("2026-08-12T01:00:00.000Z"),
          },
        ],
      }),
    ]);

    const menu = await service.getMenu("restaurant-1", {
      includeUnavailable: true,
    });

    expect(menu.categories).toEqual([
      expect.objectContaining({
        id: 7,
        isActive: true,
        isVisible: false,
        // Derived from the loaded rows, not from a stored counter (#84).
        itemCount: 2,
      }),
    ]);
  });
});

/**
 * Regression coverage for #85.
 *
 * The CSV importer used to POST one item per row from the browser, so a batch
 * that failed on row 7 left rows 1-6 committed and a retry duplicated them
 * (the menu has no name uniqueness). D1 has no db.transaction(), so atomicity
 * here means one db.batch() — and one statement per row, because D1 caps bound
 * parameters per query at 100.
 */
describe("MenuService bulk create", () => {
  function buildBulkService(batchResult: unknown) {
    const statements: unknown[] = [];
    const insertedValues: Record<string, unknown>[] = [];
    let statementId = 0;
    const insertBuilder = {
      values: vi.fn((data: Record<string, unknown>) => {
        insertedValues.push(data);
        return insertBuilder;
      }),
      returning: vi.fn(() => ({ statement: statementId++ })),
    };
    const batch = vi.fn(async (given: unknown[]) => {
      statements.push(...given);
      return batchResult;
    });
    const db = { insert: vi.fn(() => insertBuilder), batch };
    const service = createServiceWithDb(db);
    const invalidateCache = vi
      .spyOn(
        service as unknown as { invalidateCache: () => void },
        "invalidateCache",
      )
      .mockResolvedValue(undefined);
    return { service, db, batch, statements, insertedValues, invalidateCache };
  }

  function row(index: number) {
    return {
      restaurantId: "restaurant-1",
      categoryId: 7,
      name: `Item ${index}`,
      price: 10 + index,
    };
  }

  it("sends every row through a single batch and maps the returned items", async () => {
    const { service, batch, statements, insertedValues, invalidateCache } =
      buildBulkService([
        [
          {
            id: 300,
            restaurantId: "restaurant-1",
            categoryId: 7,
            name: "Item 0",
            priceCents: 1000,
            createdAt: new Date("2026-08-12T00:00:00.000Z"),
            updatedAt: new Date("2026-08-12T01:00:00.000Z"),
          },
        ],
        [
          {
            id: 301,
            restaurantId: "restaurant-1",
            categoryId: 7,
            name: "Item 1",
            priceCents: 1001,
            createdAt: new Date("2026-08-12T00:00:00.000Z"),
            updatedAt: new Date("2026-08-12T01:00:00.000Z"),
          },
        ],
        [
          {
            id: 302,
            restaurantId: "restaurant-1",
            categoryId: 7,
            name: "Item 2",
            priceCents: 1002,
            createdAt: new Date("2026-08-12T00:00:00.000Z"),
            updatedAt: new Date("2026-08-12T01:00:00.000Z"),
          },
        ],
      ]);

    const created = await service.bulkCreateMenuItems([row(0), row(1), row(2)]);

    expect(batch).toHaveBeenCalledOnce();
    expect(statements).toHaveLength(3);
    expect(created).toEqual([
      expect.objectContaining({ id: 300, price: 10 }),
      expect.objectContaining({ id: 301 }),
      expect.objectContaining({ id: 302 }),
    ]);
    // Money still goes in as authoritative cents, and the create-time flag
    // defaults are the same ones createMenuItem applies.
    expect(insertedValues[0]).toEqual(
      expect.objectContaining({
        priceCents: 1000,
        isAvailable: true,
        isFeatured: false,
        isPopular: false,
      }),
    );
    expect(insertedValues[0]).not.toHaveProperty("price");
    // One invalidation for the one restaurant in the batch, not one per row.
    expect(invalidateCache).toHaveBeenCalledOnce();
    expect(invalidateCache).toHaveBeenCalledWith(
      ["menu:restaurant-1", "restaurant:restaurant-1"],
      "tag",
    );
  });

  it("touches nothing for an empty batch", async () => {
    const { service, db, batch, invalidateCache } = buildBulkService([]);

    await expect(service.bulkCreateMenuItems([])).resolves.toEqual([]);
    expect(db.insert).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("rejects a batch result with the wrong statement count", async () => {
    const { service, invalidateCache } = buildBulkService([
      [
        {
          id: 300,
          restaurantId: "restaurant-1",
          categoryId: 7,
          name: "Item 0",
          priceCents: 1000,
        },
      ],
    ]);

    await expect(service.bulkCreateMenuItems([row(0), row(1)])).rejects.toThrow(
      "Unexpected db.batch returning shape for bulkCreateMenuItems",
    );
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("rejects a batch result whose statement output is not a row array", async () => {
    const { service, invalidateCache } = buildBulkService([
      {
        id: 300,
        restaurantId: "restaurant-1",
        categoryId: 7,
        name: "Item 0",
        priceCents: 1000,
      },
    ]);

    await expect(service.bulkCreateMenuItems([row(0)])).rejects.toThrow(
      "Unexpected db.batch returning shape for bulkCreateMenuItems",
    );
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("rejects a batch result with an empty returning row set", async () => {
    const { service, invalidateCache } = buildBulkService([[]]);

    await expect(service.bulkCreateMenuItems([row(0)])).rejects.toThrow(
      "Unexpected db.batch returning shape for bulkCreateMenuItems",
    );
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("scopes the category ownership lookup to the restaurant and excludes deleted rows", async () => {
    const capturedWhere: unknown[] = [];
    const db = {
      select: vi.fn(() => createQuery([{ id: 7 }, { id: 8 }], capturedWhere)),
    };
    const service = createServiceWithDb(db);

    await expect(
      service.findOwnedCategoryIds("restaurant-1", [7, 8, 99]),
    ).resolves.toEqual(new Set([7, 8]));

    const columns = collectSqlMetadata(capturedWhere[0]).columns;
    expect(columns).toEqual(
      expect.arrayContaining(["restaurant_id", "id", "deleted_at_ms"]),
    );
    // No query at all when there is nothing to check.
    await expect(
      service.findOwnedCategoryIds("restaurant-1", []),
    ).resolves.toEqual(new Set());
    expect(db.select).toHaveBeenCalledOnce();
  });
});

/**
 * Regression coverage for #80.
 *
 * Deletion used to write `sortOrder: -1` while `deleted_at_ms` sat unwritten,
 * so deleted items still counted in every reader that didn't know the
 * convention — most visibly deleteCategory's item check, which permanently
 * refused to delete an emptied category. Deletion now writes deleted_at_ms and
 * item reads filter on it.
 */
describe("MenuService soft delete", () => {
  function buildDeleteService(returnedRows: Record<string, unknown>[]) {
    const capturedSet: Record<string, unknown>[] = [];
    const capturedWhere: unknown[] = [];
    const updateBuilder = {
      set: vi.fn((values: Record<string, unknown>) => {
        capturedSet.push(values);
        return updateBuilder;
      }),
      where: vi.fn((condition: unknown) => {
        capturedWhere.push(condition);
        return updateBuilder;
      }),
      returning: vi.fn(async () => returnedRows),
    };
    const db = {
      update: vi.fn(() => updateBuilder),
      delete: vi.fn(() => ({ where: vi.fn(() => []) })),
      batch: vi.fn(async (statements: unknown[]) => Promise.all(statements)),
    };
    const service = createServiceWithDb(db);
    const invalidateCache = vi
      .spyOn(
        service as unknown as { invalidateCache: () => void },
        "invalidateCache",
      )
      .mockResolvedValue(undefined);
    return { service, capturedSet, capturedWhere, invalidateCache };
  }

  it("writes deletedAt (not sortOrder) and invalidates the menu cache", async () => {
    const { service, capturedSet, capturedWhere, invalidateCache } =
      buildDeleteService([{ id: 101, restaurantId: "restaurant-1" }]);

    await expect(service.softDeleteMenuItem(101)).resolves.toBe(true);

    expect(capturedSet[0]).toEqual(
      expect.objectContaining({
        deletedAt: expect.any(Date),
        isAvailable: false,
      }),
    );
    // The retired convention must not come back.
    expect(capturedSet[0]).not.toHaveProperty("sortOrder");
    // Guarded on deleted_at_ms IS NULL, so a double delete keeps the original
    // timestamp instead of moving it.
    expect(collectSqlMetadata(capturedWhere[0]).columns).toEqual(
      expect.arrayContaining(["id", "deleted_at_ms"]),
    );
    expect(invalidateCache).toHaveBeenCalledWith(
      ["menu:restaurant-1", "restaurant:restaurant-1"],
      "tag",
    );
  });

  it("returns false when the row is missing or already deleted", async () => {
    const { service, invalidateCache } = buildDeleteService([]);

    await expect(service.softDeleteMenuItem(404)).resolves.toBe(false);
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("excludes soft-deleted items from item reads", async () => {
    const capturedWhere: unknown[] = [];
    const db = {
      select: vi.fn(() => createQuery([], capturedWhere)),
    };
    const service = createServiceWithDb(db);

    await service.searchMenuItems("restaurant-1", {}, 1, 20);

    expect(collectSqlMetadata(capturedWhere[0]).columns).toContain(
      "deleted_at_ms",
    );
  });

  it("excludes soft-deleted items from category item counts", async () => {
    const capturedWhere: unknown[] = [];
    const groupResult = [{ categoryId: 7, itemCount: 2 }];
    const builder = createQuery(groupResult, capturedWhere) as Record<
      string,
      unknown
    >;
    builder.groupBy = vi.fn(() => builder);
    const db = { select: vi.fn(() => builder) };
    const service = createServiceWithDb(db);

    await expect(service.countItemsByCategory("restaurant-1")).resolves.toEqual(
      new Map([[7, 2]]),
    );
    // Counting deleted rows is what produced the "itemCount says 2, the list
    // is empty" contradiction in the dashboard.
    expect(collectSqlMetadata(capturedWhere[0]).columns).toContain(
      "deleted_at_ms",
    );
  });
});

describe("MenuService image ownership", () => {
  it("round-trips imageId through create, update, and read mappers", async () => {
    const insertedItem = {
      id: 101,
      restaurantId: "restaurant-1",
      categoryId: 7,
      catalogType: "menu_item",
      name: "Laksa",
      description: null,
      ingredients: null,
      priceCents: 18000,
      originalPriceCents: null,
      imageUrl: null,
      imageId: "01940000-0000-7000-8000-000000000001",
      imageVariants: null,
      isAvailable: true,
      isFeatured: false,
      isPopular: false,
      sortOrder: 0,
      inventoryCount: null,
      spiceLevel: 0,
      preparationTime: 15,
      calories: null,
      dietaryInfo: null,
      allergens: null,
      options: null,
      orderCount: 0,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    };
    const updatedItem = {
      ...insertedItem,
      imageId: "01940000-0000-7000-8000-000000000002",
    };
    const getItem = {
      ...updatedItem,
      imageId: "01940000-0000-7000-8000-000000000003",
    };
    const capturedWrites: unknown[] = [];
    const createBuilder = {
      values: vi.fn((data: unknown) => {
        capturedWrites.push(data);
        return createBuilder;
      }),
      returning: vi.fn(async () => [insertedItem]),
    };
    const updateBuilder = {
      set: vi.fn((data: unknown) => {
        capturedWrites.push(data);
        return updateBuilder;
      }),
      where: vi.fn(() => updateBuilder),
      returning: vi.fn(async () => [updatedItem]),
    };
    const selectBuilder = {
      from: vi.fn(() => selectBuilder),
      innerJoin: vi.fn(() => selectBuilder),
      where: vi.fn(() => selectBuilder),
      orderBy: vi.fn(() => selectBuilder),
      limit: vi.fn(async () => [getItem]),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve([]).then(resolve, reject),
    };
    const db = {
      insert: vi.fn(() => createBuilder),
      update: vi.fn(() => updateBuilder),
      select: vi.fn(() => selectBuilder),
      query: {
        menuItems: {
          findFirst: vi.fn(async () => getItem),
        },
      },
    };
    const service = createServiceWithDb(db);
    // createMenuItem used to also write categories.item_count here. That column
    // is gone (#84) — counts are derived live — so there is nothing to stub.
    vi.spyOn(
      service as unknown as { invalidateCache: () => void },
      "invalidateCache",
    ).mockResolvedValue(undefined);

    await expect(
      service.createMenuItem({
        restaurantId: "restaurant-1",
        categoryId: 7,
        name: "Laksa",
        price: 180,
        imageId: insertedItem.imageId,
      }),
    ).resolves.toMatchObject({ imageId: insertedItem.imageId });
    await expect(
      service.updateMenuItem(101, { imageId: updatedItem.imageId }),
    ).resolves.toMatchObject({ imageId: updatedItem.imageId });
    await expect(service.getMenuItem(101)).resolves.toMatchObject({
      imageId: getItem.imageId,
    });
    expect(capturedWrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ imageId: insertedItem.imageId }),
        expect.objectContaining({ imageId: updatedItem.imageId }),
      ]),
    );
  });
});

describe("MenuService menu item metadata", () => {
  it("preserves tags and keywords when mapping an existing item", () => {
    const service = createServiceWithDb({});
    const mapped = (
      service as unknown as {
        mapToMenuItem: (item: unknown) => {
          tags?: string[];
          keywords?: string;
        };
      }
    ).mapToMenuItem({
      id: 1,
      restaurantId: "restaurant-1",
      categoryId: 1,
      name: "Laksa",
      priceCents: 1800,
      tags: ["spicy"],
      keywords: "noodle,coconut",
      createdAt: new Date("2026-08-12T00:00:00.000Z"),
      updatedAt: new Date("2026-08-12T01:00:00.000Z"),
    });

    expect(mapped).toMatchObject({
      tags: ["spicy"],
      keywords: "noodle,coconut",
    });
  });

  it("writes null values when optional menu item fields are cleared", async () => {
    const updateBuilder = {
      set: vi.fn(() => updateBuilder),
      where: vi.fn(() => updateBuilder),
      returning: vi.fn(async () => [
        {
          id: 1,
          restaurantId: "restaurant-1",
          categoryId: 1,
          name: "Laksa",
          priceCents: 1800,
          originalPriceCents: null,
          createdAt: new Date("2026-08-12T00:00:00.000Z"),
          updatedAt: new Date("2026-08-12T01:00:00.000Z"),
        },
      ]),
    };
    const service = createServiceWithDb({ update: vi.fn(() => updateBuilder) });
    vi.spyOn(
      service as unknown as { invalidateCache: () => Promise<void> },
      "invalidateCache",
    ).mockResolvedValue(undefined);

    await service.updateMenuItem(1, {
      originalPrice: null,
      calories: null,
      ingredients: null,
      keywords: null,
      options: null,
    });

    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        originalPriceCents: null,
        calories: null,
        ingredients: null,
        keywords: null,
        options: null,
      }),
    );
  });
});
