import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSignedQRUrl } from "@makanmasak/utils";
import { TablesService } from "./TablesService";
import type { Table } from "../types";

const tableServiceMethods = vi.hoisted(() => ({
  getRestaurantTables: vi.fn(),
  getTableById: vi.fn(),
  createTable: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
  occupyTable: vi.fn(),
  releaseTable: vi.fn(),
  markTableCleaned: vi.fn(),
  regenerateQRCode: vi.fn(),
  generateBulkQRCodes: vi.fn(),
  getAvailableTables: vi.fn(),
  getTableStats: vi.fn(),
  getTableByQRCode: vi.fn(),
}));

const tableServiceCtor = vi.hoisted(() =>
  vi.fn(function TableService() {
    return tableServiceMethods;
  }),
);

vi.mock("@makanmasak/database", () => ({
  TableService: tableServiceCtor,
}));

const verifyTable = vi.hoisted(() => vi.fn());
vi.mock("../../qr-codes/services/SignedQrVerificationService", () => ({
  SignedQrVerificationService: vi.fn(function SignedQrVerificationService() {
    return { verifyTable };
  }),
}));

function createEnv() {
  return {
    DB: { binding: "db" },
    CACHE_KV: {},
  };
}

function createService() {
  return new TablesService(createEnv() as never);
}

function createTable(overrides: Partial<Table> = {}): Table {
  return {
    id: 11,
    restaurantId: "rest-1",
    number: "A1",
    name: "Window",
    capacity: 4,
    location: "Main room",
    floor: 1,
    section: "A",
    features: { hasWifi: true },
    isActive: true,
    isOccupied: false,
    isReservable: true,
    createdAt: new Date("2026-06-07T00:00:00.000Z"),
    updatedAt: new Date("2026-06-07T00:00:00.000Z"),
    ...overrides,
  };
}

async function withSilencedErrors<T>(action: () => Promise<T>): Promise<T> {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    return await action();
  } finally {
    consoleError.mockRestore();
  }
}

