import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { createAuthRoutes } from "./index";
import { ApiError } from "../../../shared/utils/api-error";

vi.mock("../../../middleware/guestAuth", () => ({
  generateGuestToken: vi.fn(() => "guest-token-1"),
}));

const currentUser: { value: AuthUser } = {
  value: {
    id: "user-7",
    username: "admin",
    role: 0,
    restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31a1",
  },
};

const service = {
  login: vi.fn(),
  register: vi.fn(),
  refreshToken: vi.fn(),
  logout: vi.fn(),
  validateToken: vi.fn(),
  getUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
  changePassword: vi.fn(),
  getUserSessions: vi.fn(),
  terminateSession: vi.fn(),
  terminateAllSessions: vi.fn(),
  setupTwoFactor: vi.fn(),
  verifyTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  generateBackupCodes: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  requestEmailVerification: vi.fn(),
  verifyEmail: vi.fn(),
  logSecurityEvent: vi.fn(),
  getSecurityEvents: vi.fn(),
  checkAccountSecurity: vi.fn(),
  getAuthStatistics: vi.fn(),
};

const blacklistToken = vi.fn();
const requireRole = vi.fn(
  () => async (_c: unknown, next: () => Promise<void>) => next(),
);

const app = createAuthRoutes({
  authMiddleware: async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new ApiError(
        "MISSING_AUTH_HEADER",
        "Missing or invalid authorization header",
        401,
      );
    }
    c.set("user", currentUser.value as never);
    await next();
  },
  requireRole,
  blacklistToken,
  AuthService: () => service as never,
});

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409 | 500,
    );
  }

  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function createKv() {
  const values = new Map<string, string>();

  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(
      async (
        key: string,
        value: string,
        _options?: { expirationTtl?: number },
      ) => {
        values.set(key, value);
      },
    ),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const kv = createKv();
  const res = app.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "User-Agent": "Vitest Mobile",
        "CF-Connecting-IP": "203.0.113.10",
        "CF-IPCountry": "TW",
        Authorization: "Bearer access-token-1",
        ...headers,
      },
    },
    { DB: {}, CACHE_KV: kv } as never,
  );

  return { res, kv };
}

const user = {
  id: "user-7",
  username: "owner",
  fullName: "Owner User",
  role: 1,
};

const tokens = {
  accessToken: "access-token-2",
  refreshToken: "refresh-token-2",
  expiresAt: "2026-01-01T01:00:00.000Z",
};

function staffBody(overrides: Record<string, unknown> = {}) {
  return {
    username: "chef01",
    fullName: "Chef One",
    email: "chef@example.test",
    password: "Secret123!",
    confirmPassword: "Secret123!",
    role: 2,
    restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31a1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.value = {
    id: "user-7",
    username: "admin",
    role: 0,
    restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31a1",
  };

  service.login.mockResolvedValue({ success: true, tokens, user });
  service.register.mockResolvedValue({ success: true, user });
  service.refreshToken.mockResolvedValue({ success: true, tokens, user });
  service.logout.mockResolvedValue(true);
  service.validateToken.mockResolvedValue({ valid: true, user });
  service.getUserProfile.mockResolvedValue(user);
  service.updateUserProfile.mockResolvedValue(user);
  service.changePassword.mockResolvedValue({ success: true });
  service.getUserSessions.mockResolvedValue([{ id: "session-1" }]);
  service.terminateSession.mockResolvedValue(true);
  service.terminateAllSessions.mockResolvedValue(true);
  service.requestPasswordReset.mockResolvedValue({ success: true });
  service.resetPassword.mockResolvedValue({ success: true });
  service.verifyEmail.mockResolvedValue({ success: true });
  service.getAuthStatistics.mockResolvedValue({ totalUsers: 1 });
  service.getSecurityEvents.mockResolvedValue([{ type: "LOGIN" }]);
  blacklistToken.mockResolvedValue(undefined);
});

