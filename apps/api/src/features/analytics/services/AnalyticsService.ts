/**
 * AnalyticsService
 * Business logic for analytics operations within the feature module
 */

import { AnalyticsService as DatabaseAnalyticsService } from "@makanmasak/database";
import {
  KVCacheService,
  NoopCacheService,
  type CacheService,
} from "../../../core/cache";
import { notFound } from "../../../shared/utils/api-error";
import { escapeCsvValue } from "../../../shared/utils/csv";
import { ConsoleLogger } from "../../../core/monitoring";
import { CACHE_TTL } from "../../../shared/constants";
import type { Env } from "../../../shared/types";
import type {
  AnalyticsFilters,
  DashboardData,
  DashboardSummary,
  RevenueData,
  ProductAnalytics,
  CustomerAnalytics,
  PerformanceAnalytics,
  RealtimeAnalyticsData,
  ExportRequest,
  ExportResponse,
  FinancialReportData,
  IAnalyticsService,
} from "../types";

// Helper to convert filters for database service (number -> string for restaurantId)
function toDbFilters(filters: AnalyticsFilters): {
  restaurantId?: string;
  startDate?: string;
  endDate?: string;
} {
  return {
    ...filters,
    restaurantId: filters.restaurantId
      ? String(filters.restaurantId)
      : undefined,
  };
}

/**
 * `MoneyByCurrency` (and the matching per-currency growth rates) as one column
 * per currency — `revenue.TWD`, `revenue.MYR` — in major units, which is what
 * this export carried before money became per-currency. Returns null for any
 * other array, which keeps the JSON fallback.
 */
function perCurrencyCsvColumns(
  entries: unknown[],
  prefix: string,
): Record<string, number> | null {
  if (entries.length === 0) return null;
  const columns: Record<string, number> = {};
  for (const entry of entries) {
    const { currency, amountCents, percentage } = (entry ?? {}) as {
      currency?: unknown;
      amountCents?: unknown;
      percentage?: unknown;
    };
    if (typeof currency !== "string") return null;
    if (typeof amountCents === "number") {
      columns[`${prefix}.${currency}`] = amountCents / 100;
    } else if (typeof percentage === "number") {
      columns[`${prefix}.${currency}`] = percentage;
    } else {
      return null;
    }
  }
  return columns;
}

function flattenForCsv(
  value: unknown,
  prefix = "",
): Record<string, string | number | boolean | null> {
  if (value == null) {
    return prefix ? { [prefix]: null } : {};
  }

  if (value instanceof Date) {
    return { [prefix]: value.toISOString() };
  }

  if (Array.isArray(value)) {
    return (
      perCurrencyCsvColumns(value, prefix) ?? {
        [prefix]: JSON.stringify(value),
      }
    );
  }

  if (typeof value !== "object") {
    return {
      [prefix]: value as string | number | boolean,
    };
  }

  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, string | number | boolean | null>
  >((row, [key, nestedValue]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;

    return {
      ...row,
      ...flattenForCsv(nestedValue, nextPrefix),
    };
  }, {});
}

function normalizeCsvRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.map((item) => flattenForCsv(item));
  }

  if (data && typeof data === "object") {
    const sections = Object.entries(data as Record<string, unknown>);
    const sectionRows = sections.flatMap(([section, value]) => {
      if (Array.isArray(value)) {
        return value.map((item) => ({
          section,
          ...flattenForCsv(item),
        }));
      }

      return [
        {
          section,
          ...flattenForCsv(value),
        },
      ];
    });

    return sectionRows.length > 0 ? sectionRows : [flattenForCsv(data)];
  }

  return [{ value: data }];
}

function toCsv(data: unknown): string {
  const rows = normalizeCsvRows(data);
  const headers = Array.from(
    rows.reduce<Set<string>>((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set()),
  );

  if (headers.length === 0) {
    return "";
  }

  return [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvValue(row[header])).join(","),
    ),
  ].join("\n");
}

export class AnalyticsService implements IAnalyticsService {
  private databaseService: DatabaseAnalyticsService;
  private cache: CacheService;
  private logger: ConsoleLogger;
  private env: Env;

