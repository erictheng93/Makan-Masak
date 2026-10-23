// Comprehensive system health monitoring and diagnostics service
import { ref } from "vue";
import {
  performanceService,
  type PerformanceMetric,
} from "./performanceService";
import { errorReportingService } from "./errorReportingService";
import { offlineService } from "./offlineService";
import { enhancedAudioService } from "./enhancedAudioService";

export interface SystemHealthMetric {
  id: string;
  name: string;
  value: number;
  unit: string;
  status: "healthy" | "warning" | "critical";
  threshold: {
    warning: number;
    critical: number;
  };
  timestamp: number;
  trend: "up" | "down" | "stable";
  description: string;
}

export interface SystemComponent {
  id: string;
  name: string;
  status: "online" | "offline" | "degraded";
  lastCheck: number;
  responseTime?: number;
  errorRate?: number;
  dependencies: string[];
  healthScore: number; // 0-100
}

export interface SystemAlert {
  id: string;
  type: "performance" | "error" | "connectivity" | "storage" | "security";
  severity: "info" | "warning" | "critical";
  message: string;
  component: string;
  timestamp: number;
  resolved: boolean;
  actions: string[];
}

export interface SystemHealthReport {
  overall: {
    status: "healthy" | "warning" | "critical";
    score: number;
    lastUpdate: number;
  };
  metrics: SystemHealthMetric[];
  components: SystemComponent[];
  alerts: SystemAlert[];
  recommendations: string[];
  uptime: number;
}

class SystemHealthService {
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly MAX_STORED_METRICS = 1000;
  private readonly MAX_STORED_ALERTS = 100;

  // Reactive state
  public isMonitoring = ref(false);
  public healthMetrics = ref<SystemHealthMetric[]>([]);
  public systemComponents = ref<SystemComponent[]>([]);
  public systemAlerts = ref<SystemAlert[]>([]);
  public lastHealthCheck = ref<number>(0);

  // Internal timers and intervals
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private startTime = Date.now();

  constructor() {
    this.initializeComponents();
    this.loadStoredData();
  }

  // Public methods
  public start(): void {
    if (this.isMonitoring.value) return;

    this.isMonitoring.value = true;
    console.log("System health monitoring started");

    // Immediate health check
    this.performHealthCheck();

    // Setup periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL);

    // Setup event listeners for critical events
    this.setupEventListeners();
  }

  public stop(): void {
    if (!this.isMonitoring.value) return;

    this.isMonitoring.value = false;
    console.log("System health monitoring stopped");

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this.saveStoredData();
  }

  public async performHealthCheck(): Promise<SystemHealthReport> {
    const startTime = performance.now();

    try {
      // Collect metrics from all subsystems
      await this.collectSystemMetrics();
      await this.checkComponentHealth();
      await this.evaluateSystemAlerts();

      const report = this.generateHealthReport();
      this.lastHealthCheck.value = Date.now();

      // Record health check performance
      performanceService.recordMetric(
        "health_check_duration",
        performance.now() - startTime,
        "ms",
        "system",
      );

      return report;
    } catch (error) {
      console.error("Health check failed:", error);

      this.addAlert({
        type: "error",
        severity: "critical",
        message: "System health check failed",
        component: "health-service",
        actions: ["Restart health monitoring", "Check system resources"],
      });

      throw error;
    }
  }

  public getHealthReport(): SystemHealthReport {
    return this.generateHealthReport();
  }

  public addAlert(
    alertData: Omit<SystemAlert, "id" | "timestamp" | "resolved">,
  ): void {
    const alert: SystemAlert = {
      id: this.generateAlertId(),
      timestamp: Date.now(),
      resolved: false,
      ...alertData,
    };

    this.systemAlerts.value.unshift(alert);

    // Limit stored alerts
    if (this.systemAlerts.value.length > this.MAX_STORED_ALERTS) {
      this.systemAlerts.value = this.systemAlerts.value.slice(
        0,
        this.MAX_STORED_ALERTS,
      );
    }

    // Auto-notify for critical alerts
    if (alert.severity === "critical") {
      this.notifyCriticalAlert(alert);
    }

    this.saveStoredData();
  }

