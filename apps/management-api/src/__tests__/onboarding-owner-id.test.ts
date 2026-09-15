import { describe, expect, it, vi, beforeEach } from "vitest";
import { OnboardingService } from "../services/OnboardingService";
import { planIdToTier } from "@makanmasak/database";
import type { ManagementEnv, OnboardingApplication } from "../types";

// Mirrors apps/image-processor/src/middleware/auth.ts UUID_V7_PATTERN. Any
// platform user id that fails this regex gets a 401 from image-processor, so a
// v4 owner id silently breaks menu image upload for the whole tenant.
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const insertedRows: Array<{ table: string; values: Record<string, unknown> }> =
  [];
let batchError: Error | undefined;

vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => ({
    insert: (table: { _: { name?: string } } & Record<string, unknown>) => ({
      values: (values: Record<string, unknown>) => {
        insertedRows.push({ table: tableNameOf(table), values });
        return { __statement: true };
      },
    }),
    batch: async () => {
      if (batchError) throw batchError;
      return [];
    },
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [], get: async () => undefined }),
      }),
    }),
  }),
}));

vi.mock("bcryptjs", () => ({
  default: { hash: async () => "hashed" },
}));

function tableNameOf(table: unknown): string {
  const symbols = Object.getOwnPropertySymbols(table as object);
  for (const symbol of symbols) {
    const value = (table as Record<symbol, unknown>)[symbol];
    if (typeof value === "string") return value;
  }
  return "unknown";
}

function buildApplication(
  overrides: Partial<OnboardingApplication> = {},
): OnboardingApplication {
  return {
    id: "APP-20260725-TEST0001",
    businessName: "Demo Noodles",
    contactName: "Lin Mei",
    contactEmail: "mei@example.test",
    contactPhone: "0912345678",
    latitude: 24.147736,
    longitude: 120.673648,
    planId: "trial",
    assignedSubdomain: "demo-noodles",
    status: "submitted",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    ...overrides,
  } as OnboardingApplication;
}

function buildEnv(
  cacheKv?: KVNamespace,
  overrides: Partial<ManagementEnv> = {},
): ManagementEnv {
  const noRowStatement = {
    bind: () => noRowStatement,
    first: async () => null,
    run: async () => ({ success: true }),
    all: async () => ({ results: [] }),
  };

  return {
    NODE_ENV: "test",
    API_VERSION: "v1",
    API_BASE_URL: "http://localhost",
    ADMIN_APP_URL: "http://localhost:3001",
    CORS_ORIGIN: "http://localhost:5173",
    LOG_LEVEL: "error",
    JWT_SECRET: "test-secret",
    CF_API_TOKEN: "test-token",
    CF_ACCOUNT_ID: "test-account",
    MANAGEMENT_DB: { prepare: () => noRowStatement } as unknown as D1Database,
    PLATFORM_DB: { prepare: () => noRowStatement } as unknown as D1Database,
    CACHE_KV:
      cacheKv ??
      ({
        list: async () => ({
          keys: [],
          list_complete: true,
          cacheStatus: null,
        }),
        delete: async () => undefined,
      } as unknown as KVNamespace),
    DEPLOYMENT_STATUS_KV: {} as KVNamespace,
    BUNDLE_STORAGE: {} as R2Bucket,
    ...overrides,
  } as unknown as ManagementEnv;
}

type OwnerAccountFactory = (
  application: OnboardingApplication,
  tenantId: string,
) => Promise<ProvisionedOwnerAccountForTest>;

interface ProvisionedOwnerAccountForTest {
  restaurantId: string;
  userId: string;
  username: string;
  setupPasswordToken: string;
  setupPasswordLink: string;
  setupPasswordExpiresAt: string;
}

interface ActivationServiceForTest {
  activateApplication: (
    applicationId: string,
  ) => Promise<{ success: boolean; error?: string }>;
  getApplication: ReturnType<typeof vi.fn>;
  updateApplicationStatus: ReturnType<typeof vi.fn>;
  createTenantWithSubscription: ReturnType<typeof vi.fn>;
  createPlatformOwnerAccount: ReturnType<typeof vi.fn>;
  createCredentialDelivery: ReturnType<typeof vi.fn>;
  rollbackPlatformOwnerAccount: ReturnType<typeof vi.fn>;
  rollbackTenantProvisioning: ReturnType<typeof vi.fn>;
}

function createPlatformOwnerAccount(env: ManagementEnv): OwnerAccountFactory {
  const service = new OnboardingService(env) as unknown as {
    createPlatformOwnerAccount: OwnerAccountFactory;
  };

  return service.createPlatformOwnerAccount.bind(service);
}

beforeEach(() => {
  insertedRows.length = 0;
  batchError = undefined;
});

