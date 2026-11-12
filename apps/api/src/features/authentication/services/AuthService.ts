/**
 * Authentication Service
 * Business logic for authentication feature
 */

import type { Env } from "../../../shared/types";
import { getDatabaseConnection } from "../../../core/database";
import { KVCacheService } from "../../../core/cache";
import {
  ConsoleLogger,
  SimplePerformanceTracker,
} from "../../../core/monitoring";
import { CACHE_TTL } from "../../../shared/constants";
import type { UserRole } from "../../../shared/constants";
import {
  AuthService as DatabaseAuthService,
  VerificationService,
  and,
  count,
  eq,
  restaurants,
  sessions,
  sql,
  users,
} from "@makanmasak/database";
import { gt } from "drizzle-orm";

// Import types
import type {
  AuthUser,
  AuthResult,
  LoginData,
  RegisterData,
  TokenValidation,
  UserProfile,
  SessionSummary,
  DeviceInfo,
  LocationInfo,
  TwoFactorBackupCodes,
  SecurityEvent,
  AccountSecurity,
  AuthStatistics,
  IAuthService,
  PasswordResetFailureReason,
} from "../types";

type DatabaseSessionSummary = Awaited<
  ReturnType<DatabaseAuthService["getUserSessions"]>
>[number];

const LOGIN_RATE_LIMIT_ERROR =
  "Account locked after repeated failures. Please try again later.";
const LOGIN_RATE_LIMIT_TTL_SECONDS = 15 * 60;
const LOGIN_IP_FAILURE_LIMIT = 10;
const LOGIN_USERNAME_FAILURE_LIMIT = 5;

function normalizedShop(shop?: string) {
  return shop?.trim().toLowerCase() ?? "";
}

/**
 * Pre-lookup throttles only (coarse, never an account lockout): per IP, and per
 * (shop, username, IP). The shop is part of the key so a burst against one
 * shop's "chef" cannot throttle another shop's "chef" from the same IP.
 */
function loginRateLimitKeys(
  username: string,
  ipAddress?: string,
  shop?: string,
) {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedIp = ipAddress?.trim() || null;

  return {
    normalizedUsername,
    usernameIpKey: `failed-login:${normalizedShop(shop)}:${normalizedUsername}:${normalizedIp || "unknown"}`,
    ipKey: normalizedIp ? `failed-login-ip:${normalizedIp}` : null,
  };
}

/** The account lockout counter: one per resolved users.id, shop-agnostic. */
const accountFailureKey = (userId: string) => `failed-login-user:${userId}`;

export class AuthService implements IAuthService {
  private db: ReturnType<typeof getDatabaseConnection>;
  private dbAuthService: DatabaseAuthService;
  private verificationService: VerificationService;
  private cache: KVCacheService;
  private logger: ConsoleLogger;
  private performance: SimplePerformanceTracker;
  private env: Env;
  private waitUntil?: (work: Promise<unknown>) => void;

  /**
   * @param waitUntil - Optional ExecutionContext.waitUntil. When supplied,
   *   bookkeeping the caller does not need to see the result of (session cache
   *   priming, security-event logging, clearing failed-login counters) is
   *   handed to the runtime instead of being awaited before the response. Left
   *   undefined, that work is awaited inline as before, so callers without a
   *   request context — tests included — keep their existing semantics.
   */
  constructor(env: Env, waitUntil?: (work: Promise<unknown>) => void) {
    this.env = env;
    this.db = getDatabaseConnection(env);
    this.dbAuthService = new DatabaseAuthService(env.DB, env);
    this.verificationService = new VerificationService(env.DB, env);
    this.cache = new KVCacheService(env.CACHE_KV);
    this.logger = new ConsoleLogger("auth-service");
    this.performance = new SimplePerformanceTracker();
    this.waitUntil = waitUntil;
  }

  /**
   * Run post-response bookkeeping off the critical path when we have a runtime
   * to hand it to. Each of these already swallows and logs its own errors, so
   * the combined promise does not reject.
   */
  private async runInBackground(work: Promise<unknown>): Promise<void> {
    if (this.waitUntil) {
      this.waitUntil(work);
      return;
    }
    await work;
  }

