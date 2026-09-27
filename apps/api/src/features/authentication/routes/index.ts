/**
 * Authentication Routes
 * HTTP routes for authentication feature
 *
 * Uses factory pattern to allow dependency injection for isolated tests.
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import type { Env } from "../../../shared/types";
import { HTTP_STATUS } from "../../../shared/constants";
import type { UserRole } from "../../../shared/constants";
import {
  authMiddleware as defaultAuthMiddleware,
  blacklistToken as defaultBlacklistToken,
  requireRole as defaultRequireRole,
} from "../../../shared/middleware";
import { ConsoleLogger } from "../../../core/monitoring";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../middleware/validation";
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from "../../../shared/utils/api-error";

// Import service and validation schemas
import { AuthService as DefaultAuthService } from "../services/AuthService";
import { authSchemas } from "../schemas/validation";
import type {
  AuthFailureReason,
  LoginData,
  RegisterData,
  DeviceInfo,
  LocationInfo,
  IAuthService,
  PasswordResetFailureReason,
} from "../types";

// Create feature logger
const _logger = new ConsoleLogger("auth-routes");

/**
 * Login failure reason -> error code the client sees.
 *
 * Exhaustive by construction: `Record<AuthFailureReason, ...>` means adding a
 * reason without deciding its code is a compile error, which is the property
 * the old `includes("locked")` check could not have. The register-only reasons
 * are listed too because both flows share one reason union; they are simply
 * unreachable from this route.
 */
const LOGIN_FAILURE_CODES: Record<AuthFailureReason, string> = {
  invalid_credentials: "INVALID_CREDENTIALS",
  rate_limited: "ACCOUNT_LOCKED",
  customer_password_login_retired: "CUSTOMER_PASSWORD_LOGIN_RETIRED",
  customer_password_registration_retired:
    "CUSTOMER_PASSWORD_REGISTRATION_RETIRED",
  username_taken: "USERNAME_TAKEN",
  weak_password: "WEAK_PASSWORD",
};
const PASSWORD_RESET_FAILURE_CODES: Record<PasswordResetFailureReason, string> =
  {
    reset_token_expired: "RESET_TOKEN_EXPIRED",
    reset_token_invalid: "RESET_TOKEN_INVALID",
    weak_password: "WEAK_PASSWORD",
    reset_request_throttled: "RESET_REQUEST_THROTTLED",
  };
const STAFF_REFRESH_COOKIE = "__Host-mm_staff_refresh";
const STAFF_REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Middleware type definitions for dependency injection
 */
