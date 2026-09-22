/**
 * Base Printer Driver Interface
 * Defines the standard interface for all printer drivers
 */

import type {
  PrinterDevice,
  PrintContent,
  PrintResponse,
  PrinterStatus,
} from "@makanmasak/shared-types";
import { createConnection, type Socket } from "node:net";

export interface PrinterDriverExecutionOptions {
  connectionTimeout?: number;
  commandTimeout?: number;
  retryAttempts?: number;
}

/** Parse the TCP endpoint stored on a network printer device. */
export function parseNetworkPrinterAddress(address: string): {
  host: string;
  port: number;
} {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new Error("Network printer address is required");
  }

  const bracketedIpv6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed);
  if (bracketedIpv6) {
    const port = Number(bracketedIpv6[2] ?? "9100");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Network printer port must be between 1 and 65535");
    }
    return { host: bracketedIpv6[1], port };
  }

  const colon = trimmed.lastIndexOf(":");
  const hasPort = colon > -1 && trimmed.indexOf(":") === colon;
  const host = hasPort ? trimmed.slice(0, colon) : trimmed;
  const port = Number(hasPort ? trimmed.slice(colon + 1) : "9100");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid network printer address: ${address}`);
  }

  return { host, port };
}

export interface IPrinterDriver {
  /**
   * Connect to the printer
   */
  connect(): Promise<boolean>;

  /**
   * Disconnect from the printer
   */
  disconnect(): Promise<void>;

  /**
   * Check if printer is connected
   */
  isConnected(): boolean;

  /**
   * Get current printer status
   */
  getStatus(): Promise<PrinterStatus>;

  /**
   * Print content to the printer
   */
  print(content: PrintContent): Promise<PrintResponse>;

  /**
   * Get printer device information
   */
  getDeviceInfo(): PrinterDevice;

  /**
   * Test printer connection
   */
  testConnection(): Promise<boolean>;

  /**
   * Reset printer to default state
   */
  reset(): Promise<void>;
}

export abstract class PrinterDriver implements IPrinterDriver {
  protected device: PrinterDevice;
  protected connected = false;
  protected readonly executionOptions: Required<PrinterDriverExecutionOptions>;
  private networkSocket?: Socket;

  constructor(
    device: PrinterDevice,
    options: PrinterDriverExecutionOptions = {},
  ) {
    this.device = device;
    this.executionOptions = {
      connectionTimeout: 10000,
      commandTimeout: 5000,
      retryAttempts: 3,
      ...options,
    };
  }

  protected async executeConnection<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.executeWithRetry(
      operation,
      this.executionOptions.connectionTimeout,
    );
  }

  protected async executeCommand<T>(operation: () => Promise<T>): Promise<T> {
    return this.executeWithRetry(
      operation,
      this.executionOptions.commandTimeout,
    );
  }

  /**
   * Open the printer's real raw-TCP ESC/POS transport. Non-network transports
   * deliberately fail rather than pretending that a USB, serial, or Bluetooth
   * device exists when this Node agent has no implementation for it.
   */
  protected async connectTransport(): Promise<void> {
    if (this.device.connection !== "network") {
      throw new Error(
        `Unsupported printer transport: ${this.device.connection}. Only network TCP is available.`,
      );
    }

    if (
      this.networkSocket &&
      !this.networkSocket.destroyed &&
      this.networkSocket.writable
    ) {
      this.markTransportOnline();
      return;
    }

    const { host, port } = parseNetworkPrinterAddress(this.device.address);
    const socket = createConnection({ host, port });
    this.networkSocket = socket;

    socket.on("error", () => this.markTransportOffline());
    socket.on("close", () => this.markTransportOffline());

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.destroy(
            new Error(
              `Printer connection timed out after ${this.executionOptions.connectionTimeout}ms`,
            ),
          );
        }, this.executionOptions.connectionTimeout);
        const onConnect = () => {
          cleanup();
          resolve();
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          clearTimeout(timeout);
          socket.off("connect", onConnect);
          socket.off("error", onError);
        };

        socket.once("connect", onConnect);
        socket.once("error", onError);
      });
    } catch (error) {
      if (this.networkSocket === socket) this.networkSocket = undefined;
      socket.destroy();
      this.markTransportOffline();
      throw error;
    }

    this.markTransportOnline();
  }

  protected async disconnectTransport(): Promise<void> {
    const socket = this.networkSocket;
    this.networkSocket = undefined;
    this.markTransportOffline();

    if (!socket || socket.destroyed) return;
    socket.destroy();
  }

  /** Write bytes to the connected TCP socket and wait for Node to flush them. */
  protected async sendTransport(data: Uint8Array): Promise<void> {
    const socket = this.networkSocket;
    if (!socket || socket.destroyed || !socket.writable) {
      this.markTransportOffline();
      throw new Error("Network printer is not connected");
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        cleanup();
        this.markTransportOffline();
        reject(error);
      };
      const onWritten = (error?: Error | null) => {
        cleanup();
        if (error) {
          this.markTransportOffline();
          reject(error);
          return;
        }
        this.markTransportOnline();
        resolve();
      };
      const cleanup = () => socket.off("error", onError);

      socket.once("error", onError);
      socket.write(data, onWritten);
    });
  }

  protected transportStatus(): PrinterStatus {
    if (
      this.networkSocket &&
      !this.networkSocket.destroyed &&
      this.networkSocket.writable
    ) {
      this.markTransportOnline();
      return "online";
    }

    this.markTransportOffline();
    return "offline";
  }

  protected markTransportOffline(): void {
    this.connected = false;
    this.device.status = "offline";
  }

  private markTransportOnline(): void {
    this.connected = true;
    this.device.status = "online";
    this.device.lastSeen = new Date();
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    timeout: number,
  ): Promise<T> {
    let lastError: unknown;

    for (
      let attempt = 0;
      attempt <= this.executionOptions.retryAttempts;
      attempt += 1
    ) {
      try {
        return await this.withTimeout(operation(), timeout);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeout: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`Printer operation timed out after ${timeout}ms`),
              ),
            timeout,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract getStatus(): Promise<PrinterStatus>;
  abstract print(content: PrintContent): Promise<PrintResponse>;

  isConnected(): boolean {
    return this.connected;
  }

  getDeviceInfo(): PrinterDevice {
    return { ...this.device };
  }

  async testConnection(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status === "online";
    } catch {
      return false;
    }
  }

  async reset(): Promise<void> {
    if (this.connected) {
      await this.disconnect();
      await this.connect();
    }
  }
}
