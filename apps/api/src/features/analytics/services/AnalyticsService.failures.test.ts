import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";

const mocks = vi.hoisted(() => {
  const databaseService = {
    getDashboardData: vi.fn(),
    getRevenueAnalytics: vi.fn(),
    getMenuAnalytics: vi.fn(),
    getCustomerAnalytics: vi.fn(),
    getOrderAnalytics: vi.fn(),
    getRealtimeDashboard: vi.fn(),
    getFinancialReport: vi.fn(),
  };
  const cache = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  };

  return { databaseService, cache };
});

vi.mock("../../../core/cache", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    KVCacheService: vi.fn(function KVCacheService() {
      return mocks.cache;
    }),
    NoopCacheService: vi.fn(function NoopCacheService() {
      return mocks.cache;
    }),
  };
});

vi.mock("../../../core/monitoring", () => ({
  ConsoleLogger: vi.fn(function ConsoleLogger() {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }),
}));

vi.mock("@makanmasak/database", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    AnalyticsService: vi.fn(function AnalyticsService() {
      return mocks.databaseService;
    }),
  };
});

import { AnalyticsService as DatabaseAnalyticsService } from "@makanmasak/database";
import { AnalyticsService } from "./AnalyticsService";

function createService() {
  return new AnalyticsService(
    {} as D1Database,
    { DB: {} as D1Database, CACHE_KV: {} as KVNamespace } as Env,
    {} as KVNamespace,
  );
}

function csvOf(response: { data: { download_url: string } }) {
  return decodeURIComponent(response.data.download_url.split(",", 2)[1]).split(
    "\n",
  );
}

describe("AnalyticsService failure paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.get.mockResolvedValue(null);
  });

  it.each([
    [
      "getDashboardData",
      "getDashboardData",
      (s: AnalyticsService) => s.getDashboardData("7"),
      "Failed to retrieve dashboard data",
    ],
    [
      "getProductAnalytics",
      "getMenuAnalytics",
      (s: AnalyticsService) => s.getProductAnalytics({ restaurantId: "7" }),
      "Failed to retrieve product analytics",
    ],
    [
      "getCustomerAnalytics",
      "getCustomerAnalytics",
      (s: AnalyticsService) => s.getCustomerAnalytics({ restaurantId: "7" }),
      "Failed to retrieve customer analytics",
    ],
    [
      "getPerformanceAnalytics",
      "getOrderAnalytics",
      (s: AnalyticsService) => s.getPerformanceAnalytics({ restaurantId: "7" }),
      "Failed to retrieve performance analytics",
    ],
    [
      "getFinancialReport",
      "getFinancialReport",
      (s: AnalyticsService) => s.getFinancialReport({ restaurantId: "7" }),
      "Failed to retrieve financial report",
    ],
  ] as const)(
    "%s hides a missing result behind a generic error and caches nothing",
    async (_name, reader, call, message) => {
      mocks.databaseService[reader].mockResolvedValue(null);

      await expect(call(createService())).rejects.toThrow(message);
      expect(mocks.cache.set).not.toHaveBeenCalled();
    },
  );

  it("does not leak the database error from getRevenueAnalytics", async () => {
    mocks.databaseService.getRevenueAnalytics.mockRejectedValue(
      new Error("SQLITE_BUSY: secret detail"),
    );

    await expect(
      createService().getRevenueAnalytics({ restaurantId: "7" }),
    ).rejects.toThrow("Failed to retrieve revenue analytics");
  });

  it("returns an empty list, uncached, when revenue analytics has no data", async () => {
    mocks.databaseService.getRevenueAnalytics.mockResolvedValue(null);

    await expect(
      createService().getRevenueAnalytics({ restaurantId: "7" }),
    ).resolves.toEqual([]);
    expect(mocks.cache.set).not.toHaveBeenCalled();
  });

  it("serves cached product, customer, performance and financial data without reading the database", async () => {
    const service = createService();
    mocks.cache.get.mockResolvedValue({ cached: true });

    await expect(service.getProductAnalytics({})).resolves.toEqual({
      cached: true,
    });
    await expect(service.getCustomerAnalytics({})).resolves.toEqual({
      cached: true,
    });
    await expect(service.getPerformanceAnalytics({})).resolves.toEqual({
      cached: true,
    });
    await expect(service.getFinancialReport({})).resolves.toEqual({
      cached: true,
    });
    expect(mocks.databaseService.getMenuAnalytics).not.toHaveBeenCalled();
    expect(mocks.databaseService.getFinancialReport).not.toHaveBeenCalled();
  });

  it("wraps a realtime read failure", async () => {
    mocks.databaseService.getRealtimeDashboard.mockRejectedValue(
      new Error("boom"),
    );
    await expect(createService().getRealtimeData("7")).rejects.toThrow(
      "Failed to retrieve real-time analytics data",
    );
  });

  it("reports zero utilisation when the shop has no tables", async () => {
    mocks.databaseService.getRealtimeDashboard.mockResolvedValue({
      dashboard: { summary: { todayRevenue: [] }, tableStatus: undefined },
      activeOrders: undefined,
      kitchenQueue: undefined,
      occupiedTables: 3,
    });

    await expect(createService().getRealtimeData("7")).resolves.toMatchObject({
      activeOrders: 0,
      pendingOrders: 0,
      tableUtilization: 0,
    });
  });

  it("swallows a cache clear failure so the caller's flow continues", async () => {
    mocks.cache.clear.mockRejectedValue(new Error("kv down"));
    await expect(createService().clearCache("7")).resolves.toBeUndefined();
    expect(mocks.cache.clear).toHaveBeenCalledWith("analytics:*:7:*");
  });

  it("clears every analytics key when no restaurant is given", async () => {
    mocks.cache.clear.mockResolvedValue(undefined);
    await createService().clearCache();
    expect(mocks.cache.clear).toHaveBeenCalledWith("analytics:*");
  });
});

