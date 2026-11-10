import { afterEach, describe, expect, it, vi } from "vitest";
import type { Router } from "vue-router";
import {
  idlePrefetchPaths,
  prefetchRoute,
  prefetchWhenIdle,
} from "./prefetchRoutes";

function fakeRouter(load: () => Promise<unknown>) {
  return {
    resolve: () => ({
      matched: [
        { components: { default: load } },
        { components: { default: {} } },
      ],
    }),
  } as unknown as Router;
}

describe("prefetchRoutes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads only components that are still lazy functions", () => {
    const load = vi.fn().mockResolvedValue({});
    prefetchRoute(fakeRouter(load), "/dashboard/menu");
    expect(load).toHaveBeenCalledOnce();
  });

  it("swallows chunk failures", () => {
    const load = vi.fn().mockRejectedValue(new Error("boom"));
    expect(() => prefetchRoute(fakeRouter(load), "/x")).not.toThrow();
    expect(load).toHaveBeenCalledOnce();
  });

  it("idle-warms only the daily pages, not every sidebar entry", () => {
    expect(
      idlePrefetchPaths([
        "/dashboard",
        "/dashboard/menu",
        "/dashboard/analytics",
        "/dashboard/orders",
        "/dashboard/ai-analytics/insights",
        "/dashboard/seating",
        "/dashboard/pos",
        "/dashboard/settings",
      ]),
    ).toEqual([
      "/dashboard/menu",
      "/dashboard/orders",
      "/dashboard/seating",
      "/dashboard/pos",
      "/dashboard/pos/checkout",
      "/dashboard/pos/management",
    ]);
  });

  it("prefetches in idle time and skips when saveData is on", () => {
    const load = vi.fn().mockResolvedValue({});
    vi.stubGlobal("window", {
      requestIdleCallback: (cb: () => void) => cb(),
    });
    prefetchWhenIdle(fakeRouter(load), ["/a", "/b"]);
    expect(load).toHaveBeenCalledTimes(2);

    load.mockClear();
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    prefetchWhenIdle(fakeRouter(load), ["/a"]);
    expect(load).not.toHaveBeenCalled();
  });
});