  public resolveAlert(alertId: string): void {
    const alert = this.systemAlerts.value.find((a) => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      this.saveStoredData();
    }
  }

  public getActiveAlerts(): SystemAlert[] {
    return this.systemAlerts.value.filter((a) => !a.resolved);
  }

  public async runDiagnostics(): Promise<{
    networkConnectivity: boolean;
    localStorage: boolean;
    webWorkers: boolean;
    audioContext: boolean;
    performance: boolean;
    permissions: boolean;
    browserCompatibility: boolean;
  }> {
    const diagnostics = {
      networkConnectivity: await this.testNetworkConnectivity(),
      localStorage: this.testLocalStorage(),
      webWorkers: this.testWebWorkers(),
      audioContext: this.testAudioContext(),
      performance: this.testPerformanceAPI(),
      permissions: await this.testPermissions(),
      browserCompatibility: this.testBrowserCompatibility(),
    };

    // Log diagnostics results
    console.log("System diagnostics completed:", diagnostics);

    return diagnostics;
  }

  public getSystemStats(): {
    uptime: number;
    totalAlerts: number;
    resolvedAlerts: number;
    criticalAlerts: number;
    avgResponseTime: number;
    errorRate: number;
    healthScore: number;
  } {
    const now = Date.now();
    const uptime = Math.floor((now - this.startTime) / 1000);
    const totalAlerts = this.systemAlerts.value.length;
    const resolvedAlerts = this.systemAlerts.value.filter(
      (a) => a.resolved,
    ).length;
    const criticalAlerts = this.systemAlerts.value.filter(
      (a) => a.severity === "critical" && !a.resolved,
    ).length;

    const responseTimeMetric = this.healthMetrics.value.find(
      (m) => m.id === "response_time",
    );
    const avgResponseTime = responseTimeMetric?.value || 0;

    const errorStats = errorReportingService.getErrorStats();
    const errorRate = errorStats.errorRate;

    const healthScore = this.calculateOverallHealthScore();

    return {
      uptime,
      totalAlerts,
      resolvedAlerts,
      criticalAlerts,
      avgResponseTime,
      errorRate,
      healthScore,
    };
  }

  // Private methods
  private initializeComponents(): void {
    this.systemComponents.value = [
      {
        id: "audio-service",
        name: "Audio Service",
        status: "online",
        lastCheck: 0,
        dependencies: [],
        healthScore: 100,
      },
      {
        id: "offline-service",
        name: "Offline Synchronization",
        status: "online",
        lastCheck: 0,
        dependencies: ["network", "storage"],
        healthScore: 100,
      },
      {
        id: "performance-service",
        name: "Performance Monitoring",
        status: "online",
        lastCheck: 0,
        dependencies: [],
        healthScore: 100,
      },
      {
        id: "error-reporting",
        name: "Error Reporting",
        status: "online",
        lastCheck: 0,
        dependencies: ["storage"],
        healthScore: 100,
      },
      {
        id: "network",
        name: "Network Connectivity",
        status: navigator.onLine ? "online" : "offline",
        lastCheck: 0,
        dependencies: [],
        healthScore: navigator.onLine ? 100 : 0,
      },
      {
        id: "storage",
        name: "Local Storage",
        status: "online",
        lastCheck: 0,
        dependencies: [],
        healthScore: 100,
      },
    ];
  }

