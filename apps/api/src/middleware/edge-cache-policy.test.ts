import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPublicApiCacheableRequest,
  smartCacheMiddleware,
} from "./edge-cache";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPublicApiCacheableRequest", () => {
  it("only caches explicitly approved public read routes", () => {
    expect(
      isPublicApiCacheableRequest("GET", "/api/v1/menu/restaurant-1"),
    ).toBe(true);
    expect(
      isPublicApiCacheableRequest("GET", "/api/v1/restaurants/restaurant-1"),
    ).toBe(true);
    expect(
      isPublicApiCacheableRequest(
        "GET",
        "/api/v1/coupons/available/restaurant-1",
      ),
    ).toBe(true);
  });

  it("does not cache verification or other security-sensitive reads", () => {
    expect(
      isPublicApiCacheableRequest("GET", "/api/v1/qr/verify/table/10"),
    ).toBe(false);
    expect(
      isPublicApiCacheableRequest(
        "GET",
        "/api/v1/service-bookings/verify/ABC123",
      ),
    ).toBe(false);
    expect(isPublicApiCacheableRequest("GET", "/api/v1/payments/order-1")).toBe(
      false,
    );
    expect(
      isPublicApiCacheableRequest("GET", "/api/v1/restaurants/popular"),
    ).toBe(false);
    expect(
      isPublicApiCacheableRequest(
        "GET",
        "/api/v1/restaurants/restaurant-1/stats",
      ),
    ).toBe(false);
    expect(
      isPublicApiCacheableRequest("GET", "/api/v1/menu/restaurant-1/analytics"),
    ).toBe(false);
    expect(
      isPublicApiCacheableRequest("POST", "/api/v1/menu/restaurant-1"),
    ).toBe(false);
  });

  it("keeps QR verification fresh while the edge cache is enabled", async () => {
    const kvEntries = new Map<string, string>();
    const cacheEntries = new Map<string, Response>();
    const cache = {
      async match(key: RequestInfo | URL) {
        const response = cacheEntries.get(String(key));
        return response?.clone();
      },
      async put(key: RequestInfo | URL, response: Response) {
        cacheEntries.set(String(key), response.clone());
      },
      async delete(key: RequestInfo | URL) {
        return cacheEntries.delete(String(key));
      },
    };
    vi.stubGlobal("caches", { default: cache });

    const cacheKv = {
      async get(key: string, options?: { type?: string }) {
        const value = kvEntries.get(key);
        if (value === undefined) return null;
        return options?.type === "json" ? JSON.parse(value) : value;
      },
      async put(key: string, value: string) {
        kvEntries.set(key, value);
      },
      async delete(key: string) {
        kvEntries.delete(key);
      },
    };
    const app = new Hono();
    app.use(
      "*",
      smartCacheMiddleware({
        defaultTtl: 300,
        shouldCache: (c) =>
          isPublicApiCacheableRequest(c.req.method, c.req.path),
      }),
    );
    let menuGeneration = 0;
    let verificationGeneration = 0;
    app.get("/api/v1/menu/restaurant-1", (c) =>
      c.json({ success: true, data: { generation: ++menuGeneration } }),
    );
    app.get("/api/v1/qr/verify/seat", (c) =>
      c.json({
        success: true,
        data: { generation: ++verificationGeneration },
      }),
    );
    const env = { CACHE_KV: cacheKv };
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };

    const firstMenu = await app.request(
      "/api/v1/menu/restaurant-1",
      undefined,
      env as never,
      executionCtx as never,
    );
    const secondMenu = await app.request(
      "/api/v1/menu/restaurant-1",
      undefined,
      env as never,
      executionCtx as never,
    );
    const freshMenu = await app.request(
      "/api/v1/menu/restaurant-1",
      { headers: { "Cache-Control": "no-cache" } },
      env as never,
      executionCtx as never,
    );
    await expect(freshMenu.json()).resolves.toMatchObject({
      data: { generation: 2 },
    });
    const stillCachedMenu = await app.request(
      "/api/v1/menu/restaurant-1",
      undefined,
      env as never,
      executionCtx as never,
    );
    await expect(stillCachedMenu.json()).resolves.toMatchObject({
      data: { generation: 1 },
      cached: true,
    });
    const firstVerification = await app.request(
      "/api/v1/qr/verify/seat?qrCode=old",
      undefined,
      env as never,
      executionCtx as never,
    );
    const secondVerification = await app.request(
      "/api/v1/qr/verify/seat?qrCode=old",
      undefined,
      env as never,
      executionCtx as never,
    );

    await expect(firstMenu.json()).resolves.toMatchObject({
      data: { generation: 1 },
    });
    await expect(secondMenu.json()).resolves.toMatchObject({
      data: { generation: 1 },
      cached: true,
    });
    await expect(firstVerification.json()).resolves.toMatchObject({
      data: { generation: 1 },
    });
    await expect(secondVerification.json()).resolves.toMatchObject({
      data: { generation: 2 },
    });
  });

  it("invalidates restaurant detail cache after an admin updates /restaurants/:id", async () => {
    const kvEntries = new Map<string, string>();
    const cacheEntries = new Map<string, Response>();
    const cache = {
      async match(key: RequestInfo | URL) {
        const response = cacheEntries.get(String(key));
        return response?.clone();
      },
      async put(key: RequestInfo | URL, response: Response) {
        cacheEntries.set(String(key), response.clone());
      },
      async delete(key: RequestInfo | URL) {
        return cacheEntries.delete(String(key));
      },
    };
    vi.stubGlobal("caches", { default: cache });

    const cacheKv = {
      async get(key: string, options?: { type?: string }) {
        const value = kvEntries.get(key);
        if (value === undefined) return null;
        return options?.type === "json" ? JSON.parse(value) : value;
      },
      async put(key: string, value: string) {
        kvEntries.set(key, value);
      },
      async delete(key: string) {
        kvEntries.delete(key);
      },
    };
    const app = new Hono();
    app.use(
      "*",
      smartCacheMiddleware({
        defaultTtl: 300,
        varyHeaders: ["CF-IPCountry"],
        shouldCache: (c) =>
          isPublicApiCacheableRequest(c.req.method, c.req.path),
      }),
    );

    let currency = "MYR";
    app.get("/api/v1/restaurants/:id", (c) =>
      c.json({
        success: true,
        data: { id: c.req.param("id"), settings: { currency } },
      }),
    );
    app.put("/api/v1/restaurants/:id", (c) => {
      c.set("user", { id: "user-admin", username: "admin", role: 0 });
      currency = "TWD";
      return c.json({ success: true });
    });

    const env = { CACHE_KV: cacheKv };
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
    const requestOptions = { headers: { "CF-IPCountry": "TW" } };

    const firstRestaurant = await app.request(
      "/api/v1/restaurants/restaurant-1",
      requestOptions,
      env as never,
      executionCtx as never,
    );
    const cachedRestaurant = await app.request(
      "/api/v1/restaurants/restaurant-1",
      requestOptions,
      env as never,
      executionCtx as never,
    );
    const update = await app.request(
      "/api/v1/restaurants/restaurant-1",
      { method: "PUT" },
      env as never,
      executionCtx as never,
    );
    const freshRestaurant = await app.request(
      "/api/v1/restaurants/restaurant-1",
      requestOptions,
      env as never,
      executionCtx as never,
    );

    await expect(firstRestaurant.json()).resolves.toMatchObject({
      data: { settings: { currency: "MYR" } },
    });
    await expect(cachedRestaurant.json()).resolves.toMatchObject({
      data: { settings: { currency: "MYR" } },
      cached: true,
    });
    expect(update.status).toBe(200);
    await expect(freshRestaurant.json()).resolves.toMatchObject({
      data: { settings: { currency: "TWD" } },
    });
  });

  // The cache key embeds the raw query string, and the customer app always
  // reads the menu as `?tableId=N` after a QR scan. Invalidation used to name
  // only the bare and `includeAll=true` keys, so the diner-facing entry was
  // never dropped: an owner added a dish and diners kept ordering off the old
  // menu. Tag invalidation is what reaches the query variants.
  it("invalidates the query-string menu variant a QR scan reads", async () => {
    const cacheEntries = new Map<string, Response>();
    vi.stubGlobal("caches", {
      default: {
        async match(key: RequestInfo | URL) {
          return cacheEntries.get(String(key))?.clone();
        },
        async put(key: RequestInfo | URL, response: Response) {
          cacheEntries.set(String(key), response.clone());
        },
        async delete(key: RequestInfo | URL) {
          return cacheEntries.delete(String(key));
        },
      },
    });

    const kvEntries = new Map<string, string>();
    const cacheKv = {
      async get(key: string, options?: { type?: string }) {
        const value = kvEntries.get(key);
        if (value === undefined) return null;
        return options?.type === "json" ? JSON.parse(value) : value;
      },
      async put(key: string, value: string) {
        kvEntries.set(key, value);
      },
      async delete(key: string) {
        kvEntries.delete(key);
      },
    };

    const app = new Hono();
    app.use(
      "*",
      smartCacheMiddleware({
        defaultTtl: 300,
        cacheTags: (c) => {
          const id = c.req.param("restaurantId");
          return id ? ["api", `restaurant:${id}`] : ["api"];
        },
        shouldCache: (c) =>
          isPublicApiCacheableRequest(c.req.method, c.req.path),
      }),
    );

    let dishes = ["congee"];
    app.get("/api/v1/menu/:restaurantId", (c) =>
      c.json({ success: true, data: { dishes } }),
    );
    app.put("/api/v1/menu/:restaurantId", (c) => {
      dishes = ["congee", "noodles"];
      return c.json({ success: true });
    });

    const env = { CACHE_KV: cacheKv };
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
    // The diner-facing URL: same path as the bare key, different query string.
    const dinerUrl = "/api/v1/menu/restaurant-1?tableId=2";

    await app.request(dinerUrl, undefined, env as never, executionCtx as never);
    const cachedBefore = await app.request(
      dinerUrl,
      undefined,
      env as never,
      executionCtx as never,
    );
    await app.request(
      "/api/v1/menu/restaurant-1",
      { method: "PUT" },
      env as never,
      executionCtx as never,
    );
    const afterWrite = await app.request(
      dinerUrl,
      undefined,
      env as never,
      executionCtx as never,
    );

    await expect(cachedBefore.json()).resolves.toMatchObject({
      data: { dishes: ["congee"] },
      cached: true,
    });
    await expect(afterWrite.json()).resolves.toMatchObject({
      data: { dishes: ["congee", "noodles"] },
    });
  });
});
