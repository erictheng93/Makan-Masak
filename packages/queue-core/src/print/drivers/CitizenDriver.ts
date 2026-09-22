/**
 * Citizen Printer Driver
 * Driver implementation for Citizen thermal printers
 */

import type {
  PrintContent,
  PrintResponse,
  PrinterDevice,
  PrinterStatus,
} from "@makanmasak/shared-types";
import { CommandBuilder } from "../commands/CommandBuilder";
import { PrinterDriver } from "./PrinterDriver";
import type { PrinterDriverExecutionOptions } from "./PrinterDriver";

export interface CitizenPrinterOptions extends PrinterDriverExecutionOptions {
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "even" | "odd";
}

export class CitizenDriver extends PrinterDriver {
  private options: CitizenPrinterOptions;

  constructor(device: PrinterDevice, options: CitizenPrinterOptions = {}) {
    super(device, options);
    this.options = {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      ...options,
    };
  }

  /**
   * Connect to the printer
   */
  async connect(): Promise<boolean> {
    try {
      return await this.executeConnection(async () => {
        await this.connectTransport();
        return true;
      });
    } catch {
      this.markTransportOffline();
      return false;
    }
  }

  /**
   * Disconnect from the printer
   */
  async disconnect(): Promise<void> {
    await this.disconnectTransport();
  }

  /**
   * Get driver options
   */
  getOptions(): CitizenPrinterOptions {
    return this.options;
  }

  /**
   * Get printer status
   */
  async getStatus(): Promise<PrinterStatus> {
    return this.transportStatus();
  }

  /**
   * Print content
   */
  async print(content: PrintContent): Promise<PrintResponse> {
    if (!this.connected) {
      return {
        success: false,
        error: {
          code: "PRINTER_OFFLINE",
          message: "Printer not connected",
        },
      };
    }

    try {
      // Simulate printing logic
      await this.executeCommand(() => this.sendCommands(content));

      return {
        success: true,
        jobId: `citizen_${Date.now()}`,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "PRINT_FAILED",
          message: error instanceof Error ? error.message : "Print failed",
        },
      };
    }
  }

  protected async sendCommands(content: PrintContent): Promise<void> {
    const commands = CommandBuilder.fromPrintContent(content).buildESCPOS();
    await this.sendTransport(Buffer.from(commands, "utf8"));
  }
}
