import { describe, expect, it, vi } from "vitest";

const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../shared/utils/meter", () => ({ meterEmit }));

import { createApp } from "../../../app-factory";

/**
 * Both broadcast routers are merged into prefixes another feature already
 * owns, and `/markets` in particular already has a catch-all `GET /:slug`.
 * app-factory also runs a route-existence middleware that 404s anything it
 * cannot find among the registered routes, so "mounted" is not something the
 * per-router tests can observe: they call the router directly.
 *
 * 401 is the passing answer here. It means the request reached the route and
 * its auth guard; 404 would mean the mount does not exist.
 */
describe("broadcast routes are reachable through the app factory", () => {
  function app() {
    return createApp(undefined, {
      disableEdgeCache: true,
      disableObservability: true,
    });
  }

  async function call(path: string, method: string) {
    return app().fetch(
      new Request(`https://api.test${path}`, {
        method,
        headers: {
          Host: "api.test",
          Origin: "https://api.test",
          "Content-Type": "application/json",
        },
        body:
          method === "POST"
            ? JSON.stringify({ title: "t", body: "b" })
            : undefined,
      }),
      { NODE_ENV: "test" } as never,
    );
  }

  it.each([
    ["/api/v1/restaurants/restaurant-1/broadcasts", "GET"],
    ["/api/v1/markets/market-1/broadcasts", "GET"],
  ])(
    "%s %s requires authentication rather than 404ing",
    async (path, method) => {
      const response = await call(path, method);
      expect(response.status).toBe(401);
    },
  );

  it("still serves the public market detail route it shares a prefix with", async () => {
    // GET /markets/:slug must not be shadowed by GET /markets/:id/broadcasts.
    const response = await call("/api/v1/markets/some-slug", "GET");
    expect(response.status).not.toBe(404);
  });
});
