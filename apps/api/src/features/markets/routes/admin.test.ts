import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../middleware/auth", () => ({
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

const syncFns = vi.hoisted(() => ({
  onMarketChanged: vi.fn(),
  onMarketMembershipChanged: vi.fn(),
}));

vi.mock("../../discovery/services/SearchIndexSyncService", () => ({
  createSearchIndexSync: vi.fn(() => syncFns),
}));

const marketsFns = vi.hoisted(() => ({
  listAdminReadiness: vi.fn(),
  listAreaReadiness: vi.fn(),
  listVendorCandidates: vi.fn(),
  listJoinRequests: vi.fn(),
  approveJoinRequest: vi.fn(),
  rejectJoinRequest: vi.fn(),
  createMarket: vi.fn(),
  updateMarket: vi.fn(),
  softDeleteMarket: vi.fn(),
  getActiveVendorMembership: vi.fn(),
  addVendor: vi.fn(),
  getMarketById: vi.fn(),
  listRestaurantMemberships: vi.fn(),
  getPublicReadiness: vi.fn(),
  getCatalogReadiness: vi.fn(),
  removeVendor: vi.fn(),
}));

vi.mock("../services/MarketsService", () => ({
  MarketsService: class {
    listAdminReadiness = marketsFns.listAdminReadiness;
    listAreaReadiness = marketsFns.listAreaReadiness;
    listVendorCandidates = marketsFns.listVendorCandidates;
    listJoinRequests = marketsFns.listJoinRequests;
    approveJoinRequest = marketsFns.approveJoinRequest;
    rejectJoinRequest = marketsFns.rejectJoinRequest;
    createMarket = marketsFns.createMarket;
    updateMarket = marketsFns.updateMarket;
    softDeleteMarket = marketsFns.softDeleteMarket;
    getActiveVendorMembership = marketsFns.getActiveVendorMembership;
    addVendor = marketsFns.addVendor;
    getMarketById = marketsFns.getMarketById;
    listRestaurantMemberships = marketsFns.listRestaurantMemberships;
    getPublicReadiness = marketsFns.getPublicReadiness;
    getCatalogReadiness = marketsFns.getCatalogReadiness;
    removeVendor = marketsFns.removeVendor;
  },
}));

const restaurantFns = vi.hoisted(() => ({
  getRestaurant: vi.fn(),
  createRestaurant: vi.fn(),
}));

vi.mock("../../restaurants/services/RestaurantsService", () => ({
  RestaurantsService: class {
    getRestaurant = restaurantFns.getRestaurant;
    createRestaurant = restaurantFns.createRestaurant;
  },
}));

