/**
 * Per-shop e-wallet payment credentials.
 *
 * A Malaysian shop connects its *own* Touch 'n Go eWallet or GrabPay merchant
 * account so customers pay that shop directly — the platform never holds the
 * money. One row per (restaurant, provider).
 *
 * Secret storage (CLAUDE.md): everything an attacker could pay or sign with —
 * the merchant key, the client secret, the webhook secret — lives only inside
 * `secretPayloadEncrypted`, AES-256-GCM via `@makanmasak/utils`. `config` is a
 * JSON column for non-secret flags and holds no credential material. The
 * plaintext columns beside it (`merchantId`, `displayName`, `environment`) are
 * identifiers a provider prints on a dashboard and echoes in a webhook body:
 * they say *which* account this is, never that the caller may use it. Keeping
 * the merchant id out of the ciphertext is the same trade
 * `platform_integrations.store_id` makes (#338) — an inbound webhook has to
 * resolve the account before anything has authenticated it, and decrypting
 * every tenant's secrets to do that is worse than storing the identifier.
 */

import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { restaurants } from "./restaurants";

// ================================================
// ENUMS & CONSTANTS
// ================================================

/**
 * The e-wallets a shop can connect.
 *
 * Deliberately *not* a DB `CHECK` constraint. Every new wallet needs an
 * adapter before a row for it can do anything, and the route rejects a
 * provider with no adapter on write; a CHECK would add a recreate-table
 * migration to every wallet we ever add and buy only the ability to reject a
 * string that is already inert. `status` and `environment` are CHECKed,
 * because those sets are closed and a bad value there changes behaviour.
 */
export const SHOP_PAYMENT_PROVIDERS = {
  TNG: "tng",
  GRABPAY: "grabpay",
} as const;

export type ShopPaymentProvider =
  (typeof SHOP_PAYMENT_PROVIDERS)[keyof typeof SHOP_PAYMENT_PROVIDERS];

export const SHOP_PAYMENT_CREDENTIAL_STATUS = {
  CONNECTED: "connected",
  DISABLED: "disabled",
} as const;

export type ShopPaymentCredentialStatus =
  (typeof SHOP_PAYMENT_CREDENTIAL_STATUS)[keyof typeof SHOP_PAYMENT_CREDENTIAL_STATUS];

export const SHOP_PAYMENT_ENVIRONMENTS = {
  SANDBOX: "sandbox",
  PRODUCTION: "production",
} as const;

export type ShopPaymentEnvironment =
  (typeof SHOP_PAYMENT_ENVIRONMENTS)[keyof typeof SHOP_PAYMENT_ENVIRONMENTS];

/**
 * Non-secret per-connection preferences. Anything here is returned to the
 * owner's browser, so nothing that authenticates a call belongs in it.
 */
export interface ShopPaymentCredentialConfig {
  /** Owner-facing note, e.g. which outlet the merchant account belongs to. */
  note?: string;
  /** Provider-side callback/return URL the owner configured, if any. */
  returnUrl?: string;
}

// ================================================
// TABLE DEFINITION
// ================================================

export const shopPaymentCredentials = sqliteTable(
  "shop_payment_credentials",
  {
    id: text("id").primaryKey(),

    restaurantId: text("restaurant_id").notNull(),

    /** One of SHOP_PAYMENT_PROVIDERS; see the constant for why it is open. */
    provider: text("provider").$type<ShopPaymentProvider>().notNull(),

    status: text("status")
      .$type<ShopPaymentCredentialStatus>()
      .notNull()
      .default(SHOP_PAYMENT_CREDENTIAL_STATUS.CONNECTED),

    /** The provider's public identifier for the shop's merchant account. */
    merchantId: text("merchant_id").notNull(),

    /** What the owner calls this account in the admin UI. */
    displayName: text("display_name"),

    environment: text("environment")
      .$type<ShopPaymentEnvironment>()
      .notNull()
      .default(SHOP_PAYMENT_ENVIRONMENTS.SANDBOX),

    /**
     * AES-256-GCM ciphertext of the shop's secret payload (merchant key,
     * client secret, webhook secret). Never returned by any route, never
     * logged. NOT NULL: a connection with no secret cannot charge anything,
     * and a nullable column invites a row that looks connected and is not.
     */
    secretPayloadEncrypted: text("secret_payload_encrypted").notNull(),

    /** Non-secret flags only. */
    config: text("config", { mode: "json" })
      .$type<ShopPaymentCredentialConfig>()
      .notNull()
      .default(sql`'{}'`),

    /** When the secret was last written, so the UI can age a stale key. */
    secretUpdatedAt: integer("secret_updated_at_ms", {
      mode: "timestamp_ms",
    }).notNull(),

    connectedAt: integer("connected_at_ms", { mode: "timestamp_ms" }),
    disabledAt: integer("disabled_at_ms", { mode: "timestamp_ms" }),

    /** `users.id` of whoever last wrote this row, for the audit trail. */
    updatedBy: text("updated_by"),

    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    restaurantProviderIdx: uniqueIndex(
      "shop_payment_credentials_restaurant_provider_idx",
    ).on(table.restaurantId, table.provider),
    activeProviderIdx: index("shop_payment_credentials_active_idx").on(
      table.provider,
      table.status,
    ),
  }),
);

// ================================================
// RELATIONS
// ================================================

export const shopPaymentCredentialsRelations = relations(
  shopPaymentCredentials,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [shopPaymentCredentials.restaurantId],
      references: [restaurants.id],
    }),
  }),
);
