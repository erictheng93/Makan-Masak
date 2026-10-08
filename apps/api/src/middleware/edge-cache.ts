import { Context, Next } from "hono";
import type { Env } from "../types/env";

/**
 * Advanced Multi-Layer Edge Caching System
 * Layer 1: Cache API (5-20ms at edge nodes)
 * Layer 2: KV Store (50-200ms globally)
 * Layer 3: Database with intelligent preloading
 *
 * Expected Performance: 50-70% improvement on repeat requests
 */

export interface CacheOptions {
  ttl: number;
  tags?: string[];
  vary?: string[];
  revalidate?: boolean;
  priority?: "high" | "normal" | "low";
}

export interface CacheMetadata {
  key: string;
  value: unknown;
  cached_at: number;
  expires_at: number;
  tags: string[];
}

interface CacheHealthMetrics {
  hit_rate: number;
  miss_rate: number;
  popular_keys: Array<{ key: string; hits: number }>;
  cache_size_estimate: number;
}

interface CachedResponseEnvelope {
  cached_at?: number;
  value?: unknown;
}

interface CacheableApiResponse {
  success: boolean;
  data?: unknown;
  [key: string]: unknown;
}

const CACHE_KEY_VARIANTS_PREFIX = "cache:key-variants:";

/**
 * Keep the global edge cache fail-closed. Only public GET routes with known
 * mutation invalidation keys belong here; security-sensitive reads such as
 * QR/booking verification must opt in explicitly if they ever become safe.
 */
export function isPublicApiCacheableRequest(
  method: string,
  path: string,
): boolean {
  if (method !== "GET") return false;

  const segments = path.split("/").filter(Boolean);
  if (segments[0] !== "api" || segments[1] !== "v1") return false;

  // These shapes mirror the exact keys invalidated by smartCacheMiddleware
  // after mutations. Do not broaden them to namespace prefixes: those also
  // contain authenticated analytics, market, and QR endpoints.
  const isRestaurantMenu =
    segments.length === 4 && segments[2] === "menu" && segments[3] !== "items";
  const isRestaurantDetail =
    segments.length === 4 &&
    segments[2] === "restaurants" &&
    segments[3] !== "popular";
  const isAvailableCoupons =
    segments.length === 5 &&
    segments[2] === "coupons" &&
    segments[3] === "available";

  return isRestaurantMenu || isRestaurantDetail || isAvailableCoupons;
}

function isCacheableApiResponse(data: unknown): data is CacheableApiResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { success?: unknown }).success === true &&
    "data" in data
  );
}

export function getRestaurantIdForCacheScope(
  c: Context<{ Bindings: Env }>,
): string | undefined {
  const restaurantId = c.req.param("restaurantId");
  if (restaurantId) return restaurantId;

  const pathSegments = c.req.path.split("/").filter(Boolean);
  const id = c.req.param("id");
  if (
    id &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "v1" &&
    pathSegments[2] === "restaurants" &&
    pathSegments[3] === id
  ) {
    return id;
  }

  const userRestaurantId = c.get("user")?.restaurantId;
  return userRestaurantId === undefined || userRestaurantId === null
    ? undefined
    : String(userRestaurantId);
}

export class EdgeCacheManager {
  constructor(
    private kv: KVNamespace,
    private context: Pick<ExecutionContext, "waitUntil">,
    private env: Env,
  ) {}

  /**
   * Multi-layer cache retrieval with intelligent fallback
   */
  async get<T>(
    key: string,
    options: Partial<CacheOptions> = {},
  ): Promise<T | null> {
    const cacheKey = this.buildCacheKey(key, options.vary);

    try {
      // LAYER 1: Cache API (Ultra-fast edge cache)
      const cacheResponse = await caches.default.match(cacheKey);
      if (
        cacheResponse &&
        !cacheResponse.headers.get("cf-cache-status")?.includes("MISS")
      ) {
        const data = (await cacheResponse.json()) as CachedResponseEnvelope;

        // A Cache API hit costs nothing. It used to cost a KV read plus a KV
        // write (the most expensive KV op, $5.00/M with 1M/month free) to bump
        // a `hit_count` that no code in this repo ever read — `getHealthMetrics`
        // reads `cache:health:metrics`, a key nothing writes. Worse, that write
        // re-put the entry without `expirationTtl`, so the first hit turned a
        // 5-minute cache entry into a permanent KV key. The counter made the
        // cache cost more the better it worked. If hit rate is ever needed
        // again, it belongs in Analytics Engine, not in a per-request KV write.

        return data.value as T;
      }

      // LAYER 2: KV Store (Global distributed cache)
      const kvData = await this.kv.get<CacheMetadata>(key, { type: "json" });
      if (kvData && !this.isExpired(kvData)) {
        const value = kvData.value as T;

        // Populate Cache API for next request (warm the edge)
        this.context.waitUntil(
          this.populateCacheAPI(cacheKey, kvData, options.ttl || 300),
        );

        // No access-metadata write here either — same dead `hit_count`, same
        // dropped `expirationTtl`. See the Layer 1 note above.

        return value;
      }

      // LAYER 3: Cache miss. There is no preload/revalidate tier: both were
      // routed at `env.PRELOAD_QUEUE` / `env.REVALIDATION_QUEUE`, which no
      // wrangler.toml in this repo has ever declared, so the optional-chained
      // `?.send` was a no-op in every environment including production. The
      // caller re-fetches on miss, which is what actually happened all along.
      return null;
    } catch (error) {
      console.error("Edge cache retrieval error:", error);
      // Graceful degradation - return null to trigger fresh fetch
      return null;
    }
  }

