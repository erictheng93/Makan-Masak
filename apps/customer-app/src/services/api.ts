import { getGuestOrderToken } from "@/utils/guest-order-tokens";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import type {
  ApiResponse,
  ApiErrorCodeValue,
  PaginatedResponse,
} from "@makanmasak/shared-types";
import { translate } from "@/utils/i18n";
import { getOrCreateGuestDeviceId } from "@/utils/guestDevice";
import {
  clearCustomerAccessToken,
  getCustomerAccessToken,
  hasCustomerAccessToken,
} from "./customerAccessToken";

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * Marks a request whose 401 *is* the answer — a password check, an OTP
     * check, a reset/verification token check. For those the server's own
     * message ("Invalid identifier or password", "Invalid or expired token")
     * is what the diner needs to read, and there is no session to tear down.
     * Every other 401 still means the access token died and is handled as
     * such.
     */
    credentialCheck?: boolean;
  }
}

// API 配置
const getApiBaseUrl = (): string => {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "[Config Error] VITE_API_BASE_URL is required. " +
        "Please set this environment variable in your .env file.",
    );
  }
  return baseUrl;
};

const API_CONFIG = {
  baseURL: getApiBaseUrl(),
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
};

// API 錯誤類
export class ApiException extends Error {
  constructor(
    public code: ApiErrorCodeValue,
    message: string,
    public details?: unknown,
    public status?: number,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiException";
  }
}

/** Paths using the guest device id for locks or coupon usage limits. */
const GUEST_DEVICE_IDENTITY_PATHS = [
  "/guest-orders",
  "/market-checkouts",
  "/coupons/validate",
];

function usesGuestDeviceIdentity(url: string | undefined): boolean {
  if (!url) return false;
  return GUEST_DEVICE_IDENTITY_PATHS.some(
    (path) => url === path || url.startsWith(`${path}/`),
  );
}

// API 客戶端類
class ApiClient {
  private instance: AxiosInstance;
  private requestInterceptorId?: number;
  private responseInterceptorId?: number;

