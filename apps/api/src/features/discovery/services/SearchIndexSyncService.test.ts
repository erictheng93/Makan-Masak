import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categories,
  dishSearchIndex,
  menuItems,
  restaurantMarketMemberships,
  restaurants,
} from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";

/**
 * Select fixtures are keyed by table, not by call order: `from(table)`
 * decides which queue a query draws from, so adding a query against one
 * table can no longer shift another table's results out from under it.
 * `select` and `selectDistinct` share one queue per table — `onMenuItem
 * Changed`/`onCategoryChanged`'s `select` reads and `onRestaurantChanged`'s
 * `selectDistinct` read of `dishSearchIndex` all draw from the same
 * per-table queues declared below.
 *
 * Two things still need care when the code under test grows a new query:
 *
 * - Within a single table the queue is positional. The Nth read of a table
 *   takes that table's Nth fixture, so a new query means inserting a
 *   fixture at the matching index rather than appending one at the end.
 * - A table has to be listed in `fixtureTables` before it can be declared.
 *   An unregistered table matches no queue, so every read of it throws.
 *
 * Missing and exhausted fixtures both throw and name the table. Nothing
 * falls back to `[]` or a shared `whereRows` value anymore — the old
 * `selectRows.shift() ?? whereRows` fallback silently handed every
 * unconfigured `select()` call the same rows regardless of which table it
 * queried (and `selectDistinct` silently fell back to `[]`), which is
 * exactly the bug this harness removes.
 *
 * `categories` is imported but deliberately left out of `fixtureTables`:
 * `SearchIndexSyncService` only ever `leftJoin`s it or references it inside
 * a `sql` fragment, never passes it to `from()`, so it has no queue of its
 * own — a real table this service touches, but one whose routing is
 * exercised by the unregistered-table branch of the regression test below.
 *
 * `SearchIndexSyncService` methods have no try/catch, so a harness throw
 * from a missing/exhausted fixture propagates verbatim out of the `await` —
 * no wrapped-message caveat needed here.
 */
const fixtureTables = {
  dishSearchIndex,
  restaurants,
  menuItems,
  restaurantMarketMemberships,
};
type SelectFixtureName = keyof typeof fixtureTables;

// `fakeDb` is built once at module scope, so the queues it reads have to be
// swappable behind it rather than captured at construction.
let fixtureDb = createSelectFixtureDb(fixtureTables);

function mockSelectResults(fixtures: SelectFixtures<SelectFixtureName>) {
  fixtureDb = createSelectFixtureDb(fixtureTables, fixtures);
}

const updateMock = vi.fn();
const deleteMock = vi.fn();
const insertMock = vi.fn();
const updatedRows: unknown[] = [];
const insertedRows: unknown[] = [];
const deletedRows: unknown[] = [];

const fakeDb = {
  select: vi.fn(() => fixtureDb.select()),
  selectDistinct: vi.fn(() => fixtureDb.selectDistinct()),
  delete: deleteMock.mockImplementation(() => ({
    where: vi.fn((condition: unknown) => {
      deletedRows.push(condition);
      return Promise.resolve();
    }),
  })),
  insert: insertMock.mockImplementation(() => ({
    values: vi.fn((payload: unknown) => ({
      onConflictDoUpdate: vi.fn(() => {
        upsertInsertedRow(payload);
        return Promise.resolve();
      }),
      then: (
        resolve: (value: void) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(upsertInsertedRow(payload)).then(resolve, reject),
    })),
  })),
  update: updateMock.mockImplementation(() => {
    const builder = {
      set: vi.fn((payload: unknown) => {
        updatedRows.push(payload);
        return builder;
      }),
      where: vi.fn(() => Promise.resolve()),
    };
    return builder;
  }),
};

function upsertInsertedRow(payload: unknown): void {
  const menuItemId =
    payload && typeof payload === "object"
      ? (payload as { menuItemId?: unknown }).menuItemId
      : undefined;
  if (menuItemId === undefined) {
    insertedRows.push(payload);
    return;
  }
  const existingIndex = insertedRows.findIndex(
    (row) =>
      row &&
      typeof row === "object" &&
      (row as { menuItemId?: unknown }).menuItemId === menuItemId,
  );
  if (existingIndex >= 0) {
    insertedRows[existingIndex] = payload;
    return;
  }
  insertedRows.push(payload);
}

vi.mock("drizzle-orm/d1", () => ({ drizzle: () => fakeDb }));

import { SearchIndexSyncService } from "./SearchIndexSyncService";

function makeKv() {
  return {
    get: vi.fn(() => Promise.resolve(null)),
    put: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  } as unknown as KVNamespace;
}

type QueueBatch = Array<{ body: unknown }>;
function makeQueue() {
  return {
    send: vi.fn((_body: unknown) => Promise.resolve()),
    sendBatch: vi.fn((_batch: QueueBatch) => Promise.resolve()),
  };
}

function menuItemSearchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "  Nasi   Lemak ",
    priceCents: 8050,
    catalogType: null,
    isAvailable: true,
    tags: ["rice", " spicy "],
    keywords: "coconut, breakfast",
    deletedAt: null,
    restaurantId: "restaurant-1",
    categoryName: "Rice",
    categoryActive: true,
    categoryVisible: true,
    categoryDeleted: null,
    district: "Central",
    restaurantType: "malaysian",
    supportsTakeaway: true,
    supportsDelivery: false,
    restaurantActive: true,
    restaurantDeleted: null,
    latitude: 25.1,
    longitude: 121.5,
    marketIds: '["market-1","market-2"]',
    primaryMarketId: "market-1",
    ...overrides,
  };
}