  /**
   * Multi-layer cache storage with intelligent distribution
   */
  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = { ttl: 300 },
  ): Promise<void> {
    const metadata: CacheMetadata = {
      key,
      value,
      cached_at: Date.now(),
      expires_at: Date.now() + options.ttl * 1000,
      tags: options.tags || [],
    };

    const cacheKey = this.buildCacheKey(key, options.vary);
    const baseCacheKey = this.buildCacheKey(key);

    try {
      // Parallel storage across all cache layers
      const storagePromises = [
        // Store in KV with metadata
        this.kv.put(key, JSON.stringify(metadata), {
          expirationTtl: options.ttl,
          metadata: {
            tags: JSON.stringify(options.tags || []),
            priority: options.priority || "normal",
          },
        }),

        // Store in Cache API with optimized headers
        caches.default.put(
          cacheKey,
          new Response(JSON.stringify(metadata), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": `max-age=${options.ttl}, s-maxage=${options.ttl}`,
              Vary: options.vary?.join(", ") || "",
              "CF-Cache-Tag": options.tags?.join(",") || "",
              "X-Cache-Priority": options.priority || "normal",
              "X-Cache-Timestamp": Date.now().toString(),
            },
          }),
        ),
      ];

      // Store tag mappings for selective invalidation
      if (options.tags?.length) {
        storagePromises.push(this.updateTagMappings(key, options.tags));
      }
      if (cacheKey !== baseCacheKey) {
        storagePromises.push(this.rememberCacheApiVariant(key, cacheKey));
      }

      await Promise.allSettled(storagePromises);

      // Analytics: Track cache storage
      this.context.waitUntil(
        this.recordCacheMetric("cache_set", key, {
          ttl: options.ttl,
          tags_count: options.tags?.length || 0,
          priority: options.priority || "normal",
        }),
      );
    } catch (error) {
      console.error("Edge cache storage error:", error);
      throw new Error(`Failed to cache data for key: ${key}`);
    }
  }

  /**
   * Intelligent cache invalidation with tag support
   */
  async invalidate(
    keyOrTags: string | string[],
    type: "key" | "tag" = "key",
  ): Promise<void> {
    try {
      if (type === "key") {
        const key = keyOrTags as string;
        const cacheApiKeys = new Set<string>([this.buildCacheKey(key)]);
        const variantMappingKey = this.getVariantMappingKey(key);
        const variants =
          (await this.kv.get<string[]>(variantMappingKey, { type: "json" })) ||
          [];
        variants.forEach((variantKey) => cacheApiKeys.add(variantKey));

        // Parallel invalidation
        await Promise.allSettled([
          this.kv.delete(key),
          this.kv.delete(variantMappingKey),
          ...Array.from(cacheApiKeys).map((cacheKey) =>
            caches.default.delete(cacheKey),
          ),
        ]);

        this.context.waitUntil(
          this.recordCacheMetric("cache_invalidate_key", key),
        );
      } else if (type === "tag") {
        const tags = Array.isArray(keyOrTags) ? keyOrTags : [keyOrTags];

        // Get all keys associated with tags
        const keysToInvalidate = new Set<string>();

        for (const tag of tags) {
          const taggedKeys =
            (await this.kv.get<string[]>(`tag:${tag}`, { type: "json" })) || [];
          taggedKeys.forEach((key) => keysToInvalidate.add(key));
        }

        // Batch invalidation
        const invalidationPromises = Array.from(keysToInvalidate).map((key) =>
          this.invalidate(key, "key"),
        );

        await Promise.allSettled(invalidationPromises);

        this.context.waitUntil(
          this.recordCacheMetric("cache_invalidate_tags", tags.join(","), {
            keys_count: keysToInvalidate.size,
          }),
        );
      }
    } catch (error) {
      console.error("Cache invalidation error:", error);
    }
  }

  /**
   * Cache health monitoring and optimization
   */
  async getHealthMetrics(): Promise<{
    hit_rate: number;
    miss_rate: number;
    popular_keys: Array<{ key: string; hits: number }>;
    cache_size_estimate: number;
  }> {
    try {
      const metrics = await this.kv.get<CacheHealthMetrics>(
        "cache:health:metrics",
        {
          type: "json",
        },
      );
      return (
        metrics || {
          hit_rate: 0,
          miss_rate: 0,
          popular_keys: [],
          cache_size_estimate: 0,
        }
      );
    } catch (error) {
      console.error("Failed to get cache health metrics:", error);
      return {
        hit_rate: 0,
        miss_rate: 0,
        popular_keys: [],
        cache_size_estimate: 0,
      };
    }
  }

  // Private helper methods
  private buildCacheKey(key: string, vary?: string[]): string {
    if (!vary?.length) return `https://cache.makanmasak.com/${key}`;

    const varyString = vary.join("-");
    return `https://cache.makanmasak.com/${key}?vary=${varyString}`;
  }

  private getVariantMappingKey(key: string): string {
    return `${CACHE_KEY_VARIANTS_PREFIX}${key}`;
  }

  private isExpired(metadata: CacheMetadata): boolean {
    return Date.now() > metadata.expires_at;
  }

  private async populateCacheAPI(
    cacheKey: string,
    metadata: CacheMetadata,
    ttl: number,
  ): Promise<void> {
    try {
      await caches.default.put(
        cacheKey,
        new Response(JSON.stringify(metadata), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `max-age=${ttl}`,
            "X-Populated-From": "KV",
            "X-Population-Time": Date.now().toString(),
          },
        }),
      );
    } catch (error) {
      console.error("Failed to populate Cache API:", error);
    }
  }

  private async updateTagMappings(key: string, tags: string[]): Promise<void> {
    try {
      const promises = tags.map(async (tag) => {
        const taggedKeys =
          (await this.kv.get<string[]>(`tag:${tag}`, { type: "json" })) || [];
        if (!taggedKeys.includes(key)) {
          taggedKeys.push(key);
          await this.kv.put(`tag:${tag}`, JSON.stringify(taggedKeys), {
            expirationTtl: 24 * 60 * 60, // 24 hours
          });
        }
      });

      await Promise.allSettled(promises);
    } catch (error) {
      console.error("Failed to update tag mappings:", error);
    }
  }

  private async rememberCacheApiVariant(
    key: string,
    cacheKey: string,
  ): Promise<void> {
    const mappingKey = this.getVariantMappingKey(key);
    const variants =
      (await this.kv.get<string[]>(mappingKey, { type: "json" })) || [];

    if (!variants.includes(cacheKey)) {
      variants.push(cacheKey);
      await this.kv.put(mappingKey, JSON.stringify(variants), {
        expirationTtl: 24 * 60 * 60,
      });
    }
  }

  private async recordCacheMetric(
    event: string,
    key: string,
    _additional?: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (this.env.ANALYTICS_ENGINE) {
        await this.env.ANALYTICS_ENGINE.writeDataPoint({
          blobs: [event, key],
          doubles: [Date.now()],
          indexes: ["1"], // Count
        });
      }
    } catch (error) {
      console.error("Failed to record cache metric:", error);
    }
  }
}

