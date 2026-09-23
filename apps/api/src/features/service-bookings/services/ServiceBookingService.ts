/**
 * Service Booking (預約服務) Service — MVP.
 *
 * Internal booking of a restaurant_service_items row. Availability = service
 * hours + optional per-slot capacity. Payment (day 1):
 *   - 卷 (voucher) = pricing-layer discount (reuses single-shop CouponService
 *     validation; coupons.used_count incremented at confirmation, NOT a
 *     coupon_usage row — a booking is not an order),
 *   - 代幣 (credits) = payment via CreditService.spend,
 *   - cash / none = pay at venue.
 *
 * See docs/superpowers/specs/2026-06-03-service-reservation-system.md.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  employeeAvailability,
  serviceBookings,
  serviceBookingSlots,
  serviceBookingWaitlist,
  restaurantServiceItems,
  SERVICE_BOOKING_STATUS,
  SERVICE_BOOKING_PAYMENT_METHOD,
  SERVICE_BOOKING_PAYMENT_STATUS,
  SERVICE_BOOKING_PAYMENT_REQUIREMENT,
  SERVICE_BOOKING_WAITLIST_STATUS,
  type ServiceBookingStatus,
  users,
} from "@makanmasak/database";
import { CouponService } from "@makanmasak/database";
import type { Env } from "../../../types/env";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../../shared/utils/api-error";
import { toCents } from "../../../shared/utils/money";
import { CreditService } from "../../credits/services/CreditService";
import { resolveRestaurantCurrency } from "../../../shared/utils/restaurant-currency";
import { ServiceBookingNotificationService } from "./ServiceBookingNotificationService";
import { generateUUID } from "@makanmasak/utils";

type ServiceBookingRow = typeof serviceBookings.$inferSelect;
type ServiceBookingSlotRow = typeof serviceBookingSlots.$inferSelect;
type ServiceBookingWaitlistRow = typeof serviceBookingWaitlist.$inferSelect;
type EmployeeAvailabilityRow = typeof employeeAvailability.$inferSelect;

type ServiceBookingPaymentRequirement =
  (typeof SERVICE_BOOKING_PAYMENT_REQUIREMENT)[keyof typeof SERVICE_BOOKING_PAYMENT_REQUIREMENT];

const MAX_RECURRING_BOOKING_COUNT = 12;
export const MAX_BATCH_SLOT_CREATION_COUNT = 1000;

const getMutationChanges = (result: unknown): number => {
  if (typeof result !== "object" || result === null || !("meta" in result)) {
    return 0;
  }
  const meta = (result as { meta?: { changes?: unknown } }).meta;
  return typeof meta?.changes === "number" ? meta.changes : 0;
};

export interface CreateServiceBookingInput {
  restaurantId: string;
  serviceItemId: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerId?: string;
  bookingDate: string; // YYYY-MM-DD
  bookingTime: string; // HH:MM
  partySize?: number;
  employeeId?: string;
  specialRequests?: string;
  /** 卷 code applied as a pricing-layer discount. */
  voucherCode?: string;
  reminderOptIn?: boolean;
  reminderMinutesBefore?: number;
  recurrenceGroupId?: string;
  recurrenceIndex?: number;
  recurrenceCount?: number;
}

export interface CreateRecurringServiceBookingsInput extends Omit<
  CreateServiceBookingInput,
  "bookingDate" | "recurrenceGroupId" | "recurrenceIndex" | "recurrenceCount"
> {
  startDate: string;
  count: number;
  intervalWeeks?: number;
}

export interface JoinServiceBookingWaitlistInput {
  restaurantId: string;
  serviceItemId: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerId?: string;
  bookingDate: string;
  bookingTime: string;
  partySize?: number;
  employeeId?: string;
  specialRequests?: string;
  notes?: string;
}

export interface AvailabilitySlot {
  timeSlot: string;
  remaining: number | null; // null = uncapped (no slot row)
  isAvailable: boolean;
}

export interface CreateServiceBookingSlotInput {
  restaurantId: string;
  serviceItemId: number;
  date: string;
  timeSlot: string;
  maxCapacity: number;
  isAvailable?: boolean;
  blockReason?: string | null;
}

export interface BatchCreateServiceBookingSlotsInput {
  restaurantId: string;
  serviceItemId: number;
  startDate: string;
  endDate: string;
  timeSlots: string[];
  maxCapacity: number;
  isAvailable?: boolean;
}

export interface ServiceBookingContactProof {
  requireContact?: boolean;
  customerPhone?: string;
  customerEmail?: string;
}

export class ServiceBookingService {
  private readonly db: ReturnType<typeof drizzle>;
  private readonly d1: D1Database;
  private readonly env: Env;

  constructor(env: Env) {
    this.db = drizzle(env.DB);
    this.d1 = env.DB;
    this.env = env;
  }

  /** Open slots for a service on a date. Slot rows cap capacity; absent rows
   *  fall back to the service's availableHours (uncapped). */
  async getAvailability(input: {
    serviceItemId: number;
    date: string;
  }): Promise<AvailabilitySlot[]> {
    const slots = await this.db
      .select()
      .from(serviceBookingSlots)
      .where(
        and(
          eq(serviceBookingSlots.serviceItemId, input.serviceItemId),
          eq(serviceBookingSlots.date, input.date),
        ),
      )
      .all();

    return slots.map((slot) => ({
      timeSlot: slot.timeSlot,
      remaining: Math.max(0, slot.maxCapacity - slot.currentBookings),
      isAvailable:
        slot.isAvailable === 1 && slot.currentBookings < slot.maxCapacity,
    }));
  }

