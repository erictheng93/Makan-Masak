/**
 * Per-(restaurant, IP) throttle for guest order creation.
 *
 * Layered *on top of* the global per-IP limiter in geo-rate-limiting, not a
 * replacement for it. Re-keying the global limiter by restaurant would have
 * made abuse cheaper, not dearer: one IP capped at N/min overall becomes one IP
 * capped at N/min *per restaurant*, so an attacker just spreads across stalls.
 * Keeping both means the global cap still bounds the total while this one bounds
 * what any single stall can be made to absorb — a night market's order printer
 * is the thing that actually falls over.
 *
 * Deliberately not keyed on anything derived from the shop QR code. That code is
 * public: `GET /api/v1/restaurants/:id` and the discovery takeaway-eligibility
 * endpoint both hand it to anyone who asks, by design, so customers can start a
 * takeaway order from discovery without physically scanning. Treating it as
 * proof of presence would be security theatre (see issue #187).
 *
 * IP is a blunt key and this repo has been burned by it before: keying the
 * active-order lock on IP took out QR ordering for every customer behind a
 * restaurant's shared WiFi (#163-#168). Two things keep that from repeating —
 * the budget is per stall rather than shared across the whole venue, and
 * exceeding it costs a 429 with Retry-After for the rest of the window rather
 * than an escalating block.
 */

import { ephemeralStore } from "../../../shared/utils/ephemeral-store";
import { GeoIntelligentRateLimiter } from "../../../middleware/geo-rate-limiting";
import { ApiError } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

/**
 * Just the slice of Hono's Context this needs. Taking `Context<{Bindings: Env}>`
 * does not work here: the route's context also carries `Variables` (the
 * validated body), and Context is invariant in that position, so the real
 * argument would not be assignable.
 */
interface ThrottleContext {
  env: Env;
  req: {
    header(name: string): string | undefined;
    raw: Request;
  };
  executionCtx: { waitUntil(promise: Promise<unknown>): void };
}

/**
 * Sized so a real stall cannot reach it and a script cannot miss it. A busy
 * night market stall takes a handful of orders a minute, and only the share of
 * those arriving from one address counts here; 30 in a minute from a single
 * address for a single stall is not a service pattern.
 */
export const GUEST_ORDER_THROTTLE = {
  requests: 20,
  windowSeconds: 60,
  burstMultiplier: 1.5, // → 30 in any 60s window
  blockDuration: 60, // surfaced as Retry-After; no escalating block
} as const;

/**
 * Hono only materializes executionCtx when the runtime supplies one, and
 * reading it otherwise throws. Violation recording is fire-and-forget, so a
 * no-op is a fine stand-in.
 */
function resolveWaitUntil(c: ThrottleContext): {
  waitUntil: (promise: Promise<unknown>) => void;
} {
  try {
    return c.executionCtx;
  } catch {
    return { waitUntil: () => undefined };
  }
}

export async function enforceGuestOrderThrottle(
  c: ThrottleContext,
  restaurantId: string,
): Promise<void> {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  const limiter = new GeoIntelligentRateLimiter(
    // D1, not RATE_LIMIT_KV: this counter is written on every guest order and
    // KV allows 1,000 writes a day on the Free plan. applyRateLimit fails open
    // when the store is unreachable — availability beats enforcement here.
    ephemeralStore(c.env),
    c.env.ANALYTICS_ENGINE,
    resolveWaitUntil(c),
    c.env,
  );

  const result = await limiter.applyRateLimit(
    c.req.raw,
    { ...GUEST_ORDER_THROTTLE },
    `guest-order:${restaurantId}:ip:${ip}`,
  );

  if (!result.allowed) {
    throw new ApiError(
      "GUEST_ORDER_RATE_LIMITED",
      "Too many orders from this connection for this restaurant. Please wait a moment and try again.",
      429,
      { retryAfter: result.retryAfter ?? GUEST_ORDER_THROTTLE.blockDuration },
    );
  }
}
