import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";
import type { ModuleKey } from "@makanmasak/database";

const auth = vi.hoisted(() => ({
  user: undefined as undefined | AuthUser,
}));

vi.mock("../../../middleware/auth", () => ({
  optionalAuth: vi.fn(async (c: Context, next: Next) => {
    if (auth.user) c.set("user", auth.user);
    await next();
  }),
  authMiddleware: vi.fn(async (c: Context, next: Next) => {
    c.set("user", auth.user ?? { id: "user-7", username: "admin", role: 0 });
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

const restaurantFns = vi.hoisted(() => ({
  getRestaurants: vi.fn(),
  getPopularRestaurants: vi.fn(),
  searchNearbyRestaurants: vi.fn(),
  createRestaurant: vi.fn(),
  getContactProfile: vi.fn(),
  updateContactProfile: vi.fn(),
  listManageableServiceItems: vi.fn(),
  listPublicServiceItems: vi.fn(),
  createServiceItem: vi.fn(),
  updateServiceItem: vi.fn(),
  deleteServiceItem: vi.fn(),
  getRestaurant: vi.fn(),
  updateRestaurant: vi.fn(),
  deactivateRestaurant: vi.fn(),
  getRestaurantStats: vi.fn(),
  generateShopQrCode: vi.fn(),
  regenerateShopQrCode: vi.fn(),
  getShopQrCodeInfo: vi.fn(),
  updateShopQrCodeImage: vi.fn(),
  updateShopMode: vi.fn(),
}));

vi.mock("../services/RestaurantsService", () => ({
  RestaurantsService: class {
    getRestaurants = restaurantFns.getRestaurants;
    getPopularRestaurants = restaurantFns.getPopularRestaurants;
    searchNearbyRestaurants = restaurantFns.searchNearbyRestaurants;
    createRestaurant = restaurantFns.createRestaurant;
    getContactProfile = restaurantFns.getContactProfile;
    updateContactProfile = restaurantFns.updateContactProfile;
    listManageableServiceItems = restaurantFns.listManageableServiceItems;
    listPublicServiceItems = restaurantFns.listPublicServiceItems;
    createServiceItem = restaurantFns.createServiceItem;
    updateServiceItem = restaurantFns.updateServiceItem;
    deleteServiceItem = restaurantFns.deleteServiceItem;
    getRestaurant = restaurantFns.getRestaurant;
    updateRestaurant = restaurantFns.updateRestaurant;
    deactivateRestaurant = restaurantFns.deactivateRestaurant;
    getRestaurantStats = restaurantFns.getRestaurantStats;
    generateShopQrCode = restaurantFns.generateShopQrCode;
    regenerateShopQrCode = restaurantFns.regenerateShopQrCode;
    getShopQrCodeInfo = restaurantFns.getShopQrCodeInfo;
    updateShopQrCodeImage = restaurantFns.updateShopQrCodeImage;
    updateShopMode = restaurantFns.updateShopMode;
  },
}));

const marketFns = vi.hoisted(() => ({
  listRestaurantMemberships: vi.fn(),
  listRestaurantJoinRequests: vi.fn(),
  createJoinRequest: vi.fn(),
}));

vi.mock("../../markets/services/MarketsService", () => ({
  MarketsService: class {
    listRestaurantMemberships = marketFns.listRestaurantMemberships;
    listRestaurantJoinRequests = marketFns.listRestaurantJoinRequests;
    createJoinRequest = marketFns.createJoinRequest;
  },
}));

const tableFns = vi.hoisted(() => ({
  getTableById: vi.fn(),
}));

vi.mock("../../tables/services/TablesService", () => ({
  TablesService: class {
    getTableById = tableFns.getTableById;
  },
}));

const syncFns = vi.hoisted(() => ({
  onRestaurantChanged: vi.fn(),
}));

vi.mock("../../discovery/services/SearchIndexSyncService", () => ({
  createSearchIndexSync: vi.fn(() => syncFns),
}));

const gateMocks = vi.hoisted(() => ({
  moduleGate: vi.fn(
    (_module: ModuleKey) => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  ),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: gateMocks.moduleGate,
}));

import app from "./index";

// moduleGate(...) is called once per route at registration (module import
// time), not per-request — capture the keys now, before any
// vi.clearAllMocks() in beforeEach wipes the call history.
const moduleGateRegistrationKeys = gateMocks.moduleGate.mock.calls.map(
  (call) => call[0],
);
import { ApiError } from "../../../shared/utils/api-error";

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function request(path: string, method = "GET", body?: unknown) {
  return app.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
    },
    { DB: {}, CACHE_KV: {} } as never,
  );
}

const createRestaurantBody = {
  name: "Makan",
  type: "malaysian",
  category: "casual",
  address: "Main Street",
  district: "Central",
  city: "Taipei",
  phone: "0912345678",
};

const serviceItemBody = {
  name: "Private dining",
  serviceType: "booking",
  priceCents: 5000,
  requiresBooking: true,
  bookingUrl: "https://example.test/book",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = undefined;

  restaurantFns.getRestaurants.mockResolvedValue({
    restaurants: [{ id: "rest-1", name: "Makan" }],
    pagination: { page: 2, limit: 5, total: 1, totalPages: 1 },
  });
  restaurantFns.getPopularRestaurants.mockResolvedValue([{ id: "rest-1" }]);
  restaurantFns.searchNearbyRestaurants.mockResolvedValue([{ id: "rest-2" }]);
  restaurantFns.createRestaurant.mockResolvedValue({ id: "rest-1" });
  restaurantFns.getContactProfile.mockResolvedValue({
    messagingChannels: {},
    faqs: [],
  });
  restaurantFns.updateContactProfile.mockResolvedValue({
    messagingChannels: { line: "https://line.me/R/ti/p/@makan" },
    faqs: [],
  });
  restaurantFns.listManageableServiceItems.mockResolvedValue([
    { id: 1, isPublic: false },
  ]);
  restaurantFns.listPublicServiceItems.mockResolvedValue([
    { id: 1, isPublic: true },
  ]);
  restaurantFns.createServiceItem.mockResolvedValue({ id: 1 });
  restaurantFns.updateServiceItem.mockResolvedValue({ id: 1, name: "Updated" });
  restaurantFns.deleteServiceItem.mockResolvedValue(true);
  restaurantFns.getRestaurant.mockResolvedValue({
    id: "rest-1",
    district: "Central",
  });
  restaurantFns.updateRestaurant.mockResolvedValue({ id: "rest-1" });
  restaurantFns.deactivateRestaurant.mockResolvedValue(true);
  restaurantFns.getRestaurantStats.mockResolvedValue({ totalOrders: 3 });
  restaurantFns.generateShopQrCode.mockResolvedValue({ qrCode: "SHOP-1-1" });
  restaurantFns.regenerateShopQrCode.mockResolvedValue({ qrCode: "SHOP-1-2" });
  restaurantFns.getShopQrCodeInfo.mockResolvedValue({ qrCode: "SHOP-1-1" });
  restaurantFns.updateShopQrCodeImage.mockResolvedValue(undefined);
  restaurantFns.updateShopMode.mockResolvedValue(undefined);
  marketFns.listRestaurantMemberships.mockResolvedValue({ memberships: [] });
  marketFns.listRestaurantJoinRequests.mockResolvedValue({ requests: [] });
  marketFns.createJoinRequest.mockResolvedValue({
    status: "created",
    request: { id: 10 },
  });
  tableFns.getTableById.mockResolvedValue({
    id: 11,
    restaurantId: "rest-1",
    number: "A1",
    capacity: 4,
    isActive: true,
    isOccupied: false,
  });
});

describe("restaurants routes", () => {
  it("lists, fetches popular, and searches nearby public restaurants", async () => {
    let res = await request("/?page=2&limit=5&type=malaysian&isAvailable=true");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: "rest-1", name: "Makan" }],
      pagination: { page: 2, limit: 5, total: 1, totalPages: 1 },
    });
    expect(restaurantFns.getRestaurants).toHaveBeenCalledWith({
      page: 2,
      limit: 5,
      type: "malaysian",
      isAvailable: true,
    });

    res = await request("/popular?limit=3");
    expect(res.status).toBe(200);
    expect(restaurantFns.getPopularRestaurants).toHaveBeenCalledWith(3);

    res = await request("/nearby/Central?limit=4");
    expect(res.status).toBe(200);
    expect(restaurantFns.searchNearbyRestaurants).toHaveBeenCalledWith(
      "Central",
      4,
    );
  });

  it("validates public table menu entry links", async () => {
    let res = await request("/rest-1/tables/11/validate");

    expect(res.status).toBe(200);
    expect(tableFns.getTableById).toHaveBeenCalledWith(11);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        isValid: true,
        table: {
          id: 11,
          number: "A1",
          seats: 4,
          status: "available",
        },
      },
    });

    tableFns.getTableById.mockResolvedValueOnce({
      id: 12,
      restaurantId: "rest-2",
      number: "B1",
      capacity: 2,
      isActive: true,
    });
    res = await request("/rest-1/tables/12/validate");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { isValid: false },
    });
  });

  it("creates restaurants and returns detail not-found errors", async () => {
    auth.user = { id: "user-7", username: "admin", role: 0 };

    let res = await request("/", "POST", createRestaurantBody);
    expect(res.status).toBe(201);
    expect(restaurantFns.createRestaurant).toHaveBeenCalledWith(
      createRestaurantBody,
    );

    restaurantFns.getRestaurant.mockResolvedValueOnce(null);
    res = await request("/missing");
    expect(res.status).toBe(404);
  });

  it("marks and strips onboarding placeholder descriptions from public detail responses", async () => {
    restaurantFns.getRestaurant.mockResolvedValueOnce({
      id: "rest-1",
      name: "Makan",
      description:
        "Provisioned from onboarding application APP-20260727-4OG1RRGC; owner must complete the restaurant profile before publishing.",
    });

    const res = await request("/rest-1");
    const body = await res.json<{ data: unknown }>();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "rest-1",
      description: null,
      isPlaceholderDescription: true,
    });
    expect(JSON.stringify(body)).not.toContain("Provisioned from onboarding");
  });

  it("uses manage scope for contact profiles and blocks cross-restaurant owner updates", async () => {
    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };

    let res = await request("/rest-1/contact-profile");
    expect(res.status).toBe(200);
    expect(restaurantFns.getContactProfile).toHaveBeenCalledWith("rest-1", {
      includeInactiveFaqs: true,
    });

    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "other",
    };
    res = await request("/rest-1/contact-profile", "PUT", {
      messagingChannels: { line: "https://line.me/R/ti/p/@makan" },
      faqs: [{ question: "Hi <b>?", answer: "Use &lt;LINE&gt;" }],
    });
    expect(res.status).toBe(403);
    expect(restaurantFns.updateContactProfile).not.toHaveBeenCalled();
  });

  it("lists public or manageable service items and manages service item mutations", async () => {
    auth.user = undefined;
    let res = await request("/rest-1/service-items");
    expect(res.status).toBe(200);
    expect(restaurantFns.listPublicServiceItems).toHaveBeenCalledWith("rest-1");

    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };
    res = await request("/rest-1/service-items");
    expect(res.status).toBe(200);
    expect(restaurantFns.listManageableServiceItems).toHaveBeenCalledWith(
      "rest-1",
    );

    res = await request("/rest-1/service-items", "POST", serviceItemBody);
    expect(res.status).toBe(201);
    expect(restaurantFns.createServiceItem).toHaveBeenCalledWith(
      "rest-1",
      expect.objectContaining({
        name: "Private dining",
        serviceType: "booking",
        requiresBooking: true,
      }),
    );

    res = await request("/rest-1/service-items/1", "PUT", {
      name: "Updated",
    });
    expect(res.status).toBe(200);
    expect(restaurantFns.updateServiceItem).toHaveBeenCalledWith("rest-1", 1, {
      name: "Updated",
    });

    res = await request("/rest-1/service-items/1", "DELETE");
    expect(res.status).toBe(200);
    expect(restaurantFns.deleteServiceItem).toHaveBeenCalledWith("rest-1", 1);

    // Service-item writes are the admin half of the booking product and must
    // require "reservations" (see module-gate.test.ts for the real,
    // unmocked-gate proof). GET stays public/ungated.
    expect(
      moduleGateRegistrationKeys.filter((key) => key === "reservations").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("blocks owner access to another restaurant for protected resources", async () => {
    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "other",
    };

    let res = await request("/rest-1/service-items", "POST", serviceItemBody);
    expect(res.status).toBe(403);

    res = await request("/rest-1/stats");
    expect(res.status).toBe(403);

    res = await request("/rest-1/qr/shop/generate", "POST");
    expect(res.status).toBe(403);
  });

  it("updates restaurants with previous district sync and deactivates restaurants", async () => {
    auth.user = { id: "user-7", username: "admin", role: 0 };

    let res = await request("/rest-1", "PUT", {
      name: "Updated",
      supportsTakeaway: true,
    });
    expect(res.status).toBe(200);
    expect(restaurantFns.getRestaurant).toHaveBeenCalledWith("rest-1");
    expect(restaurantFns.updateRestaurant).toHaveBeenCalledWith("rest-1", {
      name: "Updated",
      supportsTakeaway: true,
    });
    expect(syncFns.onRestaurantChanged).toHaveBeenCalledWith("rest-1", {
      previousDistrict: "Central",
    });

    restaurantFns.deactivateRestaurant.mockResolvedValueOnce(false);
    res = await request("/missing", "DELETE");
    expect(res.status).toBe(404);

    res = await request("/rest-1", "DELETE");
    expect(res.status).toBe(200);
    expect(restaurantFns.deactivateRestaurant).toHaveBeenCalledWith("rest-1");
  });

  it("only lets admins change isActive on restaurant update", async () => {
    auth.user = {
      id: "user-8",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };
    let res = await request("/rest-1", "PUT", { isActive: true });
    expect(res.status).toBe(403);
    expect(restaurantFns.updateRestaurant).not.toHaveBeenCalled();

    auth.user = { id: "user-7", username: "admin", role: 0 };
    res = await request("/rest-1", "PUT", { isActive: true });
    expect(res.status).toBe(200);
    expect(restaurantFns.updateRestaurant).toHaveBeenCalledWith("rest-1", {
      isActive: true,
    });
  });

  it("handles restaurant market memberships and join request states", async () => {
    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };

    let res = await request("/rest-1/markets");
    expect(res.status).toBe(200);
    expect(marketFns.listRestaurantMemberships).toHaveBeenCalledWith("rest-1");

    res = await request("/rest-1/market-join-requests");
    expect(res.status).toBe(200);
    expect(marketFns.listRestaurantJoinRequests).toHaveBeenCalledWith("rest-1");

    res = await request("/rest-1/market-join-requests", "POST", {
      marketId: "market-1",
      message: "Please add us",
    });
    expect(res.status).toBe(201);
    expect(marketFns.createJoinRequest).toHaveBeenCalledWith("rest-1", {
      marketId: "market-1",
      message: "Please add us",
    });

    marketFns.createJoinRequest.mockResolvedValueOnce({
      status: "already_pending",
    });
    res = await request("/rest-1/market-join-requests", "POST", {
      marketSlug: "central-market",
    });
    expect(res.status).toBe(409);
  });

  it("runs shop QR and shop mode workflows for the owner restaurant", async () => {
    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };

    let res = await request("/rest-1/qr/shop/generate", "POST");
    expect(res.status).toBe(201);
    expect(restaurantFns.generateShopQrCode).toHaveBeenCalledWith("rest-1");

    res = await request("/rest-1/qr/shop/regenerate", "POST");
    expect(res.status).toBe(200);
    expect(restaurantFns.regenerateShopQrCode).toHaveBeenCalledWith("rest-1");

    res = await request("/rest-1/qr/shop");
    expect(res.status).toBe(200);
    expect(restaurantFns.getShopQrCodeInfo).toHaveBeenCalledWith("rest-1");

    res = await request("/rest-1/qr/shop/upload-image", "POST", {
      imageUrl: "https://cdn.example.test/qr.png",
    });
    expect(res.status).toBe(200);
    expect(restaurantFns.updateShopQrCodeImage).toHaveBeenCalledWith(
      "rest-1",
      "https://cdn.example.test/qr.png",
    );

    res = await request("/rest-1/shop-mode", "PUT", {
      enabled: true,
      settings: { displayName: "Makan Stall" },
    });
    expect(res.status).toBe(200);
    expect(restaurantFns.updateShopMode).toHaveBeenCalledWith("rest-1", true, {
      displayName: "Makan Stall",
    });

    // Shop QR + shop mode are the no-table equivalent of table QR management
    // and must carry the same table_management gate as tables/routes (see
    // module-gate.test.ts for the real, unmocked-gate proof).
    expect(
      moduleGateRegistrationKeys.filter((key) => key === "table_management")
        .length,
    ).toBeGreaterThanOrEqual(5);
  });
});