  async createBooking(
    input: CreateServiceBookingInput,
  ): Promise<ServiceBookingRow> {
    const service = await this.db
      .select()
      .from(restaurantServiceItems)
      .where(eq(restaurantServiceItems.id, input.serviceItemId))
      .get();

    if (!service || service.deletedAt || !service.isActive) {
      throw notFound("Service not found", "SERVICE_NOT_FOUND");
    }
    if (service.restaurantId !== input.restaurantId) {
      throw badRequest(
        "Service does not belong to this restaurant",
        "SERVICE_RESTAURANT_MISMATCH",
      );
    }
    if (!service.requiresBooking) {
      throw badRequest(
        "This service does not accept bookings",
        "SERVICE_NOT_BOOKABLE",
      );
    }

    assertWithinServiceHours(
      service.availableHours,
      input.bookingDate,
      input.bookingTime,
    );

    if (input.employeeId !== undefined) {
      await this.assertEmployeeAvailable({
        restaurantId: input.restaurantId,
        employeeId: input.employeeId,
        bookingDate: input.bookingDate,
        bookingTime: input.bookingTime,
        durationMinutes: service.durationMinutes ?? 0,
      });
    }

    let capacityReserved = false;
    try {
      // Reserve capacity if a slot row exists (operator-defined cap). A guarded
      // UPDATE makes the reservation atomic against concurrent bookings.
      await this.reserveSlotCapacity(
        input.serviceItemId,
        input.bookingDate,
        input.bookingTime,
      );
      capacityReserved = true;

      const priceCents = service.priceCents ?? 0;
      let couponId: number | null = null;
      let voucherDiscountCents = 0;
      if (input.voucherCode) {
        const priced = await this.priceVoucher(
          input.voucherCode,
          input.restaurantId,
          priceCents,
        );
        couponId = priced.couponId;
        voucherDiscountCents = priced.discountCents;
      }
      const amountDueCents = Math.max(0, priceCents - voucherDiscountCents);
      const payment = resolvePaymentTerms({
        requirement: service.paymentRequirement,
        amountDueCents,
        depositAmountCents: service.depositAmountCents,
      });
      const reminder = resolveReminder({
        optIn: input.reminderOptIn,
        minutesBefore: input.reminderMinutesBefore,
        bookingDate: input.bookingDate,
        bookingTime: input.bookingTime,
      });

      const confirmationCode = generateConfirmationCode();
      const calendarUid = `${generateUUID()}@makanmakan.service-bookings`;
      const [row] = await this.db
        .insert(serviceBookings)
        .values({
          restaurantId: input.restaurantId,
          serviceItemId: input.serviceItemId,
          serviceNameSnapshot: service.name,
          durationMinutesSnapshot: service.durationMinutes ?? null,
          priceCentsSnapshot: priceCents,
          customerId: input.customerId ?? null,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail ?? null,
          bookingDate: input.bookingDate,
          bookingTime: input.bookingTime,
          partySize: input.partySize ?? 1,
          employeeId: input.employeeId ?? null,
          status: SERVICE_BOOKING_STATUS.PENDING,
          confirmationCode,
          specialRequests: input.specialRequests ?? null,
          couponId,
          voucherDiscountCents,
          paymentRequirement: payment.requirement,
          depositRequiredCents: payment.depositRequiredCents,
          balanceDueCents: payment.balanceDueCents,
          amountDueCents: payment.amountDueCents,
          paymentStatus: SERVICE_BOOKING_PAYMENT_STATUS.UNPAID,
          paymentMethod: SERVICE_BOOKING_PAYMENT_METHOD.NONE,
          reminderOptIn: reminder.optIn ? 1 : 0,
          reminderMinutesBefore: reminder.minutesBefore,
          reminderScheduledAt: reminder.scheduledAt,
          calendarUid,
          recurrenceGroupId: input.recurrenceGroupId ?? null,
          recurrenceIndex: input.recurrenceIndex ?? null,
          recurrenceCount: input.recurrenceCount ?? null,
        })
        .returning();

      return row;
    } catch (error) {
      if (capacityReserved) {
        await this.releaseSlotCapacity(
          input.serviceItemId,
          input.bookingDate,
          input.bookingTime,
        ).catch((releaseError) => {
          console.error("serviceBooking.capacity.rollback.failed", {
            releaseError,
            serviceItemId: input.serviceItemId,
            bookingDate: input.bookingDate,
            bookingTime: input.bookingTime,
          });
        });
      }
      throw error;
    }
  }

  async createRecurringBookings(
    input: CreateRecurringServiceBookingsInput,
  ): Promise<ServiceBookingRow[]> {
    if (
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      input.count > MAX_RECURRING_BOOKING_COUNT
    ) {
      throw badRequest(
        `count must be between 1 and ${MAX_RECURRING_BOOKING_COUNT}`,
        "RECURRENCE_COUNT_INVALID",
      );
    }
    if (input.voucherCode) {
      throw badRequest(
        "Vouchers can only be applied to single bookings",
        "RECURRENCE_VOUCHER_UNSUPPORTED",
      );
    }
    const intervalWeeks = input.intervalWeeks ?? 1;
    if (
      !Number.isInteger(intervalWeeks) ||
      intervalWeeks < 1 ||
      intervalWeeks > 52
    ) {
      throw badRequest(
        "intervalWeeks must be between 1 and 52",
        "RECURRENCE_INTERVAL_INVALID",
      );
    }

    const groupId = generateUUID();
    const bookings: ServiceBookingRow[] = [];
    try {
      for (let index = 1; index <= input.count; index += 1) {
        const bookingDate = addWeeks(
          input.startDate,
          (index - 1) * intervalWeeks,
        );
        bookings.push(
          await this.createBooking({
            ...input,
            bookingDate,
            recurrenceGroupId: groupId,
            recurrenceIndex: index,
            recurrenceCount: input.count,
          }),
        );
      }
    } catch (error) {
      await this.rollbackRecurringBookings(bookings);
      throw error;
    }
    return bookings;
  }

