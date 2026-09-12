import { Context, Next } from "hono";
import type { Env } from "../types/env";
import { CORS_ALLOWED_REQUEST_HEADERS } from "./cors-headers";

/**
 * Build allowed origins list based on environment configuration
 * - Production: Uses CORS_ORIGIN from env (single origin or comma-separated)
 * - Development: Allows localhost on common dev ports
 */
export const buildAllowedOrigins = (env: Env): string[] => {
  const isProduction = env.NODE_ENV === "production";

  // Production: Use configured CORS_ORIGIN only
  if (isProduction) {
    const configuredOrigin = env.CORS_ORIGIN;
    if (!configuredOrigin) {
      console.warn(
        "[CORS] CORS_ORIGIN not configured in production environment",
      );
      return [];
    }
    // Support comma-separated origins for multiple domains
    return configuredOrigin
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  // Development: Allow localhost on common dev ports
  // This list is only used in development, never in production
  const devPorts = [3000, 3001, 3002, 3003, 3004, 3005, 5173, 8000, 8787];
  const devOrigins: string[] = [];

  for (const port of devPorts) {
    devOrigins.push(`http://localhost:${port}`);
    devOrigins.push(`http://127.0.0.1:${port}`);
  }

  // Also allow any custom origins specified in DEV_CORS_ORIGINS
  const customDevOrigins = env.DEV_CORS_ORIGINS;
  if (customDevOrigins) {
    devOrigins.push(
      ...customDevOrigins
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    );
  }

  return devOrigins;
};

// CORS 中間件
export const corsMiddleware = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  // 設置 CORS headers
  const origin = c.req.header("Origin");

  // Build allowed origins based on environment
  const allowedOrigins = buildAllowedOrigins(c.env);

  // 只有在明確允許的來源列表中才設置 CORS header
  if (origin && allowedOrigins.includes(origin)) {
    c.res.headers.set("Access-Control-Allow-Origin", origin);
    c.res.headers.set("Access-Control-Allow-Credentials", "true");
  } else if (origin) {
    // 記錄未授權的來源嘗試
    console.warn(`Blocked CORS request from unauthorized origin: ${origin}`);
  }

  // 安全的 HTTP 方法列表
  c.res.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  );

  // 嚴格控制允許的 headers
  c.res.headers.set(
    "Access-Control-Allow-Headers",
    CORS_ALLOWED_REQUEST_HEADERS.join(", "),
  );

  // 暴露自定義 headers 給前端
  c.res.headers.set(
    "Access-Control-Expose-Headers",
    "X-Token-Refresh-Recommended, X-RateLimit-Remaining, X-RateLimit-Reset, X-CSRF-Token, X-Request-ID",
  );

  // 減少 preflight 快取時間以提高安全性
  c.res.headers.set("Access-Control-Max-Age", "3600"); // 1 hour instead of 24 hours

  // 添加安全 headers
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("X-XSS-Protection", "1; mode=block");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(self), payment=(), usb=()",
  );

  // SECURITY ENHANCEMENT: Add comprehensive Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://api.cloudflare.com https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https: wss: https://*.makanmasak.com https://api.cloudflare.com",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  c.res.headers.set("Content-Security-Policy", cspDirectives);

  // Additional security headers
  c.res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
  c.res.headers.set("X-DNS-Prefetch-Control", "off");
  c.res.headers.set("X-Download-Options", "noopen");
  c.res.headers.set("X-Permitted-Cross-Domain-Policies", "none");

  // 處理 preflight 請求
  if (c.req.method === "OPTIONS") {
    // 確保 OPTIONS 請求也有 CORS headers
    return new Response(null, {
      status: 204,
      headers: c.res.headers,
    });
  }

  await next();
};
