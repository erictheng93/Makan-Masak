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
import { groupMembers, groupOrders } from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  buildSeedHelpers,
  type SeedHelpers,
} from "../../../__tests__/integration/helpers/seed-helper";
import { GroupOrdersService } from "./GroupOrdersService";

/**
 * `getStatistics` runs its three aggregates under `Promise.allSettled`, so a
 * query that cannot even be bound comes back as a rejection that is swallowed
 * into a `0`. The sibling `GroupOrdersService.test.ts` feeds this method from a
 * hand-rolled db mock, which resolves whatever fixture it is handed and so can
 * never see a binding failure — the mock has no D1 to reject it. That is how
 * the "average group size" tile shipped reading 0 for every restaurant (#365):
 * the average-size subquery bound a `Date` into a `sql` fragment, where no
 * column mapper runs to turn it into the epoch-milliseconds integer
 * `created_at_ms` holds, and D1 answered `D1_TYPE_ERROR` on every call.
 *
 * So these run against a real (in-memory, miniflare) D1 applied from
 * `migrations_fresh`, in the default unit project rather than beside the
 * `*.real.integration.test.ts` suites — that project contributes nothing to the
 * `apps/api/src/features/**` coverage gate.
 */
describe("GroupOrdersService.getStatistics against real D1", () => {
  let testDb: TestDatabase;
  let seed: SeedHelpers;
  let loggedErrors: string[];

  beforeAll(async () => {
    testDb = await createTestDatabase();
    seed = buildSeedHelpers(testDb);
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    loggedErrors = [];
    // `ErrorTracker.logError` writes here and nowhere else, so this is the
    // observable sink for a swallowed `allSettled` rejection.
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      loggedErrors.push(parts.map((part) => String(part)).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const service = () => new GroupOrdersService(testDb.bindings.DB);

  const DAY_MS = 24 * 60 * 60 * 1000;

  function loggedStatisticsErrors(): string[] {
    return loggedErrors.filter((message) =>
      message.includes("Error in getStatistics"),
    );
  }

  let groupSeq = 0;

  async function seedGroup(input: {
    restaurantId: string;
    createdAtMs: number;
    members: number;
  }): Promise<string> {
    const id = `group-${++groupSeq}`;
    const createdAt = new Date(input.createdAtMs);

    await testDb.drizzle.insert(groupOrders).values({
      id,
      shareCode: `SHARE${groupSeq.toString().padStart(3, "0")}`,
      recoveryCode: `RECOVER${groupSeq.toString().padStart(3, "0")}`,
      restaurantId: input.restaurantId,
      status: "active",
      splitType: "individual",
      finalAmountCents: 12_000,
      expiresAt: new Date(input.createdAtMs + DAY_MS),
      settings: {},
      createdAt,
      updatedAt: createdAt,
    });

    await testDb.drizzle.insert(groupMembers).values(
      Array.from({ length: input.members }, (_unused, index) => ({
        id: `${id}-member-${index}`,
        groupOrderId: id,
        sessionId: `${id}-session-${index}`,
        name: `Member ${index}`,
        role: index === 0 ? "creator" : "member",
        permissions: {},
        joinedAt: createdAt,
        lastActiveAt: createdAt,
        isActive: true,
      })),
    );

    return id;
  }

  it("averages the member counts of the groups inside the window", async () => {
    const restaurant = await seed.restaurant();
    const now = Date.now();

    await seedGroup({
      restaurantId: restaurant.id,
      createdAtMs: now - DAY_MS,
      members: 2,
    });
    await seedGroup({
      restaurantId: restaurant.id,
      createdAtMs: now - 2 * DAY_MS,
      members: 4,
    });

    const stats = await service().getStatistics(restaurant.id, "month");

    expect(stats.averageGroupSize).toBe(3);
    expect(stats.totalGroupOrders).toBe(2);
    expect(loggedStatisticsErrors()).toEqual([]);
  });

  it("keeps the window and the restaurant filter on the average-size subquery", async () => {
    const restaurant = await seed.restaurant();
    const otherRestaurant = await seed.restaurant();
    const now = Date.now();

    await seedGroup({
      restaurantId: restaurant.id,
      createdAtMs: now - DAY_MS,
      members: 2,
    });
    await seedGroup({
      restaurantId: restaurant.id,
      createdAtMs: now - 2 * DAY_MS,
      members: 4,
    });
    // Older than the "month" window — including it would pull the average to 5.
    await seedGroup({
      restaurantId: restaurant.id,
      createdAtMs: now - 60 * DAY_MS,
      members: 9,
    });
    // Another tenant inside the window — including it would pull it to 5 too.
    await seedGroup({
      restaurantId: otherRestaurant.id,
      createdAtMs: now - DAY_MS,
      members: 9,
    });

    const stats = await service().getStatistics(restaurant.id, "month");

    expect(stats.averageGroupSize).toBe(3);
    expect(stats.totalGroupOrders).toBe(2);
    expect(loggedStatisticsErrors()).toEqual([]);
  });

  it("averages across every tenant when no restaurant is given", async () => {
    const restaurant = await seed.restaurant();
    const otherRestaurant = await seed.restaurant();
    const now = Date.now();

    await seedGroup({
      restaurantId: restaurant.id,
      createdAtMs: now - DAY_MS,
      members: 2,
    });
    await seedGroup({
      restaurantId: otherRestaurant.id,
      createdAtMs: now - DAY_MS,
      members: 4,
    });

    const stats = await service().getStatistics(undefined, "month");

    expect(stats.averageGroupSize).toBe(3);
    expect(stats.totalGroupOrders).toBe(2);
    expect(loggedStatisticsErrors()).toEqual([]);
  });

  it("reports no average at all when there is nothing in the window", async () => {
    const restaurant = await seed.restaurant();

    const stats = await service().getStatistics(restaurant.id, "month");

    expect(stats.averageGroupSize).toBe(0);
    expect(stats.totalGroupOrders).toBe(0);
    expect(loggedStatisticsErrors()).toEqual([]);
  });
});
