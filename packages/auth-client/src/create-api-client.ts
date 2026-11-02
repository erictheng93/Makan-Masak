import axios from "axios";
import type {
  AxiosError,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from "axios";
import { createPrefixedStorage } from "./storage";
import {
  createTokenManager,
  RefreshUnavailableError,
} from "./create-token-manager";
import type { ApiClient, AuthClientConfig, CsrfConfig } from "./types";

interface RetryableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _skipErrorHandler?: boolean;
}

function normalizeCsrfConfig(raw: AuthClientConfig["csrf"]): CsrfConfig | null {
  if (!raw) return null;
  const defaults: CsrfConfig = {
    headerName: "X-CSRF-Token",
    cookieName: "__Host-mm_csrf",
    protectedMethods: ["POST", "PUT", "DELETE", "PATCH"],
  };
  if (raw === true) return defaults;
  return { ...defaults, ...raw };
}

function getCookieValue(name: string): string | undefined {
  return document.cookie.match(new RegExp(`${name}=([^;]+)`))?.[1];
}

/**
 * Where the CSRF token survives a page reload.
 *
 * The cookie the API sets carries the `__Host-` prefix, which forces it to be
 * host-only on the API's own origin. Every front-end here is served from a
 * different subdomain, so `document.cookie` cannot see it and the cookie
 * fallback below is structurally dead in production — it only ever works when
 * the API and the app share an origin, as they do behind the dev proxy.
 *
 * Without somewhere to persist it, the token cached from the X-CSRF-Token
 * response header lived in a module variable that a reload wiped, so restoring
 * a session sent no token and every state-changing request 403'd (#66).
 *
 * Storing it is not a new exposure: the bearer token already sits in the same
 * storage, so anything able to read this could already act as the user.
 *
 * The key is namespaced per client, because a front-end builds more than one:
 * the main API and the management API answer on different hosts, and each host
 * sets its own host-only `__Host-mm_csrf` cookie. Sharing one key let whichever
 * client responded last overwrite the other's token, so the next state-changing
 * request echoed a value that host's cookie could never match — a guaranteed
 * 403 as soon as both sides start rotating tokens.
 */
const LEGACY_CSRF_STORAGE_KEY = "mm_csrf_token";

function createCsrfStore(prefix: string) {
  const key = `mm_csrf_token_${prefix}`;

  const forget = () => {
    globalThis.localStorage?.removeItem(key);
    globalThis.localStorage?.removeItem(LEGACY_CSRF_STORAGE_KEY);
  };

  return {
    read(): string | null {
      try {
        // Falling back to the pre-namespace key keeps sessions that predate
        // this change alive: without it, deploying would leave every open tab
        // with no token to echo, and the reload-time /auth/refresh — which is
        // CSRF protected — would 403 and sign everyone out at once.
        return (
          globalThis.localStorage?.getItem(key) ??
          globalThis.localStorage?.getItem(LEGACY_CSRF_STORAGE_KEY) ??
          null
        );
      } catch {
        return null;
      }
    },

    write(token: string): void {
      try {
        globalThis.localStorage?.setItem(key, token);
        // The first rotation retires the shared key for good.
        globalThis.localStorage?.removeItem(LEGACY_CSRF_STORAGE_KEY);
      } catch {
        // Storage can be unavailable (private mode, disabled cookies). The
        // in-memory cache still covers the current page.
      }
    },

    clear(): void {
      try {
        forget();
      } catch {
        // Same as above — nothing to clean up if storage is unavailable.
      }
    },
  };
}

/**
 * Create an authenticated axios-based API client with:
 * - Bearer token from prefixed localStorage
 * - Optional CSRF protection
 * - 401 → token refresh → retry (configurable)
 * - Proactive refresh scheduling
 * - Configurable error handling and request augmentation
 */
