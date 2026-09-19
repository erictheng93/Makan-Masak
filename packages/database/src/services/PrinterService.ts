/**
 * 熱敏打印機服務 - 核心抽象層
 * 負責協調所有打印操作，支援多品牌打印機和地區化
 */

import type {
  CountryCode,
  PrintContent,
  PrinterDevice,
  PrintJob,
  PrintJobStatus,
  PrintRequest,
  PrintResponse,
  PrinterDriverConfig,
  PrinterEvent,
  PrintServiceConfig,
  PrintStatistics,
  RegionConfig,
} from "@makanmasak/shared-types";
import { formatCurrency as formatCurrencyAmount } from "@makanmasak/utils";

type PrintJobMetricsMetadata = NonNullable<PrintJob["metadata"]> & {
  paperUsage?: unknown;
  paperUsageMm?: unknown;
};

// =============================================
// 抽象打印機驅動類
// =============================================

export abstract class PrinterDriver {
  protected device: PrinterDevice;
  protected config: PrinterDriverConfig;

  constructor(device: PrinterDevice, config: PrinterDriverConfig) {
    this.device = device;
    this.config = config;
  }

  // 抽象方法 - 各品牌必須實作
  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract print(commands: Buffer): Promise<boolean>;
  abstract getStatus(): Promise<PrinterDevice["status"]>;
  abstract openDrawer(): Promise<boolean>;
  abstract cutPaper(): Promise<boolean>;
  abstract buzzer(times?: number): Promise<boolean>;

  // 通用方法
  getDevice(): PrinterDevice {
    return this.device;
  }

  isConnected(): boolean {
    return this.device.status === "online";
  }

  supportsFeature(feature: string): boolean {
    const capabilities = this.device.capabilities;
    switch (feature) {
      case "cutter":
        return capabilities.supportsCutter;
      case "drawer":
        return capabilities.supportsDrawer;
      case "graphics":
        return capabilities.supportsGraphics;
      case "qrcode":
        return capabilities.supportsQRCode;
      default:
        return false;
    }
  }
}

// =============================================
// 打印作業佇列管理
// =============================================

export class PrintJobQueue {
  private jobs: Map<string, PrintJob> = new Map();
  private processing: Set<string> = new Set();
  private maxConcurrent: number;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  add(job: PrintJob): void {
    this.jobs.set(job.id, job);
    this.processNext();
  }

  remove(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job && job.status === "pending") {
      this.jobs.delete(jobId);
      return true;
    }
    return false;
  }

  get(jobId: string): PrintJob | undefined {
    return this.jobs.get(jobId);
  }

  getByStatus(status: PrintJobStatus): PrintJob[] {
    return Array.from(this.jobs.values())
      .filter((job) => job.status === status)
      .sort((a, b) => {
        // 優先級排序
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }

  getPending(): PrintJob[] {
    return this.getByStatus("pending");
  }

  getProcessing(): PrintJob[] {
    return this.getByStatus("printing");
  }

  private async processNext(): Promise<void> {
    if (this.processing.size >= this.maxConcurrent) {
      return;
    }

    const pendingJobs = this.getPending();
    if (pendingJobs.length === 0) {
      return;
    }

    const job = pendingJobs[0];
    this.processing.add(job.id);

    try {
      await this.processJob(job);
    } catch (error) {
      console.error("Failed to process print job:", error);
    } finally {
      this.processing.delete(job.id);
      // 繼續處理下一個作業
      this.processNext();
    }
  }

  private async processJob(_job: PrintJob): Promise<void> {
    // 這裡會被 PrinterService 覆寫
    throw new Error("processJob must be implemented by PrinterService");
  }

  updateJob(jobId: string, updates: Partial<PrintJob>): boolean {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates, { updatedAt: new Date() });
      return true;
    }
    return false;
  }

  getStatistics(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    averageJobTime: number;
    paperUsage: number;
    busyHours: { hour: number; jobCount: number }[];
  } {
    const jobs = Array.from(this.jobs.values());
    const completedDurations = jobs
      .map((job) => this.getCompletedDuration(job))
      .filter((duration): duration is number => duration !== null);
    const busyHourCounts = new Map<number, number>();

    for (const job of jobs) {
      const timestamp = job.startedAt ?? job.createdAt;
      if (Number.isNaN(timestamp.getTime())) {
        continue;
      }

      const hour = timestamp.getHours();
      busyHourCounts.set(hour, (busyHourCounts.get(hour) ?? 0) + 1);
    }

    return {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === "pending").length,
      processing: jobs.filter((j) => j.status === "printing").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      averageJobTime:
        completedDurations.length === 0
          ? 0
          : completedDurations.reduce((sum, duration) => sum + duration, 0) /
            completedDurations.length,
      paperUsage: jobs.reduce(
        (total, job) => total + this.getRecordedPaperUsage(job),
        0,
      ),
      busyHours: Array.from(busyHourCounts.entries())
        .sort(([left], [right]) => left - right)
        .map(([hour, jobCount]) => ({ hour, jobCount })),
    };
  }

  private getCompletedDuration(job: PrintJob): number | null {
    if (job.status !== "completed" || !job.completedAt) {
      return null;
    }

    const startedAt = job.startedAt ?? job.createdAt;
    const duration = job.completedAt.getTime() - startedAt.getTime();

    return Number.isFinite(duration) && duration >= 0 ? duration : null;
  }

  private getRecordedPaperUsage(job: PrintJob): number {
    const metadata = job.metadata as PrintJobMetricsMetadata | undefined;
    const usage = metadata?.paperUsage ?? metadata?.paperUsageMm;

    return typeof usage === "number" && Number.isFinite(usage) && usage > 0
      ? usage
      : 0;
  }
}

