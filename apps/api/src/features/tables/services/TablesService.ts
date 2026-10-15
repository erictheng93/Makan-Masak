/**
 * Tables Service
 *
 * Business logic service for table management operations
 */

import { RealtimeBroadcastService, TableService } from "@makanmasak/database";
import {
  RealtimeEventType,
  type TableStatusUpdateEvent,
} from "@makanmasak/shared-types";
import { ApiError } from "../../../shared/utils/api-error";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../../../types/env";
import type {
  Table,
  CreateTableData,
  UpdateTableData,
  TableFilters,
  TableStats,
  TableListResult,
  ServiceResponse,
  QRRegenerateResult,
  BulkQRResult,
  QRCodeOptions,
} from "../types";

export class TablesService {
  private tableService: TableService;
  private env: Env;

  constructor(env: Env) {
    this.env = env;
    this.tableService = new TableService(env.DB as unknown as D1Database, env);
  }

  /**
   * 安全地記錄錯誤，避免循環引用問題
   */
  private logError(operation: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`TablesService.${operation} error:`, errorMessage);
  }

  private formatOperationError(operation: string, error: unknown): string {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return errorMessage ? `${operation}: ${errorMessage}` : operation;
  }

  /**
   * Tell the restaurant's admin room a table changed state. Best-effort: the
   * write has already succeeded, so a failed broadcast must not fail it.
   */
  async broadcastStatusUpdate(
    table: Pick<Table, "id" | "restaurantId" | "number" | "name">,
    status: TableStatusUpdateEvent["data"]["status"],
  ): Promise<void> {
    try {
      const broadcaster = new RealtimeBroadcastService(this.env);
      const event: TableStatusUpdateEvent = {
        type: RealtimeEventType.TABLE_STATUS_UPDATE,
        eventId: broadcaster.generateEventId(),
        timestamp: Date.now(),
        restaurantId: table.restaurantId,
        data: {
          tableId: String(table.id),
          tableName: table.name || `Table ${table.number}`,
          status,
        },
      };
      await broadcaster.broadcastEvent("admin", table.restaurantId, event);
    } catch (error) {
      this.logError("broadcastStatusUpdate", error);
    }
  }

  /**
   * Get tables for a restaurant with filtering and pagination
   */
  async getRestaurantTables(
    restaurantId: string,
    filters: Omit<TableFilters, "restaurantId">,
  ): Promise<TableListResult> {
    try {
      const result = await this.tableService.getRestaurantTables(
        restaurantId,
        filters,
      );
      return {
        tables: result.tables,
        pagination: {
          ...result.pagination,
          total: result.total,
          hasNext: result.pagination.page < result.pagination.totalPages,
          hasPrev: result.pagination.page > 1,
        },
      };
    } catch (error) {
      this.logError("getRestaurantTables", error);
      throw new Error(
        this.formatOperationError("Failed to fetch restaurant tables", error),
      );
    }
  }

  /**
   * Get a single table by ID
   */
  async getTableById(id: number): Promise<Table | null> {
    try {
      const table = await this.tableService.getTableById(id);
      return table;
    } catch (error) {
      // 安全地記錄錯誤，避免循環引用
      this.logError("getTableById", error);
      throw new Error(
        this.formatOperationError("Failed to fetch table", error),
      );
    }
  }

  /**
   * Create a new table
   */
  async createTable(data: CreateTableData): Promise<Table> {
    try {
      const newTable = await this.tableService.createTable(data);
      return newTable;
    } catch (error) {
      this.logError("createTable", error);
      throw new Error(
        this.formatOperationError("Failed to create table", error),
      );
    }
  }

  /**
   * Update an existing table
   */
  // Returns undefined when the id matched no row: `update … returning()` yields
  // an empty array, and the caller decides whether that is a 404.
  async updateTable(
    id: number,
    data: UpdateTableData,
  ): Promise<Table | undefined> {
    try {
      const updatedTable = await this.tableService.updateTable(id, data);
      return updatedTable;
    } catch (error) {
      this.logError("updateTable", error);
      if (
        error instanceof Error &&
        error.message.includes("Change the seat count through seat management")
      ) {
        throw new ApiError(
          "SEAT_COUNT_VIA_SEAT_MANAGEMENT",
          "Change the seat count through seat management",
          409,
        );
      }
      // Lowering a seat-mode table's capacity below its seat count reaches
      // the same guard, because the client now omits seatCount for an
      // unchanged mode and the service falls back to the stored value.
      // Without this it surfaced as a 500 and a generic "save failed" toast,
      // leaving the owner no way to learn what to change.
      if (
        error instanceof Error &&
        error.message.includes(
          "Seat count must be positive and cannot exceed table capacity",
        )
      ) {
        throw new ApiError(
          "SEAT_COUNT_EXCEEDS_CAPACITY",
          "Seat count must be positive and cannot exceed table capacity",
          409,
        );
      }
      throw new Error(
        this.formatOperationError("Failed to update table", error),
      );
    }
  }

  /**
   * Delete a table
   */
  async deleteTable(id: number): Promise<boolean> {
    try {
      const success = await this.tableService.deleteTable(id);
      return success;
    } catch (error) {
      this.logError("deleteTable", error);
      throw new Error(
        this.formatOperationError("Failed to delete table", error),
      );
    }
  }

  /**
   * Occupy a table with an order
   */
  async occupyTable(
    id: number,
    orderId: string | null,
    occupiedBy?: string,
    estimatedMinutes?: number,
  ): Promise<boolean> {
    try {
      const success = await this.tableService.occupyTable(
        id,
        orderId,
        occupiedBy,
        estimatedMinutes,
      );
      return success;
    } catch (error) {
      this.logError("occupyTable", error);
      throw new Error(
        this.formatOperationError("Failed to occupy table", error),
      );
    }
  }

  /**
   * Release a table (mark as unoccupied)
   */
  async releaseTable(id: number): Promise<boolean> {
    try {
      const success = await this.tableService.releaseTable(id);
      return success;
    } catch (error) {
      this.logError("releaseTable", error);
      throw new Error(
        this.formatOperationError("Failed to release table", error),
      );
    }
  }

  /**
   * Mark table as cleaned
   */
  async markTableCleaned(id: number, notes?: string): Promise<boolean> {
    try {
      const success = await this.tableService.markTableCleaned(id, notes);
      return success;
    } catch (error) {
      this.logError("markTableCleaned", error);
      throw new Error(
        this.formatOperationError("Failed to mark table as cleaned", error),
      );
    }
  }

  /**
   * Regenerate QR code for a table
   */
  async regenerateQRCode(
    id: number,
    customData?: unknown,
  ): Promise<QRRegenerateResult> {
    try {
      const result = await this.tableService.regenerateQRCode(id, customData);
      return result;
    } catch (error) {
      this.logError("regenerateQRCode", error);
      return {
        success: false,
        error: this.formatOperationError("Failed to regenerate QR code", error),
      };
    }
  }

  async prepareQRCodeRotation(id: number): Promise<QRRegenerateResult> {
    try {
      return await this.tableService.prepareQRCodeRotation(id);
    } catch (error) {
      this.logError("prepareQRCodeRotation", error);
      return {
        success: false,
        error: this.formatOperationError(
          "Failed to prepare QR code rotation",
          error,
        ),
      };
    }
  }

  async activateQRCodeRotation(id: number): Promise<QRRegenerateResult> {
    try {
      return await this.tableService.activateQRCodeRotation(id);
    } catch (error) {
      this.logError("activateQRCodeRotation", error);
      return {
        success: false,
        error: this.formatOperationError(
          "Failed to activate QR code rotation",
          error,
        ),
      };
    }
  }

  async discardQRCodeRotation(
    id: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      return await this.tableService.discardQRCodeRotation(id);
    } catch (error) {
      this.logError("discardQRCodeRotation", error);
      return {
        success: false,
        error: this.formatOperationError(
          "Failed to discard QR code rotation",
          error,
        ),
      };
    }
  }

  /**
   * Generate QR codes for multiple tables
   */
  async generateBulkQRCodes(
    restaurantId: string,
    tableIds: number[],
    options?: QRCodeOptions,
  ): Promise<BulkQRResult> {
    try {
      const result = await this.tableService.generateBulkQRCodes(
        restaurantId,
        tableIds,
        options,
      );
      if (result.success && result.qrCodes) {
        return {
          success: true,
          qrCodes: result.qrCodes.map((qr) => ({
            tableId: qr.tableId,
            qrCode: qr.qrCode,
            url: qr.qrCode, // Using qrCode as URL for now
            format: options?.format || "png",
            size: options?.size || "medium",
          })),
        };
      }
      return {
        success: false,
        error: result.error || "Failed to generate QR codes",
      };
    } catch (error) {
      this.logError("generateBulkQRCodes", error);
      return {
        success: false,
        error: this.formatOperationError(
          "Failed to generate bulk QR codes",
          error,
        ),
      };
    }
  }

  /**
   * Get available tables for a restaurant
   */
  async getAvailableTables(
    restaurantId: string,
    capacity?: number,
  ): Promise<Table[]> {
    try {
      const availableTables = await this.tableService.getAvailableTables(
        restaurantId,
        capacity,
      );
      return availableTables;
    } catch (error) {
      this.logError("getAvailableTables", error);
      throw new Error(
        this.formatOperationError("Failed to fetch available tables", error),
      );
    }
  }

  /**
   * Get table statistics for a restaurant
   */
  async getTableStats(restaurantId: string): Promise<TableStats> {
    try {
      const stats = await this.tableService.getTableStats(restaurantId);

      // Calculate total capacity from byCapacity distribution
      const totalCapacity = Object.entries(stats.byCapacity).reduce(
        (sum, [capacity, count]) => sum + parseInt(capacity) * count,
        0,
      );

      // Adapt database stats to feature stats format
      return {
        total: stats.totalTables,
        occupied: stats.occupiedTables,
        available: stats.availableTables,
        outOfService: stats.inactiveTables,
        avgOccupancyTime: stats.avgOccupancyMinutes,
        totalCapacity,
        utilizationRate: stats.averageOccupancyRate,
        floorDistribution: Object.entries(stats.byFloor).map(
          ([floor, total]) => {
            // Estimate occupied count per floor based on overall occupancy rate
            const estimatedOccupied = Math.round(
              total * (stats.averageOccupancyRate / 100),
            );
            return {
              floor: parseInt(floor),
              total,
              occupied: estimatedOccupied,
            };
          },
        ),
      };
    } catch (error) {
      this.logError("getTableStats", error);
      throw new Error(
        this.formatOperationError("Failed to fetch table statistics", error),
      );
    }
  }

  /**
   * Get table information by QR code
   */
  async getTableByQRCode(qrCode: string): Promise<Table | null> {
    try {
      // The lookup misses with `undefined`; this method has always promised
      // `null` for "no such table", so normalise rather than widen it.
      const table = await this.tableService.getTableByQRCode(qrCode);
      return table ?? null;
    } catch (error) {
      this.logError("getTableByQRCode", error);
      throw new Error(
        this.formatOperationError("Failed to fetch table by QR code", error),
      );
    }
  }

  /**
   * Validate table access permissions
   */
  validateTableAccess(
    table: Table,
    userRestaurantId: string,
    isAdmin: boolean,
  ): boolean {
    if (isAdmin) {
      return true;
    }
    return table.restaurantId === userRestaurantId;
  }

  /**
   * Validate restaurant access permissions
   */
  validateRestaurantAccess(
    restaurantId: string | undefined,
    userRestaurantId: string,
    isAdmin: boolean,
  ): boolean {
    if (isAdmin) {
      return true;
    }
    // A row whose projection left `restaurantId` out cannot be shown to belong
    // to the caller, so it does not. The comparison below already refused it —
    // this only makes refusing the explicit answer rather than a side effect.
    if (!restaurantId) {
      return false;
    }
    return restaurantId === userRestaurantId;
  }

  /**
   * Get public table information (for QR code access)
   */
  getPublicTableInfo(table: Table) {
    return {
      id: table.id,
      restaurantId: table.restaurantId,
      number: table.number,
      name: table.name,
      capacity: table.capacity,
      location: table.location,
      floor: table.floor,
      section: table.section,
      features: table.features,
      isActive: table.isActive,
      isOccupied: table.isOccupied,
    };
  }

  /**
   * Create success response helper
   */
  createSuccessResponse<T>(data: T, message?: string): ServiceResponse<T> {
    return {
      success: true,
      data,
      message,
    };
  }

  /**
   * Create error response helper
   */
  createErrorResponse(error: string): ServiceResponse {
    return {
      success: false,
      error,
    };
  }
}
