/**
 * Star Printer Driver
 * Driver implementation for Star Micronics thermal printers
 */

import type {
  PrintContent,
  PrintResponse,
  PrinterDevice,
  PrinterStatus,
} from "@makanmasak/shared-types";
import { CommandBuilder } from "../commands/CommandBuilder";
import { formatCurrencyAmount } from "../utils/money";
import { PrinterDriver } from "./PrinterDriver";
import type { PrinterDriverExecutionOptions } from "./PrinterDriver";

export interface StarDriverOptions extends PrinterDriverExecutionOptions {
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "even" | "odd";
  encoding?: string;
  emulation?: "star-line" | "star-prnt" | "esc-pos";
}

export class StarDriver extends PrinterDriver {
  private options: StarDriverOptions;

  constructor(device: PrinterDevice, options: StarDriverOptions = {}) {
    super(device, options);
    this.options = {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      encoding: "utf8",
      emulation: "star-prnt",
      ...options,
    };
  }

  async connect(): Promise<boolean> {
    try {
      return await this.executeConnection(async () => {
        await this.connectTransport();
        await this.initializeStarPrinter();
        return true;
      });
    } catch {
      this.markTransportOffline();
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.connected) {
        await this.sendStarCommands("\x1B\x08"); // Clear buffer
      }
    } finally {
      await this.disconnectTransport();
    }
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
          message: "Star printer is not connected",
        },
      };
    }

    try {
      // Build commands using Star's command set
      const commands = await this.buildStarCommands(content);

      // Send commands to Star printer
      await this.executeCommand(() => this.sendStarCommands(commands));

      return {
        success: true,
        jobId: `star_${Date.now()}`,
        message: "Star print job completed successfully",
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "STAR_PRINT_FAILED",
          message:
            error instanceof Error ? error.message : "Star print job failed",
        },
      };
    }
  }

  private async initializeStarPrinter(): Promise<void> {
    // Star-specific initialization sequence
    const initCommands = [
      "\x1B@", // Initialize
      "\x1B\x1E", // Select character code table
      "\x1Bt\x00", // Select character set
    ].join("");

    await this.sendStarCommands(initCommands);
  }

  private async buildStarCommands(content: PrintContent): Promise<string> {
    // Star printers can use ESC/POS or their proprietary commands
    if (this.options.emulation === "esc-pos") {
      // Use standard ESC/POS commands
      const commandBuilder = CommandBuilder.fromPrintContent(content);
      return commandBuilder.buildESCPOS();
    } else {
      // Use Star-specific commands
      return this.buildStarSpecificCommands(content);
    }
  }

  private buildStarSpecificCommands(content: PrintContent): string {
    const commands: string[] = [];
    const money = (amount: number) =>
      formatCurrencyAmount(amount, content.summary.currency);

    // Add restaurant header with Star commands
    if (content.header?.restaurantInfo?.name) {
      commands.push(`\x1B\x69\x01\x01${content.header.restaurantInfo.name}\n`); // Double size
    }

    if (content.header?.restaurantInfo?.address) {
      commands.push(`${content.header.restaurantInfo.address}\n`);
    }

    commands.push("\n");

    // Add transaction info
    if (content.header?.transactionInfo) {
      commands.push(`Order: ${content.header.transactionInfo.orderId}\n`);
      commands.push(`Cashier: ${content.header.transactionInfo.cashier}\n`);
      commands.push(
        `Time: ${content.header.transactionInfo.timestamp.toLocaleString()}\n`,
      );
    }

    commands.push("\n");

    // Add items
    for (const item of content.items) {
      commands.push(`${item.quantity}x ${item.name}\n`);
      commands.push(`  ${money(item.totalPrice)}\n`);
    }

    commands.push("\n");

    // Add summary
    commands.push(`Subtotal: ${money(content.summary.subtotal)}\n`);
    for (const tax of content.summary.tax) {
      commands.push(`${tax.name}: ${money(tax.amount)}\n`);
    }
    commands.push(`\x1B\x45Total: ${money(content.summary.total)}\x1B\x46\n`); // Bold

    // 現金進位調整（#405）：為 0 或未帶時不印。
    const roundingAdjustment = content.summary.roundingAdjustment ?? 0;
    if (roundingAdjustment !== 0) {
      const sign = roundingAdjustment > 0 ? "+" : "-";
      commands.push(
        `Rounding Adj: ${sign}${money(Math.abs(roundingAdjustment))}\n`,
      );
      commands.push(
        `\x1B\x45Amount Due: ${money(
          content.summary.amountDue ??
            content.summary.total + roundingAdjustment,
        )}\x1B\x46\n`,
      ); // Bold
    }

    commands.push("\n");

    // Add footer
    if (content.footer?.thankYouMessage) {
      commands.push(
        `\x1B\x61\x01${content.footer.thankYouMessage}\x1B\x61\x00\n`,
      ); // Center align
    }

    // Cut paper
    commands.push("\x1B\x64\x03"); // Feed and cut

    return commands.join("");
  }

  protected async sendStarCommands(commands: string): Promise<void> {
    await this.sendTransport(Buffer.from(commands, "utf8"));
  }

  /**
   * Star-specific melody play (if supported)
   */
  async playMelody(melodyNumber: number = 1): Promise<boolean> {
    if (!this.connected) return false;

    try {
      // Send Star melody command
      await this.sendStarCommands(
        `\x1B\x42\x0A${String.fromCharCode(melodyNumber)}`,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Star-specific logo printing
   */
  async printLogo(logoNumber: number = 1): Promise<boolean> {
    if (!this.connected) return false;

    try {
      // Send Star logo print command
      await this.sendStarCommands(
        `\x1B\x1C\x70${String.fromCharCode(logoNumber)}\x00`,
      );
      return true;
    } catch {
      return false;
    }
  }
}
