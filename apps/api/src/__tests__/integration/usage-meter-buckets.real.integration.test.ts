import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  restaurants,
  shopSubscriptions,
  usageEvents,
  usageMeterBuckets,
  usageMeters,
} from "@makanmasak/database";
import type { Env } from "../../types/env";
import { meterEmit } from "../../shared/utils/meter";
import { enforceQuota } from "../../middleware/quotaGate";
import { aggregateUsageMeters } from "../../workers/usage-aggregator";
import { cleanupExpiredUsageEvents } from "../../workers/usage-events-ttl";
import {
  USAGE_BUCKET_MS,
  recordUsageBucketDelta,
  sumUnfoldedBucketQuantities,
} from "../../shared/utils/usage-buckets";

const RESTAURANT_ID = "bucket-restaurant";
const OTHER_RESTAURANT_ID = "bucket-restaurant-2";
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fixed hour boundary well in the past, so "now" is never inside it. */
const HOUR_A = Date.UTC(2026, 5, 10, 9, 0, 0);
const HOUR_B = HOUR_A + USAGE_BUCKET_MS;

let testDb: TestDatabase;

function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: testDb.bindings.DB,
    CACHE_KV: testDb.bindings.CACHE_KV,
    ...overrides,
  } as Env;
}

function buildMeterContext(
  overrides: {
    restaurantId?: string;
    user?: { role: number; restaurantId: string };
  } = {},
) {
  const waitUntilPromises: Array<Promise<unknown>> = [];
  const headers = new Headers();
  const context = {
    env: buildEnv({ QUOTA_ENFORCEMENT_MODE: "enforce" } as Partial<Env>),
    get: (key: string) =>
      key === "user"
        ? (overrides.user ?? { role: 1, restaurantId: RESTAURANT_ID })
        : undefined,
    header: (key: string, value: string) => headers.set(key, value),
    executionCtx: {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      },
    },
  };

  return { context, waitUntilPromises, headers };
}

async function seedRestaurant(id: string, name: string) {
  await testDb.drizzle.insert(restaurants).values({
    id,
    name,
    type: "street_food",
    category: "snack",
    address: "1 Test Rd",
    district: "West",
    phone: "0900000000",
  });
}

/**
 * A paid subscription whose billing cycle brackets both fixture hours, so a
 * folded bucket has exactly one cycle it can land in.
 */
async function seedSubscription(restaurantId: string) {
  await testDb.drizzle.insert(shopSubscriptions).values({
    restaurantId,
    planTier: "pro",
    isActive: true,
    createdAt: new Date(HOUR_A - 30 * DAY_MS),
    billingCycleStartAt: new Date(HOUR_A - 10 * DAY_MS),
    billingCycleEndAt: new Date(HOUR_A + 20 * DAY_MS),
  });
}

async function readBuckets(restaurantId = RESTAURANT_ID) {
  const result = await testDb.bindings.DB.prepare(
    `SELECT restaurant_id, meter_key, bucket_start_ms, quantity, folded_at_ms
       FROM usage_meter_buckets
      WHERE restaurant_id = ?
      ORDER BY meter_key ASC, bucket_start_ms ASC`,
  )
    .bind(restaurantId)
    .all<{
      restaurant_id: string;
      meter_key: string;
      bucket_start_ms: number;
      quantity: number;
      folded_at_ms: number | null;
    }>();

  return result.results ?? [];
}

async function readMeters(restaurantId = RESTAURANT_ID) {
  const result = await testDb.bindings.DB.prepare(
    `SELECT meter_key, cycle_start_at_ms, cycle_end_at_ms, total_quantity
       FROM usage_meters
      WHERE restaurant_id = ?
      ORDER BY meter_key ASC, cycle_start_at_ms ASC`,
  )
    .bind(restaurantId)
    .all<{
      meter_key: string;
      cycle_start_at_ms: number;
      cycle_end_at_ms: number;
      total_quantity: number;
    }>();

  return result.results ?? [];
}

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.dispose();
});

