import { Context, Next } from "hono";
import { verify } from "hono/jwt";
import type { Env } from "../types/env";
import { createDatabase, eq, images } from "@makanmasak/database";

export interface AuthUser {
  id: string;
  username: string;
  role: number;
  restaurantId?: string;
}

type JwtAuthPayload = {
  id: string;
  username: string;
  role: number;
  restaurantId?: string;
  tokenVersion: number;
  exp?: number;
  iat?: number;
  nbf?: number;
};

// Main-API access tokens carry the user id in `sub` as a UUID v7 string and
// restaurantId as a string UUID (see packages/database/src/services/auth.ts
// accessTokenPayload / apps/api/src/middleware/auth.ts isAuthTokenPayload).
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const toJwtAuthPayload = (
  payload: Record<string, unknown>,
): JwtAuthPayload | null => {
  if (
    typeof payload.sub !== "string" ||
    !UUID_V7_PATTERN.test(payload.sub) ||
    typeof payload.username !== "string" ||
    payload.username.length === 0 ||
    typeof payload.role !== "number" ||
    (payload.restaurantId !== undefined &&
      payload.restaurantId !== null &&
      (typeof payload.restaurantId !== "string" ||
        !UUID_V7_PATTERN.test(payload.restaurantId)))
  ) {
    return null;
  }

  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
    restaurantId:
      payload.restaurantId == null ? undefined : payload.restaurantId,
    tokenVersion: typeof payload.tv === "number" ? payload.tv : 1,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    nbf: typeof payload.nbf === "number" ? payload.nbf : undefined,
  };
};

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

// Unified error body: { success:false, error:{ code, message } }. The only
// client (admin-dashboard useImageUpload) checks response.ok, not the body.
const authFailure = (
  c: Context<{ Bindings: Env }>,
  status: 401 | 403 | 500 | 503,
  code: string,
  message: string,
) => c.json({ success: false, error: { code, message } }, status);