  async joinWaitlist(
    input: JoinServiceBookingWaitlistInput,
  ): Promise<ServiceBookingWaitlistRow> {
    const service = await this.db
      .select()
      .from(restaurantServiceItems)
      .where(eq(restaurantServiceItems.id, input.serviceItemId))
      .get();

    if (!service || service.deletedAt || !service.isActive) {
      throw notFound("Service not found", "SERVICE_NOT_FOUND");
    }
    if (service.restaurantId !== input.restaurantId) {
      throw badRequest(
        "Service does not belong to this restaurant",
        "SERVICE_RESTAURANT_MISMATCH",
      );
    }
    if (!service.requiresBooking) {
      throw badRequest(
        "This service does not accept waitlist entries",
        "SERVICE_NOT_BOOKABLE",
      );
    }

    assertWithinServiceHours(
      service.availableHours,
      input.bookingDate,
      input.bookingTime,
    );

    if (input.employeeId !== undefined) {
      await this.assertEmployeeAvailable({
        restaurantId: input.restaurantId,
        employeeId: input.employeeId,
        bookingDate: input.bookingDate,
        bookingTime: input.bookingTime,
        durationMinutes: service.durationMinutes ?? 0,
      });
    }

    const [row] = await this.db
      .insert(serviceBookingWaitlist)
      .values({
        restaurantId: input.restaurantId,
        serviceItemId: input.serviceItemId,
        customerId: input.customerId ?? null,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail ?? null,
        bookingDate: input.bookingDate,
        bookingTime: input.bookingTime,
        partySize: input.partySize ?? 1,
        employeeId: input.employeeId ?? null,
        status: SERVICE_BOOKING_WAITLIST_STATUS.WAITING,
        specialRequests: input.specialRequests ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return row;
  }

  async listSlots(filters: {
    restaurantId: string;
    serviceItemId?: number;
    date?: string;
  }): Promise<ServiceBookingSlotRow[]> {
    const conditions = [
      eq(serviceBookingSlots.restaurantId, filters.restaurantId),
    ];
    if (filters.serviceItemId) {
      conditions.push(
        eq(serviceBookingSlots.serviceItemId, filters.serviceItemId),
      );
    }
    if (filters.date) {
      conditions.push(eq(serviceBookingSlots.date, filters.date));
    }

    return this.db
      .select()
      .from(serviceBookingSlots)
      .where(and(...conditions))
      .all();
  }

  async createSlot(
    input: CreateServiceBookingSlotInput,
  ): Promise<ServiceBookingSlotRow> {
    await this.assertServiceBelongsToRestaurant(
      input.serviceItemId,
      input.restaurantId,
    );

    const id = generateUUID();
    const isAvailable = input.isAvailable === false ? 0 : 1;
    const blockReason = input.blockReason ?? null;

    await this.d1
      .prepare(
        `INSERT INTO service_booking_slots (
            id, restaurant_id, service_item_id, date, time_slot, max_capacity,
            current_bookings, is_available, block_reason, created_at_ms,
            updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, unixepoch('now') * 1000,
            unixepoch('now') * 1000)
          ON CONFLICT(service_item_id, date, time_slot) DO UPDATE SET
            restaurant_id = excluded.restaurant_id,
            max_capacity = excluded.max_capacity,
            is_available = excluded.is_available,
            block_reason = excluded.block_reason,
            updated_at_ms = unixepoch('now') * 1000`,
      )
      .bind(
        id,
        input.restaurantId,
        input.serviceItemId,
        input.date,
        input.timeSlot,
        input.maxCapacity,
        isAvailable,
        blockReason,
      )
      .run();

    return this.requireSlot(input.serviceItemId, input.date, input.timeSlot);
  }

  async batchCreateSlots(
    input: BatchCreateServiceBookingSlotsInput,
  ): Promise<{ created: number; slots: ServiceBookingSlotRow[] }> {
    const dates = enumerateDates(input.startDate, input.endDate);
    const totalSlots = dates.length * input.timeSlots.length;
    if (totalSlots > MAX_BATCH_SLOT_CREATION_COUNT) {
      throw badRequest(
        `Cannot create more than ${MAX_BATCH_SLOT_CREATION_COUNT} slots at once`,
        "SERVICE_SLOT_BATCH_TOO_LARGE",
      );
    }

    const slots: ServiceBookingSlotRow[] = [];

    for (const date of dates) {
      for (const timeSlot of input.timeSlots) {
        slots.push(
          await this.createSlot({
            restaurantId: input.restaurantId,
            serviceItemId: input.serviceItemId,
            date,
            timeSlot,
            maxCapacity: input.maxCapacity,
            isAvailable: input.isAvailable,
          }),
        );
      }
    }

    return { created: slots.length, slots };
  }

  async blockSlot(input: {
    restaurantId: string;
    serviceItemId: number;
    date: string;
    timeSlot: string;
    blockReason?: string | null;
  }): Promise<ServiceBookingSlotRow> {
    await this.assertServiceBelongsToRestaurant(
      input.serviceItemId,
      input.restaurantId,
    );

    const id = generateUUID();
    await this.d1
      .prepare(
        `INSERT INTO service_booking_slots (
            id, restaurant_id, service_item_id, date, time_slot, max_capacity,
            current_bookings, is_available, block_reason, created_at_ms,
            updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, unixepoch('now') * 1000,
            unixepoch('now') * 1000)
          ON CONFLICT(service_item_id, date, time_slot) DO UPDATE SET
            is_available = 0,
            block_reason = excluded.block_reason,
            updated_at_ms = unixepoch('now') * 1000`,
      )
      .bind(
        id,
        input.restaurantId,
        input.serviceItemId,
        input.date,
        input.timeSlot,
        input.blockReason ?? "Blocked",
      )
      .run();

    return this.requireSlot(input.serviceItemId, input.date, input.timeSlot);
  }

  /** Pay the (voucher-discounted) amount with 代幣 and confirm the booking. */
  async payWithCredits(input: {
    bookingId: string;
    creditCardPublicId: string;
    pin?: string;
  }): Promise<ServiceBookingRow> {
    const booking = await this.loadPayableBooking(input.bookingId);
    if (
      booking.paymentRequirement ===
      SERVICE_BOOKING_PAYMENT_REQUIREMENT.PAY_AT_VENUE
    ) {
      throw badRequest(
        "This booking must be paid at the venue",
        "SERVICE_PAYMENT_AT_VENUE",
      );
    }

    let paymentRef: string | null = null;
    if (booking.amountDueCents > 0) {
      // The booking is priced in the restaurant's currency. Passing the card's
      // own currency here made CreditService.spend's currency check compare
      // the card with itself, so a TWD card settled an MYR booking.
      const currency = await resolveRestaurantCurrency(
        this.d1,
        booking.restaurantId,
      );
      const result = await new CreditService(this.env).spend({
        publicId: input.creditCardPublicId,
        amountCents: booking.amountDueCents,
        currency,
        idempotencyKey: `service-booking:${booking.id}`,
        sourceType: "service_booking",
        sourceId: booking.id,
        pin: input.pin,
      });
      paymentRef = result.ledgerEntryId;
    }

    return this.markConfirmed(booking, {
      method: SERVICE_BOOKING_PAYMENT_METHOD.CREDITS,
      amountPaidCents: booking.amountDueCents,
      paymentRef,
    });
  }

  /** Staff confirm for a pay-at-venue (cash) booking. */
  async confirmCash(bookingId: string): Promise<ServiceBookingRow> {
    const booking = await this.loadPayableBooking(bookingId);
    return this.markConfirmed(booking, {
      method: SERVICE_BOOKING_PAYMENT_METHOD.CASH,
      // amountDueCents is the amount this confirmation settles: the full
      // charge for pay-at-venue/prepay, or the required deposit for deposit.
      // Recording zero made a confirmed cash booking look unpaid in revenue
      // and cash-drawer reports.
      amountPaidCents: booking.amountDueCents,
      paymentRef: null,
    });
  }

  /** Public cancel — the confirmation code is the anonymous ownership proof. */
  async cancelByConfirmationCode(
    code: string,
    contactProof?: ServiceBookingContactProof,
  ): Promise<ServiceBookingRow> {
    const booking = await this.getByConfirmationCode(code, contactProof);
    if (!booking) throw notFound("Booking not found", "BOOKING_NOT_FOUND");
    return this.cancelBookingRow(booking);
  }

  /** Staff cancel by id (authenticated). */
  async cancelBooking(bookingId: string): Promise<ServiceBookingRow> {
    const booking = await this.requireBooking(bookingId);
    return this.cancelBookingRow(booking);
  }

  private async cancelBookingRow(
    booking: ServiceBookingRow,
  ): Promise<ServiceBookingRow> {
    if (
      booking.status === SERVICE_BOOKING_STATUS.CANCELLED ||
      booking.status === SERVICE_BOOKING_STATUS.COMPLETED ||
      booking.status === SERVICE_BOOKING_STATUS.NO_SHOW
    ) {
      throw conflict("Booking cannot be cancelled", "BOOKING_NOT_CANCELLABLE");
    }

    const now = new Date();
    const batch = [
      this.d1
        .prepare(
          `UPDATE service_bookings
              SET status = ?,
                  cancelled_at_ms = ?,
                  updated_at_ms = ?
            WHERE id = ? AND status = ?`,
        )
        .bind(
          SERVICE_BOOKING_STATUS.CANCELLED,
          now.getTime(),
          now.getTime(),
          booking.id,
          booking.status,
        ),
      this.d1
        .prepare(
          `UPDATE service_booking_slots
              SET current_bookings = CASE
                    WHEN current_bookings > 0 THEN current_bookings - 1 ELSE 0 END,
                  updated_at_ms = ?
            WHERE service_item_id = ?
              AND date = ?
              AND time_slot = ?
              AND EXISTS (
                SELECT 1 FROM service_bookings
                WHERE id = ?
                  AND status = ?
                  AND cancelled_at_ms = ?
              )`,
        )
        .bind(
          now.getTime(),
          booking.serviceItemId,
          booking.bookingDate,
          booking.bookingTime,
          booking.id,
          SERVICE_BOOKING_STATUS.CANCELLED,
          now.getTime(),
        ),
    ];

    if (
      booking.couponId &&
      booking.status === SERVICE_BOOKING_STATUS.CONFIRMED
    ) {
      batch.push(
        this.d1
          .prepare(
            `UPDATE coupons
                SET used_count = CASE
                      WHEN coalesce(used_count, 0) > 0
                      THEN coalesce(used_count, 0) - 1 ELSE 0 END,
                    updated_at_ms = ?
              WHERE id = ?
                AND EXISTS (
                  SELECT 1 FROM service_bookings
                  WHERE id = ?
                    AND status = ?
                    AND cancelled_at_ms = ?
                )`,
          )
          .bind(
            now.getTime(),
            booking.couponId,
            booking.id,
            SERVICE_BOOKING_STATUS.CANCELLED,
            now.getTime(),
          ),
      );
    }

    const [updateResult] = await this.d1.batch(batch);
    if (getMutationChanges(updateResult) === 0) {
      throw conflict("Booking cannot be cancelled", "BOOKING_NOT_CANCELLABLE");
    }

    const row = await this.requireBooking(booking.id);
    await this.dispatchNotification("cancelled", row);
    return row;
  }

  /** Staff transition a confirmed booking to completed or no_show. */
  async transition(
    bookingId: string,
    to: "completed" | "no_show",
  ): Promise<ServiceBookingRow> {
    const booking = await this.requireBooking(bookingId);
    if (booking.status !== SERVICE_BOOKING_STATUS.CONFIRMED) {
      throw conflict(
        "Only confirmed bookings can be completed or marked no-show",
        "BOOKING_INVALID_TRANSITION",
      );
    }
    const now = new Date();
    const patch =
      to === "completed"
        ? {
            status: SERVICE_BOOKING_STATUS.COMPLETED as ServiceBookingStatus,
            completedAt: now,
          }
        : {
            status: SERVICE_BOOKING_STATUS.NO_SHOW as ServiceBookingStatus,
            noShowAt: now,
          };
    const [row] = await this.db
      .update(serviceBookings)
      .set({ ...patch, updatedAt: now })
      .where(
        and(
          eq(serviceBookings.id, bookingId),
          eq(serviceBookings.status, SERVICE_BOOKING_STATUS.CONFIRMED),
        ),
      )
      .returning();
    if (!row) {
      throw conflict(
        "Only confirmed bookings can be completed or marked no-show",
        "BOOKING_INVALID_TRANSITION",
      );
    }
    await this.dispatchNotification(to, row);
    return row;
  }

  // ── reads ────────────────────────────────────────────

  async getById(id: string): Promise<ServiceBookingRow> {
    return this.requireBooking(id);
  }

  async getByConfirmationCode(
    code: string,
    contactProof?: ServiceBookingContactProof,
  ): Promise<ServiceBookingRow | null> {
    const booking = await this.db
      .select()
      .from(serviceBookings)
      .where(eq(serviceBookings.confirmationCode, code.toUpperCase()))
      .get();
    if (booking) {
      assertContactProof(booking, contactProof);
    }
    return booking ?? null;
  }

  async listByRestaurant(filters: {
    restaurantId: string;
    date?: string;
    status?: ServiceBookingStatus;
  }): Promise<ServiceBookingRow[]> {
    const conditions = [eq(serviceBookings.restaurantId, filters.restaurantId)];
    if (filters.date) {
      conditions.push(eq(serviceBookings.bookingDate, filters.date));
    }
    if (filters.status) {
      conditions.push(eq(serviceBookings.status, filters.status));
    }
    return this.db
      .select()
      .from(serviceBookings)
      .where(and(...conditions))
      .all();
  }

  async listDueReminders(input: {
    before: Date;
    restaurantId?: string;
  }): Promise<ServiceBookingRow[]> {
    const conditions = [
      eq(serviceBookings.status, SERVICE_BOOKING_STATUS.CONFIRMED),
      eq(serviceBookings.reminderOptIn, 1),
      isNull(serviceBookings.reminderSentAt),
      lte(serviceBookings.reminderScheduledAt, input.before),
    ];
    if (input.restaurantId) {
      conditions.push(eq(serviceBookings.restaurantId, input.restaurantId));
    }

    return this.db
      .select()
      .from(serviceBookings)
      .where(and(...conditions))
      .all();
  }

  async markReminderSent(bookingId: string): Promise<ServiceBookingRow> {
    const booking = await this.requireBooking(bookingId);
    const now = new Date();
    const [row] = await this.db
      .update(serviceBookings)
      .set({ reminderSentAt: now, updatedAt: now })
      .where(eq(serviceBookings.id, booking.id))
      .returning();
    return row;
  }

  async generateCalendarInvite(bookingId: string): Promise<string> {
    const booking = await this.requireBooking(bookingId);
    return renderCalendarInvite(booking);
  }

  async generateCalendarInviteByConfirmationCode(
    code: string,
    contactProof?: ServiceBookingContactProof,
  ): Promise<string> {
    const booking = await this.getByConfirmationCode(code, contactProof);
    if (!booking) throw notFound("Booking not found", "BOOKING_NOT_FOUND");
    return renderCalendarInvite(booking);
  }

  // ── internals ────────────────────────────────────────

  private async requireBooking(id: string): Promise<ServiceBookingRow> {
    const booking = await this.db
      .select()
      .from(serviceBookings)
      .where(eq(serviceBookings.id, id))
      .get();
    if (!booking) throw notFound("Booking not found", "BOOKING_NOT_FOUND");
    return booking;
  }

  private async requireSlot(
    serviceItemId: number,
    date: string,
    timeSlot: string,
  ): Promise<ServiceBookingSlotRow> {
    const slot = await this.db
      .select()
      .from(serviceBookingSlots)
      .where(
        and(
          eq(serviceBookingSlots.serviceItemId, serviceItemId),
          eq(serviceBookingSlots.date, date),
          eq(serviceBookingSlots.timeSlot, timeSlot),
        ),
      )
      .get();
    if (!slot) throw notFound("Slot not found", "SERVICE_SLOT_NOT_FOUND");
    return slot;
  }

  private async assertServiceBelongsToRestaurant(
    serviceItemId: number,
    restaurantId: string,
  ): Promise<void> {
    const service = await this.db
      .select({
        id: restaurantServiceItems.id,
        restaurantId: restaurantServiceItems.restaurantId,
      })
      .from(restaurantServiceItems)
      .where(eq(restaurantServiceItems.id, serviceItemId))
      .get();

    if (!service) {
      throw notFound("Service not found", "SERVICE_NOT_FOUND");
    }
    if (service.restaurantId !== restaurantId) {
      throw badRequest(
        "Service does not belong to this restaurant",
        "SERVICE_RESTAURANT_MISMATCH",
      );
    }
  }

  private async loadPayableBooking(id: string): Promise<ServiceBookingRow> {
    const booking = await this.requireBooking(id);
    if (booking.status !== SERVICE_BOOKING_STATUS.PENDING) {
      throw conflict("Booking is not awaiting payment", "BOOKING_NOT_PAYABLE");
    }
    return booking;
  }

  private async assertEmployeeAvailable(input: {
    restaurantId: string;
    employeeId: string;
    bookingDate: string;
    bookingTime: string;
    durationMinutes: number;
  }): Promise<void> {
    const employee = await this.db
      .select({
        id: users.id,
        restaurantId: users.restaurantId,
        isActive: users.isActive,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, input.employeeId))
      .get();

    if (
      !employee ||
      !employee.isActive ||
      employee.restaurantId !== input.restaurantId ||
      employee.role === 5
    ) {
      throw badRequest(
        "The assigned employee is not available for this booking",
        "SERVICE_EMPLOYEE_UNAVAILABLE",
      );
    }

    const rows = await this.db
      .select()
      .from(employeeAvailability)
      .where(
        and(
          eq(employeeAvailability.restaurantId, input.restaurantId),
          eq(employeeAvailability.employeeId, input.employeeId),
          eq(employeeAvailability.isActive, true),
        ),
      )
      .all();

    const bookingEnd = addMinutesToTime(
      input.bookingTime,
      input.durationMinutes,
    );
    const dayOfWeek = new Date(`${input.bookingDate}T00:00:00Z`).getUTCDay();
    const matching = rows
      .filter((row) =>
        availabilityRowMatches(row, {
          bookingDate: input.bookingDate,
          bookingTime: input.bookingTime,
          bookingEnd,
          dayOfWeek,
        }),
      )
      .sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) ||
          (b.availabilityType === "specific_date" ? 1 : 0) -
            (a.availabilityType === "specific_date" ? 1 : 0),
      );

    const decision = matching[0];
    if (!decision || decision.preferenceType === "unavailable") {
      throw badRequest(
        "The assigned employee is not available for this booking",
        "SERVICE_EMPLOYEE_UNAVAILABLE",
      );
    }

    await this.assertEmployeeHasNoOverlappingBooking(input);
  }

