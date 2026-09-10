import { beforeEach, describe, expect, it, vi } from "vitest";
import { orders, paymentTransactions } from "@makanmasak/database";
import { createSelectFixtureDb } from "@makanmasak/database/testing";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { Env } from "../../../types/env";
import { ApiError } from "../../../shared/utils/api-error";
import { PaymentService } from "./PaymentService";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    batch: vi.fn(),
  },
  raisePaymentFailedAlert: vi.fn(),
}));

let currentOrderUpdateChanges = 1;

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => mocks.db),
}));

vi.mock("@makanmasak/utils", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  generateUUID: vi.fn(() => "audit-id"),
}));

// Partial: `OWNER_ALERTED_PAYMENT_FAILURE_CODES` is the policy under test, so
// the real set has to survive the mock — only the producer is stubbed.
vi.mock("../../alerts/producers", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  raisePaymentFailedAlert: mocks.raisePaymentFailedAlert,
}));

interface PreparedStatement {
  sql: string;
  values: unknown[];
  payload?: unknown;
  bind: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

function queueOrderRows(rows: unknown[][]) {
  Object.assign(
    mocks.db,
    createSelectFixtureDb(
      { orders, paymentTransactions },
      {
        orders: rows,
        paymentTransactions: rows.map(() => []),
      },
    ),
  );
}

// The replay path reads the order first (to authorise the caller) and the
// recorded transaction second, so both queues have to be declared together.
function queueReplayRows(orderRows: unknown[][], paymentRows: unknown[][]) {
  Object.assign(
    mocks.db,
    createSelectFixtureDb(
      { orders, paymentTransactions },
      { orders: orderRows, paymentTransactions: paymentRows },
    ),
  );
}

// Takes rows and ignores them. Call sites pass things like
// `[{ status: "paid", paymentStatus: "paid" }]`, which reads as a fixture but
// configures nothing — the update mock in createD1() supplies its own result.
// Left as-is so the call sites keep documenting intent, but do not reason
// about post-update state from those arguments; they are inert.
function mockOrderUpdate(_returningRows: unknown[] = []) {
  return [];
}

function createD1(orderUpdateChanges = 1) {
  const statements: PreparedStatement[] = [];
  const committed: PreparedStatement[] = [];
  currentOrderUpdateChanges = orderUpdateChanges;
  mocks.db.insert.mockImplementation(() => {
    const statement: PreparedStatement = {
      sql: "INSERT",
      values: [],
      bind: vi.fn(() => statement),
      run: vi.fn(async () => ({ meta: { changes: 1 }, success: true })),
    };
    const builder = {
      values: vi.fn((payload: Record<string, unknown>) => {
        statement.payload = payload;
        statement.values = Object.values(payload);
        statement.sql =
          "refundId" in payload
            ? "INSERT INTO refund_transactions"
            : "eventType" in payload
              ? "INSERT OR IGNORE INTO payment_audit_log"
              : "INSERT INTO payment_transactions";
        statements.push(statement);
        return {
          ...statement,
          onConflictDoNothing: vi.fn(() => {
            statement.sql = statement.sql.replace(
              "INSERT INTO",
              "INSERT OR IGNORE INTO",
            );
            return statement;
          }),
        };
      }),
    };
    return builder;
  });
  mocks.db.batch.mockImplementation(
    async (batchStatements: PreparedStatement[]) => {
      committed.push(...batchStatements);
      return batchStatements.map(() => ({
        meta: { changes: 1 },
        success: true,
      }));
    },
  );
  mocks.db.update.mockImplementation(() => {
    const statement: PreparedStatement = {
      sql: "UPDATE",
      values: [],
      bind: vi.fn(() => statement),
      run: vi.fn(async () => ({
        meta: { changes: currentOrderUpdateChanges },
        success: true,
      })),
    };
    const builder = {
      set: vi.fn((payload: Record<string, unknown>) => {
        statement.payload = payload;
        statement.values = Object.values(payload);
        statement.sql =
          "paymentStatus" in payload && "paymentTransactionId" in payload
            ? "UPDATE orders"
            : "isOccupied" in payload
              ? "UPDATE tables"
              : "UPDATE payment_transactions";
        statements.push(statement);
        return builder;
      }),
      where: vi.fn(() => {
        statement.run.mockImplementation(async () => {
          committed.push(statement);
          return {
            meta: { changes: currentOrderUpdateChanges },
            success: true,
          };
        });
        return statement;
      }),
    };
    return builder;
  });
  const db = {
    prepare: vi.fn((sql: string) => {
      const statement: PreparedStatement = {
        sql,
        values: [],
        bind: vi.fn((...values: unknown[]) => {
          statement.values = values;
          return statement;
        }),
        run: vi.fn(async () => {
          committed.push(statement);
          return {
            meta: {
              changes: statement.sql.includes("UPDATE orders")
                ? orderUpdateChanges
                : 1,
            },
            success: true,
          };
        }),
      };
      statements.push(statement);
      return statement;
    }),
    batch: mocks.db.batch,
  };
  return { db, statements, committed };
}

function createD1WithBatchFailure(
  failWhen: (statement: PreparedStatement) => boolean,
) {
  const setup = createD1();
  mocks.db.batch.mockImplementation(
    async (batchStatements: PreparedStatement[]) => {
      if (batchStatements.some(failWhen)) {
        throw new Error("injected batch failure");
      }
      setup.committed.push(...batchStatements);
      return batchStatements.map(() => ({
        meta: { changes: 1 },
        success: true,
      }));
    },
  );
  return setup;
}

function env(db: unknown) {
  // Typed as the KVNamespace slice the service actually touches: an inline
  // `vi.fn()` would make the literal a `Mock<...>` that `Env` cannot be
  // compared against.
  const cacheKV: Pick<KVNamespace, "delete"> = {
    delete: vi.fn(async () => undefined),
  };
  return { DB: db, CACHE_KV: cacheKV } as Env;
}

function envWithRealtime(db: unknown) {
  const fetch = vi.fn(async (_request: string, init?: RequestInit) => ({
    json: async () => ({
      success: true,
      eventId: JSON.parse(String(init?.body)).eventId,
      recipientCount: 2,
    }),
  }));
  const cacheKV = {
    delete: vi.fn(async () => undefined),
  };
  return {
    env: {
      DB: db,
      CACHE_KV: cacheKV,
      REALTIME_SESSION: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({ fetch })),
      },
    } as unknown as Env,
    cacheKV,
    fetch,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-101",
    orderNumber: "A-001",
    restaurantId: "restaurant-1",
    status: "confirmed",
    paymentStatus: "pending",
    tableId: null,
    totalAmount: 120,
    totalAmountCents: 12000,
    ...overrides,
  };
}

