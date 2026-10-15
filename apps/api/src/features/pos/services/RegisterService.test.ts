import { beforeEach, describe, expect, it, vi } from "vitest";
import { cashRegisters, cashShifts } from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { RegisterService } from "./RegisterService";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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

const fixtureTables = { cashRegisters, cashShifts };
type SelectFixtureName = keyof typeof fixtureTables;

function mockSelectResults(fixtures: SelectFixtures<SelectFixtureName>) {
  Object.assign(mocks.db, createSelectFixtureDb(fixtureTables, fixtures));
}

function mockMutations() {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  let deleted = 0;

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
  mocks.db.delete.mockImplementation(() => {
    const builder = {
      where: vi.fn(() => {
        deleted += 1;
        return builder;
      }),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(undefined).then(resolve, reject),
    };
    return builder;
  });

  return {
    inserted,
    updated,
    get deleted() {
      return deleted;
    },
  };
}

function createService() {
  return new RegisterService({} as D1Database);
}

function registerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "register-1",
    name: "Front Counter",
    location: "Entrance",
    restaurantId: "restaurant-1",
    isActive: true,
    currentShiftId: "shift-1",
    hardwareConfig: JSON.stringify({ printer: "epson" }),
    peripherals: JSON.stringify({ drawer: true }),
    settings: JSON.stringify({ receiptCopies: 2 }),
    lastMaintenanceAt: new Date("2026-06-01T00:00:00.000Z"),
    createdAt: new Date("2026-06-01T01:00:00.000Z"),
    updatedAt: new Date("2026-06-02T01:00:00.000Z"),
    ...overrides,
  };
}

describe("RegisterService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("creates registers with normalized JSON config and returns mapped data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    uuidMocks.generateUUID.mockReturnValue("register-1");
    const mutations = mockMutations();
    mockSelectResults({
      cashRegisters: [
        [
          registerRow({
            currentShiftId: null,
            lastMaintenanceAt: null,
          }),
        ],
      ],
    });

    const result = await createService().createRegister(
      {
        name: "Front Counter",
        location: "Entrance",
        restaurantId: "restaurant-1",
        hardwareConfig: { printer: "epson" },
        peripherals: { drawer: true },
        settings: { receiptCopies: 2 },
      },
      "user-7",
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        id: "register-1",
        name: "Front Counter",
        location: "Entrance",
        restaurantId: "restaurant-1",
        isActive: true,
        hardwareConfig: { printer: "epson" },
        peripherals: { drawer: true },
        settings: { receiptCopies: 2 },
      },
    });
    expect(result.data).toHaveProperty("currentShiftId", undefined);
    expect(result.data).toHaveProperty("lastMaintenanceAt", undefined);
    expect(mutations.inserted).toEqual([
      expect.objectContaining({
        id: "register-1",
        name: "Front Counter",
        location: "Entrance",
        restaurantId: "restaurant-1",
        isActive: true,
        hardwareConfig: JSON.stringify({ printer: "epson" }),
        peripherals: JSON.stringify({ drawer: true }),
        settings: JSON.stringify({ receiptCopies: 2 }),
        createdAt: new Date("2026-06-07T00:00:00.000Z"),
        updatedAt: new Date("2026-06-07T00:00:00.000Z"),
      }),
    ]);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("rejects invalid create payloads before inserting", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mutations = mockMutations();

    const result = await createService().createRegister(
      { name: "", restaurantId: "restaurant-1" },
      "user-7",
    );

    expect(result.success).toBe(false);
    expect(mutations.inserted).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "創建收銀機失敗:",
      expect.objectContaining({ name: "ZodError" }),
    );
    errorSpy.mockRestore();
  });

  it("lists registers and reports status with shift activity", async () => {
    mockSelectResults({
      cashRegisters: [
        [
          registerRow({ id: "register-1" }),
          registerRow({
            id: "register-2",
            location: null,
            currentShiftId: null,
            hardwareConfig: "",
            peripherals: "",
            settings: "",
            lastMaintenanceAt: null,
          }),
        ],
        [registerRow({ currentShiftId: "shift-1" })],
        [],
      ],
    });

    await expect(
      createService().getRegisters("restaurant-1"),
    ).resolves.toMatchObject({
      success: true,
      data: [
        {
          id: "register-1",
          currentShiftId: "shift-1",
          hardwareConfig: { printer: "epson" },
        },
        {
          id: "register-2",
          hardwareConfig: {},
          peripherals: {},
          settings: {},
        },
      ],
    });
    const status = await createService().getRegisterStatus("register-1");
    expect(status).toMatchObject({
      success: true,
      data: { id: "register-1", isShiftActive: true },
    });
    expect(status.data).toHaveProperty("currentShiftId", "shift-1");
    await expect(
      createService().getRegisterStatus("missing"),
    ).resolves.toMatchObject({ success: false });
  });

  it("updates register fields and rejects empty updates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const mutations = mockMutations();
    mockSelectResults({
      cashRegisters: [[registerRow({ name: "Updated Counter" })]],
    });

    await expect(
      createService().updateRegister("register-1", {}),
    ).resolves.toMatchObject({ success: false });
    await expect(
      createService().updateRegister("register-1", {
        name: "Updated Counter",
        location: null as never,
        hardwareConfig: { printer: "star" },
        peripherals: { scanner: true },
        settings: { receiptCopies: 1 },
      }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        id: "register-1",
        name: "Updated Counter",
        hardwareConfig: { printer: "epson" },
      },
    });

    expect(mutations.updated).toEqual([
      expect.objectContaining({
        name: "Updated Counter",
        location: null,
        hardwareConfig: JSON.stringify({ printer: "star" }),
        peripherals: JSON.stringify({ scanner: true }),
        settings: JSON.stringify({ receiptCopies: 1 }),
        updatedAt: new Date("2026-06-07T00:00:00.000Z"),
      }),
    ]);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("toggles and deletes registers while blocking active-shift deletion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    const mutations = mockMutations();
    mockSelectResults({ cashShifts: [[{ id: "shift-1" }], []] });

    await expect(
      createService().toggleRegisterStatus("register-1", false),
    ).resolves.toEqual({ success: true });
    await expect(
      createService().deleteRegister("register-1"),
    ).resolves.toMatchObject({ success: false });
    await expect(createService().deleteRegister("register-1")).resolves.toEqual(
      { success: true },
    );

    expect(mutations.updated).toEqual([
      {
        isActive: false,
        updatedAt: new Date("2026-06-07T00:00:00.000Z"),
      },
    ]);
    expect(mutations.deleted).toBe(1);
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
