/**
 * Marketing broadcast audit tables (issue #335, 商圈 Phase 4).
 *
 * These two tables are the feature's memory. Nothing about a send lives in a
 * log line:
 *
 *  * `marketing_broadcasts` is *also* the rate limiter. The per-scope budget
 *    is counted from these rows rather than from KV, so "how many did I send
 *    today" and "was I allowed to send this" can never disagree — a rejected
 *    send leaves no row, and a row that exists was permitted.
 *  * `marketing_broadcast_recipients` records one row per attempt, carrying
 *    the `consent_id` that was honoured. `customer_consents` is append-only,
 *    so a dispute months later is answered by joining the recipient row to
 *    the exact consent record that authorised it — not by trusting that the
 *    consent table's newest row today is the one that applied then.
 */

import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type {
  MarketingBroadcastRecipientStatus,
  MarketingBroadcastScope,
} from "@makanmasak/shared-types";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  customers,
  customerConsents,
  customerPushSubscriptions,
} from "./customers";
import { markets } from "./markets";
import { restaurants } from "./restaurants";
import { users } from "./users";

export const marketingBroadcasts = sqliteTable(
  "marketing_broadcasts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    /**
     * `scope_type` + `scope_id` is the rate-limit key, deliberately generic so
     * one index answers the count for both kinds of sender. `restaurant_id` /
     * `market_id` carry the same identifier again as a typed foreign key, so
     * a deleted restaurant takes its broadcasts with it. The migration's CHECK
     * keeps the two spellings in agreement.
     */
    scopeType: text("scope_type").notNull().$type<MarketingBroadcastScope>(),
    scopeId: text("scope_id").notNull(),

    restaurantId: text("restaurant_id").references(() => restaurants.id, {
      onDelete: "cascade",
    }),
    marketId: text("market_id").references(() => markets.id, {
      onDelete: "cascade",
    }),

    /** Nullable so deleting a staff account does not delete the audit row. */
    sentBy: text("sent_by").references(() => users.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url"),

    /** Distinct customers selected by follow ∩ consent ∩ preference. */
    audienceCount: integer("audience_count").notNull().default(0),
    /** The three below count *recipient rows*, and sum to their total. */
    deliveredCount: integer("delivered_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),

    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    /** Null while fan-out is still running. */
    completedAt: integer("completed_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    // The rate-limit count and the history list are the same query shape.
    scopeCreatedIdx: index("marketing_broadcasts_scope_created_idx").on(
      table.scopeType,
      table.scopeId,
      table.createdAt,
    ),
  }),
);

export const marketingBroadcastRecipients = sqliteTable(
  "marketing_broadcast_recipients",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    broadcastId: text("broadcast_id")
      .notNull()
      .references(() => marketingBroadcasts.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),

    /**
     * Null for the two `skipped_*` statuses: a customer inside their quiet
     * window, or one with no live subscription, is recorded once rather than
     * once per device.
     */
    subscriptionId: text("subscription_id").references(
      () => customerPushSubscriptions.id,
      { onDelete: "set null" },
    ),

    /** The consent row that authorised this send. Set on every attempt. */
    consentId: text("consent_id").references(() => customerConsents.id, {
      onDelete: "set null",
    }),

    status: text("status").notNull().$type<MarketingBroadcastRecipientStatus>(),
    /** e.g. PUSH_GONE (410/404), PUSH_HTTP_500, PUSH_ERROR. */
    errorCode: text("error_code"),

    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    // One attempt per device per broadcast. SQLite treats NULLs as distinct,
    // so the skipped rows (subscription_id IS NULL) are unconstrained by it,
    // which is what we want — several customers can be skipped in one send.
    //
    // This also serves as the `(broadcast_id)` index: a composite index's
    // leading column is usable on its own, so a second single-column index
    // would only cost writes.
    broadcastSubscriptionIdx: uniqueIndex(
      "marketing_broadcast_recipients_subscription_unique",
    ).on(table.broadcastId, table.subscriptionId),
  }),
);

export type MarketingBroadcast = typeof marketingBroadcasts.$inferSelect;
export type NewMarketingBroadcast = typeof marketingBroadcasts.$inferInsert;
export type MarketingBroadcastRecipient =
  typeof marketingBroadcastRecipients.$inferSelect;
export type NewMarketingBroadcastRecipient =
  typeof marketingBroadcastRecipients.$inferInsert;
