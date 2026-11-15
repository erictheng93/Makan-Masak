/**
 * Employee Scheduling Routes
 * All HTTP routes for employee work scheduling management
 */

import { Hono } from "hono";
import {
  authMiddleware,
  requireRole,
  requireRestaurantAccess,
} from "../../../shared/middleware";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../shared/middleware";
import type { Env } from "../../../shared/types";
import { HTTP_STATUS, USER_ROLES } from "../../../shared/constants";
import { createSuccessResponse } from "../../../shared/utils";
import {
  notFound,
  forbidden,
  badRequest,
} from "../../../shared/utils/api-error";
import { resolveRestaurantCurrency } from "../../../shared/utils/restaurant-currency";
import { isCurrencyAlignedCents } from "@makanmasak/utils";
import { toCsvRow } from "../../../shared/utils/csv";

// Import schemas
import { schedulingSchemas } from "../schemas/validation";

// Import service
import { SchedulingService } from "@makanmasak/database";

const app = new Hono<{ Bindings: Env }>();

/** Create SchedulingService from Hono context */
function createService(env: Env): SchedulingService {
  return new SchedulingService(env.DB, env);
}

/** Check if user is admin or shop owner */
function isManager(role: number): boolean {
  return role === USER_ROLES.ADMIN || role === USER_ROLES.OWNER;
}

/**
 * The per-shift wage snapshot is for owners and admins. Roles 2-4 read their
 * own schedules, so strip it. The embedded shift template (and its rate) was
 * already visible to staff before the snapshot existed, so it stays.
 */
function redactWage<T extends object>(role: number, row: T): T {
  if (isManager(role)) return row;
  const { hourlyRateCents: _snapshot, ...rest } = row as Record<
    string,
    unknown
  >;
  return rest as T;
}

function userIdString(user: { id: string | number }): string {
  return String(user.id);
}

/**
 * Tenant scope for ID-addressed service calls.
 * Platform admins (role 0) are unscoped (`undefined`); everyone else is
 * restricted to their own restaurant. A non-admin without a restaurant
 * binding has no legitimate scope and is rejected outright.
 */
function callerRestaurantId(user: {
  role: number;
  restaurantId?: string | number | null;
}): string | undefined {
  if (user.role === USER_ROLES.ADMIN) {
    return undefined;
  }
  if (user.restaurantId === undefined || user.restaurantId === null) {
    throw forbidden("Access denied to this restaurant");
  }
  return String(user.restaurantId);
}

// ========================================
// Shift Template Management
// ========================================

// GET /:restaurantId/templates - Get all shift templates
app.get(
  "/:restaurantId/templates",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const service = createService(c.env);

    const templates = await service.getShiftTemplates(restaurantId);

    return c.json(createSuccessResponse(templates), HTTP_STATUS.OK);
  },
);

// GET /templates/:id - Get a specific shift template
app.get(
  "/templates/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.shiftTemplateIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = createService(c.env);

    const template = await service.getShiftTemplate(
      id,
      callerRestaurantId(user),
    );

    if (!template) {
      throw notFound("Shift template not found");
    }

    return c.json(createSuccessResponse(template), HTTP_STATUS.OK);
  },
);

// POST /:restaurantId/templates - Create a new shift template
app.post(
  "/:restaurantId/templates",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateBody(schedulingSchemas.createShiftTemplate),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);

    const template = await service.createShiftTemplate({
      ...data,
      restaurantId,
      createdBy: userIdString(user),
    });

    return c.json(
      createSuccessResponse(template, "Shift template created successfully"),
      HTTP_STATUS.CREATED,
    );
  },
);

