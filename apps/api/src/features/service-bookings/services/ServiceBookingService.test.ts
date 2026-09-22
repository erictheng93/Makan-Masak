import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CouponService,
  employeeAvailability,
  restaurantServiceItems,
  serviceBookings,
  serviceBookingSlots,
  serviceBookingWaitlist,
  systemAlerts,
  SERVICE_BOOKING_PAYMENT_METHOD,
  SERVICE_BOOKING_PAYMENT_REQUIREMENT,
  SERVICE_BOOKING_PAYMENT_STATUS,
  SERVICE_BOOKING_STATUS,
  SERVICE_BOOKING_WAITLIST_STATUS,
  users,
} from "@makanmasak/database";
import {
  createMutationFixtureDb,
  createSelectFixtureDb,
  type MutationFixtures,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { CreditService } from "../../credits/services/CreditService";
import { ServiceBookingService } from "./ServiceBookingService";

// Reads `restaurants.settings` through drizzle on the raw D1 binding, which the
// D1 mock here does not model; its own suite runs it against real D1.
const resolveRestaurantCurrency = vi.hoisted(() => vi.fn());
vi.mock("../../../shared/utils/restaurant-currency", () => ({
  resolveRestaurantCurrency,
}));
import type { CreateServiceBookingSlotInput } from "./ServiceBookingService";

type ServiceBookingRow = typeof serviceBookings.$inferSelect;
type ServiceBookingSlotRow = typeof serviceBookingSlots.$inferSelect;

/**
 * Select fixtures are keyed by table, not by call order: `from(table)`
 * decides which queue a query draws from, so adding a query against one
 * table can no longer shift another table's results out from under it.
 *
 * Two things still need care when the code under test grows a new query:
 *
 * - Within a single table the queue is positional. The Nth read of a table
 *   takes that table's Nth fixture, so a new query means inserting a fixture
 *   at the matching index rather than appending one at the end.
 * - A table has to be listed in `fixtureTables` before it can be declared. An
 *   unregistered table matches no queue, so every read of it throws.
 *
 * Missing and exhausted fixtures both throw and name the table. Nothing
 * falls back to `[]`/`undefined`; a silent empty/undefined result is what
 * made the previous positional queues (`selectGet`/`selectAll`) so hard to
 * trace back to their cause.
 *
 * `ServiceBookingService` terminates its selects with `.get()` (single row,
 * or `undefined` when the fixture entry is `[]`) or `.all()` (the whole
 * array) instead of awaiting the builder directly. Both consume the next
 * fixture queued for the table passed to `from()` — `.get()` just takes
 * index 0 of it.
 *
 * `restaurantServiceItems`, `users`, `employeeAvailability`,
 * `serviceBookingSlots`, and `serviceBookings` are all read via `db.select`
 * somewhere in this service (`createBooking`, `joinWaitlist`,
 * `getAvailability`, `listSlots`, `listByRestaurant`, `listDueReminders`,
 * `requireBooking`, `requireSlot`, `assertServiceBelongsToRestaurant`,
 * `assertEmployeeAvailable`, `assertEmployeeHasNoOverlappingBooking`,
 * `reserveSlotCapacity`), so all five are registered below.
 * `assertServiceBelongsToRestaurant` and `assertEmployeeAvailable` select a
 * narrowed column list rather than `select()`, but that does not change
 * routing — only the `from()` argument does. `serviceBookingWaitlist` is
 * registered too: this service only ever `insert`s into it, and write
 * fixtures are declared against the same table registry. `systemAlerts`
 * belongs to no part of this service and is imported only so the regression
 * test below has a real, unregistered table to demonstrate the
 * "<unknown table>" case.
 *
 * Writes follow the same rules with the operation added to the key, because
 * `serviceBookings` is inserted, updated, and deleted here. Writes awaited
 * without `.returning()` — the recurring-booking rollback's `delete` is one —
 * consume a fixture just the same; declare those as `{ changes: n }`.
 *
 * `createBooking`'s slot-capacity reservation and insert run inside a
 * try/catch, but the catch only best-effort releases reserved capacity and
 * always re-throws the original error (`throw error;`) — it never swallows
 * or replaces it. A harness throw from a missing/exhausted select fixture
 * therefore still surfaces with its original message as a rejected promise;
 * no swallowing caveat applies anywhere in this file.
 */
const fixtureTables = {
  restaurantServiceItems,
  users,
  employeeAvailability,
  serviceBookingSlots,
  serviceBookings,
  serviceBookingWaitlist,
};
type FixtureName = keyof typeof fixtureTables;

/**
 * The chainable query object `createSelectFixtureDb().select()` returns.
 *
 * `SelectFixtureDb` declares its two factories as `ReturnType<typeof vi.fn>`,
 * which resolves to `Mock<Procedure | Constructable>`. That union's
 * `Constructable` half carries only a construct signature, so TypeScript
 * refuses to call the factory at all ("Did you mean to include 'new'?"). The
 * harness only ever installs the plain query factory described here, so the
 * shape is restated once at the seam below instead of at every call site.
 */
interface SelectFixtureQuery {
  from: (table: unknown) => SelectFixtureQuery;
  innerJoin: (...args: unknown[]) => SelectFixtureQuery;
  leftJoin: (...args: unknown[]) => SelectFixtureQuery;
  where: (...args: unknown[]) => SelectFixtureQuery;
  orderBy: (...args: unknown[]) => SelectFixtureQuery;
  groupBy: (...args: unknown[]) => SelectFixtureQuery;
  having: (...args: unknown[]) => SelectFixtureQuery;
  limit: (...args: unknown[]) => SelectFixtureQuery;
  offset: (...args: unknown[]) => SelectFixtureQuery;
  get: () => Promise<unknown>;
  all: () => Promise<unknown[]>;
  then: (
    resolve: (value: unknown) => void,
    reject?: (reason: unknown) => void,
  ) => Promise<void>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * vi.spyOn cannot name a private method, but an indexed-access type can — so
 * the target is viewed through an object carrying each method's real signature.
 */
type ServiceBookingPrivates = {
  requireBooking: ServiceBookingService["requireBooking"];
  loadPayableBooking: ServiceBookingService["loadPayableBooking"];
  markConfirmed: ServiceBookingService["markConfirmed"];
};

function spyOnPrivate<K extends keyof ServiceBookingPrivates>(
  service: ServiceBookingService,
  key: K,
) {
  return vi.spyOn(service as unknown as ServiceBookingPrivates, key);
}

/**
 * The stored row for a slot the caller just asked for. `isAvailable` is the one
 * field that changes shape on the way in: the input takes a boolean, the column
 * stores an integer.
 */
function buildSlotRow(
  input: CreateServiceBookingSlotInput,
): ServiceBookingSlotRow {
  return {
    id: "slot-1",
    restaurantId: input.restaurantId,
    serviceItemId: input.serviceItemId,
    date: input.date,
    timeSlot: input.timeSlot,
    maxCapacity: input.maxCapacity,
    currentBookings: 0,
    isAvailable: input.isAvailable === false ? 0 : 1,
    blockReason: input.blockReason ?? null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** A stored booking row; each test overrides only what it asserts on. */
function buildBookingRow(
  overrides: Partial<ServiceBookingRow> = {},
): ServiceBookingRow {
  return {
    id: "booking-1",
    ...overrides,
  } as ServiceBookingRow;
}

describe("ServiceBookingService.blockSlot", () => {
  it("does not overwrite existing slot capacity when a stale read races with slot creation", async () => {
    let upsertRan = false;
    const storedSlot = {
      id: "slot-1",
      restaurantId: "rest-1",
      serviceItemId: 10,
      date: "2026-06-10",
      timeSlot: "10:00",
      maxCapacity: 2,
      currentBookings: 0,
      isAvailable: 1,
      blockReason: null as string | null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const fakeD1 = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...params: unknown[]) => ({
          run: vi.fn(async () => {
            upsertRan = true;
            storedSlot.isAvailable = 0;
            storedSlot.blockReason = String(params.at(-1));
            if (sql.includes("max_capacity = excluded.max_capacity")) {
              storedSlot.maxCapacity = Number(params[5]);
            }
            return { meta: { changes: 1 } };
          }),
        })),
      })),
    };
    const fakeDb = {
      select: vi.fn((selection?: unknown) => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(async () => {
              if (selection) {
                return { id: 10, restaurantId: "rest-1" };
              }
              return upsertRan ? storedSlot : undefined;
            }),
          })),
        })),
      })),
    };
    const service = new ServiceBookingService({ DB: fakeD1 } as never);
    Object.defineProperty(service, "db", { value: fakeDb });
    Object.defineProperty(service, "d1", { value: fakeD1 });

    const slot = await service.blockSlot({
      restaurantId: "rest-1",
      serviceItemId: 10,
      date: "2026-06-10",
      timeSlot: "10:00",
      blockReason: "Private event",
    });

    expect(slot).toMatchObject({
      maxCapacity: 2,
      isAvailable: 0,
      blockReason: "Private event",
    });
  });
});

