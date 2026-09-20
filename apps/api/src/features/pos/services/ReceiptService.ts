/**
 * 收據管理服務
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc, ne, sql, type SQL } from "drizzle-orm";
import {
  BusinessTimezoneResolver,
  amountFromCents,
  businessNumber,
  dateFromUnixMs,
  receipts,
  orders,
  orderItems,
  paymentTransactions,
  tables,
} from "@makanmasak/database";

type OrderRow = typeof orders.$inferSelect;
type ReceiptRow = typeof receipts.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
import type { Receipt, PrintReceiptRequest } from "../types";
import { printReceiptSchema } from "../schemas";
import { generateUUID } from "@makanmasak/utils";

export class ReceiptService {
  private db;
  private businessTimezone;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
    this.businessTimezone = new BusinessTimezoneResolver(this.db);
  }

  /**
   * Map a receipts row to the Receipt domain type: parse the JSON content
   * column and normalise nullable columns to optional (null -> undefined).
   */
  private mapReceipt(receipt: ReceiptRow): Receipt {
    return {
      id: receipt.id,
      orderId: receipt.orderId,
      registerId: receipt.registerId,
      shiftId: receipt.shiftId ?? undefined,
      receiptNumber: receipt.receiptNumber,
      receiptType: receipt.receiptType as Receipt["receiptType"],
      templateName: receipt.templateName,
      content: JSON.parse(receipt.content || "{}"),
      rawContent: receipt.rawContent ?? undefined,
      printStatus: receipt.printStatus as Receipt["printStatus"],
      printAttempts: receipt.printAttempts,
      printerName: receipt.printerName ?? undefined,
      printerResponse: receipt.printerResponse ?? undefined,
      printedAt: receipt.printedAt ?? undefined,
      reprintedCount: receipt.reprintedCount,
      lastReprintAt: receipt.lastReprintAt ?? undefined,
      createdAt: receipt.createdAt,
    };
  }

  /**
   * 打印收據
   */
  async printReceipt(
    data: PrintReceiptRequest,
    registerId: string,
    shiftId?: string,
  ): Promise<{ success: boolean; data?: Receipt; error?: string }> {
    try {
      const validatedData = printReceiptSchema.parse(data);

      // 檢查訂單是否存在
      const [order] = await this.db
        .select()
        .from(orders)
        .where(eq(orders.id, validatedData.orderId))
        .limit(1);

      if (!order) {
        return {
          success: false,
          error: "訂單不存在",
        };
      }

      const receiptId = generateUUID();
      const receiptNumber = businessNumber("R");

      // 生成收據內容
      const receiptContent = await this.generateReceiptContent(
        order,
        validatedData.templateName,
      );

      const now = new Date();
      await this.db.insert(receipts).values({
        id: receiptId,
        orderId: validatedData.orderId,
        registerId,
        shiftId: shiftId || null,
        receiptNumber,
        receiptType: validatedData.receiptType,
        templateName: validatedData.templateName,
        content: JSON.stringify(receiptContent),
        printStatus: "pending",
        printAttempts: 0,
        reprintedCount: 0,
        createdAt: now,
      });

      const [receipt] = await this.db
        .select()
        .from(receipts)
        .where(eq(receipts.id, receiptId))
        .limit(1);

      return {
        success: true,
        data: this.mapReceipt(receipt),
      };
    } catch (error) {
      console.error("打印收據失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "打印收據失敗",
      };
    }
  }

  /**
   * 訂單確認時自動產生廚房出單票。
   *
   * `registerId` 是 null：這張票不屬於任何收銀機，因此只會被沒有綁收銀機的
   * 全店代理（廚房出單機）認領。顧客端送出的訂單本來就沒有收銀台可掛。
   *
   * 冪等：同一張訂單已經有一張未取消的廚房票就不再開。狀態機雖然擋掉了
   * confirmed → confirmed，但外送平台那條路徑是直接寫狀態的，重放不該變成
   * 兩張出單票。
   */
  async createKitchenTicket(
    orderId: string,
  ): Promise<{ success: boolean; data?: Receipt; error?: string }> {
    try {
      const [existing] = await this.db
        .select({ id: receipts.id })
        .from(receipts)
        .where(
          and(
            eq(receipts.orderId, orderId),
            eq(receipts.receiptType, "kitchen"),
            ne(receipts.printStatus, "cancelled"),
          ),
        )
        .limit(1);

      if (existing) {
        return { success: true };
      }

      const [order] = await this.db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        return { success: false, error: "訂單不存在" };
      }

      const receiptId = generateUUID();
      const now = new Date();

      await this.db.insert(receipts).values({
        id: receiptId,
        orderId,
        registerId: null,
        shiftId: null,
        receiptNumber: businessNumber("K"),
        receiptType: "kitchen",
        templateName: "kitchen",
        content: JSON.stringify(
          await this.generateReceiptContent(order, "kitchen"),
        ),
        printStatus: "pending",
        printAttempts: 0,
        reprintedCount: 0,
        createdAt: now,
      });

      const [receipt] = await this.db
        .select()
        .from(receipts)
        .where(eq(receipts.id, receiptId))
        .limit(1);

      return { success: true, data: this.mapReceipt(receipt) };
    } catch (error) {
      console.error("產生廚房出單票失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "產生廚房出單票失敗",
      };
    }
  }

  /**
   * 重打收據
   */
  async reprintReceipt(
    receiptId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 檢查收據是否存在
      const [receipt] = await this.db
        .select()
        .from(receipts)
        .where(eq(receipts.id, receiptId))
        .limit(1);

      if (!receipt) {
        return {
          success: false,
          error: "收據不存在",
        };
      }

      // 更新重打次數
      const reprintTime = new Date();
      await this.db
        .update(receipts)
        .set({
          reprintedCount: sql`${receipts.reprintedCount} + 1`,
          lastReprintAt: reprintTime,
          printStatus: "pending",
          // A reprint is a fresh delivery, so it starts the attempt budget
          // over. Carrying the old count forward would let a receipt that
          // already exhausted it be abandoned on its first stall.
          printAttempts: 0,
          claimedAt: null,
        })
        .where(eq(receipts.id, receiptId));

      return {
        success: true,
      };
    } catch (error) {
      console.error("重打收據失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "重打收據失敗",
      };
    }
  }

  /**
   * 獲取收據列表
   */
  async getReceipts(
    registerId: string,
    options?: {
      startDate?: string;
      endDate?: string;
      receiptType?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{
    success: boolean;
    data?: {
      receipts: Receipt[];
      pagination: { page: number; limit: number; hasMore: boolean };
    };
    error?: string;
  }> {
    try {
      const {
        startDate,
        endDate,
        receiptType,
        page = 1,
        limit = 20,
      } = options || {};
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [eq(receipts.registerId, registerId)];

      // Calendar-day bounds are the operator's days, so they are cut at the
      // register's own midnight rather than a fixed +8 (#329).
      const offsetMinutes =
        await this.businessTimezone.offsetMinutesForCashRegister(registerId);

      if (startDate) {
        conditions.push(
          sql`${dateFromUnixMs(receipts.createdAt, offsetMinutes)} >= ${startDate}`,
        );
      }

      if (endDate) {
        conditions.push(
          sql`${dateFromUnixMs(receipts.createdAt, offsetMinutes)} <= ${endDate}`,
        );
      }

      if (receiptType) {
        conditions.push(eq(receipts.receiptType, receiptType));
      }

      const receiptList = await this.db
        .select()
        .from(receipts)
        .where(and(...conditions))
        .orderBy(desc(receipts.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        success: true,
        data: {
          receipts: receiptList.map((receipt) => this.mapReceipt(receipt)),
          pagination: {
            page,
            limit,
            hasMore: receiptList.length === limit,
          },
        },
      };
    } catch (error) {
      console.error("獲取收據列表失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取收據列表失敗",
      };
    }
  }

  /**
   * 獲取收據詳情
   */
  async getReceiptDetail(
    receiptId: string,
  ): Promise<{ success: boolean; data?: Receipt; error?: string }> {
    try {
      const [receipt] = await this.db
        .select()
        .from(receipts)
        .where(eq(receipts.id, receiptId))
        .limit(1);

      if (!receipt) {
        return {
          success: false,
          error: "收據不存在",
        };
      }

      return {
        success: true,
        data: this.mapReceipt(receipt),
      };
    } catch (error) {
      console.error("獲取收據詳情失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取收據詳情失敗",
      };
    }
  }

  /**
   * 生成收據內容
   */
  private async generateReceiptContent(
    order: OrderRow,
    templateName: string,
  ): Promise<Record<string, unknown>> {
    // 獲取訂單項目
    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    // Drizzle returns camelCase keys based on the schema definition; the
    // snake_case fallback chain that used to live here was dead code.
    // Customer display names come from the order's snapshot.
    const customerSnapshot = order.customerInfo ?? null;

    // Keep the location on the receipt snapshot so reprints preserve it.
    // Seat orders also print the table: orders have no persisted seat ID,
    // and seats.currentOrderId is mutable occupancy, not a historical link.
    // Scope the lookup to this restaurant to avoid printing another shop's table.
    let tableNumber: string | null = null;
    if (order.tableId != null) {
      const [location] = await this.db
        .select({ tableNumber: tables.number })
        .from(tables)
        .where(
          and(
            eq(tables.id, order.tableId),
            eq(tables.restaurantId, order.restaurantId),
          ),
        )
        .limit(1);
      tableNumber = location?.tableNumber ?? null;
    }

    // 外送地址只在 KDS 螢幕上看得到，出單票上沒有 —— 對要出門送餐的人來說，
    // 資訊在錯的地方（#295）。非外送單維持 null，格式化層不會印。
    const delivery =
      order.deliveryInfo?.type === "delivery" ? order.deliveryInfo : null;

    // 實收金額與訂單總額不一定相同（#405），收據要印實際收的錢。
    // 還沒結帳的單（出單票）沒有付款紀錄，回退成訂單總額、調整值 0。
    const [payment] = order.paymentTransactionId
      ? await this.db
          .select({
            amountCents: paymentTransactions.amountCents,
            roundingAdjustmentCents:
              paymentTransactions.roundingAdjustmentCents,
          })
          .from(paymentTransactions)
          .where(
            and(
              eq(paymentTransactions.transactionId, order.paymentTransactionId),
              eq(paymentTransactions.restaurantId, order.restaurantId),
            ),
          )
          .limit(1)
      : [];

    return {
      template: templateName,
      orderNumber: order.orderNumber,
      customerName: customerSnapshot?.name ?? null,
      tableNumber,
      deliveryAddress: delivery?.address ?? null,
      deliveryPhone: delivery?.phone ?? null,
      // `delivery_info.deliveryFee` 自 #295 起是伺服器端寫入的權威金額，且已
      // 計入 totalAmount。收據要印得出來，總額才有交代（#348）。
      deliveryFee: delivery?.deliveryFee ?? 0,
      items: items.map((item: OrderItemRow) => ({
        name: item.itemSnapshot?.name ?? null,
        quantity: item.quantity,
        price: amountFromCents(item.unitPriceCents) ?? 0,
        subtotal: amountFromCents(item.totalPriceCents) ?? 0,
        customizations:
          typeof item.customizations === "string"
            ? JSON.parse(item.customizations || "[]")
            : (item.customizations ?? []),
      })),
      subtotal: amountFromCents(order.subtotalCents) ?? 0,
      taxAmount: amountFromCents(order.taxAmountCents) ?? 0,
      discountAmount: amountFromCents(order.discountAmountCents) ?? 0,
      totalAmount: amountFromCents(order.totalAmountCents) ?? 0,
      // 現金進位調整（#405）。馬幣現金實收會進位到 5 sen，收據上要看得到
      // 「總額 / 進位調整 / 應付」三行，那筆差額才有出處。其他幣別與電子
      // 支付恆為 0，格式化層看到 0 就完全不印。
      roundingAdjustment:
        amountFromCents(payment?.roundingAdjustmentCents ?? 0) ?? 0,
      amountCollected:
        amountFromCents(payment?.amountCents ?? order.totalAmountCents) ?? 0,
      paymentMethod: order.paymentMethod,
      timestamp: new Date().toISOString(),
      footer: "謝謝光臨 MakanMasak",
    };
  }

  /**
   * Mark the receipt as printed. Runs synchronously (awaited by the caller)
   * rather than on a fire-and-forget timer: the previous setTimeout was a
   * simulation of printer latency, but on Cloudflare Workers a timer scheduled
   * after the response is sent is not guaranteed to run, leaving receipts stuck
   * in "pending". There is no real asynchronous printer callback here, so we
   * settle the terminal state before returning. A write failure is handled
   * here (best-effort "failed") so it never rejects the caller.
   */
  /**
   * 取消收據打印
   */
  async cancelPrint(
    receiptId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.db
        .update(receipts)
        .set({ printStatus: "cancelled" })
        .where(
          and(eq(receipts.id, receiptId), eq(receipts.printStatus, "pending")),
        );

      return { success: true };
    } catch (error) {
      console.error("取消打印失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "取消打印失敗",
      };
    }
  }
}
