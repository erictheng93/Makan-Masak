import { beforeEach, describe, expect, it, vi } from "vitest";
import { cashMovements, cashShifts } from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { ShiftService } from "./ShiftService";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

const uuidMocks = vi.hoisted(() => ({ generateUUID: vi.fn() }));

vi.mock("@makanmasak/utils", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateUUID: uuidMocks.generateUUID,
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => mocks.db),
}));

const fixtureTables = { cashShifts, cashMovements };
type SelectFixtureName = keyof typeof fixtureTables;

function mockSelectResults(fixtures: SelectFixtures<SelectFixtureName>) {
  Object.assign(
    mocks.db,
    createSelectFixtureDb(fixtureTables, {
      cashMovements: [[{ cashRefundsCents: 0, manualMovementCents: 0 }]],
      ...fixtures,
    }),
  );
}

function mockMutations() {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];

  mocks.db.insert.mockImplementation(() => {
    const builder = {
      values: vi.fn((payload: unknown) => {
        inserted.push(payload);
        return builder;
      }),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(undefined).then(resolve, reject),
    };
    return builder;
  });

  mocks.db.update.mockImplementation(() => {
    const builder = {
      set: vi.fn((payload: unknown) => {
        updated.push(payload);
        return builder;
      }),
      where: vi.fn(() => builder),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(undefined).then(resolve, reject),
    };
    return builder;
  });

  return { inserted, updated };
}

function createService() {
  return new ShiftService({} as D1Database);
}

async function withSuppressedConsoleError<T>(action: () => Promise<T>) {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);

  try {
    return await action();
  } finally {
    consoleError.mockRestore();
  }
}

function shiftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "shift-1",
    registerId: "550e8400-e29b-41d4-a716-446655440001",
    operatorId: "7",
    startAmountCents: 25000,
    endAmountCents: null,
    expectedAmountCents: 25000,
    actualAmountCents: null,
    differenceAmountCents: 0,
    totalSalesCents: 0,
    totalRefundsCents: 0,
    cashSalesCents: 0,
    cardSalesCents: 0,
    digitalSalesCents: 0,
    totalTransactions: 0,
    startedAt: new Date("2026-06-07T08:00:00.000Z"),
    endedAt: null,
    status: "active",
    notes: "morning",
    closingNotes: null,
    ...overrides,
  };
}

const registerId = "550e8400-e29b-41d4-a716-446655440001";

