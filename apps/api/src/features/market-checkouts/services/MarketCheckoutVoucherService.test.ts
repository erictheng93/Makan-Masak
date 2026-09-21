import { afterEach, describe, it, expect, vi } from "vitest";
import {
  MarketCheckoutVoucherService,
  combineAppliedMarketCheckoutVouchers,
  listAppliedMarketCheckoutVouchers,
  redeemCachedMarketCheckoutVoucher,
  totalAppliedVoucherDiscountCents,
} from "./MarketCheckoutVoucherService";
import {
  coupons,
  couponUsage,
  marketCheckoutChildOrders,
  marketCheckoutSessions,
} from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";

/**
 * Select fixtures are keyed by table, not by call order: `from(table)`
 * decides which queue a query draws from, so adding a query against one
 * table can no longer shift another table's results out from under it.
 *
 * Two things still need care when the code under test grows a new query:
 *
 * - Within a single table the queue is positional. The Nth read of a table
 *   takes that table's Nth fixture, so a new query means inserting a fixture
 *   at the matching index rather than appending one at the end.
 * - A table has to be listed in `fixtureTables` before it can be declared. An
 *   unregistered table matches no queue, so every read of it throws.
 *
 * Missing and exhausted fixtures both throw and name the table. Nothing
 * falls back to `[]`/`undefined`; a silent empty/undefined result is exactly
 * what let the old `makeRefundUnitService`'s positional
 * `selectRows.shift() ?? []` queue mis-route one test's `usageRows` behind a
 * skipped `childRows` read without the test ever failing.
 *
 * `MarketCheckoutVoucherService` terminates its selects with `.get()`
 * (single row, or `undefined` when the fixture entry is `[]`) or `.all()`
 * (the whole array) instead of awaiting the builder directly. Both consume
 * the next fixture queued for the table passed to `from()` — `.get()` just
 * takes index 0 of it.
 *
 * `coupons` (`validateAndPrice`), `couponUsage` (`redeem`,
 * `getFullyRefundedVoucherClaimOrderId`), and `marketCheckoutChildOrders`
 * (`resolveRefundOrderGroups` — twice: unconditionally for `checkoutRows`,
 * then again for `childRows` only when `checkoutRows` produced a
 * `checkoutId`) are all read via `db.select` somewhere in this service, so
 * all three are registered below. `marketCheckoutSessions` is also read in
 * production (by the free function `readPersistedAppliedMarketCheckoutVoucher`),
 * but that function builds its own `drizzle(env.DB)` from a raw D1 binding —
 * the `redeemCachedMarketCheckoutVoucher` tests below exercise that path
 * through `env.DB.prepare(...).bind(...)` mocks, never through this file's
 * `db.select().from()` harness. It is imported only so the regression test
 * has a real, unregistered table to demonstrate the "<unknown table>" case.
 *
 * None of the selects covered by this harness are wrapped in try/catch:
 * `redeem`'s only try/catch wraps the per-allocation `insert`, after its
 * select has already resolved, and `markRefunded` / `resolveRefundOrderGroups`
 * / `getFullyRefundedVoucherClaimOrderId` have no try/catch at all. A harness
 * throw from a missing/exhausted select fixture therefore always surfaces as
 * a rejected promise from the awaited service call — no route/envelope
 * caveat applies in this file, since these tests call service methods
 * directly rather than going through an HTTP route.
 */
const fixtureTables = {
  coupons,
  couponUsage,
  marketCheckoutChildOrders,
};
type SelectFixtureName = keyof typeof fixtureTables;

