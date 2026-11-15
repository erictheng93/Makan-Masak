import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";

const auth = vi.hoisted(() => ({
  user: {
    id: "user-42",
    username: "owner",
    role: 1,
    restaurantId: "rest-1",
  } as AuthUser,
}));

vi.mock("../../../shared/middleware", async () => {
  const validation = await vi.importActual<
    typeof import("../../../middleware/validation")
  >("../../../middleware/validation");
  return {
    authMiddleware: vi.fn(async (c: Context, next: Next) => {
      c.set("user", auth.user);
      await next();
    }),
    requireRole: vi.fn(
      () => async (_c: unknown, next: () => Promise<void>) => next(),
    ),
    requireRestaurantAccess: vi.fn(
      () => async (_c: unknown, next: () => Promise<void>) => next(),
    ),
    validateBody: validation.validateBody,
    validateQuery: validation.validateQuery,
    validateParams: validation.validateParams,
  };
});

const serviceFns = vi.hoisted(() => ({
  getShiftTemplates: vi.fn(),
  getShiftTemplate: vi.fn(),
  createShiftTemplate: vi.fn(),
  updateShiftTemplate: vi.fn(),
  deleteShiftTemplate: vi.fn(),
  getSchedules: vi.fn(),
  getSchedule: vi.fn(),
  createSchedule: vi.fn(),
  bulkCreateSchedules: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  getClockedInEmployees: vi.fn(),
  getAttendanceReport: vi.fn(),
  getScheduleById: vi.fn(),
  createSwapRequest: vi.fn(),
  getSwapRequest: vi.fn(),
  getSwapRequests: vi.fn(),
  acceptSwapRequest: vi.fn(),
  approveSwapRequest: vi.fn(),
  rejectSwapRequest: vi.fn(),
  cancelSwapRequest: vi.fn(),
  getAvailableEmployees: vi.fn(),
  getConflicts: vi.fn(),
  getConflict: vi.fn(),
  resolveConflict: vi.fn(),
  getDailyStats: vi.fn(),
  getWeeklySummary: vi.fn(),
  getEmployeeNames: vi.fn(),
}));

vi.mock("@makanmasak/database", () => ({
  SchedulingService: class {
    getShiftTemplates = serviceFns.getShiftTemplates;
    getShiftTemplate = serviceFns.getShiftTemplate;
    createShiftTemplate = serviceFns.createShiftTemplate;
    updateShiftTemplate = serviceFns.updateShiftTemplate;
    deleteShiftTemplate = serviceFns.deleteShiftTemplate;
    getSchedules = serviceFns.getSchedules;
    getSchedule = serviceFns.getSchedule;
    createSchedule = serviceFns.createSchedule;
    bulkCreateSchedules = serviceFns.bulkCreateSchedules;
    updateSchedule = serviceFns.updateSchedule;
    deleteSchedule = serviceFns.deleteSchedule;
    clockIn = serviceFns.clockIn;
    clockOut = serviceFns.clockOut;
    getClockedInEmployees = serviceFns.getClockedInEmployees;
    getAttendanceReport = serviceFns.getAttendanceReport;
    getScheduleById = serviceFns.getScheduleById;
    createSwapRequest = serviceFns.createSwapRequest;
    getSwapRequest = serviceFns.getSwapRequest;
    getSwapRequests = serviceFns.getSwapRequests;
    acceptSwapRequest = serviceFns.acceptSwapRequest;
    approveSwapRequest = serviceFns.approveSwapRequest;
    rejectSwapRequest = serviceFns.rejectSwapRequest;
    cancelSwapRequest = serviceFns.cancelSwapRequest;
    getAvailableEmployees = serviceFns.getAvailableEmployees;
    getConflicts = serviceFns.getConflicts;
    getConflict = serviceFns.getConflict;
    resolveConflict = serviceFns.resolveConflict;
    getDailyStats = serviceFns.getDailyStats;
    getWeeklySummary = serviceFns.getWeeklySummary;
    getEmployeeNames = serviceFns.getEmployeeNames;
  },
}));

