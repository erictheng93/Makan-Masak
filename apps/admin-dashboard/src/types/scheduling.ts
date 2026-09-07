/**
 * Employee Scheduling TypeScript Type Definitions
 * Matches backend API responses and database schema
 *
 * Own PKs (`id`, `shiftTemplateId`, `scheduleId`, …) are
 * `integer autoincrement`. Everything that references `users.id` is a
 * `UserId` (TEXT UUID v7) — see ./api-user.
 */
import type { UserId } from "./api-user";

// ========================================
// Shift Template Types
// ========================================

export interface ShiftTemplate {
  id: number;
  restaurantId: string;
  name: string;
  description: string | null;
  shiftType: "regular" | "split" | "overnight";
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  durationMinutes: number;
  isSplitShift: boolean;
  breakStartTime: string | null;
  breakEndTime: string | null;
  breakDurationMinutes: number;
  applicableDays: string; // JSON array string
  minEmployees: number;
  maxEmployees: number;
  hourlyRate: number | null;
  overtimeMultiplier: number;
  colorCode: string; // Hex color
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  isDefault?: boolean; // Added for UI
  usageCount?: number; // Added for UI - tracks how many times template has been used
  assignedCount?: number; // Distinct non-cancelled employees scheduled on this template
  createdAt: string;
  updatedAt: string;
  createdBy: UserId;
  updatedBy: UserId | null;
}

export interface CreateShiftTemplateData {
  name: string;
  description?: string;
  shiftType: "regular" | "split" | "overnight";
  startTime: string;
  endTime: string;
  durationMinutes: number;
  isSplitShift?: boolean;
  breakStartTime?: string;
  breakEndTime?: string;
  breakDurationMinutes?: number;
  applicableDays?: string;
  minEmployees?: number;
  maxEmployees?: number;
  hourlyRate?: number;
  overtimeMultiplier?: number;
  colorCode?: string;
  icon?: string;
  sortOrder?: number;
}

// ========================================
// Employee Schedule Types
// ========================================

export interface EmployeeSchedule {
  id: number;
  restaurantId: string;
  employeeId: UserId;
  employeeName?: string; // Joined from users table
  // Enriched employee data. `isArchived` marks someone who has left: the
  // roster hides them, but their past shifts still have to name them (#337).
  employee?: { id: UserId; fullName?: string; isArchived?: boolean };
  shiftTemplateId: number | null;
  shiftTemplate?: ShiftTemplate;
  workDate: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  breakDurationMinutes: number;
  scheduledHours: number;
  // clock_in_time_ms / clock_out_time_ms, serialized as ISO datetimes.
  // There is deliberately no actualStartTime/actualEndTime alias: the columns
  // do not exist and GET /scheduling/:id/schedules returns the rows verbatim,
  // so a declared alias reads as `undefined` at runtime. ClockInOutPanel read
  // only the aliases, which is why its clock-in button never advanced (#308).
  clockInTime: string | null;
  clockOutTime: string | null;
  actualHours: number | null;
  overtimeHours: number | null;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  managerNotes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: UserId;
  updatedBy: UserId | null;
}

export interface CreateScheduleData {
  employeeId: UserId;
  shiftTemplateId?: number;
  workDate: string;
  startTime: string;
  endTime: string;
  breakDurationMinutes?: number;
  scheduledHours: number;
  notes?: string;
  managerNotes?: string;
}

export interface UpdateScheduleData {
  shiftTemplateId?: number;
  workDate?: string;
  startTime?: string;
  endTime?: string;
  breakDurationMinutes?: number;
  scheduledHours?: number;
  status?: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  notes?: string;
  managerNotes?: string;
}

export interface BulkCreateSchedulesData {
  shiftTemplateId: number;
  employeeIds: UserId[];
  dateRange: {
    startDate: string;
    endDate: string;
  };
  daysOfWeek: number[]; // 0-6 (Sunday-Saturday)
}

// ========================================
// Available Employees (Leave Integration)
// ========================================

export interface AvailableEmployee {
  id: UserId;
  fullName: string;
  role: number;
  availability: "available" | "on_leave" | "scheduled";
  reason?: string;
}

// ========================================
// Scheduling Conflict Types
// ========================================

