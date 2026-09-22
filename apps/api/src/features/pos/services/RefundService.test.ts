import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cashRegisters,
  cashShifts,
  orders,
  refunds,
  restaurants,
} from "@makanmasak/database";
import {
  createMutationFixtureDb,
  createSelectFixtureDb,
  type MutationFixtures,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { RefundService } from "./RefundService";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    batch: vi.fn(),
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
  cashRegisters,
  cashShifts,
  orders,
  refunds,
  restaurants,
};
type FixtureName = keyof typeof fixtureTables;

/**
 * Restaurant-scoped queries resolve the shop's business-day boundary first
 * (#329). It is read once per service instance and is not what these tests are
 * about, so the default answers Taipei; a test that cares declares its own.
 */
const BUSINESS_TIMEZONE_FIXTURES: SelectFixtures<FixtureName> = {
  cashRegisters: [[{ restaurantId: "restaurant-1" }]],
  restaurants: [[{ timezone: "Asia/Taipei" }]],
};

function mockSelectResults(fixtures: SelectFixtures<FixtureName>) {
  Object.assign(
    mocks.db,
    createSelectFixtureDb(fixtureTables, {
      ...BUSINESS_TIMEZONE_FIXTURES,
      ...fixtures,
    }),
  );
}

/**
 * Inserts here are not a fixture queue: `processRefund` builds statements and
 * hands them to `db.batch()`, so a row counts as written only once the batch
 * runs. That recorder stays local. Updates are the positional part — every one
 * of them targets `refunds` — so they are declared per table and operation,
 * and an Error in the queue makes that write reject.
 */
function mockMutations(
  options: {
    failSecondInsert?: boolean;
    fixtures?: MutationFixtures<FixtureName>;
  } = {},
) {
  const inserted: unknown[] = [];
  const insertStatements: Array<{ payload: unknown }> = [];
  const mutationDb = createMutationFixtureDb(fixtureTables, {
    // Successful order/shift reconciliation is the default completion path;
    // individual tests override it when they exercise a write failure.
    orders: { update: [{ changes: 1 }] },
    cashShifts: { update: [{ changes: 1 }] },
    ...options.fixtures,
  });

  mocks.db.insert.mockImplementation(() => {
    const builder = {
      payload: undefined as unknown,
      values: vi.fn((payload: unknown) => {
        builder.payload = payload;
        return builder;
      }),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => {
        if (options.failSecondInsert && insertStatements.length === 1) {
          return Promise.reject(new Error("injected insert failure")).then(
            resolve,
            reject,
          );
        }
        insertStatements.push(builder);
        inserted.push(builder.payload);
        return Promise.resolve(undefined).then(resolve, reject);
      },
    };
    return builder;
  });
  mocks.db.update.mockImplementation(mutationDb.update);

  mocks.db.batch = vi.fn(async (statements: Array<{ payload: unknown }>) => {
    if (options.failSecondInsert && statements.length > 1) {
      throw new Error("injected insert failure");
    }
    insertStatements.push(...statements);
    inserted.push(...statements.map((statement) => statement.payload));
    return statements.map(() => undefined);
  });

  return { inserted, updated: mutationDb.updated };
}

function createService(
  options?: ConstructorParameters<typeof RefundService>[1],
) {
  return new RefundService({} as D1Database, options);
}

function refundRequest(overrides: Record<string, unknown> = {}) {
  return {
    originalOrderId: "101",
    refundType: "partial" as const,
    refundAmount: 25,
    refundMethod: "cash",
    reasonCode: "customer_request",
    reasonDescription: "Changed mind",
    itemsRefunded: [{ itemId: 1, quantity: 1 }],
    customerSignature: "signed",
    ...overrides,
  };
}

function refundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "refund-1",
    originalOrderId: "101",
    registerId: "register-1",
    shiftId: "shift-1",
    refundNumber: "RF1",
    refundType: "partial",
    originalAmountCents: 10000,
    refundAmountCents: 2500,
    refundMethod: "cash",
    reasonCode: "customer_request",
    itemsRefunded: JSON.stringify([{ itemId: 1 }]),
    processedBy: 7,
    status: "processing",
    metadata: "{}",
    ...overrides,
  };
}

