import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type {
  PrintContent,
  PrintJob,
  PrintServiceConfig,
  PrinterDriverConfig,
  PrinterDevice,
} from "@makanmasak/shared-types";
import { PrinterDriver, PrinterService, RegionManager } from "./PrinterService";

function createConfig(): PrintServiceConfig {
  return {
    defaultDevice: null,
    queue: {
      maxConcurrentJobs: 3,
      maxRetries: 1,
      retryDelay: 1,
      jobTimeout: 1000,
      maxQueueSize: 10,
    },
    drivers: {
      connectionTimeout: 1000,
      commandTimeout: 1000,
      heartbeatInterval: 1000,
      retryAttempts: 1,
    },
  };
}

function createDevice(
  id: string,
  status: PrinterDevice["status"],
): PrinterDevice {
  return {
    id,
    name: id,
    brand: "generic",
    model: "test",
    connection: "network",
    address: "127.0.0.1",
    status,
    capabilities: {
      maxWidth: 48,
      supportsGraphics: true,
      supportsCutter: true,
      supportsDrawer: true,
      supportsQRCode: true,
      supportsBarcode: true,
      supportedEncodings: ["utf-8"],
      paperSizes: [{ width: 80, height: 0, name: "80mm" }],
    },
    lastSeen: new Date(2026, 5, 12, 8),
    isDefault: false,
  };
}

function createDriverConfig(): PrinterDriverConfig {
  return {
    brand: "generic",
    encoding: "utf-8",
    commandSet: "esc-pos",
    features: {
      cutter: true,
      drawer: true,
      buzzer: true,
      graphics: true,
    },
  };
}

class TestPrinterDriver extends PrinterDriver {
  async connect(): Promise<boolean> {
    return true;
  }

  async disconnect(): Promise<void> {}

  async print(_commands: Buffer): Promise<boolean> {
    return true;
  }

  async getStatus(): Promise<PrinterDevice["status"]> {
    return this.device.status;
  }

  async openDrawer(): Promise<boolean> {
    return true;
  }

  async cutPaper(): Promise<boolean> {
    return true;
  }

  async buzzer(_times?: number): Promise<boolean> {
    return true;
  }
}

function createContent(): PrintContent {
  return {
    header: {
      restaurantInfo: {
        name: "Test Restaurant",
        address: "1 Test Street",
        phone: "555-0100",
      },
      transactionInfo: {
        orderId: "order-1",
        cashier: "cashier-1",
        timestamp: new Date(2026, 5, 12, 9),
        receiptNumber: "R-1",
      },
    },
    items: [],
    summary: {
      subtotal: 0,
      tax: [],
      total: 0,
      payment: [],
    },
    footer: {
      thankYouMessage: "Thank you",
    },
  };
}

function createCompletedJob(
  id: string,
  createdAt: Date,
  completedAt: Date,
  paperUsage: number,
): PrintJob {
  return {
    id,
    type: "receipt",
    priority: "normal",
    status: "completed",
    deviceId: "printer-online",
    content: createContent(),
    options: {
      copies: 1,
      cutPaper: true,
      openDrawer: false,
      buzzer: false,
      feedLines: 3,
    },
    attempts: 1,
    maxAttempts: 1,
    createdAt,
    updatedAt: completedAt,
    startedAt: createdAt,
    completedAt,
    metadata: {
      restaurantId: "restaurant-1",
      paperUsage,
    } as PrintJob["metadata"] & { paperUsage: number },
  };
}

function addQueuedJob(service: PrinterService, job: PrintJob): void {
  const queue = (
    service as unknown as {
      queue: { jobs: Map<string, PrintJob> };
    }
  ).queue;

  queue.jobs.set(job.id, job);
}

describe("PrinterService statistics", () => {
  it("returns safe zero statistics when no jobs or devices exist", () => {
    const service = new PrinterService(createConfig());

    const stats = service.getStatistics();

    expect(stats.totalJobs).toBe(0);
    expect(stats.completedJobs).toBe(0);
    expect(stats.failedJobs).toBe(0);
    expect(stats.averageJobTime).toBe(0);
    expect(stats.paperUsage).toBe(0);
    expect(stats.deviceUptime).toBe(0);
    expect(stats.errorRate).toBe(0);
    expect(stats.busyHours).toEqual([]);
    expect(Number.isFinite(stats.deviceUptime)).toBe(true);
    expect(Number.isFinite(stats.errorRate)).toBe(true);
  });

  it("derives timing, paper use, uptime, and busy hours from current state", async () => {
    const service = new PrinterService(createConfig());

    await service.registerDriver(
      new TestPrinterDriver(
        createDevice("printer-online", "online"),
        createDriverConfig(),
      ),
    );
    await service.registerDriver(
      new TestPrinterDriver(
        createDevice("printer-offline", "offline"),
        createDriverConfig(),
      ),
    );

    addQueuedJob(
      service,
      createCompletedJob(
        "job-1",
        new Date(2026, 5, 12, 9, 0, 0),
        new Date(2026, 5, 12, 9, 0, 4),
        120,
      ),
    );
    addQueuedJob(
      service,
      createCompletedJob(
        "job-2",
        new Date(2026, 5, 12, 9, 30, 0),
        new Date(2026, 5, 12, 9, 30, 10),
        80,
      ),
    );

    const stats = service.getStatistics();

    expect(stats.totalJobs).toBe(2);
    expect(stats.completedJobs).toBe(2);
    expect(stats.failedJobs).toBe(0);
    expect(stats.averageJobTime).toBe(7000);
    expect(stats.paperUsage).toBe(200);
    expect(stats.deviceUptime).toBe(50);
    expect(stats.errorRate).toBe(0);
    expect(stats.busyHours).toEqual([{ hour: 9, jobCount: 2 }]);
  });
});

describe("RegionManager.formatCurrency", () => {
  it.each([
    ["TW", 350, "NT$350"],
    ["MY", 12.5, "RM 12.50"],
    ["VN", 350000, "350.000 ₫"],
  ] as const)("%s %s → %s", (country, amount, expected) => {
    expect(new RegionManager().formatCurrency(amount, country)).toBe(expected);
  });
});
