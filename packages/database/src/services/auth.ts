import * as bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { JwtPayload } from "jsonwebtoken";
import { sign, verify } from "jsonwebtoken";
import { sessions, users } from "../schema";
import { BaseService } from "./base";

export interface LoginData {
  username: string;
  password: string;
  deviceInfo?: {
    userAgent?: string;
    ipAddress?: string;
    platform?: string;
    deviceType?: string;
    browser?: string;
    version?: string;
  };
  location?: {
    country?: string;
    city?: string;
    coordinates?: { lat: number; lng: number };
  };
}

export interface RegisterData {
  username: string;
  email?: string;
  phone?: string;
  fullName: string;
  password: string;
  role: number;
  restaurantId?: string | null;
}

interface AuthTokenPayload extends JwtPayload {
  userId?: string;
  sub?: string;
  type?: string;
  tv?: number;
}

function normalizeTokenVersion(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 1;
}

function accessTokenPayload(user: TokenUser, tokenVersion: number) {
  return {
    sub: user.id,
    username: user.username,
    role: user.role,
    restaurantId: user.restaurantId,
    tv: tokenVersion,
    jti: crypto.randomUUID(),
  };
}

// Refresh tokens carry `tv` for the same reason access tokens do, but it
// matters more here: a refresh token lives 7 days against the access token's 1
// hour, so it is the credential that actually outlives a password reset. See
// the version check in refreshToken() for how an absent claim is treated.
function refreshTokenPayload(user: TokenUser, tokenVersion: number) {
  return {
    sub: user.id,
    type: "refresh",
    tv: tokenVersion,
    jti: crypto.randomUUID(),
  };
}

function refreshTokenPrincipal(
  payload: AuthTokenPayload,
): RefreshTokenPrincipal | null {
  if (typeof payload.sub === "string" && payload.sub.length > 0) {
    return { userId: payload.sub };
  }
  return null;
}

const verifyAuthToken = (token: string, secret: string): AuthTokenPayload => {
  const decoded = verify(token, secret, { algorithms: ["HS256"] });
  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }

  return decoded as AuthTokenPayload;
};

const ACCESS_TOKEN_TTL_HOURS = 1;
const ACCESS_TOKEN_TTL_MS = ACCESS_TOKEN_TTL_HOURS * 60 * 60 * 1000;
const ACCESS_TOKEN_EXPIRES_IN = `${ACCESS_TOKEN_TTL_HOURS}h`;

type TokenUser = {
  id: string;
  username: string;
  fullName: string;
  role: number;
  restaurantId: string | null;
  isActive: boolean;
  tokenVersion?: number;
};

type RefreshTokenPrincipal = { userId: string };

type ValidatedTokenUser = Pick<
  typeof users.$inferSelect,
  | "id"
  | "username"
  | "fullName"
  | "role"
  | "restaurantId"
  | "isActive"
  | "tokenVersion"
> & { publicId: (typeof users.$inferSelect)["id"] };

type UserSessionSummary = Pick<
  typeof sessions.$inferSelect,
  | "id"
  | "deviceInfo"
  | "ipAddress"
  | "location"
  | "lastAccessedAt"
  | "expiresAt"
  | "createdAt"
>;

export interface SessionData {
  userId: string;
  token: string;
  refreshToken?: string;
  userAgent?: string;
  ipAddress?: string;
  deviceInfo?: typeof sessions.$inferInsert.deviceInfo;
  location?: typeof sessions.$inferInsert.location;
  expiresAt: Date;
}

/**
 * Why an auth attempt failed, in a form callers can branch on.
 *
 * The route layer used to recover this by substring-matching the English
 * `error` text (`message.includes("locked")`), which coupled control flow to
 * product copy: rewording a message silently changed the error code, and a
 * message that merely contained the substring -- "Already clocked in" contains
 * "locked" -- would have matched by accident. Callers read this instead.
 */
export type AuthFailureReason =
  | "invalid_credentials"
  | "customer_password_login_retired"
  | "customer_password_registration_retired"
  | "username_taken"
  | "weak_password";

