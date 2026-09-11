import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  customerConsents,
  customerFavorites,
  customerNotificationPreferences,
  customerPushSubscriptions,
  customers,
  marketingBroadcastRecipients,
  marketingBroadcasts,
  markets,
  restaurantMarketMemberships,
} from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  buildSeedHelpers,
  type SeedHelpers,
} from "../../../__tests__/integration/helpers/seed-helper";
import {
  BroadcastService,
  buildBroadcastPayload,
  isWithinQuietHours,
  localMinuteOfDay,
  pushErrorCode,
} from "./BroadcastService";
import type { Env } from "../../../types/env";

const MARKETING_VERSION = "2026-05-25-v1";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 2026-09-12T20:00:00Z. Deliberately an instant where UTC and Asia/Taipei fall
 * on opposite sides of a 23:00-07:00 quiet window: 20:00 UTC is awake,
 * 04:00 the next day in Taipei is not. A test pinned here fails the moment
 * somebody evaluates quiet hours in UTC — which is exactly the mistake #290
 * records analytics still making.
 */
const NIGHT_IN_TAIPEI_MS = Date.UTC(2026, 8, 12, 20, 0, 0);
const QUIET_START_MIN = 23 * 60;
const QUIET_END_MIN = 7 * 60;

describe("quiet hours arithmetic", () => {
  it("converts an instant to minutes since local midnight", () => {
    // 20:00 UTC is 04:00 the next day at +8.
    expect(localMinuteOfDay(NIGHT_IN_TAIPEI_MS, 8 * 60)).toBe(4 * 60);
    expect(localMinuteOfDay(NIGHT_IN_TAIPEI_MS, 0)).toBe(20 * 60);
    // Negative offsets wrap backwards rather than going negative.
    expect(localMinuteOfDay(Date.UTC(2026, 8, 12, 2, 0, 0), -5 * 60)).toBe(
      21 * 60,
    );
  });

  it("treats a window that crosses midnight as one window", () => {
    const inside = (offset: number) =>
      isWithinQuietHours(
        NIGHT_IN_TAIPEI_MS,
        offset,
        QUIET_START_MIN,
        QUIET_END_MIN,
      );
    expect(inside(8 * 60)).toBe(true);
    expect(inside(0)).toBe(false);
  });

  it("handles a same-day window and an absent one", () => {
    // 13:00-14:00 local, evaluated at 04:00 local.
    expect(isWithinQuietHours(NIGHT_IN_TAIPEI_MS, 8 * 60, 780, 840)).toBe(
      false,
    );
    expect(isWithinQuietHours(NIGHT_IN_TAIPEI_MS, 8 * 60, 180, 300)).toBe(true);
    expect(isWithinQuietHours(NIGHT_IN_TAIPEI_MS, 8 * 60, null, 300)).toBe(
      false,
    );
    expect(isWithinQuietHours(NIGHT_IN_TAIPEI_MS, 8 * 60, 180, null)).toBe(
      false,
    );
    // Equal bounds are a zero-length window, not a whole day.
    expect(isWithinQuietHours(NIGHT_IN_TAIPEI_MS, 8 * 60, 240, 240)).toBe(
      false,
    );
  });
});

describe("pushErrorCode", () => {
  it("separates a dead subscription from a bad afternoon", () => {
    expect(pushErrorCode(410)).toBe("PUSH_GONE");
    expect(pushErrorCode(404)).toBe("PUSH_GONE");
    expect(pushErrorCode(0)).toBe("PUSH_ERROR");
    expect(pushErrorCode(503)).toBe("PUSH_HTTP_503");
  });
});

describe("buildBroadcastPayload", () => {
  it("tags the payload per scope so a re-send replaces its predecessor", () => {
    expect(
      buildBroadcastPayload({
        scopeType: "restaurant",
        scopeId: "rest-1",
        sentBy: "user-1",
        title: "半價",
        body: "今晚全品項半價",
      }),
    ).toEqual(
      expect.objectContaining({
        type: "marketing_broadcast",
        title: "半價",
        url: null,
        tag: "broadcast-restaurant-rest-1",
      }),
    );
  });
});

