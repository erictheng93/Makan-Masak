import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";

const authState = vi.hoisted(() => ({
  user: undefined as AuthUser | undefined,
}));

const subscriptionMocks = vi.hoisted(() => ({
  getByRestaurantId: vi.fn(),
  getEffectiveModules: vi.fn(),
}));

const usageMocks = vi.hoisted(() => ({
  getCurrentUsage: vi.fn(),
}));

const databaseMocks = vi.hoisted(() => ({
  responses: [] as unknown[][],
}));

vi.mock("../../../middleware/auth", () => ({
  staffOrUserCustomerAuthMiddleware: vi.fn(async (c, next) => {
    c.set("user", authState.user);
    await next();
  }),
}));

vi.mock("../../subscriptions/services/SubscriptionService", () => ({
  SubscriptionService: class {
    getByRestaurantId = subscriptionMocks.getByRestaurantId;
    getEffectiveModules = subscriptionMocks.getEffectiveModules;
  },
}));

vi.mock("../../billing/services/UsageService", () => ({
  UsageService: class {
    getCurrentUsage = usageMocks.getCurrentUsage;
  },
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({
    select: () => {
      const rows = databaseMocks.responses.shift() ?? [];
      const query = {
        from: () => query,
        where: () => query,
        limit: async () => rows,
        then: (
          resolve: (value: unknown[]) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    },
  })),
}));

import meFeature from "../index";
import routes from "./index";

function createEnv(cacheRows = new Map<string, unknown>()) {
  return {
    DB: {},
    CACHE_KV: {
      get: vi.fn(async (key: string) => cacheRows.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        cacheRows.set(key, JSON.parse(value));
      }),
    },
  };
}

function request(path: string, env = createEnv()) {
  return routes.request(path, undefined, env as never);
}

