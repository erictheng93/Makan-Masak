/**
 * 統一打印機驅動工廠
 * 支持多品牌打印機驅動的創建和管理
 */

import type {
  PrinterBrand,
  PrinterCapabilities,
  PrinterConnection,
  PrinterDevice,
} from "@makanmasak/shared-types";
import { createConnection } from "node:net";

import { PRINTER_BRANDS } from "../config/brands";
import { PrinterDriverError } from "../errors/PrintErrors";
import { CitizenDriver, type CitizenPrinterOptions } from "./CitizenDriver";
import { EpsonDriver, type EpsonDriverOptions } from "./EpsonDriver";
import { parseNetworkPrinterAddress, PrinterDriver } from "./PrinterDriver";
import { StarDriver, type StarDriverOptions } from "./StarDriver";

export interface DriverFactoryConfig {
  connectionTimeout: number;
  commandTimeout: number;
  retryAttempts: number;
  enableAutoDetection: boolean;
}

/**
 * Transport-specific address fields. Which ones carry a value depends on the
 * connection type — formatAddress picks per transport — so all are optional.
 */
export interface PrinterConnectionParams {
  type?: string;
  host?: string;
  port?: number;
  address?: string;
  path?: string;
  mac?: string;
}

/** Options accepted when scanning a transport for devices. */
export interface PrinterScanOptions {
  networkRanges?: string[];
  serialPorts?: string[];
}

/** Resolve a discovery probe without mistaking a TCP blackhole for a printer. */
export function deviceInfoFromProbe(
  connected: boolean,
  response: Buffer[],
): string | null {
  if (!connected) return null;
  const info = Buffer.concat(response)
    .toString("utf8")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .trim();
  return info || "Generic ESC/POS Network Printer";
}

/** Whatever the concrete drivers accept; each brand narrows it further. */
export type PrinterDriverOptions = EpsonDriverOptions &
  StarDriverOptions &
  CitizenPrinterOptions;

export class PrinterDriverFactory {
  private static instance: PrinterDriverFactory;
  private config: DriverFactoryConfig;
  private brandDetectors: Map<PrinterBrand, (deviceInfo: string) => boolean> =
    new Map();

  constructor(config: DriverFactoryConfig) {
    this.config = config;
    this.initializeBrandDetectors();
  }

  getConfig(): DriverFactoryConfig {
    return this.config;
  }

  static getInstance(config?: DriverFactoryConfig): PrinterDriverFactory {
    if (!PrinterDriverFactory.instance) {
      if (!config) {
        throw new PrinterDriverError(
          "PrinterDriverFactory requires config for first initialization",
        );
      }
      PrinterDriverFactory.instance = new PrinterDriverFactory(config);
    }
    return PrinterDriverFactory.instance;
  }

  // =============================================
  // 驅動創建
  // =============================================

  static async createDriver(
    brand: PrinterBrand,
    deviceConfig: {
      id: string;
      model: string;
      connectionType: PrinterConnection;
      connectionParams: PrinterConnectionParams;
      capabilities?: PrinterCapabilities;
    },
    driverConfig?: PrinterDriverOptions,
  ): Promise<PrinterDriver> {
    const device: PrinterDevice = {
      id: deviceConfig.id,
      name: `${brand.toUpperCase()} ${deviceConfig.model}`,
      brand,
      model: deviceConfig.model,
      connection: deviceConfig.connectionType,
      address: this.formatAddress(
        deviceConfig.connectionType,
        deviceConfig.connectionParams,
      ),
      status: "offline",
      capabilities:
        deviceConfig.capabilities || this.getDefaultCapabilities(brand),
      lastSeen: new Date(),
      isDefault: false,
    };

    return this.createDriverForDevice(device, driverConfig);
  }

