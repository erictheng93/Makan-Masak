import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";
import {
  refundPaymentTransaction,
  toExternalPaymentStatus,
} from "./refundPayment";

vi.mock("@makanmasak/utils", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  generateUUID: vi.fn(() => "audit-id"),
}));

// Reads restaurants.settings through drizzle; its own suite covers real D1.
const resolveRestaurantCurrency = vi.hoisted(() =>
  vi.fn(async () => "TWD" as const),
);
vi.mock("../../../shared/utils/restaurant-currency", () => ({
  resolveRestaurantCurrency,
}));

interface PreparedStatement {
  sql: string;
  values: unknown[];
  bind: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
  raw: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

interface RefundOrderRow {
  id: string;
  restaurantId: string;
  totalAmountCents: number | null;
  refundAmountCents: number | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
}

/**
 * What the refund reads off `payment_transactions`: the amount actually
 * collected, which for a rounded MYR cash payment is up to 2 sen above the
 * order total (#405). `null` means the order predates the payment ledger, so
 * the refund falls back to the order total.
 */
interface RefundPaymentRow {
  amountCents: number;
}

function createD1(
  orderRow: RefundOrderRow | null,
  updateChanges = 1,
  paymentRow: RefundPaymentRow | null = null,
) {
  const statements: PreparedStatement[] = [];
  const committed: PreparedStatement[] = [];
  // Two different SELECTs run through this one mock. Drizzle maps a result
  // row onto the projection positionally, so handing the order row back for
  // the payment lookup would read `orders.id` as `amount_cents`.
  const rowFor = (sql: string): Record<string, unknown> | null => {
    const normalized = sql.toLowerCase().replaceAll('"', "");
    if (
      normalized.startsWith("select") &&
      normalized.includes("payment_transactions")
    ) {
      return paymentRow as Record<string, unknown> | null;
    }
    return orderRow as Record<string, unknown> | null;
  };
  const db = {
    prepare: vi.fn((sql: string) => {
      const row = rowFor(sql);
      const statement: PreparedStatement = {
        sql,
        values: [],
        bind: vi.fn((...values: unknown[]) => {
          statement.values = values;
          return statement;
        }),
        first: vi.fn(async () => row),
        raw: vi.fn(async () => (row ? [Object.values(row)] : [])),
        all: vi.fn(async () => ({
          results: row ? [row] : [],
        })),
        run: vi.fn(async () => {
          committed.push(statement);
          return {
            meta: {
              changes: statement.sql.toLowerCase().includes('update "orders"')
                ? updateChanges
                : 1,
            },
            success: true,
          };
        }),
      };
      statements.push(statement);
      return statement;
    }),
    batch: vi.fn(async (batchStatements: PreparedStatement[]) => {
      committed.push(...batchStatements);
      return batchStatements.map(() => ({
        meta: { changes: 1 },
        success: true,
      }));
    }),
  };

  return { db, statements, committed };
}

function createD1WithBatchFailure(
  orderRow: RefundOrderRow,
  failWhen: (statement: PreparedStatement) => boolean,
) {
  const setup = createD1(orderRow);
  setup.db.batch.mockImplementation(
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
  return { DB: db } as Env;
}

function paidOrder(overrides: Partial<RefundOrderRow> = {}): RefundOrderRow {
  return {
    id: "order-42",
    restaurantId: "restaurant-1",
    totalAmountCents: 12000,
    refundAmountCents: null,
    paymentMethod: "line_pay",
    paymentStatus: "completed",
    ...overrides,
  };
}

function statementContaining(statements: PreparedStatement[], text: string) {
  const normalizedText = text
    .toLowerCase()
    .replaceAll(" or ignore", "")
    .replaceAll('"', "");
  return statements.find((statement) =>
    statement.sql.toLowerCase().replaceAll('"', "").includes(normalizedText),
  );
}

const cashierUser = {
  id: "user-4",
  username: "cashier",
  role: 4,
  restaurantId: "restaurant-1",
};

describe("refundPaymentTransaction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1780833600000);
  });

