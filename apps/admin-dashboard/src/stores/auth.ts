import { defineStore } from "pinia";
import { ref, computed, readonly } from "vue";
import type { AxiosRequestConfig } from "axios";
import type { User } from "@/types";
import { UserRole } from "@/types";
import { api, authClient, managementAuthClient } from "@/services/api";
import { t } from "@/i18n";
import {
  extractApiErrorCode,
  isSubscriptionErrorCode,
  setAuthRefreshHandler,
} from "@/utils/errorHandler";
import { getAuthToken } from "@/utils/authTokenProvider";
import { useModuleAccessStore } from "@makanmasak/shared/stores/moduleAccess";
import { getApiErrorStatus } from "@makanmasak/shared/utils/unknown";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

type RetryableAxiosRequestConfig = AxiosRequestConfig & {
  _retry?: boolean;
  _skipErrorHandler?: boolean;
};

interface RefreshTokenOptions {
  clearOnAuthFailure?: boolean;
}

interface RefreshTokenAttempt {
  refreshed: boolean;
  authFailure: boolean;
}

const AUTH_CSRF_STORAGE_KEY = "mm_csrf_token_auth";
const LEGACY_CSRF_STORAGE_KEY = "mm_csrf_token";
const CSRF_COOKIE_NAME = "__Host-mm_csrf";
const AUTH_REFRESH_TOKEN_KEY = "auth_refresh_token";

// Hydrate user from localStorage for instant restore on refresh
const hydrateUser = (): User | null => {
  try {
    const saved = localStorage.getItem("auth_user");
    return saved ? JSON.parse(saved) : null;
  } catch {
    localStorage.removeItem("auth_user");
    return null;
  }
};

const persistUser = (u: User | null) => {
  if (u) {
    localStorage.setItem("auth_user", JSON.stringify(u));
  } else {
    localStorage.removeItem("auth_user");
  }
};

const getCookieValue = (name: string): string | null => {
  const cookie = globalThis.document?.cookie;
  if (!cookie) return null;

  return cookie.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? null;
};

const hasStoredSessionMarker = () => {
  try {
    return (
      !!localStorage.getItem(AUTH_CSRF_STORAGE_KEY) ||
      !!localStorage.getItem(LEGACY_CSRF_STORAGE_KEY) ||
      !!getCookieValue(CSRF_COOKIE_NAME) ||
      !!localStorage.getItem(AUTH_REFRESH_TOKEN_KEY) ||
      !!sessionStorage.getItem(AUTH_REFRESH_TOKEN_KEY)
    );
  } catch {
    return false;
  }
};

const clearStoredSessionState = () => {
  try {
    localStorage.removeItem("auth_user");
    localStorage.removeItem(AUTH_CSRF_STORAGE_KEY);
    localStorage.removeItem(LEGACY_CSRF_STORAGE_KEY);
    localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
  } catch {
    // Storage may be unavailable; in-memory refs are still cleared below.
  }
};