  /**
   * NOTE: none of the drivers declare (or read) connection timeouts or retry
   * counts, so the factory no longer pretends to pass them. Wiring real
   * per-driver timeouts is tracked separately.
   */
  static async createDriverForDevice(
    device: PrinterDevice,
    config?: PrinterDriverOptions,
  ): Promise<PrinterDriver> {
    try {
      switch (device.brand) {
        case "epson":
          return new EpsonDriver(device, { ...config });

        case "star":
          return new StarDriver(device, {
            emulation: this.determineStarEmulation(device.model),
            ...config,
          });

        case "citizen":
          return new CitizenDriver(device, { ...config });

        case "generic":
          // 通用驅動使用 ESC/POS 標準 (基於 Epson)
          return new EpsonDriver(device, { ...config });

        default:
          throw new PrinterDriverError(
            `Unsupported printer brand: ${device.brand}`,
          );
      }
    } catch (error) {
      throw new PrinterDriverError(
        `Failed to create driver for ${device.brand} ${device.model}: ${error}`,
        { device, config },
      );
    }
  }

  // =============================================
  // 設備自動檢測
  // =============================================

  async detectPrinter(connectionInfo: {
    type: PrinterConnection;
    address?: string;
    host?: string;
    port?: number;
    path?: string;
  }): Promise<PrinterDevice | null> {
    try {
      const address = this.formatConnectionAddress(connectionInfo);
      console.log(
        `Detecting printer at ${String(connectionInfo.type).replace(/[\r\n\t]/g, " ")}:${String(
          address,
        )
          .replace(/[\r\n\t]/g, " ")
          .slice(0, 500)}`,
      );

      // 嘗試連接並查詢設備資訊
      const deviceInfo = await this.queryDeviceInfo(connectionInfo);

      if (!deviceInfo) {
        return null;
      }

      // 根據回應識別品牌和型號
      const brand = this.identifyBrand(deviceInfo);
      const model = this.identifyModel(deviceInfo, brand);

      const device: PrinterDevice = {
        id: this.generateDeviceId(connectionInfo, model),
        name: `${brand.toUpperCase()} ${model}`,
        brand,
        model,
        connection: connectionInfo.type,
        address,
        status: "offline",
        capabilities: PrinterDriverFactory.getDefaultCapabilities(brand),
        lastSeen: new Date(),
        isDefault: false,
      };

      return device;
    } catch (error) {
      console.error("Printer detection failed:", error);
      return null;
    }
  }

  async scanForPrinters(
    connectionTypes: PrinterConnection[] = ["usb", "network"],
    options?: {
      networkRanges?: string[];
      serialPorts?: string[];
      timeout?: number;
    },
  ): Promise<PrinterDevice[]> {
    const discoveredDevices: PrinterDevice[] = [];

    const scanPromises = connectionTypes.map(async (connectionType) => {
      try {
        const devices = await this.scanConnectionType(connectionType, options);
        return devices;
      } catch (error) {
        const safeConnectionType = String(connectionType).replace(
          /[\r\n\t]/g,
          " ",
        );
        console.error("Failed to scan %s printers:", safeConnectionType, error);
        return [];
      }
    });

    const results = await Promise.all(scanPromises);
    results.forEach((devices) => discoveredDevices.push(...devices));

    return discoveredDevices;
  }

  // =============================================
  // 能力和配置
  // =============================================

  static getSupportedBrands(): PrinterBrand[] {
    return Object.keys(PRINTER_BRANDS) as PrinterBrand[];
  }

  static getDefaultCapabilities(brand: PrinterBrand): PrinterCapabilities {
    const baseCapabilities: PrinterCapabilities = {
      maxWidth: 32,
      supportsGraphics: true,
      supportsCutter: true,
      supportsDrawer: true,
      supportsQRCode: true,
      supportsBarcode: true,
      supportedEncodings: ["utf8", "ascii"],
      paperSizes: [
        { width: 58, height: 0, name: "58mm" },
        { width: 80, height: 0, name: "80mm" },
      ],
    };

    const brandConfig = PRINTER_BRANDS[brand];
    if (brandConfig) {
      return {
        ...baseCapabilities,
        ...brandConfig.defaultCapabilities,
      };
    }

    return baseCapabilities;
  }

