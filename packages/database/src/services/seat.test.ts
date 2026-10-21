import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { parseSignedQRUrl, verifyQRSignature } from "@makanmasak/utils";
import { orders, restaurants, seats, tables } from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { SeatService } from "./seat";
import { TableService } from "./table";

const restaurantId = "seat-service-restaurant";
const signingKey = "seat-service-test-signing-key-32-bytes";

describe("SeatService.createSeatsForTable", () => {
  let testDb: TestDatabase;
  let tableId: number;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await testDb.drizzle.insert(restaurants).values({
      id: restaurantId,
      name: "Seat Service Restaurant",
      type: "restaurant",
      category: "casual",
      address: "1 Seat St",
      district: "Central",
      city: "Taipei",
      phone: "0200000000",
      settings: {},
      isAvailable: true,
      isActive: true,
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    } as never);
    const [table] = await testDb.drizzle
      .insert(tables)
      .values({
        restaurantId,
        number: "A1",
        capacity: 4,
        qrCode: "table-qr-a1",
        qrMode: "seat",
        seatCount: 2,
        createdAt: new Date("2026-07-29T00:00:00.000Z"),
        updatedAt: new Date("2026-07-29T00:00:00.000Z"),
      })
      .returning({ id: tables.id });
    tableId = table.id;
  });

  it("appends a second batch onto the numbers already in use", async () => {
    const service = createService(testDb);
    await service.createSeatsForTable(tableId, 2);

    const appended = await service.createSeatsForTable(tableId, 2);

    expect(appended.map((seat) => seat.seatNumber)).toEqual(["03", "04"]);
    const all = await testDb.drizzle
      .select({ seatNumber: seats.seatNumber })
      .from(seats)
      .where(eq(seats.tableId, tableId))
      .orderBy(asc(seats.seatNumber));
    expect(all.map((seat) => seat.seatNumber)).toEqual([
      "01",
      "02",
      "03",
      "04",
    ]);
  });

  it("keeps counting past a soft-deleted seat instead of reusing its number", async () => {
    const service = createService(testDb);
    await service.createSeatsForTable(tableId, 2);
    await testDb.drizzle
      .update(seats)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(seats.tableId, tableId));

    const replacement = await service.createSeatsForTable(tableId, 2);

    // seats(table_id, seat_number) is UNIQUE and does not exclude soft-deleted
    // rows, so re-minting 01/02 would fail the insert outright. It would also
    // hand two different seats the same label a customer reads off a sticker.
    expect(replacement.map((seat) => seat.seatNumber)).toEqual(["03", "04"]);
  });

  it("rewrites the table's seat count as seats are added and retired", async () => {
    const service = createService(testDb);
    const seatCountNow = async () => {
      const [row] = await testDb.drizzle
        .select({ seatCount: tables.seatCount })
        .from(tables)
        .where(eq(tables.id, tableId));
      return row.seatCount;
    };

    const created = await service.createSeatsForTable(tableId, 3);
    expect(await seatCountNow()).toBe(3);

    await service.deleteSeat(created[0].id);
    expect(await seatCountNow()).toBe(2);
  });

  it("requires one unique custom number per requested seat", async () => {
    const service = createService(testDb);

    await expect(
      service.createSeatsForTable(tableId, 2, {
        numberingStyle: "custom",
      }),
    ).rejects.toThrow("Custom seat numbers must match seat count");
    await expect(
      service.createSeatsForTable(tableId, 2, {
        numberingStyle: "custom",
        customNumbers: ["Window", "Window"],
      }),
    ).rejects.toThrow("Custom seat numbers must be unique");
  });

  it("creates a seat-mode table and its configured seats through one service call", async () => {
    const service = createTableService(testDb);

    const createdTable = await service.createTable({
      restaurantId,
      number: "B1",
      capacity: 4,
      qrMode: "seat",
      seatCount: 4,
      seatNumberingStyle: "alphabetic",
    });
    const createdSeats = await testDb.drizzle
      .select({ seatNumber: seats.seatNumber })
      .from(seats)
      .where(eq(seats.tableId, createdTable.id))
      .orderBy(asc(seats.seatNumber));
    const listedTables = await service.getRestaurantTables(restaurantId);

    expect(createdTable).toMatchObject({
      qrMode: "seat",
      seatCount: 4,
      seatNumberingStyle: "alphabetic",
    });
    expect(createdSeats).toEqual([
      { seatNumber: "A" },
      { seatNumber: "B" },
      { seatNumber: "C" },
      { seatNumber: "D" },
    ]);
    expect(listedTables.tables).toContainEqual(
      expect.objectContaining({
        id: createdTable.id,
        qrMode: "seat",
        seatCount: 4,
        seatNumberingStyle: "alphabetic",
      }),
    );
  });

  it("reports seat-mode table creation as successful when post-insert seat creation fails", async () => {
    const service = createTableService(testDb);
    // Omitting QR_SIGNING_KEY used to be the trigger, but createTable now
    // rejects an invalid key before the INSERT (covered in
    // qr-signing-v2.test.ts). The path under test is a seat insert that fails
    // *after* the table row has committed, so fail that directly instead of
    // relying on a config error that no longer reaches it.
    const createSeats = vi
      .spyOn(SeatService.prototype, "createSeatsForTable")
      .mockRejectedValueOnce(new Error("seat insert failed"));

    const createdTable = await service.createTable({
      restaurantId,
      number: "B1-PARTIAL",
      capacity: 4,
      qrMode: "seat",
      seatCount: 4,
      seatNumberingStyle: "numeric",
    });
    const persistedTable = await testDb.drizzle
      .select({
        id: tables.id,
        qrCode: tables.qrCode,
        qrMode: tables.qrMode,
        seatCount: tables.seatCount,
      })
      .from(tables)
      .where(eq(tables.id, createdTable.id))
      .get();
    const createdSeats = await testDb.drizzle
      .select({ id: seats.id })
      .from(seats)
      .where(eq(seats.tableId, createdTable.id));

    expect(createSeats).toHaveBeenCalledOnce();
    createSeats.mockRestore();

    expect(createdTable).toMatchObject({
      id: persistedTable?.id,
      qrMode: "seat",
      seatCount: 4,
      warnings: [
        {
          code: "SEATS_NOT_CREATED",
          message:
            "Table was created, but seats were not created. Use batch seat creation to repair this table.",
        },
      ],
    });
    // Only the seats failed: the table row is complete, and what it returns
    // must be what it stored or callers print a QR the DB will not verify.
    expect(createdTable.qrCode).not.toMatch(/^pending:/);
    expect(persistedTable).toMatchObject({
      qrMode: "seat",
      seatCount: 4,
      qrCode: createdTable.qrCode,
    });
    expect(createdSeats).toHaveLength(0);
  });

  it("creates a table with a v2 QR and never persists a legacy one", async () => {
    const service = createTableService(testDb);

    const createdTable = await service.createTable({
      restaurantId,
      number: "V2-1",
      capacity: 4,
    });

    const [row] = await testDb.drizzle
      .select({ qrCode: tables.qrCode, qrCodeVersion: tables.qrCodeVersion })
      .from(tables)
      .where(eq(tables.id, createdTable.id));

    // createTable inserts a placeholder before it can sign (the signature binds
    // the auto-increment id), so assert the row does not keep it, and that what
    // it does keep is v2 rather than a legacy signature that the phase 3 cutoff
    // would later reject.
    expect(row.qrCode).not.toMatch(/^pending:/);
    expect(row.qrCode).toContain("f=2");
    expect(row.qrCode).toContain(`d=${createdTable.id}`);
    expect(row.qrCode).toContain("n=V2-1");
    expect(row.qrCodeVersion).toBe(1);
    // The returned object must agree with what was stored, or callers print a
    // QR that differs from the one the DB will verify.
    expect(createdTable.qrCode).toBe(row.qrCode);
  });

  it("switches an existing table to seat mode when table settings are updated", async () => {
    const service = createTableService(testDb);
    const createdTable = await service.createTable({
      restaurantId,
      number: "B2",
      capacity: 2,
    });

    const updatedTable = await service.updateTable(createdTable.id, {
      qrMode: "seat",
      seatCount: 2,
      seatNumberingStyle: "numeric",
    });
    const createdSeats = await testDb.drizzle
      .select({ seatNumber: seats.seatNumber })
      .from(seats)
      .where(eq(seats.tableId, createdTable.id))
      .orderBy(asc(seats.seatNumber));

    expect(updatedTable).toMatchObject({ qrMode: "seat", seatCount: 2 });
    expect(createdSeats).toEqual([{ seatNumber: "01" }, { seatNumber: "02" }]);
  });

  it("re-signs a renamed table's QR at the same version", async () => {
    const service = createTableService(testDb);
    const createdTable = await service.createTable({
      restaurantId,
      number: "R1",
      capacity: 2,
    });

    await service.updateTable(createdTable.id, { number: "R9" });
    const [row] = await testDb.drizzle
      .select({ qrCode: tables.qrCode, qrCodeVersion: tables.qrCodeVersion })
      .from(tables)
      .where(eq(tables.id, createdTable.id));

    // Same version keeps the printed sticker valid (verification keys on id +
    // version); the stored code carries the new number for the next print.
    expect(row.qrCodeVersion).toBe(1);
    expect(row.qrCode).toContain("n=R9");
    expect(row.qrCode).not.toBe(createdTable.qrCode);
  });

  it("reissues a renumbered seat's QR at the next version", async () => {
    const service = createService(testDb);
    await service.createSeatsForTable(tableId, 1);
    const [seat] = await testDb.drizzle
      .select({ id: seats.id, qrCodeVersion: seats.qrCodeVersion })
      .from(seats)
      .where(eq(seats.tableId, tableId));

    await service.updateSeat(seat.id, { seatNumber: "X1" });
    const [row] = await testDb.drizzle
      .select({ qrCode: seats.qrCode, qrCodeVersion: seats.qrCodeVersion })
      .from(seats)
      .where(eq(seats.id, seat.id));

    // The seat number is the seat's identity in its QR, so the old code must
    // stop verifying and the stored one must name the new number.
    expect(row.qrCodeVersion).toBe((seat.qrCodeVersion ?? 0) + 1);
    expect(row.qrCode).toContain("n=X1");
  });

  it("enforces unique seat numbers at the database boundary", async () => {
    const service = createService(testDb);
    await service.createSeatsForTable(tableId, 1);

    await expect(
      testDb.drizzle.insert(seats).values({
        tableId,
        seatNumber: "01",
        qrCode: "unique-duplicate-test-qr",
      }),
    ).rejects.toThrow();

    const persistedSeats = await testDb.drizzle
      .select({ id: seats.id })
      .from(seats)
      .where(eq(seats.tableId, tableId));
    expect(persistedSeats).toHaveLength(1);
  });

  it("allows only the first caller to occupy an available seat", async () => {
    const service = createService(testDb);
    const [createdSeat] = await service.createSeatsForTable(tableId, 1);
    await testDb.drizzle.insert(orders).values({
      id: "seat-order-1",
      restaurantId,
      tableId,
      orderNumber: "SEAT-ORDER-1",
    });
    await testDb.drizzle.insert(orders).values({
      id: "seat-order-2",
      restaurantId,
      tableId,
      orderNumber: "SEAT-ORDER-2",
    });

    await expect(
      service.occupySeat(createdSeat.id, "seat-order-1", "first"),
    ).resolves.toBe(true);
    await expect(
      service.occupySeat(createdSeat.id, "seat-order-2", "second"),
    ).resolves.toBe(false);

    const persistedSeat = await testDb.drizzle
      .select({
        currentOrderId: seats.currentOrderId,
        occupiedBy: seats.occupiedBy,
      })
      .from(seats)
      .where(eq(seats.id, createdSeat.id))
      .get();
    expect(persistedSeat).toEqual({
      currentOrderId: "seat-order-1",
      occupiedBy: "first",
    });
  });

  it("allows only the first caller to occupy an available table", async () => {
    const service = createTableService(testDb);

    await expect(service.occupyTable(tableId, null, "first")).resolves.toBe(
      true,
    );
    await expect(service.occupyTable(tableId, null, "second")).resolves.toBe(
      false,
    );

    const persistedTable = await testDb.drizzle
      .select({ occupiedBy: tables.occupiedBy })
      .from(tables)
      .where(eq(tables.id, tableId))
      .get();
    expect(persistedTable?.occupiedBy).toBe("first");
  });

  it("writes deletedAt when a table is soft-deleted", async () => {
    const service = createTableService(testDb);

    await expect(service.deleteTable(tableId)).resolves.toBe(true);

    const persistedTable = await testDb.drizzle
      .select({ isActive: tables.isActive, deletedAt: tables.deletedAt })
      .from(tables)
      .where(eq(tables.id, tableId))
      .get();

    expect(persistedTable?.isActive).toBe(false);
    expect(persistedTable?.deletedAt).toBeInstanceOf(Date);
  });

  it("soft-deletes seats when a seat-mode table is deleted", async () => {
    const service = createTableService(testDb);
    await createService(testDb).createSeatsForTable(tableId, 2, {
      numberingStyle: "numeric",
    });

    await expect(service.deleteTable(tableId)).resolves.toBe(true);

    const persistedSeats = await testDb.drizzle
      .select({ isActive: seats.isActive, deletedAt: seats.deletedAt })
      .from(seats)
      .where(eq(seats.tableId, tableId))
      .orderBy(asc(seats.seatNumber));

    expect(persistedSeats).toHaveLength(2);
    for (const seat of persistedSeats) {
      expect(seat.isActive).toBe(false);
      expect(seat.deletedAt).toBeInstanceOf(Date);
    }

    const listedSeats = await createService(testDb).getSeatsByTableId(tableId);
    expect(listedSeats.seats).toEqual([]);
    expect(listedSeats.total).toBe(0);
  });

  it("hides soft-deleted tables from admin list and detail lookups", async () => {
    const service = createTableService(testDb);

    await testDb.drizzle
      .update(tables)
      .set({
        deletedAt: new Date("2026-07-30T00:00:00.000Z"),
        updatedAt: new Date("2026-07-30T00:00:00.000Z"),
      })
      .where(eq(tables.id, tableId));

    const listedTables = await service.getRestaurantTables(restaurantId);
    await expect(service.getTableById(tableId)).resolves.toBeNull();

    expect(listedTables.tables).toEqual([]);
    expect(listedTables.total).toBe(0);
  });

  it("increments usage once when an occupied seat is released", async () => {
    const service = createService(testDb);
    const [createdSeat] = await service.createSeatsForTable(tableId, 1);
    await testDb.drizzle
      .update(seats)
      .set({ isOccupied: true, totalUsage: 4 })
      .where(eq(seats.id, createdSeat.id));

    await expect(service.releaseSeat(createdSeat.id)).resolves.toBe(true);
    await expect(service.releaseSeat(createdSeat.id)).resolves.toBe(false);

    const persistedSeat = await testDb.drizzle
      .select({
        isOccupied: seats.isOccupied,
        totalUsage: seats.totalUsage,
      })
      .from(seats)
      .where(eq(seats.id, createdSeat.id))
      .get();
    expect(persistedSeat).toEqual({ isOccupied: false, totalUsage: 5 });
  });

  it("hides soft-deleted and inactive seats from public lookups", async () => {
    const service = createService(testDb);
    const [deletedSeat, inactiveSeat] = await service.createSeatsForTable(
      tableId,
      2,
    );

    await expect(service.deleteSeat(deletedSeat.id)).resolves.toBe(true);
    await service.updateSeat(inactiveSeat.id, { isActive: false });

    const deletedRow = await testDb.drizzle
      .select({
        isActive: seats.isActive,
        deletedAt: seats.deletedAt,
      })
      .from(seats)
      .where(eq(seats.id, deletedSeat.id))
      .get();
    expect(deletedRow?.isActive).toBe(false);
    expect(deletedRow?.deletedAt).toBeInstanceOf(Date);

    await expect(service.getSeatById(deletedSeat.id)).resolves.toBeUndefined();
    await expect(
      service.getSeatByQRCode(deletedSeat.qrCode),
    ).resolves.toBeUndefined();
    await expect(
      service.getSeatByQRCode(inactiveSeat.qrCode),
    ).resolves.toBeUndefined();

    const listedSeats = await service.getSeatsByTableId(tableId);
    expect(listedSeats.seats).toEqual([
      expect.objectContaining({ id: inactiveSeat.id, isActive: false }),
    ]);
    expect(listedSeats.total).toBe(1);

    const stats = await service.getSeatStats(tableId);
    expect(stats).toMatchObject({
      totalSeats: 1,
      occupiedSeats: 0,
      availableSeats: 0,
      inactiveSeats: 1,
    });
  });
});

