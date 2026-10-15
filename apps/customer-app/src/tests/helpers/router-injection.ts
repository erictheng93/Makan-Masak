import { config } from "@vue/test-utils";
import { routeLocationKey, routerKey } from "vue-router";
import { vi } from "vitest";

/**
 * Components such as FollowButton call `useRouter()` / `useRoute()`, which
 * `inject()` the router that `app.use(router)` provides in production. A bare
 * `mount()` has none, so Vue warns once per render. Call this at the top of a
 * test file that mounts such a component without a real router.
 */
export function provideRouterInjection(): void {
  config.global.provide = {
    ...config.global.provide,
    [routerKey as symbol]: { push: vi.fn(), replace: vi.fn() },
    [routeLocationKey as symbol]: {
      path: "/",
      fullPath: "/",
      query: {},
      params: {},
    },
  };
}
