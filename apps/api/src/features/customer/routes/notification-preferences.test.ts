import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq } from "drizzle-orm";
import {
  customerNotificationPreferences,
  customers,
} from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import { ApiError } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

const authState = vi.hoisted((): { customerId: string | null } => ({
  customerId: null,
}));

/**
 * The canonical customer middleware is stubbed only when a test has an
 * identity to inject — it otherwise delegates to the real one, so the 401
 * below is produced by production code rather than by this file.
 */
vi.mock("../../../middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../middleware/auth")>();
  return {
    ...actual,
    canonicalCustomerAuthMiddleware: vi.fn(async (c, next) => {
      if (!authState.customerId) {
        return actual.canonicalCustomerAuthMiddleware(c, next);
      }
      c.set("customer", {
        id: authState.customerId,
        displayName: "Customer",
        status: "active",
      });
      await next();
    }),
  };
});

import routes, {
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "./notification-preferences";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as ContentfulStatusCode,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

/**
 * Against a real D1 rather than the queue-of-canned-results mock the rest of
 * the customer feature uses: "no row yet means these defaults" is a claim
 * about what the database returns, and a mock told to return nothing proves
 * only that it was told.
 */
describe("customer notification preferences", () => {
  let testDb: TestDatabase;
  let env: Env;
  let customerId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    vi.clearAllMocks();
    customerId = `customer-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date();
    await testDb.drizzle.insert(customers).values({
      id: customerId,
      displayName: "Customer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as never);
    authState.customerId = customerId;
    env = {
      DB: testDb.bindings.DB,
      JWT_SECRET: "x".repeat(32),
    } as unknown as Env;
  });

  function call(method: string, body?: unknown) {
    return routes.fetch(
      new Request("https://api.test/notification-preferences", {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  }

  async function readJson(res: Response) {
    return (await res.json()) as {
      success: boolean;
      data?: Record<string, unknown>;
      error?: { code?: string };
    };
  }

  it("answers with the defaults before anything is stored", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      marketingEnabled: true,
      followedOnly: true,
      quietHoursStartMin: null,
      quietHoursEndMin: null,
      updatedAt: null,
    });
  });

  it("stores a full set and reads it back", async () => {
    const res = await call("PUT", {
      marketingEnabled: false,
      followedOnly: false,
      quietHoursStartMin: 1380,
      quietHoursEndMin: 420,
    });

    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual({
      marketingEnabled: false,
      followedOnly: false,
      quietHoursStartMin: 1380,
      quietHoursEndMin: 420,
      updatedAt: expect.any(Number),
    });

    expect((await readJson(await call("GET"))).data).toEqual(
      expect.objectContaining({
        marketingEnabled: false,
        followedOnly: false,
        quietHoursStartMin: 1380,
      }),
    );

    const [row] = await testDb.drizzle
      .select()
      .from(customerNotificationPreferences)
      .where(eq(customerNotificationPreferences.customerId, customerId));
    // Booleans cross the boundary as the 0/1 the STRICT column declares.
    expect(row).toEqual(
      expect.objectContaining({ marketingEnabled: 0, followedOnly: 0 }),
    );
  });

  it("keeps the fields a partial PUT leaves out", async () => {
    await call("PUT", {
      marketingEnabled: false,
      quietHoursStartMin: 1380,
      quietHoursEndMin: 420,
    });

    const res = await call("PUT", { followedOnly: false });

    expect((await readJson(res)).data).toEqual(
      expect.objectContaining({
        marketingEnabled: false,
        followedOnly: false,
        quietHoursStartMin: 1380,
        quietHoursEndMin: 420,
      }),
    );
  });

  it("upserts rather than duplicating the row", async () => {
    await call("PUT", { marketingEnabled: false });
    await call("PUT", { marketingEnabled: true });

    const rows = await testDb.drizzle
      .select()
      .from(customerNotificationPreferences)
      .where(eq(customerNotificationPreferences.customerId, customerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].marketingEnabled).toBe(1);
  });

  it("clears quiet hours when both bounds are sent as null", async () => {
    await call("PUT", { quietHoursStartMin: 1380, quietHoursEndMin: 420 });
    const res = await call("PUT", {
      quietHoursStartMin: null,
      quietHoursEndMin: null,
    });

    expect((await readJson(res)).data).toEqual(
      expect.objectContaining({
        quietHoursStartMin: null,
        quietHoursEndMin: null,
      }),
    );
  });

  it("refuses half a quiet window", async () => {
    const res = await call("PUT", { quietHoursStartMin: 1380 });

    expect(res.status).toBe(400);
    expect((await readJson(res)).error?.code).toBe("QUIET_HOURS_INCOMPLETE");

    // ...and clearing only one bound of a stored window is the same mistake.
    await call("PUT", { quietHoursStartMin: 1380, quietHoursEndMin: 420 });
    const cleared = await call("PUT", { quietHoursEndMin: null });
    expect(cleared.status).toBe(400);
  });

  it.each([
    ["a minute past midnight-plus-a-day", { quietHoursStartMin: 1440 }],
    ["a negative minute", { quietHoursStartMin: -1 }],
    ["a non-integer minute", { quietHoursStartMin: 12.5 }],
    ["a non-boolean toggle", { marketingEnabled: "yes" }],
  ])("rejects %s", async (_label, body) => {
    const res = await call("PUT", body);
    expect(res.status).toBe(400);
  });

  it("requires a customer token", async () => {
    authState.customerId = null;
    expect((await call("GET")).status).toBe(401);
    expect((await call("PUT", { marketingEnabled: false })).status).toBe(401);
  });
});
