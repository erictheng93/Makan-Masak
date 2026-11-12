import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../shared/types";

/**
 * The delete itself is proven against real D1 in
 * `__tests__/integration/restaurant-deletion.real.integration.test.ts`. These
 * cover what surrounds it: who is refused, and that tidying up afterwards can
 * fail without the delete being reported as failed.
 */
const mocks = vi.hoisted(() => ({
  countRestaurantData: vi.fn(),
  deleteRestaurantData: vi.fn(),
  findRestaurant: vi.fn(),
  selectRows: vi.fn(),
  deleteWhere: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("../../../core/monitoring", () => ({
  ConsoleLogger: vi.fn(function ConsoleLogger() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }),
}));

vi.mock("@makanmasak/database", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    countRestaurantData: mocks.countRestaurantData,
    deleteRestaurantData: mocks.deleteRestaurantData,
    createDatabase: () => ({
      query: { restaurants: { findFirst: mocks.findRestaurant } },
      select: () => ({ from: () => ({ where: mocks.selectRows }) }),
      delete: () => ({ where: mocks.deleteWhere }),
      insert: () => ({ values: mocks.insertValues }),
    }),
  };
});

import { RestaurantDeletionService } from "./RestaurantDeletionService";

const RESTAURANT_ID = "restaurant-1";
const STAFF_ID = "staff-9";

function buildRestaurant(overrides = {}) {
  return {
    id: RESTAURANT_ID,
    name: "Leaving Shop",
    isActive: false,
    isDemo: false,
    ...overrides,
  };
}

