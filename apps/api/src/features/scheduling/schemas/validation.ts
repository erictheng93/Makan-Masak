/**
 * Employee Scheduling Validation Schemas
 * Zod schemas for validating scheduling-related requests
 */

import { z } from "zod";
import {
  boundedLimitQuery,
  boundedPageQuery,
} from "../../../middleware/validation";

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
const timeString = z.lazy(() =>
  z
    .string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Time must be in HH:MM format"),
);
const dateString = z.lazy(() =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
);
/** Coerce "" to null so regex-validated optional fields don't reject empty form values */
const emptyToNull = (val: unknown) => (val === "" ? null : val);

// Shift Template Schemas
export const createShiftTemplateSchema = z.lazy(() =>
  z.object({
    restaurantId: nonEmptyString.optional(), // Injected by route handler from URL param
    name: nonEmptyString.max(100),
    description: z.preprocess(
      emptyToNull,
      z.string().max(500).optional().nullable(),
    ),
    shiftType: z.enum(["regular", "split", "overnight"]).default("regular"),

    startTime: timeString,
    endTime: timeString,
    durationMinutes: positiveInteger.max(1440), // Max 24 hours

    isSplitShift: z.boolean().default(false),
    breakStartTime: z.preprocess(emptyToNull, timeString.optional().nullable()),
    breakEndTime: z.preprocess(emptyToNull, timeString.optional().nullable()),
    breakDurationMinutes: nonNegativeInteger.default(0),

    applicableDays: z.string().default("[]"), // JSON array string

    minEmployees: positiveInteger.default(1),
    maxEmployees: positiveInteger.default(10),

    hourlyRate: nonNegativeNumber.optional().nullable(),
    overtimeMultiplier: z.number().min(1).max(3).default(1.5),

    colorCode: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .default("#3B82F6"),
    icon: z.preprocess(emptyToNull, z.string().max(50).optional().nullable()),
    sortOrder: nonNegativeInteger.default(0),

    isActive: z.boolean().default(true),
  }),
);

export const updateShiftTemplateSchema = z.lazy(() =>
  z.object({
    name: nonEmptyString.max(100).optional(),
    description: z.preprocess(
      emptyToNull,
      z.string().max(500).optional().nullable(),
    ),
    shiftType: z.enum(["regular", "split", "overnight"]).optional(),
    startTime: timeString.optional(),
    endTime: timeString.optional(),
    durationMinutes: positiveInteger.max(1440).optional(),
    isSplitShift: z.boolean().optional(),
    breakStartTime: z.preprocess(emptyToNull, timeString.optional().nullable()),
    breakEndTime: z.preprocess(emptyToNull, timeString.optional().nullable()),
    breakDurationMinutes: nonNegativeInteger.optional(),
    applicableDays: z.string().optional(),
    minEmployees: positiveInteger.optional(),
    maxEmployees: positiveInteger.optional(),
    hourlyRate: nonNegativeNumber.optional().nullable(),
    overtimeMultiplier: z.number().min(1).max(3).optional(),
    colorCode: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    icon: z.preprocess(emptyToNull, z.string().max(50).optional().nullable()),
    sortOrder: nonNegativeInteger.optional(),
    isActive: z.boolean().optional(),
  }),
);

// Employee Schedule Schemas
// Supports all time combinations including overnight shifts (e.g., 22:00–06:00)
export const createEmployeeScheduleSchema = z.lazy(() =>
  z.object({
    restaurantId: nonEmptyString.optional(), // Injected by route handler from URL param
    employeeId: idString,
    shiftTemplateId: positiveInteger.optional().nullable(),

    workDate: dateString,
    startTime: timeString,
    endTime: timeString,
    breakDurationMinutes: nonNegativeInteger.default(0),

    scheduledHours: nonNegativeNumber,

    notes: z.string().max(500).optional().nullable(),
    managerNotes: z.string().max(500).optional().nullable(),

    createdBy: idString.optional(), // Injected by route handler from auth context
  }),
);

export const updateEmployeeScheduleSchema = z.lazy(() =>
  z.object({
    shiftTemplateId: positiveInteger.optional().nullable(),
    workDate: dateString.optional(),
    startTime: timeString.optional(),
    endTime: timeString.optional(),
    breakDurationMinutes: nonNegativeInteger.optional(),
    scheduledHours: nonNegativeNumber.optional(),
    status: z
      .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
      .optional(),
    notes: z.string().max(500).optional().nullable(),
    managerNotes: z.string().max(500).optional().nullable(),
    updatedBy: idString.optional(),
  }),
);

export const bulkCreateSchedulesSchema = z.lazy(() =>
  z
    .object({
      restaurantId: nonEmptyString.optional(), // Injected by route handler from URL param
      shiftTemplateId: positiveInteger,
      employeeIds: z.array(idString).min(1).max(50),
      dateRange: z.object({
        startDate: dateString,
        endDate: dateString,
      }),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
      createdBy: idString.optional(), // Injected by route handler from auth context
    })
    .refine(
      (data) => {
        const start = new Date(data.dateRange.startDate);
        const end = new Date(data.dateRange.endDate);
        return end >= start;
      },
      { message: "End date must be equal to or after start date" },
    ),
);