// =============================================
// 地區化管理器
// =============================================

export class RegionManager {
  private regions: Map<CountryCode, RegionConfig>;

  constructor() {
    this.regions = new Map();
    this.initializeDefaultRegions();
  }

  getRegion(country: CountryCode): RegionConfig {
    const region = this.regions.get(country);
    if (!region) {
      throw new Error(`Region configuration not found for country: ${country}`);
    }
    return region;
  }

  setRegion(country: CountryCode, config: RegionConfig): void {
    this.regions.set(country, config);
  }

  formatCurrency(amount: number, country: CountryCode): string {
    // Intl style:"currency" renders TWD as "$350.00" in zh-TW. The shared
    // formatter prints what the apps print: "NT$350", "RM 12.50", "350.000 ₫".
    return formatCurrencyAmount(amount, this.getRegion(country).currency);
  }

  formatDate(date: Date, country: CountryCode): string {
    const region = this.getRegion(country);
    return new Intl.DateTimeFormat(region.locale, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: region.timezone,
    }).format(date);
  }

  private initializeDefaultRegions(): void {
    // 台灣地區設定
    this.regions.set("TW", {
      country: "TW",
      currency: "TWD",
      locale: "zh-TW",
      timezone: "Asia/Taipei",
      dateFormat: "YYYY/MM/DD",
      timeFormat: "HH:mm:ss",
      numberFormat: {
        decimal: ".",
        thousand: ",",
        currency: {
          symbol: "NT$",
          position: "before",
          space: false,
        },
      },
      tax: {
        name: "Tax",
        nameLocal: "營業稅",
        rate: 0.05,
        inclusive: false,
        displayFormat: "營業稅 (5%)",
      },
      legal: {
        requiresTaxNumber: true,
        requiresLicense: true,
        invoiceFormat: "government",
        retentionPeriod: 1825, // 5年
        electronicInvoice: true,
      },
      receipt: {
        width: 32,
        headerLines: 8,
        footerLines: 6,
        itemNameMaxLength: 20,
        showItemCodes: false,
        showTaxBreakdown: true,
        defaultFont: "normal",
        paperSize: "80mm",
      },
    });

    // 馬來西亞地區設定
    this.regions.set("MY", {
      country: "MY",
      currency: "MYR",
      locale: "ms-MY",
      timezone: "Asia/Kuala_Lumpur",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "HH:mm:ss",
      numberFormat: {
        decimal: ".",
        thousand: ",",
        currency: {
          symbol: "RM",
          position: "before",
          space: true,
        },
      },
      tax: {
        name: "SST",
        nameLocal: "SST",
        rate: 0.06,
        inclusive: false,
        displayFormat: "SST (6%)",
      },
      legal: {
        requiresTaxNumber: false,
        requiresLicense: true,
        invoiceFormat: "detailed",
        retentionPeriod: 2555, // 7年
        electronicInvoice: false,
      },
      receipt: {
        width: 32,
        headerLines: 6,
        footerLines: 4,
        itemNameMaxLength: 18,
        showItemCodes: true,
        showTaxBreakdown: true,
        defaultFont: "normal",
        paperSize: "80mm",
      },
    });

    // 越南地區設定
    this.regions.set("VN", {
      country: "VN",
      currency: "VND",
      locale: "vi-VN",
      timezone: "Asia/Ho_Chi_Minh",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "HH:mm:ss",
      numberFormat: {
        decimal: ",",
        thousand: ".",
        currency: {
          symbol: "₫",
          position: "after",
          space: true,
        },
      },
      tax: {
        name: "VAT",
        nameLocal: "VAT",
        rate: 0.1,
        inclusive: true,
        displayFormat: "VAT (10%)",
      },
      legal: {
        requiresTaxNumber: true,
        requiresLicense: true,
        invoiceFormat: "government",
        retentionPeriod: 1825, // 5年
        electronicInvoice: true,
      },
      receipt: {
        width: 32,
        headerLines: 6,
        footerLines: 5,
        itemNameMaxLength: 16,
        showItemCodes: false,
        showTaxBreakdown: true,
        defaultFont: "normal",
        paperSize: "80mm",
      },
    });
  }
}

