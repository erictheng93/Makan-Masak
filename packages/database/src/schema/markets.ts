import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { SupportedCountryCode } from "@makanmasak/shared-types";
import { customers } from "./customers";
import { restaurants } from "./restaurants";

export type MarketGeoJsonBoundary =
  | {
      type: "Polygon";
      coordinates: number[][][];
    }
  | {
      type: "MultiPolygon";
      coordinates: number[][][][];
    };

export interface MarketMapLayout {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  width?: number | null;
  height?: number | null;
}

export const markets = sqliteTable(
  "markets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description"),
    city: text("city").notNull(),
    // 市集所在國。收平台費（platform_fee_rate_bps > 0）的市集必須有值，
    // 國家層的費率上限依它套用；NULL = 未知，不可當成任何國家。
    countryCode: text("country_code").$type<SupportedCountryCode>(),
    district: text("district").notNull(),
    address: text("address").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    boundaryGeojson: text("boundary_geojson", {
      mode: "json",
    }).$type<MarketGeoJsonBoundary | null>(),
    openingHours: text("opening_hours", { mode: "json" }).$type<Record<
      string,
      { open: string; close: string; closed?: boolean }
    > | null>(),
    mapLayout: text("map_layout", {
      mode: "json",
    }).$type<MarketMapLayout | null>(),
    bannerUrl: text("banner_url"),
    logoUrl: text("logo_url"),
    imageUrls: text("image_urls", { mode: "json" }).$type<string[]>(),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    platformFeeRateBps: integer("platform_fee_rate_bps").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: integer("deleted_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    cityDistrictActiveIdx: index("markets_city_district_active_idx").on(
      table.city,
      table.district,
      table.isActive,
    ),
    countryCodeIdx: index("markets_country_code_idx").on(table.countryCode),
  }),
);

export const restaurantMarketMemberships = sqliteTable(
  "restaurant_market_memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    stallNumber: text("stall_number"),
    locationLabel: text("location_label"),
    mapPosition: text("map_position", { mode: "json" }).$type<{
      x: number;
      y: number;
    } | null>(),
    marketHours: text("market_hours", { mode: "json" }).$type<Record<
      string,
      { open: string; close: string; closed?: boolean }
    > | null>(),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    joinedAt: integer("joined_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    leftAt: integer("left_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    activePairIdx: uniqueIndex("restaurant_market_active_pair_idx")
      .on(table.restaurantId, table.marketId)
      .where(sql`${table.leftAt} IS NULL`),
    marketActiveIdx: index("restaurant_market_market_active_idx").on(
      table.marketId,
      table.leftAt,
    ),
    restaurantActiveIdx: index("restaurant_market_restaurant_active_idx").on(
      table.restaurantId,
      table.leftAt,
    ),
  }),
);

export const marketJoinRequests = sqliteTable(
  "market_join_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    message: text("message"),
    requestedAt: integer("requested_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer("resolved_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    pendingPairIdx: uniqueIndex("market_join_requests_pending_pair_idx")
      .on(table.restaurantId, table.marketId)
      .where(sql`${table.status} = 'pending'`),
    restaurantStatusIdx: index("market_join_requests_restaurant_status_idx").on(
      table.restaurantId,
      table.status,
    ),
    marketStatusIdx: index("market_join_requests_market_status_idx").on(
      table.marketId,
      table.status,
    ),
  }),
);

export const marketCheckoutSessions = sqliteTable(
  "market_checkout_sessions",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "restrict" }),
    marketSlug: text("market_slug").notNull(),
    marketName: text("market_name").notNull(),
    platformFeeRateBps: integer("platform_fee_rate_bps").notNull().default(0),
    status: text("status").notNull().default("submitted"),
    paymentStatus: text("payment_status").notNull().default("pending"),
    // Not the retired shop-order pickup identifier that shared this name: this
    // is the credential POST /market-checkouts/:id/guest-token compares against
    // to re-issue a guest token for a customer who lost theirs. Child orders
    // are guest orders with no account behind them, so this is the only
    // recovery path — do not delete it as leftovers of the pickup-digits step.
    phoneLastDigits: text("phone_last_digits"),
    subtotalCents: integer("subtotal_cents").notNull(),
    childOrderCount: integer("child_order_count").notNull().default(0),
    paymentSummary: text("payment_summary", { mode: "json" }).$type<Record<
      string,
      unknown
    > | null>(),
    appliedVoucher: text("applied_voucher", { mode: "json" }).$type<Record<
      string,
      unknown
    > | null>(),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" }).notNull(),
    // Last, to match the physical column order: 0002 adds it with ALTER TABLE
    // ADD COLUMN, which always appends. Declaring it mid-table would leave a
    // regenerated baseline and a migrated database disagreeing on order for no
    // reason.
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    marketCreatedIdx: index("market_checkout_sessions_market_created_idx").on(
      table.marketId,
      table.createdAt,
    ),
    customerCreatedIdx: index(
      "market_checkout_sessions_customer_created_idx",
    ).on(table.customerId, table.createdAt),
    paymentStatusIdx: index("market_checkout_sessions_payment_status_idx").on(
      table.paymentStatus,
    ),
  }),
);