/** Clear menu edge entries before availability events invite fresh reads. */
export async function invalidateRestaurantMenuEdgeCache(
  env: Env,
  restaurantId: string,
): Promise<void> {
  if (!env.CACHE_KV) return;
  const manager = new EdgeCacheManager(
    env.CACHE_KV,
    { waitUntil: () => {} },
    env,
  );
  await Promise.all([
    manager.invalidate(`GET:/api/v1/menu/${restaurantId}:`),
    manager.invalidate(`GET:/api/v1/menu/${restaurantId}:includeAll=true`),
    manager.invalidate(`GET:/api/v1/restaurants/${restaurantId}:`),
    manager.invalidate([`restaurant:${restaurantId}`], "tag"),
  ]);
}

/**
 * Smart caching middleware with automatic optimization
 */
export function smartCacheMiddleware(
  options: {
    defaultTtl?: number;
    varyHeaders?: string[];
    cacheTags?: (c: Context<{ Bindings: Env }>) => string[];
    shouldCache?: (c: Context<{ Bindings: Env }>) => boolean;
  } = {},
) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const cacheManager = new EdgeCacheManager(
      c.env.CACHE_KV,
      c.executionCtx,
      c.env,
    );

    const method = c.req.method;
    const path = c.req.path;
    const query = c.req.url.includes("?") ? c.req.url.split("?")[1] : "";
    const cacheKey = `${method}:${path}:${query}`;

    // shouldCache decides whether this request should be cached, but we still
    // need to run mutations through the rest of the middleware so the
    // post-mutation invalidation block fires. Track the decision but never
    // early-exit for non-GET methods.
    const freshMenu =
      method === "GET" &&
      /^\/api\/v1\/menu\/[^/]+$/.test(path) &&
      /(?:^|,)\s*no-cache\s*(?:,|$)/i.test(c.req.header("Cache-Control") ?? "");
    const cacheable =
      !freshMenu && (options.shouldCache ? options.shouldCache(c) : true);

    // For cacheable GET requests, try cache first (skip for authenticated requests)
    const hasAuth = !!c.req.header("Authorization");
    if (cacheable && method === "GET" && !hasAuth) {
      const vary = options.varyHeaders
        ?.map((header) => c.req.header(header) || "")
        .filter(Boolean);

      const cached = await cacheManager.get(cacheKey, {
        vary,
        priority: path.includes("/popular/") ? "high" : "normal",
      });

      if (cached) {
        // Cache hit - return cached response as-is (it's the full response object)
        // Spread it to avoid double-wrapping
        return c.json({
          ...(cached as Record<string, unknown>),
          cached: true,
          cache_hit: true,
        });
      }
    }

    // Cache miss or non-GET request - execute handler
    await next();

    // Invalidate related caches on successful mutations (non-blocking)
    if (
      ["POST", "PUT", "DELETE", "PATCH"].includes(method) &&
      c.res.status >= 200 &&
      c.res.status < 300
    ) {
      const restaurantId = getRestaurantIdForCacheScope(c);

      // Synchronously invalidate both cache tiers before the response goes
      // out — fire-and-forget invalidation lost races against the next GET
      // and left clients reading stale menus immediately after a write.
      // Both KV and Cache API must be cleared; the earlier code only touched
      // KV "to avoid local-dev hangs".
      if (restaurantId) {
        const kv = c.env.CACHE_KV;
        if (kv) {
          // Two passes, because neither alone is sufficient.
          //
          // The cache key is `${method}:${path}:${rawQueryString}`, so every
          // distinct query string is its own entry. The key list below can only
          // name query strings someone thought to enumerate, and it never named
          // the one customers actually read: `GET:/api/v1/menu/{id}:tableId=N`,
          // written by every QR scan. An owner could add, reprice or 86 a dish
          // and diners kept ordering off the stale menu until it aged out.
          //
          // Tag invalidation closes that gap — `cacheTags` stamps
          // `restaurant:{id}` on every cacheable public GET for this restaurant
          // (menu, restaurant detail, available coupons) and `set()` records
          // each key under `tag:*`, so it reaches variants nobody listed. But it
          // is only as good as the `cacheTags` option: a caller that omits it
          // stores no tag mapping and would silently invalidate nothing. So the
          // explicit keys stay as the floor and the tag sweep rides on top.
          const keys: string[] = [];

          if (path.includes("/menu")) {
            keys.push(
              `GET:/api/v1/menu/${restaurantId}:`,
              `GET:/api/v1/menu/${restaurantId}:includeAll=true`,
            );
          }
          if (path.includes("/coupons")) {
            keys.push(`GET:/api/v1/coupons/available/${restaurantId}:`);
          }
          if (path.includes("/restaurants") || path.includes("/menu")) {
            keys.push(`GET:/api/v1/restaurants/${restaurantId}:`);
          }

          if (keys.length > 0) {
            await Promise.allSettled([
              ...keys.map((key) => cacheManager.invalidate(key)),
              cacheManager.invalidate([`restaurant:${restaurantId}`], "tag"),
            ]);
          }
        }
      }
    }

    // Cache successful GET responses (skip authenticated requests for real-time data)
    if (cacheable && method === "GET" && c.res.status === 200 && !hasAuth) {
      try {
        const responseData = await c.res.clone().json();

        if (isCacheableApiResponse(responseData)) {
          const tags = options.cacheTags ? options.cacheTags(c) : [];
          const ttl = options.defaultTtl || 300;
          const vary = options.varyHeaders
            ?.map((header) => c.req.header(header) || "")
            .filter(Boolean);

          await cacheManager.set(cacheKey, responseData, {
            ttl,
            tags,
            vary,
            priority: path.includes("/popular/") ? "high" : "normal",
          });
        }
      } catch (error) {
        console.error("Failed to cache response:", error);
      }
    }
  };
}

// `cacheWarmingMiddleware` used to live here. It ran on every request, built an
// EdgeCacheManager, and on `/menu/` paths enqueued a preload job to
// `env.PRELOAD_QUEUE` — a binding no wrangler.toml declares, so the whole
// middleware was a no-op behind `?.send`. Nothing warmed. Removed rather than
// wired up: on a cache miss the caller already fetches and `set()`s the result,
// which is the same warm-up one request later and costs nothing extra.

declare module "hono" {
  interface ContextVariableMap {
    cacheManager: EdgeCacheManager;
  }
}