describe("ShiftService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("starts shifts and records opening cash movements", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T08:00:00.000Z"));
    uuidMocks.generateUUID
      .mockReturnValueOnce("shift-1")
      .mockReturnValueOnce("movement-1");
    const mutations = mockMutations();
    mockSelectResults({
      cashShifts: [
        [],
        [{ registerId }],
        [shiftRow({ id: "shift-1", registerId })],
      ],
    });

    const result = await createService().startShift({
      registerId,
      operatorId: "7",
      startAmount: 250.5,
      notes: "morning",
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        id: "shift-1",
        registerId,
        operatorId: "7",
        startAmount: 250,
        status: "active",
        notes: "morning",
      },
    });
    expect(result.data).toHaveProperty("endAmount", undefined);
    expect(result.data).toHaveProperty("endedAt", undefined);
    expect(mutations.inserted).toEqual([
      expect.objectContaining({
        id: "shift-1",
        registerId,
        operatorId: "7",
        startAmountCents: 25050,
        expectedAmountCents: 25050,
        differenceAmountCents: 0,
        status: "active",
        notes: "morning",
        startedAt: new Date("2026-06-07T08:00:00.000Z"),
      }),
      expect.objectContaining({
        id: "movement-1",
        shiftId: "shift-1",
        registerId,
        type: "opening",
        amountCents: 25050,
        recordedBy: "7",
        approvalStatus: "approved",
        metadata: "{}",
        createdAt: new Date("2026-06-07T08:00:00.000Z"),
      }),
    ]);
    expect(mutations.updated).toEqual([{ currentShiftId: "shift-1" }]);
    vi.useRealTimers();
  });

  it("rejects invalid start payloads and duplicate active shifts", async () => {
    const mutations = mockMutations();

    let result = await withSuppressedConsoleError(() =>
      createService().startShift({
        registerId: "not-a-uuid",
        operatorId: "7",
        startAmount: 250,
      }),
    );

    expect(result.success).toBe(false);
    expect(mutations.inserted).toHaveLength(0);
    expect(mocks.db.select).not.toHaveBeenCalled();

    mockSelectResults({ cashShifts: [[{ id: "shift-existing" }]] });
    result = await createService().startShift({
      registerId,
      operatorId: "7",
      startAmount: 250,
    });

    expect(result.success).toBe(false);
    expect(mutations.inserted).toHaveLength(0);
  });

  it("ends active shifts, calculates closing totals, and clears registers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
    uuidMocks.generateUUID.mockReturnValue("movement-1");
    const mutations = mockMutations();
    mockSelectResults({
      cashShifts: [
        [
          shiftRow({
            registerId,
            startAmountCents: 10000,
            totalSalesCents: 80000,
            totalRefundsCents: 5000,
            cashSalesCents: 50000,
          }),
        ],
        [{ registerId }],
      ],
      cashMovements: [[{ cashRefundsCents: 5000, manualMovementCents: 0 }]],
    });

    const result = await createService().endShift(
      "shift-1",
      { actualAmount: 560, closingNotes: "balanced" },
      "user-8",
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        shift: {
          id: "shift-1",
          expectedAmount: 550,
          actualAmount: 560,
          endAmount: 560,
          differenceAmount: 10,
          status: "closed",
        },
      },
    });
    expect(mutations.updated).toEqual([
      expect.objectContaining({
        endAmountCents: 56000,
        actualAmountCents: 56000,
        expectedAmountCents: 55000,
        differenceAmountCents: 1000,
        endedAt: new Date("2026-06-07T12:00:00.000Z"),
        status: "closed",
        closingNotes: "balanced",
      }),
      { currentShiftId: null },
    ]);
    expect(mutations.inserted).toEqual([
      expect.objectContaining({
        id: "movement-1",
        shiftId: "shift-1",
        registerId,
        type: "closing",
        amountCents: 56000,
        description: "結班現金 (差額: +10)",
        recordedBy: "user-8",
      }),
    ]);
    vi.useRealTimers();
  });

  it("keeps card sales out of a RM 1,130 drawer expectation after a RM 500 cash refund", async () => {
    uuidMocks.generateUUID.mockReturnValue("movement-1");
    const mutations = mockMutations();
    mockSelectResults({
      cashShifts: [
        [
          shiftRow({
            registerId,
            // RM 180 was taken in cash; card sales are deliberately
            // reported but never put into the drawer expectation.
            startAmountCents: 100000,
            totalSalesCents: 21000,
            cashSalesCents: 18000,
            cardSalesCents: 3000,
          }),
        ],
        [{ registerId }],
      ],
      cashMovements: [[{ cashRefundsCents: 5000, manualMovementCents: 0 }]],
    });

    const result = await createService().endShift(
      "shift-1",
      { actualAmount: 1130 },
      "operator-1",
    );

    expect(result).toMatchObject({
      success: true,
      data: { shift: { expectedAmount: 1130, differenceAmount: 0 } },
    });
    expect(mutations.updated[0]).toMatchObject({
      expectedAmountCents: 113000,
      differenceAmountCents: 0,
    });
  });

  it("uses cents for closing reconciliation to avoid float noise", async () => {
    uuidMocks.generateUUID.mockReturnValue("movement-1");
    const mutations = mockMutations();
    mockSelectResults({
      cashShifts: [
        [
          shiftRow({
            registerId,
            startAmountCents: 10000,
            totalSalesCents: 4287733,
            totalRefundsCents: 123456,
            cashSalesCents: 4287733,
          }),
        ],
        [{ registerId }],
      ],
      cashMovements: [[{ cashRefundsCents: 123456, manualMovementCents: 0 }]],
    });

    const result = await createService().endShift(
      "shift-1",
      { actualAmount: 41742.77 },
      "operator-1",
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        shift: {
          expectedAmount: 41742.77,
          actualAmount: 41742.77,
          differenceAmount: 0,
        },
      },
    });
    expect(mutations.updated[0]).toMatchObject({
      actualAmountCents: 4174277,
      expectedAmountCents: 4174277,
      differenceAmountCents: 0,
    });
    expect(mutations.inserted[0]).toMatchObject({
      amountCents: 4174277,
      description: "結班現金 (差額: +0)",
    });
  });

  it("rejects invalid end payloads and missing active shifts", async () => {
    const mutations = mockMutations();

    let result = await withSuppressedConsoleError(() =>
      createService().endShift("shift-1", { actualAmount: -1 }, "user-8"),
    );

    expect(result.success).toBe(false);
    expect(mutations.updated).toHaveLength(0);
    expect(mocks.db.select).not.toHaveBeenCalled();

    result = await withSuppressedConsoleError(() =>
      createService().endShift("shift-1", { actualAmount: 19.995 }, "user-8"),
    );

    expect(result.success).toBe(false);
    expect(mutations.updated).toHaveLength(0);
    expect(mocks.db.select).not.toHaveBeenCalled();

    mockSelectResults({ cashShifts: [[]] });
    result = await createService().endShift(
      "shift-1",
      { actualAmount: 100 },
      "user-8",
    );

    expect(result.success).toBe(false);
    expect(mutations.updated).toHaveLength(0);
  });

  it("returns current shifts and maps nullable fields to optional fields", async () => {
    mockSelectResults({
      cashShifts: [
        [
          shiftRow({
            startAmountCents: 25050,
            expectedAmountCents: 25050,
            differenceAmountCents: 0,
            totalSalesCents: 12345,
            totalRefundsCents: 500,
            cashSalesCents: 10000,
            cardSalesCents: 2000,
            digitalSalesCents: 345,
            endedAt: null,
            notes: null,
            closingNotes: null,
          }),
        ],
        [],
      ],
    });

    let result = await createService().getCurrentShift(registerId);

    expect(result).toMatchObject({
      success: true,
      data: {
        id: "shift-1",
        registerId,
        status: "active",
        startAmount: 250.5,
        expectedAmount: 250.5,
        differenceAmount: 0,
        totalSales: 123.45,
        totalRefunds: 5,
        cashSales: 100,
        cardSales: 20,
        digitalSales: 3.45,
      },
    });
    expect(result.data).toHaveProperty("endAmount", undefined);
    expect(result.data).toHaveProperty("actualAmount", undefined);
    expect(result.data).toHaveProperty("endedAt", undefined);
    expect(result.data).toHaveProperty("notes", undefined);
    expect(result.data).toHaveProperty("closingNotes", undefined);

    result = await createService().getCurrentShift(registerId);
    expect(result).toEqual({ success: true, data: null });
  });

  it("suspends and resumes shifts with status updates", async () => {
    const mutations = mockMutations();

    await expect(
      createService().suspendShift("shift-1", "cash count"),
    ).resolves.toEqual({ success: true });
    await expect(createService().resumeShift("shift-1")).resolves.toEqual({
      success: true,
    });

    expect(mutations.updated).toEqual([
      expect.objectContaining({ status: "suspended" }),
      { status: "active" },
    ]);
  });

  it("maps database failures to service errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.select.mockImplementation(() => {
      throw new Error("select down");
    });

    await expect(createService().getCurrentShift(registerId)).resolves.toEqual({
      success: false,
      error: "select down",
    });

    mocks.db.select.mockReset();
    mocks.db.update.mockImplementation(() => {
      throw new Error("update down");
    });

    await expect(createService().resumeShift("shift-1")).resolves.toEqual({
      success: false,
      error: "update down",
    });
  });
});
