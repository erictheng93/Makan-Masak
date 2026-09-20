import { beforeEach, describe, expect, it, vi } from "vitest";
import { orders, paymentTransactions } from "@makanmasak/database";
import { createSelectFixtureDb } from "@makanmasak/database/testing";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { Env } from "../../../types/env";
import type { AuthUser } from "../../../middleware/auth";
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
  resolveRestaurantCurrency: vi.fn(),
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

// The restaurant's currency is read through drizzle, which is mocked wholesale
// above; the resolver has its own real-D1 suite. Only the read is stubbed —
// the client-claim comparison runs for real.
vi.mock(
  "../../../shared/utils/restaurant-currency",
  async (importOriginal) => ({
    ...((await importOriginal()) as Record<string, unknown>),
    resolveRestaurantCurrency: mocks.resolveRestaurantCurrency,
  }),
);

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
    roundingAdjustmentCents: 0,
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

function paymentService(envValue: Env) {
  const service = new PaymentService(envValue);
  const processPayment = service.processPayment.bind(service);
  return {
    processPayment(
      input: Parameters<PaymentService["processPayment"]>[0],
      options?: Omit<
        Parameters<PaymentService["processPayment"]>[1],
        "actor"
      > & {
        user?: AuthUser;
      },
    ) {
      const { user, ...paymentOptions } = options ?? {};
      return processPayment(input, {
        actor: {
          kind: "staff",
          user:
            user ??
            ({
              id: "cashier-1",
              username: "cashier",
              role: 4,
              restaurantId: "restaurant-1",
            } as AuthUser),
        },
        ...paymentOptions,
      });
    },
  };
}

