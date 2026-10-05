import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { PLAN_DEFAULT_MODULES } from "@makanmasak/database";
import { moduleGate } from "./moduleGate";
import { ApiError } from "../shared/utils/api-error";

vi.mock("drizzle-orm/d1", () => ({ drizzle: vi.fn(() => ({})) }));

function envWith(
  planTier: string,
  moduleOverrides: Record<string, boolean> = {},
) {
  return {
    DB: {},
    CACHE_KV: {
      get: async () => ({
        isActive: true,
        planTier,
        moduleOverrides,
        trialEndsAt: null,
      }),
      put: async () => {},
      delete: async () => {},
    },
  };
}

async function call(env: unknown) {
  const app = new Hono();
  app.onError((err, c) =>
    err instanceof ApiError
      ? c.json({ error: { code: err.code } }, err.status as 403)
      : c.json({ error: String(err) }, 500),
  );
  app.use("*", async (c, next) => {
    c.set("user" as never, { id: 1, role: 4, restaurantId: "r1" } as never);
    await next();
  });
  app.post("/payments", moduleGate(["pos", "online_ordering"]), (c) =>
    c.json({ ok: true }),
  );
  return app.fetch(
    new Request("https://t/payments", { method: "POST" }),
    env as never,
  );
}

describe("moduleGate any-of (/payments)", () => {
  it("allows pos without online_ordering", async () => {
    expect(
      (await call(envWith("basic", { pos: true, online_ordering: false })))
        .status,
    ).toBe(200);
  });

  it("allows online_ordering without pos", async () => {
    expect((await call(envWith("basic"))).status).toBe(200);
  });

  it("rejects when neither is enabled", async () => {
    const res = await call(envWith("basic", { online_ordering: false }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "MODULE_NOT_ENABLED" },
    });
  });
});

describe("plan bundles", () => {
  it("every plan default with pos also has online_ordering", () => {
    for (const modules of Object.values(PLAN_DEFAULT_MODULES)) {
      if (modules.pos) expect(modules.online_ordering).toBe(true);
    }
  });
});
