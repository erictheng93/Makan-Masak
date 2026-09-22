import { createServer } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PrintAgentService } from "./PrintAgentService";
import type { LocalPrintServiceConfig } from "../LocalPrintService";
import type { PrintRequest } from "@makanmasak/shared-types";

const buildConfig = (
  overrides: Partial<LocalPrintServiceConfig> = {},
): LocalPrintServiceConfig => ({
  port: 31003,
  wsPort: 31004,
  allowedOrigins: ["http://localhost:5173"],
  apiKey: "test-print-agent-api-key",
  cloudEndpoint: "https://api.example/v1",
  serviceName: "Print Agent",
  restaurantId: "restaurant-42",
  autoDiscovery: false,
  discoveryInterval: 30000,
  heartbeatInterval: 60000,
  maxQueueSize: 100,
  maxRetries: 3,
  retryDelay: 5000,
  ...overrides,
});

const buildPrintRequest = (overrides: Record<string, unknown> = {}) =>
  ({
    restaurantId: "restaurant-42",
    country: "TW",
    type: "order",
    data: {
      order: {
        id: "ORDER-1",
        items: [{ name: "Nasi Lemak", quantity: 1, price: 12 }],
        subtotal: 12,
        tax: 0,
        total: 12,
        createdAt: new Date(),
      },
    },
    ...overrides,
  }) as PrintRequest;

describe("PrintAgentService health semantics", () => {
  let agent: PrintAgentService | undefined;

  afterEach(async () => {
    if (agent?.initialized) {
      await agent.shutdown();
    }
    agent = undefined;
  });

  it("reports unhealthy before initialization", async () => {
    agent = new PrintAgentService(buildConfig());

    const health = await agent.healthCheck();

    expect(health).toEqual(
      expect.objectContaining({
        status: "unhealthy",
        services: expect.objectContaining({ initialized: false }),
      }),
    );
  });

  it("reports degraded when initialized with zero printers online", async () => {
    agent = new PrintAgentService(buildConfig());
    await agent.initialize();

    const health = await agent.healthCheck();

    expect(health).toEqual(
      expect.objectContaining({
        status: "degraded",
        services: expect.objectContaining({ initialized: true }),
        devices: expect.objectContaining({ total: 0, online: 0 }),
      }),
    );
  });
});

describe("PrintAgentService createPrintJob error contract", () => {
  let agent: PrintAgentService | undefined;

  afterEach(async () => {
    if (agent?.initialized) {
      await agent.shutdown();
    }
    agent = undefined;
  });

  it("returns VALIDATION_ERROR for a request missing required fields", async () => {
    agent = new PrintAgentService(buildConfig());
    await agent.initialize();

    const result = await agent.createPrintJob(
      buildPrintRequest({ country: undefined }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
          message: expect.stringContaining("country"),
        }),
      }),
    );
  });

  it("returns NO_PRINTER_AVAILABLE for a valid request with no printers", async () => {
    agent = new PrintAgentService(buildConfig());
    await agent.initialize();

    const result = await agent.createPrintJob(buildPrintRequest());

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "NO_PRINTER_AVAILABLE" }),
      }),
    );
  });
});

describe("PrintAgentService TCP ESC/POS execution", () => {
  it("completes a queued job only after writing ESC/POS bytes to TCP", async () => {
    const received: Buffer[] = [];
    let resolveWrite: (() => void) | undefined;
    const waitForWrite = async (): Promise<Buffer> => {
      if (received.length > 0) return Buffer.concat(received);
      await new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
      return Buffer.concat(received);
    };
    const printer = createServer((socket) => {
      socket.on("data", (chunk: Buffer) => {
        received.push(chunk);
        resolveWrite?.();
        resolveWrite = undefined;
      });
    });
    await new Promise<void>((resolve, reject) => {
      printer.once("error", reject);
      printer.listen(0, "127.0.0.1", resolve);
    });
    const port = (printer.address() as AddressInfo).port;
    const agent = new PrintAgentService(buildConfig());

    try {
      await agent.initialize();
      await expect(
        agent.registerPrinter({
          id: "tcp-printer",
          name: "Generic TCP ESC/POS",
          brand: "generic",
          model: "Generic",
          connection: "network",
          address: `127.0.0.1:${port}`,
          status: "offline",
          capabilities: {
            maxWidth: 32,
            supportsGraphics: false,
            supportsCutter: true,
            supportsDrawer: true,
            supportsQRCode: false,
            supportsBarcode: true,
            supportedEncodings: ["utf8"],
            paperSizes: [],
          },
          lastSeen: new Date(),
          isDefault: true,
        }),
      ).resolves.toBe(true);

      const created = await agent.createPrintJob(buildPrintRequest());
      expect(created).toMatchObject({
        success: true,
        jobId: expect.any(String),
      });

      let job = await agent.getJobStatus(created.jobId!);
      const deadline = Date.now() + 2_000;
      while (job?.status !== "completed" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        job = await agent.getJobStatus(created.jobId!);
      }

      expect(job).toMatchObject({
        status: "completed",
        deviceId: "tcp-printer",
      });
      const bytes = await waitForWrite();
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
      expect(bytes.toString("utf8")).toContain("ORDER-1");
    } finally {
      await agent.shutdown();
      await new Promise<void>((resolve, reject) => {
        printer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