  // Core Authentication Methods
  async login(data: LoginData): Promise<AuthResult> {
    const timer = this.performance.startTimer("auth.login");

    try {
      // Rate limiting check
      const lockedOut = async (error: string): Promise<AuthResult> => {
        await this.logSecurityEvent({
          type: "ACCOUNT_LOCKED",
          username: data.username,
          ipAddress: data.deviceInfo?.ipAddress,
          userAgent: data.deviceInfo?.userAgent,
          location: data.location,
          metadata: { reason: "login_rate_limit" },
          severity: "HIGH",
        });
        this.performance.recordMetric("auth.login.rate_limited", 1);

        return { success: false, reason: "rate_limited", error };
      };

      // Pre-lookup throttle: IP-based only. The per-account lockout runs
      // inside the lookup, once the shop-scoped account is known.
      const rateLimitError = await this.checkRateLimit(
        data.username,
        data.deviceInfo?.ipAddress,
        data.shop,
      );
      if (rateLimitError) return lockedOut(rateLimitError);

      // Call the existing DatabaseAuthService
      const dbResult = await this.dbAuthService.login({
        ...data,
        isAccountLocked: (userId) => this.isAccountLocked(userId),
      });

      if (dbResult.reason === "rate_limited") {
        return lockedOut(LOGIN_RATE_LIMIT_ERROR);
      }

      // Not a credential failure: the caller only has to name its shop, so it
      // must not count toward the lockout or raise a LOGIN_FAILED event.
      if (dbResult.reason === "shop_required") {
        return {
          success: false,
          reason: "shop_required",
          error: dbResult.error,
        };
      }

      const result = this.toFeatureResult(dbResult);

      if (result.success && result.user && result.tokens) {
        // None of this gates the token we are about to return, and it used to
        // run as three sequential round trips before the response was written.
        // Fan it out and, when the runtime gives us a waitUntil, let it finish
        // after the client already has its answer.
        await this.runInBackground(
          Promise.all([
            this.cacheUserSession(result.user.id, result.tokens.accessToken),
            this.logSecurityEvent({
              type: "LOGIN",
              userId: result.user.id,
              username: result.user.username,
              ipAddress: data.deviceInfo?.ipAddress,
              userAgent: data.deviceInfo?.userAgent,
              location: data.location,
              severity: "LOW",
            }),
            this.clearFailedLoginAttempts(
              result.user.username,
              data.deviceInfo?.ipAddress,
              data.shop,
              result.user.id,
            ),
          ]),
        );

        this.logger.info("User login successful", {
          userId: result.user.id,
          username: result.user.username,
          role: result.user.role,
        });

        this.performance.recordMetric("auth.login.success", 1);
      } else {
        // Same reasoning as the success path. Deferring the counter increment
        // does not widen the window an attacker gets: waitUntil starts the
        // write immediately, and KV is eventually consistent across colos
        // regardless of whether we await it here.
        await this.runInBackground(
          Promise.all([
            this.logFailedLoginAttempt(
              data.username,
              data.deviceInfo?.ipAddress,
              data.shop,
              dbResult.failedAccountId,
            ),
            this.logSecurityEvent({
              type: "LOGIN_FAILED",
              username: data.username,
              ipAddress: data.deviceInfo?.ipAddress,
              userAgent: data.deviceInfo?.userAgent,
              location: data.location,
              severity: "MEDIUM",
            }),
          ]),
        );

        this.performance.recordMetric("auth.login.failed", 1);
      }

      return result;
    } catch (error) {
      this.logger.error("Login failed", error as Error, {
        username: data.username,
      });
      this.performance.recordMetric("auth.login.error", 1);

      // Log security event for system errors
      await this.logSecurityEvent({
        type: "LOGIN_FAILED",
        username: data.username,
        ipAddress: data.deviceInfo?.ipAddress,
        metadata: { error: (error as Error).message },
        severity: "HIGH",
      });

      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric("auth.login.duration", duration, "ms");
    }
  }

  /** Maps the database layer's login result onto this feature's shape. */
  private toFeatureResult(
    dbResult: Awaited<ReturnType<DatabaseAuthService["login"]>>,
  ): AuthResult {
    return {
      success: dbResult.success,
      reason: dbResult.reason,
      user: dbResult.user
        ? {
            ...dbResult.user,
            role: dbResult.user.role as UserRole,
            restaurantId: dbResult.user.restaurantId || undefined, // Keep as string
            isVerified: false, // Would need to be fetched from database
            twoFactorEnabled: false, // Would need to be fetched from database
            createdAt: new Date(), // Would need to be fetched from database
            updatedAt: new Date(), // Would need to be fetched from database
          }
        : undefined,
      tokens: dbResult.tokens
        ? {
            ...dbResult.tokens,
            expiresIn: Math.floor(
              (dbResult.tokens.expiresAt.getTime() - Date.now()) / 1000,
            ),
          }
        : undefined,
      error: dbResult.error,
    };
  }

