import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categories,
  menuItems,
  platformMenuMappings,
  restaurants,
} from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import type { Env } from "../../../types/env";
import { PlatformMenuSyncService } from "./PlatformMenuSyncService";

const mocks = vi.hoisted(() => ({
  adapter: {
    syncMenu: vi.fn(),
  },
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
  integrationService: {
    getDecryptedCredentials: vi.fn(),
  },
  loadAssembledMenuItemOptions: vi.fn(),
}));

vi.mock("@makanmasak/database", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createDatabase: vi.fn(() => mocks.db),
  loadAssembledMenuItemOptions: mocks.loadAssembledMenuItemOptions,
}));

vi.mock("../adapters/PlatformAdapter", () => ({
  getAdapter: vi.fn(() => mocks.adapter),
}));

vi.mock("./PlatformIntegrationService", () => ({
  PlatformIntegrationService: vi.fn(function PlatformIntegrationService() {
    return mocks.integrationService;
  }),
}));

const fixtureTables = {
  categories,
  menuItems,
  platformMenuMappings,
  restaurants,
};
type SelectFixtureName = keyof typeof fixtureTables;

function queueSelectResults(fixtures: SelectFixtures<SelectFixtureName>) {
  Object.assign(mocks.db, createSelectFixtureDb(fixtureTables, fixtures));
}

function mockMutations() {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];

  mocks.db.insert.mockImplementation(() => ({
    values: vi.fn((payload: unknown) => {
      inserted.push(payload);
      return Promise.resolve();
    }),
  }));

  mocks.db.update.mockImplementation(() => {
    const builder = {
      set: vi.fn((payload: unknown) => {
        updated.push(payload);
        return builder;
      }),
      where: vi.fn(() => Promise.resolve()),
    };
    return builder;
  });

  return { inserted, updated };
}

function createService() {
  return new PlatformMenuSyncService({
    DB: { binding: "db" },
  } as unknown as Env);
}

