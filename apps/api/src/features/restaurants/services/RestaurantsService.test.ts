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

function createService() {
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

const restaurant = {
  id: "restaurant-1",
  name: "Makan",
  type: "malaysian",
  district: "Central",
};

describe("RestaurantsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.managementApi.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            tenant: {
              id: "T-20260630-ABC12345",
              platformRestaurantId: "restaurant-1",
            },
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  it("returns cached restaurant lists using stable sorted filter cache keys", async () => {
    const cached = {
      restaurants: [restaurant],
      pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
    };
    mocks.cache.get.mockResolvedValue(cached);

    await expect(
      createService().getRestaurants({
        limit: 10,
        page: 2,
        district: "Central",
        type: "malaysian",
        isAvailable: true,
      }),
    ).resolves.toBe(cached);

    expect(mocks.cache.get).toHaveBeenCalledWith(
      "restaurants:list:district:Central:isAvailable:true:limit:10:page:2:type:malaysian",
    );
    expect(mocks.dbService.getRestaurants).not.toHaveBeenCalled();
  });

  it("loads restaurant list and detail misses through database service and caches them", async () => {
    const list = {
      restaurants: [restaurant],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mocks.cache.get.mockResolvedValue(null);
    mocks.dbService.getRestaurants.mockResolvedValue(list);
    mocks.dbService.getRestaurant.mockResolvedValue(restaurant);

    await expect(
      createService().getRestaurants({ district: "Central", page: 1 }),
    ).resolves.toBe(list);
    await expect(createService().getRestaurant("restaurant-1")).resolves.toBe(
      restaurant,
    );

    expect(mocks.dbService.getRestaurants).toHaveBeenCalledWith({
      page: 1,
      limit: undefined,
      type: undefined,
      district: "Central",
      isAvailable: undefined,
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "restaurants:list:district:Central:page:1",
      list,
      expect.any(Number),
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "restaurant:restaurant-1",
      restaurant,
      expect.any(Number),
    );
  });

  it("updates restaurants and clears detail plus list caches", async () => {
    mocks.dbService.updateRestaurant.mockResolvedValue({
      ...restaurant,
      name: "Updated Makan",
    });

    await expect(
      createService().updateRestaurant("restaurant-1", {
        name: "Updated Makan",
      }),
    ).resolves.toMatchObject({ name: "Updated Makan" });

    expect(mocks.cache.delete).toHaveBeenCalledWith("restaurant:restaurant-1");
    expect(mocks.cache.clear).toHaveBeenCalledWith("restaurants:list*");
    expect(mocks.cache.clear).toHaveBeenCalledWith("restaurants:nearby*");
    expect(mocks.cache.clear).toHaveBeenCalledWith("restaurants:popular*");
    expect(mocks.logger.debug).toHaveBeenCalledWith(
      "Emitting restaurant event",
      expect.objectContaining({ type: "RESTAURANT_UPDATED" }),
    );
  });

  it("rejects a currency change when any order exists", async () => {
    const queryResult = (rows: unknown[]) => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => rows),
      };
      return builder;
    };
    mocks.db.select
      .mockReturnValueOnce(queryResult([{ settings: { currency: "TWD" } }]))
      .mockReturnValueOnce(queryResult([{ id: "order-1" }]));

    await expect(
      createService().updateRestaurant("restaurant-1", {
        settings: { currency: "MYR" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "CURRENCY_CHANGE_NOT_ALLOWED",
    });

    expect(mocks.dbService.updateRestaurant).not.toHaveBeenCalled();
  });

  it("keeps a rejected settings update as the caller's 400", async () => {
    const rejection = badRequest(
      "Amounts in TWD must be multiples of 1",
      "CURRENCY_PRECISION",
    );
    mocks.dbService.updateRestaurant.mockRejectedValue(rejection);

    await expect(
      createService().updateRestaurant("restaurant-1", {
        settings: { deliveryFee: 12.5 },
      }),
    ).rejects.toBe(rejection);
    expect(mocks.dbService.updateRestaurant).toHaveBeenCalledOnce();
    expect(mocks.cache.delete).not.toHaveBeenCalled();
  });

  it("keeps a rejected create as the caller's 400", async () => {
    const rejection = badRequest(
      "Amounts in TWD must be multiples of 1",
      "CURRENCY_PRECISION",
    );
    mocks.dbService.createRestaurant.mockRejectedValue(rejection);

    await expect(
      createService().createRestaurant({
        ...restaurant,
        settings: { minOrderAmount: 99.5 },
      } as never),
    ).rejects.toBe(rejection);
    expect(mocks.dbService.createRestaurant).toHaveBeenCalledOnce();
  });

  it("creates restaurants, provisions subscriptions, auto-attaches nearby markets, and invalidates list caches", async () => {
    const created = {
      ...restaurant,
      latitude: 25.033,
      longitude: 121.565,
    };
    mocks.dbService.createRestaurant.mockResolvedValue(created);
    mocks.subscriptionService.provisionDefaultForRestaurant.mockResolvedValue({
      planTier: "trial",
      trialEndsAt: "2026-07-07T00:00:00.000Z",
    });
    mockSelectRows([
      {
        id: "market-1",
        latitude: 25.034,
        longitude: 121.565,
        boundaryGeojson: null,
      },
    ]);
    mockSelectRows([]);
    mockInsertReturning();

    await expect(
      createService().createRestaurant({
        name: "Makan",
        type: "malaysian",
        category: "casual",
        address: "Main Street",
        district: "Central",
        city: "Taipei",
        phone: "0912345678",
      }),
    ).resolves.toBe(created);

    expect(
      mocks.subscriptionService.provisionDefaultForRestaurant,
    ).toHaveBeenCalledWith({ restaurantId: "restaurant-1" });
    expect(mocks.managementApi.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://management.internal/api/v1/internal/platform-restaurants/restaurant-1/tenant",
      }),
    );
    expect(mocks.db.insert).toHaveBeenCalled();
    expect(mocks.cache.clear).toHaveBeenCalledWith("restaurants:list*");
    expect(mocks.logger.debug).toHaveBeenCalledWith(
      "Emitting restaurant event",
      expect.objectContaining({ type: "RESTAURANT_CREATED" }),
    );
  });

  it("deactivates a newly created restaurant when management tenant provisioning fails", async () => {
    const created = {
      ...restaurant,
      email: "owner@example.test",
      phone: "0912345678",
    };
    mocks.dbService.createRestaurant.mockResolvedValue(created);
    mocks.managementApi.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: "Failed to provision tenant",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      createService().createRestaurant({
        name: "Makan",
        type: "malaysian",
        category: "casual",
        address: "Main Street",
        district: "Central",
        city: "Taipei",
        phone: "0912345678",
        email: "owner@example.test",
      }),
    ).rejects.toThrow("Failed to provision tenant");

    expect(mocks.dbService.deactivateRestaurant).toHaveBeenCalledWith(
      "restaurant-1",
    );
    expect(
      mocks.subscriptionService.provisionDefaultForRestaurant,
    ).not.toHaveBeenCalled();
    expect(mocks.logger.debug).not.toHaveBeenCalledWith(
      "Emitting restaurant event",
      expect.objectContaining({ type: "RESTAURANT_CREATED" }),
    );
  });

  it("returns null for missing contact profiles and updates contact profile FAQs", async () => {
    mockSelectRows([]);
    await expect(
      createService().getContactProfile("missing"),
    ).resolves.toBeNull();

    mockSelectRows([
      {
        id: "restaurant-1",
        messagingChannels: {
          line: "https://line.example",
          telegram: "",
        },
      },
    ]);
    mockSelectRows([
      {
        id: 1,
        question: "Hours?",
        answer: "10-9",
        keywords: ["hours"],
        displayOrder: 2,
        isActive: false,
      },
    ]);
    await expect(
      createService().getContactProfile("restaurant-1", {
        includeInactiveFaqs: true,
      }),
    ).resolves.toEqual({
      restaurantId: "restaurant-1",
      messagingChannels: {
        line: "https://line.example",
        telegram: "",
      },
      faqs: [
        {
          id: 1,
          question: "Hours?",
          answer: "10-9",
          keywords: ["hours"],
          displayOrder: 2,
          isActive: false,
        },
      ],
    });

    mockSelectRows([{ id: "restaurant-1" }]);
    mockUpdateReturning();
    mockDeleteChain();
    const insertChain = mockInsertReturning();
    mockSelectRows([
      {
        id: "restaurant-1",
        messagingChannels: { line: "https://line.example" },
      },
    ]);
    mockSelectRows([]);

    await expect(
      createService().updateContactProfile("restaurant-1", {
        messagingChannels: {
          line: "https://line.example",
          whatsapp: "",
        },
        faqs: [{ question: "Q", answer: "A" }],
      }),
    ).resolves.toMatchObject({
      restaurantId: "restaurant-1",
      messagingChannels: { line: "https://line.example" },
    });
    expect(mocks.db.update).toHaveBeenCalled();
    expect(insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({
        restaurantId: "restaurant-1",
        question: "Q",
        answer: "A",
        displayOrder: 0,
        isActive: true,
      }),
    ]);
    expect(mocks.cache.delete).toHaveBeenCalledWith(
      "restaurant:restaurant-1:contact-profile",
    );
  });

  it("lists public and manageable service items only for active restaurants", async () => {
    const serviceItem = {
      id: 1,
      restaurantId: "restaurant-1",
      name: "Private table",
      description: null,
      serviceType: "booking",
      priceCents: 5000,
      paymentRequirement: "pay_at_venue",
      depositAmountCents: 0,
      priceLabel: null,
      durationMinutes: null,
      requiresBooking: true,
      bookingUrl: null,
      availableHours: { start: "10:00" },
      tags: ["private"],
      keywords: "private",
      sortOrder: 1,
      isActive: true,
      isPublic: true,
    };

    mockSelectRows([]);
    await expect(
      createService().listPublicServiceItems("missing"),
    ).resolves.toBeNull();

    mockSelectRows([{ id: "restaurant-1" }]);
    mockSelectRows([serviceItem]);
    await expect(
      createService().listPublicServiceItems("restaurant-1"),
    ).resolves.toEqual([expect.objectContaining({ name: "Private table" })]);

    mockSelectRows([{ id: "restaurant-1" }]);
    mockSelectRows([serviceItem]);
    await expect(
      createService().listManageableServiceItems("restaurant-1"),
    ).resolves.toEqual([expect.objectContaining({ tags: ["private"] })]);
  });

  it("creates, updates, and soft-deletes service items with cache version bumps", async () => {
    const row = {
      id: 1,
      restaurantId: "restaurant-1",
      name: "Private table",
      description: null,
      serviceType: "booking",
      priceCents: 5000,
      paymentRequirement: "pay_at_venue",
      depositAmountCents: 0,
      priceLabel: null,
      durationMinutes: null,
      requiresBooking: true,
      bookingUrl: null,
      availableHours: null,
      tags: [],
      keywords: null,
      sortOrder: 0,
      isActive: true,
      isPublic: true,
    };

    mockSelectRows([{ id: "restaurant-1" }]);
    mockInsertReturning([row]);
    await expect(
      createService().createServiceItem("restaurant-1", {
        name: "Private table",
        serviceType: "booking",
        requiresBooking: true,
      }),
    ).resolves.toMatchObject({ id: 1, name: "Private table" });

    mockUpdateReturning([{ ...row, name: "Updated table" }]);
    await expect(
      createService().updateServiceItem("restaurant-1", 1, {
        name: "Updated table",
      }),
    ).resolves.toMatchObject({ name: "Updated table" });

    mockUpdateReturning([{ id: 1 }]);
    await expect(
      createService().deleteServiceItem("restaurant-1", 1),
    ).resolves.toBe(true);

    mockUpdateReturning([]);
    await expect(
      createService().deleteServiceItem("restaurant-1", 404),
    ).resolves.toBe(false);

    expect(mocks.cache.delete).toHaveBeenCalledWith(
      "restaurant:restaurant-1:service-items",
    );
  });

  it("transforms and caches basic restaurant statistics", async () => {
    mocks.cache.get.mockResolvedValue(null);
    mocks.dbService.getRestaurantStats.mockResolvedValue({
      totalMenuItems: 12,
      totalTables: 4,
    });

    await expect(
      createService().getRestaurantStats("restaurant-1"),
    ).resolves.toEqual({
      totalOrders: 0,
      todayOrders: 0,
      totalRevenue: 0,
      todayRevenue: 0,
      averageOrderValue: 0,
      activeMenuItems: 12,
      totalTables: 4,
      occupiedTables: 0,
      popularItems: [],
      ordersByHour: [],
      customerRetention: {
        newCustomers: 0,
        returningCustomers: 0,
        retentionRate: 0,
      },
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "restaurant:restaurant-1:stats",
      expect.objectContaining({ activeMenuItems: 12, totalTables: 4 }),
      expect.any(Number),
    );
  });

  it("deactivates restaurants and wraps nearby/popular cache miss paths", async () => {
    mocks.dbService.deactivateRestaurant.mockResolvedValue(undefined);
    mocks.cache.get.mockResolvedValue(null);
    mocks.dbService.searchNearbyRestaurants.mockResolvedValue([restaurant]);
    mocks.dbService.getPopularRestaurants.mockResolvedValue([restaurant]);

    await expect(
      createService().deactivateRestaurant("restaurant-1"),
    ).resolves.toBe(true);
    await expect(
      createService().searchNearbyRestaurants("Central", 3),
    ).resolves.toEqual([restaurant]);
    await expect(createService().getPopularRestaurants(5)).resolves.toEqual([
      restaurant,
    ]);

    expect(mocks.cache.delete).toHaveBeenCalledWith("restaurant:restaurant-1");
    expect(mocks.cache.delete).toHaveBeenCalledWith(
      "restaurant:restaurant-1:stats",
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "restaurants:nearby:Central:3",
      [restaurant],
      expect.any(Number),
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "restaurants:popular:5",
      [restaurant],
      expect.any(Number),
    );
  });

  it("maps service item rows with null-safe optional collections", () => {
    expect(
      createService()["mapServiceItem"]({
        id: 1,
        restaurantId: "restaurant-1",
        name: "Table styling",
        description: null,
        serviceType: "booking",
        priceCents: 5000,
        paymentRequirement: "pay_at_venue",
        depositAmountCents: 0,
        priceLabel: null,
        durationMinutes: 60,
        requiresBooking: true,
        bookingUrl: null,
        availableHours: null,
        tags: null,
        keywords: null,
        sortOrder: 3,
        isActive: true,
        isPublic: true,
        createdAt: new Date("2026-06-07T00:00:00.000Z"),
        updatedAt: new Date("2026-06-07T00:00:00.000Z"),
        deletedAt: null,
      }),
    ).toEqual({
      id: 1,
      restaurantId: "restaurant-1",
      name: "Table styling",
      description: null,
      serviceType: "booking",
      priceCents: 5000,
      paymentRequirement: "pay_at_venue",
      depositAmountCents: 0,
      priceLabel: null,
      durationMinutes: 60,
      requiresBooking: true,
      bookingUrl: null,
      availableHours: null,
      tags: [],
      keywords: null,
      sortOrder: 3,
      isActive: true,
      isPublic: true,
    });
  });

  it("wraps shop QR operations with cache invalidation and result normalization", async () => {
    mocks.dbService.generateShopQrCode.mockResolvedValue({
      qrCode: "shop-qr",
      qrCodeImageUrl: null,
      version: 1,
    });
    mocks.dbService.regenerateShopQrCode.mockResolvedValue({
      qrCode: "shop-qr-v2",
      qrCodeImageUrl: null,
      version: 2,
    });
    mocks.dbService.getShopQrCodeInfo.mockResolvedValue({
      qrCode: "shop-qr",
      qrCodeImageUrl: "https://cdn.example/qr.png",
      enabled: true,
      version: 1,
      settings: { mode: "pickup" },
    });
    mocks.dbService.getRestaurant.mockResolvedValue({
      ...restaurant,
      supportsTakeaway: true,
    });
    mocks.dbService.verifyShopQrCode.mockResolvedValue({
      valid: true,
      restaurantId: "restaurant-1",
      restaurant,
    });

    await expect(
      createService().generateShopQrCode("restaurant-1"),
    ).resolves.toEqual({
      qrCode: "shop-qr",
      qrCodeImageUrl: null,
      version: 1,
    });
    await expect(
      createService().regenerateShopQrCode("restaurant-1"),
    ).resolves.toEqual({
      qrCode: "shop-qr-v2",
      qrCodeImageUrl: null,
      version: 2,
    });
    await expect(
      createService().getShopQrCodeInfo("restaurant-1"),
    ).resolves.toMatchObject({ enabled: true, settings: { mode: "pickup" } });
    await createService().updateShopQrCodeImage(
      "restaurant-1",
      "https://cdn.example/qr.png",
    );
    await createService().updateShopMode("restaurant-1", true, {
      mode: "pickup",
    });
    await expect(createService().verifyShopQrCode("shop-qr")).resolves.toEqual({
      valid: true,
      restaurantId: "restaurant-1",
      restaurant,
    });

    expect(mocks.cache.delete).toHaveBeenCalledWith("restaurant:restaurant-1");
    expect(mocks.cache.delete).toHaveBeenCalledWith(
      "restaurant:restaurant-1:shop-qr",
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "restaurant:restaurant-1:shop-qr",
      expect.objectContaining({ qrCode: "shop-qr" }),
      expect.any(Number),
    );
    expect(mocks.dbService.updateShopMode).toHaveBeenCalledWith(
      "restaurant-1",
      true,
      { mode: "pickup" },
    );
    expect(mocks.dbService.updateShopQrCodeImage).toHaveBeenCalledWith(
      "restaurant-1",
      "https://cdn.example/qr.png",
    );
  });

  it("rejects enabling shop mode when no fulfillment methods are enabled", async () => {
    mocks.dbService.getRestaurant.mockResolvedValue({
      ...restaurant,
      supportsTakeaway: false,
      supportsDelivery: false,
      settings: {
        enableDineIn: false,
        enableTakeaway: false,
        enableDelivery: false,
      },
    });

    await expect(
      createService().updateShopMode("restaurant-1", true, {
        mode: "pickup",
      }),
    ).rejects.toMatchObject({
      code: "SHOP_MODE_REQUIRES_FULFILLMENT",
      status: 400,
    });
    expect(mocks.dbService.updateShopMode).not.toHaveBeenCalled();
  });
});
