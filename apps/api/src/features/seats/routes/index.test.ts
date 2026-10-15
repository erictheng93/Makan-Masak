import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { Hono } from "hono";
import routesRouter from "./index";
import { handleAppError } from "../../../utils/app-error-handler";
import { batchCreateSeatsSchema } from "../schemas/validation";

// A bare router turns every throw into 500; mount under the real handler.
const routes = new Hono();
routes.onError(handleAppError);
routes.route("/", routesRouter);

const mocks = vi.hoisted(() => ({
  currentUser: {
    id: "user-10",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  } as AuthUser,
  getSeatsByTableId: vi.fn(),
  getSeatStats: vi.fn(),
  getSeatByQRCode: vi.fn(),
  getSeatById: vi.fn(),
  createSeatsForTable: vi.fn(),
  batchGenerateSeatQRCodes: vi.fn(),
  updateSeat: vi.fn(),
  deleteSeat: vi.fn(),
  deleteSeatsForTable: vi.fn(),
  occupySeat: vi.fn(),
  releaseSeat: vi.fn(),
  regenerateSeatQRCode: vi.fn(),
  getTableById: vi.fn(),
  validateRestaurantAccess: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", mocks.currentUser);
    await next();
  }),
  requireRole: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock("@makanmasak/database", () => ({
  USER_ROLES: {
    ADMIN: 0,
    OWNER: 1,
    CHEF: 2,
    SERVICE: 3,
    CASHIER: 4,
  },
  SeatService: vi.fn(function SeatService() {
    return {
      getSeatsByTableId: mocks.getSeatsByTableId,
      getSeatStats: mocks.getSeatStats,
      getSeatByQRCode: mocks.getSeatByQRCode,
      getSeatById: mocks.getSeatById,
      createSeatsForTable: mocks.createSeatsForTable,
      batchGenerateSeatQRCodes: mocks.batchGenerateSeatQRCodes,
      updateSeat: mocks.updateSeat,
      deleteSeat: mocks.deleteSeat,
      deleteSeatsForTable: mocks.deleteSeatsForTable,
      occupySeat: mocks.occupySeat,
      releaseSeat: mocks.releaseSeat,
      regenerateSeatQRCode: mocks.regenerateSeatQRCode,
    };
  }),
}));

vi.mock("../../tables/services/TablesService", () => ({
  TablesService: vi.fn(function TablesService() {
    return {
      getTableById: mocks.getTableById,
      validateRestaurantAccess: mocks.validateRestaurantAccess,
    };
  }),
}));

function createEnv() {
  return { DB: {} };
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seat(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    tableId: 3,
    tableNumber: "A1",
    restaurantId: "restaurant-1",
    restaurantName: "Makan",
    seatNumber: "1",
    seatName: "Window",
    isActive: true,
    isOccupied: false,
    capacity: 1,
    qrCode: "secret-qr",
    internalNotes: "private",
    ...overrides,
  };
}

async function withSilencedRouteError<T>(
  action: () => T | Promise<T>,
): Promise<Awaited<T>> {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    return await action();
  } finally {
    consoleError.mockRestore();
  }
}