// Module-level deduplication: all callers share the same in-flight refresh
let sharedRefreshPromise: Promise<RefreshTokenAttempt> | null = null;

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(hydrateUser());
  const token = ref<string | null>(getAuthToken());

  const isLoading = ref(false);

  // Admin restaurant context (sessionStorage-backed for per-tab isolation)
  const selectedRestaurantId = ref<string | null>(
    sessionStorage.getItem("admin_selected_restaurant_id"),
  );
  const selectedRestaurantName = ref<string | null>(
    sessionStorage.getItem("admin_selected_restaurant_name"),
  );

  const isAuthenticated = computed(() => !!user.value && !!token.value);
  const userRole = computed(() => user.value?.role);
  const isAdminRole = computed(() => user.value?.role === UserRole.ADMIN);
  const hasRestaurantContext = computed(() => restaurantId.value !== null);

  // For admin: use selected restaurant; for others: use their bound restaurant
  const restaurantId = computed(() => {
    if (isAdminRole.value) {
      return selectedRestaurantId.value;
    }
    return user.value?.restaurantId ?? null;
  });

  const selectRestaurant = (id: string, name: string) => {
    selectedRestaurantId.value = id;
    selectedRestaurantName.value = name;
    sessionStorage.setItem("admin_selected_restaurant_id", id);
    sessionStorage.setItem("admin_selected_restaurant_name", name);
    void useModuleAccessStore().fetch({ force: true });
  };

  const clearRestaurant = () => {
    selectedRestaurantId.value = null;
    selectedRestaurantName.value = null;
    sessionStorage.removeItem("admin_selected_restaurant_id");
    sessionStorage.removeItem("admin_selected_restaurant_name");
    useModuleAccessStore().reset();
  };

  const clearLocalSessionState = () => {
    user.value = null;
    token.value = null;
    clearStoredSessionState();
    clearRestaurant();
    api.setAuthToken(null);
    authClient.tokens.clearAll();
    managementAuthClient.tokens.clearAll();
    managementAuthClient.setAuthToken(null);
  };

  const hasPermission = (requiredRole: UserRole | UserRole[]) => {
    if (!user.value) return false;

    const userRoleValue = user.value.role;
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

    return roles.includes(userRoleValue);
  };

  const canAccessAdminFeatures = computed(() =>
    hasPermission([UserRole.ADMIN, UserRole.OWNER]),
  );

  const canManageOrders = computed(() =>
    hasPermission([
      UserRole.ADMIN,
      UserRole.OWNER,
      UserRole.SERVICE,
      UserRole.CASHIER,
    ]),
  );

  const canManageMenu = computed(() =>
    hasPermission([UserRole.ADMIN, UserRole.OWNER]),
  );

  const canAccessService = computed(() =>
    hasPermission([UserRole.ADMIN, UserRole.OWNER, UserRole.SERVICE]),
  );

  const canAccessCashier = computed(() =>
    hasPermission([UserRole.ADMIN, UserRole.OWNER, UserRole.CASHIER]),
  );

  const canAccessOwnerDashboard = computed(() =>
    hasPermission([UserRole.ADMIN, UserRole.OWNER]),
  );

  const canManageStaff = computed(() =>
    hasPermission([UserRole.ADMIN, UserRole.OWNER]),
  );

  const canViewAnalytics = computed(() =>
    hasPermission([UserRole.ADMIN, UserRole.OWNER]),
  );

  const canManageSettings = computed(() =>
    hasPermission([UserRole.ADMIN, UserRole.OWNER]),
  );

  // 根據用戶角色返回預設路由
  const getDefaultRoute = () => {
    if (!user.value) return "/login";

    switch (user.value.role) {
      case UserRole.ADMIN:
        return selectedRestaurantId.value
          ? "/dashboard"
          : "/dashboard/platform";
      case UserRole.OWNER:
        return "/dashboard/owner-overview";
      case UserRole.CHEF:
        // Chef should be redirected to Kitchen Display App (handled by LoginView)
        // Fallback to dashboard if somehow reached here
        return "/dashboard";
      case UserRole.SERVICE:
        return "/service";
      case UserRole.CASHIER:
        return "/dashboard/pos/checkout";
      default:
        return "/dashboard";
    }
  };

  // 檢查用戶是否可以訪問特定路由
  const canAccessRoute = (routeName: string) => {
    if (!user.value) return false;

    const routePermissions: Record<string, UserRole[]> = {
      Dashboard: [
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.CHEF,
        UserRole.SERVICE,
        UserRole.CASHIER,
      ],
      DashboardHome: [
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.CHEF,
        UserRole.SERVICE,
        UserRole.CASHIER,
      ],
      PlatformOverview: [UserRole.ADMIN],
      PlatformMarkets: [UserRole.ADMIN],
      PlatformMarketCheckouts: [UserRole.ADMIN],
      Orders: [
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.SERVICE,
        UserRole.CASHIER,
      ],
      Menu: [UserRole.ADMIN, UserRole.OWNER],
      Tables: [UserRole.ADMIN, UserRole.OWNER],
      Users: [UserRole.ADMIN, UserRole.OWNER],
      EmployeeList: [UserRole.ADMIN, UserRole.OWNER],
      EmployeeAttendance: [UserRole.ADMIN, UserRole.OWNER],
      EmployeeProfile: [UserRole.ADMIN, UserRole.OWNER],
      EmployeeSchedule: [UserRole.ADMIN, UserRole.OWNER],
      EmployeeLeave: [UserRole.ADMIN, UserRole.OWNER],
      Scheduling: [UserRole.ADMIN, UserRole.OWNER],
      // Own shifts + own swap requests, so every staff role reaches it (#320).
      MyShifts: [
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.CHEF,
        UserRole.SERVICE,
        UserRole.CASHIER,
      ],
      // Own balances + own leave requests, same reasoning as MyShifts (#344).
      MyLeaves: [
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.CHEF,
        UserRole.SERVICE,
        UserRole.CASHIER,
      ],
      // Own shift + own clock in/out, same reasoning as MyShifts (#308).
      MyAttendance: [
        UserRole.ADMIN,
        UserRole.OWNER,
        UserRole.CHEF,
        UserRole.SERVICE,
        UserRole.CASHIER,
      ],
      Analytics: [UserRole.ADMIN, UserRole.OWNER],
      Settings: [UserRole.ADMIN, UserRole.OWNER],
      Service: [UserRole.ADMIN, UserRole.OWNER, UserRole.SERVICE],
      ServiceDelivery: [UserRole.ADMIN, UserRole.OWNER, UserRole.SERVICE],
      POSCheckout: [UserRole.ADMIN, UserRole.OWNER, UserRole.CASHIER],
      POSManagement: [UserRole.ADMIN, UserRole.OWNER, UserRole.CASHIER],
      OwnerOverview: [UserRole.ADMIN, UserRole.OWNER],
      Feedback: [UserRole.ADMIN, UserRole.OWNER],
      Members: [UserRole.ADMIN, UserRole.OWNER],
      PlatformCustomers: [UserRole.ADMIN],
    };

    const requiredRoles = routePermissions[routeName];
    if (!requiredRoles) return true; // 如果沒有定義權限，允許訪問

    return hasPermission(requiredRoles);
  };

  /**
   * Discriminated on purpose: the login view reads `error` only after checking
   * `success`, which needs the literal types to narrow.
   */
  type LoginResult = { success: true } | { success: false; error: string };

  /**
   * A rejected login answers 401 however it failed, so only the code separates
   * a wrong password from a locked account -- see LOGIN_FAILURE_CODES in the
   * API's authentication routes. And 401's shared copy ("please sign in again")
   * is the one thing the reader is already doing, so this screen overrides it.
   */
  const loginFailure = (error: unknown): LoginResult => ({
    success: false,
    error: resolveUserFacingError(error, t, {
      codeKeys: {
        INVALID_CREDENTIALS: "auth.invalidCredentials",
        ACCOUNT_LOCKED: "auth.accountLocked",
      },
      statusKeys: { 401: "auth.invalidCredentials" },
      fallbackKey: "auth.loginFailed",
    }).message,
  });

  const login = async (username: string, password: string) => {
    isLoading.value = true;
    try {
      const response = await api.post<{
        token: string;
        refreshToken?: string;
        user: User;
      }>("/auth/login", { username, password });

      if (response.data.success && response.data.data) {
        token.value = response.data.data.token;
        user.value = response.data.data.user;

        authClient.tokens.setTokens(token.value!);
        authClient.tokens.setUser(user.value);
        api.setAuthToken(token.value!);
        authClient.tokens.scheduleProactiveRefresh(token.value!);

        // Bootstrap only loads module access when the app starts already
        // authenticated, so logging in from the login page would otherwise
        // leave `effectiveModules` empty for the rest of the session and hide
        // every module-gated feature until a manual reload. Forced because a
        // previous user's entry may still be cached in this page session.
        // Deliberately not awaited: login must not block on it, and the store
        // records its own failures.
        void useModuleAccessStore().fetch({ force: true });

        return { success: true } satisfies LoginResult;
      }

      // A 2xx whose envelope says the login failed. Reshaped so the branch
      // below classifies it the same way it classifies a rejected request.
      return loginFailure({
        response: { status: response.status, data: response.data },
      });
    } catch (error: unknown) {
      console.error("Login error:", error);
      return loginFailure(error);
    } finally {
      isLoading.value = false;
    }
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (error) {
      console.warn("Logout request failed:", error);
    } finally {
      clearLocalSessionState();
    }
  };

  const checkAuth = async () => {
    if (!token.value && user.value) {
      if (!hasStoredSessionMarker()) {
        clearLocalSessionState();
        return false;
      }

      const refreshed = await refreshToken();
      if (!refreshed) return false;
    }

    if (!token.value) return false;

    try {
      api.setAuthToken(token.value);
      const response = await api.get<User>("/auth/me");

      if (response.data.success && response.data.data) {
        user.value = response.data.data;
        persistUser(user.value);
        if (token.value)
          authClient.tokens.scheduleProactiveRefresh(token.value);
        return true;
      }
    } catch (error: unknown) {
      const status = getApiErrorStatus(error);

      // Only logout on definitive auth failures (401/403).
      // Transient errors (429 rate-limit, 5xx, network) should NOT
      // wipe the session — the hydrated user from localStorage is
      // good enough until the next successful revalidation.
      // NOTE: Don't call refreshToken() here — the axios 401 interceptor
      // in api.ts already attempted a refresh + retry. If we still got
      // an error, the refresh failed. Just logout.
      //
      // Exception: a 403 carrying a subscription/plan code (moduleGate) is
      // NOT an auth failure — the session is perfectly valid, the plan just
      // doesn't cover the route. Logging the owner out because their trial
      // expired would be a terrible failure mode. Checked on the code rather
      // than the status because api.ts rejects non-401s as ErrorDetails.
      if (isSubscriptionErrorCode(extractApiErrorCode(error))) {
        console.warn("Auth revalidation blocked by subscription gate");
        return !!user.value;
      }

      if (status === 401 || status === 403) {
        await logout();
        return false;
      }

      console.warn("Auth revalidation failed (non-auth error):", status);
      // Keep the hydrated user — session is still valid locally
      return !!user.value;
    }

    // Server responded but user data was missing — token likely invalid
    await logout();
    return false;
  };

  const refreshToken = async (
    options: RefreshTokenOptions = {},
  ): Promise<boolean> => {
    const clearOnAuthFailure = options.clearOnAuthFailure !== false;

    // Deduplicate: if a refresh is already in flight, reuse its promise
    if (sharedRefreshPromise) {
      const attempt = await sharedRefreshPromise;
      if (!attempt.refreshed && attempt.authFailure && clearOnAuthFailure) {
        clearLocalSessionState();
      }
      return attempt.refreshed;
    }

    sharedRefreshPromise = (async () => {
      try {
        // Use the shared axios instance but skip the 401 refresh interceptor
        // for the refresh call itself.
        const refreshConfig: RetryableAxiosRequestConfig = {
          withCredentials: true,
          _retry: true,
          _skipErrorHandler: true,
        };
        const response = await authClient.instance.post(
          "/auth/refresh",
          {},
          refreshConfig,
        );
        const data = response.data;

        if (data.success && data.data) {
          token.value = data.data.token;
          authClient.tokens.setTokens(data.data.token);
          api.setAuthToken(token.value!);

          if (data.data.user) {
            user.value = data.data.user;
            persistUser(user.value);
          }

          authClient.tokens.scheduleProactiveRefresh(token.value!);
          return { refreshed: true, authFailure: false };
        }
      } catch (error: unknown) {
        const status = getApiErrorStatus(error);
        const authFailure = status === 400 || status === 401 || status === 403;
        if (clearOnAuthFailure && authFailure) {
          clearLocalSessionState();
        }
        if (authFailure) {
          // The 7-day refresh cookie expired (or was revoked) while the
          // localStorage markers outlived it, so restoreSession() spent one
          // doomed round trip. That is the designed path, not a fault: the
          // state has just been cleared, the guard is about to redirect to
          // /login, and the next load makes no request at all. Warning about it
          // put a yellow line in every returning visitor's console for a
          // correctly handled expiry — and "falling back to reactive mode" was
          // untrue here, because there is no session left to recover
          // reactively.
          //
          // This is a dev-only breadcrumb: vite.config.ts lists console.debug
          // in terser's `pure_funcs`, so the call is stripped from production
          // builds entirely. Production logs nothing here, which is the point —
          // do not reach for console.debug expecting to read it in the field.
          console.debug("Session refresh rejected; signing out");
        } else {
          // Offline or a 5xx leaves the stored session intact, so the reactive
          // 401 interceptor really can still recover it on the next call.
          console.warn(
            "Proactive refresh failed, falling back to reactive mode",
          );
        }
        return { refreshed: false, authFailure };
      }

      console.warn(
        "Refresh returned non-success, falling back to reactive mode",
      );
      return { refreshed: false, authFailure: false };
    })();

    try {
      const attempt = await sharedRefreshPromise;
      return attempt.refreshed;
    } finally {
      sharedRefreshPromise = null;
    }
  };

  /**
   * Recover a session that a page reload half-destroyed.
   *
   * Production stores the access token in memory only, so a reload leaves the
   * user hydrated from storage but the token gone. isAuthenticated requires
   * both, so the router guard would redirect to /login without ever spending
   * the 7-day refresh cookie kept for exactly this case (#66).
   *
   * Returns whether a session is usable afterwards. A visitor with no stored
   * user has nothing to restore and must not pay for a doomed round trip.
   */
  const restoreSession = async (): Promise<boolean> => {
    if (token.value) return true;
    if (!user.value) return false;
    if (!hasStoredSessionMarker()) {
      clearLocalSessionState();
      return false;
    }

    return refreshToken();
  };

  setAuthRefreshHandler(refreshToken);

  return {
    user: readonly(user),
    token: readonly(token),
    isLoading: readonly(isLoading),
    isAuthenticated,
    userRole,
    restaurantId,
    isAdminRole,
    hasRestaurantContext,
    selectedRestaurantName: readonly(selectedRestaurantName),
    hasPermission,
    canAccessAdminFeatures,
    canManageOrders,
    canManageMenu,
    canAccessService,
    canAccessCashier,
    canAccessOwnerDashboard,
    canManageStaff,
    canViewAnalytics,
    canManageSettings,
    getDefaultRoute,
    canAccessRoute,
    selectRestaurant,
    clearRestaurant,
    login,
    logout,
    checkAuth,
    refreshToken,
    restoreSession,
  };
});
