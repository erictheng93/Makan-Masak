/**
 * 班次管理服務
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql } from "drizzle-orm";
import { cashShifts, cashRegisters, cashMovements } from "@makanmasak/database";
import type { CashShift, StartShiftRequest, EndShiftRequest } from "../types";
import { startShiftSchema, endShiftSchema } from "../schemas";
import { fromCents, toRequiredCents } from "../../../shared/utils/money";
import { generateUUID } from "@makanmasak/utils";

function amountFromCents(
  cents: number | null | undefined,
  fallback?: number | null | undefined,
): number | null {
  return cents == null ? (fallback ?? null) : fromCents(cents);
}

export class ShiftService {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /**
   * Map a cash_shifts row to the CashShift domain type: normalise nullable
   * columns to optional (null -> undefined) and narrow the status string to
   * the domain union. The *_cents bookkeeping columns are intentionally
   * dropped (the domain type exposes the decimal amounts).
   */
  private mapShift(shift: typeof cashShifts.$inferSelect): CashShift {
    return {
      id: shift.id,
      registerId: shift.registerId,
      operatorId: shift.operatorId,
      startAmount: amountFromCents(shift.startAmountCents) ?? 0,
      endAmount: amountFromCents(shift.endAmountCents) ?? undefined,
      expectedAmount: amountFromCents(shift.expectedAmountCents) ?? 0,
      actualAmount: amountFromCents(shift.actualAmountCents) ?? undefined,
      differenceAmount: amountFromCents(shift.differenceAmountCents) ?? 0,
      totalSales: amountFromCents(shift.totalSalesCents) ?? 0,
      totalRefunds: amountFromCents(shift.totalRefundsCents) ?? 0,
      cashSales: amountFromCents(shift.cashSalesCents) ?? 0,
      cardSales: amountFromCents(shift.cardSalesCents) ?? 0,
      digitalSales: amountFromCents(shift.digitalSalesCents) ?? 0,
      totalTransactions: shift.totalTransactions,
      startedAt: shift.startedAt,
      endedAt: shift.endedAt ?? undefined,
      status: shift.status as CashShift["status"],
      notes: shift.notes ?? undefined,
      closingNotes: shift.closingNotes ?? undefined,
    };
  }

  /**
   * 開始班次
   */
  async startShift(
    data: StartShiftRequest,
  ): Promise<{ success: boolean; data?: CashShift; error?: string }> {
    try {
      const validatedData = startShiftSchema.parse(data);

      // 檢查收銀機是否已有活躍班次
      const [existingShift] = await this.db
        .select({ id: cashShifts.id })
        .from(cashShifts)
        .where(
          and(
            eq(cashShifts.registerId, validatedData.registerId),
            eq(cashShifts.status, "active"),
          ),
        )
        .limit(1);

      if (existingShift) {
        return {
          success: false,
          error: "此收銀機已有活躍班次",
        };
      }

      const shiftId = generateUUID();
      const startedAt = new Date();

      await this.db.insert(cashShifts).values({
        id: shiftId,
        registerId: validatedData.registerId,
        operatorId: validatedData.operatorId,
        startAmountCents: toRequiredCents(validatedData.startAmount),
        expectedAmountCents: toRequiredCents(validatedData.startAmount),
        differenceAmountCents: 0,
        totalSalesCents: 0,
        totalRefundsCents: 0,
        cashSalesCents: 0,
        cardSalesCents: 0,
        digitalSalesCents: 0,
        totalTransactions: 0,
        startedAt,
        status: "active",
        notes: validatedData.notes || null,
      });

      // 更新收銀機的當前班次
      await this.db
        .update(cashRegisters)
        .set({ currentShiftId: shiftId })
        .where(eq(cashRegisters.id, validatedData.registerId));

      // 記錄開班現金操作
      await this.recordCashMovement(shiftId, {
        type: "opening",
        amount: validatedData.startAmount,
        description: "開班現金",
        recordedBy: validatedData.operatorId,
      });

      const [shift] = await this.db
        .select()
        .from(cashShifts)
        .where(eq(cashShifts.id, shiftId))
        .limit(1);

      return {
        success: true,
        data: this.mapShift(shift),
      };
    } catch (error) {
      console.error("開班失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "開班失敗",
      };
    }
  }

  /**
   * 結束班次
   */
  async endShift(
    shiftId: string,
    data: EndShiftRequest,
    operatorId: string,
  ): Promise<{
    success: boolean;
    data?: { shift: CashShift };
    error?: string;
  }> {
    try {
      const validatedData = endShiftSchema.parse(data);

      // 獲取班次資訊
      const [shift] = await this.db
        .select()
        .from(cashShifts)
        .where(and(eq(cashShifts.id, shiftId), eq(cashShifts.status, "active")))
        .limit(1);

      if (!shift) {
        return {
          success: false,
          error: "找不到活躍班次",
        };
      }

      // The drawer does not receive card or wallet sales. Its expected count
      // is therefore intentionally independent of totalSales/totalRefunds:
      // opening float + cash sales - cash refunds +/- manual drawer movement.
      // `sale`, `opening`, `closing`, and `count` rows are source records or
      // observations, not an additional movement to add here.
      const [drawerTotals] = await this.db
        .select({
          cashRefundsCents: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.type} = 'refund' THEN ABS(COALESCE(${cashMovements.amountCents}, 0)) ELSE 0 END), 0)`,
          manualMovementCents: sql<number>`COALESCE(SUM(CASE
            WHEN ${cashMovements.type} = 'cash_in' THEN ABS(COALESCE(${cashMovements.amountCents}, 0))
            WHEN ${cashMovements.type} IN ('cash_out', 'payout', 'deposit') THEN -ABS(COALESCE(${cashMovements.amountCents}, 0))
            WHEN ${cashMovements.type} = 'adjustment' THEN COALESCE(${cashMovements.amountCents}, 0)
            ELSE 0
          END), 0)`,
        })
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.shiftId, shiftId),
            eq(cashMovements.approvalStatus, "approved"),
          ),
        );

      // 計算預期金額
      const actualAmountCents = toRequiredCents(validatedData.actualAmount);
      const expectedAmountCents =
        (shift.startAmountCents ?? 0) +
        (shift.cashSalesCents ?? 0) -
        (drawerTotals?.cashRefundsCents ?? 0) +
        (drawerTotals?.manualMovementCents ?? 0);
      const differenceAmountCents = actualAmountCents - expectedAmountCents;
      const actualAmount = fromCents(actualAmountCents);
      const expectedAmount = fromCents(expectedAmountCents);
      const differenceAmount = fromCents(differenceAmountCents);

      // 更新班次狀態
      const endedAt = new Date();
      await this.db
        .update(cashShifts)
        .set({
          endAmountCents: actualAmountCents,
          actualAmountCents,
          expectedAmountCents,
          differenceAmountCents,
          endedAt,
          status: "closed",
          closingNotes: validatedData.closingNotes || null,
        })
        .where(eq(cashShifts.id, shiftId));

      // 記錄結班現金操作
      await this.recordCashMovement(shiftId, {
        type: "closing",
        amount: actualAmount,
        description: `結班現金 (差額: ${differenceAmount >= 0 ? "+" : ""}${differenceAmount})`,
        recordedBy: operatorId,
      });

      // 清除收銀機的當前班次
      await this.db
        .update(cashRegisters)
        .set({ currentShiftId: null })
        .where(eq(cashRegisters.id, shift.registerId));

      return {
        success: true,
        data: {
          shift: {
            ...this.mapShift(shift),
            endAmount: actualAmount,
            actualAmount,
            expectedAmount,
            differenceAmount,
            status: "closed" as const,
          },
        },
      };
    } catch (error) {
      console.error("結班失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "結班失敗",
      };
    }
  }

  /**
   * 獲取當前班次
   */
  async getCurrentShift(
    registerId: string,
  ): Promise<{ success: boolean; data?: CashShift | null; error?: string }> {
    try {
      const [shift] = await this.db
        .select()
        .from(cashShifts)
        .where(
          and(
            eq(cashShifts.registerId, registerId),
            eq(cashShifts.status, "active"),
          ),
        )
        .limit(1);

      return {
        success: true,
        data: shift ? this.mapShift(shift) : null,
      };
    } catch (error) {
      console.error("獲取當前班次失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取當前班次失敗",
      };
    }
  }

  /**
   * 暫停班次
   */
  async suspendShift(
    shiftId: string,
    reason?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.db
        .update(cashShifts)
        .set({
          status: "suspended",
          closingNotes: sql`COALESCE(${cashShifts.closingNotes}, '') || ${reason ? `暫停原因: ${reason}` : "班次已暫停"} || CHAR(10)`,
        })
        .where(
          and(eq(cashShifts.id, shiftId), eq(cashShifts.status, "active")),
        );

      return { success: true };
    } catch (error) {
      console.error("暫停班次失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "暫停班次失敗",
      };
    }
  }

  /**
   * 恢復班次
   */
  async resumeShift(
    shiftId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.db
        .update(cashShifts)
        .set({ status: "active" })
        .where(
          and(eq(cashShifts.id, shiftId), eq(cashShifts.status, "suspended")),
        );

      return { success: true };
    } catch (error) {
      console.error("恢復班次失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "恢復班次失敗",
      };
    }
  }

  /**
   * 記錄現金操作
   */
  private async recordCashMovement(
    shiftId: string,
    movement: {
      type: string;
      amount: number;
      description: string;
      recordedBy: string;
      referenceId?: number;
      referenceType?: string;
      paymentMethod?: string;
      denominationBreakdown?: Record<string, number>;
    },
  ): Promise<void> {
    const movementId = generateUUID();

    const [shift] = await this.db
      .select({ registerId: cashShifts.registerId })
      .from(cashShifts)
      .where(eq(cashShifts.id, shiftId))
      .limit(1);

    const now = new Date();
    await this.db.insert(cashMovements).values({
      id: movementId,
      shiftId,
      registerId: shift.registerId,
      type: movement.type,
      amountCents: toRequiredCents(movement.amount),
      description: movement.description,
      referenceId: movement.referenceId || null,
      referenceType: movement.referenceType || null,
      paymentMethod: movement.paymentMethod || null,
      denominationBreakdown: JSON.stringify(
        movement.denominationBreakdown || {},
      ),
      recordedBy: movement.recordedBy,
      approvalStatus: "approved",
      metadata: "{}",
      createdAt: now,
    });
  }
}
