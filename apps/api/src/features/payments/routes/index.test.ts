import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ApiError } from "../../../shared/utils/api-error";

const mocks = vi.hoisted(() => ({
  paymentService: {
    processPayment: vi.fn(),
  },
  paymentServiceCtor: vi.fn(),
  refundPaymentTransaction: vi.fn(),
  idempotencyOptions: [] as Array<Record<string, unknown>>,
  tenantAccess: {
    requireActiveRegisterAndShift: vi.fn(),
  },
  tenantAccessCtor: vi.fn(),
}));

const orderId101 = "018f0000-0000-7000-8000-000000000101";
const orderId202 = "018f0000-0000-7000-8000-000000000202";
const orderId303 = "018f0000-0000-7000-8000-000000000303";
const orderId404 = "018f0000-0000-7000-8000-000000000404";
const orderId505 = "018f0000-0000-7000-8000-000000000505";
const orderId606 = "018f0000-0000-7000-8000-000000000606";

const authState = vi.hoisted(() => ({
  user: {
    id: "018f0000-0000-7000-8000-000000000007",
    username: "cashier",
    role: 4,
    restaurantId: "restaurant-1",
  },
}));

vi.mock("../../../middleware/idempotency", () => ({
  idempotencyMiddleware: vi.fn((options: Record<string, unknown>) => {
    mocks.idempotencyOptions.push(options);
    return async (_c: unknown, next: () => Promise<void>) => next();
  }),
}));

vi.mock("../../../middleware/auth", async () => {
  const { ApiError } = await vi.importActual<
    typeof import("../../../shared/utils/api-error")
  >("../../../shared/utils/api-error");

  return {
    requireRole: vi.fn(
      (allowedRoles: number[]) =>
        async (
          c: { set: (key: string, value: unknown) => void },
          next: () => Promise<void>,
        ) => {
          c.set("user", authState.user);
          if (!allowedRoles.includes(authState.user.role)) {
            throw new ApiError(
              "INSUFFICIENT_ROLE",
              "Insufficient permissions",
              403,
            );
          }
          await next();
        },
    ),
  };
});

vi.mock("../services/PaymentService", () => ({
  PaymentService: vi.fn(function PaymentService(...args: unknown[]) {
    mocks.paymentServiceCtor(...args);
    return mocks.paymentService;
  }),
}));

vi.mock("../services/refundPayment", () => ({
  refundPaymentTransaction: vi.fn((...args: unknown[]) =>
    mocks.refundPaymentTransaction(...args),
  ),
  toExternalPaymentStatus: vi.fn((status: string | null) => {
    if (status === "paid" || status === "completed") return "completed";
    if (status === "failed") return "failed";
    if (status === "refunded") return "refunded";
    if (status === "partially_refunded") return "partially_refunded";
    return "pending";
  }),
}));

vi.mock("../../pos/services/PosTenantAccessService", () => ({
  PosTenantAccessService: vi.fn(function PosTenantAccessService(
    ...args: unknown[]
  ) {
    mocks.tenantAccessCtor(...args);
    return mocks.tenantAccess;
  }),
}));

import routes from "./index";
import { idempotencyMiddleware } from "../../../middleware/idempotency";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }

  return c.json({ success: false, error: { message: String(err) } }, 500);
});

interface D1MockRows {
  orderLookup?: Array<Record<string, unknown> | null>;
  orderStatus?: Array<Record<string, unknown> | null>;
  transaction?: Array<Record<string, unknown> | null>;
}

function createDb(rows: D1MockRows = {}) {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => {
        const takeRow = () => {
          const normalizedSql = sql.toLowerCase();
          if (normalizedSql.includes('from "payment_transactions"')) {
            return rows.transaction?.shift() ?? null;
          }

          if (normalizedSql.includes("payment_transaction_id")) {
            return rows.orderStatus?.shift() ?? null;
          }

          if (
            normalizedSql.includes("order_number") ||
            normalizedSql.includes("client_mutation_id")
          ) {
            return rows.orderLookup?.shift() ?? null;
          }

          return null;
        };
        return {
          first: vi.fn(async () => takeRow()),
          raw: vi.fn(async () => {
            const row = takeRow();
            return row ? [Object.values(row)] : [];
          }),
          all: vi.fn(async () => {
            const row = takeRow();
            return { results: row ? [row] : [] };
          }),
        };
      }),
    })),
  };
}

