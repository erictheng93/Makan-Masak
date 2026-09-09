/**
 * AI Insights Service
 * Generates business insights using LLM providers
 */

import { v7 as uuidv7 } from "uuid";
import { createProvider } from "../providers";
import type { BaseLLMProvider } from "../providers";
import type {
  AIAnalyticsReport,
  AIInsight,
  BusinessMetrics,
  LLMConfig,
  TimeRangeParams,
} from "../types";
import { ProductAnalysisService } from "./ProductAnalysisService";
import type { DrizzleDb } from "./ProductAnalysisService";

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
}

interface PeakHourData {
  hour: number;
  orderCount: number;
  revenue: number;
}

interface PeakDayData {
  dayOfWeek: number;
  orderCount: number;
  revenue: number;
}

interface DailyMetricData {
  date: string;
  revenue: number;
  orders: number;
  avgOrderValue: number;
  profit?: number;
}

export class AIInsightsService {
  private productAnalysis: ProductAnalysisService;

  constructor(
    private db: D1Database,
    drizzleDb: DrizzleDb,
  ) {
    // ProductAnalysisService uses Drizzle Layer 2 queries
    this.productAnalysis = new ProductAnalysisService(drizzleDb);
  }

  /**
   * Generate complete AI analytics report
   */
  async generateReport(
    restaurantId: string,
    llmConfig: LLMConfig,
    timeRange: TimeRangeParams,
    options: {
      includeForecasting?: boolean;
      refreshCache?: boolean;
    } = {},
  ): Promise<AIAnalyticsReport> {
    const startTime = Date.now();

    // 1. Check cache if not forcing refresh
    if (!options.refreshCache) {
      const cached = await this.getCachedReport(restaurantId, timeRange);
      if (cached) return cached;
    }

    // 2. Gather business metrics
    const metrics = await this.gatherBusinessMetrics(restaurantId, timeRange);

    // 3. Generate AI insights
    const llmProvider = createProvider(llmConfig);
    const insights = await this.generateInsights(
      metrics,
      llmProvider,
      llmConfig,
    );

    // 4. Generate executive summary
    const executiveSummary = await this.generateExecutiveSummary(
      metrics,
      insights,
      llmProvider,
    );

    // 5. Optional: Generate forecast
    let forecast;
    if (options.includeForecasting) {
      forecast = await this.generateForecast(metrics, llmProvider);
    }

    const processingTime = Date.now() - startTime;

    const report: AIAnalyticsReport = {
      id: uuidv7(),
      restaurantId,
      generatedAt: new Date().toISOString(),
      timeRange,
      metrics,
      insights,
      executiveSummary,
      forecast,
      metadata: {
        llmProvider: llmConfig.provider,
        llmModel: llmProvider.getModel(),
        processingTimeMs: processingTime,
      },
    };

    // 6. Cache the report
    await this.cacheReport(report);

    return report;
  }