  private async collectSystemMetrics(): Promise<void> {
    const now = Date.now();
    const newMetrics: SystemHealthMetric[] = [];

    // Memory usage
    if ("memory" in performance) {
      const memory = performance.memory;
      if (memory) {
        const memoryUsage =
          (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;

        newMetrics.push({
          id: "memory_usage",
          name: "Memory Usage",
          value: memoryUsage,
          unit: "%",
          status:
            memoryUsage > 80
              ? "critical"
              : memoryUsage > 60
                ? "warning"
                : "healthy",
          threshold: { warning: 60, critical: 80 },
          timestamp: now,
          trend: this.calculateTrend("memory_usage", memoryUsage),
          description: "JavaScript heap memory usage percentage",
        });
      }
    }

    // Response time
    const responseTimeMetrics = performanceService.metrics.value.filter(
      (m: PerformanceMetric) =>
        m.name.includes("response_time") || m.name.includes("api_call"),
    );

    if (responseTimeMetrics.length > 0) {
      const avgResponseTime =
        responseTimeMetrics.reduce(
          (sum: number, metric: PerformanceMetric) => sum + metric.value,
          0,
        ) / responseTimeMetrics.length;

      newMetrics.push({
        id: "response_time",
        name: "Average Response Time",
        value: avgResponseTime,
        unit: "ms",
        status:
          avgResponseTime > 1000
            ? "critical"
            : avgResponseTime > 500
              ? "warning"
              : "healthy",
        threshold: { warning: 500, critical: 1000 },
        timestamp: now,
        trend: this.calculateTrend("response_time", avgResponseTime),
        description: "Average API response time",
      });
    }

    // Error rate
    const errorStats = errorReportingService.getErrorStats();
    newMetrics.push({
      id: "error_rate",
      name: "Error Rate",
      value: errorStats.errorRate,
      unit: "errors/hour",
      status:
        errorStats.errorRate > 10
          ? "critical"
          : errorStats.errorRate > 5
            ? "warning"
            : "healthy",
      threshold: { warning: 5, critical: 10 },
      timestamp: now,
      trend: this.calculateTrend("error_rate", errorStats.errorRate),
      description: "Number of errors per hour",
    });

    // Storage usage
    if ("storage" in navigator && "estimate" in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        const storageUsage =
          estimate.usage && estimate.quota
            ? (estimate.usage / estimate.quota) * 100
            : 0;

        newMetrics.push({
          id: "storage_usage",
          name: "Storage Usage",
          value: storageUsage,
          unit: "%",
          status:
            storageUsage > 90
              ? "critical"
              : storageUsage > 75
                ? "warning"
                : "healthy",
          threshold: { warning: 75, critical: 90 },
          timestamp: now,
          trend: this.calculateTrend("storage_usage", storageUsage),
          description: "Local storage quota usage percentage",
        });
      } catch (error) {
        console.warn("Failed to get storage estimate:", error);
      }
    }

    // Offline queue size
    const offlineQueueSize = offlineService.pendingActions.value.length;
    newMetrics.push({
      id: "offline_queue",
      name: "Offline Queue Size",
      value: offlineQueueSize,
      unit: "actions",
      status:
        offlineQueueSize > 50
          ? "critical"
          : offlineQueueSize > 20
            ? "warning"
            : "healthy",
      threshold: { warning: 20, critical: 50 },
      timestamp: now,
      trend: this.calculateTrend("offline_queue", offlineQueueSize),
      description: "Number of pending offline actions",
    });

    // Add new metrics
    this.healthMetrics.value.unshift(...newMetrics);

    // Limit stored metrics
    if (this.healthMetrics.value.length > this.MAX_STORED_METRICS) {
      this.healthMetrics.value = this.healthMetrics.value.slice(
        0,
        this.MAX_STORED_METRICS,
      );
    }
  }

