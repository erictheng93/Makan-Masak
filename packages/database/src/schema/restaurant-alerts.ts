import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";
import { restaurants } from "./restaurants";

export const RESTAURANT_ALERT_STATUS = {
  OPEN: "open",
  RESOLVED: "resolved",
  ESCALATED: "escalated",
} as const;

export type RestaurantAlertStatus =
  (typeof RESTAURANT_ALERT_STATUS)[keyof typeof RESTAURANT_ALERT_STATUS];

export const RESTAURANT_ALERT_SEVERITY = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type RestaurantAlertSeverity =
  (typeof RESTAURANT_ALERT_SEVERITY)[keyof typeof RESTAURANT_ALERT_SEVERITY];

/**
 * Owner-facing operational alerts (issue #285).
 *
 * Distinct from `backup_alerts` (backup job health) and the monitoring feature's
 * rule engine (system metrics): rows here are restaurant *business* events an
 * owner is expected to act on, and they are the only thing OwnerView's emergency
 * panel reads.
 *
 * The table is the integration point. Any module that detects an actionable
 * condition inserts a row through `RestaurantAlertService.raise`; nothing here
 * knows what produces alerts, so adding a producer never changes this schema.
 */
export const restaurantAlerts = sqliteTable(
  "restaurant_alerts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    // Producer-defined, e.g. "inventory_depleted". Deliberately not an enum:
    // the set of producers is expected to grow without a migration.
    alertType: text("alert_type").notNull(),
    severity: text("severity")
      .$type<RestaurantAlertSeverity>()
      .notNull()
      .default(RESTAURANT_ALERT_SEVERITY.MEDIUM),
    status: text("status")
      .$type<RestaurantAlertStatus>()
      .notNull()
      .default(RESTAURANT_ALERT_STATUS.OPEN),
    title: text("title").notNull(),
    description: text("description").notNull(),
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
    // Producers that poll must not create one row per tick. A nullable dedupe
    // key plus the partial unique index in the migration collapses repeats
    // while an alert is still open, and lets the same condition raise again
    // once it has been resolved.
    dedupeKey: text("dedupe_key"),
    resolvedAt: integer("resolved_at_ms", { mode: "timestamp_ms" }),
    resolvedBy: text("resolved_by"),
    escalatedAt: integer("escalated_at_ms", { mode: "timestamp_ms" }),
    escalatedBy: text("escalated_by"),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    // The panel's only query: open alerts for one restaurant, newest first.
    openIdx: index("restaurant_alerts_open_idx").on(
      table.restaurantId,
      table.status,
      table.createdAt,
    ),
    typeIdx: index("restaurant_alerts_type_idx").on(
      table.restaurantId,
      table.alertType,
    ),
  }),
);

export const restaurantAlertsRelations = relations(
  restaurantAlerts,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [restaurantAlerts.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

export type RestaurantAlert = typeof restaurantAlerts.$inferSelect;
export type NewRestaurantAlert = typeof restaurantAlerts.$inferInsert;