describe("me routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.responses = [];
    authState.user = {
      id: "user-42",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
    subscriptionMocks.getEffectiveModules.mockReturnValue({
      pos: true,
      analytics: false,
    });
  });

  it("exposes module metadata and health", async () => {
    await expect(meFeature.healthCheck()).resolves.toEqual({
      status: "healthy",
      message: "Me module operational",
    });

    expect(meFeature.name).toBe("me");
    expect(meFeature.version).toBe("1.0.0");
  });

  it("returns empty module and usage access for customer accounts", async () => {
    authState.user = {
      id: "user-99",
      username: "customer",
      role: 5,
      restaurantId: "restaurant-1",
    };

    const modulesResponse = await request("/modules");
    const usageResponse = await request("/usage");

    expect(modulesResponse.status).toBe(200);
    await expect(modulesResponse.json()).resolves.toEqual({
      success: true,
      data: {
        restaurantId: null,
        planTier: null,
        isActive: false,
        trialEndsAt: null,
        effectiveModules: {},
      },
    });
    expect(usageResponse.status).toBe(200);
    await expect(usageResponse.json()).resolves.toEqual({
      success: true,
      data: {
        cycleStartAt: null,
        cycleEndAt: null,
        meters: [],
      },
    });
    expect(subscriptionMocks.getByRestaurantId).not.toHaveBeenCalled();
    expect(usageMocks.getCurrentUsage).not.toHaveBeenCalled();
  });

  it("returns empty module and usage access when staff has no restaurant", async () => {
    authState.user = {
      id: "user-43",
      username: "floating-manager",
      role: 1,
      restaurantId: undefined,
    };

    const modulesResponse = await request("/modules");
    const usageResponse = await request("/usage");

    expect(modulesResponse.status).toBe(200);
    await expect(modulesResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        restaurantId: null,
        planTier: null,
        effectiveModules: {},
      },
    });
    expect(usageResponse.status).toBe(200);
    await expect(usageResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        cycleStartAt: null,
        cycleEndAt: null,
        meters: [],
      },
    });
    expect(subscriptionMocks.getByRestaurantId).not.toHaveBeenCalled();
    expect(usageMocks.getCurrentUsage).not.toHaveBeenCalled();
  });

  it("lets platform admins request modules for a selected restaurant", async () => {
    authState.user = {
      id: "user-44",
      username: "platform-admin",
      role: 0,
      restaurantId: undefined,
    };
    const subscription = {
      isActive: true,
      planTier: "pro",
      moduleOverrides: { analytics: true },
      trialEndsAt: null,
    };
    databaseMocks.responses = [[subscription], [{ countryCode: null }]];

    const response = await request("/modules?restaurantId=restaurant-2");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        restaurantId: "restaurant-2",
        planTier: "pro",
        isActive: true,
        effectiveModules: { pos: true, analytics: false },
      },
    });
    expect(subscriptionMocks.getByRestaurantId).not.toHaveBeenCalled();
  });

  it("returns empty module access for platform admins without a selected restaurant", async () => {
    authState.user = {
      id: "user-45",
      username: "platform-admin",
      role: 0,
      restaurantId: undefined,
    };

    const response = await request("/modules");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        restaurantId: null,
        planTier: null,
        isActive: false,
        effectiveModules: {},
      },
    });
    expect(subscriptionMocks.getByRestaurantId).not.toHaveBeenCalled();
  });

  it("ignores restaurantId query parameters for non-admin users", async () => {
    const response = await request("/modules?restaurantId=restaurant-2");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        restaurantId: "restaurant-1",
        planTier: null,
        isActive: false,
        effectiveModules: {},
      },
    });
    expect(subscriptionMocks.getByRestaurantId).not.toHaveBeenCalledWith(
      "restaurant-2",
    );
    expect(subscriptionMocks.getByRestaurantId).not.toHaveBeenCalled();
  });

  it("serves cached subscription modules without touching the database", async () => {
    const env = createEnv(
      new Map([
        [
          "subscription:restaurant-1",
          {
            isActive: true,
            planTier: "growth",
            moduleOverrides: { analytics: false },
            trialEndsAt: 1780000000000,
          },
        ],
      ]),
    );

    const response = await request("/modules", env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        restaurantId: "restaurant-1",
        planTier: "growth",
        isActive: true,
        trialEndsAt: 1780000000000,
        effectiveModules: { pos: true, analytics: false },
      },
    });
    expect(env.CACHE_KV.get).toHaveBeenCalledWith(
      "subscription:restaurant-1",
      "json",
    );
    expect(subscriptionMocks.getByRestaurantId).not.toHaveBeenCalled();
    expect(env.CACHE_KV.put).not.toHaveBeenCalled();
    expect(subscriptionMocks.getEffectiveModules).toHaveBeenCalledWith({
      planTier: "growth",
      moduleOverrides: { analytics: false },
    });
  });

  it("falls back to empty access when no subscription exists", async () => {
    const response = await request("/modules");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        restaurantId: "restaurant-1",
        planTier: null,
        isActive: false,
        effectiveModules: {},
      },
    });
    expect(subscriptionMocks.getByRestaurantId).not.toHaveBeenCalled();
  });

  it("reads subscription modules from the database and writes the cache", async () => {
    const trialEndsAt = new Date("2026-06-08T00:00:00.000Z");
    const env = createEnv();
    const subscription = {
      restaurantId: "restaurant-1",
      isActive: true,
      planTier: "enterprise",
      moduleOverrides: { pos: true },
      trialEndsAt,
    };
    databaseMocks.responses = [[subscription], [{ countryCode: null }]];

    const response = await request("/modules", env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        restaurantId: "restaurant-1",
        planTier: "enterprise",
        isActive: true,
        trialEndsAt: trialEndsAt.getTime(),
        effectiveModules: { pos: true, analytics: false },
      },
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "subscription:restaurant-1",
      JSON.stringify({
        isActive: true,
        planTier: "enterprise",
        moduleOverrides: { pos: true },
        trialEndsAt: trialEndsAt.getTime(),
        countryCode: null,
      }),
      { expirationTtl: 300 },
    );
    expect(subscriptionMocks.getEffectiveModules).toHaveBeenCalledWith({
      planTier: "enterprise",
      moduleOverrides: { pos: true },
    });
  });

  it("normalizes nullable subscription fields before caching", async () => {
    const env = createEnv();
    const subscription = {
      restaurantId: "restaurant-1",
      isActive: false,
      planTier: "trial",
      moduleOverrides: null,
      trialEndsAt: null,
    };
    databaseMocks.responses = [[subscription], [{ countryCode: null }]];

    const response = await request("/modules", env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        planTier: "trial",
        isActive: false,
        trialEndsAt: null,
      },
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "subscription:restaurant-1",
      JSON.stringify({
        isActive: false,
        planTier: "trial",
        moduleOverrides: {},
        trialEndsAt: null,
        countryCode: null,
      }),
      { expirationTtl: 300 },
    );
  });

  it("turns off modules disabled by the restaurant country policy", async () => {
    subscriptionMocks.getEffectiveModules.mockReturnValue({
      pos: true,
      analytics: true,
    });
    const env = createEnv(
      new Map([
        [
          "subscription:restaurant-1",
          {
            isActive: true,
            planTier: "growth",
            moduleOverrides: {},
            trialEndsAt: null,
            countryCode: "MY",
          },
        ],
        [
          "policy:v1:country:MY",
          { values: { "modules.disabled": ["pos"] }, invalidKeys: [] },
        ],
      ]),
    );

    const response = await request("/modules", env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        effectiveModules: { pos: false, analytics: true },
      },
    });
    expect(env.CACHE_KV.get).toHaveBeenCalledWith(
      "policy:v1:country:MY",
      "json",
    );
  });

  it("returns current usage for the authenticated restaurant", async () => {
    usageMocks.getCurrentUsage.mockResolvedValue({
      cycleStartAt: 1780000000000,
      cycleEndAt: 1782592000000,
      meters: [{ key: "orders", used: 42, limit: 100 }],
    });

    const response = await request("/usage");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        cycleStartAt: 1780000000000,
        cycleEndAt: 1782592000000,
        meters: [{ key: "orders", used: 42, limit: 100 }],
      },
    });
    expect(usageMocks.getCurrentUsage).toHaveBeenCalledWith("restaurant-1");
  });
});