describe("TablesService", () => {
  beforeEach(() => {
    tableServiceCtor.mockClear();
    verifyTable.mockReset();
    for (const method of Object.values(tableServiceMethods)) {
      method.mockReset();
    }
  });

  it("constructs the database TableService with DB and env bindings", () => {
    const env = createEnv();
    new TablesService(env as never);

    expect(tableServiceCtor).toHaveBeenCalledWith(env.DB, env);
  });

  it("normalizes restaurant table pagination metadata", async () => {
    const table = createTable();
    tableServiceMethods.getRestaurantTables.mockResolvedValue({
      tables: [table],
      total: 11,
      pagination: { page: 2, limit: 5, totalPages: 3 },
    });

    await expect(
      createService().getRestaurantTables("rest-1", {
        page: 2,
        limit: 5,
        isOccupied: false,
      }),
    ).resolves.toEqual({
      tables: [table],
      pagination: {
        page: 2,
        limit: 5,
        totalPages: 3,
        total: 11,
        hasNext: true,
        hasPrev: true,
      },
    });
    expect(tableServiceMethods.getRestaurantTables).toHaveBeenCalledWith(
      "rest-1",
      { page: 2, limit: 5, isOccupied: false },
    );
  });

  it("delegates table CRUD and state operations", async () => {
    const table = createTable();
    tableServiceMethods.getTableById.mockResolvedValue(table);
    tableServiceMethods.createTable.mockResolvedValue(table);
    tableServiceMethods.updateTable.mockResolvedValue({
      ...table,
      name: "Updated",
    });
    tableServiceMethods.deleteTable.mockResolvedValue(true);
    tableServiceMethods.occupyTable.mockResolvedValue(true);
    tableServiceMethods.releaseTable.mockResolvedValue(true);
    tableServiceMethods.markTableCleaned.mockResolvedValue(true);

    const service = createService();

    await expect(service.getTableById(11)).resolves.toEqual(table);
    await expect(
      service.createTable({
        restaurantId: "rest-1",
        number: "A1",
        capacity: 4,
      }),
    ).resolves.toEqual(table);
    await expect(service.updateTable(11, { name: "Updated" })).resolves.toEqual(
      { ...table, name: "Updated" },
    );
    await expect(service.deleteTable(11)).resolves.toBe(true);
    await expect(service.occupyTable(11, "order-42", "Amy", 45)).resolves.toBe(
      true,
    );
    await expect(service.releaseTable(11)).resolves.toBe(true);
    await expect(service.markTableCleaned(11, "ready")).resolves.toBe(true);

    expect(tableServiceMethods.occupyTable).toHaveBeenCalledWith(
      11,
      "order-42",
      "Amy",
      45,
    );
    expect(tableServiceMethods.markTableCleaned).toHaveBeenCalledWith(
      11,
      "ready",
    );
  });

  it("returns a conflict that tells callers to use seat management", async () => {
    tableServiceMethods.updateTable.mockRejectedValue(
      new Error("Change the seat count through seat management"),
    );

    await expect(
      withSilencedErrors(() =>
        createService().updateTable(11, { seatCount: 3 }),
      ),
    ).rejects.toMatchObject({
      code: "SEAT_COUNT_VIA_SEAT_MANAGEMENT",
      status: 409,
    });
  });

  it("wraps delegated operation failures with stable service errors", async () => {
    tableServiceMethods.getTableById.mockRejectedValue(new Error("db down"));
    await expect(
      withSilencedErrors(() => createService().getTableById(11)),
    ).rejects.toThrow("Failed to fetch table");

    tableServiceMethods.createTable.mockRejectedValue(new Error("db down"));
    await expect(
      withSilencedErrors(() =>
        createService().createTable({
          restaurantId: "rest-1",
          number: "A1",
          capacity: 4,
        }),
      ),
    ).rejects.toThrow("Failed to create table: db down");

    tableServiceMethods.deleteTable.mockRejectedValue(new Error("db down"));
    await expect(
      withSilencedErrors(() => createService().deleteTable(11)),
    ).rejects.toThrow("Failed to delete table");

    tableServiceMethods.getAvailableTables.mockRejectedValue(
      new Error("db down"),
    );
    await expect(
      withSilencedErrors(() => createService().getAvailableTables("rest-1")),
    ).rejects.toThrow("Failed to fetch available tables");
  });

  it("adapts QR regeneration and bulk QR generation responses", async () => {
    tableServiceMethods.regenerateQRCode.mockResolvedValue({
      success: true,
      qrCode: "qr-new",
    });
    tableServiceMethods.generateBulkQRCodes.mockResolvedValue({
      success: true,
      qrCodes: [
        { tableId: 11, qrCode: "https://qr.example.test/11" },
        { tableId: 12, qrCode: "https://qr.example.test/12" },
      ],
    });

    const service = createService();

    await expect(
      service.regenerateQRCode(11, { campaign: "summer" }),
    ).resolves.toEqual({
      success: true,
      qrCode: "qr-new",
    });
    expect(tableServiceMethods.regenerateQRCode).toHaveBeenCalledWith(11, {
      campaign: "summer",
    });

    await expect(
      service.generateBulkQRCodes("rest-1", [11, 12], {
        format: "svg",
        size: "large",
        includeTableInfo: true,
      }),
    ).resolves.toEqual({
      success: true,
      qrCodes: [
        {
          tableId: 11,
          qrCode: "https://qr.example.test/11",
          url: "https://qr.example.test/11",
          format: "svg",
          size: "large",
        },
        {
          tableId: 12,
          qrCode: "https://qr.example.test/12",
          url: "https://qr.example.test/12",
          format: "svg",
          size: "large",
        },
      ],
    });
  });

  it("returns QR failure objects instead of throwing", async () => {
    tableServiceMethods.regenerateQRCode.mockRejectedValue(
      new Error("qr down"),
    );
    await expect(
      withSilencedErrors(() => createService().regenerateQRCode(11)),
    ).resolves.toEqual({
      success: false,
      error: "Failed to regenerate QR code: qr down",
    });

    tableServiceMethods.generateBulkQRCodes.mockResolvedValue({
      success: false,
      error: "invalid table",
    });
    await expect(
      createService().generateBulkQRCodes("rest-1", [11]),
    ).resolves.toEqual({
      success: false,
      error: "invalid table",
    });

    tableServiceMethods.generateBulkQRCodes.mockRejectedValue(
      new Error("QR_SIGNING_KEY must be set and at least 32 characters"),
    );
    await expect(
      withSilencedErrors(() =>
        createService().generateBulkQRCodes("rest-1", [11]),
      ),
    ).resolves.toEqual({
      success: false,
      error:
        "Failed to generate bulk QR codes: QR_SIGNING_KEY must be set and at least 32 characters",
    });
  });

  it("converts database table stats to feature stats", async () => {
    tableServiceMethods.getTableStats.mockResolvedValue({
      totalTables: 10,
      occupiedTables: 4,
      availableTables: 5,
      inactiveTables: 1,
      avgOccupancyMinutes: 37,
      averageOccupancyRate: 40,
      byCapacity: { 2: 3, 4: 7 },
      byFloor: { 1: 6, 2: 4 },
    });

    await expect(createService().getTableStats("rest-1")).resolves.toEqual({
      total: 10,
      occupied: 4,
      available: 5,
      outOfService: 1,
      avgOccupancyTime: 37,
      totalCapacity: 34,
      utilizationRate: 40,
      floorDistribution: [
        { floor: 1, total: 6, occupied: 2 },
        { floor: 2, total: 4, occupied: 2 },
      ],
    });
    expect(tableServiceMethods.getTableStats).toHaveBeenCalledWith("rest-1");
  });

  it("delegates available table and QR-code lookups", async () => {
    const table = createTable();
    tableServiceMethods.getAvailableTables.mockResolvedValue([table]);
    tableServiceMethods.getTableByQRCode.mockResolvedValue(table);

    const service = createService();

    await expect(service.getAvailableTables("rest-1", 4)).resolves.toEqual([
      table,
    ]);
    await expect(service.getTableByQRCode("qr-11")).resolves.toEqual(table);
    expect(tableServiceMethods.getAvailableTables).toHaveBeenCalledWith(
      "rest-1",
      4,
    );
    expect(tableServiceMethods.getTableByQRCode).toHaveBeenCalledWith("qr-11");
  });

  it("resolves a pre-rename sticker through signed verification", async () => {
    const table = createTable({ number: "A9" });
    const oldSticker = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "table",
        restaurantId: "rest-1",
        tableId: 11,
        identifier: "A1",
        version: 1,
      },
      "k".repeat(32),
    );
    tableServiceMethods.getTableByQRCode.mockResolvedValue(undefined);
    verifyTable.mockResolvedValue({ valid: true, tableId: 11 });
    tableServiceMethods.getTableById.mockResolvedValue(table);

    await expect(createService().getTableByQRCode(oldSticker)).resolves.toBe(
      table,
    );
    expect(verifyTable).toHaveBeenCalledWith(oldSticker);
    expect(tableServiceMethods.getTableById).toHaveBeenCalledWith(11);
  });

  it("still misses for a stale or unsigned code", async () => {
    tableServiceMethods.getTableByQRCode.mockResolvedValue(undefined);
    verifyTable.mockResolvedValue({ valid: false, reason: "stale" });
    const signed = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "table",
        restaurantId: "rest-1",
        tableId: 11,
        identifier: "A1",
        version: 1,
      },
      "k".repeat(32),
    );

    const service = createService();
    await expect(service.getTableByQRCode(signed)).resolves.toBeNull();
    await expect(service.getTableByQRCode("qr-unknown")).resolves.toBeNull();
    expect(verifyTable).toHaveBeenCalledOnce();
    expect(tableServiceMethods.getTableById).not.toHaveBeenCalled();
  });

  it("validates access and creates public response helpers", () => {
    const service = createService();
    const table = createTable({
      isOccupied: true,
      occupiedBy: "hidden",
      orderId: 99,
      cleaningNotes: "hidden",
    });

    expect(service.validateTableAccess(table, "other", true)).toBe(true);
    expect(service.validateTableAccess(table, "rest-1", false)).toBe(true);
    expect(service.validateTableAccess(table, "other", false)).toBe(false);
    expect(service.validateRestaurantAccess("rest-2", "rest-1", true)).toBe(
      true,
    );
    expect(service.validateRestaurantAccess("rest-1", "rest-1", false)).toBe(
      true,
    );
    expect(service.validateRestaurantAccess("rest-2", "rest-1", false)).toBe(
      false,
    );

    expect(service.getPublicTableInfo(table)).toEqual({
      id: 11,
      restaurantId: "rest-1",
      number: "A1",
      name: "Window",
      capacity: 4,
      location: "Main room",
      floor: 1,
      section: "A",
      features: { hasWifi: true },
      isActive: true,
      isOccupied: true,
    });
    expect(service.createSuccessResponse({ id: 11 }, "ok")).toEqual({
      success: true,
      data: { id: 11 },
      message: "ok",
    });
    expect(service.createErrorResponse("failed")).toEqual({
      success: false,
      error: "failed",
    });
  });
});
