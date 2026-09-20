import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cashMovements,
  cashRegisters,
  cashShifts,
  orderItems,
  orders,
  paymentTransactions,
  receipts,
  refunds,
  restaurants,
} from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { ReportService } from "./ReportService";

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
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

const fixtureTables = {
  cashMovements,
  cashRegisters,
  cashShifts,
  orderItems,
  orders,
  paymentTransactions,
  receipts,
  refunds,
  restaurants,
};
type SelectFixtureName = keyof typeof fixtureTables;

/**
 * Restaurant-scoped queries resolve the shop's business-day boundary first
 * (#329). It is read once per service instance and is not what these tests are
 * about, so the default answers Taipei; a test that cares declares its own.
 */
const BUSINESS_TIMEZONE_FIXTURES: SelectFixtures<SelectFixtureName> = {
  restaurants: [[{ timezone: "Asia/Taipei" }]],
};

function mockSelectResults(fixtures: SelectFixtures<SelectFixtureName>) {
  Object.assign(
    mocks.db,
    createSelectFixtureDb(fixtureTables, {
      ...BUSINESS_TIMEZONE_FIXTURES,
      ...fixtures,
    }),
  );
}

function mockInsert() {
  const inserted: unknown[] = [];
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
  return inserted;
}

function createService() {
  return new ReportService({} as D1Database);
}

function shiftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "shift-1",
    registerId: "register-1",
    operatorId: 7,
    startAmount: 100,
    startAmountCents: 10000,
    endAmount: 500,
    endAmountCents: 50000,
    expectedAmount: 450,
    expectedAmountCents: 45000,
    actualAmount: 460,
    actualAmountCents: 46000,
    differenceAmount: 10,
    differenceAmountCents: 1000,
    totalRefunds: 25,
    totalRefundsCents: 2500,
    cashSales: 200,
    cashSalesCents: 20000,
    cardSales: 150,
    cardSalesCents: 15000,
    digitalSales: 75,
    digitalSalesCents: 7500,
    startedAt: new Date("2026-06-07T08:00:00.000Z"),
    endedAt: new Date("2026-06-07T10:30:00.000Z"),
    status: "closed",
    ...overrides,
  };
}

