import { buildSignedQRUrl } from "@makanmasak/utils";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { orders, restaurants, seats, tables } from "../schema";
import { moneyAmountExpression } from "../utils/money-sql";
import { resolveAppBaseUrl } from "./app-base-url";
import { BaseService } from "./base";
import { SeatService } from "./seat";

/** A full `tables` row, as `insert`/`update` … `returning()` hands it back. */
export type TableRow = typeof tables.$inferSelect;

/** The seat projection `SeatService.getSeatsByTableId` returns. */
type TableSeatList = Awaited<
  ReturnType<SeatService["getSeatsByTableId"]>
>["seats"];

export interface CreateTableData {
  restaurantId: string;
  number: string;
  name?: string;
  capacity: number;
  location?: string;
  floor?: number;
  section?: string;
  features?: {
    hasChargingPort?: boolean;
    hasWifi?: boolean;
    isAccessible?: boolean;
    hasView?: boolean;
    isQuietZone?: boolean;
    smokingAllowed?: boolean;
  };
  isReservable?: boolean;
  // 座位模式支持（新增）
  qrMode?: "table" | "seat";
  seatCount?: number;
  seatNumberingStyle?: "numeric" | "alphabetic" | "custom";
}

export interface CreateTableWarning {
  code: "SEATS_NOT_CREATED";
  message: string;
}

export interface UpdateTableData {
  number?: string;
  name?: string;
  capacity?: number;
  location?: string;
  floor?: number;
  section?: string;
  features?: typeof tables.$inferInsert.features;
  isActive?: boolean;
  isReservable?: boolean;
  maintenanceNotes?: string;
  qrMode?: "table" | "seat";
  seatCount?: number;
  seatNumberingStyle?: "numeric" | "alphabetic";
}

export interface TableFilters {
  restaurantId?: string;
  floor?: number;
  section?: string;
  isOccupied?: boolean;
  isActive?: boolean;
  isReservable?: boolean;
  minCapacity?: number;
  maxCapacity?: number;
  search?: string;
  page?: number;
  limit?: number;
}

export interface QRCodeOptions {
  size?: "small" | "medium" | "large";
  format?: "png" | "svg" | "pdf";
  includeTableInfo?: boolean;
  /** Opaque passenger data. Nothing in the service reads a shape out of it. */
  customData?: unknown;
}

export interface TableStats {
  totalTables: number;
  occupiedTables: number;
  availableTables: number;
  inactiveTables: number;
  averageOccupancyRate: number;
  avgOccupancyMinutes: number;
  byFloor: Record<number, number>;
  bySection: Record<string, number>;
  byCapacity: Record<number, number>;
}