describe("authentication routes", () => {
  it("logs in with request-derived device and location metadata", async () => {
    const response = await request("/login", "POST", {
      username: "owner",
      password: "password",
    }).res;

    expect(response.status).toBe(200);
    const body = await response.json<{
      success: boolean;
      data: Record<string, unknown>;
    }>();
    expect(body).toMatchObject({
      success: true,
      data: { token: "access-token-2" },
    });
    expect(body.data).not.toHaveProperty("refreshToken");
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-mm_staff_refresh=refresh-token-2",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(service.login).toHaveBeenCalledWith({
      username: "owner",
      password: "password",
      deviceInfo: {
        userAgent: "Vitest Mobile",
        ipAddress: "203.0.113.10",
        platform: "mobile",
      },
      location: { country: "TW" },
    });
  });

  it.each([
    ["rate_limited", "ACCOUNT_LOCKED"],
    ["invalid_credentials", "INVALID_CREDENTIALS"],
    // Previously mapped to INVALID_CREDENTIALS, which was wrong: the account
    // exists and the password was never the problem. Only reachable now that
    // the code comes from the reason rather than from the message text.
    ["customer_password_login_retired", "CUSTOMER_PASSWORD_LOGIN_RETIRED"],
  ])("maps the %s login failure to %s", async (reason, code) => {
    service.login.mockResolvedValueOnce({
      success: false,
      reason,
      error: "some message the route must not parse",
    });

    const response = await request("/login", "POST", {
      username: "owner",
      password: "password",
    }).res;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code },
    });
  });

  it("does not read the error code out of the message text", async () => {
    // The message says "locked" but the reason does not. The old
    // `message.includes("locked")` mapping would have answered ACCOUNT_LOCKED.
    service.login.mockResolvedValueOnce({
      success: false,
      reason: "invalid_credentials",
      error: "Account locked after repeated failures",
    });

    const response = await request("/login", "POST", {
      username: "owner",
      password: "password",
    }).res;

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "INVALID_CREDENTIALS" },
    });
  });

  it("keeps retired customer password registration unavailable", async () => {
    const response = await request("/register", "POST", {
      username: "customer01",
      fullName: "Customer One",
      email: "customer@example.test",
      password: "Secret123!",
      role: 5,
    }).res;

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "CUSTOMER_PASSWORD_REGISTRATION_RETIRED" },
    });
  });

  it("lets admins register staff users and returns conflicts from service", async () => {
    let response = await request("/register-staff", "POST", staffBody()).res;

    expect(response.status).toBe(201);
    expect(service.register).toHaveBeenCalledWith(
      expect.objectContaining({ username: "chef01", role: 2 }),
      "user-7",
    );

    service.register.mockResolvedValueOnce({
      success: false,
      reason: "username_taken",
      error: "User already exists",
    });
    response = await request("/register-staff", "POST", staffBody()).res;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "USERNAME_TAKEN", message: "User already exists" },
    });
  });

  it("derives owner-created staff restaurant id from the owner token", async () => {
    currentUser.value = {
      id: "user-9",
      username: "owner",
      role: 1,
      restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31a1",
    };

    const response = await request(
      "/register-staff",
      "POST",
      staffBody({
        restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31ff",
      }),
    ).res;

    expect(response.status).toBe(201);
    expect(service.register).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 2,
        restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31a1",
      }),
      "user-9",
    );
  });

  it("creates owner staff in the owner restaurant when body omits restaurant id", async () => {
    currentUser.value = {
      id: "user-9",
      username: "owner",
      role: 1,
      restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31a1",
    };

    const response = await request(
      "/register-staff",
      "POST",
      staffBody({ restaurantId: undefined }),
    ).res;

    expect(response.status).toBe(201);
    expect(service.register).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31a1",
      }),
      "user-9",
    );
  });

  it("does not create owner staff without an owner restaurant id", async () => {
    currentUser.value = {
      id: "user-9",
      username: "owner",
      role: 1,
      restaurantId: undefined,
    };

    const response = await request(
      "/register-staff",
      "POST",
      staffBody({ restaurantId: undefined }),
    ).res;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "RESTAURANT_ID_REQUIRED",
        message: "Shop owner restaurant id is required",
      },
    });
    expect(service.register).not.toHaveBeenCalled();
  });

  // The owner path above is the one that was reported, but a staff row with a
  // NULL restaurant_id is unmanageable whoever created it — no owner can
  // administer an account that belongs to no restaurant (#67). The requirement
  // therefore follows the role being created, not the creator.
  it("does not let an admin create restaurant-scoped staff with no restaurant", async () => {
    currentUser.value = {
      id: "user-7",
      username: "admin",
      role: 0,
      restaurantId: undefined,
    };

    const response = await request(
      "/register-staff",
      "POST",
      staffBody({ role: 4, restaurantId: undefined }),
    ).res;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "RESTAURANT_ID_REQUIRED",
        message: "Restaurant ID is required for restaurant-scoped roles",
      },
    });
    expect(service.register).not.toHaveBeenCalled();
  });

  it("lets an admin create restaurant-scoped staff for a named restaurant", async () => {
    currentUser.value = {
      id: "user-7",
      username: "admin",
      role: 0,
      restaurantId: undefined,
    };

    const response = await request(
      "/register-staff",
      "POST",
      staffBody({
        role: 4,
        restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31ff",
      }),
    ).res;

    expect(response.status).toBe(201);
    expect(service.register).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 4,
        restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31ff",
      }),
      "user-7",
    );
  });

  it("keeps a platform admin unbound to any restaurant", async () => {
    currentUser.value = {
      id: "user-7",
      username: "admin",
      role: 0,
      restaurantId: undefined,
    };

    const response = await request(
      "/register-staff",
      "POST",
      staffBody({
        role: 0,
        restaurantId: "019fa136-cfe3-709f-a2ab-f8a3ebcd31ff",
      }),
    ).res;

    expect(response.status).toBe(201);
    expect(service.register).toHaveBeenCalledWith(
      expect.objectContaining({ role: 0, restaurantId: undefined }),
      "user-7",
    );
  });

  it("enforces role constraints for staff registration", async () => {
    currentUser.value = { id: "user-8", username: "chef", role: 2 };

    let response = await request("/register-staff", "POST", staffBody()).res;

    expect(response.status).toBe(403);

    currentUser.value = { id: "user-9", username: "owner", role: 1 };
    response = await request("/register-staff", "POST", staffBody({ role: 1 }))
      .res;

    expect(response.status).toBe(403);
    expect(service.register).not.toHaveBeenCalled();
  });

  it("refreshes tokens from the HttpOnly cookie and rejects invalid refresh tokens", async () => {
    let response = await request("/refresh", "POST", undefined, {
      Cookie: "__Host-mm_staff_refresh=refresh-token-1",
    }).res;

    expect(response.status).toBe(200);
    expect(service.refreshToken).toHaveBeenCalledWith("refresh-token-1");
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-mm_staff_refresh=refresh-token-2",
    );

    service.refreshToken.mockResolvedValueOnce({
      success: false,
      error: "Invalid refresh token",
    });
    response = await request("/refresh", "POST", undefined, {
      Cookie: "__Host-mm_staff_refresh=refresh-token-1",
    }).res;

    expect(response.status).toBe(401);
  });

  it("logs out with best-effort token blacklisting", async () => {
    blacklistToken.mockRejectedValueOnce(new Error("kv unavailable"));

    let response = await request("/logout", "POST").res;

    expect(response.status).toBe(200);
    expect(blacklistToken).toHaveBeenCalledWith(
      expect.anything(),
      "access-token-1",
    );
    expect(service.logout).toHaveBeenCalledWith("user-7", "access-token-1");

    service.logout.mockResolvedValueOnce(false);
    response = await request("/logout", "POST").res;

    expect(response.status).toBe(500);
  });

  it("returns the auth middleware user for the current user endpoint", async () => {
    currentUser.value = {
      id: "user-7",
      username: "owner",
      role: 1,
      restaurantId: "S-20250124-001",
    };
    service.getUserProfile.mockResolvedValueOnce({
      id: "user-7",
      username: "owner",
      fullName: "Owner User",
      email: "owner@example.test",
      role: 1,
      restaurantId: "S-20250124-001",
      isActive: true,
      isVerified: true,
      sessions: [{ id: "session-1" }],
    });

    let response = await request("/me").res;

    expect(response.status).toBe(200);
    const body = await response.json<{
      success: boolean;
      data: Record<string, unknown>;
    }>();
    expect(body).toMatchObject({
      success: true,
      data: {
        id: "user-7",
        username: "owner",
        fullName: "Owner User",
        email: "owner@example.test",
        role: 1,
        restaurantId: "S-20250124-001",
      },
    });
    expect(body.data).not.toHaveProperty("sessions");
    expect(service.validateToken).not.toHaveBeenCalled();
    expect(service.getUserProfile).toHaveBeenCalledWith("user-7");

    response = await request("/me", "GET", undefined, {
      Authorization: "",
    }).res;

    expect(response.status).toBe(401);
  });

  it("gets and updates profiles only for self or admins", async () => {
    currentUser.value = { id: "user-7", username: "owner", role: 1 };

    let response = await request("/profile/user-7").res;

    expect(response.status).toBe(200);
    expect(service.getUserProfile).toHaveBeenCalledWith("user-7");

    response = await request("/profile/user-8").res;
    expect(response.status).toBe(403);

    service.getUserProfile.mockResolvedValueOnce(null);
    currentUser.value = { id: "user-1", username: "admin", role: 0 };
    response = await request("/profile/user-8").res;
    expect(response.status).toBe(404);

    response = await request("/profile/user-8", "PUT", {
      fullName: "Updated User",
    }).res;
    expect(response.status).toBe(200);
    expect(service.updateUserProfile).toHaveBeenCalledWith("user-8", {
      fullName: "Updated User",
    });

    service.updateUserProfile.mockResolvedValueOnce(null);
    response = await request("/profile/user-8", "PUT", {
      fullName: "Updated User",
    }).res;
    expect(response.status).toBe(400);
  });

  it("changes passwords and returns service validation failures", async () => {
    const body = {
      currentPassword: "OldSecret123!",
      newPassword: "NewSecret123!",
      confirmPassword: "NewSecret123!",
    };

    let response = await request("/change-password", "POST", body).res;

    expect(response.status).toBe(200);
    expect(service.changePassword).toHaveBeenCalledWith(
      "user-7",
      "OldSecret123!",
      "NewSecret123!",
    );

    service.changePassword.mockResolvedValueOnce({
      success: false,
      error: "Current password is incorrect",
    });
    response = await request("/change-password", "POST", body).res;

    expect(response.status).toBe(400);
  });

  it("lists and terminates user sessions", async () => {
    let response = await request("/sessions").res;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: "session-1" }],
    });

    response = await request("/sessions/session-1", "DELETE").res;
    expect(response.status).toBe(200);
    expect(service.terminateSession).toHaveBeenCalledWith(
      "user-7",
      "session-1",
    );

    service.terminateSession.mockResolvedValueOnce(false);
    response = await request("/sessions/session-1", "DELETE").res;
    expect(response.status).toBe(400);

    response = await request("/sessions", "DELETE").res;
    expect(response.status).toBe(200);

    service.terminateAllSessions.mockResolvedValueOnce(false);
    response = await request("/sessions", "DELETE").res;
    expect(response.status).toBe(400);
  });

  it("handles password reset and email verification flows", async () => {
    let response = await request("/forgot-password", "POST", {
      email: "owner@example.test",
    }).res;
    expect(response.status).toBe(200);
    expect(service.requestPasswordReset).toHaveBeenCalledWith(
      "owner@example.test",
    );

    service.requestPasswordReset.mockResolvedValueOnce({
      success: false,
      error: "Unknown account",
    });
    response = await request("/forgot-password", "POST", {
      username: "missing",
    }).res;
    expect(response.status).toBe(400);

    response = await request("/reset-password", "POST", {
      token: "reset-token",
      newPassword: "Secret123!",
      confirmPassword: "Secret123!",
    }).res;
    expect(response.status).toBe(200);
    expect(service.resetPassword).toHaveBeenCalledWith(
      "reset-token",
      "Secret123!",
    );

    service.verifyEmail.mockResolvedValueOnce({
      success: false,
      error: "Invalid token",
    });
    response = await request("/verify-email", "POST", {
      token: "verify-token",
    }).res;
    expect(response.status).toBe(400);
  });

  it("accepts the deployed admin forgot-password form payload", async () => {
    const response = await request("/forgot-password", "POST", {
      identifier: "owner@example.test",
      method: "email",
    }).res;

    expect(response.status).toBe(200);
    expect(service.requestPasswordReset).toHaveBeenCalledOnce();
    expect(service.requestPasswordReset).toHaveBeenCalledWith(
      "owner@example.test",
    );
  });

  it.each([
    [
      "requestPasswordReset",
      "/forgot-password",
      { email: "owner@example.test" },
      "reset_request_throttled",
      "RESET_REQUEST_THROTTLED",
    ],
    [
      "resetPassword",
      "/reset-password",
      {
        token: "reset-token",
        newPassword: "Secret123!",
        confirmPassword: "Secret123!",
      },
      "weak_password",
      "WEAK_PASSWORD",
    ],
    [
      "resetPassword",
      "/reset-password",
      {
        token: "reset-token",
        newPassword: "Secret123!",
        confirmPassword: "Secret123!",
      },
      "reset_token_expired",
      "RESET_TOKEN_EXPIRED",
    ],
  ] as const)(
    "returns %s failures in the standard error envelope",
    async (method, path, body, reason, code) => {
      service[method].mockResolvedValueOnce({
        success: false,
        reason,
        error: "server prose must not determine the code",
      });

      const response = await request(path, "POST", body).res;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: {
          code,
          message: "server prose must not determine the code",
        },
      });
    },
  );

  it("returns admin auth statistics and security events", async () => {
    let response = await request("/stats?timeRange=7d").res;

    expect(response.status).toBe(200);
    expect(service.getAuthStatistics).toHaveBeenCalledWith("7d");

    response = await request("/security-events?limit=5").res;

    expect(response.status).toBe(200);
    expect(service.getSecurityEvents).toHaveBeenCalledWith(undefined, 5);
  });

  it("no longer exposes the shop guest-token endpoint", () => {
    // Retired with the pickup-digits step: its only caller was the shop
    // verification screen, and /guest-orders mints its own token on success.
    const routes = app.routes.map((route) => route.path);
    expect(routes).not.toContain("/guest-token");
  });
});