beforeEach(async () => {
  await testDb.truncateAll();
  await seedRestaurant(RESTAURANT_ID, "Bucket Test Restaurant");
});

describe("usage_meter_buckets migration", () => {
  it("applies from the fresh track as a STRICT table keyed on the conflict target", async () => {
    const row = await testDb.bindings.DB.prepare(
      `SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'usage_meter_buckets'`,
    ).first<{ sql: string }>();

    expect(row?.sql).toBeTruthy();
    expect(row!.sql.replace(/\s+/g, " ").trim()).toMatch(/\) STRICT$/);
    expect(row!.sql).toContain(
      "PRIMARY KEY (restaurant_id, meter_key, bucket_start_ms)",
    );

    // Without STRICT, SQLite would silently store this TEXT in an INTEGER
    // column; the point of the keyword is that it does not.
    await expect(
      testDb.bindings.DB.prepare(
        `INSERT INTO usage_meter_buckets
           (restaurant_id, meter_key, bucket_start_ms, quantity)
         VALUES (?, 'api.requests', ?, 'not-a-number')`,
      )
        .bind(RESTAURANT_ID, HOUR_A)
        .run(),
    ).rejects.toThrow();
  });
});

describe("meterEmit bucket writes", () => {
  it("collapses two calls in the same hour into one row with quantity 2", async () => {
    const { context, waitUntilPromises } = buildMeterContext();

    await meterEmit(context as never, "api.requests");
    await meterEmit(context as never, "api.requests");
    await Promise.all(waitUntilPromises);

    const rows = await readBuckets();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      restaurant_id: RESTAURANT_ID,
      meter_key: "api.requests",
      quantity: 2,
      folded_at_ms: null,
    });
    // Never a per-request row again.
    const events = await testDb.bindings.DB.prepare(
      `SELECT COUNT(*) AS total FROM usage_events`,
    ).first<{ total: number }>();
    expect(events?.total).toBe(0);
  });

  it("reports a single changed row for the incrementing upsert", async () => {
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 1,
      occurredAtMs: HOUR_A + 5_000,
    });

    const before = await testDb.bindings.DB.prepare(
      `SELECT COUNT(*) AS total FROM usage_meter_buckets`,
    ).first<{ total: number }>();

    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 4,
      occurredAtMs: HOUR_A + 59_000,
    });

    const rows = await readBuckets();
    expect(before?.total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(5);
  });

  it("starts a new row when the hour rolls over, and keeps meters apart", async () => {
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 2,
      occurredAtMs: HOUR_A + 1_000,
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 3,
      occurredAtMs: HOUR_B + 1_000,
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "print.jobs",
      quantity: 1,
      occurredAtMs: HOUR_A + 2_000,
    });

    const rows = await readBuckets();
    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => [row.meter_key, row.bucket_start_ms, row.quantity]),
    ).toEqual([
      ["api.requests", HOUR_A, 2],
      ["api.requests", HOUR_B, 3],
      ["print.jobs", HOUR_A, 1],
    ]);
  });
});