import app from "./index";
import { ApiError } from "../../../shared/utils/api-error";

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function request(path: string, method = "GET", body?: unknown) {
  return app.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
    },
    { DB: {} } as never,
  );
}

const templateBody = {
  name: "Dinner",
  startTime: "17:00",
  endTime: "22:00",
  durationMinutes: 300,
};

const scheduleBody = {
  employeeId: 42,
  workDate: "2026-06-10",
  startTime: "09:00",
  endTime: "17:00",
  scheduledHours: 8,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  auth.user = {
    id: "user-42",
    username: "owner",
    role: 1,
    restaurantId: "rest-1",
  };

  serviceFns.getShiftTemplates.mockResolvedValue([{ id: 1, name: "Dinner" }]);
  serviceFns.getShiftTemplate.mockResolvedValue({ id: 1, name: "Dinner" });
  serviceFns.createShiftTemplate.mockResolvedValue({ id: 2, name: "Dinner" });
  serviceFns.updateShiftTemplate.mockResolvedValue({ id: 1, name: "Lunch" });
  serviceFns.deleteShiftTemplate.mockResolvedValue(true);
  serviceFns.getSchedules.mockResolvedValue({
    items: [{ id: 10, employeeId: 42 }],
    total: 25,
  });
  serviceFns.getSchedule.mockResolvedValue({ id: 10, employeeId: 42 });
  serviceFns.createSchedule.mockResolvedValue({ id: 10, employeeId: 42 });
  serviceFns.bulkCreateSchedules.mockResolvedValue(3);
  serviceFns.updateSchedule.mockResolvedValue({ id: 10, status: "confirmed" });
  serviceFns.deleteSchedule.mockResolvedValue(true);
  serviceFns.clockIn.mockResolvedValue({ id: 10, status: "clocked_in" });
  serviceFns.clockOut.mockResolvedValue({ id: 10, status: "clocked_out" });
  serviceFns.getClockedInEmployees.mockResolvedValue([{ id: 42 }]);
  serviceFns.getAttendanceReport.mockResolvedValue({
    records: [
      {
        employeeId: 42,
        workDate: "2026-06-10",
        startTime: "09:00",
        endTime: "17:00",
        clockInTime: "2026-06-10T01:00:00.000Z",
        clockOutTime: "2026-06-10T09:00:00.000Z",
        scheduledHours: 8,
        actualHours: 8,
        overtimeHours: 0,
        status: "completed",
      },
    ],
  });
  serviceFns.getEmployeeNames.mockResolvedValue(
    new Map<string | number, string>([[42, "Alice Server"]]),
  );
  serviceFns.getScheduleById.mockResolvedValue({
    id: 10,
    employeeId: "user-42",
  });
  serviceFns.createSwapRequest.mockResolvedValue({ id: 20 });
  serviceFns.getSwapRequest.mockResolvedValue({
    id: 20,
    requesterEmployeeId: "user-42",
    status: "pending",
  });
  serviceFns.getSwapRequests.mockResolvedValue({
    items: [{ id: 20, requesterEmployeeId: 42 }],
    total: 1,
  });
  serviceFns.acceptSwapRequest.mockResolvedValue({
    id: 20,
    status: "accepted",
  });
  serviceFns.approveSwapRequest.mockResolvedValue({
    id: 20,
    status: "approved",
  });
  serviceFns.rejectSwapRequest.mockResolvedValue({
    id: 20,
    status: "rejected",
  });
  serviceFns.cancelSwapRequest.mockResolvedValue({
    id: 20,
    status: "cancelled",
  });
  serviceFns.getAvailableEmployees.mockResolvedValue([{ id: 42 }]);
  serviceFns.getConflicts.mockResolvedValue({
    items: [{ id: 30, status: "unresolved" }],
    total: 1,
  });
  serviceFns.getConflict.mockResolvedValue({ id: 30 });
  serviceFns.resolveConflict.mockResolvedValue({ id: 30, status: "resolved" });
  serviceFns.getDailyStats.mockResolvedValue({ totalSchedules: 4 });
  serviceFns.getWeeklySummary.mockResolvedValue({
    weekStartDate: "2026-06-08",
  });
});