  constructor(db: Env["DB"], env: Env, kv?: Env["CACHE_KV"]) {
    // Every route that builds this service is a read-only dashboard or report,
    // and the service it wraps issues no writes at all, so its queries can be
    // served by a regional read replica rather than crossing to the APAC
    // primary each time (#321). A dashboard that is a few seconds stale is
    // fine; a dashboard that takes 113ms per query to be exactly current is
    // what #316 was filed about.
    //
    // No effect until read replication is enabled on the database, and only
    // served_by_primary from a production D1Result proves it took effect.
    this.databaseService = new DatabaseAnalyticsService(db, env, {
      readSessionConstraint: "first-unconstrained",
    });
    this.cache = kv ? new KVCacheService(kv) : new NoopCacheService();
    this.logger = new ConsoleLogger("AnalyticsService");
    this.env = env;
  }

  /**
   * Get dashboard data with caching
   */
  async getDashboardData(
    restaurantId?: string,
    period: string = "today",
  ): Promise<DashboardData> {
    try {
      this.logger.debug("Getting dashboard data", { restaurantId, period });

      // Try cache first
      const cacheKey = `analytics:dashboard:v2:${restaurantId || "all"}:${period}`;
      const cached = await this.cache.get<DashboardData>(cacheKey);
      if (cached) {
        this.logger.debug("Returning cached dashboard data");
        return cached;
      }

      // Get data from database service
      const dashboardData = await this.databaseService.getDashboardData(
        restaurantId ? String(restaurantId) : "",
      );

      if (!dashboardData) {
        throw notFound("Dashboard data not found", "DASHBOARD_DATA_NOT_FOUND");
      }

      const summary: DashboardSummary = dashboardData.summary;

      // Cache the result
      await this.cache.set(cacheKey, dashboardData, CACHE_TTL.SHORT);

      this.logger.info("Dashboard data retrieved successfully", {
        restaurantId,
        period,
        todayRevenue: summary.todayRevenue,
        todayOrders: summary.todayOrders,
      });

      return dashboardData;
    } catch (error) {
      this.logger.error("Failed to get dashboard data", error as Error, {
        restaurantId,
        period,
      });
      throw new Error("Failed to retrieve dashboard data");
    }
  }

  /**
   * Get revenue analytics with caching
   */
  async getRevenueAnalytics(filters: AnalyticsFilters): Promise<RevenueData[]> {
    try {
      this.logger.debug("Getting revenue analytics", filters);

      // Try cache first
      const cacheKey = `analytics:revenue:${JSON.stringify(filters)}`;
      const cached = await this.cache.get<RevenueData[]>(cacheKey);
      if (cached) {
        this.logger.debug("Returning cached revenue analytics");
        return cached;
      }

      // Get data from database service
      const revenueData = await this.databaseService.getRevenueAnalytics(
        toDbFilters(filters),
      );

      if (!revenueData) {
        return [];
      }

      // Cache the result
      await this.cache.set(cacheKey, revenueData, CACHE_TTL.MEDIUM);

      this.logger.info("Revenue analytics retrieved successfully", {
        restaurantId: filters.restaurantId,
        recordCount: revenueData.length,
      });

      return revenueData;
    } catch (error) {
      this.logger.error(
        "Failed to get revenue analytics",
        error as Error,
        filters,
      );
      throw new Error("Failed to retrieve revenue analytics");
    }
  }

  /**
   * Get product analytics with caching
   */
  async getProductAnalytics(
    filters: AnalyticsFilters,
  ): Promise<ProductAnalytics> {
    try {
      this.logger.debug("Getting product analytics", filters);

      // Try cache first
      const cacheKey = `analytics:products:${JSON.stringify(filters)}`;
      const cached = await this.cache.get<ProductAnalytics>(cacheKey);
      if (cached) {
        this.logger.debug("Returning cached product analytics");
        return cached;
      }

      // Get data from database service
      const productData = await this.databaseService.getMenuAnalytics(
        toDbFilters(filters),
      );

      if (!productData) {
        throw notFound(
          "Product analytics data not found",
          "PRODUCT_ANALYTICS_NOT_FOUND",
        );
      }

      // Cache the result
      await this.cache.set(cacheKey, productData, CACHE_TTL.MEDIUM);

      this.logger.info("Product analytics retrieved successfully", {
        restaurantId: filters.restaurantId,
        popularItemsCount: productData.popularItems.length,
        categoriesCount: productData.categoryPerformance.length,
      });

      return productData;
    } catch (error) {
      this.logger.error(
        "Failed to get product analytics",
        error as Error,
        filters,
      );
      throw new Error("Failed to retrieve product analytics");
    }
  }

