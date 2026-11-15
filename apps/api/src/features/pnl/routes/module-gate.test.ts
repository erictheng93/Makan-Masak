/**
 * /pnl is the "analytics" module (pro and up), like /analytics/financial-report.
 * Uses the REAL moduleGate; only authMiddleware and the service are replaced.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";

const getDaily = vi.hoisted(() => vi.fn());

vi.mock("../../../middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middleware/auth")>()),
  authMiddleware: vi.fn(async (c: Context, next: Next) => {
    c.set("user", { id: "u1", username: "o", role: 1, restaurantId: "rest-1" });
    await next();
  }),
}));

vi.mock("../services/PnlService", () => ({
  PnlService: vi.fn(function PnlService() {
    return { getDaily };
  }),
}));

import routes from "./index";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) =>
  err instanceof ApiError
    ? c.json(
        { success: false, error: { code: err.code, message: err.message } },
        err.status as 400 | 403,
      )
    : c.json({ success: false, error: { message: String(err) } }, 500),
);

function envFor(planTier: "trial" | "basic" | "pro" | "enterprise") {
  const sub = {
    isActive: true,
    planTier,
    moduleOverrides: {},
    trialEndsAt: null,
  };
  return {
    DB: {},
    CACHE_KV: {
      get: async () => sub,
      put: async () => {},
      delete: async () => {},
    },
    ENCRYPTION_KEY: "k".repeat(32),
  } as never;
}

const request = (planTier: Parameters<typeof envFor>[0]) =>
  routes.fetch(new Request("https://api.test/rest-1/daily"), envFor(planTier));

describe("pnl module gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDaily.mockResolvedValue({ date: "2026-03-10" });
  });

  it.each(["pro", "enterprise", "trial"] as const)(
    "lets a %s shop read the statement",
    async (tier) => {
      expect((await request(tier)).status).toBe(200);
      expect(getDaily).toHaveBeenCalledOnce();
    },
  );

  it("denies a basic shop and never reaches the service", async () => {
    const response = await request("basic");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MODULE_NOT_ENABLED" },
    });
    expect(getDaily).not.toHaveBeenCalled();
  });
});
