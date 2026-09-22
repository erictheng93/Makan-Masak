/**
 * Service Bookings Schema (預約服務的預約實例)
 *
 * Internal booking of a `restaurant_service_items` row (consultation, rental,
 * activity, …) for a date/time — the in-app alternative to the external
 * `booking_url`. Parallel to `reservations` (dining-table booking) but service
 * shaped, so it gets its own table rather than overloading `reservations`.
 *
 * Payment model (MVP, no real acquirer):
 *  - 卷 (voucher) = pricing-layer discount: `couponId` + `voucherDiscountCents`
 *    recorded on the booking (NOT a coupon_usage row — a booking is not an
 *    order); `coupons.used_count` is still incremented for limit enforcement.
 *  - 代幣 (credits) = payment: `amountDueCents` is spent via CreditService.
 *  - cash / none = pay at venue.
 *
 * PK: TEXT UUID v7. See docs/superpowers/specs/2026-06-03-service-reservation-system.md.
 */

import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { customers } from "./customers";
import { users } from "./users";
import { coupons } from "./coupons";
import { restaurantServiceItems } from "./restaurant-service-items";

// ── Status / payment constants ─────────────────────────

export const SERVICE_BOOKING_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
} as const;
export type ServiceBookingStatus =
  (typeof SERVICE_BOOKING_STATUS)[keyof typeof SERVICE_BOOKING_STATUS];

export const SERVICE_BOOKING_PAYMENT_METHOD = {
  NONE: "none", // pay at venue
  CASH: "cash",
  CREDITS: "credits", // 代幣
} as const;
export type ServiceBookingPaymentMethod =
  (typeof SERVICE_BOOKING_PAYMENT_METHOD)[keyof typeof SERVICE_BOOKING_PAYMENT_METHOD];

export const SERVICE_BOOKING_PAYMENT_STATUS = {
  UNPAID: "unpaid",
  DEPOSIT_PAID: "deposit_paid",
  PAID: "paid",
} as const;
export type ServiceBookingPaymentStatus =
  (typeof SERVICE_BOOKING_PAYMENT_STATUS)[keyof typeof SERVICE_BOOKING_PAYMENT_STATUS];

export const SERVICE_BOOKING_PAYMENT_REQUIREMENT = {
  NONE: "none",
  DEPOSIT: "deposit",
  PREPAY: "prepay",
  PAY_AT_VENUE: "pay_at_venue",
} as const;
export type ServiceBookingPaymentRequirement =
  (typeof SERVICE_BOOKING_PAYMENT_REQUIREMENT)[keyof typeof SERVICE_BOOKING_PAYMENT_REQUIREMENT];

export const SERVICE_BOOKING_WAITLIST_STATUS = {
  WAITING: "waiting",
  NOTIFIED: "notified",
  CONVERTED: "converted",
  CANCELLED: "cancelled",
} as const;
export type ServiceBookingWaitlistStatus =
  (typeof SERVICE_BOOKING_WAITLIST_STATUS)[keyof typeof SERVICE_BOOKING_WAITLIST_STATUS];

// ── Bookings table ─────────────────────────────────────

export const serviceBookings = sqliteTable(
  "service_bookings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    serviceItemId: integer("service_item_id")
      .notNull()
      .references(() => restaurantServiceItems.id, { onDelete: "cascade" }),

    // Snapshots — catalog edits must not move existing bookings.
    serviceNameSnapshot: text("service_name_snapshot").notNull(),
    durationMinutesSnapshot: integer("duration_minutes_snapshot"),
    priceCentsSnapshot: integer("price_cents_snapshot").notNull().default(0),

    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerEmail: text("customer_email"),

    bookingDate: text("booking_date").notNull(), // YYYY-MM-DD
    bookingTime: text("booking_time").notNull(), // HH:MM
    partySize: integer("party_size").notNull().default(1),

    // Reserved for a later staff-assignment phase (see spec). Nullable, unused
    // by MVP availability (service-level capacity only).
    employeeId: text("employee_id").references(() => users.id, {
      onDelete: "set null",
    }),

    status: text("status")
      .$type<ServiceBookingStatus>()
      .notNull()
      .default(SERVICE_BOOKING_STATUS.PENDING),
    confirmationCode: text("confirmation_code").notNull(),
    specialRequests: text("special_requests"),
    notes: text("notes"),

    // 卷 (voucher) = pricing-layer discount recorded on the booking.
    couponId: integer("coupon_id").references(() => coupons.id, {
      onDelete: "set null",
    }),
    voucherDiscountCents: integer("voucher_discount_cents")
      .notNull()
      .default(0),

    // Payment (代幣 / cash / none).
    paymentRequirement: text("payment_requirement")
      .$type<ServiceBookingPaymentRequirement>()
      .notNull()
      .default(SERVICE_BOOKING_PAYMENT_REQUIREMENT.PAY_AT_VENUE),
    depositRequiredCents: integer("deposit_required_cents")
      .notNull()
      .default(0),
    balanceDueCents: integer("balance_due_cents").notNull().default(0),
    amountDueCents: integer("amount_due_cents").notNull().default(0),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    paymentMethod: text("payment_method")
      .$type<ServiceBookingPaymentMethod>()
      .notNull()
      .default(SERVICE_BOOKING_PAYMENT_METHOD.NONE),
    paymentStatus: text("payment_status")
      .$type<ServiceBookingPaymentStatus>()
      .notNull()
      .default(SERVICE_BOOKING_PAYMENT_STATUS.UNPAID),
    paymentRef: text("payment_ref"), // e.g. credit ledger entry id

    reminderOptIn: integer("reminder_opt_in").notNull().default(0),
    reminderMinutesBefore: integer("reminder_minutes_before"),
    reminderScheduledAt: integer("reminder_scheduled_at_ms", {
      mode: "timestamp_ms",
    }),
    reminderSentAt: integer("reminder_sent_at_ms", { mode: "timestamp_ms" }),
    calendarUid: text("calendar_uid").notNull(),
    recurrenceGroupId: text("recurrence_group_id"),
    recurrenceIndex: integer("recurrence_index"),
    recurrenceCount: integer("recurrence_count"),

    confirmedAt: integer("confirmed_at_ms", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at_ms", { mode: "timestamp_ms" }),
    cancelledAt: integer("cancelled_at_ms", { mode: "timestamp_ms" }),
    noShowAt: integer("no_show_at_ms", { mode: "timestamp_ms" }),

    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    restaurantStatusDateIdx: index(
      "service_bookings_restaurant_status_date_idx",
    ).on(table.restaurantId, table.status, table.bookingDate),
    serviceDateTimeIdx: index("service_bookings_service_date_time_idx").on(
      table.serviceItemId,
      table.bookingDate,
      table.bookingTime,
    ),
    confirmationCodeIdx: uniqueIndex(
      "service_bookings_confirmation_code_idx",
    ).on(table.confirmationCode),
    customerPhoneIdx: index("service_bookings_customer_phone_idx").on(
      table.customerPhone,
    ),
    reminderDueIdx: index("service_bookings_reminder_due_idx").on(
      table.reminderScheduledAt,
      table.reminderSentAt,
      table.status,
    ),
    recurrenceGroupIdx: index("service_bookings_recurrence_group_idx").on(
      table.recurrenceGroupId,
    ),
  }),
);