export type AuthMiddleware = (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => Promise<Response | void>;
export type RequireRoleFactory = (roles: number[]) => AuthMiddleware;
export type BlacklistTokenFn = (
  c: Context<{ Bindings: Env }>,
  token: string,
  expiryTime?: number,
) => Promise<void>;

/**
 * Service factory type for dependency injection
 */
export type AuthServiceFactory = (
  env: Env,
  waitUntil?: (work: Promise<unknown>) => void,
) => IAuthService;

/**
 * Dependencies that can be injected for testing
 */
export interface AuthRouteDependencies {
  authMiddleware?: AuthMiddleware;
  requireRole?: RequireRoleFactory;
  blacklistToken?: BlacklistTokenFn;
  AuthService?: AuthServiceFactory;
}

/**
 * Hono's executionCtx getter throws outright when the context was built
 * without one — which is every unit test, and any direct app.fetch() call that
 * omits the third argument. Optional chaining does not help, since the throw
 * happens inside the getter. Callers that get undefined back simply run their
 * background work inline.
 */
function getWaitUntil<E extends { Bindings: Env }>(
  c: Context<E>,
): ((work: Promise<unknown>) => void) | undefined {
  try {
    return c.executionCtx.waitUntil.bind(c.executionCtx);
  } catch {
    return undefined;
  }
}

function extractRequestInfo<E extends { Bindings: Env }>(
  c: Context<E>,
): {
  deviceInfo: DeviceInfo;
  location: LocationInfo;
} {
  const userAgent = c.req.header("User-Agent");
  const cfConnectingIp = c.req.header("CF-Connecting-IP");
  const cfIpCountry = c.req.header("CF-IPCountry");

  const deviceInfo: DeviceInfo = {
    userAgent,
    ipAddress: cfConnectingIp,
    platform: userAgent?.includes("Mobile") ? "mobile" : "desktop",
  };

  const location: LocationInfo = {
    country: cfIpCountry,
  };

  return { deviceInfo, location };
}

function setStaffRefreshCookie<E extends { Bindings: Env }>(
  c: Context<E>,
  token: string,
) {
  setCookie(c, STAFF_REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: STAFF_REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
}

function clearStaffRefreshCookie<E extends { Bindings: Env }>(c: Context<E>) {
  deleteCookie(c, STAFF_REFRESH_COOKIE, {
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
}

/**
 * Factory function to create auth routes with injectable dependencies.
 * This allows tests to inject middleware and services.
 *
 * @param deps - Optional dependencies to inject (middleware, services)
 * @returns Configured Hono router for authentication routes
 */
export function createAuthRoutes(
  deps: AuthRouteDependencies = {},
): Hono<{ Bindings: Env }> {
  // Use injected dependencies or defaults
  const authMiddleware = deps.authMiddleware ?? defaultAuthMiddleware;
  const requireRole = deps.requireRole ?? defaultRequireRole;
  const blacklistToken = deps.blacklistToken ?? defaultBlacklistToken;
  const AuthService =
    deps.AuthService ??
    ((env: Env, waitUntil?: (work: Promise<unknown>) => void) =>
      new DefaultAuthService(env, waitUntil));

  // Create router
  const authRoutes = new Hono<{ Bindings: Env }>();

  // User Login - POST /login
  authRoutes.post("/login", validateBody(authSchemas.login), async (c) => {
    const requestData = c.get("validatedBody");
    const { deviceInfo, location } = extractRequestInfo(c);

    // Transform request data to LoginData format
    const loginData: LoginData = {
      username: requestData.username,
      password: requestData.password,
      deviceInfo,
      location,
    };

    // Initialize auth service. Hand it waitUntil so the post-login bookkeeping
    // settles after the response instead of in front of it.
    const authService = AuthService(c.env, getWaitUntil(c));
    const result = await authService.login(loginData);

    if (!result.success) {
      // Mapped from the structured reason, not from the message text. The
      // previous `message.includes("locked")` worked only because the rate
      // limiter's copy happens to contain that word, and it labelled the
      // retired-customer-login case as bad credentials, which it is not.
      const code = LOGIN_FAILURE_CODES[result.reason ?? "invalid_credentials"];
      throw unauthorized(result.error || "Authentication failed", code);
    }

    if (result.tokens?.refreshToken) {
      setStaffRefreshCookie(c, result.tokens.refreshToken);
    }

    return c.json(
      {
        success: true,
        data: {
          token: result.tokens?.accessToken,
          expiresAt: result.tokens?.expiresAt,
          user: result.user,
        },
      },
      HTTP_STATUS.OK,
    );
  });

  // Public customer password registration is retired. Customers now use
  // /api/v1/customer/auth/request-otp + verify-otp so new identity rows are
  // created in customers, not users(role=5).
  authRoutes.post(
    "/register",
    validateBody(authSchemas.customerRegister),
    async (c) => {
      return c.json(
        {
          success: false,
          error: {
            code: "CUSTOMER_PASSWORD_REGISTRATION_RETIRED",
            message:
              "Customer password registration is retired. Use phone OTP customer authentication.",
          },
        },
        HTTP_STATUS.GONE,
      );
    },
  );

  // Staff Registration - POST /register-staff (admin/owner only)
  authRoutes.post(
    "/register-staff",
    authMiddleware,
    validateBody(authSchemas.register),
    async (c) => {
      const currentUser = c.get("user");

      // Only admin or shop owner can register new staff users
      if (currentUser.role !== 0 && currentUser.role !== 1) {
        throw forbidden("Insufficient permissions", "INSUFFICIENT_ROLE");
      }

      const requestData = c.get("validatedBody");

      // Validate role permissions
      if (currentUser.role === 1 && requestData.role < 2) {
        throw forbidden(
          "Shop owners can only create staff accounts",
          "ROLE_NOT_ASSIGNABLE",
        );
      }

      // Roles 1-4 are restaurant-scoped; role 0 is the platform and owns no
      // restaurant. Tying the requirement to the role being created — rather
      // than to who is creating it — is what stops an admin from producing the
      // same unmanageable orphan an owner used to (#67): a staff row with a
      // NULL restaurant_id belongs to nobody, so no owner can administer it.
      const isPlatformRole = requestData.role === 0;

      const effectiveRestaurantId = isPlatformRole
        ? undefined
        : currentUser.role === 1
          ? currentUser.restaurantId == null
            ? undefined
            : String(currentUser.restaurantId)
          : requestData.restaurantId;

      if (!isPlatformRole && !effectiveRestaurantId) {
        throw badRequest(
          currentUser.role === 1
            ? "Shop owner restaurant id is required"
            : "Restaurant ID is required for restaurant-scoped roles",
          "RESTAURANT_ID_REQUIRED",
        );
      }

      // Transform request data to RegisterData format
      const registerData: RegisterData = {
        username: requestData.username,
        fullName: requestData.fullName,
        email: requestData.email,
        phone: requestData.phone,
        password: requestData.password,
        role: requestData.role as UserRole,
        restaurantId: effectiveRestaurantId,
      };

      // Initialize auth service
      const authService = AuthService(c.env);
      const result = await authService.register(registerData, currentUser.id);

      if (!result.success) {
        // Same reasoning as the login mapping above: both the status and the
        // code come from the reason, not from whether the message happens to
        // say "already exists".
        const message = result.error || "Registration failed";
        throw result.reason === "username_taken"
          ? conflict(message, "USERNAME_TAKEN")
          : badRequest(
              message,
              result.reason
                ? LOGIN_FAILURE_CODES[result.reason]
                : "VALIDATION_ERROR",
            );
      }

      return c.json(
        {
          success: true,
          data: result.user,
        },
        HTTP_STATUS.CREATED,
      );
    },
  );

  // Refresh Token - POST /refresh
  authRoutes.post("/refresh", async (c) => {
    const refreshToken =
      getCookie(c, STAFF_REFRESH_COOKIE) ?? c.req.header("X-Refresh-Token");

    if (!refreshToken) {
      throw badRequest("Refresh token is required", "MISSING_AUTH_TOKEN");
    }

    // Initialize auth service
    const authService = AuthService(c.env);
    const result = await authService.refreshToken(refreshToken);

    if (!result.success) {
      clearStaffRefreshCookie(c);
      throw unauthorized(
        result.error || "Refresh token is invalid",
        "TOKEN_INVALID",
      );
    }

    if (result.tokens?.refreshToken) {
      setStaffRefreshCookie(c, result.tokens.refreshToken);
    }

    return c.json(
      {
        success: true,
        data: {
          token: result.tokens?.accessToken,
          expiresAt: result.tokens?.expiresAt,
          user: result.user,
        },
      },
      HTTP_STATUS.OK,
    );
  });

  // User Logout - POST /logout
  authRoutes.post("/logout", authMiddleware, async (c) => {
    const user = c.get("user");
    const authHeader = c.req.header("Authorization");

    let token: string | undefined;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);

      // Add token to blacklist (non-critical — don't let failure stop logout)
      try {
        await blacklistToken(c, token);
      } catch {
        // Swallow blacklist errors — logout should still succeed
      }
    }

    // Initialize auth service
    const authService = AuthService(c.env);
    const success = await authService.logout(user.id, token);
    clearStaffRefreshCookie(c);

    if (success) {
      return c.json(
        {
          success: true,
          message: "Logout successful",
        },
        HTTP_STATUS.OK,
      );
    } else {
      throw new ApiError("LOGOUT_FAILED", "Logout failed", 500);
    }
  });

  // Get Current User Info - GET /me
  authRoutes.get("/me", authMiddleware, async (c) => {
    const user = c.get("user");
    const authService = AuthService(c.env);
    const profile = await authService.getUserProfile(String(user.id));
    const responseUser = profile
      ? (({ sessions: _sessions, ...publicProfile }) => publicProfile)(profile)
      : user;

    return c.json(
      {
        success: true,
        data: responseUser,
      },
      HTTP_STATUS.OK,
    );
  });

  // Get User Profile - GET /profile/:id
  authRoutes.get(
    "/profile/:id",
    authMiddleware,
    validateParams(authSchemas.userIdParam),
    async (c) => {
      const currentUser = c.get("user");
      const { id: userId } = c.get("validatedParams");

      // Users can only view their own profile unless they are admin
      if (currentUser.role !== 0 && String(currentUser.id) !== userId) {
        throw forbidden("Insufficient permissions", "INSUFFICIENT_ROLE");
      }

      const authService = AuthService(c.env);
      const profile = await authService.getUserProfile(userId);

      if (!profile) {
        throw notFound("User not found", "USER_NOT_FOUND");
      }

      return c.json(
        {
          success: true,
          data: profile,
        },
        HTTP_STATUS.OK,
      );
    },
  );

  // Update User Profile - PUT /profile/:id
  authRoutes.put(
    "/profile/:id",
    authMiddleware,
    validateParams(authSchemas.userIdParam),
    validateBody(authSchemas.updateProfile),
    async (c) => {
      const currentUser = c.get("user");
      const { id: userId } = c.get("validatedParams");
      const updateData = c.get("validatedBody");

      // Users can only update their own profile unless they are admin
      if (currentUser.role !== 0 && String(currentUser.id) !== userId) {
        throw forbidden("Insufficient permissions", "INSUFFICIENT_ROLE");
      }

      const authService = AuthService(c.env);
      const updatedUser = await authService.updateUserProfile(
        userId,
        updateData,
      );

      if (!updatedUser) {
        throw badRequest("Failed to update profile", "PROFILE_UPDATE_FAILED");
      }

      return c.json(
        {
          success: true,
          data: updatedUser,
        },
        HTTP_STATUS.OK,
      );
    },
  );

  // Change Password - POST /change-password
  authRoutes.post(
    "/change-password",
    authMiddleware,
    validateBody(authSchemas.changePassword),
    async (c) => {
      const user = c.get("user");
      const { currentPassword, newPassword } = c.get("validatedBody");

      const authService = AuthService(c.env);
      const result = await authService.changePassword(
        user.id,
        currentPassword,
        newPassword,
      );

      if (!result.success) {
        throw badRequest(
          result.error || "Failed to change password",
          "PASSWORD_CHANGE_FAILED",
        );
      }

      return c.json(
        {
          success: true,
          message: "Password changed successfully",
        },
        HTTP_STATUS.OK,
      );
    },
  );

  // Get User Sessions - GET /sessions
  authRoutes.get("/sessions", authMiddleware, async (c) => {
    const user = c.get("user");

    const authService = AuthService(c.env);
    const sessions = await authService.getUserSessions(user.id);

    return c.json(
      {
        success: true,
        data: sessions,
      },
      HTTP_STATUS.OK,
    );
  });

  // Terminate Session - DELETE /sessions/:sessionId
  authRoutes.delete(
    "/sessions/:sessionId",
    authMiddleware,
    validateParams(authSchemas.sessionIdParam),
    async (c) => {
      const user = c.get("user");
      const { sessionId } = c.get("validatedParams");

      const authService = AuthService(c.env);
      const success = await authService.terminateSession(user.id, sessionId);

      if (!success) {
        throw badRequest(
          "Failed to terminate session",
          "SESSION_TERMINATION_FAILED",
        );
      }

      return c.json(
        {
          success: true,
          message: "Session terminated successfully",
        },
        HTTP_STATUS.OK,
      );
    },
  );

  // Terminate All Sessions - DELETE /sessions
  authRoutes.delete("/sessions", authMiddleware, async (c) => {
    const user = c.get("user");

    const authService = AuthService(c.env);
    const success = await authService.terminateAllSessions(user.id);

    if (!success) {
      throw badRequest(
        "Failed to terminate sessions",
        "SESSION_TERMINATION_FAILED",
      );
    }

    return c.json(
      {
        success: true,
        message: "All sessions terminated successfully",
      },
      HTTP_STATUS.OK,
    );
  });

  // Forgot Password - POST /forgot-password
  // LIVE implementation. This mounts on /auth before the verification feature,
  // so this AuthService-based handler is the one clients actually hit (the
  // verification module's same-path handler was removed as unreachable).
  authRoutes.post(
    "/forgot-password",
    validateBody(authSchemas.forgotPassword),
    async (c) => {
      const requestData = c.get("validatedBody");

      const authService = AuthService(c.env);
      const result = await authService.requestPasswordReset(
        requestData.email ||
          requestData.username ||
          requestData.identifier ||
          "",
      );

      if (!result.success) {
        throw badRequest(
          result.error || "Password reset request failed",
          result.reason
            ? PASSWORD_RESET_FAILURE_CODES[result.reason]
            : "PASSWORD_RESET_REQUEST_FAILED",
        );
      }

      return c.json(
        {
          success: true,
          message: "Password reset email sent",
        },
        HTTP_STATUS.OK,
      );
    },
  );

  // Reset Password - POST /reset-password
  // LIVE implementation (see /forgot-password note) — wins over the verification
  // module's same-path handler, which was removed as unreachable dead code.
  authRoutes.post(
    "/reset-password",
    validateBody(authSchemas.resetPassword),
    async (c) => {
      const { token, newPassword } = c.get("validatedBody");

      const authService = AuthService(c.env);
      const result = await authService.resetPassword(token, newPassword);

      if (!result.success) {
        throw badRequest(
          result.error || "Password reset failed",
          result.reason
            ? PASSWORD_RESET_FAILURE_CODES[result.reason]
            : "PASSWORD_RESET_FAILED",
        );
      }

      return c.json(
        {
          success: true,
          message: "Password reset successfully",
        },
        HTTP_STATUS.OK,
      );
    },
  );

  // Verify Email - POST /verify-email
  // LIVE implementation. The verification module only exposes GET /verify-email
  // (a different method), so there is no collision — this POST handler is live.
  authRoutes.post(
    "/verify-email",
    validateBody(authSchemas.verifyEmail),
    async (c) => {
      const { token } = c.get("validatedBody");

      const authService = AuthService(c.env);
      const result = await authService.verifyEmail(token);

      return c.json(
        {
          success: result.success,
          message: result.success
            ? "Email verified successfully"
            : result.error,
        },
        result.success ? HTTP_STATUS.OK : HTTP_STATUS.BAD_REQUEST,
      );
    },
  );

  // Get Authentication Statistics - GET /stats (Admin only)
  authRoutes.get(
    "/stats",
    authMiddleware,
    requireRole([0]), // Admin only
    validateQuery(authSchemas.authStatsQuery),
    async (c) => {
      const { timeRange } = c.get("validatedQuery");

      const authService = AuthService(c.env);
      const stats = await authService.getAuthStatistics(timeRange);

      return c.json(
        {
          success: true,
          data: stats,
        },
        HTTP_STATUS.OK,
      );
    },
  );

  // Get Security Events - GET /security-events (Admin only)
  authRoutes.get(
    "/security-events",
    authMiddleware,
    requireRole([0]), // Admin only
    validateQuery(authSchemas.securityEventsQuery),
    async (c) => {
      const query = c.get("validatedQuery");
      const currentUser = c.get("user");

      const authService = AuthService(c.env);
      const events = await authService.getSecurityEvents(
        currentUser.role === 0 ? undefined : currentUser.id, // Admin sees all, others see only their own
        query.limit,
      );

      return c.json(
        {
          success: true,
          data: events,
        },
        HTTP_STATUS.OK,
      );
    },
  );

  return authRoutes;
}

export default createAuthRoutes();
