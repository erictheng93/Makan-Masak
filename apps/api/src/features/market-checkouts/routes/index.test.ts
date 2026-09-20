import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import {
  marketCheckoutChildOrders,
  marketCheckoutSessions,
  markets,
  menuItems,
  orders,
  restaurantMarketMemberships,
  restaurants,
} from "@makanmasak/database";
import routes from "./index";
import type { AppliedMarketCheckoutVoucher } from "../services/MarketCheckoutVoucherService";
import { ApiError } from "../../../shared/utils/api-error";
import { GUEST_DEVICE_ID_HEADER } from "../../../middleware/guestAuth";
import {
  mockMarketCheckoutProviderPaidWebhookPayload,
  mockMarketCheckoutProviderPaidStatusResponse,
  mockMarketCheckoutProviderPendingResponse,
  mockMarketCheckoutProviderRefundResponse,
  signMockMarketCheckoutWebhook,
} from "../testing/mockMarketCheckoutProviderContract";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined && { details: err.details }),
        },
      },
      err.status as 400 | 401 | 403 | 404 | 409 | 429 | 500,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

const databaseMocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  selectFixtures: new Map<unknown, unknown[][]>(),
  insertValues: [] as unknown[],
  updateValues: [] as unknown[],
}));

/**
 * Select fixtures are keyed by table, not by call order: `from(table)` decides
 * which queue a query draws from, so adding a query against one table can no
 * longer shift another table's results out from under it.
 *
 * Two things still need care when the code under test grows a new query:
 *
 * - Within a single table the queue is positional. The Nth read of a table
 *   takes that table's Nth fixture, so a new query means inserting a fixture
 *   at the matching index rather than appending one at the end.
 * - A table has to be listed in `fixtureTables` before it can be declared. An
 *   unregistered table matches no queue, so every read of it throws.
 *
 * Missing and exhausted fixtures both throw and name the table. Nothing falls
 * back to `[]`; a silent empty result is what made the previous positional
 * queues so hard to trace back to their cause.
 *
 * These throws reach the route's `onError` and come back as a 500, so an
 * unexplained `expected 500 to be 200` in this suite is usually an undeclared
 * fixture — read the response body before suspecting the route.
 */
type SelectFixtureName =
  | "marketCheckoutChildOrders"
  | "marketCheckoutSessions"
  | "markets"
  | "menuItems"
  | "restaurantMarketMemberships"
  | "restaurants";

type SelectFixtures = Partial<Record<SelectFixtureName, unknown[][]>>;

const fixtureTables: Record<SelectFixtureName, unknown> = {
  marketCheckoutChildOrders,
  marketCheckoutSessions,
  markets,
  menuItems,
  restaurantMarketMemberships,
  restaurants,
};

const fixtureTableNames = new Map(
  Object.entries(fixtureTables).map(([name, table]) => [table, name]),
);

const unselectedTable = Symbol("unselectedTable");

function setSelectFixtures(fixtures: SelectFixtures) {
  databaseMocks.selectFixtures.clear();
  for (const [name, rows] of Object.entries(fixtures)) {
    databaseMocks.selectFixtures.set(fixtureTables[name as SelectFixtureName], [
      ...rows,
    ]);
  }
}

function setMarketCheckoutSessionFixtures(
  ...fixtures: Array<{ all: unknown[] }>
) {
  setSelectFixtures({
    // Administrative endpoints only query this table; repeated rows model
    // repeated queries to the same table, never cross-table ordering.
    marketCheckoutSessions: fixtures.map((fixture) => fixture.all),
  });
}

function setSettlementFixtures(
  sessions: { all: unknown[] },
  children: { all: unknown[] },
) {
  setSelectFixtures({
    marketCheckoutSessions: [sessions.all],
    marketCheckoutChildOrders: [children.all],
  });
}

// The KV-fallback tests still read the sessions table once before falling back.
// Each of them declares that empty read itself; a blanket default in
// `beforeEach` would leave a spare `[]` sitting in the queue for every test
// that never reads the table, and a newly added sessions query would silently
// consume it instead of failing.
function setNoPersistedCheckoutFixtures() {
  setSelectFixtures({ marketCheckoutSessions: [[]] });
}
const createOrder = vi.hoisted(() => vi.fn());
const getOrder = vi.hoisted(() => vi.fn());
const cancelOrder = vi.hoisted(() => vi.fn());
const processPayment = vi.hoisted(() => vi.fn());
const enforceQuota = vi.hoisted(() => vi.fn());
const meterEmit = vi.hoisted(() => vi.fn());
const markVoucherRefunded = vi.hoisted(() => vi.fn());
const validateVoucherAndPrice = vi.hoisted(() => vi.fn());
const redeemVoucher = vi.hoisted(() => vi.fn());
const reserveVoucherUsage = vi.hoisted(() =>
  vi.fn(async (voucher) => ({
    ...voucher,
    reservationStatus: "reserved",
    reservedAt: "2026-06-13T00:00:00.000Z",
  })),
);
const releaseVoucherReservation = vi.hoisted(() =>
  vi.fn(async (voucher) => ({
    ...voucher,
    reservationStatus: "released",
    releasedAt: "2026-06-13T00:01:00.000Z",
  })),
);
const tokenCounter = vi.hoisted(() => ({ value: 0 }));
const originalFetch = globalThis.fetch;
const adminUser = vi.hoisted(
  () =>
    ({
      id: "user-1",
      username: "admin",
      role: 0,
      restaurantId: "platform",
    }) as AuthUser,
);
// Whether the shopper driving the next request is signed in, as the optional
// customer auth middleware would report it.
const signedInCustomer = vi.hoisted(
  () => ({ value: null }) as { value: { id: string } | null },
);

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", adminUser);
    await next();
  }),
  optionalCanonicalCustomerAuthMiddleware: vi.fn(async (c, next) => {
    if (signedInCustomer.value) {
      c.set("customer", signedInCustomer.value);
    }
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("@makanmasak/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@makanmasak/database")>()),
  createDatabase: databaseMocks.createDatabase,
}));

// The route resolves the vendors' shared currency straight from D1, which the
// fixture DB here does not model. Default every checkout to TWD vendors and let
// individual tests override it; the real resolver has its own real-D1 suite.
const resolveSharedRestaurantCurrency = vi.hoisted(() => vi.fn());
// Its lenient twin, mocked alongside so a test can prove which of the two a
// path reached: the strict one fails closed (money), the display one falls
// back (reads).
const resolveDisplaySharedRestaurantCurrency = vi.hoisted(() => vi.fn());
vi.mock(
  "../../../shared/utils/restaurant-currency",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../shared/utils/restaurant-currency")
    >()),
    resolveSharedRestaurantCurrency,
    resolveDisplaySharedRestaurantCurrency,
  }),
);

vi.mock("../../../middleware/quotaGate", () => ({
  enforceQuota,
}));

vi.mock("../../../shared/utils/meter", () => ({
  meterEmit,
}));

vi.mock("../../../middleware/guestAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middleware/guestAuth")>()),
  generateGuestToken: () => {
    tokenCounter.value += 1;
    return `guest-token-${tokenCounter.value}`;
  },
}));

vi.mock("../../orders/services/OrdersService", () => ({
  OrdersService: function OrdersService() {
    return { createOrder, getOrder, cancelOrder };
  },
}));

vi.mock("../../payments/services/PaymentService", () => ({
  PaymentService: function PaymentService() {
    return { processPayment };
  },
}));

vi.mock("../services/MarketCheckoutVoucherService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../services/MarketCheckoutVoucherService")
    >();
  return {
    ...actual,
    MarketCheckoutVoucherService: class {
      validateAndPrice = validateVoucherAndPrice;
      reserveUsage = reserveVoucherUsage;
      releaseReservation = releaseVoucherReservation;
      redeem = redeemVoucher;
      markRefunded = markVoucherRefunded;
    },
  };
});

function createMockDb() {
  const createSelectChain = () => {
    let selectedTable: unknown = unselectedTable;
    const nextRows = () => {
      if (selectedTable === unselectedTable) {
        throw new Error("Select fixture query never called from(table)");
      }
      // An unregistered table is a distinct mistake from never calling from()
      // at all, so it has to report the missing fixture rather than claim the
      // query skipped from().
      const tableName =
        fixtureTableNames.get(selectedTable) ?? "<unknown table>";
      const fixtures = databaseMocks.selectFixtures.get(selectedTable);
      if (!fixtures) {
        throw new Error(`Missing select fixture for ${tableName}`);
      }
      const rows = fixtures.shift();
      if (!rows) {
        throw new Error(`No select fixtures remaining for ${tableName}`);
      }
      return rows;
    };
    const chain = {
      from: vi.fn((table: unknown) => {
        selectedTable = table;
        return chain;
      }),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      offset: vi.fn(() => chain),
      get: vi.fn(async () => nextRows()[0]),
      all: vi.fn(async () => nextRows()),
    };
    return chain;
  };

  return {
    select: vi.fn(() => createSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: unknown) => {
        databaseMocks.insertValues.push(values);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(async () => {
          databaseMocks.updateValues.push(values);
        }),
      })),
    })),
  };
}

const MARKET_HOLDER_TOKEN = "gt_market-holder";
const MARKET_HOLDER_HEADERS = {
  Authorization: `Bearer ${MARKET_HOLDER_TOKEN}`,
};
// providerSplitPaidSessionFixture numbers its child orders 101/102, so it needs
// its own holder token — a guest token is scoped to one order.
const MARKET_PAID_HOLDER_TOKEN = "gt_market-holder-paid";
const MARKET_PAID_HOLDER_HEADERS = {
  Authorization: `Bearer ${MARKET_PAID_HOLDER_TOKEN}`,
};

function createEnv(dbFirstRows: unknown[] = []) {
  const kv = new Map<string, string>();
  // A real shopper reaches the mutating endpoints holding the guest token
  // minted when the checkout was created; the gate on those routes resolves it
  // out of KV. Seeded through the backing map rather than the `put` mock so it
  // does not show up in tests that assert on KV writes.
  kv.set(
    `guest_token:${MARKET_HOLDER_TOKEN}`,
    JSON.stringify({
      orderId: "1001",
      restaurantId: "restaurant-1",
      guestName: "Guest",
      createdAt: 0,
    }),
  );
  kv.set(
    `guest_token:${MARKET_PAID_HOLDER_TOKEN}`,
    JSON.stringify({
      orderId: "101",
      restaurantId: "restaurant-1",
      guestName: "Guest",
      createdAt: 0,
    }),
  );
  return {
    DB: {
      prepare: vi.fn((sql: string) => {
        const statement = {
          sql,
          values: [] as unknown[],
          bind: vi.fn((...values: unknown[]) => {
            statement.values = values;
            return statement;
          }),
          first: vi.fn(async () => readPreparedFirstRow(sql, statement.values)),
          raw: vi.fn(async () => {
            const row = readPreparedFirstRow(sql, statement.values);
            return row ? [Object.values(row)] : [];
          }),
          all: vi.fn(async () => {
            const row = readPreparedFirstRow(sql, statement.values);
            return { results: row ? [row] : [] };
          }),
          run: vi.fn(async () => ({ meta: { changes: 1 }, success: true })),
        };
        return statement;
      }),
      batch: vi.fn(
        async (statements: Array<{ run?: () => Promise<unknown> }>) =>
          Promise.all(
            statements.map((statement) =>
              statement.run ? statement.run() : undefined,
            ),
          ),
      ),
    },
    CACHE_KV: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kv.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        kv.delete(key);
      }),
    },
  };

  function readPreparedFirstRow(sql: string, values: unknown[]) {
    const normalizedSql = sql.toLowerCase();
    // Refunds read the collected payment separately from the order. Do not
    // consume an order fixture for this one-column payment projection.
    if (normalizedSql.includes('from "payment_transactions"')) {
      if (values.includes("pay-1001")) return { amountCents: 12000 };
      if (values.includes("pay-1002")) return { amountCents: 8000 };
      return null;
    }
    if (normalizedSql.includes('"orders"') && values.includes("pay-1001")) {
      return refundOrderRow({
        id: 1001,
        restaurantId: "restaurant-1",
        totalAmountCents: 12000,
        payment_transaction_id: "pay-1001",
      });
    }
    // The refund reads the payment row to refund what was collected rather
    // than what was priced (#405, MYR cash rounding). Without these branches
    // the query falls through to `dbFirstRows` and a refund is priced from
    // whatever happens to be queued next.
    if (
      normalizedSql.includes('"payment_transactions"') &&
      values.includes("pay-1001")
    ) {
      return { amountCents: 12000, amount_cents: 12000 };
    }
    if (
      normalizedSql.includes('"payment_transactions"') &&
      values.includes("pay-1002")
    ) {
      return { amountCents: 8000, amount_cents: 8000 };
    }
    if (normalizedSql.includes('"orders"') && values.includes("pay-1002")) {
      return refundOrderRow({
        id: 1002,
        restaurantId: "restaurant-2",
        totalAmountCents: 8000,
        payment_transaction_id: "pay-1002",
      });
    }
    return dbFirstRows.shift() ?? null;
  }
}

function refundOrderRow(overrides: Record<string, unknown>) {
  return {
    id: 1001,
    restaurantId: "restaurant-1",
    totalAmountCents: 12000,
    refundAmountCents: null,
    paymentMethod: "line_pay",
    paymentStatus: "paid",
    payment_method: "line_pay",
    payment_status: "paid",
    ...overrides,
  };
}

function providerSplitPaidSessionFixture() {
  return {
    id: "checkout-1",
    market: {
      id: "market-1",
      slug: "fengjia",
      name: "逢甲夜市",
      platformFeeRateBps: 350,
    },
    status: "submitted",
    childOrders: [
      {
        restaurantId: "restaurant-1",
        restaurantName: "雞排攤",
        orderId: 101,
        orderNumber: "A001",
        totalAmount: 160,
        totalAmountCents: 16000,
        tokenExpiresAt: "2026-06-01T12:00:00.000Z",
      },
      {
        restaurantId: "restaurant-2",
        restaurantName: "甜點攤",
        orderId: 102,
        orderNumber: "A002",
        totalAmount: 80,
        totalAmountCents: 8000,
        tokenExpiresAt: "2026-06-01T12:00:00.000Z",
      },
    ],
    payment: {
      status: "paid",
      method: "market_online",
      currency: "TWD",
      country: "TW",
      totalAmount: 240,
      totalAmountCents: 24000,
      paidAmount: 240,
      paidAmountCents: 24000,
      paidAt: "2026-06-01T10:10:00.000Z",
      parentPayment: {
        paymentId: "market_pay_checkout-1",
        status: "paid",
        provider: "mock_market_provider",
        splitMode: "provider_split",
        idempotencyKey: "market-checkout:checkout-1",
        providerTransactionId: "intent-market-checkout-1",
        amountCents: 24000,
        paidAmountCents: 24000,
        refundedAmountCents: 0,
        childPaymentIds: ["mock-pay-101", "mock-pay-102"],
        createdAt: "2026-06-01T10:10:00.000Z",
        updatedAt: "2026-06-01T10:10:00.000Z",
      },
      childPayments: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          paymentId: "mock-pay-101",
          status: "paid",
          amount: 160,
          amountCents: 16000,
        },
        {
          restaurantId: "restaurant-2",
          restaurantName: "甜點攤",
          orderId: 102,
          orderNumber: "A002",
          paymentId: "mock-pay-102",
          status: "paid",
          amount: 80,
          amountCents: 8000,
        },
      ],
    },
    subtotal: 24000,
    createdAt: "2026-06-01T10:00:00.000Z",
  };
}

function unpaidCheckoutSessionFixture() {
  return {
    id: "checkout-1",
    market: {
      id: "market-1",
      slug: "fengjia",
      name: "Fengjia Night Market",
      platformFeeRateBps: 350,
    },
    status: "submitted",
    phoneLastDigits: "789",
    childOrders: [
      {
        restaurantId: "restaurant-1",
        restaurantName: "Vendor 1",
        orderId: 1001,
        orderNumber: "A001",
        totalAmount: 120,
        totalAmountCents: 12000,
        tokenExpiresAt: "2026-06-01T12:00:00.000Z",
      },
      {
        restaurantId: "restaurant-2",
        restaurantName: "Vendor 2",
        orderId: 1002,
        orderNumber: "A002",
        totalAmount: 80,
        totalAmountCents: 8000,
        tokenExpiresAt: "2026-06-01T12:00:00.000Z",
      },
    ],
    subtotal: 20000,
    createdAt: "2026-06-01T10:00:00.000Z",
  };
}

/**
 * Either checkout fixture, persisted: the unpaid one carries the recovery
 * digits and no payment, the provider-split one carries the payment and no
 * digits, and a voucher may be stacked on top of either.
 */
type PersistableCheckoutSessionFixture = Omit<
  ReturnType<typeof unpaidCheckoutSessionFixture>,
  "phoneLastDigits"
> & {
  phoneLastDigits?: string;
  customerId?: string;
  payment?: ReturnType<typeof providerSplitPaidSessionFixture>["payment"];
  appliedVoucher?: AppliedMarketCheckoutVoucher;
};

function persistedSessionFixtures(
  session: PersistableCheckoutSessionFixture,
): SelectFixtures {
  return {
    marketCheckoutSessions: [
      [
        {
          id: session.id,
          marketId: session.market.id,
          marketSlug: session.market.slug,
          marketName: session.market.name,
          platformFeeRateBps: session.market.platformFeeRateBps ?? 0,
          status: session.status,
          paymentStatus: session.payment?.status ?? "pending",
          customerId: session.customerId ?? null,
          phoneLastDigits: session.phoneLastDigits ?? null,
          subtotalCents: session.subtotal,
          childOrderCount: session.childOrders.length,
          paymentSummary: session.payment ?? null,
          appliedVoucher: session.appliedVoucher ?? null,
          createdAt: new Date(session.createdAt),
          updatedAt: new Date(session.createdAt),
        },
      ],
    ],
    marketCheckoutChildOrders: [
      session.childOrders.map((child) => ({
        checkoutId: session.id,
        restaurantId: child.restaurantId,
        restaurantName: child.restaurantName,
        orderId: child.orderId,
        orderNumber: child.orderNumber,
        totalAmountCents: child.totalAmountCents ?? null,
        tokenExpiresAt: new Date(child.tokenExpiresAt),
      })),
    ],
  };
}

async function withSilencedRouteError<T>(
  action: () => T | Promise<T>,
): Promise<Awaited<T>> {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    return await action();
  } finally {
    consoleError.mockRestore();
  }
}

async function expectApiError(
  response: Response,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500,
  code: string,
) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    error: { code },
  });
}

// A well-formed guest token (`gt_` + 32-byte hex), as a returning device would
// present it in the Authorization header.
const ACTIVE_GUEST_TOKEN = `gt_${"a".repeat(64)}`;

// An opaque device id as the customer app generates it (crypto.randomUUID()).
const GUEST_DEVICE_ID = "01890a5d-ac96-774b-bcce-b302099a8057";

function twoVendorRequestWithHeaders(headers: Record<string, string>) {
  return new Request("https://test/", {
    method: "POST",
    headers,
    body: JSON.stringify({
      marketSlug: "fengjia",
      guestName: "Guest",
      phoneLastDigits: "789",
      vendors: [
        {
          restaurantId: "restaurant-1",
          items: [{ menuItemId: 101, quantity: 1 }],
        },
        {
          restaurantId: "restaurant-2",
          items: [{ menuItemId: 202, quantity: 1 }],
        },
      ],
    }),
  });
}

function setTwoVendorCreateFixtures(options?: {
  firstRestaurant?: unknown;
  firstMembership?: unknown;
  menuItems?: unknown[][];
  repeat?: number;
}) {
  const market = {
    id: "market-1",
    slug: "fengjia",
    name: "逢甲夜市",
    platformFeeRateBps: 350,
    isActive: true,
  };
  const firstRestaurant = options?.firstRestaurant ?? {
    id: "restaurant-1",
    name: "雞排攤",
    isActive: true,
    isAvailable: true,
    settings: { allowGuestOrders: true },
  };
  const firstMembership =
    options && "firstMembership" in options
      ? options.firstMembership
      : { restaurantId: "restaurant-1", marketId: "market-1" };
  const secondRestaurant = {
    id: "restaurant-2",
    name: "甜點攤",
    isActive: true,
    isAvailable: true,
    settings: { allowGuestOrders: true },
  };
  const secondMembership = {
    restaurantId: "restaurant-2",
    marketId: "market-1",
  };
  const repeat = options?.repeat ?? 1;
  setSelectFixtures({
    markets: Array.from({ length: repeat }, () => [market]),
    // These queues are intentionally positional only within their own table.
    restaurants: Array.from({ length: repeat }, () => [
      firstRestaurant,
      secondRestaurant,
    ]).flatMap((rows) => rows.map((row) => [row])),
    restaurantMarketMemberships: Array.from({ length: repeat }, () => [
      firstMembership,
      secondMembership,
    ]).flatMap((rows) => rows.map((row) => (row ? [row] : []))),
    menuItems: Array.from(
      { length: repeat },
      () => options?.menuItems ?? [[{ id: 101 }], [{ id: 202 }]],
    ).flat(),
  });
}

