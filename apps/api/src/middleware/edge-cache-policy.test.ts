import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPublicApiCacheableRequest,
  REPLAY_DELAY_MS,
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
    // Menu writes clear the cache after responding, inside waitUntil.
    expect(executionCtx.waitUntil).toHaveBeenCalled();
    await settleDeferred(executionCtx.waitUntil);
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

  it("shares one entry across table links but not across response-affecting queries", async () => {
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
      put: vi.fn(async (key: string, value: string) => {
        kvEntries.set(key, value);
      }),
      async delete(key: string) {
        kvEntries.delete(key);
      },
    };

    const app = new Hono();
    app.use(
      "*",
      smartCacheMiddleware({
        defaultTtl: 300,
        cacheTags: () => ["restaurant:restaurant-1"],
        shouldCache: (c) =>
          isPublicApiCacheableRequest(c.req.method, c.req.path),
      }),
    );
    const menuHandler = vi.fn((c) =>
      c.json({
        success: true,
        data: { variant: c.req.query("includeAll") ?? "public" },
      }),
    );
    app.get("/api/v1/menu/:restaurantId", menuHandler);
    const restaurantHandler = vi.fn((c) =>
      c.json({ success: true, data: { id: "restaurant-1" } }),
    );
    app.get("/api/v1/restaurants/:id", restaurantHandler);

    const env = { CACHE_KV: cacheKv };
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
    const get = (url: string) =>
      app.request(url, undefined, env as never, executionCtx as never);

    await get("/api/v1/menu/restaurant-1?tableId=1");
    const otherTable = await get("/api/v1/menu/restaurant-1?tableId=2&utm=qr");
    const bare = await get("/api/v1/menu/restaurant-1");
    const includeAll = await get("/api/v1/menu/restaurant-1?includeAll=true");

    // Three table/bare links shared one handler run; includeAll got its own.
    expect(menuHandler).toHaveBeenCalledTimes(2);
    await expect(otherTable.json()).resolves.toMatchObject({ cached: true });
    await expect(bare.json()).resolves.toMatchObject({
      data: { variant: "public" },
      cached: true,
    });
    await expect(includeAll.json()).resolves.toMatchObject({
      data: { variant: "true" },
    });
    expect(
      cacheKv.put.mock.calls.filter(([key]) =>
        key.startsWith("GET:/api/v1/menu"),
      ),
    ).toEqual([
      ["GET:/api/v1/menu/restaurant-1:", expect.any(String), expect.anything()],
      [
        "GET:/api/v1/menu/restaurant-1:includeAll=true",
        expect.any(String),
        expect.anything(),
      ],
    ]);

    await get("/api/v1/restaurants/restaurant-1?tableId=1");
    await get("/api/v1/restaurants/restaurant-1?tableId=2");
    expect(restaurantHandler).toHaveBeenCalledTimes(1);

    // A parameter nobody has classified stays in the key: if a handler starts
    // reading it, two values must never share one cached response.
    await get("/api/v1/restaurants/restaurant-1?lang=en&tableId=1");
    await get("/api/v1/restaurants/restaurant-1?lang=ja&utm_source=qr");
    await get("/api/v1/restaurants/restaurant-1?lang=ja&tableId=9");
    expect(restaurantHandler).toHaveBeenCalledTimes(3);
  });

  // A menu write answers before its cache clears, but realtime must not go
  // out until both tiers are clear, or a client refetches into a stale copy.
  it("answers a menu write first, then clears query cache, edge cache, and only then pushes", async () => {
    const order: string[] = [];
    vi.stubGlobal("caches", {
      default: {
        match: async () => undefined,
        put: async () => {},
        delete: async () => {
          order.push("edge");
          return true;
        },
      },
    });
    const cacheKv = {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    };
    const app = new Hono();
    app.use("*", smartCacheMiddleware({ defaultTtl: 300 }));
    let releaseQueryCache!: () => void;
    app.post("/api/v1/menu/:restaurantId/items", (c) => {
      const deferred = c.get("deferredCache");
      deferred.pending.push(
        new Promise<void>((resolve) => {
          releaseQueryCache = () => {
            order.push("query-cache");
            resolve();
          };
        }),
      );
      deferred.after.push(async () => {
        order.push("push");
      });
      return c.json({ success: true }, 201);
    });
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };

    const response = await app.request(
      "/api/v1/menu/restaurant-1/items",
      { method: "POST" },
      { CACHE_KV: cacheKv } as never,
      executionCtx as never,
    );

    expect(response.status).toBe(201);
    expect(order).toEqual([]);
    expect(executionCtx.waitUntil).toHaveBeenCalledOnce();

    releaseQueryCache();
    await settleDeferred(executionCtx.waitUntil);
    const firstPass = order.slice(0, order.indexOf("push") + 1);
    expect(firstPass[0]).toBe("query-cache");
    expect(firstPass).toContain("edge");
    expect(firstPass.at(-1)).toBe("push");
  });

  // A diner's read that raced the first clear can write the pre-write menu
  // back into the edge tier; the delayed second sweep must remove it, or the
  // stale menu (a dish already taken off sale) stays up for the full TTL.
  it("sweeps again after the first clear so a raced stale copy does not survive", async () => {
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
          return id ? [`restaurant:${id}`] : [];
        },
        shouldCache: (c) =>
          isPublicApiCacheableRequest(c.req.method, c.req.path),
      }),
    );
    let served = ["congee", "noodles"];
    app.get("/api/v1/menu/:restaurantId", (c) =>
      c.json({ success: true, data: { dishes: served } }),
    );
    app.put("/api/v1/menu/:restaurantId", (c) => c.json({ success: true }));
    const env = { CACHE_KV: cacheKv };
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
    const dinerUrl = "/api/v1/menu/restaurant-1?tableId=2";
    const read = () =>
      app.request(dinerUrl, undefined, env as never, executionCtx as never);

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      await app.request(
        "/api/v1/menu/restaurant-1",
        { method: "PUT" },
        env as never,
        executionCtx as never,
      );
      const sweep = executionCtx.waitUntil.mock.calls[0][0] as Promise<void>;
      await vi.advanceTimersByTimeAsync(0);

      // The race: a read that loaded the pre-write menu lands after the first
      // clear and caches it.
      await read();
      await expect((await read()).json()).resolves.toMatchObject({
        data: { dishes: ["congee", "noodles"] },
        cached: true,
      });

      served = ["congee"];
      await vi.advanceTimersByTimeAsync(REPLAY_DELAY_MS);
      await sweep;
      await expect((await read()).json()).resolves.toMatchObject({
        data: { dishes: ["congee"] },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("menu writes without a restaurant in the URL", () => {
  // PUT /menu/items/:id used to clear no edge entry at all: the middleware
  // scoped by the URL's restaurant id and this URL has none, so a repriced
  // dish stayed at the old price for diners until the entry aged out.
  it("clears the diner's cached menu for the restaurant the write touched", async () => {
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
          return id ? [`restaurant:${id}`] : [];
        },
        shouldCache: (c) =>
          isPublicApiCacheableRequest(c.req.method, c.req.path),
      }),
    );
    let price = 180;
    app.get("/api/v1/menu/:restaurantId", (c) =>
      c.json({ success: true, data: { price } }),
    );
    app.put("/api/v1/menu/items/:id", (c) => {
      price = 200;
      // What the query-cache layer records when the item's restaurant clears.
      c.get("deferredCache").cleared.push(
        "menu:restaurant-1",
        "restaurant:restaurant-1",
      );
      return c.json({ success: true });
    });
    const env = { CACHE_KV: cacheKv };
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
    const dinerUrl = "/api/v1/menu/restaurant-1?tableId=2";
    const read = () =>
      app.request(dinerUrl, undefined, env as never, executionCtx as never);

    await read();
    await expect((await read()).json()).resolves.toMatchObject({
      data: { price: 180 },
      cached: true,
    });
    await app.request(
      "/api/v1/menu/items/11",
      { method: "PUT" },
      env as never,
      executionCtx as never,
    );
    await settleDeferred(executionCtx.waitUntil);

    await expect((await read()).json()).resolves.toMatchObject({
      data: { price: 200 },
    });
  });
});

