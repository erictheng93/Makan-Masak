import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { asc, eq } from "drizzle-orm";
import { customerConsents, customers } from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import type { Env } from "../../../types/env";

const authState = vi.hoisted((): { customerId: string } => ({
  customerId: "customer-1",
}));

vi.mock("../../../middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../middleware/auth")>();
  return {
    ...actual,
    canonicalCustomerAuthMiddleware: vi.fn(async (c, next) => {
      c.set("customer", {
        id: authState.customerId,
        displayName: "Customer",
        status: "active",
      });
      await next();
    }),
  };
});

import routes from "./index";

const MARKETING_VERSION = "2026-05-25-v1";

/**
 * The consent ledger, against a real D1 rather than the queued-result D1 mock
 * the rest of this feature's tests use.
 *
 * The marketing broadcast fan-out (#335) reads the *newest* consent row and
 * requires it to be a live grant. That makes the append order load-bearing in
 * a way it was not when nothing read these rows, and one ordering — grant,
 * revoke, grant again — is only observable against a database that actually
 * evaluates the duplicate-detection WHERE clause.
 */
describe("customer consents ledger", () => {
  let testDb: TestDatabase;
  let env: Env;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    vi.clearAllMocks();
    authState.customerId = `customer-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date();
    await testDb.drizzle.insert(customers).values({
      id: authState.customerId,
      displayName: "Customer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as never);
    env = {
      DB: testDb.bindings.DB,
      JWT_SECRET: "x".repeat(32),
      NODE_ENV: "test",
    } as unknown as Env;
  });

  function post(granted: boolean) {
    return routes.fetch(
      new Request("https://api.test/consents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({
          consentType: "marketing",
          version: MARKETING_VERSION,
          granted,
        }),
      }),
      env,
    );
  }

  async function ledger() {
    return testDb.drizzle
      .select({
        id: customerConsents.id,
        granted: customerConsents.granted,
        revokedAt: customerConsents.revokedAt,
      })
      .from(customerConsents)
      .where(eq(customerConsents.customerId, authState.customerId))
      .orderBy(asc(customerConsents.grantedAt), asc(customerConsents.id));
  }

  it("lets a customer opt back in after opting out", async () => {
    expect((await post(true)).status).toBe(201);
    expect((await post(false)).status).toBe(201);
    // The re-grant must append a row. Matching it against the *revoked* grant
    // still on the table and calling it a duplicate would leave the newest
    // row saying "no" forever, so the customer could never rejoin an
    // audience.
    expect((await post(true)).status).toBe(201);

    const rows = await ledger();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.granted)).toEqual([1, 0, 1]);
    // The first grant carries the withdrawal timestamp; the newest does not.
    expect(rows[0].revokedAt).not.toBeNull();
    expect(rows[2].revokedAt).toBeNull();
  });

  it("still collapses a repeated grant into the row already standing", async () => {
    const first = await post(true);
    expect(first.status).toBe(201);

    const repeat = await post(true);
    expect(repeat.status).toBe(200);
    await expect(repeat.json()).resolves.toMatchObject({
      data: { id: ((await first.json()) as { data: { id: string } }).data.id },
    });
    expect(await ledger()).toHaveLength(1);
  });

  it("collapses a repeated withdrawal too", async () => {
    await post(true);
    expect((await post(false)).status).toBe(201);
    expect((await post(false)).status).toBe(200);
    expect(await ledger()).toHaveLength(2);
  });

  it("shows only the live grant in GET /consents", async () => {
    await post(true);
    await post(false);
    await post(true);

    const response = await routes.fetch(
      new Request("https://api.test/consents", {
        headers: { Authorization: "Bearer token" },
      }),
      env,
    );
    const payload = (await response.json()) as {
      data: Array<{ id: string; granted: number }>;
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].granted).toBe(1);
  });
});