export interface AuthResult {
  success: boolean;
  /** Set on every failure path; absent on success. */
  reason?: AuthFailureReason;
  user?: {
    id: string;
    publicId?: string | null;
    username: string;
    fullName: string;
    role: number;
    restaurantId: string | null;
    isActive: boolean;
    tokenVersion?: number;
  };
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  };
  error?: string;
}

export class AuthService extends BaseService {
  // 用戶登入
  // Failed-attempt lockout is NOT handled here. The only caller is the
  // feature-layer AuthService, whose checkRateLimit/logFailedLoginAttempt pair
  // already enforces a strictly wider version of the same control: 5 failures
  // per username and 10 per IP (and per username+IP), all on a 15 minute TTL.
  // This service used to keep its own `login_fail:<username>` counter with an
  // identical 5-per-15-minutes rule, which cost an extra KV read on every login
  // plus a write on every outcome while changing no decision.
  async login(data: LoginData): Promise<AuthResult> {
    try {
      // 查詢活躍用戶 - Using sql`` to match actual database schema
      const user = await this.db
        .select({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          passwordHash: users.passwordHash,
          role: users.role,
          restaurantId: users.restaurantId,
          isActive: users.isActive,
          tokenVersion: users.tokenVersion,
        })
        .from(users)
        // Archived staff are barred here as well as by isActive: the two are
        // set together on departure, but a login must not turn on one of them
        // staying in step with the other (#337).
        .where(
          and(
            eq(users.username, data.username),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        )
        .get();

      if (!user) {
        return {
          success: false,
          reason: "invalid_credentials",
          error: "Invalid username or password",
        };
      }

      if (user.role === 5) {
        return {
          success: false,
          reason: "customer_password_login_retired",
          error:
            "Customer password login is retired. Use phone OTP customer authentication.",
        };
      }

      // 驗證密碼
      const isPasswordValid = await bcrypt.compare(
        data.password,
        user.passwordHash,
      );
      if (!isPasswordValid) {
        return {
          success: false,
          reason: "invalid_credentials",
          error: "Invalid username or password",
        };
      }

      // 生成 JWT tokens
      const jwtSecret = this.env.JWT_SECRET;
      if (!jwtSecret || jwtSecret.length < 32) {
        throw new Error(
          "JWT_SECRET must be set and at least 32 characters for security",
        );
      }
      const accessTokenExpiry = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
      const tokenVersion = normalizeTokenVersion(user.tokenVersion);

      const accessToken = sign(
        accessTokenPayload(user, tokenVersion),
        jwtSecret,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
      );

      const refreshToken = sign(
        refreshTokenPayload(user, tokenVersion),
        jwtSecret,
        { expiresIn: "7d" },
      );

      // Keep valid sessions on other devices: a successful login mints a new
      // token pair, which prevents fixation for this login without disrupting
      // an active POS, KDS, or mobile session for the same staff account.
      //
      // D1 runs this three-write batch as one ordered transaction. The expired
      // session sweep must precede the insert so it cannot touch the session we
      // are creating.
      const now = new Date();
      const writes: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
        this.db
          .delete(sessions)
          .where(
            and(lt(sessions.expiresAt, now), eq(sessions.userId, user.id)),
          ) as BatchItem<"sqlite">,
        this.db.insert(sessions).values({
          id: crypto.randomUUID(),
          userId: user.id,
          token: accessToken,
          refreshToken,
          userAgent: data.deviceInfo?.userAgent,
          ipAddress: data.deviceInfo?.ipAddress,
          deviceInfo: data.deviceInfo,
          location: data.location,
          expiresAt: accessTokenExpiry,
          isActive: true,
        }) as BatchItem<"sqlite">,
        this.db
          .update(users)
          .set({ lastLoginAt: now, updatedAt: now })
          .where(eq(users.id, user.id)) as BatchItem<"sqlite">,
      ];

      await this.db.batch(writes);

      return {
        success: true,
        user: {
          id: user.id,
          publicId: user.id,
          username: user.username,
          fullName: user.fullName,
          role: user.role,
          restaurantId: user.restaurantId,
          isActive: user.isActive,
          tokenVersion: user.tokenVersion,
        },
        tokens: {
          accessToken,
          refreshToken,
          expiresAt: accessTokenExpiry,
        },
      };
    } catch (error) {
      this.handleError(error, "login");
    }
  }

