import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";
import app from "./index";
import { ApiError } from "../../../shared/utils/api-error";

const RESTAURANT_ID = "01972f31-05a2-7b8c-a4f8-000000000001";
const OTHER_RESTAURANT_ID = "01972f31-05a2-7b8c-a4f8-000000000002";

const mocks = vi.hoisted(() => ({
  currentUser: {
    id: "user-42",
    username: "owner",
    role: 1,
    restaurantId: "01972f31-05a2-7b8c-a4f8-000000000001",
  } as AuthUser,
  getLeaveTypes: vi.fn(),
  getLeaveType: vi.fn(),
  createLeaveType: vi.fn(),
  updateLeaveType: vi.fn(),
  deleteLeaveType: vi.fn(),
  getEmployeeLeaveBalances: vi.fn(),
  adjustLeaveBalance: vi.fn(),
  getRestaurantLeaveBalances: vi.fn(),
  accrueLeaveBalances: vi.fn(),
  getLeaveRequests: vi.fn(),
  getLeaveRequest: vi.fn(),
  getLeaveBalance: vi.fn(),
  createLeaveRequest: vi.fn(),
  approveLeaveRequest: vi.fn(),
  rejectLeaveRequest: vi.fn(),
  cancelLeaveRequest: vi.fn(),
  getHolidays: vi.fn(),
  isWorkingDay: vi.fn(),
}));

vi.mock("../../../shared/middleware", async () => {
  const validation = await vi.importActual<
    typeof import("../../../middleware/validation")
  >("../../../middleware/validation");

  return {
    ...validation,
    authMiddleware: async (c: Context, next: Next) => {
      c.set("user", mocks.currentUser);
      await next();
    },
    // Enforced rather than waved through: which routes carry a role gate is
    // the thing under test in "lets any employee read leave types" (#344), and
    // a pass-through stub cannot tell a guarded route from an open one.
    requireRole:
      (allowedRoles: number[]) => async (_c: Context, next: Next) => {
        if (!allowedRoles.includes(mocks.currentUser.role)) {
          throw new ApiError(
            "INSUFFICIENT_ROLE",
            "Insufficient permissions",
            403,
          );
        }
        await next();
      },
    requireRestaurantAccess: () => async (_c: Context, next: Next) => {
      await next();
    },
  };
});

vi.mock("@makanmasak/database", () => ({
  LeaveService: vi.fn(function LeaveService() {
    return {
      getLeaveTypes: mocks.getLeaveTypes,
      getLeaveType: mocks.getLeaveType,
      createLeaveType: mocks.createLeaveType,
      updateLeaveType: mocks.updateLeaveType,
      deleteLeaveType: mocks.deleteLeaveType,
      getEmployeeLeaveBalances: mocks.getEmployeeLeaveBalances,
      adjustLeaveBalance: mocks.adjustLeaveBalance,
      getRestaurantLeaveBalances: mocks.getRestaurantLeaveBalances,
      accrueLeaveBalances: mocks.accrueLeaveBalances,
      getLeaveRequests: mocks.getLeaveRequests,
      getLeaveRequest: mocks.getLeaveRequest,
      getLeaveBalance: mocks.getLeaveBalance,
      createLeaveRequest: mocks.createLeaveRequest,
      approveLeaveRequest: mocks.approveLeaveRequest,
      rejectLeaveRequest: mocks.rejectLeaveRequest,
      cancelLeaveRequest: mocks.cancelLeaveRequest,
      getHolidays: mocks.getHolidays,
      isWorkingDay: mocks.isWorkingDay,
    };
  }),
}));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

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

function leaveType(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    restaurantId: RESTAURANT_ID,
    code: "ANNUAL",
    name: "Annual Leave",
    ...overrides,
  };
}

function createLeaveTypeBody(overrides: Record<string, unknown> = {}) {
  return {
    code: "ANNUAL",
    name: "Annual Leave",
    accrualType: "yearly",
    accrualAmount: 14,
    ...overrides,
  };
}

function createLeaveRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    employeeId: "user-7",
    leaveTypeId: 3,
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    startPeriod: "full",
    endPeriod: "am",
    reason: "Family event",
    ...overrides,
  };
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
  mocks.currentUser.restaurantId = RESTAURANT_ID;
});

