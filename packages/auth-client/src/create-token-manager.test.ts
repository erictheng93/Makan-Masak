import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTokenManager,
  RefreshUnavailableError,
} from "./create-token-manager";
import type { PrefixedStorage } from "./types";

function createMemoryStorage(): PrefixedStorage {
  let token: string | null = null;
  let refreshToken: string | null = null;
  let user: unknown = null;

  return {
    getToken: () => token,
    setToken: (value) => {
      token = value;
    },
    removeToken: () => {
      token = null;
    },
    getRefreshToken: () => refreshToken,
    setRefreshToken: (value) => {
      refreshToken = value;
    },
    removeRefreshToken: () => {
      refreshToken = null;
    },
    getUser: <T = unknown>() => user as T | null,
    setUser: (value) => {
      user = value;
    },
    removeUser: () => {
      user = null;
    },
    clearAll: () => {
      token = null;
      refreshToken = null;
      user = null;
    },
  };
}

describe("createTokenManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates concurrent refreshes without persisting refreshed refresh tokens", async () => {
    const storage = createMemoryStorage();
    storage.setUser({ id: 7 });
    const onTokenRefreshed = vi.fn();
    const refreshFn = vi.fn(async () => ({
      token: "next-token",
      refreshToken: "next-refresh",
    }));
    const manager = createTokenManager({
      storage,
      refreshFn,
      onTokenRefreshed,
    });

    await expect(
      Promise.all([manager.refreshToken(), manager.refreshToken()]),
    ).resolves.toEqual([true, true]);

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(manager.getToken()).toBe("next-token");
    expect(manager.getRefreshToken()).toBeNull();
    expect(onTokenRefreshed).toHaveBeenCalledWith({
      token: "next-token",
      refreshToken: "next-refresh",
    });
  });

  it("does not call the refresh endpoint for an anonymous visitor", async () => {
    const storage = createMemoryStorage();
    const refreshFn = vi.fn(async () => ({
      token: "next-token",
    }));
    const onRefreshFailure = vi.fn();
    const manager = createTokenManager({
      storage,
      refreshFn,
      onRefreshFailure,
    });

    await expect(manager.refreshToken()).resolves.toBe(false);

    expect(refreshFn).not.toHaveBeenCalled();
    expect(onRefreshFailure).not.toHaveBeenCalled();
    expect(manager.getToken()).toBeNull();
  });

  it("reports refresh failure and clears scheduled timers", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorage();
    const onRefreshFailure = vi.fn();
    const manager = createTokenManager({
      storage,
      refreshFn: vi.fn(async () => null),
      onRefreshFailure,
    });

    manager.setTokens("old-token", "old-refresh");
    expect(manager.getRefreshToken()).toBeNull();
    await expect(manager.refreshToken()).resolves.toBe(false);
    expect(onRefreshFailure).toHaveBeenCalledTimes(1);

    manager.clearAll();
    expect(manager.getToken()).toBeNull();
    expect(manager.getRefreshToken()).toBeNull();
  });

  it("does not report failure when the refresh is only temporarily unavailable", async () => {
    const storage = createMemoryStorage();
    const onRefreshFailure = vi.fn();
    const manager = createTokenManager({
      storage,
      refreshFn: vi.fn(async () => {
        throw new RefreshUnavailableError();
      }),
      onRefreshFailure,
    });

    manager.setTokens("old-token");
    await expect(manager.refreshToken()).resolves.toBe(false);

    expect(onRefreshFailure).not.toHaveBeenCalled();
    expect(manager.wasLastRefreshUnavailable()).toBe(true);
    expect(manager.getToken()).toBe("old-token");
  });

  it("still reports failure for any other refresh error", async () => {
    const storage = createMemoryStorage();
    const onRefreshFailure = vi.fn();
    const manager = createTokenManager({
      storage,
      refreshFn: vi.fn(async () => {
        throw new Error("boom");
      }),
      onRefreshFailure,
    });

    manager.setTokens("old-token");
    await expect(manager.refreshToken()).resolves.toBe(false);

    expect(onRefreshFailure).toHaveBeenCalledTimes(1);
    expect(manager.wasLastRefreshUnavailable()).toBe(false);
  });
});
