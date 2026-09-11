import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/utils/api-error";
import type { AuthUser } from "../../../middleware/auth";

const mocks = vi.hoisted(() => {
  const user: AuthUser = {
    id: "user-10",
    username: "cashier",
    role: 4,
    restaurantId: "restaurant-1",
  };
  return {
    user,
    receiptService: {
      cancelPrint: vi.fn(),
      getReceiptDetail: vi.fn(),
      getReceipts: vi.fn(),
      printReceipt: vi.fn(),
      reprintReceipt: vi.fn(),
    },
    receiptServiceCtor: vi.fn(),
    tenantAccess: {
      requireReceipt: vi.fn(),
      requireRegister: vi.fn(),
      requireRegisterAndShift: vi.fn(),
    },
    resolveOrderIdentity: vi.fn(),
  };
});

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", mocks.user);
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../services/ReceiptService", () => ({
  ReceiptService: vi.fn(function ReceiptService(...args: unknown[]) {
    mocks.receiptServiceCtor(...args);
    return mocks.receiptService;
  }),
}));

vi.mock("../services/PosTenantAccessService", () => ({
  PosTenantAccessService: vi.fn(function PosTenantAccessService() {
    return mocks.tenantAccess;
  }),
}));

vi.mock("../../../shared/services/order-identity", () => ({
  resolveOrderIdentity: vi.fn((...args: unknown[]) =>
    mocks.resolveOrderIdentity(...args),
  ),
}));

const gateMocks = vi.hoisted(() => ({
  moduleGate: vi.fn(
    (_module: string) => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  ),
  quotaGate: vi.fn(
    (_meterKey: string) => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  ),
  meterEmit: vi.fn(),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: gateMocks.moduleGate,
}));

vi.mock("../../../middleware/quotaGate", () => ({
  quotaGate: gateMocks.quotaGate,
}));

vi.mock("../../../shared/utils/meter", () => ({
  meterEmit: gateMocks.meterEmit,
}));

import routes from "./receipts";

// moduleGate(...)/quotaGate(...) are each called once per route at
// registration (module import time), not per-request — capture the keys now,
// before any vi.clearAllMocks() in beforeEach wipes the call history.
const moduleGateRegistrationKeys = gateMocks.moduleGate.mock.calls.map(
  (call) => call[0],
);
const quotaGateRegistrationKeys = gateMocks.quotaGate.mock.calls.map(
  (call) => call[0],
);

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }

  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function request(path: string, init: RequestInit = {}) {
  return routes.request(path, init, { DB: { binding: "db" } } as never);
}

async function json(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data?: unknown;
    message?: string;
    error?: { code?: string; message?: string; details?: unknown };
  };
}

const receiptId = "550e8400-e29b-41d4-a716-446655440020";
const registerId = "550e8400-e29b-41d4-a716-446655440021";
const shiftId = "550e8400-e29b-41d4-a716-446655440022";
const receipt = {
  id: receiptId,
  orderId: 101,
  registerId,
  receiptType: "customer",
  printStatus: "pending",
};

function printPayload() {
  return {
    orderId: 101,
    templateName: "standard",
    receiptType: "customer",
    copies: 2,
  };
}

