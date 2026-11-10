import { createAuthenticatedApiClient } from "@makanmasak/auth-client";
import type { ApiResponse, User } from "@/types";
import { describeErrorForLog } from "@/utils/unknown";
import { isLoginPath, loginPath } from "@/utils/login-shop";

export function getKitchenApiBaseUrl(env = import.meta.env): string {
  const baseUrl = env.VITE_API_BASE_URL;

  if (!baseUrl && env.PROD) {
    throw new Error(
      "[Config Error] VITE_API_BASE_URL is required for kitchen-display production builds",
    );
  }

  return baseUrl || "/api/v1";
}

interface AuthFailureLocation {
  pathname: string;
  assign(url: string): void;
}

export function createKitchenAuthFailureHandler() {
  let loginRedirectRequested = false;

  return function handleKitchenAuthFailure(
    location: AuthFailureLocation = window.location,
  ): void {
    // A failed login also returns 401, but navigating from this page destroys
    // the login form before it can render the server-provided error message.
    if (loginRedirectRequested || isLoginPath(location.pathname)) {
      return;
    }

    loginRedirectRequested = true;
    location.assign(loginPath());
  };
}

export const handleKitchenAuthFailure = createKitchenAuthFailureHandler();

// Create the shared API client with kitchen-specific config
export const apiClient = createAuthenticatedApiClient({
  baseURL: getKitchenApiBaseUrl(),
  storageKeyPrefix: "kitchen",
  csrf: true,
  onAuthFailure: handleKitchenAuthFailure,
});

// Re-export the axios instance for kitchenApi.ts (default import)
const api = apiClient.instance;
export default api;

export interface LoginCredentials {
  username: string;
  password: string;
  shop?: string;
}

export interface LoginResponse {
  user: User;
  token: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface LoginContext {
  slug: string;
  name: string;
  logoUrl: string | null;
}

export const authApi = {
  // Public shop info for the login page; 404 SHOP_NOT_FOUND = invalid link.
  async getLoginContext(slug: string): Promise<LoginContext> {
    const response = await api.get(
      `/restaurants/login-context/${encodeURIComponent(slug)}`,
    );
    return response.data.data;
  },

  // 登入
  async login(
    credentials: LoginCredentials,
  ): Promise<ApiResponse<LoginResponse>> {
    try {
      const response = await api.post("/auth/login", {
        ...credentials,
        system: "kitchen", // 標識這是廚房系統登入
      });

      return {
        success: true,
        data: response.data.data,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      console.error("Login API error:", error);

      // Rethrown rather than flattened into a failure envelope. The login form
      // classifies from `response.status` and the envelope's `code` -- and from
      // axios's own `code` when the request never left the browser, which is
      // what separates "your password is wrong" from "the wifi is off". Copying
      // those onto an envelope only to read them back off it loses whatever the
      // envelope has no field for.
      throw error;
    }
  },

  // 登出
  async logout(): Promise<ApiResponse> {
    try {
      await api.post("/auth/logout");

      return {
        success: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      // 即使登出 API 失敗，也視為成功（本地清除認證信息）
      console.error("Logout API error:", error);

      return {
        success: true,
        timestamp: new Date().toISOString(),
      };
    }
  },

  // 刷新 token
  async refreshToken(): Promise<ApiResponse<LoginResponse>> {
    try {
      const response = await api.post(
        "/auth/refresh",
        {},
        {
          withCredentials: true,
        },
      );

      const data = response.data?.data;
      if (data?.token) {
        apiClient.tokens.setTokens(data.token);
      }

      return {
        success: true,
        data: response.data.data,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      console.error("Refresh token API error:", error);
      return {
        success: false,
        error: describeErrorForLog(error, "Token 刷新失敗"),
        timestamp: new Date().toISOString(),
      };
    }
  },

  // 驗證 token
  async validateToken(): Promise<ApiResponse<User>> {
    try {
      const response = await api.get("/auth/validate");

      return {
        success: true,
        data: response.data.user,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      console.error("Validate token API error:", error);

      const message = describeErrorForLog(error, "Token 驗證失敗");
      return {
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      };
    }
  },

  // 獲取用戶資訊
  async getCurrentUser(): Promise<ApiResponse<User>> {
    try {
      const response = await api.get("/auth/me");

      return {
        success: true,
        data: response.data.user,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      console.error("Get current user API error:", error);

      const message = describeErrorForLog(error, "獲取用戶資訊失敗");
      return {
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
