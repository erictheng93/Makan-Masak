import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { shopSubscriptions } from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers, type SeedHelpers } from "./helpers/seed-helper";

const CSRF_TOKEN = "c".repeat(64);
const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  "x-csrf-token": CSRF_TOKEN,
  cookie: `csrf_token=${CSRF_TOKEN}`,
};

// The per-shift wage snapshot is owner/admin data: only they may correct it
// (PUT /schedules/:id), and roles 2-4 never read it.
describe("schedule wage snapshot — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: SeedHelpers;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  });

  afterAll(async () => {
    await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  async function completedShift() {
    const restaurant = await seed.restaurant({ settings: { currency: "TWD" } });
    // Scheduling sits behind the staff_management module (enterprise).
    await testApp.testDb.drizzle.insert(shopSubscriptions).values({
      restaurantId: restaurant.id,
      planTier: "enterprise",
      isActive: true,
    });
    const owner = await seed.user({ restaurantId: restaurant.id, role: 1 });
    const chef = await seed.user({ restaurantId: restaurant.id, role: 2 });
    await testApp.testDb.db
      .prepare(
        `INSERT INTO employee_schedules
           (id, restaurant_id, employee_id, work_date, start_time, end_time,
            break_duration_minutes, scheduled_hours, actual_hours, status,
            clock_in_time_ms, clock_out_time_ms, hourly_rate_cents,
            created_by, created_at_ms, updated_at_ms)
         VALUES (1, ?, ?, '2026-09-01', '09:00', '13:00', 0, 4, 4, 'completed',
                 1735689600000, 1735704000000, 12000, ?, 1735689600000, 1735689600000)`,
      )
      .bind(restaurant.id, chef.id, owner.id)
      .run();
    return {
      ownerToken: await testApp.authHelper.ownerToken(owner.id, restaurant.id),
      chefToken: await testApp.authHelper.staffToken(chef.id, 2, restaurant.id),
    };
  }

  const call = (
    token: string,
    method: string,
    body?: Record<string, unknown>,
  ) =>
    testApp.app.fetch(
      new Request("https://test/api/v1/scheduling/schedules/1", {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...CSRF_HEADERS,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );

  const storedRate = async () =>
    (
      await testApp.testDb.db
        .prepare("SELECT hourly_rate_cents AS r FROM employee_schedules")
        .first<{ r: number | null }>()
    )?.r;

  it("lets an owner correct the snapshot, refusing an off-step TWD amount", async () => {
    const { ownerToken } = await completedShift();

    const offStep = await call(ownerToken, "PUT", { hourlyRateCents: 17550 });
    expect(offStep.status).toBe(400);
    expect(await offStep.json()).toMatchObject({
      error: { code: "CURRENCY_PRECISION" },
    });

    const ok = await call(ownerToken, "PUT", { hourlyRateCents: 17500 });
    expect(ok.status).toBe(200);
    expect(await storedRate()).toBe(17500);

    const notCompleted = await call(ownerToken, "PUT", {
      status: "confirmed",
      hourlyRateCents: 17500,
    });
    expect(notCompleted.status).toBe(400);
    expect(await storedRate()).toBe(17500);
  });

  it("refuses the write to a chef and hides the snapshot from their read", async () => {
    const { chefToken } = await completedShift();

    const write = await call(chefToken, "PUT", { hourlyRateCents: 99900 });
    expect(write.status).toBe(403);
    expect(await storedRate()).toBe(12000);

    const read = await call(chefToken, "GET");
    expect(read.status).toBe(200);
    const body = (await read.json()) as { data: Record<string, unknown> };
    expect(body.data).not.toHaveProperty("hourlyRateCents");
  });
});