describe("POS receipt routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = {
      id: "user-10",
      username: "cashier",
      role: 4,
      restaurantId: "restaurant-1",
    };
    mocks.receiptService.printReceipt.mockResolvedValue({
      success: true,
      data: receipt,
    });
    mocks.receiptService.reprintReceipt.mockResolvedValue({ success: true });
    mocks.receiptService.cancelPrint.mockResolvedValue({ success: true });
    mocks.receiptService.getReceipts.mockResolvedValue({
      success: true,
      data: {
        receipts: [receipt],
        pagination: { page: 2, limit: 5, hasMore: false },
      },
    });
    mocks.receiptService.getReceiptDetail.mockResolvedValue({
      success: true,
      data: receipt,
    });
    mocks.resolveOrderIdentity.mockResolvedValue({
      id: 101,
      publicId: "018f0000-0000-7000-8000-000000000101",
      orderNumber: "ORD-101",
      restaurantId: "restaurant-1",
    });
    mocks.tenantAccess.requireReceipt.mockResolvedValue(undefined);
    mocks.tenantAccess.requireRegister.mockResolvedValue(undefined);
    mocks.tenantAccess.requireRegisterAndShift.mockResolvedValue(undefined);
  });

  it("blocks foreign receipt and register resources before accessing them", async () => {
    mocks.tenantAccess.requireReceipt.mockRejectedValueOnce(
      new ApiError("FORBIDDEN", "只能存取自己餐廳的收據", 403),
    );
    let response = await request(`/${receiptId}`);

    expect(response.status).toBe(403);
    expect(mocks.receiptService.getReceiptDetail).not.toHaveBeenCalled();

    mocks.tenantAccess.requireRegister.mockRejectedValueOnce(
      new ApiError("FORBIDDEN", "只能存取自己餐廳的收銀機", 403),
    );
    response = await request(`/registers/${registerId}/receipts`);

    expect(response.status).toBe(403);
    expect(mocks.receiptService.getReceipts).not.toHaveBeenCalled();
  });

  it("prints receipts with register and shift headers", async () => {
    const payload = printPayload();
    const response = await request("/print", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        "X-Register-Id": registerId,
        "X-Shift-Id": shiftId,
      },
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.receiptServiceCtor).toHaveBeenCalledWith({ binding: "db" });
    expect(mocks.receiptService.printReceipt).toHaveBeenCalledWith(
      payload,
      registerId,
      shiftId,
    );
    expect(mocks.resolveOrderIdentity).toHaveBeenCalledWith(
      { binding: "db" },
      101,
      { restaurantId: "restaurant-1" },
    );
    expect(body).toEqual({
      success: true,
      data: {
        ...receipt,
        orderPublicId: "018f0000-0000-7000-8000-000000000101",
      },
    });
    expect(gateMocks.meterEmit).toHaveBeenCalledWith(
      expect.anything(),
      "print.jobs",
    );
  });

  it("wires /print and /reprint to receipt_printing + print.jobs quota, not pos", () => {
    // These routes sit under the app-factory blanket moduleGate("pos") for
    // all of /pos/*, but printing specifically must ALSO require
    // "receipt_printing" so an admin can disable printing via a
    // moduleOverride without disabling the whole POS terminal (see
    // module-gate.test.ts for the real, unmocked-gate proof).
    expect(moduleGateRegistrationKeys).toContain("receipt_printing");
    expect(
      moduleGateRegistrationKeys.filter((key) => key === "receipt_printing")
        .length,
    ).toBe(2); // POST /print and POST /:receiptId/reprint
    expect(quotaGateRegistrationKeys).toContain("print.jobs");
  });

  it("prints receipts for public order ids after route-level resolution", async () => {
    const response = await request("/print", {
      method: "POST",
      body: JSON.stringify({
        ...printPayload(),
        orderId: "018f0000-0000-7000-8000-000000000101",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Register-Id": registerId,
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.resolveOrderIdentity).toHaveBeenCalledWith(
      { binding: "db" },
      "018f0000-0000-7000-8000-000000000101",
      { restaurantId: "restaurant-1" },
    );
    expect(mocks.receiptService.printReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 101 }),
      registerId,
      undefined,
    );
  });

  it("rejects print requests without a register header and maps print failures", async () => {
    let response = await request("/print", {
      method: "POST",
      body: JSON.stringify(printPayload()),
      headers: { "Content-Type": "application/json" },
    });
    let body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
    expect(mocks.receiptService.printReceipt).not.toHaveBeenCalled();

    mocks.receiptService.printReceipt.mockResolvedValueOnce({
      success: false,
      error: "order not found",
    });
    response = await request("/print", {
      method: "POST",
      body: JSON.stringify(printPayload()),
      headers: {
        "Content-Type": "application/json",
        "X-Register-Id": registerId,
      },
    });
    body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.message).toBe("order not found");
  });

  it("reprints and cancels receipts", async () => {
    let response = await request(`/${receiptId}/reprint`, {
      method: "POST",
    });
    let body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.receiptService.reprintReceipt).toHaveBeenCalledWith(receiptId);
    expect(body.success).toBe(true);
    expect(gateMocks.meterEmit).toHaveBeenCalledWith(
      expect.anything(),
      "print.jobs",
    );

    response = await request(`/${receiptId}/cancel`, { method: "POST" });
    body = await json(response);
    expect(response.status).toBe(200);
    expect(mocks.receiptService.cancelPrint).toHaveBeenCalledWith(receiptId);
    expect(body.success).toBe(true);
  });

  it("maps reprint missing receipts to not found and cancel failures to bad requests", async () => {
    mocks.receiptService.reprintReceipt.mockResolvedValueOnce({
      success: false,
      error: "\u6536\u64da\u4e0d\u5b58\u5728",
    });
    let response = await request(`/${receiptId}/reprint`, {
      method: "POST",
    });
    let body = await json(response);

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("RECEIPT_NOT_FOUND");

    mocks.receiptService.cancelPrint.mockResolvedValueOnce({
      success: false,
      error: "print already completed",
    });
    response = await request(`/${receiptId}/cancel`, { method: "POST" });
    body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.message).toBe("print already completed");
  });

  it("lists receipts with coerced filters and pagination", async () => {
    const response = await request(
      `/registers/${registerId}/receipts?startDate=2026-06-01&endDate=2026-06-07&receiptType=customer&page=2&limit=5`,
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.receiptService.getReceipts).toHaveBeenCalledWith(registerId, {
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      receiptType: "customer",
      page: 2,
      limit: 5,
    });
    expect(body.data).toEqual({
      receipts: [receipt],
      pagination: { page: 2, limit: 5, hasMore: false },
    });
  });

  it("validates receipt list params and maps list service failures", async () => {
    let response = await request("/registers/not-a-uuid/receipts");
    let body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(mocks.receiptService.getReceipts).not.toHaveBeenCalled();

    mocks.receiptService.getReceipts.mockResolvedValueOnce({
      success: false,
      error: "receipt list unavailable",
    });
    response = await request(`/registers/${registerId}/receipts`);
    body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.message).toBe("receipt list unavailable");
  });

  it("returns receipt details and maps missing details to not found", async () => {
    let response = await request(`/${receiptId}`);
    let body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.receiptService.getReceiptDetail).toHaveBeenCalledWith(
      receiptId,
    );
    expect(body).toEqual({ success: true, data: receipt });

    mocks.receiptService.getReceiptDetail.mockResolvedValueOnce({
      success: false,
      error: "\u6536\u64da\u4e0d\u5b58\u5728",
    });
    response = await request(`/${receiptId}`);
    body = await json(response);

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("RECEIPT_NOT_FOUND");
  });
});
