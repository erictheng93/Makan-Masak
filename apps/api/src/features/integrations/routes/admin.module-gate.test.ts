/**
 * Integration admin routes with the real moduleGate (admin.test.ts mocks it).
 *
 * A shop that loses `platform_integration` keeps receiving platform orders
 * through the webhook until it disconnects, so reading one integration (the
 * settings screen's status) and disconnecting it must stay open; connect,
 * configure, sync, list, logs and orders stay behind the gate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";

const service = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getIntegration: vi.fn(),
  getIntegrations: vi.fn(),
  updateConfig: vi.fn(),
}));
const syncMenu = vi.hoisted(() => vi.fn());
const getPlatformOrders = vi.hoisted(() => vi.fn());

vi.mock("../../../shared/middleware", () => ({
  authMiddleware: vi.fn(async (c: Context, next: Next) => {
    c.set("user", { id: "owner-1", role: 1, restaurantId: "rest-1" });
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../services/PlatformIntegrationService", () => ({
  PlatformIntegrationService: vi.fn(function PlatformIntegrationService() {
    return service;
  }),
}));
vi.mock("../services/PlatformMenuSyncService", () => ({
  PlatformMenuSyncService: vi.fn(function PlatformMenuSyncService() {
    return { syncMenu };
  }),
}));
vi.mock("../services/PlatformOrderService", () => ({
  PlatformOrderService: vi.fn(function PlatformOrderService() {
    return { getPlatformOrders };
  }),
}));
vi.mock("../adapters/PlatformAdapter", () => ({
  isPlatformAdapterSupported: () => true,
}));

import routes from "./admin";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 403,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function envWithPlan(planTier: "pro" | "enterprise") {
  const subscription = {
    isActive: true,
    planTier,
    moduleOverrides: {},
    trialEndsAt: null,
  };
  return {
    // A cache hit means the gate never reads D1.
    DB: {},
    CACHE_KV: {
      get: async (key: string) =>
        key === "subscription:rest-1" ? subscription : null,
    },
  };
}

function send(
  path: string,
  method: string,
  planTier: "pro" | "enterprise",
  body?: unknown,
) {
  return routes.request(
    path,
    {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    envWithPlan(planTier) as never,
  );
}

describe("integration admin routes without platform_integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getIntegration.mockResolvedValue({ platform: "uber_eats" });
  });

  it("still lets the owner see the connected integration and disconnect it", async () => {
    const read = await send("/rest-1/uber_eats", "GET", "pro");
    const disconnect = await send("/rest-1/uber_eats", "DELETE", "pro");

    expect(read.status).toBe(200);
    expect(disconnect.status).toBe(200);
    expect(service.getIntegration).toHaveBeenCalledWith("rest-1", "uber_eats");
    expect(service.disconnect).toHaveBeenCalledWith("rest-1", "uber_eats");
  });

  it.each([
    [
      "POST",
      "/rest-1/uber_eats/connect",
      { clientId: "a", clientSecret: "b", storeId: "c" },
    ],
    ["PUT", "/rest-1/uber_eats", { autoAcceptOrders: true }],
    ["POST", "/rest-1/uber_eats/menu-sync", undefined],
    ["GET", "/rest-1", undefined],
    ["GET", "/rest-1/webhook-logs", undefined],
    ["GET", "/rest-1/uber_eats/orders", undefined],
  ])("refuses %s %s", async (method, path, body) => {
    const response = await send(path, method, "pro", body);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MODULE_NOT_ENABLED" },
    });
    expect(service.connect).not.toHaveBeenCalled();
    expect(service.updateConfig).not.toHaveBeenCalled();
    expect(service.getIntegrations).not.toHaveBeenCalled();
    expect(syncMenu).not.toHaveBeenCalled();
    expect(getPlatformOrders).not.toHaveBeenCalled();
  });

  it("lets an entitled shop configure as before", async () => {
    service.updateConfig.mockResolvedValue({ platform: "uber_eats" });

    const response = await send("/rest-1/uber_eats", "PUT", "enterprise", {
      autoAcceptOrders: true,
    });

    expect(response.status).toBe(200);
    expect(service.updateConfig).toHaveBeenCalledWith(
      "rest-1",
      "uber_eats",
      expect.objectContaining({ autoAcceptOrders: true }),
    );
  });
});