// PUT /templates/:id - Update a shift template
app.put(
  "/templates/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.shiftTemplateIdParam),
  validateBody(schedulingSchemas.updateShiftTemplate),
  async (c) => {
    const { id } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    const existing = await service.getShiftTemplate(id, restaurantId);
    if (!existing) {
      throw notFound("Shift template not found");
    }

    const template = await service.updateShiftTemplate(
      id,
      {
        ...data,
        updatedBy: userIdString(user),
      },
      restaurantId,
    );

    return c.json(
      createSuccessResponse(template, "Shift template updated successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// DELETE /templates/:id - Delete a shift template
app.delete(
  "/templates/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.shiftTemplateIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = createService(c.env);

    const deleted = await service.deleteShiftTemplate(
      id,
      callerRestaurantId(user),
    );

    if (!deleted) {
      throw notFound("Shift template not found");
    }

    return c.json(
      createSuccessResponse(null, "Shift template deleted successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Employee Schedule Management
// ========================================

// GET /:restaurantId/schedules - Get employee schedules with filters
app.get(
  "/:restaurantId/schedules",
  authMiddleware,
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateQuery(schedulingSchemas.scheduleFilters),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const query = c.get("validatedQuery");
    const user = c.get("user");
    const service = createService(c.env);

    // Employees can only view their own schedules
    const filters = {
      ...query,
      restaurantId,
      employeeId: !isManager(user.role) ? userIdString(user) : query.employeeId,
    };

    const result = await service.getSchedules(filters);

    return c.json(
      {
        success: true,
        data: result.items.map((item) => redactWage(user.role, item)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / query.limit),
        },
      },
      HTTP_STATUS.OK,
    );
  },
);

// GET /schedules/:id - Get a specific schedule
app.get(
  "/schedules/:id",
  authMiddleware,
  validateParams(schedulingSchemas.scheduleIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = createService(c.env);

    const schedule = await service.getSchedule(id, callerRestaurantId(user));

    if (!schedule) {
      throw notFound("Schedule not found");
    }

    // Check access
    if (!isManager(user.role)) {
      if (String(schedule.employeeId) !== userIdString(user)) {
        throw forbidden("Access denied");
      }
    }

    return c.json(
      createSuccessResponse(redactWage(user.role, schedule)),
      HTTP_STATUS.OK,
    );
  },
);

// POST /:restaurantId/schedules - Create a new schedule
app.post(
  "/:restaurantId/schedules",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateBody(schedulingSchemas.createEmployeeSchedule),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);

    const schedule = await service.createSchedule({
      ...data,
      restaurantId,
      createdBy: userIdString(user),
    });

    return c.json(
      createSuccessResponse(schedule, "Schedule created successfully"),
      HTTP_STATUS.CREATED,
    );
  },
);

// POST /:restaurantId/schedules/bulk - Bulk create schedules
app.post(
  "/:restaurantId/schedules/bulk",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateBody(schedulingSchemas.bulkCreateSchedules),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);

    const count = await service.bulkCreateSchedules({
      ...data,
      restaurantId,
      createdBy: userIdString(user),
    });

    return c.json(
      createSuccessResponse(
        { count },
        `Successfully created ${count} schedules`,
      ),
      HTTP_STATUS.CREATED,
    );
  },
);

// PUT /schedules/:id - Update a schedule
app.put(
  "/schedules/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.scheduleIdParam),
  validateBody(schedulingSchemas.updateEmployeeSchedule),
  async (c) => {
    const { id } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    const existing = await service.getScheduleById(id, restaurantId);
    if (!existing) {
      throw notFound("Schedule not found");
    }
    if (data.hourlyRateCents !== undefined) {
      if ((data.status ?? existing.status) !== "completed") {
        throw badRequest(
          "Only a completed shift has a wage snapshot",
          "SCHEDULE_NOT_COMPLETED",
        );
      }
      if (data.hourlyRateCents !== null) {
        const currency = await resolveRestaurantCurrency(
          c.env.DB,
          existing.restaurantId,
        );
        if (!isCurrencyAlignedCents(data.hourlyRateCents, currency)) {
          throw badRequest(
            `Hourly rate must be a whole ${currency} amount`,
            "CURRENCY_PRECISION",
          );
        }
      }
    }

    const schedule = await service.updateSchedule(
      id,
      {
        ...data,
        updatedBy: userIdString(user),
      },
      restaurantId,
    );

    return c.json(
      createSuccessResponse(schedule, "Schedule updated successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// DELETE /schedules/:id - Delete (cancel) a schedule
app.delete(
  "/schedules/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.scheduleIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = createService(c.env);

    const deleted = await service.deleteSchedule(id, callerRestaurantId(user));

    if (!deleted) {
      throw notFound("Schedule not found");
    }

    return c.json(
      createSuccessResponse(null, "Schedule cancelled successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Clock In/Out
// ========================================

// POST /schedules/:id/clock-in - Clock in to a shift
app.post(
  "/schedules/:id/clock-in",
  authMiddleware,
  validateParams(schedulingSchemas.scheduleIdParam),
  validateBody(schedulingSchemas.clockIn),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { employeeId: bodyEmployeeId, notes } = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    // Non-managers always clock in as themselves (session identity);
    // managers may clock in a specific employee within their restaurant.
    const employeeId =
      isManager(user.role) && bodyEmployeeId
        ? bodyEmployeeId
        : userIdString(user);

    const existing = await service.getScheduleById(id, restaurantId);
    if (!existing) {
      throw notFound("Schedule not found");
    }
    if (!isManager(user.role) && String(existing.employeeId) !== employeeId) {
      throw forbidden("Access denied");
    }

    const schedule = await service.clockIn({
      scheduleId: id,
      employeeId,
      clockInTime: new Date(),
      notes,
      restaurantId,
    });

    return c.json(
      createSuccessResponse(
        redactWage(user.role, schedule),
        "Clocked in successfully",
      ),
      HTTP_STATUS.OK,
    );
  },
);

// POST /schedules/:id/clock-out - Clock out from a shift
app.post(
  "/schedules/:id/clock-out",
  authMiddleware,
  validateParams(schedulingSchemas.scheduleIdParam),
  validateBody(schedulingSchemas.clockOut),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { employeeId: bodyEmployeeId, notes } = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    // Non-managers always clock out as themselves (session identity);
    // managers may clock out a specific employee within their restaurant.
    const employeeId =
      isManager(user.role) && bodyEmployeeId
        ? bodyEmployeeId
        : userIdString(user);

    const existing = await service.getScheduleById(id, restaurantId);
    if (!existing) {
      throw notFound("Schedule not found");
    }
    if (!isManager(user.role) && String(existing.employeeId) !== employeeId) {
      throw forbidden("Access denied");
    }

    const schedule = await service.clockOut({
      scheduleId: id,
      employeeId,
      clockOutTime: new Date(),
      notes,
      restaurantId,
    });

    return c.json(
      createSuccessResponse(
        redactWage(user.role, schedule),
        "Clocked out successfully",
      ),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Currently Clocked-In & Attendance Reports
// ========================================

// GET /:restaurantId/clocked-in - Get currently clocked-in employees
app.get(
  "/:restaurantId/clocked-in",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const service = createService(c.env);

    const employees = await service.getClockedInEmployees(restaurantId);

    return c.json(
      createSuccessResponse(
        employees,
        `Found ${employees.length} currently clocked-in employees`,
      ),
      HTTP_STATUS.OK,
    );
  },
);

// GET /:restaurantId/attendance-report - Get attendance report
app.get(
  "/:restaurantId/attendance-report",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateQuery(schedulingSchemas.attendanceReportQuery),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { startDate, endDate, employeeId } = c.get("validatedQuery");
    const service = createService(c.env);

    const report = await service.getAttendanceReport(restaurantId, {
      startDate,
      endDate,
      employeeId,
    });

    return c.json(
      createSuccessResponse(report, "Attendance report retrieved successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// GET /:restaurantId/attendance-report/export - Export attendance report as CSV
app.get(
  "/:restaurantId/attendance-report/export",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateQuery(schedulingSchemas.attendanceReportQuery),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { startDate, endDate, employeeId } = c.get("validatedQuery");
    const service = createService(c.env);

    const report = await service.getAttendanceReport(restaurantId, {
      startDate,
      endDate,
      employeeId,
    });

    // Build CSV
    const headers = [
      "Employee Name",
      "Date",
      "Scheduled Start",
      "Scheduled End",
      "Clock In",
      "Clock Out",
      "Scheduled Hours",
      "Actual Hours",
      "Overtime",
      "Status",
    ];

    // Resolve employee display names for the CSV (records only carry ids).
    const nameMap = await service.getEmployeeNames(
      report.records.map((r) => r.employeeId),
    );

    const rows = report.records.map((r) => {
      // Names are free text — toCsvRow handles quoting and neutralizes cells
      // that a spreadsheet would otherwise evaluate as a formula.
      const employeeName = nameMap.get(r.employeeId) || r.employeeId;
      const clockIn = r.clockInTime
        ? new Date(r.clockInTime).toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      const clockOut = r.clockOutTime
        ? new Date(r.clockOutTime).toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

      return toCsvRow([
        employeeName,
        r.workDate,
        r.startTime,
        r.endTime,
        clockIn,
        clockOut,
        r.scheduledHours,
        r.actualHours || 0,
        r.overtimeHours || 0,
        r.status,
      ]);
    });

    const csv = [toCsvRow(headers), ...rows].join("\n");
    const filename = `attendance-report-${startDate}-to-${endDate}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);

// POST /schedules/:id/admin-clock-in - Admin clock-in for employee
app.post(
  "/schedules/:id/admin-clock-in",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.scheduleIdParam),
  validateBody(schedulingSchemas.adminClock),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { notes } = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    const existingSchedule = await service.getScheduleById(id, restaurantId);
    if (!existingSchedule) {
      throw notFound("Schedule not found");
    }

    const schedule = await service.clockIn(
      {
        scheduleId: id,
        employeeId: existingSchedule.employeeId,
        clockInTime: new Date(),
        notes,
        restaurantId,
      },
      true, // isAdmin
    );

    return c.json(
      createSuccessResponse(schedule, "Admin clock-in successful"),
      HTTP_STATUS.OK,
    );
  },
);

// POST /schedules/:id/admin-clock-out - Admin clock-out for employee
app.post(
  "/schedules/:id/admin-clock-out",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.scheduleIdParam),
  validateBody(schedulingSchemas.adminClock),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { notes } = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    const existingSchedule = await service.getScheduleById(id, restaurantId);
    if (!existingSchedule) {
      throw notFound("Schedule not found");
    }

    const schedule = await service.clockOut(
      {
        scheduleId: id,
        employeeId: existingSchedule.employeeId,
        clockOutTime: new Date(),
        notes,
        restaurantId,
      },
      true, // isAdmin
    );

    return c.json(
      createSuccessResponse(schedule, "Admin clock-out successful"),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Swap Requests
// ========================================

// POST /:restaurantId/swap-requests - Create a swap request
app.post(
  "/:restaurantId/swap-requests",
  authMiddleware,
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateBody(schedulingSchemas.createSwapRequest),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);

    // The requester is always the session user — the body cannot name one.
    const { expiresAt, ...rest } = data;

    const request = await service.createSwapRequest({
      ...rest,
      restaurantId,
      requesterEmployeeId: userIdString(user),
      expiresAt: expiresAt == null ? null : new Date(expiresAt),
    });

    return c.json(
      createSuccessResponse(request, "Swap request created successfully"),
      HTTP_STATUS.CREATED,
    );
  },
);

// GET /:restaurantId/swap-requests - Get swap requests with filters
app.get(
  "/:restaurantId/swap-requests",
  authMiddleware,
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateQuery(schedulingSchemas.swapRequestFilters),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const filters = c.get("validatedQuery");
    const user = c.get("user");
    const service = createService(c.env);

    // Employees can only view their own swap requests
    const swapFilters = {
      ...filters,
      restaurantId,
      requesterEmployeeId: !isManager(user.role)
        ? userIdString(user)
        : filters.requesterEmployeeId,
    };

    const result = await service.getSwapRequests(swapFilters);

    return c.json(
      {
        success: true,
        data: result.items,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / filters.limit),
        },
      },
      HTTP_STATUS.OK,
    );
  },
);

// POST /swap-requests/:id/accept - Accept a swap request (employee)
// The accepting employee is always the authenticated session user.
app.post(
  "/swap-requests/:id/accept",
  authMiddleware,
  validateParams(schedulingSchemas.swapRequestIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    const existing = await service.getSwapRequest(id, restaurantId);
    if (!existing) {
      throw notFound("Swap request not found");
    }

    const request = await service.acceptSwapRequest(
      id,
      userIdString(user),
      restaurantId,
    );

    return c.json(
      createSuccessResponse(request, "Swap request accepted successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// POST /swap-requests/:id/approve - Approve a swap request (manager)
// The approving manager is always the authenticated session user.
app.post(
  "/swap-requests/:id/approve",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.swapRequestIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    const existing = await service.getSwapRequest(id, restaurantId);
    if (!existing) {
      throw notFound("Swap request not found");
    }

    const request = await service.approveSwapRequest(
      id,
      userIdString(user),
      restaurantId,
    );

    return c.json(
      createSuccessResponse(request, "Swap request approved successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// POST /swap-requests/:id/reject - Reject a swap request (manager)
// The rejecting manager is always the authenticated session user.
app.post(
  "/swap-requests/:id/reject",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.swapRequestIdParam),
  validateBody(schedulingSchemas.rejectSwapRequest),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { reason } = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    const existing = await service.getSwapRequest(id, restaurantId);
    if (!existing) {
      throw notFound("Swap request not found");
    }

    const request = await service.rejectSwapRequest(
      id,
      userIdString(user),
      reason,
      restaurantId,
    );

    return c.json(
      createSuccessResponse(request, "Swap request rejected successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// POST /swap-requests/:id/cancel - Cancel a swap request (requester)
app.post(
  "/swap-requests/:id/cancel",
  authMiddleware,
  validateParams(schedulingSchemas.swapRequestIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    const existing = await service.getSwapRequest(id, restaurantId);
    if (!existing) {
      throw notFound("Swap request not found");
    }

    const request = await service.cancelSwapRequest(
      id,
      userIdString(user),
      restaurantId,
    );

    return c.json(
      createSuccessResponse(request, "Swap request cancelled successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Available Employees (Leave Integration)
// ========================================

// GET /:restaurantId/available-employees - Get available employees for scheduling
// Filters out employees on approved leave and already scheduled
app.get(
  "/:restaurantId/available-employees",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateQuery(schedulingSchemas.availableEmployeesQuery),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { date, shiftTemplateId } = c.get("validatedQuery");
    const service = createService(c.env);

    const availableEmployees = await service.getAvailableEmployees({
      restaurantId,
      date,
      shiftTemplateId,
    });

    return c.json(
      createSuccessResponse(
        availableEmployees,
        `Found ${availableEmployees.length} available employees for ${date}`,
      ),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Conflict Management
// ========================================

// GET /:restaurantId/conflicts - Get scheduling conflicts
app.get(
  "/:restaurantId/conflicts",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateQuery(schedulingSchemas.conflictFilters),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const filters = c.get("validatedQuery");
    const service = createService(c.env);

    const result = await service.getConflicts({
      ...filters,
      restaurantId,
    });

    return c.json(
      {
        success: true,
        data: result.items,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / filters.limit),
        },
      },
      HTTP_STATUS.OK,
    );
  },
);

// GET /conflicts/:id - Get a specific conflict
app.get(
  "/conflicts/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.conflictIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = createService(c.env);

    const conflict = await service.getConflict(id, callerRestaurantId(user));

    if (!conflict) {
      throw notFound("Conflict not found");
    }

    return c.json(createSuccessResponse(conflict), HTTP_STATUS.OK);
  },
);

// POST /conflicts/:id/resolve - Resolve a conflict
// The resolving user is always the authenticated session user.
app.post(
  "/conflicts/:id/resolve",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(schedulingSchemas.conflictIdParam),
  validateBody(schedulingSchemas.resolveConflict),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { resolutionNotes } = c.get("validatedBody");
    const user = c.get("user");
    const service = createService(c.env);
    const restaurantId = callerRestaurantId(user);

    const existing = await service.getConflict(id, restaurantId);
    if (!existing) {
      throw notFound("Conflict not found");
    }

    const conflict = await service.resolveConflict(
      id,
      userIdString(user),
      resolutionNotes,
      restaurantId,
    );

    return c.json(
      createSuccessResponse(conflict, "Conflict resolved successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Statistics & Analytics
// ========================================

// GET /:restaurantId/stats/daily - Get daily scheduling statistics
app.get(
  "/:restaurantId/stats/daily",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateQuery(schedulingSchemas.statsQuery),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { date } = c.get("validatedQuery");
    const service = createService(c.env);

    const stats = await service.getDailyStats(restaurantId, date);

    return c.json(
      createSuccessResponse(stats, "Daily statistics retrieved successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// GET /:restaurantId/stats/weekly - Get weekly schedule summary
app.get(
  "/:restaurantId/stats/weekly",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(schedulingSchemas.restaurantIdParam),
  validateQuery(schedulingSchemas.weeklySummaryQuery),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { weekStartDate } = c.get("validatedQuery");
    const service = createService(c.env);

    const summary = await service.getWeeklySummary(restaurantId, weekStartDate);

    return c.json(
      createSuccessResponse(summary, "Weekly summary retrieved successfully"),
      HTTP_STATUS.OK,
    );
  },
);

export default app;