  private async assertEmployeeHasNoOverlappingBooking(input: {
    restaurantId: string;
    employeeId: string;
    bookingDate: string;
    bookingTime: string;
    durationMinutes: number;
  }): Promise<void> {
    const bookingEnd = addMinutesToTime(
      input.bookingTime,
      input.durationMinutes,
    );
    const activeBookings = await this.db
      .select({
        bookingTime: serviceBookings.bookingTime,
        durationMinutesSnapshot: serviceBookings.durationMinutesSnapshot,
      })
      .from(serviceBookings)
      .where(
        and(
          eq(serviceBookings.restaurantId, input.restaurantId),
          eq(serviceBookings.employeeId, input.employeeId),
          eq(serviceBookings.bookingDate, input.bookingDate),
          inArray(serviceBookings.status, [
            SERVICE_BOOKING_STATUS.PENDING,
            SERVICE_BOOKING_STATUS.CONFIRMED,
          ]),
        ),
      )
      .all();

    const overlaps = activeBookings.some((booking) => {
      const existingEnd = addMinutesToTime(
        booking.bookingTime,
        booking.durationMinutesSnapshot ?? 0,
      );
      return (
        input.bookingTime < existingEnd && booking.bookingTime < bookingEnd
      );
    });
    if (overlaps) {
      throw badRequest(
        "The assigned employee is not available for this booking",
        "SERVICE_EMPLOYEE_UNAVAILABLE",
      );
    }
  }

