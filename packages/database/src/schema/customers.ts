/**
 * Customers Schema
 * 顧客資料表結構定義
 */

import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { CustomerAuthProvider } from "@makanmasak/shared-types";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ================================================
// TABLE: customers (顧客表)
// ================================================

export const customers = sqliteTable(
  "customers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    displayName: text("display_name").notNull(),
    primaryPhone: text("primary_phone"),
    primaryEmail: text("primary_email"),
    avatarUrl: text("avatar_url"),
    locale: text("locale"),
    status: text("status").notNull().default("active"),
    lastSeenAt: integer("last_seen_at_ms", { mode: "timestamp_ms" }),

    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    deletedAt: integer("deleted_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    primaryPhoneIdx: uniqueIndex("idx_customers_primary_phone")
      .on(table.primaryPhone)
      .where(
        sql`${table.primaryPhone} IS NOT NULL AND ${table.status} = 'active'`,
      ),
    primaryEmailIdx: uniqueIndex("idx_customers_primary_email")
      .on(table.primaryEmail)
      .where(
        sql`${table.primaryEmail} IS NOT NULL AND ${table.status} = 'active'`,
      ),
    statusLastSeenIdx: index("idx_customers_status_last_seen").on(
      table.status,
      table.lastSeenAt,
    ),
    createdAtIdx: index("idx_customers_created_at").on(table.createdAt),
  }),
);

export const customerPreferences = sqliteTable("customer_preferences", {
  customerId: text("customer_id")
    .primaryKey()
    .references(() => customers.id, { onDelete: "cascade" }),
  dietaryTags: text("dietary_tags", { mode: "json" }).$type<string[]>(),
  allergens: text("allergens", { mode: "json" }).$type<string[]>(),
  defaultPartySize: integer("default_party_size"),
  marketingOptIn: integer("marketing_opt_in").notNull().default(0),
  waitingListOptIn: integer("waiting_list_opt_in").notNull().default(1),
  promoFromFavoritesOptIn: integer("promo_from_favorites_opt_in")
    .notNull()
    .default(0),
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  preferredPaymentMethodId: text("preferred_payment_method_id"),
  updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/**
 * Marketing notification preferences (#335).
 *
 * Deliberately *not* folded into `customer_preferences` above. That table
 * predates STRICT, stores quiet hours as TEXT `"HH:MM"` that nothing ever
 * evaluated, and its `marketing_opt_in` / `promo_from_favorites_opt_in` flags
 * have no reader. Widening it in place would have meant recreating a legacy
 * table to gain STRICT and re-typing two columns, in the same change as the
 * feature that first reads them.
 *
 * This is the table the broadcast fan-out reads, and it is the only one:
 *
 *  * `marketing_enabled` short-circuits a send regardless of consent rows. A
 *    preference toggle and a consent record answer different questions ("do I
 *    want these?" vs "did you lawfully ask me?"), so both must be true.
 *  * `followed_only` decides whether a market's followers may be reached by a
 *    vendor inside that market (`includeMarketFollowers`). It never affects a
 *    direct follow.
 *  * Quiet hours are minutes from midnight (0-1439) rather than "HH:MM" text,
 *    evaluated in the *sender's* timezone. NULL on either bound means no quiet
 *    window at all; start === end is a zero-length window, not a whole day.
 */
export const customerNotificationPreferences = sqliteTable(
  "customer_notification_preferences",
  {
    customerId: text("customer_id")
      .primaryKey()
      .references(() => customers.id, { onDelete: "cascade" }),
    marketingEnabled: integer("marketing_enabled").notNull().default(1),
    followedOnly: integer("followed_only").notNull().default(1),
    quietHoursStartMin: integer("quiet_hours_start_min"),
    quietHoursEndMin: integer("quiet_hours_end_min"),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
);

export const customerFavorites = sqliteTable(
  "customer_favorites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    uniqueTargetIdx: uniqueIndex(
      "customer_favorites_customer_target_unique",
    ).on(table.customerId, table.targetType, table.targetId),
    listIdx: index("customer_favorites_customer_type_created_idx").on(
      table.customerId,
      table.targetType,
      table.createdAt,
    ),
    targetIdx: index("customer_favorites_target_idx").on(
      table.targetType,
      table.targetId,
    ),
  }),
);

export const customerRecentMarkets = sqliteTable(
  "customer_recent_markets",
  {
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    marketId: text("market_id").notNull(),
    visitedAt: integer("visited_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    uniqueMarketIdx: uniqueIndex("customer_recent_markets_customer_unique").on(
      table.customerId,
      table.marketId,
    ),
    listIdx: index("customer_recent_markets_customer_visited_idx").on(
      table.customerId,
      table.visitedAt,
    ),
    marketIdx: index("customer_recent_markets_market_idx").on(table.marketId),
  }),
);

