import { AnalyticsService, customers } from "@makanmasak/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";

/**
 * `averageOrdersPerCustomer` and `customerLifetimeValue` were raw `sql`
 * subqueries with no restaurant predicate, so they averaged over every tenant
 * on the platform while every sibling metric in the same payload was scoped.
 * Nothing caught it because production had zero attributed orders — #294 is
 * what makes it reachable.
 *
 * This has to run against real D1. A mocked drizzle cannot tell a query that
 * sets a WHERE from one that does not, which is the whole failure mode here.
 */
describe("Customer analytics — tenant isolation", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  }, 60_000);

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  afterAll(async () => {
    await testApp?.dispose();
  });

  async function customer(displayName: string) {
    const [row] = await testApp.testDb.drizzle
      .insert(customers)
      .values({ displayName, status: "active" })
      .returning({ id: customers.id });
    return row!.id;
  }

  it("scopes per-customer rollups to the requested restaurant", async () => {
    const mine = await seed.restaurant({ name: "analytics-mine" });
    const theirs = await seed.restaurant({ name: "analytics-theirs" });
    const myCustomer = await customer("Mine");
    const theirCustomer = await customer("Theirs");

    // One customer here, 3 collected orders of NT$120 each.
    for (let i = 0; i < 3; i += 1) {
      await seed.order(String(mine.id), {
        customerId: myCustomer,
        status: "paid",
        paymentStatus: "completed",
      });
    }
    // A much heavier customer at the other restaurant. If either rollup leaks,
    // these rows drag both averages away from the values asserted below.
    for (let i = 0; i < 12; i += 1) {
      await seed.order(String(theirs.id), {
        customerId: theirCustomer,
        status: "paid",
        paymentStatus: "completed",
        totalAmountCents: 900_00,
      });
    }

    const analytics = new AnalyticsService(testApp.env.DB, testApp.env);
    const result = await analytics.getCustomerAnalytics({
      restaurantId: String(mine.id),
    });

    // 3 orders / 1 customer, and 3 × NT$120 of lifetime spend — both computed
    // from this restaurant's rows only.
    expect(result.averageOrdersPerCustomer).toBe(3);
    expect(result.customerLifetimeValue).toBe(360);
    // One person, three orders. `totalCustomers` used to count order rows, so
    // this read 3 and `returningCustomers` read 2 for a single-customer shop.
    expect(result.totalCustomers).toBe(1);
    expect(result.returningCustomers).toBe(0);
    expect(result.topCustomers).toHaveLength(1);
    expect(result.topCustomers[0]).toMatchObject({
      customerId: myCustomer,
      totalOrders: 3,
    });
  });

  it("keeps the rollups inside the requested date range", async () => {
    const restaurant = await seed.restaurant({ name: "analytics-dates" });
    const regular = await customer("Regular");
    const inRange = new Date("2026-08-15T00:00:00Z");
    const outOfRange = new Date("2026-06-01T00:00:00Z");

    await seed.order(String(restaurant.id), {
      customerId: regular,
      status: "paid",
      paymentStatus: "completed",
      createdAt: inRange,
    });
    for (let i = 0; i < 5; i += 1) {
      await seed.order(String(restaurant.id), {
        customerId: regular,
        status: "paid",
        paymentStatus: "completed",
        createdAt: outOfRange,
        totalAmountCents: 500_00,
      });
    }

    const analytics = new AnalyticsService(testApp.env.DB, testApp.env);
    const result = await analytics.getCustomerAnalytics({
      restaurantId: String(restaurant.id),
      dateFrom: "2026-08-01T00:00:00Z",
      dateTo: "2026-08-31T23:59:59Z",
    });

    expect(result.averageOrdersPerCustomer).toBe(1);
    expect(result.customerLifetimeValue).toBe(120);
  });

  it("excludes uncollected and cancelled orders from lifetime value but not from order count", async () => {
    const restaurant = await seed.restaurant({ name: "analytics-statuses" });
    const buyer = await customer("Buyer");

    await seed.order(String(restaurant.id), {
      customerId: buyer,
      status: "paid",
      paymentStatus: "completed",
    });
    await seed.order(String(restaurant.id), {
      customerId: buyer,
      status: "cancelled",
      paymentStatus: "completed",
      totalAmountCents: 999_00,
    });
    await seed.order(String(restaurant.id), {
      customerId: buyer,
      status: "delivered",
      paymentStatus: "pending",
      totalAmountCents: 500_00,
    });

    const analytics = new AnalyticsService(testApp.env.DB, testApp.env);
    const result = await analytics.getCustomerAnalytics({
      restaurantId: String(restaurant.id),
    });

    // Count every order, but recognise only collected, non-cancelled revenue.
    expect(result.averageOrdersPerCustomer).toBe(3);
    expect(result.customerLifetimeValue).toBe(120);
  });
});