  private async markConfirmed(
    booking: ServiceBookingRow,
    payment: {
      method: (typeof SERVICE_BOOKING_PAYMENT_METHOD)[keyof typeof SERVICE_BOOKING_PAYMENT_METHOD];
      amountPaidCents: number;
      paymentRef: string | null;
    },
  ): Promise<ServiceBookingRow> {
    const now = new Date();
    const paymentStatus =
      booking.paymentRequirement === SERVICE_BOOKING_PAYMENT_REQUIREMENT.DEPOSIT
        ? SERVICE_BOOKING_PAYMENT_STATUS.DEPOSIT_PAID
        : SERVICE_BOOKING_PAYMENT_STATUS.PAID;
    const batch = [
      this.d1
        .prepare(
          `UPDATE service_bookings
              SET status = ?,
                  payment_status = ?,
                  payment_method = ?,
                  amount_paid_cents = ?,
                  payment_ref = ?,
                  confirmed_at_ms = ?,
                  updated_at_ms = ?
            WHERE id = ? AND status = ?`,
        )
        .bind(
          SERVICE_BOOKING_STATUS.CONFIRMED,
          paymentStatus,
          payment.method,
          payment.amountPaidCents,
          payment.paymentRef,
          now.getTime(),
          now.getTime(),
          booking.id,
          SERVICE_BOOKING_STATUS.PENDING,
        ),
    ];
    if (booking.couponId) {
      batch.push(
        this.d1
          .prepare(
            `UPDATE coupons
                SET used_count = coalesce(used_count, 0) + 1,
                    updated_at_ms = ?
              WHERE id = ?
                AND (usage_limit IS NULL OR coalesce(used_count, 0) < usage_limit)
                AND EXISTS (
                  SELECT 1 FROM service_bookings
                  WHERE id = ?
                    AND status = ?
                    AND confirmed_at_ms = ?
                )`,
          )
          .bind(
            now.getTime(),
            booking.couponId,
            booking.id,
            SERVICE_BOOKING_STATUS.CONFIRMED,
            now.getTime(),
          ),
      );
    }

    const [updateResult] = await this.d1.batch(batch);
    if (getMutationChanges(updateResult) === 0) {
      throw conflict("Booking is not awaiting payment", "BOOKING_NOT_PAYABLE");
    }

    const row = await this.requireBooking(booking.id);
    await this.dispatchNotification("confirmed", row);
    return row;
  }