// =============================================
// 主要打印機服務
// =============================================

export class PrinterService {
  private drivers: Map<string, PrinterDriver> = new Map();
  private queue: PrintJobQueue;
  private regionManager: RegionManager;
  private eventHandlers: Map<string, ((...args: unknown[]) => void)[]> =
    new Map();
  private config: PrintServiceConfig;

  constructor(config: PrintServiceConfig) {
    this.config = config;
    this.queue = new PrintJobQueue(config.queue.maxQueueSize);
    this.regionManager = new RegionManager();

    // 覆寫佇列的處理方法
    this.queue["processJob"] = this.processJob.bind(this);
  }

  // =============================================
  // 設備管理
  // =============================================

  async registerDriver(driver: PrinterDriver): Promise<void> {
    const device = driver.getDevice();
    this.drivers.set(device.id, driver);

    try {
      const connected = await driver.connect();
      if (connected) {
        this.emit("device_connected", { deviceId: device.id });
      }
    } catch (error) {
      this.emit("device_error", {
        deviceId: device.id,
        message: `Failed to connect: ${error}`,
      });
    }
  }

  async unregisterDriver(deviceId: string): Promise<void> {
    const driver = this.drivers.get(deviceId);
    if (driver) {
      try {
        await driver.disconnect();
      } catch (error) {
        console.warn(`Failed to disconnect device ${deviceId}:`, error);
      }
      this.drivers.delete(deviceId);
      this.emit("device_disconnected", { deviceId });
    }
  }

  getDevices(): PrinterDevice[] {
    return Array.from(this.drivers.values()).map((d) => d.getDevice());
  }

  getDevice(deviceId: string): PrinterDevice | null {
    const driver = this.drivers.get(deviceId);
    return driver ? driver.getDevice() : null;
  }

  getDefaultDevice(): PrinterDevice | null {
    const defaultId = this.config.defaultDevice;
    if (defaultId) {
      return this.getDevice(defaultId);
    }

    // 如果沒有設定預設，選擇第一個線上的設備
    const devices = this.getDevices();
    return devices.find((d) => d.status === "online") || devices[0] || null;
  }

  // =============================================
  // 打印作業管理
  // =============================================

  async createPrintJob(request: PrintRequest): Promise<PrintResponse> {
    try {
      // 選擇打印機
      const device = request.deviceId
        ? this.getDevice(request.deviceId)
        : this.getDefaultDevice();

      if (!device) {
        return {
          success: false,
          error: {
            code: "NO_PRINTER",
            message: "No available printer found",
          },
        };
      }

      // 生成打印內容
      const content = await this.generatePrintContent(request);

      // 創建打印作業
      const job: PrintJob = {
        id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: request.type,
        priority: request.priority || "normal",
        status: "pending",
        deviceId: device.id,
        content,
        options: {
          copies: 1,
          cutPaper: true,
          openDrawer: false,
          buzzer: false,
          feedLines: 3,
          ...request.options,
        },
        attempts: 0,
        maxAttempts: this.config.queue.maxRetries,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 加入佇列
      this.queue.add(job);

      return {
        success: true,
        jobId: job.id,
        message: "Print job created successfully",
        estimatedTime: this.estimateProcessingTime(job),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "CREATION_FAILED",
          message: `Failed to create print job: ${error}`,
        },
      };
    }
  }

  getJobStatus(jobId: string): PrintJob | null {
    return this.queue.get(jobId) || null;
  }

  cancelJob(jobId: string): boolean {
    return this.queue.remove(jobId);
  }

  // =============================================
  // 內部處理方法
  // =============================================

