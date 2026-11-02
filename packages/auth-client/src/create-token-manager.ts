import { getRefreshDelay } from "@makanmasak/utils";
import type { TokenManager, TokenManagerConfig } from "./types";

/**
 * Thrown by a `refreshFn` when the refresh could not be attempted to a verdict
 * (5xx, 429, network): the session may still be perfectly valid, so the manager
 * must not report an irrecoverable failure (which signs the user out).
 */
export class RefreshUnavailableError extends Error {
  constructor(message = "Token refresh temporarily unavailable") {
    super(message);
    this.name = "RefreshUnavailableError";
  }
}

/**
 * Create a token manager that handles:
 * - Prefixed localStorage read/write via the provided storage adapter
 * - Proactive token refresh at 80% of token lifetime
 * - Concurrent refresh deduplication (only one in-flight refresh at a time)
 */
export function createTokenManager(config: TokenManagerConfig): TokenManager {
  const { storage, refreshFn, onTokenRefreshed, onRefreshFailure } = config;

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let sharedRefreshPromise: Promise<boolean> | null = null;
  let lastRefreshUnavailable = false;

  const clearRefreshTimer = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };

  const refreshToken = async (): Promise<boolean> => {
    lastRefreshUnavailable = false;
    if (!refreshFn) return false;

    const hasRefreshableSession =
      !!storage.getToken() ||
      !!storage.getRefreshToken() ||
      !!storage.getUser();
    if (!hasRefreshableSession) return false;

    // Deduplicate: if a refresh is already in flight, reuse it
    if (sharedRefreshPromise) return sharedRefreshPromise;

    sharedRefreshPromise = (async () => {
      try {
        const result = await refreshFn();
        if (!result) {
          if (onRefreshFailure) await onRefreshFailure();
          return false;
        }

        // Persist new tokens
        storage.setToken(result.token);
        storage.removeRefreshToken();

        if (onTokenRefreshed) onTokenRefreshed(result);
        return true;
      } catch (error) {
        if (error instanceof RefreshUnavailableError) {
          lastRefreshUnavailable = true;
          return false;
        }
        if (onRefreshFailure) await onRefreshFailure();
        return false;
      }
    })();

    try {
      return await sharedRefreshPromise;
    } finally {
      sharedRefreshPromise = null;
    }
  };

  const scheduleProactiveRefresh = (token: string) => {
    clearRefreshTimer();
    const delay = getRefreshDelay(token);
    if (!delay || delay <= 0) return;
    refreshTimer = setTimeout(async () => {
      await refreshToken();
    }, delay);
  };

  return {
    getToken: () => storage.getToken(),
    getRefreshToken: () => storage.getRefreshToken(),
    setTokens: (token) => {
      storage.setToken(token);
      storage.removeRefreshToken();
    },
    setUser: (user) => storage.setUser(user),
    getUser: <T = unknown>() => storage.getUser<T>(),
    clearAll: () => {
      clearRefreshTimer();
      storage.clearAll();
    },
    scheduleProactiveRefresh,
    clearRefreshTimer,
    refreshToken,
    wasLastRefreshUnavailable: () => lastRefreshUnavailable,
  };
}