  private async dispatchNotification(
    type: "confirmed" | "cancelled" | "completed" | "no_show",
    booking: ServiceBookingRow,
  ): Promise<void> {
    try {
      await new ServiceBookingNotificationService(this.d1, this.env).send({
        type,
        booking,
      });
    } catch (error) {
      console.error("serviceBooking.notification.failed", {
        type,
        bookingId: booking.id,
        error,
      });
    }
  }

  private async priceVoucher(
    code: string,
    restaurantId: string,
    priceCents: number,
  ): Promise<{ couponId: number; discountCents: number }> {
    const couponService = new CouponService(this.env.DB, this.env);
    const result = await couponService.validateCoupon(
      code,
      restaurantId,
      priceCents / 100,
    );
    if (!result.valid || !result.coupon) {
      throw badRequest(
        result.error ?? "This voucher does not apply",
        "VOUCHER_NOT_APPLICABLE",
      );
    }
    const discountCents = Math.min(
      toCents(result.discountAmount ?? 0) ?? 0,
      priceCents,
    );
    if (discountCents <= 0) {
      throw badRequest(
        "This voucher does not apply to this service",
        "VOUCHER_NOT_APPLICABLE",
      );
    }
    return { couponId: result.coupon.id, discountCents };
  }

  private async reserveSlotCapacity(
    serviceItemId: number,
    date: string,
    timeSlot: string,
  ): Promise<void> {
    const claim = await this.d1
      .prepare(
        `UPDATE service_booking_slots
            SET current_bookings = current_bookings + 1,
                updated_at_ms = unixepoch('now') * 1000
          WHERE service_item_id = ? AND date = ? AND time_slot = ?
            AND is_available = 1
            AND current_bookings < max_capacity`,
      )
      .bind(serviceItemId, date, timeSlot)
      .run();

    // 0 changes = either no slot row (uncapped — allow) or the slot is full.
    if ((claim.meta?.changes ?? 0) === 0) {
      const slot = await this.db
        .select({ id: serviceBookingSlots.id })
        .from(serviceBookingSlots)
        .where(
          and(
            eq(serviceBookingSlots.serviceItemId, serviceItemId),
            eq(serviceBookingSlots.date, date),
            eq(serviceBookingSlots.timeSlot, timeSlot),
          ),
        )
        .get();
      if (slot) {
        throw conflict("This time slot is fully booked", "SERVICE_SLOT_FULL");
      }
    }
  }