  private async processJob(job: PrintJob): Promise<void> {
    const driver = this.drivers.get(job.deviceId);
    if (!driver) {
      this.handleJobError(job, "DRIVER_NOT_FOUND", "Printer driver not found");
      return;
    }

    try {
      this.queue.updateJob(job.id, {
        status: "printing",
        attempts: job.attempts + 1,
      });

      this.emit("job_started", { jobId: job.id, deviceId: job.deviceId });

      // 檢查打印機狀態
      const status = await driver.getStatus();
      if (status !== "online") {
        throw new Error(`Printer is ${status}`);
      }

      // 生成打印機命令
      const commands = await this.generatePrintCommands(
        job.content,
        job.deviceId,
      );

      // 執行打印
      const success = await driver.print(commands);
      if (!success) {
        throw new Error("Print command failed");
      }

      // 後處理操作
      if (job.options.cutPaper && driver.supportsFeature("cutter")) {
        await driver.cutPaper();
      }

      if (job.options.openDrawer && driver.supportsFeature("drawer")) {
        await driver.openDrawer();
      }

      if (job.options.buzzer && driver.supportsFeature("buzzer")) {
        await driver.buzzer();
      }

      // 標記完成
      this.queue.updateJob(job.id, {
        status: "completed",
        completedAt: new Date(),
      });

      this.emit("job_completed", { jobId: job.id, deviceId: job.deviceId });
    } catch (error) {
      this.handleJobError(job, "PRINT_FAILED", `Print failed: ${error}`);
    }
  }

  private handleJobError(job: PrintJob, code: string, message: string): void {
    const shouldRetry = job.attempts < job.maxAttempts;

    if (shouldRetry) {
      // 重試邏輯
      setTimeout(() => {
        this.queue.updateJob(job.id, { status: "pending" });
        this.queue["processNext"]();
      }, this.config.queue.retryDelay);
    } else {
      // 標記為失敗
      this.queue.updateJob(job.id, {
        status: "failed",
        error: { code, message },
      });

      this.emit("job_failed", {
        jobId: job.id,
        deviceId: job.deviceId,
        error: { code, message },
      });
    }
  }

  private async generatePrintContent(
    _request: PrintRequest,
  ): Promise<PrintContent> {
    // 這裡會根據請求數據和地區設定生成收據內容
    // 實作由 @makanmasak/queue-core/print 的 ReceiptFormattingService 提供
    throw new Error("generatePrintContent not implemented yet");
  }

  private async generatePrintCommands(
    _content: PrintContent,
    _deviceId: string,
  ): Promise<Buffer> {
    // 這裡會根據打印機品牌生成對應的命令集
    // 實作由 @makanmasak/queue-core/print 的品牌 Driver 提供
    throw new Error("generatePrintCommands not implemented yet");
  }

  private estimateProcessingTime(job: PrintJob): number {
    // 根據內容長度、打印機速度等估算處理時間
    const baseTime = 5000; // 5秒基準時間
    const itemCount = job.content.items.length;
    return baseTime + itemCount * 500; // 每個品項加 0.5 秒
  }

  // =============================================
  // 事件管理
  // =============================================

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: PrinterEvent["data"]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Event handler error for ${event}:`, error);
        }
      });
    }
  }

  // =============================================
  // 統計和監控
  // =============================================

  getStatistics(): PrintStatistics {
    const queueStats = this.queue.getStatistics();
    const devices = this.getDevices();
    const onlineDevices = devices.filter((d) => d.status === "online").length;

    return {
      totalJobs: queueStats.total,
      completedJobs: queueStats.completed,
      failedJobs: queueStats.failed,
      averageJobTime: queueStats.averageJobTime,
      paperUsage: queueStats.paperUsage,
      deviceUptime:
        devices.length === 0 ? 0 : (onlineDevices / devices.length) * 100,
      errorRate:
        queueStats.total === 0
          ? 0
          : (queueStats.failed / queueStats.total) * 100,
      busyHours: queueStats.busyHours,
    };
  }

  async healthCheck(): Promise<{
    service: "healthy" | "degraded" | "unhealthy";
    devices: { deviceId: string; status: string }[];
    queue: { pending: number; processing: number };
  }> {
    const devices = this.getDevices();
    const queueStats = this.queue.getStatistics();

    const deviceStatuses = await Promise.all(
      devices.map(async (device) => {
        try {
          const driver = this.drivers.get(device.id);
          const status = driver ? await driver.getStatus() : "offline";
          return { deviceId: device.id, status };
        } catch {
          return { deviceId: device.id, status: "error" };
        }
      }),
    );

    const onlineDevices = deviceStatuses.filter(
      (d) => d.status === "online",
    ).length;
    const serviceStatus =
      onlineDevices === 0
        ? "unhealthy"
        : onlineDevices < devices.length
          ? "degraded"
          : "healthy";

    return {
      service: serviceStatus,
      devices: deviceStatuses,
      queue: {
        pending: queueStats.pending,
        processing: queueStats.processing,
      },
    };
  }
}
