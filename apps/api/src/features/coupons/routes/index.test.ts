import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import app from "./index";
import { ApiError, conflict } from "../../../shared/utils/api-error";

const mocks = vi.hoisted(() => ({
  currentUser: {
    id: "user-42",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  } as AuthUser,
  validateCouponWithBusinessRules: vi.fn(),
  getAvailableCouponsForUser: vi.fn(),
  createCouponWithValidation: vi.fn(),
  getCouponsWithEnhancedFilters: vi.fn(),
  getCouponSummaryStats: vi.fn(),
  getCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  deactivateCoupon: vi.fn(),
  deleteCoupon: vi.fn(),
  getComprehensiveCouponStats: vi.fn(),
  bulkActivateCoupons: vi.fn(),
  bulkDeactivateCoupons: vi.fn(),
  bulkDeleteCoupons: vi.fn(),
  useCoupon: vi.fn(),
  useCouponForOrder: vi.fn(),
  distributeCouponToAudience: vi.fn(),
  getCouponDistributions: vi.fn(),
  getCouponUsageTrends: vi.fn(),
  formatCouponMoneyFields: vi.fn((coupon: unknown) => coupon),
  customer: null as { id: string } | null,
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: async (c: Context, next: Next) => {
    c.set("user", mocks.currentUser);
    await next();
  },
  optionalCanonicalCustomerAuthMiddleware: async (c: Context, next: Next) => {
    if (mocks.customer) c.set("customer", mocks.customer as never);
    await next();
  },
  requireRole: () => async (_c: Context, next: Next) => {
    await next();
  },
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: () => async (_c: Context, next: Next) => {
    await next();
  },
}));

vi.mock("../services/CouponsService", () => ({
  CouponsService: vi.fn(function CouponsService() {
    return {
      validateCouponWithBusinessRules: mocks.validateCouponWithBusinessRules,
      getAvailableCouponsForUser: mocks.getAvailableCouponsForUser,
      createCouponWithValidation: mocks.createCouponWithValidation,
      getCouponsWithEnhancedFilters: mocks.getCouponsWithEnhancedFilters,
      getCouponSummaryStats: mocks.getCouponSummaryStats,
      getCoupon: mocks.getCoupon,
      updateCoupon: mocks.updateCoupon,
      deactivateCoupon: mocks.deactivateCoupon,
      deleteCoupon: mocks.deleteCoupon,
      getComprehensiveCouponStats: mocks.getComprehensiveCouponStats,
      bulkActivateCoupons: mocks.bulkActivateCoupons,
      bulkDeactivateCoupons: mocks.bulkDeactivateCoupons,
      bulkDeleteCoupons: mocks.bulkDeleteCoupons,
      useCoupon: mocks.useCoupon,
      useCouponForOrder: mocks.useCouponForOrder,
      distributeCouponToAudience: mocks.distributeCouponToAudience,
      getCouponDistributions: mocks.getCouponDistributions,
      getCouponUsageTrends: mocks.getCouponUsageTrends,
      formatCouponMoneyFields: mocks.formatCouponMoneyFields,
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

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    restaurantId: "restaurant-1",
    code: "SAVE10",
    name: "Save 10",
    discountType: "percentage",
    discountValue: 10,
    ...overrides,
  };
}

function createCouponBody(overrides: Record<string, unknown> = {}) {
  return {
    restaurantId: "restaurant-2",
    code: "SAVE10",
    name: "Save 10",
    discountType: "percentage",
    discountValue: 10,
    validFrom: "2026-06-01T00:00:00.000Z",
    validTo: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

// 模擬 app-factory 全域錯誤處理器的統一錯誤格式，
// 用於驗證路由擲出的 ApiError 會變成 { success: false, error: { code, message } }
function createAppWithErrorEnvelope() {
  const wrapper = new Hono();
  wrapper.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        { success: false, error: { code: err.code, message: err.message } },
        err.status as ContentfulStatusCode,
      );
    }
    return c.json(
      {
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      },
      500,
    );
  });
  wrapper.route("/", app);
  return wrapper;
}

async function withSilencedRouteError<T>(
  callback: () => T | Promise<T>,
): Promise<Awaited<T>> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    return await callback();
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.id = "user-42";
  mocks.currentUser.role = 1;
  mocks.currentUser.restaurantId = "restaurant-1";
  mocks.customer = null;
  mocks.formatCouponMoneyFields.mockImplementation((value) => value);
});