  private async releaseSlotCapacity(
    serviceItemId: number,
    date: string,
    timeSlot: string,
  ): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE service_booking_slots
            SET current_bookings = CASE
                  WHEN current_bookings > 0 THEN current_bookings - 1 ELSE 0 END,
                updated_at_ms = unixepoch('now') * 1000
          WHERE service_item_id = ? AND date = ? AND time_slot = ?`,
      )
      .bind(serviceItemId, date, timeSlot)
      .run();
  }

  private async rollbackRecurringBookings(
    bookings: ServiceBookingRow[],
  ): Promise<void> {
    for (const booking of [...bookings].reverse()) {
      if (booking.status !== SERVICE_BOOKING_STATUS.PENDING) continue;

      try {
        await this.db
          .delete(serviceBookings)
          .where(eq(serviceBookings.id, booking.id));
      } catch (error) {
        console.error("serviceBooking.recurring.rowRollback.failed", {
          error,
          bookingId: booking.id,
        });
        continue;
      }

      await this.releaseSlotCapacity(
        booking.serviceItemId,
        booking.bookingDate,
        booking.bookingTime,
      ).catch((error) => {
        console.error("serviceBooking.recurring.capacityRollback.failed", {
          error,
          bookingId: booking.id,
        });
      });
    }
  }

  private async claimCouponUse(couponId: number): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE coupons
            SET used_count = coalesce(used_count, 0) + 1,
                updated_at_ms = unixepoch('now') * 1000
          WHERE id = ?
            AND (usage_limit IS NULL OR coalesce(used_count, 0) < usage_limit)`,
      )
      .bind(couponId)
      .run();
  }

  private async decrementCouponUse(couponId: number): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE coupons
            SET used_count = CASE
                  WHEN coalesce(used_count, 0) > 0
                  THEN coalesce(used_count, 0) - 1 ELSE 0 END,
                updated_at_ms = unixepoch('now') * 1000
          WHERE id = ?`,
      )
      .bind(couponId)
      .run();
  }
}

// ── helpers ────────────────────────────────────────────

type ServiceAvailableHours = {
  start?: string;
  end?: string;
  days?: number[];
} | null;

function assertWithinServiceHours(
  availableHours: ServiceAvailableHours,
  date: string,
  time: string,
): void {
  if (!availableHours) return; // no constraint configured
  const { start, end, days } = availableHours;
  if (days && days.length > 0) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!days.includes(dow)) {
      throw badRequest(
        "The service is not available on this day",
        "SERVICE_DAY_UNAVAILABLE",
      );
    }
  }
  if (start && time < start) {
    throw badRequest(
      "The selected time is before the service opens",
      "SERVICE_TIME_UNAVAILABLE",
    );
  }
  if (end && time > end) {
    throw badRequest(
      "The selected time is after the service closes",
      "SERVICE_TIME_UNAVAILABLE",
    );
  }
}

function enumerateDates(start: string, end: string): string[] {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw badRequest("Invalid date range", "DATE_REQUIRED");
  }
  if (startDate > endDate) {
    throw badRequest("startDate must be before endDate", "DATE_RANGE_INVALID");
  }

  const dates: string[] = [];
  for (
    const date = new Date(startDate);
    date <= endDate;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function availabilityRowMatches(
  row: EmployeeAvailabilityRow,
  booking: {
    bookingDate: string;
    bookingTime: string;
    bookingEnd: string;
    dayOfWeek: number;
  },
): boolean {
  if (row.availabilityType === "recurring") {
    if (row.dayOfWeek !== booking.dayOfWeek) return false;
    return timeWindowCoversBooking(
      row.startTime,
      row.endTime,
      booking.bookingTime,
      booking.bookingEnd,
    );
  }

  if (row.availabilityType === "specific_date") {
    if (!row.startDate || !row.endDate) return false;
    if (
      row.startDate > booking.bookingDate ||
      row.endDate < booking.bookingDate
    )
      return false;
    if (!row.startTime && !row.endTime) return true;
    return timeWindowCoversBooking(
      row.startTime,
      row.endTime,
      booking.bookingTime,
      booking.bookingEnd,
    );
  }

  return false;
}

function timeWindowCoversBooking(
  availabilityStart: string | null,
  availabilityEnd: string | null,
  bookingStart: string,
  bookingEnd: string,
): boolean {
  if (!availabilityStart || !availabilityEnd) return false;
  return availabilityStart <= bookingStart && bookingEnd <= availabilityEnd;
}

function addMinutesToTime(time: string, minutes: number): string {
  const [hours = "0", mins = "0"] = time.split(":");
  const totalMinutes = Number(hours) * 60 + Number(mins) + minutes;
  const nextHours = Math.floor(totalMinutes / 60);
  const nextMinutes = totalMinutes % 60;
  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(
    2,
    "0",
  )}`;
}

