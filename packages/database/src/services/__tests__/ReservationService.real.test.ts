/**
 * Real-D1 tests for ReservationService methods that previously built SQL by
 * hand and substituted parameters as literal text via a `replaceParams`
 * helper. This file runs the real implementation against a Miniflare D1
 * database through Drizzle so
 * that any future regression to hand-rolled string SQL with manual
 * parameter substitution will be caught by CI.
 *
 * Covers:
 *   - updateReservation (Drizzle update builder)
 *   - listReservations (Drizzle sql template + schema column refs)
 *   - getReservationStats (Drizzle sql template + schema column refs)
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../../testing/create-test-database";
import { ReservationStatus, WaitingStatus } from "@makanmasak/shared-types";
import { ReservationService } from "../ReservationService";
import { WaitingListService } from "../WaitingListService";
import type { CloudflareEnv } from "../base";
const RESTAURANT_ID = "rest-real-1";
const OTHER_RESTAURANT_ID = "rest-real-2";
const FUTURE_RESERVATION_DATE = new Date(Date.now() + 86_400_000)
  .toISOString()
  .slice(0, 10);

async function seedRestaurant(testDb: TestDatabase, id: string): Promise<void> {
  await testDb.db
    .prepare(
      `INSERT INTO restaurants (id, name, type, category, address, district, phone, created_at_ms, updated_at_ms)
       VALUES (?, 'Test Bistro', 'cafe', 'food', '1 St', 'KL', '000', 1735689600000, 1735689600000)`,
    )
    .bind(id)
    .run();
}

interface SeedReservationOptions {
  restaurantId?: string;
  partySize?: number;
  status?: string;
  reservationDate?: string;
  reservationTime?: string;
  customerPhone?: string;
  specialRequests?: string | null;
  createdAt?: number;
}

async function seedReservation(
  testDb: TestDatabase,
  id: string,
  opts: SeedReservationOptions = {},
): Promise<void> {
  const now = opts.createdAt ?? Date.now();
  await testDb.db
    .prepare(
      `INSERT INTO reservations
         (id, restaurant_id, customer_name, customer_phone, party_size,
          reservation_date, reservation_time, duration_minutes, status,
          confirmation_code, special_requests, created_at, updated_at)
       VALUES (?, ?, '王小明', ?, ?, ?, ?, 90, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.restaurantId ?? RESTAURANT_ID,
      opts.customerPhone ?? "0912345678",
      opts.partySize ?? 2,
      opts.reservationDate ?? FUTURE_RESERVATION_DATE,
      opts.reservationTime ?? "18:30",
      opts.status ?? "pending",
      // Use full id as confirmation code so seed never collides on the
      // UNIQUE constraint, regardless of how callers name their rows.
      id,
      opts.specialRequests ?? null,
      now,
      now,
    )
    .run();
}

interface SeedSlotOptions {
  restaurantId?: string;
  date?: string;
  timeSlot?: string;
  maxCapacity?: number;
  maxTables?: number;
  currentReservations?: number;
  currentCapacity?: number;
  isAvailable?: number;
}

async function seedSlot(
  db: TestDatabase,
  id: string,
  opts: SeedSlotOptions = {},
): Promise<void> {
  const now = Date.now();
  await db.db
    .prepare(
      `INSERT INTO reservation_slots
         (id, restaurant_id, date, time_slot, max_capacity, max_tables,
          current_reservations, current_capacity, is_available, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.restaurantId ?? RESTAURANT_ID,
      opts.date ?? FUTURE_RESERVATION_DATE,
      opts.timeSlot ?? "18:30",
      opts.maxCapacity ?? 10,
      opts.maxTables ?? 5,
      opts.currentReservations ?? 0,
      opts.currentCapacity ?? 0,
      opts.isAvailable ?? 1,
      now,
      now,
    )
    .run();
}

async function seedTable(
  db: TestDatabase,
  id: number,
  opts: {
    restaurantId?: string;
    number?: string;
    capacity?: number;
    isOccupied?: number;
    isActive?: number;
    isReservable?: number;
  } = {},
): Promise<void> {
  const now = Date.now();
  await db.db
    .prepare(
      `INSERT INTO tables
         (id, restaurant_id, number, capacity, qr_code, is_occupied,
          is_active, is_reservable, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.restaurantId ?? RESTAURANT_ID,
      opts.number ?? `T${id}`,
      opts.capacity ?? 4,
      `qr-table-${id}`,
      opts.isOccupied ?? 0,
      opts.isActive ?? 1,
      opts.isReservable ?? 1,
      now,
      now,
    )
    .run();
}

async function seedWaitingEntry(
  db: TestDatabase,
  id: string,
  opts: {
    restaurantId?: string;
    customerPhone?: string;
    partySize?: number;
    status?: string;
    tableId?: number | null;
    queueNumber?: number;
  } = {},
): Promise<void> {
  const now = Date.now();
  await db.db
    .prepare(
      `INSERT INTO waiting_list
         (id, restaurant_id, customer_name, customer_phone, party_size,
          queue_number, queue_date, priority, status, table_id,
          created_at, updated_at)
       VALUES (?, ?, '候位客人', ?, ?, ?, '2026-08-01', 0, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.restaurantId ?? RESTAURANT_ID,
      opts.customerPhone ??
        `0912${String(opts.queueNumber ?? 1).padStart(6, "0")}`,
      opts.partySize ?? 2,
      opts.queueNumber ?? 1,
      opts.status ?? WaitingStatus.WAITING,
      opts.tableId ?? null,
      now,
      now,
    )
    .run();
}

async function readSlot(
  db: TestDatabase,
  id: string,
): Promise<{ current_reservations: number; current_capacity: number }> {
  const row = await db.db
    .prepare(
      `SELECT current_reservations, current_capacity FROM reservation_slots WHERE id = ?`,
    )
    .bind(id)
    .first<{ current_reservations: number; current_capacity: number }>();
  if (!row) throw new Error(`slot ${id} not found`);
  return row;
}

let testDb: TestDatabase;
let service: ReservationService;

// Shared miniflare instance across all describes — paid once instead of per
// file/describe. Boot + replaying the full migration set is ~45s in isolation
// and slower under full-suite CPU contention, so allow generous headroom.
beforeAll(async () => {
  testDb = await createTestDatabase();
}, REAL_D1_SETUP_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.dispose();
});

beforeEach(async () => {
  await testDb.truncateAll();
  await seedRestaurant(testDb, RESTAURANT_ID);
  const env = { JWT_SECRET: "test", NODE_ENV: "test" } as CloudflareEnv;
  service = new ReservationService(testDb.db as D1Database, env);
});

describe("ReservationService.updateReservation — real D1", () => {
  it("persists field updates via the real Drizzle update path", async () => {
    const id = "rsv-real-happy";
    await seedReservation(testDb, id, { partySize: 2 });

    const result = await service.updateReservation(id, {
      partySize: 5,
      specialRequests: "需要兒童座椅",
    });

    expect(result.partySize).toBe(5);
    expect(result.specialRequests).toBe("需要兒童座椅");

    const row = await testDb.db
      .prepare(
        `SELECT party_size, special_requests FROM reservations WHERE id = ?`,
      )
      .bind(id)
      .first<{ party_size: number; special_requests: string }>();
    expect(row?.party_size).toBe(5);
    expect(row?.special_requests).toBe("需要兒童座椅");
  });

  it("stores SQL-injection probes verbatim and does not execute them", async () => {
    const id = "rsv-real-injection";
    await seedReservation(testDb, id, { partySize: 2 });

    const malicious = `'); DROP TABLE reservations; --`;
    await service.updateReservation(id, { specialRequests: malicious });

    // Table must still exist — if the payload were interpolated as SQL the
    // DROP would have removed it and the next query would throw.
    const tableExists = await testDb.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='reservations'`,
      )
      .first();
    expect(tableExists).toBeTruthy();

    const row = await testDb.db
      .prepare(`SELECT special_requests FROM reservations WHERE id = ?`)
      .bind(id)
      .first<{ special_requests: string }>();
    expect(row?.special_requests).toBe(malicious);
  });

  it("only updates fields present in the patch", async () => {
    const id = "rsv-real-partial";
    await seedReservation(testDb, id, {
      partySize: 2,
      specialRequests: "原備註",
    });

    await service.updateReservation(id, { partySize: 7 });

    const row = await testDb.db
      .prepare(
        `SELECT party_size, special_requests FROM reservations WHERE id = ?`,
      )
      .bind(id)
      .first<{ party_size: number; special_requests: string }>();
    expect(row?.party_size).toBe(7);
    expect(row?.special_requests).toBe("原備註");
  });

  it("throws when the reservation does not exist", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      service.updateReservation("does-not-exist", { partySize: 4 }),
    ).rejects.toThrow("訂位不存在");
    expect(consoleError).toHaveBeenCalledWith(
      "Error updating reservation:",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});

describe("ReservationService status notifications — real D1", () => {
  it("dispatches a confirmation notification after confirming a reservation", async () => {
    const sent: unknown[] = [];
    const serviceWithNotifier = new ReservationService(
      testDb.db as D1Database,
      {
        JWT_SECRET: "test",
        NODE_ENV: "test",
        reservationNotifier: {
          send: async (event: unknown) => {
            sent.push(event);
          },
        },
      } as CloudflareEnv,
    );
    await seedReservation(testDb, "rsv-confirm-notify", {
      reservationDate: FUTURE_RESERVATION_DATE,
      reservationTime: "18:30",
    });

    await serviceWithNotifier.confirmReservation("rsv-confirm-notify");

    expect(sent).toEqual([
      expect.objectContaining({
        type: "confirmed",
        reservationId: "rsv-confirm-notify",
        reservation: expect.objectContaining({
          id: "rsv-confirm-notify",
          status: "confirmed",
        }),
      }),
    ]);
  });

  it("does not roll back cancellation when notification dispatch fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const serviceWithNotifier = new ReservationService(
      testDb.db as D1Database,
      {
        JWT_SECRET: "test",
        NODE_ENV: "test",
        reservationNotifier: {
          send: async () => {
            throw new Error("provider down");
          },
        },
      } as CloudflareEnv,
    );
    await seedReservation(testDb, "rsv-cancel-notify");

    await expect(
      serviceWithNotifier.cancelReservation(
        "rsv-cancel-notify",
        "guest request",
      ),
    ).resolves.toMatchObject({
      id: "rsv-cancel-notify",
      status: "cancelled",
    });

    const row = await testDb.db
      .prepare(`SELECT status FROM reservations WHERE id = ?`)
      .bind("rsv-cancel-notify")
      .first<{ status: string }>();
    expect(row?.status).toBe("cancelled");
    expect(consoleError).toHaveBeenCalledWith(
      "Reservation notification dispatch failed:",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("dispatches a no-show notification after marking a reservation no-show", async () => {
    const sent: unknown[] = [];
    const serviceWithNotifier = new ReservationService(
      testDb.db as D1Database,
      {
        JWT_SECRET: "test",
        NODE_ENV: "test",
        reservationNotifier: {
          send: async (event: unknown) => {
            sent.push(event);
          },
        },
      } as CloudflareEnv,
    );
    await seedReservation(testDb, "rsv-no-show-notify", {
      reservationDate: FUTURE_RESERVATION_DATE,
      reservationTime: "19:00",
    });

    await serviceWithNotifier.markNoShow("rsv-no-show-notify");

    expect(sent).toEqual([
      expect.objectContaining({
        type: "no_show",
        reservationId: "rsv-no-show-notify",
        reservation: expect.objectContaining({
          id: "rsv-no-show-notify",
          status: "no_show",
        }),
      }),
    ]);
  });
});

describe("ReservationService forward status transitions — real D1", () => {
  const forwardTransitions: Array<[string, (id: string) => Promise<unknown>]> =
    [
      ["confirm", (id) => service.confirmReservation(id)],
      ["arrive", (id) => service.markArrived(id)],
      ["seat", (id) => service.markSeated(id)],
      ["complete", (id) => service.completeReservation(id)],
    ];

  for (const terminalStatus of ["completed", "cancelled", "no_show"]) {
    for (const [action, run] of forwardTransitions) {
      it(`rejects ${action} from the ${terminalStatus} terminal state`, async () => {
        const consoleError = vi
          .spyOn(console, "error")
          .mockImplementation(() => undefined);
        const id = `rsv-${terminalStatus}-${action}`;
        await seedReservation(testDb, id, { status: terminalStatus });

        await expect(run(id)).rejects.toMatchObject({
          code: "INVALID_STATUS_TRANSITION",
          status: 409,
        });
        expect(await statusOf(testDb, id)).toBe(terminalStatus);
        consoleError.mockRestore();
      });
    }
  }

  it("rejects a replayed arrival without overwriting arrived_at", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await seedReservation(testDb, "rsv-arrive-replay");

    await service.markArrived("rsv-arrive-replay");
    const firstArrival = await testDb.db
      .prepare(`SELECT arrived_at FROM reservations WHERE id = ?`)
      .bind("rsv-arrive-replay")
      .first<{ arrived_at: number }>();

    await expect(
      service.markArrived("rsv-arrive-replay"),
    ).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
      status: 409,
    });
    const replayedArrival = await testDb.db
      .prepare(`SELECT arrived_at FROM reservations WHERE id = ?`)
      .bind("rsv-arrive-replay")
      .first<{ arrived_at: number }>();

    expect(replayedArrival?.arrived_at).toBe(firstArrival?.arrived_at);
    consoleError.mockRestore();
  });

  it("seats a concurrent reservation once and marks its table occupied once", async () => {
    await seedTable(testDb, 60);
    await seedReservation(testDb, "rsv-seat-race", { status: "confirmed" });
    await testDb.db
      .prepare(`UPDATE reservations SET table_id = ? WHERE id = ?`)
      .bind(60, "rsv-seat-race")
      .run();
    const updateTableStatus = vi.spyOn(
      service as unknown as {
        updateTableStatus: (
          tableId: number,
          status: string,
          reservationId?: string,
        ) => Promise<void>;
      },
      "updateTableStatus",
    );

    const results = await Promise.allSettled([
      service.markSeated("rsv-seat-race"),
      service.markSeated("rsv-seat-race"),
    ]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(updateTableStatus).toHaveBeenCalledTimes(1);
    expect(await statusOf(testDb, "rsv-seat-race")).toBe("seated");
  });
});

describe("ReservationService.listReservations — real D1", () => {
  it("filters by restaurantId and returns matching rows + total", async () => {
    await seedRestaurant(testDb, OTHER_RESTAURANT_ID);
    await seedReservation(testDb, "rsv-list-1", { partySize: 2 });
    await seedReservation(testDb, "rsv-list-2", { partySize: 3 });
    await seedReservation(testDb, "rsv-other", {
      restaurantId: OTHER_RESTAURANT_ID,
      partySize: 4,
    });

    const result = await service.listReservations({
      restaurantId: RESTAURANT_ID,
    });

    expect(result.total).toBe(2);
    expect(result.data.map((r) => r.id).sort()).toEqual([
      "rsv-list-1",
      "rsv-list-2",
    ]);
  });

  it("supports IN-list status filter", async () => {
    await seedReservation(testDb, "rsv-pending", { status: "pending" });
    await seedReservation(testDb, "rsv-confirmed", { status: "confirmed" });
    await seedReservation(testDb, "rsv-cancelled", { status: "cancelled" });

    const result = await service.listReservations({
      restaurantId: RESTAURANT_ID,
      status: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED],
    });

    expect(result.total).toBe(2);
    expect(new Set(result.data.map((r) => r.status))).toEqual(
      new Set(["pending", "confirmed"]),
    );
  });

  it("supports date range filter and pagination", async () => {
    await seedReservation(testDb, "rsv-d1", { reservationDate: "2026-05-01" });
    await seedReservation(testDb, "rsv-d2", { reservationDate: "2026-05-02" });
    await seedReservation(testDb, "rsv-d3", { reservationDate: "2026-05-10" });

    const result = await service.listReservations({
      restaurantId: RESTAURANT_ID,
      startDate: "2026-05-01",
      endDate: "2026-05-05",
      page: 1,
      limit: 10,
    });

    expect(result.total).toBe(2);
    expect(result.data.map((r) => r.id).sort()).toEqual(["rsv-d1", "rsv-d2"]);
  });

  it("stores SQL-injection probes verbatim in customerPhone filter", async () => {
    // Seed one reservation with the legitimate phone we'll search for and
    // one row with a benign phone to make sure the filter actually runs.
    await seedReservation(testDb, "rsv-good", { customerPhone: "0911000000" });

    const malicious = `' OR 1=1; DROP TABLE reservations; --`;
    const result = await service.listReservations({
      restaurantId: RESTAURANT_ID,
      customerPhone: malicious,
    });

    // Filter should match nothing, NOT bypass via OR-injection.
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);

    // Table must still exist after the malicious filter.
    const tableExists = await testDb.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='reservations'`,
      )
      .first();
    expect(tableExists).toBeTruthy();
  });

  it("falls back to created_at when sortBy is unknown (allowlist defends identifier)", async () => {
    // Different created_at timestamps so DESC ordering is observable.
    await seedReservation(testDb, "rsv-old", { createdAt: 1000 });
    await seedReservation(testDb, "rsv-new", { createdAt: 2000 });

    const result = await service.listReservations({
      restaurantId: RESTAURANT_ID,
      // Bogus sort key that would have been interpolated literally by the
      // old `r.${sortBy}` code, breaking the query (or worse, opening
      // identifier injection). The allowlist drops it back to createdAt.
      sortBy: "evil; DROP TABLE reservations; --" as never,
    });

    expect(result.total).toBe(2);
    expect(result.data.map((r) => r.id)).toEqual(["rsv-new", "rsv-old"]);

    const tableExists = await testDb.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='reservations'`,
      )
      .first();
    expect(tableExists).toBeTruthy();
  });
});

describe("ReservationService.getReservationStats — real D1", () => {
  it("aggregates per-status counts and party_size sum", async () => {
    await seedReservation(testDb, "rsv-stats-1", {
      status: "confirmed",
      partySize: 2,
    });
    await seedReservation(testDb, "rsv-stats-2", {
      status: "completed",
      partySize: 4,
    });
    await seedReservation(testDb, "rsv-stats-3", {
      status: "no_show",
      partySize: 3,
    });
    await seedReservation(testDb, "rsv-stats-4", {
      status: "cancelled",
      partySize: 1,
    });

    const stats = await service.getReservationStats(RESTAURANT_ID);

    expect(stats.totalReservations).toBe(4);
    expect(stats.confirmedCount).toBe(1);
    expect(stats.completedCount).toBe(1);
    expect(stats.noShowCount).toBe(1);
    expect(stats.cancelledCount).toBe(1);
    expect(stats.totalGuests).toBe(10);
    expect(stats.noShowRate).toBe(25);
    expect(stats.averagePartySize).toBe(2.5);
  });

  it("date filter only counts that day", async () => {
    await seedReservation(testDb, "rsv-day1", {
      reservationDate: "2026-05-01",
      partySize: 2,
    });
    await seedReservation(testDb, "rsv-day2-a", {
      reservationDate: "2026-05-02",
      partySize: 3,
    });
    await seedReservation(testDb, "rsv-day2-b", {
      reservationDate: "2026-05-02",
      partySize: 5,
    });

    const stats = await service.getReservationStats(
      RESTAURANT_ID,
      "2026-05-02",
    );

    expect(stats.totalReservations).toBe(2);
    expect(stats.totalGuests).toBe(8);
  });

  it("treats restaurantId as a parameter, not concatenated SQL", async () => {
    await seedReservation(testDb, "rsv-real-stats", { partySize: 2 });

    const malicious = `' OR 1=1; DROP TABLE reservations; --`;
    const stats = await service.getReservationStats(malicious);

    // No restaurant matches the malicious string → 0 rows aggregated.
    expect(stats.totalReservations).toBe(0);
    expect(stats.totalGuests).toBe(0);

    const tableExists = await testDb.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='reservations'`,
      )
      .first();
    expect(tableExists).toBeTruthy();
  });
});

/**
 * Capacity accounting regressions (#100, #104).
 *
 * The slot counters are the only thing standing between a full sitting and an
 * overbooked one, and both holes here corrupt them silently: a lost update
 * lets two parties claim the same seats, a replayed release hands back seats
 * that were never taken. Neither surfaces as an error — the number is just
 * wrong afterwards — so these assert on the counters themselves.
 */