describe("PaymentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1780833600000);
    mocks.resolveRestaurantCurrency.mockResolvedValue("TWD");
  });

  it("rejects payment attempts that do not identify a trusted actor", async () => {
    const { db } = createD1();

    await expect(
      // @ts-expect-error PaymentService requires an explicit trusted actor.
      new PaymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_ACTOR_REQUIRED",
      status: 403,
    });
  });

  it("rejects provider actors without a provider transaction id", async () => {
    const { db } = createD1();

    await expect(
      new PaymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 120,
        },
        {
          actor: {
            kind: "provider",
            provider: "stripe",
            providerTransactionId: "",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_ACTOR_REQUIRED",
      status: 403,
    });
  });

  it("records the verified provider and its transaction reference", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order()]]);
    mockOrderUpdate([{ status: "paid", paymentStatus: "paid" }]);

    const result = await new PaymentService(env(db)).processPayment(
      {
        orderId: "order-101",
        paymentMode: "full",
        amount: 120,
        method: "card",
        gateway: "untrusted-input-gateway",
      },
      {
        actor: {
          kind: "provider",
          provider: "verified-provider",
          providerTransactionId: "provider-payment-123",
        },
      },
    );

    expect(result.data.paymentStatus).toBe("completed");
    expect(
      statementContaining(statements, "INSERT INTO payment_transactions")
        ?.payload,
    ).toMatchObject({
      gateway: "verified-provider",
      providerTransactionId: "provider-payment-123",
    });
  });

  it("rejects non-platform staff without a restaurant assignment", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order()]]);

    await expect(
      new PaymentService(env(db)).processPayment(
        { orderId: "order-101", paymentMode: "full", amount: 120 },
        {
          actor: {
            kind: "staff",
            user: { id: "cashier-1", username: "cashier", role: 4 },
          },
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(
      statementContaining(statements, "INSERT INTO payment_transactions"),
    ).toBeUndefined();
    expect(statementContaining(statements, "UPDATE orders")).toBeUndefined();
  });

  it("processes full payments from the authoritative order total", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order()]]);
    mockOrderUpdate([{ status: "paid", paymentStatus: "paid" }]);

    await expect(
      paymentService(env(db)).processPayment(
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
        collectedTotal: 120,
        roundingAdjustment: 0,
        currency: "TWD",
        country: "TW",
      },
    });
    expect(mocks.resolveRestaurantCurrency).toHaveBeenCalledWith(
      db,
      "restaurant-1",
    );

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

  it("records the restaurant's currency when the cashier sends none", async () => {
    mocks.resolveRestaurantCurrency.mockResolvedValue("MYR");
    const { db, statements } = createD1();
    queueOrderRows([[order({ totalAmount: 45.5, totalAmountCents: 4550 })]]);

    await expect(
      paymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 45.5,
          method: "cash",
        },
        { idempotencyKey: "idem-myr" },
      ),
    ).resolves.toMatchObject({
      data: { currency: "MYR", country: "MY", authorizedTotal: 45.5 },
    });

    expect(
      statementContaining(statements, "INSERT INTO payment_transactions")
        ?.payload,
    ).toMatchObject({ amountCents: 4550, currency: "MYR", countryCode: "MY" });
    expect(
      statements
        .filter((statement) =>
          statement.sql.includes("INSERT OR IGNORE INTO payment_audit_log"),
        )
        .map(
          (statement) => (statement.payload as { currency: string }).currency,
        ),
    ).toEqual(["MYR", "MYR"]);
  });

  it("rejects a client currency that disagrees with the restaurant's", async () => {
    mocks.resolveRestaurantCurrency.mockResolvedValue("MYR");
    const { db, statements } = createD1();
    queueOrderRows([[order()]]);

    await expect(
      paymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 120,
          method: "cash",
        },
        { country: "TW", currency: "TWD", idempotencyKey: "idem-lie" },
      ),
    ).rejects.toMatchObject({ code: "CURRENCY_MISMATCH", status: 400 });

    expect(statementContaining(statements, "UPDATE orders")).toBeUndefined();
    // The failure row names no currency: the claim was the thing refused, and
    // the server's answer was never attached to a charge.
    expect(preparedAuditEvents(statements)).toEqual([
      expect.objectContaining({
        errorCode: "CURRENCY_MISMATCH",
        currency: null,
      }),
    ]);
  });

  it("requires whole-dollar split lines for a TWD order", async () => {
    const { db, statements } = createD1();
    queueOrderRows([[order({ totalAmount: 171, totalAmountCents: 17100 })]]);

    await expect(
      paymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "partial",
          payments: [
            { method: "cash", amount: 85.5 },
            { method: "card", amount: 85.5 },
          ],
        },
        { idempotencyKey: "idem-split" },
      ),
    ).rejects.toMatchObject({
      code: "AMOUNT_PRECISION_INVALID",
      status: 400,
      details: { currency: "TWD" },
    });
    expect(statementContaining(statements, "UPDATE orders")).toBeUndefined();
    expect(preparedAuditEvents(statements)).toEqual([
      expect.objectContaining({
        errorCode: "AMOUNT_PRECISION_INVALID",
        currency: "TWD",
      }),
    ]);
  });

  it("lets one split line carry the odd remainder of an off-step TWD total", async () => {
    // Orders priced before per-line rounding can total NT$170.50. One line
    // must be allowed to carry the .50, or the order can never be split.
    const { db, statements } = createD1();
    queueOrderRows([[order({ totalAmount: 170.5, totalAmountCents: 17050 })]]);

    await expect(
      paymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "partial",
          payments: [
            { method: "cash", amount: 100 },
            { method: "card", amount: 70.5 },
          ],
        },
        { idempotencyKey: "idem-odd" },
      ),
    ).resolves.toMatchObject({ data: { authorizedTotal: 170.5 } });
    expect(
      statementContaining(statements, "INSERT INTO payment_transactions")
        ?.payload,
    ).toMatchObject({ amountCents: 17050, currency: "TWD" });

    // …but only one: two off-step lines are still refused.
    const second = createD1();
    queueOrderRows([[order({ totalAmount: 170.5, totalAmountCents: 17050 })]]);
    await expect(
      paymentService(env(second.db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "partial",
          payments: [
            { method: "cash", amount: 100.25 },
            { method: "card", amount: 70.25 },
          ],
        },
        { idempotencyKey: "idem-odd-2" },
      ),
    ).rejects.toMatchObject({ code: "AMOUNT_PRECISION_INVALID" });
  });

  it("pays an off-step TWD total in full", async () => {
    const { db } = createD1();
    queueOrderRows([[order({ totalAmount: 170.5, totalAmountCents: 17050 })]]);

    await expect(
      paymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 170.5,
          expectedTotal: 170.5,
          method: "cash",
        },
        { idempotencyKey: "idem-full-odd" },
      ),
    ).resolves.toMatchObject({ data: { authorizedTotal: 170.5 } });
  });

  it("allows cent-level split lines for MYR", async () => {
    mocks.resolveRestaurantCurrency.mockResolvedValue("MYR");
    const { db } = createD1();
    queueOrderRows([[order({ totalAmount: 171, totalAmountCents: 17100 })]]);

    await expect(
      paymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "partial",
          payments: [
            { method: "cash", amount: 85.55 },
            { method: "card", amount: 85.45 },
          ],
        },
        { idempotencyKey: "idem-myr-split" },
      ),
    ).resolves.toMatchObject({ data: { currency: "MYR" } });
  });

  it("replays a recorded payment for the same idempotency key without new writes", async () => {
    const { db, committed, statements } = createD1();
    queueReplayRows([[order()]], [[paymentTransaction()]]);

    await expect(
      paymentService(env(db)).processPayment(
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
        collectedTotal: 120,
        roundingAdjustment: 0,
        currency: null,
        country: null,
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
      paymentService(env(db)).processPayment(
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
      paymentService(env(db)).processPayment(
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
    const service = paymentService(env(db));

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
      paymentService(env(db)).processPayment({
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
      paymentService(env(db)).processPayment({
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
      paymentService(env(db)).processPayment({
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

    await paymentService(env(db)).processPayment({
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

    await paymentService(setup.env).processPayment(
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
      paymentService(setup.env).processPayment({
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
    const service = paymentService(env(db));

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
    const service = paymentService(env(db));

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
      paymentService(env(db)).processPayment({
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
      paymentService(env(db)).processPayment(
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
      paymentService(env(db)).processPayment({
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
      paymentService(env(db)).processPayment({
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
      paymentService(env(db)).processPayment(
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
      paymentService(env(db)).processPayment({
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
      paymentService(env(db)).processPayment({
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
      paymentService(env(db)).processPayment({
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
      paymentService(env(db)).processPayment({
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
  // --- MYR cash rounding (#405) ---------------------------------------
  //
  // Malaysia's 1 and 2 sen coins are out of circulation, so a cash bill is
  // collected to the nearest 5 sen. The order total never moves; the payment
  // records what was collected and the difference beside it.

  function myrOrder(totalCents: number) {
    mocks.resolveRestaurantCurrency.mockResolvedValue("MYR");
    queueOrderRows([
      [order({ totalAmount: totalCents / 100, totalAmountCents: totalCents })],
    ]);
  }

  function recordedPayment(statements: PreparedStatement[]) {
    return statementContaining(statements, "INSERT INTO payment_transactions")
      ?.payload as Record<string, unknown> | undefined;
  }

  it("collects the rounded figure for an MYR cash payment and records the 2 sen", async () => {
    const { db, statements } = createD1();
    myrOrder(1033);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 10.35,
        expectedTotal: 10.33,
        method: "cash",
      }),
    ).resolves.toMatchObject({
      data: {
        authorizedTotal: 10.33,
        collectedTotal: 10.35,
        roundingAdjustment: 0.02,
      },
    });

    expect(recordedPayment(statements)).toMatchObject({
      amountCents: 1035,
      roundingAdjustmentCents: 2,
      paymentMethod: "cash",
    });
  });

  it("rounds an MYR cash payment down when the total ends in 1 or 2 sen", async () => {
    const { db, statements } = createD1();
    myrOrder(1032);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 10.3,
        method: "cash",
      }),
    ).resolves.toMatchObject({
      data: { collectedTotal: 10.3, roundingAdjustment: -0.02 },
    });

    expect(recordedPayment(statements)).toMatchObject({
      amountCents: 1030,
      roundingAdjustmentCents: -2,
    });
  });

  it("accepts the unrounded total from a cashier and still records the rounded one", async () => {
    // The server decides what is collectable; the submitted figure is only
    // checked. A till that has not been updated must not be refused.
    const { db, statements } = createD1();
    myrOrder(1033);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 10.33,
        method: "cash",
      }),
    ).resolves.toMatchObject({ data: { collectedTotal: 10.35 } });

    expect(recordedPayment(statements)).toMatchObject({
      amountCents: 1035,
      roundingAdjustmentCents: 2,
    });
  });

  it("rejects a cash amount that is neither the total nor the rounded total", async () => {
    const { db, statements } = createD1();
    myrOrder(1033);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 10.34,
        method: "cash",
      }),
    ).rejects.toEqual(
      new ApiError(
        "PAYMENT_AMOUNT_MISMATCH",
        "Payment amount does not match order total",
        409,
        { expected: 10.33, expectedCollected: 10.35, actual: 10.34 },
      ),
    );

    expect(statementContaining(statements, "UPDATE orders")).toBeUndefined();
  });

  it("names only one expected figure when rounding did not move the total", async () => {
    const { db } = createD1();
    myrOrder(1035);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 10.4,
        method: "cash",
      }),
    ).rejects.toEqual(
      new ApiError(
        "PAYMENT_AMOUNT_MISMATCH",
        "Payment amount does not match order total",
        409,
        { expected: 10.35, actual: 10.4 },
      ),
    );
  });

  it("collects the exact total for the same MYR order paid by card", async () => {
    const { db, statements } = createD1();
    myrOrder(1033);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 10.33,
        method: "card",
      }),
    ).resolves.toMatchObject({
      data: {
        authorizedTotal: 10.33,
        collectedTotal: 10.33,
        roundingAdjustment: 0,
      },
    });

    expect(recordedPayment(statements)).toMatchObject({
      amountCents: 1033,
      roundingAdjustmentCents: 0,
    });
  });

  it("collects the exact total for an MYR e-wallet payment", async () => {
    const { db, statements } = createD1();
    myrOrder(1033);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 10.33,
        method: "touch_n_go",
      }),
    ).resolves.toMatchObject({ data: { roundingAdjustment: 0 } });

    expect(recordedPayment(statements)).toMatchObject({
      amountCents: 1033,
      roundingAdjustmentCents: 0,
    });
  });

  it("leaves a TWD cash payment unrounded", async () => {
    const { db, statements } = createD1();
    mocks.resolveRestaurantCurrency.mockResolvedValue("TWD");
    queueOrderRows([[order({ totalAmount: 350, totalAmountCents: 35000 })]]);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 350,
        method: "cash",
      }),
    ).resolves.toMatchObject({
      data: {
        authorizedTotal: 350,
        collectedTotal: 350,
        roundingAdjustment: 0,
      },
    });

    expect(recordedPayment(statements)).toMatchObject({
      amountCents: 35000,
      roundingAdjustmentCents: 0,
    });
  });

  it("audits the collected figure, not the priced one", async () => {
    const { db, statements } = createD1();
    myrOrder(1033);
    mockOrderUpdate();

    await paymentService(env(db)).processPayment({
      orderId: "order-101",
      paymentMode: "full",
      amount: 10.35,
      method: "cash",
    });

    expect(
      statements
        .filter((statement) =>
          statement.sql.includes("INSERT OR IGNORE INTO payment_audit_log"),
        )
        .map((statement) => (statement.payload as { amount: number }).amount),
    ).toEqual([1035, 1035]);
  });

  it("reports the same totals when an idempotent retry replays a rounded payment", async () => {
    const { db } = createD1();
    mocks.resolveRestaurantCurrency.mockResolvedValue("MYR");
    queueReplayRows(
      [[order({ totalAmount: 10.33, totalAmountCents: 1033 })]],
      [[paymentTransaction({ amountCents: 1035, roundingAdjustmentCents: 2 })]],
    );

    await expect(
      paymentService(env(db)).processPayment(
        {
          orderId: "order-101",
          paymentMode: "full",
          amount: 10.35,
          method: "cash",
        },
        { idempotencyKey: "idem-rounded" },
      ),
    ).resolves.toMatchObject({
      status: 200,
      data: {
        authorizedTotal: 10.33,
        collectedTotal: 10.35,
        roundingAdjustment: 0.02,
      },
    });
  });

  it("accepts the rounded figure as expectedTotal, which the route defaults to", async () => {
    // POST /payments falls back to `expectedTotal = amount` when a caller
    // sends only an amount, so refusing the rounded figure here would make a
    // bare cash payment at the collectable amount unpayable.
    const { db, statements } = createD1();
    myrOrder(1033);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 10.35,
        expectedTotal: 10.35,
        method: "cash",
      }),
    ).resolves.toMatchObject({ data: { collectedTotal: 10.35 } });

    expect(recordedPayment(statements)).toMatchObject({ amountCents: 1035 });
  });

  it("still rejects an expectedTotal that is neither figure", async () => {
    const { db } = createD1();
    myrOrder(1033);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "full",
        amount: 10.35,
        expectedTotal: 10.5,
        method: "cash",
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_TOTAL_MISMATCH",
      status: 409,
    });
  });

  it("does not round a split payment, whose legs are priced individually", async () => {
    const { db, statements } = createD1();
    myrOrder(1033);
    mockOrderUpdate();

    await expect(
      paymentService(env(db)).processPayment({
        orderId: "order-101",
        paymentMode: "partial",
        payments: [
          { method: "cash", amount: 5.33 },
          { method: "card", amount: 5 },
        ],
      }),
    ).resolves.toMatchObject({ data: { roundingAdjustment: 0 } });

    expect(recordedPayment(statements)).toMatchObject({
      amountCents: 1033,
      roundingAdjustmentCents: 0,
      paymentMethod: "split",
    });
  });
});
