/**
 * Employee Schedules Schema (員工排班)
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { restaurants } from "../restaurants";
import { users } from "../users";
import { shiftTemplates } from "./shift-templates";

// ========================================
// Employee Schedules (員工排班)
// ========================================

export const employeeSchedules = sqliteTable(
  "employee_schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: text("restaurant_id").notNull(), // 引用 restaurants.id (UUID v7)
    employeeId: text("employee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shiftTemplateId: integer("shift_template_id").references(
      () => shiftTemplates.id,
      { onDelete: "set null" },
    ),

    // Schedule Date & Time
    workDate: text("work_date").notNull(), // YYYY-MM-DD format
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    breakDurationMinutes: integer("break_duration_minutes").default(0),

    // Clock In/Out (Actual times)
    clockInTime: integer("clock_in_time_ms", { mode: "timestamp_ms" }),
    clockOutTime: integer("clock_out_time_ms", { mode: "timestamp_ms" }),

    // Hours Tracking
    scheduledHours: real("scheduled_hours").notNull(),
    actualHours: real("actual_hours").default(0),
    overtimeHours: real("overtime_hours").default(0),
    /** Hourly rate (cents) in force at clock-out: employee wage, else template rate. Migration 0048. */
    hourlyRateCents: integer("hourly_rate_cents"),

    // Status
    status: text("status", {
      enum: ["scheduled", "confirmed", "completed", "cancelled", "no_show"],
    })
      .notNull()
      .default("scheduled"),

    // Notes
    notes: text("notes"),
    managerNotes: text("manager_notes"),

    // Confirmation
    confirmedBy: text("confirmed_by").references(() => users.id),
    confirmedAt: integer("confirmed_at_ms", { mode: "timestamp_ms" }),

    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: integer("deleted_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    restaurantDateIdx: index("idx_employee_schedules_restaurant_date").on(
      table.restaurantId,
      table.workDate,
    ),
    employeeDateIdx: index("idx_employee_schedules_employee_date").on(
      table.employeeId,
      table.workDate,
    ),
    statusDateIdx: index("idx_employee_schedules_status_date").on(
      table.status,
      table.workDate,
    ),
  }),
);

export const employeeSchedulesRelations = relations(
  employeeSchedules,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [employeeSchedules.restaurantId],
      references: [restaurants.id], // UUID v7 primary key,
    }),
    employee: one(users, {
      fields: [employeeSchedules.employeeId],
      references: [users.id],
      relationName: "employeeSchedules",
    }),
    shiftTemplate: one(shiftTemplates, {
      fields: [employeeSchedules.shiftTemplateId],
      references: [shiftTemplates.id],
    }),
    creator: one(users, {
      fields: [employeeSchedules.createdBy],
      references: [users.id],
      relationName: "createdSchedules",
    }),
    confirmer: one(users, {
      fields: [employeeSchedules.confirmedBy],
      references: [users.id],
      relationName: "confirmedSchedules",
    }),
  }),
);
