/**
 * Enhanced Print Agent Service
 * Integrates with queue-core printing modules
 */

import {
  PrinterService,
  PrinterDriverFactory,
} from "@makanmasak/queue-core/print";
import type {
  PrintRequest,
  PrintResponse,
  PrintJob,
  PrinterDevice,
  PrintServiceConfig,
} from "@makanmasak/shared-types";
import { LocalPrintServiceConfig } from "../LocalPrintService";

type PrintAgentEventListener = (data?: unknown) => void;

/** Sanitize user-provided values for safe logging (strip newlines and control chars) */
function sanitizeForLog(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\t\x00-\x1f\x7f-\x9f]/g, "");
}

export class PrintAgentService {
  private printerService: PrinterService;
  private driverFactory: PrinterDriverFactory;
  private config: LocalPrintServiceConfig;
  private isInitialized = false;

  constructor(config: LocalPrintServiceConfig) {
    this.config = config;

    // Create print service configuration from local config
    const printServiceConfig: PrintServiceConfig =
      this.createPrintServiceConfig(config);

    // Initialize core services from queue-core
    this.printerService = new PrinterService(printServiceConfig);
    this.driverFactory = new PrinterDriverFactory({
      connectionTimeout: 10000,
      commandTimeout: 5000,
      retryAttempts: config.maxRetries,
      enableAutoDetection: config.autoDiscovery,
    });

    this.setupEventHandlers();
  }

  // =============================================
  // Service Lifecycle
  // =============================================

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      console.log("🔧 Initializing Print Agent Service...");

      // Initialize printer service
      await this.printerService.initialize();

      // Auto-discover printers if enabled
      if (this.config.autoDiscovery) {
        await this.discoverPrinters();
      }

