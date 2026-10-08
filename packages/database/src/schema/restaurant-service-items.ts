import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { restaurants } from "./restaurants";

export const RESTAURANT_SERVICE_TYPES = [
  "general",
  "booking",
  "pickup",
  "delivery",
  "consultation",
  "rental",
  "activity",
] as const;

export type RestaurantServiceType = (typeof RESTAURANT_SERVICE_TYPES)[number];

export const SERVICE_ITEM_PAYMENT_REQUIREMENTS = [
  "none",
  "deposit",
  "prepay",
  "pay_at_venue",
] as const;

export type ServiceItemPaymentRequirement =
  (typeof SERVICE_ITEM_PAYMENT_REQUIREMENTS)[number];

export const restaurantServiceItems = sqliteTable(
  "restaurant_service_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    serviceType: text("service_type")
      .$type<RestaurantServiceType>()
      .notNull()
      .default("general"),
    priceCents: integer("price_cents"),
    paymentRequirement: text("payment_requirement")
      .$type<ServiceItemPaymentRequirement>()
      .notNull()
      .default("pay_at_venue"),
    depositAmountCents: integer("deposit_amount_cents").notNull().default(0),
    priceLabel: text("price_label"),
    durationMinutes: integer("duration_minutes"),
    requiresBooking: integer("requires_booking", { mode: "boolean" })
      .notNull()
      .default(false),
    bookingUrl: text("booking_url"),
    availableHours: text("available_hours", { mode: "json" }).$type<{
      start?: string;
      end?: string;
      days?: number[];
    }>(),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    keywords: text("keywords"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: integer("deleted_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    restaurantPublicIdx: index("restaurant_service_items_public_idx").on(
      table.restaurantId,
      table.isActive,
      table.isPublic,
      table.sortOrder,
    ),
    restaurantTypeIdx: index("restaurant_service_items_type_idx").on(
      table.restaurantId,
      table.serviceType,
      table.isActive,
    ),
    paymentRequirementCheck: check(
      "restaurant_service_items_payment_requirement_check",
      sql`${table.paymentRequirement} IN ('none', 'deposit', 'prepay', 'pay_at_venue')`,
    ),
    depositAmountCheck: check(
      "restaurant_service_items_deposit_amount_check",
      sql`${table.depositAmountCents} >= 0`,
    ),
  }),
);

export const restaurantServiceItemsRelations = relations(
  restaurantServiceItems,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [restaurantServiceItems.restaurantId],
      references: [restaurants.id],
    }),
  }),
);