  // 用戶註冊
  async register(data: RegisterData): Promise<AuthResult> {
    try {
      if (data.role === 5) {
        return {
          success: false,
          reason: "customer_password_registration_retired",
          error:
            "Customer password registration is retired. Use phone OTP customer authentication.",
        };
      }

      // 檢查用戶名是否已存在
      const existingUser = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, data.username))
        .get();

      if (existingUser) {
        return {
          success: false,
          reason: "username_taken",
          error: "Username already exists",
        };
      }

      // 驗證密碼強度（根據角色使用不同的驗證規則）
      const isCustomer = data.role === 5;
      const passwordValidation = this.validatePasswordStrength(
        data.password,
        isCustomer,
      );
      if (!passwordValidation.valid) {
        return {
          success: false,
          reason: "weak_password",
          error: passwordValidation.error,
        };
      }

      // 加密密碼
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(data.password, saltRounds);

      // 創建新用戶
      const [newUser] = await this.db
        .insert(users)
        .values({
          username: data.username,
          email: data.email,
          phone: data.phone,
          fullName: data.fullName,
          passwordHash,
          role: data.role,
          restaurantId: data.restaurantId,
          isActive: true,
          isVerified: false,
        })
        .returning({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          role: users.role,
          restaurantId: users.restaurantId,
        });

