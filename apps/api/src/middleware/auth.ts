import { Context, Next } from "hono";
import { verify } from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import type { Env } from "../types/env";
import { ApiError, unauthorized, forbidden } from "../shared/utils/api-error";
import { resolveStaffPrincipal } from "../shared/services/staff-principal";
import { USER_ROLES } from "../shared/constants";

export interface AuthUser {
  id: string;
  publicId?: string;
  username: string;
  role: number;
  restaurantId?: string | number;
  fullName?: string;
  email?: string;
  phone?: string;
}

export interface AuthCustomer {
  id: string;
  displayName: string;
  primaryPhone?: string;
  primaryEmail?: string;
  status: string;
}

interface TokenUserRecord {
  id: string;
  publicId?: string;
  username: string;
  role: number;
  restaurantId?: string;
  isActive: boolean;
  tokenVersion: number;
}

interface AuthTokenPayload {
  id?: string;
  sub?: string;
  username: string;
  role: number;
  exp: number;
  iat?: number;
  nbf?: number;
  tv?: number;
  restaurantId?: string | number | null;
}

interface CustomerAuthTokenPayload {
  sub: string;
  type: "customer";
  exp: number;
  iat?: number;
  nbf?: number;
}

interface CustomerBindingTokenPayload {
  type: "customer_bind";
  exp: number;
  iat?: number;
}

interface SseAuthTokenPayload extends AuthTokenPayload {
  purpose: "kitchen_sse";
  aud: "kitchen_sse";
}

const MAX_ACCESS_TOKEN_AGE_SECONDS = 72 * 60 * 60;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
    customer: AuthCustomer;
  }
}

function isAuthTokenPayload(decoded: unknown): decoded is AuthTokenPayload {
  if (!decoded || typeof decoded !== "object") return false;

  const payload = decoded as Record<string, unknown>;
  const hasPublicId =
    typeof payload.sub === "string" && UUID_V7_PATTERN.test(payload.sub);

  return (
    hasPublicId &&
    typeof payload.username === "string" &&
    payload.username.length > 0 &&
    typeof payload.role === "number" &&
    typeof payload.exp === "number" &&
    (payload.iat === undefined || typeof payload.iat === "number") &&
    (payload.nbf === undefined || typeof payload.nbf === "number") &&
    (payload.tv === undefined || typeof payload.tv === "number") &&
    (payload.restaurantId === undefined ||
      payload.restaurantId === null ||
      typeof payload.restaurantId === "string" ||
      typeof payload.restaurantId === "number")
  );
}

function isCustomerAuthTokenPayload(
  decoded: unknown,
): decoded is CustomerAuthTokenPayload {
  if (!decoded || typeof decoded !== "object") return false;

  const payload = decoded as Record<string, unknown>;
  return (
    typeof payload.sub === "string" &&
    payload.sub.length > 0 &&
    payload.type === "customer" &&
    typeof payload.exp === "number" &&
    (payload.iat === undefined || typeof payload.iat === "number") &&
    (payload.nbf === undefined || typeof payload.nbf === "number")
  );
}

function isCustomerBindingTokenPayload(
  decoded: unknown,
): decoded is CustomerBindingTokenPayload {
  if (!decoded || typeof decoded !== "object") return false;

  const payload = decoded as Record<string, unknown>;
  return (
    payload.type === "customer_bind" &&
    typeof payload.exp === "number" &&
    (payload.iat === undefined || typeof payload.iat === "number")
  );
}

function isSseAuthTokenPayload(
  decoded: unknown,
): decoded is SseAuthTokenPayload {
  if (!isAuthTokenPayload(decoded)) return false;
  const payload = decoded as AuthTokenPayload & {
    purpose?: unknown;
    aud?: unknown;
  };
  return payload.purpose === "kitchen_sse" && payload.aud === "kitchen_sse";
}

function normalizeTokenRestaurantId(
  restaurantId: AuthTokenPayload["restaurantId"],
): string | number | undefined {
  return restaurantId == null ? undefined : restaurantId;
}

