import type { RealtimeAuthPayload } from "@makanmasak/shared-types";
import type { Env } from "../types/env";

export type RealtimeRoomType = "customer" | "admin" | "kitchen";
export type RateLimitLayer = "ip" | "client";

// Mirrors `period` on both ratelimits bindings in wrangler.toml; the binding
// does not report how long until the window resets.
const WINDOW_SECONDS = 60;

function getClientAddress(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Layer A, before the token is read: a flood ceiling per client address.
 *
 * Deliberately loose. One address can front a whole food court on shared
 * Wi-Fi, or unrelated phones behind carrier-grade NAT, so the tight per-client
 * limit lives in layer B where the token says who is connecting.
 */
export async function checkIpRateLimit(
  request: Request,
  env: Pick<Env, "WS_IP_RATE_LIMITER">,
): Promise<boolean> {
  if (!env.WS_IP_RATE_LIMITER) return true;
  const { success } = await env.WS_IP_RATE_LIMITER.limit({
    key: getClientAddress(request),
  });
  return success;
}

/**
 * Who a verified token speaks for. Never the token itself: clients re-mint a
 * token after a failed connect, so a per-token key would reset on every retry.
 * Legacy table guests carry no per-person id and share their table's bucket.
 */
export function clientRateLimitKey(payload: RealtimeAuthPayload): string {
  const who =
    payload.sid ??
    payload.memberId ??
    payload.seatId ??
    payload.userId ??
    "guest";
  return `${payload.roomType}:${payload.roomId}:${who}`;
}

/** Layer B, after verification: the tight limit, per client. */
export async function checkClientRateLimit(
  payload: RealtimeAuthPayload,
  env: Pick<Env, "WS_CLIENT_RATE_LIMITER">,
): Promise<boolean> {
  if (!env.WS_CLIENT_RATE_LIMITER) return true;
  const { success } = await env.WS_CLIENT_RATE_LIMITER.limit({
    key: clientRateLimitKey(payload),
  });
  return success;
}

export function rateLimitResponse(layer: RateLimitLayer): Response {
  // One line per rejection so `wrangler tail` shows which layer is biting.
  console.warn("Realtime connect rate limited", { layer });
  return Response.json(
    {
      error: "Too many realtime connection attempts",
      code: "REALTIME_RATE_LIMITED",
      retryAfterSeconds: WINDOW_SECONDS,
    },
    {
      status: 429,
      headers: { "Retry-After": String(WINDOW_SECONDS) },
    },
  );
}
