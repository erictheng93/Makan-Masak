/**
 * Monitoring Service
 * Frontend service layer for system monitoring and alerting
 */

import { api } from "./api";
import type {
  HealthStatus,
  SystemMetrics,
  MonitoringOverview,
  PerformanceReport,
  AlertRule,
  CreateAlertRuleRequest,
  UpdateAlertRuleRequest,
  RecordErrorRequest,
  TestAlertRequest,
  MetricsQueryParams,
  PerformanceReportParams,
  AlertRulesPagination,
  PaginatedAlertRulesResponse,
} from "@/types/monitoring";

/** Metric groups the health score can draw on. Mirrors SystemMetrics.measured. */
export type HealthMetricGroup =
  | "api"
  | "database"
  | "cache"
  | "resources"
  | "errors";

export interface RecentAlert {
  id: string;
  severity?: "info" | "warning" | "critical" | "fatal";
  title?: string;
  message?: string;
  timestamp?: number;
}

interface HealthRule {
  /** Required: the group this rule reads. Unmeasured groups are excluded. */
  group: HealthMetricGroup;
  /** Points this rule can cost, and its share of the rescaled denominator. */
  weight: number;
  /** 0 = meeting target, 1 = at or past the bad bound. */
  severity: (metrics: SystemMetrics) => number;
  /**
   * Optional second gate, for when the group is measured but this particular
   * statistic is not yet trustworthy — too few samples, typically. Excluded
   * rules drop out of the denominator too, exactly like unmeasured groups.
   */
  applies?: (metrics: SystemMetrics) => boolean;
}

/**
 * A p99 estimate rests on the slowest 1% of requests, so it needs roughly this
 * many samples before it stops being one unlucky request. At ~100 requests an
 * hour, p99 was literally the second-slowest response: a single cold start moved
 * it from under 300ms to 4567ms and swung the score between 100 and 56 while
 * nothing about the system had changed.
 */
const MIN_SAMPLES_FOR_P99 = 1000;

/** An error *rate* is a mean, so it stabilises far sooner than a tail quantile. */
const MIN_SAMPLES_FOR_ERROR_RATE = 100;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Linear ramp: `good` or better scores 0, `bad` or worse scores 1, in between
 * degrades proportionally. Graded rather than stepped so a metric drifting
 * toward its limit is visible before it crosses one.
 */
function ramp(value: number, good: number, bad: number): number {
  if (bad === good) return value > good ? 1 : 0;
  return clamp01((value - good) / (bad - good));
}

/**
 * Monitoring Service Class
 * Handles all monitoring and alerting related API calls
 */
class MonitoringService {
  private readonly baseUrl = "/monitoring";

  // ============================================================================
  // Health & Status
  // ============================================================================