function createService(testDb: TestDatabase) {
  return new SeatService(testDb.bindings.DB, {
    JWT_SECRET: "test",
    QR_SIGNING_KEY: signingKey,
    CLIENT_BASE_URL: "https://example.test",
  });
}

function createTableService(testDb: TestDatabase) {
  return new TableService(testDb.bindings.DB, {
    JWT_SECRET: "test",
    QR_SIGNING_KEY: signingKey,
    CLIENT_BASE_URL: "https://example.test",
  });
}

describe("SeatService.batchGenerateSeatQRCodes", () => {
  let testDb: TestDatabase;
  let tableId: number;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await testDb.drizzle.insert(restaurants).values({
      id: restaurantId,
      name: "Seat Service Restaurant",
      type: "restaurant",
      category: "casual",
      address: "1 Seat St",
      district: "Central",
      city: "Taipei",
      phone: "0200000000",
      settings: {},
      isAvailable: true,
      isActive: true,
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    } as never);
    const [table] = await testDb.drizzle
      .insert(tables)
      .values({
        restaurantId,
        number: "A1",
        capacity: 8,
        qrCode: "table-qr-a1",
        qrMode: "seat",
        seatCount: 6,
        createdAt: new Date("2026-07-29T00:00:00.000Z"),
        updatedAt: new Date("2026-07-29T00:00:00.000Z"),
      })
      .returning({ id: tables.id });
    tableId = table.id;
  });

  it("advances every seat together, with each QR bound to its own seat", async () => {
    const service = createService(testDb);
    await service.createSeatsForTable(tableId, 6);

    const before = await testDb.drizzle
      .select({
        id: seats.id,
        seatNumber: seats.seatNumber,
        qrCode: seats.qrCode,
        qrCodeVersion: seats.qrCodeVersion,
      })
      .from(seats)
      .where(eq(seats.tableId, tableId))
      .orderBy(asc(seats.seatNumber));
    expect(before).toHaveLength(6);

    const result = await service.batchGenerateSeatQRCodes(tableId);
    expect(result.success).toBe(true);
    expect(result.qrCodes).toHaveLength(6);

    const after = await testDb.drizzle
      .select({
        id: seats.id,
        seatNumber: seats.seatNumber,
        qrCode: seats.qrCode,
        qrCodeVersion: seats.qrCodeVersion,
      })
      .from(seats)
      .where(eq(seats.tableId, tableId))
      .orderBy(asc(seats.seatNumber));

    // Every row moved. A partial write would leave a mix of versions, which for
    // a printed sticker means some seats scan and some do not.
    for (const [i, row] of after.entries()) {
      expect(row.qrCodeVersion, `seat ${row.seatNumber} version`).toBe(
        (before[i].qrCodeVersion ?? 0) + 1,
      );
      expect(row.qrCode, `seat ${row.seatNumber} qr`).not.toBe(
        before[i].qrCode,
      );
      // v2 payload carrying this table's id, and this seat's number
      expect(row.qrCode).toContain(`d=${tableId}`);
      expect(row.qrCode).toContain("f=2");
      expect(row.qrCode).toContain(`n=${row.seatNumber}`);
      expect(row.qrCode).toContain(`v=${row.qrCodeVersion}`);
    }

    // No two seats share a signature, which was the original #73 defect.
    const signatures = after.map((r) => r.qrCode?.split("sig=")[1]);
    expect(new Set(signatures).size).toBe(after.length);
  });

  it("is a no-op for a table with no seats rather than an error", async () => {
    const service = createService(testDb);
    const result = await service.batchGenerateSeatQRCodes(tableId);
    expect(result).toEqual({ success: true, qrCodes: [] });
  });
});

