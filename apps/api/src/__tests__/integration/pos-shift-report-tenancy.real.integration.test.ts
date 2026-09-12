import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readEnvelope } from "../helpers/read-json";

/**
 * Shift report tenancy (audit finding 12).
 *
 * `ReportService.generateShiftReport` aggregated `orders` on a date range
 * alone — no restaurant predicate — so every cashier's shift report carried
 * the whole platform's revenue, order volume and payment mix. The only thing
 * masking it was a crash: `startedAt`/`endedAt` are `Date` objects and were
 * bound raw into a `sql` template, which D1 rejects with `D1_TYPE_ERROR`, so
 * the route answered 400. Fixing that 400 on its own would have switched the
 * leak on.
 *
 * Two entry points reach the aggregate: `GET /pos/shifts/:shiftId/report` and
 * `GET /pos/reports/export?type=shift&shiftId=…`. The export branch consumes
 * only `shiftId`, so the restaurant-scope check the handler runs above it does
 * nothing for that branch — it needed its own `requireShift`.
 *
 * Real D1 rather than a route/service unit test on purpose: the mocked unit
 * test hid the crash (its fake db ignores `where` and never type-checks a
 * binding), and a fake `where` cannot show that another restaurant's orders
 * stayed out of the totals.
 */
describe("POS shift report — tenancy and D1 binding", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    await testApp?.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  const CSRF = "a".repeat(64);

  function call(path: string, token: string, method = "GET", body?: unknown) {
    return testApp.app.fetch(
      new Request(`https://test/api/v1${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          host: "test",
          origin: "https://test",
          cookie: `csrf_token=${CSRF}`,
          "x-csrf-token": CSRF,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  /** `/pos/*` sits behind moduleGate("pos"), which 403s without a subscription. */
  async function insertActiveSubscription(restaurantId: string) {
    const now = Date.now();
    await testApp.env.DB.prepare(
      `INSERT INTO shop_subscriptions
         (id, restaurant_id, plan_tier, module_overrides,
          is_active, trial_ends_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'trial', '{}', 1, ?, ?, ?)`,
    )
      .bind(
        `sub-${restaurantId}`,
        restaurantId,
        now + 24 * 60 * 60 * 1000,
        now,
        now,
      )
      .run();
  }

  interface PosTenant {
    restaurantId: string;
    ownerToken: string;
    registerId: string;
    shiftId: string;
  }

  /**
   * Registers and shifts go through the API rather than raw inserts so the
   * register→shift→restaurant chain the report resolves is the one production
   * actually writes.
   */
  async function tenantWithOpenShift(prefix: string): Promise<PosTenant> {
    const restaurant = await seed.restaurant();
    const restaurantId = String(restaurant.id);
    await insertActiveSubscription(restaurantId);

    const owner = await seed.user({
      username: `${prefix}-owner`,
      role: 1,
      restaurantId,
    });
    const ownerToken = await testApp.authHelper.ownerToken(
      owner.id,
      restaurantId,
    );

    const registerRes = await call("/pos/registers", ownerToken, "POST", {
      name: `${prefix} Register`,
      restaurantId,
    });
    expect(registerRes.status).toBe(200);
    const register = await readData<{ id: string }>(registerRes);

    const shiftRes = await call("/pos/shifts/start", ownerToken, "POST", {
      registerId: register.id,
      operatorId: owner.id,
      startAmount: 100,
    });
    expect(shiftRes.status).toBe(200);
    const shift = await readData<{ id: string }>(shiftRes);

    return {
      restaurantId,
      ownerToken,
      registerId: register.id,
      shiftId: shift.id,
    };
  }

  /** Orders are seeded after the shift opens so they fall inside its window. */
  async function seedPaidOrder(
    restaurantId: string,
    totalAmountCents: number,
    paymentMethod: string,
  ) {
    return seed.order(restaurantId, {
      totalAmountCents,
      totalAmount: totalAmountCents / 100,
      subtotalCents: totalAmountCents,
      subtotal: totalAmountCents / 100,
      paymentMethod,
      paymentStatus: "completed",
      status: "paid",
      createdAt: new Date(),
    });
  }

  interface ShiftReportEnvelope {
    reportId: string;
    reportData: {
      summary: { totalSales: number };
      orderStats: {
        totalOrders: number;
        avgOrderValue: number;
        cashOrders: number;
        cardOrders: number;
        digitalOrders: number;
      };
    };
  }

  it("returns a shift report against real D1 and counts only the shift's own restaurant", async () => {
    const mine = await tenantWithOpenShift("own");

    // Mine: 2 orders, 300.00 total (1 cash, 1 card).
    await seedPaidOrder(mine.restaurantId, 10_000, "cash");
    await seedPaidOrder(mine.restaurantId, 20_000, "card");

    // Someone else's, in the exact same minute — the rows an unscoped
    // aggregate would have swept in.
    const other = await seed.restaurant();
    await seedPaidOrder(String(other.id), 777_700, "cash");
    await seedPaidOrder(String(other.id), 888_800, "digital_wallet");
    await seedPaidOrder(String(other.id), 999_900, "card");

    const res = await call(
      `/pos/shifts/${mine.shiftId}/report`,
      mine.ownerToken,
    );

    // Pre-fix this was 400 / D1_TYPE_ERROR: the Date bindings never reached
    // SQLite. Assert on the envelope's error so a regression names itself.
    const envelope = await readEnvelope<ShiftReportEnvelope>(res);
    expect(envelope.error?.message ?? "").not.toContain("D1_TYPE_ERROR");
    expect(res.status).toBe(200);

    const { orderStats, summary } = envelope.data!.reportData;
    expect(orderStats).toMatchObject({
      totalOrders: 2,
      cashOrders: 1,
      cardOrders: 1,
      digitalOrders: 0,
    });
    expect(summary.totalSales).toBe(300);
    expect(orderStats.avgOrderValue).toBe(150);
  });

  it("does not leak another restaurant's orders through the shift export branch", async () => {
    const attacker = await tenantWithOpenShift("attacker");
    const victim = await tenantWithOpenShift("victim");

    await seedPaidOrder(victim.restaurantId, 543_210, "cash");

    const res = await call(
      `/pos/reports/export?type=shift&shiftId=${victim.shiftId}`,
      attacker.ownerToken,
    );

    // Assert the payload before the status so a regression reports the leaked
    // figure rather than a bare status mismatch. 5432.10 is the victim's
    // takings as the aggregate renders them (SUM(cents) / 100).
    const body = await res.text();
    expect(body).not.toContain("5432.1");
    expect(body).not.toContain("543210");
    // The export branch reads only `shiftId`; the handler's own restaurant
    // scope check above it never applied here.
    expect(res.status).toBe(403);
  });

  it("still exports the caller's own shift report", async () => {
    const mine = await tenantWithOpenShift("self-export");
    await seedPaidOrder(mine.restaurantId, 45_000, "cash");

    const res = await call(
      `/pos/reports/export?type=shift&shiftId=${mine.shiftId}`,
      mine.ownerToken,
    );

    expect(res.status).toBe(200);
    const data = await readData<ShiftReportEnvelope>(res);
    expect(data.reportData.orderStats).toMatchObject({
      totalOrders: 1,
      cashOrders: 1,
    });
    expect(data.reportData.summary.totalSales).toBe(450);
  });

  // Takings are money collected (#354). Both reports used to sum every order
  // created in the window, so a served-but-unpaid order showed up as 今日業績 at
  // the till the moment the kitchen marked it delivered, and so did a cancelled
  // one.
  it("counts only settled orders in the daily and shift takings", async () => {
    const mine = await tenantWithOpenShift("takings");
    await seedPaidOrder(mine.restaurantId, 27_000, "cash");

    const unsettled = [
      { cents: 18_000, status: "delivered", paymentStatus: "pending" },
      { cents: 9_000, status: "cancelled", paymentStatus: "pending" },
      { cents: 12_000, status: "refunded", paymentStatus: "refunded" },
    ];
    for (const order of unsettled) {
      await seed.order(mine.restaurantId, {
        totalAmountCents: order.cents,
        totalAmount: order.cents / 100,
        subtotalCents: order.cents,
        subtotal: order.cents / 100,
        paymentMethod: "cash",
        paymentStatus: order.paymentStatus,
        status: order.status,
        createdAt: new Date(),
      });
    }

    // The report's `date` is the shop's calendar day; seed.restaurant keeps
    // the schema default of Asia/Taipei.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
    }).format(new Date());

    const dailyRes = await call(
      `/pos/reports/daily?date=${today}&restaurantId=${mine.restaurantId}`,
      mine.ownerToken,
    );
    expect(dailyRes.status).toBe(200);
    const daily = await readData<{
      summary: { totalOrders: number; totalSales: number };
      paymentBreakdown: { cashOrders: number };
    }>(dailyRes);
    expect(daily.summary).toMatchObject({ totalOrders: 1, totalSales: 270 });
    expect(daily.paymentBreakdown.cashOrders).toBe(1);

    const shiftRes = await call(
      `/pos/shifts/${mine.shiftId}/report`,
      mine.ownerToken,
    );
    expect(shiftRes.status).toBe(200);
    const shift = await readData<ShiftReportEnvelope>(shiftRes);
    expect(shift.reportData.summary.totalSales).toBe(270);
    expect(shift.reportData.orderStats.totalOrders).toBe(1);
  });
});
