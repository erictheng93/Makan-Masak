/**
 * Subscription-gate wiring for partnerships GET /plans, GET /plans/:planId,
 * and POST /plans/validate.
 *
 * Regression coverage for the bug where these 3 routes had no
 * moduleGate("loyalty"), unlike the other 18 partnership routes. loyalty is
 * an enterprise-only module (not included in basic or pro). POST
 * /members/verify is deliberately NOT covered here — it's a public,
 * unauthenticated self-service applicant flow (see its own route comment and
 * the CSRF-exempt list in app-factory.ts), so it correctly has no gate.
 *
 * Unlike index.test.ts, this file does NOT mock "../../../middleware/moduleGate"
 * — it exercises the real middleware so a missing/misplaced moduleGate call
 * fails these tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";

const currentUser = vi.hoisted(() => {
  const value: AuthUser = {
    id: "user-1",
    username: "owner",
    role: 1,
    restaurantId: "rest-basic",
  };
  return { value };
});

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: Context, next: Next) => {
    c.set("user", currentUser.value);
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

const serviceFns = vi.hoisted(() => ({
  listPlans: vi.fn(),
  getPlan: vi.fn(),
  validatePlan: vi.fn(),
  submitMemberVerification: vi.fn(),
}));

vi.mock("@makanmasak/database", async (importOriginal) => {
  // moduleGate.ts also imports from "@makanmasak/database" (PLAN_DEFAULT_MODULES
  // etc.) and this file exercises the real moduleGate, so this mock must keep
  // every other export intact and only override PartnershipService.
  const actual = await importOriginal<typeof import("@makanmasak/database")>();
  return {
    ...actual,
    PartnershipService: class {
      listPlans = serviceFns.listPlans;
      getPlan = serviceFns.getPlan;
      validatePlan = serviceFns.validatePlan;
      submitMemberVerification = serviceFns.submitMemberVerification;
    },
  };
});

import routes from "./index";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

interface CachedSubscription {
  isActive: boolean;
  planTier: "trial" | "basic" | "pro" | "enterprise";
  moduleOverrides: Record<string, boolean>;
  trialEndsAt: number | null;
}

class FakeKv {
  constructor(private readonly data: Record<string, CachedSubscription>) {}
  async get<T>(key: string): Promise<T | null> {
    const restaurantId = key.replace(/^subscription:/, "");
    return (this.data[restaurantId] as unknown as T) ?? null;
  }
  async put(): Promise<void> {}
  async delete(): Promise<void> {}
}

function subscription(
  planTier: CachedSubscription["planTier"],
): CachedSubscription {
  return { isActive: true, planTier, moduleOverrides: {}, trialEndsAt: null };
}

function envWithSubscription(
  restaurantId: string,
  planTier: CachedSubscription["planTier"],
) {
  return {
    DB: {},
    CACHE_KV: new FakeKv({ [restaurantId]: subscription(planTier) }),
  } as unknown as Record<string, unknown>;
}

const planId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.value = {
    id: "user-1",
    username: "owner",
    role: 1,
    restaurantId: "rest-basic",
  };
});

describe("partnerships plan-read/validate routes are gated on loyalty", () => {
  it("GET /plans denies a basic-tier owner with 403 MODULE_NOT_ENABLED", async () => {
    const res = await routes.fetch(
      new Request("https://test/plans"),
      envWithSubscription("rest-basic", "basic") as never,
    );
    const json = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };

    expect(res.status).toBe(403);
    expect(json.error.code).toBe("MODULE_NOT_ENABLED");
    expect(serviceFns.listPlans).not.toHaveBeenCalled();
  });

  it("GET /plans/:planId denies a basic-tier owner with 403 MODULE_NOT_ENABLED", async () => {
    const res = await routes.fetch(
      new Request(`https://test/plans/${planId}`),
      envWithSubscription("rest-basic", "basic") as never,
    );

    expect(res.status).toBe(403);
    expect(serviceFns.getPlan).not.toHaveBeenCalled();
  });

  it("POST /plans/validate denies a basic-tier owner with 403 MODULE_NOT_ENABLED", async () => {
    const res = await routes.fetch(
      new Request("https://test/plans/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId,
          memberId,
          orderAmount: 300,
          menuItems: [],
          categories: [],
        }),
      }),
      envWithSubscription("rest-basic", "basic") as never,
    );

    expect(res.status).toBe(403);
    expect(serviceFns.validatePlan).not.toHaveBeenCalled();
  });

  it("allows an enterprise-tier owner through to all three routes", async () => {
    serviceFns.listPlans.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0 },
    });
    serviceFns.getPlan.mockResolvedValue({
      id: planId,
      restaurantId: "rest-basic",
    });
    serviceFns.validatePlan.mockResolvedValue({ valid: true });

    const env = envWithSubscription("rest-basic", "enterprise") as never;

    let res = await routes.fetch(new Request("https://test/plans"), env);
    expect(res.status).toBe(200);

    res = await routes.fetch(new Request(`https://test/plans/${planId}`), env);
    expect(res.status).toBe(200);

    res = await routes.fetch(
      new Request("https://test/plans/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId,
          memberId,
          orderAmount: 300,
          menuItems: [],
          categories: [],
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /members/verify bypasses the loyalty gate (public applicant flow)", () => {
  it("succeeds without any subscription lookup", async () => {
    serviceFns.submitMemberVerification.mockResolvedValue({ id: memberId });

    const res = await routes.fetch(
      new Request("https://test/members/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          partnershipId: "11111111-1111-4111-8111-111111111111",
          memberId: "STU12345",
          memberType: "student",
          fullName: "Ada Chen",
          email: "ada@example.test",
          verificationMethod: "manual",
        }),
      }),
      // Poisoned-ish env: no subscription seeded anywhere. If moduleGate ran,
      // it would 403 with SUBSCRIPTION_NOT_FOUND instead of reaching the
      // handler.
      { DB: {}, CACHE_KV: new FakeKv({}) } as never,
    );

    expect(res.status).toBe(200);
    expect(serviceFns.submitMemberVerification).toHaveBeenCalledOnce();
  });
});
