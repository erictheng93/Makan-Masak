import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types/env";
import {
  checkClientRateLimit,
  checkIpRateLimit,
  rateLimitResponse,
  type RateLimitLayer,
  type RealtimeRoomType,
} from "./utils/rateLimiter";
import {
  extractTokenFromUrl,
  tokenRoomIdMatches,
  verifyWebSocketToken,
} from "./utils/jwtVerifier";

// Import Durable Objects
export { RealtimeSession } from "./durableObjects/RealtimeSession";

const app = new Hono<{ Bindings: Env }>();

export function buildAllowedOrigins(env: Pick<Env, "CORS_ORIGIN">): string[] {
  return (env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function enforceRateLimit(
  c: Context<{ Bindings: Env }>,
  layer: RateLimitLayer,
  check: () => Promise<boolean>,
): Promise<Response | null> {
  try {
    return (await check()) ? null : rateLimitResponse(layer);
  } catch (error) {
    console.error("Realtime rate limit check failed:", error);
    return c.json(
      {
        error: "Realtime rate limit unavailable",
        code: "REALTIME_RATE_LIMIT_UNAVAILABLE",
      },
      503,
    );
  }
}

/**
 * Everything a request must clear before it may touch a Durable Object.
 *
 * Each `idFromName(...).fetch()` is a billed DO request, and the room id comes
 * from the URL, so an unauthenticated caller could otherwise wake or create an
 * object per guess. The signature, expiry, revocation and room binding are all
 * checkable here without D1; the DO repeats them and adds the D1 checks.
 */
async function connectToRoom(
  c: Context<{ Bindings: Env }>,
  roomType: RealtimeRoomType,
  roomId: string,
): Promise<Response> {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }

  const ipLimited = await enforceRateLimit(c, "ip", () =>
    checkIpRateLimit(c.req.raw, c.env),
  );
  if (ipLimited) return ipLimited;

  const token = extractTokenFromUrl(new URL(c.req.url));
  if (!token) {
    return c.json({ error: "Unauthorized: Token required" }, 401);
  }
  const verification = await verifyWebSocketToken(
    token,
    c.env.REALTIME_JWT_SECRET || c.env.JWT_SECRET || "",
    c.env.TOKEN_BLACKLIST,
  );
  if (!verification.valid || !verification.payload) {
    return c.json({ error: `Unauthorized: ${verification.error}` }, 401);
  }
  if (
    verification.payload.roomType !== roomType ||
    !tokenRoomIdMatches(verification.payload, roomId)
  ) {
    return c.json({ error: "Forbidden: Token does not match room" }, 403);
  }

  const payload = verification.payload;
  const clientLimited = await enforceRateLimit(c, "client", () =>
    checkClientRateLimit(payload, c.env),
  );
  if (clientLimited) return clientLimited;

  const id = c.env.REALTIME_SESSION.idFromName(`${roomType}:${roomId}`);
  return c.env.REALTIME_SESSION.get(id).fetch(c.req.raw);
}

// CORS configuration
app.use(
  "*",
  cors({
    origin: (origin, c) =>
      buildAllowedOrigins(c.env).includes(origin) ? origin : undefined,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "Upgrade",
      "Connection",
      "Sec-WebSocket-Key",
      "Sec-WebSocket-Version",
    ],
    credentials: true,
  }),
);

// Health check endpoint
app.get("/health", (c: Context<{ Bindings: Env }>) => {
  return c.json({
    status: "healthy",
    service: "makanmasak-realtime",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT || "development",
  });
});

// WebSocket connection endpoints: customers by table/order/group id, admin
// dashboard and kitchen display by restaurant id.
app.get("/customer/:tableId", (c) =>
  connectToRoom(c, "customer", c.req.param("tableId")),
);
app.get("/admin/:restaurantId", (c) =>
  connectToRoom(c, "admin", c.req.param("restaurantId")),
);
app.get("/kitchen/:restaurantId", (c) =>
  connectToRoom(c, "kitchen", c.req.param("restaurantId")),
);

// 404 handler
app.notFound((c: Context<{ Bindings: Env }>) => {
  return c.json(
    {
      error: "Realtime endpoint not found",
      path: c.req.path,
      availableEndpoints: [
        "/customer/:tableId",
        "/admin/:restaurantId",
        "/kitchen/:restaurantId",
        "/health",
      ],
    },
    404,
  );
});

// Error handler
app.onError((error: Error, c: Context<{ Bindings: Env }>) => {
  console.error("Realtime service error:", error);
  return c.json(
    {
      error: "Internal server error",
      message:
        c.env.ENVIRONMENT === "development"
          ? error.message
          : "Something went wrong",
    },
    500,
  );
});

export default {
  fetch: app.fetch,
};