function createSelectMock(fixtures: SelectFixtures<SelectFixtureName> = {}) {
  const fixtureDb = createSelectFixtureDb(fixtureTables, fixtures);
  return fixtureDb.select;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("select fixture harness", () => {
  it("routes select fixtures by table and reports missing fixtures", async () => {
    const select = createSelectMock({
      coupons: [[{ id: 7, code: "SAVE10" }]],
      couponUsage: [[{ orderId: 1001 }], [{ orderId: 1002 }]],
    });
    const db = { select };

    // Read in reverse declaration order: routing follows the table passed to
    // from(), not the execution order.
    await expect(db.select().from(couponUsage).all()).resolves.toEqual([
      { orderId: 1001 },
    ]);
    await expect(db.select().from(coupons).get()).resolves.toEqual({
      id: 7,
      code: "SAVE10",
    });
    await expect(db.select().from(couponUsage).all()).resolves.toEqual([
      { orderId: 1002 },
    ]);
    await expect(db.select().from(couponUsage).all()).rejects.toThrow(
      "No select fixtures remaining for couponUsage",
    );
    // marketCheckoutSessions is read only via the raw D1 prepare/bind mocks
    // in the redeemCachedMarketCheckoutVoucher tests below, never through
    // this db.select().from() harness, so it stays out of fixtureTables and
    // reports <unknown table>.
    await expect(
      db.select().from(marketCheckoutSessions).get(),
    ).rejects.toThrow("Missing select fixture for <unknown table>");
  });
});

describe("MarketCheckoutVoucherService.computeDiscountCents", () => {
  it("computes a percentage discount", () => {
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        {
          discountType: "percentage",
          discountPercentageBps: 1000,
          discountValueCents: null,
          maxDiscountAmountCents: null,
        },
        24000,
        "TWD",
      ),
    ).toBe(2400);
  });

  it("computes a percentage discount from basis points when present", () => {
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        {
          discountType: "percentage",
          discountPercentageBps: 1250,
          discountValueCents: 9999,
          maxDiscountAmountCents: null,
        },
        24000,
        "TWD",
      ),
    ).toBe(3000);
  });

  it("caps a percentage discount at the max discount amount", () => {
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        {
          discountType: "percentage",
          discountPercentageBps: 5000,
          discountValueCents: null,
          maxDiscountAmountCents: 5000,
        },
        24000,
        "TWD",
      ),
    ).toBe(5000);
  });

  it("applies a fixed discount in cents", () => {
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        {
          discountType: "fixed",
          discountValueCents: 3000,
          maxDiscountAmountCents: null,
        },
        24000,
        "TWD",
      ),
    ).toBe(3000);
  });

  it("clamps a discount larger than the subtotal", () => {
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        {
          discountType: "fixed",
          discountValueCents: 30000,
          maxDiscountAmountCents: null,
        },
        24000,
        "TWD",
      ),
    ).toBe(24000);
  });

  it("returns zero for a non-positive subtotal", () => {
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        {
          discountType: "percentage",
          discountPercentageBps: 1000,
          discountValueCents: null,
          maxDiscountAmountCents: null,
        },
        0,
        "TWD",
      ),
    ).toBe(0);
  });
});

describe("MarketCheckoutVoucherService.computeDiscountCents currency precision", () => {
  const percentage = (bps: number, max: number | null = null) => ({
    discountType: "percentage" as const,
    discountPercentageBps: bps,
    discountValueCents: null,
    maxDiscountAmountCents: max,
  });

  it("rounds a TWD percentage discount to whole dollars", () => {
    // 15% of NT$103 = NT$15.45 -> NT$15; 15% of NT$117 = NT$17.55 -> NT$18.
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        percentage(1500),
        10300,
        "TWD",
      ),
    ).toBe(1500);
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        percentage(1500),
        11700,
        "TWD",
      ),
    ).toBe(1800);
  });

  it("keeps MYR sen", () => {
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        percentage(1500),
        10300,
        "MYR",
      ),
    ).toBe(1545);
  });

  it("rounds a VND percentage discount to whole dong", () => {
    // 7% of ₫12,345 = ₫864.15 -> ₫864.
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        percentage(700),
        1234500,
        "VND",
      ),
    ).toBe(86400);
  });

  it("never gives more than an off-step cap or fixed value", () => {
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        percentage(5000, 1050),
        24000,
        "TWD",
      ),
    ).toBe(1000);
    expect(
      MarketCheckoutVoucherService.computeDiscountCents(
        {
          discountType: "fixed",
          discountValueCents: 1050,
          maxDiscountAmountCents: null,
        },
        24000,
        "TWD",
      ),
    ).toBe(1000);
  });
});