// JWT 認證中間件
export const authMiddleware = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  try {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return authFailure(
        c,
        401,
        "MISSING_AUTH_HEADER",
        "Missing or invalid authorization header",
      );
    }

    const token = authHeader.substring(7); // 移除 "Bearer " 前綴

    // 檢查 JWT_SECRET 是否設置且符合安全要求
    if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) {
      console.error(
        "JWT_SECRET is not set or too short (minimum 32 characters required)",
      );
      return authFailure(
        c,
        500,
        "SERVER_CONFIG_ERROR",
        "Server configuration error",
      );
    }

    // Verify first: KV keys over 512 bytes throw, so a garbage token must
    // never reach the blacklist lookup. Anything verify() throws is a verdict
    // on the token, not only Jwt* errors: hono reads payload claims before the
    // signature, so a payload of `null` throws a plain TypeError.
    let decoded: Awaited<ReturnType<typeof verify>>;
    try {
      decoded = await verify(token, c.env.JWT_SECRET, "HS256");
    } catch (error) {
      const expired =
        error instanceof Error && error.name === "JwtTokenExpired";
      return expired
        ? authFailure(c, 401, "TOKEN_EXPIRED", "Token has expired")
        : authFailure(c, 401, "TOKEN_INVALID", "Invalid token format");
    }

    // 檢查 token 是否在黑名單中 (如果 KV 可用)
    if (c.env.TOKEN_BLACKLIST) {
      const blacklisted = await c.env.TOKEN_BLACKLIST.get(`token:${token}`);
      if (blacklisted) {
        return authFailure(
          c,
          401,
          "TOKEN_BLACKLISTED",
          "Token has been invalidated",
        );
      }
    }

    if (!decoded || typeof decoded !== "object") {
      return authFailure(c, 401, "TOKEN_INVALID", "Invalid token");
    }
    const decodedPayload = decoded as Record<string, unknown>;
    const exp =
      typeof decodedPayload.exp === "number" ? decodedPayload.exp : undefined;
    const iat =
      typeof decodedPayload.iat === "number" ? decodedPayload.iat : undefined;
    const nbf =
      typeof decodedPayload.nbf === "number" ? decodedPayload.nbf : undefined;

    // Enhanced JWT validation checks
    const now = Math.floor(Date.now() / 1000);

    // Check token expiration
    if (!exp || exp <= now) {
      return authFailure(c, 401, "TOKEN_EXPIRED", "Token has expired");
    }

    // Check token issued at time (prevent future tokens)
    if (iat && iat > now + 60) {
      // Allow 60 second clock skew
      return authFailure(c, 401, "TOKEN_INVALID", "Token issued in future");
    }

    // Check not before claim
    if (nbf && nbf > now + 60) {
      // Allow 60 second clock skew
      return authFailure(c, 401, "TOKEN_INVALID", "Token not yet valid");
    }

    // Validate required claims
    const authPayload = toJwtAuthPayload(decodedPayload);
    if (!authPayload) {
      return authFailure(c, 401, "TOKEN_INVALID", "Invalid token claims");
    }

    // Validate role is within expected range (0-4)
    if (authPayload.role < 0 || authPayload.role > 4) {
      return authFailure(c, 401, "TOKEN_INVALID", "Invalid role in token");
    }

    // Check token age — aligned with the main API's 72h ceiling
    // (MAX_ACCESS_TOKEN_AGE_SECONDS in apps/api/src/middleware/auth.ts)
    const tokenAge = now - (iat || 0);
    const maxTokenAge = 72 * 60 * 60;
    if (tokenAge > maxTokenAge) {
      return authFailure(
        c,
        401,
        "TOKEN_EXPIRED",
        "Token too old, please refresh",
      );
    }

    // Check if token is about to expire (recommend refresh within 1 hour)
    const timeUntilExpiry = exp - now;
    if (timeUntilExpiry < 3600) {
      // 1 hour
      c.header("X-Token-Refresh-Recommended", "true");
      c.header("X-Token-Expires-In", timeUntilExpiry.toString());
    }

    const principal = await c.env.DB.prepare(
      "SELECT id, username, role, restaurant_id, is_active, token_version, admin_tier FROM users WHERE id = ? LIMIT 1",
    )
      .bind(authPayload.id)
      .first<{
        id: string;
        username: string;
        role: number;
        restaurant_id: string | null;
        is_active: number;
        token_version: number;
        admin_tier: string | null;
      }>();
    if (
      !principal ||
      principal.is_active !== 1 ||
      principal.username !== authPayload.username ||
      principal.role !== authPayload.role ||
      principal.token_version !== authPayload.tokenVersion
    ) {
      return authFailure(c, 401, "TOKEN_INVALID", "Invalid or revoked token");
    }
    const session = await c.env.DB.prepare(
      "SELECT id FROM sessions WHERE user_id = ? AND token = ? AND is_active = 1 AND expires_at_ms > ? LIMIT 1",
    )
      .bind(principal.id, token, Date.now())
      .first();
    if (!session) {
      return authFailure(c, 401, "TOKEN_INVALID", "Invalid or revoked session");
    }
    // Support admins are read-only here as on the platform API
    // (apps/api/src/middleware/auth.ts); every write route here uses this
    // middleware, so the check lives once, in it.
    if (
      principal.role === 0 &&
      principal.admin_tier === "support" &&
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method)
    ) {
      return authFailure(
        c,
        403,
        "ADMIN_TIER_READ_ONLY",
        "Support admins have read-only access",
      );
    }
    c.set("user", {
      id: principal.id,
      username: principal.username,
      role: principal.role,
      restaurantId: principal.restaurant_id ?? undefined,
    });
  } catch (error) {
    // hono/jwt throws Jwt* errors for every token verdict; anything else
    // (D1/KV outage) is infrastructure, not the caller's fault.
    const name =
      error && typeof error === "object" && "name" in error
        ? String(error.name)
        : "";
    if (name === "JwtTokenExpired") {
      return authFailure(c, 401, "TOKEN_EXPIRED", "Token has expired");
    }
    if (name.startsWith("Jwt")) {
      return authFailure(c, 401, "TOKEN_INVALID", "Invalid token format");
    }
    console.error("Auth backend failure:", error);
    return authFailure(
      c,
      503,
      "AUTH_BACKEND_UNAVAILABLE",
      "Authentication service temporarily unavailable",
    );
  }

  // Outside the try: a downstream failure is not an authentication verdict.
  await next();
};

// 可選認證中間件（用於公開API）
export const optionalAuth = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  // Use the same signature, time, live-principal and session checks as required auth.
  // A failed optional login remains anonymous; downstream handlers run once.
  // A token verdict (401) stays anonymous; a backend outage must not.
  const failure = await authMiddleware(c, async () => {});
  if (failure instanceof Response && failure.status === 503) return failure;
  await next();
};

// 角色權限檢查中間件
export const requireRole = (allowedRoles: number[]) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const user = c.get("user");

    if (!user) {
      return c.json(
        {
          success: false,
          error: "Authentication required",
        },
        401,
      );
    }

    if (!allowedRoles.includes(user.role)) {
      return c.json(
        {
          success: false,
          error: "Insufficient permissions",
        },
        403,
      );
    }

    await next();
  };
};

// API Key 認證中間件（用於服務間通信）
export const apiKeyAuth = async (c: Context<{ Bindings: Env }>, next: Next) => {
  try {
    const apiKey = c.req.header("X-API-Key");

    if (!apiKey) {
      return c.json(
        {
          success: false,
          error: "API key required",
        },
        401,
      );
    }

    // 在實際應用中，應該從數據庫或配置中驗證API key
    // 這裡使用環境變量作為示例
    if (!c.env.API_KEY || c.env.API_KEY.length < 32) {
      console.error("API_KEY is not set or too short");
      return c.json(
        { success: false, error: "Server configuration error" },
        500,
      );
    }

    const validApiKey = c.env.API_KEY;

    if (apiKey !== validApiKey) {
      return c.json(
        {
          success: false,
          error: "Invalid API key",
        },
        401,
      );
    }

    await next();
  } catch (error) {
    console.error("API key auth error:", error);
    return c.json(
      {
        success: false,
        error: "API key authentication failed",
      },
      401,
    );
  }
};

