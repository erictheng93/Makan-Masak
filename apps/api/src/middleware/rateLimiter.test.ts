import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { rateLimitMiddleware } from "./rateLimiter";

// Guest tokens and locks live in the D1 ephemeral store; tests hand it a fake
// through a test-only env field so it stays distinct from CACHE_KV.
vi.mock("../shared/utils/ephemeral-store", () => ({
  ephemeralStore: (env: { EPHEMERAL: unknown }) => env.EPHEMERAL,
}));

/**
 * Cloudflare KV rejects any expirationTtl below 60 seconds. The counters now
 * live in D1, which has no such floor, but the limiter still clamps; the fake
 * keeps enforcing the floor so that clamp cannot regress unnoticed.
 */
const KV_MIN_EXPIRATION_TTL = 60;

function createKv(options: { failPut?: boolean } = {}) {
  const kv = new Map<string, string>();
  const putTtls: number[] = [];
  return {
    get: async (key: string, type?: "json") => {
      const value = kv.get(key);
      if (value == null) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    put: async (
      key: string,
      value: string,
      putOptions?: { expirationTtl?: number },
    ) => {
      if (options.failPut) {
        throw new Error("KV PUT failed: 500 upstream unavailable");
      }
      const ttl = putOptions?.expirationTtl;
      if (ttl !== undefined) {
        putTtls.push(ttl);
        if (ttl < KV_MIN_EXPIRATION_TTL) {
          throw new Error(
            `KV PUT failed: 400 Invalid expiration_ttl of ${ttl}. Expiration TTL must be at least ${KV_MIN_EXPIRATION_TTL}.`,
          );
        }
      }
      kv.set(key, value);
    },
    delete: async (key: string) => {
      kv.delete(key);
    },
    keys: () => Array.from(kv.keys()),
    putTtls: () => [...putTtls],
  };
}

/**
 * `rateLimitMiddleware` reads `c.get("tenant")`, which no middleware in this
 * file's import graph declares on Hono's global `ContextVariableMap`. Declaring
 * it on the test app's own `Variables` keeps `c.set("tenant", ...)` typed
 * without reaching into production's context typings.
 */
type TestVariables = {
  tenant: { mode: string; tenantId: string; enforceSingleTenant: boolean };
};

function createApp(
  kv: ReturnType<typeof createKv>,
  config: { windowMs?: number; maxRequests?: number } = {},
) {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use("*", async (c, next) => {
    const tenantId = c.req.header("x-test-tenant");
    if (tenantId) {
      c.set("tenant", {
        mode: "saas",
        tenantId,
        enforceSingleTenant: false,
      });
    }
    await next();
  });
  app.use(
    "*",
    rateLimitMiddleware({
      windowMs: config.windowMs ?? 60_000,
      maxRequests: config.maxRequests ?? 1,
      keyPrefix: "tenant_test",
    }),
  );
  app.get("/", (c) => c.json({ success: true }));
  return app;
}

function tenantRequest(tenant: string) {
  return new Request("https://test/", {
    headers: { "x-test-tenant": tenant },
  });
}

describe("rateLimitMiddleware", () => {
  it("limits by tenant identity before IP and isolates tenants sharing an IP", async () => {
    const kv = createKv();
    const app = createApp(kv);
    const env = { DB: {}, EPHEMERAL: kv };

    const firstTenantA = await app.fetch(
      new Request("https://test/", {
        headers: { "x-test-tenant": "tenant-a" },
      }),
      env as never,
    );
    const secondTenantA = await app.fetch(
      new Request("https://test/", {
        headers: { "x-test-tenant": "tenant-a" },
      }),
      env as never,
    );
    const firstTenantB = await app.fetch(
      new Request("https://test/", {
        headers: { "x-test-tenant": "tenant-b" },
      }),
      env as never,
    );

    expect(firstTenantA.status).toBe(200);
    expect(secondTenantA.status).toBe(429);
    expect(firstTenantB.status).toBe(200);
    expect(kv.keys()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("tenant:tenant-a"),
        expect.stringContaining("tenant:tenant-b"),
      ]),
    );
  });

  it("never writes a TTL below the KV minimum as the window drains", async () => {
    const kv = createKv();
    // maxRequests high enough that every call takes the increment path, which
    // derives its TTL from the *remaining* window rather than the full one.
    const app = createApp(kv, { maxRequests: 10 });
    const env = { DB: {}, EPHEMERAL: kv };

    // Real traffic arrives seconds apart, so the remaining window shrinks below
    // 60s. An in-process loop finishes inside a millisecond and rounds back up
    // to 60, which is why this regression is invisible without a moving clock.
    let clock = 1_800_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);

    try {
      for (let i = 0; i < 5; i++) {
        const response = await app.fetch(
          tenantRequest("tenant-a"),
          env as never,
        );
        expect(response.status, `request ${i + 1}`).toBe(200);
        clock += 5_000;
      }
    } finally {
      nowSpy.mockRestore();
    }

    expect(kv.putTtls().length).toBeGreaterThan(1);
    // Proves the clock actually moved: at least one raw remaining-window value
    // was under the KV floor and had to be clamped.
    expect(Math.min(...kv.putTtls())).toBe(KV_MIN_EXPIRATION_TTL);
    for (const ttl of kv.putTtls()) {
      expect(ttl).toBeGreaterThanOrEqual(KV_MIN_EXPIRATION_TTL);
    }
  });

  it("accepts windows shorter than the KV minimum TTL", async () => {
    const kv = createKv();
    const app = createApp(kv, { windowMs: 30_000, maxRequests: 10 });
    const env = { DB: {}, EPHEMERAL: kv };

    const first = await app.fetch(tenantRequest("tenant-a"), env as never);
    const second = await app.fetch(tenantRequest("tenant-a"), env as never);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    for (const ttl of kv.putTtls()) {
      expect(ttl).toBeGreaterThanOrEqual(KV_MIN_EXPIRATION_TTL);
    }
  });

  it("still returns 429 rather than 500 once the limit is reached", async () => {
    const kv = createKv();
    const app = createApp(kv, { maxRequests: 2 });
    const env = { DB: {}, EPHEMERAL: kv };

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (await app.fetch(tenantRequest("tenant-a"), env as never)).status,
      );
    }

    expect(statuses).toEqual([200, 200, 429, 429]);
  });

  it("fails open instead of 500 when the KV backend is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kv = createKv({ failPut: true });
    const app = createApp(kv);
    const env = { DB: {}, EPHEMERAL: kv };

    // A limiter outage must not take the endpoint down with it.
    const response = await app.fetch(tenantRequest("tenant-a"), env as never);

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