describe("MarketCheckoutVoucherService.splitDiscount", () => {
  it("splits proportionally by child amount", () => {
    const allocations = MarketCheckoutVoucherService.splitDiscount(
      2400,
      [
        { orderId: "1", amountCents: 16000 },
        { orderId: "2", amountCents: 8000 },
      ],
      "TWD",
    );
    expect(allocations).toEqual([
      { orderId: "1", amountCents: 16000, discountCents: 1600 },
      { orderId: "2", amountCents: 8000, discountCents: 800 },
    ]);
  });

  it("keeps every TWD share on whole dollars (no NT$33.33 shares)", () => {
    // NT$100 over three equal stalls: 34 / 33 / 33, not 33.33 each.
    const allocations = MarketCheckoutVoucherService.splitDiscount(
      10000,
      [
        { orderId: "1", amountCents: 20000 },
        { orderId: "2", amountCents: 20000 },
        { orderId: "3", amountCents: 20000 },
      ],
      "TWD",
    );
    expect(allocations.map((a) => a.discountCents)).toEqual([3400, 3300, 3300]);
  });

  it("splits VND on whole dong", () => {
    const allocations = MarketCheckoutVoucherService.splitDiscount(
      1000000,
      [
        { orderId: "1", amountCents: 6000000 },
        { orderId: "2", amountCents: 3000000 },
      ],
      "VND",
    );
    expect(allocations.map((a) => a.discountCents)).toEqual([666700, 333300]);
    expect(allocations.every((a) => a.discountCents % 100 === 0)).toBe(true);
  });

  it("always sums to the full discount (MYR keeps sen)", () => {
    const allocations = MarketCheckoutVoucherService.splitDiscount(
      777,
      [
        { orderId: "1", amountCents: 1234 },
        { orderId: "2", amountCents: 5678 },
        { orderId: "3", amountCents: 9012 },
      ],
      "MYR",
    );
    const total = allocations.reduce((sum, a) => sum + a.discountCents, 0);
    expect(total).toBe(777);
  });

  it("assigns no discount when the subtotal is zero", () => {
    const allocations = MarketCheckoutVoucherService.splitDiscount(
      500,
      [
        { orderId: "1", amountCents: 0 },
        { orderId: "2", amountCents: 0 },
      ],
      "TWD",
    );
    expect(allocations.every((a) => a.discountCents === 0)).toBe(true);
  });
});

describe("market checkout stacked voucher helpers", () => {
  const platformVoucher = {
    couponId: 1,
    code: "PLATFORM10",
    name: "Platform 10",
    fundedBy: "platform" as const,
    discountCents: 1000,
    allocations: [
      { orderId: "1", amountCents: 6000, discountCents: 600 },
      { orderId: "2", amountCents: 4000, discountCents: 400 },
    ],
  };
  const vendorVoucher = {
    couponId: 2,
    code: "SHOP50",
    name: "Shop 50",
    fundedBy: "vendor" as const,
    discountCents: 500,
    allocations: [{ orderId: "2", amountCents: 3600, discountCents: 500 }],
  };

  it("combines multiple vouchers into aggregate allocations", () => {
    const bundle = combineAppliedMarketCheckoutVouchers([
      platformVoucher,
      vendorVoucher,
    ]);

    expect(bundle).toMatchObject({
      discountCents: 1500,
      vouchers: [platformVoucher, vendorVoucher],
      allocations: [
        { orderId: "1", amountCents: 6000, discountCents: 600 },
        { orderId: "2", amountCents: 4000, discountCents: 900 },
      ],
    });
  });

  it("normalizes legacy single vouchers and stacked voucher bundles", () => {
    expect(listAppliedMarketCheckoutVouchers(platformVoucher)).toEqual([
      platformVoucher,
    ]);

    const bundle = combineAppliedMarketCheckoutVouchers([
      platformVoucher,
      vendorVoucher,
    ]);
    expect(listAppliedMarketCheckoutVouchers(bundle)).toEqual([
      platformVoucher,
      vendorVoucher,
    ]);
  });

  it("returns no vouchers and zero discount for empty applied values", () => {
    expect(listAppliedMarketCheckoutVouchers(null)).toEqual([]);
    expect(listAppliedMarketCheckoutVouchers(undefined)).toEqual([]);
    expect(combineAppliedMarketCheckoutVouchers([])).toBeUndefined();
    expect(totalAppliedVoucherDiscountCents(undefined)).toBe(0);
    expect(totalAppliedVoucherDiscountCents(platformVoucher)).toBe(1000);
  });
});