export function verifyJwtToken(
  token: string,
  secret: string,
  options: { ignoreExpiration?: boolean; ignoreNotBefore?: boolean } = {},
): JwtPayload | string {
  return verify(token, secret, {
    algorithms: ["HS256"],
    ...options,
  });
}

const DEFER_TIME_CLAIM_VALIDATION = {
  ignoreExpiration: true,
  ignoreNotBefore: true,
} as const;

function isJwtExpiredError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "JwtTokenExpired" || error.name === "TokenExpiredError")
  );
}

function isJwtInvalidError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "JwtTokenInvalid" ||
      error.name === "JsonWebTokenError" ||
      error.name === "NotBeforeError")
  );
}

/**
 * 完整驗證 staff/admin bearer token，回傳可信任的 AuthUser。
 *
 * 這裡是唯一的 staff token 驗證來源：簽章、claim 形狀、時間 claim（exp/iat/nbf
 * 與 token 年齡）、角色上限，以及需要打 DB 的撤銷檢查（isActive、tokenVersion、
 * username/role 漂移）。任何一項失敗都會丟出 ApiError，讓呼叫端自行決定要往外
 * 拋（必須認證的路由）或吞掉並維持匿名（optional 認證的公開路由）。
 *
 * optionalAuth 過去只驗簽章、把時間 claim 一併 defer 掉又從未補驗，導致過期或已
 * 撤銷的 staff token 仍能在公開路由上取得特權身分——共用這個函式就是為了不讓兩條
 * 路徑再次漂移。
 */
async function authenticateStaffToken(
  c: Context<{ Bindings: Env }>,
  token: string,
  maxRole: number,
): Promise<{ user: AuthUser; expiresInSeconds: number }> {
  // 檢查 JWT_SECRET 是否設置且符合安全要求
  if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) {
    console.error(
      "JWT_SECRET is not set or too short (minimum 32 characters required)",
    );
    throw new ApiError(
      "SERVER_CONFIG_ERROR",
      "Server configuration error",
      500,
    );
  }

  // 檢查 token 是否在黑名單中 (如果 KV 可用)
  if (c.env.TOKEN_BLACKLIST) {
    const blacklisted = await c.env.TOKEN_BLACKLIST.get(`token:${token}`);
    if (blacklisted) {
      throw unauthorized("Token has been invalidated", "TOKEN_BLACKLISTED");
    }
  }

  const decoded = verifyJwtToken(
    token,
    c.env.JWT_SECRET,
    DEFER_TIME_CLAIM_VALIDATION,
  );

  if (!isAuthTokenPayload(decoded)) {
    throw unauthorized("Invalid token claims", "TOKEN_INVALID");
  }

  const now = Math.floor(Date.now() / 1000);

  if (decoded.exp <= now) {
    throw unauthorized("Token has expired", "TOKEN_EXPIRED");
  }

  if (decoded.iat && decoded.iat > now + 60) {
    throw unauthorized("Token issued in future", "TOKEN_FUTURE");
  }

  if (decoded.nbf && decoded.nbf > now + 60) {
    throw unauthorized("Token not yet valid", "TOKEN_INVALID");
  }

  if (decoded.role < 0 || decoded.role > maxRole) {
    throw unauthorized("Invalid role in token", "TOKEN_INVALID");
  }

  const tokenAge = now - (decoded.iat || 0);
  if (tokenAge > MAX_ACCESS_TOKEN_AGE_SECONDS) {
    throw unauthorized("Token too old, please refresh", "TOKEN_EXPIRED");
  }

  const userRecord = await loadTokenUser(c, tokenPrincipal(decoded));
  if (!userRecord) {
    throw unauthorized("User not found or inactive", "USER_INACTIVE");
  }

  const tokenVersion = typeof decoded.tv === "number" ? decoded.tv : 1;
  if (!userRecord.isActive) {
    throw unauthorized("User not found or inactive", "USER_INACTIVE");
  }
  if (tokenVersion !== userRecord.tokenVersion) {
    throw unauthorized("Token has been invalidated", "TOKEN_INVALIDATED");
  }
  if (
    userRecord.username !== decoded.username ||
    userRecord.role !== decoded.role
  ) {
    throw unauthorized("Invalid token claims", "TOKEN_INVALID");
  }

  return {
    user: {
      id: userRecord.id,
      publicId: userRecord.publicId ?? tokenPrincipal(decoded),
      username: decoded.username,
      role: decoded.role,
      restaurantId:
        userRecord.restaurantId ??
        normalizeTokenRestaurantId(decoded.restaurantId),
    },
    expiresInSeconds: decoded.exp - now,
  };
}

