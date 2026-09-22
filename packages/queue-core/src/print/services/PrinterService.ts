/**
 * 統一打印機服務
 * 提供跨平台、多品牌打印機的統一管理接口
 */

import type {
  PrinterDevice,
  PrintJob,
  PrintRequest,
  PrintResponse,
  PrintServiceConfig,
  PrintStatistics,
  CountryCode,
  PrinterBrand,
  PrinterCapabilities,
  ReceiptTemplate,
  RegionConfig,
} from "@makanmasak/shared-types";

import { PrintJobManager, type PrintJobManagerEvents } from "./PrintJobManager";
import type { PrinterDriver } from "../drivers/PrinterDriver";
import type { PrinterConnectionParams } from "../drivers/PrinterDriverFactory";
import { RegionManager } from "./RegionManager";
import { PrinterDriverFactory } from "../drivers/PrinterDriverFactory";
import { ReceiptFormattingService } from "../formatters/ReceiptFormattingService";
import {
  PrinterHealthMonitor,
  type PrinterHealthMonitorEvents,
} from "../utils/PrinterHealthMonitor";
import { PrintStatisticsCollector } from "../utils/PrintStatisticsCollector";
import { PrintError, PrinterConnectionError } from "../errors/PrintErrors";
import { DEFAULT_PRINT_CONFIG } from "../config/defaults";

/** Events this service re-publishes, with the payload each carries. */
export type PrinterServiceEvents = {
  service_initialized: { timestamp: Date };
  service_shutdown: { timestamp: Date };
  device_registered: { deviceId: string; brand: PrinterBrand; model: string };
  device_unregistered: { deviceId: string };
  device_status_changed: PrinterHealthMonitorEvents["device_status_changed"];
  device_error: PrinterHealthMonitorEvents["device_error"];
  job_started: PrintJobManagerEvents["job_started"];
  job_completed: PrintJobManagerEvents["job_completed"];
  job_failed: PrintJobManagerEvents["job_failed"];
  job_retried: PrintJobManagerEvents["job_retried"];
};

export class PrinterService {
  private config: PrintServiceConfig;
  private drivers = new Map<string, PrinterDriver>();
  private jobManager: PrintJobManager;
  private regionManager: RegionManager;
  private formattingService: ReceiptFormattingService;
  private healthMonitor: PrinterHealthMonitor;
  private statisticsCollector: PrintStatisticsCollector;
  private eventHandlers = new Map<
    keyof PrinterServiceEvents,
    ((payload: never) => void)[]
  >();
  private isInitialized = false;

  constructor(config: Partial<PrintServiceConfig> = {}) {
    this.config = { ...DEFAULT_PRINT_CONFIG, ...config };
    this.jobManager = new PrintJobManager(this.config.queue);
    this.regionManager = new RegionManager();
    this.formattingService = new ReceiptFormattingService();
    this.healthMonitor = new PrinterHealthMonitor();
    this.statisticsCollector = new PrintStatisticsCollector();

    this.jobManager.setJobExecutor(this.executePrintJob.bind(this));
    this.setupJobManagerCallbacks();
  }

  // =============================================
  // 初始化和生命週期管理
  // =============================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // 初始化各子服務
      await this.jobManager.initialize();
      await this.healthMonitor.initialize();
      await this.statisticsCollector.initialize();

      // 啟動健康監控
      this.healthMonitor.on(
        "device_status_changed",
        this.handleDeviceStatusChange.bind(this),
      );
      this.healthMonitor.on("device_error", this.handleDeviceError.bind(this));

