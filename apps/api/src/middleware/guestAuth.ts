/**
 * Guest Token Authentication Middleware
 * Validates KV-stored guest tokens for unauthenticated order access.
 * Token format: "gt_" + 32-byte random hex, stored in CACHE_KV with 4hr TTL.
 */

import { Context, Next } from "hono";
import type { Env } from "../types/env";
import {
  ApiError,
  forbidden,
  serviceUnavailable,
  unauthorized,
} from "../shared/utils/api-error";

export interface GuestTokenData {
  orderId: string;
  restaurantId: string;
  guestName: string;
  createdAt: number;
}

export interface GuestSessionData {
  restaurantId: string;
  createdAt: number;
  orderId?: string; // Set after order is created
}

declare module "hono" {
  interface ContextVariableMap {
    guestOrder: GuestTokenData;
    guestSession: GuestSessionData;
  }
}

export const guestTokenAuth = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer gt_")) {
    throw unauthorized("Missing or invalid guest token", "MISSING_AUTH_TOKEN");
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  try {
    const kvKey = `guest_token:${token}`;
    const tokenData = (await c.env.CACHE_KV.get(
      kvKey,
      "json",
    )) as GuestTokenData | null;

    if (!tokenData) {
      throw unauthorized("Guest token expired or invalid", "TOKEN_INVALID");
    }

    // Verify orderId matches the route param
    const routeOrderId = c.req.param("id");
    if (routeOrderId && tokenData.orderId !== routeOrderId) {
      throw forbidden("Token does not match this order", "ACCESS_DENIED");
    }

    c.set("guestOrder", tokenData);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Guest token auth error:", error);
    throw serviceUnavailable(
      "Authentication service temporarily unavailable",
      "AUTH_BACKEND_UNAVAILABLE",
    );
  }

  await next();
};

/**
 * Guest session auth middleware for pre-order sessions.
 * Unlike guestTokenAuth, this does NOT require orderId.
 * Used for guest order creation flow.
 */
export const guestSessionAuth = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer gt_")) {
    throw unauthorized("Missing or invalid guest token", "MISSING_AUTH_TOKEN");
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  try {
    const kvKey = `guest_token:${token}`;
    const tokenData = (await c.env.CACHE_KV.get(
      kvKey,
      "json",
    )) as GuestSessionData | null;

    if (!tokenData) {
      throw unauthorized("Guest token expired or invalid", "TOKEN_INVALID");
    }

    c.set("guestSession", tokenData);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Guest session auth error:", error);
    throw serviceUnavailable(
      "Authentication service temporarily unavailable",
      "AUTH_BACKEND_UNAVAILABLE",
    );
  }

  await next();
};

/**
 * Extract a well-formed guest token from an Authorization header.
 * Returns null when the header is absent or is not a `gt_` bearer token, so
 * callers can tell "this device has no guest identity yet" apart from "this
 * device presented a token". Does not prove the token exists in KV.
 */
export function getGuestBearerToken(
  authorization: string | undefined,
): string | null {
  const bearerPrefix = "Bearer ";
  if (!authorization?.startsWith(bearerPrefix)) return null;

  const token = authorization.slice(bearerPrefix.length).trim();
  return /^gt_[0-9a-f]{64}$/i.test(token) ? token : null;
}

/** Header carrying the customer app's opaque, per-device guest identifier. */
export const GUEST_DEVICE_ID_HEADER = "X-Guest-Device-Id";

/**
 * Extract the caller's device identifier from `X-Guest-Device-Id`.
 * The value is opaque and client-generated, so it proves nothing — it only
 * says "the same browser storage that ordered before is ordering again".
 * Charset and length are bounded because the value lands in a KV key.
 */
export function getGuestDeviceId(deviceId: string | undefined): string | null {
  const trimmed = deviceId?.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9_-]{16,64}$/.test(trimmed) ? trimmed : null;
}

/**
 * Which identity a device's active-order locks hang off. The two kinds live in
 * separate key namespaces so a lock written under one can never be read back
 * under the other.
 */
export type GuestLockIdentity =
  | { kind: "device"; value: string }
  | { kind: "token"; value: string };

/**
 * Resolve the active-order lock identity for a request.
 *
 * Prefers the device id, because a guest token identifies one *order*, not one
 * device: a market checkout mints one token per vendor and the customer app can
 * only carry one of them as its bearer, so a token-keyed lock is unreadable for
 * every other vendor in that checkout. The device id is also the only identity
 * that survives sign-in — the customer app sends its customer JWT in
 * `Authorization` once the shopper has an account, which leaves no guest token
 * to key on at all.
 *
 * Returns null when the request carries neither, which is a legitimate state
 * (a brand-new shopper) and simply means there is nothing to check yet. Never
 * key this on the client IP: a market's shared WiFi (or a carrier's CGNAT) puts
 * every customer behind one address, which would make one guest's open order
 * block the whole venue.
 */
export function resolveGuestLockIdentity(req: {
  header(name: string): string | undefined;
}): GuestLockIdentity | null {
  const deviceId = getGuestDeviceId(req.header(GUEST_DEVICE_ID_HEADER));
  if (deviceId) return { kind: "device", value: deviceId };

  const guestToken = getGuestBearerToken(req.header("Authorization"));
  return guestToken ? { kind: "token", value: guestToken } : null;
}

/**
 * Build the per-device active-order lock key for a restaurant.
 * The lock must be scoped to something the customer's own device holds, never
 * to the client IP. Both the check and the write must pass the same identity —
 * see `resolveGuestLockIdentity`.
 */
export function guestActiveOrderKey(
  restaurantId: string,
  identity: GuestLockIdentity,
): string {
  return `guest_active:${restaurantId}:${identity.kind}:${identity.value}`;
}

/**
 * Generate a cryptographically random guest token.
 */
export function generateGuestToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `gt_${hex}`;
}
