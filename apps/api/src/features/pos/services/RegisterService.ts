/**
 * 收銀機管理服務
 */

import { drizzle } from "drizzle-orm/d1";
import { ZodError } from "zod";
import { eq, and } from "drizzle-orm";
import { cashRegisters, cashShifts } from "@makanmasak/database";
import type { CashRegister, CreateRegisterRequest } from "../types";
import { createRegisterSchema } from "../schemas";
import { generateUUID } from "@makanmasak/utils";

export class RegisterService {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /**
   * Map a cash_registers row to the CashRegister domain type: parse the JSON
   * text columns and normalise nullable columns to optional (null -> undefined).
   */
  private mapRegister(
    register: typeof cashRegisters.$inferSelect,
  ): CashRegister {
    return {
      id: register.id,
      name: register.name,
      location: register.location ?? undefined,
      restaurantId: register.restaurantId,
      isActive: register.isActive,
      currentShiftId: register.currentShiftId ?? undefined,
      hardwareConfig: JSON.parse(register.hardwareConfig || "{}"),
      peripherals: JSON.parse(register.peripherals || "{}"),
      settings: JSON.parse(register.settings || "{}"),
      lastMaintenanceAt: register.lastMaintenanceAt ?? undefined,
      createdAt: register.createdAt,
      updatedAt: register.updatedAt,
    };
  }

  /**
   * 創建收銀機
   */
  async createRegister(
    data: CreateRegisterRequest,
    _createdBy: string,
  ): Promise<{ success: boolean; data?: CashRegister; error?: string }> {
    try {
      const validatedData = createRegisterSchema.parse(data);
      const registerId = generateUUID();
      const now = new Date();

      await this.db.insert(cashRegisters).values({
        id: registerId,
        name: validatedData.name,
        location: validatedData.location || null,
        restaurantId: String(validatedData.restaurantId),
        isActive: true,
        hardwareConfig: JSON.stringify(validatedData.hardwareConfig || {}),
        peripherals: JSON.stringify(validatedData.peripherals || {}),
        settings: JSON.stringify(validatedData.settings || {}),
        createdAt: now,
        updatedAt: now,
      });

      const [register] = await this.db
        .select()
        .from(cashRegisters)
        .where(eq(cashRegisters.id, registerId))
        .limit(1);

      return {
        success: true,
        data: this.mapRegister(register),
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          success: false,
          error: error.issues.map((issue) => issue.message).join("; "),
        };
      }
      console.error("創建收銀機失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "創建收銀機失敗",
      };
    }
  }

  /**
   * 獲取收銀機列表
   */
  async getRegisters(
    restaurantId: string,
  ): Promise<{ success: boolean; data?: CashRegister[]; error?: string }> {
    try {
      const results = await this.db
        .select()
        .from(cashRegisters)
        .where(eq(cashRegisters.restaurantId, restaurantId))
        .orderBy(cashRegisters.name);

      const registers = results.map((register) => this.mapRegister(register));

      return {
        success: true,
        data: registers,
      };
    } catch (error) {
      console.error("獲取收銀機列表失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取收銀機列表失敗",
      };
    }
  }

  /**
   * 收銀機所屬的餐廳，用於路由層的租戶檢查。收銀機不存在時回 null。
   *
   * 這裡刻意只回餐廳 id 而不是整列：呼叫端要決定的是「可不可以碰」，在授權
   * 通過之前不該先把資料撈出來。
   */
  async getRegisterRestaurantId(registerId: string): Promise<string | null> {
    const [register] = await this.db
      .select({ restaurantId: cashRegisters.restaurantId })
      .from(cashRegisters)
      .where(eq(cashRegisters.id, registerId))
      .limit(1);

    return register?.restaurantId ?? null;
  }

  /**
   * 獲取收銀機狀態
   */
  async getRegisterStatus(registerId: string): Promise<{
    success: boolean;
    data?: CashRegister & { isShiftActive: boolean };
    error?: string;
  }> {
    try {
      const [status] = await this.db
        .select()
        .from(cashRegisters)
        .where(eq(cashRegisters.id, registerId))
        .limit(1);

      if (!status) {
        return {
          success: false,
          error: "收銀機不存在",
        };
      }

      return {
        success: true,
        data: {
          ...this.mapRegister(status),
          isShiftActive: !!status.currentShiftId,
        },
      };
    } catch (error) {
      console.error("獲取收銀機狀態失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取收銀機狀態失敗",
      };
    }
  }

  /**
   * 更新收銀機設定
   */
  async updateRegister(
    registerId: string,
    data: Partial<CreateRegisterRequest>,
  ): Promise<{ success: boolean; data?: CashRegister; error?: string }> {
    try {
      const updateData: Partial<typeof cashRegisters.$inferInsert> = {};

      if (data.name) {
        updateData.name = data.name;
      }

      if (data.location !== undefined) {
        updateData.location = data.location;
      }

      if (data.hardwareConfig) {
        updateData.hardwareConfig = JSON.stringify(data.hardwareConfig);
      }

      if (data.peripherals) {
        updateData.peripherals = JSON.stringify(data.peripherals);
      }

      if (data.settings) {
        updateData.settings = JSON.stringify(data.settings);
      }

      if (Object.keys(updateData).length === 0) {
        return {
          success: false,
          error: "沒有需要更新的欄位",
        };
      }

      updateData.updatedAt = new Date();

      await this.db
        .update(cashRegisters)
        .set(updateData)
        .where(eq(cashRegisters.id, registerId));

      const [updatedRegister] = await this.db
        .select()
        .from(cashRegisters)
        .where(eq(cashRegisters.id, registerId))
        .limit(1);

      return {
        success: true,
        data: this.mapRegister(updatedRegister),
      };
    } catch (error) {
      console.error("更新收銀機失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "更新收銀機失敗",
      };
    }
  }

  /**
   * 啟用/停用收銀機
   */
  async toggleRegisterStatus(
    registerId: string,
    isActive: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.db
        .update(cashRegisters)
        .set({
          isActive,
          updatedAt: new Date(),
        })
        .where(eq(cashRegisters.id, registerId));

      return { success: true };
    } catch (error) {
      console.error("切換收銀機狀態失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "切換收銀機狀態失敗",
      };
    }
  }

  /**
   * 刪除收銀機
   */
  async deleteRegister(
    registerId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 檢查是否有活躍班次
      const [activeShift] = await this.db
        .select({ id: cashShifts.id })
        .from(cashShifts)
        .where(
          and(
            eq(cashShifts.registerId, registerId),
            eq(cashShifts.status, "active"),
          ),
        )
        .limit(1);

      if (activeShift) {
        return {
          success: false,
          error: "無法刪除有活躍班次的收銀機",
        };
      }

      await this.db
        .delete(cashRegisters)
        .where(eq(cashRegisters.id, registerId));

      return { success: true };
    } catch (error) {
      console.error("刪除收銀機失敗:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "刪除收銀機失敗",
      };
    }
  }
}