describe("ReservationService capacity accounting — real D1", () => {
  it("creates a reservation with table assignment on the fresh schema", async () => {
    await seedTable(testDb, 10, { capacity: 4 });
    await seedSlot(testDb, "slot-create", {
      date: FUTURE_RESERVATION_DATE,
      maxCapacity: 4,
      maxTables: 1,
    });

    const result = await service.createReservation({
      restaurantId: RESTAURANT_ID,
      customerName: "王小明",
      customerPhone: "0912345678",
      partySize: 2,
      reservationDate: FUTURE_RESERVATION_DATE,
      reservationTime: "18:30",
      durationMinutes: 90,
    });

    expect(result.status).toBe(ReservationStatus.CONFIRMED);
    expect(result.tableId).toBe(10);
    expect(await readSlot(testDb, "slot-create")).toEqual({
      current_reservations: 1,
      current_capacity: 2,
    });
  });

  it("normalizes an international customer phone before persisting a reservation", async () => {
    await seedTable(testDb, 11, { capacity: 4 });
    await seedSlot(testDb, "slot-international-phone", {
      date: FUTURE_RESERVATION_DATE,
      maxCapacity: 4,
      maxTables: 1,
    });

    const result = await service.createReservation({
      restaurantId: RESTAURANT_ID,
      customerName: "Nur",
      customerPhone: "+60 12-345 6789",
      partySize: 2,
      reservationDate: FUTURE_RESERVATION_DATE,
      reservationTime: "18:30",
      durationMinutes: 90,
    });

    expect(result.customerPhone).toBe("+60123456789");
    await expect(
      testDb.db
        .prepare("SELECT customer_phone FROM reservations WHERE id = ?")
        .bind(result.id)
        .first<{ customer_phone: string }>(),
    ).resolves.toEqual({ customer_phone: "+60123456789" });
  });

  it("does not assign the same table to overlapping reservations", async () => {
    await seedTable(testDb, 90, { capacity: 2 });
    await seedTable(testDb, 91, { capacity: 2 });
    await seedSlot(testDb, "slot-double-book", {
      date: FUTURE_RESERVATION_DATE,
      maxCapacity: 4,
      maxTables: 2,
    });

    const first = await service.createReservation({
      restaurantId: RESTAURANT_ID,
      customerName: "王小明",
      customerPhone: "0912345678",
      partySize: 2,
      reservationDate: FUTURE_RESERVATION_DATE,
      reservationTime: "18:30",
      durationMinutes: 90,
    });
    const second = await service.createReservation({
      restaurantId: RESTAURANT_ID,
      customerName: "陳小華",
      customerPhone: "0923456789",
      partySize: 2,
      reservationDate: FUTURE_RESERVATION_DATE,
      reservationTime: "18:30",
      durationMinutes: 90,
    });

    expect(first.tableId).toBe(90);
    expect(second.tableId).toBe(91);
  });

  it("finds an available waiting-list table on the fresh schema", async () => {
    await seedTable(testDb, 20, { number: "A1", capacity: 2 });
    await seedTable(testDb, 21, { number: "A2", capacity: 4 });
    const waitingService = new WaitingListService(testDb.db, {
      JWT_SECRET: "test",
      NODE_ENV: "test",
    });

    const result = await waitingService.findAvailableTable(RESTAURANT_ID, 3);

    expect(result).toEqual(
      expect.objectContaining({
        tableId: 21,
        tableNumber: "A2",
      }),
    );
  });

  it("does not assign a waiting-list table already held by another active ticket", async () => {
    await seedTable(testDb, 30, { number: "B1", capacity: 2 });
    await seedTable(testDb, 31, { number: "B2", capacity: 2 });
    await seedWaitingEntry(testDb, "wait-held-a", {
      customerPhone: "0912000001",
      queueNumber: 1,
    });
    await seedWaitingEntry(testDb, "wait-held-b", {
      customerPhone: "0912000002",
      queueNumber: 2,
    });
    const waitingService = new WaitingListService(testDb.db, {
      JWT_SECRET: "test",
      NODE_ENV: "test",
    });

    await waitingService.callWaiting("wait-held-a", { tableId: 30 });

    const next = await waitingService.findAvailableTable(RESTAURANT_ID, 2);
    expect(next).toEqual(expect.objectContaining({ tableId: 31 }));
    await expect(
      waitingService.callWaiting("wait-held-b", { tableId: 30 }),
    ).rejects.toThrow("桌位不可用");
  });

  it("allows waiting-list assignment to walk-in-only tables", async () => {
    await seedTable(testDb, 40, {
      number: "BAR1",
      capacity: 2,
      isReservable: 0,
    });
    const waitingService = new WaitingListService(testDb.db, {
      JWT_SECRET: "test",
      NODE_ENV: "test",
    });

    const result = await waitingService.findAvailableTable(RESTAURANT_ID, 2);

    expect(result).toEqual(
      expect.objectContaining({
        tableId: 40,
        tableNumber: "BAR1",
      }),
    );
  });

  it("releases slot capacity exactly once when a cancellation is replayed", async () => {
    await seedSlot(testDb, "slot-replay", {
      currentReservations: 2,
      currentCapacity: 4,
    });
    await seedReservation(testDb, "rsv-cancel-a", {
      status: "confirmed",
      partySize: 2,
    });
    await seedReservation(testDb, "rsv-cancel-b", {
      status: "confirmed",
      partySize: 2,
    });

    const first = await service.cancelReservation("rsv-cancel-a", "改期");
    expect(first.status).toBe("cancelled");
    expect(await readSlot(testDb, "slot-replay")).toEqual({
      current_reservations: 1,
      current_capacity: 2,
    });

    // Replay: idempotent success, and rsv-cancel-b's seats stay claimed.
    const replay = await service.cancelReservation("rsv-cancel-a", "改期");
    expect(replay.status).toBe("cancelled");
    expect(await readSlot(testDb, "slot-replay")).toEqual({
      current_reservations: 1,
      current_capacity: 2,
    });
  });

  it("releases slot capacity exactly once under concurrent cancellations", async () => {
    await seedSlot(testDb, "slot-race", {
      currentReservations: 4,
      currentCapacity: 8,
    });
    await seedReservation(testDb, "rsv-race", {
      status: "confirmed",
      partySize: 2,
    });

    // A double-clicked cancel button, not a replayed one: all four requests
    // read `confirmed` before any of them writes.
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.cancelReservation("rsv-race", "double click"),
      ),
    );

    // Exactly one claim won, so only one release happened.
    expect(await readSlot(testDb, "slot-race")).toEqual({
      current_reservations: 3,
      current_capacity: 6,
    });
    // Every caller is told the settled state. The losers read `confirmed`
    // before the winner committed; returning that stale snapshot would show a
    // live reservation the customer has already cancelled.
    expect(results.map((r) => r.status)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
  });

  it("releases nothing when cancelling a reservation that already completed", async () => {
    await seedSlot(testDb, "slot-done", {
      currentReservations: 1,
      currentCapacity: 2,
    });
    await seedReservation(testDb, "rsv-done", {
      status: "completed",
      partySize: 2,
    });

    // A completed sitting is not cancellable, so the counters must not move.
    const result = await service.cancelReservation("rsv-done", "too late");
    expect(result.status).toBe("completed");
    expect(await readSlot(testDb, "slot-done")).toEqual({
      current_reservations: 1,
      current_capacity: 2,
    });
  });

  it("marks no-show exactly once under replay", async () => {
    await seedSlot(testDb, "slot-noshow", {
      currentReservations: 1,
      currentCapacity: 3,
    });
    await seedReservation(testDb, "rsv-noshow", {
      status: "confirmed",
      partySize: 3,
    });

    await service.markNoShow("rsv-noshow");
    expect(await readSlot(testDb, "slot-noshow")).toEqual({
      current_reservations: 0,
      current_capacity: 0,
    });

    await service.markNoShow("rsv-noshow");
    expect(await readSlot(testDb, "slot-noshow")).toEqual({
      current_reservations: 0,
      current_capacity: 0,
    });
  });

  it("claims slot capacity atomically — concurrent claims cannot overbook", async () => {
    await seedSlot(testDb, "slot-race", { maxCapacity: 4, maxTables: 5 });

    const claim = (
      service as unknown as {
        claimSlotCapacity(
          restaurantId: string,
          date: string,
          timeSlot: string,
          partySize: number,
        ): Promise<boolean>;
      }
    ).claimSlotCapacity.bind(service);

    // Two parties of 3 racing for max_capacity=4: exactly one may win.
    const results = await Promise.all([
      claim(RESTAURANT_ID, FUTURE_RESERVATION_DATE, "18:30", 3),
      claim(RESTAURANT_ID, FUTURE_RESERVATION_DATE, "18:30", 3),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await readSlot(testDb, "slot-race")).toEqual({
      current_reservations: 1,
      current_capacity: 3,
    });

    // One seat left: a party of 2 is refused, a party of 1 fits.
    expect(
      await claim(RESTAURANT_ID, FUTURE_RESERVATION_DATE, "18:30", 2),
    ).toBe(false);
    expect(
      await claim(RESTAURANT_ID, FUTURE_RESERVATION_DATE, "18:30", 1),
    ).toBe(true);
  });

  it("refuses to claim capacity on a closed or missing slot", async () => {
    await seedSlot(testDb, "slot-closed", { isAvailable: 0 });

    const claim = (
      service as unknown as {
        claimSlotCapacity(
          restaurantId: string,
          date: string,
          timeSlot: string,
          partySize: number,
        ): Promise<boolean>;
      }
    ).claimSlotCapacity.bind(service);

    expect(
      await claim(RESTAURANT_ID, FUTURE_RESERVATION_DATE, "18:30", 2),
    ).toBe(false);
    expect(await claim(RESTAURANT_ID, "2099-01-01", "12:00", 2)).toBe(false);
  });

  it("enforces max_tables even when capacity remains", async () => {
    await seedSlot(testDb, "slot-tables", { maxCapacity: 100, maxTables: 1 });

    const claim = (
      service as unknown as {
        claimSlotCapacity(
          restaurantId: string,
          date: string,
          timeSlot: string,
          partySize: number,
        ): Promise<boolean>;
      }
    ).claimSlotCapacity.bind(service);

    expect(
      await claim(RESTAURANT_ID, FUTURE_RESERVATION_DATE, "18:30", 2),
    ).toBe(true);
    expect(
      await claim(RESTAURANT_ID, FUTURE_RESERVATION_DATE, "18:30", 2),
    ).toBe(false);
  });
});

