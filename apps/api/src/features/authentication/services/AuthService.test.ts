import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../types/env";

const mocks = vi.hoisted(() => {
  const dbAuthService = {
    login: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn(),
    logout: vi.fn(),
    validateToken: vi.fn(),
    changePassword: vi.fn(),
    getUserSessions: vi.fn(),
  };
  const verificationService = {
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    sendEmailVerification: vi.fn(),
    verifyEmail: vi.fn(),
  };
  const cache = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const performance = {
    startTimer: vi.fn(() => "timer"),
    endTimer: vi.fn(() => 25),
    recordMetric: vi.fn(),
  };
  const db = {
    select: vi.fn(),
    update: vi.fn(),
  };

  return { dbAuthService, verificationService, cache, logger, performance, db };
});

vi.mock("../../../core/database", () => ({
  getDatabaseConnection: vi.fn(() => mocks.db),
}));

vi.mock("../../../core/cache", () => ({
  KVCacheService: vi.fn(function KVCacheService() {
    return mocks.cache;
  }),
}));

vi.mock("../../../core/monitoring", () => ({
  ConsoleLogger: vi.fn(function ConsoleLogger() {
    return mocks.logger;
  }),
  SimplePerformanceTracker: vi.fn(function SimplePerformanceTracker() {
    return mocks.performance;
  }),
}));

vi.mock("@makanmasak/database", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    AuthService: vi.fn(function AuthService() {
      return mocks.dbAuthService;
    }),
    VerificationService: vi.fn(function VerificationService() {
      return mocks.verificationService;
    }),
  };
});

import { AuthService } from "./AuthService";

function createService(waitUntil?: (work: Promise<unknown>) => void) {
  return new AuthService(
    {
      DB: {} as D1Database,
      CACHE_KV: {} as KVNamespace,
    } as Env,
    waitUntil,
  );
}

function mockSelectGet(value: unknown) {
  mocks.db.select.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        get: vi.fn(async () => value),
      })),
    })),
  });
}

function mockSelectRows(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain = {
    where: vi.fn(() => chain),
    groupBy: vi.fn(async () => rows),
    get: vi.fn(async () => rows[0] ?? null),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  mocks.db.select.mockReturnValueOnce({
    from: vi.fn(() => chain),
  });
}

/** The reset-target lookup: select().from().leftJoin().where().limit().all(). */
function mockSelectResetMatches(rows: unknown[]) {
  const chain = {
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    all: vi.fn(async () => rows),
  };
  mocks.db.select.mockReturnValueOnce({ from: vi.fn(() => chain) });
}

function mockUpdateReturning(rows: unknown[]) {
  mocks.db.update.mockReturnValueOnce({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => rows),
      })),
    })),
  });
}