const d1 = {} as unknown as D1Database;

describe("SearchIndexSyncService fan-out queue", () => {
  beforeEach(() => {
    mockSelectResults({});
    updatedRows.length = 0;
    insertedRows.length = 0;
    deletedRows.length = 0;
    vi.useRealTimers();
    updateMock.mockClear();
    deleteMock.mockClear();
    insertMock.mockClear();
  });

  it("onMarketChanged enqueues one restaurant message per member, not inline", async () => {
    mockSelectResults({
      restaurantMarketMemberships: [
        [{ restaurantId: "r1" }, { restaurantId: "r2" }],
      ],
    });
    const queue = makeQueue();
    const kv = makeKv();
    const svc = new SearchIndexSyncService(d1, kv, queue as never);

    await svc.onMarketChanged("market-1");

    expect(queue.sendBatch).toHaveBeenCalledOnce();
    expect(queue.sendBatch).toHaveBeenCalledWith([
      { body: { type: "restaurant", restaurantId: "r1" } },
      { body: { type: "restaurant", restaurantId: "r2" } },
    ]);
    expect(updateMock).not.toHaveBeenCalled();
    expect(kv.put).toHaveBeenCalled();
  });

  it("onCategoryChanged enqueues one menuItem message per item", async () => {
    mockSelectResults({ menuItems: [[{ id: 11 }, { id: 22 }]] });
    const queue = makeQueue();
    const svc = new SearchIndexSyncService(d1, makeKv(), queue as never);

    await svc.onCategoryChanged(5);

    expect(queue.sendBatch).toHaveBeenCalledWith([
      { body: { type: "menuItem", menuItemId: 11 } },
      { body: { type: "menuItem", menuItemId: 22 } },
    ]);
  });

  it("chunks fan-out into batches of at most 100 messages", async () => {
    mockSelectResults({
      restaurantMarketMemberships: [
        Array.from({ length: 150 }, (_, i) => ({
          restaurantId: `r${i}`,
        })),
      ],
    });
    const queue = makeQueue();
    const svc = new SearchIndexSyncService(d1, makeKv(), queue as never);

    await svc.onMarketChanged("market-big");

    expect(queue.sendBatch).toHaveBeenCalledTimes(2);
    expect(queue.sendBatch.mock.calls[0][0]).toHaveLength(100);
    expect(queue.sendBatch.mock.calls[1][0]).toHaveLength(50);
  });

  it("processMessage dispatches to the matching single-entity handler", async () => {
    const svc = new SearchIndexSyncService(d1, makeKv());
    const onRestaurant = vi
      .spyOn(svc, "onRestaurantChanged")
      .mockResolvedValue(undefined);
    const onMenuItem = vi
      .spyOn(svc, "onMenuItemChanged")
      .mockResolvedValue(undefined);

    await svc.processMessage({ type: "restaurant", restaurantId: "r9" });
    await svc.processMessage({ type: "menuItem", menuItemId: 42 });

    expect(onRestaurant).toHaveBeenCalledWith("r9");
    expect(onMenuItem).toHaveBeenCalledWith(42);
  });

  it("without a queue, onMarketChanged stays on the inline path", async () => {
    mockSelectResults({ restaurantMarketMemberships: [[]] });
    const svc = new SearchIndexSyncService(d1, makeKv());

    await expect(svc.onMarketChanged("market-empty")).resolves.toBeUndefined();
  });

  it("removes stale index rows when a changed menu item no longer exists", async () => {
    mockSelectResults({ menuItems: [[]] });
    const kv = makeKv();
    const svc = new SearchIndexSyncService(d1, kv);

    await svc.onMenuItemChanged(42);

    expect(deleteMock).toHaveBeenCalledOnce();
    expect(insertMock).not.toHaveBeenCalled();
    expect(deletedRows).toHaveLength(1);
    expect(kv.put).toHaveBeenCalledWith(
      "search:query:version",
      expect.any(String),
    );
    expect(kv.put).toHaveBeenCalledWith("markets:version", expect.any(String));
  });

  it("denormalizes menu items into the search index with parsed markets and tags", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    mockSelectResults({ menuItems: [[menuItemSearchRow()]] });
    const svc = new SearchIndexSyncService(d1, makeKv());

    await svc.onMenuItemChanged(42);

    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertedRows).toEqual([
      expect.objectContaining({
        menuItemId: 42,
        restaurantId: "restaurant-1",
        dishName: "  Nasi   Lemak ",
        dishNameNormalized: "nasilemak",
        categoryName: "Rice",
        priceCents: 8050,
        catalogType: "menu_item",
        isAvailable: true,
        tags: ["rice", "spicy", "coconut", "breakfast"],
        district: "Central",
        restaurantType: "malaysian",
        supportsTakeaway: true,
        supportsDelivery: false,
        primaryMarketId: "market-1",
        marketIds: ["market-1", "market-2"],
        latitude: 25.1,
        longitude: 121.5,
        updatedAt: new Date("2026-06-07T00:00:00.000Z"),
      }),
    ]);
  });

  it("keeps one search row when the same menu item is synced twice", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    mockSelectResults({
      menuItems: [
        [
          menuItemSearchRow({
            name: "Nasi Lemak",
            tags: [],
            keywords: "",
            marketIds: '["market-1"]',
          }),
        ],
        [
          menuItemSearchRow({
            name: "Nasi Lemak Special",
            priceCents: 9000,
            tags: ["special"],
            keywords: "",
            marketIds: '["market-1"]',
          }),
        ],
      ],
    });
    const svc = new SearchIndexSyncService(d1, makeKv());

    await svc.onMenuItemChanged(42);
    await svc.onMenuItemChanged(42);

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toEqual(
      expect.objectContaining({
        menuItemId: 42,
        dishName: "Nasi Lemak Special",
        dishNameNormalized: "nasilemakspecial",
        priceCents: 9000,
        tags: ["special"],
      }),
    );
  });

  it("marks inactive restaurants unavailable and invalidates affected district caches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    mockSelectResults({
      dishSearchIndex: [[{ district: "Old Town" }]],
      restaurants: [
        [
          {
            district: "Central",
            type: "malaysian",
            supportsTakeaway: true,
            supportsDelivery: true,
            latitude: 25.1,
            longitude: 121.5,
            isActive: false,
            marketIds: null,
            primaryMarketId: null,
            deletedAt: null,
          },
        ],
      ],
    });
    const kv = makeKv();
    const svc = new SearchIndexSyncService(d1, kv);

    await svc.onRestaurantChanged("restaurant-1", {
      previousDistrict: "Previous",
    });

    expect(updatedRows).toEqual([
      {
        isAvailable: false,
        updatedAt: new Date("2026-06-07T00:00:00.000Z"),
      },
    ]);
    expect(kv.delete).toHaveBeenCalledWith(
      "search:restaurants:hours2:district:Old Town",
    );
    expect(kv.delete).toHaveBeenCalledWith(
      "search:restaurants:hours2:district:Previous",
    );
    expect(kv.delete).toHaveBeenCalledWith(
      "search:restaurants:hours2:district:Central",
    );
    expect(kv.put).toHaveBeenCalledWith(
      "search:query:version",
      expect.any(String),
    );
  });

  it("routes select fixtures by table and reports missing fixtures", async () => {
    mockSelectResults({
      dishSearchIndex: [[{ district: "Old Town" }]],
      restaurants: [[{ district: "Central" }]],
    });

    // Read in reverse declaration order: routing follows the table passed to
    // from(), not the execution order.
    await expect(fakeDb.select().from(restaurants)).resolves.toEqual([
      { district: "Central" },
    ]);
    await expect(fakeDb.select().from(dishSearchIndex)).resolves.toEqual([
      { district: "Old Town" },
    ]);
    await expect(fakeDb.select().from(dishSearchIndex)).rejects.toThrow(
      "No select fixtures remaining for dishSearchIndex",
    );
    // categories is never passed to from() in SearchIndexSyncService (only
    // leftJoin'd or referenced inside a sql fragment), so it is not
    // registered in fixtureTables and reports <unknown table>.
    await expect(fakeDb.select().from(categories)).rejects.toThrow(
      "Missing select fixture for <unknown table>",
    );
  });
});