let authenticated = true;

function request(path: string, init: RequestInit = {}, db = createDb()) {
  const app = new Hono<{ Variables: { user: typeof authState.user } }>();
  app.use("*", async (c, next) => {
    if (authenticated) c.set("user", authState.user);
    await next();
  });
  app.route("/", routes);
  return app.request(path, init, { DB: db } as never);
}

async function json(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data?: unknown;
    error?: { code?: string; message?: string; details?: unknown };
  };
}

function postJson(path: string, body: unknown, db = createDb()) {
  return request(
    path,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-1",
      },
    },
    db,
  );
}

describe("payments routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticated = true;
    authState.user = {
      id: "018f0000-0000-7000-8000-000000000007",
      username: "cashier",
      role: 4,
      restaurantId: "restaurant-1",
    };
    mocks.paymentService.processPayment.mockResolvedValue({
      status: 200,
      data: {
        paymentId: "pay-1",
        orderId: orderId101,
        orderStatus: "paid",
        paymentStatus: "paid",
        authorizedTotal: 120,
        currency: "TWD",
        country: "TW",
      },
    });
    mocks.refundPaymentTransaction.mockResolvedValue({
      refundId: "refund-1",
      transactionId: "pay-1",
      amount: 25,
      status: "succeeded",
      paymentStatus: "partially_refunded",
    });
    mocks.tenantAccess.requireActiveRegisterAndShift.mockResolvedValue(
      undefined,
    );
  });

  it("requires idempotency keys on both payment creation routes", () => {
    const paymentOptions = mocks.idempotencyOptions.filter(
      (options) => options.scope === "payment",
    );

    expect(paymentOptions).toHaveLength(2);
    expect(paymentOptions[0]).toEqual(
      expect.objectContaining({
        scope: "payment",
        requireKey: true,
        effectId: expect.any(Function),
        releaseOnServerError: true,
      }),
    );
    expect(paymentOptions[1]).toEqual(
      expect.objectContaining({
        scope: "payment",
        requireKey: true,
        effectId: expect.any(Function),
        releaseOnServerError: true,
      }),
    );
    expect(idempotencyMiddleware).toHaveBeenCalledTimes(0);
  });

  it("creates full payments for UUID orders with default route mapping", async () => {
    const response = await postJson("/", {
      orderId: orderId101,
      amount: 120,
      method: "cash",
      country: "TW",
      currency: "TWD",
      metadata: { source: "pos" },
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.paymentServiceCtor).toHaveBeenCalledWith(
      expect.objectContaining({ DB: expect.any(Object) }),
    );
    expect(mocks.paymentService.processPayment).toHaveBeenCalledWith(
      {
        orderId: orderId101,
        paymentMode: "full",
        amount: 120,
        expectedTotal: 120,
        payments: undefined,
        closeOrder: true,
        method: "cash",
        gateway: "cash",
      },
      {
        actor: { kind: "staff", user: authState.user },
        country: "TW",
        currency: "TWD",
        idempotencyKey: "idem-1",
        customerInfo: undefined,
        metadata: { source: "pos" },
      },
    );
    expect(body).toEqual({
      success: true,
      data: {
        id: "pay-1",
        paymentId: "pay-1",
        transactionId: "pay-1",
        status: "completed",
        metadata: {
          orderId: orderId101,
          orderPublicId: orderId101,
          orderStatus: "paid",
          paymentStatus: "paid",
          authorizedTotal: 120,
          country: "TW",
          currency: "TWD",
          method: "cash",
        },
      },
    });
  });

  it("binds a POS payment to an active register and shift", async () => {
    const registerId = "018f0000-0000-7000-8000-000000000801";
    const shiftId = "018f0000-0000-7000-8000-000000000802";
    const response = await postJson("/", {
      orderId: orderId101,
      amount: 120,
      method: "cash",
      registerId,
      shiftId,
    });

    expect(response.status).toBe(200);
    expect(
      mocks.tenantAccess.requireActiveRegisterAndShift,
    ).toHaveBeenCalledWith(authState.user, registerId, shiftId);
    expect(mocks.paymentService.processPayment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        pos: { registerId, shiftId, operatorId: authState.user.id },
      }),
    );
  });

  it("rejects an incomplete POS register/shift binding", async () => {
    const response = await postJson("/", {
      orderId: orderId101,
      amount: 120,
      method: "cash",
      registerId: "018f0000-0000-7000-8000-000000000801",
    });

    expect(response.status).toBe(400);
    expect(
      mocks.tenantAccess.requireActiveRegisterAndShift,
    ).not.toHaveBeenCalled();
    expect(mocks.paymentService.processPayment).not.toHaveBeenCalled();
  });

  it("reports the currency the service recorded, not one the client omitted", async () => {
    mocks.paymentService.processPayment.mockResolvedValueOnce({
      status: 200,
      data: {
        paymentId: "pay-myr",
        orderId: orderId101,
        orderStatus: "paid",
        paymentStatus: "completed",
        authorizedTotal: 45.5,
        currency: "MYR",
        country: "MY",
      },
    });

    // What the admin cashier sends: no country, no currency.
    const response = await postJson("/", {
      orderId: orderId101,
      amount: 45.5,
      method: "cash",
    });

    expect(response.status).toBe(200);
    expect(mocks.paymentService.processPayment).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: orderId101, amount: 45.5 }),
      expect.objectContaining({ country: undefined, currency: undefined }),
    );
    expect((await json(response)).data).toMatchObject({
      metadata: { country: "MY", currency: "MYR" },
    });
  });

  it("rejects payment creation without an authenticated staff actor", async () => {
    authenticated = false;
    const response = await postJson("/", {
      orderId: orderId101,
      amount: 120,
      method: "cash",
    });

    expect(response.status).toBe(401);
    expect((await json(response)).error?.code).toBe("UNAUTHORIZED");
    expect(mocks.paymentService.processPayment).not.toHaveBeenCalled();
  });

  it("requires restaurant scope for non-numeric order identifiers", async () => {
    const response = await postJson("/", {
      orderId: "ORD-101",
      amount: 120,
      method: "cash",
    });
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("RESTAURANT_ID_REQUIRED");
    expect(mocks.paymentService.processPayment).not.toHaveBeenCalled();
  });

  it("resolves create-payment order aliases inside a restaurant", async () => {
    const db = createDb({
      orderLookup: [
        {
          id: orderId202,
          order_number: "ORD-202",
          restaurant_id: "restaurant-1",
        },
      ],
    });
    mocks.paymentService.processPayment.mockResolvedValueOnce({
      status: 201,
      data: {
        paymentId: "pay-202",
        orderId: orderId202,
        orderStatus: "processing",
        paymentStatus: "pending",
        authorizedTotal: 42,
      },
    });

    const response = await postJson(
      "/create",
      {
        orderId: "ORD-202",
        restaurantId: "restaurant-1",
        amount: 42,
        method: "credit_card",
        country: "MY",
        currency: "MYR",
        customerInfo: { email: "guest@example.test" },
        metadata: { terminal: "front" },
      },
      db,
    );
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("orders"));
    expect(mocks.paymentService.processPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: orderId202,
        paymentMode: "full",
        amount: 42,
        gateway: "credit_card",
      }),
      expect.objectContaining({
        country: "MY",
        currency: "MYR",
        customerInfo: { email: "guest@example.test" },
        metadata: { terminal: "front" },
      }),
    );
    expect(body).toMatchObject({
      success: true,
      data: {
        paymentId: "pay-202",
        status: "pending",
        metadata: {
          orderPublicId: orderId202,
        },
      },
    });
  });

  it("resolves public order ids inside a restaurant", async () => {
    const db = createDb({
      orderLookup: [
        {
          id: orderId606,
          order_number: "ORD-606",
          restaurant_id: "restaurant-1",
        },
      ],
    });

    await postJson(
      "/",
      {
        orderId: orderId606,
        restaurantId: "restaurant-1",
        amount: 88,
        method: "cash",
      },
      db,
    );

    expect(mocks.paymentService.processPayment).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: orderId606 }),
      expect.any(Object),
    );
  });

  it("passes partial payments through without closing the order", async () => {
    const payments = [
      { method: "cash", amount: 40 },
      { method: "card", amount: 60 },
    ];

    await postJson("/", {
      orderId: orderId303,
      paymentMode: "partial",
      expectedTotal: 100,
      payments,
      gateway: "mixed",
      closeOrder: false,
    });

    expect(mocks.paymentService.processPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: orderId303,
        paymentMode: "partial",
        amount: undefined,
        expectedTotal: 100,
        payments,
        closeOrder: false,
        method: undefined,
        gateway: "mixed",
      }),
      expect.any(Object),
    );
  });

  it("rejects payment amounts that are not aligned to cents", async () => {
    let response = await postJson("/create", {
      orderId: orderId101,
      restaurantId: "restaurant-1",
      amount: 19.995,
      method: "credit_card",
      country: "TW",
      currency: "TWD",
    });
    let body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");

    response = await postJson("/", {
      orderId: orderId303,
      paymentMode: "partial",
      expectedTotal: 100,
      payments: [
        { method: "cash", amount: 40 },
        { method: "card", amount: 59.995 },
      ],
    });
    body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(mocks.paymentService.processPayment).not.toHaveBeenCalled();
  });

  it("returns payment transaction status rows before order fallbacks", async () => {
    const db = createDb({
      transaction: [
        {
          transaction_id: "txn-1",
          order_id: orderId404,
          status: "paid",
        },
      ],
      orderStatus: [{ id: 999, payment_status: "failed" }],
    });

    const response = await request("/status/txn-1", undefined, db);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        transactionId: "txn-1",
        orderId: orderId404,
        paymentStatus: "paid",
        status: "completed",
      },
    });
  });

  it("falls back to order payment status and reports missing transactions", async () => {
    let db = createDb({
      transaction: [null],
      orderStatus: [
        {
          id: orderId505,
          payment_status: "paid",
        },
      ],
    });

    let response = await request("/status/order-txn", undefined, db);
    let body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        transactionId: "order-txn",
        orderId: orderId505,
        orderPublicId: orderId505,
        paymentStatus: "paid",
        status: "completed",
      },
    });

    db = createDb({ transaction: [null], orderStatus: [null] });
    response = await request("/status/missing", undefined, db);
    body = await json(response);

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("TRANSACTION_NOT_FOUND");
  });

  it("refunds transactions with validated input", async () => {
    const response = await postJson("/refund", {
      transactionId: "pay-1",
      amount: 25,
      reason: "guest changed order",
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.refundPaymentTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ DB: expect.any(Object) }),
      {
        transactionId: "pay-1",
        amount: 25,
        reason: "guest changed order",
      },
      {
        user: authState.user,
      },
    );
    expect(body).toEqual({
      success: true,
      data: {
        refundId: "refund-1",
        transactionId: "pay-1",
        amount: 25,
        status: "succeeded",
        paymentStatus: "partially_refunded",
      },
    });
  });

  it("rejects refund requests from staff roles without refund authority", async () => {
    authState.user = {
      id: "018f0000-0000-7000-8000-000000000008",
      username: "chef",
      role: 2,
      restaurantId: "restaurant-1",
    };

    const response = await postJson("/refund", {
      transactionId: "pay-1",
      amount: 25,
    });
    const body = await json(response);

    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("INSUFFICIENT_ROLE");
    expect(mocks.refundPaymentTransaction).not.toHaveBeenCalled();
  });

  it("lists supported payment methods by country", async () => {
    let response = await request("/methods/my");
    let body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        country: "MY",
        supportedMethods: [
          "credit_card",
          "debit_card",
          "fpx",
          "touch_n_go",
          "grab_pay",
        ],
      },
    });

    response = await request("/methods/sg");
    body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { country: "SG", supportedMethods: [] },
    });
  });

  it("rejects partial payments without payment splits", async () => {
    const response = await postJson("/", {
      orderId: orderId101,
      paymentMode: "partial",
    });
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(mocks.paymentService.processPayment).not.toHaveBeenCalled();
  });
});
