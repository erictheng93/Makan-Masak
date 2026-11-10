import { createAuthenticatedApiClient } from "@makanmasak/auth-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authApi,
  createKitchenAuthFailureHandler,
  getKitchenApiBaseUrl,
  handleKitchenAuthFailure,
} from "./authApi";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const mockTokens = vi.hoisted(() => ({
  setTokens: vi.fn(),
}));

vi.mock("@makanmasak/auth-client", () => ({
  createAuthenticatedApiClient: vi.fn(() => ({
    instance: mockApi,
    tokens: mockTokens,
  })),
}));

describe("kitchen auth API config", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.post.mockReset();
    mockTokens.setTokens.mockReset();
  });

  it("uses VITE_API_BASE_URL when configured", () => {
    expect(
      getKitchenApiBaseUrl({
        VITE_API_BASE_URL: "https://api.makanmasak.com/api/v1",
        PROD: true,
      } as ImportMetaEnv),
    ).toBe("https://api.makanmasak.com/api/v1");
  });

  it("fails fast when production has no API base URL", () => {
    expect(() => getKitchenApiBaseUrl({ PROD: true } as ImportMetaEnv)).toThrow(
      "VITE_API_BASE_URL is required",
    );
  });

  it("keeps the local proxy fallback outside production", () => {
    expect(getKitchenApiBaseUrl({ PROD: false } as ImportMetaEnv)).toBe(
      "/api/v1",
    );
  });

  it("creates the shared API client with kitchen production-safe config", () => {
    expect(createAuthenticatedApiClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "/api/v1",
        storageKeyPrefix: "kitchen",
        csrf: true,
        onAuthFailure: handleKitchenAuthFailure,
      }),
    );
  });

  it("does not redirect from the login page when authentication fails", () => {
    const assign = vi.fn();
    const handleAuthFailure = createKitchenAuthFailureHandler();

    handleAuthFailure({ pathname: "/login", assign });

    expect(assign).not.toHaveBeenCalled();
  });

  it("does not redirect from a shop login page", () => {
    const assign = vi.fn();
    createKitchenAuthFailureHandler()({ pathname: "/s/my-shop", assign });
    expect(assign).not.toHaveBeenCalled();
  });

  it("redirects session expiry to the remembered shop link", () => {
    localStorage.setItem("mm_kitchen_login_shop", "my-shop");
    try {
      const assign = vi.fn();
      createKitchenAuthFailureHandler()({ pathname: "/kitchen/1", assign });
      expect(assign).toHaveBeenCalledWith("/s/my-shop");
    } finally {
      localStorage.clear();
    }
  });

  it("redirects to login once when authentication fails away from the login page", () => {
    const assign = vi.fn();
    const handleAuthFailure = createKitchenAuthFailureHandler();

    handleAuthFailure({ pathname: "/orders", assign });
    handleAuthFailure({ pathname: "/orders", assign });

    expect(assign).toHaveBeenCalledWith("/login");
    expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe("kitchen auth API", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.post.mockReset();
    mockTokens.setTokens.mockReset();
  });

  it("posts kitchen login credentials and returns response data", async () => {
    const loginData = {
      user: {
        id: "chef-1",
        username: "chef",
        role: 2,
        restaurantId: 7,
      },
      token: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    };
    mockApi.post.mockResolvedValueOnce({ data: { data: loginData } });

    const result = await authApi.login({
      username: "chef",
      password: "secret",
    });

    expect(mockApi.post).toHaveBeenCalledWith("/auth/login", {
      username: "chef",
      password: "secret",
      system: "kitchen",
    });
    expect(result).toMatchObject({
      success: true,
      data: loginData,
    });
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it("preserves structured login failures for the UI error resolver", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const apiError = {
      response: {
        status: 401,
        data: {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid username or password",
          },
        },
      },
    };
    mockApi.post.mockRejectedValueOnce(apiError);

    await expect(
      authApi.login({ username: "chef", password: "wrong" }),
    ).rejects.toBe(apiError);
  });

  it("treats logout API failures as a successful local logout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.post.mockRejectedValueOnce(new Error("network down"));

    const result = await authApi.logout();

    expect(mockApi.post).toHaveBeenCalledWith("/auth/logout");
    expect(result).toMatchObject({ success: true });
  });

  it("returns success when logout API succeeds", async () => {
    mockApi.post.mockResolvedValueOnce({ data: {} });

    const result = await authApi.logout();

    expect(mockApi.post).toHaveBeenCalledWith("/auth/logout");
    expect(result).toMatchObject({ success: true });
  });

  it("refreshes through the HttpOnly refresh cookie and stores only returned access tokens", async () => {
    const refreshData = {
      user: {
        id: "chef-1",
        username: "chef",
        role: 2,
        restaurantId: 7,
      },
      token: "new-access-token",
      expiresIn: 3600,
    };
    mockApi.post.mockResolvedValueOnce({ data: { data: refreshData } });

    const result = await authApi.refreshToken();

    expect(mockApi.post).toHaveBeenCalledWith(
      "/auth/refresh",
      {},
      { withCredentials: true },
    );
    expect(mockTokens.setTokens).toHaveBeenCalledWith("new-access-token");
    expect(result).toMatchObject({
      success: true,
      data: refreshData,
    });
  });

  /**
   * `error` on these envelopes is a log line, not copy. Nothing renders a
   * background token refresh failing -- it retries or signs the chef out -- and
   * "refresh denied" is what makes that decision explicable afterwards.
   */
  it("keeps the server's reason on the refresh failure for the log", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.post.mockRejectedValueOnce({
      response: { data: { message: "Refresh denied" } },
    });

    const result = await authApi.refreshToken();

    expect(result).toMatchObject({
      success: false,
      error: "Refresh denied",
    });
  });

  it("validates the current token and returns the user", async () => {
    const user = {
      id: "chef-1",
      username: "chef",
      role: 2,
      restaurantId: 7,
    };
    mockApi.get.mockResolvedValueOnce({ data: { user } });

    const result = await authApi.validateToken();

    expect(mockApi.get).toHaveBeenCalledWith("/auth/validate");
    expect(result).toMatchObject({
      success: true,
      data: user,
    });
  });

  it("keeps the server's reason on a validation failure for the log", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.get.mockRejectedValueOnce({
      response: { data: { message: "Token expired" } },
    });

    const result = await authApi.validateToken();

    expect(mockApi.get).toHaveBeenCalledWith("/auth/validate");
    expect(result).toMatchObject({
      success: false,
      error: "Token expired",
    });
  });

  it("fetches the current user", async () => {
    const user = {
      id: "chef-1",
      username: "chef",
      role: 2,
      restaurantId: 7,
    };
    mockApi.get.mockResolvedValueOnce({ data: { user } });

    const result = await authApi.getCurrentUser();

    expect(mockApi.get).toHaveBeenCalledWith("/auth/me");
    expect(result).toMatchObject({
      success: true,
      data: user,
    });
  });

  it("falls back to the caller's text when the failure says nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.get.mockRejectedValueOnce(new Error(""));

    const result = await authApi.getCurrentUser();

    expect(mockApi.get).toHaveBeenCalledWith("/auth/me");
    expect(result).toMatchObject({
      success: false,
      error: "獲取用戶資訊失敗",
    });
  });
});
