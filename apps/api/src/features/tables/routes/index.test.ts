import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";

const auth = vi.hoisted(() => ({
  user: {
    id: "user-7",
    username: "owner",
    role: 1,
    restaurantId: "rest-1",
  } as AuthUser,
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", auth.user);
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("@makanmasak/database", () => ({
  USER_ROLES: {
    ADMIN: 0,
    OWNER: 1,
    CHEF: 2,
    SERVICE: 3,
    CASHIER: 4,
  },
}));

const serviceFns = vi.hoisted(() => ({
  getRestaurantTables: vi.fn(),
  getTableById: vi.fn(),
  validateTableAccess: vi.fn(),
  validateRestaurantAccess: vi.fn(),
  createTable: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
  occupyTable: vi.fn(),
  releaseTable: vi.fn(),
  markTableCleaned: vi.fn(),
  broadcastStatusUpdate: vi.fn(),
  regenerateQRCode: vi.fn(),
  generateBulkQRCodes: vi.fn(),
  getAvailableTables: vi.fn(),
  getTableStats: vi.fn(),
  getTableByQRCode: vi.fn(),
  getPublicTableInfo: vi.fn(),
  resolveOrderIdentity: vi.fn(),
}));

vi.mock("../services/TablesService", () => ({
  TablesService: class {
    getRestaurantTables = serviceFns.getRestaurantTables;
    getTableById = serviceFns.getTableById;
    validateTableAccess = serviceFns.validateTableAccess;
    validateRestaurantAccess = serviceFns.validateRestaurantAccess;
    createTable = serviceFns.createTable;
    updateTable = serviceFns.updateTable;
    deleteTable = serviceFns.deleteTable;
    occupyTable = serviceFns.occupyTable;
    releaseTable = serviceFns.releaseTable;
    markTableCleaned = serviceFns.markTableCleaned;
    broadcastStatusUpdate = serviceFns.broadcastStatusUpdate;
    regenerateQRCode = serviceFns.regenerateQRCode;
    generateBulkQRCodes = serviceFns.generateBulkQRCodes;
    getAvailableTables = serviceFns.getAvailableTables;
    getTableStats = serviceFns.getTableStats;
    getTableByQRCode = serviceFns.getTableByQRCode;
    getPublicTableInfo = serviceFns.getPublicTableInfo;
  },
}));

vi.mock("../../../shared/services/order-identity", () => ({
  resolveOrderIdentity: vi.fn((...args: unknown[]) =>
    serviceFns.resolveOrderIdentity(...args),
  ),
}));

import routes from "./index";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }

  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function request(path: string, method = "GET", body?: unknown) {
  return routes.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
    },
    { DB: {}, CACHE_KV: {} } as never,
  );
}

const table = {
  id: 11,
  restaurantId: "rest-1",
  number: "A1",
  name: "Window",
  capacity: 4,
  isOccupied: false,
};

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    restaurantId: "rest-1",
    number: "A1",
    name: "Window",
    capacity: 4,
    location: "Main room",
    floor: 1,
    section: "A",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = {
    id: "user-7",
    username: "owner",
    role: 1,
    restaurantId: "rest-1",
  };

  serviceFns.getRestaurantTables.mockResolvedValue({
    tables: [table],
    pagination: { page: 2, limit: 5, total: 1 },
  });
  serviceFns.getTableById.mockResolvedValue(table);
  serviceFns.validateTableAccess.mockReturnValue(true);
  serviceFns.validateRestaurantAccess.mockReturnValue(true);
  serviceFns.createTable.mockResolvedValue(table);
  serviceFns.updateTable.mockResolvedValue({ ...table, name: "Updated" });
  serviceFns.deleteTable.mockResolvedValue(true);
  serviceFns.occupyTable.mockResolvedValue(true);
  serviceFns.releaseTable.mockResolvedValue(true);
  serviceFns.markTableCleaned.mockResolvedValue(true);
  serviceFns.regenerateQRCode.mockResolvedValue({
    success: true,
    qrCode: "qr-new",
  });
  serviceFns.generateBulkQRCodes.mockResolvedValue({
    success: true,
    qrCodes: [{ tableId: 11, qrCode: "qr-11" }],
  });
  serviceFns.getAvailableTables.mockResolvedValue([table]);
  serviceFns.getTableStats.mockResolvedValue({ totalTables: 1 });
  serviceFns.getTableByQRCode.mockResolvedValue(table);
  serviceFns.getPublicTableInfo.mockReturnValue({
    id: 11,
    number: "A1",
    capacity: 4,
  });
  serviceFns.resolveOrderIdentity.mockResolvedValue({
    id: 42,
    publicId: "018f0000-0000-7000-8000-000000000042",
    orderNumber: "ORD-42",
    restaurantId: "rest-1",
  });
});

