import { describe, expect, it, vi } from "vitest";
import type { RouteLocationNormalized, Router } from "vue-router";
import type { useAuthStore } from "@/stores/auth";
import { getKitchenRouteRedirect, installKitchenRouterGuards } from "./guards";

type AuthStore = ReturnType<typeof useAuthStore>;

const chefUser = {
  id: 1,
  username: "chef",
  name: "Chef",
  role: 2,
  restaurantId: 42,
  permissions: [],
};

function route(overrides: Partial<RouteLocationNormalized> = {}) {
  return {
    fullPath: "/kitchen/42",
    meta: { requiresAuth: true, requiredRole: 2 },
    params: { restaurantId: "42" },
    ...overrides,
  } as unknown as RouteLocationNormalized;
}

function auth(overrides: Partial<AuthStore> = {}) {
  return {
    isAuthenticated: true,
    user: chefUser,
    restaurantId: 42,
    ...overrides,
  } as AuthStore;
}

describe("kitchen route guards", () => {
  it("allows public routes", () => {
    expect(
      getKitchenRouteRedirect(
        route({ meta: { requiresAuth: false }, params: {} }),
        auth({ isAuthenticated: false }),
      ),
    ).toBeNull();
  });

  it("allows the shop login route unauthenticated", async () => {
    const { default: routes } = await import("./index");
    const shopRoute = routes.find((r) => r.path === "/s/:slug");
    expect(shopRoute).toBeDefined();
    expect(
      getKitchenRouteRedirect(
        route({
          meta: shopRoute!.meta,
          params: { slug: "my-shop" },
          fullPath: "/s/my-shop",
        }),
        auth({ isAuthenticated: false }),
      ),
    ).toBeNull();
  });

  it("sends unauthenticated users to the remembered shop link", () => {
    localStorage.setItem("mm_kitchen_login_shop", "my-shop");
    try {
      expect(
        getKitchenRouteRedirect(route(), auth({ isAuthenticated: false })),
      ).toEqual({ path: "/s/my-shop", query: { redirect: "/kitchen/42" } });
    } finally {
      localStorage.clear();
    }
  });

  it("redirects unauthenticated protected routes to login", () => {
    expect(
      getKitchenRouteRedirect(route(), auth({ isAuthenticated: false })),
    ).toEqual({
      path: "/login",
      query: { redirect: "/kitchen/42" },
    });
  });

  it("blocks users without the required chef role", () => {
    expect(
      getKitchenRouteRedirect(
        route(),
        auth({ user: { ...chefUser, role: 1 } }),
      ),
    ).toEqual({ path: "/unauthorized" });
  });

  it("blocks access to another restaurant kitchen route", () => {
    expect(
      getKitchenRouteRedirect(route(), auth({ restaurantId: 99 })),
    ).toEqual({ path: "/unauthorized" });
  });

  it("installs an async router guard that waits for auth readiness", async () => {
    let installedGuard:
      | ((to: RouteLocationNormalized) => Promise<true | object>)
      | undefined;
    const router = {
      beforeEach: vi.fn((guard) => {
        installedGuard = guard;
        return () => {};
      }),
    };

    installKitchenRouterGuards(
      router as unknown as Router,
      auth(),
      Promise.resolve(),
    );

    expect(router.beforeEach).toHaveBeenCalledTimes(1);
    await expect(installedGuard!(route())).resolves.toBe(true);
  });
});