  private async checkComponentHealth(): Promise<void> {
    const now = Date.now();

    for (const component of this.systemComponents.value) {
      let status: SystemComponent["status"] = "online";
      let healthScore = 100;
      let responseTime: number | undefined;

      try {
        switch (component.id) {
          case "audio-service":
            status = enhancedAudioService.settings.enabled
              ? enhancedAudioService.isWebAudioSupported.value
                ? "online"
                : "degraded"
              : "offline";
            healthScore = enhancedAudioService.settings.enabled
              ? enhancedAudioService.isWebAudioSupported.value
                ? 100
                : 70
              : 0;
            break;

          case "offline-service":
            status = offlineService.isOnline.value
              ? offlineService.pendingActions.value.length > 50
                ? "degraded"
                : "online"
              : "offline";
            healthScore = offlineService.isOnline.value
              ? Math.max(100 - offlineService.pendingActions.value.length, 50)
              : 25;
            break;

          case "performance-service":
            status = performanceService.config.value.enabled
              ? "online"
              : "offline";
            healthScore = performanceService.config.value.enabled ? 100 : 0;
            break;

          case "error-reporting": {
            const errorStats = errorReportingService.getErrorStats();
            status = errorStats.errorRate > 10 ? "degraded" : "online";
            healthScore = Math.max(100 - errorStats.errorRate * 5, 0);
            break;
          }

          case "network": {
            const connectivityStart = performance.now();
            const isConnected = await this.testNetworkConnectivity();
            responseTime = performance.now() - connectivityStart;

            status = isConnected ? "online" : "offline";
            healthScore = isConnected ? 100 : 0;
            break;
          }

          case "storage": {
            const storageWorking = this.testLocalStorage();
            status = storageWorking ? "online" : "offline";
            healthScore = storageWorking ? 100 : 0;
            break;
          }
        }
      } catch (error) {
        console.error(
          `Health check failed for component ${component.id}:`,
          error,
        );
        status = "offline";
        healthScore = 0;
      }

      // Update component status
      component.status = status;
      component.healthScore = healthScore;
      component.responseTime = responseTime;
      component.lastCheck = now;
    }
  }

  private evaluateSystemAlerts(): void {
    // Check for new alerts based on metrics and component status

    // Memory alerts
    const memoryMetric = this.healthMetrics.value.find(
      (m) => m.id === "memory_usage",
    );
    if (memoryMetric && memoryMetric.status === "critical") {
      this.addAlert({
        type: "performance",
        severity: "critical",
        message: `Memory usage is critically high: ${memoryMetric.value}%`,
        component: "system",
        actions: [
          "Clear cache",
          "Restart application",
          "Check for memory leaks",
        ],
      });
    }

    // Response time alerts
    const responseMetric = this.healthMetrics.value.find(
      (m) => m.id === "response_time",
    );
    if (responseMetric && responseMetric.status === "critical") {
      this.addAlert({
        type: "performance",
        severity: "warning",
        message: `Response time is slow: ${responseMetric.value}ms`,
        component: "network",
        actions: [
          "Check network connection",
          "Optimize API calls",
          "Enable caching",
        ],
      });
    }

    // Error rate alerts
    const errorMetric = this.healthMetrics.value.find(
      (m) => m.id === "error_rate",
    );
    if (errorMetric && errorMetric.status === "critical") {
      this.addAlert({
        type: "error",
        severity: "critical",
        message: `High error rate detected: ${errorMetric.value} errors/hour`,
        component: "system",
        actions: [
          "Check error logs",
          "Review recent changes",
          "Monitor system stability",
        ],
      });
    }

    // Storage alerts
    const storageMetric = this.healthMetrics.value.find(
      (m) => m.id === "storage_usage",
    );
    if (storageMetric && storageMetric.status === "critical") {
      this.addAlert({
        type: "storage",
        severity: "warning",
        message: `Storage usage is high: ${storageMetric.value}%`,
        component: "storage",
        actions: [
          "Clear old data",
          "Optimize data storage",
          "Increase storage quota",
        ],
      });
    }

    // Offline queue alerts
    const offlineMetric = this.healthMetrics.value.find(
      (m) => m.id === "offline_queue",
    );
    if (offlineMetric && offlineMetric.status === "critical") {
      this.addAlert({
        type: "connectivity",
        severity: "warning",
        message: `Large offline queue: ${offlineMetric.value} pending actions`,
        component: "offline-service",
        actions: [
          "Check network connection",
          "Force sync",
          "Clear old actions",
        ],
      });
    }

    // Component health alerts
    const offlineComponents = this.systemComponents.value.filter(
      (c) => c.status === "offline",
    );
    if (offlineComponents.length > 0) {
      this.addAlert({
        type: "connectivity",
        severity: "critical",
        message: `${offlineComponents.length} system components are offline`,
        component: "system",
        actions: [
          "Check system status",
          "Restart affected services",
          "Review error logs",
        ],
      });
    }
  }