describe("PlatformMenuSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    mocks.integrationService.getDecryptedCredentials.mockResolvedValue({
      accessToken: "token-1",
      storeId: "store-1",
    });
    mocks.adapter.syncMenu.mockResolvedValue({
      success: true,
      syncedItems: 2,
      platformItemIds: {
        101: "platform-101",
        102: "platform-102",
      },
    });
    mocks.loadAssembledMenuItemOptions.mockResolvedValue(new Map());
  });

  it("syncs active menu items and upserts returned platform mappings", async () => {
    const mutations = mockMutations();
    queueSelectResults({
      restaurants: [
        [
          {
            id: "restaurant-1",
            settings: { currency: "MYR" },
            businessHours: {
              monday: { open: "09:00", close: "17:00", isOpen: true },
            },
          },
        ],
      ],
      categories: [
        [
          { id: 1, name: "Noodles" },
          { id: 2, name: "Drinks" },
        ],
      ],
      menuItems: [
        [
          {
            id: 101,
            categoryId: 1,
            name: "Laksa",
            description: null,
            imageUrl: null,
            isAvailable: true,
            priceCents: 18000,
          },
          {
            id: 102,
            categoryId: 2,
            name: "Tea",
            description: "Cold tea",
            imageUrl: "https://cdn.example.test/tea.jpg",
            isAvailable: true,
            priceCents: 6000,
          },
        ],
      ],
      platformMenuMappings: [[{ id: 901 }], []],
    });

    await expect(
      createService().syncMenu("restaurant-1", "uber_eats"),
    ).resolves.toBeUndefined();

    expect(
      mocks.integrationService.getDecryptedCredentials,
    ).toHaveBeenCalledWith("restaurant-1", "uber_eats");
    expect(mocks.adapter.syncMenu).toHaveBeenCalledWith(
      {
        restaurantId: "restaurant-1",
        currencyCode: "MYR",
        serviceAvailability: [
          {
            day_of_week: "monday",
            time_periods: [{ start_time: "09:00", end_time: "17:00" }],
          },
        ],
        categories: [
          {
            id: 1,
            name: "Noodles",
            items: [
              {
                id: 101,
                name: "Laksa",
                description: "",
                priceCents: 18000,
                imageUrl: undefined,
                available: true,
                modifierGroups: [],
              },
            ],
          },
          {
            id: 2,
            name: "Drinks",
            items: [
              {
                id: 102,
                name: "Tea",
                description: "Cold tea",
                priceCents: 6000,
                imageUrl: "https://cdn.example.test/tea.jpg",
                available: true,
                modifierGroups: [],
              },
            ],
          },
        ],
      },
      { accessToken: "token-1", storeId: "store-1" },
    );

    expect(mutations.updated).toHaveLength(3);
    expect(mutations.updated[0]).toMatchObject({ menuSyncStatus: "syncing" });
    expect(mutations.updated[1]).toMatchObject({
      platformItemId: "platform-101",
    });
    expect(mutations.updated[2]).toMatchObject({
      menuSyncStatus: "success",
      menuSyncError: null,
      lastMenuSyncAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    expect(mutations.inserted).toEqual([
      expect.objectContaining({
        restaurantId: "restaurant-1",
        platform: "uber_eats",
        menuItemId: 102,
        platformItemId: "platform-102",
        createdAt: new Date("2026-06-07T00:00:00.000Z"),
        updatedAt: new Date("2026-06-07T00:00:00.000Z"),
      }),
    ]);
  });

  it("marks menu sync as error and rethrows adapter failures", async () => {
    const mutations = mockMutations();
    queueSelectResults({
      restaurants: [
        [
          {
            id: "restaurant-1",
            settings: { currency: "MYR" },
            businessHours: {
              monday: { open: "09:00", close: "17:00", isOpen: true },
            },
          },
        ],
      ],
      categories: [[{ id: 1, name: "Noodles" }]],
      menuItems: [
        [
          {
            id: 101,
            categoryId: 1,
            name: "Laksa",
            description: "Spicy",
            imageUrl: null,
            isAvailable: true,
            priceCents: 18000,
          },
        ],
      ],
    });
    mocks.adapter.syncMenu.mockRejectedValue(new Error("platform offline"));

    await expect(
      createService().syncMenu("restaurant-1", "uber_eats"),
    ).rejects.toThrow("platform offline");

    expect(mutations.inserted).toHaveLength(0);
    expect(mutations.updated).toHaveLength(2);
    expect(mutations.updated[0]).toMatchObject({ menuSyncStatus: "syncing" });
    expect(mutations.updated[1]).toMatchObject({
      menuSyncStatus: "error",
      menuSyncError: "platform offline",
      updatedAt: new Date("2026-06-07T00:00:00.000Z"),
    });
  });

  it("passes assembled option prices to the Uber menu in integer cents", async () => {
    mockMutations();
    mocks.adapter.syncMenu.mockResolvedValueOnce({
      success: true,
      syncedItems: 1,
      platformItemIds: { 101: "101" },
    });
    mocks.loadAssembledMenuItemOptions.mockResolvedValueOnce(
      new Map([
        [
          101,
          {
            customizations: [
              {
                id: "spice",
                name: "Spice",
                type: "single",
                required: false,
                choices: [{ id: "hot", name: "Hot", priceAdjustment: 1.5 }],
              },
            ],
          },
        ],
      ]),
    );
    queueSelectResults({
      restaurants: [
        [
          {
            settings: { currency: "MYR" },
            businessHours: {
              monday: { open: "09:00", close: "17:00", isOpen: true },
            },
          },
        ],
      ],
      categories: [[{ id: 1, name: "Noodles" }]],
      menuItems: [
        [
          {
            id: 101,
            categoryId: 1,
            name: "Laksa",
            priceCents: 1399,
            isAvailable: true,
          },
        ],
      ],
      platformMenuMappings: [[]],
    });

    await createService().syncMenu("restaurant-1", "uber_eats");

    expect(mocks.adapter.syncMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: [
          {
            id: 1,
            name: "Noodles",
            items: [
              expect.objectContaining({
                priceCents: 1399,
                modifierGroups: [
                  {
                    id: "spice",
                    name: "Spice",
                    required: false,
                    minSelections: 0,
                    maxSelections: 1,
                    modifiers: [
                      {
                        id: "hot",
                        name: "Hot",
                        priceCents: 150,
                        available: undefined,
                      },
                    ],
                  },
                ],
              }),
            ],
          },
        ],
      }),
      expect.anything(),
    );
  });

  it("supports legacy open hours when building service availability", async () => {
    mockMutations();
    mocks.adapter.syncMenu.mockResolvedValueOnce({
      success: true,
      syncedItems: 0,
      platformItemIds: {},
    });
    queueSelectResults({
      restaurants: [
        [
          {
            settings: { currency: "MYR" },
            businessHours: {
              monday: { open: "09:00", close: "17:00", closed: false },
              tuesday: { open: "09:00", close: "17:00", closed: true },
            },
          },
        ],
      ],
      categories: [[]],
      menuItems: [[]],
    });

    await createService().syncMenu("restaurant-1", "uber_eats");
    expect(mocks.adapter.syncMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceAvailability: [
          {
            day_of_week: "monday",
            time_periods: [{ start_time: "09:00", end_time: "17:00" }],
          },
        ],
      }),
      expect.anything(),
    );
  });

  it("excludes hidden or deleted categories and unavailable or deleted items", async () => {
    mockMutations();
    mocks.adapter.syncMenu.mockResolvedValueOnce({
      success: true,
      syncedItems: 1,
      platformItemIds: { 101: "101" },
    });
    queueSelectResults({
      restaurants: [
        [
          {
            settings: { currency: "MYR" },
            businessHours: {
              monday: { open: "09:00", close: "17:00", isOpen: true },
            },
          },
        ],
      ],
      categories: [
        [
          {
            id: 1,
            name: "Public",
            isActive: true,
            isVisible: true,
            deletedAt: null,
          },
          {
            id: 2,
            name: "Hidden",
            isActive: true,
            isVisible: false,
            deletedAt: null,
          },
          {
            id: 3,
            name: "Inactive",
            isActive: false,
            isVisible: true,
            deletedAt: null,
          },
          {
            id: 4,
            name: "Deleted",
            isActive: true,
            isVisible: true,
            deletedAt: new Date(),
          },
        ],
      ],
      menuItems: [
        [
          {
            id: 101,
            categoryId: 1,
            name: "Visible",
            priceCents: 1399,
            isAvailable: true,
            deletedAt: null,
          },
          {
            id: 102,
            categoryId: 1,
            name: "Unavailable",
            priceCents: 1399,
            isAvailable: false,
            deletedAt: null,
          },
          {
            id: 103,
            categoryId: 1,
            name: "Deleted",
            priceCents: 1399,
            isAvailable: true,
            deletedAt: new Date(),
          },
          {
            id: 104,
            categoryId: 2,
            name: "Hidden item",
            priceCents: 1399,
            isAvailable: true,
            deletedAt: null,
          },
        ],
      ],
      platformMenuMappings: [[]],
    });

    await createService().syncMenu("restaurant-1", "uber_eats");
    expect(mocks.loadAssembledMenuItemOptions).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ id: 101 })],
    );
    expect(mocks.adapter.syncMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: [
          expect.objectContaining({
            id: 1,
            items: [expect.objectContaining({ id: 101 })],
          }),
        ],
      }),
      expect.anything(),
    );
  });

  it("rejects an active menu item with no stored price", async () => {
    mockMutations();
    mocks.adapter.syncMenu.mockResolvedValueOnce({
      success: true,
      syncedItems: 1,
      platformItemIds: { 101: "101" },
    });
    queueSelectResults({
      restaurants: [
        [
          {
            settings: { currency: "MYR" },
            businessHours: {
              monday: { open: "09:00", close: "17:00", isOpen: true },
            },
          },
        ],
      ],
      categories: [[{ id: 1, name: "Noodles" }]],
      menuItems: [
        [
          {
            id: 101,
            categoryId: 1,
            name: "Laksa",
            priceCents: null,
            isAvailable: true,
          },
        ],
      ],
      platformMenuMappings: [[]],
    });
    await expect(
      createService().syncMenu("restaurant-1", "uber_eats"),
    ).rejects.toThrow("missing a price");
    expect(mocks.adapter.syncMenu).not.toHaveBeenCalled();
  });
});
