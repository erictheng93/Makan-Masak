/**
 * Print Command Builder
 * High-level interface for building printer commands
 */

import { ESCPOSCommands } from "./ESCPOSCommands";
import type { PrintContent } from "@makanmasak/shared-types";
import { formatCurrencyAmount } from "../utils/money";

/**
 * One queued command, discriminated on `type`.
 *
 * `data` and `options` used to be `any`, which meant buildESCPOS could read a
 * field the builder never wrote and only fail on the printer. Each variant now
 * states exactly what its producer pushes.
 */
export type PrintCommand =
  | {
      type: "text";
      data: string;
      options?: {
        bold?: boolean;
        underline?: boolean;
        alignment?: "left" | "center" | "right";
        size?: { width: number; height: number };
      };
    }
  | {
      type: "image";
      data: string;
      options?: {
        width?: number;
        height?: number;
        alignment?: "left" | "center" | "right";
      };
    }
  | {
      type: "barcode";
      data: string;
      options: { type: "CODE128" | "CODE39" | "EAN13" | "EAN8" };
    }
  | { type: "qr"; data: string; options: { size: number } }
  | { type: "cut"; data: null; options: { full: boolean } }
  | { type: "feed"; data: number; options: null }
  | { type: "raw"; data: string; options: null };

export class CommandBuilder {
  private commands: PrintCommand[] = [];

  /**
   * Add text command
   */
  addText(
    text: string,
    options?: {
      bold?: boolean;
      underline?: boolean;
      alignment?: "left" | "center" | "right";
      size?: { width: number; height: number };
    },
  ): CommandBuilder {
    this.commands.push({
      type: "text",
      data: text,
      options,
    });
    return this;
  }

  /**
   * Add image command
   */
  addImage(
    imageData: string,
    options?: {
      width?: number;
      height?: number;
      alignment?: "left" | "center" | "right";
    },
  ): CommandBuilder {
    this.commands.push({
      type: "image",
      data: imageData,
      options,
    });
    return this;
  }

  /**
   * Add barcode command
   */
  addBarcode(
    data: string,
    type: "CODE128" | "CODE39" | "EAN13" | "EAN8" = "CODE128",
  ): CommandBuilder {
    this.commands.push({
      type: "barcode",
      data,
      options: { type },
    });
    return this;
  }

  /**
   * Add QR code command
   */
  addQRCode(data: string, size: number = 3): CommandBuilder {
    this.commands.push({
      type: "qr",
      data,
      options: { size },
    });
    return this;
  }

  /**
   * Add paper cut command
   */
  addCut(full: boolean = true): CommandBuilder {
    this.commands.push({
      type: "cut",
      data: null,
      options: { full },
    });
    return this;
  }

  /**
   * Add paper feed command
   */
  addFeed(lines: number): CommandBuilder {
    this.commands.push({
      type: "feed",
      data: lines,
      options: null,
    });
    return this;
  }

  /**
   * Add raw ESC/POS command string
   */
  addRaw(commands: string): CommandBuilder {
    this.commands.push({
      type: "raw",
      data: commands,
      options: null,
    });
    return this;
  }

  /**
   * Build ESC/POS command string
   */
  buildESCPOS(): string {
    const commands: string[] = [ESCPOSCommands.initialize()];

    for (const command of this.commands) {
      switch (command.type) {
        case "text":
          if (command.options?.alignment) {
            commands.push(
              ESCPOSCommands.setAlignment(command.options.alignment),
            );
          }
          if (command.options?.bold) {
            commands.push(ESCPOSCommands.setBold(true));
          }
          if (command.options?.underline) {
            commands.push(ESCPOSCommands.setUnderline(true));
          }
          if (command.options?.size) {
            commands.push(
              ESCPOSCommands.setTextSize(
                command.options.size.width,
                command.options.size.height,
              ),
            );
          }

          commands.push(ESCPOSCommands.printLine(command.data));

          // Reset formatting
          if (command.options?.bold) {
            commands.push(ESCPOSCommands.setBold(false));
          }
          if (command.options?.underline) {
            commands.push(ESCPOSCommands.setUnderline(false));
          }
          if (command.options?.size) {
            commands.push(ESCPOSCommands.setTextSize(1, 1));
          }
          break;

        case "barcode":
          commands.push(
            ESCPOSCommands.printBarcode(command.data, command.options?.type),
          );
          break;

        case "qr":
          commands.push(
            ESCPOSCommands.printQRCode(command.data, command.options?.size),
          );
          break;

        case "cut":
          commands.push(ESCPOSCommands.cutPaper(command.options?.full));
          break;

        case "feed":
          commands.push(ESCPOSCommands.feedPaper(command.data));
          break;

        case "raw":
          commands.push(command.data);
          break;
      }
    }

    return ESCPOSCommands.buildSequence(commands);
  }