describe("ServiceBookingService orchestration helpers", () => {
  function createD1Mock(results: Array<{ changes?: number }> = []) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const d1 = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...params: unknown[]) => {
          const statement = {
            run: vi.fn(async () => {
              calls.push({ sql, params });
              const result = results.shift() ?? { changes: 1 };
              return { meta: { changes: result.changes ?? 1 } };
            }),
          };
          return statement;
        }),
      })),
      batch: vi.fn(async (statements: Array<{ run: () => Promise<unknown> }>) =>
        Promise.all(statements.map((statement) => statement.run())),
      ),
    };
    return { d1, calls };
  }

  /**
   * Reads are keyed by table; writes by table *and* operation, because
   * `serviceBookings` is inserted, updated, and deleted by this service and a
   * single queue per table would let those three consume each other's
   * fixtures. A write that is awaited without `.returning()` still takes a
   * fixture — declare it as `{ changes: n }`.
   */
  function createDbMock(input: {
    selectFixtures?: SelectFixtures<FixtureName>;
    mutationFixtures?: MutationFixtures<FixtureName>;
  }) {
    const fixtureDb = createSelectFixtureDb(
      fixtureTables,
      input.selectFixtures,
    );
    const mutationDb = createMutationFixtureDb(
      fixtureTables,
      input.mutationFixtures,
    );
    // The harness types its factories as bare `Mock`, so the chain shape is
    // restated here, once, to keep the call sites below typed.
    const select: () => SelectFixtureQuery = fixtureDb.select;

    const db = {
      select,
      insert: mutationDb.insert,
      update: mutationDb.update,
      delete: mutationDb.delete,
    };

    return {
      db,
      insertValues: mutationDb.inserted,
      updateSets: mutationDb.updated,
    };
  }

  function createService(options?: { d1?: D1Database; db?: unknown }) {
    const service = new ServiceBookingService({
      DB: options?.d1 ?? ({} as D1Database),
    } as never);
    if (options?.db) {
      Object.defineProperty(service, "db", { value: options.db });
    }
    if (options?.d1) {
      Object.defineProperty(service, "d1", { value: options.d1 });
    }
    return service;
  }

  it("routes select fixtures by table and reports missing fixtures", async () => {
    const slotRow = { id: "slot-1" };
    const bookingRow = { id: "booking-1" };
    const { db } = createDbMock({
      selectFixtures: {
        serviceBookingSlots: [[slotRow]],
        serviceBookings: [[bookingRow], [bookingRow]],
      },
    });

    // Read in reverse declaration order: routing follows the table passed to
    // from(), not the execution order.
    await expect(db.select().from(serviceBookings).all()).resolves.toEqual([
      bookingRow,
    ]);
    await expect(db.select().from(serviceBookingSlots).get()).resolves.toEqual(
      slotRow,
    );
    await expect(db.select().from(serviceBookings).get()).resolves.toEqual(
      bookingRow,
    );
    await expect(db.select().from(serviceBookingSlots).all()).rejects.toThrow(
      "No select fixtures remaining for serviceBookingSlots",
    );
    // serviceBookingWaitlist is registered because the service inserts into
    // it, but it is never selected — a registered table with nothing declared
    // for this call reports its own name.
    await expect(
      db.select().from(serviceBookingWaitlist).get(),
    ).rejects.toThrow("Missing select fixture for serviceBookingWaitlist");
    // systemAlerts is unrelated to this service and is never registered, so it
    // reports the generic name instead — distinct from the case above.
    await expect(db.select().from(systemAlerts).get()).rejects.toThrow(
      "Missing select fixture for <unknown table>",
    );
  });

  it("creates recurring bookings with weekly dates and recurrence metadata", async () => {
    const service = createService();
    const createBooking = vi
      .spyOn(service, "createBooking")
      .mockImplementation(async (input) =>
        buildBookingRow({ id: input.bookingDate }),
      );

    await expect(
      service.createRecurringBookings({
        restaurantId: "rest-1",
        serviceItemId: 10,
        customerName: "Ada",
        customerPhone: "+886900000000",
        startDate: "2026-06-10",
        bookingTime: "10:00",
        count: 3,
        intervalWeeks: 2,
      }),
    ).resolves.toEqual([
      { id: "2026-06-10" },
      { id: "2026-06-24" },
      { id: "2026-07-08" },
    ]);
    expect(createBooking).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        bookingDate: "2026-06-10",
        recurrenceGroupId: expect.any(String),
        recurrenceIndex: 1,
        recurrenceCount: 3,
      }),
    );
    expect(createBooking).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        bookingDate: "2026-07-08",
        recurrenceGroupId: expect.any(String),
        recurrenceIndex: 3,
        recurrenceCount: 3,
      }),
    );
  });

  it("rejects unsupported recurring voucher and range inputs", async () => {
    const service = createService();
    const base = {
      restaurantId: "rest-1",
      serviceItemId: 10,
      customerName: "Ada",
      customerPhone: "+886900000000",
      startDate: "2026-06-10",
      bookingTime: "10:00",
      count: 1,
    };

    await expect(
      service.createRecurringBookings({ ...base, voucherCode: "SAVE" }),
    ).rejects.toThrow("Vouchers can only be applied to single bookings");
    await expect(
      service.createRecurringBookings({ ...base, count: 13 }),
    ).rejects.toThrow("count must be between 1 and 12");
    await expect(
      service.createRecurringBookings({ ...base, intervalWeeks: 0 }),
    ).rejects.toThrow("intervalWeeks must be between 1 and 52");
    await expect(
      service.createRecurringBookings({ ...base, startDate: "not-a-date" }),
    ).rejects.toThrow("Invalid recurrence start date");
  });

  it("batch creates slots for each date/time and enforces the batch limit", async () => {
    const service = createService();
    const createSlot = vi
      .spyOn(service, "createSlot")
      .mockImplementation(async (input) => buildSlotRow(input));

    await expect(
      service.batchCreateSlots({
        restaurantId: "rest-1",
        serviceItemId: 10,
        startDate: "2026-06-10",
        endDate: "2026-06-11",
        timeSlots: ["10:00", "11:00"],
        maxCapacity: 2,
        isAvailable: false,
      }),
    ).resolves.toEqual({
      created: 4,
      slots: [
        expect.objectContaining({ date: "2026-06-10", timeSlot: "10:00" }),
        expect.objectContaining({ date: "2026-06-10", timeSlot: "11:00" }),
        expect.objectContaining({ date: "2026-06-11", timeSlot: "10:00" }),
        expect.objectContaining({ date: "2026-06-11", timeSlot: "11:00" }),
      ],
    });
    expect(createSlot).toHaveBeenCalledTimes(4);

    await expect(
      service.batchCreateSlots({
        restaurantId: "rest-1",
        serviceItemId: 10,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        timeSlots: ["09:00", "10:00", "11:00"],
        maxCapacity: 1,
      }),
    ).rejects.toThrow("Cannot create more than 1000 slots at once");
    await expect(
      service.batchCreateSlots({
        restaurantId: "rest-1",
        serviceItemId: 10,
        startDate: "bad-date",
        endDate: "2026-06-10",
        timeSlots: ["09:00"],
        maxCapacity: 1,
      }),
    ).rejects.toThrow("Invalid date range");
    await expect(
      service.batchCreateSlots({
        restaurantId: "rest-1",
        serviceItemId: 10,
        startDate: "2026-06-11",
        endDate: "2026-06-10",
        timeSlots: ["09:00"],
        maxCapacity: 1,
      }),
    ).rejects.toThrow("startDate must be before endDate");
  });

  it("maps slot availability from capped booking slots", async () => {
    const { db } = createDbMock({
      selectFixtures: {
        serviceBookingSlots: [
          [
            {
              timeSlot: "10:00",
              maxCapacity: 3,
              currentBookings: 1,
              isAvailable: 1,
            },
            {
              timeSlot: "11:00",
              maxCapacity: 2,
              currentBookings: 2,
              isAvailable: 1,
            },
            {
              timeSlot: "12:00",
              maxCapacity: 2,
              currentBookings: 0,
              isAvailable: 0,
            },
          ],
        ],
      },
    });
    const service = createService({ db });

    await expect(
      service.getAvailability({
        serviceItemId: 10,
        date: "2026-06-10",
      }),
    ).resolves.toEqual([
      { timeSlot: "10:00", remaining: 2, isAvailable: true },
      { timeSlot: "11:00", remaining: 0, isAvailable: false },
      { timeSlot: "12:00", remaining: 2, isAvailable: false },
    ]);
  });

  it("creates bookings with deposit terms and reminder scheduling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const { d1, calls } = createD1Mock([{ changes: 0 }]);
    const insertedRow = { id: "booking-1" };
    const { db, insertValues } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [
          [
            {
              id: 10,
              restaurantId: "rest-1",
              name: "Spa Session",
              durationMinutes: 90,
              priceCents: 5000,
              availableHours: { start: "09:00", end: "18:00", days: [3] },
              requiresBooking: true,
              isActive: true,
              deletedAt: null,
            },
          ],
        ],
        serviceBookingSlots: [[]],
      },
      mutationFixtures: {
        serviceBookings: { insert: [[insertedRow]] },
      },
    });
    const service = createService({ d1: d1 as never, db });

    await expect(
      service.createBooking({
        restaurantId: "rest-1",
        serviceItemId: 10,
        customerName: "Ada",
        customerPhone: "+886 900 000 000",
        customerEmail: "ada@example.test",
        bookingDate: "2026-06-10",
        bookingTime: "10:30",
        partySize: 2,
        paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.DEPOSIT,
        depositAmountCents: 1200,
        reminderOptIn: true,
        reminderMinutesBefore: 30,
        specialRequests: "Window seat",
      }),
    ).resolves.toBe(insertedRow);

    expect(calls[0]).toMatchObject({
      params: [10, "2026-06-10", "10:30"],
    });
    expect(insertValues[0]).toMatchObject({
      restaurantId: "rest-1",
      serviceItemId: 10,
      serviceNameSnapshot: "Spa Session",
      priceCentsSnapshot: 5000,
      customerName: "Ada",
      customerEmail: "ada@example.test",
      bookingDate: "2026-06-10",
      bookingTime: "10:30",
      partySize: 2,
      status: SERVICE_BOOKING_STATUS.PENDING,
      voucherDiscountCents: 0,
      paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.DEPOSIT,
      depositRequiredCents: 1200,
      balanceDueCents: 3800,
      amountDueCents: 1200,
      paymentStatus: SERVICE_BOOKING_PAYMENT_STATUS.UNPAID,
      paymentMethod: SERVICE_BOOKING_PAYMENT_METHOD.NONE,
      reminderOptIn: 1,
      reminderMinutesBefore: 30,
      specialRequests: "Window seat",
    });
    expect(
      (insertValues[0] as { reminderScheduledAt: Date }).reminderScheduledAt,
    ).toEqual(new Date("2026-06-10T02:00:00.000Z"));
  });

  it("creates pay-at-venue voucher bookings with default reminders", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    vi.spyOn(CouponService.prototype, "validateCoupon").mockResolvedValue({
      valid: true,
      coupon: { id: 99 },
      discountAmount: 12,
    } as never);
    const { d1 } = createD1Mock([{ changes: 0 }]);
    const { db, insertValues } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [
          [
            {
              id: 10,
              restaurantId: "rest-1",
              name: "Spa Session",
              durationMinutes: null,
              priceCents: 5000,
              availableHours: null,
              requiresBooking: true,
              isActive: true,
              deletedAt: null,
            },
          ],
        ],
        serviceBookingSlots: [[]],
      },
      mutationFixtures: {
        serviceBookings: { insert: [[{ id: "booking-1" }]] },
      },
    });
    const service = createService({ d1: d1 as never, db });

    await service.createBooking({
      restaurantId: "rest-1",
      serviceItemId: 10,
      customerId: "customer-1",
      customerName: "Ada",
      customerPhone: "+886900000000",
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
      voucherCode: "SAVE12",
      reminderOptIn: true,
      recurrenceGroupId: "series-1",
      recurrenceIndex: 1,
      recurrenceCount: 2,
    });

    expect(CouponService.prototype.validateCoupon).toHaveBeenCalledWith(
      "SAVE12",
      "rest-1",
      50,
    );
    expect(insertValues[0]).toMatchObject({
      customerId: "customer-1",
      durationMinutesSnapshot: null,
      couponId: 99,
      voucherDiscountCents: 1200,
      amountDueCents: 3800,
      paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.PAY_AT_VENUE,
      reminderOptIn: 1,
      reminderMinutesBefore: 60,
      recurrenceGroupId: "series-1",
      recurrenceIndex: 1,
      recurrenceCount: 2,
    });
    expect(
      (insertValues[0] as { reminderScheduledAt: Date }).reminderScheduledAt,
    ).toEqual(new Date("2026-06-10T01:00:00.000Z"));
  });

  it("rejects invalid and zero-value service booking vouchers", async () => {
    const baseService = {
      id: 10,
      restaurantId: "rest-1",
      name: "Spa Session",
      durationMinutes: 60,
      priceCents: 1000,
      availableHours: null,
      requiresBooking: true,
      isActive: true,
      deletedAt: null,
    };
    const book = {
      restaurantId: "rest-1",
      serviceItemId: 10,
      customerName: "Ada",
      customerPhone: "+886900000000",
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
      voucherCode: "BAD",
    };

    vi.spyOn(CouponService.prototype, "validateCoupon").mockResolvedValueOnce({
      valid: false,
      coupon: null,
      error: "Voucher expired",
    } as never);
    await expect(
      createService({
        d1: createD1Mock([{ changes: 0 }]).d1 as never,
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[baseService]],
            serviceBookingSlots: [[]],
          },
        }).db,
      }).createBooking(book),
    ).rejects.toThrow("Voucher expired");

    vi.spyOn(CouponService.prototype, "validateCoupon").mockResolvedValueOnce({
      valid: true,
      coupon: { id: 99 },
      discountAmount: 0,
    } as never);
    await expect(
      createService({
        d1: createD1Mock([{ changes: 0 }]).d1 as never,
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[baseService]],
            serviceBookingSlots: [[]],
          },
        }).db,
      }).createBooking(book),
    ).rejects.toThrow("This voucher does not apply to this service");
  });

  it("rejects booking times outside configured service hours", async () => {
    const { db } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [
          [
            {
              id: 10,
              restaurantId: "rest-1",
              name: "Spa Session",
              durationMinutes: 60,
              priceCents: 1000,
              availableHours: { start: "09:00", end: "18:00", days: [3] },
              requiresBooking: true,
              isActive: true,
              deletedAt: null,
            },
          ],
        ],
      },
    });
    const service = createService({ db });

    await expect(
      service.createBooking({
        restaurantId: "rest-1",
        serviceItemId: 10,
        customerName: "Ada",
        customerPhone: "+886900000000",
        bookingDate: "2026-06-11",
        bookingTime: "10:00",
      }),
    ).rejects.toThrow("The service is not available on this day");
  });

  it("rejects invalid services and unsupported booking terms", async () => {
    const book = {
      restaurantId: "rest-1",
      serviceItemId: 10,
      customerName: "Ada",
      customerPhone: "+886900000000",
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
    };
    const baseService = {
      id: 10,
      restaurantId: "rest-1",
      name: "Spa Session",
      durationMinutes: 60,
      priceCents: 1000,
      availableHours: { start: "09:00", end: "18:00", days: [3] },
      requiresBooking: true,
      isActive: true,
      deletedAt: null,
    };

    await expect(
      createService({
        db: createDbMock({
          selectFixtures: { restaurantServiceItems: [[]] },
        }).db,
      }).createBooking(book),
    ).rejects.toThrow("Service not found");
    await expect(
      createService({
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [
              [{ ...baseService, restaurantId: "rest-2" }],
            ],
          },
        }).db,
      }).createBooking(book),
    ).rejects.toThrow("Service does not belong to this restaurant");
    await expect(
      createService({
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [
              [{ ...baseService, requiresBooking: false }],
            ],
          },
        }).db,
      }).createBooking(book),
    ).rejects.toThrow("This service does not accept bookings");
    await expect(
      createService({
        db: createDbMock({
          selectFixtures: { restaurantServiceItems: [[baseService]] },
        }).db,
      }).createBooking({ ...book, bookingTime: "08:59" }),
    ).rejects.toThrow("The selected time is before the service opens");
    await expect(
      createService({
        db: createDbMock({
          selectFixtures: { restaurantServiceItems: [[baseService]] },
        }).db,
      }).createBooking({ ...book, bookingTime: "18:01" }),
    ).rejects.toThrow("The selected time is after the service closes");
    await expect(
      createService({
        d1: createD1Mock([{ changes: 0 }]).d1 as never,
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[baseService]],
            serviceBookingSlots: [[]],
          },
        }).db,
      }).createBooking({
        ...book,
        paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.DEPOSIT,
      }),
    ).rejects.toThrow("depositAmountCents is required");
    await expect(
      createService({
        d1: createD1Mock([{ changes: 0 }]).d1 as never,
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[baseService]],
            serviceBookingSlots: [[]],
          },
        }).db,
      }).createBooking({
        ...book,
        paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.DEPOSIT,
        depositAmountCents: 2000,
      }),
    ).rejects.toThrow("depositAmountCents cannot exceed");
    await expect(
      createService({
        d1: createD1Mock([{ changes: 0 }]).d1 as never,
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[baseService]],
            serviceBookingSlots: [[]],
          },
        }).db,
      }).createBooking({
        ...book,
        reminderOptIn: true,
        reminderMinutesBefore: 4,
      }),
    ).rejects.toThrow("reminderMinutesBefore must be between");
  });

  it("creates bookings without immediate payment when payment is deferred", async () => {
    const { d1 } = createD1Mock([{ changes: 0 }]);
    const { db, insertValues } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [
          [
            {
              id: 10,
              restaurantId: "rest-1",
              name: "Spa Session",
              durationMinutes: 60,
              priceCents: 5000,
              availableHours: null,
              requiresBooking: true,
              isActive: true,
              deletedAt: null,
            },
          ],
        ],
        serviceBookingSlots: [[]],
      },
      mutationFixtures: {
        serviceBookings: { insert: [[{ id: "booking-1" }]] },
      },
    });
    const service = createService({ d1: d1 as never, db });

    await service.createBooking({
      restaurantId: "rest-1",
      serviceItemId: 10,
      customerName: "Ada",
      customerPhone: "+886900000000",
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
      paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.NONE,
    });

    expect(insertValues[0]).toMatchObject({
      paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.NONE,
      depositRequiredCents: 0,
      balanceDueCents: 5000,
      amountDueCents: 0,
      reminderOptIn: 0,
      reminderMinutesBefore: null,
      reminderScheduledAt: null,
    });
  });

  it("rejects bookings when an existing slot is full", async () => {
    const { d1 } = createD1Mock([{ changes: 0 }]);
    const { db } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [
          [
            {
              id: 10,
              restaurantId: "rest-1",
              name: "Spa Session",
              durationMinutes: 60,
              priceCents: 1000,
              availableHours: null,
              requiresBooking: true,
              isActive: true,
              deletedAt: null,
            },
          ],
        ],
        serviceBookingSlots: [[{ id: "slot-1" }]],
      },
    });
    const service = createService({ d1: d1 as never, db });

    await expect(
      service.createBooking({
        restaurantId: "rest-1",
        serviceItemId: 10,
        customerName: "Ada",
        customerPhone: "+886900000000",
        bookingDate: "2026-06-10",
        bookingTime: "10:00",
      }),
    ).rejects.toThrow("This time slot is fully booked");
  });

  it("accepts employees only when availability covers the booking and no active booking overlaps", async () => {
    const { d1 } = createD1Mock([{ changes: 0 }]);
    const { db, insertValues } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [
          [
            {
              id: 10,
              restaurantId: "rest-1",
              name: "Spa Session",
              durationMinutes: 60,
              priceCents: 1000,
              availableHours: null,
              requiresBooking: true,
              isActive: true,
              deletedAt: null,
            },
          ],
        ],
        users: [
          [
            {
              id: "employee-7",
              restaurantId: "rest-1",
              isActive: true,
              role: 2,
            },
          ],
        ],
        serviceBookingSlots: [[]],
        employeeAvailability: [
          [
            {
              availabilityType: "recurring",
              dayOfWeek: 3,
              startTime: "09:00",
              endTime: "17:00",
              preferenceType: "available",
              priority: 1,
            },
          ],
        ],
        serviceBookings: [[]],
      },
      mutationFixtures: {
        serviceBookings: { insert: [[{ id: "booking-1" }]] },
      },
    });
    const service = createService({ d1: d1 as never, db });

    await service.createBooking({
      restaurantId: "rest-1",
      serviceItemId: 10,
      customerName: "Ada",
      customerPhone: "+886900000000",
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
      employeeId: "employee-7",
    });

    expect(insertValues[0]).toMatchObject({ employeeId: "employee-7" });
  });

  it("rejects employee assignments without availability or with overlapping bookings", async () => {
    const serviceRow = {
      id: 10,
      restaurantId: "rest-1",
      name: "Spa Session",
      durationMinutes: 60,
      priceCents: 1000,
      availableHours: null,
      requiresBooking: true,
      isActive: true,
      deletedAt: null,
    };
    const book = {
      restaurantId: "rest-1",
      serviceItemId: 10,
      customerName: "Ada",
      customerPhone: "+886900000000",
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
      employeeId: "employee-7",
    };

    await expect(
      createService({
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[serviceRow]],
            users: [
              [
                {
                  id: "employee-7",
                  restaurantId: "rest-1",
                  isActive: false,
                  role: 2,
                },
              ],
            ],
          },
        }).db,
      }).createBooking(book),
    ).rejects.toThrow("The assigned employee is not available");

    await expect(
      createService({
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[serviceRow]],
            users: [
              [
                {
                  id: "employee-7",
                  restaurantId: "rest-1",
                  isActive: true,
                  role: 2,
                },
              ],
            ],
            employeeAvailability: [[]],
          },
        }).db,
      }).createBooking(book),
    ).rejects.toThrow("The assigned employee is not available");

    await expect(
      createService({
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[serviceRow]],
            users: [
              [
                {
                  id: "employee-7",
                  restaurantId: "rest-1",
                  isActive: true,
                  role: 2,
                },
              ],
            ],
            employeeAvailability: [
              [
                {
                  availabilityType: "specific_date",
                  startDate: "2026-06-10",
                  endDate: "2026-06-10",
                  startTime: null,
                  endTime: null,
                  preferenceType: "available",
                  priority: 2,
                },
              ],
            ],
            serviceBookings: [
              [{ bookingTime: "09:30", durationMinutesSnapshot: 60 }],
            ],
          },
        }).db,
      }).createBooking(book),
    ).rejects.toThrow("The assigned employee is not available");

    await expect(
      createService({
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[serviceRow]],
            users: [
              [
                {
                  id: "employee-7",
                  restaurantId: "rest-1",
                  isActive: true,
                  role: 2,
                },
              ],
            ],
            employeeAvailability: [
              [
                {
                  availabilityType: "recurring",
                  dayOfWeek: 3,
                  startTime: "09:00",
                  endTime: "17:00",
                  preferenceType: "available",
                  priority: 1,
                },
                {
                  availabilityType: "specific_date",
                  startDate: "2026-06-10",
                  endDate: "2026-06-10",
                  startTime: "09:00",
                  endTime: "17:00",
                  preferenceType: "unavailable",
                  priority: 2,
                },
              ],
            ],
          },
        }).db,
      }).createBooking(book),
    ).rejects.toThrow("The assigned employee is not available");
  });

  it("rolls back reserved capacity when booking insertion fails", async () => {
    const { d1, calls } = createD1Mock([{ changes: 1 }, { changes: 1 }]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(async () => ({
              id: 10,
              restaurantId: "rest-1",
              name: "Spa Session",
              durationMinutes: 60,
              priceCents: 1000,
              availableHours: null,
              requiresBooking: true,
              isActive: true,
              deletedAt: null,
            })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => {
            throw new Error("insert failed");
          }),
        })),
      })),
    };
    const service = createService({ d1: d1 as never, db });

    await expect(
      service.createBooking({
        restaurantId: "rest-1",
        serviceItemId: 10,
        customerName: "Ada",
        customerPhone: "+886900000000",
        bookingDate: "2026-06-10",
        bookingTime: "10:00",
      }),
    ).rejects.toThrow("insert failed");
    expect(calls).toHaveLength(2);
    expect(calls[1].sql).toContain("current_bookings - 1");
  });

  it("creates waitlist entries with default party and waiting status", async () => {
    const insertedRow = { id: "wait-1" };
    const { db, insertValues } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [
          [
            {
              id: 10,
              restaurantId: "rest-1",
              durationMinutes: 60,
              availableHours: null,
              requiresBooking: true,
              isActive: true,
              deletedAt: null,
            },
          ],
        ],
      },
      mutationFixtures: {
        serviceBookingWaitlist: { insert: [[insertedRow]] },
      },
    });
    const service = createService({ db });

    await expect(
      service.joinWaitlist({
        restaurantId: "rest-1",
        serviceItemId: 10,
        customerName: "Ada",
        customerPhone: "+886900000000",
        bookingDate: "2026-06-10",
        bookingTime: "10:00",
        notes: "Any staff is fine",
      }),
    ).resolves.toBe(insertedRow);
    expect(insertValues[0]).toMatchObject({
      restaurantId: "rest-1",
      serviceItemId: 10,
      customerName: "Ada",
      customerEmail: null,
      partySize: 1,
      status: SERVICE_BOOKING_WAITLIST_STATUS.WAITING,
      notes: "Any staff is fine",
    });
  });

  it("creates waitlist entries with employee assignment and optional fields", async () => {
    const insertedRow = { id: "wait-2" };
    const { db, insertValues } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [
          [
            {
              id: 10,
              restaurantId: "rest-1",
              durationMinutes: null,
              availableHours: null,
              requiresBooking: true,
              isActive: true,
              deletedAt: null,
            },
          ],
        ],
        users: [
          [
            {
              id: "employee-7",
              restaurantId: "rest-1",
              isActive: true,
              role: 2,
            },
          ],
        ],
        employeeAvailability: [
          [
            {
              availabilityType: "specific_date",
              startDate: "2026-06-10",
              endDate: "2026-06-10",
              startTime: null,
              endTime: null,
              preferenceType: "available",
              priority: null,
            },
          ],
        ],
        serviceBookings: [[]],
      },
      mutationFixtures: {
        serviceBookingWaitlist: { insert: [[insertedRow]] },
      },
    });
    const service = createService({ db });

    await expect(
      service.joinWaitlist({
        restaurantId: "rest-1",
        serviceItemId: 10,
        customerId: "customer-1",
        customerName: "Ada",
        customerPhone: "+886900000000",
        customerEmail: "ada@example.test",
        bookingDate: "2026-06-10",
        bookingTime: "10:00",
        partySize: 3,
        employeeId: "employee-7",
        specialRequests: "Quiet room",
      }),
    ).resolves.toBe(insertedRow);
    expect(insertValues[0]).toMatchObject({
      customerId: "customer-1",
      customerEmail: "ada@example.test",
      partySize: 3,
      employeeId: "employee-7",
      specialRequests: "Quiet room",
      notes: null,
    });
  });

  it("rejects waitlist entries for unavailable or non-bookable services", async () => {
    const waitlist = {
      restaurantId: "rest-1",
      serviceItemId: 10,
      customerName: "Ada",
      customerPhone: "+886900000000",
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
    };

    await expect(
      createService({
        db: createDbMock({
          selectFixtures: { restaurantServiceItems: [[]] },
        }).db,
      }).joinWaitlist(waitlist),
    ).rejects.toThrow("Service not found");
    await expect(
      createService({
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [
              [
                {
                  id: 10,
                  restaurantId: "rest-2",
                  availableHours: null,
                  requiresBooking: true,
                  isActive: true,
                  deletedAt: null,
                },
              ],
            ],
          },
        }).db,
      }).joinWaitlist(waitlist),
    ).rejects.toThrow("Service does not belong to this restaurant");
    await expect(
      createService({
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [
              [
                {
                  id: 10,
                  restaurantId: "rest-1",
                  availableHours: null,
                  requiresBooking: false,
                  isActive: true,
                  deletedAt: null,
                },
              ],
            ],
          },
        }).db,
      }).joinWaitlist(waitlist),
    ).rejects.toThrow("This service does not accept waitlist entries");
  });

  it("lists slots, bookings, and due reminders with optional filters", async () => {
    const slots = [{ id: "slot-1" }];
    const bookings = [{ id: "booking-1" }];
    const reminders = [{ id: "reminder-1" }];
    const { db } = createDbMock({
      selectFixtures: {
        serviceBookingSlots: [slots],
        serviceBookings: [bookings, reminders],
      },
    });
    const service = createService({ db });

    await expect(
      service.listSlots({
        restaurantId: "rest-1",
        serviceItemId: 10,
        date: "2026-06-10",
      }),
    ).resolves.toBe(slots);
    await expect(
      service.listByRestaurant({
        restaurantId: "rest-1",
        date: "2026-06-10",
        status: SERVICE_BOOKING_STATUS.CONFIRMED,
      }),
    ).resolves.toBe(bookings);
    await expect(
      service.listDueReminders({
        before: new Date("2026-06-10T00:00:00.000Z"),
        restaurantId: "rest-1",
      }),
    ).resolves.toBe(reminders);
  });

  it("lists slots, bookings, and due reminders with only required filters", async () => {
    const slots = [{ id: "slot-1" }];
    const bookings = [{ id: "booking-1" }];
    const reminders = [{ id: "reminder-1" }];
    const { db } = createDbMock({
      selectFixtures: {
        serviceBookingSlots: [slots],
        serviceBookings: [bookings, reminders],
      },
    });
    const service = createService({ db });

    await expect(service.listSlots({ restaurantId: "rest-1" })).resolves.toBe(
      slots,
    );
    await expect(
      service.listByRestaurant({ restaurantId: "rest-1" }),
    ).resolves.toBe(bookings);
    await expect(
      service.listDueReminders({
        before: new Date("2026-06-10T00:00:00.000Z"),
      }),
    ).resolves.toBe(reminders);
  });

  it("creates slots through upsert and reports missing slot reads", async () => {
    const { d1, calls } = createD1Mock([{ changes: 1 }]);
    const slot = {
      id: "slot-1",
      restaurantId: "rest-1",
      serviceItemId: 10,
      date: "2026-06-10",
      timeSlot: "10:00",
      maxCapacity: 2,
      currentBookings: 0,
      isAvailable: 0,
      blockReason: "Staff meeting",
    };
    const { db } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [[{ id: 10, restaurantId: "rest-1" }]],
        serviceBookingSlots: [[slot]],
      },
    });
    const service = createService({ d1: d1 as never, db });

    await expect(
      service.createSlot({
        restaurantId: "rest-1",
        serviceItemId: 10,
        date: "2026-06-10",
        timeSlot: "10:00",
        maxCapacity: 2,
        isAvailable: false,
        blockReason: "Staff meeting",
      }),
    ).resolves.toBe(slot);
    expect(calls[0]).toMatchObject({
      params: [
        expect.any(String),
        "rest-1",
        10,
        "2026-06-10",
        "10:00",
        2,
        0,
        "Staff meeting",
      ],
    });

    await expect(
      createService({
        db: createDbMock({
          selectFixtures: {
            restaurantServiceItems: [[{ id: 10, restaurantId: "rest-2" }]],
          },
        }).db,
      }).createSlot({
        restaurantId: "rest-1",
        serviceItemId: 10,
        date: "2026-06-10",
        timeSlot: "10:00",
        maxCapacity: 2,
      }),
    ).rejects.toThrow("Service does not belong to this restaurant");

    await expect(
      createService({
        db: createDbMock({
          selectFixtures: { restaurantServiceItems: [[]] },
        }).db,
      }).createSlot({
        restaurantId: "rest-1",
        serviceItemId: 10,
        date: "2026-06-10",
        timeSlot: "10:00",
        maxCapacity: 2,
      }),
    ).rejects.toThrow("Service not found");
  });

  it("blocks slots with the default reason and reports missing blocked slots", async () => {
    const { d1, calls } = createD1Mock([{ changes: 1 }]);
    const { db } = createDbMock({
      selectFixtures: {
        restaurantServiceItems: [[{ id: 10, restaurantId: "rest-1" }]],
        serviceBookingSlots: [[]],
      },
    });
    const service = createService({ d1: d1 as never, db });

    await expect(
      service.blockSlot({
        restaurantId: "rest-1",
        serviceItemId: 10,
        date: "2026-06-10",
        timeSlot: "10:00",
      }),
    ).rejects.toThrow("Slot not found");
    expect(calls[0].params.at(-1)).toBe("Blocked");
  });

  it("requires matching contact proof for confirmation-code lookups", async () => {
    const booking = {
      id: "booking-1",
      confirmationCode: "ABC123",
      customerPhone: "+886 900-000-000",
      customerEmail: "Ada@Example.Test",
    };
    const createLookupService = () => {
      const { db } = createDbMock({
        selectFixtures: { serviceBookings: [[booking]] },
      });
      return createService({ db });
    };

    await expect(
      createLookupService().getByConfirmationCode("abc123", {
        customerPhone: "+886900000000",
      }),
    ).resolves.toBe(booking);
    await expect(
      createLookupService().getByConfirmationCode("abc123", {
        customerEmail: "ada@example.test",
      }),
    ).resolves.toBe(booking);
    await expect(
      createService({
        db: createDbMock({
          selectFixtures: { serviceBookings: [[]] },
        }).db,
      }).getByConfirmationCode("missing", {
        customerPhone: "+886900000000",
      }),
    ).resolves.toBeNull();
    await expect(
      createLookupService().getByConfirmationCode("abc123"),
    ).rejects.toThrow("Booking phone or email is required");
    await expect(
      createLookupService().getByConfirmationCode("abc123", {
        customerPhone: "+886911111111",
      }),
    ).rejects.toThrow("Booking contact does not match");
  });

  it("reports missing confirmation-code cancellations", async () => {
    const service = createService({
      db: createDbMock({
        selectFixtures: { serviceBookings: [[]] },
      }).db,
    });

    await expect(
      service.cancelByConfirmationCode("missing", {
        customerPhone: "+886900000000",
      }),
    ).rejects.toThrow("Booking not found");
  });

  it("cancels confirmed bookings by proof and releases slot and voucher use", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const booking = {
      id: "booking-1",
      serviceItemId: 10,
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
      status: SERVICE_BOOKING_STATUS.CONFIRMED,
      couponId: 99,
      customerPhone: "+886900000000",
      customerEmail: null,
    };
    const cancelled = { ...booking, status: SERVICE_BOOKING_STATUS.CANCELLED };
    const { d1, calls } = createD1Mock([
      { changes: 1 },
      { changes: 1 },
      { changes: 1 },
    ]);
    const { db } = createDbMock({
      selectFixtures: { serviceBookings: [[booking], [cancelled]] },
    });
    const service = createService({ d1: d1 as never, db });

    await expect(
      service.cancelByConfirmationCode("booking-code", {
        customerPhone: "+886900000000",
      }),
    ).resolves.toBe(cancelled);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      params: [
        SERVICE_BOOKING_STATUS.CANCELLED,
        Date.parse("2026-06-07T00:00:00.000Z"),
        Date.parse("2026-06-07T00:00:00.000Z"),
        "booking-1",
        SERVICE_BOOKING_STATUS.CONFIRMED,
      ],
    });
    expect(calls[1]).toMatchObject({
      params: [
        Date.parse("2026-06-07T00:00:00.000Z"),
        10,
        "2026-06-10",
        "10:00",
        "booking-1",
        SERVICE_BOOKING_STATUS.CANCELLED,
        Date.parse("2026-06-07T00:00:00.000Z"),
      ],
    });
    expect(calls[2]).toMatchObject(
      expect.objectContaining({ params: expect.arrayContaining([99]) }),
    );
  });

  it("cancels pending bookings without decrementing voucher usage", async () => {
    const booking = {
      id: "booking-1",
      serviceItemId: 10,
      bookingDate: "2026-06-10",
      bookingTime: "10:00",
      status: SERVICE_BOOKING_STATUS.PENDING,
      couponId: 99,
    };
    const { d1, calls } = createD1Mock([{ changes: 1 }]);
    const { db } = createDbMock({
      selectFixtures: {
        serviceBookings: [
          [booking],
          [{ ...booking, status: SERVICE_BOOKING_STATUS.CANCELLED }],
        ],
      },
    });
    const service = createService({ d1: d1 as never, db });

    await service.cancelBooking("booking-1");

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      params: expect.arrayContaining([10, "2026-06-10", "10:00"]),
    });
  });

  it("marks reminders sent and transitions confirmed bookings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const { db, updateSets } = createDbMock({
      selectFixtures: {
        serviceBookings: [
          [{ id: "booking-1", status: SERVICE_BOOKING_STATUS.CONFIRMED }],
          [{ id: "booking-1", status: SERVICE_BOOKING_STATUS.CONFIRMED }],
        ],
      },
      mutationFixtures: {
        serviceBookings: {
          update: [
            [{ id: "booking-1", reminderSentAt: new Date() }],
            [{ id: "booking-1", status: SERVICE_BOOKING_STATUS.COMPLETED }],
          ],
        },
      },
    });
    const service = createService({ db });

    await expect(service.markReminderSent("booking-1")).resolves.toMatchObject({
      id: "booking-1",
    });
    await expect(
      service.transition("booking-1", "completed"),
    ).resolves.toMatchObject({
      status: SERVICE_BOOKING_STATUS.COMPLETED,
    });
    expect(updateSets[0]).toMatchObject({
      reminderSentAt: new Date("2026-06-07T00:00:00.000Z"),
      updatedAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    expect(updateSets[1]).toMatchObject({
      status: SERVICE_BOOKING_STATUS.COMPLETED,
      completedAt: new Date("2026-06-07T00:00:00.000Z"),
      updatedAt: new Date("2026-06-07T00:00:00.000Z"),
    });
  });

  it("marks no-shows and rejects transitions from non-confirmed bookings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const { db, updateSets } = createDbMock({
      selectFixtures: {
        serviceBookings: [
          [{ id: "booking-1", status: SERVICE_BOOKING_STATUS.CONFIRMED }],
          [{ id: "booking-2", status: SERVICE_BOOKING_STATUS.PENDING }],
        ],
      },
      mutationFixtures: {
        serviceBookings: {
          update: [
            [{ id: "booking-1", status: SERVICE_BOOKING_STATUS.NO_SHOW }],
          ],
        },
      },
    });
    const service = createService({ db });

    await expect(
      service.transition("booking-1", "no_show"),
    ).resolves.toMatchObject({ status: SERVICE_BOOKING_STATUS.NO_SHOW });
    expect(updateSets[0]).toMatchObject({
      status: SERVICE_BOOKING_STATUS.NO_SHOW,
      noShowAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    await expect(service.transition("booking-2", "completed")).rejects.toThrow(
      "Only confirmed bookings can be completed or marked no-show",
    );
  });

  it("pays pending bookings with credits and claims voucher usage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    // The restaurant's currency, not the card's, is what spend checks the
    // card against — so a card in another currency is refused there.
    resolveRestaurantCurrency.mockResolvedValueOnce("MYR");
    const getBalance = vi.spyOn(CreditService.prototype, "getBalance");
    const spend = vi
      .spyOn(CreditService.prototype, "spend")
      .mockResolvedValue({ ledgerEntryId: "ledger-1" } as never);
    const booking = {
      id: "booking-1",
      restaurantId: "restaurant-1",
      status: SERVICE_BOOKING_STATUS.PENDING,
      couponId: 99,
      paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.PREPAY,
      amountDueCents: 2500,
    };
    const confirmed = {
      ...booking,
      status: SERVICE_BOOKING_STATUS.CONFIRMED,
      paymentStatus: SERVICE_BOOKING_PAYMENT_STATUS.PAID,
    };
    const { d1, calls } = createD1Mock([{ changes: 1 }, { changes: 1 }]);
    const { db } = createDbMock({
      selectFixtures: { serviceBookings: [[booking], [confirmed]] },
    });
    const service = createService({ d1: d1 as never, db });

    await expect(
      service.payWithCredits({
        bookingId: "booking-1",
        creditCardPublicId: "card-public-1",
        pin: "1234",
      }),
    ).resolves.toBe(confirmed);

    expect(resolveRestaurantCurrency).toHaveBeenCalledWith(d1, "restaurant-1");
    expect(getBalance).not.toHaveBeenCalled();
    expect(spend).toHaveBeenCalledWith({
      publicId: "card-public-1",
      amountCents: 2500,
      currency: "MYR",
      idempotencyKey: "service-booking:booking-1",
      sourceType: "service_booking",
      sourceId: "booking-1",
      pin: "1234",
    });
    expect(calls[0]).toMatchObject({
      params: [
        SERVICE_BOOKING_STATUS.CONFIRMED,
        SERVICE_BOOKING_PAYMENT_STATUS.PAID,
        SERVICE_BOOKING_PAYMENT_METHOD.CREDITS,
        2500,
        "ledger-1",
        Date.parse("2026-06-07T00:00:00.000Z"),
        Date.parse("2026-06-07T00:00:00.000Z"),
        "booking-1",
        SERVICE_BOOKING_STATUS.PENDING,
      ],
    });
    expect(calls[1]).toMatchObject(
      expect.objectContaining({ params: expect.arrayContaining([99]) }),
    );
  });

  it("confirms zero-amount credit bookings without spending credits", async () => {
    const spend = vi.spyOn(CreditService.prototype, "spend");
    const booking = {
      id: "booking-1",
      status: SERVICE_BOOKING_STATUS.PENDING,
      couponId: null,
      paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.PREPAY,
      amountDueCents: 0,
    };
    const confirmed = { ...booking, status: SERVICE_BOOKING_STATUS.CONFIRMED };
    const { d1, calls } = createD1Mock([{ changes: 1 }]);
    const { db } = createDbMock({
      selectFixtures: { serviceBookings: [[booking], [confirmed]] },
    });
    const service = createService({ d1: d1 as never, db });

    await service.payWithCredits({
      bookingId: "booking-1",
      creditCardPublicId: "card-public-1",
    });

    expect(spend).not.toHaveBeenCalled();
    expect(calls[0].params).toEqual(
      expect.arrayContaining([SERVICE_BOOKING_PAYMENT_METHOD.CREDITS, 0, null]),
    );
  });

  it("does not allow credits for bookings payable at the venue", async () => {
    const booking = buildBookingRow({
      status: SERVICE_BOOKING_STATUS.PENDING,
      paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.PAY_AT_VENUE,
      amountDueCents: 2500,
    });
    const service = createService();
    const spend = vi.spyOn(CreditService.prototype, "spend");
    spyOnPrivate(service, "loadPayableBooking").mockResolvedValue(booking);

    await expect(
      service.payWithCredits({
        bookingId: "booking-1",
        creditCardPublicId: "card-public-1",
      }),
    ).rejects.toThrow("This booking must be paid at the venue");

    expect(spend).not.toHaveBeenCalled();
  });

  it("rejects payment for non-pending bookings", async () => {
    const { db } = createDbMock({
      selectFixtures: {
        serviceBookings: [
          [{ id: "booking-1", status: SERVICE_BOOKING_STATUS.CONFIRMED }],
        ],
      },
    });
    const service = createService({ db });

    await expect(
      service.payWithCredits({
        bookingId: "booking-1",
        creditCardPublicId: "card-public-1",
      }),
    ).rejects.toThrow("Booking is not awaiting payment");
  });

  it("rolls back earlier recurring bookings when a later booking fails", async () => {
    const { d1, calls } = createD1Mock([{ changes: 1 }]);
    const { db } = createDbMock({
      // The rollback deletes the booking that already landed.
      mutationFixtures: { serviceBookings: { delete: [{ changes: 1 }] } },
    });
    const service = createService({ d1: d1 as never, db });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(service, "createBooking")
      .mockResolvedValueOnce({
        id: "booking-1",
        serviceItemId: 10,
        bookingDate: "2026-06-10",
        bookingTime: "10:00",
        status: SERVICE_BOOKING_STATUS.PENDING,
      } as never)
      .mockRejectedValueOnce(new Error("second booking failed"));

    await expect(
      service.createRecurringBookings({
        restaurantId: "rest-1",
        serviceItemId: 10,
        customerName: "Ada",
        customerPhone: "+886900000000",
        startDate: "2026-06-10",
        bookingTime: "10:00",
        count: 2,
      }),
    ).rejects.toThrow("second booking failed");

    expect(db.delete).toHaveBeenCalled();
    expect(calls[0]).toMatchObject({
      params: [10, "2026-06-10", "10:00"],
    });
  });

  it("confirms pay-at-venue cash bookings through the shared confirmation path", async () => {
    const service = createService();
    const booking = buildBookingRow({
      status: SERVICE_BOOKING_STATUS.PENDING,
      paymentRequirement: SERVICE_BOOKING_PAYMENT_REQUIREMENT.PAY_AT_VENUE,
      amountDueCents: 1200,
    });
    spyOnPrivate(service, "loadPayableBooking").mockResolvedValue(booking);
    const markConfirmed = vi
      .spyOn(service as unknown as ServiceBookingPrivates, "markConfirmed")
      .mockResolvedValue({
        ...booking,
        status: SERVICE_BOOKING_STATUS.CONFIRMED,
      });

    await expect(service.confirmCash("booking-1")).resolves.toMatchObject({
      id: "booking-1",
      status: SERVICE_BOOKING_STATUS.CONFIRMED,
    });
    expect(markConfirmed).toHaveBeenCalledWith(booking, {
      method: SERVICE_BOOKING_PAYMENT_METHOD.CASH,
      amountPaidCents: 1200,
      paymentRef: null,
    });
  });

  it("blocks cancellation for terminal booking statuses", async () => {
    const service = createService();
    spyOnPrivate(service, "requireBooking").mockResolvedValue(
      buildBookingRow({ status: SERVICE_BOOKING_STATUS.COMPLETED }),
    );

    await expect(service.cancelBooking("booking-1")).rejects.toThrow(
      "Booking cannot be cancelled",
    );
  });

  it("renders calendar invites with escaped text and Taipei booking time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const service = createService();
    spyOnPrivate(service, "requireBooking").mockResolvedValue(
      buildBookingRow({
        bookingDate: "2026-06-10",
        bookingTime: "10:30",
        durationMinutesSnapshot: 90,
        serviceNameSnapshot: "Massage, Spa; Deluxe",
        confirmationCode: "ABC123",
        specialRequests: "Quiet room\nNo perfume",
        calendarUid: "uid-1@example.test",
        status: SERVICE_BOOKING_STATUS.CONFIRMED,
      }),
    );

    await expect(
      service.generateCalendarInvite("booking-1"),
    ).resolves.toContain("DTSTART:20260610T023000Z\r\nDTEND:20260610T040000Z");
    const invite = await service.generateCalendarInvite("booking-1");
    expect(invite).toContain("SUMMARY:Massage\\, Spa\\; Deluxe");
    expect(invite).toContain("Confirmation: ABC123");
    expect(invite).toContain("Requests: Quiet room\\nNo perfume");
    expect(invite).toContain("STATUS:CONFIRMED");
  });

  it("renders cancelled calendar invites by confirmation code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const service = createService();
    vi.spyOn(service, "getByConfirmationCode").mockResolvedValue({
      id: "booking-1",
      bookingDate: "2026-06-10",
      bookingTime: "10:30",
      durationMinutesSnapshot: null,
      serviceNameSnapshot: "Spa",
      confirmationCode: "ABC123",
      specialRequests: null,
      calendarUid: "uid-1@example.test",
      status: SERVICE_BOOKING_STATUS.CANCELLED,
    } as never);

    await expect(
      service.generateCalendarInviteByConfirmationCode("ABC123", {
        customerPhone: "+886900000000",
      }),
    ).resolves.toContain("STATUS:CANCELLED");

    vi.mocked(service.getByConfirmationCode).mockResolvedValueOnce(null);
    await expect(
      service.generateCalendarInviteByConfirmationCode("MISSING"),
    ).rejects.toThrow("Booking not found");
  });
});
