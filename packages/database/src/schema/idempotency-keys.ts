import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const IDEMPOTENCY_SCOPES = {
  PAYMENT: "payment",
  WEBHOOK: "webhook",
  PUBLIC_RESERVATION_CREATE: "public-reservation-create",
  PUBLIC_RESERVATION_CANCEL: "public-reservation-cancel",
  STAFF_RESERVATION_CREATE: "staff-reservation-create",
} as const;

export type IdempotencyScope =
  (typeof IDEMPOTENCY_SCOPES)[keyof typeof IDEMPOTENCY_SCOPES];

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    scope: text("scope").$type<IdempotencyScope>().notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    effectId: text("effect_id"),
    ownerToken: text("owner_token"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => ({
    scopeExpiresIdx: index("idempotency_keys_scope_expires_idx").on(
      table.scope,
      table.expiresAt,
    ),
    effectIdx: index("idempotency_keys_effect_idx").on(table.effectId),
  }),
);