function buildEnv(overrides: Record<string, unknown> = {}) {
  const bucket = {
    list: vi.fn().mockResolvedValue({
      objects: [{ key: "image-1/thumbnail" }, { key: "image-1/medium" }],
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const kv = {
    list: vi
      .fn()
      .mockResolvedValueOnce({
        keys: [
          { name: `restaurant:${RESTAURANT_ID}` },
          { name: "restaurant:someone-else" },
        ],
        list_complete: false,
        cursor: "next",
      })
      .mockResolvedValueOnce({
        keys: [{ name: `user-profile:${STAFF_ID}` }],
        list_complete: true,
      }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  return {
    env: {
      DB: {},
      IMAGES_BUCKET: bucket,
      CACHE_KV: kv,
      ...overrides,
    } as unknown as Env,
    bucket,
    kv,
  };
}

const actor = { id: "admin-1" };
const confirm = { confirmName: "Leaving Shop" };

describe("RestaurantDeletionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRestaurant.mockResolvedValue(buildRestaurant());
    mocks.countRestaurantData.mockResolvedValue([
      { table: "orders", rows: 3 },
      { table: "restaurants", rows: 1 },
    ]);
    mocks.deleteRestaurantData.mockResolvedValue([
      { table: "orders", rows: 3 },
      { table: "restaurants", rows: 1 },
    ]);
    // Read in this order before the delete: image rows, then staff rows.
    mocks.selectRows
      .mockResolvedValueOnce([{ id: "image-1" }])
      .mockResolvedValueOnce([{ id: STAFF_ID }]);
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.insertValues.mockResolvedValue(undefined);
  });

  describe("preview", () => {
    it("answers 404 for a restaurant that does not exist", async () => {
      mocks.findRestaurant.mockResolvedValue(undefined);
      const { env } = buildEnv();

      await expect(
        new RestaurantDeletionService(env).preview("missing"),
      ).rejects.toMatchObject({ status: 404 });
      expect(mocks.countRestaurantData).not.toHaveBeenCalled();
    });

    it("totals the rows and reports why a live demo shop would be refused", async () => {
      mocks.findRestaurant.mockResolvedValue(
        buildRestaurant({ isActive: true, isDemo: true }),
      );
      const { env } = buildEnv();

      const preview = await new RestaurantDeletionService(env).preview(
        RESTAURANT_ID,
      );

      expect(mocks.countRestaurantData).toHaveBeenCalledWith(
        expect.anything(),
        RESTAURANT_ID,
      );
      expect(preview).toEqual(
        expect.objectContaining({
          totalRows: 4,
          hasFinancialRecords: false,
          blockers: ["RESTAURANT_STILL_ACTIVE", "DEMO_RESTAURANT"],
        }),
      );
    });

    it("flags payment and receipt records", async () => {
      mocks.countRestaurantData.mockResolvedValue([
        { table: "receipts", rows: 2 },
      ]);
      const { env } = buildEnv();

      const preview = await new RestaurantDeletionService(env).preview(
        RESTAURANT_ID,
      );

      expect(preview.hasFinancialRecords).toBe(true);
    });
  });

  describe("delete refuses", () => {
    it.each([
      [
        "a shop that is still active",
        { isActive: true },
        confirm,
        "RESTAURANT_STILL_ACTIVE",
      ],
      ["the demo shop", { isDemo: true }, confirm, "DEMO_RESTAURANT"],
      [
        "a name that does not match",
        {},
        { confirmName: "Staying Shop" },
        "CONFIRMATION_MISMATCH",
      ],
    ])("%s", async (_label, restaurant, input, code) => {
      mocks.findRestaurant.mockResolvedValue(buildRestaurant(restaurant));
      const { env } = buildEnv();

      await expect(
        new RestaurantDeletionService(env).delete(RESTAURANT_ID, input, actor),
      ).rejects.toMatchObject({ code });
      expect(mocks.deleteRestaurantData).not.toHaveBeenCalled();
    });

    it("payment records that were not acknowledged, and accepts them once they are", async () => {
      mocks.countRestaurantData.mockResolvedValue([
        { table: "payment_transactions", rows: 1 },
      ]);
      const { env } = buildEnv();
      const service = new RestaurantDeletionService(env);

      await expect(
        service.delete(RESTAURANT_ID, confirm, actor),
      ).rejects.toMatchObject({ code: "FINANCIAL_RECORDS_NOT_ACKNOWLEDGED" });
      expect(mocks.deleteRestaurantData).not.toHaveBeenCalled();

      await service.delete(
        RESTAURANT_ID,
        { ...confirm, acknowledgeFinancialRecords: true },
        actor,
      );
      expect(mocks.deleteRestaurantData).toHaveBeenCalledOnce();
    });
  });

  describe("delete", () => {
    it("deletes, then removes the shop's images and cache keys and records who did it", async () => {
      const { env, bucket, kv } = buildEnv();

      const result = await new RestaurantDeletionService(env).delete(
        RESTAURANT_ID,
        confirm,
        actor,
      );

      expect(mocks.deleteRestaurantData).toHaveBeenCalledOnce();
      expect(mocks.deleteRestaurantData).toHaveBeenCalledWith(
        expect.anything(),
        RESTAURANT_ID,
      );
      expect(bucket.list).toHaveBeenCalledWith({ prefix: "image-1/" });
      expect(bucket.delete).toHaveBeenCalledWith([
        "image-1/thumbnail",
        "image-1/medium",
      ]);
      // Only this shop's keys, across both pages of the listing.
      expect(kv.list).toHaveBeenCalledTimes(2);
      expect(kv.delete.mock.calls.map(([name]) => name)).toEqual([
        `restaurant:${RESTAURANT_ID}`,
        `user-profile:${STAFF_ID}`,
      ]);
      expect(mocks.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: actor.id,
          restaurantId: null,
          action: "restaurant_delete",
          resourceId: RESTAURANT_ID,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          restaurant: { id: RESTAURANT_ID, name: "Leaving Shop" },
          totalRows: 4,
          imagesRemoved: 2,
          cacheKeysRemoved: 2,
        }),
      );
    });

    it("still reports success when the tidying afterwards fails", async () => {
      const { env, bucket, kv } = buildEnv();
      bucket.list.mockReset().mockRejectedValue(new Error("R2 unavailable"));
      kv.list.mockReset().mockRejectedValue(new Error("KV unavailable"));
      mocks.deleteWhere.mockRejectedValue(new Error("D1 hiccup"));
      mocks.insertValues.mockRejectedValue(new Error("audit write failed"));

      const result = await new RestaurantDeletionService(env).delete(
        RESTAURANT_ID,
        confirm,
        actor,
      );

      expect(mocks.deleteRestaurantData).toHaveBeenCalledOnce();
      expect(result).toEqual(
        expect.objectContaining({
          totalRows: 4,
          imagesRemoved: 0,
          cacheKeysRemoved: 0,
        }),
      );
    });

    it("skips storage it has no binding for", async () => {
      const { env } = buildEnv({
        IMAGES_BUCKET: undefined,
        CACHE_KV: undefined,
      });

      const result = await new RestaurantDeletionService(env).delete(
        RESTAURANT_ID,
        confirm,
        actor,
      );

      expect(result).toEqual(
        expect.objectContaining({ imagesRemoved: 0, cacheKeysRemoved: 0 }),
      );
    });
  });
});