// JWT 認證中間件工廠。`maxRole` 界定最大可接受的角色值：
// staff/admin 路由使用 4，customer-facing 路由使用 5。
function createAuthMiddleware(maxRole: number) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    try {
      const authHeader = c.req.header("Authorization");

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw unauthorized(
          "Missing or invalid authorization header",
          "MISSING_AUTH_HEADER",
        );
      }

      const token = authHeader.substring(7); // 移除 "Bearer " 前綴

      const { user, expiresInSeconds } = await authenticateStaffToken(
        c,
        token,
        maxRole,
      );

      if (expiresInSeconds < 3600) {
        c.header("X-Token-Refresh-Recommended", "true");
        c.header("X-Token-Expires-In", expiresInSeconds.toString());
      }

      c.set("user", user);

      await next();
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (isJwtExpiredError(error)) {
        throw unauthorized("Token has expired", "TOKEN_EXPIRED");
      }
      if (isJwtInvalidError(error)) {
        throw unauthorized("Invalid token format", "TOKEN_INVALID");
      }
      throw unauthorized("Authentication failed", "TOKEN_INVALID");
    }
  };
}

// Staff/admin 路由的 JWT 認證中間件（只接受 role 0-4）
export const authMiddleware = createAuthMiddleware(4);

// Customer-facing legacy routes still accept user-table JWTs, including role=5.
export const customerAuthMiddleware = createAuthMiddleware(5);
export const staffOrUserCustomerAuthMiddleware = customerAuthMiddleware;

// Canonical customer JWT middleware. Accepts only tokens with
// `{ sub: customers.id, type: "customer" }` and attaches `c.get("customer")`.
export const canonicalCustomerAuthMiddleware = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  try {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw unauthorized(
        "Missing or invalid authorization header",
        "MISSING_AUTH_HEADER",
      );
    }

    const token = authHeader.substring(7);

    if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) {
      console.error(
        "JWT_SECRET is not set or too short (minimum 32 characters required)",
      );
      throw new ApiError(
        "SERVER_CONFIG_ERROR",
        "Server configuration error",
        500,
      );
    }

    if (c.env.TOKEN_BLACKLIST) {
      const blacklisted = await c.env.TOKEN_BLACKLIST.get(`token:${token}`);
      if (blacklisted) {
        throw unauthorized("Token has been invalidated", "TOKEN_BLACKLISTED");
      }
    }

    const decoded = verifyJwtToken(
      token,
      c.env.JWT_SECRET,
      DEFER_TIME_CLAIM_VALIDATION,
    );

    if (isCustomerBindingTokenPayload(decoded)) {
      throw unauthorized(
        "Binding tokens cannot access customer routes",
        "TOKEN_INVALID",
      );
    }

    if (!isCustomerAuthTokenPayload(decoded)) {
      throw unauthorized("Invalid customer token claims", "TOKEN_INVALID");
    }

    const now = Math.floor(Date.now() / 1000);

    if (decoded.exp <= now) {
      throw unauthorized("Token has expired", "TOKEN_EXPIRED");
    }

    if (decoded.iat && decoded.iat > now + 60) {
      throw unauthorized("Token issued in future", "TOKEN_FUTURE");
    }

    if (decoded.nbf && decoded.nbf > now + 60) {
      throw unauthorized("Token not yet valid", "TOKEN_INVALID");
    }

    const customer = await loadTokenCustomer(c, decoded.sub);
    if (!customer) {
      throw unauthorized("Customer not found or inactive", "CUSTOMER_INACTIVE");
    }

    await c.env.DB.prepare(
      `UPDATE customers
          SET last_seen_at_ms = ?, updated_at_ms = ?
        WHERE id = ?`,
    )
      .bind(Date.now(), Date.now(), customer.id)
      .run();

    c.set("customer", customer);

    await next();
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (isJwtExpiredError(error)) {
      throw unauthorized("Token has expired", "TOKEN_EXPIRED");
    }
    if (isJwtInvalidError(error)) {
      throw unauthorized("Invalid token format", "TOKEN_INVALID");
    }
    throw unauthorized("Authentication failed", "TOKEN_INVALID");
  }
};

