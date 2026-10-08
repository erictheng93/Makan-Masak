import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";
import { assertPlanTierAllowed } from "../../../shared/policy/regionPolicyGuards";

const mocks = vi.hoisted(() => ({
  user: {
    id: "user-1",
    username: "admin",
    role: 0,
    restaurantId: undefined as string | undefined,
  } as AuthUser,
  usageService: {
    getCurrentUsage: vi.fn(),
    listCycleUsage: vi.fn(),
    listUsageEvents: vi.fn(),
  },
  usageServiceCtor: vi.fn(),
  subscriptionService: {
    changePlan: vi.fn(),
    create: vi.fn(),
    getByRestaurantId: vi.fn(),
    getEffectiveModules: vi.fn(),
    listAll: vi.fn(),
    setActive: vi.fn(),
    updateModules: vi.fn(),
  },
  subscriptionServiceCtor: vi.fn(),
  invalidateSubscriptionCache: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", mocks.user);
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  invalidateSubscriptionCache: vi.fn((...args: unknown[]) =>
    mocks.invalidateSubscriptionCache(...args),
  ),
}));

vi.mock("../../../shared/policy/regionPolicyGuards", () => ({
  assertPlanTierAllowed: vi.fn(async () => {}),
}));

vi.mock("../../billing/services/UsageService", () => ({
  UsageService: vi.fn(function UsageService(...args: unknown[]) {
    mocks.usageServiceCtor(...args);
    return mocks.usageService;
  }),
}));

vi.mock("../services/SubscriptionService", () => ({
  SubscriptionService: vi.fn(function SubscriptionService(...args: unknown[]) {
    mocks.subscriptionServiceCtor(...args);
    return mocks.subscriptionService;
  }),
}));

import routes from "./index";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }

  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function request(path: string, init: RequestInit = {}) {
  return routes.request(path, init, {
    DB: { binding: "db" },
    CACHE_KV: { delete: vi.fn() },
  } as never);
}

async function json(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data?: unknown;
    error?: { code?: string; message?: string; details?: unknown };
  };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    restaurantId: "restaurant-1",
    planTier: "pro",
    moduleOverrides: {},
    isActive: true,
    ...overrides,
  };
}