  /**
   * Gather comprehensive business metrics
   */
  private async gatherBusinessMetrics(
    restaurantId: string,
    timeRange: TimeRangeParams,
  ): Promise<BusinessMetrics> {
    const { startDate, endDate } = this.getDateRange(timeRange);

    // Fetch overall metrics.
    // Real schema: monetary columns are integer *cents* (total_amount_cents),
    // the customer FK is customer_id, and timestamps are Unix-ms (created_at_ms).
    // Revenue/AOV are divided by 100 so downstream code sees major units.
    // orders.status has no "completed" value — fulfilled orders are paid/delivered.
    const overallQuery = `
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount_cents), 0) / 100.0 AS total_revenue,
        COALESCE(AVG(total_amount_cents), 0) / 100.0 AS avg_order_value,
        COUNT(DISTINCT customer_id) AS unique_customers
      FROM orders
      WHERE restaurant_id = ?
        AND DATE(created_at_ms / 1000, 'unixepoch') BETWEEN ? AND ?
        AND status IN ('paid', 'delivered')
    `;

    const overall = await this.db
      .prepare(overallQuery)
      .bind(restaurantId, startDate, endDate)
      .first<{
        total_orders: number;
        total_revenue: number;
        avg_order_value: number;
        unique_customers: number;
      }>();

    // Fetch peak hours
    const peakHoursQuery = `
      SELECT
        CAST(strftime('%H', created_at_ms / 1000, 'unixepoch') AS INTEGER) AS hour,
        COUNT(*) AS orderCount,
        COALESCE(SUM(total_amount_cents), 0) / 100.0 AS revenue
      FROM orders
      WHERE restaurant_id = ?
        AND DATE(created_at_ms / 1000, 'unixepoch') BETWEEN ? AND ?
        AND status IN ('paid', 'delivered')
      GROUP BY hour
      ORDER BY orderCount DESC
      LIMIT 5
    `;

    const peakHours = await this.db
      .prepare(peakHoursQuery)
      .bind(restaurantId, startDate, endDate)
      .all<PeakHourData>();

    // Fetch peak days
    const peakDaysQuery = `
      SELECT
        CAST(strftime('%w', created_at_ms / 1000, 'unixepoch') AS INTEGER) AS dayOfWeek,
        COUNT(*) AS orderCount,
        COALESCE(SUM(total_amount_cents), 0) / 100.0 AS revenue
      FROM orders
      WHERE restaurant_id = ?
        AND DATE(created_at_ms / 1000, 'unixepoch') BETWEEN ? AND ?
        AND status IN ('paid', 'delivered')
      GROUP BY dayOfWeek
      ORDER BY orderCount DESC
    `;

    const peakDays = await this.db
      .prepare(peakDaysQuery)
      .bind(restaurantId, startDate, endDate)
      .all<PeakDayData>();

    // Fetch daily metrics
    const dailyQuery = `
      SELECT
        DATE(created_at_ms / 1000, 'unixepoch') AS date,
        COALESCE(SUM(total_amount_cents), 0) / 100.0 AS revenue,
        COUNT(*) AS orders,
        COALESCE(AVG(total_amount_cents), 0) / 100.0 AS avgOrderValue
      FROM orders
      WHERE restaurant_id = ?
        AND DATE(created_at_ms / 1000, 'unixepoch') BETWEEN ? AND ?
        AND status IN ('paid', 'delivered')
      GROUP BY DATE(created_at_ms / 1000, 'unixepoch')
      ORDER BY date ASC
    `;

    const dailyMetrics = await this.db
      .prepare(dailyQuery)
      .bind(restaurantId, startDate, endDate)
      .all<DailyMetricData>();

    // Get product analyses
    const topProducts = await this.productAnalysis.getBestsellers(
      restaurantId,
      timeRange,
      10,
    );
    const trafficDrivers = await this.productAnalysis.getTrafficDrivers(
      restaurantId,
      timeRange,
      10,
    );
    const profitLeaders = await this.productAnalysis.getProfitLeaders(
      restaurantId,
      timeRange,
      10,
    );
    const underperformers = await this.productAnalysis.getUnderperformers(
      restaurantId,
      timeRange,
      5,
    );

    // Calculate growth (compare to previous period)
    const previousPeriodMetrics = await this.getPreviousPeriodMetrics(
      restaurantId,
      startDate,
      endDate,
    );

    const revenueGrowth =
      previousPeriodMetrics.revenue > 0
        ? ((overall!.total_revenue - previousPeriodMetrics.revenue) /
            previousPeriodMetrics.revenue) *
          100
        : 0;

    const orderGrowth =
      previousPeriodMetrics.orders > 0
        ? ((overall!.total_orders - previousPeriodMetrics.orders) /
            previousPeriodMetrics.orders) *
          100
        : 0;

    return {
      restaurantId,
      timeRange,
      generatedAt: new Date().toISOString(),
      totalRevenue: overall?.total_revenue || 0,
      totalOrders: overall?.total_orders || 0,
      averageOrderValue: overall?.avg_order_value || 0,
      revenueGrowth,
      orderGrowth,
      uniqueCustomers: overall?.unique_customers || 0,
      repeatCustomerRate: 0, // TODO: Calculate from user order history
      averageOrdersPerCustomer: overall?.unique_customers
        ? (overall?.total_orders || 0) / overall.unique_customers
        : 0,
      peakHours: peakHours.results || [],
      peakDays: peakDays.results || [],
      topProducts,
      trafficDrivers,
      profitLeaders,
      underperformers,
      dailyMetrics: dailyMetrics.results || [],
    };
  }

