import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";

const mocks = vi.hoisted(() => {
  const dbService = {
    getRestaurants: vi.fn(),
    getRestaurant: vi.fn(),
    createRestaurant: vi.fn(),
    updateRestaurant: vi.fn(),
    deactivateRestaurant: vi.fn(),
    getRestaurantStats: vi.fn(),
    searchNearbyRestaurants: vi.fn(),
    getPopularRestaurants: vi.fn(),
    generateShopQrCode: vi.fn(),
    regenerateShopQrCode: vi.fn(),
    getShopQrCodeInfo: vi.fn(),
    updateShopQrCodeImage: vi.fn(),
    updateShopMode: vi.fn(),
    verifyShopQrCode: vi.fn(),
  };
  const subscriptionService = {
    provisionDefaultForRestaurant: vi.fn(),
  };
  const cache = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const managementApi = {
    fetch: vi.fn(),
  };

  return { dbService, subscriptionService, cache, logger, db, managementApi };
});

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => mocks.db),
}));

vi.mock("../../../core/cache", () => ({
  KVCacheService: vi.fn(function KVCacheService() {
    return mocks.cache;
  }),
}));

vi.mock("../../../core/monitoring", () => ({
  ConsoleLogger: vi.fn(function ConsoleLogger() {
    return mocks.logger;
  }),
}));

vi.mock("../../subscriptions/services/SubscriptionService", () => ({
  SubscriptionService: vi.fn(function SubscriptionService() {
    return mocks.subscriptionService;
  }),
}));

vi.mock("@makanmasak/database", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    RestaurantService: vi.fn(function RestaurantService() {
      return mocks.dbService;
    }),
  };
});

import { RestaurantsService } from "./RestaurantsService";
import { badRequest } from "../../../shared/utils/api-error";

function createService(waitUntil?: (promise: Promise<unknown>) => void) {
  return new RestaurantsService(
    {} as D1Database,
    {
      DB: {} as D1Database,
      CACHE_KV: {
        get: vi.fn(async () => "1"),
        put: vi.fn(async () => undefined),
      },
      INTERNAL_API_TOKEN: "internal-token",
      MANAGEMENT_API: mocks.managementApi,
    } as unknown as Env,
    {} as KVNamespace,
    waitUntil,
  );
}

function queryChain(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => promise),
    all: vi.fn(async () => rows),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return chain;
}

function mockSelectRows(rows: unknown[]) {
  mocks.db.select.mockReturnValueOnce(queryChain(rows));
}

function mockInsertReturning(rows: unknown[] = []) {
  const promise = Promise.resolve(rows);
  const chain = {
    values: vi.fn(() => chain),
    returning: vi.fn(async () => rows),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  mocks.db.insert.mockReturnValueOnce(chain);
  return chain;
}

function mockUpdateReturning(rows: unknown[] = []) {
  const chain = {
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    returning: vi.fn(async () => rows),
  };
  mocks.db.update.mockReturnValueOnce(chain);
  return chain;
}

function mockDeleteChain() {
  const chain = {
    where: vi.fn(async () => undefined),
  };
  mocks.db.delete.mockReturnValueOnce(chain);
  return chain;
}

function selectGet(row: unknown) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    get: vi.fn(async () => row),
  };
  mocks.db.select.mockReturnValueOnce(chain);
  return chain;
}