export class TableService extends BaseService {
  // 創建新桌子
  async createTable(data: CreateTableData) {
    try {
      // 檢查桌號是否已存在於同一餐廳
      const existingTable = await this.db
        .select({ id: tables.id })
        .from(tables)
        .where(
          and(
            eq(tables.restaurantId, data.restaurantId),
            eq(tables.number, data.number),
            isNull(tables.deletedAt),
          ),
        )
        .get();

      if (existingTable) {
        throw new Error("Table number already exists in this restaurant");
      }

      // The v2 signature binds the auto-incremented table id, which does not
      // exist until the INSERT returns, so the row is created with a placeholder
      // and updated immediately after. The placeholder is deliberately not a
      // signable URL: it cannot be mistaken for a working code, and
      // audit-qr-format reports it under "unparseable", which is the bucket that
      // asks for a look rather than a bulk regenerate.
      const placeholderQRCode = `pending:${crypto.randomUUID()}`;

      const qrMode = data.qrMode || "table";
      const seatCount = data.seatCount || 0;
      const seatNumberingStyle = data.seatNumberingStyle || "numeric";

      if (qrMode === "seat" && (seatCount <= 0 || seatCount > data.capacity)) {
        throw new Error(
          "Seat count must be positive and cannot exceed table capacity",
        );
      }

      // The v2 signature needs the generated table id, but its signing key is
      // configuration that can and must be checked before committing the row.
      // Otherwise a missing key is swallowed by the post-insert repair path,
      // leaving a duplicate table number with an unusable pending QR code.
      this.getQRCodeSigningKey();

      const [newTable] = await this.db
        .insert(tables)
        .values({
          restaurantId: data.restaurantId,
          number: data.number,
          name: data.name,
          capacity: data.capacity,
          location: data.location,
          floor: data.floor || 1,
          section: data.section,
          qrCode: placeholderQRCode,
          qrCodeVersion: 1,
          qrMode,
          seatCount,
          seatNumberingStyle,
          features: data.features,
          isReservable: data.isReservable ?? true,
          isActive: true,
          isOccupied: false,
        })
        .returning();

      let qrCode = placeholderQRCode;
      try {
        const signedQRCode = await this.generateQRCodeData(
          data.restaurantId,
          newTable.id,
          data.number,
        );
        await this.db
          .update(tables)
          .set({ qrCode: signedQRCode, updatedAt: new Date() })
          .where(eq(tables.id, newTable.id));
        qrCode = signedQRCode;
      } catch (error) {
        // Do not report the whole create as failed after the INSERT committed:
        // callers would retry and collide with the row that already exists.
        // The table is left with an unusable placeholder rather than a code that
        // looks valid and is not; POST /tables/:id/regenerate-qr repairs it.
        console.warn(
          `Table ${newTable.id} created without a signed QR code; regenerate the QR to repair it.`,
          error,
        );
      }

      const warnings: CreateTableWarning[] = [];

      // 如果是座位模式，自動創建座位
      if (qrMode === "seat" && seatCount > 0) {
        const seatService = new SeatService(this.d1, this.env);
        try {
          await seatService.createSeatsForTable(newTable.id, seatCount, {
            numberingStyle: seatNumberingStyle,
          });
        } catch (error) {
          // The table row has already committed. Match the QR repair path: do
          // not surface the entire create as failed and trigger a duplicate
          // retry loop. Seats can be repaired through batch seat creation.
          console.warn(
            `Table ${newTable.id} created without seats; use batch seat creation to repair it.`,
            error,
          );
          warnings.push({
            code: "SEATS_NOT_CREATED",
            message:
              "Table was created, but seats were not created. Use batch seat creation to repair this table.",
          });
        }
      }

      return warnings.length > 0
        ? { ...newTable, qrCode, warnings }
        : { ...newTable, qrCode };
    } catch (error) {
      this.handleError(error, "createTable");
    }
  }

  // 取得桌子詳細資訊
  async getTableById(id: number) {
    try {
      const table = await this.db
        .select({
          id: tables.id,
          restaurantId: tables.restaurantId,
          number: tables.number,
          name: tables.name,
          capacity: tables.capacity,
          location: tables.location,
          floor: tables.floor,
          section: tables.section,
          qrCode: tables.qrCode,
          qrCodeImageUrl: tables.qrCodeImageUrl,
          qrCodeVersion: tables.qrCodeVersion,
          pendingQrCode: tables.pendingQrCode,
          pendingQrCodeVersion: tables.pendingQrCodeVersion,
          pendingQrPreparedAt: tables.pendingQrPreparedAt,
          qrMode: tables.qrMode,
          seatCount: tables.seatCount,
          seatNumberingStyle: tables.seatNumberingStyle,
          seatLayout: tables.seatLayout,
          isOccupied: tables.isOccupied,
          isActive: tables.isActive,
          isReservable: tables.isReservable,
          features: tables.features,
          currentOrderId: tables.currentOrderId,
          occupiedAt: tables.occupiedAt,
          occupiedBy: tables.occupiedBy,
          estimatedFreeAt: tables.estimatedFreeAt,
          lastCleanedAt: tables.lastCleanedAt,
          maintenanceNotes: tables.maintenanceNotes,
          totalUsage: tables.totalUsage,
          averageOccupancyMinutes: tables.averageOccupancyMinutes,
          createdAt: tables.createdAt,
          updatedAt: tables.updatedAt,
          // 餐廳資訊
          restaurantName: restaurants.name,
        })
        .from(tables)
        .leftJoin(restaurants, eq(tables.restaurantId, restaurants.id))
        .where(and(eq(tables.id, id), isNull(tables.deletedAt)))
        .get();

      if (!table) {
        return null;
      }

      // SQLite stores booleans as 0/1 integers — coerce only these fields
      const tableData: NonNullable<typeof table> & {
        seats?: TableSeatList;
      } = {
        ...table,
        isOccupied: Boolean(Number(table.isOccupied)),
        isActive: Boolean(Number(table.isActive)),
        isReservable: Boolean(Number(table.isReservable)),
      };

      // 如果是座位模式，附加座位資訊
      if (table.qrMode === "seat") {
        const seatService = new SeatService(this.d1, this.env);
        const seatsResult = await seatService.getSeatsByTableId(id);
        tableData.seats = seatsResult.seats;
      }

      return tableData;
    } catch (error) {
      this.handleError(error, "getTableById");
    }
  }

