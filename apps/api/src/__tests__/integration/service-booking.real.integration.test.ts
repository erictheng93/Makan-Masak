/**
 * Real-D1 tests for ServiceBookingService (預約服務).
 *
 * Proves the booking core against real SQLite: availability window, atomic slot
 * capacity, voucher discount + used_count, credits payment + confirmation,
 * cancellation restoring capacity, lifecycle transitions.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  restaurants,
  restaurantServiceItems,
  serviceBookings,
  serviceBookingSlots,
  coupons,
  employeeAvailability,
  SERVICE_BOOKING_STATUS,
  SERVICE_BOOKING_PAYMENT_REQUIREMENT,
  type ServiceBookingStatus,
  users,
} from "@makanmasak/database";
import { eq } from "drizzle-orm";
import type { Env } from "../../types/env";
import { ServiceBookingService } from "../../features/service-bookings/services/ServiceBookingService";
import { ServiceBookingNotificationService } from "../../features/service-bookings/services/ServiceBookingNotificationService";
import serviceBookingRoutes from "../../features/service-bookings/routes";
import { CreditService } from "../../features/credits/services/CreditService";

let testDb: TestDatabase;
const RESTAURANT_ID = "r-svc";

function env(): Env {
  return {
    DB: testDb.bindings.DB,
    CACHE_KV: testDb.bindings.CACHE_KV,
  } as Env;
}

function service(): ServiceBookingService {
  return new ServiceBookingService(env());
}

async function seedRestaurant(
  id: string = RESTAURANT_ID,
  settings?: { currency: string },
): Promise<void> {
  await testDb.drizzle.insert(restaurants).values({
    id,
    ...(settings && { settings }),
    name: "Test Stall",
    type: "street_food",
    category: "activity",
    address: "1 Night Market Rd",
    district: "West",
    phone: "0900000000",
  });
}

async function seedService(options: {
  priceCents?: number;
  requiresBooking?: boolean;
  durationMinutes?: number;
  availableHours?: { start?: string; end?: string; days?: number[] } | null;
  restaurantId?: string;
}): Promise<number> {
  const [row] = await testDb.drizzle
    .insert(restaurantServiceItems)
    .values({
      restaurantId: options.restaurantId ?? RESTAURANT_ID,
      name: "Lantern Painting",
      serviceType: "activity",
      requiresBooking: options.requiresBooking ?? true,
      priceCents: options.priceCents ?? 15000,
      durationMinutes: options.durationMinutes ?? 60,
      availableHours: options.availableHours ?? null,
    })
    .returning({ id: restaurantServiceItems.id });
  return row.id;
}

async function seedSlot(
  serviceItemId: number,
  date: string,
  timeSlot: string,
  maxCapacity: number,
): Promise<void> {
  await testDb.drizzle.insert(serviceBookingSlots).values({
    restaurantId: RESTAURANT_ID,
    serviceItemId,
    date,
    timeSlot,
    maxCapacity,
  });
}

async function seedPlatformCoupon(
  code: string,
  discountPercent: number,
): Promise<number> {
  const [row] = await testDb.drizzle
    .insert(coupons)
    .values({
      code,
      name: code,
      restaurantId: null,
      discountType: "percentage",
      discountPercentageBps: discountPercent * 100,
      validFrom: new Date("2020-01-01T00:00:00.000Z"),
      validTo: new Date("2099-12-31T00:00:00.000Z"),
      isActive: true,
      isVisible: true,
    })
    .returning({ id: coupons.id });
  return row.id;
}

async function seedEmployee(
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  const [row] = await testDb.drizzle
    .insert(users)
    .values({
      username: `booking-employee-${crypto.randomUUID()}`,
      email: null,
      phone: null,
      fullName: "Booking Employee",
      passwordHash: "test",
      role: 3,
      restaurantId: RESTAURANT_ID,
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  return row.id;
}

async function seedEmployeeAvailability(
  input: Partial<typeof employeeAvailability.$inferInsert> & {
    employeeId: string;
  },
): Promise<void> {
  await testDb.drizzle.insert(employeeAvailability).values({
    restaurantId: RESTAURANT_ID,
    availabilityType: "recurring",
    dayOfWeek: 5,
    startTime: "09:00",
    endTime: "17:00",
    preferenceType: "available",
    priority: 0,
    isActive: true,
    ...input,
  });
}

async function usedCount(couponId: number): Promise<number> {
  const [row] = await testDb.drizzle
    .select({ usedCount: coupons.usedCount })
    .from(coupons)
    .where(eq(coupons.id, couponId))
    .all();
  return row?.usedCount ?? 0;
}

async function slotBookings(serviceItemId: number): Promise<number> {
  const [row] = await testDb.drizzle
    .select({ currentBookings: serviceBookingSlots.currentBookings })
    .from(serviceBookingSlots)
    .where(eq(serviceBookingSlots.serviceItemId, serviceItemId))
    .all();
  return row?.currentBookings ?? 0;
}

async function bookingCount(): Promise<number> {
  const rows = await testDb.drizzle.select().from(serviceBookings).all();
  return rows.length;
}

async function insertAssignedServiceBooking(input: {
  serviceItemId: number;
  employeeId: string;
  bookingDate: string;
  bookingTime: string;
  durationMinutes: number;
  status?: ServiceBookingStatus;
}): Promise<void> {
  await testDb.drizzle.insert(serviceBookings).values({
    restaurantId: RESTAURANT_ID,
    serviceItemId: input.serviceItemId,
    serviceNameSnapshot: "Lantern Painting",
    durationMinutesSnapshot: input.durationMinutes,
    priceCentsSnapshot: 0,
    customerName: `Guest ${crypto.randomUUID()}`,
    customerPhone: "0911222333",
    bookingDate: input.bookingDate,
    bookingTime: input.bookingTime,
    employeeId: input.employeeId,
    status: input.status ?? SERVICE_BOOKING_STATUS.PENDING,
    paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.PAY_AT_VENUE,
    confirmationCode: crypto.randomUUID().replace(/-/g, ""),
    calendarUid: `${crypto.randomUUID()}@makanmakan.service-bookings`,
  });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.dispose();
});
beforeEach(async () => {
  await testDb.truncateAll();
  await seedRestaurant();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ServiceBookingService — create", () => {
  it("creates a pending booking at full price", async () => {
    const serviceId = await seedService({ priceCents: 15000 });
    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
    });

    expect(booking).toMatchObject({
      status: "pending",
      paymentStatus: "unpaid",
      paymentRequirement: "pay_at_venue",
      priceCentsSnapshot: 15000,
      amountDueCents: 15000,
      serviceNameSnapshot: "Lantern Painting",
    });
    expect(booking.confirmationCode).toMatch(/^[0-9A-F]{32}$/);
  });

  it("rejects a non-bookable service", async () => {
    const serviceId = await seedService({ requiresBooking: false });
    await expect(
      service().createBooking({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Guest",
        customerPhone: "0911222333",
        bookingDate: "2026-06-05",
        bookingTime: "14:00",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_BOOKABLE" });
  });

  it("enforces the service available days", async () => {
    const serviceId = await seedService({
      availableHours: { start: "10:00", end: "18:00", days: [1, 2, 3, 4, 5] },
    });
    // 2026-06-07 is a Sunday (day 0) — outside Mon–Fri.
    await expect(
      service().createBooking({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Guest",
        customerPhone: "0911222333",
        bookingDate: "2026-06-07",
        bookingTime: "14:00",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_DAY_UNAVAILABLE" });
  });

  it("rejects a time before the service opens", async () => {
    const serviceId = await seedService({
      availableHours: { start: "10:00", end: "18:00" },
    });
    await expect(
      service().createBooking({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Guest",
        customerPhone: "0911222333",
        bookingDate: "2026-06-05",
        bookingTime: "09:00",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_TIME_UNAVAILABLE" });
  });

  it("applies a platform voucher as a discount", async () => {
    const serviceId = await seedService({ priceCents: 15000 });
    await seedPlatformCoupon("SVC10", 10);
    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      voucherCode: "SVC10",
    });
    expect(booking.voucherDiscountCents).toBe(1500);
    expect(booking.amountDueCents).toBe(13500);
    expect(booking.couponId).not.toBeNull();
  });
});

describe("ServiceBookingService — capacity", () => {
  it("creates operator-managed slots that drive availability and blocking", async () => {
    const serviceId = await seedService({});
    const slot = await service().createSlot({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      date: "2026-06-05",
      timeSlot: "14:00",
      maxCapacity: 2,
    });

    expect(slot).toMatchObject({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      date: "2026-06-05",
      timeSlot: "14:00",
      maxCapacity: 2,
      currentBookings: 0,
      isAvailable: 1,
    });
    expect(
      await service().getAvailability({
        serviceItemId: serviceId,
        date: "2026-06-05",
      }),
    ).toEqual([
      {
        timeSlot: "14:00",
        remaining: 2,
        isAvailable: true,
      },
    ]);

    await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "First",
      customerPhone: "0911000001",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
    });
    expect(
      await service().getAvailability({
        serviceItemId: serviceId,
        date: "2026-06-05",
      }),
    ).toEqual([
      {
        timeSlot: "14:00",
        remaining: 1,
        isAvailable: true,
      },
    ]);

    await service().blockSlot({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      date: "2026-06-05",
      timeSlot: "14:00",
      blockReason: "Private event",
    });
    expect(
      await service().getAvailability({
        serviceItemId: serviceId,
        date: "2026-06-05",
      }),
    ).toEqual([
      {
        timeSlot: "14:00",
        remaining: 1,
        isAvailable: false,
      },
    ]);

    await expect(
      service().createBooking({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Second",
        customerPhone: "0911000002",
        bookingDate: "2026-06-05",
        bookingTime: "14:00",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_SLOT_FULL" });
  });

  it("reserves slot capacity and rejects an overbooked slot", async () => {
    const serviceId = await seedService({});
    await seedSlot(serviceId, "2026-06-05", "14:00", 1);

    await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "First",
      customerPhone: "0911000001",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
    });
    expect(await slotBookings(serviceId)).toBe(1);

    await expect(
      service().createBooking({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Second",
        customerPhone: "0911000002",
        bookingDate: "2026-06-05",
        bookingTime: "14:00",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_SLOT_FULL" });
  });
});

describe("ServiceBookingService — payment & lifecycle", () => {
  async function issueCard(
    balanceCents: number,
    currency: "TWD" | "MYR" | "VND" = "TWD",
  ): Promise<string> {
    const card = await new CreditService(env()).issueCard({
      currency,
      initialBalanceCents: balanceCents,
    });
    return card.publicId;
  }

  it("pays with credits, confirms, and counts the voucher", async () => {
    const serviceId = await seedService({ priceCents: 15000 });
    const couponId = await seedPlatformCoupon("SVC10", 10);
    const publicId = await issueCard(100000);

    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      voucherCode: "SVC10",
    });

    const paid = await service().payWithCredits({
      bookingId: booking.id,
      creditCardPublicId: publicId,
    });

    expect(paid).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      paymentMethod: "credits",
      amountPaidCents: 13500,
    });
    expect(paid.paymentRef).toBeTruthy();
    expect(await usedCount(couponId)).toBe(1);

    const balance = await new CreditService(env()).getBalance(publicId);
    expect(balance.balanceCents).toBe(100000 - 13500);
  });

  it("refuses a card in another currency than the restaurant's", async () => {
    const MYR_RESTAURANT_ID = "r-svc-myr";
    await seedRestaurant(MYR_RESTAURANT_ID, { currency: "MYR" });
    const serviceId = await seedService({
      priceCents: 5000,
      restaurantId: MYR_RESTAURANT_ID,
    });
    const twdCard = await issueCard(100000, "TWD");
    const myrCard = await issueCard(100000, "MYR");

    const booking = await service().createBooking({
      restaurantId: MYR_RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
    });

    // Before the fix the card's own currency was passed as the booking's, so
    // this TWD card paid RM50 as NT$50.
    await expect(
      service().payWithCredits({
        bookingId: booking.id,
        creditCardPublicId: twdCard,
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CURRENCY_MISMATCH" });
    expect(
      (await new CreditService(env()).getBalance(twdCard)).balanceCents,
    ).toBe(100000);
    const [stillPending] = await testDb.drizzle
      .select({ status: serviceBookings.status })
      .from(serviceBookings)
      .where(eq(serviceBookings.id, booking.id));
    expect(stillPending?.status).toBe("pending");

    await expect(
      service().payWithCredits({
        bookingId: booking.id,
        creditCardPublicId: myrCard,
      }),
    ).resolves.toMatchObject({ status: "confirmed", amountPaidCents: 5000 });
    expect(
      (await new CreditService(env()).getBalance(myrCard)).balanceCents,
    ).toBe(95000);
  });

  it("pays only the required deposit and leaves the venue balance due", async () => {
    const serviceId = await seedService({ priceCents: 10000 });
    const publicId = await issueCard(100000);

    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      paymentRequirement: "deposit",
      depositAmountCents: 2500,
    });

    expect(booking).toMatchObject({
      paymentRequirement: "deposit",
      depositRequiredCents: 2500,
      amountDueCents: 2500,
      balanceDueCents: 7500,
      paymentStatus: "unpaid",
    });

    const paid = await service().payWithCredits({
      bookingId: booking.id,
      creditCardPublicId: publicId,
    });

    expect(paid).toMatchObject({
      status: "confirmed",
      paymentStatus: "deposit_paid",
      paymentMethod: "credits",
      amountPaidCents: 2500,
      balanceDueCents: 7500,
    });

    const balance = await new CreditService(env()).getBalance(publicId);
    expect(balance.balanceCents).toBe(97500);
  });

  it("cancels a confirmed booking, restoring capacity and voucher count", async () => {
    const serviceId = await seedService({ priceCents: 15000 });
    const couponId = await seedPlatformCoupon("SVC10", 10);
    await seedSlot(serviceId, "2026-06-05", "14:00", 2);
    const publicId = await issueCard(100000);

    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      voucherCode: "SVC10",
    });
    await service().payWithCredits({
      bookingId: booking.id,
      creditCardPublicId: publicId,
    });
    expect(await slotBookings(serviceId)).toBe(1);
    expect(await usedCount(couponId)).toBe(1);

    const cancelled = await service().cancelBooking(booking.id);
    expect(cancelled.status).toBe("cancelled");
    expect(await slotBookings(serviceId)).toBe(0);
    expect(await usedCount(couponId)).toBe(0);
  });

  it("only releases capacity and voucher usage once when the same booking is cancelled concurrently", async () => {
    vi.spyOn(
      ServiceBookingNotificationService.prototype,
      "send",
    ).mockResolvedValue();
    const serviceId = await seedService({ priceCents: 15000 });
    const couponId = await seedPlatformCoupon("SVC20", 20);
    await seedSlot(serviceId, "2026-06-05", "14:00", 2);
    const firstPublicId = await issueCard(100000);
    const secondPublicId = await issueCard(100000);

    const firstBooking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "First Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      voucherCode: "SVC20",
    });
    const secondBooking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Second Guest",
      customerPhone: "0911222444",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      voucherCode: "SVC20",
    });
    await service().payWithCredits({
      bookingId: firstBooking.id,
      creditCardPublicId: firstPublicId,
    });
    await service().payWithCredits({
      bookingId: secondBooking.id,
      creditCardPublicId: secondPublicId,
    });
    expect(await slotBookings(serviceId)).toBe(2);
    expect(await usedCount(couponId)).toBe(2);

    const results = await Promise.allSettled([
      service().cancelBooking(firstBooking.id),
      service().cancelBooking(firstBooking.id),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await service().getById(firstBooking.id)).toMatchObject({
      status: "cancelled",
    });
    expect(await service().getById(secondBooking.id)).toMatchObject({
      status: "confirmed",
    });
    expect(await slotBookings(serviceId)).toBe(1);
    expect(await usedCount(couponId)).toBe(1);
    expect(
      ServiceBookingNotificationService.prototype.send,
    ).toHaveBeenCalledWith(expect.objectContaining({ type: "cancelled" }));
  });

  it("completes a confirmed booking", async () => {
    const serviceId = await seedService({ priceCents: 0 });
    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
    });
    // price 0 -> nothing to charge; confirm as cash (pay at venue path).
    await service().confirmCash(booking.id);
    const done = await service().transition(booking.id, "completed");
    expect(done.status).toBe("completed");
  });
});

describe("ServiceBookingService — production booking extensions", () => {
  it("adds a waitlist entry without consuming full slot capacity", async () => {
    const serviceId = await seedService({});
    await seedSlot(serviceId, "2026-06-05", "14:00", 1);
    await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "First",
      customerPhone: "0911000001",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
    });

    const waitlistEntry = await service().joinWaitlist({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Second",
      customerPhone: "0911000002",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      partySize: 2,
      notes: "Can arrive early",
    });

    expect(waitlistEntry).toMatchObject({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      status: "waiting",
      customerName: "Second",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      partySize: 2,
      notes: "Can arrive early",
    });
    expect(await slotBookings(serviceId)).toBe(1);
  });

  it("rate-limits public waitlist joins by client IP", async () => {
    const serviceId = await seedService({});
    const requestBody = {
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Waitlist Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
    };

    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(
        await serviceBookingRoutes.fetch(
          new Request("https://test/waitlist", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "cf-connecting-ip": "203.0.113.10",
            },
            body: JSON.stringify({
              ...requestBody,
              customerPhone: `09112223${String(index).padStart(2, "0")}`,
            }),
          }),
          env(),
        ),
      );
    }

    expect(responses.slice(0, 5).map((response) => response.status)).toEqual([
      201, 201, 201, 201, 201,
    ]);
    expect(responses[5].status).toBe(429);
  });

  it("creates weekly recurring bookings with shared recurrence metadata", async () => {
    const serviceId = await seedService({});
    const bookings = await service().createRecurringBookings({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      startDate: "2026-06-05",
      bookingTime: "14:00",
      count: 3,
      intervalWeeks: 1,
    });

    expect(bookings.map((booking) => booking.bookingDate)).toEqual([
      "2026-06-05",
      "2026-06-12",
      "2026-06-19",
    ]);
    expect(
      new Set(bookings.map((booking) => booking.recurrenceGroupId)).size,
    ).toBe(1);
    expect(bookings.map((booking) => booking.recurrenceIndex)).toEqual([
      1, 2, 3,
    ]);
    expect(bookings.every((booking) => booking.recurrenceCount === 3)).toBe(
      true,
    );
  });

  it("rolls back previously created recurring bookings and slot claims when a later occurrence fails", async () => {
    const serviceId = await seedService({});
    await seedSlot(serviceId, "2026-06-05", "14:00", 1);
    await seedSlot(serviceId, "2026-06-12", "14:00", 1);
    await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Existing Guest",
      customerPhone: "0911000999",
      bookingDate: "2026-06-12",
      bookingTime: "14:00",
    });

    await expect(
      service().createRecurringBookings({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Recurring Guest",
        customerPhone: "0911222333",
        startDate: "2026-06-05",
        bookingTime: "14:00",
        count: 2,
        intervalWeeks: 1,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_SLOT_FULL" });

    expect(await bookingCount()).toBe(1);

    const slots = await testDb.drizzle
      .select({
        date: serviceBookingSlots.date,
        currentBookings: serviceBookingSlots.currentBookings,
      })
      .from(serviceBookingSlots)
      .where(eq(serviceBookingSlots.serviceItemId, serviceId))
      .all();
    expect(slots).toEqual(
      expect.arrayContaining([
        { date: "2026-06-05", currentBookings: 0 },
        { date: "2026-06-12", currentBookings: 1 },
      ]),
    );
  });

  it("rejects vouchers on recurring bookings by policy", async () => {
    const serviceId = await seedService({ priceCents: 15000 });
    await seedPlatformCoupon("SVC10", 10);

    await expect(
      service().createRecurringBookings({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Recurring Guest",
        customerPhone: "0911222333",
        startDate: "2026-06-05",
        bookingTime: "14:00",
        count: 2,
        intervalWeeks: 1,
        voucherCode: "SVC10",
      }),
    ).rejects.toMatchObject({ code: "RECURRENCE_VOUCHER_UNSUPPORTED" });

    expect(await bookingCount()).toBe(0);
  });

  it("caps recurring booking batches below the old public 52-booking maximum", async () => {
    const serviceId = await seedService({});

    await expect(
      service().createRecurringBookings({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Recurring Guest",
        customerPhone: "0911222333",
        startDate: "2026-06-05",
        bookingTime: "14:00",
        count: 13,
        intervalWeeks: 1,
      }),
    ).rejects.toMatchObject({ code: "RECURRENCE_COUNT_INVALID" });
  });

  it("lists due reminders and marks them sent", async () => {
    const serviceId = await seedService({ priceCents: 0 });
    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      reminderOptIn: true,
      reminderMinutesBefore: 60,
    });
    await service().confirmCash(booking.id);

    const due = await service().listDueReminders({
      before: new Date("2026-06-05T05:00:00Z"),
      restaurantId: RESTAURANT_ID,
    });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      id: booking.id,
      reminderOptIn: 1,
      reminderMinutesBefore: 60,
    });

    const sent = await service().markReminderSent(booking.id);
    expect(sent.reminderSentAt).toBeInstanceOf(Date);
    await expect(
      service().listDueReminders({
        before: new Date("2026-06-05T05:00:00Z"),
        restaurantId: RESTAURANT_ID,
      }),
    ).resolves.toEqual([]);
  });

  it("generates a standards-compatible ICS calendar invite", async () => {
    const serviceId = await seedService({ priceCents: 0, durationMinutes: 90 });
    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      specialRequests: "Window seat",
    });

    const ics = await service().generateCalendarInvite(booking.id);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain(`UID:${booking.calendarUid}`);
    expect(ics).toContain("SUMMARY:Lantern Painting");
    expect(ics).toContain("DTSTART:20260605T060000Z");
    expect(ics).toContain("DTEND:20260605T073000Z");
    expect(ics).toContain(`Confirmation: ${booking.confirmationCode}`);
    expect(ics).toContain("END:VCALENDAR");
  });
});

describe("ServiceBookingService — confirmation contact proof", () => {
  it("requires phone/email proof for confirmation-code lookup", async () => {
    const serviceId = await seedService({ priceCents: 0 });
    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      customerEmail: "Guest@Example.test",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
    });

    await expect(
      service().getByConfirmationCode(booking.confirmationCode),
    ).rejects.toMatchObject({ code: "SERVICE_BOOKING_CONTACT_REQUIRED" });

    await expect(
      service().getByConfirmationCode(booking.confirmationCode, {
        requireContact: false,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_BOOKING_CONTACT_REQUIRED" });

    await expect(
      service().getByConfirmationCode(booking.confirmationCode, {
        requireContact: true,
        customerPhone: "0900000000",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_BOOKING_CONTACT_MISMATCH" });

    await expect(
      service().getByConfirmationCode(booking.confirmationCode, {
        requireContact: true,
        customerPhone: "0911-222-333",
      }),
    ).resolves.toMatchObject({ id: booking.id });

    await expect(
      service().getByConfirmationCode(booking.confirmationCode, {
        requireContact: true,
        customerEmail: "guest@example.test",
      }),
    ).resolves.toMatchObject({ id: booking.id });
  });

  it("does not cancel when the supplied second factor is wrong", async () => {
    const serviceId = await seedService({ priceCents: 0 });
    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      customerEmail: "guest@example.test",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
    });

    await expect(
      service().cancelByConfirmationCode(booking.confirmationCode, {
        requireContact: true,
        customerEmail: "other@example.test",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_BOOKING_CONTACT_MISMATCH" });

    await expect(service().getById(booking.id)).resolves.toMatchObject({
      status: "pending",
    });

    await expect(
      service().cancelByConfirmationCode(booking.confirmationCode, {
        requireContact: true,
        customerEmail: "GUEST@example.test",
      }),
    ).resolves.toMatchObject({ status: "cancelled" });
  });
});

describe("ServiceBookingService — employee assignment availability", () => {
  it("stores an assigned employee when the employee is available for the service duration", async () => {
    const serviceId = await seedService({ durationMinutes: 60 });
    const employeeId = await seedEmployee();
    await seedEmployeeAvailability({
      employeeId,
      dayOfWeek: 5, // 2026-06-05 is Friday
      startTime: "13:00",
      endTime: "15:00",
      preferenceType: "preferred",
    });

    const booking = await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      employeeId,
    });

    expect(booking.employeeId).toBe(employeeId);
  });

  it("rejects an assigned employee whose existing booking overlaps the requested time", async () => {
    const serviceId = await seedService({ durationMinutes: 60 });
    const employeeId = await seedEmployee();
    await seedEmployeeAvailability({
      employeeId,
      dayOfWeek: 5,
      startTime: "09:00",
      endTime: "17:00",
      preferenceType: "available",
    });

    await service().createBooking({
      restaurantId: RESTAURANT_ID,
      serviceItemId: serviceId,
      customerName: "Guest",
      customerPhone: "0911222333",
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      employeeId,
    });

    await expect(
      service().createBooking({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Other Guest",
        customerPhone: "0944555666",
        bookingDate: "2026-06-05",
        bookingTime: "14:30",
        employeeId,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_EMPLOYEE_UNAVAILABLE" });
  });

  it("rejects direct overlapping active employee bookings at the database layer", async () => {
    const serviceId = await seedService({ durationMinutes: 60 });
    const employeeId = await seedEmployee();

    await insertAssignedServiceBooking({
      serviceItemId: serviceId,
      employeeId,
      bookingDate: "2026-06-05",
      bookingTime: "14:00",
      durationMinutes: 60,
      status: SERVICE_BOOKING_STATUS.PENDING,
    });

    let overlapError: unknown;
    try {
      await insertAssignedServiceBooking({
        serviceItemId: serviceId,
        employeeId,
        bookingDate: "2026-06-05",
        bookingTime: "14:30",
        durationMinutes: 60,
        status: SERVICE_BOOKING_STATUS.CONFIRMED,
      });
    } catch (error) {
      overlapError = error;
    }
    expect(errorChainText(overlapError)).toMatch(
      /overlapping active employee service booking/,
    );

    await expect(
      insertAssignedServiceBooking({
        serviceItemId: serviceId,
        employeeId,
        bookingDate: "2026-06-05",
        bookingTime: "15:00",
        durationMinutes: 60,
        status: SERVICE_BOOKING_STATUS.PENDING,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects an assigned employee with no matching availability", async () => {
    const serviceId = await seedService({ durationMinutes: 60 });
    const employeeId = await seedEmployee();

    await expect(
      service().createBooking({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Guest",
        customerPhone: "0911222333",
        bookingDate: "2026-06-05",
        bookingTime: "14:00",
        employeeId,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_EMPLOYEE_UNAVAILABLE" });
  });

  it("lets a specific-date unavailable override block recurring availability", async () => {
    const serviceId = await seedService({ durationMinutes: 60 });
    const employeeId = await seedEmployee();
    await seedEmployeeAvailability({
      employeeId,
      dayOfWeek: 5,
      startTime: "09:00",
      endTime: "17:00",
      preferenceType: "available",
      priority: 0,
    });
    await seedEmployeeAvailability({
      employeeId,
      availabilityType: "specific_date",
      dayOfWeek: null,
      startTime: null,
      endTime: null,
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      preferenceType: "unavailable",
      priority: 10,
    });

    await expect(
      service().createBooking({
        restaurantId: RESTAURANT_ID,
        serviceItemId: serviceId,
        customerName: "Guest",
        customerPhone: "0911222333",
        bookingDate: "2026-06-05",
        bookingTime: "14:00",
        employeeId,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_EMPLOYEE_UNAVAILABLE" });
  });
});

function errorChainText(error: unknown): string {
  const messages: string[] = [];
  let current = error as { message?: unknown; cause?: unknown } | undefined;
  while (current) {
    messages.push(String(current.message ?? current));
    current = current.cause as
      | { message?: unknown; cause?: unknown }
      | undefined;
  }
  return messages.join("\n");
}