/**
 * Order creation serves both legacy role-5 accounts and canonical customers.
 * Keep other order management routes on their existing staff/user auth; only
 * the customer order-creation endpoint needs this dual credential boundary.
 */
export const customerOrderAuthMiddleware = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  const authHeader = c.req.header("Authorization");
  let decoded: unknown;
  try {
    if (authHeader?.startsWith("Bearer ")) {
      decoded = verifyJwtToken(
        authHeader.slice(7),
        c.env.JWT_SECRET,
        DEFER_TIME_CLAIM_VALIDATION,
      );
    }
  } catch {
    // The legacy middleware below maps its own invalid token errors.
  }

  if (isCustomerAuthTokenPayload(decoded)) {
    await canonicalCustomerAuthMiddleware(c, async () => undefined);
    const customer = c.get("customer");
    c.set("user", {
      id: customer.id,
      username: customer.primaryPhone || customer.primaryEmail || customer.id,
      role: 5,
    });
    await next();
    return;
  }

  await customerAuthMiddleware(c, next);
};

export const optionalCanonicalCustomerAuthMiddleware = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    await next();
    return;
  }

  try {
    const token = authHeader.substring(7);
    if (c.env.TOKEN_BLACKLIST) {
      const blacklisted = await c.env.TOKEN_BLACKLIST.get(`token:${token}`);
      if (blacklisted) {
        await next();
        return;
      }
    }

    const decoded = verifyJwtToken(
      token,
      c.env.JWT_SECRET,
      DEFER_TIME_CLAIM_VALIDATION,
    );
    if (!isCustomerAuthTokenPayload(decoded)) {
      await next();
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (
      decoded.exp <= now ||
      (decoded.iat && decoded.iat > now + 60) ||
      (decoded.nbf && decoded.nbf > now + 60)
    ) {
      await next();
      return;
    }

    const customer = await loadTokenCustomer(c, decoded.sub);
    if (customer) {
      c.set("customer", customer);
    }
  } catch {
    // Public routes continue to work for anonymous, guest, staff, and invalid
    // tokens. A valid canonical customer token only enriches the request.
  }

  await next();
};

