import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./shared/utils/meter", () => ({ meterEmit }));
vi.mock("./shared/utils/ephemeral-store", () => ({
  ephemeralStore: (env: { EPHEMERAL: unknown }) => env.EPHEMERAL,
}));

import { API_CUSTOM_RATE_LIMITS, createApp } from "./app-factory";
import { geoIntelligentRateLimitMiddleware } from "./middleware/geo-rate-limiting";
import type { Env } from "./types/env";

/**
 * #339: every `customLimits` key was compared with `===` against the full
 * request path, so three keys naming a mount prefix with no route of its own
 * matched nothing and quietly did nothing for as long as they had been there.
 *
 * #341: the survivors still mostly did nothing, for a different reason — the
 * values bind only on the KV path, and every other path is held to a native
 * binding that ignores them. Seven were deleted.
 *
 * These are the two signals whose absence let that sit unnoticed.
 */
describe("API_CUSTOM_RATE_LIMITS", () => {
  const entries = Object.entries(API_CUSTOM_RATE_LIMITS) as Array<
    [string, { requests: number; match?: "exact" | "prefix" }]
  >;

  describe("every entry names a real route", () => {
    let registeredPaths: Set<string>;

    // createApp pulls in every feature router. Pay that transform cost once
    // here under the hook's own budget rather than a test timeout (#211).
    beforeAll(() => {
      const app = createApp(undefined, {
        disableEdgeCache: true,
        disableObservability: true,
      });
      registeredPaths = new Set(app.routes.map((route) => route.path));
      // Guard the guard: if Hono ever stops flattening mounted sub-routers
      // into `app.routes`, every assertion below would pass vacuously.
      expect(registeredPaths.has("/api/v1/orders")).toBe(true);
    }, 30_000);

    it.each(entries)("%s is registered", (path, limit) => {
      if (limit.match === "prefix") {
        expect(
          [...registeredPaths].filter((r) => r.startsWith(`${path}/`)).length,
        ).toBeGreaterThan(0);
        return;
      }
      expect(registeredPaths.has(path)).toBe(true);
    });
  });

  /**
   * The middleware emits `X-RateLimit-Limit` only on the KV path — precisely
   * because the native binding enforces a number it will not report (#342). So
   * the header coming back with the configured value is the proof that this
   * entry governs something. An entry for a native-path route produces no
   * header and fails here, which is the regression #341 was about.
   */
  describe("every entry actually governs a request", () => {
    it.each(entries)("%s is enforced, not decorative", async (path, limit) => {
      const env = {
        NODE_ENV: "production",
        // Bound on purpose: with a native limiter available, only a KV-routed
        // path still consults these values.
        GLOBAL_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
        EPHEMERAL: {
          get: vi.fn(async () => null),
          put: vi.fn(async () => undefined),
          delete: vi.fn(async () => undefined),
        },
      } as unknown as Env;

      const app = new Hono<{ Bindings: Env }>();
      app.use(
        "*",
        geoIntelligentRateLimitMiddleware({
          skipPaths: ["/health", "/info"],
          customLimits: API_CUSTOM_RATE_LIMITS,
        }),
      );
      app.all("*", (c) => c.json({ ok: true }));

      const response = await app.fetch(
        new Request(`https://api.test${path}`, {
          method: "POST",
          headers: { "CF-Connecting-IP": "203.0.113.10" },
        }),
        env,
        {
          waitUntil: vi.fn(),
          passThroughOnException: vi.fn(),
          props: {},
        } as unknown as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("X-RateLimit-Limit")).toBe(
        String(limit.requests),
      );
    });
  });
});
