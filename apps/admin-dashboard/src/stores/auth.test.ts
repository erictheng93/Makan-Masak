// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAuthStore } from "./auth";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { UserRole, type ApiResponse, type User } from "@/types";
import { api, authClient, managementAuthClient } from "@/services/api";
import { getAuthToken } from "@/utils/authTokenProvider";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["error", "debug"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("@/services/api", () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
    setAuthToken: vi.fn(),
  },
  authClient: {
    instance: {
      post: vi.fn(),
    },
    tokens: {
      getToken: vi.fn(),
      setTokens: vi.fn(),
      setUser: vi.fn(),
      clearAll: vi.fn(),
      scheduleProactiveRefresh: vi.fn(),
    },
  },
  managementAuthClient: {
    setAuthToken: vi.fn(),
    tokens: {
      clearAll: vi.fn(),
    },
  },
}));

vi.mock("@/utils/authTokenProvider", () => ({
  getAuthToken: vi.fn(() => null),
}));

const moduleAccess = vi.hoisted(() => ({
  fetch: vi.fn(async () => {}),
  reset: vi.fn(),
}));

vi.mock("@makanmasak/shared/stores/moduleAccess", () => ({
  useModuleAccessStore: () => moduleAccess,
}));

// api.* return a full AxiosResponse, so a mock has to supply the whole envelope
// rather than just `data`.
function axiosResponse<T>(response: {
  data: ApiResponse<T>;
  status?: number;
}): AxiosResponse<ApiResponse<T>> {
  return {
    data: response.data,
    status: response.status ?? 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

const user = (overrides: Partial<User> = {}): User => ({
  id: "019469a1-0001-7000-8000-000000000001",
  username: "owner",
  email: "owner@example.com",
  role: UserRole.OWNER,
  restaurantId: "restaurant-1",
  createdAt: "2026-06-07T00:00:00.000Z",
  updatedAt: "2026-06-07T00:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setActivePinia(createPinia());
  vi.mocked(getAuthToken).mockReset();
  vi.mocked(getAuthToken).mockReturnValue(null);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAuthStore", () => {
  it("hydrates user, memory token, and admin restaurant context", () => {
    localStorage.setItem(
      "auth_user",
      JSON.stringify(user({ role: UserRole.ADMIN, restaurantId: null })),
    );
    vi.mocked(getAuthToken).mockReturnValue("stored-token");
    sessionStorage.setItem("admin_selected_restaurant_id", "restaurant-42");
    sessionStorage.setItem("admin_selected_restaurant_name", "Demo Restaurant");

    const store = useAuthStore();

    expect(store.isAuthenticated).toBe(true);
    expect(store.isAdminRole).toBe(true);
    expect(store.restaurantId).toBe("restaurant-42");
    expect(store.hasRestaurantContext).toBe(true);
    expect(store.selectedRestaurantName).toBe("Demo Restaurant");
    expect(store.getDefaultRoute()).toBe("/dashboard");
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("logs in, persists auth data through auth-client, and exposes owner permissions", async () => {
    vi.mocked(api.post).mockResolvedValue(
      axiosResponse({
        data: {
          success: true,
          data: {
            token: "access-token",
            refreshToken: "refresh-token",
            user: user(),
          },
        },
      }),
    );
    const store = useAuthStore();

    await expect(store.login("owner", "secret")).resolves.toEqual({
      success: true,
    });

    expect(store.user).toEqual(user());
    expect(store.token).toBe("access-token");
    expect(store.isAuthenticated).toBe(true);
    expect(store.restaurantId).toBe("restaurant-1");
    expect(store.canManageOrders).toBe(true);
    expect(store.canManageMenu).toBe(true);
    expect(store.canAccessRoute("PlatformOverview")).toBe(false);
    expect(store.getDefaultRoute()).toBe("/dashboard/owner-overview");
    expect(authClient.tokens.setTokens).toHaveBeenCalledWith("access-token");
    expect(authClient.tokens.setUser).toHaveBeenCalledWith(user());
    expect(api.setAuthToken).toHaveBeenCalledWith("access-token");
  });

  it("loads module access on login, since bootstrap already ran", async () => {
    // Bootstrap only fetches when the app starts authenticated. Without this
    // the whole session kept an empty `effectiveModules` and every
    // module-gated feature stayed hidden until a manual reload.
    vi.mocked(api.post).mockResolvedValue(
      axiosResponse({
        data: {
          success: true,
          data: {
            token: "access-token",
            refreshToken: "refresh-token",
            user: user(),
          },
        },
      }),
    );

    await useAuthStore().login("owner", "secret");

    expect(moduleAccess.fetch).toHaveBeenCalledOnce();
    expect(moduleAccess.fetch).toHaveBeenCalledWith({ force: true });
  });

  it("does not load module access when login fails", async () => {
    vi.mocked(api.post).mockResolvedValue(
      axiosResponse({
        status: 401,
        data: {
          success: false,
          error: { code: "INVALID_CREDENTIALS", message: "bad credentials" },
        },
      }),
    );

    // The key, not "bad credentials": the store translates now, and this test
    // is here for `fetch`, not for the wording.
    await expect(useAuthStore().login("owner", "wrong")).resolves.toEqual({
      success: false,
      error: "auth.invalidCredentials",
    });

    expect(moduleAccess.fetch).not.toHaveBeenCalled();
  });

  it("clears module access on logout so the next user starts empty", async () => {
    vi.mocked(api.post).mockResolvedValue(
      axiosResponse({ data: { success: true } }),
    );

    await useAuthStore().logout();

    expect(moduleAccess.reset).toHaveBeenCalledOnce();
  });

  it("restricts platform market checkout routes to admins", () => {
    localStorage.setItem(
      "auth_user",
      JSON.stringify(user({ role: UserRole.ADMIN, restaurantId: null })),
    );
    const adminStore = useAuthStore();

    expect(adminStore.canAccessRoute("PlatformMarketCheckouts")).toBe(true);

    setActivePinia(createPinia());
    localStorage.setItem("auth_user", JSON.stringify(user()));
    const ownerStore = useAuthStore();

    expect(ownerStore.canAccessRoute("PlatformMarketCheckouts")).toBe(false);
  });

  it("restricts the member directory to admin and owner", () => {
    // The member list is the only tenant surface that can reach customer PII,
    // so kitchen/service/cashier roles must not resolve the route even though
    // they share the /dashboard shell.
    const accessFor = (role: UserRole) => {
      setActivePinia(createPinia());
      localStorage.setItem("auth_user", JSON.stringify(user({ role })));
      return useAuthStore().canAccessRoute("Members");
    };

    expect(accessFor(UserRole.ADMIN)).toBe(true);
    expect(accessFor(UserRole.OWNER)).toBe(true);
    expect(accessFor(UserRole.CHEF)).toBe(false);
    expect(accessFor(UserRole.SERVICE)).toBe(false);
    expect(accessFor(UserRole.CASHIER)).toBe(false);
  });

  it("selects and clears admin restaurant context per browser tab", () => {
    localStorage.setItem(
      "auth_user",
      JSON.stringify(user({ role: UserRole.ADMIN, restaurantId: null })),
    );
    const store = useAuthStore();

    expect(store.getDefaultRoute()).toBe("/dashboard/platform");

    store.selectRestaurant("restaurant-99", "Noodle Shop");
    expect(store.restaurantId).toBe("restaurant-99");
    expect(sessionStorage.getItem("admin_selected_restaurant_id")).toBe(
      "restaurant-99",
    );
    expect(store.getDefaultRoute()).toBe("/dashboard");
    expect(moduleAccess.fetch).toHaveBeenCalledWith({ force: true });

    store.clearRestaurant();
    expect(store.restaurantId).toBeNull();
    expect(sessionStorage.getItem("admin_selected_restaurant_id")).toBeNull();
    expect(moduleAccess.reset).toHaveBeenCalledOnce();
  });

  it("keeps hydrated sessions on transient auth revalidation failures", async () => {
    localStorage.setItem("auth_user", JSON.stringify(user()));
    vi.mocked(getAuthToken).mockReturnValue("stored-token");
    vi.mocked(api.get).mockRejectedValue({ response: { status: 500 } });
    const store = useAuthStore();

    await expect(store.checkAuth()).resolves.toBe(true);

    expect(store.user).toEqual(user());
    expect(store.isAuthenticated).toBe(true);
    expect(authClient.tokens.clearAll).not.toHaveBeenCalled();
  });

  it("keeps the session when revalidation is blocked by a subscription 403", async () => {
    localStorage.setItem("auth_user", JSON.stringify(user()));
    vi.mocked(getAuthToken).mockReturnValue("stored-token");
    // api.ts wraps non-401 rejections into ErrorDetails, keeping the axios
    // error under originalError.
    vi.mocked(api.get).mockRejectedValue({
      type: "subscription",
      code: 403,
      originalError: {
        response: {
          status: 403,
          data: {
            success: false,
            error: {
              code: "SUBSCRIPTION_NOT_FOUND",
              message: "Subscription not found. Please contact support.",
            },
          },
        },
      },
    });
    const store = useAuthStore();

    await expect(store.checkAuth()).resolves.toBe(true);

    expect(store.user).toEqual(user());
    expect(store.isAuthenticated).toBe(true);
    expect(authClient.tokens.clearAll).not.toHaveBeenCalled();
    expect(managementAuthClient.tokens.clearAll).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("logs out and clears restaurant context on definitive auth failure", async () => {
    localStorage.setItem("auth_user", JSON.stringify(user()));
    vi.mocked(getAuthToken).mockReturnValue("stored-token");
    sessionStorage.setItem("admin_selected_restaurant_id", "restaurant-42");
    vi.mocked(api.get).mockRejectedValue({ response: { status: 401 } });
    vi.mocked(api.post).mockResolvedValue(
      axiosResponse({ data: { success: true } }),
    );
    const store = useAuthStore();

    await expect(store.checkAuth()).resolves.toBe(false);

    expect(store.user).toBeNull();
    expect(store.token).toBeNull();
    expect(store.restaurantId).toBeNull();
    expect(api.setAuthToken).toHaveBeenLastCalledWith(null);
    expect(authClient.tokens.clearAll).toHaveBeenCalled();
    expect(managementAuthClient.tokens.clearAll).toHaveBeenCalled();
    expect(managementAuthClient.setAuthToken).toHaveBeenCalledWith(null);
  });

  it("refreshes tokens with cookie credentials and updates user when returned", async () => {
    localStorage.setItem("auth_user", JSON.stringify(user()));
    vi.mocked(getAuthToken).mockReturnValue("old-token");
    vi.mocked(authClient.instance.post).mockResolvedValue({
      data: {
        success: true,
        data: {
          token: "new-token",
          refreshToken: "new-refresh",
          user: user({ username: "updated-owner" }),
        },
      },
    });
    const store = useAuthStore();

    await expect(store.refreshToken()).resolves.toBe(true);

    expect(authClient.instance.post).toHaveBeenCalledWith(
      "/auth/refresh",
      {},
      {
        withCredentials: true,
        _retry: true,
        _skipErrorHandler: true,
      },
    );
    expect(store.token).toBe("new-token");
    expect(store.user?.username).toBe("updated-owner");
    expect(authClient.tokens.setTokens).toHaveBeenCalledWith("new-token");
    expect(api.setAuthToken).toHaveBeenCalledWith("new-token");
  });

  it("clears stale local session state when refresh has no server session", async () => {
    localStorage.setItem("auth_user", JSON.stringify(user()));
    localStorage.setItem("mm_csrf_token_auth", "stale-csrf");
    vi.mocked(getAuthToken).mockReturnValue(null);
    vi.mocked(authClient.instance.post).mockRejectedValue({
      response: { status: 401 },
    });
    const store = useAuthStore();

    await expect(store.refreshToken()).resolves.toBe(false);

    expect(store.user).toBeNull();
    expect(store.token).toBeNull();
    expect(localStorage.getItem("auth_user")).toBeNull();
    expect(localStorage.getItem("mm_csrf_token_auth")).toBeNull();
    expect(api.setAuthToken).toHaveBeenCalledWith(null);
    expect(managementAuthClient.tokens.clearAll).toHaveBeenCalled();
  });

  it("does not warn when an expired session is simply signed out", async () => {
    // A returning visitor whose 7-day refresh cookie died still holds the
    // localStorage markers, so restoreSession() spends one round trip that is
    // meant to fail. Warning there put a yellow line in the console for a
    // correctly handled expiry, indistinguishable from a real fault.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    localStorage.setItem("auth_user", JSON.stringify(user()));
    vi.mocked(getAuthToken).mockReturnValue(null);
    vi.mocked(authClient.instance.post).mockRejectedValue({
      response: { status: 401 },
    });
    const store = useAuthStore();

    await expect(store.refreshToken()).resolves.toBe(false);

    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith("Session refresh rejected; signing out");
    warn.mockRestore();
    debug.mockRestore();
  });

  it("still warns when refresh fails for a non-auth reason", async () => {
    // Offline or a 5xx leaves the stored session intact, so the reactive 401
    // interceptor can still recover it — that is worth saying out loud.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("auth_user", JSON.stringify(user()));
    vi.mocked(getAuthToken).mockReturnValue("expired-token");
    vi.mocked(authClient.instance.post).mockRejectedValue({
      response: { status: 503 },
    });
    const store = useAuthStore();

    await expect(store.refreshToken()).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(
      "Proactive refresh failed, falling back to reactive mode",
    );
    expect(localStorage.getItem("auth_user")).toEqual(JSON.stringify(user()));
    warn.mockRestore();
  });

  it("can leave local session state intact when a background refresh fails", async () => {
    localStorage.setItem("auth_user", JSON.stringify(user()));
    vi.mocked(getAuthToken).mockReturnValue("expired-token");
    vi.mocked(authClient.instance.post).mockRejectedValue({
      response: { status: 401 },
    });
    const store = useAuthStore();

    await expect(
      store.refreshToken({ clearOnAuthFailure: false }),
    ).resolves.toBe(false);

    expect(store.user).toEqual(user());
    expect(store.token).toBe("expired-token");
    expect(localStorage.getItem("auth_user")).toEqual(JSON.stringify(user()));
    expect(api.setAuthToken).not.toHaveBeenCalledWith(null);
    expect(authClient.tokens.clearAll).not.toHaveBeenCalled();
    expect(managementAuthClient.tokens.clearAll).not.toHaveBeenCalled();
  });

  it("does not clear a piggybacked refresh caller on transient failures", async () => {
    localStorage.setItem("auth_user", JSON.stringify(user()));
    vi.mocked(getAuthToken).mockReturnValue("expired-token");

    let rejectRefresh!: (error: unknown) => void;
    vi.mocked(authClient.instance.post).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );
    const store = useAuthStore();

    const backgroundRefresh = store.refreshToken({
      clearOnAuthFailure: false,
    });
    const piggybackedRefresh = store.refreshToken();

    rejectRefresh({ response: { status: 500 } });

    await expect(backgroundRefresh).resolves.toBe(false);
    await expect(piggybackedRefresh).resolves.toBe(false);

    expect(store.user).toEqual(user());
    expect(store.token).toBe("expired-token");
    expect(localStorage.getItem("auth_user")).toEqual(JSON.stringify(user()));
    expect(api.setAuthToken).not.toHaveBeenCalledWith(null);
    expect(authClient.tokens.clearAll).not.toHaveBeenCalled();
  });

  it("clears a piggybacked refresh caller on shared auth failures", async () => {
    localStorage.setItem("auth_user", JSON.stringify(user()));
    vi.mocked(getAuthToken).mockReturnValue("expired-token");

    let rejectRefresh!: (error: unknown) => void;
    vi.mocked(authClient.instance.post).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );
    const store = useAuthStore();

    const backgroundRefresh = store.refreshToken({
      clearOnAuthFailure: false,
    });
    const piggybackedRefresh = store.refreshToken();

    rejectRefresh({ response: { status: 401 } });

    await expect(backgroundRefresh).resolves.toBe(false);
    await expect(piggybackedRefresh).resolves.toBe(false);

    expect(store.user).toBeNull();
    expect(store.token).toBeNull();
    expect(localStorage.getItem("auth_user")).toBeNull();
    expect(api.setAuthToken).toHaveBeenCalledWith(null);
    expect(authClient.tokens.clearAll).toHaveBeenCalled();
  });

  // #66: production holds the access token in memory, so a reload leaves the
  // user hydrated but the token gone. isAuthenticated needs both, so without
  // this the router guard redirected to /login and the 7-day refresh cookie
  // was never spent.
  describe("restoreSession", () => {
    it("spends the refresh cookie when a reload left a user but no token", async () => {
      localStorage.setItem("auth_user", JSON.stringify(user()));
      localStorage.setItem("mm_csrf_token_auth", "csrf-token");
      vi.mocked(getAuthToken).mockReturnValue(null);
      vi.mocked(authClient.instance.post).mockResolvedValue({
        data: { success: true, data: { token: "restored-token" } },
      });
      const store = useAuthStore();

      await expect(store.restoreSession()).resolves.toBe(true);

      expect(authClient.instance.post).toHaveBeenCalledWith(
        "/auth/refresh",
        {},
        expect.objectContaining({ withCredentials: true }),
      );
      expect(store.token).toBe("restored-token");
      expect(store.isAuthenticated).toBe(true);
    });

    it("accepts the visible CSRF cookie as a stored session marker", async () => {
      localStorage.setItem("auth_user", JSON.stringify(user()));
      vi.spyOn(document, "cookie", "get").mockReturnValue(
        "__Host-mm_csrf=csrf-cookie",
      );
      vi.mocked(getAuthToken).mockReturnValue(null);
      vi.mocked(authClient.instance.post).mockResolvedValue({
        data: { success: true, data: { token: "restored-token" } },
      });
      const store = useAuthStore();

      await expect(store.restoreSession()).resolves.toBe(true);

      expect(authClient.instance.post).toHaveBeenCalledWith(
        "/auth/refresh",
        {},
        expect.objectContaining({ withCredentials: true }),
      );
      expect(store.token).toBe("restored-token");
    });

    it("does not call the API for a visitor with no stored session", async () => {
      const store = useAuthStore();

      await expect(store.restoreSession()).resolves.toBe(false);

      expect(authClient.instance.post).not.toHaveBeenCalled();
    });

    it("does not call refresh for a stale stored user without session marker", async () => {
      localStorage.setItem("auth_user", JSON.stringify(user()));
      vi.mocked(getAuthToken).mockReturnValue(null);
      const store = useAuthStore();

      await expect(store.restoreSession()).resolves.toBe(false);

      expect(authClient.instance.post).not.toHaveBeenCalled();
      expect(store.user).toBeNull();
      expect(localStorage.getItem("auth_user")).toBeNull();
    });

    it("does not refresh during auth check for a stale stored user without session marker", async () => {
      localStorage.setItem("auth_user", JSON.stringify(user()));
      vi.mocked(getAuthToken).mockReturnValue(null);
      const store = useAuthStore();

      await expect(store.checkAuth()).resolves.toBe(false);

      expect(authClient.instance.post).not.toHaveBeenCalled();
      expect(store.user).toBeNull();
      expect(localStorage.getItem("auth_user")).toBeNull();
    });

    it("does not refresh when the token is still in memory", async () => {
      localStorage.setItem("auth_user", JSON.stringify(user()));
      vi.mocked(getAuthToken).mockReturnValue("live-token");
      const store = useAuthStore();

      await expect(store.restoreSession()).resolves.toBe(true);

      expect(authClient.instance.post).not.toHaveBeenCalled();
    });
  });
});

/**
 * `t` echoes its key here, so a leaked server sentence is unmistakable.
 */
describe("admin auth store — what a rejected login tells the reader", () => {
  const SERVER_PROSE =
    "Account locked after repeated failures. Try again in 15 minutes.";

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("distinguishes a locked account from a wrong password", async () => {
    vi.mocked(api.post).mockRejectedValue({
      response: {
        status: 401,
        data: {
          success: false,
          error: { code: "ACCOUNT_LOCKED", message: SERVER_PROSE },
        },
      },
    });

    const result = await useAuthStore().login("owner", "hunter2");

    expect(result).toEqual({ success: false, error: "auth.accountLocked" });
  });

  /**
   * The shared 401 copy says "please sign in again", which on the sign-in form
   * is the one thing they are already doing.
   */
  it("does not tell someone on the login form that their session expired", async () => {
    vi.mocked(api.post).mockRejectedValue({
      response: { status: 401, data: { success: false, error: {} } },
    });

    const result = await useAuthStore().login("owner", "hunter2");

    expect(result).toEqual({
      success: false,
      error: "auth.invalidCredentials",
    });
  });

  it("classifies a 2xx whose envelope reports the failure", async () => {
    vi.mocked(api.post).mockResolvedValue(
      axiosResponse({
        status: 200,
        data: {
          success: false,
          error: { code: "INVALID_CREDENTIALS", message: SERVER_PROSE },
        },
      }),
    );

    const result = await useAuthStore().login("owner", "hunter2");

    expect(result).toEqual({
      success: false,
      error: "auth.invalidCredentials",
    });
  });

  it("names the login action when nothing classifies", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));

    const result = await useAuthStore().login("owner", "hunter2");

    expect(result).toEqual({ success: false, error: "auth.loginFailed" });
  });
});
