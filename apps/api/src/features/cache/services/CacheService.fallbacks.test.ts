import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  CACHE_STRATEGIES,
  CacheKeys,
  CacheService,
  createCacheService,
} from "./CacheService";

function createKV() {
  const values = new Map<string, string>();
  const expirationTtls = new Map<string, number | undefined>();

  return {
    values,
    expirationTtls,
    kv: {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(
        async (
          key: string,
          value: string,
          options?: { expirationTtl?: number },
        ) => {
          values.set(key, value);
          expirationTtls.set(key, options?.expirationTtl);
        },
      ),
      delete: vi.fn(async (key: string) => {
        values.delete(key);
        expirationTtls.delete(key);
      }),
      list: vi.fn(async () => ({
        keys: Array.from(values.keys()).map((name) => ({ name })),
      })),
      // The assertions below drive these through their vi.fn surface, so the
      // stub keeps both.
    } as unknown as KVNamespace & {
      get: Mock;
      put: Mock;
      delete: Mock;
      list: Mock;
    },
  };
}

type Internals = {
  getAllKeys: () => Promise<string[]>;
  getMetadata: (key: string) => Promise<unknown>;
  setMetadata: (key: string, meta: unknown) => Promise<void>;
};

describe("CacheService fallbacks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
    vi.useRealTimers();
  });

  it("builds namespaced keys for every entity", () => {
    expect(CacheKeys.menu("r1")).toBe("menu:r1");
    expect(CacheKeys.restaurant("r1")).toBe("restaurant:r1");
    expect(CacheKeys.analytics("r1", "day")).toBe("analytics:r1:day");
    expect(CacheKeys.session(9)).toBe("session:9");
    expect(CacheKeys.qrcode("q")).toBe("qrcode:q");
    expect(CacheKeys.menuCategory("r1", 3)).toBe("menu_category:r1:3");
    expect(CacheKeys.userPreferences(4)).toBe("user_prefs:4");
    expect(CacheKeys.orderStats("r1", "2026-06-07")).toBe(
      "order_stats:r1:2026-06-07",
    );
  });

  it("does not leave a stale grace period for strategies without one", async () => {
    const { kv } = createKV();
    const service = new CacheService(kv);
    await service.set(
      "session:1",
      { u: 1 },
      { ...CACHE_STRATEGIES.SESSION, ttl: 1 },
    );

    vi.advanceTimersByTime(1_500);

    await expect(service.get("session:1")).resolves.toBeNull();
    expect(kv.delete).toHaveBeenCalledWith("session:1");
  });

  it("does not leave a stale grace period for entries with unknown tags", async () => {
    const { kv } = createKV();
    const service = new CacheService(kv);
    await service.set("custom", 1, { ttl: 1, tags: ["unlisted"] });

    vi.advanceTimersByTime(1_500);

    await expect(service.get("custom")).resolves.toBeNull();
  });

  it("returns persisted stats when present", async () => {
    const { kv, values } = createKV();
    const service = new CacheService(kv);
    values.set("_cache_stats", JSON.stringify({ hitCount: 42 }));

    await expect(service.getStats()).resolves.toEqual({ hitCount: 42 });
  });

  it("falls back to in-memory stats when the stats read fails", async () => {
    const { kv } = createKV();
    kv.get.mockRejectedValue(new Error("kv down"));
    const service = new CacheService(kv);

    await expect(service.getStats()).resolves.toMatchObject({
      hitCount: 0,
      missCount: 0,
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("rethrows a failed write so callers know the value was not cached", async () => {
    const { kv } = createKV();
    kv.put.mockRejectedValue(new Error("quota"));
    const service = new CacheService(kv);

    await expect(service.set("k", 1, { ttl: 10 })).rejects.toThrow("quota");
  });

  it("reports a failed delete as false instead of throwing", async () => {
    const { kv } = createKV();
    kv.delete.mockRejectedValue(new Error("kv down"));
    const service = new CacheService(kv);

    await expect(service.delete("k")).resolves.toBe(false);
  });

  it("treats a failed key scan as nothing to invalidate, clean or expire", async () => {
    const service = new CacheService(createKV().kv);
    const internals = service as unknown as Internals;
    vi.spyOn(internals, "getAllKeys").mockRejectedValue(
      new Error("list failed"),
    );

    await expect(service.invalidateByTags(["menu"])).resolves.toBe(0);
    await expect(service.cleanup()).resolves.toBe(0);
    await expect(service.getExpiringKeys()).resolves.toEqual([]);
  });

  it("returns 0 from warmup when the input is unusable", async () => {
    const service = new CacheService(createKV().kv);
    await expect(service.warmup(null as never)).resolves.toBe(0);
  });

  it("flushes only counters whose metadata still exists and survives write failures", async () => {
    const { kv } = createKV();
    const service = new CacheService(kv);
    const internals = service as unknown as Internals & {
      hitCounters: Map<string, number>;
    };
    internals.hitCounters.set("gone", 3);
    internals.hitCounters.set("ok", 2);
    internals.hitCounters.set("broken", 1);
    const meta = (key: string) => ({
      key,
      hitCount: 0,
      expiresAt: Date.now() + 1_000,
    });
    vi.spyOn(internals, "getMetadata").mockImplementation(async (key) =>
      key === "gone" ? null : meta(key),
    );
    const setMetadata = vi
      .spyOn(internals, "setMetadata")
      .mockImplementation(async (key) => {
        if (key === "broken") throw new Error("write failed");
      });

    await expect(service.flushHitCounters()).resolves.toBe(1);

    expect(setMetadata).toHaveBeenCalledWith(
      "ok",
      expect.objectContaining({ hitCount: 2 }),
    );
    expect(internals.hitCounters.size).toBe(0);
  });
});