function paymentTransaction(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: "pay_order-101_1780833600000",
    orderId: "order-101",
    amountCents: 12000,
    status: "paid",
    ...overrides,
  };
}

function statementContaining(statements: PreparedStatement[], text: string) {
  return statements.find((statement) => statement.sql.includes(text));
}

// `PaymentAuditService.prepareAppend` binds positionally, so decode the row
// once here rather than indexing into `values` at every call site.
const AUDIT_COLUMNS = [
  "id",
  "restaurantId",
  "paymentTransactionId",
  "subscriptionId",
  "eventType",
  "provider",
  "providerEventId",
  "providerEventType",
  "amount",
  "currency",
  "rawPayload",
  "errorCode",
  "errorMessage",
  "occurredAtMs",
] as const;

// The success path writes its audit rows through drizzle (`payload` set); the
// failure path goes through `db.prepare` (`payload` undefined). Both land in
// `statements`, so filter on which writer produced them.
function preparedAuditEvents(statements: PreparedStatement[]) {
  return statements
    .filter(
      (statement) =>
        statement.payload === undefined &&
        statement.sql.includes("payment_audit_log"),
    )
    .map((statement) =>
      Object.fromEntries(
        AUDIT_COLUMNS.map((name, index) => [name, statement.values[index]]),
      ),
    );
}