  // 根據 QR Code 取得桌子
  async getTableByQRCode(qrCode: string) {
    try {
      const table = await this.db
        .select()
        .from(tables)
        .where(eq(tables.qrCode, qrCode))
        .get();

      return table;
    } catch (error) {
      this.handleError(error, "getTableByQRCode");
    }
  }

  // 更新桌子資訊
  async updateTable(
    id: number,
    data: UpdateTableData,
  ): Promise<TableRow | undefined> {
    try {
      const currentTable = await this.db
        .select({
          id: tables.id,
          restaurantId: tables.restaurantId,
          number: tables.number,
          qrCodeVersion: tables.qrCodeVersion,
          capacity: tables.capacity,
          qrMode: tables.qrMode,
          seatCount: tables.seatCount,
        })
        .from(tables)
        .where(and(eq(tables.id, id), isNull(tables.deletedAt)))
        .get();

      if (!currentTable) {
        throw new Error("Table not found");
      }

      const nextMode = data.qrMode ?? currentTable.qrMode ?? "table";
      const nextSeatCount = data.seatCount ?? currentTable.seatCount ?? 0;
      const nextCapacity = data.capacity ?? currentTable.capacity;

      if (
        nextMode === "seat" &&
        (nextSeatCount <= 0 || nextSeatCount > nextCapacity)
      ) {
        throw new Error(
          "Seat count must be positive and cannot exceed table capacity",
        );
      }

      if (
        currentTable.qrMode === "seat" &&
        nextMode === "seat" &&
        data.seatCount !== undefined &&
        data.seatCount !== currentTable.seatCount
      ) {
        throw new Error("Change the seat count through seat management");
      }

      if (nextMode !== (currentTable.qrMode ?? "table")) {
        const switchResult = await this.switchQRMode(
          id,
          nextMode,
          nextMode === "seat"
            ? {
                count: nextSeatCount,
                numberingStyle: data.seatNumberingStyle ?? "numeric",
              }
            : undefined,
        );

        if (!switchResult.success) {
          throw new Error(switchResult.message || "Failed to switch QR mode");
        }
      }

      // 如果更新桌號，檢查是否重複
      if (data.number) {
        const existingTable = await this.db
          .select({ id: tables.id })
          .from(tables)
          .where(
            and(
              eq(tables.restaurantId, currentTable.restaurantId),
              eq(tables.number, data.number),
              isNull(tables.deletedAt),
            ),
          )
          .get();

        if (existingTable && existingTable.id !== id) {
          throw new Error("Table number already exists in this restaurant");
        }
      }

      // A rename re-signs the stored code at the SAME version: verification
      // keys on table id + version, so the sticker already on the table keeps
      // working and the next print carries the new number.
      const renamedQr =
        data.number && data.number !== currentTable.number
          ? {
              qrCode: await this.generateQRCodeData(
                currentTable.restaurantId,
                id,
                data.number,
                currentTable.qrCodeVersion,
              ),
            }
          : {};

      const [updatedTable] = await this.db
        .update(tables)
        .set({
          ...data,
          ...renamedQr,
          seatCount: nextMode === "table" ? 0 : nextSeatCount,
          updatedAt: new Date(),
        })
        .where(and(eq(tables.id, id), isNull(tables.deletedAt)))
        .returning();

      return updatedTable;
    } catch (error) {
      this.handleError(error, "updateTable");
    }
  }

  // 刪除桌子（軟刪除 - 設為不活躍）
  async deleteTable(id: number): Promise<boolean> {
    try {
      const deletedAt = new Date();
      const result = await this.db
        .update(tables)
        .set({
          isActive: false,
          deletedAt,
          updatedAt: deletedAt,
        })
        .where(and(eq(tables.id, id), isNull(tables.deletedAt)))
        .returning({ id: tables.id });

      if (result.length === 0) {
        return false;
      }

      await this.db
        .update(seats)
        .set({
          isActive: false,
          deletedAt,
          updatedAt: deletedAt,
        })
        .where(and(eq(seats.tableId, id), isNull(seats.deletedAt)));

      return true;
    } catch (error) {
      console.error("Delete table error:", error);
      return false;
    }
  }

