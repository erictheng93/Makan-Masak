/**
 * Rate Limiter Middleware
 * Prevents abuse by limiting requests per IP address
 * Counters live in the D1 ephemeral store (KV's free write quota is too small)
 */

import { Context, Next } from "hono";
import type { Env } from "../types/env";
import {
  ephemeralStore,
  type EphemeralStore,
} from "../shared/utils/ephemeral-store";

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyPrefix?: string; // KV key prefix
  skipSuccessfulRequests?: boolean; // Only count failed requests
  message?: string; // Error message
}

interface RateLimitTenant {
  tenantId?: string | null;
}

interface RateLimitUser {
  id?: string | number | null;
  restaurantId?: string | number | null;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

/**
 * Cloudflare KV rejects any write with expirationTtl below 60 seconds.
 *
 * The counter's own `resetTime` is what bounds the logical window, so holding a
 * key slightly longer than that window is harmless — `checkLimit` starts a new
 * window whenever `resetTime` has passed. Clamping here only affects garbage
 * collection, never the limit itself.
 */
const KV_MIN_EXPIRATION_TTL = 60;

function kvExpirationTtl(seconds: number): number {
  return Math.max(KV_MIN_EXPIRATION_TTL, Math.ceil(seconds));
}

/**
 * Rate limiter using Cloudflare KV
 */
export class RateLimiter {
  constructor(
    private kv: EphemeralStore,
    private config: RateLimitConfig,
  ) {}

  async checkLimit(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const kvKey = `${this.config.keyPrefix || "ratelimit"}:${key}`;

    // Get current request count
    const data = (await this.kv.get(kvKey, "json")) as {
      count: number;
      resetTime: number;
    } | null;

    // If no data or window expired, start new window
    if (!data || data.resetTime < now) {
      const resetTime = now + this.config.windowMs;
      await this.kv.put(kvKey, JSON.stringify({ count: 1, resetTime }), {
        expirationTtl: kvExpirationTtl(this.config.windowMs / 1000),
      });

      return {
        allowed: true,
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests - 1,
        resetTime,
      };
    }

    // Check if limit exceeded
    if (data.count >= this.config.maxRequests) {
      return {
        allowed: false,
        limit: this.config.maxRequests,
        remaining: 0,
        resetTime: data.resetTime,
        retryAfter: Math.ceil((data.resetTime - now) / 1000),
      };
    }

    // Increment count
    await this.kv.put(
      kvKey,
      JSON.stringify({ count: data.count + 1, resetTime: data.resetTime }),
      { expirationTtl: kvExpirationTtl((data.resetTime - now) / 1000) },
    );

    return {
      allowed: true,
      limit: this.config.maxRequests,
      remaining: this.config.maxRequests - data.count - 1,
      resetTime: data.resetTime,
    };
  }

  async reset(key: string): Promise<void> {
    const kvKey = `${this.config.keyPrefix || "ratelimit"}:${key}`;
    await this.kv.delete(kvKey);
  }
}

/**
 * Rate limiting middleware factory
 */
/**
 * Run the limit check for one key.
 *
 * Returns a 429 response when the caller is over budget, or null to let the
 * request continue. A failure inside the limiter itself also returns null: the
 * limiter is a guard, and a guard being unavailable must not turn every request
 * into a 500 — that converts a KV hiccup into an outage of the endpoint it was
 * meant to protect.
 */
async function enforceRateLimit(
  c: Context<{ Bindings: Env }>,
  kv: EphemeralStore,
  config: RateLimitConfig,
  key: string,
): Promise<Response | null> {
  let result: RateLimitResult;
  try {
    result = await new RateLimiter(kv, config).checkLimit(key);
  } catch (error) {
    console.warn(
      `Rate limit check failed for ${config.keyPrefix || "ratelimit"}; allowing request`,
      error,
    );
    return null;
  }

  c.header("X-RateLimit-Limit", result.limit.toString());
  c.header("X-RateLimit-Remaining", result.remaining.toString());
  c.header("X-RateLimit-Reset", new Date(result.resetTime).toISOString());

  if (result.allowed) return null;

  const retryAfter = Math.max(1, result.retryAfter ?? 1);
  c.header("Retry-After", retryAfter.toString());
  return c.json(
    {
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: config.message || "Too many requests. Please try again later.",
      },
      retryAfter,
    },
    429,
  );
}

export function rateLimitMiddleware(config: RateLimitConfig) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!c.env.DB) {
      console.warn("DB not available, skipping rate limiting");
      return next();
    }
    const kv = ephemeralStore(c.env);

    const tenant = c.get("tenant" as never) as RateLimitTenant | undefined;
    const user = c.get("user" as never) as RateLimitUser | undefined;

    const tenantScopedKey =
      tenant?.tenantId != null
        ? `tenant:${tenant.tenantId}`
        : user?.restaurantId != null
          ? `tenant:${user.restaurantId}`
          : user?.id != null
            ? `user:${user.id}`
            : undefined;

    if (tenantScopedKey) {
      const limited = await enforceRateLimit(c, kv, config, tenantScopedKey);
      return limited ?? next();
    }

    // Get client IP
    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for") ||
      "unknown";

    // Skip rate limiting for localhost (performance testing)
    if (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "unknown" ||
      ip === "localhost"
    ) {
      return next();
    }

    const limited = await enforceRateLimit(c, kv, config, ip);
    return limited ?? next();
  };
}

/**
 * Preset rate limit configurations
 */
export const RateLimitPresets = {
  // Password reset: 5 requests per hour per IP
  passwordReset: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5,
    keyPrefix: "pwd_reset",
    message: "密碼重設請求過於頻繁，請 1 小時後再試",
  },

  // Email verification: 3 requests per 10 minutes per IP
  emailVerification: {
    windowMs: 10 * 60 * 1000, // 10 minutes
    maxRequests: 3,
    keyPrefix: "email_verify",
    message: "Email 驗證請求過於頻繁，請 10 分鐘後再試",
  },

  // SMS OTP: 3 requests per hour per IP
  smsOTP: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 3,
    keyPrefix: "sms_otp",
    message: "SMS 驗證碼請求過於頻繁，請 1 小時後再試",
  },

  // Login attempts: 10 requests per 15 minutes per IP
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,
    keyPrefix: "login",
    message: "登入嘗試過於頻繁，請 15 分鐘後再試",
  },

  // General API: 100 requests per minute per IP
  general: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    keyPrefix: "api",
    message: "API 請求過於頻繁，請稍後再試",
  },
} as const;

/**
 * User-based rate limiter (in addition to IP-based)
 */
export function userRateLimitMiddleware(config: RateLimitConfig) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!c.env.DB) return next();
    const kv = ephemeralStore(c.env);

    // Get user ID from request body or JWT
    const userId =
      (c.get as (key: string) => unknown)("userId") ||
      (await c.req.json().catch(() => ({})))?.userId;

    if (!userId) {
      return next(); // Skip if no user ID
    }

    const rateLimiter = new RateLimiter(kv, config);
    const result = await rateLimiter.checkLimit(`user:${userId}`);

    c.header("X-RateLimit-User-Limit", result.limit.toString());
    c.header("X-RateLimit-User-Remaining", result.remaining.toString());

    if (!result.allowed) {
      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: config.message || "Too many requests for this user.",
          },
          retryAfter: result.retryAfter,
        },
        429,
      );
    }

    return next();
  };
}