describe("redeemCachedMarketCheckoutVoucher", () => {
  it("redeems a valid cached stacked voucher bundle without querying persistence", async () => {
    const redeemSpy = vi
      .spyOn(MarketCheckoutVoucherService.prototype, "redeem")
      .mockResolvedValue();
    const cachedBundle = {
      appliedVoucher: {
        vouchers: [
          {
            couponId: 1,
            code: "PLATFORM10",
            name: "Platform 10",
            discountCents: 1000,
            allocations: [
              {
                orderId: "019d0000-0000-7000-8000-000000000001",
                amountCents: 10000,
                discountCents: 1000,
              },
            ],
          },
          {
            couponId: 2,
            code: "SHOP50",
            name: "Shop 50",
            restaurantId: "rest-1",
            discountCents: 500,
            allocations: [
              {
                orderId: "019d0000-0000-7000-8000-000000000002",
                amountCents: 5000,
                discountCents: 500,
              },
            ],
          },
        ],
      },
    };
    const env = {
      CACHE_KV: {
        get: vi.fn(async () => JSON.stringify(cachedBundle)),
      },
      DB: {
        prepare: vi.fn(),
      },
    };

    await redeemCachedMarketCheckoutVoucher(env as never, "checkout-1");

    expect(env.CACHE_KV.get).toHaveBeenCalledWith("market_checkout:checkout-1");
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect(redeemSpy).toHaveBeenCalledTimes(2);
    expect(redeemSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ couponId: 1, fundedBy: "platform" }),
    );
    expect(redeemSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ couponId: 2, fundedBy: "vendor" }),
    );
    redeemSpy.mockRestore();
  });

  it("redeems a persisted voucher when the cached checkout session has expired", async () => {
    const redeemSpy = vi
      .spyOn(MarketCheckoutVoucherService.prototype, "redeem")
      .mockResolvedValueOnce();
    const appliedVoucher = {
      couponId: 42,
      code: "ASYNC10",
      name: "ASYNC10",
      discountCents: 2400,
      allocations: [
        {
          orderId: "019d0000-0000-7000-8000-000000000001",
          amountCents: 16000,
          discountCents: 1600,
        },
        {
          orderId: "019d0000-0000-7000-8000-000000000002",
          amountCents: 8000,
          discountCents: 800,
        },
      ],
    };
    const env = {
      CACHE_KV: {
        get: vi.fn(async () => null),
      },
      DB: {
        prepare: vi.fn((_sql: string) => ({
          bind: vi.fn(() => ({
            raw: vi.fn(async () => [[JSON.stringify(appliedVoucher)]]),
            first: vi.fn(async () => ({
              applied_voucher: JSON.stringify(appliedVoucher),
            })),
          })),
        })),
      },
    };

    await redeemCachedMarketCheckoutVoucher(env as never, "checkout-1");

    expect(
      vi
        .mocked(env.DB.prepare)
        .mock.calls.some(
          ([sql]) =>
            sql.toLowerCase().includes("select") &&
            sql.includes("applied_voucher"),
        ),
    ).toBe(true);
    expect(redeemSpy).toHaveBeenCalledWith({
      ...appliedVoucher,
      fundedBy: "platform",
      restaurantId: undefined,
    });
    redeemSpy.mockRestore();
  });

  it("ignores malformed cached and persisted voucher payloads", async () => {
    const redeemSpy = vi
      .spyOn(MarketCheckoutVoucherService.prototype, "redeem")
      .mockResolvedValueOnce();
    const env = {
      CACHE_KV: {
        get: vi.fn(async () => "{invalid json"),
      },
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            raw: vi.fn(async () => [["{invalid json"]]),
            first: vi.fn(async () => ({ applied_voucher: "{invalid json" })),
          })),
        })),
      },
    };

    await redeemCachedMarketCheckoutVoucher(env as never, "checkout-1");

    expect(redeemSpy).not.toHaveBeenCalled();
    redeemSpy.mockRestore();
  });

  it("swallows async voucher redemption failures", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const redeemSpy = vi
      .spyOn(MarketCheckoutVoucherService.prototype, "redeem")
      .mockRejectedValueOnce(new Error("redeem failed"));
    const env = {
      CACHE_KV: {
        get: vi.fn(async () =>
          JSON.stringify({
            appliedVoucher: {
              couponId: 1,
              code: "FAIL",
              name: "Fail",
              discountCents: 100,
              allocations: [
                {
                  orderId: "019d0000-0000-7000-8000-000000000001",
                  amountCents: 1000,
                  discountCents: 100,
                },
              ],
            },
          }),
        ),
      },
      DB: { prepare: vi.fn() },
    };

    await redeemCachedMarketCheckoutVoucher(env as never, "checkout-1");

    expect(consoleError).toHaveBeenCalledWith(
      "Voucher redemption failed for async market checkout checkout-1:",
      expect.any(Error),
    );
    redeemSpy.mockRestore();
    consoleError.mockRestore();
  });
});