describe("RestaurantsService login slug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the public login context for an active shop", async () => {
    selectGet({ name: "Makan", logoUrl: undefined });
    await expect(createService().getLoginContext("makan")).resolves.toEqual({
      slug: "makan",
      name: "Makan",
      logoUrl: null,
    });
  });

  it("returns null for an unknown, inactive or deleted shop", async () => {
    selectGet(undefined);
    await expect(createService().getLoginContext("ghost")).resolves.toBeNull();
  });

  it.each([
    ["ab", "SLUG_INVALID"],
    ["Has Space", "SLUG_INVALID"],
    ["double--hyphen", "SLUG_INVALID"],
    ["admin", "SLUG_RESERVED"],
    ["  LOGIN  ", "SLUG_RESERVED"],
  ])("rejects %j with %s before touching the database", async (input, code) => {
    await expect(
      createService().updateLoginSlug("restaurant-1", input),
    ).rejects.toMatchObject({ code, status: 400 });
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("refuses a code another restaurant already owns", async () => {
    mockSelectRows([{ id: "restaurant-2" }]);

    await expect(
      createService().updateLoginSlug("restaurant-1", "taken-shop"),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN", status: 409 });
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("stores the normalized code and drops the cached restaurant", async () => {
    mockSelectRows([]);
    const update = mockUpdateReturning([{ id: "restaurant-1" }]);

    await expect(
      createService().updateLoginSlug("restaurant-1", "  My-Shop  "),
    ).resolves.toBe("my-shop");

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ loginSlug: "my-shop" }),
    );
    expect(mocks.cache.delete).toHaveBeenCalledWith("restaurant:restaurant-1");
  });

  it("lets a restaurant re-save its own current code", async () => {
    mockSelectRows([{ id: "restaurant-1" }]);
    mockUpdateReturning([{ id: "restaurant-1" }]);

    await expect(
      createService().updateLoginSlug("restaurant-1", "my-shop"),
    ).resolves.toBe("my-shop");
  });

  it("404s when the restaurant row does not exist, without clearing the cache", async () => {
    mockSelectRows([]);
    mockUpdateReturning([]);

    await expect(
      createService().updateLoginSlug("missing", "my-shop"),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.cache.delete).not.toHaveBeenCalled();
  });

  it("maps a lost unique-index race to SLUG_TAKEN", async () => {
    mockSelectRows([]);
    const chain = {
      set: vi.fn(() => chain),
      where: vi.fn(() => chain),
      returning: vi.fn(async () => {
        throw new Error(
          "D1_ERROR: UNIQUE constraint failed: restaurants.login_slug",
        );
      }),
    };
    mocks.db.update.mockReturnValueOnce(chain);

    await expect(
      createService().updateLoginSlug("restaurant-1", "my-shop"),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN", status: 409 });
  });

  it("rethrows unrelated write failures unchanged", async () => {
    mockSelectRows([]);
    const failure = new Error("disk full");
    const chain = {
      set: vi.fn(() => chain),
      where: vi.fn(() => chain),
      returning: vi.fn(async () => {
        throw failure;
      }),
    };
    mocks.db.update.mockReturnValueOnce(chain);

    await expect(
      createService().updateLoginSlug("restaurant-1", "my-shop"),
    ).rejects.toBe(failure);
  });
});

describe("RestaurantsService read-through wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getRestaurant caches a hit, skips caching a miss, and hides database errors", async () => {
    const service = createService();
    mocks.cache.get.mockResolvedValue(null);

    mocks.dbService.getRestaurant.mockResolvedValueOnce({
      id: "r1",
      name: "A",
    });
    await expect(service.getRestaurant("r1")).resolves.toMatchObject({
      id: "r1",
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "restaurant:r1",
      expect.objectContaining({ id: "r1" }),
      expect.any(Number),
    );

    mocks.cache.set.mockClear();
    mocks.dbService.getRestaurant.mockResolvedValueOnce(null);
    await expect(service.getRestaurant("r2")).resolves.toBeNull();
    expect(mocks.cache.set).not.toHaveBeenCalled();

    mocks.dbService.getRestaurant.mockRejectedValueOnce(
      new Error("SQLITE detail"),
    );
    await expect(service.getRestaurant("r3")).rejects.toThrow(
      "Failed to retrieve restaurant",
    );
  });

  it("returns cached nearby and popular lists without reading the database", async () => {
    const service = createService();
    mocks.cache.get.mockResolvedValue([{ id: "cached" }]);

    await expect(
      service.searchNearbyRestaurants("Central", 5),
    ).resolves.toEqual([{ id: "cached" }]);
    await expect(service.getPopularRestaurants(5)).resolves.toEqual([
      { id: "cached" },
    ]);
    expect(mocks.dbService.searchNearbyRestaurants).not.toHaveBeenCalled();
    expect(mocks.dbService.getPopularRestaurants).not.toHaveBeenCalled();
  });

  it("wraps nearby and popular failures in user-safe errors", async () => {
    const service = createService();
    mocks.cache.get.mockResolvedValue(null);
    mocks.dbService.searchNearbyRestaurants.mockRejectedValue(new Error("x"));
    mocks.dbService.getPopularRestaurants.mockRejectedValue(new Error("x"));

    await expect(service.searchNearbyRestaurants("Central", 5)).rejects.toThrow(
      "Failed to search nearby restaurants",
    );
    await expect(service.getPopularRestaurants(5)).rejects.toThrow(
      "Failed to retrieve popular restaurants",
    );
  });

  it("wraps update-time unexpected errors but keeps a missing restaurant as null", async () => {
    const service = createService();
    mocks.cache.get.mockResolvedValue(null);
    mocks.dbService.updateRestaurant.mockResolvedValueOnce(null);
    await expect(service.updateRestaurant("r1", {})).resolves.toBeNull();
    expect(mocks.cache.delete).not.toHaveBeenCalled();

    mocks.dbService.updateRestaurant.mockRejectedValueOnce(new Error("boom"));
    await expect(service.updateRestaurant("r1", {})).rejects.toThrow(
      "Failed to update restaurant",
    );
  });
});