describe("aggregateUsageMeters bucket folding", () => {
  beforeEach(async () => {
    await seedSubscription(RESTAURANT_ID);
  });

  it("folds a closed bucket into the right cycle and marks it folded", async () => {
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 12,
      occurredAtMs: HOUR_A + 1_000,
    });

    const result = await aggregateUsageMeters(buildEnv());

    expect(result.foldedBuckets).toBe(1);
    expect(await readMeters()).toEqual([
      {
        meter_key: "api.requests",
        cycle_start_at_ms: HOUR_A - 10 * DAY_MS,
        cycle_end_at_ms: HOUR_A + 20 * DAY_MS,
        total_quantity: 12,
      },
    ]);
    const rows = await readBuckets();
    expect(rows).toHaveLength(1);
    expect(rows[0].folded_at_ms).toEqual(expect.any(Number));
  });

  it("does not double count when the fold runs twice", async () => {
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 12,
      occurredAtMs: HOUR_A + 1_000,
    });

    await aggregateUsageMeters(buildEnv());
    const second = await aggregateUsageMeters(buildEnv());

    expect(second.foldedBuckets).toBe(0);
    expect(await readMeters()).toEqual([
      expect.objectContaining({ total_quantity: 12 }),
    ]);
  });

  it("leaves the open bucket alone so the rest of the hour is still counted", async () => {
    // The current hour is still receiving increments.
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 4,
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 6,
      occurredAtMs: HOUR_A + 1_000,
    });

    const result = await aggregateUsageMeters(buildEnv());

    expect(result.foldedBuckets).toBe(1);
    const rows = await readBuckets();
    expect(rows).toHaveLength(2);
    expect(
      rows.find((row) => row.bucket_start_ms === HOUR_A)?.folded_at_ms,
    ).toEqual(expect.any(Number));
    const open = rows.find((row) => row.bucket_start_ms !== HOUR_A);
    expect(open?.folded_at_ms).toBeNull();
    expect(await readMeters()).toEqual([
      expect.objectContaining({ total_quantity: 6 }),
    ]);
  });

  it("still folds usage_events, so storage snapshots keep reaching usage_meters", async () => {
    await testDb.drizzle.insert(usageEvents).values({
      restaurantId: RESTAURANT_ID,
      meterKey: "storage.bytes",
      quantity: 2048,
      occurredAt: new Date(HOUR_A + 1_000),
    });

    const result = await aggregateUsageMeters(buildEnv());

    expect(result.processed).toBe(1);
    expect(await readMeters()).toEqual([
      expect.objectContaining({
        meter_key: "storage.bytes",
        total_quantity: 2048,
      }),
    ]);
  });

  it("folds each restaurant against its own subscription cycle", async () => {
    await seedRestaurant(OTHER_RESTAURANT_ID, "Second Bucket Restaurant");
    await testDb.drizzle.insert(shopSubscriptions).values({
      restaurantId: OTHER_RESTAURANT_ID,
      planTier: "trial",
      isActive: true,
      createdAt: new Date(HOUR_A - 2 * DAY_MS),
      trialEndsAt: new Date(HOUR_A + 12 * DAY_MS),
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 3,
      occurredAtMs: HOUR_A + 1_000,
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: OTHER_RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 9,
      occurredAtMs: HOUR_A + 1_000,
    });

    await aggregateUsageMeters(buildEnv());

    expect(await readMeters()).toEqual([
      expect.objectContaining({
        cycle_start_at_ms: HOUR_A - 10 * DAY_MS,
        total_quantity: 3,
      }),
    ]);
    expect(await readMeters(OTHER_RESTAURANT_ID)).toEqual([
      expect.objectContaining({
        cycle_start_at_ms: HOUR_A - 2 * DAY_MS,
        cycle_end_at_ms: HOUR_A + 12 * DAY_MS,
        total_quantity: 9,
      }),
    ]);
  });
});

describe("usage TTL sweep", () => {
  it("deletes folded buckets past the cutoff and keeps unfolded ones", async () => {
    const now = Date.now();
    const expired = now - 120 * DAY_MS;
    const recent = now - 2 * DAY_MS;

    await testDb.drizzle.insert(usageMeterBuckets).values([
      {
        restaurantId: RESTAURANT_ID,
        meterKey: "api.requests",
        bucketStartAt: new Date(expired),
        quantity: 5,
        foldedAt: new Date(expired + USAGE_BUCKET_MS),
      },
      {
        // Same age, never folded: its quantity has not been billed yet.
        restaurantId: RESTAURANT_ID,
        meterKey: "print.jobs",
        bucketStartAt: new Date(expired),
        quantity: 7,
        foldedAt: null,
      },
      {
        restaurantId: RESTAURANT_ID,
        meterKey: "ai.requests",
        bucketStartAt: new Date(recent),
        quantity: 9,
        foldedAt: new Date(recent + USAGE_BUCKET_MS),
      },
    ]);

    const result = await cleanupExpiredUsageEvents(buildEnv(), now);

    expect(result.deletedBuckets).toBe(1);
    const remaining = await readBuckets();
    expect(remaining.map((row) => row.meter_key).sort()).toEqual([
      "ai.requests",
      "print.jobs",
    ]);
  });
});