export function createAuthenticatedApiClient(
  config: AuthClientConfig,
): ApiClient {
  const storage = createPrefixedStorage(
    config.storageKeyPrefix,
    config.storageKeys,
    config.tokenStorage,
  );
  const csrfConfig = normalizeCsrfConfig(config.csrf);
  const csrfStore = createCsrfStore(config.storageKeyPrefix);
  const retryOn401 = config.retryOn401 !== false; // default true

  let csrfTokenCache: string | null = csrfConfig ? csrfStore.read() : null;

  const forgetCsrfToken = () => {
    csrfTokenCache = null;
    csrfStore.clear();
  };

  const instance = axios.create({
    baseURL: config.baseURL ?? "/api/v1",
    timeout: config.timeout ?? 10000,
    withCredentials: true,
    headers: {
      "Content-Type": "application/json",
      ...(config.defaultHeaders ?? {}),
    },
  });

  const tokenManager = createTokenManager({
    storage,
    refreshFn: async () => {
      try {
        const refreshConfig: AxiosRequestConfig & {
          _retry?: boolean;
          _skipErrorHandler?: boolean;
        } = {
          _retry: true, // skip 401 interceptor for the refresh call itself
          _skipErrorHandler: true,
          withCredentials: true,
        };
        const response = await instance.post(
          "/auth/refresh",
          {},
          refreshConfig,
        );

        const data = response.data?.data;
        if (data?.token) {
          return {
            token: data.token,
            refreshToken: data.refreshToken,
            user: data.user,
          };
        }
        return null;
      } catch (error) {
        // Only a rejection of the refresh token itself ends the session. A 5xx
        // (e.g. 503 AUTH_BACKEND_UNAVAILABLE), 429 or a dead network says
        // nothing about it, so keep the session and let the caller retry.
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        if (status === 400 || status === 401 || status === 403) return null;
        throw new RefreshUnavailableError();
      }
    },
    onTokenRefreshed: config.onTokenRefreshed,
    onRefreshFailure: config.onAuthFailure,
  });

  // ── Request interceptor ────────────────────────────────────────────────
  instance.interceptors.request.use(
    (reqConfig) => {
      // Attach Bearer token
      const token = storage.getToken();
      if (token) {
        reqConfig.headers.Authorization = `Bearer ${token}`;
      }

      // Attach CSRF token for state-changing methods.
      //
      // Read the store first, not the module variable. The API rotates the
      // token on every /auth/* response and sets a new cookie; the header it
      // returns is echoed back to the store by the response interceptor. But
      // `csrfTokenCache` is per-JS-context, so a second tab that refreshed its
      // session updated the shared cookie and localStorage while this tab kept
      // echoing the token it happened to see last. The server compares the
      // header to the cookie, so every write from the stale tab 403'd — and the
      // admin maps that to "權限不足或登入已過期", sending owners to re-login
      // for a session that was never expired. Two open tabs is the normal way a
      // restaurant runs the dashboard, so this fired constantly.
      if (csrfConfig) {
        const method = (reqConfig.method || "").toUpperCase();
        if (csrfConfig.protectedMethods.includes(method)) {
          const csrf =
            csrfStore.read() ||
            csrfTokenCache ||
            getCookieValue(csrfConfig.cookieName);
          if (csrf) {
            reqConfig.headers[csrfConfig.headerName] = csrf;
          }
        }
      }

      // App-specific request augmentation
      if (config.requestInterceptor) {
        return config.requestInterceptor(reqConfig);
      }

      return reqConfig;
    },
    (error) => Promise.reject(error),
  );

  // ── Response interceptor ───────────────────────────────────────────────
  instance.interceptors.response.use(
    (response) => {
      // Cache CSRF token from response headers
      if (csrfConfig) {
        const newCsrf = response.headers[csrfConfig.headerName.toLowerCase()];
        if (newCsrf) {
          csrfTokenCache = newCsrf;
          csrfStore.write(newCsrf);
        }
      }
      return response;
    },
    async (error: AxiosError) => {
      const original = error.config as RetryableRequest | undefined;

      if (error.response?.status === 401 && original && !original._retry) {
        original._retry = true;

        if (retryOn401) {
          // Attempt refresh + retry the original request
          const success = await tokenManager.refreshToken();
          if (success) {
            const newToken = storage.getToken();
            if (newToken) {
              original.headers = original.headers || {};
              original.headers.Authorization = `Bearer ${newToken}`;
            }
            return instance(original);
          }
        }

        // A transient refresh failure leaves the session intact: surface the
        // original error without wiping tokens or signing the user out.
        if (retryOn401 && tokenManager.wasLastRefreshUnavailable()) {
          return Promise.reject(error);
        }

        // Refresh failed or retry disabled — clean up and notify. The CSRF
        // token goes with the session: leaving a stale one behind would make
        // the next login's first write fail against a rotated cookie.
        storage.clearAll();
        forgetCsrfToken();
        if (config.onAuthFailure) await config.onAuthFailure();
        return Promise.reject(error);
      }

      // Non-401 errors: delegate to app's error handler if provided
      if (original?._skipErrorHandler) {
        return Promise.reject(error);
      }

      // The handler reports the error (logging, telemetry, a toast); it does not
      // get to replace it. Rejecting with its return value swapped the axios
      // error for the handler's own summary object, which has no `response`, so
      // every `catch` that branches on `error.response.data.error.code` saw
      // undefined. That silently disabled per-code recovery across the admin —
      // including the whole MENU_ITEM_MODIFIED conflict flow, whose reload/merge
      // UI could never render because the code it keys off never arrived.
      if (config.errorHandler) {
        config.errorHandler(error);
      }
      return Promise.reject(error);
    },
  );

  return {
    instance,
    // The CSRF token is part of the session, not a separate thing a caller has
    // to remember to drop. Logging out used to clear the bearer token and leave
    // it behind, so the next login's first write raced a token the server had
    // already rotated away from.
    tokens: {
      ...tokenManager,
      clearAll: () => {
        tokenManager.clearAll();
        forgetCsrfToken();
      },
    },

    get: (url, params) => instance.get(url, { params }),
    post: (url, data, cfg) => instance.post(url, data, cfg),
    put: (url, data) => instance.put(url, data),
    patch: (url, data) => instance.patch(url, data),
    delete: (url, data) => instance.delete(url, data ? { data } : undefined),
    upload: (url, formData) =>
      instance.post(url, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      }),

    setAuthToken: (token) => {
      if (token) {
        instance.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      } else {
        delete instance.defaults.headers.common["Authorization"];
      }
    },

    destroy: () => {
      tokenManager.clearRefreshTimer();
    },
  };
}
