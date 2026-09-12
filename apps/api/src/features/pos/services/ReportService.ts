/**
 * 報表統計服務
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, and, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  BusinessTimezoneResolver,
  cashShifts,
  cashRegisters,
  cashMovements,
  receipts,
  orders,
  refunds,
  orderItems,
  menuItems,
  shiftReports,
  amountFromCents,
  avgAbsMoneyAmount,
  avgMoneyAmount,
  dateFromUnixMs,
  revenueRecognisedOrder,
  strftimeFromUnixMs,
  sumMoneyAmount,
} from "@makanmasak/database";
import { generateUUID } from "@makanmasak/utils";

export class ReportService {
  private db;
  private businessTimezone;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
    this.businessTimezone = new BusinessTimezoneResolver(this.db);
  }

  /**
   * 生成班次報表
   */
  async generateShiftReport(shiftId: string): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      // 獲取班次基本資訊。班次本身沒有 restaurant_id，餐廳歸屬只能經收銀機
      // (cash_shifts.register_id -> cash_registers.restaurant_id) 取得；下面
      // 的訂單統計一定要用它收斂，否則會把全平台的營收算進來。用 innerJoin：
      // 收銀機查不到就代表這個班次無法歸屬到任何餐廳，寧可當成不存在。
      const [shiftRow] = await this.db
        .select({
          shift: cashShifts,
          restaurantId: cashRegisters.restaurantId,
        })
        .from(cashShifts)
        .innerJoin(cashRegisters, eq(cashShifts.registerId, cashRegisters.id))
        .where(eq(cashShifts.id, shiftId))
        .limit(1);

      if (!shiftRow) {
        return {
          success: false,
          error: "班次不存在",
        };
      }

      const { shift, restaurantId } = shiftRow;

      // 獲取現金流動記錄
      const movements = await this.db
        .select()
        .from(cashMovements)
        .where(eq(cashMovements.shiftId, shiftId))
        .orderBy(cashMovements.createdAt);

      // 獲取收據記錄
      const [receiptStats] = await this.db
        .select({
          totalReceipts: sql<number>`COUNT(*)`,
          printedReceipts: sql<number>`COUNT(CASE WHEN ${receipts.printStatus} = 'printed' THEN 1 END)`,
        })
        .from(receipts)
        .where(eq(receipts.shiftId, shiftId));

      // 獲取訂單統計
      const startedAt = shift.startedAt;
      const endedAt = shift.endedAt || new Date();
      const startAmount = amountFromCents(shift.startAmountCents) ?? 0;
      const endAmount = amountFromCents(shift.endAmountCents) ?? 0;
      const expectedAmount = amountFromCents(shift.expectedAmountCents) ?? 0;
      const actualAmount = amountFromCents(shift.actualAmountCents) ?? 0;
      const differenceAmount =
        amountFromCents(shift.differenceAmountCents) ?? 0;
      const totalRefunds = amountFromCents(shift.totalRefundsCents) ?? 0;
      const cashSales = amountFromCents(shift.cashSalesCents) ?? 0;
      const cardSales = amountFromCents(shift.cardSalesCents) ?? 0;
      const digitalSales = amountFromCents(shift.digitalSalesCents) ?? 0;

      const [orderStats] = await this.db
        .select({
          totalOrders: sql<number>`COUNT(*)`,
          totalSales: sumMoneyAmount(orders.totalAmountCents),
          avgOrderValue: avgMoneyAmount(orders.totalAmountCents),
          cashOrders: sql<number>`COUNT(CASE WHEN ${orders.paymentMethod} = 'cash' THEN 1 END)`,
          cardOrders: sql<number>`COUNT(CASE WHEN ${orders.paymentMethod} = 'card' THEN 1 END)`,
          digitalOrders: sql<number>`COUNT(CASE WHEN ${orders.paymentMethod} = 'digital_wallet' THEN 1 END)`,
        })
        .from(orders)
        .where(
          and(
            // 沒有這條餐廳條件時，這份彙總是整個平台的營收、單量與付款組合。
            eq(orders.restaurantId, restaurantId),
            // created_at_ms 是 timestamp_ms 欄位，交給 gte/lte 由 Drizzle 把
            // Date 轉成整數毫秒。先前手寫 sql`${orders.createdAt} >= ${startedAt}`
            // 會把 Date 物件原封不動綁進去，D1 直接回 D1_TYPE_ERROR。
            gte(orders.createdAt, startedAt),
            lte(orders.createdAt, endedAt),
            // 班次營收同樣只算收到錢的單，否則交班對帳會把沒結帳、
            // 已取消的單當成應收現金 (#354)。
            revenueRecognisedOrder(),
          ),
        );

      // 生成報表數據
      const reportData = {
        shift: {
          ...shift,
          duration: shift.endedAt
            ? Math.floor(
                (new Date(shift.endedAt).getTime() -
                  new Date(shift.startedAt).getTime()) /
                  60000,
              )
            : null,
        },
        summary: {
          startAmount,
          endAmount,
          totalSales: orderStats?.totalSales || 0,
          totalRefunds,
          netSales: (orderStats?.totalSales || 0) - totalRefunds,
          expectedAmount,
          actualAmount,
          difference: differenceAmount,
        },
        breakdown: {
          cashSales,
          cardSales,
          digitalSales,
        },
        orderStats: {
          totalOrders: orderStats?.totalOrders || 0,
          avgOrderValue: orderStats?.avgOrderValue || 0,
          cashOrders: orderStats?.cashOrders || 0,
          cardOrders: orderStats?.cardOrders || 0,
          digitalOrders: orderStats?.digitalOrders || 0,
        },
        movements: movements.map(
          (movement: typeof cashMovements.$inferSelect) => ({
            ...movement,
            amount: amountFromCents(movement.amountCents) ?? 0,
            denominationBreakdown: JSON.parse(
              (movement.denominationBreakdown as string) || "{}",
            ),
            metadata: JSON.parse((movement.metadata as string) || "{}"),
          }),
        ),
        receipts: receiptStats || {
          totalReceipts: 0,
          printedReceipts: 0,
        },
      };

      // 保存報表
      const reportId = generateUUID();
      const generatedAt = new Date();
      await this.db.insert(shiftReports).values({
        id: reportId,
        shiftId,
        registerId: shift.registerId,
        operatorId: shift.operatorId,
        reportData: JSON.stringify(reportData),
        summaryData: JSON.stringify(reportData.summary),
        generatedAt,
      });

      return {
        success: true,
        data: {
          reportId,
          reportData,
        },
      };
    } catch (error) {
      console.error("生成班次報表失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "生成班次報表失敗",
      };
    }
  }

  /**
   * 獲取班次統計
   */
  async getShiftStats(
    restaurantId: string,
    dateRange?: { from: Date; to: Date },
  ): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      const conditions: SQL[] = [eq(cashRegisters.restaurantId, restaurantId)];

      if (dateRange) {
        conditions.push(
          sql`${cashShifts.startedAt} >= ${dateRange.from.toISOString()}`,
        );
        conditions.push(
          sql`${cashShifts.startedAt} <= ${dateRange.to.toISOString()}`,
        );
      }

      const [stats] = await this.db
        .select({
          totalShifts: sql<number>`COUNT(*)`,
          totalSales: sumMoneyAmount(cashShifts.totalSalesCents),
          totalRefunds: sumMoneyAmount(cashShifts.totalRefundsCents),
          avgSalesPerShift: avgMoneyAmount(cashShifts.totalSalesCents),
          totalCashSales: sumMoneyAmount(cashShifts.cashSalesCents),
          totalCardSales: sumMoneyAmount(cashShifts.cardSalesCents),
          totalDigitalSales: sumMoneyAmount(cashShifts.digitalSalesCents),
          closedShifts: sql<number>`COUNT(CASE WHEN ${cashShifts.status} = 'closed' THEN 1 END)`,
          avgCashDifference: avgAbsMoneyAmount(
            cashShifts.differenceAmountCents,
          ),
        })
        .from(cashShifts)
        .innerJoin(cashRegisters, eq(cashShifts.registerId, cashRegisters.id))
        .where(and(...conditions));

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      console.error("獲取班次統計失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取班次統計失敗",
      };
    }
  }

  /**
   * 獲取日營業報表
   */
  async getDailyReport(
    restaurantId: string,
    date: string,
  ): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      // `date` 是店家自己的日曆日，四段查詢必須切在同一個午夜，
      // 否則同一天的班次、訂單、退款會落在不同的日界上 (#329)。
      const offsetMinutes =
        await this.businessTimezone.offsetMinutes(restaurantId);

      // 獲取當日班次
      const shifts = await this.db
        .select()
        .from(cashShifts)
        .innerJoin(cashRegisters, eq(cashShifts.registerId, cashRegisters.id))
        .where(
          and(
            eq(cashRegisters.restaurantId, restaurantId),
            sql`${dateFromUnixMs(cashShifts.startedAt, offsetMinutes)} = ${date}`,
          ),
        )
        .orderBy(cashShifts.startedAt);

      // 獲取當日訂單統計
      const [orderStats] = await this.db
        .select({
          totalOrders: sql<number>`COUNT(*)`,
          totalSales: sumMoneyAmount(orders.totalAmountCents),
          totalTax: sumMoneyAmount(orders.taxAmountCents),
          totalDiscounts: sumMoneyAmount(orders.discountAmountCents),
          avgOrderValue: avgMoneyAmount(orders.totalAmountCents),
          cashOrders: sql<number>`COUNT(CASE WHEN ${orders.paymentMethod} = 'cash' THEN 1 END)`,
          cardOrders: sql<number>`COUNT(CASE WHEN ${orders.paymentMethod} = 'card' THEN 1 END)`,
          digitalOrders: sql<number>`COUNT(CASE WHEN ${orders.paymentMethod} = 'digital_wallet' THEN 1 END)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            sql`${dateFromUnixMs(orders.createdAt, offsetMinutes)} = ${date}`,
            // 收銀台的「今日業績」讀這裡。只算真的收到錢的單 (#354)：
            // 已出餐未結帳、已取消的單都不是業績。
            revenueRecognisedOrder(),
          ),
        );

      // 獲取退款統計
      const [refundStats] = await this.db
        .select({
          totalRefunds: sql<number>`COUNT(*)`,
          totalRefundAmount: sumMoneyAmount(refunds.refundAmountCents),
        })
        .from(refunds)
        .innerJoin(cashRegisters, eq(refunds.registerId, cashRegisters.id))
        .where(
          and(
            eq(cashRegisters.restaurantId, restaurantId),
            sql`${dateFromUnixMs(refunds.processedAt, offsetMinutes)} = ${date}`,
            eq(refunds.status, "completed"),
          ),
        );

      // 獲取熱門商品
      const topItems = await this.db
        .select({
          name: menuItems.name,
          totalQuantity: sql<number>`SUM(${orderItems.quantity})`,
          totalRevenue: sumMoneyAmount(orderItems.totalPriceCents),
        })
        .from(orderItems)
        .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            sql`${dateFromUnixMs(orders.createdAt, offsetMinutes)} = ${date}`,
            revenueRecognisedOrder(),
          ),
        )
        .groupBy(menuItems.id, menuItems.name)
        .orderBy(sql`SUM(${orderItems.quantity}) DESC`)
        .limit(10);

      const reportData = {
        date,
        shifts: shifts.map((s) => s.cash_shifts),
        summary: {
          totalOrders: orderStats?.totalOrders || 0,
          totalSales: orderStats?.totalSales || 0,
          totalTax: orderStats?.totalTax || 0,
          totalDiscounts: orderStats?.totalDiscounts || 0,
          totalRefunds: refundStats?.totalRefunds || 0,
          totalRefundAmount: refundStats?.totalRefundAmount || 0,
          avgOrderValue: orderStats?.avgOrderValue || 0,
          netSales:
            (orderStats?.totalSales || 0) -
            (refundStats?.totalRefundAmount || 0),
        },
        paymentBreakdown: {
          cashOrders: orderStats?.cashOrders || 0,
          cardOrders: orderStats?.cardOrders || 0,
          digitalOrders: orderStats?.digitalOrders || 0,
        },
        topItems,
      };

      return {
        success: true,
        data: reportData,
      };
    } catch (error) {
      console.error("獲取日營業報表失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取日營業報表失敗",
      };
    }
  }

  /**
   * 獲取收銀機使用統計
   */
  async getRegisterUsageStats(
    restaurantId: string,
    period: "day" | "week" | "month" = "day",
  ): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      const offsetMinutes =
        await this.businessTimezone.offsetMinutes(restaurantId);
      let dateFilter: SQL;
      let groupByExpr: SQL;

      switch (period) {
        case "day":
          dateFilter = sql`${cashShifts.startedAt} >= (unixepoch('now', '-7 days') * 1000)`;
          groupByExpr = dateFromUnixMs(cashShifts.startedAt, offsetMinutes);
          break;
        case "week":
          dateFilter = sql`${cashShifts.startedAt} >= (unixepoch('now', '-4 weeks') * 1000)`;
          groupByExpr = strftimeFromUnixMs(
            "%Y-%W",
            cashShifts.startedAt,
            offsetMinutes,
          );
          break;
        case "month":
          dateFilter = sql`${cashShifts.startedAt} >= (unixepoch('now', '-12 months') * 1000)`;
          groupByExpr = strftimeFromUnixMs(
            "%Y-%m",
            cashShifts.startedAt,
            offsetMinutes,
          );
          break;
      }

      const stats = await this.db
        .select({
          registerName: cashRegisters.name,
          period: groupByExpr,
          shiftCount: sql<number>`COUNT(${cashShifts.id})`,
          totalSales: sumMoneyAmount(cashShifts.totalSalesCents),
          totalTransactions: sql<number>`SUM(${cashShifts.totalTransactions})`,
          avgSalesPerShift: avgMoneyAmount(cashShifts.totalSalesCents),
        })
        .from(cashRegisters)
        .leftJoin(
          cashShifts,
          and(eq(cashRegisters.id, cashShifts.registerId), dateFilter),
        )
        .where(eq(cashRegisters.restaurantId, restaurantId))
        .groupBy(cashRegisters.id, groupByExpr)
        .orderBy(sql`${groupByExpr} DESC`, cashRegisters.name);

      return {
        success: true,
        data: {
          period,
          stats,
        },
      };
    } catch (error) {
      console.error("獲取收銀機使用統計失敗:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "獲取收銀機使用統計失敗",
      };
    }
  }
}