  /**
   * Session for an account a provider already vouched for (staff OAuth). The
   * database layer re-applies the account gates; the bookkeeping matches
   * password login, tagged with the method so the two are tellable apart.
   */
  async loginWithOAuth(
    userId: string,
    provider: string,
    ctx: { deviceInfo?: DeviceInfo; location?: LocationInfo },
  ): Promise<AuthResult> {
    const dbResult = await this.dbAuthService.loginVerifiedUser(userId, ctx);
    const result = this.toFeatureResult(dbResult);
    if (result.success && result.user && result.tokens) {
      await this.runInBackground(
        Promise.all([
          this.cacheUserSession(result.user.id, result.tokens.accessToken),
          this.logSecurityEvent({
            type: "LOGIN",
            userId: result.user.id,
            username: result.user.username,
            ipAddress: ctx.deviceInfo?.ipAddress,
            userAgent: ctx.deviceInfo?.userAgent,
            location: ctx.location,
            metadata: { method: "oauth", provider },
            severity: "LOW",
          }),
        ]),
      );
    } else {
      await this.runInBackground(
        this.logSecurityEvent({
          type: "LOGIN_FAILED",
          userId,
          ipAddress: ctx.deviceInfo?.ipAddress,
          userAgent: ctx.deviceInfo?.userAgent,
          location: ctx.location,
          metadata: { method: "oauth", provider },
          severity: "MEDIUM",
        }),
      );
    }
    return result;
  }

