/**
 * Leave Management Validation Schemas
 * Zod schemas for validating leave-related requests
 */

import { z } from "zod";
import {
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";
import { httpUrlSchema } from "../../../shared/utils/url";

// Base validation schemas
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.lazy(() => z.number().int().min(0));
const nonNegativeNumber = z.lazy(() => z.number().min(0));
// `.trim()` before `.min(1)` — the reverse order measures the untrimmed string,
// so a whitespace-only value passes and is stored as "". See the same note in
// features/menu/schemas/validation.ts.
const nonEmptyString = z.string().trim().min(1);
const idString = z.preprocess((value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return value;
}, nonEmptyString);
const optionalUrl = httpUrlSchema.optional();
const dateString = z.lazy(() =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
);
const yearInteger = z.lazy(() => z.number().int().min(2020).max(2100));
// Restaurant ID: UUID v7 format
const restaurantIdString = z.uuid("Restaurant ID must be a valid UUID");

// Leave Type Schemas
/**
 * Field shape without creation defaults.
 *
 * updateLeaveTypeSchema partial()s this rather than the create schema. Zod 4's
 * .partial() does NOT strip .default(), so partialling the create schema made
 * all eleven defaulted fields materialise on an absent key — including isPaid
 * and paymentRate — and the update path writes every present key, so editing
 * one field silently reset the rest.
 */
const leaveTypeShapeSchema = z.object({
  restaurantId: restaurantIdString.optional().nullable(),
  code: nonEmptyString
    .max(20)
    .regex(/^[A-Z_]+$/, "Code must be uppercase letters and underscores"),
  name: nonEmptyString.max(50),
  description: z.string().max(500).optional().nullable(),

  // Accrual Rules
  accrualType: z.enum(["yearly", "monthly", "none"]),
  accrualAmount: nonNegativeNumber,
  accrualBasedOnSeniority: z.boolean().optional(),

  // Usage Rules
  requiresApproval: z.boolean().optional(),
  requiredApprovalLevels: positiveInteger.max(5).optional(),
  minNoticeDays: nonNegativeInteger.optional(),
  maxConsecutiveDays: positiveInteger.optional().nullable(),
  canCarryover: z.boolean().optional(),
  carryoverMaxDays: nonNegativeNumber.optional().nullable(),
  carryoverExpiryMonths: positiveInteger.optional().nullable(),

  // Documentation & Payment
  requiresDocumentation: z.boolean().optional(),
  documentationRequiredAfterDays: positiveInteger.optional().nullable(),
  isPaid: z.boolean().optional(),
  paymentRate: z.number().min(0).max(1).optional(), // 0.0 to 1.0

  // Restrictions
  allowHalfDay: z.boolean().optional(),
  gender: z.enum(["any", "male", "female"]).optional().nullable(),
  applicableToRoles: z.string().optional().nullable(), // JSON array string
  maxUsagePerYear: nonNegativeNumber.optional().nullable(),

  // System Fields
  isActive: z.boolean().optional(),
  sortOrder: nonNegativeInteger.optional(),
  color: z
    .string()
    .max(7)
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .nullable(),
  icon: z.string().max(50).optional().nullable(),
});

export const createLeaveTypeSchema = z.lazy(() =>
  leaveTypeShapeSchema.extend({
    accrualBasedOnSeniority: z.boolean().default(false),
    requiresApproval: z.boolean().default(true),
    requiredApprovalLevels: positiveInteger.max(5).default(1),
    minNoticeDays: nonNegativeInteger.default(0),
    canCarryover: z.boolean().default(false),
    requiresDocumentation: z.boolean().default(false),
    isPaid: z.boolean().default(true),
    paymentRate: z.number().min(0).max(1).default(1),
    allowHalfDay: z.boolean().default(true),
    isActive: z.boolean().default(true),
    sortOrder: nonNegativeInteger.default(0),
  }),
);

// restaurantId is omitted: a leave type can never be re-tenanted via update.
export const updateLeaveTypeSchema = z.lazy(() =>
  leaveTypeShapeSchema.omit({ restaurantId: true }).partial(),
);

// Leave Request Schemas
export const createLeaveRequestSchema = z.lazy(() =>
  z
    .object({
      restaurantId: restaurantIdString.optional(), // Injected by route handler from URL param
      employeeId: idString.optional(), // Staff UUID from auth context
      leaveTypeId: positiveInteger,

      // Date & Duration
      startDate: dateString,
      endDate: dateString,
      startPeriod: z.enum(["full", "am", "pm"]).default("full"),
      endPeriod: z.enum(["full", "am", "pm"]).default("full"),

      // Request Details
      reason: nonEmptyString.max(500),
      attachmentUrl: optionalUrl.nullable(),
      emergencyContact: z.string().max(100).optional().nullable(),
    })
    .refine(
      (data) => {
        const start = new Date(data.startDate);
        const end = new Date(data.endDate);
        return end >= start;
      },
      { message: "End date must be equal to or after start date" },
    ),
);

// Identity fields (approverId/userId/adjustedBy) are intentionally absent from
// the bodies below: the acting user is always derived from the authenticated
// session, never from client input.
export const approveLeaveRequestSchema = z.lazy(() =>
  z.object({
    comments: z.string().max(500).optional(),
  }),
);

export const rejectLeaveRequestSchema = z.lazy(() =>
  z.object({
    reason: nonEmptyString.max(500),
  }),
);

export const cancelLeaveRequestSchema = z.lazy(() =>
  z.object({
    reason: nonEmptyString.max(500),
  }),
);

// Leave Balance Schemas
export const adjustLeaveBalanceSchema = z.lazy(() =>
  z.object({
    employeeId: idString,
    leaveTypeId: positiveInteger,
    year: yearInteger,
    adjustment: z.number().min(-365).max(365), // Allow both positive and negative adjustments
    reason: nonEmptyString.max(500),
  }),
);

// restaurantId is deliberately absent: POST /:restaurantId/balances/accrue takes
// it from the path, where requireRestaurantAccess has already checked it, and the
// handler reads it from validatedParams. Requiring it in the body here made every
// call 400 with `restaurantId: invalid_type` — the admin's "初始化假期餘額" button
// could never succeed. Do not "fix" that by having the client send it: a second,
// unguarded source of the tenant id is the shape behind #265 and #275.
export const accrueLeaveBalancesSchema = z.lazy(() =>
  z.object({
    year: yearInteger,
  }),
);

// Leave Approval Rule Schemas
// Defaults live on the create schema only — see leaveTypeShapeSchema.
const leaveApprovalRuleShapeSchema = z.object({
  restaurantId: restaurantIdString,
  leaveTypeId: positiveInteger.optional().nullable(),
  name: nonEmptyString.max(100),
  description: z.string().max(500).optional().nullable(),
  approvalLevel: positiveInteger.max(5),

  // Approvers
  approverType: z.enum(["role", "specific_user"]),
  approverRoleIds: z.string().optional().nullable(), // JSON array string
  approverUserIds: z.string().optional().nullable(), // JSON array string

  // Auto-approval
  enableAutoApproval: z.boolean().optional(),
  autoApprovalConditions: z.string().optional().nullable(), // JSON object string

  // Escalation
  enableAutoEscalation: z.boolean().optional(),
  escalationTimeoutHours: positiveInteger.optional().nullable(),
  escalationToUserId: idString.optional().nullable(),

  // Priority
  priority: nonNegativeInteger.optional(),
  isActive: z.boolean().optional(),
});

const baseLeaveApprovalRuleSchema = z.lazy(() =>
  leaveApprovalRuleShapeSchema.extend({
    enableAutoApproval: z.boolean().default(false),
    enableAutoEscalation: z.boolean().default(false),
    priority: nonNegativeInteger.default(0),
    isActive: z.boolean().default(true),
  }),
);

export const createLeaveApprovalRuleSchema = z.lazy(() =>
  baseLeaveApprovalRuleSchema
    .refine(
      (data) => {
        if (data.approverType === "role" && !data.approverRoleIds) {
          return false;
        }
        if (data.approverType === "specific_user" && !data.approverUserIds) {
          return false;
        }
        return true;
      },
      { message: "Approver IDs must be provided based on approver type" },
    )
    .refine(
      (data) => {
        if (
          data.enableAutoEscalation &&
          (!data.escalationTimeoutHours || !data.escalationToUserId)
        ) {
          return false;
        }
        return true;
      },
      {
        message:
          "Escalation timeout and user must be provided when auto-escalation is enabled",
      },
    ),
);

export const updateLeaveApprovalRuleSchema = z.lazy(() =>
  leaveApprovalRuleShapeSchema.partial(),
);

// Leave Calendar Event Schemas
// Defaults live on the create schema only — see leaveTypeShapeSchema.
const leaveCalendarEventShapeSchema = z.object({
  restaurantId: restaurantIdString.optional().nullable(),
  name: nonEmptyString.max(100),
  description: z.string().max(500).optional().nullable(),
  eventType: z.enum(["public_holiday", "company_holiday", "special_event"]),
  eventDate: dateString,

  // Recurrence
  isRecurring: z.boolean().optional(),
  recurrencePattern: z.string().optional().nullable(), // JSON object string

  // Work Day Settings
  isWorkingDay: z.boolean().optional(),
  compensatoryFor: dateString.optional().nullable(),

  // Metadata
  color: z
    .string()
    .max(7)
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .nullable(),
  icon: z.string().max(50).optional().nullable(),
});

export const createLeaveCalendarEventSchema = z.lazy(() =>
  leaveCalendarEventShapeSchema.extend({
    isRecurring: z.boolean().default(false),
    isWorkingDay: z.boolean().default(false),
  }),
);

export const updateLeaveCalendarEventSchema = z.lazy(() =>
  leaveCalendarEventShapeSchema.partial(),
);

// Query Parameter Schemas
export const leaveRequestFiltersSchema = z.lazy(() =>
  z.object({
    employeeId: idString.optional(),
    leaveTypeId: z.string().regex(/^\d+$/).transform(Number).optional(),
    status: z
      .enum(["pending", "approved", "rejected", "cancelled", "withdrawn"])
      .optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    page: boundedPageQuery(),
    limit: boundedLimitQuery(),
  }),
);

export const leaveBalanceQuerySchema = z.lazy(() =>
  z.object({
    employeeId: idString,
    year: z.string().regex(/^\d+$/).transform(Number).optional(),
  }),
);

export const holidaysQuerySchema = z.lazy(() =>
  z.object({
    restaurantId: restaurantIdString.optional(),
    year: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const statisticsQuerySchema = z.lazy(() =>
  z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
);

export const upcomingLeavesQuerySchema = z.lazy(() =>
  z.object({
    days: z.string().regex(/^\d+$/).transform(Number).prefault("30"),
  }),
);

export const expiringBalancesQuerySchema = z.lazy(() =>
  z.object({
    months: z.string().regex(/^\d+$/).transform(Number).prefault("3"),
  }),
);

// Parameter Schemas
export const restaurantIdParamSchema = z.object({
  restaurantId: restaurantIdString,
});

export const leaveTypeIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const leaveRequestIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const leaveApprovalRuleIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const leaveCalendarEventIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const workingDayParamSchema = z.lazy(() =>
  z.object({
    restaurantId: restaurantIdString,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
);

// Complex validation functions
const validateLeaveRequestDates = (
  startDate: string,
  endDate: string,
  minNoticeDays: number = 0,
) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check end date is after start date
  if (end < start) {
    throw new Error("End date must be equal to or after start date");
  }

  // Check minimum notice period
  const daysDifference = Math.floor(
    (start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysDifference < minNoticeDays) {
    throw new Error(
      `Leave must be requested at least ${minNoticeDays} days in advance`,
    );
  }

  return true;
};

const validateLeaveBalance = (
  requestedDays: number,
  availableBalance: number,
) => {
  if (requestedDays > availableBalance) {
    throw new Error(
      `Insufficient leave balance. Requested: ${requestedDays} days, Available: ${availableBalance} days`,
    );
  }
  return true;
};

const calculateLeaveDays = (
  startDate: string,
  endDate: string,
  startPeriod: "full" | "am" | "pm",
  endPeriod: "full" | "am" | "pm",
): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Calculate full days between dates
  const daysDifference =
    Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Adjust for half-day periods
  let adjustedDays = daysDifference;

  // If start is PM only, subtract 0.5 day
  if (startPeriod === "pm") {
    adjustedDays -= 0.5;
  }

  // If end is AM only, subtract 0.5 day
  if (endPeriod === "am") {
    adjustedDays -= 0.5;
  }

  return adjustedDays;
};

const validateConsecutiveDays = (
  requestedDays: number,
  maxConsecutiveDays: number | null,
) => {
  if (maxConsecutiveDays && requestedDays > maxConsecutiveDays) {
    throw new Error(
      `Cannot request more than ${maxConsecutiveDays} consecutive days`,
    );
  }
  return true;
};

// Comprehensive leave request validation
export const validateCompleteLeaveRequest = z.lazy(() =>
  createLeaveRequestSchema.refine(
    (data) => {
      try {
        const days = calculateLeaveDays(
          data.startDate,
          data.endDate,
          data.startPeriod,
          data.endPeriod,
        );
        return days > 0;
      } catch {
        return false;
      }
    },
    { message: "Invalid date range or period configuration" },
  ),
);

// Export all schemas as a single object for easy import
export const leaveSchemas = {
  // Leave Type schemas
  createLeaveType: createLeaveTypeSchema,
  updateLeaveType: updateLeaveTypeSchema,

  // Leave Request schemas
  createLeaveRequest: createLeaveRequestSchema,
  approveLeaveRequest: approveLeaveRequestSchema,
  rejectLeaveRequest: rejectLeaveRequestSchema,
  cancelLeaveRequest: cancelLeaveRequestSchema,

  // Leave Balance schemas
  adjustLeaveBalance: adjustLeaveBalanceSchema,
  accrueLeaveBalances: accrueLeaveBalancesSchema,

  // Leave Approval Rule schemas
  createLeaveApprovalRule: createLeaveApprovalRuleSchema,
  updateLeaveApprovalRule: updateLeaveApprovalRuleSchema,

  // Leave Calendar Event schemas
  createLeaveCalendarEvent: createLeaveCalendarEventSchema,
  updateLeaveCalendarEvent: updateLeaveCalendarEventSchema,

  // Query schemas
  leaveRequestFilters: leaveRequestFiltersSchema,
  leaveBalanceQuery: leaveBalanceQuerySchema,
  holidaysQuery: holidaysQuerySchema,
  statisticsQuery: statisticsQuerySchema,
  upcomingLeavesQuery: upcomingLeavesQuerySchema,
  expiringBalancesQuery: expiringBalancesQuerySchema,

  // Parameter schemas
  restaurantIdParam: restaurantIdParamSchema,
  leaveTypeIdParam: leaveTypeIdParamSchema,
  leaveRequestIdParam: leaveRequestIdParamSchema,
  leaveApprovalRuleIdParam: leaveApprovalRuleIdParamSchema,
  leaveCalendarEventIdParam: leaveCalendarEventIdParamSchema,
  workingDayParam: workingDayParamSchema,

  // Complete validation
  validateCompleteLeaveRequest,
};

// Export validation helper functions
export {
  validateLeaveRequestDates,
  validateLeaveBalance,
  calculateLeaveDays,
  validateConsecutiveDays,
};