  /**
   * Build from print content
   */
  static fromPrintContent(content: PrintContent): CommandBuilder {
    const builder = new CommandBuilder();
    const width = 32;
    // Every amount in the content is in summary.currency: "NT$350",
    // "RM 12.50", "350.000 ₫" — not a symbol-less "350.00" for every shop.
    const money = (amount: number) =>
      formatCurrencyAmount(amount, content.summary.currency);

    const header = content.header;
    const restaurant = header.restaurantInfo;
    const transaction = header.transactionInfo;

    if (header.logo?.type === "text") {
      builder.addRaw(ESCPOSCommands.printTitle(header.logo.data));
    }

    builder.addRaw(ESCPOSCommands.setAlignment("center"));
    builder.addRaw(ESCPOSCommands.setBold(true));
    builder.addRaw(ESCPOSCommands.textLine(restaurant.name));

    if (restaurant.nameLocal) {
      builder.addRaw(ESCPOSCommands.textLine(restaurant.nameLocal));
    }

    builder.addRaw(ESCPOSCommands.setBold(false));
    builder.addRaw(ESCPOSCommands.textLine(restaurant.address));

    if (restaurant.addressLocal) {
      builder.addRaw(ESCPOSCommands.textLine(restaurant.addressLocal));
    }

    builder.addRaw(ESCPOSCommands.textLine(`Tel: ${restaurant.phone}`));

    if (restaurant.taxNumber) {
      builder.addRaw(
        ESCPOSCommands.textLine(`Tax No: ${restaurant.taxNumber}`),
      );
    }

    if (restaurant.licenseNumber) {
      builder.addRaw(
        ESCPOSCommands.textLine(`License: ${restaurant.licenseNumber}`),
      );
    }

    builder.addRaw(ESCPOSCommands.setAlignment("left"));
    builder.addRaw(ESCPOSCommands.lineFeed());
    builder.addRaw(ESCPOSCommands.separator("=", width));
    builder.addRaw(
      ESCPOSCommands.textColumns(
        "Receipt No:",
        transaction.receiptNumber,
        width,
      ),
    );
    builder.addRaw(
      ESCPOSCommands.textColumns("Order ID:", transaction.orderId, width),
    );

    if (transaction.tableNumber) {
      builder.addRaw(
        ESCPOSCommands.textColumns("Table:", transaction.tableNumber, width),
      );
    }

    if (transaction.customerName) {
      builder.addRaw(
        ESCPOSCommands.textColumns(
          "Customer:",
          transaction.customerName,
          width,
        ),
      );
    }

    // 地址不用 textColumns：那是把標籤靠左、值靠右撐開的定寬排版，一條住址
    // 撐爆寬度後 spacesNeeded 歸零，標籤會直接黏在地址前面，再由印表機在
    // 任意字元處硬折。標籤與地址各自一行，送餐的人才讀得完整（#295）。
    if (transaction.deliveryAddress) {
      builder.addRaw(ESCPOSCommands.textLine("Delivery:"));
      builder.addRaw(ESCPOSCommands.textLine(transaction.deliveryAddress));
    }

    // 標籤不是 "Tel:"：店家自己的電話在表頭已經用掉這個字了，同一張紙上兩個
    // "Tel:" 對送餐的人是在問「該打哪一支」。
    if (transaction.deliveryPhone) {
      builder.addRaw(
        ESCPOSCommands.textColumns(
          "Delivery Tel:",
          transaction.deliveryPhone,
          width,
        ),
      );
    }

    builder.addRaw(
      ESCPOSCommands.textColumns("Cashier:", transaction.cashier, width),
    );
    builder.addRaw(
      ESCPOSCommands.textLine(transaction.timestamp.toLocaleString()),
    );
    builder.addRaw(ESCPOSCommands.separator("=", width));

    for (const item of content.items) {
      builder.addRaw(
        ESCPOSCommands.textColumns(
          `${item.name} x${item.quantity}`,
          money(item.totalPrice),
          width,
        ),
      );

      if (item.modifiers && item.modifiers.length > 0) {
        for (const modifier of item.modifiers) {
          builder.addRaw(
            ESCPOSCommands.textColumns(
              `  + ${modifier.name}`,
              modifier.price > 0 ? money(modifier.price) : "",
              width,
            ),
          );
        }
      }
    }

    builder.addRaw(ESCPOSCommands.separator("-", width));
    builder.addRaw(
      ESCPOSCommands.textColumns(
        "Subtotal:",
        money(content.summary.subtotal),
        width,
      ),
    );

    for (const tax of content.summary.tax) {
      builder.addRaw(
        ESCPOSCommands.textColumns(`${tax.name}:`, money(tax.amount), width),
      );
    }

    if (content.summary.serviceCharge) {
      builder.addRaw(
        ESCPOSCommands.textColumns(
          `${content.summary.serviceCharge.name}:`,
          money(content.summary.serviceCharge.amount),
          width,
        ),
      );
    }

    // 外送費計入 total（#295），所以它必須在 TOTAL 之前自成一行，否則小計加稅
    // 對不上總額，那筆差額在紙上沒有出處（#348）。
    if (content.summary.deliveryFee && content.summary.deliveryFee > 0) {
      builder.addRaw(
        ESCPOSCommands.textColumns(
          "Delivery Fee:",
          money(content.summary.deliveryFee),
          width,
        ),
      );
    }

    if (content.summary.tip && content.summary.tip > 0) {
      builder.addRaw(
        ESCPOSCommands.textColumns("Tip:", money(content.summary.tip), width),
      );
    }

    if (content.summary.discount && content.summary.discount.amount > 0) {
      builder.addRaw(
        ESCPOSCommands.textColumns(
          `${content.summary.discount.name}:`,
          `-${money(content.summary.discount.amount)}`,
          width,
        ),
      );
    }

    builder.addRaw(ESCPOSCommands.separator("-", width));
    builder.addRaw(
      ESCPOSCommands.printTotal("TOTAL:", money(content.summary.total), width),
    );

    // 現金進位調整（#405）。馬幣現金實收到最接近的 5 sen，總額與實收之間那
    // 最多 2 sen 必須在紙上有出處，否則客人看到的總額跟他付的錢對不起來。
    // 為 0（或未帶）時完全不印，其他幣別與電子支付的收據因此完全不變。
    const roundingAdjustment = content.summary.roundingAdjustment ?? 0;
    if (roundingAdjustment !== 0) {
      builder.addRaw(
        ESCPOSCommands.textColumns(
          "Rounding Adj:",
          `${roundingAdjustment > 0 ? "+" : "-"}${money(Math.abs(roundingAdjustment))}`,
          width,
        ),
      );
      builder.addRaw(
        ESCPOSCommands.printTotal(
          "AMOUNT DUE:",
          money(
            content.summary.amountDue ??
              content.summary.total + roundingAdjustment,
          ),
          width,
        ),
      );
    }

    builder.addRaw(ESCPOSCommands.lineFeed());

    for (const payment of content.summary.payment) {
      builder.addRaw(
        ESCPOSCommands.textColumns(
          `${payment.method}:`,
          money(payment.amount),
          width,
        ),
      );

      if (payment.details) {
        builder.addRaw(ESCPOSCommands.textLine(`  ${payment.details}`));
      }
    }

    if (content.summary.change && content.summary.change > 0) {
      builder.addRaw(
        ESCPOSCommands.textColumns(
          "Change:",
          money(content.summary.change),
          width,
        ),
      );
    }

    builder.addRaw(ESCPOSCommands.separator("=", width));
    builder.addRaw(ESCPOSCommands.setAlignment("center"));
    builder.addRaw(ESCPOSCommands.lineFeed());
    builder.addRaw(ESCPOSCommands.textLine(content.footer.thankYouMessage));

    if (content.footer.thankYouMessageLocal) {
      builder.addRaw(
        ESCPOSCommands.textLine(content.footer.thankYouMessageLocal),
      );
    }

    if (content.footer.qrCode) {
      const qrSize =
        content.footer.qrCode.size === "small"
          ? 3
          : content.footer.qrCode.size === "large"
            ? 6
            : 4;
      builder.addRaw(ESCPOSCommands.lineFeed());
      builder.addRaw(ESCPOSCommands.qrCode(content.footer.qrCode.data, qrSize));

      if (content.footer.qrCode.label) {
        builder.addRaw(ESCPOSCommands.textLine(content.footer.qrCode.label));
      }
    }

    if (content.footer.barcode) {
      builder.addRaw(ESCPOSCommands.lineFeed());
      builder.addRaw(
        ESCPOSCommands.printBarcode(
          content.footer.barcode.data,
          content.footer.barcode.format,
        ),
      );

      if (content.footer.barcode.label) {
        builder.addRaw(ESCPOSCommands.textLine(content.footer.barcode.label));
      }
    }

    if (content.footer.promotionalMessage) {
      builder.addRaw(ESCPOSCommands.lineFeed());
      builder.addRaw(
        ESCPOSCommands.textLine(content.footer.promotionalMessage),
      );
    }

    if (content.footer.contactInfo) {
      builder.addRaw(ESCPOSCommands.lineFeed());

      if (content.footer.contactInfo.supportPhone) {
        builder.addRaw(
          ESCPOSCommands.textLine(
            `Support: ${content.footer.contactInfo.supportPhone}`,
          ),
        );
      }

      if (content.footer.contactInfo.supportEmail) {
        builder.addRaw(
          ESCPOSCommands.textLine(content.footer.contactInfo.supportEmail),
        );
      }

      if (content.footer.contactInfo.website) {
        builder.addRaw(
          ESCPOSCommands.textLine(content.footer.contactInfo.website),
        );
      }
    }

    if (content.footer.legalNotice) {
      builder.addRaw(ESCPOSCommands.lineFeed());
      builder.addRaw(ESCPOSCommands.textLine(content.footer.legalNotice));
    }

    builder.addRaw(ESCPOSCommands.setAlignment("left"));
    builder.addRaw(ESCPOSCommands.lineFeed(3));
    builder.addRaw(ESCPOSCommands.cutPaper());

    return builder;
  }

  /**
   * Clear all commands
   */
  clear(): CommandBuilder {
    this.commands = [];
    return this;
  }

  /**
   * Get command count
   */
  getCommandCount(): number {
    return this.commands.length;
  }
}