describe("seats routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = {
      id: "user-10",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
    mocks.getTableById.mockResolvedValue({
      id: 3,
      restaurantId: "restaurant-1",
      capacity: 4,
    });
    mocks.validateRestaurantAccess.mockReturnValue(true);
    mocks.getSeatsByTableId.mockResolvedValue({
      seats: [],
      total: 0,
      pagination: { page: 1, limit: 50, totalPages: 0 },
    });
  });

  it("lists seats and returns table statistics after table access checks", async () => {
    mocks.getSeatsByTableId.mockResolvedValue({
      seats: [seat()],
      total: 1,
      pagination: { page: 2, limit: 5, totalPages: 1 },
    });
    mocks.getSeatStats.mockResolvedValue({ total: 4, occupied: 1 });
    const env = createEnv();

    const listResponse = await routes.fetch(
      new Request("https://test/?tableId=3&page=2&limit=5&isOccupied=false"),
      env as never,
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: 7, seatName: "Window" }],
      total: 1,
    });
    expect(mocks.getSeatsByTableId).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        tableId: 3,
        page: 2,
        limit: 5,
        isOccupied: false,
      }),
    );

    const statsResponse = await routes.fetch(
      new Request("https://test/stats?tableId=3"),
      env as never,
    );

    expect(statsResponse.status).toBe(200);
    await expect(statsResponse.json()).resolves.toMatchObject({
      data: { total: 4, occupied: 1 },
    });
    expect(mocks.getSeatStats).toHaveBeenCalledWith(3);
  });

  it("allows admins through table access without ownership comparison", async () => {
    mocks.currentUser.role = 0;
    mocks.getSeatsByTableId.mockResolvedValue({
      seats: [],
      total: 0,
      pagination: { page: 1, limit: 50, totalPages: 0 },
    });

    const response = await routes.fetch(
      new Request("https://test/?tableId=3"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.getTableById).toHaveBeenCalledWith(3);
    expect(mocks.validateRestaurantAccess).not.toHaveBeenCalled();
  });

  it("blocks table-scoped access when the table is missing or cross-restaurant", async () => {
    mocks.getTableById.mockResolvedValueOnce(null);
    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/?tableId=404"),
        createEnv() as never,
      ),
    );

    expect(missingResponse.status).toBe(404);
    expect(mocks.getSeatsByTableId).not.toHaveBeenCalled();

    mocks.getTableById.mockResolvedValueOnce({
      id: 3,
      restaurantId: "restaurant-2",
    });
    mocks.validateRestaurantAccess.mockReturnValueOnce(false);
    const forbiddenResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/stats?tableId=3"),
        createEnv() as never,
      ),
    );

    expect(forbiddenResponse.status).toBe(403);
    expect(mocks.getSeatStats).not.toHaveBeenCalled();
  });

  it("returns public QR seat information without private fields", async () => {
    mocks.getSeatByQRCode.mockResolvedValue(seat());

    const response = await routes.fetch(
      new Request("https://test/qr/seat%2Fencoded"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    // `Response.json()` resolves to `unknown`; the two `not.toHaveProperty`
    // assertions below reach into `body.data`, so the envelope shape has to be
    // stated here.
    const body = (await response.json()) as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      success: true,
      data: {
        id: 7,
        tableId: 3,
        restaurantId: "restaurant-1",
        seatName: "Window",
      },
    });
    expect(body.data).not.toHaveProperty("qrCode");
    expect(body.data).not.toHaveProperty("internalNotes");
    expect(mocks.getSeatByQRCode).toHaveBeenCalledWith("seat/encoded");
  });

  it("returns a route error for missing public QR seats", async () => {
    mocks.getSeatByQRCode.mockResolvedValue(null);

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/qr/missing"),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(404);
  });

  it("reads a seat after seat-level access checks", async () => {
    mocks.getSeatById.mockResolvedValue(seat());

    const response = await routes.fetch(
      new Request("https://test/7"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: 7, restaurantId: "restaurant-1" },
    });
    expect(mocks.getSeatById).toHaveBeenCalledWith(7);
  });

  it("returns route errors for missing and cross-restaurant seats", async () => {
    mocks.getSeatById.mockResolvedValueOnce(null);
    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(new Request("https://test/99"), createEnv() as never),
    );

    expect(missingResponse.status).toBe(404);

    mocks.getSeatById.mockResolvedValueOnce(seat({ restaurantId: "other" }));
    const forbiddenResponse = await withSilencedRouteError(() =>
      routes.fetch(new Request("https://test/7"), createEnv() as never),
    );

    expect(forbiddenResponse.status).toBe(403);
  });

  it("batch creates seats and regenerates table QR codes", async () => {
    mocks.createSeatsForTable.mockResolvedValue([seat(), seat({ id: 8 })]);
    mocks.batchGenerateSeatQRCodes.mockResolvedValue({
      success: true,
      qrCodes: [{ seatId: 7, qrCode: "qr-7" }],
    });
    const env = createEnv();

    const createResponse = await routes.fetch(
      jsonRequest("https://test/batch-create", "POST", {
        tableId: 3,
        seatCount: 2,
        numberingStyle: "alphabetic",
        prefix: "A",
      }),
      env as never,
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      success: true,
      message: "Successfully created 2 seats",
    });
    expect(mocks.createSeatsForTable).toHaveBeenCalledWith(3, 2, {
      numberingStyle: "alphabetic",
      customNumbers: undefined,
      prefix: "A",
    });

    const qrResponse = await routes.fetch(
      jsonRequest("https://test/batch-regenerate-qr", "POST", {
        tableId: 3,
      }),
      env as never,
    );

    expect(qrResponse.status).toBe(200);
    await expect(qrResponse.json()).resolves.toMatchObject({
      data: [{ seatId: 7, qrCode: "qr-7" }],
      message: "Successfully regenerated QR codes for 1 seats",
    });
    expect(mocks.batchGenerateSeatQRCodes).toHaveBeenCalledWith(3);
  });

  it("rejects batch-created seats that exceed table capacity", async () => {
    mocks.getTableById.mockResolvedValueOnce({
      id: 3,
      restaurantId: "restaurant-1",
      capacity: 4,
    });
    mocks.getSeatsByTableId.mockResolvedValueOnce({
      seats: [seat({ id: 1 }), seat({ id: 2 }), seat({ id: 3 })],
      total: 3,
      pagination: { page: 1, limit: 4, totalPages: 1 },
    });

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("https://test/batch-create", "POST", {
          tableId: 3,
          seatCount: 2,
          numberingStyle: "numeric",
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.createSeatsForTable).not.toHaveBeenCalled();
  });

  it("rejects custom numbering without one unique number per seat", async () => {
    const missingNumbers = batchCreateSeatsSchema.safeParse({
      tableId: 3,
      seatCount: 2,
      numberingStyle: "custom",
    });
    const duplicateNumbers = batchCreateSeatsSchema.safeParse({
      tableId: 3,
      seatCount: 2,
      numberingStyle: "custom",
      customNumbers: ["Window", "Window"],
    });

    expect(missingNumbers.success).toBe(false);
    expect(duplicateNumbers.success).toBe(false);
    if (!missingNumbers.success) {
      expect(missingNumbers.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["customNumbers"],
          message: "Provide one custom number per seat",
        }),
      );
    }
    if (!duplicateNumbers.success) {
      expect(duplicateNumbers.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["customNumbers"],
          message: "Custom seat numbers must be unique",
        }),
      );
    }
    expect(mocks.createSeatsForTable).not.toHaveBeenCalled();
  });

  it("returns route errors for batch QR generation failures", async () => {
    mocks.batchGenerateSeatQRCodes.mockResolvedValue({
      success: false,
      error: "QR backend unavailable",
    });

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("https://test/batch-regenerate-qr", "POST", {
          tableId: 3,
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(400);
  });

  it("updates and deletes seats after access checks", async () => {
    mocks.getSeatById.mockResolvedValue(seat());
    mocks.updateSeat.mockResolvedValue(seat({ seatName: "Updated" }));
    mocks.deleteSeat.mockResolvedValue(true);
    const env = createEnv();

    const updateResponse = await routes.fetch(
      jsonRequest("https://test/7", "PUT", { seatName: "Updated" }),
      env as never,
    );

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: { seatName: "Updated" },
      message: "Seat updated successfully",
    });
    expect(mocks.updateSeat).toHaveBeenCalledWith(7, {
      seatName: "Updated",
    });

    const deleteResponse = await routes.fetch(
      new Request("https://test/7", { method: "DELETE" }),
      env as never,
    );

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      message: "Seat deleted successfully",
    });
    expect(mocks.deleteSeat).toHaveBeenCalledWith(7);
  });

  it("returns route errors when seat or table deletion fails", async () => {
    mocks.getSeatById.mockResolvedValue(seat());
    mocks.deleteSeat.mockResolvedValue(false);
    const seatResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/7", { method: "DELETE" }),
        createEnv() as never,
      ),
    );

    expect(seatResponse.status).toBe(400);

    mocks.deleteSeatsForTable.mockResolvedValue(false);
    const tableResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/table/3", { method: "DELETE" }),
        createEnv() as never,
      ),
    );

    expect(tableResponse.status).toBe(400);
  });

  it("deletes all seats for a table", async () => {
    mocks.deleteSeatsForTable.mockResolvedValue(true);

    const response = await routes.fetch(
      new Request("https://test/table/3", { method: "DELETE" }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "All seats for the table deleted successfully",
    });
    expect(mocks.deleteSeatsForTable).toHaveBeenCalledWith(3);
  });

  it("occupies and releases seats", async () => {
    mocks.getSeatById.mockResolvedValue(seat());
    mocks.occupySeat.mockResolvedValue(true);
    mocks.releaseSeat.mockResolvedValue(true);
    const env = createEnv();

    const occupyResponse = await routes.fetch(
      jsonRequest("https://test/7/occupy", "POST", {
        orderId: "42",
        occupiedBy: "service",
      }),
      env as never,
    );

    expect(occupyResponse.status).toBe(200);
    await expect(occupyResponse.json()).resolves.toMatchObject({
      message: "Seat occupied successfully",
    });
    expect(mocks.occupySeat).toHaveBeenCalledWith(7, "42", "service");

    const releaseResponse = await routes.fetch(
      new Request("https://test/7/release", { method: "POST" }),
      env as never,
    );

    expect(releaseResponse.status).toBe(200);
    await expect(releaseResponse.json()).resolves.toMatchObject({
      message: "Seat released successfully",
    });
    expect(mocks.releaseSeat).toHaveBeenCalledWith(7);
  });

  it("returns route errors for invalid occupy and release workflows", async () => {
    mocks.getSeatById.mockResolvedValueOnce(seat({ isOccupied: true }));
    mocks.occupySeat.mockResolvedValueOnce(false);
    const occupiedResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("https://test/7/occupy", "POST", { orderId: "42" }),
        createEnv() as never,
      ),
    );
    expect(occupiedResponse.status).toBe(400);
    expect(mocks.occupySeat).toHaveBeenCalledWith(7, "42", undefined);

    mocks.getSeatById.mockResolvedValue(seat());
    mocks.occupySeat.mockResolvedValue(false);
    const occupyResponse = await withSilencedRouteError(() =>
      routes.fetch(
        jsonRequest("https://test/7/occupy", "POST", { orderId: "42" }),
        createEnv() as never,
      ),
    );
    expect(occupyResponse.status).toBe(400);

    mocks.releaseSeat.mockResolvedValue(false);
    const releaseResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/7/release", { method: "POST" }),
        createEnv() as never,
      ),
    );
    expect(releaseResponse.status).toBe(400);
  });

  it("regenerates one seat QR code and reports generation failures", async () => {
    mocks.getSeatById.mockResolvedValue(seat());
    mocks.regenerateSeatQRCode
      .mockResolvedValueOnce({ success: true, qrCode: "qr-new" })
      .mockResolvedValueOnce({ success: false, error: "QR unavailable" });

    const successResponse = await routes.fetch(
      new Request("https://test/7/regenerate-qr", { method: "POST" }),
      createEnv() as never,
    );

    expect(successResponse.status).toBe(200);
    await expect(successResponse.json()).resolves.toMatchObject({
      data: { qrCode: "qr-new" },
      message: "Seat QR code regenerated successfully",
    });
    expect(mocks.regenerateSeatQRCode).toHaveBeenCalledWith(7);

    const failureResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/7/regenerate-qr", { method: "POST" }),
        createEnv() as never,
      ),
    );
    expect(failureResponse.status).toBe(400);
  });
});