async function statusOf(
  testDb: TestDatabase,
  id: string,
): Promise<string | undefined> {
  const rows = await testDb.db
    .prepare(`SELECT status FROM reservations WHERE id = ?`)
    .bind(id)
    .all<{ status: string }>();
  return rows.results[0]?.status;
}

/**
 * Every status transition folds the caller's authorized restaurantId into the
 * UPDATE's WHERE. The route layer checks ownership too, but that is a
 * check-then-act; these prove the write itself refuses to cross tenants.
 */
describe("ReservationService status transitions are tenant-scoped — real D1", () => {
  beforeEach(async () => {
    await seedRestaurant(testDb, OTHER_RESTAURANT_ID);
    await seedReservation(testDb, "rsv-tenant-a", {
      restaurantId: RESTAURANT_ID,
      status: "pending",
    });
  });

  const transitions: Array<
    [string, (id: string, restaurantId?: string) => Promise<unknown>]
  > = [
    ["confirmReservation", (id, r) => service.confirmReservation(id, r)],
    ["markArrived", (id, r) => service.markArrived(id, r)],
    ["markSeated", (id, r) => service.markSeated(id, r)],
    ["completeReservation", (id, r) => service.completeReservation(id, r)],
    ["markNoShow", (id, r) => service.markNoShow(id, r)],
    [
      "cancelReservation",
      (id, r) => service.cancelReservation(id, undefined, r),
    ],
  ];

  for (const [name, run] of transitions) {
    it(`${name} refuses a reservation owned by another restaurant`, async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await expect(run("rsv-tenant-a", OTHER_RESTAURANT_ID)).rejects.toThrow(
        "訂位不存在",
      );

      // Status is untouched — the write never ran.
      expect(await statusOf(testDb, "rsv-tenant-a")).toBe("pending");
      consoleError.mockRestore();
    });
  }

  it("refuses the write even when the ownership check passed on stale data", async () => {
    // The whole point of folding restaurantId into the WHERE clause is that the
    // pre-check is a check-then-act. Force the window open: the check succeeds,
    // but the id being written belongs to another restaurant. Without the
    // predicate on the UPDATE itself this would flip the status.
    vi.spyOn(
      service as unknown as {
        requireReservation: (
          id: string,
          restaurantId?: string,
        ) => Promise<unknown>;
      },
      "requireReservation",
    ).mockResolvedValue({
      restaurantId: OTHER_RESTAURANT_ID,
      status: ReservationStatus.PENDING,
    });

    await service.confirmReservation("rsv-tenant-a", OTHER_RESTAURANT_ID);

    expect(await statusOf(testDb, "rsv-tenant-a")).toBe("pending");
  });

  it("allows the transition when the authorized restaurant matches", async () => {
    const confirmed = await service.confirmReservation(
      "rsv-tenant-a",
      RESTAURANT_ID,
    );

    expect(confirmed.status).toBe("confirmed");
  });

  it("still allows a platform-wide call with no restaurant scope", async () => {
    const confirmed = await service.confirmReservation("rsv-tenant-a");

    expect(confirmed.status).toBe("confirmed");
  });
});