  async validateDevice(device: PrinterDevice): Promise<{
    valid: boolean;
    capabilities?: PrinterCapabilities;
    error?: string;
  }> {
    try {
      const driver = await PrinterDriverFactory.createDriverForDevice(device);

      const connected = await driver.connect();
      if (!connected) {
        return {
          valid: false,
          error: "Failed to connect to device",
        };
      }

      // 查詢實際能力
      const capabilities = await this.queryDeviceCapabilities(driver);

      await driver.disconnect();

      return {
        valid: true,
        capabilities,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =============================================
  // 內部方法
  // =============================================

  private static formatAddress(
    connectionType: PrinterConnection,
    params: PrinterConnectionParams,
  ): string {
    switch (connectionType) {
      case "network":
        return params.host && params.port
          ? `${params.host}:${params.port}`
          : params.address || "";
      case "usb":
      case "serial":
        return params.path || params.address || "";
      case "bluetooth":
        return params.mac || params.address || "";
      default:
        return params.address || "";
    }
  }

  private formatConnectionAddress(
    connectionInfo: PrinterConnectionParams,
  ): string {
    if (connectionInfo.address) return connectionInfo.address;
    if (connectionInfo.host && connectionInfo.port) {
      return `${connectionInfo.host}:${connectionInfo.port}`;
    }
    if (connectionInfo.path) return connectionInfo.path;
    return "";
  }

  private async queryDeviceInfo(
    connectionInfo: PrinterConnectionParams,
  ): Promise<string | null> {
    if (connectionInfo.type !== "network") return null;

    const address = this.formatConnectionAddress(connectionInfo);
    const { host, port } = parseNetworkPrinterAddress(address);

    // GS I n is the ESC/POS printer-ID query. Its response is optional across
    // vendors, so a successful TCP connection with no answer is still a
    // discoverable *generic* ESC/POS printer. We never infer a brand from a
    // host name: only bytes returned by the device may identify it.
    return await new Promise<string | null>((resolve) => {
      const socket = createConnection({ host, port });
      const response: Buffer[] = [];
      let settled = false;
      let connected = false;
      const timeoutMs = Math.min(this.config.connectionTimeout, 250);

      const finish = (deviceInfo: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(deviceInfo);
      };
      const timeout = setTimeout(() => {
        // A silent but connected printer can still be a generic ESC/POS
        // device. A connection that never completed is a blackhole, not a
        // discovered printer — treating it as generic produced phantom devices
        // for every unresponsive address in a subnet scan.
        finish(deviceInfoFromProbe(connected, response));
      }, timeoutMs);

      socket.once("error", () => finish(null));
      socket.on("data", (chunk: Buffer) => response.push(chunk));
      socket.once("connect", () => {
        connected = true;
        socket.write(Buffer.from([0x1d, 0x49, 0x01]));
      });
    });
  }

  private identifyBrand(deviceInfo: string): PrinterBrand {
    const info = deviceInfo.toLowerCase();

    for (const [brand, detector] of this.brandDetectors) {
      if (detector(info)) {
        return brand;
      }
    }

    return "generic"; // 預設為通用 ESC/POS
  }

  private identifyModel(deviceInfo: string, brand: PrinterBrand): string {
    const brandConfig = PRINTER_BRANDS[brand];
    if (brandConfig?.models) {
      for (const model of brandConfig.models) {
        if (deviceInfo.toLowerCase().includes(model.toLowerCase())) {
          return model;
        }
      }
    }

    // 如果沒有找到特定型號，返回通用型號
    return brandConfig?.defaultModel || "Generic";
  }

  private generateDeviceId(
    connectionInfo: PrinterConnectionParams,
    model: string,
  ): string {
    const prefix = (connectionInfo.type ?? "dev").toUpperCase();
    const address = this.formatConnectionAddress(connectionInfo).replace(
      /[^a-zA-Z0-9]/g,
      "_",
    );
    const modelSafe = model.replace(/[^a-zA-Z0-9]/g, "_");
    const timestamp = Date.now().toString(36);
    return `${prefix}_${modelSafe}_${address}_${timestamp}`;
  }

  private async scanConnectionType(
    connectionType: PrinterConnection,
    options?: PrinterScanOptions,
  ): Promise<PrinterDevice[]> {
    switch (connectionType) {
      case "usb":
        return this.scanUSBPrinters();
      case "network":
        return this.scanNetworkPrinters(options?.networkRanges);
      case "serial":
        return this.scanSerialPrinters(options?.serialPorts);
      default:
        return [];
    }
  }

  private async scanUSBPrinters(): Promise<PrinterDevice[]> {
    return [];
  }

  private async scanNetworkPrinters(
    ranges?: string[],
  ): Promise<PrinterDevice[]> {
    const defaultRanges = ["192.168.1.", "192.168.0.", "10.0.0."];
    const networkRanges = ranges || defaultRanges;
    const devices: PrinterDevice[] = [];

    // 簡化的網路掃描
    for (const range of networkRanges) {
      for (let i = 100; i <= 110; i++) {
        const host = range + i;
        const port = 9100; // 標準打印機埠

        try {
          const device = await this.detectPrinter({
            type: "network",
            host,
            port,
          });

          if (device) {
            devices.push(device);
          }
        } catch {
          // 忽略連接失敗的 IP
        }
      }
    }

    return devices;
  }

  private async scanSerialPrinters(ports?: string[]): Promise<PrinterDevice[]> {
    const defaultPorts = ["/dev/ttyUSB0", "/dev/ttyUSB1", "COM1", "COM2"];
    const serialPorts = ports || defaultPorts;
    const devices: PrinterDevice[] = [];

    for (const port of serialPorts) {
      try {
        const device = await this.detectPrinter({
          type: "serial",
          path: port,
        });

        if (device) {
          devices.push(device);
        }
      } catch {
        // 忽略無效的序列埠
      }
    }

    return devices;
  }

  private async queryDeviceCapabilities(
    driver: PrinterDriver,
  ): Promise<PrinterCapabilities> {
    // 實際查詢打印機能力
    try {
      const status = await driver.getStatus();
      if (status === "online") {
        // 可以進行更詳細的能力查詢
        return driver.getDeviceInfo().capabilities;
      }
    } catch (error) {
      console.warn("Failed to query device capabilities:", error);
    }

    return driver.getDeviceInfo().capabilities;
  }

  private initializeBrandDetectors(): void {
    this.brandDetectors.set("epson", (deviceInfo: string) => {
      return deviceInfo.includes("epson") || deviceInfo.includes("tm-");
    });

    this.brandDetectors.set("star", (deviceInfo: string) => {
      return deviceInfo.includes("star") || deviceInfo.includes("tsp");
    });

    this.brandDetectors.set("citizen", (deviceInfo: string) => {
      return deviceInfo.includes("citizen") || deviceInfo.includes("ct-");
    });
  }

  /**
   * Map a model name onto the emulation StarDriver actually accepts.
   *
   * This used to return Star's marketing names ("StarPRNT", "StarLine",
   * "StarGraphic"), none of which are values the driver understands. The
   * driver only ever compares against "esc-pos", so no branch changes
   * behaviour here — the values are simply legal now.
   */
  private static determineStarEmulation(
    model: string,
  ): NonNullable<StarDriverOptions["emulation"]> {
    const modelLower = model.toLowerCase();

    if (modelLower.includes("graphic") || modelLower.includes("line")) {
      return "star-line";
    }
    return "star-prnt";
  }
}