import routes from "./admin";
import { isOpenNow } from "../../discovery/utils/isOpenNow";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function request(path: string, method = "GET", body?: unknown) {
  return routes.request(
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

const marketBody = {
  slug: "central-market",
  name: "Central Market",
  type: "night_market",
  city: "Taipei",
  district: "Datong",
  address: "Main Street",
  latitude: 25.05,
  longitude: 121.52,
};

beforeEach(() => {
  vi.clearAllMocks();
  marketsFns.listAdminReadiness.mockResolvedValue({ markets: [] });
  marketsFns.listAreaReadiness.mockResolvedValue({ areas: [] });
  marketsFns.listVendorCandidates.mockResolvedValue({ candidates: [] });
  marketsFns.listJoinRequests.mockResolvedValue({ requests: [] });
  marketsFns.approveJoinRequest.mockResolvedValue({
    status: "approved",
    request: { id: 10 },
    membership: { id: 1, restaurantId: "restaurant-1" },
  });
  marketsFns.rejectJoinRequest.mockResolvedValue({
    status: "rejected",
    request: { id: 10 },
  });
  marketsFns.createMarket.mockResolvedValue({ id: "market-1" });
  marketsFns.updateMarket.mockResolvedValue({
    id: "market-1",
    name: "Updated",
  });
  marketsFns.softDeleteMarket.mockResolvedValue(true);
  marketsFns.getActiveVendorMembership.mockResolvedValue(null);
  marketsFns.addVendor.mockResolvedValue({
    id: 1,
    restaurantId: "restaurant-1",
    stallNumber: "A1",
  });
  marketsFns.getMarketById.mockResolvedValue({
    id: "market-1",
    city: "Taipei",
    openingHours: { friday: { open: "17:00", close: "23:00" } },
    deletedAt: null,
  });
  marketsFns.listRestaurantMemberships.mockResolvedValue({ memberships: [] });
  marketsFns.getPublicReadiness.mockResolvedValue({ ready: true, score: 90 });
  marketsFns.getCatalogReadiness.mockResolvedValue({
    searchableProductCount: 4,
  });
  marketsFns.removeVendor.mockResolvedValue(true);
  restaurantFns.getRestaurant.mockResolvedValue({
    id: "restaurant-1",
    name: "Vendor A",
    isActive: true,
  });
  restaurantFns.createRestaurant.mockResolvedValue({
    id: "restaurant-new",
    name: "New Vendor",
  });
});

describe("markets admin routes", () => {
  it("lists readiness, area readiness, vendor candidates, and join requests", async () => {
    let res = await request("/readiness");
    expect(res.status).toBe(200);
    expect(marketsFns.listAdminReadiness).toHaveBeenCalledWith({ limit: 100 });

    res = await request("/area-readiness");
    expect(res.status).toBe(200);
    expect(marketsFns.listAreaReadiness).toHaveBeenCalledWith();

    res = await request("/vendor-candidates?q=vendor&limit=5&marketId=m1");
    expect(res.status).toBe(200);
    expect(marketsFns.listVendorCandidates).toHaveBeenCalledWith({
      q: "vendor",
      limit: 5,
      marketId: "m1",
    });

    res = await request("/join-requests?status=pending");
    expect(res.status).toBe(200);
    expect(marketsFns.listJoinRequests).toHaveBeenCalledWith({
      status: "pending",
    });
  });

  it("approves and rejects join requests with status-specific responses", async () => {
    let res = await request("/join-requests/10/approve", "POST", {
      stallNumber: "A1",
      isPrimary: true,
    });
    expect(res.status).toBe(200);
    expect(marketsFns.approveJoinRequest).toHaveBeenCalledWith(10, {
      stallNumber: "A1",
      isPrimary: true,
    });
    expect(syncFns.onMarketMembershipChanged).toHaveBeenCalledWith(
      "restaurant-1",
    );

    marketsFns.approveJoinRequest.mockResolvedValueOnce({
      status: "not_pending",
    });
    res = await request("/join-requests/10/approve", "POST", {});
    expect(res.status).toBe(409);

    res = await request("/join-requests/10/reject", "POST");
    expect(res.status).toBe(200);
    expect(marketsFns.rejectJoinRequest).toHaveBeenCalledWith(10);

    marketsFns.rejectJoinRequest.mockResolvedValueOnce({ status: "not_found" });
    res = await request("/join-requests/999/reject", "POST");
    expect(res.status).toBe(404);
  });

  it("creates, updates, and deletes markets and syncs changed markets", async () => {
    let res = await request("/", "POST", marketBody);
    expect(res.status).toBe(201);
    expect(marketsFns.createMarket).toHaveBeenCalledWith(marketBody);

    res = await request("/market-1", "PUT", { name: "Updated" });
    expect(res.status).toBe(200);
    expect(marketsFns.updateMarket).toHaveBeenCalledWith("market-1", {
      name: "Updated",
    });
    expect(syncFns.onMarketChanged).toHaveBeenCalledWith("market-1");

    marketsFns.updateMarket.mockResolvedValueOnce(null);
    res = await request("/missing", "PUT", { name: "Missing" });
    expect(res.status).toBe(404);

    res = await request("/market-1", "DELETE");
    expect(res.status).toBe(200);
    expect(marketsFns.softDeleteMarket).toHaveBeenCalledWith("market-1");
    expect(syncFns.onMarketChanged).toHaveBeenCalledWith("market-1");
  });

  it("adds vendors only when not already attached and syncs membership changes", async () => {
    let res = await request("/market-1/vendors", "POST", {
      restaurantId: "restaurant-1",
      stallNumber: "A1",
      locationLabel: "Gate",
      mapPosition: { x: 10, y: 20 },
      isPrimary: true,
    });
    expect(res.status).toBe(201);
    expect(marketsFns.getActiveVendorMembership).toHaveBeenCalledWith(
      "market-1",
      "restaurant-1",
    );
    expect(marketsFns.addVendor).toHaveBeenCalledWith("market-1", {
      restaurantId: "restaurant-1",
      stallNumber: "A1",
      locationLabel: "Gate",
      mapPosition: { x: 10, y: 20 },
      isPrimary: true,
    });
    expect(syncFns.onMarketMembershipChanged).toHaveBeenCalledWith(
      "restaurant-1",
    );

    marketsFns.getActiveVendorMembership.mockResolvedValueOnce({ id: 1 });
    res = await request("/market-1/vendors", "POST", {
      restaurantId: "restaurant-1",
    });
    expect(res.status).toBe(409);
  });

  it("updates and removes vendor memberships", async () => {
    marketsFns.getActiveVendorMembership.mockResolvedValueOnce({ id: 1 });

    let res = await request("/market-1/vendors/restaurant-1", "PUT", {
      stallNumber: "B2",
      isPrimary: false,
    });
    expect(res.status).toBe(200);
    expect(marketsFns.addVendor).toHaveBeenCalledWith("market-1", {
      restaurantId: "restaurant-1",
      stallNumber: "B2",
      locationLabel: undefined,
      mapPosition: undefined,
      marketHours: undefined,
      isPrimary: false,
    });
    expect(syncFns.onMarketMembershipChanged).toHaveBeenCalledWith(
      "restaurant-1",
    );

    marketsFns.removeVendor.mockResolvedValueOnce(false);
    syncFns.onMarketMembershipChanged.mockClear();
    res = await request("/market-1/vendors/restaurant-1", "DELETE");
    expect(res.status).toBe(200);
    expect(syncFns.onMarketMembershipChanged).not.toHaveBeenCalledWith(
      "restaurant-1",
    );

    marketsFns.getActiveVendorMembership.mockResolvedValueOnce(null);
    res = await request("/market-1/vendors/missing", "PUT", {
      stallNumber: "C3",
    });
    expect(res.status).toBe(404);
  });

  it("dry-runs vendor imports with defaults, duplicates, inactive restaurants, and readiness", async () => {
    restaurantFns.getRestaurant
      .mockResolvedValueOnce({
        id: "restaurant-1",
        name: "Vendor A",
        isActive: true,
      })
      .mockResolvedValueOnce({
        id: "inactive",
        name: "Inactive",
        isActive: false,
      });
    marketsFns.listRestaurantMemberships.mockResolvedValueOnce({
      memberships: [],
    });

    const res = await request("/market-1/vendor-imports", "POST", {
      dryRun: true,
      vendors: [
        {
          name: "New Vendor",
          address: "Road 1",
          district: "Datong",
          stallNumber: "N1",
        },
        { restaurantId: "restaurant-1", stallNumber: "A1" },
        { restaurantId: "restaurant-1", stallNumber: "A2" },
        { restaurantId: "inactive", name: "Inactive" },
      ],
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        dryRun: true,
        wouldCreateRestaurants: 1,
        wouldAttachVendors: 2,
        skipped: 2,
        blockingIssueCount: 2,
        warningIssueCount: 3,
        publicReadiness: { ready: true, score: 90 },
        results: [
          { status: "would_create", restaurantName: "New Vendor" },
          { status: "would_attach", restaurantId: "restaurant-1" },
          { status: "skipped", reason: "duplicate_in_payload" },
          { status: "skipped", reason: "restaurant_not_found" },
        ],
      },
    });
    expect(marketsFns.getPublicReadiness).toHaveBeenCalledWith("market-1", {
      additionalVendorCount: 2,
    });
  });

  it("imports vendors by creating missing restaurants, attaching memberships, and reporting skips", async () => {
    restaurantFns.getRestaurant.mockResolvedValueOnce({
      id: "restaurant-1",
      name: "Vendor A",
      isActive: true,
    });
    marketsFns.listRestaurantMemberships.mockResolvedValue({
      memberships: [],
    });
    marketsFns.addVendor
      .mockResolvedValueOnce({
        id: 1,
        restaurantId: "restaurant-new",
        stallNumber: "N1",
        locationLabel: null,
        mapPosition: null,
      })
      .mockResolvedValueOnce({
        id: 2,
        restaurantId: "restaurant-1",
        stallNumber: "A1",
        locationLabel: "Gate",
        mapPosition: null,
      });

    const res = await request("/market-1/vendor-imports", "POST", {
      vendors: [
        {
          name: "New Vendor",
          address: "Road 1",
          district: "Datong",
          stallNumber: "N1",
        },
        {
          restaurantId: "restaurant-1",
          stallNumber: "A1",
          locationLabel: "Gate",
        },
        {
          restaurantId: "restaurant-1",
          stallNumber: "A2",
        },
      ],
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        createdRestaurants: 1,
        attachedVendors: 2,
        skipped: 1,
        warningIssueCount: 3,
        blockingIssueCount: 1,
        catalogReadiness: { searchableProductCount: 4 },
        publicReadiness: { ready: true, score: 90 },
        results: [
          { status: "created", restaurantId: "restaurant-new" },
          { status: "attached", restaurantId: "restaurant-1" },
          { status: "skipped", reason: "duplicate_in_payload" },
        ],
      },
    });
    expect(restaurantFns.createRestaurant).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Vendor",
        city: "Taipei",
        phone: "00000000",
        businessHours: {
          friday: { open: "17:00", close: "23:00", isOpen: true },
        },
      }),
    );
    expect(syncFns.onMarketMembershipChanged).toHaveBeenCalledWith(
      "restaurant-new",
    );
    expect(syncFns.onMarketMembershipChanged).toHaveBeenCalledWith(
      "restaurant-1",
    );
  });

  it("normalizes short market weekdays before creating a vendor", async () => {
    marketsFns.getMarketById.mockResolvedValue({
      id: "market-1",
      city: "Taipei",
      deletedAt: null,
      openingHours: {
        mon: { open: "10:00", close: "22:00" },
        tuesday: { open: "11:00", close: "21:00" },
        tue: { open: "00:00", close: "01:00" },
        wed: { closed: true },
      },
    });
    const res = await request("/market-1/vendor-imports", "POST", {
      vendors: [
        { name: "New Vendor", address: "Main Street", district: "Datong" },
      ],
    });
    expect(res.status).toBe(200);
    const hours = restaurantFns.createRestaurant.mock.calls[0][0].businessHours;
    expect(hours).toEqual({
      monday: { open: "10:00", close: "22:00", isOpen: true },
      tuesday: { open: "11:00", close: "21:00", isOpen: true },
      wednesday: { open: "00:00", close: "00:00", isOpen: false },
    });
    expect(
      isOpenNow(hours, "Asia/Taipei", new Date("2026-09-14T04:00:00Z")),
    ).toBe(true);
  });

  it("returns not found when importing into a missing market", async () => {
    marketsFns.getMarketById.mockResolvedValueOnce(null);

    const res = await request("/missing/vendor-imports", "POST", {
      dryRun: true,
      vendors: [{ restaurantId: "restaurant-1" }],
    });

    expect(res.status).toBe(404);
    expect(restaurantFns.getRestaurant).not.toHaveBeenCalled();
  });
});
