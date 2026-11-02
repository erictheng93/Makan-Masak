import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface PrefixedStorage {
  getToken(): string | null;
  setToken(value: string): void;
  removeToken(): void;
  getRefreshToken(): string | null;
  setRefreshToken(value: string): void;
  removeRefreshToken(): void;
  getUser<T = unknown>(): T | null;
  setUser(value: unknown): void;
  removeUser(): void;
  clearAll(): void;
}

// ---------------------------------------------------------------------------
// Token Manager
// ---------------------------------------------------------------------------

export interface RefreshResult {
  token: string;
  refreshToken?: string;
  user?: unknown;
}

export interface TokenManagerConfig {
  storage: PrefixedStorage;
  /**
   * Execute the actual refresh API call.
   * Return the new tokens on success, or null on failure.
   * If not provided, the token manager cannot refresh (schedule-only mode).
   */
  refreshFn?: () => Promise<RefreshResult | null>;
  /** Called after a successful refresh with the new tokens. */
  onTokenRefreshed?: (result: RefreshResult) => void;
  /** Called when refresh fails irrecoverably. */
  onRefreshFailure?: () => void | Promise<void>;
}

export interface TokenManager {
  getToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(token: string, refreshToken?: string): void;
  setUser(user: unknown): void;
  getUser<T = unknown>(): T | null;
  clearAll(): void;
  /** Start proactive refresh timer at 80% of token lifetime. */
  scheduleProactiveRefresh(token: string): void;
  clearRefreshTimer(): void;
  /** Execute token refresh with concurrent-request deduplication. Returns true on success. */
  refreshToken(): Promise<boolean>;
  /** True when the last refresh failed transiently (5xx/429/network), not because the session was rejected. */
  wasLastRefreshUnavailable(): boolean;
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

export interface CsrfConfig {
  headerName: string;
  cookieName: string;
  protectedMethods: string[];
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

export interface StorageKeyOverrides {
  token?: string;
  refreshToken?: string;
  user?: string;
}

export type TokenStorageMode = "localStorage" | "sessionStorage" | "memory";

export interface AuthClientConfig {
  /** Prefix for localStorage keys. E.g. 'kitchen' → 'kitchen_auth_token'. */
  storageKeyPrefix: string;
  /**
   * Override individual storage key names.
   * Useful when the app doesn't follow the `{prefix}_auth_token` convention.
   * E.g. admin-dashboard uses 'auth_token' instead of 'auth_auth_token'.
   */
  storageKeys?: StorageKeyOverrides;
  /**
   * Where access tokens are kept. Use "memory" for staff/admin production
   * surfaces that rely on HttpOnly refresh cookies and should not persist
   * bearer tokens in browser storage.
   */
  tokenStorage?: TokenStorageMode;
  /** Base URL for API requests. Default: '/api/v1'. */
  baseURL?: string;
  /** Request timeout in ms. Default: 10000. */
  timeout?: number;
  /** Extra default headers on every request. */
  defaultHeaders?: Record<string, string>;
  /** CSRF configuration. false/undefined = disabled. true = defaults. */
  csrf?: Partial<CsrfConfig> | boolean;
  /**
   * Whether to retry the original request after a successful 401 refresh.
   * Default: true. Set to false for apps that prefer to throw on 401 and let
   * calling code handle navigation (e.g. customer-app).
   */
  retryOn401?: boolean;
  /** Called when auth is irrecoverably lost (refresh failed on 401). */
  onAuthFailure?: () => void | Promise<void>;
  /** Called after successful token refresh. */
  onTokenRefreshed?: (result: RefreshResult) => void;
  /**
   * Optional request config modifier. Runs after Bearer token is attached.
   * Use for app-specific headers (guest token fallback, restaurant context, etc.).
   */
  requestInterceptor?: (
    config: InternalAxiosRequestConfig,
  ) => InternalAxiosRequestConfig;
  /** Optional error handler for non-401 errors. Return transformed error or re-throw. */
  errorHandler?: (error: unknown) => unknown;
}

export interface ApiClient {
  /** The underlying axios instance. */
  readonly instance: AxiosInstance;
  /** The token manager for this client. */
  readonly tokens: TokenManager;
  get<T = unknown>(url: string, params?: unknown): Promise<AxiosResponse<T>>;
  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>>;
  put<T = unknown>(url: string, data?: unknown): Promise<AxiosResponse<T>>;
  patch<T = unknown>(url: string, data?: unknown): Promise<AxiosResponse<T>>;
  delete<T = unknown>(url: string, data?: unknown): Promise<AxiosResponse<T>>;
  upload(url: string, formData: FormData): Promise<AxiosResponse<unknown>>;
  /** Update the default Authorization header. Pass null to clear. */
  setAuthToken(token: string | null): void;
  /** Clean up interceptors and timers. */
  destroy(): void;
}
