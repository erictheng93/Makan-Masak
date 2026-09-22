import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  cashMovements,
  cashRegisters,
  cashShifts,
  orders,
  receipts,
  refunds,
} from "@makanmasak/database";
import type { AuthUser } from "../../../middleware/auth";
import {
  badRequest,
  forbidden,
  notFound,
} from "../../../shared/utils/api-error";

type PosResource = "收銀機" | "班次" | "收據" | "退款" | "現金異動";

export class PosTenantAccessService {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  private assertOwner(
    user: AuthUser,
    restaurantId: string | null | undefined,
    resource: PosResource,
    notFoundCode: string,
  ): void {
    if (!restaurantId) {
      throw notFound(`${resource}不存在`, notFoundCode);
    }
    if (user.role !== 0 && String(user.restaurantId) !== restaurantId) {
      throw forbidden(`只能存取自己餐廳的${resource}`);
    }
  }

  async requireRegister(user: AuthUser, registerId: string): Promise<void> {
    const [register] = await this.db
      .select({ restaurantId: cashRegisters.restaurantId })
      .from(cashRegisters)
      .where(eq(cashRegisters.id, registerId))
      .limit(1);
    this.assertOwner(
      user,
      register?.restaurantId,
      "收銀機",
      "REGISTER_NOT_FOUND",
    );
  }

  async requireShift(user: AuthUser, shiftId: string): Promise<void> {
    const [shift] = await this.db
      .select({ restaurantId: cashRegisters.restaurantId })
      .from(cashShifts)
      .innerJoin(cashRegisters, eq(cashShifts.registerId, cashRegisters.id))
      .where(eq(cashShifts.id, shiftId))
      .limit(1);
    this.assertOwner(user, shift?.restaurantId, "班次", "SHIFT_NOT_FOUND");
  }

  async requireRegisterAndShift(
    user: AuthUser,
    registerId: string,
    shiftId?: string,
  ): Promise<void> {
    await this.requireRegister(user, registerId);
    if (!shiftId) return;

    const [shift] = await this.db
      .select({
        registerId: cashShifts.registerId,
        restaurantId: cashRegisters.restaurantId,
      })
      .from(cashShifts)
      .innerJoin(cashRegisters, eq(cashShifts.registerId, cashRegisters.id))
      .where(eq(cashShifts.id, shiftId))
      .limit(1);
    this.assertOwner(user, shift?.restaurantId, "班次", "SHIFT_NOT_FOUND");
    if (shift?.registerId !== registerId) {
      throw forbidden("班次與收銀機不相符");
    }
  }

  /**
   * A counter payment is only meaningful while the named till is open.  The
   * regular payment endpoint accepts non-POS payments too, so this check is
   * deliberately opt-in for callers that supplied a register/shift pair.
   */
  async requireActiveRegisterAndShift(
    user: AuthUser,
    registerId: string,
    shiftId: string,
  ): Promise<void> {
    await this.requireRegisterAndShift(user, registerId, shiftId);

    const [shift] = await this.db
      .select({ status: cashShifts.status })
      .from(cashShifts)
      .where(eq(cashShifts.id, shiftId))
      .limit(1);

    if (shift?.status !== "active") {
      throw badRequest("班次不存在或已結束", "SHIFT_NOT_ACTIVE");
    }
  }

  async requireReceipt(user: AuthUser, receiptId: string): Promise<void> {
    const [receipt] = await this.db
      .select({
        registerRestaurantId: cashRegisters.restaurantId,
        orderRestaurantId: orders.restaurantId,
      })
      .from(receipts)
      .innerJoin(orders, eq(receipts.orderId, orders.id))
      .leftJoin(cashRegisters, eq(receipts.registerId, cashRegisters.id))
      .where(eq(receipts.id, receiptId))
      .limit(1);
    this.assertOwner(
      user,
      receipt?.registerRestaurantId ?? receipt?.orderRestaurantId,
      "收據",
      "RECEIPT_NOT_FOUND",
    );
  }

  async requireRefund(user: AuthUser, refundId: string): Promise<void> {
    const [refund] = await this.db
      .select({ restaurantId: cashRegisters.restaurantId })
      .from(refunds)
      .innerJoin(cashRegisters, eq(refunds.registerId, cashRegisters.id))
      .where(eq(refunds.id, refundId))
      .limit(1);
    this.assertOwner(user, refund?.restaurantId, "退款", "REFUND_NOT_FOUND");
  }

  async requireCashMovement(user: AuthUser, movementId: string): Promise<void> {
    const [movement] = await this.db
      .select({ restaurantId: cashRegisters.restaurantId })
      .from(cashMovements)
      .innerJoin(cashRegisters, eq(cashMovements.registerId, cashRegisters.id))
      .where(eq(cashMovements.id, movementId))
      .limit(1);
    this.assertOwner(
      user,
      movement?.restaurantId,
      "現金異動",
      "CASH_MOVEMENT_NOT_FOUND",
    );
  }
}
