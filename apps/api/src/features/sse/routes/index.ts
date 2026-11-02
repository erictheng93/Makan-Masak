/**
 * Legacy SSE compatibility routes.
 *
 * Runtime realtime delivery is handled by the realtime worker Durable Object.
 * These HTTP SSE endpoints are intentionally not backed by in-process
 * connection state.
 */

import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  authMiddleware,
  toAuthFailure,
  verifyJwtToken,
} from "../../../middleware/auth";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError, unauthorized } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";

const app = new Hono<{ Bindings: Env }>();

type SseJwtPayload = {
  id?: string;
  sub?: string;
  username: string;
  role: number;
  restaurantId?: string;
  fullName?: string;
  email?: string;
  phone?: string;
};

const sseAuthMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.substring(7)
    : c.req.query("token");

  if (!token) {
    throw unauthorized("Missing authentication token", "MISSING_AUTH_TOKEN");
  }

  if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) {
    throw new ApiError(
      "SERVER_CONFIG_ERROR",
      "Server configuration error",
      500,
    );
  }

  let decoded: SseJwtPayload;
  try {
    // Verify before the KV lookup: keys over 512 bytes make KV throw, so an
    // unsigned garbage token must never reach it.
    decoded = verifyJwtToken(token, c.env.JWT_SECRET) as SseJwtPayload;

    if (c.env.TOKEN_BLACKLIST) {
      const blacklisted = await c.env.TOKEN_BLACKLIST.get(`token:${token}`);
      if (blacklisted) {
        throw unauthorized("Token has been invalidated", "TOKEN_BLACKLISTED");
      }
    }
  } catch (error) {
    throw toAuthFailure(error);
  }

  const user: AuthUser = {
    id: decoded.sub ?? decoded.id!,
    publicId: decoded.sub ?? decoded.id,
    username: decoded.username,
    role: decoded.role,
    restaurantId: decoded.restaurantId,
    fullName: decoded.fullName,
    email: decoded.email,
    phone: decoded.phone,
  };

  c.set("user", user);
  await next();
};

function realtimeGone(c: Context) {
  return c.json(
    {
      success: false,
      error: {
        code: "ENDPOINT_RETIRED",
        message:
          "Legacy SSE endpoints have been retired. Use the realtime WebSocket service.",
      },
      data: {
        realtimeWsUrl: c.env.REALTIME_WS_URL,
      },
    },
    410,
  );
}

app.get("/events", sseAuthMiddleware, realtimeGone);
app.get("/connections", authMiddleware, realtimeGone);
app.post("/test", authMiddleware, realtimeGone);
app.post("/broadcast/*", authMiddleware, realtimeGone);
app.post("/notify/group", authMiddleware, realtimeGone);
app.get("/group/:groupOrderId/health", authMiddleware, realtimeGone);
app.get("/group/:groupOrderId/sync", authMiddleware, realtimeGone);

app.get("/ping", authMiddleware, (c) => {
  return c.json({
    success: true,
    data: {
      pong: true,
      timestamp: new Date().toISOString(),
      realtime: "websocket",
    },
  });
});

app.get("/time", authMiddleware, (c) => {
  return c.json({
    success: true,
    data: {
      timestamp: Date.now(),
      iso: new Date().toISOString(),
    },
  });
});

export const sseRoutes = app;
export default app;