  // 取得餐廳的所有桌子
  async getRestaurantTables(
    restaurantId: string,
    filters: Omit<TableFilters, "restaurantId"> = {},
  ) {
    try {
      const {
        page = 1,
        limit = 20,
        floor,
        section,
        isOccupied,
        isActive,
        isReservable,
        minCapacity,
        maxCapacity,
        search,
      } = filters;
      const { offset } = this.createPagination(page, limit);

      // 建構查詢條件
      const conditions = [
        eq(tables.restaurantId, restaurantId),
        isNull(tables.deletedAt),
      ];

      if (floor !== undefined) {
        conditions.push(eq(tables.floor, floor));
      }

      if (section) {
        conditions.push(eq(tables.section, section));
      }

      if (isOccupied !== undefined) {
        conditions.push(eq(tables.isOccupied, isOccupied));
      }

      if (isActive !== undefined) {
        conditions.push(eq(tables.isActive, isActive));
      }

      if (isReservable !== undefined) {
        conditions.push(eq(tables.isReservable, isReservable));
      }

      if (minCapacity !== undefined) {
        conditions.push(gte(tables.capacity, minCapacity));
      }

      if (maxCapacity !== undefined) {
        conditions.push(lte(tables.capacity, maxCapacity));
      }

      if (search) {
        conditions.push(
          or(
            like(tables.number, `%${search}%`),
            like(tables.name, `%${search}%`),
            like(tables.location, `%${search}%`),
          )!,
        );
      }

      // 查詢桌子列表
      const tablesList = await this.db
        .select({
          id: tables.id,
          restaurantId: tables.restaurantId,
          number: tables.number,
          name: tables.name,
          capacity: tables.capacity,
          location: tables.location,
          floor: tables.floor,
          section: tables.section,
          isOccupied: tables.isOccupied,
          isActive: tables.isActive,
          isReservable: tables.isReservable,
          currentOrderId: tables.currentOrderId,
          occupiedAt: tables.occupiedAt,
          estimatedFreeAt: tables.estimatedFreeAt,
          totalUsage: tables.totalUsage,
          lastCleanedAt: tables.lastCleanedAt,
          createdAt: tables.createdAt,
          updatedAt: tables.updatedAt,
          qrMode: tables.qrMode,
          seatCount: tables.seatCount,
          seatNumberingStyle: tables.seatNumberingStyle,
          // The admin table-setup grid renders each card's QR straight from
          // this list payload — omitting it blanks every preview, the view
          // modal, download and print.
          qrCode: tables.qrCode,
          qrCodeVersion: tables.qrCodeVersion,
          pendingQrCode: tables.pendingQrCode,
          pendingQrCodeVersion: tables.pendingQrCodeVersion,
          pendingQrPreparedAt: tables.pendingQrPreparedAt,
        })
        .from(tables)
        .where(and(...conditions))
        .orderBy(asc(tables.floor), asc(tables.number))
        .limit(limit)
        .offset(offset);

      // 計算總數 (使用安全解構避免 undefined 錯誤)
      const countResult = await this.db
        .select({ total: count() })
        .from(tables)
        .where(and(...conditions));

      const total = countResult?.[0]?.total ?? 0;
      const totalPages = Math.ceil(total / limit);

      return {
        tables: tablesList,
        total,
        pagination: { page, limit, totalPages },
      };
    } catch (error) {
      this.handleError(error, "getRestaurantTables");
    }
  }