// Clock In/Out Schema (identical shape for both actions)
// employeeId is optional: non-managers are always clocked as themselves
// (session identity); managers may clock a specific employee.
export const clockActionSchema = z.lazy(() =>
  z.object({
    scheduleId: positiveInteger,
    employeeId: idString.optional(),
    notes: z.string().max(500).optional(),
  }),
);

export const clockInSchema = clockActionSchema;
export const clockOutSchema = clockActionSchema;

// Scheduling Rule Schemas
export const createSchedulingRuleSchema = z.lazy(() =>
  z.object({
    restaurantId: nonEmptyString.optional(), // Injected by route handler from URL param
    name: nonEmptyString.max(100),
    description: z.string().max(500).optional().nullable(),
    ruleType: z.enum([
      "max_hours_per_day",
      "max_hours_per_week",
      "min_rest_period",
      "max_consecutive_days",
      "skill_requirement",
      "custom",
    ]),
    ruleConfig: z.string(), // JSON object string
    appliesToRoles: z.string().optional().nullable(), // JSON array
    appliesToEmployees: z.string().optional().nullable(), // JSON array
    priority: nonNegativeInteger.default(0),
    severity: z.enum(["error", "warning", "info"]).default("warning"),
    isSystemRule: z.boolean().default(false),
    isActive: z.boolean().default(true),
    createdBy: idString.optional(), // Injected by route handler from auth context
  }),
);

export const updateSchedulingRuleSchema = z.lazy(() =>
  z.object({
    name: nonEmptyString.max(100).optional(),
    description: z.string().max(500).optional().nullable(),
    ruleType: z
      .enum([
        "max_hours_per_day",
        "max_hours_per_week",
        "min_rest_period",
        "max_consecutive_days",
        "skill_requirement",
        "custom",
      ])
      .optional(),
    ruleConfig: z.string().optional(),
    appliesToRoles: z.string().optional().nullable(),
    appliesToEmployees: z.string().optional().nullable(),
    priority: nonNegativeInteger.optional(),
    severity: z.enum(["error", "warning", "info"]).optional(),
    isActive: z.boolean().optional(),
    updatedBy: idString.optional(),
  }),
);

// Conflict Resolution Schema
// The resolving user is always the authenticated session user — never
// accepted from the request body.
export const resolveConflictSchema = z.lazy(() =>
  z.object({
    resolutionNotes: z.string().max(500),
  }),
);

// Swap Request Schemas
export const createSwapRequestSchema = z.lazy(() =>
  z.object({
    restaurantId: nonEmptyString.optional(), // Injected by route handler from URL param
    requesterScheduleId: positiveInteger,
    targetEmployeeId: idString.optional().nullable(),
    targetScheduleId: positiveInteger.optional().nullable(),
    requestType: z.enum(["swap", "cover", "drop"]),
    reason: nonEmptyString.max(500),
    urgency: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    isOpenRequest: z.boolean().default(false),
    expiresAt: z.number().optional().nullable(),
  }),
);

export const approveSwapRequestSchema = z.lazy(() => z.object({}));

export const rejectSwapRequestSchema = z.lazy(() =>
  z.object({
    reason: nonEmptyString.max(500),
  }),
);

// Employee Availability Schemas
export const createAvailabilitySchema = z.lazy(() =>
  z
    .object({
      restaurantId: nonEmptyString.optional(), // Injected by route handler from URL param
      employeeId: idString,
      availabilityType: z.enum(["recurring", "specific_date"]),
      dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
      startTime: timeString.optional().nullable(),
      endTime: timeString.optional().nullable(),
      startDate: dateString.optional().nullable(),
      endDate: dateString.optional().nullable(),
      preferenceType: z.enum(["preferred", "available", "unavailable"]),
      priority: nonNegativeInteger.default(0),
      notes: z.string().max(500).optional().nullable(),
      isActive: z.boolean().default(true),
    })
    .refine(
      (data) => {
        // For recurring, require dayOfWeek and times
        if (data.availabilityType === "recurring") {
          return (
            data.dayOfWeek !== undefined &&
            data.dayOfWeek !== null &&
            data.startTime !== undefined &&
            data.startTime !== null &&
            data.endTime !== undefined &&
            data.endTime !== null
          );
        }
        // For specific_date, require date range
        if (data.availabilityType === "specific_date") {
          return (
            data.startDate !== undefined &&
            data.startDate !== null &&
            data.endDate !== undefined &&
            data.endDate !== null
          );
        }
        return true;
      },
      { message: "Invalid availability configuration for selected type" },
    ),
);

// Attendance Report Query Schema
export const attendanceReportQuerySchema = z.lazy(() =>
  z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    employeeId: idString.optional(),
  }),
);

// Admin Clock In/Out Schema
export const adminClockSchema = z.lazy(() =>
  z.object({
    notes: z.string().max(500).optional(),
  }),
);