describe("tables routes", () => {
  it("lists tables with admin filters and owner restaurant scoping", async () => {
    auth.user = { id: "user-1", username: "admin", role: 0 };

    let response = await request(
      "/?restaurantId=rest-2&floor=2&isOccupied=false&page=2&limit=5",
    );

    expect(response.status).toBe(200);
    expect(serviceFns.getRestaurantTables).toHaveBeenCalledWith("rest-2", {
      floor: 2,
      isOccupied: false,
      page: 2,
      limit: 5,
    });

    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };
    response = await request("/?restaurantId=rest-2&section=A");

    expect(response.status).toBe(200);
    expect(serviceFns.getRestaurantTables).toHaveBeenLastCalledWith("rest-1", {
      section: "A",
      page: 1,
      limit: 20,
    });

    auth.user = { id: "user-8", username: "owner", role: 1 };
    response = await request("/");
    expect(response.status).toBe(400);
  });

  it("gets table details and rejects missing or unauthorized tables", async () => {
    let response = await request("/11");

    expect(response.status).toBe(200);
    expect(serviceFns.getTableById).toHaveBeenCalledWith(11);

    serviceFns.getTableById.mockResolvedValueOnce(null);
    response = await request("/11");
    expect(response.status).toBe(404);

    serviceFns.validateTableAccess.mockReturnValueOnce(false);
    response = await request("/11");
    expect(response.status).toBe(403);
  });

  it("creates, updates, and deletes tables after access checks", async () => {
    let response = await request("/", "POST", createBody());

    expect(response.status).toBe(201);
    expect(serviceFns.createTable).toHaveBeenCalledWith({
      ...createBody(),
      isReservable: true,
    });

    response = await request("/11", "PUT", { name: "Updated" });
    expect(response.status).toBe(200);
    expect(serviceFns.updateTable).toHaveBeenCalledWith(11, {
      name: "Updated",
    });

    response = await request("/11", "DELETE");
    expect(response.status).toBe(200);
    expect(serviceFns.deleteTable).toHaveBeenCalledWith(11);

    serviceFns.getTableById.mockResolvedValueOnce({
      ...table,
      isOccupied: true,
    });
    response = await request("/11", "DELETE");
    expect(response.status).toBe(400);
    expect(serviceFns.deleteTable).toHaveBeenCalledTimes(1);

    serviceFns.getTableById.mockResolvedValueOnce({
      ...table,
      currentOrderId: "order-1",
    });
    response = await request("/11", "DELETE");
    expect(response.status).toBe(400);
    expect(serviceFns.deleteTable).toHaveBeenCalledTimes(1);

    serviceFns.validateRestaurantAccess.mockReturnValueOnce(false);
    response = await request(
      "/",
      "POST",
      createBody({ restaurantId: "other" }),
    );
    expect(response.status).toBe(403);

    serviceFns.deleteTable.mockResolvedValueOnce(false);
    response = await request("/11", "DELETE");
    expect(response.status).toBe(400);
  });

  it("passes validated seat mode configuration to table creation", async () => {
    const response = await request(
      "/",
      "POST",
      createBody({
        qrMode: "seat",
        seatCount: 4,
        seatNumberingStyle: "alphabetic",
      }),
    );

    expect(response.status).toBe(201);
    expect(serviceFns.createTable).toHaveBeenCalledWith(
      expect.objectContaining({
        qrMode: "seat",
        seatCount: 4,
        seatNumberingStyle: "alphabetic",
      }),
    );
  });

  it("creates table mode tables when the admin UI sends zero seat count", async () => {
    const body = createBody({
      qrMode: "table",
      seatCount: 0,
      seatNumberingStyle: "numeric",
    });

    const response = await request("/", "POST", body);

    expect(response.status).toBe(201);
    expect(serviceFns.createTable).toHaveBeenCalledWith({
      ...body,
      isReservable: true,
    });
  });

  it("rejects zero seat count in seat mode", async () => {
    const response = await request(
      "/",
      "POST",
      createBody({
        qrMode: "seat",
        seatCount: 0,
        seatNumberingStyle: "numeric",
      }),
    );

    expect(response.status).toBe(400);
    expect(serviceFns.createTable).not.toHaveBeenCalled();
  });

  it("rejects inconsistent table and seat capacities", async () => {
    const response = await request(
      "/",
      "POST",
      createBody({
        capacity: 4,
        qrMode: "seat",
        seatCount: 5,
        seatNumberingStyle: "numeric",
      }),
    );

    expect(response.status).toBe(400);
    expect(serviceFns.createTable).not.toHaveBeenCalled();
  });

  it("occupies, releases, and cleans tables with state validation", async () => {
    let response = await request("/11/occupy", "POST", {
      orderId: 42,
      occupiedBy: "Amy",
      estimatedMinutes: 45,
    });

    expect(response.status).toBe(200);
    expect(serviceFns.occupyTable).toHaveBeenCalledWith(11, 42, "Amy", 45);
    expect(serviceFns.broadcastStatusUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 11 }),
      "occupied",
    );
    expect(serviceFns.resolveOrderIdentity).toHaveBeenCalledWith(
      expect.any(Object),
      42,
      { restaurantId: "rest-1" },
    );

    serviceFns.getTableById.mockResolvedValueOnce({
      ...table,
      isOccupied: true,
    });
    serviceFns.occupyTable.mockResolvedValueOnce(false);
    response = await request("/11/occupy", "POST", { orderId: 42 });
    expect(response.status).toBe(400);
    expect(serviceFns.occupyTable).toHaveBeenLastCalledWith(
      11,
      42,
      undefined,
      undefined,
    );

    response = await request("/11/release", "POST");
    expect(response.status).toBe(200);
    expect(serviceFns.releaseTable).toHaveBeenCalledWith(11);
    expect(serviceFns.broadcastStatusUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 11 }),
      "available",
    );

    response = await request("/11/clean", "POST", { notes: "ready" });
    expect(response.status).toBe(200);
    expect(serviceFns.markTableCleaned).toHaveBeenCalledWith(11, "ready");

    serviceFns.broadcastStatusUpdate.mockClear();
    serviceFns.releaseTable.mockResolvedValueOnce(false);
    response = await request("/11/release", "POST");
    expect(response.status).toBe(400);
    expect(serviceFns.broadcastStatusUpdate).not.toHaveBeenCalled();
  });

  it("occupies tables with public order ids", async () => {
    const response = await request("/11/occupy", "POST", {
      orderId: "018f0000-0000-7000-8000-000000000042",
      occupiedBy: "Amy",
    });

    expect(response.status).toBe(200);
    expect(serviceFns.resolveOrderIdentity).toHaveBeenCalledWith(
      expect.any(Object),
      "018f0000-0000-7000-8000-000000000042",
      { restaurantId: "rest-1" },
    );
    expect(serviceFns.occupyTable).toHaveBeenCalledWith(
      11,
      42,
      "Amy",
      undefined,
    );
  });

  it("occupies tables manually without an order id", async () => {
    const response = await request("/11/occupy", "POST", {
      occupiedBy: "manual",
    });

    expect(response.status).toBe(200);
    // No order to resolve — the lookup must be skipped entirely, not called with a placeholder
    expect(serviceFns.resolveOrderIdentity).not.toHaveBeenCalled();
    expect(serviceFns.occupyTable).toHaveBeenCalledWith(
      11,
      null,
      "manual",
      undefined,
    );
  });

  it("rejects a zero order id instead of treating it as absent", async () => {
    const response = await request("/11/occupy", "POST", { orderId: 0 });

    expect(response.status).toBe(400);
    expect(serviceFns.occupyTable).not.toHaveBeenCalled();
  });

  it("regenerates single and bulk QR codes", async () => {
    let response = await request("/11/regenerate-qr", "POST", {
      customData: { campaign: "summer" },
    });

    expect(response.status).toBe(200);
    expect(serviceFns.regenerateQRCode).toHaveBeenCalledWith(11, {
      campaign: "summer",
    });

    serviceFns.regenerateQRCode.mockResolvedValueOnce({
      success: false,
      error: "qr failed",
    });
    response = await request("/11/regenerate-qr", "POST", {});
    expect(response.status).toBe(400);

    response = await request("/bulk-qr", "POST", {
      restaurantId: "rest-1",
      tableIds: [11],
      options: { size: "large", format: "svg", includeTableInfo: true },
    });

    expect(response.status).toBe(200);
    expect(serviceFns.generateBulkQRCodes).toHaveBeenCalledWith(
      "rest-1",
      [11],
      { size: "large", format: "svg", includeTableInfo: true },
    );

    serviceFns.generateBulkQRCodes.mockResolvedValueOnce({
      success: false,
      error: "bulk failed",
    });
    response = await request("/bulk-qr", "POST", {
      restaurantId: "rest-1",
      tableIds: [11],
    });
    expect(response.status).toBe(400);
  });

  it("returns available tables and table stats from static routes", async () => {
    let response = await request("/available?restaurantId=rest-1&capacity=4");

    expect(response.status).toBe(200);
    expect(serviceFns.getAvailableTables).toHaveBeenCalledWith("rest-1", 4);

    response = await request("/stats?restaurantId=rest-1");

    expect(response.status).toBe(200);
    expect(serviceFns.getTableStats).toHaveBeenCalledWith("rest-1");

    serviceFns.validateRestaurantAccess.mockReturnValueOnce(false);
    response = await request("/available?restaurantId=other");
    expect(response.status).toBe(403);
  });

  it("returns public table information by QR code", async () => {
    let response = await request("/qr/qr%2011");

    expect(response.status).toBe(200);
    expect(serviceFns.getTableByQRCode).toHaveBeenCalledWith("qr 11");
    expect(serviceFns.getPublicTableInfo).toHaveBeenCalledWith(table);

    serviceFns.getTableByQRCode.mockResolvedValueOnce(null);
    response = await request("/qr/missing");
    expect(response.status).toBe(404);
  });
});