  // 佔用桌子
  async occupyTable(
    tableId: number,
    orderId: string | null,
    occupiedBy?: string,
    estimatedMinutes?: number,
  ): Promise<boolean> {
    try {
      const estimatedFreeAt = estimatedMinutes
        ? new Date(Date.now() + estimatedMinutes * 60 * 1000)
        : null;

      const result = await this.db
        .update(tables)
        .set({
          isOccupied: true,
          currentOrderId: orderId,
          occupiedAt: new Date(),
          occupiedBy,
          estimatedFreeAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tables.id, tableId),
            eq(tables.isOccupied, false),
            eq(tables.isActive, true),
            isNull(tables.deletedAt),
          ),
        )
        .returning({ id: tables.id });

      // 更新使用統計
      if (result.length > 0) {
        await this.updateTableUsageStats(tableId);
      }

      return result.length > 0;
    } catch (error) {
      console.error("Occupy table error:", error);
      return false;
    }
  }

  // 釋放桌子
  async releaseTable(tableId: number): Promise<boolean> {
    try {
      // 取得當前佔用資訊來計算佔用時間
      const table = await this.db
        .select({
          occupiedAt: tables.occupiedAt,
          totalUsage: tables.totalUsage,
          averageOccupancyMinutes: tables.averageOccupancyMinutes,
        })
        .from(tables)
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)))
        .get();

      let newAverageOccupancy = table?.averageOccupancyMinutes || 0;

      // 計算這次佔用時間
      if (table?.occupiedAt) {
        const occupancyMinutes = Math.floor(
          (Date.now() - table.occupiedAt.getTime()) / (1000 * 60),
        );
        const totalUsage = (table.totalUsage || 0) + 1;

        // 計算新的平均佔用時間
        const currentTotal =
          (table.averageOccupancyMinutes || 0) * (totalUsage - 1);
        newAverageOccupancy = Math.round(
          (currentTotal + occupancyMinutes) / totalUsage,
        );
      }

      const result = await this.db
        .update(tables)
        .set({
          isOccupied: false,
          currentOrderId: null,
          occupiedAt: null,
          occupiedBy: null,
          estimatedFreeAt: null,
          totalUsage: (table?.totalUsage || 0) + 1,
          averageOccupancyMinutes: newAverageOccupancy,
          updatedAt: new Date(),
        })
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)))
        .returning({ id: tables.id });

      return result.length > 0;
    } catch (error) {
      console.error("Release table error:", error);
      return false;
    }
  }

  // 更新清潔狀態
  async markTableCleaned(tableId: number, notes?: string): Promise<boolean> {
    try {
      const result = await this.db
        .update(tables)
        .set({
          lastCleanedAt: new Date(),
          maintenanceNotes: notes,
          updatedAt: new Date(),
        })
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)))
        .returning({ id: tables.id });

      return result.length > 0;
    } catch (error) {
      console.error("Mark table cleaned error:", error);
      return false;
    }
  }

  // 生成 QR Code 資料（HMAC 簽名 URL）
  private async generateQRCodeData(
    restaurantId: string,
    tableId: number,
    tableNumber: string,
    version: number = 1,
  ): Promise<string> {
    const baseUrl = resolveAppBaseUrl(this.env, "table QR codes");
    const signingKey = this.getQRCodeSigningKey();

    return buildSignedQRUrl(
      baseUrl,
      {
        type: "table",
        restaurantId,
        tableId,
        identifier: tableNumber,
        version,
      },
      signingKey,
    );
  }

  private getQRCodeSigningKey(): string {
    const signingKey = this.env.QR_SIGNING_KEY;
    if (!signingKey || signingKey.length < 32) {
      throw new Error("QR_SIGNING_KEY must be set and at least 32 characters");
    }

    return signingKey;
  }

  // 重新生成 QR Code
  async regenerateQRCode(
    tableId: number,
    _customData?: QRCodeOptions["customData"],
  ): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    try {
      const table = await this.db
        .select({
          restaurantId: tables.restaurantId,
          number: tables.number,
          qrCodeVersion: tables.qrCodeVersion,
        })
        .from(tables)
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)))
        .get();

      if (!table) {
        return { success: false, error: "Table not found" };
      }

      const newVersion = (table.qrCodeVersion || 0) + 1;
      const newQRCode = await this.generateQRCodeData(
        table.restaurantId,
        tableId,
        table.number,
        newVersion,
      );

      await this.db
        .update(tables)
        .set({
          qrCode: newQRCode,
          qrCodeVersion: newVersion,
          pendingQrCode: null,
          pendingQrCodeVersion: null,
          pendingQrPreparedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)));

      return { success: true, qrCode: newQRCode };
    } catch {
      return { success: false, error: "Failed to regenerate QR code" };
    }
  }

  /**
   * Two-phase rotation (#114).
   *
   * prepare() computes the next signed code and parks it. The live qr_code is
   * untouched, so the sticker currently on the table keeps working while the
   * replacement is printed. activate() promotes it, and only then does the old
   * code stop verifying — which is why a venue can swap stickers gradually
   * without any table being unscannable and without a code outliving its
   * revocation.
   */
  async prepareQRCodeRotation(
    tableId: number,
  ): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    try {
      const table = await this.db
        .select({
          restaurantId: tables.restaurantId,
          number: tables.number,
          qrCodeVersion: tables.qrCodeVersion,
          pendingQrCode: tables.pendingQrCode,
        })
        .from(tables)
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)))
        .get();

      if (!table) {
        return { success: false, error: "Table not found" };
      }
      // Re-preparing would mint a second code for the same rotation and
      // invalidate stickers that may already be printed.
      if (table.pendingQrCode) {
        return { success: true, qrCode: table.pendingQrCode };
      }

      const pendingVersion = (table.qrCodeVersion || 0) + 1;
      const pendingQrCode = await this.generateQRCodeData(
        table.restaurantId,
        tableId,
        table.number,
        pendingVersion,
      );

      await this.db
        .update(tables)
        .set({
          pendingQrCode,
          pendingQrCodeVersion: pendingVersion,
          pendingQrPreparedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)));

      return { success: true, qrCode: pendingQrCode };
    } catch {
      return { success: false, error: "Failed to prepare QR code rotation" };
    }
  }

  /** Promote the prepared code and retire the old one, for this table only. */
  async activateQRCodeRotation(
    tableId: number,
  ): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    try {
      const table = await this.db
        .select({
          pendingQrCode: tables.pendingQrCode,
          pendingQrCodeVersion: tables.pendingQrCodeVersion,
        })
        .from(tables)
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)))
        .get();

      if (!table) {
        return { success: false, error: "Table not found" };
      }
      if (!table.pendingQrCode || table.pendingQrCodeVersion == null) {
        return { success: false, error: "No prepared QR code to activate" };
      }

      const activation = await this.db
        .update(tables)
        .set({
          qrCode: table.pendingQrCode,
          qrCodeVersion: table.pendingQrCodeVersion,
          pendingQrCode: null,
          pendingQrCodeVersion: null,
          pendingQrPreparedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tables.id, tableId),
            isNull(tables.deletedAt),
            // Do not let an activation based on a stale read roll the live
            // version backwards after another regeneration has completed.
            eq(
              sql<number>`coalesce(${tables.qrCodeVersion}, 0)`,
              table.pendingQrCodeVersion - 1,
            ),
            eq(tables.pendingQrCodeVersion, table.pendingQrCodeVersion),
          ),
        );

      if (activation.meta.changes !== 1) {
        return {
          success: false,
          error: "Prepared QR code rotation is no longer current",
        };
      }

      return { success: true, qrCode: table.pendingQrCode };
    } catch {
      return { success: false, error: "Failed to activate QR code rotation" };
    }
  }

  /**
   * Abandon a prepared rotation while consuming its version. A signed QR is
   * deterministic for an entity/version pair, so reusing the version would
   * make a discarded printed sticker valid if the later rotation were enabled.
   */
  async discardQRCodeRotation(
    tableId: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.db
        .update(tables)
        .set({
          // Preserve the high-water mark even though this QR was never made
          // live. This intentionally revokes the previous live sticker too;
          // a caller must prepare and activate a replacement after discarding.
          qrCodeVersion: sql`CASE WHEN ${tables.pendingQrCodeVersion} IS NOT NULL THEN ${tables.pendingQrCodeVersion} ELSE ${tables.qrCodeVersion} END`,
          pendingQrCode: null,
          pendingQrCodeVersion: null,
          pendingQrPreparedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)));

      return { success: true };
    } catch {
      return { success: false, error: "Failed to discard QR code rotation" };
    }
  }

  // 批量生成 QR Codes
  async generateBulkQRCodes(
    restaurantId: string,
    tableIds: number[],
    _options: QRCodeOptions = {},
  ): Promise<{
    success: boolean;
    qrCodes?: Array<{ tableId: number; qrCode: string; tableNumber: string }>;
    error?: string;
  }> {
    try {
      const tablesData = await this.db
        .select({
          id: tables.id,
          number: tables.number,
          qrCodeVersion: tables.qrCodeVersion,
        })
        .from(tables)
        .where(
          and(
            eq(tables.restaurantId, restaurantId),
            inArray(tables.id, tableIds),
            isNull(tables.deletedAt),
          ),
        );

      const qrCodes = await Promise.all(
        tablesData.map(async (table) => {
          const newVersion = (table.qrCodeVersion || 0) + 1;
          return {
            tableId: table.id,
            tableNumber: table.number,
            newVersion,
            qrCode: await this.generateQRCodeData(
              restaurantId,
              table.id,
              table.number,
              newVersion,
            ),
          };
        }),
      );

      if (qrCodes.length === 0) {
        return { success: true, qrCodes: [] };
      }

      const updatedAt = new Date();
      const writes = qrCodes.map(({ tableId, qrCode, newVersion }) =>
        this.db
          .update(tables)
          .set({
            qrCode,
            qrCodeVersion: newVersion,
            pendingQrCode: null,
            pendingQrCodeVersion: null,
            pendingQrPreparedAt: null,
            updatedAt,
          })
          .where(and(eq(tables.id, tableId), isNull(tables.deletedAt))),
      );

      // One transactional batch rather than a statement per table (up to 50 per
      // request). Regeneration invalidates the printed sticker the moment it
      // commits, so a partial write would leave a restaurant where some tables
      // scan and some do not — with no record of which. D1 batch() applies all
      // or none.
      await this.db.batch(
        writes as unknown as Parameters<typeof this.db.batch>[0],
      );

      return { success: true, qrCodes };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message
          ? `Failed to generate bulk QR codes: ${message}`
          : "Failed to generate bulk QR codes",
      };
    }
  }

  // 取得可用桌子
  async getAvailableTables(restaurantId: string, capacity?: number) {
    try {
      const conditions = [
        eq(tables.restaurantId, restaurantId),
        eq(tables.isActive, true),
        eq(tables.isOccupied, false),
        eq(tables.isReservable, true),
        isNull(tables.deletedAt),
      ];

      if (capacity) {
        conditions.push(eq(tables.capacity, capacity));
      }

      const availableTables = await this.db
        .select({
          id: tables.id,
          restaurantId: tables.restaurantId,
          number: tables.number,
          name: tables.name,
          capacity: tables.capacity,
          location: tables.location,
          floor: tables.floor,
          section: tables.section,
          features: tables.features,
          // Pinned by the WHERE above, so these were left out of the
          // projection. Callers still expect a whole table back, and a row
          // that omits them is only "available" by implication — say it.
          isActive: tables.isActive,
          isOccupied: tables.isOccupied,
          isReservable: tables.isReservable,
          createdAt: tables.createdAt,
          updatedAt: tables.updatedAt,
        })
        .from(tables)
        .where(and(...conditions))
        .orderBy(asc(tables.floor), asc(tables.number));

      return availableTables;
    } catch (error) {
      this.handleError(error, "getAvailableTables");
    }
  }

  // 取得桌子統計資訊（合併為 2 次查詢，避免 7 次往返）
  async getTableStats(restaurantId: string): Promise<TableStats> {
    try {
      // 查詢 1: 所有計數 + 平均佔用時間透過條件聚合完成
      const [counts] = await this.db
        .select({
          totalTables: count(),
          occupiedTables: sql<number>`SUM(CASE WHEN ${tables.isOccupied} = 1 AND ${tables.isActive} = 1 THEN 1 ELSE 0 END)`,
          availableTables: sql<number>`SUM(CASE WHEN ${tables.isOccupied} = 0 AND ${tables.isActive} = 1 THEN 1 ELSE 0 END)`,
          inactiveTables: sql<number>`SUM(CASE WHEN ${tables.isActive} = 0 THEN 1 ELSE 0 END)`,
          avgOccupancyMinutes: sql<number>`COALESCE(AVG(CASE WHEN ${tables.totalUsage} > 0 THEN ${tables.averageOccupancyMinutes} END), 0)`,
        })
        .from(tables)
        .where(
          and(eq(tables.restaurantId, restaurantId), isNull(tables.deletedAt)),
        );

      const totalTables = counts.totalTables ?? 0;
      const occupiedTables = counts.occupiedTables ?? 0;
      const availableTables = counts.availableTables ?? 0;
      const inactiveTables = counts.inactiveTables ?? 0;

      const averageOccupancyRate =
        totalTables > 0 ? (occupiedTables / totalTables) * 100 : 0;

      // 查詢 2: 分佈統計（樓層、區域、容量）一次取得所有行
      const distributionRows = await this.db
        .select({
          floor: tables.floor,
          section: tables.section,
          capacity: tables.capacity,
        })
        .from(tables)
        .where(
          and(eq(tables.restaurantId, restaurantId), isNull(tables.deletedAt)),
        );

      const byFloor: Record<number, number> = {};
      const bySection: Record<string, number> = {};
      const byCapacity: Record<number, number> = {};

      for (const row of distributionRows) {
        const floor = row.floor || 1;
        byFloor[floor] = (byFloor[floor] || 0) + 1;
        if (row.section) {
          bySection[row.section] = (bySection[row.section] || 0) + 1;
        }
        byCapacity[row.capacity] = (byCapacity[row.capacity] || 0) + 1;
      }

      return {
        totalTables,
        occupiedTables,
        availableTables,
        inactiveTables,
        averageOccupancyRate: Math.round(averageOccupancyRate * 100) / 100,
        avgOccupancyMinutes: Math.round(counts.avgOccupancyMinutes ?? 0),
        byFloor,
        bySection,
        byCapacity,
      };
    } catch (error) {
      this.handleError(error, "getTableStats");
    }
  }

  // 更新桌子使用統計（原子遞增，避免競態條件）
  private async updateTableUsageStats(tableId: number): Promise<void> {
    try {
      await this.db
        .update(tables)
        .set({
          totalUsage: sql`${tables.totalUsage} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)));
    } catch (error) {
      console.error("Update table usage stats error:", error);
    }
  }

  /**
   * 切換 QR 碼模式（桌子模式 <-> 座位模式）
   * 這是核心功能：讓店長可以自由轉換桌子模式與座位模式
   */
  async switchQRMode(
    tableId: number,
    newMode: "table" | "seat",
    seatConfig?: {
      count: number;
      numberingStyle: "numeric" | "alphabetic" | "custom";
      prefix?: string;
    },
  ): Promise<{
    success: boolean;
    message?: string;
    data?: {
      tableId: number;
      oldMode: "table" | "seat";
      newMode: "table" | "seat";
      seatsCreated?: number;
      seatsDeleted?: number;
    };
  }> {
    try {
      const table = await this.getTableById(tableId);

      if (!table) {
        return {
          success: false,
          message: "桌子不存在",
        };
      }

      const oldMode = table.qrMode || "table";

      // 如果已經是目標模式，直接返回
      if (oldMode === newMode) {
        return {
          success: true,
          message: `桌子已經是 ${newMode === "table" ? "桌子" : "座位"} 模式`,
          data: {
            tableId,
            oldMode,
            newMode,
          },
        };
      }

      const seatService = new SeatService(this.d1, this.env);

      // 從桌子模式切換到座位模式
      if (oldMode === "table" && newMode === "seat") {
        // 檢查桌子是否正在使用中
        if (table.isOccupied) {
          return {
            success: false,
            message: "桌子正在使用中，無法切換為座位模式。請先釋放桌子。",
          };
        }

        if (!seatConfig || !seatConfig.count || seatConfig.count <= 0) {
          return {
            success: false,
            message: "請提供座位數量配置",
          };
        }

        if (seatConfig.count > table.capacity) {
          return {
            success: false,
            message: "座位數量不可超過桌台容量",
          };
        }

        // 創建座位
        const createdSeats = await seatService.createSeatsForTable(
          tableId,
          seatConfig.count,
          {
            numberingStyle: seatConfig.numberingStyle || "numeric",
            prefix: seatConfig.prefix,
          },
        );

        // 更新桌子為座位模式
        await this.db
          .update(tables)
          .set({
            qrMode: "seat",
            seatCount: seatConfig.count,
            seatNumberingStyle: seatConfig.numberingStyle || "numeric",
            updatedAt: new Date(),
          })
          .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)));

        return {
          success: true,
          message: `成功切換為座位模式，已創建 ${createdSeats.length} 個座位`,
          data: {
            tableId,
            oldMode,
            newMode,
            seatsCreated: createdSeats.length,
          },
        };
      }

      // 從座位模式切換到桌子模式
      if (oldMode === "seat" && newMode === "table") {
        // 檢查所有座位是否都沒在使用
        const seatsResult = await seatService.getSeatsByTableId(tableId);
        const hasOccupiedSeats = seatsResult.seats.some(
          (seat) => seat.isOccupied,
        );

        if (hasOccupiedSeats) {
          return {
            success: false,
            message: "有座位正在使用中，無法切換為桌子模式。請先釋放所有座位。",
          };
        }

        const seatCount = seatsResult.total;

        // 刪除所有座位（硬刪除）
        const deleted = await seatService.deleteSeatsForTable(tableId);

        if (!deleted) {
          return {
            success: false,
            message: "刪除座位失敗",
          };
        }

        // 更新桌子為桌子模式
        await this.db
          .update(tables)
          .set({
            qrMode: "table",
            seatCount: 0,
            updatedAt: new Date(),
          })
          .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)));

        return {
          success: true,
          message: `成功切換為桌子模式，已刪除 ${seatCount} 個座位`,
          data: {
            tableId,
            oldMode,
            newMode,
            seatsDeleted: seatCount,
          },
        };
      }

      return {
        success: false,
        message: "未知的模式切換操作",
      };
    } catch (error) {
      console.error("Switch QR mode error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "切換模式失敗",
      };
    }
  }

  // 取得桌子的訂單歷史
  async getTableOrderHistory(tableId: number, limit = 20) {
    try {
      const orderHistory = await this.db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          totalAmount: moneyAmountExpression(orders.totalAmountCents),
          customerInfo: orders.customerInfo,
          createdAt: orders.createdAt,
          confirmedAt: orders.confirmedAt,
          completedAt: orders.readyAt,
        })
        .from(orders)
        .where(eq(orders.tableId, tableId))
        .orderBy(desc(orders.createdAt))
        .limit(limit);

      return orderHistory;
    } catch (error) {
      this.handleError(error, "getTableOrderHistory");
    }
  }
}
