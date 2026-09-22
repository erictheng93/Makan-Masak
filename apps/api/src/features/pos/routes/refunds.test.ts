import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";

const mocks = vi.hoisted(() => ({
  user: {
    id: "user-10",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  } as AuthUser,
  refundService: {
    approveRefund: vi.fn(),
    cancelRefund: vi.fn(),
    getRefundDetail: vi.fn(),
    getRefunds: vi.fn(),
    processRefund: vi.fn(),
    rejectRefund: vi.fn(),
  },
  refundServiceCtor: vi.fn(),
  tenantAccess: {
    requireRefund: vi.fn(),
    requireRegister: vi.fn(),
    requireRegisterAndShift: vi.fn(),
  },
  resolveOrderIdentity: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", mocks.user);
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../services/RefundService", () => ({
  RefundService: vi.fn(function RefundService(...args: unknown[]) {
    mocks.refundServiceCtor(...args);
    return mocks.refundService;
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

import routes from "./refunds";

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

function request(
  path: string,
  init: RequestInit = {},
  env: Record<string, unknown> = {},
) {
  return routes.request(path, init, { DB: { binding: "db" }, ...env } as never);
}

async function json(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data?: unknown;
    message?: string;
    error?: { code?: string; message?: string; details?: unknown };
  };
}

const refundId = "550e8400-e29b-41d4-a716-446655440010";
const registerId = "550e8400-e29b-41d4-a716-446655440011";
const shiftId = "550e8400-e29b-41d4-a716-446655440012";
const refund = {
  id: refundId,
  originalOrderId: 101,
  registerId,
  status: "processing",
  refundAmount: 25,
};

function refundPayload() {
  return {
    originalOrderId: 101,
    refundType: "partial",
    refundAmount: 25,
    refundMethod: "cash",
    reasonCode: "customer_request",
    reasonDescription: "Changed mind",
    itemsRefunded: [{ itemId: 1, quantity: 1 }],
    customerSignature: "signed",
  };
}

describe("POS refund routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = {
      id: "user-10",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
    mocks.refundService.processRefund.mockResolvedValue({
      success: true,
      data: { ...refund, refundId, ledgerMutation: true },
    });
    mocks.refundService.getRefunds.mockResolvedValue({
      success: true,
      data: {
        refunds: [refund],
        pagination: { page: 2, limit: 5, hasMore: false },
      },
    });
    mocks.refundService.getRefundDetail.mockResolvedValue({
      success: true,
      data: refund,
    });
    mocks.refundService.approveRefund.mockResolvedValue({ success: true });
    mocks.refundService.rejectRefund.mockResolvedValue({ success: true });
    mocks.refundService.cancelRefund.mockResolvedValue({ success: true });
    mocks.resolveOrderIdentity.mockResolvedValue({
      id: 101,
      publicId: "018f0000-0000-7000-8000-000000000101",
      orderNumber: "ORD-101",
      restaurantId: "restaurant-1",
    });
    mocks.tenantAccess.requireRefund.mockResolvedValue(undefined);
    mocks.tenantAccess.requireRegister.mockResolvedValue(undefined);
    mocks.tenantAccess.requireRegisterAndShift.mockResolvedValue(undefined);
  });

  it("blocks foreign and inconsistent refund ledger identifiers", async () => {
    mocks.tenantAccess.requireRegisterAndShift.mockRejectedValueOnce(
      new ApiError("FORBIDDEN", "班次與收銀機不相符", 403),
    );
    let response = await request("/create", {
      method: "POST",
      body: JSON.stringify(refundPayload()),
      headers: {
        "Content-Type": "application/json",
        "X-Register-Id": registerId,
        "X-Shift-Id": shiftId,
      },
    });

    expect(response.status).toBe(403);
    expect(mocks.refundService.processRefund).not.toHaveBeenCalled();
    expect(mocks.resolveOrderIdentity).not.toHaveBeenCalled();

    mocks.tenantAccess.requireRefund.mockRejectedValueOnce(
      new ApiError("FORBIDDEN", "只能存取自己餐廳的退款", 403),
    );
    response = await request(`/${refundId}`);

    expect(response.status).toBe(403);
    expect(mocks.refundService.getRefundDetail).not.toHaveBeenCalled();
  });

  it("creates refunds with register and shift headers", async () => {
    const payload = refundPayload();
    const response = await request("/create", {
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
    expect(mocks.refundServiceCtor).toHaveBeenCalledWith(
      { binding: "db" },
      expect.objectContaining({ alertSink: undefined }),
    );
    expect(mocks.refundService.processRefund).toHaveBeenCalledWith(
      payload,
      registerId,
      "user-10",
      shiftId,
      { requireApproval: false },
    );
    expect(mocks.resolveOrderIdentity).toHaveBeenCalledWith(
      { binding: "db" },
      101,
      { restaurantId: "restaurant-1" },
    );
    expect(body).toEqual({
      success: true,
      data: {
        ...refund,
        refundId,
        ledgerMutation: true,
        orderPublicId: "018f0000-0000-7000-8000-000000000101",
      },
    });
  });

  it("allows a cashier to create a refund for their restaurant", async () => {
    mocks.user = {
      id: "cashier-10",
      username: "cashier",
      role: 4,
      restaurantId: "restaurant-1",
    };

    const response = await request("/create", {
      method: "POST",
      body: JSON.stringify(refundPayload()),
      headers: {
        "Content-Type": "application/json",
        "X-Register-Id": registerId,
        "X-Shift-Id": shiftId,
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.refundService.processRefund).toHaveBeenCalledWith(
      expect.any(Object),
      registerId,
      "cashier-10",
      shiftId,
      { requireApproval: true },
    );
  });

  it("creates refunds for public order ids after route-level resolution", async () => {
    const response = await request("/create", {
      method: "POST",
      body: JSON.stringify({
        ...refundPayload(),
        originalOrderId: "018f0000-0000-7000-8000-000000000101",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Register-Id": registerId,
        "X-Shift-Id": shiftId,
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.resolveOrderIdentity).toHaveBeenCalledWith(
      { binding: "db" },
      "018f0000-0000-7000-8000-000000000101",
      { restaurantId: "restaurant-1" },
    );
    expect(mocks.refundService.processRefund).toHaveBeenCalledWith(
      expect.objectContaining({ originalOrderId: 101 }),
      registerId,
      "user-10",
      shiftId,
      { requireApproval: false },
    );
  });

  it("passes a Slack-backed alert sink to the refund service when configured", async () => {
    const response = await request(
      "/create",
      {
        method: "POST",
        body: JSON.stringify(refundPayload()),
        headers: {
          "Content-Type": "application/json",
          "X-Register-Id": registerId,
          "X-Shift-Id": shiftId,
        },
      },
      { SLACK_WEBHOOK_URL: "https://hooks.slack.test/services/refunds" },
    );

    expect(response.status).toBe(200);
    expect(mocks.refundServiceCtor).toHaveBeenCalledWith(
      { binding: "db" },
      expect.objectContaining({ alertSink: expect.any(Function) }),
    );
  });

  /**
   * 這兩個識別碼走 header，不經過 validateBody / validateParams，格式先前沒有
   * 任何一層擋——任意字串會直接進服務層查詢，並被寫進 refunds.register_id。
   */
  it("rejects malformed register and shift headers before touching the service", async () => {
    let response = await request("/create", {
      method: "POST",
      body: JSON.stringify(refundPayload()),
      headers: {
        "Content-Type": "application/json",
        "X-Register-Id": "register-1",
        "X-Shift-Id": shiftId,
      },
    });
    let body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
    expect(mocks.tenantAccess.requireRegisterAndShift).not.toHaveBeenCalled();
    expect(mocks.refundService.processRefund).not.toHaveBeenCalled();

    response = await request("/create", {
      method: "POST",
      body: JSON.stringify(refundPayload()),
      headers: {
        "Content-Type": "application/json",
        "X-Register-Id": registerId,
        "X-Shift-Id": "shift-1",
      },
    });
    body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
    expect(mocks.tenantAccess.requireRegisterAndShift).not.toHaveBeenCalled();
    expect(mocks.refundService.processRefund).not.toHaveBeenCalled();
  });

  it("rejects create requests without a register header and maps service errors", async () => {
    let response = await request("/create", {
      method: "POST",
      body: JSON.stringify(refundPayload()),
      headers: { "Content-Type": "application/json" },
    });
    let body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
    expect(mocks.refundService.processRefund).not.toHaveBeenCalled();

    mocks.refundService.processRefund.mockResolvedValueOnce({
      success: false,
      error: "refund exceeds remaining order balance",
    });
    response = await request("/create", {
      method: "POST",
      body: JSON.stringify(refundPayload()),
      headers: {
        "Content-Type": "application/json",
        "X-Register-Id": registerId,
        "X-Shift-Id": shiftId,
      },
    });
    body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.message).toBe("refund exceeds remaining order balance");
  });

  it("lists refunds with coerced filters and pagination", async () => {
    const response = await request(
      `/registers/${registerId}/refunds?startDate=2026-06-01&endDate=2026-06-07&status=completed&orderId=101&page=2&limit=5`,
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.refundService.getRefunds).toHaveBeenCalledWith(registerId, {
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      status: "completed",
      orderId: "101",
      page: 2,
      limit: 5,
    });
    expect(body.data).toEqual({
      refunds: [refund],
      pagination: { page: 2, limit: 5, hasMore: false },
    });
  });

  it("validates refund list params and maps list service failures", async () => {
    let response = await request("/registers/not-a-uuid/refunds");
    let body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(mocks.refundService.getRefunds).not.toHaveBeenCalled();

    mocks.refundService.getRefunds.mockResolvedValueOnce({
      success: false,
      error: "refund list unavailable",
    });
    response = await request(`/registers/${registerId}/refunds`);
    body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.message).toBe("refund list unavailable");
  });

  it("returns refund details and maps missing details to not found", async () => {
    let response = await request(`/${refundId}`);
    let body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.refundService.getRefundDetail).toHaveBeenCalledWith(refundId);
    expect(body).toEqual({ success: true, data: refund });

    mocks.refundService.getRefundDetail.mockResolvedValueOnce({
      success: false,
      error: "\u9000\u6b3e\u8a18\u9304\u4e0d\u5b58\u5728",
    });
    response = await request(`/${refundId}`);
    body = await json(response);

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("REFUND_NOT_FOUND");
  });

  it("approves, rejects, and cancels refunds", async () => {
    let response = await request(`/${refundId}/approve`, { method: "POST" });
    let body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.refundService.approveRefund).toHaveBeenCalledWith(
      refundId,
      "user-10",
    );
    expect(body.success).toBe(true);

    response = await request(`/${refundId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: "not eligible" }),
      headers: { "Content-Type": "application/json" },
    });
    body = await json(response);
    expect(response.status).toBe(200);
    expect(mocks.refundService.rejectRefund).toHaveBeenCalledWith(
      refundId,
      "user-10",
      "not eligible",
    );
    expect(body.success).toBe(true);

    response = await request(`/${refundId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "duplicate" }),
      headers: { "Content-Type": "application/json" },
    });
    body = await json(response);
    expect(response.status).toBe(200);
    expect(mocks.refundService.cancelRefund).toHaveBeenCalledWith(
      refundId,
      "user-10",
      "duplicate",
    );
    expect(body.success).toBe(true);
  });

  it("maps refund action service failures to bad requests", async () => {
    mocks.refundService.approveRefund.mockResolvedValueOnce({
      success: false,
      error: "cannot approve refund",
    });
    let response = await request(`/${refundId}/approve`, { method: "POST" });
    let body = await json(response);
    expect(response.status).toBe(400);
    expect(body.error?.message).toBe("cannot approve refund");

    mocks.refundService.rejectRefund.mockResolvedValueOnce({
      success: false,
      error: "cannot reject refund",
    });
    response = await request(`/${refundId}/reject`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    body = await json(response);
    expect(response.status).toBe(400);
    expect(body.error?.message).toBe("cannot reject refund");

    mocks.refundService.cancelRefund.mockResolvedValueOnce({
      success: false,
      error: "cannot cancel refund",
    });
    response = await request(`/${refundId}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    body = await json(response);
    expect(response.status).toBe(400);
    expect(body.error?.message).toBe("cannot cancel refund");
  });
});