  constructor() {
    this.instance = axios.create({
      baseURL: API_CONFIG.baseURL,
      timeout: API_CONFIG.timeout,
      headers: {
        "Content-Type": "application/json",
        "X-Client-Version": "2.0.0",
        "X-Client-Platform": "web",
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // 請求攔截器
    this.requestInterceptorId = this.instance.interceptors.request.use(
      (config) => {
        // Guest order reads and mutations require that order's credential,
        // even after the diner signs in. Other endpoints retain customer auth.
        const guestOrderId = config.url?.match(
          /^\/guest-orders\/([^/?#]+)(?:[/?#]|$)/,
        )?.[1];
        const token = guestOrderId
          ? getGuestOrderToken(guestOrderId)
          : (getCustomerAccessToken() ??
            localStorage.getItem("guest_auth_token"));
        if (token) config.headers.Authorization = `Bearer ${token}`;

        // 添加請求 ID
        config.headers["X-Request-ID"] = crypto.randomUUID();

        // Guest ordering endpoints key their "one active order per vendor"
        // lock on this device id. Coupon preview uses the same identity.
        // Limit the header to these paths: a per-device id everywhere is a
        // tracking identifier we have no use for. It is sent regardless of
        // sign-in state: `Authorization` carries the customer JWT once the
        // shopper has an account, and market checkout still runs through the
        // guest route, so the JWT would otherwise leave the server no identity
        // to lock on at all.
        if (
          usesGuestDeviceIdentity(config.url) &&
          (config.url !== "/coupons/validate" || !getCustomerAccessToken())
        ) {
          const deviceId = getOrCreateGuestDeviceId();
          if (deviceId) {
            config.headers["X-Guest-Device-Id"] = deviceId;
          }
        }

        // 添加餐廳上下文
        const context = localStorage.getItem("makanmakan_restaurant_context");
        if (context) {
          try {
            const { restaurant, tableId } = JSON.parse(context);
            config.headers["X-Restaurant-ID"] = restaurant.id.toString();
            config.headers["X-Table-ID"] = tableId.toString();
          } catch (error) {
            console.warn("Failed to parse restaurant context:", error);
          }
        }

        if (import.meta.env.DEV) {
          console.log(
            `🚀 API請求: ${config.method?.toUpperCase()} ${config.url}`,
            {
              params: config.params,
              data: config.data,
            },
          );
        }

        return config;
      },
      (error) => {
        console.error("❌ API請求攔截器錯誤:", error);
        return Promise.reject(error);
      },
    );

    // 響應攔截器
    this.responseInterceptorId = this.instance.interceptors.response.use(
      (response: AxiosResponse<ApiResponse>) => {
        if (import.meta.env.DEV) {
          console.log(`✅ API響應: ${response.status}`, response.data);
        }

        // 檢查業務邏輯錯誤
        if (!response.data.success && response.data.error) {
          const apiError = this.normalizeApiError(
            response.data.error,
            response.status,
          );
          throw new ApiException(
            apiError.code,
            apiError.message,
            apiError.details,
            response.status,
            apiError.requestId,
          );
        }

        return response;
      },
      async (error) => {
        console.error("❌ API響應錯誤:", error);

        // 處理網路錯誤
        if (!error.response) {
          throw new ApiException(
            "NETWORK_ERROR" as ApiErrorCodeValue,
            translate("messages.networkError"),
            undefined,
          );
        }

        const { status, data } = error.response;

        // 處理認證錯誤
        if (status === 401 && !error.config?.credentialCheck) {
          // An order-scoped guest session expiring says nothing about the
          // independently authenticated customer who is viewing that order.
          if (!error.config?.url?.startsWith("/guest-orders/")) {
            await this.handleAuthError();
          }
          throw new ApiException(
            "UNAUTHORIZED" as ApiErrorCodeValue,
            translate("messages.sessionExpired"),
            data,
            status,
          );
        }

        // 處理其他HTTP錯誤
        const apiError = this.normalizeApiError(data?.error, status);

        throw new ApiException(
          apiError.code,
          apiError.message,
          apiError.details,
          status,
          apiError.requestId,
        );
      },
    );
  }

  private normalizeApiError(
    error: unknown,
    status: number,
  ): {
    code: ApiErrorCodeValue;
    message: string;
    details?: unknown;
    requestId?: string;
  } {
    if (typeof error === "string" && error.trim()) {
      return {
        code: "INVALID_REQUEST" as ApiErrorCodeValue,
        message: this.getErrorMessage(status),
      };
    }

    if (error && typeof error === "object") {
      const apiError = error as {
        code?: unknown;
        message?: unknown;
        error?: unknown;
        details?: unknown;
        requestId?: unknown;
      };

      return {
        code:
          typeof apiError.code === "string"
            ? (apiError.code as ApiErrorCodeValue)
            : ("INTERNAL_SERVER_ERROR" as ApiErrorCodeValue),
        message: this.getErrorMessage(status),
        details: apiError.details,
        requestId:
          typeof apiError.requestId === "string"
            ? apiError.requestId
            : undefined,
      };
    }

    return {
      code: "INTERNAL_SERVER_ERROR" as ApiErrorCodeValue,
      message: this.getErrorMessage(status),
    };
  }

  private async handleAuthError() {
    // 清除認證資訊 (customer tokens only)
    // Note: Do NOT clear guest_auth_token here — guest tokens are
    // independent from customer auth and should persist for order tracking.
    // 401 errors from SSE/polling should not invalidate guest sessions.
    clearCustomerAccessToken();
  }

  private getErrorMessage(status: number): string {
    const messages: Record<number, string> = {
      400: translate("errors.badRequest"),
      403: translate("errors.forbidden"),
      404: translate("errors.notFoundResource"),
      409: translate("errors.conflict"),
      429: translate("errors.tooManyRequests"),
      500: translate("errors.internalServerError"),
      502: translate("errors.badGateway"),
      503: translate("errors.serviceUnavailable"),
      504: translate("errors.gatewayTimeout"),
    };
    return messages[status] || translate("errors.unknown");
  }

  // 通用請求方法
  async request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.instance.request<ApiResponse<T>>(config);
      return "data" in response.data
        ? (response.data.data as T)
        : (response.data as unknown as T);
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      throw new ApiException(
        "INTERNAL_SERVER_ERROR" as ApiErrorCodeValue,
        translate("errors.requestFailed"),
        error,
      );
    }
  }

  // GET 請求
  async get<T = unknown>(url: string, params?: unknown): Promise<T> {
    return this.request<T>({ method: "GET", url, params });
  }

  // POST 請求
  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.request<T>({ method: "POST", url, data, ...config });
  }

  // PUT 請求
  async put<T = unknown>(url: string, data?: unknown): Promise<T> {
    return this.request<T>({ method: "PUT", url, data });
  }

  // DELETE 請求
  // 允許帶 body：群組購物車的刪除需要送出呼叫者的成員憑證
  // `data` stays the second parameter: useGroupOrder.removeFromCart sends a
  // body with its DELETE, and demoting it to a config slot would spread those
  // fields into the request options instead.
  async delete<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.request<T>({ method: "DELETE", url, data, ...config });
  }

  // PATCH 請求
  async patch<T = unknown>(url: string, data?: unknown): Promise<T> {
    return this.request<T>({ method: "PATCH", url, data });
  }

  // 分頁請求
  async getPaginated<T = unknown>(
    url: string,
    params?: unknown,
  ): Promise<PaginatedResponse<T>> {
    const response = await this.instance.get<PaginatedResponse<T>>(url, {
      params,
    });
    return response.data;
  }

  // 文件上傳
  async uploadFile(
    url: string,
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<unknown> {
    const formData = new FormData();
    formData.append("file", file);

    return this.request({
      method: "POST",
      url,
      data: formData,
      headers: {
        "Content-Type": "multipart/form-data",
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          );
          onProgress(progress);
        }
      },
    });
  }

  // 清理攔截器
  destroy() {
    if (this.requestInterceptorId !== undefined) {
      this.instance.interceptors.request.eject(this.requestInterceptorId);
    }
    if (this.responseInterceptorId !== undefined) {
      this.instance.interceptors.response.eject(this.responseInterceptorId);
    }
  }
}

// 創建全域 API 實例
export const apiClient = new ApiClient();

// 響應式 API 狀態 Hook
export const useApiState = () => {
  const isOnline = navigator.onLine;
  const hasToken = hasCustomerAccessToken();

  return {
    isOnline,
    hasToken,
    isReady: isOnline && hasToken,
  };
};

// 錯誤處理工具函數
export const handleApiError = (error: unknown): string => {
  // Do not render unknown Error messages. They may contain unlocalized server
  // text; API callers should use a context-specific translated fallback.
  void error;
  return translate("errors.unknown");
};
