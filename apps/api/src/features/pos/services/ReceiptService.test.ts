import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cashRegisters,
  orderItems,
  orders,
  paymentTransactions,
  receipts,
  restaurants,
  tables,
} from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { ReceiptService } from "./ReceiptService";

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

const fixtureTables = {
  cashRegisters,
  orderItems,
  orders,
  paymentTransactions,
  receipts,
  restaurants,
  tables,
};
type SelectFixtureName = keyof typeof fixtureTables;

/**
 * Restaurant-scoped queries resolve the shop's business-day boundary first
 * (#329). It is read once per service instance and is not what these tests are
 * about, so the default answers Taipei; a test that cares declares its own.
 */
const BUSINESS_TIMEZONE_FIXTURES: SelectFixtures<SelectFixtureName> = {
  cashRegisters: [[{ restaurantId: "restaurant-1" }]],
  restaurants: [[{ timezone: "Asia/Taipei" }]],
};

function createRejectedQuery(error: Error) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    then: (
      resolve: (value: unknown) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.reject(error).then(resolve, reject),
  };
  return builder;
}

function mockSelectResults(fixtures: SelectFixtures<SelectFixtureName>) {
  Object.assign(
    mocks.db,
    createSelectFixtureDb(fixtureTables, {
      ...BUSINESS_TIMEZONE_FIXTURES,
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
  return new ReceiptService({} as D1Database);
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    orderNumber: "A001",
    customerInfo: { name: "Dina" },
    subtotal: 300,
    subtotalCents: 30000,
    taxAmount: 15,
    taxAmountCents: 1500,
    discountAmount: 20,
    discountAmountCents: 2000,
    totalAmount: 295,
    totalAmountCents: 29500,
    paymentMethod: "cash",
    ...overrides,
  };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    itemSnapshot: { name: "Nasi Lemak" },
    quantity: 2,
    unitPrice: 120,
    unitPriceCents: 12000,
    totalPrice: 240,
    totalPriceCents: 24000,
    customizations: JSON.stringify([{ name: "Extra sambal" }]),
    ...overrides,
  };
}

function receiptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "receipt-1",
    orderId: "101",
    registerId: "register-1",
    shiftId: "shift-1",
    receiptNumber: "R1710000000000-4FZZZX",
    receiptType: "customer",
    templateName: "standard",
    content: JSON.stringify({ orderNumber: "A001", totalAmount: 295 }),
    rawContent: null,
    printStatus: "pending",
    printAttempts: 0,
    printerName: null,
    printerResponse: null,
    printedAt: null,
    reprintedCount: 0,
    lastReprintAt: null,
    createdAt: new Date("2026-06-07T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ReceiptService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("snapshots what the cash payment collected and the 5 sen it rounded", async () => {
    // RM10.33 收了 RM10.35 (#405)：收據要印得出那 2 sen 從哪來。
    uuidMocks.generateUUID.mockReturnValueOnce("receipt-myr");
    const mutations = mockMutations();
    mockSelectResults({
      orders: [
        [
          orderRow({
            totalAmount: 10.33,
            totalAmountCents: 1033,
            paymentTransactionId: "pay-1",
            restaurantId: "restaurant-1",
          }),
        ],
      ],
      orderItems: [[itemRow()]],
      paymentTransactions: [
        [{ amountCents: 1035, roundingAdjustmentCents: 2 }],
      ],
      receipts: [[receiptRow()]],
    });

    await createService().printReceipt({ orderId: "101" }, "register-1");

    expect(
      JSON.parse((mutations.inserted[0] as { content: string }).content),
    ).toMatchObject({
      totalAmount: 10.33,
      roundingAdjustment: 0.02,
      amountCollected: 10.35,
    });
  });

  it("snapshots a zero adjustment when the order has no payment row yet", async () => {
    // 出單票在結帳之前就印了，沒有付款紀錄可讀。
    uuidMocks.generateUUID.mockReturnValueOnce("receipt-unpaid");
    const mutations = mockMutations();
    mockSelectResults({
      orders: [[orderRow({ paymentTransactionId: null })]],
      orderItems: [[itemRow()]],
      receipts: [[receiptRow()]],
    });

    await createService().printReceipt({ orderId: "101" }, "register-1");

    expect(
      JSON.parse((mutations.inserted[0] as { content: string }).content),
    ).toMatchObject({
      totalAmount: 295,
      roundingAdjustment: 0,
      amountCollected: 295,
    });
  });

  it("prints a receipt with generated content and queued print status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    uuidMocks.generateUUID.mockReturnValueOnce("receipt-1");
    // businessNumber() keeps crypto.randomUUID on purpose: a v7 suffix would be
    // timestamp-derived and collide for receipts issued in the same millisecond.
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "12345678-abcd-4000-8000-123456789abc",
    );
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random should not be used for receipt numbers");
    });
    const mutations = mockMutations();
    mockSelectResults({
      orders: [[orderRow()]],
      orderItems: [[itemRow()]],
      receipts: [[receiptRow()]],
    });

    const result = await createService().printReceipt(
      { orderId: "101" },
      "register-1",
      "shift-1",
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        id: "receipt-1",
        orderId: "101",
        registerId: "register-1",
        shiftId: "shift-1",
        receiptType: "customer",
        templateName: "standard",
        content: { orderNumber: "A001", totalAmount: 295 },
      },
    });
    expect(mutations.inserted).toHaveLength(1);
    expect(mutations.inserted[0]).toMatchObject({
      id: "receipt-1",
      orderId: "101",
      registerId: "register-1",
      shiftId: "shift-1",
      receiptType: "customer",
      templateName: "standard",
      printStatus: "pending",
      printAttempts: 0,
      reprintedCount: 0,
      receiptNumber: "R1780790400000-12345678",
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    expect(randomSpy).not.toHaveBeenCalled();
    expect(
      JSON.parse((mutations.inserted[0] as { content: string }).content),
    ).toMatchObject({
      template: "standard",
      orderNumber: "A001",
      customerName: "Dina",
      items: [
        {
          name: "Nasi Lemak",
          quantity: 2,
          price: 120,
          subtotal: 240,
          customizations: [{ name: "Extra sambal" }],
        },
      ],
      subtotal: 300,
      taxAmount: 15,
      discountAmount: 20,
      totalAmount: 295,
      paymentMethod: "cash",
    });
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each([
    { location: [{ tableNumber: "A1" }], expected: "A1" },
    { location: [], expected: null },
  ])(
    "snapshots the available table ($expected)",
    async ({ location, expected }) => {
      uuidMocks.generateUUID.mockReturnValueOnce("receipt-1");
      const mutations = mockMutations();
      mockSelectResults({
        orders: [[orderRow({ restaurantId: "restaurant-1", tableId: 11 })]],
        orderItems: [[itemRow()]],
        tables: [location],
        receipts: [[receiptRow()]],
      });
      expect(
        await createService().printReceipt({ orderId: "101" }, "register-1"),
      ).toMatchObject({ success: true });
      expect(mocks.db.insert).toHaveBeenCalledWith(receipts);
      expect(mutations.inserted).toHaveLength(1);
      expect(
        JSON.parse((mutations.inserted[0] as { content: string }).content)
          .tableNumber,
      ).toBe(expected);
    },
  );

  // KDS 螢幕看得到送達地址，紙本出單票上沒有 —— 拿著紙出門的正是送餐的人
  // （#295）。
  it("carries the delivery address and phone into the receipt content", async () => {
    uuidMocks.generateUUID.mockReturnValueOnce("receipt-1");
    const mutations = mockMutations();
    mockSelectResults({
      orders: [
        [
          orderRow({
            deliveryInfo: {
              type: "delivery",
              address: "台中市西屯區台灣大道三段99號",
              phone: "0912345678",
              deliveryFee: 5,
            },
          }),
        ],
      ],
      orderItems: [[itemRow()]],
      receipts: [[receiptRow()]],
    });

    await createService().printReceipt({ orderId: "101" }, "register-1");

    expect(
      JSON.parse((mutations.inserted[0] as { content: string }).content),
    ).toMatchObject({
      deliveryAddress: "台中市西屯區台灣大道三段99號",
      deliveryPhone: "0912345678",
      // 這筆已經含在 totalAmount 裡（#295），收據要印得出來才有交代（#348）。
      deliveryFee: 5,
    });
  });

  it("leaves the delivery lines empty for a takeaway order", async () => {
    uuidMocks.generateUUID.mockReturnValueOnce("receipt-1");
    const mutations = mockMutations();
    mockSelectResults({
      orders: [
        [
          orderRow({
            // 外帶單也帶著地址（顧客資料），但不該印成送餐地址。
            deliveryInfo: { type: "takeaway", address: "somewhere" },
          }),
        ],
      ],
      orderItems: [[itemRow()]],
      receipts: [[receiptRow()]],
    });

    await createService().printReceipt({ orderId: "101" }, "register-1");

    expect(
      JSON.parse((mutations.inserted[0] as { content: string }).content),
    ).toMatchObject({
      deliveryAddress: null,
      deliveryPhone: null,
      deliveryFee: 0,
    });
  });

  it("rejects missing orders before inserting receipts", async () => {
    const mutations = mockMutations();
    mockSelectResults({ orders: [[]] });

    await expect(
      createService().printReceipt({ orderId: "101" }, "register-1"),
    ).resolves.toMatchObject({ success: false });

    expect(mutations.inserted).toHaveLength(0);
  });

  it("lists receipts with parsed content and pagination metadata", async () => {
    mockSelectResults({
      receipts: [
        [
          receiptRow({
            id: "receipt-1",
            content: JSON.stringify({ orderNumber: "A001" }),
            rawContent: "printer bytes",
            printedAt: new Date("2026-06-07T01:00:00.000Z"),
          }),
          receiptRow({
            id: "receipt-2",
            shiftId: null,
            content: "",
          }),
        ],
      ],
    });

    await expect(
      createService().getReceipts("register-1", {
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        receiptType: "customer",
        page: 2,
        limit: 2,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        receipts: [
          {
            id: "receipt-1",
            content: { orderNumber: "A001" },
            rawContent: "printer bytes",
            printedAt: new Date("2026-06-07T01:00:00.000Z"),
          },
          {
            id: "receipt-2",
            shiftId: undefined,
            content: {},
          },
        ],
        pagination: { page: 2, limit: 2, hasMore: true },
      },
    });
  });

  it("returns receipt details and missing receipt responses", async () => {
    mockSelectResults({ receipts: [[receiptRow()], []] });

    await expect(
      createService().getReceiptDetail("receipt-1"),
    ).resolves.toMatchObject({
      success: true,
      data: {
        id: "receipt-1",
        content: { orderNumber: "A001", totalAmount: 295 },
      },
    });
    await expect(
      createService().getReceiptDetail("missing"),
    ).resolves.toMatchObject({ success: false });
  });

  it("reprints and cancels receipts with the expected update payloads", async () => {
    const mutations = mockMutations();
    mockSelectResults({ receipts: [[receiptRow()], []] });

    await expect(createService().reprintReceipt("receipt-1")).resolves.toEqual({
      success: true,
    });
    await expect(
      createService().reprintReceipt("missing"),
    ).resolves.toMatchObject({ success: false });
    await expect(createService().cancelPrint("receipt-1")).resolves.toEqual({
      success: true,
    });

    // Reprint requeues the receipt. Only the print agent can settle it after
    // the physical printer reports completion.
    expect(mutations.updated).toEqual([
      expect.objectContaining({
        printStatus: "pending",
        lastReprintAt: expect.any(Date),
      }),
      { printStatus: "cancelled" },
    ]);
  });

  it("leaves a new receipt pending until an agent acknowledges physical printing", async () => {
    uuidMocks.generateUUID.mockReturnValue("receipt-async");
    const mutations = mockMutations();
    mockSelectResults({
      orders: [[orderRow()]],
      orderItems: [[itemRow()]],
      receipts: [[receiptRow({ id: "receipt-async" })]],
    });

    await expect(
      createService().printReceipt({ orderId: "101", copies: 2 }, "register-1"),
    ).resolves.toMatchObject({ success: true });

    expect(mutations.updated).toEqual([]);
  });

  it("maps query and mutation failures to service error responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    mocks.db.select.mockImplementationOnce(() =>
      createRejectedQuery(new Error("print lookup failed")),
    );
    await expect(
      createService().printReceipt({ orderId: "101" }, "register-1"),
    ).resolves.toMatchObject({
      success: false,
      error: "print lookup failed",
    });

    mocks.db.select.mockImplementationOnce(() =>
      createRejectedQuery(new Error("reprint lookup failed")),
    );
    await expect(createService().reprintReceipt("receipt-1")).resolves.toEqual({
      success: false,
      error: "reprint lookup failed",
    });

    mocks.db.select.mockImplementationOnce(() =>
      createRejectedQuery(new Error("list failed")),
    );
    await expect(createService().getReceipts("register-1")).resolves.toEqual({
      success: false,
      error: "list failed",
    });

    mocks.db.select.mockImplementationOnce(() =>
      createRejectedQuery(new Error("detail failed")),
    );
    await expect(
      createService().getReceiptDetail("receipt-1"),
    ).resolves.toEqual({
      success: false,
      error: "detail failed",
    });

    mocks.db.update.mockImplementationOnce(() => {
      const builder = {
        set: vi.fn(() => builder),
        where: vi.fn(() => builder),
        then: (
          resolve: (value: unknown) => void,
          reject?: (reason: unknown) => void,
        ) => Promise.reject(new Error("cancel failed")).then(resolve, reject),
      };
      return builder;
    });
    await expect(createService().cancelPrint("receipt-1")).resolves.toEqual({
      success: false,
      error: "cancel failed",
    });
  });
});

