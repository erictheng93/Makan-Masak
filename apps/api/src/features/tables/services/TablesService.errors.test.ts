import { afterEach, describe, expect, it, vi } from "vitest";
import { TablesService } from "./TablesService";

const methods = vi.hoisted(() => ({
  getRestaurantTables: vi.fn(),
  getTableById: vi.fn(),
  createTable: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
  occupyTable: vi.fn(),
  releaseTable: vi.fn(),
  markTableCleaned: vi.fn(),
  regenerateQRCode: vi.fn(),
  prepareQRCodeRotation: vi.fn(),
  activateQRCodeRotation: vi.fn(),
  discardQRCodeRotation: vi.fn(),
  generateBulkQRCodes: vi.fn(),
  getAvailableTables: vi.fn(),
  getTableStats: vi.fn(),
  getTableByQRCode: vi.fn(),
}));

vi.mock("@makanmasak/database", () => ({
  TableService: vi.fn(function TableService() {
    return methods;
  }),
}));

vi.mock("../../qr-codes/services/SignedQrVerificationService", () => ({
  SignedQrVerificationService: vi.fn(function () {
    return { verifyTable: vi.fn() };
  }),
}));

function createService() {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  return new TablesService({ DB: {}, CACHE_KV: {} } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of Object.values(methods)) fn.mockReset();
});

describe("TablesService delegates and passes success through", () => {
  it("forwards occupy/release/clean/delete to the table service", async () => {
    const service = createService();
    for (const fn of [
      methods.deleteTable,
      methods.occupyTable,
      methods.releaseTable,
      methods.markTableCleaned,
    ]) {
      fn.mockResolvedValue(true);
    }

    await expect(service.deleteTable(1)).resolves.toBe(true);
    await expect(service.occupyTable(1, "order-1", "Ann", 45)).resolves.toBe(
      true,
    );
    await expect(service.releaseTable(1)).resolves.toBe(true);
    await expect(service.markTableCleaned(1, "wiped")).resolves.toBe(true);

    expect(methods.occupyTable).toHaveBeenCalledWith(1, "order-1", "Ann", 45);
    expect(methods.markTableCleaned).toHaveBeenCalledWith(1, "wiped");
  });
});

describe("TablesService failure wrapping", () => {
  it.each([
    [
      "deleteTable",
      "Failed to delete table",
      (s: TablesService) => s.deleteTable(1),
    ],
    [
      "occupyTable",
      "Failed to occupy table",
      (s: TablesService) => s.occupyTable(1, null),
    ],
    [
      "releaseTable",
      "Failed to release table",
      (s: TablesService) => s.releaseTable(1),
    ],
    [
      "markTableCleaned",
      "Failed to mark table as cleaned",
      (s: TablesService) => s.markTableCleaned(1),
    ],
    [
      "getAvailableTables",
      "Failed to fetch available tables",
      (s: TablesService) => s.getAvailableTables("rest-1", 2),
    ],
    [
      "getTableStats",
      "Failed to fetch table statistics",
      (s: TablesService) => s.getTableStats("rest-1"),
    ],
    [
      "getTableByQRCode",
      "Failed to fetch table by QR code",
      (s: TablesService) => s.getTableByQRCode("code"),
    ],
  ])("%s rethrows with context and the cause", async (name, prefix, call) => {
    const service = createService();
    (methods as Record<string, ReturnType<typeof vi.fn>>)[
      name
    ].mockRejectedValue(new Error("db down"));

    await expect(call(service)).rejects.toThrow(`${prefix}: db down`);
  });

  it("includes a non-Error rejection in the message", async () => {
    const service = createService();
    methods.releaseTable.mockRejectedValue("plain string");
    await expect(service.releaseTable(1)).rejects.toThrow(
      "Failed to release table: plain string",
    );
  });

  it.each([
    [
      "regenerateQRCode",
      "Failed to regenerate QR code",
      (s: TablesService) => s.regenerateQRCode(1),
    ],
    [
      "prepareQRCodeRotation",
      "Failed to prepare QR code rotation",
      (s: TablesService) => s.prepareQRCodeRotation(1),
    ],
    [
      "activateQRCodeRotation",
      "Failed to activate QR code rotation",
      (s: TablesService) => s.activateQRCodeRotation(1),
    ],
    [
      "discardQRCodeRotation",
      "Failed to discard QR code rotation",
      (s: TablesService) => s.discardQRCodeRotation(1),
    ],
    [
      "generateBulkQRCodes",
      "Failed to generate bulk QR codes",
      (s: TablesService) => s.generateBulkQRCodes("rest-1", [1]),
    ],
  ])(
    "%s reports failure as a result instead of throwing",
    async (name, prefix, call) => {
      const service = createService();
      (methods as Record<string, ReturnType<typeof vi.fn>>)[
        name
      ].mockRejectedValue(new Error("kv unavailable"));

      await expect(call(service)).resolves.toEqual({
        success: false,
        error: `${prefix}: kv unavailable`,
      });
    },
  );

  it.each([
    "prepareQRCodeRotation",
    "activateQRCodeRotation",
    "discardQRCodeRotation",
  ] as const)(
    "%s returns the table service result on success",
    async (name) => {
      const service = createService();
      methods[name].mockResolvedValue({ success: true });
      await expect(service[name](5)).resolves.toEqual({ success: true });
      expect(methods[name]).toHaveBeenCalledWith(5);
    },
  );
});

describe("TablesService.updateTable conflict mapping", () => {
  it("maps the seat-management guard to a 409 ApiError", async () => {
    const service = createService();
    methods.updateTable.mockRejectedValue(
      new Error("Change the seat count through seat management"),
    );
    await expect(service.updateTable(1, {})).rejects.toMatchObject({
      code: "SEAT_COUNT_VIA_SEAT_MANAGEMENT",
      status: 409,
    });
  });

  it("maps a capacity below the seat count to a 409 ApiError", async () => {
    const service = createService();
    methods.updateTable.mockRejectedValue(
      new Error("Seat count must be positive and cannot exceed table capacity"),
    );
    await expect(service.updateTable(1, {})).rejects.toMatchObject({
      code: "SEAT_COUNT_EXCEEDS_CAPACITY",
      status: 409,
    });
  });

  it("wraps any other failure as a generic error", async () => {
    const service = createService();
    methods.updateTable.mockRejectedValue(new Error("constraint"));
    await expect(service.updateTable(1, {})).rejects.toThrow(
      "Failed to update table: constraint",
    );
  });
});

describe("TablesService.getTableByQRCode", () => {
  it("returns null for an unknown, unsigned code", async () => {
    const service = createService();
    methods.getTableByQRCode.mockResolvedValue(undefined);
    await expect(service.getTableByQRCode("not-a-url")).resolves.toBeNull();
    expect(methods.getTableById).not.toHaveBeenCalled();
  });
});

describe("TablesService.validateRestaurantAccess", () => {
  it("refuses a row with no restaurant id even for a matching-looking caller", () => {
    const service = createService();
    expect(service.validateRestaurantAccess(undefined, "rest-1", false)).toBe(
      false,
    );
    expect(service.validateRestaurantAccess(undefined, "rest-1", true)).toBe(
      true,
    );
  });
});