// ── Capacity slots (optional; mirrors reservation_slots) ──

export const serviceBookingSlots = sqliteTable(
  "service_booking_slots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    serviceItemId: integer("service_item_id")
      .notNull()
      .references(() => restaurantServiceItems.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    timeSlot: text("time_slot").notNull(), // HH:MM
    maxCapacity: integer("max_capacity").notNull(),
    currentBookings: integer("current_bookings").notNull().default(0),
    isAvailable: integer("is_available").notNull().default(1),
    blockReason: text("block_reason"),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    slotIdx: uniqueIndex("service_booking_slots_unique_idx").on(
      table.serviceItemId,
      table.date,
      table.timeSlot,
    ),
    restaurantDateIdx: index("service_booking_slots_restaurant_date_idx").on(
      table.restaurantId,
      table.date,
    ),
  }),
);

// ── Waitlist ───────────────────────────────────────────

export const serviceBookingWaitlist = sqliteTable(
  "service_booking_waitlist",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    serviceItemId: integer("service_item_id")
      .notNull()
      .references(() => restaurantServiceItems.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerEmail: text("customer_email"),
    bookingDate: text("booking_date").notNull(),
    bookingTime: text("booking_time").notNull(),
    partySize: integer("party_size").notNull().default(1),
    employeeId: text("employee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status")
      .$type<ServiceBookingWaitlistStatus>()
      .notNull()
      .default(SERVICE_BOOKING_WAITLIST_STATUS.WAITING),
    specialRequests: text("special_requests"),
    notes: text("notes"),
    notifiedAt: integer("notified_at_ms", { mode: "timestamp_ms" }),
    convertedBookingId: text("converted_booking_id").references(
      () => serviceBookings.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    serviceDateTimeIdx: index("service_booking_waitlist_service_time_idx").on(
      table.serviceItemId,
      table.bookingDate,
      table.bookingTime,
      table.status,
    ),
    restaurantStatusIdx: index(
      "service_booking_waitlist_restaurant_status_idx",
    ).on(table.restaurantId, table.status, table.createdAt),
    customerPhoneIdx: index("service_booking_waitlist_customer_phone_idx").on(
      table.customerPhone,
    ),
  }),
);

// ── Relations ──────────────────────────────────────────

export const serviceBookingRelations = relations(
  serviceBookings,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [serviceBookings.restaurantId],
      references: [restaurants.id],
    }),
    serviceItem: one(restaurantServiceItems, {
      fields: [serviceBookings.serviceItemId],
      references: [restaurantServiceItems.id],
    }),
    customer: one(customers, {
      fields: [serviceBookings.customerId],
      references: [customers.id],
    }),
  }),
);

export const serviceBookingSlotRelations = relations(
  serviceBookingSlots,
  ({ one }) => ({
    serviceItem: one(restaurantServiceItems, {
      fields: [serviceBookingSlots.serviceItemId],
      references: [restaurantServiceItems.id],
    }),
  }),
);

export const serviceBookingWaitlistRelations = relations(
  serviceBookingWaitlist,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [serviceBookingWaitlist.restaurantId],
      references: [restaurants.id],
    }),
    serviceItem: one(restaurantServiceItems, {
      fields: [serviceBookingWaitlist.serviceItemId],
      references: [restaurantServiceItems.id],
    }),
    customer: one(customers, {
      fields: [serviceBookingWaitlist.customerId],
      references: [customers.id],
    }),
    convertedBooking: one(serviceBookings, {
      fields: [serviceBookingWaitlist.convertedBookingId],
      references: [serviceBookings.id],
    }),
  }),
);