  private generateHealthReport(): SystemHealthReport {
    const overallScore = this.calculateOverallHealthScore();
    const overallStatus: SystemHealthReport["overall"]["status"] =
      overallScore >= 80
        ? "healthy"
        : overallScore >= 60
          ? "warning"
          : "critical";

    return {
      overall: {
        status: overallStatus,
        score: overallScore,
        lastUpdate: this.lastHealthCheck.value,
      },
      metrics: this.healthMetrics.value.slice(0, 50), // Latest 50 metrics
      components: [...this.systemComponents.value],
      alerts: this.systemAlerts.value.slice(0, 20), // Latest 20 alerts
      recommendations: this.generateRecommendations(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  private calculateOverallHealthScore(): number {
    const componentScores = this.systemComponents.value.map(
      (c) => c.healthScore,
    );
    const avgComponentScore =
      componentScores.reduce((sum, score) => sum + score, 0) /
      componentScores.length;

    // Factor in recent critical alerts
    const recentCriticalAlerts = this.systemAlerts.value.filter(
      (a) =>
        a.severity === "critical" &&
        !a.resolved &&
        Date.now() - a.timestamp < 3600000, // Last hour
    ).length;

    const alertPenalty = Math.min(recentCriticalAlerts * 10, 50); // Max 50 point penalty

    return Math.max(avgComponentScore - alertPenalty, 0);
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const stats = this.getSystemStats();

    if (stats.criticalAlerts > 0) {
      recommendations.push(`處理 ${stats.criticalAlerts} 個嚴重警報`);
    }

    if (stats.errorRate > 5) {
      recommendations.push("錯誤率偏高，建議檢查系統穩定性");
    }

    if (stats.avgResponseTime > 500) {
      recommendations.push("響應時間較慢，考慮優化性能");
    }

    const memoryMetric = this.healthMetrics.value.find(
      (m) => m.id === "memory_usage",
    );
    if (memoryMetric && memoryMetric.value > 70) {
      recommendations.push("記憶體使用率較高，建議清理快取");
    }

    const storageMetric = this.healthMetrics.value.find(
      (m) => m.id === "storage_usage",
    );
    if (storageMetric && storageMetric.value > 80) {
      recommendations.push("儲存空間使用率高，建議清理舊資料");
    }

    if (!navigator.onLine) {
      recommendations.push("目前處於離線狀態，檢查網路連線");
    }

    if (recommendations.length === 0) {
      recommendations.push("系統運行良好，持續監控即可");
    }

    return recommendations;
  }

  private calculateTrend(
    metricId: string,
    currentValue: number,
  ): "up" | "down" | "stable" {
    const previousMetrics = this.healthMetrics.value
      .filter((m) => m.id === metricId)
      .slice(1, 6); // Previous 5 values

    if (previousMetrics.length < 2) return "stable";

    const avgPrevious =
      previousMetrics.reduce(
        (sum: number, m: SystemHealthMetric) => sum + m.value,
        0,
      ) / previousMetrics.length;
    const threshold = avgPrevious * 0.1; // 10% threshold

    if (currentValue > avgPrevious + threshold) return "up";
    if (currentValue < avgPrevious - threshold) return "down";
    return "stable";
  }

  private setupEventListeners(): void {
    // Network status changes
    window.addEventListener("online", () => {
      this.updateComponentStatus("network", "online");
    });

    window.addEventListener("offline", () => {
      this.updateComponentStatus("network", "offline");
      this.addAlert({
        type: "connectivity",
        severity: "warning",
        message: "Network connection lost",
        component: "network",
        actions: ["Check network connection", "Enable offline mode"],
      });
    });

    // Visibility change (for performance optimization)
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        // Perform health check when page becomes visible
        this.performHealthCheck();
      }
    });
  }