  /**
   * Get customer analytics with caching
   */
  async getCustomerAnalytics(
    filters: AnalyticsFilters,
  ): Promise<CustomerAnalytics> {
    try {
      this.logger.debug("Getting customer analytics", filters);

      // Try cache first
      const cacheKey = `analytics:customers:${JSON.stringify(filters)}`;
      const cached = await this.cache.get<CustomerAnalytics>(cacheKey);
      if (cached) {
        this.logger.debug("Returning cached customer analytics");
        return cached;
      }

      // Get data from database service
      const customerData = await this.databaseService.getCustomerAnalytics(
        toDbFilters(filters),
      );

      if (!customerData) {
        throw notFound(
          "Customer analytics data not found",
          "CUSTOMER_ANALYTICS_NOT_FOUND",
        );
      }

      // Cache the result
      await this.cache.set(cacheKey, customerData, CACHE_TTL.MEDIUM);

      this.logger.info("Customer analytics retrieved successfully", {
        restaurantId: filters.restaurantId,
        totalCustomers: customerData.totalCustomers,
        newCustomers: customerData.newCustomers,
      });

      return customerData;
    } catch (error) {
      this.logger.error(
        "Failed to get customer analytics",
        error as Error,
        filters,
      );
      throw new Error("Failed to retrieve customer analytics");
    }
  }

  /**
   * Get performance analytics with caching
   */
  async getPerformanceAnalytics(
    filters: AnalyticsFilters,
  ): Promise<PerformanceAnalytics> {
    try {
      this.logger.debug("Getting performance analytics", filters);

      // Try cache first
      const cacheKey = `analytics:performance:${JSON.stringify(filters)}`;
      const cached = await this.cache.get<PerformanceAnalytics>(cacheKey);
      if (cached) {
        this.logger.debug("Returning cached performance analytics");
        return cached;
      }

      // Get data from database service
      const performanceData = await this.databaseService.getOrderAnalytics(
        toDbFilters(filters),
      );

      if (!performanceData) {
        throw notFound(
          "Performance analytics data not found",
          "PERFORMANCE_ANALYTICS_NOT_FOUND",
        );
      }

      // Cache the result
      await this.cache.set(cacheKey, performanceData, CACHE_TTL.MEDIUM);

      this.logger.info("Performance analytics retrieved successfully", {
        restaurantId: filters.restaurantId,
        totalOrders: performanceData.totalOrders,
        completedOrders: performanceData.completedOrders,
      });

      return performanceData;
    } catch (error) {
      this.logger.error(
        "Failed to get performance analytics",
        error as Error,
        filters,
      );
      throw new Error("Failed to retrieve performance analytics");
    }
  }

