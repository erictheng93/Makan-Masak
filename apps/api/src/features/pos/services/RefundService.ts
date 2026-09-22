/**
 * 退款管理服務
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc, sql, inArray, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  refunds,
  orders,
  cashMovements,
  cashShifts,
  BusinessTimezoneResolver,
  amountFromCents,
  businessNumber,
  dateFromUnixMs,
  sumMoneyAmount,
} from "@makanmasak/database";
import type { Refund, ProcessRefundRequest } from "../types";
import { processRefundSchema } from "../schemas";
import { toRequiredCents } from "../../../shared/utils/money";
import { generateUUID } from "@makanmasak/utils";

// K6 release gate: refunds issued while a shift is already closed must not
// mutate the closed ledger totals or post a live cash movement. Instead the
// refund row itself acts as the adjustment/credit-note and the response
// signals `ledgerMutation: false` so the caller can verify the invariant.
type PostCloseRefundResult = Refund & {
  refundId: string;
  adjustmentId: string;
  ledgerMutation: false;
};
type LiveRefundResult = Refund & {
  refundId: string;
  ledgerMutation: true;
};
type PendingApprovalRefundResult = Refund & {
  refundId: string;
  ledgerMutation: false;
  approvalRequired: true;
};
type RefundResult =
  | PostCloseRefundResult
  | LiveRefundResult
  | PendingApprovalRefundResult;

export interface ProcessPosRefundOptions {
  /**
   * Cashiers create an auditable processing record.  They never settle a
   * refund or alter the drawer/order ledger themselves; Admin/Owner approval
   * performs that finalisation through `approveRefund`.
   */
  requireApproval?: boolean;
}

export interface RefundCompletionAlert {
  title: string;
  message: string;
  severity: "error" | "critical";
  metadata: Record<string, unknown>;
}

export interface RefundServiceOptions {
  alertSink?: (alert: RefundCompletionAlert) => Promise<void> | void;
}

/**
 * `orders.payment_status` 是無約束 TEXT，值域只靠寫入端自律，所以這裡列的是
 * 實際會被寫進去、且代表「錢已經收到過」的值，而不是某個 enum：
 *
 * - "completed"：PaymentService 收款成功寫入的 canonical OrderPaymentStatus。
 * - "paid"：#311 修正前寫進去的舊值，正式環境仍有存量資料。
 * - "refunded" / "partial_refunded"：退款流程自己寫回的狀態。已退過的訂單仍可
 *   再退（部分退款會連續發生），超額由下方的可退款額度守門擋掉。
 *
 * 其餘一律拒絕——"pending"、"failed"、NULL，以及任何漂進這個欄位的未知字串。
 * 與 PaymentService 的 isAlreadyFinalized 用同一組值；那邊拿來擋重複收款，
 * 這邊拿來擋「還沒收到錢就退錢」。
 */
const REFUNDABLE_PAYMENT_STATUSES: readonly string[] = [
  "completed",
  "paid",
  "refunded",
  "partial_refunded",
];

export class RefundService {
  private db;
  private businessTimezone;
  private readonly alertSink?: RefundServiceOptions["alertSink"];

  constructor(d1: D1Database, options: RefundServiceOptions = {}) {
    this.db = drizzle(d1);
    this.businessTimezone = new BusinessTimezoneResolver(this.db);
    this.alertSink = options.alertSink;
  }

