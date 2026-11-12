import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";

const auth = vi.hoisted(() => ({
  user: {
    id: "user-7",
    username: "owner",
    role: 1,
    restaurantId: "42",
  } as AuthUser,
}));

const qrServiceFns = vi.hoisted(() => ({
  generateQR: vi.fn(),
  generateBulkQR: vi.fn(),
  downloadQR: vi.fn(),
  downloadBatch: vi.fn(),
  getStatistics: vi.fn(),
  listTemplates: vi.fn(),
  getTemplate: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

const marketServiceFns = vi.hoisted(() => ({
  getMarketBySlug: vi.fn(),
}));

const restaurantServiceFns = vi.hoisted(() => ({
  verifyShopQrCode: vi.fn(),
}));

const signedQrServiceFns = vi.hoisted(() => ({
  verifyTable: vi.fn(),
  verifySeat: vi.fn(),
  verifyTableFromQrCode: vi.fn(),
  verifySeatFromQrCode: vi.fn(),
}));

vi.mock("../../../shared/middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../shared/middleware")>();

  return {
    ...actual,
    authMiddleware: vi.fn(async (c, next) => {
      c.set("user", auth.user);
      await next();
    }),
    requireRole: vi.fn(
      () => async (_c: unknown, next: () => Promise<void>) => next(),
    ),
  };
});

// The per-route limiter counts in the D1 ephemeral store; tests hand it a fake
// through a test-only env field.
vi.mock("../../../shared/utils/ephemeral-store", () => ({
  ephemeralStore: (env: { EPHEMERAL: unknown }) => env.EPHEMERAL,
}));

vi.mock("../services/QrCodesService", () => ({
  QrCodesService: class {
    generateQR = qrServiceFns.generateQR;
    generateBulkQR = qrServiceFns.generateBulkQR;
    downloadQR = qrServiceFns.downloadQR;
    downloadBatch = qrServiceFns.downloadBatch;
    getStatistics = qrServiceFns.getStatistics;
    listTemplates = qrServiceFns.listTemplates;
    getTemplate = qrServiceFns.getTemplate;
    createTemplate = qrServiceFns.createTemplate;
    updateTemplate = qrServiceFns.updateTemplate;
    deleteTemplate = qrServiceFns.deleteTemplate;
  },
}));

vi.mock("../../markets/services/MarketsService", () => ({
  MarketsService: class {
    getMarketBySlug = marketServiceFns.getMarketBySlug;
  },
}));

vi.mock("../../restaurants/services/RestaurantsService", () => ({
  RestaurantsService: class {
    verifyShopQrCode = restaurantServiceFns.verifyShopQrCode;
  },
}));

vi.mock("../services/SignedQrVerificationService", () => ({
  SignedQrVerificationService: class {
    verifyTable = signedQrServiceFns.verifyTable;
    verifySeat = signedQrServiceFns.verifySeat;
    verifyTableFromQrCode = signedQrServiceFns.verifyTableFromQrCode;
    verifySeatFromQrCode = signedQrServiceFns.verifySeatFromQrCode;
  },
}));

const gateMocks = vi.hoisted(() => ({
  // The ModuleKey argument has to be part of the mock's signature: the
  // registration assertion below reads it back out of mock.calls.
  moduleGate: vi.fn(
    (_module: string) => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  ),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: gateMocks.moduleGate,
}));

import routes from "./index";

// Routes call moduleGate(...) exactly once each, at registration time (module
// import), to build their middleware chain — not per-request. beforeEach's
// vi.clearAllMocks() below wipes call history before the first test runs, so
// capture which keys each route registered with right after import.
const moduleGateRegistrationKeys = gateMocks.moduleGate.mock.calls.map(
  (call) => call[0],
);

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }

  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function request(
  path: string,
  method = "GET",
  body?: unknown,
  options: {
    headers?: Record<string, string>;
    rateLimitStore?: {
      get: (key: string, type?: string) => Promise<unknown>;
      put: (
        key: string,
        value: string,
        options?: { expirationTtl?: number },
      ) => Promise<void>;
    };
  } = {},
) {
  return routes.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    },
    { DB: {}, CACHE_KV: {}, EPHEMERAL: options.rateLimitStore } as never,
  );
}

const qrStyle = {
  backgroundColor: "#ffffff",
  foregroundColor: "#111111",
  size: 300,
};