describe("subscription admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usageService.getCurrentUsage.mockResolvedValue({
      meters: [{ meterKey: "orders.created", total: 10 }],
    });
    mocks.usageService.listCycleUsage.mockResolvedValue([
      { cycleStartAt: 1710000000000, meters: { "orders.created": 5 } },
    ]);
    mocks.usageService.listUsageEvents.mockResolvedValue({
      page: 1,
      limit: 50,
      total: 1,
      events: [{ id: "event-1" }],
    });
    mocks.subscriptionService.listAll.mockResolvedValue([
      subscription({ restaurantId: "restaurant-1" }),
      subscription({ id: "sub-2", restaurantId: "restaurant-2" }),
    ]);
    mocks.subscriptionService.getByRestaurantId.mockResolvedValue(
      subscription(),
    );
    mocks.subscriptionService.create.mockResolvedValue(
      subscription({ id: "sub-new", planTier: "trial" }),
    );
    mocks.subscriptionService.updateModules.mockResolvedValue(
      subscription({ moduleOverrides: { pos: true } }),
    );
    mocks.subscriptionService.changePlan.mockResolvedValue(
      subscription({ planTier: "enterprise" }),
    );
    mocks.subscriptionService.setActive.mockResolvedValue(
      subscription({ isActive: false }),
    );
    mocks.subscriptionService.getEffectiveModules.mockReturnValue({
      menu_management: true,
      pos: true,
    });
    mocks.invalidateSubscriptionCache.mockResolvedValue(undefined);
  });

  it("returns current and historical usage for a restaurant", async () => {
    const response = await request(
      "/restaurant-1/usage?from=2026-06-01T00:00:00.000Z&to=2026-06-07T00:00:00.000Z",
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.usageServiceCtor).toHaveBeenCalledWith({ binding: "db" });
    expect(mocks.usageService.getCurrentUsage).toHaveBeenCalledWith(
      "restaurant-1",
    );
    expect(mocks.usageService.listCycleUsage).toHaveBeenCalledWith(
      "restaurant-1",
      Date.parse("2026-06-01T00:00:00.000Z"),
      Date.parse("2026-06-07T00:00:00.000Z"),
    );
    expect(body).toEqual({
      success: true,
      data: {
        restaurantId: "restaurant-1",
        current: { meters: [{ meterKey: "orders.created", total: 10 }] },
        cycles: [
          { cycleStartAt: 1710000000000, meters: { "orders.created": 5 } },
        ],
      },
    });
  });

  it("rejects invalid usage dates and bounds usage event pagination", async () => {
    let response = await request("/restaurant-1/usage?from=not-a-date");
    let body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "INVALID_DATE",
      message: "Invalid from date",
    });

    response = await request(
      "/restaurant-1/usage/events?meterKey=orders.created&from=2026-06-01T00:00:00.000Z&to=2026-06-07T00:00:00.000Z&page=2&limit=999",
    );
    body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.usageService.listUsageEvents).toHaveBeenCalledWith(
      "restaurant-1",
      {
        meterKey: "orders.created",
        from: Date.parse("2026-06-01T00:00:00.000Z"),
        to: Date.parse("2026-06-07T00:00:00.000Z"),
        page: 2,
        limit: 200,
      },
    );
    expect(body.success).toBe(true);
  });

  it("lists subscriptions with effective module maps", async () => {
    const response = await request("/");
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.subscriptionServiceCtor).toHaveBeenCalledWith({
      binding: "db",
    });
    expect(mocks.subscriptionService.listAll).toHaveBeenCalled();
    expect(mocks.subscriptionService.getEffectiveModules).toHaveBeenCalledTimes(
      2,
    );
    expect(body).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          restaurantId: "restaurant-1",
          effectiveModules: { menu_management: true, pos: true },
        }),
        expect.objectContaining({
          restaurantId: "restaurant-2",
          effectiveModules: { menu_management: true, pos: true },
        }),
      ],
    });
  });

  it("returns a single subscription or 404 for missing rows", async () => {
    let response = await request("/restaurant-1");
    let body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.subscriptionService.getByRestaurantId).toHaveBeenCalledWith(
      "restaurant-1",
    );
    expect(body).toEqual({
      success: true,
      data: expect.objectContaining({
        restaurantId: "restaurant-1",
        effectiveModules: { menu_management: true, pos: true },
      }),
    });

    mocks.subscriptionService.getByRestaurantId.mockResolvedValueOnce(null);
    response = await request("/missing");
    body = await json(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "Subscription not found" },
    });
  });

  it("creates subscriptions and converts optional dates", async () => {
    const response = await request("/", {
      method: "POST",
      body: JSON.stringify({
        restaurantId: "restaurant-3",
        planTier: "trial",
        trialEndsAt: "2026-06-14T00:00:00.000Z",
        billingCycleStartAt: "2026-06-01T00:00:00.000Z",
        billingCycleEndAt: "2026-07-01T00:00:00.000Z",
        notes: "pilot",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(mocks.subscriptionService.create).toHaveBeenCalledWith({
      restaurantId: "restaurant-3",
      planTier: "trial",
      trialEndsAt: new Date("2026-06-14T00:00:00.000Z"),
      billingCycleStartAt: new Date("2026-06-01T00:00:00.000Z"),
      billingCycleEndAt: new Date("2026-07-01T00:00:00.000Z"),
      notes: "pilot",
    });
    expect(body).toEqual({
      success: true,
      data: subscription({ id: "sub-new", planTier: "trial" }),
    });
  });

  it("checks the region when creating a subscription", async () => {
    const response = await request("/", {
      method: "POST",
      body: JSON.stringify({ restaurantId: "rest-1", planTier: "basic" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(201);
    expect(assertPlanTierAllowed).toHaveBeenCalledWith(expect.anything(), {
      restaurantId: "rest-1",
      planTier: "basic",
    });
  });

  it("returns the unified error shape for invalid onboarding payloads", async () => {
    const response = await request("/", {
      method: "POST",
      body: JSON.stringify({
        restaurantId: "",
        planTier: "not-a-plan",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: expect.arrayContaining([
          expect.objectContaining({ field: "restaurantId" }),
          expect.objectContaining({ field: "planTier" }),
        ]),
      },
    });
    expect(mocks.subscriptionService.create).not.toHaveBeenCalled();
  });

  it("updates module overrides and invalidates the subscription cache", async () => {
    const response = await request("/restaurant-1/modules", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { pos: true, analytics: false } }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.subscriptionService.updateModules).toHaveBeenCalledWith(
      "restaurant-1",
      { overrides: { pos: true, analytics: false } },
    );
    expect(mocks.invalidateSubscriptionCache).toHaveBeenCalledWith(
      expect.anything(),
      "restaurant-1",
    );
    expect(body).toEqual({
      success: true,
      data: expect.objectContaining({
        moduleOverrides: { pos: true },
        effectiveModules: { menu_management: true, pos: true },
      }),
    });
  });

  it("accepts null to reset a module override to its plan default", async () => {
    const response = await request("/restaurant-1/modules", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { pos: null } }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(mocks.subscriptionService.updateModules).toHaveBeenCalledWith(
      "restaurant-1",
      { overrides: { pos: null } },
    );
  });

  it("changes plan tiers and active status", async () => {
    let response = await request("/restaurant-1/plan", {
      method: "PATCH",
      body: JSON.stringify({ planTier: "enterprise" }),
      headers: { "Content-Type": "application/json" },
    });
    let body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.subscriptionService.changePlan).toHaveBeenCalledWith(
      "restaurant-1",
      "enterprise",
    );
    expect(mocks.invalidateSubscriptionCache).toHaveBeenCalledWith(
      expect.anything(),
      "restaurant-1",
    );
    expect(body).toEqual({
      success: true,
      data: expect.objectContaining({
        planTier: "enterprise",
        effectiveModules: { menu_management: true, pos: true },
      }),
    });

    response = await request("/restaurant-1/status", {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
      headers: { "Content-Type": "application/json" },
    });
    body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.subscriptionService.setActive).toHaveBeenCalledWith(
      "restaurant-1",
      false,
    );
    expect(body).toEqual({
      success: true,
      data: subscription({ isActive: false }),
    });
  });

  it("checks the region before changing plan", async () => {
    const response = await request("/rest-1/plan", {
      method: "PATCH",
      body: JSON.stringify({ planTier: "pro" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(assertPlanTierAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ DB: expect.anything() }),
      { restaurantId: "rest-1", planTier: "pro" },
    );
  });

  it("does not change the plan when the region refuses it", async () => {
    vi.mocked(assertPlanTierAllowed).mockRejectedValueOnce(
      new ApiError("PLAN_NOT_AVAILABLE_IN_REGION", "no", 400),
    );

    const response = await request("/rest-1/plan", {
      method: "PATCH",
      body: JSON.stringify({ planTier: "pro" }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "PLAN_NOT_AVAILABLE_IN_REGION",
      message: "no",
    });
    expect(mocks.subscriptionService.changePlan).not.toHaveBeenCalled();
  });
});
