import { beforeEach, describe, expect, it, vi } from "vitest";

// Bucket reads are Drizzle and cannot run against the hand-rolled D1 stub
// below. Stubbing the helper keeps these tests on what they cover — cycle
// resolution and the shape of each response — while the bucket arithmetic and
// the two-table history read are proven against real D1 in
// usage-meter-buckets.real.integration.test.ts.
const sumUnfoldedBucketQuantities = vi.hoisted(() =>
  vi.fn(async () => new Map<string, number>()),
);
vi.mock("../../../shared/utils/usage-buckets", () => ({
  sumUnfoldedBucketQuantities,
}));

import { UsageService } from "./UsageService";

vi.mock("@makanmasak/utils", () => ({
  generateUUID: vi
    .fn()
    .mockReturnValueOnce("usage-event-1")
    .mockReturnValueOnce("usage-event-2"),
}));

type QueryResult = unknown[] | Record<string, unknown> | null;

interface PreparedStatement {
  sql: string;
  values: unknown[];
  all: ReturnType<typeof vi.fn>;
  bind: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

function createDb(results: Record<string, QueryResult>) {
  const statements: PreparedStatement[] = [];
  const keyFor = (sql: string) => {
    if (sql.includes("FROM shop_subscriptions")) return "subscription";
    if (sql.includes("FROM usage_meters") && sql.includes("ORDER BY")) {
      return "cycles";
    }
    if (sql.includes("FROM usage_meters")) return "meters";
    if (sql.includes("SUM(quantity)")) return "pending";
    if (sql.includes("COUNT(*) AS total")) return "eventCount";
    if (sql.includes("FROM usage_events") && sql.includes("ORDER BY")) {
      return "events";
    }
    if (sql.includes("FROM storage_counters")) return "storageCounters";
    if (sql.includes("INSERT INTO usage_events")) return "insertUsageEvent";
    return sql;
  };

  return {
    statements,
    db: {
      prepare: vi.fn((sql: string) => {
        const key = keyFor(sql);
        const statement: PreparedStatement = {
          sql,
          values: [],
          bind: vi.fn((...values: unknown[]) => {
            statement.values = values;
            return statement;
          }),
          first: vi.fn(async () => results[key] ?? null),
          all: vi.fn(async () => ({
            results: Array.isArray(results[key]) ? results[key] : [],
          })),
          run: vi.fn(async () => ({ success: true })),
        };
        statements.push(statement);
        return statement;
      }),
    },
  };
}

describe("UsageService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sumUnfoldedBucketQuantities.mockResolvedValue(new Map());
  });

  it("combines aggregated and pending usage for an active paid cycle", async () => {
    const { db } = createDb({
      subscription: {
        plan_tier: "growth",
        trial_ends_at_ms: null,
        billing_cycle_start_at_ms: 1710000000000,
        billing_cycle_end_at_ms: 1712678400000,
        created_at_ms: 1709000000000,
      },
      meters: [
        { meter_key: "orders.created", total_quantity: 80 },
        { meter_key: "storage.bytes", total_quantity: 1_000 },
      ],
      pending: [
        { meter_key: "orders.created", total_quantity: 5 },
        { meter_key: "storage.bytes", total_quantity: 250 },
      ],
    });
    sumUnfoldedBucketQuantities.mockResolvedValueOnce(
      new Map([["orders.created", 7]]),
    );

    const usage = await new UsageService(db as never).getCurrentUsage(
      "restaurant-1",
      1710500000000,
    );

    expect(usage).toMatchObject({
      cycleStartAt: 1710000000000,
      cycleEndAt: 1712678400000,
    });
    expect(sumUnfoldedBucketQuantities).toHaveBeenCalledWith(
      expect.anything(),
      "restaurant-1",
      expect.objectContaining({
        fromMs: 1710000000000,
        toMs: 1712678400000,
      }),
    );
    expect(usage.meters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meterKey: "orders.created",
          // 80 aggregated + 5 pending events + 7 still in an unfolded bucket.
          total: 92,
        }),
        expect.objectContaining({
          meterKey: "storage.bytes",
          total: 1250,
        }),
      ]),
    );
  });

  it("uses trial and fallback monthly cycles when subscription dates are absent", async () => {
    const trial = createDb({
      subscription: {
        plan_tier: "trial",
        trial_ends_at_ms: null,
        billing_cycle_start_at_ms: null,
        billing_cycle_end_at_ms: null,
        created_at_ms: 1710000000000,
      },
      meters: [],
      pending: [],
    });

    await expect(
      new UsageService(trial.db as never).getCurrentUsage(
        "restaurant-1",
        1710500000000,
      ),
    ).resolves.toMatchObject({
      cycleStartAt: 1710000000000,
      cycleEndAt: 1710000000000 + 14 * 24 * 60 * 60 * 1000,
    });

    const fallback = createDb({
      subscription: null,
      meters: [],
      pending: [],
    });
    await expect(
      new UsageService(fallback.db as never).getCurrentUsage(
        "restaurant-1",
        Date.UTC(2026, 5, 7),
      ),
    ).resolves.toMatchObject({
      cycleStartAt: Date.UTC(2026, 5, 1),
      cycleEndAt: Date.UTC(2026, 6, 1),
    });
  });

  it("groups historical cycle usage and preserves the latest aggregation time", async () => {
    const { db, statements } = createDb({
      cycles: [
        {
          cycle_start_at_ms: 1710000000000,
          cycle_end_at_ms: 1712678400000,
          meter_key: "orders.created",
          total_quantity: 100,
          last_aggregated_at_ms: 1711000000000,
        },
        {
          cycle_start_at_ms: 1710000000000,
          cycle_end_at_ms: 1712678400000,
          meter_key: "storage.bytes",
          total_quantity: 200,
          last_aggregated_at_ms: 1712000000000,
        },
      ],
    });

    const cycles = await new UsageService(db as never).listCycleUsage(
      "restaurant-1",
      1709000000000,
      1713000000000,
    );

    expect(statements[0].values).toEqual([
      "restaurant-1",
      1709000000000,
      1713000000000,
    ]);
    expect(cycles).toEqual([
      {
        cycleStartAt: 1710000000000,
        cycleEndAt: 1712678400000,
        meters: {
          "orders.created": 100,
          "storage.bytes": 200,
        },
        lastAggregatedAt: 1712000000000,
      },
    ]);
  });

  it("emits storage snapshot usage events for non-empty counters", async () => {
    const { db, statements } = createDb({
      storageCounters: [
        {
          restaurant_id: "restaurant-1",
          r2_bytes: 1024,
          images_count: 3,
        },
        {
          restaurant_id: "restaurant-2",
          r2_bytes: 2048,
          images_count: 4,
        },
      ],
    });

    await expect(
      new UsageService(db as never).emitStorageSnapshots(1710000000000),
    ).resolves.toEqual({ emitted: 2 });

    const inserts = statements.filter((statement) =>
      statement.sql.includes("INSERT INTO usage_events"),
    );
    expect(inserts.map((statement) => statement.values)).toEqual([
      [
        "usage-event-1",
        "restaurant-1",
        "storage.bytes",
        1024,
        JSON.stringify({ imagesCount: 3, source: "snapshot" }),
        1710000000000,
      ],
      [
        "usage-event-2",
        "restaurant-2",
        "storage.bytes",
        2048,
        JSON.stringify({ imagesCount: 4, source: "snapshot" }),
        1710000000000,
      ],
    ]);
  });
});