describe("MarketCheckoutVoucherService.validateAndPrice", () => {
  it("uses the +8 business date when checking voucher validity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T16:30:00.000Z"));
    const service = makeValidateUnitService({
      id: 7,
      code: "TODAY",
      name: "Today",
      restaurantId: null,
      deletedAt: null,
      isActive: true,
      isVisible: true,
      validFrom: new Date("2026-06-08T00:00:00.000Z"),
      validTo: new Date("2026-06-08T00:00:00.000Z"),
      usageLimit: null,
      usedCount: null,
      minOrderAmountCents: null,
      discountType: "fixed",
      discountValueCents: 500,
      maxDiscountAmountCents: null,
    });

    await expect(
      service.validateAndPrice({
        code: "today",
        subtotalCents: 1000,
        currency: "TWD" as const,
        childOrders: [
          { orderId: "1", restaurantId: "rest-1", amountCents: 1000 },
        ],
      }),
    ).resolves.toMatchObject({
      code: "TODAY",
      discountCents: 500,
    });
  });

  // #271. valid_from used to be TEXT compared straight against a YYYY-MM-DD
  // business date, so a voucher whose instant fell later on the same business
  // day sorted *after* the bare date and read as expired for that whole day.
  // Both ends are now mapped onto the shop's calendar before comparing.
  it("accepts a voucher whose start instant is later on today's business day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T16:30:00.000Z")); // 2026-06-08 00:30 +08
    const service = makeValidateUnitService({
      id: 9,
      code: "LATER-TODAY",
      name: "Later today",
      restaurantId: null,
      deletedAt: null,
      isActive: true,
      isVisible: true,
      validFrom: new Date("2026-06-08T10:00:00.000Z"), // 2026-06-08 18:00 +08
      validTo: new Date("2026-06-08T15:59:59.999Z"), // 2026-06-08 23:59 +08
      usageLimit: null,
      usedCount: null,
      minOrderAmountCents: null,
      discountType: "fixed",
      discountValueCents: 500,
      maxDiscountAmountCents: null,
    });

    await expect(
      service.validateAndPrice({
        code: "later-today",
        subtotalCents: 1000,
        currency: "TWD" as const,
        childOrders: [
          { orderId: "1", restaurantId: "rest-1", amountCents: 1000 },
        ],
      }),
    ).resolves.toMatchObject({
      code: "LATER-TODAY",
      discountCents: 500,
    });
  });

  it("prices platform vouchers across all child orders", async () => {
    const service = makeValidateUnitService({
      id: 7,
      code: "SAVE10",
      name: "Save 10",
      restaurantId: null,
      deletedAt: null,
      isActive: true,
      isVisible: true,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: new Date("2099-12-31T00:00:00.000Z"),
      usageLimit: 10,
      usedCount: 2,
      minOrderAmountCents: 1000,
      discountType: "percentage",
      discountPercentageBps: 1000,
      discountValueCents: null,
      maxDiscountAmountCents: 500,
    });

    await expect(
      service.validateAndPrice({
        code: " save10 ",
        subtotalCents: 5000,
        currency: "TWD" as const,
        childOrders: [
          { orderId: "1", restaurantId: "rest-1", amountCents: 3000 },
          { orderId: "2", restaurantId: "rest-2", amountCents: 2000 },
        ],
      }),
    ).resolves.toEqual({
      couponId: 7,
      code: "SAVE10",
      name: "Save 10",
      restaurantId: null,
      fundedBy: "platform",
      discountCents: 500,
      allocations: [
        { orderId: "1", amountCents: 3000, discountCents: 300 },
        { orderId: "2", amountCents: 2000, discountCents: 200 },
      ],
    });
  });

  it("prices vendor vouchers only against matching child orders", async () => {
    const service = makeValidateUnitService({
      id: 8,
      code: "SHOP50",
      name: "Shop 50",
      restaurantId: "rest-2",
      deletedAt: null,
      isActive: true,
      isVisible: true,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: new Date("2099-12-31T00:00:00.000Z"),
      usageLimit: null,
      usedCount: null,
      minOrderAmountCents: 1000,
      discountType: "fixed",
      discountValueCents: 500,
      maxDiscountAmountCents: null,
    });

    await expect(
      service.validateAndPrice({
        code: "shop50",
        subtotalCents: 7000,
        currency: "TWD" as const,
        childOrders: [
          { orderId: "1", restaurantId: "rest-1", amountCents: 3000 },
          { orderId: "2", restaurantId: "rest-2", amountCents: 4000 },
        ],
      }),
    ).resolves.toMatchObject({
      couponId: 8,
      fundedBy: "vendor",
      discountCents: 500,
      allocations: [{ orderId: "2", amountCents: 4000, discountCents: 500 }],
    });
  });

  it("rejects invalid voucher states with voucher-specific errors", async () => {
    await expect(
      // validateAndPrice throws on the empty code before it ever touches
      // db.select(), so no coupons fixture is registered here — the third
      // arg overrides makeValidateUnitService's default fixture, and any
      // stray select() call would throw "Missing select fixture for
      // coupons" instead of silently falling back.
      makeValidateUnitService(null, {}).validateAndPrice({
        code: "",
        subtotalCents: 1000,
        currency: "TWD" as const,
        childOrders: [{ orderId: "1", amountCents: 1000 }],
      }),
    ).rejects.toMatchObject({ code: "VOUCHER_CODE_REQUIRED" });

    await expect(
      makeValidateUnitService(null).validateAndPrice({
        code: "missing",
        subtotalCents: 1000,
        currency: "TWD" as const,
        childOrders: [{ orderId: "1", amountCents: 1000 }],
      }),
    ).rejects.toMatchObject({ code: "VOUCHER_NOT_FOUND" });

    await expect(
      makeValidateUnitService({
        id: 9,
        code: "OLD",
        name: "Old",
        restaurantId: null,
        deletedAt: null,
        isActive: true,
        isVisible: true,
        validFrom: new Date("2000-01-01T00:00:00.000Z"),
        validTo: new Date("2000-12-31T00:00:00.000Z"),
        usageLimit: null,
        usedCount: null,
        minOrderAmountCents: 0,
        discountType: "fixed",
        discountValueCents: 100,
        maxDiscountAmountCents: null,
      }).validateAndPrice({
        code: "old",
        subtotalCents: 1000,
        currency: "TWD" as const,
        childOrders: [{ orderId: "1", amountCents: 1000 }],
      }),
    ).rejects.toMatchObject({ code: "VOUCHER_EXPIRED" });
  });

  // 16:30 UTC is still 23:30 on the 6th in Ho Chi Minh but already 00:30 on
  // the 7th in Taipei. A voucher whose last valid day is the 6th is therefore
  // live at one shop and expired at the other, at the same instant (#329).
  it("expires a shop's voucher at that shop's midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T16:30:00.000Z"));

    const lastDayOfJune6 = {
      id: 11,
      code: "TONIGHT",
      name: "Tonight only",
      restaurantId: "rest-1",
      deletedAt: null,
      isActive: true,
      isVisible: true,
      validFrom: new Date("2026-06-01T00:00:00.000Z"),
      validTo: new Date("2026-06-06T00:00:00.000Z"),
      usageLimit: null,
      usedCount: null,
      minOrderAmountCents: 0,
      discountType: "fixed",
      discountValueCents: 100,
      maxDiscountAmountCents: null,
    };
    const checkout = {
      code: "tonight",
      subtotalCents: 1000,
      currency: "TWD" as const,
      childOrders: [
        { orderId: "1", restaurantId: "rest-1", amountCents: 1000 },
      ],
    };

    await expect(
      makeValidateUnitService(
        lastDayOfJune6,
        { coupons: [[lastDayOfJune6]] },
        7 * 60,
      ).validateAndPrice(checkout),
    ).resolves.toMatchObject({ couponId: 11 });

    await expect(
      makeValidateUnitService(
        lastDayOfJune6,
        { coupons: [[lastDayOfJune6]] },
        8 * 60,
      ).validateAndPrice(checkout),
    ).rejects.toMatchObject({ code: "VOUCHER_EXPIRED" });
  });
});

