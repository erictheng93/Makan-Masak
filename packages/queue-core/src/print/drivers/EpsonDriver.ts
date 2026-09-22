/**
 * Epson Printer Driver
 * Driver implementation for Epson thermal printers
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

export interface EpsonDriverOptions extends PrinterDriverExecutionOptions {
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "even" | "odd";
  encoding?: string;
}

export class EpsonDriver extends PrinterDriver {
  private options: EpsonDriverOptions;

  constructor(device: PrinterDevice, options: EpsonDriverOptions = {}) {
    super(device, options);
    this.options = {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      encoding: "utf8",
      ...options,
    };
  }

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

  async disconnect(): Promise<void> {
    await this.disconnectTransport();
  }

  getOptions(): EpsonDriverOptions {
    return this.options;
  }

  async getStatus(): Promise<PrinterStatus> {
    return this.transportStatus();
  }

  async print(content: PrintContent): Promise<PrintResponse> {
    if (!this.connected) {
      return {
        success: false,
        error: {
          code: "PRINTER_OFFLINE",
          message: "Printer is not connected",
        },
      };
    }

    try {
      // Build ESC/POS commands for the content
      const commandBuilder = CommandBuilder.fromPrintContent(content);
      const commands = commandBuilder.buildESCPOS();

      // Send commands to printer
      await this.executeCommand(() => this.sendCommands(commands));

      return {
        success: true,
        jobId: `epson_${Date.now()}`,
        message: "Print job completed successfully",
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "PRINT_FAILED",
          message: error instanceof Error ? error.message : "Print job failed",
        },
      };
    }
  }

  protected async sendCommands(commands: string): Promise<void> {
    await this.sendTransport(Buffer.from(commands, "utf8"));
  }

  /**
   * Epson-specific calibration
   */
  async calibrate(): Promise<boolean> {
    if (!this.connected) return false;

    try {
      // Send Epson calibration commands
      await this.sendCommands("\x1B@"); // Initialize printer
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Open cash drawer (if connected)
   */
  async openDrawer(): Promise<boolean> {
    if (!this.connected) return false;

    try {
      // Send Epson drawer open command
      await this.sendCommands("\x1Bp\x00\x19\x19");
      return true;
    } catch {
      return false;
    }
  }
}