  /**
   * Get monitoring overview
   * @param options.includeMetrics Embed the raw SystemMetrics in the response.
   *   The endpoint already loads them to derive keyMetrics and trends, so this
   *   replaces a separate getMetrics() call rather than adding server work.
   * @returns Comprehensive monitoring overview with key metrics
   */
  async getOverview(options?: {
    includeMetrics?: boolean;
  }): Promise<MonitoringOverview> {
    try {
      const response = await api.get<MonitoringOverview>(
        `${this.baseUrl}/overview`,
        options?.includeMetrics ? { include: "metrics" } : undefined,
      );
      return response.data.data!;
    } catch (error) {
      console.error("Failed to get monitoring overview:", error);
      throw error;
    }
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  /**
   * Get system metrics
   * @param params Query parameters for metrics
   * @returns System metrics including API, database, cache, and error metrics
   */
  async getMetrics(params?: MetricsQueryParams): Promise<SystemMetrics> {
    try {
      const response = await api.get<
        { query: unknown; summary: unknown } & SystemMetrics
      >(`${this.baseUrl}/metrics`, params);
      return response.data.data!;
    } catch (error) {
      console.error("Failed to get metrics:", error);
      throw error;
    }
  }

  /**
   * Reset system metrics
   * @returns Success confirmation
   */
  async resetMetrics(): Promise<{ message: string; timestamp: number }> {
    try {
      const response = await api.delete<{ message: string; timestamp: number }>(
        `${this.baseUrl}/metrics`,
      );
      return response.data.data!;
    } catch (error) {
      console.error("Failed to reset metrics:", error);
      throw error;
    }
  }

  // ============================================================================
  // Alert Rules
  // ============================================================================

  /**
   * Get all alert rules with pagination
   * @param params Pagination parameters
   * @returns Paginated list of alert rules
   */
  async getAlertRules(
    params?: AlertRulesPagination,
  ): Promise<PaginatedAlertRulesResponse> {
    try {
      const response = await api.get<PaginatedAlertRulesResponse>(
        `${this.baseUrl}/alerts/rules`,
        params || { page: 1, limit: 20 },
      );
      return response.data.data!;
    } catch (error) {
      console.error("Failed to get alert rules:", error);
      throw error;
    }
  }

  /**
   * Create a new alert rule
   * @param rule Alert rule configuration
   * @returns Created alert rule with ID
   */
  async createAlertRule(rule: CreateAlertRuleRequest): Promise<AlertRule> {
    try {
      const response = await api.post<AlertRule & { created: number }>(
        `${this.baseUrl}/alerts/rules`,
        rule,
      );
      return response.data.data! as AlertRule;
    } catch (error) {
      console.error("Failed to create alert rule:", error);
      throw error;
    }
  }

  /**
   * Update an existing alert rule
   * @param id Alert rule ID
   * @param updates Partial alert rule updates
   * @returns Updated confirmation
   */
  async updateAlertRule(
    id: string,
    updates: UpdateAlertRuleRequest,
  ): Promise<{ id: string; updated: number }> {
    try {
      const response = await api.put<{ id: string; updated: number }>(
        `${this.baseUrl}/alerts/rules/${id}`,
        updates,
      );
      return response.data.data!;
    } catch (error) {
      console.error("Failed to update alert rule:", error);
      throw error;
    }
  }

  /**
   * Delete an alert rule
   * @param id Alert rule ID
   * @returns Success confirmation
   */
  async deleteAlertRule(id: string): Promise<{ message: string }> {
    try {
      const response = await api.delete<{ message: string }>(
        `${this.baseUrl}/alerts/rules/${id}`,
      );
      return response.data.data!;
    } catch (error) {
      console.error("Failed to delete alert rule:", error);
      throw error;
    }
  }

  /**
   * Get default alert rules
   * @returns List of default alert rules
   */
  async getDefaultAlertRules(): Promise<{
    rules: readonly unknown[];
    count: number;
    description: string;
  }> {
    try {
      const response = await api.get<{
        rules: readonly unknown[];
        count: number;
        description: string;
      }>(`${this.baseUrl}/alerts/defaults`);
      return response.data.data!;
    } catch (error) {
      console.error("Failed to get default alert rules:", error);
      throw error;
    }
  }

  /**
   * Test alert system
   * @param request Test alert configuration
   * @returns Test result confirmation
   */
  async testAlert(request: TestAlertRequest): Promise<{
    message: string;
    type: string;
    severity: string;
    timestamp: number;
  }> {
    try {
      const response = await api.post<{
        message: string;
        type: string;
        severity: string;
        timestamp: number;
      }>(`${this.baseUrl}/alerts/test`, request);
      return response.data.data!;
    } catch (error) {
      console.error("Failed to test alert:", error);
      throw error;
    }
  }

  // ============================================================================
  // Error Recording
  // ============================================================================

  /**
   * Record an error manually
   * @param error Error details
   * @returns Recorded error confirmation
   */
  async recordError(
    error: RecordErrorRequest,
  ): Promise<RecordErrorRequest & { timestamp: number }> {
    try {
      const response = await api.post<
        RecordErrorRequest & { timestamp: number }
      >(`${this.baseUrl}/errors`, error);
      return response.data.data!;
    } catch (err) {
      console.error("Failed to record error:", err);
      throw err;
    }
  }

  // ============================================================================
  // Reports
  // ============================================================================

  /**
   * Get performance report
   * @param params Report parameters (e.g., time period)
   * @returns Comprehensive performance report
   */
  async getPerformanceReport(
    params?: PerformanceReportParams,
  ): Promise<PerformanceReport> {
    try {
      const response = await api.get<PerformanceReport>(
        `${this.baseUrl}/reports/performance`,
        params || { days: 7 },
      );
      return response.data.data!;
    } catch (error) {
      console.error("Failed to get performance report:", error);
      throw error;
    }
  }

  // ============================================================================
  // Recent Alerts (Polling)
  // ============================================================================

  /**
   * Get recent alerts for polling
   * @param since Optional timestamp to filter alerts since
   * @returns List of recent alert notifications
   */
  async getRecentAlerts(since?: number): Promise<RecentAlert[]> {
    try {
      const params: Record<string, string> = {};
      if (since) params.since = since.toString();
      const response = await api.get<{
        alerts: RecentAlert[];
        timestamp: number;
      }>(`${this.baseUrl}/alerts/recent`, params);
      return response.data.data?.alerts || [];
    } catch (error) {
      console.error("Failed to get recent alerts:", error);
      return [];
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Check if a component is healthy
   * @param status Component health status
   * @returns True if component is healthy
   */
  isComponentHealthy(status: HealthStatus["overall"]): boolean {
    return status === "healthy";
  }

  /**
   * Get health status color for UI
   * @param status Health status
   * @returns Tailwind color class
   */
  getHealthStatusColor(status: HealthStatus["overall"]): string {
    const colorMap: Record<HealthStatus["overall"], string> = {
      healthy: "green",
      warning: "yellow",
      critical: "red",
      down: "gray",
    };
    return colorMap[status] || "gray";
  }

  /**
   * Get alert severity color for UI
   * @param severity Alert severity level
   * @returns Tailwind color class
   */
  getAlertSeverityColor(
    severity: "info" | "warning" | "critical" | "fatal",
  ): string {
    const colorMap = {
      info: "blue",
      warning: "yellow",
      critical: "red",
      fatal: "purple",
    };
    return colorMap[severity] || "gray";
  }

  /**
   * Format uptime to human-readable string
   * @param seconds Uptime in seconds
   * @returns Formatted uptime string
   */
  formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
      return `${days}天 ${hours}小時`;
    } else if (hours > 0) {
      return `${hours}小時 ${minutes}分鐘`;
    } else {
      return `${minutes}分鐘`;
    }
  }

  /**
   * Format timestamp to relative time
   * @param timestamp Unix timestamp
   * @returns Relative time string (e.g., "5分鐘前")
   */
  formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) {
      return "剛才";
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)}分鐘前`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)}小時前`;
    } else {
      return `${Math.floor(diff / 86400000)}天前`;
    }
  }

  /**
   * Calculate health score from metrics.
   *
   * Every rule must name the metric group it reads. Groups the API does not
   * measure are dropped entirely — both the deduction AND its weight — and the
   * score is rescaled over what remains. Declaring the group is not optional,
   * so a rule cannot silently score an unmeasured metric.
   *
   * That was not a hypothetical. The old version deducted 15 points whenever
   * cacheMetrics.hitRate < 0.3, and nothing populates cacheMetrics, so hitRate
   * was always 0 and the condition was always true. The score was permanently
   * capped at 85 for a reason unrelated to system health, and the same
   * always-true condition had already been found and removed from the backend's
   * default alert rules without anyone noticing this copy of it.
   *
   * @returns 0-100, or null when no group is measured — "unknown" has to be
   *   expressible, because reporting 0 for absent data is the same class of lie.
   */
  calculateHealthScore(metrics: SystemMetrics): number | null {
    const rules = this.healthRules();
    const applicable = rules.filter((rule) => this.isApplicable(metrics, rule));

    if (applicable.length === 0) return null;

    const available = applicable.reduce((sum, rule) => sum + rule.weight, 0);
    const lost = applicable.reduce(
      (sum, rule) => sum + rule.weight * clamp01(rule.severity(metrics)),
      0,
    );

    return Math.round(100 * (1 - lost / available));
  }

  /**
   * Which metric groups the score is currently based on. Surfaced so the UI can
   * say what the number covers — 100 over one group is not the same claim as
   * 100 over four.
   */
  healthScoreBasis(metrics: SystemMetrics): HealthMetricGroup[] {
    const groups = this.healthRules()
      .filter((rule) => this.isApplicable(metrics, rule))
      .map((rule) => rule.group);
    return [...new Set(groups)];
  }

  private isApplicable(metrics: SystemMetrics, rule: HealthRule): boolean {
    if (!this.isMeasured(metrics, rule.group)) return false;
    return rule.applies ? rule.applies(metrics) : true;
  }

  private isMeasured(
    metrics: SystemMetrics,
    group: HealthMetricGroup,
  ): boolean {
    // Absent flags mean an older API response; treat that as unmeasured rather
    // than assuming the data is real.
    return metrics.measured?.[group] === true;
  }

  /**
   * Severity returns 0 (perfect) to 1 (as bad as this rule scores).
   *
   * Thresholds come from the performance targets in CLAUDE.md rather than being
   * invented here, so the score answers "are we meeting our stated targets"
   * instead of an arbitrary bar.
   */
  private healthRules(): HealthRule[] {
    return [
      {
        // CLAUDE.md target: API Response Time P99 < 300ms.
        // p99 rather than the mean: latency here is bimodal — warm requests
        // ~100ms, cold starts ~600ms — and a mean over a bimodal distribution
        // describes neither mode.
        group: "api",
        weight: 35,
        severity: (m) => ramp(m.apiMetrics.p99ResponseTime, 300, 1500),
        applies: (m) => m.apiMetrics.totalRequests >= MIN_SAMPLES_FOR_P99,
      },
      {
        // Server errors only. A 401 on an expired session or a 404 for a
        // missing record is the system behaving correctly; counting those as
        // ill health buries real 5xx in routine client noise.
        group: "errors",
        weight: 45,
        severity: (m) =>
          ramp(
            m.errorMetrics.criticalErrors / m.apiMetrics.totalRequests,
            0.001,
            0.05,
          ),
        applies: (m) =>
          m.apiMetrics.totalRequests >= MIN_SAMPLES_FOR_ERROR_RATE,
      },
      {
        group: "database",
        // CLAUDE.md target: Database Query Time P95 < 100ms.
        weight: 20,
        severity: (m) => ramp(m.databaseMetrics.averageQueryTime, 100, 500),
      },
      {
        group: "cache",
        weight: 15,
        severity: (m) => ramp(0.6 - m.cacheMetrics.hitRate, 0, 0.6),
      },
    ];
  }

  /**
   * Check if metrics exceed thresholds
   * @param metrics System metrics
   * @returns List of threshold violations
   */
  checkThresholds(metrics: SystemMetrics): string[] {
    const violations: string[] = [];

    if (metrics.apiMetrics.averageResponseTime > 1000) {
      violations.push("API響應時間超過臨界值");
    }

    if (metrics.apiMetrics.errorRate > 0.1) {
      violations.push("API錯誤率過高");
    }

    if (metrics.databaseMetrics.averageQueryTime > 500) {
      violations.push("資料庫查詢時間過長");
    }

    if (metrics.cacheMetrics.hitRate < 0.3) {
      violations.push("快取命中率過低");
    }

    if (metrics.errorMetrics.criticalErrors > 0) {
      violations.push(`存在${metrics.errorMetrics.criticalErrors}個嚴重錯誤`);
    }

    return violations;
  }
}

// Export singleton instance
export const monitoringService = new MonitoringService();

// Export class for testing
export default MonitoringService;