  /**
   * Generate AI insights from metrics
   */
  private async generateInsights(
    metrics: BusinessMetrics,
    llmProvider: BaseLLMProvider,
    _llmConfig: LLMConfig,
  ): Promise<AIInsight[]> {
    const prompt = this.buildInsightsPrompt(metrics);

    const response = await llmProvider.chat({
      systemPrompt: `你是一位資深餐廳業務分析專家，擅長從數據中發現洞察並提供可行的建議。
請分析提供的業務指標，生成 5-8 條關鍵洞察。

每條洞察必須包含：
- type: 'observation' | 'recommendation' | 'warning' | 'opportunity'
- category: 'sales' | 'profit' | 'customer' | 'operations' | 'product'
- title: 簡短標題（15字以內）
- description: 詳細說明（50-100字）
- impact: 'high' | 'medium' | 'low'
- confidence: 0-1 的數字
- actionable: true/false
- suggestedActions: 具體行動建議數組（如果 actionable 為 true）

請以 JSON 數組格式回應，不要包含其他文字。`,
      prompt,
      maxTokens: 2048,
      temperature: 0.7,
      responseFormat: "json",
    });

    try {
      const insights = JSON.parse(response.content);
      return Array.isArray(insights)
        ? insights.map((insight, index) => ({
            id: `insight-${index + 1}`,
            ...insight,
          }))
        : [];
    } catch (error) {
      console.error("Failed to parse AI insights:", error);
      return [];
    }
  }

  /**
   * Generate executive summary
   */
  private async generateExecutiveSummary(
    metrics: BusinessMetrics,
    insights: AIInsight[],
    llmProvider: BaseLLMProvider,
  ): Promise<string> {
    const prompt = `
基於以下業務數據和洞察，生成一份簡潔的執行摘要（200-300字）：

業務指標：
- 總營收：$${metrics.totalRevenue.toFixed(2)}（${metrics.revenueGrowth > 0 ? "+" : ""}${metrics.revenueGrowth.toFixed(1)}%）
- 總訂單：${metrics.totalOrders}（${metrics.orderGrowth > 0 ? "+" : ""}${metrics.orderGrowth.toFixed(1)}%）
- 平均客單價：$${metrics.averageOrderValue.toFixed(2)}

熱銷產品：${metrics.topProducts
      .slice(0, 3)
      .map((p) => p.menuItemName)
      .join("、")}

關鍵洞察：
${insights
  .slice(0, 3)
  .map((i) => `- ${i.title}: ${i.description}`)
  .join("\n")}

請用專業但易懂的語言總結：
1. 整體業務表現
2. 主要亮點
3. 需要關注的領域
4. 下一步建議

直接輸出摘要文字，不需要標題或前綴。
    `;

    const response = await llmProvider.chat({
      prompt,
      maxTokens: 512,
      temperature: 0.7,
    });

    return response.content.trim();
  }

  /**
   * Generate forecast
   */
  private async generateForecast(
    metrics: BusinessMetrics,
    _llmProvider: BaseLLMProvider,
  ): Promise<NonNullable<AIAnalyticsReport["forecast"]>> {
    // Simple forecasting based on recent trends
    const recentDays = metrics.dailyMetrics.slice(-7);
    const avgDailyRevenue =
      recentDays.reduce((sum, d) => sum + d.revenue, 0) / recentDays.length;
    const avgDailyOrders =
      recentDays.reduce((sum, d) => sum + d.orders, 0) / recentDays.length;

    // Apply growth trend
    const growthFactor = 1 + metrics.revenueGrowth / 100;

    return {
      nextWeekRevenue: {
        predicted: avgDailyRevenue * 7 * growthFactor,
        confidenceLower: avgDailyRevenue * 7 * growthFactor * 0.85,
        confidenceUpper: avgDailyRevenue * 7 * growthFactor * 1.15,
      },
      nextWeekOrders: {
        predicted: Math.round(avgDailyOrders * 7 * growthFactor),
        confidenceLower: Math.round(avgDailyOrders * 7 * growthFactor * 0.85),
        confidenceUpper: Math.round(avgDailyOrders * 7 * growthFactor * 1.15),
      },
    };
  }

  /**
   * Build insights prompt
   */
  private buildInsightsPrompt(metrics: BusinessMetrics): string {
    return `
分析以下餐廳業務數據（時間範圍：${metrics.timeRange.range}）：

## 總體表現
- 總營收：$${metrics.totalRevenue.toFixed(2)}
- 營收增長：${metrics.revenueGrowth > 0 ? "+" : ""}${metrics.revenueGrowth.toFixed(1)}%
- 總訂單：${metrics.totalOrders}
- 訂單增長：${metrics.orderGrowth > 0 ? "+" : ""}${metrics.orderGrowth.toFixed(1)}%
- 平均客單價：$${metrics.averageOrderValue.toFixed(2)}

## 客戶數據
- 獨立客戶：${metrics.uniqueCustomers}
- 人均訂單：${metrics.averageOrdersPerCustomer.toFixed(1)}

## 熱銷產品（Top 5）
${metrics.topProducts
  .slice(0, 5)
  .map(
    (p, i) =>
      `${i + 1}. ${p.menuItemName}：${p.totalOrders}單，$${p.totalRevenue.toFixed(2)}`,
  )
  .join("\n")}

## 引流產品（Top 3）
${metrics.trafficDrivers
  .slice(0, 3)
  .map(
    (p, i) =>
      `${i + 1}. ${p.menuItemName}：${p.firstItemInOrderCount}次作為首選，轉換率${(p.conversionRate * 100).toFixed(1)}%`,
  )
  .join("\n")}

## 利潤領先產品（Top 3）
${metrics.profitLeaders
  .slice(0, 3)
  .map(
    (p, i) =>
      `${i + 1}. ${p.menuItemName}：利潤$${(p.totalProfit || 0).toFixed(2)}，利潤率${((p.profitMargin || 0) * 100).toFixed(1)}%`,
  )
  .join("\n")}

## 營業高峰
- 高峰時段：${metrics.peakHours[0]?.hour}:00（${metrics.peakHours[0]?.orderCount}單）
- 高峰日：星期${["日", "一", "二", "三", "四", "五", "六"][metrics.peakDays[0]?.dayOfWeek || 0]}（${metrics.peakDays[0]?.orderCount}單）

請生成 JSON 格式的洞察數組。
    `;
  }

