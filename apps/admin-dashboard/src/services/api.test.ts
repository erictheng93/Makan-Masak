// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  clearAdminAuthStorage,
  createAdminAuthFailureHandler,
  ensureManagementAuthToken,
  getAdminTokenStorageMode,
  managementAuthClient,
} from "./api";

describe("admin API auth storage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps production admin access tokens in memory", () => {
    expect(getAdminTokenStorageMode({ DEV: false } as ImportMetaEnv)).toBe(
      "memory",
    );
  });

  it("uses sessionStorage only in dev to survive Vite full reloads", () => {
    expect(getAdminTokenStorageMode({ DEV: true } as ImportMetaEnv)).toBe(
      "sessionStorage",
    );
  });

  it("clears stale admin auth state from both browser storage scopes", () => {
    localStorage.setItem("auth_token", "stale-local-token");
    localStorage.setItem("auth_refresh_token", "stale-local-refresh");
    localStorage.setItem("auth_user", '{"id":"local-user"}');
    localStorage.setItem("management_auth_token", "stale-management-token");
    sessionStorage.setItem("auth_token", "stale-session-token");
    sessionStorage.setItem("auth_refresh_token", "stale-session-refresh");
    sessionStorage.setItem("auth_user", '{"id":"session-user"}');
    sessionStorage.setItem("management_auth_token", "stale-management-token");

    clearAdminAuthStorage();

    for (const key of [
      "auth_token",
      "auth_refresh_token",
      "auth_user",
      "management_auth_token",
      "management_auth_refresh_token",
      "management_auth_user",
    ]) {
      expect(localStorage.getItem(key)).toBeNull();
      expect(sessionStorage.getItem(key)).toBeNull();
    }
  });

  it("redirects to login once after refresh failure, keeping the destination", () => {
    const handleAuthFailure = createAdminAuthFailureHandler();
    const location = {
      pathname: "/dashboard/monitoring",
      search: "?tab=alerts",
      assign: vi.fn(),
    };

    localStorage.setItem("auth_token", "stale-local-token");
    sessionStorage.setItem("auth_token", "stale-session-token");

    handleAuthFailure(location);
    handleAuthFailure(location);

    expect(location.assign).toHaveBeenCalledTimes(1);
    expect(location.assign).toHaveBeenCalledWith(
      "/login?redirect=%2Fdashboard%2Fmonitoring%3Ftab%3Dalerts",
    );
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(sessionStorage.getItem("auth_token")).toBeNull();
  });

  it("does not redirect when authentication fails on the login page", () => {
    const handleAuthFailure = createAdminAuthFailureHandler();
    const location = { pathname: "/login", assign: vi.fn() };

    handleAuthFailure(location);

    expect(location.assign).not.toHaveBeenCalled();
  });

  it("exchanges an admin API token for an isolated management token", async () => {
    vi.spyOn(managementAuthClient.instance, "post").mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          token: "management-token",
        },
      },
    });
    vi.spyOn(managementAuthClient.tokens, "setTokens");
    vi.spyOn(managementAuthClient, "setAuthToken");

    await expect(ensureManagementAuthToken("api-token")).resolves.toBe(
      "management-token",
    );

    expect(managementAuthClient.instance.post).toHaveBeenCalledWith(
      "/auth/exchange",
      { token: "api-token" },
      expect.objectContaining({ _retry: true }),
    );
    expect(managementAuthClient.tokens.setTokens).toHaveBeenCalledWith(
      "management-token",
    );
    expect(managementAuthClient.setAuthToken).toHaveBeenCalledWith(
      "management-token",
    );
  });
});

describe("api.get config detection", () => {
  it("passes validateStatus as request config, not as query params", async () => {
    const get = vi
      .spyOn(api.instance, "get")
      .mockResolvedValueOnce({ status: 503, data: {} });
    const validateStatus = (status: number) => status < 400 || status === 503;

    await api.get("/monitoring/health", { validateStatus });

    expect(get).toHaveBeenCalledWith("/monitoring/health", {
      validateStatus,
    });
  });

  it("still treats a plain object as query params", async () => {
    const get = vi
      .spyOn(api.instance, "get")
      .mockResolvedValueOnce({ status: 200, data: {} });

    await api.get("/orders", { limit: 20 });

    expect(get).toHaveBeenCalledWith("/orders", { params: { limit: 20 } });
  });
});