describe("AuthService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.get.mockReset();
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockReset();
    mocks.cache.delete.mockReset();
    mocks.cache.clear.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands post-login bookkeeping to waitUntil instead of awaiting it", async () => {
    mocks.dbAuthService.login.mockResolvedValue({
      success: true,
      user: {
        id: "user-7",
        username: "owner",
        fullName: "Shop Owner",
        role: 1,
        restaurantId: null,
        isActive: true,
      },
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: new Date("2026-06-07T01:00:00.000Z"),
      },
    });

    // Hold the bookkeeping open forever. If login awaited it, this test would
    // never finish — which is precisely the latency the waitUntil hand-off
    // removes from the response path.
    const releaseCacheSet: Array<() => void> = [];
    mocks.cache.set.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCacheSet.push(resolve);
        }),
    );

    const deferred: Promise<unknown>[] = [];
    const waitUntil = vi.fn((work: Promise<unknown>) => {
      deferred.push(work);
    });

    const result = await createService(waitUntil).login({
      username: "owner",
      password: "secret",
      deviceInfo: { ipAddress: "203.0.113.10", userAgent: "Vitest" },
      location: { country: "TW", city: "Taipei" },
    });

    expect(result.success).toBe(true);
    expect(result.tokens?.accessToken).toBe("access-token");
    expect(waitUntil).toHaveBeenCalledOnce();

    // The handed-off work is real work, and it completes once unblocked.
    releaseCacheSet.forEach((release) => release());
    await Promise.all(deferred);
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "user-session:user-7:access-token",
      expect.objectContaining({ userId: "user-7" }),
      expect.any(Number),
    );
    expect(mocks.cache.delete).toHaveBeenCalledWith("failed-login:owner");
  });

  it("transforms successful login results and records session/security cache entries", async () => {
    mocks.dbAuthService.login.mockResolvedValue({
      success: true,
      user: {
        id: "user-7",
        username: "owner",
        fullName: "Shop Owner",
        role: 1,
        restaurantId: null,
        isActive: true,
      },
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: new Date("2026-06-07T01:00:00.000Z"),
      },
    });

    const result = await createService().login({
      username: "owner",
      password: "secret",
      deviceInfo: {
        ipAddress: "203.0.113.10",
        userAgent: "Vitest",
      },
      location: { country: "TW", city: "Taipei" },
    });

    expect(result).toMatchObject({
      success: true,
      user: {
        id: "user-7",
        username: "owner",
        role: 1,
        restaurantId: undefined,
        isVerified: false,
        twoFactorEnabled: false,
      },
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      },
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "user-session:user-7:access-token",
      { userId: "user-7", token: "access-token", cached: true },
      expect.any(Number),
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "security-event:1780790400000",
      expect.objectContaining({
        type: "LOGIN",
        userId: "user-7",
        username: "owner",
        ipAddress: "203.0.113.10",
        severity: "LOW",
      }),
      expect.any(Number),
    );
    // Exact keys, so these must be point deletes. clear() treats its argument
    // as a prefix and runs a paginated kv.list() to find what to remove.
    expect(mocks.cache.delete).toHaveBeenCalledWith("failed-login:owner");
    expect(mocks.cache.delete).toHaveBeenCalledWith(
      "failed-login:owner:203.0.113.10",
    );
    expect(mocks.cache.delete).toHaveBeenCalledWith(
      "failed-login-ip:203.0.113.10",
    );
    expect(mocks.cache.clear).not.toHaveBeenCalledWith("failed-login:owner");
    expect(mocks.performance.recordMetric).toHaveBeenCalledWith(
      "auth.login.success",
      1,
    );
  });

  it("tracks failed login attempts without throwing", async () => {
    mocks.cache.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(4);
    mocks.dbAuthService.login.mockResolvedValue({
      success: false,
      error: "Invalid credentials",
    });

    await expect(
      createService().login({
        username: "owner",
        password: "wrong",
        deviceInfo: { ipAddress: "203.0.113.10" },
      }),
    ).resolves.toEqual({
      success: false,
      user: undefined,
      tokens: undefined,
      error: "Invalid credentials",
    });

    expect(mocks.cache.set).toHaveBeenCalledWith(
      "failed-login:owner:203.0.113.10",
      3,
      expect.any(Number),
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "failed-login-ip:203.0.113.10",
      7,
      expect.any(Number),
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "failed-login:owner",
      5,
      expect.any(Number),
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "security-event:1780790400000",
      expect.objectContaining({
        type: "LOGIN_FAILED",
        username: "owner",
        severity: "MEDIUM",
      }),
      expect.any(Number),
    );
    expect(mocks.performance.recordMetric).toHaveBeenCalledWith(
      "auth.login.failed",
      1,
    );
  });

  it("blocks login before password verification when the IP is rate limited", async () => {
    mocks.cache.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(null);

    await expect(
      createService().login({
        username: "owner",
        password: "wrong",
        deviceInfo: { ipAddress: "203.0.113.10" },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Account locked after repeated failures. Please try again later.",
    });

    expect(mocks.dbAuthService.login).not.toHaveBeenCalled();
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "security-event:1780790400000",
      expect.objectContaining({
        type: "ACCOUNT_LOCKED",
        username: "owner",
        ipAddress: "203.0.113.10",
        severity: "HIGH",
      }),
      expect.any(Number),
    );
  });

  it("blocks login before password verification when the username is rate limited", async () => {
    mocks.cache.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(5);

    await expect(
      createService().login({
        username: "Owner",
        password: "wrong",
        deviceInfo: { ipAddress: "203.0.113.10" },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Account locked after repeated failures. Please try again later.",
    });

    expect(mocks.dbAuthService.login).not.toHaveBeenCalled();
    expect(mocks.cache.get).toHaveBeenNthCalledWith(3, "failed-login:owner");
  });

  it("blocks one IP across different usernames before password verification", async () => {
    mocks.cache.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(null);

    await expect(
      createService().login({
        username: "new-user",
        password: "wrong",
        deviceInfo: { ipAddress: "203.0.113.10" },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Account locked after repeated failures. Please try again later.",
    });

    expect(mocks.dbAuthService.login).not.toHaveBeenCalled();
    expect(mocks.cache.get).toHaveBeenNthCalledWith(
      2,
      "failed-login-ip:203.0.113.10",
    );
  });

  it("transforms registration and refresh results and clears related caches", async () => {
    mocks.dbAuthService.register.mockResolvedValue({
      success: true,
      user: {
        id: "user-8",
        username: "chef",
        fullName: "Chef",
        role: 2,
        restaurantId: "",
        isActive: true,
      },
      tokens: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: new Date("2026-06-07T00:30:00.000Z"),
      },
    });
    mocks.dbAuthService.refreshToken.mockResolvedValue({
      success: true,
      user: {
        id: "user-8",
        username: "chef",
        fullName: "Chef",
        role: 2,
        restaurantId: "restaurant-1",
        isActive: true,
      },
      tokens: {
        accessToken: "refreshed-access",
        refreshToken: "refreshed-refresh",
        expiresAt: new Date("2026-06-07T01:00:00.000Z"),
      },
    });

    const service = createService();

    await expect(
      service.register(
        {
          username: "chef",
          password: "secret",
          fullName: "Chef",
          role: 2,
          email: "chef@example.test",
          phone: "+886900000000",
          restaurantId: "",
        },
        "user-1",
      ),
    ).resolves.toMatchObject({
      success: true,
      user: {
        id: "user-8",
        role: 2,
        restaurantId: undefined,
        email: "chef@example.test",
        phone: "+886900000000",
      },
      tokens: { expiresIn: 1800 },
    });
    expect(mocks.dbAuthService.register).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: undefined }),
    );
    expect(mocks.cache.delete).toHaveBeenCalledWith("user:chef");

    await expect(service.refreshToken("refresh")).resolves.toMatchObject({
      success: true,
      user: { id: "user-8", restaurantId: "restaurant-1" },
      tokens: { accessToken: "refreshed-access", expiresIn: 3600 },
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "user-session:user-8:refreshed-access",
      { userId: "user-8", token: "refreshed-access", cached: true },
      expect.any(Number),
    );
  });

  it("logs out single or all sessions and maps logout errors to false", async () => {
    mocks.dbAuthService.logout.mockResolvedValueOnce(true);
    const service = createService();

    await expect(service.logout("user-7", "access-token")).resolves.toBe(true);
    expect(mocks.cache.delete).toHaveBeenCalledWith("token:access-token");
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "security-event:1780790400000",
      expect.objectContaining({ type: "LOGOUT", userId: "user-7" }),
      expect.any(Number),
    );

    mocks.dbAuthService.logout.mockResolvedValueOnce(true);
    await expect(service.logout("user-7", undefined, true)).resolves.toBe(true);
    expect(mocks.cache.clear).toHaveBeenCalledWith("user-session:user-7");

    mocks.dbAuthService.logout.mockRejectedValueOnce(new Error("db down"));
    await expect(service.logout("user-7", "access-token")).resolves.toBe(false);
  });

  it("returns cached token validation and avoids database validation", async () => {
    const cached = {
      valid: true,
      user: { id: "user-7", username: "owner" },
    };
    mocks.cache.get.mockResolvedValueOnce(cached);

    await expect(createService().validateToken("access-token")).resolves.toBe(
      cached,
    );
    expect(mocks.cache.get).toHaveBeenCalledWith(
      "token-validation:access-token",
    );
    expect(mocks.dbAuthService.validateToken).not.toHaveBeenCalled();
  });

  it("falls back from cache errors and stores successful token validation", async () => {
    mocks.cache.get.mockRejectedValueOnce(new Error("kv unavailable"));
    mocks.dbAuthService.validateToken.mockResolvedValue({
      valid: true,
      user: {
        id: "user-7",
        username: "owner",
        fullName: "Shop Owner",
        role: 1,
        restaurantId: "restaurant-1",
        isActive: true,
      },
    });

    await expect(
      createService().validateToken("access-token"),
    ).resolves.toMatchObject({
      valid: true,
      user: {
        id: "user-7",
        username: "owner",
        fullName: "Shop Owner",
        role: 1,
        restaurantId: "restaurant-1",
        isVerified: false,
        twoFactorEnabled: false,
      },
    });
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Cache retrieval failed, falling back to database",
      { error: "kv unavailable" },
    );
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "token-validation:access-token",
      expect.objectContaining({ valid: true }),
      expect.any(Number),
    );
  });

  it("parses database session summaries and ignores malformed JSON fields", async () => {
    mocks.dbAuthService.getUserSessions.mockResolvedValue([
      {
        id: 1,
        deviceInfo: JSON.stringify({ platform: "desktop" }),
        location: JSON.stringify({ country: "TW" }),
        lastAccessedAt: "2026-06-07T00:00:00.000Z",
        expiresAt: "2026-06-08T00:00:00.000Z",
        createdAt: "2026-06-06T00:00:00.000Z",
      },
      {
        id: 2,
        deviceInfo: "not json",
        location: null,
        expiresAt: 1780876800000,
        createdAt: 1780704000000,
      },
    ]);

    await expect(createService().getUserSessions("user-7")).resolves.toEqual([
      {
        id: "1",
        deviceInfo: { platform: "desktop" },
        location: { country: "TW" },
        lastAccessedAt: new Date("2026-06-07T00:00:00.000Z"),
        expiresAt: new Date("2026-06-08T00:00:00.000Z"),
        isCurrent: false,
        createdAt: new Date("2026-06-06T00:00:00.000Z"),
      },
      {
        id: "2",
        deviceInfo: undefined,
        location: undefined,
        lastAccessedAt: undefined,
        expiresAt: new Date(1780876800000),
        isCurrent: false,
        createdAt: new Date(1780704000000),
      },
    ]);
  });

  it("loads, caches, updates, and terminates user profile sessions", async () => {
    const user = {
      id: "user-7",
      username: "owner",
      fullName: "Shop Owner",
      email: null,
      phone: "+886900000000",
      role: 1,
      restaurantId: "",
      isActive: true,
      isVerified: true,
      lastLoginAt: null,
      passwordChangedAt: null,
      emailVerifiedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    };
    mocks.cache.get.mockResolvedValueOnce(null);
    mockSelectGet(user);
    mocks.dbAuthService.getUserSessions.mockResolvedValue([]);

    const service = createService();
    await expect(service.getUserProfile("user-7")).resolves.toMatchObject({
      id: "user-7",
      email: undefined,
      phone: "+886900000000",
      restaurantId: undefined,
      twoFactorEnabled: false,
      sessions: [],
    });
    expect(mocks.cache.set).toHaveBeenCalledWith(
      "user-profile:user-7",
      expect.objectContaining({ id: "user-7" }),
      expect.any(Number),
    );

    mockUpdateReturning([
      {
        ...user,
        fullName: "Updated Owner",
        email: "owner@example.test",
        restaurantId: "restaurant-1",
      },
    ]);
    await expect(
      service.updateUserProfile("user-7", {
        fullName: "Updated Owner",
        email: "owner@example.test",
      }),
    ).resolves.toMatchObject({
      id: "user-7",
      fullName: "Updated Owner",
      email: "owner@example.test",
      restaurantId: "restaurant-1",
    });
    expect(mocks.cache.delete).toHaveBeenCalledWith("user-profile:user-7");
    expect(mocks.cache.delete).toHaveBeenCalledWith("user:user-7");

    mockUpdateReturning([{ id: "session-1" }]);
    await expect(service.terminateSession("user-7", "session-1")).resolves.toBe(
      true,
    );

    mocks.dbAuthService.logout.mockResolvedValueOnce(true);
    await expect(service.terminateAllSessions("user-7")).resolves.toBe(true);
  });

  it("returns null or false for profile/update/session failures", async () => {
    mocks.cache.get.mockResolvedValueOnce(null);
    mocks.db.select.mockImplementationOnce(() => {
      throw new Error("select failed");
    });
    const service = createService();

    await expect(service.getUserProfile("user-7")).resolves.toBeNull();
    await expect(service.updateUserProfile("user-7", {})).resolves.toBeNull();

    mocks.db.update.mockImplementationOnce(() => {
      throw new Error("update failed");
    });
    await expect(service.terminateSession("user-7", "session-1")).resolves.toBe(
      false,
    );
  });

  it("resolves password reset targets without exposing missing accounts", async () => {
    mocks.verificationService.requestPasswordReset.mockResolvedValue({
      success: true,
    });
    mockSelectResetMatches([
      { email: "owner@example.test", phone: "+886900000000" },
    ]);
    mockSelectResetMatches([]);

    await expect(
      createService().requestPasswordReset("direct@example.test"),
    ).resolves.toEqual({ success: true, error: undefined });
    await expect(
      createService().requestPasswordReset("owner"),
    ).resolves.toEqual({ success: true, error: undefined });
    await expect(
      createService().requestPasswordReset("missing-user"),
    ).resolves.toEqual({ success: true });

    expect(
      mocks.verificationService.requestPasswordReset,
    ).toHaveBeenNthCalledWith(1, {
      identifier: "direct@example.test",
      method: "email",
    });
    expect(
      mocks.verificationService.requestPasswordReset,
    ).toHaveBeenNthCalledWith(2, {
      identifier: "owner@example.test",
      method: "email",
    });
  });

  it("sends nothing when a username matches accounts at several shops", async () => {
    mockSelectResetMatches([
      { email: "a@example.test", phone: null },
      { email: "b@example.test", phone: null },
    ]);

    await expect(createService().requestPasswordReset("chef")).resolves.toEqual(
      { success: true },
    );
    expect(
      mocks.verificationService.requestPasswordReset,
    ).not.toHaveBeenCalled();
  });

  it("handles password changes, resets, and email verification workflows", async () => {
    mocks.dbAuthService.changePassword.mockResolvedValueOnce({ success: true });
    mocks.verificationService.resetPassword.mockResolvedValueOnce({
      success: true,
    });
    mocks.verificationService.verifyEmail.mockResolvedValueOnce({
      success: true,
      userId: "user-7",
    });
    mocks.verificationService.sendEmailVerification.mockResolvedValueOnce({
      success: true,
    });
    mockSelectGet({ email: "owner@example.test" });

    const service = createService();

    await expect(
      service.changePassword("user-7", "old-password", "new-password"),
    ).resolves.toEqual({ success: true });
    expect(mocks.cache.delete).toHaveBeenCalledWith("user-profile:user-7");
    expect(mocks.cache.clear).toHaveBeenCalledWith("user-session:user-7");

    await expect(
      service.resetPassword("reset-token", "new-password"),
    ).resolves.toEqual({ success: true, error: undefined });
    await expect(service.verifyEmail("email-token")).resolves.toEqual({
      success: true,
      error: undefined,
    });
    await expect(service.requestEmailVerification("user-7")).resolves.toEqual({
      success: true,
      error: undefined,
    });

    mockSelectGet(null);
    await expect(service.requestEmailVerification("user-8")).resolves.toEqual({
      success: false,
      error: "User email not found",
    });
  });

  it("checks account security and aggregates authentication statistics", async () => {
    mockSelectGet({ passwordChangedAt: new Date("2026-01-01T00:00:00.000Z") });
    const service = createService();

    await expect(service.checkAccountSecurity("user-7")).resolves.toMatchObject(
      {
        failedLoginAttempts: 0,
        passwordStrength: "MEDIUM",
        suspiciousActivity: false,
        lastPasswordChangeAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    mockSelectRows([{ total: 20 }]);
    mockSelectRows([{ total: 15 }]);
    mockSelectRows([{ total: 6 }]);
    mockSelectRows([
      { platform: "ios", total: 4 },
      { platform: null, total: 2 },
      { platform: "web", total: 8 },
    ]);
    mockSelectRows([{ total: 9 }]);

    await expect(service.getAuthStatistics("7d")).resolves.toMatchObject({
      totalUsers: 20,
      activeUsers: 15,
      dailyLogins: 6,
      uniqueDevices: 9,
      platformDistribution: { ios: 4, web: 8 },
      topCountries: [],
      twoFactorAdoptionRate: 0,
      recentSecurityEvents: [],
    });
  });

  it("exposes placeholder two-factor behavior consistently", async () => {
    const service = createService();

    await expect(service.setupTwoFactor("user-7", "secret")).rejects.toThrow(
      "Two-factor authentication not yet implemented",
    );
    await expect(service.verifyTwoFactor("user-7", "123456")).resolves.toEqual({
      success: false,
      error: "Two-factor authentication not yet implemented",
    });
    await expect(service.disableTwoFactor("user-7", "secret")).resolves.toEqual(
      {
        success: false,
        error: "Two-factor authentication not yet implemented",
      },
    );
    await expect(service.generateBackupCodes("user-7")).rejects.toThrow(
      "Two-factor authentication not yet implemented",
    );
  });
});