// 圖片存取權限檢查
export const checkImageAccess = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  try {
    const user = c.get("user");
    const imageId = c.req.param("imageId") || c.req.param("id");

    if (!imageId) {
      return c.json(
        {
          success: false,
          error: "Image ID required",
        },
        400,
      );
    }

    // 如果用戶是管理員，允許存取所有圖片
    if (user && user.role === 0) {
      await next();
      return;
    }

    // 檢查圖片是否屬於用戶的餐廳 - Use Drizzle ORM
    const db = createDatabase(c.env.DB);
    const imageResults = await db
      .select({
        restaurant_id: images.restaurantId,
        uploaded_by: images.uploadedBy,
      })
      .from(images)
      .where(eq(images.id, imageId))
      .limit(1);

    const imageResult = imageResults[0] || null;

    if (!imageResult) {
      return c.json(
        {
          success: false,
          error: "Image not found",
        },
        404,
      );
    }

    // 如果沒有認證用戶，只允許存取公開圖片（restaurant_id 為 null）
    if (!user) {
      if (imageResult.restaurant_id !== null) {
        return c.json(
          {
            success: false,
            error: "Access denied",
          },
          403,
        );
      }
      await next();
      return;
    }

    // 檢查權限
    const hasAccess =
      imageResult.uploaded_by === user.id || // 上傳者
      (imageResult.restaurant_id &&
        String(imageResult.restaurant_id) === String(user.restaurantId)) || // 同餐廳
      imageResult.restaurant_id === null; // 公開圖片

    if (!hasAccess) {
      return c.json(
        {
          success: false,
          error: "Access denied",
        },
        403,
      );
    }

    await next();
  } catch (error) {
    console.error("Image access check error:", error);
    return c.json(
      {
        success: false,
        error: "Access check failed",
      },
      500,
    );
  }
};

// 速率限制中間件
export const rateLimiter = (maxRequests: number, windowMs: number) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    try {
      const clientIP = c.req.header("CF-Connecting-IP") || "unknown";
      const windowStart = Math.floor(Date.now() / windowMs);
      const key = `rate_limit:${clientIP}:${windowStart}`;

      // 獲取當前請求計數
      const current = await c.env.IMAGE_CACHE.get(key);
      const count = current ? parseInt(current) : 0;

      if (count >= maxRequests) {
        return c.json(
          {
            success: false,
            error: "Rate limit exceeded",
            retryAfter: Math.ceil(windowMs / 1000),
          },
          429,
        );
      }

      // 增加請求計數
      await c.env.IMAGE_CACHE.put(key, String(count + 1), {
        expirationTtl: Math.ceil(windowMs / 1000),
      });

      await next();
    } catch (error) {
      console.error("Rate limiter error:", error);
      // 如果速率限制檢查失敗，允許請求繼續（fail open）
      await next();
    }
  };
};

// 上傳速率限制
export const uploadRateLimit = (env: Env) => {
  const maxUploads = parseInt(env.MAX_UPLOADS_PER_MINUTE) || 10;
  return rateLimiter(maxUploads, 60 * 1000); // 1 minute window
};

// 轉換速率限制
export const transformRateLimit = (env: Env) => {
  const maxTransforms = parseInt(env.MAX_TRANSFORMS_PER_MINUTE) || 50;
  return rateLimiter(maxTransforms, 60 * 1000); // 1 minute window
};

function imageProcessorAllowedOrigins(env: Env): string[] {
  if (env.CORS_ORIGIN) {
    return env.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .filter((origin) => origin !== "*");
  }

  if (env.NODE_ENV === "development") {
    return [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3010",
      "http://localhost:3011",
    ];
  }

  return [];
}

// CORS 中間件
export const corsMiddleware = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  const origin = c.req.header("Origin");
  if (origin && imageProcessorAllowedOrigins(c.env).includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key",
  );
  c.header("Access-Control-Max-Age", "86400");

  // Handle preflight requests.
  // Must go through c.body() rather than `new Response()`: the CORS headers
  // above are staged on the context, and a freshly constructed Response would
  // ship without any of them, so the browser rejects the preflight and the
  // admin upload never fires. (A bare `new Response("")` also throws in strict
  // runtimes, since 204 is a null-body status.)
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
};

// 圖片檔案大小檢查中間件
export const checkFileSize = (maxSizeMB: number) => {
  return async (c: Context, next: Next) => {
    try {
      const contentLength = c.req.header("Content-Length");

      if (contentLength) {
        const sizeBytes = parseInt(contentLength);
        const maxSizeBytes = maxSizeMB * 1024 * 1024;

        if (sizeBytes > maxSizeBytes) {
          return c.json(
            {
              success: false,
              error: `File too large. Maximum size: ${maxSizeMB}MB`,
              maxSize: maxSizeMB,
            },
            413,
          );
        }
      }

      await next();
    } catch (error) {
      console.error("File size check error:", error);
      await next();
    }
  };
};