      return {
        success: true,
        user: {
          id: newUser.id,
          publicId: newUser.id,
          username: newUser.username,
          fullName: newUser.fullName,
          role: newUser.role,
          restaurantId: newUser.restaurantId,
          isActive: true,
        },
      };
    } catch (error) {
      this.handleError(error, "register");
    }
  }

  // 刷新 token
  async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      const jwtSecret = this.env.JWT_SECRET;
      if (!jwtSecret || jwtSecret.length < 32) {
        throw new Error(
          "JWT_SECRET must be set and at least 32 characters for security",
        );
      }

      // 驗證 refresh token
      const decoded = verifyAuthToken(refreshToken, jwtSecret);

      if (decoded.type !== "refresh") {
        return {
          success: false,
          error: "Invalid refresh token",
        };
      }
      const refreshPrincipal = refreshTokenPrincipal(decoded);
      if (!refreshPrincipal) {
        return {
          success: false,
          error: "Invalid refresh token payload",
        };
      }

      const user = await this.loadActiveUserForToken(refreshPrincipal);
      if (!user) {
        return {
          success: false,
          error: "User not found or inactive",
        };
      }

      const tokenVersion = normalizeTokenVersion(user.tokenVersion);
      // Defence in depth behind the session deactivation that password resets,
      // role changes and deactivations perform: if a `sessions` row is ever
      // missed, the version claim still stops the refresh.
      //
      // An absent `tv` normalizes to 1, which is exactly the value a token
      // minted before this claim existed would have carried — `token_version`
      // defaults to 1 and only ever increments. So the default is not a bypass:
      // every revocation event has already pushed the row past 1, and a legacy
      // token is rejected the moment it matters. Failing closed on the absent
      // claim instead would log out every staff member holding a pre-deploy
      // refresh token, up to 7 days' worth, to reject tokens this comparison
      // already rejects.
      if (normalizeTokenVersion(decoded.tv) !== tokenVersion) {
        return {
          success: false,
          error: "Refresh token has been invalidated",
        };
      }

      // 查詢 session (only select needed fields for security and performance)
      const session = await this.db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          token: sessions.token,
          refreshToken: sessions.refreshToken,
          expiresAt: sessions.expiresAt,
          isActive: sessions.isActive,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, user.id),
            eq(sessions.refreshToken, refreshToken),
            eq(sessions.isActive, true),
          ),
        )
        .get();

      if (!session) {
        return {
          success: false,
          error: "Session not found or expired",
        };
      }

      // 生成新的 access token
      const accessTokenExpiry = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
      const accessToken = sign(
        accessTokenPayload(user, tokenVersion),
        jwtSecret,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
      );
      const nextRefreshToken = sign(
        refreshTokenPayload(user, tokenVersion),
        jwtSecret,
        { expiresIn: "7d" },
      );

      // 更新 session
      await this.db
        .update(sessions)
        .set({
          token: accessToken,
          refreshToken: nextRefreshToken,
          lastAccessedAt: new Date(),
          expiresAt: accessTokenExpiry,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, session.id));

      return {
        success: true,
        user,
        tokens: {
          accessToken,
          refreshToken: nextRefreshToken,
          expiresAt: accessTokenExpiry,
        },
      };
    } catch {
      return {
        success: false,
        error: "Invalid refresh token",
      };
    }
  }

  private async loadActiveUserForToken(
    principal: RefreshTokenPrincipal,
  ): Promise<TokenUser | undefined> {
    const where = eq(users.id, principal.userId);

    return await this.db
      .select({
        id: users.id,
        publicId: users.id,
        username: users.username,
        fullName: users.fullName,
        role: users.role,
        restaurantId: users.restaurantId,
        isActive: users.isActive,
        tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(and(where, eq(users.isActive, true), isNull(users.deletedAt)))
      .get();
  }

  // 創建 session
  async createSession(data: SessionData): Promise<void> {
    try {
      // 清理該用戶的過期 sessions
      await this.cleanupExpiredSessions(data.userId);

      // 生成 session ID
      const sessionId = crypto.randomUUID();

      await this.db.insert(sessions).values({
        id: sessionId,
        userId: data.userId,
        token: data.token,
        refreshToken: data.refreshToken,
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
        deviceInfo: data.deviceInfo,
        location: data.location,
        expiresAt: data.expiresAt,
        isActive: true,
      });
    } catch (error) {
      this.handleError(error, "createSession");
    }
  }

  // 登出（使 session 失效）
  async logout(userId: string, token?: string): Promise<boolean> {
    try {
      const conditions = [eq(sessions.userId, userId)];
      if (token) {
        conditions.push(eq(sessions.token, token));
      }

      await this.db
        .update(sessions)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(and(...conditions));

      return true;
    } catch (error) {
      this.handleError(error, "logout");
      return false;
    }
  }

  // 驗證 token 並取得用戶資訊
  async validateToken(
    token: string,
  ): Promise<{ valid: boolean; user?: ValidatedTokenUser; error?: string }> {
    try {
      const jwtSecret = this.env.JWT_SECRET;
      if (!jwtSecret || jwtSecret.length < 32) {
        throw new Error(
          "JWT_SECRET must be set and at least 32 characters for security",
        );
      }

      // 驗證 JWT
      const decoded = verifyAuthToken(token, jwtSecret);
      if (typeof decoded.sub !== "string") {
        return { valid: false, error: "Invalid token payload" };
      }

      // 查詢 session 是否有效 (only select needed fields for security and performance)
      const session = await this.db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          token: sessions.token,
          expiresAt: sessions.expiresAt,
          isActive: sessions.isActive,
          lastAccessedAt: sessions.lastAccessedAt,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.token, token),
            eq(sessions.isActive, true),
            gt(sessions.expiresAt, new Date()),
          ),
        )
        .get();

      if (!session) {
        return { valid: false, error: "Session expired or invalid" };
      }

      // 查詢用戶
      const user = await this.db
        .select({
          id: users.id,
          publicId: users.id,
          username: users.username,
          fullName: users.fullName,
          role: users.role,
          restaurantId: users.restaurantId,
          isActive: users.isActive,
          tokenVersion: users.tokenVersion,
        })
        .from(users)
        .where(
          and(
            eq(users.id, session.userId),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        )
        .get();

      if (!user) {
        return { valid: false, error: "User not found or inactive" };
      }
      if (decoded.sub !== user.id) {
        return { valid: false, error: "Invalid token payload" };
      }

      const tokenVersion = typeof decoded.tv === "number" ? decoded.tv : 1;
      if (tokenVersion !== normalizeTokenVersion(user.tokenVersion)) {
        return { valid: false, error: "Token invalidated" };
      }

      // 更新最後訪問時間
      await this.db
        .update(sessions)
        .set({
          lastAccessedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, session.id));

      return { valid: true, user };
    } catch {
      return { valid: false, error: "Invalid token" };
    }
  }

  // 清理過期的 sessions
  async cleanupExpiredSessions(userId?: string): Promise<number> {
    try {
      const conditions = [lt(sessions.expiresAt, new Date())];
      if (userId) {
        conditions.push(eq(sessions.userId, userId));
      }

      const result = await this.db
        .delete(sessions)
        .where(and(...conditions))
        .returning({ id: sessions.id });

      return result.length;
    } catch (error) {
      console.error("Cleanup sessions error:", error);
      return 0;
    }
  }

  // 取得用戶的活躍 sessions
  async getUserSessions(userId: string): Promise<UserSessionSummary[]> {
    try {
      return await this.db
        .select({
          id: sessions.id,
          deviceInfo: sessions.deviceInfo,
          ipAddress: sessions.ipAddress,
          location: sessions.location,
          lastAccessedAt: sessions.lastAccessedAt,
          expiresAt: sessions.expiresAt,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), eq(sessions.isActive, true)))
        .orderBy(desc(sessions.lastAccessedAt));
    } catch (error) {
      this.handleError(error, "getUserSessions");
    }
  }

  // 更改密碼
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 取得用戶當前密碼
      const user = await this.db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId))
        .get();

      if (!user) {
        return { success: false, error: "User not found" };
      }

      // 驗證舊密碼
      const isOldPasswordValid = await bcrypt.compare(
        oldPassword,
        user.passwordHash,
      );
      if (!isOldPasswordValid) {
        return { success: false, error: "Current password is incorrect" };
      }

      // 驗證新密碼強度
      const passwordValidation = this.validatePasswordStrength(newPassword);
      if (!passwordValidation.valid) {
        return { success: false, error: passwordValidation.error };
      }

      // 加密新密碼
      const saltRounds = 10;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      // 更新密碼
      await this.db
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          passwordChangedAt: new Date(),
          tokenVersion: sql`${users.tokenVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      // Revoke every session, including the one that initiated the change.
      await this.db
        .update(sessions)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(sessions.userId, userId));

      return { success: true };
    } catch {
      return { success: false, error: "Failed to change password" };
    }
  }

  // 驗證密碼強度
  private validatePasswordStrength(
    password: string,
    isCustomer: boolean = false,
  ): { valid: boolean; error?: string } {
    // Maximum 128 characters (prevent DoS via bcrypt)
    if (password.length > 128) {
      return {
        valid: false,
        error: "Password must not exceed 128 characters",
      };
    }

    // For customers: relaxed password requirements (6+ characters, no complexity)
    if (isCustomer) {
      if (password.length < 6) {
        return {
          valid: false,
          error: "Password must be at least 6 characters long",
        };
      }
      return { valid: true };
    }

    // For staff: strict password requirements (8+ characters with complexity)
    // Minimum 8 characters
    if (password.length < 8) {
      return {
        valid: false,
        error: "Password must be at least 8 characters long",
      };
    }

    // Must contain at least one uppercase letter
    if (!/[A-Z]/.test(password)) {
      return {
        valid: false,
        error: "Password must contain at least one uppercase letter",
      };
    }

    // Must contain at least one lowercase letter
    if (!/[a-z]/.test(password)) {
      return {
        valid: false,
        error: "Password must contain at least one lowercase letter",
      };
    }

    // Must contain at least one number
    if (!/[0-9]/.test(password)) {
      return {
        valid: false,
        error: "Password must contain at least one number",
      };
    }

    // Must contain at least one special character
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      return {
        valid: false,
        error: "Password must contain at least one special character",
      };
    }

    // Check for common weak passwords
    const commonPasswords = [
      "password",
      "password123",
      "12345678",
      "qwerty123",
      "admin123",
      "letmein",
      "welcome123",
      "abc12345",
    ];
    if (commonPasswords.includes(password.toLowerCase())) {
      return {
        valid: false,
        error: "Password is too common. Please choose a stronger password",
      };
    }

    return { valid: true };
  }
}
