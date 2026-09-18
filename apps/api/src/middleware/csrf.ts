import { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import type { Env } from "../types/env";
import { buildAllowedOrigins } from "./cors";
import { forbidden } from "../shared/utils/api-error";

/**
 * CSRF Protection Middleware
 *
 * Protects against Cross-Site Request Forgery attacks by validating
 * CSRF tokens on state-changing requests (POST, PUT, DELETE, PATCH)
 */

const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_COOKIE_NAME = "__Host-mm_csrf";
const LEGACY_CSRF_COOKIE_NAME = "csrf_token";
const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour — KV-backed validation only

// The cookie must not expire before the session it guards. __Host-mm_staff_refresh
// lives for 7 days, and restoring a session posts to /auth/refresh, which is CSRF
// protected — so a 1-hour cookie meant every restore after an hour idle failed
// with a valid refresh cookie still in hand (#66).
const CSRF_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Build CSRF cookie options string.
 *
 * Deliberately NOT HttpOnly. The double-submit pattern requires the browser to
 * read this value back and echo it in the X-CSRF-Token header; an HttpOnly
 * cookie is invisible to document.cookie, which silently reduced the client to
 * a single in-memory token that did not survive a page reload (#66).
 *
 * This is safe because the value is not a credential: it authorises nothing on
 * its own, and an attacker who could read it cross-origin could equally read
 * the header. Secure + SameSite=Lax + the __Host- prefix still prevent it from
 * being set or read by another origin, which is what the defence relies on.
 */
function buildCookieOptions(token: string): string {
  const parts = [
    `${CSRF_COOKIE_NAME}=${token}`,
    "Secure",
    "SameSite=Lax",
    `Max-Age=${CSRF_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
  ];
  return parts.join("; ");
}

interface CSRFOptions {
  /**
   * HTTP methods to protect with CSRF validation
   * @default ['POST', 'PUT', 'DELETE', 'PATCH']
   */
  protectedMethods?: string[];

  /**
   * Paths to exclude from CSRF protection (e.g., public APIs)
   */
  excludePaths?: string[];

  /**
   * Enable double-submit cookie pattern
   * @default true
   */
  useDoubleSubmit?: boolean;
}

const defaultOptions: Required<CSRFOptions> = {
  protectedMethods: ["POST", "PUT", "DELETE", "PATCH"],
  excludePaths: ["/api/v1/auth/login", "/api/v1/auth/register"],
  useDoubleSubmit: true,
};

function getCookieValue(cookieHeader: string | undefined, name: string) {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function wildcardPattern(excludePath: string): string {
  return excludePath
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
}

function isExcludedPath(path: string, excludePath: string): boolean {
  // A trailing "$" means exact path only — do not exempt anything nested under
  // it. Needed where a public customer route sits at the root of a feature
  // whose child routes are staff-only, e.g. POST /waiting-list is public but
  // POST /waiting-list/:id/call must stay protected.
  //
  // "*" combined with "$" is the same rule one segment down: the diner's own
  // DELETE /waiting-list/:id must be exempt while /:id/call and /:id/seat stay
  // protected. Neither half expresses that alone, and without it production
  // answered 403 CSRF_TOKEN_MISSING to every 取消候位.
  if (excludePath.endsWith("$")) {
    const exact = excludePath.slice(0, -1);
    if (exact.includes("*")) {
      return new RegExp(`^${wildcardPattern(exact)}$`).test(path);
    }
    return path === exact;
  }

  if (excludePath.includes("*")) {
    return new RegExp(`^${wildcardPattern(excludePath)}(?:/.*)?$`).test(path);
  }

  return path === excludePath || path.startsWith(`${excludePath}/`);
}

/**
 * Generate a cryptographically secure random token
 */
function generateCSRFToken(): string {
  const array = new Uint8Array(CSRF_TOKEN_LENGTH);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Validate request origin matches expected host
 */
function validateOrigin(c: Context<{ Bindings: Env }>): boolean {
  const origin = c.req.header("Origin");
  const referer = c.req.header("Referer");
  const host = c.req.header("Host");

  // Match CORS origin policy so CSRF does not reject browser requests that
  // the API explicitly allows in the same environment.
  const allowedOrigins = buildAllowedOrigins(c.env);

  // If Origin header exists, validate it
  if (origin) {
    try {
      const originUrl = new URL(origin);
      // Allow same-origin requests
      if (originUrl.host === host) {
        return true;
      }
      // Allow configured CORS origins
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // If no Origin but has Referer, validate it
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) {
        return true;
      }
      if (
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(refererUrl.origin)
      ) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // No Origin or Referer - reject for extra safety
  return false;
}

/**
 * CSRF Protection Middleware
 */
export function csrfProtection(options: CSRFOptions = {}) {
  const opts = { ...defaultOptions, ...options };

  return createMiddleware<{ Bindings: Env }>(
    async (c: Context<{ Bindings: Env }>, next: Next) => {
      const method = c.req.method.toUpperCase();
      const path = c.req.path;

      // Skip CSRF check for excluded paths (supports * wildcard for path segments)
      if (
        opts.excludePaths.some((excludePath) =>
          isExcludedPath(path, excludePath),
        )
      ) {
        return next();
      }

      // Skip CSRF check for safe methods (GET, HEAD, OPTIONS)
      if (!opts.protectedMethods.includes(method)) {
        return next();
      }

      // === DEFENSE LAYER 1: Origin/Referer Validation ===
      if (!validateOrigin(c)) {
        throw forbidden(
          "Request origin does not match expected host",
          "INVALID_REQUEST_ORIGIN",
        );
      }

      // === DEFENSE LAYER 2: CSRF Token Validation ===
      // Get CSRF token from header
      const tokenFromHeader = c.req.header(CSRF_HEADER_NAME);

      if (!tokenFromHeader) {
        throw forbidden(
          "CSRF token is required for this request",
          "CSRF_TOKEN_MISSING",
        );
      }

      // Validate token format (must be 64 hex characters)
      if (!/^[a-f0-9]{64}$/.test(tokenFromHeader)) {
        throw forbidden(
          "CSRF token must be a valid hexadecimal string",
          "CSRF_TOKEN_INVALID_FORMAT",
        );
      }

      if (opts.useDoubleSubmit) {
        // Double-submit cookie pattern: validate token from cookie matches header
        const cookieHeader = c.req.header("Cookie");
        const tokenFromCookie =
          getCookieValue(cookieHeader, CSRF_COOKIE_NAME) ??
          getCookieValue(cookieHeader, LEGACY_CSRF_COOKIE_NAME);

        if (!tokenFromCookie || tokenFromCookie !== tokenFromHeader) {
          throw forbidden("CSRF token validation failed", "CSRF_TOKEN_INVALID");
        }
      } else {
        // Server-side validation: check token from KV store
        if (c.env.CACHE_KV) {
          const storedToken = await c.env.CACHE_KV.get(
            `csrf:${tokenFromHeader}`,
          );

          if (!storedToken) {
            throw forbidden(
              "CSRF token validation failed",
              "CSRF_TOKEN_EXPIRED_OR_INVALID",
            );
          }
        }
      }

      await next();
    },
  );
}

/**
 * Generate and set CSRF token
 * This endpoint should be called to get a CSRF token before making protected requests
 */
export async function generateCSRFTokenHandler(c: Context<{ Bindings: Env }>) {
  const token = generateCSRFToken();

  // Store token in KV for server-side validation (optional)
  if (c.env.CACHE_KV) {
    await c.env.CACHE_KV.put(
      `csrf:${token}`,
      JSON.stringify({ created: Date.now() }),
      { expirationTtl: CSRF_TOKEN_EXPIRY / 1000 },
    );
  }

  // Set cookie for double-submit pattern
  const cookieOptions = buildCookieOptions(token);

  return c.json(
    {
      success: true,
      data: {
        csrfToken: token,
        expiresIn: CSRF_TOKEN_EXPIRY,
      },
    },
    {
      headers: {
        "Set-Cookie": cookieOptions,
      },
    },
  );
}

/**
 * Middleware to automatically generate CSRF token for authenticated users
 * Adds token to response headers for SPA consumption
 */
export function attachCSRFToken() {
  return createMiddleware<{ Bindings: Env }>(
    async (c: Context<{ Bindings: Env }>, next: Next) => {
      await next();

      // Only attach token to successful authentication responses
      if (c.res.status === 200 && c.req.path.includes("/auth/")) {
        const token = generateCSRFToken();

        // Store in KV
        if (c.env.CACHE_KV) {
          await c.env.CACHE_KV.put(
            `csrf:${token}`,
            JSON.stringify({ created: Date.now() }),
            { expirationTtl: CSRF_TOKEN_EXPIRY / 1000 },
          );
        }

        // Add to response headers
        c.res.headers.set("X-CSRF-Token", token);

        // The header seeds the client's in-memory cache; the cookie is what it
        // falls back to after a reload, so both carry the same token (#66).
        const cookieOptions = buildCookieOptions(token);
        c.res.headers.append("Set-Cookie", cookieOptions);
      }
    },
  );
}