describe("SeatService two-phase QR rotation", () => {
  let testDb: TestDatabase;
  let tableId: number;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await testDb.drizzle.insert(restaurants).values({
      id: restaurantId,
      name: "Seat Rotation Restaurant",
      type: "restaurant",
      category: "casual",
      address: "1 Seat Rotation St",
      district: "Central",
      city: "Taipei",
      phone: "0200000000",
      settings: {},
      isAvailable: true,
      isActive: true,
      createdAt: new Date("2026-07-31T00:00:00.000Z"),
      updatedAt: new Date("2026-07-31T00:00:00.000Z"),
    } as never);
    const [table] = await testDb.drizzle
      .insert(tables)
      .values({
        restaurantId,
        number: "S1",
        capacity: 4,
        qrCode: "table-qr-s1",
        qrMode: "seat",
        seatCount: 2,
        createdAt: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-31T00:00:00.000Z"),
      })
      .returning({ id: tables.id });
    tableId = table.id;
    await createService(testDb).createSeatsForTable(tableId, 2);
  }, 60_000);

  async function readSeats() {
    return testDb.drizzle
      .select({
        id: seats.id,
        seatNumber: seats.seatNumber,
        qrCode: seats.qrCode,
        qrCodeVersion: seats.qrCodeVersion,
        pendingQrCode: seats.pendingQrCode,
        pendingQrCodeVersion: seats.pendingQrCodeVersion,
        pendingQrPreparedAt: seats.pendingQrPreparedAt,
      })
      .from(seats)
      .where(eq(seats.tableId, tableId))
      .orderBy(asc(seats.seatNumber));
  }

  it("prepares a seat without touching its live QR code", async () => {
    const service = createService(testDb);
    const [seat] = await readSeats();

    const prepared = await service.prepareSeatQRCodeRotation(seat.id);
    const second = await service.prepareSeatQRCodeRotation(seat.id);
    const [row] = await readSeats();

    expect(prepared.success).toBe(true);
    expect(second.qrCode).toBe(prepared.qrCode);
    expect(row.qrCode).toBe(seat.qrCode);
    expect(row.qrCodeVersion).toBe(1);
    expect(row.pendingQrCode).toBe(prepared.qrCode);
    expect(row.pendingQrCodeVersion).toBe(2);
    expect(row.pendingQrPreparedAt).toBeInstanceOf(Date);
  });

  it("activates and discards prepared seat QR codes", async () => {
    const service = createService(testDb);
    const [firstSeat, secondSeat] = await readSeats();

    const prepared = await service.prepareSeatQRCodeRotation(firstSeat.id);
    await expect(
      service.activateSeatQRCodeRotation(firstSeat.id),
    ).resolves.toEqual({ success: true, qrCode: prepared.qrCode });
    await expect(
      service.activateSeatQRCodeRotation(secondSeat.id),
    ).resolves.toEqual({
      success: false,
      error: "No prepared QR code to activate",
    });

    await service.prepareSeatQRCodeRotation(secondSeat.id);
    await service.discardSeatQRCodeRotation(secondSeat.id);

    const [activated, discarded] = await readSeats();
    expect(activated.qrCode).toBe(prepared.qrCode);
    expect(activated.qrCodeVersion).toBe(2);
    expect(activated.pendingQrCode).toBeNull();
    expect(discarded.qrCode).toBe(secondSeat.qrCode);
    expect(discarded.qrCodeVersion).toBe(1);
    expect(discarded.pendingQrCode).toBeNull();
  });

  it("batch-prepares all seats without invalidating live stickers", async () => {
    const service = createService(testDb);
    const before = await readSeats();

    const prepared = await service.batchPrepareSeatQRCodeRotations(tableId);
    const second = await service.batchPrepareSeatQRCodeRotations(tableId);
    const after = await readSeats();

    expect(prepared.success).toBe(true);
    expect(prepared.qrCodes).toHaveLength(2);
    expect(second.qrCodes).toEqual(prepared.qrCodes);
    for (const [i, row] of after.entries()) {
      expect(row.qrCode).toBe(before[i].qrCode);
      expect(row.qrCodeVersion).toBe(1);
      expect(row.pendingQrCode).toBe(prepared.qrCodes?.[i].qrCode);
      expect(row.pendingQrCodeVersion).toBe(2);
    }
  });

  it("clears a prepared rotation when immediate regeneration is used", async () => {
    const service = createService(testDb);
    const [seat] = await readSeats();
    await service.prepareSeatQRCodeRotation(seat.id);

    const regenerated = await service.regenerateSeatQRCode(seat.id);
    const [row] = await readSeats();

    expect(regenerated.success).toBe(true);
    expect(row.qrCode).toBe(regenerated.qrCode);
    expect(row.qrCodeVersion).toBe(2);
    expect(row.pendingQrCode).toBeNull();
    expect(row.pendingQrCodeVersion).toBeNull();
    expect(row.pendingQrPreparedAt).toBeNull();
  });

  it("re-signs a renumber at the live version when a regeneration lands mid-write", async () => {
    const service = createService(testDb);
    const [seat] = await readSeats();
    const internals = service as unknown as {
      generateSeatQRCode: (...args: unknown[]) => Promise<string>;
    };
    const original = internals.generateSeatQRCode.bind(service);
    let interleaved = false;
    const spy = vi
      .spyOn(internals, "generateSeatQRCode")
      .mockImplementation(async (...args) => {
        if (!interleaved) {
          interleaved = true;
          // A regenerateSeatQRCode that read the same version commits first.
          await testDb.drizzle
            .update(seats)
            .set({ qrCode: "concurrent-regeneration", qrCodeVersion: 2 })
            .where(eq(seats.id, seat.id));
        }
        return original(...args);
      });

    await service.updateSeat(seat.id, { seatNumber: "X1" });
    const [row] = (await readSeats()).filter((r) => r.id === seat.id);

    // The first write was refused by the version CAS and retried on v2.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(row.seatNumber).toBe("X1");
    expect(row.qrCodeVersion).toBe(3);
    const payload = parseSignedQRUrl(row.qrCode ?? "");
    expect(payload).toMatchObject({ identifier: "X1", version: 3 });
    await expect(
      verifyQRSignature(payload!, payload!.signature, signingKey),
    ).resolves.toBe(true);
  });

  it("refuses a regeneration whose version was advanced by a renumber", async () => {
    const service = createService(testDb);
    const [seat] = await readSeats();
    const internals = service as unknown as {
      generateSeatQRCode: (...args: unknown[]) => Promise<string>;
    };
    const original = internals.generateSeatQRCode.bind(service);
    vi.spyOn(internals, "generateSeatQRCode").mockImplementationOnce(
      async (...args) => {
        // A renumber commits between the regeneration's read and its write.
        await service.updateSeat(seat.id, { seatNumber: "X2" });
        return original(...args);
      },
    );

    const regenerated = await service.regenerateSeatQRCode(seat.id);
    const [row] = (await readSeats()).filter((r) => r.id === seat.id);

    expect(regenerated.success).toBe(false);
    expect(row.seatNumber).toBe("X2");
    expect(row.qrCodeVersion).toBe(2);
    expect(parseSignedQRUrl(row.qrCode ?? "")).toMatchObject({
      identifier: "X2",
      version: 2,
    });
  });

  it("refuses to activate a prepared seat code after a renumber", async () => {
    const service = createService(testDb);
    const [seat] = await readSeats();
    const prepared = await service.prepareSeatQRCodeRotation(seat.id);
    await service.updateSeat(seat.id, { seatNumber: "X3" });
    // Simulate an activation that read the pending columns before the
    // renumber cleared them.
    await testDb.drizzle
      .update(seats)
      .set({
        pendingQrCode: prepared.qrCode,
        pendingQrCodeVersion: 2,
        pendingQrPreparedAt: new Date(),
      })
      .where(eq(seats.id, seat.id));

    await expect(service.activateSeatQRCodeRotation(seat.id)).resolves.toEqual({
      success: false,
      error: "Prepared QR code rotation is no longer current",
    });
    const [row] = (await readSeats()).filter((r) => r.id === seat.id);
    expect(parseSignedQRUrl(row.qrCode ?? "")).toMatchObject({
      identifier: "X3",
      version: 2,
    });
  });

  it("retries a batch-regenerated seat that was renumbered mid-batch", async () => {
    const service = createService(testDb);
    const [first, second] = await readSeats();
    const internals = service as unknown as {
      generateSeatQRCode: (...args: unknown[]) => Promise<string>;
    };
    const original = internals.generateSeatQRCode.bind(service);
    let interleaved = false;
    vi.spyOn(internals, "generateSeatQRCode").mockImplementation(
      async (...args) => {
        if (!interleaved) {
          interleaved = true;
          // A renumber of the first seat commits while the batch is signing.
          await service.updateSeat(first.id, { seatNumber: "X9" });
        }
        return original(...args);
      },
    );

    const result = await service.batchGenerateSeatQRCodes(tableId);
    const rows = await readSeats();
    const renumbered = rows.find((r) => r.id === first.id)!;
    const untouched = rows.find((r) => r.id === second.id)!;

    expect(result.success).toBe(true);
    expect(result.failed).toBeUndefined();
    // The batched write for the first seat lost its CAS (version 1 -> 2 under
    // it) and was retried on its own at version 3 with the new number.
    expect(renumbered.qrCodeVersion).toBe(3);
    const payload = parseSignedQRUrl(renumbered.qrCode ?? "");
    expect(payload).toMatchObject({ identifier: "X9", version: 3 });
    await expect(
      verifyQRSignature(payload!, payload!.signature, signingKey),
    ).resolves.toBe(true);
    expect(untouched.qrCodeVersion).toBe(2);
    expect(result.qrCodes).toEqual(
      expect.arrayContaining([
        { seatId: first.id, seatNumber: "X9", qrCode: renumbered.qrCode },
        { seatId: second.id, seatNumber: "02", qrCode: untouched.qrCode },
      ]),
    );
  });

  it("does not let a stale prepare overwrite a pending code another prepare parked", async () => {
    const service = createService(testDb);
    const [seat] = await readSeats();
    const internals = service as unknown as {
      generateSeatQRCode: (...args: unknown[]) => Promise<string>;
    };
    const original = internals.generateSeatQRCode.bind(service);
    let concurrent: { qrCode?: string } | undefined;
    vi.spyOn(internals, "generateSeatQRCode").mockImplementation(
      async (...args) => {
        if (!concurrent) {
          concurrent = {};
          concurrent = await service.prepareSeatQRCodeRotation(seat.id);
        }
        return original(...args);
      },
    );

    const stale = await service.prepareSeatQRCodeRotation(seat.id);
    const [row] = (await readSeats()).filter((r) => r.id === seat.id);

    // The first parked code may already be printed; the stale prepare must
    // hand that one back rather than replace it.
    expect(concurrent?.qrCode).toBeDefined();
    expect(row.pendingQrCode).toBe(concurrent?.qrCode);
    expect(stale).toEqual({ success: true, qrCode: concurrent?.qrCode });
  });
});