describe("QR code routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "42",
    };
  });

  it("generates single and bulk QR codes with authenticated user context", async () => {
    const qrId = "019469a0-0001-7000-8000-000000000001";
    qrServiceFns.generateQR.mockResolvedValue({
      id: qrId,
      url: "https://cdn.example.test/qr-1.png",
    });
    qrServiceFns.generateBulkQR.mockResolvedValue({
      batchId: "batch-1",
      count: 1,
    });

    const generateResponse = await request("/generate", "POST", {
      content: "https://makan.test/table/1",
      format: "png",
      style: qrStyle,
    });
    const bulkResponse = await request("/bulk", "POST", {
      tables: [{ id: 1, name: "A1", content: "https://makan.test/table/1" }],
      format: "zip",
      includeMetadata: false,
    });

    expect(generateResponse.status).toBe(201);
    await expect(generateResponse.json()).resolves.toMatchObject({
      success: true,
      data: { id: qrId },
      message: "QR code generated successfully",
    });
    expect(qrServiceFns.generateQR).toHaveBeenCalledWith(
      expect.objectContaining({ content: "https://makan.test/table/1" }),
      "user-7",
      "42",
    );
    expect(bulkResponse.status).toBe(201);
    await expect(bulkResponse.json()).resolves.toMatchObject({
      success: true,
      data: { batchId: "batch-1" },
      message: "Bulk QR codes generated successfully",
    });
    expect(qrServiceFns.generateBulkQR).toHaveBeenCalledWith(
      expect.objectContaining({ format: "zip", includeMetadata: false }),
      "user-7",
      "42",
    );
    // /bulk is table-QR generation and must carry the same module gate as
    // tables/routes POST /bulk-qr; /generate is a generic content-based QR
    // utility (also used for market QR) and is deliberately left ungated.
    expect(moduleGateRegistrationKeys).toContain("table_management");
  });

  it("downloads single and batch QR assets and reports missing assets", async () => {
    const qrId = "019469a0-0001-7000-8000-000000000001";
    qrServiceFns.downloadQR.mockResolvedValueOnce({
      data: "png-bytes",
      contentType: "image/png",
      filename: `${qrId}.png`,
      restaurantId: "42",
    });
    qrServiceFns.downloadBatch.mockResolvedValueOnce({
      data: "zip-bytes",
      contentType: "application/zip",
      filename: "batch-1.zip",
      restaurantId: "42",
    });

    const downloadResponse = await request(`/${qrId}/download`);
    const batchResponse = await request("/batch/batch-1/download");
    qrServiceFns.downloadQR.mockResolvedValueOnce(null);
    qrServiceFns.downloadBatch.mockResolvedValueOnce(null);
    const missingDownload = await request("/missing/download");
    const missingBatch = await request("/batch/missing/download");

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("Content-Type")).toBe("image/png");
    expect(downloadResponse.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${qrId}.png"`,
    );
    await expect(downloadResponse.text()).resolves.toBe("png-bytes");
    expect(batchResponse.status).toBe(200);
    expect(batchResponse.headers.get("Content-Type")).toBe("application/zip");
    await expect(batchResponse.text()).resolves.toBe("zip-bytes");
    expect(qrServiceFns.downloadQR).toHaveBeenCalledWith(qrId, {
      userRestaurantId: "42",
      userRole: 1,
    });
    expect(qrServiceFns.downloadBatch).toHaveBeenCalledWith("batch-1", {
      userRestaurantId: "42",
      userRole: 1,
    });
    expect(missingDownload.status).toBe(404);
    await expect(missingDownload.json()).resolves.toMatchObject({
      error: { code: "QR_CODE_NOT_FOUND" },
    });
    expect(missingBatch.status).toBe(404);
    await expect(missingBatch.json()).resolves.toMatchObject({
      error: { code: "BATCH_NOT_FOUND" },
    });
  });

  it("reads statistics and template listings", async () => {
    qrServiceFns.getStatistics.mockResolvedValue({ total: 5 });
    qrServiceFns.listTemplates.mockResolvedValue([{ id: 1, name: "Modern" }]);

    const statsResponse = await request("/stats?restaurantId=99&period=week");
    const listResponse = await request("/templates?category=modern");

    expect(statsResponse.status).toBe(200);
    await expect(statsResponse.json()).resolves.toMatchObject({
      success: true,
      data: { total: 5 },
    });
    expect(qrServiceFns.getStatistics).toHaveBeenCalledWith("42");
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: 1, name: "Modern" }],
    });
    expect(qrServiceFns.listTemplates).toHaveBeenCalledWith("modern");
  });

  it("allows admins to request QR statistics for any restaurant or globally", async () => {
    auth.user = {
      id: "user-1",
      username: "admin",
      role: 0,
      restaurantId: undefined,
    };
    qrServiceFns.getStatistics
      .mockResolvedValueOnce({ total: 9 })
      .mockResolvedValueOnce({ total: 20 });

    const scopedResponse = await request("/stats?restaurantId=99");
    const globalResponse = await request("/stats");

    expect(scopedResponse.status).toBe(200);
    await expect(scopedResponse.json()).resolves.toMatchObject({
      success: true,
      data: { total: 9 },
    });
    expect(globalResponse.status).toBe(200);
    await expect(globalResponse.json()).resolves.toMatchObject({
      success: true,
      data: { total: 20 },
    });
    expect(qrServiceFns.getStatistics).toHaveBeenNthCalledWith(1, "99");
    expect(qrServiceFns.getStatistics).toHaveBeenNthCalledWith(2, undefined);
  });

  it("creates, reads, updates, and deletes templates", async () => {
    qrServiceFns.createTemplate.mockResolvedValue({ id: 1, name: "Modern" });
    qrServiceFns.getTemplate.mockResolvedValueOnce({ id: 1, name: "Modern" });
    qrServiceFns.updateTemplate.mockResolvedValueOnce({
      id: 1,
      name: "Updated",
    });
    qrServiceFns.deleteTemplate.mockResolvedValueOnce(true);

    const createResponse = await request("/templates", "POST", {
      name: "Modern",
      description: "Modern table QR",
      category: "modern",
      style: qrStyle,
    });
    const getResponse = await request("/templates/1");
    const updateResponse = await request("/templates/1", "PUT", {
      name: "Updated",
    });
    const deleteResponse = await request("/templates/1", "DELETE");

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      data: { id: 1, name: "Modern" },
      message: "Template created successfully",
    });
    expect(qrServiceFns.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Modern", createdBy: "user-7" }),
    );
    // 模板寫入必須帶著真實操作者，DB 層才能用 created_by 擋跨租戶改寫
    expect(qrServiceFns.updateTemplate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: "Updated" }),
      expect.objectContaining({ userId: "user-7" }),
    );
    expect(qrServiceFns.deleteTemplate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ userId: "user-7" }),
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      data: { id: 1, name: "Modern" },
    });
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: { id: 1, name: "Updated" },
      message: "Template updated successfully",
    });
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      success: true,
      message: "Template deleted successfully",
    });
  });

  it("reports missing templates on read, update, and delete", async () => {
    qrServiceFns.getTemplate.mockResolvedValueOnce(null);
    qrServiceFns.updateTemplate.mockResolvedValueOnce(null);
    qrServiceFns.deleteTemplate.mockResolvedValueOnce(false);

    const getResponse = await request("/templates/404");
    const updateResponse = await request("/templates/404", "PUT", {
      name: "Missing",
    });
    const deleteResponse = await request("/templates/404", "DELETE");

    expect(getResponse.status).toBe(404);
    await expect(getResponse.json()).resolves.toMatchObject({
      error: { code: "TEMPLATE_NOT_FOUND" },
    });
    expect(updateResponse.status).toBe(404);
    await expect(updateResponse.json()).resolves.toMatchObject({
      error: { code: "TEMPLATE_NOT_FOUND" },
    });
    expect(deleteResponse.status).toBe(404);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      error: { code: "TEMPLATE_NOT_FOUND" },
    });
  });

  it("verifies public market and shop QR codes", async () => {
    marketServiceFns.getMarketBySlug.mockResolvedValueOnce({
      market: { id: "market-1", slug: "fengjia", name: "Fengjia" },
    });
    restaurantServiceFns.verifyShopQrCode.mockResolvedValueOnce({
      valid: true,
      restaurantId: "restaurant-1",
      restaurant: { id: "restaurant-1", name: "Makan" },
    });

    const marketResponse = await request("/verify/market/fengjia");
    const shopResponse = await request("/verify/shop/SHOP-GRANDMA-001");

    expect(marketResponse.status).toBe(200);
    await expect(marketResponse.json()).resolves.toMatchObject({
      data: {
        valid: true,
        marketId: "market-1",
        marketUrl: "/markets/fengjia",
      },
      message: "Market QR code verified successfully",
    });
    expect(shopResponse.status).toBe(200);
    await expect(shopResponse.json()).resolves.toMatchObject({
      data: {
        valid: true,
        restaurantId: "restaurant-1",
        restaurant: { name: "Makan" },
      },
      message: "QR code verified successfully",
    });
  });

  it("rejects invalid public market and shop QR codes", async () => {
    marketServiceFns.getMarketBySlug.mockResolvedValueOnce(null);
    restaurantServiceFns.verifyShopQrCode.mockResolvedValueOnce({
      valid: false,
    });

    const marketResponse = await request("/verify/market/missing");
    const shopResponse = await request("/verify/shop/SHOP-MISSING");

    expect(marketResponse.status).toBe(404);
    await expect(marketResponse.json()).resolves.toMatchObject({
      error: { code: "MARKET_QR_INVALID" },
    });
    expect(shopResponse.status).toBe(404);
    await expect(shopResponse.json()).resolves.toMatchObject({
      error: { code: "QR_CODE_INVALID" },
    });
  });

  it("verifies public table and seat QR codes without authentication", async () => {
    signedQrServiceFns.verifyTable.mockResolvedValueOnce({
      valid: true,
      type: "table",
      restaurantId: "restaurant-1",
      tableId: 10,
      tableNumber: "T1",
      formatVersion: 2,
    });
    signedQrServiceFns.verifySeat.mockResolvedValueOnce({
      valid: true,
      type: "seat",
      restaurantId: "restaurant-1",
      tableId: 10,
      tableNumber: "T1",
      seatId: 21,
      seatNumber: "01",
      formatVersion: 2,
    });
    const qrCode = encodeURIComponent("https://example.test/order?sig=abc");

    const tableResponse = await request(`/verify/table/10?qrCode=${qrCode}`);
    const seatResponse = await request(`/verify/seat/21?qrCode=${qrCode}`);

    expect(tableResponse.status).toBe(200);
    await expect(tableResponse.json()).resolves.toMatchObject({
      data: { valid: true, tableId: 10, tableNumber: "T1" },
    });
    expect(seatResponse.status).toBe(200);
    await expect(seatResponse.json()).resolves.toMatchObject({
      data: { valid: true, seatId: 21, seatNumber: "01", tableId: 10 },
    });
    expect(signedQrServiceFns.verifyTable).toHaveBeenCalledWith(
      "https://example.test/order?sig=abc",
      10,
    );
    expect(signedQrServiceFns.verifySeat).toHaveBeenCalledWith(
      "https://example.test/order?sig=abc",
      21,
    );
  });

  it("resolves public table and seat QR codes without client-known entity ids", async () => {
    signedQrServiceFns.verifyTableFromQrCode.mockResolvedValueOnce({
      valid: true,
      type: "table",
      restaurantId: "restaurant-1",
      tableId: 10,
      tableNumber: "T1",
      formatVersion: 2,
    });
    signedQrServiceFns.verifySeatFromQrCode.mockResolvedValueOnce({
      valid: true,
      type: "seat",
      restaurantId: "restaurant-1",
      tableId: 10,
      tableNumber: "T1",
      seatId: 21,
      seatNumber: "VIP-1",
      formatVersion: 2,
    });
    const rawQrCode = "https://example.test/order?sig=abc";
    const qrCode = encodeURIComponent(rawQrCode);

    const tableResponse = await request(`/verify/table?qrCode=${qrCode}`);
    const seatResponse = await request(`/verify/seat?qrCode=${qrCode}`);

    expect(tableResponse.status).toBe(200);
    expect(seatResponse.status).toBe(200);
    expect(signedQrServiceFns.verifyTableFromQrCode).toHaveBeenCalledWith(
      rawQrCode,
    );
    expect(signedQrServiceFns.verifySeatFromQrCode).toHaveBeenCalledWith(
      rawQrCode,
    );
  });

  it("reports the specific public signed QR verification failure reason", async () => {
    signedQrServiceFns.verifyTableFromQrCode.mockResolvedValueOnce({
      valid: false,
      reason: "stale",
    });
    signedQrServiceFns.verifySeatFromQrCode.mockResolvedValueOnce({
      valid: false,
      reason: "inactive",
    });
    const qrCode = encodeURIComponent("https://example.test/order?sig=abc");

    const tableResponse = await request(`/verify/table?qrCode=${qrCode}`);
    const seatResponse = await request(`/verify/seat?qrCode=${qrCode}`);

    expect(tableResponse.status).toBe(404);
    await expect(tableResponse.json()).resolves.toMatchObject({
      error: {
        code: "TABLE_QR_STALE",
        message: "Table QR code has been regenerated",
      },
    });
    expect(seatResponse.status).toBe(404);
    await expect(seatResponse.json()).resolves.toMatchObject({
      error: {
        code: "SEAT_QR_INACTIVE",
        message: "Seat QR code is inactive or deleted",
      },
    });
  });

  it("rate limits public signed QR verification before repeated DB lookups", async () => {
    const entries = new Map<string, string>();
    const rateLimitStore = {
      async get(key: string, type?: string) {
        const value = entries.get(key);
        if (value === undefined) return null;
        return type === "json" ? JSON.parse(value) : value;
      },
      async put(key: string, value: string) {
        entries.set(key, value);
      },
    };
    signedQrServiceFns.verifyTableFromQrCode.mockResolvedValue({
      valid: true,
      type: "table",
      restaurantId: "restaurant-1",
      tableId: 10,
      tableNumber: "T1",
      formatVersion: 2,
    });
    const qrCode = encodeURIComponent("https://example.test/order?sig=abc");

    let response: Response | undefined;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      response = await request(
        `/verify/table?qrCode=${qrCode}`,
        "GET",
        undefined,
        {
          headers: { "CF-Connecting-IP": "203.0.113.10" },
          rateLimitStore,
        },
      );
    }

    expect(response?.status).toBe(429);
    expect(signedQrServiceFns.verifyTableFromQrCode).toHaveBeenCalledTimes(60);
  });
});
