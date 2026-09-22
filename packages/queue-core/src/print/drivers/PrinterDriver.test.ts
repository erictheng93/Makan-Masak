import { createServer } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrintContent, PrinterDevice } from "@makanmasak/shared-types";
import { EpsonDriver } from "./EpsonDriver";
import { PrinterDriverFactory } from "./PrinterDriverFactory";
import { PrinterService } from "../services/PrinterService";

let tcpServer: Server | undefined;
let tcpPort: number;
let received: Buffer[];
let nextWrite: (() => void) | undefined;

const buildDevice = (): PrinterDevice => ({
  id: "printer-1",
  name: "EPSON TM-T20",
  brand: "epson",
  model: "TM-T20",
  connection: "network",
  address: `127.0.0.1:${tcpPort}`,
  status: "offline",
  capabilities: {
    maxWidth: 32,
    supportsGraphics: true,
    supportsCutter: true,
    supportsDrawer: true,
    supportsQRCode: true,
    supportsBarcode: true,
    supportedEncodings: ["utf8"],
    paperSizes: [],
  },
  lastSeen: new Date(),
  isDefault: false,
});

const closeTcpServer = async (): Promise<void> => {
  if (!tcpServer) return;
  const server = tcpServer;
  tcpServer = undefined;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

const waitForWrite = async (): Promise<Buffer> => {
  if (received.length > 0) return Buffer.concat(received);
  await new Promise<void>((resolve) => {
    nextWrite = resolve;
  });
  return Buffer.concat(received);
};

beforeEach(async () => {
  received = [];
  tcpServer = createServer((socket) => {
    socket.on("data", (chunk: Buffer) => {
      received.push(chunk);
      nextWrite?.();
      nextWrite = undefined;
    });
  });
  await new Promise<void>((resolve, reject) => {
    tcpServer!.once("error", reject);
    tcpServer!.listen(0, "127.0.0.1", resolve);
  });
  const address = tcpServer.address() as AddressInfo;
  tcpPort = address.port;
});

afterEach(async () => {
  await closeTcpServer();
});

const content: PrintContent = {
  header: {
    restaurantInfo: {
      name: "MakanMasak",
      address: "Taipei",
      phone: "02-1234-5678",
      taxNumber: "12345678",
    },
    transactionInfo: {
      orderId: "order-123",
      cashier: "System",
      timestamp: new Date("2026-08-12T00:00:00.000Z"),
      receiptNumber: "receipt-123",
    },
  },
  items: [],
  summary: { subtotal: 0, tax: [], total: 0, payment: [], change: 0 },
  footer: { thankYouMessage: "Thank you" },
};

class RetryingEpsonDriver extends EpsonDriver {
  attempts = 0;

  protected override async sendCommands(): Promise<void> {
    this.attempts += 1;
    if (this.attempts < 3) throw new Error("temporary transport failure");
  }
}

class SlowEpsonDriver extends EpsonDriver {
  protected override async sendCommands(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("PrinterDriver execution options", () => {
  it("retries a failed printer command the configured number of times", async () => {
    const driver = new RetryingEpsonDriver(buildDevice(), {
      retryAttempts: 2,
      commandTimeout: 100,
    });
    await driver.connect();

    await expect(driver.print(content)).resolves.toMatchObject({
      success: true,
    });
    expect(driver.attempts).toBe(3);
    await driver.disconnect();
  });

  it("fails a command that exceeds the configured timeout", async () => {
    const driver = new SlowEpsonDriver(buildDevice(), {
      retryAttempts: 0,
      commandTimeout: 5,
    });
    await driver.connect();

    await expect(driver.print(content)).resolves.toMatchObject({
      success: false,
      error: { code: "PRINT_FAILED" },
    });
    await driver.disconnect();
  });

  it("forwards the service driver policy when registering a printer", async () => {
    const device = buildDevice();
    const driver = new EpsonDriver(device);
    const createDriver = vi
      .spyOn(PrinterDriverFactory, "createDriver")
      .mockResolvedValue(driver);
    const service = new PrinterService({
      drivers: {
        connectionTimeout: 111,
        commandTimeout: 222,
        heartbeatInterval: 333,
        retryAttempts: 4,
      },
    });

    await service.registerPrinter({
      id: device.id,
      brand: device.brand,
      model: device.model,
      connectionType: device.connection,
      connectionParams: { host: "192.0.2.10", port: 9100 },
    });

    expect(createDriver).toHaveBeenCalledWith(
      device.brand,
      expect.any(Object),
      expect.objectContaining({
        connectionTimeout: 111,
        commandTimeout: 222,
        retryAttempts: 4,
      }),
    );
    await service.unregisterPrinter(device.id);
  });

  it("writes raw ESC/POS bytes to a reachable TCP printer", async () => {
    const driver = new EpsonDriver(buildDevice(), {
      connectionTimeout: 100,
      commandTimeout: 100,
      retryAttempts: 0,
    });

    await expect(driver.connect()).resolves.toBe(true);
    await expect(driver.print(content)).resolves.toMatchObject({
      success: true,
    });

    const bytes = await waitForWrite();
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(bytes.toString("utf8")).toContain("order-123");
    await expect(driver.getStatus()).resolves.toBe("online");

    await driver.disconnect();
  });

  it("keeps a refused TCP printer offline and leaves the service unhealthy", async () => {
    const refusedPort = tcpPort;
    await closeTcpServer();
    const refusedDevice: PrinterDevice = {
      ...buildDevice(),
      address: `127.0.0.1:${refusedPort}`,
    };
    const driver = new EpsonDriver(refusedDevice, {
      connectionTimeout: 50,
      retryAttempts: 0,
    });

    await expect(driver.connect()).resolves.toBe(false);
    await expect(driver.getStatus()).resolves.toBe("offline");

    const service = new PrinterService({
      drivers: {
        connectionTimeout: 50,
        commandTimeout: 50,
        heartbeatInterval: 100,
        retryAttempts: 0,
      },
    });
    await expect(
      service.registerPrinter({
        id: refusedDevice.id,
        brand: refusedDevice.brand,
        model: refusedDevice.model,
        connectionType: "network",
        connectionParams: { address: refusedDevice.address },
      }),
    ).rejects.toThrow(/Failed to register printer/);
    await expect(service.healthCheck()).resolves.toMatchObject({
      service: "unhealthy",
      devices: [],
    });
  });

  it("discovers a reachable TCP endpoint as generic instead of guessing a brand", async () => {
    const factory = new PrinterDriverFactory({
      connectionTimeout: 100,
      commandTimeout: 100,
      retryAttempts: 0,
      enableAutoDetection: true,
    });

    const detected = await factory.detectPrinter({
      type: "network",
      host: "127.0.0.1",
      port: tcpPort,
    });

    expect(detected).toMatchObject({
      brand: "generic",
      model: "Generic",
      address: `127.0.0.1:${tcpPort}`,
    });
    await expect(waitForWrite()).resolves.toEqual(
      Buffer.from([0x1d, 0x49, 0x01]),
    );
  });
});
