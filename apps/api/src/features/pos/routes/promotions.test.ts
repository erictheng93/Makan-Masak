import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/utils/api-error";
import type { AuthUser } from "../../../middleware/auth";
import type { Context, Next } from "hono";
import type routesType from "./index";

const mocks = vi.hoisted(() => ({
  user: {
    id: "owner-1",
    role: 1,
    restaurantId: "restaurant-1",
    username: "owner",
  } as AuthUser,
  service: {
    getCouponsWithEnhancedFilters: vi.fn(),
    getCoupon: vi.fn(),
    createCouponWithValidation: vi.fn(),
    updateCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
    formatCouponMoneyFields: vi.fn((coupon: unknown) => coupon),
  },
  moduleEnabled: true,
}));
vi.mock("../../../middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authMiddleware: async (c: Context, next: Next) => {
    c.set("user", mocks.user);
    await next();
  },
}));
vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: (key: string) => async (_c: Context, next: Next) => {
    if (key === "coupons" && !mocks.moduleEnabled)
      throw new ApiError("MODULE_DISABLED", "disabled", 403);
    await next();
  },
}));
vi.mock("../../coupons/services/CouponsService", () => ({
  CouponsService: vi.fn(function () {
    return mocks.service;
  }),
}));
let routes: typeof routesType;
beforeAll(async () => {
  routes = (await import("./index")).default;
  routes.onError((error, c) =>
    c.json(
      { error: error.message },
      error instanceof ApiError ? (error.status as 400 | 403 | 404) : 500,
    ),
  );
}, 30_000);
const coupon = {
  id: 1,
  restaurantId: "restaurant-1",
  code: "LUNCH10",
  name: "Lunch",
  discountType: "percentage",
  discountValue: 10,
  validFrom: new Date("2026-09-01T00:00:00Z"),
  validTo: new Date("2026-10-31T00:00:00Z"),
  isActive: true,
};
const input = {
  code: "LUNCH10",
  name: "Lunch",
  discountType: "percentage",
  discountValue: 10,
  validFrom: "2026-09-01T00:00:00Z",
  validTo: "2026-10-31T00:00:00Z",
  isActive: true,
};
const request = (path: string, method = "GET", data?: unknown) =>
  routes.request(
    path,
    {
      method,
      headers: { "content-type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    },
    { DB: {} } as never,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = {
    id: "owner-1",
    role: 1,
    restaurantId: "restaurant-1",
    username: "owner",
  };
  mocks.moduleEnabled = true;
  mocks.service.getCouponsWithEnhancedFilters.mockResolvedValue({
    coupons: [coupon],
    total: 1,
    page: 1,
    limit: 20,
    pages: 1,
  });
  mocks.service.getCoupon.mockResolvedValue(coupon);
  mocks.service.createCouponWithValidation.mockResolvedValue(coupon);
  mocks.service.updateCoupon.mockResolvedValue({ ...coupon, name: "Updated" });
});
describe("POS promotions use the electronic coupon backend", () => {
  it("lists tenant coupons and creates, edits and soft deletes through the existing service", async () => {
    const list = await request("/promotions");
    expect(list.status).toBe(200);
    expect(mocks.service.getCouponsWithEnhancedFilters).toHaveBeenCalledWith(
      { restaurantId: "restaurant-1" },
      1,
      20,
    );
    expect(await list.json()).toMatchObject({
      data: { promotions: [expect.objectContaining({ code: "LUNCH10" })] },
    });
    expect((await request("/promotions", "POST", input)).status).toBe(201);
    expect(mocks.service.createCouponWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        createdBy: "owner-1",
        validFrom: new Date(input.validFrom),
        validTo: new Date(input.validTo),
      }),
    );
    expect(
      (await request("/promotions/1", "PUT", { name: "Updated" })).status,
    ).toBe(200);
    expect(mocks.service.updateCoupon).toHaveBeenCalledWith(1, {
      name: "Updated",
    });
    expect((await request("/promotions/1", "DELETE")).status).toBe(200);
    expect(mocks.service.deleteCoupon).toHaveBeenCalledWith(1);
  });
  it("allows cashiers to read usable coupons but not to change discounts", async () => {
    mocks.user.role = 4;
    expect((await request("/promotions")).status).toBe(200);
    expect(mocks.service.getCouponsWithEnhancedFilters).toHaveBeenCalledWith(
      { restaurantId: "restaurant-1", isVisible: true, status: "active" },
      1,
      20,
    );
    for (const method of ["POST", "PUT", "DELETE"])
      expect(
        (
          await request(
            method === "POST" ? "/promotions" : "/promotions/1",
            method,
            method === "DELETE" ? undefined : input,
          )
        ).status,
      ).toBe(403);
    expect(mocks.service.createCouponWithValidation).not.toHaveBeenCalled();
    expect(mocks.service.updateCoupon).not.toHaveBeenCalled();
    expect(mocks.service.deleteCoupon).not.toHaveBeenCalled();
  });
  it("rejects other tenants, module-disabled requests, invalid dates and percentages", async () => {
    expect((await request("/promotions?restaurantId=other")).status).toBe(403);
    mocks.service.getCoupon.mockResolvedValue({
      ...coupon,
      restaurantId: "other",
    });
    expect(
      (await request("/promotions/1", "PUT", { isActive: false })).status,
    ).toBe(403);
    expect((await request("/promotions/1", "DELETE")).status).toBe(403);
    mocks.service.getCoupon.mockResolvedValue(coupon);
    expect(
      (
        await request("/promotions/1", "PUT", {
          validTo: "2020-01-01T00:00:00Z",
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("/promotions", "POST", { ...input, discountValue: 101 }))
        .status,
    ).toBe(400);
    mocks.moduleEnabled = false;
    expect((await request("/promotions")).status).toBe(403);
    expect(mocks.service.updateCoupon).not.toHaveBeenCalled();
    expect(mocks.service.deleteCoupon).not.toHaveBeenCalled();
  });
});