  /**
   * 處理退款
   */
  async processRefund(
    data: ProcessRefundRequest,
    registerId: string,
    processedBy: string,
    shiftId?: string,
    options: ProcessPosRefundOptions = {},
  ): Promise<{ success: boolean; data?: RefundResult; error?: string }> {
    try {
      const validatedData = processRefundSchema.parse(data);

      // 檢查原訂單
      const [originalOrder] = await this.db
        .select()
        .from(orders)
        .where(eq(orders.id, validatedData.originalOrderId))
        .limit(1);

      if (!originalOrder) {
        return {
          success: false,
          error: "原訂單不存在",
        };
      }

      // 檢查訂單是否已收款。未付款的訂單退款等於憑空付錢出去：現金退款還會
      // 直接從錢櫃扣出一筆 cash_movement。
      if (
        !REFUNDABLE_PAYMENT_STATUSES.includes(originalOrder.paymentStatus ?? "")
      ) {
        return {
          success: false,
          error: "訂單尚未付款，無法退款",
        };
      }

      // 檢查退款金額是否合理
      const orderTotalAmountCents = originalOrder.totalAmountCents ?? 0;
      const refundAmountCents = toRequiredCents(validatedData.refundAmount);
      if (refundAmountCents > orderTotalAmountCents) {
        return {
          success: false,
          error: "退款金額不能超過原訂單金額",
        };
      }

      // 檢查是否已有退款記錄
      const [existingRefund] = await this.db
        .select({
          totalRefunded: sumMoneyAmount(refunds.refundAmountCents),
        })
        .from(refunds)
        .where(
          and(
            eq(refunds.originalOrderId, validatedData.originalOrderId),
            inArray(refunds.status, ["completed", "processing"]),
          ),
        );

      const totalRefundedCents = toRequiredCents(
        existingRefund?.totalRefunded || 0,
      );
      if (totalRefundedCents + refundAmountCents > orderTotalAmountCents) {
        return {
          success: false,
          error: "退款金額超過可退款額度",
        };
      }

      // K6: detect post-close adjustment by looking up the referenced shift.
      // Only an explicitly closed shift triggers the no-ledger-mutation path;
      // active/suspended/unknown shifts fall through to the normal refund flow.
      let isPostClose = false;
      if (shiftId) {
        const [shift] = await this.db
          .select({ status: cashShifts.status })
          .from(cashShifts)
          .where(eq(cashShifts.id, shiftId))
          .limit(1);
        isPostClose = shift?.status === "closed";
      }

      const refundId = generateUUID();
      const refundNumber = businessNumber("RF");

      const processedAt = new Date();
      const writeStatements: BatchItem<"sqlite">[] = [
        this.db.insert(refunds).values({
          id: refundId,
          originalOrderId: validatedData.originalOrderId,
          registerId,
          shiftId: shiftId || null,
          refundNumber,
          refundType: validatedData.refundType,
          originalAmountCents: orderTotalAmountCents,
          refundAmountCents,
          refundMethod: validatedData.refundMethod,
          reasonCode: validatedData.reasonCode,
          reasonDescription: validatedData.reasonDescription || null,
          itemsRefunded: JSON.stringify(validatedData.itemsRefunded || []),
          processedBy,
          customerSignature: validatedData.customerSignature || null,
          status: "processing",
          metadata: JSON.stringify({
            ...(isPostClose ? { postCloseAdjustment: true } : {}),
            ...(options.requireApproval ? { approvalRequired: true } : {}),
          }),
          processedAt,
        }),
      ];

      // 記錄現金流動（如果是現金退款）— closed shifts must not mutate the live
      // ledger. The refund row itself serves as the adjustment record.
      if (
        !isPostClose &&
        !options.requireApproval &&
        shiftId &&
        validatedData.refundMethod === "cash"
      ) {
        writeStatements.push(
          this.buildCashMovementInsert(shiftId, registerId, {
            type: "refund",
            amount: -validatedData.refundAmount, // 負數表示流出
            description: `退款 - ${refundNumber}`,
            recordedBy: processedBy,
            referenceId: undefined,
            referenceType: "refund",
          }),
        );
      }

      await this.db.batch(
        writeStatements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );

      // Owner/Admin refunds complete synchronously.  A cashier's refund is
      // deliberately left processing until the existing Admin/Owner approval
      // endpoint calls the same finaliser; it must not move either cash or
      // order balances before that approval.
      //
      // The previous implementation
      // scheduled this via setTimeout to mimic an asynchronous PSP callback,
      // but on Cloudflare Workers a timer scheduled after the response is sent
      // is not guaranteed to run (and there is no real external callback here),
      // so refunds got stuck in "processing". There is no genuine async work to
      // defer, so we settle the terminal state before returning.
      if (!options.requireApproval) {
        await this.completeRefund(refundId, {
          originalOrderId: validatedData.originalOrderId,
          refundAmountCents,
          shiftId: shiftId ?? null,
          registerId,
          refundMethod: validatedData.refundMethod,
          mutateShift: !isPostClose,
          recordCashMovement: false,
        });
      }

      const [refund] = await this.db
        .select()
        .from(refunds)
        .where(eq(refunds.id, refundId))
        .limit(1);

      const base = {
        ...refund,
        originalAmount: amountFromCents(refund.originalAmountCents) ?? 0,
        refundAmount: amountFromCents(refund.refundAmountCents) ?? 0,
        itemsRefunded: JSON.parse((refund.itemsRefunded as string) || "[]"),
        metadata: JSON.parse((refund.metadata as string) || "{}"),
        refundId: refund.id,
      };

      return {
        success: true,
        data: (options.requireApproval
          ? {
              ...base,
              ledgerMutation: false,
              approvalRequired: true,
            }
          : isPostClose
            ? {
                ...base,
                adjustmentId: refund.id,
                ledgerMutation: false,
              }
            : {
                ...base,
                ledgerMutation: true,
              }) as RefundResult,
      };
    } catch (error) {
      console.error("處理退款失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "處理退款失敗",
      };
    }
  }