describe("RestaurantsService shop QR wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("regenerate invalidates both the restaurant and shop-qr cache entries", async () => {
    mocks.dbService.regenerateShopQrCode.mockResolvedValue({
      qrCode: "SHOP-1",
      version: 2,
    });

    await createService().regenerateShopQrCode("r1");

    expect(mocks.cache.delete).toHaveBeenCalledWith("restaurant:r1");
    expect(mocks.cache.delete).toHaveBeenCalledWith("restaurant:r1:shop-qr");
  });

  it("serves shop QR info from cache, and fills the cache on a miss", async () => {
    const service = createService();
    mocks.cache.get.mockResolvedValueOnce({ qrCode: "cached" });
    await expect(service.getShopQrCodeInfo("r1")).resolves.toEqual({
      qrCode: "cached",
    });
    expect(mocks.dbService.getShopQrCodeInfo).not.toHaveBeenCalled();

    mocks.cache.get.mockResolvedValueOnce(null);
    mocks.dbService.getShopQrCodeInfo.mockResolvedValueOnce({
      qrCode: "fresh",
    });
    await expect(service.getShopQrCodeInfo("r1")).resolves.toEqual({
      qrCode: "fresh",
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "restaurant:r1:shop-qr",
      { qrCode: "fresh" },
      expect.any(Number),
    );
  });

  it("updating the QR image invalidates caches", async () => {
    mocks.dbService.updateShopQrCodeImage.mockResolvedValue(undefined);

    await createService().updateShopQrCodeImage("r1", "https://img/x.png");

    expect(mocks.dbService.updateShopQrCodeImage).toHaveBeenCalledWith(
      "r1",
      "https://img/x.png",
    );
    expect(mocks.cache.delete).toHaveBeenCalledWith("restaurant:r1:shop-qr");
  });

  it.each([
    [
      "generateShopQrCode",
      "Failed to generate shop QR code",
      "generateShopQrCode",
    ],
    [
      "regenerateShopQrCode",
      "Failed to regenerate shop QR code",
      "regenerateShopQrCode",
    ],
    [
      "getShopQrCodeInfo",
      "Failed to retrieve shop QR code information",
      "getShopQrCodeInfo",
    ],
    [
      "updateShopQrCodeImage",
      "Failed to update shop QR code image",
      "updateShopQrCodeImage",
    ],
    ["verifyShopQrCode", "Failed to verify shop QR code", "verifyShopQrCode"],
  ] as const)("%s hides database errors", async (method, message, dbMethod) => {
    mocks.cache.get.mockResolvedValue(null);
    mocks.dbService[dbMethod].mockRejectedValue(new Error("internal"));

    await expect(
      (
        createService() as unknown as Record<
          string,
          (...a: unknown[]) => Promise<unknown>
        >
      )[method]("r1", "x"),
    ).rejects.toThrow(message);
  });

  it("verifyShopQrCode passes validity and restaurant through", async () => {
    mocks.dbService.verifyShopQrCode.mockResolvedValue({
      valid: false,
      restaurantId: undefined,
      restaurant: undefined,
      extra: "dropped",
    });

    await expect(createService().verifyShopQrCode("SHOP-x")).resolves.toEqual({
      valid: false,
      restaurantId: undefined,
      restaurant: undefined,
    });
  });
});