function addWeeks(date: string, weeks: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("Invalid recurrence start date", "DATE_REQUIRED");
  }
  parsed.setUTCDate(parsed.getUTCDate() + weeks * 7);
  return parsed.toISOString().slice(0, 10);
}

function resolvePaymentTerms(input: {
  requirement: ServiceBookingPaymentRequirement | undefined;
  amountDueCents: number;
  depositAmountCents: number | undefined;
}): {
  requirement: ServiceBookingPaymentRequirement;
  depositRequiredCents: number;
  balanceDueCents: number;
  amountDueCents: number;
} {
  const requirement =
    input.requirement ?? SERVICE_BOOKING_PAYMENT_REQUIREMENT.PAY_AT_VENUE;
  if (requirement === SERVICE_BOOKING_PAYMENT_REQUIREMENT.NONE) {
    return {
      requirement,
      depositRequiredCents: 0,
      balanceDueCents: input.amountDueCents,
      amountDueCents: 0,
    };
  }
  if (requirement === SERVICE_BOOKING_PAYMENT_REQUIREMENT.DEPOSIT) {
    const deposit = input.depositAmountCents ?? 0;
    if (!Number.isInteger(deposit) || deposit <= 0) {
      throw badRequest(
        "depositAmountCents is required for deposit bookings",
        "SERVICE_DEPOSIT_REQUIRED",
      );
    }
    if (deposit > input.amountDueCents) {
      throw badRequest(
        "depositAmountCents cannot exceed the service balance",
        "SERVICE_DEPOSIT_INVALID",
      );
    }
    return {
      requirement,
      depositRequiredCents: deposit,
      balanceDueCents: input.amountDueCents - deposit,
      amountDueCents: deposit,
    };
  }
  return {
    requirement,
    depositRequiredCents: 0,
    balanceDueCents: 0,
    amountDueCents: input.amountDueCents,
  };
}

function resolveReminder(input: {
  optIn: boolean | undefined;
  minutesBefore: number | undefined;
  bookingDate: string;
  bookingTime: string;
}): {
  optIn: boolean;
  minutesBefore: number | null;
  scheduledAt: Date | null;
} {
  if (!input.optIn) {
    return { optIn: false, minutesBefore: null, scheduledAt: null };
  }
  const minutesBefore = input.minutesBefore ?? 60;
  if (
    !Number.isInteger(minutesBefore) ||
    minutesBefore < 5 ||
    minutesBefore > 10080
  ) {
    throw badRequest(
      "reminderMinutesBefore must be between 5 minutes and 7 days",
      "SERVICE_REMINDER_INVALID",
    );
  }
  const start = parseBookingDateTime(input.bookingDate, input.bookingTime);
  return {
    optIn: true,
    minutesBefore,
    scheduledAt: new Date(start.getTime() - minutesBefore * 60 * 1000),
  };
}

function renderCalendarInvite(booking: ServiceBookingRow): string {
  const startsAt = parseBookingDateTime(
    booking.bookingDate,
    booking.bookingTime,
  );
  const endsAt = new Date(
    startsAt.getTime() + (booking.durationMinutesSnapshot ?? 60) * 60 * 1000,
  );
  const stamp = formatIcsDate(new Date());
  const summary = escapeIcsText(booking.serviceNameSnapshot);
  const description = escapeIcsText(
    [
      `Confirmation: ${booking.confirmationCode}`,
      booking.specialRequests ? `Requests: ${booking.specialRequests}` : "",
    ]
      .filter(Boolean)
      .join("\\n"),
  );

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MakanMasak//Service Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(booking.calendarUid)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${formatIcsDate(startsAt)}`,
    `DTEND:${formatIcsDate(endsAt)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `STATUS:${booking.status === SERVICE_BOOKING_STATUS.CANCELLED ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function parseBookingDateTime(date: string, time: string): Date {
  const parsed = new Date(`${date}T${time}:00+08:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("Invalid booking date or time", "DATE_REQUIRED");
  }
  return parsed;
}

function formatIcsDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function assertContactProof(
  booking: ServiceBookingRow,
  contactProof: ServiceBookingContactProof | undefined,
): void {
  const phone = normalizePhone(contactProof?.customerPhone);
  const email = normalizeEmail(contactProof?.customerEmail);
  if (!phone && !email) {
    throw badRequest(
      "Booking phone or email is required",
      "SERVICE_BOOKING_CONTACT_REQUIRED",
    );
  }

  const phoneMatches =
    phone !== "" && normalizePhone(booking.customerPhone) === phone;
  const emailMatches =
    email !== "" && normalizeEmail(booking.customerEmail) === email;
  if (!phoneMatches && !emailMatches) {
    throw forbidden(
      "Booking contact does not match",
      "SERVICE_BOOKING_CONTACT_MISMATCH",
    );
  }
}

function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/[^\d+]/g, "");
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

// 16 bytes = 128 bits of entropy. The code doubles as the anonymous ownership
// proof for verify/cancel, so it must resist enumeration (not just be unique).
function generateConfirmationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
