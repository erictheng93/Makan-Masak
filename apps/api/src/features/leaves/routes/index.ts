/**
 * Leave Management Routes
 * All HTTP routes for employee leave/time-off management
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

// Import schemas
import { leaveSchemas, calculateLeaveDays } from "../schemas/validation";

// Import service
import { LeaveService } from "@makanmasak/database";

const app = new Hono<{ Bindings: Env }>();

interface SessionUser {
  id: string | number;
  role: number;
  restaurantId?: string | number | null;
}

/**
 * Tenant scope for the authenticated caller.
 *
 * Platform admins (role 0) are unscoped (undefined); every other role is
 * limited to its own restaurant. A non-admin without a restaurant binding has
 * no tenant to act in, so access is denied.
 */
function callerRestaurantId(user: SessionUser): string | undefined {
  if (user.role === USER_ROLES.ADMIN) {
    return undefined;
  }
  if (user.restaurantId == null) {
    throw forbidden("Access denied");
  }
  return String(user.restaurantId);
}

// ========================================
// Leave Types Management
// ========================================

// GET /:restaurantId/types - Get all leave types
//
// Readable by every role in the restaurant, unlike the POST/PUT/DELETE below.
// An employee may file a leave request (POST /:restaurantId/requests carries no
// requireRole), and the request form cannot offer a leave type it is not
// allowed to list -- the manager-only read made the employee-facing write
// unusable (#344). requireRestaurantAccess still confines the read to the
// caller's own restaurant, and a leave type is non-secret config: code, name,
// accrual policy.
app.get(
  "/:restaurantId/types",
  authMiddleware,
  requireRestaurantAccess("restaurantId"),
  validateParams(leaveSchemas.restaurantIdParam),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const service = new LeaveService(c.env.DB, c.env);

    const types = await service.getLeaveTypes(restaurantId);

    return c.json(createSuccessResponse(types), HTTP_STATUS.OK);
  },
);

// GET /types/:id - Get a specific leave type
app.get(
  "/types/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(leaveSchemas.leaveTypeIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    // Tenant-scoped read: own types plus system-wide types.
    const type = await service.getLeaveType(id, callerRestaurantId(user));

    if (!type) {
      throw notFound("Leave type not found");
    }

    return c.json(createSuccessResponse(type), HTTP_STATUS.OK);
  },
);

// POST /:restaurantId/types - Create a new leave type
app.post(
  "/:restaurantId/types",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(leaveSchemas.restaurantIdParam),
  validateBody(leaveSchemas.createLeaveType),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    const type = await service.createLeaveType({
      ...data,
      restaurantId,
      createdBy: user.id,
    });

    return c.json(
      createSuccessResponse(type, "Leave type created successfully"),
      HTTP_STATUS.CREATED,
    );
  },
);