describe("onboarding platform owner provisioning", () => {
  it("issues UUID v7 ids that image-processor will accept", async () => {
    const account = await createPlatformOwnerAccount(buildEnv())(
      buildApplication(),
      "tenant-1",
    );

    expect(account.restaurantId).toMatch(UUID_V7_PATTERN);
    expect(account.userId).toMatch(UUID_V7_PATTERN);
  });

  it("persists the same v7 ids onto the platform restaurant and user rows", async () => {
    const account = await createPlatformOwnerAccount(buildEnv())(
      buildApplication(),
      "tenant-1",
    );

    const restaurantRow = insertedRows.find(
      (row) => row.values.id === account.restaurantId,
    );
    const userRow = insertedRows.find(
      (row) => row.values.username !== undefined,
    );

    expect(restaurantRow).toBeDefined();
    expect(userRow).toMatchObject({
      values: expect.objectContaining({
        id: account.userId,
        restaurantId: account.restaurantId,
        role: 1,
      }),
    });
    expect(String(userRow?.values.id)).toMatch(UUID_V7_PATTERN);
  });

  it("invalidates every cached restaurant list after provisioning", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        keys: [
          { name: "restaurants:list" },
          { name: "restaurants:list:limit:20:page:1" },
          { name: "restaurants:listening" },
        ],
        list_complete: false,
        cursor: "next-page",
        cacheStatus: null,
      })
      .mockResolvedValueOnce({
        keys: [{ name: "restaurants:list:type:onboarding" }],
        list_complete: true,
        cacheStatus: null,
      });
    const deleteKey = vi.fn().mockResolvedValue(undefined);
    const cacheKv = {
      list,
      delete: deleteKey,
    } as unknown as KVNamespace;

    await createPlatformOwnerAccount(buildEnv(cacheKv))(
      buildApplication(),
      "tenant-1",
    );

    expect(list).toHaveBeenNthCalledWith(1, {
      prefix: "restaurants:list",
      cursor: undefined,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: "restaurants:list",
      cursor: "next-page",
    });
    expect(deleteKey.mock.calls.map(([key]) => key)).toEqual([
      "restaurants:list",
      "restaurants:list:limit:20:page:1",
      "restaurants:list:type:onboarding",
    ]);
  });

  // Regression: TenantService writes shop_subscriptions into the MANAGEMENT db
  // keyed by tenant id. apps/api moduleGate reads shop_subscriptions from the
  // PLATFORM db keyed by restaurant_id — without a platform row every
  // onboarded owner got 403 SUBSCRIPTION_NOT_FOUND on module-gated endpoints.
  it("inserts a platform shop_subscriptions row for the new restaurant", async () => {
    const account = await createPlatformOwnerAccount(buildEnv())(
      buildApplication({ planId: "trial" }),
      "tenant-1",
    );

    const subscriptionRow = insertedRows.find(
      (row) => row.values.planTier !== undefined,
    );

    expect(subscriptionRow).toBeDefined();
    expect(subscriptionRow?.table).toBe("shop_subscriptions");
    expect(subscriptionRow).toMatchObject({
      values: expect.objectContaining({
        id: expect.any(String),
        restaurantId: account.restaurantId,
        planTier: "trial",
        isActive: true,
      }),
    });
    // Domain entity ids are UUID v7 across the platform.
    expect(String(subscriptionRow?.values.id)).toMatch(UUID_V7_PATTERN);
    // A trial row without trialEndsAt would never expire; moduleGate reads it.
    expect(subscriptionRow?.values.trialEndsAt).toBeInstanceOf(Date);
  });

  it("keeps internal provisioning notes out of the public restaurant description", async () => {
    await createPlatformOwnerAccount(buildEnv())(
      buildApplication(),
      "tenant-1",
    );

    const restaurantRow = insertedRows.find(
      (row) => row.table === "restaurants",
    );
    const subscriptionRow = insertedRows.find(
      (row) => row.table === "shop_subscriptions",
    );

    expect(restaurantRow?.values.description).toBeNull();
    expect(subscriptionRow?.values.notes).toContain(
      "Provisioned from onboarding application APP-20260725-TEST0001",
    );
  });

  it("maps the application plan to the same tier TenantService uses", async () => {
    await createPlatformOwnerAccount(buildEnv())(
      buildApplication({ planId: "professional" }),
      "tenant-1",
    );

    const subscriptionRow = insertedRows.find(
      (row) => row.values.planTier !== undefined,
    );

    expect(subscriptionRow?.values.planTier).toBe(planIdToTier("professional"));
    expect(subscriptionRow?.values.planTier).toBe("pro");
    // Non-trial plans get a billing cycle instead of a trial window.
    expect(subscriptionRow?.values.trialEndsAt).toBeNull();
    expect(subscriptionRow?.values.billingCycleEndAt).toBeInstanceOf(Date);
  });

  it("inserts the subscription after the restaurant so the FK resolves", async () => {
    const account = await createPlatformOwnerAccount(buildEnv())(
      buildApplication(),
      "tenant-1",
    );

    const restaurantIndex = insertedRows.findIndex(
      (row) => row.table === "restaurants",
    );
    const subscriptionIndex = insertedRows.findIndex(
      (row) => row.table === "shop_subscriptions",
    );

    expect(restaurantIndex).toBeGreaterThanOrEqual(0);
    expect(subscriptionIndex).toBeGreaterThan(restaurantIndex);
    expect(insertedRows[restaurantIndex]?.values.id).toBe(account.restaurantId);
  });

  it("keeps the setup-password token on v4 so it stays high-entropy", async () => {
    const account = await createPlatformOwnerAccount(buildEnv())(
      buildApplication(),
      "tenant-1",
    );

    // v7 leaks its creation time and carries 74 random bits vs v4's 122, so a
    // one-time credential link must not be downgraded to v7 alongside the ids.
    expect(account.setupPasswordToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("builds the setup link on ADMIN_APP_URL rather than the first CORS origin", async () => {
    // buildEnv lists http://localhost:5173 first in CORS_ORIGIN; the link must
    // still land on the admin app, which is the one with /reset-password.
    const account = await createPlatformOwnerAccount(
      buildEnv(undefined, { ADMIN_APP_URL: "https://admin.example.test/" }),
    )(buildApplication(), "tenant-1");

    expect(account.setupPasswordLink).toBe(
      `https://admin.example.test/reset-password?token=${account.setupPasswordToken}`,
    );
  });

  it("falls back to the first CORS origin when ADMIN_APP_URL is unset", async () => {
    const account = await createPlatformOwnerAccount(
      buildEnv(undefined, { ADMIN_APP_URL: undefined }),
    )(buildApplication(), "tenant-1");

    expect(account.setupPasswordLink).toBe(
      `http://localhost:5173/reset-password?token=${account.setupPasswordToken}`,
    );
  });

  it("rethrows the original provisioning error when rollback fails", async () => {
    const originalError = new Error("platform batch failed");
    batchError = originalError;
    const rollbackError = new Error("rollback statement failed");
    const failingStatement = {
      bind: () => failingStatement,
      first: async () => null,
      run: vi.fn().mockRejectedValue(rollbackError),
    };
    const env = buildEnv();
    env.PLATFORM_DB = {
      prepare: vi.fn().mockReturnValue(failingStatement),
    } as unknown as D1Database;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      createPlatformOwnerAccount(env)(buildApplication(), "tenant-1"),
    ).rejects.toBe(originalError);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Rollback failed"),
      rollbackError,
    );
  });

  it("continues platform rollback after one cleanup statement fails", async () => {
    const calls: string[] = [];
    const rollbackError = new Error("users cleanup failed");
    const env = buildEnv();
    env.PLATFORM_DB = {
      prepare: vi.fn((sql: string) => ({
        bind: () => ({
          run: async () => {
            calls.push(sql);
            if (sql.includes("DELETE FROM users")) {
              throw rollbackError;
            }
            return { success: true };
          },
        }),
      })),
    } as unknown as D1Database;
    const service = new OnboardingService(env) as unknown as {
      rollbackPlatformOwnerAccount: (
        ownerAccount: ProvisionedOwnerAccountForTest,
      ) => Promise<void>;
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      service.rollbackPlatformOwnerAccount({
        restaurantId: "restaurant-1",
        userId: "user-1",
        username: "owner",
        setupPasswordToken: "token",
        setupPasswordLink: "http://localhost/setup",
        setupPasswordExpiresAt: "2026-07-26T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      "DELETE FROM password_reset_tokens WHERE user_id = ?",
      "DELETE FROM users WHERE id = ?",
      "DELETE FROM shop_subscriptions WHERE restaurant_id = ?",
      "DELETE FROM restaurants WHERE id = ?",
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Rollback failed"),
      rollbackError,
    );
  });

  it("returns the original activation error when one rollback step fails", async () => {
    const originalError = new Error("credential delivery insert failed");
    const rollbackError = new Error("platform rollback failed");
    const service = new OnboardingService(
      buildEnv(),
    ) as unknown as ActivationServiceForTest;
    service.getApplication = vi.fn().mockResolvedValue(buildApplication());
    service.updateApplicationStatus = vi.fn().mockResolvedValue(undefined);
    service.createTenantWithSubscription = vi
      .fn()
      .mockResolvedValue({ id: "tenant-1" });
    service.createPlatformOwnerAccount = vi.fn().mockResolvedValue({
      restaurantId: "restaurant-1",
      userId: "user-1",
      username: "owner",
      setupPasswordToken: "token",
      setupPasswordLink: "http://localhost/setup",
      setupPasswordExpiresAt: "2026-07-26T00:00:00.000Z",
    });
    service.createCredentialDelivery = vi.fn().mockRejectedValue(originalError);
    service.rollbackPlatformOwnerAccount = vi
      .fn()
      .mockRejectedValue(rollbackError);
    service.rollbackTenantProvisioning = vi.fn().mockResolvedValue(undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      service.activateApplication("APP-20260725-TEST0001"),
    ).resolves.toMatchObject({
      success: false,
      error: originalError.message,
    });

    expect(service.rollbackPlatformOwnerAccount).toHaveBeenCalled();
    expect(service.rollbackTenantProvisioning).toHaveBeenCalledWith("tenant-1");
    expect(service.updateApplicationStatus).toHaveBeenLastCalledWith(
      "APP-20260725-TEST0001",
      "submitted",
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Rollback failed"),
      rollbackError,
    );
  });
});
