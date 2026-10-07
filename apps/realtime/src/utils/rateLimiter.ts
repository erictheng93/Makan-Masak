import type { Env } from "../types/env";

export type RealtimeRoomType = "customer" | "admin" | "kitchen";

// Mirrors `period` on WS_CONNECT_RATE_LIMITER in wrangler.toml; the binding
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
 * Keyed by client address and room type, never by room id: a key the caller
 * can vary is a fresh budget per value. The previous KV counter included the
 * room id and was a read-then-write, so concurrent attempts and rotating ids
 * both walked past it.
 *
 * ponytail: per-IP, so a restaurant's customers behind one NAT share a bucket;
 * the limit is sized for that. Key on the token subject if it ever bites.
 *
 * Returns true when the attempt is allowed. Unbound (dev, tests) means allowed,
 * the same way the API treats its own native limiters outside production.
 */
export async function checkRealtimeRateLimit(
  request: Request,
  env: Pick<Env, "WS_CONNECT_RATE_LIMITER">,
  roomType: RealtimeRoomType,
): Promise<boolean> {
  if (!env.WS_CONNECT_RATE_LIMITER) return true;
  const { success } = await env.WS_CONNECT_RATE_LIMITER.limit({
    key: `${roomType}:${getClientAddress(request)}`,
  });
  return success;
}

export function rateLimitResponse(): Response {
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
