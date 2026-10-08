/**
 * Management API Authentication Middleware
 *
 * Protects management endpoints with JWT Bearer token verification.
 * Only admin role is supported for the management API.
 */

import { verify } from "hono/jwt";
import type { Context, Next } from "hono";
import type { ManagementEnv } from "../types";
import { ApiError, unauthorized } from "@makanmasak/utils";

export interface ManagementUser {
  id: string;
  email: string;
  role: "admin";
}

export const MANAGEMENT_JWT_AUDIENCE = "management";
export const MANAGEMENT_JWT_ISSUER = "makanmakan-management";

type Env = {
  Bindings: ManagementEnv;
  Variables: { managementUser: ManagementUser };
};

export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function requireCurrentAdmin(
  env: ManagementEnv,
  id: string,
  tokenVersion: unknown,
) {
  if (
    !UUID_V7_PATTERN.test(id) ||
    typeof tokenVersion !== "number" ||
    !Number.isInteger(tokenVersion) ||
    tokenVersion < 1
  ) {
    throw unauthorized("Invalid token claims");
  }
  if (!env.PLATFORM_DB) throw unauthorized("Platform user lookup unavailable");
  const user = await env.PLATFORM_DB.prepare(
    "SELECT id, username, role, is_active, token_version FROM users WHERE id = ? AND deleted_at_ms IS NULL LIMIT 1",
  )
    .bind(id)
    .first<{
      id: string;
      username: string;
      role: number;
      is_active: number | boolean;
      token_version: number | null;
    }>();
  if (
    !user ||
    !user.is_active ||
    user.role !== 0 ||
    (user.token_version ?? 1) !== tokenVersion
  ) {
    throw unauthorized("Admin account or token has been invalidated");
  }
  return user;
}

export function managementJwtSecret(env: ManagementEnv): string {
  return env.MANAGEMENT_JWT_SECRET || env.JWT_SECRET;
}

/**
 * JWT authentication middleware for management API.
 * Validates Bearer token, checks expiry, and sets managementUser on context.
 */
export const managementAuthMiddleware = async (c: Context<Env>, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw unauthorized("Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);
  if (!token) {
    throw unauthorized("Missing token");
  }

  try {
    const payload = await verify(token, managementJwtSecret(c.env), "HS256");

    // Validate required claims
    if (
      typeof payload.id !== "string" ||
      typeof payload.email !== "string" ||
      payload.role !== "admin" ||
      payload.aud !== MANAGEMENT_JWT_AUDIENCE ||
      payload.iss !== MANAGEMENT_JWT_ISSUER ||
      typeof payload.sid !== "string" ||
      typeof payload.exp !== "number"
    ) {
      throw unauthorized("Invalid token claims");
    }

    // Check expiration (hono/jwt checks exp automatically, but be explicit)
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw unauthorized("Token expired");
    }

    await requireCurrentAdmin(c.env, payload.id, payload.tv);
    if (!c.env.PLATFORM_DB)
      throw unauthorized("Platform user lookup unavailable");
    const session = await c.env.PLATFORM_DB.prepare(
      "SELECT id FROM sessions WHERE id = ? AND user_id = ? AND is_active = 1 AND expires_at_ms > ? LIMIT 1",
    )
      .bind(payload.sid, payload.id, Date.now())
      .first();
    if (!session) throw unauthorized("Session has been invalidated");

    const user: ManagementUser = {
      id: payload.id,
      email: payload.email,
      role: "admin",
    };

    c.set("managementUser", user);
    await next();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unauthorized("Invalid or expired token");
  }
};