describe("coupon writes", () => {
  function setup() {
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
    const kvDelete = vi.fn(async (key: string) => {
      kvEntries.delete(key);
    });
    const cacheKv = {
      async get(key: string, options?: { type?: string }) {
        const value = kvEntries.get(key);
        if (value === undefined) return null;
        return options?.type === "json" ? JSON.parse(value) : value;
      },
      async put(key: string, value: string) {
        kvEntries.set(key, value);
      },
      delete: kvDelete,
    };
    const app = new Hono();
    app.use(
      "*",
      smartCacheMiddleware({
        defaultTtl: 300,
        cacheTags: (c) => {
          const id = c.req.param("restaurantId");
          return id ? [`restaurant:${id}`] : [];
        },
        shouldCache: (c) =>
          isPublicApiCacheableRequest(c.req.method, c.req.path),
      }),
    );
    const env = { CACHE_KV: cacheKv };
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
    return { app, env, executionCtx, kvDelete };
  }

  it("answers before the edge clear, then clears the customer coupon list the route scoped", async () => {
    const { app, env, executionCtx, kvDelete } = setup();
    let active = true;
    app.get("/api/v1/coupons/available/:restaurantId", (c) =>
      c.json({ success: true, data: { active } }),
    );
    // No user on the context (an admin write): only the route's recorded
    // scope can name the restaurant.
    let release!: () => void;
    app.post("/api/v1/coupons/:id/deactivate", (c) => {
      active = false;
      // Stands in for a query-cache clear still in flight at response time.
      c.get("deferredCache").pending.push(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      c.get("deferredCache").cleared.push("restaurant:restaurant-1");
      return c.json({ success: true });
    });
    const read = () =>
      app.request(
        "/api/v1/coupons/available/restaurant-1",
        undefined,
        env as never,
        executionCtx as never,
      );

    await read();
    await expect((await read()).json()).resolves.toMatchObject({
      data: { active: true },
      cached: true,
    });
    kvDelete.mockClear();

    const res = await app.request(
      "/api/v1/coupons/10/deactivate",
      { method: "POST" },
      env as never,
      executionCtx as never,
    );

    expect(res.status).toBe(200);
    expect(kvDelete).not.toHaveBeenCalled(); // edge clear waits on the query cache
    release();
    await settleDeferred(executionCtx.waitUntil);
    expect(kvDelete).toHaveBeenCalledWith(
      "GET:/api/v1/coupons/available/restaurant-1:",
    );
    await expect((await read()).json()).resolves.toMatchObject({
      data: { active: false },
    });
  });

  it("leaves validate, use and distribute inline", async () => {
    const { app, env, executionCtx } = setup();
    const seen: unknown[] = [];
    const paths = ["validate", "use", "10/distribute"];
    for (const path of paths) {
      app.post(`/api/v1/coupons/${path}`, (c) => {
        seen.push(c.get("deferredCache"));
        return c.json({ success: true });
      });
    }
    for (const path of paths) {
      await app.request(
        `/api/v1/coupons/${path}`,
        { method: "POST" },
        env as never,
        executionCtx as never,
      );
    }
    expect(seen).toEqual([undefined, undefined, undefined]);
    expect(executionCtx.waitUntil).not.toHaveBeenCalled();
  });
});

/** Run every waitUntil job to completion, including the delayed sweep. */
async function settleDeferred(waitUntil: ReturnType<typeof vi.fn>) {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    const jobs = Promise.all(waitUntil.mock.calls.map(([work]) => work));
    await vi.advanceTimersByTimeAsync(REPLAY_DELAY_MS);
    await jobs;
  } finally {
    vi.useRealTimers();
  }
}