export interface SchedulingConflict {
  id: number;
  restaurantId: string;
  scheduleId: number;
  employeeId: UserId;
  conflictType:
    | "overlapping_shifts"
    | "insufficient_rest"
    | "max_hours_exceeded"
    | "consecutive_days_exceeded"
    | "skill_mismatch"
    | "leave_conflict"
    | "availability_conflict";
  severity: "error" | "warning" | "info";
  message: string;
  conflictDetails: string; // JSON
  status: "unresolved" | "acknowledged" | "resolved" | "ignored";
  resolvedBy: UserId | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ========================================
// Swap Request Types
// ========================================

export interface SwapRequest {
  id: number;
  restaurantId: string;
  requesterEmployeeId: UserId;
  requesterEmployeeName?: string;
  requesterName?: string; // Alias for requesterEmployeeName
  requesterRole?: string; // Added for UI
  requesterScheduleId: number;
  targetEmployeeId: UserId | null;
  targetEmployeeName?: string;
  targetEmployeeRole?: string; // Added for UI
  targetScheduleId: number | null;
  requestType: "swap" | "cover" | "drop";
  reason: string;
  urgency: "low" | "normal" | "high" | "urgent";
  status:
    | "pending"
    | "accepted"
    | "approved"
    | "rejected"
    | "cancelled"
    | "expired";
  isOpenRequest: boolean;
  // Original shift details (added for UI)
  originalShiftDate?: string;
  originalStartTime?: string;
  originalEndTime?: string;
  // Target shift details (added for UI)
  targetShiftDate?: string;
  targetStartTime?: string;
  targetEndTime?: string;
  // Acceptance/Response details
  acceptedBy: UserId | null;
  acceptedAt: string | null;
  approvedBy: UserId | null;
  approvedAt: string | null;
  rejectedBy: UserId | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  respondedBy?: UserId | null; // Alias for approvedBy/rejectedBy
  respondedAt?: string | null; // Alias for approvedAt/rejectedAt
  responseNote?: string | null; // Alias for rejectionReason
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSwapRequestData {
  requesterScheduleId: number;
  targetEmployeeId?: UserId;
  targetScheduleId?: number;
  requestType: "swap" | "cover" | "drop";
  reason: string;
  urgency?: "low" | "normal" | "high" | "urgent";
  isOpenRequest?: boolean;
}

// ========================================
// Clock In/Out Types
// ========================================

export interface ClockInData {
  scheduleId: number;
  employeeId: UserId;
  notes?: string;
}

export interface ClockOutData {
  scheduleId: number;
  employeeId: UserId;
  notes?: string;
}

// ========================================
// Filter Types
// ========================================

export interface ScheduleFilters {
  restaurantId?: string;
  employeeId?: UserId;
  shiftTemplateId?: number;
  startDate?: string;
  endDate?: string;
  status?: EmployeeSchedule["status"];
  page?: number;
  limit?: number;
}

export interface ConflictFilters {
  restaurantId?: string;
  conflictType?: SchedulingConflict["conflictType"];
  severity?: SchedulingConflict["severity"];
  status?: SchedulingConflict["status"];
  employeeId?: UserId;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface SwapRequestFilters {
  restaurantId?: string;
  requesterEmployeeId?: UserId;
  targetEmployeeId?: UserId;
  status?: SwapRequest["status"];
  requestType?: SwapRequest["requestType"];
  page?: number;
  limit?: number;
}

// ========================================
// Response Types
// ========================================

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
  details?: unknown;
}

// ========================================
// Statistics Types
// ========================================

export interface DailyStats {
  date: string;
  totalSchedules: number;
  confirmedSchedules: number;
  completedSchedules: number;
  totalHours: number;
  totalEmployees: number;
  clockedIn: number;
  currentlyWorking: number;
  totalActualHours: number;
  totalOvertimeHours: number;
  statusBreakdown?: {
    scheduled: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
  shiftTypeBreakdown?: Record<string, number>;
}

export interface WeeklySummary {
  weekStartDate: string;
  weekEndDate: string;
  totalSchedules: number;
  totalHours: number;
  averageHoursPerDay: number;
  employeeStats: Array<{
    employeeId: UserId;
    employeeName: string;
    totalHours: number;
    scheduleCount: number;
  }>;
}
