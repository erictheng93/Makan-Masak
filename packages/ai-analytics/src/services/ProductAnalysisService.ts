/**
 * Product Analysis Service
 * Analyzes menu items to identify:
 * - 引流產品 (Traffic Drivers): Products that bring customers in
 * - 熱銷產品 (Bestsellers): Top-selling products by volume
 * - 利潤最大產品 (Profit Leaders): Most profitable products
 *
 * Uses Drizzle ORM Layer 2 (sql template + schema references)
 * for type-safe raw SQL with compile-time column name checking.
 */

import {
  and,
  between,
  categories,
  eq,
  FULFILLED_ORDER_STATUSES,
  inArray,
  menuItems,
  orderItems,
  orders,
  REVENUE_RECOGNISED_PAYMENT_STATUSES,
  sql,
  type createDatabase,
} from "@makanmasak/database";
import type {
  ProductAnalysis,
  ProductCategory,
  TimeRangeParams,
} from "../types";

interface RawProductMetrics {
  menu_item_id: number;
  menu_item_name: string;
  category: string;
  unit_price: number;
  unit_cost: number | null;
  total_orders: number;
  total_revenue: number;
  first_item_count: number;
  view_count: number;
  cart_addition_count: number;
}

interface DailyMetric {
  date: string;
  orders: number;
  revenue: number;
}

export type DrizzleDb = ReturnType<typeof createDatabase>;

type ProductAnalysisRow = RawProductMetrics & {
  dailyData: DailyMetric[];
  trendScore: number;
  growthRate: number;
  salesRank: number;
  revenueRank: number;
  profitRank?: number;
  categories: ProductCategory[];
};

export class ProductAnalysisService {
  constructor(private db: DrizzleDb) {}

  /**
   * Analyze all products for a restaurant within a time range
   */
  async analyzeProducts(
    restaurantId: string,
    timeRange: TimeRangeParams,
  ): Promise<ProductAnalysis[]> {
    const { startDate, endDate } = this.getDateRange(timeRange);

    // 1. Fetch raw metrics
    const rawMetrics = await this.fetchRawMetrics(
      restaurantId,
      startDate,
      endDate,
    );

    if (rawMetrics.length === 0) {
      return [];
    }

    // 2. Calculate derived metrics
    const productsWithMetrics = await Promise.all(
      rawMetrics.map(async (raw) => {
        const dailyData = await this.fetchDailyData(
          raw.menu_item_id,
          startDate,
          endDate,
        );
        const trendScore = this.calculateTrendScore(dailyData);
        const growthRate = this.calculateGrowthRate(dailyData);

        return {
          ...raw,
          dailyData,
          trendScore,
          growthRate,
        };
      }),
    );

    // 3. Calculate rankings
    const withRankings = this.calculateRankings(productsWithMetrics);

    // 4. Categorize products
    const categorized = withRankings.map((product) => ({
      ...product,
      categories: this.categorizeProduct(product),
    }));

    // 5. Convert to ProductAnalysis format
    return categorized.map(this.toProductAnalysis);
  }

  /**
   * Get top traffic drivers (引流產品)
   */
  async getTrafficDrivers(
    restaurantId: string,
    timeRange: TimeRangeParams,
    limit: number = 10,
  ): Promise<ProductAnalysis[]> {
    const allProducts = await this.analyzeProducts(restaurantId, timeRange);

    return allProducts
      .filter((p) => p.categories.includes("traffic-driver"))
      .sort((a, b) => b.firstItemInOrderCount - a.firstItemInOrderCount)
      .slice(0, limit);
  }

  /**
   * Get bestsellers (熱銷產品)
   */
  async getBestsellers(
    restaurantId: string,
    timeRange: TimeRangeParams,
    limit: number = 10,
  ): Promise<ProductAnalysis[]> {
    const allProducts = await this.analyzeProducts(restaurantId, timeRange);

    return allProducts
      .sort((a, b) => b.totalOrders - a.totalOrders)
      .slice(0, limit);
  }

  /**
   * Get profit leaders (利潤最大產品)
   */
  async getProfitLeaders(
    restaurantId: string,
    timeRange: TimeRangeParams,
    limit: number = 10,
  ): Promise<ProductAnalysis[]> {
    const allProducts = await this.analyzeProducts(restaurantId, timeRange);

    return allProducts
      .filter((p) => p.totalProfit !== undefined && p.totalProfit > 0)
      .sort((a, b) => (b.totalProfit || 0) - (a.totalProfit || 0))
      .slice(0, limit);
  }

