import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";
import { MarketCheckoutPOSPaymentService } from "./MarketCheckoutPOSPaymentService";

// Vendors' shared currency is a drizzle read this SQL-matching D1 stub does not
// model; the resolver has its own suite.
vi.mock(
  "../../../shared/utils/restaurant-currency",
  async (importOriginal) => ({
    ...((await importOriginal()) as Record<string, unknown>),
    resolveSharedRestaurantCurrency: vi.fn(async () => "TWD"),
  }),
);

const REGISTER_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

function buildSession(overrides: Row = {}): Row {
  return {
    id: "checkout-1",
    market_id: "market-1",
    market_slug: "fengjia",
    market_name: "Night Market",
    platform_fee_rate_bps: 0,
    payment_status: "pending",
    payment_summary: null,
    subtotal_cents: 20000,
    child_order_count: 2,
    created_at_ms: Date.parse("2026-06-01T10:00:00.000Z"),
    ...overrides,
  };
}

function buildChild(restaurantId: string, orderId: number): Row {
  return {
    restaurant_id: restaurantId,
    restaurant_name: `Stall ${restaurantId}`,
    order_id: orderId,
    order_number: `A${orderId}`,
    total_amount_cents: 10000,
  };
}

const defaultShift: Row = {
  shift_id: "11111111-1111-4111-8111-111111111111",
  register_id: REGISTER_ID,
  restaurant_id: "restaurant-1",
};

function createEnv(data: {
  session?: Row | null;
  children?: Row[];
  shift?: Row | null;
  kv?: Record<string, string>;
}) {
  const session = data.session === undefined ? buildSession() : data.session;
  const children = data.children ?? [
    buildChild("restaurant-1", 1001),
    buildChild("restaurant-2", 1002),
  ];
  const shift = data.shift === undefined ? defaultShift : data.shift;
  const kv = new Map(Object.entries(data.kv ?? {}));

  const rowsFor = (sql: string): Row[] => {
    const s = sql.toLowerCase();
    if (s.includes('from "market_checkout_sessions"'))
      return session ? [session] : [];
    if (s.includes('from "market_checkout_child_orders"')) return children;
    if (s.includes('from "cash_shifts"')) return shift ? [shift] : [];
    return [];
  };

  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => rowsFor(sql)[0] ?? null),
      all: vi.fn(async () => ({ results: rowsFor(sql) })),
      raw: vi.fn(async () => rowsFor(sql).map((row) => Object.values(row))),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
    })),
  }));

  const env = {
    DB: { prepare, batch: vi.fn(async (s: unknown[]) => s) },
    CACHE_KV: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kv.set(key, value);
      }),
      delete: vi.fn(),
    },
  } as unknown as Env;
  return { env, prepare };
}

const baseInput = {
  checkoutId: "checkout-1",
  registerId: REGISTER_ID,
  paymentMethod: "cash" as const,
  operatorId: "user-7",
  operatorRole: 4,
  operatorRestaurantId: "restaurant-1" as string | number | null | undefined,
};

function writesOf(prepare: ReturnType<typeof createEnv>["prepare"]) {
  return prepare.mock.calls
    .map(([sql]) => sql.toLowerCase())
    .filter((sql) => /^\s*(insert|update|delete)/.test(sql));
}