      this.isInitialized = true;
      console.log("✅ Print Agent Service initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Print Agent Service:", error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      console.log("🛑 Shutting down Print Agent Service...");

      // Disconnect all printers
      await this.printerService.shutdown();

      this.isInitialized = false;
      console.log("✅ Print Agent Service shut down successfully");
    } catch (error) {
      console.error("❌ Error during Print Agent Service shutdown:", error);
      throw error;
    }
  }

  // =============================================
  // Print Job Management
  // =============================================

  async createPrintJob(request: PrintRequest): Promise<PrintResponse> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Validate print request — validation failures are client errors
    try {
      this.validatePrintRequest(request);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid print request";
      console.error(
        "Print request validation failed:",
        sanitizeForLog(message),
      );
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message,
        },
      };
    }

    try {
      // Send to printer service (which handles job creation and queueing).
      // The printer service returns error-shaped responses itself
      // (e.g. NO_PRINTER_AVAILABLE, PRINT_REQUEST_FAILED).
      const response = await this.printerService.print(request);

      return response;
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? sanitizeForLog(error.message)
          : "Unknown error";
      console.error("Print job creation failed:", errorMsg);
      return {
        success: false,
        error: {
          code: "JOB_CREATION_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  async getJobStatus(jobId: string): Promise<PrintJob | null> {
    return await this.printerService.getJobStatus(jobId);
  }

  async cancelJob(jobId: string): Promise<boolean> {
    try {
      return await this.printerService.cancelJob(jobId);
    } catch (error) {
      console.error("Job cancellation failed:", error);
      return false;
    }
  }

  // =============================================
  // Device Management
  // =============================================

  async discoverPrinters(): Promise<PrinterDevice[]> {
    try {
      console.log("🔍 Discovering printers...");

      const devices = await this.driverFactory.scanForPrinters([
        "usb",
        "network",
        "bluetooth",
      ]);

      console.log(`Found ${devices.length} printer(s)`);

      // Auto-register discovered printers
      for (const device of devices) {
        await this.registerPrinter(device);
      }

      return devices;
    } catch (error) {
      console.error("Printer discovery failed:", error);
      return [];
    }
  }

  async registerPrinter(device: PrinterDevice): Promise<boolean> {
    try {
      // Check if device is already registered
      const existing = this.printerService.getDevice(device.id);
      if (existing) {
        console.log(
          "Printer %s already registered",
          sanitizeForLog(device.name),
        );
        return true;
      }

      // Register with printer service using the correct API
      await this.printerService.registerPrinter({
        id: device.id,
        brand: device.brand,
        model: device.model,
        connectionType: device.connection,
        connectionParams: { address: device.address },
        capabilities: {
          ...device.capabilities,
          ...(this.config.printerEncoding && {
            encoding: this.config.printerEncoding,
          }),
        },
        isDefault: false,
      });

      console.log(
        "Registered printer: %s (%s)",
        sanitizeForLog(device.name),
        sanitizeForLog(device.brand),
      );
      return true;
    } catch (error) {
      console.error(
        "Failed to register printer %s:",
        sanitizeForLog(device.name),
        error,
      );
      return false;
    }
  }

  async unregisterPrinter(deviceId: string): Promise<boolean> {
    try {
      await this.printerService.unregisterPrinter(deviceId);
      console.log("Unregistered printer: %s", sanitizeForLog(deviceId));
      return true;
    } catch (error) {
      console.error(
        "Failed to unregister printer %s:",
        sanitizeForLog(deviceId),
        error,
      );
      return false;
    }
  }

  getDevices(): PrinterDevice[] {
    return this.printerService.getDevices();
  }

  getDevice(deviceId: string): PrinterDevice | null {
    return this.printerService.getDevice(deviceId);
  }

  // =============================================
  // Health and Statistics
  // =============================================

  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    services: Record<string, boolean>;
    devices: { total: number; online: number; errors: number };
    queue: { pending: number; processing: number; failed: number };
  }> {
    const health = await this.printerService.healthCheck();
    const devices = this.getDevices();

    const onlineDevices = devices.filter((d) => d.status === "online").length;
    const deviceErrors = devices.filter((d) => d.status === "error").length;

    const services = {
      printerService: this.isInitialized,
      initialized: this.isInitialized,
    };

    // Agent-level status semantics:
    // - "unhealthy" is reserved for real failures (service not initialized)
    // - a running agent with no printers online is "degraded" — the service
    //   itself is up, the hardware is simply absent/offline
    // - otherwise defer to the underlying printer service assessment
    let status: "healthy" | "degraded" | "unhealthy";
    if (!this.isInitialized) {
      status = "unhealthy";
    } else if (devices.length === 0 || onlineDevices === 0) {
      status = "degraded";
    } else {
      status = health.service;
    }

    return {
      status,
      services,
      devices: {
        total: devices.length,
        online: onlineDevices,
        errors: deviceErrors,
      },
      queue: health.queue,
    };
  }

  getStatistics() {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      printing: this.printerService.getStatistics(),
    };
  }

  // =============================================
  // Event Handling
  // =============================================

  private setupEventHandlers(): void {
    // Printer service events
    this.printerService.on("device_registered", (data: unknown) => {
      this.emit("device_connected", data);
    });

    this.printerService.on("device_unregistered", (data: unknown) => {
      this.emit("device_disconnected", data);
    });

    this.printerService.on("job_completed", (data: unknown) => {
      this.emit("job_completed", data);
    });

    this.printerService.on("job_failed", (data: unknown) => {
      this.emit("job_failed", data);
    });
  }

  // Event emitter methods (simple implementation)
  private listeners: Map<string, PrintAgentEventListener[]> = new Map();

  on(event: string, listener: PrintAgentEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  emit(event: string, data?: unknown): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  // =============================================
  // Private Methods
  // =============================================

  private createPrintServiceConfig(
    config: LocalPrintServiceConfig,
  ): PrintServiceConfig {
    return {
      queue: {
        maxConcurrentJobs: 5,
        maxQueueSize: config.maxQueueSize,
        maxRetries: config.maxRetries,
        retryDelay: config.retryDelay,
        jobTimeout: 30000,
      },
      drivers: {
        connectionTimeout: 10000,
        commandTimeout: 5000,
        heartbeatInterval: config.heartbeatInterval,
        retryAttempts: config.maxRetries,
      },
      regions: {
        default: "TW",
        supported: ["TW", "MY", "VN"],
      },
    };
  }

  private validatePrintRequest(request: PrintRequest): void {
    if (!request.country) {
      throw new Error("Missing required field: country");
    }

    if (
      request.restaurantId &&
      request.restaurantId !== this.config.restaurantId
    ) {
      throw new Error(
        `Invalid restaurant ID: expected ${this.config.restaurantId}, got ${request.restaurantId}`,
      );
    }

    if (!request.type) {
      throw new Error("Missing required field: type");
    }

    if (!request.data) {
      throw new Error("Missing required field: data");
    }

    if (!request.data.order) {
      throw new Error("Missing required field: data.order");
    }
  }

  // =============================================
  // Getters
  // =============================================

  get initialized(): boolean {
    return this.isInitialized;
  }

  get configuration(): LocalPrintServiceConfig {
    return { ...this.config };
  }
}
