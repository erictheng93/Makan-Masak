import type { Context, Next } from "hono";
import type { Env } from "../types/env";
import { meterEmit } from "../shared/utils/meter";

const EXCLUDED_PREFIXES = [
  "/api/v1/auth",
  "/api/v1/discovery",
  "/api/v1/qr",
  "/api/v1/webhooks",
  "/api/v1/integrations/webhooks",
  // Local print agents poll GET /print/jobs on their heartbeat (60s by
  // default) and acknowledge each receipt via POST /print/jobs/:id/ack. That
  // is 1440+ machine-driven calls a day per agent, billed to the restaurant as
  // if a customer had used the API. It is infrastructure polling, not tenant
  // usage — same reason the webhook prefixes above are exempt.
  //
  // Scoped to /jobs rather than the whole feature, matching the CSRF exemption
  // in app-factory.ts: anything added under /print later that a browser drives
  // is real usage, and a bare "/api/v1/print" would silence it. Note this does
  // NOT cover /api/v1/pos/print-agents — the admin UI that lists and issues
  // agent credentials is browser traffic and stays metered.
  "/api/v1/print/jobs",
];

const EXCLUDED_PATHS = new Set([
  "/",
  "/health",
  "/info",
  "/api/v1/me/modules",
  "/api/v1/monitoring/health",
]);

function shouldSkip(c: Context<{ Bindings: Env }>): boolean {
  if (c.req.method === "OPTIONS") return true;

  const path = c.req.path;
  if (EXCLUDED_PATHS.has(path)) return true;
  return EXCLUDED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export async function usageTracker(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    await next();
  } finally {
    if (!shouldSkip(c)) {
      try {
        // No metadata: method/path/status already reach Analytics Engine on
        // every request via advancedAnalyticsMiddleware. See meterEmit's doc
        // comment.
        await meterEmit(c, "api.requests");
      } catch (error) {
        console.error("usageTracker.failed", { path: c.req.path, error });
      }
    }
  }
}