describe("MarketCheckoutPOSPaymentService refusals", () => {
  it("404s for an unknown checkout", async () => {
    const { env, prepare } = createEnv({ session: null });
    await expect(
      new MarketCheckoutPOSPaymentService(env).process(baseInput),
    ).rejects.toMatchObject({ status: 404 });
    expect(writesOf(prepare)).toEqual([]);
  });

  it("returns an already paid checkout as-is without writing again", async () => {
    const summary = { status: "paid", totalAmountCents: 20000 };
    const { env, prepare } = createEnv({
      session: buildSession({
        payment_status: "paid",
        payment_summary: JSON.stringify(summary),
      }),
    });

    const result = await new MarketCheckoutPOSPaymentService(env).process(
      baseInput,
    );

    expect(result.alreadyPaid).toBe(true);
    expect(result.payment).toEqual(summary);
    expect(writesOf(prepare)).toEqual([]);
    expect(env.CACHE_KV.put).not.toHaveBeenCalled();
  });

  it("refuses a checkout with no child orders", async () => {
    const { env, prepare } = createEnv({ children: [] });
    await expect(
      new MarketCheckoutPOSPaymentService(env).process(baseInput),
    ).rejects.toMatchObject({ status: 400 });
    expect(writesOf(prepare)).toEqual([]);
  });

  it("refuses when the register has no active shift", async () => {
    const { env, prepare } = createEnv({ shift: null });
    await expect(
      new MarketCheckoutPOSPaymentService(env).process(baseInput),
    ).rejects.toMatchObject({
      status: 400,
      message: "Active POS shift not found for register",
    });
    expect(writesOf(prepare)).toEqual([]);
  });

  it.each([undefined, null])(
    "refuses a non-admin operator with no restaurant (%s)",
    async (operatorRestaurantId) => {
      const { env, prepare } = createEnv({});
      await expect(
        new MarketCheckoutPOSPaymentService(env).process({
          ...baseInput,
          operatorRestaurantId,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(writesOf(prepare)).toEqual([]);
    },
  );

  it("refuses an operator using another restaurant's register", async () => {
    const { env, prepare } = createEnv({});
    await expect(
      new MarketCheckoutPOSPaymentService(env).process({
        ...baseInput,
        operatorRestaurantId: "restaurant-9",
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Cannot use a POS register outside your restaurant",
    });
    expect(writesOf(prepare)).toEqual([]);
  });

  it("refuses a register whose restaurant is not a vendor in this checkout", async () => {
    const { env, prepare } = createEnv({
      children: [
        buildChild("restaurant-2", 1002),
        buildChild("restaurant-3", 1003),
      ],
    });
    await expect(
      new MarketCheckoutPOSPaymentService(env).process(baseInput),
    ).rejects.toMatchObject({
      status: 403,
      message:
        "POS register restaurant is not a vendor in this market checkout",
    });
    expect(writesOf(prepare)).toEqual([]);
  });

  it("lets a platform admin use any register", async () => {
    const { env } = createEnv({ children: [buildChild("restaurant-2", 1002)] });
    const result = await new MarketCheckoutPOSPaymentService(env).process({
      ...baseInput,
      operatorRole: 0,
      operatorRestaurantId: undefined,
    });
    expect(result.alreadyPaid).toBe(false);
  });
});

describe("MarketCheckoutPOSPaymentService cache refresh", () => {
  it("leaves the cache alone when there is no cached session or index", async () => {
    const { env } = createEnv({});
    await new MarketCheckoutPOSPaymentService(env).process(baseInput);
    expect(env.CACHE_KV.put).not.toHaveBeenCalled();
  });

  it("ignores a cached index that is not a list and leaves other entries untouched", async () => {
    const odd = createEnv({
      kv: { "market_checkout:index": '{"not":"a list"}' },
    });
    await new MarketCheckoutPOSPaymentService(odd.env).process(baseInput);
    expect(odd.env.CACHE_KV.put).not.toHaveBeenCalled();

    const mixed = createEnv({
      kv: {
        "market_checkout:index": JSON.stringify([
          null,
          { id: "other", paymentStatus: "pending" },
          { id: "checkout-1", paymentStatus: "pending" },
        ]),
      },
    });
    await new MarketCheckoutPOSPaymentService(mixed.env).process(baseInput);

    const [, written] = vi.mocked(mixed.env.CACHE_KV.put).mock.calls[0] as [
      string,
      string,
    ];
    expect(JSON.parse(written)).toEqual([
      null,
      { id: "other", paymentStatus: "pending" },
      expect.objectContaining({ id: "checkout-1", paymentStatus: "paid" }),
    ]);
  });
});