  /**
   * Get real-time analytics data
   */
  async getRealtimeData(restaurantId?: string): Promise<RealtimeAnalyticsData> {
    try {
      this.logger.debug("Getting real-time analytics data", { restaurantId });

      // Get fresh data directly from database service (no caching for real-time).
      // getRealtimeDashboard already fetches the full DashboardData it needs for
      // occupiedTables/todayRevenue and hands it back as `dashboard`, so read it
      // from there. Calling getDashboardData() separately ran the same nine
      // queries a second time — against a D1 primary that is a cross-region
      // round trip from wherever the Worker happens to run (#316).
      let dashboardSummary;
      let activeOrders = 0;
      let pendingOrders = 0;
      let tableUtilization = 0;

      if (restaurantId) {
        const realtimeDashboard =
          await this.databaseService.getRealtimeDashboard(String(restaurantId));
        dashboardSummary = realtimeDashboard.dashboard.summary;
        activeOrders = realtimeDashboard.activeOrders || 0;
        pendingOrders = realtimeDashboard.kitchenQueue || 0; // Kitchen queue = orders in preparing status

        // Calculate table utilization from full dashboard data (includes tableStatus)
        const totalTables = realtimeDashboard.dashboard.tableStatus?.total || 0;
        const occupiedTables = realtimeDashboard.occupiedTables || 0;
        tableUtilization =
          totalTables > 0
            ? Math.round((occupiedTables / totalTables) * 100)
            : 0;
      } else {
        // No restaurant scope (system admin): getDashboardData("") short-circuits
        // to the empty shape without touching the database.
        dashboardSummary = (await this.databaseService.getDashboardData(""))
          .summary;
      }

      const realtimeData: RealtimeAnalyticsData = {
        timestamp: new Date().toISOString(),
        summary: dashboardSummary,
        activeOrders,
        pendingOrders,
        tableUtilization,
      };

      this.logger.info("Real-time analytics data retrieved successfully", {
        restaurantId,
        timestamp: realtimeData.timestamp,
        activeOrders,
        pendingOrders,
        tableUtilization,
      });

      return realtimeData;
    } catch (error) {
      this.logger.error(
        "Failed to get real-time analytics data",
        error as Error,
        { restaurantId },
      );
      throw new Error("Failed to retrieve real-time analytics data");
    }
  }

  /**
   * Generate analytics export
   */
  async generateExport(request: ExportRequest): Promise<ExportResponse> {
    try {
      this.logger.debug("Generating analytics export", request);

      const timestamp = Date.now();
      const filename = `${request.type}_${timestamp}.${request.format}`;
      const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
      const filters: AnalyticsFilters = {
        restaurantId: request.restaurantId,
        dateFrom: request.dateFrom,
        dateTo: request.dateTo,
        groupBy: request.groupBy,
        limit: request.limit,
      };
      const data = await this.getExportData(request, filters);
      const generatedAt = new Date(timestamp).toISOString();
      const payload =
        request.format === "json"
          ? JSON.stringify(
              {
                metadata: {
                  type: request.type,
                  restaurantId: request.restaurantId,
                  dateFrom: request.dateFrom,
                  dateTo: request.dateTo,
                  groupBy: request.groupBy,
                  generatedAt,
                },
                data,
              },
              null,
              2,
            )
          : toCsv(data);
      const contentType =
        request.format === "json" ? "application/json" : "text/csv";
      const downloadUrl = `data:${contentType};charset=utf-8,${encodeURIComponent(
        payload,
      )}`;

      const response: ExportResponse = {
        success: true,
        message: `${request.type} export generated successfully`,
        data: {
          type: request.type,
          format: request.format,
          filename,
          content_type: contentType,
          size_bytes: new TextEncoder().encode(payload).byteLength,
          period: {
            from: request.dateFrom,
            to: request.dateTo,
          },
          download_url: downloadUrl,
          expires_at: expiresAt,
        },
      };

      this.logger.info("Analytics export generated successfully", {
        type: request.type,
        format: request.format,
        downloadUrl,
        sizeBytes: response.data.size_bytes,
      });

      return response;
    } catch (error) {
      this.logger.error(
        "Failed to generate analytics export",
        error as Error,
        request,
      );
      throw new Error("Failed to generate export");
    }
  }

  private async getExportData(
    request: ExportRequest,
    filters: AnalyticsFilters,
  ): Promise<unknown> {
    switch (request.type) {
      case "dashboard":
        return this.getDashboardData(
          request.restaurantId,
          typeof request.period === "string" ? request.period : undefined,
        );
      case "revenue":
        return this.getRevenueAnalytics(filters);
      case "products":
        return this.getProductAnalytics(filters);
      case "customers":
        return this.getCustomerAnalytics(filters);
      case "performance":
        return this.getPerformanceAnalytics(filters);
      default:
        throw new Error(`Unsupported export type: ${request.type}`);
    }
  }