describe("ReportService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("generates shift reports with normalized money, JSON fields, and persisted summaries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
    uuidMocks.generateUUID.mockReturnValue("report-1");
    const inserted = mockInsert();
    mockSelectResults({
      // 班次讀取現在 join 收銀機取餐廳歸屬，回傳的是 { shift, restaurantId }。
      // 這個 fixture db 不模擬 where，所以「只算自己餐廳的訂單」證明不在這裡，
      // 在 pos-shift-report-tenancy.real.integration.test.ts 用真 D1 驗。
      cashShifts: [[{ shift: shiftRow(), restaurantId: "restaurant-1" }]],
      cashMovements: [
        [
          {
            id: "movement-1",
            amount: 50,
            amountCents: 5000,
            denominationBreakdown: JSON.stringify({ "100": 1 }),
            metadata: JSON.stringify({ source: "cash_count" }),
          },
        ],
      ],
      receipts: [[{ totalReceipts: 4, printedReceipts: 3 }]],
      orders: [
        [
          {
            totalOrders: 6,
            totalSales: 425,
            avgOrderValue: 70.83,
            cashOrders: 3,
            cardOrders: 2,
            digitalOrders: 1,
          },
        ],
      ],
      // 台幣店，沒有現金進位 (#405)。
      paymentTransactions: [[{ adjustmentCents: 0, roundedPayments: 0 }]],
    });

    const result = await createService().generateShiftReport("shift-1");

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      reportId: "report-1",
      reportData: {
        shift: { id: "shift-1", duration: 150 },
        summary: {
          startAmount: 100,
          endAmount: 500,
          totalSales: 425,
          totalRefunds: 25,
          netSales: 400,
          expectedAmount: 450,
          cashRoundingAdjustment: 0,
          roundedCashPayments: 0,
          expectedCashAmount: 450,
          actualAmount: 460,
          difference: 10,
          recordedDifference: 10,
        },
        breakdown: {
          cashSales: 200,
          cardSales: 150,
          digitalSales: 75,
        },
        orderStats: {
          totalOrders: 6,
          avgOrderValue: 70.83,
          cashOrders: 3,
          cardOrders: 2,
          digitalOrders: 1,
        },
        movements: [
          expect.objectContaining({
            amount: 50,
            denominationBreakdown: { "100": 1 },
            metadata: { source: "cash_count" },
          }),
        ],
        receipts: { totalReceipts: 4, printedReceipts: 3 },
      },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: "report-1",
      shiftId: "shift-1",
      registerId: "register-1",
      operatorId: 7,
      generatedAt: new Date("2026-06-07T12:00:00.000Z"),
    });
    expect(
      JSON.parse((inserted[0] as { summaryData: string }).summaryData),
    ).toMatchObject({ netSales: 400, actualAmount: 460 });
    vi.useRealTimers();
  });

  it("nets cash rounding out of the drawer difference and reports it on its own line", async () => {
    // 馬幣現金班次 (#405)：三筆單分別進位 +2 / -1 / +1 sen，抽屜因此多 2 sen。
    // 那 2 sen 有出處，所以要單獨列出來，短溢要是 0 而不是 +0.02。
    uuidMocks.generateUUID.mockReturnValue("report-myr");
    mockInsert();
    mockSelectResults({
      cashShifts: [
        [
          {
            shift: shiftRow({
              expectedAmountCents: 45000,
              actualAmountCents: 45002,
              differenceAmountCents: 2,
            }),
            restaurantId: "restaurant-1",
          },
        ],
      ],
      cashMovements: [[]],
      receipts: [[{ totalReceipts: 3, printedReceipts: 3 }]],
      orders: [[{ totalOrders: 3, totalSales: 350, avgOrderValue: 116.67 }]],
      paymentTransactions: [[{ adjustmentCents: 2, roundedPayments: 3 }]],
    });

    const result = await createService().generateShiftReport("shift-myr");

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      reportData: {
        summary: {
          expectedAmount: 450,
          cashRoundingAdjustment: 0.02,
          roundedCashPayments: 3,
          expectedCashAmount: 450.02,
          actualAmount: 450.02,
          difference: 0,
          // 班次列上那個沒扣進位的差額仍然留著，對得回資料庫。
          recordedDifference: 0.02,
        },
      },
    });
  });

  it("keeps the shift's recorded difference while the shift is still open", async () => {
    // 還沒結班就沒有實點金額，不能拿 0 去減出一個假的短少。
    uuidMocks.generateUUID.mockReturnValue("report-open");
    mockInsert();
    mockSelectResults({
      cashShifts: [
        [
          {
            shift: shiftRow({
              actualAmountCents: null,
              differenceAmountCents: null,
              endedAt: null,
              status: "active",
            }),
            restaurantId: "restaurant-1",
          },
        ],
      ],
      cashMovements: [[]],
      receipts: [[{ totalReceipts: 0, printedReceipts: 0 }]],
      orders: [[{ totalOrders: 0, totalSales: 0, avgOrderValue: 0 }]],
      paymentTransactions: [[{ adjustmentCents: 2, roundedPayments: 1 }]],
    });

    const result = await createService().generateShiftReport("shift-open");

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      reportData: {
        summary: {
          cashRoundingAdjustment: 0.02,
          difference: 0,
          recordedDifference: 0,
        },
      },
    });
  });

  it("returns a service failure when a shift does not exist", async () => {
    const inserted = mockInsert();
    mockSelectResults({ cashShifts: [[]] });

    await expect(
      createService().generateShiftReport("missing-shift"),
    ).resolves.toMatchObject({ success: false });
    expect(inserted).toHaveLength(0);
  });

  it("builds daily reports from shift, order, refund, and top item stats", async () => {
    mockSelectResults({
      cashShifts: [
        [
          { cash_shifts: shiftRow({ id: "shift-1" }) },
          { cash_shifts: shiftRow({ id: "shift-2" }) },
        ],
      ],
      orders: [
        [
          {
            totalOrders: 8,
            totalSales: 1000,
            totalTax: 50,
            totalDiscounts: 20,
            avgOrderValue: 125,
            cashOrders: 4,
            cardOrders: 3,
            digitalOrders: 1,
          },
        ],
      ],
      refunds: [[{ totalRefunds: 2, totalRefundAmount: 100 }]],
      orderItems: [[{ name: "Laksa", totalQuantity: 5, totalRevenue: 600 }]],
    });

    await expect(
      createService().getDailyReport("restaurant-1", "2026-06-07"),
    ).resolves.toMatchObject({
      success: true,
      data: {
        date: "2026-06-07",
        shifts: [{ id: "shift-1" }, { id: "shift-2" }],
        summary: {
          totalOrders: 8,
          totalSales: 1000,
          totalTax: 50,
          totalDiscounts: 20,
          totalRefunds: 2,
          totalRefundAmount: 100,
          avgOrderValue: 125,
          netSales: 900,
        },
        paymentBreakdown: {
          cashOrders: 4,
          cardOrders: 3,
          digitalOrders: 1,
        },
        topItems: [{ name: "Laksa", totalQuantity: 5, totalRevenue: 600 }],
      },
    });
  });

  it("returns shift and register usage stats", async () => {
    mockSelectResults({
      cashShifts: [
        [
          {
            totalShifts: 3,
            totalSales: 1200,
            totalRefunds: 75,
            avgSalesPerShift: 400,
            totalCashSales: 700,
            totalCardSales: 300,
            totalDigitalSales: 200,
            closedShifts: 2,
            avgCashDifference: 5,
          },
        ],
      ],
      cashRegisters: [
        [
          {
            registerName: "Front POS",
            period: "2026-06",
            shiftCount: 4,
            totalSales: 1500,
            totalTransactions: 30,
            avgSalesPerShift: 375,
          },
        ],
      ],
    });

    await expect(
      createService().getShiftStats("restaurant-1", {
        from: new Date("2026-06-01T00:00:00.000Z"),
        to: new Date("2026-06-07T23:59:59.000Z"),
      }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        totalShifts: 3,
        totalSales: 1200,
        totalRefunds: 75,
        avgSalesPerShift: 400,
      },
    });

    await expect(
      createService().getRegisterUsageStats("restaurant-1", "month"),
    ).resolves.toEqual({
      success: true,
      data: {
        period: "month",
        stats: [
          {
            registerName: "Front POS",
            period: "2026-06",
            shiftCount: 4,
            totalSales: 1500,
            totalTransactions: 30,
            avgSalesPerShift: 375,
          },
        ],
      },
    });
  });

  it("wraps query failures in service result objects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.select.mockImplementation(() => {
      throw new Error("database unavailable");
    });

    await expect(
      createService().getDailyReport("restaurant-1", "2026-06-07"),
    ).resolves.toEqual({
      success: false,
      error: "database unavailable",
    });
    await expect(
      createService().getShiftStats("restaurant-1"),
    ).resolves.toEqual({
      success: false,
      error: "database unavailable",
    });
    await expect(
      createService().getRegisterUsageStats("restaurant-1", "day"),
    ).resolves.toEqual({
      success: false,
      error: "database unavailable",
    });
  });
});