  private updateComponentStatus(
    componentId: string,
    status: SystemComponent["status"],
  ): void {
    const component = this.systemComponents.value.find(
      (c) => c.id === componentId,
    );
    if (component) {
      component.status = status;
      component.lastCheck = Date.now();
      component.healthScore =
        status === "online" ? 100 : status === "degraded" ? 50 : 0;
    }
  }

  private notifyCriticalAlert(alert: SystemAlert): void {
    console.error("CRITICAL SYSTEM ALERT:", alert.message);

    // Could integrate with external alerting systems
    // or send notifications to administrators
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Diagnostic test methods
  private async testNetworkConnectivity(): Promise<boolean> {
    // Use the public /info liveness probe instead of /system/health: it is
    // root-mounted (outside /api/v1), unauthenticated, and avoids the DB ping
    // that /system/health performs on every call. Raw fetch bypasses the
    // apiClient auth interceptors so a stale token cannot trigger a refresh
    // loop or login redirect from a connectivity probe.
    //
    // /info is on the API's origin, not this app's: a bare "/info" in
    // production reached the kitchen's own static host, whose SPA fallback
    // answers 200, so the probe passed whenever the page itself had loaded.
    const base = import.meta.env.VITE_API_BASE_URL || "/api/v1";
    try {
      const response = await fetch(
        `${base.replace(/\/api\/v1\/?$/, "")}/info`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
        },
      );
      return response.ok;
    } catch {
      return navigator.onLine;
    }
  }

  private testLocalStorage(): boolean {
    try {
      localStorage.setItem("__health_test__", "test");
      localStorage.removeItem("__health_test__");
      return true;
    } catch {
      return false;
    }
  }

  private testWebWorkers(): boolean {
    return typeof Worker !== "undefined";
  }

  private testAudioContext(): boolean {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  private testPerformanceAPI(): boolean {
    try {
      // Test if performance.mark can be called without error
      performance.mark("test-mark");
      performance.clearMarks("test-mark");
      return !!(performance && performance.now);
    } catch {
      return false;
    }
  }

  private async testPermissions(): Promise<boolean> {
    if (!("permissions" in navigator)) return false;

    try {
      const result = await navigator.permissions.query({
        name: "notifications" as PermissionName,
      });
      return result.state !== "denied";
    } catch {
      return false;
    }
  }

  private testBrowserCompatibility(): boolean {
    const features = [
      "fetch",
      "localStorage",
      "sessionStorage",
      "WebSocket",
      "indexedDB",
    ];

    return features.every((feature) => feature in window);
  }

  // Data persistence
  private loadStoredData(): void {
    try {
      const stored = localStorage.getItem("kitchen-system-health");
      if (stored) {
        const data = JSON.parse(stored);
        this.systemAlerts.value = data.alerts || [];
        this.healthMetrics.value = data.metrics || [];
      }
    } catch (error) {
      console.error("Failed to load system health data:", error);
    }
  }

  private saveStoredData(): void {
    try {
      const data = {
        alerts: this.systemAlerts.value.slice(0, this.MAX_STORED_ALERTS),
        metrics: this.healthMetrics.value.slice(0, this.MAX_STORED_METRICS),
        lastSave: Date.now(),
      };
      localStorage.setItem("kitchen-system-health", JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save system health data:", error);
    }
  }

  public cleanup(): void {
    this.stop();
    this.saveStoredData();
  }
}

// Create and export singleton instance
export const systemHealthService = new SystemHealthService();
export default systemHealthService;