  /**
   * Get financial report data
   */
  async getFinancialReport(
    filters: AnalyticsFilters,
  ): Promise<FinancialReportData> {
    try {
      this.logger.debug("Getting financial report", filters);

      // Try cache first
      const cacheKey = `analytics:financial:${JSON.stringify(filters)}`;
      const cached = await this.cache.get<FinancialReportData>(cacheKey);
      if (cached) {
        this.logger.debug("Returning cached financial report");
        return cached;
      }

      // Get data from database service - convert restaurantId to string
      const dbFilters = {
        ...filters,
        restaurantId: filters.restaurantId
          ? String(filters.restaurantId)
          : undefined,
      };
      const rawFinancialData =
        await this.databaseService.getFinancialReport(dbFilters);

      if (!rawFinancialData) {
        throw notFound(
          "Financial report data not found",
          "FINANCIAL_REPORT_NOT_FOUND",
        );
      }

      // Transform the raw data to match our interface
      const financialData: FinancialReportData = {
        totalRevenue: rawFinancialData.summary?.totalRevenue ?? [],
        totalOrders: rawFinancialData.summary?.totalOrders || 0,
        averageOrderValue: rawFinancialData.summary?.averageOrderValue ?? [],
        taxAmount: rawFinancialData.summary?.taxAmount ?? [],
        netRevenue: rawFinancialData.summary?.netRevenue ?? [],
        ...(filters.dateFrom && filters.dateTo
          ? {
              periodComparison: {
                previousPeriodRevenue:
                  rawFinancialData.summary?.previousPeriodRevenue ?? [],
                growthRate: rawFinancialData.summary?.growthRate ?? [],
              },
            }
          : {}),
        breakdown: this.buildRevenueBreakdown(
          filters.groupBy,
          rawFinancialData.revenueBreakdown?.byDay ?? [],
        ),
      };

      // Cache the result
      await this.cache.set(cacheKey, financialData, CACHE_TTL.LONG);

      this.logger.info("Financial report retrieved successfully", {
        restaurantId: filters.restaurantId,
        period: filters.period,
        totalRevenue: financialData.totalRevenue,
      });

      return financialData;
    } catch (error) {
      this.logger.error(
        "Failed to get financial report",
        error as Error,
        filters,
      );
      throw new Error("Failed to retrieve financial report");
    }
  }

  /**
   * Reshape the one bucket list the database returns into the period-keyed
   * breakdown this endpoint publishes.
   *
   * The database groups by `groupBy` and labels every bucket `date`; the
   * response names the grain twice — once in the key, once in the label field
   * — so the mapping has to follow the same filter that produced the buckets.
   */
  private buildRevenueBreakdown(
    groupBy: AnalyticsFilters["groupBy"],
    buckets: Array<{
      date: string;
      revenue: RevenueData["revenue"];
      orderCount: number;
    }>,
  ): FinancialReportData["breakdown"] {
    switch (groupBy) {
      case "week":
        return {
          weekly: buckets.map((bucket) => ({
            week: bucket.date,
            revenue: bucket.revenue,
            orders: bucket.orderCount,
          })),
        };
      case "month":
        return {
          monthly: buckets.map((bucket) => ({
            month: bucket.date,
            revenue: bucket.revenue,
            orders: bucket.orderCount,
          })),
        };
      case "year":
        return {
          yearly: buckets.map((bucket) => ({
            year: bucket.date,
            revenue: bucket.revenue,
            orders: bucket.orderCount,
          })),
        };
      // The database layer defaults to day grouping when none is given.
      default:
        return {
          daily: buckets.map((bucket) => ({
            date: bucket.date,
            revenue: bucket.revenue,
            orders: bucket.orderCount,
          })),
        };
    }
  }

  /**
   * Clear analytics cache
   */
  async clearCache(restaurantId?: string): Promise<void> {
    try {
      this.logger.debug("Clearing analytics cache", { restaurantId });

      const pattern = restaurantId
        ? `analytics:*:${restaurantId}:*`
        : "analytics:*";

      await this.cache.clear(pattern);

      this.logger.info("Analytics cache cleared successfully", {
        restaurantId,
      });
    } catch (error) {
      this.logger.error("Failed to clear analytics cache", error as Error, {
        restaurantId,
      });
      // Don't throw here as cache clearing failure shouldn't break the main flow
    }
  }
}