describe("quota enforcement over unfolded buckets", () => {
  it("counts usage that only exists in an unfolded bucket", async () => {
    await testDb.drizzle.insert(shopSubscriptions).values({
      restaurantId: RESTAURANT_ID,
      planTier: "trial",
      isActive: true,
      createdAt: new Date(Date.now() - DAY_MS),
      trialEndsAt: new Date(Date.now() + 13 * DAY_MS),
    });
    // The trial hard limit for orders.created is 100 (PLAN_QUOTAS).
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "orders.created",
      quantity: 100,
    });

    const { context, waitUntilPromises, headers } = buildMeterContext();

    await expect(
      enforceQuota(context as never, "orders.created"),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED", status: 429 });
    await Promise.all(waitUntilPromises);
    expect(headers.get("X-Quota-Warning")).toBe("orders.created 100%");
  });

  it("adds unfolded buckets on top of the folded usage_meters total", async () => {
    // A trial cycle starts at the subscription's created_at to the
    // millisecond, and the aggregated lookup matches cycle_start_at_ms
    // exactly, so both have to come from one clock reading.
    const cycleStart = Date.now() - DAY_MS;
    await testDb.drizzle.insert(shopSubscriptions).values({
      restaurantId: RESTAURANT_ID,
      planTier: "trial",
      isActive: true,
      createdAt: new Date(cycleStart),
      trialEndsAt: new Date(cycleStart + 14 * DAY_MS),
    });
    await testDb.drizzle.insert(usageMeters).values({
      restaurantId: RESTAURANT_ID,
      meterKey: "orders.created",
      cycleStartAt: new Date(cycleStart),
      cycleEndAt: new Date(cycleStart + 14 * DAY_MS),
      totalQuantity: 60,
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "orders.created",
      quantity: 40,
    });

    const { context, waitUntilPromises, headers } = buildMeterContext();

    await expect(
      enforceQuota(context as never, "orders.created"),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED", status: 429 });
    await Promise.all(waitUntilPromises);
    expect(headers.get("X-Quota-Warning")).toBe("orders.created 100%");
  });
});

describe("sumUnfoldedBucketQuantities", () => {
  it("ignores folded buckets, other restaurants, and buckets outside the window", async () => {
    await seedRestaurant(OTHER_RESTAURANT_ID, "Second Bucket Restaurant");
    await testDb.drizzle.insert(usageMeterBuckets).values([
      {
        restaurantId: RESTAURANT_ID,
        meterKey: "api.requests",
        bucketStartAt: new Date(HOUR_A),
        quantity: 5,
      },
      {
        restaurantId: RESTAURANT_ID,
        meterKey: "api.requests",
        bucketStartAt: new Date(HOUR_B),
        quantity: 6,
        foldedAt: new Date(HOUR_B + USAGE_BUCKET_MS),
      },
      {
        restaurantId: RESTAURANT_ID,
        meterKey: "api.requests",
        bucketStartAt: new Date(HOUR_A - USAGE_BUCKET_MS),
        quantity: 99,
      },
      {
        restaurantId: OTHER_RESTAURANT_ID,
        meterKey: "api.requests",
        bucketStartAt: new Date(HOUR_A),
        quantity: 77,
      },
      {
        restaurantId: RESTAURANT_ID,
        meterKey: "print.jobs",
        bucketStartAt: new Date(HOUR_A),
        quantity: 2,
      },
    ]);

    const totals = await sumUnfoldedBucketQuantities(
      testDb.bindings.DB,
      RESTAURANT_ID,
      { fromMs: HOUR_A, toMs: HOUR_B + USAGE_BUCKET_MS },
    );

    expect(Object.fromEntries(totals)).toEqual({
      "api.requests": 5,
      "print.jobs": 2,
    });
  });
});

