import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";
import { restaurants } from "./restaurants";

export const BILLING_NOTIFICATION_KINDS = {
  QUOTA_HARD: "quota_hard",
  TRIAL_3D: "trial_3d",
  TRIAL_1D: "trial_1d",
  TRIAL_0D: "trial_0d",
  PAYMENT_FAILED: "payment_failed",
  GRACE_PERIOD_START: "grace_period_start",
  ACCOUNT_SUSPENDED: "account_suspended",
  CYCLE_CLOSED: "cycle_closed",
  /** Owner email the first time a meter reaches its hard limit in a cycle. */
  QUOTA_HARD_OWNER: "quota_hard_owner",
  PLAN_CHANGE_APPLIED: "plan_change_applied",
  PLAN_CHANGE_SCHEDULED: "plan_change_scheduled",
  PLAN_CHANGE_CANCELLED: "plan_change_cancelled",
} as const;

export const NOTIFICATION_CHANNELS = {
  EMAIL: "email",
  SLACK: "slack",
} as const;

export const NOTIFICATION_DISPATCH_STATUSES = {
  SENT: "sent",
  SKIPPED_DUPLICATE: "skipped_duplicate",
  SKIPPED_PROVIDER_UNCONFIGURED: "skipped_provider_unconfigured",
  FAILED: "failed",
} as const;

export type BillingNotificationKind =
  (typeof BILLING_NOTIFICATION_KINDS)[keyof typeof BILLING_NOTIFICATION_KINDS];
export type NotificationChannel =
  (typeof NOTIFICATION_CHANNELS)[keyof typeof NOTIFICATION_CHANNELS];
export type NotificationDispatchStatus =
  (typeof NOTIFICATION_DISPATCH_STATUSES)[keyof typeof NOTIFICATION_DISPATCH_STATUSES];

export const notificationDispatchLog = sqliteTable(
  "notification_dispatch_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    restaurantId: text("restaurant_id").references(() => restaurants.id),
    kind: text("kind").$type<BillingNotificationKind>().notNull(),
    dedupKey: text("dedup_key").notNull(),
    channel: text("channel").$type<NotificationChannel>().notNull(),
    status: text("status").$type<NotificationDispatchStatus>().notNull(),
    recipient: text("recipient"),
    providerMessageId: text("provider_message_id"),
    errorMessage: text("error_message"),
    payload: text("payload", { mode: "json" }),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    dedupIdx: uniqueIndex("notification_dispatch_dedup_idx").on(
      table.restaurantId,
      table.kind,
      table.dedupKey,
      table.channel,
    ),
    restaurantTimeIdx: index("notification_dispatch_restaurant_time_idx").on(
      table.restaurantId,
      table.createdAt,
    ),
  }),
);

export const notificationDispatchLogRelations = relations(
  notificationDispatchLog,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [notificationDispatchLog.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

export type NotificationDispatchLog =
  typeof notificationDispatchLog.$inferSelect;
export type NewNotificationDispatchLog =
  typeof notificationDispatchLog.$inferInsert;