describe("AnalyticsService exports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.get.mockResolvedValue(null);
  });

  it("rejects an unsupported export type with a generic error", async () => {
    await expect(
      createService().generateExport({
        type: "bogus",
        format: "json",
      } as never),
    ).rejects.toThrow("Failed to generate export");
  });

  it("flattens nested objects, dates, nulls and non-currency arrays into columns", async () => {
    const service = createService();
    vi.spyOn(service, "getProductAnalytics").mockResolvedValue({
      popularItems: [
        {
          name: "Laksa",
          nested: { when: new Date("2026-06-07T00:00:00.000Z"), note: null },
          tags: ["a", "b"],
          empty: [],
        },
      ],
      summary: { total: 3 },
    } as never);

    const lines = csvOf(
      await service.generateExport({ type: "products", format: "csv" }),
    );

    expect(lines[0].split(",")).toEqual(
      expect.arrayContaining([
        "section",
        "name",
        "nested.when",
        "nested.note",
        "tags",
        "empty",
        "total",
      ]),
    );
    const body = lines.slice(1).join("\n");
    expect(body).toContain("2026-06-07T00:00:00.000Z");
    expect(body).toContain('"[""a"",""b""]"');
  });

  it("exports an array of rows and a scalar payload", async () => {
    const service = createService();
    vi.spyOn(service, "getCustomerAnalytics").mockResolvedValue([
      { id: 1 },
      { id: 2 },
    ] as never);
    vi.spyOn(service, "getPerformanceAnalytics").mockResolvedValue(
      "scalar" as never,
    );

    expect(
      csvOf(await service.generateExport({ type: "customers", format: "csv" })),
    ).toEqual(["id", "1", "2"]);
    expect(
      csvOf(
        await service.generateExport({ type: "performance", format: "csv" }),
      ),
    ).toEqual(["value", "scalar"]);
  });

  it("falls back to JSON for a currency array whose entry has no amount", async () => {
    const service = createService();
    vi.spyOn(service, "getCustomerAnalytics").mockResolvedValue({
      summary: { spend: [{ currency: "TWD" }] },
    } as never);

    const lines = csvOf(
      await service.generateExport({ type: "customers", format: "csv" }),
    );
    // not a currency column: the raw array is kept as JSON in one cell
    expect(lines[0]).toBe("section,spend");
    expect(lines[1]).toBe('summary,"[{""currency"":""TWD""}]"');
  });

  it("writes growth percentages per currency", async () => {
    const service = createService();
    vi.spyOn(service, "getPerformanceAnalytics").mockResolvedValue({
      summary: { growth: [{ currency: "MYR", percentage: 12.5 }] },
    } as never);

    const lines = csvOf(
      await service.generateExport({ type: "performance", format: "csv" }),
    );
    expect(lines).toEqual(["section,growth.MYR", "summary,12.5"]);
  });
});

describe("AnalyticsService.getFinancialReport breakdown grain", () => {
  const raw = {
    summary: {},
    revenueBreakdown: {
      byDay: [
        {
          date: "2026-W23",
          revenue: [{ currency: "TWD", amountCents: 100 }],
          orderCount: 2,
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.get.mockResolvedValue(null);
    mocks.databaseService.getFinancialReport.mockResolvedValue(raw);
  });

  it.each([
    ["week", "weekly", "week"],
    ["month", "monthly", "month"],
    ["year", "yearly", "year"],
    ["day", "daily", "date"],
  ] as const)(
    "groupBy=%s publishes %s buckets",
    async (groupBy, key, label) => {
      const report = await createService().getFinancialReport({ groupBy });

      expect(Object.keys(report.breakdown)).toEqual([key]);
      expect((report.breakdown as Record<string, unknown[]>)[key][0]).toEqual({
        [label]: "2026-W23",
        revenue: raw.revenueBreakdown.byDay[0].revenue,
        orders: 2,
      });
      // empty summary falls back to empty money lists, not undefined
      expect(report.totalRevenue).toEqual([]);
      expect(report.totalOrders).toBe(0);
    },
  );

  it("omits the period comparison without a full date range", async () => {
    const report = await createService().getFinancialReport({
      dateFrom: "2026-06-01",
    });
    expect(report).not.toHaveProperty("periodComparison");
  });
});
