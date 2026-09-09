/**
 * Employee Scheduling Service
 * Business logic for employee work scheduling management
 */

import {
  eq,
  and,
  gte,
  lte,
  between,
  sql,
  desc,
  asc,
  isNull,
  isNotNull,
  inArray,
  ne,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { D1Database } from "@cloudflare/workers-types";
import { BaseService, type CloudflareEnv } from "./base";
import {
  shiftTemplates,
  employeeSchedules,
  schedulingConflicts,
  scheduleSwapRequests,
  users,
  leaveRequests,
} from "../schema";
import {
  NotificationService,
  type NotificationCategory,
} from "./NotificationService";
import { amountFromCents, toCents } from "../utils/money";
import { BusinessTimezoneResolver } from "../utils/business-timezone";
import { businessDateNow } from "../utils/sql-time";

// ========================================
// Types
// ========================================

export interface ShiftTemplate {
  id: number;
  restaurantId: string;
  name: string;
  description: string | null;
  shiftType: "regular" | "split" | "overnight";
  startTime: string;
  endTime: string;
  durationMinutes: number;
  isSplitShift: boolean;
  breakStartTime: string | null;
  breakEndTime: string | null;
  breakDurationMinutes: number;
  applicableDays: string;
  minEmployees: number;
  maxEmployees: number;
  hourlyRate: number | null;
  hourlyRateCents: number | null;
  overtimeMultiplier: number;
  colorCode: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Distinct non-cancelled employees scheduled on this template (issue #209).
   *  Populated by getShiftTemplates only. */
  assignedCount?: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeSchedule {
  id: number;
  restaurantId: string;
  employeeId: string;
  shiftTemplateId: number | null;
  workDate: string;
  startTime: string;
  endTime: string;
  breakDurationMinutes: number;
  clockInTime: Date | null;
  clockOutTime: Date | null;
  scheduledHours: number;
  actualHours: number;
  overtimeHours: number;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  managerNotes: string | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreateScheduleData = Pick<
  EmployeeSchedule,
  | "restaurantId"
  | "employeeId"
  | "workDate"
  | "startTime"
  | "endTime"
  | "scheduledHours"
  | "createdBy"
> &
  Partial<
    Pick<
      EmployeeSchedule,
      | "shiftTemplateId"
      | "breakDurationMinutes"
      | "notes"
      | "managerNotes"
      | "updatedBy"
    >
  >;

export interface SchedulingConflict {
  id: number;
  restaurantId: string;
  conflictType:
    | "overlapping_shifts"
    | "insufficient_rest"
    | "max_hours_exceeded"
    | "consecutive_days_exceeded"
    | "skill_mismatch"
    | "leave_conflict"
    | "availability_conflict";
  severity: "error" | "warning" | "info";
  scheduleIds: string;
  employeeIds: string;
  ruleId: number | null;
  message: string;
  details: string | null;
  status: "unresolved" | "acknowledged" | "resolved" | "ignored";
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  detectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleSwapRequest {
  id: number;
  restaurantId: string;
  requesterEmployeeId: string;
  requesterScheduleId: number;
  targetEmployeeId: string | null;
  targetScheduleId: number | null;
  requestType: "swap" | "cover" | "drop";
  reason: string;
  urgency: "low" | "normal" | "high" | "urgent";
  isOpenRequest: boolean;
  status:
    | "pending"
    | "accepted"
    | "approved"
    | "rejected"
    | "cancelled"
    | "expired";
  acceptedBy: string | null;
  acceptedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConflictCheckResult {
  hasConflicts: boolean;
  conflicts: DetectedSchedulingConflict[];
  warnings: DetectedSchedulingConflict[];
  info: DetectedSchedulingConflict[];
}

/** Conflict information available before a conflict record is persisted. */
export type DetectedSchedulingConflict = Pick<
  SchedulingConflict,
  "conflictType" | "severity" | "message" | "employeeIds"
> &
  Partial<Pick<SchedulingConflict, "scheduleIds" | "details">>;

export interface SwapRequestFilters {
  restaurantId?: string;
  requesterEmployeeId?: string;
  targetEmployeeId?: string;
  requestType?: ScheduleSwapRequest["requestType"];
  status?: ScheduleSwapRequest["status"];
  page?: number;
  limit?: number;
}

export interface ConflictFilters {
  restaurantId?: string;
  conflictType?: SchedulingConflict["conflictType"];
  severity?: SchedulingConflict["severity"];
  status?: SchedulingConflict["status"];
  page?: number;
  limit?: number;
}

export type AvailableEmployee = Pick<
  typeof users.$inferSelect,
  "id" | "fullName" | "role"
> & {
  availability: "available";
  reason: string;
};

export interface DailySchedulingStats {
  date: string;
  totalSchedules: number;
  totalEmployees: number;
  totalHours: number;
  clockedIn: number;
  currentlyWorking: number;
  totalActualHours: number;
  totalOvertimeHours: number;
  statusBreakdown: {
    scheduled: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
  shiftTypeBreakdown: Record<string, number>;
}

export interface WeeklyScheduleSummary {
  weekStartDate: string;
  weekEndDate: string;
  totalSchedules: number;
  totalEmployees: number;
  totalHours: number;
  totalOvertimeHours: number;
  confirmedSchedules: number;
  completedSchedules: number;
  cancelledSchedules: number;
  dailyBreakdown: Array<{
    date: string;
    scheduleCount: number;
    employeeCount: number;
    totalHours: number;
  }>;
}

export interface ScheduleFilters {
  restaurantId?: string;
  employeeId?: string;
  shiftTemplateId?: number;
  startDate?: string;
  endDate?: string;
  status?: EmployeeSchedule["status"];
  page?: number;
  limit?: number;
}

export interface BulkScheduleData {
  restaurantId: string;
  shiftTemplateId: number;
  employeeIds: string[];
  dateRange: { startDate: string; endDate: string };
  daysOfWeek: number[];
  createdBy: string;
}

export interface ClockInData {
  scheduleId: number;
  employeeId: string;
  clockInTime: Date;
  notes?: string;
  /** Tenant scope — when set, the schedule must belong to this restaurant */
  restaurantId?: string;
}

export interface ClockOutData {
  scheduleId: number;
  employeeId: string;
  clockOutTime: Date;
  notes?: string;
  /** Tenant scope — when set, the schedule must belong to this restaurant */
  restaurantId?: string;
}

type ShiftTemplateInput = typeof shiftTemplates.$inferInsert & {
  hourlyRate?: number | null;
};

/**
 * The employee a schedule row joins to, with the archive reduced to a flag.
 *
 * A schedule keeps resolving its employee after they leave -- that is the point
 * of archiving rather than deleting. But the name alone reads as though they
 * still work here, so the caller gets told which it is and renders the label in
 * its own locale. The timestamp itself is not useful to a roster grid, so only
 * the boolean crosses the boundary (#337).
 */
type JoinedEmployee = {
  id: string;
  fullName: string | null;
  role: number;
  deletedAt: Date | null;
} | null;

function withArchiveFlag(employee: JoinedEmployee) {
  if (!employee) return null;
  const { deletedAt, ...rest } = employee;
  return { ...rest, isArchived: deletedAt !== null };
}

// ========================================
// Scheduling Service
// ========================================

export class SchedulingService extends BaseService {
  private notificationService: NotificationService;
  private readonly businessTimezone = new BusinessTimezoneResolver(this.db);

  constructor(d1: D1Database, env: CloudflareEnv) {
    super(d1, env);
    this.notificationService = new NotificationService(d1, env);
  }

  // ========================================
  // Tenant Scoping Helpers
  //
  // Every ID-addressed read/mutation goes through one of these WHERE
  // builders. `restaurantId === undefined` means unscoped (platform admin,
  // role 0); any string value restricts the row to that restaurant so a
  // caller can never reach another tenant's row by guessing sequential IDs.
  // ========================================

  private templateWhere(id: number, restaurantId?: string) {
    return restaurantId === undefined
      ? eq(shiftTemplates.id, id)
      : and(
          eq(shiftTemplates.id, id),
          eq(shiftTemplates.restaurantId, restaurantId),
        );
  }

  private scheduleWhere(id: number, restaurantId?: string) {
    return restaurantId === undefined
      ? eq(employeeSchedules.id, id)
      : and(
          eq(employeeSchedules.id, id),
          eq(employeeSchedules.restaurantId, restaurantId),
        );
  }

  private conflictWhere(id: number, restaurantId?: string) {
    return restaurantId === undefined
      ? eq(schedulingConflicts.id, id)
      : and(
          eq(schedulingConflicts.id, id),
          eq(schedulingConflicts.restaurantId, restaurantId),
        );
  }

  private swapRequestWhere(id: number, restaurantId?: string) {
    return restaurantId === undefined
      ? eq(scheduleSwapRequests.id, id)
      : and(
          eq(scheduleSwapRequests.id, id),
          eq(scheduleSwapRequests.restaurantId, restaurantId),
        );
  }

  private async assertEmployeesInRestaurant(
    employeeIds: string[],
    restaurantId: string,
  ): Promise<void> {
    const uniqueIds = [...new Set(employeeIds)];
    if (uniqueIds.length === 0) return;

    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, uniqueIds),
          eq(users.restaurantId, restaurantId),
          eq(users.isActive, true),
          // Archived staff have left; a shift must not be assignable to them
          // even if a stale client still lists the id (#337).
          isNull(users.deletedAt),
        ),
      );

    if (rows.length !== uniqueIds.length) {
      throw new Error("Employee not found in restaurant");
    }
  }

  // ========================================
  // Shift Template Management
  // ========================================

  async getShiftTemplates(restaurantId: string): Promise<ShiftTemplate[]> {
    const templates = await this.db
      .select()
      .from(shiftTemplates)
      .where(eq(shiftTemplates.restaurantId, restaurantId))
      .orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.name));

    // ponytail: all-time distinct headcount; add a date-range param if the
    // analytics view ever needs a bounded window.
    const counts = await this.db
      .select({
        shiftTemplateId: employeeSchedules.shiftTemplateId,
        assignedCount: sql<number>`COUNT(DISTINCT ${employeeSchedules.employeeId})`,
      })
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.restaurantId, restaurantId),
          ne(employeeSchedules.status, "cancelled"),
        ),
      )
      .groupBy(employeeSchedules.shiftTemplateId);
    const countByTemplate = new Map(
      counts.map((row) => [row.shiftTemplateId, Number(row.assignedCount)]),
    );

    return templates.map((template) => ({
      ...this.mapShiftTemplate(template),
      assignedCount: countByTemplate.get(template.id) ?? 0,
    }));
  }

  async getShiftTemplate(
    id: number,
    restaurantId?: string,
  ): Promise<ShiftTemplate | null> {
    const [template] = await this.db
      .select()
      .from(shiftTemplates)
      .where(this.templateWhere(id, restaurantId))
      .limit(1);

    return template ? this.mapShiftTemplate(template) : null;
  }

  async createShiftTemplate(data: ShiftTemplateInput): Promise<ShiftTemplate> {
    const { hourlyRate, ...insertData } = data;
    const [newTemplate] = await this.db
      .insert(shiftTemplates)
      .values({
        ...insertData,
        hourlyRateCents:
          hourlyRate !== undefined
            ? toCents(hourlyRate)
            : insertData.hourlyRateCents,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return this.mapShiftTemplate(newTemplate);
  }

  async updateShiftTemplate(
    id: number,
    data: Partial<ShiftTemplateInput>,
    restaurantId?: string,
  ): Promise<ShiftTemplate> {
    const { hourlyRate, ...updateData } = data;
    const updates = {
      ...updateData,
      ...(hourlyRate !== undefined && {
        hourlyRateCents: toCents(hourlyRate),
      }),
      updatedAt: new Date(),
    };

    const [updated] = await this.db
      .update(shiftTemplates)
      .set(updates)
      .where(this.templateWhere(id, restaurantId))
      .returning();

    if (!updated) {
      throw new Error("Shift template not found");
    }

    return this.mapShiftTemplate(updated);
  }

  async deleteShiftTemplate(
    id: number,
    restaurantId?: string,
  ): Promise<boolean> {
    const [deleted] = await this.db
      .update(shiftTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(this.templateWhere(id, restaurantId))
      .returning();

    return !!deleted;
  }

  private mapShiftTemplate(
    template: typeof shiftTemplates.$inferSelect,
  ): ShiftTemplate {
    return {
      ...template,
      hourlyRate: amountFromCents(template.hourlyRateCents),
    } as ShiftTemplate;
  }

  // ========================================
  // Employee Schedule Management
  // ========================================

  async getSchedules(
    filters: ScheduleFilters,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const { page = 1, limit = 20, ...restFilters } = filters;
    const { limit: pgLimit, offset } = this.createPagination(page, limit);

    const conditions = [];
    if (restFilters.restaurantId) {
      conditions.push(
        eq(employeeSchedules.restaurantId, restFilters.restaurantId),
      );
    }
    if (restFilters.employeeId) {
      conditions.push(eq(employeeSchedules.employeeId, restFilters.employeeId));
    }
    if (restFilters.shiftTemplateId) {
      conditions.push(
        eq(employeeSchedules.shiftTemplateId, restFilters.shiftTemplateId),
      );
    }
    if (restFilters.status) {
      conditions.push(eq(employeeSchedules.status, restFilters.status));
    }
    if (restFilters.startDate && restFilters.endDate) {
      conditions.push(
        between(
          employeeSchedules.workDate,
          restFilters.startDate,
          restFilters.endDate,
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(employeeSchedules)
      .where(whereClause);

    const total = Number(countResult.count);

    const schedules = await this.db
      .select({
        schedule: employeeSchedules,
        employee: {
          id: users.id,
          fullName: users.fullName,
          role: users.role,
          deletedAt: users.deletedAt,
        },
        shiftTemplate: shiftTemplates,
      })
      .from(employeeSchedules)
      .leftJoin(users, eq(employeeSchedules.employeeId, users.id))
      .leftJoin(
        shiftTemplates,
        eq(employeeSchedules.shiftTemplateId, shiftTemplates.id),
      )
      .where(whereClause)
      .orderBy(
        desc(employeeSchedules.workDate),
        asc(employeeSchedules.startTime),
      )
      .limit(pgLimit)
      .offset(offset);

    const items = schedules.map((row) => ({
      ...row.schedule,
      employee: withArchiveFlag(row.employee),
      shiftTemplate: row.shiftTemplate,
    }));

    return { items, total };
  }

  async getSchedule(
    id: number,
    restaurantId?: string,
  ): Promise<Record<string, unknown> | null> {
    const [result] = await this.db
      .select({
        schedule: employeeSchedules,
        employee: {
          id: users.id,
          fullName: users.fullName,
          role: users.role,
          deletedAt: users.deletedAt,
        },
        shiftTemplate: shiftTemplates,
      })
      .from(employeeSchedules)
      .leftJoin(users, eq(employeeSchedules.employeeId, users.id))
      .leftJoin(
        shiftTemplates,
        eq(employeeSchedules.shiftTemplateId, shiftTemplates.id),
      )
      .where(this.scheduleWhere(id, restaurantId))
      .limit(1);

    if (!result) return null;

    return {
      ...result.schedule,
      employee: withArchiveFlag(result.employee),
      shiftTemplate: result.shiftTemplate,
    };
  }

  async createSchedule(data: CreateScheduleData): Promise<EmployeeSchedule> {
    await this.assertEmployeesInRestaurant(
      [data.employeeId],
      data.restaurantId,
    );

    if (data.shiftTemplateId != null) {
      const template = await this.getShiftTemplate(
        data.shiftTemplateId,
        data.restaurantId,
      );
      if (!template) {
        throw new Error("Shift template not found");
      }
    }

    // Check for conflicts (read operation — outside transaction)
    const conflicts = await this.checkScheduleConflicts(data);
    if (conflicts.conflicts.length > 0) {
      throw new Error(
        conflicts.conflicts.map((conflict) => conflict.message).join("; "),
      );
    }

    const [scheduleRows] = await this.db.batch([
      this.db
        .insert(employeeSchedules)
        .values({
          ...data,
          status: "scheduled",
          actualHours: 0,
          overtimeHours: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning() as BatchItem<"sqlite">,
    ]);
    const [newSchedule] =
      scheduleRows as (typeof employeeSchedules.$inferSelect)[];

    // Non-critical notification — fire and forget
    this.sendScheduleNotification(data.employeeId, data.shiftTemplateId, {
      category: "schedule_created",
      scheduleDate: data.workDate,
      startTime: data.startTime,
      endTime: data.endTime,
      extra: {
        scheduledHours: data.scheduledHours.toString(),
        notes: data.notes || "",
      },
      priority: "normal",
    });

    return newSchedule as EmployeeSchedule;
  }

  async updateSchedule(
    id: number,
    data: Partial<EmployeeSchedule>,
    restaurantId?: string,
  ): Promise<EmployeeSchedule> {
    const [updated] = await this.db
      .update(employeeSchedules)
      .set({ ...data, updatedAt: new Date() })
      .where(this.scheduleWhere(id, restaurantId))
      .returning();

    if (!updated) {
      throw new Error("Schedule not found");
    }

    // Non-critical notification — fire and forget
    this.sendScheduleNotification(updated.employeeId, updated.shiftTemplateId, {
      category: "schedule_updated",
      scheduleDate: updated.workDate,
      startTime: updated.startTime,
      endTime: updated.endTime,
      extra: {
        scheduledHours: updated.scheduledHours.toString(),
        notes: updated.notes || "",
      },
      priority: "high",
    });

    return updated as EmployeeSchedule;
  }

  async deleteSchedule(id: number, restaurantId?: string): Promise<boolean> {
    const [deleted] = await this.db
      .update(employeeSchedules)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(this.scheduleWhere(id, restaurantId))
      .returning();

    if (deleted) {
      // Non-critical notification — fire and forget
      this.sendScheduleNotification(
        deleted.employeeId,
        deleted.shiftTemplateId,
        {
          category: "schedule_cancelled",
          scheduleDate: deleted.workDate,
          startTime: deleted.startTime,
          endTime: deleted.endTime,
          extra: {
            cancellationReason: deleted.managerNotes || "Schedule cancelled",
          },
          priority: "high",
        },
      );
    }

    return !!deleted;
  }

  async bulkCreateSchedules(data: BulkScheduleData): Promise<number> {
    const startDate = new Date(data.dateRange.startDate);
    const endDate = new Date(data.dateRange.endDate);

    await this.assertEmployeesInRestaurant(data.employeeIds, data.restaurantId);

    // Read operation — outside transaction
    const template = await this.getShiftTemplate(
      data.shiftTemplateId,
      data.restaurantId,
    );
    if (!template) {
      throw new Error("Shift template not found");
    }

    // Collect all schedule data to create
    const schedulesToCreate: (typeof employeeSchedules.$inferInsert)[] = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();

      if (data.daysOfWeek.includes(dayOfWeek)) {
        for (const employeeId of data.employeeIds) {
          schedulesToCreate.push({
            restaurantId: data.restaurantId,
            employeeId,
            shiftTemplateId: data.shiftTemplateId,
            workDate: currentDate.toISOString().split("T")[0],
            startTime: template.startTime,
            endTime: template.endTime,
            breakDurationMinutes: template.breakDurationMinutes,
            scheduledHours: template.durationMinutes / 60,
            createdBy: data.createdBy,
          });
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Pre-fetch conflict data for the entire range (2 queries instead of N×6-12)
    const weekBefore = new Date(startDate);
    weekBefore.setDate(weekBefore.getDate() - 7);
    const dayAfter = new Date(endDate);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const [existingSchedules, existingLeaves] = await Promise.all([
      this.db
        .select()
        .from(employeeSchedules)
        .where(
          and(
            eq(employeeSchedules.restaurantId, data.restaurantId),
            between(
              employeeSchedules.workDate,
              weekBefore.toISOString().split("T")[0],
              dayAfter.toISOString().split("T")[0],
            ),
            sql`${employeeSchedules.status} != 'cancelled'`,
          ),
        ),
      this.db
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.status, "approved"),
            lte(leaveRequests.startDate, data.dateRange.endDate),
            gte(leaveRequests.endDate, data.dateRange.startDate),
          ),
        ),
    ]);

    // Process-local conflict detection for all schedules at once
    const bulkConflicts: (typeof schedulingConflicts.$inferInsert)[] = [];
    for (const sched of schedulesToCreate) {
      const empSchedules = existingSchedules.filter(
        (s) =>
          s.employeeId === sched.employeeId && s.workDate === sched.workDate,
      );
      for (const existing of empSchedules) {
        if (
          this.timesOverlap(
            sched.startTime,
            sched.endTime,
            existing.startTime,
            existing.endTime,
          )
        ) {
          bulkConflicts.push({
            conflictType: "overlapping_shifts",
            severity: "error",
            message: `Overlapping shift: ${existing.startTime}-${existing.endTime}`,
            restaurantId: data.restaurantId,
            scheduleIds: JSON.stringify([existing.id]),
            employeeIds: JSON.stringify([sched.employeeId]),
          });
        }
      }

      const empLeaves = existingLeaves.filter(
        (l) =>
          l.employeeId === sched.employeeId &&
          l.startDate <= sched.workDate &&
          l.endDate >= sched.workDate,
      );
      if (empLeaves.length > 0) {
        bulkConflicts.push({
          conflictType: "leave_conflict",
          severity: "error",
          message: "Employee has approved leave on this date",
          restaurantId: data.restaurantId,
          scheduleIds: "[]",
          employeeIds: JSON.stringify([sched.employeeId]),
          details: JSON.stringify({ leaveRequestId: empLeaves[0].id }),
        });
      }
    }

    const writes: BatchItem<"sqlite">[] = [
      ...bulkConflicts.map(
        (conflict) =>
          this.db.insert(schedulingConflicts).values({
            ...conflict,
            scheduleIds: conflict.scheduleIds || "[]",
            employeeIds: conflict.employeeIds || "[]",
            status: "unresolved",
            detectedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }) as BatchItem<"sqlite">,
      ),
      ...schedulesToCreate.map(
        (sched) =>
          this.db.insert(employeeSchedules).values({
            ...sched,
            status: "scheduled",
            actualHours: 0,
            overtimeHours: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          }) as BatchItem<"sqlite">,
      ),
    ];
    await this.db.batch(
      writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );

    return schedulesToCreate.length;
  }

  // ========================================
  // Clock In/Out
  // ========================================

  /** Lightweight schedule fetch — no JOINs, only the schedule row */
  async getScheduleById(
    id: number,
    restaurantId?: string,
  ): Promise<EmployeeSchedule | null> {
    const [row] = await this.db
      .select()
      .from(employeeSchedules)
      .where(this.scheduleWhere(id, restaurantId))
      .limit(1);
    return (row as EmployeeSchedule) || null;
  }

  async clockIn(
    data: ClockInData,
    isAdmin?: boolean,
  ): Promise<EmployeeSchedule> {
    const schedule = await this.getScheduleById(
      data.scheduleId,
      data.restaurantId,
    );
    if (!schedule) {
      throw new Error("Schedule not found");
    }

    if (!isAdmin && schedule.employeeId !== data.employeeId) {
      throw new Error("Unauthorized");
    }

    if (schedule.clockInTime) {
      throw new Error("Already clocked in");
    }

    const [updated] = await this.db
      .update(employeeSchedules)
      .set({
        clockInTime: data.clockInTime,
        status: "confirmed",
        notes: data.notes || schedule.notes,
        updatedAt: new Date(),
      })
      .where(this.scheduleWhere(data.scheduleId, data.restaurantId))
      .returning();

    return updated as EmployeeSchedule;
  }

  async clockOut(
    data: ClockOutData,
    isAdmin?: boolean,
  ): Promise<EmployeeSchedule> {
    const schedule = await this.getScheduleById(
      data.scheduleId,
      data.restaurantId,
    );
    if (!schedule) {
      throw new Error("Schedule not found");
    }

    if (!isAdmin && schedule.employeeId !== data.employeeId) {
      throw new Error("Unauthorized");
    }

    if (!schedule.clockInTime) {
      throw new Error("Must clock in first");
    }

    if (schedule.clockOutTime) {
      throw new Error("Already clocked out");
    }

    const clockInTime = schedule.clockInTime!;
    const actualHours =
      (data.clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);
    const overtimeHours = Math.max(0, actualHours - schedule.scheduledHours);

    const [updated] = await this.db
      .update(employeeSchedules)
      .set({
        clockOutTime: data.clockOutTime,
        actualHours,
        overtimeHours,
        status: "completed",
        notes: data.notes || schedule.notes,
        updatedAt: new Date(),
      })
      .where(this.scheduleWhere(data.scheduleId, data.restaurantId))
      .returning();

    return updated as EmployeeSchedule;
  }

  // ========================================
  // Clock-In Reports & Queries
  // ========================================

  /**
   * Get currently clocked-in employees for a given date
   */
  /**
   * Employees currently on shift: clocked in, not yet clocked out, on today's
   * roster.
   *
   * "Today" is the shop's date, not the server's. This used to be
   * `new Date().toISOString().split("T")[0]`, i.e. UTC — so for a UTC+8 shop
   * every clock-in between 00:00 and 08:00 local counted against the *previous*
   * day's roster and the 目前在班 tile read zero for eight hours a day,
   * regardless of who was actually working. Same defect #290 removed from the
   * analytics hour buckets.
   */
  async getClockedInEmployees(
    restaurantId: string,
    date?: string,
  ): Promise<EmployeeSchedule[]> {
    const offsetMinutes =
      await this.businessTimezone.offsetMinutes(restaurantId);

    const results = await this.db
      .select()
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.restaurantId, restaurantId),
          date
            ? eq(employeeSchedules.workDate, date)
            : eq(employeeSchedules.workDate, businessDateNow(offsetMinutes)),
          isNotNull(employeeSchedules.clockInTime),
          isNull(employeeSchedules.clockOutTime),
        ),
      );

    return results as EmployeeSchedule[];
  }

  /**
   * Get attendance report for a date range
   */
  /**
   * Resolve display names for a set of employee ids.
   * Returns a map of employeeId -> display name (fullName, falling back to
   * username). Missing ids are simply absent from the map.
   *
   * Archived employees are deliberately still resolved: a past roster or an
   * attendance export has to name the person who worked the shift. They carry
   * a suffix so the reader can tell the name belongs to someone who has since
   * left (#337).
   */
  async getEmployeeNames(employeeIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const uniqueIds = [...new Set(employeeIds)];
    if (uniqueIds.length === 0) return map;

    const rows = await this.db
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(inArray(users.id, uniqueIds));

    for (const row of rows) {
      const base = row.fullName || row.username;
      const name = base && row.deletedAt ? `${base}（已離職）` : base;
      if (name) map.set(row.id, name);
    }
    return map;
  }

  async getAttendanceReport(
    restaurantId: string,
    options: {
      startDate: string;
      endDate: string;
      employeeId?: string;
    },
  ): Promise<{
    records: EmployeeSchedule[];
    summary: {
      totalScheduled: number;
      totalPresent: number;
      totalAbsent: number;
      totalLate: number;
      totalHoursWorked: number;
      totalOvertimeHours: number;
      attendanceRate: number;
    };
  }> {
    const conditions = [
      eq(employeeSchedules.restaurantId, restaurantId),
      gte(employeeSchedules.workDate, options.startDate),
      lte(employeeSchedules.workDate, options.endDate),
    ];

    if (options.employeeId) {
      conditions.push(eq(employeeSchedules.employeeId, options.employeeId));
    }

    const results = await this.db
      .select()
      .from(employeeSchedules)
      .where(and(...conditions))
      .orderBy(desc(employeeSchedules.workDate));

    const records = results as EmployeeSchedule[];

    // Single-pass summary calculation
    let totalPresent = 0;
    let totalAbsent = 0;
    let totalLate = 0;
    let totalHoursWorked = 0;
    let totalOvertimeHours = 0;

    for (const r of records) {
      if (
        r.status === "confirmed" ||
        r.status === "completed" ||
        r.clockInTime
      ) {
        totalPresent++;
      }
      if (r.status === "no_show") {
        totalAbsent++;
      }
      if (r.clockInTime && r.startTime) {
        const clockIn = new Date(r.clockInTime);
        const [hours, minutes] = r.startTime.split(":").map(Number);
        const scheduledStart = new Date(r.workDate);
        scheduledStart.setHours(hours, minutes, 0, 0);
        if (clockIn.getTime() > scheduledStart.getTime()) {
          totalLate++;
        }
      }
      totalHoursWorked += r.actualHours || 0;
      totalOvertimeHours += r.overtimeHours || 0;
    }

    const totalScheduled = records.length;
    const attendanceRate =
      totalScheduled > 0 ? (totalPresent / totalScheduled) * 100 : 0;

    return {
      records,
      summary: {
        totalScheduled,
        totalPresent,
        totalAbsent,
        totalLate,
        totalHoursWorked: Math.round(totalHoursWorked * 100) / 100,
        totalOvertimeHours: Math.round(totalOvertimeHours * 100) / 100,
        attendanceRate: Math.round(attendanceRate * 10) / 10,
      },
    };
  }

  // ========================================
  // Conflict Detection Engine
  // ========================================

  async checkScheduleConflicts(scheduleData: {
    employeeId: string;
    workDate: string;
    startTime: string;
    endTime: string;
    scheduledHours: number;
  }): Promise<ConflictCheckResult> {
    const conflicts: DetectedSchedulingConflict[] = [];
    const warnings: DetectedSchedulingConflict[] = [];
    const info: DetectedSchedulingConflict[] = [];

    // Check overlapping shifts
    const overlapping = await this.checkOverlappingShifts(
      scheduleData.employeeId,
      scheduleData.workDate,
      scheduleData.startTime,
      scheduleData.endTime,
    );
    conflicts.push(...overlapping);

    // Check rest period (11 hours)
    const restViolations = await this.checkRestPeriod(
      scheduleData.employeeId,
      scheduleData.workDate,
      scheduleData.startTime,
    );
    conflicts.push(...restViolations);

    // Check daily hours (max 12 hours)
    const dailyHours = await this.checkDailyHours(
      scheduleData.employeeId,
      scheduleData.workDate,
      scheduleData.scheduledHours,
    );
    if (dailyHours) warnings.push(dailyHours);

    // Check weekly hours (max 46 hours)
    const weeklyHours = await this.checkWeeklyHours(
      scheduleData.employeeId,
      scheduleData.workDate,
      scheduleData.scheduledHours,
    );
    if (weeklyHours) warnings.push(weeklyHours);

    // Check consecutive days (max 6 days)
    const consecutiveDays = await this.checkConsecutiveDays(
      scheduleData.employeeId,
      scheduleData.workDate,
    );
    if (consecutiveDays) warnings.push(consecutiveDays);

    // Check leave conflicts
    const leaveConflict = await this.checkLeaveConflict(
      scheduleData.employeeId,
      scheduleData.workDate,
    );
    if (leaveConflict) conflicts.push(leaveConflict);

    return {
      hasConflicts: conflicts.length > 0 || warnings.length > 0,
      conflicts,
      warnings,
      info,
    };
  }

  private async checkOverlappingShifts(
    employeeId: string,
    workDate: string,
    startTime: string,
    endTime: string,
  ): Promise<DetectedSchedulingConflict[]> {
    const existingSchedules = await this.db
      .select()
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.employeeId, employeeId),
          eq(employeeSchedules.workDate, workDate),
          sql`${employeeSchedules.status} != 'cancelled'`,
        ),
      );

    const conflicts: DetectedSchedulingConflict[] = [];
    for (const schedule of existingSchedules) {
      if (
        this.timesOverlap(
          startTime,
          endTime,
          schedule.startTime,
          schedule.endTime,
        )
      ) {
        conflicts.push({
          conflictType: "overlapping_shifts",
          severity: "error",
          message: `Overlapping shift detected: ${schedule.startTime}-${schedule.endTime}`,
          scheduleIds: JSON.stringify([schedule.id]),
          employeeIds: JSON.stringify([employeeId]),
        });
      }
    }

    return conflicts;
  }

  private async checkRestPeriod(
    employeeId: string,
    workDate: string,
    startTime: string,
  ): Promise<DetectedSchedulingConflict[]> {
    const yesterday = new Date(workDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const previousSchedules = await this.db
      .select()
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.employeeId, employeeId),
          eq(employeeSchedules.workDate, yesterdayStr),
          sql`${employeeSchedules.status} != 'cancelled'`,
        ),
      );

    const conflicts: DetectedSchedulingConflict[] = [];
    for (const prevSchedule of previousSchedules) {
      const restHours = this.calculateRestHours(
        prevSchedule.endTime,
        startTime,
      );
      if (restHours < 11) {
        conflicts.push({
          conflictType: "insufficient_rest",
          severity: "error",
          message: `Insufficient rest period: ${restHours.toFixed(1)} hours (minimum 11 hours required)`,
          scheduleIds: JSON.stringify([prevSchedule.id]),
          employeeIds: JSON.stringify([employeeId]),
        });
      }
    }

    return conflicts;
  }

  private async checkDailyHours(
    employeeId: string,
    workDate: string,
    additionalHours: number,
  ): Promise<DetectedSchedulingConflict | null> {
    const [result] = await this.db
      .select({
        totalHours: sql<number>`SUM(${employeeSchedules.scheduledHours})`,
      })
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.employeeId, employeeId),
          eq(employeeSchedules.workDate, workDate),
          sql`${employeeSchedules.status} != 'cancelled'`,
        ),
      );

    const currentHours = Number(result?.totalHours || 0);
    const newTotal = currentHours + additionalHours;

    if (newTotal > 12) {
      return {
        conflictType: "max_hours_exceeded",
        severity: "warning",
        message: `Daily hours exceeded: ${newTotal} hours (maximum 12 hours)`,
        employeeIds: JSON.stringify([employeeId]),
      };
    }

    return null;
  }

  private async checkWeeklyHours(
    employeeId: string,
    workDate: string,
    additionalHours: number,
  ): Promise<DetectedSchedulingConflict | null> {
    const date = new Date(workDate);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const [result] = await this.db
      .select({
        totalHours: sql<number>`SUM(${employeeSchedules.scheduledHours})`,
      })
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.employeeId, employeeId),
          between(
            employeeSchedules.workDate,
            weekStart.toISOString().split("T")[0],
            weekEnd.toISOString().split("T")[0],
          ),
          sql`${employeeSchedules.status} != 'cancelled'`,
        ),
      );

    const currentHours = Number(result?.totalHours || 0);
    const newTotal = currentHours + additionalHours;

    if (newTotal > 46) {
      return {
        conflictType: "max_hours_exceeded",
        severity: "warning",
        message: `Weekly hours exceeded: ${newTotal} hours (maximum 46 hours)`,
        employeeIds: JSON.stringify([employeeId]),
      };
    }

    return null;
  }

  private async checkConsecutiveDays(
    employeeId: string,
    workDate: string,
  ): Promise<DetectedSchedulingConflict | null> {
    const date = new Date(workDate);
    const weekAgo = new Date(date);
    weekAgo.setDate(date.getDate() - 7);

    // Single query: fetch all work dates in the past 7 days
    const results = await this.db
      .select({ workDate: employeeSchedules.workDate })
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.employeeId, employeeId),
          between(
            employeeSchedules.workDate,
            weekAgo.toISOString().split("T")[0],
            workDate,
          ),
          sql`${employeeSchedules.status} != 'cancelled'`,
        ),
      );

    // Build a set of worked dates, then count consecutive days backwards from workDate
    const workedDates = new Set(results.map((r) => r.workDate));
    let consecutiveDays = 1; // Count the new date itself
    for (let i = 1; i <= 7; i++) {
      const checkDate = new Date(date);
      checkDate.setDate(date.getDate() - i);
      if (workedDates.has(checkDate.toISOString().split("T")[0])) {
        consecutiveDays++;
      } else {
        break;
      }
    }

    if (consecutiveDays > 6) {
      return {
        conflictType: "consecutive_days_exceeded",
        severity: "warning",
        message: `Consecutive work days exceeded: ${consecutiveDays} days (maximum 6 days)`,
        employeeIds: JSON.stringify([employeeId]),
      };
    }

    return null;
  }

  private async checkLeaveConflict(
    employeeId: string,
    workDate: string,
  ): Promise<DetectedSchedulingConflict | null> {
    const [leave] = await this.db
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.status, "approved"),
          lte(leaveRequests.startDate, workDate),
          gte(leaveRequests.endDate, workDate),
        ),
      )
      .limit(1);

    if (leave) {
      return {
        conflictType: "leave_conflict",
        severity: "error",
        message: `Employee has approved leave on this date`,
        employeeIds: JSON.stringify([employeeId]),
        details: JSON.stringify({ leaveRequestId: leave.id }),
      };
    }

    return null;
  }

  // ========================================
  // Helper Methods
  // ========================================

  private timesOverlap(
    start1: string,
    end1: string,
    start2: string,
    end2: string,
  ): boolean {
    const [s1h, s1m] = start1.split(":").map(Number);
    const [e1h, e1m] = end1.split(":").map(Number);
    const [s2h, s2m] = start2.split(":").map(Number);
    const [e2h, e2m] = end2.split(":").map(Number);

    const start1Min = s1h * 60 + s1m;
    let end1Min = e1h * 60 + e1m;
    const start2Min = s2h * 60 + s2m;
    let end2Min = e2h * 60 + e2m;

    if (end1Min <= start1Min) end1Min += 24 * 60;
    if (end2Min <= start2Min) end2Min += 24 * 60;

    return start1Min < end2Min && end1Min > start2Min;
  }

  private calculateRestHours(endTime: string, startTime: string): number {
    const [eh, em] = endTime.split(":").map(Number);
    const [sh, sm] = startTime.split(":").map(Number);

    const endMin = eh * 60 + em;
    let startMin = sh * 60 + sm;

    if (startMin <= endMin) {
      startMin += 24 * 60;
    }

    return (startMin - endMin) / 60;
  }

  /**
   * Send a schedule change notification. Non-critical — errors are logged and swallowed.
   */
  private async sendScheduleNotification(
    employeeId: string,
    shiftTemplateId: number | null | undefined,
    opts: {
      category: NotificationCategory;
      scheduleDate: string;
      startTime: string;
      endTime: string;
      extra?: Record<string, string>;
      priority: "normal" | "high";
    },
  ): Promise<void> {
    try {
      const [employee] = await this.db
        .select()
        .from(users)
        .where(eq(users.id, employeeId))
        .limit(1);

      if (!employee?.email) return;

      const shiftTemplate = shiftTemplateId
        ? await this.getShiftTemplate(shiftTemplateId)
        : null;

      await this.notificationService.sendNotification({
        recipientId: employeeId,
        recipientEmail: employee.email,
        category: opts.category,
        type: "email",
        data: {
          employeeName: employee.fullName || employee.username,
          shiftName: shiftTemplate?.name || "Custom Shift",
          scheduleDate: opts.scheduleDate,
          startTime: opts.startTime,
          endTime: opts.endTime,
          ...opts.extra,
        },
        priority: opts.priority,
      });
    } catch (error) {
      console.error(`Failed to send ${opts.category} notification:`, error);
    }
  }

  // ========================================
  // Swap Requests (simplified)
  // ========================================

  /** Tenant-scoped swap request fetch — shared by all swap request actions */
  async getSwapRequest(
    id: number,
    restaurantId?: string,
  ): Promise<ScheduleSwapRequest | null> {
    const [request] = await this.db
      .select()
      .from(scheduleSwapRequests)
      .where(this.swapRequestWhere(id, restaurantId))
      .limit(1);

    return (request as ScheduleSwapRequest) || null;
  }

  async createSwapRequest(
    data: typeof scheduleSwapRequests.$inferInsert,
  ): Promise<ScheduleSwapRequest> {
    // Validate every referenced entity against the request's restaurant
    // before inserting — caller-supplied IDs must never be trusted.
    const [requesterSchedule] = await this.db
      .select()
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.id, data.requesterScheduleId),
          eq(employeeSchedules.restaurantId, data.restaurantId),
        ),
      )
      .limit(1);
    if (!requesterSchedule) {
      throw new Error("Requester schedule not found");
    }
    if (requesterSchedule.employeeId !== data.requesterEmployeeId) {
      throw new Error(
        "Requester schedule does not belong to the requesting employee",
      );
    }

    if (data.targetScheduleId) {
      const [targetSchedule] = await this.db
        .select()
        .from(employeeSchedules)
        .where(
          and(
            eq(employeeSchedules.id, data.targetScheduleId),
            eq(employeeSchedules.restaurantId, data.restaurantId),
          ),
        )
        .limit(1);
      if (!targetSchedule) {
        throw new Error("Target schedule not found");
      }
      if (
        data.targetEmployeeId &&
        targetSchedule.employeeId !== data.targetEmployeeId
      ) {
        throw new Error(
          "Target schedule does not belong to the target employee",
        );
      }
    }

    if (data.targetEmployeeId) {
      const [targetUser] = await this.db
        .select({ id: users.id, restaurantId: users.restaurantId })
        .from(users)
        .where(eq(users.id, data.targetEmployeeId))
        .limit(1);
      if (!targetUser || targetUser.restaurantId !== data.restaurantId) {
        throw new Error("Target employee not found in this restaurant");
      }
    }

    const [request] = await this.db
      .insert(scheduleSwapRequests)
      .values({
        ...data,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Send notification to target employee (if specified) or managers
    try {
      const requester = await this.db
        .select()
        .from(users)
        .where(eq(users.id, data.requesterEmployeeId))
        .limit(1);

      const requesterSchedule = await this.getSchedule(
        data.requesterScheduleId,
        data.restaurantId,
      );

      // If there's a specific target employee, notify them
      if (data.targetEmployeeId) {
        const target = await this.db
          .select()
          .from(users)
          .where(eq(users.id, data.targetEmployeeId))
          .limit(1);

        if (target[0]?.email) {
          await this.notificationService.sendNotification({
            recipientId: data.targetEmployeeId,
            recipientEmail: target[0].email,
            category: "swap_request_created",
            type: "email",
            data: {
              requesterName:
                requester[0]?.fullName || requester[0]?.username || "Employee",
              targetName: target[0].fullName || target[0].username,
              scheduleDate: requesterSchedule?.workDate || "",
              startTime: requesterSchedule?.startTime || "",
              endTime: requesterSchedule?.endTime || "",
              requestType: data.requestType,
              reason: data.reason,
              urgency: data.urgency,
            },
            priority:
              data.urgency === "urgent" || data.urgency === "high"
                ? "high"
                : "normal",
          });
        }
      }
    } catch (notifError) {
      console.error("Failed to send swap request notification:", notifError);
      // Don't fail the operation if notification fails
    }

    return request as ScheduleSwapRequest;
  }

  async approveSwapRequest(
    requestId: number,
    managerId: string,
    restaurantId?: string,
  ): Promise<ScheduleSwapRequest> {
    // Re-load and validate the swap request. Reads happen up front; the roster
    // reassignment and the approval commit atomically via `db.batch` (D1 does
    // not support interactive `db.transaction` / SQL BEGIN).
    const request = await this.getSwapRequest(requestId, restaurantId);

    if (!request) {
      throw new Error("Swap request not found");
    }

    // Only a pending (or employee-accepted) request may be approved.
    if (request.status !== "pending" && request.status !== "accepted") {
      throw new Error(
        `Swap request cannot be approved from status "${request.status}"`,
      );
    }

    const now = new Date();

    // The requester's schedule row is always the shift being changed. It must
    // still belong to the request's restaurant before any mutation happens.
    const [requesterRow] = await this.db
      .select()
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.id, request.requesterScheduleId),
          eq(employeeSchedules.restaurantId, request.restaurantId),
        ),
      )
      .limit(1);
    if (!requesterRow) {
      throw new Error("Requester schedule not found");
    }

    // Build the schedule reassignment writes according to the request type.
    const scheduleWrites: BatchItem<"sqlite">[] = [];
    switch (request.requestType) {
      case "swap": {
        // Exchange the assigned employee between the two shifts.
        if (!request.targetEmployeeId) {
          throw new Error("Swap request is missing a target employee");
        }
        if (request.targetScheduleId) {
          const [targetRow] = await this.db
            .select()
            .from(employeeSchedules)
            .where(
              and(
                eq(employeeSchedules.id, request.targetScheduleId),
                eq(employeeSchedules.restaurantId, request.restaurantId),
              ),
            )
            .limit(1);
          if (!targetRow) {
            throw new Error("Target schedule not found");
          }
          // Swap the employeeId on each row.
          scheduleWrites.push(
            this.db
              .update(employeeSchedules)
              .set({
                employeeId: targetRow.employeeId,
                updatedBy: managerId,
                updatedAt: now,
              })
              .where(
                this.scheduleWhere(request.requesterScheduleId, restaurantId),
              ) as BatchItem<"sqlite">,
            this.db
              .update(employeeSchedules)
              .set({
                employeeId: requesterRow.employeeId,
                updatedBy: managerId,
                updatedAt: now,
              })
              .where(
                this.scheduleWhere(request.targetScheduleId, restaurantId),
              ) as BatchItem<"sqlite">,
          );
        } else {
          // No target shift row — reassign the requester's shift outright.
          scheduleWrites.push(
            this.db
              .update(employeeSchedules)
              .set({
                employeeId: request.targetEmployeeId,
                updatedBy: managerId,
                updatedAt: now,
              })
              .where(
                this.scheduleWhere(request.requesterScheduleId, restaurantId),
              ) as BatchItem<"sqlite">,
          );
        }
        break;
      }
      case "cover": {
        // Someone else covers the shift — reassign to the target employee.
        if (!request.targetEmployeeId) {
          throw new Error("Cover request is missing a target employee");
        }
        scheduleWrites.push(
          this.db
            .update(employeeSchedules)
            .set({
              employeeId: request.targetEmployeeId,
              updatedBy: managerId,
              updatedAt: now,
            })
            .where(
              this.scheduleWhere(request.requesterScheduleId, restaurantId),
            ) as BatchItem<"sqlite">,
        );
        break;
      }
      case "drop": {
        // Drop the shift without a replacement — cancel the schedule row.
        scheduleWrites.push(
          this.db
            .update(employeeSchedules)
            .set({
              status: "cancelled",
              updatedBy: managerId,
              updatedAt: now,
            })
            .where(
              this.scheduleWhere(request.requesterScheduleId, restaurantId),
            ) as BatchItem<"sqlite">,
        );
        break;
      }
    }

    const requestUpdate = this.db
      .update(scheduleSwapRequests)
      .set({
        status: "approved",
        approvedBy: managerId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(this.swapRequestWhere(requestId, restaurantId))
      .returning() as BatchItem<"sqlite">;

    // Atomic batch: schedule reassignment first, approval last.
    const allWrites: BatchItem<"sqlite">[] = [...scheduleWrites, requestUpdate];
    const batchResults = await this.db.batch(
      allWrites as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );

    const updatedRows = batchResults[batchResults.length - 1] as Array<
      typeof request
    >;
    const updated = updatedRows[0];
    if (!updated) {
      throw new Error("Swap request not found");
    }

    // Send notifications outside the transaction (non-critical side effects)
    try {
      const requester = await this.db
        .select()
        .from(users)
        .where(eq(users.id, updated.requesterEmployeeId))
        .limit(1);

      const manager = await this.db
        .select()
        .from(users)
        .where(eq(users.id, managerId))
        .limit(1);

      const requesterSchedule = await this.getSchedule(
        updated.requesterScheduleId,
        updated.restaurantId,
      );

      if (requester[0]?.email) {
        await this.notificationService.sendNotification({
          recipientId: updated.requesterEmployeeId,
          recipientEmail: requester[0].email,
          category: "swap_request_approved",
          type: "email",
          data: {
            requesterName: requester[0].fullName || requester[0].username,
            managerName:
              manager[0]?.fullName || manager[0]?.username || "Manager",
            scheduleDate: requesterSchedule?.workDate || "",
            startTime: requesterSchedule?.startTime || "",
            endTime: requesterSchedule?.endTime || "",
            requestType: updated.requestType,
          },
          priority: "high",
        });
      }

      // Also notify target employee if specified
      if (updated.targetEmployeeId) {
        const target = await this.db
          .select()
          .from(users)
          .where(eq(users.id, updated.targetEmployeeId))
          .limit(1);

        if (target[0]?.email) {
          await this.notificationService.sendNotification({
            recipientId: updated.targetEmployeeId,
            recipientEmail: target[0].email,
            category: "swap_request_approved",
            type: "email",
            data: {
              requesterName:
                requester[0]?.fullName || requester[0]?.username || "Employee",
              targetName: target[0].fullName || target[0].username,
              managerName:
                manager[0]?.fullName || manager[0]?.username || "Manager",
              scheduleDate: requesterSchedule?.workDate || "",
              startTime: requesterSchedule?.startTime || "",
              endTime: requesterSchedule?.endTime || "",
              requestType: updated.requestType,
            },
            priority: "high",
          });
        }
      }
    } catch (notifError) {
      console.error(
        "Failed to send swap request approval notification:",
        notifError,
      );
      // Don't fail the operation if notification fails
    }

    return updated as ScheduleSwapRequest;
  }

  async acceptSwapRequest(
    requestId: number,
    employeeId: string,
    restaurantId?: string,
  ): Promise<ScheduleSwapRequest> {
    // First check if the request exists (in the caller's tenant) and is pending
    const request = await this.getSwapRequest(requestId, restaurantId);

    if (!request) {
      throw new Error("Swap request not found");
    }

    if (request.status !== "pending") {
      throw new Error("Swap request is not in pending status");
    }

    // A request addressed to a specific employee may only be accepted by that
    // employee. Open requests stay open to the whole (already scoped) tenant.
    if (
      !request.isOpenRequest &&
      request.targetEmployeeId &&
      request.targetEmployeeId !== employeeId
    ) {
      throw new Error("Only the target employee can accept this swap request");
    }

    // Update the request to accepted status. The tenant predicate is repeated
    // on the write, not left to the read above -- the same rule the rest of
    // this file follows.
    const [updated] = await this.db
      .update(scheduleSwapRequests)
      .set({
        status: "accepted",
        acceptedBy: employeeId,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(this.swapRequestWhere(requestId, restaurantId))
      .returning();

    if (!updated) {
      throw new Error("Failed to accept swap request");
    }

    return updated as ScheduleSwapRequest;
  }

  async rejectSwapRequest(
    requestId: number,
    managerId: string,
    reason: string,
    restaurantId?: string,
  ): Promise<ScheduleSwapRequest> {
    // First check if the request exists (in the caller's tenant)
    const request = await this.getSwapRequest(requestId, restaurantId);

    if (!request) {
      throw new Error("Swap request not found");
    }

    if (request.status === "rejected" || request.status === "cancelled") {
      throw new Error("Swap request is already rejected or cancelled");
    }

    // Update the request to rejected status
    const [updated] = await this.db
      .update(scheduleSwapRequests)
      .set({
        status: "rejected",
        rejectedBy: managerId,
        rejectedAt: new Date(),
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(this.swapRequestWhere(requestId, restaurantId))
      .returning();

    if (!updated) {
      throw new Error("Failed to reject swap request");
    }

    // Send notification to requester about rejection
    try {
      const requester = await this.db
        .select()
        .from(users)
        .where(eq(users.id, updated.requesterEmployeeId))
        .limit(1);

      const manager = await this.db
        .select()
        .from(users)
        .where(eq(users.id, managerId))
        .limit(1);

      const requesterSchedule = await this.getSchedule(
        updated.requesterScheduleId,
        updated.restaurantId,
      );

      if (requester[0]?.email) {
        await this.notificationService.sendNotification({
          recipientId: updated.requesterEmployeeId,
          recipientEmail: requester[0].email,
          category: "swap_request_rejected",
          type: "email",
          data: {
            requesterName: requester[0].fullName || requester[0].username,
            managerName:
              manager[0]?.fullName || manager[0]?.username || "Manager",
            scheduleDate: requesterSchedule?.workDate || "",
            startTime: requesterSchedule?.startTime || "",
            endTime: requesterSchedule?.endTime || "",
            requestType: updated.requestType,
            rejectionReason: reason,
          },
          priority: "high",
        });
      }
    } catch (notifError) {
      console.error(
        "Failed to send swap request rejection notification:",
        notifError,
      );
      // Don't fail the operation if notification fails
    }

    return updated as ScheduleSwapRequest;
  }

  async cancelSwapRequest(
    requestId: number,
    employeeId: string,
    restaurantId?: string,
  ): Promise<ScheduleSwapRequest> {
    // First check if the request exists (in the caller's tenant) and belongs
    // to the employee
    const request = await this.getSwapRequest(requestId, restaurantId);

    if (!request) {
      throw new Error("Swap request not found");
    }

    if (request.requesterEmployeeId !== employeeId) {
      throw new Error("Only the requester can cancel this swap request");
    }

    if (request.status !== "pending" && request.status !== "accepted") {
      throw new Error("Cannot cancel swap request in current status");
    }

    // Update the request to cancelled status
    const [updated] = await this.db
      .update(scheduleSwapRequests)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(this.swapRequestWhere(requestId, restaurantId))
      .returning();

    if (!updated) {
      throw new Error("Failed to cancel swap request");
    }

    return updated as ScheduleSwapRequest;
  }

  async getSwapRequests(
    filters: SwapRequestFilters,
  ): Promise<{ items: ScheduleSwapRequest[]; total: number }> {
    try {
      const { page = 1, limit = 20, ...restFilters } = filters;
      const { limit: pgLimit, offset } = this.createPagination(page, limit);

      const conditions = [];
      if (restFilters.restaurantId) {
        conditions.push(
          eq(scheduleSwapRequests.restaurantId, restFilters.restaurantId),
        );
      }
      if (restFilters.requesterEmployeeId) {
        conditions.push(
          eq(
            scheduleSwapRequests.requesterEmployeeId,
            restFilters.requesterEmployeeId,
          ),
        );
      }
      if (restFilters.targetEmployeeId) {
        conditions.push(
          eq(
            scheduleSwapRequests.targetEmployeeId,
            restFilters.targetEmployeeId,
          ),
        );
      }
      if (restFilters.status) {
        conditions.push(eq(scheduleSwapRequests.status, restFilters.status));
      }
      if (restFilters.requestType) {
        conditions.push(
          eq(scheduleSwapRequests.requestType, restFilters.requestType),
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [countResult] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(scheduleSwapRequests)
        .where(whereClause);

      const total = Number(countResult.count);

      const requests = await this.db
        .select()
        .from(scheduleSwapRequests)
        .where(whereClause)
        .orderBy(desc(scheduleSwapRequests.createdAt))
        .limit(pgLimit)
        .offset(offset);

      return { items: requests as ScheduleSwapRequest[], total };
    } catch (error) {
      console.error("Error getting swap requests:", error);
      throw error;
    }
  }

  // ========================================
  // Leave-Schedule Integration
  // ========================================

  /**
   * Cancel all schedules for an employee within a date range
   * Used when leave is approved to automatically cancel scheduled shifts
   */
  async cancelSchedulesByDateRange(params: {
    employeeId: string;
    startDate: string;
    endDate: string;
    reason: string;
    cancelledBy: string;
    restaurantId?: string;
  }): Promise<{ cancelledCount: number; scheduleIds: number[] }> {
    try {
      const [cancelledRows] = await this.db.batch([
        this.db
          .update(employeeSchedules)
          .set({
            status: "cancelled",
            managerNotes: params.reason,
            updatedBy: params.cancelledBy,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(employeeSchedules.employeeId, params.employeeId),
              ...(params.restaurantId === undefined
                ? []
                : [eq(employeeSchedules.restaurantId, params.restaurantId)]),
              between(
                employeeSchedules.workDate,
                params.startDate,
                params.endDate,
              ),
              sql`${employeeSchedules.status} != 'cancelled'`,
            ),
          )
          .returning({ id: employeeSchedules.id }) as BatchItem<"sqlite">,
      ]);
      const scheduleIds = (cancelledRows as Array<{ id: number }>)
        .map((row) => row.id)
        .sort((a, b) => a - b);

      return {
        cancelledCount: scheduleIds.length,
        scheduleIds,
      };
    } catch (error) {
      console.error("Error cancelling schedules by date range:", error);
      throw error;
    }
  }

  /**
   * Get available employees for scheduling
   * Filters out employees on leave and already scheduled
   */
  async getAvailableEmployees(params: {
    restaurantId: string;
    date: string;
    shiftTemplateId?: number;
  }): Promise<AvailableEmployee[]> {
    try {
      // Get all active employees in the restaurant. Archiving deactivates as
      // well, so `isActive` alone would already hide a departed employee --
      // but this picker must not depend on the two columns staying in step
      // (#337).
      const allEmployees = await this.db
        .select({
          id: users.id,
          fullName: users.fullName,
          role: users.role,
        })
        .from(users)
        .where(
          and(
            eq(users.restaurantId, params.restaurantId),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        );

      // Get employees on approved leave for this date
      const employeesOnLeave = await this.db
        .select({ employeeId: leaveRequests.employeeId })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.restaurantId, params.restaurantId),
            eq(leaveRequests.status, "approved"),
            lte(leaveRequests.startDate, params.date),
            gte(leaveRequests.endDate, params.date),
          ),
        );

      const onLeaveIds = new Set(employeesOnLeave.map((r) => r.employeeId));

      // Get employees already scheduled for this date
      const alreadyScheduled = await this.db
        .select({ employeeId: employeeSchedules.employeeId })
        .from(employeeSchedules)
        .where(
          and(
            eq(employeeSchedules.restaurantId, params.restaurantId),
            eq(employeeSchedules.workDate, params.date),
            sql`${employeeSchedules.status} != 'cancelled'`,
          ),
        );

      const scheduledIds = new Set(alreadyScheduled.map((s) => s.employeeId));

      // Filter available employees
      const availableEmployees = allEmployees
        .filter((emp) => !onLeaveIds.has(emp.id) && !scheduledIds.has(emp.id))
        .map((emp) => ({
          ...emp,
          availability: "available" as const,
          reason: "Available for scheduling",
        }));

      return availableEmployees;
    } catch (error) {
      console.error("Error getting available employees:", error);
      throw error;
    }
  }

  /**
   * Get scheduling conflicts with filters
   */
  async getConflicts(
    filters: ConflictFilters,
  ): Promise<{ items: SchedulingConflict[]; total: number }> {
    try {
      const { page = 1, limit = 20, ...restFilters } = filters;
      const { limit: pgLimit, offset } = this.createPagination(page, limit);

      const conditions = [];
      if (restFilters.restaurantId) {
        conditions.push(
          eq(schedulingConflicts.restaurantId, restFilters.restaurantId),
        );
      }
      if (restFilters.conflictType) {
        conditions.push(
          eq(schedulingConflicts.conflictType, restFilters.conflictType),
        );
      }
      if (restFilters.severity) {
        conditions.push(eq(schedulingConflicts.severity, restFilters.severity));
      }
      if (restFilters.status) {
        conditions.push(eq(schedulingConflicts.status, restFilters.status));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [countResult] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(schedulingConflicts)
        .where(whereClause);

      const total = Number(countResult.count);

      const conflicts = await this.db
        .select()
        .from(schedulingConflicts)
        .where(whereClause)
        .orderBy(desc(schedulingConflicts.detectedAt))
        .limit(pgLimit)
        .offset(offset);

      return { items: conflicts as SchedulingConflict[], total };
    } catch (error) {
      console.error("Error getting conflicts:", error);
      throw error;
    }
  }

  /**
   * Get a specific conflict by ID
   */
  async getConflict(
    id: number,
    restaurantId?: string,
  ): Promise<SchedulingConflict | null> {
    try {
      const [conflict] = await this.db
        .select()
        .from(schedulingConflicts)
        .where(this.conflictWhere(id, restaurantId))
        .limit(1);

      return (conflict as SchedulingConflict) || null;
    } catch (error) {
      console.error("Error getting conflict:", error);
      throw error;
    }
  }

  /**
   * Resolve a scheduling conflict
   */
  async resolveConflict(
    id: number,
    userId: string,
    resolutionNotes: string,
    restaurantId?: string,
  ): Promise<SchedulingConflict> {
    try {
      const [resolved] = await this.db
        .update(schedulingConflicts)
        .set({
          status: "resolved",
          resolvedBy: userId,
          resolvedAt: new Date(),
          resolutionNotes,
          updatedAt: new Date(),
        })
        .where(this.conflictWhere(id, restaurantId))
        .returning();

      if (!resolved) {
        throw new Error("Conflict not found");
      }

      return resolved as SchedulingConflict;
    } catch (error) {
      console.error("Error resolving conflict:", error);
      throw error;
    }
  }

  /**
   * Get daily scheduling statistics
   */
  async getDailyStats(
    restaurantId: string,
    date: string,
  ): Promise<DailySchedulingStats> {
    try {
      // Get total schedules for the day
      const [scheduleStats] = await this.db
        .select({
          totalSchedules: sql<number>`COUNT(*)`,
          totalEmployees: sql<number>`COUNT(DISTINCT ${employeeSchedules.employeeId})`,
          totalHours: sql<number>`SUM(${employeeSchedules.scheduledHours})`,
          scheduled: sql<number>`SUM(CASE WHEN ${employeeSchedules.status} = 'scheduled' THEN 1 ELSE 0 END)`,
          confirmed: sql<number>`SUM(CASE WHEN ${employeeSchedules.status} = 'confirmed' THEN 1 ELSE 0 END)`,
          completed: sql<number>`SUM(CASE WHEN ${employeeSchedules.status} = 'completed' THEN 1 ELSE 0 END)`,
          cancelled: sql<number>`SUM(CASE WHEN ${employeeSchedules.status} = 'cancelled' THEN 1 ELSE 0 END)`,
          noShow: sql<number>`SUM(CASE WHEN ${employeeSchedules.status} = 'no_show' THEN 1 ELSE 0 END)`,
        })
        .from(employeeSchedules)
        .where(
          and(
            eq(employeeSchedules.restaurantId, restaurantId),
            eq(employeeSchedules.workDate, date),
          ),
        );

      // Get shift type breakdown
      const shiftBreakdown = await this.db
        .select({
          shiftType: shiftTemplates.shiftType,
          count: sql<number>`COUNT(*)`,
        })
        .from(employeeSchedules)
        .leftJoin(
          shiftTemplates,
          eq(employeeSchedules.shiftTemplateId, shiftTemplates.id),
        )
        .where(
          and(
            eq(employeeSchedules.restaurantId, restaurantId),
            eq(employeeSchedules.workDate, date),
          ),
        )
        .groupBy(shiftTemplates.shiftType);

      // Get clock-in metrics
      const [clockMetrics] = await this.db
        .select({
          clockedIn: sql<number>`SUM(CASE WHEN ${employeeSchedules.clockInTime} IS NOT NULL THEN 1 ELSE 0 END)`,
          currentlyWorking: sql<number>`SUM(CASE WHEN ${employeeSchedules.clockInTime} IS NOT NULL AND ${employeeSchedules.clockOutTime} IS NULL THEN 1 ELSE 0 END)`,
          totalActualHours: sql<number>`COALESCE(SUM(${employeeSchedules.actualHours}), 0)`,
          totalOvertimeHours: sql<number>`COALESCE(SUM(${employeeSchedules.overtimeHours}), 0)`,
        })
        .from(employeeSchedules)
        .where(
          and(
            eq(employeeSchedules.restaurantId, restaurantId),
            eq(employeeSchedules.workDate, date),
          ),
        );

      return {
        date,
        totalSchedules: Number(scheduleStats.totalSchedules),
        totalEmployees: Number(scheduleStats.totalEmployees),
        totalHours: Number(scheduleStats.totalHours),
        clockedIn: Number(clockMetrics.clockedIn),
        currentlyWorking: Number(clockMetrics.currentlyWorking),
        totalActualHours: Number(clockMetrics.totalActualHours),
        totalOvertimeHours: Number(clockMetrics.totalOvertimeHours),
        statusBreakdown: {
          scheduled: Number(scheduleStats.scheduled),
          confirmed: Number(scheduleStats.confirmed),
          completed: Number(scheduleStats.completed),
          cancelled: Number(scheduleStats.cancelled),
          noShow: Number(scheduleStats.noShow),
        },
        shiftTypeBreakdown: shiftBreakdown.reduce(
          (acc, item) => {
            if (item.shiftType) {
              acc[item.shiftType] = Number(item.count);
            }
            return acc;
          },
          {} as Record<string, number>,
        ),
      };
    } catch (error) {
      console.error("Error getting daily stats:", error);
      throw error;
    }
  }

  /**
   * Get weekly schedule summary
   */
  async getWeeklySummary(
    restaurantId: string,
    weekStartDate: string,
  ): Promise<WeeklyScheduleSummary> {
    try {
      // Calculate week end date
      const startDate = new Date(weekStartDate);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      const weekEndDate = endDate.toISOString().split("T")[0];

      // Get weekly aggregated data
      const [weeklyStats] = await this.db
        .select({
          totalSchedules: sql<number>`COUNT(*)`,
          totalEmployees: sql<number>`COUNT(DISTINCT ${employeeSchedules.employeeId})`,
          totalHours: sql<number>`SUM(${employeeSchedules.scheduledHours})`,
          totalOvertimeHours: sql<number>`SUM(${employeeSchedules.overtimeHours})`,
          confirmed: sql<number>`SUM(CASE WHEN ${employeeSchedules.status} = 'confirmed' THEN 1 ELSE 0 END)`,
          completed: sql<number>`SUM(CASE WHEN ${employeeSchedules.status} = 'completed' THEN 1 ELSE 0 END)`,
          cancelled: sql<number>`SUM(CASE WHEN ${employeeSchedules.status} = 'cancelled' THEN 1 ELSE 0 END)`,
        })
        .from(employeeSchedules)
        .where(
          and(
            eq(employeeSchedules.restaurantId, restaurantId),
            between(employeeSchedules.workDate, weekStartDate, weekEndDate),
          ),
        );

      // Get daily breakdown
      const dailyBreakdown = await this.db
        .select({
          workDate: employeeSchedules.workDate,
          scheduleCount: sql<number>`COUNT(*)`,
          employeeCount: sql<number>`COUNT(DISTINCT ${employeeSchedules.employeeId})`,
          totalHours: sql<number>`SUM(${employeeSchedules.scheduledHours})`,
        })
        .from(employeeSchedules)
        .where(
          and(
            eq(employeeSchedules.restaurantId, restaurantId),
            between(employeeSchedules.workDate, weekStartDate, weekEndDate),
            sql`${employeeSchedules.status} != 'cancelled'`,
          ),
        )
        .groupBy(employeeSchedules.workDate)
        .orderBy(asc(employeeSchedules.workDate));

      return {
        weekStartDate,
        weekEndDate,
        totalSchedules: Number(weeklyStats.totalSchedules),
        totalEmployees: Number(weeklyStats.totalEmployees),
        totalHours: Number(weeklyStats.totalHours),
        totalOvertimeHours: Number(weeklyStats.totalOvertimeHours),
        confirmedSchedules: Number(weeklyStats.confirmed),
        completedSchedules: Number(weeklyStats.completed),
        cancelledSchedules: Number(weeklyStats.cancelled),
        dailyBreakdown: dailyBreakdown.map((day) => ({
          date: day.workDate,
          scheduleCount: Number(day.scheduleCount),
          employeeCount: Number(day.employeeCount),
          totalHours: Number(day.totalHours),
        })),
      };
    } catch (error) {
      console.error("Error getting weekly summary:", error);
      throw error;
    }
  }
}