describe("market checkout routes", () => {
  beforeEach(() => {
    signedInCustomer.value = null;
    databaseMocks.selectFixtures.clear();
    databaseMocks.insertValues.length = 0;
    databaseMocks.updateValues.length = 0;
    databaseMocks.createDatabase.mockReset();
    databaseMocks.createDatabase.mockReturnValue(createMockDb());
    createOrder.mockReset();
    getOrder.mockReset();
    cancelOrder.mockReset();
    processPayment.mockReset();
    enforceQuota.mockReset();
    meterEmit.mockReset();
    markVoucherRefunded.mockReset();
    markVoucherRefunded.mockResolvedValue(undefined);
    validateVoucherAndPrice.mockReset();
    reserveVoucherUsage.mockClear();
    releaseVoucherReservation.mockClear();
    redeemVoucher.mockReset();
    redeemVoucher.mockResolvedValue(undefined);
    tokenCounter.value = 0;
    globalThis.fetch = originalFetch;
    resolveSharedRestaurantCurrency.mockReset();
    resolveSharedRestaurantCurrency.mockResolvedValue("TWD");
    resolveDisplaySharedRestaurantCurrency.mockReset();
    resolveDisplaySharedRestaurantCurrency.mockResolvedValue("TWD");
  });

  it("routes select fixtures by table and rejects exhausted fixtures", async () => {
    setSelectFixtures({
      markets: [[{ id: "market-1" }]],
      restaurants: [[{ id: "restaurant-1" }]],
    });
    const db = createMockDb();

    await expect(db.select().from(restaurants).get()).resolves.toEqual({
      id: "restaurant-1",
    });
    await expect(db.select().from(markets).get()).resolves.toEqual({
      id: "market-1",
    });
    await expect(db.select().from(markets).get()).rejects.toThrow(
      "No select fixtures remaining for markets",
    );
    await expect(db.select().from(menuItems).all()).rejects.toThrow(
      "Missing select fixture for menuItems",
    );
    // `orders` is deliberately absent from fixtureTables: an unregistered
    // table reports the missing fixture, it does not claim from() was skipped.
    await expect(db.select().from(orders).all()).rejects.toThrow(
      "Missing select fixture for <unknown table>",
    );
    await expect(db.select().all()).rejects.toThrow(
      "Select fixture query never called from(table)",
    );
  });

  it("creates one child guest order per active market vendor", async () => {
    setTwoVendorCreateFixtures();
    createOrder
      .mockResolvedValueOnce({
        id: 1001,
        orderNumber: "A001",
        totalAmount: 120,
      })
      .mockResolvedValueOnce({
        id: 1002,
        orderNumber: "A002",
        totalAmount: 80,
      });
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify({
          marketSlug: "fengjia",
          guestName: "Guest",
          phoneLastDigits: "789",
          notes: "全單備註",
          vendors: [
            {
              restaurantId: "restaurant-1",
              items: [{ menuItemId: 101, quantity: 2 }],
              notes: "雞排攤備註",
            },
            {
              restaurantId: "restaurant-2",
              items: [{ menuItemId: 202, quantity: 1 }],
            },
          ],
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(201);
    const json = (await response.json()) as {
      data: {
        checkout: {
          id: string;
          market: { slug: string; name: string };
          status: string;
          subtotal: number;
          childOrders: unknown[];
        };
      };
    };
    expect(json.data.checkout).toMatchObject({
      market: {
        slug: "fengjia",
        name: "逢甲夜市",
        platformFeeRateBps: 350,
      },
      status: "submitted",
      subtotal: 20000,
    });
    expect(json.data.checkout.childOrders).toHaveLength(2);
    expect(createOrder).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        restaurantId: "restaurant-1",
        orderSource: "market_checkout",
        orderType: "shop",
        deliveryInfo: { type: "takeaway" },
      }),
    );
    expect(createOrder).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        restaurantId: "restaurant-2",
        orderType: "shop",
        deliveryInfo: { type: "takeaway" },
      }),
    );
    const firstOrderInput = createOrder.mock.calls[0]?.[0] as
      | { notes?: string }
      | undefined;
    expect(firstOrderInput?.notes).toContain("市場結帳");
    expect(firstOrderInput?.notes).toContain("逢甲夜市");
    expect(firstOrderInput?.notes).toContain(json.data.checkout.id);
    expect(firstOrderInput?.notes).toContain("全單備註");
    expect(firstOrderInput?.notes).toContain("雞排攤備註");
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      expect.stringMatching(/^market_checkout:/),
      expect.stringContaining('"restaurantId":"restaurant-1"'),
      { expirationTtl: 14400 },
    );
    expect(databaseMocks.insertValues[0]).toMatchObject({
      id: json.data.checkout.id,
      marketId: "market-1",
      marketSlug: "fengjia",
      marketName: "逢甲夜市",
      platformFeeRateBps: 350,
      status: "submitted",
      paymentStatus: "pending",
      phoneLastDigits: "789",
      subtotalCents: 20000,
      childOrderCount: 2,
    });
    expect(databaseMocks.insertValues[1]).toEqual([
      expect.objectContaining({
        checkoutId: json.data.checkout.id,
        restaurantId: "restaurant-1",
        restaurantName: "雞排攤",
        orderId: 1001,
        orderNumber: "A001",
        totalAmountCents: 12000,
      }),
      expect.objectContaining({
        checkoutId: json.data.checkout.id,
        restaurantId: "restaurant-2",
        restaurantName: "甜點攤",
        orderId: 1002,
        orderNumber: "A002",
        totalAmountCents: 8000,
      }),
    ]);
    expect(enforceQuota).toHaveBeenCalledTimes(2);
    expect(meterEmit).toHaveBeenCalledTimes(2);
  });

  it("scopes anonymous market checkout active-order keys to the issued guest tokens", async () => {
    setTwoVendorCreateFixtures();
    createOrder
      .mockResolvedValueOnce({
        id: 1001,
        orderNumber: "A001",
        totalAmount: 120,
        totalAmountCents: null,
      })
      .mockResolvedValueOnce({
        id: 1002,
        orderNumber: "A002",
        totalAmount: 80,
        totalAmountCents: 8000,
      });
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.9" },
        body: JSON.stringify({
          marketSlug: "fengjia",
          guestName: "Anonymous",
          phoneLastDigits: "000",
          vendors: [
            {
              restaurantId: "restaurant-1",
              items: [{ menuItemId: 101, quantity: 1 }],
            },
            {
              restaurantId: "restaurant-2",
              items: [{ menuItemId: 202, quantity: 1 }],
            },
          ],
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { checkout: { subtotal: 20000 } },
    });
    // A brand-new anonymous shopper presents no guest token, so there is no
    // prior identity to look up — nothing may be keyed off the client address.
    const activeLookups = env.CACHE_KV.get.mock.calls
      .map(([key]: [string]) => key)
      .filter((key: string) => key.startsWith("guest_active:"));
    expect(activeLookups).toEqual([]);

    // Every vendor's lock is written under one identity — the first child's
    // token, which is the one the customer app keeps as its bearer. Keying each
    // vendor on its own minted token would leave every lock but the first
    // unreadable on the next checkout.
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "guest_active:restaurant-1:token:guest-token-1",
      "1001",
      { expirationTtl: 7200 },
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "guest_active:restaurant-2:token:guest-token-1",
      "1002",
      { expirationTtl: 7200 },
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "guest_active_lookup:1001",
      "guest_active:restaurant-1:token:guest-token-1",
      { expirationTtl: 7200 },
    );
    expect(databaseMocks.insertValues[0]).toMatchObject({
      phoneLastDigits: "000",
      subtotalCents: 20000,
    });
  });

  it("does not block separate anonymous shoppers sharing a market's WiFi address", async () => {
    setTwoVendorCreateFixtures({ repeat: 2 });
    createOrder.mockImplementation(async () => ({
      id: 1000 + createOrder.mock.calls.length,
      orderNumber: `A00${createOrder.mock.calls.length}`,
      totalAmount: 120,
    }));
    const env = createEnv();
    const shopperRequest = () =>
      new Request("https://test/", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.9" },
        body: JSON.stringify({
          marketSlug: "fengjia",
          guestName: "Anonymous",
          phoneLastDigits: "000",
          vendors: [
            {
              restaurantId: "restaurant-1",
              items: [{ menuItemId: 101, quantity: 1 }],
            },
            {
              restaurantId: "restaurant-2",
              items: [{ menuItemId: 202, quantity: 1 }],
            },
          ],
        }),
      });

    const firstResponse = await routes.fetch(shopperRequest(), env as never);
    const secondResponse = await routes.fetch(shopperRequest(), env as never);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(createOrder).toHaveBeenCalledTimes(4);
  });

  it("rejects invalid market checkout creation requests before reading vendors", async () => {
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify({ marketSlug: "fengjia", vendors: [] }),
      }),
      env as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Validation failed" },
    });
    expect(databaseMocks.createDatabase).not.toHaveBeenCalled();
  });

  it("rejects market checkout creation for unknown markets", async () => {
    setSelectFixtures({ markets: [[]] });
    const env = createEnv();

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify({
            marketSlug: "missing-market",
            phoneLastDigits: "789",
            vendors: [
              {
                restaurantId: "restaurant-1",
                items: [{ menuItemId: 101, quantity: 1 }],
              },
              {
                restaurantId: "restaurant-2",
                items: [{ menuItemId: 202, quantity: 1 }],
              },
            ],
          }),
        }),
        env as never,
      ),
    );

    await expectApiError(response, 404, "NOT_FOUND");
  });

  it("rejects duplicate vendors in a market checkout", async () => {
    setSelectFixtures({
      markets: [
        [
          {
            id: "market-1",
            slug: "fengjia",
            name: "Fengjia Night Market",
            platformFeeRateBps: 350,
            isActive: true,
          },
        ],
      ],
    });
    const env = createEnv();

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify({
            marketSlug: "fengjia",
            phoneLastDigits: "789",
            vendors: [
              {
                restaurantId: "restaurant-1",
                items: [{ menuItemId: 101, quantity: 1 }],
              },
              {
                restaurantId: "restaurant-1",
                items: [{ menuItemId: 102, quantity: 1 }],
              },
            ],
          }),
        }),
        env as never,
      ),
    );

    await expectApiError(response, 400, "BAD_REQUEST");
  });

  it("blocks market checkout creation when a vendor already has an active guest order", async () => {
    // The active-order lock rejects before the menu is read.
    setTwoVendorCreateFixtures({ menuItems: [] });
    const env = createEnv();
    await env.CACHE_KV.put(
      `guest_active:restaurant-1:token:${ACTIVE_GUEST_TOKEN}`,
      "order-1",
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/", {
          method: "POST",
          headers: { Authorization: `Bearer ${ACTIVE_GUEST_TOKEN}` },
          body: JSON.stringify({
            marketSlug: "fengjia",
            phoneLastDigits: "789",
            vendors: [
              {
                restaurantId: "restaurant-1",
                items: [{ menuItemId: 101, quantity: 1 }],
              },
              {
                restaurantId: "restaurant-2",
                items: [{ menuItemId: 202, quantity: 1 }],
              },
            ],
          }),
        }),
        env as never,
      ),
    );

    await expectApiError(response, 409, "MARKET_VENDOR_ACTIVE_ORDER_EXISTS");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("links every child order to the shopper's account when they are signed in", async () => {
    // The same route serves anonymous and signed-in shoppers, and a child order
    // with a null customer_id never shows up in `GET /customers/me/orders`.
    signedInCustomer.value = { id: "customer-9" };
    setTwoVendorCreateFixtures();
    createOrder
      .mockResolvedValueOnce({
        id: 1001,
        orderNumber: "A001",
        totalAmount: 120,
        totalAmountCents: 12000,
      })
      .mockResolvedValueOnce({
        id: 1002,
        orderNumber: "A002",
        totalAmount: 80,
        totalAmountCents: 8000,
      });
    const env = createEnv();

    const response = await routes.fetch(
      twoVendorRequestWithHeaders({}),
      env as never,
    );

    expect(response.status).toBe(201);
    expect(createOrder).toHaveBeenCalledTimes(2);
    for (const call of createOrder.mock.calls) {
      expect(call[0]).toMatchObject({ customerId: "customer-9" });
    }
    expect(databaseMocks.insertValues).toContainEqual(
      expect.objectContaining({ customerId: "customer-9" }),
    );
  });

  it("leaves an anonymous shopper's child orders unlinked", async () => {
    setTwoVendorCreateFixtures();
    createOrder
      .mockResolvedValueOnce({
        id: 1001,
        orderNumber: "A001",
        totalAmount: 120,
        totalAmountCents: 12000,
      })
      .mockResolvedValueOnce({
        id: 1002,
        orderNumber: "A002",
        totalAmount: 80,
        totalAmountCents: 8000,
      });
    const env = createEnv();

    const response = await routes.fetch(
      twoVendorRequestWithHeaders({}),
      env as never,
    );

    expect(response.status).toBe(201);
    expect(createOrder).toHaveBeenCalledTimes(2);
    for (const call of createOrder.mock.calls) {
      expect(call[0].customerId).toBeUndefined();
    }
    expect(databaseMocks.insertValues).toContainEqual(
      expect.objectContaining({ customerId: null }),
    );
  });

  it("keys every vendor's lock on the shopper's device id", async () => {
    setTwoVendorCreateFixtures();
    createOrder
      .mockResolvedValueOnce({
        id: 1001,
        orderNumber: "A001",
        totalAmount: 120,
        totalAmountCents: 12000,
      })
      .mockResolvedValueOnce({
        id: 1002,
        orderNumber: "A002",
        totalAmount: 80,
        totalAmountCents: 8000,
      });
    const env = createEnv();

    const response = await routes.fetch(
      twoVendorRequestWithHeaders({
        [GUEST_DEVICE_ID_HEADER]: GUEST_DEVICE_ID,
      }),
      env as never,
    );

    expect(response.status).toBe(201);
    const activeLookups = env.CACHE_KV.get.mock.calls
      .map(([key]: [string]) => key)
      .filter((key: string) => key.startsWith("guest_active:"));
    expect(activeLookups).toEqual([
      `guest_active:restaurant-1:device:${GUEST_DEVICE_ID}`,
      `guest_active:restaurant-2:device:${GUEST_DEVICE_ID}`,
    ]);
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      `guest_active:restaurant-1:device:${GUEST_DEVICE_ID}`,
      "1001",
      { expirationTtl: 7200 },
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      `guest_active:restaurant-2:device:${GUEST_DEVICE_ID}`,
      "1002",
      { expirationTtl: 7200 },
    );
  });

  it("blocks a later checkout at a vendor that was not the first of the earlier one", async () => {
    // The vendor holding the open order is the *second* of this checkout, and
    // the lock was written during a checkout whose first child minted a
    // different token. Only a device-wide identity finds it.
    setTwoVendorCreateFixtures({ menuItems: [] });
    const env = createEnv();
    await env.CACHE_KV.put(
      `guest_active:restaurant-2:device:${GUEST_DEVICE_ID}`,
      "1002",
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        twoVendorRequestWithHeaders({
          [GUEST_DEVICE_ID_HEADER]: GUEST_DEVICE_ID,
        }),
        env as never,
      ),
    );

    await expectApiError(response, 409, "MARKET_VENDOR_ACTIVE_ORDER_EXISTS");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("still checks the lock when a signed-in shopper's bearer token is a customer JWT", async () => {
    // Market checkout runs through this guest route even for a shopper with an
    // account, and the customer app sends the customer JWT in Authorization.
    // Reading the identity off that header alone would skip the check entirely.
    setTwoVendorCreateFixtures({ menuItems: [] });
    const env = createEnv();
    await env.CACHE_KV.put(
      `guest_active:restaurant-1:device:${GUEST_DEVICE_ID}`,
      "1001",
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        twoVendorRequestWithHeaders({
          [GUEST_DEVICE_ID_HEADER]: GUEST_DEVICE_ID,
          Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature",
        }),
        env as never,
      ),
    );

    await expectApiError(response, 409, "MARKET_VENDOR_ACTIVE_ORDER_EXISTS");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("rejects a checkout whose vendors price in different currencies", async () => {
    setTwoVendorCreateFixtures({
      firstRestaurant: {
        id: "restaurant-1",
        name: "Nasi lemak",
        isActive: true,
        isAvailable: true,
        settings: { allowGuestOrders: true, currency: "MYR" },
      },
    });
    const env = createEnv();

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify({
            marketSlug: "fengjia",
            guestName: "Guest",
            phoneLastDigits: "789",
            vendors: [
              {
                restaurantId: "restaurant-1",
                items: [{ menuItemId: 101, quantity: 1 }],
              },
              {
                restaurantId: "restaurant-2",
                items: [{ menuItemId: 202, quantity: 1 }],
              },
            ],
          }),
        }),
        env as never,
      ),
    );

    await expectApiError(response, 409, "MIXED_CURRENCY_CHECKOUT");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("rejects inactive, unavailable, and guest-order-disabled market vendors", async () => {
    const scenarios = [
      {
        name: "missing membership",
        firstRestaurant: {
          id: "restaurant-1",
          name: "Vendor 1",
          isActive: true,
          isAvailable: true,
          settings: { allowGuestOrders: true },
        },
        firstMembership: null,
        expectedStatus: 400,
        expectedCode: "BAD_REQUEST",
      },
      {
        name: "unavailable restaurant",
        firstRestaurant: {
          id: "restaurant-1",
          name: "Vendor 1",
          isActive: true,
          isAvailable: false,
          settings: { allowGuestOrders: true },
        },
        firstMembership: { restaurantId: "restaurant-1", marketId: "market-1" },
        expectedStatus: 400,
        expectedCode: "BAD_REQUEST",
      },
      {
        name: "guest orders disabled",
        firstRestaurant: {
          id: "restaurant-1",
          name: "Vendor 1",
          isActive: true,
          isAvailable: true,
          settings: { allowGuestOrders: false },
        },
        firstMembership: { restaurantId: "restaurant-1", marketId: "market-1" },
        expectedStatus: 403,
        expectedCode: "FORBIDDEN",
      },
    ] as const;

    for (const scenario of scenarios) {
      databaseMocks.selectFixtures.clear();
      createOrder.mockClear();
      setTwoVendorCreateFixtures({
        firstRestaurant: scenario.firstRestaurant,
        firstMembership: scenario.firstMembership,
        // Every scenario here is rejected on the vendor checks, before the
        // route reaches the menu; declare zero menu reads so a future one
        // fails loudly instead of consuming a spare row.
        menuItems: [],
      });
      const env = createEnv();

      const response = await withSilencedRouteError(() =>
        routes.fetch(
          new Request("https://test/", {
            method: "POST",
            body: JSON.stringify({
              marketSlug: "fengjia",
              phoneLastDigits: "789",
              vendors: [
                {
                  restaurantId: "restaurant-1",
                  items: [{ menuItemId: 101, quantity: 1 }],
                },
                {
                  restaurantId: "restaurant-2",
                  items: [{ menuItemId: 202, quantity: 1 }],
                },
              ],
            }),
          }),
          env as never,
        ),
      );

      await expectApiError(
        response,
        scenario.expectedStatus,
        scenario.expectedCode,
      );
      expect(createOrder).not.toHaveBeenCalled();
    }
  });

  it("rejects market checkout creation when requested menu items are unavailable", async () => {
    setTwoVendorCreateFixtures({ menuItems: [[]] });
    const env = createEnv();

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/", {
          method: "POST",
          body: JSON.stringify({
            marketSlug: "fengjia",
            phoneLastDigits: "789",
            vendors: [
              {
                restaurantId: "restaurant-1",
                items: [{ menuItemId: 101, quantity: 1 }],
              },
              {
                restaurantId: "restaurant-2",
                items: [{ menuItemId: 202, quantity: 1 }],
              },
            ],
          }),
        }),
        env as never,
      ),
    );

    await expectApiError(response, 409, "MENU_ITEM_UNAVAILABLE");
    expect(createOrder).not.toHaveBeenCalled();
  });

  function setTwoVendorCreateQueue() {
    setTwoVendorCreateFixtures();
  }

  function twoVendorCreateRequest() {
    return new Request("https://test/", {
      method: "POST",
      body: JSON.stringify({
        marketSlug: "fengjia",
        guestName: "Guest",
        phoneLastDigits: "789",
        vendors: [
          {
            restaurantId: "restaurant-1",
            items: [{ menuItemId: 101, quantity: 2 }],
          },
          {
            restaurantId: "restaurant-2",
            items: [{ menuItemId: 202, quantity: 1 }],
          },
        ],
      }),
    });
  }

  function findFailedSessionInsert() {
    return databaseMocks.insertValues.find(
      (value): value is Record<string, unknown> =>
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "status" in value &&
        "marketId" in value,
    );
  }

  it("compensates already-created vendor orders when a later vendor fails mid-loop", async () => {
    setTwoVendorCreateQueue();
    createOrder
      .mockResolvedValueOnce({
        id: 1001,
        orderNumber: "A001",
        totalAmount: 120,
      })
      .mockRejectedValueOnce(new Error("vendor 2 createOrder exploded"));
    cancelOrder.mockResolvedValue({ id: 1001, status: "cancelled" });
    const env = createEnv();

    const response = await withSilencedRouteError(() =>
      routes.fetch(twoVendorCreateRequest(), env as never),
    );

    // A downstream order creation throws after the first order commits, so
    // this is a genuine unexpected dependency failure rather than an ApiError.
    expect(response.status).toBe(500);

    // The first vendor's committed order is cancelled (compensation).
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(cancelOrder).toHaveBeenCalledTimes(1);
    expect(cancelOrder).toHaveBeenCalledWith(
      "1001",
      expect.stringContaining("rolled back"),
    );

    // Its active-order lock, reverse lookup, and guest token are cleared so a
    // retry starts clean.
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      "guest_active:restaurant-1:token:guest-token-1",
    );
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      "guest_active_lookup:1001",
    );
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      "guest_token:guest-token-1",
    );

    // The failed checkout is recorded with an explicit failed status.
    const failedSession = findFailedSessionInsert();
    expect(failedSession?.status).toBe("failed");
    expect(failedSession?.childOrderCount).toBe(1);
  });

  it("flags the session for manual review when compensation itself fails", async () => {
    setTwoVendorCreateQueue();
    createOrder
      .mockResolvedValueOnce({
        id: 1001,
        orderNumber: "A001",
        totalAmount: 120,
      })
      .mockRejectedValueOnce(new Error("vendor 2 createOrder exploded"));
    cancelOrder.mockRejectedValue(new Error("cancel also failed"));
    const env = createEnv();

    const response = await withSilencedRouteError(() =>
      routes.fetch(twoVendorCreateRequest(), env as never),
    );

    // Both the later order creation and compensating cancellation fail, which
    // intentionally remains an unexpected 500 for manual review.
    expect(response.status).toBe(500);
    expect(cancelOrder).toHaveBeenCalledWith(
      "1001",
      expect.stringContaining("rolled back"),
    );

    const failedSession = findFailedSessionInsert();
    expect(failedSession?.status).toBe("requires_manual_review");
  });

  it("hydrates child order status when reading a market checkout", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 1002,
            orderNumber: "A002",
            totalAmount: 80,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 20000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );
    getOrder
      .mockResolvedValueOnce({
        id: 1001,
        orderNumber: "A001",
        totalAmount: 120,
        status: "preparing",
        paymentStatus: "pending",
        updatedAt: 1780308300000,
      })
      .mockResolvedValueOnce({
        id: 1002,
        orderNumber: "A002",
        totalAmount: 80,
        status: "ready",
        paymentStatus: "completed",
        updatedAt: 1780308400000,
      });

    const response = await routes.fetch(
      new Request("https://test/checkout-1"),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        checkout: {
          childOrders: Array<{
            status?: string;
            paymentStatus?: string;
            updatedAt?: number;
          }>;
        };
      };
    };
    expect(getOrder).toHaveBeenNthCalledWith(1, 1001, false);
    expect(getOrder).toHaveBeenNthCalledWith(2, 1002, false);
    expect(json.data.checkout.childOrders[0]).toMatchObject({
      status: "preparing",
      paymentStatus: "pending",
      updatedAt: 1780308300000,
    });
    expect(json.data.checkout.childOrders[1]).toMatchObject({
      status: "ready",
      paymentStatus: "completed",
      updatedAt: 1780308400000,
    });
  });

  it("reissues a child guest token for a persisted market checkout", async () => {
    setSelectFixtures({
      marketCheckoutSessions: [
        [
          {
            id: "checkout-1",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            status: "submitted",
            paymentStatus: "pending",
            phoneLastDigits: "789",
            subtotalCents: 12000,
            childOrderCount: 1,
            paymentSummary: null,
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:00:00.000Z"),
          },
        ],
      ],
      marketCheckoutChildOrders: [
        [
          {
            checkoutId: "checkout-1",
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            totalAmountCents: 12000,
            tokenExpiresAt: new Date("2026-06-01T12:00:00.000Z"),
          },
        ],
      ],
    });
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/checkout-1/guest-token", {
        method: "POST",
        body: JSON.stringify({
          orderId: 1001,
          phoneLastDigits: "789",
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { orderId: number; guestToken: string; tokenExpiresAt: string };
    };
    expect(json.data).toMatchObject({
      orderId: 1001,
      guestToken: "guest-token-1",
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "guest_token:guest-token-1",
      expect.stringContaining('"orderId":"1001"'),
      { expirationTtl: 14400 },
    );
  });

  it("lets the persisted checkout owner recover a guest token without phone digits", async () => {
    signedInCustomer.value = { id: "customer-9" };
    setSelectFixtures({
      marketCheckoutSessions: [
        [
          {
            id: "checkout-1",
            customerId: "customer-9",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            status: "submitted",
            paymentStatus: "pending",
            phoneLastDigits: "789",
            subtotalCents: 12000,
            childOrderCount: 1,
            paymentSummary: null,
            appliedVoucher: null,
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:00:00.000Z"),
          },
        ],
      ],
      marketCheckoutChildOrders: [
        [
          {
            checkoutId: "checkout-1",
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: "1001",
            orderNumber: "A001",
            totalAmountCents: 12000,
            tokenExpiresAt: new Date("2026-06-01T12:00:00.000Z"),
          },
        ],
      ],
    });

    const response = await routes.fetch(
      new Request("https://test/checkout-1/guest-token", {
        method: "POST",
        body: JSON.stringify({ orderId: "1001" }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
  });

  it("rejects guest token recovery when phone digits do not match", async () => {
    setSelectFixtures({
      marketCheckoutSessions: [
        [
          {
            id: "checkout-1",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            status: "submitted",
            paymentStatus: "pending",
            phoneLastDigits: "789",
            subtotalCents: 12000,
            childOrderCount: 1,
            paymentSummary: null,
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:00:00.000Z"),
          },
        ],
      ],
      marketCheckoutChildOrders: [[]],
    });
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/checkout-1/guest-token", {
        method: "POST",
        body: JSON.stringify({
          orderId: 1001,
          phoneLastDigits: "123",
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(403);
    expect(env.CACHE_KV.put).not.toHaveBeenCalledWith(
      "guest_token:guest-token-1",
      expect.any(String),
      expect.any(Object),
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout_recover_attempts:checkout-1",
      "1",
      { expirationTtl: 3600 },
    );
  });

  it("locks guest token recovery after repeated phone verification failures", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        phoneLastDigits: "789",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 12000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );
    await env.CACHE_KV.put("market_checkout_recover_attempts:checkout-1", "5");

    const response = await routes.fetch(
      new Request("https://test/checkout-1/guest-token", {
        method: "POST",
        body: JSON.stringify({
          orderId: 1001,
          phoneLastDigits: "789",
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(429);
    expect(env.CACHE_KV.put).not.toHaveBeenCalledWith(
      "guest_token:guest-token-1",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("clears guest token recovery failures after successful verification", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        phoneLastDigits: "789",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 12000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );
    await env.CACHE_KV.put("market_checkout_recover_attempts:checkout-1", "2");

    const response = await routes.fetch(
      new Request("https://test/checkout-1/guest-token", {
        method: "POST",
        body: JSON.stringify({
          orderId: 1001,
          phoneLastDigits: "789",
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      "market_checkout_recover_attempts:checkout-1",
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "guest_token:guest-token-1",
      expect.stringContaining('"orderId":"1001"'),
      { expirationTtl: 14400 },
    );
  });

  it("rejects malformed guest token recovery requests before reading a checkout", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/checkout-1/guest-token", {
        method: "POST",
        body: JSON.stringify({
          orderId: 0,
          phoneLastDigits: "12",
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Validation failed" },
    });
    expect(env.CACHE_KV.get).not.toHaveBeenCalledWith(
      "market_checkout:checkout-1",
    );

    const missingEnv = createEnv();
    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/missing-checkout/guest-token", {
          method: "POST",
          body: JSON.stringify({
            orderId: 1001,
            phoneLastDigits: "789",
          }),
        }),
        missingEnv as never,
      ),
    );

    await expectApiError(missingResponse, 404, "NOT_FOUND");
  });

  it("rejects guest token recovery for orders outside the checkout", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/guest-token", {
          method: "POST",
          body: JSON.stringify({
            orderId: 9999,
            phoneLastDigits: "789",
          }),
        }),
        env as never,
      ),
    );

    await expectApiError(response, 404, "NOT_FOUND");
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith(
      "market_checkout_recover_attempts:checkout-1",
    );
    expect(env.CACHE_KV.put).not.toHaveBeenCalledWith(
      "guest_token:guest-token-1",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("keeps stored child order summaries when hydration misses", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 12000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );
    getOrder.mockResolvedValueOnce(null);

    const response = await routes.fetch(
      new Request("https://test/checkout-1"),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        checkout: {
          childOrders: Array<{ orderNumber: string; status?: string }>;
        };
      };
    };
    expect(json.data.checkout.childOrders[0]).toMatchObject({
      orderNumber: "A001",
    });
    expect(json.data.checkout.childOrders[0].status).toBeUndefined();
  });

  it("reads public checkout details from persisted storage before KV fallback", async () => {
    setSelectFixtures({
      marketCheckoutSessions: [
        [
          {
            id: "checkout-1",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "Fengjia Night Market",
            platformFeeRateBps: 350,
            status: "submitted",
            paymentStatus: "pending",
            // A real value, not null: the assertion below is about the response
            // projection dropping the recovery credential, and a null column
            // reads back as undefined whether or not anything strips it.
            phoneLastDigits: "789",
            subtotalCents: 12000,
            childOrderCount: 1,
            paymentSummary: null,
            appliedVoucher: null,
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:05:00.000Z"),
          },
        ],
      ],
      marketCheckoutChildOrders: [
        [
          {
            checkoutId: "checkout-1",
            restaurantId: "restaurant-1",
            restaurantName: "Vendor 1",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            totalAmountCents: null,
            tokenExpiresAt: new Date("2026-06-01T12:00:00.000Z"),
          },
        ],
      ],
    });
    getOrder.mockResolvedValueOnce({
      id: 1001,
      orderNumber: "A001",
      totalAmount: 120,
      status: "ready",
      paymentStatus: "pending",
      updatedAt: 1780308400000,
    });
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/checkout-1"),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        checkout: {
          phoneLastDigits?: string;
          childOrders: Array<{
            totalAmountCents?: number | null;
            status?: string;
          }>;
        };
      };
    };
    expect(env.CACHE_KV.get).not.toHaveBeenCalledWith(
      "market_checkout:checkout-1",
    );
    expect(json.data.checkout.phoneLastDigits).toBeUndefined();
    expect(json.data.checkout.childOrders[0]).toMatchObject({
      totalAmountCents: 12000,
      status: "ready",
    });
  });

  it("withholds the recovery digits on the KV branch of the public read", async () => {
    // GET /:id serializes twice — once from the persisted row, once from the
    // KV session — so the test above leaves this branch uncovered.
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );
    getOrder.mockResolvedValueOnce(null);

    const response = await routes.fetch(
      new Request("https://test/checkout-1"),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { checkout: { phoneLastDigits?: string; id: string } };
    };
    expect(json.data.checkout.id).toBe("checkout-1");
    expect(json.data.checkout.phoneLastDigits).toBeUndefined();
  });

  it("still demands phone digits when nobody owns the checkout", async () => {
    // Regression guard for the `undefined === undefined` shape of an ownership
    // check: an anonymous caller and an unowned checkout must not compare equal
    // and skip the phone credential. Every checkout created before customer_id
    // existed, and every checkout placed while signed out, lands here.
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/guest-token", {
        method: "POST",
        body: JSON.stringify({ orderId: "1001" }),
      }),
      env as never,
    );

    await expectApiError(response, 403, "PHONE_VERIFICATION_FAILED");
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout_recover_attempts:checkout-1",
      "1",
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it("does not treat a different signed-in customer as the owner", async () => {
    signedInCustomer.value = { id: "customer-outsider" };
    setSelectFixtures(
      persistedSessionFixtures({
        ...unpaidCheckoutSessionFixture(),
        customerId: "customer-9",
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/guest-token", {
        method: "POST",
        body: JSON.stringify({ orderId: "1001" }),
      }),
      createEnv() as never,
    );

    await expectApiError(response, 403, "PHONE_VERIFICATION_FAILED");
  });

  it("keeps the owner's recovery open while the phone lockout is in force", async () => {
    // The lockout guards a three-digit credential. An attacker who burns it
    // must not be able to shut the account holder out of their own checkout.
    signedInCustomer.value = { id: "customer-9" };
    setSelectFixtures(
      persistedSessionFixtures({
        ...unpaidCheckoutSessionFixture(),
        customerId: "customer-9",
      }),
    );
    const env = createEnv();
    await env.CACHE_KV.put("market_checkout_recover_attempts:checkout-1", "5");

    const response = await routes.fetch(
      new Request("https://test/checkout-1/guest-token", {
        method: "POST",
        body: JSON.stringify({ orderId: "1001" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
  });

  it("hydrates checkout ownership from D1 when the KV session has expired", async () => {
    // KV sessions live four hours; "open my checkout again tomorrow" is the
    // whole point of the owner column, and that path reads from D1 only.
    signedInCustomer.value = { id: "customer-9" };
    setSelectFixtures(
      persistedSessionFixtures({
        ...providerSplitPaidSessionFixture(),
        customerId: "customer-9",
      }),
    );
    getOrder.mockResolvedValue(null);
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/checkout-1"),
      env as never,
    );

    expect(env.CACHE_KV.get).not.toHaveBeenCalledWith(
      "market_checkout:checkout-1",
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        checkout: {
          payment?: { childPayments: Array<{ paymentId?: string }> };
        };
      };
    };
    expect(json.data.checkout.payment?.childPayments[0]?.paymentId).toBe(
      "mock-pay-101",
    );
  });

  it("redacts payment plumbing for a caller who only knows the checkout id", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(providerSplitPaidSessionFixture()),
    );
    getOrder.mockResolvedValue(null);

    const response = await routes.fetch(
      new Request("https://test/checkout-1"),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        checkout: {
          id: string;
          childOrders: Array<{ restaurantName: string }>;
          payment?: {
            status: string;
            childPayments: Array<{
              paymentId?: string;
              refundId?: string;
              errorMessage?: string;
            }>;
            parentPayment?: unknown;
            settlement?: unknown;
          };
        };
      };
    };
    // Progress stays readable — people eating off one payment share this link.
    expect(json.data.checkout.id).toBe("checkout-1");
    expect(json.data.checkout.childOrders[0]?.restaurantName).toBe("雞排攤");
    expect(json.data.checkout.payment?.status).toBe("paid");
    // The plumbing does not.
    expect(
      json.data.checkout.payment?.childPayments[0]?.paymentId,
    ).toBeUndefined();
    expect(json.data.checkout.payment?.parentPayment).toBeUndefined();
    expect(json.data.checkout.payment?.settlement).toBeUndefined();
  });

  it("gives the guest-token holder the unredacted checkout", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(providerSplitPaidSessionFixture()),
    );
    getOrder.mockResolvedValue(null);

    const response = await routes.fetch(
      new Request("https://test/checkout-1", {
        headers: MARKET_PAID_HOLDER_HEADERS,
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        checkout: {
          payment?: {
            childPayments: Array<{ paymentId?: string }>;
            parentPayment?: { paymentId: string };
          };
        };
      };
    };
    expect(json.data.checkout.payment?.childPayments[0]?.paymentId).toBe(
      "mock-pay-101",
    );
    expect(json.data.checkout.payment?.parentPayment?.paymentId).toBe(
      "market_pay_checkout-1",
    );
  });

  it("rejects checkout mutations from a caller who only knows the checkout id", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        ...unpaidCheckoutSessionFixture(),
        appliedVoucher: {
          couponId: 42,
          code: "MARKET10",
          name: "Market 10",
          fundedBy: "platform",
          discountCents: 2000,
          allocations: [
            { orderId: 1001, amountCents: 12000, discountCents: 1200 },
          ],
          reservationStatus: "reserved",
        },
      }),
    );

    const removal = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/voucher", { method: "DELETE" }),
        env as never,
      ),
    );
    await expectApiError(removal, 403, "MARKET_CHECKOUT_ACCESS_DENIED");
    // Stripping someone else's voucher is the cheapest way to make them pay
    // full price, so the reservation must survive the rejected call.
    expect(releaseVoucherReservation).not.toHaveBeenCalled();

    const payment = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/pay", {
          method: "POST",
          body: JSON.stringify({ method: "line_pay" }),
        }),
        env as never,
      ),
    );
    await expectApiError(payment, 403, "MARKET_CHECKOUT_ACCESS_DENIED");
    expect(processPayment).not.toHaveBeenCalled();
  });

  it("accepts holder proof from the header the JWT cannot displace", async () => {
    // The customer app puts either the customer JWT or a guest token in
    // Authorization, never both, so a signed-in shopper paying a checkout they
    // placed while signed out sends the token in the dedicated header instead.
    // Both credentials therefore ride along at once, and that is what the
    // request below sends: the JWT holds Authorization while the guest token
    // sits in X-Guest-Token. Sending the header on its own would still pass
    // under a gate that reads Authorization first and stops there, which is
    // exactly the regression this test exists to catch.
    signedInCustomer.value = { id: "customer-outsider" };
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/voucher", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature",
          "X-Guest-Token": MARKET_HOLDER_TOKEN,
        },
      }),
      env as never,
    );

    expect(response.status).toBe(200);
  });

  it("rejects a guest token that is no longer in the cache", async () => {
    // Guest tokens live four hours in KV. Once one expires the lookup misses,
    // and the caller has to be turned away rather than falling through on the
    // strength of holding a well-formed token.
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/voucher", {
          method: "DELETE",
          headers: { Authorization: "Bearer gt_expired-token" },
        }),
        env as never,
      ),
    );

    await expectApiError(response, 403, "MARKET_CHECKOUT_ACCESS_DENIED");
    expect(releaseVoucherReservation).not.toHaveBeenCalled();
  });

  it("rejects a guest token whose cached payload is unreadable", async () => {
    // KV hands back whatever was written. A truncated or half-written value
    // must fail closed: the gate cannot read an order id out of it, so it has
    // no grounds to call this caller a holder.
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );
    await env.CACHE_KV.put("guest_token:gt_corrupt-token", "{not json");

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/voucher", {
          method: "DELETE",
          headers: { Authorization: "Bearer gt_corrupt-token" },
        }),
        env as never,
      ),
    );

    await expectApiError(response, 403, "MARKET_CHECKOUT_ACCESS_DENIED");
    expect(releaseVoucherReservation).not.toHaveBeenCalled();
  });

  it("rejects checkout mutations carrying another checkout's guest token", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );
    // A shopper who ordered elsewhere in between carries a valid guest token
    // for an order that is not part of this checkout.
    await env.CACHE_KV.put(
      "guest_token:gt_other-checkout",
      JSON.stringify({
        orderId: "9999",
        restaurantId: "restaurant-7",
        guestName: "Guest",
        createdAt: 0,
      }),
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/voucher", {
          method: "POST",
          headers: { Authorization: "Bearer gt_other-checkout" },
          body: JSON.stringify({ code: "MARKET10" }),
        }),
        env as never,
      ),
    );

    await expectApiError(response, 403, "MARKET_CHECKOUT_ACCESS_DENIED");
    expect(validateVoucherAndPrice).not.toHaveBeenCalled();
  });

  it("applies a voucher to an unpaid market checkout", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );
    validateVoucherAndPrice.mockResolvedValue({
      couponId: 42,
      code: "MARKET10",
      name: "Market 10",
      fundedBy: "platform",
      discountCents: 2000,
      allocations: [
        { orderId: 1001, amountCents: 12000, discountCents: 1200 },
        { orderId: 1002, amountCents: 8000, discountCents: 800 },
      ],
    });

    const response = await routes.fetch(
      new Request("https://test/checkout-1/voucher", {
        method: "POST",
        headers: MARKET_HOLDER_HEADERS,
        body: JSON.stringify({ code: " market10 " }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const voucherJson = (await response.json()) as {
      data: { checkout: { phoneLastDigits?: string } };
    };
    expect(voucherJson).toMatchObject({
      success: true,
      data: {
        discountCents: 2000,
        payableCents: 18000,
        voucher: {
          couponId: 42,
          code: "MARKET10",
          reservationStatus: "reserved",
        },
      },
    });
    // The mutating endpoints echo the whole session back, so they need the
    // same projection as the read endpoints.
    expect(voucherJson.data.checkout.phoneLastDigits).toBeUndefined();
    expect(reserveVoucherUsage).toHaveBeenCalledWith(
      expect.objectContaining({ couponId: 42, code: "MARKET10" }),
    );
    expect(validateVoucherAndPrice).toHaveBeenCalledWith({
      code: " market10 ",
      subtotalCents: 20000,
      childOrders: [
        { orderId: 1001, restaurantId: "restaurant-1", amountCents: 12000 },
        { orderId: 1002, restaurantId: "restaurant-2", amountCents: 8000 },
      ],
      currency: "TWD",
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"reservationStatus":"reserved"'),
      { expirationTtl: 14400 },
    );
  });

  it.each([
    [
      "MYR vendors round in sen",
      [
        { id: "restaurant-1", settings: JSON.stringify({ currency: "myr" }) },
        { id: "restaurant-2", settings: { currency: "MYR" } },
      ],
      200,
      "MYR",
    ],
    [
      "vendors in different currencies",
      [
        { id: "restaurant-1", settings: { currency: "TWD" } },
        { id: "restaurant-2", settings: { currency: "VND" } },
      ],
      409,
      "MIXED_CURRENCY_CHECKOUT",
    ],
    [
      "a vendor with an unsupported currency",
      [
        { id: "restaurant-1", settings: { currency: "USD" } },
        { id: "restaurant-2", settings: "not-json" },
      ],
      500,
      "RESTAURANT_CURRENCY_INVALID",
    ],
  ])(
    "prices a voucher in the vendors' currency: %s",
    async (_label, vendors, status, expected) => {
      // Drive the real resolution rules over these vendor rows; the resolver
      // itself is covered against D1 in restaurant-currency.test.ts.
      const actual = await vi.importActual<
        typeof import("../../../shared/utils/restaurant-currency")
      >("../../../shared/utils/restaurant-currency");
      resolveSharedRestaurantCurrency.mockImplementation(async () =>
        actual.sharedCurrency(
          vendors.map((vendor) => ({
            restaurantId: vendor.id,
            currency: actual.currencyFromRestaurantSettings(
              vendor.settings,
              vendor.id,
            ),
          })),
        ),
      );
      const env = createEnv();
      await env.CACHE_KV.put(
        "market_checkout:checkout-1",
        JSON.stringify(unpaidCheckoutSessionFixture()),
      );
      validateVoucherAndPrice.mockResolvedValue({
        couponId: 42,
        code: "MARKET10",
        name: "Market 10",
        fundedBy: "platform",
        discountCents: 2000,
        allocations: [
          { orderId: 1001, amountCents: 12000, discountCents: 1200 },
          { orderId: 1002, amountCents: 8000, discountCents: 800 },
        ],
      });

      const response = await routes.fetch(
        new Request("https://test/checkout-1/voucher", {
          method: "POST",
          headers: MARKET_HOLDER_HEADERS,
          body: JSON.stringify({ code: "market10" }),
        }),
        env as never,
      );

      expect(response.status).toBe(status);
      if (status === 200) {
        expect(validateVoucherAndPrice).toHaveBeenCalledWith(
          expect.objectContaining({ currency: expected }),
        );
      } else {
        expect(await response.json()).toMatchObject({
          error: { code: expected },
        });
        expect(validateVoucherAndPrice).not.toHaveBeenCalled();
      }
    },
  );

  it("prices a voucher in the currency of an existing payment", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        ...unpaidCheckoutSessionFixture(),
        payment: {
          status: "failed",
          method: "market_online",
          currency: "VND",
          country: "VN",
          totalAmount: 200,
          totalAmountCents: 20000,
          paidAmount: 0,
          paidAmountCents: 0,
          childPayments: [],
        },
      }),
    );
    validateVoucherAndPrice.mockResolvedValue({
      couponId: 42,
      code: "MARKET10",
      name: "Market 10",
      fundedBy: "platform",
      discountCents: 2000,
      allocations: [
        { orderId: 1001, amountCents: 12000, discountCents: 1200 },
        { orderId: 1002, amountCents: 8000, discountCents: 800 },
      ],
    });

    const response = await routes.fetch(
      new Request("https://test/checkout-1/voucher", {
        method: "POST",
        headers: MARKET_HOLDER_HEADERS,
        body: JSON.stringify({ code: "market10" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(validateVoucherAndPrice).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "VND" }),
    );
  });

  it("releases the reserved voucher slot when apply persistence fails", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );
    validateVoucherAndPrice.mockResolvedValue({
      couponId: 42,
      code: "MARKET10",
      name: "Market 10",
      fundedBy: "platform",
      discountCents: 2000,
      allocations: [
        { orderId: 1001, amountCents: 12000, discountCents: 1200 },
        { orderId: 1002, amountCents: 8000, discountCents: 800 },
      ],
    });
    vi.mocked(env.CACHE_KV.put).mockRejectedValueOnce(new Error("kv down"));

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/voucher", {
          method: "POST",
          headers: MARKET_HOLDER_HEADERS,
          body: JSON.stringify({ code: "market10" }),
        }),
        env as never,
      ),
    );

    // The KV persistence failure is deliberately non-ApiError; the assertion
    // verifies that voucher reservation cleanup still happens before the 500.
    expect(response.status).toBe(500);
    expect(reserveVoucherUsage).toHaveBeenCalledWith(
      expect.objectContaining({ couponId: 42, code: "MARKET10" }),
    );
    expect(releaseVoucherReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        couponId: 42,
        code: "MARKET10",
        reservationStatus: "reserved",
      }),
    );
  });

  it("applies an additional voucher against remaining child order amounts", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        ...unpaidCheckoutSessionFixture(),
        appliedVoucher: {
          couponId: 41,
          code: "FIRST10",
          name: "First 10",
          fundedBy: "platform",
          discountCents: 3000,
          allocations: [
            { orderId: 1001, amountCents: 12000, discountCents: 2000 },
            { orderId: 1002, amountCents: 8000, discountCents: 1000 },
          ],
        },
      }),
    );
    validateVoucherAndPrice.mockResolvedValue({
      couponId: 42,
      code: "SECOND5",
      name: "Second 5",
      fundedBy: "vendor",
      restaurantId: "restaurant-2",
      discountCents: 500,
      allocations: [{ orderId: 1002, amountCents: 7000, discountCents: 500 }],
    });

    const response = await routes.fetch(
      new Request("https://test/checkout-1/voucher", {
        method: "POST",
        headers: MARKET_HOLDER_HEADERS,
        body: JSON.stringify({ code: "second5" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        discountCents: 3500,
        payableCents: 16500,
        vouchers: [
          { code: "FIRST10", discountCents: 3000 },
          { code: "SECOND5", discountCents: 500 },
        ],
      },
    });
    expect(validateVoucherAndPrice).toHaveBeenCalledWith({
      code: "second5",
      subtotalCents: 17000,
      childOrders: [
        { orderId: 1001, restaurantId: "restaurant-1", amountCents: 10000 },
        { orderId: 1002, restaurantId: "restaurant-2", amountCents: 7000 },
      ],
      currency: "TWD",
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"vouchers"'),
      { expirationTtl: 14400 },
    );
  });

  it("applies and removes vouchers from persisted checkouts when KV is empty", async () => {
    setSelectFixtures(persistedSessionFixtures(unpaidCheckoutSessionFixture()));
    validateVoucherAndPrice.mockResolvedValue({
      couponId: 42,
      code: "MARKET10",
      name: "Market 10",
      fundedBy: "platform",
      discountCents: 2000,
      allocations: [
        { orderId: 1001, amountCents: 12000, discountCents: 1200 },
        { orderId: 1002, amountCents: 8000, discountCents: 800 },
      ],
    });
    const env = createEnv();

    const applyResponse = await routes.fetch(
      new Request("https://test/checkout-1/voucher", {
        method: "POST",
        headers: MARKET_HOLDER_HEADERS,
        body: JSON.stringify({ code: "market10" }),
      }),
      env as never,
    );

    expect(applyResponse.status).toBe(200);
    await expect(applyResponse.json()).resolves.toMatchObject({
      success: true,
      data: { discountCents: 2000, payableCents: 18000 },
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"appliedVoucher"'),
      { expirationTtl: 14400 },
    );

    // No fixtures are re-armed here: the apply step above wrote the checkout to
    // KV, so removal reads it from there and never touches the sessions table.

    const removeResponse = await routes.fetch(
      new Request("https://test/checkout-1/voucher", {
        method: "DELETE",
        headers: MARKET_HOLDER_HEADERS,
      }),
      env as never,
    );

    expect(removeResponse.status).toBe(200);
    const removeJson = (await removeResponse.json()) as {
      data: { checkout: { appliedVoucher?: unknown } };
    };
    expect(removeJson.data.checkout.appliedVoucher).toBeUndefined();
    expect(releaseVoucherReservation).toHaveBeenCalledWith(
      expect.objectContaining({ couponId: 42, code: "MARKET10" }),
    );
    expect(databaseMocks.updateValues.at(-1)).toMatchObject({
      appliedVoucher: null,
    });
  });

  it("rejects duplicate market checkout voucher codes", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        ...unpaidCheckoutSessionFixture(),
        appliedVoucher: {
          couponId: 42,
          code: "MARKET10",
          name: "Market 10",
          fundedBy: "platform",
          discountCents: 2000,
          allocations: [
            { orderId: 1001, amountCents: 12000, discountCents: 1200 },
            { orderId: 1002, amountCents: 8000, discountCents: 800 },
          ],
        },
      }),
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/voucher", {
          method: "POST",
          headers: MARKET_HOLDER_HEADERS,
          body: JSON.stringify({ code: "market10" }),
        }),
        env as never,
      ),
    );

    await expectApiError(response, 400, "VOUCHER_ALREADY_APPLIED");
    expect(validateVoucherAndPrice).not.toHaveBeenCalled();
  });

  it("rejects malformed voucher apply requests", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/voucher", {
        method: "POST",
        headers: MARKET_HOLDER_HEADERS,
        body: JSON.stringify({ code: "" }),
      }),
      env as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Validation failed" },
    });
    expect(validateVoucherAndPrice).not.toHaveBeenCalled();
  });

  it("rejects voucher apply requests for missing and paid checkouts", async () => {
    setNoPersistedCheckoutFixtures();
    const missingEnv = createEnv();
    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/missing-checkout/voucher", {
          method: "POST",
          body: JSON.stringify({ code: "MARKET10" }),
        }),
        missingEnv as never,
      ),
    );
    await expectApiError(missingResponse, 404, "NOT_FOUND");

    const paidEnv = createEnv();
    await paidEnv.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(providerSplitPaidSessionFixture()),
    );
    const paidResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/voucher", {
          method: "POST",
          headers: MARKET_PAID_HOLDER_HEADERS,
          body: JSON.stringify({ code: "MARKET10" }),
        }),
        paidEnv as never,
      ),
    );

    await expectApiError(paidResponse, 400, "MARKET_CHECKOUT_ALREADY_PAID");
    expect(validateVoucherAndPrice).not.toHaveBeenCalled();
  });

  it("removes a voucher from an unpaid market checkout", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        ...unpaidCheckoutSessionFixture(),
        appliedVoucher: {
          couponId: 42,
          code: "MARKET10",
          name: "Market 10",
          fundedBy: "platform",
          discountCents: 2000,
          allocations: [
            { orderId: 1001, amountCents: 12000, discountCents: 1200 },
            { orderId: 1002, amountCents: 8000, discountCents: 800 },
          ],
        },
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/voucher", {
        method: "DELETE",
        headers: MARKET_HOLDER_HEADERS,
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { checkout: { appliedVoucher?: unknown } };
    };
    expect(json.data.checkout.appliedVoucher).toBeUndefined();
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.not.stringContaining('"appliedVoucher"'),
      { expirationTtl: 14400 },
    );
  });

  it("rejects voucher removal for missing and paid checkouts", async () => {
    setNoPersistedCheckoutFixtures();
    const missingEnv = createEnv();
    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/missing-checkout/voucher", {
          method: "DELETE",
        }),
        missingEnv as never,
      ),
    );
    await expectApiError(missingResponse, 404, "NOT_FOUND");

    const paidEnv = createEnv();
    await paidEnv.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(providerSplitPaidSessionFixture()),
    );
    const paidResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/voucher", {
          method: "DELETE",
          headers: MARKET_PAID_HOLDER_HEADERS,
        }),
        paidEnv as never,
      ),
    );

    await expectApiError(paidResponse, 400, "MARKET_CHECKOUT_ALREADY_PAID");
  });

  it("rejects malformed and empty market checkout payment attempts", async () => {
    setNoPersistedCheckoutFixtures();
    const missingEnv = createEnv();
    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/missing-checkout/pay", {
          method: "POST",
          body: JSON.stringify({ method: "market_online" }),
        }),
        missingEnv as never,
      ),
    );

    await expectApiError(missingResponse, 404, "NOT_FOUND");

    const invalidEnv = createEnv();
    await invalidEnv.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );

    const invalidResponse = await routes.fetch(
      new Request("https://test/checkout-1/pay", {
        method: "POST",
        headers: MARKET_HOLDER_HEADERS,
        body: JSON.stringify({ method: "" }),
      }),
      invalidEnv as never,
    );

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Validation failed" },
    });

    const emptyEnv = createEnv();
    await emptyEnv.CACHE_KV.put(
      "market_checkout:empty-checkout",
      JSON.stringify({
        ...unpaidCheckoutSessionFixture(),
        id: "empty-checkout",
        childOrders: [],
      }),
    );
    const emptyResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/empty-checkout/pay", {
          method: "POST",
          body: JSON.stringify({ method: "market_online" }),
        }),
        emptyEnv as never,
      ),
    );

    await expectApiError(emptyResponse, 400, "BAD_REQUEST");
    expect(processPayment).not.toHaveBeenCalled();
  });

  it("rejects a pay request whose currency disagrees with the vendors", async () => {
    resolveSharedRestaurantCurrency.mockResolvedValue("MYR");
    const env = {
      ...createEnv(),
      STORED_VALUE_CREDITS_ENABLED: "true",
    };
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );

    for (const body of [
      { method: "credits", currency: "TWD" },
      { method: "credits", country: "TW" },
    ]) {
      const response = await withSilencedRouteError(() =>
        routes.fetch(
          new Request("https://test/checkout-1/pay", {
            method: "POST",
            headers: MARKET_HOLDER_HEADERS,
            body: JSON.stringify(body),
          }),
          env as never,
        ),
      );
      await expectApiError(response, 400, "CURRENCY_MISMATCH");
    }
    expect(resolveSharedRestaurantCurrency).toHaveBeenCalledWith(env.DB, [
      "restaurant-1",
      "restaurant-2",
    ]);
    expect(reserveVoucherUsage).not.toHaveBeenCalled();
  });

  it("rejects paying a checkout whose vendors no longer share a currency", async () => {
    const { sharedCurrency } = await vi.importActual<
      typeof import("../../../shared/utils/restaurant-currency")
    >("../../../shared/utils/restaurant-currency");
    resolveSharedRestaurantCurrency.mockImplementation(async () =>
      sharedCurrency([
        { restaurantId: "restaurant-1", currency: "TWD" },
        { restaurantId: "restaurant-2", currency: "MYR" },
      ]),
    );
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/pay", {
          method: "POST",
          headers: MARKET_HOLDER_HEADERS,
          body: JSON.stringify({ method: "market_online" }),
        }),
        env as never,
      ),
    );

    await expectApiError(response, 409, "MIXED_CURRENCY_CHECKOUT");
    expect(processPayment).not.toHaveBeenCalled();
  });

  it("fails closed when an online market payment provider is not configured", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/pay", {
          method: "POST",
          headers: MARKET_HOLDER_HEADERS,
          body: JSON.stringify({ method: "market_online" }),
        }),
        env as never,
      ),
    );

    await expectApiError(
      response,
      409,
      "MARKET_CHECKOUT_PAYMENT_NOT_CONFIGURED",
    );
    expect(processPayment).not.toHaveBeenCalled();
  });

  it("charges voucher-adjusted child totals and logs redemption failures", async () => {
    const env = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL: "https://payments.example.test/split",
    };
    const fetcher = vi.fn(async () =>
      Response.json({
        provider: "line_pay",
        providerTransactionId: "provider-transaction-1",
        authorizedAmountCents: 18000,
        currency: "TWD",
        allocations: [
          { orderId: "1001", amountCents: 10800, paymentId: "pay-1001" },
          { orderId: "1002", amountCents: 7200, paymentId: "pay-1002" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    redeemVoucher.mockRejectedValueOnce(new Error("voucher ledger offline"));
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        ...unpaidCheckoutSessionFixture(),
        childOrders: unpaidCheckoutSessionFixture().childOrders.map(
          (child) => ({
            ...child,
            orderId: String(child.orderId),
          }),
        ),
        appliedVoucher: {
          couponId: 42,
          code: "MARKET10",
          name: "Market 10",
          fundedBy: "platform",
          discountCents: 2000,
          allocations: [
            { orderId: "1001", amountCents: 12000, discountCents: 1200 },
            { orderId: "1002", amountCents: 8000, discountCents: 800 },
          ],
        },
      }),
    );

    try {
      const response = await routes.fetch(
        new Request("https://test/checkout-1/pay", {
          method: "POST",
          headers: MARKET_HOLDER_HEADERS,
          body: JSON.stringify({
            method: "line_pay",
            country: "TW",
            currency: "TWD",
          }),
        }),
        env as never,
      );

      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenCalledOnce();
      const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(request[1].body))).toMatchObject({
        amountCents: 18000,
        allocations: [
          { orderId: "1001", amountCents: 10800 },
          { orderId: "1002", amountCents: 7200 },
        ],
      });
      expect(redeemVoucher).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MARKET10",
          discountCents: 2000,
          reservationStatus: "reserved",
        }),
      );
      expect(consoleError).toHaveBeenCalledWith(
        "Voucher redemption failed for checkout checkout-1:",
        expect.any(Error),
      );
      await expect(response.json()).resolves.toMatchObject({
        data: {
          payment: {
            status: "paid",
            totalAmount: 180,
            totalAmountCents: 18000,
            paidAmount: 180,
            paidAmountCents: 18000,
            settlement: {
              platformFeeCents: 700,
              vendorNetAmountCents: 19300,
              vendorAllocations: [
                {
                  orderId: "1001",
                  originalAmountCents: 12000,
                  platformDiscountCents: 1200,
                  settlementBaseCents: 12000,
                  grossAmountCents: 10800,
                },
                {
                  orderId: "1002",
                  originalAmountCents: 8000,
                  platformDiscountCents: 800,
                  settlementBaseCents: 8000,
                  grossAmountCents: 7200,
                },
              ],
            },
          },
        },
      });
    } finally {
      consoleError.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("persists provider split gateway failures as failed payment attempts", async () => {
    const env = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL: "https://payments.example.test/split",
    };
    const fetcher = vi.fn(async () => {
      throw new Error("Provider unavailable");
    });
    vi.stubGlobal("fetch", fetcher);
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 999,
            totalAmountCents: 12000,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 12000,
        appliedVoucher: {
          couponId: 42,
          code: "MARKET10",
          name: "Market 10",
          fundedBy: "platform",
          discountCents: 1000,
          reservationStatus: "reserved",
          reservedAt: "2026-06-13T00:00:00.000Z",
          allocations: [
            { orderId: 1001, amountCents: 12000, discountCents: 1000 },
          ],
        },
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/pay", {
        method: "POST",
        headers: MARKET_HOLDER_HEADERS,
        body: JSON.stringify({ method: "stripe_connect" }),
      }),
      env as never,
    );

    expect(fetcher).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    expect(response.status).toBe(202);
    const json = (await response.json()) as {
      data: {
        payment: {
          status: string;
          totalAmount: number;
          totalAmountCents: number;
          paidAmountCents: number;
          childPayments: Array<{
            orderId: number;
            status: string;
            errorMessage?: string;
            errorCode?: string;
          }>;
          parentPayment: {
            status: string;
            splitMode: string;
            provider: string;
            paidAmountCents: number;
          };
        };
      };
    };
    expect(json.data.payment).toMatchObject({
      status: "failed",
      totalAmount: 120,
      totalAmountCents: 12000,
      paidAmountCents: 0,
      childPayments: [
        {
          orderId: 1001,
          status: "failed",
          // Not "Provider unavailable". This is a `success: true` envelope, so
          // it never reaches ErrorSanitizer, and whatever an internal failure
          // put in `error.message` went straight to the customer — the shape
          // that handed them "Amount 17050 cents is not aligned to the TWD
          // step of 100 cents". A fixed safe message and a stable code.
          errorMessage:
            "Payment could not be completed. Please try again or pay at the stall.",
          errorCode: "MARKET_CHECKOUT_PAYMENT_FAILED",
        },
      ],
      parentPayment: {
        status: "failed",
        provider: "stripe_connect",
        splitMode: "provider_split",
        paidAmountCents: 0,
      },
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"status":"failed"'),
      { expirationTtl: 14400 },
    );
    expect(releaseVoucherReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        couponId: 42,
        code: "MARKET10",
        reservationStatus: "reserved",
      }),
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"reservationStatus":"released"'),
      { expirationTtl: 14400 },
    );
    expect(
      databaseMocks.updateValues.find(
        (values) =>
          typeof values === "object" &&
          values != null &&
          "paymentStatus" in values,
      ),
    ).toMatchObject({
      paymentStatus: "failed",
      paymentSummary: expect.objectContaining({
        status: "failed",
        paidAmountCents: 0,
      }),
    });
  });

  it("names an off-step legacy child total instead of failing the payment forever", async () => {
    // The finding: one TWD child order stored at 17050 cents made the whole
    // checkout permanently unpayable. The provider threw a bare Error, the
    // route recorded a generic failed payment and answered 202, and every
    // retry did the same with nothing saying why or who could fix it.
    const env = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL: "https://payments.example.test/split",
    };
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const fixture = unpaidCheckoutSessionFixture();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        ...fixture,
        childOrders: [
          {
            ...fixture.childOrders[0],
            totalAmount: 170.5,
            totalAmountCents: 17050,
          },
          fixture.childOrders[1],
        ],
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/pay", {
        method: "POST",
        headers: MARKET_HOLDER_HEADERS,
        body: JSON.stringify({ method: "stripe_connect" }),
      }),
      env as never,
    );
    vi.unstubAllGlobals();

    // Answered, not swallowed: a stable code, an actionable message, and the
    // order the merchant has to correct.
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "MARKET_CHECKOUT_AMOUNT_NOT_ALIGNED",
        message: expect.stringContaining("not a valid TWD amount"),
        details: {
          currency: "TWD",
          stepCents: 100,
          orders: [{ orderNumber: "A001", amount: 170.5 }],
        },
      },
    });
    // Nothing was asked of the gateway, and the attempt is still recorded on
    // the checkout with the same code.
    expect(fetcher).not.toHaveBeenCalled();
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining("MARKET_CHECKOUT_AMOUNT_NOT_ALIGNED"),
      { expirationTtl: 14400 },
    );
  });

  it("replays an already paid market checkout without charging twice", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        // A paid checkout always has the children it paid for; the replay path
        // is what is under test here, not an empty-checkout anomaly.
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "Vendor 1",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 200,
            totalAmountCents: 20000,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        payment: {
          status: "paid",
          method: "line_pay",
          currency: "TWD",
          country: "TW",
          totalAmount: 200,
          totalAmountCents: 20000,
          paidAmount: 200,
          paidAmountCents: 20000,
          paidAt: "2026-06-01T10:10:00.000Z",
          childPayments: [],
        },
        subtotal: 20000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/pay", {
        method: "POST",
        headers: MARKET_PAID_HOLDER_HEADERS,
        body: JSON.stringify({ method: "line_pay" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(processPayment).not.toHaveBeenCalled();
    const json = (await response.json()) as {
      data: { payment: { status: string; method: string } };
    };
    expect(json.data.payment).toMatchObject({
      status: "paid",
      method: "line_pay",
    });
  });

  it("replays a persisted paid checkout without requiring a KV session", async () => {
    setSelectFixtures(
      persistedSessionFixtures(providerSplitPaidSessionFixture()),
    );
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/checkout-1/pay", {
        method: "POST",
        headers: MARKET_PAID_HOLDER_HEADERS,
        body: JSON.stringify({ method: "market_online" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { payment: { status: "paid" } },
    });
    expect(processPayment).not.toHaveBeenCalled();
  });

  it("rejects malformed and unpaid market checkout refund requests", async () => {
    setNoPersistedCheckoutFixtures();
    const missingEnv = createEnv();
    const missingResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/missing-checkout/refund", {
          method: "POST",
          body: JSON.stringify({ reason: "customer requested cancellation" }),
        }),
        missingEnv as never,
      ),
    );

    await expectApiError(missingResponse, 404, "NOT_FOUND");

    const invalidEnv = createEnv();
    await invalidEnv.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );
    const invalidResponse = await routes.fetch(
      new Request("https://test/checkout-1/refund", {
        method: "POST",
        body: JSON.stringify({ reason: "x".repeat(501) }),
      }),
      invalidEnv as never,
    );

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Validation failed" },
    });

    const unpaidEnv = createEnv();
    await unpaidEnv.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(unpaidCheckoutSessionFixture()),
    );
    const unpaidResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/refund", {
          method: "POST",
          body: JSON.stringify({ reason: "customer requested cancellation" }),
        }),
        unpaidEnv as never,
      ),
    );

    await expectApiError(unpaidResponse, 400, "BAD_REQUEST");
  });

  it("rejects provider split refunds without refundable provider state", async () => {
    const missingTransactionEnv = createEnv();
    const paidSession = providerSplitPaidSessionFixture();
    const {
      providerTransactionId: _droppedProviderTransactionId,
      ...parentPaymentWithoutTransaction
    } = paidSession.payment.parentPayment;
    const missingTransactionSession = {
      ...paidSession,
      payment: {
        ...paidSession.payment,
        parentPayment: parentPaymentWithoutTransaction,
      },
    };
    await missingTransactionEnv.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(missingTransactionSession),
    );

    const missingTransactionResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/refund", {
          method: "POST",
          body: JSON.stringify({ reason: "duplicate payment" }),
        }),
        missingTransactionEnv as never,
      ),
    );

    await expectApiError(missingTransactionResponse, 400, "BAD_REQUEST");

    const nonRefundableEnv = createEnv();
    const nonRefundableSession = providerSplitPaidSessionFixture();
    nonRefundableSession.payment.status = "failed";
    nonRefundableSession.payment.parentPayment.status = "failed";
    await nonRefundableEnv.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(nonRefundableSession),
    );

    const nonRefundableResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/checkout-1/refund", {
          method: "POST",
          body: JSON.stringify({ reason: "duplicate payment" }),
        }),
        nonRefundableEnv as never,
      ),
    );

    await expectApiError(nonRefundableResponse, 400, "BAD_REQUEST");
  });

  it("rounds a legacy payment's platform fee on the vendors' currency, not TWD", async () => {
    // The settlement step used to come from `payment.currency ?? TWD`. A
    // payment row written before that column existed therefore had its fees
    // rounded on the TWD step: an RM5.60 fee on an MYR checkout became
    // RM6.00, and the 40 sen came out of the vendor's payout.
    resolveDisplaySharedRestaurantCurrency.mockResolvedValue("MYR");
    const env = createEnv([
      {
        id: 1001,
        restaurant_id: "restaurant-1",
        totalAmountCents: 4000,
        refundAmountCents: null,
        payment_method: "line_pay",
        payment_status: "paid",
      },
    ]);
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "Pasar Malam",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "Vendor 1",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 40,
            totalAmountCents: 4000,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "Vendor 2",
            orderId: 1002,
            orderNumber: "A002",
            totalAmount: 160,
            totalAmountCents: 16000,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        payment: {
          // No `currency`: this is the legacy shape the fallback exists for.
          status: "paid",
          method: "line_pay",
          country: "MY",
          totalAmount: 200,
          totalAmountCents: 20000,
          paidAmount: 200,
          paidAmountCents: 20000,
          paidAt: "2026-06-01T10:10:00.000Z",
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "paid",
            provider: "line_pay",
            splitMode: "child_transactions",
            idempotencyKey: "market-pay-1",
            amountCents: 20000,
            paidAmountCents: 20000,
            refundedAmountCents: 0,
            childPaymentIds: ["pay-1001"],
            createdAt: "2026-06-01T10:10:00.000Z",
            updatedAt: "2026-06-01T10:10:00.000Z",
          },
          childPayments: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "Vendor 1",
              orderId: 1001,
              orderNumber: "A001",
              paymentId: "pay-1001",
              status: "paid",
              amount: 40,
              amountCents: 4000,
            },
            {
              // No transaction to refund, so it stays paid and still earns a
              // platform fee — the one branch where a settlement fee is
              // computed on the refund path.
              restaurantId: "restaurant-2",
              restaurantName: "Vendor 2",
              orderId: 1002,
              orderNumber: "A002",
              status: "paid",
              amount: 160,
              amountCents: 16000,
            },
          ],
        },
        subtotal: 20000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/refund", {
        method: "POST",
        body: JSON.stringify({ reason: "customer_request" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        payment: {
          settlement: {
            vendorAllocations: Array<{
              restaurantId: string;
              platformFeeCents: number;
            }>;
          };
        };
      };
    };
    // RM160 x 3.5% = RM5.60. On the TWD step this came back as 600.
    expect(
      json.data.payment.settlement.vendorAllocations.find(
        (allocation) => allocation.restaurantId === "restaurant-2",
      ),
    ).toMatchObject({ platformFeeCents: 560 });
    expect(resolveDisplaySharedRestaurantCurrency).toHaveBeenCalledWith(
      env.DB,
      ["restaurant-1", "restaurant-2"],
    );
  });

  it("refunds paid child payments for a market checkout", async () => {
    const env = createEnv([
      {
        id: 1001,
        restaurant_id: "restaurant-1",
        totalAmountCents: 12000,
        refundAmountCents: null,
        payment_method: "line_pay",
        payment_status: "paid",
      },
      {
        id: 1002,
        restaurant_id: "restaurant-2",
        totalAmountCents: 8000,
        refundAmountCents: null,
        payment_method: "line_pay",
        payment_status: "paid",
      },
    ]);
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 1002,
            orderNumber: "A002",
            totalAmount: 80,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        appliedVoucher: {
          couponId: 42,
          code: "MARKET10",
          name: "Market 10",
          fundedBy: "platform",
          discountCents: 2000,
          allocations: [
            { orderId: 1001, amountCents: 12000, discountCents: 1200 },
            { orderId: 1002, amountCents: 8000, discountCents: 800 },
          ],
        },
        payment: {
          status: "paid",
          method: "line_pay",
          currency: "TWD",
          country: "TW",
          totalAmount: 200,
          totalAmountCents: 20000,
          paidAmount: 200,
          paidAmountCents: 20000,
          paidAt: "2026-06-01T10:10:00.000Z",
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "paid",
            provider: "line_pay",
            splitMode: "child_transactions",
            idempotencyKey: "market-pay-1",
            amountCents: 20000,
            paidAmountCents: 20000,
            refundedAmountCents: 0,
            childPaymentIds: ["pay-1001", "pay-1002"],
            createdAt: "2026-06-01T10:10:00.000Z",
            updatedAt: "2026-06-01T10:10:00.000Z",
          },
          childPayments: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "雞排攤",
              orderId: 1001,
              orderNumber: "A001",
              paymentId: "pay-1001",
              status: "paid",
              amount: 120,
              amountCents: 12000,
            },
            {
              restaurantId: "restaurant-2",
              restaurantName: "甜點攤",
              orderId: 1002,
              orderNumber: "A002",
              paymentId: "pay-1002",
              status: "paid",
              amount: 80,
              amountCents: 8000,
            },
          ],
        },
        subtotal: 20000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/refund", {
        method: "POST",
        body: JSON.stringify({ reason: "customer_request" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        payment: {
          status: string;
          refundedAmount: number;
          parentPayment: {
            paymentId: string;
            status: string;
            refundedAmountCents: number;
            childPaymentIds: string[];
          };
          settlement: {
            platformFeeRateBps: number;
            vendorNetAmountCents: number;
            vendorAllocations: Array<{
              restaurantId: string;
              grossAmountCents: number;
              refundedAmountCents: number;
              platformFeeCents: number;
              netAmountCents: number;
            }>;
          };
          childPayments: Array<{ status: string; refundId?: string }>;
        };
        refunds: Array<{ transactionId: string; amount: number }>;
      };
    };
    expect(json.data.payment).toMatchObject({
      status: "refunded",
      refundedAmount: 200,
      parentPayment: {
        paymentId: "market_pay_checkout-1",
        status: "refunded",
        refundedAmountCents: 20000,
        childPaymentIds: ["pay-1001", "pay-1002"],
      },
      settlement: {
        platformFeeRateBps: 350,
        vendorNetAmountCents: 0,
        vendorAllocations: [
          {
            restaurantId: "restaurant-1",
            grossAmountCents: 12000,
            refundedAmountCents: 12000,
            platformFeeCents: 0,
            netAmountCents: 0,
          },
          {
            restaurantId: "restaurant-2",
            grossAmountCents: 8000,
            refundedAmountCents: 8000,
            platformFeeCents: 0,
            netAmountCents: 0,
          },
        ],
      },
    });
    expect(json.data.payment.childPayments).toEqual([
      expect.objectContaining({
        status: "refunded",
        refundId: expect.any(String),
      }),
      expect.objectContaining({
        status: "refunded",
        refundId: expect.any(String),
      }),
    ]);
    expect(json.data.refunds).toEqual([
      expect.objectContaining({ transactionId: "pay-1001", amount: 120 }),
      expect.objectContaining({ transactionId: "pay-1002", amount: 80 }),
    ]);
    expect(markVoucherRefunded).toHaveBeenCalledWith({
      couponId: 42,
      orderIds: [1001, 1002],
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:index",
      expect.stringContaining('"paymentStatus":"refunded"'),
      { expirationTtl: 14400 },
    );
    expect(databaseMocks.updateValues[0]).toMatchObject({
      paymentStatus: "refunded",
      paymentSummary: expect.objectContaining({
        status: "refunded",
        refundedAmount: 200,
      }),
    });
    const prepareCalls = env.DB.prepare.mock.calls as unknown as Array<
      [string]
    >;
    const ledgerPrepareCallIndex = prepareCalls.findIndex(
      ([sql]) =>
        typeof sql === "string" &&
        sql.includes("INSERT INTO market_checkout_payments"),
    );
    expect(ledgerPrepareCallIndex).toBeGreaterThanOrEqual(0);
    const ledgerBind = env.DB.prepare.mock.results[ledgerPrepareCallIndex]
      ?.value.bind as ReturnType<typeof vi.fn>;
    expect(ledgerBind).toHaveBeenCalledWith(
      "market_pay_checkout-1",
      "checkout-1",
      "market-1",
      "line_pay",
      "child_transactions",
      "market-pay-1",
      "refunded",
      20000,
      20000,
      20000,
      "TWD",
      "TW",
      JSON.stringify(["pay-1001", "pay-1002"]),
      null,
      expect.stringContaining('"source":"market-checkouts"'),
      expect.any(Number),
      expect.any(Number),
      null,
      expect.any(Number),
      null,
    );
  });

  it("refunds provider split parent payments through the configured provider", async () => {
    const env = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_REFUND_URL:
        "https://payments.example.test/market-split/refunds",
      MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "split-token",
      MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET: "split-signing-secret",
    };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(mockMarketCheckoutProviderRefundResponse)),
    );
    globalThis.fetch = fetcher as never;
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            totalAmountCents: 16000,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 102,
            orderNumber: "A002",
            totalAmount: 80,
            totalAmountCents: 8000,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        payment: {
          status: "paid",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 240,
          totalAmountCents: 24000,
          paidAmount: 240,
          paidAmountCents: 24000,
          paidAt: "2026-06-01T10:10:00.000Z",
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "paid",
            provider: "mock_market_provider",
            splitMode: "provider_split",
            idempotencyKey: "market-checkout:checkout-1",
            providerTransactionId: "intent-market-checkout-1",
            amountCents: 24000,
            paidAmountCents: 24000,
            refundedAmountCents: 0,
            childPaymentIds: ["mock-pay-101", "mock-pay-102"],
            createdAt: "2026-06-01T10:10:00.000Z",
            updatedAt: "2026-06-01T10:10:00.000Z",
          },
          childPayments: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "雞排攤",
              orderId: 101,
              orderNumber: "A001",
              paymentId: "mock-pay-101",
              status: "paid",
              amount: 160,
              amountCents: 16000,
            },
            {
              restaurantId: "restaurant-2",
              restaurantName: "甜點攤",
              orderId: 102,
              orderNumber: "A002",
              paymentId: "mock-pay-102",
              status: "paid",
              amount: 80,
              amountCents: 8000,
            },
          ],
        },
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/refund", {
        method: "POST",
        body: JSON.stringify({ reason: "customer_request" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      "https://payments.example.test/market-split/refunds",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer split-token",
          "x-market-checkout-signature": expect.any(String),
        }),
      }),
    );
    const providerRequest = (
      fetcher.mock.calls as unknown as Array<[string, RequestInit]>
    )[0]?.[1] as { body?: string } | undefined;
    expect(JSON.parse(providerRequest?.body ?? "{}")).toMatchObject({
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      provider: "mock_market_provider",
      providerTransactionId: "intent-market-checkout-1",
      idempotencyKey: "market-checkout:checkout-1:refund",
      amountCents: 24000,
      reason: "customer_request",
      allocations: [
        expect.objectContaining({ orderId: 101, amountCents: 16000 }),
        expect.objectContaining({ orderId: 102, amountCents: 8000 }),
      ],
    });
    const json = (await response.json()) as {
      data: {
        payment: {
          status: string;
          refundedAmountCents: number;
          parentPayment: {
            status: string;
            refundedAmountCents: number;
          };
          childPayments: Array<{ status: string; refundId?: string }>;
        };
        refunds: Array<{
          refundId: string;
          transactionId: string;
          amount: number;
        }>;
      };
    };
    expect(json.data.payment).toMatchObject({
      status: "refunded",
      refundedAmountCents: 24000,
      parentPayment: {
        status: "refunded",
        refundedAmountCents: 24000,
      },
      childPayments: [
        { status: "refunded", refundId: "refund-market-checkout-1" },
        { status: "refunded", refundId: "refund-market-checkout-1" },
      ],
    });
    expect(json.data.refunds).toEqual([
      expect.objectContaining({
        refundId: "refund-market-checkout-1",
        transactionId: "market_pay_checkout-1",
        amount: 240,
      }),
    ]);
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:index",
      expect.stringContaining('"paymentStatus":"refunded"'),
      { expirationTtl: 14400 },
    );
  });

  describe("provider split refund responses are verified", () => {
    function providerRefundEnv(refundResponse: Record<string, unknown>) {
      const env = {
        ...createEnv(),
        MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
        MARKET_CHECKOUT_PROVIDER_REFUND_URL:
          "https://payments.example.test/market-split/refunds",
      };
      const fetcher = vi.fn(
        async () => new Response(JSON.stringify(refundResponse)),
      );
      globalThis.fetch = fetcher as never;
      return { env, fetcher };
    }

    async function seedPaidCheckout(env: ReturnType<typeof createEnv>) {
      await env.CACHE_KV.put(
        "market_checkout:checkout-1",
        JSON.stringify({
          id: "checkout-1",
          market: {
            id: "market-1",
            slug: "fengjia",
            name: "逢甲夜市",
            platformFeeRateBps: 350,
          },
          status: "submitted",
          childOrders: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "雞排攤",
              orderId: 101,
              orderNumber: "A001",
              totalAmount: 160,
              totalAmountCents: 16000,
              tokenExpiresAt: "2026-06-01T12:00:00.000Z",
            },
            {
              restaurantId: "restaurant-2",
              restaurantName: "甜點攤",
              orderId: 102,
              orderNumber: "A002",
              totalAmount: 80,
              totalAmountCents: 8000,
              tokenExpiresAt: "2026-06-01T12:00:00.000Z",
            },
          ],
          payment: {
            status: "paid",
            method: "market_online",
            currency: "TWD",
            country: "TW",
            totalAmount: 240,
            totalAmountCents: 24000,
            paidAmount: 240,
            paidAmountCents: 24000,
            paidAt: "2026-06-01T10:10:00.000Z",
            parentPayment: {
              paymentId: "market_pay_checkout-1",
              status: "paid",
              provider: "mock_market_provider",
              splitMode: "provider_split",
              idempotencyKey: "market-checkout:checkout-1",
              providerTransactionId: "intent-market-checkout-1",
              amountCents: 24000,
              paidAmountCents: 24000,
              refundedAmountCents: 0,
              childPaymentIds: ["mock-pay-101", "mock-pay-102"],
              createdAt: "2026-06-01T10:10:00.000Z",
              updatedAt: "2026-06-01T10:10:00.000Z",
            },
            childPayments: [
              {
                restaurantId: "restaurant-1",
                restaurantName: "雞排攤",
                orderId: 101,
                orderNumber: "A001",
                paymentId: "mock-pay-101",
                status: "paid",
                amount: 160,
                amountCents: 16000,
              },
              {
                restaurantId: "restaurant-2",
                restaurantName: "甜點攤",
                orderId: 102,
                orderNumber: "A002",
                paymentId: "mock-pay-102",
                status: "paid",
                amount: 80,
                amountCents: 8000,
              },
            ],
          },
          subtotal: 24000,
          createdAt: "2026-06-01T10:00:00.000Z",
        }),
      );
    }

    it("records a partial provider refund as partial and keeps child payments paid", async () => {
      const { env, fetcher } = providerRefundEnv({
        ...mockMarketCheckoutProviderRefundResponse,
        status: "refunded",
        refundedAmountCents: 8000,
      });
      await seedPaidCheckout(env);

      const response = await routes.fetch(
        new Request("https://test/checkout-1/refund", {
          method: "POST",
          body: JSON.stringify({}),
        }),
        env as never,
      );

      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenCalledOnce();
      const json = (await response.json()) as {
        data: {
          payment: {
            status: string;
            refundedAmountCents: number;
            childPayments: Array<{ status: string }>;
          };
        };
      };
      expect(json.data.payment).toMatchObject({
        status: "partial_refunded",
        refundedAmountCents: 8000,
      });
      expect(
        json.data.payment.childPayments.map((payment) => payment.status),
      ).toEqual(["paid", "paid"]);
    });

    it.each([
      [
        "in another currency",
        { currency: "USD" },
        "MARKET_CHECKOUT_REFUND_CURRENCY_MISMATCH",
      ],
      [
        "larger than requested",
        { refundedAmountCents: 2400000 },
        "MARKET_CHECKOUT_REFUND_AMOUNT_EXCEEDS_EXPECTED",
      ],
    ])(
      "holds a provider refund %s for review",
      async (_label, patch, auditCode) => {
        const { env, fetcher } = providerRefundEnv({
          ...mockMarketCheckoutProviderRefundResponse,
          ...patch,
        });
        await seedPaidCheckout(env);

        const response = await routes.fetch(
          new Request("https://test/checkout-1/refund", {
            method: "POST",
            body: JSON.stringify({}),
          }),
          env as never,
        );

        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({
          success: false,
          error: { code: "MARKET_CHECKOUT_PROVIDER_REFUND_MISMATCH" },
        });
        expect(fetcher).toHaveBeenCalledOnce();
        const stored = JSON.parse(
          (await env.CACHE_KV.get("market_checkout:checkout-1")) ?? "{}",
        ) as {
          payment: {
            status: string;
            refundedAmountCents?: number;
            parentPayment: {
              lastRefund: { status: string; reviewReason: string };
            };
          };
        };
        expect(stored.payment.status).toBe("paid");
        expect(stored.payment.refundedAmountCents ?? 0).toBe(0);
        expect(stored.payment.parentPayment.lastRefund).toMatchObject({
          status: "review_required",
        });
        const auditPrepare = vi
          .mocked(env.DB.prepare)
          .mock.calls.findIndex(([sql]) =>
            String(sql).includes("payment_audit_log"),
          );
        expect(auditPrepare).toBeGreaterThanOrEqual(0);
        const auditBind = vi.mocked(env.DB.prepare).mock.results[auditPrepare]
          ?.value.bind;
        expect(vi.mocked(auditBind).mock.calls[0]).toEqual(
          expect.arrayContaining(["failure", auditCode]),
        );
      },
    );
  });

  it("surfaces pending provider split refunds without marking payment refunded", async () => {
    const env = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_REFUND_URL:
        "https://payments.example.test/market-split/refunds",
    };
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...mockMarketCheckoutProviderRefundResponse,
            status: "pending",
            refundedAmountCents: 0,
            eventId: "refund-pending-1",
            eventType: "market_checkout.refund_pending",
          }),
        ),
    );
    globalThis.fetch = fetcher as never;
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify(providerSplitPaidSessionFixture()),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/refund", {
        method: "POST",
        body: JSON.stringify({ reason: "customer_request" }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        payment: {
          status: string;
          refundedAmountCents?: number;
          parentPayment: {
            status: string;
            refundedAmountCents: number;
            lastRefund?: {
              provider: string;
              eventId?: string;
              eventType: string;
              status: string;
              receivedAt: string;
              payloadSummary?: {
                providerTransactionId?: string;
                amountRefundedCents?: number;
              };
            };
          };
          childPayments: Array<{ status: string; refundId?: string }>;
        };
      };
    };
    expect(json.data.payment).toMatchObject({
      status: "paid",
      refundedAmountCents: 0,
      parentPayment: {
        status: "paid",
        refundedAmountCents: 0,
        lastRefund: {
          provider: "mock_market_provider",
          eventId: "refund-pending-1",
          eventType: "market_checkout.refund_pending",
          status: "pending",
          payloadSummary: {
            providerTransactionId: "intent-market-checkout-1",
            amountRefundedCents: 0,
          },
        },
      },
      childPayments: [
        expect.objectContaining({ status: "paid" }),
        expect.objectContaining({ status: "paid" }),
      ],
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:index",
      expect.stringContaining('"type":"provider_refund_pending"'),
      { expirationTtl: 14400 },
    );
  });

  it("persists provider split next actions as pending payment attempts", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            provider: "future_provider",
            providerTransactionId: "intent-market-1",
            status: "requires_action",
            authorizedAmountCents: 0,
            allocations: [],
            nextAction: {
              type: "redirect",
              redirectUrl:
                "https://payments.example.test/confirm/intent-market-1",
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const env = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
        "https://payments.example.test/market-split",
    };
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            totalAmountCents: 12000,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 12000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/checkout-1/pay", {
        method: "POST",
        headers: MARKET_HOLDER_HEADERS,
        body: JSON.stringify({ method: "future_provider" }),
      }),
      env as never,
    );

    const json = (await response.json()) as {
      data: {
        payment: {
          status: string;
          paidAmountCents: number;
          childPayments: unknown[];
          parentPayment: {
            status: string;
            provider: string;
            providerTransactionId?: string;
            nextAction?: {
              type: string;
              redirectUrl?: string;
            };
          };
        };
      };
    };
    expect(fetcher).toHaveBeenCalled();
    expect(json.data.payment).toMatchObject({
      status: "pending",
      paidAmountCents: 0,
      childPayments: [],
      parentPayment: {
        status: "pending",
        provider: "future_provider",
        providerTransactionId: "intent-market-1",
        nextAction: {
          type: "redirect",
          redirectUrl: "https://payments.example.test/confirm/intent-market-1",
        },
      },
    });
    expect(response.status).toBe(202);
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"status":"pending"'),
      { expirationTtl: 14400 },
    );
    expect(databaseMocks.updateValues[0]).toMatchObject({
      paymentStatus: "pending",
      paymentSummary: expect.objectContaining({
        status: "pending",
        paidAmountCents: 0,
      }),
    });
  });

  it("runs the mock provider pending redirect and paid webhook route flow", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(mockMarketCheckoutProviderPendingResponse)),
    );
    vi.stubGlobal("fetch", fetcher);
    const dbRows: unknown[] = [];
    const env = {
      ...createEnv(dbRows),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
        "https://payments.example.test/market-split",
      MARKET_CHECKOUT_WEBHOOK_SECRET: "market-secret",
    };
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "Chicken Stall",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            totalAmountCents: 16000,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "Dessert Stall",
            orderId: 102,
            orderNumber: "A002",
            totalAmount: 80,
            totalAmountCents: 8000,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );

    const payResponse = await routes.fetch(
      new Request("https://test/checkout-1/pay", {
        method: "POST",
        headers: MARKET_PAID_HOLDER_HEADERS,
        body: JSON.stringify({ method: "market_online" }),
      }),
      env as never,
    );

    expect(payResponse.status).toBe(202);
    await expect(payResponse.json()).resolves.toMatchObject({
      data: {
        payment: {
          status: "pending",
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            provider: "mock_market_provider",
            providerTransactionId: "intent-market-checkout-1",
            nextAction: {
              type: "redirect",
              redirectUrl:
                "https://payments.example.test/confirm/intent-market-checkout-1",
            },
          },
        },
      },
    });

    dbRows.push({
      payment_id: "market_pay_checkout-1",
      checkout_id: "checkout-1",
      market_id: "market-1",
      provider: "mock_market_provider",
      split_mode: "provider_split",
      idempotency_key: "market-checkout:checkout-1",
      status: "pending",
      amount_cents: 24000,
      paid_amount_cents: 0,
      refunded_amount_cents: 0,
      currency: "TWD",
      country_code: "TW",
      child_payment_ids: JSON.stringify([]),
      provider_transaction_id: "intent-market-checkout-1",
      provider_payload: JSON.stringify({
        source: "market-checkouts",
        nextAction: mockMarketCheckoutProviderPendingResponse.nextAction,
      }),
      created_at_ms: Date.parse("2026-06-01T10:00:00.000Z"),
      updated_at_ms: Date.parse("2026-06-01T10:05:00.000Z"),
      session_payment_summary: JSON.stringify({
        status: "pending",
        method: "market_online",
        currency: "TWD",
        country: "TW",
        totalAmount: 240,
        totalAmountCents: 24000,
        paidAmount: 0,
        paidAmountCents: 0,
        childPayments: [],
        parentPayment: {
          paymentId: "market_pay_checkout-1",
          status: "pending",
          provider: "mock_market_provider",
          splitMode: "provider_split",
          idempotencyKey: "market-checkout:checkout-1",
          providerTransactionId: "intent-market-checkout-1",
          nextAction: mockMarketCheckoutProviderPendingResponse.nextAction,
          amountCents: 24000,
          paidAmountCents: 0,
          refundedAmountCents: 0,
          childPaymentIds: [],
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:05:00.000Z",
        },
      }),
    });
    const rawWebhookBody = JSON.stringify(
      mockMarketCheckoutProviderPaidWebhookPayload,
    );

    const webhookResponse = await routes.fetch(
      new Request("https://test/payment-webhooks/mock_market_provider", {
        method: "POST",
        headers: {
          "x-webhook-signature": await signMockMarketCheckoutWebhook(
            "market-secret",
            rawWebhookBody,
          ),
        },
        body: rawWebhookBody,
      }),
      env as never,
    );

    expect(webhookResponse.status).toBe(200);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      data: {
        provider: "mock_market_provider",
        eventId: "evt-market-checkout-paid-1",
        eventType: "market_checkout.payment_paid",
        reconciled: true,
        checkoutId: "checkout-1",
        paymentId: "market_pay_checkout-1",
        status: "paid",
      },
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"status":"paid"'),
      { expirationTtl: 14400 },
    );
  });

  it("reconciles a pending provider split checkout from the provider status endpoint", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify(mockMarketCheckoutProviderPaidStatusResponse),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const dbRows: unknown[] = [
      {
        payment_id: "market_pay_checkout-1",
        checkout_id: "checkout-1",
        market_id: "market-1",
        provider: "mock_market_provider",
        split_mode: "provider_split",
        idempotency_key: "market-checkout:checkout-1",
        status: "pending",
        amount_cents: 24000,
        paid_amount_cents: 0,
        refunded_amount_cents: 0,
        currency: "TWD",
        country_code: "TW",
        child_payment_ids: JSON.stringify([]),
        provider_transaction_id: "intent-market-checkout-1",
        provider_payload: JSON.stringify({
          source: "market-checkouts",
          nextAction: mockMarketCheckoutProviderPendingResponse.nextAction,
        }),
        created_at_ms: Date.parse("2026-06-01T10:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-01T10:05:00.000Z"),
        session_payment_summary: JSON.stringify({
          status: "pending",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 240,
          totalAmountCents: 24000,
          paidAmount: 0,
          paidAmountCents: 0,
          childPayments: [],
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "pending",
            provider: "mock_market_provider",
            splitMode: "provider_split",
            idempotencyKey: "market-checkout:checkout-1",
            providerTransactionId: "intent-market-checkout-1",
            nextAction: mockMarketCheckoutProviderPendingResponse.nextAction,
            amountCents: 24000,
            paidAmountCents: 0,
            refundedAmountCents: 0,
            childPaymentIds: [],
            createdAt: "2026-06-01T10:00:00.000Z",
            updatedAt: "2026-06-01T10:05:00.000Z",
          },
        }),
      },
    ];
    const env = {
      ...createEnv(dbRows),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_STATUS_URL:
        "https://payments.example.test/market-split/status",
      MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "provider-token",
      MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET: "provider-secret",
    };
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          platformFeeRateBps: 350,
        },
        status: "submitted",
        childOrders: [],
        payment: {
          status: "pending",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 240,
          totalAmountCents: 24000,
          paidAmount: 0,
          paidAmountCents: 0,
          childPayments: [],
        },
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );

    const response = await routes.fetch(
      new Request("https://test/admin/checkout-1/reconcile", {
        method: "POST",
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      "https://payments.example.test/market-split/status",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer provider-token",
          "x-market-checkout-signature-algorithm": "hmac-sha256",
        }),
      }),
    );
    const statusRequest = (
      fetcher.mock.calls as unknown as Array<[string, RequestInit]>
    )[0]?.[1] as { body?: string } | undefined;
    expect(JSON.parse(statusRequest?.body ?? "{}")).toMatchObject({
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      provider: "mock_market_provider",
      providerTransactionId: "intent-market-checkout-1",
    });
    const json = (await response.json()) as {
      data: {
        reconciliation: {
          status: string;
          provider: string;
          checkoutId: string;
          paymentId: string;
        };
      };
    };
    expect(json.data.reconciliation).toMatchObject({
      status: "paid",
      provider: "mock_market_provider",
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "market_checkout:checkout-1",
      expect.stringContaining('"status":"paid"'),
      { expirationTtl: 14400 },
    );
  });

  it("lists market checkout sessions for platform admins", async () => {
    const env = createEnv();
    setMarketCheckoutSessionFixtures({
      all: [
        {
          id: "checkout-1",
          marketId: "market-1",
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          status: "submitted",
          paymentStatus: "partial_paid",
          subtotalCents: 12000,
          childOrderCount: 1,
          paymentSummary: {
            status: "partial_paid",
            method: "market_online",
            currency: "TWD",
            country: "TW",
            totalAmount: 120,
            totalAmountCents: 12000,
            paidAmount: 0,
            paidAmountCents: 0,
            childPayments: [],
            parentPayment: {
              paymentId: "market_pay_checkout-1",
              status: "pending",
              provider: "mock_market_provider",
              splitMode: "provider_split",
              idempotencyKey: "market-checkout:checkout-1",
              providerTransactionId: "intent-market-checkout-1",
              amountCents: 12000,
              paidAmountCents: 0,
              refundedAmountCents: 0,
              childPaymentIds: [],
              createdAt: "2026-06-01T09:00:00.000Z",
              updatedAt: "2026-06-01T09:00:00.000Z",
            },
          },
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          updatedAt: new Date("2026-06-01T10:05:00.000Z"),
        },
        {
          id: "checkout-2",
          marketId: "market-1",
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          status: "submitted",
          paymentStatus: "partial_paid",
          subtotalCents: 8000,
          childOrderCount: 1,
          paymentSummary: {
            status: "partial_paid",
            method: "market_online",
            currency: "TWD",
            country: "TW",
            totalAmount: 80,
            totalAmountCents: 8000,
            paidAmount: 0,
            paidAmountCents: 0,
            childPayments: [],
            parentPayment: {
              paymentId: "market_pay_checkout-2",
              status: "pending",
              provider: "mock_market_provider",
              splitMode: "provider_split",
              idempotencyKey: "market-checkout:checkout-2",
              providerTransactionId: "intent-market-checkout-2",
              lastWebhook: {
                provider: "mock_market_provider",
                eventId: "evt-market-checkout-failed-2",
                eventType: "market_checkout.payment_failed",
                status: "failed",
                receivedAt: "2026-05-31T10:04:00.000Z",
              },
              amountCents: 8000,
              paidAmountCents: 0,
              refundedAmountCents: 0,
              childPaymentIds: [],
              createdAt: "2026-05-31T10:00:00.000Z",
              updatedAt: "2026-05-31T10:05:00.000Z",
            },
          },
          createdAt: new Date("2026-05-31T10:00:00.000Z"),
          updatedAt: new Date("2026-05-31T10:05:00.000Z"),
        },
      ],
    });

    const response = await routes.fetch(
      new Request(
        "https://test/admin?paymentStatus=partial_paid&dateFrom=2026-06-01&dateTo=2026-06-01",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        checkouts: Array<{
          id: string;
          market: { slug: string };
          paymentStatus: string;
          childOrderCount: number;
          operationAlerts: Array<{ type: string; label: string }>;
        }>;
        total: number;
      };
    };
    expect(json.data.total).toBe(1);
    expect(json.data.checkouts[0]).toMatchObject({
      id: "checkout-1",
      market: { slug: "fengjia" },
      paymentStatus: "partial_paid",
      childOrderCount: 1,
      operationAlerts: expect.arrayContaining([
        expect.objectContaining({ type: "provider_pending_stale" }),
        expect.objectContaining({ type: "provider_webhook_missing" }),
      ]),
    });

    setMarketCheckoutSessionFixtures({
      all: [
        {
          id: "checkout-1",
          marketId: "market-1",
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          status: "submitted",
          paymentStatus: "partial_paid",
          subtotalCents: 12000,
          childOrderCount: 1,
          paymentSummary: {
            status: "partial_paid",
            method: "market_online",
            currency: "TWD",
            country: "TW",
            totalAmount: 120,
            totalAmountCents: 12000,
            paidAmount: 0,
            paidAmountCents: 0,
            childPayments: [],
            parentPayment: {
              paymentId: "market_pay_checkout-1",
              status: "pending",
              provider: "mock_market_provider",
              splitMode: "provider_split",
              idempotencyKey: "market-checkout:checkout-1",
              providerTransactionId: "intent-market-checkout-1",
              amountCents: 12000,
              paidAmountCents: 0,
              refundedAmountCents: 0,
              childPaymentIds: [],
              createdAt: "2026-06-01T09:00:00.000Z",
              updatedAt: "2026-06-01T09:00:00.000Z",
            },
          },
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          updatedAt: new Date("2026-06-01T10:05:00.000Z"),
        },
        {
          id: "checkout-2",
          marketId: "market-1",
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          status: "submitted",
          paymentStatus: "partial_paid",
          subtotalCents: 8000,
          childOrderCount: 1,
          paymentSummary: {
            status: "partial_paid",
            method: "market_online",
            currency: "TWD",
            country: "TW",
            totalAmount: 80,
            totalAmountCents: 8000,
            paidAmount: 0,
            paidAmountCents: 0,
            childPayments: [],
            parentPayment: {
              paymentId: "market_pay_checkout-2",
              status: "pending",
              provider: "mock_market_provider",
              splitMode: "provider_split",
              idempotencyKey: "market-checkout:checkout-2",
              providerTransactionId: "intent-market-checkout-2",
              lastWebhook: {
                provider: "mock_market_provider",
                eventId: "evt-market-checkout-failed-2",
                eventType: "market_checkout.payment_failed",
                status: "failed",
                receivedAt: "2026-05-31T10:04:00.000Z",
              },
              amountCents: 8000,
              paidAmountCents: 0,
              refundedAmountCents: 0,
              childPaymentIds: [],
              createdAt: "2026-05-31T10:00:00.000Z",
              updatedAt: "2026-05-31T10:05:00.000Z",
            },
          },
          createdAt: new Date("2026-05-31T10:00:00.000Z"),
          updatedAt: new Date("2026-05-31T10:05:00.000Z"),
        },
      ],
    });

    const alertResponse = await routes.fetch(
      new Request(
        "https://test/admin?paymentStatus=partial_paid&operationAlert=provider_webhook_failed",
      ),
      env as never,
    );
    expect(alertResponse.status).toBe(200);
    const alertJson = (await alertResponse.json()) as {
      data: {
        checkouts: Array<{
          id: string;
          operationAlerts: Array<{ type: string }>;
        }>;
        total: number;
      };
    };
    expect(alertJson.data.total).toBe(1);
    expect(alertJson.data.checkouts[0]).toMatchObject({
      id: "checkout-2",
      operationAlerts: expect.arrayContaining([
        expect.objectContaining({ type: "provider_webhook_failed" }),
      ]),
    });
  });

  it.each([["lastWebhook"], ["lastReconciliation"], ["lastRefund"]])(
    "raises provider_amount_mismatch when %s was held for review",
    async (eventKey) => {
      const env = createEnv();
      setMarketCheckoutSessionFixtures({
        all: [
          {
            id: "checkout-review",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            status: "submitted",
            paymentStatus: "pending",
            subtotalCents: 12000,
            childOrderCount: 1,
            paymentSummary: {
              status: "pending",
              method: "market_online",
              currency: "TWD",
              country: "TW",
              totalAmount: 120,
              totalAmountCents: 12000,
              paidAmount: 0,
              paidAmountCents: 0,
              childPayments: [],
              parentPayment: {
                paymentId: "market_pay_checkout-review",
                status: "pending",
                provider: "stripe",
                splitMode: "provider_split",
                idempotencyKey: "market-checkout:checkout-review",
                [eventKey]: {
                  provider: "stripe",
                  eventId: "evt_underpaid",
                  eventType: "payment_intent.succeeded",
                  status: "review_required",
                  reviewReason: "AMOUNT_MISMATCH",
                  receivedAt: new Date().toISOString(),
                },
                amountCents: 12000,
                paidAmountCents: 0,
                refundedAmountCents: 0,
                childPaymentIds: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const response = await routes.fetch(
        new Request(
          "https://test/admin?operationAlert=provider_amount_mismatch",
        ),
        env as never,
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        data: {
          checkouts: Array<{
            id: string;
            operationAlerts: Array<{ type: string; severity: string }>;
          }>;
          total: number;
        };
      };
      expect(json.data.total).toBe(1);
      expect(json.data.checkouts[0].operationAlerts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "provider_amount_mismatch",
            severity: "critical",
          }),
        ]),
      );
    },
  );

  it("summarizes market checkout operations for platform admins", async () => {
    const env = createEnv();
    setMarketCheckoutSessionFixtures({
      all: [
        {
          id: "checkout-1",
          marketId: "market-1",
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          status: "submitted",
          paymentStatus: "paid",
          subtotalCents: 20000,
          childOrderCount: 2,
          paymentSummary: {
            status: "paid",
            method: "line_pay",
            currency: "TWD",
            country: "TW",
            totalAmount: 200,
            totalAmountCents: 20000,
            paidAmount: 200,
            paidAmountCents: 20000,
            childPayments: [],
          },
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          updatedAt: new Date("2026-06-01T10:05:00.000Z"),
        },
        {
          id: "checkout-2",
          marketId: "market-1",
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          status: "submitted",
          paymentStatus: "refunded",
          subtotalCents: 12000,
          childOrderCount: 1,
          paymentSummary: {
            status: "refunded",
            method: "line_pay",
            currency: "TWD",
            country: "TW",
            totalAmount: 120,
            totalAmountCents: 12000,
            paidAmount: 120,
            paidAmountCents: 12000,
            refundedAmount: 120,
            refundedAmountCents: 12000,
            childPayments: [],
          },
          createdAt: new Date("2026-06-01T11:00:00.000Z"),
          updatedAt: new Date("2026-06-01T11:05:00.000Z"),
        },
        {
          id: "checkout-3",
          marketId: "market-2",
          marketSlug: "ximen",
          marketName: "西門町商圈",
          status: "submitted",
          paymentStatus: "failed",
          subtotalCents: 8000,
          childOrderCount: 1,
          paymentSummary: {
            status: "failed",
            method: "line_pay",
            currency: "TWD",
            country: "TW",
            totalAmount: 80,
            totalAmountCents: 8000,
            paidAmount: 0,
            paidAmountCents: 0,
            childPayments: [],
          },
          createdAt: new Date("2026-06-01T12:00:00.000Z"),
          updatedAt: new Date("2026-06-01T12:05:00.000Z"),
        },
        {
          id: "checkout-4",
          marketId: "market-3",
          marketSlug: "outside-range",
          marketName: "區間外商圈",
          status: "submitted",
          paymentStatus: "paid",
          subtotalCents: 50000,
          childOrderCount: 5,
          paymentSummary: {
            status: "paid",
            method: "line_pay",
            currency: "TWD",
            country: "TW",
            totalAmount: 500,
            totalAmountCents: 50000,
            paidAmount: 500,
            paidAmountCents: 50000,
            childPayments: [],
          },
          createdAt: new Date("2026-05-31T12:00:00.000Z"),
          updatedAt: new Date("2026-05-31T12:05:00.000Z"),
        },
      ],
    });

    const response = await routes.fetch(
      new Request(
        "https://test/admin/summary?dateFrom=2026-06-01&dateTo=2026-06-01",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        totalCheckouts: number;
        totalSubtotalCents: number;
        paidAmountCents: number;
        refundedAmountCents: number;
        netPaidAmountCents: number;
        childOrderCount: number;
        paymentStatusCounts: Record<string, number>;
        topMarkets: Array<{
          slug: string;
          checkoutCount: number;
          subtotalCents: number;
          paidAmountCents: number;
          refundedAmountCents: number;
        }>;
      };
    };
    expect(json.data).toMatchObject({
      totalCheckouts: 3,
      currency: "TWD",
      totalSubtotalCents: 40000,
      paidAmountCents: 32000,
      refundedAmountCents: 12000,
      netPaidAmountCents: 20000,
      childOrderCount: 4,
      paymentStatusCounts: expect.objectContaining({
        paid: 1,
        refunded: 1,
        failed: 1,
      }),
    });
    expect(json.data.topMarkets[0]).toMatchObject({
      slug: "fengjia",
      currency: "TWD",
      checkoutCount: 2,
      subtotalCents: 32000,
      paidAmountCents: 32000,
      refundedAmountCents: 12000,
    });
  });

  it("does not label a sum across currencies with one currency", async () => {
    const env = createEnv();
    const checkout = (
      id: string,
      slug: string,
      currency: string,
      cents: number,
    ) => ({
      id,
      marketId: `market-${slug}`,
      marketSlug: slug,
      marketName: slug,
      status: "submitted",
      paymentStatus: "paid",
      subtotalCents: cents,
      childOrderCount: 1,
      paymentSummary: {
        status: "paid",
        method: "market_online",
        currency,
        country: currency === "MYR" ? "MY" : "TW",
        totalAmount: cents / 100,
        totalAmountCents: cents,
        paidAmount: cents / 100,
        paidAmountCents: cents,
        childPayments: [],
      },
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      updatedAt: new Date("2026-06-01T10:05:00.000Z"),
    });
    setMarketCheckoutSessionFixtures({
      all: [
        checkout("checkout-tw", "fengjia", "TWD", 20000),
        checkout("checkout-my", "jalan-alor", "MYR", 1250),
      ],
    });

    const response = await routes.fetch(
      new Request("https://test/admin/summary"),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        currency: string | null;
        topMarkets: Array<{ slug: string; currency: string | null }>;
      };
    };
    expect(json.data.currency).toBeNull();
    expect(json.data.topMarkets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "fengjia", currency: "TWD" }),
        expect.objectContaining({ slug: "jalan-alor", currency: "MYR" }),
      ]),
    );
  });

  it("filters market checkout operation summaries by payment status", async () => {
    const env = createEnv();
    setMarketCheckoutSessionFixtures({
      all: [
        {
          id: "checkout-1",
          marketId: "market-1",
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          status: "submitted",
          paymentStatus: "paid",
          subtotalCents: 20000,
          childOrderCount: 2,
          paymentSummary: {
            status: "paid",
            method: "line_pay",
            currency: "TWD",
            country: "TW",
            totalAmount: 200,
            totalAmountCents: 20000,
            paidAmount: 200,
            paidAmountCents: 20000,
            childPayments: [],
          },
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          updatedAt: new Date("2026-06-01T10:05:00.000Z"),
        },
        {
          id: "checkout-2",
          marketId: "market-2",
          marketSlug: "ximen",
          marketName: "西門町商圈",
          status: "submitted",
          paymentStatus: "failed",
          subtotalCents: 8000,
          childOrderCount: 1,
          paymentSummary: null,
          createdAt: new Date("2026-06-01T12:00:00.000Z"),
          updatedAt: new Date("2026-06-01T12:05:00.000Z"),
        },
      ],
    });

    const response = await routes.fetch(
      new Request("https://test/admin/summary?paymentStatus=paid"),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        totalCheckouts: number;
        totalSubtotalCents: number;
        paymentStatusCounts: Record<string, number>;
      };
    };
    expect(json.data).toMatchObject({
      totalCheckouts: 1,
      totalSubtotalCents: 20000,
      paymentStatusCounts: expect.objectContaining({
        paid: 1,
        failed: 0,
      }),
    });
  });

  it("reports market checkout provider configuration status for platform admins", async () => {
    const childModeResponse = await routes.fetch(
      new Request("https://test/admin/provider-status"),
      createEnv() as never,
    );
    expect(childModeResponse.status).toBe(200);
    await expect(childModeResponse.json()).resolves.toMatchObject({
      data: {
        splitMode: "child_transactions",
        readiness: "not_configured",
        providerKind: "internal_child_transactions",
      },
    });

    const missingGatewayEnv = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
    };
    const missingGatewayResponse = await routes.fetch(
      new Request("https://test/admin/provider-status"),
      missingGatewayEnv as never,
    );
    await expect(missingGatewayResponse.json()).resolves.toMatchObject({
      data: {
        splitMode: "provider_split",
        readiness: "not_configured",
        missingConfiguration: ["MARKET_CHECKOUT_PROVIDER_SPLIT_URL"],
      },
    });

    const missingWebhookEnv = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
        "https://payments.example.test/market-split",
    };
    const missingWebhookResponse = await routes.fetch(
      new Request("https://test/admin/provider-status"),
      missingWebhookEnv as never,
    );
    await expect(missingWebhookResponse.json()).resolves.toMatchObject({
      data: {
        splitMode: "provider_split",
        readiness: "warning",
        providerSplitUrlConfigured: true,
        providerWebhookSecretConfigured: false,
        providerStatusUrlConfigured: false,
        providerRefundUrlConfigured: false,
        missingConfiguration: [
          "MARKET_CHECKOUT_WEBHOOK_SECRET",
          "MARKET_CHECKOUT_PROVIDER_STATUS_URL",
          "MARKET_CHECKOUT_PROVIDER_REFUND_URL",
        ],
      },
    });

    const readyEnv = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
        "https://payments.example.test/market-split",
      MARKET_CHECKOUT_PROVIDER_STATUS_URL:
        "https://payments.example.test/market-split/status",
      MARKET_CHECKOUT_PROVIDER_REFUND_URL:
        "https://payments.example.test/market-split/refunds",
      MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "split-token",
      MARKET_CHECKOUT_WEBHOOK_SECRET: "webhook-secret",
    };
    const readyResponse = await routes.fetch(
      new Request("https://test/admin/provider-status"),
      readyEnv as never,
    );
    await expect(readyResponse.json()).resolves.toMatchObject({
      data: {
        splitMode: "provider_split",
        readiness: "ready",
        providerSplitUrlConfigured: true,
        providerSplitHealthUrlConfigured: false,
        providerStatusUrlConfigured: true,
        providerRefundUrlConfigured: true,
        providerSplitTokenConfigured: true,
        providerSplitSigningConfigured: false,
        providerWebhookSecretConfigured: true,
      },
    });
  });

  it("checks market checkout provider split connectivity through the health URL", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: "Provider gateway ready",
            capabilities: ["aggregate_authorization"],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const env = {
      ...createEnv(),
      MARKET_CHECKOUT_SPLIT_MODE: "provider_split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_URL:
        "https://payments.example.test/market-split",
      MARKET_CHECKOUT_PROVIDER_SPLIT_HEALTH_URL:
        "https://payments.example.test/health",
      MARKET_CHECKOUT_PROVIDER_SPLIT_TOKEN: "split-token",
    };

    const response = await routes.fetch(
      new Request("https://test/admin/provider-status/check", {
        method: "POST",
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "passed",
        splitMode: "provider_split",
        target: "https://payments.example.test/health",
        responseStatus: 200,
        message: "Provider gateway ready",
        capabilities: ["aggregate_authorization"],
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://payments.example.test/health",
      {
        method: "GET",
        headers: { authorization: "Bearer split-token" },
      },
    );
    vi.unstubAllGlobals();
  });

  it("exports filtered market checkout operations as CSV", async () => {
    const env = createEnv();
    setMarketCheckoutSessionFixtures({
      all: [
        {
          id: "checkout-1",
          marketId: "market-1",
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          status: "submitted",
          paymentStatus: "paid",
          subtotalCents: 20000,
          childOrderCount: 2,
          paymentSummary: {
            status: "paid",
            method: "line_pay",
            currency: "TWD",
            country: "TW",
            totalAmount: 200,
            totalAmountCents: 20000,
            paidAmount: 200,
            paidAmountCents: 20000,
            refundedAmount: 50,
            refundedAmountCents: 5000,
            childPayments: [
              {
                restaurantId: "restaurant-1",
                restaurantName: "雞排攤",
                orderId: 1001,
                orderNumber: "A-001",
                paymentId: "pay-child-1",
                status: "paid",
                amount: 120,
                amountCents: 12000,
              },
              {
                restaurantId: "restaurant-2",
                restaurantName: "甜點攤",
                orderId: 1002,
                orderNumber: "A-002",
                status: "failed",
                amount: 80,
                amountCents: 8000,
                errorMessage: "Card declined",
              },
            ],
            parentPayment: {
              paymentId: "market_pay_checkout-1",
              status: "paid",
              provider: "line_pay",
              splitMode: "provider_split",
              idempotencyKey: "market-checkout:checkout-1",
              providerTransactionId: "txn-parent-1",
              lastWebhook: {
                provider: "line_pay",
                eventId: "evt-checkout-1-paid",
                eventType: "market_checkout.payment_paid",
                status: "paid",
                receivedAt: "2026-06-01T10:06:00.000Z",
              },
              lastReconciliation: {
                provider: "line_pay",
                eventId: "reconcile-checkout-1",
                eventType: "market_checkout.payment_paid",
                status: "paid",
                receivedAt: "2026-06-01T10:07:00.000Z",
              },
              amountCents: 20000,
              paidAmountCents: 20000,
              refundedAmountCents: 5000,
              childPaymentIds: ["pay-child-1"],
              createdAt: "2026-06-01T10:01:00.000Z",
              updatedAt: "2026-06-01T10:05:00.000Z",
            },
          },
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          updatedAt: new Date("2026-06-01T10:05:00.000Z"),
        },
        {
          id: "checkout-2",
          marketId: "market-2",
          marketSlug: "ximen",
          marketName: "西門町商圈",
          status: "submitted",
          paymentStatus: "failed",
          subtotalCents: 8000,
          childOrderCount: 1,
          paymentSummary: {
            status: "failed",
            method: "line_pay",
            currency: "TWD",
            country: "TW",
            totalAmount: 80,
            totalAmountCents: 8000,
            paidAmount: 0,
            paidAmountCents: 0,
            childPayments: [],
          },
          createdAt: new Date("2026-06-01T12:00:00.000Z"),
          updatedAt: new Date("2026-06-01T12:05:00.000Z"),
        },
      ],
    });

    const response = await routes.fetch(
      new Request(
        "https://test/admin/export?paymentStatus=paid&dateFrom=2026-06-01&dateTo=2026-06-01",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "market-checkouts-",
    );
    const csv = await response.text();
    const [headers, paidRow] = csv
      .trim()
      .split("\n")
      .map((line) => line.split(","));
    expect(headers).toEqual([
      "checkout_id",
      "market_slug",
      "market_name",
      "status",
      "payment_status",
      "payment_method",
      "payment_provider",
      "split_mode",
      "parent_payment_id",
      "provider_transaction_id",
      "last_webhook_status",
      "last_webhook_event_type",
      "last_webhook_received_at",
      "last_reconciliation_status",
      "last_reconciliation_event_type",
      "last_reconciliation_received_at",
      "child_order_count",
      "child_payment_count",
      "failed_child_payment_count",
      "subtotal_cents",
      "paid_amount_cents",
      "refunded_amount_cents",
      "net_paid_amount_cents",
      "created_at",
      "updated_at",
    ]);
    expect(paidRow).toHaveLength(headers.length);
    expect(paidRow).toEqual([
      "checkout-1",
      "fengjia",
      "逢甲夜市",
      "submitted",
      "paid",
      "line_pay",
      "line_pay",
      "provider_split",
      "market_pay_checkout-1",
      "txn-parent-1",
      "paid",
      "market_checkout.payment_paid",
      "2026-06-01T10:06:00.000Z",
      "paid",
      "market_checkout.payment_paid",
      "2026-06-01T10:07:00.000Z",
      "2",
      "2",
      "1",
      "20000",
      "20000",
      "5000",
      "15000",
      "2026-06-01T10:00:00.000Z",
      "2026-06-01T10:05:00.000Z",
    ]);
    expect(csv).not.toContain("checkout-2");
  });

  it("summarizes market checkout settlement totals by vendor", async () => {
    const env = createEnv();
    setSettlementFixtures(
      {
        all: [
          {
            id: "checkout-1",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            status: "submitted",
            paymentStatus: "paid",
            subtotalCents: 20000,
            childOrderCount: 2,
            paymentSummary: {
              status: "paid",
              method: "line_pay",
              currency: "TWD",
              country: "TW",
              totalAmount: 200,
              totalAmountCents: 20000,
              paidAmount: 200,
              paidAmountCents: 20000,
              childPayments: [
                {
                  restaurantId: "restaurant-1",
                  restaurantName: "雞排攤",
                  orderId: 1001,
                  orderNumber: "A001",
                  paymentId: "pay-1001",
                  status: "paid",
                  amount: 120,
                  amountCents: 12000,
                },
                {
                  restaurantId: "restaurant-2",
                  restaurantName: "甜點攤",
                  orderId: 1002,
                  orderNumber: "A002",
                  paymentId: "pay-1002",
                  status: "paid",
                  amount: 80,
                  amountCents: 8000,
                },
              ],
              settlement: {
                platformFeeRateBps: 350,
                platformFeeCents: 700,
                vendorNetAmountCents: 19300,
                vendorAllocations: [
                  {
                    restaurantId: "restaurant-1",
                    restaurantName: "雞排攤",
                    orderId: 1001,
                    orderNumber: "A001",
                    grossAmountCents: 12000,
                    refundedAmountCents: 0,
                    platformFeeCents: 420,
                    netAmountCents: 11580,
                  },
                  {
                    restaurantId: "restaurant-2",
                    restaurantName: "甜點攤",
                    orderId: 1002,
                    orderNumber: "A002",
                    grossAmountCents: 8000,
                    refundedAmountCents: 0,
                    platformFeeCents: 280,
                    netAmountCents: 7720,
                  },
                ],
              },
            },
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:05:00.000Z"),
          },
          {
            id: "checkout-2",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            status: "submitted",
            paymentStatus: "refunded",
            subtotalCents: 12000,
            childOrderCount: 1,
            paymentSummary: {
              status: "refunded",
              method: "line_pay",
              currency: "TWD",
              country: "TW",
              totalAmount: 120,
              totalAmountCents: 12000,
              paidAmount: 120,
              paidAmountCents: 12000,
              refundedAmount: 120,
              refundedAmountCents: 12000,
              childPayments: [
                {
                  restaurantId: "restaurant-1",
                  restaurantName: "雞排攤",
                  orderId: 1003,
                  orderNumber: "A003",
                  paymentId: "pay-1003",
                  refundId: "refund-1003",
                  status: "refunded",
                  amount: 120,
                  amountCents: 12000,
                },
              ],
              settlement: {
                platformFeeRateBps: 350,
                platformFeeCents: 0,
                vendorNetAmountCents: 0,
                vendorAllocations: [
                  {
                    restaurantId: "restaurant-1",
                    restaurantName: "雞排攤",
                    orderId: 1003,
                    orderNumber: "A003",
                    grossAmountCents: 12000,
                    refundedAmountCents: 12000,
                    platformFeeCents: 0,
                    netAmountCents: 0,
                  },
                ],
              },
            },
            createdAt: new Date("2026-06-01T11:00:00.000Z"),
            updatedAt: new Date("2026-06-01T11:05:00.000Z"),
          },
          {
            id: "checkout-3",
            marketId: "market-2",
            marketSlug: "outside",
            marketName: "區間外商圈",
            status: "submitted",
            paymentStatus: "paid",
            subtotalCents: 99900,
            childOrderCount: 1,
            paymentSummary: null,
            createdAt: new Date("2026-05-31T11:00:00.000Z"),
            updatedAt: new Date("2026-05-31T11:05:00.000Z"),
          },
        ],
      },
      {
        all: [
          {
            checkoutId: "checkout-1",
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            totalAmountCents: 12000,
            tokenExpiresAt: new Date("2026-06-01T14:00:00.000Z"),
          },
          {
            checkoutId: "checkout-1",
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 1002,
            orderNumber: "A002",
            totalAmount: 80,
            totalAmountCents: 8000,
            tokenExpiresAt: new Date("2026-06-01T14:00:00.000Z"),
          },
          {
            checkoutId: "checkout-2",
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1003,
            orderNumber: "A003",
            totalAmount: 120,
            totalAmountCents: 12000,
            tokenExpiresAt: new Date("2026-06-01T15:00:00.000Z"),
          },
          {
            checkoutId: "checkout-3",
            restaurantId: "restaurant-9",
            restaurantName: "區間外攤位",
            orderId: 1009,
            orderNumber: "A009",
            totalAmount: 999,
            totalAmountCents: 99900,
            tokenExpiresAt: new Date("2026-05-31T15:00:00.000Z"),
          },
        ],
      },
    );

    const response = await routes.fetch(
      new Request(
        "https://test/admin/vendors?marketSlug=fengjia&dateFrom=2026-06-01&dateTo=2026-06-01",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        vendors: Array<{
          restaurantId: string;
          restaurantName: string;
          checkoutCount: number;
          childOrderCount: number;
          subtotalCents: number;
          paidAmountCents: number;
          refundedAmountCents: number;
          netPaidAmountCents: number;
          platformDiscountCents: number;
          vendorDiscountCents: number;
          settlementBaseCents: number;
          platformFeeCents: number;
          vendorNetAmountCents: number;
          refundedPaymentCount: number;
          failedPaymentCount: number;
        }>;
      };
    };
    expect(json.data.vendors).toEqual([
      {
        restaurantId: "restaurant-1",
        restaurantName: "雞排攤",
        currency: "TWD",
        checkoutCount: 2,
        childOrderCount: 2,
        subtotalCents: 24000,
        paidAmountCents: 24000,
        refundedAmountCents: 12000,
        netPaidAmountCents: 12000,
        platformDiscountCents: 0,
        vendorDiscountCents: 0,
        settlementBaseCents: 0,
        platformFeeCents: 420,
        vendorNetAmountCents: 11580,
        refundedPaymentCount: 1,
        failedPaymentCount: 0,
      },
      {
        restaurantId: "restaurant-2",
        restaurantName: "甜點攤",
        currency: "TWD",
        checkoutCount: 1,
        childOrderCount: 1,
        subtotalCents: 8000,
        paidAmountCents: 8000,
        refundedAmountCents: 0,
        netPaidAmountCents: 8000,
        platformDiscountCents: 0,
        vendorDiscountCents: 0,
        settlementBaseCents: 0,
        platformFeeCents: 280,
        vendorNetAmountCents: 7720,
        refundedPaymentCount: 0,
        failedPaymentCount: 0,
      },
    ]);
  });

  it("exports vendor settlement summaries as CSV", async () => {
    const env = createEnv();
    setSettlementFixtures(
      {
        all: [
          {
            id: "checkout-1",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            status: "submitted",
            paymentStatus: "refunded",
            subtotalCents: 12000,
            childOrderCount: 1,
            paymentSummary: {
              status: "refunded",
              method: "line_pay",
              currency: "TWD",
              country: "TW",
              totalAmount: 120,
              totalAmountCents: 12000,
              paidAmount: 120,
              paidAmountCents: 12000,
              refundedAmount: 120,
              refundedAmountCents: 12000,
              childPayments: [
                {
                  restaurantId: "restaurant-1",
                  restaurantName: "雞排攤",
                  orderId: 1001,
                  orderNumber: "A001",
                  paymentId: "pay-1001",
                  refundId: "refund-1001",
                  status: "refunded",
                  amount: 120,
                  amountCents: 12000,
                },
              ],
              settlement: {
                platformFeeRateBps: 350,
                platformFeeCents: 0,
                vendorNetAmountCents: 0,
                vendorAllocations: [
                  {
                    restaurantId: "restaurant-1",
                    restaurantName: "雞排攤",
                    orderId: 1001,
                    orderNumber: "A001",
                    grossAmountCents: 12000,
                    refundedAmountCents: 12000,
                    platformFeeCents: 0,
                    netAmountCents: 0,
                  },
                ],
              },
            },
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:05:00.000Z"),
          },
          {
            id: "checkout-2",
            marketId: "market-2",
            marketSlug: "outside",
            marketName: "區間外商圈",
            status: "submitted",
            paymentStatus: "paid",
            subtotalCents: 99900,
            childOrderCount: 1,
            paymentSummary: null,
            createdAt: new Date("2026-05-31T10:00:00.000Z"),
            updatedAt: new Date("2026-05-31T10:05:00.000Z"),
          },
        ],
      },
      {
        all: [
          {
            checkoutId: "checkout-1",
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            totalAmountCents: 12000,
            tokenExpiresAt: new Date("2026-06-01T14:00:00.000Z"),
          },
          {
            checkoutId: "checkout-2",
            restaurantId: "restaurant-9",
            restaurantName: "區間外攤位",
            orderId: 1009,
            orderNumber: "A009",
            totalAmount: 999,
            totalAmountCents: 99900,
            tokenExpiresAt: new Date("2026-05-31T14:00:00.000Z"),
          },
        ],
      },
    );

    const response = await routes.fetch(
      new Request(
        "https://test/admin/vendors/export?marketSlug=fengjia&dateFrom=2026-06-01&dateTo=2026-06-01",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "market-checkout-vendors-",
    );
    const csv = await response.text();
    expect(csv).toContain(
      "restaurant_id,restaurant_name,checkout_count,child_order_count",
    );
    expect(csv).toContain(
      "restaurant-1,雞排攤,1,1,12000,12000,12000,0,0,0,0,0,0,1,0",
    );
    expect(csv).not.toContain("restaurant-9");
  });

  it("exports settlement accounting journal entries as CSV", async () => {
    const env = createEnv();
    setSettlementFixtures(
      {
        all: [
          {
            id: "checkout-1",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            status: "submitted",
            paymentStatus: "refunded",
            subtotalCents: 12000,
            childOrderCount: 1,
            paymentSummary: {
              status: "refunded",
              method: "line_pay",
              currency: "TWD",
              country: "TW",
              totalAmount: 120,
              totalAmountCents: 12000,
              paidAmount: 120,
              paidAmountCents: 12000,
              refundedAmount: 120,
              refundedAmountCents: 12000,
              paidAt: "2026-06-01T10:01:00.000Z",
              childPayments: [
                {
                  restaurantId: "restaurant-1",
                  restaurantName: "雞排攤",
                  orderId: 1001,
                  orderNumber: "A001",
                  paymentId: "pay-1001",
                  refundId: "refund-1001",
                  status: "refunded",
                  amount: 120,
                  amountCents: 12000,
                },
              ],
              parentPayment: {
                paymentId: "market_pay_checkout-1",
                status: "refunded",
                provider: "line_pay",
                splitMode: "child_transactions",
                idempotencyKey: "market-checkout:checkout-1",
                amountCents: 12000,
                paidAmountCents: 12000,
                refundedAmountCents: 12000,
                childPaymentIds: ["pay-1001"],
                createdAt: "2026-06-01T10:01:00.000Z",
                updatedAt: "2026-06-01T10:05:00.000Z",
              },
              settlement: {
                platformFeeRateBps: 350,
                platformFeeCents: 0,
                vendorNetAmountCents: 0,
                vendorAllocations: [
                  {
                    restaurantId: "restaurant-1",
                    restaurantName: "雞排攤",
                    orderId: 1001,
                    orderNumber: "A001",
                    grossAmountCents: 12000,
                    refundedAmountCents: 12000,
                    platformFeeCents: 0,
                    netAmountCents: 0,
                  },
                ],
              },
            },
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:05:00.000Z"),
          },
          {
            id: "checkout-2",
            marketId: "market-1",
            marketSlug: "fengjia",
            marketName: "逢甲夜市",
            status: "submitted",
            paymentStatus: "paid",
            subtotalCents: 20000,
            childOrderCount: 2,
            paymentSummary: {
              status: "paid",
              method: "line_pay",
              currency: "TWD",
              country: "TW",
              totalAmount: 200,
              totalAmountCents: 20000,
              paidAmount: 200,
              paidAmountCents: 20000,
              paidAt: "2026-06-01T11:01:00.000Z",
              childPayments: [],
              parentPayment: {
                paymentId: "market_pay_checkout-2",
                status: "paid",
                provider: "line_pay",
                splitMode: "provider_split",
                idempotencyKey: "market-checkout:checkout-2",
                providerTransactionId: "txn-parent-2",
                lastWebhook: {
                  provider: "line_pay",
                  eventId: "evt-checkout-2-paid",
                  eventType: "market_checkout.payment_paid",
                  status: "paid",
                  receivedAt: "2026-06-01T11:06:00.000Z",
                },
                lastReconciliation: {
                  provider: "line_pay",
                  eventId: "reconcile-checkout-2",
                  eventType: "market_checkout.payment_paid",
                  status: "paid",
                  receivedAt: "2026-06-01T11:07:00.000Z",
                },
                amountCents: 20000,
                paidAmountCents: 20000,
                refundedAmountCents: 0,
                childPaymentIds: [],
                createdAt: "2026-06-01T11:01:00.000Z",
                updatedAt: "2026-06-01T11:05:00.000Z",
              },
              settlement: {
                platformFeeRateBps: 350,
                platformFeeCents: 700,
                vendorNetAmountCents: 19300,
                vendorAllocations: [
                  {
                    restaurantId: "restaurant-1",
                    restaurantName: "雞排攤",
                    orderId: 1002,
                    orderNumber: "A002",
                    grossAmountCents: 12000,
                    refundedAmountCents: 0,
                    platformFeeCents: 420,
                    netAmountCents: 11580,
                  },
                  {
                    restaurantId: "restaurant-2",
                    restaurantName: "甜點攤",
                    orderId: 1003,
                    orderNumber: "A003",
                    grossAmountCents: 8000,
                    refundedAmountCents: 0,
                    platformFeeCents: 280,
                    netAmountCents: 7720,
                  },
                ],
              },
            },
            createdAt: new Date("2026-06-01T11:00:00.000Z"),
            updatedAt: new Date("2026-06-01T11:05:00.000Z"),
          },
        ],
      },
      {
        all: [
          {
            checkoutId: "checkout-1",
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            totalAmountCents: 12000,
            tokenExpiresAt: new Date("2026-06-01T14:00:00.000Z"),
          },
          {
            checkoutId: "checkout-2",
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1002,
            orderNumber: "A002",
            totalAmount: 120,
            totalAmountCents: 12000,
            tokenExpiresAt: new Date("2026-06-01T15:00:00.000Z"),
          },
          {
            checkoutId: "checkout-2",
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 1003,
            orderNumber: "A003",
            totalAmount: 80,
            totalAmountCents: 8000,
            tokenExpiresAt: new Date("2026-06-01T15:00:00.000Z"),
          },
        ],
      },
    );

    const response = await routes.fetch(
      new Request(
        "https://test/admin/accounting/export?marketSlug=fengjia&dateFrom=2026-06-01&dateTo=2026-06-01",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "market-checkout-accounting-",
    );
    const csv = await response.text();
    expect(csv).toContain(
      "entry_date,checkout_id,market_slug,market_name,restaurant_id,restaurant_name,order_id,order_number,payment_provider,split_mode,provider_transaction_id,last_webhook_status,last_webhook_received_at,last_reconciliation_status,last_reconciliation_received_at,account_code,account_name,direction,amount_cents,currency,source_type,source_id,memo",
    );
    expect(csv).toContain(
      "2026-06-01T11:01:00.000Z,checkout-2,fengjia,逢甲夜市,restaurant-1,雞排攤,1002,A002,line_pay,provider_split,txn-parent-2,paid,2026-06-01T11:06:00.000Z,paid,2026-06-01T11:07:00.000Z,1100,payment_clearing,debit,12000,TWD,market_checkout_settlement,market_pay_checkout-2,net paid amount before platform fee",
    );
    expect(csv).toContain(
      "restaurant-1,雞排攤,1002,A002,line_pay,provider_split,txn-parent-2,paid,2026-06-01T11:06:00.000Z,paid,2026-06-01T11:07:00.000Z,2200,vendor_payable,credit,11580,TWD,market_checkout_settlement,market_pay_checkout-2,vendor net payable",
    );
    expect(csv).toContain(
      "restaurant-1,雞排攤,1002,A002,line_pay,provider_split,txn-parent-2,paid,2026-06-01T11:06:00.000Z,paid,2026-06-01T11:07:00.000Z,4100,platform_fee_revenue,credit,420,TWD,market_checkout_settlement,market_pay_checkout-2,platform fee revenue",
    );
    expect(csv).toContain(
      "restaurant-1,雞排攤,1001,A001,line_pay,child_transactions,,,,,,1300,refund_clearing,debit,12000,TWD,market_checkout_refund,market_pay_checkout-1,refund issued to customer",
    );
    expect(csv).toContain(
      "restaurant-1,雞排攤,1001,A001,line_pay,child_transactions,,,,,,1100,payment_clearing,credit,12000,TWD,market_checkout_refund,market_pay_checkout-1,cash clearing reversal for refund",
    );
  });

  it("falls back to the KV index when no persisted checkout sessions exist", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        payment: {
          status: "partial_paid",
          method: "line_pay",
          currency: "TWD",
          country: "TW",
          totalAmount: 120,
          totalAmountCents: 12000,
          paidAmount: 80,
          paidAmountCents: 8000,
          childPayments: [],
        },
        subtotal: 12000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );
    await env.CACHE_KV.put(
      "market_checkout:index",
      JSON.stringify([
        {
          id: "checkout-1",
          market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
          status: "submitted",
          paymentStatus: "partial_paid",
          subtotal: 12000,
          childOrderCount: 1,
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:05:00.000Z",
        },
      ]),
    );

    const response = await routes.fetch(
      new Request("https://test/admin?paymentStatus=partial_paid"),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        checkouts: Array<{
          id: string;
          market: { slug: string };
          paymentStatus: string;
          childOrderCount: number;
        }>;
        total: number;
      };
    };
    expect(json.data.total).toBe(1);
    expect(json.data.checkouts[0]).toMatchObject({
      id: "checkout-1",
      market: { slug: "fengjia" },
      paymentStatus: "partial_paid",
      childOrderCount: 1,
    });
  });

  it("filters KV-backed admin checkout lists by market and status with default pagination", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:index",
      JSON.stringify([
        {
          id: "checkout-1",
          market: { id: "market-1", slug: "fengjia", name: "Fengjia" },
          status: "submitted",
          paymentStatus: "pending",
          subtotal: 12000,
          childOrderCount: 1,
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:05:00.000Z",
        },
        {
          id: "checkout-2",
          market: { id: "market-2", slug: "outside", name: "Outside" },
          status: "submitted",
          paymentStatus: "pending",
          subtotal: 8000,
          childOrderCount: 1,
          createdAt: "2026-06-01T11:00:00.000Z",
          updatedAt: "2026-06-01T11:05:00.000Z",
        },
      ]),
    );

    const response = await routes.fetch(
      new Request(
        "https://test/admin?marketSlug=fengjia&status=submitted&page=bad&limit=bad",
      ),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { checkouts: Array<{ id: string }>; page: number; limit: number };
    };
    expect(json.data).toMatchObject({
      page: 1,
      limit: 20,
      checkouts: [{ id: "checkout-1" }],
    });
  });

  it("exports KV-backed checkouts with escaped CSV fields and empty payment defaults", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:index",
      JSON.stringify([
        {
          id: "checkout,quoted",
          market: {
            id: "market-1",
            slug: "fengjia",
            name: 'Fengjia "Night" Market',
          },
          status: "submitted",
          paymentStatus: "pending",
          subtotal: 12000,
          childOrderCount: 1,
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:05:00.000Z",
        },
      ]),
    );

    const response = await routes.fetch(
      new Request("https://test/admin/export?marketSlug=fengjia"),
      env as never,
    );

    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain(
      '"checkout,quoted",fengjia,"Fengjia ""Night"" Market",submitted,pending',
    );
    expect(csv).toContain(",,,,,,,,,,,1,0,0,12000,0,0,0,");
  });

  it("hydrates child order status when platform admins read checkout details", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv();
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 12000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );
    getOrder.mockResolvedValueOnce({
      id: 1001,
      orderNumber: "A001",
      totalAmount: 120,
      totalAmountCents: 12000,
      status: "ready",
      paymentStatus: "completed",
      updatedAt: 1780308400000,
    });

    const response = await routes.fetch(
      new Request("https://test/admin/checkout-1"),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(getOrder).toHaveBeenCalledWith(1001, false);
    const json = (await response.json()) as {
      data: {
        checkout: {
          childOrders: Array<{
            status?: string;
            paymentStatus?: string;
            totalAmountCents?: number;
          }>;
        };
      };
    };
    expect(json.data.checkout.childOrders[0]).toMatchObject({
      status: "ready",
      paymentStatus: "completed",
      totalAmountCents: 12000,
    });
  });

  it("takes a legacy ledger row's missing currency from the vendors", async () => {
    setNoPersistedCheckoutFixtures();
    resolveDisplaySharedRestaurantCurrency.mockResolvedValue("MYR");
    const env = createEnv([
      {
        payment_id: "market_pay_checkout-1",
        provider: "credit_balance",
        split_mode: "provider_split",
        idempotency_key: null,
        status: "paid",
        amount_cents: 12000,
        paid_amount_cents: 12000,
        refunded_amount_cents: 0,
        currency: null,
        country_code: null,
        child_payment_ids: null,
        provider_payload: null,
        created_at_ms: 1780308000000,
        updated_at_ms: 1780308600000,
      },
    ]);
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "Nasi lemak",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 12000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );
    getOrder.mockResolvedValueOnce(null);

    const response = await routes.fetch(
      new Request("https://test/admin/checkout-1"),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        checkout: { payment: { currency: "MYR", country: "MY" } },
      },
    });
    expect(resolveDisplaySharedRestaurantCurrency).toHaveBeenCalledWith(
      env.DB,
      ["restaurant-1"],
    );
  });

  it("reads a legacy checkout whose vendors no longer share a currency", async () => {
    // The strict resolver has three ways to refuse — MIXED_CURRENCY_CHECKOUT,
    // RESTAURANT_CURRENCY_INVALID, RESTAURANT_NOT_FOUND — and this is a GET.
    // Putting it on the read path turned looking at an old, fully paid
    // checkout into an error page nobody reading it could clear.
    setNoPersistedCheckoutFixtures();
    resolveSharedRestaurantCurrency.mockRejectedValue(
      new ApiError(
        "MIXED_CURRENCY_CHECKOUT",
        "All vendors in one checkout must use the same currency",
        409,
      ),
    );
    resolveDisplaySharedRestaurantCurrency.mockResolvedValue("TWD");
    const env = createEnv([
      {
        payment_id: "market_pay_checkout-1",
        provider: "credit_balance",
        split_mode: "provider_split",
        idempotency_key: null,
        status: "paid",
        amount_cents: 12000,
        paid_amount_cents: 12000,
        refunded_amount_cents: 0,
        currency: null,
        country_code: null,
        child_payment_ids: null,
        provider_payload: null,
        created_at_ms: 1780308000000,
        updated_at_ms: 1780308600000,
      },
    ]);
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 12000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );
    getOrder.mockResolvedValueOnce(null);

    const response = await routes.fetch(
      new Request("https://test/admin/checkout-1"),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { checkout: { payment: { currency: "TWD" } } },
    });
    expect(resolveSharedRestaurantCurrency).not.toHaveBeenCalled();
  });

  it.each([
    ["stripe", "vnd", 100000, 10000000],
    ["stripe", "twd", 25000, 25000],
    ["linepay", "TWD", 250, 25000],
    ["stripe", "usd", 1000, undefined],
  ])(
    "summarizes a %s %s webhook amount in internal cents",
    async (provider, currency, providerAmount, expectedCents) => {
      setNoPersistedCheckoutFixtures();
      const env = createEnv([
        {
          payment_id: "market_pay_checkout-1",
          provider,
          split_mode: "provider_split",
          idempotency_key: "market-checkout:checkout-1",
          status: "pending",
          amount_cents: 10000000,
          paid_amount_cents: 0,
          refunded_amount_cents: 0,
          currency: "VND",
          country_code: "VN",
          child_payment_ids: "[]",
          provider_payload: JSON.stringify({
            lastWebhook: {
              provider,
              eventId: "evt_1",
              eventType: "payment_intent.succeeded",
              status: "review_required",
              reviewReason: "AMOUNT_MISMATCH",
              receivedAt: "2026-06-01T10:09:00.000Z",
              payload: {
                data: {
                  object: {
                    id: "pi_1",
                    amount_received: providerAmount,
                    currency,
                  },
                },
              },
            },
          }),
          created_at_ms: 1780308000000,
          updated_at_ms: 1780308600000,
        },
      ]);
      await env.CACHE_KV.put(
        "market_checkout:checkout-1",
        JSON.stringify({
          id: "checkout-1",
          market: { id: "market-1", slug: "ben-thanh", name: "Ben Thanh" },
          status: "submitted",
          childOrders: [],
          subtotal: 10000000,
          createdAt: "2026-06-01T10:00:00.000Z",
        }),
      );

      const response = await routes.fetch(
        new Request("https://test/admin/checkout-1"),
        env as never,
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        data: {
          checkout: {
            payment: {
              parentPayment: {
                lastWebhook: {
                  reviewReason?: string;
                  payloadSummary: {
                    amountReceivedCents?: number;
                    currency?: string;
                  };
                };
              };
            };
          };
        };
      };
      const lastWebhook = json.data.checkout.payment.parentPayment.lastWebhook;
      expect(lastWebhook.reviewReason).toBe("AMOUNT_MISMATCH");
      expect(lastWebhook.payloadSummary.currency).toBe(currency);
      expect(lastWebhook.payloadSummary.amountReceivedCents).toBe(
        expectedCents,
      );
    },
  );

  it("hydrates parent payment from the persisted checkout payment ledger", async () => {
    setNoPersistedCheckoutFixtures();
    const env = createEnv([
      {
        payment_id: "market_pay_checkout-1",
        provider: "line_pay",
        split_mode: "child_transactions",
        idempotency_key: "market-pay-checkout-1",
        status: "partial_refunded",
        amount_cents: 20000,
        paid_amount_cents: 20000,
        refunded_amount_cents: 8000,
        currency: "TWD",
        country_code: "TW",
        child_payment_ids: JSON.stringify(["pay-1001", "pay-1002"]),
        provider_payload: JSON.stringify({
          source: "market-checkouts",
          lastWebhook: {
            provider: "mock_market_provider",
            eventId: "evt-market-checkout-paid-1",
            eventType: "market_checkout.payment_paid",
            status: "paid",
            receivedAt: "2026-06-01T10:09:00.000Z",
            payload: {
              data: {
                object: {
                  id: "intent-market-checkout-1",
                  status: "succeeded",
                  amount_received: 20000,
                  currency: "TWD",
                  metadata: {
                    marketCheckoutId: "checkout-1",
                    customerPhone: "+886912345678",
                  },
                  last_payment_error: {
                    code: "card_declined",
                    message: "Card was declined by issuer",
                  },
                },
              },
            },
          },
          lastReconciliation: {
            provider: "mock_market_provider",
            eventId: "reconcile-market-checkout-1",
            eventType: "market_checkout.payment_paid",
            status: "paid",
            receivedAt: "2026-06-01T10:11:00.000Z",
            payload: {
              providerTransactionId: "intent-market-checkout-1",
              status: "paid",
              amountReceivedCents: 20000,
              currency: "TWD",
              failureCode: "provider_pending_timeout",
              failureReason: "Provider status remained pending",
              providerPayload: {
                metadata: {
                  marketCheckoutId: "checkout-1",
                  internalTrace: "trace-secret",
                },
              },
            },
          },
        }),
        created_at_ms: 1780308000000,
        updated_at_ms: 1780308600000,
      },
    ]);
    await env.CACHE_KV.put(
      "market_checkout:checkout-1",
      JSON.stringify({
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            totalAmount: 120,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        payment: {
          status: "paid",
          method: "line_pay",
          currency: "TWD",
          country: "TW",
          totalAmount: 200,
          totalAmountCents: 20000,
          paidAmount: 200,
          paidAmountCents: 20000,
          childPayments: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "雞排攤",
              orderId: 1001,
              orderNumber: "A001",
              paymentId: "pay-1001",
              status: "paid",
              amount: 120,
              amountCents: 12000,
            },
          ],
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "paid",
            provider: "line_pay",
            splitMode: "child_transactions",
            idempotencyKey: "market-pay-checkout-1",
            amountCents: 20000,
            paidAmountCents: 20000,
            refundedAmountCents: 0,
            childPaymentIds: ["pay-1001"],
            createdAt: "2026-06-01T10:00:00.000Z",
            updatedAt: "2026-06-01T10:00:00.000Z",
          },
        },
        subtotal: 20000,
        createdAt: "2026-06-01T10:00:00.000Z",
      }),
    );
    getOrder.mockResolvedValueOnce(null);

    const response = await routes.fetch(
      new Request("https://test/admin/checkout-1"),
      env as never,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        checkout: {
          payment: {
            status: string;
            refundedAmountCents?: number;
            parentPayment: {
              status: string;
              refundedAmountCents: number;
              childPaymentIds: string[];
              updatedAt: string;
              lastWebhook?: {
                provider: string;
                eventId: string;
                eventType: string;
                status: string;
                receivedAt: string;
                payloadSummary?: {
                  objectId?: string;
                  status?: string;
                  amountReceivedCents?: number;
                  currency?: string;
                  metadataKeys?: string[];
                  failureCode?: string;
                  failureReason?: string;
                };
              };
              lastReconciliation?: {
                provider: string;
                eventId: string;
                eventType: string;
                status: string;
                receivedAt: string;
                payloadSummary?: {
                  providerTransactionId?: string;
                  status?: string;
                  amountReceivedCents?: number;
                  currency?: string;
                  metadataKeys?: string[];
                  failureCode?: string;
                  failureReason?: string;
                };
              };
            };
          };
        };
      };
    };
    expect(json.data.checkout.payment).toMatchObject({
      status: "partial_refunded",
      refundedAmountCents: 8000,
      parentPayment: {
        status: "partial_refunded",
        refundedAmountCents: 8000,
        childPaymentIds: ["pay-1001", "pay-1002"],
        updatedAt: "2026-06-01T10:10:00.000Z",
        lastWebhook: {
          provider: "mock_market_provider",
          eventId: "evt-market-checkout-paid-1",
          eventType: "market_checkout.payment_paid",
          status: "paid",
          receivedAt: "2026-06-01T10:09:00.000Z",
          payloadSummary: {
            objectId: "intent-market-checkout-1",
            status: "succeeded",
            amountReceivedCents: 20000,
            currency: "TWD",
            metadataKeys: ["customerPhone", "marketCheckoutId"],
            failureCode: "card_declined",
            failureReason: "Card was declined by issuer",
          },
        },
        lastReconciliation: {
          provider: "mock_market_provider",
          eventId: "reconcile-market-checkout-1",
          eventType: "market_checkout.payment_paid",
          status: "paid",
          receivedAt: "2026-06-01T10:11:00.000Z",
          payloadSummary: {
            providerTransactionId: "intent-market-checkout-1",
            status: "paid",
            amountReceivedCents: 20000,
            currency: "TWD",
            metadataKeys: ["internalTrace", "marketCheckoutId"],
            failureCode: "provider_pending_timeout",
            failureReason: "Provider status remained pending",
          },
        },
      },
    });
    expect(JSON.stringify(json)).not.toContain("+886912345678");
    expect(JSON.stringify(json)).not.toContain("trace-secret");
  });

  it("handles malformed and unsigned market checkout webhooks", async () => {
    await withSilencedRouteError(async () => {
      const env = {
        ...createEnv(),
        MARKET_CHECKOUT_WEBHOOK_SECRET: "market-secret",
      };
      const malformedBody = "{";
      const malformedResponse = await routes.fetch(
        new Request("https://test/payment-webhooks/mock_market_provider", {
          method: "POST",
          headers: {
            "x-webhook-signature": await signMockMarketCheckoutWebhook(
              "market-secret",
              malformedBody,
            ),
          },
          body: malformedBody,
        }),
        env as never,
      );
      await expectApiError(malformedResponse, 400, "BAD_REQUEST");

      const unsignedBody = JSON.stringify({
        id: "evt-missing-signature",
        type: "market_checkout.payment_paid",
      });
      const unsignedResponse = await routes.fetch(
        new Request("https://test/payment-webhooks/mock_market_provider", {
          method: "POST",
          body: unsignedBody,
        }),
        env as never,
      );
      await expectApiError(
        unsignedResponse,
        401,
        "MARKET_CHECKOUT_WEBHOOK_SIGNATURE_INVALID",
      );
    });
  });
});