describe("MarketCheckoutVoucherService.redeem", () => {
  it("inserts missing usage rows and increments used_count for the claim row", async () => {
    const insertRun = vi.fn(async () => undefined);
    const couponUpdateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
    const service = makeRedeemUnitService(insertRun, couponUpdateRun);

    await service.redeem(appliedVoucherForRedeemRace());

    expect(insertRun).toHaveBeenCalledTimes(2);
    expect(couponUpdateRun).toHaveBeenCalledTimes(1);
  });

  it("does not increment used_count again for apply-time reserved vouchers", async () => {
    const insertRun = vi.fn(async () => undefined);
    const couponUpdateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
    const service = makeRedeemUnitService(insertRun, couponUpdateRun);

    await service.redeem({
      ...appliedVoucherForRedeemRace(),
      reservationStatus: "reserved",
      reservedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(insertRun).toHaveBeenCalledTimes(2);
    expect(couponUpdateRun).not.toHaveBeenCalled();
  });

  it("returns without writes when redemption is fully recorded or empty", async () => {
    const insertRun = vi.fn(async () => undefined);
    const couponUpdateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
    const service = makeRedeemUnitService(insertRun, couponUpdateRun, [
      { orderId: "1001" },
      { orderId: "1002" },
    ]);

    await service.redeem(appliedVoucherForRedeemRace());
    await service.redeem({
      couponId: 42,
      code: "EMPTY",
      name: "Empty",
      fundedBy: "platform",
      discountCents: 0,
      allocations: [],
    });

    expect(insertRun).not.toHaveBeenCalled();
    expect(couponUpdateRun).not.toHaveBeenCalled();
  });

  it("releases the claimed used_count when a concurrent duplicate insert loses the race", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const insertRun = vi.fn(async () => {
        throw new Error("UNIQUE constraint failed: coupon_usage.coupon_id");
      });
      const couponUpdateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
      const service = makeRedeemUnitService(insertRun, couponUpdateRun);

      await service.redeem(appliedVoucherForRedeemRace());

      expect(insertRun).toHaveBeenCalledTimes(2);
      expect(couponUpdateRun).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("releases the claimed used_count when only a non-claim usage row wins the race", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const insertRun = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("UNIQUE constraint failed: coupon_usage.coupon_id"),
        )
        .mockResolvedValueOnce(undefined);
      const couponUpdateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
      const service = makeRedeemUnitService(insertRun, couponUpdateRun);

      await service.redeem(appliedVoucherForRedeemRace());

      expect(insertRun).toHaveBeenCalledTimes(2);
      expect(couponUpdateRun).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects exhausted vouchers before writing usage rows", async () => {
    const insertRun = vi.fn(async () => undefined);
    const couponUpdateRun = vi.fn(async () => ({ meta: { changes: 0 } }));
    const service = makeRedeemUnitService(insertRun, couponUpdateRun);

    await expect(service.redeem(appliedVoucherForRedeemRace())).rejects.toThrow(
      "This voucher has been fully redeemed",
    );

    expect(insertRun).not.toHaveBeenCalled();
    expect(couponUpdateRun).toHaveBeenCalledTimes(1);
  });
});

describe("MarketCheckoutVoucherService reservations", () => {
  it("claims a usage slot when reserving an unreserved voucher", async () => {
    const couponUpdateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
    const service = makeReservationUnitService(couponUpdateRun);

    const reserved = await service.reserveUsage(appliedVoucherForRedeemRace());

    expect(couponUpdateRun).toHaveBeenCalledTimes(1);
    expect(reserved).toMatchObject({
      couponId: 42,
      code: "ASYNC10",
      reservationStatus: "reserved",
    });
    expect(reserved.reservedAt).toEqual(expect.any(String));
    expect(reserved.releasedAt).toBeUndefined();
  });

  it("does not claim another slot for an already reserved voucher", async () => {
    const couponUpdateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
    const service = makeReservationUnitService(couponUpdateRun);
    const voucher = {
      ...appliedVoucherForRedeemRace(),
      reservationStatus: "reserved" as const,
      reservedAt: "2026-06-13T00:00:00.000Z",
    };

    await expect(service.reserveUsage(voucher)).resolves.toBe(voucher);

    expect(couponUpdateRun).not.toHaveBeenCalled();
  });

  it("releases only reserved voucher slots", async () => {
    const couponUpdateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
    const service = makeReservationUnitService(couponUpdateRun);
    const reserved = {
      ...appliedVoucherForRedeemRace(),
      reservationStatus: "reserved" as const,
      reservedAt: "2026-06-13T00:00:00.000Z",
    };

    const released = await service.releaseReservation(reserved);
    await expect(service.releaseReservation(released)).resolves.toBe(released);

    expect(couponUpdateRun).toHaveBeenCalledTimes(1);
    expect(released).toMatchObject({
      couponId: 42,
      code: "ASYNC10",
      reservationStatus: "released",
    });
    expect(released.releasedAt).toEqual(expect.any(String));
  });
});

describe("MarketCheckoutVoucherService.markRefunded", () => {
  it("returns without writes when no order ids are provided", async () => {
    const updateRun = vi.fn(async () => undefined);
    const decrementRun = vi.fn(async () => undefined);
    // markRefunded returns before any db call when orderIds is empty, so no
    // select fixtures are registered at all.
    const service = makeRefundUnitService({
      releaseRows: [],
      updateRun,
      decrementRun,
    });

    await service.markRefunded({ couponId: 42, orderIds: [] });

    expect(updateRun).not.toHaveBeenCalled();
    expect(decrementRun).not.toHaveBeenCalled();
  });

  it("marks usage refunded and releases one used_count for fully refunded checkouts", async () => {
    const updateRun = vi.fn(async () => undefined);
    const decrementRun = vi.fn(async () => undefined);
    const service = makeRefundUnitService({
      selectFixtures: {
        // resolveRefundOrderGroups reads marketCheckoutChildOrders twice:
        // once for checkoutRows, then again for childRows because
        // checkoutRows produced a checkoutId.
        marketCheckoutChildOrders: [
          [{ checkoutId: "checkout-1", orderId: "1001" }],
          [
            { checkoutId: "checkout-1", orderId: "1001" },
            { checkoutId: "checkout-1", orderId: "1002" },
          ],
        ],
        couponUsage: [
          [
            { orderId: "1001", status: "refunded" },
            { orderId: "1002", status: "refunded" },
          ],
        ],
      },
      releaseRows: [{ id: 1 }],
      updateRun,
      decrementRun,
    });

    await service.markRefunded({
      couponId: 42,
      orderIds: ["1001", "1001"],
    });

    expect(updateRun).toHaveBeenCalledTimes(1);
    expect(decrementRun).toHaveBeenCalledTimes(1);
  });

  it("does not release used_count until every usage row is refunded", async () => {
    const updateRun = vi.fn(async () => undefined);
    const decrementRun = vi.fn(async () => undefined);
    const service = makeRefundUnitService({
      selectFixtures: {
        // checkoutRows is empty here, so resolveRefundOrderGroups never
        // issues the second (childRows) marketCheckoutChildOrders read —
        // only one fixture is queued for it.
        marketCheckoutChildOrders: [[]],
        couponUsage: [[{ orderId: "1001", status: "active" }]],
      },
      releaseRows: [],
      updateRun,
      decrementRun,
    });

    await service.markRefunded({
      couponId: 42,
      orderIds: ["1001"],
    });

    expect(updateRun).toHaveBeenCalledTimes(1);
    expect(decrementRun).not.toHaveBeenCalled();
  });
});

function makeValidateUnitService(
  coupon: unknown,
  fixtures: SelectFixtures<SelectFixtureName> = {
    coupons: [coupon == null ? [] : [coupon]],
  },
  // A shop's voucher expires at that shop's midnight (#329). The owning
  // restaurant's zone is a separate read in the real service; here it is
  // supplied directly so a test can vary the boundary without also having to
  // declare a restaurants fixture for every coupon shape.
  shopOffsetMinutes = 8 * 60,
) {
  const service = Object.create(MarketCheckoutVoucherService.prototype) as {
    db: {
      select: ReturnType<typeof vi.fn>;
    };
    businessTimezone: {
      offsetMinutes: (restaurantId: string) => Promise<number>;
    };
    validateAndPrice: MarketCheckoutVoucherService["validateAndPrice"];
  };
  service.db = {
    select: createSelectMock(fixtures),
  };
  service.businessTimezone = {
    offsetMinutes: async () => shopOffsetMinutes,
  };
  return service;
}

function makeRedeemUnitService(
  insertRun: ReturnType<typeof vi.fn>,
  couponUpdateRun: ReturnType<typeof vi.fn>,
  existingRows: Array<{ orderId: string }> = [],
) {
  const service = Object.create(MarketCheckoutVoucherService.prototype) as {
    db: {
      select: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    redeem: MarketCheckoutVoucherService["redeem"];
  };
  service.db = {
    select: createSelectMock({ couponUsage: [existingRows] }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: insertRun,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          run: couponUpdateRun,
        })),
      })),
    })),
  };
  return service;
}