describe("ReceiptService.createKitchenTicket", () => {
  it("queues a register-less kitchen ticket for the order", async () => {
    uuidMocks.generateUUID.mockReturnValue("kitchen-1");
    const mutations = mockMutations();
    mockSelectResults({
      // 存在性檢查（無）、訂單、品項、回讀新收據
      receipts: [[], [receiptRow({ id: "kitchen-1" })]],
      orders: [[orderRow()]],
      orderItems: [[itemRow()]],
    });

    await expect(
      createService().createKitchenTicket("101"),
    ).resolves.toMatchObject({ success: true });

    // registerId 必須是 null，否則只有櫃檯代理拿得到，廚房永遠印不到。
    expect(mutations.inserted).toEqual([
      expect.objectContaining({
        id: "kitchen-1",
        orderId: "101",
        registerId: null,
        receiptType: "kitchen",
        printStatus: "pending",
      }),
    ]);
  });

  it("does not open a second ticket for an order that already has one", async () => {
    const mutations = mockMutations();
    mockSelectResults({ receipts: [[receiptRow({ receiptType: "kitchen" })]] });

    await expect(
      createService().createKitchenTicket("101"),
    ).resolves.toMatchObject({ success: true });

    expect(mutations.inserted).toEqual([]);
  });

  it("reports a missing order instead of writing a dangling ticket", async () => {
    const mutations = mockMutations();
    mockSelectResults({ receipts: [[]], orders: [[]] });

    await expect(createService().createKitchenTicket("nope")).resolves.toEqual({
      success: false,
      error: "訂單不存在",
    });
    expect(mutations.inserted).toEqual([]);
  });
});