describe("TableService two-phase QR rotation", () => {
  let testDb: TestDatabase;
  let tableId: number;
  let liveQrBefore: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await testDb.drizzle.insert(restaurants).values({
      id: restaurantId,
      name: "Rotation Restaurant",
      type: "restaurant",
      category: "casual",
      address: "1 Rotation St",
      district: "Central",
      city: "Taipei",
      phone: "0200000000",
      settings: {},
      isAvailable: true,
      isActive: true,
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T00:00:00.000Z"),
    } as never);
    const created = await createTableService(testDb).createTable({
      restaurantId,
      number: "R1",
      capacity: 4,
    });
    tableId = created.id;
    liveQrBefore = created.qrCode;
    // truncateAll + a full createTable (sign, insert, upgrade) runs close to
    // vitest's 10s hook default against real D1; give it room rather than let
    // the first run of the block flake.
  }, 60_000);

  async function readRow() {
    const [row] = await testDb.drizzle
      .select({
        qrCode: tables.qrCode,
        qrCodeVersion: tables.qrCodeVersion,
        pendingQrCode: tables.pendingQrCode,
        pendingQrCodeVersion: tables.pendingQrCodeVersion,
        pendingQrPreparedAt: tables.pendingQrPreparedAt,
      })
      .from(tables)
      .where(eq(tables.id, tableId));
    return row;
  }

  it("leaves the live code untouched while a rotation is prepared", async () => {
    const service = createTableService(testDb);
    const prepared = await service.prepareQRCodeRotation(tableId);

    expect(prepared.success).toBe(true);
    const row = await readRow();
    // The whole point: the sticker already on the table keeps working while its
    // replacement is being printed.
    expect(row.qrCode).toBe(liveQrBefore);
    expect(row.qrCodeVersion).toBe(1);
    expect(row.pendingQrCode).toBe(prepared.qrCode);
    expect(row.pendingQrCodeVersion).toBe(2);
    expect(row.pendingQrPreparedAt).toBeInstanceOf(Date);
    expect(row.pendingQrCode).not.toBe(row.qrCode);
    expect(row.pendingQrCode).toContain(`d=${tableId}`);
    expect(row.pendingQrCode).toContain("v=2");
  });

  it("is idempotent, so re-preparing cannot orphan a printed sticker", async () => {
    const service = createTableService(testDb);
    const first = await service.prepareQRCodeRotation(tableId);
    const second = await service.prepareQRCodeRotation(tableId);

    expect(second.qrCode).toBe(first.qrCode);
    expect((await readRow()).pendingQrCodeVersion).toBe(2);
  });

  it("promotes the prepared code on activation and clears the staging columns", async () => {
    const service = createTableService(testDb);
    const prepared = await service.prepareQRCodeRotation(tableId);
    const activated = await service.activateQRCodeRotation(tableId);

    expect(activated).toEqual({ success: true, qrCode: prepared.qrCode });
    const row = await readRow();
    expect(row.qrCode).toBe(prepared.qrCode);
    expect(row.qrCodeVersion).toBe(2);
    expect(row.pendingQrCode).toBeNull();
    expect(row.pendingQrCodeVersion).toBeNull();
    expect(row.pendingQrPreparedAt).toBeNull();
  });

  it("refuses to activate when nothing was prepared", async () => {
    const service = createTableService(testDb);
    await expect(service.activateQRCodeRotation(tableId)).resolves.toEqual({
      success: false,
      error: "No prepared QR code to activate",
    });
    expect((await readRow()).qrCode).toBe(liveQrBefore);
  });

  it("consumes a discarded rotation version so its sticker can never return", async () => {
    const service = createTableService(testDb);
    await service.prepareQRCodeRotation(tableId);
    await service.discardQRCodeRotation(tableId);

    const row = await readRow();
    expect(row.qrCode).toBe(liveQrBefore);
    expect(row.qrCodeVersion).toBe(2);
    expect(row.pendingQrCode).toBeNull();
  });

  it("allows a fresh rotation after one is discarded", async () => {
    const service = createTableService(testDb);
    const first = await service.prepareQRCodeRotation(tableId);
    await service.discardQRCodeRotation(tableId);
    const second = await service.prepareQRCodeRotation(tableId);

    expect(second.success).toBe(true);
    // The discarded sticker used version 2, so the next prepared code is 3.
    expect((await readRow()).pendingQrCodeVersion).toBe(3);
    expect(second.qrCode).not.toBe(first.qrCode);
  });

  it("does not activate a prepared code after immediate regeneration", async () => {
    const service = createTableService(testDb);
    await service.prepareQRCodeRotation(tableId);
    const regenerated = await service.regenerateQRCode(tableId);
    const activated = await service.activateQRCodeRotation(tableId);

    expect(regenerated.success).toBe(true);
    expect(activated).toEqual({
      success: false,
      error: "No prepared QR code to activate",
    });
    expect((await readRow()).qrCodeVersion).toBe(2);
  });

  it("rejects a stale prepared version without downgrading the live QR", async () => {
    const service = createTableService(testDb);
    const prepared = await service.prepareQRCodeRotation(tableId);
    const regenerated = await service.regenerateQRCode(tableId);

    await testDb.drizzle
      .update(tables)
      .set({
        pendingQrCode: prepared.qrCode,
        pendingQrCodeVersion: 2,
        pendingQrPreparedAt: new Date(),
      })
      .where(eq(tables.id, tableId));

    await expect(service.activateQRCodeRotation(tableId)).resolves.toEqual({
      success: false,
      error: "Prepared QR code rotation is no longer current",
    });
    const row = await readRow();
    expect(row.qrCode).toBe(regenerated.qrCode);
    expect(row.qrCodeVersion).toBe(2);
  });

  it("re-signs a rename at the live version when a regeneration lands mid-write", async () => {
    const service = createTableService(testDb);
    const internals = service as unknown as {
      generateQRCodeData: (...args: unknown[]) => Promise<string>;
    };
    const original = internals.generateQRCodeData.bind(service);
    let regenerated: { qrCode?: string } | undefined;
    const spy = vi
      .spyOn(internals, "generateQRCodeData")
      .mockImplementation(async (...args) => {
        if (!regenerated) {
          regenerated = {};
          // regenerateQRCode commits between the rename's read and write.
          regenerated = await service.regenerateQRCode(tableId);
        }
        return original(...args);
      });

    await service.updateTable(tableId, { number: "R9" });
    const row = await readRow();

    // rename sign (v1), regenerate sign (v2), rename retry (v2)
    expect(spy).toHaveBeenCalledTimes(3);
    expect(row.qrCodeVersion).toBe(2);
    const payload = parseSignedQRUrl(row.qrCode ?? "");
    expect(payload).toMatchObject({ identifier: "R9", version: 2 });
    await expect(
      verifyQRSignature(payload!, payload!.signature, signingKey),
    ).resolves.toBe(true);
  });

  it("gives up with a conflict when the version keeps moving", async () => {
    const service = createTableService(testDb);
    const internals = service as unknown as {
      generateQRCodeData: (...args: unknown[]) => Promise<string>;
    };
    const original = internals.generateQRCodeData.bind(service);
    vi.spyOn(internals, "generateQRCodeData").mockImplementation(
      async (...args) => {
        await testDb.drizzle
          .update(tables)
          .set({ qrCodeVersion: sql`${tables.qrCodeVersion} + 1` })
          .where(eq(tables.id, tableId));
        return original(...args);
      },
    );

    await expect(
      service.updateTable(tableId, { number: "R9" }),
    ).rejects.toMatchObject({ status: 409, code: "TABLE_QR_VERSION_CONFLICT" });
    const [row] = await testDb.drizzle
      .select({ number: tables.number })
      .from(tables)
      .where(eq(tables.id, tableId));
    expect(row.number).toBe("R1");
  });

  it("prepares off the live version when a regeneration lands mid-prepare", async () => {
    const service = createTableService(testDb);
    const internals = service as unknown as {
      generateQRCodeData: (...args: unknown[]) => Promise<string>;
    };
    const original = internals.generateQRCodeData.bind(service);
    let regenerated: { success?: boolean } | undefined;
    vi.spyOn(internals, "generateQRCodeData").mockImplementation(
      async (...args) => {
        if (!regenerated) {
          regenerated = {};
          regenerated = await service.regenerateQRCode(tableId);
        }
        return original(...args);
      },
    );

    const prepared = await service.prepareQRCodeRotation(tableId);
    const row = await readRow();

    expect(regenerated?.success).toBe(true);
    expect(row.qrCodeVersion).toBe(2);
    // Parked at v2 it would equal the live version and never activate.
    expect(row.pendingQrCodeVersion).toBe(3);
    expect(row.pendingQrCode).toBe(prepared.qrCode);
    expect(parseSignedQRUrl(row.pendingQrCode ?? "")).toMatchObject({
      identifier: "R1",
      version: 3,
    });
    await expect(service.activateQRCodeRotation(tableId)).resolves.toEqual({
      success: true,
      qrCode: prepared.qrCode,
    });
  });

  it("retries a bulk-regenerated table that was renamed mid-batch", async () => {
    const service = createTableService(testDb);
    const internals = service as unknown as {
      generateQRCodeData: (...args: unknown[]) => Promise<string>;
    };
    const original = internals.generateQRCodeData.bind(service);
    let renamed = false;
    vi.spyOn(internals, "generateQRCodeData").mockImplementation(
      async (...args) => {
        if (!renamed) {
          renamed = true;
          await service.updateTable(tableId, { number: "R9" });
        }
        return original(...args);
      },
    );

    const result = await service.generateBulkQRCodes(restaurantId, [tableId]);
    const row = await readRow();

    expect(result.success).toBe(true);
    expect(result.failed).toBeUndefined();
    expect(row.qrCodeVersion).toBe(2);
    expect(parseSignedQRUrl(row.qrCode ?? "")).toMatchObject({
      identifier: "R9",
      version: 2,
    });
    expect(result.qrCodes).toEqual([
      { tableId, tableNumber: "R9", qrCode: row.qrCode },
    ]);
  });
});
