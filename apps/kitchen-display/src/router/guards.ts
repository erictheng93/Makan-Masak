import type { RouteLocationNormalized, Router } from "vue-router";
import type { useAuthStore } from "@/stores/auth";
import { loginPath } from "@/utils/login-shop";

type AuthStore = ReturnType<typeof useAuthStore>;

export function getKitchenRouteRedirect(
  to: RouteLocationNormalized,
  authStore: AuthStore,
) {
  if (!to.meta.requiresAuth) {
    return null;
  }

  if (!authStore.isAuthenticated) {
    return {
      path: loginPath(),
      query: { redirect: to.fullPath },
    };
  }

  if (to.meta.requiredRole && authStore.user?.role !== to.meta.requiredRole) {
    return { path: "/unauthorized" };
  }

  const routeRestaurantId = to.params.restaurantId;
  if (
    routeRestaurantId &&
    String(authStore.restaurantId) !== String(routeRestaurantId)
  ) {
    return { path: "/unauthorized" };
  }

  return null;
}

export function installKitchenRouterGuards(
  router: Router,
  authStore: AuthStore,
  authReady: Promise<unknown>,
) {
  router.beforeEach(async (to) => {
    await authReady;
    return getKitchenRouteRedirect(to, authStore) ?? true;
  });
}