  it("rejects missing and non-refundable transactions before mutating ledgers", async () => {
    let setup = createD1(null);

    await expect(
      refundPaymentTransaction(
        env(setup.db),
        { transactionId: "missing" },
        { user: cashierUser },
      ),
    ).rejects.toMatchObject({
      code: "TRANSACTION_NOT_FOUND",
      status: 404,
    });
    expect(setup.statements).toHaveLength(1);

    setup = createD1(paidOrder({ paymentStatus: "pending" }));

    await expect(
      refundPaymentTransaction(
        env(setup.db),
        { transactionId: "pending" },
        { user: cashierUser },
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_NOT_REFUNDABLE",
      status: 409,
    });
    expect(setup.statements).toHaveLength(1);
  });

  it("fails closed when refund access is missing a user", async () => {
    const setup = createD1(paidOrder());

    await expect(
      refundPaymentTransaction(env(setup.db), { transactionId: "txn-1" }),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 403,
    });
    expect(setup.db.batch).not.toHaveBeenCalled();
    expect(setup.statements).toHaveLength(0);
  });

  it("records partial refunds with existing refunded cents and fallback providers", async () => {
    const { db, statements } = createD1(
      paidOrder({
        refundAmountCents: 2000,
        paymentMethod: null,
      }),
    );

    await expect(
      refundPaymentTransaction(
        env(db),
        {
          transactionId: "txn-1",
          amount: 30,
          reason: "customer changed mind",
        },
        { user: cashierUser },
      ),
    ).resolves.toEqual({
      refundId: "ref_txn-1_1780833600000",
      transactionId: "txn-1",
      orderId: "order-42",
      amount: 30,
      status: "completed",
      paymentStatus: "partial_refunded",
    });

    expect(
      statementContaining(
        statements,
        "INSERT OR IGNORE INTO payment_transactions",
      )?.values,
    ).toEqual([
      "txn-1",
      "order-42",
      "restaurant-1",
      12000,
      // rounding_adjustment_cents, filled from its schema default: the legacy
      // backfill row reconstructs a payment that predates cash rounding (#405).
      0,
      "unknown",
      "paid",
      JSON.stringify({ source: "refund_legacy_backfill" }),
      1780833600000,
      1780833600000,
      1780833600000,
    ]);
    expect(statementContaining(statements, "UPDATE orders")?.values).toEqual(
      expect.arrayContaining([
        "partial_refunded",
        3000,
        1780833600000,
        "order-42",
        "txn-1",
      ]),
    );
    expect(
      statementContaining(statements, "UPDATE payment_transactions")?.values,
    ).toEqual(["partial_refunded", 1780833600000, "txn-1"]);
    expect(
      statementContaining(statements, "INSERT INTO refund_transactions")
        ?.values,
    ).toEqual([
      "ref_txn-1_1780833600000",
      "txn-1",
      "order-42",
      "restaurant-1",
      3000,
      "customer changed mind",
      "completed",
      1780833600000,
      1780833600000,
      1780833600000,
    ]);
    expect(
      statementContaining(statements, "INSERT OR IGNORE INTO payment_audit_log")
        ?.values,
    ).toEqual([
      "audit-id",
      "restaurant-1",
      "txn-1",
      null,
      "refund",
      "internal",
      null,
      null,
      3000,
      null,
      JSON.stringify({
        refundId: "ref_txn-1_1780833600000",
        orderId: "order-42",
        reason: "customer changed mind",
        paymentStatus: "partial_refunded",
      }),
      null,
      null,
      1780833600000,
    ]);
  });

  it("does not commit refund ledger writes when a middle write fails", async () => {
    const { db, committed } = createD1WithBatchFailure(
      paidOrder({ refundAmountCents: 2000 }),
      (statement) =>
        statement.sql
          .toLowerCase()
          .replaceAll('"', "")
          .includes("insert into refund_transactions"),
    );

    await expect(
      refundPaymentTransaction(
        env(db),
        {
          transactionId: "txn-rollback",
          amount: 30,
          reason: "customer changed mind",
        },
        { user: cashierUser },
      ),
    ).rejects.toThrow("injected batch failure");

    expect(db.batch).toHaveBeenCalledOnce();
    expect(committed.map((statement) => statement.sql.toLowerCase())).toEqual([
      expect.stringContaining('update "orders"'),
    ]);
  });

  it("marks full refunds from cent totals and blocks over-refunds", async () => {
    const fullRefund = createD1(
      paidOrder({
        totalAmountCents: 4567,
        refundAmountCents: 1567,
        paymentMethod: "card",
        paymentStatus: "paid",
      }),
    );

    await expect(
      refundPaymentTransaction(
        env(fullRefund.db),
        {
          transactionId: "txn-2",
          amount: 30,
        },
        { user: cashierUser },
      ),
    ).resolves.toMatchObject({
      refundId: "ref_txn-2_1780833600000",
      amount: 30,
      paymentStatus: "refunded",
    });
    expect(
      statementContaining(
        fullRefund.statements,
        "INSERT OR IGNORE INTO payment_transactions",
      )?.values.slice(0, 7),
    ).toEqual(["txn-2", "order-42", "restaurant-1", 4567, 0, "card", "paid"]);
    expect(
      statementContaining(fullRefund.statements, "UPDATE orders")?.values,
    ).toEqual(
      expect.arrayContaining([
        "refunded",
        3000,
        1780833600000,
        "order-42",
        "txn-2",
      ]),
    );
    expect(
      statementContaining(
        fullRefund.statements,
        "INSERT OR IGNORE INTO payment_audit_log",
      )?.values[8],
    ).toBe(3000);

    await expect(
      refundPaymentTransaction(
        env(
          createD1(
            paidOrder({
              totalAmountCents: 12000,
              refundAmountCents: 10000,
            }),
          ).db,
        ),
        { transactionId: "txn-3", amount: 21 },
        { user: cashierUser },
      ),
    ).rejects.toMatchObject({
      code: "REFUND_AMOUNT_EXCEEDS_PAYMENT",
      status: 409,
    });
  });

  it("rejects refund amounts that are not aligned to cents", async () => {
    const setup = createD1(paidOrder());

    await expect(
      refundPaymentTransaction(
        env(setup.db),
        { transactionId: "txn-fractional", amount: 19.995 },
        { user: cashierUser },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REFUND_AMOUNT",
      status: 400,
    });
    expect(setup.db.batch).not.toHaveBeenCalled();
  });

  it("rejects a partial TWD refund that is not whole dollars", async () => {
    const setup = createD1(paidOrder());

    await expect(
      refundPaymentTransaction(
        env(setup.db),
        { transactionId: "txn-cents", amount: 19.5 },
        { user: cashierUser },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REFUND_AMOUNT",
      status: 400,
      details: { currency: "TWD" },
    });
    expect(resolveRestaurantCurrency).toHaveBeenCalledWith(
      setup.db,
      paidOrder().restaurantId,
    );
    expect(setup.db.batch).not.toHaveBeenCalled();
  });

  it("allows cent-level partial refunds in MYR", async () => {
    resolveRestaurantCurrency.mockResolvedValueOnce("MYR" as never);
    const setup = createD1(paidOrder());

    await expect(
      refundPaymentTransaction(
        env(setup.db),
        { transactionId: "txn-myr", amount: 19.5 },
        { user: cashierUser },
      ),
    ).resolves.toMatchObject({ amount: 19.5 });
  });

  it("refunds an off-step remainder in full without asking for a currency", async () => {
    resolveRestaurantCurrency.mockClear();
    const setup = createD1(
      paidOrder({ totalAmountCents: 17050, refundAmountCents: 5000 }),
    );

    await expect(
      refundPaymentTransaction(
        env(setup.db),
        { transactionId: "txn-odd", amount: 120.5 },
        { user: cashierUser },
      ),
    ).resolves.toMatchObject({ amount: 120.5, paymentStatus: "refunded" });
    expect(resolveRestaurantCurrency).not.toHaveBeenCalled();
  });

  it("enforces role, tenant, and conditional refund caps", async () => {
    await expect(
      refundPaymentTransaction(
        env(createD1(paidOrder()).db),
        { transactionId: "txn-role", amount: 10 },
        {
          user: {
            id: "user-1",
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

    await expect(
      refundPaymentTransaction(
        env(createD1(paidOrder()).db),
        { transactionId: "txn-tenant", amount: 10 },
        {
          user: {
            id: "user-2",
            username: "cashier",
            role: 4,
            restaurantId: "restaurant-2",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    const setup = createD1(paidOrder({ refundAmountCents: 2000 }), 0);
    await expect(
      refundPaymentTransaction(
        env(setup.db),
        {
          transactionId: "txn-race",
          amount: 30,
        },
        { user: cashierUser },
      ),
    ).rejects.toMatchObject({
      code: "REFUND_AMOUNT_EXCEEDS_PAYMENT",
      status: 409,
    });
    expect(setup.db.batch).not.toHaveBeenCalled();
  });
});

describe("toExternalPaymentStatus", () => {
  it.each([
    ["paid", "completed"],
    ["completed", "completed"],
    ["refunded", "refunded"],
    ["partial_refunded", "partial_refunded"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["processing", "processing"],
    [null, "pending"],
    ["unknown", "pending"],
  ])("maps %s to %s", (input, expected) => {
    expect(toExternalPaymentStatus(input)).toBe(expected);
  });
  // --- MYR cash rounding (#405) ---------------------------------------

  it("refunds what the cash payment collected, not the order total", async () => {
    // RM10.33 order, RM10.35 collected. Refunding 10.33 would keep 2 sen
    // that never belonged to the restaurant.
    resolveRestaurantCurrency.mockResolvedValue("MYR" as never);
    const { db, statements } = createD1(
      paidOrder({ totalAmountCents: 1033, paymentMethod: "cash" }),
      1,
      { amountCents: 1035 },
    );

    await expect(
      refundPaymentTransaction(
        env(db),
        { transactionId: "txn-rounded" },
        { user: cashierUser },
      ),
    ).resolves.toMatchObject({ amount: 10.35, paymentStatus: "refunded" });

    expect(
      statementContaining(statements, "insert into refund_transactions")
        ?.values,
    ).toEqual(expect.arrayContaining([1035]));
  });

  it("lets a rounded cash refund exceed the order total by its 2 sen", async () => {
    resolveRestaurantCurrency.mockResolvedValue("MYR" as never);
    const { db } = createD1(
      paidOrder({ totalAmountCents: 1033, paymentMethod: "cash" }),
      1,
      { amountCents: 1035 },
    );

    await expect(
      refundPaymentTransaction(
        env(db),
        { transactionId: "txn-rounded", amount: 10.35 },
        { user: cashierUser },
      ),
    ).resolves.toMatchObject({ amount: 10.35 });
  });

  it("still refuses more than the payment collected", async () => {
    resolveRestaurantCurrency.mockResolvedValue("MYR" as never);
    const { db } = createD1(
      paidOrder({ totalAmountCents: 1033, paymentMethod: "cash" }),
      1,
      { amountCents: 1035 },
    );

    await expect(
      refundPaymentTransaction(
        env(db),
        { transactionId: "txn-rounded", amount: 10.4 },
        { user: cashierUser },
      ),
    ).rejects.toMatchObject({
      code: "REFUND_AMOUNT_EXCEEDS_PAYMENT",
      status: 409,
    });
  });

  it("falls back to the order total when no payment row exists", async () => {
    // The legacy ledger-backfill path: an order marked paid before
    // payment_transactions carried the row.
    const { db } = createD1(paidOrder({ totalAmountCents: 12000 }), 1, null);

    await expect(
      refundPaymentTransaction(
        env(db),
        { transactionId: "txn-legacy" },
        { user: cashierUser },
      ),
    ).resolves.toMatchObject({ amount: 120, paymentStatus: "refunded" });
  });
});