  /**
   * Get underperforming products
   */
  async getUnderperformers(
    restaurantId: string,
    timeRange: TimeRangeParams,
    limit: number = 10,
  ): Promise<ProductAnalysis[]> {
    const allProducts = await this.analyzeProducts(restaurantId, timeRange);

    return allProducts
      .filter((p) => p.categories.includes("underperformer"))
      .sort((a, b) => a.trendScore - b.trendScore) // Most negative trend first
      .slice(0, limit);
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private getDateRange(timeRange: TimeRangeParams): {
    startDate: string;
    endDate: string;
  } {
    const now = new Date();
    let startDate: Date;

    if (
      timeRange.range === "custom" &&
      timeRange.startDate &&
      timeRange.endDate
    ) {
      return {
        startDate: timeRange.startDate,
        endDate: timeRange.endDate,
      };
    }

    switch (timeRange.range) {
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "14d":
        startDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "180d":
        startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        break;
      case "1y":
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return {
      startDate: startDate.toISOString().split("T")[0],
      endDate: now.toISOString().split("T")[0],
    };
  }

  /**
   * Layer 2 query: Drizzle sql template with schema column references.
   * Column renames in the schema will cause compile-time errors here.
   */
  private async fetchRawMetrics(
    restaurantId: string,
    startDate: string,
    endDate: string,
  ): Promise<RawProductMetrics[]> {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate + "T23:59:59.999Z").getTime();

    const result = await this.db
      .select({
        menu_item_id: menuItems.id,
        menu_item_name: menuItems.name,
        category: sql<string>`COALESCE(${categories.name}, '')`,
        unit_price: sql<number>`${menuItems.priceCents} / 100.0`,
        unit_cost: sql<number | null>`CASE
          WHEN ${menuItems.costPriceCents} IS NULL THEN NULL
          ELSE ${menuItems.costPriceCents} / 100.0
        END`,
        total_orders: sql<number>`COALESCE(COUNT(DISTINCT ${orders.id}), 0)`,
        total_revenue: sql<number>`COALESCE(SUM(CASE
          WHEN ${inArray(
            orders.paymentStatus,
            REVENUE_RECOGNISED_PAYMENT_STATUSES,
          )}
          THEN ${orderItems.totalPriceCents}
          ELSE 0
        END), 0) / 100.0`,
        first_item_count: sql<number>`0`,
        view_count: sql<number>`COALESCE(${menuItems.viewCount}, 0)`,
        cart_addition_count: sql<number>`0`,
      })
      .from(menuItems)
      .leftJoin(orderItems, eq(menuItems.id, orderItems.menuItemId))
      .leftJoin(
        orders,
        and(
          eq(orderItems.orderId, orders.id),
          eq(orders.restaurantId, restaurantId),
          between(orders.createdAt, new Date(startMs), new Date(endMs)),
          inArray(orders.status, FULFILLED_ORDER_STATUSES),
        ),
      )
      .leftJoin(categories, eq(menuItems.categoryId, categories.id))
      .where(
        and(
          eq(menuItems.restaurantId, restaurantId),
          eq(menuItems.isAvailable, true),
        ),
      )
      .groupBy(menuItems.id)
      .orderBy(sql`COUNT(DISTINCT ${orders.id}) DESC`);

    return result;
  }

  /**
   * Layer 2 query: Daily order/revenue data for trend analysis.
   */
  private async fetchDailyData(
    menuItemId: number,
    startDate: string,
    endDate: string,
  ): Promise<DailyMetric[]> {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate + "T23:59:59.999Z").getTime();

    const result = await this.db
      .select({
        date: sql<string>`DATE(${orders.createdAt} / 1000, 'unixepoch')`,
        orders: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(CASE
          WHEN ${inArray(
            orders.paymentStatus,
            REVENUE_RECOGNISED_PAYMENT_STATUSES,
          )}
          THEN ${orderItems.totalPriceCents}
          ELSE 0
        END), 0) / 100.0`,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orders.id, orderItems.orderId))
      .where(
        and(
          eq(orderItems.menuItemId, menuItemId),
          between(orders.createdAt, new Date(startMs), new Date(endMs)),
          inArray(orders.status, FULFILLED_ORDER_STATUSES),
        ),
      )
      .groupBy(sql`DATE(${orders.createdAt} / 1000, 'unixepoch')`)
      .orderBy(sql`DATE(${orders.createdAt} / 1000, 'unixepoch') ASC`);

    return result;
  }

  private calculateTrendScore(dailyData: DailyMetric[]): number {
    if (dailyData.length < 2) return 0;

    // Simple linear regression to calculate trend
    const n = dailyData.length;
    const xValues = Array.from({ length: n }, (_, i) => i);
    const yValues = dailyData.map((d) => d.orders);

    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // Normalize slope to -1 to 1 range
    const avgY = sumY / n;
    const normalizedSlope = avgY > 0 ? slope / avgY : 0;

    return Math.max(-1, Math.min(1, normalizedSlope));
  }

  private calculateGrowthRate(dailyData: DailyMetric[]): number {
    if (dailyData.length < 2) return 0;

    const halfPoint = Math.floor(dailyData.length / 2);
    const firstHalf = dailyData.slice(0, halfPoint);
    const secondHalf = dailyData.slice(halfPoint);

    const firstHalfAvg =
      firstHalf.reduce((sum, d) => sum + d.orders, 0) / firstHalf.length;
    const secondHalfAvg =
      secondHalf.reduce((sum, d) => sum + d.orders, 0) / secondHalf.length;

    if (firstHalfAvg === 0) return secondHalfAvg > 0 ? 100 : 0;

    return ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;
  }

  private calculateRankings<
    T extends {
      menu_item_id: number;
      total_orders: number;
      total_revenue: number;
      unit_cost: number | null;
      unit_price: number;
    },
  >(
    products: T[],
  ): (T & { salesRank: number; revenueRank: number; profitRank?: number })[] {
    // Sort by orders
    const byOrders = [...products].sort(
      (a, b) => b.total_orders - a.total_orders,
    );
    const orderRankMap = new Map(
      byOrders.map((p, i) => [p.menu_item_id, i + 1]),
    );

    // Sort by revenue
    const byRevenue = [...products].sort(
      (a, b) => b.total_revenue - a.total_revenue,
    );
    const revenueRankMap = new Map(
      byRevenue.map((p, i) => [p.menu_item_id, i + 1]),
    );

    // Sort by profit (if cost data available)
    const productsWithCost = products.filter((p) => p.unit_cost !== null);
    const byProfit = productsWithCost
      .map((p) => ({
        ...p,
        totalProfit: (p.unit_price - (p.unit_cost || 0)) * p.total_orders,
      }))
      .sort((a, b) => b.totalProfit - a.totalProfit);
    const profitRankMap = new Map(
      byProfit.map((p, i) => [p.menu_item_id, i + 1]),
    );

    return products.map((p) => ({
      ...p,
      salesRank: orderRankMap.get(p.menu_item_id) || 0,
      revenueRank: revenueRankMap.get(p.menu_item_id) || 0,
      profitRank: profitRankMap.get(p.menu_item_id),
    }));
  }

  private categorizeProduct(product: {
    total_orders: number;
    first_item_count: number;
    cart_addition_count: number;
    view_count: number;
    trendScore: number;
    salesRank: number;
    unit_cost: number | null;
    unit_price: number;
  }): ProductCategory[] {
    const categories: ProductCategory[] = [];

    // Traffic driver: High first-item count and good conversion
    const trafficDriverScore =
      product.first_item_count / Math.max(product.total_orders, 1);
    if (trafficDriverScore > 0.3 && product.first_item_count >= 5) {
      categories.push("traffic-driver");
    }

    // Bestseller: Top 20% in sales rank
    if (product.salesRank <= Math.ceil(product.salesRank * 0.2)) {
      categories.push("bestseller");
    }

    // Profit leader: High profit margin and significant volume
    if (product.unit_cost !== null) {
      const profitMargin =
        (product.unit_price - product.unit_cost) / product.unit_price;
      if (profitMargin > 0.5 && product.total_orders >= 10) {
        categories.push("profit-leader");
      }
    }

    // Underperformer: Negative trend and low sales
    if (
      product.trendScore < -0.3 ||
      (product.total_orders < 5 && product.trendScore < 0)
    ) {
      categories.push("underperformer");
    }

    return categories;
  }

  private toProductAnalysis = (
    product: ProductAnalysisRow,
  ): ProductAnalysis => {
    const profitMargin =
      product.unit_cost !== null
        ? (product.unit_price - product.unit_cost) / product.unit_price
        : undefined;

    const totalProfit =
      product.unit_cost !== null
        ? (product.unit_price - product.unit_cost) * product.total_orders
        : undefined;

    const conversionRate =
      product.cart_addition_count > 0
        ? product.total_orders / product.cart_addition_count
        : 0;

    const cartAdditionRate =
      product.view_count > 0
        ? product.cart_addition_count / product.view_count
        : 0;

    return {
      menuItemId: product.menu_item_id,
      menuItemName: product.menu_item_name,
      category: product.category,
      totalOrders: product.total_orders,
      totalRevenue: product.total_revenue,
      averageOrderValue:
        product.total_orders > 0
          ? product.total_revenue / product.total_orders
          : 0,
      unitCost: product.unit_cost ?? undefined,
      unitPrice: product.unit_price,
      profitMargin,
      totalProfit,
      firstItemInOrderCount: product.first_item_count,
      cartAdditionRate,
      conversionRate,
      trendScore: product.trendScore,
      growthRate: product.growthRate,
      salesRank: product.salesRank,
      revenueRank: product.revenueRank,
      profitRank: product.profitRank,
      categories: product.categories,
      dailyData: product.dailyData,
    };
  };
}