describe("RefundService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("processes live cash refunds and records a cash movement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    uuidMocks.generateUUID
      .mockReturnValueOnce("refund-1")
      .mockReturnValueOnce("movement-1");
    // businessNumber() keeps crypto.randomUUID on purpose: a v7 suffix would be
    // timestamp-derived and collide for refunds issued in the same millisecond.
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "abcdef12-3456-4000-8000-abcdef123456",
    );
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random should not be used for refund numbers");
    });
    const mutations = mockMutations({
      // completeRefund settles the terminal state before processRefund returns.
      fixtures: { refunds: { update: [{ changes: 1 }] } },
    });
    mockSelectResults({
      orders: [
        [
          {
            id: 101,
            totalAmount: 100,
            totalAmountCents: 10000,
            paymentStatus: "completed",
          },
        ],
      ],
      refunds: [[{ totalRefunded: 10 }], [refundRow()]],
      cashShifts: [[{ status: "active" }]],
    });

    const result = await createService().processRefund(
      refundRequest(),
      "register-1",
      "user-7",
      "shift-1",
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        refundId: "refund-1",
        ledgerMutation: true,
        itemsRefunded: [{ itemId: 1 }],
        metadata: {},
      },
    });
    expect(mutations.inserted).toHaveLength(2);
    expect(mutations.inserted[0]).toMatchObject({
      originalOrderId: "101",
      registerId: "register-1",
      shiftId: "shift-1",
      originalAmountCents: 10000,
      refundAmountCents: 2500,
      refundNumber: "RF1780790400000-ABCDEF12",
      metadata: "{}",
    });
    expect(mutations.inserted[1]).toMatchObject({
      id: "movement-1",
      shiftId: "shift-1",
      registerId: "register-1",
      type: "refund",
      amountCents: -2500,
      description: "退款 - RF1780790400000-ABCDEF12",
      referenceId: null,
      referenceType: "refund",
    });
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refundAmountCents: expect.anything(),
          paymentStatus: expect.anything(),
          updatedAt: expect.any(Date),
        }),
        expect.objectContaining({ totalRefundsCents: expect.anything() }),
      ]),
    );
    expect(randomSpy).not.toHaveBeenCalled();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("leaves a cashier refund pending until owner approval settles its order and cash ledger", async () => {
    uuidMocks.generateUUID
      .mockReturnValueOnce("refund-1")
      .mockReturnValueOnce("movement-1");
    const mutations = mockMutations({
      fixtures: { refunds: { update: [{ changes: 1 }] } },
    });
    const pendingMetadata = JSON.stringify({ approvalRequired: true });
    mockSelectResults({
      orders: [
        [
          {
            id: 101,
            totalAmount: 100,
            totalAmountCents: 10000,
            paymentStatus: "completed",
          },
        ],
      ],
      refunds: [
        [{ totalRefunded: 0 }],
        [refundRow({ metadata: pendingMetadata, refundMethod: "cash" })],
        [refundRow({ metadata: pendingMetadata, refundMethod: "cash" })],
      ],
      cashShifts: [[{ status: "active" }], [{ status: "active" }]],
    });

    const pending = await createService().processRefund(
      refundRequest(),
      "register-1",
      "cashier-7",
      "shift-1",
      { requireApproval: true },
    );

    expect(pending).toMatchObject({
      success: true,
      data: {
        refundId: "refund-1",
        ledgerMutation: false,
        approvalRequired: true,
      },
    });
    expect(mutations.inserted).toHaveLength(1);
    expect(mutations.inserted[0]).toMatchObject({
      status: "processing",
      metadata: pendingMetadata,
    });
    expect(mutations.updated).toEqual([]);

    await expect(
      createService().approveRefund("refund-1", "owner-1"),
    ).resolves.toEqual({ success: true });

    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "completed", approvedBy: "owner-1" }),
        expect.objectContaining({
          refundAmountCents: expect.anything(),
          paymentStatus: expect.anything(),
        }),
        expect.objectContaining({ totalRefundsCents: expect.anything() }),
      ]),
    );
    expect(mutations.inserted[1]).toMatchObject({
      id: "movement-1",
      shiftId: "shift-1",
      type: "refund",
      amountCents: -2500,
      recordedBy: "owner-1",
    });
  });

  it("records post-close refunds without mutating the live cash ledger", async () => {
    vi.useFakeTimers();
    const mutations = mockMutations({
      // completeRefund settles the terminal state before processRefund returns.
      fixtures: { refunds: { update: [{ changes: 1 }] } },
    });
    mockSelectResults({
      orders: [
        [
          {
            id: 101,
            totalAmount: 100,
            totalAmountCents: 10000,
            paymentStatus: "completed",
          },
        ],
      ],
      refunds: [
        [{ totalRefunded: 0 }],
        [
          refundRow({
            metadata: JSON.stringify({ postCloseAdjustment: true }),
          }),
        ],
      ],
      cashShifts: [[{ status: "closed" }]],
    });

    const result = await createService().processRefund(
      refundRequest(),
      "register-1",
      "user-7",
      "shift-1",
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        refundId: "refund-1",
        adjustmentId: "refund-1",
        ledgerMutation: false,
        metadata: { postCloseAdjustment: true },
      },
    });
    expect(mutations.inserted).toHaveLength(1);
    expect(mutations.inserted[0]).toMatchObject({
      metadata: JSON.stringify({ postCloseAdjustment: true }),
    });
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not commit a live cash refund row if its cash movement fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const mutations = mockMutations({ failSecondInsert: true });
    mockSelectResults({
      orders: [
        [
          {
            id: 101,
            totalAmount: 100,
            totalAmountCents: 10000,
            paymentStatus: "completed",
          },
        ],
      ],
      refunds: [[{ totalRefunded: 0 }]],
      cashShifts: [[{ status: "active" }]],
    });

    try {
      await expect(
        createService().processRefund(
          refundRequest(),
          "register-1",
          "user-7",
          "shift-1",
        ),
      ).resolves.toMatchObject({
        success: false,
        error: "injected insert failure",
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(mocks.db.batch).toHaveBeenCalledOnce();
    expect(mutations.inserted).toEqual([]);
  });

  it("alerts when synchronous refund completion cannot mark the refund failed", async () => {
    const alertSink = vi.fn();
    const mutations = mockMutations({
      // Both the completion write and the fallback "mark failed" write fail.
      fixtures: {
        refunds: {
          update: [
            new Error("completion write failed"),
            new Error("failed-state write failed"),
          ],
        },
      },
    });
    mockSelectResults({
      orders: [
        [
          {
            id: 101,
            totalAmount: 100,
            totalAmountCents: 10000,
            paymentStatus: "completed",
          },
        ],
      ],
      refunds: [[{ totalRefunded: 0 }], [refundRow()]],
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      // Completion now runs synchronously (awaited) inside processRefund, so
      // both the completed and failed writes have already been attempted by the
      // time the promise resolves — no timer advance required.
      const result = await createService({ alertSink }).processRefund(
        refundRequest({ refundMethod: "card" }),
        "register-1",
        "user-7",
      );

      expect(result).toMatchObject({
        success: true,
        data: { refundId: "refund-1" },
      });

      expect(mutations.updated).toEqual([
        expect.objectContaining({ status: "completed" }),
        expect.objectContaining({ status: "failed" }),
      ]);
      const insertedRefund = mutations.inserted[0] as { id: string };
      expect(alertSink).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Refund completion failed",
          severity: "critical",
          metadata: expect.objectContaining({
            refundId: insertedRefund.id,
            completionError: "completion write failed",
            markFailedError: "failed-state write failed",
          }),
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("marks the refund completed synchronously before returning", async () => {
    const mutations = mockMutations({
      // completeRefund settles the terminal state before processRefund returns.
      fixtures: { refunds: { update: [{ changes: 1 }] } },
    });
    mockSelectResults({
      orders: [
        [
          {
            id: 101,
            totalAmount: 100,
            totalAmountCents: 10000,
            paymentStatus: "completed",
          },
        ],
      ],
      refunds: [[{ totalRefunded: 0 }], [refundRow()]],
    });

    const result = await createService().processRefund(
      refundRequest({ refundMethod: "card" }),
      "register-1",
      "user-7",
    );

    expect(result).toMatchObject({ success: true });
    // The terminal "completed" write happened during the awaited call — the
    // row does not linger in "processing".
    expect(mutations.updated[0]).toEqual(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("allows cent-exact cumulative refunds that reach the order total", async () => {
    const mutations = mockMutations({
      // completeRefund settles the terminal state before processRefund returns.
      fixtures: { refunds: { update: [{ changes: 1 }] } },
    });
    mockSelectResults({
      orders: [
        [
          {
            id: 101,
            totalAmount: 19.99,
            totalAmountCents: 1999,
            paymentStatus: "completed",
          },
        ],
      ],
      refunds: [
        [{ totalRefunded: 19.98 }],
        [
          refundRow({
            originalAmountCents: 1999,
            refundAmountCents: 1,
            refundMethod: "card",
          }),
        ],
      ],
    });

    const result = await createService().processRefund(
      refundRequest({ refundAmount: 0.01, refundMethod: "card" }),
      "register-1",
      "user-7",
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        originalAmount: 19.99,
        refundAmount: 0.01,
      },
    });
    expect(mutations.inserted[0]).toMatchObject({
      originalAmountCents: 1999,
      refundAmountCents: 1,
    });
  });

  it("rejects invalid refund requests before inserting rows", async () => {
    const mutations = mockMutations();

    mockSelectResults({ orders: [[]] });
    await expect(
      createService().processRefund(refundRequest(), "register-1", "user-7"),
    ).resolves.toMatchObject({ success: false });

    mockSelectResults({
      orders: [[{ id: 101, totalAmount: 100, paymentStatus: "completed" }]],
    });
    await expect(
      createService().processRefund(
        refundRequest({ refundAmount: 125 }),
        "register-1",
        "user-7",
      ),
    ).resolves.toMatchObject({ success: false });

    mockSelectResults({
      orders: [[{ id: 101, totalAmount: 100, paymentStatus: "completed" }]],
      refunds: [[{ totalRefunded: 90 }]],
    });
    await expect(
      createService().processRefund(refundRequest(), "register-1", "user-7"),
    ).resolves.toMatchObject({ success: false });

    mockSelectResults({
      orders: [[{ id: 101, totalAmount: 100, paymentStatus: "completed" }]],
    });
    await expect(
      createService().processRefund(
        refundRequest({ refundAmount: 19.995 }),
        "register-1",
        "user-7",
      ),
    ).resolves.toMatchObject({ success: false });

    expect(mutations.inserted).toHaveLength(0);
  });

  /**
   * orders.payment_status 是無約束 TEXT，所以這裡逐個列出實際會落在欄位裡的
   * 未收款值——包含 NULL 與漂進來的未知字串。只驗 "pending" 會讓其他值繼續
   * 可退，而未付款訂單退現金會直接從錢櫃扣出一筆 cash_movement。
   */
  it.each([["pending"], ["failed"], [null], ["unpaid"]])(
    "refuses to refund an order whose payment status is %s",
    async (paymentStatus) => {
      const mutations = mockMutations();
      mockSelectResults({
        orders: [
          [
            {
              id: 101,
              totalAmount: 100,
              totalAmountCents: 10000,
              paymentStatus,
            },
          ],
        ],
      });

      await expect(
        createService().processRefund(
          refundRequest(),
          "register-1",
          "user-7",
          "shift-1",
        ),
      ).resolves.toMatchObject({
        success: false,
        error: "訂單尚未付款，無法退款",
      });
      expect(mutations.inserted).toHaveLength(0);
    },
  );

  /**
   * "paid" 是 #311 修正前寫進 payment_status 的舊值，正式環境仍有存量；
   * "partial_refunded" 則是連續部分退款的第二筆。兩者都必須留在可退範圍內。
   */
  it.each([["paid"], ["partial_refunded"]])(
    "still refunds an order already settled as %s",
    async (paymentStatus) => {
      uuidMocks.generateUUID
        .mockReturnValueOnce("refund-1")
        .mockReturnValueOnce("movement-1");
      const mutations = mockMutations({
        fixtures: { refunds: { update: [{ changes: 1 }] } },
      });
      mockSelectResults({
        orders: [
          [
            {
              id: 101,
              totalAmount: 100,
              totalAmountCents: 10000,
              paymentStatus,
            },
          ],
        ],
        refunds: [[{ totalRefunded: 0 }], [refundRow()]],
        cashShifts: [[{ status: "active" }]],
      });

      await expect(
        createService().processRefund(
          refundRequest(),
          "register-1",
          "user-7",
          "shift-1",
        ),
      ).resolves.toMatchObject({ success: true });
      expect(mutations.inserted[0]).toMatchObject({
        originalOrderId: "101",
        refundAmountCents: 2500,
      });
    },
  );

  it("lists refunds with parsed JSON fields and pagination metadata", async () => {
    mockSelectResults({
      refunds: [
        [
          refundRow({
            id: "refund-1",
            itemsRefunded: JSON.stringify([{ itemId: 1 }]),
            metadata: JSON.stringify({ channel: "pos" }),
          }),
          refundRow({
            id: "refund-2",
            itemsRefunded: "",
            metadata: "",
          }),
        ],
      ],
    });

    await expect(
      createService().getRefunds("register-1", {
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        status: "completed",
        orderId: "101",
        page: 2,
        limit: 2,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        refunds: [
          {
            id: "refund-1",
            itemsRefunded: [{ itemId: 1 }],
            metadata: { channel: "pos" },
          },
          { id: "refund-2", itemsRefunded: [], metadata: {} },
        ],
        pagination: { page: 2, limit: 2, hasMore: true },
      },
    });
  });

  it("returns refund details, missing refunds, and status transition updates", async () => {
    const mutations = mockMutations({
      // cancelRefund, approveRefund, rejectRefund.
      fixtures: {
        refunds: { update: [{ changes: 1 }, { changes: 1 }, { changes: 1 }] },
      },
    });
    mockSelectResults({ refunds: [[refundRow()], [], [refundRow()]] });

    await expect(
      createService().getRefundDetail("refund-1"),
    ).resolves.toMatchObject({
      success: true,
      data: { id: "refund-1", itemsRefunded: [{ itemId: 1 }], metadata: {} },
    });
    await expect(
      createService().getRefundDetail("missing"),
    ).resolves.toMatchObject({
      success: false,
    });

    await expect(
      createService().cancelRefund("refund-1", "user-7", "duplicate"),
    ).resolves.toEqual({ success: true });
    await expect(
      createService().approveRefund("refund-1", "user-8"),
    ).resolves.toEqual({
      success: true,
    });
    await expect(
      createService().rejectRefund("refund-1", "user-9", "not eligible"),
    ).resolves.toEqual({ success: true });

    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "cancelled",
          approvedBy: "user-7",
          metadata: JSON.stringify({ cancellation_reason: "duplicate" }),
        }),
        expect.objectContaining({
          status: "completed",
          approvedBy: "user-8",
          completedAt: expect.any(Date),
        }),
        expect.objectContaining({
          status: "failed",
          approvedBy: "user-9",
          metadata: JSON.stringify({ rejection_reason: "not eligible" }),
        }),
      ]),
    );
    expect(mutations.updated).toContainEqual(
      expect.objectContaining({
        refundAmountCents: expect.anything(),
        paymentStatus: expect.anything(),
      }),
    );
  });
});
