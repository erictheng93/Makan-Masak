import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Short-lived key/value state that is written often: guest order tokens,
 * active-order locks, rate-limit counters.
 *
 * It lives in D1 rather than Workers KV because of quota shape, not speed: KV
 * allows 1,000 writes a day on the Free plan against D1's 100,000 rows, and
 * these keys are written on every guest order. D1 is also strongly consistent,
 * which KV is not. Rows are not removed on expiry — readers filter on
 * `expires_at_ms` and the daily cleanup cron deletes the leftovers.
 */
export const ephemeralKv = sqliteTable(
  "ephemeral_kv",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at_ms", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    expiresIdx: index("ephemeral_kv_expires_idx").on(table.expiresAt),
  }),
);
