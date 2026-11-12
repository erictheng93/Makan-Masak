import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { users } from "./users";

/**
 * Google / LINE identities linked to staff `users` rows (shop owners only, see
 * the staff OAuth feature). Link-only: a row exists because a signed-in owner
 * attached it, never because a sign-in created it. Provider access/refresh
 * tokens are deliberately not stored; `provider_email` is a display snapshot
 * and is never used to match an account.
 *
 * Unlinking sets `revoked_at_ms` and keeps the row. The two unique indexes are
 * partial on `revoked_at_ms IS NULL`, so a provider account is live for at most
 * one user, and a user has at most one live identity per provider.
 */
export const userAuthIdentities = sqliteTable(
  "user_auth_identities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google", "line"] }).notNull(),
    providerUid: text("provider_uid").notNull(),
    providerEmail: text("provider_email"),
    providerEmailVerified: integer("provider_email_verified", {
      mode: "boolean",
    }),
    providerDisplayName: text("provider_display_name"),
    providerAvatarUrl: text("provider_avatar_url"),
    revokedAt: integer("revoked_at_ms", { mode: "timestamp_ms" }),
    verifiedAt: integer("verified_at_ms", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at_ms", { mode: "timestamp_ms" }),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    liveProviderUidIdx: uniqueIndex(
      "user_auth_identities_live_provider_uid_idx",
    )
      .on(table.provider, table.providerUid)
      .where(sql`${table.revokedAt} IS NULL`),
    liveUserProviderIdx: uniqueIndex(
      "user_auth_identities_live_user_provider_idx",
    )
      .on(table.userId, table.provider)
      .where(sql`${table.revokedAt} IS NULL`),
    userIdx: index("user_auth_identities_user_idx").on(table.userId),
  }),
);

export type UserAuthIdentity = typeof userAuthIdentities.$inferSelect;