  async register(data: RegisterData, createdBy?: string): Promise<AuthResult> {
    const timer = this.performance.startTimer("auth.register");

    try {
      // Validate role permissions
      if (createdBy) {
        await this.validateRoleCreationPermissions(createdBy, data.role);
      }

      // Call the existing DatabaseAuthService
      const dbRegisterData = {
        ...data,
        restaurantId: data.restaurantId || undefined,
      };
      const dbResult = await this.dbAuthService.register(dbRegisterData);

      // Transform database result to match our interface
      const result: AuthResult = {
        success: dbResult.success,
        reason: dbResult.reason,
        user: dbResult.user
          ? {
              ...dbResult.user,
              role: dbResult.user.role as UserRole,
              restaurantId: dbResult.user.restaurantId || undefined, // Keep as string
              email: data.email,
              phone: data.phone,
              isVerified: false,
              twoFactorEnabled: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : undefined,
        tokens: dbResult.tokens
          ? {
              ...dbResult.tokens,
              expiresIn: Math.floor(
                (dbResult.tokens.expiresAt.getTime() - Date.now()) / 1000,
              ),
            }
          : undefined,
        error: dbResult.error,
      };

      if (result.success && result.user) {
        // Would log security event for user registration
        // Note: 'USER_REGISTERED' is not in the SecurityEvent type enum
        // This is a placeholder for future implementation

        // Clear registration cache
        await this.cache.delete(`user:${result.user.username}`);

        this.logger.info("User registration successful", {
          userId: result.user.id,
          username: result.user.username,
          role: result.user.role,
          createdBy,
        });

        this.performance.recordMetric("auth.register.success", 1);
      } else {
        this.performance.recordMetric("auth.register.failed", 1);
      }

      return result;
    } catch (error) {
      this.logger.error("Registration failed", error as Error, {
        username: data.username,
      });
      this.performance.recordMetric("auth.register.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric("auth.register.duration", duration, "ms");
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    const timer = this.performance.startTimer("auth.refreshToken");

    try {
      // Call the existing DatabaseAuthService
      const dbResult = await this.dbAuthService.refreshToken(refreshToken);

      // Transform database result to match our interface
      const result: AuthResult = {
        success: dbResult.success,
        user: dbResult.user
          ? {
              ...dbResult.user,
              role: dbResult.user.role as UserRole,
              restaurantId: dbResult.user.restaurantId || undefined, // Keep as string
              isVerified: false,
              twoFactorEnabled: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : undefined,
        tokens: dbResult.tokens
          ? {
              ...dbResult.tokens,
              expiresIn: Math.floor(
                (dbResult.tokens.expiresAt.getTime() - Date.now()) / 1000,
              ),
            }
          : undefined,
        error: dbResult.error,
      };

      if (result.success && result.user && result.tokens) {
        // Update cached session
        await this.cacheUserSession(result.user.id, result.tokens.accessToken);

        this.logger.debug("Token refresh successful", {
          userId: result.user.id,
        });
        this.performance.recordMetric("auth.refreshToken.success", 1);
      } else {
        this.performance.recordMetric("auth.refreshToken.failed", 1);
      }

      return result;
    } catch (error) {
      this.logger.error("Token refresh failed", error as Error);
      this.performance.recordMetric("auth.refreshToken.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "auth.refreshToken.duration",
        duration,
        "ms",
      );
    }
  }

  async logout(
    userId: string,
    token?: string,
    allSessions?: boolean,
  ): Promise<boolean> {
    const timer = this.performance.startTimer("auth.logout");

    try {
      // Call the existing DatabaseAuthService
      const success = await this.dbAuthService.logout(userId, token);

      if (success) {
        // Clear cached sessions
        if (allSessions) {
          await this.cache.clear(`user-session:${userId}`);
        } else if (token) {
          await this.cache.delete(`token:${token}`);
        }

        // Log security event
        await this.logSecurityEvent({
          type: "LOGOUT",
          userId,
          metadata: { allSessions },
          severity: "LOW",
        });

        this.logger.info("User logout successful", { userId, allSessions });
        this.performance.recordMetric("auth.logout.success", 1);
      } else {
        this.performance.recordMetric("auth.logout.failed", 1);
      }

      return success;
    } catch (error) {
      this.logger.error("Logout failed", error as Error, { userId });
      this.performance.recordMetric("auth.logout.error", 1);
      return false;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric("auth.logout.duration", duration, "ms");
    }
  }

  async validateToken(token: string): Promise<TokenValidation> {
    const timer = this.performance.startTimer("auth.validateToken");

    try {
      // Check cache first - handle cache errors gracefully
      const cacheKey = `token-validation:${token}`;
      let cached: TokenValidation | null = null;

      try {
        cached = await this.cache.get<TokenValidation>(cacheKey);
        if (cached) {
          this.logger.debug("Token validation retrieved from cache");
          return cached;
        }
      } catch (cacheError) {
        this.logger.warn("Cache retrieval failed, falling back to database", {
          error: (cacheError as Error).message,
        });
      }

      // Call the existing DatabaseAuthService
      const result = await this.dbAuthService.validateToken(token);

      // Transform result to match our interface
      const validation: TokenValidation = {
        valid: result.valid,
        user: result.user
          ? {
              id: result.user.id,
              username: result.user.username,
              fullName: result.user.fullName,
              role: result.user.role,
              restaurantId: result.user.restaurantId,
              isActive: result.user.isActive,
              isVerified: false, // Would need to be fetched from user record
              twoFactorEnabled: false, // Would need to be fetched from user record
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : undefined,
        error: result.error,
      };

      // Cache the result for a short time - handle cache errors gracefully
      if (validation.valid) {
        try {
          await this.cache.set(cacheKey, validation, CACHE_TTL.SHORT);
        } catch (cacheError) {
          this.logger.warn("Cache storage failed, but validation succeeded", {
            error: (cacheError as Error).message,
          });
        }
      }

      this.performance.recordMetric("auth.validateToken.success", 1);
      return validation;
    } catch (error) {
      this.logger.error("Token validation failed", error as Error);
      this.performance.recordMetric("auth.validateToken.error", 1);

      return {
        valid: false,
        error: "Token validation failed",
      };
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "auth.validateToken.duration",
        duration,
        "ms",
      );
    }
  }

  // User Management Methods
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const timer = this.performance.startTimer("auth.getUserProfile");

    try {
      // Try cache first
      const cacheKey = `user-profile:${userId}`;
      const cached = await this.cache.get<UserProfile>(cacheKey);

      if (cached) {
        this.logger.debug("User profile retrieved from cache", { userId });
        return cached;
      }

      const user = await this.db
        .select({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          email: users.email,
          phone: users.phone,
          role: users.role,
          restaurantId: users.restaurantId,
          adminTier: users.adminTier,
          isActive: users.isActive,
          isVerified: users.isVerified,
          lastLoginAt: users.lastLoginAt,
          passwordChangedAt: users.passwordChangedAt,
          emailVerifiedAt: users.emailVerifiedAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .get();

      if (!user) {
        return null;
      }

      const userSessions = await this.getUserSessions(userId);

      const profile: UserProfile = {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: user.role as UserRole,
        restaurantId: user.restaurantId || undefined,
        adminTier: user.adminTier || undefined,
        isActive: user.isActive,
        isVerified: user.isVerified,
        lastLoginAt: user.lastLoginAt || undefined,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        twoFactorEnabled: false,
        sessions: userSessions,
      };

      // Cache the result
      await this.cache.set(cacheKey, profile, CACHE_TTL.MEDIUM);

      this.performance.recordMetric("auth.getUserProfile.success", 1);
      return profile;
    } catch (error) {
      this.logger.error("Failed to get user profile", error as Error, {
        userId,
      });
      this.performance.recordMetric("auth.getUserProfile.error", 1);
      return null;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "auth.getUserProfile.duration",
        duration,
        "ms",
      );
    }
  }

  async updateUserProfile(
    userId: string,
    data: Partial<AuthUser>,
  ): Promise<AuthUser | null> {
    const timer = this.performance.startTimer("auth.updateUserProfile");

    try {
      const updates: Partial<typeof users.$inferInsert> = {};
      if (data.fullName !== undefined) updates.fullName = data.fullName;
      if (data.email !== undefined) updates.email = data.email;
      if (data.phone !== undefined) updates.phone = data.phone;

      if (Object.keys(updates).length === 0) {
        return null;
      }

      const [updatedUser] = await this.db
        .update(users)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, userId), eq(users.isActive, true)))
        .returning({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          email: users.email,
          phone: users.phone,
          role: users.role,
          restaurantId: users.restaurantId,
          isActive: users.isActive,
          isVerified: users.isVerified,
          lastLoginAt: users.lastLoginAt,
          passwordChangedAt: users.passwordChangedAt,
          emailVerifiedAt: users.emailVerifiedAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        });

      await this.cache.delete(`user-profile:${userId}`);
      await this.cache.delete(`user:${userId}`);

      if (!updatedUser) {
        return null;
      }

      return {
        ...updatedUser,
        role: updatedUser.role as UserRole,
        restaurantId: updatedUser.restaurantId || undefined,
        email: updatedUser.email || undefined,
        phone: updatedUser.phone || undefined,
        lastLoginAt: updatedUser.lastLoginAt || undefined,
        passwordChangedAt: updatedUser.passwordChangedAt || undefined,
        emailVerifiedAt: updatedUser.emailVerifiedAt || undefined,
        twoFactorEnabled: false,
      };
    } catch (error) {
      this.logger.error("Failed to update user profile", error as Error, {
        userId,
      });
      this.performance.recordMetric("auth.updateUserProfile.error", 1);
      return null;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "auth.updateUserProfile.duration",
        duration,
        "ms",
      );
    }
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    const timer = this.performance.startTimer("auth.changePassword");

    try {
      // Call the existing DatabaseAuthService
      const result = await this.dbAuthService.changePassword(
        userId,
        oldPassword,
        newPassword,
      );

      if (result.success) {
        // Log security event
        await this.logSecurityEvent({
          type: "PASSWORD_CHANGED",
          userId,
          severity: "MEDIUM",
        });

        // Clear user caches
        await this.cache.delete(`user-profile:${userId}`);
        await this.cache.clear(`user-session:${userId}`);

        this.logger.info("Password change successful", { userId });
        this.performance.recordMetric("auth.changePassword.success", 1);
      } else {
        this.performance.recordMetric("auth.changePassword.failed", 1);
      }

      return result;
    } catch (error) {
      this.logger.error("Password change failed", error as Error, { userId });
      this.performance.recordMetric("auth.changePassword.error", 1);
      return {
        success: false,
        error: "Failed to change password",
      };
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "auth.changePassword.duration",
        duration,
        "ms",
      );
    }
  }

  // Session Management Methods
  async getUserSessions(userId: string): Promise<SessionSummary[]> {
    const timer = this.performance.startTimer("auth.getUserSessions");

    try {
      // Call the existing DatabaseAuthService
      const sessions = await this.dbAuthService.getUserSessions(userId);

      // Transform to match our interface
      const parseJsonField = <T>(value: unknown): T | undefined => {
        if (!value) return undefined;
        if (typeof value !== "string") return value as T;
        try {
          return JSON.parse(value) as T;
        } catch {
          return undefined;
        }
      };

      const sessionSummaries: SessionSummary[] = sessions.map(
        (session: DatabaseSessionSummary) => ({
          id: String(session.id),
          deviceInfo: parseJsonField<DeviceInfo>(session.deviceInfo),
          location: parseJsonField<LocationInfo>(session.location),
          lastAccessedAt: session.lastAccessedAt
            ? new Date(session.lastAccessedAt)
            : undefined,
          expiresAt: new Date(session.expiresAt),
          isCurrent: false, // Would need to be determined based on current request
          createdAt: new Date(session.createdAt),
        }),
      );

      this.performance.recordMetric("auth.getUserSessions.success", 1);
      return sessionSummaries;
    } catch (error) {
      this.logger.error("Failed to get user sessions", error as Error, {
        userId,
      });
      this.performance.recordMetric("auth.getUserSessions.error", 1);
      return [];
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "auth.getUserSessions.duration",
        duration,
        "ms",
      );
    }
  }

  async terminateSession(userId: string, sessionId: string): Promise<boolean> {
    const timer = this.performance.startTimer("auth.terminateSession");

    try {
      const result = await this.db
        .update(sessions)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
        .returning({ id: sessions.id });

      if (result.length > 0) {
        await this.logSecurityEvent({
          type: "LOGOUT",
          userId,
          metadata: { sessionId, terminated: true },
          severity: "LOW",
        });
      }

      return result.length > 0;
    } catch (error) {
      this.logger.error("Failed to terminate session", error as Error, {
        userId,
        sessionId,
      });
      this.performance.recordMetric("auth.terminateSession.error", 1);
      return false;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "auth.terminateSession.duration",
        duration,
        "ms",
      );
    }
  }

  async terminateAllSessions(userId: string): Promise<boolean> {
    const timer = this.performance.startTimer("auth.terminateAllSessions");

    try {
      // Call logout with no specific token to terminate all sessions
      const result = await this.logout(userId, undefined, true);

      this.performance.recordMetric("auth.terminateAllSessions.success", 1);
      return result;
    } catch (error) {
      this.logger.error("Failed to terminate all sessions", error as Error, {
        userId,
      });
      this.performance.recordMetric("auth.terminateAllSessions.error", 1);
      return false;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "auth.terminateAllSessions.duration",
        duration,
        "ms",
      );
    }
  }

  // Two-Factor Authentication Methods (Placeholder implementations)
  async setupTwoFactor(
    userId: string,
    _password: string,
  ): Promise<{ secret: string; qrCode: string; backupCodes: string[] }> {
    this.logger.warn("setupTwoFactor not implemented", { userId });
    throw new Error("Two-factor authentication not yet implemented");
  }

  async verifyTwoFactor(
    userId: string,
    _token: string,
    _backupCode?: string,
  ): Promise<{ success: boolean; error?: string }> {
    this.logger.warn("verifyTwoFactor not implemented", { userId });
    return {
      success: false,
      error: "Two-factor authentication not yet implemented",
    };
  }

  async disableTwoFactor(
    userId: string,
    _password: string,
    _token?: string,
  ): Promise<{ success: boolean; error?: string }> {
    this.logger.warn("disableTwoFactor not implemented", { userId });
    return {
      success: false,
      error: "Two-factor authentication not yet implemented",
    };
  }

  async generateBackupCodes(userId: string): Promise<TwoFactorBackupCodes> {
    this.logger.warn("generateBackupCodes not implemented", { userId });
    throw new Error("Two-factor authentication not yet implemented");
  }

  // Password Reset Methods
  async requestPasswordReset(
    identifier: string,
    shop?: string,
  ): Promise<{
    success: boolean;
    reason?: PasswordResetFailureReason;
    error?: string;
  }> {
    const resetTarget = await this.resolvePasswordResetTarget(identifier, shop);
    if (!resetTarget) {
      // Do not reveal account existence.
      return { success: true };
    }

    const result = await this.verificationService.requestPasswordReset({
      identifier: resetTarget.identifier,
      method: resetTarget.method,
    });

    if (result.success) {
      await this.logSecurityEvent({
        type: "PASSWORD_RESET_REQUESTED",
        username: identifier,
        severity: "MEDIUM",
      });
    }

    return {
      success: result.success,
      reason: result.reason,
      error: result.error,
    };
  }

  private async resolvePasswordResetTarget(
    identifier: string,
    shop?: string,
  ): Promise<{ identifier: string; method: "email" | "sms" } | null> {
    if (identifier.includes("@")) {
      return { identifier, method: "email" };
    }

    // Usernames repeat across shops: pin to the named shop, and with none
    // refuse to guess when several accounts match (same generic reply as an
    // unknown username, so nothing leaks).
    const matches = await this.db
      .select({
        email: users.email,
        phone: users.phone,
      })
      .from(users)
      .leftJoin(restaurants, eq(restaurants.id, users.restaurantId))
      .where(
        and(
          eq(users.username, identifier),
          shop
            ? eq(restaurants.loginSlug, shop.trim().toLowerCase())
            : undefined,
        ),
      )
      .limit(2)
      .all();
    if (matches.length > 1) return null;
    const user = matches[0];

    if (user?.email) {
      return { identifier: user.email, method: "email" };
    }

    if (user?.phone) {
      return { identifier: user.phone, method: "sms" };
    }

    if (/^[\d\s\-+()]+$/.test(identifier)) {
      return { identifier, method: "sms" };
    }

    return null;
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{
    success: boolean;
    reason?: PasswordResetFailureReason;
    error?: string;
  }> {
    const result = await this.verificationService.resetPassword({
      token,
      newPassword,
      ipAddress: "0.0.0.0",
    });

    if (result.success) {
      await this.logSecurityEvent({
        type: "PASSWORD_RESET_COMPLETED",
        severity: "MEDIUM",
      });
    }

    return {
      success: result.success,
      reason: result.reason,
      error: result.error,
    };
  }

  // Email Verification Methods
  async requestEmailVerification(
    userId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const user = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (!user?.email) {
      return { success: false, error: "User email not found" };
    }

    const result = await this.verificationService.sendEmailVerification({
      userId,
      email: user.email,
    });

    return { success: result.success, error: result.error };
  }

  async verifyEmail(
    token: string,
  ): Promise<{ success: boolean; error?: string }> {
    const result = await this.verificationService.verifyEmail({ token });

    if (result.success) {
      await this.logSecurityEvent({
        type: "EMAIL_VERIFIED",
        userId: result.userId,
        severity: "LOW",
      });
    }

    return { success: result.success, error: result.error };
  }

  // Security and Monitoring Methods
  async logSecurityEvent(
    event: Omit<SecurityEvent, "timestamp">,
  ): Promise<void> {
    try {
      const securityEvent: SecurityEvent = {
        ...event,
        timestamp: new Date(),
      };

      // Store in cache for quick access
      const eventKey = `security-event:${Date.now()}`;
      await this.cache.set(eventKey, securityEvent, CACHE_TTL.LONG);

      this.logger.info("Security event logged", {
        type: securityEvent.type,
        userId: securityEvent.userId,
        severity: securityEvent.severity,
        timestamp: securityEvent.timestamp.toISOString(),
      });
    } catch (error) {
      this.logger.error("Failed to log security event", error as Error, {
        event,
      });
    }
  }

  async getSecurityEvents(
    userId?: string,
    limit = 50,
  ): Promise<SecurityEvent[]> {
    this.logger.warn("getSecurityEvents not fully implemented", {
      userId,
      limit,
    });
    return [];
  }

  async checkAccountSecurity(userId: string): Promise<AccountSecurity> {
    const user = await this.db
      .select({
        passwordChangedAt: users.passwordChangedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    return {
      failedLoginAttempts: 0,
      passwordStrength: "MEDIUM",
      lastPasswordChangeAt: user?.passwordChangedAt || undefined,
      suspiciousActivity: false,
    };
  }

  async getAuthStatistics(timeRange = "30d"): Promise<AuthStatistics> {
    const startDate = this.getStartDateForTimeRange(timeRange);
    const [totalUsersResult] = await this.db
      .select({ total: count() })
      .from(users);
    const [activeUsersResult] = await this.db
      .select({ total: count() })
      .from(users)
      .where(eq(users.isActive, true));
    const [dailyLoginsResult] = await this.db
      .select({ total: count() })
      .from(sessions)
      .where(gt(sessions.createdAt, startDate));
    const platformStats = await this.db
      .select({
        platform: sql<string>`json_extract(${sessions.deviceInfo}, '$.platform')`,
        total: count(),
      })
      .from(sessions)
      .where(gt(sessions.createdAt, startDate))
      .groupBy(sql`json_extract(${sessions.deviceInfo}, '$.platform')`);
    const [uniqueDevicesResult] = await this.db
      .select({
        total: sql<number>`COUNT(DISTINCT ${sessions.userAgent})`,
      })
      .from(sessions)
      .where(gt(sessions.createdAt, startDate));

    const platformDistribution: Record<string, number> = {};
    for (const row of platformStats) {
      if (row.platform) {
        platformDistribution[row.platform] = row.total;
      }
    }

    return {
      totalUsers: totalUsersResult?.total || 0,
      activeUsers: activeUsersResult?.total || 0,
      dailyLogins: dailyLoginsResult?.total || 0,
      uniqueDevices: uniqueDevicesResult?.total || 0,
      topCountries: [],
      platformDistribution,
      twoFactorAdoptionRate: 0,
      recentSecurityEvents: await this.getSecurityEvents(undefined, 10),
    };
  }

  private getStartDateForTimeRange(timeRange: string): Date {
    const now = new Date();
    const daysByRange: Record<string, number> = {
      "24h": 1,
      "7d": 7,
      "30d": 30,
      "90d": 90,
      "1y": 365,
    };
    now.setDate(now.getDate() - (daysByRange[timeRange] || 30));
    return now;
  }

  // Private Helper Methods
  private async validateRoleCreationPermissions(
    creatorId: string,
    targetRole: number,
  ): Promise<void> {
    // Implementation would check if creator has permission to create users with target role
    // For now, just log the check
    this.logger.debug("Role creation permission check", {
      creatorId,
      targetRole,
    });
  }

  private async cacheUserSession(userId: string, token: string): Promise<void> {
    try {
      const sessionKey = `user-session:${userId}:${token}`;
      await this.cache.set(
        sessionKey,
        { userId, token, cached: true },
        CACHE_TTL.MEDIUM,
      );
    } catch (error) {
      this.logger.error("Failed to cache user session", error as Error, {
        userId,
      });
    }
  }

  /** Per-account lockout, read after the shop-scoped lookup, before bcrypt. */
  private async isAccountLocked(userId: string): Promise<boolean> {
    try {
      const attempts = await this.cache.get<number>(accountFailureKey(userId));
      return Number(attempts ?? 0) >= LOGIN_USERNAME_FAILURE_LIMIT;
    } catch (error) {
      this.logger.error("Failed to check account lockout", error as Error);
      return false;
    }
  }

  private async checkRateLimit(
    username: string,
    ipAddress?: string,
    shop?: string,
  ): Promise<string | null> {
    try {
      const { normalizedUsername, usernameIpKey, ipKey } = loginRateLimitKeys(
        username,
        ipAddress,
        shop,
      );

      const [usernameIpAttempts, ipAttempts] = await Promise.all([
        this.cache.get<number>(usernameIpKey),
        ipKey ? this.cache.get<number>(ipKey) : Promise.resolve(null),
      ]);

      const usernameIpCount = Number(usernameIpAttempts ?? 0);
      const ipCount = Number(ipAttempts ?? 0);
      const limited =
        usernameIpCount >= LOGIN_IP_FAILURE_LIMIT ||
        ipCount >= LOGIN_IP_FAILURE_LIMIT;

      this.logger.debug("Rate limit check", {
        username: normalizedUsername,
        ipAddress: ipAddress || "unknown",
        usernameIpCount,
        ipCount,
        limited,
      });

      return limited ? LOGIN_RATE_LIMIT_ERROR : null;
    } catch (error) {
      this.logger.error("Failed to check login rate limit", error as Error);
      return null;
    }
  }

  /**
   * Counts a failed attempt: the IP counters always, the account counter only
   * when the shop-scoped lookup resolved a real account (wrong password).
   */
  private async logFailedLoginAttempt(
    username: string,
    ipAddress?: string,
    shop?: string,
    accountId?: string,
  ): Promise<void> {
    try {
      const { usernameIpKey, ipKey } = loginRateLimitKeys(
        username,
        ipAddress,
        shop,
      );
      const accountKey = accountId ? accountFailureKey(accountId) : null;
      const [usernameIpAttempts, ipAttempts, accountAttempts] =
        await Promise.all([
          this.cache.get<number>(usernameIpKey),
          ipKey ? this.cache.get<number>(ipKey) : Promise.resolve(null),
          accountKey
            ? this.cache.get<number>(accountKey)
            : Promise.resolve(null),
        ]);

      const writes = [
        this.cache.set(
          usernameIpKey,
          Number(usernameIpAttempts ?? 0) + 1,
          LOGIN_RATE_LIMIT_TTL_SECONDS,
        ),
      ];

      if (accountKey) {
        writes.push(
          this.cache.set(
            accountKey,
            Number(accountAttempts ?? 0) + 1,
            LOGIN_RATE_LIMIT_TTL_SECONDS,
          ),
        );
      }

      if (ipKey) {
        writes.push(
          this.cache.set(
            ipKey,
            Number(ipAttempts ?? 0) + 1,
            LOGIN_RATE_LIMIT_TTL_SECONDS,
          ),
        );
      }

      await Promise.all(writes);
    } catch (error) {
      this.logger.error("Failed to log failed login attempt", error as Error);
    }
  }

  private async clearFailedLoginAttempts(
    username: string,
    ipAddress: string | undefined,
    shop: string | undefined,
    userId: string,
  ): Promise<void> {
    try {
      const { usernameIpKey, ipKey } = loginRateLimitKeys(
        username,
        ipAddress,
        shop,
      );
      // delete(), not clear(): these are exact keys, and clear() treats its
      // argument as a prefix — a paginated kv.list() per call.
      const clears = [
        this.cache.delete(accountFailureKey(userId)),
        this.cache.delete(usernameIpKey),
      ];

      if (ipKey) {
        clears.push(this.cache.delete(ipKey));
      }

      await Promise.all(clears);
    } catch (error) {
      this.logger.error(
        "Failed to clear failed login attempts",
        error as Error,
      );
    }
  }
}