// Query Parameter Schemas
export const scheduleFiltersSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().regex(/^\d+$/).transform(Number).optional(),
    employeeId: idString.optional(),
    shiftTemplateId: z.string().regex(/^\d+$/).transform(Number).optional(),
    startDate: dateString.optional(),
    endDate: dateString.optional(),
    status: z
      .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
      .optional(),
    page: boundedPageQuery(),
    limit: boundedLimitQuery(),
  }),
);

export const conflictFiltersSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().regex(/^\d+$/).transform(Number).optional(),
    conflictType: z
      .enum([
        "overlapping_shifts",
        "insufficient_rest",
        "max_hours_exceeded",
        "consecutive_days_exceeded",
        "skill_mismatch",
        "leave_conflict",
        "availability_conflict",
      ])
      .optional(),
    severity: z.enum(["error", "warning", "info"]).optional(),
    status: z
      .enum(["unresolved", "acknowledged", "resolved", "ignored"])
      .optional(),
    employeeId: idString.optional(),
    startDate: dateString.optional(),
    endDate: dateString.optional(),
    page: boundedPageQuery(),
    limit: boundedLimitQuery(),
  }),
);

export const swapRequestFiltersSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().regex(/^\d+$/).transform(Number).optional(),
    requesterEmployeeId: idString.optional(),
    targetEmployeeId: idString.optional(),
    status: z
      .enum([
        "pending",
        "accepted",
        "approved",
        "rejected",
        "cancelled",
        "expired",
      ])
      .optional(),
    requestType: z.enum(["swap", "cover", "drop"]).optional(),
    page: boundedPageQuery(),
    limit: boundedLimitQuery(),
  }),
);

export const statsQuerySchema = z.object({
  date: dateString,
});

export const weeklySummaryQuerySchema = z.lazy(() =>
  z.object({
    weekStartDate: dateString,
  }),
);

export const availableEmployeesQuerySchema = z.lazy(() =>
  z.object({
    date: dateString,
    shiftTemplateId: z.string().regex(/^\d+$/).transform(Number).optional(),
  }),
);

// Parameter Schemas
export const restaurantIdParamSchema = z.object({
  restaurantId: z.string().min(1),
});

export const shiftTemplateIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const scheduleIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const conflictIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const swapRequestIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
);

export const employeeIdParamSchema = z.lazy(() =>
  z.object({
    employeeId: idString,
  }),
);

// Helper Functions
export const calculateScheduledHours = (
  startTime: string,
  endTime: string,
  breakMinutes: number = 0,
): number => {
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);

  const startMinutes = startHour * 60 + startMin;
  let endMinutes = endHour * 60 + endMin;

  // Handle overnight shifts
  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  const totalMinutes = endMinutes - startMinutes - breakMinutes;
  return totalMinutes / 60;
};

export const validateTaiwanLaborLaw = {
  maxDailyHours: 12, // Including overtime
  maxWeeklyHours: 46, // Including overtime (40 regular + 6 overtime)
  minRestPeriod: 11, // Hours between shifts
  maxConsecutiveDays: 6,
};

// Export all schemas as a single object
export const schedulingSchemas = {
  // Shift Templates
  createShiftTemplate: createShiftTemplateSchema,
  updateShiftTemplate: updateShiftTemplateSchema,

  // Schedules
  createEmployeeSchedule: createEmployeeScheduleSchema,
  updateEmployeeSchedule: updateEmployeeScheduleSchema,
  bulkCreateSchedules: bulkCreateSchedulesSchema,

  // Clock In/Out
  clockIn: clockInSchema,
  clockOut: clockOutSchema,

  // Rules
  createSchedulingRule: createSchedulingRuleSchema,
  updateSchedulingRule: updateSchedulingRuleSchema,

  // Conflicts
  resolveConflict: resolveConflictSchema,

  // Swap Requests
  createSwapRequest: createSwapRequestSchema,
  approveSwapRequest: approveSwapRequestSchema,
  rejectSwapRequest: rejectSwapRequestSchema,

  // Attendance Report
  attendanceReportQuery: attendanceReportQuerySchema,
  adminClock: adminClockSchema,

  // Availability
  createAvailability: createAvailabilitySchema,

  // Query Filters
  scheduleFilters: scheduleFiltersSchema,
  conflictFilters: conflictFiltersSchema,
  swapRequestFilters: swapRequestFiltersSchema,
  statsQuery: statsQuerySchema,
  weeklySummaryQuery: weeklySummaryQuerySchema,
  availableEmployeesQuery: availableEmployeesQuerySchema,

  // Params
  restaurantIdParam: restaurantIdParamSchema,
  shiftTemplateIdParam: shiftTemplateIdParamSchema,
  scheduleIdParam: scheduleIdParamSchema,
  conflictIdParam: conflictIdParamSchema,
  swapRequestIdParam: swapRequestIdParamSchema,
  employeeIdParam: employeeIdParamSchema,
};
