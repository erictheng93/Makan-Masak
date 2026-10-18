import { buildSignedQRUrl } from "@makanmasak/utils";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { restaurants, seats, tables } from "../schema";
import { resolveAppBaseUrl } from "./app-base-url";
import { BaseService } from "./base";

export interface CreateSeatData {
  tableId: number;
  seatNumber: string;
  seatName?: string;
  position?: string;
}

export interface UpdateSeatData {
  seatNumber?: string;
  seatName?: string;
  position?: string;
  isActive?: boolean;
}

export interface SeatFilters {
  tableId?: number;
  isOccupied?: boolean;
  isActive?: boolean;
  seatNumbers?: string[];
  page?: number;
  limit?: number;
}

export interface SeatNumberingOptions {
  numberingStyle?: "numeric" | "alphabetic" | "custom";
  customNumbers?: string[];
  prefix?: string;
}

export interface SeatStats {
  totalSeats: number;
  occupiedSeats: number;
  availableSeats: number;
  inactiveSeats: number;
  averageOccupancyRate: number;
}

/** A full `seats` row, as `insert`/`update` … `returning()` hands it back. */
export type SeatRow = typeof seats.$inferSelect;

/**
 * 座位服務
 * 負責座位的創建、管理和操作
 */
export class SeatService extends BaseService {
  /**
   * 為桌子批量創建座位
   */
  async createSeatsForTable(
    tableId: number,
    seatCount: number,
    options: SeatNumberingOptions = {},
  ): Promise<SeatRow[]> {
    try {
      // 驗證桌子是否存在
      const table = await this.db
        .select({
          id: tables.id,
          restaurantId: tables.restaurantId,
          number: tables.number,
        })
        .from(tables)
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)))
        .get();

      if (!table) {
        throw new Error("Table not found");
      }

      if (!Number.isInteger(seatCount) || seatCount <= 0) {
        throw new Error("Seat count must be a positive integer");
      }

      // Every seat number this table has ever used, soft-deleted rows
      // included. `seats(table_id, seat_number)` is UNIQUE with no deletedAt
      // predicate, so a retired number stays claimed and reusing it fails the
      // insert. Skipping past it is also what the printed stickers want: an
      // old "03" sticker is still out in the room pointing at the retired
      // seat, and a new seat wearing that number would collide with it in the
      // one place the QR cannot disambiguate -- the label a customer reads.
      //
      // This method appends. It used to refuse outright once a table had any
      // seat, which left an owner no way to add a chair: seat management threw
      // "Table already has seats" while `PUT /tables/:id` answered
      // SEAT_COUNT_VIA_SEAT_MANAGEMENT and sent them back here.
      const takenRows = await this.db
        .select({ seatNumber: seats.seatNumber })
        .from(seats)
        .where(eq(seats.tableId, tableId));
      const takenNumbers = new Set(takenRows.map((row) => row.seatNumber));

      // 生成座位編號
      const seatNumbers = this.generateSeatNumbers(
        seatCount,
        options,
        takenNumbers,
      );

      // 並行生成所有 QR codes
      const qrCodes = await Promise.all(
        seatNumbers.map((seatNumber) =>
          this.generateSeatQRCode(table.restaurantId, tableId, seatNumber),
        ),
      );

      // 批量插入所有座位
      const seatValues = seatNumbers.map((seatNumber, i) => ({
        tableId,
        seatNumber,
        qrCode: qrCodes[i],
        qrCodeVersion: 1,
        isOccupied: false,
        isActive: true,
        totalUsage: 0,
      }));

      const createdSeats = await this.db
        .insert(seats)
        .values(seatValues)
        .returning();

      await this.syncTableSeatCount(tableId);

      return createdSeats;
    } catch (error) {
      this.handleError(error, "createSeatsForTable");
    }
  }

  /**
   * Rewrite `tables.seat_count` from the seats that actually exist.
   *
   * The column is denormalised, and `PUT /tables/:id` compares an incoming
   * seatCount against it to decide whether the caller is trying to resize the
   * table from the wrong endpoint. Leaving it behind after a seat was added or
   * retired makes that guard fire on a request that changed nothing, so every
   * write that moves the seat population calls this.
   */
  private async syncTableSeatCount(tableId: number): Promise<void> {
    const [row] = await this.db
      .select({ total: count() })
      .from(seats)
      // Not-deleted, not "active": a seat parked as unavailable is still a
      // chair at the table, still shown in the grid, and still counts against
      // capacity in the batch-create route. Counting it here too keeps the
      // column agreeing with the check that gates writes to it.
      .where(and(eq(seats.tableId, tableId), isNull(seats.deletedAt)));

    await this.db
      .update(tables)
      .set({ seatCount: row?.total ?? 0, updatedAt: new Date() })
      .where(eq(tables.id, tableId));
  }

  /**
   * 獲取單個座位
   */
  async getSeatById(seatId: number) {
    try {
      const seat = await this.db
        .select({
          id: seats.id,
          tableId: seats.tableId,
          seatNumber: seats.seatNumber,
          seatName: seats.seatName,
          position: seats.position,
          qrCode: seats.qrCode,
          qrCodeImageUrl: seats.qrCodeImageUrl,
          qrCodeVersion: seats.qrCodeVersion,
          pendingQrCode: seats.pendingQrCode,
          pendingQrCodeVersion: seats.pendingQrCodeVersion,
          pendingQrPreparedAt: seats.pendingQrPreparedAt,
          isOccupied: seats.isOccupied,
          isActive: seats.isActive,
          currentOrderId: seats.currentOrderId,
          occupiedAt: seats.occupiedAt,
          occupiedBy: seats.occupiedBy,
          totalUsage: seats.totalUsage,
          createdAt: seats.createdAt,
          updatedAt: seats.updatedAt,
          // 桌子資訊
          tableNumber: tables.number,
          restaurantId: tables.restaurantId,
          // 餐廳資訊
          restaurantName: restaurants.name,
        })
        .from(seats)
        .leftJoin(tables, eq(seats.tableId, tables.id))
        .leftJoin(restaurants, eq(tables.restaurantId, restaurants.id))
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)))
        .get();

      return seat;
    } catch (error) {
      this.handleError(error, "getSeatById");
    }
  }

  /**
   * 根據 QR Code 獲取座位
   */
  async getSeatByQRCode(qrCode: string) {
    try {
      const seat = await this.db
        .select({
          id: seats.id,
          tableId: seats.tableId,
          seatNumber: seats.seatNumber,
          seatName: seats.seatName,
          position: seats.position,
          qrCode: seats.qrCode,
          isOccupied: seats.isOccupied,
          isActive: seats.isActive,
          currentOrderId: seats.currentOrderId,
          // 桌子資訊
          tableNumber: tables.number,
          capacity: tables.capacity,
          restaurantId: tables.restaurantId,
          // 餐廳資訊
          restaurantName: restaurants.name,
        })
        .from(seats)
        .leftJoin(tables, eq(seats.tableId, tables.id))
        .leftJoin(restaurants, eq(tables.restaurantId, restaurants.id))
        .where(
          and(
            eq(seats.qrCode, qrCode),
            eq(seats.isActive, true),
            isNull(seats.deletedAt),
          ),
        )
        .get();

      return seat;
    } catch (error) {
      this.handleError(error, "getSeatByQRCode");
    }
  }

  /**
   * 獲取桌子的所有座位
   */
  async getSeatsByTableId(
    tableId: number,
    filters: Omit<SeatFilters, "tableId"> = {},
  ) {
    try {
      const {
        page = 1,
        limit = 50,
        isOccupied,
        isActive,
        seatNumbers,
      } = filters;
      const { offset } = this.createPagination(page, limit);

      // 建構查詢條件
      const conditions = [eq(seats.tableId, tableId), isNull(seats.deletedAt)];

      if (isOccupied !== undefined) {
        conditions.push(eq(seats.isOccupied, isOccupied));
      }

      if (isActive !== undefined) {
        conditions.push(eq(seats.isActive, isActive));
      }

      if (seatNumbers && seatNumbers.length > 0) {
        conditions.push(inArray(seats.seatNumber, seatNumbers));
      }

      // 查詢座位列表
      const seatsList = await this.db
        .select({
          id: seats.id,
          tableId: seats.tableId,
          seatNumber: seats.seatNumber,
          seatName: seats.seatName,
          position: seats.position,
          qrCode: seats.qrCode,
          qrCodeImageUrl: seats.qrCodeImageUrl,
          qrCodeVersion: seats.qrCodeVersion,
          pendingQrCode: seats.pendingQrCode,
          pendingQrCodeVersion: seats.pendingQrCodeVersion,
          pendingQrPreparedAt: seats.pendingQrPreparedAt,
          isOccupied: seats.isOccupied,
          isActive: seats.isActive,
          currentOrderId: seats.currentOrderId,
          occupiedAt: seats.occupiedAt,
          occupiedBy: seats.occupiedBy,
          totalUsage: seats.totalUsage,
          createdAt: seats.createdAt,
        })
        .from(seats)
        .where(and(...conditions))
        .orderBy(asc(seats.seatNumber))
        .limit(limit)
        .offset(offset);

      // 計算總數
      const [{ total }] = await this.db
        .select({ total: count() })
        .from(seats)
        .where(and(...conditions));

      const totalPages = Math.ceil(total / limit);

      return {
        seats: seatsList,
        total,
        pagination: { page, limit, totalPages },
      };
    } catch (error) {
      this.handleError(error, "getSeatsByTableId");
    }
  }

  /**
   * 更新座位
   */
  async updateSeat(
    seatId: number,
    data: UpdateSeatData,
  ): Promise<SeatRow | undefined> {
    try {
      // The seat number is the seat's identity inside its signed QR, so a
      // renumber reissues the code in the same write; otherwise the stored
      // code would fail verification as "mismatch" with nothing telling anyone.
      let reissuedQr = {};
      if (data.seatNumber !== undefined) {
        const current = await this.db
          .select({
            tableId: seats.tableId,
            seatNumber: seats.seatNumber,
            qrCodeVersion: seats.qrCodeVersion,
            restaurantId: tables.restaurantId,
          })
          .from(seats)
          .innerJoin(tables, eq(seats.tableId, tables.id))
          .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)))
          .get();

        if (current && current.seatNumber !== data.seatNumber) {
          const qrCodeVersion = (current.qrCodeVersion || 0) + 1;
          reissuedQr = {
            qrCode: await this.generateSeatQRCode(
              current.restaurantId,
              current.tableId,
              data.seatNumber,
              qrCodeVersion,
            ),
            qrCodeVersion,
            pendingQrCode: null,
            pendingQrCodeVersion: null,
            pendingQrPreparedAt: null,
          };
        }
      }

      const [updatedSeat] = await this.db
        .update(seats)
        .set({
          ...data,
          ...reissuedQr,
          updatedAt: new Date(),
        })
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)))
        .returning();

      return updatedSeat;
    } catch (error) {
      this.handleError(error, "updateSeat");
    }
  }

  /**
   * 刪除座位（軟刪除）
   */
  async deleteSeat(seatId: number): Promise<boolean> {
    try {
      const deletedAt = new Date();
      const result = await this.db
        .update(seats)
        .set({
          isActive: false,
          deletedAt,
          updatedAt: deletedAt,
        })
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)))
        .returning({ id: seats.id, tableId: seats.tableId });

      if (result.length > 0) {
        await this.syncTableSeatCount(result[0].tableId);
      }

      return result.length > 0;
    } catch (error) {
      this.handleError(error, "deleteSeat");
    }
  }

  /**
   * 批量刪除桌子的所有座位（硬刪除，用於模式切換）
   */
  async deleteSeatsForTable(tableId: number): Promise<boolean> {
    try {
      await this.db.delete(seats).where(eq(seats.tableId, tableId));

      return true;
    } catch (error) {
      this.handleError(error, "deleteSeatsForTable");
    }
  }

  /**
   * 佔用座位
   */
  async occupySeat(
    seatId: number,
    orderId: string,
    occupiedBy?: string,
  ): Promise<boolean> {
    try {
      const result = await this.db
        .update(seats)
        .set({
          isOccupied: true,
          currentOrderId: orderId,
          occupiedAt: new Date(),
          occupiedBy,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(seats.id, seatId),
            eq(seats.isOccupied, false),
            eq(seats.isActive, true),
            isNull(seats.deletedAt),
          ),
        )
        .returning({ id: seats.id });

      return result.length > 0;
    } catch (error) {
      this.handleError(error, "occupySeat");
    }
  }

  /**
   * 釋放座位
   */
  async releaseSeat(seatId: number): Promise<boolean> {
    try {
      const result = await this.db
        .update(seats)
        .set({
          isOccupied: false,
          currentOrderId: null,
          occupiedAt: null,
          occupiedBy: null,
          totalUsage: sql`${seats.totalUsage} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(seats.id, seatId),
            eq(seats.isOccupied, true),
            isNull(seats.deletedAt),
          ),
        )
        .returning({ id: seats.id });

      return result.length > 0;
    } catch (error) {
      this.handleError(error, "releaseSeat");
    }
  }

  /**
   * 重新生成座位 QR Code
   */
  async regenerateSeatQRCode(
    seatId: number,
  ): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    try {
      const seat = await this.db
        .select({
          tableId: seats.tableId,
          seatNumber: seats.seatNumber,
          qrCodeVersion: seats.qrCodeVersion,
        })
        .from(seats)
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)))
        .get();

      if (!seat) {
        return { success: false, error: "Seat not found" };
      }

      const table = await this.db
        .select({ restaurantId: tables.restaurantId })
        .from(tables)
        .where(and(eq(tables.id, seat.tableId), isNull(tables.deletedAt)))
        .get();

      if (!table) {
        return { success: false, error: "Table not found" };
      }

      const newVersion = (seat.qrCodeVersion || 0) + 1;
      const newQRCode = await this.generateSeatQRCode(
        table.restaurantId,
        seat.tableId,
        seat.seatNumber,
        newVersion,
      );

      await this.db
        .update(seats)
        .set({
          qrCode: newQRCode,
          qrCodeVersion: newVersion,
          pendingQrCode: null,
          pendingQrCodeVersion: null,
          pendingQrPreparedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)));

      return { success: true, qrCode: newQRCode };
    } catch {
      return { success: false, error: "Failed to regenerate QR code" };
    }
  }

  /**
   * 批量生成座位 QR Codes
   */
  async prepareSeatQRCodeRotation(
    seatId: number,
  ): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    try {
      const seat = await this.db
        .select({
          tableId: seats.tableId,
          seatNumber: seats.seatNumber,
          qrCodeVersion: seats.qrCodeVersion,
          pendingQrCode: seats.pendingQrCode,
        })
        .from(seats)
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)))
        .get();

      if (!seat) {
        return { success: false, error: "Seat not found" };
      }
      if (seat.pendingQrCode) {
        return { success: true, qrCode: seat.pendingQrCode };
      }

      const table = await this.db
        .select({ restaurantId: tables.restaurantId })
        .from(tables)
        .where(and(eq(tables.id, seat.tableId), isNull(tables.deletedAt)))
        .get();

      if (!table) {
        return { success: false, error: "Table not found" };
      }

      const pendingVersion = (seat.qrCodeVersion || 0) + 1;
      const pendingQrCode = await this.generateSeatQRCode(
        table.restaurantId,
        seat.tableId,
        seat.seatNumber,
        pendingVersion,
      );

      await this.db
        .update(seats)
        .set({
          pendingQrCode,
          pendingQrCodeVersion: pendingVersion,
          pendingQrPreparedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)));

      return { success: true, qrCode: pendingQrCode };
    } catch {
      return { success: false, error: "Failed to prepare QR code rotation" };
    }
  }

  async activateSeatQRCodeRotation(
    seatId: number,
  ): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    try {
      const seat = await this.db
        .select({
          pendingQrCode: seats.pendingQrCode,
          pendingQrCodeVersion: seats.pendingQrCodeVersion,
        })
        .from(seats)
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)))
        .get();

      if (!seat) {
        return { success: false, error: "Seat not found" };
      }
      if (!seat.pendingQrCode || seat.pendingQrCodeVersion == null) {
        return { success: false, error: "No prepared QR code to activate" };
      }

      await this.db
        .update(seats)
        .set({
          qrCode: seat.pendingQrCode,
          qrCodeVersion: seat.pendingQrCodeVersion,
          pendingQrCode: null,
          pendingQrCodeVersion: null,
          pendingQrPreparedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)));

      return { success: true, qrCode: seat.pendingQrCode };
    } catch {
      return { success: false, error: "Failed to activate QR code rotation" };
    }
  }

  async discardSeatQRCodeRotation(
    seatId: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.db
        .update(seats)
        .set({
          pendingQrCode: null,
          pendingQrCodeVersion: null,
          pendingQrPreparedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(seats.id, seatId), isNull(seats.deletedAt)));

      return { success: true };
    } catch {
      return { success: false, error: "Failed to discard QR code rotation" };
    }
  }

  async batchPrepareSeatQRCodeRotations(tableId: number): Promise<{
    success: boolean;
    qrCodes?: Array<{ seatId: number; qrCode: string; seatNumber: string }>;
    error?: string;
  }> {
    try {
      const table = await this.db
        .select({ restaurantId: tables.restaurantId })
        .from(tables)
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)))
        .get();

      if (!table) {
        return { success: false, error: "Table not found" };
      }

      const seatsList = await this.db
        .select({
          id: seats.id,
          seatNumber: seats.seatNumber,
          qrCodeVersion: seats.qrCodeVersion,
          pendingQrCode: seats.pendingQrCode,
        })
        .from(seats)
        .where(and(eq(seats.tableId, tableId), isNull(seats.deletedAt)))
        .orderBy(asc(seats.seatNumber));

      if (seatsList.length === 0) {
        return { success: true, qrCodes: [] };
      }

      const prepared = await Promise.all(
        seatsList.map(async (seat) => {
          if (seat.pendingQrCode) {
            return {
              seatId: seat.id,
              seatNumber: seat.seatNumber,
              pendingVersion: null,
              qrCode: seat.pendingQrCode,
            };
          }

          const pendingVersion = (seat.qrCodeVersion || 0) + 1;
          return {
            seatId: seat.id,
            seatNumber: seat.seatNumber,
            pendingVersion,
            qrCode: await this.generateSeatQRCode(
              table.restaurantId,
              tableId,
              seat.seatNumber,
              pendingVersion,
            ),
          };
        }),
      );

      const updatedAt = new Date();
      const writes = prepared
        .filter(
          (
            preparedSeat,
          ): preparedSeat is {
            seatId: number;
            seatNumber: string;
            pendingVersion: number;
            qrCode: string;
          } => preparedSeat.pendingVersion !== null,
        )
        .map(({ seatId, qrCode, pendingVersion }) =>
          this.db
            .update(seats)
            .set({
              pendingQrCode: qrCode,
              pendingQrCodeVersion: pendingVersion,
              pendingQrPreparedAt: updatedAt,
              updatedAt,
            })
            .where(and(eq(seats.id, seatId), isNull(seats.deletedAt))),
        );

      if (writes.length > 0) {
        await this.db.batch(
          writes as unknown as Parameters<typeof this.db.batch>[0],
        );
      }

      return {
        success: true,
        qrCodes: prepared.map(({ seatId, seatNumber, qrCode }) => ({
          seatId,
          seatNumber,
          qrCode,
        })),
      };
    } catch {
      return { success: false, error: "Failed to prepare QR code rotation" };
    }
  }

  async batchGenerateSeatQRCodes(tableId: number): Promise<{
    success: boolean;
    qrCodes?: Array<{ seatId: number; qrCode: string; seatNumber: string }>;
    error?: string;
  }> {
    try {
      const table = await this.db
        .select({ restaurantId: tables.restaurantId })
        .from(tables)
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)))
        .get();

      if (!table) {
        return { success: false, error: "Table not found" };
      }

      const seatsList = await this.db
        .select({
          id: seats.id,
          seatNumber: seats.seatNumber,
          qrCodeVersion: seats.qrCodeVersion,
        })
        .from(seats)
        .where(and(eq(seats.tableId, tableId), isNull(seats.deletedAt)));

      if (seatsList.length === 0) {
        return { success: true, qrCodes: [] };
      }

      // Sign in parallel: HMAC is CPU-only, so awaiting each one in turn just
      // serialises work that has no reason to be ordered.
      const regenerated = await Promise.all(
        seatsList.map(async (seat) => {
          const newVersion = (seat.qrCodeVersion || 0) + 1;
          return {
            seatId: seat.id,
            seatNumber: seat.seatNumber,
            newVersion,
            qrCode: await this.generateSeatQRCode(
              table.restaurantId,
              tableId,
              seat.seatNumber,
              newVersion,
            ),
          };
        }),
      );

      const updatedAt = new Date();
      const writes = regenerated.map(({ seatId, qrCode, newVersion }) =>
        this.db
          .update(seats)
          .set({
            qrCode,
            qrCodeVersion: newVersion,
            pendingQrCode: null,
            pendingQrCodeVersion: null,
            pendingQrPreparedAt: null,
            updatedAt,
          })
          .where(and(eq(seats.id, seatId), isNull(seats.deletedAt))),
      );

      // One transactional batch rather than a statement per seat. Regeneration
      // invalidates the printed sticker the moment it commits, so a partial
      // write would leave a table where some seats scan and some do not — with
      // no record of which. D1 batch() applies all or none.
      await this.db.batch(
        writes as unknown as Parameters<typeof this.db.batch>[0],
      );

      return {
        success: true,
        qrCodes: regenerated.map(({ seatId, seatNumber, qrCode }) => ({
          seatId,
          seatNumber,
          qrCode,
        })),
      };
    } catch {
      return { success: false, error: "Failed to generate QR codes" };
    }
  }

  /**
   * 獲取座位統計（單次查詢，透過條件聚合）
   */
  async getSeatStats(tableId: number): Promise<SeatStats> {
    try {
      const [stats] = await this.db
        .select({
          totalSeats: count(),
          occupiedSeats: sql<number>`SUM(CASE WHEN ${seats.isOccupied} = 1 AND ${seats.isActive} = 1 THEN 1 ELSE 0 END)`,
          availableSeats: sql<number>`SUM(CASE WHEN ${seats.isOccupied} = 0 AND ${seats.isActive} = 1 THEN 1 ELSE 0 END)`,
          inactiveSeats: sql<number>`SUM(CASE WHEN ${seats.isActive} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(seats)
        .where(and(eq(seats.tableId, tableId), isNull(seats.deletedAt)));

      const totalSeats = stats.totalSeats ?? 0;
      const occupiedSeats = stats.occupiedSeats ?? 0;
      const availableSeats = stats.availableSeats ?? 0;
      const inactiveSeats = stats.inactiveSeats ?? 0;

      const averageOccupancyRate =
        totalSeats > 0 ? (occupiedSeats / totalSeats) * 100 : 0;

      return {
        totalSeats,
        occupiedSeats,
        availableSeats,
        inactiveSeats,
        averageOccupancyRate: Math.round(averageOccupancyRate * 100) / 100,
      };
    } catch (error) {
      this.handleError(error, "getSeatStats");
    }
  }

  // ============================================
  // 私有輔助方法
  // ============================================

  /**
   * 生成座位 QR Code 內容
   */
  private async generateSeatQRCode(
    restaurantId: string,
    tableId: number,
    seatNumber: string,
    version: number = 1,
  ): Promise<string> {
    const baseUrl = resolveAppBaseUrl(this.env, "seat QR codes");
    const signingKey = this.env.QR_SIGNING_KEY;
    if (!signingKey || signingKey.length < 32) {
      throw new Error("QR_SIGNING_KEY must be set and at least 32 characters");
    }

    return buildSignedQRUrl(
      baseUrl,
      {
        type: "seat",
        restaurantId,
        tableId,
        identifier: seatNumber,
        version,
      },
      signingKey,
    );
  }

  /**
   * 生成座位編號
   */
  /**
   * @param takenNumbers numbers this table already claims, so an append picks
   *   up past them instead of colliding with the UNIQUE index.
   */
  private generateSeatNumbers(
    count: number,
    options: SeatNumberingOptions = {},
    takenNumbers: ReadonlySet<string> = new Set(),
  ): string[] {
    const { numberingStyle = "numeric", customNumbers, prefix = "" } = options;

    if (numberingStyle === "custom") {
      if (!customNumbers || customNumbers.length !== count) {
        throw new Error("Custom seat numbers must match seat count");
      }

      const normalizedNumbers = customNumbers.map((number) => number.trim());
      if (normalizedNumbers.some((number) => number.length === 0)) {
        throw new Error("Custom seat numbers cannot be empty");
      }
      if (new Set(normalizedNumbers).size !== normalizedNumbers.length) {
        throw new Error("Custom seat numbers must be unique");
      }
      const clash = normalizedNumbers.find((number) =>
        takenNumbers.has(number),
      );
      if (clash) {
        throw new Error(`Seat number already used on this table: ${clash}`);
      }

      return normalizedNumbers;
    }

    const numbers: string[] = [];
    // Walk the sequence from the top and keep whatever is still free, rather
    // than starting at the current seat count: with 01/02/04 in place and 03
    // retired, an append must land on 05, not re-mint 03.
    const ceiling = count + takenNumbers.size;

    for (let i = 0; i < ceiling && numbers.length < count; i++) {
      let candidate: string;

      if (numberingStyle === "numeric") {
        // 數字編號：01, 02, 03...
        candidate = `${prefix}${String(i + 1).padStart(2, "0")}`;
      } else if (numberingStyle === "alphabetic") {
        // 字母編號：A, B, C...
        const letter = String.fromCharCode(65 + (i % 26)); // A-Z
        const repeat = Math.floor(i / 26) + 1;
        candidate = `${prefix}${letter.repeat(repeat)}`;
      } else {
        break;
      }

      if (!takenNumbers.has(candidate)) {
        numbers.push(candidate);
      }
    }

    return numbers;
  }
}
