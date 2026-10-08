import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@makanmasak/database/testing";
import { restaurants, shopSubscriptions } from "@makanmasak/database";
import type { Env } from "../../types/env";
import { BillingReminderService } from "../../features/billing/services/BillingNotificationService";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 10, 2, 15);

let testDb: TestDatabase;

const env = () =>
  ({ DB: testDb.bindings.DB, CACHE_KV: testDb.bindings.CACHE_KV }) as Env;

async function seedTrial(
  id: string,
  trialEndsAt: number,
  email = `${id}@x.io`,
) {
  await testDb.drizzle.insert(restaurants).values({
    id,
    name: id,
    email,
    type: "street_food",
    category: "snack",
    address: "1 Test Rd",
    district: "West",
    phone: "0900000000",
  });
  await testDb.drizzle.insert(shopSubscriptions).values({
    restaurantId: id,
    planTier: "trial",
    isActive: true,
    createdAt: new Date(NOW - 100 * DAY_MS),
    trialEndsAt: new Date(trialEndsAt),
  });
}

async function dispatched() {
  const { results } = await testDb.bindings.DB.prepare(
    `SELECT restaurant_id, kind FROM notification_dispatch_log
      ORDER BY restaurant_id, kind`,
  ).all<{ restaurant_id: string; kind: string }>();
  return (results ?? []).map((r) => `${r.restaurant_id}:${r.kind}`);
}

const run = (now: number) =>
  new BillingReminderService(env()).sendTrialEndingReminders(now);

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb?.dispose();
});
beforeEach(async () => {
  await testDb.truncateAll();
});

describe("BillingReminderService catch-up", () => {
  it("sends each notice once and never touches the subscription", async () => {
    await seedTrial("ends-3d", NOW + 3 * DAY_MS + 3_600_000);
    await seedTrial("ends-1d", NOW + DAY_MS + 3_600_000 - DAY_MS / 2);
    await seedTrial("ended", NOW - 3_600_000);
    await seedTrial("far", NOW + 30 * DAY_MS);

    expect(await run(NOW)).toEqual({ attempted: 3 });
    expect(await dispatched()).toEqual([
      "ended:trial_0d",
      "ends-1d:trial_1d",
      "ends-3d:trial_3d",
    ]);

    expect(await run(NOW)).toEqual({ attempted: 0 });
    const { results } = await testDb.bindings.DB.prepare(
      `SELECT plan_tier FROM shop_subscriptions`,
    ).all<{ plan_tier: string }>();
    expect(results?.every((r) => r.plan_tier === "trial")).toBe(true);
  });

  it("catches up after skipped cron days instead of losing the notice", async () => {
    // Expired 30h ago: a strict 24h window would already have slid past it.
    await seedTrial("missed-0d", NOW - 30 * 3_600_000);
    // 3-day mark passed 1.5 days ago; the run two days on still sends trial_3d.
    await seedTrial("missed-3d", NOW + 2 * DAY_MS + DAY_MS / 2);

    expect(await run(NOW)).toEqual({ attempted: 2 });
    expect(await dispatched()).toEqual([
      "missed-0d:trial_0d",
      "missed-3d:trial_3d",
    ]);
  });

  it("does not mail expiries older than the lookback", async () => {
    await seedTrial("long-ago", NOW - 30 * DAY_MS);
    expect(await run(NOW)).toEqual({ attempted: 0 });
  });

  it("does not let already-notified rows starve the 250-row batch", async () => {
    for (let i = 0; i < 250; i++) {
      await seedTrial(`old-${i}`, NOW - 2 * DAY_MS + i);
    }
    await seedTrial("late-arrival", NOW - 1 * DAY_MS);

    expect(await run(NOW)).toEqual({ attempted: 250 });
    // Second run: the 250 are logged, so the remaining row is reachable.
    expect(await run(NOW)).toEqual({ attempted: 1 });
    expect(await dispatched()).toContain("late-arrival:trial_0d");
  });

  it("gives a shop without an email a terminal record instead of retrying daily", async () => {
    await seedTrial("no-email", NOW - 3_600_000, "");
    await run(NOW);
    expect(await run(NOW)).toEqual({ attempted: 0 });
  });
});