  /**
   * 獲取退款記錄
   */
  async getRefunds(
    registerId: string,
    options?: {
      startDate?: string;
      endDate?: string;
      status?: string;
      orderId?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{
    success: boolean;
    data?: {
      refunds: (typeof refunds.$inferSelect & {
        itemsRefunded: unknown;
        metadata: unknown;
      })[];
      pagination: { page: number; limit: number; hasMore: boolean };
    };
    error?: string;
  }> {
    try {
      const {
        startDate,
        endDate,
        status,
        orderId,
        page = 1,
        limit = 20,
      } = options || {};
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [eq(refunds.registerId, registerId)];

      // Calendar-day bounds are the operator's days, so they are cut at the
      // register's own midnight rather than a fixed +8 (#329).
      const offsetMinutes =
        await this.businessTimezone.offsetMinutesForCashRegister(registerId);

      if (startDate) {
        conditions.push(
          sql`${dateFromUnixMs(refunds.processedAt, offsetMinutes)} >= ${startDate}`,
        );
      }

      if (endDate) {
        conditions.push(
          sql`${dateFromUnixMs(refunds.processedAt, offsetMinutes)} <= ${endDate}`,
        );
      }

      if (status) {
        conditions.push(eq(refunds.status, status));
      }

      if (orderId) {
        conditions.push(eq(refunds.originalOrderId, orderId));
      }

      const refundList = await this.db
        .select()
        .from(refunds)
        .where(and(...conditions))
        .orderBy(desc(refunds.processedAt))
        .limit(limit)
        .offset(offset);

      return {
        success: true,
        data: {
          refunds: refundList.map((refund: typeof refunds.$inferSelect) => ({
            ...refund,
            itemsRefunded: JSON.parse((refund.itemsRefunded as string) || "[]"),
            metadata: JSON.parse((refund.metadata as string) || "{}"),
          })),
          pagination: {
            page,
            limit,
            hasMore: refundList.length === limit,
          },
        },
      };
    } catch (error) {
      console.error("獲取退款記錄失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取退款記錄失敗",
      };
    }
  }

  /**
   * 獲取退款詳情
   */
  async getRefundDetail(refundId: string): Promise<{
    success: boolean;
    data?: typeof refunds.$inferSelect & {
      itemsRefunded: unknown;
      metadata: unknown;
    };
    error?: string;
  }> {
    try {
      const [refund] = await this.db
        .select()
        .from(refunds)
        .where(eq(refunds.id, refundId))
        .limit(1);

      if (!refund) {
        return {
          success: false,
          error: "退款記錄不存在",
        };
      }

      return {
        success: true,
        data: {
          ...refund,
          itemsRefunded: JSON.parse((refund.itemsRefunded as string) || "[]"),
          metadata: JSON.parse((refund.metadata as string) || "{}"),
        },
      };
    } catch (error) {
      console.error("獲取退款詳情失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取退款詳情失敗",
      };
    }
  }

  /**
   * 取消退款
   */
  async cancelRefund(
    refundId: string,
    cancelledBy: string,
    reason?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const metadata = reason
        ? JSON.stringify({ cancellation_reason: reason })
        : "{}";

      await this.db
        .update(refunds)
        .set({
          status: "cancelled",
          metadata,
          approvedBy: cancelledBy,
        })
        .where(
          and(
            eq(refunds.id, refundId),
            inArray(refunds.status, ["pending", "processing"]),
          ),
        );

      return { success: true };
    } catch (error) {
      console.error("取消退款失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "取消退款失敗",
      };
    }
  }

  /**
   * 審核退款
   */
  async approveRefund(
    refundId: string,
    approvedBy: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // New POS refunds settle synchronously. This endpoint remains the
      // Admin/Owner-only finaliser for a cashier's `processing` refund (and
      // recovery path for legacy processing rows). It deliberately uses the
      // same finaliser so it cannot mark a refund complete while leaving
      // orders.refund_amount_cents stale.
      await this.completeRefund(refundId, undefined, approvedBy);

      return { success: true };
    } catch (error) {
      console.error("審核退款失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "審核退款失敗",
      };
    }
  }

