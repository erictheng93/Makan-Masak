import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { customers, orders, restaurants, tables } from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { AnalyticsService } from "./analytics";

describe("AnalyticsService revenue analytics", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await testDb.drizzle.insert(restaurants).values({
      id: "analytics-restaurant",
      name: "Analytics Test Restaurant",
      type: "casual",
      category: "testing",
      address: "1 Test Road",
      district: "Test District",
      phone: "0912345678",
    });
  });

  it("returns prior-period revenue comparison when requested", async () => {
    await testDb.drizzle.insert(orders).values([
      order("current-1", "A-001", "2026-01-08T12:00:00.000Z", 15000),
      order("current-2", "A-002", "2026-01-09T12:00:00.000Z", 30000),
      order("previous-1", "A-003", "2026-01-06T12:00:00.000Z", 10000),
      order("previous-2", "A-004", "2026-01-07T12:00:00.000Z", 20000),
      order("cancelled", "A-005", "2026-01-07T13:00:00.000Z", 50000, {
        status: "cancelled",
      }),
    ]);

    const service = new AnalyticsService(testDb.bindings.DB, {} as never);

    const result = await service.getRevenueAnalytics({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-10T00:00:00.000Z",
      groupBy: "day",
      includeComparison: true,
    });

    expect(result).toEqual([
      {
        date: "2026-01-08",
        revenue: money(15000),
        orderCount: 1,
        averageOrderValue: money(15000),
        comparison: {
          previousRevenue: money(10000),
          growthRate: growth(50),
        },
      },
      {
        date: "2026-01-09",
        revenue: money(30000),
        orderCount: 1,
        averageOrderValue: money(30000),
        comparison: {
          previousRevenue: money(20000),
          growthRate: growth(50),
        },
      },
    ]);
  });

  it("keeps platform revenue in separate currency buckets", async () => {
    await testDb.drizzle.insert(restaurants).values({
      id: "analytics-myr-restaurant",
      name: "MYR Analytics Test Restaurant",
      type: "casual",
      category: "testing",
      address: "2 Test Road",
      district: "Test District",
      phone: "0912345679",
      settings: { currency: "MYR" },
    });
    await testDb.drizzle.insert(orders).values([
      order("twd-100", "TWD-001", "2026-01-08T12:00:00.000Z", 10000),
      order("myr-100", "MYR-001", "2026-01-08T13:00:00.000Z", 10000, {
        restaurantId: "analytics-myr-restaurant",
      }),
    ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getRevenueAnalytics({
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-09T00:00:00.000Z",
      groupBy: "day",
    });

    expect(result).toEqual([
      expect.objectContaining({
        date: "2026-01-08",
        revenue: [
          { currency: "TWD", amountCents: 10000 },
          { currency: "MYR", amountCents: 10000 },
        ],
      }),
    ]);
  });

  it("caps a platform query at `limit` date buckets, not `limit` currency rows", async () => {
    // Unscoped, the SQL limit is widened to three rows per date. With a single
    // currency that headroom must not leak out as extra dates (#407).
    await testDb.drizzle
      .insert(orders)
      .values([
        order("cap-1", "CAP-001", "2026-01-08T12:00:00.000Z", 10000),
        order("cap-2", "CAP-002", "2026-01-09T12:00:00.000Z", 10000),
        order("cap-3", "CAP-003", "2026-01-10T12:00:00.000Z", 10000),
      ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getRevenueAnalytics({
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-11T00:00:00.000Z",
      groupBy: "day",
      limit: 2,
    });

    expect(result.map((bucket) => bucket.date)).toEqual([
      "2026-01-08",
      "2026-01-09",
    ]);
  });

  it("counts only collected orders as revenue while keeping delivery fulfilled", async () => {
    await testDb.drizzle.insert(orders).values([
      order("unpaid-delivery", "R-001", "2026-01-08T12:00:00.000Z", 90000, {
        status: "delivered",
        paymentStatus: "pending",
        actualPrepTime: 12,
      }),
      order("collected", "R-002", "2026-01-08T13:00:00.000Z", 30000, {
        status: "paid",
        paymentStatus: "completed",
        paymentTransactionId: "payment-1",
        actualPrepTime: 18,
      }),
    ]);

    const service = new AnalyticsService(testDb.bindings.DB, {} as never);
    const revenue = await service.getRevenueAnalytics({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-09T00:00:00.000Z",
      groupBy: "day",
    });
    const operational = await service.getOrderAnalytics({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-09T00:00:00.000Z",
    });

    expect(revenue).toEqual([
      expect.objectContaining({
        revenue: money(30000),
        orderCount: 1,
        averageOrderValue: money(30000),
      }),
    ]);
    expect(operational).toMatchObject({
      totalRevenue: money(30000),
      averageOrderValue: money(30000),
      completedOrders: 2,
      averagePreparationTime: 15,
    });
  });

  it("reports a partial refund as the order's net collected revenue", async () => {
    await testDb.drizzle.insert(orders).values([
      order("partially-refunded", "R-003", "2026-01-08T12:00:00.000Z", 18000, {
        paymentStatus: "partial_refunded",
        refundAmountCents: 5000,
      }),
    ]);

    const service = new AnalyticsService(testDb.bindings.DB, {} as never);
    const revenue = await service.getRevenueAnalytics({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-09T00:00:00.000Z",
      groupBy: "day",
    });
    const operational = await service.getOrderAnalytics({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-09T00:00:00.000Z",
    });

    expect(revenue).toEqual([
      expect.objectContaining({
        revenue: money(13000),
        orderCount: 1,
        averageOrderValue: money(13000),
      }),
    ]);
    expect(operational).toMatchObject({
      totalRevenue: money(13000),
      averageOrderValue: money(13000),
    });
  });

  it("rounds a TWD average order value to a valid hundred-cent amount", async () => {
    await testDb.drizzle
      .insert(orders)
      .values([
        order(
          "twd-average-1",
          "TWD-AVG-001",
          "2026-01-08T12:00:00.000Z",
          15000,
        ),
        order(
          "twd-average-2",
          "TWD-AVG-002",
          "2026-01-08T12:01:00.000Z",
          16100,
        ),
      ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getRevenueAnalytics({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-09T00:00:00.000Z",
      groupBy: "day",
    });

    expect(result).toEqual([
      expect.objectContaining({
        revenue: money(31100),
        averageOrderValue: money(15600),
      }),
    ]);
  });

  it("buckets a UTC evening order into the following Taipei business day", async () => {
    await testDb.drizzle
      .insert(orders)
      .values([
        order("taipei-midnight", "TZ-001", "2026-01-08T17:00:00.000Z", 15000),
      ]);

    const service = new AnalyticsService(testDb.bindings.DB, {} as never);

    await expect(
      service.getRevenueAnalytics({
        restaurantId: "analytics-restaurant",
        groupBy: "day",
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({ date: "2026-01-09", revenue: money(15000) }),
    );
  });

  it("uses Taipei buckets for shifted explicit-range comparisons", async () => {
    await testDb.drizzle
      .insert(orders)
      .values([
        order("current-taipei", "TZ-101", "2026-01-09T17:00:00.000Z", 15000),
        order("previous-taipei", "TZ-100", "2026-01-08T17:00:00.000Z", 10000),
      ]);

    const service = new AnalyticsService(testDb.bindings.DB, {} as never);

    await expect(
      service.getRevenueAnalytics({
        restaurantId: "analytics-restaurant",
        dateFrom: "2026-01-09T16:00:00.000Z",
        dateTo: "2026-01-10T16:00:00.000Z",
        groupBy: "day",
        includeComparison: true,
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        date: "2026-01-10",
        revenue: money(15000),
        comparison: {
          previousRevenue: money(10000),
          growthRate: growth(50),
        },
      }),
    );
  });

  it("excludes current-period boundary orders from the prior period", async () => {
    await testDb.drizzle
      .insert(orders)
      .values([
        order("current-boundary", "B-001", "2026-01-08T00:00:00.000Z", 15000),
        order("previous-boundary", "B-002", "2026-01-06T00:00:00.000Z", 10000),
        order("current-end", "B-003", "2026-01-10T00:00:00.000Z", 50000),
      ]);

    const service = new AnalyticsService(testDb.bindings.DB, {} as never);

    const result = await service.getRevenueAnalytics({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-10T00:00:00.000Z",
      groupBy: "day",
      includeComparison: true,
    });

    expect(result).toEqual([
      {
        date: "2026-01-08",
        revenue: money(15000),
        orderCount: 1,
        averageOrderValue: money(15000),
        comparison: {
          previousRevenue: money(10000),
          growthRate: growth(50),
        },
      },
      {
        date: "2026-01-10",
        revenue: money(50000),
        orderCount: 1,
        averageOrderValue: money(50000),
        comparison: {
          previousRevenue: [],
          growthRate: growth(100),
        },
      },
    ]);
  });

  it("compares each day with the previous day when no date range is supplied", async () => {
    await testDb.drizzle
      .insert(orders)
      .values([
        order("daily-1", "C-001", "2026-01-08T12:00:00.000Z", 10000),
        order("daily-2", "C-002", "2026-01-09T12:00:00.000Z", 20000),
        order("daily-3", "C-003", "2026-01-10T12:00:00.000Z", 30000),
      ]);

    const service = new AnalyticsService(testDb.bindings.DB, {} as never);

    const result = await service.getRevenueAnalytics({
      restaurantId: "analytics-restaurant",
      groupBy: "day",
      includeComparison: true,
    });

    expect(result).toEqual([
      expect.objectContaining({
        date: "2026-01-08",
        comparison: {
          previousRevenue: [],
          growthRate: growth(100),
        },
      }),
      expect.objectContaining({
        date: "2026-01-09",
        comparison: {
          previousRevenue: money(10000),
          growthRate: growth(100),
        },
      }),
      expect.objectContaining({
        date: "2026-01-10",
        comparison: {
          previousRevenue: money(20000),
          growthRate: growth(50),
        },
      }),
    ]);
  });

  it.each([
    {
      groupBy: "week" as const,
      currentDate: "2026-01-12T12:00:00.000Z",
      previousDate: "2026-01-05T12:00:00.000Z",
      currentBucket: "2026-W02",
    },
    {
      groupBy: "month" as const,
      currentDate: "2026-03-15T12:00:00.000Z",
      previousDate: "2026-02-15T12:00:00.000Z",
      currentBucket: "2026-03",
    },
    {
      groupBy: "year" as const,
      currentDate: "2026-03-15T12:00:00.000Z",
      previousDate: "2025-03-15T12:00:00.000Z",
      currentBucket: "2026",
    },
  ])(
    "compares $groupBy buckets with their previous bucket when no date range is supplied",
    async ({ groupBy, currentDate, previousDate, currentBucket }) => {
      await testDb.drizzle
        .insert(orders)
        .values([
          order(`${groupBy}-current`, `${groupBy}-001`, currentDate, 30000),
          order(`${groupBy}-previous`, `${groupBy}-002`, previousDate, 20000),
        ]);

      const service = new AnalyticsService(testDb.bindings.DB, {} as never);

      const result = await service.getRevenueAnalytics({
        restaurantId: "analytics-restaurant",
        groupBy,
        includeComparison: true,
      });

      expect(result).toContainEqual(
        expect.objectContaining({
          date: currentBucket,
          revenue: money(30000),
          comparison: {
            previousRevenue: money(20000),
            growthRate: growth(50),
          },
        }),
      );
    },
  );
});

describe("AnalyticsService order analytics", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await testDb.drizzle.insert(restaurants).values({
      id: "analytics-restaurant",
      name: "Analytics Test Restaurant",
      type: "casual",
      category: "testing",
      address: "1 Test Road",
      district: "Test District",
      phone: "0912345678",
    });
  });

  const window = {
    restaurantId: "analytics-restaurant",
    dateFrom: "2026-01-08T00:00:00.000Z",
    dateTo: "2026-01-10T00:00:00.000Z",
  };

  it("keeps cancelled orders out of revenue while still counting them as orders", async () => {
    // The screen reported NT$1,185 across 7 orders while its own revenue
    // report, chart and CSV export all said NT$570 across 4 — the difference
    // being three cancellations counted as income (#312).
    await testDb.drizzle.insert(orders).values([
      order("paid-1", "A-001", "2026-01-08T12:00:00.000Z", 30000),
      order("paid-2", "A-002", "2026-01-09T12:00:00.000Z", 20000),
      order("cancelled-1", "A-003", "2026-01-08T13:00:00.000Z", 90000, {
        status: "cancelled",
      }),
    ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getOrderAnalytics(window);

    expect(result.totalRevenue).toEqual(money(50000));
    expect(result.averageOrderValue).toEqual(money(25000));

    // Order count deliberately keeps every order: it is the conversion rate's
    // denominator, and three of these were placed even though one was undone.
    expect(result.totalOrders).toBe(3);
    expect(result.cancelledOrders).toBe(1);
  });

  it("returns separate currency buckets for an unscoped performance query", async () => {
    await testDb.drizzle.insert(restaurants).values({
      id: "analytics-myr-restaurant",
      name: "MYR Analytics Test Restaurant",
      type: "casual",
      category: "testing",
      address: "2 Test Road",
      district: "Test District",
      phone: "0912345679",
      settings: { currency: "MYR" },
    });
    await testDb.drizzle.insert(orders).values([
      order("platform-twd", "P-TWD-001", "2026-01-08T12:00:00.000Z", 10000),
      order("platform-myr", "P-MYR-001", "2026-01-08T12:00:00.000Z", 10000, {
        restaurantId: "analytics-myr-restaurant",
      }),
    ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getOrderAnalytics({
      dateFrom: "2026-01-08T00:00:00.000Z",
      dateTo: "2026-01-09T00:00:00.000Z",
    });

    expect(result.totalRevenue).toEqual([
      { currency: "TWD", amountCents: 10000 },
      { currency: "MYR", amountCents: 10000 },
    ]);
    expect(result.averageOrderValue).toEqual(result.totalRevenue);
  });

  it("keeps platform customer spend and lifetime value in currency buckets", async () => {
    await testDb.drizzle.insert(restaurants).values({
      id: "analytics-myr-restaurant",
      name: "MYR Analytics Test Restaurant",
      type: "casual",
      category: "testing",
      address: "2 Test Road",
      district: "Test District",
      phone: "0912345679",
      settings: { currency: "MYR" },
    });
    const [customer] = await testDb.drizzle
      .insert(customers)
      .values({ displayName: "Platform Customer", status: "active" })
      .returning({ id: customers.id });
    await testDb.drizzle.insert(orders).values([
      order("customer-twd", "C-TWD-001", "2026-01-08T12:00:00.000Z", 10000, {
        customerId: customer!.id,
      }),
      order("customer-myr", "C-MYR-001", "2026-01-08T12:00:00.000Z", 10000, {
        restaurantId: "analytics-myr-restaurant",
        customerId: customer!.id,
      }),
    ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getCustomerAnalytics({});

    expect(result.customerLifetimeValue).toEqual([
      { currency: "TWD", amountCents: 10000 },
      { currency: "MYR", amountCents: 10000 },
    ]);
    expect(result.topCustomers).toEqual([
      expect.objectContaining({
        customerId: customer!.id,
        totalSpent: [
          { currency: "TWD", amountCents: 10000 },
          { currency: "MYR", amountCents: 10000 },
        ],
      }),
    ]);
  });

  it("averages customer lifetime value within each currency without mixing customers", async () => {
    await testDb.drizzle.insert(restaurants).values({
      id: "analytics-myr-restaurant",
      name: "MYR Analytics Test Restaurant",
      type: "casual",
      category: "testing",
      address: "2 Test Road",
      district: "Test District",
      phone: "0912345679",
      settings: { currency: "MYR" },
    });
    const [firstCustomer] = await testDb.drizzle
      .insert(customers)
      .values({ displayName: "First Customer", status: "active" })
      .returning({ id: customers.id });
    const [secondCustomer] = await testDb.drizzle
      .insert(customers)
      .values({ displayName: "Second Customer", status: "active" })
      .returning({ id: customers.id });

    await testDb.drizzle.insert(orders).values([
      order("first-twd", "MC-TWD-001", "2026-01-08T12:00:00.000Z", 10000, {
        customerId: firstCustomer!.id,
      }),
      order("first-myr", "MC-MYR-001", "2026-01-08T12:30:00.000Z", 30000, {
        restaurantId: "analytics-myr-restaurant",
        customerId: firstCustomer!.id,
      }),
      order("second-twd", "MC-TWD-002", "2026-01-08T13:00:00.000Z", 50000, {
        customerId: secondCustomer!.id,
      }),
    ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getCustomerAnalytics({ limit: 2 });

    // TWD is the average of 100 and 500, while only the first customer has
    // MYR spend. These figures must not be derived from their cross-currency
    // cents totals.
    expect(result.customerLifetimeValue).toEqual([
      { currency: "TWD", amountCents: 30000 },
      { currency: "MYR", amountCents: 30000 },
    ]);
    expect(result.topCustomers).toEqual([
      {
        customerId: firstCustomer!.id,
        customerName: "First Customer",
        totalOrders: 2,
        totalSpent: [
          { currency: "TWD", amountCents: 10000 },
          { currency: "MYR", amountCents: 30000 },
        ],
      },
      {
        customerId: secondCustomer!.id,
        customerName: "Second Customer",
        totalOrders: 1,
        totalSpent: [{ currency: "TWD", amountCents: 50000 }],
      },
    ]);
  });

  it("keeps a restaurant's top-customer ordering based on net spend", async () => {
    const [higherSpendCustomer] = await testDb.drizzle
      .insert(customers)
      .values({ displayName: "Higher Spend", status: "active" })
      .returning({ id: customers.id });
    const [moreOrdersCustomer] = await testDb.drizzle
      .insert(customers)
      .values({ displayName: "More Orders", status: "active" })
      .returning({ id: customers.id });

    await testDb.drizzle.insert(orders).values([
      order("spent-high", "TOP-SPEND-001", "2026-01-08T12:00:00.000Z", 30000, {
        customerId: higherSpendCustomer!.id,
      }),
      order("count-1", "TOP-COUNT-001", "2026-01-08T12:01:00.000Z", 10000, {
        customerId: moreOrdersCustomer!.id,
      }),
      order("count-2", "TOP-COUNT-002", "2026-01-08T12:02:00.000Z", 10000, {
        customerId: moreOrdersCustomer!.id,
      }),
    ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getCustomerAnalytics({
      restaurantId: "analytics-restaurant",
      limit: 1,
    });

    expect(result.topCustomers).toEqual([
      expect.objectContaining({
        customerId: higherSpendCustomer!.id,
        totalOrders: 1,
        totalSpent: money(30000),
      }),
    ]);
  });

  it("ranks top customers by all their currency buckets and returns every bucket", async () => {
    await testDb.drizzle.insert(restaurants).values([
      {
        id: "analytics-myr-restaurant",
        name: "MYR Analytics Test Restaurant",
        type: "casual",
        category: "testing",
        address: "2 Test Road",
        district: "Test District",
        phone: "0912345679",
        settings: { currency: "MYR" },
      },
      {
        id: "analytics-vnd-restaurant",
        name: "VND Analytics Test Restaurant",
        type: "casual",
        category: "testing",
        address: "3 Test Road",
        district: "Test District",
        phone: "0912345680",
        settings: { currency: "VND" },
      },
    ]);
    const [multiCurrencyCustomer] = await testDb.drizzle
      .insert(customers)
      .values({ displayName: "Multi Currency", status: "active" })
      .returning({ id: customers.id });
    const [singleCurrencyCustomer] = await testDb.drizzle
      .insert(customers)
      .values({ displayName: "Single Currency", status: "active" })
      .returning({ id: customers.id });

    const rankedOrders = [
      order("multi-twd-1", "TOP-TWD-001", "2026-01-08T12:00:00.000Z", 10000, {
        customerId: multiCurrencyCustomer!.id,
      }),
      order("multi-twd-2", "TOP-TWD-002", "2026-01-08T12:01:00.000Z", 10000, {
        customerId: multiCurrencyCustomer!.id,
      }),
      order("multi-myr-1", "TOP-MYR-001", "2026-01-08T12:02:00.000Z", 10000, {
        restaurantId: "analytics-myr-restaurant",
        customerId: multiCurrencyCustomer!.id,
      }),
      order("multi-myr-2", "TOP-MYR-002", "2026-01-08T12:03:00.000Z", 10000, {
        restaurantId: "analytics-myr-restaurant",
        customerId: multiCurrencyCustomer!.id,
      }),
      order("multi-vnd-1", "TOP-VND-001", "2026-01-08T12:04:00.000Z", 10000, {
        restaurantId: "analytics-vnd-restaurant",
        customerId: multiCurrencyCustomer!.id,
      }),
      order("multi-vnd-2", "TOP-VND-002", "2026-01-08T12:05:00.000Z", 10000, {
        restaurantId: "analytics-vnd-restaurant",
        customerId: multiCurrencyCustomer!.id,
      }),
      order(
        "single-twd-1",
        "TOP-SINGLE-001",
        "2026-01-08T12:06:00.000Z",
        10000,
        {
          customerId: singleCurrencyCustomer!.id,
        },
      ),
      order(
        "single-twd-2",
        "TOP-SINGLE-002",
        "2026-01-08T12:07:00.000Z",
        10000,
        {
          customerId: singleCurrencyCustomer!.id,
        },
      ),
      order(
        "single-twd-3",
        "TOP-SINGLE-003",
        "2026-01-08T12:08:00.000Z",
        10000,
        {
          customerId: singleCurrencyCustomer!.id,
        },
      ),
    ];
    // D1 permits no more than 100 bound parameters per statement. Keep this
    // fixture deliberately larger than one batch: it validates that platform
    // customer ranking preserves all currency buckets without relying on an
    // insert SQLite accepts but production D1 rejects.
    await testDb.drizzle.insert(orders).values(rankedOrders.slice(0, 4));
    await testDb.drizzle.insert(orders).values(rankedOrders.slice(4));

    await expect(
      new AnalyticsService(
        testDb.bindings.DB,
        {} as never,
      ).getCustomerAnalytics({
        limit: 1,
      }),
    ).resolves.toMatchObject({
      topCustomers: [
        {
          customerId: multiCurrencyCustomer!.id,
          totalOrders: 6,
          totalSpent: [
            { currency: "TWD", amountCents: 20000 },
            { currency: "MYR", amountCents: 20000 },
            { currency: "VND", amountCents: 20000 },
          ],
        },
      ],
    });
  });

  it("buckets popular time slots at the shop's hour, not UTC", async () => {
    // Measured against production on 2026-09-01: a Taipei shop whose orders
    // were placed at 09:48, 10:35, 10:54, 23:21, 23:38, 01:34 and 01:35 (+08)
    // had them reported as hours 1, 2, 2, 15, 15, 17, 17 -- uniformly eight
    // hours early -- and the dashboard announced a 16:00-18:00 peak to a shop
    // that had served nobody that afternoon (#290).
    await testDb.drizzle.insert(orders).values([
      // 20:00 and 21:00 Taipei: the evening peak a night market actually has.
      order("evening-1", "H-001", "2026-01-08T12:00:00.000Z", 10000),
      order("evening-2", "H-002", "2026-01-08T12:30:00.000Z", 10000),
      order("late-1", "H-003", "2026-01-08T13:00:00.000Z", 10000),
    ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getOrderAnalytics(window);

    expect(result.popularTimeSlots).toEqual([
      { hour: 20, orderCount: 2 },
      { hour: 21, orderCount: 1 },
    ]);
  });

  it("resolves the hour offset per restaurant rather than assuming +08", async () => {
    // #329 removed the implicit +8 from these helpers precisely because it
    // mis-bucketed shops that had chosen another zone. Tokyo is +09, so the
    // same instant lands an hour later than it would for Taipei.
    await testDb.drizzle
      .update(restaurants)
      .set({ timezone: "Asia/Tokyo" })
      .where(eq(restaurants.id, "analytics-restaurant"));

    await testDb.drizzle
      .insert(orders)
      .values([order("tokyo-1", "H-101", "2026-01-08T12:00:00.000Z", 10000)]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getOrderAnalytics(window);

    expect(result.popularTimeSlots).toEqual([{ hour: 21, orderCount: 1 }]);
  });

  it("does not report a 100% conversion rate when some orders were cancelled", async () => {
    // Guards the tempting one-line version of the fix above: filtering
    // totalOrders by status too makes the rate a set divided by itself.
    await testDb.drizzle.insert(orders).values([
      order("paid-1", "A-001", "2026-01-08T12:00:00.000Z", 30000),
      order("cancelled-1", "A-002", "2026-01-08T13:00:00.000Z", 90000, {
        status: "cancelled",
      }),
    ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getOrderAnalytics(window);

    expect(result.conversionRate).toBe(50);
  });

  it("measures growth against the window immediately before the selected one", async () => {
    // Two days in the window, two days immediately before it. The rates have
    // to describe that span — they used to come from the dashboard summary,
    // which is always month-over-month whatever the caller asked for.
    await testDb.drizzle
      .insert(orders)
      .values([
        order("current-1", "A-001", "2026-01-08T12:00:00.000Z", 30000),
        order("current-2", "A-002", "2026-01-09T12:00:00.000Z", 30000),
        order("prior-1", "A-003", "2026-01-06T12:00:00.000Z", 30000),
      ]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getOrderAnalytics(window);

    // 600 against a prior 300, and 2 orders against a prior 1.
    expect(result.revenueGrowth).toEqual(growth(100));
    expect(result.orderGrowth).toBe(100);
  });

  it("reports no growth rather than an infinite one when the prior window earned nothing", async () => {
    await testDb.drizzle
      .insert(orders)
      .values([order("current-1", "A-001", "2026-01-08T12:00:00.000Z", 30000)]);

    const result = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getOrderAnalytics(window);

    expect(result.revenueGrowth).toEqual(growth(0));
    expect(result.orderGrowth).toBe(0);
  });
});

describe("AnalyticsService financial report", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await testDb.drizzle.insert(restaurants).values({
      id: "analytics-restaurant",
      name: "Analytics Test Restaurant",
      type: "casual",
      category: "testing",
      address: "1 Test Road",
      district: "Test District",
      phone: "0912345678",
    });
  });

  it("reports the tax carried in the orders and the revenue net of it", async () => {
    await testDb.drizzle.insert(orders).values([
      order("fin-1", "F-001", "2026-02-02T12:00:00.000Z", 21000, {
        taxAmountCents: 1000,
      }),
      order("fin-2", "F-002", "2026-02-03T12:00:00.000Z", 10500, {
        taxAmountCents: 500,
      }),
      order("fin-cancelled", "F-003", "2026-02-03T13:00:00.000Z", 90000, {
        taxAmountCents: 9000,
        status: "cancelled",
      }),
    ]);

    const service = new AnalyticsService(testDb.bindings.DB, {} as never);

    const report = await service.getFinancialReport({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-02-01T00:00:00.000Z",
      dateTo: "2026-02-05T00:00:00.000Z",
      groupBy: "day",
    });

    expect(report.summary).toMatchObject({
      totalRevenue: money(31500),
      totalOrders: 2,
      taxAmount: money(1500),
      netRevenue: money(30000),
    });
  });

  it("keeps a partially refunded order in financial revenue at its net amount", async () => {
    await testDb.drizzle.insert(orders).values([
      order(
        "fin-partial-refund",
        "F-REFUND-001",
        "2026-02-02T12:00:00.000Z",
        18000,
        {
          paymentStatus: "partial_refunded",
          refundAmountCents: 5000,
        },
      ),
    ]);

    const report = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getFinancialReport({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-02-01T00:00:00.000Z",
      dateTo: "2026-02-05T00:00:00.000Z",
      groupBy: "day",
    });

    expect(report.summary).toMatchObject({
      totalRevenue: money(13000),
      totalOrders: 1,
      averageOrderValue: money(13000),
      taxAmount: [],
      netRevenue: money(13000),
    });
  });

  it("keeps every financial summary amount in its own currency", async () => {
    await testDb.drizzle.insert(restaurants).values({
      id: "analytics-myr-restaurant",
      name: "MYR Analytics Test Restaurant",
      type: "casual",
      category: "testing",
      address: "2 Test Road",
      district: "Test District",
      phone: "0912345679",
      settings: { currency: "MYR" },
    });
    await testDb.drizzle.insert(orders).values([
      order("fin-twd", "F-TWD-001", "2026-02-02T12:00:00.000Z", 10000, {
        taxAmountCents: 1000,
      }),
      order("fin-myr", "F-MYR-001", "2026-02-02T12:00:00.000Z", 10000, {
        restaurantId: "analytics-myr-restaurant",
        taxAmountCents: 1000,
      }),
    ]);

    const report = await new AnalyticsService(
      testDb.bindings.DB,
      {} as never,
    ).getFinancialReport({
      dateFrom: "2026-02-01T00:00:00.000Z",
      dateTo: "2026-02-03T00:00:00.000Z",
      groupBy: "day",
    });

    expect(report.summary).toMatchObject({
      totalRevenue: [
        { currency: "TWD", amountCents: 10000 },
        { currency: "MYR", amountCents: 10000 },
      ],
      averageOrderValue: [
        { currency: "TWD", amountCents: 10000 },
        { currency: "MYR", amountCents: 10000 },
      ],
      taxAmount: [
        { currency: "TWD", amountCents: 1000 },
        { currency: "MYR", amountCents: 1000 },
      ],
      netRevenue: [
        { currency: "TWD", amountCents: 9000 },
        { currency: "MYR", amountCents: 9000 },
      ],
    });
  });

  it("keeps financial totals complete when the chart is limited", async () => {
    // `limit` constrains the report's chart/breakdown, never its financial
    // summary. A report for the selected range must not omit the third day.
    await testDb.drizzle.insert(orders).values([
      order("cap-1", "G-001", "2026-02-02T12:00:00.000Z", 21000, {
        taxAmountCents: 1000,
      }),
      order("cap-2", "G-002", "2026-02-03T12:00:00.000Z", 10500, {
        taxAmountCents: 500,
      }),
      order("cap-dropped", "G-003", "2026-02-04T12:00:00.000Z", 50000, {
        taxAmountCents: 5000,
      }),
    ]);

    const service = new AnalyticsService(testDb.bindings.DB, {} as never);

    const report = await service.getFinancialReport({
      restaurantId: "analytics-restaurant",
      dateFrom: "2026-02-01T00:00:00.000Z",
      dateTo: "2026-02-05T00:00:00.000Z",
      groupBy: "day",
      limit: 2,
    });

    expect(report.summary).toMatchObject({
      totalRevenue: money(81500),
      totalOrders: 3,
      taxAmount: money(6500),
      netRevenue: money(75000),
    });
    expect(report.revenueBreakdown.byDay).toHaveLength(2);
  });
});

describe("AnalyticsService table analytics", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    await testDb.drizzle.insert(restaurants).values({
      id: "analytics-restaurant",
      name: "Analytics Test Restaurant",
      type: "casual",
      category: "testing",
      address: "1 Test Road",
      district: "Test District",
      phone: "0912345678",
    });

    await testDb.drizzle.insert(tables).values([
      table("Live", "analytics-live", {
        id: 1,
        isOccupied: false,
        totalUsage: 4,
        averageOccupancyMinutes: 30,
      }),
      table("Deleted occupied", "analytics-deleted-occupied", {
        id: 2,
        isActive: false,
        isOccupied: true,
        totalUsage: 100,
        averageOccupancyMinutes: 120,
        deletedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      table("Deleted available", "analytics-deleted-available", {
        id: 3,
        isActive: false,
        totalUsage: 100,
        averageOccupancyMinutes: 120,
        deletedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      table("Inactive occupied", "analytics-inactive-occupied", {
        id: 4,
        isActive: false,
        isOccupied: true,
        totalUsage: 4,
        averageOccupancyMinutes: 30,
      }),
    ]);
    await testDb.drizzle.insert(orders).values([
      order(
        "table-analytics-order",
        "TA-001",
        "2026-01-08T12:00:00.000Z",
        10000,
        {
          tableId: 1,
        },
      ),
      order(
        "deleted-table-order",
        "TA-002",
        "2026-01-08T12:00:00.000Z",
        10000,
        {
          tableId: 2,
        },
      ),
      order(
        "inactive-table-order",
        "TA-003",
        "2026-01-08T12:00:00.000Z",
        10000,
        {
          tableId: 4,
        },
      ),
    ]);
  });

  it("excludes soft-deleted tables from dashboard status and table analytics", async () => {
    const service = new AnalyticsService(testDb.bindings.DB, {} as never);

    const [dashboard, tableAnalytics, performance] = await Promise.all([
      service.getDashboardData("analytics-restaurant"),
      service.getTableAnalytics({ restaurantId: "analytics-restaurant" }),
      service.getPerformanceReport("analytics-restaurant", {}),
    ]);

    // Only table 1 is both alive and active: table 2/3 are soft-deleted and
    // table 4 is parked in maintenance. The card renders `occupied/total` plus
    // "N 可用", so the invariant that matters is total === occupied + available.
    expect(dashboard.tableStatus).toEqual({
      total: 1,
      occupied: 0,
      available: 1,
    });
    expect(dashboard.tableStatus.total).toBe(
      Number(dashboard.tableStatus.occupied) +
        Number(dashboard.tableStatus.available),
    );
    expect(tableAnalytics.tableUtilization).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableId: 1, tableNumber: "Live" }),
        expect.objectContaining({
          tableId: 4,
          tableNumber: "Inactive occupied",
        }),
      ]),
    );
    expect(tableAnalytics.tableUtilization).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableId: 2 }),
        expect.objectContaining({ tableId: 3 }),
      ]),
    );
    // What #272 is about: both the numerator (COUNT DISTINCT table_id) and the
    // denominator (the subquery over `tables`) must exclude soft-deleted tables.
    //
    // The hour is now pinned too (#290). The seeded orders are at
    // 2026-01-08T12:00:00Z, which is 20:00 in Taipei -- the shop's own evening
    // peak, not the lunchtime hour UTC bucketing used to report.
    //
    // occupancyRate stays 100 because both halves count the same population:
    // the numerator's join filters on deletedAt only, so tables 1 and 4 are
    // both in it, and the denominator counts those same two. Adding
    // `is_active` to the denominator alone -- the change #290 asked us to
    // consider -- would leave table 4 in the numerator and drop it from the
    // denominator, and this assertion would read 200.
    expect(tableAnalytics.peakHours).toHaveLength(1);
    expect(tableAnalytics.peakHours[0].hour).toBe(20);
    expect(tableAnalytics.peakHours[0].occupancyRate).toBe(100);
    expect(tableAnalytics.averageTurnoverTime).toBe(30);
    expect(performance.tableUtilization).toBeCloseTo(8.333333, 5);
  });
});

function order(
  id: string,
  orderNumber: string,
  createdAt: string,
  totalAmountCents: number,
  overrides: Partial<typeof orders.$inferInsert> = {},
): typeof orders.$inferInsert {
  return {
    id,
    orderNumber,
    restaurantId: "analytics-restaurant",
    status: "paid",
    paymentStatus: "completed",
    totalAmountCents,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    ...overrides,
  };
}

function money(amountCents: number) {
  return [{ currency: "TWD" as const, amountCents }];
}

function growth(percentage: number) {
  return [{ currency: "TWD" as const, percentage }];
}

function table(
  number: string,
  qrCode: string,
  overrides: Partial<typeof tables.$inferInsert> = {},
): typeof tables.$inferInsert {
  return {
    restaurantId: "analytics-restaurant",
    number,
    qrCode,
    ...overrides,
  };
}