describe("leaves routes", () => {
  it("manages leave types for a restaurant", async () => {
    mocks.getLeaveTypes.mockResolvedValue([leaveType()]);
    mocks.getLeaveType.mockResolvedValue(leaveType());
    mocks.createLeaveType.mockResolvedValue(leaveType());
    mocks.updateLeaveType.mockResolvedValue(leaveType({ name: "Updated" }));
    mocks.deleteLeaveType.mockResolvedValue(true);
    const env = createEnv();

    const listResponse = await app.fetch(
      new Request(`https://test/${RESTAURANT_ID}/types`),
      env as never,
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: 3, code: "ANNUAL" }],
    });
    expect(mocks.getLeaveTypes).toHaveBeenCalledWith(RESTAURANT_ID);

    const detailResponse = await app.fetch(
      new Request("https://test/types/3"),
      env as never,
    );
    expect(detailResponse.status).toBe(200);
    expect(mocks.getLeaveType).toHaveBeenCalledWith(3, RESTAURANT_ID);

    const createResponse = await app.fetch(
      jsonRequest(
        `https://test/${RESTAURANT_ID}/types`,
        "POST",
        createLeaveTypeBody({ restaurantId: OTHER_RESTAURANT_ID }),
      ),
      env as never,
    );
    expect(createResponse.status).toBe(201);
    expect(mocks.createLeaveType).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        createdBy: "user-42",
      }),
    );

    const updateResponse = await app.fetch(
      jsonRequest("https://test/types/3", "PUT", { name: "Updated" }),
      env as never,
    );
    expect(updateResponse.status).toBe(200);
    expect(mocks.updateLeaveType).toHaveBeenCalledWith(
      3,
      {
        name: "Updated",
        updatedBy: "user-42",
      },
      RESTAURANT_ID,
    );

    const deleteResponse = await app.fetch(
      new Request("https://test/types/3", { method: "DELETE" }),
      env as never,
    );
    expect(deleteResponse.status).toBe(200);
    expect(mocks.deleteLeaveType).toHaveBeenCalledWith(3, RESTAURANT_ID);
  });

  it("lets platform admins operate on leave types without tenant scope", async () => {
    mocks.currentUser.role = 0;
    mocks.getLeaveType.mockResolvedValue(leaveType({ restaurantId: null }));
    mocks.updateLeaveType.mockResolvedValue(leaveType({ restaurantId: null }));
    const env = createEnv();

    const detailResponse = await app.fetch(
      new Request("https://test/types/3"),
      env as never,
    );
    expect(detailResponse.status).toBe(200);
    expect(mocks.getLeaveType).toHaveBeenCalledWith(3, undefined);

    const updateResponse = await app.fetch(
      jsonRequest("https://test/types/3", "PUT", { name: "Updated" }),
      env as never,
    );
    expect(updateResponse.status).toBe(200);
    expect(mocks.updateLeaveType).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ name: "Updated" }),
      undefined,
    );
  });

  it("blocks owners from mutating cross-tenant or system leave types", async () => {
    const env = createEnv();

    // Scoped service lookup misses entirely for another tenant's type
    mocks.getLeaveType.mockResolvedValue(null);
    const crossTenantResponse = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest("https://test/types/3", "PUT", { name: "Hijacked" }),
        env as never,
      ),
    );
    expect(crossTenantResponse.status).toBe(404);
    expect(mocks.updateLeaveType).not.toHaveBeenCalled();

    // System-wide types (restaurantId null) are readable but not mutable
    mocks.getLeaveType.mockResolvedValue(leaveType({ restaurantId: null }));
    const systemTypeResponse = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest("https://test/types/3", "PUT", { name: "Hijacked" }),
        env as never,
      ),
    );
    expect(systemTypeResponse.status).toBe(404);
    expect(mocks.updateLeaveType).not.toHaveBeenCalled();

    // Delete is scoped to the caller's restaurant at the service layer
    mocks.deleteLeaveType.mockResolvedValue(false);
    const deleteResponse = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/types/3", { method: "DELETE" }),
        env as never,
      ),
    );
    expect(deleteResponse.status).toBe(404);
    expect(mocks.deleteLeaveType).toHaveBeenCalledWith(3, RESTAURANT_ID);
  });

  it("returns type not-found errors when reads or deletes miss", async () => {
    mocks.getLeaveType.mockResolvedValue(null);
    mocks.deleteLeaveType.mockResolvedValue(false);

    const detailResponse = await withSilencedRouteError(() =>
      app.fetch(new Request("https://test/types/99"), createEnv() as never),
    );
    expect(detailResponse.status).toBe(404);

    const deleteResponse = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/types/99", { method: "DELETE" }),
        createEnv() as never,
      ),
    );
    expect(deleteResponse.status).toBe(404);
  });

  it("reads and adjusts leave balances", async () => {
    mocks.getEmployeeLeaveBalances.mockResolvedValue([{ remainingDays: 8 }]);
    mocks.adjustLeaveBalance.mockResolvedValue({ remainingDays: 9 });
    mocks.getRestaurantLeaveBalances.mockResolvedValue([
      { employeeId: "user-7" },
    ]);
    mocks.accrueLeaveBalances.mockResolvedValue(3);
    const env = createEnv();

    const employeeResponse = await app.fetch(
      new Request("https://test/balances?employeeId=7&year=2026"),
      env as never,
    );
    expect(employeeResponse.status).toBe(200);
    expect(mocks.getEmployeeLeaveBalances).toHaveBeenCalledWith(
      "7",
      2026,
      RESTAURANT_ID,
    );

    // A spoofed adjustedBy in the body must lose to the session identity.
    const adjustResponse = await app.fetch(
      jsonRequest("https://test/balances/adjust", "POST", {
        employeeId: "user-7",
        leaveTypeId: 3,
        year: 2026,
        adjustment: 1,
        reason: "Correction",
        adjustedBy: "user-999",
      }),
      env as never,
    );
    expect(adjustResponse.status).toBe(200);
    expect(mocks.adjustLeaveBalance).toHaveBeenCalledWith({
      employeeId: "user-7",
      leaveTypeId: 3,
      year: 2026,
      adjustment: 1,
      reason: "Correction",
      adjustedBy: "user-42",
      restaurantId: RESTAURANT_ID,
    });

    const restaurantResponse = await app.fetch(
      new Request(`https://test/${RESTAURANT_ID}/balances?year=2026`),
      env as never,
    );
    expect(restaurantResponse.status).toBe(200);
    expect(mocks.getRestaurantLeaveBalances).toHaveBeenCalledWith(
      RESTAURANT_ID,
      2026,
    );

    // Body carries the year and nothing else — the restaurant comes from the
    // path. This test used to send restaurantId in the body too, which is the
    // only reason it passed: the schema demanded a field the admin dashboard
    // never sends, so "初始化假期餘額" 400'd in production while CI stayed green.
    const accrueResponse = await app.fetch(
      jsonRequest(`https://test/${RESTAURANT_ID}/balances/accrue`, "POST", {
        year: 2026,
      }),
      env as never,
    );
    expect(accrueResponse.status).toBe(200);
    expect(mocks.accrueLeaveBalances).toHaveBeenCalledWith(RESTAURANT_ID, 2026);
  });

  it("lets any employee read leave types but not change them", async () => {
    // An employee may file a leave request -- POST /:restaurantId/requests
    // carries no role gate -- and the request form cannot offer a type it is
    // not allowed to list, so the read is open to every role in the restaurant
    // while the writes stay ADMIN/OWNER (#344).
    mocks.currentUser.id = "user-7";
    mocks.currentUser.role = 2; // chef
    mocks.getLeaveTypes.mockResolvedValue([leaveType()]);
    const env = createEnv();

    const listResponse = await app.fetch(
      new Request(`https://test/${RESTAURANT_ID}/types`),
      env as never,
    );
    expect(listResponse.status).toBe(200);
    expect(mocks.getLeaveTypes).toHaveBeenCalledWith(RESTAURANT_ID);

    const createResponse = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest(`https://test/${RESTAURANT_ID}/types`, "POST", {
          code: "ANNUAL",
          name: "Annual",
          accrualType: "yearly",
          accrualAmount: 14,
        }),
        env as never,
      ),
    );
    expect(createResponse.status).toBe(403);
    expect(mocks.createLeaveType).not.toHaveBeenCalled();

    const deleteResponse = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/types/3", { method: "DELETE" }),
        env as never,
      ),
    );
    expect(deleteResponse.status).toBe(403);
    expect(mocks.deleteLeaveType).not.toHaveBeenCalled();
  });

  it("restricts employees to their own balances and requests", async () => {
    mocks.currentUser.id = "user-7";
    mocks.currentUser.role = 3;
    mocks.getLeaveRequests.mockResolvedValue({ items: [], total: 0 });
    mocks.getLeaveRequest.mockResolvedValue({ id: 9, employeeId: 8 });

    const balanceResponse = await withSilencedRouteError(() =>
      app.fetch(
        new Request("https://test/balances?employeeId=8"),
        createEnv() as never,
      ),
    );
    expect(balanceResponse.status).toBe(403);

    const listResponse = await app.fetch(
      new Request(
        `https://test/${RESTAURANT_ID}/requests?employeeId=8&page=2&limit=5`,
      ),
      createEnv() as never,
    );
    expect(listResponse.status).toBe(200);
    expect(mocks.getLeaveRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: "user-7",
        restaurantId: RESTAURANT_ID,
        page: 2,
        limit: 5,
      }),
    );

    const detailResponse = await withSilencedRouteError(() =>
      app.fetch(new Request("https://test/requests/9"), createEnv() as never),
    );
    expect(detailResponse.status).toBe(403);
    expect(mocks.getLeaveRequest).toHaveBeenCalledWith(9, RESTAURANT_ID);
  });

  it("creates, approves, rejects, and cancels leave requests", async () => {
    mocks.getLeaveBalance.mockResolvedValue({ remainingDays: 3 });
    mocks.createLeaveRequest.mockResolvedValue({ id: 9, totalDays: 1.5 });
    mocks.approveLeaveRequest.mockResolvedValue({ id: 9, status: "approved" });
    mocks.rejectLeaveRequest.mockResolvedValue({ id: 9, status: "rejected" });
    mocks.getLeaveRequest.mockResolvedValue({
      id: 9,
      employeeId: "user-7",
      restaurantId: RESTAURANT_ID,
    });
    mocks.cancelLeaveRequest.mockResolvedValue({ id: 9, status: "cancelled" });
    const env = createEnv();

    // Owner (role 1) may file for another employee of the same restaurant
    const createResponse = await app.fetch(
      jsonRequest(
        `https://test/${RESTAURANT_ID}/requests`,
        "POST",
        createLeaveRequestBody(),
      ),
      env as never,
    );
    expect(createResponse.status).toBe(201);
    expect(mocks.getLeaveBalance).toHaveBeenCalledWith(
      "user-7",
      3,
      expect.any(Number),
      RESTAURANT_ID,
    );
    expect(mocks.createLeaveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        employeeId: "user-7",
        totalDays: 1.5,
      }),
    );

    // A spoofed approverId in the body must lose to the session identity.
    const approveResponse = await app.fetch(
      jsonRequest("https://test/requests/9/approve", "POST", {
        approverId: "999",
        comments: "Enjoy",
      }),
      env as never,
    );
    expect(approveResponse.status).toBe(200);
    expect(mocks.approveLeaveRequest).toHaveBeenCalledWith(
      9,
      "user-42",
      "Enjoy",
      RESTAURANT_ID,
    );

    const rejectResponse = await app.fetch(
      jsonRequest("https://test/requests/9/reject", "POST", {
        approverId: "999",
        reason: "Coverage gap",
      }),
      env as never,
    );
    expect(rejectResponse.status).toBe(200);
    expect(mocks.rejectLeaveRequest).toHaveBeenCalledWith(
      9,
      "user-42",
      "Coverage gap",
      RESTAURANT_ID,
    );

    const cancelResponse = await app.fetch(
      jsonRequest("https://test/requests/9/cancel", "POST", {
        userId: "user-999",
        reason: "Changed plans",
      }),
      env as never,
    );
    expect(cancelResponse.status).toBe(200);
    expect(mocks.cancelLeaveRequest).toHaveBeenCalledWith(
      9,
      "user-42",
      "Changed plans",
      RESTAURANT_ID,
    );
  });

  it("forces self-service leave requests onto the session employee", async () => {
    // Non-manager (role 3) tries to file leave for someone else
    mocks.currentUser.id = "user-7";
    mocks.currentUser.role = 3;
    mocks.getLeaveBalance.mockResolvedValue({ remainingDays: 3 });
    mocks.createLeaveRequest.mockResolvedValue({ id: 9, totalDays: 1.5 });

    const response = await app.fetch(
      jsonRequest(
        `https://test/${RESTAURANT_ID}/requests`,
        "POST",
        createLeaveRequestBody({ employeeId: "8" }),
      ),
      createEnv() as never,
    );
    expect(response.status).toBe(201);
    expect(mocks.createLeaveRequest).toHaveBeenCalledOnce();
    expect(mocks.createLeaveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: "user-7",
        restaurantId: RESTAURANT_ID,
      }),
    );
  });

  it("returns not found when a manager files leave for a cross-tenant employee", async () => {
    mocks.getLeaveBalance.mockResolvedValue(null);
    mocks.createLeaveRequest.mockRejectedValue(
      new Error("Employee not found in restaurant"),
    );

    const response = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest(
          `https://test/${RESTAURANT_ID}/requests`,
          "POST",
          createLeaveRequestBody({ employeeId: "outside-employee" }),
        ),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(404);
    expect(mocks.getLeaveBalance).toHaveBeenCalledWith(
      "outside-employee",
      3,
      expect.any(Number),
      RESTAURANT_ID,
    );
    expect(mocks.createLeaveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: "outside-employee",
        restaurantId: RESTAURANT_ID,
      }),
    );
  });

  it("allows owners to approve and reject their own leave requests", async () => {
    const env = createEnv();

    mocks.approveLeaveRequest.mockResolvedValue({ id: 9, status: "approved" });
    mocks.rejectLeaveRequest.mockResolvedValue({ id: 9, status: "rejected" });
    mocks.getLeaveRequest.mockResolvedValue({
      id: 9,
      employeeId: "42",
      restaurantId: RESTAURANT_ID,
    });

    const selfApproveResponse = await app.fetch(
      jsonRequest("https://test/requests/9/approve", "POST", {
        comments: "Looks fine",
      }),
      env as never,
    );
    expect(selfApproveResponse.status).toBe(200);
    expect(mocks.approveLeaveRequest).toHaveBeenCalledWith(
      9,
      "user-42",
      "Looks fine",
      RESTAURANT_ID,
    );

    const selfRejectResponse = await app.fetch(
      jsonRequest("https://test/requests/9/reject", "POST", {
        reason: "No",
      }),
      env as never,
    );
    expect(selfRejectResponse.status).toBe(200);
    expect(mocks.rejectLeaveRequest).toHaveBeenCalledWith(
      9,
      "user-42",
      "No",
      RESTAURANT_ID,
    );
  });

  it("rejects cross-tenant approval attempts", async () => {
    const env = createEnv();

    // Cross-tenant request: the scoped lookup misses, so approval 404s
    mocks.getLeaveRequest.mockResolvedValue(null);
    const crossTenantResponse = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest("https://test/requests/9/approve", "POST", {
          comments: "Enjoy",
        }),
        env as never,
      ),
    );
    expect(crossTenantResponse.status).toBe(404);
    expect(mocks.getLeaveRequest).toHaveBeenLastCalledWith(9, RESTAURANT_ID);
    expect(mocks.approveLeaveRequest).not.toHaveBeenCalled();
  });

  it("rejects invalid leave request creation and missing cancellation targets", async () => {
    mocks.getLeaveBalance.mockResolvedValue({ remainingDays: 1 });
    const insufficientResponse = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest(
          `https://test/${RESTAURANT_ID}/requests`,
          "POST",
          createLeaveRequestBody(),
        ),
        createEnv() as never,
      ),
    );
    expect(insufficientResponse.status).toBe(400);

    mocks.getLeaveRequest.mockResolvedValue(null);
    const missingCancelResponse = await withSilencedRouteError(() =>
      app.fetch(
        jsonRequest("https://test/requests/404/cancel", "POST", {
          reason: "Changed plans",
        }),
        createEnv() as never,
      ),
    );
    expect(missingCancelResponse.status).toBe(404);
    expect(mocks.cancelLeaveRequest).not.toHaveBeenCalled();
  });

  it("reads holidays and working-day status", async () => {
    mocks.getHolidays.mockResolvedValue([{ date: "2026-01-01" }]);
    mocks.isWorkingDay.mockResolvedValue(false);
    const env = createEnv();

    const holidaysResponse = await app.fetch(
      new Request(`https://test/${RESTAURANT_ID}/holidays?year=2026`),
      env as never,
    );
    expect(holidaysResponse.status).toBe(200);
    expect(mocks.getHolidays).toHaveBeenCalledWith(RESTAURANT_ID, 2026);

    const workingDayResponse = await app.fetch(
      new Request(`https://test/${RESTAURANT_ID}/working-day/2026-01-01`),
      env as never,
    );
    expect(workingDayResponse.status).toBe(200);
    await expect(workingDayResponse.json()).resolves.toMatchObject({
      data: { date: "2026-01-01", isWorkingDay: false },
    });
  });
});