describe("scheduling routes", () => {
  it("lists and creates shift templates with URL restaurant and user metadata", async () => {
    let res = await request("/rest-1/templates");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: 1, name: "Dinner" }],
    });
    expect(serviceFns.getShiftTemplates).toHaveBeenCalledWith("rest-1");

    res = await request("/rest-1/templates", "POST", templateBody);
    expect(res.status).toBe(201);
    expect(serviceFns.createShiftTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "rest-1",
        createdBy: "user-42",
        name: "Dinner",
        shiftType: "regular",
      }),
    );
  });

  it("returns not found for missing templates and schedules", async () => {
    serviceFns.getShiftTemplate.mockResolvedValueOnce(null);
    let res = await request("/templates/999");
    expect(res.status).toBe(404);
    expect(serviceFns.getShiftTemplate).toHaveBeenCalledWith(999, "rest-1");

    serviceFns.deleteSchedule.mockResolvedValueOnce(false);
    res = await request("/schedules/999", "DELETE");
    expect(res.status).toBe(404);
    expect(serviceFns.deleteSchedule).toHaveBeenCalledWith(999, "rest-1");
  });

  it("filters non-manager schedule lists to the authenticated employee", async () => {
    auth.user = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: "rest-1",
    };

    const res = await request(
      "/rest-1/schedules?employeeId=99&page=2&limit=10",
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      pagination: { page: 2, limit: 10, total: 25, totalPages: 3 },
    });
    expect(serviceFns.getSchedules).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "rest-1",
        employeeId: "user-42",
        page: 2,
        limit: 10,
      }),
    );
  });

  it("allows managers to create, bulk create, update, and cancel schedules", async () => {
    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };

    let res = await request("/rest-1/schedules", "POST", scheduleBody);
    expect(res.status).toBe(201);
    expect(serviceFns.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "rest-1", createdBy: "user-7" }),
    );

    res = await request("/rest-1/schedules/bulk", "POST", {
      shiftTemplateId: 1,
      employeeIds: [42, 43],
      dateRange: { startDate: "2026-06-10", endDate: "2026-06-12" },
      daysOfWeek: [3, 4],
    });
    expect(res.status).toBe(201);
    expect(serviceFns.bulkCreateSchedules).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "rest-1", createdBy: "user-7" }),
    );

    res = await request("/schedules/10", "PUT", {
      status: "confirmed",
      notes: "ready",
    });
    expect(res.status).toBe(200);
    expect(serviceFns.updateSchedule).toHaveBeenCalledWith(
      10,
      {
        status: "confirmed",
        notes: "ready",
        updatedBy: "user-7",
      },
      "rest-1",
    );

    res = await request("/schedules/10", "DELETE");
    expect(res.status).toBe(200);
    expect(serviceFns.deleteSchedule).toHaveBeenCalledWith(10, "rest-1");
  });

  it("prevents employees from reading or clocking another employee schedule", async () => {
    auth.user = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: "rest-1",
    };
    serviceFns.getSchedule.mockResolvedValueOnce({ id: 10, employeeId: 99 });

    let res = await request("/schedules/10");
    expect(res.status).toBe(403);
    expect(serviceFns.getSchedule).toHaveBeenCalledWith(10, "rest-1");

    // Body employeeId is ignored — identity comes from the session, and the
    // schedule belongs to someone else, so the clock action is refused.
    serviceFns.getScheduleById.mockResolvedValueOnce({
      id: 10,
      employeeId: 99,
    });
    res = await request("/schedules/10/clock-in", "POST", {
      scheduleId: 10,
      employeeId: 99,
      notes: "late",
    });
    expect(res.status).toBe(403);
    expect(serviceFns.clockIn).not.toHaveBeenCalled();
  });

  it("clocks employees in and out with current timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T01:00:00.000Z"));
    auth.user = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: "rest-1",
    };

    let res = await request("/schedules/10/clock-in", "POST", {
      scheduleId: 10,
      employeeId: "42",
      notes: "arrived",
    });
    expect(res.status).toBe(200);
    expect(serviceFns.getScheduleById).toHaveBeenCalledWith(10, "rest-1");
    expect(serviceFns.clockIn).toHaveBeenCalledWith({
      scheduleId: 10,
      employeeId: "user-42",
      clockInTime: new Date("2026-06-10T01:00:00.000Z"),
      notes: "arrived",
      restaurantId: "rest-1",
    });

    res = await request("/schedules/10/clock-out", "POST", {
      scheduleId: 10,
      employeeId: 42,
      notes: "done",
    });
    expect(res.status).toBe(200);
    expect(serviceFns.clockOut).toHaveBeenCalledWith({
      scheduleId: 10,
      employeeId: "user-42",
      clockOutTime: new Date("2026-06-10T01:00:00.000Z"),
      notes: "done",
      restaurantId: "rest-1",
    });
  });

  it("strips the wage snapshot from schedule responses for non-managers, keeps it for owners", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = async (r: Response): Promise<{ data: any }> => r.json();
    const wageRow = {
      id: 10,
      employeeId: "user-42",
      hourlyRateCents: 20000,
      shiftTemplate: { id: 1, name: "Dinner", hourlyRateCents: 15000 },
    };
    serviceFns.getSchedules.mockResolvedValue({ items: [wageRow], total: 1 });
    serviceFns.getSchedule.mockResolvedValue(wageRow);
    serviceFns.clockOut.mockResolvedValue({ id: 10, hourlyRateCents: 20000 });

    let res = await request("/rest-1/schedules");
    expect((await body(res)).data[0].hourlyRateCents).toBe(20000);

    auth.user = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: "rest-1",
    };
    res = await request("/rest-1/schedules");
    const [item] = (await body(res)).data;
    expect(item).not.toHaveProperty("hourlyRateCents");
    // The template rate predates the snapshot and stays visible to staff.
    expect(item.shiftTemplate).toEqual({
      id: 1,
      name: "Dinner",
      hourlyRateCents: 15000,
    });

    res = await request("/schedules/10");
    expect((await body(res)).data).not.toHaveProperty("hourlyRateCents");

    res = await request("/schedules/10/clock-out", "POST", {
      scheduleId: 10,
    });
    expect((await body(res)).data).not.toHaveProperty("hourlyRateCents");
  });

  it("exports attendance reports as CSV with attachment headers", async () => {
    const res = await request(
      "/rest-1/attendance-report/export?startDate=2026-06-10&endDate=2026-06-11&employeeId=42",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="attendance-report-2026-06-10-to-2026-06-11.csv"',
    );
    const body = await res.text();
    expect(body).toContain(
      "Employee Name,Date,Scheduled Start,Scheduled End,Clock In,Clock Out",
    );
    // Resolved display name is emitted, not the raw employee id. Cells are
    // only quoted when the content needs it (shared toCsvRow helper).
    const dataRow = body.trim().split("\n")[1];
    expect(dataRow).toContain("Alice Server");
    expect(dataRow).not.toContain("42");
    expect(serviceFns.getEmployeeNames).toHaveBeenCalledWith([42]);
    expect(serviceFns.getAttendanceReport).toHaveBeenCalledWith("rest-1", {
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      employeeId: "42",
    });
  });

  it("performs admin clock actions from the schedule employee id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T01:00:00.000Z"));
    serviceFns.getScheduleById.mockResolvedValueOnce({
      id: 10,
      employeeId: 99,
    });

    const res = await request("/schedules/10/admin-clock-in", "POST", {
      notes: "manual",
    });

    expect(res.status).toBe(200);
    expect(serviceFns.getScheduleById).toHaveBeenCalledWith(10, "rest-1");
    expect(serviceFns.clockIn).toHaveBeenCalledWith(
      {
        scheduleId: 10,
        employeeId: 99,
        clockInTime: new Date("2026-06-10T01:00:00.000Z"),
        notes: "manual",
        restaurantId: "rest-1",
      },
      true,
    );
  });

  it("normalizes swap request dates and constrains employee swap list filters", async () => {
    auth.user = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: "rest-1",
    };

    let res = await request("/rest-1/swap-requests", "POST", {
      requesterEmployeeId: 42,
      requesterScheduleId: 10,
      requestType: "cover",
      reason: "Appointment",
      expiresAt: 1_780_800_000_000,
    });
    expect(res.status).toBe(201);
    expect(serviceFns.createSwapRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "rest-1",
        requesterEmployeeId: "user-42",
        expiresAt: new Date(1_780_800_000_000),
      }),
    );

    res = await request("/rest-1/swap-requests?requesterEmployeeId=99");
    expect(res.status).toBe(200);
    expect(serviceFns.getSwapRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "rest-1",
        requesterEmployeeId: "user-42",
      }),
    );
  });

  it("accepts and cancels swap requests as the session employee", async () => {
    auth.user = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: "rest-1",
    };

    // Body employeeId is ignored — the session identity is what is recorded.
    let res = await request("/swap-requests/20/accept", "POST", {
      employeeId: 99,
    });
    expect(res.status).toBe(200);
    expect(serviceFns.getSwapRequest).toHaveBeenCalledWith(20, "rest-1");
    expect(serviceFns.acceptSwapRequest).toHaveBeenCalledWith(
      20,
      "user-42",
      "rest-1",
    );

    res = await request("/swap-requests/20/cancel", "POST");
    expect(res.status).toBe(200);
    expect(serviceFns.cancelSwapRequest).toHaveBeenCalledWith(
      20,
      "user-42",
      "rest-1",
    );
  });

  it("approves and rejects swap requests as the session manager, ignoring body managerId", async () => {
    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };

    // A spoofed managerId in the body must never be recorded.
    let res = await request("/swap-requests/20/approve", "POST", {
      managerId: 999,
    });
    expect(res.status).toBe(200);
    expect(serviceFns.getSwapRequest).toHaveBeenCalledWith(20, "rest-1");
    expect(serviceFns.approveSwapRequest).toHaveBeenCalledWith(
      20,
      "user-7",
      "rest-1",
    );

    res = await request("/swap-requests/20/reject", "POST", {
      managerId: 999,
      reason: "coverage unavailable",
    });
    expect(res.status).toBe(200);
    expect(serviceFns.rejectSwapRequest).toHaveBeenCalledWith(
      20,
      "user-7",
      "coverage unavailable",
      "rest-1",
    );
  });

  it("returns 404 for swap request actions outside the caller's restaurant", async () => {
    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };
    serviceFns.getSwapRequest.mockResolvedValue(null);

    const res = await request("/swap-requests/20/approve", "POST", {});
    expect(res.status).toBe(404);
    expect(serviceFns.getSwapRequest).toHaveBeenCalledWith(20, "rest-1");
    expect(serviceFns.approveSwapRequest).not.toHaveBeenCalled();
  });

  it("returns availability, conflicts, and scheduling stats", async () => {
    let res = await request(
      "/rest-1/available-employees?date=2026-06-10&shiftTemplateId=1",
    );
    expect(res.status).toBe(200);
    expect(serviceFns.getAvailableEmployees).toHaveBeenCalledWith({
      restaurantId: "rest-1",
      date: "2026-06-10",
      shiftTemplateId: 1,
    });

    res = await request("/rest-1/conflicts?page=1&limit=5");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
    });

    // Body userId is ignored — the session user (42) is recorded as resolver.
    res = await request("/conflicts/30/resolve", "POST", {
      userId: 7,
      resolutionNotes: "Adjusted shift",
    });
    expect(res.status).toBe(200);
    expect(serviceFns.getConflict).toHaveBeenCalledWith(30, "rest-1");
    expect(serviceFns.resolveConflict).toHaveBeenCalledWith(
      30,
      "user-42",
      "Adjusted shift",
      "rest-1",
    );

    res = await request("/rest-1/stats/daily?date=2026-06-10");
    expect(res.status).toBe(200);
    expect(serviceFns.getDailyStats).toHaveBeenCalledWith(
      "rest-1",
      "2026-06-10",
    );

    res = await request("/rest-1/stats/weekly?weekStartDate=2026-06-08");
    expect(res.status).toBe(200);
    expect(serviceFns.getWeeklySummary).toHaveBeenCalledWith(
      "rest-1",
      "2026-06-08",
    );
  });

  it("binds staff swap request creation to the session employee, ignoring body requesterEmployeeId", async () => {
    auth.user = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: "rest-1",
    };

    const res = await request("/rest-1/swap-requests", "POST", {
      requesterEmployeeId: 99,
      requesterScheduleId: 10,
      requestType: "cover",
      reason: "Appointment",
    });

    expect(res.status).toBe(201);
    expect(serviceFns.createSwapRequest).toHaveBeenCalledOnce();
    expect(serviceFns.createSwapRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "rest-1",
        requesterEmployeeId: "user-42",
      }),
    );
  });

  it("records the session employee as requester even when the body names another", async () => {
    auth.user = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "rest-1",
    };

    const res = await request("/rest-1/swap-requests", "POST", {
      requesterEmployeeId: 99,
      requesterScheduleId: 10,
      requestType: "drop",
      reason: "Sick leave",
    });

    expect(res.status).toBe(201);
    // Not even a manager may file a request in someone else's name: the
    // body's requesterEmployeeId is not a schema field and is dropped.
    expect(serviceFns.createSwapRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "rest-1",
        requesterEmployeeId: "user-7",
      }),
    );
  });

  it("scopes cross-tenant template and schedule access to the caller's restaurant", async () => {
    // A shop owner from rest-1 probing another tenant's template id gets 404.
    serviceFns.getShiftTemplate.mockResolvedValue(null);
    let res = await request("/templates/555");
    expect(res.status).toBe(404);
    expect(serviceFns.getShiftTemplate).toHaveBeenCalledWith(555, "rest-1");

    res = await request("/templates/555", "PUT", { name: "Hijack" });
    expect(res.status).toBe(404);
    expect(serviceFns.updateShiftTemplate).not.toHaveBeenCalled();

    // Same for a schedule id belonging to another restaurant.
    serviceFns.getScheduleById.mockResolvedValue(null);
    res = await request("/schedules/777", "PUT", { status: "cancelled" });
    expect(res.status).toBe(404);
    expect(serviceFns.getScheduleById).toHaveBeenCalledWith(777, "rest-1");
    expect(serviceFns.updateSchedule).not.toHaveBeenCalled();

    serviceFns.getSchedule.mockResolvedValue(null);
    res = await request("/schedules/777");
    expect(res.status).toBe(404);
    expect(serviceFns.getSchedule).toHaveBeenCalledWith(777, "rest-1");
  });

  it("leaves platform admins unscoped for ID-addressed reads", async () => {
    auth.user = {
      id: "user-1",
      username: "admin",
      role: 0,
      restaurantId: undefined,
    };

    let res = await request("/templates/5");
    expect(res.status).toBe(200);
    expect(serviceFns.getShiftTemplate).toHaveBeenCalledWith(5, undefined);

    res = await request("/conflicts/30");
    expect(res.status).toBe(200);
    expect(serviceFns.getConflict).toHaveBeenCalledWith(30, undefined);
  });

  it("rejects non-admin users without a restaurant binding", async () => {
    auth.user = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: undefined,
    };

    const res = await request("/schedules/10");
    expect(res.status).toBe(403);
    expect(serviceFns.getSchedule).not.toHaveBeenCalled();
  });
});