describe("UsageService reads across both metering tables", () => {
  beforeEach(async () => {
    await seedSubscription(RESTAURANT_ID);
  });

  it("lists hourly buckets alongside usage_events, newest first", async () => {
    await testDb.drizzle.insert(usageEvents).values({
      restaurantId: RESTAURANT_ID,
      meterKey: "storage.bytes",
      quantity: 4096,
      metadata: { source: "snapshot" },
      occurredAt: new Date(HOUR_A + 30 * 60 * 1000),
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 17,
      occurredAtMs: HOUR_B + 1_000,
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 3,
      occurredAtMs: HOUR_A + 1_000,
    });

    const { UsageService } =
      await import("../../features/billing/services/UsageService");
    const page = await new UsageService(testDb.bindings.DB).listUsageEvents(
      RESTAURANT_ID,
      { limit: 10 },
    );

    expect(page.total).toBe(3);
    expect(
      page.events.map((event) => [
        event.meterKey,
        event.quantity,
        event.occurredAt,
      ]),
    ).toEqual([
      ["api.requests", 17, HOUR_B],
      ["storage.bytes", 4096, HOUR_A + 30 * 60 * 1000],
      ["api.requests", 3, HOUR_A],
    ]);
    // A bucket reports pending/aggregated the same way an event does.
    expect(page.events[0]).toMatchObject({
      restaurantId: RESTAURANT_ID,
      aggregatedAt: null,
      id: expect.stringContaining("bucket:"),
    });
    expect(page.events[1]).toMatchObject({
      metadata: { source: "snapshot" },
    });
  });

  it("filters and paginates across the union", async () => {
    await testDb.drizzle.insert(usageEvents).values({
      restaurantId: RESTAURANT_ID,
      meterKey: "storage.bytes",
      quantity: 4096,
      occurredAt: new Date(HOUR_A + 30 * 60 * 1000),
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 17,
      occurredAtMs: HOUR_B + 1_000,
    });
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 3,
      occurredAtMs: HOUR_A + 1_000,
    });

    const { UsageService } =
      await import("../../features/billing/services/UsageService");
    const service = new UsageService(testDb.bindings.DB);

    const filtered = await service.listUsageEvents(RESTAURANT_ID, {
      meterKey: "api.requests",
    });
    expect(filtered.total).toBe(2);
    expect(filtered.events.map((event) => event.quantity)).toEqual([17, 3]);

    const secondPage = await service.listUsageEvents(RESTAURANT_ID, {
      limit: 2,
      page: 2,
    });
    expect(secondPage.total).toBe(3);
    expect(secondPage.events.map((event) => event.quantity)).toEqual([3]);
  });

  it("counts unfolded buckets in the current-cycle total", async () => {
    await recordUsageBucketDelta(testDb.bindings.DB, {
      restaurantId: RESTAURANT_ID,
      meterKey: "api.requests",
      quantity: 25,
      occurredAtMs: HOUR_A + 1_000,
    });

    const { UsageService } =
      await import("../../features/billing/services/UsageService");
    const service = new UsageService(testDb.bindings.DB);

    const before = await service.getCurrentUsage(RESTAURANT_ID, HOUR_A);
    expect(
      before.meters.find((meter) => meter.meterKey === "api.requests")?.total,
    ).toBe(25);

    // Folding moves the same 25 from the bucket into usage_meters; the total
    // the owner sees must not change when that happens.
    await aggregateUsageMeters(buildEnv());

    const after = await service.getCurrentUsage(RESTAURANT_ID, HOUR_A);
    expect(
      after.meters.find((meter) => meter.meterKey === "api.requests")?.total,
    ).toBe(25);
  });
});