describe("coupons routes", () => {
  it("returns a typed 409 for duplicate coupon codes", async () => {
    mocks.createCouponWithValidation.mockRejectedValue(
      conflict("此優惠券代碼在本店已存在，請換一個", "COUPON_CODE_EXISTS"),
    );

    const response = await createAppWithErrorEnvelope().fetch(
      jsonRequest("https://test/", "POST", createCouponBody()),
      createEnv() as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "COUPON_CODE_EXISTS" },
    });
  });

  it("returns the same typed 409 when an edit collides", async () => {
    mocks.currentUser.role = 0;
    mocks.getCoupon.mockResolvedValue(coupon());
    mocks.updateCoupon.mockRejectedValue(
      conflict("此優惠券代碼在本店已存在，請換一個", "COUPON_CODE_EXISTS"),
    );

    const response = await createAppWithErrorEnvelope().fetch(
      jsonRequest("https://test/10", "PUT", { code: "SAVE10" }),
      createEnv() as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "COUPON_CODE_EXISTS" },
    });
  });

  it("rejects attempts to move a coupon to another restaurant", async () => {
    mocks.getCoupon.mockResolvedValue(coupon());
    mocks.updateCoupon.mockResolvedValue(
      coupon({ restaurantId: "restaurant-2" }),
    );

    const response = await createAppWithErrorEnvelope().fetch(
      jsonRequest("https://test/10", "PUT", {
        restaurantId: "restaurant-2",
        name: "Moved coupon",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(mocks.getCoupon).not.toHaveBeenCalled();
    expect(mocks.updateCoupon).not.toHaveBeenCalled();
  });

  it("keeps an owner off another restaurant's distribution endpoints", async () => {
    // Same guard shape as the rest of this router.
    mocks.currentUser.role = 1;
    mocks.currentUser.restaurantId = "restaurant-1";
    mocks.getCoupon.mockResolvedValue(coupon({ restaurantId: "restaurant-2" }));

    const distributeResponse = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest("https://test/10/distribute", "POST", {
          distributionType: "manual",
          targetType: "all",
        }),
        createEnv() as never,
      ),
    );
    expect(distributeResponse.status).toBe(500);
    expect(mocks.distributeCouponToAudience).not.toHaveBeenCalled();

    const historyResponse = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/10/distributions"),
        createEnv() as never,
      ),
    );
    expect(historyResponse.status).toBe(500);
    expect(mocks.getCouponDistributions).not.toHaveBeenCalled();
  });

  it("keeps a non-admin off a platform coupon's distribution", async () => {
    // A platform coupon addresses every customer on the platform, so it is
    // admin-only. The restaurant comparison above refuses it today only because
    // `String(undefined) !== "null"`; an owner whose restaurantId stringified to
    // "null" would match it. auth.ts normalises a null claim to undefined, so
    // that is not reachable now — which is the point: the guard must not rest
    // on a normalisation two files away.
    mocks.currentUser.role = 1;
    mocks.currentUser.restaurantId = null as unknown as string;
    mocks.getCoupon.mockResolvedValue(coupon({ restaurantId: null }));

    const response = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest("https://test/10/distribute", "POST", {
          distributionType: "manual",
          targetType: "user",
          targetCriteria: { customerIds: ["customer-1"] },
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(500);
    expect(mocks.distributeCouponToAudience).not.toHaveBeenCalled();
  });

  it("distributes and reads history for the owner's own coupon", async () => {
    mocks.currentUser.role = 1;
    mocks.currentUser.restaurantId = "restaurant-1";
    mocks.getCoupon.mockResolvedValue(coupon({ restaurantId: "restaurant-1" }));
    mocks.distributeCouponToAudience.mockResolvedValue({
      distributionId: 3,
      targeted: 5,
      issued: 4,
      skipped: 1,
    });
    mocks.getCouponDistributions.mockResolvedValue([{ id: 3 }]);
    const env = createEnv();

    const distributeResponse = await app.fetch(
      jsonRequest("https://test/10/distribute", "POST", {
        distributionType: "manual",
        targetType: "vip",
        targetCriteria: { minOrders: 3 },
      }),
      env as never,
    );
    expect(distributeResponse.status).toBe(201);
    expect(mocks.distributeCouponToAudience).toHaveBeenCalledWith(
      expect.objectContaining({
        couponId: 10,
        targetType: "vip",
        targetCriteria: { minOrders: 3 },
        createdBy: "user-42",
      }),
    );

    const historyResponse = await app.fetch(
      new Request("https://test/10/distributions"),
      env as never,
    );
    expect(historyResponse.status).toBe(200);
    expect(mocks.getCouponDistributions).toHaveBeenCalledWith(10);
  });

  it("validates coupon codes and lists public available coupons", async () => {
    mocks.validateCouponWithBusinessRules.mockResolvedValue({
      valid: true,
      discountAmount: 30,
    });
    mocks.getAvailableCouponsForUser.mockResolvedValue([coupon()]);
    const env = createEnv();

    const validateResponse = await app.fetch(
      jsonRequest("https://test/validate", "POST", {
        code: "SAVE10",
        restaurantId: "restaurant-1",
        orderAmount: 300,
        userId: "user-5",
        menuItems: [{ menuItemId: 1, quantity: 2 }],
      }),
      env as never,
    );
    expect(validateResponse.status).toBe(200);
    await expect(validateResponse.json()).resolves.toMatchObject({
      success: true,
      data: { valid: true, discountAmount: 30 },
    });
    expect(mocks.validateCouponWithBusinessRules).toHaveBeenCalledWith(
      "SAVE10",
      "restaurant-1",
      300,
      undefined,
      [{ menuItemId: 1, quantity: 2 }],
      undefined,
    );

    const availableResponse = await app.fetch(
      new Request("https://test/available/restaurant-1"),
      env as never,
    );
    expect(availableResponse.status).toBe(200);
    await expect(availableResponse.json()).resolves.toMatchObject({
      data: [{ id: 10, code: "SAVE10" }],
    });
    expect(mocks.getAvailableCouponsForUser).toHaveBeenCalledWith(
      "restaurant-1",
    );
  });

  it("uses the authenticated member identity and ignores body user ids", async () => {
    mocks.customer = { id: "customer-42" };
    mocks.validateCouponWithBusinessRules.mockResolvedValue({
      valid: true,
      discountAmount: 30,
    });

    const response = await app.fetch(
      jsonRequest("https://test/validate", "POST", {
        code: "SAVE10",
        restaurantId: "restaurant-1",
        orderAmount: 300,
        userId: "somebody-else",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.validateCouponWithBusinessRules).toHaveBeenCalledWith(
      "SAVE10",
      "restaurant-1",
      300,
      undefined,
      undefined,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });

  it("creates, lists, and summarizes owner-scoped coupons", async () => {
    mocks.createCouponWithValidation.mockResolvedValue(coupon());
    mocks.getCouponsWithEnhancedFilters.mockResolvedValue({
      coupons: [coupon()],
      total: 1,
      page: 2,
      limit: 5,
      pages: 1,
    });
    mocks.getCouponSummaryStats.mockResolvedValue({ total: 1 });
    const env = createEnv();

    const createResponse = await app.fetch(
      jsonRequest("https://test/", "POST", createCouponBody()),
      env as never,
    );
    expect(createResponse.status).toBe(201);
    expect(mocks.createCouponWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        createdBy: "user-42",
      }),
    );

    const listResponse = await app.fetch(
      new Request(
        "https://test/?restaurantId=restaurant-2&page=2&limit=5&discountType=fixed&status=exhausted",
      ),
      env as never,
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      pagination: { total: 1, page: 2, limit: 5, pages: 1 },
    });
    expect(mocks.getCouponsWithEnhancedFilters).toHaveBeenCalledWith(
      {
        restaurantId: "restaurant-1",
        discountType: "fixed",
        status: "exhausted",
      },
      2,
      5,
    );

    const statsResponse = await app.fetch(
      new Request("https://test/stats/summary"),
      env as never,
    );
    expect(statsResponse.status).toBe(200);
    expect(mocks.getCouponSummaryStats).toHaveBeenCalledWith("restaurant-1");
  });

  it("reads, updates, deactivates, deletes, and reports coupon stats", async () => {
    mocks.currentUser.role = 0;
    mocks.getCoupon.mockResolvedValue(coupon());
    mocks.updateCoupon.mockResolvedValue(coupon({ name: "Updated" }));
    mocks.deactivateCoupon.mockResolvedValue(coupon({ isActive: false }));
    mocks.deleteCoupon.mockResolvedValue(undefined);
    mocks.getComprehensiveCouponStats.mockResolvedValue({ totalUsed: 3 });
    const env = createEnv();

    const detailResponse = await app.fetch(
      new Request("https://test/10"),
      env as never,
    );
    expect(detailResponse.status).toBe(200);

    const updateResponse = await app.fetch(
      jsonRequest("https://test/10", "PUT", {
        name: "Updated",
        maxDiscountAmount: null,
        usageLimit: null,
        usageLimitPerUser: null,
      }),
      env as never,
    );
    expect(updateResponse.status).toBe(200);
    expect(mocks.updateCoupon).toHaveBeenCalledWith(10, {
      name: "Updated",
      maxDiscountAmount: null,
      usageLimit: null,
      usageLimitPerUser: null,
    });

    const deactivateResponse = await app.fetch(
      new Request("https://test/10/deactivate", { method: "POST" }),
      env as never,
    );
    expect(deactivateResponse.status).toBe(200);
    expect(mocks.deactivateCoupon).toHaveBeenCalledWith(10);

    const statsResponse = await app.fetch(
      new Request("https://test/10/stats"),
      env as never,
    );
    expect(statsResponse.status).toBe(200);
    await expect(statsResponse.json()).resolves.toMatchObject({
      data: {
        coupon: { id: 10, code: "SAVE10" },
        stats: { totalUsed: 3 },
      },
    });

    const deleteResponse = await app.fetch(
      new Request("https://test/10", { method: "DELETE" }),
      env as never,
    );
    expect(deleteResponse.status).toBe(200);
    expect(mocks.deleteCoupon).toHaveBeenCalledWith(10);
  });

  it("enforces owner coupon ownership checks", async () => {
    mocks.getCoupon.mockResolvedValue(coupon({ restaurantId: "restaurant-2" }));

    const detailResponse = await withSilencedRouteError(() =>
      app.fetch(new Request("https://test/10"), createEnv() as never),
    );
    expect(detailResponse.status).toBe(500);

    const updateResponse = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest("https://test/10", "PUT", { name: "Updated" }),
        createEnv() as never,
      ),
    );
    expect(updateResponse.status).toBe(500);

    const deactivateResponse = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/10/deactivate", { method: "POST" }),
        createEnv() as never,
      ),
    );
    expect(deactivateResponse.status).toBe(500);
  });

  it("handles bulk coupon actions and owner delete restrictions", async () => {
    mocks.getCoupon.mockResolvedValue(coupon());
    mocks.bulkActivateCoupons.mockResolvedValue({ success: 2, failed: 0 });
    mocks.bulkDeactivateCoupons.mockResolvedValue({ success: 1, failed: 1 });
    mocks.bulkDeleteCoupons.mockResolvedValue({ success: 2, failed: 0 });
    const env = createEnv();

    const activateResponse = await app.fetch(
      jsonRequest("https://test/bulk", "POST", {
        couponIds: [10, 11],
        action: "activate",
      }),
      env as never,
    );
    expect(activateResponse.status).toBe(200);
    expect(mocks.bulkActivateCoupons).toHaveBeenCalledWith([10, 11]);

    const deactivateResponse = await app.fetch(
      jsonRequest("https://test/bulk", "POST", {
        couponIds: [10, 11],
        action: "deactivate",
      }),
      env as never,
    );
    expect(deactivateResponse.status).toBe(200);
    expect(mocks.bulkDeactivateCoupons).toHaveBeenCalledWith([10, 11]);

    const forbiddenDelete = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest("https://test/bulk", "POST", {
          couponIds: [10],
          action: "delete",
        }),
        env as never,
      ),
    );
    expect(forbiddenDelete.status).toBe(500);

    mocks.currentUser.role = 0;
    const deleteResponse = await app.fetch(
      jsonRequest("https://test/bulk", "POST", {
        couponIds: [10, 11],
        action: "delete",
      }),
      env as never,
    );
    expect(deleteResponse.status).toBe(200);
    expect(mocks.bulkDeleteCoupons).toHaveBeenCalledWith([10, 11]);
  });

  it("uses coupons and returns usage trends", async () => {
    mocks.useCouponForOrder.mockResolvedValue({ id: "usage-1" });
    mocks.getCouponUsageTrends.mockResolvedValue([{ date: "2026-06-01" }]);
    const env = createEnv();

    const useResponse = await app.fetch(
      jsonRequest("https://test/use", "POST", {
        couponId: 10,
        orderId: "99",
        userId: "user-5",
        discountAmount: 30,
        originalAmount: 300,
        finalAmount: 270,
      }),
      env as never,
    );
    expect(useResponse.status).toBe(200);
    expect(mocks.useCouponForOrder).toHaveBeenCalledWith({
      couponId: 10,
      orderId: "99",
      userId: "user-5",
      allowedRestaurantId: "restaurant-1",
    });

    const trendsResponse = await app.fetch(
      new Request(
        "https://test/analytics/trends?restaurantId=restaurant-1&startDate=2026-06-01&endDate=2026-06-30",
      ),
      env as never,
    );
    expect(trendsResponse.status).toBe(200);
    expect(mocks.getCouponUsageTrends).toHaveBeenCalledWith(
      "restaurant-1",
      "2026-06-01",
      "2026-06-30",
    );

    const deniedTrends = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/analytics/trends?restaurantId=restaurant-2"),
        env as never,
      ),
    );
    expect(deniedTrends.status).toBe(500);
  });

  it("returns the unified error envelope when a redemption is denied", async () => {
    mocks.useCouponForOrder.mockRejectedValueOnce(
      conflict("優惠券使用次數已達上限", "COUPON_USAGE_LIMIT_REACHED"),
    );
    const wrapped = createAppWithErrorEnvelope();

    const response = await wrapped.fetch(
      jsonRequest("https://test/use", "POST", {
        couponId: 10,
        orderId: "99",
        discountAmount: 30,
        originalAmount: 300,
        finalAmount: 270,
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "COUPON_USAGE_LIMIT_REACHED",
        message: "優惠券使用次數已達上限",
      },
    });
    expect(mocks.useCouponForOrder).toHaveBeenCalledOnce();
  });

  it("returns not-found errors for missing coupon resources", async () => {
    mocks.getCoupon.mockResolvedValue(null);
    const env = createEnv();

    const detailResponse = await withSilencedRouteError(() =>
      app.fetch(new Request("https://test/10"), env as never),
    );
    expect(detailResponse.status).toBe(500);

    const deleteResponse = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/10", { method: "DELETE" }),
        env as never,
      ),
    );
    expect(deleteResponse.status).toBe(500);
  });
});