// PUT /types/:id - Update a leave type
app.put(
  "/types/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(leaveSchemas.leaveTypeIdParam),
  validateBody(leaveSchemas.updateLeaveType),
  async (c) => {
    const { id } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    const scope = callerRestaurantId(user);

    // Tenant-scoped existence check. System-wide types (restaurantId null)
    // are readable by tenants but only mutable by platform admins.
    const existing = await service.getLeaveType(id, scope);
    if (!existing || (scope !== undefined && existing.restaurantId !== scope)) {
      throw notFound("Leave type not found");
    }

    const type = await service.updateLeaveType(
      id,
      {
        ...data,
        updatedBy: user.id,
      },
      scope,
    );

    return c.json(
      createSuccessResponse(type, "Leave type updated successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// DELETE /types/:id - Delete a leave type
app.delete(
  "/types/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(leaveSchemas.leaveTypeIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    // Tenant-scoped delete: cross-tenant and system-wide types read as missing.
    const deleted = await service.deleteLeaveType(id, callerRestaurantId(user));

    if (!deleted) {
      throw notFound("Leave type not found or cannot be deleted");
    }

    return c.json(
      createSuccessResponse(null, "Leave type deleted successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Leave Balance Management
// ========================================

// GET /balances - Get employee leave balances
app.get(
  "/balances",
  authMiddleware,
  validateQuery(leaveSchemas.leaveBalanceQuery),
  async (c) => {
    const query = c.get("validatedQuery");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    // Check access: employees can only view their own balances
    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.OWNER) {
      if (query.employeeId !== String(user.id)) {
        throw forbidden("Access denied");
      }
    }

    const year = query.year || new Date().getFullYear();
    // Owners are scoped to their restaurant; platform admins are unscoped.
    const balances = await service.getEmployeeLeaveBalances(
      query.employeeId,
      year,
      callerRestaurantId(user),
    );

    return c.json(createSuccessResponse(balances), HTTP_STATUS.OK);
  },
);

// POST /balances/adjust - Manually adjust leave balance
app.post(
  "/balances/adjust",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateBody(leaveSchemas.adjustLeaveBalance),
  async (c) => {
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    // adjustedBy always comes from the session; the service verifies the
    // target employee belongs to the caller's restaurant when scoped.
    const balance = await service.adjustLeaveBalance({
      ...data,
      adjustedBy: String(user.id),
      restaurantId: callerRestaurantId(user),
    });

    return c.json(
      createSuccessResponse(balance, "Leave balance adjusted successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// GET /:restaurantId/balances - Get all leave balances for a restaurant (bulk)
app.get(
  "/:restaurantId/balances",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(leaveSchemas.restaurantIdParam),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const url = new URL(c.req.url);
    const yearParam = url.searchParams.get("year");
    const year = yearParam ? Number(yearParam) : new Date().getFullYear();
    const service = new LeaveService(c.env.DB, c.env);

    const balances = await service.getRestaurantLeaveBalances(
      restaurantId,
      year,
    );

    return c.json(createSuccessResponse(balances), HTTP_STATUS.OK);
  },
);

// POST /:restaurantId/balances/accrue - Accrue leave balances for all employees
app.post(
  "/:restaurantId/balances/accrue",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  requireRestaurantAccess("restaurantId"),
  validateParams(leaveSchemas.restaurantIdParam),
  validateBody(leaveSchemas.accrueLeaveBalances),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { year } = c.get("validatedBody");
    const service = new LeaveService(c.env.DB, c.env);

    const count = await service.accrueLeaveBalances(restaurantId, year);

    return c.json(
      createSuccessResponse(
        { count },
        `Successfully accrued leave balances for ${count} employee-leave type combinations`,
      ),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Leave Request Management
// ========================================

// GET /:restaurantId/requests - Get leave requests with filters
app.get(
  "/:restaurantId/requests",
  authMiddleware,
  requireRestaurantAccess("restaurantId"),
  validateParams(leaveSchemas.restaurantIdParam),
  validateQuery(leaveSchemas.leaveRequestFilters),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const query = c.get("validatedQuery");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    // Always scope results to the restaurant in the URL (access already
    // verified by requireRestaurantAccess); employees can additionally only
    // view their own requests.
    const filters = {
      ...query,
      restaurantId,
      employeeId:
        user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.OWNER
          ? String(user.id)
          : query.employeeId,
    };

    const result = await service.getLeaveRequests(filters);

    return c.json(
      {
        success: true,
        data: result.items,
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

// GET /requests/:id - Get a specific leave request
app.get(
  "/requests/:id",
  authMiddleware,
  validateParams(leaveSchemas.leaveRequestIdParam),
  async (c) => {
    const { id } = c.get("validatedParams");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    // Tenant-scoped read: other restaurants' requests read as not-found.
    const request = await service.getLeaveRequest(id, callerRestaurantId(user));

    if (!request) {
      throw notFound("Leave request not found");
    }

    // Check access
    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.OWNER) {
      if (String(request.employeeId) !== String(user.id)) {
        throw forbidden("Access denied");
      }
    }

    return c.json(createSuccessResponse(request), HTTP_STATUS.OK);
  },
);

// POST /:restaurantId/requests - Create a new leave request
app.post(
  "/:restaurantId/requests",
  authMiddleware,
  requireRestaurantAccess("restaurantId"),
  validateParams(leaveSchemas.restaurantIdParam),
  validateBody(leaveSchemas.createLeaveRequest),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const data = c.get("validatedBody");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    // Calculate total days
    const totalDays = calculateLeaveDays(
      data.startDate,
      data.endDate,
      data.startPeriod,
      data.endPeriod,
    );

    // Identity binding: self-service requests are always filed for the
    // session user. Only admins/owners may file on behalf of another
    // employee, and the service verifies that employee belongs to this
    // restaurant.
    const isManager =
      user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.OWNER;
    const employeeId =
      isManager && data.employeeId != null ? data.employeeId : String(user.id);
    const { employeeId: _bodyEmployeeId, ...requestData } = data;

    // Check if employee has sufficient balance (scoped to this restaurant so
    // cross-tenant balances cannot be probed)
    const balance = await service.getLeaveBalance(
      employeeId,
      data.leaveTypeId,
      new Date().getFullYear(),
      restaurantId,
    );

    if (balance && balance.remainingDays < totalDays) {
      throw badRequest(
        `Insufficient leave balance. Available: ${balance.remainingDays} days, Requested: ${totalDays} days`,
      );
    }

    let request;
    try {
      request = await service.createLeaveRequest({
        ...requestData,
        employeeId,
        restaurantId,
        totalDays,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "Employee not found in restaurant" ||
          error.message === "Leave type not found")
      ) {
        throw notFound(error.message);
      }
      throw error;
    }

    return c.json(
      createSuccessResponse(request, "Leave request created successfully"),
      HTTP_STATUS.CREATED,
    );
  },
);

// POST /requests/:id/approve - Approve a leave request
app.post(
  "/requests/:id/approve",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(leaveSchemas.leaveRequestIdParam),
  validateBody(leaveSchemas.approveLeaveRequest),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { comments } = c.get("validatedBody");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    const scope = callerRestaurantId(user);

    // Tenant-scoped lookup: requests from other restaurants read as missing.
    const target = await service.getLeaveRequest(id, scope);
    if (!target) {
      throw notFound("Leave request not found");
    }

    // Approver identity always comes from the session.
    const request = await service.approveLeaveRequest(
      id,
      String(user.id),
      comments,
      scope,
    );

    return c.json(
      createSuccessResponse(request, "Leave request approved successfully"),
      HTTP_STATUS.OK,
    );
  },
);

// POST /requests/:id/reject - Reject a leave request
app.post(
  "/requests/:id/reject",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(leaveSchemas.leaveRequestIdParam),
  validateBody(leaveSchemas.rejectLeaveRequest),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { reason } = c.get("validatedBody");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    const scope = callerRestaurantId(user);

    // Tenant-scoped lookup: requests from other restaurants read as missing.
    const target = await service.getLeaveRequest(id, scope);
    if (!target) {
      throw notFound("Leave request not found");
    }

    // Reviewer identity always comes from the session.
    const request = await service.rejectLeaveRequest(
      id,
      String(user.id),
      reason,
      scope,
    );

    return c.json(
      createSuccessResponse(request, "Leave request rejected"),
      HTTP_STATUS.OK,
    );
  },
);

// POST /requests/:id/cancel - Cancel a leave request
app.post(
  "/requests/:id/cancel",
  authMiddleware,
  validateParams(leaveSchemas.leaveRequestIdParam),
  validateBody(leaveSchemas.cancelLeaveRequest),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { reason } = c.get("validatedBody");
    const user = c.get("user");
    const service = new LeaveService(c.env.DB, c.env);

    const scope = callerRestaurantId(user);

    // Check if user is cancelling their own request or is admin/owner
    // (tenant-scoped: other restaurants' requests read as missing)
    const request = await service.getLeaveRequest(id, scope);
    if (!request) {
      throw notFound("Leave request not found");
    }

    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.OWNER) {
      if (String(request.employeeId) !== String(user.id)) {
        throw forbidden("Access denied");
      }
    }

    // Canceller identity always comes from the session.
    const cancelledRequest = await service.cancelLeaveRequest(
      id,
      String(user.id),
      reason,
      scope,
    );

    return c.json(
      createSuccessResponse(
        cancelledRequest,
        "Leave request cancelled successfully",
      ),
      HTTP_STATUS.OK,
    );
  },
);

// ========================================
// Holiday Calendar
// ========================================

// GET /:restaurantId/holidays - Get holidays for a year
app.get(
  "/:restaurantId/holidays",
  authMiddleware,
  requireRestaurantAccess("restaurantId"),
  validateParams(leaveSchemas.restaurantIdParam),
  validateQuery(leaveSchemas.holidaysQuery),
  async (c) => {
    const { restaurantId } = c.get("validatedParams");
    const { year } = c.get("validatedQuery");
    const service = new LeaveService(c.env.DB, c.env);

    const holidays = await service.getHolidays(restaurantId, year);

    return c.json(createSuccessResponse(holidays), HTTP_STATUS.OK);
  },
);

// GET /:restaurantId/working-day/:date - Check if a date is a working day
app.get(
  "/:restaurantId/working-day/:date",
  authMiddleware,
  requireRestaurantAccess("restaurantId"),
  validateParams(leaveSchemas.workingDayParam),
  async (c) => {
    const { restaurantId, date } = c.get("validatedParams");
    const service = new LeaveService(c.env.DB, c.env);

    const isWorking = await service.isWorkingDay(restaurantId, date);

    return c.json(
      createSuccessResponse({ date, isWorkingDay: isWorking }),
      HTTP_STATUS.OK,
    );
  },
);

export default app;
