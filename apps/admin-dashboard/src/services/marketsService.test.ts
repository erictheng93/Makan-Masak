import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { marketsService } from "./marketsService";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    instance: { get: vi.fn() },
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  unwrapApiPayload: (payload: { data?: unknown }) => payload.data ?? payload,
}));

describe("marketsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the scoped report for platform and owner", async () => {
    const report = { market: { id: "market-1" }, daily: [], summary: [] };
    vi.mocked(api.get).mockResolvedValue({ data: { data: report } } as never);
    const range = { from: "2026-09-01", to: "2026-09-07" };

    await expect(
      marketsService.getMarketOpenReport(
        { kind: "platform", marketId: "market-1" },
        range,
      ),
    ).resolves.toEqual(report);
    await expect(
      marketsService.getMarketOpenReport(
        { kind: "owner", restaurantId: "shop-1", marketId: "market-1" },
        range,
      ),
    ).resolves.toEqual(report);
    expect(api.get).toHaveBeenCalledWith(
      "/admin/markets/market-1/open-report",
      range,
    );
    expect(api.get).toHaveBeenCalledWith(
      "/restaurants/shop-1/markets/market-1/open-report",
      range,
    );
  });

  it("requests CSV as a blob for the selected view", async () => {
    const blob = new Blob(["header"]);
    vi.mocked(api.instance.get).mockResolvedValueOnce({ data: blob } as never);
    const range = { from: "2026-09-01", to: "2026-09-07" };

    await expect(
      marketsService.exportMarketOpenReportCsv(
        { kind: "platform", marketId: "market-1" },
        range,
        "summary",
      ),
    ).resolves.toBe(blob);
    expect(api.instance.get).toHaveBeenCalledWith(
      "/admin/markets/market-1/open-report",
      {
        params: { ...range, view: "summary", format: "csv" },
        responseType: "blob",
      },
    );
  });

  it("lists markets within the API page-size cap", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        data: {
          markets: [
            {
              id: "market-1",
              name: "逢甲夜市",
              slug: "fengjia",
              isActive: true,
            },
          ],
          total: 1,
          page: 1,
          limit: 50,
        },
      },
    } as never);

    const result = await marketsService.listMarkets();

    expect(api.get).toHaveBeenCalledWith("/markets", { limit: 50 });
    expect(result).toHaveLength(1);
  });

  it("lists area-level market readiness summaries", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        data: {
          areas: [
            {
              city: "台中市",
              district: "西屯區",
              marketCount: 2,
              vendorCount: 8,
              searchableProductCount: 20,
              publicServiceCount: 5,
              vendorsMissingSearchableProducts: 3,
              vendorsMissingPublicServices: 4,
              marketsWithoutVendors: 1,
              marketsWithoutSearchableCatalog: 2,
              totalCatalogGapVendors: 7,
              averageReadinessScore: 72,
            },
          ],
        },
      },
    } as never);

    const result = await marketsService.listAreaReadiness();

    expect(api.get).toHaveBeenCalledWith("/admin/markets/area-readiness");
    expect(result[0]).toMatchObject({
      city: "台中市",
      district: "西屯區",
      totalCatalogGapVendors: 7,
      marketsWithoutVendors: 1,
      marketsWithoutSearchableCatalog: 2,
    });
  });

  it("generates a printable market QR code", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: {
          id: 42,
          content: "MARKET-fengjia",
          format: "png",
          downloadUrl: "https://qr.example/market-fengjia.png",
        },
      },
    } as never);

    const result = await marketsService.generateMarketQr({
      slug: "fengjia",
      name: "逢甲夜市",
    });

    expect(api.post).toHaveBeenCalledWith("/qr/generate", {
      content: "MARKET-fengjia",
      format: "png",
      metadata: {
        title: "逢甲夜市 市場 QR",
        description: "掃描後開啟逢甲夜市市場頁",
      },
    });
    expect(result).toMatchObject({
      content: "MARKET-fengjia",
      downloadUrl: "https://qr.example/market-fengjia.png",
    });
  });

  it("bulk imports markets through the server endpoint", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: {
          createdMarkets: 1,
          skipped: 0,
          issueCount: 0,
          blockingIssueCount: 0,
          issues: [],
          results: [
            {
              status: "created",
              slug: "miaokou",
              marketName: "基隆廟口夜市",
              market: {
                id: "market-3",
                slug: "miaokou",
                name: "基隆廟口夜市",
              },
            },
          ],
        },
      },
    } as never);

    const result = await marketsService.importMarkets([
      {
        slug: "miaokou",
        name: "基隆廟口夜市",
        type: "night_market",
        city: "基隆市",
        district: "仁愛區",
        address: "仁三路",
        latitude: 25.128,
        longitude: 121.743,
      },
    ]);

    expect(api.post).toHaveBeenCalledWith("/admin/markets/bulk", {
      markets: [
        {
          slug: "miaokou",
          name: "基隆廟口夜市",
          type: "night_market",
          city: "基隆市",
          district: "仁愛區",
          address: "仁三路",
          latitude: 25.128,
          longitude: 121.743,
        },
      ],
    });
    expect(result).toMatchObject({
      createdMarkets: 1,
      results: [{ status: "created", slug: "miaokou" }],
    });
  });

  it("searches vendor candidates excluding the selected market", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        data: {
          restaurants: [
            {
              id: "restaurant-1",
              name: "可加入店家",
              city: "台中市",
              district: "西屯區",
              address: "台中市西屯區文華路",
              type: "market_stall",
              category: "food",
              isAvailable: true,
              supportsTakeaway: true,
              supportsDelivery: false,
            },
          ],
          total: 1,
        },
      },
    } as never);

    const result = await marketsService.searchVendorCandidates({
      q: "可加入",
      marketId: "market-1",
      limit: 8,
    });

    expect(api.get).toHaveBeenCalledWith("/admin/markets/vendor-candidates", {
      q: "可加入",
      marketId: "market-1",
      limit: 8,
    });
    expect(result.restaurants[0]).toMatchObject({
      id: "restaurant-1",
      name: "可加入店家",
    });
  });

  it("adds an existing vendor to a market", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: {
          membership: {
            id: 1,
            restaurantId: "restaurant-1",
            marketId: "market-1",
            stallNumber: "A-01",
            isPrimary: true,
          },
        },
      },
    } as never);

    const result = await marketsService.addVendor("market-1", {
      restaurantId: "restaurant-1",
      stallNumber: "A-01",
      marketHours: {
        friday: { open: "17:00", close: "23:00" },
      },
      isPrimary: true,
    });

    expect(api.post).toHaveBeenCalledWith("/admin/markets/market-1/vendors", {
      restaurantId: "restaurant-1",
      stallNumber: "A-01",
      marketHours: {
        friday: { open: "17:00", close: "23:00" },
      },
      isPrimary: true,
    });
    expect(result).toMatchObject({
      restaurantId: "restaurant-1",
      marketId: "market-1",
    });
  });

  it("lists vendors attached to a public market", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        data: {
          vendors: [
            {
              restaurantId: "restaurant-1",
              name: "已加入攤",
              stallNumber: "A-01",
              isPrimary: true,
            },
          ],
          total: 23,
          page: 2,
          limit: 10,
        },
      },
    } as never);

    const result = await marketsService.listMarketVendors("fengjia", {
      q: "雞排",
      page: 2,
      limit: 10,
    });

    expect(api.get).toHaveBeenCalledWith("/markets/fengjia/vendors", {
      q: "雞排",
      page: 2,
      limit: 10,
    });
    expect(result.vendors[0]).toMatchObject({
      restaurantId: "restaurant-1",
      stallNumber: "A-01",
    });
    expect(result.total).toBe(23);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
  });

  it("updates an existing market vendor membership", async () => {
    vi.mocked(api.put).mockResolvedValueOnce({
      data: {
        data: {
          membership: {
            id: 1,
            restaurantId: "restaurant-1",
            marketId: "market-1",
            stallNumber: "A-02",
            isPrimary: true,
          },
        },
      },
    } as never);

    const result = await marketsService.updateVendor(
      "market-1",
      "restaurant-1",
      {
        stallNumber: "A-02",
        marketHours: {
          saturday: { open: "16:00", close: "23:30" },
        },
        isPrimary: true,
      },
    );

    expect(api.put).toHaveBeenCalledWith(
      "/admin/markets/market-1/vendors/restaurant-1",
      {
        stallNumber: "A-02",
        marketHours: {
          saturday: { open: "16:00", close: "23:30" },
        },
        isPrimary: true,
      },
    );
    expect(result).toMatchObject({
      restaurantId: "restaurant-1",
      stallNumber: "A-02",
      isPrimary: true,
    });
  });

  it("removes an existing market vendor membership", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({
      data: { data: { removed: true } },
    } as never);

    const result = await marketsService.removeVendor(
      "market-1",
      "restaurant-1",
    );

    expect(api.delete).toHaveBeenCalledWith(
      "/admin/markets/market-1/vendors/restaurant-1",
    );
    expect(result).toBe(true);
  });

  it("lists pending platform market join requests", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        data: {
          requests: [
            {
              id: 7,
              restaurantId: "restaurant-1",
              marketId: "market-1",
              status: "pending",
              restaurant: { id: "restaurant-1", name: "雞排攤" },
              market: { id: "market-1", name: "逢甲夜市" },
            },
          ],
        },
      },
    } as never);

    const result = await marketsService.listAdminJoinRequests({
      status: "pending",
    });

    expect(api.get).toHaveBeenCalledWith("/admin/markets/join-requests", {
      status: "pending",
    });
    expect(result[0]).toMatchObject({
      id: 7,
      restaurant: { name: "雞排攤" },
      market: { name: "逢甲夜市" },
    });
  });

  it("approves and rejects platform market join requests", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { data: {} } } as never);

    await marketsService.approveJoinRequest(7, {
      stallNumber: "A-12",
      marketHours: {
        sunday: { open: "15:00", close: "22:00" },
      },
      isPrimary: true,
    });
    await marketsService.rejectJoinRequest(8);

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/admin/markets/join-requests/7/approve",
      {
        stallNumber: "A-12",
        marketHours: {
          sunday: { open: "15:00", close: "22:00" },
        },
        isPrimary: true,
      },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/admin/markets/join-requests/8/reject",
      {},
    );
  });
});