function makeReservationUnitService(couponUpdateRun: ReturnType<typeof vi.fn>) {
  const service = Object.create(MarketCheckoutVoucherService.prototype) as {
    db: {
      update: ReturnType<typeof vi.fn>;
    };
    reserveUsage: MarketCheckoutVoucherService["reserveUsage"];
    releaseReservation: MarketCheckoutVoucherService["releaseReservation"];
  };
  service.db = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          run: couponUpdateRun,
        })),
      })),
    })),
  };
  return service;
}

function makeRefundUnitService(options: {
  selectFixtures?: SelectFixtures<SelectFixtureName>;
  releaseRows: Array<{ id: number }>;
  updateRun: ReturnType<typeof vi.fn>;
  decrementRun: ReturnType<typeof vi.fn>;
}) {
  let updateCall = 0;
  const service = Object.create(MarketCheckoutVoucherService.prototype) as {
    db: {
      select: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    markRefunded: MarketCheckoutVoucherService["markRefunded"];
  };
  service.db = {
    select: createSelectMock(options.selectFixtures),
    update: vi.fn(() => {
      updateCall += 1;
      if (updateCall === 1) {
        return {
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              run: options.updateRun,
            })),
          })),
        };
      }
      if (updateCall === 2) {
        return {
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn(async () => options.releaseRows),
            })),
          })),
        };
      }
      return {
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            run: options.decrementRun,
          })),
        })),
      };
    }),
  };
  return service;
}

function appliedVoucherForRedeemRace() {
  return {
    couponId: 42,
    code: "ASYNC10",
    name: "ASYNC10",
    fundedBy: "platform" as const,
    discountCents: 2400,
    allocations: [
      { orderId: "1001", amountCents: 16000, discountCents: 1600 },
      { orderId: "1002", amountCents: 8000, discountCents: 800 },
    ],
  };
}