describe("PaymentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1780833600000);
  });

  it("processes full payments from the authoritative order total", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order()]]);
    mockOrderUpdate([{ status: "paid", paymentStatus: "paid" }]);

    await expect(
      new PaymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 120,
          expectedTotal: 120,
          method: "cash",
        },
        {
          country: "TW",
          currency: "TWD",
          idempotencyKey: "idem-1",
          customerInfo: { phone: "0912345678" },
          metadata: { terminal: "front" },
        },
      ),
    ).resolves.toEqual({
      status: 200,
      data: {
        paymentId: "pay_order-101_1780833600000",
        orderId: "order-101",
        orderStatus: "paid",
        paymentStatus: "completed",
        authorizedTotal: 120,
      },
    });

    expect(
      statementContaining(statements, "INSERT INTO payment_transactions")
        ?.payload,
    ).toMatchObject({
      transactionId: "pay_order-101_1780833600000",
      orderId: "order-101",
      restaurantId: "restaurant-1",
      amountCents: 12000,
      currency: "TWD",
      countryCode: "TW",
      paymentMethod: "cash",
      gateway: "cash",
      status: "pending",
      idempotencyKey: "idem-1",
      customerInfo: { phone: "0912345678" },
      metadata: {
        terminal: "front",
        paymentMode: "full",
        closeOrder: true,
      },
      createdAt: new Date(1780833600000),
      updatedAt: new Date(1780833600000),
    });

    expect(statementContaining(statements, "UPDATE orders")?.payload).toEqual({
      // orders.status and orders.payment_status deliberately disagree in
      // spelling: "paid" is the workflow state, "completed" is the canonical
      // OrderPaymentStatus that the read path will accept back (#311).
      status: "paid",
      paidAt: new Date(1780833600000),
      paymentStatus: "completed",
      paymentMethod: "cash",
      paymentTransactionId: "pay_order-101_1780833600000",
      updatedAt: new Date(1780833600000),
    });
    expect(
      statementContaining(statements, "UPDATE payment_transactions")?.payload,
    ).toMatchObject({
      status: "paid",
      updatedAt: new Date(1780833600000),
      completedAt: new Date(1780833600000),
    });
    expect(
      statements
        .filter((statement) =>
          statement.sql.includes("INSERT OR IGNORE INTO payment_audit_log"),
        )
        .map(
          (statement) => (statement.payload as { eventType: string }).eventType,
        ),
    ).toEqual(["attempt", "success"]);
  });

  it("replays a recorded payment for the same idempotency key without new writes", async () => {
    const { db, committed, statements } = createD1();
    queueReplayRows([[order()]], [[paymentTransaction()]]);

    await expect(
      new PaymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 120,
          expectedTotal: 120,
          method: "cash",
        },
        { idempotencyKey: "idem-1" },
      ),
    ).resolves.toEqual({
      status: 200,
      data: {
        paymentId: "pay_order-101_1780833600000",
        orderId: "order-101",
        orderStatus: "paid",
        // The recorded transaction row says "paid" (PAYMENT_TRANSACTION_STATUS);
        // the replayed response must still report the order's own vocabulary,
        // or it would contradict the live call it is replaying.
        paymentStatus: "completed",
        authorizedTotal: 120,
      },
    });

    expect(committed).toEqual([]);
    expect(statements).toEqual([]);
    expect(mocks.db.batch).not.toHaveBeenCalled();
  });

  it("reports the order's own status when the replayed payment did not close it", async () => {
    const { db } = createD1();
    queueReplayRows(
      [[order({ status: "preparing" })]],
      [[paymentTransaction({ metadata: { closeOrder: false } })]],
    );

    await expect(
      new PaymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 120,
          expectedTotal: 120,
          method: "cash",
          closeOrder: false,
        },
        { idempotencyKey: "idem-1" },
      ),
    ).resolves.toMatchObject({
      status: 200,
      data: { orderStatus: "preparing", paymentStatus: "completed" },
    });
  });

  it("rejects an idempotency key already recorded against a different order", async () => {
    const { db, committed, statements } = createD1();
    queueReplayRows(
      [[order({ id: "order-mine" })]],
      [[paymentTransaction({ orderId: "order-other" })]],
    );

    await expect(
      new PaymentService(env(db)).processPayment(
        {
          orderId: "order-mine",
          paymentMode: "full",
          amount: 120,
          expectedTotal: 120,
          method: "cash",
        },
        { idempotencyKey: "idem-1" },
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_ORDER_MISMATCH",
      status: 422,
    });

    // The rejection is now traced (#350), but the original guarantee still
    // holds: nothing that mutates payment state ran. The only committed
    // statement is the audit row.
    expect(
      preparedAuditEvents(statements).map((event) => event.errorCode),
    ).toEqual(["IDEMPOTENCY_ORDER_MISMATCH"]);
    expect(
      statements.filter((statement) => statement.payload !== undefined),
    ).toEqual([]);
    expect(committed.map((statement) => statement.sql)).toEqual([
      expect.stringContaining("payment_audit_log"),
    ]);
    expect(mocks.db.batch).not.toHaveBeenCalled();
  });

  it("authorises the caller for the order before replaying a recorded payment", async () => {
    const { db } = createD1();
    queueReplayRows(
      [[order({ restaurantId: "restaurant-1" })], [order()]],
      [[paymentTransaction()], [paymentTransaction()]],
    );
    const service = new PaymentService(env(db));

    await expect(
      service.processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 120,
        },
        {
          idempotencyKey: "idem-1",
          user: {
            id: "user-42",
            username: "owner",
            role: 1,
            restaurantId: "restaurant-2",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    await expect(
      service.processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 120,
        },
        {
          idempotencyKey: "idem-1",
          user: {
            id: "user-2",
            username: "chef",
            role: 2,
            restaurantId: "restaurant-1",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_ROLE",
      status: 403,
    });
  });

  it("does not commit payment ledger writes when a middle write fails", async () => {
    const { db, committed, statements } = createD1WithBatchFailure(
      (statement) => statement.sql.includes("UPDATE payment_transactions"),
    );
    queueOrderRows([[order()]]);
    mockOrderUpdate([{ status: "paid", paymentStatus: "paid" }]);

    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
        expectedTotal: 120,
        method: "cash",
      }),
    ).rejects.toThrow("injected batch failure");

    expect(db.batch).toHaveBeenCalledOnce();
    // This is the drift the audit row matters most for: the order was already
    // flipped to paid, the ledger never landed, and before #350 the only trace
    // was a console line. The thrown value is a plain Error, not an ApiError,
    // so it is recorded under UNEXPECTED_ERROR.
    expect(committed.map((statement) => statement.sql)).toEqual([
      expect.stringContaining("UPDATE orders"),
      expect.stringContaining("payment_audit_log"),
    ]);
    expect(preparedAuditEvents(statements)).toEqual([
      expect.objectContaining({
        eventType: "failure",
        errorCode: "UNEXPECTED_ERROR",
        restaurantId: "restaurant-1",
      }),
    ]);
  });

  it("rejects payment finalization when the payable-state guard loses the race", async () => {
    const { db } = createD1(0);
    queueOrderRows([[order()]]);
    mockOrderUpdate([{ status: "paid", paymentStatus: "paid" }]);

    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
        expectedTotal: 120,
        method: "cash",
      }),
    ).rejects.toMatchObject({
      code: "ORDER_NOT_PAYABLE",
      status: 409,
    });

    expect(db.batch).not.toHaveBeenCalled();
  });

  it("processes partial payments without closing the order when requested", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order({ status: "served" })]]);
    mockOrderUpdate([{ status: "served", paymentStatus: "paid" }]);

    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "partial",
        expectedTotal: 120,
        payments: [
          { method: "cash", amount: 50 },
          { method: "card", amount: 70 },
        ],
        gateway: "mixed",
        closeOrder: false,
      }),
    ).resolves.toMatchObject({
      data: {
        orderStatus: "served",
        paymentStatus: "completed",
        authorizedTotal: 120,
      },
    });

    expect(statementContaining(statements, "UPDATE orders")?.payload).toEqual({
      paymentStatus: "completed",
      paymentMethod: "split",
      paymentTransactionId: "pay_order-101_1780833600000",
      updatedAt: new Date(1780833600000),
    });
    expect(
      (
        statementContaining(statements, "INSERT INTO payment_transactions")
          ?.payload as { paymentMethod: string }
      ).paymentMethod,
    ).toBe("split");
    expect(
      statementContaining(statements, "INSERT INTO payment_transactions")
        ?.payload,
    ).toMatchObject({
      metadata: { paymentMode: "partial", closeOrder: false },
    });
  });

  it("releases occupied tables when a payment closes the order", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order({ tableId: 9 })]]);
    mockOrderUpdate([{ status: "paid", paymentStatus: "paid" }]);

    await new PaymentService(env(db)).processPayment({
      orderId: "order-101",
      paymentMode: "full",
      amount: 120,
      expectedTotal: 120,
      method: "cash",
    });

    expect(statementContaining(statements, "UPDATE tables")?.payload).toEqual({
      isOccupied: false,
      currentOrderId: null,
      occupiedAt: null,
      occupiedBy: null,
      updatedAt: new Date(1780833600000),
    });
  });

  it("invalidates order cache and broadcasts paid status when payment closes the order", async () => {
    const { db } = createD1();
    const setup = envWithRealtime(db);
    queueOrderRows([
      [
        order({
          orderNumber: "A001",
          status: "served",
        }),
      ],
    ]);
    mockOrderUpdate([{ status: "paid", paymentStatus: "paid" }]);

    await new PaymentService(setup.env).processPayment(
      {
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
        expectedTotal: 120,
        method: "cash",
      },
      {
        user: {
          id: "user-4",
          role: 4,
          restaurantId: "restaurant-1",
          username: "cashier",
        },
      },
    );

    expect(setup.cacheKV.delete).toHaveBeenCalledWith("order:order-101:full");
    expect(setup.cacheKV.delete).toHaveBeenCalledWith("order:order-101:basic");
    // restaurant + kitchen + admin rooms (admin added in bug-inventory fix #1),
    // plus the per-order customer room that 2b894649 added so the diner's order
    // tracking page updates on payment.
    expect(setup.fetch).toHaveBeenCalledTimes(4);

    const event = JSON.parse(
      String(setup.fetch.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(event).toMatchObject({
      type: "order_status_update",
      restaurantId: "restaurant-1",
      data: {
        orderId: "order-101",
        orderNumber: "A001",
        previousStatus: "served",
        status: "paid",
        updatedBy: {
          userId: "user-4",
          role: "cashier",
        },
      },
    });
  });

  it("does not fail a committed payment when close-order side effects fail", async () => {
    const { db } = createD1();
    const setup = envWithRealtime(db);
    setup.cacheKV.delete.mockRejectedValueOnce(new Error("kv unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    queueOrderRows([[order()]]);
    mockOrderUpdate([{ status: "paid", paymentStatus: "paid" }]);

    await expect(
      new PaymentService(setup.env).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
        expectedTotal: 120,
        method: "cash",
      }),
    ).resolves.toMatchObject({
      status: 200,
      data: {
        paymentId: "pay_order-101_1780833600000",
        orderStatus: "paid",
      },
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "Payment succeeded but order side effects failed",
      expect.objectContaining({ orderId: "order-101" }),
    );
    errorSpy.mockRestore();
  });

  it("rejects finalized orders and staff roles without payment authority", async () => {
    const { db, statements } = createD1();
    queueOrderRows([
      // Deliberately the pre-#311 spelling. Rows written before the three
      // writers moved to "completed" still exist, and `isAlreadyFinalized`
      // has to keep recognising them or an already-paid legacy order could be
      // charged a second time.
      [order({ paymentStatus: "paid" })],
      [order({ status: "cancelled", paymentStatus: "pending" })],
      [order()],
    ]);
    mockOrderUpdate();
    const service = new PaymentService(env(db));

    await expect(
      service.processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
      }),
    ).rejects.toMatchObject({
      code: "ORDER_NOT_PAYABLE",
      status: 409,
    });

    await expect(
      service.processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
      }),
    ).rejects.toMatchObject({
      code: "ORDER_NOT_PAYABLE",
      status: 409,
    });

    await expect(
      service.processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 120,
        },
        {
          user: {
            id: "user-2",
            username: "chef",
            role: 2,
            restaurantId: "restaurant-1",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_ROLE",
      status: 403,
    });
    // Before #350 these three attempts vanished without a record: the ATTEMPT
    // audit row is written inside the batch, which none of them reach.
    expect(
      preparedAuditEvents(statements).map((event) => event.errorCode),
    ).toEqual(["ORDER_NOT_PAYABLE", "ORDER_NOT_PAYABLE", "INSUFFICIENT_ROLE"]);
  });

  it("rejects missing orders, restaurant mismatches, and stale totals", async () => {
    const { db, statements } = createD1();
    queueOrderRows([
      [],
      [order({ restaurantId: "restaurant-1" })],
      [order({ totalAmountCents: 12000 })],
      [order({ totalAmountCents: 12000 })],
    ]);
    mockOrderUpdate();
    const service = new PaymentService(env(db));

    await expect(
      service.processPayment({
        orderId: "order-404",
        paymentMode: "full",
        amount: 120,
      }),
    ).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
      status: 404,
    });

    await expect(
      service.processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 120,
        },
        {
          user: {
            id: "user-42",
            username: "owner",
            role: 1,
            restaurantId: "restaurant-2",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    await expect(
      service.processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 119,
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_AMOUNT_MISMATCH",
      status: 409,
    });

    await expect(
      service.processPayment({
        orderId: "order-101",
        paymentMode: "partial",
        expectedTotal: 120,
        payments: [
          { method: "cash", amount: 60 },
          { method: "card", amount: 59 },
        ],
      }),
    ).rejects.toMatchObject({
      code: "PARTIAL_PAYMENT_TOTAL_MISMATCH",
      status: 409,
    });
    // ORDER_NOT_FOUND is the one rejection with no restaurant to scope a row
    // to, so it stays untraced; the other three are recorded.
    expect(
      preparedAuditEvents(statements).map((event) => event.errorCode),
    ).toEqual([
      "FORBIDDEN",
      "PAYMENT_AMOUNT_MISMATCH",
      "PARTIAL_PAYMENT_TOTAL_MISMATCH",
    ]);
  });

  it("records a failure audit row scoped to the order's restaurant", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order({ totalAmountCents: 12000 })]]);
    mockOrderUpdate();

    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 119,
        method: "cash",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH", status: 409 });

    const events = preparedAuditEvents(statements);
    expect(events).toEqual([
      expect.objectContaining({
        restaurantId: "restaurant-1",
        eventType: "failure",
        errorCode: "PAYMENT_AMOUNT_MISMATCH",
        provider: "cash",
        amount: 12000,
        // No `payment_transactions` row exists to point at: that insert lives
        // inside the batch this attempt never reached.
        paymentTransactionId: null,
      }),
    ]);
    expect(JSON.parse(String(events[0].rawPayload))).toMatchObject({
      orderId: "order-101",
      paymentMode: "full",
      submittedAmount: 119,
      serverTotalCents: 12000,
    });
    expect(
      statementContaining(statements, "INSERT INTO payment_transactions"),
    ).toBeUndefined();
  });

  it("attributes a cross-tenant attempt to the target restaurant", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order({ restaurantId: "restaurant-1" })]]);
    mockOrderUpdate();

    await expect(
      new PaymentService(env(db)).processPayment(
        { orderId: "order-101", paymentMode: "full", amount: 120 },
        {
          user: {
            id: "user-42",
            username: "owner",
            role: 1,
            restaurantId: "restaurant-2",
          },
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    // The row belongs to the restaurant whose order was targeted, not to the
    // caller's own restaurant — otherwise the trace lands in the wrong tenant's
    // audit log and the victim cannot see it.
    expect(preparedAuditEvents(statements)).toEqual([
      expect.objectContaining({
        restaurantId: "restaurant-1",
        errorCode: "FORBIDDEN",
      }),
    ]);
  });

  it("records nothing when the order does not exist", async () => {
    const { db } = createD1();
    queueOrderRows([[]]);
    mockOrderUpdate();

    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-404",
        paymentMode: "full",
        amount: 120,
      }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND", status: 404 });

    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("surfaces the original rejection when the audit write itself fails", async () => {
    const { db } = createD1();
    queueOrderRows([[order({ totalAmountCents: 12000 })]]);
    mockOrderUpdate();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    db.prepare.mockImplementation((sql: string) => {
      const statement: PreparedStatement = {
        sql,
        values: [],
        bind: vi.fn(() => statement),
        run: vi.fn(async () => {
          throw new Error("audit sink down");
        }),
      };
      return statement;
    });

    // Observability must not decide whether the payment path is correct: the
    // caller still has to see why the payment was refused.
    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 119,
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH", status: 409 });

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("alerts the owner when the submitted amount disagrees with the total", async () => {
    const { db } = createD1();
    queueOrderRows([[order({ totalAmountCents: 12000 })]]);
    mockOrderUpdate();

    await expect(
      new PaymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 119,
          method: "cash",
        },
        { currency: "TWD" },
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH", status: 409 });

    expect(mocks.raisePaymentFailedAlert).toHaveBeenCalledOnce();
    expect(mocks.raisePaymentFailedAlert).toHaveBeenCalledWith(
      expect.objectContaining({ DB: db }),
      expect.objectContaining({
        restaurantId: "restaurant-1",
        orderId: "order-101",
        orderNumber: "A-001",
        errorCode: "PAYMENT_AMOUNT_MISMATCH",
        // Major units, matching what the owner sees on the order.
        submittedAmount: 119,
        serverTotal: 120,
        currency: "TWD",
      }),
    );
  });

  // The drift case: `UPDATE orders` already flipped the order to paid and the
  // ledger write never landed, so only the owner can reconcile it.
  it("alerts the owner when the closing batch fails after the order flipped", async () => {
    const { db } = createD1WithBatchFailure((statement) =>
      statement.sql.includes("UPDATE payment_transactions"),
    );
    queueOrderRows([[order()]]);
    mockOrderUpdate([{ status: "paid", paymentStatus: "paid" }]);

    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
        expectedTotal: 120,
        method: "cash",
      }),
    ).rejects.toThrow("injected batch failure");

    expect(mocks.raisePaymentFailedAlert).toHaveBeenCalledOnce();
    expect(mocks.raisePaymentFailedAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        restaurantId: "restaurant-1",
        orderId: "order-101",
        errorCode: "UNEXPECTED_ERROR",
      }),
    );
  });

  // A double-tap on a finalised order is not the owner's problem: the money is
  // where it should be. It stays in the audit log and off the panel.
  it("keeps a non-payable order out of the owner's alert panel", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order({ status: "paid", paymentStatus: "completed" })]]);
    mockOrderUpdate();

    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
      }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_PAYABLE", status: 409 });

    expect(
      preparedAuditEvents(statements).map((event) => event.errorCode),
    ).toEqual(["ORDER_NOT_PAYABLE"]);
    expect(mocks.raisePaymentFailedAlert).not.toHaveBeenCalled();
  });

  // Same posture as the audit write: the caller must learn why the payment was
  // refused whether or not the alert lands.
  it("surfaces the original rejection when the alert producer throws", async () => {
    const { db } = createD1();
    queueOrderRows([[order({ totalAmountCents: 12000 })]]);
    mockOrderUpdate();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.raisePaymentFailedAlert.mockRejectedValueOnce(
      new Error("alert sink down"),
    );

    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 119,
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH", status: 409 });

    expect(mocks.raisePaymentFailedAlert).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to raise payment failure alert",
      expect.objectContaining({ orderId: "order-101" }),
    );
    consoleError.mockRestore();
  });

  it("exposes ApiError details for mismatched expected totals", async () => {
    const { db } = createD1();
    queueOrderRows([[order({ totalAmountCents: 12000 })]]);
    mockOrderUpdate();

    await expect(
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
        expectedTotal: 121,
      }),
    ).rejects.toEqual(
      new ApiError(
        "PAYMENT_TOTAL_MISMATCH",
        "Expected total does not match authoritative order total",
        409,
        { expected: 120, actual: 121 },
      ),
    );
  });
});