describe("BroadcastService against real D1", () => {
  let testDb: TestDatabase;
  let seed: SeedHelpers;
  let deliverer: ReturnType<typeof vi.fn>;
  let env: Env;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    seed = buildSeedHelpers(testDb);
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    deliverer = vi.fn(async () => ({ ok: true, status: 201 }));
    env = {
      DB: testDb.bindings.DB,
      CACHE_KV: testDb.bindings.CACHE_KV,
      JWT_SECRET: "x".repeat(32),
      WEB_PUSH_DELIVERER: deliverer,
    } as unknown as Env;
  });

  // ───────────────────────── fixtures ─────────────────────────

  let sequence = 0;
  function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function seedMarket(): Promise<string> {
    const id = nextId("market");
    const now = new Date();
    await testDb.drizzle.insert(markets).values({
      id,
      slug: id,
      name: `Market ${id}`,
      type: "night_market",
      city: "Taipei",
      district: "Central",
      address: "1 Market Street",
      latitude: 25.03,
      longitude: 121.56,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    } as never);
    return id;
  }

  interface CustomerOptions {
    follows?: Array<{ targetType: string; targetId: string }>;
    consent?: "granted" | "revoked" | "none" | "granted-then-revoked";
    subscriptions?: number;
    subscriptionFailureCount?: number;
    marketingEnabled?: boolean;
    followedOnly?: boolean;
    quietHours?: { startMin: number; endMin: number };
  }

  async function seedCustomer(options: CustomerOptions = {}): Promise<string> {
    const customerId = nextId("customer");
    const now = new Date();
    await testDb.drizzle.insert(customers).values({
      id: customerId,
      displayName: `Customer ${customerId}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as never);

    for (const follow of options.follows ?? []) {
      await testDb.drizzle.insert(customerFavorites).values({
        customerId,
        targetType: follow.targetType,
        targetId: follow.targetId,
        createdAt: now,
      } as never);
    }

    const consent = options.consent ?? "granted";
    if (consent === "granted" || consent === "granted-then-revoked") {
      await testDb.drizzle.insert(customerConsents).values({
        id: nextId("consent"),
        customerId,
        consentType: "marketing",
        version: MARKETING_VERSION,
        granted: 1,
        grantedAt: new Date(now.getTime() - 10_000),
        revokedAt: consent === "granted-then-revoked" ? now : null,
      } as never);
    }
    if (consent === "revoked" || consent === "granted-then-revoked") {
      // The append-only withdrawal the customer route writes: the older grant
      // stays on the table, and only the ordering says which one applies.
      await testDb.drizzle.insert(customerConsents).values({
        id: nextId("consent"),
        customerId,
        consentType: "marketing",
        version: MARKETING_VERSION,
        granted: 0,
        grantedAt: now,
      } as never);
    }

    const subscriptionCount = options.subscriptions ?? 1;
    for (let i = 0; i < subscriptionCount; i += 1) {
      await testDb.drizzle.insert(customerPushSubscriptions).values({
        id: nextId("sub"),
        customerId,
        endpoint: `https://push.example.com/${nextId("ep")}`,
        p256dhKey: "p256dh",
        authKey: "auth",
        failureCount: options.subscriptionFailureCount ?? 0,
        createdAt: now,
      } as never);
    }

    const hasPreference =
      options.marketingEnabled !== undefined ||
      options.followedOnly !== undefined ||
      options.quietHours !== undefined;
    if (hasPreference) {
      await testDb.drizzle.insert(customerNotificationPreferences).values({
        customerId,
        marketingEnabled: options.marketingEnabled === false ? 0 : 1,
        followedOnly: options.followedOnly === false ? 0 : 1,
        quietHoursStartMin: options.quietHours?.startMin ?? null,
        quietHoursEndMin: options.quietHours?.endMin ?? null,
        updatedAt: now,
      } as never);
    }

    return customerId;
  }

  async function recipientsOf(broadcastId: string) {
    return testDb.drizzle
      .select()
      .from(marketingBroadcastRecipients)
      .where(eq(marketingBroadcastRecipients.broadcastId, broadcastId));
  }

  async function broadcastRow(broadcastId: string) {
    const [row] = await testDb.drizzle
      .select()
      .from(marketingBroadcasts)
      .where(eq(marketingBroadcasts.id, broadcastId));
    return row;
  }

  // ───────────────────────── schema ─────────────────────────

  describe("migration 0024", () => {
    it("creates all three tables STRICT", async () => {
      const rows = await testDb.drizzle.all<{ name: string; sql: string }>(sql`
        SELECT name, sql FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('customer_notification_preferences',
                        'marketing_broadcasts',
                        'marketing_broadcast_recipients')
      `);

      expect(rows.map((row) => row.name).sort()).toEqual([
        "customer_notification_preferences",
        "marketing_broadcast_recipients",
        "marketing_broadcasts",
      ]);
      for (const row of rows) {
        // Substring matching would also accept `ON DELETE RESTRICT`; the
        // keyword only counts as the table option after the closing paren.
        expect(row.sql.replace(/\n/g, " ").trim().endsWith(") STRICT")).toBe(
          true,
        );
      }
    });

    it("refuses a TEXT write into an INTEGER column", async () => {
      const customerId = await seedCustomer({ consent: "none" });
      await expect(
        testDb.bindings.DB.prepare(
          `INSERT INTO customer_notification_preferences
             (customer_id, marketing_enabled, followed_only, updated_at_ms)
           VALUES (?, ?, 1, ?)`,
        )
          .bind(customerId, "yes", Date.now())
          .run(),
      ).rejects.toThrow();
    });
  });

  // ───────────────────────── audience ─────────────────────────

  describe("audience resolution", () => {
    it("delivers to a follower with consent and a live subscription", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      const customerId = await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
      });

      const service = new BroadcastService(env);
      const result = await service.send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "今晚半價",
        body: "全品項半價至 22:00",
        url: "/r/1",
      });

      expect(result).toEqual(
        expect.objectContaining({
          audienceCount: 1,
          deliveredCount: 1,
          failedCount: 0,
          skippedCount: 0,
        }),
      );

      expect(deliverer).toHaveBeenCalledOnce();
      expect(deliverer).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription: expect.objectContaining({
            id: expect.any(String),
            endpoint: expect.stringContaining("https://push.example.com/"),
            p256dhKey: "p256dh",
            authKey: "auth",
          }),
          payload: expect.objectContaining({
            type: "marketing_broadcast",
            title: "今晚半價",
            url: "/r/1",
          }),
        }),
      );

      const rows = await recipientsOf(result.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          customerId,
          status: "delivered",
          errorCode: null,
        }),
      );
      // The consent that authorised the send is on the row, not in a log.
      expect(rows[0].consentId).toEqual(expect.any(String));
      expect(rows[0].subscriptionId).toEqual(expect.any(String));

      const stored = await broadcastRow(result.id);
      expect(stored).toEqual(
        expect.objectContaining({
          scopeType: "restaurant",
          scopeId: restaurant.id,
          restaurantId: restaurant.id,
          marketId: null,
          sentBy: user.id,
          audienceCount: 1,
          deliveredCount: 1,
          failedCount: 0,
          skippedCount: 0,
        }),
      );
      expect(stored.completedAt).not.toBeNull();
    });

    it("excludes a follower with no marketing consent", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
        consent: "none",
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      expect(result.audienceCount).toBe(0);
      expect(deliverer).not.toHaveBeenCalled();
      expect(await recipientsOf(result.id)).toHaveLength(0);
    });

    it("excludes a consenting follower who switched marketing off", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
        marketingEnabled: false,
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      expect(result.audienceCount).toBe(0);
      expect(deliverer).not.toHaveBeenCalled();
    });

    it("excludes a customer who follows nothing", async () => {
      const restaurant = await seed.restaurant();
      const other = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: other.id }],
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      expect(result.audienceCount).toBe(0);
    });

    it("honours the newest consent row, granted or not", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      const follows = [{ targetType: "restaurant", targetId: restaurant.id }];
      // An older grant behind a newer withdrawal must not resurrect anybody.
      await seedCustomer({ follows, consent: "granted-then-revoked" });
      // ...and a withdrawal followed by a fresh grant must.
      const regranted = await seedCustomer({ follows, consent: "none" });
      const base = Date.now();
      await testDb.drizzle.insert(customerConsents).values([
        {
          id: nextId("consent"),
          customerId: regranted,
          consentType: "marketing",
          version: MARKETING_VERSION,
          granted: 0,
          grantedAt: new Date(base - 60_000),
        },
        {
          id: nextId("consent"),
          customerId: regranted,
          consentType: "marketing",
          version: MARKETING_VERSION,
          granted: 1,
          grantedAt: new Date(base),
        },
      ] as never);

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      expect(result.audienceCount).toBe(1);
      const rows = await recipientsOf(result.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].customerId).toBe(regranted);
    });

    it("ignores a granted consent of another type", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      const customerId = await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
        consent: "none",
      });
      await testDb.drizzle.insert(customerConsents).values({
        id: nextId("consent"),
        customerId,
        consentType: "analytics",
        version: MARKETING_VERSION,
        granted: 1,
        grantedAt: new Date(),
      } as never);

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      expect(result.audienceCount).toBe(0);
    });
  });

  // ───────────────────── market fan-in ─────────────────────

  describe("includeMarketFollowers", () => {
    async function setUpMarketVendor() {
      const marketId = await seedMarket();
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      await testDb.drizzle.insert(restaurantMarketMemberships).values({
        restaurantId: restaurant.id,
        marketId,
        isPrimary: true,
        joinedAt: new Date(),
      } as never);
      return { marketId, restaurant, user };
    }

    it("leaves market followers out by default", async () => {
      const { marketId, restaurant, user } = await setUpMarketVendor();
      await seedCustomer({
        follows: [{ targetType: "market", targetId: marketId }],
        followedOnly: false,
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      expect(result.audienceCount).toBe(0);
    });

    it("adds market followers who allow it, and skips the followed-only ones", async () => {
      const { marketId, restaurant, user } = await setUpMarketVendor();
      const openToMarket = await seedCustomer({
        follows: [{ targetType: "market", targetId: marketId }],
        followedOnly: false,
      });
      // Default preference (no row at all) is followed-only.
      await seedCustomer({
        follows: [{ targetType: "market", targetId: marketId }],
      });
      // An explicit followedOnly = true says the same thing out loud.
      await seedCustomer({
        follows: [{ targetType: "market", targetId: marketId }],
        followedOnly: true,
      });
      const directFollower = await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
        includeMarketFollowers: true,
      });

      expect(result.audienceCount).toBe(2);
      const rows = await recipientsOf(result.id);
      expect(rows.map((row) => row.customerId).sort()).toEqual(
        [openToMarket, directFollower].sort(),
      );
    });

    it("reaches a followed-only customer who follows both", async () => {
      const { marketId, restaurant, user } = await setUpMarketVendor();
      const both = await seedCustomer({
        follows: [
          { targetType: "market", targetId: marketId },
          { targetType: "restaurant", targetId: restaurant.id },
        ],
        followedOnly: true,
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
        includeMarketFollowers: true,
      });

      // Once, not twice: two favorite rows are one person.
      expect(result.audienceCount).toBe(1);
      const rows = await recipientsOf(result.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].customerId).toBe(both);
    });

    it("ignores a market the restaurant has left", async () => {
      const { marketId, restaurant, user } = await setUpMarketVendor();
      await testDb.drizzle
        .update(restaurantMarketMemberships)
        .set({ leftAt: new Date() })
        .where(eq(restaurantMarketMemberships.marketId, marketId));
      await seedCustomer({
        follows: [{ targetType: "market", targetId: marketId }],
        followedOnly: false,
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
        includeMarketFollowers: true,
      });

      expect(result.audienceCount).toBe(0);
    });
  });

  // ───────────────────── quiet hours ─────────────────────

  describe("quiet hours", () => {
    it("skips a recipient whose window is open in the restaurant's timezone", async () => {
      const restaurant = await seed.restaurant({ timezone: "Asia/Taipei" });
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      const asleep = await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
        quietHours: { startMin: QUIET_START_MIN, endMin: QUIET_END_MIN },
      });
      const awake = await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
        nowMs: NIGHT_IN_TAIPEI_MS,
      });

      expect(result).toEqual(
        expect.objectContaining({
          audienceCount: 2,
          deliveredCount: 1,
          skippedCount: 1,
        }),
      );
      expect(deliverer).toHaveBeenCalledOnce();

      const rows = await recipientsOf(result.id);
      const skipped = rows.find((row) => row.customerId === asleep);
      expect(skipped).toEqual(
        expect.objectContaining({
          status: "skipped_quiet_hours",
          subscriptionId: null,
        }),
      );
      // Recorded, not merely dropped — and still carrying the consent it
      // would have been sent under.
      expect(skipped?.consentId).toEqual(expect.any(String));
      expect(rows.find((row) => row.customerId === awake)?.status).toBe(
        "delivered",
      );
    });

    it("reads the same window against the platform default for a market", async () => {
      const marketId = await seedMarket();
      const user = await seed.user({ role: 0 });
      await seedCustomer({
        follows: [{ targetType: "market", targetId: marketId }],
        quietHours: { startMin: QUIET_START_MIN, endMin: QUIET_END_MIN },
      });

      const result = await new BroadcastService(env).send({
        scopeType: "market",
        scopeId: marketId,
        sentBy: user.id,
        title: "t",
        body: "b",
        nowMs: NIGHT_IN_TAIPEI_MS,
      });

      expect(result.skippedCount).toBe(1);
      expect(result.deliveredCount).toBe(0);
    });
  });

  // ───────────────────── delivery outcomes ─────────────────────

  describe("delivery", () => {
    it("records a dead subscription as failed with its error code", async () => {
      deliverer.mockResolvedValue({ ok: false, status: 410 });
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      const customerId = await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      expect(result).toEqual(
        expect.objectContaining({ deliveredCount: 0, failedCount: 1 }),
      );
      const rows = await recipientsOf(result.id);
      expect(rows[0]).toEqual(
        expect.objectContaining({ status: "failed", errorCode: "PUSH_GONE" }),
      );

      // Reuses the existing liveness bookkeeping rather than deleting the row:
      // three strikes takes it out of every audience, and the 90-day prune
      // removes it later.
      const [subscription] = await testDb.drizzle
        .select()
        .from(customerPushSubscriptions)
        .where(eq(customerPushSubscriptions.customerId, customerId));
      expect(subscription.failureCount).toBe(1);
    });

    it("records a customer with no live subscription", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
        subscriptions: 0,
      });
      // Already struck out three times: present in the table, absent from
      // every audience.
      await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
        subscriptionFailureCount: 3,
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      expect(result).toEqual(
        expect.objectContaining({ audienceCount: 2, skippedCount: 2 }),
      );
      const rows = await recipientsOf(result.id);
      expect(
        rows.every((row) => row.status === "skipped_no_subscription"),
      ).toBe(true);
      expect(deliverer).not.toHaveBeenCalled();
    });

    it("sends to every device a customer has registered", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
        subscriptions: 3,
      });

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      // One person, three devices: the audience counts people and the
      // recipient rows count attempts.
      expect(result).toEqual(
        expect.objectContaining({ audienceCount: 1, deliveredCount: 3 }),
      );
      expect(deliverer).toHaveBeenCalledTimes(3);
      const endpoints = deliverer.mock.calls.map(
        (call) =>
          (call[0] as { subscription: { endpoint: string } }).subscription
            .endpoint,
      );
      expect(new Set(endpoints).size).toBe(3);
    });

    it("counts on the broadcast row equal the recipient statuses", async () => {
      const restaurant = await seed.restaurant({ timezone: "Asia/Taipei" });
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      const follows = [{ targetType: "restaurant", targetId: restaurant.id }];
      await seedCustomer({ follows });
      await seedCustomer({ follows, subscriptions: 0 });
      await seedCustomer({
        follows,
        quietHours: { startMin: QUIET_START_MIN, endMin: QUIET_END_MIN },
      });
      const failing = await seedCustomer({ follows });
      deliverer.mockImplementation(
        async (delivery: { subscription: { endpoint: string } }) => {
          const [row] = await testDb.drizzle
            .select({ customerId: customerPushSubscriptions.customerId })
            .from(customerPushSubscriptions)
            .where(
              eq(
                customerPushSubscriptions.endpoint,
                delivery.subscription.endpoint,
              ),
            );
          return row?.customerId === failing
            ? { ok: false, status: 500 }
            : { ok: true, status: 201 };
        },
      );

      const result = await new BroadcastService(env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
        nowMs: NIGHT_IN_TAIPEI_MS,
      });

      const rows = await recipientsOf(result.id);
      const tally = (status: string) =>
        rows.filter((row) => row.status === status).length;

      expect(result.audienceCount).toBe(4);
      expect(result.deliveredCount).toBe(tally("delivered"));
      expect(result.failedCount).toBe(tally("failed"));
      expect(result.skippedCount).toBe(
        tally("skipped_quiet_hours") + tally("skipped_no_subscription"),
      );
      expect(
        result.deliveredCount + result.failedCount + result.skippedCount,
      ).toBe(rows.length);

      const stored = await broadcastRow(result.id);
      expect(stored).toEqual(
        expect.objectContaining({
          audienceCount: 4,
          deliveredCount: result.deliveredCount,
          failedCount: result.failedCount,
          skippedCount: result.skippedCount,
        }),
      );
      expect(rows.find((row) => row.customerId === failing)?.errorCode).toBe(
        "PUSH_HTTP_500",
      );
    });

    it("audits an attempt made while web push is switched off", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      await seedCustomer({
        follows: [{ targetType: "restaurant", targetId: restaurant.id }],
      });

      const result = await new BroadcastService({
        ...env,
        WEB_PUSH_ENABLED: "false",
      } as unknown as Env).send({
        scopeType: "restaurant",
        scopeId: restaurant.id,
        sentBy: user.id,
        title: "t",
        body: "b",
      });

      expect(deliverer).not.toHaveBeenCalled();
      expect(result.failedCount).toBe(1);
      const rows = await recipientsOf(result.id);
      expect(rows[0].errorCode).toBe("PUSH_ERROR");
    });
  });

  // ───────────────────── rate limit ─────────────────────

  describe("rate limit", () => {
    it("allows three restaurant sends a day and refuses the fourth", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      const service = new BroadcastService(env);
      const firstAt = Date.now();

      for (let i = 0; i < 3; i += 1) {
        await service.send({
          scopeType: "restaurant",
          scopeId: restaurant.id,
          sentBy: user.id,
          title: `t${i}`,
          body: "b",
          nowMs: firstAt + i * 60_000,
        });
      }

      await expect(
        service.send({
          scopeType: "restaurant",
          scopeId: restaurant.id,
          sentBy: user.id,
          title: "fourth",
          body: "b",
          nowMs: firstAt + 3 * 60_000,
        }),
      ).rejects.toMatchObject({
        code: "BROADCAST_RATE_LIMITED",
        status: 429,
        details: {
          limit: 3,
          windowMs: DAY_MS,
          // The oldest of the three has to age out: a day from its own send,
          // less the three minutes already elapsed.
          retryAfterMs: DAY_MS - 3 * 60_000,
        },
      });

      // A refused send leaves no row, which is what keeps the limiter and the
      // audit trail from being able to disagree.
      const [{ count }] = await testDb.drizzle
        .select({ count: sql<number>`COUNT(*)` })
        .from(marketingBroadcasts)
        .where(eq(marketingBroadcasts.scopeId, restaurant.id));
      expect(Number(count)).toBe(3);

      // Twenty-five hours later the oldest has left the window.
      await expect(
        service.send({
          scopeType: "restaurant",
          scopeId: restaurant.id,
          sentBy: user.id,
          title: "fifth",
          body: "b",
          nowMs: firstAt + 25 * 60 * 60 * 1000,
        }),
      ).resolves.toEqual(expect.objectContaining({ id: expect.any(String) }));
    });

    it("gives a market one send a day", async () => {
      const marketId = await seedMarket();
      const user = await seed.user({ role: 0 });
      const service = new BroadcastService(env);
      const firstAt = Date.now();

      await service.send({
        scopeType: "market",
        scopeId: marketId,
        sentBy: user.id,
        title: "t",
        body: "b",
        nowMs: firstAt,
      });

      await expect(
        service.send({
          scopeType: "market",
          scopeId: marketId,
          sentBy: user.id,
          title: "t2",
          body: "b",
          nowMs: firstAt + 1000,
        }),
      ).rejects.toMatchObject({
        code: "BROADCAST_RATE_LIMITED",
        details: { limit: 1, retryAfterMs: DAY_MS - 1000 },
      });
    });

    it("keeps one scope's budget out of another's", async () => {
      const first = await seed.restaurant();
      const second = await seed.restaurant();
      const user = await seed.user({ role: 0 });
      const service = new BroadcastService(env);
      const at = Date.now();

      for (let i = 0; i < 3; i += 1) {
        await service.send({
          scopeType: "restaurant",
          scopeId: first.id,
          sentBy: user.id,
          title: `t${i}`,
          body: "b",
          nowMs: at + i,
        });
      }

      await expect(
        service.send({
          scopeType: "restaurant",
          scopeId: second.id,
          sentBy: user.id,
          title: "t",
          body: "b",
          nowMs: at + 10,
        }),
      ).resolves.toEqual(expect.objectContaining({ audienceCount: 0 }));
    });
  });

  // ───────────────────── unknown scope + history ─────────────────────

  describe("scope lookups", () => {
    it("404s an unknown restaurant and an unknown market", async () => {
      const user = await seed.user({ role: 0 });
      const service = new BroadcastService(env);

      await expect(
        service.send({
          scopeType: "restaurant",
          scopeId: "no-such-restaurant",
          sentBy: user.id,
          title: "t",
          body: "b",
        }),
      ).rejects.toMatchObject({ code: "RESTAURANT_NOT_FOUND", status: 404 });

      await expect(
        service.send({
          scopeType: "market",
          scopeId: "no-such-market",
          sentBy: user.id,
          title: "t",
          body: "b",
        }),
      ).rejects.toMatchObject({ code: "MARKET_NOT_FOUND", status: 404 });
    });
  });

  describe("listHistory", () => {
    it("pages newest first and reports totals", async () => {
      const restaurant = await seed.restaurant();
      const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
      const at = Date.now();
      const service = new BroadcastService(env);
      for (let i = 0; i < 3; i += 1) {
        await service.send({
          scopeType: "restaurant",
          scopeId: restaurant.id,
          sentBy: user.id,
          title: `title-${i}`,
          body: "b",
          nowMs: at + i * 1000,
        });
      }

      const first = await service.listHistory(
        "restaurant",
        restaurant.id,
        1,
        2,
      );
      expect(first.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(first.broadcasts.map((row) => row.title)).toEqual([
        "title-2",
        "title-1",
      ]);
      expect(first.broadcasts[0]).toEqual(
        expect.objectContaining({
          scopeType: "restaurant",
          scopeId: restaurant.id,
          sentBy: user.id,
          createdAt: expect.any(Number),
        }),
      );

      const second = await service.listHistory(
        "restaurant",
        restaurant.id,
        2,
        2,
      );
      expect(second.broadcasts.map((row) => row.title)).toEqual(["title-0"]);
    });

    it("is empty for a scope that has never sent", async () => {
      const result = await new BroadcastService(env).listHistory(
        "market",
        "never-used",
        1,
        20,
      );
      expect(result).toEqual({
        broadcasts: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });
  });

  it("keeps market followers to the market and out of its vendors", async () => {
    const marketId = await seedMarket();
    const restaurant = await seed.restaurant();
    await testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: restaurant.id,
      marketId,
      isPrimary: true,
      joinedAt: new Date(),
    } as never);
    const user = await seed.user({ role: 0 });
    const marketFollower = await seedCustomer({
      follows: [{ targetType: "market", targetId: marketId }],
    });
    await seedCustomer({
      follows: [{ targetType: "restaurant", targetId: restaurant.id }],
    });

    const result = await new BroadcastService(env).send({
      scopeType: "market",
      scopeId: marketId,
      sentBy: user.id,
      title: "t",
      body: "b",
    });

    expect(result.audienceCount).toBe(1);
    const rows = await recipientsOf(result.id);
    expect(rows[0].customerId).toBe(marketFollower);
    const stored = await broadcastRow(result.id);
    expect(stored).toEqual(
      expect.objectContaining({
        scopeType: "market",
        marketId,
        restaurantId: null,
      }),
    );
  });

  it("records no attempt twice for one device", async () => {
    const restaurant = await seed.restaurant();
    const user = await seed.user({ restaurantId: restaurant.id, role: 1 });
    await seedCustomer({
      follows: [{ targetType: "restaurant", targetId: restaurant.id }],
    });

    const result = await new BroadcastService(env).send({
      scopeType: "restaurant",
      scopeId: restaurant.id,
      sentBy: user.id,
      title: "t",
      body: "b",
    });

    const [row] = await recipientsOf(result.id);
    await expect(
      testDb.drizzle.insert(marketingBroadcastRecipients).values({
        id: "duplicate-attempt",
        broadcastId: row.broadcastId,
        customerId: row.customerId,
        subscriptionId: row.subscriptionId,
        consentId: row.consentId,
        status: "delivered",
        createdAt: new Date(),
      } as never),
    ).rejects.toThrow();

    // ...but two customers can both be skipped in one send, because the
    // unique index sees NULL subscription ids as distinct.
    const [{ count }] = await testDb.drizzle
      .select({ count: sql<number>`COUNT(*)` })
      .from(marketingBroadcastRecipients)
      .where(
        and(
          eq(marketingBroadcastRecipients.broadcastId, row.broadcastId),
          eq(marketingBroadcastRecipients.status, "delivered"),
        ),
      );
    expect(Number(count)).toBe(1);
  });
});