export const customerPushSubscriptions = sqliteTable(
  "customer_push_subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dhKey: text("p256dh_key").notNull(),
    authKey: text("auth_key").notNull(),
    userAgent: text("user_agent"),
    deviceLabel: text("device_label"),
    lastUsedAt: integer("last_used_at_ms", { mode: "timestamp_ms" }),
    failureCount: integer("failure_count").notNull().default(0),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    customerIdx: index("customer_push_subscriptions_customer_idx").on(
      table.customerId,
    ),
    endpointIdx: uniqueIndex("customer_push_subscriptions_endpoint_unique").on(
      table.endpoint,
    ),
    lastUsedIdx: index("customer_push_subscriptions_last_used_idx").on(
      table.lastUsedAt,
    ),
  }),
);

export const customerConsents = sqliteTable(
  "customer_consents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    consentType: text("consent_type").notNull(),
    version: text("version").notNull(),
    granted: integer("granted").notNull(),
    grantedAt: integer("granted_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    revokedAt: integer("revoked_at_ms", { mode: "timestamp_ms" }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    source: text("source"),
  },
  (table) => ({
    activeIdx: index("customer_consents_customer_type_revoked_idx").on(
      table.customerId,
      table.consentType,
      table.revokedAt,
    ),
    typeVersionIdx: index("customer_consents_type_version_idx").on(
      table.consentType,
      table.version,
    ),
  }),
);

export const customerPhoneVerificationTokens = sqliteTable(
  "customer_phone_verification_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    phone: text("phone").notNull(),
    otpCode: text("otp_code").notNull(),
    expiresAt: integer("expires_at_ms", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at_ms", { mode: "timestamp_ms" }),
    attempts: integer("attempts").notNull().default(0),
    ipAddress: text("ip_address"),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    phoneExpiryIdx: index("customer_phone_tokens_phone_expiry_idx").on(
      table.phone,
      table.expiresAt,
    ),
    customerIdx: index("customer_phone_tokens_customer_idx").on(
      table.customerId,
    ),
  }),
);

export const customerAuthIdentities = sqliteTable(
  "customer_auth_identities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    provider: text("provider").$type<CustomerAuthProvider>().notNull(),
    providerUid: text("provider_uid").notNull(),
    secretHash: text("secret_hash"),
    encryptedPayload: text("encrypted_payload"),
    /**
     * The email the provider reported at link time. A snapshot for display and
     * for offering an account link — never a credential. LINE does not
     * guarantee it is verified, so matching on it must not merge accounts.
     */
    providerEmail: text("provider_email"),
    providerEmailVerified: integer("provider_email_verified", {
      mode: "boolean",
    }),
    providerDisplayName: text("provider_display_name"),
    providerAvatarUrl: text("provider_avatar_url"),
    /** Space-separated scope list. Not a secret. */
    scopes: text("scopes"),
    /** When the provider's access token expires. The token itself is not stored. */
    tokenExpiresAt: integer("token_expires_at_ms", { mode: "timestamp_ms" }),
    /** Set when the customer unlinks. The row is kept for the audit trail. */
    revokedAt: integer("revoked_at_ms", { mode: "timestamp_ms" }),
    verifiedAt: integer("verified_at_ms", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at_ms", { mode: "timestamp_ms" }),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    providerUidIdx: uniqueIndex("customer_auth_identities_provider_uid_idx").on(
      table.provider,
      table.providerUid,
    ),
    customerIdx: index("customer_auth_identities_customer_idx").on(
      table.customerId,
    ),
    onePasswordIdx: uniqueIndex("customer_auth_identities_one_password_idx")
      .on(table.customerId)
      .where(sql`${table.provider} = 'password'`),
    // One live link per provider per customer. Unlinking sets revokedAt rather
    // than deleting, so the customer can re-link a provider later without
    // colliding with their own revoked history.
    customerProviderLiveIdx: uniqueIndex(
      "customer_auth_identities_customer_provider_live_idx",
    )
      .on(table.customerId, table.provider)
      .where(sql`${table.revokedAt} IS NULL`),
    // Every OAuth callback looks up a live identity by provider + subject.
    liveProviderIdx: index("customer_auth_identities_live_provider_idx")
      .on(table.provider, table.providerUid)
      .where(sql`${table.revokedAt} IS NULL`),
  }),
);

export const customerVerificationTokens = sqliteTable(
  "customer_verification_tokens",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    purpose: text("purpose").notNull(),
    identifier: text("identifier").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at_ms", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at_ms", { mode: "timestamp_ms" }),
    ipAddress: text("ip_address"),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    hashIdx: uniqueIndex("customer_verification_tokens_hash_idx").on(
      table.tokenHash,
    ),
    lookupIdx: index("customer_verification_tokens_lookup_idx").on(
      table.identifier,
      table.purpose,
      table.createdAt,
    ),
  }),
);

// ================================================
// RELATIONS
// ================================================

export const customersRelations = relations(customers, ({ one, many }) => ({
  preferences: one(customerPreferences, {
    fields: [customers.id],
    references: [customerPreferences.customerId],
  }),
  favorites: many(customerFavorites),
  recentMarkets: many(customerRecentMarkets),
  pushSubscriptions: many(customerPushSubscriptions),
  consents: many(customerConsents),
  phoneVerificationTokens: many(customerPhoneVerificationTokens),
  authIdentities: many(customerAuthIdentities),
  verificationTokens: many(customerVerificationTokens),
}));

// ================================================
// TYPE INFERENCE
// ================================================

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