  /**
   * 拒絕退款
   */
  async rejectRefund(
    refundId: string,
    rejectedBy: string,
    reason?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const metadata = reason
        ? JSON.stringify({ rejection_reason: reason })
        : "{}";

      await this.db
        .update(refunds)
        .set({
          status: "failed",
          approvedBy: rejectedBy,
          metadata,
        })
        .where(and(eq(refunds.id, refundId), eq(refunds.status, "processing")));

      return { success: true };
    } catch (error) {
      console.error("拒絕退款失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "拒絕退款失敗",
      };
    }
  }

  /**
   * 記錄現金流動
   */
  private buildCashMovementInsert(
    shiftId: string,
    registerId: string,
    movement: {
      type: string;
      amount: number;
      description: string;
      recordedBy: string;
      referenceId?: number;
      referenceType?: string;
    },
  ): BatchItem<"sqlite"> {
    const movementId = generateUUID();
    const now = new Date();

    return this.db.insert(cashMovements).values({
      id: movementId,
      shiftId,
      registerId,
      type: movement.type,
      amountCents: toRequiredCents(movement.amount),
      description: movement.description,
      referenceId: movement.referenceId || null,
      referenceType: movement.referenceType || null,
      denominationBreakdown: "{}",
      recordedBy: movement.recordedBy,
      approvalStatus: "approved",
      metadata: "{}",
      createdAt: now,
    });
  }

  /**
   * Settle the refund's terminal state. Runs synchronously (awaited by the
   * caller) rather than on a fire-and-forget timer. Any write failure is
   * handled here — the refund is best-effort marked "failed" and an alert is
   * raised — so a completion failure never rejects the caller.
   */
  private async completeRefund(
    refundId: string,
    knownRefund?: {
      originalOrderId: string;
      refundAmountCents: number;
      shiftId: string | null;
      registerId: string;
      refundMethod: string;
      metadata?: unknown;
      mutateShift: boolean;
      recordCashMovement: boolean;
    },
    approvedBy?: string,
  ): Promise<void> {
    try {
      const refund =
        knownRefund ??
        (
          await this.db
            .select({
              originalOrderId: refunds.originalOrderId,
              refundAmountCents: refunds.refundAmountCents,
              shiftId: refunds.shiftId,
              registerId: refunds.registerId,
              refundMethod: refunds.refundMethod,
              metadata: refunds.metadata,
            })
            .from(refunds)
            .where(eq(refunds.id, refundId))
            .limit(1)
        )[0];

      if (!refund) {
        throw new Error("退款記錄不存在");
      }

      const metadata = parseRefundMetadata(refund.metadata);
      const recordCashMovement =
        knownRefund?.recordCashMovement ??
        (approvedBy === undefined ? false : metadata.approvalRequired === true);
      const completedAt = new Date();
      const transition = await this.db
        .update(refunds)
        .set({
          status: "completed",
          completedAt,
          ...(approvedBy ? { approvedBy } : {}),
        })
        .where(and(eq(refunds.id, refundId), eq(refunds.status, "processing")))
        .run();

      // The transition guard makes duplicate approval/retry safe: only the
      // writer that changed processing -> completed may change order and shift
      // aggregates. A no-op is a legitimate replay, not another refund.
      if (mutationChanges(transition) === 0) {
        return;
      }

      const refundAmountCents = refund.refundAmountCents ?? 0;
      const nextRefundTotalCents = sql<number>`COALESCE(${orders.refundAmountCents}, 0) + ${refundAmountCents}`;
      const isFullyRefunded = sql<boolean>`${nextRefundTotalCents} >= COALESCE(${orders.totalAmountCents}, 0)`;

      await this.db
        .update(orders)
        .set({
          refundAmountCents: nextRefundTotalCents,
          paymentStatus: sql`CASE WHEN ${isFullyRefunded} THEN 'refunded' ELSE 'partial_refunded' END`,
          status: sql`CASE WHEN ${isFullyRefunded} THEN 'refunded' ELSE ${orders.status} END`,
          updatedAt: completedAt,
        })
        .where(eq(orders.id, refund.originalOrderId));

      if (refund.shiftId && (knownRefund?.mutateShift ?? true)) {
        await this.db
          .update(cashShifts)
          .set({
            totalRefundsCents: sql`COALESCE(${cashShifts.totalRefundsCents}, 0) + ${refundAmountCents}`,
          })
          // A refund against a closed shift is an adjustment note only. It
          // must never rewrite the already-reconciled closed ledger.
          .where(
            and(
              eq(cashShifts.id, refund.shiftId),
              eq(cashShifts.status, "active"),
            ),
          );
      }

      // A cashier has not handed out cash while the record is awaiting
      // approval.  When an Admin/Owner approves that exact new-style record,
      // post the matching drawer movement once.  Legacy processing rows do
      // not carry `approvalRequired`, so this cannot duplicate their old
      // movement records.
      if (
        recordCashMovement &&
        refund.shiftId &&
        refund.refundMethod === "cash" &&
        metadata.postCloseAdjustment !== true
      ) {
        const [shift] = await this.db
          .select({ status: cashShifts.status })
          .from(cashShifts)
          .where(eq(cashShifts.id, refund.shiftId))
          .limit(1);
        if (shift?.status === "active") {
          await this.buildCashMovementInsert(
            refund.shiftId,
            refund.registerId,
            {
              type: "refund",
              amount: -(amountFromCents(refundAmountCents) ?? 0),
              description: `退款 - 待審核 ${refundId}`,
              recordedBy: approvedBy ?? "system",
              referenceId: undefined,
              referenceType: "refund",
            },
          );
        }
      }
    } catch (error) {
      console.error("更新退款狀態失敗:", error);
      let markFailedError: unknown;
      try {
        await this.db
          .update(refunds)
          .set({ status: "failed" })
          .where(
            and(eq(refunds.id, refundId), eq(refunds.status, "processing")),
          );
        await this.alertRefundCompletionFailure(refundId, error);
      } catch (updateError) {
        markFailedError = updateError;
        await this.alertRefundCompletionFailure(
          refundId,
          error,
          markFailedError,
        );
        console.error("更新失敗狀態失敗:", updateError);
      }
    }
  }

  private async alertRefundCompletionFailure(
    refundId: string,
    completionError: unknown,
    markFailedError?: unknown,
  ): Promise<void> {
    if (!this.alertSink) {
      return;
    }

    try {
      await this.alertSink({
        title: "Refund completion failed",
        message: markFailedError
          ? "Refund completion failed and the refund could not be marked failed."
          : "Refund completion failed and the refund was marked failed.",
        severity: markFailedError ? "critical" : "error",
        metadata: {
          refundId,
          completionError: errorMessage(completionError),
          ...(markFailedError
            ? { markFailedError: errorMessage(markFailedError) }
            : {}),
        },
      });
    } catch (alertError) {
      console.error("Refund failure alert failed:", alertError);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRefundMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mutationChanges(result: unknown): number {
  const meta = (result as { meta?: { changes?: unknown } } | null)?.meta;
  return typeof meta?.changes === "number" ? meta.changes : 0;
}
