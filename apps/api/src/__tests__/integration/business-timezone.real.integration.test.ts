import { AnalyticsService } from "@makanmasak/database";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DiscoveryService } from "../../features/discovery/services/DiscoveryService";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";

/**
 * Real-D1 cover for #329: the business day is cut at the restaurant's own
 * midnight, not at a hardcoded +08.
 *
 * The symptom this replaces is a night market's whole evening landing on the
 * wrong day. A GMT+9 shop's 00:30 order was bucketed as 23:30 the day before,
 * and a GMT+7 shop's 23:30 order as the day after — so the owner's daily
 * revenue disagreed with the till and the timezone they had picked was
 * displayed back to them intact the whole time.
 *
 * This has to run against real D1: the bucketing is SQLite date arithmetic, so
 * a mocked drizzle cannot tell an offset that is threaded through from one
 * that is ignored. The revenue assertions below flip if `dateFromUnixMs` goes
 * back to a constant '+8 hours'; the last one flips if the discovery query
 * stops selecting `restaurants.timezone` or stops handing it to isOpenNow.
 */
describe("Business-day bucketing follows the restaurant's timezone", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
    // Replaying the whole migration track and cold-importing the api feature
    // graph does not fit in the 60s some sibling suites get away with.
  }, 300_000);

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  afterAll(async () => {
    await testApp?.dispose();
  });

  /** 22:30 in Jakarta, 23:30 in Taipei, 00:30 the next day in Tokyo. */
  const LATE_EVENING = new Date("2026-01-11T15:30:00.000Z");
  /** 23:30 in Jakarta, 00:30 the next day in Taipei. */
  const LATE_EVENING_PLUS_7 = new Date("2026-01-11T16:30:00.000Z");

  const WIDE_RANGE = {
    dateFrom: "2026-01-01T00:00:00.000Z",
    dateTo: "2026-01-31T00:00:00.000Z",
    groupBy: "day" as const,
  };

  async function revenueBuckets(restaurantId: string) {
    const analytics = new AnalyticsService(testApp.env.DB, testApp.env);
    const rows = await analytics.getRevenueAnalytics({
      restaurantId,
      ...WIDE_RANGE,
    });
    return rows.map((row) => row.date);
  }

  async function shopWithOneOrder(timezone: string, placedAt: Date) {
    const shop = await seed.restaurant({ timezone });
    await seed.order(shop.id, {
      status: "paid",
      paymentStatus: "completed",
      createdAt: placedAt,
      updatedAt: placedAt,
    });
    return shop.id;
  }

  it("files one instant under each shop's own business day", async () => {
    // Three shops, three timezones, one and the same instant. Under the old
    // hardcoded +08 all three answered 2026-01-11.
    const tokyo = await shopWithOneOrder("Asia/Tokyo", LATE_EVENING);
    const taipei = await shopWithOneOrder("Asia/Taipei", LATE_EVENING);
    const jakarta = await shopWithOneOrder("Asia/Jakarta", LATE_EVENING);

    // 00:30 local: the takings belong to the day that has just begun.
    await expect(revenueBuckets(tokyo)).resolves.toEqual(["2026-01-12"]);
    await expect(revenueBuckets(taipei)).resolves.toEqual(["2026-01-11"]);
    await expect(revenueBuckets(jakarta)).resolves.toEqual(["2026-01-11"]);
  });

  it("keeps a GMT+7 shop's late-evening order out of the next day", async () => {
    // The mirror-image failure: at this instant a +08 boundary has already
    // rolled over, so the order was credited to a day the shop had not
    // started trading in yet.
    const jakarta = await shopWithOneOrder("Asia/Jakarta", LATE_EVENING_PLUS_7);

    await expect(revenueBuckets(jakarta)).resolves.toEqual(["2026-01-11"]);
  });

  it("reads the boundary from the column, not a stale settings copy", async () => {
    // Rows written before #329 may still carry `settings.timezone`. The
    // migration drops it, but a client that echoes an old payload back can put
    // it there again — and it must not be what the report follows.
    const shop = await seed.restaurant({
      timezone: "Asia/Taipei",
      settings: { currency: "TWD", timezone: "Asia/Tokyo" },
    });
    await seed.order(shop.id, {
      status: "paid",
      paymentStatus: "completed",
      createdAt: LATE_EVENING,
      updatedAt: LATE_EVENING,
    });

    await expect(revenueBuckets(shop.id)).resolves.toEqual(["2026-01-11"]);
  });

  it("falls back to the default rather than failing on an unsupported zone", async () => {
    // A zone the SQL layer cannot express (its offset moves twice a year) is
    // never accepted by the API, but a hand-edited or migrated row could hold
    // one. A report still has to come back.
    const shop = await seed.restaurant({ timezone: "America/New_York" });
    await seed.order(shop.id, {
      status: "paid",
      paymentStatus: "completed",
      createdAt: LATE_EVENING,
      updatedAt: LATE_EVENING,
    });

    await expect(revenueBuckets(shop.id)).resolves.toEqual(["2026-01-11"]);
  });

  describe("and so does whether the shop counts as open right now", () => {
    // The other half of #329: isOpenNow took a timezone and no call site ever
    // passed one, so every shop's opening hours were read off Taipei's clock.
    // A unit test on the helper cannot see that -- it proves the argument is
    // honoured, not that the query selects the column and hands it over.

    /** A Monday. 21:30 in Jakarta, 22:30 in Taipei. */
    const MONDAY_LATE = new Date("2026-01-12T14:30:00.000Z");

    afterEach(() => {
      vi.useRealTimers();
    });

    async function takeawayEligibility(restaurantId: string) {
      const discovery = new DiscoveryService(
        testApp.env.DB,
        testApp.env.CACHE_KV,
      );
      return discovery.getTakeawayEligibility(restaurantId);
    }

    async function openUntilTen(timezone: string) {
      const shop = await seed.restaurant({
        timezone,
        businessHours: {
          monday: { open: "09:00", close: "22:00", isOpen: true },
        },
        supportsTakeaway: true,
        enableShopMode: true,
        shopQrCode: `SHOP-${timezone}-1`,
      });
      return shop.id;
    }

    it("keeps a GMT+7 stall open until its own 22:00", async () => {
      const jakarta = await openUntilTen("Asia/Jakarta");
      const taipei = await openUntilTen("Asia/Taipei");

      // Only Date is faked: the D1 client's own timers have to keep running.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(MONDAY_LATE);

      // 21:30 in Jakarta, so still trading. Under the old hardcoded Taipei
      // clock this answered closed_now and the takeaway QR went dead an hour
      // early, every day.
      await expect(takeawayEligibility(jakarta)).resolves.toMatchObject({
        eligible: true,
      });

      // The same instant is 22:30 in Taipei, where the shop really has shut.
      await expect(takeawayEligibility(taipei)).resolves.toMatchObject({
        eligible: false,
        reason: "closed_now",
      });
    });
  });
});