      this.isInitialized = true;
      this.emit("service_initialized", { timestamp: new Date() });
    } catch (error) {
      throw new PrintError(`Failed to initialize PrinterService: ${error}`);
    }
  }

  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;

    try {
      // 停止所有正在進行的作業
      await this.jobManager.shutdown();

      // 斷開所有打印機連接
      await Promise.all(
        Array.from(this.drivers.values()).map((driver) =>
          driver
            .disconnect()
            .catch((error: unknown) =>
              console.warn("Driver disconnect error:", error),
            ),
        ),
      );

      // 停止監控服務
      await this.healthMonitor.shutdown();
      await this.statisticsCollector.shutdown();

      this.drivers.clear();
      this.eventHandlers.clear();
      this.isInitialized = false;

      this.emit("service_shutdown", { timestamp: new Date() });
    } catch (error) {
      throw new PrintError(`Failed to shutdown PrinterService: ${error}`);
    }
  }

  // =============================================
  // 設備管理
  // =============================================

  async registerPrinter(deviceConfig: {
    id: string;
    brand: PrinterBrand;
    model: string;
    connectionType: "usb" | "network" | "bluetooth" | "serial";
    connectionParams: PrinterConnectionParams;
    capabilities?: PrinterCapabilities;
    isDefault?: boolean;
  }): Promise<void> {
    try {
      // Create the driver with the service-level execution policy.
      const driver = await PrinterDriverFactory.createDriver(
        deviceConfig.brand,
        deviceConfig,
        this.config.drivers,
      );

      // 測試連接
      const connected = await driver.connect();
      if (!connected) {
        throw new PrinterConnectionError(
          `Failed to connect to printer: ${deviceConfig.id}`,
        );
      }

      // 註冊設備
      this.drivers.set(deviceConfig.id, driver);

      // 開始健康監控
      this.healthMonitor.updateHealth(deviceConfig.id, "online");

      // 設為預設設備
      if (deviceConfig.isDefault || this.drivers.size === 1) {
        this.config.defaultDevice = deviceConfig.id;
      }

      this.emit("device_registered", {
        deviceId: deviceConfig.id,
        brand: deviceConfig.brand,
        model: deviceConfig.model,
      });
    } catch (error) {
      throw new PrinterConnectionError(
        `Failed to register printer ${deviceConfig.id}: ${error}`,
      );
    }
  }

  async unregisterPrinter(deviceId: string): Promise<void> {
    const driver = this.drivers.get(deviceId);
    if (!driver) return;

    try {
      // 取消所有待處理的作業
      await this.jobManager.cancelDeviceJobs(deviceId);

      // 停止健康監控
      this.healthMonitor.removeDevice(deviceId);

      // 斷開連接
      await driver.disconnect();

      // 移除驅動
      this.drivers.delete(deviceId);

      // 如果是預設設備，選擇新的預設設備
      if (this.config.defaultDevice === deviceId) {
        const remainingDevices = Array.from(this.drivers.keys());
        this.config.defaultDevice = remainingDevices[0] || null;
      }

      this.emit("device_unregistered", { deviceId });
    } catch (error) {
      const safeDeviceId = String(deviceId)
        .replace(/[\r\n\t]/g, " ")
        .slice(0, 500);
      console.warn("Error unregistering printer %s:", safeDeviceId, error);
    }
  }

  // The drivers expose getDeviceInfo(); these called a getDevice() that does
  // not exist and would have thrown at runtime. `Map<string, any>` hid it.
  getDevices(): PrinterDevice[] {
    return Array.from(this.drivers.values()).map((driver) =>
      driver.getDeviceInfo(),
    );
  }

  getDevice(deviceId: string): PrinterDevice | null {
    const driver = this.drivers.get(deviceId);
    return driver ? driver.getDeviceInfo() : null;
  }

  getDefaultDevice(): PrinterDevice | null {
    if (this.config.defaultDevice) {
      return this.getDevice(this.config.defaultDevice);
    }

    // Never queue a job for an offline printer. The agent must surface
    // NO_PRINTER_AVAILABLE rather than claim a cloud receipt it cannot print.
    const devices = this.getDevices();
    return devices.find((d) => d.status === "online") || null;
  }

  // =============================================
  // 列印作業管理
  // =============================================

  async print(request: PrintRequest): Promise<PrintResponse> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // 選擇打印機
      const device = this.selectPrinter(request.deviceId);
      if (!device) {
        return {
          success: false,
          error: {
            code: "NO_PRINTER_AVAILABLE",
            message: "No available printer found",
          },
        };
      }

      // 格式化打印內容
      const content = await this.formattingService.formatReceipt(request);

      // 創建打印作業
      const job = await this.jobManager.createJob({
        ...request,
        deviceId: device.id,
        content,
      });

      // 記錄統計
      this.statisticsCollector.recordJobCreated({
        deviceId: job.deviceId,
        jobId: job.id,
      });

      return {
        success: true,
        jobId: job.id,
        estimatedTime: this.estimateProcessingTime(job),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "PRINT_REQUEST_FAILED",
          message: `Failed to process print request: ${error}`,
        },
      };
    }
  }

  async getJobStatus(jobId: string): Promise<PrintJob | null> {
    return this.jobManager.getJob(jobId);
  }

  async cancelJob(jobId: string): Promise<boolean> {
    return this.jobManager.cancelJob(jobId);
  }

  async retryJob(jobId: string): Promise<boolean> {
    return this.jobManager.retryJob(jobId);
  }

  // =============================================
  // 地區和格式化管理
  // =============================================

  setRegion(country: CountryCode, config: RegionConfig): void {
    this.regionManager.setRegion(country, config);
    this.formattingService.addRegion(country, config);
  }

  addReceiptTemplate(templateId: string, template: ReceiptTemplate): void {
    this.formattingService.addTemplate(templateId, template);
  }

  // =============================================
  // 監控和統計
  // =============================================

  getStatistics(): PrintStatistics {
    const localStats = this.statisticsCollector.getOverallStatistics();

    // Map local PrintStatistics to shared-types PrintStatistics
    return {
      totalJobs: localStats.totalJobs,
      completedJobs: localStats.successfulJobs,
      failedJobs: localStats.failedJobs,
      averageJobTime: localStats.averagePrintTime,
      paperUsage: localStats.totalPaperUsed,
      deviceUptime: 0, // TODO: Implement device uptime tracking
      errorRate: localStats.errorRate,
      busyHours: [], // TODO: Implement busy hours tracking
    };
  }

  async healthCheck(): Promise<{
    service: "healthy" | "degraded" | "unhealthy";
    devices: Array<{
      deviceId: string;
      status: string;
      lastSeen?: Date;
      errorCount?: number;
    }>;
    queue: {
      pending: number;
      processing: number;
      failed: number;
    };
  }> {
    await Promise.all(
      Array.from(this.drivers.entries()).map(async ([deviceId, driver]) => {
        try {
          const status = await driver.getStatus();
          this.healthMonitor.updateHealth(
            deviceId,
            status === "online"
              ? "online"
              : status === "offline"
                ? "offline"
                : "error",
          );
        } catch {
          this.healthMonitor.updateHealth(deviceId, "error");
        }
      }),
    );

    const healthMap = this.healthMonitor.getAllHealth();
    const healthData = Array.from(healthMap.entries());
    const queueStats = this.jobManager.getQueueStatistics();

    const devices = healthData.map(([deviceId, health]) => ({
      deviceId,
      status: health.status,
      lastSeen: health.lastSeen,
      errorCount: health.errorCount,
    }));

    const onlineDevices = devices.filter((d) => d.status === "online").length;
    const totalDevices = devices.length;

    let serviceStatus: "healthy" | "degraded" | "unhealthy";
    if (totalDevices === 0 || onlineDevices === 0) {
      serviceStatus = "unhealthy";
    } else if (onlineDevices < totalDevices) {
      serviceStatus = "degraded";
    } else {
      serviceStatus = "healthy";
    }

    return {
      service: serviceStatus,
      devices,
      queue: queueStats,
    };
  }

  // =============================================
  // 事件管理
  // =============================================

  on<K extends keyof PrinterServiceEvents>(
    event: K,
    handler: (payload: PrinterServiceEvents[K]) => void,
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler as (payload: never) => void);
  }

  off<K extends keyof PrinterServiceEvents>(
    event: K,
    handler: (payload: PrinterServiceEvents[K]) => void,
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler as (payload: never) => void);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit<K extends keyof PrinterServiceEvents>(
    event: K,
    data: PrinterServiceEvents[K],
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          (handler as (payload: PrinterServiceEvents[K]) => void)(data);
        } catch (error) {
          console.error(`Event handler error for ${event}:`, error);
        }
      });
    }
  }

  // =============================================
  // 內部方法
  // =============================================

  private selectPrinter(requestedDeviceId?: string): PrinterDevice | null {
    if (requestedDeviceId) {
      const device = this.getDevice(requestedDeviceId);
      return device?.status === "online" ? device : null;
    }
    return this.getDefaultDevice();
  }

  private async executePrintJob(job: PrintJob): Promise<void> {
    const driver = this.drivers.get(job.deviceId);
    if (!driver) {
      throw new PrinterConnectionError(
        `No driver is registered for printer ${job.deviceId}`,
      );
    }

    if (!driver.isConnected() && !(await driver.connect())) {
      this.healthMonitor.updateHealth(job.deviceId, "offline");
      throw new PrinterConnectionError(
        `Printer ${job.deviceId} is not connected`,
      );
    }

    const response = await driver.print(job.content);
    if (!response.success) {
      this.healthMonitor.updateHealth(job.deviceId, "error");
      throw new PrintError(
        response.error?.message || `Printer ${job.deviceId} rejected the job`,
      );
    }

    this.healthMonitor.updateHealth(job.deviceId, "online");
  }

  private estimateProcessingTime(job: PrintJob): number {
    const baseTime = 3000; // 3秒基準時間
    const itemCount = job.content?.items?.length || 0;
    const copyCount = job.options?.copies || 1;

    return (baseTime + itemCount * 200) * copyCount;
  }

  private setupJobManagerCallbacks(): void {
    this.jobManager.on("job_started", (data: { job: PrintJob }) => {
      this.statisticsCollector.recordJobStarted({
        deviceId: data.job.deviceId,
        jobId: data.job.id,
      });
      this.emit("job_started", data);
    });

    this.jobManager.on("job_completed", (data: { job: PrintJob }) => {
      this.statisticsCollector.recordJobCompleted({
        deviceId: data.job.deviceId,
        jobId: data.job.id,
        duration: Date.now() - data.job.createdAt.getTime(),
      });
      this.emit("job_completed", data);
    });

    this.jobManager.on(
      "job_failed",
      // The manager emits the message, not the Error. This handler declared
      // `error: Error` and read `.message` off it, so every failure was
      // recorded with an undefined reason until the event map made the
      // mismatch a compile error.
      (data: { job: PrintJob; error: string }) => {
        this.statisticsCollector.recordJobFailed({
          deviceId: data.job.deviceId,
          jobId: data.job.id,
          duration: Date.now() - data.job.createdAt.getTime(),
          error: data.error,
        });
        this.emit("job_failed", data);
      },
    );

    this.jobManager.on("job_retried", (data: { job: PrintJob }) => {
      this.statisticsCollector.recordJobRetried({
        deviceId: data.job.deviceId,
        jobId: data.job.id,
      });
      this.emit("job_retried", data);
    });
  }

  private async handleDeviceStatusChange(data: {
    deviceId: string;
    oldStatus: string;
    newStatus: string;
  }): Promise<void> {
    this.emit("device_status_changed", data);

    // 如果設備離線，暫停相關作業
    if (data.newStatus === "offline") {
      await this.jobManager.pauseDeviceJobs(data.deviceId);
    }

    // 如果設備重新上線，恢復相關作業
    if (data.newStatus === "online" && data.oldStatus === "offline") {
      await this.jobManager.resumeDeviceJobs(data.deviceId);
    }
  }

  private handleDeviceError(data: { deviceId: string; error: unknown }): void {
    console.error(`Device error for ${data.deviceId}:`, data.error);
    this.emit("device_error", data);
  }
}