export const marketCheckoutChildOrders = sqliteTable(
  "market_checkout_child_orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    checkoutId: text("checkout_id")
      .notNull()
      .references(() => marketCheckoutSessions.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    restaurantName: text("restaurant_name").notNull(),
    orderId: text("order_id").notNull(),
    orderNumber: text("order_number").notNull(),
    totalAmountCents: integer("total_amount_cents").notNull(),
    tokenExpiresAt: integer("token_expires_at_ms", {
      mode: "timestamp_ms",
    }).notNull(),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    checkoutIdx: index("market_checkout_child_orders_checkout_idx").on(
      table.checkoutId,
    ),
    restaurantIdx: index("market_checkout_child_orders_restaurant_idx").on(
      table.restaurantId,
    ),
    checkoutOrderIdx: uniqueIndex(
      "market_checkout_child_orders_checkout_order_idx",
    ).on(table.checkoutId, table.orderId),
  }),
);

export const marketCheckoutPayments = sqliteTable(
  "market_checkout_payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    paymentId: text("payment_id").notNull().unique(),
    checkoutId: text("checkout_id")
      .notNull()
      .references(() => marketCheckoutSessions.id, { onDelete: "cascade" }),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    splitMode: text("split_mode")
      .$type<"child_transactions" | "provider_split">()
      .notNull(),
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    paidAmountCents: integer("paid_amount_cents").notNull().default(0),
    refundedAmountCents: integer("refunded_amount_cents").notNull().default(0),
    currency: text("currency"),
    countryCode: text("country_code"),
    childPaymentIds: text("child_payment_ids", { mode: "json" }).$type<
      string[]
    >(),
    providerTransactionId: text("provider_transaction_id"),
    providerPayload: text("provider_payload", { mode: "json" }).$type<Record<
      string,
      unknown
    > | null>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at_ms", { mode: "timestamp_ms" }),
    refundedAt: integer("refunded_at_ms", { mode: "timestamp_ms" }),
    failedAt: integer("failed_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    checkoutIdx: index("market_checkout_payments_checkout_idx").on(
      table.checkoutId,
      table.createdAt,
    ),
    marketStatusIdx: index("market_checkout_payments_market_status_idx").on(
      table.marketId,
      table.status,
      table.createdAt,
    ),
    idempotencyUniqueIdx: uniqueIndex(
      "market_checkout_payments_idempotency_unique_idx",
    )
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  }),
);

export const marketsRelations = relations(markets, ({ many }) => ({
  memberships: many(restaurantMarketMemberships),
  checkoutSessions: many(marketCheckoutSessions),
  checkoutPayments: many(marketCheckoutPayments),
}));

export const restaurantMarketMembershipsRelations = relations(
  restaurantMarketMemberships,
  ({ one }) => ({
    market: one(markets, {
      fields: [restaurantMarketMemberships.marketId],
      references: [markets.id],
    }),
    restaurant: one(restaurants, {
      fields: [restaurantMarketMemberships.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

export const marketJoinRequestsRelations = relations(
  marketJoinRequests,
  ({ one }) => ({
    market: one(markets, {
      fields: [marketJoinRequests.marketId],
      references: [markets.id],
    }),
    restaurant: one(restaurants, {
      fields: [marketJoinRequests.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

export const marketCheckoutSessionsRelations = relations(
  marketCheckoutSessions,
  ({ one, many }) => ({
    market: one(markets, {
      fields: [marketCheckoutSessions.marketId],
      references: [markets.id],
    }),
    childOrders: many(marketCheckoutChildOrders),
    payments: many(marketCheckoutPayments),
  }),
);

export const marketCheckoutChildOrdersRelations = relations(
  marketCheckoutChildOrders,
  ({ one }) => ({
    checkout: one(marketCheckoutSessions, {
      fields: [marketCheckoutChildOrders.checkoutId],
      references: [marketCheckoutSessions.id],
    }),
    restaurant: one(restaurants, {
      fields: [marketCheckoutChildOrders.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

export const marketCheckoutPaymentsRelations = relations(
  marketCheckoutPayments,
  ({ one }) => ({
    checkout: one(marketCheckoutSessions, {
      fields: [marketCheckoutPayments.checkoutId],
      references: [marketCheckoutSessions.id],
    }),
    market: one(markets, {
      fields: [marketCheckoutPayments.marketId],
      references: [markets.id],
    }),
  }),
);