  // Helper methods
  private getDateRange(timeRange: TimeRangeParams): {
    startDate: string;
    endDate: string;
  } {
    const now = new Date();

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

    const daysMap: Record<string, number> = {
      "7d": 7,
      "14d": 14,
      "30d": 30,
      "90d": 90,
      "180d": 180,
      "1y": 365,
    };

    const days = daysMap[timeRange.range] || 30;
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return {
      startDate: startDate.toISOString().split("T")[0],
      endDate: now.toISOString().split("T")[0],
    };
  }

  private async getPreviousPeriodMetrics(
    restaurantId: string,
    startDate: string,
    endDate: string,
  ): Promise<{ revenue: number; orders: number }> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const periodDays = Math.ceil(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    );

    const previousStart = new Date(
      start.getTime() - periodDays * 24 * 60 * 60 * 1000,
    );
    const previousEnd = start;

    const query = `
      SELECT
        COALESCE(SUM(total_amount_cents), 0) / 100.0 AS revenue,
        COUNT(*) AS orders
      FROM orders
      WHERE restaurant_id = ?
        AND DATE(created_at_ms / 1000, 'unixepoch') BETWEEN ? AND ?
        AND status IN ('paid', 'delivered')
    `;

    const result = await this.db
      .prepare(query)
      .bind(
        restaurantId,
        previousStart.toISOString().split("T")[0],
        previousEnd.toISOString().split("T")[0],
      )
      .first<{ revenue: number; orders: number }>();

    return result || { revenue: 0, orders: 0 };
  }

  private async getCachedReport(
    restaurantId: string,
    timeRange: TimeRangeParams,
  ): Promise<AIAnalyticsReport | null> {
    // Unix ms, not an ISO string: `expires_at_ms > ?` has to be a numeric
    // comparison. The previous shape compared ISO text lexicographically,
    // which is the same defect #271 removed from coupons.
    const now = Date.now();
    const query = `
      SELECT data
      FROM ai_insights_cache
      WHERE restaurant_id = ?
        AND insight_type = 'full_report'
        AND time_range = ?
        AND expires_at_ms > ?
      ORDER BY generated_at_ms DESC
      LIMIT 1
    `;

    const result = await this.db
      .prepare(query)
      .bind(restaurantId, timeRange.range, now)
      .first<{ data: string }>();

    if (result) {
      try {
        return JSON.parse(result.data);
      } catch {
        return null;
      }
    }

    return null;
  }

  private async cacheReport(report: AIAnalyticsReport): Promise<void> {
    const now = Date.now();
    const expiresAtMs = now + 6 * 60 * 60 * 1000; // 6 hours

    // The table is STRICT, so an ISO string in an INTEGER column is a hard
    // error rather than SQLite quietly storing text — which is the point.
    const query = `
      INSERT INTO ai_insights_cache (
        id,
        restaurant_id,
        insight_type,
        time_range,
        data,
        confidence_score,
        generated_at_ms,
        expires_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (restaurant_id, insight_type, time_range)
      DO UPDATE SET
        data = excluded.data,
        confidence_score = excluded.confidence_score,
        generated_at_ms = excluded.generated_at_ms,
        expires_at_ms = excluded.expires_at_ms
    `;

    await this.db
      .prepare(query)
      .bind(
        crypto.randomUUID(),
        report.restaurantId,
        "full_report",
        report.timeRange.range,
        JSON.stringify(report),
        0.85,
        now,
        expiresAtMs,
      )
      .run();
  }
}