// SSE 認證中間件 — 接受 Authorization header 或 ?sseToken= query param。
// 瀏覽器原生 EventSource 無法帶自訂 header，因此 SSE 客戶端必須走 query param。
export const sseAuthMiddleware = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  try {
    const authHeader = c.req.header("Authorization");
    let token: string | undefined;
    let requiresScopedSseToken = false;

    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else {
      token = c.req.query("sseToken");
      requiresScopedSseToken = true;
    }

    if (!token) {
      throw unauthorized("Missing authentication token", "MISSING_AUTH_TOKEN");
    }

    if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) {
      console.error(
        "JWT_SECRET is not set or too short (minimum 32 characters required)",
      );
      throw new ApiError(
        "SERVER_CONFIG_ERROR",
        "Server configuration error",
        500,
      );
    }

    if (c.env.TOKEN_BLACKLIST) {
      const blacklisted = await c.env.TOKEN_BLACKLIST.get(`token:${token}`);
      if (blacklisted) {
        throw unauthorized("Token has been invalidated", "TOKEN_BLACKLISTED");
      }
    }

    const decoded = verifyJwtToken(
      token,
      c.env.JWT_SECRET,
      DEFER_TIME_CLAIM_VALIDATION,
    );

    if (requiresScopedSseToken) {
      if (!isSseAuthTokenPayload(decoded)) {
        throw unauthorized("Invalid SSE token claims", "TOKEN_INVALID");
      }
    } else if (!isAuthTokenPayload(decoded)) {
      throw unauthorized("Invalid token claims", "TOKEN_INVALID");
    }

    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp <= now) {
      throw unauthorized("Token has expired", "TOKEN_EXPIRED");
    }

    const userRecord = await loadTokenUser(c, tokenPrincipal(decoded));
    if (!userRecord) {
      if (decoded.sub) {
        throw unauthorized("User not found or inactive", "USER_INACTIVE");
      }
      if (c.env.NODE_ENV === "production") {
        throw unauthorized("User not found or inactive", "USER_INACTIVE");
      }
    } else {
      const tokenVersion = typeof decoded.tv === "number" ? decoded.tv : 1;
      if (!userRecord.isActive) {
        throw unauthorized("User not found or inactive", "USER_INACTIVE");
      }
      if (tokenVersion !== userRecord.tokenVersion) {
        throw unauthorized("Token has been invalidated", "TOKEN_INVALIDATED");
      }
      if (
        userRecord.username !== decoded.username ||
        userRecord.role !== decoded.role
      ) {
        throw unauthorized("Invalid token claims", "TOKEN_INVALID");
      }
    }

    c.set("user", {
      id: userRecord?.id ?? tokenPrincipal(decoded),
      publicId: userRecord?.publicId ?? tokenPrincipal(decoded),
      username: decoded.username,
      role: decoded.role,
      restaurantId:
        userRecord?.restaurantId ??
        normalizeTokenRestaurantId(decoded.restaurantId),
    });

    await next();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isJwtExpiredError(error)) {
      throw unauthorized("Token has expired", "TOKEN_EXPIRED");
    }
    if (isJwtInvalidError(error)) {
      throw unauthorized("Invalid token format", "TOKEN_INVALID");
    }
    throw unauthorized("Authentication failed", "TOKEN_INVALID");
  }
};

async function loadTokenUser(
  c: Context<{ Bindings: Env }>,
  principalId: string,
): Promise<TokenUserRecord | null> {
  try {
    const principal = await resolveStaffPrincipal(c.env.DB, principalId, {
      requireActive: false,
    });
    return {
      id: principal.id,
      publicId: principal.publicUserId,
      username: principal.username,
      role: principal.role,
      restaurantId: principal.restaurantId,
      isActive: principal.isActive,
      tokenVersion: principal.tokenVersion,
    };
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === "STAFF_PRINCIPAL_NOT_FOUND"
    ) {
      return null;
    }
    if (c.env.NODE_ENV !== "production") return null;
    throw error;
  }
}

function tokenPrincipal(decoded: AuthTokenPayload): string {
  return decoded.sub ?? decoded.id!;
}

async function loadTokenCustomer(
  c: Context<{ Bindings: Env }>,
  customerId: string,
): Promise<AuthCustomer | null> {
  let row: {
    id: string;
    display_name: string;
    primary_phone: string | null;
    primary_email: string | null;
    status: string;
  } | null;

  try {
    row = await c.env.DB.prepare(
      `SELECT id, display_name, primary_phone, primary_email, status
         FROM customers
        WHERE id = ?
          AND status = 'active'
        LIMIT 1`,
    )
      .bind(customerId)
      .first<{
        id: string;
        display_name: string;
        primary_phone: string | null;
        primary_email: string | null;
        status: string;
      }>();
  } catch (error) {
    if (c.env.NODE_ENV !== "production") return null;
    throw error;
  }

  if (!row) return null;

  return {
    id: row.id,
    displayName: row.display_name,
    primaryPhone: row.primary_phone ?? undefined,
    primaryEmail: row.primary_email ?? undefined,
    status: row.status,
  };
}

