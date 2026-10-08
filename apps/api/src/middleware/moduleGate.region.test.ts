import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { moduleGate } from "./moduleGate";
import { ApiError } from "../shared/utils/api-error";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

function kvWith(entries: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => entries[key] ?? null),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
}

const subscription = (countryCode?: string | null) => ({
  isActive: true,
  planTier: "basic",
  moduleOverrides: { pos: true },
  trialEndsAt: null,
  ...(countryCode === undefined ? {} : { countryCode }),
});

const layer = (values: object, invalidKeys: string[] = []) => ({
  values,
  invalidKeys,
});

function buildApp(user: { role: number; restaurantId: string }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, user as never);
    await next();
  });
  app.onError((err, c) =>
    err instanceof ApiError
      ? c.json(
          { success: false, error: { code: err.code } },
          err.status as 403 | 503,
        )
      : c.json({ success: false }, 500),
  );
  app.get("/pos", moduleGate("pos"), (c) => c.json({ success: true }));
  return app;
}

const call = (app: Hono, kv: ReturnType<typeof kvWith>) =>
  app.fetch(new Request("https://test/pos"), { DB: {}, CACHE_KV: kv } as never);

describe("moduleGate region policies", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("blocks a module the country disabled even with a shop override", async () => {
    const kv = kvWith({
      "subscription:r1": subscription("MY"),
      "policy:v1:country:MY": layer({ "modules.disabled": ["pos"] }),
    });
    const res = await call(buildApp({ role: 1, restaurantId: "r1" }), kv);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "MODULE_NOT_AVAILABLE_IN_REGION" },
    });
    expect(kv.get).toHaveBeenCalledWith("policy:v1:country:MY", "json");
  });

  it("skips region policies when the cached entry has no country", async () => {
    const kv = kvWith({ "subscription:r1": subscription() });
    const res = await call(buildApp({ role: 1, restaurantId: "r1" }), kv);

    expect(res.status).toBe(200);
    expect(kv.get).not.toHaveBeenCalledWith(
      expect.stringMatching(/^policy:/),
      "json",
    );
  });

  it("lets platform admins through", async () => {
    const kv = kvWith({
      "subscription:r1": subscription("MY"),
      "policy:v1:country:MY": layer({ "modules.disabled": ["pos"] }),
    });
    const res = await call(buildApp({ role: 0, restaurantId: "r1" }), kv);
    expect(res.status).toBe(200);
  });

  it("returns 503 when the stored module policy is corrupt", async () => {
    const kv = kvWith({
      "subscription:r1": subscription("MY"),
      "policy:v1:country:MY": layer({}, ["modules.disabled"]),
    });
    const res = await call(buildApp({ role: 1, restaurantId: "r1" }), kv);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "POLICY_UNAVAILABLE" },
    });
  });

  it("returns 503 when the policy store fails", async () => {
    const kv = kvWith({ "subscription:r1": subscription("MY") });
    kv.get.mockImplementation(async (key: string) => {
      if (key.startsWith("policy:")) throw new Error("kv down");
      return subscription("MY");
    });
    const res = await call(buildApp({ role: 1, restaurantId: "r1" }), kv);
    expect(res.status).toBe(503);
  });
});
