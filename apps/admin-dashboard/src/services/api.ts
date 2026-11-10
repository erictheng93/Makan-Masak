import {
  isAxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import {
  createAuthenticatedApiClient,
  type ApiClient,
  type TokenStorageMode,
} from "@makanmasak/auth-client";
import type { ApiResponse } from "@/types";
import { KitchenErrorHandler } from "@/utils/errorHandler";
import { setAuthTokenProvider } from "@/utils/authTokenProvider";
import { LOGIN_PATH, loginUrlFor } from "@/utils/loginRedirect";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function unwrapApiPayload<T>(payload: unknown): T {
  if (isRecord(payload) && "data" in payload) {
    return payload.data as T;
  }

  return payload as T;
}

export function unwrapApiData<T>(response: { data: unknown }): T {
  return unwrapApiPayload<T>(response.data);
}

export function unwrapApiList<T>(payload: unknown): T[] {
  const data = unwrapApiPayload<unknown>(payload);
  return Array.isArray(data) ? (data as T[]) : [];
}

export function getAdminTokenStorageMode(
  env: Pick<ImportMetaEnv, "DEV"> = import.meta.env,
): TokenStorageMode {
  // Development only: survive Vite full reloads while keeping production tokens
  // out of browser storage.
  return env.DEV ? "sessionStorage" : "memory";
}

const ADMIN_AUTH_STORAGE_KEYS = [
  "auth_token",
  "auth_refresh_token",
  "auth_user",
  "management_auth_token",
  "management_auth_refresh_token",
  "management_auth_user",
] as const;

interface AuthFailureLocation {
  pathname: string;
  search?: string;
  assign(url: string): void;
}

export function clearAdminAuthStorage(): void {
  for (const key of ADMIN_AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }

  // Sweeping the storage keys is not enough on its own: production keeps the
  // bearer token in memory, and each client owns a CSRF token that only it
  // knows the key for. Only clearAll() reaches both.
  authClient.tokens.clearAll();
  authClient.setAuthToken(null);
  managementAuthClient.tokens.clearAll();
  managementAuthClient.setAuthToken(null);
}

export function createAdminAuthFailureHandler() {
  let loginRedirectRequested = false;

  return function handleAdminAuthFailure(
    location: AuthFailureLocation = window.location,
  ): void {
    clearAdminAuthStorage();

    if (loginRedirectRequested || location.pathname === LOGIN_PATH) {
      return;
    }

    loginRedirectRequested = true;
    // Carry the current page across so a mid-session 401 does not silently
    // relocate the user to their role's landing page once they log back in.
    location.assign(
      loginUrlFor(`${location.pathname}${location.search ?? ""}`),
    );
  };
}

export const handleAdminAuthFailure = createAdminAuthFailureHandler();

const authClient = createAuthenticatedApiClient({
  baseURL: resolveApiBase(),
  storageKeyPrefix: "auth",
  storageKeys: {
    token: "auth_token",
    refreshToken: "auth_refresh_token",
    user: "auth_user",
  },
  tokenStorage: getAdminTokenStorageMode(),
  csrf: true,
  onAuthFailure: handleAdminAuthFailure,
  errorHandler: (error: unknown) => {
    const context = isAxiosError(error)
      ? {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          data: error.response?.data,
        }
      : undefined;

    return KitchenErrorHandler.handleAPIError(error, context);
  },
});

setAuthTokenProvider(() => authClient.tokens.getToken());

export function resolveApiBase(): string {
  return import.meta.env.VITE_API_BASE_URL || "/api/v1";
}

function resolveManagementApiBase(): string {
  return import.meta.env.VITE_MANAGEMENT_API_URL || "/management-api/v1";
}

const managementAuthClient = createAuthenticatedApiClient({
  baseURL: resolveManagementApiBase(),
  storageKeyPrefix: "management_auth",
  storageKeys: {
    token: "management_auth_token",
    refreshToken: "management_auth_refresh_token",
    user: "management_auth_user",
  },
  tokenStorage: getAdminTokenStorageMode(),
  csrf: true,
  onAuthFailure: handleAdminAuthFailure,
  errorHandler: (error: unknown) => {
    const context = isAxiosError(error)
      ? {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          data: error.response?.data,
        }
      : undefined;

    return KitchenErrorHandler.handleAPIError(error, context);
  },
});

type RetryableRequestConfig = AxiosRequestConfig & { _retry?: boolean };

export async function ensureManagementAuthToken(
  apiToken = authClient.tokens.getToken(),
): Promise<string> {
  if (!apiToken) {
    throw new Error("Admin API token is required for management API access");
  }

  const response = await managementAuthClient.instance.post<
    ApiResponse<{ token: string }>
  >("/auth/exchange", { token: apiToken }, {
    _retry: true,
    withCredentials: true,
  } as RetryableRequestConfig);
  const data = unwrapApiPayload<{ token?: string }>(response.data);

  if (!data.token) {
    throw new Error("Management token exchange did not return a token");
  }

  managementAuthClient.tokens.setTokens(data.token);
  managementAuthClient.setAuthToken(data.token);

  return data.token;
}

// Backward-compatible API object matching the old ApiService class interface.
// 42 files import { api } or { apiClient } from this module.
class ApiServiceCompat {
  constructor(private readonly client: ApiClient = authClient) {}

  get instance() {
    return this.client.instance;
  }

  setAuthToken(token: string | null) {
    this.client.setAuthToken(token);
  }

  async get<T>(
    url: string,
    paramsOrConfig?: unknown,
  ): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.client.instance.get(url, this.toGetConfig(paramsOrConfig));
  }

  async post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.client.instance.post(url, data, config);
  }

  async put<T>(
    url: string,
    data?: unknown,
  ): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.client.instance.put(url, data);
  }

  async patch<T>(
    url: string,
    data?: unknown,
  ): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.client.instance.patch(url, data);
  }

  async delete<T>(
    url: string,
    data?: unknown,
  ): Promise<AxiosResponse<ApiResponse<T>>> {
    return this.client.instance.delete(url, data ? { data } : undefined);
  }

  async upload<T = unknown>(
    url: string,
    formData: FormData,
  ): Promise<AxiosResponse<T>> {
    return this.client.instance.post(url, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  }

  private toGetConfig(
    paramsOrConfig?: unknown,
  ): AxiosRequestConfig | undefined {
    if (!paramsOrConfig) {
      return undefined;
    }

    if (this.isAxiosConfig(paramsOrConfig)) {
      return paramsOrConfig;
    }

    return { params: paramsOrConfig };
  }

  private isAxiosConfig(value: unknown): value is AxiosRequestConfig {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    // A config key missing here turns the whole object into query params:
    // OwnerView's `validateStatus` went out as `?validateStatus=e=>...` and a
    // 503 "critical" health report threw instead of rendering.
    return [
      "params",
      "headers",
      "responseType",
      "signal",
      "timeout",
      "withCredentials",
      "validateStatus",
    ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
  }
}

export const api = new ApiServiceCompat();
export const apiClient = api;
export const managementApi = new ApiServiceCompat(managementAuthClient);
export { authClient, managementAuthClient };