// 角色權限檢查中間件
export const requireRole = (allowedRoles: number[]) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const user = c.get("user");

    if (!user) {
      throw unauthorized("Authentication required", "UNAUTHORIZED");
    }

    if (!allowedRoles.includes(user.role)) {
      throw forbidden("Insufficient permissions", "INSUFFICIENT_ROLE");
    }

    // Roles 1–4 are restaurant-scoped staff accounts. Reject malformed or
    // incomplete identities at the authorization boundary so they cannot be
    // mistaken for platform-wide administrators by downstream handlers.
    if (
      user.role >= USER_ROLES.OWNER &&
      user.role <= USER_ROLES.CASHIER &&
      !String(user.restaurantId ?? "").trim()
    ) {
      throw forbidden("Restaurant assignment required", "FORBIDDEN");
    }

    await next();
  };
};

// 餐廳存取權限檢查
export const requireRestaurantAccess = (
  restaurantIdParam: string = "restaurantId",
) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const user = c.get("user");
    const restaurantId = c.req.param(restaurantIdParam);

    if (!user) {
      throw unauthorized("Authentication required", "UNAUTHORIZED");
    }

    // Independent（自架單租戶）部署只授權給一家餐廳，任何請求
    // ——包含 admin——都必須對應到部署設定的 TENANT_ID，不受角色影響。
    if (c.env.DEPLOYMENT_MODE === "independent") {
      if (!c.env.TENANT_ID || restaurantId !== c.env.TENANT_ID) {
        throw forbidden("Access denied to this restaurant", "FORBIDDEN");
      }
      await next();
      return;
    }

    // 管理員可以存取所有餐廳
    if (user.role === 0) {
      await next();
      return;
    }

    // 檢查是否有餐廳存取權限
    if (!user.restaurantId || String(user.restaurantId) !== restaurantId) {
      throw forbidden("Access denied to this restaurant", "FORBIDDEN");
    }

    await next();
  };
};

// Token 黑名單管理
export const blacklistToken = async (
  c: Context<{ Bindings: Env }>,
  token: string,
  expiryTime?: number,
) => {
  if (c.env.TOKEN_BLACKLIST) {
    // 計算 TTL - 使用 token 的剩餘過期時間
    let ttl: number | undefined;
    if (expiryTime) {
      const now = Math.floor(Date.now() / 1000);
      ttl = Math.max(0, expiryTime - now);
    }

    await c.env.TOKEN_BLACKLIST.put(
      `token:${token}`,
      "blacklisted",
      ttl ? { expirationTtl: ttl } : undefined,
    );
  }
};

// 可選認證中間件（用於公開 API）。
//
// 「可選」只代表缺少或無效的 token 不會讓請求失敗——不代表驗證可以放寬。一旦
// 附上 staff token 就必須通過與 authMiddleware 完全相同的檢查，否則過期或已撤銷
// 的 token 會在公開路由上換到特權身分（例如 menu 的 includeAll）。驗不過就維持
// 匿名，而不是帶著半信任的身分往下走。
export const optionalAuth = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  const authHeader = c.req.header("Authorization");

  if (authHeader?.startsWith("Bearer ")) {
    try {
      const { user } = await authenticateStaffToken(
        c,
        authHeader.substring(7),
        USER_ROLES.CUSTOMER,
      );
      c.set("user", user);
    } catch {
      // 公開路由對匿名、customer、以及無效／過期／已撤銷的 token 一律維持匿名。
    }
  }

  await next();
};

// 別名為了向後兼容
export const requireAuth = authMiddleware;
